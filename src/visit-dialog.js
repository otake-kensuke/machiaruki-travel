import { el, formDialog, actionButton } from './ui.js';
import { localDate, timeLabel } from './model.js';
import { planTimeInput } from './plans.js';
import { visitTimestamp } from './visits.js';
import { startPositionRequest } from './geolocation.js';
import { saveVisit } from './storage.js';

const field = (label, input) => el('div', { className: 'form-field' }, el('label', { className: 'field-label', for: input.id }, label), input);

export function openVisitEditor({ trip, plan = null, visit = null, onSaved }) {
  const expectedVisit = visit ? structuredClone(visit) : null;
  const originalAt = visit?.visitedAt || new Date().toISOString();
  const view = formDialog(visit ? '訪問記録を編集' : '訪問を記録', 'RECORD A MOMENT');
  const name = el('input', { id: 'visit-name', type: 'text', required: true, maxlength: 500, value: visit?.name || plan?.name || '', autocomplete: 'off' });
  const date = el('input', { id: 'visit-date', type: 'date', required: true, value: localDate(originalAt, trip.timeZone) });
  const time = el('input', { id: 'visit-time', type: 'time', required: true, value: planTimeInput(originalAt, trip.timeZone) });
  const address = el('input', { id: 'visit-address', type: 'text', maxlength: 2000, value: visit?.address || (visit ? '' : plan?.address || '') });
  const memo = el('textarea', { id: 'visit-memo', rows: 4, maxlength: 10000 }, visit?.memo || '');
  const status = el('p', { className: 'gps-status', role: 'status', 'aria-live': 'polite' });
  const retry = actionButton('GPSを再取得', () => void acquire(), 'button secondary small-button');
  const editor = el('div', { className: 'visit-editor' },
    el('p', { className: 'muted' }, visit ? '日時・施設名・住所・メモを変更できます。取得済みの地点と予定への関連付けは保持します。' : plan ? '施設名を予定から引き継ぎました。実際に訪れた施設名を確認してください。' : '予定外の訪問です。施設名を入力してください。'),
    field('施設名（必須）', name),
    el('div', { className: 'form-row' }, field('訪問日（必須）', date), field('訪問時刻（必須）', time)),
    el('p', { className: 'muted' }, `実際の訪問日時です。タイムゾーン：${trip.timeZone}`),
    el('section', { className: 'gps-panel', 'aria-label': '訪問地点' }, el('strong', {}, '訪問地点'), status, !visit && retry),
    field('住所（任意・座標がないときの検索用）', address), field('メモ（任意）', memo)
  );
  const preview = el('div', { className: 'visit-confirm' });
  preview.hidden = true;
  view.fields.append(editor, preview);
  const back = actionButton('内容を修正', () => {
    candidate = null;
    preview.hidden = true;
    editor.hidden = false;
    back.hidden = true;
    view.submit.textContent = '内容を確認';
    view.error.textContent = '';
    name.focus();
  }, 'button secondary');
  back.hidden = true;
  view.submit.before(back);
  view.submit.textContent = '内容を確認';
  let location = visit?.location || null;
  let locationSource = visit?.locationSource || 'none';
  let candidate = null;
  let busy = false;
  let request;
  let sequence = 0;
  function stopGPS() { sequence++; request?.cancel(); request = null; }
  function locationText() {
    if (!location) return '座標なしで記録します。施設名や住所からGoogleマップを検索できます。';
    const point = `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`;
    if (locationSource !== 'gps') return `保存済みの手入力地点：${point}`;
    return `GPS地点：${point}\n精度 約${Math.round(location.accuracy)}m / 取得 ${new Intl.DateTimeFormat('ja-JP', { timeZone: trip.timeZone, dateStyle: 'short', timeStyle: 'medium' }).format(new Date(location.capturedAt))}\n施設名は自動判定していません。入力内容を確認してください。`;
  }
  async function acquire() {
    stopGPS();
    const attempt = sequence;
    location = null; locationSource = 'none';
    retry.disabled = true;
    status.textContent = '位置情報を取得中です。入力を続けられます。取得を待たず、座標なしで確認・保存することもできます。';
    request = startPositionRequest();
    const outcome = await request.promise;
    if (attempt !== sequence || !view.dialog.open || candidate) return;
    request = null; retry.disabled = false;
    if (outcome.status === 'success') { location = outcome.location; locationSource = 'gps'; status.textContent = locationText(); }
    else if (outcome.status === 'error') status.textContent = outcome.message;
  }
  view.dialog.addEventListener('close', stopGPS);
  view.form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    if (!candidate) {
      try {
        if (!name.value.trim()) throw new Error('施設名を入力してください。');
        const visitedAt = visitTimestamp(date.value, time.value, trip.timeZone, originalAt);
        stopGPS(); retry.disabled = false;
        status.textContent = locationText();
        candidate = { tripId: trip.id, planId: visit ? visit.planId : plan?.id || null, name: name.value.trim(), visitedAt, address: address.value, memo: memo.value, location: structuredClone(location), locationSource };
        preview.replaceChildren(el('h3', {}, '保存する内容'), el('h3', {}, candidate.name),
          el('p', {}, `訪問 ${localDate(visitedAt, trip.timeZone)} ${timeLabel(visitedAt, trip.timeZone)} / ${trip.timeZone}`),
          el('p', { className: 'muted' }, candidate.planId ? '元の予定に関連付けて保存します。' : '予定外の訪問として保存します。'),
          el('p', { className: 'gps-status' }, locationText()), candidate.address && el('p', {}, candidate.address),
          el('p', { className: 'visit-memo' }, candidate.memo || 'メモなし'));
        editor.hidden = true; preview.hidden = false; back.hidden = false;
        view.error.textContent = ''; view.submit.textContent = 'この内容で保存'; view.submit.focus();
      } catch (error) { view.showError(error); }
      return;
    }
    busy = true; view.setBusy(true); back.disabled = true;
    try {
      const result = await saveVisit(candidate, { visitId: visit?.id || null, expectedVisit });
      view.dialog.close();
      onSaved(result, trip.id, localDate(candidate.visitedAt, trip.timeZone), visit ? '訪問記録を更新しました。' : '訪問記録を保存しました。');
    } catch (error) { view.showError(error); }
    finally { busy = false; view.setBusy(false); back.disabled = false; }
  });
  view.open();
  if (visit) status.textContent = locationText(); else void acquire();
}
