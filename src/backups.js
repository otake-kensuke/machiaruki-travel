import { APP_ID, SCHEMA_VERSION, COLLECTIONS } from './model.js';
import { DataError, validateData, validateEnvelope, isTimestamp } from './validation.js';

export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

export class RestoreConflictError extends DataError {
  constructor() { super(['現在データが別の画面で更新されています。置換対象を確認し直し、新しい退避JSONを保存してから復元してください。']); this.code = 'RESTORE_CONFLICT'; }
}

export function createBackup(data, exportedAt = new Date().toISOString()) {
  validateData(data);
  if (!isTimestamp(exportedAt)) throw new DataError(['バックアップ出力日時が不正です。']);
  return { appId: APP_ID, schemaVersion: SCHEMA_VERSION, kind: 'backup', exportedAt, data: structuredClone(data) };
}

export function serializeBackup(envelope) {
  if (envelope?.kind !== 'backup') throw new DataError(['バックアップ形式ではありません。']);
  validateEnvelope(envelope);
  let text;
  try { text = JSON.stringify(envelope, null, 2) + '\n'; }
  catch { throw new DataError(['JSONに変換できないデータがあるため出力を中止しました。']); }
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new DataError(['バックアップは20 MiBまで対応しています。出力・置換を中止しました。']);
  return text;
}

export function parseBackup(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new DataError(['バックアップは20 MiB以下のJSONを選択してください。']);
  let envelope;
  try { envelope = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new DataError(['JSONを読み取れません。バックアップファイルの形式を確認してください。']); }
  if (envelope?.kind !== 'backup') throw new DataError(['復元ではkindが「backup」のJSONを選択してください。旅程の追加は通常の旅程取込を使ってください。']);
  validateEnvelope(envelope);
  return envelope;
}

export function assertSnapshotMatches(current, expected) {
  if (!expected || current.revision !== expected.revision || JSON.stringify(current.data) !== JSON.stringify(expected.data)) throw new RestoreConflictError();
}

export function counts(data) {
  return Object.fromEntries(COLLECTIONS.map(key => [key, data[key].length]));
}

export function backupFilename(envelope, purpose = 'backup') {
  const stamp = new Date(envelope.exportedAt).toISOString().replace(/[-:.]/g, '');
  return `machiaruki-travel-${purpose === 'before-restore' ? 'before-restore' : 'backup'}-${stamp}.json`;
}
