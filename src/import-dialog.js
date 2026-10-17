import { el, formDialog } from './ui.js';
import { tripData } from './model.js';
import { MAX_IMPORT_BYTES, parseItinerary } from './transfer.js';
import { loadWorkspace, addDataset } from './storage.js';

export function openImportDialog(onSaved) {
  const view = formDialog('旅程JSONを取り込む', 'IMPORT ITINERARY');
  const file = el('input', { id: 'itinerary-file', type: 'file', accept: '.json,application/json' });
  const status = el('p', { className: 'muted', role: 'status' });
  const preview = el('div', { className: 'import-preview' });
  let pending = null;
  let generation = 0;
  let busy = false;
  view.submit.textContent = '確認して追加する';
  view.submit.disabled = true;
  view.fields.append(
    el('p', {}, '旅行エージェントが作成した旅程ファイルを選んでください。内容を確認してから、この端末に保存します。'),
    el('label', { for: file.id, className: 'field-label' }, '旅程JSONファイル（2 MiB以下）'), file,
    el('p', { className: 'muted' }, '新しい旅行として追加します。同じIDがある場合は中止し、既存の予定・訪問記録は変更しません。バックアップ形式は取り込めません。'), status, preview
  );
  view.dialog.addEventListener('close', () => { generation++; pending = null; });
  file.addEventListener('change', async () => {
    const attempt = ++generation;
    pending = null;
    preview.replaceChildren();
    view.error.textContent = '';
    view.submit.disabled = true;
    const selected = file.files[0];
    if (!selected) { status.textContent = ''; return; }
    status.textContent = '旅程を検証しています…';
    try {
      if (selected.size > MAX_IMPORT_BYTES) throw new Error('旅程ファイルは2 MiB以下のJSONを選択してください。');
      const text = await selected.text();
      const current = await loadWorkspace();
      const data = parseItinerary(text, current.data);
      if (attempt !== generation || !view.dialog.open) return;
      pending = data;
      preview.replaceChildren(el('h3', {}, '取込前の確認'), ...data.trips.map(trip => {
        const details = tripData(data, trip.id);
        return el('article', { className: 'import-trip' }, el('h3', {}, trip.name),
          el('p', {}, `${trip.startDate} 〜 ${trip.endDate}`),
          el('p', { className: 'muted' }, `${details.days.length}日分 / 予定 ${details.plans.length}件 / 交通 ${details.transportations.length}件 / 宿泊 ${details.accommodations.length}件`));
      }), el('p', { className: 'preview-total' }, `合計 ${data.trips.length}旅行・予定 ${data.plans.length}件を追加します。`));
      status.textContent = `${selected.name}：検証できました。まだ保存していません。`;
      view.submit.disabled = false;
    } catch (error) {
      if (attempt !== generation || !view.dialog.open) return;
      status.textContent = '取込を中止しました。既存データは変更していません。';
      view.showError(error);
    }
  });
  view.form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!pending || busy) return;
    busy = true;
    view.setBusy(true);
    try {
      const firstTrip = pending.trips[0].id;
      const result = await addDataset(pending); // Recheck against the latest DB in the transaction.
      view.dialog.close();
      onSaved(result, firstTrip);
    } catch (error) { view.showError(error); }
    finally {
      busy = false;
      view.setBusy(false);
      view.submit.textContent = '確認して追加する';
    }
  });
  view.open();
}
