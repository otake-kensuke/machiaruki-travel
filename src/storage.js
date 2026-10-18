import { emptyData, SCHEMA_VERSION, newId } from './model.js';
import { DataError, validateData, validateEnvelope, isTimestamp } from './validation.js';
import { dataForAddition } from './transfer.js';
import { applyPlanSave, applyPlanDelete } from './plans.js';
import { applyVisitSave } from './visits.js';
import { assertSnapshotMatches, serializeBackup } from './backups.js';

export const DB_NAME = 'machiaruki-travel';
export const DB_VERSION = 1;
let opening;
let connection;

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error('このブラウザでは端末保存を利用できません。Safariの通常モードで開いてください。'));
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let abandoned = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('workspace')) db.createObjectStore('workspace');
    };
    request.onblocked = () => {
      abandoned = true;
      opening = undefined;
      reject(new Error('別のタブが保存領域を使用しています。他のタブを閉じてから再読込してください。'));
    };
    request.onerror = () => { opening = undefined; reject(new Error('端末の保存領域を開けませんでした。既存データは初期化していません。')); };
    request.onsuccess = () => {
      if (abandoned) { request.result.close(); return; }
      connection = request.result;
      connection.onversionchange = () => { connection.close(); opening = undefined; connection = undefined; };
      resolve(connection);
    };
  });
  return opening;
}

function decode(record) {
  if (record === undefined) return { revision: 0, data: emptyData(), updatedAt: null };
  if (!record || typeof record !== 'object' || record.schemaVersion !== SCHEMA_VERSION) throw new DataError(['保存データの形式に対応していません。初期化せず処理を停止しました。']);
  if (!Number.isInteger(record.revision) || record.revision < 1) throw new DataError(['保存データのリビジョンが不正です。']);
  validateData(record.data);
  return record;
}

export async function loadWorkspace() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('workspace', 'readonly');
    let result;
    let failure;
    const request = transaction.objectStore('workspace').get('active');
    request.onsuccess = () => { try { result = decode(request.result); } catch (error) { failure = error; transaction.abort(); } };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = transaction.onerror = () => reject(failure || new Error('保存データを読み込めませんでした。初期化はしていません。'));
  });
}

// Synchronous mutation inside the transaction prevents lost updates across tabs.
async function changeWorkspace(change) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('workspace', 'readwrite');
    const store = transaction.objectStore('workspace');
    let result;
    let failure;
    const request = store.get('active');
    request.onsuccess = () => {
      try {
        const current = decode(request.result);
        const data = change(current.data);
        validateData(data);
        result = { schemaVersion: SCHEMA_VERSION, revision: current.revision + 1, updatedAt: new Date().toISOString(), data };
        store.put(result, 'active');
      } catch (error) {
        failure = error instanceof DataError ? error : new Error('端末への保存に失敗しました。空き容量やブラウザ設定を確認して再試行してください。既存データは変更していません。');
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = transaction.onerror = () => reject(failure || new Error('端末への保存に失敗しました。空き容量やブラウザ設定を確認してください。既存データは変更していません。'));
  });
}

export async function addDataset(incoming) {
  // Freeze the caller's input before the first await; the preview cannot change mid-save.
  const data = structuredClone(incoming);
  validateData(data);
  return changeWorkspace(current => dataForAddition(current, data));
}

export async function savePlan(input, options = {}) {
  const values = structuredClone(input);
  const expected = structuredClone(options);
  return changeWorkspace(current => applyPlanSave(current, values, expected));
}

export async function deletePlan(planId, expectedPlan) {
  const expected = structuredClone(expectedPlan);
  return changeWorkspace(current => applyPlanDelete(current, planId, expected));
}

export async function saveVisit(input, options = {}) {
  const values = structuredClone(input);
  const expected = structuredClone(options);
  return changeWorkspace(current => applyVisitSave(current, values, expected));
}

// All backup metadata and safety copies use extra keys in the existing store.
// Travel data stays at `active`; no DB upgrade, deletion or automatic initialization.
async function backupTransaction(mode, keys, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('workspace', mode);
    const store = transaction.objectStore('workspace');
    const records = {};
    let remaining = keys.length;
    let result;
    let failure;
    for (const key of keys) {
      const request = store.get(key);
      request.onsuccess = () => {
        records[key] = request.result;
        if (--remaining !== 0) return;
        try { result = action(records, store); }
        catch (error) {
          failure = error instanceof DataError ? error : new Error('退避情報・復元内容の保存に失敗しました。既存データは変更していません。');
          // A failed request or test-injected interruption may have already aborted it.
          try { transaction.abort(); } catch { /* Keep the original failure. */ }
        }
      };
    }
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = transaction.onerror = () => reject(failure || new Error('退避情報・復元内容の保存に失敗しました。既存データは変更していません。'));
  });
}

function exportStatus(prepared, sourceRevision, method, purpose) {
  if (!['download-requested', 'share-handed-off'].includes(method) || !Number.isInteger(sourceRevision) || sourceRevision < 0 || typeof prepared.filename !== 'string' || !isTimestamp(prepared.envelope?.exportedAt)) throw new DataError(['出力操作の情報が不正です。']);
  return { exportedAt: prepared.envelope.exportedAt, requestedAt: new Date().toISOString(), method, filename: prepared.filename, sourceRevision, purpose, saveVerified: false };
}

export async function loadBackupStatus() {
  return backupTransaction('readonly', ['backup-status'], records => {
    const status = records['backup-status'];
    return status && isTimestamp(status.requestedAt) && isTimestamp(status.exportedAt) && ['download-requested', 'share-handed-off'].includes(status.method) && Number.isInteger(status.sourceRevision) ? status : null;
  });
}

export async function recordBackupExport(prepared, sourceRevision, method, purpose = 'backup') {
  const status = exportStatus(prepared, sourceRevision, method, purpose);
  return backupTransaction('readwrite', ['backup-status'], (records, store) => { store.put(status, 'backup-status'); return status; });
}

export async function stageRestore(expectedWorkspace, incomingData, safetyEnvelope) {
  const expected = structuredClone(expectedWorkspace);
  const incoming = structuredClone(incomingData);
  const envelope = structuredClone(safetyEnvelope);
  validateData(incoming);
  serializeBackup(envelope); // The safety file must itself be valid and restorable.
  return backupTransaction('readwrite', ['active'], (records, store) => {
    const current = decode(records.active);
    assertSnapshotMatches(current, expected);
    if (JSON.stringify(current.data) !== JSON.stringify(envelope.data)) throw new DataError(['退避JSONと現在データが一致しません。復元を中止しました。']);
    const ticket = { id: newId(), sourceRevision: current.revision, safetyEnvelope: envelope, incomingData: incoming, stagedAt: new Date().toISOString(), exportStatus: null };
    store.put(ticket, 'restore-pending');
    return ticket.id;
  });
}

function requireRestoreTicket(records, id) {
  const ticket = records['restore-pending'];
  if (!ticket || ticket.id !== id) throw new DataError(['退避情報が見つからないか別の復元操作で更新されています。退避からやり直してください。']);
  const current = decode(records.active);
  assertSnapshotMatches(current, { revision: ticket.sourceRevision, data: ticket.safetyEnvelope?.data });
  return { ticket, current };
}

export async function recordSafetyExport(id, prepared, method) {
  return backupTransaction('readwrite', ['active', 'restore-pending'], (records, store) => {
    const { ticket } = requireRestoreTicket(records, id);
    if (JSON.stringify(prepared.envelope) !== JSON.stringify(ticket.safetyEnvelope)) throw new DataError(['退避用ファイルが一致しません。復元を中止しました。']);
    const status = exportStatus(prepared, ticket.sourceRevision, method, 'before-restore');
    store.put({ ...ticket, exportStatus: status }, 'restore-pending');
    store.put(status, 'backup-status');
    return status;
  });
}

export async function restoreWorkspace(id, { safetyConfirmed = false, replacementConfirmed = false } = {}) {
  return backupTransaction('readwrite', ['active', 'restore-pending'], (records, store) => {
    const { ticket, current } = requireRestoreTicket(records, id);
    if (safetyConfirmed !== true || replacementConfirmed !== true || !ticket.exportStatus) throw new DataError(['退避JSONの出力操作、保存先での利用者確認、全件置換の確認が必要です。']);
    validateEnvelope(ticket.safetyEnvelope);
    validateData(ticket.incomingData);
    const now = new Date().toISOString();
    const result = { schemaVersion: SCHEMA_VERSION, revision: current.revision + 1, updatedAt: now, data: ticket.incomingData };
    store.put({ envelope: ticket.safetyEnvelope, sourceRevision: current.revision, replacedAt: now }, 'restore-previous');
    store.put(result, 'active');
    store.delete('restore-pending');
    return result;
  });
}

export async function loadPreviousRestoreBackup() {
  return backupTransaction('readonly', ['restore-previous'], records => {
    const previous = records['restore-previous'];
    if (previous) { if (previous.envelope?.kind !== 'backup') throw new DataError(['直前の退避データの形式が不正です。']); validateEnvelope(previous.envelope); }
    return previous || null;
  });
}

export function closeDatabase() {
  connection?.close();
  connection = undefined;
  opening = undefined;
}
