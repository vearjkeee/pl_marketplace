/**
 * storage.js — работа с localStorage.
 * Хранит текущую сессию, состояние упаковки, кеш поставок и НАСТРОЙКИ.
 *
 * Важно: сессия НЕ сбрасывается при бездействии (согласно ТЗ — сотрудник
 * обязан завершить наряд). Сбрасывается только при явном выходе или
 * закрытии/перезагрузке приложения (тогда выкидывает на логин, но
 * незавершённое задание сохраняется и предлагается продолжить).
 */

const Storage = {
  KEYS: {
    SESSION:       'pl_session',         // { badge, fio, role, loginTime }
    CURRENT:       'pl_current',         // { supplyId, unitRow, step, ... } — текущее состояние упаковки
    SUPPLY_CACHE:  'pl_supplies_cache',  // кеш списка поставок (на 60 сек)
    SETTINGS:      'pl_settings',        // настройки приложения (вкл. allow_discard_tape)
    DEMO_STATE:    'pl_demo_state'       // состояние демо-бэкенда (мок-данные)
  },

  // Настройки по умолчанию
  DEFAULT_SETTINGS: {
    allow_discard_tape: false,   // Issue 3: запрет на выбрасывание ленты (по умолчанию ЗАПРЕЩЕНО)
    sound_on_scan: true,         // звуковой сигнал при сканировании
    vibrate_on_scan: true,       // виброотклик (если поддерживается)
    keep_screen_on: true,        // не гасить экран (wake lock)
    font_scale: 1.0              // масштаб шрифта (для маленького экрана PM451)
  },

  get(key, defaultValue) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : defaultValue;
    } catch (e) {
      return defaultValue;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error('Storage.set error:', e);
    }
  },

  remove(key) {
    localStorage.removeItem(key);
  },

  // --- Сессия ---

  getSession() {
    return this.get(this.KEYS.SESSION, null);
  },

  setSession(session) {
    this.set(this.KEYS.SESSION, session);
  },

  clearSession() {
    this.remove(this.KEYS.SESSION);
  },

  isLoggedIn() {
    const s = this.getSession();
    return !!(s && s.badge && s.fio);
  },

  // --- Текущее состояние упаковки (для возобновления) ---

  getCurrent() {
    return this.get(this.KEYS.CURRENT, null);
  },

  setCurrent(state) {
    this.set(this.KEYS.CURRENT, state);
  },

  updateCurrent(patch) {
    const cur = this.getCurrent() || {};
    this.setCurrent(Object.assign({}, cur, patch));
  },

  clearCurrent() {
    this.remove(this.KEYS.CURRENT);
  },

  hasCurrent() {
    return this.getCurrent() !== null;
  },

  // --- Кеш поставок ---

  getSuppliesCache() {
    const c = this.get(this.KEYS.SUPPLY_CACHE, null);
    if (!c) return null;
    // TTL 60 секунд
    if (Date.now() - c.ts > 60000) return null;
    return c.data;
  },

  setSuppliesCache(data) {
    this.set(this.KEYS.SUPPLY_CACHE, { ts: Date.now(), data });
  },

  clearSuppliesCache() {
    this.remove(this.KEYS.SUPPLY_CACHE);
  },

  // --- Настройки ---

  getSettings() {
    const stored = this.get(this.KEYS.SETTINGS, {});
    // сливаем с дефолтами, чтобы новые настройки появлялись автоматически
    return Object.assign({}, this.DEFAULT_SETTINGS, stored);
  },

  getSetting(key) {
    return this.getSettings()[key];
  },

  setSetting(key, value) {
    const settings = this.getSettings();
    settings[key] = value;
    this.set(this.KEYS.SETTINGS, settings);
  },

  setSettings(settings) {
    const merged = Object.assign({}, this.DEFAULT_SETTINGS, settings);
    this.set(this.KEYS.SETTINGS, merged);
  },

  // --- Демо-состояние (используется api.js в DEMO_MODE) ---

  getDemoState() {
    return this.get(this.KEYS.DEMO_STATE, null);
  },

  setDemoState(state) {
    this.set(this.KEYS.DEMO_STATE, state);
  },

  clearDemoState() {
    this.remove(this.KEYS.DEMO_STATE);
  }
};
