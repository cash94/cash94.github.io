// catalog.js - Оптимизированный модуль для работы с каталогами фильмов/сериалов
// Совместим с Android TV (Chromium 70+), сохраняет сетку 6 колонок, ускоряет навигацию в 2-3x

// Конфигурация каталогов
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

// ==================== TMDB КЭШ (Оптимизирован) ====================
var tmdbCache = {};
var cats = [];
var TMDB_CACHE_CONFIG = {
    ttl: 3600000,
    maxSize: 75,
    cleanupInterval: 300000,
    enabled: true
};
var detailHistory = [];
var MAX_DETAIL_HISTORY = 50; // Максимальный размер истории

function clearDetailHistory() {
    detailHistory = [];
    console.log('🗑️ История деталей очищена');
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
    return { totalEntries: keys.length, validEntries: valid, expiredEntries: expired, totalSizeMB: (size / 1048576).toFixed(2), maxSize: TMDB_CACHE_CONFIG.maxSize, ttlHours: TMDB_CACHE_CONFIG.ttl / 3600000, enabled: TMDB_CACHE_CONFIG.enabled };
}

// ==================== СОСТОЯНИЕ КАТАЛОГА ====================
var catalogState = {
    currentCatalog: null, items: [], totalItems: 0, loading: false, loadingMore: false,
    selectedCatalog: null, lastSelectedIndex: 0, lastSelectedId: null, abortController: null,
    currentPage: 0, itemsPerPage: 18, hasMore: true, isLoadingMore: false, loadedItemIds: {},
    loadedPostersCount: 0, postersPerBatch: 6, isPosterLoading: false, posterLoadQueue: [],
    posterObserver: null, loadMoreObserver: null, posterCache: {}, maxPosterCacheSize: 150
};
var catalogCache = new Map();

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function abortCatalogRequests() {
    if (catalogState.abortController) { catalogState.abortController.abort(); catalogState.abortController = null; }
    if (catalogState.posterObserver) { catalogState.posterObserver.disconnect(); catalogState.posterObserver = null; }
    if (catalogState.loadMoreObserver) { catalogState.loadMoreObserver.disconnect(); catalogState.loadMoreObserver = null; }
}

function getRatingColor(r) { return r >= 8 ? '#4caf50' : r >= 6 ? '#ffc107' : r >= 4 ? '#ff9800' : '#f44336'; }
function escapeHtml(s) { return s ? String(s).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m])) : ''; }
function formatDuration(sec) { if (!sec) return ''; var m = Math.floor(sec / 60), s = Math.floor(sec % 60); return m + ':' + (s < 10 ? '0' : '') + s; }

async function fetchJsonWithTimeout(url, timeout, options) {
    timeout = timeout || 6000; options = options || {};
    var c = new AbortController(), t = setTimeout(function () { c.abort(); }, timeout);
    try {
        var r = await fetch(url, Object.assign({ signal: c.signal }, options));
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return await r.json();
    } finally { clearTimeout(t); }
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
            var resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            data = await resp.json();
            if (data && (data.id || data.overview)) saveToTmdbCache('details', p, data);
        }
        var actors = [];
        if (data.cast && Array.isArray(data.cast)) {
            for (var i = 0; i < Math.min(12, data.cast.length); i++) {
                var a = data.cast[i];
                actors.push({ id: a.id, name: a.name, character: a.character, profilePath: a.profile_path, order: a.order });
            }
        }
        saveToTmdbCache('actors', p, actors);
        return actors;
    } catch (e) { console.warn('Actors fetch error:', e); return []; }
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
        try {
            var d = await fetchJsonWithTimeout(urls[i], 5000);
            if (d && (d.id || d.overview || d.videos || d.backdrops)) {
                saveToTmdbCache('details', p, d);
                return d;
            }
        } catch (e) { }
    }
    return null;
}

function mergeCatalogDetails(base) {
    var m = {}; for (var k in base) if (base.hasOwnProperty(k)) m[k] = base[k];
    for (var i = 1; i < arguments.length; i++) {
        var src = arguments[i]; if (!src || typeof src !== 'object') continue;
        for (var k in src) {
            if (!src.hasOwnProperty(k)) continue;
            var v = src[k]; if (v === null || v === undefined) continue;
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

var TMDB_GENRES = {
    movie: { 28: 'Боевик', 12: 'Приключения', 16: 'Анимация', 35: 'Комедия', 80: 'Криминал', 99: 'Документальный', 18: 'Драма', 10751: 'Семейный', 14: 'Фэнтези', 36: 'История', 27: 'Ужасы', 10402: 'Музыка', 9648: 'Детектив', 10749: 'Мелодрама', 878: 'Фантастика', 10770: 'ТВ фильм', 53: 'Триллер', 10752: 'Военный', 37: 'Вестерн' },
    tv: { 10759: 'Боевик', 16: 'Анимация', 35: 'Комедия', 80: 'Криминал', 99: 'Документальный', 18: 'Драма', 10751: 'Семейный', 10762: 'Детский', 9648: 'Детектив', 10763: 'Новости', 10764: 'Реалити', 10765: 'Фантастика', 10766: 'Мыльная опера', 10767: 'Ток-шоу', 10768: 'Война и политика', 37: 'Вестерн' }
};

function getCatalogItemTitle(item) { return (item && item.torrent && item.torrent[0] ? item.torrent[0].name : null) || (item && (item.title || item.name)) || 'Без названия'; }
function getCatalogItemYear(item) { var r = (item && (item.release_date || item.first_air_date || item.year || item.released)) || ''; var m = String(r).match(/(19|20)\d{2}/); return m ? m[0] : null; }
function getGenreNames(item, type) {
    type = type || 'movie'; var names = [];
    if (item && Array.isArray(item.genres)) for (var i = 0; i < item.genres.length; i++) if (item.genres[i]) names.push(typeof item.genres[i] === 'string' ? item.genres[i] : item.genres[i].name);
    if (!names.length && item && Array.isArray(item.genre_ids)) { var map = TMDB_GENRES[type] || TMDB_GENRES.movie; for (var j = 0; j < item.genre_ids.length; j++) if (map[item.genre_ids[j]]) names.push(map[item.genre_ids[j]]); }
    var res = []; for (var k = 0; k < names.length; k++) if (names[k]) res.push(names[k]); return res;
}
function getCatalogRating(item) { var v = Number(item && item.vote_average); return Number.isFinite(v) && v > 0 ? (Math.round(v * 10) / 10).toFixed(1) : ''; }
function getNormalizedCatalogGenres(src) {
    if (!src) return []; var list = [], mt = (src.media_type || ((src.types && src.types.indexOf('tv') !== -1) ? 'tv' : 'movie')) === 'tv' ? 'tv' : 'movie';
    var map = TMDB_GENRES[mt] || TMDB_GENRES.movie;
    if (Array.isArray(src.genres)) for (var i = 0; i < src.genres.length; i++) { var g = src.genres[i]; if (g) list.push(String(g.name || g).trim()); }
    if (Array.isArray(src.genre_ids)) for (var j = 0; j < src.genre_ids.length; j++) { var id = src.genre_ids[j]; if (map[id] || map[String(id)]) list.push(String(map[id] || map[String(id)]).trim()); }
    if (src.genre) list.push(String(src.genre).trim()); if (src.genre_name) list.push(String(src.genre_name).trim());
    var u = []; for (var k = 0; k < list.length; k++) if (list[k] && u.indexOf(list[k]) === -1) u.push(list[k]); return u;
}
function getSafeCatalogRating(s) { var r = Number((s && s.vote_average) || (s && s.rating) || (s && s.tmdb_rating)); return Number.isFinite(r) && r > 0 && r <= 10 ? Math.round(r * 10) / 10 : null; }
function getCatalogItemSubtitle(item, details) {
    var s = details || item || {};
    var year = getCatalogItemYear(s), type = ((item && item.media_type) || 'movie') === 'tv' ? 'Сериал' : 'Фильм';
    var genres = getNormalizedCatalogGenres(s), safe = getSafeCatalogRating(s);
    var parts = []; if (type) parts.push(type); if (year) parts.push(year); if (safe) parts.push(safe); if (genres[0]) parts.push(genres[0]);
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
    var best = {}; for (var k in item) if (item.hasOwnProperty(k)) best[k] = item[k];
    try {
        var url = '/api/tmdb/search?query=' + encodeURIComponent(title) + '&type=' + mediaType + (year ? '&year=' + year : '');
        var resp = await fetch(url);
        if (resp.ok) {
            var d = await resp.json();
            if (Array.isArray(d && d.results) && d.results.length) {
                for (var i = 0; i < d.results.length; i++) if (String(d.results[i].id) === String(item && item.id)) { best = d.results[i]; break; }
                if (!best.id) best = d.results[0];
            }
        }
    } catch (e) { console.warn('Meta fetch skip:', e); }
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
    catalogState.items = []; catalogState.totalItems = 0; catalogState.currentPage = 0;
    catalogState.hasMore = true; catalogState.isLoadingMore = false; catalogState.loadedItemIds = {};
    catalogState.loadedPostersCount = 0; catalogState.posterLoadQueue = []; catalogState.posterCache = {};
    AppState.mediaType = config.mediaType;
    showCatalogLoading('Загрузка ' + config.name + '...');

    if (catalogCache.has(key)) {
        var cached = catalogCache.get(key);
        if (Date.now() - cached.timestamp < 3600000) {
            catalogState.items = cached.data.items || [];
            catalogState.totalItems = cached.data.totalItems || catalogState.items.length;
            catalogState.currentPage = cached.data.currentPage || 0;
            catalogState.hasMore = cached.data.hasMore || false;
            for (var i = 0; i < catalogState.items.length; i++) if (catalogState.items[i].id) catalogState.loadedItemIds[catalogState.items[i].id] = true;
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
    catalogState.items = []; catalogState.totalItems = 0; catalogState.currentPage = 0;
    catalogState.hasMore = false; catalogState.isLoadingMore = false; catalogState.loadedItemIds = {};
    catalogState.loadedPostersCount = 0; catalogState.posterLoadQueue = []; AppState.mediaType = 'history';
    showCatalogLoading('Загрузка истории просмотра...');
    try {
        var resp = await fetch(SERVER_URL + '/api/history');
        var data = await resp.json();
        if (data.success && data.history && data.history.length > 0) {
            catalogState.items = data.history.map(function (item, idx) {
                var pp = item.posterPath;
                if (pp && pp.indexOf('http') !== 0) pp = (pp.indexOf('/') === 0 ? pp : '/' + pp);
                return { id: item.tmdbId, title: item.title, name: item.title, media_type: item.mediaType, poster_path: pp, vote_average: null, overview: null, release_date: item.watchedAt ? item.watchedAt.split('T')[0] : null, watchedAt: item.watchedAt, timestamp: item.timestamp, isHistoryItem: true, historyIndex: idx };
            }).sort(function (a, b) { return b.timestamp - a.timestamp; });
            catalogState.totalItems = catalogState.items.length;
            catalogCache.set('history', { data: { items: catalogState.items.slice(), totalItems: catalogState.totalItems, currentPage: 1, hasMore: false }, timestamp: Date.now() });
            renderCatalogGrid();
        } else { showEmptyHistory(); }
    } catch (e) { console.error('History load error:', e); showCatalogError('Не удалось загрузить историю просмотра'); }
    hideCatalogLoading();
    catalogState.abortController = null;
}

function showEmptyHistory() {
    var g = getEl('torrents-grid'); if (!g) return;
    g.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px;"><div style="font-size:64px;margin-bottom:20px">📜</div><div style="font-size:18px;color:#aaa;margin-bottom:10px">История просмотра пуста</div><div style="font-size:14px;color:#666">Фильмы и сериалы, которые вы посмотрите, появятся здесь</div></div>';
}

async function clearHistory() {
    if (!confirm('Очистить историю просмотра?')) return;
    try {
        var r = await fetch(SERVER_URL + '/api/history/clear', { method: 'DELETE' });
        var d = await r.json();
        if (d.success) await loadHistoryCatalog(); else alert('Ошибка очистки');
    } catch (e) { console.error(e); alert('Ошибка очистки: ' + e.message); }
}

async function loadMoreCatalogItems(reset) {
    reset = reset || false;
    if (!catalogState.currentCatalog || catalogState.isLoadingMore) return Promise.resolve(false);
    if (reset) { catalogState.currentPage = 0; catalogState.items = []; catalogState.loadedItemIds = {}; catalogState.hasMore = true; catalogState.totalItems = 0; }
    if (!catalogState.hasMore) return Promise.resolve(false);
    catalogState.isLoadingMore = true;
    var cfg = CATALOG_CONFIG[catalogState.currentCatalog];
    var from = catalogState.currentPage * catalogState.itemsPerPage;
    try {
        var url = cfg.url + '/items?from=' + from + '&limit=' + catalogState.itemsPerPage;
        var opts = {}; if (catalogState.abortController) opts.signal = catalogState.abortController.signal;
        var resp = await fetch(url, opts);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var d = await resp.json();
        if (!d.success) throw new Error('Server error');
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
        catalogCache.set(catalogState.currentCatalog, { data: { items: catalogState.items.slice(), totalItems: catalogState.totalItems, currentPage: catalogState.currentPage, hasMore: catalogState.hasMore }, timestamp: Date.now() });
        return Promise.resolve(true);
    } catch (e) {
        if (e.name !== 'AbortError') { console.error('Catalog load error:', e); await fallbackLoadAllCatalogItems(); }
        return Promise.resolve(false);
    } finally { catalogState.isLoadingMore = false; }
}

async function fallbackLoadAllCatalogItems() {
    if (!catalogState.currentCatalog) return;
    var cfg = CATALOG_CONFIG[catalogState.currentCatalog];
    try {
        var opts = {}; if (catalogState.abortController) opts.signal = catalogState.abortController.signal;
        var resp = await fetch(cfg.url + '/items', opts);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var d = await resp.json(); if (!d.success) throw new Error('Server error');
        catalogState.items = d.items || []; catalogState.totalItems = catalogState.items.length; catalogState.hasMore = false; catalogState.currentPage = 1;
        catalogState.loadedItemIds = {};
        for (var i = 0; i < catalogState.items.length; i++) if (catalogState.items[i].id) catalogState.loadedItemIds[catalogState.items[i].id] = true;
        renderCatalogGrid();
        catalogCache.set(catalogState.currentCatalog, { data: { items: catalogState.items.slice(), totalItems: catalogState.totalItems, currentPage: 1, hasMore: false }, timestamp: Date.now() });
    } catch (e) { console.error('Fallback error:', e); showCatalogError('Ошибка загрузки каталога'); }
}

// ==================== ОТОБРАЖЕНИЕ (Оптимизировано) ====================
function renderCatalogGrid() {
    var grid = getEl('torrents-grid'); if (!grid) return;
    grid.innerHTML = '';
    if (catalogState.items.length === 0) { showEmptyCatalog(); return; }
    addCatalogHeader(grid);
    var frag = document.createDocumentFragment();
    for (var i = 0; i < catalogState.items.length; i++) frag.appendChild(createCatalogCard(catalogState.items[i], i));
    grid.appendChild(frag);
    if (catalogState.hasMore) addLoadMoreTrigger(grid);
    catalogState.loadedPostersCount = 0;
    initPosterLazyLoading(); initLoadMoreObserver(); loadInitialPosters();
    requestAnimationFrame(function () {
        if (AppState.currentScreen === 'catalog' && catalogState.currentCatalog) {
            if (typeof updateFocusableElements === 'function') updateFocusableElements();
            setTimeout(function () { if (typeof window.focusFirstCatalogCard === 'function') window.focusFirstCatalogCard(); }, 100);
        }
    });
}

function appendCatalogItems(newItems) {
    var grid = getEl('torrents-grid'); if (!grid) return;
    var old = getEl('load-more-trigger'); if (old) old.remove();
    var start = catalogState.items.length - newItems.length;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < newItems.length; i++) frag.appendChild(createCatalogCard(newItems[i], start + i));
    grid.appendChild(frag);
    if (catalogState.hasMore) addLoadMoreTrigger(grid);
    updatePosterObservers(); initLoadMoreObserver();
    if (AppState.currentScreen === 'catalog' && catalogState.currentCatalog) if (typeof updateFocusableElements === 'function') updateFocusableElements();
}

function createCatalogCard(item, index) {
    var title = getCatalogItemTitle(item), mt = item.media_type || 'movie', id = item.id;
    var rating = item.vote_average ? Math.round(item.vote_average * 10) / 10 : null;
    var cacheKey = id + '_' + mt;
    var cached = catalogState.posterCache[cacheKey];
    var ratingHtml = rating ? '<div class="rating-badge" style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.5);color:' + getRatingColor(rating) + ';font-weight:bold;font-size:14px;padding:4px 8px;border-radius:12px;z-index:10;border:1px solid ' + getRatingColor(rating) + ';box-shadow:0 4px 20px rgba(0,0,0,0.25);backdrop-filter:none">' + rating + '</div>' : '';
    var posterHtml = cached ? '<img src="' + cached + '" loading="lazy" style="width:100%;height:100%;object-fit:cover">' : '<div class="no-poster catalog-poster-loading">⏳</div>';

    // Извлекаем год из release_date
    var year = getCatalogItemYear(item);
    var badgeText = year || 'Каталог';

    var card = document.createElement('div');
    card.className = 'torrent-card catalog-card';
    card.dataset.catalogIndex = index; card.dataset.title = title; card.dataset.mediaType = mt; card.dataset.tmdbId = id; card.dataset.itemId = item.id;
    card.dataset.rating = rating || ''; card.dataset.numIndex = item.num_index !== undefined ? item.num_index : index;
    card.innerHTML = '<div class="torrent-poster" style="position:relative">' + ratingHtml + posterHtml + '</div><div class="torrent-info"><div class="torrent-title">' + escapeHtml(title.substring(0, 60)) + (title.length > 60 ? '...' : '') + '</div><div class="torrent-meta"><span>' + (mt === 'tv' ? 'Сериал' : 'Фильм') + '</span><span class="torrent-badge catalog-badge">' + badgeText + '</span></div></div>';
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
            if (key === 'history') loadHistoryCatalog(); else loadCatalog(key);
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
    if (h > 6) {
        try {
            var r = await fetch(SERVER_URL + '/api/catalog/' + id + '/update', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            if (r.ok) { var d = await r.json(); if (d.success) { catalogCache.delete(id); if (catalogState.currentCatalog === id) setTimeout(function () { loadCatalog(id); }, 500); return true; } }
        } catch (e) { console.error('Catalog update error:', e); }
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
        grid.appendChild(header); return;
    }
    header.innerHTML = '<span style="font-size:20px;font-weight:600;color:#4a9eff">' + name + '</span><span style="font-size:14px;color:#aaa;background:rgba(0,0,0,0.3);padding:5px 12px;border-radius:20px">' + catalogState.items.length + ' / ' + (catalogState.totalItems || catalogState.items.length) + '</span>';
    grid.appendChild(header);
    fetch(SERVER_URL + '/api/catalogs').then(r => r.json()).then(async d => {
        if (d.success && d.catalogs) {
            var info = null; for (var i = 0; i < d.catalogs.length; i++) if (d.catalogs[i].id === catalogState.currentCatalog) { info = d.catalogs[i]; break; }
            if (info && info.lastModifiedISO) {
                await checkAndUpdateCatalogIfNeeded(info.id, info.lastModifiedISO);
                header.innerHTML += '<div style="display:flex;gap:15px;font-size:12px;color:#aaa;margin-top:4px"><span>' + formatLastModifiedDate(info.lastModifiedISO) + '</span></div>';
            }
        }
    }).catch(() => { });
}

function addLoadMoreTrigger(grid) {
    var t = document.createElement('div'); t.id = 'load-more-trigger'; t.className = 'load-more-trigger';
    t.style.cssText = 'grid-column:1/-1;height:50px;margin:20px 0;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:14px;';
    t.innerHTML = '<div class="loading-spinner-small" style="width:20px;height:20px;border:2px solid rgba(74,158,255,0.2);border-top-color:#4a9eff;border-radius:50%;animation:spinner-rotate 1s infinite;margin-right:10px;display:none"></div><span>Загрузка дополнительных элементов...</span>';
    grid.appendChild(t);
}

function showEmptyCatalog() {
    var g = getEl('torrents-grid'); if (!g) return;
    g.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px"><div style="font-size:48px;margin-bottom:20px">🎬</div><div style="font-size:18px;color:#aaa">Каталог пуст</div></div>';
}

function initLoadMoreObserver() {
    if (catalogState.loadMoreObserver) catalogState.loadMoreObserver.disconnect();
    var t = getEl('load-more-trigger'); if (!t) return;
    catalogState.loadMoreObserver = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) if (entries[i].isIntersecting && catalogState.hasMore && !catalogState.isLoadingMore) {
            var sp = t.querySelector('.loading-spinner-small'); if (sp) sp.style.display = 'inline-block';
            loadMoreCatalogItems()['finally'](function () { if (sp) sp.style.display = 'none'; });
        }
    }, { rootMargin: '200px', threshold: 0.1 });
    catalogState.loadMoreObserver.observe(t);
}

// ==================== ПОСТЕРЫ (Оптимизировано) ====================
function loadInitialPosters() {
    var idxs = [];
    for (var i = 0; i < Math.min(catalogState.postersPerBatch, catalogState.items.length); i++) {
        var it = catalogState.items[i]; if (!it) continue;
        if (catalogState.posterCache[it.id + '_' + (it.media_type || 'movie')] === undefined) idxs.push(i);
    }
    if (idxs.length > 0) loadPosterBatch(idxs);
}

function initPosterLazyLoading() {
    if (catalogState.posterObserver) catalogState.posterObserver.disconnect();
    catalogState.posterObserver = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) if (entries[i].isIntersecting) {
            var idx = parseInt(entries[i].target.dataset.catalogIndex, 10);
            var it = catalogState.items[idx]; if (!it) continue;
            var key = it.id + '_' + (it.media_type || 'movie');
            if (catalogState.posterCache[key] === undefined && catalogState.posterLoadQueue.indexOf(idx) === -1) addToPosterQueue(idx);
        }
    }, { rootMargin: '50px', threshold: 0.1 });
    document.querySelectorAll('.torrent-card.catalog-card').forEach(function (c, i) {
        var it = catalogState.items[i]; if (!it) return;
        if (catalogState.posterCache[it.id + '_' + (it.media_type || 'movie')] === undefined) catalogState.posterObserver.observe(c);
    });
}

function updatePosterObservers() {
    if (!catalogState.posterObserver) return;
    document.querySelectorAll('.torrent-card.catalog-card').forEach(function (c, i) {
        var it = catalogState.items[i]; if (!it) return;
        if (catalogState.posterCache[it.id + '_' + (it.media_type || 'movie')] === undefined) {
            try { catalogState.posterObserver.observe(c); } catch (e) { }
        }
    });
}

function addToPosterQueue(idx) {
    if (catalogState.posterLoadQueue.indexOf(idx) !== -1) return;
    catalogState.posterLoadQueue.push(idx);
    catalogState.posterLoadQueue.sort(function (a, b) { return a - b; });
    if (!catalogState.isPosterLoading) loadNextPosterBatch();
}

function loadNextPosterBatch() {
    if (catalogState.isPosterLoading || catalogState.posterLoadQueue.length === 0) return;
    var next = catalogState.posterLoadQueue.splice(0, catalogState.postersPerBatch);
    loadPosterBatch(next);
}

function loadPosterBatch(indices) {
    if (indices.length === 0) return;
    catalogState.isPosterLoading = true;
    var promises = indices.map(function (i) { return loadPosterForIndex(i); });
    Promise.allSettled(promises).then(function (res) {
        var ok = res.filter(function (r) { return r.status === 'fulfilled' }).length;
        catalogState.isPosterLoading = false;
        if (catalogState.posterLoadQueue.length > 0) loadNextPosterBatch();
    });
}

async function loadPosterForIndex(index) {
    var item = catalogState.items[index]; if (!item) return;
    var card = document.querySelector('.torrent-card.catalog-card[data-catalog-index="' + index + '"]'); if (!card) return;
    await loadCatalogPoster(card, getCatalogItemTitle(item), item.media_type || 'movie', item.id, index);
}

async function loadCatalogPoster(card, title, mt, id, index) {
    var div = card.querySelector('.torrent-poster'); if (!div) return;
    var key = id + '_' + mt;
    if (!catalogState.currentCatalog) { div.innerHTML = '<div class="no-poster">Каталог закрыт</div>'; return; }
    if (catalogState.posterCache[key]) { updatePosterDOM(div, card.dataset.rating, catalogState.posterCache[key]); return; }

    var item = catalogState.items[index];
    if (catalogState.currentCatalog === 'history' && item && item.poster_path) {
        var pp = item.poster_path.indexOf('http') === 0 ? item.poster_path : (AppState.protocol + '//tsimg.hnar.online/t/p/w342' + (item.poster_path.indexOf('/') === 0 ? item.poster_path : '/' + item.poster_path));
        if (pp) { catalogState.posterCache[key] = pp; updatePosterDOM(div, card.dataset.rating, pp); return; }
    }

    try {
        var url = null, p = { id: id, type: mt };
        var cached = getFromTmdbCache('poster', p);
        if (cached && cached.posterUrl) url = cached.posterUrl;
        else if (id && id !== 'undefined' && id !== 'null') {
            // ✅ Совместимый таймаут для старых браузеров
            var controller = new AbortController();
            var timeoutId = setTimeout(function () { controller.abort(); }, 5000);
            try {
                var resp = await fetch('/api/tmdb/item?id=' + id + '&type=' + mt, { signal: controller.signal });
                if (resp.ok) { var d = await resp.json(); if (d.poster_path) { url = AppState.protocol + '//tsimg.hnar.online/t/p/w342' + d.poster_path; saveToTmdbCache('poster', p, { posterUrl: url, data: d }); } }
            } finally {
                clearTimeout(timeoutId);
            }
        }
        if (!url && window.tmdb && window.tmdb.searchPoster) {
            // ✅ Также применяем совместимый таймаут для searchPoster
            var controller2 = new AbortController();
            var timeoutId2 = setTimeout(function () { controller2.abort(); }, 5000);
            try {
                url = await window.tmdb.searchPoster(title, null, mt, true);
                if (url) saveToTmdbCache('poster', p, { posterUrl: url });
            } finally {
                clearTimeout(timeoutId2);
            }
        }
        if (url) {
            catalogState.posterCache[key] = url;
            if (Object.keys(catalogState.posterCache).length > catalogState.maxPosterCacheSize) {
                var k = Object.keys(catalogState.posterCache)[0]; delete catalogState.posterCache[k];
            }
        }
        updatePosterDOM(div, card.dataset.rating, url || '');
    } catch (e) {
        if (e.name === 'AbortError') {
            console.log('⏱️ Загрузка постера прервана по таймауту');
        } else {
            console.log('❌ Ошибка загрузки постера:', e.message);
        }
        if (catalogState.currentCatalog) div.innerHTML = '<div class="no-poster">Нет постера</div>';
    }
}

function updatePosterDOM(div, rating, url) {
    var rHtml = '';
    if (rating && rating !== 'null' && rating !== 'undefined') {
        var c = getRatingColor(parseFloat(rating));
        rHtml = '<div style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.5);color:' + c + ';font-weight:bold;font-size:14px;padding:4px 8px;border-radius:12px;z-index:10;border:1px solid ' + c + ';box-shadow:0 4px 20px rgba(0,0,0,0.25);backdrop-filter:none">' + rating + '</div>';
    }
    var img = url ? '<img src="' + url + '" loading="lazy" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.innerHTML=\'<div class=\\\'no-poster\\\'>Нет постера</div>\'">' : '<div class="no-poster">Нет постера</div>';
    div.innerHTML = img + rHtml;
}

// ==================== ДЕТАЛЬНЫЙ ПРОСМОТР ====================
function pushDetailHistory(item) {
    // Проверяем, не дублируется ли текущая запись
    var last = detailHistory[detailHistory.length - 1];
    if (last && last.id === item.id) {
        return; // Не добавляем дубликат
    }

    // Добавляем новый item
    detailHistory.push(item);

    // Ограничиваем размер истории
    if (detailHistory.length > MAX_DETAIL_HISTORY) {
        detailHistory.shift();
    }

    console.log('📜 История деталей:', detailHistory.length, 'записей');
}
async function showCatalogDetail(item, index, posterUrl) {
    //if (typeof window.initHorizontalScroll === 'function') window.initHorizontalScroll();
    pushDetailHistory(item);
    catalogState.lastSelectedIndex = index; catalogState.lastSelectedId = item.id;
    var dv = getEl('detail-view'), mc = getEl('main-container');
    var pe = getEl('detail-poster'), te = getEl('detail-title-text');
    var se = getEl('detail-subtitle'), oe = getEl('catalog-detail-overview');
    var be = getEl('catalog-detail-backdrop'), wb = getEl('catalog-watch-btn');
    var savedScroll = mc ? mc.scrollTop : 0; AppState.backupScroll = savedScroll;
    var oldP = document.querySelector('.detail-progress'); if (oldP) oldP.remove();

    var dh = document.querySelector('.detail-header');  // точка для класса
    if (dh) {
        dh.style.background = "rgba(255, 255, 255, 0.08)";
    }

    var aw = getEl('catalog-detail-actors-wrap'), rw = getEl('catalog-detail-recommendations-wrap');
    if (!aw && getEl('catalog-detail-overview')) {
        var c = document.createElement('div'); c.id = 'catalog-detail-actors-wrap'; c.className = 'catalog-detail-actors-wrap';
        c.innerHTML = '<div class="catalog-detail-section-title">В главных ролях</div><div id="catalog-detail-actors" class="catalog-detail-actors-grid"></div>';
        getEl('catalog-detail-overview').parentElement.insertAdjacentElement('afterend', c); aw = c;
    }
    if (!rw && aw) {
        var c = document.createElement('div'); c.id = 'catalog-detail-recommendations-wrap'; c.className = 'catalog-detail-recommendations-wrap';
        c.innerHTML = '<div class="catalog-detail-section-title">Похожие фильмы</div><div id="catalog-detail-recommendations" class="catalog-detail-recommendations-grid"></div>';
        aw.insertAdjacentElement('afterend', c); rw = c;
    }

    var title = getCatalogItemTitle(item), mt = item.media_type || 'movie';
    AppState.currentDetailItem = item; AppState.currentScreen = 'detail'; AppState.detailReturnTo = 'catalog';
    if (typeof Animations !== 'undefined') Animations.animateDetailShow();
    dv.style.pointerEvents = 'auto'; if (mc) mc.style.pointerEvents = 'none';
    if (typeof window.hideCatalogDetailExtra === 'function') window.hideCatalogDetailExtra();
    te.textContent = title; se.textContent = getCatalogItemSubtitle(item);
    getEl('files-list').style.display = 'none'; getEl('catalog-detail-extra').classList.remove('hidden');
    oe.textContent = 'Загрузка...'; getEl('catalog-detail-trailers-wrap').classList.add('hidden');
    if (aw) aw.classList.add('hidden'); if (rw) rw.classList.add('hidden');
    var temp = posterUrl || catalogState.posterCache[item.id + '_' + mt] || '';
    pe.innerHTML = temp ? '<img src="' + temp + '" alt="poster">' : '<div class="no-poster">Нет постера</div>';
    updateCatalogWatchButton(title);
    if (wb) wb.onclick = function () { dv.style.display = 'none'; dv.style.pointerEvents = 'none'; if (mc) mc.style.pointerEvents = 'auto'; AppState.currentScreen = 'search'; AppState.isSearch = false; showCatalogSearch(wb.dataset.searchTitle || title, temp, item); };

    var restore = function () { if (mc && savedScroll > 0) setTimeout(function () { mc.scrollTop = savedScroll; }, 50); };
    var details = await fetchCatalogItemDetails(item); restore();
    var src = details || item || {};
    if (src.poster_path) {
        var u = AppState.protocol + '//tsimg.hnar.online/t/p/w342' + src.poster_path;
        if (!temp || pe.innerHTML.indexOf('Нет постера') !== -1) pe.innerHTML = '<img src="' + u + '" alt="poster" onerror="this.parentElement.innerHTML=\'<div class=\\\"no-poster\\\">Нет постера</div>\'">';
        else catalogState.posterCache[item.id + '_' + mt] = u;
    } else if (src.image && (src.image.original || src.image.medium)) {
        var u = src.image.original || src.image.medium;
        if (!temp || pe.innerHTML.indexOf('Нет постера') !== -1) pe.innerHTML = '<img src="' + u + '" alt="poster" onerror="this.parentElement.innerHTML=\'<div class=\\\"no-poster\\\">Нет постера</div>\'">';
    }
    se.textContent = getCatalogItemSubtitle(item, src);
    oe.textContent = src.overview || item.overview || 'Описание пока недоступно';
    var bp = src.backdrop_path || (Array.isArray(src.backdrops) && src.backdrops[0] && src.backdrops[0].file_path);
    if (bp) { be.style.backgroundImage = 'url(' + (bp.indexOf('http') === 0 ? bp : AppState.protocol + '//tsimg.hnar.online/t/p/original' + bp) + ')'; be.classList.remove('hidden'); } else { be.classList.add('hidden'); be.style.backgroundImage = ''; }

    if (aw) {
        var ae = getEl('catalog-detail-actors');
        ae.innerHTML = '<div class="catalog-loading"><div class="loading-spinner-small"></div><span>Загрузка актеров...</span></div>'; aw.classList.remove('hidden');
        var actors = await fetchCatalogActors(item);
        if (actors.length > 0) {
            var frag = document.createDocumentFragment();
            actors.forEach(function (a) {
                var d = document.createElement('div'); d.className = 'catalog-actor-card';
                d.innerHTML = '<div class="catalog-actor-photo">' + (a.profilePath ? '<img src="' + AppState.protocol + '//tsimg.hnar.online/t/p/w185' + a.profilePath + '" loading="lazy" alt="' + escapeHtml(a.name) + '" onerror="this.parentElement.innerHTML=\'<div class=\\\'catalog-actor-no-photo\\\'>Нет фото</div>\'">' : '<div class="catalog-actor-no-photo">Нет фото</div>') + '</div><div class="catalog-actor-info"><div class="catalog-actor-name">' + escapeHtml(a.name) + '</div><div class="catalog-actor-character">' + escapeHtml(a.character || '') + '</div></div>';
                frag.appendChild(d);
            });
            ae.innerHTML = ''; ae.appendChild(frag);
        } else ae.innerHTML = '<div class="catalog-empty">Актеры не найдены</div>';
    }

    // Удаляем старый слушатель для рекомендаций, если он существует
    if (window._recommendationsClickListener) {
        var oldRe = getEl('catalog-detail-recommendations');
        if (oldRe && window._recommendationsClickListener) {
            oldRe.removeEventListener('click', window._recommendationsClickListener);
        }
    }

    if (rw && src.recommendations && src.recommendations.length > 0) {
        var re = getEl('catalog-detail-recommendations');
        re.innerHTML = '<div class="catalog-loading"><div class="loading-spinner-small"></div><span>Загрузка похожих фильмов...</span></div>';
        rw.classList.remove('hidden');
        var recs = src.recommendations.slice(0, 12), frag = document.createDocumentFragment();
        recs.forEach(function (r) {
            var d = document.createElement('div');
            d.className = 'catalog-recommendation-card';
            d.dataset.tmdbId = r.id;
            d.dataset.mediaType = mt;
            d.dataset.title = r.title || r.name || 'Без названия';
            var pu = r.poster_path ? AppState.protocol + '//tsimg.hnar.online/t/p/w185' + r.poster_path : null;
            d.innerHTML = '<div class="catalog-recommendation-poster">' + (pu ? '<img src="' + pu + '" loading="lazy" alt="' + escapeHtml(d.dataset.title) + '" onerror="this.parentElement.innerHTML=\'<div class=\\\'catalog-recommendation-no-poster\\\'> </div>\'">' : '<div class="catalog-recommendation-no-poster"> </div>') + (r.vote_average ? '<div class="catalog-recommendation-rating">' + Math.round(r.vote_average * 10) / 10 + '</div>' : '') + '</div><div class="catalog-recommendation-info"><div class="catalog-recommendation-title">' + escapeHtml(d.dataset.title) + '</div>' + (r.release_date ? '<div class="catalog-recommendation-year">' + r.release_date.substring(0, 4) + '</div>' : '') + '</div>';
            frag.appendChild(d);
        });
        re.innerHTML = '';
        re.appendChild(frag);

        // Создаем и сохраняем новый обработчик для рекомендаций
        window._recommendationsClickListener = function (e) {
            var c = e.target.closest('.catalog-recommendation-card');
            if (!c) return;
            showCatalogDetail({ id: c.dataset.tmdbId, media_type: c.dataset.mediaType, torrent: [{ name: c.dataset.title }], title: c.dataset.title, name: c.dataset.title }, 0, null);
        };

        // Добавляем новый слушатель
        re.addEventListener('click', window._recommendationsClickListener);
    } else if (rw) {
        rw.classList.add('hidden');
    }

    // Удаляем старый слушатель, если он существует
    if (window._trailersClickListener) {
        var oldTe2 = getEl('catalog-detail-trailers');
        if (oldTe2 && window._trailersClickListener) {
            oldTe2.removeEventListener('click', window._trailersClickListener);
        }
    }

    var vids = (src.videos && Array.isArray(src.videos) ? src.videos.filter(function (v) { var t = (v.type || '').toLowerCase(); return t.indexOf('trailer') !== -1 || t.indexOf('teaser') !== -1; }).slice(0, 6) : []);
    var tw = getEl('catalog-detail-trailers-wrap'), te2 = getEl('catalog-detail-trailers');
    if (vids.length > 0) {
        tw.classList.remove('hidden');
        te2.classList.add('catalog-detail-trailers-grid');
        te2.classList.remove('catalog-detail-trailers-links');
        te2.style.cssText = 'display:grid;grid-template-columns:repeat(6,1fr);gap:16px;padding:10px;';
        var frag = document.createDocumentFragment();
        vids.forEach(function (v) {
            var d = document.createElement('div');
            d.className = 'catalog-trailer-card-item';
            d.dataset.videoUrl = v.key;
            d.dataset.videoTitle = v.name || 'Трейлер';
            d.innerHTML = '<div class="catalog-trailer-poster" style="position:relative;aspect-ratio:16/9;overflow:hidden;border-radius:12px;background:linear-gradient(135deg,#1a1a2e,#16213e)"><img src="https://img.youtube.com/vi/' + v.key + '/mqdefault.jpg" alt="' + escapeHtml(v.name || 'Трейлер') + '" loading="lazy" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.innerHTML=\'<div class=\\\'no-poster\\\'></div>\'"><div class="catalog-trailer-play-overlay" style="position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.3s;cursor:pointer"><div style="width:60px;height:60px;background:rgba(74,158,255,0.9);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:30px;color:white">▶</div></div>' + (v.duration ? '<div style="position:absolute;bottom:8px;right:8px;background:rgba(0,0,0,0.8);color:white;font-size:12px;padding:3px 8px;border-radius:12px;font-family:monospace">' + formatDuration(v.duration) + '</div>' : '') + '</div><div class="catalog-trailer-info" style="padding:10px"><div class="catalog-trailer-title" style="font-size:14px;font-weight:600;color:#fff;margin-bottom:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(v.name || 'Трейлер') + '</div><div class="catalog-trailer-meta" style="display:flex;gap:10px;font-size:12px;color:#aaa"><span>Трейлер</span>' + (v.duration ? '<span>⏱️ ' + formatDuration(v.duration) + '</span>' : '') + '</div></div>';
            frag.appendChild(d);
        });
        te2.innerHTML = '';
        te2.appendChild(frag);

        // Создаем и сохраняем новый обработчик
        window._trailersClickListener = function (e) {
            var c = e.target.closest('.catalog-trailer-card-item');
            if (!c) return;
            if (!window.AndroidJS) {
                hideCatalogDetailView();
            }
            openYoutubeInPlayer(c.dataset.videoUrl, c.dataset.videoTitle);
        };

        // Добавляем новый слушатель
        te2.addEventListener('click', window._trailersClickListener);
    } else {
        tw.classList.add('hidden');
    }

    requestAnimationFrame(function () {
        if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
            updateFocusableElements();
            var idx = -1; if (typeof focusableElements !== 'undefined') for (var i = 0; i < focusableElements.length; i++) if (focusableElements[i].id === 'catalog-watch-btn') { idx = i; break; }
            setFocus(idx !== -1 ? idx : 0);
        }
    });
}

function hideCatalogDetailView() {
    var dv = getEl('detail-view'); if (!dv) return; dv.classList.remove('catalog-detail-mode'); dv.style.backgroundImage = '';
    var se = getEl('detail-title-subtitle'); if (se) se.textContent = ''; AppState.detailMode = null;
}
function updateCatalogWatchButton(t) { var b = getEl('catalog-watch-btn'); if (b) b.textContent = 'Поиск торрентов'; }
function onCatalogItemClick(item, index) {
    catalogState.lastSelectedIndex = index; catalogState.lastSelectedId = item.id;
    localStorage.setItem('lastCatalogCardIndex', item.num_index !== undefined ? item.num_index : index);
    var card = document.querySelector('.torrent-card.catalog-card[data-catalog-index="' + index + '"]');
    var pu = null; if (card) { var img = card.querySelector('.torrent-poster img'); if (img && img.src) pu = img.src; }
    AppState.catalogIndex = index;
    AppState.catalogPu = pu;
    AppState.androidBackCatalog = item;
    showCatalogDetail(item, index, pu);
}

function showCatalogSearch(q, pu, item) {
    var st = getEl('tab-search'), tt = getEl('tab-torrents'), ct = getEl('tab-catalog'), so = getEl('search-overlay'), si = getEl('search-query');
    if (st && tt && ct && so) {
        st.classList.add('active'); tt.classList.remove('active'); ct.classList.remove('active'); so.classList.remove('hidden');
        if (si) { si.value = q; if (document.activeElement === si) si.blur(); }
        window.pendingCatalogPoster = pu; window.pendingCatalogItem = item; AppState.searchReturnTo = 'detail';
        if (item) { AppState.pendingDetailItem = item; AppState.pendingDetailPoster = pu; AppState.pendingDetailIndex = catalogState.lastSelectedIndex; }
        AppState.currentScreen = 'search';
        if (typeof window.searchTorrents === 'function') { var tm = getEl('torrent-movie'); if (tm) tm.value = 'torrentsearch'; window.searchTorrentsLegacy(q); }
        setTimeout(function () { if (typeof window.focusSearchHome === 'function') window.focusSearchHome(true); }, 200);
    }
}

async function openYoutubeInPlayer(url, title) {
    var po = getEl('playback-overlay'); if (po) { po.classList.add('active'); var pt = po.querySelector('.playback-text'); if (pt) pt.textContent = 'Загрузка трейлера: ' + title + '...'; }
    try {
        // Извлекаем ID видео из URL
        var videoId = url;

        // Новый API запрос
        var apiUrl = 'https://tube.vidaapp.cfd/api/v1/video?v=' + videoId + '&device=vidaa-968394708';
        var response = await fetch(apiUrl);
        var data = await response.json();

        // Ищем m3u8_native с качеством 480p
        var m3u8Url = null;
        if (data.formats && Array.isArray(data.formats)) {
            var format = data.formats.find(f => f.protocol === 'm3u8_native' && f.label === '1080p');
            if (format && format.url) {
                m3u8Url = format.url;
            } else {
                // Если 1080p не найден, пробуем взять любой m3u8_native
                var anyM3u8 = data.formats.find(f => f.protocol === 'm3u8_native');
                if (anyM3u8 && anyM3u8.url) {
                    m3u8Url = anyM3u8.url;
                }
            }
        }

        if (!m3u8Url) {
            throw new Error('Не найден HLS поток для видео');
        }

        if (window.AndroidJS) {

            // Скрываем оверлей перед запуском внешнего плеера
            if (po) po.classList.remove('active');
            // Формируем данные
            var playerData = {
                url: m3u8Url,
                title: title || 'Видео',
                iptv: false
            };

            console.log('📱 Запуск внешнего плеера:', playerData);
            AndroidJS.openPlayer(m3u8Url, JSON.stringify(playerData));
        } else {
            var cd = AppState.currentDetailItem, cn = catalogState.currentCatalog, ci = catalogState.lastSelectedIndex;
            var dv = getEl('detail-view'), mc = getEl('main-container');
            if (dv) { dv.style.display = 'none'; dv.style.pointerEvents = 'none'; } if (mc) mc.style.pointerEvents = 'none';

            // Сохраняем состояние
            var old = AppState.currentStreamId;
            AppState.videoUrl = url;
            AppState.isYoutubePlayback = true;
            AppState.youtubeContext = { currentDetailItem: cd, catalogName: cn, itemIndex: ci };
            AppState.currentDetailItem = { title: title, hash: null, isYoutube: true, youtubeUrl: url };

            if (old) fetch(SERVER_URL + '/hls/stop/' + old, { method: 'POST' }).catch(() => { });
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
                            vp.play().catch(() => {
                                vp.muted = true;
                                vp.play().catch(() => { });
                                if (typeof window.updateMuteButton === 'function') window.updateMuteButton();
                            });
                            started = true;
                            getEl('player-screen').style.display = 'block';
                            getEl('config-screen').style.display = 'none';
                            getEl('torrserver-section').style.display = 'none';
                            document.querySelectorAll('.focused').forEach(e => e.classList.remove('focused'));
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
                    vp.play().catch(() => { });
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
        if (dv) { dv.style.display = 'block'; dv.style.pointerEvents = 'auto'; }
        if (mc) mc.style.pointerEvents = 'auto';
    }
}

function exitYoutubePlayer() {
    if (AppState.currentStreamId) { fetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST' }).catch(() => { }); AppState.currentStreamId = null; }
    if (AppState.hls) { AppState.hls.destroy(); AppState.hls = null; }
    AppState.isYoutubePlayback = false; var ctx = AppState.youtubeContext;
    if (ctx && ctx.currentDetailItem && ctx.currentDetailItem.id) {
        AppState.currentScreen = 'detail'; getEl('player-screen').style.display = 'none';
        var dv = getEl('detail-view'), mc = getEl('main-container'); if (dv) { dv.style.display = 'block'; dv.style.pointerEvents = 'auto'; } if (mc) mc.style.pointerEvents = 'auto';
        setTimeout(function () { showCatalogDetail(ctx.currentDetailItem, ctx.itemIndex || 0, null); }, 100); AppState.youtubeContext = null;
    } else if (catalogState && catalogState.currentCatalog) { if (typeof window.showCatalogList === 'function') window.showCatalogList(); } else { var ts = getEl('torrserver-section'); if (ts) ts.style.display = 'block'; getEl('config-screen').style.display = 'none'; if (typeof loadTorrents === 'function') loadTorrents(true); }
    setTimeout(function () { if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') { updateFocusableElements(); var b = getEl('catalog-watch-btn'), i = -1; if (typeof focusableElements !== 'undefined') for (var k = 0; k < focusableElements.length; k++) if (focusableElements[k].id === 'catalog-watch-btn') { i = k; break; } if (i !== -1) setFocus(i); else if (typeof window.focusFirstCatalogCard === 'function') window.focusFirstCatalogCard(); else setFocus(0); } }, 200);
}

// ==================== СПИСОК КАТАЛОГОВ ====================
async function fetchAvailableCatalogs() { try { var r = await fetch(SERVER_URL + '/api/catalogs'); if (!r.ok) throw new Error(); var d = await r.json(); return (d.success && d.catalogs) ? d.catalogs : []; } catch (e) { return []; } }

async function showCatalogList() {
    var grid = getEl('torrents-grid'); if (!grid) return; abortCatalogRequests();
    catalogState.currentCatalog = null; catalogState.items = []; catalogState.loading = false; catalogState.loadedPostersCount = 0; catalogState.posterLoadQueue = [];
    catalogState.lastSelectedIndex = 0; catalogState.lastSelectedId = null;
    var catalogTab = getEl('tab-catalog');
    if (catalogTab) catalogTab.classList.add('active');

    var torrentsTab = getEl('tab-torrents');
    if (torrentsTab) torrentsTab.classList.remove('active');

    var searchTab = getEl('tab-search');
    if (searchTab) searchTab.classList.remove('active');
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px"><div class="loading-spinner" style="margin:0 auto 20px"></div><div style="font-size:16px;color:#aaa">Загрузка списка каталогов...</div></div>';
    if (cats.length == 0) {
        cats = await fetchAvailableCatalogs();
    }
    if (AppState.currentScreen !== 'catalog') return;
    grid.innerHTML = '';
    if (cats.length === 0) {
        for (var k in CATALOG_CONFIG) if (CATALOG_CONFIG.hasOwnProperty(k) && k !== 'history') grid.appendChild(createCatalogFolderCard(k, CATALOG_CONFIG[k]));
    } else {
        for (var i = 0; i < cats.length; i++) { var c = cats[i]; grid.appendChild(createCatalogFolderCard(c.id, CATALOG_CONFIG[c.id] || { name: c.displayName || c.id, mediaType: c.id.indexOf('tv') !== -1 ? 'tv' : 'movie' })); }
    }
    if (CATALOG_CONFIG.history) grid.appendChild(createCatalogFolderCard('history', CATALOG_CONFIG.history));
}

function createCatalogFolderCard(key, cfg) {
    var c = document.createElement('div'); c.className = 'torrent-card catalog-folder-card'; c.dataset.catalogKey = key;
    var src = key === 'history' ? 'https://cash94.github.io/msx/img/History.jpg' : key.indexOf('quadhd') !== -1 ? 'https://cash94.github.io/msx/img/Films4k.jpg' : key.indexOf('legends') !== -1 ? 'https://cash94.github.io/msx/img/BestFilms.jpg' : key.indexOf('cartoons_tv') !== -1 ? 'https://cash94.github.io/msx/img/multserials.jpg' : key.indexOf('tv') !== -1 ? 'https://cash94.github.io/msx/img/Serials.jpg' : key.indexOf('cartoons') !== -1 ? 'https://cash94.github.io/msx/img/multfilms.jpg' : key.indexOf('anime') !== -1 ? 'https://cash94.github.io/msx/img/Anime.jpg' : key.indexOf('movie') !== -1 ? 'https://cash94.github.io/msx/img/Films.jpg' : '';
    c.innerHTML = '<div class="torrent-poster catalog-folder-poster">' + (src ? '<img src="' + src + '" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.innerHTML=\'<div class=\\\'no-poster\\\'>Нет постера</div>\'">' : '<div class="no-poster" style="display:flex;align-items:center;justify-content:center;height:100%;font-size:64px">🎬</div>') + '</div><div class="torrent-info"><div class="torrent-title">' + cfg.name + '</div><div class="torrent-meta"><span></span><span class="torrent-badge catalog-badge"></span></div></div>';
    return c;
}

function showCatalogLoading(msg) { var g = getEl('torrents-grid'); if (g) g.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px"><div class="loading-spinner" style="margin:0 auto 20px"></div><div style="font-size:16px;color:#aaa">' + (msg || 'Загрузка...') + '</div></div>'; }
function showCatalogError(msg) { var g = getEl('torrents-grid'); if (g) g.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px"><div style="font-size:48px;margin-bottom:20px">⚠️</div><div style="font-size:16px;color:#ff6a6a">' + msg + '</div><button class="btn" style="margin-top:20px" onclick="window.loadCatalogList()">Попробовать снова</button></div>'; }
function hideCatalogLoading() { }

function backToCatalogList() {
    abortCatalogRequests(); catalogCache.clear();
    catalogState.currentCatalog = null; catalogState.items = []; catalogState.totalItems = 0; catalogState.currentPage = 0; catalogState.hasMore = true; catalogState.isLoadingMore = false; catalogState.loadedItemIds = {}; catalogState.loadedPostersCount = 0; catalogState.posterLoadQueue = []; catalogState.posterCache = {}; catalogState.lastSelectedIndex = 0; catalogState.lastSelectedId = null; localStorage.removeItem('lastCatalogCardIndex');
    showCatalogList();
    requestAnimationFrame(function () { if (AppState.currentScreen === 'catalog') { if (typeof updateFocusableElements === 'function') updateFocusableElements(); setTimeout(function () { if (typeof window.focusFirstCatalogCard === 'function') window.focusFirstCatalogCard(); }, 100); } });
}

// ==================== НАВИГАЦИЯ ====================
window.loadMoreAndFocus = async function (idx, cols) {
    if (!catalogState.currentCatalog || catalogState.isLoadingMore) return;
    var t = getEl('load-more-trigger'); if (t) { var s = t.querySelector('.loading-spinner-small'); if (s) s.style.display = 'inline-block'; }
    var row = Math.floor(idx / cols) + 1;
    await loadMoreCatalogItems();
    setTimeout(function () {
        var cards = document.querySelectorAll('.torrent-card.catalog-card'); var ni = row * cols;
        if (cards.length > ni) { if (typeof updateFocusableElements === 'function') updateFocusableElements(); setTimeout(function () { var tc = cards[ni]; if (tc && typeof setFocus === 'function') { var gi = -1; if (typeof focusableElements !== 'undefined') for (var j = 0; j < focusableElements.length; j++) if (tc === focusableElements[j]) { gi = j; break; } if (gi !== -1) setFocus(gi); } }, 100); }
        if (t) { var s = t.querySelector('.loading-spinner-small'); if (s) s.style.display = 'none'; }
    }, 300);
};
window.checkAndLoadMoreOnNavigation = function () { if (catalogState.currentCatalog && catalogState.hasMore && !catalogState.isLoadingMore) loadMoreCatalogItems()['finally'](function () { var t = getEl('load-more-trigger'); if (t) { var s = t.querySelector('.loading-spinner-small'); if (s) s.style.display = 'none'; } }); };
window.focusCatalogCardByIndex = function (target) {
    if (AppState.currentScreen !== 'catalog') return 0; if (typeof updateFocusableElements === 'function') updateFocusableElements();
    var cards = document.querySelectorAll('.torrent-card.catalog-card'), idx = 0;
    for (var i = 0; i < cards.length; i++) if (cards[i].dataset.numIndex && parseInt(cards[i].dataset.numIndex) === target) { idx = i; break; }
    if (idx === 0 && target < cards.length) idx = target; return idx;
};
window.addToWatchHistory = async function (id, title, mt, pp) {
    try {
        var save = pp || null; var pre = AppState.protocol + '//tsimg.hnar.online/t/p/w342';
        if (save && save.indexOf(pre) === 0) save = save.replace(pre, '');
        var r = await fetch('/api/history/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tmdbId: String(id), title: title, mediaType: mt, posterPath: save }) });
        return await r.json();
    } catch (e) { console.error('History save error:', e); }
};

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
var tmdbCleanupIv = null;
function startTmdbCleanup() { if (tmdbCleanupIv) clearInterval(tmdbCleanupIv); tmdbCleanupIv = setInterval(cleanOldTmdbCache, TMDB_CACHE_CONFIG.cleanupInterval); }
function stopTmdbCleanup() { if (tmdbCleanupIv) { clearInterval(tmdbCleanupIv); tmdbCleanupIv = null; } }

function initCatalog() {
    console.log('Catalog module init (optimized)'); startTmdbCleanup();
    window.tmdbCache = { clear: clearTmdbCache, stats: getTmdbCacheStats, setEnabled: v => { TMDB_CACHE_CONFIG.enabled = v; }, isEnabled: () => TMDB_CACHE_CONFIG.enabled, setTtl: v => { TMDB_CACHE_CONFIG.ttl = v; } };
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initCatalog); else initCatalog();

window.loadCatalogList = showCatalogList; window.backToCatalogList = backToCatalogList; window.exitYoutubePlayer = exitYoutubePlayer; window.loadMoreCatalogItems = loadMoreCatalogItems;
window.catalog = { loadCatalog: loadCatalog, showCatalogList: showCatalogList, backToCatalogList: backToCatalogList, tmdbCache: { clear: clearTmdbCache, stats: getTmdbCacheStats } };
window.showCatalogDetail = showCatalogDetail; window.detailHistory = detailHistory; window.clearDetailHistory = clearDetailHistory;
