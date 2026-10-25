import { el, badge, dateStrip, tripHeader, emptyCard, actionButton } from '../ui.js';
import { dateLabel, timeLabel, timelineItems, journalDays } from '../model.js';
import { inlineVisit } from '../visit-ui.js';

const symbols = { '移動': '↗', '食事': '◒', '散策': '◇', '観光': '⌂' };

export function timelineScreen({ trip, data, date, addPlan, editPlan, removePlan, addVisit, editVisit }) {
  if (!trip) return emptyCard('旅の予定は、これから。', '旅行ホームから旅程JSONやサンプル旅程を読み込むと、予定と記録を確認できます。');
  const days = journalDays(data, trip.timeZone);
  const day = days.find(item => item.date === date);
  const rows = timelineItems(data, date, trip.timeZone);
  const cards = rows.map(({ plan, visits }) => {
    const referenced = visits[0]?.planId && data.plans.find(row => row.id === visits[0].planId);
    const category = plan?.category || (referenced ? referenced.deletedAt ? '削除済みの予定から' : '予定と別日の訪問' : '予定外の訪問');
    const details = el('div', { className: 'timeline-card' },
      el('div', { className: 'card-topline' }, badge(category), visits.length ? badge('訪問記録あり', 'visited') : badge('予定', 'neutral')),
      el('h3', {}, el('span', { className: 'place-symbol', 'aria-hidden': 'true' }, symbols[plan?.category] || '◇'), plan?.name || visits[0]?.name),
      plan?.address && el('p', { className: 'muted' }, plan.address),
      // Free-form notes are not a reliable booking-status field. Keep them intact.
      plan?.memo?.trim() && el('details', { className: 'plan-memo' }, el('summary', {}, '詳細メモ'), el('p', {}, plan.memo)),
      visits.map(visit => inlineVisit(visit, trip, editVisit))
    );
    if (plan) {
      const edit = actionButton('編集', () => editPlan(plan), 'button secondary small-button');
      const remove = actionButton('削除', () => removePlan(plan), 'button secondary small-button delete-button');
      edit.setAttribute('aria-label', `${plan.name}を編集`);
      remove.setAttribute('aria-label', `${plan.name}を削除`);
      const record = actionButton('訪問を記録', () => addVisit(plan), 'button small-button');
      record.setAttribute('aria-label', `${plan.name}の訪問を記録`);
      details.append(el('div', { className: 'timeline-actions' }, record, edit, remove));
    }
    return el('article', { className: `timeline-row ${visits.length ? 'is-visited' : ''}`, 'data-plan-id': plan?.id },
      el('div', { className: 'timeline-time' }, el('small', {}, plan ? '予定' : '訪問'), el('strong', {}, timeLabel(plan ? plan.startAt : visits[0]?.visitedAt, trip.timeZone)), el('span', { className: 'timeline-dot', 'aria-hidden': 'true' })), details);
  });
  return el('div', {},
    tripHeader(trip, '今日の予定・訪問記録', '予定と、実際に訪れた時間をひとつの流れに。'),
    dateStrip(days, date, 'timeline', trip.id),
    el('div', { className: 'day-heading' }, el('div', {},
      el('span', { className: 'eyebrow' }, 'DAILY JOURNAL'), el('h2', {}, dateLabel(date)), el('p', {}, day?.title || 'この日の記録')), badge(`${rows.filter(row => row.plan).length}件の予定`)),
    el('div', { className: 'plan-toolbar' }, actionButton('＋ 訪問記録を追加', () => addVisit(null)), actionButton('＋ 予定を追加', addPlan, 'button secondary')),
    el('aside', { className: 'info-note compact' }, '訪問を記録するときだけ現在地を取得します。取得できなくても、施設名と日時を確認して保存できます。'),
    rows.length ? el('div', { className: 'timeline' }, cards) : emptyCard('この日の予定・記録はありません。', '「予定を追加」から、この日の予定を作成できます。')
  );
}
