/**
 * mock.js — локальный демо-бэкенд (имитация Google Apps Script).
 *
 * Включается автоматически в api.js, если CONFIG.GAS_URL не настроен
 * (содержит заглушку "ВСТАВЬТЕ"). Позволяет полностью протестировать
 * все 11 экранов PWA прямо в браузере без развёртывания GAS и Google Sheets.
 *
 * Состояние хранится в localStorage (ключ pl_demo_state), что эмулирует
 * persistence Google Sheets между перезагрузками.
 */

const Mock = {

  // --- Инициализация демо-данных при первом запуске ---
  _seed() {
    const existing = Storage.getDemoState();
    if (existing) return existing;

    const now = Date.now();

    const state = {
      employees: [
        { badge_id: 'BARANCHIK', fio: 'Баранчик Валерия Игоревна', role: 'packer' },
        { badge_id: 'SIDOROV',   fio: 'Сидоров А.В.',              role: 'packer' },
        { badge_id: 'IVANOV',    fio: 'Иванов П.С.',               role: 'packer' },
        { badge_id: 'PETROV',    fio: 'Петров И.К.',               role: 'admin'  },
        { badge_id: 'ADMIN',     fio: 'Администратор',             role: 'admin'  }
      ],
      supplies: [
        {
          supply_id: 'SUP-001',
          name: 'Wildberries — Парфюмерия ИМП',
          created_at: now - 86400000,
          is_active: true,
          sheet_name: 'Поставка_1'
        },
        {
          supply_id: 'SUP-002',
          name: 'Ozon — РФ товары',
          created_at: now - 43200000,
          is_active: true,
          sheet_name: 'Поставка_2'
        }
      ],
      // Состав поставок (эмуляция листов "Поставка_N")
      sheets: {
        'SUP-001': [
          this._mkItem(1, 'Туалетная вода Dior Sauvage 100мл', '4895165564564', ' art-DS100', 72, 'ФРАНЦИЯ', '25х20', 0),
          this._mkItem(2, 'Парфюм Chanel Bleu 50мл',          '4895165564571', 'art-CB50',   36, 'ФРАНЦИЯ', '25х20', 12),
          this._mkItem(3, 'Туалетная вода Versace Eros 100мл', '4895165564588', 'art-VE100',  48, 'ИТАЛИЯ',  '30х25', 0),
          this._mkItem(4, 'Парфюм Lancome La Vie 50мл',       '4895165564595', 'art-LL50',   24, 'ФРАНЦИЯ', '25х20', 24)
        ],
        'SUP-002': [
          this._mkItem(1, 'Шампунь Natura Siberica 400мл', '4607034590012', 'art-NS400', 60, 'РОССИЯ', '25х20', 0),
          this._mkItem(2, 'Гель для душа Organic Shop 300мл','4607034590029','art-OS300', 48, 'РОССИЯ', '25х20', 18),
          this._mkItem(3, 'Крем Nivea 100мл',               '4607034590036', 'art-NV100', 30, 'РОССИЯ', '20х15', 0)
        ]
      },
      printJobs: [],
      statistics: [],
      boxes: [],
      jobSeq: 1,
      boxSeq: 1
    };

    Storage.setDemoState(state);
    return state;
  },

  _mkItem(num, name, unitBarcode, art, units, country, packSize, packed, opts) {
    opts = opts || {};
    return {
      num: num,
      name: name,
      unit_barcode: unitBarcode,
      barcode: opts.barcode || unitBarcode,
      art: art || '',
      sku: opts.sku || '',
      total_units: units,
      country: country,
      pack_size: packSize,
      expiry: opts.expiry || '',
      is_set: opts.is_set || false,         // признак родителя набора
      set_items: opts.set_items || null,    // массив элементов набора
      is_set_item: opts.is_set_item || false, // признак элемента набора
      // служебные
      row_index: num,
      status: packed >= units ? 'Packed' : (packed > 0 ? 'Taken' : 'Empty'),
      packer: packed > 0 && packed < units ? 'Сидоров А.В.' : '',
      packed_units: packed,
      time_taken: packed > 0 ? Date.now() - 3600000 : null,
      time_packed: packed >= units ? Date.now() - 1800000 : null
    };
  },

  _state() {
    return this._seed();
  },

  _save(state) {
    Storage.setDemoState(state);
  },

  _delay(ms) {
    return new Promise(r => setTimeout(r, ms || 250 + Math.random() * 200));
  },

  // --- Эндпоинты (возвращают Promise с данными, как настоящий GAS) ---

  async ping() {
    await this._delay(100);
    return { status: 'ok', demo: true, time: new Date().toISOString() };
  },

  async login(badge) {
    await this._delay();
    const st = this._state();
    // Бейджи сканируются с невидимым префиксом "20" (WMS).
    // В таблице хранятся БЕЗ префикса: BARANCHIK, SIDOROV.
    // Отрезаем префикс перед поиском.
    const cleanBadge = String(badge || '').trim();
    const lookup = cleanBadge.startsWith('20') ? cleanBadge.substring(2) : cleanBadge;
    const emp = st.employees.find(e => e.badge_id === lookup || e.badge_id === cleanBadge);
    if (!emp) {
      throw new Error('Бейдж не найден: ' + lookup + '. Проверь лист «Сотрудники» в Google Sheets.');
    }
    return { badge: emp.badge_id, fio: emp.fio, role: emp.role, demo: true };
  },

  async supplies() {
    await this._delay();
    const st = this._state();
    const list = st.supplies.filter(s => s.is_active).map(s => {
      const items = st.sheets[s.supply_id] || [];
      const total = items.reduce((a, b) => a + b.total_units, 0);
      const packed = items.reduce((a, b) => a + b.packed_units, 0);
      const pct = total > 0 ? Math.round(packed / total * 100) : 0;
      return {
        supply_id: s.supply_id,
        name: s.name,
        percent: pct,
        packed_units: packed,
        total_units: total
      };
    });
    return { supplies: list };
  },

  async supplyDetail(supplyId) {
    await this._delay();
    const st = this._state();
    const sup = st.supplies.find(s => s.supply_id === supplyId);
    if (!sup) throw new Error('Поставка не найдена');
    const items = (st.sheets[supplyId] || []).map(it => Object.assign({}, it));
    const total = items.reduce((a, b) => a + b.total_units, 0);
    const packed = items.reduce((a, b) => a + b.packed_units, 0);
    const pct = total > 0 ? Math.round(packed / total * 100) : 0;
    return {
      supply: { supply_id: sup.supply_id, name: sup.name, percent: pct },
      items: items
    };
  },

  async takeUnit(payload) {
    await this._delay();
    const st = this._state();
    const items = st.sheets[payload.supply_id];
    if (!items) throw new Error('Поставка не найдена');
    const item = items.find(i => i.row_index === payload.unit_row);
    if (!item) throw new Error('Юнит не найден');
    // Проверяем, не занят ли другим
    if (item.status === 'Taken' && item.packer && item.packer !== payload.fio) {
      throw new Error('Юнит уже в работе у: ' + item.packer);
    }
    if (item.status === 'Packed') {
      throw new Error('Юнит уже полностью упакован');
    }
    if (item.status === 'Empty') {
      item.status = 'Taken';
      item.packer = payload.fio;
      item.time_taken = Date.now();
      this._save(st);
    }
    return {
      status: 'ok',
      packer: item.packer,
      remaining_to_pack: Math.max(0, item.total_units - item.packed_units),
      already_packed: item.packed_units,
      total: item.total_units
    };
  },

  async scanUnit(payload) {
    await this._delay();
    const st = this._state();
    const items = st.sheets[payload.supply_id];
    if (!items) throw new Error('Поставка не найдена');
    const item = items.find(i => i.row_index === payload.unit_row);
    if (!item) throw new Error('Юнит не найден');

    // Определяем режим по стране
    if (item.country === 'РОССИЯ') {
      // РФ — поштучное сканирование, печать не нужна
      return {
        mode: 'ru_single',
        total: item.total_units,
        already_packed: item.packed_units,
        remaining: item.total_units - item.packed_units
      };
    }

    // Импорт — создаём задание на печать пула
    const already = item.packed_units;
    const startFrom = payload.continue_from_current
      ? (already > 0 ? already : 1)
      : (already > 0 ? already + 1 : 1);

    const job = {
      job_id: 'JOB-' + (st.jobSeq++),
      type: 'pool',
      supply_id: payload.supply_id,
      unit_row: payload.unit_row,
      unit_barcode: item.unit_barcode,
      start_from_index: startFrom,
      created_at: Date.now(),
      processed_at: null,
      status: 'pending',
      printed_count: 0
    };
    st.printJobs.push(job);
    this._save(st);

    return {
      mode: 'pool',
      print_job_id: job.job_id,  // алиас (как в GAS)
      job_id: job.job_id,
      unit_barcode: item.unit_barcode,
      item_name: item.name,
      start_from_index: startFrom,
      total: item.total_units,
      already_packed: already,
      remaining: item.total_units - already,
      total_in_file: null
    };
  },

  async completePacking(payload) {
    await this._delay();
    const st = this._state();
    const items = st.sheets[payload.supply_id];
    if (!items) throw new Error('Поставка не найдена');
    const item = items.find(i => i.row_index === payload.unit_row);
    if (!item) throw new Error('Юнит не найден');

    const newPacked = item.packed_units + payload.count_packed;
    item.packed_units = Math.min(newPacked, item.total_units);
    item.box = payload.box_barcode;

    // Срок годности
    if (payload.expiry_date) {
      item.expiry = payload.expiry_date;
    }

    const duration = item.time_taken ? Math.round((Date.now() - item.time_taken) / 1000) : 0;

    if (payload.is_complete || item.packed_units >= item.total_units) {
      item.status = 'Packed';
      item.time_packed = Date.now();
      item.duration_sec = duration;
    }

    // Регистрируем коробку
    let box = st.boxes.find(b => b.box_barcode === payload.box_barcode);
    if (!box) {
      box = {
        box_number: st.boxSeq++,
        supply_id: payload.supply_id,
        box_barcode: payload.box_barcode,
        created_at: Date.now(),
        created_by: payload.fio,
        first_unit_row: payload.unit_row,
        total_units: payload.count_packed
      };
      st.boxes.push(box);
    } else {
      box.total_units += payload.count_packed;
    }

    // Лог статистики
    st.statistics.push({
      timestamp: Date.now(),
      supply_id: payload.supply_id,
      unit_row: payload.unit_row,
      badge: payload.badge,
      fio: payload.fio,
      box_barcode: payload.box_barcode,
      box_number: box.box_number,
      count_packed: payload.count_packed,
      expiry_date: payload.expiry_date || '',
      is_complete: item.packed_units >= item.total_units
    });

    this._save(st);

    return {
      status: 'ok',
      new_packed: item.packed_units,
      packed_total: item.packed_units,  // алиас (как в GAS)
      total: item.total_units,
      remaining: Math.max(0, item.total_units - item.packed_units),
      is_complete: item.packed_units >= item.total_units,
      unit_complete: item.packed_units >= item.total_units,  // алиас
      box_number: box.box_number
    };
  },

  async reprintCode(payload) {
    await this._delay();
    const st = this._state();
    const job = {
      job_id: 'JOB-' + (st.jobSeq++),
      type: 'reprint',
      supply_id: payload.supply_id,
      unit_row: payload.unit_row,
      unit_barcode: payload.unit_barcode || '',
      start_from_index: payload.code_index,  // для reprint тут индекс кода
      created_at: Date.now(),
      processed_at: null,
      status: 'pending',
      printed_count: 0
    };
    st.printJobs.push(job);
    this._save(st);
    return { status: 'ok', print_job_id: job.job_id, job_id: job.job_id };
  },

  async reprintStatus(supplyId, unitRow) {
    await this._delay(150);
    const st = this._state();
    const items = st.sheets[supplyId];
    const item = items ? items.find(i => i.row_index === unitRow) : null;
    const started = item && item.packed_units > 0;
    return {
      started: started,
      has_started: started,  // алиас (как в GAS)
      next_index: started ? item.packed_units + 1 : 1,
      packed: item ? item.packed_units : 0,
      total: item ? item.total_units : 0,
      remaining: item ? Math.max(0, item.total_units - item.packed_units) : 0,
      status: item ? item.status : 'Empty'
    };
  },

  async printQueue() {
    await this._delay(100);
    const st = this._state();
    const jobs = st.printJobs.filter(j => j.status === 'pending').map(j => Object.assign({}, j));
    return { jobs: jobs };
  },

  async confirmPrinted(payload) {
    await this._delay(100);
    const st = this._state();
    const job = st.printJobs.find(j => j.job_id === payload.job_id);
    if (job) {
      job.status = 'printed';
      job.processed_at = Date.now();
      job.printed_count = payload.printed_count || 0;
      this._save(st);
    }
    return { status: 'ok' };
  },

  // --- Админ-эндпоинты ---

  async adminAddSupply(payload) {
    await this._delay();
    const st = this._state();
    const id = 'SUP-' + String(st.supplies.length + 1).padStart(3, '0');
    const sheet = 'Поставка_' + (st.supplies.length + 1);
    st.supplies.push({
      supply_id: id,
      name: payload.name,
      created_at: Date.now(),
      is_active: true,
      sheet_name: sheet
    });
    // Парсим TSV (новый формат с поддержкой наборов)
    const parsed = this._parseTsv(payload.tsv);
    st.sheets[id] = parsed.map((row, idx) => this._mkItem(
      idx + 1,
      row.name,
      row.unit_barcode,
      row.art,
      row.units,
      row.country,
      row.pack_size,
      0,
      {
        barcode: row.barcode,
        sku: row.sku,
        expiry: row.expiry,
        is_set: row.is_set,
        set_items: row.set_items
      }
    ));
    this._save(st);
    return { status: 'ok', supply_id: id };
  },

  async adminToggleSupply(payload) {
    await this._delay(150);
    const st = this._state();
    const sup = st.supplies.find(s => s.supply_id === payload.supply_id);
    if (sup) {
      sup.is_active = !!payload.is_active;
      this._save(st);
    }
    return { status: 'ok' };
  },

  async adminStats() {
    await this._delay();
    const st = this._state();
    return {
      statistics: st.statistics.slice(-50).reverse(),
      boxes: st.boxes.slice().reverse(),
      employees: st.employees,
      supplies: st.supplies.map(s => {
        const items = st.sheets[s.supply_id] || [];
        const total = items.reduce((a, b) => a + b.total_units, 0);
        const packed = items.reduce((a, b) => a + b.packed_units, 0);
        return {
          supply_id: s.supply_id,
          name: s.name,
          is_active: s.is_active,
          percent: total > 0 ? Math.round(packed / total * 100) : 0,
          total: total,
          packed: packed
        };
      })
    };
  },

  /**
   * Парсер TSV поставок.
   * Формат (8 колонок):
   *   1. Наименование товара
   *   2. ШК Юнит
   *   3. Артикул (Код товара)
   *   4. Юнитов
   *   5. Штрихкод
   *   6. SKU
   *   7. Страна производитель (или ВПП для наборов)
   *   8. ВПП (или Срок годности для наборов)
   *
   * Распознавание наборов:
   *   - Строка с ШК Юнит (кол.2) → самостоятельный товар / родитель набора
   *   - Строка БЕЗ ШК Юнит, но со Штрихкодом (кол.5) → элемент набора,
   *     привязывается к предыдущему родителю
   *   - Строка без ШК Юнит и без Штрихкода → ошибка/пустая (пропуск)
   *
   * Возвращает массив объектов: { type: 'item'|'set_item', ... }
   */
  _parseTsv(tsv) {
    if (!tsv) return [];
    const lines = tsv.replace(/\r\n/g, '\n').split(/\n/).filter(l => l.trim());
    if (lines.length === 0) return [];

    // Пропускаем заголовок (если первая строка похожа на него)
    const startIdx = /наименован|шк\s*юнит|артикул|страна|впп/i.test(lines[0]) ? 1 : 0;

    const rows = [];
    let currentSetParent = null;  // ссылка на родителя набора (для элементов)

    for (let i = startIdx; i < lines.length; i++) {
      const cols = lines[i].split(/\t/).map(c => c.trim());
      // добиваем до 8 колонок
      while (cols.length < 8) cols.push('');

      const name = cols[0];
      const unitBarcode = cols[1];
      const art = cols[2];
      const units = cols[3];
      const barcode = cols[4];
      const sku = cols[5];
      const col7 = cols[6];  // страна ИЛИ ВПП (для наборов)
      const col8 = cols[7];  // ВПП ИЛИ срок годности (для наборов)

      if (!name && !unitBarcode && !barcode) continue;  // пустая строка

      // Распознавание: элемент набора (нет ШК Юнит, но есть Штрихкод)
      if (!unitBarcode && barcode) {
        if (!currentSetParent) {
          // Элемент набора без родителя — пропускаем с предупреждением
          console.warn('[Mock] Элемент набора без родителя, строка пропущена:', name);
          continue;
        }
        currentSetParent.set_items.push({
          name: name,
          barcode: barcode,
          sku: sku || '',
          units: parseInt(units, 10) || 1
        });
        continue;
      }

      // Самостоятельный товар или родитель набора
      // Эвристика для col7/col8: что страна, что ВПП, что срок годности
      let country = '';
      let packSize = '';
      let expiry = '';

      const isDate = (s) => /^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(s);
      const isSize = (s) => /\d+\s*[хx]\s*\d+/i.test(s);

      if (isDate(col7)) { expiry = col7; }
      else if (isSize(col7)) { packSize = col7; }
      else if (col7) { country = col7; }

      if (isDate(col8)) { expiry = col8; }
      else if (isSize(col8)) { packSize = col8; }
      else if (col8 && !country) { country = col8; }

      if (!country) country = 'РОССИЯ';
      if (!packSize) packSize = '25х20';

      const item = {
        name: name,
        unit_barcode: unitBarcode,
        art: art,
        barcode: barcode || unitBarcode,
        sku: sku,
        units: parseInt(units, 10) || 1,
        country: country.toUpperCase(),
        pack_size: packSize,
        expiry: expiry,
        is_set: false,
        set_items: []
      };
      rows.push(item);
      currentSetParent = item;  // потенциальный родитель для следующих строк
    }

    // Помечаем родителями наборов те товары, у которых есть set_items
    rows.forEach(r => { if (r.set_items.length > 0) r.is_set = true; });
    return rows;
  },

  // Сброс демо-данных
  reset() {
    Storage.clearDemoState();
    this._seed();
  }
};
