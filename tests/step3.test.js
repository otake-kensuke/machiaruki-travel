import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { emptyData } from '../src/model.js';
import { validateData, DataError } from '../src/validation.js';
import { parseItinerary, MAX_IMPORT_BYTES } from '../src/transfer.js';
import { applyPlanSave, applyPlanDelete, planTimestamp } from '../src/plans.js';

const sample = JSON.parse(await readFile(new URL('../samples/hokkaido-2026.sample.json', import.meta.url), 'utf8'));
const itineraryText = await readFile(new URL('../samples/hokkaido-2026.itinerary.json', import.meta.url), 'utf8');
const itinerary = JSON.parse(itineraryText);
const fresh = () => structuredClone(sample.data);
const input = (extra = {}) => ({ tripId: sample.data.trips[0].id, name: '新しい予定', date: '2026-10-30', time: '15:30', category: '散策', address: '', memo: '', location: null, ...extra });

test('旅程JSONを検証して実績なしの追加候補を作る（BOMも許容）', () => {
  const data = parseItinerary('\uFEFF' + itineraryText, emptyData());
  assert.equal(data.plans.length, 8);
  assert.deepEqual(data.visits, []);
});
test('構文・kind・バージョン・必須配列が不正な旅程を拒否', () => {
  for (const text of ['{', 'null', JSON.stringify(sample), JSON.stringify({ ...itinerary, schemaVersion: '2' }), JSON.stringify({ ...itinerary, data: {} })]) assert.throws(() => parseItinerary(text, emptyData()), DataError);
});
test('空の旅行と2MiBを超えるファイルを拒否', () => {
  const empty = { ...itinerary, data: emptyData() }; delete empty.data.visits;
  assert.throws(() => parseItinerary(JSON.stringify(empty), emptyData()), /旅行がありません/);
  assert.throws(() => parseItinerary(' '.repeat(MAX_IMPORT_BYTES + 1), emptyData()), /2 MiB/);
});
test('既存ID衝突・ファイル内重複・不正参照で既存の実績を変えない', () => {
  const data = fresh(); const before = structuredClone(data);
  assert.throws(() => parseItinerary(itineraryText, data), /重複/);
  for (const mutate of [value => { value.data.plans[0].id = value.data.trips[0].id; }, value => { value.data.plans[0].dayId = 'missing'; }]) {
    const value = structuredClone(itinerary); mutate(value);
    assert.throws(() => parseItinerary(JSON.stringify(value), emptyData()), DataError);
  }
  assert.deepEqual(data, before);
});
test('住所の型・更新日時・旅行期間外の日付を検証', () => {
  for (const mutate of [data => { data.plans[0].address = {}; }, data => { data.plans[0].updatedAt = '2020-01-01T00:00:00Z'; }, data => { data.days[0].date = '2026-10-29'; }]) {
    const data = fresh(); mutate(data); assert.throws(() => validateData(data), DataError);
  }
});
test('予定追加では新しいIDと作成・更新日時を持つ', () => {
  const data = fresh(); const result = applyPlanSave(data, input());
  const created = result.plans.at(-1);
  assert.equal(result.plans.length, data.plans.length + 1);
  assert.ok(!data.plans.some(plan => plan.id === created.id));
  assert.equal(created.createdAt, created.updatedAt);
  assert.equal(created.startAt, '2026-10-30T06:30:00.000Z');
  assert.deepEqual(result.visits, data.visits);
});
test('編集時にID・createdAt・訪問記録・地点を維持しupdatedAtを更新', () => {
  const data = fresh(); const plan = data.plans[1];
  const result = applyPlanSave(data, input({ name: '名前を変更', time: '14:00', location: plan.location, id: 'ignored', createdAt: 'ignored' }), { planId: plan.id, expectedPlan: plan });
  const updated = result.plans[1];
  assert.equal(updated.id, plan.id); assert.equal(updated.createdAt, plan.createdAt);
  assert.ok(Date.parse(updated.updatedAt) > Date.parse(plan.updatedAt));
  assert.equal(updated.startAt, plan.startAt);
  assert.deepEqual(result.visits, data.visits);
  assert.deepEqual(data.plans[1], plan);
});
test('日付変更は新しい日別を必要なら作成し、参照する訪問は元のまま', () => {
  const data = fresh(); const plan = data.plans[1];
  data.days = data.days.filter(day => day.date !== '2026-11-01');
  data.plans = data.plans.filter(row => row.dayId !== 'sample-day-1101');
  const result = applyPlanSave(data, input({ date: '2026-11-01' }), { planId: plan.id, expectedPlan: plan });
  const updated = result.plans.find(row => row.id === plan.id);
  assert.equal(result.days.find(day => day.id === updated.dayId).date, '2026-11-01');
  assert.equal(result.days.length, 3);
  assert.deepEqual(result.visits, data.visits);
});
test('時刻未定と旅行タイムゾーンを扱い、夏時間の曖昧な時刻を拒否', () => {
  assert.equal(planTimestamp('2026-10-30', '', 'Asia/Tokyo'), null);
  assert.equal(planTimestamp('2026-10-30', '09:00', 'Asia/Tokyo'), '2026-10-30T00:00:00.000Z');
  assert.equal(planTimestamp('2026-01-01', '09:00', 'America/New_York'), '2026-01-01T14:00:00.000Z');
  assert.throws(() => planTimestamp('2026-03-08', '02:30', 'America/New_York'), /夏時間/);
  assert.throws(() => planTimestamp('2026-11-01', '01:30', 'America/New_York'), /夏時間/);
});
test('不正な編集・旅行IDの変更を拒否し元データは不変', () => {
  const data = fresh(); const before = structuredClone(data); const plan = data.plans[1];
  for (const edit of [{ name: '   ' }, { date: '2026-10-29' }, { time: '25:00' }, { tripId: 'other' }, { location: { latitude: 91, longitude: 140 } }]) assert.throws(() => applyPlanSave(data, input(edit), { planId: plan.id, expectedPlan: plan }), DataError);
  assert.deepEqual(data, before);
});
test('削除後もID・作成日時・全訪問記録・参照を保持', () => {
  const data = fresh(); const plan = data.plans[1];
  const result = applyPlanDelete(data, plan.id, plan);
  assert.equal(result.plans.length, data.plans.length);
  assert.ok(result.plans[1].deletedAt);
  assert.equal(result.plans[1].createdAt, plan.createdAt);
  assert.deepEqual(result.visits, data.visits);
  assert.throws(() => applyPlanSave(result, input(), { planId: plan.id, expectedPlan: plan }), /削除/);
});
test('同じ予定の競合編集・競合削除を拒否する', () => {
  const data = fresh(); const plan = data.plans[1];
  const next = applyPlanSave(data, input(), { planId: plan.id, expectedPlan: plan });
  assert.throws(() => applyPlanSave(next, input(), { planId: plan.id, expectedPlan: plan }), /別の画面/);
  assert.throws(() => applyPlanDelete(next, plan.id, plan), /別の画面/);
});
test('別の予定の編集は古い画面から保存しても取りこぼさない', () => {
  const data = fresh(); const first = data.plans[0]; const second = data.plans[1];
  const next = applyPlanSave(data, input({ name: '一つ目' }), { planId: first.id, expectedPlan: first });
  const final = applyPlanSave(next, input({ name: '二つ目' }), { planId: second.id, expectedPlan: second });
  assert.equal(final.plans[0].name, '一つ目'); assert.equal(final.plans[1].name, '二つ目');
});
