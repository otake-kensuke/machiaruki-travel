import { el, actionButton, formDialog } from './ui.js';
import { createBackup, parseBackup, MAX_BACKUP_BYTES, assertSnapshotMatches } from './backups.js';
import { prepareBackupFile, canShareFile, downloadBackupFile, shareBackupFile } from './file-export.js';
import { loadWorkspace, stageRestore, recordSafetyExport, restoreWorkspace } from './storage.js';
import { backupSummary } from './backup-ui.js';

export function openRestoreDialog(onRestored, onExported) {
  const view = formDialog('バックアップから復元', 'REPLACE ALL TRAVEL DATA');
  const file = el('input', { id: 'restore-file', type: 'file', accept: '.json,application/json' });
  const status = el('p', { className: 'backup-status', role: 'status' });
  const preview = el('div', { className: 'restore-preview' });
  const prepare = actionButton('復元前の退避JSONを準備', () => void stage(), 'button secondary');
  const outputs = el('div', { className: 'backup-actions' });
  const saved = el('input', { id: 'safety-confirmed', type: 'checkbox', disabled: true });
  const replace = el('input', { id: 'replacement-confirmed', type: 'checkbox', disabled: true });
  let candidate = null;
  let expected = null;
  let ticket = null;
  let safety = null;
  let exportRequested = false;
  let busy = false;
  let generation = 0;
  view.submit.textContent = '全データを置き換えて復元';
  view.submit.classList.add('danger');
  prepare.hidden = true;
  view.fields.append(el('p', { className: 'backup-warning' }, 'この端末の全旅行・全訪問記録を置き換えます。旅程の追加とは別の操作です。'),
    el('label', { for: file.id, className: 'field-label' }, 'バックアップJSONファイル（20 MiB以下）'), file, status, preview, prepare, outputs,
    el('label', { className: 'check-field', for: saved.id }, saved, '退避JSONを安全な保存先に保存し、ファイルを開いて内容を確認しました（利用者による確認）'),
    el('label', { className: 'check-field', for: replace.id }, replace, '上記の現在データがすべて置き換わることを確認しました'));
  function update() {
    saved.disabled = !exportRequested || busy;
    replace.disabled = !ticket || busy;
    view.submit.disabled = busy || !candidate || !ticket || !exportRequested || !saved.checked || !replace.checked;
  }
  function resetSafety() { ticket = null; safety = null; exportRequested = false; saved.checked = false; replace.checked = false; outputs.replaceChildren(); update(); }
  function drawPreview() {
    preview.replaceChildren(el('div', {}, backupSummary(expected.data, '置換される現在の全データ'), backupSummary(candidate.data, '復元後の全データ'),
      el('p', { className: 'muted' }, `ファイル出力日時：${candidate.exportedAt}`),
      !candidate.data.trips.length && el('p', { className: 'backup-warning' }, '復元後は空データになります。現在の旅行・訪問記録は退避JSONへ保存してから置き換えます。')));
  }
  async function exporting(share) {
    if (busy || !safety || !ticket) return;
    busy = true; view.setBusy(true); update(); view.error.textContent = '';
    let handedOff = false;
    try {
      if (share) await shareBackupFile(safety); else downloadBackupFile(safety);
      handedOff = true;
      await recordSafetyExport(ticket, safety, share ? 'share-handed-off' : 'download-requested');
      exportRequested = true;
      status.textContent = '退避JSONの出力操作を行いました。保存完了はアプリでは確認できません。保存先でファイルを開き、内容を確認してからチェックしてください。';
      void onExported();
    } catch (error) {
      exportRequested = false; saved.checked = false;
      if (error.name === 'AbortError') status.textContent = '共有をキャンセルしました。復元は実行できません。';
      else view.showError(new Error(handedOff ? `出力操作後の退避確認に失敗したため、復元を止めています。\n${error.message}` : `退避JSONを出力できませんでした。復元は実行しません。\n${error.message}`));
    } finally { busy = false; view.setBusy(false); update(); }
  }
  async function stage() {
    if (busy || !candidate || !expected) return;
    busy = true; view.setBusy(true); update(); view.error.textContent = '';
    resetSafety();
    try {
      const current = await loadWorkspace();
      try { assertSnapshotMatches(current, expected); }
      catch (error) { expected = current; drawPreview(); throw error; }
      const prepared = prepareBackupFile(createBackup(current.data), 'before-restore');
      const id = await stageRestore(current, candidate.data, prepared.envelope);
      if (!view.dialog.open) return;
      ticket = id; safety = prepared;
      outputs.replaceChildren(...[el('p', { className: 'backup-filename' }, safety.filename),
        actionButton('退避JSONをダウンロード', () => void exporting(false)),
        canShareFile(safety) && actionButton('退避JSONを共有して「ファイル」に保存', () => void exporting(true), 'button secondary')].filter(Boolean));
      status.textContent = '退避JSONと端末内の退避情報を準備しました。まだファイルへ保存していません。下の出力操作を行ってください。';
    } catch (error) { view.showError(error); }
    finally { busy = false; view.setBusy(false); update(); }
  }
  saved.addEventListener('change', update); replace.addEventListener('change', update);
  file.addEventListener('change', async () => {
    const attempt = ++generation;
    candidate = null; expected = null; resetSafety(); preview.replaceChildren(); prepare.hidden = true; view.error.textContent = '';
    const selected = file.files[0];
    if (!selected) { status.textContent = ''; return; }
    status.textContent = 'バックアップ全件を検証しています…';
    try {
      if (selected.size > MAX_BACKUP_BYTES) throw new Error('バックアップは20 MiB以下のJSONを選択してください。');
      const envelope = parseBackup(await selected.text());
      const current = await loadWorkspace();
      if (attempt !== generation || !view.dialog.open) return;
      candidate = envelope; expected = current;
      drawPreview(); prepare.hidden = false;
      status.textContent = '検証できました。まだ変更していません。置換対象を確認して退避JSONを準備してください。';
    } catch (error) { if (attempt === generation && view.dialog.open) { status.textContent = '復元を中止しました。既存データは変更していません。'; view.showError(error); } }
    update();
  });
  view.form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !candidate || !ticket || !exportRequested || !saved.checked || !replace.checked) return;
    busy = true; view.setBusy(true); update(); view.error.textContent = '';
    try {
      const result = await restoreWorkspace(ticket, { safetyConfirmed: saved.checked, replacementConfirmed: replace.checked });
      view.dialog.close(); onRestored(result);
    } catch (error) { view.showError(error); }
    finally { busy = false; view.setBusy(false); update(); }
  });
  view.dialog.addEventListener('close', () => { generation++; candidate = null; expected = null; });
  update(); view.open();
}
