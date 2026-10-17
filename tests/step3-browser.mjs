import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const launch = { channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true };
const browser = await chromium.launch(launch);
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4173/';
const fixture = JSON.parse(await readFile(new URL('../samples/hokkaido-2026.itinerary.json', import.meta.url), 'utf8'));
const sample = JSON.parse(await readFile(new URL('../samples/hokkaido-2026.sample.json', import.meta.url), 'utf8'));
await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
const results = [];
const errors = [];
const context = await browser.newContext({ viewport: { width: 1365, height: 1000 } });
context.setDefaultTimeout(8000);
context.on('page', tab => {
  tab.on('pageerror', error => errors.push(error.message));
  tab.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
});
const page = await context.newPage();
const sampleId = sample.data.trips[0].id;
function itinerary(prefix) {
  const value = structuredClone(fixture);
  for (const rows of Object.values(value.data)) for (const row of rows) {
    for (const key of ['id', 'tripId', 'dayId']) if (row[key]) row[key] = `${prefix}-${row[key]}`;
  }
  value.data.trips[0].name = `JSON取込 ${prefix}`;
  return value;
}
async function check(name, callback) {
  try { await callback(); results.push(true); console.log(`PASS ${name}`); }
  catch (error) { results.push(false); console.error(`FAIL ${name}\n${error.stack}`); }
}
async function snapshot(tab = page) { return tab.evaluate(async () => (await import('./src/storage.js')).loadWorkspace()); }
async function go(screen, date = '2026-10-30', trip = sampleId, tab = page) {
  await tab.goto(`${base}#/${screen}?trip=${trip}&date=${date}`);
  await tab.reload();
  await tab.waitForFunction(() => !document.querySelector('.loading'));
}
async function upload(value, tab = page) {
  await tab.locator('#itinerary-file').setInputFiles({ name: 'trip.json', mimeType: 'application/json', buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)) });
  await tab.waitForFunction(() => !document.querySelector('.form-dialog [role=status]')?.textContent.includes('検証しています'));
}
async function openImport(tab = page) { await tab.getByRole('button', { name: '旅程JSONを取り込む', exact: true }).click(); }
async function close(tab = page) { await tab.getByRole('button', { name: 'キャンセル', exact: true }).click(); }
async function addViaStorage(tab, value) {
  await tab.evaluate(async envelope => {
    const { validateEnvelope } = await import('./src/validation.js');
    await (await import('./src/storage.js')).addDataset(validateEnvelope(envelope));
  }, value);
}
try {
  await page.goto(base);
  await page.getByRole('button', { name: 'サンプル旅程を読み込む' }).click();
  await page.getByRole('button', { name: 'この端末に読み込む' }).click();
  await page.getByRole('heading', { name: sample.data.trips[0].name }).waitFor();
  await check('取込プレビューに旅行名・期間・件数を表示し、確認前は保存しない', async () => {
    const before = await snapshot();
    await openImport(); await upload(itinerary('normal'));
    assert.match(await page.locator('.import-preview').innerText(), /JSON取込 normal/);
    assert.match(await page.locator('.import-preview').innerText(), /2026-10-30 〜 2026-11-01/);
    assert.match(await page.locator('.import-preview').innerText(), /予定 8件 \/ 交通 2件 \/ 宿泊 2件/);
    assert.deepEqual(await snapshot(), before);
    await page.screenshot({ path: 'test-results/step3-import-preview.png' });
    await close(); assert.deepEqual(await snapshot(), before);
  });
  await check('確認後の正常取込で旅行を追加し、既存訪問記録を全件保持', async () => {
    await openImport(); await upload(itinerary('normal'));
    await page.getByRole('button', { name: '確認して追加する' }).click();
    await page.getByRole('heading', { name: 'JSON取込 normal', exact: true }).waitFor();
    const saved = await snapshot();
    assert.equal(saved.data.trips.length, 2);
    assert.deepEqual(saved.data.visits, sample.data.visits);
  });
  await check('異常JSON10種類と大容量ファイルを拒否し保存値は不変', async () => {
    const before = await snapshot();
    const values = ['{', 'null', { ...itinerary('bad'), schemaVersion: '2' }, { ...itinerary('bad'), kind: 'backup' }];
    for (const mutate of [v => { delete v.data.plans; }, v => { v.data.trips[0].name = ''; }, v => { v.data.days[0].date = '2026-02-30'; }, v => { v.data.plans[0].dayId = 'missing'; }, v => { v.data.plans[0].id = v.data.days[0].id; }]) {
      const value = itinerary('bad'); mutate(value); values.push(value);
    }
    values.push(fixture); // Existing IDs, including a plan referenced by a visit.
    await openImport();
    for (const value of values) {
      await upload(value);
      assert.equal(await page.getByRole('button', { name: '確認して追加する' }).isDisabled(), true);
      assert.ok((await page.locator('.form-dialog [role=alert]').innerText()).length);
      assert.deepEqual(await snapshot(), before);
    }
    await upload(' '.repeat(2 * 1024 * 1024 + 1));
    assert.match(await page.locator('.form-dialog [role=alert]').innerText(), /2 MiB/);
    assert.deepEqual(await snapshot(), before);
    await close();
  });
  await check('正しい候補の後に不正ファイルを選んでも古い候補を保存しない', async () => {
    const before = await snapshot();
    await openImport(); await upload(itinerary('superseded')); await upload('{');
    await page.locator('.form-dialog form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    assert.deepEqual(await snapshot(), before);
    await close();
  });
  await check('プレビュー後の別タブによるID衝突も保存時に拒否', async () => {
    const value = itinerary('race');
    await openImport(); await upload(value);
    const other = await context.newPage(); await other.goto(base); await addViaStorage(other, value);
    const before = await snapshot();
    await page.getByRole('button', { name: '確認して追加する' }).click();
    await page.locator('.form-dialog [role=alert]').filter({ hasText: /重複/ }).waitFor();
    assert.deepEqual(await snapshot(), before);
    await close(); await other.close();
  });
  await check('予定追加・時刻未定保存・日付切替', async () => {
    await go('timeline');
    await page.getByRole('button', { name: '＋ 予定を追加' }).click();
    await page.getByLabel('施設名・予定名（必須）').fill('追加した予定');
    await page.getByLabel('日付（必須）').fill('2026-10-31');
    await page.getByLabel('メモ（任意）').fill('手動で追加したメモ');
    await page.getByRole('button', { name: '保存する', exact: true }).click();
    await page.locator('.timeline-card h3').filter({ hasText: '追加した予定' }).waitFor();
    const saved = await snapshot();
    const created = saved.data.plans.find(plan => plan.name === '追加した予定');
    assert.ok(created.id); assert.equal(created.startAt, null); assert.equal(created.createdAt, created.updatedAt);
    assert.deepEqual(saved.data.visits, sample.data.visits);
    assert.ok(page.url().includes('date=2026-10-31'));
  });
  await check('訪問付き予定の名前・日付・時刻・メモを編集しIDとcreatedAtを維持', async () => {
    await go('timeline');
    const before = (await snapshot()).data.plans.find(plan => plan.id === 'sample-plan-odori');
    await page.getByRole('button', { name: '大通公園を散策を編集', exact: true }).click();
    await page.getByLabel('施設名・予定名（必須）').fill('編集した大通の予定');
    await page.getByLabel('日付（必須）').fill('2026-10-31');
    await page.getByLabel('時刻（任意）').fill('15:45');
    await page.getByLabel('住所（任意）').fill('編集した予定の住所');
    await page.getByLabel('メモ（任意）').fill('予定だけを編集');
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(await page.locator('.form-dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth + 1));
      assert.equal(await page.locator('#plan-name').evaluate(input => getComputedStyle(input).fontSize), '16px');
      if (width === 390) await page.screenshot({ path: 'test-results/step3-mobile-editor.png' });
    }
    await page.setViewportSize({ width: 1365, height: 1000 });
    await page.getByRole('button', { name: '保存する', exact: true }).click();
    await page.locator('.timeline-card h3').filter({ hasText: '編集した大通の予定' }).waitFor();
    const saved = await snapshot(); const after = saved.data.plans.find(plan => plan.id === before.id);
    assert.equal(after.createdAt, before.createdAt); assert.ok(Date.parse(after.updatedAt) > Date.parse(before.updatedAt));
    assert.equal(after.startAt, '2026-10-31T06:45:00.000Z'); assert.deepEqual(after.location, before.location);
    assert.deepEqual(saved.data.visits, sample.data.visits);
    await go('timeline');
    assert.match(await page.locator('.timeline').innerText(), /大通公園/);
    assert.match(await page.locator('.timeline').innerText(), /訪問 14:12/);
  });
  await check('削除キャンセルは不変、削除確定後も訪問履歴と参照を保持', async () => {
    await go('timeline', '2026-10-31'); const before = await snapshot();
    await page.getByRole('button', { name: '編集した大通の予定を削除', exact: true }).click();
    assert.match(await page.locator('.form-dialog').innerText(), /訪問記録1件/);
    await close(); assert.deepEqual(await snapshot(), before);
    await page.getByRole('button', { name: '編集した大通の予定を削除', exact: true }).click();
    await page.getByRole('button', { name: '予定を削除する', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.form-dialog'));
    const saved = await snapshot();
    const deleted = saved.data.plans.find(plan => plan.id === 'sample-plan-odori');
    assert.ok(deleted.deletedAt); assert.equal(saved.data.plans.length, before.data.plans.length);
    assert.deepEqual(saved.data.visits, sample.data.visits);
    await go('review'); assert.match(await page.locator('main').innerText(), /削除済みの予定から/);
    assert.equal(await page.locator('.memory-card').count(), 2);
  });
  await check('訪問のない予定も削除済みとして保持', async () => {
    await go('timeline', '2026-10-31');
    const plan = (await snapshot()).data.plans.find(row => row.name === '追加した予定');
    await page.getByRole('button', { name: '追加した予定を削除', exact: true }).click();
    await page.getByRole('button', { name: '予定を削除する', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.form-dialog'));
    assert.ok((await snapshot()).data.plans.find(row => row.id === plan.id).deletedAt);
    assert.deepEqual((await snapshot()).data.visits, sample.data.visits);
  });
  await check('予定の保存失敗時は入力を保持し、再試行で保存', async () => {
    await page.getByRole('button', { name: '＋ 予定を追加' }).click();
    await page.getByLabel('施設名・予定名（必須）').fill('保存失敗から再試行');
    await page.getByLabel('メモ（任意）').fill('入力を消さない');
    const before = await snapshot();
    await page.evaluate(() => { window.putOriginal = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
    try {
      await page.getByRole('button', { name: '保存する', exact: true }).click();
      await page.locator('.form-dialog [role=alert]').filter({ hasText: /保存に失敗/ }).waitFor();
      assert.equal(await page.getByLabel('施設名・予定名（必須）').inputValue(), '保存失敗から再試行');
      assert.equal(await page.getByLabel('メモ（任意）').inputValue(), '入力を消さない');
      assert.deepEqual(await snapshot(), before);
    } finally { await page.evaluate(() => { IDBObjectStore.prototype.put = window.putOriginal; }); }
    await page.getByRole('button', { name: '保存する', exact: true }).click();
    await page.locator('.timeline-card h3').filter({ hasText: '保存失敗から再試行' }).waitFor();
  });
  await check('別タブの競合編集を拒否して入力と先行保存を保持', async () => {
    await go('timeline');
    const other = await context.newPage(); await go('timeline', '2026-10-30', sampleId, other);
    await page.getByRole('button', { name: '新千歳空港に到着を編集', exact: true }).click();
    await other.getByRole('button', { name: '新千歳空港に到着を編集', exact: true }).click();
    await page.getByLabel('施設名・予定名（必須）').fill('先に保存した予定');
    await page.getByRole('button', { name: '保存する', exact: true }).click();
    await page.locator('.timeline-card h3').filter({ hasText: '先に保存した予定' }).waitFor();
    const before = await snapshot();
    await other.getByLabel('施設名・予定名（必須）').fill('競合した入力');
    await other.getByRole('button', { name: '保存する', exact: true }).click();
    await other.locator('.form-dialog [role=alert]').filter({ hasText: /別の画面で変更/ }).waitFor();
    assert.equal(await other.getByLabel('施設名・予定名（必須）').inputValue(), '競合した入力');
    assert.deepEqual(await snapshot(), before);
    await close(other); await other.close();
  });
  await check('編集・削除・取込後の全データを再読込しても保持', async () => {
    const before = await snapshot(); await page.reload();
    await page.getByRole('heading', { name: '今日の予定・訪問記録' }).waitFor();
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(before.data.visits, sample.data.visits);
  });
  await check('サブパスから旅程取込・予定追加ができる', async () => {
    const isolated = await browser.newContext(); const tab = await isolated.newPage();
    await tab.goto(new URL('/machiaruki-travel/', base).href);
    await openImport(tab); await upload(itinerary('subpath'), tab);
    await tab.getByRole('button', { name: '確認して追加する' }).click();
    await tab.getByRole('heading', { name: 'JSON取込 subpath' }).waitFor();
    await tab.getByRole('link', { name: '予定・記録', exact: true }).click();
    await tab.getByRole('button', { name: '＋ 予定を追加' }).click();
    await tab.getByLabel('施設名・予定名（必須）').fill('サブパスの予定');
    await tab.getByRole('button', { name: '保存する', exact: true }).click();
    await tab.locator('.timeline-card h3').filter({ hasText: 'サブパスの予定' }).waitFor();
    assert.equal((await snapshot(tab)).data.plans.length, 9);
    await isolated.close();
  });
  await check('編集したデータをブラウザプロセス終了・再起動後も保持', async () => {
    const root = fileURLToPath(new URL('../test-results/', import.meta.url));
    const profile = await mkdtemp(path.join(root, 'step3-persistence-'));
    let persistent;
    try {
      persistent = await chromium.launchPersistentContext(profile, launch);
      let tab = persistent.pages()[0]; await tab.goto(base); await addViaStorage(tab, sample);
      await tab.evaluate(async () => {
        const storage = await import('./src/storage.js'); const state = await storage.loadWorkspace(); const plan = state.data.plans[1];
        await storage.savePlan({ tripId: plan.tripId, date: '2026-10-30', time: '15:00', name: '再起動後も残す編集', category: plan.category, address: plan.address, memo: '持続性確認', location: plan.location }, { planId: plan.id, expectedPlan: plan });
      });
      const before = await snapshot(tab);
      await persistent.close(); persistent = undefined;
      persistent = await chromium.launchPersistentContext(profile, launch);
      tab = persistent.pages()[0]; await tab.goto(`${base}#/timeline`);
      await tab.locator('.timeline-card h3').filter({ hasText: '再起動後も残す編集' }).waitFor();
      assert.deepEqual(await snapshot(tab), before);
    } finally {
      if (persistent) await persistent.close();
      const relative = path.relative(root, profile);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Profile outside test-results');
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
  await check('モバイル取込画面で横はみ出しがなく、取込文字列を安全に表示', async () => {
    await go('home'); await page.setViewportSize({ width: 390, height: 844 });
    const value = itinerary('safe'); value.data.trips[0].name = '<img src=x onerror="window.injected=true">';
    await openImport(); await upload(value);
    assert.ok(await page.locator('.form-dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth + 1));
    assert.equal(await page.locator('.import-preview img').count(), 0);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    await page.screenshot({ path: 'test-results/step3-mobile-import.png' });
    await close();
  });
  await check('ページのJavaScript例外・コンソールエラーなし', async () => assert.deepEqual(errors, []));
} finally { await context.close(); await browser.close(); }
console.log(`\n${results.filter(Boolean).length}/${results.length} Step 3 browser checks passed (Edge; not iPhone Safari).`);
if (results.some(value => !value)) process.exitCode = 1;
