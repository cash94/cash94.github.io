// control.js - Модуль управления навигацией, фокусом и обработкой клавиш

// ==================== ПЕРЕМЕННЫЕ ====================

var focusableElements = [];
var currentFocusIndex = 0;
var lastSelectedTorrentHash = null;
var lastSelectedTorrentIndex = 0;
var lastPlayerBackPressAt = 0;

// Переменные для удержания клавиш перемотки
var seekHoldInterval = null;
var seekHoldStep = 5;
var seekHoldDelay = 150;
var isSeekHoldActive = false;

// Переменные для long press удаления торрентов
var okHoldTimer = null;
var okHoldHandled = false;
var okHoldFocused = null;

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

function isPlayerControlsVisible() {
    var controlsContainer = document.getElementById('controls-container');
    return !!controlsContainer && !controlsContainer.classList.contains('idle-hidden');
}

function getTorrentGridColumns() {
    var grid = document.getElementById('torrents-grid');
    if (!grid) return 8;
    var style = window.getComputedStyle(grid);
    var cols = style.gridTemplateColumns ? style.gridTemplateColumns.split(' ').filter(function (b) { return b; }).length : 0;
    return cols || 8;
}

// ==================== УПРАВЛЕНИЕ ФОКУСОМ ====================

function updateFocusableElements() {
    var screen = AppState.currentScreen;

    var episodesPanel = document.getElementById('episodes-panel');
    var audioPanel = document.getElementById('audio-panel');
    var isEpisodesOpen = episodesPanel && !episodesPanel.classList.contains('hidden');
    var isAudioOpen = audioPanel && !audioPanel.classList.contains('hidden');

    if (isEpisodesOpen) {
        focusableElements = [];
        var episodeItems = document.querySelectorAll('.episode-item, .close-panel-btn');
        for (var i = 0; i < episodeItems.length; i++) {
            var el = episodeItems[i];
            if (el && el.offsetParent !== null) focusableElements.push(el);
        }
        console.log('🎯 Фокус на панели серий');
        return;
    }

    if (isAudioOpen) {
        focusableElements = [];
        var audioItems = document.querySelectorAll('.audio-item, .close-panel-btn');
        for (var j = 0; j < audioItems.length; j++) {
            var el = audioItems[j];
            if (el && el.offsetParent !== null) focusableElements.push(el);
        }
        console.log('🎯 Фокус на панели аудио');
        return;
    }

    if (screen === 'sync') {
        var syncElements = [];
        var syncCloseBtn = document.getElementById('sync-close-btn');
        var syncCodeInput = document.getElementById('sync-code-input');

        if (syncCloseBtn && syncCloseBtn.offsetParent !== null) syncElements.push(syncCloseBtn);
        if (syncCodeInput && syncCodeInput.offsetParent !== null) syncElements.push(syncCodeInput);

        focusableElements = syncElements;
        console.log('🎯 Фокус на экране синхронизации, найдено элементов: ' + focusableElements.length);
        return;
    }

    if (screen === 'player') {
        var controlsContainer = document.getElementById('controls-container');
        var controlsVisible = !!controlsContainer && !controlsContainer.classList.contains('idle-hidden');

        if (controlsVisible) {
            var seekSliderEl = document.getElementById('seek-slider');
            var buttons = document.querySelectorAll('#prev-episode-btn, #play-pause-btn, #next-episode-btn, #audio-btn, #episodes-btn, #mute-btn, #toggle-buffer-btn');
            var buttonList = [];
            for (var k = 0; k < buttons.length; k++) {
                var btn = buttons[k];
                if (btn && btn.offsetParent !== null) buttonList.push(btn);
            }
            focusableElements = [seekSliderEl].concat(buttonList).filter(function (el) { return el && el.offsetParent !== null; });
        } else {
            focusableElements = [];
        }
    } else if (screen === 'detail') {
        var progressElements = document.querySelectorAll('.detail-progress-btn');
        var fileElements = document.querySelectorAll('.file-item');
        var backButton = document.querySelectorAll('.back-btn');
        var allElements = [];
        for (var l = 0; l < progressElements.length; l++) allElements.push(progressElements[l]);
        for (var m = 0; m < fileElements.length; m++) allElements.push(fileElements[m]);
        for (var n = 0; n < backButton.length; n++) allElements.push(backButton[n]);
        focusableElements = allElements;
    } else if (screen === 'torrents') {
        var searchInputEl = document.getElementById('search-query');
        var searchBtnEl = document.getElementById('search-btn');
        var settingsBtnEl = document.getElementById('settings-btn');
        var tabTorrentsEl = document.getElementById('tab-torrents');
        var tabSearchEl = document.getElementById('tab-search');
        var tabCatalogEl = document.getElementById('tab-catalog');
        var cards = [];
        var allCards = document.querySelectorAll('.torrent-card');
        for (var o = 0; o < allCards.length; o++) {
            var card = allCards[o];
            if (card && card.offsetParent !== null) cards.push(card);
        }
        var cardsPerRow = getTorrentGridColumns();

        var rows = [];
        for (var p = 0; p < cards.length; p += cardsPerRow) {
            rows.push(cards.slice(p, p + cardsPerRow));
        }

        window.torrentRows = {
            row1: [searchInputEl, searchBtnEl, settingsBtnEl].filter(function (el) { return el; }),
            row2: [tabTorrentsEl, tabSearchEl, tabCatalogEl].filter(function (el) { return el; }),
            cardRows: rows,
            allCards: cards
        };

        var focusList = cards.slice();
        if (searchInputEl && searchInputEl.offsetParent !== null) focusList.push(searchInputEl);
        if (searchBtnEl && searchBtnEl.offsetParent !== null) focusList.push(searchBtnEl);
        if (tabTorrentsEl && tabTorrentsEl.offsetParent !== null) focusList.push(tabTorrentsEl);
        if (tabSearchEl && tabSearchEl.offsetParent !== null) focusList.push(tabSearchEl);
        if (tabCatalogEl && tabCatalogEl.offsetParent !== null) focusList.push(tabCatalogEl);
        if (settingsBtnEl && settingsBtnEl.offsetParent !== null) focusList.push(settingsBtnEl);
        focusableElements = focusList.filter(function (el) { return el && el.offsetParent !== null; });
    } else if (screen === 'catalog') {
        var catalogCards = [];
        var allCatalogCards = document.querySelectorAll('.torrent-card.catalog-card, .torrent-card.catalog-folder-card');
        for (var q = 0; q < allCatalogCards.length; q++) {
            var catCard = allCatalogCards[q];
            if (catCard && catCard.offsetParent !== null) catalogCards.push(catCard);
        }
        focusableElements = catalogCards;
        window.catalogCards = catalogCards;
    } else if (screen === 'search') {
        var searchInputEl = document.getElementById('search-query');
        var filterToggleEl = document.getElementById('filter-toggle');
        var searchBtnEl = document.getElementById('search-btn');
        var closeSearchEl = document.getElementById('close-search');
        var filterControlsList = document.querySelectorAll('#torrent-movie, #sort-by, #filter-quality, #filter-content-type, #filter-tracker, #filter-year, #filter-season, #filter-voice, #filter-videotype, #reset-filters');
        var filterControls = [];
        for (var r = 0; r < filterControlsList.length; r++) {
            var fc = filterControlsList[r];
            if (fc && fc.offsetParent !== null) filterControls.push(fc);
        }
        var resultItemsList = document.querySelectorAll('.search-result-item');
        var resultItems = [];
        for (var s = 0; s < resultItemsList.length; s++) {
            var ri = resultItemsList[s];
            if (ri && ri.offsetParent !== null) resultItems.push(ri);
        }
        var focusList = [searchInputEl, filterToggleEl, searchBtnEl, closeSearchEl];
        for (var t = 0; t < filterControls.length; t++) focusList.push(filterControls[t]);
        for (var u = 0; u < resultItems.length; u++) focusList.push(resultItems[u]);
        focusableElements = focusList.filter(function (el) { return el; });
    } else if (screen === 'config') {
        var configItems = document.querySelectorAll('#torrserver-url, #auth-checkbox, #auth-login, #auth-password, .settings-btn');
        var configList = [];
        for (var v = 0; v < configItems.length; v++) {
            var ci = configItems[v];
            if (ci && ci.offsetParent !== null) configList.push(ci);
        }
        focusableElements = configList;
    } else {
        focusableElements = [];
    }

    focusableElements = focusableElements.filter(function (el) {
        if (!el) return false;
        var style = window.getComputedStyle(el);
        return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            el.offsetParent !== null;
    });

    if (currentFocusIndex >= focusableElements.length) {
        currentFocusIndex = 0;
    }

    console.log('🎯 Найдено ' + focusableElements.length + ' фокусируемых элементов на экране ' + screen);
}

function setFocus(index) {
    var focusedElements = document.querySelectorAll('.focused');
    for (var i = 0; i < focusedElements.length; i++) {
        focusedElements[i].classList.remove('focused');
    }
    if (focusableElements.length === 0) return;

    if (index < 0) index = focusableElements.length - 1;
    if (index >= focusableElements.length) index = 0;

    currentFocusIndex = index;
    var element = focusableElements[currentFocusIndex];

    if (AppState.currentScreen === 'torrents') {
        if (element && element.classList.contains('torrent-card')) {
            var torrentIndex = currentFocusIndex - ((window.torrentRows && window.torrentRows.row1 ? window.torrentRows.row1.length : 0) + (window.torrentRows && window.torrentRows.row2 ? window.torrentRows.row2.length : 0));

            if (AppState.torrents[torrentIndex] && AppState.torrents[torrentIndex].hash) {
                lastSelectedTorrentHash = AppState.torrents[torrentIndex].hash;
                lastSelectedTorrentIndex = torrentIndex;
            } else if (element.dataset.hash) {
                lastSelectedTorrentHash = element.dataset.hash;
                lastSelectedTorrentIndex = torrentIndex >= 0 ? torrentIndex : 0;
            }
            window.lastSelectedTorrentHash = lastSelectedTorrentHash;
            window.lastSelectedTorrentIndex = lastSelectedTorrentIndex;
        }
    }

    if (element) {
        element.classList.add('focused');

        if (element.id === 'search-query' ||
            element.id === 'torrserver-url' ||
            element.id === 'auth-login' ||
            element.id === 'auth-password') {
            if (document.activeElement && document.activeElement.tagName === 'INPUT') {
                document.activeElement.blur();
            }
        } else {
            if (document.activeElement && document.activeElement.tagName === 'INPUT') {
                document.activeElement.blur();
            }
        }

        element.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'center'
        });
        console.log('🎯 Фокус на элементе:', element);
    }
}

function focusFirstTorrentCard(retries, delay) {
    console.log('Фокус на первом элементе');
    if (retries === undefined) retries = 6;
    if (delay === undefined) delay = 120;
    if (AppState.currentScreen !== 'torrents') return false;
    updateFocusableElements();
    var firstCardIndex = -1;
    for (var i = 0; i < focusableElements.length; i++) {
        if (focusableElements[i].classList && focusableElements[i].classList.contains('torrent-card')) {
            firstCardIndex = i;
            break;
        }
    }
    if (firstCardIndex !== -1) {
        setFocus(firstCardIndex);
        return true;
    }
    if (retries > 0) {
        setTimeout(function () { focusFirstTorrentCard(retries - 1, delay); }, delay);
    }
    return false;
}

function focusSearchHome(preferQuery) {
    if (preferQuery === undefined) preferQuery = true;
    updateFocusableElements();
    var queryIndex = -1;
    var searchBtnIndex = -1;
    var filterIndex = -1;
    for (var i = 0; i < focusableElements.length; i++) {
        var el = focusableElements[i];
        if (el.id === 'search-query') queryIndex = i;
        if (el.id === 'search-btn') searchBtnIndex = i;
        if (['filter-toggle', 'torrent-movie', 'sort-by', 'filter-quality', 'filter-content-type', 'filter-tracker', 'filter-year', 'filter-season', 'filter-voice', 'filter-videotype', 'reset-filters', 'close-search'].indexOf(el.id) !== -1 && filterIndex === -1) {
            filterIndex = i;
        }
    }
    var targetIndex = preferQuery && queryIndex !== -1
        ? queryIndex
        : (searchBtnIndex !== -1 ? searchBtnIndex : (filterIndex !== -1 ? filterIndex : 0));
    setFocus(targetIndex);
}

function showPlayerControls(preferredFocusId) {
    if (preferredFocusId === undefined) preferredFocusId = 'play-pause-btn';
    var ids = [
        'controls-container', 'buffer-stats', 'player-hint', 'toggle-buffer-btn',
        'exit-player-btn', 'episodes-btn', 'prev-episode-btn', 'next-episode-btn',
        'audio-btn', 'player-title'
    ];
    for (var i = 0; i < ids.length; i++) {
        var el = document.getElementById(ids[i]);
        if (el) el.classList.remove('idle-hidden');
    }
    if (typeof window.syncPlayerTitleVisibility === 'function') {
        window.syncPlayerTitleVisibility(true);
    }
    var playerTitle = document.getElementById('player-title');
    if (playerTitle) playerTitle.classList.remove('hidden');
    if (typeof window.resetMouseIdleTimer === 'function') {
        window.resetMouseIdleTimer();
    }
    setTimeout(function () {
        updateFocusableElements();
        var targetIndex = -1;
        for (var j = 0; j < focusableElements.length; j++) {
            if (focusableElements[j].id === preferredFocusId) {
                targetIndex = j;
                break;
            }
        }
        setFocus(targetIndex !== -1 ? targetIndex : 0);
    }, 60);
}

function hidePlayerControls() {
    var ids = [
        'controls-container', 'buffer-stats', 'player-hint', 'toggle-buffer-btn',
        'exit-player-btn', 'episodes-btn', 'prev-episode-btn', 'next-episode-btn',
        'audio-btn', 'player-title'
    ];
    for (var i = 0; i < ids.length; i++) {
        var element = document.getElementById(ids[i]);
        if (element) {
            element.classList.add('idle-hidden');
        }
    }
    if (typeof window.syncPlayerTitleVisibility === 'function') {
        window.syncPlayerTitleVisibility(false);
    }
    var playerTitle = document.getElementById('player-title');
    if (playerTitle) playerTitle.classList.add('hidden');
    var focusedElements = document.querySelectorAll('.focused');
    for (var j = 0; j < focusedElements.length; j++) {
        focusedElements[j].classList.remove('focused');
    }
    currentFocusIndex = 0;
    if (window.mouseIdleTimer) {
        clearTimeout(window.mouseIdleTimer);
        window.mouseIdleTimer = null;
    }
}

function hidePlayerPanelsOnly() {
    var hidden = false;
    var episodesPanel = document.getElementById('episodes-panel');
    var audioPanel = document.getElementById('audio-panel');
    if (episodesPanel && !episodesPanel.classList.contains('hidden')) {
        episodesPanel.classList.add('hidden');
        var episodesBtn = document.getElementById('episodes-btn');
        if (episodesBtn) episodesBtn.classList.remove('active');
        hidden = true;
    }
    if (audioPanel && !audioPanel.classList.contains('hidden')) {
        audioPanel.classList.add('hidden');
        var audioBtn = document.getElementById('audio-btn');
        if (audioBtn) audioBtn.classList.remove('active');
        hidden = true;
    }
    return hidden;
}

function hidePlayerUi() {
    var panelsHidden = hidePlayerPanelsOnly();
    var controlsWereVisible = isPlayerControlsVisible();
    if (controlsWereVisible) {
        hidePlayerControls();
    }
    if (panelsHidden || controlsWereVisible) {
        var playerTitle = document.getElementById('player-title');
        if (playerTitle) playerTitle.classList.add('hidden');
    }
    return panelsHidden || controlsWereVisible;
}

// ==================== НАВИГАЦИЯ ====================

function navigate(direction) {
    var activeElement = document.activeElement;
    if (activeElement && activeElement.id === 'search-query') {
        activeElement.blur();
        updateFocusableElements();
        if (AppState.currentScreen === 'search') {
            var firstFilterIndex = -1;
            var firstResultIndex = -1;
            for (var i = 0; i < focusableElements.length; i++) {
                var el = focusableElements[i];
                if (['filter-toggle', 'torrent-movie', 'sort-by', 'filter-quality', 'filter-content-type', 'filter-tracker', 'filter-year', 'filter-season', 'filter-voice', 'filter-videotype', 'reset-filters', 'close-search'].indexOf(el.id) !== -1 && firstFilterIndex === -1) {
                    firstFilterIndex = i;
                }
                if (el.classList && el.classList.contains('search-result-item') && firstResultIndex === -1) {
                    firstResultIndex = i;
                }
            }
            if (direction === 'down' && firstResultIndex !== -1) {
                setFocus(firstResultIndex);
            } else {
                setFocus(firstFilterIndex !== -1 ? firstFilterIndex : (firstResultIndex !== -1 ? firstResultIndex : 0));
            }
            return;
        }
        var firstCardIndex = -1;
        for (var j = 0; j < focusableElements.length; j++) {
            if (focusableElements[j].classList && focusableElements[j].classList.contains('torrent-card')) {
                firstCardIndex = j;
                break;
            }
        }
        setFocus(firstCardIndex !== -1 ? firstCardIndex : 0);
        return;
    }
    if (focusableElements.length === 0) {
        updateFocusableElements();
        if (focusableElements.length === 0) return;
        if (AppState.currentScreen === 'torrents') {
            var firstCardIndex = -1;
            for (var k = 0; k < focusableElements.length; k++) {
                if (focusableElements[k].classList && focusableElements[k].classList.contains('torrent-card')) {
                    firstCardIndex = k;
                    break;
                }
            }
            setFocus(firstCardIndex !== -1 ? firstCardIndex : 0);
        } else if (AppState.currentScreen === 'search') {
            var firstFilterIndex = -1;
            for (var l = 0; l < focusableElements.length; l++) {
                if (['filter-toggle', 'torrent-movie', 'sort-by', 'filter-quality', 'filter-content-type', 'filter-tracker', 'filter-year', 'filter-season', 'filter-voice', 'filter-videotype', 'reset-filters', 'close-search'].indexOf(focusableElements[l].id) !== -1) {
                    firstFilterIndex = l;
                    break;
                }
            }
            setFocus(firstFilterIndex !== -1 ? firstFilterIndex : 0);
        }
        return;
    }

    var currentElement = focusableElements[currentFocusIndex];

    // ===== НАВИГАЦИЯ ДЛЯ ТОРРЕНТОВ =====
    if (AppState.currentScreen === 'torrents') {
        var settingsBtnEl = document.getElementById('settings-btn');
        var tabTorrentsEl = document.getElementById('tab-torrents');
        var tabSearchEl = document.getElementById('tab-search');
        var tabCatalogEl = document.getElementById('tab-catalog');
        var cards = window.torrentRows && window.torrentRows.allCards ? window.torrentRows.allCards : [];

        if (!currentElement) {
            if (cards.length > 0) {
                setFocus(focusableElements.indexOf(cards[0]));
            } else {
                var fallbackIndex = -1;
                for (var m = 0; m < focusableElements.length; m++) {
                    if (focusableElements[m].id === 'tab-torrents') {
                        fallbackIndex = m;
                        break;
                    }
                }
                setFocus(fallbackIndex !== -1 ? fallbackIndex : 0);
            }
            return;
        }

        var isSettings = currentElement === settingsBtnEl;
        var isTabTorrents = currentElement === tabTorrentsEl;
        var isTabSearch = currentElement === tabSearchEl;
        var isTabCatalog = currentElement === tabCatalogEl;
        var isCard = false;
        for (var n = 0; n < cards.length; n++) {
            if (currentElement === cards[n]) {
                isCard = true;
                break;
            }
        }

        var cardIndex = -1;
        if (isCard) {
            for (var o = 0; o < cards.length; o++) {
                if (currentElement === cards[o]) {
                    cardIndex = o;
                    break;
                }
            }
        }
        var cardsPerRow = getTorrentGridColumns();

        switch (direction) {
            case 'up':
                if (isCard) {
                    if (cardIndex < cardsPerRow) {
                        setFocus(focusableElements.indexOf(tabTorrentsEl));
                    } else {
                        var newIndex = cardIndex - cardsPerRow;
                        setFocus(focusableElements.indexOf(cards[newIndex]));
                    }
                } else if (isTabTorrents || isTabSearch || isTabCatalog) {
                    if (cards.length > 0) {
                        setFocus(focusableElements.indexOf(cards[0]));
                    }
                }
                break;

            case 'down':
                if (isSettings) {
                    setFocus(focusableElements.indexOf(tabTorrentsEl));
                } else if (isTabTorrents || isTabSearch || isTabCatalog) {
                    if (cards.length > 0) {
                        setFocus(focusableElements.indexOf(cards[0]));
                    }
                } else if (isCard) {
                    if (cardIndex + cardsPerRow < cards.length) {
                        var newIndex = cardIndex + cardsPerRow;
                        setFocus(focusableElements.indexOf(cards[newIndex]));
                    }
                }
                break;

            case 'left':
                if (isSettings) {
                    setFocus(focusableElements.indexOf(tabCatalogEl));
                } else if (isTabCatalog) {
                    setFocus(focusableElements.indexOf(tabSearchEl));
                } else if (isTabSearch) {
                    setFocus(focusableElements.indexOf(tabTorrentsEl));
                } else if (isCard && cardIndex > 0 && cardIndex % cardsPerRow !== 0) {
                    setFocus(focusableElements.indexOf(cards[cardIndex - 1]));
                }
                break;

            case 'right':
                if (isTabTorrents) {
                    setFocus(focusableElements.indexOf(tabSearchEl));
                } else if (isTabSearch) {
                    setFocus(focusableElements.indexOf(tabCatalogEl));
                } else if (isCard && cardIndex < cards.length - 1 && (cardIndex + 1) % cardsPerRow !== 0) {
                    setFocus(focusableElements.indexOf(cards[cardIndex + 1]));
                }
                break;
        }
        return;
    }

    // ===== НАВИГАЦИЯ ДЛЯ КАТАЛОГА =====
    if (AppState.currentScreen === 'catalog') {
        var cards = window.catalogCards || [];
        if (cards.length === 0) return;

        var currentIndex = -1;
        for (var p = 0; p < cards.length; p++) {
            if (currentElement === cards[p]) {
                currentIndex = p;
                break;
            }
        }
        var cardsPerRow = getTorrentGridColumns();

        switch (direction) {
            case 'left':
                if (currentIndex > 0 && currentIndex % cardsPerRow !== 0) {
                    setFocus(focusableElements.indexOf(cards[currentIndex - 1]));
                }
                break;
            case 'right':
                if (currentIndex < cards.length - 1 && (currentIndex + 1) % cardsPerRow !== 0) {
                    setFocus(focusableElements.indexOf(cards[currentIndex + 1]));
                }
                break;
            case 'up':
                if (currentIndex >= cardsPerRow) {
                    setFocus(focusableElements.indexOf(cards[currentIndex - cardsPerRow]));
                }
                break;
            case 'down':
                if (currentIndex + cardsPerRow < cards.length) {
                    setFocus(focusableElements.indexOf(cards[currentIndex + cardsPerRow]));

                    if (typeof window.checkAndLoadMoreOnNavigation === 'function') {
                        window.checkAndLoadMoreOnNavigation();
                    }
                } else if (currentIndex === cards.length - 1) {
                    if (typeof window.checkAndLoadMoreOnNavigation === 'function') {
                        window.checkAndLoadMoreOnNavigation();
                    }
                }
                break;
        }
        return;
    }

    // ===== НАВИГАЦИЯ ДЛЯ ПЛЕЕРА И ПАНЕЛЕЙ =====
    if (AppState.currentScreen === 'player') {
        var controlsContainer = document.getElementById('controls-container');
        var controlsVisible = !controlsContainer.classList.contains('idle-hidden');

        if (!controlsVisible) {
            return;
        }

        var playerCurrentElement = focusableElements[currentFocusIndex];
        var isSeekSliderFocused = playerCurrentElement && playerCurrentElement.id === 'seek-slider';

        var episodesPanel = document.getElementById('episodes-panel');
        var audioPanel = document.getElementById('audio-panel');
        var isPanelOpen = (episodesPanel && !episodesPanel.classList.contains('hidden')) ||
            (audioPanel && !audioPanel.classList.contains('hidden'));

        if (isPanelOpen) {
            var isCloseButton = 0;
            var isLastElement = focusableElements.length - 1;

            if (direction === 'up') {
                if (currentFocusIndex > isCloseButton) {
                    setFocus(currentFocusIndex - 1);
                }
                return;
            }

            if (direction === 'down') {
                if (currentFocusIndex < isLastElement) {
                    setFocus(currentFocusIndex + 1);
                }
                return;
            }

            if (direction === 'left' || direction === 'right') {
                return;
            }
            return;
        }

        if (isSeekSliderFocused) {
            if (direction === 'down') {
                if (focusableElements.length > 1) {
                    setFocus(1);
                }
                return;
            }
            if (direction === 'left' || direction === 'right') {
                return;
            }
            return;
        } else {
            var isFirstButton = currentFocusIndex === 1;
            var isLastButton = currentFocusIndex === focusableElements.length - 1;

            if (direction === 'up') {
                setFocus(0);
                return;
            }
            if (direction === 'down') {
                return;
            }

            if (direction === 'left') {
                if (isFirstButton) {
                    return;
                }
                setFocus(currentFocusIndex - 1);
                return;
            }
            if (direction === 'right') {
                if (isLastButton) {
                    return;
                }
                setFocus(currentFocusIndex + 1);
                return;
            }
        }
        return;
    }

    if (AppState.currentScreen === 'search') {
        var searchInputEl = document.getElementById('search-query');
        var filters = [];
        var results = [];
        for (var q = 0; q < focusableElements.length; q++) {
            var el = focusableElements[q];
            if (el.id === 'torrent-movie' || el.id === 'sort-by' || el.id === 'filter-quality' ||
                el.id === 'filter-content-type' || el.id === 'filter-tracker' ||
                el.id === 'filter-year' || el.id === 'filter-season' || el.id === 'filter-voice' || el.id === 'filter-videotype'|| el.id === 'reset-filters' || el.id === 'close-search') {
                filters.push(el);
            }
            if (el.classList && el.classList.contains('search-result-item')) {
                results.push(el);
            }
        }
        var current = focusableElements[currentFocusIndex];
        var filterIndex = -1;
        for (var r = 0; r < filters.length; r++) {
            if (current === filters[r]) {
                filterIndex = r;
                break;
            }
        }
        var resultIndex = -1;
        for (var s = 0; s < results.length; s++) {
            if (current === results[s]) {
                resultIndex = s;
                break;
            }
        }
        var isSearchInput = current === searchInputEl;

        if (!current) {
            if (searchInputEl && focusableElements.indexOf(searchInputEl) !== -1) {
                setFocus(focusableElements.indexOf(searchInputEl));
            } else if (filters.length > 0) {
                setFocus(focusableElements.indexOf(filters[0]));
            } else if (results.length > 0) {
                setFocus(focusableElements.indexOf(results[0]));
            }
            return;
        }

        if (isSearchInput) {
            if (direction === 'left' || direction === 'right' || direction === 'down' || direction === 'up') {
                if (filters.length > 0) {
                    setFocus(focusableElements.indexOf(filters[0]));
                } else if (results.length > 0) {
                    setFocus(focusableElements.indexOf(results[0]));
                }
                return;
            }
        }

        if (filterIndex !== -1) {
            if (direction === 'left') {
                setFocus(focusableElements.indexOf(filters[Math.max(0, filterIndex - 1)]));
                return;
            }
            if (direction === 'right') {
                setFocus(focusableElements.indexOf(filters[Math.min(filters.length - 1, filterIndex + 1)]));
                return;
            }
            if (direction === 'down') {
                if (results.length > 0) {
                    setFocus(focusableElements.indexOf(results[0]));
                } else {
                    setFocus(focusableElements.indexOf(filters[Math.min(filters.length - 1, filterIndex + 1)]));
                }
                return;
            }
            if (direction === 'up') {
                if (searchInputEl && focusableElements.indexOf(searchInputEl) !== -1) {
                    setFocus(focusableElements.indexOf(searchInputEl));
                } else {
                    setFocus(focusableElements.indexOf(filters[Math.max(0, filterIndex - 1)]));
                }
                return;
            }
            return;
        }

        if (resultIndex !== -1) {
            if (direction === 'up') {
                if (resultIndex === 0 && filters.length > 0) {
                    setFocus(focusableElements.indexOf(filters[0]));
                } else {
                    setFocus(focusableElements.indexOf(results[Math.max(0, resultIndex - 1)]));
                }
                return;
            }
            if (direction === 'down') {
                setFocus(focusableElements.indexOf(results[Math.min(results.length - 1, resultIndex + 1)]));
                return;
            }
            if (direction === 'left' || direction === 'right') {
                return;
            }
        }
    }

    var columns = 1;
    switch (direction) {
        case 'up': setFocus(currentFocusIndex - columns); break;
        case 'down': setFocus(currentFocusIndex + columns); break;
        case 'left': setFocus(currentFocusIndex - 1); break;
        case 'right': setFocus(currentFocusIndex + 1); break;
    }
}

function keyToDirection(keyCode) {
    if (isKeyPressed('UP', keyCode)) return 'up';
    if (isKeyPressed('DOWN', keyCode)) return 'down';
    if (isKeyPressed('LEFT', keyCode)) return 'left';
    if (isKeyPressed('RIGHT', keyCode)) return 'right';
    return null;
}

// ==================== УПРАВЛЕНИЕ ПЕРЕМОТКОЙ ====================

function stopSeeking() {
    if (seekHoldInterval) {
        clearInterval(seekHoldInterval);
        seekHoldInterval = null;
    }
}

// ==================== ОБРАБОТЧИКИ КЛАВИШ ====================

// Вспомогательная функция для установки фокуса на активный элемент панели
function focusActivePanelItem(panelType) {
    setTimeout(function () {
        var activeItem = null;

        // Выбираем нужный селектор в зависимости от типа панели
        if (panelType === 'episodes') {
            activeItem = document.querySelector('.episode-item.active');
        } else if (panelType === 'audio') {
            activeItem = document.querySelector('.audio-item.active');
        }

        if (activeItem) {
            // Добавляем класс focused и удаляем со всех остальных
            var focusedElements = document.querySelectorAll('.focused');
            for (var i = 0; i < focusedElements.length; i++) {
                focusedElements[i].classList.remove('focused');
            }
            activeItem.classList.add('focused');
            activeItem.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // Обновляем индекс
            updateFocusableElements();
            for (var i = 0; i < focusableElements.length; i++) {
                if (focusableElements[i] === activeItem ||
                    focusableElements[i].parentElement === activeItem) {
                    currentFocusIndex = i;
                    break;
                }
            }

            console.log('🎯 Фокус установлен на ' + panelType + ':', activeItem);
        } else {
            console.log('⚠️ Не найден активный элемент для панели:', panelType);
        }
    }, 50);
}

function setupKeyboardHandlers() {
    document.addEventListener('keyup', function (e) {
        var key = e.keyCode;
        if (isKeyPressed('LEFT', key) || isKeyPressed('RIGHT', key)) {
            if (seekHoldInterval) {
                clearInterval(seekHoldInterval);
                seekHoldInterval = null;

                if (typeof accelerationTimer !== 'undefined' && accelerationTimer) {
                    clearInterval(accelerationTimer);
                    accelerationTimer = null;
                }

                var slider = document.getElementById('seek-slider');
                if (slider) {
                    var event = document.createEvent('Event');
                    event.initEvent('change', true, true);
                    slider.dispatchEvent(event);
                }

                console.log('⏹️ Удержание прекращено, инициирована перемотка');

                setTimeout(function () {
                    isSeekHoldActive = false;
                }, 500);
            }

            stopSeeking();
        }
    });

    document.addEventListener('keydown', function (e) {
        var key = e.keyCode;
        var activeElement = document.activeElement;
        var playbackOverlay = document.getElementById('playback-overlay');
        var isPlaybackActive = playbackOverlay && playbackOverlay.classList.contains('active');

        // Если плеер активен, не обрабатываем навигацию по торрентам
        if (isPlaybackActive) {
            // Пропускаем обработку, если только это не специальные клавиши для плеера
            // Они обрабатываются позже в секции плеера
            return;
        }

        if (AppState.currentScreen === 'torrents') {
            if (isKeyPressed('UP', key) || isKeyPressed('DOWN', key) ||
                isKeyPressed('LEFT', key) || isKeyPressed('RIGHT', key)) {
                e.preventDefault();
                if (!document.querySelector('.focused')) {
                    focusFirstTorrentCard();
                    return;
                }
                navigate(keyToDirection(key));
                return;
            }

            if (isKeyPressed('OK', key) || key === 13) {
                e.preventDefault();
                if (e.repeat) {
                    return;
                }
                var focused = document.querySelector('.focused');
                if (!focused) {
                    focusFirstTorrentCard();
                    return;
                }

                if (focused.id === 'search-query') {
                    if (typeof window.showSearchResults === 'function') {
                        window.showSearchResults({ focusQuery: true });
                    }
                    return;
                }
                if (focused.id === 'search-btn' || focused.id === 'tab-search') {
                    if (typeof window.showSearchResults === 'function') {
                        window.showSearchResults({ focusQuery: true, runSearch: focused.id === 'search-btn' });
                    }
                    return;
                }
                if (focused.id === 'tab-catalog') {
                    focused.click();
                    return;
                }
                if (focused.id === 'settings-btn' || focused.id === 'tab-torrents') {
                    focused.click();
                    return;
                }
                if (focused.classList.contains('torrent-card')) {
                    return;
                }
                if (focused.click) focused.click();
                return;
            }
            return;
        }

        if (activeElement && activeElement.id === 'search-query') {
            if (isKeyPressed('BACK', key) || isKeyPressed('EXIT', key)) {
                e.preventDefault();
                activeElement.blur();
                updateFocusableElements();
                var searchIndex = -1;
                for (var i = 0; i < focusableElements.length; i++) {
                    if (focusableElements[i].id === 'search-query') {
                        searchIndex = i;
                        break;
                    }
                }
                setFocus(searchIndex !== -1 ? searchIndex : 0);
                return;
            }
            if (isKeyPressed('DOWN', key) || isKeyPressed('UP', key) || isKeyPressed('LEFT', key) || isKeyPressed('RIGHT', key)) {
                e.preventDefault();
                var direction = keyToDirection(key);
                activeElement.blur();
                updateFocusableElements();

                if (AppState.currentScreen === 'search') {
                    if (direction === 'right') {
                        var searchBtnIndex = -1;
                        for (var j = 0; j < focusableElements.length; j++) {
                            if (focusableElements[j].id === 'search-btn') {
                                searchBtnIndex = j;
                                break;
                            }
                        }
                        setFocus(searchBtnIndex !== -1 ? searchBtnIndex : 0);
                    } else {
                        var firstFilterIndex = -1;
                        var firstResultIndex = -1;
                        for (var k = 0; k < focusableElements.length; k++) {
                            var el = focusableElements[k];
                            if (['filter-toggle', 'torrent-movie', 'sort-by', 'filter-quality', 'filter-content-type', 'filter-tracker', 'filter-year', 'filter-season', 'filter-voice', 'filter-videotype', 'reset-filters', 'close-search'].indexOf(el.id) !== -1 && firstFilterIndex === -1) {
                                firstFilterIndex = k;
                            }
                            if (el.classList && el.classList.contains('search-result-item') && firstResultIndex === -1) {
                                firstResultIndex = k;
                            }
                        }
                        if (direction === 'down' && firstFilterIndex !== -1) {
                            setFocus(firstFilterIndex);
                        } else if (firstFilterIndex !== -1) {
                            setFocus(firstFilterIndex);
                        } else if (firstResultIndex !== -1) {
                            setFocus(firstResultIndex);
                        } else {
                            setFocus(0);
                        }
                    }
                    return;
                }

                navigate(direction);
                return;
            }
            if (isKeyPressed('OK', key)) {
                e.preventDefault();
                var query = activeElement.value.trim();
                if (AppState.currentScreen === 'search') {
                    if (query && typeof window.searchTorrents === 'function') {
                        window.searchTorrents(query);
                    }
                    activeElement.blur();
                    setTimeout(function () { focusSearchHome(true); }, 100);
                    return;
                }
                if (typeof window.showSearchResults === 'function') {
                    window.showSearchResults({ focusQuery: true, runSearch: !!query });
                }
                activeElement.blur();
                return;
            }
        }

        if (AppState.currentScreen === 'config') {
            var isInputFocused = activeElement && (
                activeElement.id === 'torrserver-url' ||
                activeElement.id === 'auth-login' ||
                activeElement.id === 'auth-password'
            );

            if (isInputFocused) {
                if (isKeyPressed('OK', key)) {
                    e.preventDefault();
                    activeElement.blur();
                    updateFocusableElements();
                    var currentIndex = -1;
                    for (var l = 0; l < focusableElements.length; l++) {
                        if (focusableElements[l].id === activeElement.id) {
                            currentIndex = l;
                            break;
                        }
                    }
                    if (currentIndex !== -1 && currentIndex < focusableElements.length - 1) {
                        setFocus(currentIndex + 1);
                    } else {
                        setFocus(0);
                    }
                    return;
                }
                return;
            }

            updateFocusableElements();

            if (isKeyPressed('UP', key)) {
                e.preventDefault();
                setFocus(currentFocusIndex - 1);
                return;
            }
            if (isKeyPressed('DOWN', key)) {
                e.preventDefault();
                setFocus(currentFocusIndex + 1);
                return;
            }
            if (isKeyPressed('LEFT', key)) {
                e.preventDefault();
                setFocus(currentFocusIndex - 1);
                return;
            }
            if (isKeyPressed('RIGHT', key)) {
                e.preventDefault();
                setFocus(currentFocusIndex + 1);
                return;
            }
            if (isKeyPressed('OK', key)) {
                e.preventDefault();
                var focused = document.querySelector('.focused');
                if (focused) {
                    if (focused.id === 'torrserver-url' ||
                        focused.id === 'auth-login' ||
                        focused.id === 'auth-password') {
                        focused.focus();
                    } else {
                        focused.click();
                    }
                }
                return;
            }
        }

        if (AppState.currentScreen === 'search') {
            var activeTag = e.target.tagName;
            var isFilterControl = activeTag === 'SELECT' || e.target.id === 'filter-year';
            if (isFilterControl && (isKeyPressed('UP', key) || isKeyPressed('DOWN', key) || isKeyPressed('LEFT', key) || isKeyPressed('RIGHT', key))) {
                e.preventDefault();
                if (document.activeElement && typeof document.activeElement.blur === 'function') {
                    document.activeElement.blur();
                }
                updateFocusableElements();
                var firstFilterIndex = -1;
                for (var m = 0; m < focusableElements.length; m++) {
                    if (['filter-toggle', 'torrent-movie', 'sort-by', 'filter-quality', 'filter-content-type', 'filter-tracker', 'filter-year', 'filter-season', 'filter-voice', 'filter-videotype', 'reset-filters', 'close-search'].indexOf(focusableElements[m].id) !== -1) {
                        firstFilterIndex = m;
                        break;
                    }
                }
                if (firstFilterIndex !== -1) {
                    setFocus(firstFilterIndex);
                    if (keyToDirection(key) !== 'left') {
                        navigate(keyToDirection(key));
                    }
                    return;
                }
            }
        }

        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return;
        }

        updateFocusableElements();

        // ===== СПЕЦИАЛЬНАЯ ОБРАБОТКА ДЛЯ ПЛЕЕРА =====
        if (AppState.currentScreen === 'player') {
            var videoPlayer = document.getElementById('video-player');
            var controlsContainer = document.getElementById('controls-container');
            var controlsVisible = !controlsContainer.classList.contains('idle-hidden');

            if (isKeyPressed('UP', key) && !controlsVisible) {
                e.preventDefault();
                showPlayerControls('play-pause-btn');
                return;
            }

            if (isKeyPressed('OK', key)) {
                e.preventDefault();

                var focused = document.querySelector('.focused');

                if (!controlsVisible) {
                    showPlayerControls('play-pause-btn');
                    return;
                }

                if (focused) {
                    console.log('🎯 OK на элементе (панель видима):', focused.id || focused.className);

                    var actionPerformed = false;

                    if (focused.id === 'play-pause-btn') {
                        if (videoPlayer.paused) {
                            videoPlayer.play();
                        } else {
                            videoPlayer.pause();
                        }
                        if (typeof window.updatePlayPauseButton === 'function') window.updatePlayPauseButton();
                        actionPerformed = true;
                    } else if (focused.id === 'mute-btn') {
                        videoPlayer.muted = !videoPlayer.muted;
                        if (typeof window.updateMuteButton === 'function') window.updateMuteButton();
                        actionPerformed = true;
                    } else if (focused.id === 'prev-episode-btn') {
                        if (typeof window.prevEpisode === 'function') window.prevEpisode();
                        actionPerformed = true;
                    } else if (focused.id === 'next-episode-btn') {
                        if (typeof window.nextEpisode === 'function') window.nextEpisode();
                        actionPerformed = true;
                    } else if (focused.id === 'episodes-btn') {
                        var episodesBtn = document.getElementById('episodes-btn');
                        if (episodesBtn) episodesBtn.click();
                        updateFocusableElements();
                        focusActivePanelItem('episodes');  // Вызываем функцию для установки фокуса
                        actionPerformed = false;
                    } else if (focused.id === 'audio-btn') {
                        var audioBtn = document.getElementById('audio-btn');
                        if (audioBtn) audioBtn.click();
                        updateFocusableElements();
                        focusActivePanelItem('audio');  // Вызываем функцию для установки фокуса
                        actionPerformed = false;
                    } else if (focused.id === 'exit-player-btn') {
                        if (typeof window.showDetailView === 'function') window.showDetailView();
                        return;
                    } else if (focused.id === 'toggle-buffer-btn') {
                        var toggleBufferBtn = document.getElementById('toggle-buffer-btn');
                        if (toggleBufferBtn) toggleBufferBtn.click();
                        actionPerformed = true;
                    } else if (focused.id === 'seek-slider') {
                        var currentTime = parseFloat(focused.value);
                        if (typeof window.showPlayerLoading === 'function') {
                            window.showPlayerLoading('⏱️ ' + formatTime(currentTime));
                            setTimeout(function () {
                                if (typeof window.hidePlayerLoading === 'function') window.hidePlayerLoading();
                            }, 1000);
                        }
                        actionPerformed = true;
                    } else {
                        focused.click();
                        actionPerformed = true;
                    }

                    if (actionPerformed) {
                        setTimeout(function () {
                            hidePlayerControls();
                            console.log('✅ Действие выполнено, панель скрыта, фокус сброшен');
                        }, 400);
                    }

                    if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();
                    return;
                }

                if (controlsVisible) {
                    hidePlayerControls();
                }
                return;
            }

            if (isKeyPressed('LEFT', key) || isKeyPressed('RIGHT', key)) {
                // Проверяем, видна ли панель управления
                var controlsContainer = document.getElementById('controls-container');
                var controlsVisible = !controlsContainer.classList.contains('idle-hidden');

                // Если панель скрыта, не обрабатываем перемотку (просто игнорируем)
                if (!controlsVisible) {
                    e.preventDefault(); // Предотвращаем стандартное поведение
                    return;
                }

                e.preventDefault();
                if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();

                var focusedElement = focusableElements[currentFocusIndex];
                var isSeekSliderFocused = focusedElement && focusedElement.id === 'seek-slider';

                if (isSeekSliderFocused) {
                    var slider = document.getElementById('seek-slider');
                    var direction = isKeyPressed('LEFT', key) ? -1 : 1;

                    var holdDuration = 0;
                    var currentStep = seekHoldStep;
                    var maxStep = 120;
                    var accelerationCurve = [
                        { time: 0, step: 5 },
                        { time: 500, step: 10 },
                        { time: 1000, step: 20 },
                        { time: 1500, step: 30 },
                        { time: 2000, step: 45 },
                        { time: 2500, step: 60 },
                        { time: 3000, step: 90 },
                        { time: 4000, step: 120 }
                    ];

                    var lastUpdateTime = Date.now();
                    var accelerationTimer = null;

                    var updateStepByDuration = function () {
                        var elapsed = Date.now() - lastUpdateTime;

                        var newStep = seekHoldStep;
                        for (var idx = accelerationCurve.length - 1; idx >= 0; idx--) {
                            if (elapsed >= accelerationCurve[idx].time) {
                                newStep = accelerationCurve[idx].step;
                                break;
                            }
                        }

                        if (newStep !== currentStep) {
                            currentStep = newStep;
                            console.log('⚡ Ускорение перемотки: ' + currentStep + ' сек (удержание ' + (elapsed / 1000).toFixed(1) + 'с)');
                        }
                    };

                    var performSeekStep = function () {
                        var currentValue = parseFloat(slider.value);
                        var maxVal = parseFloat(slider.max);
                        var step = currentStep * direction;

                        var newValue = currentValue + step;

                        if (newValue < 0) newValue = 0;
                        if (newValue > maxVal) newValue = maxVal;

                        slider.value = newValue;

                        if (typeof AppState !== 'undefined') {
                            AppState.previewTime = newValue;
                        }
                        var currentTimeEl = document.getElementById('current-time');
                        if (currentTimeEl) currentTimeEl.textContent = formatTime(newValue);

                        if (AppState.isSeeking || document.getElementById('loading-player-overlay').classList.contains('active')) {
                            var loadingTimeEl = document.getElementById('loading-time');
                            if (loadingTimeEl) loadingTimeEl.textContent = formatTime(newValue);
                        }
                    };

                    if (!seekHoldInterval) {
                        isSeekHoldActive = true;
                        holdDuration = 0;
                        currentStep = seekHoldStep;
                        lastUpdateTime = Date.now();

                        performSeekStep();

                        seekHoldInterval = setInterval(performSeekStep, seekHoldDelay);

                        accelerationTimer = setInterval(function () {
                            if (seekHoldInterval) {
                                updateStepByDuration();
                            } else {
                                if (accelerationTimer) {
                                    clearInterval(accelerationTimer);
                                    accelerationTimer = null;
                                }
                            }
                        }, 200);
                    }
                    return;
                } else {
                    navigate(keyToDirection(key));
                    return;
                }
            }

            if (controlsVisible) {
                updateFocusableElements();

                if (isKeyPressed('UP', key)) {
                    e.preventDefault();
                    navigate('up');
                    if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();
                    return;
                }
                if (isKeyPressed('DOWN', key)) {
                    e.preventDefault();
                    navigate('down');
                    if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();
                    return;
                }
            }

            if (isKeyPressed('PLAY', key) || isKeyPressed('PAUSE', key) || isKeyPressed('PLAY_PAUSE', key)) {
                e.preventDefault();
                if (videoPlayer.paused) {
                    videoPlayer.play();
                } else {
                    videoPlayer.pause();
                }
                if (typeof window.updatePlayPauseButton === 'function') window.updatePlayPauseButton();
                if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();
                return;
            }

            if (isKeyPressed('VOL_UP', key)) {
                e.preventDefault();
                var newVolume = Math.min(1, videoPlayer.volume + 0.1);
                videoPlayer.volume = newVolume;
                var volumeSlider = document.getElementById('volume-slider');
                if (volumeSlider) volumeSlider.value = newVolume;
                if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();
                return;
            }
            if (isKeyPressed('VOL_DOWN', key)) {
                e.preventDefault();
                var newVolume = Math.max(0, videoPlayer.volume - 0.1);
                videoPlayer.volume = newVolume;
                var volumeSlider = document.getElementById('volume-slider');
                if (volumeSlider) volumeSlider.value = newVolume;
                if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();
                return;
            }
            if (isKeyPressed('MUTE', key)) {
                e.preventDefault();
                videoPlayer.muted = !videoPlayer.muted;
                if (typeof window.updateMuteButton === 'function') window.updateMuteButton();
                if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();
                return;
            }

            if (isKeyPressed('RED', key)) {
                e.preventDefault();
                var audioBtn = document.getElementById('audio-btn');
                if (audioBtn) audioBtn.click();
                if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();
                return;
            }
            if (isKeyPressed('GREEN', key)) {
                e.preventDefault();
                var episodesBtn = document.getElementById('episodes-btn');
                if (episodesBtn) episodesBtn.click();
                if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();
                return;
            }
            if (isKeyPressed('YELLOW', key)) {
                e.preventDefault();
                var toggleBufferBtn = document.getElementById('toggle-buffer-btn');
                if (toggleBufferBtn) toggleBufferBtn.click();
                if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();
                return;
            }
            if (isKeyPressed('BLUE', key)) {
                e.preventDefault();
                var exitPlayerBtn = document.getElementById('exit-player-btn');
                if (exitPlayerBtn) exitPlayerBtn.click();
                if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();
                return;
            }

            if (isKeyPressed('BACK', key) || isKeyPressed('EXIT', key)) {
                e.preventDefault();
                if (hidePlayerUi()) {
                    lastPlayerBackPressAt = 0;
                    return;
                }
                var now = Date.now();
                if (now - lastPlayerBackPressAt < 1500) {
                    lastPlayerBackPressAt = 0;
                    if (typeof window.showDetailView === 'function') window.showDetailView();
                } else {
                    lastPlayerBackPressAt = now;
                    if (typeof window.showPlayerHint === 'function') window.showPlayerHint('Нажмите Back ещё раз для выхода');
                }
                return;
            }

            if (isKeyPressed('FF', key)) {
                e.preventDefault();
                videoPlayer.currentTime = Math.min(videoPlayer.duration, videoPlayer.currentTime + 30);
                if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();
                return;
            }
            if (isKeyPressed('REW', key)) {
                e.preventDefault();
                videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - 30);
                if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();
                return;
            }

            if (!controlsVisible) {
                return;
            }
        }

        if (AppState.currentScreen === 'search' && isKeyPressed('OK', key)) {
            e.preventDefault();
            var focused = document.querySelector('.focused');

            if (focused) {
                if (focused.id === 'search-query') {
                    focused.focus();
                    try { if (focused.select) focused.select(); } catch (err) { }
                } else if (focused.tagName === 'SELECT' || focused.id === 'filter-year') {
                    if (typeof window.openNativeSearchControl === 'function') {
                        window.openNativeSearchControl(focused);
                    } else {
                        focused.focus();
                        focused.click();
                    }
                } else if (focused.id === 'search-btn') {
                    var query = document.getElementById('search-query');
                    var q = query ? query.value.trim() : '';
                    if (q && typeof window.searchTorrents === 'function') {
                        window.searchTorrents(q);
                    }
                } else {
                    focused.click();
                }
            } else {
                focusSearchHome(true);
            }
            return;
        }

        if (isKeyPressed('UP', key)) {
            e.preventDefault();
            navigate('up');
        } else if (isKeyPressed('DOWN', key)) {
            e.preventDefault();
            navigate('down');
        } else if (isKeyPressed('LEFT', key)) {
            e.preventDefault();
            navigate('left');
        } else if (isKeyPressed('RIGHT', key)) {
            e.preventDefault();
            navigate('right');
        } else if (isKeyPressed('OK', key)) {
            e.preventDefault();

            var focused = document.querySelector('.focused');
            if (focused) {
                if (focused.classList.contains('file-item')) {
                    var playBtn = focused.querySelector('.play-btn');
                    if (playBtn) {
                        playBtn.click();
                    } else {
                        focused.click();
                    }
                } else {
                    focused.click();
                }
            } else if (focusableElements.length > 0) {
                focusableElements[0].click();
            }
        } else if (isKeyPressed('BACK', key) || isKeyPressed('EXIT', key)) {
            e.preventDefault();
            if (AppState.currentScreen === 'detail') {
                var backBtn = document.getElementById('back-from-detail');
                if (backBtn) backBtn.click();
            } else if (AppState.currentScreen === 'search') {
                if (typeof window.hideSearchResults === 'function') {
                    window.hideSearchResults();
                }
            } else if (AppState.currentScreen === 'catalog') {
                if (typeof window.backToCatalogList === 'function') {
                    window.backToCatalogList();
                } else {
                    var backFromCatalog = document.getElementById('back-from-catalog');
                    if (backFromCatalog) backFromCatalog.click();
                }
            } else if (AppState.currentScreen === 'torrents') {
                var hasFocus = !!document.querySelector('.focused');
                if (!hasFocus) {
                    focusFirstTorrentCard();
                } else {
                    var settingsBtn = document.getElementById('settings-btn');
                    if (settingsBtn) settingsBtn.click();
                }
            }
        } else if (isKeyPressed('INFO', key)) {
            e.preventDefault();
            console.log('ℹ️ Информация:', {
                screen: AppState.currentScreen,
                platform: AppState.platform,
                focusIndex: currentFocusIndex,
                focusableCount: focusableElements.length
            });
        }
    });
}

// ==================== ФУНКЦИИ ДЛЯ LONG PRESS УДАЛЕНИЯ ====================

function clearOkHold() {
    if (okHoldTimer) {
        clearTimeout(okHoldTimer);
        okHoldTimer = null;
    }
}

// ==================== TV FOCUS RESCUE ====================

function setupFocusRescue() {
    var VISIBLE = function (el) { return !!(el && el.offsetParent !== null && !el.disabled); };
    var byId = function (id) { return document.getElementById(id); };
    var clearFocused = function () {
        var focused = document.querySelectorAll('.focused');
        for (var i = 0; i < focused.length; i++) {
            focused[i].classList.remove('focused');
        }
    };
    var clickEl = function (el) { try { if (el && el.click) el.click(); } catch (e) { } };
    var blurEditor = function () {
        var a = document.activeElement;
        if (a && a !== document.body && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA')) {
            try { a.blur(); } catch (e) { }
        }
    };

    function focusEl(el, opts) {
        if (opts === undefined) opts = {};
        if (!VISIBLE(el)) return false;
        clearFocused();
        el.classList.add('focused');
        if (opts.nativeFocus) {
            try { el.focus(); } catch (e) { }
        } else {
            blurEditor();
        }
        try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { }
        return true;
    }

    var customFilterMenuState = null;

    function ensureCustomFilterMenu() {
        var menu = document.getElementById('custom-filter-menu');
        if (menu) return menu;

        menu = document.createElement('div');
        menu.id = 'custom-filter-menu';
        menu.className = 'custom-filter-menu hidden';
        menu.innerHTML = '\n            <div class="custom-filter-menu-backdrop"></div>\n            <div class="custom-filter-menu-panel">\n                <div class="custom-filter-menu-title" id="custom-filter-menu-title">Выбор</div>\n                <div class="custom-filter-menu-options" id="custom-filter-menu-options"></div>\n            </div>\n        ';
        document.body.appendChild(menu);
        var backdrop = menu.querySelector('.custom-filter-menu-backdrop');
        if (backdrop) backdrop.addEventListener('click', closeCustomFilterMenu);
        return menu;
    }

    function renderCustomFilterMenu() {
        var menu = ensureCustomFilterMenu();
        var titleEl = document.getElementById('custom-filter-menu-title');
        var optionsEl = document.getElementById('custom-filter-menu-options');
        if (!customFilterMenuState || !titleEl || !optionsEl) return;

        titleEl.textContent = customFilterMenuState.title || 'Выбор';
        var optionsHtml = '';
        for (var i = 0; i < customFilterMenuState.options.length; i++) {
            var opt = customFilterMenuState.options[i];
            var cls = (i === customFilterMenuState.index) ? 'custom-filter-option active' : 'custom-filter-option';
            var selected = (String(opt.value) === String(customFilterMenuState.value)) ? ' ✓' : '';
            optionsHtml += '<div class="' + cls + '" data-index="' + i + '">' + opt.label + selected + '</div>';
        }
        optionsEl.innerHTML = optionsHtml;

        // Скроллим к активному элементу после рендера
        setTimeout(scrollToActiveFilterOption, 10);
    }

    function closeCustomFilterMenu() {
        var menu = document.getElementById('custom-filter-menu');
        if (menu) menu.classList.add('hidden');
        customFilterMenuState = null;
        return true;
    }

    // Функция для скролла к активному элементу в меню фильтров
    function scrollToActiveFilterOption() {
        var activeOption = document.querySelector('.custom-filter-option.active');
        var optionsContainer = document.getElementById('custom-filter-menu-options');

        if (!activeOption || !optionsContainer) return;

        // Получаем позиции элемента и контейнера
        var containerRect = optionsContainer.getBoundingClientRect();
        var optionRect = activeOption.getBoundingClientRect();

        // Вычисляем смещение для скролла
        var scrollTop = optionsContainer.scrollTop;
        var offsetTop = optionRect.top - containerRect.top;

        // Если элемент выше видимой области
        if (offsetTop < 0) {
            optionsContainer.scrollTop = scrollTop + offsetTop - 10; // 10px отступа сверху
        }
        // Если элемент ниже видимой области
        else if (offsetTop + optionRect.height > containerRect.height) {
            optionsContainer.scrollTop = scrollTop + (offsetTop + optionRect.height - containerRect.height) + 10; // 10px отступа снизу
        }
    }

    function moveCustomFilterMenu(delta) {
        if (!customFilterMenuState || !customFilterMenuState.options.length) return true;
        var len = customFilterMenuState.options.length;
        var newIndex = customFilterMenuState.index + delta;

        // Проверяем границы - не позволяем выходить за пределы
        if (newIndex < 0) {
            // Если на первом элементе и пытаемся вверх - остаемся на месте
            return true;
        }
        if (newIndex >= len) {
            // Если на последнем элементе и пытаемся вниз - остаемся на месте
            return true;
        }

        // Обновляем индекс только если не вышли за границы
        customFilterMenuState.index = newIndex;
        renderCustomFilterMenu();

        // Скроллим к активному элементу после обновления
        setTimeout(scrollToActiveFilterOption, 10);

        return true;
    }

    function applyCustomFilterMenuSelection() {
        if (!customFilterMenuState || !customFilterMenuState.selectEl) return false;
        var selectEl = customFilterMenuState.selectEl;
        var options = customFilterMenuState.options;
        var index = customFilterMenuState.index;
        var chosen = options[index];
        if (!chosen) return false;
        selectEl.value = String(chosen.value);
        try {
            var event = document.createEvent('Event');
            event.initEvent('change', true, true);
            selectEl.dispatchEvent(event);
        } catch (e) { }
        if (typeof window.getCurrentSearchMode === 'function') window.getCurrentSearchMode();
        closeCustomFilterMenu();
        try { focusEl(selectEl); } catch (e) { }
        return true;
    }

    function isCustomFilterMenuOpen() {
        var menu = document.getElementById('custom-filter-menu');
        return !!(menu && !menu.classList.contains('hidden') && customFilterMenuState);
    }

    function openNativeSearchControl(el) {
        if (!VISIBLE(el)) return false;

        if (el.tagName === 'SELECT') {
            var filterGroup = el.closest('.filter-group');
            var titleLabel = filterGroup ? filterGroup.querySelector('.filter-label') : null;
            var title = (titleLabel && titleLabel.textContent ? titleLabel.textContent.trim() : 'Выбор');
            var options = [];
            for (var i = 0; i < el.options.length; i++) {
                options.push({ value: el.options[i].value, label: el.options[i].textContent || el.options[i].label || el.options[i].value });
            }
            var index = 0;
            for (var j = 0; j < options.length; j++) {
                if (String(options[j].value) === String(el.value)) {
                    index = j;
                    break;
                }
            }
            if (index < 0) index = 0;
            customFilterMenuState = { selectEl: el, title: title, options: options, index: index, value: el.value };
            var menu = ensureCustomFilterMenu();
            menu.classList.remove('hidden');
            renderCustomFilterMenu();
            return true;
        }

        focusEl(el, { nativeFocus: true });
        try { el.focus(); } catch (e) { }
        try { el.click(); } catch (e) { }
        return true;
    }

    function currentScreen() {
        try {
            var stateScreen = window.AppState && AppState.currentScreen ? AppState.currentScreen : null;
            var player = byId('player-screen');
            var detail = byId('detail-view');
            var config = byId('config-screen');
            var search = byId('search-overlay');
            var catalogTab = byId('tab-catalog');
            var donateTab = byId('donate-overlay');
            var syncOverlay = byId('sync-overlay');

            if (stateScreen === 'player') return 'player';
            if (player && getComputedStyle(player).display !== 'none') return 'player';
            if (syncOverlay && !syncOverlay.classList.contains('hidden') && getComputedStyle(syncOverlay).display !== 'none') return 'sync';
            if (config && getComputedStyle(config).display !== 'none') return 'config';
            if (detail && getComputedStyle(detail).display !== 'none') return 'detail';
            if (search && !search.classList.contains('hidden') && getComputedStyle(search).display !== 'none') return 'search';
            if (donateTab && !donateTab.classList.contains('hidden') && getComputedStyle(donateTab).display !== 'none') return 'donate';
            
            if (AppState.inSearch == 'catalog') {
                return 'catalog';
            }
            
            //if (catalogTab && catalogTab.classList.contains('active')) {
                //return 'catalog';
            //}

            if (catalogGrid) {
                var hasCatalogCards = catalogGrid.querySelector('.catalog-card, .catalog-folder-card') !== null;
                var hasTorrentCards = catalogGrid.querySelector('.torrent-card:not(.catalog-card):not(.catalog-folder-card)') !== null;

                if (hasCatalogCards && !hasTorrentCards) {
                    return 'catalog';
                }
            }

            return stateScreen || 'torrents';
        } catch (e) {
            return 'torrents';
        }
    }

    function getTorrentCards() {
        var cards = document.querySelectorAll('.torrent-card');
        var visible = [];
        for (var i = 0; i < cards.length; i++) {
            if (VISIBLE(cards[i])) visible.push(cards[i]);
        }
        return visible;
    }
    function getTorrentHeader() {
        var ids = ['settings-btn'];
        var visible = [];
        for (var i = 0; i < ids.length; i++) {
            var el = byId(ids[i]);
            if (VISIBLE(el)) visible.push(el);
        }
        return visible;
    }
    function getTorrentTabs() {
        var ids = ['tab-catalog', 'tab-torrents', 'tab-search', 'tab-donate'];
        var visible = [];
        for (var i = 0; i < ids.length; i++) {
            var el = byId(ids[i]);
            if (VISIBLE(el)) visible.push(el);
        }
        return visible;
    }
    function getSearchTop() {
        var ids = ['search-query', 'filter-toggle', 'search-btn', 'close-search'];
        var visible = [];
        for (var i = 0; i < ids.length; i++) {
            var el = byId(ids[i]);
            if (VISIBLE(el)) visible.push(el);
        }
        return visible;
    }
    function getSearchFilters() {
        var ids = ['torrent-movie', 'sort-by', 'filter-quality', 'filter-content-type', 'filter-tracker', 'filter-year', 'filter-season', 'filter-voice', 'filter-videotype', 'reset-filters'];
        var visible = [];
        for (var i = 0; i < ids.length; i++) {
            var el = byId(ids[i]);
            if (VISIBLE(el)) visible.push(el);
        }
        return visible;
    }
    function getSearchResults() {
        var currentMode = typeof window.getCurrentSearchMode === 'function' ? window.getCurrentSearchMode() : 'torrentsearch';
        if (currentMode === 'torrentsearch') {
            var items = document.querySelectorAll('.search-result-item');
            var visible = [];
            for (var i = 0; i < items.length; i++) {
                if (VISIBLE(items[i])) visible.push(items[i]);
            }
            return visible;
        } else if (currentMode === 'globalsearch') {
            var items = document.querySelectorAll('.global-search-card');
            var visible = [];
            for (var i = 0; i < items.length; i++) {
                if (VISIBLE(items[i])) visible.push(items[i]);
            }
            return visible;
        }
        return [];
    }

    function getDetailItems() {
        var selectors = [
            '.back-btn', '.detail-progress-btn', '.file-item', '#catalog-watch-btn',
            '.catalog-trailer-link', '.catalog-trailer-play', '.catalog-trailer-card-item',
            '#catalog-trailer-close', '.catalog-actor-card', '.catalog-recommendation-card'
        ];
        var all = [];
        for (var s = 0; s < selectors.length; s++) {
            var items = document.querySelectorAll(selectors[s]);
            for (var i = 0; i < items.length; i++) {
                if (VISIBLE(items[i])) all.push(items[i]);
            }
        }
        return all;
    }
    function getConfigItems() {
        var ids = ['torrserver-url', 'auth-checkbox', 'auth-login', 'auth-password', '.settings-btn', 'sync-clients-btn', 'speedtest-btn', 'auto-fullscreen', 'hide-clock', 'add-to-db', 'multi-channel-audio'];
        var visible = [];
        for (var i = 0; i < ids.length; i++) {
            var el = byId(ids[i]);
            if (VISIBLE(el)) visible.push(el);
        }
        var settingsBtns = document.querySelectorAll('.settings-btn');
        for (var j = 0; j < settingsBtns.length; j++) {
            if (VISIBLE(settingsBtns[j])) visible.push(settingsBtns[j]);
        }
        return visible;
    }

    function getColumns() {
        var grid = byId('torrents-grid');
        if (!grid) return 8;
        try {
            var cols = (getComputedStyle(grid).gridTemplateColumns || '').split(' ').filter(function (b) { return b; }).length;
            return cols || 8;
        } catch (e) { return 8; }
    }

    function belongsToScreen(el, screen) {
        if (!el) return false;
        if (screen === 'torrents') {
            return el.closest('.torrent-card') || el.classList.contains('file-item') || ['search-query', 'search-btn', 'settings-btn', 'tab-torrents', 'tab-search', 'tab-donate', 'back-from-detail', 'tab-catalog'].indexOf(el.id) !== -1;
        }
        if (screen === 'catalog') {
            return el.closest('.torrent-card.catalog-card') ||
                el.closest('.torrent-card.catalog-folder-card') ||
                (el.closest('#torrents-grid') && !el.closest('.torrent-card:not(.catalog-card):not(.catalog-folder-card)')) ||
                el.id === 'back-from-catalog' ||
                el.classList.contains('file-item') ||
                el.classList.contains('back-btn') || ['search-query', 'search-btn', 'settings-btn', 'tab-torrents', 'tab-search', 'tab-catalog', 'tab-donate'].indexOf(el.id) !== -1;
        }
        if (screen === 'search') {
            return el.closest('.search-result-item') || el.closest('.global-search-card') ||
                ['search-query', 'filter-toggle', 'search-btn', 'close-search', 'torrent-movie', 'sort-by', 'filter-quality', 'filter-content-type', 'filter-tracker', 'filter-year', 'filter-season', 'filter-voice', 'filter-videotype', 'reset-filters'].indexOf(el.id) !== -1;
        }
        if (screen === 'detail') {
            return !!(
                el.closest('#detail-view') ||
                el.closest('.file-item') ||
                el.closest('back-from-detail') ||
                el.classList.contains('detail-progress-btn') ||
                el.classList.contains('back-btn')
            );
        }
        if (screen === 'config') {
            return !!(
                el.closest('#config-screen') ||
                ['torrserver-url', 'auth-checkbox', 'auth-login', 'auth-password', 'sync-clients-btn', 'speedtest-btn', 'auto-fullscreen', 'hide-clock', 'add-to-db', 'multi-channel-audio'].indexOf(el.id) !== -1 ||
                el.classList.contains('settings-btn')
            );
        }
        return false;
    }

    function ensureTorrentFocus(force) {
        if (force === undefined) force = false;
        if (currentScreen() !== 'torrents') return false;
        if (window.AppState && AppState.restoringFocus) return false;

        var focused = document.querySelector('.focused');
        if (!force && belongsToScreen(focused, 'torrents')) return true;

        var cards = getTorrentCards();
        var tabs = getTorrentTabs();
        var header = getTorrentHeader();
        return focusEl(cards[0] || tabs[0] || header[0]);
    }

    function ensureCatalogFocus(force) {
        if (force === undefined) force = false;
        if (currentScreen() !== 'catalog') return false;

        var focused = document.querySelector('.focused');
        if (!force && focused && belongsToScreen(focused, 'catalog')) {
            return true;
        }

        var cards = [];
        var allCards = document.querySelectorAll('.torrent-card.catalog-card, .torrent-card.catalog-folder-card');
        for (var i = 0; i < allCards.length; i++) {
            if (VISIBLE(allCards[i])) cards.push(allCards[i]);
        }
        if (!cards.length) return false;

        var savedIndexRaw = localStorage.getItem('lastCatalogCardIndex');
        var targetCard = null;

        if (savedIndexRaw !== null) {
            var savedNumIndex = parseInt(savedIndexRaw, 10);
            if (Number.isFinite(savedNumIndex)) {
                for (var j = 0; j < cards.length; j++) {
                    var cardNumIndex = parseInt(cards[j].dataset.numIndex || '-1', 10);
                    if (Number.isFinite(cardNumIndex) && cardNumIndex === savedNumIndex) {
                        targetCard = cards[j];
                        break;
                    }
                }
                if (!targetCard && savedNumIndex >= 0 && savedNumIndex < cards.length) {
                    targetCard = cards[savedNumIndex];
                }
            }
        }

        if (!targetCard) {
            targetCard = cards[0];
        }

        var targetIndex = -1;
        for (var k = 0; k < cards.length; k++) {
            if (targetCard === cards[k]) {
                targetIndex = k;
                break;
            }
        }
        console.log('🎯 ensureCatalogFocus: восстанавливаем фокус на карточке ' + targetIndex + ', saved=' + savedIndexRaw);
        return focusEl(targetCard);
    }

    function ensureSearchFocus(force, preferInput) {
        if (force === undefined) force = false;
        if (preferInput === undefined) preferInput = true;
        if (currentScreen() !== 'search') return false;
        var focused = document.querySelector('.focused');
        if (!force && belongsToScreen(focused, 'search')) return true;
        var top = getSearchTop();
        var filters = getSearchFilters();
        var results = getSearchResults();
        var query = byId('search-query');
        return focusEl((preferInput && query) ? query : (top[0] || filters[0] || results[0] || query));
    }
    function ensureDetailFocus(force) {
        if (force === undefined) force = false;
        if (currentScreen() !== 'detail') return false;
        var focused = document.querySelector('.focused');
        if (!force && belongsToScreen(focused, 'detail')) return true;
        var items = getDetailItems();
        return focusEl(items[0] || byId('back-from-detail'));
    }
    function ensureConfigFocus(force) {
        if (force === undefined) force = false;
        if (currentScreen() !== 'config') return false;
        var focused = document.querySelector('.focused');
        if (!force && belongsToScreen(focused, 'config')) return true;
        return focusEl(getConfigItems()[0]);
    }

    window.focusFirstTorrentCard = function () { return ensureTorrentFocus(true); };
    window.focusFirstCatalogCard = function () { return ensureCatalogFocus(true); };
    window.focusSearchHome = function (preferQuery) {
        if (preferQuery === undefined) preferQuery = true;
        return ensureSearchFocus(true, preferQuery);
    };
    window.ensureCatalogFocus = ensureCatalogFocus;
    window.ensureDetailFocus = ensureDetailFocus;
    window.ensureTorrentFocus = ensureTorrentFocus;
    window.ensureSearchFocus = ensureSearchFocus;
    window.ensureConfigFocus = ensureConfigFocus;

    function openSearchScreen(focusInput) {
        if (focusInput === undefined) focusInput = true;
        clickEl(byId('tab-search') || byId('search-btn'));
        setTimeout(function () {
            ensureSearchFocus(true, focusInput);
            if (focusInput) {
                var q = byId('search-query');
                focusEl(q, { nativeFocus: true });
                try { if (q && q.click) q.click(); } catch (e) { }
                try { if (q && q.select) q.select(); } catch (e) { }
            }
        }, 120);
    }
    function leaveSearchToTorrents() {
        if (typeof window.hideSearchResults === 'function') {
            window.hideSearchResults();
        } else {
            clickEl(byId('close-search') || byId('tab-torrents'));
            setTimeout(function () {
                var returnTo = (window.AppState && AppState.searchReturnTo === 'catalog') ? 'catalog' : 'torrents';
                if (returnTo === 'catalog') {
                    ensureCatalogFocus(true);
                } else {
                    ensureTorrentFocus(true);
                }
            }, 150);
        }
    }

    function torrentHandle(direction) {
        var focused = (belongsToScreen(document.querySelector('.focused'), 'torrents') ? document.querySelector('.focused') : null);
        var cards = getTorrentCards();
        var header = getTorrentHeader();
        var tabs = getTorrentTabs();
        var cols = getColumns();
        if (!focused) return ensureTorrentFocus(true);
        var cardIndex = -1;
        for (var i = 0; i < cards.length; i++) {
            if (focused === cards[i]) {
                cardIndex = i;
                break;
            }
        }
        var headerIndex = -1;
        for (var j = 0; j < header.length; j++) {
            if (focused === header[j]) {
                headerIndex = j;
                break;
            }
        }
        var tabIndex = -1;
        for (var k = 0; k < tabs.length; k++) {
            if (focused === tabs[k]) {
                tabIndex = k;
                break;
            }
        }
        if (cardIndex !== -1) {
            var row = Math.floor(cardIndex / cols);
            if (direction === 'left') return focusEl(cards[Math.max(0, cardIndex - 1)] || focused);
            if (direction === 'right') return focusEl(cards[Math.min(cards.length - 1, cardIndex + 1)] || focused);
            if (direction === 'up') return focusEl(row === 0 ? (tabs[0] || header[0] || focused) : (cards[Math.max(0, cardIndex - cols)] || focused));
            if (direction === 'down') return focusEl(cards[Math.min(cards.length - 1, cardIndex + cols)] || focused);
            return true;
        }
        if (tabIndex !== -1) {
            if (direction === 'left') return focusEl(tabs[Math.max(0, tabIndex - 1)] || focused);
            if (direction === 'right') return focusEl(tabs[Math.min(tabs.length - 1, tabIndex + 1)] || focused);
            if (direction === 'down') return focusEl(cards[0] || focused);
            if (direction === 'up') return focusEl(header[Math.min(tabIndex, header.length - 1)] || header[0] || focused);
            return true;
        }
        if (headerIndex !== -1) {
            if (direction === 'left') return focusEl(header[Math.max(0, headerIndex - 1)] || focused);
            if (direction === 'right') return focusEl(header[Math.min(header.length - 1, headerIndex + 1)] || focused);
            if (direction === 'down') return focusEl((focused.id === 'settings-btn' ? tabs[0] : tabs[1]) || tabs[0] || cards[0] || focused);
            return true;
        }
        return false;
    }

    function catalogHandle(direction) {
        var focused = (belongsToScreen(document.querySelector('.focused'), 'catalog') ? document.querySelector('.focused') : null);
        var cards = [];
        var allCards = document.querySelectorAll('.torrent-card.catalog-card, .torrent-card.catalog-folder-card');
        for (var i = 0; i < allCards.length; i++) {
            if (VISIBLE(allCards[i])) cards.push(allCards[i]);
        }
        var header = getTorrentHeader();
        var tabs = getTorrentTabs();
        var cols = getColumns();

        if (!focused) return ensureCatalogFocus(true);

        var cardIndex = -1;
        for (var j = 0; j < cards.length; j++) {
            if (focused === cards[j]) {
                cardIndex = j;
                break;
            }
        }
        var headerIndex = -1;
        for (var k = 0; k < header.length; k++) {
            if (focused === header[k]) {
                headerIndex = k;
                break;
            }
        }
        var tabIndex = -1;
        for (var l = 0; l < tabs.length; l++) {
            if (focused === tabs[l]) {
                tabIndex = l;
                break;
            }
        }

        if (cardIndex !== -1) {
            var row = Math.floor(cardIndex / cols);

            if (direction === 'left') {
                if (cardIndex > 0 && cardIndex % cols !== 0) {
                    return focusEl(cards[Math.max(0, cardIndex - 1)] || focused);
                }
                return true;
            }

            if (direction === 'right') {
                if (cardIndex < cards.length - 1 && (cardIndex + 1) % cols !== 0) {
                    return focusEl(cards[Math.min(cards.length - 1, cardIndex + 1)] || focused);
                }
                return true;
            }

            if (direction === 'up') {
                if (row === 0) {
                    return focusEl(tabs[0] || header[0] || focused);
                }
                return focusEl(cards[Math.max(0, cardIndex - cols)] || focused);
            }

            if (direction === 'down') {
                if (cardIndex + cols < cards.length) {
                    var newIndex = cardIndex + cols;
                    return focusEl(cards[Math.min(cards.length - 1, newIndex)] || focused);
                }
                else if (cards.length < catalogState.totalItems && !catalogState.isLoadingMore) {
                    var currentCardIndex = cardIndex;

                    var loadMoreTrigger = document.getElementById('load-more-trigger');
                    if (loadMoreTrigger) {
                        loadMoreTrigger.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }

                    console.log('📦 Загружаем следующую страницу каталога');
                    window.loadMoreCatalogItems().then(function () {
                        setTimeout(function () {
                            var newCards = [];
                            var newAllCards = document.querySelectorAll('.torrent-card.catalog-card, .torrent-card.catalog-folder-card');
                            for (var m = 0; m < newAllCards.length; m++) {
                                if (VISIBLE(newAllCards[m])) newCards.push(newAllCards[m]);
                            }
                            var targetIndex = Math.min(currentCardIndex + cols, newCards.length - 1);
                            if (targetIndex >= 0 && targetIndex < newCards.length) {
                                var newFocusCard = newCards[targetIndex];
                                if (newFocusCard) {
                                    focusEl(newFocusCard);
                                    //var globalIndex = -1;
                                    //for (var n = 0; n < focusableElements.length; n++) {
                                    //if (newFocusCard === focusableElements[n]) {
                                    //globalIndex = n;
                                    //break;
                                    //}
                                    //}
                                    //if (globalIndex !== -1) {
                                    //setFocus(globalIndex);
                                    //}
                                }
                            }
                        }, 50);
                    });
                    return true;
                }
                return true;
            }
            return true;
        }

        if (tabIndex !== -1) {
            if (direction === 'left') {
                return focusEl(tabs[Math.max(0, tabIndex - 1)] || focused);
            }
            if (direction === 'right') {
                return focusEl(tabs[Math.min(tabs.length - 1, tabIndex + 1)] || focused);
            }
            if (direction === 'down') {
                return focusEl(cards[0] || focused);
            }
            if (direction === 'up') {
                return focusEl(header[Math.min(tabIndex, header.length - 1)] || header[0] || focused);
            }
            return true;
        }

        if (headerIndex !== -1) {
            if (direction === 'left') {
                return focusEl(header[Math.max(0, headerIndex - 1)] || focused);
            }
            if (direction === 'right') {
                return focusEl(header[Math.min(header.length - 1, headerIndex + 1)] || focused);
            }
            if (direction === 'down') {
                return focusEl((focused.id === 'settings-btn' ? tabs[0] : tabs[1]) || tabs[0] || cards[0] || focused);
            }
            return true;
        }

        return false;
    }

    function detailHandle(direction) {
        var items = getDetailItems();
        var focused = (belongsToScreen(document.querySelector('.focused'), 'detail') ? document.querySelector('.focused') : null);
        if (!focused) return ensureDetailFocus(true);
        var idx = -1;
        for (var i = 0; i < items.length; i++) {
            if (focused === items[i]) {
                idx = i;
                break;
            }
        }
        if (idx === -1) return ensureDetailFocus(true);

        var trailerLinks = [];
        var actorCards = [];
        var recommendationCards = [];
        var fileItems = [];

        for (var j = 0; j < items.length; j++) {
            var el = items[j];
            if (el.classList.contains('catalog-trailer-play') ||
                el.classList.contains('catalog-trailer-link') ||
                el.classList.contains('catalog-trailer-card-item')) {
                trailerLinks.push(el);
            }
            if (el.classList.contains('catalog-actor-card')) {
                actorCards.push(el);
            }
            if (el.classList.contains('catalog-recommendation-card')) {
                recommendationCards.push(el);
            }
            if (el.classList && el.classList.contains('file-item')) {
                fileItems.push(el);
            }
        }
        var watchBtn = byId('catalog-watch-btn');
        var backBtn = byId('back-from-detail');

        var isTrailer = focused.classList.contains('catalog-trailer-play') ||
            focused.classList.contains('catalog-trailer-link') ||
            focused.classList.contains('catalog-trailer-card-item');
        var isActor = focused.classList.contains('catalog-actor-card');
        var isRecommendation = focused.classList.contains('catalog-recommendation-card');
        var isWatchBtn = focused.id === 'catalog-watch-btn';
        var isBackBtn = focused.id === 'back-from-detail';
        var isFileItem = focused.classList && focused.classList.contains('file-item');

        var trailerIndex = -1;
        for (var k = 0; k < trailerLinks.length; k++) {
            if (focused === trailerLinks[k]) {
                trailerIndex = k;
                break;
            }
        }
        var actorIndex = -1;
        for (var l = 0; l < actorCards.length; l++) {
            if (focused === actorCards[l]) {
                actorIndex = l;
                break;
            }
        }
        var recommendationIndex = -1;
        for (var m = 0; m < recommendationCards.length; m++) {
            if (focused === recommendationCards[m]) {
                recommendationIndex = m;
                break;
            }
        }
        var fileItemIndex = -1;
        for (var n = 0; n < fileItems.length; n++) {
            if (focused === fileItems[n]) {
                fileItemIndex = n;
                break;
            }
        }

        var scrollToElement = function (element) {
            if (!element) return;

            var detailView = document.getElementById('detail-view');
            if (detailView) {
                var elementRect = element.getBoundingClientRect();
                var containerRect = detailView.getBoundingClientRect();
                var scrollTop = detailView.scrollTop;
                var elementTop = elementRect.top - containerRect.top + scrollTop;
                var offset = 20;
                detailView.scrollTo({
                    top: Math.max(0, elementTop - offset),
                    behavior: 'smooth'
                });
            } else {
                element.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        };

        var scrollToTop = function () {
            var detailView = document.getElementById('detail-view');
            if (detailView) {
                detailView.scrollTo({
                    top: 0,
                    behavior: 'smooth'
                });
            }
        };

        // Новая логика для file-item
        if (isFileItem && fileItemIndex !== -1) {
            if (direction === 'left') {
                if (fileItemIndex > 0) {
                    focusEl(fileItems[fileItemIndex - 1]);
                    scrollToElement(fileItems[fileItemIndex - 1]);
                }
                return true;
            }
            if (direction === 'right') {
                if (fileItemIndex < fileItems.length - 1) {
                    focusEl(fileItems[fileItemIndex + 1]);
                    scrollToElement(fileItems[fileItemIndex + 1]);
                }
                return true;
            }
            if (direction === 'up') {
                // Находим предыдущий элемент (не file-item)
                var prevItems = [];
                for (var p = idx - 1; p >= 0; p--) {
                    if (!items[p].classList || !items[p].classList.contains('file-item')) {
                        prevItems.push(items[p]);
                    }
                }
                if (prevItems.length > 0) {
                    focusEl(prevItems[0]);
                    if (prevItems[0].id === 'catalog-watch-btn' || prevItems[0].id === 'back-from-detail') {
                        scrollToTop();
                    } else {
                        scrollToElement(prevItems[0]);
                    }
                }
                return true;
            }
            if (direction === 'down') {
                // На file-item down ничего не делает
                return true;
            }
            return true;
        }

        if (isTrailer && trailerIndex !== -1) {
            if (direction === 'left') {
                return focusEl(trailerLinks[Math.max(0, trailerIndex - 1)] || focused);
            }
            if (direction === 'right') {
                return focusEl(trailerLinks[Math.min(trailerLinks.length - 1, trailerIndex + 1)] || focused);
            }
            if (direction === 'up') {
                if (watchBtn && watchBtn.offsetParent !== null) {
                    focusEl(watchBtn);
                    scrollToTop();
                    return true;
                }
                return focusEl(items[Math.max(0, idx - 1)] || focused);
            }
            if (direction === 'down') {
                if (actorCards.length > 0) {
                    focusEl(actorCards[0]);
                    scrollToElement(actorCards[0]);
                    return true;
                } else if (recommendationCards.length > 0) {
                    focusEl(recommendationCards[0]);
                    scrollToElement(recommendationCards[0]);
                    return true;
                } else if (fileItems.length > 0) {
                    focusEl(fileItems[0]);
                    scrollToElement(fileItems[0]);
                    return true;
                }
                return true;
            }
            return true;
        }

        if (isActor && actorIndex !== -1) {
            if (direction === 'left') {
                return focusEl(actorCards[Math.max(0, actorIndex - 1)] || focused);
            }
            if (direction === 'right') {
                return focusEl(actorCards[Math.min(actorCards.length - 1, actorIndex + 1)] || focused);
            }
            if (direction === 'up') {
                if (trailerLinks.length > 0) {
                    focusEl(trailerLinks[trailerLinks.length - 1]);
                    scrollToElement(trailerLinks[trailerLinks.length - 1]);
                    return true;
                } else if (watchBtn && watchBtn.offsetParent !== null) {
                    focusEl(watchBtn);
                    scrollToTop();
                    return true;
                }
                return focusEl(items[Math.max(0, idx - 1)] || focused);
            }
            if (direction === 'down') {
                if (recommendationCards.length > 0) {
                    var targetIndex;
                    if (actorIndex < recommendationCards.length) {
                        targetIndex = actorIndex;
                    } else {
                        targetIndex = recommendationCards.length - 1;
                    }
                    focusEl(recommendationCards[targetIndex]);
                    scrollToElement(recommendationCards[targetIndex]);
                    return true;
                } else if (fileItems.length > 0) {
                    focusEl(fileItems[0]);
                    scrollToElement(fileItems[0]);
                    return true;
                }
                return true;
            }
            return true;
        }

        if (isRecommendation && recommendationIndex !== -1) {
            if (direction === 'left') {
                return focusEl(recommendationCards[Math.max(0, recommendationIndex - 1)] || focused);
            }
            if (direction === 'right') {
                return focusEl(recommendationCards[Math.min(recommendationCards.length - 1, recommendationIndex + 1)] || focused);
            }
            if (direction === 'up') {
                if (actorCards.length > 0) {
                    var targetIndex;
                    if (recommendationIndex < actorCards.length) {
                        targetIndex = recommendationIndex;
                    } else {
                        targetIndex = actorCards.length - 1;
                    }
                    focusEl(actorCards[targetIndex]);
                    scrollToElement(actorCards[targetIndex]);
                    return true;
                } else if (trailerLinks.length > 0) {
                    var targetIndex;
                    if (recommendationIndex < trailerLinks.length) {
                        targetIndex = recommendationIndex;
                    } else {
                        targetIndex = trailerLinks.length - 1;
                    }
                    focusEl(trailerLinks[targetIndex]);
                    scrollToElement(trailerLinks[targetIndex]);
                    return true;
                } else if (watchBtn && watchBtn.offsetParent !== null) {
                    focusEl(watchBtn);
                    scrollToTop();
                    return true;
                }
                return focusEl(items[Math.max(0, idx - 1)] || focused);
            }
            if (direction === 'down') {
                if (fileItems.length > 0) {
                    focusEl(fileItems[0]);
                    scrollToElement(fileItems[0]);
                    return true;
                }
                return true;
            }
            return true;
        }

        if (isWatchBtn) {
            scrollToTop();

            if (direction === 'down') {
                if (trailerLinks.length > 0) {
                    focusEl(trailerLinks[0]);
                    scrollToElement(trailerLinks[0]);
                    return true;
                } else if (actorCards.length > 0) {
                    focusEl(actorCards[0]);
                    scrollToElement(actorCards[0]);
                    return true;
                } else if (recommendationCards.length > 0) {
                    focusEl(recommendationCards[0]);
                    scrollToElement(recommendationCards[0]);
                    return true;
                } else if (fileItems.length > 0) {
                    focusEl(fileItems[0]);
                    scrollToElement(fileItems[0]);
                    return true;
                }
                return true;
            }
            if (direction === 'left') {
                return true;
            }
            if (direction === 'right') {
                return true;
            }
            if (direction === 'up') {
                return focusEl(backBtn || focused);
            }
            return true;
        }

        if (isBackBtn) {
            scrollToTop();

            if (direction === 'down') {
                if (watchBtn && watchBtn.offsetParent !== null) {
                    focusEl(watchBtn);
                    scrollToTop();
                    return true;
                }
                return focusEl(items[Math.min(items.length - 1, idx + 1)] || focused);
            }
            if (direction === 'up') {
                scrollToTop();
                return true;
            }
            if (direction === 'left' || direction === 'right') {
                return true;
            }
            return true;
        }

        // Общая навигация (для элементов, не попавших в специальные категории)
        if (direction === 'up') {
            var targetEl = items[Math.max(0, idx - 1)] || focused;
            focusEl(targetEl);
            if (targetEl.id === 'catalog-watch-btn' || targetEl.id === 'back-from-detail') {
                scrollToTop();
            } else {
                scrollToElement(targetEl);
            }
            return true;
        }
        if (direction === 'down') {
            var targetEl = items[Math.min(items.length - 1, idx + 1)] || focused;
            focusEl(targetEl);
            if (targetEl.id === 'catalog-watch-btn' || targetEl.id === 'back-from-detail') {
                scrollToTop();
            } else {
                scrollToElement(targetEl);
            }
            return true;
        }
        if (direction === 'left' || direction === 'right') {
            return true;
        }
        return true;
    }

    function closeFiltersPanel() {
        var panel = document.getElementById('search-filters-panel');
        var toggleBtn = document.getElementById('filter-toggle');
        if (panel && !panel.classList.contains('collapsed')) {
            if (typeof toggleSearchFiltersPanel === 'function') {
                toggleSearchFiltersPanel(false);
            } else {
                if (toggleBtn) toggleBtn.click();
            }
        }
    }

    function openFiltersPanelAndFocus() {
        var panel = document.getElementById('search-filters-panel');
        var toggleBtn = document.getElementById('filter-toggle');

        if (panel && panel.classList.contains('collapsed')) {
            if (typeof toggleSearchFiltersPanel === 'function') {
                toggleSearchFiltersPanel(true);
            } else {
                if (toggleBtn) toggleBtn.click();
            }

            // После открытия панели, устанавливаем фокус на первый фильтр
            setTimeout(function () {
                updateFocusableElements();
                var firstFilter = document.querySelector('#torrent-movie, #sort-by, #filter-quality, #filter-content-type, #filter-tracker, #filter-year, #filter-season, #filter-voice, #filter-videotype, #reset-filters');
                if (firstFilter) {
                    var filterIndex = -1;
                    for (var i = 0; i < focusableElements.length; i++) {
                        if (focusableElements[i] === firstFilter) {
                            filterIndex = i;
                            break;
                        }
                    }
                    if (filterIndex !== -1) {
                        setFocus(filterIndex);
                    }
                }
            }, 50);
        }
    }

    //функция searchHandle
    function searchHandle(direction) {
        // Получаем текущий режим поиска
        var currentMode = getCurrentSearchMode();

        // Общая часть для обоих режимов до навигации по результатам
        var focused = belongsToScreen(document.querySelector('.focused'), 'search') ? document.querySelector('.focused') : null;
        var query = byId('search-query');
        var top = getSearchTop();
        var filters = getSearchFilters();
        var results = getSearchResults();
        var topWithoutQuery = [];
        for (var i = 0; i < top.length; i++) {
            if (top[i] && top[i].id !== 'search-query') topWithoutQuery.push(top[i]);
        }
        var topEntry = topWithoutQuery[0] || filters[0] || results[0] || query;

        if (!focused) return ensureSearchFocus(true, false);

        if (document.activeElement === query && ['left', 'right', 'up', 'down'].indexOf(direction) !== -1) {
            blurEditor();
            return focusEl(topEntry);
        }

        var topIndex = -1;
        for (var j = 0; j < top.length; j++) {
            if (focused === top[j]) {
                topIndex = j;
                break;
            }
        }
        var filterIndex = -1;
        for (var k = 0; k < filters.length; k++) {
            if (focused === filters[k]) {
                filterIndex = k;
                break;
            }
        }
        var resultIndex = -1;
        for (var l = 0; l < results.length; l++) {
            if (focused === results[l]) {
                resultIndex = l;
                break;
            }
        }

        // Если режим torrentsearch - работаем как раньше
        if (currentMode === 'torrentsearch') {
            if (topIndex !== -1) {
                if (direction === 'left') return focusEl(top[Math.max(0, topIndex - 1)] || focused);
                if (direction === 'right') return focusEl(top[Math.min(top.length - 1, topIndex + 1)] || focused);
                if (direction === 'down') {
                    return focusEl(results[Math.min(results.length - 1, resultIndex + 1)] || focused);
                }
                if (direction === 'up') return true;
                return true;
            }

            if (filterIndex !== -1) {
                if (direction === 'left') {
                    // Если на первом фильтре и нажимаем влево - закрываем панель и переходим к поисковой строке
                    return focusEl(filters[Math.max(0, filterIndex - 1)] || focused);
                }
                if (direction === 'right') {
                    return focusEl(filters[Math.min(filters.length - 1, filterIndex + 1)] || focused);
                }
                if (direction === 'up') {
                    // Нажимаем вверх - закрываем панель и переходим к поисковой строке
                    closeFiltersPanel();
                    return focusEl(query);
                }
                if (direction === 'down') {
                    // Нажимаем вниз - закрываем панель и переходим к первому результату
                    closeFiltersPanel();
                    if (results.length > 0) {
                        return focusEl(results[0]);
                    }
                    return true;
                }
                return true;
            }

            if (resultIndex !== -1) {
                if (direction === 'up') {
                    if (resultIndex > 0) return focusEl(results[resultIndex - 1] || focused);
                    // Наверх с первого результата - открываем панель фильтров
                    return focusEl(query);
                }
                if (direction === 'down') return focusEl(results[Math.min(results.length - 1, resultIndex + 1)] || focused);
                if (direction === 'left') {
                    openFiltersPanelAndFocus();
                    return true;
                }
                if (direction === 'right') {
                    if (focused && (focused.classList.contains('search-result-item') || focused.classList.contains('global-search-card'))) {
                        // Получаем данные из дочерней кнопки .search-result-play (индекс 1)
                        var playButton = focused.querySelector('.search-result-play');

                        var magnet = playButton.dataset.magnet;
                        var hash = playButton.dataset.hash;
                        var searchResult = playButton.dataset.result;

                        try {
                            var resultJson = decodeURIComponent(searchResult);
                            searchResultJson = JSON.parse(resultJson);
                        } catch (e) {
                            console.error('Ошибка парсинга searchResult:');
                        }

                        if (magnet && typeof window.addTorrentSearchToServer === 'function') {
                            // Используем then вместо await
                            window.addTorrentSearchToServer(magnet, hash, searchResultJson)
                                .then(() => {
                                    var originalHtml = playButton.innerHTML;
                                    playButton.innerHTML = '✓';

                                    setTimeout(() => {
                                        playButton.innerHTML = originalHtml;
                                    }, 2000);
                                })
                                .catch(error => {
                                    console.error('Ошибка при добавлении торрента:', error);
                                });
                        } else if (!magnet) {
                            console.warn('Не найден magnet для добавления торрента');
                        }

                        return true;
                    }
                    return true;
                }
                return true;
            }

            return false;
        }
        // Если режим globalsearch - используем другую навигацию для результатов
        else if (currentMode === 'globalsearch') {
            if (topIndex !== -1) {
                if (direction === 'left') return focusEl(top[Math.max(0, topIndex - 1)] || focused);
                if (direction === 'right') return focusEl(top[Math.min(top.length - 1, topIndex + 1)] || focused);
                if (direction === 'down') {
                    if (results.length > 0) {
                        return focusEl(results[0]);
                    }
                    return true;
                }
                if (direction === 'up') return true;
                return true;
            }

            if (filterIndex !== -1) {
                if (direction === 'left') {
                    return focusEl(filters[Math.max(0, filterIndex - 1)] || focused);
                }
                if (direction === 'right') {
                    return focusEl(filters[Math.min(filters.length - 1, filterIndex + 1)] || focused);
                }
                if (direction === 'up') {
                    // Нажимаем вверх - закрываем панель и переходим к поисковой строке
                    closeFiltersPanel();
                    return focusEl(query);
                }
                if (direction === 'down') {
                    // Нажимаем вниз - закрываем панель и переходим к первому результату
                    closeFiltersPanel();
                    if (results.length > 0) {
                        return focusEl(results[0]);
                    }
                    return true;
                }
                return true;
            }

            // Навигация по результатам для globalsearch
            if (resultIndex !== -1) {
                var cols = getColumns();
                var row = Math.floor(resultIndex / cols);

                if (direction === 'left') {
                    return focusEl(results[Math.max(0, resultIndex - 1)] || focused);
                }

                if (direction === 'right') {
                    return focusEl(results[Math.min(results.length - 1, resultIndex + 1)] || focused);
                }

                if (direction === 'up') {
                    if (row === 0) {
                        // Наверх с первого ряда результатов - открываем панель фильтров
                        return focusEl(query);
                    }
                    return focusEl(results[Math.max(0, resultIndex - cols)] || focused);
                }

                if (direction === 'down') {
                    return focusEl(results[Math.min(results.length - 1, resultIndex + cols)] || focused);
                }

                return true;
            }

            return false;
        }

        return false;
    }
    
    function scrollToActiveConfigItem() {
        var activeItem = document.querySelector('#config-screen .focused');
        var configScreen = document.querySelector('#config-screen');
        var items = getConfigItems();

        if (!activeItem || !configScreen) return;

        // Находим реальный прокручиваемый контейнер
        var scrollContainer = configScreen;
        // Ищем родительский элемент, у которого есть прокрутка
        while (scrollContainer && scrollContainer.scrollHeight <= scrollContainer.clientHeight) {
            scrollContainer = scrollContainer.parentElement;
            if (!scrollContainer || scrollContainer === document.body) {
                scrollContainer = window;
                break;
            }
        }

        // Если контейнер - window, используем window.scrollY
        var isWindow = (scrollContainer === window);
        var currentScroll = isWindow ? window.scrollY : scrollContainer.scrollTop;

        // Находим индекс текущего элемента
        var currentIndex = -1;
        for (var i = 0; i < items.length; i++) {
            if (activeItem === items[i]) {
                currentIndex = i;
                break;
            }
        }

        // Получаем позицию элемента относительно окна
        var itemRect = activeItem.getBoundingClientRect();
        var containerTop = isWindow ? 0 : scrollContainer.getBoundingClientRect().top;
        var offsetTop = itemRect.top - containerTop;

        // Проверяем, предпоследний ли элемент
        var isSecondLast = (currentIndex === items.length - 2);
        // Проверяем, предпервый ли элемент
        var isSecondFirst = (currentIndex === 1);

        // Если предпоследний элемент - скроллим до конца
        if (isSecondLast) {
            if (isWindow) {
                window.scrollTo(0, document.body.scrollHeight - window.innerHeight);
            } else {
                scrollContainer.scrollTop = scrollContainer.scrollHeight - scrollContainer.clientHeight;
            }
            return;
        }

        // Если предпервый элемент - скроллим до начала
        if (isSecondFirst) {
            if (isWindow) {
                window.scrollTo(0, 0);
            } else {
                scrollContainer.scrollTop = 0;
            }
            return;
        }

        // Стандартная логика для остальных элементов
        var containerHeight = isWindow ? window.innerHeight : scrollContainer.clientHeight;

        // Если элемент выше видимой области
        if (offsetTop < 0) {
            var newScroll = currentScroll + offsetTop - 10;
            if (isWindow) {
                window.scrollTo(0, newScroll);
            } else {
                scrollContainer.scrollTop = newScroll;
            }
        }
        // Если элемент ниже видимой области
        else if (offsetTop + itemRect.height > containerHeight) {
            var newScroll = currentScroll + (offsetTop + itemRect.height - containerHeight) + 10;
            if (isWindow) {
                window.scrollTo(0, newScroll);
            } else {
                scrollContainer.scrollTop = newScroll;
            }
        }
    }

    function configHandle(direction) {
        var items = getConfigItems();
        var focused = (belongsToScreen(document.querySelector('.focused'), 'config') ? document.querySelector('.focused') : null);
        if (!focused) return ensureConfigFocus(true);
        var idx = -1;
        for (var i = 0; i < items.length; i++) {
            if (focused === items[i]) {
                idx = i;
                break;
            }
        }
        if (idx === -1) return ensureConfigFocus(true);

        // Проверяем, являются ли элементы кнопками синхронизации или замера скорости
        var isSyncBtn = focused.id === 'sync-clients-btn';
        var isSpeedtestBtn = focused.id === 'speedtest-btn';

        // Логика для sync-clients-btn
        if (isSyncBtn) {
            if (direction === 'left') {
                // Клавиша left - ничего не делаем
                return true;
            }
            if (direction === 'right') {
                // Перемещаем фокус на speedtest-btn
                var speedtestBtn = document.getElementById('speedtest-btn');
                if (speedtestBtn && belongsToScreen(speedtestBtn, 'config')) {
                    focusEl(speedtestBtn);
                    setTimeout(function () {
                        scrollToActiveConfigItem();
                    }, 50);
                }
                return true;
            }
            if (direction === 'up') {
                // Перемещаем фокус на элемент перед sync-clients-btn
                var newFocused = items[Math.max(0, idx - 1)] || focused;
                if (newFocused) {
                    focusEl(newFocused);
                    setTimeout(function () {
                        scrollToActiveConfigItem();
                    }, 50);
                }
                return true;
            }
            if (direction === 'down') {
                // Перемещаем фокус на элемент через один (idx + 2)
                var newFocused = items[Math.min(items.length - 1, idx + 2)] || focused;
                if (newFocused) {
                    focusEl(newFocused);
                    setTimeout(function () {
                        scrollToActiveConfigItem();
                    }, 50);
                }
                return true;
            }
            return false;
        }

        // Логика для speedtest-btn
        if (isSpeedtestBtn) {
            if (direction === 'right') {
                // Клавиша right - ничего не делаем
                return true;
            }
            if (direction === 'left') {
                // Перемещаем фокус на sync-clients-btn
                var syncBtn = document.getElementById('sync-clients-btn');
                if (syncBtn && belongsToScreen(syncBtn, 'config')) {
                    focusEl(syncBtn);
                    setTimeout(function () {
                        scrollToActiveConfigItem();
                    }, 50);
                }
                return true;
            }
            if (direction === 'up') {
                // Перемещаем фокус на элемент через один перед speedtest-btn (idx - 2)
                var newFocused = items[Math.max(0, idx - 2)] || focused;
                if (newFocused) {
                    focusEl(newFocused);
                    setTimeout(function () {
                        scrollToActiveConfigItem();
                    }, 50);
                }
                return true;
            }
            if (direction === 'down') {
                // Перемещаем фокус на следующий элемент
                var newFocused = items[Math.min(items.length - 1, idx + 1)] || focused;
                if (newFocused) {
                    focusEl(newFocused);
                    setTimeout(function () {
                        scrollToActiveConfigItem();
                    }, 50);
                }
                return true;
            }
            return false;
        }

        // Стандартная логика для остальных элементов
        var newFocused = null;
        if (direction === 'up') {
            newFocused = items[Math.max(0, idx - 1)] || focused;
        } else if (direction === 'down') {
            newFocused = items[Math.min(items.length - 1, idx + 1)] || focused;
        } else if (direction === 'left' || direction === 'right') {
            return true;
        } else {
            return false;
        }

        if (newFocused) {
            focusEl(newFocused);
            // Добавляем скроллинг после фокуса
            setTimeout(function () {
                scrollToActiveConfigItem();
            }, 50);
        }

        return false;
    }

    function onOk() {
        var screen = currentScreen();
        var focused = document.querySelector('.focused');
        if (screen === 'torrents') {
            if (!belongsToScreen(focused, 'torrents')) return ensureTorrentFocus(true);
            if (focused.id === 'search-query' || focused.id === 'search-btn' || focused.id === 'tab-search') return openSearchScreen(true);
            if (focused.id === 'tab-catalog') {
                clickEl(focused);
                return true;
            }
            clickEl(focused);
            return true;
        }
        if (screen === 'catalog') {
            if (!belongsToScreen(focused, 'catalog')) return ensureCatalogFocus(true);
            clickEl(focused);
            return true;
        }
        if (screen === 'search') {
            if (!belongsToScreen(focused, 'search')) return ensureSearchFocus(true, true);

            if (focused.id === 'search-query') {
                focusEl(focused, { nativeFocus: true });
                try { focused.click(); } catch (e) { }
                try { focused.focus(); } catch (e) { }
                try { if (focused.select) focused.select(); } catch (e) { }
                return true;
            }
            var panel = document.getElementById('search-filters-panel');

            if (focused.id === 'filter-toggle') {
                if (panel && panel.classList.contains('collapsed')) {
                    openFiltersPanelAndFocus();
                    return true;
                } else {
                    closeFiltersPanel();
                    return true;
                }
            }

            if (focused.tagName === 'SELECT' || focused.id === 'filter-year') {
                return openNativeSearchControl(focused);
            }

            clickEl(focused);
            return true;
        }
        if (screen === 'detail') {
            if (!belongsToScreen(focused, 'detail')) return ensureDetailFocus(true);

            if (focused.classList.contains('file-item')) {
                clickEl(focused.querySelector('.play-btn') || focused);
                return true;
            }

            if (focused.classList.contains('detail-progress-btn')) {
                clickEl(focused);
                return true;
            }

            clickEl(focused);
            return true;
        }
        if (screen === 'config') {
            if (!belongsToScreen(focused, 'config')) return ensureConfigFocus(true);
            focusEl(focused, { nativeFocus: focused.tagName === 'INPUT' });
            clickEl(focused);
            return true;
        }
        return false;
    }

    function onBack() {
        var search = byId('search-overlay');
        var detail = byId('detail-view');
        var config = byId('config-screen');
        var catalog = currentScreen() === 'catalog';
        var donate = currentScreen() === 'donate';

        if (AppState.syncCodeScreen == true) {
            toggleSyncOverlay();
            return true;
        }

        if (typeof window.closeCatalogTrailerOverlay === 'function' && window.closeCatalogTrailerOverlay()) {
            setTimeout(function () { ensureDetailFocus(true); }, 80);
            return true;
        }

        if (search && !search.classList.contains('hidden') && getComputedStyle(search).display !== 'none') {
            if (typeof window.hideSearchResults === 'function') {
                window.hideSearchResults();
                var tabs = getTorrentTabs();
                focusEl(tabs[2]);
            } else {
                leaveSearchToTorrents();
            }
            return true;
        }

        if (detail && getComputedStyle(detail).display !== 'none') {
            clickEl(byId('back-from-detail') || document.querySelector('.back-btn'));
            return true;
        }

        if (donate) {
            if (typeof window.closeDonateOverlay === 'function') window.closeDonateOverlay();
            return true;
        }

        if (catalog) {
            if (window.catalogState) {
                window.catalogState.lastSelectedIndex = 0;
                window.catalogState.lastSelectedId = null;
                localStorage.removeItem('lastCatalogCardIndex');
                console.log('🧹 Очищен num_index при выходе из каталога');
            }

            if (typeof window.backToCatalogList === 'function') {
                AppState.currentScreen = 'catalog';
                window.backToCatalogList();
            } else {
                clickEl(byId('back-from-catalog'));
            }
            setTimeout(function () { ensureCatalogFocus(true); }, 180);
            return true;
        }

        if (config && getComputedStyle(config).display !== 'none') {
            var main = byId('torrserver-section');
            config.style.display = 'none';
            if (main) main.style.display = 'block';
            try { window.AppState.currentScreen = 'torrents'; } catch (e) { }
            setTimeout(function () { ensureTorrentFocus(true); }, 180);
            return true;
        }

        return false;
    }

    function isArrowKey(keyCode) {
        return [37, 38, 39, 40].indexOf(keyCode) !== -1 || (typeof isKeyPressed === 'function' && (isKeyPressed('UP', keyCode) || isKeyPressed('DOWN', keyCode) || isKeyPressed('LEFT', keyCode) || isKeyPressed('RIGHT', keyCode)));
    }
    function arrowDir(keyCode) {
        if ([37, 38, 39, 40].indexOf(keyCode) !== -1) {
            return ({ 37: 'left', 38: 'up', 39: 'right', 40: 'down' })[keyCode];
        }
        if (typeof isKeyPressed === 'function') {
            if (isKeyPressed('UP', keyCode)) return 'up';
            if (isKeyPressed('DOWN', keyCode)) return 'down';
            if (isKeyPressed('LEFT', keyCode)) return 'left';
            if (isKeyPressed('RIGHT', keyCode)) return 'right';
        }
        return null;
    }
    function isOkKey(keyCode) {
        return keyCode === 13 || (typeof isKeyPressed === 'function' && isKeyPressed('OK', keyCode));
    }
    function isBackKey(keyCode) {
        return [8, 27, 461, 10009].indexOf(keyCode) !== -1 || (typeof isKeyPressed === 'function' && (isKeyPressed('BACK', keyCode) || isKeyPressed('EXIT', keyCode)));
    }

    document.addEventListener('keydown', function (e) {
        var screen = currentScreen();
        if (screen === 'player') return;
        if (['torrents', 'catalog', 'search', 'detail', 'config', 'donate'].indexOf(screen) === -1) return;
        var active = document.activeElement;
        var editing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');

        if (isBackKey(e.keyCode)) {
            e.preventDefault(); e.stopImmediatePropagation();
            // БЛОКИРУЕМ НАВИГАЦИЮ ЕСЛИ ПЛЕЕР АКТИВЕН
            var playbackOverlay = document.getElementById('playback-overlay');
            var isPlaybackActive = playbackOverlay && playbackOverlay.classList.contains('active');

            // Если плеер активен, не обрабатываем навигацию по торрентам
            if (isPlaybackActive) {
                // Пропускаем обработку, если только это не специальные клавиши для плеера
                // Они обрабатываются позже в секции плеера
                cancelCurrentPlayback();
                return;
            }
            if (isCustomFilterMenuOpen()) {
                closeCustomFilterMenu();
                return;
            }

            if (screen === 'catalog' && window.catalogState && window.catalogState.currentCatalog) {
                window.catalogState.lastSelectedIndex = 0;
                window.catalogState.lastSelectedId = null;
                localStorage.removeItem('lastCatalogCardIndex');
                console.log('🧹 Очищен num_index при выходе из каталога');
            }

            if (editing) {
                blurEditor();
                if (screen === 'search') ensureSearchFocus(true, true);
                else if (screen === 'catalog') ensureCatalogFocus(true);
                else if (screen === 'config') ensureConfigFocus(true);
                else if (screen === 'detail') ensureDetailFocus(true);
                else ensureTorrentFocus(true);
                return;
            }
            onBack();
            return;
        }

        if (isArrowKey(e.keyCode)) {
            e.preventDefault(); e.stopImmediatePropagation();
            var dir = arrowDir(e.keyCode);
            if (isCustomFilterMenuOpen()) {
                if (dir === 'up') moveCustomFilterMenu(-1);
                else if (dir === 'down') moveCustomFilterMenu(1);
                return;
            }
            if (screen === 'torrents') torrentHandle(dir);
            else if (screen === 'catalog') catalogHandle(dir);
            else if (screen === 'search') searchHandle(dir);
            else if (screen === 'detail') detailHandle(dir);
            else if (screen === 'config') configHandle(dir);
            return;
        }

        if (isOkKey(e.keyCode)) {
            e.preventDefault(); e.stopImmediatePropagation();

            if (isCustomFilterMenuOpen()) {
                applyCustomFilterMenuSelection();
                return;
            }

            if (screen === 'torrents') {
                var focused = document.querySelector('.focused');
                if (focused && focused.classList.contains('torrent-card')) {
                    if (!e.repeat) {
                        okHoldHandled = false;
                        okHoldFocused = focused;
                        clearOkHold();
                        okHoldTimer = setTimeout(async function () {
                            okHoldHandled = true;
                            var hash = okHoldFocused && okHoldFocused.dataset ? okHoldFocused.dataset.hash : null;
                            if (typeof window.setTorrentClickSuppressed === 'function') {
                                window.setTorrentClickSuppressed(1500);
                            }
                            if (okHoldFocused) {
                                okHoldFocused.dataset.suppressClick = '1';
                            }
                            if (hash && typeof window.removeTorrentByHash === 'function') {
                                await window.removeTorrentByHash(hash, { skipConfirm: true });
                            }
                            setTimeout(function () {
                                if (okHoldFocused) delete okHoldFocused.dataset.suppressClick;
                            }, 1500);
                        }, 900);
                    }
                    return;
                }
            }

            onOk();
            return;
        }
    }, true);

    document.addEventListener('keyup', function (e) {
        var screen = currentScreen();
        if (isCustomFilterMenuOpen()) return;
        if (!isOkKey(e.keyCode) || screen !== 'torrents') return;

        var focused = document.querySelector('.focused');
        var cardStillFocused = focused && okHoldFocused && focused === okHoldFocused;

        clearOkHold();

        if (!okHoldHandled && cardStillFocused && focused.classList.contains('torrent-card')) {
            focused.click();
        }

        okHoldHandled = false;
        okHoldFocused = null;
    }, true);

    setInterval(function () {
        var s = currentScreen();
        if (s === 'player') return;
        if (s === 'torrents') ensureTorrentFocus(false);
        else if (s === 'catalog') ensureCatalogFocus(false);
        else if (s === 'search') ensureSearchFocus(false, true);
        else if (s === 'detail') ensureDetailFocus(false);
        else if (s === 'config') ensureConfigFocus(false);
    }, 250);

    var prevShowDetail = window.showDetail;
    if (typeof prevShowDetail === 'function') {
        window.showDetail = function () {
            var out = prevShowDetail.apply(this, arguments);
            setTimeout(function () {
                if (currentScreen() !== 'player') ensureDetailFocus(true);
            }, 220);
            return out;
        };
    }

    var prevShowSearchResults = window.showSearchResults;
    if (typeof prevShowSearchResults === 'function') {
        window.showSearchResults = function () {
            var out = prevShowSearchResults.apply(this, arguments);
            setTimeout(function () { ensureSearchFocus(true, true); }, 120);
            return out;
        };
    }

    setTimeout(function () { ensureTorrentFocus(true); }, 120);
}

window.addEventListener('popstate', function (e) {
    // Блокировка если нужно
    if (window.swipeBlocked) return;

    // Создаем событие клавиши BACK для существующего обработчика
    var backEvent = new KeyboardEvent('keydown', {
        keyCode: 27,  // ESC/BACK
        key: 'Escape',
        bubbles: true,
        cancelable: true
    });
    document.dispatchEvent(backEvent);

    // КРИТИЧЕСКИ ВАЖНО: добавляем новое состояние после обработки свайпа
    // чтобы следующий свайп сработал так же, а не закрыл приложение
    setTimeout(function () {
        window.history.pushState({ page: 'main' }, '');
    }, 150);
});

// Добавляем начальное состояние в историю
window.history.pushState({ page: 'main' }, '');

// Функция для блокировки свайпов на время
window.blockSwipe = function (ms) {
    window.swipeBlocked = true;
    setTimeout(function () {
        window.swipeBlocked = false;
    }, ms || 500);
};

// ==================== ИНИЦИАЛИЗАЦИЯ ====================

function initControl() {
    console.log('Модуль управления инициализирован');
    setupKeyboardHandlers();
    setupFocusRescue();

    // Экспортируем функции в глобальный объект
    window.updateFocusableElements = updateFocusableElements;
    window.setFocus = setFocus;
    window.navigate = navigate;
    window.showPlayerControls = showPlayerControls;
    window.hidePlayerControls = hidePlayerControls;
    window.hidePlayerPanelsOnly = hidePlayerPanelsOnly;
    window.hidePlayerUi = hidePlayerUi;
    window.focusFirstTorrentCard = focusFirstTorrentCard;
    window.focusSearchHome = focusSearchHome;
    window.openNativeSearchControl = window.openNativeSearchControl || function (el) {
        if (el && (el.tagName === 'SELECT' || el.id === 'filter-year')) {
            el.focus();
            try { el.click(); } catch (e) { }
        }
    };
}

// Автоматическая инициализация
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initControl);
} else {
    initControl();
}
