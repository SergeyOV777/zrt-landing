import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMetrikaOfflineCsv,
  metrikaRetryDelaySeconds,
  normalizeMetrikaIdentifiers,
  uploadMetrikaOfflineConversion
} from '../src/metrika-offline.mjs';

test('normalizes only safe anonymous Metrika identifiers', () => {
  assert.deepEqual(
    normalizeMetrikaIdentifiers({ client_id: ' 123456 ', yclid: 'abc_DEF-789' }),
    { clientId: '123456', yclid: 'abc_DEF-789' }
  );
  assert.deepEqual(
    normalizeMetrikaIdentifiers({ client_id: 'not valid!', yclid: '<script>' }),
    { clientId: null, yclid: null }
  );
});

test('builds the official Target and DateTime CSV with ClientId and Yclid', () => {
  const csv = buildMetrikaOfflineCsv({
    client_id: '123456',
    yclid: 'direct-click-789',
    target: 'lead_created_crm',
    conversion_at: 1786700000
  });

  assert.equal(
    csv,
    'ClientId,Yclid,Target,DateTime\n"123456","direct-click-789","lead_created_crm","1786700000"\n'
  );
});

test('uses an exact stable row for retries', () => {
  const conversion = {
    client_id: '123456',
    yclid: null,
    target: 'lead_created_crm',
    conversion_at: 1786700000
  };

  assert.equal(buildMetrikaOfflineCsv(conversion), buildMetrikaOfflineCsv(conversion));
  assert.equal(metrikaRetryDelaySeconds(1), 60);
  assert.equal(metrikaRetryDelaySeconds(20), 21600);
});

test('uploads multipart CSV to the official endpoint without exposing the token in the URL', async () => {
  let captured;
  const fetchStub = async (url, init) => {
    captured = {
      url,
      init,
      csv: await init.body.get('file').text()
    };
    return Response.json({ uploading: { id: 42 } });
  };

  const result = await uploadMetrikaOfflineConversion(
    {
      YANDEX_METRIKA_COUNTER_ID: '32428555',
      YANDEX_METRIKA_OAUTH_TOKEN: 'secret-for-test'
    },
    {
      client_id: '123456',
      yclid: null,
      target: 'lead_created_crm',
      conversion_at: 1786700000
    },
    fetchStub
  );

  assert.deepEqual(result, { uploadId: 42 });
  assert.equal(
    captured.url,
    'https://api-metrika.yandex.net/management/v1/counter/32428555/offline_conversions/upload'
  );
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers.Authorization, 'OAuth secret-for-test');
  assert.equal(captured.url.includes('secret-for-test'), false);
  assert.match(captured.csv, /lead_created_crm/);
});

test('turns a Yandex outage into a retryable error', async () => {
  await assert.rejects(
    uploadMetrikaOfflineConversion(
      {
        YANDEX_METRIKA_COUNTER_ID: '32428555',
        YANDEX_METRIKA_OAUTH_TOKEN: 'secret-for-test'
      },
      {
        client_id: '123456',
        target: 'lead_created_crm',
        conversion_at: 1786700000
      },
      async () => new Response('temporarily unavailable', { status: 503 })
    ),
    /metrika_http_503/
  );
});
