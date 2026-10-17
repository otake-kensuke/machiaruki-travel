import { el, badge, dateStrip, tripHeader, emptyCard } from '../ui.js';
import { dateLabel, timeLabel, timelineItems } from '../model.js';

const symbols = { '移動': '↗', '食事': '◒', '散策': '◇', '観光': '⌂' };

export function timelineScreen({ trip, data, date }) {
  if (!trip) return emptyCard('旅の予定は、これから。', '旅行ホームからサンプル旅程を読み込むと、予定と記録を確認できます。');
  const days = [...data.days].sort((a, b) => a.date.localeCompare(b.date));
  const day = days.find(item => item.date === date);
  const rows = timelineItems(data, date, trip.timeZone);
  return el('div', {}, tripHeader(trip, '今日の予定・訪問記録', '予定と、実際に訪れた時間をひとつの流れに。'), dateStrip(days, date, 'timeline', trip.id), el('div', { className: 'day-heading' }, el('div', {}, el('span', { className: 'eyebrow' }, 'DAILY JOURNAL'), el('h2', {}, dateLabel(date)), el('p', {}, day?.title || 'この日の記録')), badge(`${rows.filter(row => row.plan).length}件の予定`)), el('aside', { className: 'info-note compact' }, '画面・保存基盤の確認版です。予定の追加・編集はStep 3、GPSと訪問の新規記録はStep 4で追加します。'), rows.length ? el('div', { className: 'timeline' }, rows.map(({ plan, visits }) => el('article', { className: `timeline-row ${visits.length ? 'is-visited' : ''}` }, el('div', { className: 'timeline-time' }, el('strong', {}, timeLabel(plan?.startAt || visits[0]?.visitedAt, trip.timeZone)), el('span', { className: 'timeline-dot', 'aria-hidden': 'true' })), el('div', { className: 'timeline-card' }, el('div', { className: 'card-topline' }, badge(plan?.category || '予定外の訪問'), visits.length ? badge('訪問記録あり', 'visited') : badge('予定', 'neutral')), el('h3', {}, el('span', { className: 'place-symbol', 'aria-hidden': 'true' }, symbols[plan?.category] || '◇'), plan?.name || visits[0]?.name), plan?.address && el('p', { className: 'muted' }, plan.address), plan?.memo && el('p', {}, plan.memo), visits.map(visit => el('div', { className: 'visit-inline' }, el('div', {}, el('strong', {}, `訪問 ${timeLabel(visit.visitedAt, trip.timeZone)}`), el('span', { className: 'muted' }, `${visit.name} / ${visit.locationSource === 'gps' ? 'GPS取得' : visit.locationSource === 'manual' ? '地点手入力' : '位置未設定'}`)), el('p', {}, visit.memo))))))) : emptyCard('この日の予定・記録はありません。', '上の日付を切り替えて、ほかの日の予定を確認できます。'));
}
