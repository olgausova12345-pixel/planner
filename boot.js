// boot.js — выполняется до отрисовки: тема и размер текста без мигания.
(function () {
  var root = document.documentElement;
  var theme = 'auto', scale = 1;
  try {
    theme = localStorage.getItem('planner.theme') || 'auto';
    var s = parseFloat(localStorage.getItem('planner.scale'));
    if (s >= 0.5 && s <= 1.5) scale = s;
  } catch (e) { /* хранилище недоступно */ }
  var FEST = { halloween: ['#140B1A', true], newyear: ['#0B1630', true], patrick: ['#0E2214', true] };
  var fest = FEST[theme];
  var dark = fest ? fest[1] : (theme === 'dark' || (theme === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches));
  root.dataset.theme = fest ? theme : (dark ? 'dark' : 'light');
  root.dataset.themePref = theme;
  root.style.colorScheme = dark ? 'dark' : 'light';
  root.style.setProperty('--scale', String(scale));
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', fest ? fest[0] : (dark ? '#0E1716' : '#0B4F4A'));
  // Раскладка по ширине в rem: 1rem = 24px × масштаб
  var rem = 24 * scale;
  root.dataset.layout = (window.innerWidth / rem) >= 30 ? 'wide' : 'narrow';
})();
