import { el, badge, linkButton, route, sectionHeading, actionButton } from '../ui.js';
import { dateLabel, timeLabel } from '../model.js';

function landscape() {
  return el('div', { className: 'landscape', 'aria-hidden': 'true' }, el('span', { className: 'landscape-sun' }), el('span', { className: 'mountain back' }), el('span', { className: 'mountain front' }), el('span', { className: 'landscape-path' }), el('span', { className: 'landscape-caption' }, 'HOKKAIDO / 43°N'));
}

export function homeScreen({ trip, data, sampleAvailable, openSample, openImport, savedAt }) {
  if (!trip) {
    const start = el('button', { className: 'button secondary', type: 'button' }, 'サンプル旅程を読み込む', el('span', { 'aria-hidden': 'true' }, ' ↗'));
    start.addEventListener('click', openSample);
    return el('div', {}, el('section', { className: 'hero welcome' }, el('div', { className: 'hero-copy' }, el('span', { className: 'eyebrow' }, 'A LITTLE JOURNEY, A LASTING MEMORY'), el('h1', {}, '予定を持って、', el('br'), '記憶を連れて帰る。'), el('p', {}, '行きたい場所も、ふと立ち寄った場所も。', el('br'), 'あなたの旅を、この端末のノートに。'), el('div', { className: 'home-actions' }, actionButton('旅程JSONを取り込む', openImport), start)), landscape()), el('div', { className: 'onboarding-grid' }, [['01', '旅の見通しをつくる', '日程・交通・宿泊をひとつの場所で。'], ['02', '予定と実績を並べる', 'その日の流れと、訪れた記憶を確認。'], ['03', '歩いた旅を振り返る', '訪問した場所とメモを日付ごとに。']].map(([number, title, text]) => el('article', { className: 'feature-card' }, el('span', { className: 'feature-number' }, number), el('h2', {}, title), el('p', {}, text)))), el('aside', { className: 'info-note' }, el('strong', {}, 'はじめに'), el('p', {}, '旅程を取り込んだら「予定・記録」から訪問を記録できます。現在地は記録時のみ取得し、位置情報がなくても保存できます。サンプルはボタンを押したときだけ追加します。')));
  }
  const days = [...data.days].sort((a, b) => a.date.localeCompare(b.date));
  const plans = data.plans.filter(plan => !plan.deletedAt);
  const visitedPlanIds = new Set(data.visits.map(visit => visit.planId).filter(Boolean));
  const heading = el('div', { className: 'hero-copy' }, el('span', { className: 'eyebrow' }, 'YOUR NEXT LITTLE ADVENTURE'), trip.isSample && badge('サンプル・仮旅程', 'sample'), el('h1', {}, trip.name), el('p', { className: 'hero-date' }, `${dateLabel(trip.startDate)} — ${dateLabel(trip.endDate)}`), el('p', {}, trip.memo), linkButton('予定と記録をひらく  →', route('timeline', trip.id, days[0]?.date)));
  const stats = el('div', { className: 'stats' }, [['日程', `${days.length}`, '日間'], ['予定', `${plans.length}`, '件'], ['訪問記録', `${data.visits.length}`, '件']].map(([title, count, unit]) => el('div', {}, el('span', {}, title), el('strong', {}, count, el('small', {}, unit)))));
  const itinerary = el('section', { className: 'section-block' }, sectionHeading('ITINERARY', '旅のスケッチ', badge(`${days.length} DAYS`)), el('div', { className: 'day-grid' }, days.map((day, index) => {
    const dayPlans = plans.filter(plan => plan.dayId === day.id).sort((a, b) => (a.startAt || '').localeCompare(b.startAt || ''));
    return el('a', { className: 'day-card', href: route('timeline', trip.id, day.date) }, el('span', { className: 'eyebrow' }, `DAY ${String(index + 1).padStart(2, '0')}`), el('h3', {}, dateLabel(day.date)), el('p', { className: 'day-title' }, day.title), el('div', { className: 'day-stops' }, dayPlans.map(plan => el('span', {}, el('small', {}, timeLabel(plan.startAt, trip.timeZone)), plan.name))), el('div', { className: 'card-bottom' }, `${dayPlans.length}件の予定・${dayPlans.filter(plan => visitedPlanIds.has(plan.id)).length}件訪問済み`, el('span', {}, '→')));
  })));
  const transport = el('section', { className: 'section-block' }, sectionHeading('GETTING THERE', '交通'), el('div', { className: 'detail-list' }, data.transportations.length ? data.transportations.map(item => el('article', { className: 'detail-card' }, badge(item.mode), el('h3', {}, item.name), el('div', { className: 'transport-route' }, el('div', {}, el('strong', {}, timeLabel(item.departureAt, trip.timeZone)), el('span', {}, item.from)), el('span', { 'aria-hidden': 'true' }, '→'), el('div', {}, el('strong', {}, timeLabel(item.arrivalAt, trip.timeZone)), el('span', {}, item.to))), el('p', { className: 'muted' }, `${dateLabel(item.departureAt.slice(0, 10))} / ${item.memo || ''}`))) : el('p', { className: 'muted' }, '交通の登録はありません。')));
  const accommodations = el('section', { className: 'section-block' }, sectionHeading('STAY', '宿泊'), el('div', { className: 'detail-list' }, data.accommodations.length ? data.accommodations.map(item => el('article', { className: 'detail-card' }, badge('宿泊'), el('h3', {}, item.name), el('p', {}, item.address), el('p', { className: 'muted' }, `${dateLabel(item.checkInAt.slice(0, 10))} ${timeLabel(item.checkInAt, trip.timeZone)} → ${dateLabel(item.checkOutAt.slice(0, 10))} ${timeLabel(item.checkOutAt, trip.timeZone)}`), el('p', { className: 'muted' }, item.memo))) : el('p', { className: 'muted' }, '宿泊の登録はありません。')));
  const storage = el('aside', { className: 'storage-panel' }, el('div', {}, el('span', { className: 'status-dot' }), el('strong', {}, 'この端末に保存済み'), el('p', { className: 'muted' }, savedAt ? `最終保存 ${new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'short', timeZone: trip.timeZone }).format(new Date(savedAt))}` : '保存データを読み込みました。')), el('p', {}, 'ブラウザのデータを削除すると、この記録も消えることがあります。JSONをバックアップし、保存先で開けることを確認してください。'));
  const result = el('div', {}, el('section', { className: 'hero' }, heading, landscape()), el('div', { className: 'import-toolbar' }, el('p', {}, 'ほかの旅行の旅程を追加できます。'), actionButton('旅程JSONを取り込む', openImport, 'button secondary')), stats, trip.isSample && el('aside', { className: 'sample-note' }, 'サンプル旅行です。同梱の交通・宿泊・訪問は仮の情報です。追加した記録はこの旅行に保存されます。'), itinerary, el('div', { className: 'two-columns' }, transport, accommodations), storage);
  if (sampleAvailable) {
    const button = el('button', { className: 'button secondary', type: 'button' }, 'サンプル旅程を追加');
    button.addEventListener('click', openSample); result.append(button);
  }
  return result;
}
