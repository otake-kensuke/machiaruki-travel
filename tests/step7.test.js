import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { homeSummary, tripDuration, tripDayNumber } from '../src/home-summary.js';
import { sceneryForTrip, BRAND } from '../src/brand.js';

const sample = JSON.parse(await readFile(new URL('../samples/hokkaido-2026.sample.json', import.meta.url), 'utf8'));
const data = sample.data; const trip = data.trips[0];
test('旅行前は登録された最初の日だけを案内し既存データを変更しない', () => {
  const before = structuredClone(data); const view = homeSummary(trip, data, null, '2026-10-20T00:00:00Z');
  assert.equal(view.day.id, data.days[0].id); assert.equal(view.title, '最初の日の予定'); assert.equal(view.plans.length, 3); assert.deepEqual(data, before);
});
test('旅行中は旅行のタイムゾーンで今日を選ぶ', () => {
  const view = homeSummary(trip, data, null, '2026-10-30T16:00:00Z');
  assert.equal(view.today, '2026-10-31'); assert.equal(view.day.date, '2026-10-31'); assert.equal(view.title, '今日の予定');
});
test('今日の日別がない場合に日程を作らず、別の日を今日として代用しない', () => {
  const input = { ...data, days: data.days.filter(day => day.date !== '2026-10-31') };
  const view = homeSummary(trip, input, null, '2026-10-31T03:00:00Z');
  assert.equal(view.day, null); assert.equal(view.plans.length, 0); assert.match(view.note, /今日は登録済みの日程がありません/); assert.equal(input.days.length, 2);
});
test('旅行後は登録された最後の日を振り返りとして案内', () => {
  const view = homeSummary(trip, data, null, '2026-11-03T00:00:00Z'); assert.equal(view.day.date, '2026-11-01'); assert.equal(view.title, '旅の予定を振り返る');
});
test('明示的に選んだ登録済みの日付を優先し未知の日付は採用しない', () => {
  const selected = homeSummary(trip, data, '2026-11-01', '2026-10-30T03:00:00Z'); assert.equal(selected.day.date, '2026-11-01'); assert.equal(selected.title, '選択日の予定');
  const unknown = homeSummary(trip, data, '2099-01-01', '2026-10-30T03:00:00Z'); assert.equal(unknown.day.date, '2026-10-30');
});
test('削除済み予定を表示せず、時刻未定の予定を末尾に置く', () => {
  const input = structuredClone(data); input.plans[0].deletedAt = input.plans[0].updatedAt; input.plans[1].startAt = null;
  const view = homeSummary(trip, input, '2026-10-30'); assert.deepEqual(view.plans.map(plan => plan.id), [input.plans[2].id, input.plans[1].id]);
});
test('日数は期間から算出し、日別未登録でも予定を捏造しない', () => {
  const changed = { ...trip, startDate: '2028-04-01', endDate: '2028-04-05' };
  assert.equal(tripDuration(changed), 5); assert.equal(tripDayNumber(changed, '2028-04-05'), 5);
  const view = homeSummary(changed, { ...data, days: [], plans: [] }, null, '2028-04-03T03:00:00Z'); assert.equal(view.day, null); assert.equal(view.days.length, 0); assert.match(view.note, /日別の予定はまだ登録されていません/);
});
test('表示名と背景だけを選び、地域・予定・日程をデータへ書き込まない', () => {
  const neutral = { ...trip, name: '京都の春を歩く' }; const before = structuredClone(neutral);
  assert.equal(BRAND.name, '旅あるき'); assert.equal(sceneryForTrip(neutral), 'generic'); assert.equal(sceneryForTrip(null), 'generic'); assert.equal(sceneryForTrip(trip), 'hokkaido'); assert.deepEqual(neutral, before);
});
