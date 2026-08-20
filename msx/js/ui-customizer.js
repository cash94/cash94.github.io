// =====================================================
// UI CUSTOMIZER - Настройка внешнего вида интерфейса
// Работает поверх внешней CSS (cash94.github.io/msx).
// Все переопределения используют реальные селекторы:
//   #catalog-grid / #torrents-grid  (display:grid)
//   .torrent-card / .torrent-poster / .torrent-title / .torrent-meta
//   .rating-badge / .catalog-badge / .catalog-row-card / .catalog-show-all
//   #detail-view > * (масштаб детального просмотра через zoom)
// Навигация пультом: собственный обработчик на window (capture),
// срабатывает раньше control.js и перехватывает клавиши, пока панель открыта.
// =====================================================

(function () {
    'use strict';

    console.log('🎨 Загрузка UI Customizer...');

    // ==================== НАСТРОЙКИ ПО УМОЛЧАНИЮ ====================

    var STORAGE_KEY = 'uiCustomizer';

    var defaultSettings = {
        cardSize: 210,               // ЕДИНЫЙ размер карточек и постеров: ширина в px (макс 260 = 260×460)
        detailScale: 100,            // масштаб содержимого detail-view, %
        catalogColumns: 'auto',      // auto | 3..8  (auto = число колонок считается из cardSize)
        fontSize: 'medium',          // small | medium | large
        borderRadius: 'medium',      // none | small | medium | large
        density: 'comfortable',      // compact | comfortable | spacious
        animations: 'normal',        // none | reduced | normal
        posterBrightness: 'normal',  // dim | normal | bright
        focusColor: '#ff8c00',       // цвет рамки фокуса (#rrggbb)
        showRatings: true,
        showYear: true
    };

    // ==================== ТАБЛИЦЫ ЗНАЧЕНИЙ ====================

    // Пропорции постера: самый крупный размер — 260×460
    var CARD_MAX_W = 260;
    var CARD_MAX_H = 460;

    function posterHeight(w) {
        return Math.round(w * CARD_MAX_H / CARD_MAX_W);
    }

    // Ползунки: min/max/шаг/значение по умолчанию/подпись
    var SLIDERS = {
        cardSize: {
            min: 120, max: CARD_MAX_W, step: 1, def: 210,
            fmt: function (v) { return v + ' × ' + posterHeight(v); }
        },
        detailScale: {
            min: 60, max: 160, step: 1, def: 100,
            fmt: function (v) { return v + '%'; }
        }
    };

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

    var BRIGHTNESS = { dim: '0.8', normal: '1', bright: '1.15' };

    // Палитра популярных цветов фокуса. Первый — исходный цвет приложения.
    var FOCUS_COLORS = [
        ['#ff8c00', 'Оранжевый'],
        ['#ffd60a', 'Жёлтый'],
        ['#ff3b30', 'Красный'],
        ['#ff2d92', 'Розовый'],
        ['#af52de', 'Фиолетовый'],
        ['#4a9eff', 'Синий'],
        ['#00d1ff', 'Голубой'],
        ['#00e0a4', 'Бирюзовый'],
        ['#4caf50', 'Зелёный'],
        ['#ffffff', 'Белый']
    ];

    // #abc / #aabbcc -> '#aabbcc'; мусор -> цвет по умолчанию
    function normalizeColor(v) {
        var s = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
        if (/^#[0-9a-f]{3}$/.test(s)) {
            s = '#' + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2) + s.charAt(3) + s.charAt(3);
        }
        if (/^#[0-9a-f]{6}$/.test(s)) return s;
        return defaultSettings.focusColor;
    }

    // Полупрозрачные подложки для фокуса берём из того же цвета
    function rgba(hex, alpha) {
        var n = parseInt(normalizeColor(hex).slice(1), 16);
        return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
    }

    // Миграция со старых раздельных настроек -> единый cardSize
    var LEGACY_ROW_TO_W = { small: 170, medium: 210, large: 260 };
    var LEGACY_CARD_TO_W = { small: 150, medium: 190, large: 220, xlarge: 260 };

    // ==================== ЗАГРУЗКА / НОРМАЛИЗАЦИЯ ====================

    function clampStep(value, cfg) {
        var v = parseFloat(value);
        if (isNaN(v)) v = cfg.def;
        v = Math.round(v / cfg.step) * cfg.step;
        if (v < cfg.min) v = cfg.min;
        if (v > cfg.max) v = cfg.max;
        return v;
    }

    // Старые версии хранили размер карточек и постеров раздельно
    // (catalogCardSize + rowPosterSize) — сворачиваем их в один cardSize.
    // Важно: вызывать ДО слияния с defaultSettings, иначе cardSize уже подставлен.
    function migrateLegacy(raw) {
        if (!raw || typeof raw !== 'object') return raw;
        if (raw.cardSize === undefined || raw.cardSize === null || isNaN(parseFloat(raw.cardSize))) {
            var legacy = LEGACY_ROW_TO_W[raw.rowPosterSize];
            if (!legacy) legacy = LEGACY_CARD_TO_W[raw.catalogCardSize];
            if (legacy) raw.cardSize = legacy;
        }
        delete raw.rowPosterSize;
        delete raw.catalogCardSize;
        return raw;
    }

    // Приводит настройки к актуальной схеме (клампинг ползунков, чистка старых полей)
    function normalizeSettings(s) {
        if (!s || typeof s !== 'object') s = {};
        delete s.rowPosterSize;
        delete s.catalogCardSize;

        s.cardSize = clampStep(s.cardSize, SLIDERS.cardSize);
        s.detailScale = clampStep(s.detailScale, SLIDERS.detailScale);
        s.focusColor = normalizeColor(s.focusColor);

        s.showRatings = !!s.showRatings;
        s.showYear = !!s.showYear;
        return s;
    }

    var currentSettings;
    try {
        var saved = localStorage.getItem(STORAGE_KEY);
        currentSettings = normalizeSettings(Object.assign({}, defaultSettings, migrateLegacy(saved ? JSON.parse(saved) : null)));
    } catch (e) {
        currentSettings = Object.assign({}, defaultSettings);
    }

    // ==================== ПРИМЕНЕНИЕ НАСТРОЕК ====================

    function cardWidth() { return clampStep(currentSettings.cardSize, SLIDERS.cardSize); }
    function detailScale() { return clampStep(currentSettings.detailScale, SLIDERS.detailScale); }
    function focusColor() { return normalizeColor(currentSettings.focusColor); }

    // Явно заданное число колонок (0 = авто)
    function explicitColumns() {
        if (currentSettings.catalogColumns && currentSettings.catalogColumns !== 'auto') {
            var n = parseInt(currentSettings.catalogColumns, 10);
            if (!isNaN(n) && n > 0) return n;
        }
        return 0;
    }

    function densityGap() {
        var d = DENSITIES[currentSettings.density] || DENSITIES.comfortable;
        return parseFloat(d.gap) || 12;
    }

    // Фактическое число колонок сетки.
    // Считаем в JS (а не через CSS auto-fill), потому что control.js разбирает
    // grid-template-columns регуляркой repeat(<число>) — 'auto-fill' её ломает.
    function getColumns() {
        var explicit = explicitColumns();
        if (explicit) return explicit;

        var w = cardWidth();
        var gap = densityGap();

        // Доступная ширина: сам грид, иначе его родитель (грид может быть скрыт), иначе окно
        var avail = 0;
        var grid = document.getElementById('catalog-grid') || document.getElementById('torrents-grid');
        if (grid) {
            avail = grid.clientWidth;
            if (!avail && grid.parentElement) avail = grid.parentElement.clientWidth;
            if (avail) avail -= 16; // padding грида 8px с каждой стороны
        }
        if (!(avail > 0)) avail = (window.innerWidth || 1280) - 16;

        // Столько карточек шириной w влезает в ряд с зазором gap
        var n = Math.floor((avail + gap) / (w + gap));
        if (n < 1) n = 1;
        if (n > 12) n = 12;
        return n;
    }

    // Цвет фокуса зашит в styles.css двумя цветами: #ff8c00 (общий фокус,
    // detail-view, кнопки плеера) и #4a9eff (ряды каталога, панель фильтров).
    // Перекрываем все эти правила одним выбранным цветом.
    // !important обязателен: базовые правила тоже !important, а animations.js
    // (GSAP) пишет box-shadow инлайном — инлайн проигрывает только !important.
    // Красную .filter-reset-btn-new.focused не трогаем: там цвет смысловой.
    function buildFocusCss(c) {
        var css = [];

        // Общий фокус (styles.css:2952) и detail-view (styles.css:3693)
        css.push('.focused{box-shadow:0 0 0 3px ' + c + '!important;}');
        css.push('#detail-view .focused{box-shadow:0 0 0 3px ' + c + '!important;}');

        // Кнопки действий на экране фильма (styles.css:3698)
        css.push('#catalog-watch-btn.focused,.catalog-watch-btn.focused,' +
            '.catalog-trailer-btn.focused,#catalog-trailer-btn.focused,' +
            '.detail-progress-btn.focused,#detail-progress-btn.focused,' +
            '#catalog-toggle-overview-btn.focused,.catalog-toggle-overview-btn.focused{' +
            'box-shadow:0 0 0 3px ' + c + '!important;}');

        // Кнопка «назад» (styles.css:3710)
        css.push('#back-from-detail.focused,.detail-header .back-btn.focused{' +
            'box-shadow:0 0 0 3px ' + c + '!important;background:' + rgba(c, 0.2) + '!important;}');

        // Актёры и «похожие» (styles.css:3716/3721)
        css.push('.catalog-actor-card.focused,.catalog-recommendation-card.focused{' +
            'box-shadow:0 0 0 3px ' + c + '!important;}');

        // Карточки рядов-каруселей (styles.css:3939) — тень «подъёма» сохраняем
        css.push('.catalog-row-card.focused .torrent-poster{' +
            'box-shadow:0 0 0 3px ' + c + ',0 16px 40px rgba(0,0,0,0.6)!important;}');

        // Карточка «Показать все» (styles.css:3972)
        css.push('.catalog-show-all.focused .show-all-inner{' +
            'border-color:' + c + '!important;background:' + rgba(c, 0.22) + '!important;' +
            'box-shadow:0 0 0 3px ' + c + '!important;}');

        // Заголовок ряда (styles.css:3983/3987)
        css.push('.catalog-row-header.focused{background:' + rgba(c, 0.08) + '!important;}');
        css.push('.catalog-row-header.focused .catalog-row-title{' +
            'color:' + c + '!important;text-shadow:0 0 20px ' + rgba(c, 0.4) + '!important;}');

        // Кнопки плеера (styles.css:1515)
        css.push('.control-btn.focused{background:' + rgba(c, 0.2) + '!important;' +
            'box-shadow:0 0 0 2px ' + c + '!important;}');

        // Панель фильтров (styles.css:4160/4204/4282)
        css.push('.filter-back-btn:focus-visible,.filter-close-btn:focus-visible,' +
            '.filter-back-btn.focused,.filter-close-btn.focused{' +
            'background:' + rgba(c, 0.2) + '!important;box-shadow:0 0 0 2px ' + c + '!important;}');
        css.push('.filter-item.focused{background:' + rgba(c, 0.1) + '!important;' +
            'box-shadow:0 0 0 2px ' + c + '!important;}');
        css.push('.filter-value-item.focused{background:' + rgba(c, 0.15) + '!important;' +
            'box-shadow:0 0 0 2px ' + c + '!important;}');

        // Кнопка «пропустить» в плеере (styles.css:3085/3091)
        css.push('.skip-button.focused{border-color:' + c + '!important;' +
            'box-shadow:0 0 10px ' + c + ',0 2px 8px rgba(0,0,0,0.2)!important;}');
        css.push('.skip-button.focused.filled{' +
            'box-shadow:0 0 15px ' + c + ',0 4px 15px rgba(0,0,0,0.3)!important;}');

        // Сама панель настройки — живой предпросмотр выбранного цвета.
        // Селектор длиннее, чем в injectPanelStyles(), чтобы победить
        // независимо от порядка тегов <style> в head.
        css.push('.ui-customizer-overlay .ui-customizer-panel .ui-focused{' +
            'outline-color:' + c + '!important;box-shadow:0 0 0 4px ' + rgba(c, 0.25) + '!important;}');

        // Выбранный образец в палитре обводим его же цветом
        css.push('.ui-customizer-panel .ui-swatch[data-value="' + c + '"]{border-color:' + c + '!important;}');

        return css;
    }

    function buildSettingsCss() {
        var w = cardWidth();
        var h = posterHeight(w);
        var cols = getColumns();
        var font = FONT_SIZES[currentSettings.fontSize] || FONT_SIZES.medium;
        var radius = RADII[currentSettings.borderRadius] || RADII.medium;
        var density = DENSITIES[currentSettings.density] || DENSITIES.comfortable;
        var bright = BRIGHTNESS[currentSettings.posterBrightness] || BRIGHTNESS.normal;
        var scale = detailScale();

        var css = [];

        // 1. Сетка: ширина карточки задаёт число колонок (либо оно задано явно)
        css.push('#catalog-grid,#torrents-grid{' +
            'grid-template-columns:repeat(' + cols + ',1fr)!important;' +
            'gap:' + density.gap + '!important;}');

        // Подсказка для content-visibility, чтобы скролл не «прыгал»
        css.push('.torrent-card.catalog-card{contain-intrinsic-size:' + w + 'px ' + Math.round(w * 1.5 + 60) + 'px!important;}');

        // 2. ТОТ ЖЕ размер — постеры в рядах-каруселях каталога (.catalog-row-card)
        css.push('.catalog-row-card,.catalog-row-viewport .catalog-row-card{' +
            'flex:0 0 ' + w + 'px!important;width:' + w + 'px!important;}');
        css.push('.catalog-row-viewport .catalog-row-card{height:' + h + 'px!important;}');
        css.push('.catalog-row-card .torrent-poster,.catalog-row-viewport .catalog-row-card .torrent-poster{' +
            'width:' + w + 'px!important;height:' + h + 'px!important;}');
        // Карточка «Показать все» — тот же размер
        css.push('.catalog-show-all,.catalog-row-viewport .catalog-show-all{' +
            'flex:0 0 ' + w + 'px!important;width:' + w + 'px!important;}');
        css.push('.catalog-show-all .show-all-inner,.catalog-row-viewport .catalog-show-all .show-all-inner{' +
            'width:' + w + 'px!important;height:' + h + 'px!important;}');

        // 3. Скругление карточек
        css.push('.torrent-card{border-radius:' + radius + '!important;}');

        // 4. Плотность: внутренний отступ информации
        css.push('.torrent-info{padding:' + density.info + '!important;}');

        // 5. Размер текста (снимаем фикс. высоту .torrent-title, иначе обрежет)
        css.push('.torrent-title{font-size:' + font.title + '!important;height:auto!important;max-height:none!important;}');
        css.push('.torrent-meta,.torrent-badge{font-size:' + font.meta + '!important;}');

        // 6. Рейтинги / год
        if (!currentSettings.showRatings) css.push('.rating-badge{display:none!important;}');
        if (!currentSettings.showYear) css.push('.catalog-badge{display:none!important;}');

        // 7. Яркость постеров
        css.push('.torrent-poster img,.row-poster-img,img.catalog-poster-img{filter:brightness(' + bright + ')!important;}');

        // 8. Масштаб detail-view.
        //    zoom вешаем на содержимое (а не на сам #detail-view — он position:fixed inset:0
        //    и является скролл-контейнером), фон-подложку #catalog-detail-backdrop
        //    (position:fixed) исключаем, иначе она вылезет за экран.
        if (scale !== 100) {
            css.push('#detail-view>*:not(#catalog-detail-extra),' +
                '#detail-view>#catalog-detail-extra>*:not(#catalog-detail-backdrop){' +
                'zoom:' + (scale / 100) + '!important;}');
        }

        // 9. Цвет фокуса
        css = css.concat(buildFocusCss(focusColor()));

        // 10. Анимации (none/reduced помогают производительности на слабых ТВ)
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
        // Число колонок изменилось — сбрасываем кэш навигации в control.js
        try { if (typeof window.invalidateColumnsCache === 'function') window.invalidateColumnsCache(); } catch (e) {}
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
            '.ui-customizer-header{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #2a2a30;}',
            '.ui-customizer-header h2{margin:0;font-size:20px;color:#fff;}',
            '.ui-customizer-close{background:#1e1e28;color:#fff;border:1px solid #33333d;border-radius:10px;width:40px;height:40px;font-size:18px;cursor:pointer;line-height:1;}',
            // min-height:0 обязателен, иначе flex-элемент не сжимается и скролл ломается
            '.ui-customizer-content{flex:1 1 auto;min-height:0;padding:0 22px 12px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;}',
            '.ui-customizer-group{padding:0 0 12px;border-bottom:1px solid #202028;}',
            '.ui-customizer-group:last-child{border-bottom:none;}',
            // Залипающий заголовок: всегда видно, какой параметр настраиваешь
            '.ui-customizer-group h3{position:sticky;top:0;z-index:3;display:flex;align-items:baseline;justify-content:space-between;gap:12px;' +
                'margin:0 -22px 10px;padding:12px 22px 8px;font-size:14px;font-weight:600;color:#9fb4cc;text-transform:uppercase;letter-spacing:.4px;background:#15151b;}',
            '.ui-customizer-hint{margin:-4px 0 8px;font-size:12px;color:#6f7889;text-transform:none;letter-spacing:0;}',
            '.ui-customizer-options{display:flex;flex-wrap:wrap;gap:8px;}',
            '.ui-option{background:#1e1e28;color:#cfd4dc;border:1px solid #33333d;border-radius:10px;padding:9px 16px;font-size:14px;cursor:pointer;transition:background .15s,border-color .15s;}',
            '.ui-option:hover{background:rgba(38,38,51,0.5);}',
            '.ui-option.active{background:#4a9eff;border-color:#4a9eff;color:#fff;font-weight:600;}',
            // Палитра цвета фокуса
            '.ui-swatch{display:inline-flex;align-items:center;gap:9px;padding:8px 15px 8px 10px;}',
            '.ui-swatch-dot{flex:0 0 auto;width:18px;height:18px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.5);}',
            // 3 класса — перебивает .ui-option.active независимо от порядка правил
            '.ui-option.ui-swatch.active{background:#22222c;color:#fff;font-weight:600;}',
            '.ui-swatch.active .ui-swatch-dot{box-shadow:inset 0 0 0 2px #fff,0 0 0 1px rgba(0,0,0,.6);}',
            // Ползунок
            '.ui-slider{display:flex;align-items:center;gap:16px;padding:8px 4px;border-radius:10px;user-select:none;-webkit-user-select:none;}',
            '.ui-slider-track{position:relative;flex:1 1 auto;height:8px;background:#262630;border-radius:6px;cursor:pointer;}',
            '.ui-slider-fill{position:absolute;left:0;top:0;bottom:0;width:0;background:#4a9eff;border-radius:6px;}',
            '.ui-slider-thumb{position:absolute;top:50%;left:0;width:22px;height:22px;margin:-11px 0 0 -11px;background:#fff;border:2px solid #4a9eff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.55);}',
            '.ui-slider-val{flex:0 0 auto;min-width:104px;text-align:right;font-size:15px;font-weight:600;color:#e8edf5;}',
            '.ui-slider.ui-focused .ui-slider-track{background:#33333f;}',
            '.ui-slider.ui-focused .ui-slider-thumb{width:26px;height:26px;margin:-13px 0 0 -13px;}',
            '.ui-slider-ends{display:flex;justify-content:space-between;margin-top:2px;font-size:11px;color:#5d6675;}',
            '.ui-checkbox{display:flex;align-items:center;gap:10px;padding:8px 4px;color:#cfd4dc;font-size:14px;cursor:pointer;border-radius:10px;}',
            '.ui-checkbox input{width:18px;height:18px;accent-color:#4a9eff;}',
            '.ui-customizer-footer{flex:0 0 auto;display:flex;justify-content:space-between;gap:12px;padding:16px 22px;border-top:1px solid #2a2a30;}',
            '.ui-cust-btn{flex:1;padding:12px 18px;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;border:1px solid #33333d;background:#1e1e28;color:#cfd4dc;}',
            '.ui-cust-btn.primary{background:#4a9eff;border-color:#4a9eff;color:#fff;}',
            // Индикатор фокуса для навигации пультом
            '.ui-customizer-panel .ui-focused{outline:3px solid #4a9eff!important;outline-offset:2px;box-shadow:0 0 0 4px rgba(74,158,255,0.25)!important;}',
            '.ui-customizer-panel .ui-checkbox.ui-focused,.ui-customizer-panel .ui-slider.ui-focused{background:#22222c;}',
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

    // Образцы цветов фокуса — обычные .ui-option, поэтому сразу доступны с пульта
    function swatchRow() {
        var html = '';
        for (var i = 0; i < FOCUS_COLORS.length; i++) {
            var c = FOCUS_COLORS[i][0];
            html += '<button class="ui-option ui-swatch" data-setting="focusColor" data-value="' + c + '" title="' + c + '">' +
                        '<span class="ui-swatch-dot" style="background:' + c + '"></span>' +
                        '<span>' + FOCUS_COLORS[i][1] + '</span>' +
                    '</button>';
        }
        return html;
    }

    function sliderRow(setting, minLabel, maxLabel) {
        var cfg = SLIDERS[setting];
        return '<div class="ui-slider" data-setting="' + setting + '">' +
                   '<div class="ui-slider-track">' +
                       '<div class="ui-slider-fill"></div>' +
                       '<div class="ui-slider-thumb"></div>' +
                   '</div>' +
                   '<div class="ui-slider-val">' + cfg.fmt(cfg.def) + '</div>' +
               '</div>' +
               '<div class="ui-slider-ends"><span>' + minLabel + '</span><span>' + maxLabel + '</span></div>';
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
                    '<div class="ui-customizer-group"><h3>Размер карточек и постеров</h3>' +
                        '<div class="ui-customizer-hint">Один размер для сетки и для рядов-карусели. Максимум — 260 × 460.</div>' +
                        sliderRow('cardSize', '120 × ' + posterHeight(SLIDERS.cardSize.min), CARD_MAX_W + ' × ' + CARD_MAX_H) +
                    '</div>' +

                    '<div class="ui-customizer-group"><h3>Масштаб детального просмотра</h3>' +
                        '<div class="ui-customizer-hint">Шапка, описание, кнопки, актёры и список файлов на экране фильма.</div>' +
                        sliderRow('detailScale', SLIDERS.detailScale.min + '%', SLIDERS.detailScale.max + '%') +
                    '</div>' +

                    '<div class="ui-customizer-group"><h3>Количество колонок</h3>' +
                        '<div class="ui-customizer-hint">«Авто» — колонки считаются из размера карточки.</div>' +
                        '<div class="ui-customizer-options">' +
                            optionRow('catalogColumns', [['auto', 'Авто'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6'], ['7', '7'], ['8', '8']]) +
                        '</div>' +
                    '</div>' +

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

                    '<div class="ui-customizer-group"><h3>Яркость постеров</h3><div class="ui-customizer-options">' +
                        optionRow('posterBrightness', [['dim', 'Приглушённая'], ['normal', 'Обычная'], ['bright', 'Яркая']]) +
                    '</div></div>' +

                    '<div class="ui-customizer-group"><h3>Цвет фокуса</h3>' +
                        '<div class="ui-customizer-hint">Цвет рамки вокруг выбранного элемента: карточки, кнопки, ряды, фильтры, плеер.</div>' +
                        '<div class="ui-customizer-options">' + swatchRow() + '</div>' +
                    '</div>' +

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

    // ==================== ПОЛЗУНКИ ====================

    function sliderConfig(el) {
        return el && el.dataset ? SLIDERS[el.dataset.setting] : null;
    }

    function updateSliders() {
        var list = document.querySelectorAll('#ui-customizer-panel .ui-slider');
        for (var i = 0; i < list.length; i++) {
            var el = list[i];
            var cfg = sliderConfig(el);
            if (!cfg) continue;

            var v = clampStep(currentSettings[el.dataset.setting], cfg);
            var pct = (v - cfg.min) / (cfg.max - cfg.min) * 100;

            var fill = el.querySelector('.ui-slider-fill');
            var thumb = el.querySelector('.ui-slider-thumb');
            var val = el.querySelector('.ui-slider-val');
            if (fill) fill.style.width = pct + '%';
            if (thumb) thumb.style.left = pct + '%';
            if (val) val.textContent = cfg.fmt(v);
        }
    }

    function setSliderValue(el, value) {
        var cfg = sliderConfig(el);
        if (!cfg) return;
        var v = clampStep(value, cfg);
        if (currentSettings[el.dataset.setting] === v) return;
        currentSettings[el.dataset.setting] = v;
        updateSliders();
        applySettings();   // живой предпросмотр
    }

    function nudgeSlider(el, direction) {
        var cfg = sliderConfig(el);
        if (!cfg) return;
        setSliderValue(el, clampStep(currentSettings[el.dataset.setting], cfg) + direction * cfg.step);
    }

    function valueFromPointer(el, clientX) {
        var cfg = sliderConfig(el);
        var track = el.querySelector('.ui-slider-track');
        if (!cfg || !track) return 0;
        var r = track.getBoundingClientRect();
        var t = r.width ? (clientX - r.left) / r.width : 0;
        if (t < 0) t = 0;
        if (t > 1) t = 1;
        return cfg.min + t * (cfg.max - cfg.min);
    }

    function bindSlider(el) {
        el.addEventListener('mousedown', function (e) {
            e.preventDefault();
            var self = this;
            setFocus(self, true);
            setSliderValue(self, valueFromPointer(self, e.clientX));

            var onMove = function (ev) { setSliderValue(self, valueFromPointer(self, ev.clientX)); };
            var onUp = function () {
                document.removeEventListener('mousemove', onMove, true);
                document.removeEventListener('mouseup', onUp, true);
            };
            document.addEventListener('mousemove', onMove, true);
            document.addEventListener('mouseup', onUp, true);
        });
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
        updateSliders();
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

        // Ползунки (мышь)
        var sliders = panel.querySelectorAll('.ui-slider');
        for (var i = 0; i < sliders.length; i++) bindSlider(sliders[i]);

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

        // Наведение мышью подсвечивает фокус (без автоскролла — иначе панель «убегает» под курсором)
        var focusables = panel.querySelectorAll('.ui-option,.ui-checkbox,.ui-slider,.ui-cust-btn,.ui-customizer-close');
        for (var j = 0; j < focusables.length; j++) {
            focusables[j].addEventListener('mouseenter', function () { setFocus(this, true); });
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

        // Ползунки считают позицию по ширине трека — она известна только после показа
        updateSliders();

        // Начальный фокус на первый элемент, скролл в самое начало
        var content = overlay.querySelector('.ui-customizer-content');
        if (content) content.scrollTop = 0;
        var first = overlay.querySelector('.ui-slider,.ui-option');
        setFocus(first || document.getElementById('ui-close-customizer'), true);
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
    var FOCUS_SELECTOR = '.ui-option,.ui-checkbox,.ui-slider,.ui-cust-btn,.ui-customizer-close';

    function getFocusables() {
        var panel = document.getElementById('ui-customizer-panel');
        if (!panel) return [];
        var list = panel.querySelectorAll(FOCUS_SELECTOR);
        var out = [];
        for (var i = 0; i < list.length; i++) {
            if (list[i].offsetParent !== null) out.push(list[i]);
        }
        return out;
    }

    // Прокрутка к элементу с учётом заголовка параметра:
    // если элемент в первой строке своей группы — показываем группу вместе с <h3>.
    function scrollFocusIntoView(el) {
        var content = document.querySelector('#ui-customizer-panel .ui-customizer-content');
        if (!content || !el || !content.contains(el)) return;

        var PAD = 10;
        var eRect = el.getBoundingClientRect();
        var cRect = content.getBoundingClientRect();
        var group = el.closest ? el.closest('.ui-customizer-group') : null;

        // Высота залипающего заголовка — под ним элемент считается скрытым
        var head = group ? group.querySelector('h3') : null;
        var headH = head ? head.offsetHeight : 0;

        var desiredTop = eRect.top;
        var topInset = headH;

        if (group) {
            // Есть ли в этой же группе элемент, который целиком выше текущего?
            var sibs = group.querySelectorAll(FOCUS_SELECTOR);
            var firstRow = true;
            for (var i = 0; i < sibs.length; i++) {
                if (sibs[i] === el) continue;
                if (sibs[i].getBoundingClientRect().bottom <= eRect.top + 1) { firstRow = false; break; }
            }
            if (firstRow) {
                // Первая строка группы — подтягиваем блок целиком, вместе с заголовком
                desiredTop = group.getBoundingClientRect().top;
                topInset = 0;
            }
        }

        var above = (cRect.top + topInset + PAD) - desiredTop;
        if (above > 0) { content.scrollTop -= above; return; }

        var below = (eRect.bottom + PAD) - cRect.bottom;
        if (below > 0) content.scrollTop += below;
    }

    function setFocus(el, skipScroll) {
        if (!el) return;
        if (focusedEl && focusedEl !== el) focusedEl.classList.remove('ui-focused');
        focusedEl = el;
        el.classList.add('ui-focused');
        if (!skipScroll) scrollFocusIntoView(el);
    }

    // Зазор между проекциями прямоугольников на ось (0 = перекрываются)
    function gapBetween(aStart, aEnd, bStart, bEnd) {
        if (bEnd <= aStart) return aStart - bEnd;
        if (bStart >= aEnd) return bStart - aEnd;
        return 0;
    }

    // Геометрический поиск ближайшего элемента в направлении dir.
    // Считаем расстояние по краям (а не по центрам) — иначе широкие ползунки
    // «проигрывают» узким кнопкам и до них невозможно добраться.
    function moveFocus(dir) {
        var items = getFocusables();
        if (!items.length) return;
        if (!focusedEl || items.indexOf(focusedEl) === -1) { setFocus(items[0]); return; }

        var a = focusedEl.getBoundingClientRect();
        var aCx = a.left + a.width / 2, aCy = a.top + a.height / 2;
        var best = null, bestScore = Infinity;

        for (var i = 0; i < items.length; i++) {
            if (items[i] === focusedEl) continue;
            var b = items[i].getBoundingClientRect();
            var bCx = b.left + b.width / 2, bCy = b.top + b.height / 2;
            var primary, cross, weight;

            if (dir === 'left') {
                if (bCx >= aCx - 1) continue;
                primary = Math.max(0, a.left - b.right);
                cross = gapBetween(a.top, a.bottom, b.top, b.bottom);
                weight = 3;
            } else if (dir === 'right') {
                if (bCx <= aCx + 1) continue;
                primary = Math.max(0, b.left - a.right);
                cross = gapBetween(a.top, a.bottom, b.top, b.bottom);
                weight = 3;
            } else if (dir === 'up') {
                if (bCy >= aCy - 1) continue;
                primary = Math.max(0, a.top - b.bottom);
                cross = gapBetween(a.left, a.right, b.left, b.right);
                weight = 2;
            } else if (dir === 'down') {
                if (bCy <= aCy + 1) continue;
                primary = Math.max(0, b.top - a.bottom);
                cross = gapBetween(a.left, a.right, b.left, b.right);
                weight = 2;
            } else continue;

            var score = primary + cross * weight;
            if (score < bestScore) { bestScore = score; best = items[i]; }
        }

        if (best) setFocus(best);
    }

    function activateFocused() {
        if (!focusedEl) return;
        if (focusedEl.classList.contains('ui-slider')) return;   // ползунок меняется влево/вправо
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
                var dir = ARROW[kc];
                // На ползунке влево/вправо меняет значение, вверх/вниз уходит с него
                if (focusedEl && focusedEl.classList.contains('ui-slider') && (dir === 'left' || dir === 'right')) {
                    nudgeSlider(focusedEl, dir === 'right' ? 1 : -1);
                } else {
                    moveFocus(dir);
                }
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
            'Размер карточек и постеров (ползунок, до 260×460), масштаб детального просмотра, колонки,<br>' +
            'шрифт, скругление, плотность, анимации, яркость постеров, цвет фокуса.<br>' +
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

    // Ширина окна изменилась — пересчитываем число колонок под тот же размер карточки
    var resizeTimer = null;
    window.addEventListener('resize', function () {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
            resizeTimer = null;
            applySettings();
            if (isOpen()) updateSliders();
        }, 150);
    });

    // ==================== ЭКСПОРТ ====================

    window.UICustomizer = {
        open: openCustomizer,
        close: closeCustomizer,
        apply: applySettings,
        isOpen: isOpen,
        getColumns: getColumns,          // используется control.js для навигации пультом
        getCardSize: function () { var w = cardWidth(); return { width: w, height: posterHeight(w) }; },
        getFocusColor: focusColor,
        get: function () { return Object.assign({}, currentSettings); },
        set: function (partial) {
            if (partial && typeof partial === 'object') {
                currentSettings = normalizeSettings(Object.assign({}, currentSettings, partial));
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
