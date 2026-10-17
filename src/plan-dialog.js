import { el, formDialog } from './ui.js';
import { planTimeInput } from './plans.js';
import { savePlan, deletePlan } from './storage.js';

function field(label, input) {
  return el('div', { className: 'form-field' }, el('label', { className: 'field-label', for: input.id }, label), input);
}

export function openPlanEditor({ trip, data, date, plan, onSaved }) {
  const expectedPlan = plan ? structuredClone(plan) : null;
  const view = formDialog(plan ? '予定を編集' : '予定を追加', 'PLAN YOUR DAY');
  const originalDate = plan ? data.days.find(day => day.id === plan.dayId).date : date;
  const dateValue = originalDate >= trip.startDate && originalDate <= trip.endDate ? originalDate : trip.startDate;
  const name = el('input', { id: 'plan-name', type: 'text', required: true, maxlength: 500, autocomplete: 'off', value: plan?.name || '' });
  const day = el('input', { id: 'plan-date', type: 'date', required: true, min: trip.startDate, max: trip.endDate, value: dateValue });
  const time = el('input', { id: 'plan-time', type: 'time', value: plan ? planTimeInput(plan.startAt, trip.timeZone) : '' });
  const category = el('select', { id: 'plan-category' }, [...new Set(['散策', '観光', '食事', '移動', 'その他', plan?.category].filter(Boolean))].map(value => el('option', { value }, value)));
  category.value = plan?.category || '散策';
  const address = el('input', { id: 'plan-address', type: 'text', maxlength: 2000, value: plan?.address || '' });
  const memo = el('textarea', { id: 'plan-memo', rows: 4, maxlength: 10000 }, plan?.memo || '');
  view.fields.append(
    field('施設名・予定名（必須）', name),
    el('div', { className: 'form-row' }, field('日付（必須）', day), field('時刻（任意）', time)),
    el('p', { className: 'muted' }, `時刻は旅行のタイムゾーン（${trip.timeZone}）です。空欄なら「時刻未定」として保存します。`),
    field('分類', category), field('住所（任意）', address), field('メモ（任意）', memo)
  );
  let busy = false;
  view.form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const input = { tripId: trip.id, date: day.value, time: time.value, name: name.value, category: category.value, address: address.value, memo: memo.value, location: plan?.location || null };
    busy = true;
    view.setBusy(true);
    try {
      const result = await savePlan(input, { planId: plan?.id || null, expectedPlan });
      view.dialog.close();
      onSaved(result, trip.id, input.date, plan ? '予定を更新しました。訪問記録は変更していません。' : '予定を追加しました。');
    } catch (error) { view.showError(error); }
    finally { busy = false; view.setBusy(false); }
  });
  view.open();
}

export function openPlanDelete({ trip, data, plan, onSaved }) {
  const expectedPlan = structuredClone(plan);
  const date = data.days.find(day => day.id === plan.dayId).date;
  const visits = data.visits.filter(visit => visit.planId === plan.id).length;
  const view = formDialog('予定を削除しますか？', 'REMOVE PLAN');
  view.submit.textContent = '予定を削除する';
  view.submit.classList.add('danger');
  view.fields.append(el('h3', {}, plan.name), el('p', {}, 'この予定を予定一覧から取り除きます。'),
    el('p', { className: 'info-note' }, visits ? `関連する訪問記録${visits}件と、予定への参照はそのまま保持します。` : '予定は内部に削除済みとして保持します。訪問記録は削除しません。'));
  let busy = false;
  view.form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    busy = true; view.setBusy(true);
    try {
      const result = await deletePlan(plan.id, expectedPlan);
      view.dialog.close();
      onSaved(result, trip.id, date, '予定を削除しました。訪問履歴は保持しています。');
    } catch (error) { view.showError(error); }
    finally { busy = false; view.setBusy(false); view.submit.textContent = '予定を削除する'; }
  });
  view.open();
}
