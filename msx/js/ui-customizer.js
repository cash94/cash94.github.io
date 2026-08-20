// =====================================================
// UI CUSTOMIZER - Настройка внешнего вида интерфейса
// Работает поверх внешней CSS (cash94.github.io/msx).
// Все переопределения используют реальные селекторы:
//   #catalog-grid / #torrents-grid  (display:grid, repeat(5,1fr))
//   .torrent-card / .torrent-poster / .torrent-title / .torrent-meta
//   .rating-badge / .catalog-badge / .catalog-row-card .torrent-poster
// Навигация пультом: собственный обработчик на window (capture),
// срабатывает раньше control.js и перехватывает клавиши, пока панель открыта.
// =====================================================

(function () {
    'use strict';

    console.log('🎨 Загрузка UI Customizer...');

    // ==================== НАСТРОЙКИ ПО УМОЛЧАНИЮ ====================

    var STORAGE_KEY = 'uiCustomizer';

    var defaultSettings = {
        catalogCardSize: 'medium',   // small | medium | large | xlarge  (управляет числом колонок)
        catalogColumns: 'auto',      // auto | 3 | 4 | 5 | 6 | 7 | 8      (явно переопределяет размер)
        fontSize: 'medium',          // small | medium | large
        borderRadius: 'medium',      // none | small | medium | large
        density: 'comfortable',      // compact | comfortable | spacious
        animations: 'normal',        // none | reduced | normal
        rowPosterSize: 'medium',     // small | medium | large  (постеры в рядах каталога)
        posterBrightness: 'normal',  // dim | normal | bright
        showRatings: true,
        showYear: true
    };

    // ==================== ЗАГРУЗКА ====================

    var currentSettings;
    try {
        var saved = localStorage.getItem(STORAGE_KEY);
        currentSettings = saved ? Object.assign({}, defaultSettings, JSON.parse(saved)) : Object.assign({}, defaultSettings);
    } catch (e) {
        currentSettings = Object.assign({}, defaultSettings);
    }

    // ==================== ТАБЛИЦЫ ЗНАЧЕНИЙ ====================

    // Размер карточки -> число колонок (меньше колонок = крупнее карточки)
    var SIZE_TO_COLUMNS = { small: 7, medium: 5, large: 4, xlarge: 3 };

    var FONT_SIZES = {
        small: { title: '11px', meta: '11px' },
        medium: { title: '13px', meta: '12px' },
        large: { title: '15px', meta: '14px' }
    };

    var RADII = { none: '0px', small: '6px', medium: '12px', large: '20px' };

    var DENSITIES = {
        compact: { gap: '6px', info: '5px' },
        comfortable: { gap: '12px', info: '8px' },
        spacious: { gap: '20px', info: '12px' }
    };

    var ROW_POSTER = {
        small: { w: '170px', h: '300px' },
        medium: { w: '210px', h: '370px' },
        large: { w: '260px', h: '460px' }
    };

    var BRIGHTNESS = { dim: '0.8', normal: '1', bright: '1.15' };

    // ==================== ПРИМЕНЕНИЕ НАСТРОЕК ====================

    function getColumns() {
        if (currentSettings.catalogColumns && currentSettings.catalogColumns !== 'auto') {
            var n = parseInt(currentSettings.catalogColumns, 10);
            if (!isNaN(n) && n > 0) return n;
        }
        return SIZE_TO_COLUMNS[currentSettings.catalogCardSize] || SIZE_TO_COLUMNS.medium;
    }

    function buildSettingsCss() {
        var cols = getColumns();
        var font = FONT_SIZES[currentSettings.fontSize] || FONT_SIZES.medium;
        var radius = RADII[currentSettings.borderRadius] || RADII.medium;
        var density = DENSITIES[currentSettings.density] || DENSITIES.comfortable;
        var row = ROW_POSTER[currentSettings.rowPosterSize] || ROW_POSTER.medium;
        var bright = BRIGHTNESS[currentSettings.posterBrightness] || BRIGHTNESS.normal;

        var css = [];

        // 1. Сетка: число колонок (= размер карточек) + отступы (плотность)
        css.push('#catalog-grid,#torrents-grid{' +
            'grid-template-columns:repeat(' + cols + ',1fr)!important;' +
            'gap:' + density.gap + '!important;}');

        // 2. Скругление карточек
        css.push('.torrent-card{border-radius:' + radius + '!important;}');

        // 3. Плотность: внутренний отступ информации
        css.push('.torrent-info{padding:' + density.info + '!important;}');

        // 4. Размер текста (снимаем фикс. высоту .torrent-title, иначе обрежет)
        css.push('.torrent-title{font-size:' + font.title + '!important;height:auto!important;max-height:none!important;}');
        css.push('.torrent-meta,.torrent-badge{font-size:' + font.meta + '!important;}');

        // 5. Рейтинги / год
        if (!currentSettings.showRatings) css.push('.rating-badge{display:none!important;}');
        if (!currentSettings.showYear) css.push('.catalog-badge{display:none!important;}');

        // 6. Яркость постеров
        css.push('.torrent-poster img,.row-poster-img,img.catalog-poster-img{filter:brightness(' + bright + ')!important;}');

        // 7. Размер постеров в рядах каталога
        css.push('.catalog-row-card .torrent-poster{width:' + row.w + '!important;height:' + row.h + '!important;}');

        // 8. Анимации (none/reduced помогают производительности на слабых ТВ)
        if (currentSettings.animations === 'none') {
            css.push('*,*::before,*::after{transition:none!important;animation:none!important;}');
        } else if (currentSettings.animations === 'reduced') {
            css.push('*,*::before,*::after{transition-duration:.1s!important;animation-duration:.1s!important;}');
        }

        return css.join('\n');
    }

    function applySettings() {
        var style = document.getElementById('ui-customizer-style');
        if (!style) {
            style = document.createElement('style');
            style.id = 'ui-customizer-style';
            document.head.appendChild(style);
        }
        style.textContent = buildSettingsCss();
        console.log('🎨 Настройки внешнего вида применены:', JSON.stringify(currentSettings));
    }

    function saveSettings() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(currentSettings));
        } catch (e) {
            console.error('UI Customizer: ошибка сохранения', e);
        }
    }

    // ==================== СТИЛИ САМОЙ ПАНЕЛИ ====================

    function injectPanelStyles() {
        if (document.getElementById('ui-customizer-panel-style')) return;
        var s = document.createElement('style');
        s.id = 'ui-customizer-panel-style';
        s.textContent = [
            '.ui-customizer-overlay{position:fixed;top:0;left:0;right:0;bottom:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.75);}',
            '.ui-customizer-overlay.hidden{display:none;}',
            '.ui-customizer-panel{width:92vw;max-width:760px;max-height:88vh;display:flex;flex-direction:column;background:#15151b;border:1px solid #2a2a30;border-radius:16px;box-shadow:0 24px 80px rgba(0,0,0,0.6);overflow:hidden;}',
            '.ui-customizer-header{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #2a2a30;}',
            '.ui-customizer-header h2{margin:0;font-size:20px;color:#fff;}',
            '.ui-customizer-close{background:#1e1e28;color:#fff;border:1px solid #33333d;border-radius:10px;width:40px;height:40px;font-size:18px;cursor:pointer;line-height:1;}',
            '.ui-customizer-content{padding:12px 22px;overflow-y:auto;overflow-x:hidden;}',
            '.ui-customizer-group{padding:12px 0;border-bottom:1px solid #202028;}',
            '.ui-customizer-group:last-child{border-bottom:none;}',
            '.ui-customizer-group h3{margin:0 0 10px 0;font-size:14px;font-weight:600;color:#9fb4cc;text-transform:uppercase;letter-spacing:.4px;}',
            '.ui-customizer-options{display:flex;flex-wrap:wrap;gap:8px;}',
            '.ui-option{background:#1e1e28;color:#cfd4dc;border:1px solid #33333d;border-radius:10px;padding:9px 16px;font-size:14px;cursor:pointer;transition:background .15s,border-color .15s;}',
            '.ui-option:hover{background:rgba(38,38,51,0.5);}',
            '.ui-option.active{background:#4a9eff;border-color:#4a9eff;color:#fff;font-weight:600;}',
            '.ui-checkbox{display:flex;align-items:center;gap:10px;padding:8px 4px;color:#cfd4dc;font-size:14px;cursor:pointer;border-radius:10px;}',
            '.ui-checkbox input{width:18px;height:18px;accent-color:#4a9eff;}',
            '.ui-customizer-footer{display:flex;justify-content:space-between;gap:12px;padding:16px 22px;border-top:1px solid #2a2a30;}',
            '.ui-cust-btn{flex:1;padding:12px 18px;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;border:1px solid #33333d;background:#1e1e28;color:#cfd4dc;}',
            '.ui-cust-btn.primary{background:#4a9eff;border-color:#4a9eff;color:#fff;}',
            // Индикатор фокуса для навигации пультом
            '.ui-customizer-panel .ui-focused{outline:3px solid #4a9eff!important;outline-offset:2px;box-shadow:0 0 0 4px rgba(74,158,255,0.25)!important;}',
            '.ui-customizer-panel .ui-checkbox.ui-focused{background:#22222c;}',
            // Кнопка входа в настройках
            '.ui-appearance-open-btn{margin-top:8px;}'
        ].join('\n');
        document.head.appendChild(s);
    }

    // ==================== СОЗДАНИЕ ПАНЕЛИ ====================

    function optionRow(setting, options) {
        var html = '';
        for (var i = 0; i < options.length; i++) {
            html += '<button class="ui-option" data-setting="' + setting + '" data-value="' + options[i][0] + '">' + options[i][1] + '</button>';
        }
        return html;
    }

    function createCustomizerPanel() {
        if (document.getElementById('ui-customizer-overlay')) return;

        var overlay = document.createElement('div');
        overlay.id = 'ui-customizer-overlay';
        overlay.className = 'ui-customizer-overlay hidden';

        overlay.innerHTML =
            '<div class="ui-customizer-panel" id="ui-customizer-panel" role="dialog" aria-label="Настройка интерфейса">' +
                '<div class="ui-customizer-header">' +
                    '<h2>🎨 Настройка интерфейса</h2>' +
                    '<button class="ui-customizer-close" id="ui-close-customizer" title="Закрыть">✕</button>' +
                '</div>' +
                '<div class="ui-customizer-content">' +
                    '<div class="ui-customizer-group"><h3>Размер карточек</h3><div class="ui-customizer-options">' +
                        optionRow('catalogCardSize', [['small', 'Малый'], ['medium', 'Средний'], ['large', 'Большой'], ['xlarge', 'Огромный']]) +
                    '</div></div>' +

                    '<div class="ui-customizer-group"><h3>Количество колонок</h3><div class="ui-customizer-options">' +
                        optionRow('catalogColumns', [['auto', 'Авто'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6'], ['7', '7'], ['8', '8']]) +
                    '</div></div>' +

                    '<div class="ui-customizer-group"><h3>Размер текста</h3><div class="ui-customizer-options">' +
                        optionRow('fontSize', [['small', 'Малый'], ['medium', 'Средний'], ['large', 'Большой']]) +
                    '</div></div>' +

                    '<div class="ui-customizer-group"><h3>Скругление углов</h3><div class="ui-customizer-options">' +
                        optionRow('borderRadius', [['none', 'Без'], ['small', 'Малое'], ['medium', 'Среднее'], ['large', 'Большое']]) +
                    '</div></div>' +

                    '<div class="ui-customizer-group"><h3>Плотность интерфейса</h3><div class="ui-customizer-options">' +
                        optionRow('density', [['compact', 'Компактный'], ['comfortable', 'Комфортный'], ['spacious', 'Просторный']]) +
                    '</div></div>' +

                    '<div class="ui-customizer-group"><h3>Анимации</h3><div class="ui-customizer-options">' +
                        optionRow('animations', [['none', 'Отключить'], ['reduced', 'Быстрые'], ['normal', 'Обычные']]) +
                    '</div></div>' +

                    '<div class="ui-customizer-group"><h3>Размер постеров в рядах</h3><div class="ui-customizer-options">' +
                        optionRow('rowPosterSize', [['small', 'Малый'], ['medium', 'Средний'], ['large', 'Большой']]) +
                    '</div></div>' +

                    '<div class="ui-customizer-group"><h3>Яркость постеров</h3><div class="ui-customizer-options">' +
                        optionRow('posterBrightness', [['dim', 'Приглушённая'], ['normal', 'Обычная'], ['bright', 'Яркая']]) +
                    '</div></div>' +

                    '<div class="ui-customizer-group"><h3>Отображение элементов</h3>' +
                        '<label class="ui-checkbox" data-check="showRatings"><input type="checkbox" id="ui-show-ratings"' + (currentSettings.showRatings ? ' checked' : '') + '><span>Показывать рейтинги</span></label>' +
                        '<label class="ui-checkbox" data-check="showYear"><input type="checkbox" id="ui-show-year"' + (currentSettings.showYear ? ' checked' : '') + '><span>Показывать год</span></label>' +
                    '</div>' +
                '</div>' +
                '<div class="ui-customizer-footer">' +
                    '<button class="ui-cust-btn" id="ui-reset-defaults">Сбросить</button>' +
                    '<button class="ui-cust-btn primary" id="ui-apply-settings">Готово</button>' +
                '</div>' +
            '</div>';

        document.body.appendChild(overlay);

        updateActiveButtons();
        setupPanelListeners();
    }

    // ==================== СИНХРОНИЗАЦИЯ КНОПОК <-> НАСТРОЙКИ ====================

    function updateActiveButtons() {
        var buttons = document.querySelectorAll('#ui-customizer-panel .ui-option');
        for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
            btn.classList.toggle('active', String(currentSettings[btn.dataset.setting]) === String(btn.dataset.value));
        }
        var r = document.getElementById('ui-show-ratings');
        var y = document.getElementById('ui-show-year');
        if (r) r.checked = !!currentSettings.showRatings;
        if (y) y.checked = !!currentSettings.showYear;
    }

    function setupPanelListeners() {
        var overlay = document.getElementById('ui-customizer-overlay');
        var panel = document.getElementById('ui-customizer-panel');
        if (!overlay || !panel) return;

        // Клик по фону закрывает
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) closeCustomizer();
        });

        // Опции (делегирование) — выбираем и сразу применяем (живой предпросмотр)
        panel.addEventListener('click', function (e) {
            var opt = e.target.closest ? e.target.closest('.ui-option') : null;
            if (opt) {
                currentSettings[opt.dataset.setting] = opt.dataset.value;
                updateActiveButtons();
                applySettings();
                setFocus(opt);
                return;
            }
        });

        // Чекбоксы
        var ratings = document.getElementById('ui-show-ratings');
        if (ratings) ratings.addEventListener('change', function () {
            currentSettings.showRatings = this.checked;
            applySettings();
        });
        var year = document.getElementById('ui-show-year');
        if (year) year.addEventListener('change', function () {
            currentSettings.showYear = this.checked;
            applySettings();
        });

        // Готово (применить + сохранить + закрыть)
        var apply = document.getElementById('ui-apply-settings');
        if (apply) apply.addEventListener('click', function () {
            applySettings();
            saveSettings();
            closeCustomizer();
        });

        // Сбросить
        var reset = document.getElementById('ui-reset-defaults');
        if (reset) reset.addEventListener('click', function () {
            currentSettings = Object.assign({}, defaultSettings);
            updateActiveButtons();
            applySettings();
        });

        // Закрыть
        var close = document.getElementById('ui-close-customizer');
        if (close) close.addEventListener('click', closeCustomizer);

        // Наведение мышью подсвечивает фокус (для пользователей с указателем)
        var focusables = panel.querySelectorAll('.ui-option,.ui-checkbox,.ui-cust-btn,.ui-customizer-close');
        for (var i = 0; i < focusables.length; i++) {
            focusables[i].addEventListener('mouseenter', function () { setFocus(this); });
        }
    }

    // ==================== ОТКРЫТЬ / ЗАКРЫТЬ ====================

    var previousBodyOverflow = '';

    function isOpen() {
        var overlay = document.getElementById('ui-customizer-overlay');
        return !!(overlay && !overlay.classList.contains('hidden'));
    }

    function openCustomizer() {
        createCustomizerPanel();
        var overlay = document.getElementById('ui-customizer-overlay');
        if (!overlay) return;
        updateActiveButtons();
        overlay.classList.remove('hidden');
        previousBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        // Начальный фокус на первую опцию
        var first = overlay.querySelector('.ui-option');
        setFocus(first || document.getElementById('ui-close-customizer'));
    }

    function closeCustomizer() {
        var overlay = document.getElementById('ui-customizer-overlay');
        if (overlay) overlay.classList.add('hidden');
        document.body.style.overflow = previousBodyOverflow;
        // Восстанавливаем фокус приложения
        try {
            if (typeof window.ensureCatalogFocus === 'function' && window.AppState && AppState.currentScreen === 'catalog') {
                window.ensureCatalogFocus(true);
            }
        } catch (e) {}
    }

    // ==================== НАВИГАЦИЯ ПУЛЬТОМ (внутри панели) ====================

    var focusedEl = null;

    function getFocusables() {
        var panel = document.getElementById('ui-customizer-panel');
        if (!panel) return [];
        var list = panel.querySelectorAll('.ui-option,.ui-checkbox,.ui-cust-btn,.ui-customizer-close');
        var out = [];
        for (var i = 0; i < list.length; i++) {
            if (list[i].offsetParent !== null) out.push(list[i]);
        }
        return out;
    }

    function setFocus(el) {
        if (!el) return;
        if (focusedEl && focusedEl !== el) focusedEl.classList.remove('ui-focused');
        focusedEl = el;
        el.classList.add('ui-focused');
        if (el.scrollIntoView) {
            try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { el.scrollIntoView(); }
        }
    }

    function centerOf(el) {
        var r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r };
    }

    // Геометрический поиск ближайшего элемента в направлении dir
    function moveFocus(dir) {
        var items = getFocusables();
        if (!items.length) return;
        if (!focusedEl || items.indexOf(focusedEl) === -1) { setFocus(items[0]); return; }

        var from = centerOf(focusedEl);
        var best = null, bestScore = Infinity;

        for (var i = 0; i < items.length; i++) {
            if (items[i] === focusedEl) continue;
            var c = centerOf(items[i]);
            var dx = c.x - from.x, dy = c.y - from.y;
            var primary, cross;

            if (dir === 'left') { if (dx >= -1) continue; primary = -dx; cross = Math.abs(dy); }
            else if (dir === 'right') { if (dx <= 1) continue; primary = dx; cross = Math.abs(dy); }
            else if (dir === 'up') { if (dy >= -1) continue; primary = -dy; cross = Math.abs(dx); }
            else if (dir === 'down') { if (dy <= 1) continue; primary = dy; cross = Math.abs(dx); }
            else continue;

            // Для вертикали сильнее штрафуем горизонтальное смещение и наоборот
            var score = (dir === 'up' || dir === 'down') ? (primary + cross * 2) : (primary + cross * 3);
            if (score < bestScore) { bestScore = score; best = items[i]; }
        }

        if (best) setFocus(best);
    }

    function activateFocused() {
        if (!focusedEl) return;
        if (focusedEl.classList.contains('ui-checkbox')) {
            var input = focusedEl.querySelector('input[type="checkbox"]');
            if (input) {
                input.checked = !input.checked;
                var ev;
                try { ev = new Event('change', { bubbles: true }); }
                catch (e) { ev = document.createEvent('Event'); ev.initEvent('change', true, true); }
                input.dispatchEvent(ev);
            }
            return;
        }
        focusedEl.click();
    }

    // ==================== ГЛОБАЛЬНЫЙ ОБРАБОТЧИК КЛАВИШ ====================
    // Регистрируется на window (capture), поэтому срабатывает РАНЬШЕ
    // обработчика control.js на document (capture) и может «съесть» событие.

    var ARROW = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
    var BACK_KEYS = [4, 8, 27, 461, 111, 10009];
    var OPEN_KEYS = [405, 67]; // «жёлтая» кнопка пульта и клавиша C
    var OPEN_SCREENS = ['catalog', 'torrents', 'search', 'detail', 'config'];

    function isEditing() {
        var a = document.activeElement;
        return !!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT') && !a.closest('#ui-customizer-panel'));
    }

    function currentAppScreen() {
        return (window.AppState && AppState.currentScreen) ? AppState.currentScreen : null;
    }

    window.addEventListener('keydown', function (e) {
        var kc = e.keyCode;

        // --- Панель открыта: полностью перехватываем навигацию ---
        if (isOpen()) {
            if (ARROW[kc]) {
                e.preventDefault(); e.stopImmediatePropagation();
                moveFocus(ARROW[kc]);
                return;
            }
            if (kc === 13) { // OK
                e.preventDefault(); e.stopImmediatePropagation();
                activateFocused();
                return;
            }
            if (BACK_KEYS.indexOf(kc) !== -1) {
                e.preventDefault(); e.stopImmediatePropagation();
                closeCustomizer();
                return;
            }
            return;
        }

        // --- Панель закрыта: горячая клавиша открытия ---
        if (OPEN_KEYS.indexOf(kc) !== -1 && !isEditing()) {
            var scr = currentAppScreen();
            if (scr === null || OPEN_SCREENS.indexOf(scr) !== -1) {
                e.preventDefault(); e.stopImmediatePropagation();
                openCustomizer();
            }
        }
    }, true);

    // ==================== КНОПКА ВХОДА В НАСТРОЙКАХ ====================
    // getConfigContentItems() в control.js собирает <button> внутри активного
    // таба, поэтому кнопка внутри appearance-tab-content доступна и с пульта, и мышью.

    function addEntryButton() {
        var container = document.getElementById('appearance-tab-content');
        if (!container || document.getElementById('open-ui-customizer-btn')) return;

        var section = document.createElement('div');
        section.className = 'settings-section';
        section.id = 'ui-appearance-entry';
        section.innerHTML =
            '<h2>Внешний вид</h2>' +
            '<button class="btn btn-primary ui-appearance-open-btn" id="open-ui-customizer-btn">🎨 Настроить внешний вид</button>' +
            '<div class="help-text" style="margin-top:10px;color:#666;font-size:12px;">' +
            'Размер и число карточек, шрифт, скругление, плотность, анимации, яркость постеров.<br>' +
            'Открыть в любой момент: жёлтая кнопка пульта или клавиша «C».</div>';

        container.appendChild(section);

        var btn = document.getElementById('open-ui-customizer-btn');
        if (btn) btn.addEventListener('click', function (e) {
            if (e && e.stopPropagation) e.stopPropagation();
            openCustomizer();
        });
    }

    // ==================== ИНИЦИАЛИЗАЦИЯ ====================

    function init() {
        applySettings();       // применяем сохранённое сразу
        injectPanelStyles();
        createCustomizerPanel();
        addEntryButton();
        console.log('✅ UI Customizer инициализирован');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // ==================== ЭКСПОРТ ====================

    window.UICustomizer = {
        open: openCustomizer,
        close: closeCustomizer,
        apply: applySettings,
        isOpen: isOpen,
        get: function () { return Object.assign({}, currentSettings); },
        set: function (partial) {
            if (partial && typeof partial === 'object') {
                currentSettings = Object.assign({}, currentSettings, partial);
                applySettings();
                saveSettings();
                updateActiveButtons();
            }
        },
        reset: function () {
            currentSettings = Object.assign({}, defaultSettings);
            applySettings();
            saveSettings();
            updateActiveButtons();
        }
    };

})();
