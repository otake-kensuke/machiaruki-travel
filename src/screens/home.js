import { el, badge, linkButton, route, sectionHeading, actionButton } from '../ui.js';
import { dateLabel, timeLabel, localDate } from '../model.js';
import { homeSummary, tripDuration, tripDayNumber } from '../home-summary.js';
import { SCENERY, sceneryForTrip } from '../brand.js';
import { icon } from '../icons.js';

function illustration(trip) {
  const theme = sceneryForTrip(trip);
  return el('figure', { className: `trip-illustration ${theme}`, 'data-scenery': theme },
    el('div', { className: 'illustration-scene', 'aria-hidden': 'true' },
      el('img', { className: 'scenery-image', src: SCENERY[theme].image, width: 1536, height: 1024, alt: '', decoding: 'async' }),
      el('span', { className: 'traveler man' }), el('span', { className: 'traveler woman' }), el('span', { className: 'traveler young' })));
}

function management(context) {
  const { trip, sampleAvailable, openImport, openSample, backupPanel, savedAt } = context;
  return el('section', { className: 'data-management', 'aria-label': 'データ管理' },
    sectionHeading('KEEP YOUR MEMORIES', 'データ管理'),
    trip && el('div', { className: 'import-toolbar' }, el('div', {}, el('strong', {}, 'ほかの旅を、このノートに。'), el('p', {}, '旅程JSONを確認して追加できます。')), actionButton('旅程JSONを取り込む', openImport, 'button secondary')),
    backupPanel,
    trip && sampleAvailable && actionButton('サンプル旅程を追加', openSample, 'button secondary'),
    trip && el('p', { className: 'saved-note' }, icon('file'), el('span', {}, 'この端末に保存済み', savedAt && ` · ${new Intl.DateTimeFormat('ja-JP', { timeZone: trip.timeZone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(savedAt))}`)),
    el('p', { className: 'muted' }, 'ブラウザのデータを削除すると記録が消えることがあります。JSONを保存し、保存先で開けることを確認してください。'));
}

function travelDetails(data, trip) {
  const dateTime = value => `${dateLabel(localDate(value, trip.timeZone))} ${timeLabel(value, trip.timeZone)}`;
  const transports = el('details', { className: 'travel-details', id: 'transport-details' },
    el('summary', {}, icon('plane'), el('span', { className: 'detail-label' }, '交通'), el('span', { className: 'detail-count' }, `${data.transportations.length}件の登録`), el('span', { className: 'chevron', 'aria-hidden': 'true' }, '⌄')),
    el('div', { className: 'detail-list' }, el('p', { className: 'muted' }, '登録情報です。予約の有無は各メモを確認してください。'),
      data.transportations.length ? data.transportations.map(item => el('article', { className: 'detail-card' }, badge(item.mode), el('h3', {}, item.name),
        el('p', { className: 'transport-points' }, item.from, el('span', { 'aria-hidden': 'true' }, ' → '), item.to),
        el('p', { className: 'muted' }, `出発 ${dateTime(item.departureAt)} / 到着 ${dateTime(item.arrivalAt)}`), item.memo && el('p', {}, item.memo))) : el('p', {}, '交通の登録はありません。')));
  const stays = el('details', { className: 'travel-details', id: 'stay-details' },
    el('summary', {}, icon('bed'), el('span', { className: 'detail-label' }, '宿泊'), el('span', { className: 'detail-count' }, `${data.accommodations.length}件の登録`), el('span', { className: 'chevron', 'aria-hidden': 'true' }, '⌄')),
    el('div', { className: 'detail-list' }, el('p', { className: 'muted' }, '登録情報です。予約の有無は各メモを確認してください。'),
      data.accommodations.length ? data.accommodations.map(item => el('article', { className: 'detail-card' }, el('h3', {}, item.name), el('p', {}, item.address),
        el('p', { className: 'muted' }, `チェックイン ${dateTime(item.checkInAt)}`), el('p', { className: 'muted' }, `チェックアウト ${dateTime(item.checkOutAt)}`), item.memo && el('p', {}, item.memo))) : el('p', {}, '宿泊の登録はありません。')));
  return el('section', { className: 'travel-resources', 'aria-label': '交通・宿泊情報' }, transports, stays);
}

export function homeScreen(context) {
  const { trip, data, openSample, openImport, requestedDate, now } = context;
  if (!trip) return el('div', { className: 'dashboard empty-dashboard' }, illustration(null),
    el('section', { className: 'welcome-card' }, badge('次の旅を、ゆっくり考えよう。'), el('h1', {}, '予定を持って、', el('br'), '記憶を連れて帰る。'),
      el('p', {}, '決まった予定も、ふとした寄り道も。あなただけの旅のノートをはじめましょう。'),
      el('div', { className: 'home-actions' }, actionButton('旅程JSONを取り込む', openImport), actionButton('サンプル旅程を読み込む', openSample, 'button secondary')),
      el('p', { className: 'muted' }, 'サンプルは架空の旅程です。ボタンを押したときだけ追加します。')),
    management(context));
  const summary = homeSummary(trip, data, requestedDate, now);
  const plans = data.plans.filter(plan => !plan.deletedAt);
  const date = summary.day?.date;
  const dateSelect = el('select', { id: 'home-date', 'aria-label': 'ホームで予定を見る日' },
    !date && el('option', { value: '' }, '登録済みの日付を選ぶ'),
    summary.days.map(day => el('option', { value: day.date }, dateLabel(day.date))));
  dateSelect.value = date || '';
  dateSelect.addEventListener('change', () => { if (dateSelect.value) location.hash = route('home', trip.id, dateSelect.value); });
  const agenda = el('section', { className: 'dashboard-card agenda', 'aria-label': '日別予定の概要' },
    el('div', { className: 'dashboard-heading' }, el('h2', {}, icon('leaf'), summary.title), date && el('span', { className: 'day-number' }, `DAY ${String(tripDayNumber(trip, date)).padStart(2, '0')}`)),
    summary.days.length > 0 && el('div', { className: 'home-date-picker' }, el('label', { for: 'home-date' }, '見る日を選ぶ'), dateSelect),
    summary.note && el('p', { className: 'muted agenda-note' }, summary.note),
    summary.plans.length ? el('ul', { className: 'agenda-list' }, summary.plans.slice(0, 4).map(plan => el('li', {},
      el('a', { href: route('timeline', trip.id, date), className: 'agenda-row' }, el('span', { className: `category-icon category-${plan.category === '移動' ? 'move' : plan.category === '食事' ? 'food' : 'place'}` }, icon(plan.category === '移動' ? 'plane' : 'pin')),
        el('time', {}, timeLabel(plan.startAt, trip.timeZone)), el('strong', {}, plan.name))))) : el('p', { className: 'agenda-empty' }, date ? 'この日の予定はまだありません。予定・記録から追加できます。' : '表示する予定はありません。'),
    summary.plans.length > 4 && el('p', { className: 'muted' }, `ほか${summary.plans.length - 4}件の予定があります。`),
    linkButton('予定と記録をひらく  →', route('timeline', trip.id, date)),
    el('p', { className: 'muted agenda-hint' }, '予定の追加や、予定外の訪問記録もこちらから。'));
  const itinerary = el('section', { className: 'dashboard-card itinerary-section' },
    el('div', { className: 'dashboard-heading' }, el('h2', {}, icon('calendar'), '旅行全体の日程'), badge(`${summary.days.length}日分の登録`)),
    summary.days.length ? el('div', { className: 'itinerary-list' }, summary.days.map(day => el('a', { className: 'itinerary-day', href: route('timeline', trip.id, day.date) },
      el('span', { className: 'itinerary-marker', 'aria-hidden': 'true' }), el('div', {}, el('span', { className: 'day-label' }, `DAY ${String(tripDayNumber(trip, day.date)).padStart(2, '0')} · ${dateLabel(day.date)}`),
        el('strong', {}, day.title || 'この日の予定'), el('small', {}, `${plans.filter(plan => plan.dayId === day.id).length}件の予定`)), icon('arrow')))) : el('p', { className: 'muted' }, '日別の予定はまだ登録されていません。'));
  return el('div', { className: 'dashboard' }, illustration(trip),
    el('section', { className: 'trip-intro' }, el('div', { 'data-trip-picker': '' }), trip.isSample && badge('サンプル・仮旅程', 'sample'),
      el('h1', {}, trip.name), el('p', { className: 'trip-period' }, icon('calendar'), `${dateLabel(trip.startDate, { year: 'numeric' })} — ${dateLabel(trip.endDate)}`),
      el('p', { className: 'trip-memo trip-summary' }, `${tripDuration(trip)}日間・予定${plans.length}件`, el('br'), `交通${data.transportations.length}件・宿泊${data.accommodations.length}件`)),
    el('div', { className: 'dashboard-stats' }, [['calendar', '日程', tripDuration(trip), '日間'], ['list', '予定', plans.length, '件'], ['camera', '訪問記録', data.visits.length, '件']].map(([symbol, label, count, unit]) => el('div', {}, icon(symbol), el('span', {}, label), el('strong', {}, count, el('small', {}, unit))))),
    agenda, itinerary, travelDetails(data, trip),
    trip.isSample && el('p', { className: 'sample-note' }, 'サンプルの交通・宿泊・訪問は仮の情報です。実際の旅行計画ではありません。'),
    management(context));
}
