/**
 * api.js — обёртка над Google Apps Script Web App.
 * Все HTTP-запросы идут сюда.
 *
 * DEMO_MODE: если CONFIG.GAS_URL не настроен (содержит заглушку "ВСТАВЬТЕ"),
 * все вызовы автоматически перенаправляются в локальный Mock (js/mock.js),
 * который эмулирует бэкенд на localStorage. Это позволяет полноценно
 * тестировать все 11 экранов PWA без развёртывания GAS и Google Sheets.
 *
 * Для перехода на боевую версию: впишите реальный URL в CONFIG.GAS_URL —
 * DEMO_MODE отключится автоматически.
 */

const CONFIG = {
  // URL вашего развёрнутого Google Apps Script Web App.
  // Чтобы включить боевой режим — замените на реальный URL.
  GAS_URL: 'https://script.google.com/macros/s/AKfycbyLL1X28X9RuZIQ5DjQLYxZyzV1jNSbBR0sL1fmeklhMaKR6QPYnctLX4Rz6gSry1Iibg/exec',
  REQUEST_TIMEOUT_MS: 20000,
  // Число попыток при сетевой ошибке (для нестабильного Wi-Fi на складе)
  RETRY_COUNT: 2,
  RETRY_DELAY_MS: 800
};

const Api = {

  // Включён ли демо-режим (без реального бэкенда)
  isDemoMode() {
    return !CONFIG.GAS_URL || typeof CONFIG.GAS_URL !== 'string' ||
      CONFIG.GAS_URL.indexOf('ВСТАВЬТЕ') !== -1 || CONFIG.GAS_URL.trim() === '';
  },

  _buildUrl(params) {
    const url = new URL(CONFIG.GAS_URL);
    if (params) {
      Object.keys(params).forEach(k => {
        if (params[k] !== undefined && params[k] !== null) {
          url.searchParams.set(k, params[k]);
        }
      });
    }
    return url.toString();
  },

  async _get(params) {
    // Демо-режим — направляем в Mock
    if (this.isDemoMode()) {
      return this._dispatchMock(params);
    }

    let lastErr;
    for (let attempt = 0; attempt <= CONFIG.RETRY_COUNT; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);
      try {
        const resp = await fetch(this._buildUrl(params), {
          method: 'GET',
          signal: controller.signal,
          redirect: 'follow'
        });
        const text = await resp.text();
        let data;
        try { data = JSON.parse(text); }
        catch (e) {
          throw new Error('GAS вернул не-JSON: ' + text.substring(0, 200));
        }
        if (data && data.error) throw new Error(data.error);
        return data;
      } catch (e) {
        lastErr = e;
        if (attempt < CONFIG.RETRY_COUNT) {
          await new Promise(r => setTimeout(r, CONFIG.RETRY_DELAY_MS));
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  },

  async _post(payload) {
    if (this.isDemoMode()) {
      return this._dispatchMockPost(payload);
    }

    let lastErr;
    for (let attempt = 0; attempt <= CONFIG.RETRY_COUNT; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);
      try {
        const resp = await fetch(CONFIG.GAS_URL, {
          method: 'POST',
          body: JSON.stringify(payload),
          redirect: 'follow',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        });
        const text = await resp.text();
        let data;
        try { data = JSON.parse(text); }
        catch (e) {
          throw new Error('GAS вернул не-JSON: ' + text.substring(0, 200));
        }
        if (data && data.error) throw new Error(data.error);
        return data;
      } catch (e) {
        lastErr = e;
        if (attempt < CONFIG.RETRY_COUNT) {
          await new Promise(r => setTimeout(r, CONFIG.RETRY_DELAY_MS));
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  },

  // Маршрутизация GET-запросов в Mock по action
  async _dispatchMock(params) {
    const action = params.action;
    switch (action) {
      case 'ping':           return Mock.ping();
      case 'login':          return Mock.login(params.badge);
      case 'supplies':       return Mock.supplies();
      case 'supply_detail':  return Mock.supplyDetail(params.supply_id);
      case 'print_queue':    return Mock.printQueue();
      case 'reprint_status': return Mock.reprintStatus(params.supply_id, params.unit_row);
      case 'admin_stats':    return Mock.adminStats();
      default: throw new Error('Демо: неизвестный GET-action: ' + action);
    }
  },

  // Маршрутизация POST-запросов в Mock по action
  async _dispatchMockPost(payload) {
    const action = payload.action;
    switch (action) {
      case 'take_unit':        return Mock.takeUnit(payload);
      case 'scan_unit':        return Mock.scanUnit(payload);
      case 'complete_packing': return Mock.completePacking(payload);
      case 'reprint_code':     return Mock.reprintCode(payload);
      case 'confirm_printed':  return Mock.confirmPrinted(payload);
      case 'admin_add_supply': return Mock.adminAddSupply(payload);
      case 'admin_toggle_supply': return Mock.adminToggleSupply(payload);
      default: throw new Error('Демо: неизвестный POST-action: ' + action);
    }
  },

  // === ENDPOINTS ===

  ping() {
    return this._get({ action: 'ping' });
  },

  login(badge) {
    return this._get({ action: 'login', badge });
  },

  getSupplies() {
    return this._get({ action: 'supplies' });
  },

  getSupplyDetail(supplyId) {
    return this._get({ action: 'supply_detail', supply_id: supplyId });
  },

  takeUnit(supplyId, unitRow, badge, fio) {
    return this._post({
      action: 'take_unit',
      supply_id: supplyId,
      unit_row: unitRow,
      badge, fio
    });
  },

  scanUnit(supplyId, unitRow, scannedBarcode, continueFromCurrent) {
    return this._post({
      action: 'scan_unit',
      supply_id: supplyId,
      unit_row: unitRow,
      scanned_barcode: scannedBarcode,
      continue_from_current: !!continueFromCurrent
    });
  },

  completePacking(payload) {
    return this._post(Object.assign({ action: 'complete_packing' }, payload));
  },

  reprintCode(supplyId, unitRow, codeIndex, badge, unitBarcode) {
    return this._post({
      action: 'reprint_code',
      supply_id: supplyId,
      unit_row: unitRow,
      code_index: codeIndex,
      badge,
      unit_barcode: unitBarcode || ''
    });
  },

  reprintStatus(supplyId, unitRow) {
    return this._get({
      action: 'reprint_status',
      supply_id: supplyId,
      unit_row: unitRow
    });
  },

  // === PRINT-SERVER ENDPOINTS (для Python datamatrix.py) ===

  printQueue() {
    return this._get({ action: 'print_queue' });
  },

  confirmPrinted(jobId, printedCount) {
    return this._post({
      action: 'confirm_printed',
      job_id: jobId,
      printed_count: printedCount
    });
  },

  // === ADMIN ENDPOINTS ===

  adminStats() {
    return this._get({ action: 'admin_stats' });
  },

  adminAddSupply(name, tsv) {
    return this._post({
      action: 'admin_add_supply',
      name: name,
      tsv: tsv
    });
  },

  adminToggleSupply(supplyId, isActive) {
    return this._post({
      action: 'admin_toggle_supply',
      supply_id: supplyId,
      is_active: isActive
    });
  }
};
