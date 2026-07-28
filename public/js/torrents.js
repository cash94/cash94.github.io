// Работа с TorrServer и торрентами

// Переменные для поиска
var searchResults = [];
var filteredResults = [];
var currentSearchQuery = '';
var currentSearchMode = 'globalsearch';
var globalSearchResults = [];

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
var torrentDeleteHoldTimers = new WeakMap();
var TORRENT_DELETE_HOLD_MS = 900;
var suppressTorrentClickUntil = 0;
var pendingRemoteHoldHash = null;

// Кэш
var progressCache = new Map();
var torrentFilesCache = new Map();

var SORT_OPTIONS = [
    { value: 'date-desc', label: 'Сначала новые' },
    { value: 'date-asc', label: 'Сначала старые' },
    { value: 'size-desc', label: 'Размер ↓' },
    { value: 'size-asc', label: 'Размер ↑' },
    { value: 'sid-desc', label: 'Сиды ↓' },
    { value: 'sid-asc', label: 'Си ды ↑' },
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

function getFilterOptions(type) {
    if (type === 'sort') return SORT_OPTIONS;
    if (type === 'quality') return QUALITY_OPTIONS;
    if (type === 'tracker') return getTrackerFilterOptions();
    return [];
}

function getCurrentFilterValue(type) {
    if (type === 'sort') return currentSort;
    if (type === 'quality') return currentQualityFilter;
    if (type === 'tracker') return currentTrackerFilter;
    return '';
}

function setCurrentFilterValue(type, value) {
    if (type === 'sort') currentSort = value;
    if (type === 'quality') currentQualityFilter = value;
    if (type === 'tracker') currentTrackerFilter = value;
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

function cycleFilterButton(filterType, direction = 1) {
    var options = getFilterOptions(filterType);
    if (!options.length) return;
    var currentValue = getCurrentFilterValue(filterType);
    var currentIndex = 0;
    for (var i = 0; i < options.length; i++) {
        if (options[i].value === currentValue) { currentIndex = i; break; }
    }
    var nextIndex = (currentIndex + direction + options.length) % options.length;
    setCurrentFilterValue(filterType, options[nextIndex].value);
    syncSearchFilterButtons();
    applyFiltersAndSort();
}

function toggleSearchFiltersPanel(forceOpen) {
    var panel = getEl('search-filters-panel');
    var toggleBtn = getEl('filter-toggle');
    if (!panel) return false;
    var shouldOpen = (forceOpen === undefined) ? panel.classList.contains('collapsed') : !!forceOpen;
    if (shouldOpen) {
        panel.classList.remove('collapsed');
        if (toggleBtn) toggleBtn.classList.add('active');
    } else {
        panel.classList.add('collapsed');
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

function clearTorrentDeleteHoldTimer(card) {
    var timer = torrentDeleteHoldTimers.get(card);
    if (timer) { clearTimeout(timer); torrentDeleteHoldTimers.delete(card); }
}

window.setTorrentClickSuppressed = function (ms = 1200) { suppressTorrentClickUntil = Date.now() + ms; };

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
            getEl('detail-view').style.display = 'none';
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
    if (!card || !torrent || !torrent.hash) return;
    var startHold = function (event) {
        if (event && event.target && event.target.closest && event.target.closest('button, input, select, textarea, a')) return;
        clearTorrentDeleteHoldTimer(card);
        var timer = setTimeout(async function () {
            suppressTorrentClickUntil = Date.now() + 1200;
            pendingRemoteHoldHash = null;
            card.dataset.suppressClick = '1';
            card.classList.remove('touch-active');
            await removeTorrentByHash(torrent.hash, { skipConfirm: true });
            setTimeout(function () { if (card) delete card.dataset.suppressClick; }, 1200);
        }, TORRENT_DELETE_HOLD_MS);
        torrentDeleteHoldTimers.set(card, timer);
    };
    var stopHold = function () { clearTorrentDeleteHoldTimer(card); };

    card.addEventListener('touchstart', startHold, { passive: true });
    card.addEventListener('touchend', stopHold);
    card.addEventListener('touchcancel', stopHold);
    card.addEventListener('touchmove', stopHold);
    card.addEventListener('mousedown', startHold);
    card.addEventListener('mouseup', stopHold);
    card.addEventListener('mouseleave', stopHold);

    card.addEventListener('click', function (e) {
        var shouldSuppress = card.dataset.suppressClick === '1' || Date.now() < suppressTorrentClickUntil;
        if (shouldSuppress) { e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation(); delete card.dataset.suppressClick; return false; }
    }, true);

    card.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        suppressTorrentClickUntil = Date.now() + 1200;
        card.dataset.suppressClick = '1';
        removeTorrentByHash(torrent.hash, { skipConfirm: true }).finally(function () {
            setTimeout(function () { if (card) delete card.dataset.suppressClick; }, 1200);
        });
    });
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

async function loadProgressForTorrent(torrent) {
    if (!torrent || !torrent.hash) return null;
    var cacheKey = torrent.hash;
    if (progressCache.has(cacheKey)) {
        var cached = progressCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp < 60000)) return cached.data;
    }
    try {
        var files = [];
        if (torrent.file_stats && Array.isArray(torrent.file_stats) && torrent.file_stats.length > 0) files = torrent.file_stats;
        if (files.length === 0 && AppState.currentTorrserverUrl) {
            var response = await torrServerFetch('/stream?link=' + cacheKey + '&stat=stat', { method: 'GET', headers: { 'accept': 'application/octet-stream' } });
            if (response.ok) {
                var apiData = await response.json();
                if (apiData.file_stats && Array.isArray(apiData.file_stats)) { files = apiData.file_stats; torrent.file_stats = files; }
                else if (apiData.data) {
                    try {
                        var parsedData = JSON.parse(apiData.data);
                        if (parsedData.TorrServer && parsedData.TorrServer.Files) { files = parsedData.TorrServer.Files; torrent.file_stats = files; }
                    } catch (e) { }
                }
            }
        }
        if (files.length > 0) {
            var videoFiles = files.filter(f => {
                var name = f.path.toLowerCase();
                return ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v'].some(ext => name.includes(ext));
            });
            if (videoFiles.length === 0) return null;

            var progressPromises = videoFiles.map((file, idx) => async () => {
                try {
                    var savedClientId = localStorage.getItem('clientId');
                    var res = await fetch(SERVER_URL + '/api/timecode/get?hash=' + torrent.hash + '&fileId=' + file.id + '&clientId=' + encodeURIComponent(savedClientId));
                    if (res.ok) {
                        var data = await res.json();
                        if (data.success && data.timecode > 0) {
                            return { hash: torrent.hash, fileId: file.id, timecode: data.timecode, duration: data.duration, index: idx, fileName: file.path.split('/').pop() };
                        }
                    }
                } catch (e) { console.error(e); }
                return null;
            });

            var results = await Promise.all(progressPromises.map(p => p()));
            var validProgress = results.filter(r => r !== null);
            if (validProgress.length > 0) {
                validProgress.sort((a, b) => b.index - a.index);
                var lastWatched = validProgress[0];
                var progress = {
                    hash: torrent.hash, fileId: lastWatched.fileId, timecode: lastWatched.timecode, duration: lastWatched.duration,
                    episodeIndex: lastWatched.index, totalEpisodes: videoFiles.length, episodeName: lastWatched.fileName, isSeries: true
                };
                progressCache.set(cacheKey, { data: progress, timestamp: Date.now() });
                return progress;
            }
        }
        return null;
    } catch (error) { console.error('Ошибка загрузки прогресса:', error); return null; }
}

async function addProgressToDetail(torrent) {
    if (!torrent || !torrent.hash) return null;

    var btn = getEl('detail-progress-btn');
    if (!btn) return null;

    // Чистим старые блоки (могли остаться от предыдущей версии)
    var oldProgressBlocks = document.querySelectorAll('#detail-progress');
    for (var i = 0; i < oldProgressBlocks.length; i++) oldProgressBlocks[i].remove();

    // Обработчик вешаем один раз — он читает dataset кнопки в момент клика,
    // поэтому при повторных вызовах showDetail дубли не накапливаются
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

    // === Состояние по умолчанию: «Играть» → первое видео (fileId = 1) ===
    btn.dataset.hash = torrent.hash;
    btn.dataset.fileId = '1';
    btn.dataset.timecode = '0';
    btn.dataset.episodeIndex = '0';
    btn.classList.remove('has-progress');
    btn.innerHTML = '<span class="btn-label">▶ Играть</span>';

    var progress = await loadProgressForTorrent(torrent);
    if (!progress || !(progress.timecode > 0)) return null; // прогресса нет — остаётся «Играть»

    // === Есть прогресс: «Продолжить» ===
    var fileId = parseInt(progress.fileId, 10) || 1;
    var timecode = progress.timecode;
    var episodeIndex = progress.episodeIndex || 0;

    var percent = progress.duration > 0 ? (timecode / progress.duration) * 100 : 0;
    var remaining = 100 - percent;
    var isNextFile = false;

    // Осталось ≤ 5% — запускаем следующий файл
    if (remaining <= 5) {
        var videoFiles = getVideoFilesFromTorrent(torrent);
        var nextFile = videoFiles.length ? videoFiles[episodeIndex + 1] : null;
        if (nextFile) {
            fileId = nextFile.id || (fileId + 1);
            timecode = 0;
            episodeIndex = episodeIndex + 1;
            isNextFile = true;
        } else if (progress.isSeries && episodeIndex + 1 < (progress.totalEpisodes || 0)) {
            fileId = fileId + 1; // фоллбэк, если список файлов ещё не загружен
            timecode = 0;
            episodeIndex = episodeIndex + 1;
            isNextFile = true;
        } else {
            timecode = 0; // это последний файл — начинаем с начала
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

    return fileId; // как и раньше — для логики фокуса в showDetail
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
                if (shouldLoadTorrents) await loadTorrents();
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
    var torrentsGrid = getEl('torrents-grid');
    if (!AppState.serverOnline) {
        var checked = await checkServer(false);
        if (!checked) {
            if (!silent) { alert('Сначала подключитесь к серверу'); getEl('config-screen').style.display = 'flex'; getEl('torrserver-section').style.display = 'none'; AppState.currentScreen = 'config'; }
            return;
        }
    }
    if (!silent) { showLoading('Загрузка торрентов...'); if (torrentsGrid) torrentsGrid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 40px;">Загрузка...</div>'; }
    try {
        var response = await torrServerFetch('/torrents', { method: 'POST', body: JSON.stringify({ action: 'list' }) });
        if (!response.ok) throw new Error('Ошибка загрузки: HTTP ' + response.status);
        var data = await response.json();
        AppState.torrents = Array.isArray(data) ? data : [];
        getEl('config-screen').style.display = 'none'; getEl('torrserver-section').style.display = 'block'; AppState.currentScreen = 'torrents'; AppState.inSearch = 'torrents';
        renderTorrents();
        if (AppState.currentScreen === 'torrents' && !document.querySelector('.torrent-card.focused')) {
            setTimeout(function () { if (typeof window.focusFirstTorrentCard === 'function') window.focusFirstTorrentCard(); }, 80);
        }
        return true;
    } catch (error) {
        console.error('Ошибка загрузки торрентов:', error);
        if (!silent && torrentsGrid) torrentsGrid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;"><div style="font-size: 16px; color: #ff6a6a;">Ошибка: ${error.message}</div><button class="btn" style="margin-top: 20px;" onclick="loadTorrents()">Попробовать снова</button></div>`;
        return false;
    } finally { if (!silent) hideLoading(); }
}

async function refreshTorrents(showLoadingFlag = true) {
    if (typeof progressCache !== 'undefined') progressCache.clear();
    return await loadTorrents(!showLoadingFlag);
}
window.refreshTorrents = refreshTorrents;

function renderTorrents() {
    var torrentsGrid = getEl('torrents-grid');
    torrentsGrid.innerHTML = '';
    progressCache.clear();
    if (AppState.torrents.length === 0) {
        torrentsGrid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;"><div style="font-size: 18px; color: #aaa; margin-bottom: 10px;">Нет торрентов</div><div style="font-size: 14px; color: #666;">Используйте поиск выше, чтобы найти и добавить торренты</div></div>`;
        return;
    }
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < AppState.torrents.length; i++) {
        var torrent = AppState.torrents[i];
        var poster = ''; var title = torrent.title || 'Без названия'; var category = torrent.category || ''; var isTv = false;
        try {
            if (torrent.file_stats && Array.isArray(torrent.file_stats) && torrent.file_stats.length > 0) isTv = torrent.file_stats.length > 1;
            else if (torrent.data) {
                var data = JSON.parse(torrent.data);
                if (data.TorrServer && data.TorrServer.Files && data.TorrServer.Files.length > 0) isTv = data.TorrServer.Files.length > 1;
                if (data.movie) poster = data.movie.img || (data.movie.poster_path ? 'https://image.tmdb.org/t/p/w342' + data.movie.poster_path : '');
            }
        } catch (e) { }
        if (!poster && torrent.poster) poster = torrent.poster;
        var displayCategory = isTv ? 'tv' : (category || 'movie');
        var card = document.createElement('div');
        card.className = 'torrent-card'; card.dataset.hash = torrent.hash;
        attachTorrentDeleteLongPress(card, torrent);
        var playStatus = torrent.stat_string === "Torrent working" ? '<span style="color: #4caf50; font-weight: bold;">▶ Идет просмотр</span>' : formatBytes(torrent.torrent_size);

        card.innerHTML = `
            <div class="torrent-poster">${poster ? `<img src="${poster}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'no-poster\\'>Нет постера</div>'">` : '<div class="no-poster">Нет постера</div>'}</div>
            <div class="torrent-info">
                <div class="torrent-title">${escapeHtml(title)}</div>
                <div class="torrent-meta">
                    <span>${playStatus}</span>
                    <span class="torrent-badge">${displayCategory === 'tv' ? 'Сериал' : 'Фильм'}</span>
                </div>
            </div>
        `;
        fragment.appendChild(card);
    }
    torrentsGrid.appendChild(fragment);

    // Делегирование событий
    torrentsGrid.onclick = function (e) {
        var card = e.target.closest('.torrent-card');
        if (card && card.dataset.hash) {
            var torrent = AppState.torrents.find(t => t.hash === card.dataset.hash);
            if (torrent) showDetail(torrent);
        }
    };

    if (AppState.currentScreen === 'torrents' && !document.querySelector('.torrent-card.focused')) {
        setTimeout(function () { if (typeof window.focusFirstTorrentCard === 'function') window.focusFirstTorrentCard(); }, 80);
    }
}

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
        if (!window.tmdbDetailsCache) window.tmdbDetailsCache = new Map();
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
}
window.resetDetailBackground = resetDetailBackground;

function extractSeasonsFromTitle(title) {
    if (!title) return [];
    var seasons = [];
    var rangePatterns = [/\[сезон\s*(\d+)\s*[-–]\s*(\d+)\]/i, /\[season\s*(\d+)\s*[-–]\s*(\d+)\]/i, /сезон\s*(\d+)\s*[-–]\s*(\d+)/i, /season\s*(\d+)\s*[-–]\s*(\d+)/i, /S(\d+)\s*[-–]\s*S?(\d+)/i];
    for (var p = 0; p < rangePatterns.length; p++) {
        var match = title.match(rangePatterns[p]);
        if (match && match[1] && match[2]) {
            for (var s = parseInt(match[1], 10); s <= parseInt(match[2], 10); s++) { if (seasons.indexOf(s) === -1) seasons.push(s); }
            return seasons.sort((a, b) => a - b);
        }
    }
    var listPatterns = [/\[сезон\s*([\d,\s]+)\]/i, /\[season\s*([\d,\s]+)\]/i, /сезон\s*([\d,\s]+)/i, /season\s*([\d,\s]+)/i, /S([\d,\s]+)/i];
    for (var p = 0; p < listPatterns.length; p++) {
        var match = title.match(listPatterns[p]);
        if (match && match[1]) {
            match[1].split(/[,\s]+/).forEach(part => { var num = parseInt(part, 10); if (!isNaN(num) && seasons.indexOf(num) === -1) seasons.push(num); });
            if (seasons.length > 0) break;
        }
    }
    if (seasons.length === 0) {
        var singlePatterns = [/\[сезон\s*(\d+)\]/i, /\[season\s*(\d+)\]/i, /сезон\s*(\d+)/i, /season\s*(\d+)/i, /S(\d+)/i];
        for (var p = 0; p < singlePatterns.length; p++) {
            var match = title.match(singlePatterns[p]);
            if (match && match[1]) { var singleNum = parseInt(match[1], 10); if (!isNaN(singleNum)) seasons.push(singleNum); break; }
        }
    }
    return seasons.sort((a, b) => a - b);
}

function cleanTitleFromSeasons(title, seasons) {
    if (!title) return title;
    var cleaned = title.replace(/[\sсезон\s[\d\s,-]+\s*]/gi, '').replace(/[\sseason\s[\d\s,-]+\s*]/gi, '').replace(/сезон\s*[\d\s,-]+/gi, '').replace(/season\s*[\d\s,-]+/gi, '').replace(/S\d+/gi, '').replace(/\s+/g, ' ').trim().replace(/[[]()-]/g, '').trim();
    return cleaned;
}

var seasonCache = new Map();
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
            if (data.poster_path) { var stillUrl = AppState.protocol + '//tsimg.hnar.online/t/p/w300' + data.poster_path; seasonCache.set(cacheKey, { data: stillUrl, timestamp: Date.now() }); return stillUrl; }
        }
    } catch (error) { console.error('Ошибка загрузки постера фильма:', error); }
    return null;
}

async function getTorrentFilesWithCache(torrent, forceRefresh = false) {
    var hash = torrent.hash; if (!hash) return [];
    if (!forceRefresh && torrentFilesCache.has(hash)) {
        var cached = torrentFilesCache.get(hash);
        if (Date.now() - cached.timestamp < 60 * 60 * 1000) return cached.files;
        else torrentFilesCache.delete(hash);
    }
    var files = [];
    if (torrent.file_stats && Array.isArray(torrent.file_stats) && torrent.file_stats.length > 0) files = torrent.file_stats;
    if (files.length === 0 && AppState.currentTorrserverUrl) {
        try {
            var response = await torrServerFetch('/stream?link=' + hash + '&index=1&stat=stat', { method: 'GET', headers: { 'accept': 'application/octet-stream' } });
            if (response.ok) {
                var apiData = await response.json();
                if (apiData.file_stats && Array.isArray(apiData.file_stats)) { files = apiData.file_stats; torrent.file_stats = files; }
                else if (apiData.data) {
                    try { var parsedData = JSON.parse(apiData.data); if (parsedData.TorrServer && parsedData.TorrServer.Files) { files = parsedData.TorrServer.Files; torrent.file_stats = files; } } catch (e) { }
                }
            }
        } catch (error) { console.error('Ошибка загрузки файлов:', error); }
    }
    torrentFilesCache.set(hash, { files: files, timestamp: Date.now() });
    return files;
}

function clearTorrentFilesCache(hash) { if (hash && torrentFilesCache.has(hash)) torrentFilesCache.delete(hash); }
function clearAllTorrentFilesCache() { torrentFilesCache.clear(); }

async function showDetail(torrent) {
    if (torrent && torrent.hash) window.lastSelectedTorrentHash = torrent.hash;
    if (typeof currentFocusIndex !== 'undefined') window.lastSelectedTorrentIndex = currentFocusIndex;
    resetDetailBackground();
    var mainContainer = getEl('main-container'); if (mainContainer) mainContainer.style.pointerEvents = 'none';
    AppState.currentScreen = 'detail';
    if (!window.AndroidJS) { AppState.detailReturnTo = 'torrents'; AppState.currentDetailItem = torrent; }
    else { if (AppState.playFromHash) { AppState.currentDetailItem = AppState.androidBackCatalog; AppState.detailReturnTo = 'catalog'; } else { AppState.detailReturnTo = 'torrents'; AppState.currentDetailItem = torrent; } }
    hideCatalogDetailExtra();
    var posterImg = getEl('detail-poster'); var titleEl = getEl('detail-title-text'); var filesList = getEl('files-list'); var detailSubtitle = getEl('detail-subtitle'); var detailViewDiv = getEl('detail-view');
    var dh = document.querySelector('.detail-header'); if (dh) dh.style.background = "rgba(0, 0, 0, 0.3)";
    if (filesList) { filesList.style.display = 'flex'; filesList.style.flexDirection = 'row'; }
    filesList.innerHTML = `<div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; gap: 15px;"><div class="spinner"></div><div style="font-size: 16px; color: #aaa;">Загрузка файлов...</div></div>`;
    if (typeof Animations !== 'undefined') Animations.animateDetailShow();
    var tmdbPromise = loadAllTmdbDataForTorrent(torrent, { titleEl: titleEl, detailViewDiv: detailViewDiv, detailSubtitle: detailSubtitle });
    titleEl.textContent = (torrent.title || 'Без названия').replace(/[\d+]/, '').trim();
    var oldProgressBlocks = document.querySelectorAll('#detail-progress');
    for (var i = 0; i < oldProgressBlocks.length; i++) {
        oldProgressBlocks[i].remove();
    }
    var lastField = await addProgressToDetail(torrent);
    try {
        var files = await getTorrentFilesWithCache(torrent, false);
        var poster = torrent.poster || '';
        if (!poster && torrent.data) { try { var data = JSON.parse(torrent.data); if (data.movie) poster = data.movie.img || (data.movie.poster_path ? 'https://image.tmdb.org/t/p/w342' + data.movie.poster_path : ''); } catch (e) { } }
        posterImg.innerHTML = poster ? `<img src="${poster}" alt="poster">` : '<div class="no-poster">Нет постера</div>';
        if (files.length === 0) { filesList.innerHTML = '<div style="text-align: center; padding: 20px; color: #aaa;">📁 Нет файлов</div>'; }
        else {
            var videoFiles = files.filter(f => { var n = f.path.split('/').pop().toLowerCase(); return ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v'].some(ext => n.includes(ext)); });
            filesList.innerHTML = '';
            var fragment = document.createDocumentFragment();
            for (var i = 0; i < videoFiles.length; i++) {
                var item = addFileItem(videoFiles[i], torrent.hash, videoFiles.length === 1 ? torrent.title : 'Серия ' + (i + 1), videoFiles.length === 1 ? null : i, null, true);
                if (item) fragment.appendChild(item);
            }
            filesList.appendChild(fragment);
            tmdbPromise.then(function (tmdbData) {
                if (tmdbData.cleanTitle && tmdbData.cleanTitle !== 'Без названия') titleEl.textContent = tmdbData.cleanTitle;
                if (tmdbData.seasonNumbers && tmdbData.seasonNumbers.length > 1) {
                    var seasonsText = titleEl.textContent;
                    if (!seasonsText.includes('сезон')) titleEl.textContent = seasonsText + ' [сезон ' + tmdbData.seasonNumbers.join(', ') + ']';
                }
                loadStillsAndUpdateFiles(tmdbData.seasonNumbers || [], tmdbData.allSeasonEpisodes || {}, tmdbData.movieStill, videoFiles.length);
            }).catch(function (error) { console.error('Ошибка загрузки TMDB данных:', error); });
        }
    } catch (e) { console.error('Ошибка:', e); filesList.innerHTML = `<div style="text-align: center; padding: 20px; color: #ff6a6a;">❌ Ошибка загрузки файлов: ${e.message}</div>`; }
    setTimeout(function () {
        if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
            updateFocusableElements();
            var fileItems = document.querySelectorAll('.file-item');
            if (fileItems.length > 0) {
                if (lastField > 0 && focusableElements[lastField + 1] && focusableElements[lastField + 1].classList.contains('file-item')) setFocus(lastField + 1);
                else { for (var i = 0; i < focusableElements.length; i++) { if (focusableElements[i].classList && focusableElements[i].classList.contains('file-item')) { setFocus(i); break; } } }
            } else setFocus(0);
        }
    }, 200);
    AppState.mediaType = "";
}

async function loadAllTmdbDataForTorrent(torrent, elements) {
    var cleanTitle = torrent.title || 'Без названия';
    var tmdbId = null; var seasonNumbers = [];
    var bracketMatch = cleanTitle.match(/\[(\d+)\]/);
    if (bracketMatch && bracketMatch[1]) { tmdbId = bracketMatch[1]; cleanTitle = cleanTitle.replace(/\[\d+\]/, '').trim(); }
    seasonNumbers = extractSeasonsFromTitle(cleanTitle);
    if (seasonNumbers.length > 0) cleanTitle = cleanTitleFromSeasons(cleanTitle, seasonNumbers);
    if (elements.titleEl) elements.titleEl.textContent = cleanTitle;
    var isTvSeries = false;
    try {
        if (torrent.file_stats && Array.isArray(torrent.file_stats) && torrent.file_stats.length > 1) isTvSeries = true;
        else if (torrent.data) { var data = JSON.parse(torrent.data); if (data.TorrServer && data.TorrServer.Files && data.TorrServer.Files.length > 1) isTvSeries = true; }
    } catch (e) { }
    var allSeasonEpisodes = {}; var movieStill = null;
    if (tmdbId && isTvSeries && seasonNumbers.length > 0) {
        seasonNumbers.forEach(seasonNum => {
            loadSeasonStills(tmdbId, seasonNum).then(function (episodes) {
                if (episodes && episodes.length > 0) { allSeasonEpisodes[seasonNum] = episodes; loadStillsAndUpdateFiles(seasonNumbers, allSeasonEpisodes, movieStill, getVideoFilesFromTorrent(torrent).length); }
            });
        });
    }
    if (tmdbId && !isTvSeries && seasonNumbers.length === 0) {
        loadMovieStill(tmdbId).then(function (still) { if (still) { movieStill = still; var fileItem = document.querySelector('.file-item'); if (fileItem) updateFileItemStill(fileItem, movieStill); } });
    }
    if (tmdbId) {
        var mediaType = isTvSeries ? 'tv' : 'movie';
        getTmdbDetailsWithCache(tmdbId, mediaType).then(function (details) {
            if (details) {
                // 1. Обработка фона (Backdrop)
                if (details.backdrop_path && elements.detailViewDiv) {
                    var backdropPath = AppState.protocol + '//tsimg.hnar.online/t/p/original' + details.backdrop_path;
                    elements.detailViewDiv.style.backgroundImage = 'url(' + backdropPath + ')';
                    elements.detailViewDiv.style.backgroundSize = 'cover';
                    elements.detailViewDiv.style.backgroundPosition = 'center';
                    elements.detailViewDiv.style.backgroundRepeat = 'no-repeat';

                    var existingOverlay = getEl('detail-backdrop-overlay');
                    if (!existingOverlay && elements.detailViewDiv) {
                        var overlay = document.createElement('div');
                        overlay.id = 'detail-backdrop-overlay';
                        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(255,255,255,0.08);box-shadow:0 4px 20px rgba(0,0,0,0.25);border-radius:14.89px;z-index:-1;';
                        elements.detailViewDiv.appendChild(overlay);
                    }
                }

                // 2. Обработка Описания (Overview / Subtitle) - СНИМАЕМ hidden!
                if (details.overview) {
                    if (elements.detailSubtitle) {
                        elements.detailSubtitle.textContent = details.overview;
                        elements.detailSubtitle.style.display = 'block';
                        elements.detailSubtitle.classList.remove('hidden');
                    }
                    var overviewEl = getEl('catalog-detail-overview');
                    if (overviewEl) {
                        overviewEl.textContent = details.overview;
                        overviewEl.style.display = 'block';
                        overviewEl.classList.remove('hidden');
                    }
                }

                // 3. Обработка метаданных (Жанры, год, рейтинг)
                if (typeof updateDetailMetaInfo === 'function') {
                    updateDetailMetaInfo(details);
                }
            }
        });
    }
    AppState.isSerials = isTvSeries;
    if (seasonNumbers.length == 1 && isTvSeries) { AppState.currentTMDB = tmdbId; AppState.currentSeason = seasonNumbers[0]; }
    return { tmdbId: tmdbId, cleanTitle: cleanTitle, seasonNumbers: seasonNumbers, isTvSeries: isTvSeries, allSeasonEpisodes: allSeasonEpisodes, movieStill: movieStill };
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
        metaContainer.classList.remove('hidden');
    }
}

function addFileItem(file, hash, name, episodeIndex, stillImage, returnOnly = false) {
    var fileName = file.path.split('/').pop() || ('Файл ' + file.id);
    var fileExt = fileName.split('.').pop().toLowerCase();
    if (!['mkv', 'mp4', 'avi', 'mov', 'webm', 'm4v'].includes(fileExt)) return null;
    var item = document.createElement('div'); item.className = 'file-item'; item.dataset.hash = hash; item.dataset.fileId = file.id;
    if (episodeIndex !== undefined && episodeIndex !== null) item.dataset.episodeIndex = episodeIndex;
    item.innerHTML = `
        <div class="file-content"><button class="play-btn" data-hash="${hash}" data-file-id="${file.id}" data-episode-index="${episodeIndex !== undefined ? episodeIndex : ''}">▶</button></div>
        <div class="file-info"><div class="file-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div><div class="file-size">${formatBytes(file.length)}</div></div>
        <div class="file-progress-container" style="width:100%;height:3px;background:rgba(255,255,255,0.2);border-radius:0 0 12px 12px;overflow:hidden;position:absolute;bottom:0;left:0;"><div class="file-progress-fill" style="width:0%;height:100%;background:#ff8c00;transition:width 0.2s ease;"></div></div>
    `;
    item.querySelector('.play-btn').onclick = function (e) {
        e.stopPropagation();
        var playUrl = file.id ? AppState.currentTorrserverUrl + '/play/' + hash + '/' + file.id : AppState.currentTorrserverUrl + '/play/' + hash + '/1';
        getEl('playback-overlay').classList.add('active'); getEl('detail-view').style.pointerEvents = 'none';
        startHLSPlayback(playUrl, 0, false, episodeIndex).finally(function () { getEl('playback-overlay').classList.remove('active'); getEl('detail-view').style.pointerEvents = 'auto'; });
    };
    if (stillImage) item.dataset.pendingStill = stillImage;
    loadProgressForFileItem(item, hash, file.id, episodeIndex);
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
            (function (item, url, index) { setTimeout(function () { updateFileItemStill(item, AppState.protocol + '//tsimg.hnar.online/t/p/w300' + url); }, index * 30); })(fileItems[i], allStillsInOrder[i].stillPath, i);
        }
    } else if (totalVideoFiles === 1 && movieStill) {
        var fileItem = document.querySelector('.file-item'); if (fileItem) setTimeout(function () { updateFileItemStill(fileItem, movieStill); }, 100);
    }
}

async function loadPendingStills() {
    var fileItems = document.querySelectorAll('.file-item');
    for (var i = 0; i < fileItems.length; i++) {
        var item = fileItems[i]; var stillImage = item.dataset.pendingStill;
        if (stillImage && !item.querySelector('.file-still-container')) {
            (function (fileItem, imgUrl) {
                setTimeout(function () {
                    var stillContainer = document.createElement('div'); stillContainer.className = 'file-still-container';
                    var img = document.createElement('img'); img.src = imgUrl; img.onerror = function () { this.parentElement.style.display = 'none'; };
                    stillContainer.appendChild(img);
                    var overlay = document.createElement('div'); overlay.className = 'file-overlay';
                    var placeholder = fileItem.querySelector('.file-still-placeholder'); if (placeholder) placeholder.remove();
                    fileItem.insertBefore(stillContainer, fileItem.firstChild); fileItem.insertBefore(overlay, stillContainer.nextSibling);
                    stillContainer.style.opacity = '0'; stillContainer.style.transition = 'opacity 0.3s ease'; setTimeout(function () { stillContainer.style.opacity = '1'; }, 10);
                    delete fileItem.dataset.pendingStill;
                }, i * 50);
            })(item, stillImage);
        }
    }
}

async function loadProgressForFileItem(item, hash, fileId, episodeIndex) {
    if (!item || !hash) return;
    var cacheKey = hash;
    if (progressCache.has(cacheKey)) {
        var cached = progressCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp < 60000)) {
            var cachedProgress = cached.data;
            var fileProgress = null;
            if (cachedProgress.isSeries && cachedProgress.fileId == fileId) fileProgress = cachedProgress;
            else if (!cachedProgress.isSeries && fileId === '1') fileProgress = cachedProgress;
            if (fileProgress && fileProgress.timecode > 0 && fileProgress.duration > 0) {
                var progressPercent = Math.min((fileProgress.timecode / fileProgress.duration) * 100, 98);
                var progressFill = item.querySelector('.file-progress-fill');
                if (progressFill) { progressFill.style.width = progressPercent + '%'; if (progressPercent > 5) { progressFill.style.opacity = '1'; item.classList.add('has-progress'); } }
                item.dataset.progressTimecode = fileProgress.timecode; item.dataset.progressDuration = fileProgress.duration;
                return;
            }
        }
    }
    try {
        var savedClientId = localStorage.getItem('clientId');
        var response = await fetch(SERVER_URL + '/api/timecode/get?hash=' + hash + '&fileId=' + fileId + '&clientId=' + encodeURIComponent(savedClientId));
        if (response.ok) {
            var data = await response.json();
            if (data.success && data.timecode > 0 && data.duration > 0) {
                var progressPercent = Math.min((data.timecode / data.duration) * 100, 98);
                var progressFill = item.querySelector('.file-progress-fill');
                if (progressFill) { progressFill.style.width = progressPercent + '%'; if (progressPercent > 5) { progressFill.style.opacity = '1'; item.classList.add('has-progress'); } }
                item.dataset.progressTimecode = data.timecode; item.dataset.progressDuration = data.duration;
                if (!progressCache.has(cacheKey)) progressCache.set(cacheKey, { data: { hash: hash, fileId: fileId, timecode: data.timecode, duration: data.duration, episodeIndex: episodeIndex || 0, isSeries: episodeIndex !== undefined && episodeIndex !== null }, timestamp: Date.now() });
            }
        }
    } catch (error) { console.error('Ошибка загрузки прогресса для файла:', error); }
}

function addMovieItem(torrent) {
    var filesList = getEl('files-list'); filesList.innerHTML = '';
    var item = document.createElement('div'); item.className = 'file-item';
    item.innerHTML = `<div class="file-name"><div>${escapeHtml(torrent.title || 'Фильм')}</div><div style="font-size: 12px; color: #888; margin-top: 4px;">${formatBytes(torrent.torrent_size)}</div></div><button class="play-btn" data-hash="${torrent.hash}">▶</button>`;
    item.querySelector('.play-btn').onclick = function (e) {
        e.stopPropagation();
        var playUrl = AppState.currentTorrserverUrl + '/play/' + torrent.hash + '/1';
        getEl('playback-overlay').classList.add('active'); getEl('detail-view').style.pointerEvents = 'none';
        startHLSPlayback(playUrl, 0, false).finally(function () { getEl('playback-overlay').classList.remove('active'); getEl('detail-view').style.pointerEvents = 'auto'; });
    };
    filesList.appendChild(item);
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
    getEl('torrserver-section').style.display = 'none'; searchOverlay.classList.remove('hidden'); searchTab.classList.add('active'); torrentsTab.classList.remove('active'); if (catalogTab) catalogTab.classList.remove('active');
    AppState.currentScreen = 'search'; syncSearchFilterButtons(); toggleSearchFiltersPanel(false);
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
    getEl('torrserver-section').style.display = 'block'; searchOverlay.classList.add('hidden'); searchTab.classList.remove('active'); getEl('search-results').innerHTML = ''; toggleSearchFiltersPanel(false);
    if (returnTo === 'detail') {
        AppState.currentScreen = 'detail'; var mainContainer = getEl('main-container'); if (mainContainer && AppState.backupScroll > 0) mainContainer.scrollTop = AppState.backupScroll;
        if (catalogTab) catalogTab.classList.remove('active'); torrentsTab.classList.remove('active');
        var detailView = getEl('detail-view'); if (detailView && detailView.style.display !== 'block') { detailView.style.display = 'block'; detailView.style.zIndex = '100'; detailView.style.pointerEvents = 'auto'; }
        setTimeout(function () {
            if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
                updateFocusableElements(); var watchBtn = getEl('catalog-watch-btn'); if (watchBtn) { for (var i = 0; i < focusableElements.length; i++) { if (focusableElements[i].id === 'catalog-watch-btn') { setFocus(i); return; } } }
            }
            if (typeof window.ensureCatalogDetailFocus === 'function') window.ensureCatalogDetailFocus(true);
        }, 100);
    } else if (returnTo === 'catalog') {
        if (catalogTab) catalogTab.classList.add('active'); torrentsTab.classList.remove('active'); AppState.currentScreen = 'catalog';
        setTimeout(function () { if (typeof window.focusCatalogCardByIndex === 'function') { var savedIndex = localStorage.getItem('lastCatalogCardIndex'); window.focusCatalogCardByIndex(parseInt(savedIndex || 0)); } else if (typeof window.focusFirstCatalogCard === 'function') window.focusFirstCatalogCard(); }, 80);
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
}

function resetFilters() {
    currentSort = 'date-desc'; currentQualityFilter = 'all'; currentTrackerFilter = 'all'; currentYearFilter = ''; currentSeasonFilter = 'all'; currentVoiceFilter = 'all'; currentvideotypeFilter = 'all';
    syncSearchFilterButtons();
    ['filter-year', 'filter-season', 'filter-voice', 'filter-videotype'].forEach(id => { var el = getEl(id); if (el) el.value = 'all'; });
    applyFiltersAndSort();
}

function initYearFilter() {
    var yearFilter = getEl('filter-year');
    if (yearFilter) yearFilter.addEventListener('change', function (e) { currentYearFilter = e.target.value === 'all' ? '' : e.target.value; applyFiltersAndSort(); });
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
    var { refreshList = true } = options;
    if (!AppState.currentTorrserverUrl) { alert('Сначала подключитесь к TorrServer'); return null; }
    var poster = window.pendingCatalogPoster || null;
    if (!poster && searchResult) poster = await tmdb.findPosterFromSearchResult(searchResult);
    var torrname = '';
    //if (AppState.mediaType === 'tv' && searchResult && searchResult.seasons && searchResult.seasons.length > 0) {
    if (searchResult && searchResult.seasons && searchResult.seasons.length > 0) {
        var seasons = searchResult.seasons;
        AppState.mediaType = 'tv';
        torrname = `[${catalogState.lastSelectedId}] ${searchResult.name} [сезон ${seasons.length > 1 ? seasons[0] + '-' + seasons[seasons.length - 1] : seasons[0]}]`;
    } else {
        AppState.mediaType = 'movie';
        torrname = `[${catalogState.lastSelectedId}] ${searchResult ? searchResult.name : 'Без названия'}`;
    }
    var requestBody = { action: 'add', link: magnet, title: torrname, save_to_db: AppState.addToDbEnabled };
    if (poster) requestBody.poster = poster;
    try {
        var response = await torrServerFetch('/torrents', { method: 'POST', body: JSON.stringify(requestBody) });
        if (!response.ok) throw new Error('Ошибка добавления: ' + response.status);
        if (window.AndroidJS && !AppState.isCatalogSerials) return true;
        await response.json();
        window.pendingCatalogPoster = null; window.pendingCatalogItem = null; lastAddedTorrentHash = hash.toLowerCase();
        if (refreshList) { // && !window.AndroidJS) {
            await refreshTorrentsList();
            return AppState.torrents.find(t => t.hash && t.hash.toLowerCase() === lastAddedTorrentHash) || true;
        }
        return true;
    } catch (error) {
        console.error('❌ Ошибка добавления торрента:', error); alert('Ошибка при добавлении торрента: ' + error.message);
        window.pendingCatalogPoster = null; window.pendingCatalogItem = null; return null;
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
            if (!window.AndroidJS || !AppState.isCatalogSearch || AppState.isCatalogSerials) renderTorrents();
            if (!window.AndroidJS && !AppState.playFromHash && AppState.currentScreen === 'torrents') {
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
    if (window.addToWatchHistory && AppState.pendingDetailItem && AppState.pendingDetailItem.id) {
        await window.addToWatchHistory(String(AppState.pendingDetailItem.id), currentSearchQuery, AppState.pendingDetailItem.media_type, AppState.pendingDetailPoster || null);
    }
    getEl('playback-overlay').classList.add('active'); document.querySelector('.playback-text').textContent = 'Поиск постера и добавление...';
    try {
        var isSerial = AppState.mediaType === "tv" || (searchResult && searchResult.types && Array.isArray(searchResult.types) && searchResult.types.includes('serial'));
        if (isSerial) AppState.isCatalogSerials = true;
        AppState.isCatalogSearch = true;
        var addedTorrent = await addTorrentToServer(magnet, hash, searchResult);
        if (!addedTorrent) {
            await refreshTorrentsList();
            addedTorrent = AppState.torrents.find(t => (t.hash || '').toLowerCase() === hash.toLowerCase());
        }
        if (!window.AndroidJS) { AppState.currentDetailItem = addedTorrent; if (typeof clearDetailHistory === 'function') clearDetailHistory(); }
        if (!isSerial) {
            var fileId = 1;
            if (window.AndroidJS) {
                getEl('playback-overlay').classList.remove('active');
                var playURL = AppState.currentTorrserverUrl + "/stream?link=" + hash + "&index=" + fileId + "&play=play";
                AndroidJS.openPlayer(playURL, JSON.stringify({ url: playURL, title: addedTorrent.title || 'Видео', iptv: false, timeline: { hash: hash + '_' + fileId, time: 0, duration: 0, percent: 0 } }));
                return true;
            }
            var playbackTarget = getPreferredPlaybackFile(addedTorrent, searchResult);
            fileId = playbackTarget.fileId || 1;
            document.querySelector('.playback-text').textContent = 'Воспроизведение...';
            var playUrl = AppState.currentTorrserverUrl + '/play/' + hash + '/' + fileId;
            hideSearchResults(); AppState.inSearch = "torrents";
            await startHLSPlayback(playUrl, null, true, playbackTarget.episodeIndex);
        } else {
            AppState.androidBackCatalog = AppState.currentDetailItem; AppState.currentDetailItem = addedTorrent; AppState.isCatalogSerials = true;
            hideSearchResults(); AppState.inSearch = window.AndroidJS ? "catalog" : "torrents";
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

function renderSearchResults() {
    var searchResultsDiv = getEl('search-results');
    if (!searchResultsDiv) return;

    if (filteredResults.length === 0) {
        searchResultsDiv.innerHTML = '<div class="filter-stats">Всего найдено: <span>' + searchResults.length + '</span></div><div class="search-result-empty">' + (currentSearchQuery ? 'Нет результатов по фильтрам для "' + escapeHtml(currentSearchQuery) + '"' : 'Введите запрос для поиска') + '</div>';
        return;
    }

    var html = '<div class="filter-stats">Показано: <span>' + filteredResults.length + '</span> из <span>' + searchResults.length + '</span></div>';

    for (var idx = 0; idx < filteredResults.length; idx++) {
        var result = filteredResults[idx];
        var voices = Array.isArray(result.voices) ? result.voices : [];
        var hash = extractHashFromMagnet(result.magnet);

        // 🆕 TRACKER: выводим ПОЛНОСТЬЮ как есть (например "bitru, rutor")
        var trackerDisplay = result.tracker || 'Unknown';

        var resultJsonEncoded = encodeURIComponent(JSON.stringify(result));

        html += '<div class="search-result-item" data-index="' + idx + '">' +
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
            (voices.length > 0 ? '<div class="search-result-voices">' + voices.map(function (v) { return '<span class="search-result-voice">' + escapeHtml(v) + '</span>'; }).join('') + '</div>' : '') +
            '</div>' +
            '<button class="search-result-play" data-hash="' + hash + '" data-magnet="' + escapeHtml(result.magnet) + '" data-result="' + resultJsonEncoded + '" ' + (!hash ? 'disabled' : '') + '>' + (hash ? '▶' : '❌ Нет hash') + '</button>' +
            '</div>';
    }

    searchResultsDiv.innerHTML = html;

    // Делегирование событий
    searchResultsDiv.onclick = function (e) {
        var playBtn = e.target.closest('.search-result-play');
        if (playBtn && !playBtn.disabled) {
            e.stopPropagation();
            var hash = playBtn.dataset.hash;
            var magnet = playBtn.dataset.magnet;
            var resultJsonEncoded = playBtn.dataset.result;
            if (hash) {
                var searchResult = null;
                if (resultJsonEncoded) {
                    try {
                        searchResult = JSON.parse(decodeURIComponent(resultJsonEncoded));
                        if (window.pendingCatalogPoster) searchResult.poster = window.pendingCatalogPoster;
                    } catch (e) { }
                }
                if (window.AndroidJS) AppState.playFromHash = true;
                playFromHash(hash, magnet, searchResult);
            }
        } else {
            var item = e.target.closest('.search-result-item');
            if (item) {
                var btn = item.querySelector('.search-result-play');
                if (btn && !btn.disabled) btn.click();
            }
        }
    };
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
    showLoading('Поиск в TMDB...');
    try {
        var encodedQuery = encodeURIComponent(query.trim());
        var moviesResponse = await fetch('/api/tmdb/search?query=' + encodedQuery + '&type=movie&year=');
        var tvResponse = await fetch('/api/tmdb/search?query=' + encodedQuery + '&type=tv&year=');
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
    } catch (error) { console.error('Ошибка поиска в TMDB:', error); alert('Ошибка при поиске: ' + error.message); } finally { hideLoading(); }
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
        var posterUrl = result.poster_path ? AppState.protocol + '//tsimg.hnar.online/t/p/w342' + result.poster_path : null;

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
    var posterUrl = item.poster_path ? AppState.protocol + '//tsimg.hnar.online/t/p/w342' + item.poster_path : null;
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

function clearSearchResultsContainer() { var searchResultsDiv = getEl('search-results'); if (searchResultsDiv) searchResultsDiv.innerHTML = ''; }
window.clearSearchResultsContainer = clearSearchResultsContainer;
