export const APP_ID = 'machiaruki-travel';
export const SCHEMA_VERSION = '1.0';
export const COLLECTIONS = ['trips', 'days', 'plans', 'transportations', 'accommodations', 'visits'];

export function emptyData() {
  return Object.fromEntries(COLLECTIONS.map(key => [key, []]));
}

export function newId() {
  return crypto.randomUUID();
}

// A tombstone keeps visits linked to the original plan, without altering history.
export function markPlanDeleted(data, planId, now = new Date().toISOString()) {
  if (!data.plans.some(plan => plan.id === planId)) throw new Error('予定が見つかりません。');
  return { ...data, plans: data.plans.map(plan => plan.id === planId ? { ...plan, deletedAt: now, updatedAt: now } : plan) };
}

export function tripData(data, tripId) {
  return Object.fromEntries(COLLECTIONS.map(key => [key, data[key].filter(row => key === 'trips' ? row.id === tripId : row.tripId === tripId)]));
}

export function localDate(value, timeZone = 'Asia/Tokyo') {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const part = type => parts.find(row => row.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function timeLabel(value, timeZone = 'Asia/Tokyo') {
  if (!value) return '時刻未定';
  return new Intl.DateTimeFormat('ja-JP', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

export function dateLabel(value, options = {}) {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric', weekday: 'short', ...options }).format(new Date(`${value}T12:00:00+09:00`));
}

export function timelineItems(data, date, timeZone) {
  const visits = data.visits.filter(visit => localDate(visit.visitedAt, timeZone) === date).sort((a, b) => Date.parse(a.visitedAt) - Date.parse(b.visitedAt));
  const plans = data.plans.filter(plan => !plan.deletedAt && data.days.some(day => day.id === plan.dayId && day.date === date));
  const rows = plans.map(plan => ({ plan, visits: visits.filter(visit => visit.planId === plan.id), sort: plan.startAt ? Date.parse(plan.startAt) : Infinity }));
  for (const visit of visits) {
    if (!plans.some(plan => plan.id === visit.planId)) rows.push({ plan: null, visits: [visit], sort: Date.parse(visit.visitedAt) });
  }
  return rows.sort((a, b) => a.sort - b.sort || (a.plan?.order ?? 0) - (b.plan?.order ?? 0));
}

export function journalDays(data, timeZone) {
  const days = new Map(data.days.map(day => [day.date, day]));
  for (const visit of data.visits) {
    const date = localDate(visit.visitedAt, timeZone);
    if (!days.has(date)) days.set(date, { date, title: 'この日の訪問記録' });
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}
