"""Проверка обновления Android-приложения из самого приложения (имитация Capacitor и GitHub). Запуск: python3 tests/app_update_sim.py"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e
from PIL import Image
from playwright.sync_api import sync_playwright
D='/tmp/planner-update-sim/'; os.makedirs(D,exist_ok=True)
fails=[]
def ok(n,c): print(('  ok   ' if c else '  FAIL ')+n); (None if c else fails.append(n))
MOCK = r"""
window.__ln = { scheduled: [] };
window.__opened = null;
const listeners = {};
window.Capacitor = { isNativePlatform: () => true, Plugins: {
  LocalNotifications: { checkPermissions: async () => ({ display: 'granted' }), requestPermissions: async () => ({ display: 'granted' }),
    checkExactNotificationSetting: async () => ({ exact_alarm: 'granted' }), createChannel: async () => {}, deleteChannel: async () => {},
    getPending: async () => ({ notifications: [] }), cancel: async () => {}, schedule: async () => {}, addListener: () => {} },
  App: { getInfo: async () => ({ version: '2026.11.10-1', build: '4' }), addListener: () => {} },
  Filesystem: {
    addListener: async (ev, fn) => { listeners[ev] = fn; return { remove: () => {} }; },
    downloadFile: async () => { for (let i = 1; i <= 4; i++) { await new Promise(r => setTimeout(r, 700)); listeners.progress && listeners.progress({ bytes: i * 850000, contentLength: 3400000 }); } return { path: 'x' }; },
    getUri: async () => ({ uri: 'file:///cache/planner-update.apk' }),
    writeFile: async () => ({ uri: 'x' }) },
  FileOpener: { openFile: async (o) => { window.__opened = o; } },
  Share: { share: async () => {} },
}};
"""
REL={'tag_name':'v2026.11.17-1-5','name':'Планировщик 2026.11.17-1','assets':[{'name':'planner.apk','browser_download_url':'https://github.com/olgausova12345-pixel/planner/releases/download/v2026.11.17-1-5/planner.apk'}]}
httpd=e2e.serve()
with sync_playwright() as p:
    b=p.chromium.launch()
    ctx=b.new_context(viewport={'width':412,'height':915},device_scale_factor=2,is_mobile=True,bypass_csp=True,locale='ru-RU',timezone_id='Europe/Moscow')
    calls=[]
    def handler(route):
        calls.append(route.request.url); route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin':'*'}, body=json.dumps(REL))
    ctx.route('https://api.github.com/**', handler)
    pg=ctx.new_page(); errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.add_init_script(MOCK+"localStorage.setItem('planner.lastBackup', String(Date.now()));")
    pg.goto(e2e.BASE+'?now=2026-10-29T10:15:00'); pg.wait_for_function('window.__planner')
    pg.evaluate(e2e.SEED); pg.reload(); pg.wait_for_function('window.__planner')
    pg.wait_for_selector('.banner >> text=Доступна новая версия приложения', timeout=8000); pg.wait_for_timeout(300)
    pg.evaluate("document.getElementById('toast-area').replaceChildren()")
    pg.screenshot(path=D+'1-banner.png')
    pg.locator('.banner button', has_text='Обновить').click(); pg.wait_for_timeout(1650)
    pg.screenshot(path=D+'2-progress.png')
    pg.wait_for_timeout(1800)
    op=pg.evaluate('window.__opened')
    ok('после скачивания открыт установщик Android', op and op['mimeType']=='application/vnd.android.package-archive')
    pg.screenshot(path=D+'3-after.png')
    e2e.nav(pg,'Меню'); pg.locator('#card-app-update').scroll_into_view_if_needed(); pg.evaluate('window.scrollBy(0,-120)'); pg.wait_for_timeout(300)
    pg.screenshot(path=D+'4-menu.png')
    ok('один запрос — только номер версии на GitHub', calls==['https://api.github.com/repos/olgausova12345-pixel/planner/releases/latest'])
    ok('в меню видны установленная и новая версии', 'Установлена версия 2026.11.10-1' in pg.inner_text('#card-app-update') and '2026.11.17-1' in pg.inner_text('#card-app-update'))
    ok('нет ошибок JS', not errs)
httpd.shutdown()
if fails: sys.exit(1)
print('Обновление из приложения: все проверки пройдены.')
ims=[Image.open(D+n+'.png').resize((412,915)) for n in ['1-banner','2-progress','3-after','4-menu']]
S=Image.new('RGB',(412*4+30,915),'white')
for i,im in enumerate(ims): S.paste(im,(i*422,0))
S.save(D+'screens.png')
