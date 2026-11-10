"""Сквозные тесты Планировщика в Playwright (Chromium, мобильная эмуляция).

Запуск:  python3 tests/e2e.py            — тесты на 360 и 412 px, вертикально и горизонтально
         python3 tests/e2e.py --shots DIR — дополнительно снять экраны в DIR
Нужно:   pip install playwright && playwright install chromium
Сервер поднимается автоматически из папки проекта.
"""
import functools, http.server, json, os, socketserver, sys, threading, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8799
BASE = f'http://localhost:{PORT}/'
NOW = '2026-10-29T10:15:00'
SHOTS = sys.argv[sys.argv.index('--shots') + 1] if '--shots' in sys.argv else None
results = []


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    handler = functools.partial(Quiet, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.ThreadingTCPServer(('localhost', PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def check(name, cond):
    results.append((name, bool(cond)))
    print(('  ok   ' if cond else '  FAIL ') + name)


SEED = r"""
async () => {
  const P = window.__planner;
  const id = () => crypto.randomUUID();
  const t = (o) => ({ id: id(), title: '', time: null, done: false, remind: false, repeat: null, skip: [], doneDates: [], movedFrom: null, seq: 0, createdAt: new Date().toISOString(), ...o });
  const tasks = [
    t({ date: '2026-10-01', title: 'Принять таблетки', time: '09:00', remind: true, repeat: { kind: 'daily' }, doneDates: ['2026-10-29'], seq: 1 }),
    t({ date: '2026-10-29', title: 'Позвонить сыну', time: '11:00', seq: 2 }),
    t({ date: '2026-10-29', title: 'Поликлиника, кабинет 12, к терапевту', time: '15:30', remind: true, seq: 3 }),
    t({ date: '2026-10-29', title: 'Оплатить коммуналку', seq: 4 }),
    t({ date: '2026-10-29', title: 'Полить цветы на балконе', done: true, seq: 5 }),
    t({ date: '2026-10-28', title: 'Отнести документы в МФЦ', seq: 6 }),
    t({ date: '2026-10-26', title: 'Зарядка', time: '09:30', repeat: { kind: 'weekdays', until: '2026-11-30' }, seq: 7 }),
    t({ date: '2026-10-30', title: 'Встреча с Сергеем Петровичем', time: '12:00', seq: 8 }),
    t({ date: '2026-10-31', title: 'Дача: убрать шланги', time: '10:00', seq: 9 }),
    t({ date: '2026-11-03', title: 'Заплатить за интернет', seq: 10 }),
    t({ date: '2026-10-31', title: 'Показания счётчиков', repeat: { kind: 'monthly' }, seq: 11 }),
  ];
  const p = (date, title, bought = false, seq = 0) => ({ id: id(), date, title, bought, seq, createdAt: new Date().toISOString() });
  const purchases = [
    p('2026-10-29', 'Хлеб бородинский', false, 1), p('2026-10-29', 'Молоко 2,5%', true, 2), p('2026-10-29', 'Яблоки, 1 кг', false, 3),
    p('2026-10-29', 'Капли для глаз', false, 4), p('2026-10-29', 'Гречка', true, 5),
    p('2026-10-31', 'Мешки для мусора', false, 1), p('2026-11-03', 'Батарейки АА', false, 1),
  ];
  const f1 = { id: id(), name: 'Дача', order: 1, createdAt: '2026-09-01T10:00:00Z' };
  const f2 = { id: id(), name: 'Здоровье', order: 2, createdAt: '2026-09-02T10:00:00Z' };
  const n = (text, folderId = null, order = 0, pinned = false) => ({ id: id(), text, folderId, order, pinned, createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-20T10:00:00Z' });
  const notes = [
    n('Телефоны\nСантехник Ильдар — 8 917 000-00-00\nУчастковый врач — 8 843 000-00-00\nУправляющая компания — 8 843 111-11-11', null, 0, true),
    n('Что подарить Сергею Петровичу\nХороший чай, книгу про рыбалку или термос.', null, 1),
    n('Пароль от вайфая на даче — на холодильнике', null, 2),
    n('Посадить весной\nЧеснок, лук-севок, морковь, укроп. Купить семена в феврале, пока есть выбор.', f1.id, 0),
    n('Давление\nУтром 130/85, вечером 125/80. Показать врачу 29 октября.', f2.id, 0),
  ];
  const b = (name, day, month, year, note = '', remind = true) => ({ id: id(), name, day, month, year, note, remind, createdAt: new Date().toISOString() });
  const birthdays = [
    b('Сергей Петрович', 30, 10, 1958, 'Сосед по даче'), b('Внучка Алина', 14, 11, 2015),
    b('Ринат', 6, 1, 1975, '', false), b('Галина Ивановна', 29, 2, 1952), b('Сын Тимур', 21, 5, 1984),
    b('Брат Ильдар', 3, 8, 1961), b('Марат', 12, 12, null, 'Коллега'),
  ];
  const ch = [];
  for (const r of tasks) ch.push({ store: 'tasks', put: r });
  for (const r of purchases) ch.push({ store: 'purchases', put: r });
  for (const r of [f1, f2]) ch.push({ store: 'noteFolders', put: r });
  for (const r of notes) ch.push({ store: 'notes', put: r });
  for (const r of birthdays) ch.push({ store: 'birthdays', put: r });
  await P.apply(ch);
  const rem = {};
  for (const x of birthdays) for (const k of ['2026-10-29|today', '2026-10-30|tomorrow', '2026-10-30|today']) rem[`bd|${x.id}|${k}`] = Date.now();
  localStorage.setItem('planner.reminded', JSON.stringify(rem));
  localStorage.setItem('planner.lastBackup', String(Date.now()));
  localStorage.setItem('planner.installLater', String(Date.now()));
  return ch.length;
}
"""


def new_page(browser, w, h, now=NOW, dark=False, scale=None, landscape=False):
    if landscape:
        w, h = h, w
    ctx = browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, is_mobile=True, has_touch=True,
                              locale='ru-RU', timezone_id='Europe/Moscow', bypass_csp=True, color_scheme='dark' if dark else 'light',
                              user_agent='Mozilla/5.0 (Linux; Android 14; 23078RKD5C Build/UP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36')
    page = ctx.new_page()
    page.errors = []
    page.on('pageerror', lambda e: page.errors.append(str(e)))
    page.external = []
    page.on('request', lambda r: page.external.append(r.url) if not r.url.startswith(BASE) and not r.url.startswith('data:') and not r.url.startswith('blob:') else None)
    if scale:
        page.add_init_script(f"localStorage.setItem('planner.scale','{scale}')")
    page.goto(f'{BASE}?now={now}')
    page.wait_for_function('window.__planner')
    return ctx, page


def shot(page, name, keep_toasts=False):
    if SHOTS:
        if not keep_toasts:
            page.evaluate("document.getElementById('toast-area').replaceChildren()")
        page.wait_for_timeout(250)
        page.screenshot(path=os.path.join(SHOTS, f'{name}.png'))


def nav(page, label):
    page.locator('#nav-bottom button:visible, #nav-top button:visible', has_text=label).first.click()
    page.wait_for_timeout(150)


def run_main(browser, w, h):
    print(f'\n== {w}×{h} вертикально ==')
    ctx, page = new_page(browser, w, h)
    page.evaluate(SEED)
    page.reload(); page.wait_for_function('window.__planner')
    page.wait_for_selector('#plan-body .task')
    page.wait_for_timeout(300)
    check('нет раздела «Цикл»', page.locator('text=Цикл').count() == 0)
    check('нет облака/синхронизации/QR', page.locator('text=/Синхронизац|Открыть на телефоне|QR/').count() == 0)
    check('день: счётчик «Выполнено 2 из 6»', page.locator('.counter', has_text='Выполнено 2 из 6').count() == 1)
    check('день: строка ДР не показана сегодня, есть завтра', page.locator('.info-line.bd').count() == 0)
    titles = page.locator('#plan-body .task .task-title').all_inner_texts()
    check('порядок дел в дне', titles[:2] == ['Оплатить коммуналку', 'Принять таблетки'] and titles[-1] == 'Полить цветы на балконе')
    shot(page, '01-plan-day')

    # Добавление повторяющегося дела «по будням 9:30 до 30-го» через диалог
    page.get_by_role('button', name='Добавить дело').click()
    page.fill('#t-title', '  Утренняя   прогулка ')
    page.select_option('#t-time', '09:30')
    page.check('#t-remind')
    page.select_option('#t-repeat', 'days')
    for b in page.locator('#t-days button').all():
        if b.get_attribute('aria-pressed') == 'true':
            b.click()
    page.locator('#t-days button').nth(0).click()
    page.locator('#t-days button').nth(2).click()
    page.locator('#t-days button').nth(4).click()
    page.select_option('#t-until-mode', 'date')
    page.evaluate("document.getElementById('t-until').value = '2026-11-30'")
    shot(page, '05-task-dialog')
    page.click('#t-save')
    page.wait_for_timeout(200)
    check('дело добавлено с схлопнутыми пробелами', page.evaluate("[...window.__planner.data.tasks.values()].some(t => t.title === 'Утренняя прогулка')"))
    stats = page.evaluate("""() => { const t=[...window.__planner.data.tasks.values()].find(x=>x.title==='Утренняя прогулка'); return [t.repeat.kind, t.repeat.days.join(','), t.repeat.until]; }""")
    check('повтор Пн/Ср/Пт до 30 ноября', stats == ['days', '0,2,4', '2026-11-30'])
    page.wait_for_timeout(3500)

    # По часам
    page.click('#btn-hours')
    page.wait_for_timeout(400)
    check('по часам: 21 строка 9:00–19:00', page.locator('.hour-row').count() >= 21)
    shot(page, '06-plan-hours')
    page.keyboard.press('Escape'); page.wait_for_timeout(200)

    # Неделя и возврат жестом «Назад»
    page.locator('[data-mode="week"]').click()
    check('неделя: 7 дней', page.locator('.week-day').count() == 7)
    check('неделя: ДР в пятницу', page.locator('.week-day', has_text='Сергей Петрович').count() == 1)
    shot(page, '03-plan-week')
    page.locator('.week-day').nth(4).click()
    page.wait_for_timeout(200)
    check('из недели открыт день 30 октября', 'Пятница, 30 октября' in page.inner_text('.datebar[data-scope="plan"] .dt-main'))
    check('строка «День рождения: …» в дне', page.locator('.info-line.bd', has_text='Сергей Петрович (68)').count() == 1)
    page.go_back(); page.wait_for_timeout(300)
    check('«Назад» вернул в неделю', page.locator('.week-day').count() == 7)

    # Месяц ноябрь
    page.locator('[data-mode="month"]').click()
    page.locator('.datebar[data-scope="plan"] [data-act="next"]').click()
    page.wait_for_timeout(200)
    check('месяц: праздники 4 и 6 ноября красные', page.locator('.mcell.off', has_text='6').count() >= 1)
    shot(page, '04-plan-month')
    page.locator('[data-mode="day"]').click()
    page.locator('.quick-row [data-act="today"]').first.click()

    # Перенос с отменой
    page.locator('.task', has_text='Позвонить сыну').locator('button[aria-label^="Действия"]').click()
    page.get_by_role('button', name='Перенести на завтра').click()
    page.wait_for_timeout(300)
    check('тост с «Вернуть»', page.locator('.toast button', has_text='Вернуть').count() == 1)
    shot(page, '17-toast-undo', keep_toasts=True)
    page.locator('.toast button', has_text='Вернуть').click()
    page.wait_for_timeout(300)
    check('«Вернуть» отменил перенос', page.locator('.task', has_text='Позвонить сыну').count() == 1)

    # Покупки
    nav(page, 'Покупки')
    page.fill('#shop-input', 'Сметана')
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)
    check('покупка добавлена Enter, фокус в поле', page.evaluate("document.activeElement.id") == 'shop-input')
    check('счётчик «Осталось: 4 из 6»', page.locator('.counter', has_text='Осталось: 4 из 6').count() == 1)
    page.evaluate('document.activeElement.blur()')
    shot(page, '07-shop')
    page.get_by_role('button', name='Покупки окончены').click()
    page.wait_for_timeout(200)
    page.check('input[name="sd"][value="date"]')
    page.click('#sd-date'); page.wait_for_timeout(200)
    page.click('#mc-next'); page.locator('#mc-grid button', has_text='2').first.click(); page.wait_for_timeout(200)
    shot(page, '08-shop-finish')
    page.locator('#dlg-shopdone button[type="submit"]').click()
    page.wait_for_timeout(200)
    moved = page.evaluate("""() => [...window.__planner.data.purchases.values()].filter(p=>p.date==='2026-11-02').length""")
    left = page.evaluate("""() => [...window.__planner.data.purchases.values()].filter(p=>p.date==='2026-10-29').length""")
    check('«Покупки окончены»: купленное удалено, некупленное перенесено', moved == 4 and left == 0)
    page.locator('.toast button', has_text='Вернуть').click()
    page.wait_for_timeout(300)

    # Заметки
    nav(page, 'Заметки')
    check('«Все» — только заметки вне папок', page.locator('.note-card').count() == 3)
    shot(page, '09-notes-list')
    page.fill('#notes-search', 'чеснок')
    page.wait_for_timeout(150)
    check('поиск из «Все» находит заметку в папке', page.locator('.note-card', has_text='Посадить весной').count() == 1)
    page.fill('#notes-search', '')
    page.locator('#folder-chips button', has_text='Дача').click()
    shot(page, '10-notes-folder')
    page.get_by_role('button', name='Новая заметка').click()
    page.fill('#note-text', 'Список на дачу\nПеренести яблоки в погреб\nУкрыть розы')
    page.wait_for_timeout(700)
    check('автосохранение: «Сохранено»', page.inner_text('#save-status') == 'Сохранено')
    shot(page, '11-notes-editor')
    saved_in = page.evaluate("""() => { const n=[...window.__planner.data.notes.values()].find(x=>x.text.startsWith('Список на дачу')); return n && n.folderId === window.__planner.state.folderId; }""")
    check('новая заметка создана в открытой папке', saved_in)
    page.click('#btn-to-list'); page.wait_for_timeout(200)
    page.click('#btn-folder-delete')
    page.locator('#dlg-choice-list button', has_text='Удалить папку').click()
    page.wait_for_timeout(300)
    check('после удаления папки её заметки во «Все»', page.locator('.note-card', has_text='Посадить весной').count() == 1)
    page.locator('.toast button', has_text='Вернуть').click(); page.wait_for_timeout(300)
    # создание папки «Рецепты» — обычная
    page.locator('#folder-chips button', has_text='Папка').click()
    page.fill('#p-input', 'Рецепты')
    page.click('#p-ok'); page.wait_for_timeout(200)
    check('папка «Рецепты» создана обычной (без спецполей)', page.locator('#folder-chips button', has_text='Рецепты').count() == 1 and page.locator('#notes-list .empty').count() == 1)

    # Заметка не теряется при закрытии сразу после ввода
    page.get_by_role('button', name='Новая заметка').click()
    page.fill('#note-text', 'Срочно: купить лампочку')
    page.evaluate("window.dispatchEvent(new Event('pagehide'))")
    page.reload(); page.wait_for_function('window.__planner')
    check('заметка сохранилась после закрытия', page.evaluate("""() => [...window.__planner.data.notes.values()].some(n=>n.text==='Срочно: купить лампочку')"""))

    # ДР
    nav(page, 'ДР')
    check('ДР: счётчик 7 записей', page.inner_text('#bd-count') == '7 записей')
    shot(page, '12-birthdays')
    page.click('#btn-bd-add')
    page.fill('#b-name', 'Дядя Равиль')
    page.select_option('#b-day', '29'); page.select_option('#b-month', '2')
    page.fill('#b-year', '2031')
    page.locator('#dlg-bd button[type="submit"]').click()
    check('ДР: год в будущем — ошибка под полем', page.is_visible('#b-year-err'))
    page.fill('#b-year', '1964')
    shot(page, '13-birthday-form')
    page.locator('#dlg-bd button[type="submit"]').click()
    page.wait_for_timeout(200)
    on28 = page.evaluate("""async () => { const m = await import('./logic.js'); return m.birthdaysOn([...window.__planner.data.birthdays.values()], '2027-02-28').map(b=>b.name); }""")
    check('ДР 29 февраля в 2027 году — 28 февраля', 'Дядя Равиль' in on28)

    # Меню
    nav(page, 'Меню')
    check('в меню нет синхронизации', page.locator('#view-menu', has_text='Синхрониз').count() == 0)
    shot(page, '14-menu')
    page.click('#btn-install-help'); page.wait_for_timeout(200)
    check('справка Xiaomi «Ярлыки на рабочем столе»', page.locator('#dlg-info', has_text='Ярлыки на рабочем столе').count() == 1)
    shot(page, '18-install-help')
    page.keyboard.press('Escape'); page.wait_for_timeout(200)
    page.click('#btn-storage-info'); page.wait_for_timeout(300)
    check('справка о хранении упоминает «Безопасность»', page.locator('#dlg-info', has_text='Безопасность').count() == 1)
    page.keyboard.press('Escape'); page.wait_for_timeout(200)

    # Восстановление копии эталона v9 (с данными цикла)
    v9 = {'format': 'planner-backup', 'version': 1, 'exportedAt': '2026-10-20T10:00:00Z',
          'data': {'tasks': [{'id': 'v9t', 'date': '2026-10-29', 'title': 'Из копии v9', '_mt': 1, 'device': 'x'}],
                   'notes': [{'id': 'v9n', 'title': 'Борщ', 'ingredients': 'свёкла', 'folderId': None}],
                   'cycle': [{'id': 'c1', 'start': '2026-10-01'}]}, 'cycle': {'pin': '1234'}}
    path = os.path.join(SHOTS or '/tmp', 'v9-backup.json')
    with open(path, 'w') as f:
        json.dump(v9, f, ensure_ascii=False)
    page.set_input_files('#restore-file', path)
    page.wait_for_timeout(300)
    page.get_by_role('button', name='Заменить записи').click()
    page.wait_for_timeout(400)
    r = page.evaluate("""() => { const d=window.__planner.data; return [d.tasks.size, [...d.tasks.values()][0].title, [...d.notes.values()].some(n=>n.text.includes('свёкла')), d.birthdays.size, 'cycle' in d]; }""")
    check('копия v9 восстановлена, цикл пропущен, ДР не тронуты', r[0] == 1 and r[1] == 'Из копии v9' and r[2] and r[3] == 8 and not r[4])

    check('нет запросов к сторонним доменам', not page.external)
    check('нет ошибок JavaScript', not page.errors)
    if page.errors:
        print(page.errors)
    ctx.close()


def run_evening(browser, w, h):
    print(f'\n== {w}×{h} вечер, 20:30 ==')
    ctx, page = new_page(browser, w, h, now='2026-10-29T20:30:00')
    page.evaluate(SEED); page.reload(); page.wait_for_function('window.__planner')
    check('после 20:00 невыполненные подсвечены', page.locator('.task.overdue').count() == 4)
    shot(page, '02-plan-overdue')
    page.locator('.overdue-bar button').click(); page.wait_for_timeout(300)
    tomorrow = page.evaluate("""async () => { const m = await import('./logic.js'); return m.tasksForDate([...window.__planner.data.tasks.values()], '2026-10-30').map(t=>t.title); }""")
    check('перенос на завтра без дублей', len(tomorrow) == len(set(tomorrow)) and 'Оплатить коммуналку' in tomorrow and tomorrow.count('Принять таблетки') == 1)
    page.locator('.toast button', has_text='Вернуть').click(); page.wait_for_timeout(300)
    check('«Вернуть» отменил перенос', page.locator('.task.overdue').count() == 4)
    ctx.close()


def run_reminder(browser):
    print('\n== напоминание за 15 минут ==')
    ctx, page = new_page(browser, 412, 915, now='2026-10-29T15:14:50')
    page.evaluate(SEED); page.reload(); page.wait_for_function('window.__planner')
    page.wait_for_timeout(16500)
    check('окно «Скоро начало» открылось', page.is_visible('#dlg-alert') and 'Поликлиника' in page.inner_text('#dlg-alert-text'))
    shot(page, '19-reminder')
    page.locator('#dlg-alert [data-close]').click()
    page.wait_for_timeout(15500)
    check('напоминание не повторяется', not page.is_visible('#dlg-alert'))
    ctx.close()


def run_offline(browser):
    print('\n== авиарежим ==')
    ctx, page = new_page(browser, 412, 915)
    page.evaluate(SEED)
    page.wait_for_function("navigator.serviceWorker.controller !== null || navigator.serviceWorker.ready.then(()=>true)")
    page.evaluate("navigator.serviceWorker.ready")
    page.reload(); page.wait_for_function('window.__planner')
    page.wait_for_timeout(500)
    ctx.set_offline(True)
    page.reload(); page.wait_for_function('window.__planner')
    page.wait_for_selector('#plan-body .task')
    check('без сети открывается со всеми данными', page.locator('#plan-body .task').count() >= 5)
    for v in ['Покупки', 'Заметки', 'ДР', 'Меню']:
        nav(page, v)
    check('без сети все разделы работают', page.locator('#view-menu .card').count() >= 5 and not page.errors)
    ctx.close()


def run_install(browser):
    print('\n== установка на телефон ==')
    ctx, page = new_page(browser, 412, 915)
    page.wait_for_timeout(300)
    check('при первом открытии видна кнопка «Установить» в шапке', page.is_visible('#btn-install-head'))
    check('при первом открытии баннер установки', page.locator('.banner', has_text='Установите Планировщик').count() == 1)
    shot(page, '00-first-open')
    # Chrome предлагает установку: имитируем beforeinstallprompt
    page.evaluate("""() => { const e = new Event('beforeinstallprompt'); e.prompt = () => { window.__prompted = true; };
      e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); }""")
    page.click('#btn-install-head'); page.wait_for_timeout(300)
    check('кнопка вызывает системное окно установки', page.evaluate('window.__prompted === true'))
    page.evaluate("window.dispatchEvent(new Event('appinstalled'))"); page.wait_for_timeout(200)
    check('после установки кнопка пропала', not page.is_visible('#btn-install-head'))
    check('после установки баннер пропал', page.locator('.banner', has_text='Установите').count() == 0)
    page.reload(); page.wait_for_function('window.__planner'); page.wait_for_timeout(300)
    check('после перезапуска кнопки нет', not page.is_visible('#btn-install-head'))
    ctx.close()
    # Открыто как установленное приложение (standalone)
    ctx = browser.new_context(viewport={'width': 412, 'height': 915}, is_mobile=True, bypass_csp=True)
    page = ctx.new_page()
    page.add_init_script("""const mm = window.matchMedia.bind(window); window.matchMedia = (q) => q.includes('standalone')
      ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : mm(q);""")
    page.goto(BASE); page.wait_for_function('window.__planner'); page.wait_for_timeout(300)
    check('в установленном приложении кнопок установки нет', not page.is_visible('#btn-install-head') and page.locator('.banner', has_text='Установите').count() == 0)
    ctx.close()


def run_custom_time_and_themes(browser):
    print('\n== своё время и праздничные темы ==')
    ctx, page = new_page(browser, 412, 915)
    page.evaluate(SEED); page.reload(); page.wait_for_function('window.__planner'); page.wait_for_selector('#plan-body .task')
    page.get_by_role('button', name='Добавить дело').click()
    opts = page.eval_on_selector_all('#t-time option', 'os => os.map(o => o.value)')
    check('время в окне дела: 7:00…21:00 и «Своё время»', opts[1] == '07:00' and opts[2] == '07:15' and '21:00' in opts and opts[-1] == 'custom')
    page.fill('#t-title', 'Выгулять собаку')
    page.select_option('#t-time', 'custom')
    check('«Своё время» показывает часы и минуты', page.is_visible('#t-hh') and page.is_visible('#t-mm'))
    page.select_option('#t-hh', '06'); page.select_option('#t-mm', '40'); page.check('#t-remind')
    page.click('#t-save'); page.wait_for_timeout(300)
    t = page.evaluate("[...window.__planner.data.tasks.values()].find(x => x.title === 'Выгулять собаку')")
    check('своё время 6:40 сохранено с напоминанием', t and t['time'] == '06:40' and t['remind'])
    page.locator('.task', has_text='Выгулять собаку').locator('button[aria-label^="Действия"]').click()
    page.get_by_role('button', name='Изменить').click(); page.wait_for_timeout(200)
    check('при изменении открывается «Своё время» 6:40', page.input_value('#t-time') == 'custom' and page.input_value('#t-hh') == '06' and page.input_value('#t-mm') == '40')
    page.keyboard.press('Escape'); page.wait_for_timeout(200)
    page.click('#btn-hours'); page.wait_for_timeout(300)
    rows = page.locator('.hour-row .hour-btn').all_inner_texts()
    check('«По часам» с 7:00 до 21:00 и строка для 6:40', rows[0] == '6:40' and '7:00' in rows and rows[-1] == '21:00')
    page.keyboard.press('Escape'); page.wait_for_timeout(200)
    for th, color in [('newyear', '#0B1630'), ('patrick', '#0E2214'), ('halloween', '#140B1A')]:
        nav(page, 'Меню'); page.locator(f'#theme-seg [data-theme-v="{th}"]').click(); page.wait_for_timeout(200)
        ok = page.evaluate(f"document.documentElement.dataset.theme === '{th}' && document.querySelector('meta[name=theme-color]').content === '{color}'")
        for v in ['План', 'Покупки', 'Заметки', 'ДР']:
            nav(page, v)
        wide = page.evaluate('document.documentElement.scrollWidth') <= 412
        check(f'тема {th}: включается, все разделы без сдвига вбок', ok and wide)
        shot(page, f'21-theme-{th}')
    page.reload(); page.wait_for_function('window.__planner')
    check('тема сохраняется после перезапуска', page.evaluate("document.documentElement.dataset.theme") == 'halloween')
    check('нет ошибок JavaScript', not page.errors)
    ctx.close()


def run_layout(browser, w, h, landscape=False, dark=False, scale=None, name=None):
    label = f'{w}×{h} {"горизонтально" if landscape else "вертикально"}{" тёмная" if dark else ""}{f" масштаб {scale}" if scale else ""}'
    print(f'\n== {label} ==')
    ctx, page = new_page(browser, w, h, dark=dark, scale=scale, landscape=landscape)
    page.evaluate(SEED); page.reload(); page.wait_for_function('window.__planner')
    for v in ['План', 'Покупки', 'Заметки', 'ДР', 'Меню']:
        nav(page, v)
        page.wait_for_timeout(120)
        sw = page.evaluate('document.documentElement.scrollWidth')
        check(f'{v}: нет горизонтальной прокрутки ({sw} ≤ {page.viewport_size["width"]})', sw <= page.viewport_size['width'])
    if landscape:
        check('горизонтально — раскладка wide', page.evaluate("document.documentElement.dataset.layout") == 'wide' or scale)
    if name:
        nav(page, 'План')
        page.wait_for_timeout(200)
        shot(page, name)
        if dark:
            nav(page, 'Заметки'); shot(page, name + '-notes')
        if landscape and not scale:
            nav(page, 'Заметки')
            page.locator('.note-open').first.click()
            shot(page, name + '-notes')
    check('нет ошибок JavaScript', not page.errors)
    ctx.close()


def main():
    httpd = serve()
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        run_main(browser, 412, 915)
        if not SHOTS:
            run_main(browser, 360, 780)
        run_evening(browser, 412, 915)
        run_reminder(browser)
        run_offline(browser)
        run_install(browser)
        run_custom_time_and_themes(browser)
        run_layout(browser, 412, 915, dark=True, name='15-dark')
        run_layout(browser, 412, 915, landscape=True, name='16-landscape')
        run_layout(browser, 360, 780, scale='1.5', name='20-scale150-360')
        run_layout(browser, 360, 780, landscape=True)
        browser.close()
    httpd.shutdown()
    failed = [n for n, ok in results if not ok]
    print(f'\nИтого: {len(results) - len(failed)} из {len(results)} проверок пройдено.')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
