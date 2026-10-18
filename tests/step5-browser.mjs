import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createBackup } from '../src/backups.js';
import { emptyData } from '../src/model.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const launch = { channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true };
const browser = await chromium.launch(launch);
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4173/';
const sample = JSON.parse(await readFile(new URL('../samples/hokkaido-2026.sample.json', import.meta.url), 'utf8'));
const checks = [];
const errors = [];
await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
function shareMock() {
  window.shareTest = { supported: false, mode: 'success', calls: 0, active: false };
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => shareTest.supported });
  Object.defineProperty(navigator, 'share', { configurable: true, value: async data => {
    shareTest.calls++; shareTest.active = navigator.userActivation.isActive;
    shareTest.text = await data.files[0].text();
    if (shareTest.mode !== 'success') throw new DOMException('synthetic share error', shareTest.mode);
  } });
}
async function check(name, fn) { await fn(); checks.push(name); console.log(`PASS ${name}`); }
async function snapshot(tab) { return tab.evaluate(async () => (await import('./src/storage.js')).loadWorkspace()); }
async function withPage(fn, { seed = true, url = base } = {}) {
  const context = await browser.newContext({ viewport: { width: 1365, height: 1000 }, acceptDownloads: true });
  context.setDefaultTimeout(8000); await context.addInitScript(shareMock);
  context.on('page', tab => { tab.on('pageerror', error => errors.push(error.message)); tab.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); }); });
  const tab = await context.newPage();
  try {
    await tab.goto(url); await tab.waitForFunction(() => !document.querySelector('.loading'));
    if (seed) { await tab.evaluate(async data => (await import('./src/storage.js')).addDataset(data), sample.data); await tab.reload(); await tab.getByRole('heading', { name: sample.data.trips[0].name }).waitFor(); }
    return await fn(tab, context);
  } finally { await context.close(); }
}
async function download(tab, button) {
  const pending = tab.waitForEvent('download'); await button.click(); const result = await pending;
  const stream = await result.createReadStream(); const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  assert.equal(await result.failure(), null);
  return { envelope: JSON.parse(Buffer.concat(chunks).toString('utf8')), filename: result.suggestedFilename() };
}
async function upload(tab, envelope) {
  await tab.locator('#restore-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(typeof envelope === 'string' ? envelope : JSON.stringify(envelope)) });
  await tab.waitForFunction(() => !document.querySelector('.form-dialog .backup-status')?.textContent.includes('検証しています'));
}
async function openRestore(tab, envelope) { await tab.getByRole('button', { name: 'バックアップから復元', exact: true }).click(); await upload(tab, envelope); }
async function stage(tab) { await tab.getByRole('button', { name: '復元前の退避JSONを準備', exact: true }).click(); await tab.getByRole('button', { name: '退避JSONをダウンロード', exact: true }).waitFor(); }
async function safetyExport(tab) {
  const result = await download(tab, tab.getByRole('button', { name: '退避JSONをダウンロード', exact: true }));
  await tab.getByLabel(/退避JSONを安全な保存先/).waitFor();
  await tab.waitForFunction(() => !document.querySelector('#safety-confirmed').disabled);
  return result;
}
async function acknowledge(tab) { await tab.getByLabel(/退避JSONを安全な保存先/).check(); await tab.getByLabel(/現在データがすべて置き換わる/).check(); }
async function restore(tab) { await tab.getByRole('button', { name: '全データを置き換えて復元', exact: true }).click(); await tab.waitForFunction(() => !document.querySelector('.form-dialog')); }
async function cancel(tab) { await tab.getByRole('button', { name: 'キャンセル', exact: true }).click(); }
async function append(tab, name = '別タブの訪問') {
  return tab.evaluate(async name => {
    const storage = await import('./src/storage.js'); const current = await storage.loadWorkspace();
    return storage.saveVisit({ tripId: current.data.trips[0].id, planId: null, name, memo: '', location: null, locationSource: 'none', visitedAt: new Date().toISOString() });
  }, name);
}
async function apiTicket(tab, incoming = emptyData()) {
  return tab.evaluate(async incoming => {
    const storage = await import('./src/storage.js'); const { createBackup } = await import('./src/backups.js'); const { prepareBackupFile } = await import('./src/file-export.js');
    const current = await storage.loadWorkspace(); const prepared = prepareBackupFile(createBackup(current.data), 'before-restore');
    const id = await storage.stageRestore(current, incoming, prepared.envelope);
    await storage.recordSafetyExport(id, prepared, 'download-requested'); return id;
  }, incoming);
}
try {
  await check('空データの実ダウンロードと出力履歴（保存完了は未確認）', () => withPage(async tab => {
    const before = await snapshot(tab);
    await tab.getByRole('button', { name: 'バックアップを保存', exact: true }).click();
    const result = await download(tab, tab.getByRole('button', { name: 'JSONをダウンロード', exact: true }));
    assert.deepEqual(result.envelope.data, emptyData()); assert.equal(result.envelope.kind, 'backup'); assert.equal(result.envelope.schemaVersion, '1.0');
    assert.match(result.filename, /^machiaruki-travel-backup-/);
    await tab.locator('.form-dialog .backup-status').filter({ hasText: /保存完了は未確認/ }).waitFor();
    assert.deepEqual(await snapshot(tab), before);
    const status = await tab.evaluate(async () => (await import('./src/storage.js')).loadBackupStatus()); assert.equal(status.saveVerified, false);
    await cancel(tab); assert.match(await tab.locator('.backup-panel').innerText(), /最終バックアップ出力操作/);
  }, { seed: false }));
  await check('全旅行・予定・GPS実績・削除済み予定を欠落なく出力', () => withPage(async tab => {
    await tab.evaluate(async sample => {
      const storage = await import('./src/storage.js'); const current = await storage.loadWorkspace(); const plan = current.data.plans[1];
      await storage.deletePlan(plan.id, plan);
      await storage.saveVisit({ tripId: plan.tripId, planId: plan.id, name: 'GPS記録', memo: '', visitedAt: new Date().toISOString(), locationSource: 'gps', location: { latitude: 43.1, longitude: 141.2, accuracy: 7, capturedAt: new Date().toISOString() } });
      const copy = structuredClone(sample.data);
      for (const rows of Object.values(copy)) for (const row of rows) for (const key of ['id', 'tripId', 'planId', 'dayId']) if (row[key]) row[key] = 'second-' + row[key];
      await storage.addDataset(copy);
    }, sample);
    const before = await snapshot(tab);
    await tab.getByRole('button', { name: 'バックアップを保存', exact: true }).click();
    const result = await download(tab, tab.getByRole('button', { name: 'JSONをダウンロード', exact: true }));
    assert.equal(result.envelope.data.trips.length, 2); assert.deepEqual(result.envelope.data, before.data);
  }));
  await check('出力→復元の全データ一致・置換前退避・直前退避の再出力', () => withPage(async tab => {
    const original = await snapshot(tab);
    await tab.getByRole('button', { name: 'バックアップを保存', exact: true }).click();
    const backup = await download(tab, tab.getByRole('button', { name: 'JSONをダウンロード', exact: true })); await cancel(tab);
    await append(tab); const before = await snapshot(tab);
    await openRestore(tab, backup.envelope);
    assert.match(await tab.locator('.restore-preview').innerText(), /置換される現在の全データ/);
    assert.match(await tab.locator('.restore-preview').innerText(), /復元後の全データ/);
    assert.match(await tab.locator('.restore-preview').innerText(), /秋の北海道/);
    assert.equal(await tab.getByRole('button', { name: '全データを置き換えて復元', exact: true }).isDisabled(), true);
    await stage(tab); const safety = await safetyExport(tab); assert.deepEqual(safety.envelope.data, before.data);
    assert.match(safety.filename, /^machiaruki-travel-before-restore-/);
    assert.deepEqual(await snapshot(tab), before);
    await acknowledge(tab); await tab.screenshot({ path: 'test-results/step5-restore-confirm.png' }); await restore(tab);
    const restored = await snapshot(tab); assert.deepEqual(restored.data, original.data); assert.equal(restored.revision, before.revision + 1);
    const previous = await tab.evaluate(async () => (await import('./src/storage.js')).loadPreviousRestoreBackup()); assert.deepEqual(previous.envelope.data, before.data);
    await tab.getByRole('button', { name: 'バックアップを保存', exact: true }).click();
    await tab.getByText('直前の復元前データを取り出す', { exact: true }).click();
    const recovery = await download(tab, tab.getByRole('button', { name: '退避用JSONをダウンロード', exact: true }));
    assert.deepEqual(recovery.envelope.data, before.data);
  }));
  await check('空バックアップへの復元は空になる警告と明示確認が必須', () => withPage(async tab => {
    const before = await snapshot(tab); await openRestore(tab, createBackup(emptyData()));
    assert.match(await tab.locator('.restore-preview').innerText(), /復元後は空データ/);
    await stage(tab); await safetyExport(tab); await acknowledge(tab); await restore(tab);
    assert.deepEqual((await snapshot(tab)).data, emptyData());
    assert.deepEqual((await tab.evaluate(async () => (await import('./src/storage.js')).loadPreviousRestoreBackup())).envelope.data, before.data);
  }));
  await check('不正JSON・未対応形式・欠落配列・ID重複・参照エラーを拒否', () => withPage(async tab => {
    const before = await snapshot(tab);
    const values = ['{', 'null', { ...sample, schemaVersion: '9' }, { ...sample, kind: 'itinerary' }, { ...sample, appId: 'other' }];
    for (const mutate of [data => { delete data.visits; }, data => { data.visits[0].id = data.plans[0].id; }, data => { data.visits[0].planId = 'missing'; }]) { const data = structuredClone(sample.data); mutate(data); values.push({ ...sample, data }); }
    await tab.getByRole('button', { name: 'バックアップから復元', exact: true }).click();
    for (const value of values) {
      await upload(tab, value); assert.equal(await tab.getByRole('button', { name: '全データを置き換えて復元', exact: true }).isDisabled(), true);
      assert.ok((await tab.locator('.form-dialog [role=alert]').innerText()).length); assert.deepEqual(await snapshot(tab), before);
    }
    await upload(tab, ' '.repeat(20 * 1024 * 1024 + 1)); assert.match(await tab.locator('.form-dialog [role=alert]').innerText(), /20 MiB/);
  }));
  await check('退避出力や利用者確認を欠く復元をストレージAPIも拒否', () => withPage(async tab => {
    const before = await snapshot(tab);
    const messages = await tab.evaluate(async () => {
      const storage = await import('./src/storage.js'); const { createBackup } = await import('./src/backups.js'); const current = await storage.loadWorkspace();
      const id = await storage.stageRestore(current, current.data, createBackup(current.data)); const failures = [];
      for (const options of [{}, { safetyConfirmed: true, replacementConfirmed: true }]) try { await storage.restoreWorkspace(id, options); } catch (error) { failures.push(error.message); }
      return failures;
    });
    assert.equal(messages.length, 2); assert.deepEqual(await snapshot(tab), before);
  }));
  await check('退避のIndexedDB書込失敗では出力・置換を許可しない', () => withPage(async tab => {
    const before = await snapshot(tab); await openRestore(tab, createBackup(emptyData()));
    await tab.evaluate(() => { window.putOriginal = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (value, key) { if (key === 'restore-pending') throw new DOMException('full', 'QuotaExceededError'); return putOriginal.call(this, value, key); }; });
    await tab.getByRole('button', { name: '復元前の退避JSONを準備', exact: true }).click();
    await tab.locator('.form-dialog [role=alert]').filter({ hasText: /保存に失敗/ }).waitFor();
    assert.equal(await tab.getByRole('button', { name: '退避JSONをダウンロード', exact: true }).count(), 0); assert.deepEqual(await snapshot(tab), before);
  }));
  await check('退避ファイルの出力失敗では確認を有効にしない', () => withPage(async tab => {
    const before = await snapshot(tab); await openRestore(tab, createBackup(emptyData())); await stage(tab);
    await tab.evaluate(() => { URL.createObjectURL = () => { throw new Error('synthetic output failure'); }; });
    await tab.getByRole('button', { name: '退避JSONをダウンロード', exact: true }).click();
    await tab.locator('.form-dialog [role=alert]').filter({ hasText: /出力できません/ }).waitFor();
    assert.equal(await tab.locator('#safety-confirmed').isDisabled(), true); assert.deepEqual(await snapshot(tab), before);
  }));
  await check('退避共有のキャンセル・失敗では置換せず自動ダウンロードもしない', () => withPage(async tab => {
    await tab.evaluate(() => { shareTest.supported = true; shareTest.mode = 'AbortError'; });
    const before = await snapshot(tab); await openRestore(tab, createBackup(emptyData())); await stage(tab);
    let downloads = 0; tab.on('download', () => downloads++);
    await tab.getByRole('button', { name: '退避JSONを共有して「ファイル」に保存', exact: true }).click();
    await tab.locator('.form-dialog .backup-status').filter({ hasText: /キャンセル/ }).waitFor();
    assert.equal(await tab.locator('#safety-confirmed').isDisabled(), true); assert.deepEqual(await snapshot(tab), before); assert.equal(downloads, 0);
    await tab.evaluate(() => { shareTest.mode = 'NotAllowedError'; });
    await tab.getByRole('button', { name: '退避JSONを共有して「ファイル」に保存', exact: true }).click();
    await tab.locator('.form-dialog [role=alert]').filter({ hasText: /出力できません/ }).waitFor(); assert.deepEqual(await snapshot(tab), before);
  }));
  await check('ファイル出力後の退避履歴書込失敗でも復元を止める', () => withPage(async tab => {
    const before = await snapshot(tab); await openRestore(tab, createBackup(emptyData())); await stage(tab);
    await tab.evaluate(() => { window.putOriginal = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (value, key) { if (key === 'backup-status') throw new DOMException('full', 'QuotaExceededError'); return putOriginal.call(this, value, key); }; });
    await download(tab, tab.getByRole('button', { name: '退避JSONをダウンロード', exact: true }));
    await tab.locator('.form-dialog [role=alert]').filter({ hasText: /退避確認に失敗/ }).waitFor();
    assert.equal(await tab.locator('#safety-confirmed').isDisabled(), true); assert.deepEqual(await snapshot(tab), before);
  }));
  await check('復元の書込途中失敗は全キーを巻き戻し、入力を保持して再試行可能', () => withPage(async tab => {
    const before = await snapshot(tab); await openRestore(tab, createBackup(emptyData())); await stage(tab); await safetyExport(tab); await acknowledge(tab);
    await tab.evaluate(() => { window.putOriginal = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (value, key) { const result = putOriginal.call(this, value, key); if (key === 'active') this.transaction.abort(); return result; }; });
    await tab.getByRole('button', { name: '全データを置き換えて復元', exact: true }).click();
    await tab.locator('.form-dialog [role=alert]').filter({ hasText: /保存に失敗/ }).waitFor();
    assert.deepEqual(await snapshot(tab), before); assert.equal(await tab.locator('#restore-file').inputValue() !== '', true);
    assert.equal(await tab.evaluate(async () => (await import('./src/storage.js')).loadPreviousRestoreBackup()), null);
    await tab.evaluate(() => { IDBObjectStore.prototype.put = putOriginal; }); await restore(tab);
    assert.deepEqual((await snapshot(tab)).data, emptyData());
  }));
  await check('プレビュー後の別タブ更新は置換対象を再表示し退避を止める', () => withPage(async (tab, context) => {
    await openRestore(tab, createBackup(emptyData())); const other = await context.newPage(); await other.goto(base); await append(other); const before = await snapshot(tab);
    await tab.getByRole('button', { name: '復元前の退避JSONを準備', exact: true }).click();
    await tab.locator('.form-dialog [role=alert]').filter({ hasText: /別の画面で更新/ }).waitFor();
    assert.equal(await tab.getByRole('button', { name: '退避JSONをダウンロード', exact: true }).count(), 0); assert.deepEqual(await snapshot(tab), before);
    assert.match(await tab.locator('.restore-preview').innerText(), /訪問記録 3件/);
    await stage(tab); const safety = await safetyExport(tab); assert.deepEqual(safety.envelope.data, before.data);
  }));
  await check('退避後の別タブ更新は最終復元を拒否し更新内容を残す', () => withPage(async (tab, context) => {
    await openRestore(tab, createBackup(emptyData())); await stage(tab); await safetyExport(tab); await acknowledge(tab);
    const other = await context.newPage(); await other.goto(base); await append(other); const before = await snapshot(tab);
    await tab.getByRole('button', { name: '全データを置き換えて復元', exact: true }).click();
    await tab.locator('.form-dialog [role=alert]').filter({ hasText: /別の画面で更新/ }).waitFor(); assert.deepEqual(await snapshot(tab), before);
  }));
  await check('他の復元操作に退避準備が置き換わった場合も古い操作を拒否', () => withPage(async tab => {
    const id = await apiTicket(tab); await apiTicket(tab); const before = await snapshot(tab);
    await assert.rejects(() => tab.evaluate(async id => (await import('./src/storage.js')).restoreWorkspace(id, { safetyConfirmed: true, replacementConfirmed: true }), id), /別の復元操作/);
    assert.deepEqual(await snapshot(tab), before);
  }));
  await check('復元と並行する訪問保存は消失せず、順序に応じて競合を拒否', () => withPage(async (tab, context) => {
    const id = await apiTicket(tab, sample.data); const other = await context.newPage(); await other.goto(base);
    const results = await Promise.allSettled([append(other, '並行した新規訪問'), tab.evaluate(async id => (await import('./src/storage.js')).restoreWorkspace(id, { safetyConfirmed: true, replacementConfirmed: true }), id)]);
    assert.equal(results[0].status, 'fulfilled'); assert.ok((await snapshot(tab)).data.visits.some(visit => visit.name === '並行した新規訪問'));
  }));
  await check('共有受渡し成功も保存完了とは表示せず利用者の操作内で開始', () => withPage(async tab => {
    await tab.evaluate(() => { shareTest.supported = true; }); const before = await snapshot(tab);
    await tab.getByRole('button', { name: 'バックアップを保存', exact: true }).click();
    await tab.getByRole('button', { name: '共有して「ファイル」に保存', exact: true }).click();
    await tab.locator('.form-dialog .backup-status').filter({ hasText: /共有画面へファイルを渡しました/ }).waitFor();
    assert.equal(await tab.evaluate(() => shareTest.active), true); assert.deepEqual(await snapshot(tab), before);
    const status = await tab.evaluate(async () => (await import('./src/storage.js')).loadBackupStatus()); assert.equal(status.method, 'share-handed-off'); assert.equal(status.saveVerified, false);
  }));
  await check('通常バックアップの共有キャンセルで履歴を更新しない', () => withPage(async tab => {
    await tab.evaluate(() => { shareTest.supported = true; shareTest.mode = 'AbortError'; });
    const before = await snapshot(tab); await tab.getByRole('button', { name: 'バックアップを保存', exact: true }).click();
    await tab.getByRole('button', { name: '共有して「ファイル」に保存', exact: true }).click();
    await tab.locator('.form-dialog .backup-status').filter({ hasText: /キャンセル/ }).waitFor(); await cancel(tab);
    assert.equal(await tab.evaluate(async () => (await import('./src/storage.js')).loadBackupStatus()), null); assert.deepEqual(await snapshot(tab), before);
  }));
  await check('古い時点のバックアップ出力後はホームに更新済みを表示', () => withPage(async tab => {
    const before = await snapshot(tab); await tab.getByRole('button', { name: 'バックアップを保存', exact: true }).click();
    await tab.getByRole('button', { name: 'JSONをダウンロード', exact: true }).waitFor(); await append(tab);
    const result = await download(tab, tab.getByRole('button', { name: 'JSONをダウンロード', exact: true })); assert.deepEqual(result.envelope.data, before.data);
    await tab.locator('.form-dialog .backup-status').filter({ hasText: /保存完了は未確認/ }).waitFor(); await cancel(tab);
    assert.match(await tab.locator('.backup-panel').innerText(), /出力後にデータの保存・復元/);
  }));
  await check('有効候補の後の不正ファイル選択・キャンセルで古い候補を復元しない', () => withPage(async tab => {
    const before = await snapshot(tab); await openRestore(tab, createBackup(emptyData())); await stage(tab); await safetyExport(tab); await acknowledge(tab);
    await upload(tab, '{'); assert.equal(await tab.getByRole('button', { name: '全データを置き換えて復元', exact: true }).isDisabled(), true);
    await tab.locator('.form-dialog form').evaluate(form => form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })));
    await cancel(tab); assert.deepEqual(await snapshot(tab), before);
  }));
  await check('モバイル復元画面の横はみ出しなし・HTML文字列を安全に表示', () => withPage(async tab => {
    const value = structuredClone(sample); value.data.trips[0].name = '<img src=x onerror="window.injected=true">';
    for (const width of [390, 320]) {
      await tab.setViewportSize({ width, height: 844 }); await openRestore(tab, value);
      assert.ok(await tab.locator('.form-dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth + 1));
      assert.equal(await tab.locator('.restore-preview img').count(), 0); assert.equal(await tab.evaluate(() => window.injected), undefined);
      if (width === 390) await tab.screenshot({ path: 'test-results/step5-mobile-restore.png' }); await cancel(tab);
    }
  }));
  await check('サブパスからも出力・復元を実行できる', () => withPage(async tab => {
    const before = await snapshot(tab); await openRestore(tab, createBackup(sample.data)); await stage(tab); await safetyExport(tab); await acknowledge(tab); await restore(tab);
    assert.deepEqual((await snapshot(tab)).data, before.data);
  }, { url: new URL('/machiaruki-travel/', base).href }));
  await check('ブラウザプロセス再起動後も復元結果・出力履歴・退避コピーを保持', async () => {
    const root = fileURLToPath(new URL('../test-results/', import.meta.url)); const profile = await mkdtemp(path.join(root, 'step5-profile-'));
    let persistent;
    try {
      persistent = await chromium.launchPersistentContext(profile, launch); let tab = persistent.pages()[0]; await tab.goto(base);
      await tab.evaluate(async data => (await import('./src/storage.js')).addDataset(data), sample.data);
      const id = await apiTicket(tab); await tab.evaluate(async id => (await import('./src/storage.js')).restoreWorkspace(id, { safetyConfirmed: true, replacementConfirmed: true }), id);
      const before = await snapshot(tab); await persistent.close(); persistent = undefined;
      persistent = await chromium.launchPersistentContext(profile, launch); tab = persistent.pages()[0]; await tab.goto(base);
      await tab.getByRole('button', { name: 'バックアップを保存', exact: true }).waitFor(); assert.deepEqual(await snapshot(tab), before);
      const previous = await tab.evaluate(async () => (await import('./src/storage.js')).loadPreviousRestoreBackup()); assert.deepEqual(previous.envelope.data, sample.data);
      const status = await tab.evaluate(async () => (await import('./src/storage.js')).loadBackupStatus()); assert.equal(status.saveVerified, false);
    } finally {
      if (persistent) await persistent.close(); const relative = path.relative(root, profile);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Profile outside test-results');
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
  await check('ページのJavaScript例外・コンソールエラーなし', async () => assert.deepEqual(errors, []));
} finally { await browser.close(); }
console.log(`\n${checks.length} Step 5 browser checks passed (Edge; iPhone Files and native share UI are not tested).`);
