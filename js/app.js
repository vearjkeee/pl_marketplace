/**
 * app.js — главный модуль: роутинг, регистрация Service Worker, утилиты.
 */

const App = {
  currentScreen: null,
  currentParams: null,
  container: null,
  _demoBadge: null,

  init() {
    this.container = document.getElementById('app');

    // Регистрация Service Worker (офлайн-кеш интерфейса)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js')
        .then(() => console.log('[PL] Service Worker зарегистрирован'))
        .catch(err => console.warn('[PL] SW registration failed:', err));
    }

    // Демо-бейдж (если GAS_URL не настроен)
    if (Api.isDemoMode()) {
      this._showDemoBadge();
      console.log('[PL] Работает в ДЕМО-режиме (без GAS). Бейджи: 20BARANCHIK, 20SIDOROV, 20IVANOV, 20ADMIN');
    }

    // Запрашиваем wake lock (не гасить экран)
    Scanner.requestWakeLock();

    // Применяем масштаб шрифта из настроек
    this._applyFontScale();

    // Стартовый экран
    if (Storage.isLoggedIn()) {
      if (Storage.hasCurrent()) {
        Screens.confirmResume.show();
      } else {
        this.navigate('supplies');
      }
    } else {
      this.navigate('login');
    }

    // Обработка кнопки "Назад" в браузере / на терминале
    window.addEventListener('popstate', () => {
      if (this.currentScreen === 'supplies' && Storage.isLoggedIn()) {
        // На списке поставок — не выходим, чтобы случайно не закрыть приложение
        return;
      }
    });

    // Предотвращаем случайный зум двойным тапом на PM451
    let lastTouchEnd = 0;
    document.addEventListener('touchend', (e) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) { e.preventDefault(); }
      lastTouchEnd = now;
    }, { passive: false });
  },

  /**
   * Показать демо-бейдж в углу экрана.
   */
  _showDemoBadge() {
    if (this._demoBadge) return;
    const b = document.createElement('div');
    b.className = 'demo-badge';
    b.textContent = 'ДЕМО-РЕЖИМ';
    document.body.appendChild(b);
    this._demoBadge = b;
  },

  /**
   * Применить масштаб шрифта из настроек.
   */
  _applyFontScale() {
    const scale = Storage.getSetting('font_scale') || 1.0;
    if (scale !== 1.0) {
      document.documentElement.style.fontSize = (16 * scale) + 'px';
    }
  },

  /**
   * Перейти на экран.
   * @param {string} name — имя экрана в Screens
   * @param {object} params — параметры для render/bind
   */
  navigate(name, params) {
    const screen = Screens[name];
    if (!screen) {
      console.error('Неизвестный экран:', name);
      return;
    }

    this.currentScreen = name;
    this.currentParams = params || {};

    // Сбрасываем стек фокуса при смене экрана
    Scanner._focusStack = [];
    Scanner._isLocked = false;

    this.container.innerHTML = screen.render(this.currentParams);

    if (screen.bind) {
      // bind может быть async — обернём в промис
      Promise.resolve(screen.bind(this.container, this.currentParams))
        .catch(err => {
          console.error('[PL] Ошибка в bind экрана', name, err);
          this.container.innerHTML += `<div class="alert alert--error">Ошибка: ${this._escape(err.message)}</div>`;
        });
    }

    // Скролл наверх
    window.scrollTo(0, 0);
  },

  /**
   * Показать короткое тост-уведомление.
   */
  toast(message, type) {
    const t = document.createElement('div');
    t.className = 'toast' + (type ? ' toast--' + type : '');
    t.textContent = message;
    document.body.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity 0.3s';
      t.style.opacity = '0';
      setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
    }, 2200);
  },

  /**
   * Экранирование HTML (защита от инъекций в динамических строках).
   */
  _escape(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
};

// Запуск приложения после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
