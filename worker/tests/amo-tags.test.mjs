import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAmoLeadTags } from '../src/amo-tags.mjs';

test('adds both campaign tags without removing the current beginner tags', () => {
  assert.deepEqual(
    buildAmoLeadTags('Новичок').map(({ name }) => name),
    [
      'adv.zrt-school.ru',
      'Форма: Новичок',
      '1000оффер',
      'Директ_РСЯ_Лендинги'
    ]
  );
});

test('keeps the dynamic form tag for the experienced scenario', () => {
  assert.deepEqual(
    buildAmoLeadTags('Уже катал').map(({ name }) => name),
    [
      'adv.zrt-school.ru',
      'Форма: Уже катал',
      '1000оффер',
      'Директ_РСЯ_Лендинги'
    ]
  );
});
