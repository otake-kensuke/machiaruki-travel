import { backupFilename, serializeBackup } from './backups.js';

export function prepareBackupFile(envelope, purpose = 'backup') {
  const text = serializeBackup(envelope);
  const filename = backupFilename(envelope, purpose);
  const file = new File([text], filename, { type: 'application/json' });
  return { file, filename, envelope };
}

export function canShareFile(prepared, navigatorObject = globalThis.navigator) {
  try { return typeof navigatorObject?.share === 'function' && navigatorObject.canShare?.({ files: [prepared.file] }) === true; }
  catch { return false; }
}

// Called directly from a button handler, with the File already prepared.
export function shareBackupFile(prepared, navigatorObject = globalThis.navigator) {
  if (!canShareFile(prepared, navigatorObject)) throw new Error('ファイル共有に対応していません。JSONのダウンロードを利用してください。');
  return navigatorObject.share({ files: [prepared.file], title: '街歩きラボのバックアップ' });
}

export function downloadBackupFile(prepared) {
  const url = URL.createObjectURL(prepared.file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = prepared.filename;
  anchor.hidden = true;
  document.body.append(anchor);
  try { anchor.click(); }
  catch (error) { URL.revokeObjectURL(url); throw error; }
  finally { anchor.remove(); }
  // Safari may still be consuming the blob after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
