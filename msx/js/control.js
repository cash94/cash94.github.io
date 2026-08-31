// control.js - Модуль управления навигацией, фокусом и обработкой клавиш
// ==================== КОНСТАНТЫ ====================
var KEY_CODES = {
    OK: 13,
    ESC: 27,
    BACK: [4, 8, 27, 461, 111, 10009],
    ARROWS: { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40 },
    SPACE: 32
};

var OK_HOLD_DELETE_MS = 900;
var SEEK_ACCELERATION_STEPS = [
    { time: 0, step: 5 },
    { time: 500, step: 10 },
    { time: 1000, step: 20 },
    { time: 1500, step: 30 },
    { time: 2000, step: 45 },
    { time: 2500, step: 60 },
    { time: 3000, step: 90 },
    { time: 4000, step: 120 }
];

var SCROLL_SMOOTH = {
    force: true,
    durationX: 0.33,
    durationY: 0.38,
    durationFastX: 0.20,
    durationFastY: 0.25,
    ease: 'power3.out'
};

// ==================== СОСТОЯНИЕ ====================
var focusableElements = [];
var currentFocusIndex = 0;
var lastSelectedTorrentHash = null;
var lastSelectedTorrentIndex = 0;
var lastPlayerBackPressAt = 0;
var seekHoldInterval = null;
var seekHoldStep = 5;
var seekHoldDelay = 150;
var isSeekHoldActive = false;
var accelerationTimer = null;
var okHoldTimer = null;
var okHoldHandled = false;
var okHoldFocused = null;
var fastNavigation = false;
var fastNavigationTimer = null;
// Автоповтор от браузера: ставится в обработчиках keydown, читается
// setFastNavigation. Признак того, что кнопку именно ДЕРЖАТ.
var navKeyRepeat = false;
var navStreak = 0;
var navStreakAt = 0;
var navStreakDir = null;
var lastPopStateTime = 0;
var isProcessingBack = false;
var lastNavDirection = 'right';

var configState = {
    activeTabId: 'torrserver-tab',
    isOnMenu: true,
    previousFocusElement: null,
    initialized: false
};

var customFilterMenuState = null;

// Кэш для updateFocusableElements
var _focusCache = {
    timestamp: 0,
    screen: null,
    elements: [],
    gen: -1,
    ttl: 100 // мс
};

// Поколение DOM: инкрементируется в invalidateFocusCache() из всех точек, где
// реально меняется состав фокусируемых элементов. Для экрана каталога кэш живёт
// по поколению, а не по 100-мс TTL: там на каждое нажатие стрелки шёл полный
// обход ~90 карточек с offsetParent, и на Android TV это заметно.
var _focusGen = 0;

// Кэш getCatalogRows() — та же схема, тот же счётчик поколений
var _rowsCache = { gen: -1, rows: null };

// Кэш getCatalogGridCards() — то же самое для режима сетки категории.
// Раньше кэша тут не было вовсе: каждое нажатие стрелки строило список заново
// (querySelectorAll по документу + offsetParent на каждой карточке). В рядах
// это ~90 элементов, а в сетке с catalog-idb-patch.js подгрузка идёт порциями
// по ITEMS_PER_PAGE до CATALOG_FULL_LIMIT — то есть до 1000 offsetParent на
// нажатие, и чем глубже пользователь ушёл, тем сильнее фризит навигация.
var _gridCardsCache = { gen: -1, cards: null };

// Каталог держит кэш фокуса ТОЛЬКО по поколению, без TTL.
//
// Раньше здесь был предохранитель в 1500мс на случай мутации DOM, забывшей
// позвать invalidateFocusCache(). Но при непрерывной навигации он срабатывал
// всегда — раз в полторы секунды список из сотен карточек пересобирался
// целиком (querySelectorAll + offsetParent на каждой), и это ощущалось как
// периодический рывок. Все реальные изменения состава двигают _focusGen:
// renderCatalogGrid, appendCatalogItems, showCatalogGridView/RowsView,
// прогрессивная сборка рядов — каждая из них зовёт invalidateFocusCache().

// ==================== ИНДИКАТОР ПЕРЕМОТКИ ====================
/**
 * Крупное время под курсором перемотки. Живёт в готовом #seek-speed-indicator
 * внутри #player-screen — раньше control.js создавал свой div и вешал его в
 * <body>, из-за чего в полноэкранном режиме индикатора не было видно вообще
 * (браузер рисует только полноэкранный элемент и его потомков), а оформление
 * было прибито инлайном мимо styles.css.
 *
 * Кроме времени показываем текущий шаг ускорения: при удержании кнопки он
 * растёт с 5 до 120 секунд, и без подсказки непонятно, почему полоса вдруг
 * поехала быстрее. Раньше шаг только писался в консоль.
 */
var seekIndicatorEl = null;
var seekIndicatorTimeEl = null;
var seekIndicatorDirEl = null;
var seekIndicatorStepEl = null;
var seekOverlayTimeout = null;

function getSeekIndicator() {
    if (seekIndicatorEl && seekIndicatorEl.parentNode) return seekIndicatorEl;
    seekIndicatorEl = getEl('seek-speed-indicator');
    if (!seekIndicatorEl) return null;
    if (!seekIndicatorEl.firstChild) {
        seekIndicatorEl.innerHTML =
            '<div class="seek-indicator-time" id="seek-time">00:00</div>' +
            '<div class="seek-indicator-step">' +
            '<span class="seek-indicator-dir" id="seek-direction"></span>' +
            '<span class="seek-indicator-speed" id="seek-step"></span>' +
            '</div>';
    }
    seekIndicatorTimeEl = seekIndicatorEl.querySelector('#seek-time');
    seekIndicatorDirEl = seekIndicatorEl.querySelector('#seek-direction');
    seekIndicatorStepEl = seekIndicatorEl.querySelector('#seek-step');
    return seekIndicatorEl;
}

/**
 * @param {number} time  абсолютное время, к которому едем
 * @param {number} direction  +1 вперёд, -1 назад
 * @param {number} [step]  шаг ускорения в секундах (только удержание кнопки)
 */
function showSeekOverlay(time, direction, step) {
    var el = getSeekIndicator();
    if (!el) return;

    if (seekIndicatorTimeEl) seekIndicatorTimeEl.textContent = formatTime(time);
    if (seekIndicatorDirEl) seekIndicatorDirEl.textContent = direction > 0 ? '\u25b6\u25b6' : '\u25c0\u25c0';
    if (seekIndicatorStepEl) seekIndicatorStepEl.textContent = step ? (step + ' сек') : '';

    el.classList.remove('hidden');
    el.classList.add('visible');
    if (seekOverlayTimeout) { clearTimeout(seekOverlayTimeout); seekOverlayTimeout = null; }
}

function hideSeekOverlay() {
    if (seekIndicatorEl) seekIndicatorEl.classList.remove('visible');
    if (seekOverlayTimeout) { clearTimeout(seekOverlayTimeout); seekOverlayTimeout = null; }
}

// Скрываем индикатор с задержкой после окончания перемотки
function scheduleHideSeekOverlay() {
    if (seekOverlayTimeout) clearTimeout(seekOverlayTimeout);
    seekOverlayTimeout = setTimeout(function () {
        hideSeekOverlay();
    }, 800); // через 800мс после последнего обновления
}

// В window их кладёт initControl() в конце файла — оттуда их берут app.js
// (перетаскивание ползунка мышью) и player.js (выход из плеера)

// ==================== УТИЛИТЫ ====================
/**
 * Быстрая навигация — это УДЕРЖАНИЕ кнопки (автоповтор), а не серия коротких
 * нажатий. Раньше флаг взводился на любом втором шаге в пределах 200мс, поэтому
 * при быстром «тык-тык» часть шагов уезжала с короткой длительностью, а часть с
 * обычной — со стороны это выглядело как рвущаяся анимация.
 *
 * Основной признак — e.repeat от браузера. Он есть не везде (старые WebView на
 * ТВ, часть пультов присылает независимые keydown), поэтому есть и запасной:
 * устойчивая серия в одну сторону с шагом не больше FAST_NAV_GAP_MS. Порог
 * специально злой — 8+ шагов в секунду подряд руками не натыкать, это уже
 * только автоповтор.
 */
var FAST_NAV_GAP_MS = 120;
var FAST_NAV_MIN_STREAK = 5;
var FAST_NAV_IDLE_MS = 260;

function setFastNavigation(direction) {
    var now = Date.now();
    var gap = now - navStreakAt;
    navStreakAt = now;
    if (gap <= FAST_NAV_GAP_MS && direction === navStreakDir) navStreak++;
    else navStreak = 1;
    navStreakDir = direction;

    fastNavigation = navKeyRepeat || navStreak >= FAST_NAV_MIN_STREAK;
    if (fastNavigationTimer) clearTimeout(fastNavigationTimer);
    fastNavigationTimer = setTimeout(function () {
        fastNavigation = false;
        navStreak = 0;
        navStreakDir = null;
        navKeyRepeat = false;
    }, FAST_NAV_IDLE_MS);
}

function VISIBLE(el) { return !!(el && el.offsetParent !== null && !el.disabled); }

function blurEditor() {
    var a = document.activeElement;
    if (a && a !== document.body && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA')) {
        try { a.blur(); } catch (e) { }
    }
}

/**
 * Элементы, которым мы сами поставили класс focused.
 *
 * Раньше clearFocused() искал их через document.querySelectorAll('.focused') —
 * то есть обходил ВЕСЬ документ на каждое перемещение фокуса. В сетке каталога
 * это прогулка по тысяче с лишним узлов на каждое нажатие стрелки, притом что
 * подсвеченный элемент почти всегда ровно один и мы сами его только что
 * подсветили.
 *
 * Инвариант: всё, что ставит класс focused, обязано зарегистрироваться здесь.
 * Точек всего две — focusEl() ниже и sync.js (поле ввода кода), обе зовут
 * trackFocusedElement(). Если появится третья, а регистрации не будет, на
 * экране останется лишняя подсветка.
 */
var _focusedEls = [];

function trackFocusedElement(el) {
    if (el && _focusedEls.indexOf(el) === -1) _focusedEls.push(el);
}
window.trackFocusedElement = trackFocusedElement;

/**
 * Где стоял фокус на каждом экране: { screen -> element }.
 *
 * Нужно для возврата из настроек: они гасят #torrserver-section целиком, а
 * содержимое экрана под ними остаётся в DOM нетронутым — вернуть надо не просто
 * экран, а место на нём.
 *
 * Кнопки общей шапки (#home-topbar .home-nav-btn) не запоминаем: она одна на все
 * экраны раздела, и уходят в настройки как раз через неё — запись затёрла бы
 * реальное место в контенте ровно в момент ухода.
 */
var _lastFocusedByScreen = {};

function rememberScreenFocus(el) {
    if (!el || !el.classList || el.classList.contains('home-nav-btn')) return;
    var screen = window.AppState && AppState.currentScreen;
    if (!screen || screen === 'config') return;
    _lastFocusedByScreen[screen] = el;
}

/**
 * Вернуть фокус туда, где он стоял на экране screen. Если запомненного элемента
 * нет или он больше не на экране (список перерисовали, каталог сменили) —
 * отдаём решение стратегии экрана.
 */
function restoreScreenFocus(screen) {
    // Состав фокусируемого только что изменился: #torrserver-section вернули из
    // display:none, и всё, что в нём лежит, снова имеет offsetParent
    invalidateFocusCache();

    var el = _lastFocusedByScreen[screen];
    if (el) {
        if (el.isConnected !== false && VISIBLE(el)) {
            updateFocusableElements();
            var idx = focusableElements.indexOf(el);
            if (idx !== -1) setFocus(idx);
            else focusEl(el);
            return true;
        }
        // Элемент больше не на экране (сетку перерисовали, каталог сменили) —
        // не держим ссылку на оторванный узел до следующего фокуса
        delete _lastFocusedByScreen[screen];
    }

    var strategy = ScreenStrategies[screen];
    return !!(strategy && strategy.ensureFocus && strategy.ensureFocus(true));
}

function clearFocused() {
    if (!_focusedEls.length) return;
    var list = _focusedEls;
    _focusedEls = [];
    for (var i = 0; i < list.length; i++) {
        if (typeof gsap !== 'undefined') gsap.killTweensOf(list[i]);
        list[i].style.boxShadow = '';
        list[i].style.transform = '';
        list[i].classList.remove('focused');
    }
}

function clickEl(el) {
    try { if (el && el.click) el.click(); } catch (e) { }
}

function isPlayerControlsVisible() {
    var c = getEl('controls-container');
    return !!c && !c.classList.contains('idle-hidden');
}

// Число колонок сетки. Раньше было жёстко зашито 5, из-за чего навигация
// вверх/вниз ломалась, когда UI Customizer менял grid-template-columns.
// Теперь читаем реальное значение, с кэшем (сброс — invalidateColumnsCache()).
var _cachedColumns = 0;

function _readGridColumns(gridId) {
    var grid = getEl(gridId);
    if (!grid) return 0;
    try {
        var tpl = window.getComputedStyle(grid).gridTemplateColumns || '';
        if (!tpl || tpl === 'none') return 0;
        // Скрытый грид (display:none) не резолвится — остаётся 'repeat(5, 1fr)'
        var m = /repeat\(\s*(\d+)/.exec(tpl);
        if (m) return parseInt(m[1], 10) || 0;
        // Видимый грид: '250px 250px 250px 250px 250px'
        var parts = tpl.split(' ').filter(function (b) { return b; });
        return parts.length;
    } catch (e) { }
    return 0;
}

function invalidateColumnsCache() { _cachedColumns = 0; }
window.invalidateColumnsCache = invalidateColumnsCache;
window.addEventListener('resize', invalidateColumnsCache);

function getColumns() {
    if (_cachedColumns > 0) return _cachedColumns;

    // 1. Явная настройка из UI Customizer — самый надёжный источник
    try {
        if (window.UICustomizer && typeof window.UICustomizer.getColumns === 'function') {
            var n = window.UICustomizer.getColumns();
            if (n > 0) { _cachedColumns = n; return n; }
        }
    } catch (e) { }

    // 2. Реально применённый CSS того грида, который сейчас на экране
    var cols = _readGridColumns('catalog-grid') || _readGridColumns('torrents-grid');
    _cachedColumns = cols > 0 ? cols : 5;
    return _cachedColumns;
}

function getTorrentGridColumns() {
    return _readGridColumns('torrents-grid') || getColumns();
}

// Функция для инвалидации кэша фокуса
function invalidateFocusCache() {
    _focusCache.timestamp = 0;
    _focusCache.elements = [];
    _focusGen++;
    _rowsCache.gen = -1;
    _rowsCache.rows = null;
    _gridCardsCache.gen = -1;
    _gridCardsCache.cards = null;
}
window.invalidateFocusCache = invalidateFocusCache;

// ==================== ХЕЛПЕРЫ ДЛЯ СТРАТЕГИЙ ====================
function _isScreenVisible(el) {
    if (!el) return false;

    if (el.hidden) return false;

    if (el.classList && el.classList.contains('hidden')) return false;

    if (el.style.display === 'none') return false;

    // Экран, который прямо сейчас плавно закрывается (animations.js: animateDetailHide),
    // для навигации уже не существует: display:none ему поставят в конце затухания,
    // но реагировать на кнопки пульта он больше не должен.
    if (el.dataset && el.dataset.hiding === '1') return false;

    // Если inline display задан — верим ему
    if (el.style.display !== '') return true;

    // Если inline не задан, один раз проверяем computed style
    try {
        return getComputedStyle(el).display !== 'none';
    } catch (e) {
        return true;
    }
}

function currentScreen() {
    try {
        var ss = window.AppState && AppState.currentScreen ? AppState.currentScreen : null;

        if (ss === 'player') return 'player';

        if (_isScreenVisible(getEl('player-screen'))) return 'player';
        if (_isScreenVisible(getEl('sync-overlay'))) return 'sync';
        if (_isScreenVisible(getEl('config-screen'))) return 'config';
        if (_isScreenVisible(getEl('detail-view'))) return 'detail';
        if (_isScreenVisible(getEl('search-overlay'))) return 'search';
        if (_isScreenVisible(getEl('donate-overlay'))) return 'donate';

        // Главная (home.js). Проба идёт после всех оверлеев: _isScreenVisible
        // смотрит только на сам элемент, поэтому #content-home «виден» и когда
        // над ним открыты настройки или поиск. Единственный признак того, что
        // главная активна — снятый с неё атрибут hidden.
        if (_isScreenVisible(getEl('content-home'))) return 'home';

        if (ss === 'catalog' || (window.AppState && AppState.inSearch === 'catalog')) return 'catalog';

        var cg = getEl('catalog-grid') || getEl('catalog-rows');
        if (cg && cg.classList.contains('hidden')) {
            var hc = cg.querySelector('.catalog-card,.catalog-folder-card') !== null;
            if (hc) return 'catalog';
        }

        return ss || 'torrents';
    } catch (e) {
        return 'torrents';
    }
}

function belongsToScreen(el, screen) {
    if (!el) return false;

    if (screen === 'home') {
        return !!(el.closest('#content-home') || el.classList.contains('home-nav-btn'));
    }
    // .home-nav-btn — кнопки общей шапки #home-topbar: она одна на все экраны
    // раздела, поэтому её кнопки принадлежат и торрентам, и каталогу.
    if (screen === 'torrents') {
        return el.closest('.torrent-card') || el.classList.contains('file-item') ||
            el.classList.contains('home-nav-btn') ||
            ['search-query', 'search-btn', 'settings-btn', 'tab-torrents', 'tab-search', 'tab-donate', 'back-from-detail', 'tab-catalog'].indexOf(el.id) !== -1;
    }
    if (screen === 'catalog') {
        return el.closest('.torrent-card.catalog-card') || el.closest('.torrent-card.catalog-folder-card') ||
            el.closest('#catalog-grid') || el.closest('#catalog-rows') ||
            el.id === 'back-from-catalog' || el.classList.contains('file-item') || el.classList.contains('back-btn') ||
            el.classList.contains('home-nav-btn') ||
            ['search-query', 'search-btn', 'settings-btn', 'tab-torrents', 'tab-search', 'tab-catalog', 'tab-donate'].indexOf(el.id) !== -1;
    }
    if (screen === 'search') {
        // ★ Проверяем панель фильтров
        var filterPanel = getEl('search-filters-panel');
        if (filterPanel && filterPanel.classList.contains('active')) {
            if (filterPanel.contains(el)) return true;
        }

        return el.closest('.search-result-item') || el.closest('.global-search-card') ||
            ['search-query', 'filter-toggle', 'search-btn', 'close-search',
                'filter-back-btn', 'filter-close-btn', 'reset-filters'].indexOf(el.id) !== -1 ||
            el.classList.contains('filter-item') || el.classList.contains('filter-value-item');
    }
    if (screen === 'detail') {
        return !!(el.closest('#detail-view') || el.closest('.file-item') || el.closest('back-from-detail') ||
            el.classList.contains('detail-progress-btn') || el.classList.contains('back-btn'));
    }
    if (screen === 'config') {
        return !!(el.closest('#config-screen') ||
            ['torrserver-url', 'auth-checkbox', 'auth-login', 'auth-password', 'sync-clients-btn', 'speedtest-btn', 'auto-fullscreen', 'hide-clock', 'add-to-db', 'multi-channel-audio', 'torrserver-tab', 'torrents-tab', 'player-tab', 'appearance-tab', 'sync-tab', 'jacred-url'].indexOf(el.id) !== -1 ||
            el.classList.contains('settings-btn') || el.classList.contains('menu-item'));
    }
    return false;
}

function getTorrentCards() {
    var c = document.querySelectorAll('#torrents-grid .torrent-card'), v = [];
    for (var i = 0; i < c.length; i++) if (VISIBLE(c[i])) v.push(c[i]);
    return v;
}

// Селектор карточек каталога — один на все точки, где раньше он был выписан
// заново (getItems, ensureFocus, handleNavigation, догрузка по «вниз»).
var CATALOG_CARDS_SELECTOR =
    '#catalog-grid .torrent-card.catalog-card, #catalog-grid .torrent-card.catalog-folder-card, ' +
    '#catalog-rows .torrent-card.catalog-card, #catalog-rows .torrent-card.catalog-folder-card';

/**
 * Видимые карточки каталога, с кэшем по поколению DOM — та же схема, что у
 * getCatalogRows(). Обход стоит querySelectorAll по документу плюс offsetParent
 * на каждой карточке; в сетке категории их до CATALOG_FULL_LIMIT (1000), а
 * звалось это на КАЖДОЕ нажатие стрелки, и не по одному разу.
 *
 * isConnected на первом элементе — страховка от пропущенной инвалидации, как
 * в getCatalogRows: если сетку переписали мимо invalidateFocusCache(), кэш
 * отбрасываем. Пустой результат не кэшируется по той же причине, что и там:
 * карточки могли ещё не появиться, и залипший пустой список означал бы экран
 * без фокуса до следующей инвалидации.
 */
function getCatalogGridCards() {
    if (_gridCardsCache.gen === _focusGen && _gridCardsCache.cards &&
        _gridCardsCache.cards.length > 0 &&
        _gridCardsCache.cards[0].isConnected !== false) {
        return _gridCardsCache.cards;
    }

    var ac = document.querySelectorAll(CATALOG_CARDS_SELECTOR);
    var c = [];
    for (var i = 0; i < ac.length; i++) if (VISIBLE(ac[i])) c.push(ac[i]);

    _gridCardsCache.gen = _focusGen;
    _gridCardsCache.cards = c;

    return c;
}

// Отдельной шапки с «Настройками» больше нет: кнопка стоит в одной строке с
// остальной навигацией и приходит из getTorrentTabs(). Функция оставлена
// пустой — все ветки «вверх из табов» тогда просто держат фокус на месте.
function getTorrentHeader() {
    return [];
}

// Кнопки общей шапки #home-topbar в порядке DOM — он же порядок на экране,
// поэтому ←/→ идут ровно по строке. Раньше тут был жёсткий список id вкладок.
function getTorrentTabs() {
    var b = document.querySelectorAll('#home-topbar .home-nav-btn'), v = [];
    for (var i = 0; i < b.length; i++) if (VISIBLE(b[i])) v.push(b[i]);
    return v;
}

function getSearchTop() {
    var ids = ['search-query', 'filter-toggle', 'search-btn', 'close-search'], v = [];
    for (var i = 0; i < ids.length; i++) { var e = getEl(ids[i]); if (VISIBLE(e)) v.push(e); }
    return v;
}

function getSearchFilters() {
    // Новая структура: элементы внутри панели фильтров
    var panel = getEl('search-filters-panel');
    if (!panel || !panel.classList.contains('active')) {
        // Панель закрыта - возвращаем только кнопку toggle
        var toggle = getEl('filter-toggle');
        return toggle && VISIBLE(toggle) ? [toggle] : [];
    }

    // Панель открыта - собираем элементы
    var elements = [];
    var filterItems = panel.querySelectorAll('.filter-item');
    var filterValueItems = panel.querySelectorAll('.filter-value-item');
    var backBtn = getEl('filter-back-btn');
    var closeBtn = getEl('filter-close-btn');
    var resetBtn = getEl('reset-filters');

    // Кнопки навигации
    if (backBtn && VISIBLE(backBtn)) elements.push(backBtn);
    if (closeBtn && VISIBLE(closeBtn)) elements.push(closeBtn);

    // Элементы фильтров (главный экран)
    for (var i = 0; i < filterItems.length; i++) {
        if (VISIBLE(filterItems[i])) elements.push(filterItems[i]);
    }

    // Элементы значений (экран значений)
    for (var j = 0; j < filterValueItems.length; j++) {
        if (VISIBLE(filterValueItems[j])) elements.push(filterValueItems[j]);
    }

    // Кнопка сброса
    if (resetBtn && VISIBLE(resetBtn)) elements.push(resetBtn);

    return elements;
}

function getSearchResults() {
    var cm = typeof window.getCurrentSearchMode === 'function' ? window.getCurrentSearchMode() : 'torrentsearch';
    if (cm === 'torrentsearch') {
        var i = document.querySelectorAll('.search-result-item'), v = [];
        for (var j = 0; j < i.length; j++) if (VISIBLE(i[j])) v.push(i[j]);
        return v;
    } else if (cm === 'globalsearch') {
        var i = document.querySelectorAll('.global-search-card'), v = [];
        for (var j = 0; j < i.length; j++) if (VISIBLE(i[j])) v.push(i[j]);
        return v;
    }
    return [];
}

/**
 * Видимые кнопки строки действий карточки, в порядке разметки.
 *
 * Состав зависит от режима: в карточке каталога это «Торренты», «Подробнее»,
 * «Трейлер»; в карточке торрента — «Играть», «Подробнее», «Открыть карточку».
 * Порядок берём из DOM, а не списком имён: добавили кнопку в index.html —
 * навигация подхватила её сама.
 */
function getDetailActionButtons() {
    var row = getEl('catalog-detail-actions');
    if (!row) return [];
    var all = row.querySelectorAll('button, .catalog-watch-btn, .detail-progress-btn');
    var out = [];
    for (var i = 0; i < all.length; i++) {
        if (VISIBLE(all[i]) && out.indexOf(all[i]) === -1) out.push(all[i]);
    }
    return out;
}

function getDetailItems() {
    // '#detail-open-card-btn' — кнопка «Открыть карточку» в карточке торрента.
    // Без неё handleNavigation не находил элемент в этом списке (idx === -1) и
    // уходил в ensureFocus, отбрасывая фокус на первую кнопку строки: «влево»
    // с неё прыгало через «Подробнее» сразу на «Играть».
    var s = ['.detail-progress-btn', '.file-item', '#catalog-watch-btn', '#catalog-toggle-overview-btn', '#detail-open-card-btn', '#catalog-favorite-btn', '#catalog-trailer-btn', '.catalog-trailer-link', '.catalog-trailer-play', '.catalog-trailer-card-item', '#catalog-trailer-close', '.catalog-actor-card', '.catalog-recommendation-card'];
    // Сборный селектор → порядок обхода совпадает с порядком в DOM, а не с
    // порядком селекторов. Важно для торрентного detail: там ряд актёров идёт
    // ПЕРЕД файлами, и «вверх» от плитки должно попадать в него.
    // Побочный плюс: элемент, подходящий сразу двум селекторам, не дублируется.
    var it = document.querySelectorAll(s.join(','));
    var a = [];
    for (var i = 0; i < it.length; i++) if (VISIBLE(it[i])) a.push(it[i]);
    return a;
}

function getConfigMenuItems() {
    var ids = ['torrserver-tab', 'torrents-tab', 'player-tab', 'appearance-tab', 'sync-tab'];
    var visibleItems = [];
    for (var i = 0; i < ids.length; i++) {
        var element = getEl(ids[i]);
        if (VISIBLE(element)) visibleItems.push(element);
    }
    return visibleItems;
}

function getConfigItems() {
    var ids = ['torrserver-url', 'auth-checkbox', 'auth-login', 'auth-password', 'jacred-url', '.settings-btn', 'sync-clients-btn', 'speedtest-btn', 'auto-fullscreen', 'hide-clock', 'add-to-db', 'multi-channel-audio'];
    var visibleItems = [];
    for (var i = 0; i < ids.length; i++) {
        var element = getEl(ids[i]);
        if (VISIBLE(element)) visibleItems.push(element);
    }
    var settingsButtons = document.querySelectorAll('.settings-btn');
    for (var j = 0; j < settingsButtons.length; j++) {
        if (VISIBLE(settingsButtons[j])) visibleItems.push(settingsButtons[j]);
    }
    return visibleItems;
}

function getConfigContentItems(tabId) {
    var tabContentId = tabId + '-content';
    var tabContent = getEl(tabContentId);
    if (!tabContent) return [];
    var visibleItems = [];
    var interactiveSelectors = ['input:not([type="hidden"])', 'button', 'select', 'textarea'];
    for (var i = 0; i < interactiveSelectors.length; i++) {
        var elements = tabContent.querySelectorAll(interactiveSelectors[i]);
        for (var j = 0; j < elements.length; j++) {
            if (VISIBLE(elements[j]) && visibleItems.indexOf(elements[j]) === -1) {
                visibleItems.push(elements[j]);
            }
        }
    }
    return visibleItems;
}

// ==================== СТРАТЕГИИ ЭКРАНОВ ====================
var ScreenStrategies = {
    torrents: {
        getItems: getTorrentCards,
        ensureFocus: function (force) {
            if (force === undefined) force = false;
            if (currentScreen() !== 'torrents') return false;
            if (window.AppState && AppState.restoringFocus) return false;
            var f = document.querySelector('.focused');
            if (!force && belongsToScreen(f, 'torrents')) return true;
            var c = getTorrentCards(), t = getTorrentTabs(), h = getTorrentHeader();
            if (!c.length) {
                // Если список торрентов уже загружался и он пустой,
                // не нужно бесконечно вызывать refreshTorrents()
                if (
                    window.AppState &&
                    AppState.torrentsLoaded &&
                    (!AppState.torrents || AppState.torrents.length === 0)
                ) {
                    return focusEl(t[0] || h[0]);
                }

                // Если список торрентов уже загружается, не запускаем новую загрузку
                if (window.AppState && AppState.torrentsLoading) {
                    return false;
                }
                return window.refreshTorrents().then(function () {
                    c = getTorrentCards();
                    var tc = null;
                    var sh = (window.AppState && window.AppState.currentDetailItem && window.AppState.currentDetailItem.hash)
                        ? window.AppState.currentDetailItem.hash.toLowerCase()
                        : null;

                    if (sh) {
                        for (var i = 0; i < c.length; i++) {
                            if (c[i].dataset.hash && c[i].dataset.hash.toLowerCase() === sh) {
                                tc = c[i];
                                break;
                            }
                        }
                    }

                    if (!tc && typeof window.lastSelectedTorrentHash !== 'undefined' && window.lastSelectedTorrentHash) {
                        for (var i = 0; i < c.length; i++) {
                            if (c[i].dataset.hash && c[i].dataset.hash.toLowerCase() === window.lastSelectedTorrentHash.toLowerCase()) {
                                tc = c[i];
                                break;
                            }
                        }
                    }

                    if (!tc && typeof window.lastSelectedTorrentIndex === 'number' && window.lastSelectedTorrentIndex >= 0) {
                        var si = window.lastSelectedTorrentIndex;
                        if (si < c.length) tc = c[si];
                    }

                    if (!tc) tc = c[0];

                    if (window.AppState && window.AppState.currentDetailItem) window.AppState.currentDetailItem = null;
                    if (window.lastSelectedTorrentHash) window.lastSelectedTorrentHash = null;
                    if (typeof window.lastSelectedTorrentIndex !== 'undefined') window.lastSelectedTorrentIndex = 0;

                    return focusEl(tc || t[0] || h[0]);
                });
            } else {
                var tc = null;
                var sh = (window.AppState && window.AppState.currentDetailItem && window.AppState.currentDetailItem.hash) ? window.AppState.currentDetailItem.hash.toLowerCase() : null;
                if (sh) for (var i = 0; i < c.length; i++) if (c[i].dataset.hash && c[i].dataset.hash.toLowerCase() === sh) { tc = c[i]; break; }
                if (!tc && typeof window.lastSelectedTorrentHash !== 'undefined' && window.lastSelectedTorrentHash)
                    for (var i = 0; i < c.length; i++) if (c[i].dataset.hash && c[i].dataset.hash.toLowerCase() === window.lastSelectedTorrentHash.toLowerCase()) { tc = c[i]; break; }
                if (!tc && typeof window.lastSelectedTorrentIndex === 'number' && window.lastSelectedTorrentIndex >= 0) {
                    var si = window.lastSelectedTorrentIndex; if (si < c.length) tc = c[si];
                }
                if (!tc) tc = c[0];
                if (window.AppState && window.AppState.currentDetailItem) window.AppState.currentDetailItem = null;
                if (window.lastSelectedTorrentHash) window.lastSelectedTorrentHash = null;
                if (typeof window.lastSelectedTorrentIndex !== 'undefined') window.lastSelectedTorrentIndex = 0;
                return focusEl(tc);
            }
            return focusEl(t[0] || h[0]);
        },
        handleNavigation: function (dir) {
            var f = (belongsToScreen(document.querySelector('.focused'), 'torrents') ? document.querySelector('.focused') : null);
            var c = getTorrentCards(), h = getTorrentHeader(), t = getTorrentTabs(), cols = getColumns();
            if (!f) return this.ensureFocus(true);
            var ci = -1, hi = -1, ti = -1;
            for (var i = 0; i < c.length; i++) if (f === c[i]) { ci = i; break; }
            for (var i = 0; i < h.length; i++) if (f === h[i]) { hi = i; break; }
            for (var i = 0; i < t.length; i++) if (f === t[i]) { ti = i; break; }
            if (ci !== -1) {
                var row = Math.floor(ci / cols);
                if (dir === 'left') return focusEl(c[Math.max(0, ci - 1)] || f);
                if (dir === 'right') return focusEl(c[Math.min(c.length - 1, ci + 1)] || f);
                if (dir === 'up') { if (row === 0) return focusEl(t[0] || h[0] || f); return focusEl(c[Math.max(0, ci - cols)] || f); }
                if (dir === 'down') return focusEl(c[Math.min(c.length - 1, ci + cols)] || f);
                return true;
            }
            if (ti !== -1) {
                if (dir === 'left') return focusEl(t[Math.max(0, ti - 1)] || f);
                if (dir === 'right') return focusEl(t[Math.min(t.length - 1, ti + 1)] || f);
                if (dir === 'down') return focusEl(c[0] || f);
                if (dir === 'up') return focusEl(h[Math.min(ti, h.length - 1)] || h[0] || f);
                return true;
            }
            if (hi !== -1) {
                if (dir === 'left') return focusEl(h[Math.max(0, hi - 1)] || f);
                if (dir === 'right') return focusEl(h[Math.min(h.length - 1, hi + 1)] || f);
                if (dir === 'down') return focusEl((f.id === 'settings-btn' ? t[0] : t[1]) || t[0] || c[0] || f);
                return true;
            }
            return false;
        },
        onOk: function (f) {
            if (!belongsToScreen(f, 'torrents')) return this.ensureFocus(true);
            if (f.id === 'search-query' || f.id === 'search-btn' || f.id === 'tab-search') return openSearchScreen(true);
            if (f.id === 'tab-catalog') { clickEl(f); return true; }
            clickEl(f);
            return true;
        }
    },

    catalog: {
        getItems: function () {
            return getCatalogGridCards();
        },
        ensureFocus: function (force) {
            if (force === undefined) force = false;
            if (currentScreen() !== 'catalog') return false;

            // ★ Новый вид: ряды-карусели
            if (isCatalogRowsMode()) {
                var fr = document.querySelector('.focused');
                if (!force && fr && belongsToScreen(fr, 'catalog')) return true;
                var rows = getCatalogRows();
                if (!rows.length) return false;
                return focusRowCard(0, 0, rows);
            }

            // Старый вид: сетка (без изменений)
            var f = document.querySelector('.focused');
            if (!force && f && belongsToScreen(f, 'catalog')) return true;
            var c = getCatalogGridCards();
            if (!c.length) return false;
            var si = localStorage.getItem('lastCatalogCardIndex'), tc = null;
            if (si !== null) {
                var sn = parseInt(si, 10);
                if (Number.isFinite(sn)) {
                    for (var j = 0; j < c.length; j++) {
                        var cn = parseInt(c[j].dataset.numIndex || '-1', 10);
                        if (Number.isFinite(cn) && cn === sn) { tc = c[j]; break; }
                    }
                    if (!tc && sn >= 0 && sn < c.length) tc = c[sn];
                }
            }
            if (!tc) tc = c[0];
            return focusEl(tc);
        },
        handleNavigation: function (dir) {
            // ★ Новый вид: ряды-карусели
            if (isCatalogRowsMode()) {
                return handleRowsNavigation(dir);
            }

            // Старый вид: сетка. Списки берём из кэша по поколению DOM
            // (getCatalogGridCards), а .focused ищем один раз, а не дважды
            // подряд, как было: оба запроса шли по всему документу на каждое
            // нажатие стрелки.
            var focused = document.querySelector('.focused');
            var f = belongsToScreen(focused, 'catalog') ? focused : null;
            var c = getCatalogGridCards();
            var h = getTorrentHeader(), t = getTorrentTabs(), cols = getColumns();
            if (!f) return this.ensureFocus(true);
            var ci = -1, hi = -1, ti = -1;
            for (var i = 0; i < c.length; i++) if (f === c[i]) { ci = i; break; }
            for (var i = 0; i < h.length; i++) if (f === h[i]) { hi = i; break; }
            for (var i = 0; i < t.length; i++) if (f === t[i]) { ti = i; break; }
            if (ci !== -1) {
                var row = Math.floor(ci / cols);
                // Влево/вправо идут по списку СКВОЗЬ границы строк: с последней
                // карточки ряда «вправо» переводит на первую карточку следующего,
                // с первой «влево» — на последнюю предыдущего. Раньше проверка
                // ci % cols держала фокус внутри строки, и на краю нажатие
                // просто пропадало.
                if (dir === 'left') { if (ci > 0) return focusEl(c[ci - 1] || f); return true; }
                if (dir === 'right') {
                    if (ci < c.length - 1) return focusEl(c[ci + 1] || f);
                    // Уперлись в конец загруженного — догружаем, как по «вниз»
                    if (c.length < catalogState.totalItems && !catalogState.isLoadingMore) {
                        window.loadMoreCatalogItems().then(function () {
                            setTimeout(function () {
                                var nc = getCatalogGridCards();
                                if (nc.length > ci + 1) focusEl(nc[ci + 1]);
                            }, 50);
                        });
                    }
                    return true;
                }
                if (dir === 'up') { if (row === 0) return focusEl(t[0] || h[0] || f); return focusEl(c[Math.max(0, ci - cols)] || f); }
                if (dir === 'down') {
                    if (ci + cols < c.length) return focusEl(c[Math.min(c.length - 1, ci + cols)] || f);
                    else if (c.length < catalogState.totalItems && !catalogState.isLoadingMore) {
                        window.loadMoreCatalogItems().then(function () {
                            setTimeout(function () {
                                // appendCatalogItems уже позвал invalidateFocusCache(),
                                // поэтому кэш здесь гарантированно пересобран
                                var nc = getCatalogGridCards();
                                var tix = Math.min(ci + cols, nc.length - 1);
                                if (tix >= 0 && tix < nc.length && nc[tix]) focusEl(nc[tix]);
                            }, 50);
                        });
                        return true;
                    }
                    return true;
                }
                return true;
            }
            if (ti !== -1) {
                if (dir === 'left') return focusEl(t[Math.max(0, ti - 1)] || f);
                if (dir === 'right') return focusEl(t[Math.min(t.length - 1, ti + 1)] || f);
                if (dir === 'down') return focusEl(c[0] || f);
                if (dir === 'up') return focusEl(h[Math.min(ti, h.length - 1)] || h[0] || f);
                return true;
            }
            if (hi !== -1) {
                if (dir === 'left') return focusEl(h[Math.max(0, hi - 1)] || f);
                if (dir === 'right') return focusEl(h[Math.min(h.length - 1, hi + 1)] || f);
                if (dir === 'down') return focusEl((f.id === 'settings-btn' ? t[0] : t[1]) || t[0] || c[0] || f);
                return true;
            }
            return false;
        },
        onOk: function (f) {
            if (!belongsToScreen(f, 'catalog')) return this.ensureFocus(true);
            clickEl(f);
            return true;
        }
    },

    search: {
        getItems: function () {
            var t = getSearchTop(), fl = getSearchFilters(), r = getSearchResults();
            return t.concat(fl).concat(r);
        },
        ensureFocus: function (force, preferInput) {
            if (force === undefined) force = false;
            if (preferInput === undefined) preferInput = true;
            if (currentScreen() !== 'search') return false;
            var f = document.querySelector('.focused');
            if (!force && belongsToScreen(f, 'search')) return true;
            var t = getSearchTop(), fl = getSearchFilters(), r = getSearchResults(), q = getEl('search-query');
            var panel = getEl('search-filters-panel');
            if (panel && panel.classList.contains('active')) {
                var firstItem = panel.querySelector('.filter-item, .filter-value-item');
                if (firstItem) return focusEl(firstItem);
            }
            return focusEl((preferInput && q) ? q : (t[0] || fl[0] || r[0] || q));
        },
        handleNavigation: function (dir) {
            var cm = typeof window.getCurrentSearchMode === 'function' ? window.getCurrentSearchMode() : 'torrentsearch';
            var f = belongsToScreen(document.querySelector('.focused'), 'search') ? document.querySelector('.focused') : null;
            var q = getEl('search-query'), t = getSearchTop(), fl = getSearchFilters(), r = getSearchResults();
            var panel = getEl('search-filters-panel');
            var isInFilterPanel = panel && panel.classList.contains('active');
            if (isInFilterPanel) {
                return handleFilterPanelNavigation(dir, f);
            }
            var tWQ = []; for (var i = 0; i < t.length; i++) if (t[i] && t[i].id !== 'search-query') tWQ.push(t[i]);
            var te = tWQ[0] || fl[0] || r[0] || q;
            if (!f) return this.ensureFocus(true, false);
            if (document.activeElement === q && ['left', 'right', 'up', 'down'].indexOf(dir) !== -1) {
                blurEditor();
                return focusEl(te);
            }
            var ti = -1, fi = -1, ri = -1;
            for (var i = 0; i < t.length; i++) if (f === t[i]) { ti = i; break; }
            for (var i = 0; i < fl.length; i++) if (f === fl[i]) { fi = i; break; }
            for (var i = 0; i < r.length; i++) if (f === r[i]) { ri = i; break; }
            if (cm === 'torrentsearch') {
                if (ti !== -1) {
                    if (dir === 'left') return focusEl(t[Math.max(0, ti - 1)] || f);
                    if (dir === 'right') return focusEl(t[Math.min(t.length - 1, ti + 1)] || f);
                    if (dir === 'down') return focusEl(r[Math.min(r.length - 1, ri + 1)] || f, { direction: 'down' });
                    if (dir === 'up') return true;
                    return true;
                }
                if (fi !== -1) {
                    if (dir === 'left') return focusEl(fl[Math.max(0, fi - 1)] || f);
                    if (dir === 'right') {
                        if (f && f.id === 'filter-toggle') { openFilterPanelAndFocus(); return true; }
                        return focusEl(fl[Math.min(fl.length - 1, fi + 1)] || f);
                    }
                    if (dir === 'up') { return focusEl(q); }
                    if (dir === 'down') { if (r.length > 0) { return focusEl(r[0], { direction: 'down' }); } return true; }
                    return true;
                }
                if (ri !== -1) {
                    if (dir === 'up') {
                        if (ri === 0) { return focusEl(q); }
                        return focusEl(r[Math.max(0, ri - 1)] || f, { direction: 'up' });
                    }
                    if (dir === 'down') {
                        return focusEl(r[Math.min(r.length - 1, ri + 1)] || f, { direction: 'down' });
                    }
                    if (dir === 'left') { openFilterPanelAndFocus(); return true; }
                    if (dir === 'right') {
                        if (f && (f.classList.contains('search-result-item') || f.classList.contains('global-search-card'))) {
                            var pb = f.querySelector('.search-result-play');
                            var m = pb ? pb.dataset.magnet : null;
                            var h = pb ? pb.dataset.hash : null;
                            // Берём результат напрямую из filteredResults по индексу,
                            // вместо парсинга data-result, которого нет в DOM
                            var idx = pb ? parseInt(pb.dataset.index, 10) : -1;
                            var sr = (!isNaN(idx) && idx >= 0 && idx < filteredResults.length) ? filteredResults[idx] : null;
                            if (m && typeof window.addTorrentSearchToServer === 'function') window.addTorrentSearchToServer(m, h, sr).then(function () {
                                var oh = pb.innerHTML; pb.style.display = 'block'; pb.innerHTML = '✓';
                                setTimeout(function () { pb.style.display = 'none'; pb.innerHTML = oh; }, 2000);
                            }).catch(function (e) { console.error('Ошибка добавления торрента:', e); });
                        }
                        return true;
                    }
                    return true;
                }
                return false;
            }
            else if (cm === 'globalsearch') {
                if (ti !== -1) {
                    if (dir === 'left') return focusEl(t[Math.max(0, ti - 1)] || f);
                    if (dir === 'right') return focusEl(t[Math.min(t.length - 1, ti + 1)] || f);
                    if (dir === 'down') { if (r.length > 0) return focusEl(r[0]); return true; }
                    if (dir === 'up') return true;
                    return true;
                }
                if (fi !== -1) {
                    if (dir === 'left') return focusEl(fl[Math.max(0, fi - 1)] || f);
                    if (dir === 'right') {
                        if (f && f.id === 'filter-toggle') { openFilterPanelAndFocus(); return true; }
                        return focusEl(fl[Math.min(fl.length - 1, fi + 1)] || f);
                    }
                    if (dir === 'up') { return focusEl(q); }
                    if (dir === 'down') { if (r.length > 0) return focusEl(r[0]); return true; }
                    return true;
                }
                if (ri !== -1) {
                    var cols = getColumns(), row = Math.floor(ri / cols);
                    if (dir === 'left') return focusEl(r[Math.max(0, ri - 1)] || f);
                    if (dir === 'right') return focusEl(r[Math.min(r.length - 1, ri + 1)] || f);
                    if (dir === 'up') { if (row === 0) return focusEl(q); return focusEl(r[Math.max(0, ri - cols)] || f); }
                    if (dir === 'down') return focusEl(r[Math.min(r.length - 1, ri + cols)] || f);
                    return true;
                }
                return false;
            }
            return false;
        },
        // ✅ onOk НА ВЕРХНЕМ УРОВНЕ стратегии search
        onOk: function (f) {
            if (!belongsToScreen(f, 'search')) return this.ensureFocus(true, true);
            var panel = getEl('search-filters-panel');
            if (panel && panel.classList.contains('active')) {
                if (f.classList.contains('filter-item')) {
                    var clickedFilterId = f.dataset.filter; // запоминаем какой фильтр открыли
                    f.click();
                    // ★ После click() DOM меняется — ждём и фокусируемся на текущем значении
                    setTimeout(function () {
                        invalidateFocusCache();
                        updateFocusableElements();
                        var valuesScreen = panel.querySelector('.filter-values-screen');
                        if (valuesScreen && valuesScreen.style.display !== 'none') {
                            var valuesList = panel.querySelector('#filter-values-list');
                            var selectedItem = valuesList ? valuesList.querySelector('.filter-value-item.selected') : null;
                            if (selectedItem && VISIBLE(selectedItem)) {
                                focusEl(selectedItem);
                            } else if (valuesList) {
                                var firstItem = valuesList.querySelector('.filter-value-item');
                                if (firstItem) focusEl(firstItem);
                            }
                        }
                    }, 50);
                    return true;
                }
                if (f.classList.contains('filter-value-item')) {
                    f.click();
                    // setTimeout(function () {
                    //     invalidateFocusCache();
                    //     updateFocusableElements();
                    //     var mainScreen = panel.querySelector('.filter-main-screen');
                    //     if (mainScreen && mainScreen.style.display !== 'none') {
                    //         var items = panel.querySelectorAll('.filter-item');
                    //         for (var i = 0; i < items.length; i++) {
                    //             if (VISIBLE(items[i])) { focusEl(items[i]); break; }
                    //         }
                    //     }
                    // }, 50);
                    return true;
                }
                if (f.id === 'filter-back-btn') {
                    f.click();
                    setTimeout(function () {
                        invalidateFocusCache();
                        updateFocusableElements();
                        var firstItem = panel.querySelector('.filter-item');
                        if (firstItem) focusEl(firstItem);
                    }, 50);
                    return true;
                }
                if (f.id === 'filter-close-btn') {
                    closeFilterPanel();
                    return true;
                }
                if (f.id === 'reset-filters') {
                    f.click();
                    setTimeout(function () {
                        invalidateFocusCache();
                        updateFocusableElements();
                        var firstItem = panel.querySelector('.filter-item');
                        if (firstItem) focusEl(firstItem);
                    }, 50);
                    return true;
                }
            }
            if (f.id === 'search-query') { focusEl(f, { nativeFocus: true }); try { f.click(); } catch (e) { } try { f.focus(); } catch (e) { } try { if (f.select) f.select(); } catch (e) { } return true; }
            if (f.id === 'filter-toggle') {
                var p = getEl('search-filters-panel');
                if (p && !p.classList.contains('active')) { openFilterPanelAndFocus(); return true; }
                else { closeFilterPanel(); return true; }
            }
            if (f.tagName === 'SELECT' || f.id === 'filter-year') return openNativeSearchControl(f);
            clickEl(f);
            return true;
        }
    },
    detail: {
        getItems: getDetailItems,
        ensureFocus: function (force) {
            if (force === undefined) force = false;
            if (currentScreen() !== 'detail') return false;
            var f = document.querySelector('.focused');
            if (!force && belongsToScreen(f, 'detail')) return true;

            // ИСПРАВЛЕНО: используем прямой вызов getDetailItems() вместо this.getItems()
            var items = getDetailItems();
            return focusEl(items[0]); // || getEl('back-from-detail'));
        },
        handleNavigation: function (dir) {
            var items = getDetailItems(), f = (belongsToScreen(document.querySelector('.focused'), 'detail') ? document.querySelector('.focused') : null);
            if (!f) return this.ensureFocus(true);
            var idx = -1; for (var i = 0; i < items.length; i++) if (f === items[i]) { idx = i; break; }
            if (idx === -1) return this.ensureFocus(true);
            var tl = [], ac = [], rc = [], fi = [];
            for (var i = 0; i < items.length; i++) {
                var e = items[i];
                if (e.classList.contains('catalog-trailer-play') || e.classList.contains('catalog-trailer-link') || e.classList.contains('catalog-trailer-card-item')) tl.push(e);
                if (e.classList.contains('catalog-actor-card')) ac.push(e);
                if (e.classList.contains('catalog-recommendation-card')) rc.push(e);
                if (e.classList && e.classList.contains('file-item')) fi.push(e);
            }
            var wb = getEl('catalog-watch-btn'), bb = getEl('back-from-detail'); var ovw = getEl('catalog-toggle-overview-btn'); var rut = getEl('catalog-trailer-btn');
            var isT = f.classList.contains('catalog-trailer-play') || f.classList.contains('catalog-trailer-link') || f.classList.contains('catalog-trailer-card-item');
            var isA = f.classList.contains('catalog-actor-card'), isR = f.classList.contains('catalog-recommendation-card');
            var isW = f.id === 'catalog-watch-btn', isOv = f.id === 'catalog-toggle-overview-btn', isB = f.id === 'back-from-detail', isF = f.classList && f.classList.contains('file-item');
            var isRut = f.id === 'catalog-trailer-btn';
            var ti = -1, ai = -1, ri = -1, fii = -1;
            for (var i = 0; i < tl.length; i++) if (f === tl[i]) { ti = i; break; }
            for (var i = 0; i < ac.length; i++) if (f === ac[i]) { ai = i; break; }
            for (var i = 0; i < rc.length; i++) if (f === rc[i]) { ri = i; break; }
            for (var i = 0; i < fi.length; i++) if (f === fi[i]) { fii = i; break; }

            if (isF && fii !== -1) {
                if (dir === 'left') { if (fii > 0) { focusEl(fi[fii - 1], { direction: 'left' }); } return true; }
                if (dir === 'right') { if (fii < fi.length - 1) { focusEl(fi[fii + 1], { direction: 'right' }); } return true; }
                if (dir === 'up') { if (ac.length > 0) { focusEl(ac[Math.min(fii, ac.length - 1)], { direction: 'up' }); return true; } var prevItems = []; for (var k = idx - 1; k >= 0; k--) { if (!items[k].classList || !items[k].classList.contains('file-item')) { prevItems.push(items[k]); } } if (prevItems.length > 0) focusEl(prevItems[0], { direction: 'up' }); return true; }
                if (dir === 'down') return true;
                return true;
            }
            if (isT && ti !== -1) {
                if (dir === 'left') return focusEl(tl[Math.max(0, ti - 1)] || f, { direction: 'left' });
                if (dir === 'right') return focusEl(tl[Math.min(tl.length - 1, ti + 1)] || f, { direction: 'right' });
                if (dir === 'up') { if (wb && wb.offsetParent !== null) { focusEl(wb, { direction: 'up' }); return true; } return focusEl(items[Math.max(0, idx - 1)] || f, { direction: 'up' }); }
                if (dir === 'down') { if (ac.length > 0) { focusEl(ac[0], { direction: 'down' }); return true; } else if (rc.length > 0) { focusEl(rc[0], { direction: 'down' }); return true; } else if (fi.length > 0) { focusEl(fi[0], { direction: 'down' }); return true; } return true; }
                return true;
            }
            if (isA && ai !== -1) {
                if (dir === 'left') return focusEl(ac[Math.max(0, ai - 1)] || f, { direction: 'left' });
                if (dir === 'right') return focusEl(ac[Math.min(ac.length - 1, ai + 1)] || f, { direction: 'right' });
                if (dir === 'up') { if (tl.length > 0) { focusEl(tl[tl.length - 1], { direction: 'up' }); return true; } else if (wb && wb.offsetParent !== null) { focusEl(wb, { direction: 'up' }); return true; } var pgb = getEl('detail-progress-btn'); if (pgb && pgb.offsetParent !== null) { focusEl(pgb, { direction: 'up' }); return true; } return focusEl(items[Math.max(0, idx - 1)] || f, { direction: 'up' }); }
                if (dir === 'down') { if (rc.length > 0) { var t = ai < rc.length ? ai : rc.length - 1; focusEl(rc[t], { direction: 'down' }); return true; } else if (fi.length > 0) { focusEl(fi[0], { direction: 'down' }); return true; } return true; }
                return true;
            }
            if (isR && ri !== -1) {
                if (dir === 'left') return focusEl(rc[Math.max(0, ri - 1)] || f, { direction: 'left' });
                if (dir === 'right') return focusEl(rc[Math.min(rc.length - 1, ri + 1)] || f, { direction: 'right' });
                if (dir === 'up') { if (ac.length > 0) { var t = ri < ac.length ? ri : ac.length - 1; focusEl(ac[t], { direction: 'up' }); return true; } else if (tl.length > 0) { var t = ri < tl.length ? ri : tl.length - 1; focusEl(tl[t], { direction: 'up' }); return true; } else if (wb && wb.offsetParent !== null) { focusEl(wb, { direction: 'up' }); return true; } return focusEl(items[Math.max(0, idx - 1)] || f, { direction: 'up' }); }
                if (dir === 'down') { if (fi.length > 0) { focusEl(fi[0], { direction: 'down' }); return true; } return true; }
                return true;
            }
            // --- Строка действий карточки: «Торренты» / «Играть» / «Подробнее» /
            // «Открыть карточку» / «Трейлер» ---
            //
            // Раньше на каждую кнопку была своя ветка, а соседи в ней прописаны
            // поимённо: isW → вправо всегда ovw, isOv → вправо всегда rut. Из-за
            // этого «Играть» (detail-progress-btn) не обрабатывался вовсе и
            // проваливался в общий хвост, где «вниз» уходило к следующему
            // элементу в порядке DOM — то есть внутрь той же строки кнопок,
            // а «вправо» не делало ничего. Новая кнопка «Открыть карточку» в
            // цепочку тоже не попадала.
            //
            // Теперь строка обходится как строка: влево/вправо — по видимым
            // соседям в порядке разметки, вниз — вон из строки, к ближайшей
            // секции ниже. Ветки для каждой кнопки больше не нужны, состав
            // строки в разных режимах (торрент / каталог) разбирается сам.
            var actionRow = getDetailActionButtons();
            var actIdx = actionRow.indexOf(f);
            if (actIdx !== -1) {
                if (dir === 'left') {
                    if (actIdx > 0) return focusEl(actionRow[actIdx - 1], { direction: 'left' });
                    return true;
                }
                if (dir === 'right') {
                    if (actIdx < actionRow.length - 1) return focusEl(actionRow[actIdx + 1], { direction: 'right' });
                    return true;
                }
                if (dir === 'down') {
                    if (tl.length > 0) { focusEl(tl[0], { direction: 'down' }); return true; }
                    if (ac.length > 0) { focusEl(ac[0], { direction: 'down' }); return true; }
                    if (rc.length > 0) { focusEl(rc[0], { direction: 'down' }); return true; }
                    if (fi.length > 0) { focusEl(fi[0], { direction: 'down' }); return true; }
                    return true;
                }
                if (dir === 'up') return true;
                return true;
            }
            if (isB) {
                if (dir === 'down') { if (wb && wb.offsetParent !== null) { focusEl(wb, { direction: 'down' }); return true; } return focusEl(items[Math.min(items.length - 1, idx + 1)] || f, { direction: 'down' }); }
                if (dir === 'up') return true;
                if (dir === 'left' || dir === 'right') return true;
                return true;
            }
            if (dir === 'up') { var t = items[Math.max(0, idx - 1)] || f; focusEl(t, { direction: 'up' }); return true; }
            if (dir === 'down') { var t = items[Math.min(items.length - 1, idx + 1)] || f; focusEl(t, { direction: 'down' }); return true; }
            return true;
        },
        onOk: function (f) {
            if (!belongsToScreen(f, 'detail')) return this.ensureFocus(true);
            if (f.classList.contains('file-item')) { clickEl(f.querySelector('.play-btn') || f); return true; }
            if (f.classList.contains('detail-progress-btn')) { clickEl(f); return true; }
            clickEl(f);
            return true;
        }
    },

    config: {
        getItems: getConfigItems,
        ensureFocus: function (force) {
            if (force === undefined) force = false;
            if (currentScreen() !== 'config') return false;
            if (!configState.initialized) {
                configState.initialized = true;
                configState.activeTabId = 'torrserver-tab';
                configState.isOnMenu = true;
                switchConfigTab('torrserver-tab');
                setConfigMenuActive('torrserver-tab');
            }
            var focusedElement = document.querySelector('.focused');
            if (!force && belongsToScreen(focusedElement, 'config')) return true;
            var menuItems = getConfigMenuItems();
            if (configState.isOnMenu) {
                var targetMenuItem = getEl(configState.activeTabId);
                if (targetMenuItem && VISIBLE(targetMenuItem)) return focusEl(targetMenuItem);
                return focusEl(menuItems[0]);
            } else {
                var contentItems = getConfigContentItems(configState.activeTabId);
                if (contentItems.length > 0) return focusEl(contentItems[0]);
                configState.isOnMenu = true;
                return focusEl(getEl(configState.activeTabId));
            }
        },
        handleNavigation: function (dir) {
            return handleConfigNavigation(dir);
        },
        onOk: function (f) {
            if (!belongsToScreen(f, 'config')) return this.ensureFocus(true);
            return handleConfigNavigation('enter');
        }
    }
};

// ==================== НАВИГАЦИЯ В ПАНЕЛИ ФИЛЬТРОВ ====================
function handleFilterPanelNavigation(dir, currentElement) {
    var panel = getEl('search-filters-panel');
    if (!panel) return false;

    // ★ Обязательно инвалидируем кэш!
    invalidateFocusCache();
    updateFocusableElements();

    var filterItems = Array.from(panel.querySelectorAll('.filter-item'));
    var filterValueItems = Array.from(panel.querySelectorAll('.filter-value-item'));
    var backBtn = getEl('filter-back-btn');
    var closeBtn = getEl('filter-close-btn');
    var resetBtn = getEl('reset-filters');

    // Определяем текущий экран
    var mainScreen = panel.querySelector('.filter-main-screen');
    var valuesScreen = panel.querySelector('.filter-values-screen');
    var isMainScreen = mainScreen && mainScreen.style.display !== 'none';
    var isValuesScreen = valuesScreen && valuesScreen.style.display !== 'none';

    if (isMainScreen) {
        // === Навигация на главном экране ===
        var allItems = [];
        if (closeBtn && VISIBLE(closeBtn)) allItems.push(closeBtn);
        for (var i = 0; i < filterItems.length; i++) allItems.push(filterItems[i]);
        if (resetBtn && VISIBLE(resetBtn)) allItems.push(resetBtn);

        var idx = allItems.indexOf(currentElement);

        if (dir === 'up') {
            if (idx > 0) return focusEl(allItems[idx - 1], { direction: 'up' });
            return true;
        }
        if (dir === 'down') {
            if (idx < allItems.length - 1) return focusEl(allItems[idx + 1], { direction: 'down' });
            return true;
        }
        if (dir === 'left') {
            // Закрыть панель
            closeFilterPanel();
            return true;
        }
        if (dir === 'right') return true;
    }

    if (isValuesScreen) {
        // === Навигация на экране значений ===
        var allItems = [];
        if (backBtn && VISIBLE(backBtn)) allItems.push(backBtn);
        for (var i = 0; i < filterValueItems.length; i++) allItems.push(filterValueItems[i]);

        var idx = allItems.indexOf(currentElement);

        if (dir === 'up') {
            if (idx > 0) return focusEl(allItems[idx - 1], { direction: 'up' });
            return true;
        }
        if (dir === 'down') {
            // ★ Если стоим на кнопке "Назад" — прыгаем сразу на selected элемент
            if (currentElement === backBtn) {
                var selectedInList = panel.querySelector('.filter-value-item.selected');
                if (selectedInList && VISIBLE(selectedInList)) {
                    return focusEl(selectedInList, { direction: 'down' });
                }
            }
            if (idx < allItems.length - 1) return focusEl(allItems[idx + 1], { direction: 'down' });
            return true; // конец списка — стоим
        }
        if (dir === 'left') {
            // Кнопка "назад" — вернуться на главный экран
            if (backBtn && VISIBLE(backBtn)) {
                backBtn.click();
                return true;
            }
        }
        if (dir === 'right') return true;
    }

    return true;
}

// ==================== УПРАВЛЕНИЕ ФОКУСОМ ====================
// updateFocusableElements с кэшированием
function updateFocusableElements() {
    var now = Date.now();
    var screen = AppState.currentScreen;

    // Проверяем кэш
    if (_focusCache.screen === screen &&
        _focusCache.elements.length > 0 &&
        _focusCache.gen === _focusGen &&
        (screen === 'catalog' || now - _focusCache.timestamp < _focusCache.ttl) &&
        _focusCache.elements[0].isConnected !== false) {
        focusableElements = _focusCache.elements;
        return;
    }

    var episodesPanel = getEl('episodes-panel');
    var audioPanel = getEl('audio-panel');
    var subtitlesPanel = getEl('subtitles-panel');
    var isEpisodesOpen = episodesPanel && !episodesPanel.classList.contains('hidden');
    var isAudioOpen = audioPanel && !audioPanel.classList.contains('hidden');
    var isSubtitlesOpen = subtitlesPanel && !subtitlesPanel.classList.contains('hidden');
    var list = [];

    if (isEpisodesOpen) {
        var items = episodesPanel.querySelectorAll('.episode-item, .close-panel-btn');
        for (var i = 0; i < items.length; i++) if (items[i] && items[i].offsetParent !== null) list.push(items[i]);
        focusableElements = list;
        _focusCache.timestamp = now;
        _focusCache.screen = screen;
        _focusCache.elements = focusableElements.slice();
        _focusCache.gen = _focusGen;
        return;
    }
    if (isAudioOpen) {
        var items = audioPanel.querySelectorAll('.audio-item, .close-panel-btn');
        for (var i = 0; i < items.length; i++) if (items[i] && items[i].offsetParent !== null) list.push(items[i]);
        focusableElements = list;
        _focusCache.timestamp = now;
        _focusCache.screen = screen;
        _focusCache.elements = focusableElements.slice();
        _focusCache.gen = _focusGen;
        return;
    }
    if (isSubtitlesOpen) {
        var items = subtitlesPanel.querySelectorAll('.subtitle-item, .close-panel-btn');
        for (var i = 0; i < items.length; i++) if (items[i] && items[i].offsetParent !== null) list.push(items[i]);
        focusableElements = list;
        _focusCache.timestamp = now;
        _focusCache.screen = screen;
        _focusCache.elements = focusableElements.slice();
        _focusCache.gen = _focusGen;
        return;
    }
    if (screen === 'sync') {
        var btn = getEl('sync-close-btn'); if (btn && btn.offsetParent !== null) list.push(btn);
        var inp = getEl('sync-code-input'); if (inp && inp.offsetParent !== null) list.push(inp);
        focusableElements = list;
        _focusCache.timestamp = now;
        _focusCache.screen = screen;
        _focusCache.elements = focusableElements.slice();
        _focusCache.gen = _focusGen;
        return;
    }
    if (screen === 'player') {
        var c = getEl('controls-container');
        if (c && !c.classList.contains('idle-hidden')) {
            var seek = getEl('seek-slider');
            var skipBtn = getEl('skip-button');
            var btns = document.querySelectorAll('#prev-episode-btn, #play-pause-btn, #next-episode-btn, #audio-btn, #subtitles-btn, #episodes-btn, #mute-btn, #zoom-mode-btn, #toggle-buffer-btn');
            for (var i = 0; i < btns.length; i++) if (btns[i] && btns[i].offsetParent !== null) list.push(btns[i]);
            if (seek && seek.offsetParent !== null) list.unshift(seek);
            if (skipBtn && !skipBtn.classList.contains('hidden') && skipBtn.offsetParent !== null) list.push(skipBtn);
        }
        focusableElements = list.filter(function (e) { return e && e.offsetParent !== null; });
        _focusCache.timestamp = now;
        _focusCache.screen = screen;
        _focusCache.elements = focusableElements.slice();
        _focusCache.gen = _focusGen;
        return;
    }
    if (screen === 'detail') {
        // Карточки актёров/рекомендаций — тоже фокусируемые: без них «вверх» из
        // ряда файлов торрентного detail упирается в кнопки шапки
        var sel = '.detail-progress-btn, .file-item, .catalog-watch-btn, .catalog-toggle-overview-btn, .catalog-trailer-btn, .catalog-actor-card, .catalog-recommendation-card';
        var els = document.querySelectorAll(sel);
        for (var i = 0; i < els.length; i++) if (els[i] && els[i].offsetParent !== null) list.push(els[i]);
        focusableElements = list;
        _focusCache.timestamp = now;
        _focusCache.screen = screen;
        _focusCache.elements = focusableElements.slice();
        _focusCache.gen = _focusGen;
        return;
    }
    if (screen === 'home') {
        // Шапка → кнопка «Смотреть» на баннере → карточки ряда, в порядке DOM.
        // Ряды вне экрана на главной скрыты через display:none (home-row-hidden),
        // поэтому их карточки отсеивает проверка offsetParent: на экране всегда
        // ровно один ряд, стрелки вверх/вниз меняют именно его (home.js).
        var navBtns = document.querySelectorAll('#home-topbar .home-nav-btn');
        for (var i = 0; i < navBtns.length; i++) if (navBtns[i].offsetParent !== null) list.push(navBtns[i]);
        var homePlay = getEl('home-play-btn');
        if (homePlay && homePlay.offsetParent !== null) list.push(homePlay);
        var homeCards = document.querySelectorAll('#home-rows .torrent-card.catalog-card');
        for (var i = 0; i < homeCards.length; i++) if (homeCards[i].offsetParent !== null) list.push(homeCards[i]);
        focusableElements = list;
        _focusCache.timestamp = now;
        _focusCache.screen = screen;
        _focusCache.elements = focusableElements.slice();
        _focusCache.gen = _focusGen;
        return;
    }
    if (screen === 'torrents') {
        var searchInput = getEl('search-query'), searchBtn = getEl('search-btn'), settingsBtn = getEl('settings-btn');
        var tabTorrents = getEl('tab-torrents'), tabSearch = getEl('tab-search'), tabCatalog = getEl('tab-catalog');
        var allCards = document.querySelectorAll('#torrents-grid .torrent-card');
        var cards = []; for (var i = 0; i < allCards.length; i++) if (allCards[i] && allCards[i].offsetParent !== null) cards.push(allCards[i]);
        var cols = getTorrentGridColumns();
        var rows = []; for (var j = 0; j < cards.length; j += cols) rows.push(cards.slice(j, j + cols));
        window.torrentRows = { row1: [searchInput, searchBtn, settingsBtn].filter(Boolean), row2: [tabTorrents, tabSearch, tabCatalog].filter(Boolean), cardRows: rows, allCards: cards };
        var focusList = cards.slice();
        if (searchInput && searchInput.offsetParent !== null) focusList.push(searchInput);
        if (searchBtn && searchBtn.offsetParent !== null) focusList.push(searchBtn);
        // Кнопки общей шапки одним списком в порядке DOM: там же лежат «Главная»
        // и «Настройки», поэтому перечислять вкладки поимённо больше не нужно.
        var navBtns = getTorrentTabs();
        for (var n = 0; n < navBtns.length; n++) if (focusList.indexOf(navBtns[n]) === -1) focusList.push(navBtns[n]);
        focusableElements = focusList.filter(function (e) { return e && e.offsetParent !== null; });
        _focusCache.timestamp = now;
        _focusCache.screen = screen;
        _focusCache.elements = focusableElements.slice();
        _focusCache.gen = _focusGen;
        return;
    }
    if (screen === 'catalog') {
        // Тот же кэш по поколению, что и у навигации: обход карточек с
        // offsetParent делается один раз на изменение DOM, а не здесь заново.
        var cards = getCatalogGridCards();
        for (var i = 0; i < cards.length; i++) list.push(cards[i]);
        var rowHeaders = document.querySelectorAll('#catalog-rows .catalog-row-header, #catalog-grid .catalog-row-header');
        for (var rh = 0; rh < rowHeaders.length; rh++) if (rowHeaders[rh] && rowHeaders[rh].offsetParent !== null) list.push(rowHeaders[rh]);
        // window.catalogCards заполняем ДО кнопок шапки: legacy-навигация по
        // сетке считает по нему индексы карточек, шапке там места нет.
        window.catalogCards = list.slice();
        var catNav = getTorrentTabs();
        for (var cn = 0; cn < catNav.length; cn++) if (list.indexOf(catNav[cn]) === -1) list.push(catNav[cn]);
        // Кэш и focusableElements — один и тот же массив: список нигде не
        // мутируют на месте, только переприсваивают целиком, поэтому вторая
        // копия сотен элементов на каждую пересборку была лишней.
        focusableElements = list;
        _focusCache.timestamp = now;
        _focusCache.screen = screen;
        _focusCache.elements = list;
        _focusCache.gen = _focusGen;
        return;
    }
    if (screen === 'search') {
        var q = getEl('search-query'), ft = getEl('filter-toggle'), sb = getEl('search-btn'), cs = getEl('close-search');
        // Поиск из карточки каталога: строка только для чтения, и вести в неё
        // фокус незачем — как и в «Поиск», который перезапустил бы тот же
        // запрос. Замок ставит setSearchLocked (torrents.js).
        if (window.AppState && AppState.searchLocked) { q = null; sb = null; }
        var ris = document.querySelectorAll('.search-result-item, .global-search-card');
        var res = []; for (var i = 0; i < ris.length; i++) if (ris[i] && ris[i].offsetParent !== null) res.push(ris[i]);

        var fl = [q, ft, sb, cs];

        // ★ НОВАЯ ПАНЕЛЬ ФИЛЬТРОВ — добавляем её элементы
        var filterPanel = getEl('search-filters-panel');
        if (filterPanel && filterPanel.classList.contains('active')) {
            var backBtn = getEl('filter-back-btn');
            var closeBtn = getEl('filter-close-btn');
            var resetBtn = getEl('reset-filters');

            // Порядок важен: сначала кнопки навигации, потом элементы
            if (backBtn && VISIBLE(backBtn)) fl.push(backBtn);
            if (closeBtn && VISIBLE(closeBtn)) fl.push(closeBtn);

            // Главный экран: .filter-item
            var filterItems = filterPanel.querySelectorAll('.filter-item');
            for (var fi = 0; fi < filterItems.length; fi++) {
                if (filterItems[fi] && filterItems[fi].offsetParent !== null) fl.push(filterItems[fi]);
            }

            // Экран значений: .filter-value-item
            var valueItems = filterPanel.querySelectorAll('.filter-value-item');
            for (var vi = 0; vi < valueItems.length; vi++) {
                if (valueItems[vi] && valueItems[vi].offsetParent !== null) fl.push(valueItems[vi]);
            }

            // Кнопка сброса
            if (resetBtn && VISIBLE(resetBtn)) fl.push(resetBtn);
        }

        // Результаты поиска (после фильтров)
        for (var i = 0; i < res.length; i++) fl.push(res[i]);

        focusableElements = fl.filter(Boolean);
        _focusCache.timestamp = now;
        _focusCache.screen = screen;
        _focusCache.elements = focusableElements.slice();
        _focusCache.gen = _focusGen;
        return;
    }
    if (screen === 'config') {
        var ids = ['torrserver-tab', 'torrents-tab', 'player-tab', 'appearance-tab', 'sync-tab'];
        var cfg = document.querySelectorAll('.settings-btn');
        for (var i = 0; i < ids.length; i++) { var e = getEl(ids[i]); if (e && e.offsetParent !== null) list.push(e); }
        for (var i = 0; i < cfg.length; i++) if (cfg[i] && cfg[i].offsetParent !== null) list.push(cfg[i]);
        focusableElements = list;
        _focusCache.timestamp = now;
        _focusCache.screen = screen;
        _focusCache.elements = focusableElements.slice();
        _focusCache.gen = _focusGen;
        return;
    }
    focusableElements = [];
    _focusCache.timestamp = now;
    _focusCache.screen = screen;
    _focusCache.elements = focusableElements.slice();
    _focusCache.gen = _focusGen;
}

// setFocus с requestAnimationFrame для плавности
function setFocus(index) {
    if (focusableElements.length === 0) { updateFocusableElements(); if (focusableElements.length === 0) return; }
    if (index < 0) index = focusableElements.length - 1;
    if (index >= focusableElements.length) index = 0;
    currentFocusIndex = index;
    var element = focusableElements[currentFocusIndex];
    if (!element) return;

    // Передаём направление навигации в focusEl
    focusEl(element, { direction: lastNavDirection });

    if (AppState.currentScreen === 'config') {
        switchConfigTab(element.id);
    }
    if (AppState.currentScreen === 'torrents' && element.classList.contains('torrent-card')) {
        var row1Len = (window.torrentRows && window.torrentRows.row1 ? window.torrentRows.row1.length : 0);
        var row2Len = (window.torrentRows && window.torrentRows.row2 ? window.torrentRows.row2.length : 0);
        var torrentIndex = currentFocusIndex - (row1Len + row2Len);
        var t = AppState.torrents[torrentIndex];
        if (t && t.hash) { lastSelectedTorrentHash = t.hash; lastSelectedTorrentIndex = torrentIndex; }
        else if (element.dataset.hash) { lastSelectedTorrentHash = element.dataset.hash; lastSelectedTorrentIndex = torrentIndex >= 0 ? torrentIndex : 0; }
        window.lastSelectedTorrentHash = lastSelectedTorrentHash;
        window.lastSelectedTorrentIndex = lastSelectedTorrentIndex;
    }
    if (document.activeElement && document.activeElement.tagName === 'INPUT') {
        var allowed = ['search-query', 'torrserver-url', 'auth-login', 'auth-password', 'jacred-url'];
        if (allowed.indexOf(element.id) === -1) document.activeElement.blur();
    }
}

function focusFirstTorrentCard(retries, delay) {
    if (retries === undefined) retries = 6; if (delay === undefined) delay = 120;
    if (AppState.currentScreen !== 'torrents') return false;
    updateFocusableElements();
    for (var i = 0; i < focusableElements.length; i++) {
        if (focusableElements[i].classList && focusableElements[i].classList.contains('torrent-card')) { setFocus(i); return true; }
    }
    if (retries > 0) setTimeout(function () { focusFirstTorrentCard(retries - 1, delay); }, delay);
    return false;
}

function focusSearchHome(preferQuery) {
    if (preferQuery === undefined) preferQuery = true;
    updateFocusableElements();
    var qi = -1, si = -1, fi = -1;
    for (var i = 0; i < focusableElements.length; i++) {
        var e = focusableElements[i];
        if (e.id === 'search-query') qi = i;
        if (e.id === 'search-btn') si = i;
        if (fi === -1 && ['filter-toggle', 'torrent-movie', 'sort-by', 'filter-quality', 'filter-content-type', 'filter-tracker', 'filter-year', 'filter-season', 'filter-voice', 'filter-videotype', 'reset-filters', 'close-search'].indexOf(e.id) !== -1) fi = i;
    }
    var target = preferQuery && qi !== -1 ? qi : (si !== -1 ? si : (fi !== -1 ? fi : 0));
    setFocus(target);
}

// ==================== НАВИГАЦИЯ ====================
function navigate(direction) {
    if (typeof setFastNavigation === 'function') setFastNavigation(direction);
    lastNavDirection = direction;
    var active = document.activeElement;
    if (active && active.id === 'search-query') {
        active.blur(); updateFocusableElements();
        if (AppState.currentScreen === 'search') {
            var ff = -1, fr = -1;
            for (var i = 0; i < focusableElements.length; i++) { var e = focusableElements[i]; if (['filter-toggle', 'torrent-movie', 'sort-by', 'filter-quality', 'filter-content-type', 'filter-tracker', 'filter-year', 'filter-season', 'filter-voice', 'filter-videotype', 'reset-filters', 'close-search'].indexOf(e.id) !== -1 && ff === -1) ff = i; if (e.classList && e.classList.contains('search-result-item') && fr === -1) fr = i; }
            setFocus(direction === 'down' && fr !== -1 ? fr : (ff !== -1 ? ff : (fr !== -1 ? fr : 0))); return;
        }
        var fc = -1; for (var i = 0; i < focusableElements.length; i++) if (focusableElements[i].classList && focusableElements[i].classList.contains('torrent-card')) { fc = i; break; }
        setFocus(fc !== -1 ? fc : 0); return;
    }
    if (focusableElements.length === 0) {
        updateFocusableElements(); if (focusableElements.length === 0) return;
        if (AppState.currentScreen === 'torrents') { var fc = -1; for (var i = 0; i < focusableElements.length; i++) if (focusableElements[i].classList && focusableElements[i].classList.contains('torrent-card')) { fc = i; break; } setFocus(fc !== -1 ? fc : 0); }
        else if (AppState.currentScreen === 'search') { var ff = -1; for (var i = 0; i < focusableElements.length; i++) if (['filter-toggle', 'torrent-movie', 'sort-by', 'filter-quality', 'filter-content-type', 'filter-tracker', 'filter-year', 'filter-season', 'filter-voice', 'filter-videotype', 'reset-filters', 'close-search'].indexOf(focusableElements[i].id) !== -1) { ff = i; break; } setFocus(ff !== -1 ? ff : 0); }
        return;
    }
    var cur = focusableElements[currentFocusIndex];

    // TORRENTS NAV
    if (AppState.currentScreen === 'torrents') {
        var sBtn = getEl('settings-btn'), tT = getEl('tab-torrents'), tS = getEl('tab-search'), tC = getEl('tab-catalog');
        var cards = window.torrentRows && window.torrentRows.allCards ? window.torrentRows.allCards : [];
        if (!cur) { if (cards.length > 0) setFocus(focusableElements.indexOf(cards[0])); else { var f = -1; for (var i = 0; i < focusableElements.length; i++) if (focusableElements[i].id === 'tab-torrents') { f = i; break; } setFocus(f !== -1 ? f : 0); } return; }
        var isSet = cur === sBtn, isTT = cur === tT, isTS = cur === tS, isTC = cur === tC, isC = false, cIdx = -1;
        for (var i = 0; i < cards.length; i++) if (cur === cards[i]) { isC = true; cIdx = i; break; }
        var cols = getTorrentGridColumns();
        switch (direction) {
            case 'up': if (isC) { if (cIdx < cols) setFocus(focusableElements.indexOf(tT)); else setFocus(focusableElements.indexOf(cards[cIdx - cols])); } else if (isTT || isTS || isTC) { if (cards.length > 0) setFocus(focusableElements.indexOf(cards[0])); } break;
            case 'down': if (isSet) setFocus(focusableElements.indexOf(tT)); else if (isTT || isTS || isTC) { if (cards.length > 0) setFocus(focusableElements.indexOf(cards[0])); } else if (isC) { if (cIdx + cols < cards.length) setFocus(focusableElements.indexOf(cards[cIdx + cols])); } break;
            case 'left': if (isSet) setFocus(focusableElements.indexOf(tC)); else if (isTC) setFocus(focusableElements.indexOf(tS)); else if (isTS) setFocus(focusableElements.indexOf(tT)); else if (isC && cIdx > 0 && cIdx % cols !== 0) setFocus(focusableElements.indexOf(cards[cIdx - 1])); break;
            case 'right': if (isTT) setFocus(focusableElements.indexOf(tS)); else if (isTS) setFocus(focusableElements.indexOf(tC)); else if (isC && cIdx < cards.length - 1 && (cIdx + 1) % cols !== 0) setFocus(focusableElements.indexOf(cards[cIdx + 1])); break;
        }
        return;
    }

    // CATALOG NAV
    if (AppState.currentScreen === 'catalog') {
        var cards = window.catalogCards || []; if (!cards.length) return;
        var cIdx = -1; for (var i = 0; i < cards.length; i++) if (cur === cards[i]) { cIdx = i; break; }
        var cols = getTorrentGridColumns();
        switch (direction) {
            case 'left': if (cIdx > 0 && cIdx % cols !== 0) setFocus(focusableElements.indexOf(cards[cIdx - 1])); break;
            case 'right': if (cIdx < cards.length - 1 && (cIdx + 1) % cols !== 0) setFocus(focusableElements.indexOf(cards[cIdx + 1])); break;
            case 'up': if (cIdx >= cols) setFocus(focusableElements.indexOf(cards[cIdx - cols])); break;
            case 'down': if (cIdx + cols < cards.length) { setFocus(focusableElements.indexOf(cards[cIdx + cols])); if (typeof window.checkAndLoadMoreOnNavigation === 'function') window.checkAndLoadMoreOnNavigation(); } else if (cIdx === cards.length - 1 && typeof window.checkAndLoadMoreOnNavigation === 'function') window.checkAndLoadMoreOnNavigation(); break;
        }
        return;
    }

    // PLAYER NAV
    if (AppState.currentScreen === 'player') {
        var cc = getEl('controls-container'); if (!cc || cc.classList.contains('idle-hidden')) return;
        var ep = getEl('episodes-panel'), ap = getEl('audio-panel'), sp = getEl('subtitles-panel');
        var isOpen = (ep && !ep.classList.contains('hidden')) || (ap && !ap.classList.contains('hidden')) || (sp && !sp.classList.contains('hidden'));

        if (isOpen) {
            // Инвалидируем кэш для получения актуального списка элементов панели
            if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
            updateFocusableElements();

            var panelLen = focusableElements.length;
            if (panelLen === 0) return;

            // Синхронизируем currentFocusIndex с реально сфокусированным элементом
            var actualFocused = document.querySelector('.focused');
            if (actualFocused) {
                var actualIndex = focusableElements.indexOf(actualFocused);
                if (actualIndex !== -1) {
                    currentFocusIndex = actualIndex;
                }
            }

            // принудительно загоняем индекс в допустимые границы
            if (currentFocusIndex < 0) currentFocusIndex = 0;
            if (currentFocusIndex >= panelLen) currentFocusIndex = panelLen - 1;

            // Навигация с защитой от выхода за пределы
            if (direction === 'up') {
                if (currentFocusIndex > 0) {
                    setFocus(currentFocusIndex - 1);
                }
                // Если currentFocusIndex === 0 — ничего не делаем, стоим на первом элементе
            } else if (direction === 'down') {
                if (currentFocusIndex < panelLen - 1) {
                    setFocus(currentFocusIndex + 1);
                }
                // Если currentFocusIndex === panelLen - 1 — ничего не делаем, стоим на последнем
            }
            return;
        }

        if (cur && cur.id === 'seek-slider') { if (direction === 'down' && focusableElements.length > 1) setFocus(1); return; }
        if (direction === 'up') setFocus(0); else if (direction === 'left' && currentFocusIndex > 1) setFocus(currentFocusIndex - 1); else if (direction === 'right' && currentFocusIndex < focusableElements.length - 1) setFocus(currentFocusIndex + 1);
        return;
    }
    // SEARCH NAV
    if (AppState.currentScreen === 'search') {
        var q = getEl('search-query'), fl = [], res = [];
        for (var i = 0; i < focusableElements.length; i++) { var e = focusableElements[i]; if (['torrent-movie', 'sort-by', 'filter-quality', 'filter-content-type', 'filter-tracker', 'filter-year', 'filter-season', 'filter-voice', 'filter-videotype', 'reset-filters', 'close-search'].indexOf(e.id) !== -1) fl.push(e); if (e.classList && (e.classList.contains('search-result-item') || e.classList.contains('global-search-card'))) res.push(e); }
        var fIdx = -1, rIdx = -1; for (var i = 0; i < fl.length; i++) if (cur === fl[i]) { fIdx = i; break; } for (var i = 0; i < res.length; i++) if (cur === res[i]) { rIdx = i; break; }
        if (!cur) { if (q && focusableElements.indexOf(q) !== -1) setFocus(focusableElements.indexOf(q)); else if (fl.length > 0) setFocus(focusableElements.indexOf(fl[0])); else if (res.length > 0) setFocus(focusableElements.indexOf(res[0])); return; }
        if (cur === q) { if (['left', 'right', 'down', 'up'].indexOf(direction) !== -1) setFocus(fl.length > 0 ? focusableElements.indexOf(fl[0]) : (res.length > 0 ? focusableElements.indexOf(res[0]) : 0)); return; }
        if (fIdx !== -1) { if (direction === 'left') setFocus(focusableElements.indexOf(fl[Math.max(0, fIdx - 1)])); else if (direction === 'right') setFocus(focusableElements.indexOf(fl[Math.min(fl.length - 1, fIdx + 1)])); else if (direction === 'down') setFocus(res.length > 0 ? focusableElements.indexOf(res[0]) : focusableElements.indexOf(fl[Math.min(fl.length - 1, fIdx + 1)])); else if (direction === 'up') setFocus(q && focusableElements.indexOf(q) !== -1 ? focusableElements.indexOf(q) : focusableElements.indexOf(fl[Math.max(0, fIdx - 1)])); return; }
        if (rIdx !== -1) { if (direction === 'up') setFocus(rIdx === 0 && fl.length > 0 ? focusableElements.indexOf(fl[0]) : focusableElements.indexOf(res[Math.max(0, rIdx - 1)])); else if (direction === 'down') setFocus(focusableElements.indexOf(res[Math.min(res.length - 1, rIdx + 1)])); return; }
    }

    // DEFAULT
    switch (direction) { case 'up': setFocus(currentFocusIndex - 1); break; case 'down': setFocus(currentFocusIndex + 1); break; case 'left': setFocus(currentFocusIndex - 1); break; case 'right': setFocus(currentFocusIndex + 1); break; }
}

// Тот же ответ, что и у arrowDir() ниже по файлу — две одинаковые функции
// жили рядом. Оставлено имя, которым пользуется ветка плеера.
function keyToDirection(keyCode) { return arrowDir(keyCode); }
function stopSeeking() { if (seekHoldInterval) { clearInterval(seekHoldInterval); seekHoldInterval = null; } }

// ==================== ОБРАБОТЧИКИ КЛАВИШ ====================
function onOk() {
    var s = currentScreen();
    var f = document.querySelector('.focused');
    var strategy = ScreenStrategies[s];

    if (!strategy) return false;
    if (!f) return strategy.ensureFocus ? strategy.ensureFocus(true) : false;

    return strategy.onOk(f);
}

// Главная (home.js) как «подложка» под настройками и поиском. currentScreen()
// для этого не годится: настройки гасят #torrserver-section целиком, поэтому
// смотрим только на атрибут hidden самого экрана главной.
function isHomeUnderneath() {
    var h = getEl('content-home');
    return !!(h && !h.hidden);
}

function onBack() {
    var s = getEl('search-overlay'), d = getEl('detail-view'), c = getEl('config-screen');
    var cat = currentScreen() === 'catalog', dn = currentScreen() === 'donate';
    var hm = currentScreen() === 'home';

    var configScreen = getEl('config-screen');
    // Проверяем, открыта ли панель фильтров
    var filterPanel = getEl('search-filters-panel');
    if (filterPanel && filterPanel.classList.contains('active')) {
        // Проверяем, на каком экране панели находимся
        var valuesScreen = filterPanel.querySelector('.filter-values-screen');
        if (valuesScreen && valuesScreen.style.display !== 'none') {
            // На экране значений - вернуться на главный экран
            var backBtn = getEl('filter-back-btn');
            if (backBtn) backBtn.click();
            return true;
        } else {
            // На главном экране - закрыть панель
            closeFilterPanel();
            return true;
        }
    }
    // Настройщик внешнего вида (ui-customizer.js) лежит поверх любого экрана и
    // гасит клавиши сам. Но если его код кнопки «назад» не совпал с нашим, мы
    // окажемся здесь при ОТКРЫТОЙ панели и уведём фокус за неё — на экране
    // ничего не изменится, и выйти будет нельзя. Проверяем до всех экранов:
    // пока панель открыта, «назад» закрывает её и ничего больше.
    if (window.UICustomizer && typeof UICustomizer.isOpen === 'function' &&
        UICustomizer.isOpen() && typeof UICustomizer.close === 'function') {
        UICustomizer.close();
        return true;
    }

    if (configScreen && _isScreenVisible(configScreen)) {
        var focusedElement = document.querySelector('.focused');
        var menuItems = getConfigMenuItems();
        var isOnMenu = false;
        for (var i = 0; i < menuItems.length; i++) {
            if (focusedElement === menuItems[i]) { isOnMenu = true; break; }
        }
        if (!isOnMenu) { handleConfigNavigation('back'); return true; }
        else {
            for (var i = 0; i < menuItems.length; i++) menuItems[i].classList.remove('active');
            configState.activeTabId = null;
            configState.isOnMenu = true;
            configState.initialized = false;
            configScreen.style.display = 'none';
            var torrserverSection = getEl('torrserver-section');
            if (torrserverSection) torrserverSection.style.display = 'block';
            // Из настроек возвращаемся туда, откуда пришли.
            //
            // Раньше вариантов было два: главная, если она осталась под
            // настройками, иначе торренты. Из каталога это давало
            // currentScreen = 'torrents' поверх видимого #content-catalog —
            // карточек торрентов на экране нет, и фокус падал на кнопки шапки.
            // Экран запоминает обработчик открытия настроек (AppState.configReturnTo),
            // проверка isHomeUnderneath остаётся запасным вариантом.
            var returnTo = (window.AppState && AppState.configReturnTo) || null;
            if (!returnTo) returnTo = isHomeUnderneath() ? 'home' : 'torrents';
            if (window.AppState) AppState.configReturnTo = null;

            if (returnTo === 'home' && window.HomeScreen) {
                window.HomeScreen.show({ restoreFocus: true });
                return true;
            }

            try { window.AppState.currentScreen = returnTo; } catch (e) { }
            setTimeout(function () {
                // Экран мог перестать быть доступным, пока мы сидели в
                // настройках (сервер отвалился, каталог пересобрали) —
                // тогда уходим к торрентам, как было раньше
                if (restoreScreenFocus(returnTo)) return;
                if (returnTo === 'torrents') return;
                try { window.AppState.currentScreen = 'torrents'; } catch (e) { }
                ScreenStrategies.torrents.ensureFocus(true);
            }, 180);
            return true;
        }
    }

    if (AppState.syncCodeScreen == true) { toggleSyncOverlay(); return true; }
    if (typeof window.closeCatalogTrailerOverlay === 'function' && window.closeCatalogTrailerOverlay()) {
        setTimeout(function () { ScreenStrategies.detail.ensureFocus(true); }, 80);
        return true;
    }
    // ★ Панель фильтров — проверяем ПЕРЕД search-overlay
    var filterPanel = getEl('search-filters-panel');
    if (filterPanel && filterPanel.classList.contains('active')) {
        var valuesScreen = filterPanel.querySelector('.filter-values-screen');
        if (valuesScreen && valuesScreen.style.display !== 'none') {
            // На экране значений — вернуться на главный
            var backBtn = getEl('filter-back-btn');
            if (backBtn) backBtn.click();
        } else {
            // На главном экране — закрыть панель
            closeFilterPanel();
        }
        return true;
    }
    if (s && !s.classList.contains('hidden') && _isScreenVisible(s)) {
        // Та же цепочка, что и в closeSearchBtn:
        // если вернулись из detail в поиск — «назад» открывает карточку каталога
        if (AppState && AppState.openCatalogDetailOnSearchClose) {
            var catalogItem = AppState.openCatalogDetailOnSearchClose;
            AppState.openCatalogDetailOnSearchClose = null;
            AppState.searchReturnTo = null;
            if (catalogItem && catalogItem.id && typeof window.showCatalogDetail === 'function') {
                s.classList.add('hidden');
                window.showCatalogDetail(catalogItem, AppState.catalogIndex || 0, AppState.catalogPu || null);
                return true;
            }
        }
        if (typeof window.hideSearchResults === 'function') {
            window.hideSearchResults();
            // hideSearchResults сам возвращает фокус на главную (ветка
            // returnTo === 'home'), кнопку поиска в этом случае не трогаем.
            // Ищем её по id: порядок кнопок в шапке теперь задаёт вёрстка.
            if (!isHomeUnderneath()) focusEl(getEl('tab-search'));
        }
        else leaveSearchToTorrents();
        return true;
    }
    if (d && _isScreenVisible(d)) {
        if (AppState.trailerPlay) {
            ovh = getEl('catalog-toggle-overview-btn');
            stopTrailerBackground();
            focusEl(ovh);
            return true;
        }
        clickEl(getEl('back-from-detail') || document.querySelector('.back-btn'));
        return true;
    }
    if (dn) { if (typeof window.closeDonateOverlay === 'function') window.closeDonateOverlay(); return true; }
    if (hm) {
        // Главная — точка входа: наружу уходить некуда. «Назад» из рядов
        // поднимает фокус в шапку, из шапки не делает ничего.
        if (window.HomeScreen && typeof window.HomeScreen.handleBack === 'function') {
            return window.HomeScreen.handleBack();
        }
        return true;
    }
    if (cat) {
        // Из рядов уходить некуда: «назад» здесь ничего не делает. Раньше признаком
        // рядов было наличие .catalog-folder-card в #catalog-grid — теперь карточки
        // «Показать все» лежат в #catalog-rows, поэтому спрашиваем режим напрямую.
        if (isCatalogRowsMode()) return true;
        if (window.catalogState) { window.catalogState.lastSelectedIndex = 0; window.catalogState.lastSelectedId = null; localStorage.removeItem('lastCatalogCardIndex'); }
        if (typeof window.backToCatalogList === 'function') { AppState.currentScreen = 'catalog'; window.backToCatalogList(); }
        else clickEl(getEl('back-from-catalog'));
        setTimeout(function () { ScreenStrategies.catalog.ensureFocus(true); }, 180);
        return true;
    }
    if (c && _isScreenVisible(c)) {
        var m = getEl('torrserver-section');
        c.style.display = 'none';
        if (m) m.style.display = 'block';
        if (isHomeUnderneath() && window.HomeScreen) {
            window.HomeScreen.show({ restoreFocus: true });
            return true;
        }
        try { window.AppState.currentScreen = 'torrents'; } catch (e) { }
        setTimeout(function () { ScreenStrategies.torrents.ensureFocus(true); }, 180);
        return true;
    }
    return false;
}

function isArrowKey(kc) { return KEY_CODES.ARROWS.LEFT === kc || KEY_CODES.ARROWS.UP === kc || KEY_CODES.ARROWS.RIGHT === kc || KEY_CODES.ARROWS.DOWN === kc || (typeof isKeyPressed === 'function' && (isKeyPressed('UP', kc) || isKeyPressed('DOWN', kc) || isKeyPressed('LEFT', kc) || isKeyPressed('RIGHT', kc))); }
function arrowDir(kc) { if ([37, 38, 39, 40].indexOf(kc) !== -1) return ({ 37: 'left', 38: 'up', 39: 'right', 40: 'down' })[kc]; if (typeof isKeyPressed === 'function') { if (isKeyPressed('UP', kc)) return 'up'; if (isKeyPressed('DOWN', kc)) return 'down'; if (isKeyPressed('LEFT', kc)) return 'left'; if (isKeyPressed('RIGHT', kc)) return 'right'; } return null; }
function isOkKey(kc) { return kc === 13 || (typeof isKeyPressed === 'function' && isKeyPressed('OK', kc)); }
function isBackKey(kc) { return KEY_CODES.BACK.indexOf(kc) !== -1 || (typeof isKeyPressed === 'function' && (isKeyPressed('BACK', kc) || isKeyPressed('EXIT', kc))); }

function focusActivePanelItem(panelType) {
    setTimeout(function () {
        var sel;
        if (panelType === 'episodes') sel = '.episode-item.active';
        else if (panelType === 'subtitles') sel = '.subtitle-item.active';
        else sel = '.audio-item.active';

        // Обязательно инвалидируем кэш, чтобы получить свежий список элементов панели
        if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
        updateFocusableElements();

        var active = document.querySelector(sel);

        // Если активного элемента нет — берём первый элемент списка
        if (!active) {
            var fallbackSel = panelType === 'episodes' ? '.episode-item'
                : panelType === 'subtitles' ? '.subtitle-item'
                    : '.audio-item';
            active = document.querySelector(fallbackSel);
        }

        if (!active) {
            // Совсем ничего нет — фокусируемся на close-panel-btn или первом элементе
            if (focusableElements.length > 0) setFocus(0);
            return;
        }

        // Ищем индекс активного элемента в focusableElements
        var targetIndex = -1;
        for (var i = 0; i < focusableElements.length; i++) {
            if (focusableElements[i] === active) {
                targetIndex = i;
                break;
            }
        }

        if (targetIndex !== -1) {
            setFocus(targetIndex);
        } else if (focusableElements.length > 0) {
            // Fallback: первый элемент
            setFocus(0);
        }
    }, 100);
}

/**
 * Клавиатура и пульт разведены по двум обработчикам keydown на document, и это
 * не дубль:
 *
 *   • setupFocusRescue() слушает в фазе ПЕРЕХВАТА и забирает стрелки, OK и
 *     «назад» на всех обычных экранах (главная, торренты, каталог, поиск,
 *     карточка, настройки, донат), передавая их в ScreenStrategies. Он гасит
 *     событие через stopImmediatePropagation, поэтому до обработчика ниже эти
 *     клавиши на этих экранах просто не доходят;
 *   • setupKeyboardHandlers() (здесь) слушает в фазе всплытия и обслуживает
 *     плеер — там перехватчик уходит первой же строкой — плюс остаётся
 *     запасным путём для экранов, которых перехватчик не знает.
 *
 * Порядок регистрации значения не имеет: перехват всегда раньше всплытия.
 * Не сливайте их в один обработчик, не переписав маршрутизацию целиком.
 */
function setupKeyboardHandlers() {
    // Один keyup на оба дела: отпускание перемотки и отпускание OK на карточке
    // торрента (долгое нажатие = удаление). Раньше это были два отдельных
    // слушателя на document в разных функциях и фазах.
    document.addEventListener('keyup', function (e) {
        var k = e.keyCode;

        // Долгое OK на карточке торрента: отпустили — либо обычный клик,
        // либо ничего, если удаление уже отработало по таймеру
        if (isOkKey(k) && !isCustomFilterMenuOpen() && currentScreen() === 'torrents') {
            var focused = document.querySelector('.focused');
            var sameCard = focused && okHoldFocused && focused === okHoldFocused;
            clearOkHold();
            if (!okHoldHandled && sameCard && focused.classList.contains('torrent-card')) focused.click();
            okHoldHandled = false;
            okHoldFocused = null;
            return;
        }

        if (isKeyPressed('LEFT', k) || isKeyPressed('RIGHT', k)) {
            if (seekHoldInterval) {
                clearInterval(seekHoldInterval);
                seekHoldInterval = null;

                if (accelerationTimer) {
                    clearInterval(accelerationTimer);
                    accelerationTimer = null;
                }

                var s = getEl('seek-slider');
                if (s) {
                    var ev = document.createEvent('Event');
                    ev.initEvent('change', true, true);
                    s.dispatchEvent(ev);
                }

                setTimeout(function () {
                    isSeekHoldActive = false;
                }, 500);

                // СКРЫВАЕМ ОВЕРЛЕЙ С ЗАДЕРЖКОЙ
                scheduleHideSeekOverlay();
            }
            stopSeeking();
        }
    });

    document.addEventListener('keydown', function (e) {
        var k = e.keyCode;
        navKeyRepeat = !!e.repeat;       // держат кнопку или короткое нажатие
        var po = getEl('playback-overlay'); var isPA = po && po.classList.contains('active'); if (isPA) return;
        var a = document.activeElement, ed = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
        var skipBtn = getEl('skip-button'); if (k == 13 && skipBtn && !skipBtn.classList.contains('hidden') && skipBtn.classList.contains('focused')) { if (typeof window.executeSkip === 'function') { window.executeSkip(); return true; } }

        if (ed) {
            var isEmpty = false;
            if (a.tagName === 'SELECT') { isEmpty = (a.selectedIndex === -1 || a.value === ''); }
            else { isEmpty = (a.value === '' || a.value === null); }
            if (!isEmpty) return;
        }

        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        // Дальше — плеер и запасной путь. Экраны поиска, торрентов, каталога,
        // карточки и настроек сюда не доходят: их стрелки, OK и «назад»
        // забирает перехватчик в setupFocusRescue и гасит событие. Здесь для
        // них раньше лежали свои ветки навигации — мёртвый дубль той же логики.
        updateFocusableElements();

        if (AppState.currentScreen === 'player') {
            var vp = getEl('video-player'), cc = getEl('controls-container'), cv = !cc.classList.contains('idle-hidden');
            if (isKeyPressed('UP', k) && !cv) { e.preventDefault(); showPlayerControls('play-pause-btn'); return; }
            if (isKeyPressed('OK', k)) {
                e.preventDefault(); var f = document.querySelector('.focused'); if (!cv) { showPlayerControls('play-pause-btn'); return; } if (f) {
                    var done = false;
                    if (f.id === 'play-pause-btn') { vp.paused ? vp.play() : vp.pause(); if (typeof window.updatePlayPauseButton === 'function') window.updatePlayPauseButton(); done = true; }
                    else if (f.id === 'mute-btn') { vp.muted = !vp.muted; if (typeof window.updateMuteButton === 'function') window.updateMuteButton(); done = true; }
                    else if (f.id === 'prev-episode-btn') { if (typeof window.prevEpisode === 'function') window.prevEpisode(); done = true; }
                    else if (f.id === 'next-episode-btn') { if (typeof window.nextEpisode === 'function') window.nextEpisode(); done = true; }
                    else if (f.id === 'episodes-btn') { var eb = getEl('episodes-btn'); if (eb) eb.click(); updateFocusableElements(); focusActivePanelItem('episodes'); }
                    else if (f.id === 'audio-btn') { var ab = getEl('audio-btn'); if (ab) ab.click(); updateFocusableElements(); focusActivePanelItem('audio'); }
                    else if (f.id === 'subtitles-btn') { var sb = getEl('subtitles-btn'); if (sb) sb.click(); updateFocusableElements(); focusActivePanelItem('subtitles'); }
                    else if (f.id === 'exit-player-btn') { if (typeof window.showDetailView === 'function') window.showDetailView(); return; }
                    else if (f.id === 'toggle-buffer-btn') { var tb = getEl('toggle-buffer-btn'); if (tb) tb.click(); done = true; }
                    else if (f.id === 'seek-slider') { var t = parseFloat(f.value); if (typeof window.showPlayerLoading === 'function') window.showPlayerLoading('⏱️ ' + formatTime(t)); setTimeout(function () { if (typeof window.hidePlayerLoading === 'function') window.hidePlayerLoading(); }, 1000); done = true; }
                    else { f.click(); done = true; }
                    if (done) setTimeout(function () { hidePlayerControls(); }, 400);
                    if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();
                    return;
                }
            }
            if (isKeyPressed('LEFT', k) || isKeyPressed('RIGHT', k)) {
                e.preventDefault();
                // cv посчитан в начале ветки, панель с тех пор никто не трогал
                if (!cv) return;
                if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();

                var fe = focusableElements[currentFocusIndex];
                if (fe && fe.id === 'seek-slider') {
                    var s = getEl('seek-slider');
                    var loadingOverlay = getEl('loading-player-overlay');
                    var loadingTimeEl = getEl('loading-time');
                    var currentTimeEl = getEl('current-time');
                    var dir = isKeyPressed('LEFT', k) ? -1 : 1;
                    var cs = seekHoldStep;
                    var lu = Date.now();

                    // Шаг ускорения — из общей таблицы SEEK_ACCELERATION_STEPS
                    // наверху файла. Раньше рядом лежала её вторая, дословная
                    // копия, и таблица-константа не использовалась вообще.
                    var us = function () {
                        var elapsed = Date.now() - lu;
                        var ns = seekHoldStep;
                        for (var i = SEEK_ACCELERATION_STEPS.length - 1; i >= 0; i--) {
                            if (elapsed >= SEEK_ACCELERATION_STEPS[i].time) {
                                ns = SEEK_ACCELERATION_STEPS[i].step;
                                break;
                            }
                        }
                        cs = ns;
                    };

                    // Шаг перемотки: двигаем ползунок и показываем индикатор.
                    // Реальный seek уходит один раз на keyup — событием change.
                    var ps = function () {
                        var nv = parseFloat(s.value) + cs * dir;
                        var mx = parseFloat(s.max);

                        if (nv < 0) nv = 0;
                        if (nv > mx) nv = mx;

                        s.value = nv;

                        if (typeof AppState !== 'undefined') AppState.previewTime = nv;
                        if (currentTimeEl) currentTimeEl.textContent = formatTime(nv);
                        if (loadingTimeEl && (AppState.isSeeking ||
                            (loadingOverlay && loadingOverlay.classList.contains('active')))) {
                            loadingTimeEl.textContent = formatTime(nv);
                        }

                        showSeekOverlay(nv, dir, cs);
                    };

                    if (!seekHoldInterval) {
                        isSeekHoldActive = true;
                        cs = seekHoldStep;
                        lu = Date.now();

                        ps();
                        seekHoldInterval = setInterval(ps, seekHoldDelay);

                        // accelerationTimer — модульная переменная: keyup гасит
                        // именно её. Раньше таймер держала локальная at, и на
                        // отпускании кнопки он крутился ещё до своего же тика.
                        if (accelerationTimer) clearInterval(accelerationTimer);
                        accelerationTimer = setInterval(function () {
                            if (seekHoldInterval) us();
                            else { clearInterval(accelerationTimer); accelerationTimer = null; }
                        }, 200);
                    }
                    return;
                } else {
                    navigate(keyToDirection(k));
                    return;
                }
            }
            if (cv) { updateFocusableElements(); if (isKeyPressed('UP', k)) { e.preventDefault(); navigate('up'); if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer(); return; } if (isKeyPressed('DOWN', k)) { e.preventDefault(); navigate('down'); if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer(); return; } }
            if (isKeyPressed('PLAY', k) || isKeyPressed('PAUSE', k) || isKeyPressed('PLAY_PAUSE', k)) { e.preventDefault(); vp.paused ? vp.play() : vp.pause(); if (typeof window.updatePlayPauseButton === 'function') window.updatePlayPauseButton(); if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer(); return; }
            if (isKeyPressed('VOL_UP', k)) { e.preventDefault(); vp.volume = Math.min(1, vp.volume + 0.1); var vs = getEl('volume-slider'); if (vs) vs.value = vp.volume; if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer(); return; }
            if (isKeyPressed('VOL_DOWN', k)) { e.preventDefault(); vp.volume = Math.max(0, vp.volume - 0.1); var vs = getEl('volume-slider'); if (vs) vs.value = vp.volume; if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer(); return; }
            if (isKeyPressed('MUTE', k)) { e.preventDefault(); vp.muted = !vp.muted; if (typeof window.updateMuteButton === 'function') window.updateMuteButton(); if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer(); return; }
            if (isKeyPressed('RED', k)) { e.preventDefault(); var ab = getEl('audio-btn'); if (ab) ab.click(); if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer(); return; }
            if (isKeyPressed('GREEN', k)) { e.preventDefault(); var eb = getEl('episodes-btn'); if (eb) eb.click(); if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer(); return; }
            if (isKeyPressed('YELLOW', k)) { e.preventDefault(); var tb = getEl('toggle-buffer-btn'); if (tb) tb.click(); if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer(); return; }
            if (isKeyPressed('BLUE', k)) { e.preventDefault(); var eb = getEl('exit-player-btn'); if (eb) eb.click(); if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer(); return; }
            if (isKeyPressed('BACK', k) || isKeyPressed('EXIT', k)) { e.preventDefault(); if (hidePlayerUi()) { lastPlayerBackPressAt = 0; return; } var now = Date.now(); if (now - lastPlayerBackPressAt < 1500) { lastPlayerBackPressAt = 0; if (typeof window.showDetailView === 'function') window.showDetailView(); } else { lastPlayerBackPressAt = now; if (typeof window.showPlayerHint === 'function') window.showPlayerHint('Нажмите Back ещё раз для выхода'); } return; }
            if (isKeyPressed('FF', k)) { e.preventDefault(); vp.currentTime = Math.min(vp.duration, vp.currentTime + 30); if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer(); return; }
            if (isKeyPressed('REW', k)) { e.preventDefault(); vp.currentTime = Math.max(0, vp.currentTime - 30); if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer(); return; }
            if (!cv) return;
        }

        if (isKeyPressed('UP', k)) { e.preventDefault(); navigate('up'); } else if (isKeyPressed('DOWN', k)) { e.preventDefault(); navigate('down'); } else if (isKeyPressed('LEFT', k)) { e.preventDefault(); navigate('left'); } else if (isKeyPressed('RIGHT', k)) { e.preventDefault(); navigate('right'); } else if (isKeyPressed('OK', k)) { e.preventDefault(); var f = document.querySelector('.focused'); if (f) { if (f.classList.contains('file-item')) { var pb = f.querySelector('.play-btn'); if (pb) pb.click(); else f.click(); } else f.click(); } else if (focusableElements.length > 0) focusableElements[0].click(); } else if (isKeyPressed('INFO', k)) { e.preventDefault(); console.log('ℹ️ Информация:', { screen: AppState.currentScreen, platform: AppState.platform, focusIndex: currentFocusIndex, focusableCount: focusableElements.length }); }
    });
}

// ==================== LONG PRESS & FOCUS RESCUE ====================
function clearOkHold() { if (okHoldTimer) { clearTimeout(okHoldTimer); okHoldTimer = null; } }

function isElementFullyVisible(el, container) {
    if (!el || !container) return true;

    var r = el.getBoundingClientRect();
    var cr = container.getBoundingClientRect();

    // Определяем тип контейнта
    var isRowVp = !!(container.classList && container.classList.contains('catalog-row-viewport'));
    var isH = isRowVp ||
        container.id === 'files-list' ||
        container.id === 'catalog-detail-actors-wrap' ||
        container.id === 'catalog-detail-recommendations-wrap' ||
        container.id === 'catalog-detail-trailers-wrap';

    if (isH) {
        // Для горизонтальных списков проверяем горизонтальную И вертикальную видимость
        var hp = 45;  // горизонтальный отступ от краёв контейнера
        var vp = 65;  // вертикальный отступ от краёв экрана

        // По позиции ПОКОЯ, а не по текущей: см. pendingScrollDelta
        var dx = pendingScrollDeltaX(container);
        var dy = pendingScrollDelta(isRowVp ? getEl('main-container') : getEl('detail-view'));

        var isHorizVisible = (r.left - dx) >= cr.left + hp && (r.right - dx) <= cr.right - hp;
        var isVertVisible = (r.top - dy) >= vp && (r.bottom - dy) <= (window.innerHeight - vp);

        return isHorizVisible && isVertVisible;
    }

    // Для вертикальных списков проверяем вертикальную видимость
    var dv = pendingScrollDelta(container);
    return (r.top - dv) >= cr.top + 35 && (r.bottom - dv) <= cr.bottom - 35 &&
        r.left >= cr.left + 25 && r.right <= cr.right - 25;
}

// ==================== ГОРИЗОНТАЛЬНАЯ ПРОКРУТКА ====================

/**
 * Пока твин прокрутки в полёте, getBoundingClientRect отдаёт позицию «на
 * полпути» — и проверки видимости врут. Именно из-за этого при быстрых коротких
 * нажатиях анимация пропадала через шаг: очередное нажатие видело карточку уже
 * «видимой» (её дотягивал предыдущий твин), прокрутку не запускало, страница
 * замирала там, где её застали, а следующий шаг снова уезжал с анимацией.
 *
 * Поэтому запускаемые твины помечают свою цель, а решения принимаются по
 * позиции ПОКОЯ: текущая минус то, что осталось дотянуть. Пометка живёт ровно
 * длительность твина (+ небольшой запас на кадр).
 */
function markPendingScroll(el, key, value, duration) {
    if (!el) return;
    el[key] = value;
    el[key + 'Until'] = Date.now() + Math.round(duration * 1000) + 50;
}

function clearPendingScroll(el, key) {
    if (!el) return;
    el[key] = null;
    el[key + 'Until'] = 0;
}

/** Сколько ещё дотянет вертикальный твин (px, + вниз) */
function pendingScrollDelta(el) {
    if (!el || typeof el._navPendTop !== 'number') return 0;
    if (Date.now() > el._navPendTopUntil) return 0;
    return el._navPendTop - el.scrollTop;
}

/** То же по горизонтали, в координатах scrollLeft (у рядов — трансформация трека) */
function pendingScrollDeltaX(container) {
    if (!container || typeof container._navPendX !== 'number') return 0;
    if (Date.now() > container._navPendXUntil) return 0;
    return container._navPendX - getScrollX(container);
}

/**
 * Режим анимации горизонтальной прокрутки из ui-customizer: none | fast | smooth.
 * На слабых устройствах твин трека подтормаживает (gsap на время анимации поднимает
 * трек ряда — а это ~2900x490 — в слой композитора и отпускает после, и так на
 * каждое нажатие пульта), поэтому выбор оставлен пользователю. Отличать устройства
 * из кода нельзя, а поведение по умолчанию не меняется.
 *
 * Без кэша: это чтение строки пару раз на нажатие. getColumns кэшируется только
 * потому, что читает вычисленные стили — здесь инвалидация не нужна.
 *
 * @returns {string} 'none' | 'fast' | 'smooth'
 */
function getScrollAnimMode() {
    try {
        if (window.UICustomizer && typeof window.UICustomizer.getScrollAnim === 'function') {
            var mode = window.UICustomizer.getScrollAnim();
            if (mode === 'none' || mode === 'fast' || mode === 'smooth') return mode;
        }
    } catch (e) { }
    return 'smooth';
}

/** Длительность твина с поправкой на режим: none — мгновенно, fast — вдвое короче */
function scrollAnimDurationX(duration) {
    var mode = getScrollAnimMode();
    if (mode === 'none') return 0;
    if (mode === 'fast' && typeof duration === 'number') return duration * 0.5;
    return duration;
}

/**
 * Карусели рядов каталога двигаются не нативным скроллом, а трансформацией
 * внутреннего трека (.catalog-row-track, создаётся в catalog.js:createCatalogRow).
 * Причина: твин scrollLeft заставляет браузер каждый кадр пересчитывать layout
 * и перерисовывать контейнер, а translate3d обрабатывается композитором — на
 * Android TV разница заметна.
 *
 * Хелперы ниже дают единый API для обоих случаев: у карусели читается и пишется
 * трансформация трека, у остальных горизонтальных списков (files-list, актёры,
 * рекомендации, трейлеры) — по-прежнему scrollLeft. Ось направлена как у
 * scrollLeft: 0 — начало, растёт вправо, то есть x трека = -offset.
 *
 * @param {Element} container контейнер прокрутки
 * @returns {Element|null} трек карусели или null для обычного скроллера
 */
function getRowTrack(container) {
    if (!container || !container.classList) return null;
    if (!container.classList.contains('catalog-row-viewport')) return null;
    var track = container.firstElementChild;
    return (track && track.classList && track.classList.contains('catalog-row-track')) ? track : null;
}

/** Текущее смещение трека по x (px, отрицательное при сдвиге влево) */
function getTrackX(track) {
    if (typeof gsap !== 'undefined') {
        // gsap.getProperty отдаёт актуальное значение и посреди твана;
        // parseFloat — потому что в разных версиях это число либо '0px'
        var x = parseFloat(gsap.getProperty(track, 'x'));
        return isNaN(x) ? 0 : x;
    }
    return typeof track._trackX === 'number' ? track._trackX : 0;
}

/** Ставит смещение трека мгновенно */
function setTrackX(track, x) {
    if (typeof gsap !== 'undefined') {
        // Только через gsap: при прямой записи style.transform он продолжит
        // считать актуальным своё закэшированное значение
        gsap.killTweensOf(track);
        gsap.set(track, { x: x });
        return;
    }
    track._trackX = x;
    track.style.transform = 'translate3d(' + x + 'px, 0, 0)';
}

/** Смещение контейнера в координатах scrollLeft */
function getScrollX(container) {
    var track = getRowTrack(container);
    if (!track) return container.scrollLeft;
    return -getTrackX(track);
}

/** Предел смещения: нативный скролл браузер обрезает сам, трек — нет */
function getMaxScrollX(container) {
    var track = getRowTrack(container);
    if (!track) return Math.max(0, container.scrollWidth - container.clientWidth);
    // width: max-content на старом WebKit может не примениться — тогда карточки
    // вылезают за трек и реальную ширину содержимого даёт scrollWidth
    var content = Math.max(track.scrollWidth, track.offsetWidth);
    return Math.max(0, content - container.clientWidth);
}

/** Смещение без анимации (колесо мыши, фолбэк без gsap) */
function setScrollXImmediate(container, left) {
    var track = getRowTrack(container);
    clearPendingScroll(container, '_navPendX');
    if (!track) { container.scrollLeft = left; return; }
    setTrackX(track, -left);
}

/**
 * Прокрутка контейнера к позиции left (в координатах scrollLeft), с обрезкой
 * по краям — у трека нативной обрезки нет, уехал бы в пустоту.
 */
function setScrollX(container, left, smooth, duration) {
    if (!container) return;
    left = Math.max(0, Math.min(getMaxScrollX(container), left));
    duration = scrollAnimDurationX(duration);   // режим из ui-customizer

    var track = getRowTrack(container);
    if (!track) {
        if (smooth && duration > 0) markPendingScroll(container, '_navPendX', left, duration);
        else clearPendingScroll(container, '_navPendX');
        applyScroll(container, { scrollLeft: left }, smooth, duration);
        return;
    }
    if (!smooth || duration <= 0 || typeof gsap === 'undefined') {
        setScrollXImmediate(container, left);
        return;
    }
    gsap.killTweensOf(track);
    markPendingScroll(container, '_navPendX', left, duration);
    gsap.to(track, {
        x: -left,
        duration: duration,
        ease: SCROLL_SMOOTH.ease,
        overwrite: true
    });
}

/**
 * Единая точка прокрутки для навигации фокусом.
 *
 * Раньше здесь было три ветки: gsap + ScrollToPlugin, нативный
 * scrollTo({behavior:'smooth'}) и мгновенное присваивание. Плагин убран из
 * index.html (тормозил прокрутку), поэтому первая ветка больше не срабатывала,
 * а нативный плавный скролл на телевизоре не работает. Всё идёт через
 * Animations.tweenScroll: gsap тянет scrollTop/scrollLeft как обычные числовые
 * свойства, никакого плагина для этого не нужно.
 *
 * Для горизонтальной прокрутки каруселей рядов используйте setScrollX —
 * там вместо scrollLeft двигается трансформация трека.
 *
 * @param {Element} container контейнер с прокруткой
 * @param {Object}  vars      scrollTop / scrollLeft (+ любые gsap-свойства)
 * @param {boolean} smooth    false — прыжком
 * @param {number}  duration  длительность в секундах
 */
function applyScroll(container, vars, smooth, duration) {
    if (!container || !vars) return;

    var animated = smooth && typeof duration === 'number' && duration > 0;
    if (typeof vars.scrollTop === 'number') {
        if (animated) markPendingScroll(container, '_navPendTop', vars.scrollTop, duration);
        else clearPendingScroll(container, '_navPendTop');
    }

    if (typeof Animations !== 'undefined' && typeof Animations.tweenScroll === 'function') {
        Animations.tweenScroll(container, vars, {
            duration: smooth ? duration : 0,
            ease: SCROLL_SMOOTH.ease
        });
        return;
    }

    // Animations ещё не загружен — ставим позицию сразу, без анимации
    if (typeof vars.scrollTop === 'number') container.scrollTop = vars.scrollTop;
    if (typeof vars.scrollLeft === 'number') container.scrollLeft = vars.scrollLeft;
}

/**
 * Ряд-карусель — самый верхний в своём контейнере (#home-rows / #catalog-rows).
 * Нужно, чтобы фокус на первом ряду поднимал страницу ровно к нулю.
 */
function isFirstRowViewport(viewport) {
    var row = (viewport && viewport.closest) ? viewport.closest('.catalog-row') : null;
    if (!row || !row.parentElement) return false;
    var kids = row.parentElement.children;
    for (var i = 0; i < kids.length; i++) {
        if (!kids[i].classList || !kids[i].classList.contains('catalog-row')) continue;
        return kids[i] === row;   // первый .catalog-row в контейнере
    }
    return false;
}

/**
 * Карточка ряда-карусели каталога (#catalog-rows).
 *
 * Карточки главной тоже .catalog-row-card, но у них свой ключ (data-home-key)
 * и класс .home-card, а раскладкой рядов на главной заведует home.js — её
 * прокрутку трогать нельзя.
 */
function isCatalogRowCard(el) {
    if (!el || !el.classList || !el.classList.contains('catalog-row-card')) return false;
    if (el.classList.contains('home-card')) return false;
    return !!(el.dataset && el.dataset.catalogKey);
}

/** Карточка сетки категории каталога (#catalog-grid), а не ряда-карусели */
function isCatalogGridCard(el) {
    if (!el || !el.classList) return false;
    if (el.classList.contains('catalog-row-card')) return false;
    if (!el.classList.contains('torrent-card')) return false;
    var grid = getEl('catalog-grid');
    return !!(grid && grid.contains(el));
}

/** Карточка из самой верхней строки сетки (#torrents-grid / #catalog-grid) */
function isFirstRowGridCard(target) {
    if (!target || !target.closest) return false;
    var grid = target.closest('#torrents-grid, #catalog-grid');
    if (!grid) return false;
    var cols = grid.id === 'torrents-grid' ? getTorrentGridColumns() : getColumns();
    if (!cols || cols < 1) return false;

    // Каталог: смотрим на НОМЕР ЭЛЕМЕНТА, а не на позицию в DOM.
    //
    // Позиция не годится с тех пор, как сетка виртуализуется чанками
    // (catalog.js): при прокрутке вглубь первые чанки сворачиваются в распорки,
    // и первой в DOM оказывается карточка из середины каталога. По позиции она
    // считалась бы «верхним рядом», и фокус на ней уводил бы страницу в самое
    // начало. Номер элемента от сворачивания не зависит.
    //
    // Заодно это дешевле прежнего обхода grid.querySelectorAll('.torrent-card')
    // с offsetParent до совпадения — а звалось оно дважды на каждое нажатие
    // (проверка в focusEl плюс ветка в scrollToElementIfNeeded).
    if (grid.id === 'catalog-grid') {
        var n = parseInt(target.dataset.catalogIndex, 10);
        return !isNaN(n) && n < cols;
    }

    var all = grid.querySelectorAll('.torrent-card'), seen = 0;
    for (var i = 0; i < all.length; i++) {
        if (all[i] === target) return seen < cols;
        if (all[i].offsetParent !== null) seen++;
    }
    return false;
}

// Зазор под сфокусированной строкой сетки категории. 10px — ровно столько же
// оставляла прежняя прокрутка «вниз» (Animations.scrollToIfNotVisible с
// offset: 10), чтобы движение вниз на ощупь не изменилось.
var CATALOG_GRID_BOTTOM_PAD = 10;

/**
 * Сетка категории: строка под фокусом всегда прижата к НИЖНЕЙ границе.
 *
 * Раньше вниз и вверх работали по-разному, и вверх фокус «плясал»:
 *   • focusEl вообще не звал прокрутку, если элемент уже целиком виден. Идя
 *     вверх, фокус поэтому просто шагал по видимым строкам от нижней к верхней,
 *     не двигая страницу;
 *   • дойдя до верхней видимой строки, он упирался в невидимую, и только тогда
 *     запускалась прокрутка — с direction 'up', то есть прижимала строку к
 *     ВЕРХНЕЙ границе. Дальше фокус так и оставался наверху;
 *   • вдобавок при быстрых нажатиях (твин ещё в полёте) отрабатывала другая
 *     ветка — она просто доводила элемент до ближайшего края, без учёта
 *     направления. Один и тот же шаг давал разный результат.
 *
 * Теперь цель одна и считается всегда: нижний край карточки встаёт на
 * CATALOG_GRID_BOTTOM_PAD выше низа контейнера. У краёв списка цель упирается в
 * ограничители (0 и максимум прокрутки) — у первых строк это верх страницы, у
 * последних низ, иначе прижать к низу нечем.
 *
 * Считаем от позиции ПОКОЯ (pendingScrollDelta), а не от живого rect: посреди
 * твина живой прямоугольник показывает «полпути», и серия быстрых нажатий
 * получалась рваной — та же причина, что и в соседних ветках.
 */
function scrollCatalogGridCardIntoView(el, scrollContainer, smooth) {
    if (!el || !scrollContainer) return;

    var dy = pendingScrollDelta(scrollContainer);
    var restTop = scrollContainer.scrollTop + dy;          // куда встанет прокрутка
    var viewTop = scrollContainer.getBoundingClientRect().top;
    var viewBottom = viewTop + scrollContainer.clientHeight;
    var restBottom = el.getBoundingClientRect().bottom - dy;

    var target = restTop + (restBottom - (viewBottom - CATALOG_GRID_BOTTOM_PAD));
    var maxTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    target = Math.max(0, Math.min(maxTop, target));

    // Уже там (движение влево/вправо внутри строки, упор в край списка) —
    // не пересоздаём твин, иначе прокрутка каждый раз начинала разгон заново
    if (Math.abs(restTop - target) < 2) return;

    applyScroll(scrollContainer, { scrollTop: target }, smooth,
        fastNavigation ? SCROLL_SMOOTH.durationFastY : SCROLL_SMOOTH.durationY);
}

// Зазор под сфокусированным рядом. 50px — столько же оставляла прежняя ветка
// «ряд не влез снизу», чтобы движение вниз на ощупь не изменилось.
var CATALOG_ROW_BOTTOM_PAD = 50;

/**
 * Ряды-карусели каталога: ряд под фокусом всегда прижат к НИЖНЕЙ границе —
 * ровно как строка в сетке категории (scrollCatalogGridCardIntoView).
 *
 * Прежняя логика была той же несимметричной парой, что и в сетке:
 *   • ряд ушёл под липкую шапку — подтянуть его ВЕРХ под неё;
 *   • ряд не влез снизу — подтянуть его НИЗ к краю экрана;
 *   • а если ряд целиком виден, focusEl прокрутку вообще не звал.
 * Поэтому вниз ряд честно стоял у нижнего края, а вверх фокус сперва шагал по
 * видимым рядам, никуда не прокручивая, потом одним рывком прыгал под шапку.
 *
 * Целимся в .catalog-row, а не во вьюпорт карусели: вместе с карточками в кадр
 * должен попадать заголовок ряда. Горизонталь остаётся выше на setScrollX — там
 * позиция живёт в трансформации трека, и scrollLeft писать нельзя.
 *
 * @param {number} dy остаток текущего твина (pendingScrollDelta): считаем от
 *                    позиции ПОКОЯ, иначе серия быстрых нажатий рвётся
 */
function scrollCatalogRowIntoView(viewport, vertEl, dy, smooth, duration) {
    var rowEl = (viewport.closest && viewport.closest('.catalog-row')) || viewport;

    // Липкая шапка перекрывает верх контейнера, и ряд под ней формально «виден»,
    // но не читается. Ниже она задаёт предел, дальше которого ряд не уводим.
    var topPad = 0;
    var topbar = getEl('home-topbar');
    if (topbar && topbar.offsetParent !== null) topPad = topbar.offsetHeight + 10;

    var restTop = vertEl.scrollTop + dy;
    var vertTop = vertEl.getBoundingClientRect().top;
    var rowRect = rowEl.getBoundingClientRect();

    // Границы ряда в координатах прокручиваемого содержимого, от позиции покоя
    var rowTop = restTop + (rowRect.top - dy) - vertTop;
    var rowBottom = restTop + (rowRect.bottom - dy) - vertTop;

    var target = rowBottom - vertEl.clientHeight + CATALOG_ROW_BOTTOM_PAD;

    // Но не настолько, чтобы заголовок ряда уехал под липкую шапку. Сработает
    // только на ряде выше видимой области или на ряде, который сам по себе
    // выше свободной высоты экрана.
    target = Math.min(target, rowTop - topPad);

    var maxTop = Math.max(0, vertEl.scrollHeight - vertEl.clientHeight);
    target = Math.max(0, Math.min(maxTop, target));

    // Уже там (движение влево/вправо внутри ряда, упор в край списка) —
    // не пересоздаём твин, иначе прокрутка каждый раз начинает разгон заново
    if (Math.abs(restTop - target) < 2) return;

    applyScroll(vertEl, { scrollTop: target }, smooth, duration);
}

/**
 * Элементы, при фокусе на которых страница обязана стоять в самом верху:
 * кнопки липкой шапки #home-topbar и всё, что лежит в первой строке контента.
 * Иначе шапка наполовину перекрыта предыдущим рядом, а под ней виден обрезок.
 */
function isTopAnchoredTarget(target) {
    if (!target || !target.classList) return false;
    if (target.classList.contains('home-nav-btn')) return true;
    if (target.classList.contains('catalog-row-card')) {
        return isFirstRowViewport(target.closest ? target.closest('.catalog-row-viewport') : null);
    }
    return isFirstRowGridCard(target);
}

function scrollToElementIfNeeded(el, container, smooth, direction) {
    if (smooth === undefined) smooth = true;
    if (SCROLL_SMOOTH.force) smooth = true;
    if (!el || !container) return;
    var r = el.getBoundingClientRect();
    var cr = container.getBoundingClientRect();
    var isWindow = container === window || container === document.body;
    var scrollContainer = isWindow ? (window.scrollingElement || document.documentElement) : container;

    // ★ ряд-карусель
    var isRowViewport = !!(container.classList && container.classList.contains('catalog-row-viewport'));

    var isH = isRowViewport ||
        container.id === 'catalog-detail-actors-wrap' ||
        container.id === 'catalog-detail-recommendations-wrap' ||
        container.id === 'catalog-detail-trailers-wrap' ||
        container.id === 'files-list';

    if (isH) {
        var con = "";
        if (container.id === 'catalog-detail-actors-wrap' ||
            container.id === 'catalog-detail-recommendations-wrap' ||
            container.id === 'catalog-detail-trailers-wrap') {
            con = container.id.replace('-wrap', '');
            con = getEl(con);
        } else {
            con = container;
        }

        var hp = 30;

        // Позиция покоя: пока трек едет, живой rect показывал бы «уже видно»
        var dx = pendingScrollDeltaX(con);
        var isHorizVisible = (r.left - dx) >= cr.left + hp && (r.right - dx) <= cr.right - hp;

        if (!isHorizVisible) {
            // curLeft — смещение контейнера сейчас (у карусели это -x трека,
            // у обычного списка scrollLeft), r/cr уже учитывают трансформацию,
            // так что математика та же, что была с scrollLeft
            var curLeft = getScrollX(con);
            var targetLeft;
            if (direction === 'left') {
                targetLeft = curLeft + (r.left - cr.left) - hp;
            } else if (direction === 'right') {
                targetLeft = curLeft + (r.left - cr.left) - (cr.width - r.width - hp);
            } else {
                targetLeft = curLeft + (r.left - cr.left) - (cr.width / 2) + (r.width / 2);
            }
            targetLeft = Math.max(0, Math.min(getMaxScrollX(con), targetLeft));
            // Сравниваем с целью уже запущенного твина, а не с текущим
            // положением: иначе тот же самый доводчик пересоздавал бы твин
            // и прокрутка каждый раз начинала разгон заново
            var fromLeft = dx ? curLeft + dx : curLeft;
            var needsHScroll = Math.abs(fromLeft - targetLeft) > 10;
            if (needsHScroll) {
                setScrollX(con, targetLeft, smooth,
                    fastNavigation ? SCROLL_SMOOTH.durationFastX : SCROLL_SMOOTH.durationX);
            }
        }

        // Вертикальный скролл (для рядов — main-container)
        var vertEl = isRowViewport ? getEl('main-container') : getEl('detail-view');
        var vertDur = fastNavigation ? SCROLL_SMOOTH.durationFastY : SCROLL_SMOOTH.durationY;
        var dy = pendingScrollDelta(vertEl);        // сколько ещё дотянет твин
        // Первый ряд экрана — всегда самый верх страницы, а не «подтянуть на 50px»:
        // иначе под липкой шапкой остаётся полоска предыдущего скролла.
        if (vertEl && isRowViewport && isFirstRowViewport(container)) {
            // Проверяем цель, а не текущую позицию: твин к нулю уже может идти,
            // и повторный такой же твин только сбивал бы разгон
            if (vertEl.scrollTop + dy > 1) {
                applyScroll(vertEl, { scrollTop: 0 }, smooth, vertDur);
            }
            return;
        }
        // Ряды-карусели: вертикаль ведём сами (см. ниже), целясь в .catalog-row,
        // а не в вьюпорт карусели, чтобы вместе с карточками в кадр попадал
        // заголовок ряда. Горизонталь выше остаётся на setScrollX — там позиция
        // живёт в трансформации трека, и scrollLeft писать нельзя.
        if (vertEl && isRowViewport) {
            // Одна цель на оба направления: ряд у нижней границы
            // (см. scrollCatalogRowIntoView)
            scrollCatalogRowIntoView(container, vertEl, dy, smooth, vertDur);
            return;
        }
        if (vertEl) {
            var containerRect = container.getBoundingClientRect();
            var vertRect = vertEl.getBoundingClientRect();
            var containerTopRelative = containerRect.top - vertRect.top + vertEl.scrollTop;
            var containerBottomRelative = containerTopRelative + containerRect.height;
            var vertViewportTop = vertEl.scrollTop + dy;    // куда встанет прокрутка
            var vertViewportBottom = vertViewportTop + vertRect.height;
            var needsVertScroll = false;
            var targetScrollTop = vertViewportTop;

            if (containerTopRelative < vertViewportTop + 50) {
                targetScrollTop = (direction === 'up')
                    ? Math.max(0, containerTopRelative - 30)
                    : Math.max(0, containerTopRelative - 50);
                needsVertScroll = true;
            } else if (containerBottomRelative > vertViewportBottom - 50) {
                targetScrollTop = (direction === 'down')
                    ? Math.max(0, containerBottomRelative - vertRect.height + 30)
                    : Math.max(0, containerBottomRelative - vertRect.height + 50);
                needsVertScroll = true;
            }

            if (needsVertScroll) {
                targetScrollTop = Math.max(0, Math.min(targetScrollTop, vertEl.scrollHeight - vertRect.height));

                // Сравниваем с позицией покоя — тот же приём, что у горизонтали
                // выше (needsHScroll), которого здесь не было.
                //
                // Смещения 30px для direction 'up'/'down' лежат ВНУТРИ порога в
                // 50px, который эту ветку и запускает: докрутив контейнер до
                // цели, условие остаётся истинным, и следующее нажатие снова
                // заводит твин к той же самой точке. Прокрутка при этом никуда
                // не едет, но каждый раз идёт killTweensOf + новый твин — и
                // вниз это заметнее, чем вверх, потому что вниз фокус идёт по
                // рядам актёров и похожих (они сюда и попадают), а вверх
                // выходит к кнопкам панели, у которых путь другой и который
                // при видимом элементе не запускает прокрутку вовсе.
                //
                // Из твина убран backgroundColor: 'rgb(0, 0, 0)'. Чёрный фон
                // #detail-view и так выставляют при открытии — animateDetailShow
                // (animations.js) и ветка торрентной карточки (torrents.js);
                // ничто во всём проекте не красит его в другой цвет, так что
                // это была анимация из чёрного в чёрный на каждую прокрутку.
                // Полноэкранный элемент в списке анимируемых свойств не нужен.
                if (Math.abs(vertViewportTop - targetScrollTop) > 4) {
                    applyScroll(vertEl, { scrollTop: targetScrollTop }, smooth,
                        fastNavigation ? SCROLL_SMOOTH.durationFastY : SCROLL_SMOOTH.durationY);
                }
            }
        }
        return;
    } else if (container.id === 'detail-view') {
        if (el.id === 'back-from-detail' || el.id === 'catalog-watch-btn' || el.id === 'detail-progress-btn') {
            applyScroll(container, { scrollTop: 0 }, smooth, SCROLL_SMOOTH.durationY);
            return;
        }
    } else if (isTopAnchoredTarget(el)) {
        // Кнопки шапки и первая строка сетки (#torrents-grid / #catalog-grid)
        applyScroll(container, { scrollTop: 0 }, smooth, SCROLL_SMOOTH.durationY);
        return;
    } else if (isCatalogGridCard(el)) {
        // Сетка категории: строка под фокусом всегда у нижней границы,
        // одинаково вниз и вверх (см. scrollCatalogGridCardIntoView)
        scrollCatalogGridCardIntoView(el, scrollContainer, smooth);
        return;
    } else if (container.id == 'episodes-panel' || container.id == 'audio-panel' || container.id == 'subtitles-panel') {
        if (typeof Animations !== 'undefined') Animations.scrollToIfNotVisible(el, container);
    }
    if (!scrollContainer) return;
    var dyTail = pendingScrollDelta(scrollContainer);
    if (dyTail) {
        // Тот же расчёт, что в Animations.scrollToIfNotVisible, но от позиции
        // покоя: живой rect посреди твина ответил бы «элемент уже виден», шаг
        // проходил бы без прокрутки, и серия быстрых нажатий получалась рваной.
        var er = el.getBoundingClientRect();
        var viewTop = isWindow ? 0 : scrollContainer.getBoundingClientRect().top;
        var viewBot = isWindow ? window.innerHeight : viewTop + scrollContainer.clientHeight;
        var over = 0;
        if (er.top - dyTail < viewTop + 10) over = (er.top - dyTail) - (viewTop + 10);
        else if (er.bottom - dyTail > viewBot - 10) over = (er.bottom - dyTail) - (viewBot - 10);
        if (over) {
            var maxTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
            applyScroll(scrollContainer,
                { scrollTop: Math.max(0, Math.min(maxTop, scrollContainer.scrollTop + dyTail + over)) },
                smooth, fastNavigation ? SCROLL_SMOOTH.durationFastY : SCROLL_SMOOTH.durationY);
        }
        return;
    }
    Animations.scrollToIfNotVisible(el, container, {
        direction: direction,
        duration: fastNavigation ? SCROLL_SMOOTH.durationFastY : SCROLL_SMOOTH.durationY,
        ease: SCROLL_SMOOTH.ease,
        offset: 10,
        overwrite: true
    });
}

function byId(id) { return getEl(id); };

function focusEl(el, opts) {
    if (opts === undefined) opts = {};
    if (el === undefined) return;
    // Элемент уже не в документе — не трогаем текущий фокус.
    //
    // Иначе clearFocused() снимет подсветку с живой карточки, класс уйдёт на
    // оторванный узел, и document.querySelector('.focused') вернёт null: на
    // телевизоре это означает мёртвый пульт до срабатывания setupFocusRescue.
    // Приходит такое из кэшированных списков (getCatalogGridCards), когда сетку
    // между сборкой кэша и нажатием подрезала чанковая виртуализация. Пропустить
    // одно нажатие несравнимо лучше, чем потерять фокус совсем.
    if (el.isConnected === false) return false;

    clearFocused();
    el.classList.add('focused');
    trackFocusedElement(el);
    rememberScreenFocus(el);
    if (opts.nativeFocus) try { el.focus(); } catch (e) { } else blurEditor();

    var container = null;
    var s = AppState.currentScreen;
    var isFI = el.classList && el.classList.contains('file-item');
    var isAC = el.classList && el.classList.contains('catalog-actor-card');
    var isRC = el.classList && el.classList.contains('catalog-recommendation-card');
    var isTC = el.classList && el.classList.contains('catalog-trailer-card-item');
    var isRowCard = el.classList && el.classList.contains('catalog-row-card');

    // Оконная видимость каталога (catalog.js): элемент под фокусом обязан быть
    // видимым сразу, а колбэк IntersectionObserver придёт только через кадр-два
    // после сдвига скролла. Рассинхрон самоисправляется — наблюдатель пришлёт
    // своё состояние, когда элемент пересечёт границу окна.
    if ((isRowCard || (el.classList && el.classList.contains('catalog-card'))) &&
        typeof revealCatalogElement === 'function') {
        revealCatalogElement(el);
    }

    // То же самое для списка результатов поиска (оконная видимость в
    // torrents.js): карточка под фокусом обязана быть видимой сразу, не дожидаясь
    // колбэка IntersectionObserver.
    if (s === 'search' && el.classList && el.classList.contains('search-result-item') &&
        typeof window.revealSearchResultItem === 'function') {
        window.revealSearchResultItem(el);
    }

    // Панель фильтров есть только на экране поиска, а closest() — подъём по DOM
    // до самого корня на каждое перемещение фокуса. В рядах (10 × 20 карточек)
    // эти два прохода ничего не находят и стоят кадров, поэтому спрашиваем
    // только там, где ответ может быть непустым.
    var filterMainScreen = null, filterValuesScreen = null, isInFilterPanel = false;
    if (s === 'search' && el.closest) {
        filterMainScreen = el.closest('.filter-main-screen');
        filterValuesScreen = el.closest('.filter-values-screen');
        isInFilterPanel = !!(filterMainScreen || filterValuesScreen) ||
            el.id === 'filter-back-btn' || el.id === 'filter-close-btn' ||
            el.id === 'reset-filters';
    }

    // 'home' здесь обязателен из-за карточек ряда: контейнером для них должен
    // стать .catalog-row-viewport (горизонтальная доводка каруселью). Сама
    // главная по вертикали не прокручивается — баннер и ряд считаны ровно на
    // высоту экрана, поэтому #main-container для её кнопок остаётся no-op.
    if (s === 'catalog' || s === 'torrents' || s === 'config' || s === 'home') {
        var rowVp = (isRowCard && el.closest) ? el.closest('.catalog-row-viewport') : null;
        container = rowVp || getEl('main-container');
    } else if (s === 'search') {
        // ★ Если элемент внутри панели фильтров — используем контейнер панели
        if (isInFilterPanel) {
            if (filterValuesScreen) {
                container = filterValuesScreen;
            } else if (filterMainScreen) {
                container = filterMainScreen;
            } else {
                // Кнопки шапки панели (back, close, reset) — используем саму панель
                var panel = getEl('search-filters-panel');
                container = panel || getEl('search-results');
            }
        } else {
            container = getEl('search-results');
        }
    } else if (s === 'detail') {
        if (isFI) {
            container = getEl('files-list');
        } else if (isAC) {
            container = getEl('catalog-detail-actors-wrap');
            if (!container && el.closest) container = el.closest('.catalog-detail-actors-wrap');
        } else if (isRC) {
            container = getEl('catalog-detail-recommendations-wrap');
            if (!container && el.closest) container = el.closest('.catalog-detail-recommendations-wrap');
        } else if (isTC) {
            container = getEl('catalog-detail-trailers-wrap');
            if (!container && el.closest) container = el.closest('.catalog-detail-trailers-wrap');
        } else {
            container = getEl('detail-view');
        }
    } else if (s === 'player') {
        var parent = el.parentElement;
        if (parent) container = getEl(parent.id);
    }

    // Передаём direction в scrollToElementIfNeeded
    var scrollDirection = opts.direction || lastNavDirection;
    // isTopAnchoredTarget — фокус в шапке или в первой строке экрана: страницу
    // надо вернуть в ноль даже если элемент уже целиком виден.
    //
    // isCatalogGridCard / isCatalogRowCard — там позиция строки задана жёстко
    // (у нижней границы), поэтому проверка видимости не годится: пока фокус
    // идёт вверх по уже видимым строкам, она возвращала «прокрутка не нужна»,
    // страница стояла на месте, и строка уезжала от нижнего края к верхнему.
    // Решение принимают сами scrollCatalogGridCardIntoView /
    // scrollCatalogRowIntoView — если двигаться некуда, они выходят.
    if (container && !isElementFullyVisible(el, container) || el.id === 'back-from-detail' ||
        el.id === 'catalog-watch-btn' || isTopAnchoredTarget(el) ||
        isCatalogGridCard(el) || isCatalogRowCard(el)) {
        scrollToElementIfNeeded(
            el,
            container,
            SCROLL_SMOOTH.force ? true : !fastNavigation,
            scrollDirection
        );
    }
    return true;
}

function showPlayerControls(preferredFocusId) {
    if (preferredFocusId === undefined) preferredFocusId = 'play-pause-btn';
    var ids = ['controls-container', 'buffer-stats', 'player-hint', 'toggle-buffer-btn', 'exit-player-btn', 'episodes-btn', 'prev-episode-btn', 'next-episode-btn', 'audio-btn', 'subtitles-btn', 'player-title'];
    for (var i = 0; i < ids.length; i++) { var e = getEl(ids[i]); if (e) e.classList.remove('idle-hidden'); }
    if (typeof window.syncPlayerTitleVisibility === 'function') window.syncPlayerTitleVisibility(true);
    var pt = getEl('player-title'); if (pt) pt.classList.remove('hidden');
    if (typeof Animations !== 'undefined') Animations.animateControlsShow();
    if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();

    setTimeout(function () {
        var ep = getEl('episodes-panel');
        var ap = getEl('audio-panel');
        var sp = getEl('subtitles-panel');
        var isPanelOpen = (ep && !ep.classList.contains('hidden')) ||
            (ap && !ap.classList.contains('hidden')) ||
            (sp && !sp.classList.contains('hidden'));

        // ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА: есть ли элемент с классом focused внутри открытой панели
        var hasPanelFocus = false;
        if (isPanelOpen) {
            var panelFocused = (ep && ep.querySelector('.focused')) ||
                (ap && ap.querySelector('.focused')) ||
                (sp && sp.querySelector('.focused'));
            hasPanelFocus = !!panelFocused;
        }

        // Если панель открыта И в ней есть элемент с фокусом - не трогаем
        if (isPanelOpen && hasPanelFocus) {
            return;
        }

        // Если панель открыта, но фокуса в ней нет - всё равно не трогаем
        // (возможно, focusActivePanelItem еще не успел установить фокус)
        if (isPanelOpen) {
            return;
        }

        updateFocusableElements();
        var ti = -1;
        for (var j = 0; j < focusableElements.length; j++) {
            if (focusableElements[j].id === preferredFocusId) {
                ti = j;
                break;
            }
        }
        setFocus(ti !== -1 ? ti : 0);
    }, 150); // Увеличиваем задержку до 150мс
}

function hidePlayerControls() {
    if (typeof Animations !== 'undefined') Animations.animateControlsHide();
    var ids = ['controls-container', 'buffer-stats', 'player-hint', 'toggle-buffer-btn', 'exit-player-btn', 'episodes-btn', 'prev-episode-btn', 'next-episode-btn', 'audio-btn', 'subtitles-btn', 'player-title'];
    for (var i = 0; i < ids.length; i++) { var e = getEl(ids[i]); if (e) e.classList.add('idle-hidden'); }
    if (typeof window.syncPlayerTitleVisibility === 'function') window.syncPlayerTitleVisibility(false);
    var pt = getEl('player-title'); if (pt) pt.classList.add('hidden');
    var focused = document.querySelectorAll('.focused');
    for (var j = 0; j < focused.length; j++) focused[j].classList.remove('focused');
    currentFocusIndex = 0;
    if (window.mouseIdleTimer) { clearTimeout(window.mouseIdleTimer); window.mouseIdleTimer = null; }
}

function hidePlayerPanelsOnly() {
    var hidden = false;
    var ep = getEl('episodes-panel'); if (ep && !ep.classList.contains('hidden')) { ep.classList.add('hidden'); var b = getEl('episodes-btn'); if (b) b.classList.remove('active'); hidden = true; }
    var ap = getEl('audio-panel'); if (ap && !ap.classList.contains('hidden')) { ap.classList.add('hidden'); var b = getEl('audio-btn'); if (b) b.classList.remove('active'); hidden = true; }
    var sp = getEl('subtitles-panel'); if (sp && !sp.classList.contains('hidden')) { sp.classList.add('hidden'); var b = getEl('subtitles-btn'); if (b) b.classList.remove('active'); hidden = true; }
    return hidden;
}

function hidePlayerUi() { var p = hidePlayerPanelsOnly(); var c = isPlayerControlsVisible(); if (c) hidePlayerControls(); var pt = getEl('player-title'); if ((p || c) && pt) pt.classList.add('hidden'); return p || c; }

function openSearchScreen(fi) {
    if (fi === undefined) fi = true;
    clickEl(getEl('tab-search') || getEl('search-btn'));
    setTimeout(function () {
        ScreenStrategies.search.ensureFocus(true, fi);
        if (fi) {
            var q = getEl('search-query');
            focusEl(q, { nativeFocus: true });
            try { if (q && q.click) q.click(); } catch (e) { }
            try { if (q && q.select) q.select(); } catch (e) { }
        }
    }, 120);
}

function leaveSearchToTorrents() {
    if (typeof window.hideSearchResults === 'function') window.hideSearchResults();
    else { clickEl(getEl('close-search') || getEl('tab-torrents')); setTimeout(function () { var rt = (window.AppState && AppState.searchReturnTo === 'catalog') ? 'catalog' : 'torrents'; if (rt === 'catalog') ScreenStrategies.catalog.ensureFocus(true); else ScreenStrategies.torrents.ensureFocus(true); }, 150); }
}

function closeFilterPanel() {
    var panel = getEl('search-filters-panel');
    var toggleBtn = getEl('filter-toggle');
    var overlay = getEl('filter-overlay');
    if (panel) {
        panel.classList.remove('active');
        if (toggleBtn) toggleBtn.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
        invalidateFocusCache();
        setTimeout(function () {
            updateFocusableElements();
            if (toggleBtn && toggleBtn.offsetParent !== null) {
                focusEl(toggleBtn);
            } else {
                var q = getEl('search-query');
                if (q) focusEl(q);
            }
        }, 200);
    }
}

function openFilterPanelAndFocus() {
    var panel = getEl('search-filters-panel');
    var toggleBtn = getEl('filter-toggle');
    var overlay = getEl('filter-overlay');

    if (panel) {
        panel.classList.add('active');
        if (toggleBtn) toggleBtn.classList.add('active');
        if (overlay) overlay.classList.add('active');

        // ★ Инвалидируем кэш и фокусируемся
        invalidateFocusCache();
        setTimeout(function () {
            updateFocusableElements();
            var closeBtn = getEl('filter-close-btn');
            if (closeBtn && VISIBLE(closeBtn)) {
                focusEl(closeBtn);
            } else {
                var firstItem = panel.querySelector('.filter-item');
                if (firstItem) focusEl(firstItem);
            }
        }, 150);
    }
}

function scrollToActiveConfigItem() { var ai = document.querySelector('#config-screen .focused'), cs = document.querySelector('#config-screen'), it = getConfigItems(); if (!ai || !cs) return; var sc = cs; while (sc && sc.scrollHeight <= sc.clientHeight) { sc = sc.parentElement; if (!sc || sc === document.body) { sc = window; break; } } var iw = (sc === window), cur = iw ? window.scrollY : sc.scrollTop, ci = -1; for (var i = 0; i < it.length; i++) if (ai === it[i]) { ci = i; break; } var ar = ai.getBoundingClientRect(), ct = iw ? 0 : sc.getBoundingClientRect().top, ot = ar.top - ct; if (ci === it.length - 2) { if (iw) window.scrollTo(0, document.body.scrollHeight - window.innerHeight); else sc.scrollTop = sc.scrollHeight - sc.clientHeight; return; } if (ci === 1) { if (iw) window.scrollTo(0, 0); else sc.scrollTop = 0; return; } var ch = iw ? window.innerHeight : sc.clientHeight; if (ot < 0) { var ns = cur + ot - 10; if (iw) window.scrollTo(0, ns); else sc.scrollTop = ns; } else if (ot + ar.height > ch) { var ns = cur + (ot + ar.height - ch) + 10; if (iw) window.scrollTo(0, ns); else sc.scrollTop = ns; } }

function handleConfigNavigation(dir) {
    if (currentScreen() !== 'config') return false;
    var menuItems = getConfigMenuItems();
    var currentFocused = document.querySelector('.focused');
    if (!currentFocused) { ScreenStrategies.config.ensureFocus(true); return true; }
    var isOnMenu = false;
    var currentMenuIndex = -1;
    for (var i = 0; i < menuItems.length; i++) {
        if (currentFocused === menuItems[i]) { isOnMenu = true; currentMenuIndex = i; break; }
    }
    if (isOnMenu) {
        if (dir === 'up') {
            if (currentMenuIndex > 0) {
                var targetIndex = currentMenuIndex - 1;
                var targetMenuItem = menuItems[targetIndex];
                var targetTabId = targetMenuItem.id;
                configState.activeTabId = targetTabId;
                switchConfigTab(targetTabId);
                setConfigMenuActive(targetTabId);
                return focusEl(targetMenuItem);
            }
            return true;
        }
        if (dir === 'down') {
            if (currentMenuIndex < menuItems.length - 1) {
                var targetIndex = currentMenuIndex + 1;
                var targetMenuItem = menuItems[targetIndex];
                var targetTabId = targetMenuItem.id;
                configState.activeTabId = targetTabId;
                switchConfigTab(targetTabId);
                setConfigMenuActive(targetTabId);
                return focusEl(targetMenuItem);
            }
            return true;
        }
        if (dir === 'left' || dir === 'right') return true;
        if (dir === 'enter') {
            var selectedTabId = currentFocused.id;
            configState.activeTabId = selectedTabId;
            configState.isOnMenu = false;
            setConfigMenuActive(selectedTabId);
            switchConfigTab(selectedTabId);
            var contentItems = getConfigContentItems(selectedTabId);
            if (contentItems.length > 0) return focusEl(contentItems[0]);
            return true;
        }
        if (dir === 'back') return true;
    } else {
        var contentItems = getConfigContentItems(configState.activeTabId);
        var currentContentIndex = -1;
        for (var i = 0; i < contentItems.length; i++) {
            if (currentFocused === contentItems[i]) { currentContentIndex = i; break; }
        }
        if (dir === 'up') { if (currentContentIndex > 0) return focusEl(contentItems[currentContentIndex - 1]); return true; }
        if (dir === 'down') { if (currentContentIndex < contentItems.length - 1 && currentContentIndex !== -1) return focusEl(contentItems[currentContentIndex + 1]); return true; }
        if (dir === 'left' || dir === 'right') return true;
        if (dir === 'enter') {
            if (currentFocused) {
                var isTextInput = (currentFocused.tagName === 'INPUT' && currentFocused.type !== 'checkbox') || currentFocused.tagName === 'TEXTAREA' || currentFocused.isContentEditable;
                if (isTextInput) { if (document.activeElement === currentFocused) currentFocused.blur(); else currentFocused.focus(); }
                else { if (typeof currentFocused.click === 'function') currentFocused.click(); }
            }
            return true;
        }
        if (dir === 'back') { configState.isOnMenu = true; return focusEl(getEl(configState.activeTabId)); }
    }
    return false;
}

function switchConfigTab(tabId) {
    var tabContents = document.querySelectorAll('.tab-content');
    for (var i = 0; i < tabContents.length; i++) tabContents[i].style.display = 'none';
    var selectedTab = getEl(tabId + '-content');
    if (selectedTab) selectedTab.style.display = 'block';
}

function setConfigMenuActive(menuItemId) {
    var menuItems = getConfigMenuItems();
    for (var i = 0; i < menuItems.length; i++) {
        if (menuItems[i].id === menuItemId) menuItems[i].classList.add('active');
        else menuItems[i].classList.remove('active');
    }
}

// ==================== CUSTOM FILTER MENU ====================
function ensureCustomFilterMenu() { var m = getEl('custom-filter-menu'); if (m) return m; m = document.createElement('div'); m.id = 'custom-filter-menu'; m.className = 'custom-filter-menu hidden'; m.innerHTML = '<div class="custom-filter-menu-backdrop"></div><div class="custom-filter-menu-panel"><div class="custom-filter-menu-title" id="custom-filter-menu-title">Выбор</div><div class="custom-filter-menu-options" id="custom-filter-menu-options"></div></div>'; document.body.appendChild(m); var bd = m.querySelector('.custom-filter-menu-backdrop'); if (bd) bd.addEventListener('click', closeCustomFilterMenu); return m; }
function renderCustomFilterMenu() {
    var m = ensureCustomFilterMenu(), te = getEl('custom-filter-menu-title'), oe = getEl('custom-filter-menu-options');
    if (!customFilterMenuState || !te || !oe) return;
    te.textContent = customFilterMenuState.title || 'Выбор';
    var html = [], opts = customFilterMenuState.options;
    for (var i = 0; i < opts.length; i++) {
        var o = opts[i], cls = (i === customFilterMenuState.index) ? 'custom-filter-option active' : 'custom-filter-option', sel = (String(o.value) === String(customFilterMenuState.value)) ? ' ✓' : '';
        html.push('<div class="' + cls + '" data-index="' + i + '">' + o.label + sel + '</div>');
    }
    oe.innerHTML = html.join('');
    setTimeout(scrollToActiveFilterOption, 10);
}
function closeCustomFilterMenu() { var m = getEl('custom-filter-menu'); if (m) m.classList.add('hidden'); customFilterMenuState = null; return true; }
function scrollToActiveFilterOption() { var ao = document.querySelector('.custom-filter-option.active'), oc = getEl('custom-filter-menu-options'); if (!ao || !oc) return; var cr = oc.getBoundingClientRect(), or = ao.getBoundingClientRect(), st = oc.scrollTop, ot = or.top - cr.top; if (ot < 0) oc.scrollTop = st + ot - 10; else if (ot + or.height > cr.height) oc.scrollTop = st + (ot + or.height - cr.height) + 10; }
function moveCustomFilterMenu(d) { if (!customFilterMenuState || !customFilterMenuState.options.length) return true; var l = customFilterMenuState.options.length, n = customFilterMenuState.index + d; if (n < 0 || n >= l) return true; customFilterMenuState.index = n; renderCustomFilterMenu(); setTimeout(scrollToActiveFilterOption, 10); return true; }
function applyCustomFilterMenuSelection() { if (!customFilterMenuState || !customFilterMenuState.selectEl) return false; var s = customFilterMenuState.selectEl, o = customFilterMenuState.options, i = customFilterMenuState.index, c = o[i]; if (!c) return false; s.value = String(c.value); try { var e = document.createEvent('Event'); e.initEvent('change', true, true); s.dispatchEvent(e); } catch (e) { } if (typeof window.getCurrentSearchMode === 'function') window.getCurrentSearchMode(); closeCustomFilterMenu(); try { focusEl(s); } catch (e) { } return true; }
function isCustomFilterMenuOpen() { var m = getEl('custom-filter-menu'); return !!(m && !m.classList.contains('hidden') && customFilterMenuState); }
function openNativeSearchControl(el) {
    if (!VISIBLE(el)) return false;
    if (el.tagName === 'SELECT') {
        var fg = el.closest('.filter-group'), tl = fg ? fg.querySelector('.filter-label') : null, t = (tl && tl.textContent ? tl.textContent.trim() : 'Выбор'), o = [];
        for (var i = 0; i < el.options.length; i++) o.push({ value: el.options[i].value, label: el.options[i].textContent || el.options[i].label || el.options[i].value });
        var idx = 0; for (var j = 0; j < o.length; j++) if (String(o[j].value) === String(el.value)) { idx = j; break; } if (idx < 0) idx = 0;
        customFilterMenuState = { selectEl: el, title: t, options: o, index: idx, value: el.value }; var m = ensureCustomFilterMenu(); m.classList.remove('hidden'); renderCustomFilterMenu(); return true;
    }
    focusEl(el, { nativeFocus: true }); try { el.focus(); } catch (e) { } try { el.click(); } catch (e) { } return true;
}

// ==================== FOCUS RESCUE ====================
function setupFocusRescue() {
    window.focusFirstTorrentCard = function () { return ScreenStrategies.torrents.ensureFocus(true); };
    window.focusFirstCatalogCard = function () { return ScreenStrategies.catalog.ensureFocus(true); };
    window.focusSearchHome = function (p) { if (p === undefined) p = true; return ScreenStrategies.search.ensureFocus(true, p); };
    window.ensureCatalogFocus = ScreenStrategies.catalog.ensureFocus;
    window.ensureDetailFocus = ScreenStrategies.detail.ensureFocus;
    window.ensureTorrentFocus = ScreenStrategies.torrents.ensureFocus;
    window.ensureSearchFocus = ScreenStrategies.search.ensureFocus;
    window.ensureConfigFocus = ScreenStrategies.config.ensureFocus;

    document.addEventListener('keydown', function (e) {
        var s = currentScreen();
        if (s === 'player') return;
        if (['home', 'torrents', 'catalog', 'search', 'detail', 'config', 'donate'].indexOf(s) === -1) return;
        var a = document.activeElement, ed = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
        if (isBackKey(e.keyCode)) {
            if (ed) {
                var isEmpty = false;
                if (a.tagName === 'SELECT') { isEmpty = (a.selectedIndex === -1 || a.value === ''); }
                else { isEmpty = (a.value === '' || a.value === null); }
                if (!isEmpty && e.keyCode != 27) return;
                else { a.blur(); return; }
            }
            e.preventDefault();
            e.stopImmediatePropagation();
            var po = getEl('playback-overlay'), ip = po && po.classList.contains('active');
            if (ip) { cancelCurrentPlayback(); return; }
            if (isCustomFilterMenuOpen()) { closeCustomFilterMenu(); return; }
            if (s === 'catalog' && window.catalogState && window.catalogState.currentCatalog) { window.catalogState.lastSelectedIndex = 0; window.catalogState.lastSelectedId = null; localStorage.removeItem('lastCatalogCardIndex'); }
            if (ed) { blurEditor(); if (s === 'search') ScreenStrategies.search.ensureFocus(true, true); else if (s === 'catalog') ScreenStrategies.catalog.ensureFocus(true); else if (s === 'config') ScreenStrategies.config.ensureFocus(true); else if (s === 'detail') ScreenStrategies.detail.ensureFocus(true); else ScreenStrategies.torrents.ensureFocus(true); return; }
            onBack();
            return;
        }
        if (isArrowKey(e.keyCode)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            var d = arrowDir(e.keyCode);
            if (isCustomFilterMenuOpen()) { if (d === 'up') moveCustomFilterMenu(-1); else if (d === 'down') moveCustomFilterMenu(1); return; }
            // Ряды каталога и главной идут сюда, а не через navigate(), поэтому
            // флаг быстрой навигации взводим здесь: на нём висит откладывание
            // постеров в catalog.js (вставка карточки посреди твина = фриз).
            navKeyRepeat = !!e.repeat;
            setFastNavigation(d);
            var strategy = ScreenStrategies[s];
            if (strategy && strategy.handleNavigation) strategy.handleNavigation(d);
            return;
        }
        if (isOkKey(e.keyCode)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (isCustomFilterMenuOpen()) { applyCustomFilterMenuSelection(); return; }
            if (s === 'torrents') {
                var f = document.querySelector('.focused');
                if (f && f.classList.contains('torrent-card')) {
                    if (!e.repeat) {
                        okHoldHandled = false;
                        okHoldFocused = f;
                        clearOkHold();
                        okHoldTimer = setTimeout(async function () {
                            okHoldHandled = true;
                            var h = okHoldFocused && okHoldFocused.dataset ? okHoldFocused.dataset.hash : null;
                            if (typeof window.setTorrentClickSuppressed === 'function') window.setTorrentClickSuppressed(1500);
                            if (okHoldFocused) okHoldFocused.dataset.suppressClick = '1';
                            if (h && typeof window.removeTorrentByHash === 'function') await window.removeTorrentByHash(h, { skipConfirm: true });
                            setTimeout(function () { if (okHoldFocused) delete okHoldFocused.dataset.suppressClick; }, 1500);
                        }, OK_HOLD_DELETE_MS);
                    }
                    return;
                }
            }
            onOk();
            return;
        }
    }, true);

    var prevShow = window.showDetail;
    if (typeof prevShow === 'function') {
        window.showDetail = function () {
            var o = prevShow.apply(this, arguments);
            setTimeout(function () { if (currentScreen() !== 'player') ScreenStrategies.detail.ensureFocus(true); }, 220);
            return o;
        };
    }

    var prevSR = window.showSearchResults;
    if (typeof prevSR === 'function') {
        window.showSearchResults = function () {
            var o = prevSR.apply(this, arguments);
            setTimeout(function () { ScreenStrategies.search.ensureFocus(true, true); }, 120);
            return o;
        };
    }

    setTimeout(function () { ScreenStrategies.torrents.ensureFocus(true); }, 120);

    window.handleConfigNavigation = handleConfigNavigation;
    window.getConfigMenuItems = getConfigMenuItems;
    window.getTorrentTabs = getTorrentTabs;
    window.switchConfigTab = switchConfigTab;
    window.setConfigMenuActive = setConfigMenuActive;
}

window.addEventListener('popstate', function (e) {
    if (window.swipeBlocked) return;
    var now = Date.now();
    if (now - lastPopStateTime < 500) return;
    lastPopStateTime = now;
    if (isProcessingBack) return;
    isProcessingBack = true;
    e.preventDefault();
    e.stopPropagation();
    var be = new KeyboardEvent('keydown', {
        keyCode: 27,
        key: 'Escape',
        bubbles: true,
        cancelable: true
    });
    document.dispatchEvent(be);
    setTimeout(function () {
        window.history.pushState({ page: 'main' }, '');
        setTimeout(function () {
            isProcessingBack = false;
        }, 300);
    }, 150);
});

window.history.pushState({ page: 'main' }, '');
window.blockSwipe = function (ms) {
    window.swipeBlocked = true;
    setTimeout(function () {
        window.swipeBlocked = false;
    }, ms || 500);
};

// ==================== УПРАВЛЕНИЕ ГРОМКОСТЬЮ КОЛЕСОМ МЫШИ ====================
function setupPlayerWheelControl() {
    var STEP = 0.02; // Шаг 2%
    var lastWheelTime = 0;
    var WHEEL_THROTTLE = 50; // Минимальный интервал между обработками (мс)

    document.addEventListener('wheel', function (e) {
        // Работаем только на экране плеера
        if (!AppState || AppState.currentScreen !== 'player') return;

        // Throttling - не обрабатываем слишком частые события
        var now = Date.now();
        if (now - lastWheelTime < WHEEL_THROTTLE) return;
        lastWheelTime = now;

        // Предотвращаем скролл страницы
        e.preventDefault();

        var videoPlayer = getEl('video-player');
        var volumeSlider = getEl('volume-slider');

        if (!videoPlayer) return;

        // Определяем направление: вверх = громче, вниз = тише
        var delta = e.deltaY < 0 ? STEP : -STEP;

        // Получаем текущую громкость
        var currentVolume = videoPlayer.volume;
        var newVolume = currentVolume + delta;

        // Ограничиваем диапазон [0, 1]
        newVolume = Math.max(0, Math.min(1, newVolume));

        // Округляем до 2 знаков
        newVolume = Math.round(newVolume * 100) / 100;

        // Применяем новую громкость
        videoPlayer.volume = newVolume;

        // Обновляем ползунок
        if (volumeSlider) {
            volumeSlider.value = newVolume;
        }

        // Если громкость > 0 и видео было замьючено - размьючиваем
        if (newVolume > 0 && videoPlayer.muted) {
            videoPlayer.muted = false;
            if (typeof window.updateMuteButton === 'function') {
                window.updateMuteButton();
            }
        }

        // Сбрасываем таймер скрытия UI
        if (typeof window.resetMouseIdleTimer === 'function') {
            window.resetMouseIdleTimer();
        }

        // Сохраняем в localStorage
        try {
            localStorage.setItem('playerVolume', newVolume);
        } catch (err) { /* ignore */ }

    }, { passive: false }); // passive: false необходим для preventDefault
}

// ==================== УПРАВЛЕНИЕ МЫШЬЮ ====================
function setupMouseControls() {
    document.addEventListener('contextmenu', function (e) {
        // Не блокируем контекстное меню в полях ввода
        var target = e.target;
        if (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable) {
            return;
        }

        // Предотвращаем стандартное контекстное меню
        e.preventDefault();
        e.stopPropagation();

        // Вызываем функцию "Назад"
        onBack();

        return false;
    });
}

// ==================== НАВИГАЦИЯ ПО РЯДАМ-КАРУСЕЛЯМ (новый вид каталога) ====================

// Режим рядов: открыт список каталогов (не конкретный каталог) и ряды видимы.
// Проверять только наличие .catalog-row нельзя: после разделения экранов ряды
// остаются в DOM и пока открыта категория (и пока идёт затухание при возврате).
function isCatalogRowsMode() {
    if (window.catalogState.currentCatalog) return false;
    var row = document.querySelector('#catalog-rows .catalog-row');
    return !!row && VISIBLE(row);
}

// Массив массивов видимых карточек: rows[ряд][колонка]
function getCatalogRows() {
    // Кэш по поколению DOM: handleRowsNavigation зовёт эту функцию на каждое
    // нажатие стрелки, а обход — querySelectorAll по рядам плюс offsetParent
    // на каждой из ~90 карточек. isConnected — страховка от пропущенной
    // инвалидации: если контейнер рядов переписали, кэш отбрасываем.
    if (_rowsCache.gen === _focusGen && _rowsCache.rows &&
        _rowsCache.rows.length > 0 && _rowsCache.rows[0][0] &&
        _rowsCache.rows[0][0].isConnected !== false) {
        return _rowsCache.rows;
    }

    var rows = [];
    var rowEls = document.querySelectorAll('#catalog-rows .catalog-row');
    for (var i = 0; i < rowEls.length; i++) {
        var cards = rowEls[i].querySelectorAll('.catalog-row-card');
        if (!cards.length) cards = rowEls[i].querySelectorAll('.torrent-card'); // фолбэк
        var visible = [];
        for (var j = 0; j < cards.length; j++) if (VISIBLE(cards[j])) visible.push(cards[j]);
        if (visible.length > 0) rows.push(visible);
    }

    _rowsCache.gen = _focusGen;
    _rowsCache.rows = rows;

    return rows;
}

function getCatalogRowHeaders() {
    var headers = document.querySelectorAll('#catalog-rows .catalog-row-header');
    var visible = [];
    for (var i = 0; i < headers.length; i++) if (VISIBLE(headers[i])) visible.push(headers[i]);
    return visible;
}

function focusRowHeader(ri) {
    var headers = getCatalogRowHeaders();
    if (!headers[ri]) return true;
    var header = headers[ri];
    // invalidateFocusCache() здесь не нужен: перемещение фокуса DOM не меняет,
    // а вызов гарантированно сбрасывал кэш прямо перед updateFocusableElements().
    updateFocusableElements();
    var idx = focusableElements.indexOf(header);
    if (idx !== -1) setFocus(idx);
    else focusEl(header);
    return true;
}

// Позиция карточки в рядах
function findRowPosition(el, rows) {
    for (var i = 0; i < rows.length; i++) {
        for (var j = 0; j < rows[i].length; j++) {
            if (rows[i][j] === el) return { row: i, col: j };
        }
    }
    return null;
}

// Горизонтальный скролл карусели к карточке
function scrollRowToCard(card) {
    var viewport = card.closest ? card.closest('.catalog-row-viewport') : null;
    if (!viewport) return;
    var cr = card.getBoundingClientRect();
    var vr = viewport.getBoundingClientRect();
    var pad = 50;
    var cur = getScrollX(viewport);
    var target = null;
    if (cr.left < vr.left + pad) target = cur + (cr.left - vr.left - pad);
    else if (cr.right > vr.right - pad) target = cur + (cr.right - vr.right + pad);
    if (target === null) return;
    // Через setScrollX (двигает трек карусели трансформацией и сам обрезает по
    // краям), а не scrollBy({behavior:'smooth'}): нативный плавный скролл на
    // телевизоре не работает, а ScrollToPlugin убран из index.html.
    setScrollX(viewport, target, true, SCROLL_SMOOTH.durationX);
}

// Фокус карточки в ряду + скролл карусели
function focusRowCard(ri, ci, rows) {
    if (!rows || !rows[ri] || !rows[ri][ci]) return true;
    var card = rows[ri][ci];
    // invalidateFocusCache() здесь не нужен — см. focusRowHeader
    updateFocusableElements();
    var idx = focusableElements.indexOf(card);
    if (idx !== -1) setFocus(idx);
    else focusEl(card);
    return true;
}

// Навигация по рядам (←/→ внутри ряда, ↑/↓ между рядами)
function handleRowsNavigation(dir) {
    lastNavDirection = dir;
    var rows = getCatalogRows();
    if (!rows.length) return false;
    var f = (belongsToScreen(document.querySelector('.focused'), 'catalog') ? document.querySelector('.focused') : null);
    var h = getTorrentHeader(), t = getTorrentTabs();
    if (!f) return focusRowCard(0, 0, rows);

    // Фокус на карточке ряда
    var pos = findRowPosition(f, rows);
    if (pos) {
        if (dir === 'left') {
            if (pos.col > 0) return focusRowCard(pos.row, pos.col - 1, rows);
            return true; // левый край — стоим
        }
        if (dir === 'right') {
            if (pos.col < rows[pos.row].length - 1) return focusRowCard(pos.row, pos.col + 1, rows);
            return true; // правый край («Показать все») — стоим
        }
        if (dir === 'up') {
            if (pos.row > 0) {
                var tc = Math.min(pos.col, rows[pos.row - 1].length - 1);
                return focusRowCard(pos.row - 1, tc, rows);
            }
            return focusEl(t[0] || h[0] || f); // верхний ряд → на табы
        }
        if (dir === 'down') {
            if (pos.row < rows.length - 1) {
                var tc2 = Math.min(pos.col, rows[pos.row + 1].length - 1);
                return focusRowCard(pos.row + 1, tc2, rows);
            }
            return true; // последний ряд — стоим
        }
        return true;
    }

    // Фокус на табах
    var ti = -1;
    for (var i = 0; i < t.length; i++) if (f === t[i]) { ti = i; break; }
    if (ti !== -1) {
        if (dir === 'left') return focusEl(t[Math.max(0, ti - 1)] || f);
        if (dir === 'right') return focusEl(t[Math.min(t.length - 1, ti + 1)] || f);
        if (dir === 'down') return focusRowCard(0, 0, rows);
        if (dir === 'up') return focusEl(h[Math.min(ti, h.length - 1)] || h[0] || f);
        return true;
    }

    // Фокус на шапке (настройки)
    var hi = -1;
    for (var i = 0; i < h.length; i++) if (f === h[i]) { hi = i; break; }
    if (hi !== -1) {
        if (dir === 'left') return focusEl(h[Math.max(0, hi - 1)] || f);
        if (dir === 'right') return focusEl(h[Math.min(h.length - 1, hi + 1)] || f);
        if (dir === 'down') return focusRowCard(0, 0, rows);
        return true;
    }

    // Фокус вне рядов — на первую карточку
    return focusRowCard(0, 0, rows);
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
function initControl() {
    if (window.gsap && window.ScrollToPlugin && gsap.registerPlugin) {
        gsap.registerPlugin(ScrollToPlugin);
    }
    setupKeyboardHandlers();
    setupFocusRescue();
    setupPlayerWheelControl();
    setupMouseControls();
    window.updateFocusableElements = updateFocusableElements;
    window.setFocus = setFocus;
    window.navigate = navigate;
    window.showPlayerControls = showPlayerControls;
    window.hidePlayerControls = hidePlayerControls;
    window.hidePlayerPanelsOnly = hidePlayerPanelsOnly;
    window.hidePlayerUi = hidePlayerUi;
    window.focusFirstTorrentCard = focusFirstTorrentCard;
    window.focusSearchHome = focusSearchHome;
    window.focusEl = focusEl;
    window.invalidateFocusCache = invalidateFocusCache;
    window.showSeekOverlay = showSeekOverlay;
    window.hideSeekOverlay = hideSeekOverlay;
    window.scheduleHideSeekOverlay = scheduleHideSeekOverlay;
    window.openNativeSearchControl = window.openNativeSearchControl || function (el) { if (el && (el.tagName === 'SELECT' || el.id === 'filter-year')) { el.focus(); try { el.click(); } catch (e) { } } };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initControl); else initControl();

/**
 * Горизонтальная прокрутка списков колесом мыши и пальцем.
 *
 * Слушатели делегированы на document. Раньше wheel вешался на каждый
 * найденный контейнер один раз на DOMContentLoaded — то есть до того, как
 * появились ряды главной и каталога (они строятся асинхронно и пересобираются
 * при обновлении подборок), поэтому в рядах колесо не работало вовсе.
 *
 * Пальцем ряды тоже не двигались: у карусели .catalog-row-viewport
 * overflow: hidden, позиция живёт в трансформации трека — нативного скролла,
 * который браузер мог бы подхватить, там просто нет. Отсюда ручной драг.
 */
(function () {
    var H_SCROLL_SELECTOR = '.files-list, ' +
        '.catalog-detail-actors-grid, ' +
        '.catalog-detail-recommendations-grid, ' +
        '.catalog-row-viewport, ' +
        '.catalog-row';

    // Столько же, сколько APP_CONSTANTS.TOUCH_MOVE_THRESHOLD_PX в app.js: до
    // этого порога касание там ещё считается тапом и открывает карточку,
    // так что раньше начинать драг нельзя — уедет ряд и откроется фильм
    var TOUCH_AXIS_THRESHOLD = 10;
    var FLING_MS = 140;      // насколько ряд пролетает по инерции после свайпа
    var FLING_IDLE_MS = 80;  // палец постоял перед отрывом — инерции нет

    /** Состояние догона кадрами держим на самом элементе: слушатель один на всех */
    function state(cnt) {
        if (!cnt._hScroll) cnt._hScroll = { target: getScrollX(cnt), rafId: null };
        return cnt._hScroll;
    }

    function clampX(cnt, value) {
        return Math.max(0, Math.min(getMaxScrollX(cnt), value));
    }

    function stopGlide(cnt) {
        var st = state(cnt);
        if (st.rafId) { cancelAnimationFrame(st.rafId); st.rafId = null; }
    }

    function step(cnt) {
        var st = state(cnt);
        var current = getScrollX(cnt);
        var diff = st.target - current;

        if (Math.abs(diff) < 0.6) {
            setScrollXImmediate(cnt, st.target);
            st.rafId = null;
            return;
        }

        // Чем меньше коэффициент, тем мягче.
        // 0.10 - очень мягко
        // 0.16 - оптимально
        // 0.22 - быстрее
        // 0.30 - режим «Быстрая» в ui-customizer (меньше кадров догона)
        var factor = getScrollAnimMode() === 'fast' ? 0.3 : 0.16;
        setScrollXImmediate(cnt, current + diff * factor);

        st.rafId = requestAnimationFrame(function () { step(cnt); });
    }

    /** Плавно доехать до позиции left (в координатах scrollLeft) */
    function glideTo(cnt, left) {
        var st = state(cnt);
        st.target = clampX(cnt, left);

        // «Без анимации» — ставим позицию сразу, догон кадрами не запускаем
        if (getScrollAnimMode() === 'none') {
            stopGlide(cnt);
            setScrollXImmediate(cnt, st.target);
            return;
        }
        if (!st.rafId) st.rafId = requestAnimationFrame(function () { step(cnt); });
    }

    /**
     * Контейнер под курсором/пальцем, который реально можно двигать.
     * Заголовок ряда лежит вне вьюпорта — там closest даёт .catalog-row,
     * у которого getMaxScrollX === 0, и жест уходит странице.
     */
    function findContainer(target) {
        if (!target || !target.closest) return null;
        var cnt = target.closest(H_SCROLL_SELECTOR);
        if (!cnt || getMaxScrollX(cnt) <= 0) return null;
        return cnt;
    }

    document.addEventListener('wheel', function (e) {
        var cnt = findContainer(e.target);
        if (!cnt) return;

        var dy =
            e.deltaY ||
            e.wheelDeltaY ||
            (e.wheelDelta ? -e.wheelDelta / 40 : 0) ||
            e.detail ||
            0;

        var dx = e.deltaX || e.wheelDeltaX || 0;
        var isCarousel = !!getRowTrack(cnt);
        var delta;

        if (Math.abs(dx) > Math.abs(dy)) {
            // Горизонтальный жест (тачпад, shift+колесо): нативному списку его
            // отработает сам браузер, а у карусели скроллить нечего — только трек
            if (!isCarousel) return;
            delta = dx;
        } else {
            // На главной вертикальное колесо листает подборки (это делает home.js),
            // а не катает ряд вбок: ряд там показан один, вертикальной прокрутки у
            // страницы нет, и иначе дальше первой подборки мышью не уйти. Событие
            // отдаём как есть — default не отменяем, чтобы обработчик главной его
            // увидел. Shift + колесо остаётся горизонтальным жестом для ряда.
            if (!e.shiftKey && cnt.closest && cnt.closest('#home-rows')) return;
            delta = dy;
        }
        if (!delta) return;

        var st = state(cnt);
        // Догон не идёт — считаем от фактической позиции, а не от старой цели
        // (её мог перебить setScrollX при навигации пультом)
        if (!st.rafId) st.target = getScrollX(cnt);

        // Ряд упёрся в край — колесо отдаём странице (default не отменяем).
        // Иначе на главной, где ряды занимают весь экран, вертикальной
        // прокрутки мышью не было бы вообще.
        var max = getMaxScrollX(cnt);
        if ((delta < 0 && st.target <= 0.5) || (delta > 0 && st.target >= max - 0.5)) return;

        e.preventDefault();
        glideTo(cnt, st.target + delta * 0.9);
    }, { passive: false });

    // ---------- Драг пальцем ----------
    var drag = null;

    document.addEventListener('touchstart', function (e) {
        drag = null;
        if (!e.touches || e.touches.length !== 1) return;
        var cnt = findContainer(e.target);
        if (!cnt) return;

        stopGlide(cnt);
        var t = e.touches[0];
        drag = {
            cnt: cnt,
            startX: t.clientX,
            startY: t.clientY,
            startScroll: getScrollX(cnt),
            axis: null,
            lastX: t.clientX,
            lastT: Date.now(),
            velocity: 0
        };
    }, { passive: true });

    document.addEventListener('touchmove', function (e) {
        if (!drag || !e.touches || e.touches.length !== 1) return;

        var t = e.touches[0];
        var dx = drag.startX - t.clientX;
        var dy = drag.startY - t.clientY;

        if (!drag.axis) {
            if (Math.abs(dx) < TOUCH_AXIS_THRESHOLD && Math.abs(dy) < TOUCH_AXIS_THRESHOLD) return;
            // Жест по вертикали отдаём странице: #main-container скроллится
            // нативно, перехватим — и главная перестанет листаться пальцем
            if (Math.abs(dy) >= Math.abs(dx)) { drag = null; return; }
            drag.axis = 'x';
        }

        e.preventDefault();

        var now = Date.now();
        var dt = now - drag.lastT;
        // px/мс, знак как у scrollX: палец влево — ряд уезжает вперёд
        if (dt > 0) drag.velocity = (drag.lastX - t.clientX) / dt;
        drag.lastX = t.clientX;
        drag.lastT = now;

        setScrollXImmediate(drag.cnt, clampX(drag.cnt, drag.startScroll + dx));
    }, { passive: false });

    function endDrag() {
        if (!drag) return;
        var d = drag;
        drag = null;
        if (d.axis !== 'x') return;

        var velocity = (Date.now() - d.lastT > FLING_IDLE_MS) ? 0 : d.velocity;
        glideTo(d.cnt, getScrollX(d.cnt) + velocity * FLING_MS);
    }

    document.addEventListener('touchend', endDrag, { passive: true });
    document.addEventListener('touchcancel', endDrag, { passive: true });

    // Слушатели делегированы, обходить контейнеры больше не нужно —
    // функция оставлена, чтобы не падали внешние вызовы
    window.initSmoothHorizontalScroll = function () { };
})();
