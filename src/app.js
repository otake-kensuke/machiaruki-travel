import { emptyData, localDate, tripData, journalDays } from './model.js';
import { validateEnvelope } from './validation.js';
import { loadWorkspace, addDataset, loadBackupStatus } from './storage.js';
import { el, route } from './ui.js';
import { homeScreen } from './screens/home.js';
import { timelineScreen } from './screens/timeline.js';
import { reviewScreen } from './screens/review.js';
import { openImportDialog } from './import-dialog.js';
import { openPlanEditor, openPlanDelete } from './plan-dialog.js';
import { openVisitEditor } from './visit-dialog.js';
import { openBackupDialog } from './backup-dialog.js';
import { openRestoreDialog } from './restore-dialog.js';
import { backupPanel } from './backup-ui.js';
import { startOfflineSupport } from './offline.js';
import { BRAND } from './brand.js';
import { icon } from './icons.js';
import { centerSelectedDate } from './date-strip-scroll.js';

const content = document.querySelector('#content');
const dialog = document.querySelector('#sample-dialog');
const confirm = document.querySelector('#confirm-sample');
const sampleError = document.querySelector('#sample-error');
const sampleTripId = 'sample-trip-hokkaido-2026';
for (const anchor of document.querySelectorAll('[data-page]')) anchor.querySelector('span').replaceChildren(icon({ home: 'home', timeline: 'list', review: 'diamond' }[anchor.dataset.page]));
let workspace = { data: emptyData(), updatedAt: null };
let failed = false;
let loading = true;
let saving = false;
let backupStatus = null;
let backupHistoryError = false;

function showNotice(text) {
  const notice = document.querySelector('#notice');
  notice.textContent = text;
  notice.classList.add('visible');
  clearTimeout(showNotice.timer);
  showNotice.timer = setTimeout(() => notice.classList.remove('visible'), 6000);
}

function openSample() {
  sampleError.textContent = '';
  dialog.showModal();
}

function didSave(result, tripId, date, message) {
  workspace = result;
  location.hash = route('timeline', tripId, date);
  render();
  showNotice(message);
}

function openImport() {
  openImportDialog((result, tripId) => {
    workspace = result;
    location.hash = route('home', tripId);
    render();
    showNotice('旅程をこの端末に追加しました。既存データは保持しています。');
  });
}

function render() {
  if (loading || failed) return;
  const [path, query] = location.hash.slice(1).split('?');
  const page = ['home', 'timeline', 'review'].includes(path?.slice(1)) ? path.slice(1) : 'home';
  const params = new URLSearchParams(query || '');
  const trip = workspace.data.trips.find(item => item.id === params.get('trip')) || workspace.data.trips[0];
  const data = trip ? tripData(workspace.data, trip.id) : emptyData();
  const days = journalDays(data, trip?.timeZone || 'Asia/Tokyo');
  const today = trip ? localDate(new Date(), trip.timeZone) : '';
  const date = days.find(day => day.date === params.get('date'))?.date || days.find(day => day.date === today)?.date || days[0]?.date || trip?.startDate || today;
  const context = {
    trip, data, date, requestedDate: params.get('date'), openSample, openImport, savedAt: workspace.updatedAt,
    sampleAvailable: !workspace.data.trips.some(item => item.id === sampleTripId),
    addPlan: () => openPlanEditor({ trip, data, date, onSaved: didSave }),
    editPlan: plan => openPlanEditor({ trip, data, date, plan, onSaved: didSave }),
    removePlan: plan => openPlanDelete({ trip, data, plan, onSaved: didSave }),
    addVisit: plan => openVisitEditor({ trip, plan, onSaved: didSave }),
    editVisit: visit => openVisitEditor({ trip, visit, onSaved: didSave })
  };
  if (page === 'home') context.backupPanel = backupPanel({
    status: backupStatus, revision: workspace.revision, historyError: backupHistoryError,
    openBackup: () => openBackupDialog(refresh),
    openRestore: () => openRestoreDialog(result => {
      workspace = result;
      location.hash = '#/home';
      render(); showNotice('全データを復元しました。直前のデータは退避コピーにも保持しています。');
    }, refresh)
  });
  const screen = { home: homeScreen, timeline: timelineScreen, review: reviewScreen }[page](context);
  const oldStrip = content.querySelector('.date-strip');
  const previousDatePosition = oldStrip && { left: oldStrip.scrollLeft, selected: oldStrip.querySelector('[aria-current="date"]')?.getAttribute('href') };
  content.replaceChildren(screen);
  centerSelectedDate(content.querySelector('.date-strip'), previousDatePosition);
  if (workspace.data.trips.length > 1) {
    const select = el('select', { id: 'trip-select' }, workspace.data.trips.map(item => el('option', { value: item.id }, item.name)));
    select.value = trip.id;
    select.addEventListener('change', () => { location.hash = route(page, select.value); });
    const picker = el('div', { className: 'trip-picker' }, el('label', { for: 'trip-select' }, '旅行を選択'), select);
    if (page === 'home') screen.querySelector('[data-trip-picker]').append(picker); else content.prepend(picker);
  }
  for (const anchor of document.querySelectorAll('[data-page]')) {
    anchor.href = trip ? route(anchor.dataset.page, trip.id, date) : `#/${anchor.dataset.page}`;
    if (anchor.dataset.page === page) anchor.setAttribute('aria-current', 'page'); else anchor.removeAttribute('aria-current');
  }
  document.title = `${{ home: '旅行ホーム', timeline: '今日の予定・訪問記録', review: '旅の振り返り' }[page]}｜${BRAND.name}`;
}

async function refresh() {
  try {
    workspace = await loadWorkspace();
    try { backupStatus = await loadBackupStatus(); backupHistoryError = false; }
    catch { backupStatus = null; backupHistoryError = true; }
    loading = false;
    failed = false;
    render();
  } catch (error) {
    loading = false;
    failed = true;
    const retry = el('button', { className: 'button', type: 'button' }, '再読込');
    retry.addEventListener('click', () => location.reload());
    content.replaceChildren(el('section', { className: 'empty-card', role: 'alert' }, el('h1', {}, '保存領域を読み込めませんでした'), el('p', { className: 'error-text' }, error.message), el('p', {}, '既存データは初期化していません。ほかのタブやブラウザ設定を確認してください。'), retry));
  }
}

confirm.addEventListener('click', async () => {
  if (saving) return;
  saving = true;
  confirm.disabled = true;
  confirm.textContent = '保存しています…';
  try {
    const response = await fetch(new URL('../samples/hokkaido-2026.sample.json', import.meta.url));
    if (!response.ok) throw new Error('サンプル旅程を取得できませんでした。通信を確認して再試行してください。');
    const data = validateEnvelope(await response.json());
    workspace = await addDataset(data);
    failed = false;
    dialog.close();
    location.hash = route('home', sampleTripId);
    render();
    showNotice('サンプル旅程をこの端末に保存しました。');
  } catch (error) { sampleError.textContent = error.message; }
  finally { saving = false; confirm.disabled = false; confirm.textContent = 'この端末に読み込む'; }
});
document.querySelector('#cancel-sample').addEventListener('click', () => { if (!saving) dialog.close(); });
document.querySelector('.skip-link').addEventListener('click', event => { event.preventDefault(); content.focus(); });
dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
dialog.querySelector('form').addEventListener('submit', event => { if (saving) event.preventDefault(); });
window.addEventListener('hashchange', event => {
  const [oldPage, oldQuery] = new URL(event.oldURL).hash.slice(1).split('?');
  const [nextPage, nextQuery] = new URL(event.newURL).hash.slice(1).split('?');
  const before = new URLSearchParams(oldQuery || ''); const after = new URLSearchParams(nextQuery || '');
  // The initial home can have no hash/trip parameter. Enlarged text may put its
  // date picker below the fold; keep that first selection in place too.
  const displayedTrip = params => workspace.data.trips.find(trip => trip.id === params.get('trip'))?.id || workspace.data.trips[0]?.id;
  const selectingHomeDay = (!oldPage || oldPage === '/home') && nextPage === '/home' && displayedTrip(before) === displayedTrip(after) && before.get('date') !== after.get('date');
  render();
  if (selectingHomeDay) document.querySelector('#home-date')?.focus({ preventScroll: true });
  else { content.focus({ preventScroll: true }); window.scrollTo(0, 0); }
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !saving && !loading) void refresh(); });
window.addEventListener('pageshow', event => { if (event.persisted) void refresh(); });
await refresh();

startOfflineSupport();
