import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/index.js';

const SUBMISSION_ID = '7ff6e143-c4ce-4b56-a77e-3f5f3319ddbf';

function validRequest() {
  return new Request('https://worker.example.test/v1/leads', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://adv.zrt-school.ru',
      'CF-Connecting-IP': '203.0.113.10'
    },
    body: JSON.stringify({
      submission_id: SUBMISSION_ID,
      form_id: 'zrt-main-booking',
      source: 'adv.zrt-school.ru',
      page: 'https://adv.zrt-school.ru/',
      scenario: 'beginner',
      name: 'Ирина',
      phone: '+79162117182',
      contact_method: 'max',
      privacy_accepted: true,
      attribution: {},
      metrika: {}
    })
  });
}

function createDb(timeline, { existingStatus = null } = {}) {
  return {
    prepare(sql) {
      const statement = {
        sql,
        params: [],
        bind(...params) {
          this.params = params;
          return this;
        },
        async run() {
          if (sql.includes('INSERT OR IGNORE INTO lead_submissions')) {
            timeline.push('journal_reserved');
            return { meta: { changes: existingStatus ? 0 : 1 } };
          }
          if (sql.includes('INSERT OR IGNORE INTO lead_delivery_attempts')) {
            timeline.push('attempt_started');
          }
          return { meta: { changes: 1 } };
        },
        async first() {
          if (sql.includes('SELECT status, updated_at, attempts FROM lead_submissions')) {
            return existingStatus
              ? { status: existingStatus, updated_at: new Date().toISOString(), attempts: 1 }
              : null;
          }
          return null;
        }
      };
      return statement;
    },
    async batch(statements) {
      timeline.push('failure_recorded');
      assert.equal(statements.length, 2);
      assert.match(statements[0].sql, /SET status = 'failed'/);
      assert.match(statements[1].sql, /lead_delivery_attempts/);
      assert.ok(statements[0].params.includes('rate_limited'));
      return statements.map(() => ({ success: true }));
    }
  };
}

test('records a valid rate-limited form submission before returning 429', async () => {
  const timeline = [];
  const env = {
    ALLOWED_ORIGIN: 'https://adv.zrt-school.ru',
    DB: createDb(timeline),
    RATE_LIMITER: {
      async limit() {
        timeline.push('rate_checked');
        return { success: false };
      }
    }
  };

  const response = await worker.fetch(validRequest(), env, { waitUntil() {} });

  assert.equal(response.status, 429);
  assert.equal((await response.json()).code, 'rate_limited');
  assert.deepEqual(timeline, [
    'journal_reserved',
    'attempt_started',
    'rate_checked',
    'failure_recorded'
  ]);
});

test('returns a completed duplicate before consuming another rate-limit slot', async () => {
  const timeline = [];
  const env = {
    ALLOWED_ORIGIN: 'https://adv.zrt-school.ru',
    DB: createDb(timeline, { existingStatus: 'sent' }),
    RATE_LIMITER: {
      async limit() {
        throw new Error('rate limiter must not run for a sent duplicate');
      }
    }
  };

  const response = await worker.fetch(validRequest(), env, { waitUntil() {} });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, duplicate: true });
  assert.deepEqual(timeline, ['journal_reserved']);
});
