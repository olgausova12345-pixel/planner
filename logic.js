// logic.js — чистые функции без DOM: даты, повторы, перенос, просрочка,
// напоминания, производственный календарь РТ, дни рождения, резервная копия.

export const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MONTHS_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
// Неделя с понедельника: индекс 0 = Пн.
export const WEEKDAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
export const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export const TITLE_MAX = 300;
export const FOLDER_MAX = 40;
export const BD_NAME_MAX = 120;
export const BD_NOTE_MAX = 300;
export const OVERDUE_HOUR = 20;
export const REMIND_BEFORE_MIN = 15;
export const BACKUP_FORMAT = 'planner-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_SECTIONS = ['tasks', 'purchases', 'notes', 'vacations', 'birthdays', 'noteFolders'];

// ---------- Даты ----------
const pad = (n) => String(n).padStart(2, '0');

export function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12); // полдень — без сюрпризов с переводом часов
}
export function isISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseISO(s);
  return toISO(d) === s;
}
export function todayISO(now = new Date()) { return toISO(now); }
export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}
export function daysInMonth(y, m0) { return new Date(y, m0 + 1, 0).getDate(); }
export function addMonths(iso, n) {
  const d = parseISO(iso);
  const y = d.getFullYear(), m = d.getMonth() + n, day = d.getDate();
  const t = new Date(y, m, 1, 12);
  t.setDate(Math.min(day, daysInMonth(t.getFullYear(), t.getMonth())));
  return toISO(t);
}
/** День недели, Пн = 0 … Вс = 6 */
export function weekday(iso) { return (parseISO(iso).getDay() + 6) % 7; }
export function startOfWeek(iso) { return addDays(iso, -weekday(iso)); }
export function weekDates(iso) {
  const s = startOfWeek(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}
/** Сетка месяца 7×N с понедельника. Возвращает массив недель, ячейка — ISO или null вне месяца. */
export function monthGrid(year, month0) {
  const first = toISO(new Date(year, month0, 1, 12));
  const lead = weekday(first);
  const n = daysInMonth(year, month0);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= n; d++) cells.push(toISO(new Date(year, month0, d, 12)));
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
export function minutesOf(time) {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}
export function nowMinutes(now) { return now.getHours() * 60 + now.getMinutes(); }
/** Варианты времени 9:00–19:00 с шагом 30 минут */
export const DAY_START = 7 * 60;
export const DAY_END = 21 * 60;
const slots = (step) => { const out = []; for (let m = DAY_START; m <= DAY_END; m += step) out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`); return out; };
/** Варианты времени в окне дела: 7:00–21:00 с шагом 15 минут */
export function timeSlots() { return slots(15); }
/** Строки шторки «По часам»: 7:00–21:00 через 30 минут (дела на другое время получают свою строку) */
export function hourSlots() { return slots(30); }
export function isValidTime(t) { return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t); }
export function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  return `${Number(h)}:${m}`;
}

// ---------- Склонения и подписи ----------
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
export const pluralN = (n, one, few, many) => `${n} ${plural(n, one, few, many)}`;

export function relativeLabel(iso, today) {
  if (iso === today) return 'Сегодня';
  if (iso === addDays(today, 1)) return 'Завтра';
  if (iso === addDays(today, -1)) return 'Вчера';
  return '';
}
/** «Понедельник, 26 октября»; год — только если не текущий */
export function formatDayTitle(iso, today) {
  const d = parseISO(iso);
  const t = parseISO(today);
  let s = `${WEEKDAYS[weekday(iso)]}, ${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
  if (d.getFullYear() !== t.getFullYear()) s += ` ${d.getFullYear()}`;
  return s;
}
export function formatShortDate(iso, today) {
  const d = parseISO(iso);
  let s = `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
  if (today && d.getFullYear() !== parseISO(today).getFullYear()) s += ` ${d.getFullYear()}`;
  return s;
}
export function formatWeekTitle(iso, today) {
  const days = weekDates(iso);
  const a = parseISO(days[0]), b = parseISO(days[6]);
  const yr = parseISO(today).getFullYear();
  const yearSuffix = b.getFullYear() !== yr ? ` ${b.getFullYear()}` : '';
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${MONTHS_GEN[b.getMonth()]}${yearSuffix}`;
  return `${a.getDate()} ${MONTHS_GEN[a.getMonth()]} – ${b.getDate()} ${MONTHS_GEN[b.getMonth()]}${yearSuffix}`;
}
export function formatMonthTitle(iso, today) {
  const d = parseISO(iso);
  const yr = parseISO(today).getFullYear();
  return `${MONTHS_NOM[d.getMonth()]}${d.getFullYear() !== yr ? ' ' + d.getFullYear() : ''}`;
}
/** Схлопывание пробелов и обрезка до max */
export function normalizeTitle(s, max = TITLE_MAX) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// ---------- Повторы ----------
export function repeatLabel(repeat, startIso) {
  if (!repeat) return '';
  let s = '';
  switch (repeat.kind) {
    case 'daily': s = 'Каждый день'; break;
    case 'weekdays': s = 'По будням'; break;
    case 'days': s = (repeat.days || []).slice().sort((a, b) => a - b).map((i) => WEEKDAYS_SHORT[i]).join(', '); break;
    case 'monthly': s = `Каждый месяц, ${parseISO(startIso).getDate()}-го`; break;
    default: return '';
  }
  if (repeat.until) s += `, до ${formatShortDate(repeat.until)}`;
  return s;
}
/** Есть ли дело в этот день */
export function occursOn(task, iso) {
  if (!task.repeat) return task.date === iso;
  if (iso < task.date) return false;
  if (isISODate(task.repeat.until) && iso > task.repeat.until) return false;
  if (Array.isArray(task.skip) && task.skip.includes(iso)) return false;
  const wd = weekday(iso);
  switch (task.repeat.kind) {
    case 'daily': return true;
    case 'weekdays': return wd < 5;
    case 'days': return Array.isArray(task.repeat.days) && task.repeat.days.includes(wd);
    case 'monthly': return parseISO(iso).getDate() === parseISO(task.date).getDate();
    default: return false;
  }
}
export function isDoneOn(task, iso) {
  return task.repeat ? (Array.isArray(task.doneDates) && task.doneDates.includes(iso)) : !!task.done;
}
/** Отметка выполнения: возвращает изменённую копию */
export function setDoneOn(task, iso, done) {
  const t = { ...task };
  if (t.repeat) {
    const set = new Set(t.doneDates || []);
    done ? set.add(iso) : set.delete(iso);
    t.doneDates = [...set].sort();
  } else t.done = !!done;
  return t;
}
/** Порядок дня: невыполненные без времени → со временем по часам → выполненные без времени */
export function sortDayTasks(items, iso) {
  const bySeq = (a, b) => (a.seq ?? 0) - (b.seq ?? 0) || String(a.createdAt).localeCompare(String(b.createdAt));
  const noTimeOpen = items.filter((t) => !t.time && !isDoneOn(t, iso)).sort(bySeq);
  const timed = items.filter((t) => t.time).sort((a, b) => minutesOf(a.time) - minutesOf(b.time) || bySeq(a, b));
  const noTimeDone = items.filter((t) => !t.time && isDoneOn(t, iso)).sort(bySeq);
  return [...noTimeOpen, ...timed, ...noTimeDone];
}
export function tasksForDate(tasks, iso) {
  return sortDayTasks(tasks.filter((t) => occursOn(t, iso)), iso);
}
export function dayStats(tasks, iso) {
  const list = tasks.filter((t) => occursOn(t, iso));
  return { total: list.length, done: list.filter((t) => isDoneOn(t, iso)).length };
}

// ---------- Просрочка и перенос ----------
/** Просрочено = не выполнено и день прошёл, или сегодня после 20:00 */
export function isOverdue(task, iso, now) {
  if (isDoneOn(task, iso)) return false;
  const today = toISO(now);
  if (iso < today) return true;
  return iso === today && now.getHours() >= OVERDUE_HOUR;
}
/** Куда переносить: с прошедшего дня — на сегодня, иначе — на следующий день */
export function moveTarget(iso, today) {
  return iso < today ? today : addDays(iso, 1);
}
/**
 * План переноса дела с fromIso на toIso.
 * Возвращает { update: задача|null, create: задача|null }.
 * Разовое — меняет дату. Повтор — исходный день в skip + разовая копия (movedFrom),
 * если на целевой дате ещё нет такого же дела (без дублей).
 */
export function planMove(task, fromIso, toIso, allTasks, makeId, now = new Date()) {
  if (!task.repeat) {
    return { update: { ...task, date: toIso, movedFrom: task.movedFrom || fromIso }, create: null };
  }
  const update = { ...task, skip: [...new Set([...(task.skip || []), fromIso])].sort() };
  const dup = allTasks.some((t) => t.id !== task.id && !t.repeat && t.date === toIso &&
    normalizeTitle(t.title).toLowerCase() === normalizeTitle(task.title).toLowerCase() && (t.time || null) === (task.time || null));
  const alreadyRepeats = occursOn(update, toIso);
  if (dup || alreadyRepeats) return { update, create: null };
  const create = {
    id: makeId(), date: toIso, title: task.title, time: task.time || null, done: false,
    remind: !!task.remind, repeat: null, skip: [], doneDates: [], movedFrom: fromIso,
    seq: now.getTime(), createdAt: now.toISOString(),
  };
  return { update, create };
}
/** Удаление повтора: 'one' | 'following' | 'all' → { update } или { remove } */
export function planRepeatDelete(task, iso, mode) {
  if (mode === 'one') return { update: { ...task, skip: [...new Set([...(task.skip || []), iso])].sort() } };
  if (mode === 'following') {
    const until = addDays(iso, -1);
    if (until < task.date) return { remove: true };
    return { update: { ...task, repeat: { ...task.repeat, until } } };
  }
  return { remove: true };
}

// ---------- Напоминания ----------
export function remindKey(task, iso) { return `${task.id}|${iso}|${task.time}`; }
/** Окно [начало − 15 мин; начало), один раз на дело+дату+время */
export function dueReminders(tasks, now, reminded = {}) {
  const iso = toISO(now);
  const cur = nowMinutes(now);
  return tasks.filter((t) => {
    if (!t.remind || !t.time || !occursOn(t, iso) || isDoneOn(t, iso)) return false;
    const start = minutesOf(t.time);
    return cur >= start - REMIND_BEFORE_MIN && cur < start && !reminded[remindKey(t, iso)];
  });
}

// ---------- Производственный календарь Республики Татарстан ----------
// off: нерабочие праздничные и перенесённые выходные; work: рабочие субботы/воскресенья.
// 2026: Постановление Правительства РФ о переносе выходных на 2026 г.; Указ Раиса РТ о датах
//       Ураза-байрама и Курбан-байрама; День Республики 30.08.2026 (вс) — без переноса.
// 2027: Производственный календарь РТ на 2027 г. (245 рабочих дней, 120 выходных); национальные праздники РТ: Ураза-байрам 09.03 (вт),
//       Курбан-байрам 16.05 (вс), День Республики 30.08 (пн), День Конституции РТ 06.11 (сб).
const FIXED = {
  '01-01': 'Новогодние каникулы', '01-02': 'Новогодние каникулы', '01-03': 'Новогодние каникулы',
  '01-04': 'Новогодние каникулы', '01-05': 'Новогодние каникулы', '01-06': 'Новогодние каникулы',
  '01-07': 'Рождество Христово', '01-08': 'Новогодние каникулы',
  '02-23': 'День защитника Отечества', '03-08': 'Международный женский день',
  '05-01': 'Праздник Весны и Труда', '05-09': 'День Победы', '06-12': 'День России',
  '08-30': 'День Республики Татарстан', '11-04': 'День народного единства',
  '11-06': 'День Конституции Республики Татарстан',
};
export const PROD_CALENDAR = {
  2026: {
    holidays: { '03-20': 'Ураза-байрам', '05-27': 'Курбан-байрам' },
    off: {
      '01-09': 'Выходной (перенос с 3 января)', '03-09': 'Выходной (перенос с 8 марта)',
      '05-11': 'Выходной (перенос с 9 мая)', '12-31': 'Выходной (перенос с 4 января)',
    },
    work: {},
  },
  2027: {
    holidays: { '03-09': 'Ураза-байрам', '05-16': 'Курбан-байрам' },
    off: {
      '01-09': 'Новогодние каникулы', '01-10': 'Новогодние каникулы',
      '02-22': 'Выходной (перенос с 20 февраля)', '05-03': 'Выходной (перенос с 1 мая)',
      '05-10': 'Выходной (перенос с 9 мая)', '06-14': 'Выходной (перенос с 12 июня)',
      '11-05': 'Выходной (перенос со 2 января)', '12-31': 'Выходной (перенос с 3 января)',
    },
    work: { '02-20': 'Рабочая суббота (выходной перенесён на 22 февраля)' },
    // Сокращённые на 1 час предпраздничные рабочие дни
    short: ['02-20', '04-30', '06-11', '11-03'],
  },
};
/**
 * Сведения о дне: { holiday, note, off, workingWeekend, short }
 * holiday — название праздника; note — строка переноса; off — нерабочий день.
 */
export function dayInfo(iso) {
  const y = Number(iso.slice(0, 4));
  const md = iso.slice(5);
  const wd = weekday(iso);
  const cal = PROD_CALENDAR[y];
  const holiday = (cal && cal.holidays[md]) || FIXED[md] || null;
  let note = null;
  let off = wd >= 5;
  let workingWeekend = false;
  if (holiday) off = true;
  if (cal) {
    if (cal.off[md]) { off = true; note = cal.off[md]; }
    if (cal.work[md]) { off = false; workingWeekend = true; note = cal.work[md]; }
  }
  const short = !!(cal && cal.short && cal.short.includes(md));
  if (short) note = note ? `${note}, сокращённый день` : 'Сокращённый рабочий день (на 1 час)';
  return { holiday, note, off, workingWeekend, short };
}

// ---------- Дни рождения ----------
export function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
/** День празднования в году: 29.02 в невисокосный год → 28.02 */
export function birthdayInYear(bd, year) {
  if (bd.month === 2 && bd.day === 29 && !isLeap(year)) return { month: 2, day: 28, shifted: true };
  return { month: bd.month, day: bd.day, shifted: false };
}
export function birthdaysOn(list, iso) {
  const d = parseISO(iso);
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  return list.filter((b) => { const x = birthdayInYear(b, y); return x.month === m && x.day === day; });
}
export function ageOn(bd, year) {
  return bd.year ? year - bd.year : null;
}
export function sortBirthdays(list) {
  return list.slice().sort((a, b) => a.month - b.month || a.day - b.day || a.name.localeCompare(b.name, 'ru'));
}
export function validateBirthday({ name, day, month, year, note }, nowYear) {
  const errors = {};
  const n = normalizeTitle(name, BD_NAME_MAX);
  if (!n) errors.name = 'Введите имя';
  const d = Number(day), m = Number(month);
  if (!(m >= 1 && m <= 12)) errors.month = 'Выберите месяц';
  else if (!(d >= 1 && d <= daysInMonth(2024, m - 1))) errors.day = 'В этом месяце нет такого числа';
  let y = null;
  if (year !== '' && year != null) {
    if (!/^\d{4}$/.test(String(year))) errors.year = 'Год — 4 цифры, например 1965';
    else {
      y = Number(year);
      if (y < 1900) errors.year = 'Год не раньше 1900';
      else if (y > nowYear) errors.year = 'Год не может быть в будущем';
      else if (m === 2 && d === 29 && !isLeap(y)) errors.day = `В ${y} году не было 29 февраля`;
    }
  }
  return { ok: !Object.keys(errors).length, errors, value: { name: n, day: d, month: m, year: y, note: normalizeTitle(note, BD_NOTE_MAX) } };
}
/** Какие напоминания о ДР пора показать: с 09:00, «завтра» и «сегодня», по разу */
export function dueBirthdayReminders(list, now, reminded = {}) {
  if (now.getHours() < 9) return [];
  const today = toISO(now), tomorrow = addDays(today, 1);
  const out = [];
  for (const b of list) {
    if (!b.remind) continue;
    if (birthdaysOn([b], today).length && !reminded[`bd|${b.id}|${today}|today`]) out.push({ bd: b, when: 'today', key: `bd|${b.id}|${today}|today` });
    if (birthdaysOn([b], tomorrow).length && !reminded[`bd|${b.id}|${tomorrow}|tomorrow`]) out.push({ bd: b, when: 'tomorrow', key: `bd|${b.id}|${tomorrow}|tomorrow` });
  }
  return out;
}

// ---------- Заметки ----------
export function noteHead(text) {
  const lines = String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
  return { title: lines[0] || 'Пустая заметка', preview: lines.slice(1).join(' ') };
}
/**
 * Видимые заметки. folderId=null — вид «Все»: заметки вне папок (и со ссылкой на удалённую папку).
 * С непустым поиском во «Все» ищем по всем заметкам.
 */
export function visibleNotes(notes, folders, folderId, query) {
  const ids = new Set(folders.map((f) => f.id));
  const q = String(query || '').trim().toLowerCase();
  let list;
  if (folderId) list = notes.filter((n) => n.folderId === folderId);
  else if (q) list = notes.slice();
  else list = notes.filter((n) => !n.folderId || !ids.has(n.folderId));
  if (q) list = list.filter((n) => String(n.text).toLowerCase().includes(q));
  return list.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (a.order ?? 0) - (b.order ?? 0));
}
export function validateFolderName(name, folders, exceptId = null) {
  const n = normalizeTitle(name, 1000);
  if (!n) return { ok: false, error: 'Введите название папки' };
  if (n.length > FOLDER_MAX) return { ok: false, error: `Не длиннее ${FOLDER_MAX} знаков` };
  if (n.toLowerCase() === 'все') return { ok: false, error: 'Это название занято' };
  if (folders.some((f) => f.id !== exceptId && f.name.toLowerCase() === n.toLowerCase())) return { ok: false, error: 'Папка с таким названием уже есть' };
  return { ok: true, value: n };
}

// ---------- Резервная копия ----------
export function makeBackup(data, now = new Date()) {
  const out = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), data: {} };
  for (const k of BACKUP_SECTIONS) out.data[k] = (data[k] || []).map(stripSync);
  return out;
}
const SYNC_FIELDS = ['_mt', 'deleted', 'device'];
function stripSync(r) {
  const o = { ...r };
  for (const f of SYNC_FIELDS) delete o[f];
  return o;
}
const isStr = (v) => typeof v === 'string';
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 100 && v !== '__proto__' && v !== 'constructor' && v !== 'prototype';
const VALIDATORS = {
  tasks: (r) => isId(r.id) && isISODate(r.date) && isStr(r.title) && r.title.trim() !== '' &&
    (r.time == null || /^\d{2}:\d{2}$/.test(r.time)),
  purchases: (r) => isId(r.id) && isISODate(r.date) && isStr(r.title) && r.title.trim() !== '',
  notes: (r) => isId(r.id) && (isStr(r.text) || hasLegacyNoteFields(r)),
  noteFolders: (r) => isId(r.id) && isStr(r.name) && r.name.trim() !== '',
  birthdays: (r) => isId(r.id) && isStr(r.name) && r.name.trim() !== '' && Number.isInteger(Number(r.month)) && Number(r.month) >= 1 && Number(r.month) <= 12 &&
    Number.isInteger(Number(r.day)) && Number(r.day) >= 1 && Number(r.day) <= daysInMonth(2024, Number(r.month) - 1),
  vacations: (r) => isId(r.id) && isISODate(r.start) && isISODate(r.end),
};
function hasLegacyNoteFields(r) {
  return ['title', 'ingredients', 'steps', 'year', 'genre', 'comment'].some((k) => r[k] != null);
}
/** Заметки «Фильмов»/«Рецептов» эталона превращаются в обычный текст */
function normalizeNote(r) {
  const o = stripSync(r);
  const lines = [];
  if (isStr(o.text) && o.text.trim()) lines.push(o.text);
  const extra = [['title', ''], ['year', 'Год: '], ['genre', 'Жанр: '], ['ingredients', 'Ингредиенты:\n'], ['steps', 'Приготовление:\n'], ['comment', '']];
  const parts = [];
  for (const [k, label] of extra) {
    if (o[k] != null && String(o[k]).trim() && !(isStr(o.text) && o.text.includes(String(o[k])))) parts.push(label + String(o[k]).trim());
    delete o[k];
  }
  delete o.kind; delete o.type; delete o.watched; delete o.rating;
  const text = [...(parts.length && !lines.length ? parts : lines.concat(parts))].join('\n');
  return {
    id: o.id, text: text.slice(0, NOTE_MAX), pinned: o.pinned === true, order: Number.isFinite(o.order) ? o.order : 0,
    folderId: isId(o.folderId) ? o.folderId : null,
    createdAt: str(o.createdAt) || new Date(0).toISOString(), updatedAt: str(o.updatedAt) || str(o.createdAt) || new Date(0).toISOString(),
  };
}
// Строгая нормализация: из копии берутся только известные поля нужного типа,
// всё лишнее отбрасывается — подделанный или испорченный файл не может сломать приложение.
const isTime = (t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v, max = 64) => (typeof v === 'string' ? v.slice(0, max) : '');
const isoList = (v) => (Array.isArray(v) ? [...new Set(v.filter(isISODate))].sort().slice(0, 5000) : []);
export const NOTE_MAX = 100000;
export function sanitizeRepeat(rep) {
  if (!rep || typeof rep !== 'object') return null;
  const kind = ['daily', 'weekdays', 'days', 'monthly'].includes(rep.kind) ? rep.kind : null;
  if (!kind) return null;
  const out = { kind };
  if (kind === 'days') {
    out.days = Array.isArray(rep.days) ? [...new Set(rep.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b) : [];
    if (!out.days.length) return null;
  }
  if (isISODate(rep.until)) out.until = rep.until;
  return out;
}
function normalizeRecord(section, r) {
  if (section === 'notes') return normalizeNote(r);
  if (section === 'tasks') {
    return {
      id: r.id, date: r.date, title: normalizeTitle(r.title), time: isTime(r.time) ? r.time : null,
      done: r.done === true, remind: r.remind === true && isTime(r.time), repeat: sanitizeRepeat(r.repeat),
      skip: isoList(r.skip), doneDates: isoList(r.doneDates), movedFrom: isISODate(r.movedFrom) ? r.movedFrom : null,
      seq: num(r.seq), createdAt: str(r.createdAt),
    };
  }
  if (section === 'purchases') {
    return { id: r.id, date: r.date, title: normalizeTitle(r.title), bought: r.bought === true, seq: num(r.seq), createdAt: str(r.createdAt) };
  }
  if (section === 'birthdays') {
    const year = Number(r.year);
    return {
      id: r.id, name: normalizeTitle(r.name, BD_NAME_MAX), day: Number(r.day), month: Number(r.month),
      year: Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null,
      note: typeof r.note === 'string' ? normalizeTitle(r.note, BD_NOTE_MAX) : '', remind: r.remind === true, createdAt: str(r.createdAt),
    };
  }
  if (section === 'noteFolders') return { id: r.id, name: normalizeTitle(r.name, FOLDER_MAX), order: num(r.order), createdAt: str(r.createdAt) };
  if (section === 'vacations') return { id: r.id, start: r.start, end: r.end };
  return null;
}
/**
 * Разбор файла копии. Возвращает { ok, error?, data, skipped, sections }.
 * Разделы, которых нет в файле, отсутствуют в data (их не трогаем).
 * Данные цикла и служебные поля синхронизации пропускаются молча.
 */
export function parseBackup(text) {
  let obj;
  try { obj = typeof text === 'string' ? JSON.parse(text) : text; } catch { return { ok: false, error: 'Файл повреждён или это не резервная копия Планировщика.' }; }
  if (!obj || typeof obj !== 'object' || obj.format !== BACKUP_FORMAT) return { ok: false, error: 'Это не резервная копия Планировщика.' };
  if (typeof obj.version !== 'number' || obj.version > BACKUP_VERSION) return { ok: false, error: 'Копия сделана в более новой версии приложения. Обновите приложение и попробуйте снова.' };
  const src = obj.data && typeof obj.data === 'object' ? obj.data : {};
  const data = {};
  let skipped = 0;
  for (const s of BACKUP_SECTIONS) {
    if (!Array.isArray(src[s])) continue;
    const seen = new Set();
    data[s] = [];
    for (const r of src[s]) {
      if (!r || typeof r !== 'object' || r.deleted === true) { if (!(r && r.deleted === true)) skipped++; continue; }
      if (!VALIDATORS[s](r) || seen.has(r.id)) { skipped++; continue; }
      seen.add(r.id);
      data[s].push(normalizeRecord(s, r));
    }
  }
  return { ok: true, data, skipped, sections: Object.keys(data), exportedAt: obj.exportedAt || null };
}
export function countRecords(data) {
  return BACKUP_SECTIONS.reduce((n, k) => n + (data[k] ? data[k].length : 0), 0);
}

// ---------- Расписание системных уведомлений (Android-версия) ----------
/** Устойчивый числовой id уведомления из строкового ключа (31 бит, > 0) */
export function notificationId(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 1) || 1;
}
/**
 * Ближайшие напоминания на `days` дней вперёд, отсортированные по времени, не больше `max`.
 * Дело: за 15 минут до начала. ДР: накануне и в день, в 09:00.
 * Возвращает [{ id, key, at: Date, title, body, date }].
 */
export function upcomingReminders(tasks, birthdays, now, { days = 14, max = 100 } = {}) {
  const out = [];
  const today = toISO(now);
  const atTime = (iso, minutes) => { const d = parseISO(iso); d.setHours(0, minutes, 0, 0); return d; };
  for (let i = 0; i <= days; i++) {
    const iso = addDays(today, i);
    for (const t of tasks) {
      if (!t.remind || !t.time || !occursOn(t, iso) || isDoneOn(t, iso)) continue;
      const at = atTime(iso, minutesOf(t.time) - REMIND_BEFORE_MIN);
      if (at <= now) continue;
      const key = remindKey(t, iso);
      out.push({ id: notificationId(key), key, at, date: iso, title: 'Скоро начало', body: `${formatTime(t.time)} — ${t.title}` });
    }
    for (const b of birthdays) {
      if (!b.remind || !birthdaysOn([b], iso).length) continue;
      const age = ageOn(b, Number(iso.slice(0, 4)));
      const ageText = age != null ? ` (${pluralN(age, 'год', 'года', 'лет')})` : '';
      for (const [when, dayIso, label] of [['today', iso, 'Сегодня'], ['tomorrow', addDays(iso, -1), 'Завтра']]) {
        const at = atTime(dayIso, 9 * 60);
        if (at <= now) continue;
        const key = `bd|${b.id}|${iso}|${when}`;
        out.push({ id: notificationId(key), key, at, date: dayIso, title: 'День рождения', body: `${label} день рождения: ${b.name}${ageText}` });
      }
    }
  }
  const seen = new Set();
  return out.sort((a, b) => a.at - b.at).filter((r) => !seen.has(r.id) && seen.add(r.id)).slice(0, max);
}
