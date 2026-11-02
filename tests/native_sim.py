"""Проверка Android-логики в браузере на имитации Capacitor. Запуск: python3 tests/native_sim.py"""
import sys; import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e
from playwright.sync_api import sync_playwright
MOCK = r"""
window.__ln = { scheduled: [], perm: 'granted', exact: 'granted', channels: [], listeners: {} };
window.Capacitor = { isNativePlatform: () => true, Plugins: {
  LocalNotifications: {
    checkPermissions: async () => ({ display: __ln.perm }),
    requestPermissions: async () => { __ln.perm = 'granted'; return { display: 'granted' }; },
    checkExactNotificationSetting: async () => ({ exact_alarm: __ln.exact }),
    changeExactNotificationSetting: async () => { __ln.exact = 'granted'; return { exact_alarm: 'granted' }; },
    createChannel: async (c) => { __ln.channels.push(c); },
    deleteChannel: async (c) => { __ln.deleted = (__ln.deleted||[]).concat(c.id); },
    getPending: async () => ({ notifications: __ln.scheduled.map(n => ({ id: String(n.id) })) }),
    cancel: async ({ notifications }) => { const ids = new Set(notifications.map(n => n.id)); __ln.scheduled = __ln.scheduled.filter(n => !ids.has(n.id)); },
    schedule: async ({ notifications }) => { __ln.scheduled.push(...notifications); return { notifications }; },
    addListener: (ev, fn) => { __ln.listeners[ev] = fn; },
  },
  Filesystem: { writeFile: async (o) => { window.__written = o; return { uri: 'file:///cache/' + o.path }; } },
  Share: { share: async (o) => { window.__shared = o; } },
}};
"""
httpd=e2e.serve()
ok=lambda n,c: print(('  ok   ' if c else '  FAIL ')+n)
with sync_playwright() as p:
    b=p.chromium.launch()
    ctx=b.new_context(viewport={'width':412,'height':915},is_mobile=True,bypass_csp=True,locale='ru-RU',timezone_id='Europe/Moscow')
    pg=ctx.new_page(); errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.add_init_script(MOCK)
    pg.goto(e2e.BASE+'?now=2026-10-29T10:15:00'); pg.wait_for_function('window.__planner')
    pg.evaluate(e2e.SEED); pg.wait_for_timeout(1200)
    s=pg.evaluate("__ln.scheduled.map(n=>[n.title,n.body,new Date(n.schedule.at).toString().slice(0,21),n.channelId,n.smallIcon])")
    ok(f'поставлено напоминаний: {len(s)}', len(s)>10)
    for row in s[:5]: print('     ', row)
    ok('канал «Напоминания» с высокой важностью, текст на экране блокировки — по настройке телефона', pg.evaluate("__ln.channels[0] && __ln.channels[0].importance===5 && __ln.channels[0].visibility===0 && __ln.deleted.includes('reminders')"))
    ok('нет кнопки «Установить» в Android-версии', not pg.is_visible('#btn-install-head') and pg.locator('.banner', has_text='Установите').count()==0)
    # изменение дела — перепланирование
    pg.evaluate("""() => { const t=[...window.__planner.data.tasks.values()].find(x=>x.title.startsWith('Поликлиника')); return window.__planner.apply([{store:'tasks',put:{...t,time:'16:00'}}]); }""")
    pg.wait_for_timeout(900)
    ok('после изменения времени напоминание переставлено на 15:45', pg.evaluate("__ln.scheduled.some(n=>n.body.startsWith('16:00 — Поликлиника') && new Date(n.schedule.at).getHours()===15 && new Date(n.schedule.at).getMinutes()===45)"))
    ok('старое напоминание снято', not pg.evaluate("__ln.scheduled.some(n=>n.body.startsWith('15:30 — Поликлиника'))"))
    ok('нет дублей id', pg.evaluate("new Set(__ln.scheduled.map(n=>n.id)).size === __ln.scheduled.length"))
    # нажатие на уведомление открывает день
    pg.evaluate("__ln.listeners.localNotificationActionPerformed({notification:{extra:{date:'2026-10-30'}}})"); pg.wait_for_timeout(300)
    ok('нажатие на уведомление открывает нужный день', 'Пятница, 30 октября' in pg.inner_text('.datebar[data-scope="plan"] .dt-main'))
    # резервная копия
    e2e.nav(pg,'Меню'); pg.click('#btn-backup'); pg.wait_for_timeout(400)
    ok('копия: файл записан и открыто «Поделиться»', pg.evaluate("!!(window.__written && window.__shared && window.__shared.files[0].endsWith('.json'))"))
    ok('текст про закрытое приложение в меню', pg.is_visible('text=даже когда приложение закрыто'))
    pg.click('#btn-remind-help'); pg.wait_for_timeout(300)
    ok('справка: статус разрешений и Автозапуск', pg.locator('#dlg-info', has_text='Автозапуск').count()==1 and pg.locator('#dlg-info', has_text='включено').count()==1)
    pg.screenshot(path='/tmp/native-help.png')
    pg.keyboard.press('Escape')
    ok('нет ошибок JS', not errs); print(errs)
    # без разрешения точного времени — баннер
    ctx2=b.new_context(viewport={'width':412,'height':915},is_mobile=True,bypass_csp=True,locale='ru-RU')
    p2=ctx2.new_page(); p2.add_init_script(MOCK+"__ln.exact='denied';")
    p2.goto(e2e.BASE); p2.wait_for_function('window.__planner'); p2.wait_for_timeout(600)
    ok('баннер «Будильники и напоминания», если точное время запрещено', p2.locator('.banner', has_text='Будильники и напоминания').count()==1)
    p2.screenshot(path='/tmp/native-banner.png')
httpd.shutdown()
