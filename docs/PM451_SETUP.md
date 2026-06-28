# Настройка DataWedge на Point Mobile PM451

Сканер PM451 настраивается через приложение **DataWedge** в режиме Keyboard emulation + Auto-enter. PWA получает отсканированный код как ввод текста в активное поле + нажатие Enter.

## Пошаговая настройка

1. Откройте приложение **DataWedge** на терминале.
2. Создайте новый профиль (или отредактируйте Profile0): имя `PL-Warehouse`.
3. **Associated apps**: добавьте браузер (Chrome / Android System WebView).
4. **Keystroke output** (или Keyboard output):
   - Enabled: ✅
   - Action key character: **Enter** (LF / 0x0A)
   - Disable keystroke block: ✅
5. **Inter-character delay**: 0 мс (если коды склеиваются — поставьте 5–10 мс).
6. **Barcode input → Decoders**: включите нужные типы (DataMatrix, QR, EAN-13, Code128, GS1-128). Для РФ-кодов маркировки обязателен **DataMatrix** с передачей GS-символа (FNC1).
7. **Data Processing**:
   - Send data: ✅
   - Data format: **Keystroke**
   - **Important**: включите «Send GS character» / «GS1 Output» → «Use GS1 DataBar», чтобы разделитель FNC1 передавался как `chr(29)`. PWA использует это для валидации РФ-кодов.

## Рекомендации для PWA

- Поле ввода должно быть в фокусе. PWA автоматически удерживает фокус (см. `scanner.js`).
- Screen timeout: установите максимальный или включите wake lock в настройках PWA (Админ → Не гасить экран).
- Отключите автозамену/автокапитализацию в настройках клавиатуры Android (они портят сканированные коды).

## Проверка

1. Откройте PWA, перейдите на экран логина.
2. Тапните по полю ввода (появится курсор).
3. Отсканируйте бейдж `20SIDOROV` — код должен появиться в поле и автоматически отправиться (Enter).
4. Если код не отправляется — проверьте Action key = Enter в DataWedge.

## Решение проблем

- **Сканер не вводит текст**: проверьте Associated apps в DataWedge, что выбран браузер.
- **Код вводится, но не отправляется**: Action key ≠ Enter. Поставьте LF (0x0A).
- **Коды склеиваются между сканами**: увеличьте Inter-character delay до 10 мс.
- **РФ-коды не валидируются**: включите передачу GS-символа (FNC1) в DataWedge.
- **Фокус теряется**: убедитесь что в Chrome отключён «Block pop-ups» и не открываются сторонние вкладки.
