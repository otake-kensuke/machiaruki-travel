import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { emptyData } from '../src/model.js';
import { createBackup, serializeBackup, parseBackup, assertSnapshotMatches, RestoreConflictError, MAX_BACKUP_BYTES, backupFilename, counts } from '../src/backups.js';
import { prepareBackupFile, canShareFile, shareBackupFile } from '../src/file-export.js';
import { DataError } from '../src/validation.js';

const sample = JSON.parse(await readFile(new URL('../samples/hokkaido-2026.sample.json', import.meta.url), 'utf8'));
const fresh = () => structuredClone(sample.data);

test('空データも6配列を含むbackup形式で出力・解析できる', () => {
  const envelope = createBackup(emptyData());
  assert.equal(envelope.kind, 'backup'); assert.equal(envelope.schemaVersion, '1.0'); assert.ok(envelope.exportedAt);
  assert.deepEqual(parseBackup(serializeBackup(envelope)).data, emptyData());
});
test('全コレクション・削除済み予定・GPS付き訪問を欠落なく往復', () => {
  const data = fresh(); data.plans[1].deletedAt = data.plans[1].updatedAt;
  data.visits[0].locationSource = 'gps'; data.visits[0].location.accuracy = 7; data.visits[0].location.capturedAt = data.visits[0].visitedAt;
  assert.deepEqual(parseBackup(serializeBackup(createBackup(data))).data, data);
});
test('出力候補は元データから独立しID・日時を再生成しない', () => {
  const data = fresh(); const copy = structuredClone(data); const envelope = createBackup(data);
  data.visits[0].memo = '後から変更';
  assert.deepEqual(envelope.data, copy);
});
test('構文不正・旅程形式・未対応schema・別アプリ・不正出力日時を拒否', () => {
  for (const value of ['{', 'null', JSON.stringify({ ...sample, kind: 'itinerary' }), JSON.stringify({ ...sample, schemaVersion: '2.0' }), JSON.stringify({ ...sample, appId: 'other' }), JSON.stringify({ ...sample, exportedAt: 'invalid' })]) assert.throws(() => parseBackup(value), DataError);
});
test('欠落配列・重複ID・不正参照を含むbackupを拒否', () => {
  for (const mutate of [data => { delete data.visits; }, data => { data.visits[0].id = data.plans[0].id; }, data => { data.visits[0].planId = 'missing'; }]) {
    const data = fresh(); mutate(data); assert.throws(() => parseBackup(JSON.stringify({ ...sample, data })), DataError);
  }
});
test('出力も復元も20MiBの制限を共通にし復元できない出力を作らない', () => {
  assert.throws(() => parseBackup(' '.repeat(MAX_BACKUP_BYTES + 1)), /20 MiB/);
  const data = fresh(); data.visits[0].memo = 'x'.repeat(MAX_BACKUP_BYTES);
  assert.throws(() => serializeBackup(createBackup(data)), /20 MiB/);
});
test('同じrevisionでも内容違いを拒否しrevision違いも拒否', () => {
  const expected = { revision: 1, data: fresh() };
  assertSnapshotMatches(structuredClone(expected), expected);
  const changed = structuredClone(expected); changed.data.visits[0].memo = '更新';
  assert.throws(() => assertSnapshotMatches(changed, expected), RestoreConflictError);
  assert.throws(() => assertSnapshotMatches({ ...expected, revision: 2 }, expected), RestoreConflictError);
});
test('退避用ファイル名は通常出力と区別し旅行名やローカルパスを含めない', () => {
  const envelope = createBackup(fresh(), '2026-10-18T01:02:03.004Z');
  assert.equal(backupFilename(envelope), 'machiaruki-travel-backup-20261018T010203004Z.json');
  assert.match(backupFilename(envelope, 'before-restore'), /^machiaruki-travel-before-restore-/);
  assert.deepEqual(counts(emptyData()), { trips: 0, days: 0, plans: 0, transportations: 0, accommodations: 0, visits: 0 });
});
test('JSON FileはUTF-8の全データを含みファイル共有可否を検査できる', async () => {
  const prepared = prepareBackupFile(createBackup(fresh()));
  assert.equal(prepared.file.type, 'application/json'); assert.deepEqual(JSON.parse(await prepared.file.text()).data, sample.data);
  assert.equal(canShareFile(prepared, {}), false);
  assert.equal(canShareFile(prepared, { share() {}, canShare() { throw new Error(); } }), false);
  assert.equal(canShareFile(prepared, { share() {}, canShare: ({ files }) => files[0] === prepared.file }), true);
});
test('共有呼出はクリック内で同期開始し受渡し完了と保存完了を混同しない', async () => {
  const prepared = prepareBackupFile(createBackup(emptyData())); let started = false;
  const promise = shareBackupFile(prepared, { canShare: () => true, share(value) { started = true; assert.equal(value.files[0], prepared.file); return Promise.resolve(); } });
  assert.equal(started, true); assert.equal(await promise, undefined);
});
test('共有キャンセル・失敗を呼出側に返し自動ダウンロードしない', async () => {
  const prepared = prepareBackupFile(createBackup(emptyData()));
  for (const name of ['AbortError', 'NotAllowedError']) await assert.rejects(() => shareBackupFile(prepared, { canShare: () => true, share: () => Promise.reject(new DOMException('test', name)) }), { name });
  assert.throws(() => shareBackupFile(prepared, {}), /対応していません/);
});
