import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { DEFAULT_ENDPOINTS, create } = require('../../site/lead-delivery.js');

function jsonResponse(body, status = 200) {
  return Response.json(body, { status });
}

function createBrowser(fetchImpl) {
  return {
    document: {},
    AbortController,
    fetch: fetchImpl,
    setTimeout(callback, delayMs) {
      const timer = { cancelled: false };
      if (delayMs < 5_000) {
        queueMicrotask(() => {
          if (!timer.cancelled) callback();
        });
      }
      return timer;
    },
    clearTimeout(timer) {
      timer.cancelled = true;
    }
  };
}

test('retries the production receiver without changing the submission endpoint', () => {
  assert.match(DEFAULT_ENDPOINTS[0].url, /\.workers\.dev\/v1\/leads$/);
  assert.equal(DEFAULT_ENDPOINTS[1].url, DEFAULT_ENDPOINTS[0].url);
  assert.ok(DEFAULT_ENDPOINTS[1].timeoutMs > DEFAULT_ENDPOINTS[0].timeoutMs);
});

test('uses the first-party endpoint and falls back with the same submission body', async () => {
  const calls = [];
  const browser = createBrowser(async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) throw new TypeError('network failure');
    return jsonResponse({ ok: true });
  });
  const delivery = create(browser, {
    endpoints: [
      { url: 'https://api.example.test/v1/leads', timeoutMs: 10_000 },
      { url: 'https://fallback.example.test/v1/leads', timeoutMs: 10_000 }
    ]
  });

  await delivery.send({ submission_id: 'same-id', name: 'Ирина' });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api.example.test/v1/leads');
  assert.equal(calls[1].url, 'https://fallback.example.test/v1/leads');
  assert.equal(calls[0].init.body, calls[1].init.body);
  assert.equal(calls[0].init.keepalive, true);
});

test('falls back after a retryable server response', async () => {
  let calls = 0;
  const delivery = create(createBrowser(async () => {
    calls += 1;
    return calls === 1
      ? jsonResponse({ ok: false, code: 'statistics_unavailable' }, 503)
      : jsonResponse({ ok: true });
  }), {
    endpoints: [
      { url: 'https://primary.example.test', timeoutMs: 10_000 },
      { url: 'https://fallback.example.test', timeoutMs: 10_000 }
    ]
  });

  await delivery.send({ submission_id: 'same-id' });
  assert.equal(calls, 2);
});

test('does not hide a rate-limit rejection behind another endpoint', async () => {
  let calls = 0;
  const delivery = create(createBrowser(async () => {
    calls += 1;
    return jsonResponse({ ok: false, code: 'rate_limited' }, 429);
  }), {
    endpoints: [
      { url: 'https://primary.example.test', timeoutMs: 10_000 },
      { url: 'https://fallback.example.test', timeoutMs: 10_000 }
    ]
  });

  await assert.rejects(
    delivery.send({ submission_id: 'same-id' }),
    (error) => error.code === 'rate_limited' && error.status === 429
  );
  assert.equal(calls, 1);
});

test('waits for an in-flight copy instead of creating a second submission', async () => {
  let calls = 0;
  const delivery = create(createBrowser(async () => {
    calls += 1;
    return calls === 1
      ? jsonResponse({ ok: false, code: 'already_processing' }, 409)
      : jsonResponse({ ok: true, duplicate: true });
  }), {
    endpoints: [{ url: 'https://primary.example.test', timeoutMs: 10_000 }]
  });

  const result = await delivery.send({ submission_id: 'same-id' });
  assert.equal(result.duplicate, true);
  assert.equal(calls, 2);
});
