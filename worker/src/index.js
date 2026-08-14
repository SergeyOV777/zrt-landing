import { buildAmoLeadTags } from './amo-tags.mjs';
import {
  DEFAULT_METRIKA_TARGET,
  metrikaRetryDelaySeconds,
  normalizeMetrikaIdentifiers,
  uploadMetrikaOfflineConversion
} from './metrika-offline.mjs';

const MAX_BODY_BYTES = 16_384;
const RETRY_AFTER_SECONDS = 60;
const PROCESSING_STALE_MS = 120_000;
const STATS_API_PATH = '/statistics/api';
const STATS_EXPORT_PATH = '/statistics/api/export.csv';
const ACCESS_JWKS_TTL_MS = 3_600_000;
const CSV_PAGE_SIZE = 500;
const CONTACT_METHODS = new Set(['telegram', 'whatsapp', 'max', 'phone']);
const SCENARIOS = new Set(['beginner', 'experienced']);
const ATTRIBUTION_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const METRIKA_LEASE_MS = 60_000;
const METRIKA_MATCH_WINDOW_SECONDS = 21 * 24 * 60 * 60;

let accessJwksCache = null;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (env.STATS_ONLY === 'true') {
      return handleStatisticsWorker(request, env, url);
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      try {
        await env.DB.prepare('SELECT 1').first();
        return json({ ok: true }, 200);
      } catch {
        return json({ ok: false }, 503);
      }
    }

    if (request.method === 'GET' && url.pathname === '/oauth/callback') {
      return new Response('ZRT amoCRM integration is active.', {
        status: 200,
        headers: securityHeaders('text/plain; charset=utf-8')
      });
    }

    if (url.pathname === STATS_API_PATH || url.pathname === STATS_EXPORT_PATH) {
      return handleStatisticsRequest(request, env, url);
    }

    const cors = corsHeaders(request, env.ALLOWED_ORIGIN);

    if (request.method === 'OPTIONS') {
      return request.headers.get('Origin') === env.ALLOWED_ORIGIN
        ? new Response(null, { status: 204, headers: cors })
        : json({ ok: false, code: 'origin_not_allowed' }, 403);
    }

    if (url.pathname !== '/v1/leads' || request.method !== 'POST') {
      return json({ ok: false, code: 'not_found' }, 404, cors);
    }

    if (request.headers.get('Origin') !== env.ALLOWED_ORIGIN) {
      return json({ ok: false, code: 'origin_not_allowed' }, 403, cors);
    }

    const contentType = request.headers.get('Content-Type') || '';
    if (!contentType.toLowerCase().startsWith('application/json')) {
      return json({ ok: false, code: 'invalid_content_type' }, 415, cors);
    }

    const contentLength = Number(request.headers.get('Content-Length') || 0);
    if (contentLength > MAX_BODY_BYTES) {
      return json({ ok: false, code: 'payload_too_large' }, 413, cors);
    }

    const clientKey = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rateLimit = await env.RATE_LIMITER.limit({ key: clientKey });
    if (!rateLimit.success) {
      return json(
        { ok: false, code: 'rate_limited' },
        429,
        { ...cors, 'Retry-After': String(RETRY_AFTER_SECONDS) }
      );
    }

    let rawPayload;
    try {
      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
        return json({ ok: false, code: 'payload_too_large' }, 413, cors);
      }
      rawPayload = JSON.parse(rawBody);
    } catch {
      return json({ ok: false, code: 'invalid_json' }, 400, cors);
    }

    const validation = validatePayload(rawPayload, env.ALLOWED_ORIGIN);
    if (!validation.ok) {
      return json({ ok: false, code: validation.code }, 400, cors);
    }

    const payload = validation.value;
    const journal = await reserveSubmission(env.DB, payload);

    if (journal.state === 'sent') {
      return json({ ok: true, duplicate: true }, 200, cors);
    }

    if (journal.state === 'processing') {
      return json({ ok: false, code: 'already_processing' }, 409, cors);
    }

    if (journal.state === 'unavailable') {
      return json({ ok: false, code: 'journal_unavailable' }, 503, cors);
    }

    if (!env.AMO_LONG_LIVED_TOKEN) {
      await markFailed(env.DB, payload.submissionId, journal.attemptNumber, 'amo_secret_missing');
      return json({ ok: false, code: 'service_not_configured' }, 503, cors);
    }

    let amoResult;
    try {
      amoResult = await createAmoLead(env, payload);
    } catch (error) {
      const errorCode = safeErrorCode(error);
      await markFailed(env.DB, payload.submissionId, journal.attemptNumber, errorCode);
      console.warn(JSON.stringify({ event: 'amo_lead_failed', submission_id: payload.submissionId, code: errorCode }));
      return json({ ok: false, code: 'crm_unavailable' }, 502, cors);
    }

    try {
      await markSent(env.DB, payload.submissionId, journal.attemptNumber, amoResult);
    } catch {
      console.error(JSON.stringify({ event: 'journal_finalize_failed', submission_id: payload.submissionId }));
    }

    let metrikaQueued = false;
    try {
      metrikaQueued = await enqueueMetrikaConversion(
        env.DB,
        payload,
        env.YANDEX_METRIKA_OFFLINE_GOAL || DEFAULT_METRIKA_TARGET
      );
    } catch {
      console.error(JSON.stringify({ event: 'metrika_enqueue_failed', submission_id: payload.submissionId }));
    }

    ctx.waitUntil(
      addAmoNote(env, amoResult.id, payload).catch(() => {
        console.warn(JSON.stringify({ event: 'amo_note_failed', submission_id: payload.submissionId }));
      })
    );

    if (metrikaQueued) {
      ctx.waitUntil(
        processMetrikaOutbox(env, 1).catch(() => {
          console.warn(JSON.stringify({ event: 'metrika_background_attempt_failed' }));
        })
      );
    }

    return json({ ok: true }, 200, cors);
  },

  async scheduled(_controller, env, ctx) {
    if (env.STATS_ONLY === 'true') return;
    ctx.waitUntil(processMetrikaOutbox(env, 25));
  }
};

async function handleStatisticsWorker(request, env, url) {
  if (url.pathname === STATS_API_PATH || url.pathname === STATS_EXPORT_PATH) {
    return handleStatisticsRequest(request, env, url);
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return statsJson({ ok: false, code: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
  }

  const assetPaths = new Set([
    '/index.html',
    '/statistics.css',
    '/statistics.js',
    '/assets/favicon.png',
    '/assets/zrt-logo.png'
  ]);
  const assetPath = url.pathname === '/' || url.pathname === '/statistics'
    ? '/index.html'
    : url.pathname;

  if (!assetPaths.has(assetPath) || !env.ASSETS) {
    return statsJson({ ok: false, code: 'not_found' }, 404);
  }

  const assetUrl = new URL(assetPath, url.origin);
  const assetRequest = new Request(assetUrl, request);
  const response = await env.ASSETS.fetch(assetRequest);
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  headers.set('Referrer-Policy', 'no-referrer');
  if (assetPath === '/index.html') {
    headers.set('Cache-Control', 'no-store');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function handleStatisticsRequest(request, env, url) {
  if (request.method !== 'GET') {
    return statsJson({ ok: false, code: 'method_not_allowed' }, 405, { Allow: 'GET' });
  }

  if (env.STATS_ONLY !== 'true') {
    const access = await authorizeStatisticsRequest(request, env);
    if (!access.ok) {
      return statsJson({ ok: false, code: access.code }, access.status);
    }
  }

  const parsed = parseStatisticsFilters(url);
  if (!parsed.ok) {
    return statsJson({ ok: false, code: parsed.code }, 400);
  }

  try {
    if (url.pathname === STATS_EXPORT_PATH) {
      return exportStatisticsCsv(env.DB, parsed.value);
    }

    const report = await queryStatistics(env.DB, parsed.value);
    return statsJson({
      ok: true,
      generated_at: new Date().toISOString(),
      period: { from: parsed.value.from, to: parsed.value.to },
      filters: {
        source: parsed.value.source,
        utm_source: parsed.value.utmSource,
        utm_campaign: parsed.value.utmCampaign
      },
      ...report
    }, 200);
  } catch (error) {
    console.error(JSON.stringify({ event: 'statistics_query_failed', message: safeLogMessage(error) }));
    return statsJson({ ok: false, code: 'statistics_unavailable' }, 503);
  }
}

async function authorizeStatisticsRequest(request, env) {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.ACCESS_ALLOWED_EMAIL) {
    return { ok: false, status: 503, code: 'access_not_configured' };
  }

  const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!assertion) return { ok: false, status: 401, code: 'access_required' };

  try {
    const claims = await verifyAccessJwt(assertion, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
    const allowedEmails = env.ACCESS_ALLOWED_EMAIL
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
    const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
    if (!email || !allowedEmails.includes(email)) {
      return { ok: false, status: 403, code: 'access_denied' };
    }
    return { ok: true };
  } catch (error) {
    console.warn(JSON.stringify({ event: 'statistics_access_rejected', message: safeLogMessage(error) }));
    return { ok: false, status: 401, code: 'access_invalid' };
  }
}

async function verifyAccessJwt(token, teamDomain, expectedAudience) {
  const segments = token.split('.');
  if (segments.length !== 3) throw new Error('invalid_jwt');

  const header = decodeJwtSegment(segments[0]);
  const claims = decodeJwtSegment(segments[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('invalid_jwt_header');

  const issuer = normalizeAccessIssuer(teamDomain);
  const keys = await getAccessJwks(issuer, false);
  let jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) {
    const refreshedKeys = await getAccessJwks(issuer, true);
    jwk = refreshedKeys.find((key) => key.kid === header.kid);
  }
  if (!jwk) throw new Error('unknown_jwt_key');

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const validSignature = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    decodeBase64Url(segments[2]),
    new TextEncoder().encode(`${segments[0]}.${segments[1]}`)
  );
  if (!validSignature) throw new Error('invalid_jwt_signature');

  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== issuer) throw new Error('invalid_jwt_issuer');
  if (!Number.isFinite(claims.exp) || claims.exp <= now) throw new Error('expired_jwt');
  if (Number.isFinite(claims.nbf) && claims.nbf > now + 30) throw new Error('early_jwt');
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(expectedAudience)) throw new Error('invalid_jwt_audience');

  return claims;
}

function normalizeAccessIssuer(teamDomain) {
  const hostname = teamDomain
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  if (!/^[a-z0-9.-]+\.cloudflareaccess\.com$/i.test(hostname)) {
    throw new Error('invalid_access_domain');
  }
  return `https://${hostname}`;
}

async function getAccessJwks(issuer, forceRefresh) {
  if (!forceRefresh && accessJwksCache?.issuer === issuer && accessJwksCache.expiresAt > Date.now()) {
    return accessJwksCache.keys;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${issuer}/cdn-cgi/access/certs`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) throw new Error('access_certs_unavailable');
    const body = await response.json();
    if (!Array.isArray(body.keys)) throw new Error('invalid_access_certs');
    accessJwksCache = { issuer, keys: body.keys, expiresAt: Date.now() + ACCESS_JWKS_TTL_MS };
    return body.keys;
  } finally {
    clearTimeout(timeoutId);
  }
}

function decodeJwtSegment(segment) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(segment)));
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function parseStatisticsFilters(url) {
  const today = moscowDateString();
  const to = url.searchParams.get('to') || today;
  const from = url.searchParams.get('from') || shiftDate(to, -29);
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) return { ok: false, code: 'invalid_period' };

  const fromDate = new Date(`${from}T00:00:00Z`);
  const toDate = new Date(`${to}T00:00:00Z`);
  const spanDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000);
  if (spanDays < 0 || spanDays > 3_660) return { ok: false, code: 'invalid_period' };

  const source = cleanFilterValue(url.searchParams.get('source'), 100);
  const utmSource = cleanFilterValue(url.searchParams.get('utm_source'), 300);
  const utmCampaign = cleanFilterValue(url.searchParams.get('utm_campaign'), 300);
  if (source === false || utmSource === false || utmCampaign === false) {
    return { ok: false, code: 'invalid_filter' };
  }

  return {
    ok: true,
    value: {
      from,
      to,
      fromUtc: new Date(`${from}T00:00:00+03:00`).toISOString(),
      toUtcExclusive: new Date(new Date(`${to}T00:00:00+03:00`).getTime() + 86_400_000).toISOString(),
      source,
      utmSource,
      utmCampaign
    }
  };
}

function cleanFilterValue(value, maxLength) {
  if (value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) return false;
  return value.trim();
}

function isValidIsoDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function moscowDateString(date = new Date()) {
  return new Date(date.getTime() + 10_800_000).toISOString().slice(0, 10);
}

function shiftDate(value, days) {
  if (!isValidIsoDate(value)) return '';
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildSubmissionFilter(alias, filters, attribution = true) {
  const clauses = [`${alias}.received_at >= ?`, `${alias}.received_at < ?`];
  const params = [filters.fromUtc, filters.toUtcExclusive];
  if (attribution && filters.source) {
    clauses.push(`${alias}.source = ?`);
    params.push(filters.source);
  }
  if (attribution && filters.utmSource) {
    clauses.push(`${alias}.utm_source = ?`);
    params.push(filters.utmSource);
  }
  if (attribution && filters.utmCampaign) {
    clauses.push(`${alias}.utm_campaign = ?`);
    params.push(filters.utmCampaign);
  }
  return { sql: clauses.join(' AND '), params };
}

async function queryStatistics(db, filters) {
  const submissionFilter = buildSubmissionFilter('s', filters);
  const optionFilter = buildSubmissionFilter('s', filters, false);

  const statements = [
    db.prepare(
      `SELECT
         COUNT(*) AS filled,
         COALESCE(SUM(CASE WHEN s.scenario = 'beginner' THEN 1 ELSE 0 END), 0) AS beginner,
         COALESCE(SUM(CASE WHEN s.scenario = 'experienced' THEN 1 ELSE 0 END), 0) AS experienced,
         COALESCE(SUM(CASE WHEN s.amo_lead_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS deals_created,
         COALESCE(SUM(CASE WHEN s.status = 'failed' THEN 1 ELSE 0 END), 0) AS failed_now
       FROM lead_submissions s
       WHERE ${submissionFilter.sql}`
    ).bind(...submissionFilter.params),
    db.prepare(
      `SELECT COUNT(*) AS error_events
       FROM lead_delivery_attempts e
       JOIN lead_submissions s ON s.submission_id = e.submission_id
       WHERE e.status = 'failed' AND ${submissionFilter.sql}`
    ).bind(...submissionFilter.params),
    db.prepare(
      `WITH submissions AS (
         SELECT
           substr(datetime(s.received_at, '+3 hours'), 1, 10) AS date,
           COUNT(*) AS filled,
           SUM(CASE WHEN s.amo_lead_id IS NOT NULL THEN 1 ELSE 0 END) AS deals
         FROM lead_submissions s
         WHERE ${submissionFilter.sql}
         GROUP BY date
       ), errors AS (
         SELECT
           substr(datetime(s.received_at, '+3 hours'), 1, 10) AS date,
           COUNT(*) AS errors
         FROM lead_delivery_attempts e
         JOIN lead_submissions s ON s.submission_id = e.submission_id
         WHERE e.status = 'failed' AND ${submissionFilter.sql}
         GROUP BY date
       )
       SELECT submissions.date, submissions.filled, submissions.deals, COALESCE(errors.errors, 0) AS errors
       FROM submissions
       LEFT JOIN errors ON errors.date = submissions.date
       ORDER BY submissions.date`
    ).bind(...submissionFilter.params, ...submissionFilter.params),
    db.prepare(
      `WITH submissions AS (
         SELECT
           s.source, s.utm_source, s.utm_medium, s.utm_campaign, s.utm_content, s.utm_term,
           COUNT(*) AS filled,
           SUM(CASE WHEN s.amo_lead_id IS NOT NULL THEN 1 ELSE 0 END) AS deals
         FROM lead_submissions s
         WHERE ${submissionFilter.sql}
         GROUP BY s.source, s.utm_source, s.utm_medium, s.utm_campaign, s.utm_content, s.utm_term
       ), errors AS (
         SELECT
           s.source, s.utm_source, s.utm_medium, s.utm_campaign, s.utm_content, s.utm_term,
           COUNT(*) AS errors
         FROM lead_delivery_attempts e
         JOIN lead_submissions s ON s.submission_id = e.submission_id
         WHERE e.status = 'failed' AND ${submissionFilter.sql}
         GROUP BY s.source, s.utm_source, s.utm_medium, s.utm_campaign, s.utm_content, s.utm_term
       )
       SELECT
         submissions.source,
         submissions.utm_source,
         submissions.utm_medium,
         submissions.utm_campaign,
         submissions.utm_content,
         submissions.utm_term,
         submissions.filled,
         submissions.deals,
         COALESCE(errors.errors, 0) AS errors
       FROM submissions
       LEFT JOIN errors ON
         errors.source IS submissions.source AND
         errors.utm_source IS submissions.utm_source AND
         errors.utm_medium IS submissions.utm_medium AND
         errors.utm_campaign IS submissions.utm_campaign AND
         errors.utm_content IS submissions.utm_content AND
         errors.utm_term IS submissions.utm_term
       ORDER BY submissions.filled DESC, submissions.source, submissions.utm_source
       LIMIT 200`
    ).bind(...submissionFilter.params, ...submissionFilter.params),
    db.prepare(
      `SELECT
         e.finished_at AS occurred_at,
         e.attempt_number,
         e.error_code,
         s.scenario,
         s.source,
         s.utm_source,
         s.utm_campaign,
         s.status AS current_status
       FROM lead_delivery_attempts e
       JOIN lead_submissions s ON s.submission_id = e.submission_id
       WHERE e.status = 'failed' AND ${submissionFilter.sql}
       ORDER BY e.id DESC
       LIMIT 100`
    ).bind(...submissionFilter.params),
    db.prepare(
      `SELECT
         s.received_at,
         s.scenario,
         s.source,
         s.page_path,
         s.contact_method,
         s.utm_source,
         s.utm_campaign,
         s.status,
         s.attempts,
         s.amo_lead_id,
         (SELECT COUNT(*) FROM lead_delivery_attempts e
          WHERE e.submission_id = s.submission_id AND e.status = 'failed') AS error_events
       FROM lead_submissions s
       WHERE ${submissionFilter.sql}
       ORDER BY s.received_at DESC
       LIMIT 100`
    ).bind(...submissionFilter.params),
    db.prepare(
      `SELECT DISTINCT s.source AS value
       FROM lead_submissions s
       WHERE ${optionFilter.sql} AND s.source != ''
       ORDER BY value`
    ).bind(...optionFilter.params),
    db.prepare(
      `SELECT DISTINCT s.utm_source AS value
       FROM lead_submissions s
       WHERE ${optionFilter.sql} AND s.utm_source IS NOT NULL AND s.utm_source != ''
       ORDER BY value`
    ).bind(...optionFilter.params),
    db.prepare(
      `SELECT DISTINCT s.utm_campaign AS value
       FROM lead_submissions s
       WHERE ${optionFilter.sql} AND s.utm_campaign IS NOT NULL AND s.utm_campaign != ''
       ORDER BY value`
    ).bind(...optionFilter.params)
  ];

  const results = await db.batch(statements);
  const totals = results[0].results?.[0] || {};
  totals.error_events = results[1].results?.[0]?.error_events || 0;

  return {
    totals,
    daily: results[2].results || [],
    sources: results[3].results || [],
    errors: results[4].results || [],
    submissions: results[5].results || [],
    options: {
      sources: optionValues(results[6]),
      utm_sources: optionValues(results[7]),
      utm_campaigns: optionValues(results[8])
    }
  };
}

function optionValues(result) {
  return (result.results || []).map((row) => row.value).filter((value) => typeof value === 'string');
}

function exportStatisticsCsv(db, filters) {
  const filter = buildSubmissionFilter('s', filters);
  const encoder = new TextEncoder();
  let offset = 0;
  let headerSent = false;
  let finished = false;

  const stream = new ReadableStream({
    async pull(controller) {
      if (finished) return;
      try {
        if (!headerSent) {
          controller.enqueue(encoder.encode(`\uFEFF${csvRow([
            'Дата и время (МСК)',
            'Сценарий',
            'Источник',
            'Страница',
            'Способ связи',
            'utm_source',
            'utm_medium',
            'utm_campaign',
            'utm_content',
            'utm_term',
            'Статус',
            'Попытки',
            'Сделка создана',
            'ID сделки amoCRM',
            'Ошибок отправки',
            'Последняя ошибка'
          ])}`));
          headerSent = true;
        }

        const result = await db.prepare(
          `SELECT
             s.received_at,
             s.scenario,
             s.source,
             s.page_path,
             s.contact_method,
             s.utm_source,
             s.utm_medium,
             s.utm_campaign,
             s.utm_content,
             s.utm_term,
             s.status,
             s.attempts,
             s.amo_lead_id,
             (SELECT COUNT(*) FROM lead_delivery_attempts e
              WHERE e.submission_id = s.submission_id AND e.status = 'failed') AS error_events,
             (SELECT e.error_code FROM lead_delivery_attempts e
              WHERE e.submission_id = s.submission_id AND e.status = 'failed'
              ORDER BY e.id DESC LIMIT 1) AS last_error_code
           FROM lead_submissions s
           WHERE ${filter.sql}
           ORDER BY s.received_at DESC
           LIMIT ? OFFSET ?`
        ).bind(...filter.params, CSV_PAGE_SIZE, offset).all();

        const rows = result.results || [];
        if (rows.length) {
          const chunk = rows.map((row) => csvRow([
            formatMoscowTimestamp(row.received_at),
            scenarioReportLabel(row.scenario),
            row.source,
            row.page_path,
            contactMethodLabel(row.contact_method),
            row.utm_source,
            row.utm_medium,
            row.utm_campaign,
            row.utm_content,
            row.utm_term,
            statusReportLabel(row.status),
            row.attempts,
            row.amo_lead_id ? 'Да' : 'Нет',
            row.amo_lead_id,
            row.error_events,
            row.last_error_code
          ])).join('');
          controller.enqueue(encoder.encode(chunk));
          offset += rows.length;
        }

        if (rows.length < CSV_PAGE_SIZE) {
          finished = true;
          controller.close();
        }
      } catch (error) {
        finished = true;
        controller.error(error);
      }
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...securityHeaders('text/csv; charset=utf-8'),
      'Content-Disposition': `attachment; filename="zrt-statistics-${filters.from}-${filters.to}.csv"`
    }
  });
}

function csvRow(values) {
  return `${values.map(csvValue).join(';')}\r\n`;
}

function csvValue(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function formatMoscowTimestamp(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp + 10_800_000).toISOString().slice(0, 16).replace('T', ' ');
}

function scenarioReportLabel(value) {
  return value === 'experienced' ? 'Уже катал' : 'Новичок';
}

function statusReportLabel(value) {
  return { sent: 'Создана сделка', failed: 'Ошибка', processing: 'Отправляется' }[value] || value;
}

function statsJson(body, status, extraHeaders = {}) {
  return Response.json(body, {
    status,
    headers: {
      ...securityHeaders('application/json; charset=utf-8'),
      ...extraHeaders
    }
  });
}

function securityHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY'
  };
}

function corsHeaders(request, allowedOrigin) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    Vary: 'Origin'
  };

  if (request.headers.get('Origin') === allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
  }

  return headers;
}

function json(body, status, extraHeaders = {}) {
  return Response.json(body, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders
    }
  });
}

function validatePayload(raw, allowedOrigin) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return invalid('invalid_payload');
  }

  const submissionId = cleanString(raw.submission_id, 36);
  if (!/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i.test(submissionId)) {
    return invalid('invalid_submission_id');
  }

  if (raw.form_id !== 'zrt-main-booking' || raw.source !== 'adv.zrt-school.ru') {
    return invalid('invalid_source');
  }

  let pageUrl;
  try {
    pageUrl = new URL(raw.page);
  } catch {
    return invalid('invalid_page');
  }
  if (pageUrl.origin !== allowedOrigin) return invalid('invalid_page');

  const scenario = cleanString(raw.scenario, 20).toLowerCase();
  const contactMethod = cleanString(raw.contact_method, 20).toLowerCase();
  if (!SCENARIOS.has(scenario)) return invalid('invalid_scenario');
  if (!CONTACT_METHODS.has(contactMethod)) return invalid('invalid_contact_method');
  if (raw.privacy_accepted !== true) return invalid('privacy_required');

  const name = cleanString(raw.name, 100);
  if ([...name].length < 2) return invalid('invalid_name');

  const phoneDigits = String(raw.phone || '').replace(/\D/g, '');
  if (!/^7\d{10}$/.test(phoneDigits)) return invalid('invalid_phone');

  const attribution = {};
  const rawAttribution = raw.attribution && typeof raw.attribution === 'object' && !Array.isArray(raw.attribution)
    ? raw.attribution
    : {};
  for (const key of ATTRIBUTION_KEYS) {
    attribution[key] = cleanNullableString(rawAttribution[key], 300);
  }

  const metrika = normalizeMetrikaIdentifiers(raw.metrika);

  return {
    ok: true,
    value: {
      submissionId,
      name,
      phone: `+${phoneDigits}`,
      source: 'adv.zrt-school.ru',
      pagePath: pageUrl.pathname.slice(0, 500),
      scenario,
      contactMethod,
      attribution,
      metrika
    }
  };
}

function invalid(code) {
  return { ok: false, code };
}

function cleanString(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function cleanNullableString(value, maxLength) {
  const cleaned = cleanString(value, maxLength);
  return cleaned || null;
}

function hasMetrikaIdentifiers(metrika) {
  return Boolean(metrika?.clientId || metrika?.yclid);
}

async function enqueueMetrikaConversion(db, payload, target) {
  if (!hasMetrikaIdentifiers(payload.metrika)) return false;

  const now = new Date();
  const nowIso = now.toISOString();
  const result = await db.prepare(
    `INSERT OR IGNORE INTO metrika_offline_conversions (
       submission_id, created_at, updated_at, conversion_at, target,
       client_id, yclid, status, attempts, next_attempt_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)`
  ).bind(
    payload.submissionId,
    nowIso,
    nowIso,
    Math.floor(now.getTime() / 1000),
    target,
    payload.metrika.clientId,
    payload.metrika.yclid,
    nowIso
  ).run();

  return result.meta?.changes === 1;
}

async function processMetrikaOutbox(env, limit) {
  if (!env.YANDEX_METRIKA_OAUTH_TOKEN) return 0;

  let processed = 0;
  for (let index = 0; index < limit; index += 1) {
    const conversion = await claimMetrikaConversion(env.DB);
    if (!conversion) break;

    const ageSeconds = Math.floor(Date.now() / 1000) - Number(conversion.conversion_at);
    if (!Number.isFinite(ageSeconds) || ageSeconds >= METRIKA_MATCH_WINDOW_SECONDS) {
      await markMetrikaConversionExpired(env.DB, conversion.submission_id);
      processed += 1;
      continue;
    }

    try {
      const result = await uploadMetrikaOfflineConversion(env, conversion);
      await markMetrikaConversionSent(env.DB, conversion.submission_id, result.uploadId);
      console.log(JSON.stringify({
        event: 'metrika_offline_uploaded',
        submission_id: conversion.submission_id,
        upload_id: result.uploadId
      }));
    } catch (error) {
      const code = safeMetrikaErrorCode(error);
      await releaseMetrikaConversion(env.DB, conversion, code);
      console.warn(JSON.stringify({
        event: 'metrika_offline_retry_scheduled',
        submission_id: conversion.submission_id,
        code
      }));
    }

    processed += 1;
  }

  return processed;
}

async function claimMetrikaConversion(db) {
  const now = new Date();
  const nowIso = now.toISOString();
  const candidate = await db.prepare(
    `SELECT submission_id, conversion_at, target, client_id, yclid, attempts
     FROM metrika_offline_conversions
     WHERE status IN ('pending', 'processing')
       AND next_attempt_at <= ?
     ORDER BY next_attempt_at, created_at
     LIMIT 1`
  ).bind(nowIso).first();

  if (!candidate) return null;

  const leaseUntil = new Date(now.getTime() + METRIKA_LEASE_MS).toISOString();
  const claim = await db.prepare(
    `UPDATE metrika_offline_conversions
     SET status = 'processing', attempts = attempts + 1,
         last_attempt_at = ?, next_attempt_at = ?, updated_at = ?
     WHERE submission_id = ?
       AND status IN ('pending', 'processing')
       AND next_attempt_at <= ?`
  ).bind(nowIso, leaseUntil, nowIso, candidate.submission_id, nowIso).run();

  if (claim.meta?.changes !== 1) return null;
  return {
    ...candidate,
    attempts: (Number(candidate.attempts) || 0) + 1
  };
}

async function markMetrikaConversionSent(db, submissionId, uploadId) {
  const nowIso = new Date().toISOString();
  await db.prepare(
    `UPDATE metrika_offline_conversions
     SET status = 'sent', updated_at = ?, sent_at = ?, upload_id = ?,
         error_code = NULL, next_attempt_at = NULL,
         client_id = NULL, yclid = NULL
     WHERE submission_id = ? AND status = 'processing'`
  ).bind(nowIso, nowIso, uploadId, submissionId).run();
}

async function markMetrikaConversionExpired(db, submissionId) {
  const nowIso = new Date().toISOString();
  await db.prepare(
    `UPDATE metrika_offline_conversions
     SET status = 'expired', updated_at = ?, error_code = 'matching_window_expired',
         next_attempt_at = NULL, client_id = NULL, yclid = NULL
     WHERE submission_id = ? AND status = 'processing'`
  ).bind(nowIso, submissionId).run();
}

async function releaseMetrikaConversion(db, conversion, code) {
  const now = new Date();
  const nextAttemptAt = new Date(
    now.getTime() + metrikaRetryDelaySeconds(conversion.attempts) * 1000
  ).toISOString();

  await db.prepare(
    `UPDATE metrika_offline_conversions
     SET status = 'pending', updated_at = ?, next_attempt_at = ?, error_code = ?
     WHERE submission_id = ? AND status = 'processing'`
  ).bind(now.toISOString(), nextAttemptAt, code, conversion.submission_id).run();
}

function safeMetrikaErrorCode(error) {
  const message = String(error?.message || '');
  return /^metrika_(?:http_\d{3}|timeout|invalid_response|response_too_large|identifier_missing|target_invalid|datetime_invalid|counter_invalid)$/.test(message)
    ? message
    : 'metrika_network_error';
}

async function reserveSubmission(db, payload) {
  const now = new Date();
  const nowIso = now.toISOString();

  try {
    const insert = await db.prepare(
      `INSERT OR IGNORE INTO lead_submissions (
         submission_id, received_at, updated_at, source, page_path, scenario,
         contact_method, utm_source, utm_medium, utm_campaign, utm_content,
         utm_term, status, attempts
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', 1)`
    )
      .bind(
        payload.submissionId,
        nowIso,
        nowIso,
        payload.source,
        payload.pagePath,
        payload.scenario,
        payload.contactMethod,
        payload.attribution.utm_source,
        payload.attribution.utm_medium,
        payload.attribution.utm_campaign,
        payload.attribution.utm_content,
        payload.attribution.utm_term
      )
      .run();

    if (insert.meta?.changes === 1) {
      await recordAttemptStarted(db, payload.submissionId, 1, nowIso);
      return { state: 'reserved', attemptNumber: 1 };
    }

    const existing = await db.prepare(
      'SELECT status, updated_at, attempts FROM lead_submissions WHERE submission_id = ?'
    ).bind(payload.submissionId).first();

    if (!existing) return { state: 'unavailable' };
    if (existing.status === 'sent') return { state: 'sent' };

    const updatedAt = Date.parse(existing.updated_at);
    const isStale = !Number.isFinite(updatedAt) || now.getTime() - updatedAt > PROCESSING_STALE_MS;
    if (existing.status === 'processing' && !isStale) return { state: 'processing' };

    const currentAttempts = Number(existing.attempts) || 1;
    const retry = await db.prepare(
      `UPDATE lead_submissions
       SET status = 'processing', updated_at = ?, attempts = attempts + 1, error_code = NULL
       WHERE submission_id = ? AND status != 'sent' AND attempts = ?`
    ).bind(nowIso, payload.submissionId, currentAttempts).run();

    if (retry.meta?.changes !== 1) return { state: 'processing' };
    const attemptNumber = currentAttempts + 1;
    await recordAttemptStarted(db, payload.submissionId, attemptNumber, nowIso);
    return { state: 'reserved', attemptNumber };
  } catch {
    return { state: 'unavailable' };
  }
}

async function recordAttemptStarted(db, submissionId, attemptNumber, attemptedAt) {
  try {
    await db.prepare(
      `INSERT OR IGNORE INTO lead_delivery_attempts (
         submission_id, attempt_number, attempted_at, status
       ) VALUES (?, ?, ?, 'processing')`
    ).bind(submissionId, attemptNumber, attemptedAt).run();
  } catch {
    console.error(JSON.stringify({ event: 'attempt_history_start_failed', submission_id: submissionId }));
  }
}

async function markFailed(db, submissionId, attemptNumber, code) {
  const nowIso = new Date().toISOString();
  try {
    await db.batch([
      db.prepare(
        `UPDATE lead_submissions
         SET status = 'failed', updated_at = ?, error_code = ?
         WHERE submission_id = ?`
      ).bind(nowIso, code, submissionId),
      db.prepare(
        `INSERT INTO lead_delivery_attempts (
           submission_id, attempt_number, attempted_at, finished_at, status, error_code
         ) VALUES (?, ?, ?, ?, 'failed', ?)
         ON CONFLICT(submission_id, attempt_number) DO UPDATE SET
           finished_at = excluded.finished_at,
           status = 'failed',
           error_code = excluded.error_code,
           amo_lead_id = NULL`
      ).bind(submissionId, attemptNumber, nowIso, nowIso, code)
    ]);
  } catch {
    console.error(JSON.stringify({ event: 'journal_failure_write_failed', submission_id: submissionId }));
  }
}

async function markSent(db, submissionId, attemptNumber, amoResult) {
  const nowIso = new Date().toISOString();
  await db.batch([
    db.prepare(
      `UPDATE lead_submissions
       SET status = 'sent', updated_at = ?, amo_lead_id = ?, amo_contact_id = ?,
           amo_merged = ?, error_code = NULL
       WHERE submission_id = ?`
    ).bind(nowIso, amoResult.id, amoResult.contactId, amoResult.merged ? 1 : 0, submissionId),
    db.prepare(
      `INSERT INTO lead_delivery_attempts (
         submission_id, attempt_number, attempted_at, finished_at, status, amo_lead_id
       ) VALUES (?, ?, ?, ?, 'sent', ?)
       ON CONFLICT(submission_id, attempt_number) DO UPDATE SET
         finished_at = excluded.finished_at,
         status = 'sent',
         error_code = NULL,
         amo_lead_id = excluded.amo_lead_id`
    ).bind(submissionId, attemptNumber, nowIso, nowIso, amoResult.id)
  ]);
}

async function createAmoLead(env, payload) {
  const response = await amoFetch(env, '/api/v4/leads/complex', {
    method: 'POST',
    body: JSON.stringify([
      {
        name: `Заявка с рекламы ZRT — ${scenarioLabel(payload.scenario)}`,
        created_by: 0,
        pipeline_id: Number(env.AMO_PIPELINE_ID),
        status_id: Number(env.AMO_UNSORTED_STATUS_ID),
        request_id: payload.submissionId,
        _embedded: {
          metadata: {
            category: 'forms',
            form_id: 'zrt-main-booking',
            form_name: 'Запись на тренировку ZRT',
            form_page: `${env.ALLOWED_ORIGIN}${payload.pagePath}`,
            form_sent_at: Math.floor(Date.now() / 1000)
          },
          tags: buildAmoLeadTags(scenarioLabel(payload.scenario)),
          contacts: [
            {
              first_name: payload.name,
              custom_fields_values: [
                {
                  field_code: 'PHONE',
                  values: [{ value: payload.phone, enum_code: 'WORK' }]
                }
              ]
            }
          ]
        }
      }
    ])
  });

  if (!response.ok) throw new Error(`amo_http_${response.status}`);

  const result = await response.json();
  const lead = Array.isArray(result) ? result[0] : null;
  if (!lead || !Number.isInteger(lead.id)) throw new Error('amo_invalid_response');

  return {
    id: lead.id,
    contactId: Number.isInteger(lead.contact_id) ? lead.contact_id : null,
    merged: lead.merged === true
  };
}

async function addAmoNote(env, leadId, payload) {
  const attributionLines = ATTRIBUTION_KEYS
    .filter((key) => payload.attribution[key])
    .map((key) => `${key}: ${payload.attribution[key]}`);

  const lines = [
    `Предпочтительный способ связи: ${contactMethodLabel(payload.contactMethod)}`,
    `Сценарий: ${scenarioLabel(payload.scenario)}`,
    `Страница: ${payload.pagePath}`,
    `ID заявки: ${payload.submissionId}`
  ];

  if (attributionLines.length) lines.push('', 'Рекламные метки:', ...attributionLines);

  const response = await amoFetch(env, `/api/v4/leads/${leadId}/notes`, {
    method: 'POST',
    body: JSON.stringify([
      {
        note_type: 'common',
        params: { text: lines.join('\n') }
      }
    ])
  });

  if (!response.ok) throw new Error(`amo_note_http_${response.status}`);
}

async function amoFetch(env, path, init) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12_000);

  try {
    return await fetch(`${env.AMO_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${env.AMO_LONG_LIVED_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function safeErrorCode(error) {
  if (error?.name === 'AbortError') return 'amo_timeout';
  const message = String(error?.message || '');
  return /^amo_(?:http_\d{3}|invalid_response)$/.test(message) ? message : 'amo_network_error';
}

function safeLogMessage(error) {
  return String(error?.message || 'unknown_error').slice(0, 160);
}

function scenarioLabel(value) {
  return value === 'experienced' ? 'есть опыт' : 'новичок';
}

function contactMethodLabel(value) {
  return {
    telegram: 'Telegram',
    whatsapp: 'WhatsApp',
    max: 'MAX',
    phone: 'звонок'
  }[value] || value;
}
