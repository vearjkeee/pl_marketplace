# Парфюм Логистик — Система упаковки для маркетплейсов

PWA-приложение для складских терминалов **Point Mobile PM451** для учёта упаковки
товаров для маркетплейсов (Wildberries, Ozon). Сотрудники сканируют бейджи,
выбирают поставки, упаковывают товары и печатают коды маркировки GS1 DataMatrix.

## Логотип

Чёрная буква **«П»** + красная **«Л»**, текст «Парфюм» (чёрный) + «Логистик» (красный).
Корпоративные цвета: `#FFFFFF` (фон), `#1A1A1A` (текст/полосы), `#E31E24` (акценты).

## Архитектура

```
PWA на PM451  ←HTTPS→  Google Apps Script Web App  ←→  Google Sheets
                         ↑
              GET /print_queue · POST /confirm_printed
                         |
              Python сервер печати  →  Принтер Zebra ZM400 (ZPL, RAW)
```

## Структура репозитория

```
pl-warehouse-pwa/
├── .gitignore
├── .env.example                ← пример переменных окружения
├── README.md                   ← этот файл
├── package.json, tsconfig.json, next.config.ts, eslint.config.mjs
├── bun.lock
├── src/app/                    ← Next.js 16 обёртка (iframe для PWA)
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
└── public/pwa/                 ← PWA (vanilla JS, отдельные модули)
    ├── index.html              ← точка входа PWA
    ├── manifest.json           ← PWA манифест
    ├── sw.js                   ← Service Worker (офлайн-кеш)
    ├── css/style.css           ← корпоративные стили ПЛ
    ├── js/
    │   ├── app.js              ← роутинг, инициализация, регистрация SW
    │   ├── api.js              ← обёртка над GAS (GET/POST) + DEMO_MODE
    │   ├── mock.js             ← демо-бэкенд (localStorage) для тестирования
    │   ├── scanner.js          ← логика сканера (Enter=submit, автофокус, wake lock)
    │   ├── storage.js          ← localStorage: сессия, состояние, настройки, кеш
    │   └── screens.js          ← 12 экранов приложения
    ├── assets/
    │   ├── logo.svg            ← логотип ПЛ (большой, для логина)
    │   └── icon-512.svg        ← иконка PWA
    ├── gas/
    │   └── Code.gs             ← бэкенд Google Apps Script
    ├── printer/
    │   ├── datamatrix.py       ← сервер печати (читает «Задания_печати»)
    │   └── config.json         ← настройки: GAS_URL, принтер, DPI, размеры
    ├── docs/
    │   ├── SETUP.md            ← пошаговая установка
    │   ├── TABLE_STRUCTURE.md  ← структура всех листов таблицы
    │   ├── PM451_SETUP.md      ← настройка DataWedge на терминале
    │   └── ADD_SUPPLY.md       ← добавление новых поставок
    └── README.md               ← детальный README PWA
```

## Демо-режим (без бэкенда)

Если `CONFIG.GAS_URL` в `public/pwa/js/api.js` не настроен (содержит заглушку
`ВСТАВЬТЕ...`), PWA автоматически работает в **демо-режиме**: все запросы
обрабатываются локальным модулем `mock.js` на `localStorage`. Это позволяет
тестировать все 12 экранов без развёртывания GAS и Google Sheets.

**Демо-бейджи для входа:**

| Бейдж | Роль | Возможности |
|-------|------|-------------|
| `20SIDOROV` | packer | упаковка товаров |
| `20IVANOV` | packer | упаковка товаров |
| `20PETROV` | admin | упаковка + админ-экран |
| `20ADMIN` | admin | упаковка + админ-экран |

## Что реализовано

- ✅ **Issue 1** — крупные шрифты/таргеты для PM451, авто-возврат фокуса, wake lock, звук/вибро
- ✅ **Issue 2** — РФ-счётчик: проверка дубликатов, лимита, undo, валидация GS1, частичная отмена
- ✅ **Issue 3** — административный запрет на выбрасывание ленты (`allow_discard_tape`) + override администратора
- ✅ **Issue 4** — админ-экран: список поставок, добавление (TSV), статистика, настройки
- ✅ **Issue 5** — синхронизация фокуса с модалками через стек (`Scanner.openModal/closeModal`)
- ✅ DEMO_MODE для тестирования без бэкенда
- ✅ Анти-дубликат сканов (debounce), HTML-эскейпинг, retry сетевых запросов

## Быстрый старт (локально)

```bash
# 1. Установить зависимости
bun install        # или: npm install / pnpm install

# 2. Запустить dev-сервер
bun run dev        # http://localhost:3000

# 3. Открыть в браузере, войти демо-бейджем 20SIDOROV
```

## Переход на боевую версию

3 заглушки для замены (подробно в [`public/pwa/docs/SETUP.md`](public/pwa/docs/SETUP.md)):

1. **`public/pwa/gas/Code.gs`** → `SPREADSHEET_ID` (ID таблицы из URL)
2. **`public/pwa/js/api.js`** → `CONFIG.GAS_URL` (URL развёрнутого Web App)
3. **`public/pwa/printer/config.json`** → `gas.webapp_url` (тот же URL)

После замены `GAS_URL` демо-режим **отключится автоматически** — все запросы
пойдут в реальный GAS.

## Документация

- [`public/pwa/docs/SETUP.md`](public/pwa/docs/SETUP.md) — пошаговая установка
- [`public/pwa/docs/TABLE_STRUCTURE.md`](public/pwa/docs/TABLE_STRUCTURE.md) — структура Google Таблицы
- [`public/pwa/docs/PM451_SETUP.md`](public/pwa/docs/PM451_SETUP.md) — настройка DataWedge на PM451
- [`public/pwa/docs/ADD_SUPPLY.md`](public/pwa/docs/ADD_SUPPLY.md) — добавление поставок

## Технологии

- **PWA**: HTML/CSS/vanilla JS (без фреймворков), Service Worker
- **Обёртка**: Next.js 16 + TypeScript (только для раздачи статики PWA через iframe)
- **Бэкенд**: Google Apps Script Web App
- **БД**: Google Sheets (5 служебных листов + листы поставок)
- **Сервер печати**: Python 3 + win32print
- **Принтер**: Zebra ZM400 (ZPL, RAW)
- **Терминал**: Point Mobile PM451 (DataWedge, Keyboard emulation + Auto-enter)

## Лицензия

Корпоративное ПО. Все права защищены.
