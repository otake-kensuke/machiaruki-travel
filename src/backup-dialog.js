import { el, actionButton, formDialog } from './ui.js';
import { createBackup } from './backups.js';
import { prepareBackupFile, canShareFile, downloadBackupFile, shareBackupFile } from './file-export.js';
import { loadWorkspace, loadPreviousRestoreBackup, recordBackupExport } from './storage.js';
import { backupSummary } from './backup-ui.js';

export function openBackupDialog(onExported) {
  const view = formDialog('バックアップを保存', 'EXPORT ALL TRAVEL DATA');
  view.submit.hidden = true;
  view.form.addEventListener('submit', event => event.preventDefault());
  const status = el('p', { role: 'status', className: 'backup-status' }, 'バックアップを準備しています…');
  view.fields.append(status);
  let busy = false;
  view.open();
  async function run(prepared, revision, purpose, share) {
    if (busy) return;
    busy = true; view.setBusy(true); view.error.textContent = '';
    let handedOff = false;
    try {
      // No asynchronous work before the native share call: keep user activation.
      if (share) await shareBackupFile(prepared); else downloadBackupFile(prepared);
      handedOff = true;
      await recordBackupExport(prepared, revision, share ? 'share-handed-off' : 'download-requested', purpose);
      status.textContent = share ? '共有画面へファイルを渡しました。「ファイルに保存」を選び、保存先で確認してください。保存完了は未確認です。' : 'ダウンロードを要求しました。保存先でJSONファイルを確認してください。保存完了は未確認です。';
      void onExported();
    } catch (error) {
      if (error.name === 'AbortError' && !handedOff) status.textContent = '共有をキャンセルしました。出力操作の履歴は更新していません。';
      else view.showError(new Error(handedOff ? `出力操作は行いましたが、履歴を保存できませんでした。保存先を確認してください。\n${error.message}` : `ファイルを出力できませんでした。\n${error.message}`));
    } finally { busy = false; view.setBusy(false); }
  }
  function buttons(prepared, revision, purpose, prefix = '') {
    return el('div', { className: 'backup-actions' },
      el('div', { className: 'backup-method' },
        actionButton(`${prefix}JSONをダウンロード`, () => void run(prepared, revision, purpose, false), 'button secondary'),
        el('p', { className: 'muted backup-method-note' }, 'この端末へJSONファイルをダウンロードします。')),
      canShareFile(prepared) && el('div', { className: 'backup-method' },
        actionButton(`${prefix}共有して「ファイル」に保存`, () => void run(prepared, revision, purpose, true), 'button secondary'),
        el('p', { className: 'muted backup-method-note' }, '共有画面から「ファイルに保存」を選びます。')));
  }
  void (async () => {
    try {
      const current = await loadWorkspace();
      const prepared = prepareBackupFile(createBackup(current.data));
      if (!view.dialog.open) return;
      view.fields.append(backupSummary(current.data, '出力する全データ'),
        el('p', { className: 'muted' }, 'ファイル作成時点のデータです。共有が利用できるiPhoneでは共有先の「ファイルに保存」を選べます。共有非対応ならダウンロードを使ってください。'),
        el('p', { className: 'backup-filename' }, prepared.filename), buttons(prepared, current.revision, 'backup'));
      status.textContent = 'JSONを準備しました。まだダウンロード・共有していません。';
      try {
        const previous = await loadPreviousRestoreBackup();
        if (previous && view.dialog.open) {
          const safety = prepareBackupFile(previous.envelope, 'before-restore');
          view.fields.append(el('details', { className: 'previous-backup' }, el('summary', {}, '直前の復元前データを取り出す'),
            backupSummary(previous.envelope.data, '直前の復元で退避したデータ'),
            el('p', { className: 'muted' }, '現在データとは異なる退避コピーです。内容を確認して保存してください。'),
            buttons(safety, previous.sourceRevision, 'before-restore', '退避用')));
        }
      } catch { if (view.dialog.open) view.fields.append(el('p', { className: 'error-text' }, '直前の退避コピーは読み込めませんでした。現在データの出力は利用できます。')); }
    } catch (error) { if (view.dialog.open) { status.textContent = 'バックアップの準備を中止しました。'; view.showError(error); } }
  })();
}
