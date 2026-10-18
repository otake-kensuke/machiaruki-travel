import { el, actionButton } from './ui.js';
import { timeLabel } from './model.js';
import { mapsUrl } from './maps.js';

export function visitActions(visit, editVisit) {
  const url = mapsUrl(visit);
  const link = url && el('a', { className: 'button secondary small-button', href: url, target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer' }, visit.location ? 'Googleマップで地点を開く' : 'Googleマップで施設を検索');
  const edit = actionButton('訪問記録を編集', () => editVisit(visit), 'button secondary small-button');
  edit.setAttribute('aria-label', `${visit.name}の訪問記録を編集`);
  return el('div', { className: 'visit-actions' }, link, edit, url && el('small', { className: 'maps-network-note' }, 'Googleマップはオンライン接続が必要です。'));
}

export function visitCoordinates(visit, timeZone) {
  return el('div', { className: 'coordinates' }, el('span', { 'aria-hidden': 'true' }, '⌖'),
    visit.location ? `${visit.location.latitude.toFixed(5)}, ${visit.location.longitude.toFixed(5)}` : '位置情報は未設定',
    el('small', {}, visit.locationSource === 'gps' ? `GPS / 精度 約${Math.round(visit.location.accuracy)}m` : visit.locationSource === 'manual' ? '手入力の地点' : '施設名・時刻のみ'),
    visit.locationSource === 'gps' && el('small', {}, `GPS取得 ${new Intl.DateTimeFormat('ja-JP', { timeZone, dateStyle: 'short', timeStyle: 'medium' }).format(new Date(visit.location.capturedAt))}`));
}

export function inlineVisit(visit, trip, editVisit) {
  return el('div', { className: 'visit-inline', 'data-visit-id': visit.id },
    el('div', {}, el('strong', {}, `訪問 ${timeLabel(visit.visitedAt, trip.timeZone)}`), el('span', { className: 'muted' }, visit.name)),
    el('p', {}, visit.memo), visitCoordinates(visit, trip.timeZone), visitActions(visit, editVisit));
}
