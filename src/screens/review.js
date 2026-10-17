import { el, badge, tripHeader, emptyCard, sectionHeading } from '../ui.js';
import { localDate, dateLabel, timeLabel } from '../model.js';

export function reviewScreen({ trip, data }) {
  if (!trip) return emptyCard('旅の記憶を、ここに。', '旅行ホームからサンプル旅程を読み込むと、仮の訪問履歴を確認できます。');
  const visits = [...data.visits].sort((a, b) => new Date(a.visitedAt) - new Date(b.visitedAt));
  const dates = [...new Set(visits.map(visit => localDate(visit.visitedAt, trip.timeZone)))].sort();
  const overview = el('div', { className: 'review-overview' }, el('div', {}, el('span', { className: 'eyebrow' }, 'MOMENTS COLLECTED'), el('strong', {}, String(visits.length).padStart(2, '0'), el('small', {}, ' 訪問の記録'))), el('p', {}, trip.isSample ? 'サンプルの記録をたどって、旅のノートの使い心地を確かめてみましょう。' : '訪れた場所と、そのときのメモをたどりましょう。'));
  return el('div', {}, tripHeader(trip, '旅の振り返り', '歩いた場所と、そのときの気持ちを。'), overview, trip.isSample && el('aside', { className: 'sample-note' }, 'ここに表示する訪問は、画面確認用の架空の記録です。'), dates.length ? dates.map(date => el('section', { className: 'section-block' }, sectionHeading('TRAVEL MEMORIES', dateLabel(date), badge(`${visits.filter(visit => localDate(visit.visitedAt, trip.timeZone) === date).length}件`)), el('div', { className: 'memory-grid' }, visits.filter(visit => localDate(visit.visitedAt, trip.timeZone) === date).map(visit => {
    const plan = data.plans.find(item => item.id === visit.planId);
    return el('article', { className: 'memory-card' }, el('div', { className: 'card-topline' }, badge(visit.planId ? plan?.deletedAt ? '削除済みの予定から' : '予定からの訪問' : '予定外の訪問', 'visited'), el('strong', {}, timeLabel(visit.visitedAt, trip.timeZone))), el('h3', {}, visit.name), el('p', { className: 'memory-memo' }, visit.memo || 'メモはありません。'), el('div', { className: 'coordinates' }, el('span', { 'aria-hidden': 'true' }, '⌖'), visit.location ? `${visit.location.latitude.toFixed(5)}, ${visit.location.longitude.toFixed(5)}` : '位置情報は未設定', el('small', {}, visit.locationSource === 'gps' ? `GPS / 精度 約${Math.round(visit.location.accuracy)}m` : visit.locationSource === 'manual' ? '手入力の地点' : '施設名・時刻のみ')));
  })))) : emptyCard('まだ訪問記録がありません。', '訪問の新規記録はStep 4で追加予定です。'), el('aside', { className: 'info-note' }, el('strong', {}, '次の開発段階でできること'), el('p', {}, '施設名・メモの編集、訪問記録の作成、Googleマップでの地点確認をStep 4で追加します。現在は端末に保存した記録を閲覧できます。')));
}
