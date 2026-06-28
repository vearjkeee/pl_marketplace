# Установка — пошаговое руководство

## 1. Google Таблица

1. Создайте новую Google Таблицу.
2. Скопируйте ID из URL: `https://docs.google.com/spreadsheets/d/`**`<ID>`**`/edit`
3. Откройте `gas/Code.gs`, вставьте ID в `SPREADSHEET_ID`.
4. В редакторе Apps Script выполните функцию `setupFirstTime()` (Run) — создаст служебные листы и пример сотрудника.

## 2. Развёртывание GAS Web App

1. В редакторе Apps Script: **Deploy → New deployment → Web app**.
2. Description: `PL Warehouse v1`; Execute as: **Me**; Who has access: **Anyone**.
3. Скопируйте URL развёртывания (`https://script.google.com/macros/s/<ID>/exec`).
4. Вставьте URL в:
   - `js/api.js` → `CONFIG.GAS_URL`
   - `printer/config.json` → `gas.webapp_url`

## 3. PWA на терминале PM451

1. Разместите файлы PWA (всё содержимое `pl-warehouse-pwa/` кроме `gas/` и `printer/`) на любом HTTPS-хостинге (GitHub Pages, Netlify, или свой сервер).
2. На PM451 откройте URL в браузере Chrome.
3. Добавьте на главный экран (Chrome menu → Add to Home screen) — установится как PWA.
4. Настройте DataWedge (см. [PM451_SETUP.md](PM451_SETUP.md)).

## 4. Сервер печати

1. На складском ПК с принтером Zebra ZM400 установите Python 3.10+.
2. `pip install pywin32 requests`
3. Отредактируйте `printer/config.json` (URL GAS, имя принтера, DPI).
4. Поместите файлы пулов кодов в `printer/labels/` (имя содержит ШК юнита, напр. `4895165564564.txt`).
5. Запустите: `python datamatrix.py` (или `python datamatrix.py --test` для теста одной этикетки).

## 5. Проверка

- `?action=ping` в браузере → `{"status":"ok",...}`
- Войдите бейджем `20SIDOROV` (из примера) в PWA.
- На принтере должна напечататься тестовая этикетка.

## Демо-режим (без бэкенда)

Оставьте `CONFIG.GAS_URL` с заглушкой — PWA работает на `mock.js`. Бейджи: `20SIDOROV`, `20IVANOV`, `20PETROV`, `20ADMIN`.
