const MAX_RESPONSE_BYTES = 65_536;
const UPLOAD_TIMEOUT_MS = 12_000;

export const DEFAULT_METRIKA_COUNTER_ID = '32428555';
export const DEFAULT_METRIKA_TARGET = 'lead_created_crm';

export function cleanMetrikaIdentifier(value, maxLength = 200) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maxLength) return null;
  return /^[A-Za-z0-9_-]+$/.test(cleaned) ? cleaned : null;
}

export function normalizeMetrikaIdentifiers(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    clientId: cleanMetrikaIdentifier(source.client_id),
    yclid: cleanMetrikaIdentifier(source.yclid)
  };
}

function csvValue(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildMetrikaOfflineCsv(conversion) {
  const clientId = cleanMetrikaIdentifier(conversion.client_id ?? conversion.clientId);
  const yclid = cleanMetrikaIdentifier(conversion.yclid);
  const target = cleanMetrikaIdentifier(conversion.target, 100);
  const conversionAt = Number(conversion.conversion_at ?? conversion.conversionAt);

  if (!clientId && !yclid) throw new Error('metrika_identifier_missing');
  if (!target) throw new Error('metrika_target_invalid');
  if (!Number.isInteger(conversionAt) || conversionAt <= 0) {
    throw new Error('metrika_datetime_invalid');
  }

  const headers = [];
  const values = [];
  if (clientId) {
    headers.push('ClientId');
    values.push(clientId);
  }
  if (yclid) {
    headers.push('Yclid');
    values.push(yclid);
  }
  headers.push('Target', 'DateTime');
  values.push(target, conversionAt);

  return `${headers.join(',')}\n${values.map(csvValue).join(',')}\n`;
}

export function metrikaRetryDelaySeconds(attemptNumber) {
  const attempt = Math.max(1, Number(attemptNumber) || 1);
  return Math.min(6 * 60 * 60, 60 * (2 ** Math.min(attempt - 1, 9)));
}

async function readSmallJson(response) {
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('metrika_response_too_large');
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('metrika_invalid_response');
  }
}

export async function uploadMetrikaOfflineConversion(env, conversion, fetchImpl = fetch) {
  const counterId = cleanMetrikaIdentifier(
    env.YANDEX_METRIKA_COUNTER_ID || DEFAULT_METRIKA_COUNTER_ID,
    20
  );
  if (!counterId) throw new Error('metrika_counter_invalid');
  if (!env.YANDEX_METRIKA_OAUTH_TOKEN) throw new Error('metrika_secret_missing');

  const csv = buildMetrikaOfflineCsv(conversion);
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv;charset=UTF-8' }), 'offline-conversion.csv');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  try {
    const response = await fetchImpl(
      `https://api-metrika.yandex.net/management/v1/counter/${counterId}/offline_conversions/upload`,
      {
        method: 'POST',
        headers: {
          Authorization: `OAuth ${env.YANDEX_METRIKA_OAUTH_TOKEN}`,
          Accept: 'application/json'
        },
        body: form,
        signal: controller.signal
      }
    );

    if (!response.ok) throw new Error(`metrika_http_${response.status}`);
    const result = await readSmallJson(response);
    const uploadId = Number(result?.uploading?.id);
    if (!Number.isInteger(uploadId) || uploadId < 0) {
      throw new Error('metrika_invalid_response');
    }

    return { uploadId };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('metrika_timeout');
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
