import { el, actionButton } from './ui.js';
import { counts } from './backups.js';

export function backupSummary(data, heading) {
  const totals = counts(data);
  return el('section', { className: 'backup-summary' }, el('h3', {}, heading),
    el('p', { className: 'backup-counts' }, `旅行 ${totals.trips}件 / 日別 ${totals.days}件 / 予定 ${totals.plans}件 / 交通 ${totals.transportations}件 / 宿泊 ${totals.accommodations}件 / 訪問記録 ${totals.visits}件`),
    data.trips.length ? el('ul', {}, data.trips.map(trip => el('li', {}, el('strong', {}, trip.name), el('span', {}, ` ${trip.startDate} 〜 ${trip.endDate}`)))) : el('p', {}, '旅行・訪問記録を含まない空データです。'));
}

export function backupPanel({ status, revision, openBackup, openRestore, historyError }) {
  const time = status ? new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(status.requestedAt)) : null;
  return el('section', { className: 'backup-panel', 'aria-label': 'バックアップと復元' },
    el('span', { className: 'eyebrow' }, 'KEEP YOUR TRAVEL MEMORIES'), el('h2', {}, 'データのバックアップ'),
    el('p', {}, 'この端末の全旅行・訪問記録をJSONに出力します。保存先でファイルを確認してください。'),
    el('div', { className: 'backup-actions' }, actionButton('バックアップを保存', openBackup), actionButton('バックアップから復元', openRestore, 'button secondary')),
    el('p', { className: 'backup-history' }, status ? `最終バックアップ出力操作：${time}（日本時間）` : 'バックアップ出力操作の記録はありません。'),
    status && el('p', { className: 'muted' }, `${status.method === 'download-requested' ? 'ダウンロード要求' : '共有画面への受渡し'} / 保存完了・端末外への保存は未確認です。`),
    status && status.sourceRevision !== revision && el('p', { className: 'backup-warning' }, '出力後にデータの保存・復元が行われています。現在のデータをもう一度出力してください。'),
    historyError && el('p', { className: 'error-text' }, '出力履歴を読み込めませんでした。旅行データは初期化していません。'));
}
