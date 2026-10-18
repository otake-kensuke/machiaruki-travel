import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const base = 'https://otake-kensuke.github.io/machiaruki-travel/';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const itinerary = JSON.parse(await readFile(new URL('../samples/hokkaido-2026.itinerary.json', import.meta.url), 'utf8'));
for (const rows of Object.values(itinerary.data)) for (const row of rows) for (const key of ['id', 'tripId', 'planId', 'dayId']) if (row[key]) row[key] = 'public-check-' + row[key];
itinerary.data.trips[0].name = '公開確認用の架空旅程';
itinerary.data.trips[0].isSample = true;
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
// A fresh, isolated profile. Only fictional fixtures are used; never a user's browser data.
const context = await browser.newContext({ viewport: { width: 1365, height: 1000 }, acceptDownloads: true });
context.setDefaultTimeout(60000);
await context.addInitScript(() => Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition(success, failure) { queueMicrotask(() => failure({ code: 1 })); } } }));
const requests = []; const errors = []; const checks = [];
context.on('request', request => requests.push({ url: request.url(), method: request.method(), body: request.postData() }));
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
let page = await context.newPage();
async function check(name, work) { await work(); checks.push(name); console.log(`PASS ${name}`); }
async function state() { return page.evaluate(async () => (await import('./src/storage.js')).loadWorkspace()); }
async function go(screen = 'home') { await page.goto(`${base}#/${screen}?date=2026-10-30`); await page.waitForFunction(() => !document.querySelector('.loading')); }
async function cancel() { await page.getByRole('button', { name: 'キャンセル', exact: true }).click(); }
async function download(name) {
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click();
  const file = await pending; assert.equal(await file.failure(), null); const chunks = [];
  for await (const chunk of await file.createReadStream()) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function saveVisit(name, fromPlan = false) {
  await page.getByRole('button', { name: fromPlan ? '大通公園を散策の訪問を記録' : '＋ 訪問記録を追加', exact: true }).click();
  await page.getByLabel('施設名（必須）', { exact: true }).fill(name); await page.getByLabel('訪問日（必須）').fill('2026-10-30');
  await page.getByRole('button', { name: '内容を確認', exact: true }).click();
  await page.getByRole('button', { name: 'この内容で保存', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('.form-dialog'));
}
try {
  await check('HTTPSのサブディレクトリで初回起動・データ未初期化・オフライン準備', async () => {
    const response = await page.goto(base); assert.equal(response.status(), 200); assert.equal(new URL(page.url()).protocol, 'https:');
    await page.locator('#offline-panel[data-state=ready]').waitFor(); assert.equal((await state()).revision, 0);
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope); assert.equal(scope, base);
  });
  await check('明示サンプル追加・旅行ホーム・予定と実績・振り返り', async () => {
    await page.getByRole('button', { name: 'サンプル旅程を読み込む', exact: true }).click();
    await page.getByRole('button', { name: 'この端末に読み込む', exact: true }).click(); await page.getByRole('heading', { name: '秋の北海道、街を歩く。' }).waitFor();
    for (const screen of ['timeline', 'review', 'home']) { await go(screen); assert.ok(await page.locator('main h1').innerText()); }
    assert.equal((await state()).data.visits.length, 2);
  });
  await check('旅程JSONを全件プレビューし確認後に追加・既存訪問保持', async () => {
    const before = await state(); await page.getByRole('button', { name: '旅程JSONを取り込む', exact: true }).click();
    await page.locator('input[type=file]').setInputFiles({ name: 'fictional-itinerary.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(itinerary)) });
    await page.getByRole('button', { name: '確認して追加する', exact: true }).waitFor(); assert.deepEqual(await state(), before);
    await page.getByRole('button', { name: '確認して追加する', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('.form-dialog'));
    const after = await state(); assert.equal(after.data.trips.length, 2); assert.deepEqual(after.data.visits, before.data.visits);
  });
  await check('予定の編集を保存し再読込後も維持', async () => {
    await go('timeline'); await page.getByRole('button', { name: '新千歳空港に到着を編集', exact: true }).click();
    await page.getByLabel('メモ（任意）', { exact: true }).fill('公開動作確認用の仮メモ'); await page.getByRole('button', { name: '保存する', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.form-dialog')); const before = await state(); await page.reload(); assert.deepEqual(await state(), before);
  });
  await check('予定から座標なし訪問を保存し振り返り・マップ案内を表示', async () => {
    await go('timeline'); await saveVisit('公開確認用の仮訪問', true); const visit = (await state()).data.visits.at(-1);
    assert.ok(visit.planId); assert.equal(visit.location, null); await go('review'); await page.getByRole('heading', { name: '公開確認用の仮訪問', exact: true }).waitFor();
    assert.match(await page.locator('.visit-actions').first().innerText(), /オンライン接続が必要/);
  });
  await check('実JSON出力・復元前退避・確認後の全件復元が一致', async () => {
    await go(); const before = await state(); await page.getByRole('button', { name: 'バックアップを保存', exact: true }).click();
    const backup = await download('JSONをダウンロード'); assert.equal(backup.kind, 'backup'); assert.deepEqual(backup.data, before.data); await cancel();
    await go('timeline'); await saveVisit('退避確認用の仮訪問'); const newer = await state(); await go();
    await page.getByRole('button', { name: 'バックアップから復元', exact: true }).click();
    await page.locator('#restore-file').setInputFiles({ name: 'fictional-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.getByRole('button', { name: '復元前の退避JSONを準備', exact: true }).click(); const safety = await download('退避JSONをダウンロード'); assert.deepEqual(safety.data, newer.data);
    await page.getByLabel(/退避JSONを安全な保存先/).check(); await page.getByLabel(/現在データがすべて置き換わる/).check();
    await page.getByRole('button', { name: '全データを置き換えて復元', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('.form-dialog'));
    assert.deepEqual((await state()).data, before.data);
  });
  await check('オフライン起動→訪問保存→再起動→オンライン復帰でも維持', async () => {
    await page.locator('#offline-panel[data-state=ready]').waitFor(); await context.setOffline(true); await page.close(); page = await context.newPage();
    const cdp = await context.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await go('timeline'); await saveVisit('オフライン公開確認用の仮訪問'); const saved = await state();
    await page.close(); page = await context.newPage(); await go('review'); await page.getByRole('heading', { name: 'オフライン公開確認用の仮訪問', exact: true }).waitFor();
    assert.deepEqual(await state(), saved); await context.setOffline(false); await page.locator('#offline-retry').click(); await page.locator('#offline-panel[data-state=ready]').waitFor(); assert.deepEqual(await state(), saved);
  });
  await check('PC/スマートフォン幅・訪問情報の送信なし・ページ例外なし', async () => {
    await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 }); for (const screen of ['home', 'timeline', 'review']) { await go(screen); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); }
    }
    await go(); await page.screenshot({ path: 'test-results/public-mobile-home.png' });
    // Edge's download panel also emits local edge:// / chrome:// resource events.
    // These are browser UI files; inspect every actual HTTP(S) network request here.
    const network = requests.filter(request => ['http:', 'https:'].includes(new URL(request.url).protocol));
    assert.deepEqual(errors, []); assert.ok(network.every(request => ['GET', 'HEAD'].includes(request.method) && request.body === null));
    assert.deepEqual(network.filter(request => !request.url.startsWith(base)).map(request => ({ method: request.method, target: new URL(request.url).origin + new URL(request.url).pathname })), []);
    assert.ok(network.every(request => new URL(request.url).search === '' && !decodeURIComponent(request.url).includes('公開確認用の仮訪問')));
  });
} finally { await context.close(); await browser.close(); }
console.log(`\n${checks.length} public HTTPS checks passed using fictional data in an isolated Edge context. Physical iPhone Safari is not tested.`);
