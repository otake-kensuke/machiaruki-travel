import { newId, localDate } from './model.js';
import { DataError, isTimestamp, validateData } from './validation.js';
import { planTimestamp, planTimeInput } from './plans.js';

export function visitTimestamp(date, time, timeZone, originalAt) {
  if (originalAt && date === localDate(originalAt, timeZone) && time === planTimeInput(originalAt, timeZone)) return originalAt;
  if (!time) throw new DataError(['訪問時刻を入力してください。']);
  try { return planTimestamp(date, time, timeZone); }
  catch (error) {
    if (error instanceof DataError) throw new DataError(error.errors.map(message => message.replaceAll('予定', '訪問')));
    throw error;
  }
}

export function applyVisitSave(data, input, { visitId = null, expectedVisit = null } = {}) {
  const old = visitId ? data.visits.find(visit => visit.id === visitId) : null;
  if (visitId && !old) throw new DataError(['この訪問記録が見つかりません。画面を開き直してください。']);
  if (old && (!expectedVisit || JSON.stringify(old) !== JSON.stringify(expectedVisit))) throw new DataError(['この訪問記録は別の画面で変更されています。入力内容を控えてから閉じ、最新の記録を開き直してください。']);
  if (!data.trips.some(trip => trip.id === input.tripId) || (old && old.tripId !== input.tripId)) throw new DataError(['訪問記録の旅行が不正です。']);
  if (typeof input.name !== 'string' || !input.name.trim()) throw new DataError(['施設名を入力してください。']);
  if (typeof input.memo !== 'string' || (input.address !== undefined && typeof input.address !== 'string') || !isTimestamp(input.visitedAt)) throw new DataError(['訪問日時・住所・メモの入力形式が不正です。']);
  // Editing changes only the visit's description/time. Its original linkage and point stay fixed.
  const planId = old ? old.planId : input.planId;
  if (planId !== null && !data.plans.some(plan => plan.id === planId && plan.tripId === input.tripId)) throw new DataError(['参照先の予定がありません。訪問記録は保存していません。']);
  const now = old ? new Date(Math.max(Date.now(), Date.parse(old.createdAt), Date.parse(old.updatedAt) + 1)).toISOString() : new Date().toISOString();
  const visit = {
    ...(old || {}), id: old?.id || newId(), tripId: input.tripId, planId,
    visitedAt: input.visitedAt, name: input.name.trim(), memo: input.memo,
    address: input.address === undefined ? old?.address || '' : input.address.trim(),
    location: old ? old.location : input.location,
    locationSource: old ? old.locationSource : input.locationSource,
    createdAt: old?.createdAt || now, updatedAt: now
  };
  const result = { ...data, visits: old ? data.visits.map(row => row.id === old.id ? visit : row) : [...data.visits, visit] };
  validateData(result);
  return result;
}
