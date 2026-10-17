import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { emptyData, markPlanDeleted, tripData, timelineItems, localDate } from '../src/model.js';
import { validateData, validateEnvelope, isDate, isTimestamp, DataError } from '../src/validation.js';

const sample = JSON.parse(await readFile(new URL('../samples/hokkaido-2026.sample.json', import.meta.url), 'utf8'));
const fresh = () => structuredClone(sample.data);

test('サンプル全件がスキーマと参照整合性を満たす', () => {
  assert.equal(validateEnvelope(sample).plans.length, 8);
  assert.equal(validateData(emptyData()).trips.length, 0);
});
test('空データは独立した配列を返す', () => {
  const first = emptyData(); first.trips.push({ id: 'x' });
  assert.equal(emptyData().trips.length, 0);
});
test('未知のスキーマ、他アプリ、書出日時不正を拒否', () => {
  for (const change of [{ schemaVersion: '9.0' }, { appId: 'other' }, { exportedAt: '2026-02-30T10:00:00+09:00' }]) assert.throws(() => validateEnvelope({ ...sample, ...change }), DataError);
});
test('無効なタイムゾーンを検証エラーとして拒否', () => {
  const data = fresh(); data.trips[0].timeZone = 'Invalid/Timezone';
  assert.throws(() => validateData(data), error => error instanceof DataError && /タイムゾーン/.test(error.message));
});
test('旅程形式に実績を混入できず、訪問記録なしの旅程を扱える', () => {
  assert.throws(() => validateEnvelope({ ...sample, kind: 'itinerary' }), /旅程JSON/);
  const data = fresh(); delete data.visits;
  assert.deepEqual(validateEnvelope({ ...sample, kind: 'itinerary', data }).visits, []);
});
test('異なるコレクション間でもID重複を拒否', () => {
  const data = fresh(); data.visits[0].id = data.plans[0].id;
  assert.throws(() => validateData(data), /重複/);
});
test('存在しない予定・旅行・日別の参照を拒否', () => {
  for (const mutate of [data => { data.visits[0].planId = 'missing'; }, data => { data.days[0].tripId = 'missing'; }, data => { data.plans[0].dayId = 'missing'; }]) {
    const data = fresh(); mutate(data); assert.throws(() => validateData(data), DataError);
  }
});
test('日付・時刻の繰り上がりとタイムゾーン省略を拒否', () => {
  assert.equal(isDate('2026-02-30'), false);
  assert.equal(isTimestamp('2026-10-30T25:00:00+09:00'), false);
  assert.equal(isTimestamp('2026-10-30T10:00:00'), false);
  assert.equal(isDate('2028-02-29'), true);
});
test('座標範囲、GPS精度不足、位置取得方法との矛盾を拒否', () => {
  for (const mutate of [data => { data.visits[0].location.latitude = 91; }, data => { data.visits[0].locationSource = 'gps'; }, data => { data.visits[0].locationSource = 'none'; }]) {
    const data = fresh(); mutate(data); assert.throws(() => validateData(data), DataError);
  }
});
test('日付不整合・旅行期間外・日別重複を拒否', () => {
  for (const mutate of [data => { data.plans[0].startAt = '2026-10-31T11:00:00+09:00'; }, data => { data.days[0].date = '2026-10-29'; }, data => { data.days[1].date = data.days[0].date; }]) {
    const data = fresh(); mutate(data); assert.throws(() => validateData(data), DataError);
  }
});
test('予定を削除済みにしても、参照と訪問時の名称・メモ・座標を維持', () => {
  const data = fresh(); const before = structuredClone(data.visits);
  const result = markPlanDeleted(data, 'sample-plan-odori');
  assert.deepEqual(result.visits, before);
  assert.equal(data.plans[1].deletedAt, null);
  assert.ok(result.plans[1].deletedAt);
  validateData(result);
  const rows = timelineItems(result, '2026-10-30', 'Asia/Tokyo');
  assert.ok(rows.some(row => row.plan === null && row.visits[0].id === 'sample-visit-odori'));
});
test('予定からの訪問をまとめ、予定外の訪問は時刻順に配置', () => {
  const first = timelineItems(fresh(), '2026-10-30', 'Asia/Tokyo');
  assert.equal(first.length, 3);
  assert.equal(first[1].visits[0].name, '大通公園');
  const second = timelineItems(fresh(), '2026-10-31', 'Asia/Tokyo');
  assert.equal(second.length, 4);
  assert.equal(second[1].plan, null);
  assert.equal(second[1].visits[0].planId, null);
});
test('旅行のタイムゾーンで日付を判定し、旅行単位で抽出', () => {
  assert.equal(localDate('2026-10-29T16:00:00Z', 'Asia/Tokyo'), '2026-10-30');
  assert.equal(tripData(fresh(), 'missing').visits.length, 0);
});
