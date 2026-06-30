/**
 * sw.js — Service Worker для ПЛ Упаковка.
 * Кеширует статику PWA для офлайн-работы на терминалах PM451.
 * Запросы к GAS всегда идут в сеть (должны быть свежие).
 */

const CACHE_NAME = 'pl-warehouse-v11';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/storage.js',
  './js/mock.js',
  './js/api.js',
  './js/scanner.js',
  './js/screens.js',
  './js/app.js',
  './assets/logo.svg',
  './assets/icon-512.svg'
];

// Установка: предкешируем статику.
// Используем поштучное добавление (cache.addAll падает целиком,
// если хоть один ресурс недоступен — это плохо для first install).
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        ASSETS.map((url) =>
          cache.add(url).catch((err) => console.warn('[SW] не закешировано', url, err))
        )
      )
    ).then(() => self.skipWaiting())
  );
});

// Активация: чистим старый кеш.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Перехват запросов.
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Только GET; обращения к GAS всегда идут в сеть.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.includes('script.google.com') ||
      url.hostname.includes('googleusercontent.com')) {
    return;
  }

  // Стратегия: stale-while-revalidate для статики.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((resp) => {
          if (resp && resp.status === 200 && resp.type === 'basic') {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, clone));
          }
          return resp;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
