import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { cleanIdentifier, create, parseStoredYclid } = require('../../site/lead-identifiers.js');

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    }
  };
}

test('accepts Yandex identifiers and rejects injected values', () => {
  assert.equal(cleanIdentifier(' 123_abc-456 '), '123_abc-456');
  assert.equal(cleanIdentifier('<script>'), null);
  assert.equal(cleanIdentifier('with space'), null);
});

test('expires a stored yclid after the 21-day matching window', () => {
  const now = Date.UTC(2026, 7, 14);
  const fresh = JSON.stringify({ value: 'click-1', captured_at: now - 20 * 24 * 60 * 60 * 1000 });
  const expired = JSON.stringify({ value: 'click-1', captured_at: now - 22 * 24 * 60 * 60 * 1000 });

  assert.equal(parseStoredYclid(fresh, now), 'click-1');
  assert.equal(parseStoredYclid(expired, now), null);
});

test('captures yclid from the landing URL and ClientID from the Metrika API', async () => {
  const localStorage = createStorage();
  const browser = {
    document: {},
    location: { search: '?yclid=direct-click-1' },
    localStorage,
    setTimeout,
    clearTimeout,
    ym(counterId, method, callback) {
      assert.equal(counterId, 32428555);
      assert.equal(method, 'getClientID');
      callback('987654321');
    }
  };

  const identifiers = await create(browser).get();
  assert.deepEqual(identifiers, {
    client_id: '987654321',
    yclid: 'direct-click-1'
  });

  browser.location.search = '';
  assert.equal((await create(browser).get()).yclid, 'direct-click-1');
});

test('keeps identifiers optional when the Metrika script is unavailable', async () => {
  const browser = {
    document: {},
    location: { search: '?yclid=direct-click-2' },
    localStorage: createStorage(),
    setTimeout,
    clearTimeout,
    ym() {
      throw new Error('blocked');
    }
  };

  assert.deepEqual(await create(browser).get(), {
    client_id: null,
    yclid: 'direct-click-2'
  });
});
