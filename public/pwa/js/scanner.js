/**
 * scanner.js — утилиты для работы со сканером Point Mobile PM451.
 *
 * Сканер настраивается через DataWedge в режиме "Keyboard emulation" —
 * при сканировании вводит текст в активное поле ввода и автоматически
 * нажимает Enter.
 *
 * УЛУЧШЕНИЯ (Issues 1 и 5):
 *  - Стек фокуса: при открытии модального окна ввод "пушится" в стек,
 *    фокус переходит на поле модалки; при закрытии — восстанавливается.
 *  - Надёжный авто-возврат фокуса (защита от потери фокуса на PM451).
 *  - Wake Lock: экран не гаснет во время упаковки.
 *  - Звук/вибро-отклик при успешном сканировании (настраивается).
 *  - Защита от двойного срабатывания (debounce по значению).
 */

const Scanner = {
  // Стек полей ввода для восстановления фокуса
  _focusStack: [],
  // Текущее "основное" поле экрана (не модальное)
  _activeInput: null,
  // Заблокирован ли авто-фокус (модалкой)
  _isLocked: false,
  // Wake lock sentinel
  _wakeLock: null,
  // Анти-дубликат: последнее отсканированное значение + время
  _lastScan: { value: '', time: 0 },
  // Флаг: показано ли сейчас модальное окно
  _modalOpen: false,

  /**
   * Привязывает обработчик сканирования к полю ввода.
   * @param {HTMLInputElement} input
   * @param {function(string)} onScan — вызывается с отсканированным значением
   * @param {object} [opts] — { isPrimary: bool, debounceMs: number }
   */
  bind(input, onScan, opts) {
    if (!input) return;
    opts = opts || {};
    const isPrimary = opts.isPrimary !== false;

    if (isPrimary) {
      this._activeInput = input;
    }

    // Обработчик Enter (сканер шлёт Enter в конце)
    const handler = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const value = input.value.trim();
        if (!value) return;

        // Анти-дубликат: один и тот же код за <400мс — игнорируем
        const now = Date.now();
        const debounce = opts.debounceMs || 400;
        if (this._lastScan.value === value && (now - this._lastScan.time) < debounce) {
          input.value = '';
          return;
        }
        this._lastScan = { value, time: now };

        // Обратная связь
        this._feedback();

        // Вызываем обработчик
        try {
          onScan(value);
        } catch (err) {
          console.error('[Scanner] Ошибка в onScan:', err);
        }
        // Очищаем поле после сканирования
        input.value = '';
      }
    };
    input.addEventListener('keydown', handler);

    // Сохраняем обработчик для возможности снять (на случай перерисовки)
    input._plScanHandler = handler;

    // Авто-возврат фокуса при потере (если не заблокирован модалкой)
    input.addEventListener('blur', () => {
      // Небольшая задержка, чтобы клики по кнопкам успели сработать
      setTimeout(() => {
        if (!document.body.contains(input)) return;   // поле удалено из DOM
        if (this._isLocked) return;                    // открыта модалка
        // Если фокус ушёл на другое поле ввода — не возвращаем
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
        // Иначе возвращаем фокус на это поле (если оно основное)
        if (isPrimary && this._activeInput === input) {
          try { input.focus(); } catch (e) {}
        }
      }, 120);
    });

    // Авто-фокус при показе
    this.focus(input);
  },

  /**
   * Установить фокус на поле ввода (надёжно, с повторной попыткой).
   */
  focus(input) {
    if (!input) return;
    // Первая попытка сразу
    try { input.focus({ preventScroll: true }); } catch (e) {}
    // Повторная через 50мс (на случай если элемент ещё не виден)
    setTimeout(() => {
      if (document.body.contains(input)) {
        try { input.focus({ preventScroll: true }); input.select(); } catch (e) {}
      }
    }, 50);
    // И ещё одна через 150мс (для медленных переходов между экранами)
    setTimeout(() => {
      if (document.body.contains(input)) {
        try { input.focus({ preventScroll: true }); } catch (e) {}
      }
    }, 150);
  },

  /**
   * Сделать поле "основным" для текущего экрана.
   */
  setPrimary(input) {
    this._activeInput = input;
    this.focus(input);
  },

  /**
   * Открыть модальный контекст: запомнить текущее поле, заблокировать
   * авто-фокус основного поля. (Issue 5 — синхронизация фокуса с модалками)
   */
  openModal(input) {
    this._modalOpen = true;
    this._isLocked = true;
    if (this._activeInput) {
      this._focusStack.push(this._activeInput);
    }
    if (input) {
      this._activeInput = input;
      this.focus(input);
    }
  },

  /**
   * Закрыть модальный контекст: восстановить фокус на предыдущем поле.
   */
  closeModal() {
    this._modalOpen = false;
    this._isLocked = false;
    const prev = this._focusStack.pop();
    if (prev && document.body.contains(prev)) {
      this._activeInput = prev;
      this.focus(prev);
    }
  },

  /**
   * Совместимость со старым API: lockFocus/unlockFocus.
   */
  lockFocus() { this._isLocked = true; },
  unlockFocus() {
    this._isLocked = false;
    // Восстанавливаем фокус на активном поле
    if (this._activeInput && document.body.contains(this._activeInput)) {
      this.focus(this._activeInput);
    }
  },

  /**
   * Восстановить фокус на активном поле (вызывать после навигации).
   */
  restoreFocus() {
    if (this._isLocked) return;
    if (this._activeInput && document.body.contains(this._activeInput)) {
      this.focus(this._activeInput);
    }
  },

  /**
   * Звуковой/вибро отклик при сканировании.
   */
  _feedback() {
    const settings = Storage.getSettings();
    // Вибро
    if (settings.vibrate_on_scan && navigator.vibrate) {
      try { navigator.vibrate(40); } catch (e) {}
    }
    // Короткий звуковой сигнал через WebAudio (не требует файлов)
    if (settings.sound_on_scan) {
      try {
        if (!this._audioCtx) {
          this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        const ctx = this._audioCtx;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.12);
      } catch (e) {}
    }
  },

  /**
   * Сигнал ошибки (низкий тон).
   */
  errorFeedback() {
    const settings = Storage.getSettings();
    if (settings.vibrate_on_scan && navigator.vibrate) {
      try { navigator.vibrate([60, 40, 60]); } catch (e) {}
    }
    try {
      if (!this._audioCtx) {
        this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = this._audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 220;
      osc.type = 'square';
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.2);
    } catch (e) {}
  },

  // === WAKE LOCK (не гасить экран) ===

  async requestWakeLock() {
    const settings = Storage.getSettings();
    if (!settings.keep_screen_on) return;
    if (!('wakeLock' in navigator)) return;
    try {
      this._wakeLock = await navigator.wakeLock.request('screen');
      console.log('[Scanner] Wake Lock активен');
      // При потере (например, сворачивание страницы) — переподключаем
      this._wakeLock.addEventListener('release', () => {
        console.log('[Scanner] Wake Lock отпущен, пробую переподключить');
        setTimeout(() => this.requestWakeLock(), 1000);
      });
    } catch (e) {
      console.warn('[Scanner] Wake Lock не получен:', e.message);
    }
  },

  releaseWakeLock() {
    if (this._wakeLock) {
      try { this._wakeLock.release(); } catch (e) {}
      this._wakeLock = null;
    }
  }
};

// Возвращаем wake lock при возврате на страницу (visibilitychange)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    Scanner.requestWakeLock();
  }
});
