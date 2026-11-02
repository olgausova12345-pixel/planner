// Собирает папку www для Android-версии из файлов сайта.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
const FILES = ['index.html', 'boot.js', 'app.js', 'logic.js', 'db.js', 'birthdays.js', 'native.js', 'styles.css',
  'manifest.webmanifest', 'version.json', 'offline.html', 'offline.js'];
const DIRS = ['icons', 'fonts', 'titles'];
rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const f of FILES) cpSync(f, `www/${f}`);
for (const d of DIRS) if (existsSync(d)) cpSync(d, `www/${d}`, { recursive: true });
// Capacitor встраивает свой мост в страницу отдельным скриптом — сайтовая CSP его бы заблокировала.
// В приложении страница грузится только из самого APK, поэтому CSP ослабляем до «только свои файлы».
let html = readFileSync('www/index.html', 'utf8');
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,
  `<meta http-equiv="Content-Security-Policy" content="default-src 'self' capacitor: https://localhost; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://localhost capacitor:; object-src 'none'">`);
writeFileSync('www/index.html', html);
console.log('www готова');
