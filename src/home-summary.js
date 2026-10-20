import { localDate } from './model.js';

const dateNumber = value => Date.parse(`${value}T00:00:00Z`) / 86400000;
export const tripDuration = trip => dateNumber(trip.endDate) - dateNumber(trip.startDate) + 1;
export const tripDayNumber = (trip, date) => dateNumber(date) - dateNumber(trip.startDate) + 1;

// Derive a view from registered days only. Never manufacture or persist a missing day.
export function homeSummary(trip, data, requestedDate, now = new Date()) {
  const days = [...data.days].sort((a, b) => a.date.localeCompare(b.date));
  const today = localDate(now, trip.timeZone);
  const selected = days.find(day => day.date === requestedDate);
  let day = selected;
  let title = selected ? selected.date === today ? '今日の予定' : '選択日の予定' : '今日の予定';
  let note = '';
  if (!selected) {
    if (today < trip.startDate) { day = days[0]; title = '最初の日の予定'; note = '旅行はこれから。登録済みの最初の日をご案内します。'; }
    else if (today > trip.endDate) { day = days.at(-1); title = '旅の予定を振り返る'; note = '旅行期間を過ぎています。日付を選んで予定と記録を振り返れます。'; }
    else { day = days.find(item => item.date === today); note = day ? '' : '今日は登録済みの日程がありません。全体の日程から別の日も確認できます。'; }
  }
  if (!days.length) note = '日別の予定はまだ登録されていません。「予定・記録」から追加できます。';
  const plans = data.plans.filter(plan => !plan.deletedAt && day && plan.dayId === day.id)
    .sort((a, b) => (a.startAt ? Date.parse(a.startAt) : Infinity) - (b.startAt ? Date.parse(b.startAt) : Infinity) || a.order - b.order);
  return { days, day: day || null, today, title, note, plans };
}
