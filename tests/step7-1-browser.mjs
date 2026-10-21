import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4173/machiaruki-travel/';
const sample = JSON.parse(await readFile(new URL('../samples/hokkaido-2026.sample.json', import.meta.url), 'utf8'));
const data = structuredClone(sample.data);
data.visits.push({ ...data.visits[1], id: 'test-outside-1019', name: '旅行前の仮記録', visitedAt: '2026-10-19T10:00:00+09:00' });
const trip = data.trips[0].id;
const checks = []; const errors = [];
await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
async function check(name, fn) { await fn(); checks.push(name); console.log(`PASS ${name}`); }
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, reducedMotion: 'reduce' });
const page = await ctx.newPage(); page.on('pageerror', error => errors.push(error.message));
const state = () => page.evaluate(async () => (await import('./src/storage.js')).loadWorkspace());
const href = (screen, date = '2026-10-30') => `${base}#/${screen}?trip=${trip}&date=${date}`;
async function selectedCentered() {
  await page.waitForFunction(() => {
    const strip = document.querySelector('.date-strip'), selected = strip?.querySelector('[aria-current=date]');
    if (!selected) return false;
    const box = strip.getBoundingClientRect(), tab = selected.getBoundingClientRect();
    const target = Math.max(0, Math.min(strip.scrollWidth - strip.clientWidth, strip.scrollLeft + tab.left - box.left - strip.clientLeft + tab.width / 2 - strip.clientWidth / 2));
    return Math.abs(strip.scrollLeft - target) <= 2 && tab.left >= box.left - 1 && tab.right <= box.right + 1;
  });
}
// Audit rendered text against its composited solid surface. Illustration captions are opaque.
async function textAudit() {
  return page.evaluate(() => {
    const rgba = value => value.match(/[\d.]+/g).map(Number);
    const blend = (front, back) => front.slice(0, 3).map((v, i) => v * (front[3] ?? 1) + back[i] * (1 - (front[3] ?? 1)));
    const lum = rgb => rgb.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
    const issues = []; const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, parent = node.parentElement;
      if (!node.textContent.trim() || !parent.getClientRects().length || parent.closest('script, style, [aria-hidden=true], svg, option')) continue;
      const range = document.createRange(); range.selectNodeContents(node); if (![...range.getClientRects()].some(r => r.width && r.height)) continue;
      const css = getComputedStyle(parent); if (css.visibility !== 'visible' || Number(css.opacity) === 0) continue;
      const ancestors = []; for (let a = parent; a; a = a.parentElement) ancestors.unshift(a);
      let bg = [255, 255, 255]; for (const a of ancestors) bg = blend(rgba(getComputedStyle(a).backgroundColor), bg);
      const fg = blend(rgba(css.color), bg); const ratio = (Math.max(lum(fg), lum(bg)) + .05) / (Math.min(lum(fg), lum(bg)) + .05);
      const size = parseFloat(css.fontSize); const minimum = size >= 24 || (size >= 18.66 && Number(css.fontWeight) >= 700) ? 3 : 4.5;
      if (size < 14 || ratio < minimum) issues.push({ text: node.textContent.trim().slice(0, 35), size, ratio: +ratio.toFixed(2), class: parent.className });
    }
    return issues;
  });
}
async function noOverflow() {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page must not scroll horizontally');
  const clipped = await page.locator('.button, .bottom-nav a, .agenda-row strong, .timeline-card h3, .memory-card h3, .form-dialog').evaluateAll(nodes => nodes.filter(n => n.getClientRects().length && (n.scrollWidth > n.clientWidth + 2 || n.scrollHeight > n.clientHeight + 2) && getComputedStyle(n).overflowY !== 'auto').map(n => n.textContent.slice(0, 35)));
  assert.deepEqual(clipped, [], 'important text must not clip');
}
try {
  await page.goto(base); await page.locator('#offline-panel[data-state=ready]').waitFor();
  await page.evaluate(async data => (await import('./src/storage.js')).addDataset(data), data);
  await page.reload(); await page.locator('.dashboard').waitFor(); const before = await state();
  await check('3画面の表示文字が14px以上・通常4.5:1/大文字3:1、主要タップ領域44px以上', async () => {
    for (const screen of ['home', 'timeline', 'review']) {
      await page.goto(href(screen)); await page.locator(screen === 'home' ? '.agenda' : screen === 'timeline' ? '.timeline' : '.memory-grid').first().waitFor();
      if (screen === 'home') { await page.locator('#home-date').selectOption('2026-10-30'); await page.locator('#transport-details summary').click(); await page.locator('#stay-details summary').click(); await page.locator('#offline-details summary').click(); }
      assert.deepEqual(await textAudit(), [], screen);
      const smallTargets = await page.locator('.button, .bottom-nav a, .date-strip a, .travel-details summary, #offline-details summary').evaluateAll(nodes => nodes.filter(n => { const r = n.getBoundingClientRect(); return r.width && r.height && (r.width < 44 || r.height < 44); }).map(n => n.textContent));
      assert.deepEqual(smallTargets, []);
      await noOverflow(); await page.screenshot({ path: `test-results/step7-1-${screen}-393.png`, fullPage: true });
    }
    await page.goto(href('timeline')); assert.equal(await page.locator('.timeline-time > strong').first().evaluate(n => parseFloat(getComputedStyle(n).fontSize)), 18);
    assert.equal(await page.locator('.timeline-card h3').first().evaluate(n => parseFloat(getComputedStyle(n).fontSize)), 19);
    assert.equal(await page.locator('.plan-toolbar .button').first().evaluate(n => parseFloat(getComputedStyle(n).fontSize)), 17);
  });
  await check('期間外10/19を保持・4日付の初期表示/選択/中央配置/両端クランプ', async () => {
    for (const date of ['2026-11-01', '2026-10-19', '2026-10-31', '2026-10-30']) {
      await page.goto(href('timeline', date)); await selectedCentered();
      assert.equal(await page.locator('.date-strip a').count(), 4);
      assert.match(await page.locator('.date-strip a.selected').getAttribute('href'), new RegExp(date));
      if (date === '2026-10-19') await page.getByRole('heading', { name: '旅行前の仮記録', exact: true }).waitFor();
    }
    await page.locator('.date-strip a').last().click(); await selectedCentered();
    await page.reload(); await selectedCentered(); assert.deepEqual(await state(), before);
  });
  await check('320/393/430px・文字200%でも3画面/編集ダイアログの横はみ出しや文字欠けなし', async () => {
    for (const width of [320, 393, 430]) {
      await page.setViewportSize({ width, height: 852 });
      for (const scale of [100, 200]) {
        await page.evaluate(scale => { document.documentElement.style.fontSize = `${scale}%`; }, scale);
        assert.equal(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)), scale === 200 ? 32 : 16);
        for (const screen of ['home', 'timeline', 'review']) {
          await page.goto(href(screen)); await page.locator('main > div').waitFor();
          await noOverflow();
          if (screen === 'timeline') { await selectedCentered(); await page.getByRole('button', { name: '新千歳空港に到着を編集', exact: true }).click(); await noOverflow(); assert.deepEqual(await textAudit(), [], 'dialog'); await page.getByRole('button', { name: 'キャンセル', exact: true }).click(); }
          if (width === 393 && scale === 200) await page.screenshot({ path: `test-results/step7-1-${screen}-text200.png`, fullPage: true });
        }
      }
    }
    assert.deepEqual(await state(), before);
  });
  await check('長い旅行20日・選択時の短いスクロール/動きを減らす設定/手動横スクロール', async () => {
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; }); await page.setViewportSize({ width: 393, height: 852 });
    const longer = structuredClone(sample.data); const oldId = longer.trips[0].id;
    for (const rows of Object.values(longer)) for (const row of rows) { row.id = `long-${row.id}`; if (row.tripId) row.tripId = `long-${oldId}`; if (row.dayId) row.dayId = `long-${row.dayId}`; if (row.planId) row.planId = `long-${row.planId}`; }
    longer.trips[0].endDate = '2026-11-18';
    for (let n = 2; n <= 18; n++) { const date = `2026-11-${String(n).padStart(2, '0')}`; longer.days.push({ ...longer.days[0], id: `long-day-${n}`, date }); }
    await page.evaluate(async data => (await import('./src/storage.js')).addDataset(data), longer);
    await page.reload(); await page.goto(`${base}#/timeline?trip=long-${oldId}&date=2026-11-18`); await selectedCentered();
    const longBefore = await state(); assert.equal(await page.locator('.date-strip a').count(), 20);
    // Record native scrollTo options without replacing its behavior.
    await page.evaluate(() => { window.tabScrolls = []; const native = Element.prototype.scrollTo; Element.prototype.scrollTo = function(options) { if (this.matches('.date-strip')) tabScrolls.push(options); return native.call(this, options); }; });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => { location.hash = location.hash.replace('2026-11-18', '2026-11-09'); }); await selectedCentered();
    assert.equal(await page.evaluate(() => tabScrolls.at(-1).behavior), 'smooth');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => { location.hash = location.hash.replace('2026-11-09', '2026-11-10'); }); await selectedCentered();
    assert.equal(await page.evaluate(() => tabScrolls.at(-1).behavior), 'instant');
    // Native horizontal input stays available after centering (no snapping handler).
    const strip = page.locator('.date-strip'); await strip.hover(); const start = await strip.evaluate(n => n.scrollLeft);
    await page.mouse.wheel(-180, 0); await page.waitForFunction(start => document.querySelector('.date-strip').scrollLeft < start - 50, start);
    assert.equal(await page.locator('.date-strip a.selected').getAttribute('aria-current'), 'date');
    await page.evaluate(() => { scrollTo(0, 300); window.beforeTabScrollY = scrollY; document.querySelector('.date-strip a.selected').click(); });
    await selectedCentered(); assert.equal(await page.evaluate(() => scrollY), await page.evaluate(() => beforeTabScrollY), 'centering must not move the page vertically');
    assert.deepEqual(await state(), longBefore);
    await page.screenshot({ path: 'test-results/step7-1-long-tabs.png', fullPage: true });
  });
  await check('JavaScript例外なし', async () => assert.deepEqual(errors, []));
} finally { await ctx.close(); await browser.close(); }
console.log(`\n${checks.length} Step 7.1 browser checks passed (physical iPhone not tested).`);
