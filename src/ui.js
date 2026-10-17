import { dateLabel } from './model.js';

export function el(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'className') element.className = value;
    else element.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child !== undefined && child !== null && child !== false) element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

export const badge = (text, className = '') => el('span', { className: `badge ${className}` }, text);
export const route = (page, tripId, date) => `#/${page}?${new URLSearchParams({ trip: tripId, ...(date ? { date } : {}) })}`;
export const linkButton = (text, href, secondary = false) => el('a', { className: `button${secondary ? ' secondary' : ''}`, href }, text);

export function sectionHeading(eyebrow, title, trailing) {
  return el('div', { className: 'section-heading' }, el('div', {}, el('span', { className: 'eyebrow' }, eyebrow), el('h2', {}, title)), trailing);
}

export function emptyCard(title, message) {
  return el('div', { className: 'empty-card' }, el('span', { className: 'empty-symbol', 'aria-hidden': 'true' }, '◇'), el('h2', {}, title), el('p', {}, message));
}

export function dateStrip(days, selected, page, tripId) {
  return el('nav', { className: 'date-strip', 'aria-label': '旅行日を選択' }, days.map((day, index) => el('a', { className: day.date === selected ? 'selected' : '', href: route(page, tripId, day.date), 'aria-current': day.date === selected ? 'date' : null }, el('small', {}, `DAY ${String(index + 1).padStart(2, '0')}`), el('strong', {}, dateLabel(day.date, { month: 'numeric' })))));
}

export function tripHeader(trip, title, subtitle) {
  return el('div', { className: 'page-heading' }, el('div', {}, el('span', { className: 'eyebrow' }, 'YOUR TRAVEL NOTE'), el('h1', {}, title), el('p', {}, subtitle)), trip.isSample && badge('サンプル・仮旅程', 'sample'));
}

export function actionButton(text, action, className = 'button') {
  const button = el('button', { type: 'button', className }, text);
  button.addEventListener('click', action);
  return button;
}

// Dialog fields live outside the routed screen, so a refresh never erases a draft.
export function formDialog(title, eyebrow) {
  const heading = el('h2', { id: 'form-dialog-title' }, title);
  const error = el('p', { className: 'error-text', role: 'alert', tabindex: '-1' });
  const fields = el('fieldset', { className: 'dialog-fields' });
  const close = actionButton('×', () => dialog.close(), 'dialog-close');
  close.setAttribute('aria-label', '閉じる');
  const cancel = actionButton('キャンセル', () => dialog.close(), 'button secondary');
  const submit = el('button', { className: 'button', type: 'submit' }, '保存する');
  const form = el('form', {}, fields, error, el('div', { className: 'dialog-actions' }, cancel, submit));
  const dialog = el('dialog', { className: 'form-dialog', 'aria-labelledby': heading.id }, close, el('span', { className: 'eyebrow' }, eyebrow), heading, form);
  let busy = false;
  let label = submit.textContent;
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => dialog.remove());
  function setBusy(value) {
    if (value && !busy) label = submit.textContent;
    busy = value;
    fields.disabled = value;
    close.disabled = value;
    cancel.disabled = value;
    submit.disabled = value;
    submit.textContent = value ? '保存しています…' : label;
    dialog.setAttribute('aria-busy', String(value));
  }
  function showError(value) { error.textContent = value.message || String(value); error.focus(); }
  function open() { document.body.append(dialog); dialog.showModal(); }
  return { dialog, form, fields, error, submit, setBusy, showError, open };
}
