// Работа с TorrServer и торрентами

// Переменные для поиска
var searchResults = [];
var filteredResults = [];
var currentSearchQuery = '';
var currentSearchMode = 'globalsearch';
var globalSearchResults = [];
var tmdbSearchController = null;
var tmdbSearchSequence = 0;

// Настройки фильтрации и сортировки
var currentSort = 'date-desc';
var currentQualityFilter = 'all';
var currentTrackerFilter = 'all';
var currentYearFilter = '';
var currentSeasonFilter = 'all';
var currentVoiceFilter = 'all';
var currentvideotypeFilter = 'all';

var availableTrackers = [];
var lastAddedTorrentHash = null;
var lastPlaybackFromSearch = false;

// Таймеры для long press удаления
var TORRENT_DELETE_HOLD_MS = 900;
var suppressTorrentClickUntil = 0;

// ==================== LRU CACHE ====================
function LruCache(max, ttl) {
    this.max = max > 0 ? max : 100;
    this.ttl = ttl > 0 ? ttl : 0;
    this.map = new Map();
}

LruCache.prototype._isExpired = function (entry) {
    return this.ttl > 0 && entry.expires > 0 && Date.now() > entry.expires;
};

LruCache.prototype.get = function (key) {
    var entry = this.map.get(key);

    if (!entry) return undefined;

    if (this._isExpired(entry)) {
        this.map.delete(key);
        return undefined;
    }

    // LRU: поднимаем запись в конец
    this.map.delete(key);
    this.map.set(key, entry);

    return entry.value;
};

LruCache.prototype.has = function (key) {
    var entry = this.map.get(key);

    if (!entry) return false;

    if (this._isExpired(entry)) {
        this.map.delete(key);
        return false;
    }

    return true;
};

LruCache.prototype.set = function (key, value, ttl) {
    if (this.map.has(key)) {
        this.map.delete(key);
    } else if (this.map.size >= this.max) {
        var oldestKey = this.map.keys().next().value;
        if (oldestKey !== undefined) {
            this.map.delete(oldestKey);
        }
    }

    var ttlMs = ttl === undefined ? this.ttl : ttl;
    var expires = ttlMs > 0 ? Date.now() + ttlMs : 0;

    this.map.set(key, {
        value: value,
        expires: expires
    });
};

LruCache.prototype.delete = function (key) {
    return this.map.delete(key);
};

LruCache.prototype.clear = function () {
    this.map.clear();
};
// ==================== /LRU CACHE ====================

// Кэш
var torrentFilesCache = new LruCache(80, 60 * 60 * 1000);
var torrentFilesInFlight = {};
var torrentProgressCache = new LruCache(150, 60 * 1000);
var torrentProgressInFlight = {};
var torrentCardMetaCache = new LruCache(300, 0);

var knownTorrentMeta = new LruCache(200, 24 * 60 * 60 * 1000);

window.getKnownTorrentMeta = function (hash) {
    return knownTorrentMeta.get(String(hash || '').toLowerCase());
};

function buildTmdbPosterUrl(path, size) {
    if (!path) return null;
    path = String(path);

    // catalog.js подключает общий выбор зеркала. Все постеры, включая file-item,
    // используют тот же список mirrors.
    if (window.getTmdbImageUrl) return window.getTmdbImageUrl(path, size || 'w342');

    // Если это уже полный URL, заменяем домен на прокси
    if (path.indexOf('http') === 0) {
        return replaceTmdbWithProxy(path);
    }

    size = size || 'w342';
    var protocol = 'https:';
    if (window.AppState && AppState.protocol) {
        protocol = String(AppState.protocol).replace(/:+$/, '');
        if (protocol.indexOf(':') === -1) protocol += ':';
    }

    // Используем tsimg.hnar.online для новых URL
    return protocol + '//tsimg.hnar.online/t/p/' + size +
        (path.charAt(0) === '/' ? path : '/' + path);
}

function getCatalogSearchContext(searchResult) {
    var item = AppState.pendingDetailItem ||
        window.pendingCatalogItem ||
        AppState.androidBackCatalog ||
        null;

    var id = null;

    if (item) {
        id = item.id || item.tmdbId || null;
    }

    if (!id && searchResult) {
        id = searchResult.tmdbId || null;
    }

    if (!id && typeof catalogState !== 'undefined' && catalogState.lastSelectedId) {
        id = catalogState.lastSelectedId;
    }

    var mediaType = null;

    if (item && item.media_type) mediaType = item.media_type;
    if (!mediaType && AppState.pendingDetailMediaType) mediaType = AppState.pendingDetailMediaType;
    if (!mediaType && AppState.mediaType) mediaType = AppState.mediaType;

    if (!mediaType && searchResult && Array.isArray(searchResult.types)) {
        if (searchResult.types.indexOf('tv') !== -1 || searchResult.types.indexOf('serial') !== -1) {
            mediaType = 'tv';
        } else if (searchResult.types.indexOf('movie') !== -1) {
            mediaType = 'movie';
        }
    }

    if (!mediaType && searchResult && Array.isArray(searchResult.seasons) && searchResult.seasons.length > 0) {
        mediaType = 'tv';
    }

    if (!mediaType) mediaType = 'movie';

    var poster = AppState.pendingDetailPoster || window.pendingCatalogPoster || null;

    if (!poster && searchResult && searchResult.poster) {
        poster = searchResult.poster;
    }

    if (!poster && item && typeof catalogState !== 'undefined' && catalogState.posterCache) {
        poster = catalogState.posterCache.get((id || item.id || '') + '_' + (item.media_type || mediaType));
    }

    if (!poster && item && item.poster_path) {
        poster = buildTmdbPosterUrl(item.poster_path, 'w342');
    }

    if (!poster && searchResult && searchResult.poster_path) {
        poster = buildTmdbPosterUrl(searchResult.poster_path, 'w342');
    }

    return {
        id: id,
        mediaType: mediaType,
        poster: poster,
        item: item
    };
}

var SORT_OPTIONS = [
    { value: 'date-desc', label: 'Сначала новые' },
    { value: 'date-asc', label: 'Сначала старые' },
    { value: 'size-desc', label: 'Размер ↓' },
    { value: 'size-asc', label: 'Размер ↑' },
    { value: 'sid-desc', label: 'Сиды ↓' },
    { value: 'sid-asc', label: 'Сиды ↑' },
    { value: 'pir-desc', label: 'Пиры ↓' },
    { value: 'pir-asc', label: 'Пиры ↑' }
];

var QUALITY_OPTIONS = [
    { value: 'all', label: 'Все' },
    { value: '2160', label: '4K (2160p)' },
    { value: '1080', label: 'Full HD (1080p)' },
    { value: '720', label: 'HD (720p)' },
    { value: '480', label: 'SD (480p)' },
    { value: '360', label: '360p' }
];

// === УНИВЕРСАЛЬНЫЙ FETCH ДЛЯ TORRSERVER ===
async function torrServerFetch(endpoint, options = {}) {
    if (!AppState.currentTorrserverUrl) throw new Error('Сервер не подключен');
    var headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
    return fetch(AppState.currentTorrserverUrl + endpoint, {
        ...options,
        headers: { ...headers, ...(options.headers || {}) }
    });
}

function getTrackerFilterOptions() {
    var options = [{ value: 'all', label: 'Все' }];
    for (var i = 0; i < availableTrackers.length; i++) {
        var tracker = availableTrackers[i];
        options.push({ value: tracker, label: tracker.charAt(0).toUpperCase() + tracker.slice(1) });
    }
    return options;
}

function fillSelectOptions(select, options, selectedValue) {
    if (!select) return;
    var normalizedSelected = String(selectedValue !== null && selectedValue !== undefined ? selectedValue : '');
    var optionsHtml = '';
    for (var i = 0; i < options.length; i++) {
        var option = options[i];
        var selected = String(option.value) === normalizedSelected ? ' selected' : '';
        optionsHtml += `<option value="${option.value}"${selected}>${option.label}</option>`;
    }
    select.innerHTML = optionsHtml;
    select.value = normalizedSelected;
}

function syncSearchFilterButtons() {
    fillSelectOptions(getEl('sort-by'), SORT_OPTIONS, currentSort);
    fillSelectOptions(getEl('filter-quality'), QUALITY_OPTIONS, currentQualityFilter);
    fillSelectOptions(getEl('filter-tracker'), getTrackerFilterOptions(), currentTrackerFilter);

    var yearFilter = getEl('filter-year');
    if (yearFilter) yearFilter.value = (currentYearFilter && currentYearFilter !== 'all') ? currentYearFilter : 'all';

    var seasonFilter = getEl('filter-season');
    if (seasonFilter) seasonFilter.value = (currentSeasonFilter && currentSeasonFilter !== 'all') ? currentSeasonFilter : 'all';

    var voiceFilter = getEl('filter-voice');
    if (voiceFilter) voiceFilter.value = (currentVoiceFilter && currentVoiceFilter !== 'all') ? currentVoiceFilter : 'all';

    var videotypeFilter = getEl('filter-videotype');
    if (videotypeFilter) videotypeFilter.value = (currentvideotypeFilter && currentvideotypeFilter !== 'all') ? currentvideotypeFilter : 'all';
}

function toggleSearchFiltersPanel(forceOpen) {
    var panel = getEl('search-filters-panel');
    var toggleBtn = getEl('filter-toggle');
    var overlay = getEl('filter-overlay');

    if (!panel) return false;

    var shouldOpen = (forceOpen === undefined) ? !panel.classList.contains('active') : !!forceOpen;

    if (shouldOpen) {
        panel.classList.add('active');
        if (overlay) overlay.classList.add('active');
        if (toggleBtn) toggleBtn.classList.add('active');
    } else {
        panel.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
        if (toggleBtn) toggleBtn.classList.remove('active');
    }

    return shouldOpen;
}
window.toggleSearchFiltersPanel = toggleSearchFiltersPanel;

function getTorrentFiles(torrent) {
    if (!torrent) return [];
    if (torrent.file_stats && Array.isArray(torrent.file_stats) && torrent.file_stats.length > 0) return torrent.file_stats;
    if (torrent.data) {
        try {
            var data = JSON.parse(torrent.data);
            if (data.TorrServer && Array.isArray(data.TorrServer.Files)) return data.TorrServer.Files;
        } catch (e) { console.warn('Ошибка парсинга torrent.data:', e); }
    }
    return [];
}

function getVideoFilesFromTorrent(torrent) {
    var files = getTorrentFiles(torrent);
    return files.filter(f => {
        var name = (f.path || '').toLowerCase();
        return ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v'].some(ext => name.includes(ext));
    });
}

function inferSearchResultIsSeries(searchResult, torrent) {
    if (searchResult && searchResult.types && Array.isArray(searchResult.types) && searchResult.types.includes('tv')) return true;
    if (torrent && getVideoFilesFromTorrent(torrent).length > 1) return true;
    var title = ((searchResult && (searchResult.title || searchResult.name)) || (torrent && torrent.title) || '').toLowerCase();
    return (title.includes('s') && title.includes('e')) || title.includes('season') || title.includes('сезон') || title.includes('серия') || title.includes('эпизод');
}

function getPreferredPlaybackFile(torrent, searchResult = null) {
    var videoFiles = getVideoFilesFromTorrent(torrent);
    if (videoFiles.length === 0) return { fileId: 1, episodeIndex: null, isSeries: inferSearchResultIsSeries(searchResult, torrent) };
    var isSeries = inferSearchResultIsSeries(searchResult, torrent) || videoFiles.length > 1;
    return { fileId: videoFiles[0].id || 1, episodeIndex: isSeries ? 0 : null, isSeries: isSeries };
}

window.setTorrentClickSuppressed = function (ms = 1200) { suppressTorrentClickUntil = Date.now() + ms; };

// ==================== ДЕЛЕГИРОВАНИЕ LONG-PRESS УДАЛЕНИЯ ====================
var torrentHoldState = {
    timer: null,
    card: null,
    hash: null,
    pointerId: null,
    startX: 0,
    startY: 0
};

function clearTorrentHoldState() {
    if (torrentHoldState.timer) {
        clearTimeout(torrentHoldState.timer);
    }

    torrentHoldState.timer = null;
    torrentHoldState.card = null;
    torrentHoldState.hash = null;
    torrentHoldState.pointerId = null;
    torrentHoldState.startX = 0;
    torrentHoldState.startY = 0;
}

function setupTorrentLongPressDelegation(grid) {
    if (!grid || grid._longPressBound) return;

    grid._longPressBound = true;

    // Подавление клика после long-press / contextmenu
    grid.addEventListener('click', function (e) {
        var card = e.target && e.target.closest ? e.target.closest('.torrent-card') : null;
        if (!card) return;

        var shouldSuppress = card.dataset.suppressClick === '1' || Date.now() < suppressTorrentClickUntil;

        if (shouldSuppress) {
            e.preventDefault();
            e.stopImmediatePropagation();
            e.stopPropagation();
            delete card.dataset.suppressClick;
            return false;
        }
    }, true);

    // Contextmenu: правый клик / долгое нажатие на некоторых устройствах
    grid.addEventListener('contextmenu', function (e) {
        var card = e.target && e.target.closest ? e.target.closest('.torrent-card') : null;
        if (!card || !card.dataset.hash) return;

        e.preventDefault();

        clearTorrentHoldState();

        suppressTorrentClickUntil = Date.now() + 1200;
        card.dataset.suppressClick = '1';

        removeTorrentByHash(card.dataset.hash, { skipConfirm: true }).finally(function () {
            setTimeout(function () {
                if (card) delete card.dataset.suppressClick;
            }, 1200);
        });
    });

    // Pointer down: старт удержания
    grid.addEventListener('pointerdown', function (e) {
        if (!e.isPrimary) return;

        // Правая кнопка мыши обрабатывается через contextmenu
        if (e.button !== undefined && e.button !== 0) return;

        var target = e.target;
        if (!target || !target.closest) return;

        // Не запускаем long-press на интерактивных элементах
        if (target.closest('button, input, select, textarea, a')) return;

        var card = target.closest('.torrent-card');
        if (!card || !card.dataset.hash) return;

        clearTorrentHoldState();

        torrentHoldState.card = card;
        torrentHoldState.hash = card.dataset.hash;
        torrentHoldState.pointerId = e.pointerId;
        torrentHoldState.startX = e.clientX;
        torrentHoldState.startY = e.clientY;

        torrentHoldState.timer = setTimeout(function () {
            var holdCard = torrentHoldState.card;
            var holdHash = torrentHoldState.hash;

            clearTorrentHoldState();

            if (!holdHash) return;

            suppressTorrentClickUntil = Date.now() + 1200;

            if (holdCard) {
                holdCard.dataset.suppressClick = '1';
                holdCard.classList.remove('touch-active');
            }

            removeTorrentByHash(holdHash, { skipConfirm: true }).finally(function () {
                setTimeout(function () {
                    if (holdCard) delete holdCard.dataset.suppressClick;
                }, 1200);
            });
        }, TORRENT_DELETE_HOLD_MS);
    }, { passive: true });

    // Общие обработчики на document, чтобы корректно отменять удержание
    if (!window._torrentLongPressDocumentBound) {
        window._torrentLongPressDocumentBound = true;

        document.addEventListener('pointerup', function (e) {
            if (!torrentHoldState.timer) return;
            if (e.pointerId !== torrentHoldState.pointerId) return;
            clearTorrentHoldState();
        }, { passive: true });

        document.addEventListener('pointercancel', function (e) {
            if (!torrentHoldState.timer) return;
            if (e.pointerId !== torrentHoldState.pointerId) return;
            clearTorrentHoldState();
        }, { passive: true });

        document.addEventListener('pointermove', function (e) {
            if (!torrentHoldState.timer) return;
            if (e.pointerId !== torrentHoldState.pointerId) return;

            var dx = e.clientX - torrentHoldState.startX;
            var dy = e.clientY - torrentHoldState.startY;

            // Если палец/курсор сдвинулся больше чем на ~12px — отменяем long-press
            if ((dx * dx + dy * dy) > 144) {
                clearTorrentHoldState();
            }
        }, { passive: true });
    }
}
// ==================== /ДЕЛЕГИРОВАНИЕ LONG-PRESS УДАЛЕНИЯ ====================

async function removeTorrentByHash(hash, options = {}) {
    if (!hash || !AppState.currentTorrserverUrl) return false;
    var torrent = AppState.torrents.find(t => (t.hash || '').toLowerCase() === String(hash).toLowerCase());
    var title = (torrent && torrent.title) || 'эту раздачу';
    if (!options.skipConfirm && !window.confirm('Удалить ' + title + '?')) return false;

    showLoading('Удаление торрента...');
    try {
        var response = await torrServerFetch('/torrents', { method: 'POST', body: JSON.stringify({ action: 'rem', hash: hash }) });
        if (!response.ok) throw new Error('Ошибка удаления: HTTP ' + response.status);
        try { await response.json(); } catch (e) { }

        clearTorrentFilesCache(hash);
        if (AppState.currentDetailItem && (AppState.currentDetailItem.hash || '').toLowerCase() === String(hash).toLowerCase()) {
            // Раздачи больше нет — закрываем карточку тем же плавным затуханием,
            // что и по кнопке «назад»
            if (typeof Animations !== 'undefined' && typeof Animations.animateDetailHide === 'function') {
                Animations.animateDetailHide();
            } else {
                getEl('detail-view').style.display = 'none';
            }
            AppState.currentDetailItem = null;
            AppState.currentScreen = 'torrents';
            var mainContainer = getEl('main-container');
            if (mainContainer) mainContainer.style.pointerEvents = 'auto';
            getEl('torrserver-section').style.display = 'block';
        }
        await refreshTorrentsList();
        return true;
    } catch (error) {
        console.error('Ошибка удаления торрента:', error);
        alert('Ошибка удаления: ' + error.message);
        return false;
    } finally { hideLoading(); }
}
window.removeTorrentByHash = removeTorrentByHash;

function attachTorrentDeleteLongPress(card, torrent) {
    // Deprecated: long-press удаление теперь делегировано на torrents-grid.
    // Функция оставлена только для совместимости, если где-то ещё вызывается.
}

async function loadClientConfig() {
    try {
        var savedClientId = localStorage.getItem('clientId');
        var url = SERVER_URL + '/api/client/config' + (savedClientId ? '?clientId=' + encodeURIComponent(savedClientId) : '');
        var response = await fetch(url);
        if (response.ok) {
            var data = await response.json();
            AppState.clientId = data.clientId;
            if (localStorage.getItem('clientId') !== data.clientId) localStorage.setItem('clientId', data.clientId);
            if (data.config) {
                var urlInput = getEl('torrserver-url');
                var authCheckbox = getEl('auth-checkbox');
                var authLogin = getEl('auth-login');
                var authPassword = getEl('auth-password');
                if (data.config.url) urlInput.value = data.config.url;
                if (data.config.authEnabled) {
                    authCheckbox.checked = true;
                    AppState.authEnabled = true;
                    getEl('auth-fields').classList.add('visible');
                    if (data.config.login) authLogin.value = data.config.login;
                    if (data.config.hasPassword) authPassword.value = data.config.password;
                }
            }
            return data;
        }
    } catch (error) { console.error('Ошибка загрузки конфигурации:', error); }
    return null;
}

async function saveClientConfig() {
    var config = {
        url: getEl('torrserver-url').value.trim(),
        authEnabled: getEl('auth-checkbox').checked,
        login: getEl('auth-login').value.trim(),
        clientId: localStorage.getItem('clientId')
    };
    var password = getEl('auth-password').value.trim();
    if (password) config.password = password;
    try {
        var response = await fetch(SERVER_URL + '/api/client/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
        if (response.ok) return true;
    } catch (error) { console.error('Ошибка сохранения конфигурации:', error); }
    return false;
}

async function addProgressToDetail(torrent, preloadedFiles) {
    if (!torrent || !torrent.hash) return null;
    var btn = getEl('detail-progress-btn');
    if (!btn) return null;
    btn.classList.remove('hidden');
    btn.style.removeProperty('display');
    var extra = getEl('catalog-detail-extra');
    if (extra) {
        extra.classList.remove('hidden');
        extra.style.removeProperty('display');
    }
    var oldProgressBlocks = document.querySelectorAll('#detail-progress');
    for (var i = 0; i < oldProgressBlocks.length; i++) oldProgressBlocks[i].remove();
    if (!btn.dataset.bound) {
        btn.dataset.bound = '1';
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var hash = btn.dataset.hash || '';
            var fileId = parseInt(btn.dataset.fileId || '1', 10) || 1;
            var timecode = parseInt(btn.dataset.timecode || '0', 10) || 0;
            var episodeIndex = parseInt(btn.dataset.episodeIndex || '0', 10) || 0;
            if (!hash || !AppState.currentTorrserverUrl) return;
            var playUrl = AppState.currentTorrserverUrl + '/play/' + hash + '/' + fileId;
            getEl('playback-overlay').classList.add('active');
            var detailView = getEl('detail-view');
            if (detailView) detailView.style.pointerEvents = 'none';
            startHLSPlayback(playUrl, timecode, false, episodeIndex).finally(function () {
                getEl('playback-overlay').classList.remove('active');
                if (detailView) detailView.style.pointerEvents = 'auto';
            });
        });
    }
    btn.dataset.hash = torrent.hash;
    btn.dataset.fileId = '1';
    btn.dataset.timecode = '0';
    btn.dataset.episodeIndex = '0';
    btn.classList.remove('has-progress');
    btn.innerHTML = '<span class="btn-label">▶ Играть</span>';

    // === Передаём файлы, чтобы loadProgressForTorrent не запрашивал повторно ===
    var progress = await loadProgressForTorrent(torrent, preloadedFiles);
    if (!progress || !(progress.timecode > 0)) return null;
    var fileId = parseInt(progress.fileId, 10) || 1;
    var timecode = progress.timecode;
    var episodeIndex = progress.episodeIndex || 0;
    var percent = progress.duration > 0 ? (timecode / progress.duration) * 100 : 0;
    var remaining = 100 - percent;
    var isNextFile = false;
    if (remaining <= 5) {
        var videoFiles = getVideoFilesFromTorrent(torrent);
        var nextFile = videoFiles.length ? videoFiles[episodeIndex + 1] : null;
        if (nextFile) {
            fileId = nextFile.id || (fileId + 1);
            timecode = 0;
            episodeIndex = episodeIndex + 1;
            isNextFile = true;
        } else if (progress.isSeries && episodeIndex + 1 < (progress.totalEpisodes || 0)) {
            fileId = fileId + 1;
            timecode = 0;
            episodeIndex = episodeIndex + 1;
            isNextFile = true;
        } else {
            timecode = 0;
        }
    }
    btn.dataset.fileId = String(fileId);
    btn.dataset.timecode = String(timecode);
    btn.dataset.episodeIndex = String(episodeIndex);
    btn.classList.add('has-progress');
    var timeStr = formatTime(progress.timecode);
    var totalStr = progress.duration ? formatTime(progress.duration) : '??:??';
    var hint = '';
    if (isNextFile) {
        hint = 'Серия ' + (episodeIndex + 1);
    } else {
        hint = timeStr + ' / ' + totalStr;
        if (progress.isSeries) hint = 'Серия ' + (episodeIndex + 1) + ' · ' + hint;
    }
    btn.innerHTML =
        '<span class="btn-label">▶ Продолжить</span>' +
        '<span class="btn-hint">' + hint + '</span>';
    return fileId;
}

async function checkServer(shouldLoadTorrents = true) {
    var urlInput = getEl('torrserver-url');
    var statusIndicator = getEl('status-indicator');
    var statusText = getEl('status-text');
    var authCheckbox = getEl('auth-checkbox');
    var authLogin = getEl('auth-login');
    var authPassword = getEl('auth-password');
    var url = urlInput.value.trim();
    if (!url) { statusIndicator.className = 'status-indicator status-offline'; statusText.textContent = 'Введите адрес сервера'; return false; }
    statusIndicator.className = 'status-indicator status-checking'; statusText.textContent = 'Проверка...';
    try {
        var testUrl = url.endsWith('/') ? url.slice(0, -1) : url;
        var headers = getAuthHeaders();
        if (authCheckbox && authCheckbox.checked) {
            var login = authLogin ? authLogin.value.trim() : '';
            var password = authPassword ? authPassword.value : '';
            if (login && password) headers['Authorization'] = 'Basic ' + btoa(login + ':' + password);
        }
        var response = await fetch(testUrl + '/echo', { method: 'GET', headers: headers });
        if (response.ok) {
            var text = await response.text();
            if (text.includes('MatriX.')) {
                statusIndicator.className = 'status-indicator status-online'; statusText.textContent = 'Сервер доступен ✓';
                AppState.currentTorrserverUrl = testUrl; AppState.serverOnline = true;
                if (authCheckbox && authCheckbox.checked) { AppState.authEnabled = true; AppState.authLogin = authLogin ? authLogin.value.trim() : ''; AppState.authPassword = authPassword ? authPassword.value : ''; }
                else AppState.authEnabled = false;
                await saveClientConfig();
                if (shouldLoadTorrents) await loadTorrents(true);
                return true;
            }
        }
        throw new Error('Сервер не отвечает');
    } catch (error) {
        console.error('Ошибка проверки сервера:', error);
        statusIndicator.className = 'status-indicator status-offline'; statusText.textContent = 'Сервер недоступен ✗'; AppState.serverOnline = false; return false;
    }
}

async function loadTorrents(silent = false) {
    if (AppState.torrentsLoading) {
        return false;
    }

    AppState.torrentsLoading = true;

    var torrentsGrid = getEl('torrents-grid');

    try {
        if (!AppState.serverOnline) {
            var checked = await checkServer(false);

            if (!checked) {
                if (!silent) {
                    alert('Сначала подключитесь к серверу');
                    getEl('config-screen').style.display = 'flex';
                    getEl('torrserver-section').style.display = 'none';
                    AppState.currentScreen = 'config';
                }

                return false;
            }
        }

        if (!silent) {
            showLoading('Загрузка торрентов...');

            if (torrentsGrid) {
                torrentsGrid.innerHTML =
                    '<div style="grid-column: 1 / -1; text-align: center; padding: 40px;">Загрузка...</div>';
            }
        }

        var response = await torrServerFetch('/torrents', {
            method: 'POST',
            body: JSON.stringify({ action: 'list' })
        });

        if (!response.ok) {
            throw new Error('Ошибка загрузки: HTTP ' + response.status);
        }

        var data = await response.json();

        AppState.torrents = Array.isArray(data) ? data : [];

        // Список был успешно загружен
        AppState.torrentsLoaded = true;

        getEl('config-screen').style.display = 'none';
        getEl('torrserver-section').style.display = 'block';

        // Главная (home.js) открывается раньше, чем приходит ответ TorrServer.
        // Список торрентов прогреваем в скрытом #content-torrents, но экран и
        // фокус у главной не отбираем — иначе витрина мигала бы на торренты.
        var homeActive = !!(window.HomeScreen && window.HomeScreen.isActive());

        if (!homeActive) {
            AppState.currentScreen = 'torrents';
            AppState.inSearch = 'torrents';
        }

        renderTorrents();

        // ВАЖНО:
        // Не пытаемся фокусировать карточку торрента, если список пустой
        if (
            !homeActive &&
            AppState.currentScreen === 'torrents' &&
            AppState.torrents.length > 0 &&
            !document.querySelector('.torrent-card.focused')
        ) {
            setTimeout(function () {
                if (typeof window.focusFirstTorrentCard === 'function') {
                    window.focusFirstTorrentCard();
                }
            }, 80);
        }

        return true;
    } catch (error) {
        console.error('Ошибка загрузки торрентов:', error);

        // Чтобы focus-логика не долбила запросы при ошибке,
        // считаем попытку загрузки завершённой
        AppState.torrentsLoaded = true;

        if (!silent && torrentsGrid) {
            torrentsGrid.innerHTML =
                '<div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">' +
                '<div style="font-size: 16px; color: #ff6a6a;">Ошибка: ' + error.message + '</div>' +
                '<button class="btn" style="margin-top: 20px;" onclick="loadTorrents()">Попробовать снова</button>' +
                '</div>';
        }

        return false;
    } finally {
        AppState.torrentsLoading = false;

        if (!silent) {
            hideLoading();
        }
    }
}

var lastTorrentsRefreshAt = 0;

async function refreshTorrents(showLoadingFlag = true) {
    var now = Date.now();

    // Защита от спама одинаковыми refreshTorrents()
    if (now - lastTorrentsRefreshAt < 700) {
        return false;
    }

    lastTorrentsRefreshAt = now;

    if (typeof torrentProgressCache !== 'undefined') torrentProgressCache.clear();

    return await loadTorrents(!showLoadingFlag);
}

window.refreshTorrents = refreshTorrents;

// ==================== ВСПОМОГАТЕЛЬНАЯ: экранирование для атрибутов ====================
function escapeAttr(value) {
    if (!value) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// ==================== RENDER TORRENTS (оптимизированная версия) ====================
function renderTorrents() {
    var torrentsGrid = getEl('torrents-grid');
    if (!torrentsGrid) return;

    // 1. Полная очистка перед рендером
    torrentsGrid.innerHTML = '';
    // Прогресс просмотра приходит одним батчем и лежит в torrentProgressCache.
    // Раньше здесь чистился progressCache — кэш старого, поштучного пути, куда
    // после его удаления вообще никто не писал, а настоящий оставался
    // нетронутым: карточка после выхода из плеера показывала таймкод
    // минутной давности.
    torrentProgressCache.clear();

    // 2. Пустой список
    if (AppState.torrents.length === 0) {
        torrentsGrid.innerHTML =
            '<div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">' +
            '<div style="font-size: 18px; color: #aaa; margin-bottom: 10px;">Нет торрентов</div>' +
            '<div style="font-size: 14px; color: #666;">Используйте поиск выше, чтобы найти и добавить торренты</div>' +
            '</div>';
        return;
    }

    // 3. Защита от гонки: запоминаем, какой экран рендерим
    var currentScreenSnapshot = AppState.currentScreen;

    // 4. Чанкирование: 8 карточек за один кадр (60 FPS)
    var CHUNK_SIZE = 8;
    var index = 0;

    function renderChunk() {
        // Если пользователь ушёл с экрана торрентов — прерываем рендер
        if (AppState.currentScreen !== currentScreenSnapshot) return;

        var fragment = document.createDocumentFragment();
        var end = Math.min(index + CHUNK_SIZE, AppState.torrents.length);

        for (; index < end; index++) {
            var torrent = AppState.torrents[index];
            var card = createTorrentCard(torrent);
            if (card) fragment.appendChild(card);
        }

        torrentsGrid.appendChild(fragment);

        if (index < AppState.torrents.length) {
            // Отдаём управление браузеру для отрисовки кадра
            requestAnimationFrame(renderChunk);
        } else {
            // Все карточки отрендерены — восстанавливаем фокус
            if (AppState.currentScreen === 'torrents' &&
                !document.querySelector('.torrent-card.focused')) {
                setTimeout(function () {
                    if (typeof window.focusFirstTorrentCard === 'function') {
                        window.focusFirstTorrentCard();
                    }
                }, 80);
            }
        }
    }

    requestAnimationFrame(renderChunk);
}

// ==================== МЕТА ТОРРЕНТА ИЗ torrent.data ====================
// Разбор torrent.data кэшируем по хешу: JSON.parse на каждую карточку заметен на ТВ.
// Кэш сбрасывается сам, когда сервер прислал новый data (source !== torrent.data).
// Бросает исключение на битом JSON — вызывающий оборачивает в try/catch.
function getTorrentCardMeta(torrent) {
    var cacheKey = String(torrent.hash || '');
    var cachedMeta = cacheKey ? torrentCardMetaCache.get(cacheKey) : null;

    if (!cachedMeta || cachedMeta.source !== torrent.data) {
        var data = JSON.parse(torrent.data);
        cachedMeta = {
            source: torrent.data,
            isTv: !!(data.TorrServer && data.TorrServer.Files && data.TorrServer.Files.length > 1),
            poster: data.movie ? (data.movie.img || (data.movie.poster_path ? 'https://image.tmdb.org/t/p/w342' + data.movie.poster_path : '')) : ''
        };
        if (cacheKey) torrentCardMetaCache.set(cacheKey, cachedMeta);
    }

    return cachedMeta;
}

/**
 * Тип торрента: 'tv' или 'movie'. Это ровно то, что карточка показывает в бейдже
 * («Сериал» / «Фильм»).
 *
 * Одна и та же функция используется и для бейджа, и для выбора movie/tv в запросах
 * к TMDB (loadAllTmdbDataForTorrent). Раньше detail определял тип заново и мог
 * разойтись с карточкой: на карточке «Сериал», а данные грузились как о фильме —
 * например когда у торрента category = movie, а файлов в раздаче несколько.
 *
 * Признаки, по порядку:
 *   1. больше одного файла в раздаче (file_stats, иначе TorrServer.Files) — сериал;
 *   2. category самого торрента (tv / сериал / serial / series).
 */
function getTorrentMediaTypeFromCard(torrent) {
    if (!torrent) return 'movie';

    var isTv = false;

    try {
        if (torrent.file_stats && Array.isArray(torrent.file_stats) && torrent.file_stats.length > 0) {
            isTv = torrent.file_stats.length > 1;
        } else if (torrent.data) {
            isTv = getTorrentCardMeta(torrent).isTv;
        }
    } catch (e) { }

    if (isTv) return 'tv';

    var category = String(torrent.category || '').toLowerCase();
    if (category.indexOf('tv') !== -1 ||
        category.indexOf('сериал') !== -1 ||
        category.indexOf('serial') !== -1 ||
        category.indexOf('series') !== -1) {
        return 'tv';
    }

    return 'movie';
}

window.getTorrentMediaTypeFromCard = getTorrentMediaTypeFromCard;

// ==================== СОЗДАНИЕ ОДНОЙ КАРТОЧКИ ====================
function createTorrentCard(torrent) {
    var poster = '';
    var title = torrent.title || 'Без названия';

    // Постер из torrent.data — только когда file_stats нет (как было раньше),
    // иначе берём уже готовый torrent.poster
    try {
        var hasFileStats = torrent.file_stats && Array.isArray(torrent.file_stats) && torrent.file_stats.length > 0;
        if (!hasFileStats && torrent.data) poster = getTorrentCardMeta(torrent).poster;
    } catch (e) { }

    if (!poster && torrent.poster) poster = torrent.poster;

    // Тип — общей функцией с detail, чтобы бейдж и запросы TMDB не расходились
    var cardMediaType = getTorrentMediaTypeFromCard(torrent);

    // Статус: просмотр или размер
    var playStatus;
    if (torrent.stat_string === 'Torrent working') {
        playStatus = '<span style="color: #4caf50; font-weight: bold;">▶ Идет просмотр</span>';
    } else {
        playStatus = escapeHtml(formatBytes(torrent.torrent_size));
    }

    // Безопасный постер: экранируем URL для атрибута src
    var posterHtml;
    if (poster) {
        var safePoster = escapeAttr(poster);
        posterHtml = '<img src="' + safePoster + '" loading="lazy" decoding="async" ' +
            'onerror="this.parentElement.innerHTML=\'<div class=no-poster>Нет постера</div>\'">';
    } else {
        posterHtml = '<div class="no-poster">Нет постера</div>';
    }

    // Создаём карточку через createElement (безопаснее innerHTML для структуры)
    var card = document.createElement('div');
    card.className = 'torrent-card';
    card.dataset.hash = torrent.hash;
    // Тот же тип, что в бейдже — чтобы его было видно в DOM и можно было брать снаружи
    card.dataset.mediaType = cardMediaType;

    // Long-press удаление
    //attachTorrentDeleteLongPress(card, torrent);

    card.innerHTML =
        '<div class="torrent-poster">' + posterHtml + '</div>' +
        '<div class="torrent-info">' +
        '<div class="torrent-title">' + escapeHtml(title.length > 60 ? title.substring(0, 60) + '...' : title) + '</div>' +
        '<div class="torrent-meta">' +
        '<span>' + playStatus + '</span>' +
        '<span class="torrent-badge">' + (cardMediaType === 'tv' ? 'Сериал' : 'Фильм') + '</span>' +
        '</div>' +
        '</div>';

    return card;
}

// ==================== ДЕЛЕГИРОВАНИЕ СОБЫТИЙ (один раз при инициализации) ====================
function setupTorrentGridDelegation() {
    var torrentsGrid = getEl('torrents-grid');
    if (!torrentsGrid || torrentsGrid._delegationBound) return;

    torrentsGrid._delegationBound = true;

    // Новое делегирование long-press удаления
    setupTorrentLongPressDelegation(torrentsGrid);

    torrentsGrid.addEventListener('click', function (e) {
        var card = e.target.closest('.torrent-card');
        if (card && card.dataset.hash) {
            var torrent = AppState.torrents.find(function (t) {
                return t.hash === card.dataset.hash;
            });
            if (torrent) showDetail(torrent);
        }
    });
}

window.setupTorrentGridDelegation = setupTorrentGridDelegation;

function showDetailByHash(hash) {
    if (!hash) return false;
    var hashLower = hash.toLowerCase();
    var torrent = AppState.torrents.find(t => t.hash && t.hash.toLowerCase() === hashLower);
    if (torrent) { showDetail(torrent); return true; }
    return false;
}

function hideCatalogDetailExtra() {
    var ids = [
        'catalog-detail-extra', 'detail-subtitle', 'catalog-detail-backdrop',
        'catalog-detail-meta', 'catalog-detail-overview',
        'catalog-detail-trailers-wrap', 'catalog-detail-trailers',
        'catalog-detail-screenshots-wrap', 'catalog-detail-screenshots'
    ];

    ids.forEach(function (id) {
        var el = getEl(id);
        if (el) {
            if (id === 'catalog-detail-backdrop') {
                el.style.backgroundImage = '';
            } else if (id === 'catalog-detail-meta' || id === 'catalog-detail-trailers' || id === 'catalog-detail-screenshots') {
                el.innerHTML = '';
            } else if (id === 'detail-subtitle' || id === 'catalog-detail-overview') {
                el.textContent = '';
                el.style.display = 'none';
            }
            // Гарантированно скрываем
            el.classList.add('hidden');
        }
    });
}
window.hideCatalogDetailExtra = hideCatalogDetailExtra;

async function getTmdbDetailsWithCache(tmdbId, mediaType) {
    if (!tmdbId) return null;
    if (!mediaType) mediaType = 'movie';
    if (window.getFromTmdbCache && window.saveToTmdbCache) {
        var cacheParams = { id: tmdbId, type: mediaType };
        var cachedData = window.getFromTmdbCache('details', cacheParams);
        if (cachedData) return cachedData;
        try {
            var response = await fetch('/api/tmdb/details?id=' + tmdbId + '&type=' + mediaType);
            if (response.ok) { var data = await response.json(); window.saveToTmdbCache('details', cacheParams, data); return data; }
        } catch (error) { console.error('Ошибка загрузки TMDB данных:', error); }
    } else {
        if (!window.tmdbDetailsCache) window.tmdbDetailsCache = new LruCache(200, 24 * 60 * 60 * 1000);
        var cacheKey = tmdbId + '_' + mediaType;
        if (window.tmdbDetailsCache.has(cacheKey)) {
            var cached = window.tmdbDetailsCache.get(cacheKey);
            if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) return cached.data;
        }
        try {
            var response = await fetch('/api/tmdb/details?id=' + tmdbId + '&type=' + mediaType);
            if (response.ok) { var data = await response.json(); window.tmdbDetailsCache.set(cacheKey, { data: data, timestamp: Date.now() }); return data; }
        } catch (error) { console.error('Ошибка загрузки TMDB данных:', error); }
    }
    return null;
}

function resetDetailBackground() {
    var detailView = getEl('detail-view');
    if (!detailView) return;
    detailView.style.backgroundImage = ''; detailView.style.backgroundColor = '#000000';
    var existingOverlay = getEl('detail-backdrop-overlay'); if (existingOverlay) existingOverlay.remove();
    var detailSubtitle = getEl('detail-subtitle'); if (detailSubtitle) { detailSubtitle.textContent = ''; detailSubtitle.style.display = 'none'; }
    var metaContainer = getEl('catalog-detail-meta'); if (metaContainer) { metaContainer.innerHTML = ''; metaContainer.classList.add('hidden'); }
    var filesList = getEl('files-list'); if (filesList) { filesList.innerHTML = ''; filesList.style.display = ''; filesList.style.flexDirection = ''; }
    var detailPoster = getEl('detail-poster'); if (detailPoster) detailPoster.innerHTML = '';
    var detailTitleText = getEl('detail-title-text'); if (detailTitleText) detailTitleText.textContent = '';
    var oldProgressBlocks = document.querySelectorAll('#detail-progress');
    for (var i = 0; i < oldProgressBlocks.length; i++) {
        oldProgressBlocks[i].remove();
    }
    // Netflix-блоки торрентного режима: чистим содержимое и снимаем режим,
    // чтобы каталожный detail получил свою раскладку без остатков торрентной
    clearDetailNetflixBlocks();
    detailView.classList.remove('torrent-detail-mode');
}
window.resetDetailBackground = resetDetailBackground;

function extractSeasonsFromTitle(title) {
    if (!title) return [];

    var seasons = [];

    var rangePatterns = [
        /\[сезон\s*(\d+)\s*[-–]\s*(\d+)\]/i,
        /\[season\s*(\d+)\s*[-–]\s*(\d+)\]/i,
        /сезон\s*(\d+)\s*[-–]\s*(\d+)/i,
        /season\s*(\d+)\s*[-–]\s*(\d+)/i,
        /\bS(\d+)\s*[-–]\s*S?(\d+)\b/i
    ];

    for (var p = 0; p < rangePatterns.length; p++) {
        var m = title.match(rangePatterns[p]);
        if (m && m[1] && m[2]) {
            for (var s = parseInt(m[1], 10); s <= parseInt(m[2], 10); s++) {
                if (seasons.indexOf(s) === -1) seasons.push(s);
            }
            return seasons.sort(function (a, b) { return a - b; });
        }
    }

    var listPatterns = [
        /\[сезон\s*([\d,\s]+)\]/i,
        /\[season\s*([\d,\s]+)\]/i,
        /сезон\s*([\d,\s]+)/i,
        /season\s*([\d,\s]+)/i,
        /\bS([\d,\s]+)/i
    ];

    for (var p2 = 0; p2 < listPatterns.length; p2++) {
        var m2 = title.match(listPatterns[p2]);
        if (m2 && m2[1]) {
            m2[1].split(/[,\s]+/).forEach(function (part) {
                var n = parseInt(part, 10);
                if (!isNaN(n) && seasons.indexOf(n) === -1) seasons.push(n);
            });
            if (seasons.length > 0) break;
        }
    }

    if (seasons.length === 0) {
        var singlePatterns = [
            /\[сезон\s*(\d+)\]/i,
            /\[season\s*(\d+)\]/i,
            /сезон\s*(\d+)/i,
            /season\s*(\d+)/i,
            /\bS(\d+)\b/i
        ];

        for (var p3 = 0; p3 < singlePatterns.length; p3++) {
            var m3 = title.match(singlePatterns[p3]);
            if (m3 && m3[1]) {
                var n2 = parseInt(m3[1], 10);
                if (!isNaN(n2)) seasons.push(n2);
                break;
            }
        }
    }

    return seasons.sort(function (a, b) { return a - b; });
}

function cleanTitleFromSeasons(title, seasons) {
    if (!title) return title;

    return title
        .replace(/\[сезон[^\]]*\]/gi, '')
        .replace(/\[season[^\]]*\]/gi, '')
        .replace(/сезон\s*[\d\s,–-]+/gi, '')
        .replace(/season\s*[\d\s,–-]+/gi, '')
        .replace(/\bS\d+\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

var seasonCache = new LruCache(200, 24 * 60 * 60 * 1000);
async function loadSeasonStills(tmdbId, seasonNumber) {
    var cacheKey = tmdbId + 'season' + seasonNumber;
    if (seasonCache.has(cacheKey)) { var cached = seasonCache.get(cacheKey); if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) return cached.data; }
    try {
        var response = await fetch('/api/tmdb/season?id=' + tmdbId + '&seasonNumber=' + seasonNumber);
        if (response.ok) { var seasonData = await response.json(); var episodes = seasonData.episodes || []; seasonCache.set(cacheKey, { data: episodes, timestamp: Date.now() }); return episodes; }
    } catch (error) { console.error('Ошибка загрузки кадров сезона:', error); }
    return [];
}

async function loadMovieStill(tmdbId) {
    var cacheKey = tmdbId + '_movie_still';
    if (seasonCache.has(cacheKey)) { var cached = seasonCache.get(cacheKey); if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) return cached.data; }
    try {
        var response = await fetch('/api/tmdb/details?id=' + tmdbId + '&type=movie');
        if (response.ok) {
            var data = await response.json();
            if (data.poster_path) { var stillUrl = buildTmdbPosterUrl(data.poster_path, 'w300'); seasonCache.set(cacheKey, { data: stillUrl, timestamp: Date.now() }); return stillUrl; }
        }
    } catch (error) { console.error('Ошибка загрузки постера фильма:', error); }
    return null;
}

function clearTorrentFilesCache(hash) { if (hash && torrentFilesCache.has(hash)) torrentFilesCache.delete(hash); }
function clearAllTorrentFilesCache() { torrentFilesCache.clear(); }

// Share one TorrServer stat request between the detail view and TMDB enrichment.
async function getTorrentFilesWithCache(torrent, forceRefresh = false) {
    var hash = torrent && torrent.hash;
    if (!hash) return [];

    if (!forceRefresh && torrentFilesCache.has(hash)) {
        var cached = torrentFilesCache.get(hash);
        if (cached && Date.now() - cached.timestamp < 60 * 60 * 1000) return cached.files;
        torrentFilesCache.delete(hash);
    }
    if (!forceRefresh && torrentFilesInFlight[hash]) return torrentFilesInFlight[hash];

    var request = (async function () {
        var files = [];
        if (torrent.file_stats && Array.isArray(torrent.file_stats) && torrent.file_stats.length) {
            files = torrent.file_stats;
        }
        if (!files.length && AppState.currentTorrserverUrl) {
            try {
                var response = await torrServerFetch('/stream?link=' + hash + '&index=1&stat=stat', {
                    method: 'GET', headers: { accept: 'application/octet-stream' }
                });
                if (response.ok) {
                    var apiData = await response.json();
                    if (Array.isArray(apiData.file_stats)) files = apiData.file_stats;
                    else if (apiData.data) {
                        try {
                            var parsedData = JSON.parse(apiData.data);
                            if (parsedData.TorrServer && Array.isArray(parsedData.TorrServer.Files)) {
                                files = parsedData.TorrServer.Files;
                            }
                        } catch (e) { }
                    }
                }
            } catch (error) {
                console.error('Torrent files request failed:', error);
            }
        }
        torrent.file_stats = files;
        torrentFilesCache.set(hash, { files: files, timestamp: Date.now() });
        return files;
    })();

    torrentFilesInFlight[hash] = request;
    try {
        return await request;
    } finally {
        delete torrentFilesInFlight[hash];
    }
}

// ==================== ТОРРЕНТНЫЙ DETAIL: META-СТРОКА, АКТЁРЫ, ЗАГОЛОВОК РЯДА ====================
// index.html этих блоков не содержит: строим их на ходу, как это делает
// setupDetailLayout в catalog.js. Ряд актёров переиспользует каталожные
// контейнеры (#catalog-detail-actors-wrap / #catalog-detail-actors) — под них
// уже написаны и стили, и навигация пультом.

var detailMetaState = { details: null, isTvSeries: false, filesCount: 0, filesBytes: 0, torrentTitle: '' };

function isTorrentDetailMode() {
    var dv = getEl('detail-view');
    return !!(dv && dv.classList.contains('torrent-detail-mode'));
}

function pluralRu(n, one, few, many) {
    var abs = Math.abs(n) % 100;
    var last = abs % 10;
    if (abs > 10 && abs < 20) return many;
    if (last === 1) return one;
    if (last > 1 && last < 5) return few;
    return many;
}

function formatRuntimeMinutes(minutes) {
    var m = parseInt(minutes, 10);
    if (!m || m <= 0) return '';
    var h = Math.floor(m / 60);
    var rest = m % 60;
    if (h > 0) return rest > 0 ? h + ' ч ' + rest + ' мин' : h + ' ч';
    return rest + ' мин';
}

// Качество раздачи в названии торрента — то, чего в TMDB нет, а зрителю важно.
function extractQualityBadges(title) {
    var t = String(title || '');
    var badges = [];
    if (/2160p|\b4k\b|\buhd\b/i.test(t)) badges.push('4K');
    else if (/1080[pi]/i.test(t)) badges.push('1080p');
    else if (/720p/i.test(t)) badges.push('720p');
    if (/\bhdr10?\+?\b|dolby\s*vision|\bdovi\b/i.test(t)) badges.push('HDR');
    if (/atmos/i.test(t)) badges.push('ATMOS');
    else if (/\b(5\.1|7\.1)\b/.test(t)) badges.push('5.1');
    return badges;
}

function ensureDetailMetaRow() {
    var row = getEl('detail-meta-row');
    if (row) return row;
    var titleBlock = document.querySelector('#detail-view .detail-title');
    if (!titleBlock) return null;
    row = document.createElement('div');
    row.id = 'detail-meta-row';
    row.className = 'detail-meta-row hidden';
    var subtitle = getEl('detail-subtitle');
    // Порядок как в Netflix: заголовок → метаданные → описание
    if (subtitle && subtitle.parentElement === titleBlock) titleBlock.insertBefore(row, subtitle);
    else titleBlock.appendChild(row);
    return row;
}

function ensureFilesListTitle() {
    var title = getEl('files-list-title');
    if (title) return title;
    var filesList = getEl('files-list');
    if (!filesList || !filesList.parentElement) return null;
    title = document.createElement('div');
    title.id = 'files-list-title';
    title.className = 'catalog-detail-section-title hidden';
    title.textContent = 'Серии';
    filesList.parentElement.insertBefore(title, filesList);
    return title;
}

// Тот же id и та же точка вставки, что в setupDetailLayout (catalog.js): какой бы
// режим ни открылся первым, второй найдёт готовый контейнер и не создаст дубль.
function ensureDetailActorsWrap() {
    var wrap = getEl('catalog-detail-actors-wrap');
    if (wrap) return wrap;
    var panel = document.querySelector('#detail-view .catalog-detail-panel');
    if (!panel || !panel.parentElement) return null;
    wrap = document.createElement('div');
    wrap.id = 'catalog-detail-actors-wrap';
    wrap.className = 'catalog-detail-actors-wrap hidden';
    wrap.innerHTML = '<div class="catalog-detail-section-title">В главных ролях</div>' +
        '<div id="catalog-detail-actors" class="catalog-detail-actors-grid"></div>';
    panel.parentElement.insertBefore(wrap, panel.nextSibling);
    return wrap;
}

function clearDetailNetflixBlocks() {
    var row = getEl('detail-meta-row');
    if (row) { row.innerHTML = ''; row.classList.add('hidden'); }
    var actors = getEl('catalog-detail-actors');
    if (actors) actors.innerHTML = '';
    var wrap = getEl('catalog-detail-actors-wrap');
    if (wrap) wrap.classList.add('hidden');
    var filesTitle = getEl('files-list-title');
    if (filesTitle) filesTitle.classList.add('hidden');
}

// Строка вида «2019 · 8.4 · 3 сезона · 48 мин · Драма · 24 серии · 96 ГБ · [4K]».
// Данные приходят из двух источников (TMDB и список файлов) в непредсказуемом
// порядке, поэтому обе стороны только пишут в detailMetaState и перерисовывают.
function renderDetailMetaRow() {
    if (!isTorrentDetailMode()) return;
    var row = ensureDetailMetaRow();
    if (!row) return;

    var d = detailMetaState.details;
    var parts = [];

    if (d) {
        var date = d.release_date || d.first_air_date || '';
        if (date) parts.push(escapeHtml(String(date).substring(0, 4)));

        if (d.vote_average > 0) {
            parts.push('<span class="detail-meta-rating">' + (Math.round(d.vote_average * 10) / 10) + '</span>');
        }

        var seasons = parseInt(d.number_of_seasons, 10);
        if (seasons > 0) parts.push(seasons + ' ' + pluralRu(seasons, 'сезон', 'сезона', 'сезонов'));
        else parts.push(detailMetaState.isTvSeries ? 'Сериал' : 'Фильм');

        var runtime = formatRuntimeMinutes(d.runtime ||
            (Array.isArray(d.episode_run_time) ? d.episode_run_time[0] : 0));
        if (runtime) parts.push(runtime);

        if (d.genres && d.genres.length) {
            var names = [];
            for (var g = 0; g < d.genres.length && names.length < 2; g++) {
                if (d.genres[g] && d.genres[g].name) names.push(d.genres[g].name);
            }
            if (names.length) parts.push(escapeHtml(names.join(', ')));
        }
    }

    var count = detailMetaState.filesCount;
    if (count > 1) {
        parts.push(count + ' ' + (detailMetaState.isTvSeries
            ? pluralRu(count, 'серия', 'серии', 'серий')
            : pluralRu(count, 'файл', 'файла', 'файлов')));
    }
    if (detailMetaState.filesBytes > 0 && typeof formatBytes === 'function') {
        parts.push(escapeHtml(formatBytes(detailMetaState.filesBytes)));
    }

    var badges = extractQualityBadges(detailMetaState.torrentTitle);

    if (!parts.length && !badges.length) {
        row.innerHTML = '';
        row.classList.add('hidden');
        return;
    }

    var html = '';
    for (var p = 0; p < parts.length; p++) html += '<span class="detail-meta-item">' + parts[p] + '</span>';
    for (var b = 0; b < badges.length; b++) html += '<span class="detail-meta-badge">' + escapeHtml(badges[b]) + '</span>';
    row.innerHTML = html;
    row.classList.remove('hidden');
}

// Актёры берутся из того же ответа /api/tmdb/details, который detail уже ждёт
// ради описания и бэкдропа (поле cast), — дополнительных запросов нет.
function renderDetailActorsFromDetails(details) {
    if (!isTorrentDetailMode()) return;
    var wrap = ensureDetailActorsWrap();
    if (!wrap) return;
    var grid = getEl('catalog-detail-actors');
    if (!grid) return;

    var cast = details && details.cast;
    if (!cast || !cast.length) {
        grid.innerHTML = '';
        wrap.classList.add('hidden');
        return;
    }

    var max = 12;
    try {
        if (typeof CATALOG_CONSTANTS !== 'undefined' && CATALOG_CONSTANTS.MAX_ACTORS) max = CATALOG_CONSTANTS.MAX_ACTORS;
    } catch (e) { }

    var html = '';
    var shown = 0;
    for (var i = 0; i < cast.length && shown < max; i++) {
        var a = cast[i];
        if (!a || !a.name) continue;

        var photo = a.profile_path || a.profilePath || '';
        var src = '';
        if (photo) {
            if (typeof getTmdbImageUrl === 'function') src = getTmdbImageUrl(photo, 'w185');
            else if (typeof buildTmdbPosterUrl === 'function') src = buildTmdbPosterUrl(photo, 'w185');
        }

        html += '<div class="catalog-actor-card">' +
            '<div class="catalog-actor-photo">' +
            (src
                ? '<img src="' + src + '" loading="lazy" decoding="async" alt="' + escapeHtml(a.name) +
                '" onerror="this.parentElement.innerHTML=\'<div class=&quot;catalog-actor-no-photo&quot;>👤</div>\'">'
                : '<div class="catalog-actor-no-photo">👤</div>') +
            '</div>' +
            '<div class="catalog-actor-info">' +
            '<div class="catalog-actor-name">' + escapeHtml(a.name) + '</div>' +
            '<div class="catalog-actor-character">' + escapeHtml(a.character || '') + '</div>' +
            '</div>' +
            '</div>';
        shown++;
    }

    if (!shown) {
        grid.innerHTML = '';
        wrap.classList.add('hidden');
        return;
    }

    grid.innerHTML = html;
    wrap.classList.remove('hidden');
    // Карточки актёров попадают в фокусируемые только после появления в DOM.
    // Сброс кэша обязателен: у detail он живёт 100 мс по времени и по поколению
    // DOM, поэтому без invalidateFocusCache() новый ряд мог не попасть в список.
    if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
    if (typeof updateFocusableElements === 'function') updateFocusableElements();
}
// ==================== /ТОРРЕНТНЫЙ DETAIL ====================

function visibleItemsforDetail(change) {
    var detailView = getEl('detail-view');

    if (change === 'showDetail') {
        // Ряд актёров остаётся скрытым до прихода cast: пустая секция с
        // заголовком на пол-экрана выглядит хуже, чем её отсутствие.
        var massHidden = ['catalog-detail-actors-wrap', 'catalog-detail-backdrop', 'catalog-detail-recommendations-wrap', 'catalog-detail-overview',
            'catalog-detail-meta', 'catalog-watch-btn', 'catalog-toggle-overview-btn', 'catalog-trailer-btn', 'detail-poster', 'files-list-title'
        ];
        massHidden.forEach(function (id) {
            var el = getEl(id);
            if (el) el.classList.add('hidden');
        });

        var massVisible = ['catalog-detail-extra', 'detail-progress-btn'];
        massVisible.forEach(function (id) {
            var el = getEl(id);
            if (el) {
                el.classList.remove('hidden');
                el.style.removeProperty('display');
            }
        });

        if (detailView) {
            detailView.classList.add('torrent-detail-mode');
            detailView.classList.remove('catalog-detail-mode');
        }
    } else if (change === 'showCatalogDetail') {
        var massVisible2 = ['catalog-detail-actors-wrap', 'catalog-detail-backdrop', 'catalog-detail-recommendations-wrap', 'catalog-detail-overview',
            'catalog-detail-meta', 'catalog-watch-btn', 'catalog-toggle-overview-btn', 'catalog-trailer-btn', 'catalog-detail-extra'
        ];
        massVisible2.forEach(function (id) {
            var el = getEl(id);
            if (el) {
                el.classList.remove('hidden');
                el.style.removeProperty('display');
            }
        });
        var massHidden2 = ['detail-progress-btn', 'detail-meta-row', 'files-list-title'];
        massHidden2.forEach(function (id) {
            var el = getEl(id);
            if (el) el.classList.add('hidden');
        });

        if (detailView) {
            detailView.classList.remove('torrent-detail-mode');
            detailView.classList.add('catalog-detail-mode');
        }
    }
}

window.visibleItemsforDetail = visibleItemsforDetail;

// ==================== ЦВЕТ РАМКИ ФОКУСА ИЗ UI CUSTOMIZER ====================
// Новый torrent-detail рисует рамки своего размера (5px вокруг плитки файла,
// круг вокруг аватара актёра), поэтому его правила в styles.css специфичнее тех,
// которыми UI Customizer перекрывает общий фокус (`.focused{…!important}`) —
// снаружи он их не достаёт. Цвет эти правила берут переменной
// var(--focus-color, #ff8c00), а переменную выставляет сам кастомайзер. Но если
// на устройстве раздаётся его старая сборка (index.html тянет ui-customizer.js с
// msx/js, тогда как styles.css и torrents.js — уже с public/js), строки с :root
// там нет: var() уходит в дефолт, и рамка остаётся оранжевой при любом выбранном
// цвете. Поэтому выставляем переменные и здесь — цвет берём из публичного API
// кастомайзера, а если и его нет, читаем прямо из его хранилища.
var UI_CUSTOMIZER_STORAGE_KEY = 'uiCustomizer';

function readUiFocusColor() {
    try {
        if (window.UICustomizer && typeof UICustomizer.getFocusColor === 'function') {
            var fromApi = UICustomizer.getFocusColor();
            if (fromApi) return fromApi;
        }
    } catch (e) { }
    try {
        var raw = localStorage.getItem(UI_CUSTOMIZER_STORAGE_KEY);
        if (raw) {
            var saved = JSON.parse(raw);
            if (saved && saved.focusColor) return saved.focusColor;
        }
    } catch (e) { }
    return null;
}

// #rgb / #rrggbb → rgba(): для мягкого внешнего свечения (--focus-color-soft)
function focusColorToRgba(color, alpha) {
    var s = String(color || '').trim();
    if (s.charAt(0) !== '#') return null;
    s = s.slice(1);
    if (s.length === 3) {
        s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
    }
    if (!/^[0-9a-f]{6}$/i.test(s)) return null;
    var n = parseInt(s, 16);
    return 'rgba(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ', ' + alpha + ')';
}

function applyFocusColorVars() {
    var color = readUiFocusColor();
    if (!color || !focusColorToRgba(color, 1)) return;
    var root = document.documentElement;
    if (!root || !root.style || !root.style.setProperty) return;
    // Инлайн на <html> перебивает :root из <style> кастомайзера, но значение то же
    // самое (берём из его же настроек), а хук ниже держит их синхронными.
    root.style.setProperty('--focus-color', color);
    var soft = focusColorToRgba(color, 0.35);
    if (soft) root.style.setProperty('--focus-color-soft', soft);
}
window.applyFocusColorVars = applyFocusColorVars;

// Один раз оборачиваем apply() кастомайзера, чтобы цвет применялся сразу при
// выборе в панели, а не только при следующем открытии detail.
function hookUiCustomizerFocusColor() {
    if (!window.UICustomizer || typeof UICustomizer.apply !== 'function') return false;
    if (!UICustomizer.__focusVarsHooked) {
        var origApply = UICustomizer.apply;
        UICustomizer.apply = function () {
            var result = origApply.apply(this, arguments);
            applyFocusColorVars();
            return result;
        };
        UICustomizer.__focusVarsHooked = true;
    }
    applyFocusColorVars();
    return true;
}

// Сразу — цвет из хранилища: ui-customizer.js подключается последним из всех
// скриптов, поэтому на момент загрузки torrents.js window.UICustomizer ещё нет.
// Дальше дожидаемся его, чтобы повесить хук на apply().
applyFocusColorVars();
(function waitForUiCustomizer(triesLeft) {
    if (hookUiCustomizerFocusColor() || triesLeft <= 0) return;
    setTimeout(function () { waitForUiCustomizer(triesLeft - 1); }, 300);
})(20);

async function showDetail(torrent) {
    if (torrent && torrent.hash) window.lastSelectedTorrentHash = torrent.hash;
    if (typeof currentFocusIndex !== 'undefined') window.lastSelectedTorrentIndex = currentFocusIndex;
    // Рамки фокуса нового detail читают var(--focus-color) — убеждаемся, что
    // переменная выставлена до первой отрисовки (см. applyFocusColorVars выше)
    applyFocusColorVars();
    resetDetailBackground();
    var known = knownTorrentMeta.get(String(torrent.hash || '').toLowerCase());

    if (known) {
        if (!torrent.poster && known.poster) torrent.poster = known.poster;
        if (!torrent.tmdbId && known.id) torrent.tmdbId = known.id;
        if (!torrent.media_type && known.mediaType) torrent.media_type = known.mediaType;
    }

    if (torrent.poster && torrent.poster.indexOf('http') !== 0) {
        torrent.poster = buildTmdbPosterUrl(torrent.poster, 'w342');
    }
    var mainContainer = getEl('main-container');
    if (mainContainer) mainContainer.style.pointerEvents = 'none';
    // Позицию списка сохраняем сами: 'detail' — не контентный экран, showContentScreen
    // здесь не вызывается и обновить contentScroll.torrents не может. Без этого на
    // возврате (app.js: showContentScreen('torrents')) подставится устаревшее
    // значение или ноль, и карточка с фокусом уедет за экран.
    // Как в setupDetailLayout (catalog.js) — ноль тоже валидная позиция.
    if (mainContainer && AppState.currentScreen === 'torrents') {
        AppState.contentScroll = AppState.contentScroll || {};
        AppState.contentScroll.torrents = mainContainer.scrollTop;
    }
    AppState.currentScreen = 'detail';
    if (!window.AndroidJS || !AppState.transcodingFullOnOff) {
        AppState.detailReturnTo = 'torrents';
        AppState.currentDetailItem = torrent;
    } else {
        if (AppState.playFromHash) {
            AppState.currentDetailItem = AppState.androidBackCatalog;
            AppState.detailReturnTo = 'catalog';
        } else {
            AppState.detailReturnTo = 'torrents';
            AppState.currentDetailItem = torrent;
        }
    }
    hideCatalogDetailExtra();
    visibleItemsforDetail('showDetail');

    // Netflix-раскладка: строка метаданных, ряд актёров и заголовок ряда файлов
    detailMetaState = {
        details: null,
        isTvSeries: false,
        filesCount: 0,
        filesBytes: 0,
        torrentTitle: torrent.title || ''
    };
    ensureDetailMetaRow();
    ensureDetailActorsWrap();
    ensureFilesListTitle();
    clearDetailNetflixBlocks();

    var posterImg = getEl('detail-poster');
    var titleEl = getEl('detail-title-text');
    var filesList = getEl('files-list');
    setupFilePlayButtonDelegation();
    var detailSubtitle = getEl('detail-subtitle');
    var detailViewDiv = getEl('detail-view');
    var dh = document.querySelector('.detail-header');
    if (dh) dh.style.background = 'rgba(0, 0, 0, 0.3)';
    if (filesList) { filesList.style.display = 'flex'; filesList.style.flexDirection = 'row'; }
    filesList.innerHTML = '<div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; gap: 15px;"><div class="spinner"></div><div style="font-size: 16px; color: #aaa;">Загрузка файлов...</div></div>';
    if (typeof Animations !== 'undefined') Animations.animateDetailShow();
    titleEl.textContent = (torrent.title || 'Без названия')
        .replace(/\[\d+\]/g, '')
        .replace(/\[сезон[^\]]*\]/gi, '')
        .trim();
    var oldProgressBlocks = document.querySelectorAll('#detail-progress');
    for (var i = 0; i < oldProgressBlocks.length; i++) oldProgressBlocks[i].remove();

    // === ПАРАЛЛЕЛЬНЫЙ ЗАПУСК: файлы + TMDB ===
    var filesPromise = getTorrentFilesWithCache(torrent, false);
    var tmdbPromise = loadAllTmdbDataForTorrent(torrent, { titleEl: titleEl, detailViewDiv: detailViewDiv, detailSubtitle: detailSubtitle });

    // Актёры и метаданные не зависят от списка файлов — рисуем отдельной ветвью,
    // иначе при пустом/ошибочном списке файлов ряд актёров вообще не появится.
    tmdbPromise.then(function (tmdbData) {
        if (!tmdbData) return;
        detailMetaState.isTvSeries = !!tmdbData.isTvSeries;
        renderDetailMetaRow();
        renderDetailActorsFromDetails(tmdbData.details);
    }).catch(function () { });

    try {
        var files = await filesPromise;
        var poster = torrent.poster || '';
        if (!poster && torrent.data) {
            try {
                var data = JSON.parse(torrent.data);
                if (data.movie) poster = data.movie.img || (data.movie.poster_path ? 'https://image.tmdb.org/t/p/w342' + data.movie.poster_path : '');
            } catch (e) { }
        }
        posterImg.innerHTML = poster ? '<img src="' + poster + '" alt="poster">' : '<div class="no-poster">Нет постера</div>';

        if (files.length === 0) {
            filesList.innerHTML = '<div style="text-align: center; padding: 20px; color: #aaa;">📁 Нет файлов</div>';
        } else {
            // === РЕНДЕР ФАЙЛОВ СРАЗУ (не ждём прогресс) ===
            var videoFiles = files.filter(f => {
                var n = f.path.split('/').pop().toLowerCase();
                return ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v'].some(ext => n.includes(ext));
            });
            filesList.innerHTML = '';
            var fragment = document.createDocumentFragment();
            var addedItems = [];
            for (var i = 0; i < videoFiles.length; i++) {
                var item = addFileItem(videoFiles[i], torrent.hash, videoFiles.length === 1 ? torrent.title : 'Серия ' + (i + 1), videoFiles.length === 1 ? null : i, null, true);
                if (item) {
                    fragment.appendChild(item);
                    addedItems.push(item);
                }
            }
            filesList.appendChild(fragment);

            // Количество и общий вес — в строку метаданных под заголовком
            var totalBytes = 0;
            for (var fb = 0; fb < videoFiles.length; fb++) totalBytes += (videoFiles[fb].length || 0);
            detailMetaState.filesCount = videoFiles.length;
            detailMetaState.filesBytes = totalBytes;
            renderDetailMetaRow();

            // Заголовок ряда нужен только когда файлов несколько: над единственной
            // плиткой с полным названием он лишний
            var filesTitle = ensureFilesListTitle();
            if (filesTitle) {
                if (videoFiles.length > 1) {
                    filesTitle.textContent = 'Серии';
                    filesTitle.classList.remove('hidden');
                } else {
                    filesTitle.classList.add('hidden');
                }
            }

            // Один батч-запрос на все файлы вместо N отдельных
            if (addedItems.length > 0) {
                loadProgressForFileItems(addedItems, torrent.hash);
            }

            // === ПРОГРЕСС АСИНХРОННО (передаём файлы, чтобы не запрашивать повторно) ===
            addProgressToDetail(torrent, files).then(function (lastField) {
                if (lastField > 0 && typeof updateFocusableElements === 'function') {
                    updateFocusableElements();
                }
            });

            // === TMDB-данные применяем когда готовы ===
            tmdbPromise.then(function (tmdbData) {
                if (tmdbData.cleanTitle && tmdbData.cleanTitle !== 'Без названия') titleEl.textContent = tmdbData.cleanTitle;
                if (tmdbData.seasonNumbers && tmdbData.seasonNumbers.length > 1) {
                    var seasonsText = titleEl.textContent;
                    if (!seasonsText.includes('сезон')) titleEl.textContent = seasonsText + ' [сезон ' + tmdbData.seasonNumbers.join(', ') + ']';
                }
                loadStillsAndUpdateFiles(tmdbData.seasonNumbers || [], tmdbData.allSeasonEpisodes || {}, tmdbData.movieStill, videoFiles.length);
            }).catch(function (error) { console.error('Ошибка загрузки TMDB данных:', error); });
        }
    } catch (e) {
        console.error('Ошибка:', e);
        filesList.innerHTML = '<div style="text-align: center; padding: 20px; color: #ff6a6a;">❌ Ошибка загрузки файлов: ' + e.message + '</div>';
    }
    setTimeout(function () {
        if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
            if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
            updateFocusableElements();
            // Фокус ставим на «Играть/Продолжить», а не на первую плитку. Строка
            // метаданных и ряд актёров приходят из TMDB позже и сдвигают ряд файлов
            // вниз — вместе со сфокусированной плиткой, и она уезжала за экран.
            // Кнопка стоит в шапке, выше всего, что подгружается, и не двигается.
            var placed = false;
            var progressBtn = getEl('detail-progress-btn');
            if (progressBtn && progressBtn.offsetParent !== null) {
                for (var i = 0; i < focusableElements.length; i++) {
                    if (focusableElements[i] === progressBtn) { setFocus(i); placed = true; break; }
                }
            }
            if (!placed && document.querySelectorAll('.file-item').length > 0) {
                for (var j = 0; j < focusableElements.length; j++) {
                    if (focusableElements[j].classList && focusableElements[j].classList.contains('file-item')) { setFocus(j); placed = true; break; }
                }
            }
            if (!placed) setFocus(0);
        }
        // Всё отрисовано и фокус на месте — снимаем индикатор «Загрузка…»
        if (typeof Animations !== 'undefined' && typeof Animations.detailContentReady === 'function') {
            Animations.detailContentReady();
        }
    }, 200);
    AppState.mediaType = '';
}

async function loadAllTmdbDataForTorrent(torrent, elements) {
    elements = elements || {};

    var protocolBase = 'https:';
    try {
        protocolBase = String((window.AppState && AppState.protocol) || 'https:').replace(/:+$/, '');
        if (protocolBase.indexOf(':') === -1) protocolBase += ':';
    } catch (e) { }

    function normalizePosterUrl(path, size) {
        if (!path) return null;
        path = String(path);

        if (path.indexOf('http') === 0) return path;

        size = size || 'w342';

        return protocolBase + '//tsimg.hnar.online/t/p/' + size +
            (path.charAt(0) === '/' ? path : '/' + path);
    }

    function extractSeasonsFromTitleLocal(title) {
        var seasons = [];

        if (!title) return seasons;

        function addSeason(num) {
            var n = parseInt(num, 10);
            if (!isNaN(n) && n > 0 && n < 1000 && seasons.indexOf(n) === -1) {
                seasons.push(n);
            }
        }

        var rangePatterns = [
            /\[сезон\s*(\d+)\s*[-–]\s*(\d+)\]/i,
            /\[season\s*(\d+)\s*[-–]\s*(\d+)\]/i,
            /сезон\s*(\d+)\s*[-–]\s*(\d+)/i,
            /season\s*(\d+)\s*[-–]\s*(\d+)/i,
            /\bS(\d+)\s*[-–]\s*S?(\d+)\b/i
        ];

        for (var r = 0; r < rangePatterns.length; r++) {
            var rm = title.match(rangePatterns[r]);
            if (rm && rm[1] && rm[2]) {
                var from = parseInt(rm[1], 10);
                var to = parseInt(rm[2], 10);

                if (!isNaN(from) && !isNaN(to)) {
                    if (from > to) {
                        var tmp = from;
                        from = to;
                        to = tmp;
                    }

                    for (var s = from; s <= to; s++) {
                        addSeason(s);
                    }

                    return seasons.sort(function (a, b) { return a - b; });
                }
            }
        }

        var listPatterns = [
            /\[сезон\s*([\d,\s]+)\]/i,
            /\[season\s*([\d,\s]+)\]/i,
            /сезон\s*([\d,\s]+)/i,
            /season\s*([\d,\s]+)/i,
            /\bS([\d,\s]+)/i
        ];

        for (var l = 0; l < listPatterns.length; l++) {
            var lm = title.match(listPatterns[l]);
            if (lm && lm[1]) {
                var parts = String(lm[1]).split(/[,\s]+/);
                for (var p = 0; p < parts.length; p++) {
                    addSeason(parts[p]);
                }

                if (seasons.length > 0) break;
            }
        }

        if (seasons.length === 0) {
            var singlePatterns = [
                /\[сезон\s*(\d+)\]/i,
                /\[season\s*(\d+)\]/i,
                /сезон\s*(\d+)/i,
                /season\s*(\d+)/i,
                /\bS(\d+)\b/i
            ];

            for (var sng = 0; sng < singlePatterns.length; sng++) {
                var sm = title.match(singlePatterns[sng]);
                if (sm && sm[1]) {
                    addSeason(sm[1]);
                    break;
                }
            }
        }

        return seasons.sort(function (a, b) { return a - b; });
    }

    function cleanTitleFromSeasonsLocal(title) {
        if (!title) return title;

        return String(title)
            .replace(/\[сезон[^\]]*\]/gi, '')
            .replace(/\[season[^\]]*\]/gi, '')
            .replace(/сезон\s*[\d\s,–-]+/gi, '')
            .replace(/season\s*[\d\s,–-]+/gi, '')
            .replace(/\bS\d+\b/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function extractSeasonsFromFilesLocal() {
        var seasons = [];

        var files = [];
        try {
            if (typeof getTorrentFiles === 'function') {
                files = getTorrentFiles(torrent) || [];
            }
        } catch (e) { }

        if (!files.length) return seasons;

        function addSeason(num) {
            var n = parseInt(num, 10);
            if (!isNaN(n) && n > 0 && n < 1000 && seasons.indexOf(n) === -1) {
                seasons.push(n);
            }
        }

        var patterns = [
            /S(\d{1,2})/i,
            /(\d{1,2})x\d{2}/i,
            /Season\s*(\d{1,2})/i,
            /сезон\s*(\d{1,2})/i
        ];

        for (var i = 0; i < files.length; i++) {
            var path = String(files[i].path || '');

            for (var p = 0; p < patterns.length; p++) {
                var m = path.match(patterns[p]);
                if (m && m[1]) {
                    addSeason(m[1]);
                    break;
                }
            }
        }

        return seasons.sort(function (a, b) { return a - b; });
    }

    var initialTitle = (torrent && torrent.title) ? String(torrent.title) : 'Без названия';

    var result = {
        tmdbId: null,
        cleanTitle: initialTitle,
        seasonNumbers: [],
        isTvSeries: false,
        mediaType: 'movie',
        videoFilesCount: 0,
        allSeasonEpisodes: {},
        movieStill: null,
        details: null
    };

    if (!torrent) return result;

    var hashLower = torrent.hash ? String(torrent.hash).toLowerCase() : '';
    var known = null;

    try {
        if (hashLower) {
            if (typeof knownTorrentMeta !== 'undefined' && knownTorrentMeta && knownTorrentMeta.get) {
                known = knownTorrentMeta.get(hashLower) || null;
            }

            if (!known && typeof window.getKnownTorrentMeta === 'function') {
                known = window.getKnownTorrentMeta(hashLower) || null;
            }

            if (!known &&
                typeof lastAddedTorrentHash !== 'undefined' &&
                lastAddedTorrentHash &&
                hashLower === String(lastAddedTorrentHash).toLowerCase()) {

                var pendingItem =
                    (window.AppState && AppState.pendingDetailItem) ||
                    window.pendingCatalogItem ||
                    null;

                known = {
                    id: (window.AppState && AppState.pendingDetailTmdbId) ||
                        (pendingItem && (pendingItem.id || pendingItem.tmdbId)) ||
                        null,
                    mediaType: (window.AppState && AppState.pendingDetailMediaType) ||
                        (pendingItem && pendingItem.media_type) ||
                        null,
                    poster: (window.AppState && AppState.pendingDetailPoster) ||
                        window.pendingCatalogPoster ||
                        null
                };
            }
        }
    } catch (e) { }

    if (known) {
        if (!torrent.tmdbId && known.id) torrent.tmdbId = known.id;
        if (!torrent.media_type && known.mediaType) torrent.media_type = known.mediaType;
        if (!torrent.poster && known.poster) torrent.poster = normalizePosterUrl(known.poster, 'w342');
    }

    if (torrent.poster) {
        torrent.poster = normalizePosterUrl(torrent.poster, 'w342');
    }

    var cleanTitle = initialTitle;

    var tmdbId = torrent.tmdbId || torrent.knownTmdbId || null;

    if (!tmdbId) {
        var bracketMatch = cleanTitle.match(/\[(\d+)\]/);
        if (bracketMatch && bracketMatch[1]) {
            tmdbId = bracketMatch[1];
        }
    }

    cleanTitle = cleanTitle
        .replace(/\[\d+\]/g, '')
        .replace(/\[(tv|movie|сериал|фильм)\]/gi, '')
        .replace(/\[сезон[^\]]*\]/gi, '')
        .trim();

    var seasonNumbers = extractSeasonsFromTitleLocal(cleanTitle);

    if (seasonNumbers.length > 0) {
        cleanTitle = cleanTitleFromSeasonsLocal(cleanTitle);
    }

    if (seasonNumbers.length === 0) {
        seasonNumbers = extractSeasonsFromFilesLocal();
    }

    // Тип с карточки торрента (её бейдж «Сериал»/«Фильм»). Считается по самому
    // торренту — число файлов в раздаче плюс его category, — поэтому это самый
    // надёжный локальный признак, и «Сериал» здесь главнее всего остального.
    var cardMediaType = getTorrentMediaTypeFromCard(torrent);

    var forcedTv = false;

    if (cardMediaType === 'tv') forcedTv = true;
    if (torrent.media_type === 'tv') forcedTv = true;
    if (known && known.mediaType === 'tv') forcedTv = true;
    // AppState.mediaType здесь не читаем: это тип предыдущего экрана, а не этого
    // торрента (см. комментарий у knownMediaType ниже).

    // Если мы точно знаем, что это сериал, но сезон не смогли определить,
    // берём сезон 1 как fallback, иначе кадры сезонов не загрузятся.
    if (seasonNumbers.length === 0 && forcedTv) {
        seasonNumbers = [1];
    }

    result.tmdbId = tmdbId;
    result.cleanTitle = cleanTitle;
    result.seasonNumbers = seasonNumbers;

    if (elements.titleEl) {
        elements.titleEl.textContent = cleanTitle;
    }

    // Бейдж «Сериал» перебивает всё: раньше сюда попадал movie из torrent.category
    // (у сериала category бывает movie) и из уже записанного torrent.media_type
    // (мог быть испорчен предыдущим неверным определением — строка с details.media_type
    // ниже). Из-за этого о сериале грузились данные как о фильме (запрос к /movie).
    var knownMediaType = (cardMediaType === 'tv') ? 'tv' : (
        torrent.media_type ||
        torrent.knownMediaType ||
        (known && known.mediaType) ||
        null
    );

    // «Сезон/серия/эпизод/S01» в названии — признак сериала. Считаем один раз:
    // раньше эта проверка была только в самой последней ветке ниже.
    var titleLooksLikeSeries = /(^|[^a-z0-9а-яё])(сезон|season|серия|эпизод|s\d+)([^a-z0-9а-яё]|$)/i
        .test(String(torrent.title || '').toLowerCase());

    // «Фильм» с карточки — сигнал о конкретном торренте. Принимаем его только когда
    // других признаков сериала нет: бейдж считается по числу файлов, а сериал бывает
    // и одним файлом (один сезон / одна серия) — тогда важнее сезон из названия или
    // из имён файлов.
    if (!knownMediaType && cardMediaType === 'movie' &&
        seasonNumbers.length === 0 && !titleLooksLikeSeries) {
        knownMediaType = 'movie';
    }

    // Глобальный AppState.mediaType сюда больше не подмешивается. Это тип текущего
    // экрана (каталог выставляет его по категории), а не этого торрента, и он
    // оставался от предыдущего открытия: после сериала фильм запрашивался как
    // /api/tmdb/details?type=tv, а после фильма сериал — как ?type=movie.
    // Тип из каталога доходит сюда по-другому — через torrent.media_type и
    // knownTorrentMeta по hash (их заполняют playFromHash и addTorrentToServer),
    // а также через category раздачи, которую читает getTorrentMediaTypeFromCard.

    if (!knownMediaType && torrent.category) {
        var categoryLower = String(torrent.category).toLowerCase();

        if (categoryLower.indexOf('tv') !== -1 || categoryLower.indexOf('сериал') !== -1) {
            knownMediaType = 'tv';
        } else if (categoryLower.indexOf('movie') !== -1 || categoryLower.indexOf('фильм') !== -1) {
            knownMediaType = 'movie';
        }
    }

    var isTvSeries = false;

    if (knownMediaType === 'tv') {
        isTvSeries = true;
    } else if (knownMediaType === 'movie') {
        isTvSeries = false;
    } else if (seasonNumbers.length > 0) {
        isTvSeries = true;
    } else {
        try {
            if (torrent.file_stats && Array.isArray(torrent.file_stats) && torrent.file_stats.length > 1) {
                isTvSeries = true;
            } else if (torrent.data) {
                var parsedData = JSON.parse(torrent.data);
                if (
                    parsedData &&
                    parsedData.TorrServer &&
                    parsedData.TorrServer.Files &&
                    parsedData.TorrServer.Files.length > 1
                ) {
                    isTvSeries = true;
                }
            }
        } catch (e) { }

        if (!isTvSeries) {
            isTvSeries = titleLooksLikeSeries;
        }
    }

    var mediaType = isTvSeries ? 'tv' : 'movie';

    // Решение записываем обратно в торрент. Раньше сюда попадал только
    // details.media_type (ниже, если поля ещё не было), и одно неверное определение
    // прилипало к объекту на всю сессию: при следующем заходе в detail запрос опять
    // уходил не туда. Теперь тип всегда согласован с бейджем карточки.
    torrent.media_type = mediaType;

    var videoFilesCount = 0;
    try {
        if (typeof getVideoFilesFromTorrent === 'function') {
            videoFilesCount = getVideoFilesFromTorrent(torrent).length;
        }
    } catch (e) { }

    var details = null;

    if (tmdbId && typeof getTmdbDetailsWithCache === 'function') {
        try {
            details = await getTmdbDetailsWithCache(tmdbId, mediaType);
        } catch (e) {
            console.warn('Ошибка загрузки TMDB details:', e);
        }
    }

    if (details) {
        if (details.backdrop_path && elements.detailViewDiv) {
            var backdropUrl = normalizePosterUrl(details.backdrop_path, 'original');

            elements.detailViewDiv.style.backgroundImage =
                'linear-gradient(to top, rgba(0, 0, 0, 0.97) 0%, rgba(0, 0, 0, 0.82) 32%, rgba(0, 0, 0, 0.38) 64%, rgba(0, 0, 0, 0.25) 100%), ' +
                'linear-gradient(to right, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0.5) 45%, rgba(0, 0, 0, 0.1) 100%), ' +
                'url("' + backdropUrl + '")';
            elements.detailViewDiv.style.backgroundSize = 'cover';
            elements.detailViewDiv.style.backgroundPosition = 'center';
            elements.detailViewDiv.style.backgroundRepeat = 'no-repeat';
        }

        if (details.overview) {
            if (elements.detailSubtitle) {
                elements.detailSubtitle.textContent = details.overview;
                elements.detailSubtitle.style.display = 'block';
                elements.detailSubtitle.classList.remove('hidden');
            }

            if (typeof getEl === 'function') {
                var overviewEl = getEl('catalog-detail-overview');
                if (overviewEl) {
                    overviewEl.textContent = details.overview;
                    overviewEl.style.display = 'none';
                    overviewEl.classList.add('hidden');
                }
            }
        }

        if (typeof updateDetailMetaInfo === 'function') {
            try {
                updateDetailMetaInfo(details);
            } catch (e) { }
        }

        if (!torrent.poster && details.poster_path) {
            torrent.poster = normalizePosterUrl(details.poster_path, 'w342');
        }

        var posterEl = elements.posterImg || (typeof getEl === 'function' ? getEl('detail-poster') : null);

        if (posterEl && torrent.poster && !posterEl.querySelector('img')) {
            posterEl.innerHTML = '<img src="' + torrent.poster + '" alt="poster">';
        }

        if (details.media_type && !torrent.media_type) {
            torrent.media_type = details.media_type;
        }
    }

    var allSeasonEpisodes = {};

    if (tmdbId && isTvSeries && seasonNumbers.length > 0 && typeof loadSeasonStills === 'function') {
        var seasonPromises = seasonNumbers.map(function (seasonNumber) {
            return loadSeasonStills(tmdbId, seasonNumber)
                .then(function (episodes) {
                    return {
                        season: seasonNumber,
                        episodes: episodes || []
                    };
                })
                .catch(function () {
                    return {
                        season: seasonNumber,
                        episodes: []
                    };
                });
        });

        try {
            var seasonResults = await Promise.all(seasonPromises);

            for (var i = 0; i < seasonResults.length; i++) {
                var seasonResult = seasonResults[i];

                if (seasonResult && seasonResult.episodes && seasonResult.episodes.length > 0) {
                    allSeasonEpisodes[seasonResult.season] = seasonResult.episodes;
                }
            }
        } catch (e) {
            console.warn('Ошибка загрузки кадров сезонов:', e);
        }
    }

    var movieStill = null;

    if (tmdbId && !isTvSeries && seasonNumbers.length === 0 && typeof loadMovieStill === 'function') {
        try {
            movieStill = await loadMovieStill(tmdbId);
        } catch (e) {
            console.warn('Ошибка загрузки постера/кадра фильма:', e);
        }
    }

    if (window.AppState) {
        AppState.isSerials = isTvSeries;

        if (isTvSeries && seasonNumbers.length === 1) {
            AppState.currentTMDB = tmdbId;
            AppState.currentSeason = seasonNumbers[0];
        }
    }

    if (
        hashLower &&
        tmdbId &&
        typeof knownTorrentMeta !== 'undefined' &&
        knownTorrentMeta &&
        knownTorrentMeta.set
    ) {
        try {
            knownTorrentMeta.set(hashLower, {
                id: tmdbId,
                mediaType: mediaType,
                poster: torrent.poster || null
            });
        } catch (e) { }
    }

    result.isTvSeries = isTvSeries;
    result.mediaType = mediaType;
    result.videoFilesCount = videoFilesCount;
    result.allSeasonEpisodes = allSeasonEpisodes;
    result.movieStill = movieStill;
    result.details = details;

    return result;
}

function updateFileItemStill(fileItem, stillImage) {
    if (!fileItem || !stillImage) return;
    var existingContainer = fileItem.querySelector('.file-still-container');
    if (existingContainer) { var img = existingContainer.querySelector('img'); if (img) img.src = stillImage; }
    else {
        var tempDiv = document.createElement('div');
        tempDiv.innerHTML = `<div class="file-still-container"><img src="${stillImage}" onerror="this.parentElement.style.display='none'"></div><div class="file-overlay"></div>`;
        fileItem.insertBefore(tempDiv.firstChild, fileItem.firstChild);
        fileItem.insertBefore(tempDiv.firstChild, fileItem.firstChild.nextSibling);
    }
}

function updateDetailMetaInfo(tmdbData) {
    var metaContainer = getEl('catalog-detail-meta');
    if (!metaContainer) return;

    metaContainer.innerHTML = '';

    // Год
    if (tmdbData.release_date || tmdbData.first_air_date) {
        var year = (tmdbData.release_date || tmdbData.first_air_date).substring(0, 4);
        var yearChip = document.createElement('div');
        yearChip.className = 'catalog-meta-chip';
        yearChip.textContent = year;
        metaContainer.appendChild(yearChip);
    }
    // Рейтинг
    if (tmdbData.vote_average) {
        var ratingChip = document.createElement('div');
        ratingChip.className = 'catalog-meta-chip';
        ratingChip.textContent = '⭐ ' + tmdbData.vote_average.toFixed(1);
        metaContainer.appendChild(ratingChip);
    }
    // Тип контента
    var typeChip = document.createElement('div');
    typeChip.className = 'catalog-meta-chip';
    typeChip.textContent = (tmdbData.media_type === 'tv' || tmdbData.number_of_seasons !== undefined) ? 'Сериал' : 'Фильм';
    metaContainer.appendChild(typeChip);
    // Жанры
    if (tmdbData.genres && Array.isArray(tmdbData.genres)) {
        var genresLen = Math.min(tmdbData.genres.length, 3);
        for (var i = 0; i < genresLen; i++) {
            var genreChip = document.createElement('div');
            genreChip.className = 'catalog-meta-chip';
            genreChip.textContent = tmdbData.genres[i].name;
            metaContainer.appendChild(genreChip);
        }
    }

    // Если мы добавили хотя бы один чип, показываем контейнер
    if (metaContainer.children.length > 0) {
        metaContainer.classList.add('hidden');
        metaContainer.style.display = 'none';
    }

    // Те же данные, но одной строкой под заголовком (торрентный detail).
    // Вызывается из обоих путей загрузки TMDB — и воркерного, и запасного.
    detailMetaState.details = tmdbData;
    if (tmdbData) {
        // /api/tmdb/details отдаёт тип в поле type, media_type там не бывает
        detailMetaState.isTvSeries = detailMetaState.isTvSeries ||
            tmdbData.type === 'tv' || tmdbData.media_type === 'tv' ||
            tmdbData.number_of_seasons !== undefined;
    }
    renderDetailMetaRow();
}

// ==================== ДЕЛЕГИРОВАНИЕ PLAY-КНОПОК В ФАЙЛАХ ====================
function setupFilePlayButtonDelegation() {
    var filesList = getEl('files-list');
    if (!filesList || filesList._playDelegationBound) return;

    filesList._playDelegationBound = true;

    filesList.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('.play-btn') : null;
        if (!btn) return;

        e.stopPropagation();

        var item = btn.closest('.file-item');

        var hash = btn.dataset.hash || (item && item.dataset.hash) || '';

        var fileId = parseInt(btn.dataset.fileId || (item && item.dataset.fileId) || '1', 10);
        if (!fileId) fileId = 1;

        var episodeIndex = null;
        var rawEpisode = btn.dataset.episodeIndex;

        if ((!rawEpisode || rawEpisode === 'null') && item && item.dataset.episodeIndex !== undefined) {
            rawEpisode = item.dataset.episodeIndex;
        }

        if (rawEpisode !== undefined && rawEpisode !== '' && rawEpisode !== 'null') {
            var parsedEpisode = parseInt(rawEpisode, 10);
            if (!isNaN(parsedEpisode)) episodeIndex = parsedEpisode;
        }

        if (!hash || !AppState.currentTorrserverUrl) return;

        var playUrl = AppState.currentTorrserverUrl + '/play/' + hash + '/' + fileId;

        var overlay = getEl('playback-overlay');
        if (overlay) overlay.classList.add('active');

        var detailView = getEl('detail-view');
        if (detailView) detailView.style.pointerEvents = 'none';

        startHLSPlayback(playUrl, 0, false, episodeIndex).finally(function () {
            if (overlay) overlay.classList.remove('active');
            if (detailView) detailView.style.pointerEvents = 'auto';
        });
    });
}
// ==================== /ДЕЛЕГИРОВАНИЕ PLAY-КНОПОК ====================

function addFileItem(file, hash, name, episodeIndex, stillImage, returnOnly = false) {
    var fileName = file.path.split('/').pop() || ('Файл ' + file.id);
    var fileExt = fileName.split('.').pop().toLowerCase();
    if (!['mkv', 'mp4', 'avi', 'mov', 'webm', 'm4v'].includes(fileExt)) return null;
    var item = document.createElement('div'); item.className = 'file-item'; item.dataset.hash = hash; item.dataset.fileId = file.id; item.dataset.fileName = fileName;
    if (episodeIndex !== undefined && episodeIndex !== null) item.dataset.episodeIndex = episodeIndex;
    item.innerHTML = `
        <div class="file-content"><button class="play-btn" data-hash="${hash}" data-file-id="${file.id}" data-episode-index="${episodeIndex !== undefined ? episodeIndex : ''}">▶</button></div>
        <div class="file-info"><div class="file-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div><div class="file-size">${formatBytes(file.length)}</div></div>
        <div class="file-progress-container" style="width:100%;height:3px;background:rgba(255,255,255,0.2);border-radius:0 0 12px 12px;overflow:hidden;position:absolute;bottom:0;left:0;"><div class="file-progress-fill" style="width:0%;height:100%;background:#ff8c00;transition:width 0.2s ease;"></div></div>
    `;
    // item.querySelector('.play-btn').onclick = function (e) {
    //     e.stopPropagation();
    //     var playUrl = file.id ? AppState.currentTorrserverUrl + '/play/' + hash + '/' + file.id : AppState.currentTorrserverUrl + '/play/' + hash + '/1';
    //     getEl('playback-overlay').classList.add('active'); getEl('detail-view').style.pointerEvents = 'none';
    //     startHLSPlayback(playUrl, 0, false, episodeIndex).finally(function () { getEl('playback-overlay').classList.remove('active'); getEl('detail-view').style.pointerEvents = 'auto'; });
    // };
    // Клик по .play-btn обрабатывается делегированием через setupFilePlayButtonDelegation()
    if (returnOnly) return item;
    var filesList = getEl('files-list'); if (filesList) filesList.appendChild(item);
    return item;
}

async function loadStillsAndUpdateFiles(seasonNumbers, allSeasonEpisodes, movieStill, totalVideoFiles) {
    if (seasonNumbers.length > 0 && Object.keys(allSeasonEpisodes).length > 0) {
        var sortedSeasons = seasonNumbers.slice().sort((a, b) => a - b);
        var allStillsInOrder = [];
        sortedSeasons.forEach(seasonNum => {
            var episodes = (allSeasonEpisodes[seasonNum] || []).slice().sort((a, b) => (a.episodeNumber || 0) - (b.episodeNumber || 0));
            episodes.forEach(ep => { if (ep.stillPath) allStillsInOrder.push({ season: seasonNum, episode: ep.episodeNumber, stillPath: ep.stillPath }); });
        });
        var fileItems = document.querySelectorAll('.file-item');
        for (var i = 0; i < Math.min(fileItems.length, allStillsInOrder.length); i++) {
            (function (item, url, index) { setTimeout(function () { updateFileItemStill(item, buildTmdbPosterUrl(url, 'w300')); }, index * 30); })(fileItems[i], allStillsInOrder[i].stillPath, i);
        }
    } else if (totalVideoFiles === 1 && movieStill) {
        var fileItem = document.querySelector('.file-item'); if (fileItem) setTimeout(function () { updateFileItemStill(fileItem, movieStill); }, 100);
    }
}

// Вспомогательная функция применения прогресса к элементу
function applyProgressToItem(item, timecode, duration) {
    var progressPercent = Math.min((timecode / duration) * 100, 98);
    var progressFill = item.querySelector('.file-progress-fill');
    if (progressFill) {
        progressFill.style.width = progressPercent + '%';
        if (progressPercent > 5) {
            progressFill.style.opacity = '1';
            item.classList.add('has-progress');
        }
    }
    item.dataset.progressTimecode = timecode;
    item.dataset.progressDuration = duration;
}

function getVideoFilesForProgress(files) {
    var videoFiles = [];
    for (var i = 0; i < (files || []).length; i++) {
        var file = files[i];
        var name = String(file.path || file.name || '').toLowerCase();
        if (['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v'].some(function (ext) {
            return name.indexOf(ext) !== -1;
        })) {
            file._progressIndex = i;
            videoFiles.push(file);
        }
    }
    return videoFiles;
}

function getTorrentProgressBatch(hash, files) {
    if (!hash) return Promise.resolve({ byFileId: {}, lastWatched: null });
    var cached = torrentProgressCache.get(hash);
    if (cached) return Promise.resolve(cached);
    if (torrentProgressInFlight[hash]) return torrentProgressInFlight[hash];

    var request = (async function () {
        var videoFiles = getVideoFilesForProgress(files);
        var result = { byFileId: {}, lastWatched: null };
        if (!videoFiles.length) return result;

        try {
            var response = await fetch(SERVER_URL + '/api/timecode/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hash: hash,
                    fileIds: videoFiles.map(function (file) { return parseInt(file.id, 10); }),
                    clientId: localStorage.getItem('clientId')
                })
            });
            if (!response.ok) return result;
            var data = await response.json();
            if (!data.success || !data.timecodes) return result;

            for (var i = 0; i < videoFiles.length; i++) {
                var file = videoFiles[i];
                var timecode = data.timecodes[file.id];
                if (!timecode || !(timecode.timecode > 0)) continue;
                var entry = {
                    hash: hash,
                    fileId: file.id,
                    timecode: timecode.timecode,
                    duration: timecode.duration || 0,
                    index: file._progressIndex,
                    fileName: String(file.path || file.name || '').split('/').pop()
                };
                result.byFileId[String(file.id)] = entry;
                if (!result.lastWatched || entry.index > result.lastWatched.index) {
                    result.lastWatched = entry;
                }
            }
        } catch (error) {
            console.error('Progress batch request failed:', error);
        }
        return result;
    })();

    torrentProgressInFlight[hash] = request;
    return request.then(function (result) {
        delete torrentProgressInFlight[hash];
        torrentProgressCache.set(hash, result);
        return result;
    }, function (error) {
        delete torrentProgressInFlight[hash];
        throw error;
    });
}

async function loadProgressForTorrent(torrent, preloadedFiles) {
    if (!torrent || !torrent.hash) return null;
    var files = Array.isArray(preloadedFiles) && preloadedFiles.length
        ? preloadedFiles
        : await getTorrentFilesWithCache(torrent, false);
    var progress = await getTorrentProgressBatch(torrent.hash, files);
    if (!progress.lastWatched) return null;

    var last = progress.lastWatched;
    return {
        hash: torrent.hash,
        fileId: last.fileId,
        timecode: last.timecode,
        duration: last.duration,
        episodeIndex: last.index,
        totalEpisodes: getVideoFilesForProgress(files).length,
        episodeName: last.fileName,
        isSeries: getVideoFilesForProgress(files).length > 1
    };
}

async function loadProgressForFileItems(items, hash) {
    if (!items || !items.length || !hash) return;
    var files = [];
    for (var i = 0; i < items.length; i++) {
        files.push({
            id: items[i].dataset.fileId,
            path: items[i].dataset.fileName || String(items[i].dataset.fileId) + '.mkv'
        });
    }
    var progress = await getTorrentProgressBatch(hash, files);
    for (var j = 0; j < items.length; j++) {
        var itemProgress = progress.byFileId[String(items[j].dataset.fileId)];
        if (itemProgress && itemProgress.duration > 0) {
            applyProgressToItem(items[j], itemProgress.timecode, itemProgress.duration);
        }
    }
}

function normalizeSearchResult(item) {

    var info = item.info || {};

    var rawTracker = item.Tracker || item.tracker || '';
    var tracker = String(rawTracker).trim();

    var title = item.Title || item.title || info.name || info.originalname || item.name || 'Без названия';

    // Сохраняем "чистое" название отдельно для внутреннего использования (добавление в TorrServer)
    var cleanName = info.name || item.name || title;

    // Определяем released/year из разных возможных источников
    var releasedRaw = info.relased || info.released || item.PublishDate || null;
    var releasedYear = null;
    if (typeof releasedRaw === 'number') {
        releasedYear = releasedRaw;
    } else if (typeof releasedRaw === 'string') {
        var match = releasedRaw.match(/(19|20)\d{2}/);
        releasedYear = match ? parseInt(match[0], 10) : null;
    }

    // Определяем types (movie/tv)
    var types = Array.isArray(info.types) ? info.types.slice() : [];
    var categoryDesc = (item.CategoryDesc || '').toLowerCase();
    if (categoryDesc.includes('tv') || categoryDesc.includes('сериал') || categoryDesc.includes('series')) {
        if (types.indexOf('tv') === -1) types.push('tv');
    }
    if (categoryDesc.includes('movie') || categoryDesc.includes('фильм') || categoryDesc.includes('film')) {
        if (types.indexOf('movie') === -1) types.push('movie');
    }

    // Нормализуем magnet
    var magnet = item.MagnetUri || item.magnet || null;

    // Вычисляем sizeName если не указан
    var size = item.Size || item.size || 0;
    var sizeName = info.sizeName || item.sizeName;
    if (!sizeName && size > 0) {
        sizeName = formatBytes(size);
    }

    // Вычисляем createTime (timestamp для сортировки по дате)
    var createTime = item.createTime || 0;
    if (!createTime && item.PublishDate) {
        try {
            createTime = new Date(item.PublishDate).getTime() || 0;
        } catch (e) {
            createTime = 0;
        }
    }

    var normalized = {
        title: title,
        name: cleanName,
        originalname: info.originalname || '',
        magnet: magnet,
        size: size,
        sizeName: sizeName || '0 B',
        tracker: tracker,
        sid: item.Seeders !== undefined ? parseInt(item.Seeders, 10) : (item.sid || 0),
        pir: item.Peers !== undefined ? parseInt(item.Peers, 10) : (item.pir || 0),
        quality: info.quality || item.quality || 0,
        videotype: info.videotype || item.videotype || '',
        voices: Array.isArray(info.voices) ? info.voices : (Array.isArray(item.voices) ? item.voices : []),
        types: types,
        released: releasedYear,
        relased: releasedYear,
        year: releasedYear,
        languages: Array.isArray(info.languages) ? info.languages : (Array.isArray(item.languages) ? item.languages : []),
        createTime: createTime,
        details: item.Details || item.details || null,
        seasons: Array.isArray(info.seasons) ? info.seasons : (Array.isArray(item.seasons) ? item.seasons : [])  // ★ ДОБАВЛЕНО
    };

    return normalized;
}

async function searchTorrents(query) {
    if (!query || !query.trim()) { alert('Введите поисковый запрос'); return; }
    if (getCurrentSearchMode() === 'globalsearch') await searchTMDB(query);
    else await searchTorrentsLegacy(query);
}

async function searchTorrentsLegacy(query) {
    if (!query || !query.trim()) { alert('Введите поисковый запрос'); return; }
    var encodedQuery = encodeURIComponent(query.trim());
    var jacred = getEl('jacred-url');
    var jacDefault = (jacred && jacred.value !== "") ? jacred.value : "jac.red";

    // Новый API Jackett v2.0
    var searchUrl = AppState.protocol + '//' + jacDefault + '/api/v2.0/indexers/all/results?Query=' + encodedQuery + '&exact=true';

    showLoading('Поиск...');
    try {
        var response = await fetch(searchUrl);
        if (!response.ok) throw new Error('Ошибка поиска: HTTP ' + response.status);
        var data = await response.json();

        // Новый формат: {Results: [...]}, старый формат был просто массивом
        var rawResults = [];
        if (data && Array.isArray(data.Results)) {
            rawResults = data.Results;
        } else if (Array.isArray(data)) {
            // Обратная совместимость со старым API
            rawResults = data;
        }

        searchResults = rawResults.map(normalizeSearchResult);
        currentSearchQuery = query;

        var searchInput = getEl('search-query');
        if (searchInput) searchInput.value = '';

        updateAvailableTrackers();
        updateAvailableYears();
        applyFiltersAndSort();
        showSearchResults();
    } catch (error) {
        console.error('Ошибка поиска:', error);
        alert('Ошибка при поиске: ' + error.message);
    } finally {
        hideLoading();
    }
}

function updateAvailableYears() {
    var yearSet = {}; var yearFilter = getEl('filter-year');
    searchResults.forEach(r => { if (r.released && !isNaN(r.released)) yearSet[r.released] = true; });
    var availableYears = Object.keys(yearSet).map(Number).sort((a, b) => b - a);
    if (yearFilter) {
        var currentYear = yearFilter.value;
        yearFilter.innerHTML = '<option value="all">Все</option>' + availableYears.map(y => `<option value="${y}" ${currentYear !== 'all' && String(y) === currentYear ? 'selected' : ''}>${y}</option>`).join('');
        if (currentYear !== 'all' && !yearSet[currentYear]) { yearFilter.value = 'all'; currentYearFilter = ''; }
    }
}

function initSearchModeToggle() {
    var modeSelect = getEl('search-mode');
    if (modeSelect) {
        modeSelect.addEventListener('change', function (e) {
            currentSearchMode = e.target.value;
            var trackerFilter = getEl('filter-tracker'); var qualityFilter = getEl('filter-quality'); var contentTypeFilter = getEl('filter-content-type');
            if (currentSearchMode === 'globalsearch') {
                if (trackerFilter) trackerFilter.disabled = true; if (qualityFilter) qualityFilter.disabled = true; if (!contentTypeFilter) showContentTypeFilter();
            } else {
                if (trackerFilter) trackerFilter.disabled = false; if (qualityFilter) qualityFilter.disabled = false; if (contentTypeFilter && contentTypeFilter.remove) contentTypeFilter.remove();
            }
            if (currentSearchQuery) searchTorrents(currentSearchQuery);
        });
    }
}

function updateAvailableTrackers() {
    var trackerSet = {};

    searchResults.forEach(function (r) {
        if (r.tracker) {
            var trackers = String(r.tracker).split(',');
            for (var i = 0; i < trackers.length; i++) {
                var t = trackers[i].trim().toLowerCase();
                if (t) trackerSet[t] = true;
            }
        }
    });

    availableTrackers = Object.keys(trackerSet).sort();
    if (!availableTrackers.includes(currentTrackerFilter)) currentTrackerFilter = 'all';
    syncSearchFilterButtons();
    updateAvailableSeasons();
    updateAvailableVoices();
    updateAvailableVideotype();
}

function applyFiltersAndSort() {
    filteredResults = searchResults.filter(item => {
        if (currentQualityFilter !== 'all' && (item.quality || 0) !== parseInt(currentQualityFilter, 10)) return false;
        if (currentTrackerFilter !== 'all') {
            var trackerField = (item.tracker || '').toLowerCase();
            if (trackerField.indexOf(currentTrackerFilter.toLowerCase()) === -1) return false;
        }
        if (currentYearFilter && currentYearFilter !== 'all' && item.released !== parseInt(currentYearFilter, 10)) return false;
        if (currentSeasonFilter && currentSeasonFilter !== 'all' && (!item.seasons || !item.seasons.includes(parseInt(currentSeasonFilter, 10)))) return false;
        if (currentVoiceFilter && currentVoiceFilter !== 'all' && (!item.voices || !item.voices.includes(currentVoiceFilter))) return false;
        if (currentvideotypeFilter && currentvideotypeFilter !== 'all' && item.videotype != currentvideotypeFilter) return false;
        return true;
    });
    filteredResults.sort((a, b) => {
        switch (currentSort) {
            case 'date-desc': return new Date(b.createTime || 0) - new Date(a.createTime || 0);
            case 'date-asc': return new Date(a.createTime || 0) - new Date(b.createTime || 0);
            case 'size-desc': return (b.size || 0) - (a.size || 0);
            case 'size-asc': return (a.size || 0) - (b.size || 0);
            case 'sid-desc': return (b.sid || 0) - (a.sid || 0);
            case 'sid-asc': return (a.sid || 0) - (b.sid || 0);
            case 'pir-desc': return (b.pir || 0) - (a.pir || 0);
            case 'pir-asc': return (a.pir || 0) - (b.pir || 0);
            default: return 0;
        }
    });
    renderSearchResults();
}

function updateAvailableSeasons() {
    var seasonSet = {}; var seasonFilter = getEl('filter-season'); if (!seasonFilter) return;
    searchResults.forEach(r => { if (r.seasons && Array.isArray(r.seasons)) r.seasons.forEach(s => seasonSet[s] = true); });
    var availableSeasons = Object.keys(seasonSet).map(Number).sort((a, b) => a - b);
    var currentSeason = seasonFilter.value;
    seasonFilter.innerHTML = '<option value="all">Все</option>' + availableSeasons.map(s => `<option value="${s}" ${currentSeason !== 'all' && String(s) === currentSeason ? 'selected' : ''}>${s} сезон</option>`).join('');
    if (currentSeason !== 'all' && !seasonSet[parseInt(currentSeason)]) { seasonFilter.value = 'all'; currentSeasonFilter = 'all'; }
}

function updateAvailableVoices() {
    var voiceSet = {}; var voiceFilter = getEl('filter-voice'); if (!voiceFilter) return;
    searchResults.forEach(r => { if (r.voices && Array.isArray(r.voices)) r.voices.forEach(v => { if (v && v.trim()) voiceSet[v.trim()] = true; }); });
    var availableVoices = Object.keys(voiceSet).sort();
    var currentVoice = voiceFilter.value;
    voiceFilter.innerHTML = '<option value="all">Все</option>' + availableVoices.map(v => `<option value="${escapeHtml(v)}" ${currentVoice !== 'all' && v === currentVoice ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('');
    if (currentVoice !== 'all' && !voiceSet[currentVoice]) { voiceFilter.value = 'all'; currentVoiceFilter = 'all'; }
}

function updateAvailableVideotype() {
    var videotypeSet = {}; var videotypeFilter = getEl('filter-videotype'); if (!videotypeFilter) return;
    searchResults.forEach(r => { if (r.videotype && r.videotype.trim()) videotypeSet[r.videotype.trim()] = true; });
    var availablevideotype = Object.keys(videotypeSet).sort();
    var currentvideotype = videotypeFilter.value;
    videotypeFilter.innerHTML = '<option value="all">Все</option>' + availablevideotype.map(v => `<option value="${escapeHtml(v)}" ${currentvideotype !== 'all' && v === currentvideotype ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('');
    if (currentvideotype !== 'all' && !videotypeSet[currentvideotype]) { videotypeFilter.value = 'all'; currentvideotypeFilter = 'all'; }
}

function showSearchResults(options = {}) {
    var searchOverlay = getEl('search-overlay'); var searchTab = getEl('tab-search'); var torrentsTab = getEl('tab-torrents'); var catalogTab = getEl('tab-catalog'); var searchInput = getEl('search-query');
    if (!searchOverlay || !searchTab || !torrentsTab) return;
    if (searchInput && document.activeElement === searchInput) searchInput.blur();
    var torrserverSection = getEl('torrserver-section');
    searchTab.classList.add('active'); torrentsTab.classList.remove('active'); if (catalogTab) catalogTab.classList.remove('active');
    AppState.currentScreen = 'search'; syncSearchFilterButtons(); toggleSearchFiltersPanel(false);
    if (typeof Animations !== 'undefined' && typeof Animations.fadeIn === 'function') {
        // Контент под оверлеем прячем только после проявления: иначе на 0.2 с
        // вместо перехода видно пустую страницу
        Animations.fadeIn(searchOverlay, {
            duration: Animations.UI_FADE.overlay,
            display: 'flex',
            onDone: function () {
                if (torrserverSection && AppState.currentScreen === 'search') torrserverSection.style.display = 'none';
            }
        });
    } else {
        if (torrserverSection) torrserverSection.style.display = 'none';
        searchOverlay.classList.remove('hidden'); searchOverlay.style.display = 'flex';
    }
    if (options.runSearch && searchInput && searchInput.value.trim()) setTimeout(function () { searchTorrents(searchInput.value.trim()); }, 0);
    setTimeout(function () {
        if (typeof window.focusSearchHome === 'function') { window.focusSearchHome(options.focusQuery !== false); return; }
        if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
            updateFocusableElements();
            var searchInputIndex = -1, searchBtnIndex = -1, filterToggleIndex = -1, firstFilterIndex = -1;
            for (var i = 0; i < focusableElements.length; i++) {
                var el = focusableElements[i];
                if (el.id === 'search-query') searchInputIndex = i; if (el.id === 'search-btn') searchBtnIndex = i; if (el.id === 'filter-toggle') filterToggleIndex = i;
                if (['sort-by', 'filter-quality', 'filter-tracker', 'filter-year', 'reset-filters', 'close-search'].indexOf(el.id) !== -1 && firstFilterIndex === -1) firstFilterIndex = i;
            }
            var targetIndex = options.focusQuery !== false ? (searchInputIndex !== -1 ? searchInputIndex : (searchBtnIndex !== -1 ? searchBtnIndex : filterToggleIndex)) : (firstFilterIndex !== -1 ? firstFilterIndex : (filterToggleIndex !== -1 ? filterToggleIndex : 0));
            setFocus(targetIndex !== -1 ? targetIndex : 0);
        }
    }, 80);
}

function hideSearchResults() {
    var searchOverlay = getEl('search-overlay'); var searchTab = getEl('tab-search'); var torrentsTab = getEl('tab-torrents'); var catalogTab = getEl('tab-catalog'); var searchInput = getEl('search-query'); var modeSelect = getEl('torrent-movie');
    if (modeSelect) modeSelect.value = 'globalsearch';
    if (!searchOverlay || !searchTab || !torrentsTab) return;
    var returnTo = AppState.searchReturnTo || AppState.inSearch;
    var torrserverSection = getEl('torrserver-section');
    // Контент показываем сразу — он проявляется из-под уходящего оверлея
    if (torrserverSection) torrserverSection.style.display = 'block';
    searchTab.classList.remove('active'); toggleSearchFiltersPanel(false);
    if (typeof Animations !== 'undefined' && typeof Animations.fadeOut === 'function') {
        // Прятать оверлей по-настоящему и чистить результаты можно только в конце
        // затухания: display:none обрывает CSS-переход мгновенно
        Animations.fadeOut(searchOverlay, {
            duration: Animations.UI_FADE.overlay,
            display: 'none',
            addHidden: true,
            onDone: function () { resetSearchVisibilityWindow(); var sr = getEl('search-results'); if (sr) sr.innerHTML = ''; }
        });
    } else {
        searchOverlay.classList.add('hidden'); searchOverlay.style.display = 'none';
        resetSearchVisibilityWindow();
        var searchResultsEl = getEl('search-results'); if (searchResultsEl) searchResultsEl.innerHTML = '';
    }
    if (returnTo === 'detail') {
        AppState.currentScreen = 'detail'; var mainContainer = getEl('main-container'); if (mainContainer && AppState.backupScroll > 0) mainContainer.scrollTop = AppState.backupScroll;
        AppState.searchReturnTo = null;
        if (catalogTab) catalogTab.classList.remove('active'); torrentsTab.classList.remove('active');
        var detailView = getEl('detail-view');
        if (typeof Animations !== 'undefined' && typeof Animations.ensureDetailVisible === 'function') {
            // Возвращаем уже отрисованный detail без затухания, но со снятием
            // недоигранного закрытия — иначе экран останется прозрачным
            Animations.ensureDetailVisible();
        } else if (detailView && detailView.style.display !== 'block') { detailView.style.display = 'block'; detailView.style.zIndex = '100'; detailView.style.pointerEvents = 'auto'; }
        // Страховка: карточку могли выпотрошить, пока она стояла под оверлеем
        // поиска. Цепочка «карточка каталога → поиск торрентов → детали торрента
        // → назад»: на выходе из деталей торрента app.js заново рисует карточку
        // каталога и сразу прячет её, а затухание в конце зовёт
        // resetDetailBackground — тот чистит заголовок, подзаголовок, постер и ряд
        // актёров. Показывать половину карточки нельзя — рисуем её заново.
        var detailTitleEl = getEl('detail-title-text');
        var restoreItem = AppState.pendingDetailItem || AppState.androidBackCatalog || AppState.currentDetailItem;
        var detailGutted = !!(detailTitleEl && !String(detailTitleEl.textContent || '').trim() &&
            restoreItem && restoreItem.id && !isTorrentDetailMode() &&
            typeof window.showCatalogDetail === 'function');
        if (detailGutted) {
            // showCatalogDetail сам поставит фокус на «Поиск торрентов»
            window.showCatalogDetail(restoreItem, AppState.catalogIndex || 0, AppState.catalogPu || null);
        } else {
            setTimeout(function () {
                if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
                    updateFocusableElements(); var watchBtn = getEl('catalog-watch-btn'); if (watchBtn) { for (var i = 0; i < focusableElements.length; i++) { if (focusableElements[i].id === 'catalog-watch-btn') { setFocus(i); return; } } }
                }
                if (typeof window.ensureCatalogDetailFocus === 'function') window.ensureCatalogDetailFocus(true);
            }, 100);
        }
    } else if (returnTo === 'catalog') {
        if (catalogTab) catalogTab.classList.add('active'); torrentsTab.classList.remove('active'); AppState.currentScreen = 'catalog';
        setTimeout(function () { if (typeof window.focusCatalogCardByIndex === 'function') { var savedIndex = localStorage.getItem('lastCatalogCardIndex'); window.focusCatalogCardByIndex(parseInt(savedIndex || 0)); } else if (typeof window.focusFirstCatalogCard === 'function') window.focusFirstCatalogCard(); }, 80);
    } else if (returnTo === 'home' && window.HomeScreen) {
        // Пришли в поиск с главной — туда и возвращаемся. Ни одна вкладка не
        // активна: на главной навигация своя, а обработчики вкладок проверяют
        // .active и иначе не сработали бы с первого нажатия.
        if (catalogTab) catalogTab.classList.remove('active'); torrentsTab.classList.remove('active');
        window.HomeScreen.show({ restoreFocus: true });
    } else {
        torrentsTab.classList.add('active'); if (catalogTab) catalogTab.classList.remove('active'); AppState.currentScreen = 'torrents';
        setTimeout(function () {
            if (typeof window.focusFirstTorrentCard === 'function' && window.focusFirstTorrentCard()) return;
            if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
                updateFocusableElements(); for (var i = 0; i < focusableElements.length; i++) { if (focusableElements[i].classList && focusableElements[i].classList.contains('torrent-card')) { setFocus(i); return; } } setFocus(0);
            }
        }, 80);
    }
    if (searchInput && document.activeElement === searchInput) searchInput.blur();
    AppState.searchReturnTo = null;
    AppState.openCatalogDetailOnSearchClose = null;
}

function resetFilters() {
    currentSort = 'date-desc'; currentQualityFilter = 'all'; currentTrackerFilter = 'all'; currentYearFilter = ''; currentSeasonFilter = 'all'; currentVoiceFilter = 'all'; currentvideotypeFilter = 'all';
    syncSearchFilterButtons();
    ['filter-year', 'filter-season', 'filter-voice', 'filter-videotype'].forEach(id => { var el = getEl(id); if (el) el.value = 'all'; });
    applyFiltersAndSort();
}

async function dropTorrentToServer(hash) {
    if (!AppState.currentTorrserverUrl) { alert('Сначала подключитесь к TorrServer'); return null; }
    try {
        var response = await torrServerFetch('/torrents', { method: 'POST', body: JSON.stringify({ action: 'drop', hash: hash }) });
        if (!response.ok) throw new Error('Ошибка остановки: ' + response.status);
        return true;
    } catch (error) { console.error('Ошибка остановки торрента:', error); throw error; }
}
window.dropTorrentToServer = dropTorrentToServer;

async function addTorrentToServer(magnet, hash, searchResult, options = {}) {
    var refreshList = options.refreshList !== false;
    if (!AppState.currentTorrserverUrl) {
        alert('Сначала подключитесь к TorrServer');
        return null;
    }
    var ctx = getCatalogSearchContext(searchResult);
    var poster = options.poster || ctx.poster || null;
    var tmdbId = options.tmdbId || ctx.id || null;
    var mediaType = options.mediaType || ctx.mediaType || AppState.mediaType || 'movie';
    var seasons = [];

    if (searchResult && Array.isArray(searchResult.seasons)) {
        seasons = searchResult.seasons.slice();
    }
    if (!seasons.length && searchResult && searchResult.title) {
        seasons = extractSeasonsFromTitle(searchResult.title);
    }
    if (!seasons.length && ctx.item && (ctx.item.title || ctx.item.name)) {
        seasons = extractSeasonsFromTitle(ctx.item.title || ctx.item.name);
    }

    var baseName =
        (ctx.item && (ctx.item.title || ctx.item.name)) ||
        (searchResult && (searchResult.name || searchResult.title)) ||
        'Без названия';
    AppState.mediaType = mediaType;
    var torrname = (tmdbId ? '[' + tmdbId + '] ' : '') + baseName;

    if (mediaType === 'tv' && seasons.length > 0) {
        torrname += ' [сезон ' +
            (seasons.length > 1 ? seasons[0] + '-' + seasons[seasons.length - 1] : seasons[0]) +
            ']';
    }

    var requestBody = {
        action: 'add',
        link: magnet,
        title: torrname,
        category: mediaType,
        save_to_db: AppState.addToDbEnabled
    };

    if (poster) {
        // ★★★ ВАЖНО: заменяем image.tmdb.org на прокси перед отправкой ★★★
        requestBody.poster = replaceTmdbWithProxy(poster);
    }

    try {
        var response = await torrServerFetch('/torrents', {
            method: 'POST',
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error('Ошибка добавления: ' + response.status);
        }

        var hashLower = hash ? String(hash).toLowerCase() : null;
        if (hashLower) {
            knownTorrentMeta.set(hashLower, {
                id: tmdbId,
                mediaType: mediaType,
                poster: requestBody.poster, // Используем уже заменённый URL
                title: torrname
            });
        }

        if (
            (window.AndroidJS && !AppState.isCatalogSerials) ||
            (AppState.transcodingFullOnOff && !AppState.isCatalogSerials)
        ) {
            return true;
        }

        await response.json();
        window.pendingCatalogPoster = null;
        window.pendingCatalogItem = null;
        lastAddedTorrentHash = hashLower;

        if (refreshList) {
            await refreshTorrentsList();
            var found = AppState.torrents.find(function (t) {
                return t.hash && t.hash.toLowerCase() === hashLower;
            });
            if (found) {
                found.poster = found.poster || requestBody.poster;
                found.tmdbId = found.tmdbId || tmdbId;
                found.media_type = found.media_type || mediaType;
                knownTorrentMeta.set(found.hash.toLowerCase(), {
                    id: tmdbId,
                    mediaType: mediaType,
                    poster: requestBody.poster,
                    title: found.title
                });
            }
            return found || true;
        }
        return true;
    } catch (error) {
        console.error('❌ Ошибка добавления торрента:', error);
        alert('Ошибка при добавлении торрента: ' + error.message);
        window.pendingCatalogPoster = null;
        window.pendingCatalogItem = null;
        return null;
    }
}

window.addTorrentSearchToServer = function (magnet, hash, searchResult) { return addTorrentToServer(magnet, hash, searchResult, { refreshList: false }); };

async function refreshTorrentsList() {
    var focusedCard = document.querySelector('.torrent-card.focused');
    var preserveHash = (focusedCard && focusedCard.dataset.hash) || window.lastSelectedTorrentHash || null;
    var preserveIndex = typeof window.lastSelectedTorrentIndex === 'number' ? window.lastSelectedTorrentIndex : 0;
    try {
        var response = await torrServerFetch('/torrents', { method: 'POST', body: JSON.stringify({ action: 'list' }) });
        if (response.ok) {
            var data = await response.json();
            AppState.torrents = Array.isArray(data) ? data : [];
            if (!window.AndroidJS || !AppState.transcodingFullOnOff || !AppState.isCatalogSearch || AppState.isCatalogSerials) renderTorrents();
            if (!window.AndroidJS && !AppState.transcodingFullOnOff && !AppState.playFromHash && AppState.currentScreen === 'torrents') {
                setTimeout(function () {
                    if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
                        updateFocusableElements();
                        var targetIndex = -1;
                        for (var i = 0; i < focusableElements.length; i++) { if (focusableElements[i].classList && focusableElements[i].classList.contains('torrent-card') && preserveHash && focusableElements[i].dataset.hash === preserveHash) { targetIndex = i; break; } }
                        if (targetIndex === -1) { var cards = focusableElements.filter(el => el.classList && el.classList.contains('torrent-card')); if (cards[preserveIndex]) targetIndex = focusableElements.indexOf(cards[preserveIndex]); }
                        if (targetIndex === -1) { for (var l = 0; l < focusableElements.length; l++) { if (focusableElements[l].classList && focusableElements[l].classList.contains('torrent-card')) { targetIndex = l; break; } } }
                        if (targetIndex !== -1) setFocus(targetIndex);
                    }
                }, 80);
            }
            return true;
        }
    } catch (error) { console.error('Ошибка обновления списка:', error); }
    return false;
}
window.refreshTorrentsList = refreshTorrentsList;

async function playFromHash(hash, magnet, searchResult = null) {
    if (!hash) { alert('Ошибка: hash не найден'); return; }
    if (!AppState.currentTorrserverUrl) { alert('Сначала подключитесь к TorrServer'); return; }
    AppState.androidBackCatalog = AppState.currentDetailItem;
    if (window.addToWatchHistory && AppState.pendingDetailItem && AppState.pendingDetailItem.id) {
        await window.addToWatchHistory(String(AppState.pendingDetailItem.id), currentSearchQuery, AppState.pendingDetailItem.media_type, AppState.pendingDetailPoster || null);
    }
    getEl('playback-overlay').classList.add('active'); document.querySelector('.playback-text').textContent = 'Поиск постера и добавление...';
    try {
        var ctx = getCatalogSearchContext(searchResult);

        AppState.pendingDetailPoster = ctx.poster;
        window.pendingCatalogPoster = ctx.poster;
        AppState.pendingDetailTmdbId = ctx.id;
        AppState.pendingDetailMediaType = ctx.mediaType;

        var isSerial =
            ctx.mediaType === 'tv' ||
            AppState.mediaType === 'tv' ||
            (searchResult && searchResult.types && Array.isArray(searchResult.types) &&
                (searchResult.types.indexOf('tv') !== -1 || searchResult.types.indexOf('serial') !== -1)) ||
            (searchResult && Array.isArray(searchResult.seasons) && searchResult.seasons.length > 0);

        if (isSerial) AppState.isCatalogSerials = true;
        AppState.isCatalogSearch = true;

        var addedTorrent = await addTorrentToServer(magnet, hash, searchResult, {
            poster: ctx.poster,
            tmdbId: ctx.id,
            mediaType: ctx.mediaType
        });

        if (!addedTorrent || addedTorrent === true) {
            await refreshTorrentsList();
            addedTorrent = AppState.torrents.find(function (t) {
                return (t.hash || '').toLowerCase() === hash.toLowerCase();
            });
        }

        if (addedTorrent && typeof addedTorrent === 'object') {
            addedTorrent.poster = addedTorrent.poster || ctx.poster;
            addedTorrent.tmdbId = addedTorrent.tmdbId || ctx.id;
            addedTorrent.media_type = addedTorrent.media_type || ctx.mediaType;

            knownTorrentMeta.set(hash.toLowerCase(), {
                id: ctx.id,
                mediaType: ctx.mediaType,
                poster: ctx.poster,
                title: addedTorrent.title
            });
        }
        if (!window.AndroidJS || !AppState.transcodingFullOnOff) { AppState.currentDetailItem = addedTorrent; if (typeof clearDetailHistory === 'function') clearDetailHistory(); }
        if (!isSerial) {
            var fileId = 1;
            if (window.AndroidJS) {
                getEl('playback-overlay').classList.remove('active');
                var playURL = AppState.currentTorrserverUrl + "/stream?link=" + hash + "&index=" + fileId + "&play=play";
                AndroidJS.openPlayer(playURL, JSON.stringify({ url: playURL, title: addedTorrent.title || 'Видео', iptv: false, timeline: { hash: hash + '_' + fileId, time: 0, duration: 0, percent: 0 } }));
                return true;
            }
            if (AppState.transcodingFullOnOff) {
                getEl('playback-overlay').classList.remove('active');
                var playURL = AppState.currentTorrserverUrl + '/play/' + hash + '/' + fileId;
                var searchOverlay = getEl('search-overlay');
                if (searchOverlay) searchOverlay.classList.add('hidden');
                AppState.returnToSearchResults = true;
                await startHLSPlayback(playURL, null, true, fileId);
                return true;
            }
            var playbackTarget = getPreferredPlaybackFile(addedTorrent, searchResult);
            fileId = playbackTarget.fileId || 1;
            document.querySelector('.playback-text').textContent = 'Воспроизведение...';
            var playUrl = AppState.currentTorrserverUrl + '/play/' + hash + '/' + fileId;
            hideSearchResults(); AppState.inSearch = "torrents";
            await startHLSPlayback(playUrl, null, true, playbackTarget.episodeIndex);
        } else {
            AppState.currentDetailItem = addedTorrent; AppState.isCatalogSerials = true;
            if (window.AndroidJS || AppState.transcodingFullOnOff) {
                // Результаты поиска не уничтожаем — только прячем оверлей.
                // Вернёмся к ним при выходе из detail (back-from-detail)
                var searchOverlay = getEl('search-overlay');
                if (searchOverlay) searchOverlay.classList.add('hidden');
                AppState.searchResultsHidden = true;
            } else {
                hideSearchResults();
            }
            AppState.inSearch = (window.AndroidJS || AppState.transcodingFullOnOff) ? "catalog" : "torrents";
            showDetail(addedTorrent);
        }
    } catch (error) { console.error('❌ Ошибка воспроизведения:', error); alert('Ошибка воспроизведения: ' + error.message); }
    finally { getEl('playback-overlay').classList.remove('active'); document.querySelector('.playback-text').textContent = 'Воспроизведение...'; }
}
window.playFromHash = playFromHash;

function clearSearchResults() {
    searchResults = []; filteredResults = []; currentSearchQuery = ''; availableTrackers = [];
    currentTrackerFilter = 'all'; currentSeasonFilter = 'all'; currentVoiceFilter = 'all'; currentvideotypeFilter = 'all';
    syncSearchFilterButtons();
}
window.clearSearchResults = clearSearchResults;

function buildSearchResultMarkup(result, index) {
    var voices = Array.isArray(result.voices) ? result.voices : [];
    var hash = extractHashFromMagnet(result.magnet);
    var trackerDisplay = result.tracker || 'Unknown';

    return '<div class="search-result-item" data-index="' + index + '">' +
        '<div class="search-result-info">' +
        '<div class="search-result-title">' + escapeHtml(result.title || 'Без названия') + '</div>' +
        '<div class="search-result-meta">' +
        '<div class="search-result-meta-item">' + escapeHtml(trackerDisplay) + '</div>' +
        '<div class="search-result-meta-item">' + escapeHtml(result.sizeName || formatBytes(result.size)) + '</div>' +
        '<div class="search-result-meta-item">' + (result.released || 'N/A') + ' (' + (result.createTime ? new Date(result.createTime).toLocaleDateString() : 'N/A') + ')</div>' +
        '<div class="search-result-meta-item">' + ((result.types && result.types.indexOf('tv') !== -1) ? 'Сериал' : 'Фильм') + ' / ' + (result.quality || 'N/A') + 'p</div>' +
        '<div class="search-result-meta-item">сиды: ' + (result.sid !== undefined ? result.sid : 0) + '</div>' +
        '<div class="search-result-meta-item">пиры: ' + (result.pir !== undefined ? result.pir : 0) + '</div>' +
        '</div>' +
        (voices.length > 0 ? '<div class="search-result-voices">' + voices.map(function (voice) { return '<span class="search-result-voice">' + escapeHtml(voice) + '</span>'; }).join('') + '</div>' : '') +
        '</div>' +
        '<button class="search-result-play" data-hash="' + hash + '" data-magnet="' + escapeAttr(result.magnet) + '" data-index="' + index + '" ' + (!hash ? 'disabled' : '') + '>' + (hash ? '▶' : '❌ Нет hash') + '</button>' +
        '</div>';
}

// ==================== ОКОННАЯ ВИДИМОСТЬ СПИСКА РЕЗУЛЬТАТОВ ====================

/**
 * Элементы списка результатов, которые дальше SEARCH_VISIBILITY_WINDOW_ROWS
 * высот карточки от вьюпорта, получают класс search-offscreen
 * (visibility: hidden в styles.css) и перестают отрисовываться. По мере
 * приближения класс снимается, с уходящей стороны — ставится, поэтому
 * «живыми» всегда остаются только видимые карточки плюс запас.
 *
 * Тот же приём, что у рядов каталога (OFFSCREEN_CLASS в catalog.js), и по тем
 * же причинам: visibility, а не display: none — бокс остаётся на месте,
 * значит высота списка и позиция скролла не меняются, IntersectionObserver
 * продолжает видеть элемент (у display:none прямоугольник нулевой, и класс
 * уже никогда бы не сняли), а offsetParent не null — то есть VISIBLE()
 * в control.js по-прежнему пускает на скрытую карточку фокус.
 *
 * Ошибка в безопасную сторону: карточки создаются видимыми, гасит их только
 * колбэк наблюдателя. Нет IntersectionObserver (или он молчит) — потеряем
 * оптимизацию, но не покажем пустой список.
 */
var SEARCH_OFFSCREEN_CLASS = 'search-offscreen';
var SEARCH_VISIBILITY_WINDOW_ROWS = 5;
var SEARCH_VISIBILITY_FALLBACK_MARGIN_PX = 700;
var searchVisibilityObserver = null;

function createSearchVisibilityObserver(container, marginPx) {
    return new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
            // Нулевая высота — оверлей поиска скрыт (display:none) или список
            // очищен. Наблюдатель честно рапортует «не пересекается», но гасить
            // по такому сообщению нельзя: вернёмся к результатам и увидим
            // пустой экран до следующего пересчёта.
            if (!entries[i].boundingClientRect.height) continue;
            if (entries[i].isIntersecting) entries[i].target.classList.remove(SEARCH_OFFSCREEN_CLASS);
            else entries[i].target.classList.add(SEARCH_OFFSCREEN_CLASS);
        }
    }, {
        root: container,
        rootMargin: marginPx + 'px 0px',   // запас только по вертикали
        threshold: 0
    });
}

/** Берёт под наблюдение карточки, которых наблюдатель ещё не видел */
function observeSearchResultItems(container) {
    if (!container || !('IntersectionObserver' in window)) return;
    var items = container.querySelectorAll('.search-result-item');
    if (!items.length) return;

    if (!searchVisibilityObserver) {
        // rootMargin у наблюдателя потом не поменять, поэтому запас считаем
        // один раз — по уже лежащей в DOM карточке
        var h = items[0].offsetHeight;
        var margin = h ? Math.round(h * SEARCH_VISIBILITY_WINDOW_ROWS)
            : SEARCH_VISIBILITY_FALLBACK_MARGIN_PX;
        searchVisibilityObserver = createSearchVisibilityObserver(container, margin);
    }

    for (var i = 0; i < items.length; i++) {
        if (items[i].dataset.visObserved === '1') continue;
        items[i].dataset.visObserved = '1';
        searchVisibilityObserver.observe(items[i]);
    }
}

/**
 * Список пересобирается или очищается: старые карточки отсоединяются от DOM,
 * а наблюдатель держал бы их ссылками. Новый создаст observeSearchResultItems.
 */
function resetSearchVisibilityWindow() {
    if (!searchVisibilityObserver) return;
    searchVisibilityObserver.disconnect();
    searchVisibilityObserver = null;
}

/**
 * Снимает погашение немедленно. Нужно потому, что колбэк наблюдателя приходит
 * через кадр-два после сдвига скролла, а карточка под фокусом обязана быть
 * видимой сразу. Зовёт focusEl() из control.js. Рассинхрон самоисправляется:
 * наблюдатель всё равно пришлёт своё состояние.
 */
function revealSearchResultItem(el) {
    if (!el || !el.classList) return;
    el.classList.remove(SEARCH_OFFSCREEN_CLASS);
}
window.revealSearchResultItem = revealSearchResultItem;

// Render result cards in frames. Large tracker responses no longer monopolise the UI thread.
function renderSearchResults() {
    var searchResultsDiv = getEl('search-results');
    if (!searchResultsDiv) return;
    var renderId = (searchResultsDiv._renderId || 0) + 1;
    searchResultsDiv._renderId = renderId;
    // Прежние карточки сейчас уедут из DOM вместе с innerHTML
    resetSearchVisibilityWindow();

    if (filteredResults.length === 0) {
        searchResultsDiv.innerHTML = '<div class="filter-stats">Всего найдено: <span>' + searchResults.length + '</span></div><div class="search-result-empty">' + (currentSearchQuery ? 'Нет результатов по фильтрам для "' + escapeHtml(currentSearchQuery) + '"' : 'Введите запрос для поиска') + '</div>';
        return;
    }

    searchResultsDiv.innerHTML = '<div class="filter-stats">Показано: <span>' + filteredResults.length + '</span> из <span>' + searchResults.length + '</span></div>';
    searchResultsDiv.onclick = function (event) {
        var playBtn = event.target.closest('.search-result-play');
        if (playBtn && !playBtn.disabled) {
            event.stopPropagation();
            var hash = playBtn.dataset.hash;
            var index = parseInt(playBtn.dataset.index, 10);
            var sourceResult = !isNaN(index) ? filteredResults[index] : null;
            var searchResult = sourceResult;
            if (sourceResult && window.pendingCatalogPoster) {
                searchResult = {};
                for (var key in sourceResult) {
                    if (sourceResult.hasOwnProperty(key)) searchResult[key] = sourceResult[key];
                }
                searchResult.poster = window.pendingCatalogPoster;
            }
            if (hash) {
                if (window.AndroidJS || AppState.transcodingFullOnOff) AppState.playFromHash = true;
                playFromHash(hash, playBtn.dataset.magnet, searchResult);
            }
            return;
        }
        var item = event.target.closest('.search-result-item');
        if (item) {
            var button = item.querySelector('.search-result-play');
            if (button && !button.disabled) button.click();
        }
    };

    var index = 0;
    var CHUNK_SIZE = 30;
    function renderChunk() {
        if (searchResultsDiv._renderId !== renderId) return;
        var html = '';
        var end = Math.min(index + CHUNK_SIZE, filteredResults.length);
        for (; index < end; index++) html += buildSearchResultMarkup(filteredResults[index], index);
        searchResultsDiv.insertAdjacentHTML('beforeend', html);
        // Карточки приходят пачками, значит и наблюдателю их отдаём пачками
        observeSearchResultItems(searchResultsDiv);
        if (index < filteredResults.length) requestAnimationFrame(renderChunk);
    }
    requestAnimationFrame(renderChunk);
}

function extractHashFromMagnet(magnet) {
    if (!magnet) return null;
    var match = magnet.match(/xt=urn:btih:([a-fA-F0-9]{40})/i);
    if (match && match[1]) return match[1].toLowerCase();
    var altMatch = magnet.match(/[a-fA-F0-9]{40}/);
    if (altMatch) return altMatch[0].toLowerCase();
    return null;
}

function getCurrentSearchMode() {
    var modeSelect = getEl('torrent-movie'); if (modeSelect) currentSearchMode = modeSelect.value; return currentSearchMode;
}

async function searchTMDB(query) {
    if (!query || !query.trim()) { alert('Введите поисковый запрос'); return; }
    if (tmdbSearchController) tmdbSearchController.abort();
    tmdbSearchController = new AbortController();
    var controller = tmdbSearchController;
    var searchSequence = ++tmdbSearchSequence;
    showLoading('Поиск в TMDB...');
    try {
        var encodedQuery = encodeURIComponent(query.trim());
        var searchResponses = await Promise.all([
            fetch('/api/tmdb/search?query=' + encodedQuery + '&type=movie&year=', { signal: controller.signal }),
            fetch('/api/tmdb/search?query=' + encodedQuery + '&type=tv&year=', { signal: controller.signal })
        ]);
        if (searchSequence !== tmdbSearchSequence) return;
        var moviesResponse = searchResponses[0];
        var tvResponse = searchResponses[1];
        var allResults = [];
        if (moviesResponse && moviesResponse.ok) {
            var moviesData = await moviesResponse.json();
            if (moviesData.results) moviesData.results.forEach(item => allResults.push({ id: item.id, media_type: 'movie', title: item.title, name: item.title, release_date: item.release_date, vote_average: item.vote_average, vote_count: item.vote_count, overview: item.overview, poster_path: item.poster_path, backdrop_path: item.backdrop_path, searchQuery: query }));
        }
        if (tvResponse && tvResponse.ok) {
            var tvData = await tvResponse.json();
            if (tvData.results) tvData.results.forEach(item => allResults.push({ id: item.id, media_type: 'tv', title: item.name, name: item.name, first_air_date: item.first_air_date, vote_average: item.vote_average, vote_count: item.vote_count, overview: item.overview, poster_path: item.poster_path, backdrop_path: item.backdrop_path, searchQuery: query }));
        }
        allResults.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0) || (b.vote_count || 0) - (a.vote_count || 0));
        globalSearchResults = allResults; currentSearchQuery = query;
        if (currentSearchMode === 'globalsearch') showContentTypeFilter();
        showGlobalSearchResults();
    } catch (error) {
        if (!error || error.name !== 'AbortError') {
            console.error('Ошибка поиска в TMDB:', error);
            alert('Ошибка при поиске: ' + error.message);
        }
    } finally {
        if (searchSequence === tmdbSearchSequence) hideLoading();
    }
}

function getRatingColor(rating) { if (rating >= 8) return '#4caf50'; if (rating >= 6) return '#ffc107'; if (rating >= 4) return '#ff9800'; return '#f44336'; }

function showGlobalSearchResults() { renderFilteredGlobalResults(globalSearchResults); }

function renderFilteredGlobalResults(results) {
    var searchResultsDiv = getEl('search-results');
    var searchOverlay = getEl('search-overlay');
    if (!searchResultsDiv) return;
    if (searchOverlay) searchOverlay.classList.remove('hidden');

    if (results.length === 0) {
        searchResultsDiv.innerHTML = '<div class="filter-stats">Всего найдено: <span>0</span></div><div class="search-result-empty">' + (currentSearchQuery ? 'Ничего не найдено для "' + escapeHtml(currentSearchQuery) + '" в TMDB' : 'Введите запрос для поиска') + '</div>';
        return;
    }

    // Ограничиваем рендер, чтобы не вешать DOM на слабых ТВ
    var limit = Math.min(results.length, 40);
    resetSearchVisibilityWindow();   // тут своя сетка карточек, списка больше нет
    searchResultsDiv.innerHTML = ''; // Очищаем безопасно

    var statsDiv = document.createElement('div');
    statsDiv.className = 'filter-stats';
    statsDiv.innerHTML = 'Найдено в TMDB: <span>' + results.length + '</span>' + (results.length > limit ? ' (показано ' + limit + ')' : '');
    searchResultsDiv.appendChild(statsDiv);

    var grid = document.createElement('div');
    grid.className = 'global-search-grid';
    grid.style.cssText = 'display: grid; grid-template-columns: repeat(5, 1fr); gap: 20px; padding: 20px 0;';

    var fragment = document.createDocumentFragment();

    for (var idx = 0; idx < limit; idx++) {
        var result = results[idx];
        var title = result.title || result.name || 'Без названия';
        var yearStr = (result.release_date || result.first_air_date) ? new Date(result.release_date || result.first_air_date).getFullYear() : 'N/A';
        var mediaType = result.media_type === 'tv' ? 'Сериал' : 'Фильм';
        var rating = result.vote_average ? result.vote_average.toFixed(1) : null;
        var posterUrl = result.poster_path ? buildTmdbPosterUrl(result.poster_path, 'w342') : null;

        var card = document.createElement('div');
        card.className = 'global-search-card';
        card.dataset.tmdbId = result.id;
        card.dataset.mediaType = result.mediaType;
        card.style.cssText = 'background: rgba(30, 30, 40, 0.9); border-radius: 12px; overflow: hidden; cursor: pointer; border: 1px solid rgba(74, 158, 255, 0.3);';

        var posterDiv = document.createElement('div');
        posterDiv.className = 'global-search-poster';
        posterDiv.style.cssText = 'position: relative; aspect-ratio: 2/3; overflow: hidden; background: linear-gradient(135deg, #1a1a2e, #16213e);';

        if (posterUrl) {
            var img = document.createElement('img');
            img.dataset.src = posterUrl; // Картинка не грузится сразу!
            img.alt = title;
            img.style.cssText = 'width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 0.3s;';
            img.className = 'lazy-poster';
            posterDiv.appendChild(img);
        } else {
            posterDiv.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; font-size: 48px;">' + mediaType + '</div>';
        }

        if (rating) {
            var ratingDiv = document.createElement('div');
            ratingDiv.style.cssText = 'position: absolute; top: 8px; right: 8px; background: rgba(0, 0, 0, 0.8); color: ' + getRatingColor(parseFloat(rating)) + '; font-weight: bold; font-size: 12px; padding: 4px 8px; border-radius: 12px; border: 1px solid ' + getRatingColor(parseFloat(rating)) + ';';
            ratingDiv.textContent = rating;
            posterDiv.appendChild(ratingDiv);
        }

        var infoDiv = document.createElement('div');
        infoDiv.className = 'global-search-info';
        infoDiv.style.cssText = 'padding: 12px;';
        infoDiv.innerHTML = '<div class="global-search-title" style="font-weight: 600; font-size: 14px; margin-bottom: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + escapeHtml(title) + '</div>' +
            '<div style="display: flex; justify-content: space-between; font-size: 12px; color: #aaa;"><span>' + mediaType + '</span><span>' + yearStr + '</span></div>';

        card.appendChild(posterDiv);
        card.appendChild(infoDiv);
        fragment.appendChild(card);
    }

    grid.appendChild(fragment);
    searchResultsDiv.appendChild(grid);

    // IntersectionObserver для ленивой загрузки картинок (поддерживается в Chrome 51+)
    if ('IntersectionObserver' in window) {
        var lazyImages = grid.querySelectorAll('.lazy-poster');
        var imageObserver = new IntersectionObserver(function (entries, observer) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    var img = entry.target;
                    img.src = img.dataset.src;
                    img.onload = function () { img.style.opacity = '1'; };
                    img.onerror = function () {
                        img.parentElement.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; font-size: 48px;">🎬</div>';
                    };
                    observer.unobserve(img);
                }
            });
        }, {
            rootMargin: '300px 0px' // Начинаем грузить за 300px до появления на экране
        });

        lazyImages.forEach(function (img) { imageObserver.observe(img); });
    } else {
        // Фоллбэк для совсем старых браузеров
        var lazyImages = grid.querySelectorAll('.lazy-poster');
        lazyImages.forEach(function (img) {
            img.src = img.dataset.src;
            img.onload = function () { img.style.opacity = '1'; };
        });
    }

    // Делегирование клика (вешается на grid, а не на каждую карточку)
    grid.onclick = function (e) {
        var card = e.target.closest('.global-search-card');
        if (card) {
            var tmdbId = card.dataset.tmdbId;
            var result = results.find(function (r) { return String(r.id) === tmdbId; });
            if (result) {
                AppState.isSearch = true;
                showGlobalSearchDetail(result);
            }
        }
    };
}

async function showGlobalSearchDetail(item) {
    var catalogItem = { id: item.id, media_type: item.media_type, title: item.title || item.name, name: item.name || item.title, overview: item.overview, poster_path: item.poster_path, backdrop_path: item.backdrop_path, vote_average: item.vote_average, release_date: item.release_date, first_air_date: item.first_air_date, torrent: [{ name: item.title || item.name }] };
    AppState.mediaType = item.media_type;
    var posterUrl = item.poster_path ? buildTmdbPosterUrl(item.poster_path, 'w342') : null;
    if (typeof window.showCatalogDetail === 'function') {
        AppState.searchReturnTo = 'search'; AppState.currentScreen = 'detail';
        await window.showCatalogDetail(catalogItem, 0, posterUrl);
        var searchOverlay = getEl('search-overlay'); if (searchOverlay) searchOverlay.classList.add('hidden');
    }
}

function showContentTypeFilter() {
    var filterGroup = document.querySelector('.filter-group'); if (!filterGroup) return;
    var contentTypeFilter = getEl('filter-content-type');
    if (!contentTypeFilter) {
        var newFilter = document.createElement('div'); newFilter.className = 'filter-group';
        newFilter.innerHTML = `<label class="filter-label" for="filter-content-type">Тип контента</label><select id="filter-content-type" class="filter-select"><option value="all">Все</option><option value="movie">Фильмы</option><option value="tv">Сериалы</option></select>`;
        var qualityFilter = getEl('filter-quality');
        if (qualityFilter && qualityFilter.parentNode) qualityFilter.parentNode.parentNode.insertBefore(newFilter, qualityFilter.parentNode.nextSibling);
        else filterGroup.parentNode.appendChild(newFilter);
        getEl('filter-content-type').addEventListener('change', function (e) { filterGlobalSearchByType(e.target.value); });
    }
}

function filterGlobalSearchByType(type) {
    if (!globalSearchResults.length) return;
    var filtered = type === 'all' ? globalSearchResults : globalSearchResults.filter(r => r.media_type === type);
    renderFilteredGlobalResults(filtered);
}

function clearSearchResultsContainer() { resetSearchVisibilityWindow(); var searchResultsDiv = getEl('search-results'); if (searchResultsDiv) searchResultsDiv.innerHTML = ''; }
window.clearSearchResultsContainer = clearSearchResultsContainer;

function initTorrentDelegations() {
    setupTorrentGridDelegation();
    setupFilePlayButtonDelegation();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTorrentDelegations);
} else {
    initTorrentDelegations();
}
