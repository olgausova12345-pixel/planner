// birthdays.js — раздел «ДР». Фабрика получает общие сервисы приложения.
import * as L from './logic.js';

/**
 * ctx: { data, apply, toast, dialogs, h, icon, today, now, refreshPlan, uid, notify, sound, reminded }
 */
export function createBirthdays(ctx) {
  const { h, icon } = ctx;
  const $ = (id) => document.getElementById(id);
  const dlg = $('dlg-bd');
  let editing = null;

  // Заполнение списков дня и месяца
  const daySel = $('b-day'), monSel = $('b-month');
  for (let d = 1; d <= 31; d++) daySel.append(h('option', { value: String(d) }, String(d)));
  L.MONTHS_GEN.forEach((m, i) => monSel.append(h('option', { value: String(i + 1) }, m)));

  function list() { return [...ctx.data.birthdays.values()]; }

  function onDate(iso) { return L.birthdaysOn(list(), iso); }

  function syncFeb29() {
    $('b-feb29').hidden = !(daySel.value === '29' && monSel.value === '2');
  }
  daySel.addEventListener('change', syncFeb29);
  for (const k of ['name', 'year']) $(`b-${k}`).addEventListener('input', () => { $(`b-${k}-err`).hidden = true; });
  monSel.addEventListener('change', syncFeb29);

  function clearErrors() {
    for (const k of ['name', 'day', 'year']) { const e = $(`b-${k}-err`); e.hidden = true; e.textContent = ''; }
  }

  function open(bd = null) {
    editing = bd;
    clearErrors();
    const now = ctx.now();
    $('dlg-bd-title').textContent = bd ? 'Изменить день рождения' : 'Новый день рождения';
    $('b-name').value = bd ? bd.name : '';
    daySel.value = String(bd ? bd.day : now.getDate());
    monSel.value = String(bd ? bd.month : now.getMonth() + 1);
    $('b-year').value = bd && bd.year ? String(bd.year) : '';
    $('b-note').value = bd ? bd.note || '' : '';
    $('b-remind').checked = bd ? !!bd.remind : true;
    $('b-delete').hidden = !bd;
    syncFeb29();
    ctx.dialogs.show(dlg);
    if (!bd) setTimeout(() => $('b-name').focus(), 50);
  }

  dlg.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();
    const res = L.validateBirthday({
      name: $('b-name').value, day: daySel.value, month: monSel.value, year: $('b-year').value.trim(), note: $('b-note').value,
    }, ctx.now().getFullYear());
    if (!res.ok) {
      for (const [k, msg] of Object.entries(res.errors)) {
        const el = $(`b-${k === 'month' ? 'day' : k}-err`);
        el.textContent = msg; el.hidden = false;
      }
      return;
    }
    const remind = $('b-remind').checked;
    if (remind) ctx.notify.ask();
    const rec = editing
      ? { ...editing, ...res.value, remind }
      : { id: ctx.uid(), ...res.value, remind, createdAt: ctx.now().toISOString() };
    const ok = await ctx.apply([{ store: 'birthdays', put: rec }]);
    if (ok) {
      ctx.dialogs.close(dlg);
      ctx.toast(editing ? 'Изменения сохранены' : 'День рождения добавлен');
    }
  });

  $('b-delete').addEventListener('click', async () => {
    if (!editing) return;
    const yes = await ctx.dialogs.confirm('Удалить запись?', `«${editing.name}» будет удалён из списка дней рождения.`, 'Удалить', true);
    if (!yes) return;
    const ok = await ctx.apply([{ store: 'birthdays', del: editing.id }], { undo: 'Запись удалена' });
    if (ok) ctx.dialogs.close(dlg);
  });

  $('btn-bd-add').addEventListener('click', () => open());

  function render() {
    const wrap = $('bd-list');
    const all = L.sortBirthdays(list());
    $('bd-count').textContent = all.length ? L.pluralN(all.length, 'запись', 'записи', 'записей') : '';
    const year = ctx.now().getFullYear();
    const today = ctx.today();
    const nodes = [];
    if (!all.length) {
      nodes.push(h('div', { class: 'card' },
        h('p', { class: 'empty' }, 'Пока нет ни одного дня рождения.'),
        h('p', { class: 'empty' }, 'Нажмите «Добавить», чтобы записать первый.')));
    }
    for (let m = 1; m <= 12; m++) {
      const items = all.filter((b) => b.month === m);
      if (!items.length) continue;
      const ul = h('ul', { class: 'bd-list' });
      for (const b of items) {
        const shown = L.birthdayInYear(b, year);
        const iso = `${year}-${String(shown.month).padStart(2, '0')}-${String(shown.day).padStart(2, '0')}`;
        const diff = Math.round((L.parseISO(iso) - L.parseISO(today)) / 864e5);
        const age = L.ageOn(b, year);
        const sub = [];
        if (age != null) sub.push(diff < 0 ? `исполнилось ${L.pluralN(age, 'год', 'года', 'лет')}` : `исполнится ${L.pluralN(age, 'год', 'года', 'лет')}`);
        if (diff === 0) sub.unshift('Сегодня!');
        else if (diff === 1) sub.unshift('Завтра');
        else if (diff > 1 && diff <= 14) sub.unshift(`через ${L.pluralN(diff, 'день', 'дня', 'дней')}`);
        if (shown.shifted) sub.push('в этом году — 28 февраля');
        if (b.note) sub.push(b.note);
        ul.append(h('li', {},
          h('button', { class: `bd-item${diff >= 0 && diff <= 1 ? ' soon' : ''}`, type: 'button', on: { click: () => open(b) },
            attrs: { 'aria-label': `${b.name}, ${b.day} ${L.MONTHS_GEN[b.month - 1]}. Изменить` } },
          h('div', { class: 'bd-day' }, h('b', {}, String(b.day)), h('span', {}, L.MONTHS_GEN[b.month - 1].slice(0, 3))),
          h('div', { class: 'bd-info' }, h('div', { class: 'bd-name' }, b.name), sub.length ? h('div', { class: 'bd-sub' }, sub.join(' · ')) : null),
          b.remind ? h('span', { class: 'bd-bell', attrs: { title: 'Напоминание включено' } }, icon('bell')) : null)));
      }
      nodes.push(h('section', { class: 'bd-month' }, h('h2', {}, L.MONTHS_NOM[m - 1]), ul));
    }
    wrap.replaceChildren(...nodes);
  }

  /** Проверка напоминаний: с 09:00, «завтра» и «сегодня», каждое один раз */
  function checkReminders(now) {
    const due = L.dueBirthdayReminders(list(), now, ctx.reminded.get());
    for (const r of due) {
      ctx.reminded.mark(r.key);
      const name = r.bd.name;
      const year = now.getFullYear();
      const age = L.ageOn(r.bd, year);
      const ageText = age != null ? ` (${L.pluralN(age, 'год', 'года', 'лет')})` : '';
      const text = r.when === 'today' ? `Сегодня день рождения: ${name}${ageText}` : `Завтра день рождения: ${name}${ageText}`;
      ctx.alert('День рождения', text);
    }
  }

  return { render, open, onDate, checkReminders, list };
}
