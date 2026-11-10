// native.js — возможности Android-версии (Capacitor). На сайте ничего не делает.
// Напоминания ставятся на системный будильник Android и приходят, даже когда приложение закрыто.
import * as L from './logic.js';

const C = window.Capacitor;
const available = !!(C && C.isNativePlatform && C.isNativePlatform());
const P = available ? (C.Plugins || {}) : {};
const LN = P.LocalNotifications;
const CHANNEL = 'planner-reminders';
const OLD_CHANNELS = ['reminders'];
const DAYS_AHEAD = 21;
const MAX_SCHEDULED = 120;

/**
 * ctx: { getTasks, getBirthdays, now }
 */
export function createNative(ctx) {
  let timer = null;
  let channelReady = false;
  let lastSignature = '';
  let channelOk = false;

  async function ensureChannel() {
    if (channelReady || !LN) return;
    for (const id of OLD_CHANNELS) { try { await LN.deleteChannel({ id }); } catch { /* не было */ } }
    channelOk = false;
    try {
      await LN.createChannel({
        id: CHANNEL, name: 'Напоминания', description: 'Дела и дни рождения',
        importance: 5, visibility: 0, vibration: true, lights: true, lightColor: '#FF8C1A',
      });
      channelOk = true;
    } catch (e) { console.warn('channel', e); }
    channelReady = true;
  }

  /** Состояние разрешений: { notifications: bool, exact: bool } */
  async function status() {
    if (!LN) return { notifications: false, exact: false };
    let notifications = false, exact = true;
    try { notifications = (await LN.checkPermissions()).display === 'granted'; } catch { /* нет */ }
    try { if (LN.checkExactNotificationSetting) exact = (await LN.checkExactNotificationSetting()).exact_alarm === 'granted'; } catch { /* старый Android */ }
    return { notifications, exact };
  }

  async function requestPermission() {
    if (!LN) return false;
    try {
      const r = await LN.requestPermissions();
      if (r.display === 'granted') { lastSignature = ''; reschedule(); return true; }
    } catch (e) { console.warn('perm', e); }
    return false;
  }

  async function openExactSettings() {
    try { await LN.changeExactNotificationSetting(); } catch (e) { console.warn('exact', e); }
  }

  /** Пересчитать и поставить все ближайшие напоминания (с задержкой, чтобы не дёргать на каждое нажатие) */
  function reschedule() {
    if (!LN) return;
    clearTimeout(timer);
    timer = setTimeout(doReschedule, 400);
  }

  async function doReschedule() {
    const list = L.upcomingReminders(ctx.getTasks(), ctx.getBirthdays(), ctx.now(), { days: DAYS_AHEAD, max: MAX_SCHEDULED });
    const signature = list.map((r) => `${r.id}@${+r.at}|${r.body}`).join(';');
    if (signature === lastSignature) return;
    try {
      if ((await LN.checkPermissions()).display !== 'granted') return;
      await ensureChannel();
      const pending = await LN.getPending();
      const keep = new Set(list.map((r) => r.id));
      const stale = (pending.notifications || []).filter((n) => !keep.has(Number(n.id)));
      // Снимаем всё старое и ставим заново — так изменения времени и текста точно применятся.
      if (pending.notifications && pending.notifications.length) {
        const old = pending.notifications.filter((n) => Number(n.id) !== 1);
        if (old.length) await LN.cancel({ notifications: old.map((n) => ({ id: Number(n.id) })) });
      }
      if (list.length) {
        await LN.schedule({
          notifications: list.map((r) => ({
            id: r.id, title: r.title, body: r.body, largeBody: r.body,
            schedule: { at: r.at, allowWhileIdle: true },
            ...(channelOk ? { channelId: CHANNEL } : {}), smallIcon: 'ic_stat_planner', iconColor: '#0B4F4A',
            autoCancel: true, extra: { date: r.date },
          })),
        });
      }
      lastSignature = signature;
      console.info(`Напоминаний поставлено: ${list.length}, снято устаревших: ${stale.length}`);
    } catch (e) { console.warn('schedule', e); }
  }

  /** Резервная копия: сохранить файл и открыть «Поделиться» (мессенджер, почта, Файлы) */
  async function shareBackup(json, name) {
    const FS = P.Filesystem, Share = P.Share;
    if (!FS || !Share) return 'unsupported';
    try {
      const path = `${name}.json`;
      const res = await FS.writeFile({ path, data: json, directory: 'CACHE', encoding: 'utf8' });
      await Share.share({ title: 'Резервная копия Планировщика', text: 'Резервная копия записей Планировщика', files: [res.uri], dialogTitle: 'Сохранить копию' });
      return 'ok';
    } catch (e) {
      const msg = String(e && (e.message || e));
      if (/cancel/i.test(msg)) return 'cancel';
      // Если «Поделиться» недоступно — сохраняем в «Документы»
      try {
        await FS.writeFile({ path: `Planner/${name}.json`, data: json, directory: 'DOCUMENTS', encoding: 'utf8', recursive: true });
        return 'documents';
      } catch { return 'unsupported'; }
    }
  }

  /** Нажатие на уведомление: открыть день, к которому оно относится */
  function onOpen(fn) {
    if (!LN) return;
    try {
      LN.addListener('localNotificationActionPerformed', (a) => {
        const date = a && a.notification && a.notification.extra && a.notification.extra.date;
        if (date) fn(date);
      });
    } catch { /* нет слушателя */ }
  }

  /** Приложение вернулось на экран — пересчитать (сменились сутки, новые повторы попали в окно) */
  function onResume(fn) {
    try { P.App && P.App.addListener('resume', fn); } catch { /* нет */ }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') fn(); });
  }

  // ---------- Обновление приложения с GitHub (только номер версии; записи никуда не отправляются) ----------
  const REPO_API = 'https://api.github.com/repos/olgausova12345-pixel/planner/releases/latest';
  const APK_PREFIX = 'https://github.com/olgausova12345-pixel/planner/releases/download/';
  async function appInfo() {
    try { return await P.App.getInfo(); } catch { return null; }
  }
  /** { available, version, current, url } или исключение, если нет сети */
  async function checkUpdate() {
    const info = await appInfo();
    if (!info) return { available: false };
    const r = await fetch(REPO_API, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(`GitHub ответил ${r.status}`);
    const d = await r.json();
    const tag = String(d.tag_name || '');
    const m = /^v(.+)-(\d+)$/.exec(tag);
    const build = m ? Number(m[2]) : 0;
    const asset = (d.assets || []).find((a) => a.name === 'planner.apk');
    const url = asset && String(asset.browser_download_url || '');
    const ok = !!(url && url.startsWith(APK_PREFIX));
    return { available: ok && build > Number(info.build || 0), version: m ? m[1] : tag, current: info.version, url: ok ? url : null };
  }
  /** Скачать APK и открыть установщик Android. onProgress(0..1) */
  async function installUpdate(url, onProgress) {
    const FS = P.Filesystem, FO = P.FileOpener;
    if (!FS || !FO || !url || !url.startsWith(APK_PREFIX)) throw new Error('Обновление недоступно');
    let sub = null;
    try { sub = await FS.addListener('progress', (e) => { if (onProgress && e.contentLength) onProgress(e.bytes / e.contentLength); }); } catch { /* без прогресса */ }
    try {
      await FS.downloadFile({ url, path: 'planner-update.apk', directory: 'CACHE', progress: true });
    } finally { try { sub && sub.remove(); } catch { /* нет */ } }
    const { uri } = await FS.getUri({ path: 'planner-update.apk', directory: 'CACHE' });
    await FO.openFile({ path: uri, mimeType: 'application/vnd.android.package-archive' });
  }

  /** Сколько напоминаний поставлено в Android и какое ближайшее */
  async function pendingInfo() {
    if (!LN) return null;
    try {
      const list = L.upcomingReminders(ctx.getTasks(), ctx.getBirthdays(), ctx.now(), { days: DAYS_AHEAD, max: MAX_SCHEDULED });
      const p = await LN.getPending();
      return { count: (p.notifications || []).length, next: list[0] || null };
    } catch { return null; }
  }
  /** Тестовое уведомление через минуту */
  async function testReminder() {
    await ensureChannel();
    const at = new Date(Date.now() + 60 * 1000);
    await LN.schedule({ notifications: [{ id: 1, title: 'Проверка напоминания', body: 'Напоминания работают. Так будут приходить ваши напоминания о делах.',
      schedule: { at, allowWhileIdle: true }, ...(channelOk ? { channelId: CHANNEL } : {}), smallIcon: 'ic_stat_planner', iconColor: '#0B4F4A', autoCancel: true }] });
    lastSignature = ''; // следующий пересчёт не должен снять тест
  }

  return { pendingInfo, testReminder, available, status, requestPermission, openExactSettings, reschedule, shareBackup, onOpen, onResume, appInfo, checkUpdate, installUpdate };
}
