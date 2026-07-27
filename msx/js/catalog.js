// catalog.js - Оптимизированный модуль для работы с каталогами
// Совместим с Android TV (Chromium 70+)

// ==================== КОНСТАНТЫ ====================
var CATALOG_CONSTANTS = {
    CACHE_TTL_MS: 3600000,              // 1 час
    FETCH_TIMEOUT_MS: 5000,             // 5 секунд
    CATALOG_CACHE_TTL_MS: 3600000,      // 1 час для каталогов
    ITEMS_PER_PAGE: 100,
    MAX_POSTER_CACHE: 150,
    MAX_DETAIL_HISTORY: 50,
    POSTER_BATCH_SIZE: 30,
    TMDB_MAX_CACHE_SIZE: 75,
    TMDB_CLEANUP_INTERVAL_MS: 300000,   // 5 минут
    MAX_ACTORS: 12,
    MAX_RECOMMENDATIONS: 12,
    MAX_TRAILERS: 6,
    LOAD_MORE_MARGIN_PX: 200,
    POSTER_OBSERVER_MARGIN_PX: 300,
    CATALOG_UPDATE_THRESHOLD_HOURS: 6,
    FOCUS_DELAY_MS: 100,
    IMG_SIZES: {
        POSTER_SMALL: 'w185',
        POSTER_MEDIUM: 'w342',
        BACKDROP: 'w1920'
    }
};

// ==================== КОНФИГУРАЦИЯ КАТАЛОГОВ ====================
var CATALOG_CONFIG = {
    movie: { name: 'Фильмы', url: SERVER_URL + '/api/catalog/movie', mediaType: 'movie' },
    quadhd: { name: 'Фильмы в 4K', url: SERVER_URL + '/api/catalog/quadhd', mediaType: 'movie' },
    legends: { name: 'Лучшие фильмы', url: SERVER_URL + '/api/catalog/legends', mediaType: 'movie' },
    tv: { name: 'Сериалы', url: SERVER_URL + '/api/catalog/tv', mediaType: 'tv' },
    cartoons: { name: 'Мультфильмы', url: SERVER_URL + '/api/catalog/cartoons', mediaType: 'movie' },
    cartoons_tv: { name: 'Мультсериалы', url: SERVER_URL + '/api/catalog/cartoons_tv', mediaType: 'tv' },
    anime: { name: 'Аниме', url: SERVER_URL + '/api/catalog/anime', mediaType: 'tv' },
    history: { name: 'История', url: null, mediaType: 'history', isHistory: true }
};

var TMDB_GENRES = {
    movie: { 28: 'Боевик', 12: 'Приключения', 16: 'Анимация', 35: 'Комедия', 80: 'Криминал', 99: 'Документальный', 18: 'Драма', 10751: 'Семейный', 14: 'Фэнтези', 36: 'История', 27: 'Ужасы', 10402: 'Музыка', 9648: 'Детектив', 10749: 'Мелодрама', 878: 'Фантастика', 10770: 'ТВ фильм', 53: 'Триллер', 10752: 'Военный', 37: 'Вестерн' },
    tv: { 10759: 'Боевик', 16: 'Анимация', 35: 'Комедия', 80: 'Криминал', 99: 'Документальный', 18: 'Драма', 10751: 'Семейный', 10762: 'Детский', 9648: 'Детектив', 10763: 'Новости', 10764: 'Реалити', 10765: 'Фантастика', 10766: 'Мыльная опера', 10767: 'Ток-шоу', 10768: 'Война и политика', 37: 'Вестерн' }
};

var POSTER_URLS = {
    history: 'https://cash94.github.io/msx/img/History.jpg',
    quadhd: 'https://cash94.github.io/msx/img/Films4k.jpg',
    legends: 'https://cash94.github.io/msx/img/BestFilms.jpg',
    cartoons_tv: 'https://cash94.github.io/msx/img/multserials.jpg',
    tv: 'https://cash94.github.io/msx/img/Serials.jpg',
    cartoons: 'https://cash94.github.io/msx/img/multfilms.jpg',
    anime: 'https://cash94.github.io/msx/img/Anime.jpg',
    movie: 'https://cash94.github.io/msx/img/Films.jpg'
};

// ==================== LRU КЭШ ====================
/**
 * LRU (Least Recently Used) кэш на базе Map.
 * При переполнении удаляет наименее недавно использованный элемент.
 */
function LRUCache(maxSize) {
    this.maxSize = maxSize || 100;
    this.cache = new Map();
}

LRUCache.prototype.get = function (key) {
    if (!this.cache.has(key)) return undefined;
    var value = this.cache.get(key);
    // Перемещаем в конец (most recently used)
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
};

LRUCache.prototype.set = function (key, value) {
    if (this.cache.has(key)) {
        this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
        // Удаляем наименее используемый (первый элемент Map)
        var firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
};

LRUCache.prototype.has = function (key) {
    return this.cache.has(key);
};

LRUCache.prototype.delete = function (key) {
    return this.cache.delete(key);
};

LRUCache.prototype.clear = function () {
    this.cache.clear();
};

LRUCache.prototype.size = function () {
    return this.cache.size;
};

// ==================== RUTUBE ТРЕЙЛЕРЫ ====================
var rutubeTrailerState = {
    currentUrl: null,
    currentTitle: null,
    bgVideo: null
};

// Кэш найденных трейлеров (ключ: id_mediaType)
var rutubeTrailerCache = {};

/**
 * Инициализация статичных кнопок детального просмотра.
 * Вызывается ОДИН раз.
 */
function initCatalogDetailButtons() {
    // --- Кнопка «Подробнее» ---
    var togBtn = getEl('catalog-toggle-overview-btn');
    if (togBtn && !togBtn._initialized) {
        togBtn._initialized = true;
        togBtn.onclick = function () {
            var ov = getEl('catalog-detail-overview');
            if (!ov) return;
            var exp = ov.classList.toggle('expanded');
            togBtn.textContent = exp ? 'Свернуть' : 'Подробнее';
        };
    }

    // --- Кнопка «Трейлер» ---
    var trailerBtn = getEl('catalog-trailer-btn');
    if (trailerBtn && !trailerBtn._initialized) {
        trailerBtn._initialized = true;

        // Клик — открыть плеер
        trailerBtn.onclick = function () {
            if (rutubeTrailerState.currentUrl) {
                openRutubeTrailerInPlayer(
                    rutubeTrailerState.currentUrl,
                    rutubeTrailerState.currentTitle || 'Трейлер'
                );
            }
        };

        // Отслеживаем класс "focused" (навигация с пульта не вызывает нативный focus)
        var observer = new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                if (mutations[i].attributeName !== 'class') continue;
                var hasFocus = trailerBtn.classList.contains('focused');
                if (hasFocus && rutubeTrailerState.currentUrl) {
                    startTrailerBackground(rutubeTrailerState.currentUrl);
                } else if (!hasFocus) {
                    stopTrailerBackground();
                }
            }
        });
        observer.observe(trailerBtn, { attributes: true, attributeFilter: ['class'] });

        // Для управления мышью — нативные события
        trailerBtn.addEventListener('focus', function () {
            if (rutubeTrailerState.currentUrl) startTrailerBackground(rutubeTrailerState.currentUrl);
        });
        trailerBtn.addEventListener('blur', function () {
            stopTrailerBackground();
        });
    }
}

/**
 * Сброс состояния кнопок при открытии новой карточки
 */
function resetDetailButtons() {
    var togBtn = getEl('catalog-toggle-overview-btn');
    if (togBtn) togBtn.textContent = 'Подробнее';

    var ov = getEl('catalog-detail-overview');
    if (ov) ov.classList.remove('expanded');

    var trailerBtn = getEl('catalog-trailer-btn');
    if (trailerBtn) {
        trailerBtn.classList.add('hidden');      // ★ возвращаем hidden
        trailerBtn.style.display = 'none';
    }
}

/**
 * Показать кнопку «Трейлер» и обновить фокус-список
 */
function showTrailerButton() {
    var btn = getEl('catalog-trailer-btn');
    if (!btn) return;

    btn.classList.remove('hidden');          // ★ убираем hidden
    btn.style.display = 'inline-block';

    // control.js кэширует список фокуса — инвалидируем и обновляем
    if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
    if (typeof updateFocusableElements === 'function') updateFocusableElements();
}

/**
 * Парсит максимальное разрешение из m3u8 URL (параметр guids)
 * Возвращает { width, height, pixels } или null
 */
function parseMaxQualityFromM3u8Url(url) {
    if (!url) return null;
    try {
        // Ищем все пары WxH в URL (формат: 1920x1080, 1280x720 и т.д.)
        var matches = url.match(/(\d{2,4})x(\d{2,4})/g);
        if (!matches || matches.length === 0) return null;
        var max = { width: 0, height: 0, pixels: 0 };
        for (var i = 0; i < matches.length; i++) {
            var parts = matches[i].split('x');
            var w = parseInt(parts[0], 10);
            var h = parseInt(parts[1], 10);
            var pixels = w * h;
            if (pixels > max.pixels) {
                max.width = w;
                max.height = h;
                max.pixels = pixels;
            }
        }
        return max.pixels > 0 ? max : null;
    } catch (e) {
        return null;
    }
}

/**
 * Извлекает video_balancer URL из ответа play/options
 * Приоритет: m3u8 > default
 */
function extractBalancerUrl(playData) {
    if (!playData || !playData.video_balancer) return null;
    var vb = playData.video_balancer;
    return vb.default || vb.m3u8 || null;
}

/**
 * Основная функция: поиск трейлера на RuTube
 * @param {string} title - название фильма
 * @param {string} originalTitle - оригинальное название
 * @param {string} releaseDate - дата релиза (используется только год)
 * @returns {Promise<{url: string, quality: object, title: string}|null>}
 */
async function fetchRutubeTrailer(title, originalTitle, releaseDate) {
    if (!title) return null;

    var year = '';
    if (releaseDate) {
        var yearMatch = String(releaseDate).match(/(19|20)\d{2}/);
        if (yearMatch) year = yearMatch[0];
    }

    var queryParts = ['Трейлер', title];
    if (originalTitle && originalTitle !== title) {
        queryParts.push('|', originalTitle);
    }
    if (year) queryParts.push(year);
    var query = queryParts.join(' ');

    //   Запрос через прокси
    var searchApiUrl = 'https://rutube.ru/api/search/combined/video_playlist?query=' +
        encodeURIComponent(query) + '&duration=short&client=wdp&page=1';

    var searchUrl = '/api/rutube/proxy?url=' + encodeURIComponent(searchApiUrl);

    try {
        // Шаг 1: Поиск
        var searchData = await safeFetch(searchUrl, { timeout: 10000 });
        if (!searchData || !Array.isArray(searchData.results) || searchData.results.length === 0) {
            return null;
        }

        // Шаг 2: Фильтрация
        var matchedIds = [];
        var titleLower = title.toLowerCase().trim();

        for (var i = 0; i < searchData.results.length; i++) {
            if (matchedIds.length >= 3) break;
            var resultTitle = (searchData.results[i].title || '').toLowerCase().trim();
            var titleMatch = resultTitle.indexOf(titleLower) !== -1;
            var yearMatch = year ? resultTitle.indexOf(year) !== -1 : true;

            if (titleMatch && yearMatch) {
                var id = searchData.results[i].id;
                if (id) matchedIds.push(id);
            }
        }

        if (matchedIds.length === 0) return null;

        // Шаг 3: Запросы play/options через прокси
        var bestUrl = null;
        var bestQuality = null;
        var bestTitle = '';

        for (var j = 0; j < matchedIds.length; j++) {
            var playApiUrl = 'https://rutube.ru/api/play/options/' + matchedIds[j];
            var playProxyUrl = '/api/rutube/proxy?url=' + encodeURIComponent(playApiUrl);

            var playData = await safeFetch(playProxyUrl, { timeout: 10000 });
            if (!playData) continue;

            var balancerUrl = extractBalancerUrl(playData);
            if (!balancerUrl) continue;

            var quality = parseMaxQualityFromM3u8Url(balancerUrl);
            if (!quality) continue;

            if (!bestQuality || quality.pixels > bestQuality.pixels) {
                bestUrl = balancerUrl;
                bestQuality = quality;
                bestTitle = playData.title || title;
            }
        }

        if (!bestUrl) return null;

        return { url: bestUrl, quality: bestQuality, title: bestTitle };

    } catch (e) {
        console.warn('❌ RuTube trailer error:', e.message);
        return null;
    }
}

function wrapRutubeHls(url) {
    if (!url) return url;
    // Уже обёрнут — не оборачиваем повторно
    if (url.indexOf('/api/rutube/hls/proxy') === 0) return url;
    return '/api/rutube/hls/proxy?u=' + encodeURIComponent(url);
}

// ==================== TMDB КЭШ ====================
var tmdbCache = {};
var cats = [];
var TMDB_CACHE_CONFIG = {
    ttl: CATALOG_CONSTANTS.CACHE_TTL_MS,
    maxSize: CATALOG_CONSTANTS.TMDB_MAX_CACHE_SIZE,
    cleanupInterval: CATALOG_CONSTANTS.TMDB_CLEANUP_INTERVAL_MS,
    enabled: true
};

var detailHistory = [];

function clearDetailHistory() {
    detailHistory = [];
}

function getTmdbCacheKey(endpoint, params) {
    var keys = Object.keys(params).sort();
    var sorted = {};
    for (var i = 0; i < keys.length; i++) sorted[keys[i]] = params[keys[i]];
    return endpoint + ':' + JSON.stringify(sorted);
}

function getFromTmdbCache(endpoint, params) {
    if (!TMDB_CACHE_CONFIG.enabled) return null;
    var key = getTmdbCacheKey(endpoint, params);
    var cached = tmdbCache[key];
    if (cached && (Date.now() - cached.timestamp < TMDB_CACHE_CONFIG.ttl)) {
        return cached.data;
    }
    if (cached) delete tmdbCache[key];
    return null;
}

function saveToTmdbCache(endpoint, params, data) {
    if (!TMDB_CACHE_CONFIG.enabled) return;
    var key = getTmdbCacheKey(endpoint, params);
    if (Object.keys(tmdbCache).length >= TMDB_CACHE_CONFIG.maxSize) cleanOldTmdbCache();
    tmdbCache[key] = { data: data, timestamp: Date.now() };
}

function cleanOldTmdbCache() {
    var now = Date.now();
    var keys = Object.keys(tmdbCache);
    if (keys.length === 0) return;
    var expired = [];
    for (var i = 0; i < keys.length; i++) {
        if (now - tmdbCache[keys[i]].timestamp >= TMDB_CACHE_CONFIG.ttl) expired.push(keys[i]);
    }
    for (var j = 0; j < expired.length; j++) delete tmdbCache[expired[j]];
    keys = Object.keys(tmdbCache);
    if (keys.length >= TMDB_CACHE_CONFIG.maxSize) {
        var entries = keys.map(function (k) { return { k: k, t: tmdbCache[k].timestamp }; });
        entries.sort(function (a, b) { return a.t - b.t; });
        var toRemove = keys.length - TMDB_CACHE_CONFIG.maxSize + 15;
        for (var r = 0; r < toRemove && r < entries.length; r++) delete tmdbCache[entries[r].k];
    }
}

function clearTmdbCache() { tmdbCache = {}; }

function getTmdbCacheStats() {
    var now = Date.now(), valid = 0, expired = 0, size = 0;
    var keys = Object.keys(tmdbCache);
    for (var i = 0; i < keys.length; i++) {
        var v = tmdbCache[keys[i]];
        size += JSON.stringify(v.data).length;
        (now - v.timestamp < TMDB_CACHE_CONFIG.ttl ? valid++ : expired++);
    }
    return {
        totalEntries: keys.length, validEntries: valid, expiredEntries: expired,
        totalSizeMB: (size / 1048576).toFixed(2), maxSize: TMDB_CACHE_CONFIG.maxSize,
        ttlHours: TMDB_CACHE_CONFIG.ttl / 3600000, enabled: TMDB_CACHE_CONFIG.enabled
    };
}

// ==================== СОСТОЯНИЕ КАТАЛОГА ====================
var catalogState = {
    currentCatalog: null, items: [], totalItems: 0, loading: false, loadingMore: false,
    selectedCatalog: null, lastSelectedIndex: 0, lastSelectedId: null, abortController: null,
    currentPage: 0, itemsPerPage: CATALOG_CONSTANTS.ITEMS_PER_PAGE, hasMore: true,
    isLoadingMore: false, loadedItemIds: {}, loadedPostersCount: 0,
    postersPerBatch: CATALOG_CONSTANTS.POSTER_BATCH_SIZE, isPosterLoading: false,
    posterLoadQueue: [], posterObserver: null, loadMoreObserver: null,
    cardElements: {},
    posterCache: new LRUCache(CATALOG_CONSTANTS.MAX_POSTER_CACHE),
    maxPosterCacheSize: CATALOG_CONSTANTS.MAX_POSTER_CACHE
};

var catalogCache = new Map();

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function abortCatalogRequests() {
    if (catalogState.abortController) { catalogState.abortController.abort(); catalogState.abortController = null; }
    if (catalogState.posterObserver) { catalogState.posterObserver.disconnect(); catalogState.posterObserver = null; }
    if (catalogState.loadMoreObserver) { catalogState.loadMoreObserver.disconnect(); catalogState.loadMoreObserver = null; }
}

function getRatingColor(r) {
    return r >= 8 ? '#4caf50' : r >= 6 ? '#ffc107' : r >= 4 ? '#ff9800' : '#f44336';
}

function escapeHtml(s) {
    return s ? String(s).replace(/[&<>]/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]); }) : '';
}

function formatDuration(sec) {
    if (!sec) return '';
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
}

/**
 * Универсальная обёртка для fetch с таймаутом и обработкой ошибок
 */
async function safeFetch(url, options, fallback) {
    options = options || {};
    var timeout = options.timeout || CATALOG_CONSTANTS.FETCH_TIMEOUT_MS;
    var controller = new AbortController();
    var timeoutId = setTimeout(function () { controller.abort(); }, timeout);
    try {
        var resp = await fetch(url, Object.assign({ signal: controller.signal }, options));
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return await resp.json();
    } catch (e) {
        if (e.name === 'AbortError') {
            console.warn('⏱️ Fetch timeout:', url);
        } else {
            console.warn('❌ Fetch error:', url, e.message);
        }
        return fallback !== undefined ? fallback : null;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function fetchJsonWithTimeout(url, timeout, options) {
    options = options || {};
    options.timeout = timeout || CATALOG_CONSTANTS.FETCH_TIMEOUT_MS;
    return safeFetch(url, options, null);
}

// ==================== TMDB ФУНКЦИИ ====================
async function fetchCatalogActors(item) {
    var id = item && item.id, type = (item && item.media_type) || 'movie';
    if (!id) return [];
    var p = { id: id, type: type };
    var cached = getFromTmdbCache('actors', p);
    if (cached !== null) return cached;
    try {
        var data = getFromTmdbCache('details', p);
        if (!data) {
            var url = '/api/tmdb/details?id=' + encodeURIComponent(id) + '&type=' + encodeURIComponent(type);
            data = await safeFetch(url);
            if (data && (data.id || data.overview)) saveToTmdbCache('details', p, data);
        }
        var actors = [];
        if (data && data.cast && Array.isArray(data.cast)) {
            var limit = Math.min(CATALOG_CONSTANTS.MAX_ACTORS, data.cast.length);
            for (var i = 0; i < limit; i++) {
                var a = data.cast[i];
                actors.push({ id: a.id, name: a.name, character: a.character, profilePath: a.profile_path, order: a.order });
            }
        }
        saveToTmdbCache('actors', p, actors);
        return actors;
    } catch (e) {
        console.warn('Actors fetch error:', e);
        return [];
    }
}

async function fetchTmdbDetails(item) {
    var id = item && item.id, type = (item && item.media_type) || 'movie';
    if (!id) return null;
    var p = { id: id, type: type };
    var cached = getFromTmdbCache('details', p);
    if (cached !== null) return cached;
    var urls = [
        '/api/tmdb/details?id=' + encodeURIComponent(id) + '&type=' + encodeURIComponent(type),
        '/api/tmdb/item?id=' + encodeURIComponent(id) + '&type=' + encodeURIComponent(type)
    ];
    for (var i = 0; i < urls.length; i++) {
        var d = await safeFetch(urls[i]);
        if (d && (d.id || d.overview || d.videos || d.backdrops)) {
            saveToTmdbCache('details', p, d);
            return d;
        }
    }
    return null;
}

function mergeCatalogDetails(base) {
    var m = {};
    for (var k in base) if (base.hasOwnProperty(k)) m[k] = base[k];
    for (var i = 1; i < arguments.length; i++) {
        var src = arguments[i];
        if (!src || typeof src !== 'object') continue;
        for (var k in src) {
            if (!src.hasOwnProperty(k)) continue;
            var v = src[k];
            if (v === null || v === undefined) continue;
            if (Array.isArray(v)) { if (!Array.isArray(m[k]) || m[k].length === 0) m[k] = v.slice(); continue; }
            if (typeof v === 'string') { if (!m[k] || !String(m[k]).trim()) m[k] = v; continue; }
            if (typeof v === 'number') { if (!m[k]) m[k] = v; continue; }
            if (typeof v === 'object') {
                if (!m[k]) m[k] = {};
                for (var sk in v) if (v.hasOwnProperty(sk)) m[k][sk] = v[sk];
            }
        }
    }
    return m;
}

async function fetchCatalogItemDetails(item) {
    var p = { id: item && item.id, media_type: (item && item.media_type) || 'movie', title: getCatalogItemTitle(item) };
    var c = getFromTmdbCache('itemDetails', p);
    if (c !== null) return c;
    var tmdb = await fetchTmdbDetails(item);
    var merged = mergeCatalogDetails(item, tmdb);
    saveToTmdbCache('itemDetails', p, merged);
    return merged;
}

function getCatalogItemTitle(item) {
    return (item && item.torrent && item.torrent[0] ? item.torrent[0].name : null) ||
        (item && (item.title || item.name)) || 'Без названия';
}

function getCatalogItemYear(item) {
    var r = (item && (item.release_date || item.first_air_date || item.year || item.released)) || '';
    var m = String(r).match(/(19|20)\d{2}/);
    return m ? m[0] : null;
}

function getGenreNames(item, type) {
    type = type || 'movie';
    var names = [];
    if (item && Array.isArray(item.genres)) {
        for (var i = 0; i < item.genres.length; i++) {
            if (item.genres[i]) names.push(typeof item.genres[i] === 'string' ? item.genres[i] : item.genres[i].name);
        }
    }
    if (!names.length && item && Array.isArray(item.genre_ids)) {
        var map = TMDB_GENRES[type] || TMDB_GENRES.movie;
        for (var j = 0; j < item.genre_ids.length; j++) {
            if (map[item.genre_ids[j]]) names.push(map[item.genre_ids[j]]);
        }
    }
    var res = [];
    for (var k = 0; k < names.length; k++) if (names[k]) res.push(names[k]);
    return res;
}

function getCatalogRating(item) {
    var v = Number(item && item.vote_average);
    return Number.isFinite(v) && v > 0 ? (Math.round(v * 10) / 10).toFixed(1) : '';
}

function getNormalizedCatalogGenres(src) {
    if (!src) return [];
    var list = [], mt = (src.media_type || ((src.types && src.types.indexOf('tv') !== -1) ? 'tv' : 'movie')) === 'tv' ? 'tv' : 'movie';
    var map = TMDB_GENRES[mt] || TMDB_GENRES.movie;
    if (Array.isArray(src.genres)) for (var i = 0; i < src.genres.length; i++) { var g = src.genres[i]; if (g) list.push(String(g.name || g).trim()); }
    if (Array.isArray(src.genre_ids)) for (var j = 0; j < src.genre_ids.length; j++) { var id = src.genre_ids[j]; if (map[id] || map[String(id)]) list.push(String(map[id] || map[String(id)]).trim()); }
    if (src.genre) list.push(String(src.genre).trim());
    if (src.genre_name) list.push(String(src.genre_name).trim());
    var u = [];
    for (var k = 0; k < list.length; k++) if (list[k] && u.indexOf(list[k]) === -1) u.push(list[k]);
    return u;
}

function getSafeCatalogRating(s) {
    var r = Number((s && s.vote_average) || (s && s.rating) || (s && s.tmdb_rating));
    return Number.isFinite(r) && r > 0 && r <= 10 ? Math.round(r * 10) / 10 : null;
}

function getCatalogItemSubtitle(item, details) {
    var s = details || item || {};
    var year = getCatalogItemYear(s), type = ((item && item.media_type) || 'movie') === 'tv' ? 'Сериал' : 'Фильм';
    var genres = getNormalizedCatalogGenres(s), safe = getSafeCatalogRating(s);
    var parts = [];
    if (type) parts.push(type);
    if (year) parts.push(year);
    if (safe) parts.push(safe);
    if (genres[0]) parts.push(genres[0]);
    var txt = parts.join(' • ');
    var el = getEl('detail-subtitle');
    if (el) { el.textContent = txt; el.style.display = 'block'; }
    return txt;
}

async function fetchCatalogItemMeta(item, mediaType) {
    mediaType = mediaType || 'movie';
    var title = getCatalogItemTitle(item), year = getCatalogItemYear(item);
    var p = { title: title, year: year, mediaType: mediaType, tmdbId: item && item.id };
    var c = getFromTmdbCache('itemMeta', p);
    if (c !== null) return c;
    var best = {};
    for (var k in item) if (item.hasOwnProperty(k)) best[k] = item[k];
    var url = '/api/tmdb/search?query=' + encodeURIComponent(title) + '&type=' + mediaType + (year ? '&year=' + year : '');
    var d = await safeFetch(url);
    if (d && Array.isArray(d.results) && d.results.length) {
        for (var i = 0; i < d.results.length; i++) {
            if (String(d.results[i].id) === String(item && item.id)) { best = d.results[i]; break; }
        }
        if (!best.id) best = d.results[0];
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
    saveToTmdbCache('itemMeta', p, meta);
    return meta;
}

// ==================== ЗАГРУЗКА КАТАЛОГА ====================
async function loadCatalog(key) {
    if (!CATALOG_CONFIG[key]) return;
    AppState.backCurrentCatalog = key;
    abortCatalogRequests();
    catalogState.abortController = new AbortController();
    var config = CATALOG_CONFIG[key];
    catalogState.currentCatalog = key;
    catalogState.cardElements = {};
    catalogState.items = []; catalogState.totalItems = 0; catalogState.currentPage = 0;
    catalogState.hasMore = true; catalogState.isLoadingMore = false; catalogState.loadedItemIds = {};
    catalogState.loadedPostersCount = 0; catalogState.posterLoadQueue = [];
    catalogState.posterCache.clear();
    AppState.mediaType = config.mediaType;
    showCatalogLoading('Загрузка ' + config.name + '...');
    if (catalogCache.has(key)) {
        var cached = catalogCache.get(key);
        if (Date.now() - cached.timestamp < CATALOG_CONSTANTS.CATALOG_CACHE_TTL_MS) {
            catalogState.items = cached.data.items || [];
            catalogState.totalItems = cached.data.totalItems || catalogState.items.length;
            catalogState.currentPage = cached.data.currentPage || 0;
            catalogState.hasMore = cached.data.hasMore || false;
            for (var i = 0; i < catalogState.items.length; i++) {
                if (catalogState.items[i].id) catalogState.loadedItemIds[catalogState.items[i].id] = true;
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

async function loadHistoryCatalog() {
    abortCatalogRequests();
    catalogState.currentCatalog = 'history';
    catalogState.cardElements = {};
    catalogState.items = []; catalogState.totalItems = 0; catalogState.currentPage = 0;
    catalogState.hasMore = false; catalogState.isLoadingMore = false; catalogState.loadedItemIds = {};
    catalogState.loadedPostersCount = 0; catalogState.posterLoadQueue = [];
    AppState.mediaType = 'history';
    showCatalogLoading('Загрузка истории просмотра...');
    try {
        var data = await safeFetch(SERVER_URL + '/api/history');
        if (data && data.success && data.history && data.history.length > 0) {
            catalogState.items = data.history.map(function (item, idx) {
                var pp = item.posterPath;
                if (pp && pp.indexOf('http') !== 0) pp = (pp.indexOf('/') === 0 ? pp : '/' + pp);
                return {
                    id: item.tmdbId, title: item.title, name: item.title, media_type: item.mediaType,
                    poster_path: pp, vote_average: null, overview: null,
                    release_date: item.watchedAt ? item.watchedAt.split('T')[0] : null,
                    watchedAt: item.watchedAt, timestamp: item.timestamp,
                    isHistoryItem: true, historyIndex: idx
                };
            }).sort(function (a, b) { return b.timestamp - a.timestamp; });
            catalogState.totalItems = catalogState.items.length;
            catalogCache.set('history', {
                data: { items: catalogState.items.slice(), totalItems: catalogState.totalItems, currentPage: 1, hasMore: false },
                timestamp: Date.now()
            });
            renderCatalogGrid();
        } else {
            showEmptyHistory();
        }
    } catch (e) {
        console.error('History load error:', e);
        showCatalogError('Не удалось загрузить историю просмотра');
    }
    hideCatalogLoading();
    catalogState.abortController = null;
}

function showEmptyHistory() {
    var g = getEl('torrents-grid');
    if (!g) return;
    g.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px;"><div style="font-size:64px;margin-bottom:20px">📜</div><div style="font-size:18px;color:#aaa;margin-bottom:10px">История просмотра пуста</div><div style="font-size:14px;color:#666">Фильмы и сериалы, которые вы посмотрите, появятся здесь</div></div>';
}

async function clearHistory() {
    if (!confirm('Очистить историю просмотра?')) return;
    try {
        var d = await safeFetch(SERVER_URL + '/api/history/clear', { method: 'DELETE' });
        if (d && d.success) await loadHistoryCatalog();
        else alert('Ошибка очистки');
    } catch (e) {
        console.error(e);
        alert('Ошибка очистки: ' + e.message);
    }
}

async function loadMoreCatalogItems(reset) {
    reset = reset || false;
    if (!catalogState.currentCatalog || catalogState.isLoadingMore) return Promise.resolve(false);
    if (reset) {
        catalogState.currentPage = 0; catalogState.items = []; catalogState.loadedItemIds = {};
        catalogState.hasMore = true; catalogState.totalItems = 0;
    }
    if (!catalogState.hasMore) return Promise.resolve(false);
    catalogState.isLoadingMore = true;
    var cfg = CATALOG_CONFIG[catalogState.currentCatalog];
    var from = catalogState.currentPage * catalogState.itemsPerPage;
    try {
        var url = cfg.url + '/items?from=' + from + '&limit=' + catalogState.itemsPerPage;
        var opts = {};
        if (catalogState.abortController) opts.signal = catalogState.abortController.signal;
        var d = await safeFetch(url, opts);
        if (!d || !d.success) throw new Error('Server error');
        var newItems = d.items || [], pag = d.pagination || {};
        if (pag.total) catalogState.totalItems = pag.total;
        catalogState.hasMore = pag.hasMore !== undefined ? pag.hasMore : newItems.length === catalogState.itemsPerPage;
        var unique = [];
        for (var i = 0; i < newItems.length; i++) {
            if (!newItems[i].id || !catalogState.loadedItemIds[newItems[i].id]) {
                if (newItems[i].id) catalogState.loadedItemIds[newItems[i].id] = true;
                unique.push(newItems[i]);
            }
        }
        for (var j = 0; j < unique.length; j++) catalogState.items.push(unique[j]);
        catalogState.currentPage++;
        if (reset) renderCatalogGrid(); else appendCatalogItems(unique);
        catalogCache.set(catalogState.currentCatalog, {
            data: { items: catalogState.items.slice(), totalItems: catalogState.totalItems, currentPage: catalogState.currentPage, hasMore: catalogState.hasMore },
            timestamp: Date.now()
        });
        return Promise.resolve(true);
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.error('Catalog load error:', e);
            await fallbackLoadAllCatalogItems();
        }
        return Promise.resolve(false);
    } finally {
        catalogState.isLoadingMore = false;
    }
}

async function fallbackLoadAllCatalogItems() {
    if (!catalogState.currentCatalog) return;
    var cfg = CATALOG_CONFIG[catalogState.currentCatalog];
    try {
        var opts = {};
        if (catalogState.abortController) opts.signal = catalogState.abortController.signal;
        var d = await safeFetch(cfg.url + '/items', opts);
        if (!d || !d.success) throw new Error('Server error');
        catalogState.items = d.items || [];
        catalogState.totalItems = catalogState.items.length;
        catalogState.hasMore = false;
        catalogState.currentPage = 1;
        catalogState.loadedItemIds = {};
        for (var i = 0; i < catalogState.items.length; i++) {
            if (catalogState.items[i].id) catalogState.loadedItemIds[catalogState.items[i].id] = true;
        }
        renderCatalogGrid();
        catalogCache.set(catalogState.currentCatalog, {
            data: { items: catalogState.items.slice(), totalItems: catalogState.totalItems, currentPage: 1, hasMore: false },
            timestamp: Date.now()
        });
    } catch (e) {
        console.error('Fallback error:', e);
        showCatalogError('Ошибка загрузки каталога');
    }
}

// ==================== УНИФИЦИРОВАННОЕ СОЗДАНИЕ КАРТОЧЕК ====================
/**
 * Создает DOM-элемент карточки с унифицированной структурой
 */
function createCardElement(config) {
    var card = document.createElement('div');
    card.className = 'torrent-card ' + (config.className || '');
    for (var key in config.dataset) {
        if (config.dataset.hasOwnProperty(key)) {
            card.dataset[key] = config.dataset[key];
        }
    }
    card.innerHTML =
        '<div class="torrent-poster" style="position:relative">' +
        (config.ratingHtml || '') +
        (config.posterHtml || '<div class="no-poster">Нет постера</div>') +
        '</div>' +
        '<div class="torrent-info">' +
        '<div class="torrent-title">' + escapeHtml(config.title) + '</div>' +
        '<div class="torrent-meta">' + (config.metaHtml || '') + '</div>' +
        '</div>';
    return card;
}

// ==================== ОТОБРАЖЕНИЕ ====================
function renderCatalogGrid() {
    var grid = getEl('torrents-grid');
    if (!grid) return;
    grid.innerHTML = '';
    if (catalogState.items.length === 0) { showEmptyCatalog(); return; }
    addCatalogHeader(grid);
    var frag = document.createDocumentFragment();
    for (var i = 0; i < catalogState.items.length; i++) {
        frag.appendChild(createCatalogCard(catalogState.items[i], i));
    }
    grid.appendChild(frag);
    if (catalogState.hasMore) addLoadMoreTrigger(grid);
    catalogState.loadedPostersCount = 0;
    initPosterLazyLoading();
    //initPosterUnloading();
    initLoadMoreObserver();
    loadInitialPosters();
    requestAnimationFrame(function () {
        if (AppState.currentScreen === 'catalog' && catalogState.currentCatalog) {
            if (typeof updateFocusableElements === 'function') updateFocusableElements();
            setTimeout(function () {
                if (typeof window.focusFirstCatalogCard === 'function') window.focusFirstCatalogCard();
            }, CATALOG_CONSTANTS.FOCUS_DELAY_MS);
        }
    });
}

function appendCatalogItems(newItems) {
    var grid = getEl('torrents-grid');
    if (!grid) return;

    var old = getEl('load-more-trigger');
    if (old) old.remove();

    var start = catalogState.items.length - newItems.length;

    // Защита: запоминаем, какой каталог мы рендерим прямо сейчас
    var currentCatalogKey = catalogState.currentCatalog;
    var i = 0;
    var CHUNK_SIZE = 6; // Размер порции: 6 карточек за один кадр

    function renderChunk() {
        // ВАЖНО: Если пользователь нажал "Назад" или быстро сменил каталог,
        // пока карточки дорисовывались — немедленно прерываем цикл, 
        // чтобы не вставить старые карточки в новый каталог.
        if (catalogState.currentCatalog !== currentCatalogKey) return;

        var frag = document.createDocumentFragment();
        var end = Math.min(i + CHUNK_SIZE, newItems.length);

        // Создаем порцию карточек
        for (; i < end; i++) {
            frag.appendChild(createCatalogCard(newItems[i], start + i));
        }
        grid.appendChild(frag); // Вставляем порцию в DOM

        if (i < newItems.length) {
            // Карточки еще остались. Отдаем управление браузеру (чтобы он отрисовал кадр),
            // и планируем следующую порцию на следующий кадр.
            requestAnimationFrame(renderChunk);
        } else {
            // Все 18 карточек успешно добавлены. Выполняем финальные действия:
            if (catalogState.hasMore) addLoadMoreTrigger(grid);

            updatePosterObservers();
            //initPosterUnloading();
            initLoadMoreObserver();

            if (AppState.currentScreen === 'catalog' && catalogState.currentCatalog) {
                if (typeof updateFocusableElements === 'function') updateFocusableElements();
            }
        }
    }

    // Запускаем отрисовку первой порции
    requestAnimationFrame(renderChunk);
}

function createCatalogCard(item, index) {
    var title = getCatalogItemTitle(item);
    var mt = item.media_type || 'movie';
    var id = item.id;
    var rating = item.vote_average ? Math.round(item.vote_average * 10) / 10 : null;
    var cacheKey = id + '_' + mt;
    var cached = catalogState.posterCache.get(cacheKey);
    var ratingColor = rating ? getRatingColor(rating) : '';
    var ratingHtml = rating ?
        '<div class="rating-badge" style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.5);color:' + ratingColor + ';font-weight:bold;font-size:14px;padding:4px 8px;border-radius:12px;z-index:10;border:1px solid ' + ratingColor + ';box-shadow:0 4px 20px rgba(0,0,0,0.25);">' + rating + '</div>' : '';

    var posterHtml = cached ?
        '<img src="' + cached + '" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover">' :
        '<div class="no-poster catalog-poster-loading"></div>';

    var year = getCatalogItemYear(item);
    var badgeText = year || 'Каталог';
    var card = createCardElement({
        className: 'catalog-card',
        dataset: {
            catalogIndex: index,
            title: title,
            mediaType: mt,
            tmdbId: id,
            itemId: item.id,
            rating: rating || '',
            numIndex: item.num_index !== undefined ? item.num_index : index
        },
        title: title.substring(0, 60) + (title.length > 60 ? '...' : ''),
        ratingHtml: ratingHtml,
        posterHtml: posterHtml,
        metaHtml: '<span>' + (mt === 'tv' ? 'Сериал' : 'Фильм') + '</span><span class="torrent-badge catalog-badge">' + badgeText + '</span>'
    });
    catalogState.cardElements[index] = card;
    return card;
}

// Event Delegation для сетки
document.addEventListener('DOMContentLoaded', function () {
    var grid = getEl('torrents-grid');
    if (!grid) return;
    grid.addEventListener('click', function (e) {
        var card = e.target.closest('.torrent-card.catalog-card');
        if (card && catalogState.currentCatalog) {
            var idx = parseInt(card.dataset.catalogIndex, 10);
            if (!isNaN(idx) && catalogState.items[idx]) onCatalogItemClick(catalogState.items[idx], idx);
            return;
        }
        var folder = e.target.closest('.catalog-folder-card');
        if (folder) {
            var key = folder.dataset.catalogKey;
            if (key === 'history') loadHistoryCatalog();
            else loadCatalog(key);
        }
    });
});

function formatLastModifiedDate(iso) {
    if (!iso) return 'Дата неизвестна';
    var d = new Date(iso), now = new Date(), h = (now - d) / 3600000;
    var dd = ('0' + d.getDate()).slice(-2), mm = ('0' + (d.getMonth() + 1)).slice(-2), yy = d.getFullYear();
    var hh = ('0' + d.getHours()).slice(-2), min = ('0' + d.getMinutes()).slice(-2);
    var ago = h < 1 ? Math.floor(h * 60) + ' мин. назад' : h < 24 ? Math.floor(h) + ' ч. назад' : Math.floor(h / 24) + ' дн. назад';
    return dd + '.' + mm + '.' + yy + ' ' + hh + ':' + min + ' (' + ago + ')';
}

async function checkAndUpdateCatalogIfNeeded(id, iso) {
    if (!iso) return false;
    var h = (new Date() - new Date(iso)) / 3600000;
    if (h > CATALOG_CONSTANTS.CATALOG_UPDATE_THRESHOLD_HOURS) {
        try {
            var d = await safeFetch(SERVER_URL + '/api/catalog/' + id + '/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            if (d && d.success) {
                catalogCache.delete(id);
                if (catalogState.currentCatalog === id) {
                    setTimeout(function () { loadCatalog(id); }, 500);
                }
                return true;
            }
        } catch (e) {
            console.error('Catalog update error:', e);
        }
    }
    return false;
}

function addCatalogHeader(grid) {
    var header = document.createElement('div');
    header.className = 'catalog-header';
    header.style.cssText = 'grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;padding:15px 20px;background:rgba(74,158,255,0.1);border-radius:16px;border:1px solid rgba(74,158,255,0.3);flex-wrap:wrap;gap:10px;';
    var name = (CATALOG_CONFIG[catalogState.currentCatalog] && CATALOG_CONFIG[catalogState.currentCatalog].name) || 'Каталог';
    if (catalogState.currentCatalog === 'history') {
        header.innerHTML = '<div style="display:flex;flex-direction:column;gap:5px"><span style="font-size:20px;font-weight:600;color:#4a9eff">' + name + '</span><div style="display:flex;gap:15px;font-size:12px;color:#aaa"><span>' + catalogState.items.length + ' записей</span></div></div>';
        var btn = getEl('clear-history-btn');
        if (btn) btn.onclick = clearHistory;
        grid.appendChild(header);
        return;
    }
    header.innerHTML = '<span style="font-size:20px;font-weight:600;color:#4a9eff">' + name + '</span><span style="font-size:14px;color:#aaa;background:rgba(0,0,0,0.3);padding:5px 12px;border-radius:20px">' + catalogState.items.length + ' / ' + (catalogState.totalItems || catalogState.items.length) + '</span>';
    grid.appendChild(header);
    safeFetch(SERVER_URL + '/api/catalogs').then(function (d) {
        if (d && d.success && d.catalogs) {
            var info = null;
            for (var i = 0; i < d.catalogs.length; i++) {
                if (d.catalogs[i].id === catalogState.currentCatalog) { info = d.catalogs[i]; break; }
            }
            if (info && info.lastModifiedISO) {
                checkAndUpdateCatalogIfNeeded(info.id, info.lastModifiedISO);
                header.innerHTML += '<div style="display:flex;gap:15px;font-size:12px;color:#aaa;margin-top:4px"><span>' + formatLastModifiedDate(info.lastModifiedISO) + '</span></div>';
            }
        }
    });
}

function addLoadMoreTrigger(grid) {
    var t = document.createElement('div');
    t.id = 'load-more-trigger';
    t.className = 'load-more-trigger';
    t.style.cssText = 'grid-column:1/-1;height:50px;margin:20px 0;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:14px;';
    t.innerHTML = '<div class="loading-spinner-small" style="width:20px;height:20px;border:2px solid rgba(74,158,255,0.2);border-top-color:#4a9eff;border-radius:50%;animation:spinner-rotate 1s infinite;margin-right:10px;display:none"></div><span>Загрузка дополнительных элементов...</span>';
    grid.appendChild(t);
}

function showEmptyCatalog() {
    var g = getEl('torrents-grid');
    if (!g) return;
    g.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px"><div style="font-size:48px;margin-bottom:20px">🎬</div><div style="font-size:18px;color:#aaa">Каталог пуст</div></div>';
}

function initLoadMoreObserver() {
    if (catalogState.loadMoreObserver) catalogState.loadMoreObserver.disconnect();
    var t = getEl('load-more-trigger');
    if (!t) return;
    catalogState.loadMoreObserver = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
            if (entries[i].isIntersecting && catalogState.hasMore && !catalogState.isLoadingMore) {
                var sp = t.querySelector('.loading-spinner-small');
                if (sp) sp.style.display = 'inline-block';
                loadMoreCatalogItems().then(function () { if (sp) sp.style.display = 'none'; });
            }
        }
    }, { rootMargin: CATALOG_CONSTANTS.LOAD_MORE_MARGIN_PX + 'px', threshold: 0.1 });
    catalogState.loadMoreObserver.observe(t);
}

// ==================== ПОСТЕРЫ ====================

function initPosterUnloading() {
    if (catalogState.unloadObserver) catalogState.unloadObserver.disconnect();

    // Один наблюдатель на оба случая: выгрузка (далеко за экраном)
    // и повторная загрузка (карточка возвращается в зону видимости).
    // threshold: 0 — самый надёжный триггер, гарантированно срабатывает в обе стороны.
    catalogState.unloadObserver = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            var card = entry.target;
            var posterDiv = card.querySelector('.torrent-poster');
            if (!posterDiv) continue;
            var img = posterDiv.querySelector('img');

            if (entry.isIntersecting) {
                // Карточка вернулась в зону видимости. Если постер был выгружен
                // (нет <img>) — ставим её в очередь на повторную загрузку.
                if (!img) {
                    var idx = parseInt(card.dataset.catalogIndex, 10);
                    if (!isNaN(idx) && catalogState.items[idx]) {
                        addToPosterQueue(idx);
                    }
                }
            } else {
                // Карточка далеко за пределами экрана — выгружаем постер, освобождая RAM.
                if (img) {
                    posterDiv.innerHTML = '<div class="no-poster catalog-poster-loading">⏳</div>';
                }
            }
        }
    }, { rootMargin: '1500px 0px', threshold: 0 });

    var cards = document.querySelectorAll('.torrent-card.catalog-card');
    for (var i = 0; i < cards.length; i++) {
        catalogState.unloadObserver.observe(cards[i]);
    }
}

function loadInitialPosters() {
    var idxs = [];
    var limit = Math.min(catalogState.postersPerBatch, catalogState.items.length);
    for (var i = 0; i < limit; i++) {
        var it = catalogState.items[i];
        if (!it) continue;
        if (!catalogState.posterCache.has(it.id + '_' + (it.media_type || 'movie'))) idxs.push(i);
    }
    if (idxs.length > 0) loadPosterBatch(idxs);
}

function initPosterLazyLoading() {
    if (catalogState.posterObserver) catalogState.posterObserver.disconnect();
    catalogState.posterObserver = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
            if (entries[i].isIntersecting) {
                var idx = parseInt(entries[i].target.dataset.catalogIndex, 10);
                var it = catalogState.items[idx];
                if (!it) continue;
                var key = it.id + '_' + (it.media_type || 'movie');
                if (!catalogState.posterCache.has(key) && catalogState.posterLoadQueue.indexOf(idx) === -1) {
                    addToPosterQueue(idx);
                }
            }
        }
    }, { rootMargin: CATALOG_CONSTANTS.POSTER_OBSERVER_MARGIN_PX + 'px', threshold: 0.1 });
    var cards = document.querySelectorAll('.torrent-card.catalog-card');
    for (var i = 0; i < cards.length; i++) {
        var it = catalogState.items[i];
        if (!it) continue;
        if (!catalogState.posterCache.has(it.id + '_' + (it.media_type || 'movie'))) {
            catalogState.posterObserver.observe(cards[i]);
        }
    }
}

function updatePosterObservers() {
    if (!catalogState.posterObserver) return;
    var cards = document.querySelectorAll('.torrent-card.catalog-card');
    for (var i = 0; i < cards.length; i++) {
        var it = catalogState.items[i];
        if (!it) continue;
        if (!catalogState.posterCache.has(it.id + '_' + (it.media_type || 'movie'))) {
            try { catalogState.posterObserver.observe(cards[i]); } catch (e) { }
        }
    }
}

function addToPosterQueue(idx) {
    if (catalogState.posterLoadQueue.indexOf(idx) !== -1) return;
    catalogState.posterLoadQueue.push(idx);
    if (!catalogState.isPosterLoading) loadNextPosterBatch();
}

function loadNextPosterBatch() {
    if (catalogState.isPosterLoading || catalogState.posterLoadQueue.length === 0) return;
    catalogState.posterLoadQueue.sort(function (a, b) { return a - b; });
    var next = catalogState.posterLoadQueue.splice(0, catalogState.postersPerBatch);
    loadPosterBatch(next);
}

function loadPosterBatch(indices) {
    if (indices.length === 0) return;
    catalogState.isPosterLoading = true;

    var i = 0;
    function processNext() {
        if (i >= indices.length) {
            catalogState.isPosterLoading = false;
            if (catalogState.posterLoadQueue.length > 0) {
                // Небольшая пауза перед следующей партией
                setTimeout(loadNextPosterBatch, 15);
            }
            return;
        }

        loadPosterForIndex(indices[i]).then(function () {
            i++;
            // Пауза 100-150мс между постерами дает главному потоку время на отрисовку кадров (60 FPS)
            setTimeout(processNext, 5);
        }).catch(function () {
            i++;
            setTimeout(processNext, 5);
        });
    }
    processNext();
}

async function loadPosterForIndex(index) {
    var item = catalogState.items[index];
    if (!item) return;
    var card = catalogState.cardElements[index];
    if (!card) return;
    await loadCatalogPoster(card, getCatalogItemTitle(item), item.media_type || 'movie', item.id, index);
}

/**
 * Загружает постер для карточки с использованием LRU-кэша
 */
async function loadCatalogPoster(card, title, mt, id, index) {
    var div = card.querySelector('.torrent-poster');
    if (!div) return;
    var key = id + '_' + mt;
    if (!catalogState.currentCatalog) {
        div.innerHTML = '<div class="no-poster">Каталог закрыт</div>';
        return;
    }
    // Проверяем LRU-кэш
    var cached = catalogState.posterCache.get(key);
    if (cached) {
        updatePosterDOM(div, card.dataset.rating, cached);
        return;
    }
    var item = catalogState.items[index];
    if (catalogState.currentCatalog === 'history' && item && item.poster_path) {
        var pp = item.poster_path.indexOf('http') === 0 ? item.poster_path :
            (AppState.protocol + '//tsimg.hnar.online/t/p/' + CATALOG_CONSTANTS.IMG_SIZES.POSTER_MEDIUM +
                (item.poster_path.indexOf('/') === 0 ? item.poster_path : '/' + item.poster_path));
        if (pp) {
            catalogState.posterCache.set(key, pp);
            updatePosterDOM(div, card.dataset.rating, pp);
            return;
        }
    }
    try {
        var url = null;
        var p = { id: id, type: mt };
        var cachedTmdb = getFromTmdbCache('poster', p);
        if (cachedTmdb && cachedTmdb.posterUrl) {
            url = cachedTmdb.posterUrl;
        } else if (id && id !== 'undefined' && id !== 'null') {
            var d = await safeFetch('/api/tmdb/item?id=' + id + '&type=' + mt);
            if (d && d.poster_path) {
                url = AppState.protocol + '//tsimg.hnar.online/t/p/' + CATALOG_CONSTANTS.IMG_SIZES.POSTER_MEDIUM + d.poster_path;
                saveToTmdbCache('poster', p, { posterUrl: url, data: d });
            }
        }
        if (!url && window.tmdb && window.tmdb.searchPoster) {
            try {
                url = await window.tmdb.searchPoster(title, null, mt, true);
                if (url) saveToTmdbCache('poster', p, { posterUrl: url });
            } catch (e) {
                console.warn('searchPoster failed:', e);
            }
        }
        if (url) {
            catalogState.posterCache.set(key, url);
        }
        updatePosterDOM(div, card.dataset.rating, url || '');
    } catch (e) {
        console.warn('❌ Ошибка загрузки постера:', e.message);
        if (catalogState.currentCatalog) div.innerHTML = '<div class="no-poster">Нет постера</div>';
    }
}

function updatePosterDOM(div, rating, url) {
    var rHtml = '';
    if (rating && rating !== 'null' && rating !== 'undefined') {
        var c = getRatingColor(parseFloat(rating));
        rHtml = '<div style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.5);color:' + c + ';font-weight:bold;font-size:14px;padding:4px 8px;border-radius:12px;z-index:10;border:1px solid ' + c + ';box-shadow:0 4px 20px rgba(0,0,0,0.25);">' + rating + '</div>';
    }

    if (!url) {
        div.innerHTML = '<div class="no-poster">Нет постера</div>' + rHtml;
        return;
    }

    // Создаем картинку в памяти, а не через innerHTML
    var img = new Image();
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';

    var insertToDom = function () {
        // Проверяем, не уничтожена ли карточка к этому моменту
        if (!div.isConnected) return;
        div.innerHTML = rHtml; // Очищаем от плейсхолдера ⏳ и ставим рейтинг
        div.appendChild(img);  // Вставляем уже декодированную картинку (без фризов)
    };

    img.onerror = function () {
        if (div.isConnected) div.innerHTML = '<div class="no-poster">Нет постера</div>' + rHtml;
    };

    img.src = url;

    if (typeof img.decode === 'function') {
        // Chrome 64+: декодируем JPEG в фоновом потоке, разгружая CPU
        img.decode().then(insertToDom).catch(insertToDom);
    } else {
        // Фоллбек для очень старых браузеров
        img.onload = insertToDom;
    }
}

// ==================== ДЕТАЛЬНЫЙ ПРОСМОТР ====================
function pushDetailHistory(item) {
    var last = detailHistory[detailHistory.length - 1];
    if (last && last.id === item.id) return;
    detailHistory.push(item);
    if (detailHistory.length > CATALOG_CONSTANTS.MAX_DETAIL_HISTORY) detailHistory.shift();
}

/**
 * Подготовка DOM для детального просмотра
 */
function setupDetailLayout(item, index, posterUrl) {
    pushDetailHistory(item);
    catalogState.lastSelectedIndex = index;
    catalogState.lastSelectedId = item.id;
    var dv = getEl('detail-view'), mc = getEl('main-container');
    var savedScroll = mc ? mc.scrollTop : 0;
    AppState.backupScroll = savedScroll;
    var oldP = document.querySelector('.detail-progress');
    if (oldP) oldP.remove();
    var dh = document.querySelector('.detail-header');
    if (dh) dh.style.background = "rgba(255, 255, 255, 0.08)";
    var aw = getEl('catalog-detail-actors-wrap');
    var rw = getEl('catalog-detail-recommendations-wrap');
    if (!aw && getEl('catalog-detail-overview')) {
        var c = document.createElement('div');
        c.id = 'catalog-detail-actors-wrap';
        c.className = 'catalog-detail-actors-wrap';
        c.innerHTML = '<div class="catalog-detail-section-title">В главных ролях</div><div id="catalog-detail-actors" class="catalog-detail-actors-grid"></div>';
        getEl('catalog-detail-overview').parentElement.insertAdjacentElement('afterend', c);
        aw = c;
    }
    if (!rw && aw) {
        var c = document.createElement('div');
        c.id = 'catalog-detail-recommendations-wrap';
        c.className = 'catalog-detail-recommendations-wrap';
        c.innerHTML = '<div class="catalog-detail-section-title">Похожие фильмы</div><div id="catalog-detail-recommendations" class="catalog-detail-recommendations-grid"></div>';
        aw.insertAdjacentElement('afterend', c);
        rw = c;
    }
    return { dv: dv, mc: mc, aw: aw, rw: rw, savedScroll: savedScroll };
}

/**
 * Рендер шапки детального просмотра (постер, заголовок, фон)
 */
function renderDetailHeader(item, posterUrl, details) {
    var pe = getEl('detail-poster');
    var te = getEl('detail-title-text');
    var se = getEl('detail-subtitle');
    var oe = getEl('catalog-detail-overview');
    var be = getEl('catalog-detail-backdrop');
    var title = getCatalogItemTitle(item);
    var mt = item.media_type || 'movie';

    te.textContent = title;

    if (se) {
        se.textContent = getCatalogItemSubtitle(item);
        se.classList.remove('hidden');
        se.style.display = 'block';
    }

    getEl('files-list').style.display = 'none';
    getEl('catalog-detail-extra').classList.remove('hidden');

    if (oe) {
        oe.textContent = 'Загрузка...';
        oe.classList.remove('hidden');
        oe.style.display = 'block';
    }

    var twInit = getEl('catalog-detail-trailers-wrap');
    var te2Init = getEl('catalog-detail-trailers');
    if (twInit) {
        twInit.classList.add('hidden');
        twInit.style.display = 'none';
    }
    if (te2Init) {
        te2Init.classList.add('hidden');
        te2Init.style.display = 'none';
    }

    //   Плейсхолдер для постера (мгновенно, без сети)
    var temp = posterUrl || catalogState.posterCache.get(item.id + '_' + mt) || '';
    pe.innerHTML = temp
        ? '<div class="catalog-poster-loading" style="width:100%;height:100%"></div>'
        : '<div class="no-poster">Нет постера</div>';

    updateCatalogWatchButton(title);

    var src = details || item || {};

    //   Постер через img.decode()
    var posterSrc = null;
    if (src.poster_path) {
        posterSrc = AppState.protocol + '//tsimg.hnar.online/t/p/' + CATALOG_CONSTANTS.IMG_SIZES.POSTER_MEDIUM + src.poster_path;
        catalogState.posterCache.set(item.id + '_' + mt, posterSrc);
    } else if (src.image && (src.image.original || src.image.medium)) {
        posterSrc = src.image.original || src.image.medium;
    } else if (temp) {
        posterSrc = temp;
    }

    if (posterSrc) {
        _loadImageDecoded(pe, posterSrc, 'poster');
    }

    if (se) {
        se.textContent = getCatalogItemSubtitle(item, src);
        se.classList.remove('hidden');
        se.style.display = 'block';
    }

    if (oe) {
        oe.textContent = src.overview || item.overview || 'Описание пока недоступно';
        oe.classList.remove('hidden');
        oe.style.display = 'block';
    }

    // Backdrop через img.decode()
    var bp = src.backdrop_path || (Array.isArray(src.backdrops) && src.backdrops[0] && src.backdrops[0].file_path);
    if (bp) {
        var bpUrl = bp.indexOf('http') === 0 ? bp : AppState.protocol + '//tsimg.hnar.online/t/p/' + CATALOG_CONSTANTS.IMG_SIZES.BACKDROP + bp;
        _loadBackdropDecoded(be, bpUrl);
    } else {
        be.classList.add('hidden');
        be.style.backgroundImage = '';
    }

    // Сброс кнопок для новой карточки
    resetDetailButtons();
}

// ==================== ФОНОВОЕ ВОСПРОИЗВЕДЕНИЕ ТРЕЙЛЕРА ====================

/**
 * Создаёт/показывает фоновое видео без звука
 */
function startTrailerBackground(url) {
    if (!url) return;
    stopTrailerBackground();

    var dv = getEl('detail-view');
    if (!dv) return;

    var video = document.createElement('video');
    video.id = 'trailer-bg-video';
    video.muted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    video.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;opacity:0;pointer-events:none;transition:opacity 2s ease;';

    var backdrop = getEl('catalog-detail-backdrop');
    var cde = getEl('catalog-detail-extra');
    if (backdrop && backdrop.parentNode === dv) {
        dv.insertBefore(video, backdrop);
    } else {
        dv.insertBefore(video, dv.firstChild);
    }

    //   Скрываем backdrop, пока играет трейлер
    if (backdrop) backdrop.classList.add('hidden');
    if (cde) {
        cde.style.opacity = '0.4';
    }

    rutubeTrailerState.bgVideo = video;
    var started = false;

    // Запуск HLS или прямого URL
    if (window.Hls && Hls.isSupported()) {
        var hls = new Hls({
            maxBufferSize: 30 * 1024 * 1024,
            maxBufferLength: 10,
            startLevel: 2,          // среднее качество — это только фон
            enableWorker: true
        });
        hls.loadSource(wrapRutubeHls(url));
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, function () {
            video.play().catch(function () { });
        });
        video._hls = hls;
        started = true;
    } else {
        video.src = wrapRutubeHls(url);
        video.play().catch(function () { });
        started = true;
    }

    if (started) {
        // Плавное проявление
        requestAnimationFrame(function () {
            video.style.opacity = '1';
        });
    }
}

/**
 * Останавливает и удаляет фоновое видео, возвращает backdrop
 */
function stopTrailerBackground() {
    var video = rutubeTrailerState.bgVideo || getEl('trailer-bg-video');
    if (video) {
        if (video._hls) {
            video._hls.destroy();
            video._hls = null;
        }
        try { video.pause(); } catch (e) { }
        video.removeAttribute('src');
        try { video.load(); } catch (e) { }
        if (video.parentNode) video.parentNode.removeChild(video);
    }
    rutubeTrailerState.bgVideo = null;

    //   Возвращаем backdrop
    var backdrop = getEl('catalog-detail-backdrop');
    var cde = getEl('catalog-detail-extra');
    if (cde) {
        cde.style.opacity = '1';
    }
    if (backdrop) backdrop.classList.remove('hidden');
}

/**
 * Открывает трейлер RuTube в основном плеере
 */
async function openRutubeTrailerInPlayer(m3u8Url, title) {
    // Останавливаем фоновое видео
    stopTrailerBackground();

    if (window.AndroidJS) {
        var playerData = { url: m3u8Url, title: title || 'Видео', iptv: false };
        AndroidJS.openPlayer(m3u8Url, JSON.stringify(playerData));
    } else {
        var po = getEl('playback-overlay');
        if (po) {
            po.classList.add('active');
            var pt = po.querySelector('.playback-text');
            if (pt) pt.textContent = 'Загрузка трейлера: ' + title + '...';
        }

        try {
            // Сохраняем контекст для возврата
            var cd = AppState.currentDetailItem;
            var cn = catalogState.currentCatalog;
            var ci = catalogState.lastSelectedIndex;

            // Скрываем детальный просмотр
            var dv = getEl('detail-view');
            var mc = getEl('main-container');
            if (dv) { dv.style.display = 'none'; dv.style.pointerEvents = 'none'; }
            if (mc) mc.style.pointerEvents = 'none';

            // Останавливаем предыдущий поток
            var old = AppState.currentStreamId;
            if (old) fetch(SERVER_URL + '/hls/stop/' + old, { method: 'POST' }).catch(function () { });
            if (window.destroyHls) window.destroyHls();

            AppState.videoUrl = m3u8Url;
            AppState.isYoutubePlayback = true; // переиспользуем механизм возврата
            AppState.youtubeContext = { currentDetailItem: cd, catalogName: cn, itemIndex: ci };
            AppState.currentDetailItem = { title: title, hash: null, isYoutube: true, youtubeUrl: m3u8Url };

            var vp = getEl('video-player');

            if (window.Hls && Hls.isSupported()) {
                AppState.hls = new Hls({
                    maxBufferSize: 80 * 1024 * 1024,
                    maxBufferLength: 30,
                    backBufferLength: 20,
                    startLevel: -1,
                    abrEwmaDefaultEstimate: 500000,
                    fragLoadingTimeOut: 10000,
                    manifestLoadingTimeOut: 10000,
                    enableWorker: true,
                    progressive: true
                });
                AppState.hls.loadSource(wrapRutubeHls(m3u8Url));
                AppState.hls.attachMedia(vp);

                var started = false;
                AppState.hls.on(Hls.Events.MANIFEST_PARSED, function () {
                    if (typeof window.updatePlayerTitle === 'function') window.updatePlayerTitle('Трейлер: ' + title);
                    vp.currentTime = 0;
                    vp.pause();

                    var iv = setInterval(function () {
                        if (started) return clearInterval(iv);
                        if (vp.buffered && vp.buffered.length > 0 && vp.buffered.end(vp.buffered.length - 1) - vp.currentTime >= 3) {
                            clearInterval(iv);
                            if (po) po.classList.remove('active');
                            vp.play().catch(function () {
                                vp.muted = true;
                                vp.play().catch(function () { });
                                if (typeof window.updateMuteButton === 'function') window.updateMuteButton();
                            });
                            started = true;
                            getEl('player-screen').style.display = 'block';
                            getEl('config-screen').style.display = 'none';
                            getEl('torrserver-section').style.display = 'none';
                            var focused = document.querySelectorAll('.focused');
                            for (var i = 0; i < focused.length; i++) focused[i].classList.remove('focused');
                            if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();
                        }
                    }, 500);
                });

                AppState.hls.on(Hls.Events.ERROR, function (ev, d) {
                    if (d.fatal) {
                        if (po) po.classList.remove('active');
                        alert('Ошибка воспроизведения трейлера');
                    }
                });
            } else if (vp.canPlayType('application/vnd.apple.mpegurl')) {
                vp.src = wrapRutubeHls(m3u8Url);
                vp.addEventListener('loadedmetadata', function () {
                    if (typeof window.updatePlayerTitle === 'function') window.updatePlayerTitle('Трейлер: ' + title);
                    if (po) po.classList.remove('active');
                    vp.play().catch(function () { });
                    getEl('player-screen').style.display = 'block';
                });
            } else {
                throw new Error('Браузер не поддерживает HLS');
            }

            AppState.currentScreen = 'player';

        } catch (e) {
            console.error('RuTube trailer player error:', e);
            if (po) po.classList.remove('active');
            alert('Ошибка: ' + e.message);
            var dv = getEl('detail-view'), mc = getEl('main-container');
            if (dv) { dv.style.display = 'block'; dv.style.pointerEvents = 'auto'; }
            if (mc) mc.style.pointerEvents = 'auto';
        }
    }
}

//   Вспомогательная: загрузка <img> с decode()
function _loadImageDecoded(container, src, alt) {
    var img = new Image();
    img.alt = alt || '';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.3s ease';

    var insert = function () {
        if (!container.isConnected) return;
        container.innerHTML = '';
        img.style.opacity = '1';
        container.appendChild(img);
    };

    img.onerror = function () {
        if (container.isConnected) container.innerHTML = '<div class="no-poster">Нет постера</div>';
    };
    img.src = src;

    if (typeof img.decode === 'function') {
        img.decode().then(insert).catch(insert);
    } else {
        img.onload = insert;
    }
}

//   Вспомогательная: предзагрузка backdrop с decode(), потом CSS background
function _loadBackdropDecoded(container, url) {
    var img = new Image();
    img.src = url;

    var apply = function () {
        if (!container.isConnected) return;
        container.style.backgroundImage = 'url(' + url + ')';
        container.classList.remove('hidden');
    };

    if (typeof img.decode === 'function') {
        img.decode().then(apply).catch(apply);
    } else {
        img.onload = apply;
    }
}

/**
 * Рендер списка актёров
 */
async function renderDetailActors(item, aw) {
    if (!aw) return;
    var ae = getEl('catalog-detail-actors');
    ae.innerHTML = '<div class="catalog-loading"><div class="loading-spinner-small"></div><span>Загрузка актеров...</span></div>';
    aw.classList.remove('hidden');
    var actors = await fetchCatalogActors(item);
    if (actors.length > 0) {
        var frag = document.createDocumentFragment();
        actors.forEach(function (a) {
            var d = document.createElement('div');
            d.className = 'catalog-actor-card';
            d.innerHTML = '<div class="catalog-actor-photo">' +
                (a.profilePath ? '<img src="' + AppState.protocol + '//tsimg.hnar.online/t/p/' + CATALOG_CONSTANTS.IMG_SIZES.POSTER_SMALL + a.profilePath + '" loading="lazy" decoding="async" alt="' + escapeHtml(a.name) + '" onerror="this.parentElement.innerHTML=\'<div class=\\\'catalog-actor-no-photo\\\'>Нет фото</div>\'">' : '<div class="catalog-actor-no-photo">Нет фото</div>') +
                '</div><div class="catalog-actor-info"><div class="catalog-actor-name">' + escapeHtml(a.name) + '</div><div class="catalog-actor-character">' + escapeHtml(a.character || '') + '</div></div>';
            frag.appendChild(d);
        });
        ae.innerHTML = '';
        ae.appendChild(frag);
    } else {
        ae.innerHTML = '<div class="catalog-empty">Актеры не найдены</div>';
    }
}

/**
 * Рендер похожих фильмов
 */
function renderDetailRecommendations(src, rw, mt) {
    if (!rw) return;
    var re = getEl('catalog-detail-recommendations');
    if (src.recommendations && src.recommendations.length > 0) {
        re.innerHTML = '<div class="catalog-loading"><div class="loading-spinner-small"></div><span>Загрузка похожих фильмов...</span></div>';
        rw.classList.remove('hidden');
        var recs = src.recommendations.slice(0, CATALOG_CONSTANTS.MAX_RECOMMENDATIONS);
        var frag = document.createDocumentFragment();
        recs.forEach(function (r) {
            var d = document.createElement('div');
            d.className = 'catalog-recommendation-card';
            d.dataset.tmdbId = r.id;
            d.dataset.mediaType = mt;
            d.dataset.title = r.title || r.name || 'Без названия';
            var pu = r.poster_path ? AppState.protocol + '//tsimg.hnar.online/t/p/' + CATALOG_CONSTANTS.IMG_SIZES.POSTER_SMALL + r.poster_path : null;
            d.innerHTML = '<div class="catalog-recommendation-poster">' +
                (pu ? '<img src="' + pu + '" loading="lazy" decoding="async" alt="' + escapeHtml(d.dataset.title) + '" onerror="this.parentElement.innerHTML=\'<div class=\\\'catalog-recommendation-no-poster\\\'> </div>\'">' : '<div class="catalog-recommendation-no-poster"> </div>') +
                (r.vote_average ? '<div class="catalog-recommendation-rating">' + Math.round(r.vote_average * 10) / 10 + '</div>' : '') +
                '</div><div class="catalog-recommendation-info"><div class="catalog-recommendation-title">' + escapeHtml(d.dataset.title) + '</div>' +
                (r.release_date ? '<div class="catalog-recommendation-year">' + r.release_date.substring(0, 4) + '</div>' : '') +
                '</div>';
            frag.appendChild(d);
        });
        re.innerHTML = '';
        re.appendChild(frag);
    } else {
        rw.classList.add('hidden');
    }
}

/**
 * Рендер трейлеров
 */
function renderDetailTrailers(src) {
    var vids = (src.videos && Array.isArray(src.videos) ?
        src.videos.filter(function (v) {
            var t = (v.type || '').toLowerCase();
            return t.indexOf('trailer') !== -1 || t.indexOf('teaser') !== -1;
        }).slice(0, CATALOG_CONSTANTS.MAX_TRAILERS) : []);
    var tw = getEl('catalog-detail-trailers-wrap');
    var te2 = getEl('catalog-detail-trailers');
    if (vids.length > 0) {
        tw.classList.remove('hidden');
        tw.style.display = 'block';

        te2.classList.remove('hidden');
        te2.style.display = 'grid';

        te2.classList.add('catalog-detail-trailers-grid');
        te2.classList.remove('catalog-detail-trailers-links');
        te2.style.cssText = 'display:grid;grid-template-columns:repeat(6,1fr);gap:16px;padding:10px;';
        var frag = document.createDocumentFragment();
        vids.forEach(function (v) {
            var d = document.createElement('div');
            d.className = 'catalog-trailer-card-item';
            d.dataset.videoUrl = v.key;
            d.dataset.videoTitle = v.name || 'Трейлер';
            d.innerHTML = '<div class="catalog-trailer-poster" style="position:relative;aspect-ratio:4/3;overflow:hidden;border-radius:12px;background:linear-gradient(135deg,#1a1a2e,#16213e)"><img src="https://img.youtube.com/vi/' + v.key + '/mqdefault.jpg" alt="' + escapeHtml(v.name || 'Трейлер') + '" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.innerHTML=\'<div class=\\\'no-poster\\\'></div>\'"><div class="catalog-trailer-play-overlay" style="position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.3s;cursor:pointer"><div style="width:60px;height:60px;background:rgba(74,158,255,0.9);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:30px;color:white">▶</div></div>' +
                (v.duration ? '<div style="position:absolute;bottom:8px;right:8px;background:rgba(0,0,0,0.8);color:white;font-size:12px;padding:3px 8px;border-radius:12px;font-family:monospace">' + formatDuration(v.duration) + '</div>' : '') +
                '</div><div class="catalog-trailer-info hidden" style="padding:10px"><div class="catalog-trailer-title" style="font-size:14px;font-weight:600;color:#fff;margin-bottom:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(v.name || 'Трейлер') + '</div><div class="catalog-trailer-meta" style="display:flex;gap:10px;font-size:12px;color:#aaa"><span>Трейлер</span>' + (v.duration ? '<span>⏱️ ' + formatDuration(v.duration) + '</span>' : '') + '</div></div>';
            frag.appendChild(d);
        });
        te2.innerHTML = '';
        te2.appendChild(frag);
    } else {
        tw.classList.add('hidden');
        tw.style.display = 'none';
        te2.classList.add('hidden');
        te2.style.display = 'none';
    }
}

/**
 * Делегированный обработчик кликов по деталям (рекомендации и трейлеры)
 */
function setupDetailDelegation(dv) {
    // Удаляем старый обработчик, если есть
    if (dv._detailClickHandler) {
        dv.removeEventListener('click', dv._detailClickHandler);
    }
    dv._detailClickHandler = function (e) {
        // Клик по рекомендации
        var recCard = e.target.closest('.catalog-recommendation-card');
        if (recCard) {
            showCatalogDetail({
                id: recCard.dataset.tmdbId,
                media_type: recCard.dataset.mediaType,
                torrent: [{ name: recCard.dataset.title }],
                title: recCard.dataset.title,
                name: recCard.dataset.title
            }, 0, null);
            return;
        }
        // Клик по трейлеру
        var trailerCard = e.target.closest('.catalog-trailer-card-item');
        if (trailerCard) {
            if (!window.AndroidJS) hideCatalogDetailView();
            openYoutubeInPlayer(trailerCard.dataset.videoUrl, trailerCard.dataset.videoTitle);
        }
    };
    dv.addEventListener('click', dv._detailClickHandler);
}

/**
 * Главная функция показа деталей каталога
 */
async function showCatalogDetail(item, index, posterUrl) {
    var layout = setupDetailLayout(item, index, posterUrl);
    var dv = layout.dv, mc = layout.mc, aw = layout.aw, rw = layout.rw, savedScroll = layout.savedScroll;
    var title = getCatalogItemTitle(item), mt = item.media_type || 'movie';
    AppState.currentDetailItem = item;
    AppState.currentScreen = 'detail';
    AppState.detailReturnTo = 'catalog';
    if (typeof Animations !== 'undefined') Animations.animateDetailShow();
    dv.style.pointerEvents = 'auto';
    if (mc) mc.style.pointerEvents = 'none';
    if (typeof window.hideCatalogDetailExtra === 'function') window.hideCatalogDetailExtra();
    var wb = getEl('catalog-watch-btn');
    if (aw) aw.classList.add('hidden');
    if (rw) rw.classList.add('hidden');
    if (wb) {
        wb.onclick = function () {
            dv.style.display = 'none';
            dv.style.pointerEvents = 'none';
            if (mc) mc.style.pointerEvents = 'auto';
            AppState.currentScreen = 'search';
            AppState.isSearch = false;
            showCatalogSearch(wb.dataset.searchTitle || title, posterUrl, item);
        };
    }
    var restore = function () {
        if (mc && savedScroll > 0) setTimeout(function () { mc.scrollTop = savedScroll; }, 50);
    };

    var details = await fetchCatalogItemDetails(item);
    restore();

    // Рендерим все части
    renderDetailHeader(item, posterUrl, details);
    await renderDetailActors(item, aw);
    var src = details || item || {};
    renderDetailRecommendations(src, rw, mt);
    //renderDetailTrailers(src);

    //     RUTUBE ТРЕЙЛЕР    
    stopTrailerBackground();

    var trailerTitle = src.title || src.name || title;
    var trailerOriginal = src.original_title || src.original_name || '';
    var trailerDate = src.release_date || src.first_air_date || '';
    var trailerCacheKey = String(item.id || '') + '_' + mt;

    if (rutubeTrailerCache[trailerCacheKey]) {
        // Уже искали — показываем мгновенно (важно при возврате из плеера)
        rutubeTrailerState.currentUrl = rutubeTrailerCache[trailerCacheKey].url;
        rutubeTrailerState.currentTitle = rutubeTrailerCache[trailerCacheKey].title;
        showTrailerButton();
    } else {
        rutubeTrailerState.currentUrl = null;
        rutubeTrailerState.currentTitle = null;

        fetchRutubeTrailer(trailerTitle, trailerOriginal, trailerDate).then(function (result) {
            if (!result || !result.url) return;
            rutubeTrailerCache[trailerCacheKey] = {
                url: result.url,
                title: result.title || trailerTitle
            };
            // Показываем, только если пользователь всё ещё на этой карточке
            if (AppState.currentScreen === 'detail' &&
                AppState.currentDetailItem &&
                String(AppState.currentDetailItem.id) === String(item.id)) {
                rutubeTrailerState.currentUrl = result.url;
                rutubeTrailerState.currentTitle = result.title || trailerTitle;
                showTrailerButton();
            }
        }).catch(function (e) {
            console.warn('RuTube trailer search failed:', e);
        });
    }
    //     КОНЕЦ БЛОКА    

    // Делегирование событий
    setupDetailDelegation(dv);

    // Фокус на кнопку просмотра
    requestAnimationFrame(function () {
        if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
            updateFocusableElements();
            var idx = -1;
            if (typeof focusableElements !== 'undefined') {
                for (var i = 0; i < focusableElements.length; i++) {
                    if (focusableElements[i].id === 'catalog-watch-btn') { idx = i; break; }
                }
            }
            setFocus(idx !== -1 ? idx : 0);
        }
    });
}

function hideCatalogDetailView() {
    var dv = getEl('detail-view');
    if (!dv) return;

    stopTrailerBackground();

    dv.classList.remove('catalog-detail-mode');
    dv.style.backgroundImage = '';
    var se = getEl('detail-title-subtitle');
    if (se) se.textContent = '';
    AppState.detailMode = null;
}

function updateCatalogWatchButton(t) {
    var b = getEl('catalog-watch-btn');
    if (b) b.textContent = 'Поиск торрентов';
}

function onCatalogItemClick(item, index) {
    catalogState.lastSelectedIndex = index;
    catalogState.lastSelectedId = item.id;
    localStorage.setItem('lastCatalogCardIndex', item.num_index !== undefined ? item.num_index : index);
    var card = document.querySelector('.torrent-card.catalog-card[data-catalog-index="' + index + '"]');
    var pu = null;
    if (card) {
        var img = card.querySelector('.torrent-poster img');
        if (img && img.src) pu = img.src;
    }
    AppState.catalogIndex = index;
    AppState.catalogPu = pu;
    AppState.androidBackCatalog = item;
    showCatalogDetail(item, index, pu);
}

function showCatalogSearch(q, pu, item) {
    var st = getEl('tab-search'), tt = getEl('tab-torrents'), ct = getEl('tab-catalog'), so = getEl('search-overlay'), si = getEl('search-query');
    if (st && tt && ct && so) {
        st.classList.add('active');
        tt.classList.remove('active');
        ct.classList.remove('active');
        so.classList.remove('hidden');
        if (si) { si.value = q; if (document.activeElement === si) si.blur(); }
        window.pendingCatalogPoster = pu;
        window.pendingCatalogItem = item;
        AppState.searchReturnTo = 'detail';
        if (item) {
            AppState.pendingDetailItem = item;
            AppState.pendingDetailPoster = pu;
            AppState.pendingDetailIndex = catalogState.lastSelectedIndex;
        }
        AppState.currentScreen = 'search';
        if (typeof window.searchTorrents === 'function') {
            var tm = getEl('torrent-movie');
            if (tm) tm.value = 'torrentsearch';
            window.searchTorrentsLegacy(q);
        }
        setTimeout(function () {
            if (typeof window.focusSearchHome === 'function') window.focusSearchHome(true);
        }, 200);
    }
}

async function openYoutubeInPlayer(url, title) {
    var po = getEl('playback-overlay');
    if (po) {
        po.classList.add('active');
        var pt = po.querySelector('.playback-text');
        if (pt) pt.textContent = 'Загрузка трейлера: ' + title + '...';
    }
    try {
        var videoId = url;
        var apiUrl = 'https://tube.vidaapp.cfd/api/v1/video?v=' + videoId + '&device=vidaa-968394708';
        var data = await safeFetch(apiUrl);
        if (!data) throw new Error('Не удалось получить данные видео');
        var m3u8Url = null;
        if (data.formats && Array.isArray(data.formats)) {
            var format = data.formats.find(function (f) { return f.protocol === 'https' && f.label === '1080p'; });
            if (format && format.url) {
                m3u8Url = format.url.startsWith('https://') ? format.url : 'https://tube.vidaapp.cfd' + format.url;
            } else {
                var anyM3u8 = data.formats.find(function (f) { return f.protocol === 'https'; });
                if (anyM3u8 && anyM3u8.url) {
                    m3u8Url = anyM3u8.url.startsWith('https://') ? anyM3u8.url : 'https://tube.vidaapp.cfd' + anyM3u8.url;
                }
            }
        }
        if (!m3u8Url) throw new Error('Не найден HLS поток для видео');
        if (window.AndroidJS) {
            if (po) po.classList.remove('active');
            var playerData = { url: m3u8Url, title: title || 'Видео', iptv: false };
            AndroidJS.openPlayer(m3u8Url, JSON.stringify(playerData));
        } else {
            var cd = AppState.currentDetailItem, cn = catalogState.currentCatalog, ci = catalogState.lastSelectedIndex;
            var dv = getEl('detail-view'), mc = getEl('main-container');
            if (dv) { dv.style.display = 'none'; dv.style.pointerEvents = 'none'; }
            if (mc) mc.style.pointerEvents = 'none';
            var old = AppState.currentStreamId;
            AppState.videoUrl = url;
            AppState.isYoutubePlayback = true;
            AppState.youtubeContext = { currentDetailItem: cd, catalogName: cn, itemIndex: ci };
            AppState.currentDetailItem = { title: title, hash: null, isYoutube: true, youtubeUrl: url };
            if (old) fetch(SERVER_URL + '/hls/stop/' + old, { method: 'POST' }).catch(function () { });
            if (window.destroyHls) window.destroyHls();
            var vp = getEl('video-player');
            if (Hls.isSupported()) {
                AppState.hls = new Hls({
                    maxBufferSize: 80 * 1024 * 1024,
                    maxBufferLength: 30,
                    backBufferLength: 20,
                    startLevel: -1,
                    abrEwmaDefaultEstimate: 500000,
                    fragLoadingTimeOut: 10000,
                    manifestLoadingTimeOut: 10000,
                    enableWorker: true,
                    progressive: true
                });
                AppState.hls.loadSource(m3u8Url);
                AppState.hls.attachMedia(vp);
                var started = false;
                AppState.hls.on(Hls.Events.MANIFEST_PARSED, function () {
                    if (typeof window.updatePlayerTitle === 'function') window.updatePlayerTitle('Трейлер: ' + title);
                    vp.currentTime = 0;
                    vp.pause();
                    var iv = setInterval(function () {
                        if (started) return clearInterval(iv);
                        if (vp.buffered && vp.buffered.length > 0 && vp.buffered.end(vp.buffered.length - 1) - vp.currentTime >= 3) {
                            clearInterval(iv);
                            if (po) po.classList.remove('active');
                            vp.play().catch(function () {
                                vp.muted = true;
                                vp.play().catch(function () { });
                                if (typeof window.updateMuteButton === 'function') window.updateMuteButton();
                            });
                            started = true;
                            getEl('player-screen').style.display = 'block';
                            getEl('config-screen').style.display = 'none';
                            getEl('torrserver-section').style.display = 'none';
                            var focused = document.querySelectorAll('.focused');
                            for (var i = 0; i < focused.length; i++) focused[i].classList.remove('focused');
                            if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();
                        }
                    }, 500);
                });
                AppState.hls.on(Hls.Events.ERROR, function (ev, d) {
                    if (d.fatal) {
                        if (po) po.classList.remove('active');
                        alert('Ошибка воспроизведения');
                    }
                });
            } else if (vp.canPlayType('application/vnd.apple.mpegurl')) {
                vp.src = m3u8Url;
                vp.addEventListener('loadedmetadata', function () {
                    if (typeof window.updatePlayerTitle === 'function') window.updatePlayerTitle('Трейлер: ' + title);
                    if (po) po.classList.remove('active');
                    vp.play().catch(function () { });
                    getEl('player-screen').style.display = 'block';
                });
            } else {
                throw new Error('Браузер не поддерживает HLS');
            }
            AppState.currentScreen = 'player';
        }
    } catch (e) {
        console.error('YouTube error:', e);
        if (po) po.classList.remove('active');
        alert('Ошибка: ' + e.message);
        var dv = getEl('detail-view'), mc = getEl('main-container');
        if (dv) { dv.style.display = 'block'; dv.style.pointerEvents = 'auto'; }
        if (mc) mc.style.pointerEvents = 'auto';
    }
}

function exitYoutubePlayer() {
    if (AppState.currentStreamId) {
        fetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST' }).catch(function () { });
        AppState.currentStreamId = null;
    }
    if (AppState.hls) { AppState.hls.destroy(); AppState.hls = null; }
    AppState.isYoutubePlayback = false;
    var ctx = AppState.youtubeContext;
    if (ctx && ctx.currentDetailItem && ctx.currentDetailItem.id) {
        AppState.currentScreen = 'detail';
        getEl('player-screen').style.display = 'none';
        var dv = getEl('detail-view'), mc = getEl('main-container');
        if (dv) { dv.style.display = 'block'; dv.style.pointerEvents = 'auto'; }
        if (mc) mc.style.pointerEvents = 'auto';
        setTimeout(function () { showCatalogDetail(ctx.currentDetailItem, ctx.itemIndex || 0, null); }, 100);
        AppState.youtubeContext = null;
    } else if (catalogState && catalogState.currentCatalog) {
        if (typeof window.showCatalogList === 'function') window.showCatalogList();
    } else {
        var ts = getEl('torrserver-section');
        if (ts) ts.style.display = 'block';
        getEl('config-screen').style.display = 'none';
        if (typeof loadTorrents === 'function') loadTorrents(true);
    }
    setTimeout(function () {
        if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
            updateFocusableElements();
            var b = getEl('catalog-watch-btn'), i = -1;
            if (typeof focusableElements !== 'undefined') {
                for (var k = 0; k < focusableElements.length; k++) {
                    if (focusableElements[k].id === 'catalog-watch-btn') { i = k; break; }
                }
            }
            if (i !== -1) setFocus(i);
            else if (typeof window.focusFirstCatalogCard === 'function') window.focusFirstCatalogCard();
            else setFocus(0);
        }
    }, 200);
}

// ==================== СПИСОК КАТАЛОГОВ ====================
async function fetchAvailableCatalogs() {
    var d = await safeFetch(SERVER_URL + '/api/catalogs');
    return (d && d.success && d.catalogs) ? d.catalogs : [];
}

async function showCatalogList() {
    var grid = getEl('torrents-grid');
    if (!grid) return;
    abortCatalogRequests();
    catalogState.currentCatalog = null;
    catalogState.items = [];
    catalogState.loading = false;
    catalogState.loadedPostersCount = 0;
    catalogState.posterLoadQueue = [];
    catalogState.lastSelectedIndex = 0;
    catalogState.lastSelectedId = null;
    var catalogTab = getEl('tab-catalog');
    if (catalogTab) catalogTab.classList.add('active');
    var torrentsTab = getEl('tab-torrents');
    if (torrentsTab) torrentsTab.classList.remove('active');
    var searchTab = getEl('tab-search');
    if (searchTab) searchTab.classList.remove('active');
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px"><div class="loading-spinner" style="margin:0 auto 20px"></div><div style="font-size:16px;color:#aaa">Загрузка списка каталогов...</div></div>';
    if (cats.length === 0) cats = await fetchAvailableCatalogs();
    if (AppState.currentScreen !== 'catalog') return;
    grid.innerHTML = '';
    if (cats.length === 0) {
        for (var k in CATALOG_CONFIG) {
            if (CATALOG_CONFIG.hasOwnProperty(k) && k !== 'history') {
                grid.appendChild(createCatalogFolderCard(k, CATALOG_CONFIG[k]));
            }
        }
    } else {
        for (var i = 0; i < cats.length; i++) {
            var c = cats[i];
            grid.appendChild(createCatalogFolderCard(c.id, CATALOG_CONFIG[c.id] || {
                name: c.displayName || c.id,
                mediaType: c.id.indexOf('tv') !== -1 ? 'tv' : 'movie'
            }));
        }
    }
    if (CATALOG_CONFIG.history) grid.appendChild(createCatalogFolderCard('history', CATALOG_CONFIG.history));
}

function createCatalogFolderCard(key, cfg) {
    var c = document.createElement('div');
    c.className = 'torrent-card catalog-folder-card';
    c.dataset.catalogKey = key;
    var src = POSTER_URLS[key] || '';

    // Плейсхолдер показывается МГНОВЕННО (CSS-градиент, без сети)
    var posterHtml = src
        ? '<div class="catalog-folder-poster-placeholder"></div>'
        : '<div class="no-poster" style="display:flex;align-items:center;justify-content:center;height:100%;font-size:64px">🎬</div>';

    c.innerHTML = '<div class="torrent-poster catalog-folder-poster">' + posterHtml +
        '</div><div class="torrent-info"><div class="torrent-title">' + cfg.name +
        '</div><div class="torrent-meta"><span></span><span class="torrent-badge catalog-badge"></span></div></div>';

    // Асинхронная загрузка и декодирование картинки ПОСЛЕ рендеринга карточки
    if (src) {
        var posterDiv = c.querySelector('.torrent-poster');
        var img = new Image();
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.3s ease';

        var insertImage = function () {
            // Проверяем, не уничтожена ли карточка к этому моменту
            if (!posterDiv.isConnected) return;
            var ph = posterDiv.querySelector('.catalog-folder-poster-placeholder');
            if (ph) ph.remove();
            img.style.opacity = '1';
            posterDiv.appendChild(img);
        };

        img.onerror = function () {
            if (!posterDiv.isConnected) return;
            posterDiv.innerHTML = '<div class="no-poster">Нет постера</div>';
        };

        img.src = src;

        if (typeof img.decode === 'function') {
            // Chromium 64+: декодируем JPEG в фоновом потоке, не блокируя main thread
            img.decode().then(insertImage).catch(insertImage);
        } else {
            // Фоллбек для очень старых браузеров
            img.onload = insertImage;
        }
    }

    return c;
}

function showCatalogLoading(msg) {
    var g = getEl('torrents-grid');
    if (g) g.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px"><div class="loading-spinner" style="margin:0 auto 20px"></div><div style="font-size:16px;color:#aaa">' + (msg || 'Загрузка...') + '</div></div>';
}

function showCatalogError(msg) {
    var g = getEl('torrents-grid');
    if (g) g.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px"><div style="font-size:48px;margin-bottom:20px">⚠️</div><div style="font-size:16px;color:#ff6a6a">' + msg + '</div><button class="btn" style="margin-top:20px" onclick="window.loadCatalogList()">Попробовать снова</button></div>';
}

function hideCatalogLoading() { }

function backToCatalogList() {
    abortCatalogRequests();
    catalogCache.clear();
    catalogState.currentCatalog = null;
    catalogState.items = [];
    catalogState.cardElements = {};
    catalogState.totalItems = 0;
    catalogState.currentPage = 0;
    catalogState.hasMore = true;
    catalogState.isLoadingMore = false;
    catalogState.loadedItemIds = {};
    catalogState.loadedPostersCount = 0;
    catalogState.posterLoadQueue = [];
    catalogState.posterCache.clear();
    catalogState.lastSelectedIndex = 0;
    catalogState.lastSelectedId = null;
    localStorage.removeItem('lastCatalogCardIndex');
    showCatalogList();
    requestAnimationFrame(function () {
        if (AppState.currentScreen === 'catalog') {
            if (typeof updateFocusableElements === 'function') updateFocusableElements();
            setTimeout(function () {
                if (typeof window.focusFirstCatalogCard === 'function') window.focusFirstCatalogCard();
            }, CATALOG_CONSTANTS.FOCUS_DELAY_MS);
        }
    });
}

// ==================== НАВИГАЦИЯ ====================
window.loadMoreAndFocus = async function (idx, cols) {
    if (!catalogState.currentCatalog || catalogState.isLoadingMore) return;
    var t = getEl('load-more-trigger');
    if (t) { var s = t.querySelector('.loading-spinner-small'); if (s) s.style.display = 'inline-block'; }
    var row = Math.floor(idx / cols) + 1;
    await loadMoreCatalogItems();
    setTimeout(function () {
        var cards = document.querySelectorAll('.torrent-card.catalog-card');
        var ni = row * cols;
        if (cards.length > ni) {
            if (typeof updateFocusableElements === 'function') updateFocusableElements();
            setTimeout(function () {
                var tc = cards[ni];
                if (tc && typeof setFocus === 'function') {
                    var gi = -1;
                    if (typeof focusableElements !== 'undefined') {
                        for (var j = 0; j < focusableElements.length; j++) {
                            if (tc === focusableElements[j]) { gi = j; break; }
                        }
                    }
                    if (gi !== -1) setFocus(gi);
                }
            }, 100);
        }
        if (t) { var s = t.querySelector('.loading-spinner-small'); if (s) s.style.display = 'none'; }
    }, 300);
};

window.checkAndLoadMoreOnNavigation = function () {
    if (catalogState.currentCatalog && catalogState.hasMore && !catalogState.isLoadingMore) {
        loadMoreCatalogItems().then(function () {
            var t = getEl('load-more-trigger');
            if (t) { var s = t.querySelector('.loading-spinner-small'); if (s) s.style.display = 'none'; }
        });
    }
};

window.focusCatalogCardByIndex = function (target) {
    if (AppState.currentScreen !== 'catalog') return 0;
    if (typeof updateFocusableElements === 'function') updateFocusableElements();
    var cards = document.querySelectorAll('.torrent-card.catalog-card'), idx = 0;
    for (var i = 0; i < cards.length; i++) {
        if (cards[i].dataset.numIndex && parseInt(cards[i].dataset.numIndex) === target) { idx = i; break; }
    }
    if (idx === 0 && target < cards.length) idx = target;
    return idx;
};

window.addToWatchHistory = async function (id, title, mt, pp) {
    try {
        var save = pp || null;
        var pre = AppState.protocol + '//tsimg.hnar.online/t/p/' + CATALOG_CONSTANTS.IMG_SIZES.POSTER_MEDIUM;
        if (save && save.indexOf(pre) === 0) save = save.replace(pre, '');
        var d = await safeFetch('/api/history/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tmdbId: String(id), title: title, mediaType: mt, posterPath: save })
        });
        return d;
    } catch (e) {
        console.error('History save error:', e);
    }
};

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
var tmdbCleanupIv = null;

function startTmdbCleanup() {
    if (tmdbCleanupIv) clearInterval(tmdbCleanupIv);
    tmdbCleanupIv = setInterval(cleanOldTmdbCache, TMDB_CACHE_CONFIG.cleanupInterval);
}

function stopTmdbCleanup() {
    if (tmdbCleanupIv) { clearInterval(tmdbCleanupIv); tmdbCleanupIv = null; }
}

function initCatalog() {
    startTmdbCleanup();
    initCatalogDetailButtons();
    window.tmdbCache = {
        clear: clearTmdbCache,
        stats: getTmdbCacheStats,
        setEnabled: function (v) { TMDB_CACHE_CONFIG.enabled = v; },
        isEnabled: function () { return TMDB_CACHE_CONFIG.enabled; },
        setTtl: function (v) { TMDB_CACHE_CONFIG.ttl = v; }
    };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initCatalog);
else initCatalog();

window.loadCatalogList = showCatalogList;
window.backToCatalogList = backToCatalogList;
window.exitYoutubePlayer = exitYoutubePlayer;
window.loadMoreCatalogItems = loadMoreCatalogItems;
window.catalog = {
    loadCatalog: loadCatalog,
    showCatalogList: showCatalogList,
    backToCatalogList: backToCatalogList,
    tmdbCache: { clear: clearTmdbCache, stats: getTmdbCacheStats }
};
window.showCatalogDetail = showCatalogDetail;
window.detailHistory = detailHistory;
window.clearDetailHistory = clearDetailHistory;
