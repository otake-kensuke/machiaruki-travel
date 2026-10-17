import { el, badge, tripHeader, emptyCard, sectionHeading } from '../ui.js';
import { localDate, dateLabel, timeLabel } from '../model.js';
import { visitCoordinates, visitActions } from '../visit-ui.js';

export function reviewScreen({ trip, data, editVisit }) {
  if (!trip) return emptyCard('旅の記憶を、ここに。', '旅行ホームから旅程を読み込むと、訪問の記録を始められます。');
  const visits = [...data.visits].sort((a, b) => Date.parse(a.visitedAt) - Date.parse(b.visitedAt));
  const dates = [...new Set(visits.map(visit => localDate(visit.visitedAt, trip.timeZone)))].sort();
  const overview = el('div', { className: 'review-overview' },
    el('div', {}, el('span', { className: 'eyebrow' }, 'MOMENTS COLLECTED'), el('strong', {}, String(visits.length).padStart(2, '0'), el('small', {}, ' 訪問の記録'))),
    el('p', {}, '訪れた場所と、そのときのメモをたどりましょう。'));
  const sections = dates.map(date => el('section', { className: 'section-block' },
    sectionHeading('TRAVEL MEMORIES', dateLabel(date, { year: 'numeric' }), badge(`${visits.filter(visit => localDate(visit.visitedAt, trip.timeZone) === date).length}件`)),
    el('div', { className: 'memory-grid' }, visits.filter(visit => localDate(visit.visitedAt, trip.timeZone) === date).map(visit => {
      const plan = data.plans.find(item => item.id === visit.planId);
      const label = visit.planId ? plan?.deletedAt ? '削除済みの予定から' : '予定からの訪問' : '予定外の訪問';
      return el('article', { className: 'memory-card', 'data-visit-id': visit.id },
        el('div', { className: 'card-topline' }, badge(label, 'visited'), el('strong', {}, `訪問 ${timeLabel(visit.visitedAt, trip.timeZone)}`)),
        el('h3', {}, visit.name), visit.address && el('p', { className: 'muted' }, visit.address),
        el('p', { className: 'memory-memo' }, visit.memo || 'メモはありません。'),
        visitCoordinates(visit, trip.timeZone), visitActions(visit, editVisit));
    }))));
  return el('div', {}, tripHeader(trip, '旅の振り返り', '歩いた場所と、そのときの気持ちを。'), overview,
    trip.isSample && el('aside', { className: 'sample-note' }, '同梱の訪問は表示確認用の仮記録です。ご自身で追加した記録もこの旅行に表示します。'),
    dates.length ? sections : emptyCard('まだ訪問記録がありません。', '「予定・記録」画面から、予定に沿った訪問や予定外の訪問を記録できます。'),
    el('aside', { className: 'info-note' }, el('strong', {}, '地点の確認'), el('p', {}, 'Googleマップはボタンを押したときに開きます。座標がある記録はその地点、ない記録は施設名・住所による検索です。施設が正しいか確認してください。')));
}
