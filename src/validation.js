import { APP_ID, SCHEMA_VERSION, COLLECTIONS } from './model.js';

export class DataError extends Error {
  constructor(errors) { super(errors.join('\n')); this.name = 'DataError'; this.errors = errors; }
}

const labels = { trips: '旅行', days: '日別', plans: '予定', transportations: '交通', accommodations: '宿泊', visits: '訪問記録' };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = value => typeof value === 'string' && value.trim().length > 0;
export function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
export function isTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  return isDate(value.slice(0, 10)) && !Number.isNaN(Date.parse(value)) && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60;
}

export function validateData(data) {
  const errors = [];
  if (!isObject(data)) throw new DataError(['dataはオブジェクトで指定してください。']);
  for (const key of COLLECTIONS) if (!Array.isArray(data[key])) errors.push(`${labels[key]}の一覧がありません。`);
  for (const key of Object.keys(data)) if (!COLLECTIONS.includes(key)) errors.push(`dataの未対応項目「${key}」は取り込めません。`);
  if (errors.length) throw new DataError(errors);
  const ids = new Set();
  const validTimeZones = new Set();
  const rowsByKey = {};
  for (const key of COLLECTIONS) {
    rowsByKey[key] = new Map();
    data[key].forEach((row, index) => {
      const path = `${labels[key]}${index + 1}件目`;
      if (!isObject(row)) { errors.push(`${path}の形式が不正です。`); return; }
      if (!isText(row.id) || row.id.length > 200) errors.push(`${path}のIDが不正です。`);
      else if (ids.has(row.id)) errors.push(`${path}のID「${row.id}」が重複しています。`);
      else { ids.add(row.id); rowsByKey[key].set(row.id, row); }
      for (const field of ['createdAt', 'updatedAt']) if (!isTimestamp(row[field])) errors.push(`${path}の${field}が不正です。`);
      if (isTimestamp(row.createdAt) && isTimestamp(row.updatedAt) && Date.parse(row.updatedAt) < Date.parse(row.createdAt)) errors.push(`${path}の更新日時が作成日時より前です。`);
      if (row.memo !== undefined && typeof row.memo !== 'string') errors.push(`${path}のメモは文字列で指定してください。`);
      if (row.address !== undefined && typeof row.address !== 'string') errors.push(`${path}の住所は文字列で指定してください。`);
    });
  }
  function text(row, field, path) { if (!isText(row[field])) errors.push(`${path}の${field}が未入力です。`); }
  function stamp(row, field, path, optional = false) { if (!(optional && row[field] === null) && !isTimestamp(row[field])) errors.push(`${path}の${field}が不正です。`); }
  function point(value, path) {
    if (value === null) return;
    if (!isObject(value) || typeof value.latitude !== 'number' || !Number.isFinite(value.latitude) || Math.abs(value.latitude) > 90 || typeof value.longitude !== 'number' || !Number.isFinite(value.longitude) || Math.abs(value.longitude) > 180) { errors.push(`${path}の緯度・経度が不正です。`); return; }
    if (value.accuracy !== undefined && value.accuracy !== null && (typeof value.accuracy !== 'number' || !Number.isFinite(value.accuracy) || value.accuracy < 0)) errors.push(`${path}の位置精度が不正です。`);
    if (value.capturedAt !== undefined && !isTimestamp(value.capturedAt)) errors.push(`${path}の位置取得日時が不正です。`);
  }
  for (const key of COLLECTIONS) {
    data[key].forEach((row, index) => {
      if (!isObject(row)) return;
      const path = `${labels[key]}${index + 1}件目`;
      if (key === 'trips') {
        text(row, 'name', path);
        if (!isDate(row.startDate) || !isDate(row.endDate) || row.endDate < row.startDate) errors.push(`${path}の旅行期間が不正です。`);
        try { if (!isText(row.timeZone)) throw new Error(); new Intl.DateTimeFormat('ja', { timeZone: row.timeZone }); validTimeZones.add(row.id); } catch { errors.push(`${path}のタイムゾーンが不正です。`); }
        if (row.isSample !== undefined && typeof row.isSample !== 'boolean') errors.push(`${path}のサンプル区分が不正です。`);
        return;
      }
      const trip = rowsByKey.trips.get(row.tripId);
      if (!trip) errors.push(`${path}の参照先の旅行がありません。`);
      if (key === 'days') {
        text(row, 'title', path);
        if (!isDate(row.date) || (trip && (row.date < trip.startDate || row.date > trip.endDate))) errors.push(`${path}の日付が旅行期間内ではありません。`);
      }
      if (key === 'plans') {
        text(row, 'name', path); text(row, 'category', path);
        const day = rowsByKey.days.get(row.dayId);
        if (!day || day.tripId !== row.tripId) errors.push(`${path}の参照先の日別データが不正です。`);
        stamp(row, 'startAt', path, true);
        if (!Number.isInteger(row.order) || row.order < 0) errors.push(`${path}の表示順が不正です。`);
        if (row.deletedAt !== undefined && row.deletedAt !== null) stamp(row, 'deletedAt', path);
        if (row.startAt && isTimestamp(row.startAt) && trip && day && validTimeZones.has(trip.id)) {
          const parts = new Intl.DateTimeFormat('en-CA', { timeZone: trip.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(row.startAt));
          const p = type => parts.find(part => part.type === type).value;
          if (`${p('year')}-${p('month')}-${p('day')}` !== day.date) errors.push(`${path}の開始日時と日別の日付が一致しません。`);
        }
        point(row.location, path);
      }
      if (key === 'transportations') {
        for (const field of ['mode', 'from', 'to', 'name']) text(row, field, path);
        stamp(row, 'departureAt', path); stamp(row, 'arrivalAt', path);
        if (Date.parse(row.arrivalAt) < Date.parse(row.departureAt)) errors.push(`${path}の到着が出発より前です。`);
      }
      if (key === 'accommodations') {
        text(row, 'name', path); text(row, 'address', path);
        stamp(row, 'checkInAt', path); stamp(row, 'checkOutAt', path);
        if (Date.parse(row.checkOutAt) < Date.parse(row.checkInAt)) errors.push(`${path}のチェックアウトがチェックインより前です。`);
      }
      if (key === 'visits') {
        text(row, 'name', path); stamp(row, 'visitedAt', path);
        const plan = rowsByKey.plans.get(row.planId);
        if (row.planId !== null && (!plan || plan.tripId !== row.tripId)) errors.push(`${path}の参照先の予定が不正です。`);
        if (!['gps', 'manual', 'none'].includes(row.locationSource)) errors.push(`${path}の位置取得方法が不正です。`);
        point(row.location, path);
        if (row.locationSource === 'none' && row.location !== null) errors.push(`${path}は位置未設定なのに座標があります。`);
        if (row.locationSource !== 'none' && row.location === null) errors.push(`${path}の座標がありません。`);
        if (row.locationSource === 'gps' && (!isObject(row.location) || typeof row.location.accuracy !== 'number' || !isTimestamp(row.location.capturedAt))) errors.push(`${path}のGPS精度または取得日時がありません。`);
      }
    });
  }
  const days = new Set();
  for (const day of data.days.filter(isObject)) {
    const key = `${day.tripId}/${day.date}`;
    if (days.has(key)) errors.push('同じ旅行・日付の日別データが重複しています。');
    days.add(key);
  }
  if (errors.length) throw new DataError(errors);
  return data;
}

export function validateEnvelope(value) {
  if (!isObject(value) || value.appId !== APP_ID) throw new DataError(['街歩きラボのデータではありません。']);
  if (value.schemaVersion !== SCHEMA_VERSION) throw new DataError(['未対応のスキーマバージョンです。既存データは変更しません。']);
  if (!['itinerary', 'backup'].includes(value.kind)) throw new DataError(['JSONの種類が不正です。']);
  if (!isTimestamp(value.exportedAt)) throw new DataError(['書き出し日時が不正です。']);
  if (value.kind === 'itinerary' && value.data?.visits !== undefined) throw new DataError(['旅程JSONには訪問記録を含められません。']);
  const data = value.kind === 'itinerary' ? { ...value.data, visits: [] } : value.data;
  validateData(data);
  return data;
}
