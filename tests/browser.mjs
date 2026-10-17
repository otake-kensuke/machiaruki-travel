import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

// Use a locally installed Playwright, or point PLAYWRIGHT_MODULE at a bundled index.mjs.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4173/';
const sample = JSON.parse(await readFile(new URL('../samples/hokkaido-2026.sample.json', import.meta.url), 'utf8'));
const results = [];
await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });

function copyDataset(prefix) {
  const data = structuredClone(sample.data);
  for (const rows of Object.values(data)) for (const row of rows) {
    for (const key of ['id', 'tripId', 'dayId', 'planId']) if (row[key]) row[key] = `${prefix}-${row[key]}`;
  }
  return data;
}
async function check(name, callback) {
  try { await callback(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, passed: false }); console.error(`FAIL ${name}\n${error.stack}`); }
}
async function snapshot(page) {
  return page.evaluate(async () => (await import('./src/storage.js')).loadWorkspace());
}
async function navigate(page, hash) {
  await page.evaluate(value => { location.hash = value; }, hash);
  await page.waitForFunction(() => document.querySelector('main h1, main h2') && !document.querySelector('.loading'));
}
async function add(page, data) {
  return page.evaluate(async value => (await import('./src/storage.js')).addDataset(value), data);
}

const context = await browser.newContext({ viewport: { width: 1365, height: 1000 } });
context.setDefaultTimeout(8000);
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.goto(base);
  await page.getByRole('heading', { name: /予定を持って、\s*記憶を連れて帰る。/ }).waitFor();
  await check('初回起動でデータを書き込まない', async () => {
    assert.equal((await snapshot(page)).revision, 0);
    const active = await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('machiaruki-travel', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('workspace');
        const read = transaction.objectStore('workspace').get('active');
        read.onsuccess = () => resolve(read.result === undefined);
        transaction.oncomplete = () => db.close();
      };
    }));
    assert.equal(active, true);
  });
  await check('空状態でも3画面を移動できる', async () => {
    await page.getByRole('link', { name: '予定・記録', exact: true }).click();
    await page.getByRole('heading', { name: '旅の予定は、これから。' }).waitFor();
    await page.getByRole('link', { name: '振り返り', exact: true }).click();
    await page.getByRole('heading', { name: '旅の記憶を、ここに。' }).waitFor();
    await page.getByRole('link', { name: '旅行ホーム', exact: true }).click();
  });
  await check('サンプル追加をキャンセルすると保存しない', async () => {
    await page.getByRole('button', { name: 'サンプル旅程を読み込む' }).click();
    await page.getByRole('button', { name: 'キャンセル' }).click();
    assert.equal((await snapshot(page)).revision, 0);
  });
  await check('明示操作でサンプル全件を保存・表示', async () => {
    await page.getByRole('button', { name: 'サンプル旅程を読み込む' }).click();
    await page.getByRole('button', { name: 'この端末に読み込む' }).click();
    await page.getByRole('heading', { name: '秋の北海道、街を歩く。' }).waitFor();
    const stored = await snapshot(page);
    assert.equal(stored.revision, 1);
    assert.deepEqual(stored.data, sample.data);
    await page.screenshot({ path: 'test-results/desktop-home.png', fullPage: true });
  });
  await check('予定と実績の統合表示・日付切替・振り返り', async () => {
    await page.getByRole('link', { name: '予定・記録', exact: true }).click();
    await page.getByRole('heading', { name: '今日の予定・訪問記録' }).waitFor();
    assert.equal(await page.locator('.timeline-row').count(), 3);
    assert.match(await page.locator('.visit-inline').innerText(), /訪問 14:12/);
    await page.locator('.date-strip a').nth(1).click();
    await page.waitForFunction(() => document.querySelectorAll('.timeline-row').length === 4);
    assert.match(await page.locator('.timeline').innerText(), /路地の喫茶店/);
    await page.getByRole('link', { name: '振り返り', exact: true }).click();
    await page.getByRole('heading', { name: '旅の振り返り' }).waitFor();
    assert.equal(await page.locator('.memory-card').count(), 2);
    assert.match(await page.locator('.memory-grid').last().innerText(), /位置情報は未設定/);
  });
  await check('再読込・タブ再オープンでID・全データを保持', async () => {
    await page.reload();
    await page.getByRole('heading', { name: '旅の振り返り' }).waitFor();
    assert.deepEqual((await snapshot(page)).data, sample.data);
    const other = await context.newPage();
    await other.goto(base);
    await other.getByRole('heading', { name: '秋の北海道、街を歩く。' }).waitFor();
    assert.deepEqual((await snapshot(other)).data, sample.data);
    await other.close();
  });
  await check('同一IDの再追加を拒否し、元データを保持', async () => {
    const before = await snapshot(page);
    await assert.rejects(() => add(page, sample.data), /重複/);
    assert.deepEqual(await snapshot(page), before);
  });
  await check('不正な参照の追加失敗で元データを保持', async () => {
    const before = await snapshot(page);
    const bad = copyDataset('invalid'); bad.visits[0].planId = 'missing';
    await assert.rejects(() => add(page, bad), /参照先/);
    assert.deepEqual(await snapshot(page), before);
  });
  await check('2タブの並行追加で双方のデータを保持', async () => {
    const other = await context.newPage(); await other.goto(base);
    const a = copyDataset('concurrent-a'); const b = copyDataset('concurrent-b');
    await Promise.all([add(page, a), add(other, b)]);
    const stored = await snapshot(page);
    assert.equal(stored.revision, 3);
    assert.equal(stored.data.trips.length, 3);
    assert.equal(stored.data.visits.length, 6);
    assert.ok(stored.data.trips.some(trip => trip.id === a.trips[0].id));
    assert.ok(stored.data.trips.some(trip => trip.id === b.trips[0].id));
    await other.close();
  });
  await check('同一データの並行追加は片方のみ成功', async () => {
    const value = copyDataset('double');
    const outcomes = await Promise.allSettled([add(page, value), add(page, value)]);
    assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal((await snapshot(page)).revision, 4);
  });
  await check('トランザクション中断で保存成功にせず、元データを保持', async () => {
    const before = await snapshot(page);
    const error = await page.evaluate(async data => {
      const storage = await import('./src/storage.js');
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) { const result = original.apply(this, args); this.transaction.abort(); return result; };
      try { await storage.addDataset(data); return 'unexpected success'; }
      catch (error) { return error.message; }
      finally { IDBObjectStore.prototype.put = original; }
    }, copyDataset('aborted'));
    assert.match(error, /保存に失敗/);
    assert.deepEqual(await snapshot(page), before);
  });
  await check('保存失敗時は確認画面とエラーを残し、再試行で保存できる', async () => {
    const isolated = await browser.newContext(); const tab = await isolated.newPage(); await tab.goto(base);
    await tab.getByRole('button', { name: 'サンプル旅程を読み込む' }).click();
    await tab.evaluate(() => {
      window.originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function () { throw new DOMException('simulated full disk', 'QuotaExceededError'); };
    });
    await tab.getByRole('button', { name: 'この端末に読み込む' }).click();
    await tab.locator('#sample-error').filter({ hasText: /保存に失敗/ }).waitFor();
    assert.equal(await tab.locator('dialog').evaluate(element => element.open), true);
    assert.equal((await snapshot(tab)).revision, 0);
    await tab.evaluate(() => { IDBObjectStore.prototype.put = window.originalPut; });
    await tab.getByRole('button', { name: 'この端末に読み込む' }).click();
    await tab.getByRole('heading', { name: '秋の北海道、街を歩く。' }).waitFor();
    assert.equal((await snapshot(tab)).revision, 1);
    await isolated.close();
  });
  await check('保存済みの未知形式を初期化せず、エラーを表示', async () => {
    const isolated = await browser.newContext(); const tab = await isolated.newPage(); await tab.goto(base);
    await tab.evaluate(async () => {
      const storage = await import('./src/storage.js'); await storage.loadWorkspace(); storage.closeDatabase();
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('machiaruki-travel', 1);
        request.onsuccess = () => {
          const db = request.result; const tx = db.transaction('workspace', 'readwrite');
          tx.objectStore('workspace').put({ schemaVersion: 'future', keepMe: 'preserve' }, 'active');
          tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
        };
      });
    });
    await tab.reload();
    await tab.getByRole('heading', { name: '保存領域を読み込めませんでした' }).waitFor();
    const raw = await tab.evaluate(() => new Promise(resolve => {
      const request = indexedDB.open('machiaruki-travel', 1);
      request.onsuccess = () => { const db = request.result; const tx = db.transaction('workspace'); const read = tx.objectStore('workspace').get('active'); read.onsuccess = () => resolve(read.result); tx.oncomplete = () => db.close(); };
    }));
    assert.equal(raw.keepMe, 'preserve');
    await isolated.close();
  });
  await check('IndexedDB利用不可時に保存済みと誤表示しない', async () => {
    const isolated = await browser.newContext(); const tab = await isolated.newPage();
    await tab.addInitScript(() => Object.defineProperty(window, 'indexedDB', { get: () => undefined }));
    await tab.goto(base);
    await tab.getByRole('heading', { name: '保存領域を読み込めませんでした' }).waitFor();
    assert.equal(await tab.getByText('この端末に保存済み', { exact: true }).count(), 0);
    await isolated.close();
  });
  await check('HTML風の名称・メモを文字列として表示', async () => {
    const malicious = copyDataset('text');
    malicious.trips[0].name = '<img src=x onerror="window.injected=true">';
    malicious.plans[0].name = '<script>window.injected=true</script>';
    await add(page, malicious);
    await page.goto(`${base}#/home?trip=${malicious.trips[0].id}`);
    await page.reload();
    await page.getByRole('heading', { name: malicious.trips[0].name, exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.injected), undefined);
    assert.equal(await page.locator('main img, main script').count(), 0);
  });
  await check('GitHub Pages相当のサブパスでも起動・保存できる', async () => {
    const isolated = await browser.newContext(); const tab = await isolated.newPage();
    const alias = new URL('/machiaruki-travel/', base).href;
    await tab.goto(alias);
    await tab.getByRole('button', { name: 'サンプル旅程を読み込む' }).click();
    await tab.getByRole('button', { name: 'この端末に読み込む' }).click();
    await tab.getByRole('heading', { name: '秋の北海道、街を歩く。' }).waitFor();
    await tab.getByRole('link', { name: '予定・記録', exact: true }).click();
    await tab.getByRole('heading', { name: '今日の予定・訪問記録' }).waitFor();
    assert.equal((await snapshot(tab)).data.visits.length, 2);
    await isolated.close();
  });
  await check('ブラウザプロセスの終了・再起動後も保存を保持', async () => {
    const profile = await mkdtemp(fileURLToPath(new URL('../test-results/persistence-', import.meta.url)));
    let persistent;
    try {
      persistent = await chromium.launchPersistentContext(profile, { channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
      let tab = persistent.pages()[0]; await tab.goto(base);
      await tab.getByRole('button', { name: 'サンプル旅程を読み込む' }).click();
      await tab.getByRole('button', { name: 'この端末に読み込む' }).click();
      await tab.getByRole('heading', { name: '秋の北海道、街を歩く。' }).waitFor();
      await persistent.close(); persistent = undefined;
      persistent = await chromium.launchPersistentContext(profile, { channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
      tab = persistent.pages()[0]; await tab.goto(base);
      await tab.getByRole('heading', { name: '秋の北海道、街を歩く。' }).waitFor();
      assert.deepEqual((await snapshot(tab)).data, sample.data);
    } finally {
      if (persistent) await persistent.close();
      const testRoot = fileURLToPath(new URL('../test-results/', import.meta.url));
      const relative = path.relative(testRoot, profile);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Refusing to remove a profile outside test-results');
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
  await check('390px・320px幅の3画面で横スクロールが発生しない', async () => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const screen of ['home', 'timeline', 'review']) {
        await page.goto(`${base}#/${screen}?trip=sample-trip-hokkaido-2026&date=2026-10-30`);
        await page.waitForFunction(() => !document.querySelector('.loading'));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px / ${screen}`);
        if (width === 390) await page.screenshot({ path: `test-results/mobile-${screen}.png`, fullPage: true });
      }
    }
  });
  await check('ページ内のJavaScript例外・コンソールエラーなし', async () => assert.deepEqual(errors, []));
} finally {
  await context.close(); await browser.close();
}
console.log(`\n${results.filter(row => row.passed).length}/${results.length} browser checks passed (Edge Chromium; not iPhone Safari).`);
if (results.some(row => !row.passed)) process.exitCode = 1;
