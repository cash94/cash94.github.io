// catalog.js - Модуль для работы с каталогами фильмов/сериалов

// Конфигурация каталогов
var CATALOG_CONFIG = {
    movie: {
        name: 'Фильмы',
        url: SERVER_URL + '/api/catalog/movie',
        mediaType: 'movie'
    },
    quadhd: {
        name: 'Фильмы в 4K',
        url: SERVER_URL + '/api/catalog/quadhd',
        mediaType: 'movie'
    },
    legends: {
        name: 'Лучшие фильмы',
        url: SERVER_URL + '/api/catalog/legends',
        mediaType: 'movie'
    },
    tv: {
        name: 'Сериалы',
        url: SERVER_URL + '/api/catalog/tv',
        mediaType: 'tv'
    },
    cartoons: {
        name: 'Мультфильмы',
        url: SERVER_URL + '/api/catalog/cartoons',
        mediaType: 'movie'
    },
    cartoons_tv: {
        name: 'Мультсериалы',
        url: SERVER_URL + '/api/catalog/cartoons_tv',
        mediaType: 'tv'
    },
    anime: {
        name: 'Аниме',
        url: SERVER_URL + '/api/catalog/anime',
        mediaType: 'tv'
    },
    history: {
        name: 'История',
        url: null,
        mediaType: 'history',
        isHistory: true
    }
};

// ==================== TMDB КЭШ ====================

// Кэш для TMDB запросов
var tmdbCache = {};

// Конфигурация кэша TMDB
var TMDB_CACHE_CONFIG = {
    ttl: 3600000, // 1 час в миллисекундах
    maxSize: 500, // Максимальное количество записей в кэше
    cleanupInterval: 300000, // Очистка каждые 5 минут
    enabled: true // Включен ли кэш
};

// Функция для получения ключа кэша
function getTmdbCacheKey(endpoint, params) {
    var sortedKeys = Object.keys(params).sort();
    var sortedParams = {};
    for (var i = 0; i < sortedKeys.length; i++) {
        var key = sortedKeys[i];
        sortedParams[key] = params[key];
    }
    return endpoint + ':' + JSON.stringify(sortedParams);
}

// Функция для получения данных из кэша TMDB
function getFromTmdbCache(endpoint, params) {
    if (!TMDB_CACHE_CONFIG.enabled) return null;

    var cacheKey = getTmdbCacheKey(endpoint, params);
    var cached = tmdbCache[cacheKey];

    if (cached && Date.now() - cached.timestamp < TMDB_CACHE_CONFIG.ttl) {
        console.log('📦 TMDB кэш: HIT для ' + endpoint, params);
        return cached.data;
    }

    if (cached) {
        console.log('⏰ TMDB кэш: EXPIRED для ' + endpoint, params);
        delete tmdbCache[cacheKey];
    }

    return null;
}

// Функция для сохранения данных в кэш TMDB
function saveToTmdbCache(endpoint, params, data) {
    if (!TMDB_CACHE_CONFIG.enabled) return;

    var cacheKey = getTmdbCacheKey(endpoint, params);

    var keys = Object.keys(tmdbCache);
    if (keys.length >= TMDB_CACHE_CONFIG.maxSize) {
        console.log('🧹 TMDB кэш: достигнут лимит ' + TMDB_CACHE_CONFIG.maxSize + ', очистка старых записей');
        cleanOldTmdbCache();
    }

    tmdbCache[cacheKey] = {
        data: data,
        timestamp: Date.now(),
        endpoint: endpoint,
        params: params
    };

    console.log('💾 TMDB кэш: SAVE для ' + endpoint, params);
}

// Функция очистки старых записей из кэша TMDB
function cleanOldTmdbCache() {
    var now = Date.now();
    var deletedCount = 0;

    var keys = Object.keys(tmdbCache);
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var value = tmdbCache[key];
        if (now - value.timestamp >= TMDB_CACHE_CONFIG.ttl) {
            delete tmdbCache[key];
            deletedCount++;
        }
    }

    keys = Object.keys(tmdbCache);
    if (keys.length >= TMDB_CACHE_CONFIG.maxSize) {
        var sortedEntries = [];
        for (var key in tmdbCache) {
            if (tmdbCache.hasOwnProperty(key)) {
                sortedEntries.push({ key: key, timestamp: tmdbCache[key].timestamp });
            }
        }
        sortedEntries.sort(function (a, b) { return a.timestamp - b.timestamp; });

        var toDelete = keys.length - TMDB_CACHE_CONFIG.maxSize + 10;
        for (var j = 0; j < toDelete && j < sortedEntries.length; j++) {
            delete tmdbCache[sortedEntries[j].key];
            deletedCount++;
        }
    }

    if (deletedCount > 0) {
        console.log('🧹 TMDB кэш: удалено ' + deletedCount + ' устаревших записей');
    }
}

// Функция для очистки всего кэша TMDB
function clearTmdbCache() {
    var size = Object.keys(tmdbCache).length;
    tmdbCache = {};
    console.log('🗑️ TMDB кэш: полностью очищен (' + size + ' записей)');
}

// Функция для получения информации о кэше TMDB
function getTmdbCacheStats() {
    var now = Date.now();
    var validCount = 0;
    var expiredCount = 0;
    var totalSize = 0;

    var keys = Object.keys(tmdbCache);
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var value = tmdbCache[key];
        totalSize += JSON.stringify(value.data).length;
        if (now - value.timestamp < TMDB_CACHE_CONFIG.ttl) {
            validCount++;
        } else {
            expiredCount++;
        }
    }

    return {
        totalEntries: keys.length,
        validEntries: validCount,
        expiredEntries: expiredCount,
        totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
        maxSize: TMDB_CACHE_CONFIG.maxSize,
        ttlHours: TMDB_CACHE_CONFIG.ttl / 3600000,
        enabled: TMDB_CACHE_CONFIG.enabled
    };
}

// ==================== СОСТОЯНИЕ КАТАЛОГА ====================

// Состояние каталогов
var catalogState = {
    currentCatalog: null,
    items: [],
    totalItems: 0,
    loading: false,
    loadingMore: false,
    selectedCatalog: null,
    lastSelectedIndex: 0,
    lastSelectedId: null,
    abortController: null,

    currentPage: 0,
    itemsPerPage: 8,
    hasMore: true,
    isLoadingMore: false,
    loadedItemIds: {},

    loadedPostersCount: 0,
    postersPerBatch: 16,
    isPosterLoading: false,
    posterLoadQueue: [],
    posterObserver: null,
    loadMoreObserver: null,

    posterCache: {}
};

// Кэш для загруженных каталогов
var catalogCache = new Map();

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

function abortCatalogRequests() {
    if (catalogState.abortController) {
        console.log('🛑 Отмена всех запросов каталога');
        catalogState.abortController.abort();
        catalogState.abortController = null;
    }

    if (catalogState.posterObserver) {
        catalogState.posterObserver.disconnect();
        catalogState.posterObserver = null;
    }

    if (catalogState.loadMoreObserver) {
        catalogState.loadMoreObserver.disconnect();
        catalogState.loadMoreObserver = null;
    }
}

function getRatingColor(rating) {
    if (rating >= 8) return '#4caf50';
    if (rating >= 6) return '#ffc107';
    if (rating >= 4) return '#ff9800';
    return '#f44336';
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function (m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function formatDuration(seconds) {
    if (!seconds) return '';
    var mins = Math.floor(seconds / 60);
    var secs = Math.floor(seconds % 60);
    return mins + ':' + (secs.toString().length === 1 ? '0' + secs : secs);
}

async function fetchJsonWithTimeout(url, timeout, options) {
    if (timeout === undefined) timeout = 6000;
    if (options === undefined) options = {};
    var controller = new AbortController();
    var timeoutId = setTimeout(function () { controller.abort(); }, timeout);
    try {
        var response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
            throw new Error('HTTP ' + response.status);
        }
        return await response.json();
    } finally {
        clearTimeout(timeoutId);
    }
}

// ==================== TMDB ФУНКЦИИ С КЭШИРОВАНИЕМ ====================

// Функция для загрузки актеров из TMDB с кэшированием
async function fetchCatalogActors(item) {
    var tmdbId = item && item.id ? item.id : null;
    var mediaType = (item && item.media_type) || 'movie';

    if (!tmdbId) return [];

    var cacheParams = { id: tmdbId, type: mediaType };

    var cachedActors = getFromTmdbCache('actors', cacheParams);
    if (cachedActors !== null) {
        return cachedActors;
    }

    try {
        var url = '/api/tmdb/details?id=' + encodeURIComponent(tmdbId) + '&type=' + encodeURIComponent(mediaType);

        var response = await fetch(url, {
            signal: AbortSignal.timeout(5000)
        });

        if (!response.ok) {
            throw new Error('HTTP ' + response.status);
        }

        var data = await response.json();

        var actors = [];
        if (data.cast && Array.isArray(data.cast)) {
            for (var i = 0; i < Math.min(12, data.cast.length); i++) {
                var actor = data.cast[i];
                actors.push({
                    id: actor.id,
                    name: actor.name,
                    character: actor.character,
                    profilePath: actor.profile_path,
                    order: actor.order
                });
            }
        }

        saveToTmdbCache('actors', cacheParams, actors);
        return actors;
    } catch (error) {
        console.error('❌ Ошибка загрузки актеров:', error);
        return [];
    }
}

// Функция для загрузки деталей TMDB с кэшированием
async function fetchTmdbDetails(item) {
    var tmdbId = item && item.id ? item.id : null;
    var mediaType = (item && item.media_type) || 'movie';

    if (!tmdbId) return null;

    var cacheParams = { id: tmdbId, type: mediaType };

    var cachedDetails = getFromTmdbCache('details', cacheParams);
    if (cachedDetails !== null) {
        return cachedDetails;
    }

    var candidates = [
        '/api/tmdb/details?id=' + encodeURIComponent(tmdbId) + '&type=' + encodeURIComponent(mediaType),
        '/api/tmdb/item?id=' + encodeURIComponent(tmdbId) + '&type=' + encodeURIComponent(mediaType)
    ];

    for (var i = 0; i < candidates.length; i++) {
        var url = candidates[i];
        try {
            var data = await fetchJsonWithTimeout(url, 5000);
            if (data && (data.id || data.overview || data.videos || data.images || data.backdrops)) {
                saveToTmdbCache('details', cacheParams, data);
                return data;
            }
        } catch (error) {
            console.warn('TMDB details fetch skipped:', url, error && error.message || error);
        }
    }
    return null;
}

function mergeCatalogDetails(base) {
    var merged = {};
    for (var key in base) {
        if (base.hasOwnProperty(key)) {
            merged[key] = base[key];
        }
    }

    for (var i = 1; i < arguments.length; i++) {
        var source = arguments[i];
        if (!source || typeof source !== 'object') continue;
        for (var key in source) {
            if (source.hasOwnProperty(key)) {
                var value = source[key];
                if (value === null || value === undefined) continue;
                if (Array.isArray(value)) {
                    if (!Array.isArray(merged[key]) || merged[key].length === 0) merged[key] = value.slice();
                    continue;
                }
                if (typeof value === 'string') {
                    if (!merged[key] || !String(merged[key]).trim()) merged[key] = value;
                    continue;
                }
                if (typeof value === 'number') {
                    if (!merged[key]) merged[key] = value;
                    continue;
                }
                if (typeof value === 'object') {
                    if (!merged[key]) merged[key] = {};
                    for (var subKey in value) {
                        if (value.hasOwnProperty(subKey)) {
                            merged[key][subKey] = value[subKey];
                        }
                    }
                }
            }
        }
    }
    return merged;
}

async function fetchCatalogItemDetails(item) {
    var cacheParams = {
        id: item && item.id ? item.id : null,
        media_type: (item && item.media_type) || 'movie',
        title: getCatalogItemTitle(item)
    };

    var cachedDetails = getFromTmdbCache('itemDetails', cacheParams);
    if (cachedDetails !== null) {
        return cachedDetails;
    }

    var tmdbDetails = await fetchTmdbDetails(item);
    var merged = mergeCatalogDetails(item, tmdbDetails);

    saveToTmdbCache('itemDetails', cacheParams, merged);
    return merged;
}

var TMDB_GENRES = {
    movie: { 28: "Боевик", 12: "Приключения", 16: "Анимация", 35: "Комедия", 80: "Криминал", 99: "Документальный", 18: "Драма", 10751: "Семейный", 14: "Фэнтези", 36: "История", 27: "Ужасы", 10402: "Музыка", 9648: "Детектив", 10749: "Мелодрама", 878: "Фантастика", 10770: "ТВ фильм", 53: "Триллер", 10752: "Военный", 37: "Вестерн" },
    tv: { 10759: "Боевик", 16: "Анимация", 35: "Комедия", 80: "Криминал", 99: "Документальный", 18: "Драма", 10751: "Семейный", 10762: "Детский", 9648: "Детектив", 10763: "Новости", 10764: "Реалити", 10765: "Фантастика", 10766: "Мыльная опера", 10767: "Ток-шоу", 10768: "Война и политика", 37: "Вестерн" }
};

function getCatalogItemTitle(item) {
    var torrentName = (item && item.torrent && item.torrent[0]) ? item.torrent[0].name : null;
    return torrentName || (item && (item.title || item.name)) || 'Без названия';
}

function getCatalogItemYear(item) {
    var raw = (item && (item.release_date || item.first_air_date || item.year || item.released || item.relased)) || null;
    if (!raw) return null;
    var match = String(raw).match(/(19|20)\d{2}/);
    return match ? match[0] : null;
}

function getGenreNames(item, mediaType) {
    if (mediaType === undefined) mediaType = 'movie';
    var names = [];
    if (item && Array.isArray(item.genres)) {
        for (var i = 0; i < item.genres.length; i++) {
            var g = item.genres[i];
            var name = typeof g === 'string' ? g : (g && g.name);
            if (name) names.push(name);
        }
    }
    if (!names.length && item && Array.isArray(item.genre_ids)) {
        var map = TMDB_GENRES[mediaType] || TMDB_GENRES.movie;
        for (var j = 0; j < item.genre_ids.length; j++) {
            var id = item.genre_ids[j];
            if (map[id]) names.push(map[id]);
        }
    }
    var result = [];
    for (var k = 0; k < names.length; k++) {
        if (names[k]) result.push(names[k]);
    }
    return result;
}

function getCatalogRating(item) {
    var val = Number(item && item.vote_average);
    return Number.isFinite(val) && val > 0 ? (Math.round(val * 10) / 10).toFixed(1) : '';
}

function getNormalizedCatalogGenres(source) {
    if (!source) return [];
    var list = [];
    var mediaType = (source.media_type || (source.types && source.types.indexOf('tv') !== -1) ? 'tv' : 'movie') === 'tv' ? 'tv' : 'movie';
    var genreMap = TMDB_GENRES[mediaType] || TMDB_GENRES.movie;

    if (Array.isArray(source.genres)) {
        for (var i = 0; i < source.genres.length; i++) {
            var g = source.genres[i];
            var value = (g && g.name) || g;
            if (value) list.push(String(value).trim());
        }
    }

    if (Array.isArray(source.genre_ids)) {
        for (var j = 0; j < source.genre_ids.length; j++) {
            var id = source.genre_ids[j];
            var mapped = genreMap[Number(id)] || genreMap[id];
            if (mapped) list.push(String(mapped).trim());
        }
    }

    if (source.genre) list.push(String(source.genre).trim());
    if (source.genre_name) list.push(String(source.genre_name).trim());

    var unique = [];
    for (var k = 0; k < list.length; k++) {
        if (list[k] && unique.indexOf(list[k]) === -1) unique.push(list[k]);
    }
    return unique;
}

function getSafeCatalogRating(source) {
    var raw = Number((source && source.vote_average) || (source && source.rating) || (source && source.tmdb_rating));
    if (!Number.isFinite(raw) || raw <= 0 || raw > 10) return null;
    return Math.round(raw * 10) / 10;
}

function getCatalogItemSubtitle(item, details) {
    if (details === undefined) details = null;
    var source = details || item || {};
    var year = getCatalogItemYear(source);
    var type = ((item && item.media_type) || source.media_type || 'movie') === 'tv' ? 'Сериал' : 'Фильм';
    var genres = getNormalizedCatalogGenres(source);
    var primaryGenre = genres[0] || '';
    var parts = [];
    if (type) parts.push(type);
    if (year) parts.push(year);
    if (primaryGenre) parts.push(primaryGenre);
    return parts.join(' • ');
}

async function fetchCatalogItemMeta(item, mediaType) {
    if (mediaType === undefined) mediaType = 'movie';
    var title = getCatalogItemTitle(item);
    var year = getCatalogItemYear(item);

    var cacheParams = {
        title: title,
        year: year,
        mediaType: mediaType,
        tmdbId: item && item.id
    };

    var cachedMeta = getFromTmdbCache('itemMeta', cacheParams);
    if (cachedMeta !== null) {
        return cachedMeta;
    }

    var best = {};
    for (var key in item) {
        if (item.hasOwnProperty(key)) {
            best[key] = item[key];
        }
    }

    try {
        var url = '/api/tmdb/search?query=' + encodeURIComponent(title) + '&type=' + mediaType;
        if (year) url += '&year=' + year;

        var response = await fetch(url);
        if (response.ok) {
            var data = await response.json();
            if (Array.isArray(data && data.results) && data.results.length) {
                var found = null;
                for (var i = 0; i < data.results.length; i++) {
                    if (String(data.results[i].id) === String(item && item.id)) {
                        found = data.results[i];
                        break;
                    }
                }
                best = found || data.results[0];
            }
        }
    } catch (e) {
        console.warn('Не удалось догрузить метаданные каталога:', e);
    }

    var meta = {
        raw: best,
        overview: (best && best.overview) || (item && item.overview) || '',
        posterPath: (best && best.poster_path) || (item && item.poster_path) || null,
        backdropPath: (best && best.backdrop_path) || (item && item.backdrop_path) || null,
        rating: getCatalogRating(best || item),
        genres: getGenreNames(best || item, mediaType),
        year: getCatalogItemYear(best || item) || year
    };

    saveToTmdbCache('itemMeta', cacheParams, meta);
    return meta;
}

// ==================== ЗАГРУЗКА КАТАЛОГА ====================

async function loadCatalog(catalogKey) {
    if (!CATALOG_CONFIG[catalogKey]) {
        console.error('❌ Неизвестный каталог:', catalogKey);
        return;
    }

    abortCatalogRequests();

    catalogState.abortController = new AbortController();
    var signal = catalogState.abortController.signal;

    var config = CATALOG_CONFIG[catalogKey];

    catalogState.currentCatalog = catalogKey;
    catalogState.items = [];
    catalogState.totalItems = 0;
    catalogState.currentPage = 0;
    catalogState.hasMore = true;
    catalogState.isLoadingMore = false;
    catalogState.loadedItemIds = {};
    catalogState.loadedPostersCount = 0;
    catalogState.posterLoadQueue = [];
    AppState.mediaType = config.mediaType;

    showCatalogLoading('Загрузка ' + config.name + '...');

    if (catalogCache.has(catalogKey)) {
        var cached = catalogCache.get(catalogKey);
        if (Date.now() - cached.timestamp < 3600000) {
            console.log('📦 Используем кэшированный каталог ' + catalogKey);

            catalogState.items = cached.data.items || [];
            catalogState.totalItems = cached.data.totalItems || catalogState.items.length;
            catalogState.currentPage = cached.data.currentPage || 0;
            catalogState.hasMore = cached.data.hasMore || false;

            for (var i = 0; i < catalogState.items.length; i++) {
                var item = catalogState.items[i];
                if (item.id) catalogState.loadedItemIds[item.id] = true;
            }

            catalogState.loading = false;
            hideCatalogLoading();
            renderCatalogGrid();
            catalogState.abortController = null;
            return;
        }
    }

    await loadMoreCatalogItems(true);
    catalogState.abortController = null;
}

// Загрузка истории просмотра
async function loadHistoryCatalog() {
    console.log('📜 Загрузка истории просмотра...');

    abortCatalogRequests();

    catalogState.currentCatalog = 'history';
    catalogState.items = [];
    catalogState.totalItems = 0;
    catalogState.currentPage = 0;
    catalogState.hasMore = false; // История не пагинируется
    catalogState.isLoadingMore = false;
    catalogState.loadedItemIds = {};
    catalogState.loadedPostersCount = 0;
    catalogState.posterLoadQueue = [];
    AppState.mediaType = 'history';

    showCatalogLoading('Загрузка истории просмотра...');

    try {
        // Получаем историю с сервера
        const response = await fetch(SERVER_URL + '/api/history');
        const data = await response.json();

        if (data.success && data.history && data.history.length > 0) {
            // Конвертируем историю в формат, совместимый с каталогом
            const historyItems = data.history.map((item, index) => {
                return {
                    id: item.tmdbId,
                    title: item.title,
                    name: item.title,
                    media_type: item.mediaType,
                    poster_path: item.posterPath ? item.posterPath.split('/').pop() : null,
                    vote_average: null, // Можно добавить рейтинг если есть
                    overview: null, // Можно загрузить детали если нужно
                    release_date: item.watchedAt ? item.watchedAt.split('T')[0] : null,
                    watchedAt: item.watchedAt,
                    timestamp: item.timestamp,
                    isHistoryItem: true,
                    historyIndex: index
                };
            });

            // Сортируем по времени просмотра (новые сверху)
            historyItems.sort((a, b) => b.timestamp - a.timestamp);

            catalogState.items = historyItems;
            catalogState.totalItems = historyItems.length;
            catalogState.hasMore = false;

            console.log(`📜 Загружено ${catalogState.items.length} элементов истории`);

            // Сохраняем в кэш
            catalogCache.set('history', {
                data: {
                    items: catalogState.items.slice(),
                    totalItems: catalogState.totalItems,
                    currentPage: 1,
                    hasMore: false
                },
                timestamp: Date.now()
            });

            renderCatalogGrid();
        } else {
            // История пуста
            catalogState.items = [];
            catalogState.totalItems = 0;
            showEmptyHistory();
        }
    } catch (error) {
        console.error('❌ Ошибка загрузки истории:', error);
        showCatalogError('Не удалось загрузить историю просмотра');
    }

    hideCatalogLoading();
    catalogState.abortController = null;
}

// Показать пустую историю
function showEmptyHistory() {
    var torrentsGrid = document.getElementById('torrents-grid');
    if (!torrentsGrid) return;

    torrentsGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">
            <div style="font-size: 64px; margin-bottom: 20px;">📜</div>
            <div style="font-size: 18px; color: #aaa; margin-bottom: 10px;">История просмотра пуста</div>
            <div style="font-size: 14px; color: #666;">Фильмы и сериалы, которые вы посмотрите, появятся здесь</div>
        </div>
    `;
}

// Очистить историю
async function clearHistory() {
    if (!confirm('Вы уверены, что хотите очистить всю историю просмотра?')) {
        return;
    }

    try {
        const response = await fetch(SERVER_URL + '/api/history/clear', {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            console.log('✅ История очищена');
            // Перезагружаем историю
            await loadHistoryCatalog();
        } else {
            alert('Ошибка очистки истории');
        }
    } catch (error) {
        console.error('❌ Ошибка очистки истории:', error);
        alert('Ошибка очистки истории: ' + error.message);
    }
}

async function loadMoreCatalogItems(reset) {
    if (reset === undefined) reset = false;
    if (!catalogState.currentCatalog || catalogState.isLoadingMore) return Promise.resolve(false);

    if (reset) {
        catalogState.currentPage = 0;
        catalogState.items = [];
        catalogState.loadedItemIds = {};
        catalogState.hasMore = true;
        catalogState.totalItems = 0;
    }

    if (!catalogState.hasMore) {
        console.log('🏁 Все элементы каталога загружены');
        return Promise.resolve(false);
    }

    catalogState.isLoadingMore = true;

    var config = CATALOG_CONFIG[catalogState.currentCatalog];
    var from = catalogState.currentPage * catalogState.itemsPerPage;

    console.log('📥 Загрузка элементов ' + from + ' - ' + (from + catalogState.itemsPerPage) + ' из каталога ' + catalogState.currentCatalog);

    try {
        var url = config.url + '/items?from=' + from + '&limit=' + catalogState.itemsPerPage;
        console.log('🌐 Запрос: ' + url);

        var fetchOptions = {};
        if (catalogState.abortController) {
            fetchOptions.signal = catalogState.abortController.signal;
        }
        var response = await fetch(url, fetchOptions);

        if (!response.ok) {
            throw new Error('HTTP ' + response.status);
        }

        var data = await response.json();

        if (!data.success) {
            throw new Error('Сервер вернул ошибку');
        }

        var newItems = data.items || [];
        var pagination = data.pagination || {};

        if (pagination.total) {
            catalogState.totalItems = pagination.total;
        }

        if (pagination.hasMore !== undefined) {
            catalogState.hasMore = pagination.hasMore;
        } else {
            catalogState.hasMore = newItems.length === catalogState.itemsPerPage;
        }

        console.log('📊 Получено ' + newItems.length + ' элементов. Всего в каталоге: ' + (catalogState.totalItems || '?'));

        var uniqueNewItems = [];
        for (var i = 0; i < newItems.length; i++) {
            var item = newItems[i];
            if (!item.id) {
                uniqueNewItems.push(item);
                continue;
            }
            if (catalogState.loadedItemIds[item.id] === true) {
                console.log('⚠️ Дубликат элемента ' + item.id + ' пропущен');
                continue;
            }
            catalogState.loadedItemIds[item.id] = true;
            uniqueNewItems.push(item);
        }

        for (var j = 0; j < uniqueNewItems.length; j++) {
            catalogState.items.push(uniqueNewItems[j]);
        }
        catalogState.currentPage++;

        console.log('✅ Загружено ' + uniqueNewItems.length + ' новых элементов. Всего: ' + catalogState.items.length + '/' + (catalogState.totalItems || '?') + ' (еще: ' + catalogState.hasMore + ')');

        if (reset) {
            renderCatalogGrid();
        } else {
            appendCatalogItems(uniqueNewItems);
        }

        catalogCache.set(catalogState.currentCatalog, {
            data: {
                items: catalogState.items.slice(),
                totalItems: catalogState.totalItems,
                currentPage: catalogState.currentPage,
                hasMore: catalogState.hasMore
            },
            timestamp: Date.now()
        });

        return Promise.resolve(true);

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('📴 Загрузка элементов отменена');
        } else {
            console.error('❌ Ошибка загрузки элементов:', error);
            console.log('⚠️ Пробуем загрузить все элементы (fallback)');
            await fallbackLoadAllCatalogItems();
        }
        return Promise.resolve(false);
    } finally {
        catalogState.isLoadingMore = false;
    }
}

async function fallbackLoadAllCatalogItems() {
    if (!catalogState.currentCatalog) return;

    console.log('📥 Fallback: загрузка всех элементов каталога');

    var config = CATALOG_CONFIG[catalogState.currentCatalog];
    var url = config.url + '/items';

    try {
        var fetchOptions = {};
        if (catalogState.abortController) {
            fetchOptions.signal = catalogState.abortController.signal;
        }
        var response = await fetch(url, fetchOptions);

        if (!response.ok) throw new Error('HTTP ' + response.status);

        var data = await response.json();
        if (!data.success) throw new Error('Сервер вернул ошибку');

        var allItems = data.items || [];

        catalogState.items = [];
        for (var i = 0; i < allItems.length; i++) {
            catalogState.items.push(allItems[i]);
        }
        catalogState.totalItems = allItems.length;
        catalogState.hasMore = false;
        catalogState.currentPage = 1;

        catalogState.loadedItemIds = {};
        for (var j = 0; j < allItems.length; j++) {
            var item = allItems[j];
            if (item.id) catalogState.loadedItemIds[item.id] = true;
        }

        console.log('✅ Fallback: загружено ' + allItems.length + ' элементов');
        renderCatalogGrid();

        catalogCache.set(catalogState.currentCatalog, {
            data: {
                items: catalogState.items.slice(),
                totalItems: catalogState.totalItems,
                currentPage: 1,
                hasMore: false
            },
            timestamp: Date.now()
        });

    } catch (error) {
        console.error('❌ Ошибка fallback загрузки:', error);
        showCatalogError('Ошибка загрузки каталога');
    }
}

// ==================== ОТОБРАЖЕНИЕ КАТАЛОГА ====================

function renderCatalogGrid() {
    var torrentsGrid = document.getElementById('torrents-grid');
    if (!torrentsGrid) return;

    torrentsGrid.innerHTML = '';

    if (catalogState.items.length === 0) {
        showEmptyCatalog();
        return;
    }

    addCatalogHeader(torrentsGrid);

    for (var i = 0; i < catalogState.items.length; i++) {
        var item = catalogState.items[i];
        var card = createCatalogCard(item, i);
        torrentsGrid.appendChild(card);
    }

    if (catalogState.hasMore) {
        addLoadMoreTrigger(torrentsGrid);
    }

    catalogState.loadedPostersCount = 0;
    initPosterLazyLoading();
    initLoadMoreObserver();
    loadInitialPosters();

    setTimeout(function () {
        if (AppState.currentScreen === 'catalog' && catalogState.currentCatalog) {
            if (typeof updateFocusableElements === 'function') {
                updateFocusableElements();
            }
            setTimeout(function () {
                if (typeof window.focusFirstCatalogCard === 'function') {
                    window.focusFirstCatalogCard();
                }
            }, 100);
        }
    }, 200);
}

function appendCatalogItems(newItems) {
    var torrentsGrid = document.getElementById('torrents-grid');
    if (!torrentsGrid) return;

    var oldTrigger = document.getElementById('load-more-trigger');
    if (oldTrigger) oldTrigger.remove();

    var startIndex = catalogState.items.length - newItems.length;

    for (var offset = 0; offset < newItems.length; offset++) {
        var item = newItems[offset];
        var index = startIndex + offset;
        var card = createCatalogCard(item, index);
        torrentsGrid.appendChild(card);
    }

    if (catalogState.hasMore) {
        addLoadMoreTrigger(torrentsGrid);
    }

    updatePosterObservers();
    initLoadMoreObserver();

    if (AppState.currentScreen === 'catalog' && catalogState.currentCatalog) {
        if (typeof updateFocusableElements === 'function') {
            updateFocusableElements();
        }
    }
}

function createCatalogCard(item, index) {
    var title = getCatalogItemTitle(item);
    var mediaType = item.media_type || 'movie';
    var tmdbId = item.id;

    var rating = null;
    if (item.vote_average) {
        rating = Math.round(item.vote_average * 10) / 10;
    }

    var card = document.createElement('div');
    card.className = 'torrent-card catalog-card';
    card.dataset.catalogIndex = index;
    card.dataset.title = title;
    card.dataset.mediaType = mediaType;
    card.dataset.tmdbId = tmdbId;
    card.dataset.itemId = item.id;
    card.dataset.rating = rating;
    card.dataset.numIndex = item.num_index !== undefined ? item.num_index : index;

    var cacheKey = tmdbId + '_' + mediaType;
    var cachedPoster = catalogState.posterCache[cacheKey];

    var ratingHtml = '';
    if (rating) {
        var ratingColor = getRatingColor(rating);
        ratingHtml = '<div class="rating-badge" style="position: absolute; top: 8px; right: 8px; background: rgba(0, 0, 0, 0.8); color: ' + ratingColor + '; font-weight: bold; font-size: 14px; padding: 4px 8px; border-radius: 12px; z-index: 10; border: 1px solid ' + ratingColor + '; box-shadow: 0 2px 8px rgba(0,0,0,0.3); backdrop-filter: blur(2px);">' + rating + '</div>';
    }

    var posterHtml = '';
    if (cachedPoster) {
        posterHtml = '<img src="' + cachedPoster + '" loading="lazy" style="width: 100%; height: 100%; object-fit: cover;">';
    } else {
        posterHtml = '<div class="no-poster catalog-poster-loading">⏳</div>';
    }

    card.innerHTML = '\n        <div class="torrent-poster" style="position: relative;">\n            ' + ratingHtml + '\n            ' + posterHtml + '\n        </div>\n        <div class="torrent-info">\n            <div class="torrent-title">' + escapeHtml(title.substring(0, 60)) + (title.length > 60 ? '...' : '') + '</div>\n            <div class="torrent-meta">\n                <span>' + (mediaType === 'tv' ? 'Сериал' : 'Фильм') + '</span>\n                <span class="torrent-badge catalog-badge">Каталог</span>\n            </div>\n        </div>\n    ';

    card.addEventListener('click', function () {
        if (catalogState.currentCatalog) {
            onCatalogItemClick(item, index);
        }
    });

    return card;
}

// Функция для форматирования даты
function formatLastModifiedDate(lastModifiedISO) {
    if (!lastModifiedISO) return 'Дата неизвестна';

    const date = new Date(lastModifiedISO);
    const now = new Date();
    const diffHours = (now - date) / (1000 * 60 * 60);

    // Форматируем дату
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');

    let timeAgo = '';
    if (diffHours < 1) {
        const minutesAgo = Math.floor(diffHours * 60);
        timeAgo = `${minutesAgo} мин. назад`;
    } else if (diffHours < 24) {
        timeAgo = `${Math.floor(diffHours)} ч. назад`;
    } else {
        const daysAgo = Math.floor(diffHours / 24);
        timeAgo = `${daysAgo} дн. назад`;
    }

    return `${day}.${month}.${year} ${hours}:${minutes} (${timeAgo})`;
}

// Функция для проверки и обновления устаревшего каталога
async function checkAndUpdateCatalogIfNeeded(catalogId, lastModifiedISO) {
    if (!lastModifiedISO) return false;

    const lastModified = new Date(lastModifiedISO);
    const now = new Date();
    const hoursDiff = (now - lastModified) / (1000 * 60 * 60);

    // Если прошло более 6 часов
    if (hoursDiff > 6) {
        console.log(`🔄 Каталог ${catalogId} устарел (${Math.floor(hoursDiff)} ч.), обновляем...`);

        try {
            const response = await fetch(`${SERVER_URL}/api/catalog/${catalogId}/update`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    console.log(`✅ Каталог ${catalogId} успешно обновлен`);

                    // Очищаем кэш каталога
                    if (catalogCache.has(catalogId)) {
                        catalogCache.delete(catalogId);
                    }

                    // Если это текущий каталог, перезагружаем его
                    if (catalogState.currentCatalog === catalogId) {
                        console.log(`🔄 Перезагружаем обновленный каталог ${catalogId}`);
                        setTimeout(() => {
                            loadCatalog(catalogId);
                        }, 500);
                    }

                    return true;
                }
            }
        } catch (error) {
            console.error(`❌ Ошибка обновления каталога ${catalogId}:`, error);
        }
    }

    return false;
}

// Модифицированная функция addCatalogHeader
function addCatalogHeader(grid) {
    var headerElement = document.createElement('div');
    headerElement.className = 'catalog-header';
    headerElement.style.cssText = `
        grid-column: 1 / -1;
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 20px;
        padding: 15px 20px;
        background: rgba(74, 158, 255, 0.1);
        border-radius: 16px;
        border: 1px solid rgba(74, 158, 255, 0.3);
        flex-wrap: wrap;
        gap: 10px;
    `;

    var currentCatalogName = (CATALOG_CONFIG[catalogState.currentCatalog] &&
        CATALOG_CONFIG[catalogState.currentCatalog].name) || 'Каталог';

    // Специальная обработка для истории
    if (catalogState.currentCatalog === 'history') {
        headerElement.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 5px;">
                <span style="font-size: 20px; font-weight: 600; color: #4a9eff;">${currentCatalogName}</span>
                <div style="display: flex; gap: 15px; font-size: 12px; color: #aaa;">
                    <span>${catalogState.items.length} записей</span>
                </div>
            </div>
            <button id="clear-history-btn" style="
                background: rgba(244, 67, 54, 0.2);
                border: 1px solid #f44336;
                color: #f44336;
                padding: 8px 16px;
                border-radius: 20px;
                cursor: pointer;
                font-size: 14px;
                transition: all 0.3s;
            " onmouseover="this.style.background='rgba(244, 67, 54, 0.4)'" 
               onmouseout="this.style.background='rgba(244, 67, 54, 0.2)'">
                Очистить историю
            </button>
        `;

        var clearBtn = document.getElementById('clear-history-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                clearHistory();
            });
        }

        grid.appendChild(headerElement);
        return;
    }

    // Стандартный заголовок для других каталогов
    fetch(`${SERVER_URL}/api/catalogs`)
        .then(response => response.json())
        .then(async data => {
            if (data.success && data.catalogs) {
                const catalogInfo = data.catalogs.find(c => c.id === catalogState.currentCatalog);

                if (catalogInfo && catalogInfo.lastModifiedISO) {
                    const formattedDate = formatLastModifiedDate(catalogInfo.lastModifiedISO);
                    await checkAndUpdateCatalogIfNeeded(catalogInfo.id, catalogInfo.lastModifiedISO);

                    headerElement.innerHTML = `
                        <div style="display: flex; flex-direction: column; gap: 5px;">
                            <span style="font-size: 20px; font-weight: 600; color: #4a9eff;">${currentCatalogName}</span>
                            <div style="display: flex; gap: 15px; font-size: 12px; color: #aaa;">
                                <span>${formattedDate}</span>
                            </div>
                        </div>
                        <span style="font-size: 14px; color: #aaa; background: rgba(0,0,0,0.3); padding: 5px 12px; border-radius: 20px;">
                            ${catalogState.items.length} / ${catalogState.totalItems || catalogState.items.length}
                        </span>
                    `;
                } else {
                    headerElement.innerHTML = `
                        <span style="font-size: 20px; font-weight: 600; color: #4a9eff;">${currentCatalogName}</span>
                        <span style="font-size: 14px; color: #aaa; background: rgba(0,0,0,0.3); padding: 5px 12px; border-radius: 20px;">
                            ${catalogState.items.length} / ${catalogState.totalItems || catalogState.items.length}
                        </span>
                    `;
                }
            } else {
                headerElement.innerHTML = `
                    <span style="font-size: 20px; font-weight: 600; color: #4a9eff;">${currentCatalogName}</span>
                    <span style="font-size: 14px; color: #aaa; background: rgba(0,0,0,0.3); padding: 5px 12px; border-radius: 20px;">
                        ${catalogState.items.length} / ${catalogState.totalItems || catalogState.items.length}
                    </span>
                `;
            }
        })
        .catch(error => {
            console.error('Ошибка загрузки информации о каталоге:', error);
            headerElement.innerHTML = `
                <span style="font-size: 20px; font-weight: 600; color: #4a9eff;">${currentCatalogName}</span>
                <span style="font-size: 14px; color: #aaa; background: rgba(0,0,0,0.3); padding: 5px 12px; border-radius: 20px;">
                    ${catalogState.items.length} / ${catalogState.totalItems || catalogState.items.length}
                </span>
            `;
        });

    grid.appendChild(headerElement);
}

function addLoadMoreTrigger(grid) {
    var trigger = document.createElement('div');
    trigger.id = 'load-more-trigger';
    trigger.className = 'load-more-trigger';
    trigger.style.cssText = '\n        grid-column: 1 / -1;\n        height: 50px;\n        margin: 20px 0;\n        display: flex;\n        align-items: center;\n        justify-content: center;\n        color: #aaa;\n        font-size: 14px;\n    ';
    trigger.innerHTML = '\n        <div class="loading-spinner-small" style="width: 20px; height: 20px; border: 2px solid rgba(74,158,255,0.2); border-top-color: #4a9eff; border-radius: 50%; animation: spinner-rotate 1s infinite; margin-right: 10px; display: none;"></div>\n        <span>Загрузка дополнительных элементов...</span>\n    ';
    grid.appendChild(trigger);
}

function showEmptyCatalog() {
    var torrentsGrid = document.getElementById('torrents-grid');
    if (!torrentsGrid) return;

    torrentsGrid.innerHTML = '\n        <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">\n            <div style="font-size: 48px; margin-bottom: 20px;"></div>\n            <div style="font-size: 18px; color: #aaa;">Каталог пуст</div>\n        </div>\n    ';
}

function initLoadMoreObserver() {
    if (catalogState.loadMoreObserver) {
        catalogState.loadMoreObserver.disconnect();
    }

    var trigger = document.getElementById('load-more-trigger');
    if (!trigger) return;

    catalogState.loadMoreObserver = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            if (entry.isIntersecting && catalogState.hasMore && !catalogState.isLoadingMore) {
                console.log('📦 Триггер видим, загружаем следующую страницу');

                var spinner = trigger.querySelector('.loading-spinner-small');
                if (spinner) spinner.style.display = 'inline-block';

                loadMoreCatalogItems()['finally'](function () {
                    if (spinner) spinner.style.display = 'none';
                });
            }
        }
    }, {
        root: null,
        rootMargin: '200px',
        threshold: 0.1
    });

    catalogState.loadMoreObserver.observe(trigger);
}

// ==================== ПОСТЕРЫ С ЛЕНИВОЙ ЗАГРУЗКОЙ ====================

// Функция для проверки наличия постера в кэше
function hasPosterInCache(cacheKey) {
    return catalogState.posterCache[cacheKey] !== undefined;
}

// Функция получения постера из кэша
function getPosterFromCache(cacheKey) {
    return catalogState.posterCache[cacheKey];
}

// Функция сохранения постера в кэш
function setPosterToCache(cacheKey, posterUrl) {
    catalogState.posterCache[cacheKey] = posterUrl;
}

function loadInitialPosters() {
    var initialIndices = [];

    for (var i = 0; i < Math.min(catalogState.postersPerBatch, catalogState.items.length); i++) {
        var item = catalogState.items[i];
        if (!item) continue;

        var cacheKey = item.id + '_' + (item.media_type || 'movie');

        if (catalogState.posterCache[cacheKey] === undefined) {
            initialIndices.push(i);
        }
    }

    if (initialIndices.length > 0) {
        console.log('🖼️ Загрузка начальных ' + initialIndices.length + ' постеров');
        loadPosterBatch(initialIndices);
    }
}

function initPosterLazyLoading() {
    if (catalogState.posterObserver) {
        catalogState.posterObserver.disconnect();
    }

    catalogState.posterObserver = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            if (entry.isIntersecting) {
                var card = entry.target;
                var index = parseInt(card.dataset.catalogIndex);
                var item = catalogState.items[index];

                if (!item) continue;

                var cacheKey = item.id + '_' + (item.media_type || 'movie');

                if (catalogState.posterCache[cacheKey] === undefined && !isPosterInQueue(index)) {
                    addToPosterQueue(index);
                }
            }
        }
    }, {
        root: null,
        rootMargin: '200px',
        threshold: 0.1
    });

    var cards = document.querySelectorAll('.torrent-card.catalog-card');
    for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        if (!card) continue;

        var item = catalogState.items[i];
        if (!item) continue;

        var cacheKey = item.id + '_' + (item.media_type || 'movie');

        if (catalogState.posterCache[cacheKey] === undefined) {
            catalogState.posterObserver.observe(card);
        }
    }
}

function updatePosterObservers() {
    if (!catalogState.posterObserver) return;

    var cards = document.querySelectorAll('.torrent-card.catalog-card');
    for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        if (!card) continue;

        // Проверяем, наблюдается ли уже этот элемент
        var isBeingObserved = false;
        var records = catalogState.posterObserver.takeRecords();
        for (var j = 0; j < records.length; j++) {
            if (records[j].target === card) {
                isBeingObserved = true;
                break;
            }
        }

        if (!isBeingObserved) {
            var item = catalogState.items[i];
            if (!item) continue;

            var cacheKey = item.id + '_' + (item.media_type || 'movie');

            if (catalogState.posterCache[cacheKey] === undefined) {
                catalogState.posterObserver.observe(card);
            }
        }
    }
}

function isPosterInQueue(index) {
    for (var i = 0; i < catalogState.posterLoadQueue.length; i++) {
        if (catalogState.posterLoadQueue[i] === index) return true;
    }
    return false;
}

function addToPosterQueue(index) {
    var alreadyInQueue = false;
    for (var i = 0; i < catalogState.posterLoadQueue.length; i++) {
        if (catalogState.posterLoadQueue[i] === index) {
            alreadyInQueue = true;
            break;
        }
    }
    if (!alreadyInQueue) {
        catalogState.posterLoadQueue.push(index);
        catalogState.posterLoadQueue.sort(function (a, b) { return a - b; });

        if (!catalogState.isPosterLoading) {
            loadNextPosterBatch();
        }
    }
}

function loadNextPosterBatch() {
    if (catalogState.isPosterLoading) return;
    if (catalogState.posterLoadQueue.length === 0) return;

    var nextBatch = catalogState.posterLoadQueue.splice(0, catalogState.postersPerBatch);
    loadPosterBatch(nextBatch);
}

function loadPosterBatch(indices) {
    if (indices.length === 0) return;

    catalogState.isPosterLoading = true;
    console.log('🖼️ Загрузка партии постеров: индексы ' + indices[0] + '-' + indices[indices.length - 1]);

    var promises = [];
    for (var i = 0; i < indices.length; i++) {
        promises.push(loadPosterForIndex(indices[i]));
    }

    Promise.allSettled(promises)
        .then(function (results) {
            var successful = 0;
            for (var j = 0; j < results.length; j++) {
                if (results[j].status === 'fulfilled') successful++;
            }
            var failed = results.length - successful;

            console.log('✅ Загружено ' + successful + ' постеров, ' + failed + ' ошибок');

            var maxIndex = indices[0];
            for (var k = 1; k < indices.length; k++) {
                if (indices[k] > maxIndex) maxIndex = indices[k];
            }
            if (maxIndex + 1 > catalogState.loadedPostersCount) {
                catalogState.loadedPostersCount = maxIndex + 1;
            }

            catalogState.isPosterLoading = false;

            if (catalogState.posterLoadQueue.length > 0) {
                loadNextPosterBatch();
            }
        })
    ['catch'](function (error) {
        console.error('❌ Ошибка загрузки партии постеров:', error);
        catalogState.isPosterLoading = false;
    });
}

async function loadPosterForIndex(index) {
    var item = catalogState.items[index];
    if (!item) return;

    var card = document.querySelector('.torrent-card.catalog-card[data-catalog-index="' + index + '"]');
    if (!card) return;

    var title = getCatalogItemTitle(item);
    var mediaType = item.media_type || 'movie';
    var tmdbId = item.id;

    await loadCatalogPoster(card, title, mediaType, tmdbId, index);
}

async function loadCatalogPoster(card, title, mediaType, tmdbId, index) {
    var posterDiv = card.querySelector('.torrent-poster');
    if (!posterDiv) return;

    var cacheKey = tmdbId + '_' + mediaType;

    if (!catalogState.currentCatalog) {
        posterDiv.innerHTML = '<div class="no-poster">Каталог закрыт</div>';
        return;
    }

    // Проверяем кэш
    if (catalogState.posterCache[cacheKey] !== undefined) {
        var cachedPoster = catalogState.posterCache[cacheKey];
        if (cachedPoster) {
            console.log('📦 Используем кэшированный постер для ' + title);

            var rating = card.dataset.rating;
            var posterHtml = '<img src="' + cachedPoster + '" loading="lazy" onerror="this.parentElement.innerHTML=\'<div class=\\\'no-poster\\\'>Нет постера</div>\'">';

            if (rating && rating !== 'null' && rating !== 'undefined') {
                var ratingColor = getRatingColor(parseFloat(rating));
                posterDiv.innerHTML = '\n                    ' + posterHtml + '\n                    <div style="\n                        position: absolute;\n                        top: 8px;\n                        right: 8px;\n                        background: rgba(0, 0, 0, 0.8);\n                        color: ' + ratingColor + ';\n                        font-weight: bold;\n                        font-size: 14px;\n                        padding: 4px 8px;\n                        border-radius: 12px;\n                        z-index: 10;\n                        border: 1px solid ' + ratingColor + ';\n                        box-shadow: 0 2px 8px rgba(0,0,0,0.3);\n                        backdrop-filter: blur(2px);\n                    ">\n                        ' + rating + '\n                    </div>\n                ';
            } else {
                posterDiv.innerHTML = posterHtml;
            }
            return;
        }
    }

    var rating = card.dataset.rating;

    try {
        var posterUrl = null;

        var cacheParams = { id: tmdbId, type: mediaType };
        var cachedTmdbData = getFromTmdbCache('poster', cacheParams);

        if (cachedTmdbData && cachedTmdbData.posterUrl) {
            posterUrl = cachedTmdbData.posterUrl;
            console.log('📦 TMDB кэш: найден постер для ' + title);
        } else {
            var controller = new AbortController();
            var timeoutId = setTimeout(function () { controller.abort(); }, 5000);

            if (tmdbId && tmdbId !== 'undefined' && tmdbId !== 'null') {
                console.log('🔍 Загрузка постера для ' + title + ' (ID: ' + tmdbId + ', type: ' + mediaType + ')');

                var response = await fetch('/api/tmdb/item?id=' + tmdbId + '&type=' + mediaType, {
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!catalogState.currentCatalog) {
                    posterDiv.innerHTML = '<div class="no-poster">Загрузка отменена</div>';
                    return;
                }

                if (response.ok) {
                    var data = await response.json();
                    if (data.poster_path) {
                        posterUrl = 'https://tsimg.hnar.online/t/p/w342' + data.poster_path;
                        saveToTmdbCache('poster', cacheParams, { posterUrl: posterUrl, data: data });
                    }
                }
            }

            if (!posterUrl && window.tmdb && window.tmdb.searchPoster) {
                console.log('🔍 Поиск постера через search для ' + title);

                var controller2 = new AbortController();
                var timeoutId2 = setTimeout(function () { controller2.abort(); }, 5000);

                posterUrl = await window.tmdb.searchPoster(title, null, mediaType, true);

                clearTimeout(timeoutId2);

                if (posterUrl) {
                    saveToTmdbCache('poster', cacheParams, { posterUrl: posterUrl });
                }
            }
        }

        if (!catalogState.currentCatalog) {
            return;
        }

        if (posterUrl) {
            catalogState.posterCache[cacheKey] = posterUrl;
        }

        var posterHtml = '';

        if (posterUrl) {
            posterHtml = '<img src="' + posterUrl + '" loading="lazy" onerror="this.parentElement.innerHTML=\'<div class=\\\'no-poster\\\'>Нет постера</div>\'">';
        } else {
            posterHtml = '<div class="no-poster">Нет постера</div>';
        }

        if (rating && rating !== 'null' && rating !== 'undefined') {
            var ratingColor = getRatingColor(parseFloat(rating));
            posterDiv.innerHTML = '\n                ' + posterHtml + '\n                <div style="\n                    position: absolute;\n                    top: 8px;\n                    right: 8px;\n                    background: rgba(0, 0, 0, 0.8);\n                    color: ' + ratingColor + ';\n                    font-weight: bold;\n                    font-size: 14px;\n                    padding: 4px 8px;\n                    border-radius: 12px;\n                    z-index: 10;\n                    border: 1px solid ' + ratingColor + ';\n                    box-shadow: 0 2px 8px rgba(0,0,0,0.3);\n                    backdrop-filter: blur(2px);\n                ">\n                    ' + rating + '\n                </div>\n            ';
        } else {
            posterDiv.innerHTML = posterHtml;
        }

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('📴 Загрузка постера отменена');
        } else {
            console.error('Ошибка загрузки постера:', error);
        }
        if (catalogState.currentCatalog) {
            posterDiv.innerHTML = '<div class="no-poster">Ошибка загрузки</div>';
        }
    }
}

// ==================== ДЕТАЛЬНЫЙ ПРОСМОТР ====================

async function showCatalogDetail(item, index, posterUrl) {
    if (posterUrl === undefined) posterUrl = null;
    catalogState.lastSelectedIndex = index;
    catalogState.lastSelectedId = item.id;

    var detailView = document.getElementById('detail-view');
    var mainContainer = document.getElementById('main-container');
    var posterEl = document.getElementById('detail-poster');
    var titleEl = document.getElementById('detail-title-text');
    var subtitleEl = document.getElementById('detail-subtitle');
    var extraEl = document.getElementById('catalog-detail-extra');
    var backdropEl = document.getElementById('catalog-detail-backdrop');
    var metaEl = document.getElementById('catalog-detail-meta');
    var overviewEl = document.getElementById('catalog-detail-overview');
    var trailersWrap = document.getElementById('catalog-detail-trailers-wrap');
    var trailersEl = document.getElementById('catalog-detail-trailers');
    var filesList = document.getElementById('files-list');
    var watchBtn = document.getElementById('catalog-watch-btn');

    var existingProgress = document.querySelector('.detail-progress');
    if (existingProgress) {
        existingProgress.remove();
    }

    var actorsWrap = document.getElementById('catalog-detail-actors-wrap');
    var actorsEl = document.getElementById('catalog-detail-actors');

    if (!actorsWrap) {
        var overviewContainer = overviewEl && overviewEl.parentElement;
        if (overviewContainer) {
            var actorsContainer = document.createElement('div');
            actorsContainer.id = 'catalog-detail-actors-wrap';
            actorsContainer.className = 'catalog-detail-actors-wrap';
            actorsContainer.innerHTML = '\n                <div class="catalog-detail-section-title">В главных ролях</div>\n                <div id="catalog-detail-actors" class="catalog-detail-actors-grid"></div>\n            ';
            overviewContainer.insertAdjacentElement('afterend', actorsContainer);
            actorsWrap = actorsContainer;
            actorsEl = document.getElementById('catalog-detail-actors');
        }
    }

    var recommendationsWrap = document.getElementById('catalog-detail-recommendations-wrap');
    var recommendationsEl = document.getElementById('catalog-detail-recommendations');

    if (!recommendationsWrap) {
        var actorsContainer = actorsWrap || (overviewEl && overviewEl.parentElement);
        if (actorsContainer) {
            var recContainer = document.createElement('div');
            recContainer.id = 'catalog-detail-recommendations-wrap';
            recContainer.className = 'catalog-detail-recommendations-wrap';
            recContainer.innerHTML = '\n                <div class="catalog-detail-section-title">Похожие фильмы</div>\n                <div id="catalog-detail-recommendations" class="catalog-detail-recommendations-grid"></div>\n            ';
            actorsContainer.insertAdjacentElement('afterend', recContainer);
            recommendationsWrap = recContainer;
            recommendationsEl = document.getElementById('catalog-detail-recommendations');
        }
    }

    var title = getCatalogItemTitle(item);
    var mediaType = item.media_type || 'movie';

    AppState.currentDetailItem = item;
    AppState.currentScreen = 'detail';
    AppState.detailReturnTo = 'catalog';

    detailView.style.display = 'block';
    detailView.style.zIndex = '100';
    detailView.style.pointerEvents = 'auto';
    if (mainContainer) mainContainer.style.pointerEvents = 'none';
    if (typeof window.hideCatalogDetailExtra === 'function') {
        window.hideCatalogDetailExtra();
    }

    titleEl.textContent = title;
    subtitleEl.textContent = getCatalogItemSubtitle(item);
    filesList.style.display = 'none';
    filesList.innerHTML = '';
    extraEl.classList.remove('hidden');
    metaEl.innerHTML = '<span class="catalog-meta-chip">Загрузка описания...</span>';
    overviewEl.textContent = 'Загрузка...';
    trailersWrap.classList.add('hidden');
    trailersEl.innerHTML = '';
    trailersEl.classList.remove('catalog-detail-trailers-links');

    if (actorsWrap) actorsWrap.classList.add('hidden');
    if (recommendationsWrap) recommendationsWrap.classList.add('hidden');

    var tempPoster = posterUrl || catalogState.posterCache[item.id + '_' + mediaType] || '';
    posterEl.innerHTML = tempPoster ? '<img src="' + tempPoster + '" alt="poster">' : '<div class="no-poster">Нет постера</div>';

    updateCatalogWatchButton(title);

    if (watchBtn) {
        watchBtn.onclick = function () {
            detailView.style.display = 'none';
            detailView.style.pointerEvents = 'none';
            if (mainContainer) {
                mainContainer.style.pointerEvents = 'auto';
            }
            AppState.currentScreen = 'search';
            AppState.isSearch = false;

            var searchTitle = watchBtn.dataset.searchTitle || title;
            showCatalogSearch(searchTitle, tempPoster, item);
        };
    }

    var details = await fetchCatalogItemDetails(item);
    var source = details || item || {};

    var finalPosterUrl = tempPoster;

    if (source.poster_path) {
        var tmdbPosterUrl = 'https://tsimg.hnar.online/t/p/w342' + source.poster_path;
        if (!tempPoster || tempPoster === '' || posterEl.innerHTML.indexOf('Нет постера') !== -1) {
            finalPosterUrl = tmdbPosterUrl;
            posterEl.innerHTML = '<img src="' + tmdbPosterUrl + '" alt="poster" onerror="this.parentElement.innerHTML=\'<div class=\"no-poster\">Нет постера</div>\'">';
        } else {
            catalogState.posterCache[item.id + '_' + mediaType] = tmdbPosterUrl;
        }
    } else if (source.image && (source.image.original || source.image.medium)) {
        var sourcePoster = source.image.original || source.image.medium;
        if (!tempPoster || tempPoster === '' || posterEl.innerHTML.indexOf('Нет постера') !== -1) {
            finalPosterUrl = sourcePoster;
            posterEl.innerHTML = '<img src="' + sourcePoster + '" alt="poster" onerror="this.parentElement.innerHTML=\'<div class=\"no-poster\">Нет постера</div>\'">';
        }
    }

    subtitleEl.textContent = getCatalogItemSubtitle(item, source);

    var chips = [];
    var releaseYear = getCatalogItemYear(source);
    if (releaseYear) chips.push('<span class="catalog-meta-chip">' + escapeHtml(releaseYear) + '</span>');
    var safeRating = getSafeCatalogRating(source);
    if (safeRating !== null) chips.push('<span class="catalog-meta-chip">' + escapeHtml(String(safeRating)) + '</span>');
    if (source.source_name) chips.push('<span class="catalog-meta-chip">ℹ' + escapeHtml(String(source.source_name)) + '</span>');
    var genres = getNormalizedCatalogGenres(source).slice(0, 4);
    for (var i = 0; i < genres.length; i++) {
        chips.push('<span class="catalog-meta-chip">' + escapeHtml(genres[i]) + '</span>');
    }
    metaEl.innerHTML = chips.join('') || '<span class="catalog-meta-chip">Каталог</span>';

    var overview = source.overview || item.overview || 'Описание пока недоступно';
    overviewEl.textContent = overview;

    var backdropPath = source.backdrop_path || (Array.isArray(source.backdrops) && source.backdrops[0] && source.backdrops[0].file_path) || null;
    if (backdropPath) {
        var backdropUrl = backdropPath.indexOf('http') === 0 ? backdropPath : 'https://tsimg.hnar.online/t/p/original' + backdropPath;
        backdropEl.style.backgroundImage = 'url(' + backdropUrl + ')';
        backdropEl.classList.remove('hidden');
    } else {
        backdropEl.classList.add('hidden');
        backdropEl.style.backgroundImage = '';
    }

    // Актеры - грид на 12 колонок
    if (actorsWrap && actorsEl) {
        actorsEl.innerHTML = '<div class="catalog-loading"><div class="loading-spinner-small"></div><span>Загрузка актеров...</span></div>';
        actorsWrap.classList.remove('hidden');

        var actors = await fetchCatalogActors(item);

        if (actors.length > 0) {
            var actorsGridTemplateColumns = 'repeat(12, 1fr)';
            var actorsHtml = '<div class="catalog-detail-actors-grid" style="display: grid; grid-template-columns: ' + actorsGridTemplateColumns + '; gap: 20px;">';

            for (var j = 0; j < actors.length; j++) {
                var actor = actors[j];
                var profileUrl = actor.profilePath ? 'https://tsimg.hnar.online/t/p/w185' + actor.profilePath : null;
                actorsHtml += '\n                    <div class="catalog-actor-card" data-actor-id="' + actor.id + '">\n                        <div class="catalog-actor-photo">\n                            ' + (profileUrl ? '<img src="' + profileUrl + '" alt="' + escapeHtml(actor.name) + '" loading="lazy" onerror="this.parentElement.innerHTML=\'<div class=\\\'catalog-actor-no-photo\\\'>Нет фото</div>\'">' : '<div class="catalog-actor-no-photo">Нет фото</div>') + '\n                        </div>\n                        <div class="catalog-actor-info">\n                            <div class="catalog-actor-name">' + escapeHtml(actor.name) + '</div>\n                            <div class="catalog-actor-character">' + escapeHtml(actor.character || '') + '</div>\n                        </div>\n                    </div>\n                ';
            }

            actorsHtml += '</div>';
            actorsEl.innerHTML = actorsHtml;
        } else {
            actorsEl.innerHTML = '<div class="catalog-empty">Актеры не найдены</div>';
        }
    }

    // Рекомендации - грид на 12 колонок
    if (recommendationsWrap && recommendationsEl && source.recommendations && source.recommendations.length > 0) {
        recommendationsEl.innerHTML = '<div class="catalog-loading"><div class="loading-spinner-small"></div><span>Загрузка похожих фильмов...</span></div>';
        recommendationsWrap.classList.remove('hidden');

        var recommendations = source.recommendations.slice(0, 12);

        var recGridTemplateColumns = 'repeat(12, 1fr)';
        var recHtml = '<div class="catalog-recommendations-grid" style="display: grid; grid-template-columns: ' + recGridTemplateColumns + '; gap: 20px;">';

        for (var k = 0; k < recommendations.length; k++) {
            var rec = recommendations[k];
            var recPosterUrl = rec.poster_path ? 'https://tsimg.hnar.online/t/p/w185' + rec.poster_path : null;
            var recTitle = rec.title || rec.name || 'Без названия';
            var recYear = rec.release_date ? rec.release_date.substring(0, 4) : '';
            var recRating = rec.vote_average ? Math.round(rec.vote_average * 10) / 10 : null;

            recHtml += '\n                <div class="catalog-recommendation-card" data-tmdb-id="' + rec.id + '" data-media-type="' + mediaType + '" data-title="' + escapeHtml(recTitle) + '">\n                    <div class="catalog-recommendation-poster">\n                        ' + (recPosterUrl ? '<img src="' + recPosterUrl + '" alt="' + escapeHtml(recTitle) + '" loading="lazy" onerror="this.parentElement.innerHTML=\'<div class=\\\'catalog-recommendation-no-poster\\\'></div>\'">' : '<div class="catalog-recommendation-no-poster"></div>') + '\n                        ' + (recRating ? '<div class="catalog-recommendation-rating">' + recRating + '</div>' : '') + '\n                    </div>\n                    <div class="catalog-recommendation-info">\n                        <div class="catalog-recommendation-title">' + escapeHtml(recTitle) + '</div>\n                        ' + (recYear ? '<div class="catalog-recommendation-year">' + recYear + '</div>' : '') + '\n                    </div>\n                </div>\n            ';
        }

        recHtml += '</div>';
        recommendationsEl.innerHTML = recHtml;

        var recCards = recommendationsEl.querySelectorAll('.catalog-recommendation-card');
        for (var l = 0; l < recCards.length; l++) {
            (function (card) {
                card.addEventListener('click', async function () {
                    var tmdbId = card.dataset.tmdbId;
                    var recMediaType = card.dataset.mediaType;
                    var recTitle = card.dataset.title;

                    if (tmdbId) {
                        var loadingDiv = document.createElement('div');
                        loadingDiv.className = 'catalog-loading-overlay';
                        loadingDiv.innerHTML = '<div class="loading-spinner"></div><span>Загрузка...</span>';
                        detailView.appendChild(loadingDiv);

                        try {
                            var newItem = {
                                id: tmdbId,
                                media_type: recMediaType,
                                torrent: [{ name: recTitle }],
                                title: recTitle,
                                name: recTitle
                            };

                            var newDetails = await fetchCatalogItemDetails(newItem);

                            var newPosterUrl = null;
                            if (newDetails.poster_path) {
                                newPosterUrl = 'https://tsimg.hnar.online/t/p/w342' + newDetails.poster_path;
                            }

                            await showCatalogDetail(newItem, 0, newPosterUrl);

                            setTimeout(function () {
                                var newWatchBtn = document.getElementById('catalog-watch-btn');
                                if (newWatchBtn && typeof focusEl === 'function') {
                                    focusEl(newWatchBtn);
                                }
                            }, 200);
                        } catch (error) {
                            console.error('Ошибка загрузки рекомендованного фильма:', error);
                        } finally {
                            loadingDiv.remove();
                        }
                    }
                });
            })(recCards[l]);
        }
    } else if (recommendationsWrap && source.recommendations && source.recommendations.length === 0) {
        recommendationsWrap.classList.add('hidden');
    }

    var videos = [];
    if (source.videos && Array.isArray(source.videos)) {
        for (var m = 0; m < source.videos.length; m++) {
            var v = source.videos[m];
            var type = (v.type || '').toLowerCase();
            if (type.indexOf('trailer') !== -1 || type.indexOf('teaser') !== -1) {
                videos.push(v);
            }
        }
    }
    videos = videos.slice(0, 6);

    // Видео/трейлеры - грид на 6 колонок
    if (videos.length > 0) {
        trailersWrap.classList.remove('hidden');
        trailersEl.classList.add('catalog-detail-trailers-grid');
        trailersEl.classList.remove('catalog-detail-trailers-links');

        var trailersGridTemplateColumns = 'repeat(6, 1fr)';
        trailersEl.style.cssText = '\n            display: grid;\n            grid-template-columns: ' + trailersGridTemplateColumns + ';\n            gap: 16px;\n            padding: 10px;\n        ';

        var trailersHtml = '';
        for (var n = 0; n < videos.length; n++) {
            var video = videos[n];
            var thumbUrl = 'https://img.youtube.com/vi/' + video.key + '/mqdefault.jpg';
            var videoTitle = video.name || 'Трейлер';
            var duration = video.duration || '';
            var formattedDuration = duration ? formatDuration(duration) : '';

            trailersHtml += '\n                <div class="catalog-trailer-card-item" data-video-id="' + escapeHtml(video.key) + '" data-video-url="https://www.youtube.com/watch?v=' + video.key + '" data-video-title="' + escapeHtml(videoTitle) + '">\n                    <div class="catalog-trailer-poster" style="position: relative; aspect-ratio: 16/9; overflow: hidden; border-radius: 12px; background: linear-gradient(135deg, #1a1a2e, #16213e);">\n                        <img src="' + thumbUrl + '" alt="' + escapeHtml(videoTitle) + '" loading="lazy" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.parentElement.innerHTML=\'<div class=\\\'no-poster\\\' style=\\\'display: flex; align-items: center; justify-content: center; height: 100%;\\\'></div>\'">\n                        <div class="catalog-trailer-play-overlay" style="\n                            position: absolute;\n                            top: 0;\n                            left: 0;\n                            right: 0;\n                            bottom: 0;\n                            background: rgba(0, 0, 0, 0.4);\n                            display: flex;\n                            align-items: center;\n                            justify-content: center;\n                            opacity: 0;\n                            transition: opacity 0.3s;\n                            cursor: pointer;\n                        ">\n                            <div style="\n                                width: 60px;\n                                height: 60px;\n                                background: rgba(74, 158, 255, 0.9);\n                                border-radius: 50%;\n                                display: flex;\n                                align-items: center;\n                                justify-content: center;\n                                font-size: 30px;\n                                color: white;\n                            ">▶</div>\n                        </div>\n                        ' + (formattedDuration ? '\n                            <div style="\n                                position: absolute;\n                                bottom: 8px;\n                                right: 8px;\n                                background: rgba(0, 0, 0, 0.8);\n                                color: white;\n                                font-size: 12px;\n                                padding: 3px 8px;\n                                border-radius: 12px;\n                                font-family: monospace;\n                            ">' + formattedDuration + '</div>\n                        ' : '') + '\n                    </div>\n                    <div class="catalog-trailer-info" style="padding: 10px;">\n                        <div class="catalog-trailer-title" style="\n                            font-size: 14px;\n                            font-weight: 600;\n                            color: #fff;\n                            margin-bottom: 5px;\n                            overflow: hidden;\n                            text-overflow: ellipsis;\n                            white-space: nowrap;\n                        ">' + escapeHtml(videoTitle) + '</div>\n                        <div class="catalog-trailer-meta" style="\n                            display: flex;\n                            gap: 10px;\n                            font-size: 12px;\n                            color: #aaa;\n                        ">\n                            <span>Трейлер</span>\n                            ' + (formattedDuration ? '<span>⏱️ ' + formattedDuration + '</span>' : '') + '\n                        </div>\n                    </div>\n                </div>\n            ';
        }
        trailersEl.innerHTML = trailersHtml;

        var trailerCards = trailersEl.querySelectorAll('.catalog-trailer-card-item');
        for (var o = 0; o < trailerCards.length; o++) {
            (function (card) {
                var videoUrl = card.dataset.videoUrl;
                var videoTitle = card.dataset.videoTitle;

                var posterDiv = card.querySelector('.catalog-trailer-poster');
                var overlay = card.querySelector('.catalog-trailer-play-overlay');

                if (posterDiv && overlay) {
                    posterDiv.addEventListener('mouseenter', function () {
                        overlay.style.opacity = '1';
                    });
                    posterDiv.addEventListener('mouseleave', function () {
                        overlay.style.opacity = '0';
                    });
                }

                card.addEventListener('click', function () {
                    if (videoUrl) {
                        hideCatalogDetailView();
                        openYoutubeInPlayer(videoUrl, videoTitle);
                    }
                });
            })(trailerCards[o]);
        }
    } else {
        trailersWrap.classList.add('hidden');
    }

    setTimeout(function () {
        if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
            updateFocusableElements();
            var watchIndex = -1;
            if (typeof focusableElements !== 'undefined') {
                for (var p = 0; p < focusableElements.length; p++) {
                    if (focusableElements[p].id === 'catalog-watch-btn') {
                        watchIndex = p;
                        break;
                    }
                }
            }
            setFocus(watchIndex !== -1 ? watchIndex : 0);
        }
    }, 120);
}

function hideCatalogDetailView() {
    var detailView = document.getElementById('detail-view');
    if (!detailView) return;
    detailView.classList.remove('catalog-detail-mode');
    detailView.style.backgroundImage = '';
    var subtitleEl = document.getElementById('detail-title-subtitle');
    if (subtitleEl) subtitleEl.textContent = '';
    AppState.detailMode = null;
}

function updateCatalogWatchButton(title) {
    var watchBtn = document.getElementById('catalog-watch-btn');
    if (watchBtn) {
        if (title) {
            watchBtn.textContent = 'Найти торренты для "' + title + '"';
            watchBtn.dataset.searchTitle = title;
        } else {
            watchBtn.textContent = 'Найти торренты';
        }
    }
}

function onCatalogItemClick(item, index) {
    catalogState.lastSelectedIndex = index;
    catalogState.lastSelectedId = item.id;

    var numIndex = item.num_index !== undefined ? item.num_index : index;
    localStorage.setItem('lastCatalogCardIndex', numIndex);

    var card = document.querySelector('.torrent-card.catalog-card[data-catalog-index="' + index + '"]');
    var posterUrl = null;

    if (card) {
        var img = card.querySelector('.torrent-poster img');
        if (img && img.src) {
            posterUrl = img.src;
        }
    }

    showCatalogDetail(item, index, posterUrl);
}

// ==================== ПОИСК ИЗ КАТАЛОГА ====================

function showCatalogSearch(query, posterUrl, catalogItem) {
    if (posterUrl === undefined) posterUrl = null;
    if (catalogItem === undefined) catalogItem = null;
    var searchTab = document.getElementById('tab-search');
    var torrentsTab = document.getElementById('tab-torrents');
    var catalogTab = document.getElementById('tab-catalog');
    var searchOverlay = document.getElementById('search-overlay');
    var searchInput = document.getElementById('search-query');

    if (searchTab && torrentsTab && catalogTab && searchOverlay) {
        searchTab.classList.add('active');
        torrentsTab.classList.remove('active');
        catalogTab.classList.remove('active');
        searchOverlay.classList.remove('hidden');

        if (searchInput) {
            searchInput.value = query;
            if (document.activeElement === searchInput) {
                searchInput.blur();
            }
        }

        window.pendingCatalogPoster = posterUrl;
        window.pendingCatalogItem = catalogItem;

        AppState.searchReturnTo = 'detail';

        if (catalogItem) {
            AppState.pendingDetailItem = catalogItem;
            AppState.pendingDetailPoster = posterUrl;
            AppState.pendingDetailIndex = catalogState.lastSelectedIndex;
        }

        AppState.currentScreen = 'search';

        if (typeof window.searchTorrents === 'function') {
            var torrentMovieSelect = document.getElementById('torrent-movie');
            if (torrentMovieSelect) torrentMovieSelect.value = 'torrentsearch';
            window.searchTorrentsLegacy(query);
        }

        setTimeout(function () {
            if (typeof window.focusSearchHome === 'function') {
                window.focusSearchHome(true);
            } else if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
                updateFocusableElements();
                var searchInputIndex = -1;
                for (var i = 0; i < focusableElements.length; i++) {
                    if (focusableElements[i].id === 'search-query') {
                        searchInputIndex = i;
                        break;
                    }
                }
                setFocus(searchInputIndex !== -1 ? searchInputIndex : 0);
            }
        }, 200);
    }
}

// ==================== YOUTUBE ПЛЕЕР ====================

async function openYoutubeInPlayer(youtubeUrl, videoTitle) {
    console.log('Открываем YouTube в плеере:', youtubeUrl);

    var currentDetailItem = AppState.currentDetailItem;
    var catalogName = catalogState.currentCatalog;
    var itemIndex = catalogState.lastSelectedIndex;

    var detailView = document.getElementById('detail-view');
    var mainContainer = document.getElementById('main-container');
    if (detailView) {
        detailView.style.display = 'none';
        detailView.style.pointerEvents = 'none';
    }
    if (mainContainer) {
        mainContainer.style.pointerEvents = 'none';
    }

    var playbackOverlay = document.getElementById('playback-overlay');
    if (playbackOverlay) {
        playbackOverlay.classList.add('active');
        var playbackText = document.querySelector('.playback-text');
        if (playbackText) playbackText.textContent = 'Загрузка трейлера: ' + videoTitle + '...';
    }

    try {
        var statusResponse = await fetch(SERVER_URL + '/api/youtube/status');
        var status = await statusResponse.json();

        if (!status.available) {
            throw new Error('yt-dlp не установлен на сервере');
        }

        var streamResponse = await fetch(SERVER_URL + '/hls/youtube?url=' + encodeURIComponent(youtubeUrl) + '&quality=best');

        if (!streamResponse.ok) {
            throw new Error('HTTP ' + streamResponse.status);
        }

        var streamData = await streamResponse.json();

        if (!streamData.success) {
            throw new Error(streamData.error || 'Ошибка создания потока');
        }

        console.log('✅ YouTube поток создан:', streamData);

        var oldStreamId = AppState.currentStreamId;
        AppState.currentStreamId = streamData.streamId;
        AppState.videoUrl = youtubeUrl;
        AppState.expectedDuration = streamData.duration;
        AppState.originalDuration = streamData.originalDuration;
        AppState.seekOffset = streamData.seekOffset || 0;
        AppState.isYoutubePlayback = true;

        AppState.youtubeContext = {
            currentDetailItem: currentDetailItem,
            catalogName: catalogName,
            itemIndex: itemIndex
        };

        var fakeItem = {
            title: videoTitle,
            hash: null,
            isYoutube: true,
            youtubeUrl: youtubeUrl
        };
        AppState.currentDetailItem = fakeItem;

        if (oldStreamId) {
            await fetch(SERVER_URL + '/hls/stop/' + oldStreamId, { method: 'POST' })['catch'](function () { });
        }

        if (window.destroyHls) {
            window.destroyHls();
        }

        var videoPlayer = document.getElementById('video-player');

        if (Hls.isSupported()) {
            if (AppState.hls) {
                AppState.hls.destroy();
            }

            AppState.hls = new Hls({
                maxBufferSize: 80 * 1024 * 1024,
                maxBufferLength: 30,
                maxMaxBufferLength: 30,
                backBufferLength: 20,
                startFragPrefetch: true,
                startLevel: -1,
                abrEwmaDefaultEstimate: 500000,
                abrBandWidthFactor: 0.8,
                abrBandWidthUpFactor: 0.7,
                fragLoadingTimeOut: 10000,
                fragLoadingMaxRetry: 6,
                fragLoadingRetryDelay: 500,
                manifestLoadingTimeOut: 10000,
                manifestLoadingMaxRetry: 4,
                maxFragLookUpTolerance: 0.25,
                lowLatencyMode: false,
                liveSyncDurationCount: 3,
                liveMaxLatencyDurationCount: Infinity,
                maxLiveSyncPlaybackRate: 1,
                liveDurationInfinity: false,
                liveBackBufferLength: 20,
                enableWorker: true,
                abrEwmaSlowVoD: 4000,
                abrEwmaFastVoD: 1000,
                progressive: true
            });

            AppState.hls.loadSource(streamData.playlistUrl);
            AppState.hls.attachMedia(videoPlayer);

            var playbackStarted = false;
            var bufferCheckInterval = null;

            AppState.hls.on(Hls.Events.MANIFEST_PARSED, function () {
                console.log('📜 YouTube манифест распарсен');

                if (typeof window.updatePlayerTitle === 'function') {
                    window.updatePlayerTitle('Трейлер: ' + videoTitle);
                }

                videoPlayer.currentTime = 0;
                videoPlayer.pause();

                var checkBuffer = function () {
                    if (playbackStarted) return;

                    if (videoPlayer.buffered && videoPlayer.buffered.length > 0) {
                        var bufferedEnd = videoPlayer.buffered.end(videoPlayer.buffered.length - 1);
                        var currentTime = videoPlayer.currentTime;
                        var bufferAhead = bufferedEnd - currentTime;

                        if (bufferAhead >= 3) {
                            if (bufferCheckInterval) clearInterval(bufferCheckInterval);

                            if (playbackOverlay) playbackOverlay.classList.remove('active');

                            videoPlayer.play()['catch'](function (err) {
                                console.log('🔇 Автоплей заблокирован');
                                videoPlayer.muted = true;
                                videoPlayer.play()['catch'](function () { });
                                if (typeof window.updateMuteButton === 'function') window.updateMuteButton();
                            });

                            playbackStarted = true;

                            document.getElementById('player-screen').style.display = 'block';
                            document.getElementById('config-screen').style.display = 'none';
                            document.getElementById('torrserver-section').style.display = 'none';

                            var focusedElements = document.querySelectorAll('.focused');
                            for (var i = 0; i < focusedElements.length; i++) {
                                focusedElements[i].classList.remove('focused');
                            }

                            if (typeof window.resetMouseIdleTimer === 'function') {
                                window.resetMouseIdleTimer();
                            }
                        }
                    }
                };

                bufferCheckInterval = setInterval(checkBuffer, 500);

                setTimeout(function () {
                    if (!playbackStarted) {
                        if (bufferCheckInterval) clearInterval(bufferCheckInterval);
                        if (playbackOverlay) playbackOverlay.classList.remove('active');
                        videoPlayer.play()['catch'](function () { });
                        playbackStarted = true;
                        document.getElementById('player-screen').style.display = 'block';
                    }
                }, 10000);
            });

            AppState.hls.on(Hls.Events.ERROR, function (event, data) {
                console.error('HLS ошибка:', data);
                if (data.fatal) {
                    if (playbackOverlay) playbackOverlay.classList.remove('active');
                    alert('Ошибка воспроизведения трейлера');
                }
            });

        } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
            videoPlayer.src = streamData.playlistUrl;

            videoPlayer.addEventListener('loadedmetadata', function () {
                if (typeof window.updatePlayerTitle === 'function') {
                    window.updatePlayerTitle('Трейлер: ' + videoTitle);
                }

                if (playbackOverlay) playbackOverlay.classList.remove('active');
                videoPlayer.play()['catch'](function () { });
                document.getElementById('player-screen').style.display = 'block';
            });
        } else {
            throw new Error('Ваш браузер не поддерживает HLS');
        }

        AppState.currentScreen = 'player';

    } catch (error) {
        console.error('❌ Ошибка воспроизведения трейлера:', error);
        if (playbackOverlay) playbackOverlay.classList.remove('active');
        alert('Ошибка воспроизведения трейлера: ' + error.message);

        if (detailView) {
            detailView.style.display = 'block';
            detailView.style.pointerEvents = 'auto';
        }
        if (mainContainer) {
            mainContainer.style.pointerEvents = 'auto';
        }
    }
}

function exitYoutubePlayer() {
    console.log('Выход из YouTube плеера');

    if (AppState.currentStreamId) {
        fetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST' })['catch'](function () { });
        AppState.currentStreamId = null;
    }

    if (AppState.hls) {
        AppState.hls.destroy();
        AppState.hls = null;
    }

    AppState.isYoutubePlayback = false;

    var context = AppState.youtubeContext;

    if (context && context.currentDetailItem && context.currentDetailItem.id) {
        console.log('Возвращаемся к детальному просмотру:', context.currentDetailItem.title);

        AppState.currentScreen = 'detail';
        document.getElementById('player-screen').style.display = 'none';

        var detailView = document.getElementById('detail-view');
        var mainContainer = document.getElementById('main-container');

        if (detailView) {
            detailView.style.display = 'block';
            detailView.style.pointerEvents = 'auto';
        }

        if (mainContainer) {
            mainContainer.style.pointerEvents = 'auto';
        }

        setTimeout(async function () {
            await showCatalogDetail(
                context.currentDetailItem,
                context.itemIndex || 0,
                null
            );
        }, 100);

        AppState.youtubeContext = null;

    } else if (catalogState && catalogState.currentCatalog) {
        if (typeof window.showCatalogList === 'function') {
            window.showCatalogList();
        }
    } else {
        var torrserverSection = document.getElementById('torrserver-section');
        if (torrserverSection) {
            torrserverSection.style.display = 'block';
        }
        document.getElementById('config-screen').style.display = 'none';
        if (typeof loadTorrents === 'function') {
            loadTorrents(true);
        }
    }

    setTimeout(function () {
        if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
            updateFocusableElements();

            var watchBtn = document.getElementById('catalog-watch-btn');
            if (watchBtn) {
                var watchIndex = -1;
                for (var i = 0; i < focusableElements.length; i++) {
                    if (focusableElements[i].id === 'catalog-watch-btn') {
                        watchIndex = i;
                        break;
                    }
                }
                if (watchIndex !== -1) {
                    setFocus(watchIndex);
                    return;
                }
            }

            if (typeof window.focusFirstCatalogCard === 'function') {
                window.focusFirstCatalogCard();
            } else {
                setFocus(0);
            }
        }
    }, 200);
}

// ==================== СПИСОК КАТАЛОГОВ ====================

async function fetchAvailableCatalogs() {
    try {
        var response = await fetch(SERVER_URL + '/api/catalogs');
        if (!response.ok) throw new Error('Ошибка загрузки списка каталогов');

        var data = await response.json();
        if (data.success && data.catalogs) {
            return data.catalogs;
        }
        return [];
    } catch (error) {
        console.error('❌ Ошибка загрузки списка каталогов:', error);
        return [];
    }
}

async function showCatalogList() {
    var torrentsGrid = document.getElementById('torrents-grid');
    if (!torrentsGrid) return;

    abortCatalogRequests();

    catalogState.currentCatalog = null;
    catalogState.items = [];
    catalogState.loading = false;
    catalogState.loadedPostersCount = 0;
    catalogState.posterLoadQueue = [];

    catalogState.lastSelectedIndex = 0;
    catalogState.lastSelectedId = null;

    var tabCatalog = document.getElementById('tab-catalog');
    var tabTorrents = document.getElementById('tab-torrents');
    var tabSearch = document.getElementById('tab-search');

    if (tabCatalog) tabCatalog.classList.add('active');
    if (tabTorrents) tabTorrents.classList.remove('active');
    if (tabSearch) tabSearch.classList.remove('active');

    torrentsGrid.innerHTML = '\n        <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">\n            <div class="loading-spinner" style="margin: 0 auto 20px;"></div>\n            <div style="font-size: 16px; color: #aaa;">Загрузка списка каталогов...</div>\n        </div>\n    ';

    var availableCatalogs = await fetchAvailableCatalogs();

    if (AppState.currentScreen !== 'catalog') {
        return;
    }

    torrentsGrid.innerHTML = '';

    if (availableCatalogs.length === 0) {
        for (var key in CATALOG_CONFIG) {
            if (CATALOG_CONFIG.hasOwnProperty(key)) {
                var config = CATALOG_CONFIG[key];
                var card = createCatalogFolderCard(key, config);
                torrentsGrid.appendChild(card);
            }
        }
    } else {
        for (var i = 0; i < availableCatalogs.length; i++) {
            var catalog = availableCatalogs[i];
            var config = CATALOG_CONFIG[catalog.id] || {
                name: catalog.displayName || catalog.id,
                mediaType: catalog.id.indexOf('tv') !== -1 ? 'tv' : 'movie'
            };
            var card = createCatalogFolderCard(catalog.id, config);
            torrentsGrid.appendChild(card);
        }
    }

    setTimeout(function () {
        if (AppState.currentScreen === 'catalog') {
            if (typeof updateFocusableElements === 'function') {
                updateFocusableElements();
            }
            setTimeout(function () {
                if (typeof window.focusFirstCatalogCard === 'function') {
                    window.focusFirstCatalogCard();
                }
            }, 100);
        }
    }, 200);
}

function createCatalogFolderCard(key, config) {
    var card = document.createElement('div');
    card.className = 'torrent-card catalog-folder-card';
    card.dataset.catalogKey = key;

    // Специальная обработка для истории
    if (key === 'history') {
        var posterHtml = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; font-size: 64px;">📜</div>';

        card.innerHTML = `
            <div class="torrent-poster catalog-folder-poster">
                ${posterHtml}
            </div>
            <div class="torrent-info">
                <div class="torrent-title">${config.name}</div>
                <div class="torrent-meta">
                    <span>История просмотра</span>
                    <span class="torrent-badge catalog-badge"></span>
                </div>
            </div>
        `;

        card.addEventListener('click', function () {
            catalogState.selectedCatalog = key;
            loadHistoryCatalog();
        });

        return card;
    }

    // Остальные каталоги как раньше
    var posterHtml = '';
    if (key.indexOf('movie') !== -1) posterHtml = '<img src="https://cash94.github.io/msx/img/Films.jpg" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display=\'none\'; this.parentElement.innerHTML=\'<div class=\\\'no-poster\\\'>Нет постера</div>\'">';
    else if (key.indexOf('quadhd') !== -1) posterHtml = '<img src="https://cash94.github.io/msx/img/Films4k.jpg" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display=\'none\'; this.parentElement.innerHTML=\'<div class=\\\'no-poster\\\'>Нет постера</div>\'">';
    else if (key.indexOf('legends') !== -1) posterHtml = '<img src="https://cash94.github.io/msx/img/BestFilms.jpg" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display=\'none\'; this.parentElement.innerHTML=\'<div class=\\\'no-poster\\\'>Нет постера</div>\'">';
    else if (key.indexOf('cartoons_tv') !== -1) posterHtml = '<img src="https://cash94.github.io/msx/img/multserials.jpg" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display=\'none\'; this.parentElement.innerHTML=\'<div class=\\\'no-poster\\\'>Нет постера</div>\'">';
    else if (key.indexOf('tv') !== -1) posterHtml = '<img src="https://cash94.github.io/msx/img/Serials.jpg" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display=\'none\'; this.parentElement.innerHTML=\'<div class=\\\'no-poster\\\'>Нет постера</div>\'">';
    else if (key.indexOf('cartoons') !== -1) posterHtml = '<img src="https://cash94.github.io/msx/img/multfilms.jpg" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display=\'none\'; this.parentElement.innerHTML=\'<div class=\\\'no-poster\\\'>Нет постера</div>\'">';
    else if (key.indexOf('anime') !== -1) posterHtml = '<img src="https://cash94.github.io/msx/img/Anime.jpg" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display=\'none\'; this.parentElement.innerHTML=\'<div class=\\\'no-poster\\\'>Нет постера</div>\'">';
    else posterHtml = '<div class="no-poster" style="display: flex; align-items: center; justify-content: center; height: 100%; font-size: 64px;"></div>';

    card.innerHTML = `
        <div class="torrent-poster catalog-folder-poster">
            ${posterHtml}
        </div>
        <div class="torrent-info">
            <div class="torrent-title">${config.name}</div>
            <div class="torrent-meta">
                <span></span>
                <span class="torrent-badge catalog-badge"></span>
            </div>
        </div>
    `;

    card.addEventListener('click', function () {
        catalogState.selectedCatalog = key;
        loadCatalog(key);
    });

    return card;
}

function showCatalogLoading(message) {
    var torrentsGrid = document.getElementById('torrents-grid');
    if (torrentsGrid) {
        torrentsGrid.innerHTML = '\n            <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">\n                <div class="loading-spinner" style="margin: 0 auto 20px;"></div>\n                <div style="font-size: 16px; color: #aaa;">' + (message || 'Загрузка каталога...') + '</div>\n            </div>\n        ';
    }
}

function showCatalogError(message) {
    var torrentsGrid = document.getElementById('torrents-grid');
    if (torrentsGrid) {
        torrentsGrid.innerHTML = '\n            <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">\n                <div style="font-size: 48px; margin-bottom: 20px;"></div>\n                <div style="font-size: 16px; color: #ff6a6a;">' + message + '</div>\n                <button class="btn" style="margin-top: 20px;" onclick="window.loadCatalogList()">Попробовать снова</button>\n            </div>\n        ';
    }
}

function hideCatalogLoading() { }

function backToCatalogList() {
    console.log('Возврат к списку каталогов');

    abortCatalogRequests();

    catalogState.currentCatalog = null;
    catalogState.items = [];
    catalogState.totalItems = 0;
    catalogState.currentPage = 0;
    catalogState.hasMore = true;
    catalogState.isLoadingMore = false;
    catalogState.loadedItemIds = {};
    catalogState.loadedPostersCount = 0;
    catalogState.posterLoadQueue = [];

    catalogState.lastSelectedIndex = 0;
    catalogState.lastSelectedId = null;

    localStorage.removeItem('lastCatalogCardIndex');

    showCatalogList();

    setTimeout(function () {
        if (AppState.currentScreen === 'catalog') {
            if (typeof updateFocusableElements === 'function') {
                updateFocusableElements();
            }
            setTimeout(function () {
                if (typeof window.focusFirstCatalogCard === 'function') {
                    window.focusFirstCatalogCard();
                }
            }, 100);
        }
    }, 200);
}

// ==================== НАВИГАЦИЯ И ПОДГРУЗКА ====================

window.loadMoreAndFocus = async function (currentIndex, cols) {
    if (!catalogState.currentCatalog || catalogState.isLoadingMore) return;

    console.log('Подгрузка следующей страницы с автофокусом');

    var trigger = document.getElementById('load-more-trigger');
    if (trigger) {
        var spinner = trigger.querySelector('.loading-spinner-small');
        if (spinner) spinner.style.display = 'inline-block';
    }

    var targetRow = Math.floor(currentIndex / cols) + 1;

    await loadMoreCatalogItems();

    setTimeout(function () {
        var updatedCards = [];
        var allCards = document.querySelectorAll('.torrent-card.catalog-card');
        for (var i = 0; i < allCards.length; i++) {
            var el = allCards[i];
            if (el && el.offsetParent !== null) updatedCards.push(el);
        }

        var newIndex = targetRow * cols;

        if (updatedCards.length > newIndex) {
            if (typeof updateFocusableElements === 'function') {
                updateFocusableElements();
            }

            setTimeout(function () {
                var targetCard = updatedCards[newIndex];
                if (targetCard && typeof setFocus === 'function') {
                    var globalIndex = -1;
                    for (var j = 0; j < focusableElements.length; j++) {
                        if (targetCard === focusableElements[j]) {
                            globalIndex = j;
                            break;
                        }
                    }
                    if (globalIndex !== -1) {
                        setFocus(globalIndex);
                        console.log('Автофокус на карточку ' + (newIndex + 1));
                    }
                }
            }, 100);
        }

        if (trigger) {
            var spinner = trigger.querySelector('.loading-spinner-small');
            if (spinner) spinner.style.display = 'none';
        }
    }, 300);
};

window.checkAndLoadMoreOnNavigation = function () {
    if (catalogState.currentCatalog &&
        catalogState.hasMore &&
        !catalogState.isLoadingMore) {
        console.log('📦 Навигация вниз, загружаем следующую страницу');

        var trigger = document.getElementById('load-more-trigger');
        if (trigger) {
            var spinner = trigger.querySelector('.loading-spinner-small');
            if (spinner) spinner.style.display = 'inline-block';
        }

        loadMoreCatalogItems()['finally'](function () {
            if (trigger) {
                var spinner = trigger.querySelector('.loading-spinner-small');
                if (spinner) spinner.style.display = 'none';
            }
        });
    }
};

window.focusCatalogCardByIndex = function (targetNumIndex) {
    if (AppState.currentScreen !== 'catalog') return 0;

    if (typeof updateFocusableElements === 'function') {
        updateFocusableElements();
    }

    var cards = document.querySelectorAll('.torrent-card.catalog-card');
    var targetIndex = 0;

    for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var numIndex = card.dataset.numIndex;
        if (numIndex && parseInt(numIndex) === targetNumIndex) {
            targetIndex = i;
            break;
        }
    }

    if (targetIndex === 0 && targetNumIndex < cards.length) {
        targetIndex = targetNumIndex;
    }

    console.log('Возвращаем индекс ' + targetIndex + ' для num_index ' + targetNumIndex);
    return targetIndex;
};

window.addToWatchHistory = async function (tmdbId, title, mediaType, posterPath) {
    try {
        const response = await fetch('/api/history/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tmdbId: String(tmdbId),
                title: title,
                mediaType: mediaType,
                posterPath: posterPath || null
            })
        });

        const data = await response.json();
        if (data.success) {
            console.log('✅ Добавлено в историю просмотра:', title);
        }
        return data;
    } catch (error) {
        console.error('❌ Ошибка добавления в историю:', error);
    }
};

// ==================== ПЕРИОДИЧЕСКАЯ ОЧИСТКА КЭША ====================

var tmdbCacheCleanupInterval = null;

function startTmdbCacheCleanup() {
    if (tmdbCacheCleanupInterval) {
        clearInterval(tmdbCacheCleanupInterval);
    }

    tmdbCacheCleanupInterval = setInterval(function () {
        cleanOldTmdbCache();
    }, TMDB_CACHE_CONFIG.cleanupInterval);

    console.log('Запущена периодическая очистка TMDB кэша (каждые ' + (TMDB_CACHE_CONFIG.cleanupInterval / 1000) + ' сек)');
}

function stopTmdbCacheCleanup() {
    if (tmdbCacheCleanupInterval) {
        clearInterval(tmdbCacheCleanupInterval);
        tmdbCacheCleanupInterval = null;
        console.log('Остановлена периодическая очистка TMDB кэша');
    }
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================

function initCatalog() {
    console.log('Модуль каталогов инициализирован с поддержкой пагинации и TMDB кэша');
    startTmdbCacheCleanup();

    window.tmdbCache = {
        clear: clearTmdbCache,
        stats: getTmdbCacheStats,
        setEnabled: function (enabled) { TMDB_CACHE_CONFIG.enabled = enabled; },
        isEnabled: function () { return TMDB_CACHE_CONFIG.enabled; },
        setTtl: function (ttlMs) { TMDB_CACHE_CONFIG.ttl = ttlMs; }
    };
}

document.addEventListener('keydown', function (e) {
    if (AppState.currentScreen === 'catalog' && catalogState.currentCatalog) {
        var isBackKey = [8, 27, 461, 10009].indexOf(e.keyCode) !== -1 ||
            (typeof isKeyPressed === 'function' &&
                (isKeyPressed('BACK', e.keyCode) || isKeyPressed('EXIT', e.keyCode)));

        if (isBackKey) {
            e.preventDefault();
            e.stopPropagation();
            console.log('⬅️ Возврат к списку каталогов');
            backToCatalogList();
        }
    }
}, true);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCatalog);
} else {
    initCatalog();
}

// ==================== ПУБЛИЧНЫЕ ФУНКЦИИ ====================

window.loadCatalogList = showCatalogList;
window.backToCatalogList = backToCatalogList;
window.exitYoutubePlayer = exitYoutubePlayer;
window.loadMoreCatalogItems = loadMoreCatalogItems;

window.catalog = {
    loadCatalog: loadCatalog,
    showCatalogList: showCatalogList,
    backToCatalogList: backToCatalogList,
    tmdbCache: {
        clear: clearTmdbCache,
        stats: getTmdbCacheStats
    }
};
