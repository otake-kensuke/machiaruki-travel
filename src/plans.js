import { newId, localDate, markPlanDeleted } from './model.js';
import { DataError, isDate, validateData } from './validation.js';

function wallParts(epoch, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(epoch));
  const part = type => parts.find(item => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`;
}

// Convert a travel-local wall time, never a time in the device's current zone.
// Reject DST gaps/overlaps rather than silently choosing an unexpected instant.
export function planTimestamp(date, time, timeZone) {
  if (!isDate(date)) throw new DataError(['予定の日付が不正です。']);
  if (time === '') return null;
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new DataError(['予定の時刻が不正です。']);
  const target = `${date}T${time}:00`;
  const naive = Date.parse(`${target}Z`);
  const candidates = new Set();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const probe = naive + hours * 3600000;
    const offset = Date.parse(`${wallParts(probe, timeZone)}Z`) - probe;
    const candidate = naive - offset;
    if (wallParts(candidate, timeZone) === target) candidates.add(candidate);
  }
  if (candidates.size !== 1) throw new DataError(['夏時間の切替により、この時刻を一意に指定できません。別の時刻を選んでください。']);
  return new Date([...candidates][0]).toISOString();
}

export function planTimeInput(timestamp, timeZone) {
  return timestamp ? wallParts(Date.parse(timestamp), timeZone).slice(11, 16) : '';
}

function currentPlan(data, planId, expectedPlan) {
  const plan = data.plans.find(item => item.id === planId);
  if (!plan || plan.deletedAt) throw new DataError(['この予定は見つからないか、すでに削除されています。画面を閉じて再読込してください。']);
  if (!expectedPlan || JSON.stringify(plan) !== JSON.stringify(expectedPlan)) throw new DataError(['この予定は別の画面で変更されています。入力内容は保持しています。メモなどを控えてから画面を閉じ、最新の予定を開き直してください。']);
  return plan;
}

function modifiedAt(plan) {
  return new Date(Math.max(Date.now(), Date.parse(plan.createdAt), Date.parse(plan.updatedAt) + 1)).toISOString();
}

export function applyPlanSave(data, input, { planId = null, expectedPlan = null } = {}) {
  const old = planId ? currentPlan(data, planId, expectedPlan) : null;
  const trip = data.trips.find(item => item.id === (old?.tripId || input.tripId));
  if (!trip || input.tripId !== trip.id) throw new DataError(['予定の旅行が不正です。']);
  if (!isDate(input.date) || input.date < trip.startDate || input.date > trip.endDate) throw new DataError(['予定の日付は旅行期間内で指定してください。']);
  if (typeof input.name !== 'string' || !input.name.trim()) throw new DataError(['施設名・予定名を入力してください。']);
  if (typeof input.category !== 'string' || !input.category.trim() || typeof input.memo !== 'string' || typeof input.address !== 'string') throw new DataError(['分類・住所・メモの入力形式が不正です。']);
  let startAt;
  if (old?.startAt && input.date === localDate(old.startAt, trip.timeZone) && input.time === planTimeInput(old.startAt, trip.timeZone)) startAt = old.startAt;
  else startAt = planTimestamp(input.date, input.time, trip.timeZone);
  const now = old ? modifiedAt(old) : new Date().toISOString();
  let day = data.days.find(item => item.tripId === trip.id && item.date === input.date);
  const days = [...data.days];
  if (!day) {
    day = { id: newId(), tripId: trip.id, date: input.date, title: '旅の予定', createdAt: now, updatedAt: now };
    days.push(day);
  }
  const plan = {
    ...(old || {}), id: old?.id || newId(), tripId: trip.id, dayId: day.id,
    name: input.name.trim(), category: input.category.trim(), startAt,
    address: input.address.trim(), memo: input.memo, location: input.location,
    order: old && old.dayId === day.id ? old.order : Math.max(-1, ...data.plans.filter(item => item.dayId === day.id).map(item => item.order)) + 1,
    deletedAt: null, createdAt: old?.createdAt || now, updatedAt: now
  };
  const result = { ...data, days, plans: old ? data.plans.map(item => item.id === old.id ? plan : item) : [...data.plans, plan] };
  validateData(result);
  return result;
}

export function applyPlanDelete(data, planId, expectedPlan) {
  const plan = currentPlan(data, planId, expectedPlan);
  const result = markPlanDeleted(data, planId, modifiedAt(plan));
  validateData(result);
  return result;
}
