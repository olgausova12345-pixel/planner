// Донастройка Android-проекта после `npx cap add android`: разрешения, версия, иконки.
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
const manifestPath = 'android/app/src/main/AndroidManifest.xml';
let m = readFileSync(manifestPath, 'utf8');
const perms = ['POST_NOTIFICATIONS', 'SCHEDULE_EXACT_ALARM', 'USE_EXACT_ALARM', 'RECEIVE_BOOT_COMPLETED', 'VIBRATE', 'WAKE_LOCK'];
for (const p of perms) {
  const line = `<uses-permission android:name="android.permission.${p}" />`;
  if (!m.includes(`android.permission.${p}"`)) m = m.replace('</manifest>', `    ${line}\n</manifest>`);
}
// Записи не уходят в облачную резервную копию Android (перенос на новый телефон напрямую — можно)
if (!m.includes('android:dataExtractionRules')) {
  m = m.replace('<application', '<application\n        android:dataExtractionRules="@xml/data_extraction_rules"\n        android:fullBackupContent="@xml/backup_rules"');
}
writeFileSync(manifestPath, m);

const gradlePath = 'android/app/build.gradle';
let g = readFileSync(gradlePath, 'utf8');
const version = JSON.parse(readFileSync('version.json', 'utf8')).version;
const code = Number(process.env.VERSION_CODE || 1);
g = g.replace(/versionCode \d+/, `versionCode ${code}`).replace(/versionName "[^"]*"/, `versionName "${version}"`);
writeFileSync(gradlePath, g);

cpSync('android-res', 'android/app/src/main/res', { recursive: true });
console.log(`Android-проект настроен: версия ${version} (${code})`);
