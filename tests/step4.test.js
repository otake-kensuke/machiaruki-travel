import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyVisitSave, visitTimestamp } from '../src/visits.js';
import { applyPlanDelete } from '../src/plans.js';
import { journalDays, timelineItems } from '../src/model.js';
import { mapsUrl } from '../src/maps.js';
import { startPositionRequest, positionLocation } from '../src/geolocation.js';
import { DataError, validateData } from '../src/validation.js';

const sample = JSON.parse(await readFile(new URL('../samples/hokkaido-2026.sample.json', import.meta.url), 'utf8'));
const fresh = () => structuredClone(sample.data);
const gps = { latitude: 43.12345, longitude: 141.54321, accuracy: 8.5, capturedAt: '2026-10-30T05:19:58.000Z' };
const input = (extra = {}) => ({ tripId: sample.data.trips[0].id, planId: null, visitedAt: '2026-10-30T14:20:30+09:00', name: '実際の施設', memo: '', address: '', location: null, locationSource: 'none', ...extra });

test('予定から訪問を追加し予定地点・他の訪問を変更しない', () => {
  const data = fresh(); const before = structuredClone(data);
  const result = applyVisitSave(data, input({ planId: 'sample-plan-odori', location: gps, locationSource: 'gps' }));
  const visit = result.visits.at(-1);
  assert.equal(visit.planId, 'sample-plan-odori'); assert.deepEqual(visit.location, gps);
  assert.equal(visit.createdAt, visit.updatedAt); assert.ok(visit.id);
  assert.deepEqual(result.plans, before.plans); assert.deepEqual(result.visits.slice(0, -1), before.visits);
  assert.deepEqual(data, before);
});
test('予定外・座標なしの訪問はnullのplanIdとlocationで保存', () => {
  const result = applyVisitSave(fresh(), input()); const visit = result.visits.at(-1);
  assert.equal(visit.planId, null); assert.equal(visit.location, null); assert.equal(visit.locationSource, 'none');
  validateData(result);
});
test('同じ施設への複数訪問を別ID・別実績として保持', () => {
  const first = applyVisitSave(fresh(), input());
  const second = applyVisitSave(first, input());
  assert.equal(second.visits.length, 4); assert.notEqual(second.visits[2].id, second.visits[3].id);
});
test('訪問編集はID・createdAt・予定参照・元の地点を維持', () => {
  const data = fresh(); const visit = data.visits[0];
  const result = applyVisitSave(data, input({ name: '変更した施設', memo: '変更メモ', planId: null, location: gps, locationSource: 'gps' }), { visitId: visit.id, expectedVisit: visit });
  const edited = result.visits[0];
  assert.equal(edited.id, visit.id); assert.equal(edited.createdAt, visit.createdAt);
  assert.equal(edited.planId, visit.planId); assert.deepEqual(edited.location, visit.location); assert.equal(edited.locationSource, visit.locationSource);
  assert.ok(Date.parse(edited.updatedAt) > Date.parse(visit.updatedAt));
  assert.deepEqual(result.visits[1], data.visits[1]); assert.deepEqual(result.plans, data.plans);
});
test('不正な名称・日時・旅行・予定・座標を拒否し元データは不変', () => {
  const data = fresh(); const before = structuredClone(data);
  for (const change of [{ name: '   ' }, { visitedAt: '2026-02-30T00:00:00Z' }, { tripId: 'missing' }, { planId: 'missing' }, { location: gps }, { location: { ...gps, latitude: 100 }, locationSource: 'gps' }]) assert.throws(() => applyVisitSave(data, input(change)), DataError);
  assert.deepEqual(data, before);
});
test('同じ訪問記録の競合編集を拒否、別の訪問の更新は保持', () => {
  const data = fresh(); const visit = data.visits[0];
  const next = applyVisitSave(data, input(), { visitId: visit.id, expectedVisit: visit });
  assert.throws(() => applyVisitSave(next, input(), { visitId: visit.id, expectedVisit: visit }), /別の画面/);
  const final = applyVisitSave(next, input(), { visitId: data.visits[1].id, expectedVisit: data.visits[1] });
  assert.deepEqual(final.visits[0], next.visits[0]);
});
test('予定削除後も履歴を編集でき、開始済み訪問を削除済み予定へ関連付け可能', () => {
  const data = fresh(); const plan = data.plans[1];
  const deleted = applyPlanDelete(data, plan.id, plan);
  assert.deepEqual(deleted.visits, data.visits);
  const updated = applyVisitSave(deleted, input(), { visitId: data.visits[0].id, expectedVisit: data.visits[0] });
  assert.equal(updated.visits[0].planId, plan.id);
  const newVisit = applyVisitSave(updated, input({ planId: plan.id }));
  assert.equal(newVisit.visits.at(-1).planId, plan.id);
});
test('旅行期間外の実際の訪問日も表示でき、日別データは変えない', () => {
  const data = fresh(); const next = applyVisitSave(data, input({ visitedAt: '2026-10-17T23:00:00+09:00' }));
  assert.ok(journalDays(next, 'Asia/Tokyo').some(day => day.date === '2026-10-17'));
  assert.equal(timelineItems(next, '2026-10-17', 'Asia/Tokyo').length, 1);
  assert.deepEqual(next.days, data.days);
});
test('訪問日時とGPS取得日時は独立し、時刻未変更なら秒まで保持', () => {
  const original = '2026-10-30T14:20:30.123+09:00';
  assert.equal(visitTimestamp('2026-10-30', '14:20', 'Asia/Tokyo', original), original);
  assert.equal(visitTimestamp('2026-10-31', '15:00', 'Asia/Tokyo', original), '2026-10-31T06:00:00.000Z');
  assert.throws(() => visitTimestamp('2026-10-30', '', 'Asia/Tokyo', original), /訪問時刻/);
});
test('GPS成功で取得時刻・緯度経度・精度を保持し単発取得する', async () => {
  let calls = 0;
  const position = { coords: { latitude: 43, longitude: 141, accuracy: 5 }, timestamp: Date.parse(gps.capturedAt) };
  const request = startPositionRequest({ geolocation: { getCurrentPosition(success, failure, options) { calls++; assert.equal(options.maximumAge, 0); assert.equal(options.enableHighAccuracy, true); success(position); }, watchPosition() { throw new Error('must not track'); } } });
  assert.deepEqual(await request.promise, { status: 'success', location: positionLocation(position) });
  assert.equal(calls, 1);
});
test('GPSの許可拒否・取得失敗・タイムアウトを座標なしの状態として返す', async () => {
  for (const code of [1, 2, 3]) {
    const request = startPositionRequest({ geolocation: { getCurrentPosition(success, failure) { failure({ code }); } } });
    const result = await request.promise; assert.equal(result.status, 'error'); assert.equal(result.code, code); assert.match(result.message, /座標なし/);
  }
  assert.equal((await startPositionRequest({ geolocation: null }).promise).status, 'error');
});
test('ブラウザが応答しなくてもJS期限で終了し遅延結果を無視', async () => {
  let late;
  const request = startPositionRequest({ timeoutMs: 5, geolocation: { getCurrentPosition(success) { late = success; } } });
  const result = await request.promise; assert.equal(result.code, 3);
  late({ coords: { latitude: 43, longitude: 141, accuracy: 5 }, timestamp: Date.now() });
  assert.deepEqual(await request.promise, result);
});
test('閉じる・確認後のGPS結果はキャンセル済みとなり反映されない', async () => {
  let late;
  const request = startPositionRequest({ geolocation: { getCurrentPosition(success) { late = success; } } });
  request.cancel();
  late({ coords: { latitude: 43, longitude: 141, accuracy: 5 }, timestamp: Date.now() });
  assert.deepEqual(await request.promise, { status: 'cancelled' });
});
test('異常なGPS値を保存用地点に変換しない', () => {
  for (const position of [{}, { coords: { latitude: 100, longitude: 141, accuracy: 5 }, timestamp: Date.now() }, { coords: { latitude: 43, longitude: 141, accuracy: NaN }, timestamp: Date.now() }]) assert.throws(() => positionLocation(position));
});
test('GoogleマップURLはGPS/手入力の保存地点を優先しAPIキー不要', () => {
  const url = new URL(mapsUrl({ location: gps, name: '施設名', address: '住所' }));
  assert.equal(url.origin, 'https://www.google.com'); assert.equal(url.pathname, '/maps/search/');
  assert.equal(url.searchParams.get('api'), '1'); assert.equal(url.searchParams.get('query'), '43.12345,141.54321');
  assert.equal(url.searchParams.has('key'), false);
});
test('座標がない場合は名称と住所を安全にエンコードし検索する', () => {
  const name = '喫茶 & <店> / 北海道'; const address = '札幌市 中央区';
  const url = new URL(mapsUrl({ name, address }));
  assert.equal(url.searchParams.get('query'), `${name} ${address}`);
  assert.equal(url.searchParams.has('location'), false);
  assert.equal(mapsUrl({}), null);
  assert.ok(mapsUrl({ name: 'あ'.repeat(2000) }).length <= 2048);
});
