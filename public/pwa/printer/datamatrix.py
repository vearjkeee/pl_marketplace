"""
Сервер печати GS1 DataMatrix — система Парфюм Логистик.

Читает задания из листа 'Задания_печати' Google Таблицы (через GAS Web App).

Типы заданий:
  - "pool":      печать пула кодов из файла для указанного ШК юнита.
                 Может печатать начиная с N-ной строки (start_from_index),
                 если сотрудник уже частично упаковал.
  - "reprint":   перепечатка ОДНОГО кода по его порядковому номеру (2 копии).
  - "ru_single": пока заглушка (РФ-товары печатают поштучно, не используется).

Каждое задание после обработки помечается в таблице как "printed".
"""

import os
import json
import time
import requests
import win32print

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")


def load_config(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


CFG = load_config(CONFIG_PATH)

GAS_URL = CFG["gas"]["webapp_url"]
POLL_INTERVAL = CFG["gas"]["poll_interval_sec"]
REQUEST_TIMEOUT = CFG["gas"]["request_timeout_sec"]

PRINTER_NAME = CFG["printer"]["name"]
PRINTER_DPI = CFG["printer"]["dpi"]

LABEL_W_MM = CFG["label"]["width_mm"]
LABEL_H_MM = CFG["label"]["height_mm"]
MEDIA_MODE = CFG["label"]["media_mode"]
MEDIA_TYPE = CFG["label"]["media_type"]
CODE_PAGE = CFG["label"]["code_page"]

BARCODE_MARGIN_MM = CFG["barcode"]["margin_mm"]
CORRECTION_X_MM = CFG["barcode"]["correction_x_mm"]
CORRECTION_Y_MM = CFG["barcode"]["correction_y_mm"]
BARCODE_SCALE = CFG["barcode"].get("scale_factor", 1.0)
BARCODE_MAX_MM = CFG["barcode"].get("max_size_mm", 0)

INDEX_X_MM = CFG["index_label"]["x_mm"]
INDEX_Y_MM = CFG["index_label"]["y_mm"]
INDEX_FONT_H_MM = CFG["index_label"]["font_height_mm"]
INDEX_FONT_W_MM = CFG["index_label"]["font_width_mm"]
INDEX_STRIP_W_MM = CFG["index_label"]["reserved_strip_w_mm"]
INDEX_STRIP_H_MM = CFG["index_label"]["reserved_strip_h_mm"]

SIGNAL_START_PREFIX = CFG["signal_label"]["start_prefix"]
SIGNAL_TOTAL_PREFIX = CFG["signal_label"]["total_prefix"]
SIGNAL_X_MM = CFG["signal_label"]["x_mm"]
SIGNAL_Y_MM = CFG["signal_label"]["y_mm"]
SIGNAL_FONT_H_MM = CFG["signal_label"]["font_height_mm"]
SIGNAL_FONT_W_MM = CFG["signal_label"]["font_width_mm"]

COPIES_POOL = CFG["copies"]["pool_each"]
COPIES_REPRINT = CFG["copies"]["reprint_each"]
COPIES_SIGNAL = CFG["copies"]["signal_label"]

DELAY_BETWEEN_POOL = CFG["delays_sec"]["between_pool_items"]
DELAY_AFTER_SIGNAL = CFG["delays_sec"]["after_signal_label"]

TXT_FOLDER = CFG["paths"]["labels_folder"]


# ============================================================
# УТИЛИТЫ
# ============================================================

def mm_to_dots(mm, dpi=None):
    dpi = dpi or PRINTER_DPI
    return int(round(mm * dpi / 25.4))


def estimate_datamatrix_modules(text_length, is_gs1=True):
    capacities = [
        (10, 3), (12, 6), (14, 10), (16, 16), (18, 25), (20, 31),
        (22, 43), (24, 52), (26, 64), (32, 91), (36, 127), (40, 169),
        (44, 214), (48, 259), (52, 304), (64, 418), (72, 550), (80, 682)
    ]
    effective_len = text_length + (2 if is_gs1 else 0)
    for modules, cap in capacities:
        if effective_len <= cap:
            return modules
    return 88


def prepare_gs1_text(text, escape_char="_"):
    text = text.replace(escape_char, escape_char + escape_char)
    text = text.replace('\x1d', f"{escape_char}1")
    text = text.replace('<GS>', f"{escape_char}1")
    if not text.startswith(f"{escape_char}1"):
        text = f"{escape_char}1" + text
    return text


# ============================================================
# РАСЧЁТ ПАРАМЕТРОВ ШТРИХКОДА
# ============================================================

def calculate_dm_parameters(text, with_index=False, dpi=None):
    dpi = dpi or PRINTER_DPI
    pw = mm_to_dots(LABEL_W_MM, dpi)
    ll = mm_to_dots(LABEL_H_MM, dpi)
    margin = mm_to_dots(BARCODE_MARGIN_MM, dpi)

    strip_w = mm_to_dots(INDEX_STRIP_W_MM, dpi) if with_index else 0

    work_w = max(pw - 2 * margin - strip_w, margin)
    work_h = max(ll - 2 * margin, margin)
    max_barcode_dots = min(work_w, work_h)

    if BARCODE_MAX_MM > 0:
        max_barcode_dots = min(max_barcode_dots, mm_to_dots(BARCODE_MAX_MM, dpi))

    modules = estimate_datamatrix_modules(len(text), is_gs1=True)
    module_dots = max_barcode_dots // modules
    module_dots = max(2, module_dots)

    if 0 < BARCODE_SCALE < 1.0:
        module_dots = max(2, int(module_dots * BARCODE_SCALE))

    dm_size = modules * module_dots

    work_center_x = (pw - strip_w) / 2
    fo_x = int(work_center_x - dm_size / 2) + mm_to_dots(CORRECTION_X_MM, dpi)
    fo_y = int((ll - dm_size) / 2) + mm_to_dots(CORRECTION_Y_MM, dpi)

    fo_x = max(0, fo_x)
    fo_y = max(0, fo_y)

    return module_dots, fo_x, fo_y, pw, ll


# ============================================================
# ГЕНЕРАЦИЯ ZPL
# ============================================================

def generate_signal_zpl(text, copies=None, dpi=None):
    dpi = dpi or PRINTER_DPI
    copies = copies if copies is not None else COPIES_SIGNAL

    pw = mm_to_dots(LABEL_W_MM, dpi)
    ll = mm_to_dots(LABEL_H_MM, dpi)
    fo_x = mm_to_dots(SIGNAL_X_MM, dpi)
    fo_y = mm_to_dots(SIGNAL_Y_MM, dpi)
    font_h = mm_to_dots(SIGNAL_FONT_H_MM, dpi)
    font_w = mm_to_dots(SIGNAL_FONT_W_MM, dpi)

    return (
        "^XA"
        f"^{CODE_PAGE}"
        f"^{MEDIA_TYPE}"
        f"^{MEDIA_MODE}"
        f"^PW{pw}"
        f"^LL{ll}"
        f"^FO{fo_x},{fo_y}^A0N,{font_h},{font_w}^FD{text}^FS"
        f"^PQ{copies}"
        "^XZ"
    )


def generate_zpl(text, index=None, copies=None, dpi=None):
    dpi = dpi or PRINTER_DPI
    copies = copies if copies is not None else COPIES_POOL

    prepared_text = prepare_gs1_text(text, escape_char="_")
    module_dots, fo_x, fo_y, pw, ll = calculate_dm_parameters(
        prepared_text, with_index=(index is not None), dpi=dpi
    )

    index_zpl = ""
    if index is not None:
        num_x = mm_to_dots(INDEX_X_MM, dpi)
        num_y = mm_to_dots(INDEX_Y_MM, dpi)
        font_h = mm_to_dots(INDEX_FONT_H_MM, dpi)
        font_w = mm_to_dots(INDEX_FONT_W_MM, dpi)
        index_zpl = f"^FO{num_x},{num_y}^A0N,{font_h},{font_w}^FD{index}^FS"

    return (
        "^XA"
        f"^{CODE_PAGE}"
        f"^{MEDIA_TYPE}"
        f"^{MEDIA_MODE}"
        f"^PW{pw}"
        f"^LL{ll}"
        f"{index_zpl}"
        f"^FO{fo_x},{fo_y}"
        f"^BXN,{module_dots},200,,,,_"
        f"^FD{prepared_text}^FS"
        f"^PQ{copies}"
        "^XZ"
    )


def print_zpl_raw(zpl_data, printer_name):
    try:
        hPrinter = win32print.OpenPrinter(printer_name)
        try:
            hJob = win32print.StartDocPrinter(hPrinter, 1, ("PL_DataMatrix", None, "RAW"))
            try:
                win32print.StartPagePrinter(hPrinter)
                win32print.WritePrinter(hPrinter, zpl_data.encode('utf-8'))
                win32print.EndPagePrinter(hPrinter)
            finally:
                win32print.EndDocPrinter(hPrinter)
        finally:
            win32print.ClosePrinter(hPrinter)
        return True
    except Exception as e:
        print(f"  [!] Ошибка отправки на принтер {printer_name}: {e}")
        return False


# ============================================================
# РАБОТА С ФАЙЛАМИ ПУЛОВ
# ============================================================

def load_pool_file(unit_barcode):
    """
    Загружает список кодов маркировки из файла в папке TXT_FOLDER.
    Имя файла содержит ШК юнита (например: 2050690288446_001.txt).
    Возвращает список строк (кодов) или None если файл не найден.
    """
    if not os.path.exists(TXT_FOLDER):
        os.makedirs(TXT_FOLDER)
        return None

    # Ищем файл, в имени которого есть этот ШК юнита
    for filename in os.listdir(TXT_FOLDER):
        if not filename.endswith('.txt'):
            continue
        if unit_barcode in filename:
            filepath = os.path.join(TXT_FOLDER, filename)
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    codes = [line.strip() for line in f if line.strip()]
                return codes
            except Exception as e:
                print(f"  [!] Ошибка чтения файла {filename}: {e}")
                return None
    return None


# ============================================================
# ОБРАБОТКА ЗАДАНИЙ
# ============================================================

def fetch_print_jobs(session):
    """Получить список заданий со статусом 'pending'."""
    try:
        resp = session.get(GAS_URL, params={"action": "print_queue"}, timeout=REQUEST_TIMEOUT)
    except Exception as e:
        print(f"  [!] Сеть/GET ошибка: {e}")
        return []

    if resp.status_code != 200:
        print(f"  [!] GAS GET вернул {resp.status_code}: {resp.text[:200]}")
        return []

    try:
        data = resp.json()
    except ValueError:
        print(f"  [!] GAS вернул не-JSON: {resp.text[:200]}")
        return []

    if isinstance(data, dict) and data.get("error"):
        print(f"  [!] GAS сообщил об ошибке: {data['error']}")
        return []

    if not isinstance(data, dict) or "jobs" not in data:
        return []

    return data["jobs"]


def confirm_job_processed(session, job_id, printed_count=0):
    """Подтвердить, что задание обработано."""
    try:
        resp = session.post(
            GAS_URL,
            data=json.dumps({
                "action": "confirm_printed",
                "job_id": job_id,
                "printed_count": printed_count
            }),
            headers={"Content-Type": "text/plain;charset=utf-8"},
            timeout=REQUEST_TIMEOUT
        )
        if resp.status_code == 200:
            try:
                data = resp.json()
                if isinstance(data, dict) and data.get("status") == "ok":
                    return True
            except ValueError:
                pass
        print(f"  [!] Не удалось подтвердить задание {job_id}: {resp.status_code}")
        return False
    except Exception as e:
        print(f"  [!] Сеть/POST ошибка: {e}")
        return False


def process_job(session, job):
    """
    Обрабатывает одно задание на печать.
    """
    job_id = job.get("job_id")
    job_type = job.get("type")
    unit_barcode = job.get("unit_barcode", "")
    start_from = int(job.get("start_from_index", 1) or 1)

    print(f"\n[Задание #{job_id}] Тип: {job_type} | ШК: {unit_barcode} | С номера: {start_from}")

    if job_type == "reprint":
        # Перепечатка одного кода по индексу
        codes = load_pool_file(unit_barcode)
        if not codes:
            print(f"  [!] Файл пула не найден для ШК {unit_barcode}")
            confirm_job_processed(session, job_id, printed_count=0)
            return

        idx = start_from  # в случае reprint в start_from_index передаём code_index
        if idx < 1 or idx > len(codes):
            print(f"  [!] Неверный индекс {idx} (всего в файле {len(codes)})")
            confirm_job_processed(session, job_id, printed_count=0)
            return

        code = codes[idx - 1]
        print(f"  -> Перепечатка кода #{idx}: {code}")
        zpl = generate_zpl(code, index=idx, copies=COPIES_REPRINT)
        if print_zpl_raw(zpl, PRINTER_NAME):
            confirm_job_processed(session, job_id, printed_count=COPIES_REPRINT)
            print(f"  [OK] Отправлено {COPIES_REPRINT} копий")
        return

    if job_type == "pool":
        # Печать пула начиная с указанного номера
        codes = load_pool_file(unit_barcode)
        if not codes:
            print(f"  [!] Файл пула не найден для ШК {unit_barcode}")
            confirm_job_processed(session, job_id, printed_count=0)
            return

        # Срезаем уже напечатанные (если start_from > 1)
        to_print = codes[start_from - 1:]
        if not to_print:
            print(f"  [!] Нечего печатать — start_from={start_from}, всего в файле {len(codes)}")
            confirm_job_processed(session, job_id, printed_count=0)
            return

        print(f"  -> Пул: {len(codes)} кодов всего, печатаем {len(to_print)} начиная с #{start_from}")

        # СТАРТОВАЯ сигнальная этикетка
        start_text = f"{SIGNAL_START_PREFIX}{unit_barcode[-6:]}"
        print(f"  [Разделитель] СТАРТ: {start_text}")
        print_zpl_raw(generate_signal_zpl(start_text), PRINTER_NAME)
        time.sleep(DELAY_AFTER_SIGNAL)

        # Основной пул (по 2 копии каждого кода с порядковым номером)
        printed = 0
        for i, code in enumerate(to_print):
            global_index = start_from + i
            zpl = generate_zpl(code, index=global_index, copies=COPIES_POOL)
            if print_zpl_raw(zpl, PRINTER_NAME):
                printed += 1
            time.sleep(DELAY_BETWEEN_POOL)

        print(f"  Печать завершена. Успешно отправлено: {printed}/{len(to_print)}")

        # ФИНИШНАЯ сигнальная этикетка
        end_text = f"{SIGNAL_TOTAL_PREFIX}{len(to_print)}"
        print(f"  [Разделитель] СТОП: {end_text}")
        print_zpl_raw(generate_signal_zpl(end_text), PRINTER_NAME)
        time.sleep(DELAY_AFTER_SIGNAL)

        # Подтверждение
        confirm_job_processed(session, job_id, printed_count=printed)
        print(f"  [OK] Задание #{job_id} обработано")
        return

    if job_type == "ru_single":
        # РФ — печать не требуется (сотрудник сканирует коды с товара).
        # Просто подтверждаем, что задание "выполнено".
        print(f"  [РФ] Печать не требуется — сотрудник сканирует поштучно.")
        confirm_job_processed(session, job_id, printed_count=0)
        return

    print(f"  [!] Неизвестный тип задания: {job_type}")
    confirm_job_processed(session, job_id, printed_count=0)


# ============================================================
# ГЛАВНЫЙ ЦИКЛ
# ============================================================

def main():
    import sys
    # Тестовый режим
    if len(sys.argv) >= 2 and sys.argv[1] in ("--test", "-t"):
        test_text = sys.argv[2] if len(sys.argv) >= 3 else "0104607035001234211234567890110250625"
        test_index = int(sys.argv[3]) if len(sys.argv) >= 4 else 1
        print_test_label(test_text, test_index)
        return

    print("=== Парфюм Логистик — Сервер печати ===")
    print(f"Принтер: {PRINTER_NAME} @ {PRINTER_DPI} DPI")
    print(f"Этикетка: {LABEL_W_MM} x {LABEL_H_MM} мм")
    print(f"GAS URL: {GAS_URL}")
    print(f"Папка пулов: {TXT_FOLDER}")
    print(f"========================================\n")

    if not os.path.exists(TXT_FOLDER):
        os.makedirs(TXT_FOLDER)
        print(f"Создана папка для пулов: {TXT_FOLDER}. Поместите туда .txt файлы с кодами маркировки.")
        print(f"Имя файла должно содержать ШК юнита (например: 2050690288446.txt)\n")

    print(f"Сервер печати запущен. Опрос очереди каждые {POLL_INTERVAL} сек...\n")
    session = requests.Session()

    while True:
        try:
            jobs = fetch_print_jobs(session)
            if jobs:
                print(f"\n[--- Найдено заданий: {len(jobs)} ---]")
            for job in jobs:
                try:
                    process_job(session, job)
                except Exception as e:
                    print(f"  [!] Ошибка при обработке задания {job}: {e}")
        except Exception as e:
            print(f"  [!] Ошибка в цикле: {e}")

        time.sleep(POLL_INTERVAL)


def print_test_label(text, index):
    print("=== ТЕСТОВАЯ ПЕЧАТЬ ===")
    print(f"Принтер: {PRINTER_NAME} @ {PRINTER_DPI} DPI")
    print(f"Этикетка: {LABEL_W_MM} x {LABEL_H_MM} мм")
    print(f"Текст: {text}")
    print(f"Порядковый номер: {index}")
    print("========================\n")

    zpl = generate_zpl(text, index=index, copies=1)
    print("ZPL:")
    print(zpl)
    print()

    if print_zpl_raw(zpl, PRINTER_NAME):
        print("[OK] Этикетка отправлена.")
    else:
        print("[FAIL] Не удалось.")


if __name__ == "__main__":
    main()
