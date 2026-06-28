/**
 * ============================================================
 *  Парфюм Логистик — Система упаковки для маркетплейсов
 *  Backend: Google Apps Script Web App
 * ============================================================
 *
 *  Структура таблицы:
 *    Лист "Сотрудники"      — A: badge_id (например "20SIDOROV"), B: fio, C: role
 *    Лист "Поставки"        — A: supply_id, B: name, C: created_at, D: is_active, E: sheet_name
 *    Лист "Поставка_..."    — состав поставки (см. docs/TABLE_STRUCTURE.md)
 *    Лист "Задания_печати"  — очередь заданий для Python сервера
 *    Лист "Статистика"      — лог упаковки по каждому юниту
 *    Лист "Короба"          — реестр коробок по поставкам
 *
 *  Настройка:
 *    1. Вставьте SPREADSHEET_ID (из URL таблицы).
 *    2. Запустите setupFirstTime() один раз — создаст служебные листы
 *       и добавит служебные колонки к существующим листам поставок.
 *    3. Deploy → New deployment → Web app → Execute as: Me → Access: Anyone.
 *    4. Скопируйте URL в js/api.js (CONFIG.GAS_URL) и printer/config.json.
 *
 *  Имена полей в ответах совпадают с теми, что ждёт PWA (js/api.js + js/mock.js).
 * ============================================================
 */

var SPREADSHEET_ID = "ВСТАВЬТЕ_ID_ТАБЛИЦЫ_СЮДА";

var SHEET_EMPLOYEES   = "Сотрудники";
var SHEET_SUPPLIES    = "Поставки";
var SHEET_PRINT_QUEUE = "Задания_печати";
var SHEET_STATS       = "Статистика";
var SHEET_BOXES       = "Короба";

var PREFIX_BADGE    = "20";  // префикс бейджа сотрудника
var PREFIX_BOX      = "22";  // префикс ШК коробки
var DEFAULT_EXPIRY  = "";

var STATUS_EMPTY  = "Empty";
var STATUS_TAKEN  = "Taken";
var STATUS_PACKED = "Packed";

var TURNOFF_DEFAULT_MINUTES = 240; // 4 часа бездействия — зарезервировано

// ==================== УТИЛИТЫ ====================

function ss() {
  if (SPREADSHEET_ID === "ВСТАВЬТЕ_ID_ТАБЛИЦЫ_СЮДА") {
    throw new Error("SPREADSHEET_ID не настроен в Code.gs");
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getSheet(name) {
  var s = ss().getSheetByName(name);
  if (!s) throw new Error("Лист не найден: " + name);
  return s;
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function errOut(msg) {
  return jsonOut({ error: msg });
}

/**
 * Прочитать лист в массив объектов с ключами по заголовкам.
 * Добавляет служебное поле _rowIndex (1-индекс для getRange, +1 за заголовок).
 */
function readSheet(name) {
  var s = getSheet(name);
  var values = s.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      row[headers[j]] = values[i][j];
    }
    row._rowIndex = i + 1;
    rows.push(row);
  }
  return rows;
}

/**
 * Найти колонку по заголовку (case-insensitive, обрезает пробелы).
 * Возвращает 1-индекс колонки или -1 если не найдена.
 */
function findColumn(sheet, headerName) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var target = headerName.toString().toLowerCase().trim();
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).toLowerCase().trim() === target) return i + 1;
  }
  return -1;
}

// ==================== HTTP ENDPOINTS ====================

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || "ping";
    switch (action) {
      case "ping":           return jsonOut({ status: "ok", time: new Date().toISOString() });
      case "login":          return actionLogin(e.parameter.badge);
      case "supplies":       return actionGetSupplies();
      case "supply_detail":  return actionGetSupplyDetail(e.parameter.supply_id);
      case "print_queue":    return actionGetPrintQueue();
      case "reprint_status": return actionReprintStatus(e.parameter.supply_id, e.parameter.unit_row);
      case "admin_stats":    return actionAdminStats();
      default:               return errOut("Неизвестное действие: " + action);
    }
  } catch (err) {
    return errOut(err.toString() + " | " + (err.stack || ""));
  }
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    switch (payload.action) {
      case "take_unit":           return actionTakeUnit(payload);
      case "scan_unit":           return actionScanUnit(payload);
      case "complete_packing":    return actionCompletePacking(payload);
      case "reprint_code":        return actionReprintCode(payload);
      case "confirm_printed":     return actionConfirmPrinted(payload);
      case "admin_add_supply":    return actionAdminAddSupply(payload);
      case "admin_toggle_supply": return actionAdminToggleSupply(payload);
      default:                    return errOut("Неизвестное действие: " + payload.action);
    }
  } catch (err) {
    return errOut(err.toString() + " | " + (err.stack || ""));
  }
}

// ==================== ДЕЙСТВИЯ ====================

/**
 * Логин по бейджу.
 * Бейдж имеет формат "20SIDOROV" — префикс 20 + латинские буквы.
 */
function actionLogin(badge) {
  if (!badge) return errOut("Бейдж не передан");
  badge = String(badge).trim();

  if (badge.indexOf(PREFIX_BADGE) !== 0) {
    return errOut("Неверный формат бейджа (должен начинаться с " + PREFIX_BADGE + ")");
  }

  var employees = readSheet(SHEET_EMPLOYEES);
  for (var i = 0; i < employees.length; i++) {
    if (String(employees[i].badge_id).trim() === badge) {
      return jsonOut({
        status: "ok",
        badge: badge,
        fio: employees[i].fio,
        role: employees[i].role || "packer"
      });
    }
  }
  return errOut("Бейдж не найден в системе: " + badge);
}

/**
 * Получить список активных поставок.
 * Возвращает массив с процентом готовности по каждой.
 */
function actionGetSupplies() {
  var supplies = readSheet(SHEET_SUPPLIES);
  var result = [];
  for (var i = 0; i < supplies.length; i++) {
    var s = supplies[i];
    if (String(s.is_active).toLowerCase() !== "true") continue;

    var detail = computeSupplyProgress(s.sheet_name || ("Поставка_" + s.supply_id));
    result.push({
      supply_id: s.supply_id,
      name: s.name,
      created_at: s.created_at,
      total_units: detail.totalUnits,
      packed_units: detail.packedUnits,
      percent: detail.percent
    });
  }
  return jsonOut({ supplies: result });
}

/**
 * Получить детализацию поставки: состав + упакованные/оставшиеся юниты по позициям.
 */
function actionGetSupplyDetail(supplyId) {
  if (!supplyId) return errOut("supply_id не передан");
  var supplies = readSheet(SHEET_SUPPLIES);
  var meta = null;
  for (var i = 0; i < supplies.length; i++) {
    if (String(supplies[i].supply_id) === String(supplyId)) { meta = supplies[i]; break; }
  }
  if (!meta) return errOut("Поставка не найдена: " + supplyId);

  var sheetName = meta.sheet_name || ("Поставка_" + supplyId);
  var sheet = getSheet(sheetName);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return jsonOut({ supply: meta, items: [] });

  var headers = values[0];
  var items = [];
  var totalUnits = 0, packedUnits = 0;

  for (var r = 1; r < values.length; r++) {
    var row = {};
    for (var c = 0; c < headers.length; c++) row[headers[c]] = values[r][c];

    var total = parseInt(row["Юнитов"], 10) || 0;
    var packed = parseInt(row["Упаковано"], 10) || 0;
    totalUnits += total;
    packedUnits += packed;

    items.push({
      row_index: r + 1,
      num: row["№"],
      name: row["Наименование товара"],
      unit_barcode: String(row["ШК Юнит"]),
      barcode: String(row["Штрихкод"] || row["ШК Юнит"]),
      article: row["Артикул (Код товара)"] || row["Артикул(Код товара)"] || "",
      total_units: total,
      packed_units: packed,
      country: String(row["Страна производитель"] || "").trim().toUpperCase(),
      pack_size: String(row["Впк"] || ""),
      status: row["Статус"] || STATUS_EMPTY,
      packer: row["Сотрудник"] || "",
      box: row["Короб"] || "",
      expiry: row["Срок_годности"] || ""
    });
  }

  var percent = totalUnits > 0 ? Math.round(packedUnits / totalUnits * 100) : 0;
  return jsonOut({
    supply: {
      supply_id: meta.supply_id,
      name: meta.name,
      created_at: meta.created_at,
      total_units: totalUnits,
      packed_units: packedUnits,
      percent: percent
    },
    items: items
  });
}

/**
 * Сотрудник взял юнит на упаковку.
 * payload: { supply_id, unit_row, badge, fio }
 * Меняет статус на Taken, записывает сотрудника и время взятия.
 */
function actionTakeUnit(payload) {
  var sheetName = resolveSheetName(payload.supply_id);
  var sheet = getSheet(sheetName);

  var colStatus = findColumn(sheet, "Статус");
  var colPacker = findColumn(sheet, "Сотрудник");
  var colTimeTaken = findColumn(sheet, "Время_взятия");
  var colPacked = findColumn(sheet, "Упаковано");
  var colTotal = findColumn(sheet, "Юнитов");

  if (colStatus < 0 || colPacker < 0 || colTimeTaken < 0) {
    return errOut("В листе поставки не хватает служебных колонок (Статус/Сотрудник/Время_взятия). Запустите setupFirstTime().");
  }

  var currentStatus = sheet.getRange(payload.unit_row, colStatus).getValue();
  if (currentStatus === STATUS_TAKEN) {
    var currentPacker = sheet.getRange(payload.unit_row, colPacker).getValue();
    if (String(currentPacker).trim() !== String(payload.fio).trim()) {
      return errOut("Юнит уже взят другим сотрудником: " + currentPacker);
    }
    // тот же сотрудник — разрешаем продолжить
  }
  if (currentStatus === STATUS_PACKED) {
    return errOut("Юнит уже полностью упакован");
  }

  // Если статус Empty — переводим в Taken
  if (currentStatus === STATUS_EMPTY) {
    sheet.getRange(payload.unit_row, colStatus).setValue(STATUS_TAKEN);
    sheet.getRange(payload.unit_row, colPacker).setValue(payload.fio);
    sheet.getRange(payload.unit_row, colTimeTaken).setValue(new Date());
  }

  var total = parseInt(sheet.getRange(payload.unit_row, colTotal).getValue(), 10) || 0;
  var packed = parseInt(sheet.getRange(payload.unit_row, colPacked).getValue(), 10) || 0;

  return jsonOut({
    status: "ok",
    remaining_to_pack: Math.max(0, total - packed),
    already_packed: packed,
    total: total
  });
}

/**
 * Сотрудник отсканировал ШК товара (для импортных — запускает печать пула).
 * Для российских товаров — особый путь: поштучное сканирование кодов.
 *
 * payload: { supply_id, unit_row, scanned_barcode, continue_from_current }
 *
 * Логика:
 *  1. Проверяем, что отсканированный ШК соответствует ШК в строке поставки.
 *  2. Если страна = РОССИЯ → возвращаем { mode: "ru_single" }
 *  3. Иначе → создаём задание на печать в лист "Задания_печати" с типом "pool",
 *     возвращаем { mode: "pool", print_job_id, start_from_index, ... }
 *
 *  continue_from_current: true  — продолжить с текущего номера (лента осталась)
 *                         false — печать с N+1 (лента утеряна/испорчена, override админа)
 */
function actionScanUnit(payload) {
  var sheetName = resolveSheetName(payload.supply_id);
  var sheet = getSheet(sheetName);
  var values = sheet.getDataRange().getValues();
  var headers = values[0];

  var idx = {};
  ["ШК Юнит", "Штрихкод", "Наименование товара", "Страна производитель", "Юнитов", "Упаковано", "№"]
    .forEach(function (h) { idx[h] = headers.indexOf(h); });

  if (payload.unit_row < 2 || payload.unit_row > values.length) {
    return errOut("Неверный номер строки: " + payload.unit_row);
  }

  var row = values[payload.unit_row - 1];
  var unitBarcode = String(row[idx["ШК Юнит"]]).trim();
  var itemBarcode = String(row[idx["Штрихкод"]]).trim();
  var name = row[idx["Наименование товара"]];
  var country = String(row[idx["Страна производитель"]] || "").trim().toUpperCase();
  var total = parseInt(row[idx["Юнитов"]], 10) || 0;
  var packed = parseInt(row[idx["Упаковано"]], 10) || 0;

  var scanned = String(payload.scanned_barcode).trim();
  if (scanned !== unitBarcode && scanned !== itemBarcode) {
    return errOut("Товар не найден в поставке");
  }

  if (country === "РОССИЯ" || country === "RU" || country === "RUS") {
    return jsonOut({
      mode: "ru_single",
      unit_barcode: unitBarcode,
      item_name: name,
      total: total,
      already_packed: packed,
      remaining: Math.max(0, total - packed)
    });
  }

  // Импортный товар — пул этикеток.
  // Определяем стартовый индекс в зависимости от continue_from_current.
  var startFromIndex = 1;
  if (packed > 0) {
    startFromIndex = payload.continue_from_current ? packed : (packed + 1);
  }

  var jobId = createPrintJob({
    type: "pool",
    supply_id: payload.supply_id,
    unit_row: payload.unit_row,
    unit_barcode: unitBarcode,
    start_from_index: startFromIndex
  });

  return jsonOut({
    mode: "pool",
    print_job_id: jobId,
    job_id: jobId,  // алиас для совместимости со старой версией PWA
    unit_barcode: unitBarcode,
    item_name: name,
    start_from_index: startFromIndex,
    total: total,
    already_packed: packed,
    remaining: Math.max(0, total - packed),
    total_in_file: null  // Python заполнит фактически при обработке
  });
}

/**
 * Завершение упаковки юнита.
 * payload: {
 *   supply_id, unit_row, badge, fio,
 *   box_barcode,         // ШК коробки (с префиксом 22)
 *   count_packed,        // сколько юнитов уложил в эту коробку
 *   expiry_date,         // срок годности (ДД.ММ.ГГГГ)
 *   is_complete          // true = полностью упаковал всё, false = частично
 * }
 */
function actionCompletePacking(payload) {
  var sheetName = resolveSheetName(payload.supply_id);
  var sheet = getSheet(sheetName);

  var colStatus = findColumn(sheet, "Статус");
  var colPacked = findColumn(sheet, "Упаковано");
  var colTotal = findColumn(sheet, "Юнитов");
  var colBox = findColumn(sheet, "Короб");
  var colExpiry = findColumn(sheet, "Срок_годности");
  var colPacker = findColumn(sheet, "Сотрудник");
  var colTimeTaken = findColumn(sheet, "Время_взятия");
  var colTimePacked = findColumn(sheet, "Время_упаковки");
  var colDuration = findColumn(sheet, "Длительность_сек");

  var currentPacked = parseInt(sheet.getRange(payload.unit_row, colPacked).getValue(), 10) || 0;
  var total = parseInt(sheet.getRange(payload.unit_row, colTotal).getValue(), 10) || 0;
  var newPacked = currentPacked + parseInt(payload.count_packed, 10);
  if (newPacked > total) newPacked = total;

  sheet.getRange(payload.unit_row, colPacked).setValue(newPacked);
  sheet.getRange(payload.unit_row, colBox).setValue(payload.box_barcode);
  if (payload.expiry_date) {
    sheet.getRange(payload.unit_row, colExpiry).setValue(payload.expiry_date);
  }
  sheet.getRange(payload.unit_row, colTimePacked).setValue(new Date());

  if (colTimeTaken > 0) {
    var taken = sheet.getRange(payload.unit_row, colTimeTaken).getValue();
    if (taken instanceof Date) {
      var dur = Math.round((new Date() - taken) / 1000);
      sheet.getRange(payload.unit_row, colDuration).setValue(dur);
    }
  }

  var finalStatus = (newPacked >= total) ? STATUS_PACKED : STATUS_TAKEN;
  sheet.getRange(payload.unit_row, colStatus).setValue(finalStatus);

  // Запись в лист Короба
  var boxNumber = registerBox(payload.supply_id, payload.box_barcode, payload.unit_row, payload.count_packed, payload.fio);

  // Запись в лист Статистика
  logStats({
    supply_id: payload.supply_id,
    unit_row: payload.unit_row,
    badge: payload.badge,
    fio: payload.fio,
    box_barcode: payload.box_barcode,
    box_number: boxNumber,
    count_packed: payload.count_packed,
    expiry_date: payload.expiry_date || "",
    is_complete: payload.is_complete
  });

  return jsonOut({
    status: "ok",
    new_packed: newPacked,
    packed_total: newPacked,  // алиас
    total: total,
    remaining: Math.max(0, total - newPacked),
    is_complete: (newPacked >= total),
    unit_complete: (newPacked >= total),
    box_number: boxNumber
  });
}

/**
 * Перепечатка одного испорченного кода.
 * payload: { supply_id, unit_row, code_index, badge, unit_barcode? }
 *
 * Создаёт задание на печать с типом "reprint" и порядковым номером code_index.
 * unit_barcode передаётся явно (если есть в payload) — это надёжнее, чем
 * повторное чтение из листа; нужно Python-серверу для поиска файла пула.
 */
function actionReprintCode(payload) {
  var unitBarcode = String(payload.unit_barcode || "").trim();
  if (!unitBarcode) {
    // Fallback: читаем ШК из листа поставки
    var sheetName = resolveSheetName(payload.supply_id);
    var sheet = getSheet(sheetName);
    var colUnitBarcode = findColumn(sheet, "ШК Юнит");
    unitBarcode = String(sheet.getRange(payload.unit_row, colUnitBarcode).getValue()).trim();
  }

  var jobId = createPrintJob({
    type: "reprint",
    supply_id: payload.supply_id,
    unit_row: payload.unit_row,
    unit_barcode: unitBarcode,
    start_from_index: parseInt(payload.code_index, 10),
    code_index: parseInt(payload.code_index, 10)
  });

  return jsonOut({ status: "ok", print_job_id: jobId, job_id: jobId });
}

/**
 * Проверка: был ли уже начат упаковка этого юнита?
 * Возвращает информацию для вопроса про оставшуюся ленту.
 */
function actionReprintStatus(supplyId, unitRow) {
  var sheetName = resolveSheetName(supplyId);
  var sheet = getSheet(sheetName);

  var colPacked = findColumn(sheet, "Упаковано");
  var colTotal = findColumn(sheet, "Юнитов");
  var colStatus = findColumn(sheet, "Статус");

  var packed = parseInt(sheet.getRange(unitRow, colPacked).getValue(), 10) || 0;
  var total = parseInt(sheet.getRange(unitRow, colTotal).getValue(), 10) || 0;
  var status = sheet.getRange(unitRow, colStatus).getValue();

  return jsonOut({
    packed: packed,
    total: total,
    remaining: Math.max(0, total - packed),
    started: (packed > 0),       // алиас
    has_started: (packed > 0),
    next_index: packed + 1,
    status: status
  });
}

// ==================== ОЧЕРЕДЬ ПЕЧАТИ ====================

/**
 * Создаёт задание на печать.
 * job: { type, supply_id, unit_row, unit_barcode, start_from_index?, code_index? }
 * Возвращает ID задания (строковый формат JOB-N для надёжности при удалении строк).
 */
function createPrintJob(job) {
  var sheet = getSheet(SHEET_PRINT_QUEUE);
  var seq = sheet.getLastRow();  // кол-во строк с учётом заголовка
  var jobId = "JOB-" + seq;

  var row = [
    jobId,                                   // ID
    job.type,                                // pool | reprint | ru_single
    job.supply_id,
    job.unit_row,
    job.unit_barcode,
    job.start_from_index || (job.code_index || 1),
    new Date().toISOString(),                // created_at
    "",                                      // processed_at
    "pending",                               // status
    0                                        // printed_count
  ];
  sheet.appendRow(row);
  return jobId;
}

/**
 * Python скрипт опрашивает этот endpoint (через GET ?action=print_queue).
 * Возвращает массив заданий со статусом "pending".
 */
function actionGetPrintQueue() {
  var sheet = getSheet(SHEET_PRINT_QUEUE);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return jsonOut({ jobs: [] });

  var headers = values[0];
  var idxStatus = headers.indexOf("status");
  var idxId = headers.indexOf("ID");

  var jobs = [];
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][idxStatus]) !== "pending") continue;
    jobs.push({
      job_id: String(values[i][idxId]),
      type: values[i][1],
      supply_id: values[i][2],
      unit_row: values[i][3],
      unit_barcode: String(values[i][4]),
      start_from_index: values[i][5],
      created_at: values[i][6]
    });
  }
  return jsonOut({ jobs: jobs });
}

/**
 * Python подтверждает, что задание обработано (через POST action=confirm_printed).
 * payload: { job_id, printed_count }
 */
function actionConfirmPrinted(payload) {
  var sheet = getSheet(SHEET_PRINT_QUEUE);
  var colStatus = findColumn(sheet, "status");
  var colProcessedAt = findColumn(sheet, "processed_at");
  var colPrintedCount = findColumn(sheet, "printed_count");
  var colId = findColumn(sheet, "ID");

  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][colId - 1]) === String(payload.job_id)) {
      sheet.getRange(i + 1, colStatus).setValue("printed");
      sheet.getRange(i + 1, colProcessedAt).setValue(new Date().toISOString());
      if (colPrintedCount > 0 && payload.printed_count) {
        sheet.getRange(i + 1, colPrintedCount).setValue(payload.printed_count);
      }
      return jsonOut({ status: "ok" });
    }
  }
  return errOut("Задание не найдено: " + payload.job_id);
}

// ==================== КОРОБА ====================

function registerBox(supplyId, boxBarcode, unitRow, count, fio) {
  var sheet = getSheet(SHEET_BOXES);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    sheet.appendRow([1, supplyId, boxBarcode, new Date(), fio, unitRow, count]);
    return 1;
  }

  var headers = values[0];
  var idxBarcode = headers.indexOf("box_barcode");
  var idxNumber  = headers.indexOf("box_number");
  var idxCount   = headers.indexOf("total_units");

  for (var i = 1; i < values.length; i++) {
    if (String(values[i][idxBarcode]).trim() === String(boxBarcode).trim()) {
      var current = parseInt(values[i][idxCount], 10) || 0;
      sheet.getRange(i + 1, idxCount + 1).setValue(current + count);
      return values[i][idxNumber];
    }
  }

  var nextNumber = values.length;  // 1-индекс = кол-ву строк = следующему номеру
  sheet.appendRow([nextNumber, supplyId, boxBarcode, new Date(), fio, unitRow, count]);
  return nextNumber;
}

// ==================== СТАТИСТИКА ====================

function logStats(entry) {
  var sheet = getSheet(SHEET_STATS);
  sheet.appendRow([
    new Date(),
    entry.supply_id,
    entry.unit_row,
    entry.badge,
    entry.fio,
    entry.box_barcode,
    entry.box_number,
    entry.count_packed,
    entry.expiry_date,
    entry.is_complete ? "complete" : "partial"
  ]);
}

// ==================== АДМИН-ENDPOINTS ====================

/**
 * Статистика для админ-экрана PWA.
 * Возвращает: supplies (с прогрессом + is_active), boxes (последние 50),
 *             statistics (последние 50), employees.
 */
function actionAdminStats() {
  var supplies = readSheet(SHEET_SUPPLIES);
  var suppliesOut = [];
  for (var i = 0; i < supplies.length; i++) {
    var s = supplies[i];
    var prog = computeSupplyProgress(s.sheet_name || ("Поставка_" + s.supply_id));
    suppliesOut.push({
      supply_id: s.supply_id,
      name: s.name,
      is_active: (String(s.is_active).toLowerCase() === "true"),
      percent: prog.percent,
      total: prog.totalUnits,
      packed: prog.packedUnits
    });
  }

  // Короба (последние 50, новые первыми)
  var boxes = readSheet(SHEET_BOXES).slice(-50).reverse().map(function (b) {
    return {
      box_number: b.box_number,
      supply_id: String(b.supply_id),
      box_barcode: String(b.box_barcode),
      created_at: b.created_at,
      created_by: b.created_by,
      first_unit_row: b.first_unit_row,
      total_units: b.total_units
    };
  });

  // Статистика (последние 50)
  var stats = readSheet(SHEET_STATS).slice(-50).reverse().map(function (st) {
    return {
      timestamp: st.timestamp,
      supply_id: String(st.supply_id),
      unit_row: st.unit_row,
      badge: String(st.badge),
      fio: st.fio,
      box_barcode: String(st.box_barcode),
      box_number: st.box_number,
      count_packed: st.count_packed,
      expiry_date: String(st.expiry_date || ""),
      is_complete: (String(st.is_complete) === "complete")
    };
  });

  // Сотрудники
  var employees = readSheet(SHEET_EMPLOYEES).map(function (e) {
    return { badge_id: String(e.badge_id), fio: e.fio, role: e.role };
  });

  return jsonOut({
    supplies: suppliesOut,
    boxes: boxes,
    statistics: stats,
    employees: employees
  });
}

/**
 * Добавить новую поставку (из админ-экрана PWA).
 * payload: { name, tsv }
 * TSV-формат: Наименование \t ШК Юнит \t Артикул \t Юнитов \t Страна \t Пупырка
 */
function actionAdminAddSupply(payload) {
  if (!payload.name) return errOut("Не передано название поставки");
  if (!payload.tsv) return errOut("Не передан состав поставки (TSV)");

  var s = ss();
  var supSh = s.getSheetByName(SHEET_SUPPLIES);
  var seq = supSh.getLastRow();
  var id = "SUP-" + String(seq).padStart(3, "0");
  var sheetName = "Поставка_" + seq;

  supSh.appendRow([id, payload.name, new Date(), true, sheetName]);

  // Создаём лист состава с заголовками (основные + служебные)
  var newSheet = ensureSheet(s, sheetName, [
    "№", "Наименование товара", "ШК Юнит", "Артикул (Код товара)", "Юнитов",
    "Штрихкод", "SKU", "Страна производитель", "Впк",
    "Статус", "Сотрудник", "Время_взятия", "Время_упаковки",
    "Длительность_сек", "Упаковано", "Короб", "Срок_годности"
  ]);

  var rows = parseTsv(payload.tsv);
  for (var i = 0; i < rows.length; i++) {
    newSheet.appendRow([
      i + 1, rows[i].name, rows[i].unit_barcode, rows[i].art, rows[i].units,
      rows[i].unit_barcode, "SKU-" + (i + 1), rows[i].country, rows[i].pack_size,
      STATUS_EMPTY, "", "", "", "", 0, "", ""
    ]);
  }

  return jsonOut({ status: "ok", supply_id: id });
}

/**
 * Включить/выключить поставку (is_active).
 * payload: { supply_id, is_active }
 */
function actionAdminToggleSupply(payload) {
  var supSh = getSheet(SHEET_SUPPLIES);
  var values = supSh.getDataRange().getValues();
  var colId = findColumn(supSh, "supply_id");
  var colActive = findColumn(supSh, "is_active");
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][colId - 1]) === String(payload.supply_id)) {
      supSh.getRange(i + 1, colActive).setValue(!!payload.is_active);
      return jsonOut({ status: "ok" });
    }
  }
  return errOut("Поставка не найдена: " + payload.supply_id);
}

// ==================== ВСПОМОГАТЕЛЬНОЕ ====================

function resolveSheetName(supplyId) {
  var supplies = readSheet(SHEET_SUPPLIES);
  for (var i = 0; i < supplies.length; i++) {
    if (String(supplies[i].supply_id) === String(supplyId)) {
      return supplies[i].sheet_name || ("Поставка_" + supplyId);
    }
  }
  throw new Error("Поставка не найдена: " + supplyId);
}

function computeSupplyProgress(sheetName) {
  try {
    var sheet = getSheet(sheetName);
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return { totalUnits: 0, packedUnits: 0, percent: 0 };

    var headers = values[0];
    var idxTotal = headers.indexOf("Юнитов");
    var idxPacked = headers.indexOf("Упаковано");

    var total = 0, packed = 0;
    for (var i = 1; i < values.length; i++) {
      total += parseInt(values[i][idxTotal], 10) || 0;
      if (idxPacked >= 0) packed += parseInt(values[i][idxPacked], 10) || 0;
    }
    var percent = total > 0 ? Math.round(packed / total * 100) : 0;
    return { totalUnits: total, packedUnits: packed, percent: percent };
  } catch (e) {
    return { totalUnits: 0, packedUnits: 0, percent: 0 };
  }
}

function parseTsv(tsv) {
  if (!tsv) return [];
  var lines = tsv.trim().split(/\r?\n/);
  var rows = [];
  var start = (lines[0] && /наименован|шк|артикул|страна/i.test(lines[0])) ? 1 : 0;
  for (var i = start; i < lines.length; i++) {
    var cols = lines[i].split(/\t|;/);
    if (cols.length < 2) continue;
    rows.push({
      name: (cols[0] || "").trim(),
      unit_barcode: (cols[1] || "").trim(),
      art: (cols[2] || "").trim(),
      units: parseInt((cols[3] || "1").trim(), 10) || 1,
      country: (cols[4] || "РОССИЯ").trim(),
      pack_size: (cols[5] || "25х20").trim()
    });
  }
  return rows;
}

// ==================== ПЕРВОНАЧАЛЬНАЯ НАСТРОЙКА ====================

/**
 * ЗАПУСТИТЬ ОДИН РАЗ ПРИ УСТАНОВКЕ.
 * Создаёт служебные листы с правильными заголовками.
 * Добавляет служебные колонки ко всем существующим листам поставок (Поставка_*).
 */
function setupFirstTime() {
  var s = ss();

  ensureSheet(s, SHEET_EMPLOYEES, ["badge_id", "fio", "role"]);
  ensureSheet(s, SHEET_SUPPLIES, ["supply_id", "name", "created_at", "is_active", "sheet_name"]);
  ensureSheet(s, SHEET_PRINT_QUEUE, ["ID", "type", "supply_id", "unit_row", "unit_barcode", "start_from_index", "created_at", "processed_at", "status", "printed_count"]);
  ensureSheet(s, SHEET_STATS, ["timestamp", "supply_id", "unit_row", "badge", "fio", "box_barcode", "box_number", "count_packed", "expiry_date", "is_complete"]);
  ensureSheet(s, SHEET_BOXES, ["box_number", "supply_id", "box_barcode", "created_at", "created_by", "first_unit_row", "total_units"]);

  // Пример сотрудника если лист пустой
  var empSh = s.getSheetByName(SHEET_EMPLOYEES);
  if (empSh.getLastRow() < 2) {
    empSh.appendRow(["20SIDOROV", "Сидоров А.В.", "packer"]);
    empSh.appendRow(["20ADMIN", "Администратор", "admin"]);
  }

  // Добавить служебные колонки ко всем существующим листам поставок (Поставка_*)
  var sheets = s.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    if (name.indexOf("Поставка_") === 0) {
      ensureSupplySheetColumns(sheets[i]);
    }
  }

  Logger.log("setupFirstTime завершена. Листы: " + s.getSheets().map(function(x){return x.getName();}).join(", "));
}

function ensureSheet(parent, name, headers) {
  var sheet = parent.getSheetByName(name);
  if (!sheet) sheet = parent.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Добавляет служебные колонки к листу поставки, если их нет.
 * Колонки: Статус, Сотрудник, Время_взятия, Время_упаковки, Длительность_сек, Упаковано, Короб, Срок_годности
 */
function ensureSupplySheetColumns(sheet) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  var required = ["Статус", "Сотрудник", "Время_взятия", "Время_упаковки", "Длительность_сек", "Упаковано", "Короб", "Срок_годности"];
  var toAdd = [];
  for (var i = 0; i < required.length; i++) {
    var found = false;
    for (var j = 0; j < headers.length; j++) {
      if (String(headers[j]).trim() === required[i]) { found = true; break; }
    }
    if (!found) toAdd.push(required[i]);
  }

  if (toAdd.length === 0) return;

  var startCol = lastCol + 1;
  for (var k = 0; k < toAdd.length; k++) {
    sheet.getRange(1, startCol + k).setValue(toAdd[k]).setFontWeight("bold");
  }

  // Заполнить "Упаковано" = 0 и "Статус" = Empty для всех строк
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var colPacked = findColumn(sheet, "Упаковано");
    var colStatus = findColumn(sheet, "Статус");
    for (var r = 2; r <= lastRow; r++) {
      if (colPacked > 0) sheet.getRange(r, colPacked).setValue(0);
      if (colStatus > 0) sheet.getRange(r, colStatus).setValue(STATUS_EMPTY);
    }
  }
}

/**
 * Тестовая функция для проверки связи.
 */
function testConnection() {
  try {
    var s = ss();
    Logger.log("OK. Таблица: " + s.getName());
    Logger.log("Листы: " + s.getSheets().map(function(x) { return x.getName(); }).join(", "));
  } catch (e) {
    Logger.log("Ошибка: " + e.toString());
  }
}
