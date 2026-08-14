import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));

test('applies every D1 migration and creates the anonymous Metrika outbox', () => {
  const database = new DatabaseSync(':memory:');
  const migrations = readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const migration of migrations) {
    database.exec(readFileSync(`${migrationsDirectory}/${migration}`, 'utf8'));
  }

  const columns = database.prepare('PRAGMA table_info(metrika_offline_conversions)').all();
  const columnNames = columns.map(({ name }) => name);
  assert.equal(columnNames.includes('client_id'), true);
  assert.equal(columnNames.includes('yclid'), true);
  assert.equal(columnNames.includes('upload_id'), true);
  assert.equal(columnNames.includes('name'), false);
  assert.equal(columnNames.includes('phone'), false);

  database.prepare(
    `INSERT INTO metrika_offline_conversions (
       submission_id, created_at, updated_at, conversion_at, target,
       client_id, yclid, status, attempts, next_attempt_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)`
  ).run(
    '11111111-1111-4111-8111-111111111111',
    '2026-08-14T00:00:00.000Z',
    '2026-08-14T00:00:00.000Z',
    1786665600,
    'lead_created_crm',
    '123456',
    'direct-click-1',
    '2026-08-14T00:00:00.000Z'
  );

  const row = database.prepare(
    'SELECT status, attempts, client_id, yclid FROM metrika_offline_conversions'
  ).get();
  assert.deepEqual({ ...row }, {
    status: 'pending',
    attempts: 0,
    client_id: '123456',
    yclid: 'direct-click-1'
  });

  database.close();
});
