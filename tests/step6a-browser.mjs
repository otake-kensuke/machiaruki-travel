import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const launch = { channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true };
const workerSource = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const pattern = /const SHELL = (\{[\s\S]*?\});/;
const shell = JSON.parse(workerSource.match(pattern)[1]);
const original = new Map(await Promise.all(shell.assets.map(async asset => [asset.path.slice(2), await readFile(new URL(`../${asset.path}`, import.meta.url))])));
const sample = JSON.parse(original.get('samples/hokkaido-2026.sample.json').toString());
const version = (id, changes = {}) => {
  const files = new Map(original);
  for (const [name, value] of Object.entries(changes)) files.set(name, Buffer.from(value));
  const manifest = { release: id, assets: shell.assets.map(asset => ({ ...asset, sha256: createHash('sha256').update(asset.text ? files.get(asset.path.slice(2)).toString().replace(/\r\n/g, '\n') : files.get(asset.path.slice(2))).digest('hex') })) };
  files.set('sw.js', Buffer.from(workerSource.replace(pattern, `const SHELL = ${JSON.stringify(manifest)};`)));
  return files;
};
const v1 = version('offline-test-v1');
const v2 = version('offline-test-v2', {
  'index.html': original.get('index.html').toString().replace('<body>', '<body data-test-release="v2">'),
  'src/app.js': original.get('src/app.js').toString() + '\ndocument.body.dataset.testModule = "v2";\n'
});
let served = v1;
let failPath = null;
const networkRequests = [];
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer((request, response) => {
  let name = new URL(request.url, 'http://localhost').pathname;
  networkRequests.push({ name, method: request.method });
  if (name.startsWith('/machiaruki-travel/')) name = name.slice('/machiaruki-travel'.length);
  name = name === '/' ? 'index.html' : name.slice(1);
  const bytes = served.get(name);
  if (!bytes || name === failPath) { response.writeHead(503); response.end('Synthetic incomplete release'); return; }
  response.writeHead(200, { 'Content-Type': `${types[path.extname(name)] || 'text/plain'}; charset=utf-8`, 'Cache-Control': 'no-store' });
  response.end(bytes);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(launch);
const checks = [];
const pageErrors = [];
const resultRoot = fileURLToPath(new URL('../test-results/', import.meta.url));
await mkdir(resultRoot, { recursive: true });
async function check(name, fn) { await fn(); checks.push(name); console.log(`PASS ${name}`); }
async function context(options = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1365, height: 1000 }, acceptDownloads: true, ...options });
  ctx.setDefaultTimeout(15000);
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition(ok, fail) { queueMicrotask(() => fail({ code: 1 })); } } }));
  ctx.on('page', page => page.on('pageerror', error => pageErrors.push(error.message)));
  return ctx;
}
async function ready(page, url = base) {
  await page.goto(url); await page.locator('#offline-panel[data-state=ready]').waitFor();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
}
async function state(page) { return page.evaluate(async () => (await import('./src/storage.js')).loadWorkspace()); }
async function seed(page) { await page.evaluate(async data => (await import('./src/storage.js')).addDataset(data), sample.data); await page.reload(); }
async function visit(page, name) {
  await page.getByRole('button', { name: '＋ 訪問記録を追加', exact: true }).click();
  await page.getByLabel('施設名（必須）', { exact: true }).fill(name);
  await page.getByLabel('訪問日（必須）').fill('2026-10-30');
  await page.getByRole('button', { name: '内容を確認', exact: true }).click();
  await page.getByRole('button', { name: 'この内容で保存', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.form-dialog'));
}
async function download(page, name) {
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click();
  const file = await pending; const chunks = []; for await (const chunk of await file.createReadStream()) chunks.push(chunk);
  assert.equal(await file.failure(), null); return JSON.parse(Buffer.concat(chunks).toString());
}
async function workerStatus(page) {
  return page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return new Promise(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = e => resolve(e.data); reg.active.postMessage({ type: 'SHELL_STATUS' }, [channel.port2]); });
  });
}

try {
  await check('初回オンラインで全必要ファイルを検証・キャッシュしDBを初期化しない', async () => {
    const ctx = await context(); const page = await ctx.newPage(); await ready(page);
    assert.equal((await workerStatus(page)).complete, true); assert.equal((await state(page)).revision, 0);
    assert.equal(await page.evaluate(() => !!navigator.serviceWorker.controller), false);
    const count = await page.evaluate(async () => { const cache = await caches.open((await caches.keys())[0]); return (await cache.keys()).length; });
    assert.equal(count, shell.assets.length); await ctx.close();
  });
  for (const suffix of ['', 'machiaruki-travel/']) {
    await check(`オンライン→オフライン起動→予定編集・訪問→再起動→オンライン復帰 (${suffix || 'root'})`, async () => {
      const ctx = await context(); let page = await ctx.newPage(); const url = base + suffix;
      await ready(page, url); await seed(page); const originalState = await state(page);
      await ctx.setOffline(true); await page.close(); page = await ctx.newPage();
      // Disable ordinary HTTP cache: service-worker CacheStorage must provide every file.
      const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await page.goto(`${url}#/timeline?date=2026-10-30`); await page.getByRole('button', { name: '大通公園を散策を編集', exact: true }).click();
      await page.getByLabel('施設名・予定名（必須）').fill('通信断で編集した予定'); await page.getByRole('button', { name: '保存する', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('.form-dialog'));
      await visit(page, '通信断の訪問'); const saved = await state(page);
      assert.equal(saved.data.visits.length, originalState.data.visits.length + 1); assert.equal(saved.data.visits.at(-1).location, null);
      assert.equal(saved.data.plans.find(plan => plan.name === '通信断で編集した予定').id, originalState.data.plans.find(plan => plan.name === '大通公園を散策').id);
      await page.close(); page = await ctx.newPage(); await page.goto(`${url}#/review`);
      await page.getByRole('heading', { name: '通信断の訪問', exact: true }).waitFor(); assert.deepEqual(await state(page), saved);
      assert.match(await page.locator('.visit-actions').first().innerText(), /オンライン接続が必要/);
      for (const width of [390, 320]) { await page.setViewportSize({ width, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); }
      await page.screenshot({ path: path.join(resultRoot, `step6a-mobile-${suffix ? 'subpath' : 'root'}.png`) });
      await ctx.setOffline(false); await page.locator('#offline-retry').click(); await page.locator('#offline-panel[data-state=ready]').waitFor();
      assert.deepEqual(await state(page), saved); await ctx.close();
    });
  }
  await check('オフラインで実JSONバックアップ・退避・全件復元が一致', async () => {
    const ctx = await context(); const page = await ctx.newPage(); await ready(page); await seed(page); await ctx.setOffline(true); await page.reload();
    const before = await state(page); await page.getByRole('button', { name: 'バックアップを保存', exact: true }).click();
    const backup = await download(page, 'JSONをダウンロード'); assert.deepEqual(backup.data, before.data);
    await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
    await page.evaluate(async () => { const storage = await import('./src/storage.js'); const current = await storage.loadWorkspace(); await storage.saveVisit({ tripId: current.data.trips[0].id, planId: null, name: '退避に残す記録', address: '', memo: '', visitedAt: new Date().toISOString(), location: null, locationSource: 'none' }); });
    const newer = await state(page);
    await page.getByRole('button', { name: 'バックアップから復元', exact: true }).click();
    await page.locator('#restore-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.getByRole('button', { name: '復元前の退避JSONを準備', exact: true }).click();
    const safety = await download(page, '退避JSONをダウンロード'); assert.deepEqual(safety.data, newer.data);
    await page.getByLabel(/退避JSONを安全な保存先/).check(); await page.getByLabel(/現在データがすべて置き換わる/).check();
    await page.getByRole('button', { name: '全データを置き換えて復元', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('.form-dialog'));
    assert.deepEqual((await state(page)).data, before.data); await ctx.close();
  });
  await check('新版待機中も旧版に固定・入力保持・全タブ終了後だけ更新・データ維持', async () => {
    served = v1; const ctx = await context(); let page = await ctx.newPage(); await ready(page); await seed(page);
    await page.evaluate(async () => { await caches.open('another-app-cache'); await caches.open(`machiaruki-travel-shell:${encodeURIComponent(location.origin + '/unrelated/')}:old`); });
    const before = await state(page); await page.goto(`${base}#/timeline?date=2026-10-30`);
    await page.getByRole('button', { name: '大通公園を散策を編集', exact: true }).click(); await page.getByLabel('施設名・予定名（必須）').fill('更新前の入力途中');
    const sibling = await ctx.newPage(); await ready(sibling);
    served = v2; await sibling.locator('#offline-retry').click(); await sibling.locator('#offline-panel[data-state=update]').waitFor();
    assert.equal(await page.getByLabel('施設名・予定名（必須）').inputValue(), '更新前の入力途中'); assert.deepEqual(await state(page), before);
    await sibling.reload(); assert.equal(await sibling.locator('body').getAttribute('data-test-release'), null);
    assert.equal(await sibling.evaluate(async () => (await fetch('./src/app.js')).text()).then(text => text.includes('testModule')), false);
    await page.getByRole('button', { name: 'キャンセル', exact: true }).click(); await page.close();
    assert.equal((await workerStatus(sibling)).release, 'offline-test-v1'); await sibling.close();
    page = await ctx.newPage(); await ready(page); assert.equal(await page.locator('body').getAttribute('data-test-release'), 'v2');
    assert.equal(await page.locator('body').getAttribute('data-test-module'), 'v2'); assert.deepEqual(await state(page), before);
    const names = await page.evaluate(() => caches.keys());
    assert.ok(names.includes('another-app-cache')); assert.ok(names.some(name => name.includes('unrelated'))); assert.ok(!names.some(name => name.endsWith(':offline-test-v1')));
    await ctx.setOffline(true); await page.reload(); assert.equal(await page.locator('body').getAttribute('data-test-module'), 'v2'); await ctx.close(); served = v1;
  });
  await check('不完全な新版・hash不一致では切替せず旧版とDBを保護', async () => {
    served = v1; const ctx = await context(); const page = await ctx.newPage(); await ready(page); await seed(page); const before = await state(page);
    for (const corrupt of ['missing', 'hash']) {
      served = new Map(v2); if (corrupt === 'missing') failPath = 'src/maps.js'; else served.set('src/maps.js', Buffer.from('throw new Error("wrong release");'));
      await page.locator('#offline-retry').click(); await page.locator('#offline-panel[data-state=error]').waitFor();
      await page.waitForFunction(async () => !(await navigator.serviceWorker.getRegistration()).installing);
      assert.equal((await workerStatus(page)).release, 'offline-test-v1'); assert.deepEqual(await state(page), before);
      assert.ok(!(await page.evaluate(() => caches.keys())).some(name => name.endsWith(':offline-test-v2')));
      failPath = null; served = v1;
    }
    await ctx.setOffline(true); await page.reload(); await page.getByRole('heading', { name: sample.data.trips[0].name }).waitFor(); assert.deepEqual(await state(page), before);
    await ctx.setOffline(false);
    // Byte-only worker update keeps the same normalized content release and live cache.
    served = new Map(v1); served.set('sw.js', Buffer.from(v1.get('sw.js').toString().replace(/\r?\n/g, '\r\n'))); failPath = 'src/maps.js';
    await page.locator('#offline-retry').click(); await page.locator('#offline-panel[data-state=update]').waitFor();
    assert.equal((await workerStatus(page)).complete, true); assert.deepEqual(await state(page), before);
    await ctx.close(); served = v1; failPath = null;
  });
  await check('キャッシュ欠損を検出し新版ファイルへ混在せず、オンライン再準備で回復', async () => {
    const ctx = await context(); const page = await ctx.newPage(); await ready(page); await seed(page); const before = await state(page);
    await page.evaluate(async () => { const cache = await caches.open((await caches.keys())[0]); await cache.delete(new URL('./src/maps.js', location.href).href); });
    const response = await page.evaluate(async () => { const response = await fetch('./src/maps.js'); return response.status; }); assert.equal(response, 503);
    assert.equal((await workerStatus(page)).complete, false);
    await page.locator('#offline-retry').click(); await page.locator('#offline-panel[data-state=ready]').waitFor();
    assert.equal((await workerStatus(page)).complete, true); assert.deepEqual(await state(page), before); await ctx.close();
  });
  await check('初回キャッシュ失敗は完了と表示せず、旅行データを消さず再試行できる', async () => {
    failPath = 'assets/icons/icon-512.png'; const ctx = await context(); const page = await ctx.newPage();
    await page.goto(base); await page.locator('#offline-panel[data-state=error]').waitFor();
    await page.evaluate(async data => (await import('./src/storage.js')).addDataset(data), sample.data); const before = await state(page);
    failPath = null; await page.locator('#offline-retry').click(); await page.locator('#offline-panel[data-state=ready]').waitFor(); assert.deepEqual(await state(page), before);
    await ctx.close();
  });
  await check('アプリ起動前にキャッシュ全体が消えても再準備画面から復旧しDBを維持', async () => {
    const ctx = await context(); const page = await ctx.newPage(); await ready(page); await seed(page); const before = await state(page);
    await page.evaluate(async () => { for (const name of await caches.keys()) await caches.delete(name); });
    await ctx.setOffline(true); await page.reload(); await page.getByRole('heading', { name: 'アプリのキャッシュが不足しています' }).waitFor();
    await ctx.setOffline(false); await page.getByRole('button', { name: 'オンラインで再準備する' }).click();
    await page.locator('#offline-panel[data-state=ready]').waitFor(); assert.deepEqual(await state(page), before); await ctx.close();
  });
  await check('ブラウザプロセス終了後もオフライン起動と全記録を維持', async () => {
    const profile = await mkdtemp(path.join(resultRoot, 'step6a-profile-')); let ctx;
    try {
      ctx = await chromium.launchPersistentContext(profile, launch); let page = ctx.pages()[0]; await ready(page); await seed(page); const before = await state(page); await ctx.close(); ctx = null;
      ctx = await chromium.launchPersistentContext(profile, launch); await ctx.setOffline(true); page = ctx.pages()[0]; await ready(page); assert.deepEqual(await state(page), before);
    } finally {
      if (ctx) await ctx.close(); const relative = path.relative(resultRoot, profile); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Profile outside test-results');
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
  await check('固定対象以外をキャッシュせず、旅行データの送信・ページ例外なし', async () => {
    const ctx = await context(); const page = await ctx.newPage(); await ready(page); await page.reload();
    const paths = await page.evaluate(async () => {
      await fetch('./unlisted.json'); const cache = await caches.open((await caches.keys())[0]); return (await cache.keys()).map(request => new URL(request.url).pathname);
    });
    assert.equal(paths.length, shell.assets.length); assert.ok(!paths.includes('/unlisted.json')); await ctx.close();
    assert.ok(networkRequests.every(request => request.method === 'GET')); assert.deepEqual(pageErrors, []);
  });
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
console.log(`\n${checks.length} Step 6A browser checks passed. iPhone Safari and native home-screen lifecycle are not tested.`);
