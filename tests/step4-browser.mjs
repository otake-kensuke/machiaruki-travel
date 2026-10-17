import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const launch = { channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true };
const browser = await chromium.launch(launch);
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4173/';
const sample = JSON.parse(await readFile(new URL('../samples/hokkaido-2026.sample.json', import.meta.url), 'utf8'));
await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
const checks = [];
const errors = [];
const context = await browser.newContext({ viewport: { width: 1365, height: 1000 } });
context.setDefaultTimeout(8000);
context.on('page', tab => {
  tab.on('pageerror', error => errors.push(error.message));
  tab.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
});
function installGpsMock() {
  const state = { mode: 'success', calls: 0, watchCalls: 0, pending: [], options: [] };
  window.gpsHarness = state;
  const position = () => ({ coords: { latitude: 43.12345, longitude: 141.54321, accuracy: 7 }, timestamp: Date.now() - 2000 });
  window.releaseGps = () => state.pending.shift()?.(position());
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition(success, failure, options) {
      state.calls++; state.options.push(options);
      if (state.mode === 'pending') { state.pending.push(success); return; }
      queueMicrotask(() => state.mode === 'success' ? success(position()) : failure({ code: { denied: 1, failure: 2, timeout: 3 }[state.mode] || 2 }));
    },
    watchPosition() { state.watchCalls++; throw new Error('Continuous tracking is forbidden'); }
  } });
}
await context.addInitScript(installGpsMock);
const page = await context.newPage();
let gpsVisitId;
let noGpsVisitId;
async function check(name, callback) {
  try { await callback(); checks.push(name); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`); throw error; }
}
async function snapshot(tab = page) { return tab.evaluate(async () => (await import('./src/storage.js')).loadWorkspace()); }
async function go(screen = 'timeline', date = '2026-10-30', tab = page) {
  await tab.goto(`${base}#/${screen}?trip=sample-trip-hokkaido-2026&date=${date}`);
  await tab.reload(); await tab.waitForFunction(() => !document.querySelector('.loading'));
}
async function seed(tab = page) {
  await tab.getByRole('button', { name: 'サンプル旅程を読み込む' }).click();
  await tab.getByRole('button', { name: 'この端末に読み込む' }).click();
  await tab.getByRole('heading', { name: sample.data.trips[0].name }).waitFor();
}
async function mode(value, tab = page) { await tab.evaluate(value => { window.gpsHarness.mode = value; }, value); }
async function setDate(date, time, tab = page) {
  await tab.getByLabel('訪問日（必須）').fill(date);
  await tab.getByLabel('訪問時刻（必須）').fill(time);
}
async function confirm(tab = page) { await tab.getByRole('button', { name: '内容を確認', exact: true }).click(); await tab.getByRole('button', { name: 'この内容で保存', exact: true }).waitFor(); }
async function save(tab = page) { await tab.getByRole('button', { name: 'この内容で保存', exact: true }).click(); await tab.waitForFunction(() => !document.querySelector('.form-dialog')); }
async function cancel(tab = page) { await tab.getByRole('button', { name: 'キャンセル', exact: true }).click(); }
async function newVisit(name, tab = page) {
  await tab.getByRole('button', { name: '＋ 訪問記録を追加', exact: true }).click();
  await tab.getByLabel('施設名（必須）', { exact: true }).fill(name);
}
const visitCard = id => page.locator(`[data-visit-id="${id}"]`);
try {
  await page.goto(base); await seed(); await go();
  await check('起動・画面遷移・予定編集ではGPS取得しない', async () => {
    await page.getByRole('button', { name: '大通公園を散策を編集', exact: true }).click(); await cancel();
    await page.getByRole('link', { name: '振り返り', exact: true }).click();
    await page.getByRole('link', { name: '予定・記録', exact: true }).click();
    assert.equal(await page.evaluate(() => gpsHarness.calls), 0);
  });
  await check('予定から施設名を引継ぎ、実際の時刻とGPS地点を確認後に保存', async () => {
    const before = await snapshot();
    await page.getByRole('button', { name: '大通公園を散策の訪問を記録', exact: true }).click();
    assert.equal(await page.getByLabel('施設名（必須）', { exact: true }).inputValue(), '大通公園を散策');
    await page.locator('.gps-status').filter({ hasText: /GPS地点/ }).waitFor();
    assert.match(await page.locator('.gps-status').innerText(), /自動判定していません/);
    await setDate('2026-10-30', '14:20');
    await page.getByLabel('メモ（任意）').fill('予定から実際の訪問');
    await confirm();
    assert.deepEqual(await snapshot(), before);
    await page.screenshot({ path: 'test-results/step4-confirm.png' });
    await save();
    const after = await snapshot(); const visit = after.data.visits.at(-1); gpsVisitId = visit.id;
    assert.equal(visit.planId, 'sample-plan-odori'); assert.equal(visit.locationSource, 'gps');
    assert.equal(visit.location.latitude, 43.12345); assert.equal(visit.location.accuracy, 7); assert.ok(visit.location.capturedAt);
    assert.notDeepEqual(visit.location, before.data.plans[1].location);
    assert.deepEqual(after.data.plans, before.data.plans); assert.deepEqual(after.data.visits.slice(0, -1), before.data.visits);
    assert.match(await visitCard(gpsVisitId).innerText(), /訪問 14:20/);
    assert.match(await page.locator('[data-plan-id="sample-plan-odori"] .timeline-time').innerText(), /予定/);
    const calls = await page.evaluate(() => gpsHarness.calls); assert.equal(calls, 1);
    assert.equal(await page.evaluate(() => gpsHarness.watchCalls), 0);
  });
  await check('同じ場所・同じ予定への複数訪問を追加して保持', async () => {
    await page.getByRole('button', { name: '大通公園を散策の訪問を記録', exact: true }).click();
    await page.locator('.gps-status').filter({ hasText: /GPS地点/ }).waitFor();
    await setDate('2026-10-30', '16:00'); await confirm(); await save();
    const visits = (await snapshot()).data.visits.filter(visit => visit.planId === 'sample-plan-odori');
    assert.equal(visits.length, 3); assert.equal(new Set(visits.map(visit => visit.id)).size, 3);
    assert.equal(await page.locator('[data-plan-id="sample-plan-odori"] .visit-inline').count(), 3);
  });
  await check('GPS拒否でも予定外の訪問を座標なし・planId nullで保存', async () => {
    await mode('denied'); await newVisit('予定外の喫茶店');
    await page.locator('.gps-status').filter({ hasText: /許可されていません/ }).waitFor();
    await setDate('2026-10-30', '15:00');
    await page.getByLabel('住所（任意・座標がないときの検索用）').fill('札幌市中央区');
    await confirm(); await save();
    const visit = (await snapshot()).data.visits.at(-1); noGpsVisitId = visit.id;
    assert.equal(visit.planId, null); assert.equal(visit.location, null); assert.equal(visit.locationSource, 'none');
    const url = new URL(await visitCard(visit.id).getByRole('link').getAttribute('href'));
    assert.equal(url.searchParams.get('query'), '予定外の喫茶店 札幌市中央区');
  });
  await check('GPSタイムアウト・取得失敗でも保存できる', async () => {
    for (const value of ['timeout', 'failure']) {
      await mode(value); await newVisit(`GPS ${value}`);
      await page.locator('.gps-status').filter({ hasText: /タイムアウト|取得できません/ }).waitFor();
      await setDate('2026-10-30', '17:00'); await confirm(); await save();
      assert.equal((await snapshot()).data.visits.at(-1).location, null);
    }
  });
  await check('GPS失敗時に予定地点を実績へ流用せず、明示した再取得だけを実行', async () => {
    await mode('denied');
    await page.getByRole('button', { name: '大通公園を散策の訪問を記録', exact: true }).click();
    await page.locator('.gps-status').filter({ hasText: /許可されていません/ }).waitFor();
    await setDate('2026-10-30', '17:30'); await confirm(); await save();
    const visit = (await snapshot()).data.visits.at(-1);
    assert.equal(visit.location, null); assert.equal(visit.planId, 'sample-plan-odori');
    const url = new URL(await visitCard(visit.id).getByRole('link').getAttribute('href'));
    assert.equal(url.searchParams.get('query'), '大通公園を散策 札幌市中央区 大通西');
    const before = await snapshot(); await newVisit('GPS再取得の確認');
    await page.locator('.gps-status').filter({ hasText: /許可されていません/ }).waitFor();
    const calls = await page.evaluate(() => gpsHarness.calls);
    await mode('success'); await page.getByRole('button', { name: 'GPSを再取得', exact: true }).click();
    await page.locator('.gps-status').filter({ hasText: /GPS地点/ }).waitFor();
    assert.equal(await page.evaluate(() => gpsHarness.calls), calls + 1);
    assert.equal(await page.getByLabel('施設名（必須）', { exact: true }).inputValue(), 'GPS再取得の確認');
    await cancel(); assert.deepEqual(await snapshot(), before);
  });
  await check('GPS待ち中も入力・確認・座標なし保存ができ、遅延結果は反映しない', async () => {
    await mode('pending'); await newVisit('GPSを待たずに記録'); await setDate('2026-10-30', '18:00');
    await page.getByLabel('メモ（任意）').fill('GPS待ちでも操作できる');
    assert.equal(await page.getByRole('button', { name: '内容を確認', exact: true }).isEnabled(), true);
    await confirm(); await page.evaluate(() => releaseGps());
    assert.match(await page.locator('.visit-confirm').innerText(), /座標なし/);
    await save(); const saved = (await snapshot()).data.visits.at(-1);
    assert.equal(saved.location, null); assert.equal(saved.memo, 'GPS待ちでも操作できる');
  });
  await check('キャンセルした記録の遅延GPSが次の記録に混入しない', async () => {
    await mode('pending'); const before = await snapshot(); await newVisit('保存しない'); await cancel();
    await mode('denied'); await newVisit('次の記録');
    await page.evaluate(() => releaseGps());
    await page.locator('.gps-status').filter({ hasText: /許可されていません/ }).waitFor();
    await confirm(); assert.match(await page.locator('.visit-confirm').innerText(), /座標なし/);
    await cancel(); assert.deepEqual(await snapshot(), before);
  });
  await check('訪問編集で日時・名称・メモを変更し、GPS地点・参照・IDを保持', async () => {
    await go('review'); const before = (await snapshot()).data.visits.find(visit => visit.id === gpsVisitId);
    await visitCard(gpsVisitId).getByRole('button', { name: /訪問記録を編集/ }).click();
    assert.equal(await page.evaluate(() => gpsHarness.calls), 0);
    await page.getByLabel('施設名（必須）', { exact: true }).fill('編集した実際の施設');
    await page.getByLabel('メモ（任意）').fill('訪問メモを更新');
    await setDate('2026-10-31', '09:30'); await confirm(); await save();
    const after = (await snapshot()).data.visits.find(visit => visit.id === gpsVisitId);
    assert.equal(after.createdAt, before.createdAt); assert.equal(after.planId, before.planId); assert.deepEqual(after.location, before.location);
    assert.ok(Date.parse(after.updatedAt) > Date.parse(before.updatedAt)); assert.equal(after.visitedAt, '2026-10-31T00:30:00.000Z');
    assert.match(await visitCard(gpsVisitId).innerText(), /訪問 09:30/);
    assert.equal(await page.evaluate(() => gpsHarness.calls), 0);
  });
  await check('予定を削除しても全訪問と参照を保持', async () => {
    await go(); const before = (await snapshot()).data.visits;
    await page.getByRole('button', { name: '大通公園を散策を削除', exact: true }).click();
    await page.getByRole('button', { name: '予定を削除する', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.form-dialog'));
    assert.deepEqual((await snapshot()).data.visits, before);
    await go('review'); assert.match(await visitCard(gpsVisitId).innerText(), /削除済みの予定から/);
  });
  await check('訪問入力中に予定が削除されても開始済みの記録を保存できる', async () => {
    await go(); await mode('denied');
    await page.getByRole('button', { name: '新千歳空港に到着の訪問を記録', exact: true }).click();
    await page.evaluate(async () => {
      const storage = await import('./src/storage.js'); const state = await storage.loadWorkspace();
      const plan = state.data.plans.find(plan => plan.id === 'sample-plan-airport'); await storage.deletePlan(plan.id, plan);
    });
    await setDate('2026-10-30', '11:15'); await confirm(); await save();
    assert.equal((await snapshot()).data.visits.at(-1).planId, 'sample-plan-airport');
  });
  await check('保存失敗時に確認内容・入力・既存データを保持し、再試行可能', async () => {
    await mode('denied'); await newVisit('保存エラーでも残る施設'); await setDate('2026-10-30', '19:00');
    await page.getByLabel('メモ（任意）').fill('消してはいけない入力'); await confirm(); const before = await snapshot();
    await page.evaluate(() => { window.putOriginal = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
    try {
      await page.getByRole('button', { name: 'この内容で保存', exact: true }).click();
      await page.locator('.form-dialog [role=alert]').filter({ hasText: /保存に失敗/ }).waitFor();
      assert.match(await page.locator('.visit-confirm').innerText(), /消してはいけない入力/);
      assert.deepEqual(await snapshot(), before);
    } finally { await page.evaluate(() => { IDBObjectStore.prototype.put = window.putOriginal; }); }
    await page.getByRole('button', { name: '内容を修正', exact: true }).click();
    assert.equal(await page.getByLabel('メモ（任意）').inputValue(), '消してはいけない入力');
    await confirm(); await save();
  });
  await check('別タブの競合編集を拒否し先行保存と入力を保持', async () => {
    await go('review'); const other = await context.newPage(); await go('review', '2026-10-30', other);
    const selector = `[data-visit-id="${noGpsVisitId}"]`;
    await page.locator(selector).getByRole('button', { name: /訪問記録を編集/ }).click();
    await other.locator(selector).getByRole('button', { name: /訪問記録を編集/ }).click();
    await page.getByLabel('施設名（必須）', { exact: true }).fill('先行した訪問編集'); await confirm(); await save();
    const before = await snapshot();
    await other.getByLabel('施設名（必須）', { exact: true }).fill('競合した訪問入力'); await confirm(other);
    await other.getByRole('button', { name: 'この内容で保存', exact: true }).click();
    await other.locator('.form-dialog [role=alert]').filter({ hasText: /別の画面で変更/ }).waitFor();
    assert.match(await other.locator('.visit-confirm').innerText(), /競合した訪問入力/);
    assert.deepEqual(await snapshot(), before); await cancel(other); await other.close();
  });
  await check('並行する新規訪問を両方保持し、再取込衝突で履歴を変えない', async () => {
    const before = await snapshot();
    await page.evaluate(async sample => {
      const storage = await import('./src/storage.js');
      const input = { tripId: sample.data.trips[0].id, planId: null, name: '並行した訪問', memo: '', visitedAt: new Date().toISOString(), location: null, locationSource: 'none' };
      await Promise.all([storage.saveVisit(input), storage.saveVisit(input)]);
    }, sample);
    const after = await snapshot(); assert.equal(after.data.visits.length, before.data.visits.length + 2);
    const collision = await page.evaluate(async sample => {
      try { await (await import('./src/storage.js')).addDataset(sample.data); return false; } catch { return true; }
    }, sample);
    assert.equal(collision, true); assert.deepEqual(await snapshot(), after);
  });
  await check('旅程にない実際の訪問日も日付切替・再読込で表示できる', async () => {
    await go(); const state = await snapshot();
    const last = state.data.visits.at(-1);
    const date = await page.evaluate(value => import('./src/model.js').then(model => model.localDate(value, 'Asia/Tokyo')), last.visitedAt);
    await go('timeline', date); assert.match(await page.locator('.timeline').innerText(), /並行した訪問/);
    const before = await snapshot(); await page.reload(); await page.getByRole('heading', { name: '今日の予定・訪問記録' }).waitFor();
    assert.deepEqual(await snapshot(), before);
  });
  await check('Googleマップは保存地点・名称検索の正しい外部URLで、クリック時だけ開く', async () => {
    await go('review');
    const point = new URL(await visitCard(gpsVisitId).getByRole('link').getAttribute('href'));
    assert.equal(point.searchParams.get('query'), '43.12345,141.54321'); assert.equal(point.searchParams.get('api'), '1');
    const search = new URL(await visitCard(noGpsVisitId).getByRole('link').getAttribute('href'));
    assert.equal(search.searchParams.get('query'), '先行した訪問編集 札幌市中央区');
    let requests = 0;
    await context.route('https://www.google.com/**', async route => { requests++; await route.fulfill({ contentType: 'text/html', body: '<title>Map URL check</title>Verified test URL' }); });
    assert.equal(requests, 0);
    const popupPromise = context.waitForEvent('page');
    await visitCard(gpsVisitId).getByRole('link').click();
    const popup = await popupPromise; await popup.waitForLoadState('domcontentloaded');
    assert.equal(new URL(popup.url()).searchParams.get('query'), '43.12345,141.54321'); assert.equal(requests, 1);
    await popup.close(); await context.unroute('https://www.google.com/**');
  });
  await check('モバイル390px・320pxで登録・確認・3画面が横にはみ出さない', async () => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 }); await go(); await mode('success');
      await newVisit('モバイル入力の施設'); await page.locator('.gps-status').filter({ hasText: /GPS地点/ }).waitFor();
      assert.ok(await page.locator('.form-dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth + 1));
      if (width === 390) await page.screenshot({ path: 'test-results/step4-mobile-editor.png' });
      await confirm();
      assert.ok(await page.locator('.form-dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth + 1));
      if (width === 390) await page.screenshot({ path: 'test-results/step4-mobile-confirm.png' });
      await cancel();
      for (const screen of ['home', 'timeline', 'review']) {
        await go(screen); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}/${screen}`);
        if (width === 390 && screen === 'review') await page.screenshot({ path: 'test-results/step4-mobile-review.png', fullPage: true });
      }
    }
  });
  await check('実ブラウザのGeolocation APIにテスト座標を与えて登録できる', async () => {
    const real = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: 44.123, longitude: 142.456, accuracy: 10 } });
    const tab = await real.newPage();
    try {
      await tab.goto(base); await seed(tab); await go('timeline', '2026-10-30', tab);
      await newVisit('ブラウザAPIのテスト地点', tab);
      await tab.locator('.gps-status').filter({ hasText: /GPS地点/ }).waitFor();
      await confirm(tab); await save(tab); const visit = (await snapshot(tab)).data.visits.at(-1);
      assert.equal(visit.location.latitude, 44.123); assert.equal(visit.location.longitude, 142.456); assert.equal(visit.locationSource, 'gps');
    } finally { await real.close(); }
  });
  await check('ブラウザプロセス終了・再起動後も新規訪問とGPS情報を保持', async () => {
    const root = fileURLToPath(new URL('../test-results/', import.meta.url)); const profile = await mkdtemp(path.join(root, 'step4-profile-'));
    let persistent;
    try {
      persistent = await chromium.launchPersistentContext(profile, launch); await persistent.addInitScript(installGpsMock);
      let tab = persistent.pages()[0]; await tab.goto(base); await seed(tab); await go('timeline', '2026-10-30', tab);
      await newVisit('再起動後も残す訪問', tab); await tab.locator('.gps-status').filter({ hasText: /GPS地点/ }).waitFor();
      await confirm(tab); await save(tab); const before = await snapshot(tab);
      await persistent.close(); persistent = undefined;
      persistent = await chromium.launchPersistentContext(profile, launch);
      tab = persistent.pages()[0]; await tab.goto(`${base}#/review`);
      await tab.getByRole('heading', { name: '再起動後も残す訪問', exact: true }).waitFor();
      assert.deepEqual(await snapshot(tab), before);
    } finally {
      if (persistent) await persistent.close();
      const relative = path.relative(root, profile);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Profile outside test-results');
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
  await check('JavaScript例外・コンソールエラーなし、常時位置追跡なし', async () => {
    assert.deepEqual(errors, []); assert.equal(await page.evaluate(() => gpsHarness.watchCalls), 0);
  });
} finally { await context.close(); await browser.close(); }
console.log(`\n${checks.length}/20 Step 4 browser checks passed (Edge; GPS uses synthetic test positions, not a physical iPhone).`);
