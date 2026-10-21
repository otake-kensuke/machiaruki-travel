import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { BRAND } from '../src/brand.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const launch = { channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true };
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4173/';
const legacyRef = process.env.UPGRADE_FROM_REF || '5134eaa';
const sample = JSON.parse(await readFile(new URL('../samples/hokkaido-2026.sample.json', import.meta.url), 'utf8'));
const browser = await chromium.launch(launch); const errors = []; const checks = [];
await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
async function check(name, fn) { await fn(); checks.push(name); console.log(`PASS ${name}`); }
async function context() { const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, acceptDownloads: true }); ctx.setDefaultTimeout(20000); ctx.on('page', page => page.on('pageerror', error => errors.push(error.message))); return ctx; }
async function state(page) { return page.evaluate(async () => (await import('./src/storage.js')).loadWorkspace()); }
async function seed(page, data = sample.data) { await page.evaluate(async data => (await import('./src/storage.js')).addDataset(data), data); await page.reload(); await page.getByRole('heading', { name: data.trips[0].name, exact: true }).waitFor(); }
async function download(page, name = 'JSONをダウンロード') { const pending = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); const file = await pending; const chunks = []; for await (const chunk of await file.createReadStream()) chunks.push(chunk); assert.equal(await file.failure(), null); return JSON.parse(Buffer.concat(chunks).toString()); }
async function waitImages(page) { await page.evaluate(() => Promise.all([...document.images].map(img => img.decode().catch(() => {})))); }
const stamp = '2026-10-20T00:00:00Z';
const custom = {
  trips: [{ id: 'generic-trip', name: '京都の春を、ゆっくり歩く。', startDate: '2028-04-01', endDate: '2028-04-05', timeZone: 'Asia/Tokyo', memo: '動作確認用の架空旅程', createdAt: stamp, updatedAt: stamp }],
  days: [{ id: 'spring-first', tripId: 'generic-trip', date: '2028-04-01', title: '最初の日の自由な散歩', createdAt: stamp, updatedAt: stamp }, { id: 'spring-last', tripId: 'generic-trip', date: '2028-04-05', title: '最後の日の自由な散歩', createdAt: stamp, updatedAt: stamp }],
  plans: [], transportations: [], accommodations: [], visits: []
};
try {
  await check('表示名・PWA・未保存の汎用ホーム・オフライン詳細の折りたたみ', async () => {
    const ctx = await context(); const page = await ctx.newPage(); await page.goto(base); await page.locator('#offline-panel[data-state=ready]').waitFor();
    assert.match(await page.title(), /旅あるき/); assert.equal(await page.locator('[data-brand-name]').first().innerText(), BRAND.name);
    const manifest = await page.evaluate(() => fetch('./manifest.webmanifest').then(response => response.json())); assert.equal(manifest.short_name, BRAND.name); assert.equal(manifest.id, './'); assert.equal(manifest.scope, './');
    assert.equal(await page.locator('meta[name=apple-mobile-web-app-title]').getAttribute('content'), BRAND.name);
    assert.equal(await page.locator('.trip-illustration').getAttribute('data-scenery'), 'generic'); assert.equal((await state(page)).revision, 0);
    assert.equal(await page.locator('#offline-details').evaluate(node => node.open), false); await ctx.close();
  });
  await check('サンプルを固定旅程にせず表示し、背景と3人を別レイヤーにする', async () => {
    const ctx = await context(); const page = await ctx.newPage(); await page.goto(base); await seed(page); await waitImages(page); const before = await state(page);
    assert.equal(await page.locator('.trip-illustration').getAttribute('data-scenery'), 'hokkaido'); assert.equal(await page.locator('.traveler').count(), 3);
    assert.equal(await page.locator('.itinerary-section img').count(), 0); assert.equal(await page.locator('.itinerary-day').count(), 3);
    const boxes = await page.locator('.trip-illustration, .trip-intro, .agenda, .itinerary-section, .travel-resources, .data-management').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top)); assert.ok(boxes.every((top, index) => !index || top >= boxes[index - 1]));
    await page.locator('#home-date').scrollIntoViewIfNeeded(); const scroll = await page.evaluate(() => scrollY);
    await page.locator('#home-date').selectOption('2026-10-31'); await page.getByRole('heading', { name: '選択日の予定', exact: true }).waitFor(); assert.equal(await page.locator('.agenda-row').count(), 3);
    assert.ok(Math.abs((await page.evaluate(() => scrollY)) - scroll) < 10); assert.deepEqual(await state(page), before);
    await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: 'test-results/step7-sample-iphone16.png', fullPage: true });
    await page.setViewportSize({ width: 1365, height: 1000 }); await page.screenshot({ path: 'test-results/step7-desktop.png', fullPage: true }); await ctx.close();
  });
  await check('別地域・変更された日程・交通宿泊なしの旅行を実データから表示', async () => {
    const ctx = await context(); const page = await ctx.newPage(); await page.goto(base); await seed(page, custom); const before = await state(page);
    assert.equal(await page.locator('.trip-illustration').getAttribute('data-scenery'), 'generic'); assert.match(await page.locator('.dashboard-stats').innerText(), /5\s*日間/); assert.equal(await page.locator('.itinerary-day').count(), 2);
    assert.match(await page.locator('.trip-period').innerText(), /2028年4月1日/); assert.doesNotMatch(await page.locator('main').innerText(), /札幌のホテル|羽田|新千歳|10月30日/);
    await page.locator('#transport-details summary').click(); await page.getByText('交通の登録はありません。', { exact: true }).waitFor();
    await page.locator('#stay-details summary').click(); await page.getByText('宿泊の登録はありません。', { exact: true }).waitFor(); assert.doesNotMatch(await page.locator('.travel-resources').innerText(), /予約済み/);
    await page.locator('#home-date').selectOption('2028-04-05'); await page.getByRole('heading', { name: '選択日の予定', exact: true }).waitFor(); assert.match(await page.locator('.agenda .day-number').innerText(), /05/); assert.deepEqual(await state(page), before);
    for (const width of [393, 320, 430]) { await page.setViewportSize({ width, height: 852 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); }
    await page.setViewportSize({ width: 393, height: 852 }); await waitImages(page); await page.screenshot({ path: 'test-results/step7-generic.png', fullPage: true }); await ctx.close();
  });
  await check('旧公開版から更新しても全DBキー・ID・訪問・出力履歴を維持', async () => {
    const git = args => { const result = spawnSync('git', args, { maxBuffer: 32 * 1024 * 1024 }); if (result.status !== 0) throw new Error('Legacy fixture read failed'); return result.stdout; };
    const legacyWorker = git(['show', `${legacyRef}:sw.js`]); const oldShell = JSON.parse(legacyWorker.toString().match(/const SHELL = (\{[\s\S]*?\});/)[1]);
    const currentWorker = await readFile(new URL('../sw.js', import.meta.url)); const currentShell = JSON.parse(currentWorker.toString().match(/const SHELL = (\{[\s\S]*?\});/)[1]);
    const legacy = new Map(oldShell.assets.map(asset => [asset.path.slice(2), git(['show', `${legacyRef}:${asset.path.slice(2)}`])])); legacy.set('sw.js', legacyWorker);
    const oldName = JSON.parse(legacy.get('manifest.webmanifest').toString()).short_name;
    const current = new Map(await Promise.all(currentShell.assets.map(async asset => [asset.path.slice(2), await readFile(new URL(`../${asset.path}`, import.meta.url))]))); current.set('sw.js', currentWorker);
    let files = legacy; const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
    const server = createServer((request, response) => { const pathname = new URL(request.url, 'http://localhost').pathname; const file = pathname === '/' ? 'index.html' : pathname.slice(1); const bytes = files.get(file); if (!bytes) { response.writeHead(404); response.end(); return; } response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/plain', 'Cache-Control': 'no-store' }); response.end(bytes); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const url = `http://127.0.0.1:${server.address().port}/`; const ctx = await context(); let page = await ctx.newPage();
    const allKeys = tab => tab.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open('machiaruki-travel', 1); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const tx = db.transaction('workspace'); const store = tx.objectStore('workspace'); const keys = store.getAllKeys(); const values = store.getAll(); tx.oncomplete = () => { resolve({ version: db.version, entries: keys.result.map((key, index) => [key, values.result[index]]) }); db.close(); }; }; }));
    try {
      await page.goto(url); await page.locator('#offline-panel[data-state=ready]').waitFor(); await seed(page);
      await page.evaluate(async () => { const storage = await import('./src/storage.js'); const data = (await storage.loadWorkspace()).data; await storage.saveVisit({ tripId: data.trips[0].id, planId: data.plans[0].id, name: '旧版からの仮記録', address: '', memo: '更新互換性テスト', visitedAt: '2026-10-30T12:00:00+09:00', location: null, locationSource: 'none' }); });
      await page.getByRole('button', { name: 'バックアップを保存', exact: true }).click(); const backup = await download(page); await page.getByRole('button', { name: 'キャンセル', exact: true }).click(); const before = await allKeys(page);
      files = current; await page.locator('#offline-retry').click(); await page.locator('#offline-panel[data-state=update]').waitFor(); assert.ok((await page.title()).includes(oldName)); assert.deepEqual(await allKeys(page), before);
      await page.close(); page = await ctx.newPage(); await page.goto(url); await page.locator('#offline-panel[data-state=ready]').waitFor(); assert.match(await page.title(), /旅あるき/); assert.deepEqual(await allKeys(page), before);
      await page.getByRole('button', { name: 'バックアップを保存', exact: true }).click(); const afterBackup = await download(page); assert.deepEqual(afterBackup.data, backup.data); assert.equal(afterBackup.appId, backup.appId); assert.equal(afterBackup.schemaVersion, backup.schemaVersion); await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
      await ctx.setOffline(true); await page.close(); page = await ctx.newPage(); await page.goto(`${url}#/review`); await page.getByRole('heading', { name: '旧版からの仮記録', exact: true }).waitFor(); assert.deepEqual((await state(page)).data, backup.data);
    } finally { await ctx.close(); await new Promise(resolve => server.close(resolve)); }
  });
  await check('ページのJavaScript例外なし', async () => assert.deepEqual(errors, []));
} finally { await browser.close(); }
console.log(`\n${checks.length} Step 7 browser checks passed (Edge; physical iPhone Safari is not tested).`);
