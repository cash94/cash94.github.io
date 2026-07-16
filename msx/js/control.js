// control.js - Модуль управления навигацией, фокусом и обработкой клавиш (Оптимизированная версия)
// ==================== ПЕРЕМЕННЫЕ ====================
var focusableElements = [];
var currentFocusIndex = 0;
var lastSelectedTorrentHash = null;
var lastSelectedTorrentIndex = 0;
var lastPlayerBackPressAt = 0;
var seekHoldInterval = null;
var seekHoldStep = 5;
var seekHoldDelay = 150;
var isSeekHoldActive = false;
var okHoldTimer = null;
var okHoldHandled = false;
var okHoldFocused = null;
var fastNavigation = false;
var fastNavigationTimer = null;
var lastBackPressTime = 0;
var lastBackPressHandled = false;
var activeScrollAnimation = null;
var lastPopStateTime = 0;
var isProcessingBack = false;

function setFastNavigation() {
    fastNavigation = true;
    if (fastNavigationTimer) clearTimeout(fastNavigationTimer);
    fastNavigationTimer = setTimeout(function () { fastNavigation = false; }, 200);
}

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function isPlayerControlsVisible() {
    var c = getEl('controls-container');
    return !!c && !c.classList.contains('idle-hidden');
}

var _cachedColumns = 0;
function getTorrentGridColumns() {
    var grid = getEl('torrents-grid');
    if (!grid) return 6;
    try {
        var cols = (window.getComputedStyle(grid).gridTemplateColumns || '').split(' ').filter(function (b) { return b; }).length;
        _cachedColumns = cols || 6;
    } catch (e) { _cachedColumns = 6; }
    return _cachedColumns;
}

// ==================== УПРАВЛЕНИЕ ФОКУСОМ ====================
function updateFocusableElements() {
    var screen = AppState.currentScreen;
    var episodesPanel = getEl('episodes-panel');
    var audioPanel = getEl('audio-panel');
    var subtitlesPanel = getEl('subtitles-panel');
    var isEpisodesOpen = episodesPanel && !episodesPanel.classList.contains('hidden');
    var isAudioOpen = audioPanel && !audioPanel.classList.contains('hidden');
    var isSubtitlesOpen = subtitlesPanel && !subtitlesPanel.classList.contains('hidden');
    var list = [];

    if (isEpisodesOpen) {
        var items = document.querySelectorAll('.episode-item, .close-panel-btn');
        for (var i = 0; i < items.length; i++) if (items[i] && items[i].offsetParent !== null) list.push(items[i]);
        focusableElements = list; return;
    }
    if (isAudioOpen) {
        var items = document.querySelectorAll('.audio-item, .close-panel-btn');
        for (var i = 0; i < items.length; i++) if (items[i] && items[i].offsetParent !== null) list.push(items[i]);
        focusableElements = list; return;
    }

    if (isSubtitlesOpen) {
        var items = document.querySelectorAll('.subtitle-item, .close-panel-btn');
        for (var i = 0; i < items.length; i++) if (items[i] && items[i].offsetParent !== null) list.push(items[i]);
        focusableElements = list; return;
    }

    if (screen === 'sync') {
        var btn = getEl('sync-close-btn'); if (btn && btn.offsetParent !== null) list.push(btn);
        var inp = getEl('sync-code-input'); if (inp && inp.offsetParent !== null) list.push(inp);
        focusableElements = list; return;
    }

    if (screen === 'player') {
        var c = getEl('controls-container');
        if (c && !c.classList.contains('idle-hidden')) {
            var seek = getEl('seek-slider');
            // Добавляем кнопку пропуска в список, если она видима
            var skipBtn = getEl('skip-button');
            var btns = document.querySelectorAll('#prev-episode-btn, #play-pause-btn, #next-episode-btn, #audio-btn, #subtitles-btn, #episodes-btn, #mute-btn, #zoom-mode-btn, #toggle-buffer-btn');
            for (var i = 0; i < btns.length; i++) if (btns[i] && btns[i].offsetParent !== null) list.push(btns[i]);
            if (seek && seek.offsetParent !== null) list.unshift(seek);
            // Добавляем кнопку пропуска, если она видима
            if (skipBtn && !skipBtn.classList.contains('hidden') && skipBtn.offsetParent !== null) {
                list.push(skipBtn);
            }
        }
        focusableElements = list.filter(function (e) { return e && e.offsetParent !== null; });
        return;
    }

    if (screen === 'detail') {
        var sel = '.detail-progress-btn, .file-item, .back-btn, .catalog-watch-btn';
        var els = document.querySelectorAll(sel);
        for (var i = 0; i < els.length; i++) if (els[i] && els[i].offsetParent !== null) list.push(els[i]);
        focusableElements = list; return;
    }

    if (screen === 'torrents') {
        var searchInput = getEl('search-query'), searchBtn = getEl('search-btn'), settingsBtn = getEl('settings-btn');
        var tabTorrents = getEl('tab-torrents'), tabSearch = getEl('tab-search'), tabCatalog = getEl('tab-catalog');
        var allCards = document.querySelectorAll('.torrent-card');
        var cards = []; for (var i = 0; i < allCards.length; i++) if (allCards[i] && allCards[i].offsetParent !== null) cards.push(allCards[i]);
        var cols = getTorrentGridColumns();
        var rows = []; for (var j = 0; j < cards.length; j += cols) rows.push(cards.slice(j, j + cols));
        window.torrentRows = { row1: [searchInput, searchBtn, settingsBtn].filter(Boolean), row2: [tabTorrents, tabSearch, tabCatalog].filter(Boolean), cardRows: rows, allCards: cards };
        var focusList = cards.slice();
        if (searchInput && searchInput.offsetParent !== null) focusList.push(searchInput);
        if (searchBtn && searchBtn.offsetParent !== null) focusList.push(searchBtn);
        if (tabTorrents && tabTorrents.offsetParent !== null) focusList.push(tabTorrents);
        if (tabSearch && tabSearch.offsetParent !== null) focusList.push(tabSearch);
        if (tabCatalog && tabCatalog.offsetParent !== null) focusList.push(tabCatalog);
        if (settingsBtn && settingsBtn.offsetParent !== null) focusList.push(settingsBtn);
        focusableElements = focusList.filter(function (e) { return e && e.offsetParent !== null; }); return;
    }

    if (screen === 'catalog') {
        var cards = document.querySelectorAll('.torrent-card.catalog-card, .torrent-card.catalog-folder-card');
        for (var i = 0; i < cards.length; i++) if (cards[i] && cards[i].offsetParent !== null) list.push(cards[i]);
        focusableElements = list; window.catalogCards = list; return;
    }

    if (screen === 'search') {
        var q = getEl('search-query'), ft = getEl('filter-toggle'), sb = getEl('search-btn'), cs = getEl('close-search');
        var fcs = document.querySelectorAll('#torrent-movie, #sort-by, #filter-quality, #filter-content-type, #filter-tracker, #filter-year, #filter-season, #filter-voice, #filter-videotype, #reset-filters');
        var ris = document.querySelectorAll('.search-result-item');
        var res = []; for (var i = 0; i < ris.length; i++) if (ris[i] && ris[i].offsetParent !== null) res.push(ris[i]);
        var filters = []; for (var i = 0; i < fcs.length; i++) if (fcs[i] && fcs[i].offsetParent !== null) filters.push(fcs[i]);
        var fl = [q, ft, sb, cs];
        for (var i = 0; i < filters.length; i++) fl.push(filters[i]);
        for (var i = 0; i < res.length; i++) fl.push(res[i]);
        focusableElements = fl.filter(Boolean); return;
    }

    if (screen === 'config') {
        var ids = ['torrserver-tab', 'torrents-tab', 'player-tab', 'sync-tab'];
        var cfg = document.querySelectorAll('.settings-btn');
        for (var i = 0; i < ids.length; i++) { var e = getEl(ids[i]); if (e && e.offsetParent !== null) list.push(e); }
        for (var i = 0; i < cfg.length; i++) if (cfg[i] && cfg[i].offsetParent !== null) list.push(cfg[i]);
        focusableElements = list; return;
    }

    focusableElements = [];
}

// Оптимизированный setFocus с rAF для плавности
function setFocus(index) {
    if (focusableElements.length === 0) { updateFocusableElements(); if (focusableElements.length === 0) return; }
    if (index < 0) index = focusableElements.length - 1;
    if (index >= focusableElements.length) index = 0;
    currentFocusIndex = index;

    //requestAnimationFrame(function () {
    //var focused = document.querySelectorAll('.focused');
    //for (var i = 0; i < focused.length; i++) focused[i].classList.remove('focused');
    //clearFocused();

    var element = focusableElements[currentFocusIndex];
    if (!element) return;
    focusEl(element);
    //element.classList.add('focused');

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

    //if (typeof Animations !== 'undefined') Animations.animateFocus(element);

    // Сброс фокуса с инпутов
    if (document.activeElement && document.activeElement.tagName === 'INPUT') {
        var allowed = ['search-query', 'torrserver-url', 'auth-login', 'auth-password', 'jacred-url'];
        if (allowed.indexOf(element.id) === -1) document.activeElement.blur();
    }

    // Скролл
    // var container = null;
    // var s = AppState.currentScreen;
    // var isFI = element.classList && element.classList.contains('file-item');
    // var isAC = element.classList && element.classList.contains('catalog-actor-card');
    // var isRC = element.classList && element.classList.contains('catalog-recommendation-card');
    // var isTC = element.classList && element.classList.contains('catalog-trailer-card-item');

    // if (s === 'catalog' || s === 'torrents' || s === 'config') {
    //     container = getEl('main-container');
    // } else if (s === 'search') {
    //     container = getEl('search-results');
    // } else if (s === 'detail') {
    //     if (isFI) {
    //         container = getEl('files-list');
    //     } else if (isAC) {
    //         // Для актеров используем wrap контейнер (который реально скроллится)
    //         container = getEl('catalog-detail-actors-wrap');
    //         // Если wrap не найден, пробуем найти родителя
    //         if (!container && el.closest) {
    //             container = el.closest('.catalog-detail-actors-wrap');
    //         }
    //     } else if (isRC) {
    //         // Для рекомендаций используем wrap контейнер
    //         container = getEl('catalog-detail-recommendations-wrap');
    //         if (!container && el.closest) {
    //             container = el.closest('.catalog-detail-recommendations-wrap');
    //         }
    //     } else if (isTC) {
    //         // Для трейлеров используем wrap контейнер
    //         container = getEl('catalog-detail-trailers-wrap');
    //         if (!container && el.closest) {
    //             container = el.closest('.catalog-detail-trailers-wrap');
    //         }
    //     } else {
    //         container = getEl('detail-view');
    //     }
    // } else if (s === 'player') {
    //     container = getEl('episodes-list') || getEl('audio-list');
    // }

    // if (!isElementFullyVisible(element, container)) {
    //     scrollToElementIfNeeded(element, container, !fastNavigation);
    // }
    //});
}

function focusFirstTorrentCard(retries, delay) {
    if (retries === undefined) retries = 6; if (delay === undefined) delay = 120;
    if (AppState.currentScreen !== 'torrents') return false;
    updateFocusableElements();
    for (var i = 0; i < focusableElements.length; i++) {
        if (focusableElements[i].classList && focusableElements[i].classList.contains('torrent-card')) {
            setFocus(i); return true;
        }
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

function showPlayerControls(preferredFocusId) {
    if (preferredFocusId === undefined) preferredFocusId = 'play-pause-btn';
    var ids = ['controls-container', 'buffer-stats', 'player-hint', 'toggle-buffer-btn', 'exit-player-btn', 'episodes-btn', 'prev-episode-btn', 'next-episode-btn', 'audio-btn', 'subtitles-btn', 'player-title'];
    for (var i = 0; i < ids.length; i++) { var e = getEl(ids[i]); if (e) e.classList.remove('idle-hidden'); }
    if (typeof window.syncPlayerTitleVisibility === 'function') window.syncPlayerTitleVisibility(true);
    var pt = getEl('player-title'); if (pt) pt.classList.remove('hidden');
    if (typeof Animations !== 'undefined') Animations.animateControlsShow();
    if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();
    setTimeout(function () {
        updateFocusableElements();
        var ti = -1; for (var j = 0; j < focusableElements.length; j++) if (focusableElements[j].id === preferredFocusId) { ti = j; break; }
        setFocus(ti !== -1 ? ti : 0);
    }, 60);
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

// ==================== НАВИГАЦИЯ ====================
function navigate(direction) {
    if (typeof setFastNavigation === 'function') setFastNavigation();
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
        var ep = getEl('episodes-panel'), ap = getEl('audio-panel'), sp = getEl('subtitles-panel'); // 🆕 sp
        var isOpen = (ep && !ep.classList.contains('hidden')) || (ap && !ap.classList.contains('hidden')) || (sp && !sp.classList.contains('hidden')); // 🆕 + sp
        if (isOpen) { if (direction === 'up' && currentFocusIndex > 0) setFocus(currentFocusIndex - 1); else if (direction === 'down' && currentFocusIndex < focusableElements.length - 1) setFocus(currentFocusIndex + 1); return; }
        if (cur && cur.id === 'seek-slider') { if (direction === 'down' && focusableElements.length > 1) setFocus(1); return; }
        if (direction === 'up') setFocus(0); else if (direction === 'left' && currentFocusIndex > 1) setFocus(currentFocusIndex - 1); else if (direction === 'right' && currentFocusIndex < focusableElements.length - 1) setFocus(currentFocusIndex + 1);
        return;
    }

    // SEARCH NAV
    if (AppState.currentScreen === 'search') {
        var q = getEl('search-query'), fl = [], res = [];
        for (var i = 0; i < focusableElements.length; i++) { var e = focusableElements[i]; if (['torrent-movie', 'sort-by', 'filter-quality', 'filter-content-type', 'filter-tracker', 'filter-year', 'filter-season', 'filter-voice', 'filter-videotype', 'reset-filters', 'close-search'].indexOf(e.id) !== -1) fl.push(e); if (e.classList && e.classList.contains('search-result-item')) res.push(e); }
        var fIdx = -1, rIdx = -1; for (var i = 0; i < fl.length; i++) if (cur === fl[i]) { fIdx = i; break; } for (var i = 0; i < res.length; i++) if (cur === res[i]) { rIdx = i; break; }
        if (!cur) { if (q && focusableElements.indexOf(q) !== -1) setFocus(focusableElements.indexOf(q)); else if (fl.length > 0) setFocus(focusableElements.indexOf(fl[0])); else if (res.length > 0) setFocus(focusableElements.indexOf(res[0])); return; }
        if (cur === q) { if (['left', 'right', 'down', 'up'].indexOf(direction) !== -1) setFocus(fl.length > 0 ? focusableElements.indexOf(fl[0]) : (res.length > 0 ? focusableElements.indexOf(res[0]) : 0)); return; }
        if (fIdx !== -1) { if (direction === 'left') setFocus(focusableElements.indexOf(fl[Math.max(0, fIdx - 1)])); else if (direction === 'right') setFocus(focusableElements.indexOf(fl[Math.min(fl.length - 1, fIdx + 1)])); else if (direction === 'down') setFocus(res.length > 0 ? focusableElements.indexOf(res[0]) : focusableElements.indexOf(fl[Math.min(fl.length - 1, fIdx + 1)])); else if (direction === 'up') setFocus(q && focusableElements.indexOf(q) !== -1 ? focusableElements.indexOf(q) : focusableElements.indexOf(fl[Math.max(0, fIdx - 1)])); return; }
        if (rIdx !== -1) { if (direction === 'up') setFocus(rIdx === 0 && fl.length > 0 ? focusableElements.indexOf(fl[0]) : focusableElements.indexOf(res[Math.max(0, rIdx - 1)])); else if (direction === 'down') setFocus(focusableElements.indexOf(res[Math.min(res.length - 1, rIdx + 1)])); return; }
    }

    // DEFAULT
    switch (direction) { case 'up': setFocus(currentFocusIndex - 1); break; case 'down': setFocus(currentFocusIndex + 1); break; case 'left': setFocus(currentFocusIndex - 1); break; case 'right': setFocus(currentFocusIndex + 1); break; }
}

function keyToDirection(keyCode) { if (isKeyPressed('UP', keyCode)) return 'up'; if (isKeyPressed('DOWN', keyCode)) return 'down'; if (isKeyPressed('LEFT', keyCode)) return 'left'; if (isKeyPressed('RIGHT', keyCode)) return 'right'; return null; }

function stopSeeking() { if (seekHoldInterval) { clearInterval(seekHoldInterval); seekHoldInterval = null; } }

// ==================== ОБРАБОТЧИКИ КЛАВИШ ====================
function focusActivePanelItem(panelType) {
    setTimeout(function () {
        var sel = panelType === 'episodes' ? '.subtitle-item.active'
            : panelType === 'subtitles' ? '.subtitle-item.active'
                : '.audio-item.active';
        // Исправление: для episodes должно быть .episode-item.active
        if (panelType === 'episodes') sel = '.episode-item.active';
        else if (panelType === 'subtitles') sel = '.subtitle-item.active';
        else sel = '.audio-item.active';

        var active = document.querySelector(sel); if (!active) return;
        var focused = document.querySelectorAll('.focused'); for (var i = 0; i < focused.length; i++) focused[i].classList.remove('focused');
        active.classList.add('focused'); active.scrollIntoView({ behavior: 'smooth', block: 'center' });
        updateFocusableElements();
        for (var i = 0; i < focusableElements.length; i++) if (focusableElements[i] === active || focusableElements[i].parentElement === active) { currentFocusIndex = i; break; }
    }, 50);
}

function setupKeyboardHandlers() {
    document.addEventListener('keyup', function (e) {
        var k = e.keyCode;
        if (isKeyPressed('LEFT', k) || isKeyPressed('RIGHT', k)) {
            if (seekHoldInterval) { clearInterval(seekHoldInterval); seekHoldInterval = null; if (typeof accelerationTimer !== 'undefined' && accelerationTimer) { clearInterval(accelerationTimer); accelerationTimer = null; } var s = getEl('seek-slider'); if (s) { var ev = document.createEvent('Event'); ev.initEvent('change', true, true); s.dispatchEvent(ev); } setTimeout(function () { isSeekHoldActive = false; }, 500); }
            stopSeeking();
        }
    });

    document.addEventListener('keydown', function (e) {
        var k = e.keyCode, active = document.activeElement;
        var po = getEl('playback-overlay'); var isPA = po && po.classList.contains('active'); if (isPA) return;
        var a = document.activeElement, ed = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
        var skipBtn = getEl('skip-button'); if (k == 13 && skipBtn && !skipBtn.classList.contains('hidden') && skipBtn.classList.contains('focused')) { if (typeof window.executeSkip === 'function') { window.executeSkip(); return true; } }
        if (ed) {
            // Проверяем, пустое ли поле
            var isEmpty = false;
            if (a.tagName === 'SELECT') {
                isEmpty = (a.selectedIndex === -1 || a.value === '');
            } else {
                isEmpty = (a.value === '' || a.value === null);
            }
            if (!isEmpty) {
                return;
            }
        }
        if (AppState.currentScreen === 'torrents') {
            if (['UP', 'DOWN', 'LEFT', 'RIGHT'].some(function (d) { return isKeyPressed(d, k); })) { e.preventDefault(); if (!document.querySelector('.focused')) { focusFirstTorrentCard(); return; } navigate(keyToDirection(k)); return; }
            if (isKeyPressed('OK', k) || k === 13) { e.preventDefault(); if (e.repeat) return; var f = document.querySelector('.focused'); if (!f) { focusFirstTorrentCard(); return; } if (f.id === 'search-query') { if (typeof window.showSearchResults === 'function') window.showSearchResults({ focusQuery: true }); return; } if (f.id === 'search-btn' || f.id === 'tab-search') { if (typeof window.showSearchResults === 'function') window.showSearchResults({ focusQuery: true, runSearch: f.id === 'search-btn' }); return; } if (f.id === 'tab-catalog') { f.click(); return; } if (f.id === 'settings-btn' || f.id === 'tab-torrents') { f.click(); return; } if (f.classList.contains('torrent-card')) return; if (f.click) f.click(); return; }
            return;
        }

        if (active && active.id === 'search-query') {
            if (isKeyPressed('BACK', k) || isKeyPressed('EXIT', k)) { e.preventDefault(); active.blur(); updateFocusableElements(); var si = -1; for (var i = 0; i < focusableElements.length; i++) if (focusableElements[i].id === 'search-query') { si = i; break; } setFocus(si !== -1 ? si : 0); return; }
            if (['DOWN', 'UP', 'LEFT', 'RIGHT'].some(function (d) { return isKeyPressed(d, k); })) { e.preventDefault(); var dir = keyToDirection(k); active.blur(); updateFocusableElements(); if (AppState.currentScreen === 'search') { if (dir === 'right') { var sb = -1; for (var i = 0; i < focusableElements.length; i++) if (focusableElements[i].id === 'search-btn') { sb = i; break; } setFocus(sb !== -1 ? sb : 0); } else { var ff = -1, fr = -1; for (var i = 0; i < focusableElements.length; i++) { var el = focusableElements[i]; if (['filter-toggle', 'torrent-movie', 'sort-by', 'filter-quality', 'filter-content-type', 'filter-tracker', 'filter-year', 'filter-season', 'filter-voice', 'filter-videotype', 'reset-filters', 'close-search'].indexOf(el.id) !== -1 && ff === -1) ff = i; if (el.classList && el.classList.contains('search-result-item') && fr === -1) fr = i; } setFocus(dir === 'down' && ff !== -1 ? ff : (ff !== -1 ? ff : (fr !== -1 ? fr : 0))); } return; } navigate(dir); return; }
            if (isKeyPressed('OK', k)) { e.preventDefault(); var q = active.value.trim(); if (AppState.currentScreen === 'search') { if (q && typeof window.searchTorrents === 'function') window.searchTorrents(q); active.blur(); setTimeout(function () { focusSearchHome(true); }, 100); return; } if (typeof window.showSearchResults === 'function') window.showSearchResults({ focusQuery: true, runSearch: !!q }); active.blur(); return; }
        }

        //if (AppState.currentScreen === 'config') {
        //var inp = active && (active.id === 'torrserver-url' || active.id === 'auth-login' || active.id === 'auth-password' || f.id === 'jacred-url');
        //if (inp) { if (isKeyPressed('OK', k)) { e.preventDefault(); active.blur(); updateFocusableElements(); var ci = -1; for (var i = 0; i < focusableElements.length; i++) if (focusableElements[i].id === active.id) { ci = i; break; } setFocus(ci !== -1 && ci < focusableElements.length - 1 ? ci + 1 : 0); return; } return; }
        //updateFocusableElements();
        //if (isKeyPressed('UP', k)) { e.preventDefault(); setFocus(currentFocusIndex - 1); return; }
        //if (isKeyPressed('DOWN', k)) { e.preventDefault(); setFocus(currentFocusIndex + 1); return; }
        //if (isKeyPressed('LEFT', k)) { e.preventDefault(); setFocus(currentFocusIndex - 1); return; }
        //if (isKeyPressed('RIGHT', k)) { e.preventDefault(); setFocus(currentFocusIndex + 1); return; }
        //if (isKeyPressed('OK', k)) { e.preventDefault(); var f = document.querySelector('.focused'); if (f) { if (f.id === 'torrserver-url' || f.id === 'auth-login' || f.id === 'auth-password' || f.id === 'jacred-url') f.focus(); else f.click(); } return; }
        //}

        if (AppState.currentScreen === 'search') {
            var tag = e.target.tagName; var isF = tag === 'SELECT' || e.target.id === 'filter-year';
            //if (isKeyPressed('BACK', k) || isKeyPressed('EXIT', k)) { e.preventDefault(); window.hideSearchResults(); } 
            if (isF && ['UP', 'DOWN', 'LEFT', 'RIGHT'].some(function (d) { return isKeyPressed(d, k); })) { e.preventDefault(); if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur(); updateFocusableElements(); var ff = -1; for (var i = 0; i < focusableElements.length; i++) if (['filter-toggle', 'torrent-movie', 'sort-by', 'filter-quality', 'filter-content-type', 'filter-tracker', 'filter-year', 'filter-season', 'filter-voice', 'filter-videotype', 'reset-filters', 'close-search'].indexOf(focusableElements[i].id) !== -1) { ff = i; break; } if (ff !== -1) { setFocus(ff); if (keyToDirection(k) !== 'left') navigate(keyToDirection(k)); } return; }
        }

        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
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
                    // 🆕 ОБРАБОТКА КНОПКИ СУБТИТРОВ
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
            if (isKeyPressed('LEFT', k) || isKeyPressed('RIGHT', k)) { var cc = getEl('controls-container'); if (cc.classList.contains('idle-hidden')) { e.preventDefault(); return; } e.preventDefault(); if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer(); var fe = focusableElements[currentFocusIndex]; if (fe && fe.id === 'seek-slider') { var s = getEl('seek-slider'), dir = isKeyPressed('LEFT', k) ? -1 : 1, hd = 0, cs = seekHoldStep, ms = 120, ac = [{ t: 0, s: 5 }, { t: 500, s: 10 }, { t: 1000, s: 20 }, { t: 1500, s: 30 }, { t: 2000, s: 45 }, { t: 2500, s: 60 }, { t: 3000, s: 90 }, { t: 4000, s: 120 }], lu = Date.now(), at = null, us = function () { var el = Date.now() - lu, ns = seekHoldStep; for (var i = ac.length - 1; i >= 0; i--) if (el >= ac[i].t) { ns = ac[i].s; break; } if (ns !== cs) { cs = ns; console.log('⚡ Ускорение перемотки: ' + cs + ' сек'); } }, ps = function () { var cv = parseFloat(s.value), mx = parseFloat(s.max), st = cs * dir, nv = cv + st; if (nv < 0) nv = 0; if (nv > mx) nv = mx; s.value = nv; if (typeof AppState !== 'undefined') AppState.previewTime = nv; var ct = getEl('current-time'); if (ct) ct.textContent = formatTime(nv); if (AppState.isSeeking || getEl('loading-player-overlay').classList.contains('active')) { var lt = getEl('loading-time'); if (lt) lt.textContent = formatTime(nv); } }; if (!seekHoldInterval) { isSeekHoldActive = true; hd = 0; cs = seekHoldStep; lu = Date.now(); ps(); seekHoldInterval = setInterval(ps, seekHoldDelay); at = setInterval(function () { if (seekHoldInterval) us(); else if (at) { clearInterval(at); at = null; } }, 200); } return; } else { navigate(keyToDirection(k)); return; } }
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

        if (AppState.currentScreen === 'search' && isKeyPressed('OK', k)) { e.preventDefault(); var f = document.querySelector('.focused'); if (f) { if (f.id === 'search-query') { f.focus(); try { if (f.select) f.select(); } catch (e) { } } else if (f.tagName === 'SELECT' || f.id === 'filter-year') { if (typeof window.openNativeSearchControl === 'function') window.openNativeSearchControl(f); else { f.focus(); f.click(); } } else if (f.id === 'search-btn') { var q = getEl('search-query'); var qt = q ? q.value.trim() : ''; if (qt && typeof window.searchTorrents === 'function') window.searchTorrents(qt); } else f.click(); } else focusSearchHome(true); return; }

        if (isKeyPressed('UP', k)) { e.preventDefault(); navigate('up'); } else if (isKeyPressed('DOWN', k)) { e.preventDefault(); navigate('down'); } else if (isKeyPressed('LEFT', k)) { e.preventDefault(); navigate('left'); } else if (isKeyPressed('RIGHT', k)) { e.preventDefault(); navigate('right'); } else if (isKeyPressed('OK', k)) { e.preventDefault(); var f = document.querySelector('.focused'); if (f) { if (f.classList.contains('file-item')) { var pb = f.querySelector('.play-btn'); if (pb) pb.click(); else f.click(); } else f.click(); } else if (focusableElements.length > 0) focusableElements[0].click(); } else if (isKeyPressed('INFO', k)) { e.preventDefault(); console.log('ℹ️ Информация:', { screen: AppState.currentScreen, platform: AppState.platform, focusIndex: currentFocusIndex, focusableCount: focusableElements.length }); }
    });
}

// ==================== LONG PRESS & FOCUS RESCUE ====================
function clearOkHold() { if (okHoldTimer) { clearTimeout(okHoldTimer); okHoldTimer = null; } }

function isElementFullyVisible(el, container) {
    return false;
    if (!el || !container) return true;

    var r = el.getBoundingClientRect();
    var cr = container.getBoundingClientRect();

    // Проверяем является ли контейнер горизонтальным
    var isH = container.id === container.id === 'files-list' ||
        container.id === 'catalog-detail-actors-wrap' ||
        container.id === 'catalog-detail-recommendations-wrap' ||
        container.id === 'catalog-detail-trailers-wrap';

    if (isH) {
        var hp = 30; // Горизонтальный отступ
        var vp = 20; // Вертикальный отступ для wrap контейнеров

        // Проверяем горизонтальную видимость
        var isHorizVisible = r.left >= cr.left + hp && r.right <= cr.right - hp;

        // Для wrap контейнеров также проверяем вертикальную видимость в detail-view
        if (container.id && container.id.includes('-wrap')) {
            var detailView = getEl('detail-view');
            if (detailView) {
                var detailRect = detailView.getBoundingClientRect();
                var isVertVisible = cr.top >= detailRect.top + vp && cr.bottom <= detailRect.bottom - vp;
                return isHorizVisible && isVertVisible;
            }
        }

        return isHorizVisible;
    }

    // Обычная проверка для вертикальных контейнеров
    return r.top >= cr.top + 20 && r.bottom <= cr.bottom - 20 &&
        r.left >= cr.left + 20 && r.right <= cr.right - 20;
}

function scrollToElementIfNeeded(el, container, smooth) {
    if (smooth === undefined) smooth = !fastNavigation;
    if (!el || !container) return;

    var r = el.getBoundingClientRect();
    var cr = container.getBoundingClientRect();

    // Обычная прокрутка для обычных контейнеров
    var needsScroll = false;
    var isWindow = container === window || container === document.body;
    var scrollContainer = isWindow ? (window.scrollingElement || document.documentElement) : container;
    var isH = container.id === 'catalog-detail-actors-wrap' ||
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

        // Горизонтальная прокрутка
        var targetLeft = con.scrollLeft + (r.left - cr.left) - (cr.width / 2) + (r.width / 2);
        targetLeft = Math.max(0, targetLeft);

        // Проверяем нужно ли вообще скроллить
        var needsHScroll = Math.abs(con.scrollLeft - targetLeft) > 10;

        if (needsHScroll) {
            if (smooth && typeof gsap !== 'undefined' && typeof ScrollToPlugin !== 'undefined') {
                gsap.killTweensOf(con);
                gsap.to(con, {
                    scrollTo: { x: targetLeft }, //, y: 'max' },
                    duration: 0.1,
                    ease: "power0.out",
                    overwrite: true
                });
            } else if (smooth) {
                con.scrollTo({ left: targetLeft, behavior: 'smooth' });
            } else {
                con.scrollLeft = targetLeft;
            }
        }

        // Вертикальная прокрутка detail-view
        var detailView = getEl('detail-view');
        if (detailView) {
            var containerRect = container.getBoundingClientRect();
            var detailRect = detailView.getBoundingClientRect();
            var detailScrollTop = detailView.scrollTop;
            var containerTopRelative = containerRect.top - detailRect.top + detailScrollTop;
            var containerBottomRelative = containerTopRelative + containerRect.height;
            var detailViewportTop = detailView.scrollTop;
            var detailViewportBottom = detailViewportTop + detailRect.height;

            var needsVertScroll = false;
            var targetScrollTop = detailView.scrollTop;

            if (containerTopRelative < detailViewportTop + 50) {
                targetScrollTop = Math.max(0, containerTopRelative - 20);
                needsVertScroll = true;
            } else if (containerBottomRelative > detailViewportBottom - 50) {
                targetScrollTop = Math.max(0, containerBottomRelative - detailRect.height + 20);
                needsVertScroll = true;
            }

            if (needsVertScroll) {
                targetScrollTop = Math.max(0, Math.min(targetScrollTop, detailView.scrollHeight - detailRect.height));

                if (smooth && typeof gsap !== 'undefined' && typeof ScrollToPlugin !== 'undefined') {
                    gsap.killTweensOf(detailView);
                    gsap.to(detailView, {
                        scrollTo: { y: targetScrollTop },
                        duration: 0.1,
                        backgroundColor: 'rgb(0, 0, 0)',
                        ease: "power1.out",
                        overwrite: true
                    });
                } else if (smooth) {
                    detailView.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
                } else {
                    detailView.scrollTop = targetScrollTop;
                }
            }
        }
        return;
    } else if (container.id === 'detail-view') {
        if (el.id === 'back-from-detail' || el.id === 'catalog-watch-btn') {
            // Прокручиваем на самый верх
            var targetScrollTop = 0;

            if (smooth && typeof gsap !== 'undefined' && typeof ScrollToPlugin !== 'undefined') {
                gsap.killTweensOf(container);
                gsap.to(container, {
                    scrollTo: { y: targetScrollTop },
                    duration: 0.1,
                    ease: "power0.out",
                    overwrite: true
                });
            } else if (smooth) {
                container.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
            } else {
                container.scrollTop = targetScrollTop;
            }
            return;
        }
    } else if (el.id === 'tab-catalog') {
        // Прокручиваем на самый верх
        var targetScrollTop = 0;

        if (smooth && typeof gsap !== 'undefined' && typeof ScrollToPlugin !== 'undefined') {
            gsap.killTweensOf(container);
            gsap.to(container, {
                scrollTo: { y: targetScrollTop },
                duration: 0.1,
                ease: "power0.out",
                overwrite: true
            });
        } else if (smooth) {
            container.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
        } else {
            container.scrollTop = targetScrollTop;
        }
        return;
    } else if (container.id == 'episodes-panel' || container.id == 'audio-panel') {
        Animations.scrollToIfNotVisible(el, container);
    }

    if (!scrollContainer) return;
    Animations.scrollToIfNotVisible(el, container);

}

function VISIBLE(el) { return !!(el && el.offsetParent !== null && !el.disabled); };
function blurEditor() { var a = document.activeElement; if (a && a !== document.body && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA')) try { a.blur(); } catch (e) { } };

function focusEl(el, opts) {
    if (opts === undefined) opts = {};
    //if (!VISIBLE(el)) return false;
    clearFocused();
    el.classList.add('focused');
    //if (typeof Animations !== 'undefined') Animations.animateFocus(el);
    if (opts.nativeFocus) try { el.focus(); } catch (e) { } else blurEditor();

    var container = null;
    var s = AppState.currentScreen;
    var isFI = el.classList && el.classList.contains('file-item');
    var isAC = el.classList && el.classList.contains('catalog-actor-card');
    var isRC = el.classList && el.classList.contains('catalog-recommendation-card');
    var isTC = el.classList && el.classList.contains('catalog-trailer-card-item');

    if (s === 'catalog' || s === 'torrents' || s === 'config') {
        container = getEl('main-container');
    } else if (s === 'search') {
        container = getEl('search-results');
    } else if (s === 'detail') {
        if (isFI) {
            container = getEl('files-list');
        } else if (isAC) {
            // Для актеров используем wrap контейнер (который реально скроллится)
            container = getEl('catalog-detail-actors-wrap');
            // Если wrap не найден, пробуем найти родителя
            if (!container && el.closest) {
                container = el.closest('.catalog-detail-actors-wrap');
            }
        } else if (isRC) {
            // Для рекомендаций используем wrap контейнер
            container = getEl('catalog-detail-recommendations-wrap');
            if (!container && el.closest) {
                container = el.closest('.catalog-detail-recommendations-wrap');
            }
        } else if (isTC) {
            // Для трейлеров используем wrap контейнер
            container = getEl('catalog-detail-trailers-wrap');
            if (!container && el.closest) {
                container = el.closest('.catalog-detail-trailers-wrap');
            }
        } else {
            container = getEl('detail-view');
        }
    } else if (s === 'player') {
        var parent = el.parentElement;
        if (parent) {
            container = getEl(parent.id);
        } else {
            console.log('У элемента нет родителя или родитель не является HTML-элементом');
        }
    }

    // Проверяем видимость и скроллим если нужно
    if (container && !isElementFullyVisible(el, container) || el.id === 'back-from-detail' || el.id === 'catalog-watch-btn' || el.id === 'tab-catalog') {
        scrollToElementIfNeeded(el, container, !fastNavigation);
    }

    return true;
}
function byId(id) { return getEl(id); };
function clickEl(el) { try { if (el && el.click) el.click(); } catch (e) { } };
var configState = {
    activeTabId: 'torrserver-tab',
    isOnMenu: true,
    previousFocusElement: null,
    initialized: false
};
// ==================== TV FOCUS RESCUE (Оптимизировано) ====================
function setupFocusRescue() {
    //var VISIBLE = function (el) { return !!(el && el.offsetParent !== null && !el.disabled); };
    //var byId = function (id) { return getEl(id); };
    //var clearFocused = function () { var f = document.querySelectorAll('.focused'); for (var i = 0; i < f.length; i++) { if (typeof gsap !== 'undefined') gsap.killTweensOf(f[i]); f[i].style.boxShadow = ''; f[i].style.transform = ''; f[i].style.scale = ''; f[i].style.translate = ''; f[i].classList.remove('focused'); } };
    //var clickEl = function (el) { try { if (el && el.click) el.click(); } catch (e) { } };
    //var blurEditor = function () { var a = document.activeElement; if (a && a !== document.body && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA')) try { a.blur(); } catch (e) { } };

    function getConfigMenuItems() {
        var ids = ['torrserver-tab', 'torrents-tab', 'player-tab', 'sync-tab'];
        var visibleItems = [];
        for (var i = 0; i < ids.length; i++) {
            var element = getEl(ids[i]);
            if (VISIBLE(element)) {
                visibleItems.push(element);
            }
        }
        return visibleItems;
    }

    function switchConfigTab(tabId) {
        // Скрываем все вкладки с контентом
        var tabContents = document.querySelectorAll('.tab-content');
        for (var i = 0; i < tabContents.length; i++) {
            tabContents[i].style.display = 'none';
        }

        // Показываем выбранную вкладку (добавляем '-content' к id)
        var selectedTab = getEl(tabId + '-content');
        if (selectedTab) {
            selectedTab.style.display = 'block';
        }
    }

    function setConfigMenuActive(menuItemId) {
        var menuItems = getConfigMenuItems();
        for (var i = 0; i < menuItems.length; i++) {
            if (menuItems[i].id === menuItemId) {
                menuItems[i].classList.add('active');
            } else {
                menuItems[i].classList.remove('active');
            }
        }
    }

    var customFilterMenuState = null;
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

    //function currentScreen() { try { var ss = window.AppState && AppState.currentScreen ? AppState.currentScreen : null, p = getEl('player-screen'), d = getEl('detail-view'), c = getEl('config-screen'), s = getEl('search-overlay'), ct = getEl('tab-catalog'), dn = getEl('donate-overlay'), sy = getEl('sync-overlay'); if (ss === 'player') return 'player'; if (p && getComputedStyle(p).display !== 'none') return 'player'; if (sy && !sy.classList.contains('hidden') && getComputedStyle(sy).display !== 'none') return 'sync'; if (c && getComputedStyle(c).display !== 'none') return 'config'; if (d && getComputedStyle(d).display !== 'none') return 'detail'; if (s && !s.classList.contains('hidden') && getComputedStyle(s).display !== 'none') return 'search'; if (dn && !dn.classList.contains('hidden') && getComputedStyle(dn).display !== 'none') return 'donate'; if (AppState.inSearch == 'catalog') return 'catalog'; var cg = getEl('torrents-grid'); if (cg) { var hc = cg.querySelector('.catalog-card,.catalog-folder-card') !== null, tc = cg.querySelector('.torrent-card:not(.catalog-card):not(.catalog-folder-card)') !== null; if (hc && !tc) return 'catalog'; } return ss || 'torrents'; } catch (e) { return 'torrents'; } }

    function getTorrentCards() { var c = document.querySelectorAll('.torrent-card'), v = []; for (var i = 0; i < c.length; i++) if (VISIBLE(c[i])) v.push(c[i]); return v; }
    function getTorrentHeader() { var ids = ['settings-btn'], v = []; for (var i = 0; i < ids.length; i++) { var e = getEl(ids[i]); if (VISIBLE(e)) v.push(e); } return v; }
    function getTorrentTabs() { var ids = ['tab-catalog', 'tab-torrents', 'tab-search', 'tab-donate'], v = []; for (var i = 0; i < ids.length; i++) { var e = getEl(ids[i]); if (VISIBLE(e)) v.push(e); } return v; }
    function getSearchTop() { var ids = ['search-query', 'filter-toggle', 'search-btn', 'close-search'], v = []; for (var i = 0; i < ids.length; i++) { var e = getEl(ids[i]); if (VISIBLE(e)) v.push(e); } return v; }
    function getSearchFilters() { var ids = ['torrent-movie', 'sort-by', 'filter-quality', 'filter-content-type', 'filter-tracker', 'filter-year', 'filter-season', 'filter-voice', 'filter-videotype', 'reset-filters'], v = []; for (var i = 0; i < ids.length; i++) { var e = getEl(ids[i]); if (VISIBLE(e)) v.push(e); } return v; }
    function getSearchResults() { var cm = typeof window.getCurrentSearchMode === 'function' ? window.getCurrentSearchMode() : 'torrentsearch'; if (cm === 'torrentsearch') { var i = document.querySelectorAll('.search-result-item'), v = []; for (var j = 0; j < i.length; j++) if (VISIBLE(i[j])) v.push(i[j]); return v; } else if (cm === 'globalsearch') { var i = document.querySelectorAll('.global-search-card'), v = []; for (var j = 0; j < i.length; j++) if (VISIBLE(i[j])) v.push(i[j]); return v; } return []; }
    function getDetailItems() { var s = ['.back-btn', '.detail-progress-btn', '.file-item', '#catalog-watch-btn', '.catalog-trailer-link', '.catalog-trailer-play', '.catalog-trailer-card-item', '#catalog-trailer-close', '.catalog-actor-card', '.catalog-recommendation-card'], a = []; for (var i = 0; i < s.length; i++) { var it = document.querySelectorAll(s[i]); for (var j = 0; j < it.length; j++) if (VISIBLE(it[j])) a.push(it[j]); } return a; }
    function getConfigItems() {
        var ids = [
            'torrserver-url',
            'auth-checkbox',
            'auth-login',
            'auth-password',
            'jacred-url',
            '.settings-btn',
            'sync-clients-btn',
            'speedtest-btn',
            'auto-fullscreen',
            'hide-clock',
            'add-to-db',
            'multi-channel-audio'
        ];

        var visibleItems = [];

        for (var i = 0; i < ids.length; i++) {
            var element = getEl(ids[i]);
            if (VISIBLE(element)) {
                visibleItems.push(element);
            }
        }

        var settingsButtons = document.querySelectorAll('.settings-btn');

        for (var j = 0; j < settingsButtons.length; j++) {
            if (VISIBLE(settingsButtons[j])) {
                visibleItems.push(settingsButtons[j]);
            }
        }

        return visibleItems;
    }

    function getConfigContentItems(tabId) {
        // tabId приходит как 'torrserver-tab', 'torrents-tab' и т.д.
        // Добавляем '-content' чтобы получить id контейнера
        var tabContentId = tabId + '-content';
        var tabContent = getEl(tabContentId);

        if (!tabContent) return [];

        var visibleItems = [];

        // Ищем все интерактивные элементы внутри вкладки
        var interactiveSelectors = [
            'input:not([type="hidden"])',
            'button',
            'select',
            'textarea'
        ];

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

    function getColumns() { return 6; }
    function belongsToScreen(el, screen) {
        if (!el) {
            return false;
        }

        if (screen === 'torrents') {
            return el.closest('.torrent-card') ||
                el.classList.contains('file-item') ||
                ['search-query', 'search-btn', 'settings-btn', 'tab-torrents', 'tab-search', 'tab-donate', 'back-from-detail', 'tab-catalog'].indexOf(el.id) !== -1;
        }

        if (screen === 'catalog') {
            return el.closest('.torrent-card.catalog-card') ||
                el.closest('.torrent-card.catalog-folder-card') ||
                (el.closest('#torrents-grid') && !el.closest('.torrent-card:not(.catalog-card):not(.catalog-folder-card)')) ||
                el.id === 'back-from-catalog' ||
                el.classList.contains('file-item') ||
                el.classList.contains('back-btn') ||
                ['search-query', 'search-btn', 'settings-btn', 'tab-torrents', 'tab-search', 'tab-catalog', 'tab-donate'].indexOf(el.id) !== -1;
        }

        if (screen === 'search') {
            return el.closest('.search-result-item') ||
                el.closest('.global-search-card') ||
                ['search-query', 'filter-toggle', 'search-btn', 'close-search', 'torrent-movie', 'sort-by', 'filter-quality', 'filter-content-type', 'filter-tracker', 'filter-year', 'filter-season', 'filter-voice', 'filter-videotype', 'reset-filters'].indexOf(el.id) !== -1;
        }

        if (screen === 'detail') {
            return !!(el.closest('#detail-view') ||
                el.closest('.file-item') ||
                el.closest('back-from-detail') ||
                el.classList.contains('detail-progress-btn') ||
                el.classList.contains('back-btn'));
        }

        if (screen === 'config') {
            return !!(el.closest('#config-screen') ||
                ['torrserver-url', 'auth-checkbox', 'auth-login', 'auth-password', 'sync-clients-btn', 'speedtest-btn', 'auto-fullscreen', 'hide-clock', 'add-to-db', 'multi-channel-audio', 'torrserver-tab', 'torrents-tab', 'player-tab', 'sync-tab', 'jacred-url'].indexOf(el.id) !== -1 ||
                el.classList.contains('settings-btn') ||
                el.classList.contains('menu-item'));
        }

        return false;
    }

    function ensureTorrentFocus(force) { if (force === undefined) force = false; if (currentScreen() !== 'torrents') return false; if (window.AppState && AppState.restoringFocus) return false; var f = document.querySelector('.focused'); if (!force && belongsToScreen(f, 'torrents')) return true; var c = getTorrentCards(), t = getTorrentTabs(), h = getTorrentHeader(); if (!c.length) return focusEl(t[0] || h[0]); var tc = null, sh = (window.AppState && window.AppState.currentDetailItem && window.AppState.currentDetailItem.hash) ? window.AppState.currentDetailItem.hash.toLowerCase() : null; if (sh) for (var i = 0; i < c.length; i++) if (c[i].dataset.hash && c[i].dataset.hash.toLowerCase() === sh) { tc = c[i]; break; } if (!tc && typeof window.lastSelectedTorrentHash !== 'undefined' && window.lastSelectedTorrentHash) for (var i = 0; i < c.length; i++) if (c[i].dataset.hash && c[i].dataset.hash.toLowerCase() === window.lastSelectedTorrentHash.toLowerCase()) { tc = c[i]; break; } if (!tc && typeof window.lastSelectedTorrentIndex === 'number' && window.lastSelectedTorrentIndex >= 0) { var si = window.lastSelectedTorrentIndex; if (si < c.length) tc = c[si]; } if (!tc) tc = c[0]; if (window.AppState && window.AppState.currentDetailItem) window.AppState.currentDetailItem = null; if (window.lastSelectedTorrentHash) window.lastSelectedTorrentHash = null; if (typeof window.lastSelectedTorrentIndex !== 'undefined') window.lastSelectedTorrentIndex = 0; return focusEl(tc); }

    function ensureCatalogFocus(force) { if (force === undefined) force = false; if (currentScreen() !== 'catalog') return false; var f = document.querySelector('.focused'); if (!force && f && belongsToScreen(f, 'catalog')) return true; var c = [], ac = document.querySelectorAll('.torrent-card.catalog-card, .torrent-card.catalog-folder-card'); for (var i = 0; i < ac.length; i++) if (VISIBLE(ac[i])) c.push(ac[i]); if (!c.length) return false; var si = localStorage.getItem('lastCatalogCardIndex'), tc = null; if (si !== null) { var sn = parseInt(si, 10); if (Number.isFinite(sn)) { for (var j = 0; j < c.length; j++) { var cn = parseInt(c[j].dataset.numIndex || '-1', 10); if (Number.isFinite(cn) && cn === sn) { tc = c[j]; break; } } if (!tc && sn >= 0 && sn < c.length) tc = c[sn]; } } if (!tc) tc = c[0]; var ti = -1; for (var k = 0; k < c.length; k++) if (tc === c[k]) { ti = k; break; } return focusEl(tc); }

    function ensureSearchFocus(force, preferInput) { if (force === undefined) force = false; if (preferInput === undefined) preferInput = true; if (currentScreen() !== 'search') return false; var f = document.querySelector('.focused'); if (!force && belongsToScreen(f, 'search')) return true; var t = getSearchTop(), fl = getSearchFilters(), r = getSearchResults(), q = getEl('search-query'); return focusEl((preferInput && q) ? q : (t[0] || fl[0] || r[0] || q)); }
    function ensureDetailFocus(force) { if (force === undefined) force = false; if (currentScreen() !== 'detail') return false; var f = document.querySelector('.focused'); if (!force && belongsToScreen(f, 'detail')) return true; return focusEl(getDetailItems()[0] || getEl('back-from-detail')); }
    function ensureConfigFocus(force) {
        if (force === undefined) {
            force = false;
        }

        if (currentScreen() !== 'config') {
            return false;
        }

        // Инициализация при первом открытии экрана config
        if (!configState.initialized) {
            configState.initialized = true;
            configState.activeTabId = 'torrserver-tab';
            configState.isOnMenu = true;
            switchConfigTab('torrserver-tab');
            setConfigMenuActive('torrserver-tab');
        }

        var focusedElement = document.querySelector('.focused');

        if (!force && belongsToScreen(focusedElement, 'config')) {
            return true;
        }

        var menuItems = getConfigMenuItems();

        if (configState.isOnMenu) {
            var targetMenuItem = getEl(configState.activeTabId);
            if (targetMenuItem && VISIBLE(targetMenuItem)) {
                return focusEl(targetMenuItem);
            }
            return focusEl(menuItems[0]);
        } else {
            var contentItems = getConfigContentItems(configState.activeTabId);
            if (contentItems.length > 0) {
                return focusEl(contentItems[0]);
            }
            configState.isOnMenu = true;
            return focusEl(getEl(configState.activeTabId));
        }
    }

    window.focusFirstTorrentCard = function () { return ensureTorrentFocus(true); };
    window.focusFirstCatalogCard = function () { return ensureCatalogFocus(true); };
    window.focusSearchHome = function (p) { if (p === undefined) p = true; return ensureSearchFocus(true, p); };
    window.ensureCatalogFocus = ensureCatalogFocus; window.ensureDetailFocus = ensureDetailFocus; window.ensureTorrentFocus = ensureTorrentFocus; window.ensureSearchFocus = ensureSearchFocus; window.ensureConfigFocus = ensureConfigFocus;

    function openSearchScreen(fi) {
        if (fi === undefined) fi = true;
        clickEl(getEl('tab-search') || getEl('search-btn'));
        setTimeout(function () {
            ensureSearchFocus(true, fi);
            if (fi) {
                var q = getEl('search-query');
                focusEl(q, { nativeFocus: true });
                try {
                    if (q && q.click) q.click();
                } catch (e) { }
                try {
                    if (q && q.select) q.select();
                } catch (e) { }
            }
        }, 120);
    }
    function leaveSearchToTorrents() { if (typeof window.hideSearchResults === 'function') window.hideSearchResults(); else { clickEl(getEl('close-search') || getEl('tab-torrents')); setTimeout(function () { var rt = (window.AppState && AppState.searchReturnTo === 'catalog') ? 'catalog' : 'torrents'; if (rt === 'catalog') ensureCatalogFocus(true); else ensureTorrentFocus(true); }, 150); } }

    function torrentHandle(dir) { var f = (belongsToScreen(document.querySelector('.focused'), 'torrents') ? document.querySelector('.focused') : null), c = getTorrentCards(), h = getTorrentHeader(), t = getTorrentTabs(), cols = getColumns(); if (!f) return ensureTorrentFocus(true); var ci = -1, hi = -1, ti = -1; for (var i = 0; i < c.length; i++) if (f === c[i]) { ci = i; break; } for (var i = 0; i < h.length; i++) if (f === h[i]) { hi = i; break; } for (var i = 0; i < t.length; i++) if (f === t[i]) { ti = i; break; } if (ci !== -1) { var row = Math.floor(ci / cols); if (dir === 'left') return focusEl(c[Math.max(0, ci - 1)] || f); if (dir === 'right') return focusEl(c[Math.min(c.length - 1, ci + 1)] || f); if (dir === 'up') { if (row === 0) return focusEl(t[0] || h[0] || f); else if (row === 1) { return focusEl(c[Math.max(0, ci - cols)] || f); } return focusEl(c[Math.max(0, ci - cols)] || f); } if (dir === 'down') return focusEl(c[Math.min(c.length - 1, ci + cols)] || f); return true; } if (ti !== -1) { if (dir === 'left') return focusEl(t[Math.max(0, ti - 1)] || f); if (dir === 'right') return focusEl(t[Math.min(t.length - 1, ti + 1)] || f); if (dir === 'down') return focusEl(c[0] || f); if (dir === 'up') return focusEl(h[Math.min(ti, h.length - 1)] || h[0] || f); return true; } if (hi !== -1) { if (dir === 'left') return focusEl(h[Math.max(0, hi - 1)] || f); if (dir === 'right') return focusEl(h[Math.min(h.length - 1, hi + 1)] || f); if (dir === 'down') return focusEl((f.id === 'settings-btn' ? t[0] : t[1]) || t[0] || c[0] || f); return true; } return false; }

    function catalogHandle(dir) { var f = (belongsToScreen(document.querySelector('.focused'), 'catalog') ? document.querySelector('.focused') : null), c = [], ac = document.querySelectorAll('.torrent-card.catalog-card,.torrent-card.catalog-folder-card'); for (var i = 0; i < ac.length; i++) if (VISIBLE(ac[i])) c.push(ac[i]); var h = getTorrentHeader(), t = getTorrentTabs(), cols = getColumns(); if (!f) return ensureCatalogFocus(true); var ci = -1, hi = -1, ti = -1; for (var i = 0; i < c.length; i++) if (f === c[i]) { ci = i; break; } for (var i = 0; i < h.length; i++) if (f === h[i]) { hi = i; break; } for (var i = 0; i < t.length; i++) if (f === t[i]) { ti = i; break; } if (ci !== -1) { var row = Math.floor(ci / cols); if (dir === 'left') { if (ci > 0 && ci % cols !== 0) return focusEl(c[Math.max(0, ci - 1)] || f); return true; } if (dir === 'right') { if (ci < c.length - 1 && (ci + 1) % cols !== 0) return focusEl(c[Math.min(c.length - 1, ci + 1)] || f); return true; } if (dir === 'up') { if (row === 0) return focusEl(t[0] || h[0] || f); else if (row === 1) { return focusEl(c[Math.max(0, ci - cols)] || f); } return focusEl(c[Math.max(0, ci - cols)] || f); } if (dir === 'down') { if (ci + cols < c.length) return focusEl(c[Math.min(c.length - 1, ci + cols)] || f); else if (c.length < catalogState.totalItems && !catalogState.isLoadingMore) { window.loadMoreCatalogItems().then(function () { setTimeout(function () { var nc = [], nac = document.querySelectorAll('.torrent-card.catalog-card,.torrent-card.catalog-folder-card'); for (var m = 0; m < nac.length; m++) if (VISIBLE(nac[m])) nc.push(nac[m]); var ti = Math.min(ci + cols, nc.length - 1); if (ti >= 0 && ti < nc.length && nc[ti]) focusEl(nc[ti]); }, 50); }); return true; } return true; } return true; } if (ti !== -1) { if (dir === 'left') return focusEl(t[Math.max(0, ti - 1)] || f); if (dir === 'right') return focusEl(t[Math.min(t.length - 1, ti + 1)] || f); if (dir === 'down') return focusEl(c[0] || f); if (dir === 'up') return focusEl(h[Math.min(ti, h.length - 1)] || h[0] || f); return true; } if (hi !== -1) { if (dir === 'left') return focusEl(h[Math.max(0, hi - 1)] || f); if (dir === 'right') return focusEl(h[Math.min(h.length - 1, hi + 1)] || f); if (dir === 'down') return focusEl((f.id === 'settings-btn' ? t[0] : t[1]) || t[0] || c[0] || f); return true; } return false; }

    function detailHandle(dir) {
        var items = getDetailItems(), f = (belongsToScreen(document.querySelector('.focused'), 'detail') ? document.querySelector('.focused') : null); if (!f) return ensureDetailFocus(true); var idx = -1; for (var i = 0; i < items.length; i++) if (f === items[i]) { idx = i; break; } if (idx === -1) return ensureDetailFocus(true); var tl = [], ac = [], rc = [], fi = []; for (var i = 0; i < items.length; i++) { var e = items[i]; if (e.classList.contains('catalog-trailer-play') || e.classList.contains('catalog-trailer-link') || e.classList.contains('catalog-trailer-card-item')) tl.push(e); if (e.classList.contains('catalog-actor-card')) ac.push(e); if (e.classList.contains('catalog-recommendation-card')) rc.push(e); if (e.classList && e.classList.contains('file-item')) fi.push(e); } var wb = getEl('catalog-watch-btn'), bb = getEl('back-from-detail'); var isT = f.classList.contains('catalog-trailer-play') || f.classList.contains('catalog-trailer-link') || f.classList.contains('catalog-trailer-card-item'), isA = f.classList.contains('catalog-actor-card'), isR = f.classList.contains('catalog-recommendation-card'), isW = f.id === 'catalog-watch-btn', isB = f.id === 'back-from-detail', isF = f.classList && f.classList.contains('file-item'); var ti = -1, ai = -1, ri = -1, fii = -1; for (var i = 0; i < tl.length; i++) if (f === tl[i]) { ti = i; break; } for (var i = 0; i < ac.length; i++) if (f === ac[i]) { ai = i; break; } for (var i = 0; i < rc.length; i++) if (f === rc[i]) { ri = i; break; } for (var i = 0; i < fi.length; i++) if (f === fi[i]) { fii = i; break; }
        if (isF && fii !== -1) { if (dir === 'left') { if (fii > 0) { focusEl(fi[fii - 1]); } return true; } if (dir === 'right') { if (fii < fi.length - 1) { focusEl(fi[fii + 1]); } return true; } if (dir === 'up') { var prevItems = []; for (var k = idx - 1; k >= 0; k--) { if (!items[k].classList || !items[k].classList.contains('file-item')) { prevItems.push(items[k]); } } if (prevItems.length > 0) { focusEl(prevItems[0]); } return true; } if (dir === 'down') return true; return true; }
        if (isT && ti !== -1) { if (dir === 'left') return focusEl(tl[Math.max(0, ti - 1)] || f); if (dir === 'right') return focusEl(tl[Math.min(tl.length - 1, ti + 1)] || f); if (dir === 'up') { if (wb && wb.offsetParent !== null) { focusEl(wb); return true; } return focusEl(items[Math.max(0, idx - 1)] || f); } if (dir === 'down') { if (ac.length > 0) { focusEl(ac[0]); return true; } else if (rc.length > 0) { focusEl(rc[0]); return true; } else if (fi.length > 0) { focusEl(fi[0]); return true; } return true; } return true; }
        if (isA && ai !== -1) { if (dir === 'left') return focusEl(ac[Math.max(0, ai - 1)] || f); if (dir === 'right') return focusEl(ac[Math.min(ac.length - 1, ai + 1)] || f); if (dir === 'up') { if (tl.length > 0) { focusEl(tl[tl.length - 1]); return true; } else if (wb && wb.offsetParent !== null) { focusEl(wb); return true; } return focusEl(items[Math.max(0, idx - 1)] || f); } if (dir === 'down') { if (rc.length > 0) { var t = ai < rc.length ? ai : rc.length - 1; focusEl(rc[t]); return true; } else if (fi.length > 0) { focusEl(fi[0]); return true; } return true; } return true; }
        if (isR && ri !== -1) { if (dir === 'left') return focusEl(rc[Math.max(0, ri - 1)] || f); if (dir === 'right') return focusEl(rc[Math.min(rc.length - 1, ri + 1)] || f); if (dir === 'up') { if (ac.length > 0) { var t = ri < ac.length ? ri : ac.length - 1; focusEl(ac[t]); return true; } else if (tl.length > 0) { var t = ri < tl.length ? ri : tl.length - 1; focusEl(tl[t]); return true; } else if (wb && wb.offsetParent !== null) { focusEl(wb); return true; } return focusEl(items[Math.max(0, idx - 1)] || f); } if (dir === 'down') { if (fi.length > 0) { focusEl(fi[0]); return true; } return true; } return true; }
        if (isW) { if (dir === 'down') { if (tl.length > 0) { focusEl(tl[0]); return true; } else if (ac.length > 0) { focusEl(ac[0]); return true; } else if (rc.length > 0) { focusEl(rc[0]); return true; } else if (fi.length > 0) { focusEl(fi[0]); return true; } return true; } if (dir === 'left' || dir === 'right') return true; if (dir === 'up') return focusEl(bb || f); return true; }
        if (isB) { if (dir === 'down') { if (wb && wb.offsetParent !== null) { focusEl(wb); return true; } return focusEl(items[Math.min(items.length - 1, idx + 1)] || f); } if (dir === 'up') { return true; } if (dir === 'left' || dir === 'right') return true; return true; }
        if (dir === 'up') { var t = items[Math.max(0, idx - 1)] || f; focusEl(t); return true; } if (dir === 'down') { var t = items[Math.min(items.length - 1, idx + 1)] || f; focusEl(t); return true; } return true;
    }

    function closeFiltersPanel() { var p = getEl('search-filters-panel'), t = getEl('filter-toggle'); if (p && !p.classList.contains('collapsed')) { if (typeof toggleSearchFiltersPanel === 'function') toggleSearchFiltersPanel(false); else if (t) t.click(); } }
    function openFiltersPanelAndFocus() { var p = getEl('search-filters-panel'), t = getEl('filter-toggle'); if (p && p.classList.contains('collapsed')) { if (typeof toggleSearchFiltersPanel === 'function') toggleSearchFiltersPanel(true); else if (t) t.click(); setTimeout(function () { updateFocusableElements(); var ff = document.querySelector('#torrent-movie,#sort-by,#filter-quality,#filter-content-type,#filter-tracker,#filter-year,#filter-season,#filter-voice,#filter-videotype,#reset-filters'); if (ff) { var fi = -1; for (var i = 0; i < focusableElements.length; i++) if (focusableElements[i] === ff) { fi = i; break; } if (fi !== -1) setFocus(fi); } }, 50); } }

    function searchHandle(dir) {
        var cm = getCurrentSearchMode(), f = belongsToScreen(document.querySelector('.focused'), 'search') ? document.querySelector('.focused') : null, q = getEl('search-query'), t = getSearchTop(), fl = getSearchFilters(), r = getSearchResults(), tWQ = []; for (var i = 0; i < t.length; i++) if (t[i] && t[i].id !== 'search-query') tWQ.push(t[i]); var te = tWQ[0] || fl[0] || r[0] || q; if (!f) return ensureSearchFocus(true, false); if (document.activeElement === q && ['left', 'right', 'up', 'down'].indexOf(dir) !== -1) { blurEditor(); return focusEl(te); } var ti = -1, fi = -1, ri = -1; for (var i = 0; i < t.length; i++) if (f === t[i]) { ti = i; break; } for (var i = 0; i < fl.length; i++) if (f === fl[i]) { fi = i; break; } for (var i = 0; i < r.length; i++) if (f === r[i]) { ri = i; break; }
        if (cm === 'torrentsearch') { if (ti !== -1) { if (dir === 'left') return focusEl(t[Math.max(0, ti - 1)] || f); if (dir === 'right') return focusEl(t[Math.min(t.length - 1, ti + 1)] || f); if (dir === 'down') return focusEl(r[Math.min(r.length - 1, ri + 1)] || f); if (dir === 'up') return true; return true; } if (fi !== -1) { if (dir === 'left') return focusEl(fl[Math.max(0, fi - 1)] || f); if (dir === 'right') return focusEl(fl[Math.min(fl.length - 1, fi + 1)] || f); if (dir === 'up') { closeFiltersPanel(); return focusEl(q); } if (dir === 'down') { closeFiltersPanel(); if (r.length > 0) { return focusEl(r[0]); } return true; } return true; } if (ri !== -1) { if (dir === 'up') { if (ri === 1) { return focusEl(r[ri - 1] || f); } else if (ri > 1) return focusEl(r[ri - 1] || f); return focusEl(q); } if (dir === 'down') { var ar = r.length; if (ar === ri + 1) { return focusEl(r[Math.min(r.length - 1, ri + 1)] || f); } else return focusEl(r[Math.min(r.length - 1, ri + 1)] || f); } if (dir === 'left') { openFiltersPanelAndFocus(); return true; } if (dir === 'right') { if (f && (f.classList.contains('search-result-item') || f.classList.contains('global-search-card'))) { var pb = f.querySelector('.search-result-play'), m = pb ? pb.dataset.magnet : null, h = pb ? pb.dataset.hash : null, sr = pb ? pb.dataset.result : null; try { var rj = decodeURIComponent(sr); sr = JSON.parse(rj); } catch (e) { console.error('Ошибка парсинга searchResult:'); } if (m && typeof window.addTorrentSearchToServer === 'function') window.addTorrentSearchToServer(m, h, sr).then(function () { var oh = pb.innerHTML; pb.style.display = 'block'; pb.innerHTML = '✓'; setTimeout(function () { pb.style.display = 'none'; pb.innerHTML = oh; }, 2000); }).catch(function (e) { console.error('Ошибка добавления торрента:', e); }); } return true; } return true; } return false; }
        else if (cm === 'globalsearch') { if (ti !== -1) { if (dir === 'left') return focusEl(t[Math.max(0, ti - 1)] || f); if (dir === 'right') return focusEl(t[Math.min(t.length - 1, ti + 1)] || f); if (dir === 'down') { if (r.length > 0) return focusEl(r[0]); return true; } if (dir === 'up') return true; return true; } if (fi !== -1) { if (dir === 'left') return focusEl(fl[Math.max(0, fi - 1)] || f); if (dir === 'right') return focusEl(fl[Math.min(fl.length - 1, fi + 1)] || f); if (dir === 'up') { closeFiltersPanel(); return focusEl(q); } if (dir === 'down') { closeFiltersPanel(); if (r.length > 0) return focusEl(r[0]); return true; } return true; } if (ri !== -1) { var cols = getColumns(), row = Math.floor(ri / cols); if (dir === 'left') return focusEl(r[Math.max(0, ri - 1)] || f); if (dir === 'right') return focusEl(r[Math.min(r.length - 1, ri + 1)] || f); if (dir === 'up') { if (row === 0) return focusEl(q); return focusEl(r[Math.max(0, ri - cols)] || f); } if (dir === 'down') return focusEl(r[Math.min(r.length - 1, ri + cols)] || f); return true; } return false; }
        return false;
    }

    function scrollToActiveConfigItem() { var ai = document.querySelector('#config-screen .focused'), cs = document.querySelector('#config-screen'), it = getConfigItems(); if (!ai || !cs) return; var sc = cs; while (sc && sc.scrollHeight <= sc.clientHeight) { sc = sc.parentElement; if (!sc || sc === document.body) { sc = window; break; } } var iw = (sc === window), cur = iw ? window.scrollY : sc.scrollTop, ci = -1; for (var i = 0; i < it.length; i++) if (ai === it[i]) { ci = i; break; } var ar = ai.getBoundingClientRect(), ct = iw ? 0 : sc.getBoundingClientRect().top, ot = ar.top - ct; if (ci === it.length - 2) { if (iw) window.scrollTo(0, document.body.scrollHeight - window.innerHeight); else sc.scrollTop = sc.scrollHeight - sc.clientHeight; return; } if (ci === 1) { if (iw) window.scrollTo(0, 0); else sc.scrollTop = 0; return; } var ch = iw ? window.innerHeight : sc.clientHeight; if (ot < 0) { var ns = cur + ot - 10; if (iw) window.scrollTo(0, ns); else sc.scrollTop = ns; } else if (ot + ar.height > ch) { var ns = cur + (ot + ar.height - ch) + 10; if (iw) window.scrollTo(0, ns); else sc.scrollTop = ns; } }
    function handleConfigNavigation(dir) {
        if (currentScreen() !== 'config') return false;

        var menuItems = getConfigMenuItems();
        var currentFocused = document.querySelector('.focused');

        if (!currentFocused) {
            ensureConfigFocus(true);
            return true;
        }

        // Проверяем, находится ли фокус на пункте меню
        var isOnMenu = false;
        var currentMenuIndex = -1;
        for (var i = 0; i < menuItems.length; i++) {
            if (currentFocused === menuItems[i]) {
                isOnMenu = true;
                currentMenuIndex = i;
                break;
            }
        }

        if (isOnMenu) {
            if (dir === 'up') {
                if (currentMenuIndex > 0) {
                    var targetIndex = currentMenuIndex - 1;
                    var targetMenuItem = menuItems[targetIndex];
                    var targetTabId = targetMenuItem.id;

                    // Переключаем вкладку и контент
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

                    // Переключаем вкладку и контент
                    configState.activeTabId = targetTabId;
                    switchConfigTab(targetTabId);
                    setConfigMenuActive(targetTabId);

                    return focusEl(targetMenuItem);
                }
                return true;
            }

            if (dir === 'left' || dir === 'right') {
                return true;
            }

            if (dir === 'enter') {
                // Нажатие OK на пункте меню - переключаемся на контент
                var selectedTabId = currentFocused.id;
                configState.activeTabId = selectedTabId;
                configState.isOnMenu = false;
                setConfigMenuActive(selectedTabId);

                // Контент уже должен быть виден от навигации, но убеждаемся
                switchConfigTab(selectedTabId);

                var contentItems = getConfigContentItems(selectedTabId);
                if (contentItems.length > 0) {
                    return focusEl(contentItems[0]);
                }
                return true;
            }

            if (dir === 'back') {
                return true;
            }
        } else {
            // Фокус на контенте вкладки
            var contentItems = getConfigContentItems(configState.activeTabId);
            var currentContentIndex = -1;
            for (var i = 0; i < contentItems.length; i++) {
                if (currentFocused === contentItems[i]) {
                    currentContentIndex = i;
                    break;
                }
            }

            if (dir === 'up') {
                if (currentContentIndex > 0) {
                    return focusEl(contentItems[currentContentIndex - 1]);
                }
                return true;
            }

            if (dir === 'down') {
                if (currentContentIndex < contentItems.length - 1 && currentContentIndex !== -1) {
                    return focusEl(contentItems[currentContentIndex + 1]);
                }
                return true;
            }

            if (dir === 'left' || dir === 'right') {
                return true;
            }

            if (dir === 'enter') {
                if (currentFocused) {
                    var isTextInput = (currentFocused.tagName === 'INPUT' && currentFocused.type !== 'checkbox') ||
                        currentFocused.tagName === 'TEXTAREA' ||
                        currentFocused.isContentEditable;

                    if (isTextInput) {
                        if (document.activeElement === currentFocused) {
                            currentFocused.blur();  // Если элемент в фокусе - убираем фокус
                        } else {
                            currentFocused.focus(); // Если не в фокусе - ставим фокус
                        }
                    } else {
                        // Для всех остальных элементов (checkbox, button, div и т.д.) - кликаем
                        if (typeof currentFocused.click === 'function') {
                            currentFocused.click();
                        }
                    }
                }
                return true;
            }

            if (dir === 'back') {
                // Назад - возвращаемся на меню
                configState.isOnMenu = true;
                return focusEl(getEl(configState.activeTabId));
            }
        }
        return false;
    }
    function configHandle(dir) { return handleConfigNavigation(dir); var it = getConfigItems(), f = (belongsToScreen(document.querySelector('.focused'), 'config') ? document.querySelector('.focused') : null); if (!f) return ensureConfigFocus(true); var idx = -1; for (var i = 0; i < it.length; i++) if (f === it[i]) { idx = i; break; } if (idx === -1) return ensureConfigFocus(true); var isS = f.id === 'sync-clients-btn', isSp = f.id === 'speedtest-btn'; if (isS) { if (dir === 'right') { var s = getEl('speedtest-btn'); if (s && belongsToScreen(s, 'config')) { focusEl(s); } return true; } if (dir === 'up') { var n = it[Math.max(0, idx - 1)] || f; if (n) { focusEl(n); } return true; } if (dir === 'down') { var n = it[Math.min(it.length - 1, idx + 2)] || f; if (n) { focusEl(n); } return true; } return false; } if (isSp) { if (dir === 'left') { var s = getEl('sync-clients-btn'); if (s && belongsToScreen(s, 'config')) { focusEl(s); } return true; } if (dir === 'up') { var n = it[Math.max(0, idx - 2)] || f; if (n) { focusEl(n); } return true; } if (dir === 'down') { var n = it[Math.min(it.length - 1, idx + 1)] || f; if (n) { focusEl(n); } return true; } return false; } var nf = null; if (dir === 'up') nf = it[Math.max(0, idx - 1)] || f; else if (dir === 'down') nf = it[Math.min(it.length - 1, idx + 1)] || f; else if (dir === 'left' || dir === 'right') return true; else return false; if (nf) { focusEl(nf); } return false; }

    function onOk() { var s = currentScreen(), f = document.querySelector('.focused'); if (s === 'torrents') { if (!belongsToScreen(f, 'torrents')) return ensureTorrentFocus(true); if (f.id === 'search-query' || f.id === 'search-btn' || f.id === 'tab-search') return openSearchScreen(true); if (f.id === 'tab-catalog') { clickEl(f); return true; } clickEl(f); return true; } if (s === 'catalog') { if (!belongsToScreen(f, 'catalog')) return ensureCatalogFocus(true); clickEl(f); return true; } if (s === 'search') { if (!belongsToScreen(f, 'search')) return ensureSearchFocus(true, true); if (f.id === 'search-query') { focusEl(f, { nativeFocus: true }); try { f.click(); } catch (e) { } try { f.focus(); } catch (e) { } try { if (f.select) f.select(); } catch (e) { } return true; } var p = getEl('search-filters-panel'); if (f.id === 'filter-toggle') { if (p && p.classList.contains('collapsed')) { openFiltersPanelAndFocus(); return true; } else { closeFiltersPanel(); return true; } } if (f.tagName === 'SELECT' || f.id === 'filter-year') return openNativeSearchControl(f); clickEl(f); return true; } if (s === 'detail') { if (!belongsToScreen(f, 'detail')) return ensureDetailFocus(true); if (f.classList.contains('file-item')) { clickEl(f.querySelector('.play-btn') || f); return true; } if (f.classList.contains('detail-progress-btn')) { clickEl(f); return true; } clickEl(f); return true; } if (s === 'config') { if (!belongsToScreen(f, 'config')) return ensureConfigFocus(true); return handleConfigNavigation('enter'); } return false; }

    //function onBack() { var s = getEl('search-overlay'), d = getEl('detail-view'), c = getEl('config-screen'), cat = currentScreen() === 'catalog', dn = currentScreen() === 'donate'; if (AppState.syncCodeScreen == true) { toggleSyncOverlay(); return true; } if (typeof window.closeCatalogTrailerOverlay === 'function' && window.closeCatalogTrailerOverlay()) { setTimeout(function () { ensureDetailFocus(true); }, 80); return true; } if (s && !s.classList.contains('hidden') && getComputedStyle(s).display !== 'none') { if (typeof window.hideSearchResults === 'function') { window.hideSearchResults(); focusEl(getTorrentTabs()[2]); } else leaveSearchToTorrents(); return true; } if (d && getComputedStyle(d).display !== 'none') { clickEl(getEl('back-from-detail') || document.querySelector('.back-btn')); return true; } if (dn) { if (typeof window.closeDonateOverlay === 'function') window.closeDonateOverlay(); return true; } if (cat) { var h = document.querySelector('#torrents-grid .torrent-card.catalog-folder-card'); if (h) return true; if (window.catalogState) { window.catalogState.lastSelectedIndex = 0; window.catalogState.lastSelectedId = null; localStorage.removeItem('lastCatalogCardIndex'); } if (typeof window.backToCatalogList === 'function') { AppState.currentScreen = 'catalog'; window.backToCatalogList(); } else clickEl(getEl('back-from-catalog')); setTimeout(function () { ensureCatalogFocus(true); }, 180); return true; } if (c && getComputedStyle(c).display !== 'none') { var m = getEl('torrserver-section'); c.style.display = 'none'; if (m) m.style.display = 'block'; try { window.AppState.currentScreen = 'torrents'; } catch (e) { } setTimeout(function () { ensureTorrentFocus(true); }, 180); return true; } return false; }

    function isArrowKey(kc) { return [37, 38, 39, 40].indexOf(kc) !== -1 || (typeof isKeyPressed === 'function' && (isKeyPressed('UP', kc) || isKeyPressed('DOWN', kc) || isKeyPressed('LEFT', kc) || isKeyPressed('RIGHT', kc))); }
    function arrowDir(kc) { if ([37, 38, 39, 40].indexOf(kc) !== -1) return ({ 37: 'left', 38: 'up', 39: 'right', 40: 'down' })[kc]; if (typeof isKeyPressed === 'function') { if (isKeyPressed('UP', kc)) return 'up'; if (isKeyPressed('DOWN', kc)) return 'down'; if (isKeyPressed('LEFT', kc)) return 'left'; if (isKeyPressed('RIGHT', kc)) return 'right'; } return null; }
    function isOkKey(kc) { return kc === 13 || (typeof isKeyPressed === 'function' && isKeyPressed('OK', kc)); }
    function isBackKey(kc) { return [4, 8, 27, 461, 111, 10009].indexOf(kc) !== -1 || (typeof isKeyPressed === 'function' && (isKeyPressed('BACK', kc) || isKeyPressed('EXIT', kc))); }

    document.addEventListener('keydown', function (e) { var s = currentScreen(); if (s === 'player') return; if (['torrents', 'catalog', 'search', 'detail', 'config', 'donate'].indexOf(s) === -1) return; var a = document.activeElement, ed = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'); if (isBackKey(e.keyCode)) { if (ed) { var isEmpty = false; if (a.tagName === 'SELECT') { isEmpty = (a.selectedIndex === -1 || a.value === ''); } else { isEmpty = (a.value === '' || a.value === null); } if (!isEmpty && e.keyCode != 27) { return; } else { a.blur(); return; } }; e.preventDefault(); e.stopImmediatePropagation(); var po = getEl('playback-overlay'), ip = po && po.classList.contains('active'); if (ip) { cancelCurrentPlayback(); return; } if (isCustomFilterMenuOpen()) { closeCustomFilterMenu(); return; } if (s === 'catalog' && window.catalogState && window.catalogState.currentCatalog) { window.catalogState.lastSelectedIndex = 0; window.catalogState.lastSelectedId = null; localStorage.removeItem('lastCatalogCardIndex'); } if (ed) { blurEditor(); if (s === 'search') ensureSearchFocus(true, true); else if (s === 'catalog') ensureCatalogFocus(true); else if (s === 'config') ensureConfigFocus(true); else if (s === 'detail') ensureDetailFocus(true); else ensureTorrentFocus(true); return; } onBack(); return; } if (isArrowKey(e.keyCode)) { e.preventDefault(); e.stopImmediatePropagation(); var d = arrowDir(e.keyCode); if (isCustomFilterMenuOpen()) { if (d === 'up') moveCustomFilterMenu(-1); else if (d === 'down') moveCustomFilterMenu(1); return; } if (s === 'torrents') torrentHandle(d); else if (s === 'catalog') catalogHandle(d); else if (s === 'search') searchHandle(d); else if (s === 'detail') detailHandle(d); else if (s === 'config') configHandle(d); return; } if (isOkKey(e.keyCode)) { e.preventDefault(); e.stopImmediatePropagation(); if (isCustomFilterMenuOpen()) { applyCustomFilterMenuSelection(); return; } if (s === 'torrents') { var f = document.querySelector('.focused'); if (f && f.classList.contains('torrent-card')) { if (!e.repeat) { okHoldHandled = false; okHoldFocused = f; clearOkHold(); okHoldTimer = setTimeout(async function () { okHoldHandled = true; var h = okHoldFocused && okHoldFocused.dataset ? okHoldFocused.dataset.hash : null; if (typeof window.setTorrentClickSuppressed === 'function') window.setTorrentClickSuppressed(1500); if (okHoldFocused) okHoldFocused.dataset.suppressClick = '1'; if (h && typeof window.removeTorrentByHash === 'function') await window.removeTorrentByHash(h, { skipConfirm: true }); setTimeout(function () { if (okHoldFocused) delete okHoldFocused.dataset.suppressClick; }, 1500); }, 900); } return; } } onOk(); return; } }, true);

    document.addEventListener('keyup', function (e) { var s = currentScreen(); if (isCustomFilterMenuOpen()) return; if (!isOkKey(e.keyCode) || s !== 'torrents') return; var f = document.querySelector('.focused'), cs = f && okHoldFocused && f === okHoldFocused; clearOkHold(); if (!okHoldHandled && cs && f.classList.contains('torrent-card')) f.click(); okHoldHandled = false; okHoldFocused = null; }, true);

    var prevShow = window.showDetail; if (typeof prevShow === 'function') { window.showDetail = function () { var o = prevShow.apply(this, arguments); setTimeout(function () { if (currentScreen() !== 'player') ensureDetailFocus(true); }, 220); return o; }; }
    var prevSR = window.showSearchResults; if (typeof prevSR === 'function') { window.showSearchResults = function () { var o = prevSR.apply(this, arguments); setTimeout(function () { ensureSearchFocus(true, true); }, 120); return o; }; }
    setTimeout(function () { ensureTorrentFocus(true); }, 120);

    window.handleConfigNavigation = handleConfigNavigation;
    window.getConfigMenuItems = getConfigMenuItems;
    window.getTorrentTabs = getTorrentTabs;
    window.switchConfigTab = switchConfigTab;
    window.setConfigMenuActive = setConfigMenuActive;
}

function currentScreen() { try { var ss = window.AppState && AppState.currentScreen ? AppState.currentScreen : null, p = getEl('player-screen'), d = getEl('detail-view'), c = getEl('config-screen'), s = getEl('search-overlay'), ct = getEl('tab-catalog'), dn = getEl('donate-overlay'), sy = getEl('sync-overlay'); if (ss === 'player') return 'player'; if (p && getComputedStyle(p).display !== 'none') return 'player'; if (sy && !sy.classList.contains('hidden') && getComputedStyle(sy).display !== 'none') return 'sync'; if (c && getComputedStyle(c).display !== 'none') return 'config'; if (d && getComputedStyle(d).display !== 'none') return 'detail'; if (s && !s.classList.contains('hidden') && getComputedStyle(s).display !== 'none') return 'search'; if (dn && !dn.classList.contains('hidden') && getComputedStyle(dn).display !== 'none') return 'donate'; if (AppState.inSearch == 'catalog') return 'catalog'; var cg = getEl('torrents-grid'); if (cg) { var hc = cg.querySelector('.catalog-card,.catalog-folder-card') !== null, tc = cg.querySelector('.torrent-card:not(.catalog-card):not(.catalog-folder-card)') !== null; if (hc && !tc) return 'catalog'; } return ss || 'torrents'; } catch (e) { return 'torrents'; } }
function onBack() {
    var s = getEl('search-overlay'),
        d = getEl('detail-view'),
        c = getEl('config-screen'),
        cat = currentScreen() === 'catalog',
        dn = currentScreen() === 'donate';

    // ДОБАВЛЕННЫЙ БЛОК ДЛЯ CONFIG (после dn)
    var configScreen = getEl('config-screen');
    if (configScreen && getComputedStyle(configScreen).display !== 'none') {
        var focusedElement = document.querySelector('.focused');
        // Если фокус не на меню - возвращаем на меню
        var menuItems = getConfigMenuItems();
        var isOnMenu = false;
        for (var i = 0; i < menuItems.length; i++) {
            if (focusedElement === menuItems[i]) {
                isOnMenu = true;
                break;
            }
        }
        if (!isOnMenu) {
            handleConfigNavigation('back');
            return true;
        } else {
            // Убираем active у всех пунктов меню
            for (var i = 0; i < menuItems.length; i++) {
                menuItems[i].classList.remove('active');
            }
            // Сбрасываем состояние
            configState.activeTabId = null;
            configState.isOnMenu = true;
            configState.initialized = false;
            // Закрываем экран настроек
            configScreen.style.display = 'none';
            var torrserverSection = getEl('torrserver-section');
            if (torrserverSection) {
                torrserverSection.style.display = 'block';
            }
            try {
                window.AppState.currentScreen = 'torrents';
            } catch (e) { }
            setTimeout(function () {
                ensureTorrentFocus(true);
            }, 180);
            return true;
        }
    }

    if (AppState.syncCodeScreen == true) {
        toggleSyncOverlay();
        return true;
    }
    if (typeof window.closeCatalogTrailerOverlay === 'function' && window.closeCatalogTrailerOverlay()) {
        setTimeout(function () {
            ensureDetailFocus(true);
        }, 80);
        return true;
    }
    if (s && !s.classList.contains('hidden') && getComputedStyle(s).display !== 'none') {
        if (typeof window.hideSearchResults === 'function') {
            window.hideSearchResults();
            focusEl(getTorrentTabs()[2]);
        } else leaveSearchToTorrents();
        return true;
    }
    if (d && getComputedStyle(d).display !== 'none') {
        clickEl(getEl('back-from-detail') || document.querySelector('.back-btn'));
        return true;
    }
    if (dn) {
        if (typeof window.closeDonateOverlay === 'function') window.closeDonateOverlay();
        return true;
    }
    if (cat) {
        var h = document.querySelector('#torrents-grid .torrent-card.catalog-folder-card');
        if (h) return true;
        if (window.catalogState) {
            window.catalogState.lastSelectedIndex = 0;
            window.catalogState.lastSelectedId = null;
            localStorage.removeItem('lastCatalogCardIndex');
        }
        if (typeof window.backToCatalogList === 'function') {
            AppState.currentScreen = 'catalog';
            window.backToCatalogList();
        } else clickEl(getEl('back-from-catalog'));
        setTimeout(function () {
            ensureCatalogFocus(true);
        }, 180);
        return true;
    }
    if (c && getComputedStyle(c).display !== 'none') {
        var m = getEl('torrserver-section');
        c.style.display = 'none';
        if (m) m.style.display = 'block';
        try {
            window.AppState.currentScreen = 'torrents';
        } catch (e) { }
        setTimeout(function () {
            ensureTorrentFocus(true);
        }, 180);
        return true;
    }
    return false;
}

window.addEventListener('popstate', function (e) {
    if (window.swipeBlocked) return;

    // Защита от двойного срабатывания по времени
    var now = Date.now();
    if (now - lastPopStateTime < 500) return;
    lastPopStateTime = now;

    if (isProcessingBack) return;
    isProcessingBack = true;

    e.preventDefault();
    e.stopPropagation();

    // Эмулируем нажатие BACK
    var be = new KeyboardEvent('keydown', {
        keyCode: 27,
        key: 'Escape',
        bubbles: true,
        cancelable: true
    });
    document.dispatchEvent(be);

    // Восстанавливаем состояние истории
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

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
function initControl() {
    console.log('Модуль управления инициализирован (оптимизирован)');
    setupKeyboardHandlers(); setupFocusRescue();
    window.updateFocusableElements = updateFocusableElements; window.setFocus = setFocus; window.navigate = navigate;
    window.showPlayerControls = showPlayerControls; window.hidePlayerControls = hidePlayerControls;
    window.hidePlayerPanelsOnly = hidePlayerPanelsOnly; window.hidePlayerUi = hidePlayerUi;
    window.focusFirstTorrentCard = focusFirstTorrentCard; window.focusSearchHome = focusSearchHome; window.focusEl = focusEl;
    window.openNativeSearchControl = window.openNativeSearchControl || function (el) { if (el && (el.tagName === 'SELECT' || el.id === 'filter-year')) { el.focus(); try { el.click(); } catch (e) { } } };
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initControl); else initControl();

(function () {
    function initHorizontalScroll() {
        var c = document.querySelectorAll('.files-list,.catalog-detail-actors-grid,.catalog-detail-recommendations-grid');
        for (var i = 0; i < c.length; i++) { (function (cnt) { if (cnt._wh) return; cnt._wh = true; function wh(e) { e = e || window.event; var dy = e.deltaY || e.wheelDeltaY || (e.wheelDelta ? -e.wheelDelta / 40 : 0) || e.detail || 0, dx = e.deltaX || e.wheelDeltaX || 0; if (Math.abs(dy) > Math.abs(dx)) { if (e.preventDefault) e.preventDefault(); if (e.returnValue) e.returnValue = false; cnt.scrollLeft += dy; } } if (cnt.addEventListener) { cnt.addEventListener('wheel', wh, false); cnt.addEventListener('mousewheel', wh, false); if (navigator.userAgent.indexOf('Firefox') !== -1) cnt.addEventListener('DOMMouseScroll', wh, false); } else if (cnt.attachEvent) cnt.attachEvent('onmousewheel', wh); })(c[i]); }
    }
    if (document.readyState === 'loading') document.addEventListener ? document.addEventListener('DOMContentLoaded', initHorizontalScroll) : window.attachEvent('onload', initHorizontalScroll); else initHorizontalScroll();
    window.initHorizontalScroll = initHorizontalScroll;
})();
