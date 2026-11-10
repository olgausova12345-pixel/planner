// Автотесты чистой логики. Запуск: npm test (node --test tests/logic.test.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../logic.js';

let n = 0;
const id = () => `id${++n}`;
const at = (iso, hh = 12, mm = 0) => { const d = L.parseISO(iso); d.setHours(hh, mm, 0, 0); return d; };
const task = (o) => ({ id: id(), title: 'Дело', time: null, done: false, remind: false, repeat: null, skip: [], doneDates: [], seq: 0, createdAt: '', ...o });

test('даты: сложение, месяцы, день недели', () => {
  assert.equal(L.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(L.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(L.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(L.weekday('2026-10-26'), 0); // понедельник
  assert.equal(L.weekday('2026-11-01'), 6); // воскресенье
  assert.equal(L.startOfWeek('2026-10-29'), '2026-10-26');
  assert.ok(L.isISODate('2026-02-28'));
  assert.ok(!L.isISODate('2026-02-30'));
});

test('сетка месяца начинается с понедельника', () => {
  const g = L.monthGrid(2026, 9); // октябрь 2026, 1-е — четверг
  assert.equal(g[0][3], '2026-10-01');
  assert.equal(g[0][0], null);
  assert.ok(g.every((w) => w.length === 7));
  assert.equal(g.flat().filter(Boolean).length, 31);
});

test('подписи и склонения', () => {
  assert.equal(L.formatDayTitle('2026-10-26', '2026-10-29'), 'Понедельник, 26 октября');
  assert.equal(L.formatDayTitle('2027-01-01', '2026-10-29'), 'Пятница, 1 января 2027');
  assert.equal(L.relativeLabel('2026-10-30', '2026-10-29'), 'Завтра');
  assert.equal(L.pluralN(1, 'покупка', 'покупки', 'покупок'), '1 покупка');
  assert.equal(L.pluralN(3, 'покупка', 'покупки', 'покупок'), '3 покупки');
  assert.equal(L.pluralN(5, 'покупка', 'покупки', 'покупок'), '5 покупок');
  assert.equal(L.pluralN(11, 'покупка', 'покупки', 'покупок'), '11 покупок');
  assert.equal(L.pluralN(22, 'покупка', 'покупки', 'покупок'), '22 покупки');
  assert.equal(L.normalizeTitle('  купить   хлеб  '), 'купить хлеб');
  assert.equal(L.normalizeTitle('а'.repeat(400)).length, 300);
});

test('повтор «по будням 9:30 до 30-го»: только Пн–Пт и до даты окончания', () => {
  const t = task({ date: '2026-11-02', time: '09:30', repeat: { kind: 'weekdays', until: '2026-11-30' } });
  assert.ok(L.occursOn(t, '2026-11-02'));
  assert.ok(L.occursOn(t, '2026-11-06'));
  assert.ok(!L.occursOn(t, '2026-11-07'));
  assert.ok(!L.occursOn(t, '2026-11-08'));
  assert.ok(L.occursOn(t, '2026-11-30'));
  assert.ok(!L.occursOn(t, '2026-12-01'));
  assert.ok(!L.occursOn(t, '2026-11-01'));
  const t2 = L.setDoneOn(t, '2026-11-03', true);
  assert.ok(L.isDoneOn(t2, '2026-11-03'));
  assert.ok(!L.isDoneOn(t2, '2026-11-04'));
});

test('повтор «каждый месяц 31-го» пропускает короткие месяцы', () => {
  const t = task({ date: '2026-10-31', repeat: { kind: 'monthly' } });
  assert.ok(L.occursOn(t, '2026-10-31'));
  assert.ok(!L.occursOn(t, '2026-11-30'));
  assert.ok(L.occursOn(t, '2026-12-31'));
  assert.ok(!L.occursOn(t, '2027-02-28'));
});

test('повтор по дням недели и пропуски', () => {
  const t = task({ date: '2026-10-26', repeat: { kind: 'days', days: [0, 2] }, skip: ['2026-10-28'] });
  assert.ok(L.occursOn(t, '2026-10-26'));
  assert.ok(!L.occursOn(t, '2026-10-27'));
  assert.ok(!L.occursOn(t, '2026-10-28'));
  assert.ok(L.occursOn(t, '2026-11-04'));
});

test('порядок дел в дне', () => {
  const a = task({ date: '2026-10-29', title: 'A', seq: 1 });
  const b = task({ date: '2026-10-29', title: 'B', time: '11:00' });
  const c = task({ date: '2026-10-29', title: 'C', time: '09:00' });
  const d = task({ date: '2026-10-29', title: 'D', done: true, seq: 0 });
  const e = task({ date: '2026-10-29', title: 'E', seq: 2 });
  assert.deepEqual(L.tasksForDate([a, b, c, d, e], '2026-10-29').map((t) => t.title), ['A', 'E', 'C', 'B', 'D']);
});

test('просрочка: прошедший день и сегодня после 20:00', () => {
  const t = task({ date: '2026-10-29' });
  assert.ok(!L.isOverdue(t, '2026-10-29', at('2026-10-29', 19, 59)));
  assert.ok(L.isOverdue(t, '2026-10-29', at('2026-10-29', 20, 0)));
  assert.ok(L.isOverdue(t, '2026-10-28', at('2026-10-29', 8)));
  assert.ok(!L.isOverdue({ ...t, done: true }, '2026-10-28', at('2026-10-29', 8)));
});

test('перенос: цель, разовое, повтор без дублей', () => {
  assert.equal(L.moveTarget('2026-10-27', '2026-10-29'), '2026-10-29');
  assert.equal(L.moveTarget('2026-10-29', '2026-10-29'), '2026-10-30');
  const one = task({ date: '2026-10-29' });
  const r1 = L.planMove(one, '2026-10-29', '2026-10-30', [one], id);
  assert.equal(r1.update.date, '2026-10-30');
  assert.equal(r1.create, null);

  const rep = task({ date: '2026-10-26', title: 'Зарядка', repeat: { kind: 'days', days: [3] } }); // четверг
  const r2 = L.planMove(rep, '2026-10-29', '2026-10-30', [rep], id);
  assert.ok(r2.update.skip.includes('2026-10-29'));
  assert.equal(r2.create.date, '2026-10-30');
  assert.equal(r2.create.movedFrom, '2026-10-29');
  // повторный перенос не создаёт дубль
  const r3 = L.planMove(r2.update, '2026-10-29', '2026-10-30', [r2.update, r2.create], id);
  assert.equal(r3.create, null);
  // ежедневный повтор уже есть на целевой дате — копию не создаём
  const daily = task({ date: '2026-10-01', repeat: { kind: 'daily' } });
  assert.equal(L.planMove(daily, '2026-10-29', '2026-10-30', [daily], id).create, null);
});

test('удаление повтора', () => {
  const t = task({ date: '2026-10-01', repeat: { kind: 'daily' } });
  assert.deepEqual(L.planRepeatDelete(t, '2026-10-29', 'one').update.skip, ['2026-10-29']);
  assert.equal(L.planRepeatDelete(t, '2026-10-29', 'following').update.repeat.until, '2026-10-28');
  assert.ok(L.planRepeatDelete(t, '2026-10-01', 'following').remove);
  assert.ok(L.planRepeatDelete(t, '2026-10-29', 'all').remove);
});

test('напоминание за 15 минут и только один раз', () => {
  const t = task({ date: '2026-10-29', time: '10:00', remind: true });
  assert.equal(L.dueReminders([t], at('2026-10-29', 9, 44)).length, 0);
  assert.equal(L.dueReminders([t], at('2026-10-29', 9, 45)).length, 1);
  assert.equal(L.dueReminders([t], at('2026-10-29', 9, 59)).length, 1);
  assert.equal(L.dueReminders([t], at('2026-10-29', 10, 0)).length, 0);
  const reminded = { [L.remindKey(t, '2026-10-29')]: 1 };
  assert.equal(L.dueReminders([t], at('2026-10-29', 9, 50), reminded).length, 0);
  assert.equal(L.dueReminders([{ ...t, done: true }], at('2026-10-29', 9, 50)).length, 0);
});

test('ДР 29 февраля в невисокосный год — 28 февраля', () => {
  const b = { id: 'b', name: 'Иван', day: 29, month: 2, year: 1960, remind: true };
  assert.equal(L.birthdaysOn([b], '2027-02-28').length, 1);
  assert.equal(L.birthdaysOn([b], '2028-02-28').length, 0);
  assert.equal(L.birthdaysOn([b], '2028-02-29').length, 1);
  assert.ok(L.birthdayInYear(b, 2027).shifted);
  assert.equal(L.ageOn(b, 2027), 67);
});

test('напоминания о ДР: после 9:00, завтра и сегодня, по разу', () => {
  const b = { id: 'b', name: 'Иван', day: 30, month: 10, remind: true };
  assert.equal(L.dueBirthdayReminders([b], at('2026-10-29', 8, 59)).length, 0);
  const r = L.dueBirthdayReminders([b], at('2026-10-29', 9, 0));
  assert.equal(r.length, 1);
  assert.equal(r[0].when, 'tomorrow');
  assert.equal(L.dueBirthdayReminders([b], at('2026-10-29', 15), { [r[0].key]: 1 }).length, 0);
  assert.equal(L.dueBirthdayReminders([b], at('2026-10-30', 10))[0].when, 'today');
});

test('проверка формы ДР', () => {
  assert.ok(!L.validateBirthday({ name: '', day: 1, month: 1, year: '' }, 2026).ok);
  assert.ok(!L.validateBirthday({ name: 'А', day: 31, month: 4, year: '' }, 2026).ok);
  assert.ok(!L.validateBirthday({ name: 'А', day: 1, month: 1, year: '2030' }, 2026).ok);
  assert.ok(!L.validateBirthday({ name: 'А', day: 29, month: 2, year: '1961' }, 2026).ok);
  assert.ok(L.validateBirthday({ name: 'А', day: 29, month: 2, year: '1960' }, 2026).ok);
});

test('производственный календарь РТ', () => {
  assert.equal(L.dayInfo('2026-11-06').holiday, 'День Конституции Республики Татарстан');
  assert.ok(L.dayInfo('2026-11-06').off);
  assert.equal(L.dayInfo('2026-03-20').holiday, 'Ураза-байрам');
  assert.equal(L.dayInfo('2026-05-27').holiday, 'Курбан-байрам');
  assert.ok(L.dayInfo('2026-03-09').off);
  assert.ok(L.dayInfo('2026-12-31').off);
  assert.ok(L.dayInfo('2026-08-30').holiday); // вс, без переноса
  assert.ok(!L.dayInfo('2026-08-31').off);
  assert.ok(!L.dayInfo('2027-02-20').off); // рабочая суббота
  assert.ok(L.dayInfo('2027-02-20').workingWeekend);
  assert.ok(L.dayInfo('2027-02-22').off);
  assert.equal(L.dayInfo('2027-03-09').holiday, 'Ураза-байрам');
  assert.ok(L.dayInfo('2027-03-09').off); // вторник
  assert.equal(L.dayInfo('2027-05-16').holiday, 'Курбан-байрам');
  assert.equal(L.dayInfo('2027-03-10').holiday, null);
  assert.ok(L.dayInfo('2027-08-30').off); // День Республики, понедельник
  assert.equal(L.dayInfo('2027-11-06').holiday, 'День Конституции Республики Татарстан');
  assert.ok(!L.dayInfo('2026-10-29').off);
  assert.ok(L.dayInfo('2026-10-31').off); // суббота
  assert.ok(L.dayInfo('2027-04-30').short);
  assert.ok(!L.dayInfo('2027-04-30').off);
  assert.match(L.dayInfo('2027-02-20').note, /сокращённый/);
  // другие годы — только праздники с постоянной датой
  assert.equal(L.dayInfo('2030-06-12').holiday, 'День России');
  assert.equal(L.dayInfo('2030-03-10').holiday, null);
});

test('заметки: «Все», папки, поиск', () => {
  const folders = [{ id: 'f1', name: 'Дача' }];
  const notes = [
    { id: 'a', text: 'Позвонить сантехнику', folderId: null, order: 1 },
    { id: 'b', text: 'Посадить чеснок', folderId: 'f1', order: 0 },
    { id: 'c', text: 'Старая заметка', folderId: 'deleted-folder', order: 2 },
    { id: 'd', text: 'Важное', folderId: null, pinned: true, order: 5 },
  ];
  assert.deepEqual(L.visibleNotes(notes, folders, null, '').map((x) => x.id), ['d', 'a', 'c']);
  assert.deepEqual(L.visibleNotes(notes, folders, 'f1', '').map((x) => x.id), ['b']);
  assert.deepEqual(L.visibleNotes(notes, folders, null, 'чеснок').map((x) => x.id), ['b']);
  assert.ok(!L.validateFolderName('дача', folders).ok);
  assert.ok(!L.validateFolderName('Все', folders).ok);
  assert.ok(L.validateFolderName('Рецепты', folders).ok);
  assert.ok(!L.validateFolderName('x'.repeat(41), folders).ok);
});

test('копия: создание и разбор', () => {
  const data = { tasks: [task({ date: '2026-10-29', _mt: 5, device: 'x' })], notes: [], purchases: [], birthdays: [], noteFolders: [], vacations: [] };
  const b = L.makeBackup(data, new Date('2026-10-29T10:00:00Z'));
  assert.equal(b.format, 'planner-backup');
  assert.equal(b.data.tasks[0]._mt, undefined);
  const p = L.parseBackup(JSON.stringify(b));
  assert.ok(p.ok);
  assert.equal(p.data.tasks.length, 1);
  assert.equal(p.skipped, 0);
});

test('копия эталона v9: цикл и синхронизация пропускаются, поля рецептов — в текст', () => {
  const v9 = {
    format: 'planner-backup', version: 1, exportedAt: '2026-10-01T00:00:00Z',
    data: {
      tasks: [{ id: 't1', date: '2026-10-01', title: 'Дело', _mt: 1 }, { id: 't2', date: 'плохо', title: 'X' }, { id: 't3', date: '2026-10-02', title: 'Удалено', deleted: true }],
      notes: [{ id: 'n1', title: 'Борщ', ingredients: 'свёкла, капуста', folderId: 'recipes' }],
      cycle: [{ id: 'c1', start: '2026-10-01' }],
    },
    cycle: { pin: '1234' },
  };
  const p = L.parseBackup(JSON.stringify(v9));
  assert.ok(p.ok);
  assert.deepEqual(p.sections.sort(), ['notes', 'tasks']);
  assert.equal(p.data.tasks.length, 1);
  assert.equal(p.skipped, 1);
  assert.equal(p.data.cycle, undefined);
  assert.ok(p.data.notes[0].text.startsWith('Борщ'));
  assert.ok(p.data.notes[0].text.includes('свёкла'));
});

test('копия: чужой формат и новая версия отклоняются понятно', () => {
  assert.ok(!L.parseBackup('не json').ok);
  assert.ok(!L.parseBackup('{"format":"other"}').ok);
  const r = L.parseBackup('{"format":"planner-backup","version":2,"data":{}}');
  assert.ok(!r.ok);
  assert.match(r.error, /новой версии/);
});

test('календарь РТ 2027 совпадает с официальными нормами рабочих дней', () => {
  // Рабочих дней по месяцам по производственному календарю Татарстана на 2027 год
  const norm = [15, 19, 21, 22, 19, 21, 22, 21, 22, 21, 20, 22];
  const got = norm.map((_, m) => {
    let n = 0;
    for (let d = 1; d <= L.daysInMonth(2027, m); d++) if (!L.dayInfo(`2027-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`).off) n++;
    return n;
  });
  assert.deepEqual(got, norm);
  assert.equal(got.reduce((a, b) => a + b), 245);
  const shortDays = [];
  for (let iso = '2027-01-01'; iso <= '2027-12-31'; iso = L.addDays(iso, 1)) if (L.dayInfo(iso).short) shortDays.push(iso);
  assert.deepEqual(shortDays, ['2027-02-20', '2027-04-30', '2027-06-11', '2027-11-03']);
});

test('расписание системных уведомлений', () => {
  const now = at('2026-10-29', 10, 0);
  const tasks = [
    task({ date: '2026-10-29', time: '09:30', remind: true }),                      // уже прошло
    task({ date: '2026-10-29', time: '15:30', remind: true, title: 'Поликлиника' }), // сегодня 15:15
    task({ date: '2026-10-26', time: '09:00', remind: true, repeat: { kind: 'weekdays' }, doneDates: ['2026-10-30'] }),
    task({ date: '2026-10-30', time: '12:00', remind: false }),                     // без напоминания
  ];
  const bds = [{ id: 'b1', name: 'Сергей Петрович', day: 31, month: 10, year: 1958, remind: true }];
  const r = L.upcomingReminders(tasks, bds, now, { days: 7 });
  assert.equal(r[0].body, '15:30 — Поликлиника');
  assert.equal(r[0].at.getHours(), 15); assert.equal(r[0].at.getMinutes(), 15);
  assert.ok(!r.some((x) => x.date === '2026-10-30' && x.body.includes('9:00'))); // 30-го уже выполнено
  assert.ok(r.some((x) => x.date === '2026-11-02' && x.body.startsWith('9:00')));
  assert.ok(!r.some((x) => x.date === '2026-10-31' && x.body.startsWith('9:00'))); // суббота
  const bd = r.filter((x) => x.title === 'День рождения').map((x) => [x.date, x.body]);
  assert.deepEqual(bd, [['2026-10-30', 'Завтра день рождения: Сергей Петрович (68 лет)'], ['2026-10-31', 'Сегодня день рождения: Сергей Петрович (68 лет)']]);
  assert.equal(new Set(r.map((x) => x.id)).size, r.length);
  assert.ok(r.every((x, i) => i === 0 || r[i - 1].at <= x.at));
  assert.equal(L.upcomingReminders(tasks, bds, now, { days: 7, max: 2 }).length, 2);
});

test('копия: подделанный файл не может испортить записи', () => {
  const evil = { format: 'planner-backup', version: 1, data: {
    tasks: [
      { id: 't1', date: '2026-10-29', title: 'a', repeat: { kind: 'days', days: 5 } },
      { id: 't2', date: '2026-10-29', title: 'b', repeat: { kind: 'hack', until: { x: 1 } } },
      { id: 't3', date: '2026-10-29', title: 'c', time: '99:99', remind: true, extra: 'x' },
      { id: 't4', date: '2026-10-29', title: 'd', skip: '2026-10-29', doneDates: 7, seq: { a: 1 } },
      { id: { x: 1 }, date: '2026-10-29', title: 'e' },
      { id: '__proto__', date: '2026-10-29', title: 'f' },
    ],
    birthdays: [{ id: 'b1', name: 'X', day: 31, month: 2 }, { id: 'b2', name: 'Y', day: '5', month: '5', year: 3000, note: { x: 1 } }],
    noteFolders: [{ id: 'f1', name: 'Папка', order: 'x' }],
    notes: [{ id: 'n1', text: 'Т', folderId: { a: 1 }, pinned: 'yes' }],
  } };
  const p = L.parseBackup(JSON.stringify(evil));
  assert.ok(p.ok);
  assert.equal(p.data.tasks.length, 4);
  assert.equal(p.skipped, 3);
  const [t1, t2, t3, t4] = p.data.tasks;
  assert.equal(t1.repeat, null); assert.equal(t2.repeat, null);
  assert.equal(t3.time, null); assert.equal(t3.remind, false); assert.equal(t3.extra, undefined);
  assert.deepEqual(t4.skip, []); assert.deepEqual(t4.doneDates, []); assert.equal(t4.seq, 0);
  for (const t of p.data.tasks) { L.occursOn(t, '2026-10-30'); L.isDoneOn(t, '2026-10-29'); }
  assert.deepEqual(p.data.birthdays.map((b) => [b.day, b.month, b.year, b.note]), [[5, 5, null, '']]);
  assert.equal(p.data.noteFolders[0].order, 0);
  assert.equal(p.data.notes[0].folderId, null); assert.equal(p.data.notes[0].pinned, false);
  assert.equal(L.sanitizeRepeat({ kind: 'days', days: [1, 1, 9, 'x', 3] }).days.join(), '1,3');
});

test('время дел: 7:00–21:00 с шагом 15 минут, «По часам» через 30 минут', () => {
  const t = L.timeSlots();
  assert.equal(t[0], '07:00'); assert.equal(t[1], '07:15'); assert.equal(t.at(-1), '21:00');
  assert.equal(t.length, 57);
  const h = L.hourSlots();
  assert.equal(h[0], '07:00'); assert.equal(h[1], '07:30'); assert.equal(h.at(-1), '21:00');
  assert.ok(L.isValidTime('06:40')); assert.ok(L.isValidTime('23:59'));
  assert.ok(!L.isValidTime('24:00')); assert.ok(!L.isValidTime('7:5'));
  // своё время работает с напоминанием за 15 минут
  const task = { id: 'c1', date: '2026-11-10', title: 'Собака', time: '06:40', remind: true, repeat: null, skip: [], doneDates: [] };
  const d = L.parseISO('2026-11-10'); d.setHours(6, 25, 0, 0);
  assert.equal(L.dueReminders([task], d).length, 1);
});

test('копия: испорченная дата экспорта не показывается', () => {
  const r = L.parseBackup(JSON.stringify({ format: 'planner-backup', version: 1, exportedAt: 'мусор', data: { tasks: [] } }));
  assert.equal(r.exportedAt, null);
  assert.equal(L.parseBackup(JSON.stringify({ format: 'planner-backup', version: 1, exportedAt: '2026-10-01T10:00:00Z', data: {} })).exportedAt, '2026-10-01T10:00:00Z');
});
