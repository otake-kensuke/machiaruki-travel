import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const baseline = '7e9de1de40af8c8e9f89432dd5ea50a6bc3073db';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const sample = JSON.parse(await readFile(new URL('../samples/hokkaido-2026.sample.json', import.meta.url), 'utf8'));
const imageRoot = path.resolve('test-results/ui-v01');
await mkdir(imageRoot, { recursive: true });
const checks = [], errors = [], blocked = [], servers = [], contexts = [];
const normalize = value => value.replace(/\r\n/g, '\n');
const hash = value => createHash('sha256').update(value).digest('hex');
const git = filename => {
  const result = spawnSync('git', ['show', `${baseline}:${filename}`], { maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Cannot read baseline: ${filename}`);
  return result.stdout;
};
async function server(old) {
  const worker = old ? git('sw.js') : await readFile(new URL('../sw.js', import.meta.url));
  const shell = JSON.parse(worker.toString().match(/const SHELL = (\{[\s\S]*?\});/)[1]);
  const files = new Map(await Promise.all(shell.assets.map(async asset => [asset.path.slice(2), old ? git(asset.path.slice(2)) : await readFile(new URL(`../${asset.path}`, import.meta.url))])));
  files.set('sw.js', worker);
  // Read-only previews have the real page shell but never execute app.js/storage/GPS/SW.
  const preview = files.get('index.html').toString().replace(/<script type="module" src="\.\/src\/app\.js"><\/script>/, '');
  assert.ok(!preview.includes('src/app.js'));
  files.set('preview.html', Buffer.from(preview));
  const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', webmanifest: 'application/manifest+json', svg: 'image/svg+xml', png: 'image/png' };
  const http = createServer((req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    let key = new URL(req.url, 'http://localhost').pathname;
    if (key.startsWith('/machiaruki-travel/')) key = key.slice('/machiaruki-travel'.length);
    key = key === '/' ? 'index.html' : key.slice(1);
    const bytes = files.get(key);
    if (!bytes) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[key.split('.').at(-1)] || 'text/plain', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve)); servers.push(http);
  return `http://127.0.0.1:${http.address().port}/machiaruki-travel/`;
}
const oldBase = await server(true), base = await server(false);
const allowed = new Set([new URL(oldBase).origin, new URL(base).origin]);
async function context(readonly = false) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, acceptDownloads: true, ...(readonly ? { serviceWorkers: 'block' } : {}) }); contexts.push(ctx);
  ctx.setDefaultTimeout(10000);
  await ctx.route('**/*', route => { if (allowed.has(new URL(route.request().url()).origin)) return route.continue(); blocked.push(route.request().url()); return route.abort(); });
  ctx.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  if (readonly) await ctx.addInitScript(() => {
    window.storageAttempts = 0;
    for (const name of ['indexedDB', 'localStorage']) Object.defineProperty(window, name, { configurable: true, get() { window.storageAttempts++; throw new Error('Read-only preview prohibits storage'); } });
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => { window.storageAttempts++; throw new Error('Read-only preview prohibits Service Worker'); };
  });
  return ctx;
}
async function check(name, fn) { await fn(); checks.push(name); console.log(`PASS ${name}`); }
const readonly = await context(true), page = await readonly.newPage();
async function draw(data, screen = 'home', date = data.days[0]?.date, target = page, url = base) {
  if (target.url() !== `${url}preview.html`) await target.goto(`${url}preview.html`);
  await target.evaluate(async ({ data, screen, date }) => {
    const { homeScreen } = await import('./src/screens/home.js');
    const { timelineScreen } = await import('./src/screens/timeline.js');
    const { icon } = await import('./src/icons.js');
    window.previewData = data; window.previewCalls = [];
    const act = type => item => previewCalls.push({ type, id: item?.id || null });
    const ctx = { trip: data.trips[0], data, date, requestedDate: date, sampleAvailable: false, savedAt: null, now: '2026-10-25T00:00:00Z', openSample() {}, openImport() {}, addPlan: act('add-plan'), editPlan: act('edit-plan'), removePlan: act('delete-plan'), addVisit: act('add-visit'), editVisit: act('edit-visit') };
    document.querySelector('#content').replaceChildren(({ home: homeScreen, timeline: timelineScreen })[screen](ctx));
    for (const anchor of document.querySelectorAll('[data-page]')) anchor.querySelector('span').replaceChildren(icon({ home: 'home', timeline: 'list', review: 'diamond' }[anchor.dataset.page]));
    document.querySelector('#offline-panel').hidden = true;
  }, { data, screen, date });
}
async function unchanged(data, target = page) { assert.deepEqual(await target.evaluate(() => previewData), data); assert.equal(await target.evaluate(() => storageAttempts), 0); }
async function fits(target = page) {
  assert.ok(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page overflow');
  const clipped = await target.locator('.button, .agenda-row strong, .timeline-card h3, .plan-memo > p').evaluateAll(nodes => nodes.filter(n => n.getClientRects().length && n.scrollWidth > n.clientWidth + 2).map(n => n.textContent.slice(0, 20)));
  assert.deepEqual(clipped, []);
}
try {
  await check('UI-01/02: caption非表示・2行概要・長文原文と旅行タイトル/期間を保持', async () => {
    const data = structuredClone(sample.data); data.trips[0].memo = '削除してはいけない旅行原文。\n'.repeat(100);
    await draw(data); assert.equal(await page.locator('.trip-illustration figcaption').count(), 0); assert.equal(await page.locator('.traveler').count(), 3);
    assert.equal(await page.locator('.trip-summary').innerText(), '3日間・予定8件\n交通2件・宿泊2件');
    assert.equal(await page.locator('.trip-summary').evaluate(n => Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight))), 2);
    assert.equal(await page.getByRole('heading', { name: data.trips[0].name, exact: true }).count(), 1); assert.match(await page.locator('.trip-period').innerText(), /2026年10月30日/);
    await unchanged(data);
    const generic = structuredClone(data); generic.trips[0].name = '別地域の架空旅行'; await draw(generic); assert.equal(await page.locator('.trip-summary').innerText(), '3日間・予定8件\n交通2件・宿泊2件'); await unchanged(generic);
  });
  await check('UI-03: 0/1/4/5件・残件数・時刻未設定/同時刻の既存順序', async () => {
    for (const count of [0, 1, 4, 5]) {
      const data = structuredClone(sample.data), original = data.plans[0]; data.visits = [];
      const times = [null, '12:00', '09:00', '09:00', null], orders = [9, 0, 3, 1, 2];
      data.plans = Array.from({ length: count }, (_, i) => ({ ...original, id: `ui-plan-${i}`, name: `架空予定${i}`, startAt: times[i] ? `2026-10-30T${times[i]}:00+09:00` : null, order: orders[i] }));
      await draw(data); assert.equal(await page.locator('.agenda-row').count(), Math.min(count, 4));
      if (count === 5) { assert.match(await page.locator('.agenda').innerText(), /ほか1件の予定/); assert.deepEqual(await page.locator('.agenda-row strong').allTextContents(), ['架空予定3', '架空予定2', '架空予定1', '架空予定4']); assert.match(await page.locator('.agenda-row time').last().innerText(), /時刻未定/); }
      else assert.doesNotMatch(await page.locator('.agenda').innerText(), /ほか\d+件/);
      assert.equal(await page.getByRole('link', { name: '予定と記録をひらく →', exact: true }).count(), 1);
      assert.equal(await page.locator('#home-date').count(), 1); await unchanged(data);
    }
  });
  await check('UI-04/05: メモ全文と改行・初期折りたたみ・Enter/Space開閉・データ/順序不変', async () => {
    const data = structuredClone(sample.data); data.plans[0].memo = '予約状態：予約確定ではない\n雨天時：屋内へ\n注意：<b>HTMLにしない</b>\n' + '長いメモ。'.repeat(100);
    data.plans[1].memo = ''; data.plans[2].memo = ' \n ';
    await draw(data, 'timeline'); const details = page.locator('[data-plan-id="sample-plan-airport"] .plan-memo');
    assert.equal(await page.locator('.plan-memo').count(), 1); assert.equal(await details.evaluate(n => n.open), false);
    const before = await page.locator('.timeline-row').evaluateAll(nodes => nodes.map(n => n.dataset.planId));
    const summary = details.locator('summary'); await summary.focus(); await summary.press('Enter'); assert.equal(await details.evaluate(n => n.open), true);
    assert.equal(await details.locator('p').textContent(), data.plans[0].memo); assert.equal(await details.locator('b').count(), 0); assert.equal(await details.locator('p').evaluate(n => getComputedStyle(n).whiteSpace), 'pre-wrap');
    await summary.press('Space'); assert.equal(await details.evaluate(n => n.open), false);
    assert.deepEqual(await page.locator('.timeline-row').evaluateAll(nodes => nodes.map(n => n.dataset.planId)), before); await unchanged(data);
  });
  await check('UI-04: 自由文から予約状態を推測せず、関連訪問と既存操作を維持', async () => {
    const data = structuredClone(sample.data);
    for (const memo of ['未予約', '予約確定ではない', '予約確定\nその後取消', '予約状態：予約確定']) {
      data.plans[0].memo = memo; await draw(data, 'timeline');
      assert.doesNotMatch(await page.locator('[data-plan-id="sample-plan-airport"] .badge').allTextContents().then(v => v.join(' ')), /予約/); await unchanged(data);
    }
    const row = page.locator('[data-plan-id="sample-plan-odori"]'); assert.equal(await row.locator('[data-visit-id]').count(), 1);
    await row.getByRole('button', { name: '大通公園を散策の訪問を記録', exact: true }).click(); await row.getByRole('button', { name: '大通公園を散策を編集', exact: true }).click(); await row.getByRole('button', { name: '大通公園を散策を削除', exact: true }).click(); await row.getByRole('button', { name: '大通公園の訪問記録を編集', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => previewCalls.map(c => c.type)), ['add-visit', 'edit-plan', 'delete-plan', 'edit-visit']); await unchanged(data);
  });
  await check('UI-05: 320/393/430px・長い施設名・文字200%でも操作とメモがはみ出さない', async () => {
    const data = structuredClone(sample.data); data.plans[0].name = '長い施設名'.repeat(25) + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(5);
    for (const width of [320, 393, 430]) for (const scale of [100, 200]) {
      await page.setViewportSize({ width, height: 852 });
      for (const screen of ['home', 'timeline']) { await draw(data, screen); await page.evaluate(scale => { document.documentElement.style.fontSize = `${scale}%`; }, scale); if (screen === 'timeline') await page.locator('.plan-memo summary').first().click(); await fits(); await unchanged(data); }
    }
    await page.setViewportSize({ width: 393, height: 852 }); await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  });
  await check('UI-06: 保存2方式が同じ控えめなデザイン・説明付きでJSON内容と共有操作を維持', async () => {
    for (const [url, label] of [[oldBase, 'before'], [base, 'after']]) {
      const ctx = await context(), tab = await ctx.newPage();
      await ctx.addInitScript(() => { window.shareCalls = []; Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true }); Object.defineProperty(navigator, 'share', { configurable: true, value: async data => { shareCalls.push({ active: navigator.userActivation.isActive, text: await data.files[0].text(), name: data.files[0].name }); } }); });
      await tab.goto(url); await tab.locator('#offline-panel[data-state=ready]').waitFor(); await tab.evaluate(async data => (await import('./src/storage.js')).addDataset(data), sample.data); await tab.reload();
      await tab.getByRole('button', { name: 'バックアップを保存', exact: true }).click();
      const download = tab.getByRole('button', { name: 'JSONをダウンロード', exact: true }), share = tab.getByRole('button', { name: '共有して「ファイル」に保存', exact: true }); await share.waitFor();
      await tab.locator('.form-dialog').screenshot({ path: path.join(imageRoot, `${label}-backup.png`) });
      await tab.locator('.form-dialog .backup-actions').first().screenshot({ path: path.join(imageRoot, `${label}-backup-methods.png`) });
      if (label === 'after') {
        assert.equal(await download.getAttribute('class'), await share.getAttribute('class')); assert.match(await download.getAttribute('class'), /secondary/);
        assert.ok(await tab.locator('.form-dialog .backup-method').evaluateAll(nodes => nodes.every(n => n.getBoundingClientRect().height <= n.scrollHeight + 2 && n.getBoundingClientRect().height < 180)), 'mobile methods must not have a desktop-sized vertical flex basis');
        await tab.getByText('この端末へJSONファイルをダウンロードします。', { exact: true }).waitFor(); await tab.getByText('共有画面から「ファイルに保存」を選びます。', { exact: true }).waitFor();
        const pending = tab.waitForEvent('download'); await download.click(); const file = await pending; const chunks = []; for await (const chunk of await file.createReadStream()) chunks.push(chunk);
        const exported = JSON.parse(Buffer.concat(chunks).toString()); assert.deepEqual(exported.data, sample.data); assert.match(file.suggestedFilename(), /^machiaruki-travel-backup-/);
        await share.click(); await tab.getByText(/共有画面へファイルを渡しました/).waitFor(); const calls = await tab.evaluate(() => shareCalls); assert.equal(calls.length, 1); assert.equal(calls[0].active, true); assert.deepEqual(JSON.parse(calls[0].text), exported); assert.equal(calls[0].name, file.suggestedFilename());
        assert.deepEqual(await tab.evaluate(async () => (await (await import('./src/storage.js')).loadWorkspace()).data), sample.data);
      }
      await ctx.close();
    }
  });
  await check('基準版と候補版の比較画像・原文データの非変更', async () => {
    const data = structuredClone(sample.data); data.trips[0].memo = '架空旅行の長い説明。\n予約・雨天・注意は保存データに残す。\n'.repeat(8);
    for (const [url, label] of [[oldBase, 'before'], [base, 'after']]) {
      const tab = await readonly.newPage();
      await draw(data, 'home', data.days[0].date, tab, url); await tab.locator('.trip-intro').screenshot({ path: path.join(imageRoot, `${label}-home-intro.png`) });
      await draw(data, 'timeline', data.days[0].date, tab, url); await tab.locator('.timeline-card').first().screenshot({ path: path.join(imageRoot, `${label}-timeline.png`), style: '.bottom-nav { visibility: hidden !important; }' }); await unchanged(data, tab); await tab.close();
    }
  });
  if (process.env.UI_PRIVATE_ITINERARY) await check('Ownerの北海道v1.1をメモリ描画だけで確認（DB/SW/元JSON非変更）', async () => {
    const filename = path.resolve(process.env.UI_PRIVATE_ITINERARY), bytes = await readFile(filename), inputHash = hash(bytes);
    const envelope = JSON.parse(bytes); const data = { ...envelope.data, visits: [] };
    const privateRoot = path.resolve('exports/ui-v01-review'); await mkdir(privateRoot, { recursive: true });
    for (const [url, label] of [[oldBase, 'before'], [base, 'after']]) {
      const tab = await readonly.newPage();
      for (const day of data.days) {
        await draw(data, 'home', day.date, tab, url); const expected = data.plans.filter(p => p.dayId === day.id && !p.deletedAt).length; assert.equal(await tab.locator('.agenda-row').count(), Math.min(expected, 4));
        await draw(data, 'timeline', day.date, tab, url); assert.equal(await tab.locator('.timeline-row').count(), expected); await unchanged(data, tab); await fits(tab);
      }
      await draw(data, 'home', data.days[0].date, tab, url); await tab.screenshot({ path: path.join(privateRoot, `${label}-home.png`), fullPage: true });
      await draw(data, 'timeline', data.days[2].date, tab, url); await tab.screenshot({ path: path.join(privateRoot, `${label}-timeline.png`), fullPage: true });
      if (label === 'after') { assert.equal(await tab.locator('.plan-memo').count(), data.plans.filter(p => p.dayId === data.days[2].id && p.memo.trim()).length); await tab.locator('.plan-memo summary').first().click(); await unchanged(data, tab); }
      await tab.close();
    }
    assert.equal(hash(await readFile(filename)), inputHash);
  });
  await check('ページ例外なし・非ローカル通信なし', async () => { assert.deepEqual(errors, []); assert.deepEqual(blocked, []); });
} finally { await Promise.all(contexts.map(ctx => ctx.close())); await browser.close(); await Promise.all(servers.map(http => new Promise(resolve => http.close(resolve)))); }
console.log(`\n${checks.length} UI simplification checks passed; physical iPhone not tested. Private data/screenshots are never committed.`);
