// sw.js — офлайн-кэш оболочки. Версия меняется при каждом релизе (одна строка во всех файлах).
const VERSION = '2026.11.02-1';
const CACHE = `planner-${VERSION}`;
const V = `?v=${VERSION}`;
const SHELL = [
  './', './index.html', './offline.html', './offline.js', './manifest.webmanifest', './version.json',
  `./styles.css${V}`, `./boot.js${V}`, `./app.js${V}`,
  './app.js', './logic.js', './db.js', './birthdays.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
];
// Шрифты кэшируются, если файлы лежат в папке fonts/ (их отсутствие не ломает установку).
const OPTIONAL = ['./fonts/golos-text-500.woff2', './fonts/golos-text-700.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
    await Promise.all(OPTIONAL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
  })());
  // Не активируемся сами: новая версия ждёт, пока пользователь нажмёт «Обновить».
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('planner-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // сторонних запросов у приложения нет
  if (url.pathname.endsWith('/version.json')) {
    // версия — по сети, если есть; иначе из кэша
    e.respondWith(fetch(req).catch(() => caches.match('./version.json')));
    return;
  }
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cached = await caches.match('./index.html', { ignoreSearch: true });
      if (cached) return cached;
      try { return await fetch(req); } catch { return (await caches.match('./offline.html')) || new Response('Нет соединения', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
    })());
    return;
  }
  e.respondWith((async () => {
    const cached = await caches.match(req) || await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res.ok && url.pathname.includes('/fonts/')) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    } catch {
      return new Response('', { status: 504 });
    }
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) { c.postMessage({ type: 'OPEN' }); return c.focus(); } }
    return self.clients.openWindow('./');
  })());
});
