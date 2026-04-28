// control.js - Модуль управления навигацией, фокусом и обработкой клавиш (DOM-версия)

// ==================== ПЕРЕМЕННЫЕ ====================

var currentFocusedElement = null;  // Вместо индекса храним DOM элемент
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

// ==================== УПРАВЛЕНИЕ ФОКУСОМ (DOM-версия) ====================

function getAllFocusableElements() {
    var screen = AppState.currentScreen;
    var elements = [];

    var episodesPanel = document.getElementById('episodes-panel');
    var audioPanel = document.getElementById('audio-panel');
    var isEpisodesOpen = episodesPanel && !episodesPanel.classList.contains('hidden');
    var isAudioOpen = audioPanel && !audioPanel.classList.contains('hidden');

    if (isEpisodesOpen) {
        var episodeItems = document.querySelectorAll('.episode-item, .close-panel-btn');
        for (var i = 0; i < episodeItems.length; i++) {
            if (episodeItems[i] && episodeItems[i].offsetParent !== null) elements.push(episodeItems[i]);
        }
        return elements;
    }

    if (isAudioOpen) {
        var audioItems = document.querySelectorAll('.audio-item, .close-panel-btn');
        for (var j = 0; j < audioItems.length; j++) {
            if (audioItems[j] && audioItems[j].offsetParent !== null) elements.push(audioItems[j]);
        }
        return elements;
    }

    if (screen === 'player') {
        var controlsContainer = document.getElementById('controls-container');
        var controlsVisible = !!controlsContainer && !controlsContainer.classList.contains('idle-hidden');

        if (controlsVisible) {
            var seekSliderEl = document.getElementById('seek-slider');
            var buttons = document.querySelectorAll('#prev-episode-btn, #play-pause-btn, #next-episode-btn, #audio-btn, #episodes-btn, #mute-btn, #toggle-buffer-btn');
            var buttonList = [];
            for (var k = 0; k < buttons.length; k++) {
                if (buttons[k] && buttons[k].offsetParent !== null) buttonList.push(buttons[k]);
            }
            elements = [seekSliderEl].concat(buttonList).filter(function (el) { return el && el.offsetParent !== null; });
        }
    } else if (screen === 'detail') {
        var progressElements = document.querySelectorAll('.detail-progress-btn');
        var fileElements = document.querySelectorAll('.file-item');
        var backButton = document.querySelectorAll('.back-btn');
        for (var l = 0; l < progressElements.length; l++) elements.push(progressElements[l]);
        for (var m = 0; m < fileElements.length; m++) elements.push(fileElements[m]);
        for (var n = 0; n < backButton.length; n++) elements.push(backButton[n]);
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
            if (allCards[o] && allCards[o].offsetParent !== null) cards.push(allCards[o]);
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

        if (searchInputEl && searchInputEl.offsetParent !== null) elements.push(searchInputEl);
        if (searchBtnEl && searchBtnEl.offsetParent !== null) elements.push(searchBtnEl);
        if (tabTorrentsEl && tabTorrentsEl.offsetParent !== null) elements.push(tabTorrentsEl);
        if (tabSearchEl && tabSearchEl.offsetParent !== null) elements.push(tabSearchEl);
        if (tabCatalogEl && tabCatalogEl.offsetParent !== null) elements.push(tabCatalogEl);
        if (settingsBtnEl && settingsBtnEl.offsetParent !== null) elements.push(settingsBtnEl);
        elements = elements.concat(cards);
    } else if (screen === 'catalog') {
        var catalogCards = document.querySelectorAll('.torrent-card.catalog-card, .torrent-card.catalog-folder-card');
        for (var q = 0; q < catalogCards.length; q++) {
            if (catalogCards[q] && catalogCards[q].offsetParent !== null) elements.push(catalogCards[q]);
        }
        window.catalogCards = elements;
    } else if (screen === 'search') {
        var searchInputEl = document.getElementById('search-query');
        var filterToggleEl = document.getElementById('filter-toggle');
        var searchBtnEl = document.getElementById('search-btn');
        var closeSearchEl = document.getElementById('close-search');
        var filterControlsList = document.querySelectorAll('#torrent-movie, #sort-by, #filter-quality, #filter-content-type, #filter-tracker, #filter-year, #filter-season, #filter-voice, #reset-filters');
        for (var r = 0; r < filterControlsList.length; r++) {
            if (filterControlsList[r] && filterControlsList[r].offsetParent !== null) elements.push(filterControlsList[r]);
        }
        var resultItemsList = document.querySelectorAll('.search-result-item');
        for (var s = 0; s < resultItemsList.length; s++) {
            if (resultItemsList[s] && resultItemsList[s].offsetParent !== null) elements.push(resultItemsList[s]);
        }
        if (searchInputEl && searchInputEl.offsetParent !== null) elements.unshift(searchInputEl);
        if (filterToggleEl && filterToggleEl.offsetParent !== null) elements.splice(1, 0, filterToggleEl);
        if (searchBtnEl && searchBtnEl.offsetParent !== null) elements.splice(2, 0, searchBtnEl);
        if (closeSearchEl && closeSearchEl.offsetParent !== null) elements.splice(3, 0, closeSearchEl);
    } else if (screen === 'config') {
        var configItems = document.querySelectorAll('#torrserver-url, #auth-checkbox, #auth-login, #auth-password, .settings-btn');
        for (var v = 0; v < configItems.length; v++) {
            if (configItems[v] && configItems[v].offsetParent !== null) elements.push(configItems[v]);
        }
    }

    return elements.filter(function (el) {
        if (!el) return false;
        var style = window.getComputedStyle(el);
        return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            el.offsetParent !== null;
    });
}

function setFocusToElement(element) {
    if (!element) return false;

    // Убираем класс focused со всех элементов
    var focusedElements = document.querySelectorAll('.focused');
    for (var i = 0; i < focusedElements.length; i++) {
        focusedElements[i].classList.remove('focused');
    }

    // Добавляем класс новому элементу
    element.classList.add('focused');
    currentFocusedElement = element;

    // Обновляем последний выбранный торрент если нужно
    if (AppState.currentScreen === 'torrents' && element.classList && element.classList.contains('torrent-card')) {
        if (element.dataset.hash) {
            lastSelectedTorrentHash = element.dataset.hash;
            // Находим индекс в массиве торрентов
            for (var i = 0; i < AppState.torrents.length; i++) {
                if (AppState.torrents[i] && AppState.torrents[i].hash === element.dataset.hash) {
                    lastSelectedTorrentIndex = i;
                    break;
                }
            }
            window.lastSelectedTorrentHash = lastSelectedTorrentHash;
            window.lastSelectedTorrentIndex = lastSelectedTorrentIndex;
        }
    }

    // Убираем фокус с input если нужно
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

    // Прокручиваем к элементу
    element.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'center'
    });

    console.log('🎯 Фокус на элементе:', element);
    return true;
}

function getNextFocusableElement(currentElement, direction) {
    var allElements = getAllFocusableElements();
    if (allElements.length === 0) return null;

    var currentIndex = -1;
    for (var i = 0; i < allElements.length; i++) {
        if (allElements[i] === currentElement) {
            currentIndex = i;
            break;
        }
    }

    if (currentIndex === -1) return allElements[0];

    var newIndex = currentIndex;
    switch (direction) {
        case 'up':
        case 'left':
            newIndex = currentIndex - 1;
            break;
        case 'down':
        case 'right':
            newIndex = currentIndex + 1;
            break;
    }

    if (newIndex < 0) newIndex = allElements.length - 1;
    if (newIndex >= allElements.length) newIndex = 0;

    return allElements[newIndex];
}

function getNeighborInGrid(currentElement, direction, rows, cardsPerRow) {
    if (!currentElement || !currentElement.classList || !currentElement.classList.contains('torrent-card')) {
        return null;
    }

    // Находим текущую позицию в сетке
    var cardIndex = -1;
    for (var i = 0; i < rows.allCards.length; i++) {
        if (rows.allCards[i] === currentElement) {
            cardIndex = i;
            break;
        }
    }

    if (cardIndex === -1) return null;

    var newIndex = cardIndex;
    if (direction === 'left' && cardIndex % cardsPerRow !== 0) {
        newIndex = cardIndex - 1;
    } else if (direction === 'right' && (cardIndex + 1) % cardsPerRow !== 0 && cardIndex < rows.allCards.length - 1) {
        newIndex = cardIndex + 1;
    } else if (direction === 'up' && cardIndex >= cardsPerRow) {
        newIndex = cardIndex - cardsPerRow;
    } else if (direction === 'down' && cardIndex + cardsPerRow < rows.allCards.length) {
        newIndex = cardIndex + cardsPerRow;
    } else {
        return null;
    }

    return rows.allCards[newIndex];
}

function navigateToElement(direction) {
    var activeElement = document.activeElement;
    if (activeElement && activeElement.id === 'search-query') {
        activeElement.blur();
        var allElements = getAllFocusableElements();
        var targetElement = allElements.find(function (el) {
            return el.classList && el.classList.contains('torrent-card') ||
                el.id === 'filter-toggle' ||
                el.classList.contains('search-result-item');
        });
        if (targetElement) setFocusToElement(targetElement);
        return;
    }

    var currentElement = currentFocusedElement || document.querySelector('.focused');
    if (!currentElement) {
        var allElements = getAllFocusableElements();
        if (allElements.length > 0) setFocusToElement(allElements[0]);
        return;
    }

    // Специальная навигация для разных экранов
    var screen = AppState.currentScreen;

    // Навигация для торрентов (сетка)
    if (screen === 'torrents' && currentElement.classList && currentElement.classList.contains('torrent-card')) {
        var cardsPerRow = getTorrentGridColumns();
        var neighbor = getNeighborInGrid(currentElement, direction, window.torrentRows, cardsPerRow);
        if (neighbor) {
            setFocusToElement(neighbor);
            return;
        }

        // Навигация между рядами
        var allCards = window.torrentRows.allCards;
        var currentCardIndex = allCards.indexOf(currentElement);

        if (direction === 'up' && currentCardIndex < cardsPerRow) {
            var tabTorrents = document.getElementById('tab-torrents');
            if (tabTorrents) setFocusToElement(tabTorrents);
        } else if (direction === 'down' && currentCardIndex + cardsPerRow >= allCards.length) {
            // Достигнут низ, ничего не делаем
        } else {
            var nextElement = getNextFocusableElement(currentElement, direction);
            if (nextElement) setFocusToElement(nextElement);
        }
        return;
    }

    // Навигация для каталога
    if (screen === 'catalog') {
        var cardsPerRow = getTorrentGridColumns();
        var catalogCards = window.catalogCards || [];
        var currentCardIndex = catalogCards.indexOf(currentElement);

        if (currentCardIndex !== -1) {
            var newIndex = currentCardIndex;
            if (direction === 'left' && currentCardIndex % cardsPerRow !== 0) {
                newIndex = currentCardIndex - 1;
            } else if (direction === 'right' && (currentCardIndex + 1) % cardsPerRow !== 0 && currentCardIndex < catalogCards.length - 1) {
                newIndex = currentCardIndex + 1;
            } else if (direction === 'up' && currentCardIndex >= cardsPerRow) {
                newIndex = currentCardIndex - cardsPerRow;
            } else if (direction === 'down' && currentCardIndex + cardsPerRow < catalogCards.length) {
                newIndex = currentCardIndex + cardsPerRow;
                if (typeof window.checkAndLoadMoreOnNavigation === 'function') {
                    window.checkAndLoadMoreOnNavigation();
                }
            }

            if (newIndex !== currentCardIndex && catalogCards[newIndex]) {
                setFocusToElement(catalogCards[newIndex]);
                return;
            }
        }
    }

    // Навигация для панелей плеера
    if (screen === 'player') {
        var controlsContainer = document.getElementById('controls-container');
        var controlsVisible = !controlsContainer.classList.contains('idle-hidden');

        if (!controlsVisible) return;

        var allElements = getAllFocusableElements();
        var currentIdx = allElements.indexOf(currentElement);

        if (currentElement && currentElement.id === 'seek-slider') {
            if (direction === 'down' && allElements.length > 1) {
                setFocusToElement(allElements[1]);
            }
            return;
        }

        if (direction === 'up') {
            if (allElements[0]) setFocusToElement(allElements[0]);
        } else {
            var nextElement = getNextFocusableElement(currentElement, direction);
            if (nextElement) setFocusToElement(nextElement);
        }
        return;
    }

    // Стандартная навигация для остальных экранов
    var nextElement = getNextFocusableElement(currentElement, direction);
    if (nextElement) setFocusToElement(nextElement);
}

function focusFirstTorrentCard(retries, delay) {
    if (retries === undefined) retries = 6;
    if (delay === undefined) delay = 120;
    if (AppState.currentScreen !== 'torrents') return false;

    var allElements = getAllFocusableElements();
    var firstCard = allElements.find(function (el) {
        return el.classList && el.classList.contains('torrent-card');
    });

    if (firstCard) {
        setFocusToElement(firstCard);
        return true;
    }

    if (retries > 0) {
        setTimeout(function () { focusFirstTorrentCard(retries - 1, delay); }, delay);
    }
    return false;
}

function focusSearchHome(preferQuery) {
    if (preferQuery === undefined) preferQuery = true;
    var allElements = getAllFocusableElements();

    if (preferQuery) {
        var queryElement = document.getElementById('search-query');
        if (queryElement && allElements.includes(queryElement)) {
            setFocusToElement(queryElement);
            return;
        }
    }

    var searchBtn = document.getElementById('search-btn');
    if (searchBtn && allElements.includes(searchBtn)) {
        setFocusToElement(searchBtn);
        return;
    }

    var firstFilter = allElements.find(function (el) {
        return ['filter-toggle', 'torrent-movie', 'sort-by', 'filter-quality', 'filter-content-type', 'filter-tracker', 'filter-year', 'filter-season', 'filter-voice', 'reset-filters', 'close-search'].indexOf(el.id) !== -1;
    });

    if (firstFilter) {
        setFocusToElement(firstFilter);
    } else if (allElements.length > 0) {
        setFocusToElement(allElements[0]);
    }
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
        var targetElement = document.getElementById(preferredFocusId);
        if (targetElement) {
            setFocusToElement(targetElement);
        } else {
            var allElements = getAllFocusableElements();
            if (allElements.length > 0) setFocusToElement(allElements[0]);
        }
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
    currentFocusedElement = null;
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

// ==================== УПРАВЛЕНИЕ ПЕРЕМОТКОЙ ====================

function stopSeeking() {
    if (seekHoldInterval) {
        clearInterval(seekHoldInterval);
        seekHoldInterval = null;
    }
}

// ==================== ОБРАБОТЧИКИ КЛАВИШ ====================

function focusActivePanelItem(panelType) {
    setTimeout(function () {
        var activeItem = null;
        if (panelType === 'episodes') {
            activeItem = document.querySelector('.episode-item.active');
        } else if (panelType === 'audio') {
            activeItem = document.querySelector('.audio-item.active');
        }

        if (activeItem) {
            setFocusToElement(activeItem);
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

        if (isPlaybackActive) {
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
                navigateToElement(keyToDirection(key));
                return;
            }

            if (isKeyPressed('OK', key) || key === 13) {
                e.preventDefault();
                if (e.repeat) return;

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
                var queryElement = document.getElementById('search-query');
                if (queryElement) setFocusToElement(queryElement);
                return;
            }
            if (isKeyPressed('DOWN', key) || isKeyPressed('UP', key) || isKeyPressed('LEFT', key) || isKeyPressed('RIGHT', key)) {
                e.preventDefault();
                activeElement.blur();

                if (AppState.currentScreen === 'search') {
                    var allElements = getAllFocusableElements();
                    var firstElement = allElements.find(function (el) {
                        return el.id === 'filter-toggle' || el.classList.contains('search-result-item');
                    });
                    if (firstElement) setFocusToElement(firstElement);
                } else {
                    navigateToElement(keyToDirection(key));
                }
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
                    var allElements = getAllFocusableElements();
                    var currentIdx = allElements.indexOf(activeElement);
                    if (currentIdx !== -1 && currentIdx < allElements.length - 1) {
                        setFocusToElement(allElements[currentIdx + 1]);
                    } else if (allElements.length > 0) {
                        setFocusToElement(allElements[0]);
                    }
                    return;
                }
                return;
            }

            if (isKeyPressed('UP', key) || isKeyPressed('DOWN', key) ||
                isKeyPressed('LEFT', key) || isKeyPressed('RIGHT', key)) {
                e.preventDefault();
                navigateToElement(keyToDirection(key));
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

        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return;
        }

        // ===== ОБРАБОТКА ДЛЯ ПЛЕЕРА =====
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
                    console.log('🎯 OK на элементе:', focused.id || focused.className);

                    var actionPerformed = false;

                    if (focused.id === 'play-pause-btn') {
                        if (videoPlayer.paused) videoPlayer.play();
                        else videoPlayer.pause();
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
                        focused.click();
                        setTimeout(function () {
                            focusActivePanelItem('episodes');
                        }, 100);
                        actionPerformed = false;
                    } else if (focused.id === 'audio-btn') {
                        focused.click();
                        setTimeout(function () {
                            focusActivePanelItem('audio');
                        }, 100);
                        actionPerformed = false;
                    } else if (focused.id === 'exit-player-btn') {
                        if (typeof window.showDetailView === 'function') window.showDetailView();
                        return;
                    } else if (focused.id === 'toggle-buffer-btn') {
                        focused.click();
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
                            console.log('✅ Действие выполнено, панель скрыта');
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
                var controlsContainer = document.getElementById('controls-container');
                var controlsVisible = !controlsContainer.classList.contains('idle-hidden');

                if (!controlsVisible) {
                    e.preventDefault();
                    return;
                }

                e.preventDefault();
                if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();

                var focusedElement = currentFocusedElement || document.querySelector('.focused');
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
                            console.log('⚡ Ускорение перемотки: ' + currentStep + ' сек');
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
                        if (typeof AppState !== 'undefined') AppState.previewTime = newValue;
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
                            if (seekHoldInterval) updateStepByDuration();
                            else if (accelerationTimer) clearInterval(accelerationTimer);
                        }, 200);
                    }
                    return;
                } else {
                    navigateToElement(keyToDirection(key));
                    return;
                }
            }

            if (controlsVisible && (isKeyPressed('UP', key) || isKeyPressed('DOWN', key))) {
                e.preventDefault();
                navigateToElement(keyToDirection(key));
                if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();
                return;
            }

            if (isKeyPressed('PLAY', key) || isKeyPressed('PAUSE', key) || isKeyPressed('PLAY_PAUSE', key)) {
                e.preventDefault();
                if (videoPlayer.paused) videoPlayer.play();
                else videoPlayer.pause();
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

            if (!controlsVisible) return;
        }

        // Стандартная навигация для остальных экранов
        if (isKeyPressed('UP', key)) {
            e.preventDefault();
            navigateToElement('up');
        } else if (isKeyPressed('DOWN', key)) {
            e.preventDefault();
            navigateToElement('down');
        } else if (isKeyPressed('LEFT', key)) {
            e.preventDefault();
            navigateToElement('left');
        } else if (isKeyPressed('RIGHT', key)) {
            e.preventDefault();
            navigateToElement('right');
        } else if (isKeyPressed('OK', key)) {
            e.preventDefault();
            var focused = document.querySelector('.focused');
            if (focused) {
                if (focused.classList.contains('file-item')) {
                    var playBtn = focused.querySelector('.play-btn');
                    if (playBtn) playBtn.click();
                    else focused.click();
                } else {
                    focused.click();
                }
            } else {
                var allElements = getAllFocusableElements();
                if (allElements.length > 0) allElements[0].click();
            }
        } else if (isKeyPressed('BACK', key) || isKeyPressed('EXIT', key)) {
            e.preventDefault();
            if (AppState.currentScreen === 'detail') {
                var backBtn = document.getElementById('back-from-detail');
                if (backBtn) backBtn.click();
            } else if (AppState.currentScreen === 'search') {
                if (typeof window.hideSearchResults === 'function') window.hideSearchResults();
            } else if (AppState.currentScreen === 'catalog') {
                if (typeof window.backToCatalogList === 'function') window.backToCatalogList();
                else {
                    var backFromCatalog = document.getElementById('back-from-catalog');
                    if (backFromCatalog) backFromCatalog.click();
                }
            } else if (AppState.currentScreen === 'torrents') {
                var hasFocus = !!document.querySelector('.focused');
                if (!hasFocus) focusFirstTorrentCard();
                else {
                    var settingsBtn = document.getElementById('settings-btn');
                    if (settingsBtn) settingsBtn.click();
                }
            }
        } else if (isKeyPressed('INFO', key)) {
            e.preventDefault();
            console.log('ℹ️ Информация:', {
                screen: AppState.currentScreen,
                platform: AppState.platform,
                focusedElement: currentFocusedElement ? currentFocusedElement.id || currentFocusedElement.className : null
            });
        }
    });
}

function clearOkHold() {
    if (okHoldTimer) {
        clearTimeout(okHoldTimer);
        okHoldTimer = null;
    }
}

// ==================== TV FOCUS RESCUE (DOM-адаптированная) ====================

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
        currentFocusedElement = el;
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
    }

    function closeCustomFilterMenu() {
        var menu = document.getElementById('custom-filter-menu');
        if (menu) menu.classList.add('hidden');
        customFilterMenuState = null;
        return true;
    }

    function moveCustomFilterMenu(delta) {
        if (!customFilterMenuState || !customFilterMenuState.options.length) return true;
        var len = customFilterMenuState.options.length;
        customFilterMenuState.index = (customFilterMenuState.index + delta + len) % len;
        renderCustomFilterMenu();
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
            var catalogGrid = document.getElementById('torrents-grid');

            if (stateScreen === 'player') return 'player';
            if (player && getComputedStyle(player).display !== 'none') return 'player';
            if (config && getComputedStyle(config).display !== 'none') return 'config';
            if (detail && getComputedStyle(detail).display !== 'none') return 'detail';
            if (search && !search.classList.contains('hidden') && getComputedStyle(search).display !== 'none') return 'search';
            if (donateTab && !donateTab.classList.contains('hidden') && getComputedStyle(donateTab).display !== 'none') return 'donate';
            if (catalogTab && catalogTab.classList.contains('active')) return 'catalog';
            if (catalogGrid) {
                var hasCatalogCards = catalogGrid.querySelector('.catalog-card, .catalog-folder-card') !== null;
                var hasTorrentCards = catalogGrid.querySelector('.torrent-card:not(.catalog-card):not(.catalog-folder-card)') !== null;
                if (hasCatalogCards && !hasTorrentCards) return 'catalog';
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
        var ids = ['torrent-movie', 'sort-by', 'filter-quality', 'filter-content-type', 'filter-tracker', 'filter-year', 'filter-season', 'filter-voice', 'reset-filters'];
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
        var ids = ['torrserver-url', 'auth-checkbox', 'auth-login', 'auth-password', '.settings-btn', 'speedtest-btn', 'auto-fullscreen', 'hide-clock', 'add-to-db', 'multi-channel-audio'];
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
                ['search-query', 'filter-toggle', 'search-btn', 'close-search', 'torrent-movie', 'sort-by', 'filter-quality', 'filter-content-type', 'filter-tracker', 'filter-year', 'filter-season', 'filter-voice', 'reset-filters'].indexOf(el.id) !== -1;
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
                ['torrserver-url', 'auth-checkbox', 'auth-login', 'auth-password', 'speedtest-btn', 'auto-fullscreen', 'hide-clock', 'add-to-db', 'multi-channel-audio'].indexOf(el.id) !== -1 ||
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
        if (!force && focused && belongsToScreen(focused, 'catalog')) return true;
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
        if (!targetCard) targetCard = cards[0];
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

    // Функции для каталога
    var catalogState = window.catalogState || {};

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
                if (returnTo === 'catalog') ensureCatalogFocus(true);
                else ensureTorrentFocus(true);
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

        var cardIndex = cards.indexOf(focused);
        var headerIndex = header.indexOf(focused);
        var tabIndex = tabs.indexOf(focused);

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

        var cardIndex = cards.indexOf(focused);
        var headerIndex = header.indexOf(focused);
        var tabIndex = tabs.indexOf(focused);

        if (cardIndex !== -1) {
            var row = Math.floor(cardIndex / cols);
            if (direction === 'left' && cardIndex > 0 && cardIndex % cols !== 0) {
                return focusEl(cards[Math.max(0, cardIndex - 1)] || focused);
            }
            if (direction === 'right' && cardIndex < cards.length - 1 && (cardIndex + 1) % cols !== 0) {
                return focusEl(cards[Math.min(cards.length - 1, cardIndex + 1)] || focused);
            }
            if (direction === 'up') {
                if (row === 0) return focusEl(tabs[0] || header[0] || focused);
                return focusEl(cards[Math.max(0, cardIndex - cols)] || focused);
            }
            if (direction === 'down') {
                if (cardIndex + cols < cards.length) {
                    return focusEl(cards[Math.min(cards.length - 1, cardIndex + cols)] || focused);
                }
                else if (cards.length < window.catalogState.totalItems && !window.catalogState.isLoadingMore) {
                    setTimeout(function () { window.loadMoreCatalogItems && window.loadMoreCatalogItems(); }, 50);
                    return true;
                }
                return true;
            }
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

    function detailHandle(direction) {
        var items = getDetailItems();
        var focused = (belongsToScreen(document.querySelector('.focused'), 'detail') ? document.querySelector('.focused') : null);
        if (!focused) return ensureDetailFocus(true);
        var idx = items.indexOf(focused);
        if (idx === -1) return ensureDetailFocus(true);

        var trailerLinks = [];
        var actorCards = [];
        var recommendationCards = [];
        for (var j = 0; j < items.length; j++) {
            var el = items[j];
            if (el.classList.contains('catalog-trailer-play') ||
                el.classList.contains('catalog-trailer-link') ||
                el.classList.contains('catalog-trailer-card-item')) {
                trailerLinks.push(el);
            }
            if (el.classList.contains('catalog-actor-card')) actorCards.push(el);
            if (el.classList.contains('catalog-recommendation-card')) recommendationCards.push(el);
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

        var trailerIndex = trailerLinks.indexOf(focused);
        var actorIndex = actorCards.indexOf(focused);
        var recommendationIndex = recommendationCards.indexOf(focused);

        var scrollToElement = function (element) {
            if (!element) return;
            var detailView = document.getElementById('detail-view');
            if (detailView) {
                var elementRect = element.getBoundingClientRect();
                var containerRect = detailView.getBoundingClientRect();
                var scrollTop = detailView.scrollTop;
                var elementTop = elementRect.top - containerRect.top + scrollTop;
                var offset = 20;
                detailView.scrollTo({ top: Math.max(0, elementTop - offset), behavior: 'smooth' });
            } else {
                element.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        };

        var scrollToTop = function () {
            var detailView = document.getElementById('detail-view');
            if (detailView) detailView.scrollTo({ top: 0, behavior: 'smooth' });
        };

        if (isTrailer && trailerIndex !== -1) {
            if (direction === 'left') return focusEl(trailerLinks[Math.max(0, trailerIndex - 1)] || focused);
            if (direction === 'right') return focusEl(trailerLinks[Math.min(trailerLinks.length - 1, trailerIndex + 1)] || focused);
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
                }
                return true;
            }
            return true;
        }

        if (isActor && actorIndex !== -1) {
            if (direction === 'left') return focusEl(actorCards[Math.max(0, actorIndex - 1)] || focused);
            if (direction === 'right') return focusEl(actorCards[Math.min(actorCards.length - 1, actorIndex + 1)] || focused);
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
                    var targetIndex = actorIndex < recommendationCards.length ? actorIndex : recommendationCards.length - 1;
                    focusEl(recommendationCards[targetIndex]);
                    scrollToElement(recommendationCards[targetIndex]);
                    return true;
                }
                return true;
            }
            return true;
        }

        if (isRecommendation && recommendationIndex !== -1) {
            if (direction === 'left') return focusEl(recommendationCards[Math.max(0, recommendationIndex - 1)] || focused);
            if (direction === 'right') return focusEl(recommendationCards[Math.min(recommendationCards.length - 1, recommendationIndex + 1)] || focused);
            if (direction === 'up') {
                if (actorCards.length > 0) {
                    var targetIndex = recommendationIndex < actorCards.length ? recommendationIndex : actorCards.length - 1;
                    focusEl(actorCards[targetIndex]);
                    scrollToElement(actorCards[targetIndex]);
                    return true;
                } else if (trailerLinks.length > 0) {
                    var targetIndex = recommendationIndex < trailerLinks.length ? recommendationIndex : trailerLinks.length - 1;
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
            if (direction === 'down') return true;
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
                }
                return true;
            }
            if (direction === 'left') return true;
            if (direction === 'right') return true;
            if (direction === 'up') return focusEl(backBtn || focused);
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
            if (direction === 'left' || direction === 'right') return true;
            return true;
        }

        if (direction === 'up') {
            var targetEl = items[Math.max(0, idx - 1)] || focused;
            focusEl(targetEl);
            if (targetEl.id === 'catalog-watch-btn' || targetEl.id === 'back-from-detail') scrollToTop();
            else scrollToElement(targetEl);
            return true;
        }
        if (direction === 'down') {
            var targetEl = items[Math.min(items.length - 1, idx + 1)] || focused;
            focusEl(targetEl);
            if (targetEl.id === 'catalog-watch-btn' || targetEl.id === 'back-from-detail') scrollToTop();
            else scrollToElement(targetEl);
            return true;
        }
        if (direction === 'left' || direction === 'right') return true;
        return true;
    }

    function closeFiltersPanel() {
        var panel = document.getElementById('search-filters-panel');
        var toggleBtn = document.getElementById('filter-toggle');
        if (panel && !panel.classList.contains('collapsed')) {
            if (typeof toggleSearchFiltersPanel === 'function') toggleSearchFiltersPanel(false);
            else if (toggleBtn) toggleBtn.click();
        }
    }

    function openFiltersPanelAndFocus() {
        var panel = document.getElementById('search-filters-panel');
        var toggleBtn = document.getElementById('filter-toggle');
        if (panel && panel.classList.contains('collapsed')) {
            if (typeof toggleSearchFiltersPanel === 'function') toggleSearchFiltersPanel(true);
            else if (toggleBtn) toggleBtn.click();
            setTimeout(function () {
                var firstFilter = document.querySelector('#torrent-movie, #sort-by, #filter-quality, #filter-content-type, #filter-tracker, #filter-year, #filter-season, #filter-voice, #reset-filters');
                if (firstFilter) focusEl(firstFilter);
            }, 50);
        }
    }

    function getCurrentSearchMode() {
        return typeof window.getCurrentSearchMode === 'function' ? window.getCurrentSearchMode() : 'torrentsearch';
    }

    function searchHandle(direction) {
        var currentMode = getCurrentSearchMode();
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

        var topIndex = top.indexOf(focused);
        var filterIndex = filters.indexOf(focused);
        var resultIndex = results.indexOf(focused);

        if (currentMode === 'torrentsearch') {
            if (topIndex !== -1) {
                if (direction === 'left') return focusEl(top[Math.max(0, topIndex - 1)] || focused);
                if (direction === 'right') return focusEl(top[Math.min(top.length - 1, topIndex + 1)] || focused);
                if (direction === 'down') return focusEl(results[Math.min(results.length - 1, resultIndex + 1)] || focused);
                if (direction === 'up') return true;
                return true;
            }

            if (filterIndex !== -1) {
                if (direction === 'left') return focusEl(filters[Math.max(0, filterIndex - 1)] || focused);
                if (direction === 'right') return focusEl(filters[Math.min(filters.length - 1, filterIndex + 1)] || focused);
                if (direction === 'up') {
                    closeFiltersPanel();
                    return focusEl(query);
                }
                if (direction === 'down') {
                    closeFiltersPanel();
                    if (results.length > 0) return focusEl(results[0]);
                    return true;
                }
                return true;
            }

            if (resultIndex !== -1) {
                if (direction === 'up') {
                    if (resultIndex > 0) return focusEl(results[resultIndex - 1] || focused);
                    return focusEl(query);
                }
                if (direction === 'down') return focusEl(results[Math.min(results.length - 1, resultIndex + 1)] || focused);
                if (direction === 'left' || direction === 'right') {
                    openFiltersPanelAndFocus();
                    return true;
                }
                return true;
            }

            return false;
        }
        else if (currentMode === 'globalsearch') {
            if (topIndex !== -1) {
                if (direction === 'left') return focusEl(top[Math.max(0, topIndex - 1)] || focused);
                if (direction === 'right') return focusEl(top[Math.min(top.length - 1, topIndex + 1)] || focused);
                if (direction === 'down') {
                    if (results.length > 0) return focusEl(results[0]);
                    return true;
                }
                if (direction === 'up') return true;
                return true;
            }

            if (filterIndex !== -1) {
                if (direction === 'left') return focusEl(filters[Math.max(0, filterIndex - 1)] || focused);
                if (direction === 'right') return focusEl(filters[Math.min(filters.length - 1, filterIndex + 1)] || focused);
                if (direction === 'up') {
                    closeFiltersPanel();
                    return focusEl(query);
                }
                if (direction === 'down') {
                    closeFiltersPanel();
                    if (results.length > 0) return focusEl(results[0]);
                    return true;
                }
                return true;
            }

            if (resultIndex !== -1) {
                var cols = getColumns();
                var row = Math.floor(resultIndex / cols);
                if (direction === 'left') return focusEl(results[Math.max(0, resultIndex - 1)] || focused);
                if (direction === 'right') return focusEl(results[Math.min(results.length - 1, resultIndex + 1)] || focused);
                if (direction === 'up') {
                    if (row === 0) return focusEl(query);
                    return focusEl(results[Math.max(0, resultIndex - cols)] || focused);
                }
                if (direction === 'down') return focusEl(results[Math.min(results.length - 1, resultIndex + cols)] || focused);
                return true;
            }

            return false;
        }

        return false;
    }

    function configHandle(direction) {
        var items = getConfigItems();
        var focused = (belongsToScreen(document.querySelector('.focused'), 'config') ? document.querySelector('.focused') : null);
        if (!focused) return ensureConfigFocus(true);
        var idx = items.indexOf(focused);
        if (idx === -1) return ensureConfigFocus(true);
        if (direction === 'up') return focusEl(items[Math.max(0, idx - 1)] || focused);
        if (direction === 'down') return focusEl(items[Math.min(items.length - 1, idx + 1)] || focused);
        if (direction === 'left' || direction === 'right') return true;
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
            var playbackOverlay = document.getElementById('playback-overlay');
            var isPlaybackActive = playbackOverlay && playbackOverlay.classList.contains('active');
            if (isPlaybackActive) {
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
                            if (okHoldFocused) okHoldFocused.dataset.suppressClick = '1';
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
    if (window.swipeBlocked) return;
    var backEvent = new KeyboardEvent('keydown', {
        keyCode: 27,
        key: 'Escape',
        bubbles: true,
        cancelable: true
    });
    document.dispatchEvent(backEvent);
    setTimeout(function () {
        window.history.pushState({ page: 'main' }, '');
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
    console.log('Модуль управления инициализирован (DOM-версия)');
    setupKeyboardHandlers();
    setupFocusRescue();

    // Экспортируем функции в глобальный объект
    window.getAllFocusableElements = getAllFocusableElements;
    window.setFocusToElement = setFocusToElement;
    window.navigateToElement = navigateToElement;
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
