import { el, badge, dateStrip, tripHeader, emptyCard, actionButton } from '../ui.js';
import { dateLabel, timeLabel, timelineItems } from '../model.js';

const symbols = { '移動': '↗', '食事': '◒', '散策': '◇', '観光': '⌂' };

export function timelineScreen({ trip, data, date, addPlan, editPlan, removePlan }) {
  if (!trip) return emptyCard('旅の予定は、これから。', '旅行ホームから旅程JSONやサンプル旅程を読み込むと、予定と記録を確認できます。');
  const days = [...data.days].sort((a, b) => a.date.localeCompare(b.date));
  const day = days.find(item => item.date === date);
  const rows = timelineItems(data, date, trip.timeZone);
  const cards = rows.map(({ plan, visits }) => {
    const details = el('div', { className: 'timeline-card' },
      el('div', { className: 'card-topline' }, badge(plan?.category || '予定外の訪問'), visits.length ? badge('訪問記録あり', 'visited') : badge('予定', 'neutral')),
      el('h3', {}, el('span', { className: 'place-symbol', 'aria-hidden': 'true' }, symbols[plan?.category] || '◇'), plan?.name || visits[0]?.name),
      plan?.address && el('p', { className: 'muted' }, plan.address), plan?.memo && el('p', {}, plan.memo),
      visits.map(visit => el('div', { className: 'visit-inline' },
        el('div', {}, el('strong', {}, `訪問 ${timeLabel(visit.visitedAt, trip.timeZone)}`),
          el('span', { className: 'muted' }, `${visit.name} / ${visit.locationSource === 'gps' ? 'GPS取得' : visit.locationSource === 'manual' ? '地点手入力' : '位置未設定'}`)),
        el('p', {}, visit.memo)))
    );
    if (plan) {
      const edit = actionButton('編集', () => editPlan(plan), 'button secondary small-button');
      const remove = actionButton('削除', () => removePlan(plan), 'button secondary small-button delete-button');
      edit.setAttribute('aria-label', `${plan.name}を編集`);
      remove.setAttribute('aria-label', `${plan.name}を削除`);
      details.append(el('div', { className: 'timeline-actions' }, edit, remove));
    }
    return el('article', { className: `timeline-row ${visits.length ? 'is-visited' : ''}`, 'data-plan-id': plan?.id },
      el('div', { className: 'timeline-time' }, el('strong', {}, timeLabel(plan?.startAt || visits[0]?.visitedAt, trip.timeZone)), el('span', { className: 'timeline-dot', 'aria-hidden': 'true' })), details);
  });
  return el('div', {},
    tripHeader(trip, '今日の予定・訪問記録', '予定と、実際に訪れた時間をひとつの流れに。'),
    dateStrip(days, date, 'timeline', trip.id),
    el('div', { className: 'day-heading' }, el('div', {},
      el('span', { className: 'eyebrow' }, 'DAILY JOURNAL'), el('h2', {}, dateLabel(date)), el('p', {}, day?.title || 'この日の記録')), badge(`${rows.filter(row => row.plan).length}件の予定`)),
    el('div', { className: 'plan-toolbar' }, actionButton('＋ 予定を追加', addPlan)),
    el('aside', { className: 'info-note compact' }, '予定を編集・削除しても、すでに保存した訪問記録は残ります。GPSと訪問の新規記録はStep 4で追加します。'),
    rows.length ? el('div', { className: 'timeline' }, cards) : emptyCard('この日の予定・記録はありません。', '「予定を追加」から、この日の予定を作成できます。')
  );
}
