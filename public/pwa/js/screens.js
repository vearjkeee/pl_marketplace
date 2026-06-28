/**
 * screens.js — все экраны приложения (улучшенная версия).
 *
 * Каждый экран = { render(params): string, bind(container, params): void }.
 *
 * ИСПРАВЛЕНИЯ:
 *  Issue 1 — крупные шрифты/таргеты, авто-фокус, wake lock (см. scanner.js, style.css)
 *  Issue 2 — РФ-счётчик: проверка дубликатов, лимита, undo, валидация GS1, отмена
 *  Issue 3 — административный запрет на выбрасывание ленты (allow_discard_tape)
 *  Issue 4 — админ-экран: список поставок, добавление, статистика, настройки
 *  Issue 5 — синхронизация фокуса с модалками через Scanner.openModal/closeModal
 */

const Screens = {};

// Глобальный HTML-эскейпер (защита от инъекций в динамических строках)
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ============================================================
// 1. LOGIN — сканирование бейджа
// ============================================================

Screens.login = {
  render() {
    const demoHint = Api.isDemoMode() ? `
      <div class="screen-login__demo-hint">
        <strong>Демо-режим.</strong> Бейджи для входа:<br>
        <code>20SIDOROV</code> &nbsp; <code>20IVANOV</code><br>
        <code>20PETROV</code> &nbsp; <code>20ADMIN</code> (админ)
      </div>
    ` : '';
    return `
      <div class="screen-login">
        <img src="assets/logo.svg" alt="ПЛ" class="screen-login__logo">
        <h1 class="screen-login__title">Парфюм Логистик</h1>
        <p class="screen-login__subtitle">Система упаковки для маркетплейсов</p>

        <p class="text-bold">Отсканируй бейдж сотрудника</p>
        <div class="scan-input-wrap" style="max-width: 320px; margin: 16px auto;">
          <input id="login-input" class="scan-input" type="text" autocomplete="off" placeholder="Бейдж (20...)">
        </div>
        <div id="login-error" class="alert alert--error" style="display:none; max-width: 320px; margin: 0 auto;"></div>

        <p class="screen-login__scanner-hint">
          Поднеси бейдж к сканеру терминала.
          Если не срабатывает — нажми на поле и отсканируй ещё раз.
        </p>
        ${demoHint}
      </div>
    `;
  },

  bind(container) {
    const input = container.querySelector('#login-input');
    const errorEl = container.querySelector('#login-error');

    Scanner.bind(input, async (badge) => {
      errorEl.style.display = 'none';
      input.classList.remove('scan-input--error');
      try {
        const resp = await Api.login(badge);
        if (resp && resp.fio) {
          Storage.setSession({
            badge: resp.badge,
            fio: resp.fio,
            role: resp.role || 'packer',
            loginTime: Date.now()
          });
          // Если есть незавершённое задание — спросить продолжить или нет
          if (Storage.hasCurrent()) {
            Screens.confirmResume.show();
          } else {
            App.navigate('supplies');
          }
        } else {
          throw new Error('Неверный ответ сервера');
        }
      } catch (e) {
        errorEl.textContent = 'Ошибка: ' + e.message;
        errorEl.style.display = 'block';
        input.classList.add('scan-input--error');
        Scanner.errorFeedback();
        Scanner.focus(input);
      }
    });

    Scanner.setPrimary(input);
  }
};

// ============================================================
// 2. SUPPLIES — выбор поставки
// ============================================================

Screens.supplies = {
  render() {
    const session = Storage.getSession();
    const isAdmin = session && session.role === 'admin';
    const adminBtn = isAdmin ? `
      <button class="btn btn--ghost" id="admin-btn" style="padding: 8px 12px; min-height: 40px;">⚙ Админ</button>
    ` : '';
    return `
      <header class="app-header">
        <span style="font-size: 14px; color: #666;">Выбери поставку</span>
        <div style="display:flex; align-items:center; gap:8px;">
          ${adminBtn}
          <div class="app-header__user" id="user-block">
            ${esc(session.fio)}
            <small>Выйти ⟶</small>
          </div>
        </div>
      </header>
      <main class="screen-list">
        <h2 class="screen-list__title">Активные поставки</h2>
        <div id="supplies-container">
          <div class="loading-screen">
            <div class="loader"></div>
            <p>Загрузка...</p>
          </div>
        </div>
      </main>
      <footer class="app-footer">Парфюм Логистик · Упаковка · v1.1</footer>
    `;
  },

  async bind(container) {
    const session = Storage.getSession();
    const userBlock = container.querySelector('#user-block');
    userBlock.addEventListener('click', () => {
      if (confirm('Выйти из системы? Незавершённое задание будет сохранено.')) {
        Storage.clearSession();
        App.navigate('login');
      }
    });

    const adminBtn = container.querySelector('#admin-btn');
    if (adminBtn) {
      adminBtn.addEventListener('click', () => {
        App.navigate('admin');
      });
    }

    const suppliesContainer = container.querySelector('#supplies-container');

    try {
      let supplies = Storage.getSuppliesCache();
      if (!supplies) {
        const resp = await Api.getSupplies();
        supplies = resp.supplies || [];
        Storage.setSuppliesCache(supplies);
      }

      if (supplies.length === 0) {
        suppliesContainer.innerHTML = `
          <div class="alert alert--info">
            Нет активных поставок. Обратись к администратору.
          </div>
        `;
        return;
      }

      suppliesContainer.innerHTML = supplies.map((s, idx) => {
        const pct = s.percent || 0;
        const done = pct >= 100;
        return `
          <button class="supply-card" data-supply-id="${esc(s.supply_id)}">
            <div>
              <span class="supply-card__num">${idx + 1}</span>
              <span class="supply-card__name">${esc(s.name)}</span>
            </div>
            <div class="supply-card__progress">
              <div class="progress-bar">
                <div class="progress-bar__fill ${done ? 'progress-bar__fill--done' : ''}" style="width: ${pct}%"></div>
              </div>
              <div class="supply-card__percent">${pct}%</div>
            </div>
            <div style="font-size: 12px; color: #666; margin-top: 4px;">
              Упаковано: ${s.packed_units} / ${s.total_units} юнитов
            </div>
          </button>
        `;
      }).join('');

      const cards = suppliesContainer.querySelectorAll('.supply-card');
      cards.forEach(card => {
        card.addEventListener('click', () => {
          const sid = card.getAttribute('data-supply-id');
          App.navigate('supply_detail', { supplyId: sid });
        });
      });
    } catch (e) {
      suppliesContainer.innerHTML = `
        <div class="alert alert--error">
          Ошибка загрузки поставок: ${esc(e.message)}
        </div>
        <button class="btn btn--secondary btn--block mt-16" onclick="App.navigate('supplies')">Повторить</button>
      `;
    }
  }
};

// ============================================================
// 3. SUPPLY_DETAIL — состав поставки + кнопка "Упаковка товара"
// ============================================================

Screens.supply_detail = {
  render(params) {
    return `
      <header class="app-header">
        <button class="btn btn--ghost" id="back-btn" style="padding: 8px 12px;">← Назад</button>
        <img src="assets/logo.svg" class="app-header__logo" alt="ПЛ">
      </header>
      <main class="screen-supply">
        <h2 class="screen-list__title" id="supply-title">Поставка</h2>
        <button class="action-btn-main" id="start-pack-btn">УПАКОВКА ТОВАРА</button>
        <div class="section-title">Состав заявки</div>
        <div id="items-container">
          <div class="loading-screen">
            <div class="loader"></div>
            <p>Загрузка...</p>
          </div>
        </div>
      </main>
    `;
  },

  async bind(container, params) {
    container.querySelector('#back-btn').addEventListener('click', () => {
      Storage.clearSuppliesCache();
      App.navigate('supplies');
    });

    container.querySelector('#start-pack-btn').addEventListener('click', () => {
      App.navigate('scan_unit', { supplyId: params.supplyId });
    });

    const titleEl = container.querySelector('#supply-title');
    const itemsContainer = container.querySelector('#items-container');

    try {
      const resp = await Api.getSupplyDetail(params.supplyId);
      const supply = resp.supply;
      const items = resp.items || [];

      titleEl.textContent = supply.name + ' (' + supply.percent + '%)';

      if (items.length === 0) {
        itemsContainer.innerHTML = `<div class="alert alert--info">В поставке нет позиций.</div>`;
        return;
      }

      itemsContainer.innerHTML = items.map(item => {
        const done = item.packed_units >= item.total_units;
        const taken = !done && item.status === 'Taken';
        const rowClass = done ? 'item-row--packed' : (taken ? 'item-row--taken' : '');

        return `
          <div class="item-row ${rowClass}">
            <div>
              <span class="item-row__num">№${item.num}</span>
              <span class="item-row__name">${esc(item.name)}</span>
            </div>
            <div class="item-row__meta">
              <span>ШК юнита: <strong>${esc(item.unit_barcode)}</strong></span>
              <span>Страна: ${esc(item.country)}</span>
              <span>Пупырка: <strong>${esc(item.pack_size)}</strong></span>
            </div>
            <div class="item-row__meta">
              <span class="item-row__progress ${done ? 'item-row__progress--done' : ''}">
                Упаковано: ${item.packed_units} / ${item.total_units}
              </span>
              ${taken ? `<span class="item-row__packer">В работе: ${esc(item.packer)}</span>` : ''}
              ${done ? `<span class="text-green">✓ Готово</span>` : ''}
            </div>
          </div>
        `;
      }).join('');
    } catch (e) {
      itemsContainer.innerHTML = `
        <div class="alert alert--error">Ошибка: ${esc(e.message)}</div>
        <button class="btn btn--secondary btn--block mt-16" onclick="App.navigate('supply_detail', {supplyId: '${esc(params.supplyId)}'})">Повторить</button>
      `;
    }
  }
};

// ============================================================
// 4. SCAN_UNIT — отсканируй ШК товара
// ============================================================

Screens.scan_unit = {
  render(params) {
    return `
      <header class="app-header">
        <button class="btn btn--ghost" id="back-btn" style="padding: 8px 12px;">← Назад</button>
        <img src="assets/logo.svg" class="app-header__logo" alt="ПЛ">
      </header>
      <main class="screen-scan">
        <h2 class="scan-title">Отсканируй ШК товара</h2>
        <p class="scan-hint">Наведи сканер на штрих-код товара</p>
        <div class="scan-input-wrap">
          <input id="unit-scan-input" class="scan-input" type="text" autocomplete="off" placeholder="ШК товара">
        </div>
        <div id="scan-error" class="alert alert--error" style="display:none;"></div>
        <div class="btn-row">
          <button class="btn btn--secondary btn--block" id="cancel-btn">Назад</button>
        </div>
      </main>
    `;
  },

  async bind(container, params) {
    container.querySelector('#back-btn').addEventListener('click', () => {
      App.navigate('supply_detail', { supplyId: params.supplyId });
    });
    container.querySelector('#cancel-btn').addEventListener('click', () => {
      App.navigate('supply_detail', { supplyId: params.supplyId });
    });

    const input = container.querySelector('#unit-scan-input');
    const errorEl = container.querySelector('#scan-error');

    // Кешируем детали поставки, чтобы не дёргать сервер на каждом скане
    let detail = null;
    async function getDetail() {
      if (!detail) detail = await Api.getSupplyDetail(params.supplyId);
      return detail;
    }

    Scanner.bind(input, async (scanned) => {
      errorEl.style.display = 'none';
      input.classList.remove('scan-input--error');

      try {
        const d = await getDetail();
        const items = d.items || [];

        // Ищем строку с этим ШК (ШК юнита или ШК товара)
        const found = items.find(it =>
          it.unit_barcode === scanned || it.barcode === scanned
        );

        if (!found) {
          throw new Error('Товар не найден в поставке');
        }

        if (found.packed_units >= found.total_units) {
          throw new Error('Этот товар уже полностью упакован');
        }

        // Проверяем, не взят ли другим сотрудником
        const session = Storage.getSession();
        if (found.status === 'Taken' && found.packer && found.packer !== session.fio) {
          throw new Error('Юнит уже упаковывает другой сотрудник: ' + found.packer);
        }

        // Если частично упакован (импорт) — спрашиваем про ленту
        if (found.packed_units > 0 && found.country !== 'РОССИЯ') {
          Screens.remainingTape.show(found, params.supplyId, (continueFromCurrent) => {
            takeAndProceed(found, continueFromCurrent);
          });
        } else {
          takeAndProceed(found, false);
        }

      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.style.display = 'block';
        input.classList.add('scan-input--error');
        Scanner.errorFeedback();
        Scanner.focus(input);
      }
    });

    async function takeAndProceed(item, continueFromCurrent) {
      try {
        const session = Storage.getSession();
        await Api.takeUnit(params.supplyId, item.row_index, session.badge, session.fio);

        // Сохраняем текущее состояние (на случай разрыва сессии)
        Storage.setCurrent({
          supplyId: params.supplyId,
          supplyName: '',
          unitRow: item.row_index,
          unitBarcode: item.unit_barcode,
          itemName: item.name,
          country: item.country,
          packSize: item.pack_size,
          total: item.total_units,
          packed: item.packed_units,
          continueFromCurrent: continueFromCurrent,
          step: 'taken',
          startTime: Date.now()
        });

        // Определяем путь (пул печати или РФ-поштучно)
        const scanResp = await Api.scanUnit(
          params.supplyId, item.row_index, item.unit_barcode, continueFromCurrent
        );

        if (scanResp.mode === 'ru_single') {
          App.navigate('ru_pack', {
            supplyId: params.supplyId,
            item: item,
            scanResp: scanResp
          });
        } else {
          App.navigate('printing_result', {
            supplyId: params.supplyId,
            item: item,
            scanResp: scanResp,
            continueFromCurrent: continueFromCurrent
          });
        }
      } catch (e) {
        errorEl.textContent = 'Ошибка: ' + e.message;
        errorEl.style.display = 'block';
        Scanner.errorFeedback();
        Scanner.focus(input);
      }
    }

    Scanner.setPrimary(input);
  }
};

// ============================================================
// 5. PRINTING_RESULT — на печать отправлено N кодов
// ============================================================

Screens.printing_result = {
  render(params) {
    const expected = params.scanResp.start_from_index || 1;
    const remaining = params.scanResp.remaining || 0;
    return `
      <header class="app-header">
        <img src="assets/logo.svg" class="app-header__logo" alt="ПЛ">
      </header>
      <main class="screen-scan">
        <div class="alert alert--success">
          ✓ На печать отправлено<br>
          <strong>${esc(params.item.name)}</strong>
        </div>
        <div class="step-card">
          <div class="step-card__title">Печать с номера ${expected}</div>
          <p class="step-card__hint">
            Принтер распечатает ленту с кодами маркировки, начиная с порядкового номера ${expected}.
            ${remaining > 0 ? `Осталось упаковать: <strong>${remaining}</strong> юнитов.` : ''}
            Каждый код напечатан в 2 экземплярах с одинаковым порядковым номером.
          </p>
          ${Api.isDemoMode() ? `
            <div class="alert alert--warning mt-16">
              Демо: реальная печать не выполняется. В боевом режиме Python-сервер
              опрашивает очередь и печатает на Zebra ZM400.
            </div>
          ` : ''}
        </div>
        <button class="btn btn--primary btn--large btn--block" id="ok-btn">ОК</button>
      </main>
    `;
  },

  bind(container, params) {
    container.querySelector('#ok-btn').addEventListener('click', () => {
      App.navigate('pack_steps', {
        supplyId: params.supplyId,
        item: params.item,
        scanResp: params.scanResp
      });
    });
  }
};

// ============================================================
// 6. PACK_STEPS — пошаговая упаковка (4 шага для импортных)
// ============================================================

Screens.pack_steps = {
  state: { step: 1, expiry: '', unitBarcodeScan: '' },

  render(params) {
    this.state = { step: 1, expiry: '', unitBarcodeScan: '' };
    this._params = params;
    return `
      <header class="app-header">
        <button class="btn btn--ghost" id="back-btn" style="padding: 8px 12px;">← Отмена</button>
        <img src="assets/logo.svg" class="app-header__logo" alt="ПЛ">
      </header>
      <main class="steps-container" id="steps-root">
        ${this._renderStep(1, params)}
      </main>
    `;
  },

  _renderStep(step, params) {
    const totalSteps = 4;
    const dots = Array.from({length: totalSteps}, (_, i) => {
      const cls = i + 1 < step ? 'step-progress__dot--done'
                : i + 1 === step ? 'step-progress__dot--active' : '';
      return `<div class="step-progress__dot ${cls}"></div>`;
    }).join('');

    const packSize = params.item.pack_size || '25х20';

    let content = '';
    if (step === 1) {
      content = `
        <div class="step-card">
          <span class="step-card__num">Шаг 1 из 4</span>
          <h3 class="step-card__title">Возьми пупырку размером:</h3>
          <div class="step-card__big">${esc(packSize)}</div>
          <p class="step-card__hint">
            Упакуй товар в <strong>ДВА слоя</strong> пупырки.
          </p>
        </div>
        <button class="btn btn--primary btn--large btn--block" id="next-btn">Дальше →</button>
      `;
    } else if (step === 2) {
      content = `
        <div class="step-card">
          <span class="step-card__num">Шаг 2 из 4</span>
          <h3 class="step-card__title">Возьми этикетку ШК юнита:</h3>
          <div class="step-card__big">${esc(params.item.unit_barcode)}</div>
          <p class="step-card__hint">Подтверди, что взял нужную, сканированием:</p>
          <div class="scan-input-wrap mt-16">
            <input id="unit-barcode-input" class="scan-input" type="text" autocomplete="off" placeholder="Отсканируй ШК юнита">
          </div>
          <div id="barcode-error" class="alert alert--error" style="display:none;"></div>
        </div>
        <div class="btn-row">
          <button class="btn btn--secondary btn--block" id="prev-btn">← Назад</button>
          <button class="btn btn--primary btn--block" id="next-btn" disabled>Дальше →</button>
        </div>
      `;
    } else if (step === 3) {
      content = `
        <div class="step-card">
          <span class="step-card__num">Шаг 3 из 4</span>
          <h3 class="step-card__title">Введи срок годности товара (Годен До):</h3>
          <div class="scan-input-wrap">
            <input id="expiry-input" class="scan-input" type="text" autocomplete="off" placeholder="ДД.ММ.ГГГГ" inputmode="numeric">
          </div>
          <p class="step-card__hint">Дата указана на упаковке товара.</p>
        </div>
        <div class="btn-row">
          <button class="btn btn--secondary btn--block" id="prev-btn">← Назад</button>
          <button class="btn btn--primary btn--block" id="next-btn">Дальше →</button>
        </div>
      `;
    } else if (step === 4) {
      content = `
        <div class="step-card">
          <span class="step-card__num">Шаг 4 из 4</span>
          <h3 class="step-card__title">Наклей коды маркировки</h3>
          <p class="step-card__hint">
            <strong>1-й код</strong> — наклей на ТОВАР<br>
            <small style="display: inline-block; background: #f5f5f5; padding: 4px 8px; border-radius: 4px; font-family: monospace; margin: 4px 0;">
              пример: 0104607...⟂21AB12
            </small>
          </p>
          <p class="step-card__hint">
            Упакуй товар в пупырку (2 слоя), запай в ПВД рукав,
            заклей торчащие углы скотчем.
          </p>
          <p class="step-card__hint">
            <strong>2-й код</strong> — наклей на УПАКОВКУ (поверх ШК юнита)<br>
            <small style="display: inline-block; background: #f5f5f5; padding: 4px 8px; border-radius: 4px; font-family: monospace; margin: 4px 0;">
              тот же код, что и на товаре
            </small>
          </p>
          <div class="alert alert--warning mt-16">
            ВНИМАНИЕ: оба кода должны иметь одинаковый порядковый номер!
          </div>
        </div>
        <div class="btn-row">
          <button class="btn btn--secondary btn--block" id="prev-btn">← Назад</button>
          <button class="btn btn--primary btn--block" id="next-btn">Готово ✓</button>
        </div>
        <button class="btn btn--ghost btn--block mt-16" id="reprint-btn">↻ Перепечатать испорченный код</button>
      `;
    }

    return `
      <div class="step-progress">${dots}</div>
      ${content}
    `;
  },

  bind(container, params) {
    this._params = params;
    container.querySelector('#back-btn').addEventListener('click', () => {
      if (confirm('Отменить упаковку? Товар вернётся в очередь.')) {
        Storage.clearCurrent();
        App.navigate('supply_detail', { supplyId: params.supplyId });
      }
    });

    this._renderStepAndBind(container, params);
  },

  _renderStepAndBind(container, params) {
    const root = container.querySelector('#steps-root');
    root.innerHTML = this._renderStep(this.state.step, params);
    this._bindStepEvents(container, params);
  },

  _bindStepEvents(container, params) {
    const step = this.state.step;
    const root = container.querySelector('#steps-root');

    const nextBtn = root.querySelector('#next-btn');
    const prevBtn = root.querySelector('#prev-btn');

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (step > 1) {
          this.state.step--;
          this._renderStepAndBind(container, params);
        }
      });
    }

    if (step === 1 && nextBtn) {
      nextBtn.addEventListener('click', () => {
        this.state.step = 2;
        this._renderStepAndBind(container, params);
        const inp = root.querySelector('#unit-barcode-input');
        if (inp) Scanner.setPrimary(inp);
      });
    }

    if (step === 2) {
      const input = root.querySelector('#unit-barcode-input');
      const errEl = root.querySelector('#barcode-error');
      const nextBtn2 = root.querySelector('#next-btn');

      Scanner.bind(input, (value) => {
        if (value !== params.item.unit_barcode) {
          errEl.textContent = 'Отсканирован не тот ШК, возьми нужный';
          errEl.style.display = 'block';
          input.classList.add('scan-input--error');
          Scanner.errorFeedback();
          Scanner.focus(input);
        } else {
          errEl.style.display = 'none';
          input.classList.remove('scan-input--error');
          input.classList.add('scan-input--ok');
          this.state.unitBarcodeScan = value;
          if (nextBtn2) nextBtn2.disabled = false;
          App.toast('ШК подтверждён', 'success');
          // Авто-переход на шаг 3
          setTimeout(() => {
            this.state.step = 3;
            this._renderStepAndBind(container, params);
            const exp = root.querySelector('#expiry-input');
            if (exp) Scanner.setPrimary(exp);
          }, 350);
        }
      });

      if (nextBtn2) {
        nextBtn2.addEventListener('click', () => {
          if (!this.state.unitBarcodeScan) {
            errEl.textContent = 'Сначала отсканируй ШК юнита';
            errEl.style.display = 'block';
            return;
          }
          this.state.step = 3;
          this._renderStepAndBind(container, params);
          const exp = root.querySelector('#expiry-input');
          if (exp) Scanner.setPrimary(exp);
        });
      }
    }

    if (step === 3) {
      const input = root.querySelector('#expiry-input');
      const nextBtn3 = root.querySelector('#next-btn');

      // Маска даты ДД.ММ.ГГГГ
      input.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '').substring(0, 8);
        if (v.length >= 3) v = v.substring(0,2) + '.' + v.substring(2);
        if (v.length >= 6) v = v.substring(0,5) + '.' + v.substring(5);
        e.target.value = v;
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (nextBtn3) nextBtn3.click();
        }
      });

      if (nextBtn3) {
        nextBtn3.addEventListener('click', () => {
          const v = input.value.trim();
          if (!/^\d{2}\.\d{2}\.\d{4}$/.test(v)) {
            App.toast('Введите дату в формате ДД.ММ.ГГГГ', 'error');
            return;
          }
          // Проверка реалистичности даты
          const [dd, mm, yyyy] = v.split('.').map(Number);
          const d = new Date(yyyy, mm - 1, dd);
          if (d.getDate() !== dd || d.getMonth() !== mm - 1 || yyyy < 2020 || yyyy > 2100) {
            App.toast('Некорректная дата', 'error');
            return;
          }
          this.state.expiry = v;
          this.state.step = 4;
          this._renderStepAndBind(container, params);
        });
      }
    }

    if (step === 4) {
      const reprintBtn = root.querySelector('#reprint-btn');
      if (reprintBtn) {
        reprintBtn.addEventListener('click', () => {
          Screens.reprint.show(params, () => {
            this._renderStepAndBind(container, params);
          });
        });
      }

      const doneBtn = root.querySelector('#next-btn');
      if (doneBtn) {
        doneBtn.addEventListener('click', () => {
          // Финальный шаг — завершение упаковки
          Screens.completePack.show(params, this.state, () => {
            Storage.clearCurrent();
            App.navigate('supply_detail', { supplyId: params.supplyId });
          });
        });
      }
    }
  }
};

// ============================================================
// 7. RU_PACK — упаковка российских товаров (поштучно)
//    Issue 2: полноценная логика счётчика
// ============================================================

Screens.ru_pack = {
  state: { scannedCodes: [], locked: false },

  render(params) {
    this.state = { scannedCodes: [], locked: false };
    this._params = params;
    const total = params.scanResp.total;
    const already = params.scanResp.already_packed;

    return `
      <header class="app-header">
        <button class="btn btn--ghost" id="back-btn" style="padding: 8px 12px;">← Отмена</button>
        <img src="assets/logo.svg" class="app-header__logo" alt="ПЛ">
      </header>
      <main class="steps-container">
        <div class="alert alert--info">
          Для упаковки РФ-товара необходимо поштучно сканировать код
          маркировки DataMatrix, нанесённый на товар.
        </div>

        <div class="pack-counter">
          <div class="pack-counter__num" id="counter-num">${already}</div>
          <div class="pack-counter__label">из ${total} отсканировано</div>
          <div class="pack-counter__progress">
            <div class="progress-bar">
              <div class="progress-bar__fill" id="counter-fill" style="width: ${Math.round(already/total*100)}%"></div>
            </div>
          </div>
        </div>

        <div class="step-card">
          <div class="step-card__title">Шаг 1. Отсканируй код маркировки с товара</div>
          <div class="scan-input-wrap">
            <input id="dm-scan-input" class="scan-input" type="text" autocomplete="off" placeholder="DataMatrix код">
          </div>
          <div id="scan-error" class="alert alert--error" style="display:none;"></div>
          <div id="scan-success" class="alert alert--success" style="display:none;"></div>
        </div>

        <div class="step-card">
          <div class="step-card__title">Отсканированные коды</div>
          <div class="scanned-list" id="scanned-list">
            <div class="scanned-list__empty">Пока ничего не отсканировано</div>
          </div>
        </div>

        <div class="step-card">
          <div class="step-card__title">Шаг 2. Возьми пупырку ${esc(params.item.pack_size || '25х20')}</div>
          <p class="step-card__hint">
            Упакуй товар в <strong>ДВА слоя</strong> пупырки,
            запай в ПВД рукав, заклей торчащие углы скотчем.
          </p>
        </div>

        <div class="step-card">
          <div class="step-card__title">Шаг 3. Наклей стикер с ШК юнита</div>
          <p class="step-card__hint">ШК юнита: <strong>${esc(params.item.unit_barcode)}</strong></p>
        </div>

        <div class="step-card">
          <div class="step-card__title">Шаг 4. Наклей код маркировки на упаковку</div>
          <p class="step-card__hint">Ниже стикера ШК юнита.</p>
        </div>

        <button class="btn btn--primary btn--large btn--block" id="complete-btn">Завершить упаковку</button>
      </main>
    `;
  },

  bind(container, params) {
    this._container = container;
    const total = params.scanResp.total;
    let scannedCount = params.scanResp.already_packed;

    const input = container.querySelector('#dm-scan-input');
    const errorEl = container.querySelector('#scan-error');
    const successEl = container.querySelector('#scan-success');
    const counterEl = container.querySelector('#counter-num');
    const counterFill = container.querySelector('#counter-fill');
    const listEl = container.querySelector('#scanned-list');
    const completeBtn = container.querySelector('#complete-btn');

    const updateCounter = () => {
      counterEl.textContent = scannedCount;
      const pct = Math.round(scannedCount / total * 100);
      counterFill.style.width = pct + '%';
      if (scannedCount >= total) {
        counterEl.classList.add('pack-counter__num--done');
        counterFill.classList.add('progress-bar__fill--done');
      }
      this._renderList(listEl);
    };

    container.querySelector('#back-btn').addEventListener('click', () => {
      if (this.state.scannedCodes.length > 0) {
        if (!confirm('Отменить упаковку? Уже отсканированные ' + this.state.scannedCodes.length +
                      ' код(ов) будут отправлены как частичная упаковка.')) return;
      } else {
        if (!confirm('Отменить упаковку? Прогресс не сохранится.')) return;
      }
      // Частичное завершение при отмене
      if (this.state.scannedCodes.length > 0) {
        Screens.completePack.show(params, {
          scannedCodes: this.state.scannedCodes.slice(),
          isRU: true,
          partial: true,
          expiry: ''
        }, () => {
          Storage.clearCurrent();
          App.navigate('supply_detail', { supplyId: params.supplyId });
        });
      } else {
        Storage.clearCurrent();
        App.navigate('supply_detail', { supplyId: params.supplyId });
      }
    });

    Scanner.bind(input, (value) => {
      if (this.state.locked) return;
      errorEl.style.display = 'none';
      successEl.style.display = 'none';
      input.classList.remove('scan-input--error');

      // Проверка лимита (Issue 2: выход за лимит)
      if (scannedCount >= total) {
        errorEl.textContent = 'Лимит достигнут: все ' + total + ' кодов отсканированы. Нажми «Завершить упаковку».';
        errorEl.style.display = 'block';
        Scanner.errorFeedback();
        Scanner.focus(input);
        return;
      }

      // Проверка дубликата (Issue 2)
      if (this.state.scannedCodes.includes(value)) {
        errorEl.textContent = 'Этот код уже отсканирован! Дубликат проигнорирован.';
        errorEl.style.display = 'block';
        Scanner.errorFeedback();
        Scanner.focus(input);
        return;
      }

      // Валидация формата GS1 DataMatrix (Issue 2)
      // РФ-коды маркировки обычно начинаются с "01" и содержат разделитель GS (chr 29) или "<GS>"
      if (!this._isValidRuCode(value)) {
        errorEl.textContent = 'Код не похож на GS1 DataMatrix. Проверь, что сканируешь код маркировки товара.';
        errorEl.style.display = 'block';
        Scanner.errorFeedback();
        Scanner.focus(input);
        return;
      }

      // Успешное сканирование
      this.state.scannedCodes.push(value);
      scannedCount++;
      updateCounter();

      successEl.textContent = '✓ Код #' + scannedCount + ' принят';
      successEl.style.display = 'block';
      setTimeout(() => { successEl.style.display = 'none'; }, 800);

      // Достигли лимита
      if (scannedCount >= total) {
        this.state.locked = true;
        input.disabled = true;
        App.toast('Все ' + total + ' кодов отсканированы!', 'success');
        setTimeout(() => { completeBtn.focus(); }, 300);
      } else {
        Scanner.focus(input);
      }
    });

    completeBtn.addEventListener('click', () => {
      if (this.state.scannedCodes.length === 0) {
        App.toast('Сначала отсканируй хотя бы один код', 'warning');
        return;
      }
      Screens.completePack.show(params, {
        scannedCodes: this.state.scannedCodes.slice(),
        isRU: true,
        partial: scannedCount < total,
        expiry: ''
      }, () => {
        Storage.clearCurrent();
        App.navigate('supply_detail', { supplyId: params.supplyId });
      });
    });

    Scanner.setPrimary(input);
  },

  // Валидация РФ-кода маркировки (упрощённая)
  _isValidRuCode(value) {
    if (!value || value.length < 10) return false;
    // GS1 DataMatrix РФ: начинается с 01, содержит GS (chr 29) или "<GS>", либо "21"
    const hasGs = value.indexOf(String.fromCharCode(29)) !== -1 || value.indexOf('<GS>') !== -1;
    const starts01 = value.indexOf('01') === 0;
    return hasGs || starts01 || value.length >= 14;
  },

  // Рендер списка отсканированных кодов с undo (Issue 2)
  _renderList(listEl) {
    const codes = this.state.scannedCodes;
    if (codes.length === 0) {
      listEl.innerHTML = '<div class="scanned-list__empty">Пока ничего не отсканировано</div>';
      return;
    }
    listEl.innerHTML = codes.map((code, idx) => {
      const display = code.length > 28 ? code.substring(0, 25) + '...' : code;
      return `
        <div class="scanned-item">
          <span class="scanned-item__num">${idx + 1}</span>
          <span class="scanned-item__code" title="${esc(code)}">${esc(display)}</span>
          <button class="scanned-item__undo" data-idx="${idx}">↶ Отменить</button>
        </div>
      `;
    }).join('');

    // Привязка undo
    listEl.querySelectorAll('.scanned-item__undo').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        this.state.scannedCodes.splice(idx, 1);
        // Разблокируем ввод если был залочен
        if (this.state.locked) {
          this.state.locked = false;
          const input = this._container.querySelector('#dm-scan-input');
          if (input) { input.disabled = false; Scanner.focus(input); }
        }
        // Обновляем счётчик и список
        const counterEl = this._container.querySelector('#counter-num');
        const total = this._params.scanResp.total;
        const newCount = this._params.scanResp.already_packed + this.state.scannedCodes.length;
        counterEl.textContent = newCount;
        counterEl.classList.remove('pack-counter__num--done');
        const fill = this._container.querySelector('#counter-fill');
        fill.style.width = Math.round(newCount / total * 100) + '%';
        fill.classList.remove('progress-bar__fill--done');
        this._renderList(listEl);
        App.toast('Код #' + (idx + 1) + ' отменён', 'warning');
      });
    });
  }
};

// ============================================================
// 8. COMPLETE_PACK — финальное окно: коробка + количество
//    Issue 5: фокус через Scanner.openModal/closeModal
// ============================================================

Screens.completePack = {
  show(params, state, onComplete) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const isRU = state.isRU;
    const scannedCount = state.scannedCodes ? state.scannedCodes.length : 0;
    overlay.innerHTML = `
      <div class="modal">
        <h3 class="modal__title">Завершение упаковки</h3>
        <div class="modal__body">
          <p>Отсканируй код груза коробки:</p>
          <input id="box-scan" class="modal__input" type="text" autocomplete="off" placeholder="22...">
          <div id="box-error" class="alert alert--error" style="display:none;"></div>

          <p class="mt-16">${isRU ? 'Сколько юнитов уложил в эту коробку?' : 'Сколько юнитов уложил?'}</p>
          <input id="count-input" class="modal__input" type="number" min="1" value="${isRU ? scannedCount : 1}" inputmode="numeric">

          ${state.expiry ? `<p class="mt-16 text-center">Срок годности: <strong>${esc(state.expiry)}</strong></p>` : ''}
          ${isRU && scannedCount ? `<p class="text-center">Отсканировано кодов: <strong>${scannedCount}</strong></p>` : ''}
        </div>
        <div class="btn-row">
          <button class="btn btn--secondary" id="cancel-btn">Отмена</button>
          <button class="btn btn--primary" id="ok-btn">Подтвердить</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const boxInput = overlay.querySelector('#box-scan');
    const countInput = overlay.querySelector('#count-input');
    const errEl = overlay.querySelector('#box-error');
    const okBtn = overlay.querySelector('#ok-btn');
    const cancelBtn = overlay.querySelector('#cancel-btn');

    // Issue 5: открываем модальный контекст фокуса
    Scanner.openModal(boxInput);

    // Обработчик сканера для поля коробки
    const boxHandler = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = boxInput.value.trim();
        if (!v.startsWith('22')) {
          errEl.textContent = 'Неверный формат кода коробки (должен начинаться с 22)';
          errEl.style.display = 'block';
          boxInput.classList.add('scan-input--error');
          Scanner.errorFeedback();
          Scanner.focus(boxInput);
        } else {
          errEl.style.display = 'none';
          boxInput.classList.remove('scan-input--error');
          boxInput.classList.add('scan-input--ok');
          countInput.focus();
          countInput.select();
        }
      }
    };
    boxInput.addEventListener('keydown', boxHandler);

    countInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        okBtn.click();
      }
    });

    const cleanup = () => {
      if (overlay.parentNode) document.body.removeChild(overlay);
      Scanner.closeModal();
    };

    okBtn.addEventListener('click', async () => {
      const boxBarcode = boxInput.value.trim();
      const count = parseInt(countInput.value, 10);

      if (!boxBarcode.startsWith('22')) {
        errEl.textContent = 'Код коробки должен начинаться с 22';
        errEl.style.display = 'block';
        Scanner.errorFeedback();
        return;
      }
      if (!count || count < 1) {
        App.toast('Укажи сколько юнитов уложил', 'error');
        return;
      }
      // Для РФ: нельзя уложить больше, чем отсканировано
      if (isRU && count > scannedCount) {
        App.toast('Нельзя уложить больше, чем отсканировано (' + scannedCount + ')', 'error');
        return;
      }

      okBtn.disabled = true;
      okBtn.textContent = 'Сохранение...';

      try {
        const session = Storage.getSession();
        const isComplete = !state.partial && count >= (params.item.total_units - params.item.packed_units);

        await Api.completePacking({
          supply_id: params.supplyId,
          unit_row: params.item.row_index,
          badge: session.badge,
          fio: session.fio,
          box_barcode: boxBarcode,
          count_packed: count,
          expiry_date: state.expiry || '',
          is_complete: isComplete
        });

        cleanup();
        App.toast('Упаковка сохранена', 'success');
        onComplete();
      } catch (e) {
        okBtn.disabled = false;
        okBtn.textContent = 'Подтвердить';
        errEl.textContent = 'Ошибка: ' + e.message;
        errEl.style.display = 'block';
        Scanner.errorFeedback();
      }
    });

    cancelBtn.addEventListener('click', cleanup);
  }
};

// ============================================================
// 9. REPRINT — перепечатать испорченный код
//    Issue 5: фокус через Scanner.openModal/closeModal
// ============================================================

Screens.reprint = {
  show(params, onClose) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3 class="modal__title">Перепечатать код</h3>
        <div class="modal__body">
          <p>Введи порядковый номер испорченной этикетки:</p>
          <input id="reprint-input" class="modal__input" type="number" min="1" inputmode="numeric" placeholder="Например: 5">
          <p class="step-card__hint">Будет напечатано 2 копии этого кода.</p>
          <div id="reprint-error" class="alert alert--error" style="display:none;"></div>
        </div>
        <div class="btn-row">
          <button class="btn btn--secondary" id="cancel-btn">Отмена</button>
          <button class="btn btn--primary" id="ok-btn">Печать</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#reprint-input');
    const errEl = overlay.querySelector('#reprint-error');
    const okBtn = overlay.querySelector('#ok-btn');
    const cancelBtn = overlay.querySelector('#cancel-btn');

    Scanner.openModal(input);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); okBtn.click(); }
    });

    const cleanup = () => {
      if (overlay.parentNode) document.body.removeChild(overlay);
      Scanner.closeModal();
    };

    okBtn.addEventListener('click', async () => {
      const idx = parseInt(input.value, 10);
      if (!idx || idx < 1) {
        errEl.textContent = 'Введи корректный номер';
        errEl.style.display = 'block';
        Scanner.errorFeedback();
        return;
      }

      okBtn.disabled = true;
      okBtn.textContent = 'Отправка...';
      try {
        const session = Storage.getSession();
        await Api.reprintCode(params.supplyId, params.item.row_index, idx, session.badge, params.item.unit_barcode);
        cleanup();
        App.toast('Задание на перепечатку отправлено. Подойди к принтеру.', 'success');
        onClose();
      } catch (e) {
        okBtn.disabled = false;
        okBtn.textContent = 'Печать';
        errEl.textContent = 'Ошибка: ' + e.message;
        errEl.style.display = 'block';
        Scanner.errorFeedback();
      }
    });

    cancelBtn.addEventListener('click', cleanup);
  }
};

// ============================================================
// 10. REMAINING_TAPE — вопрос про оставшуюся ленту
//     Issue 3: административный запрет на выбрасывание ленты
// ============================================================

Screens.remainingTape = {
  show(item, supplyId, onAnswer) {
    const allowDiscard = Storage.getSetting('allow_discard_tape'); // false по умолчанию
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    let bodyHtml = `
      <p>Ранее уже упаковано <strong>${item.packed_units}</strong> из <strong>${item.total_units}</strong> юнитов.</p>
      <p class="mt-16 text-bold">Осталась лента с распечатанными кодами DataMatrix?</p>
    `;
    let buttonsHtml = '';

    if (!allowDiscard) {
      // Issue 3: выбрасывать ленту ЗАПРЕЩЕНО администратором
      bodyHtml += `
        <div class="alert alert--warning mt-16">
          ⚠ Выбрасывать ленту с кодами <strong>запрещено</strong>.
          Продолжай наклеивать коды с текущего номера.
        </div>
        <p class="mt-16" style="font-size:13px; color:#666;">
          Лента утеряна/испорчена? Потребуется подтверждение администратора.
        </p>
      `;
      buttonsHtml = `
        <button class="btn btn--secondary btn--block" id="lost-btn" style="margin-bottom: 10px;">Лента утеряна (администратор)</button>
        <button class="btn btn--primary btn--block" id="yes-btn">Да, лента осталась — продолжить</button>
      `;
    } else {
      // Выбрасывать разрешено — обе кнопки
      buttonsHtml = `
        <button class="btn btn--secondary" id="no-btn" style="flex:1;">Нет, перепечатать</button>
        <button class="btn btn--primary" id="yes-btn" style="flex:1;">Да, осталась</button>
      `;
    }

    overlay.innerHTML = `
      <div class="modal">
        <h3 class="modal__title">Товар частично упакован</h3>
        <div class="modal__body">${bodyHtml}</div>
        <div class="btn-row" style="flex-direction:column; gap:10px;">${buttonsHtml}</div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Модалка без поля ввода — просто блокируем авто-фокус
    Scanner.openModal(null);

    const cleanup = () => {
      if (overlay.parentNode) document.body.removeChild(overlay);
      Scanner.closeModal();
    };

    overlay.querySelector('#yes-btn').addEventListener('click', () => {
      cleanup();
      onAnswer(true); // продолжить с текущего номера
    });

    if (!allowDiscard) {
      // Кнопка "Лента утеряна" — требует подтверждения администратором
      overlay.querySelector('#lost-btn').addEventListener('click', () => {
        Screens.adminOverride.show(
          'Подтвердите списание ленты (требуется администратор).',
          () => {
            // Администратор подтвердил — перепечатать с N+1
            // Логируем факт списания (в демо-режиме — в статистику)
            if (Api.isDemoMode()) {
              App.toast('Лента списана. Печать продолжится с №' + (item.packed_units + 1), 'warning');
            }
            cleanup();
            onAnswer(false);
          },
          () => { /* отмена — остаёмся в модалке */ }
        );
      });
    } else {
      overlay.querySelector('#no-btn').addEventListener('click', () => {
        cleanup();
        onAnswer(false); // перепечатать с N+1
      });
    }
  }
};

// ============================================================
// 10b. ADMIN_OVERRIDE — подтверждение администратором (для запрета ленты)
// ============================================================

Screens.adminOverride = {
  show(reason, onConfirm, onCancel) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3 class="modal__title">Требуется администратор</h3>
        <div class="modal__body">
          <p>${esc(reason)}</p>
          <p class="mt-16">Отсканируй бейдж администратора:</p>
          <input id="admin-badge-input" class="modal__input" type="text" autocomplete="off" placeholder="Бейдж (20...)">
          <div id="admin-error" class="alert alert--error" style="display:none;"></div>
        </div>
        <div class="btn-row">
          <button class="btn btn--secondary" id="cancel-btn">Отмена</button>
          <button class="btn btn--primary" id="ok-btn">Подтвердить</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#admin-badge-input');
    const errEl = overlay.querySelector('#admin-error');
    const okBtn = overlay.querySelector('#ok-btn');
    const cancelBtn = overlay.querySelector('#cancel-btn');

    Scanner.openModal(input);

    const cleanup = () => {
      if (overlay.parentNode) document.body.removeChild(overlay);
      Scanner.closeModal();
    };

    const submit = async () => {
      const badge = input.value.trim();
      if (!badge) {
        errEl.textContent = 'Отсканируй бейдж';
        errEl.style.display = 'block';
        return;
      }
      try {
        const resp = await Api.login(badge);
        if (resp.role !== 'admin') {
          throw new Error('Этот сотрудник не администратор');
        }
        cleanup();
        onConfirm();
      } catch (e) {
        errEl.textContent = e.message;
        errEl.style.display = 'block';
        Scanner.errorFeedback();
        input.value = '';
        Scanner.focus(input);
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
    okBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', () => { cleanup(); onCancel(); });
  }
};

// ============================================================
// 11. CONFIRM_RESUME — продолжить незавершённое?
// ============================================================

Screens.confirmResume = {
  show() {
    const current = Storage.getCurrent();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3 class="modal__title">Незавершённое задание</h3>
        <div class="modal__body">
          <p>У тебя есть незавершённая упаковка:</p>
          <p class="text-bold mt-16">${esc(current.itemName || 'Товар')}</p>
          <p class="text-center" style="font-size: 13px; color: #666;">
            ШК: ${esc(current.unitBarcode || '—')}<br>
            Упаковано: ${current.packed || 0} / ${current.total}
          </p>
          <p class="mt-16">Продолжить?</p>
        </div>
        <div class="btn-row">
          <button class="btn btn--secondary" id="discard-btn">Сбросить</button>
          <button class="btn btn--primary" id="continue-btn">Продолжить</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    Scanner.openModal(null);

    const cleanup = () => {
      if (overlay.parentNode) document.body.removeChild(overlay);
      Scanner.closeModal();
    };

    overlay.querySelector('#continue-btn').addEventListener('click', () => {
      cleanup();
      // Возвращаемся на экран поставки, оттуда сотрудник заново отсканирует ШК
      App.navigate('supply_detail', { supplyId: current.supplyId });
    });

    overlay.querySelector('#discard-btn').addEventListener('click', () => {
      if (confirm('Точно сбросить задание? Уже упакованные юниты останутся в статистике.')) {
        Storage.clearCurrent();
        cleanup();
        App.navigate('supplies');
      }
    });
  }
};

// ============================================================
// 12. ADMIN — админ-экран (Issue 4)
//     список поставок, добавление, статистика, настройки
// ============================================================

Screens.admin = {
  render() {
    return `
      <header class="app-header">
        <button class="btn btn--ghost" id="back-btn" style="padding: 8px 12px;">← Назад</button>
        <img src="assets/logo.svg" class="app-header__logo" alt="ПЛ">
      </header>
      <main class="admin-screen">
        <h2 class="screen-list__title">Панель администратора</h2>

        <div class="admin-card">
          <div class="admin-card__title">📦 Поставки</div>
          <div id="admin-supplies"><div class="loader"></div></div>
        </div>

        <div class="admin-card">
          <div class="admin-card__title">➕ Новая поставка</div>
          <input id="new-supply-name" class="admin-input" type="text" placeholder="Название поставки">
          <p style="font-size:12px; color:#666; margin:0 0 6px;">
            Вставь состав (TSV/CSV). Колонки: Наименование, ШК юнита, Артикул, Юнитов, Страна, Пупырка.
            Страна «РОССИЯ» = поштучное сканирование, иначе — печать пула.
          </p>
          <textarea id="new-supply-tsv" class="admin-textarea" placeholder="Туалетная вода Dior 100мл&#9;4895165564564&#9;art-DS100&#9;72&#9;ФРАНЦИЯ&#9;25х20
Шампунь Сиберика 400мл&#9;4607034590012&#9;art-NS400&#9;60&#9;РОССИЯ&#9;25х20"></textarea>
          <button class="btn btn--primary btn--block" id="add-supply-btn">Добавить поставку</button>
          <div id="add-result"></div>
        </div>

        <div class="admin-card">
          <div class="admin-card__title">📊 Статистика</div>
          <div id="admin-stats"><div class="loader"></div></div>
        </div>

        <div class="admin-card">
          <div class="admin-card__title">⚙ Настройки</div>
          <div class="admin-card__row">
            <span>Запрет на выбрасывание ленты с кодами<br><small style="color:#999;">Сотрудник обязан использовать распечатанную ленту до конца</small></span>
            <label class="switch">
              <input type="checkbox" id="setting-discard" ${Storage.getSetting('allow_discard_tape') ? 'checked' : ''}>
              <span class="switch__slider"></span>
            </label>
          </div>
          <div class="admin-card__row">
            <span>Звук при сканировании</span>
            <label class="switch">
              <input type="checkbox" id="setting-sound" ${Storage.getSetting('sound_on_scan') ? 'checked' : ''}>
              <span class="switch__slider"></span>
            </label>
          </div>
          <div class="admin-card__row">
            <span>Виброотклик при сканировании</span>
            <label class="switch">
              <input type="checkbox" id="setting-vibrate" ${Storage.getSetting('vibrate_on_scan') ? 'checked' : ''}>
              <span class="switch__slider"></span>
            </label>
          </div>
          <div class="admin-card__row">
            <span>Не гасить экран (wake lock)</span>
            <label class="switch">
              <input type="checkbox" id="setting-wake" ${Storage.getSetting('keep_screen_on') ? 'checked' : ''}>
              <span class="switch__slider"></span>
            </label>
          </div>
          ${Api.isDemoMode() ? `
            <button class="btn btn--danger btn--block mt-16" id="reset-demo-btn">Сбросить демо-данные</button>
          ` : ''}
        </div>
      </main>
    `;
  },

  async bind(container) {
    container.querySelector('#back-btn').addEventListener('click', () => {
      Storage.clearSuppliesCache();
      App.navigate('supplies');
    });

    // Загрузка поставок
    const supEl = container.querySelector('#admin-supplies');
    try {
      const stats = await Api.adminStats();
      supEl.innerHTML = stats.supplies.map(s => `
        <div class="admin-card__row">
          <span><strong>${esc(s.name)}</strong><br>
            <small style="color:#666;">${s.packed}/${s.total} (${s.percent}%)</small>
          </span>
          <div style="display:flex; align-items:center; gap:8px;">
            <label class="switch">
              <input type="checkbox" data-sid="${esc(s.supply_id)}" ${s.is_active ? 'checked' : ''}>
              <span class="switch__slider"></span>
            </label>
          </div>
        </div>
      `).join('');
      supEl.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.addEventListener('change', async () => {
          const sid = cb.getAttribute('data-sid');
          try {
            await Api.adminToggleSupply(sid, cb.checked);
            Storage.clearSuppliesCache();
            App.toast(cb.checked ? 'Поставка включена' : 'Поставка выключена', 'success');
          } catch (e) {
            App.toast('Ошибка: ' + e.message, 'error');
            cb.checked = !cb.checked;
          }
        });
      });

      // Статистика
      const stEl = container.querySelector('#admin-stats');
      const boxes = stats.boxes || [];
      const empCount = (stats.employees || []).length;
      const totalPacked = (stats.statistics || []).reduce((a, b) => a + b.count_packed, 0);
      stEl.innerHTML = `
        <div class="admin-card__row"><span>Сотрудников в базе</span><strong>${empCount}</strong></div>
        <div class="admin-card__row"><span>Создано коробок</span><strong>${boxes.length}</strong></div>
        <div class="admin-card__row"><span>Всего упаковано юнитов</span><strong>${totalPacked}</strong></div>
        <div class="admin-card__row"><span>Последние коробки</span></div>
        ${boxes.slice(0, 5).map(b => `
          <div style="font-size:12px; padding:4px 0; color:#555;">
            Короб #${b.box_number} · ${esc(b.box_barcode)} · ${b.total_units} юн. · ${esc(b.created_by)}
          </div>
        `).join('') || '<div style="font-size:12px; color:#999;">Пока нет коробок</div>'}
      `;
    } catch (e) {
      supEl.innerHTML = `<div class="alert alert--error">Ошибка: ${esc(e.message)}</div>`;
    }

    // Добавление поставки
    container.querySelector('#add-supply-btn').addEventListener('click', async () => {
      const name = container.querySelector('#new-supply-name').value.trim();
      const tsv = container.querySelector('#new-supply-tsv').value.trim();
      const result = container.querySelector('#add-result');
      if (!name) { App.toast('Введи название поставки', 'error'); return; }
      if (!tsv) { App.toast('Вставь состав поставки', 'error'); return; }
      try {
        const resp = await Api.adminAddSupply(name, tsv);
        result.innerHTML = `<div class="alert alert--success">Поставка создана: ${esc(resp.supply_id)}</div>`;
        container.querySelector('#new-supply-name').value = '';
        container.querySelector('#new-supply-tsv').value = '';
        Storage.clearSuppliesCache();
        // Обновляем список
        App.navigate('admin');
      } catch (e) {
        result.innerHTML = `<div class="alert alert--error">Ошибка: ${esc(e.message)}</div>`;
      }
    });

    // Настройки
    const bindSetting = (id, key) => {
      const el = container.querySelector(id);
      el.addEventListener('change', () => {
        Storage.setSetting(key, el.checked);
        App.toast('Настройка сохранена', 'success');
        if (key === 'keep_screen_on') {
          if (el.checked) Scanner.requestWakeLock(); else Scanner.releaseWakeLock();
        }
      });
    };
    bindSetting('#setting-discard', 'allow_discard_tape');
    bindSetting('#setting-sound', 'sound_on_scan');
    bindSetting('#setting-vibrate', 'vibrate_on_scan');
    bindSetting('#setting-wake', 'keep_screen_on');

    // Сброс демо
    const resetBtn = container.querySelector('#reset-demo-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (confirm('Сбросить все демо-данные? Это вернёт поставки и статистику к исходному состоянию.')) {
          Mock.reset();
          Storage.clearSuppliesCache();
          Storage.clearCurrent();
          App.toast('Демо-данные сброшены', 'success');
          App.navigate('admin');
        }
      });
    }
  }
};
