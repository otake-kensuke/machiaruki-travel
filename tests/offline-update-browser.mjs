import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { validateEnvelope } from '../src/validation.js';

// Every case has a fresh loopback Origin and browser context. Never open production.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const pattern = /const SHELL = (\{[\s\S]*?\});/;
const shell = JSON.parse(source.match(pattern)[1]);
const files = new Map(await Promise.all(shell.assets.map(async asset => [asset.path.slice(2), await readFile(new URL(`../${asset.path}`, import.meta.url))])));
const sample = JSON.parse(files.get('samples/hokkaido-2026.sample.json'));
function version(id) {
  const result = new Map(files);
  result.set('index.html', Buffer.from(files.get('index.html').toString().replace('<body>', `<body data-update-test="${id}">`)));
  const manifest = { ...shell, release: id, assets: shell.assets.map(asset => ({ ...asset, sha256: createHash('sha256').update(asset.text ? result.get(asset.path.slice(2)).toString().replace(/\r\n/g, '\n') : result.get(asset.path.slice(2))).digest('hex') })) };
  result.set('sw.js', Buffer.from(source.replace(pattern, `const SHELL = ${JSON.stringify(manifest)};`)));
  return result;
}
const first = version('warn-test-v1'), second = version('warn-test-v2');
async function baseline() {
  const git = filename => {
    const result = spawnSync('git', ['show', `7e9de1de40af8c8e9f89432dd5ea50a6bc3073db:${filename}`], { maxBuffer: 24 * 1024 * 1024 });
    assert.equal(result.status, 0, 'Read-only baseline inspection'); return result.stdout;
  };
  const worker = git('sw.js');
  const manifest = JSON.parse(worker.toString().match(pattern)[1]);
  return new Map([...manifest.assets.map(asset => [asset.path.slice(2), git(asset.path.slice(2))]), ['sw.js', worker]]);
}
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const prefix = '/machiaruki-travel/';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const checks = [];
async function check(name, fn) { await fn(); checks.push(name); console.log(`PASS ${name}`); }
async function snapshot(page, base) {
  return page.evaluate(async base => {
    const registration = await navigator.serviceWorker.getRegistration(base);
    const ask = worker => !worker ? null : new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); reject(new Error('Worker status timeout')); }, 5000);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve({ ...event.data, state: worker.state }); };
      worker.postMessage({ type: 'SHELL_STATUS' }, [channel.port2]);
    });
    return { active: await ask(registration?.active), waiting: await ask(registration?.waiting), installing: Boolean(registration?.installing), controlled: Boolean(navigator.serviceWorker.controller), panel: document.querySelector('#offline-panel')?.dataset.state, text: document.querySelector('#offline-status')?.textContent };
  }, base);
}
async function allRecords(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('machiaruki-travel', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, transaction = db.transaction('workspace'), store = transaction.objectStore('workspace');
      const keys = store.getAllKeys(), values = store.getAll();
      transaction.oncomplete = () => { resolve({ name: db.name, version: db.version, stores: [...db.objectStoreNames], entries: keys.result.map((key, i) => [key, values.result[i]]) }); db.close(); };
      transaction.onabort = () => reject(transaction.error);
    };
  }));
}
async function seed(page, data, fullMetadata = true) {
  await page.evaluate(async ({ data, fullMetadata }) => {
    const storage = await import('./src/storage.js'), { createBackup } = await import('./src/backups.js');
    let current = await storage.addDataset(data);
    const now = new Date().toISOString();
    current = await storage.saveVisit({ tripId: data.trips[0].id, planId: data.plans[0]?.id || null,
      name: '更新試験の仮GPS訪問', address: '', memo: '合成座標。実際の訪問ではありません。', visitedAt: now,
      location: { latitude: 43, longitude: 141, accuracy: 8, capturedAt: now }, locationSource: 'gps' });
    let envelope = createBackup(current.data);
    // Exercise every legitimate store key with fictional data, without UI/network export.
    if (fullMetadata) {
      const ticket = await storage.stageRestore(current, current.data, envelope);
      await storage.recordSafetyExport(ticket, { envelope, filename: 'test-safety.json' }, 'download-requested');
      current = await storage.restoreWorkspace(ticket, { safetyConfirmed: true, replacementConfirmed: true });
      envelope = createBackup(current.data);
      await storage.stageRestore(current, current.data, envelope);
    }
    await storage.recordBackupExport({ envelope, filename: 'test-backup.json' }, current.revision, 'download-requested');
    document.dispatchEvent(new Event('visibilitychange'));
  }, { data, fullMetadata });
  await page.getByRole('heading', { name: data.trips[0].name, exact: true }).waitFor();
}
async function retry(page) {
  await page.locator('#offline-details').evaluate(node => { node.open = true; });
  await page.locator('#offline-retry').click();
}
async function waitForActive(page, base, release) {
  await page.waitForFunction(async ({ base, release }) => {
    const reg = await navigator.serviceWorker.getRegistration(base);
    if (reg?.active?.state !== 'activated' || reg.installing || reg.waiting) return false;
    return new Promise(resolve => {
      const channel = new MessageChannel(); const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 1000);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data.release === release && event.data.complete); };
      reg.active.postMessage({ type: 'SHELL_STATUS' }, [channel.port2]);
    });
  }, { base, release });
}
async function fixture(fn, initial = first) {
  let served = initial, fail = null;
  const errors = [], external = [];
  const server = createServer((req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/observer') { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); res.end('<!doctype html><title>Local update observer</title>'); return; }
    const key = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || 'index.html' : null;
    const bytes = key && key !== fail && served.get(key);
    res.writeHead(bytes ? 200 : 503, { 'Content-Type': types[path.extname(key || '')] || 'text/plain', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : bytes || 'Synthetic preparation failure');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, base = origin + prefix;
  const context = await browser.newContext({ viewport: { width: 393, height: 852 } }); context.setDefaultTimeout(20000);
  await context.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); external.push(route.request().url()); return route.abort(); });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  try {
    await fn({ context, base, setVersion: files => { served = files; }, setFailure: name => { fail = name; },
      async open() { const page = await context.newPage(); await page.goto(base); return page; },
      async reopenAfterActivation(release, before, marker = true) {
        for (const page of context.pages()) await page.close();
        // This observer is outside the app scope, so it cannot hold the old worker alive.
        const observer = await context.newPage(); await observer.goto(origin + '/observer'); await waitForActive(observer, base, release); await observer.close();
        let page = await context.newPage(); await page.goto(base); await page.locator('#offline-panel[data-state=ready]').waitFor();
        if (marker) assert.equal(await page.locator('body').getAttribute('data-update-test'), 'warn-test-v2');
        assert.deepEqual(await allRecords(page), before);
        await context.setOffline(true); await page.close(); page = await context.newPage();
        const cdp = await context.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        await page.goto(base); await page.locator('#offline-panel[data-state=ready]').waitFor(); assert.deepEqual(await allRecords(page), before);
        if (marker) assert.equal(await page.locator('body').getAttribute('data-update-test'), 'warn-test-v2');
        await context.setOffline(false);
      }
    });
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
  } finally { await context.close(); await new Promise(resolve => server.close(resolve)); }
}
try {
  await check('初回未制御ページの正常交代で誤エラーなし・再起動案内・DB全4キー保持・オフライン起動', () => fixture(async f => {
    const page = await f.open(); await page.locator('#offline-panel[data-state=ready]').waitFor();
    assert.equal((await snapshot(page, f.base)).controlled, false); await seed(page, sample.data);
    const before = await allRecords(page); assert.deepEqual(before.entries.map(([key]) => key), ['active', 'backup-status', 'restore-pending', 'restore-previous']);
    await page.evaluate(() => { window.updateErrors = []; new MutationObserver(() => { if (document.querySelector('#offline-panel').dataset.state === 'error') updateErrors.push(document.querySelector('#offline-status').textContent); }).observe(document.querySelector('#offline-panel'), { attributes: true, attributeFilter: ['data-state'] }); });
    f.setVersion(second); await retry(page); await waitForActive(page, f.base, 'warn-test-v2'); await page.locator('#offline-panel[data-state=ready]').waitFor();
    const status = await snapshot(page, f.base); assert.equal(status.controlled, false); assert.match(status.text, /現在の画面は切り替わりません/); assert.match(status.text, /全タブ・ウィンドウを閉じて開き直す/);
    assert.equal(await page.locator('body').getAttribute('data-update-test'), 'warn-test-v1'); assert.deepEqual(await page.evaluate(() => updateErrors), []);
    assert.deepEqual(await allRecords(page), before); await f.reopenAfterActivation('warn-test-v2', before);
  }));
  await check('制御済みページ・別タブ・入力中は新版待機、全画面終了後だけ更新しDB全値を保持', () => fixture(async f => {
    const page = await f.open(); await page.locator('#offline-panel[data-state=ready]').waitFor(); await seed(page, sample.data); await page.reload();
    assert.equal((await snapshot(page, f.base)).controlled, true); const before = await allRecords(page);
    await page.goto(f.base + '#/timeline?date=2026-10-30'); await page.getByRole('button', { name: '大通公園を散策を編集', exact: true }).click(); await page.getByLabel('施設名・予定名（必須）').fill('保存前のテスト入力');
    const sibling = await f.open(); await sibling.locator('#offline-panel[data-state=ready]').waitFor(); f.setVersion(second); await retry(sibling); await sibling.locator('#offline-panel[data-state=update]').waitFor();
    assert.match((await snapshot(sibling, f.base)).text, /現在は開いている画面の版を利用中/); assert.equal(await page.getByLabel('施設名・予定名（必須）').inputValue(), '保存前のテスト入力');
    await sibling.reload(); assert.equal(await sibling.locator('body').getAttribute('data-update-test'), 'warn-test-v1'); assert.deepEqual(await allRecords(sibling), before);
    await page.getByRole('button', { name: 'キャンセル', exact: true }).click(); await f.reopenAfterActivation('warn-test-v2', before);
  }));
  await check('準備中に即時再起動して旧画面が残っても更新案内、全画面終了後に切替', () => fixture(async f => {
    let page = await f.open(); await page.locator('#offline-panel[data-state=ready]').waitFor(); await seed(page, sample.data); const before = await allRecords(page);
    f.setVersion(second); await retry(page); await page.close(); page = await f.open();
    // Timing permits either a waiting old page or an already activated new page.
    await page.locator('#offline-panel:is([data-state=ready],[data-state=update])').waitFor();
    const state = await snapshot(page, f.base); if (state.waiting) assert.match(state.text, /全タブ・ウィンドウを閉じ/);
    assert.doesNotMatch(state.text, /失敗しました/); await f.reopenAfterActivation('warn-test-v2', before);
  }));
  for (const controlled of [false, true]) await check(`${controlled ? '制御済み更新' : '初回未制御'}の実インストール失敗をエラー表示しDB維持・再試行可能`, () => fixture(async f => {
    if (!controlled) f.setFailure('assets/icons/icon-512.png'); const page = await f.open();
    await page.locator(`#offline-panel[data-state=${controlled ? 'ready' : 'error'}]`).waitFor();
    await seed(page, sample.data); if (controlled) await page.reload(); const before = await allRecords(page);
    if (controlled) { f.setVersion(second); f.setFailure('src/maps.js'); await retry(page); await page.locator('#offline-panel[data-state=error]').waitFor(); }
    assert.deepEqual(await allRecords(page), before); f.setFailure(null); await retry(page);
    if (controlled) { await page.locator('#offline-panel[data-state=update]').waitFor(); await f.reopenAfterActivation('warn-test-v2', before); }
    else { await page.locator('#offline-panel[data-state=ready]').waitFor(); assert.deepEqual(await allRecords(page), before); }
  }));
  const old = await baseline();
  const current = new Map(files); current.set('sw.js', Buffer.from(source));
  const privateBytes = process.env.UI_PRIVATE_ITINERARY ? await readFile(process.env.UI_PRIVATE_ITINERARY) : null;
  const data = privateBytes ? validateEnvelope(JSON.parse(privateBytes)) : sample.data;
  await check('公開基準版から修正版へ更新・既存予定/仮訪問/出力履歴を再取込なしで保持・オフライン起動', () => fixture(async f => {
    const page = await f.open(); await page.locator('#offline-panel[data-state=ready]').waitFor(); await seed(page, data, false); await page.reload();
    const before = await allRecords(page); f.setVersion(current); await retry(page); await page.locator('#offline-panel[data-state=update]').waitFor();
    assert.deepEqual(await allRecords(page), before); await f.reopenAfterActivation(shell.release, before, false);
  }, old));
  if (privateBytes) assert.deepEqual(await readFile(process.env.UI_PRIVATE_ITINERARY), privateBytes, 'Private itinerary stays byte-identical');
} finally { await browser.close(); }
console.log(`\n${checks.length} offline update checks passed. iPhone Safari/home-screen lifecycle is not tested. Private input: ${Boolean(process.env.UI_PRIVATE_ITINERARY)}.`);
