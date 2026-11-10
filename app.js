// app.js — интерфейс: план, покупки, заметки, меню, копии, напоминания, установка.
import * as L from './logic.js';
import { openDB, requestPersistence, storageEstimate } from './db.js';
import { createBirthdays } from './birthdays.js';
import { createNative } from './native.js';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const LS = 'planner.';
const ls = {
  get(k, d = null) { try { const v = localStorage.getItem(LS + k); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(LS + k, v); } catch { /* полное хранилище */ } },
  del(k) { try { localStorage.removeItem(LS + k); } catch { /* нет доступа */ } },
  json(k, d) { try { return JSON.parse(this.get(k)) ?? d; } catch { return d; } },
};
const TOAST_MS = 3200;
const UNDO_MS = 7000;
const SAVE_DELAY = 450;

// ---------- Время (переопределяется в тестах через ?now=) ----------
let timeShift = 0;
// Подмена времени (?now=) работает только при запуске тестов на этом компьютере, не на сайте и не в APK.
const IS_TEST_HOST = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && location.port !== '';
try {
  const q = IS_TEST_HOST && new URLSearchParams(location.search).get('now');
  if (q) timeShift = new Date(q).getTime() - Date.now();
} catch { /* нет параметра */ }
const now = () => new Date(Date.now() + timeShift);
const today = () => L.toISO(now());
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));

// ---------- DOM-помощники (только textContent) ----------
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'attrs') for (const [a, av] of Object.entries(v)) { if (av != null && av !== false) el.setAttribute(a, av === true ? '' : av); }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el[k] = v;
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `ic i-${name} ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

// ---------- Состояние ----------
const data = { tasks: new Map(), purchases: new Map(), notes: new Map(), noteFolders: new Map(), birthdays: new Map(), vacations: new Map() };
let db = null;
let pendingSave = false;
const state = {
  view: 'plan', mode: 'day', date: today(), shopDate: today(),
  backTo: null, // 'week' | 'month' — откуда открыт день
  noteId: null, newNote: null, notesMode: 'list', query: '', folderId: null,
  monthSel: null, scroll: 0, expanded: new Set(),
};
function saveUI() {
  try {
    sessionStorage.setItem(LS + 'ui', JSON.stringify({
      view: state.view, mode: state.mode, date: state.date, shopDate: state.shopDate, backTo: state.backTo,
      noteId: state.noteId, notesMode: state.notesMode, query: state.query, folderId: state.folderId, scroll: window.scrollY,
    }));
  } catch { /* нет sessionStorage */ }
}
function loadUI() {
  try {
    const s = JSON.parse(sessionStorage.getItem(LS + 'ui'));
    if (s) Object.assign(state, s, { expanded: new Set() });
  } catch { /* новый запуск */ }
}

// ---------- Тосты ----------
function toast(msg, { undo = null, ms } = {}) {
  const area = $('toast-area');
  while (area.children.length >= 2) area.firstChild.remove();
  const t = h('div', { class: 'toast', attrs: { role: 'status' } }, h('span', {}, msg));
  let timer;
  const close = () => { clearTimeout(timer); t.remove(); };
  if (undo) {
    t.append(h('button', { type: 'button', on: { click: async () => { close(); await undo(); toast('Отменено'); } } }, 'Вернуть'));
  }
  area.append(t);
  timer = setTimeout(close, ms ?? (undo ? UNDO_MS : TOAST_MS));
  return close;
}

// ---------- Диалоги и «Назад» ----------
// Системный жест «Назад» закрывает диалог или возвращает из дня в неделю/месяц.
const backStack = [];
let ignorePop = 0;
let backPending = Promise.resolve();
let backResolve = null;
function pushBack(fn) {
  // Ждём завершения предыдущего «тихого» шага назад, чтобы не перепутать записи истории.
  backPending = backPending.then(() => {
    backStack.push(fn);
    history.pushState({ planner: backStack.length }, '');
  });
}
function popBackSilently() {
  if (!backStack.length) return;
  backStack.pop();
  ignorePop++;
  backPending = backPending.then(() => new Promise((res) => {
    backResolve = res;
    setTimeout(res, 400); // подстраховка, если popstate не придёт
    history.back();
  }));
}
window.addEventListener('popstate', () => {
  if (ignorePop) { ignorePop--; if (backResolve) { backResolve(); backResolve = null; } return; }
  const fn = backStack.pop();
  if (fn) fn();
});

const dialogs = {
  show(dlg) {
    if (dlg.open) return;
    dlg.showModal();
    const onClose = () => {
      dlg.removeEventListener('close', onClose);
      if (dlg._viaBack) { dlg._viaBack = false; return; }
      popBackSilently();
    };
    dlg.addEventListener('close', onClose);
    pushBack(() => { dlg._viaBack = true; dlg.close('back'); });
  },
  close(dlg, value = '') { if (dlg.open) dlg.close(value); },
  /** Выбор из списка кнопок: options = [{label, value, icon, danger, primary}] */
  choice(title, text, options) {
    const dlg = $('dlg-choice');
    $('dlg-choice-title').textContent = title;
    const p = $('dlg-choice-text');
    p.textContent = text || ''; p.hidden = !text;
    return new Promise((resolve) => {
      let result = null;
      const list = $('dlg-choice-list');
      list.replaceChildren(...options.map((o) => h('button', {
        class: `btn wide${o.primary ? ' primary' : ''}${o.danger ? ' danger' : ''}`, type: 'button',
        on: { click: () => { result = o.value; dialogs.close(dlg); } },
      }, o.icon ? icon(o.icon) : null, h('span', {}, o.label))));
      list.append(h('button', { class: 'btn wide', type: 'button', on: { click: () => dialogs.close(dlg) } }, 'Отмена'));
      dlg.addEventListener('close', () => resolve(result), { once: true });
      dialogs.show(dlg);
    });
  },
  async confirm(title, text, okLabel = 'Да', danger = false) {
    const r = await dialogs.choice(title, text, [{ label: okLabel, value: true, danger, primary: !danger, icon: danger ? 'trash' : null }]);
    return r === true;
  },
  prompt(title, label, value, okLabel, validate) {
    const dlg = $('dlg-prompt');
    $('dlg-prompt-title').textContent = title;
    $('p-label').textContent = label;
    $('p-ok').textContent = okLabel || 'Сохранить';
    const input = $('p-input'), err = $('p-err');
    input.value = value || ''; err.hidden = true;
    return new Promise((resolve) => {
      let result = null;
      const form = dlg.querySelector('form');
      const onSubmit = (e) => {
        e.preventDefault();
        const v = validate(input.value);
        if (!v.ok) { err.textContent = v.error; err.hidden = false; input.focus(); return; }
        result = v.value; dialogs.close(dlg);
      };
      form.addEventListener('submit', onSubmit);
      dlg.addEventListener('close', () => { form.removeEventListener('submit', onSubmit); resolve(result); }, { once: true });
      dialogs.show(dlg);
      setTimeout(() => input.focus(), 50);
    });
  },
  info(title, nodes) {
    $('dlg-info-title').textContent = title;
    $('dlg-info-body').replaceChildren(...nodes);
    dialogs.show($('dlg-info'));
  },
};
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-close]');
  if (b) dialogs.close(b.closest('dialog'));
});

// ---------- Запись изменений с отменой ----------
/**
 * changes: [{store, put: rec} | {store, del: id}]
 * opts.undo — текст тоста с кнопкой «Вернуть».
 */
async function apply(changes, opts = {}) {
  const prev = changes.map((c) => {
    const key = c.put ? c.put.id : c.del;
    const old = data[c.store].get(key);
    return { store: c.store, key, old: old ? structuredClone(old) : null };
  });
  try {
    await db.batch(changes.map((c) => (c.put ? { store: c.store, put: c.put } : { store: c.store, del: c.del })));
  } catch (e) {
    console.error(e);
    toast('Не удалось сохранить. Попробуйте ещё раз.');
    renderAll();
    return false;
  }
  for (const c of changes) {
    if (c.put) data[c.store].set(c.put.id, c.put); else data[c.store].delete(c.del);
  }
  renderAll();
  if (opts.undo) {
    toast(opts.undo, {
      undo: async () => {
        const back = prev.map((p) => (p.old ? { store: p.store, put: p.old } : { store: p.store, del: p.key }));
        await apply(back);
      },
    });
  }
  checkBackupBanner();
  native.reschedule();
  return true;
}

// ---------- Звук, вибрация, уведомления ----------
let audioCtx = null;
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t0 = audioCtx.currentTime + 0.05;
    for (let i = 0; i < 3; i++) {
      [880, 660].forEach((f, j) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = f; o.type = 'sine';
        const st = t0 + i * 0.7 + j * 0.25;
        g.gain.setValueAtTime(0.0001, st);
        g.gain.exponentialRampToValueAtTime(0.35, st + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, st + 0.22);
        o.connect(g).connect(audioCtx.destination);
        o.start(st); o.stop(st + 0.24);
      });
    }
  } catch { /* звук недоступен */ }
  try { navigator.vibrate && navigator.vibrate([300, 150, 300, 150, 300]); } catch { /* нет вибрации */ }
}
const notify = {
  async ask() {
    if (native.available) { if (!(await native.status()).notifications) await native.requestPermission(); updateBanners(); return; }
    try { if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission(); } catch { /* нет */ }
  },
  async show(title, body) {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const reg = await navigator.serviceWorker?.getRegistration();
      const opts = { body, icon: './icons/icon-192.png', badge: './icons/icon-192.png', tag: title + body, vibrate: [300, 150, 300], lang: 'ru' };
      if (reg) await reg.showNotification(title, opts); else new Notification(title, opts);
    } catch { /* уведомления недоступны */ }
  },
};
function alertBox(title, text) {
  $('dlg-alert-title').textContent = title;
  $('dlg-alert-text').textContent = text;
  // В Android-версии звук и уведомление даёт система, здесь только окно на экране.
  if (!native.available) { beep(); notify.show(title, text); }
  if (!$('dlg-alert').open) dialogs.show($('dlg-alert'));
}
const reminded = {
  get() { return ls.json('reminded', {}); },
  mark(key) {
    const m = this.get();
    m[key] = Date.now();
    const cutoff = Date.now() - 7 * 864e5;
    for (const k of Object.keys(m)) if (m[k] < cutoff) delete m[k];
    ls.set('reminded', JSON.stringify(m));
  },
};

// ---------- Android-версия ----------
const native = createNative({
  getTasks: () => [...data.tasks.values()],
  getBirthdays: () => [...data.birthdays.values()],
  now,
});
if (native.available) root.dataset.native = '1';

// ---------- Модуль ДР ----------
let bd;

// ---------- Навигация по разделам ----------
const VIEW_TITLES = { plan: 'План', shop: 'Покупки', notes: 'Заметки', bd: 'Дни рождения', menu: 'Меню' };
function buildTopNav() {
  const nav = $('nav-top');
  nav.replaceChildren(...[...$('nav-bottom').children].map((b) => {
    const c = b.cloneNode(true);
    c.addEventListener('click', () => setView(c.dataset.view));
    return c;
  }));
}
function setView(v) {
  if (state.view === 'notes' && v !== 'notes') flushNote();
  state.view = v;
  root.dataset.view = v;
  for (const s of document.querySelectorAll('.view')) s.hidden = s.dataset.view !== v;
  for (const b of document.querySelectorAll('#nav-bottom button, #nav-top button')) {
    if (b.dataset.view === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  $('top-title').textContent = VIEW_TITLES[v];
  requestAnimationFrame(fitHeaderDeco);
  renderAll();
  window.scrollTo(0, 0);
  saveUI();
}
$('nav-bottom').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (b) setView(b.dataset.view);
});

// ---------- Украшение в шапке праздничных тем: только в свободном месте справа от названия ----------
function fitHeaderDeco() {
  const top = document.querySelector('.top'), title = $('top-title');
  if (!top || !title || !title.firstChild) return;
  const r = document.createRange(); r.selectNodeContents(title);
  let textRight = r.getBoundingClientRect().right;
  const after = getComputedStyle(title, '::after');
  if (after.content && after.content !== 'none') textRight += (parseFloat(after.width) || 0) + (parseFloat(after.marginLeft) || 0);
  const tb = top.getBoundingClientRect();
  const btn = $('btn-install-head');
  const limit = btn && !btn.hidden && btn.offsetWidth ? btn.getBoundingClientRect().left - 6 : tb.right - (parseFloat(getComputedStyle(top).paddingRight) || 0);
  const avail = limit - textRight - 8;
  root.style.setProperty('--deco-w', `${avail < 48 ? 0 : Math.round(avail)}px`);
  root.style.setProperty('--deco-r', `${Math.max(4, Math.round(tb.right - limit))}px`);
}
window.addEventListener('resize', () => requestAnimationFrame(fitHeaderDeco));

// ---------- Раскладка по ширине в rem ----------
function remPx() { return parseFloat(getComputedStyle(root).fontSize) || 24; }
function updateLayout() {
  const layout = window.innerWidth / remPx() >= 30 ? 'wide' : 'narrow';
  if (root.dataset.layout === layout) return;
  const active = document.activeElement;
  const sel = active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  const ratio = window.scrollY / Math.max(1, document.body.scrollHeight);
  root.dataset.layout = layout;
  renderAll();
  requestAnimationFrame(() => {
    window.scrollTo(0, ratio * document.body.scrollHeight);
    if (active && document.contains(active)) {
      active.focus({ preventScroll: true });
      if (sel) try { active.setSelectionRange(...sel); } catch { /* не текст */ }
    }
  });
}
window.addEventListener('resize', updateLayout);

// ---------- Панель даты ----------
function setPlanDate(iso) { state.date = iso; state.monthSel = null; renderPlan(); saveUI(); }
function datebarRender(scope) {
  const bar = document.querySelector(`.datebar[data-scope="${scope}"]`);
  const t = today();
  let main, sub = '';
  if (scope === 'plan' && state.mode === 'week') {
    main = L.formatWeekTitle(state.date, t);
    if (L.weekDates(state.date).includes(t)) sub = 'Эта неделя';
  } else if (scope === 'plan' && state.mode === 'month') {
    main = L.formatMonthTitle(state.date, t);
  } else {
    const iso = scope === 'plan' ? state.date : state.shopDate;
    main = L.formatDayTitle(iso, t);
    sub = L.relativeLabel(iso, t);
  }
  bar.querySelector('.dt-main').textContent = main;
  bar.querySelector('.dt-sub').textContent = sub;
  const pick = bar.querySelector('[data-act="pick"]');
  pick.setAttribute('aria-label', `${main}${sub ? ', ' + sub : ''}. Выбрать дату`);
}
function shiftDate(scope, dir) {
  if (scope === 'shop') { state.shopDate = L.addDays(state.shopDate, dir); renderShop(); saveUI(); return; }
  if (state.mode === 'day') setPlanDate(L.addDays(state.date, dir));
  else if (state.mode === 'week') setPlanDate(L.addDays(state.date, dir * 7));
  else setPlanDate(L.addMonths(state.date, dir));
}
for (const bar of document.querySelectorAll('.datebar')) {
  const scope = bar.dataset.scope;
  bar.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'prev') shiftDate(scope, -1);
    if (b.dataset.act === 'next') shiftDate(scope, 1);
    if (b.dataset.act === 'pick') {
      const iso = await pickDate(scope === 'shop' ? state.shopDate : state.date);
      if (!iso) return;
      if (scope === 'shop') { state.shopDate = iso; renderShop(); saveUI(); } else setPlanDate(iso);
    }
  });
}
for (const row of document.querySelectorAll('.quick-row')) {
  const scope = row.closest('.view').dataset.view === 'shop' ? 'shop' : 'plan';
  row.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const iso = b.dataset.act === 'today' ? today() : L.addDays(today(), 1);
    if (scope === 'shop') { state.shopDate = iso; renderShop(); saveUI(); return; }
    if (state.mode !== 'day') { state.backTo = null; state.mode = 'day'; }
    setPlanDate(iso);
  });
}

// Поле даты: кнопка с русской подписью, выбор в мини-календаре (одинаково во всех браузерах)
function makeDateField(btn) {
  let val = '';
  const label = h('span', {});
  btn.replaceChildren(icon('plan'), label);
  Object.defineProperty(btn, 'value', {
    get: () => val,
    set: (v) => { val = v || ''; label.textContent = val ? L.formatDayTitle(val, today()) : 'Выберите дату'; },
  });
  btn.value = '';
  btn.addEventListener('click', async () => {
    const iso = await pickDate(val || today());
    if (iso) { btn.value = iso; btn.dispatchEvent(new Event('change', { bubbles: true })); }
  });
}
for (const id of ['t-date', 't-until', 'sd-date']) makeDateField($(id));

// Выбор даты — мини-календарь
let mcMonth = null, mcResolve = null, mcSel = null;
function pickDate(iso) {
  mcSel = iso;
  mcMonth = iso.slice(0, 8) + '01';
  renderMiniCal();
  return new Promise((resolve) => {
    mcResolve = resolve;
    const dlg = $('dlg-date');
    let result = null;
    dlg._set = (v) => { result = v; };
    dlg.addEventListener('close', () => { resolve(result); mcResolve = null; }, { once: true });
    dialogs.show(dlg);
  });
}
function renderMiniCal() {
  const d = L.parseISO(mcMonth);
  $('mc-title').textContent = L.formatMonthTitle(mcMonth, '0000-01-01').replace(/ \d{4}$/, '') + ' ' + d.getFullYear();
  const grid = $('mc-grid');
  const nodes = L.WEEKDAYS_SHORT.map((w) => h('span', {}, w));
  const t = today();
  for (const iso of L.monthGrid(d.getFullYear(), d.getMonth()).flat()) {
    if (!iso) { nodes.push(h('span')); continue; }
    const info = L.dayInfo(iso);
    nodes.push(h('button', {
      type: 'button', class: [info.off && 'off', iso === t && 'today', iso === mcSel && 'sel'].filter(Boolean).join(' '),
      attrs: { 'aria-label': L.formatDayTitle(iso, t) },
      on: { click: () => { $('dlg-date')._set(iso); dialogs.close($('dlg-date')); } },
    }, String(L.parseISO(iso).getDate())));
  }
  grid.replaceChildren(...nodes);
}
$('mc-prev').addEventListener('click', () => { mcMonth = L.addMonths(mcMonth, -1); renderMiniCal(); });
$('mc-next').addEventListener('click', () => { mcMonth = L.addMonths(mcMonth, 1); renderMiniCal(); });
$('mc-today').addEventListener('click', () => { $('dlg-date')._set(today()); dialogs.close($('dlg-date')); });

// ---------- ПЛАН ----------
const tasksArr = () => [...data.tasks.values()];
const purchasesOn = (iso) => [...data.purchases.values()].filter((p) => p.date === iso);

document.querySelector('#view-plan .seg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b) return;
  if (state.backTo) { state.backTo = null; }
  state.mode = b.dataset.mode;
  state.monthSel = null;
  renderPlan(); saveUI();
});
$('btn-back-week').addEventListener('click', () => { if (state.backTo) history.back(); });
$('btn-hours').addEventListener('click', openHours);

function openDayFrom(iso, from) {
  state.backTo = from;
  state.mode = 'day';
  state.date = iso;
  renderPlan(); saveUI();
  window.scrollTo(0, 0);
  pushBack(() => { state.mode = from; state.backTo = null; renderPlan(); saveUI(); });
}

function renderPlan() {
  if (state.view !== 'plan') return;
  for (const b of document.querySelectorAll('#view-plan .seg [data-mode]')) {
    b.setAttribute('aria-selected', String(b.dataset.mode === state.mode));
  }
  datebarRender('plan');
  $('btn-hours').hidden = state.mode !== 'day';
  const back = $('btn-back-week');
  back.hidden = !(state.mode === 'day' && state.backTo);
  back.querySelector('span').textContent = state.backTo === 'month' ? 'К месяцу' : 'К неделе';
  const body = $('plan-body');
  if (state.mode === 'day') body.replaceChildren(renderDay(state.date));
  else if (state.mode === 'week') body.replaceChildren(renderWeek(state.date));
  else body.replaceChildren(renderMonth(state.date));
}

function dayInfoLines(iso) {
  const info = L.dayInfo(iso);
  const out = [];
  if (info.holiday) out.push(h('div', { class: 'info-line holiday' }, icon('star'), h('span', {}, info.holiday)));
  if (info.note) out.push(h('div', { class: 'info-line' }, icon('info'), h('span', {}, info.note)));
  const bds = bd.onDate(iso);
  if (bds.length) {
    const year = Number(iso.slice(0, 4));
    const names = bds.map((b) => { const a = L.ageOn(b, year); return a != null ? `${b.name} (${a})` : b.name; }).join(', ');
    out.push(h('div', { class: 'info-line bd' }, icon('cake'), h('span', {}, `День рождения: ${names}`)));
  }
  return out;
}

function renderDay(iso) {
  const n = now();
  const t = today();
  const list = L.tasksForDate(tasksArr(), iso);
  const done = list.filter((x) => L.isDoneOn(x, iso)).length;
  const overdue = list.filter((x) => L.isOverdue(x, iso, n));
  const card = h('section', { class: 'card', attrs: { 'aria-label': 'План на день' } },
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title' }, icon('plan'), 'План на день'),
      list.length ? h('span', { class: 'counter' }, `Выполнено ${done} из ${list.length}`) : null),
    ...dayInfoLines(iso));
  if (overdue.length) {
    const target = L.moveTarget(iso, t);
    const where = target === t ? 'на сегодня' : 'на завтра';
    card.append(h('div', { class: 'overdue-bar', attrs: { role: 'status' } },
      h('span', {}, iso < t ? `Не выполнено: ${L.pluralN(overdue.length, 'дело', 'дела', 'дел')}` : `День заканчивается, не выполнено: ${L.pluralN(overdue.length, 'дело', 'дела', 'дел')}`),
      h('button', { class: 'btn', type: 'button', on: { click: () => moveTasks(overdue, iso, target) } },
        icon('move'), `Перенести ${L.pluralN(overdue.length, 'дело', 'дела', 'дел')} ${where}`)));
  }
  card.append(h('button', { class: 'btn primary wide', type: 'button', on: { click: () => openTaskDialog(null, { date: iso }) } }, icon('plus'), 'Добавить дело'));
  if (!list.length) card.append(h('p', { class: 'empty' }, 'На этот день дел нет.'));
  else {
    const ul = h('ul', { class: 'task-list' });
    for (const task of list) ul.append(taskItem(task, iso, n));
    card.append(ul);
  }
  const grid = h('div', { class: 'day-grid' }, card, shopCard(iso, true));
  return grid;
}

function taskItem(task, iso, n) {
  const done = L.isDoneOn(task, iso);
  const over = L.isOverdue(task, iso, n);
  const meta = [];
  if (task.repeat) meta.push(h('span', {}, icon('repeat'), L.repeatLabel(task.repeat, task.date)));
  if (task.remind && task.time) meta.push(h('span', {}, icon('bell'), 'за 15 мин'));
  if (task.movedFrom && !task.repeat) meta.push(h('span', {}, icon('move'), `перенесено с ${L.formatShortDate(task.movedFrom)}`));
  const cbId = `cb-${task.id}-${iso}`;
  return h('li', { class: `task${done ? ' done' : ''}${over ? ' overdue' : ''}` },
    h('label', { class: 'cb-wrap', attrs: { for: cbId } },
      h('input', { type: 'checkbox', class: 'cb', id: cbId, checked: done,
        attrs: { 'aria-label': `${task.title}${task.time ? ', ' + L.formatTime(task.time) : ''}: выполнено` },
        on: { change: (e) => toggleTask(task, iso, e.target.checked) } })),
    task.time ? h('span', { class: 'task-time' }, L.formatTime(task.time)) : null,
    h('div', { class: 'task-main' },
      h('span', { class: 'task-title' }, task.title),
      meta.length ? h('div', { class: 'task-meta' }, meta) : null),
    h('button', { class: 'icon-btn plain', type: 'button', attrs: { 'aria-label': `Действия: ${task.title}` }, on: { click: () => taskMenu(task, iso) } }, icon('more')));
}

async function toggleTask(task, iso, val) {
  const cur = data.tasks.get(task.id);
  if (!cur) return;
  await apply([{ store: 'tasks', put: L.setDoneOn(cur, iso, val) }]);
}

async function taskMenu(task, iso) {
  const target = L.moveTarget(iso, today());
  const where = target === today() ? 'на сегодня' : 'на завтра';
  const r = await dialogs.choice(task.title, task.repeat ? L.repeatLabel(task.repeat, task.date) : (task.time ? L.formatTime(task.time) : ''), [
    { label: `Перенести ${where}`, value: 'move', icon: 'move' },
    { label: 'Изменить', value: 'edit', icon: 'edit' },
    { label: 'Удалить', value: 'del', icon: 'trash', danger: true },
  ]);
  if (r === 'move') moveTasks([task], iso, target);
  if (r === 'edit') openTaskDialog(data.tasks.get(task.id), { date: iso });
  if (r === 'del') deleteTask(task, iso);
}

async function moveTasks(list, fromIso, toIso) {
  const changes = [];
  let all = tasksArr();
  for (const t of list) {
    const cur = data.tasks.get(t.id);
    const plan = L.planMove(cur, fromIso, toIso, all, uid, now());
    changes.push({ store: 'tasks', put: plan.update });
    if (plan.create) changes.push({ store: 'tasks', put: plan.create });
    all = all.map((x) => (x.id === plan.update.id ? plan.update : x)).concat(plan.create ? [plan.create] : []);
  }
  const where = toIso === today() ? 'на сегодня' : (toIso === L.addDays(today(), 1) ? 'на завтра' : `на ${L.formatShortDate(toIso)}`);
  await apply(changes, { undo: list.length > 1 ? `${L.pluralN(list.length, 'дело перенесено', 'дела перенесены', 'дел перенесено')} ${where}` : `Дело перенесено ${where}` });
}

async function deleteTask(task, iso) {
  const cur = data.tasks.get(task.id);
  if (!cur) return;
  if (cur.repeat) {
    const mode = await dialogs.choice('Удалить повторяющееся дело?', cur.title, [
      { label: 'Только в этот день', value: 'one' },
      { label: 'В этот и следующие', value: 'following' },
      { label: 'Все повторы', value: 'all', danger: true },
    ]);
    if (!mode) return;
    const plan = L.planRepeatDelete(cur, iso, mode);
    await apply([plan.remove ? { store: 'tasks', del: cur.id } : { store: 'tasks', put: plan.update }], { undo: 'Дело удалено' });
  } else {
    const yes = await dialogs.confirm('Удалить дело?', cur.title, 'Удалить', true);
    if (yes) await apply([{ store: 'tasks', del: cur.id }], { undo: 'Дело удалено' });
  }
}

// --- Неделя ---
function renderWeek(iso) {
  const t = today();
  const wrap = h('div', { class: 'week-list' });
  const all = tasksArr();
  for (const d of L.weekDates(iso)) {
    const info = L.dayInfo(d);
    const list = L.tasksForDate(all, d);
    const timed = list.filter((x) => x.time);
    const st = L.dayStats(all, d);
    const pc = purchasesOn(d).filter((p) => !p.bought).length;
    const bds = bd.onDate(d);
    const dd = L.parseISO(d);
    const btn = h('button', {
      class: `week-day${info.off ? ' weekend' : ''}${d === t ? ' today' : ''}`, type: 'button',
      on: { click: () => openDayFrom(d, 'week') },
      attrs: { 'aria-label': `${L.formatDayTitle(d, t)}. ${st.total ? L.pluralN(st.total, 'дело', 'дела', 'дел') : 'Дел нет'}. Открыть день` },
    },
    h('div', { class: 'wd-top' },
      h('span', { class: 'wd-name' }, L.WEEKDAYS[L.weekday(d)]),
      h('span', { class: 'wd-date' }, `${dd.getDate()} ${L.MONTHS_GEN[dd.getMonth()]}`),
      d === t ? h('span', { class: 'badge' }, 'Сегодня') : null),
    info.holiday ? h('div', { class: 'wd-line holiday' }, icon('star'), info.holiday) : (info.note ? h('div', { class: 'wd-line holiday' }, icon('info'), info.note) : null),
    bds.length ? h('div', { class: 'wd-line' }, icon('cake'), bds.map((b) => b.name).join(', ')) : null,
    timed.length ? h('ul', { class: 'wd-tasks' }, timed.slice(0, 4).map((x) => h('li', {}, h('b', {}, L.formatTime(x.time)), h('span', {}, x.title)))) : null,
    timed.length > 4 ? h('div', { class: 'wd-line muted' }, `и ещё ${timed.length - 4}`) : null,
    (st.total || pc) ? h('div', { class: 'wd-foot' },
      st.total ? h('span', {}, icon('check'), `${st.done} из ${st.total}`) : null,
      pc ? h('span', {}, icon('cart'), L.pluralN(pc, 'покупка', 'покупки', 'покупок')) : null) : null);
    wrap.append(btn);
  }
  return wrap;
}

// --- Месяц ---
function renderMonth(iso) {
  const t = today();
  const d = L.parseISO(iso);
  const all = tasksArr();
  const purchasesAll = [...data.purchases.values()];
  const box = h('div', { class: 'month', attrs: { role: 'grid', 'aria-label': L.formatMonthTitle(iso, t) } },
    h('div', { class: 'month-head', attrs: { role: 'row' } }, L.WEEKDAYS_SHORT.map((w, i) => h('span', { class: i >= 5 ? 'we' : '', attrs: { role: 'columnheader' } }, w))));
  const wide = root.dataset.layout === 'wide';
  for (const week of L.monthGrid(d.getFullYear(), d.getMonth())) {
    const row = h('div', { class: 'month-row', attrs: { role: 'row' } });
    for (const c of week) {
      if (!c) { row.append(h('div', { class: 'mcell blank', attrs: { role: 'gridcell' } })); continue; }
      const info = L.dayInfo(c);
      const st = L.dayStats(all, c);
      const hasP = purchasesAll.some((p) => p.date === c);
      const hasB = bd.onDate(c).length > 0;
      const label = [L.formatDayTitle(c, t), info.holiday, st.total ? `выполнено ${st.done} из ${st.total}` : null, hasP ? 'есть покупки' : null, hasB ? 'день рождения' : null].filter(Boolean).join(', ');
      row.append(h('button', {
        class: ['mcell', info.off && 'off', c === t && 'today', (state.monthSel || '') === c && 'selected'].filter(Boolean).join(' '),
        type: 'button', attrs: { role: 'gridcell', 'aria-label': label },
        on: { click: () => { if (wide) { state.monthSel = c; renderPlan(); } else openDayFrom(c, 'month'); } },
      },
      h('span', { class: 'mnum' }, String(L.parseISO(c).getDate())),
      st.total ? h('span', { class: 'mstat' }, `${st.done} из ${st.total}`) : null,
      h('span', { class: 'micons' }, hasP ? icon('dot') : null, hasB ? icon('cake') : null, info.holiday ? icon('star') : null)));
    }
    box.append(row);
  }
  const legend = h('div', { class: 'legend' },
    h('span', {}, h('b', { class: 'red' }, '7'), 'выходной'),
    h('span', {}, h('b', {}, '2 из 5'), 'дела'),
    h('span', {}, icon('dot', 'ic-accent'), 'покупки'),
    h('span', {}, icon('cake'), 'день рождения'),
    h('span', {}, icon('star'), 'праздник'));
  const left = h('div', { class: 'month-left' }, box, legend);
  const wrap = h('div', { class: 'month-wrap' }, left);
  // Сводка выбранного дня — в горизонтальной ориентации
  const sel = state.monthSel || (iso.slice(0, 7) === t.slice(0, 7) ? t : iso);
  const st = L.dayStats(all, sel);
  const side = h('section', { class: 'card month-side' },
    h('h2', { class: 'card-title' }, L.formatDayTitle(sel, t)),
    ...dayInfoLines(sel),
    h('p', {}, st.total ? `Дела: выполнено ${st.done} из ${st.total}` : 'Дел нет'),
    h('ul', { class: 'wd-tasks' }, L.tasksForDate(all, sel).slice(0, 6).map((x) => h('li', {}, h('b', {}, x.time ? L.formatTime(x.time) : '•'), h('span', {}, x.title)))),
    h('p', {}, (() => { const n = purchasesOn(sel).length; return n ? `Покупки: ${L.pluralN(n, 'покупка', 'покупки', 'покупок')}` : 'Покупок нет'; })()),
    h('button', { class: 'btn primary', type: 'button', on: { click: () => openDayFrom(sel, 'month') } }, 'Открыть день'));
  wrap.append(side);
  return wrap;
}

// --- По часам ---
function openHours() {
  const iso = state.date;
  const t = today();
  $('hours-sub').textContent = `${L.formatDayTitle(iso, t)}${L.relativeLabel(iso, t) ? ' · ' + L.relativeLabel(iso, t) : ''}. Нажмите на время, чтобы добавить дело.`;
  const list = L.tasksForDate(tasksArr(), iso).filter((x) => x.time);
  const slots = L.hourSlots();
  const extra = [...new Set(list.map((x) => x.time).filter((tm) => !slots.includes(tm)))];
  const rows = [...slots.map((s) => ({ time: s, out: false })), ...extra.map((s) => ({ time: s, out: true }))]
    .sort((a, b) => L.minutesOf(a.time) - L.minutesOf(b.time));
  const cur = L.nowMinutes(now());
  const grid = $('hours-grid');
  let nowRow = null;
  grid.replaceChildren(...rows.map((r) => {
    const m = L.minutesOf(r.time);
    const items = list.filter((x) => x.time === r.time);
    const isNow = iso === t && cur >= m && cur < m + 30;
    const row = h('div', { class: `hour-row${isNow ? ' now' : ''}${r.out ? ' out' : ''}` },
      h('button', { class: 'hour-btn', type: 'button', attrs: { 'aria-label': `Добавить дело на ${L.formatTime(r.time)}` },
        on: { click: () => { dialogs.close($('dlg-hours')); setTimeout(() => openTaskDialog(null, { date: iso, time: r.time }), 60); } } },
      L.formatTime(r.time)),
      h('div', { class: 'hour-items' }, items.length
        ? items.map((x) => h('div', { class: `hour-item${L.isDoneOn(x, iso) ? ' done' : ''}` }, x.title))
        : h('span', { class: 'hour-add' }, r.out ? '' : 'свободно')));
    if (isNow) nowRow = row;
    return row;
  }));
  dialogs.show($('dlg-hours'));
  const target = nowRow || (iso === t && cur > 19 * 60 ? grid.lastElementChild : null);
  if (target) setTimeout(() => target.scrollIntoView({ block: 'center' }), 80);
}

// --- Диалог дела ---
const tDlg = $('dlg-task');
let tEditing = null;
let tDays = new Set();
(function initTaskDialog() {
  const sel = $('t-time');
  sel.append(h('option', { value: '' }, 'Без времени'));
  for (const s of L.timeSlots()) sel.append(h('option', { value: s }, L.formatTime(s)));
  sel.append(h('option', { value: 'custom' }, 'Своё время…'));
  for (let i = 0; i < 24; i++) $('t-hh').append(h('option', { value: String(i).padStart(2, '0') }, String(i)));
  for (let i = 0; i < 60; i++) $('t-mm').append(h('option', { value: String(i).padStart(2, '0') }, String(i).padStart(2, '0')));
  const days = $('t-days');
  L.WEEKDAYS_SHORT.forEach((w, i) => days.append(h('button', {
    type: 'button', attrs: { 'aria-pressed': 'false', 'aria-label': L.WEEKDAYS[i] },
    on: { click: (e) => { tDays.has(i) ? tDays.delete(i) : tDays.add(i); e.currentTarget.setAttribute('aria-pressed', String(tDays.has(i))); } },
  }, w)));
  sel.addEventListener('change', syncTaskDialog);
  $('t-repeat').addEventListener('change', syncTaskDialog);
  $('t-until-mode').addEventListener('change', syncTaskDialog);
  $('t-date').addEventListener('change', syncTaskDialog);
  $('t-remind').addEventListener('change', (e) => { if (e.target.checked) notify.ask(); });
  tDlg.querySelector('form').addEventListener('submit', saveTask);
})();
/** Выбранное в окне дела время: 'ЧЧ:ММ' или null */
function taskDialogTime() {
  const v = $('t-time').value;
  if (v === 'custom') return `${$('t-hh').value}:${$('t-mm').value}`;
  return v || null;
}
function syncTaskDialog() {
  const hasTime = !!$('t-time').value;
  const custom = $('t-time').value === 'custom';
  $('t-custom').hidden = !custom;
  $('t-remind-row').hidden = !hasTime;
  $('t-remind-hint').hidden = !hasTime;
  const rep = $('t-repeat').value;
  $('t-date-label').textContent = rep ? 'Начало повторов' : 'Дата';
  $('t-days').hidden = rep !== 'days';
  $('t-until-wrap').hidden = !rep;
  $('t-until').hidden = $('t-until-mode').value !== 'date';
  const mh = $('t-monthly-hint');
  const date = $('t-date').value;
  if (rep === 'monthly' && date) {
    const day = L.parseISO(date).getDate();
    mh.textContent = day > 28 ? `Каждый месяц ${day}-го. В месяцах, где нет ${day}-го числа, дело пропускается.` : `Каждый месяц ${day}-го числа.`;
    mh.hidden = false;
  } else mh.hidden = true;
  $('t-repeat-warn').hidden = !(tEditing && tEditing.repeat);
}
function openTaskDialog(task, { date, time } = {}) {
  tEditing = task;
  for (const id of ['t-title-err', 't-days-err', 't-until-err']) $(id).hidden = true;
  $('dlg-task-title').textContent = task ? 'Изменить дело' : 'Новое дело';
  $('t-title').value = task ? task.title : '';
  $('t-date').value = task ? task.date : (date || state.date);
  const sel = $('t-time');
  const tm = task ? task.time : (time || '');
  const inList = !tm || L.timeSlots().includes(tm);
  sel.value = inList ? (tm || '') : 'custom';
  const [hh, mm] = (tm && !inList ? tm : '12:00').split(':');
  $('t-hh').value = hh; $('t-mm').value = mm;
  $('t-remind').checked = task ? !!task.remind : false;
  $('t-repeat').value = task && task.repeat ? task.repeat.kind : '';
  tDays = new Set(task && task.repeat && task.repeat.days ? task.repeat.days : [L.weekday(date || state.date)]);
  [...$('t-days').children].forEach((b, i) => b.setAttribute('aria-pressed', String(tDays.has(i))));
  $('t-until-mode').value = task && task.repeat && task.repeat.until ? 'date' : '';
  $('t-until').value = task && task.repeat && task.repeat.until ? task.repeat.until : L.addMonths($('t-date').value, 1);
  syncTaskDialog();
  dialogs.show(tDlg);
  if (!task) setTimeout(() => $('t-title').focus(), 50);
}
async function saveTask(e) {
  e.preventDefault();
  const title = L.normalizeTitle($('t-title').value);
  let bad = false;
  const err = (id, msg) => { $(id).textContent = msg; $(id).hidden = !msg; if (msg) bad = true; };
  err('t-title-err', title ? '' : 'Напишите, что нужно сделать');
  const date = $('t-date').value;
  if (!L.isISODate(date)) { err('t-title-err', title ? 'Укажите дату' : 'Напишите, что нужно сделать'); bad = true; }
  const kind = $('t-repeat').value;
  let repeat = null;
  if (kind) {
    repeat = { kind };
    if (kind === 'days') {
      repeat.days = [...tDays].sort((a, b) => a - b);
      err('t-days-err', repeat.days.length ? '' : 'Выберите хотя бы один день недели');
    }
    if ($('t-until-mode').value === 'date') {
      const u = $('t-until').value;
      err('t-until-err', L.isISODate(u) && u >= date ? '' : 'Дата окончания не может быть раньше начала');
      repeat.until = u;
    } else err('t-until-err', '');
  }
  if (bad) return;
  const time = taskDialogTime();
  const remind = !!time && $('t-remind').checked;
  const n = now();
  let rec;
  if (tEditing) {
    rec = { ...data.tasks.get(tEditing.id), title, date, time, remind, repeat };
    if (!repeat) { rec.skip = []; if (tEditing.repeat) { rec.done = false; rec.doneDates = []; } }
  } else {
    rec = { id: uid(), date, title, time, done: false, remind, repeat, skip: [], doneDates: [], movedFrom: null, seq: n.getTime(), createdAt: n.toISOString() };
  }
  const ok = await apply([{ store: 'tasks', put: rec }]);
  if (ok) {
    dialogs.close(tDlg);
    toast(tEditing ? 'Изменения сохранены' : 'Дело добавлено');
    if (!tEditing && state.mode === 'day' && date !== state.date && !repeat) setPlanDate(date);
  }
}

// ---------- ПОКУПКИ ----------
function renderShop() {
  if (state.view !== 'shop') return;
  datebarRender('shop');
  $('shop-body').replaceChildren(shopCard(state.shopDate, false));
}
function shopCard(iso, inPlan) {
  const list = purchasesOn(iso).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const open = list.filter((p) => !p.bought), bought = list.filter((p) => p.bought);
  const inputId = inPlan ? 'shop-input-plan' : 'shop-input';
  const input = h('input', { class: 'input', id: inputId, type: 'text', maxLength: 300, placeholder: 'Что купить?', autocomplete: 'off',
    attrs: { 'aria-label': 'Что купить?', enterkeyhint: 'done' } });
  const form = h('form', { class: 'shop-add', on: { submit: (e) => { e.preventDefault(); addPurchase(iso, input, inputId); } } },
    input, h('button', { class: 'btn primary', type: 'submit' }, icon('plus'), 'Добавить'));
  const card = h('section', { class: 'card', attrs: { 'aria-label': 'Покупки' } },
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title' }, icon('cart'), inPlan ? 'Покупки на этот день' : 'Список покупок'),
      list.length ? h('span', { class: 'counter' }, `Осталось: ${open.length} из ${list.length}`) : null),
    form);
  if (!list.length) card.append(h('p', { class: 'empty' }, 'Список пуст.'));
  const ul = h('ul', { class: 'shop-list' });
  const item = (p) => h('li', { class: `shop-item${p.bought ? ' bought' : ''}` },
    h('label', { class: 'cb-wrap', attrs: { for: `p-${p.id}-${inPlan ? 1 : 0}` } },
      h('input', { type: 'checkbox', class: 'cb', id: `p-${p.id}-${inPlan ? 1 : 0}`, checked: !!p.bought, attrs: { 'aria-label': `${p.title}: куплено` },
        on: { change: (e) => apply([{ store: 'purchases', put: { ...data.purchases.get(p.id), bought: e.target.checked } }]) } })),
    h('span', { class: 'title' }, p.title),
    h('button', { class: 'icon-btn plain', type: 'button', attrs: { 'aria-label': `Действия: ${p.title}` }, on: { click: () => purchaseMenu(p) } }, icon('more')));
  open.forEach((p) => ul.append(item(p)));
  if (bought.length) {
    ul.append(h('li', { class: 'divider', attrs: { 'aria-hidden': 'true' } }, 'Куплено'));
    bought.forEach((p) => ul.append(item(p)));
  }
  if (list.length) card.append(ul);
  if (list.length) card.append(h('button', { class: 'btn wide', type: 'button', on: { click: () => shopFinish(iso) } }, icon('check'), 'Покупки окончены'));
  return card;
}
async function addPurchase(iso, input, inputId) {
  const title = L.normalizeTitle(input.value);
  if (!title) { input.focus(); return; }
  const n = now();
  await apply([{ store: 'purchases', put: { id: uid(), date: iso, title, bought: false, seq: n.getTime(), createdAt: n.toISOString() } }]);
  const again = $(inputId);
  if (again) { again.value = ''; again.focus(); }
}
async function purchaseMenu(p) {
  const r = await dialogs.choice(p.title, '', [
    { label: 'Изменить название', value: 'edit', icon: 'edit' },
    { label: 'Удалить', value: 'del', icon: 'trash', danger: true },
  ]);
  if (r === 'edit') {
    const v = await dialogs.prompt('Изменить название', 'Что купить', p.title, 'Сохранить', (s) => {
      const t = L.normalizeTitle(s);
      return t ? { ok: true, value: t } : { ok: false, error: 'Название не может быть пустым' };
    });
    if (v) apply([{ store: 'purchases', put: { ...data.purchases.get(p.id), title: v } }]);
  }
  if (r === 'del') apply([{ store: 'purchases', del: p.id }], { undo: 'Покупка удалена' });
}
function shopFinish(iso) {
  const list = purchasesOn(iso);
  const bought = list.filter((p) => p.bought), open = list.filter((p) => !p.bought);
  const dlg = $('dlg-shopdone');
  const t = today();
  $('sd-text').textContent = `${bought.length ? `Купленное (${L.pluralN(bought.length, 'покупка', 'покупки', 'покупок')}) будет убрано из списка.` : 'Купленного нет.'} ${open.length ? `Не куплено: ${L.pluralN(open.length, 'покупка', 'покупки', 'покупок')}.` : ''}`;
  $('sd-options').hidden = !open.length;
  const todayOpt = dlg.querySelector('input[value="today"]').closest('label');
  todayOpt.hidden = iso >= t; // переносить «на сегодня» имеет смысл только с прошедшего дня
  const def = iso < t ? 'today' : 'tomorrow';
  $('sd-tomorrow-label').textContent = iso < t ? 'Перенести на завтра' : `Перенести на следующий день (${L.formatShortDate(L.addDays(iso, 1))})`;
  for (const r of dlg.querySelectorAll('input[name="sd"]')) r.checked = r.value === def;
  $('sd-date').value = L.addDays(iso < t ? t : iso, 1);
  $('sd-date').hidden = true;
  const form = dlg.querySelector('form');
  const onChange = () => { $('sd-date').hidden = form.sd.value !== 'date'; };
  form.addEventListener('change', onChange);
  const onSubmit = async (e) => {
    e.preventDefault();
    const choice = form.sd.value;
    let target = null;
    if (choice === 'today') target = t;
    if (choice === 'tomorrow') target = iso < t ? L.addDays(t, 1) : L.addDays(iso, 1);
    if (choice === 'date') { target = $('sd-date').value; if (!L.isISODate(target)) return; }
    const changes = bought.map((p) => ({ store: 'purchases', del: p.id }));
    for (const p of open) changes.push(choice === 'delete' || !target ? { store: 'purchases', del: p.id } : { store: 'purchases', put: { ...p, date: target } });
    dialogs.close(dlg);
    if (!open.length || choice === 'delete') await apply(changes, { undo: 'Список покупок очищен' });
    else await apply(changes, { undo: `Некупленное перенесено на ${L.formatShortDate(target)}` });
  };
  form.addEventListener('submit', onSubmit);
  dlg.addEventListener('close', () => { form.removeEventListener('submit', onSubmit); form.removeEventListener('change', onChange); }, { once: true });
  dialogs.show(dlg);
}

// ---------- ЗАМЕТКИ ----------
const notesArr = () => [...data.notes.values()];
const foldersArr = () => [...data.noteFolders.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.createdAt).localeCompare(String(b.createdAt)));
let saveTimer = null;

function renderNotes() {
  if (state.view !== 'notes') return;
  const view = $('view-notes').querySelector('.notes-wrap');
  view.dataset.notesMode = state.notesMode;
  if (state.folderId && !data.noteFolders.has(state.folderId)) state.folderId = null;
  // Чипы папок
  const chips = $('folder-chips');
  const chip = (label, id) => h('button', { class: 'chip-btn', type: 'button', attrs: { role: 'tab', 'aria-selected': String(state.folderId === id) },
    on: { click: () => { state.folderId = id; renderNotes(); saveUI(); } } }, id ? icon('folder') : null, label);
  chips.replaceChildren(chip('Все', null), ...foldersArr().map((f) => chip(f.name, f.id)),
    h('button', { class: 'chip-btn', type: 'button', on: { click: createFolder } }, icon('plus'), 'Папка'));
  $('folder-actions').hidden = !state.folderId;
  // Поиск
  const search = $('notes-search');
  if (search.value !== state.query) search.value = state.query;
  search.placeholder = state.folderId ? 'Поиск в папке' : 'Поиск по всем заметкам';
  // Список
  const folders = foldersArr();
  const list = L.visibleNotes(notesArr(), folders, state.folderId, state.query);
  const ul = $('notes-list');
  const nodes = [];
  const q = state.query.trim();
  if (!list.length) {
    nodes.push(h('li', { class: 'empty' }, q ? 'Ничего не найдено.' : (state.folderId ? 'В этой папке пока нет заметок.' : 'Заметок пока нет. Нажмите «Новая заметка».')));
  }
  list.forEach((n, i) => {
    const { title, preview } = L.noteHead(n.text);
    const folder = n.folderId && data.noteFolders.get(n.folderId);
    const long = preview.length > 90 || n.text.split('\n').length > 3;
    const expanded = state.expanded.has(n.id);
    const sameGroup = (j) => list[j] && !!list[j].pinned === !!n.pinned;
    const up = !q && sameGroup(i - 1), down = !q && sameGroup(i + 1);
    nodes.push(h('li', { class: `note-card${state.noteId === n.id ? ' active' : ''}${expanded ? ' expanded' : ''}` },
      h('div', { class: 'note-body' },
        h('button', { class: 'note-open', type: 'button', on: { click: () => openNote(n.id) }, attrs: { 'aria-label': `Открыть заметку: ${title}` } },
          h('span', { class: 'note-title' }, n.pinned ? icon('pin') : null, title),
          preview ? h('span', { class: 'note-preview' }, expanded ? n.text.split('\n').slice(1).join('\n').trim() : preview) : null,
          q && folder ? h('span', { class: 'note-folder-tag' }, icon('folder'), folder.name) : null),
        long ? h('button', { class: 'note-more', type: 'button', attrs: { 'aria-expanded': String(expanded) },
          on: { click: () => { expanded ? state.expanded.delete(n.id) : state.expanded.add(n.id); renderNotes(); } } }, icon(expanded ? 'up' : 'down'), expanded ? 'Свернуть' : 'Показать полностью') : null),
      (up || down) ? h('div', { class: 'note-side' },
        up ? h('button', { class: 'icon-btn', type: 'button', attrs: { 'aria-label': `Выше: ${title}`, title: 'Выше' }, on: { click: () => moveNote(list, i, -1) } }, icon('arrup')) : null,
        down ? h('button', { class: 'icon-btn', type: 'button', attrs: { 'aria-label': `Ниже: ${title}`, title: 'Ниже' }, on: { click: () => moveNote(list, i, 1) } }, icon('arrdown')) : null) : null));
  });
  ul.replaceChildren(...nodes);
  renderEditor();
}
function renderEditor() {
  const note = state.noteId ? data.notes.get(state.noteId) : null;
  const isNew = state.newNote && state.newNote.id === state.noteId;
  const show = !!(note || isNew);
  $('editor').hidden = !show;
  $('editor-empty').hidden = show;
  if (!show) return;
  const sel = $('note-folder');
  const fid = note ? note.folderId : state.newNote.folderId;
  const opts = [h('option', { value: '' }, 'Без папки (во «Все»)'), ...foldersArr().map((f) => h('option', { value: f.id }, f.name))];
  sel.replaceChildren(...opts);
  sel.value = fid && data.noteFolders.has(fid) ? fid : '';
  const ta = $('note-text');
  if (document.activeElement !== ta) ta.value = note ? note.text : (state.newNote.text || '');
  const pinBtn = $('btn-note-pin');
  pinBtn.querySelector('span').textContent = note && note.pinned ? 'Открепить' : 'Закрепить';
  pinBtn.disabled = !note;
  $('btn-note-delete').disabled = !note;
}
function openNote(id) {
  flushNote();
  state.noteId = id;
  state.newNote = null;
  if (state.notesMode !== 'editor') {
    state.notesMode = 'editor';
    if (root.dataset.layout === 'narrow') pushBack(() => { flushNote(); state.notesMode = 'list'; renderNotes(); saveUI(); });
  }
  $('save-status').textContent = '';
  renderNotes(); saveUI();
  window.scrollTo(0, 0);
}
$('btn-new-note').addEventListener('click', () => {
  flushNote();
  const id = uid();
  state.newNote = { id, folderId: state.folderId, text: '' };
  state.noteId = id;
  if (state.notesMode !== 'editor') {
    state.notesMode = 'editor';
    if (root.dataset.layout === 'narrow') pushBack(() => { flushNote(); state.notesMode = 'list'; renderNotes(); saveUI(); });
  }
  $('save-status').textContent = '';
  renderNotes();
  $('note-text').value = '';
  setTimeout(() => $('note-text').focus(), 30);
});
$('btn-to-list').addEventListener('click', () => {
  if (backStack.length && state.notesMode === 'editor') history.back();
  else { flushNote(); state.notesMode = 'list'; renderNotes(); saveUI(); }
});
$('notes-search').addEventListener('input', (e) => { state.query = e.target.value; renderNotesListOnly(); saveUI(); });
function renderNotesListOnly() {
  const active = document.activeElement;
  renderNotes();
  if (active && active.id === 'notes-search') active.focus();
}
$('note-text').addEventListener('input', () => {
  const text = $('note-text').value;
  writeDraft(text);
  pendingSave = true;
  $('save-status').textContent = 'Сохраняю…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushNote, SAVE_DELAY);
});
$('note-folder').addEventListener('change', async (e) => {
  const fid = e.target.value || null;
  if (state.newNote && state.newNote.id === state.noteId) { state.newNote.folderId = fid; return; }
  const n = data.notes.get(state.noteId);
  if (n) { await apply([{ store: 'notes', put: { ...n, folderId: fid, updatedAt: now().toISOString() } }]); toast(fid ? `Заметка перемещена в «${data.noteFolders.get(fid).name}»` : 'Заметка перемещена во «Все»'); }
});
$('btn-note-pin').addEventListener('click', () => {
  const n = data.notes.get(state.noteId);
  if (n) apply([{ store: 'notes', put: { ...n, pinned: !n.pinned } }]);
});
$('btn-note-delete').addEventListener('click', async () => {
  const n = data.notes.get(state.noteId);
  if (!n) return;
  const yes = await dialogs.confirm('Удалить заметку?', L.noteHead(n.text).title, 'Удалить', true);
  if (!yes) return;
  clearTimeout(saveTimer); pendingSave = false; ls.del('draft');
  state.noteId = null;
  if (root.dataset.layout === 'narrow' && state.notesMode === 'editor') {
    state.notesMode = 'list';
    if (backStack.length) popBackSilently();
  }
  await apply([{ store: 'notes', del: n.id }], { undo: 'Заметка удалена' });
});
function writeDraft(text) {
  const isNew = state.newNote && state.newNote.id === state.noteId;
  ls.set('draft', JSON.stringify({ id: state.noteId, text, folderId: isNew ? state.newNote.folderId : (data.notes.get(state.noteId)?.folderId ?? null), isNew: !!isNew, ts: Date.now() }));
}
/** Сохранить текущую заметку немедленно */
async function flushNote() {
  clearTimeout(saveTimer);
  if (!pendingSave || !state.noteId) { pendingSave = false; return; }
  const text = $('note-text').value;
  const id = state.noteId;
  const n = now().toISOString();
  const existing = data.notes.get(id);
  pendingSave = false;
  if (!existing) {
    if (!text.trim()) { ls.del('draft'); $('save-status').textContent = ''; return; } // пустая новая не сохраняется
    const minOrder = Math.min(0, ...notesArr().filter((x) => !x.pinned).map((x) => x.order ?? 0));
    const rec = { id, text, pinned: false, order: minOrder - 1, folderId: state.newNote ? state.newNote.folderId : null, createdAt: n, updatedAt: n };
    state.newNote = null;
    if (await apply([{ store: 'notes', put: rec }])) { ls.del('draft'); $('save-status').textContent = 'Сохранено'; }
    return;
  }
  if (existing.text === text) { ls.del('draft'); $('save-status').textContent = 'Сохранено'; return; }
  if (await apply([{ store: 'notes', put: { ...existing, text, updatedAt: n } }])) { ls.del('draft'); $('save-status').textContent = 'Сохранено'; }
}
async function moveNote(list, i, dir) {
  const a = list[i], b = list[i + dir];
  if (!a || !b) return;
  let oa = a.order ?? 0, ob = b.order ?? 0;
  if (oa === ob) ob = oa + dir;
  await apply([{ store: 'notes', put: { ...a, order: ob } }, { store: 'notes', put: { ...b, order: oa } }]);
}
async function createFolder() {
  const name = await dialogs.prompt('Новая папка', 'Название папки', '', 'Создать', (v) => L.validateFolderName(v, foldersArr()));
  if (!name) return;
  const maxOrder = Math.max(0, ...foldersArr().map((f) => f.order ?? 0));
  const rec = { id: uid(), name, order: maxOrder + 1, createdAt: now().toISOString() };
  if (await apply([{ store: 'noteFolders', put: rec }])) { state.folderId = rec.id; renderNotes(); saveUI(); toast(`Папка «${name}» создана`); }
}
$('btn-folder-rename').addEventListener('click', async () => {
  const f = data.noteFolders.get(state.folderId);
  if (!f) return;
  const name = await dialogs.prompt('Переименовать папку', 'Название папки', f.name, 'Сохранить', (v) => L.validateFolderName(v, foldersArr(), f.id));
  if (name) apply([{ store: 'noteFolders', put: { ...f, name } }]);
});
$('btn-folder-delete').addEventListener('click', async () => {
  const f = data.noteFolders.get(state.folderId);
  if (!f) return;
  const inside = notesArr().filter((n) => n.folderId === f.id);
  const yes = await dialogs.confirm(`Удалить папку «${f.name}»?`,
    inside.length ? `Заметки не удалятся: ${L.pluralN(inside.length, 'заметка вернётся', 'заметки вернутся', 'заметок вернутся')} во «Все».` : 'Папка пустая.', 'Удалить папку', true);
  if (!yes) return;
  const changes = inside.map((n) => ({ store: 'notes', put: { ...n, folderId: null } }));
  changes.push({ store: 'noteFolders', del: f.id });
  state.folderId = null;
  await apply(changes, { undo: `Папка «${f.name}» удалена` });
});

// ---------- МЕНЮ ----------
function applyScale(s) {
  s = Math.round(Math.min(1.5, Math.max(0.5, s)) * 10) / 10;
  root.style.setProperty('--scale', String(s));
  ls.set('scale', String(s));
  $('scale-value').textContent = `${Math.round(s * 100)}%`;
  updateLayout();
  requestAnimationFrame(fitHeaderDeco);
}
const curScale = () => parseFloat(getComputedStyle(root).getPropertyValue('--scale')) || 1;
$('scale-minus').addEventListener('click', () => applyScale(curScale() - 0.1));
$('scale-plus').addEventListener('click', () => applyScale(curScale() + 0.1));
$('scale-reset').addEventListener('click', () => applyScale(1));
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
// Праздничные темы: цвет системной строки и тёмная ли тема
const FESTIVE = { halloween: ['#140B1A', true], newyear: ['#0B1630', true], patrick: ['#0E2214', true] };
function applyTheme(pref) {
  ls.set('theme', pref);
  const fest = FESTIVE[pref];
  const dark = fest ? fest[1] : (pref === 'dark' || (pref === 'auto' && darkMQ.matches));
  root.dataset.theme = fest ? pref : (dark ? 'dark' : 'light');
  root.dataset.themePref = pref;
  root.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').setAttribute('content', fest ? fest[0] : (dark ? '#0E1716' : '#0B4F4A'));
  for (const b of document.querySelectorAll('#theme-seg [data-theme-v]')) b.setAttribute('aria-checked', String(b.dataset.themeV === pref));
  requestAnimationFrame(fitHeaderDeco);
}
darkMQ.addEventListener('change', () => { if ((ls.get('theme') || 'auto') === 'auto') applyTheme('auto'); });
$('theme-seg').addEventListener('click', (e) => { const b = e.target.closest('[data-theme-v]'); if (b) applyTheme(b.dataset.themeV); });

function renderMenu() {
  if (state.view !== 'menu') return;
  $('scale-value').textContent = `${Math.round(curScale() * 100)}%`;
  for (const b of document.querySelectorAll('#theme-seg [data-theme-v]')) b.setAttribute('aria-checked', String(b.dataset.themeV === (ls.get('theme') || 'auto')));
  const last = ls.get('lastBackup');
  $('backup-last').textContent = last ? `Последняя копия: ${L.formatShortDate(L.toISO(new Date(Number(last))), today())}` : 'Копию ещё не сохраняли.';
  $('card-install').hidden = isInstalled();
}

// ---------- Резервная копия ----------
const allData = () => Object.fromEntries(L.BACKUP_SECTIONS.map((k) => [k, [...data[k].values()]]));
const totalRecords = () => L.countRecords(allData());
$('btn-backup').addEventListener('click', saveBackup);
async function saveBackup() {
  await flushNote();
  const json = JSON.stringify(L.makeBackup(allData(), now()), null, 1);
  const name = `planner-backup-${today()}`;
  const done = () => {
    ls.set('lastBackup', String(Date.now())); ls.del('backupSnooze');
    renderMenu(); checkBackupBanner();
  };
  if (native.available) {
    const r = await native.shareBackup(json, name);
    if (r === 'ok') { done(); toast('Копия сохранена'); return; }
    if (r === 'documents') { done(); toast('Копия сохранена в «Документы» → Planner'); return; }
    if (r === 'cancel') return;
  }
  const tryShare = async (file) => {
    if (!navigator.canShare || !navigator.canShare({ files: [file] })) return 'unsupported';
    try { await navigator.share({ files: [file], title: 'Резервная копия Планировщика', text: 'Резервная копия записей Планировщика' }); return 'ok'; } catch (e) { return e && e.name === 'AbortError' ? 'cancel' : 'unsupported'; }
  };
  let r = await tryShare(new File([json], `${name}.json`, { type: 'application/json' }));
  if (r === 'unsupported') r = await tryShare(new File([json], `${name}.txt`, { type: 'text/plain' }));
  if (r === 'ok') { done(); toast('Копия сохранена'); return; }
  if (r === 'cancel') return;
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = h('a', { href: url, download: `${name}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  done();
  toast('Копия сохранена в «Загрузки»');
}
$('btn-restore').addEventListener('click', () => $('restore-file').click());
$('restore-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (file.size > 20 * 1048576) { dialogs.info('Не удалось восстановить', [h('p', {}, 'Файл слишком большой для резервной копии Планировщика. Проверьте, что выбран правильный файл.')]); return; }
  let text = '';
  try { text = await file.text(); } catch { dialogs.info('Не удалось открыть файл', [h('p', {}, 'Попробуйте выбрать файл ещё раз.')]); return; }
  const res = L.parseBackup(text);
  if (!res.ok) { dialogs.info('Не удалось восстановить', [h('p', {}, res.error)]); return; }
  const count = L.countRecords(res.data);
  const when = res.exportedAt ? ` от ${L.formatShortDate(L.toISO(new Date(res.exportedAt)), today())}` : '';
  const text2 = `Записи на телефоне будут заменены данными из копии${when}. В копии: ${L.pluralN(count, 'запись', 'записи', 'записей')}, сейчас на телефоне: ${L.pluralN(totalRecords(), 'запись', 'записи', 'записей')}.` +
    (res.skipped ? ` Повреждённых записей в файле: ${res.skipped} — они будут пропущены.` : '');
  const yes = await dialogs.confirm('Восстановить из копии?', text2, 'Заменить записи', false);
  if (!yes) return;
  await flushNote();
  const snapshot = Object.fromEntries(res.sections.map((s) => [s, [...data[s].values()]]));
  try { await db.replace(res.data); } catch (err) { console.error(err); toast('Не удалось восстановить. Записи не изменены.'); return; }
  for (const s of res.sections) data[s] = new Map(res.data[s].map((r) => [r.id, r]));
  state.noteId = null; state.newNote = null; state.folderId = null;
  renderAll();
  native.reschedule();
  toast(`Восстановлено: ${L.pluralN(count, 'запись', 'записи', 'записей')}${res.skipped ? `, пропущено: ${res.skipped}` : ''}`, {
    undo: async () => {
      await db.replace(snapshot);
      for (const s of Object.keys(snapshot)) data[s] = new Map(snapshot[s].map((r) => [r.id, r]));
      renderAll();
    },
  });
});

// ---------- Справки ----------
const ua = navigator.userAgent;
const isXiaomiBrowser = /MiuiBrowser|XiaoMi\/MiuiBrowser|HyperOSBrowser/i.test(ua);
const isXiaomiPhone = isXiaomiBrowser || /Xiaomi|Redmi|POCO|MI \d|M2\d{3}|2\d{3}[A-Z0-9]{4,}/i.test(ua);
const isChrome = /Chrome\/\d/.test(ua) && !/MiuiBrowser|EdgA|OPR|SamsungBrowser|YaBrowser|Firefox/i.test(ua);
const isStandalone = () => native.available || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const chromeIntent = () => `intent://${location.host}${location.pathname}#Intent;scheme=https;package=com.android.chrome;end`;

function steps(items) { return h('ol', {}, items.map((s) => h('li', {}, s))); }
function installHelp() {
  const nodes = [];
  if (isXiaomiBrowser) {
    nodes.push(h('p', {}, 'Сейчас приложение открыто во встроенном браузере Xiaomi. Лучше установить его через Chrome — так оно надёжнее работает без интернета.'));
    nodes.push(h('a', { class: 'btn primary wide', href: chromeIntent() }, 'Открыть в Chrome'));
    nodes.push(h('p', { class: 'hint warn' }, 'Записи в браузере Xiaomi и в Chrome хранятся отдельно. Выберите один браузер до того, как начнёте вести записи.'));
  }
  nodes.push(h('h3', {}, 'Chrome на Android'));
  nodes.push(steps(['Нажмите ⋮ (три точки) справа вверху.', 'Выберите «Установить приложение» или «Добавить на главный экран».', 'Нажмите «Установить».']));
  nodes.push(h('h3', {}, 'Браузер Xiaomi'));
  nodes.push(steps(['Нажмите на кнопку меню внизу экрана.', 'Выберите «Добавить на главный экран» (или «Добавить ярлык»).', 'Подтвердите добавление.']));
  nodes.push(h('h3', {}, 'Xiaomi: если значок не появился'));
  nodes.push(h('p', {}, 'На телефонах Xiaomi у браузера часто выключено разрешение на ярлыки.'));
  nodes.push(steps(['Откройте «Настройки» телефона.', 'Перейдите: Приложения → Все приложения → Chrome.', 'Откройте «Другие разрешения».', 'Включите «Ярлыки на рабочем столе».', 'Повторите установку.']));
  dialogs.info('Как установить', nodes);
}
$('btn-install-help').addEventListener('click', installHelp);
$('btn-remind-help').addEventListener('click', async () => {
  if (native.available) { nativeRemindHelp(); return; }
  dialogs.info('Уведомления и напоминания', [
    h('p', {}, 'Напоминания срабатывают, только пока приложение открыто: звук, вибрация и окно на экране.'),
    h('p', {}, 'Режим энергосбережения Xiaomi может закрывать приложение в фоне — тогда напоминание не придёт. Важные дела лучше продублировать будильником.'),
    h('h3', {}, 'Как разрешить уведомления на Xiaomi'),
    steps(['Откройте «Настройки» → «Уведомления и Центр управления» → «Уведомления приложений».', 'Найдите Chrome (или «Планировщик») и включите уведомления.', 'Включите «Всплывающие уведомления» и «Звук».', 'В «Настройки» → Приложения → Chrome → «Контроль активности» выберите «Нет ограничений».']),
    h('p', { class: 'hint' }, 'Названия пунктов могут немного отличаться в зависимости от версии HyperOS или MIUI.'),
  ]);
});
async function nativeRemindHelp() {
  const st = await native.status();
  const okLine = (ok, text) => h('p', { class: ok ? '' : 'field-error' }, ok ? `✓ ${text}: включено` : `✗ ${text}: выключено`);
  dialogs.info('Уведомления и напоминания', [
    h('p', {}, 'Напоминания приходят, даже когда приложение закрыто: звук, вибрация и всплывающее окно. За 15 минут до дела и в 9:00 накануне и в день рождения. Интернет не нужен.'),
    okLine(st.notifications, 'Уведомления'),
    okLine(st.exact, 'Точное время (будильники и напоминания)'),
    !st.notifications ? h('button', { class: 'btn primary wide', type: 'button', on: { click: async () => { await native.requestPermission(); dialogs.close($('dlg-info')); setTimeout(nativeRemindHelp, 300); } } }, 'Разрешить уведомления') : null,
    !st.exact ? h('button', { class: 'btn primary wide', type: 'button', on: { click: () => native.openExactSettings() } }, 'Разрешить точное время') : null,
    h('h3', {}, 'Xiaomi: чтобы напоминания не опаздывали'),
    steps([
      'Нажмите и подержите значок «Планировщик» → «О приложении».',
      'Включите «Автозапуск».',
      '«Контроль активности» (или «Батарея») → «Нет ограничений».',
      '«Уведомления» → включите «Всплывающие уведомления», «Звук» и «Экран блокировки».',
    ]),
    h('p', { class: 'hint' }, 'Названия пунктов могут немного отличаться в зависимости от версии HyperOS или MIUI.'),
  ].filter(Boolean));
}
$('btn-storage-info').addEventListener('click', async () => {
  const est = await storageEstimate();
  const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted().catch(() => false) : false;
  const mb = (b) => (b / 1048576).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
  dialogs.info('Где хранятся записи', [
    h('p', {}, 'Все записи хранятся только на этом телефоне, внутри браузера. На сервер и в облако ничего не отправляется. На другом телефоне их не будет.'),
    h('h3', {}, 'Когда записи могут пропасть'),
    h('ul', {}, [
      'если очистить данные браузера (Chrome → Настройки → Конфиденциальность → Очистить историю, с галочкой «Файлы cookie и данные сайтов»);',
      'если запустить «Очистку» в приложении Xiaomi «Безопасность» и выбрать данные браузера;',
      'если удалить браузер или сбросить телефон;',
      'если телефон потеряется или сломается.',
    ].map((s) => h('li', {}, s))),
    h('p', {}, h('b', {}, 'Единственная защита — резервная копия.'), ' Сохраняйте её себе в мессенджер или на почту хотя бы раз в месяц.'),
    h('h3', {}, 'Сейчас'),
    h('p', {}, `Записей: ${totalRecords()}.${est ? ` Занято места: ${mb(est.usage || 0)} МБ.` : ''} ${persisted ? 'Браузер обещал не удалять записи сам.' : ''}`),
    db && db.memory ? h('p', { class: 'field-error' }, 'Хранилище браузера недоступно: записи сейчас не сохраняются после закрытия.') : null,
  ].filter(Boolean));
});

// ---------- Баннеры (не больше одного) ----------
let installEvt = null;
let swWaiting = null;
let nativePerm = null;
let updateRequested = false;
let bannerKind = null;
const session = { installLater: false, updateLater: false };
function showBanner(kind, text, actions, danger = false) {
  bannerKind = kind;
  const area = $('banner-area');
  area.replaceChildren(h('div', { class: `banner${danger ? ' danger' : ''}`, attrs: { role: danger ? 'alert' : 'status' } },
    h('span', {}, text),
    actions.length ? h('div', { class: 'banner-actions' }, actions.map((a) => h('button', { class: `btn${a.primary ? ' primary' : ''}`, type: 'button', on: { click: a.fn } }, a.label))) : null));
}
function clearBanner() { bannerKind = null; $('banner-area').replaceChildren(); }
function updateBanners() {
  if (db && db.memory) {
    showBanner('storage', 'Хранилище браузера недоступно. Записи не сохранятся после закрытия приложения. Перезапустите браузер или телефон.', [], true);
    return;
  }
  if (swWaiting && !session.updateLater && !pendingSave && !document.querySelector('dialog[open]')) {
    showBanner('update', 'Доступна новая версия. Ваши записи сохранятся.', [
      { label: 'Обновить', primary: true, fn: applyUpdate },
      { label: 'Позже', fn: () => { session.updateLater = true; ls.set('updateLater', String(Date.now())); updateBanners(); } },
    ]);
    return;
  }
  if (!isInstalled() && !session.installLater && Number(ls.get('installLater') || 0) < Date.now() - 7 * 864e5) {
    if (isXiaomiBrowser && !installEvt) {
      showBanner('install', 'Вы открыли приложение в браузере Xiaomi. Лучше открыть его в Chrome и установить оттуда: записи в двух браузерах хранятся отдельно.', [
        { label: 'Открыть в Chrome', primary: true, fn: () => { location.href = chromeIntent(); } },
        { label: 'Как установить', fn: installHelp },
        { label: 'Позже', fn: installLater },
      ]);
      return;
    }
    showBanner('install', 'Установите Планировщик на телефон — значок появится на главном экране, приложение будет открываться одним нажатием и работать без интернета.', [
      { label: 'Установить', primary: true, fn: doInstall },
      { label: 'Позже', fn: installLater },
    ]);
    return;
  }
  if (native.available && nativePerm && (!nativePerm.notifications || !nativePerm.exact) && !session.permLater) {
    showBanner('perm', !nativePerm.notifications
      ? 'Разрешите уведомления — тогда напоминания будут приходить, даже когда приложение закрыто.'
      : 'Разрешите «Будильники и напоминания» — иначе Android может сдвигать время напоминаний.', [
      { label: 'Разрешить', primary: true, fn: async () => {
        if (!nativePerm.notifications) await native.requestPermission(); else await native.openExactSettings();
        nativePerm = await native.status(); updateBanners();
      } },
      { label: 'Позже', fn: () => { session.permLater = true; updateBanners(); } },
    ]);
    return;
  }
  if (backupDue()) {
    const never = !ls.get('lastBackup');
    showBanner('backup', never ? 'Сохраните резервную копию записей себе в мессенджер — это единственная защита, если с телефоном что-то случится.' : 'Резервную копию не сохраняли больше месяца. Сохраните новую.', [
      { label: 'Сохранить копию', primary: true, fn: saveBackup },
      { label: 'Позже', fn: () => { ls.set('backupSnooze', String(Date.now())); updateBanners(); } },
    ]);
    return;
  }
  if (bannerKind) clearBanner();
}
function backupDue() {
  const n = totalRecords();
  if (!n) return false;
  const snooze = Number(ls.get('backupSnooze') || 0);
  if (snooze > Date.now() - 3 * 864e5) return false;
  const last = Number(ls.get('lastBackup') || 0);
  if (!last) return n >= 5; // после первых записей
  return last < Date.now() - 30 * 864e5;
}
function checkBackupBanner() { updateBanners(); }
function installLater() { session.installLater = true; ls.set('installLater', String(Date.now())); updateBanners(); }
/** Установлено ли приложение: открыто как приложение или уже установлено из этого браузера */
function isInstalled() { return isStandalone() || ls.get('installed') === '1'; }
/** Кнопки «Установить» видны, пока приложение не установлено, и пропадают после установки */
function syncInstallUI() {
  requestAnimationFrame(fitHeaderDeco);
  const installed = isInstalled();
  $('btn-install-head').hidden = installed;
  $('card-install').hidden = installed;
  if (installed && bannerKind === 'install') clearBanner();
}
async function doInstall() {
  if (!installEvt) { installHelp(); return; } // браузер не умеет ставить одной кнопкой — показываем инструкцию
  const evt = installEvt;
  installEvt = null;
  evt.prompt();
  const r = await evt.userChoice.catch(() => null);
  if (r && r.outcome === 'accepted') { ls.set('installed', '1'); toast('Приложение устанавливается — значок появится на главном экране'); }
  syncInstallUI(); updateBanners(); renderMenu();
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvt = e;
  ls.del('installed'); // Chrome предлагает установку только если приложения нет (например, его удалили)
  syncInstallUI(); updateBanners(); renderMenu();
});
window.addEventListener('appinstalled', () => { ls.set('installed', '1'); installEvt = null; syncInstallUI(); updateBanners(); renderMenu(); });
matchMedia('(display-mode: standalone)').addEventListener('change', () => { syncInstallUI(); updateBanners(); });
$('btn-install-head').addEventListener('click', doInstall);
$('btn-install-menu').addEventListener('click', doInstall);

// ---------- Service Worker и обновления ----------
async function registerSW() {
  if (native.available || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    const track = (w) => {
      if (!w) return;
      w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) { swWaiting = w; updateBanners(); } });
    };
    if (reg.waiting && navigator.serviceWorker.controller) { swWaiting = reg.waiting; updateBanners(); }
    reg.addEventListener('updatefound', () => track(reg.installing));
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    let reloading = false;
    // Перезагрузка только после нажатия «Обновить» (при первой установке SW просто берёт управление).
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading || !updateRequested) return; reloading = true; location.reload(); });
  } catch (e) { console.warn('SW', e); }
}
async function applyUpdate() {
  await flushNote();
  if (pendingSave) { toast('Сначала сохраняю записи…'); return; }
  saveUI();
  updateRequested = true;
  if (swWaiting) swWaiting.postMessage({ type: 'SKIP_WAITING' });
}

// ---------- Напоминания (по таймеру) ----------
let lastToday = today();
function tick() {
  const n = now();
  const t = L.toISO(n);
  if (t !== lastToday) {
    // смена суток: если был выбран «сегодня» — переходим на новый день
    if (state.date === lastToday && state.mode === 'day') state.date = t;
    if (state.shopDate === lastToday) state.shopDate = t;
    lastToday = t;
    renderAll();
  } else if (state.view === 'plan' && state.mode === 'day' && n.getHours() === L.OVERDUE_HOUR && n.getMinutes() === 0) {
    renderPlan();
  }
  for (const task of L.dueReminders(tasksArr(), n, reminded.get())) {
    reminded.mark(L.remindKey(task, t));
    alertBox('Скоро начало', `${L.formatTime(task.time)} — ${task.title}`);
  }
  bd.checkReminders(n);
}

// ---------- Отрисовка ----------
function renderAll() {
  renderPlan();
  renderShop();
  renderNotes();
  if (state.view === 'bd') bd.render();
  renderMenu();
}

// ---------- Запуск ----------
async function start() {
  loadUI();
  db = await openDB({
    onVersionChange: () => {
      // Другая вкладка открыла новую версию: сохраняем черновик и перезагружаемся.
      if (pendingSave) writeDraft($('note-text').value);
      saveUI();
      location.reload();
    },
  });
  requestPersistence();
  for (const s of Object.keys(data)) {
    try { data[s] = new Map((await db.all(s)).map((r) => [r.id, r])); } catch (e) { console.warn(s, e); }
  }
  // Восстановление черновика заметки после сбоя
  const draft = ls.json('draft', null);
  if (draft && draft.id && typeof draft.text === 'string') {
    const ex = data.notes.get(draft.id);
    if ((!ex && draft.text.trim()) || (ex && ex.text !== draft.text)) {
      const n = new Date().toISOString();
      const rec = ex ? { ...ex, text: draft.text, updatedAt: n }
        : { id: draft.id, text: draft.text, pinned: false, order: Math.min(0, ...[...data.notes.values()].map((x) => x.order ?? 0)) - 1, folderId: draft.folderId || null, createdAt: n, updatedAt: n };
      try { await db.put('notes', rec); data.notes.set(rec.id, rec); } catch { /* попробуем позже */ }
    }
    ls.del('draft');
  }
  bd = createBirthdays({ data, apply, toast, dialogs, h, icon, today, now, uid, notify, sound: beep, reminded, alert: alertBox });
  buildTopNav();
  updateLayout();
  applyTheme(ls.get('theme') || 'auto');
  try { const v = await (await fetch('./version.json', { cache: 'no-store' })).json(); $('app-version').textContent = `Версия ${v.version}`; } catch { $('app-version').textContent = ''; }
  if (state.noteId && !data.notes.has(state.noteId)) { state.noteId = null; state.notesMode = 'list'; }
  if (state.mode === 'day' && state.backTo) state.backTo = null; // после перезагрузки история «Назад» сброшена
  setView(state.view || 'plan');
  if (state.scroll) requestAnimationFrame(() => window.scrollTo(0, state.scroll));
  syncInstallUI();
  updateBanners();
  registerSW();
  if (native.available) {
    nativePerm = await native.status();
    if (!nativePerm.notifications && (data.tasks.size || data.birthdays.size)) { await native.requestPermission(); nativePerm = await native.status(); }
    updateBanners();
    native.reschedule();
    native.onOpen((date) => { state.mode = 'day'; state.backTo = null; setView('plan'); setPlanDate(date); });
    native.onResume(async () => { nativePerm = await native.status(); updateBanners(); native.reschedule(); tick(); });
  }
  tick();
  setInterval(tick, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { flushNote(); saveUI(); } else tick(); });
  window.addEventListener('pagehide', () => { if (pendingSave) writeDraft($('note-text').value); flushNote(); saveUI(); });
  window.addEventListener('scroll', () => { clearTimeout(start._s); start._s = setTimeout(saveUI, 300); }, { passive: true });
  document.addEventListener('close', () => updateBanners(), true);
  navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data && e.data.type === 'OPEN') window.focus(); });
  if (IS_TEST_HOST) window.__planner = { data, state, db, apply, renderAll }; // только для автотестов
}
start();
