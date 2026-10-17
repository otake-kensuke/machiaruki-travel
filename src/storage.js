import { emptyData, SCHEMA_VERSION } from './model.js';
import { DataError, validateData } from './validation.js';
import { dataForAddition } from './transfer.js';
import { applyPlanSave, applyPlanDelete } from './plans.js';
import { applyVisitSave } from './visits.js';

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

export function closeDatabase() {
  connection?.close();
  connection = undefined;
  opening = undefined;
}
