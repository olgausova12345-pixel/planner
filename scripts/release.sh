#!/bin/sh
# Выпуск новой версии: меняет одну строку версии во всех файлах.
# Пример: sh scripts/release.sh 2026.11.05-1
set -e
NEW="$1"
[ -z "$NEW" ] && { echo "Укажите версию, например: sh scripts/release.sh 2026.11.05-1"; exit 1; }
cd "$(dirname "$0")/.."
OLD=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' version.json)
sed -i.bak "s/$OLD/$NEW/g" version.json sw.js index.html && rm -f version.json.bak sw.js.bak index.html.bak
echo "Версия: $OLD → $NEW"
grep -n "$NEW" version.json sw.js index.html
