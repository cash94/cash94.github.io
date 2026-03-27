// catalog.js - Модуль для работы с каталогами фильмов/сериалов

// Конфигурация каталогов
const CATALOG_CONFIG = {
    movie: {
        name: 'Фильмы',
        url: `${SERVER_URL}/api/catalog/movie`,
        mediaType: 'movie'
    },
    quadhd: {
        name: 'Фильмы в 4K',
        url: `${SERVER_URL}/api/catalog/quadhd`,
        mediaType: 'movie'
    },
    legends: {
        name: 'Легендарные фильмы',
        url: `${SERVER_URL}/api/catalog/legends`,
        mediaType: 'movie'
    },
    tv: {
        name: 'Сериалы',
        url: `${SERVER_URL}/api/catalog/tv`,
        mediaType: 'tv'
    },
    cartoons: {
        name: 'Мультфильмы',
        url: `${SERVER_URL}/api/catalog/cartoons`,
        mediaType: 'movie'
    },
    cartoons_tv: {
        name: 'Мультсериалы',
        url: `${SERVER_URL}/api/catalog/cartoons_tv`,
        mediaType: 'tv'
    },
    anime: {
        name: 'Аниме',
        url: `${SERVER_URL}/api/catalog/anime`,
        mediaType: 'tv'
    }
};

// ==================== TMDB КЭШ ====================

// Кэш для TMDB запросов
let tmdbCache = new Map();

// Конфигурация кэша TMDB
const TMDB_CACHE_CONFIG = {
    ttl: 3600000, // 1 час в миллисекундах
    maxSize: 500, // Максимальное количество записей в кэше
    cleanupInterval: 300000, // Очистка каждые 5 минут
    enabled: true // Включен ли кэш
};

// Функция для получения ключа кэша
function getTmdbCacheKey(endpoint, params) {
    const sortedParams = Object.keys(params)
        .sort()
        .reduce((acc, key) => {
            acc[key] = params[key];
            return acc;
        }, {});

    return `${endpoint}:${JSON.stringify(sortedParams)}`;
}

// Функция для получения данных из кэша TMDB
function getFromTmdbCache(endpoint, params) {
    if (!TMDB_CACHE_CONFIG.enabled) return null;

    const cacheKey = getTmdbCacheKey(endpoint, params);
    const cached = tmdbCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < TMDB_CACHE_CONFIG.ttl) {
        console.log(`📦 TMDB кэш: HIT для ${endpoint}`, params);
        return cached.data;
    }

    if (cached) {
        console.log(`⏰ TMDB кэш: EXPIRED для ${endpoint}`, params);
        tmdbCache.delete(cacheKey);
    }

    return null;
}

// Функция для сохранения данных в кэш TMDB
function saveToTmdbCache(endpoint, params, data) {
    if (!TMDB_CACHE_CONFIG.enabled) return;

    const cacheKey = getTmdbCacheKey(endpoint, params);

    if (tmdbCache.size >= TMDB_CACHE_CONFIG.maxSize) {
        console.log(`🧹 TMDB кэш: достигнут лимит ${TMDB_CACHE_CONFIG.maxSize}, очистка старых записей`);
        cleanOldTmdbCache();
    }

    tmdbCache.set(cacheKey, {
        data: data,
        timestamp: Date.now(),
        endpoint: endpoint,
        params: params
    });

    console.log(`💾 TMDB кэш: SAVE для ${endpoint}`, params);
}

// Функция очистки старых записей из кэша TMDB
function cleanOldTmdbCache() {
    const now = Date.now();
    let deletedCount = 0;

    for (const [key, value] of tmdbCache.entries()) {
        if (now - value.timestamp >= TMDB_CACHE_CONFIG.ttl) {
            tmdbCache.delete(key);
            deletedCount++;
        }
    }

    if (tmdbCache.size >= TMDB_CACHE_CONFIG.maxSize) {
        const sortedEntries = Array.from(tmdbCache.entries())
            .sort((a, b) => a[1].timestamp - b[1].timestamp);

        const toDelete = tmdbCache.size - TMDB_CACHE_CONFIG.maxSize + 10;
        for (let i = 0; i < toDelete && i < sortedEntries.length; i++) {
            tmdbCache.delete(sortedEntries[i][0]);
            deletedCount++;
        }
    }

    if (deletedCount > 0) {
        console.log(`🧹 TMDB кэш: удалено ${deletedCount} устаревших записей`);
    }
}

// Функция для очистки всего кэша TMDB
function clearTmdbCache() {
    const size = tmdbCache.size;
    tmdbCache.clear();
    console.log(`🗑️ TMDB кэш: полностью очищен (${size} записей)`);
}

// Функция для получения информации о кэше TMDB
function getTmdbCacheStats() {
    const now = Date.now();
    let validCount = 0;
    let expiredCount = 0;
    let totalSize = 0;

    for (const value of tmdbCache.values()) {
        totalSize += JSON.stringify(value.data).length;
        if (now - value.timestamp < TMDB_CACHE_CONFIG.ttl) {
            validCount++;
        } else {
            expiredCount++;
        }
    }

    return {
        totalEntries: tmdbCache.size,
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
let catalogState = {
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
    loadedItemIds: new Set(),

    loadedPostersCount: 0,
    postersPerBatch: 16,
    isPosterLoading: false,
    posterLoadQueue: [],
    posterObserver: null,
    loadMoreObserver: null,

    posterCache: new Map()
};

// Кэш для загруженных каталогов
let catalogCache = new Map();

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
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

async function fetchJsonWithTimeout(url, timeout = 6000, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    } finally {
        clearTimeout(timeoutId);
    }
}

// ==================== TMDB ФУНКЦИИ С КЭШИРОВАНИЕМ ====================

// Функция для загрузки актеров из TMDB с кэшированием
async function fetchCatalogActors(item) {
    const tmdbId = item?.id;
    const mediaType = item?.media_type || 'movie';

    if (!tmdbId) return [];

    const cacheParams = { id: tmdbId, type: mediaType };

    const cachedActors = getFromTmdbCache('actors', cacheParams);
    if (cachedActors !== null) {
        return cachedActors;
    }

    try {
        const url = `/api/tmdb/details?id=${encodeURIComponent(tmdbId)}&type=${encodeURIComponent(mediaType)}`;

        const response = await fetch(url, {
            signal: AbortSignal.timeout(5000)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        let actors = [];
        if (data.cast && Array.isArray(data.cast)) {
            actors = data.cast.slice(0, 12).map(actor => ({
                id: actor.id,
                name: actor.name,
                character: actor.character,
                profilePath: actor.profile_path,
                order: actor.order
            }));
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
    const tmdbId = item?.id;
    const mediaType = item?.media_type || 'movie';

    if (!tmdbId) return null;

    const cacheParams = { id: tmdbId, type: mediaType };

    const cachedDetails = getFromTmdbCache('details', cacheParams);
    if (cachedDetails !== null) {
        return cachedDetails;
    }

    const candidates = [
        `/api/tmdb/details?id=${encodeURIComponent(tmdbId)}&type=${encodeURIComponent(mediaType)}`,
        `/api/tmdb/item?id=${encodeURIComponent(tmdbId)}&type=${encodeURIComponent(mediaType)}`
    ];

    for (const url of candidates) {
        try {
            const data = await fetchJsonWithTimeout(url, 5000);
            if (data && (data.id || data.overview || data.videos || data.images || data.backdrops)) {
                saveToTmdbCache('details', cacheParams, data);
                return data;
            }
        } catch (error) {
            console.warn('TMDB details fetch skipped:', url, error?.message || error);
        }
    }
    return null;
}

function mergeCatalogDetails(base, ...sources) {
    const merged = { ...(base || {}) };
    for (const source of sources) {
        if (!source || typeof source !== 'object') continue;
        for (const [key, value] of Object.entries(source)) {
            if (value === null || value === undefined) continue;
            if (Array.isArray(value)) {
                if (!Array.isArray(merged[key]) || merged[key].length === 0) merged[key] = value;
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
                merged[key] = { ...(merged[key] || {}), ...value };
            }
        }
    }
    return merged;
}

async function fetchCatalogItemDetails(item) {
    const cacheParams = {
        id: item?.id,
        media_type: item?.media_type || 'movie',
        title: getCatalogItemTitle(item)
    };

    const cachedDetails = getFromTmdbCache('itemDetails', cacheParams);
    if (cachedDetails !== null) {
        return cachedDetails;
    }

    const tmdbDetails = await fetchTmdbDetails(item);
    const merged = mergeCatalogDetails(item, tmdbDetails);

    saveToTmdbCache('itemDetails', cacheParams, merged);
    return merged;
}

const TMDB_GENRES = {
    movie: { 28: "Боевик", 12: "Приключения", 16: "Анимация", 35: "Комедия", 80: "Криминал", 99: "Документальный", 18: "Драма", 10751: "Семейный", 14: "Фэнтези", 36: "История", 27: "Ужасы", 10402: "Музыка", 9648: "Детектив", 10749: "Мелодрама", 878: "Фантастика", 10770: "ТВ фильм", 53: "Триллер", 10752: "Военный", 37: "Вестерн" },
    tv: { 10759: "Боевик", 16: "Анимация", 35: "Комедия", 80: "Криминал", 99: "Документальный", 18: "Драма", 10751: "Семейный", 10762: "Детский", 9648: "Детектив", 10763: "Новости", 10764: "Реалити", 10765: "Фантастика", 10766: "Мыльная опера", 10767: "Ток-шоу", 10768: "Война и политика", 37: "Вестерн" }
};

function getCatalogItemTitle(item) {
    return item?.torrent && item.torrent[0] ? item.torrent[0].name : (item?.title || item?.name || 'Без названия');
}

function getCatalogItemYear(item) {
    const raw = item?.release_date || item?.first_air_date || item?.year || item?.released || item?.relased || null;
    if (!raw) return null;
    const match = String(raw).match(/(19|20)\d{2}/);
    return match ? match[0] : null;
}

function getGenreNames(item, mediaType = 'movie') {
    const names = [];
    if (Array.isArray(item?.genres)) {
        item.genres.forEach(g => {
            const name = typeof g === 'string' ? g : g?.name;
            if (name) names.push(name);
        });
    }
    if (!names.length && Array.isArray(item?.genre_ids)) {
        const map = TMDB_GENRES[mediaType] || TMDB_GENRES.movie;
        item.genre_ids.forEach(id => { if (map[id]) names.push(map[id]); });
    }
    return names.filter(Boolean);
}

function getCatalogRating(item) {
    const val = Number(item?.vote_average);
    return Number.isFinite(val) && val > 0 ? (Math.round(val * 10) / 10).toFixed(1) : '';
}

function getNormalizedCatalogGenres(source) {
    if (!source) return [];
    const list = [];
    const mediaType = (source?.media_type || source?.types?.includes?.('tv') ? 'tv' : 'movie') === 'tv' ? 'tv' : 'movie';
    const genreMap = TMDB_GENRES[mediaType] || TMDB_GENRES.movie;

    if (Array.isArray(source.genres)) {
        source.genres.forEach(g => {
            const value = g?.name || g;
            if (value) list.push(String(value).trim());
        });
    }

    if (Array.isArray(source.genre_ids)) {
        source.genre_ids.forEach(id => {
            const mapped = genreMap[Number(id)] || genreMap[id];
            if (mapped) list.push(String(mapped).trim());
        });
    }

    if (source.genre) list.push(String(source.genre).trim());
    if (source.genre_name) list.push(String(source.genre_name).trim());

    return [...new Set(list.filter(Boolean))];
}

function getSafeCatalogRating(source) {
    const raw = Number(source?.vote_average ?? source?.rating ?? source?.tmdb_rating);
    if (!Number.isFinite(raw) || raw <= 0 || raw > 10) return null;
    return Math.round(raw * 10) / 10;
}

function getCatalogItemSubtitle(item, details = null) {
    const source = details || item || {};
    const year = getCatalogItemYear(source);
    const type = (item?.media_type || source.media_type || 'movie') === 'tv' ? 'Сериал' : 'Фильм';
    const genres = getNormalizedCatalogGenres(source);
    const primaryGenre = genres[0] || '';
    return [type, year, primaryGenre].filter(Boolean).join(' • ');
}

async function fetchCatalogItemMeta(item, mediaType = 'movie') {
    const title = getCatalogItemTitle(item);
    const year = getCatalogItemYear(item);

    const cacheParams = {
        title: title,
        year: year,
        mediaType: mediaType,
        tmdbId: item?.id
    };

    const cachedMeta = getFromTmdbCache('itemMeta', cacheParams);
    if (cachedMeta !== null) {
        return cachedMeta;
    }

    let best = item ? { ...item } : {};

    try {
        let url = `/api/tmdb/search?query=${encodeURIComponent(title)}&type=${mediaType}`;
        if (year) url += `&year=${year}`;

        const response = await fetch(url);
        if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data?.results) && data.results.length) {
                best = data.results.find(r => String(r.id) === String(item?.id)) || data.results[0];
            }
        }
    } catch (e) {
        console.warn('Не удалось догрузить метаданные каталога:', e);
    }

    const meta = {
        raw: best,
        overview: best?.overview || item?.overview || '',
        posterPath: best?.poster_path || item?.poster_path || null,
        backdropPath: best?.backdrop_path || item?.backdrop_path || null,
        rating: getCatalogRating(best || item),
        genres: getGenreNames(best || item, mediaType),
        year: getCatalogItemYear(best || item) || year,
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
    const { signal } = catalogState.abortController;

    const config = CATALOG_CONFIG[catalogKey];

    catalogState.currentCatalog = catalogKey;
    catalogState.items = [];
    catalogState.totalItems = 0;
    catalogState.currentPage = 0;
    catalogState.hasMore = true;
    catalogState.isLoadingMore = false;
    catalogState.loadedItemIds.clear();
    catalogState.loadedPostersCount = 0;
    catalogState.posterLoadQueue = [];

    showCatalogLoading(`Загрузка ${config.name}...`);

    if (catalogCache.has(catalogKey)) {
        const cached = catalogCache.get(catalogKey);
        if (Date.now() - cached.timestamp < 3600000) {
            console.log(`📦 Используем кэшированный каталог ${catalogKey}`);

            catalogState.items = cached.data.items || [];
            catalogState.totalItems = cached.data.totalItems || catalogState.items.length;
            catalogState.currentPage = cached.data.currentPage || 0;
            catalogState.hasMore = cached.data.hasMore || false;

            catalogState.items.forEach(item => {
                if (item.id) catalogState.loadedItemIds.add(item.id);
            });

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

async function loadMoreCatalogItems(reset = false) {
    if (!catalogState.currentCatalog || catalogState.isLoadingMore) return;

    if (reset) {
        catalogState.currentPage = 0;
        catalogState.items = [];
        catalogState.loadedItemIds.clear();
        catalogState.hasMore = true;
        catalogState.totalItems = 0;
    }

    if (!catalogState.hasMore) {
        console.log('🏁 Все элементы каталога загружены');
        return;
    }

    catalogState.isLoadingMore = true;

    const config = CATALOG_CONFIG[catalogState.currentCatalog];
    const from = catalogState.currentPage * catalogState.itemsPerPage;

    console.log(`📥 Загрузка элементов ${from} - ${from + catalogState.itemsPerPage} из каталога ${catalogState.currentCatalog}`);

    try {
        const url = `${config.url}/items?from=${from}&limit=${catalogState.itemsPerPage}`;
        console.log(`🌐 Запрос: ${url}`);

        const response = await fetch(url, {
            signal: catalogState.abortController?.signal
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (!data.success) {
            throw new Error('Сервер вернул ошибку');
        }

        const newItems = data.items || [];
        const pagination = data.pagination || {};

        if (pagination.total) {
            catalogState.totalItems = pagination.total;
        }

        if (pagination.hasMore !== undefined) {
            catalogState.hasMore = pagination.hasMore;
        } else {
            catalogState.hasMore = newItems.length === catalogState.itemsPerPage;
        }

        console.log(`📊 Получено ${newItems.length} элементов. Всего в каталоге: ${catalogState.totalItems || '?'}`);

        const uniqueNewItems = newItems.filter(item => {
            if (!item.id) return true;
            if (catalogState.loadedItemIds.has(item.id)) {
                console.log(`⚠️ Дубликат элемента ${item.id} пропущен`);
                return false;
            }
            catalogState.loadedItemIds.add(item.id);
            return true;
        });

        catalogState.items = [...catalogState.items, ...uniqueNewItems];
        catalogState.currentPage++;

        console.log(`✅ Загружено ${uniqueNewItems.length} новых элементов. Всего: ${catalogState.items.length}/${catalogState.totalItems || '?'} (еще: ${catalogState.hasMore})`);

        if (reset) {
            renderCatalogGrid();
        } else {
            appendCatalogItems(uniqueNewItems);
        }

        catalogCache.set(catalogState.currentCatalog, {
            data: {
                items: catalogState.items,
                totalItems: catalogState.totalItems,
                currentPage: catalogState.currentPage,
                hasMore: catalogState.hasMore
            },
            timestamp: Date.now()
        });

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('📴 Загрузка элементов отменена');
        } else {
            console.error('❌ Ошибка загрузки элементов:', error);
            console.log('⚠️ Пробуем загрузить все элементы (fallback)');
            await fallbackLoadAllCatalogItems();
        }
    } finally {
        catalogState.isLoadingMore = false;
    }
}

async function fallbackLoadAllCatalogItems() {
    if (!catalogState.currentCatalog) return;

    console.log('📥 Fallback: загрузка всех элементов каталога');

    const config = CATALOG_CONFIG[catalogState.currentCatalog];
    const url = `${config.url}/items`;

    try {
        const response = await fetch(url, {
            signal: catalogState.abortController?.signal
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        if (!data.success) throw new Error('Сервер вернул ошибку');

        const allItems = data.items || [];

        catalogState.items = allItems;
        catalogState.totalItems = allItems.length;
        catalogState.hasMore = false;
        catalogState.currentPage = 1;

        catalogState.loadedItemIds.clear();
        allItems.forEach(item => {
            if (item.id) catalogState.loadedItemIds.add(item.id);
        });

        console.log(`✅ Fallback: загружено ${allItems.length} элементов`);
        renderCatalogGrid();

        catalogCache.set(catalogState.currentCatalog, {
            data: {
                items: catalogState.items,
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
    const torrentsGrid = document.getElementById('torrents-grid');
    if (!torrentsGrid) return;

    torrentsGrid.innerHTML = '';

    if (catalogState.items.length === 0) {
        showEmptyCatalog();
        return;
    }

    addCatalogHeader(torrentsGrid);

    catalogState.items.forEach((item, index) => {
        const card = createCatalogCard(item, index);
        torrentsGrid.appendChild(card);
    });

    if (catalogState.hasMore) {
        addLoadMoreTrigger(torrentsGrid);
    }

    catalogState.loadedPostersCount = 0;
    initPosterLazyLoading();
    initLoadMoreObserver();
    loadInitialPosters();

    setTimeout(() => {
        if (AppState.currentScreen === 'catalog' && catalogState.currentCatalog) {
            if (typeof updateFocusableElements === 'function') {
                updateFocusableElements();
            }
            setTimeout(() => {
                if (typeof window.focusFirstCatalogCard === 'function') {
                    window.focusFirstCatalogCard();
                }
            }, 100);
        }
    }, 200);
}

function appendCatalogItems(newItems) {
    const torrentsGrid = document.getElementById('torrents-grid');
    if (!torrentsGrid) return;

    const oldTrigger = document.getElementById('load-more-trigger');
    if (oldTrigger) oldTrigger.remove();

    const startIndex = catalogState.items.length - newItems.length;

    newItems.forEach((item, offset) => {
        const index = startIndex + offset;
        const card = createCatalogCard(item, index);
        torrentsGrid.appendChild(card);
    });

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
    const title = getCatalogItemTitle(item);
    const mediaType = item.media_type || 'movie';
    const tmdbId = item.id;

    let rating = null;
    if (item.vote_average) {
        rating = Math.round(item.vote_average * 10) / 10;
    }

    const card = document.createElement('div');
    card.className = 'torrent-card catalog-card';
    card.dataset.catalogIndex = index;
    card.dataset.title = title;
    card.dataset.mediaType = mediaType;
    card.dataset.tmdbId = tmdbId;
    card.dataset.itemId = item.id;
    card.dataset.rating = rating;
    card.dataset.numIndex = item.num_index || index;

    const cacheKey = `${tmdbId}_${mediaType}`;
    const cachedPoster = catalogState.posterCache.get(cacheKey);

    card.innerHTML = `
        <div class="torrent-poster" style="position: relative;">
            ${rating ? `
                <div class="rating-badge" style="
                    position: absolute;
                    top: 8px;
                    right: 8px;
                    background: rgba(0, 0, 0, 0.8);
                    color: ${getRatingColor(rating)};
                    font-weight: bold;
                    font-size: 14px;
                    padding: 4px 8px;
                    border-radius: 12px;
                    z-index: 10;
                    border: 1px solid ${getRatingColor(rating)};
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                    backdrop-filter: blur(2px);
                ">
                    ${rating}
                </div>
            ` : ''}
            ${cachedPoster
            ? `<img src="${cachedPoster}" loading="lazy" style="width: 100%; height: 100%; object-fit: cover;">`
            : '<div class="no-poster catalog-poster-loading">⏳</div>'
        }
        </div>
        <div class="torrent-info">
            <div class="torrent-title">${escapeHtml(title.substring(0, 60))}${title.length > 60 ? '...' : ''}</div>
            <div class="torrent-meta">
                <span>${mediaType === 'tv' ? 'Сериал' : 'Фильм'}</span>
                <span class="torrent-badge catalog-badge">Каталог</span>
            </div>
        </div>
    `;

    card.addEventListener('click', () => {
        if (catalogState.currentCatalog) {
            onCatalogItemClick(item, index);
        }
    });

    return card;
}

function addCatalogHeader(grid) {
    const headerElement = document.createElement('div');
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
    `;

    const currentCatalogName = CATALOG_CONFIG[catalogState.currentCatalog]?.name || 'Каталог';
    headerElement.innerHTML = `
        <span style="font-size: 20px; font-weight: 600; color: #4a9eff;">${currentCatalogName}</span>
        <span style="font-size: 14px; color: #aaa; background: rgba(0,0,0,0.3); padding: 5px 12px; border-radius: 20px;">
            ${catalogState.items.length} / ${catalogState.totalItems || catalogState.items.length}
        </span>
    `;

    grid.appendChild(headerElement);
}

function addLoadMoreTrigger(grid) {
    const trigger = document.createElement('div');
    trigger.id = 'load-more-trigger';
    trigger.className = 'load-more-trigger';
    trigger.style.cssText = `
        grid-column: 1 / -1;
        height: 50px;
        margin: 20px 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #aaa;
        font-size: 14px;
    `;
    trigger.innerHTML = `
        <div class="loading-spinner-small" style="width: 20px; height: 20px; border: 2px solid rgba(74,158,255,0.2); border-top-color: #4a9eff; border-radius: 50%; animation: spinner-rotate 1s infinite; margin-right: 10px; display: none;"></div>
        <span>Загрузка дополнительных элементов...</span>
    `;
    grid.appendChild(trigger);
}

function showEmptyCatalog() {
    const torrentsGrid = document.getElementById('torrents-grid');
    if (!torrentsGrid) return;

    torrentsGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">
            <div style="font-size: 48px; margin-bottom: 20px;"></div>
            <div style="font-size: 18px; color: #aaa;">Каталог пуст</div>
        </div>
    `;
}

function initLoadMoreObserver() {
    if (catalogState.loadMoreObserver) {
        catalogState.loadMoreObserver.disconnect();
    }

    const trigger = document.getElementById('load-more-trigger');
    if (!trigger) return;

    catalogState.loadMoreObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && catalogState.hasMore && !catalogState.isLoadingMore) {
                console.log('📦 Триггер видим, загружаем следующую страницу');

                const spinner = trigger.querySelector('.loading-spinner-small');
                if (spinner) spinner.style.display = 'inline-block';

                loadMoreCatalogItems().finally(() => {
                    if (spinner) spinner.style.display = 'none';
                });
            }
        });
    }, {
        root: null,
        rootMargin: '200px',
        threshold: 0.1
    });

    catalogState.loadMoreObserver.observe(trigger);
}

// ==================== ПОСТЕРЫ С ЛЕНИВОЙ ЗАГРУЗКОЙ ====================

function loadInitialPosters() {
    const initialIndices = [];

    for (let i = 0; i < Math.min(catalogState.postersPerBatch, catalogState.items.length); i++) {
        const item = catalogState.items[i];
        if (!item) continue;

        const cacheKey = `${item.id}_${item.media_type || 'movie'}`;

        if (!catalogState.posterCache.has(cacheKey)) {
            initialIndices.push(i);
        }
    }

    if (initialIndices.length > 0) {
        console.log(`🖼️ Загрузка начальных ${initialIndices.length} постеров`);
        loadPosterBatch(initialIndices);
    }
}

function initPosterLazyLoading() {
    if (catalogState.posterObserver) {
        catalogState.posterObserver.disconnect();
    }

    catalogState.posterObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const card = entry.target;
                const index = parseInt(card.dataset.catalogIndex);
                const item = catalogState.items[index];

                if (!item) return;

                const cacheKey = `${item.id}_${item.media_type || 'movie'}`;

                if (!catalogState.posterCache.has(cacheKey) && !isPosterInQueue(index)) {
                    addToPosterQueue(index);
                }
            }
        });
    }, {
        root: null,
        rootMargin: '200px',
        threshold: 0.1
    });

    document.querySelectorAll('.torrent-card.catalog-card').forEach((card, index) => {
        const item = catalogState.items[index];
        if (!item) return;

        const cacheKey = `${item.id}_${item.media_type || 'movie'}`;

        if (!catalogState.posterCache.has(cacheKey)) {
            catalogState.posterObserver.observe(card);
        }
    });
}

function updatePosterObservers() {
    if (!catalogState.posterObserver) return;

    document.querySelectorAll('.torrent-card.catalog-card').forEach((card, index) => {
        const isBeingObserved = catalogState.posterObserver.takeRecords().some(
            record => record.target === card
        );

        if (!isBeingObserved) {
            const item = catalogState.items[index];
            if (!item) return;

            const cacheKey = `${item.id}_${item.media_type || 'movie'}`;

            if (!catalogState.posterCache.has(cacheKey)) {
                catalogState.posterObserver.observe(card);
            }
        }
    });
}

function isPosterInQueue(index) {
    return catalogState.posterLoadQueue.includes(index);
}

function addToPosterQueue(index) {
    if (!catalogState.posterLoadQueue.includes(index)) {
        catalogState.posterLoadQueue.push(index);
        catalogState.posterLoadQueue.sort((a, b) => a - b);

        if (!catalogState.isPosterLoading) {
            loadNextPosterBatch();
        }
    }
}

function loadNextPosterBatch() {
    if (catalogState.isPosterLoading) return;
    if (catalogState.posterLoadQueue.length === 0) return;

    const nextBatch = catalogState.posterLoadQueue.splice(0, catalogState.postersPerBatch);
    loadPosterBatch(nextBatch);
}

function loadPosterBatch(indices) {
    if (indices.length === 0) return;

    catalogState.isPosterLoading = true;
    console.log(`🖼️ Загрузка партии постеров: индексы ${indices[0]}-${indices[indices.length - 1]}`);

    Promise.allSettled(indices.map(index => loadPosterForIndex(index)))
        .then((results) => {
            const successful = results.filter(r => r.status === 'fulfilled').length;
            const failed = results.filter(r => r.status === 'rejected').length;

            console.log(`✅ Загружено ${successful} постеров, ${failed} ошибок`);

            const maxIndex = Math.max(...indices);
            if (maxIndex + 1 > catalogState.loadedPostersCount) {
                catalogState.loadedPostersCount = maxIndex + 1;
            }

            catalogState.isPosterLoading = false;

            if (catalogState.posterLoadQueue.length > 0) {
                loadNextPosterBatch();
            }
        })
        .catch(error => {
            console.error('❌ Ошибка загрузки партии постеров:', error);
            catalogState.isPosterLoading = false;
        });
}

async function loadPosterForIndex(index) {
    const item = catalogState.items[index];
    if (!item) return;

    const card = document.querySelector(`.torrent-card.catalog-card[data-catalog-index="${index}"]`);
    if (!card) return;

    const title = getCatalogItemTitle(item);
    const mediaType = item.media_type || 'movie';
    const tmdbId = item.id;

    await loadCatalogPoster(card, title, mediaType, tmdbId, index);
}

async function loadCatalogPoster(card, title, mediaType, tmdbId, index) {
    const posterDiv = card.querySelector('.torrent-poster');
    if (!posterDiv) return;

    const cacheKey = `${tmdbId}_${mediaType}`;

    if (!catalogState.currentCatalog) {
        posterDiv.innerHTML = '<div class="no-poster">Каталог закрыт</div>';
        return;
    }

    if (catalogState.posterCache.has(cacheKey)) {
        const cachedPoster = catalogState.posterCache.get(cacheKey);
        if (cachedPoster) {
            console.log(`📦 Используем кэшированный постер для ${title}`);

            const rating = card.dataset.rating;
            let posterHtml = `<img src="${cachedPoster}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'no-poster\\'>Нет постера</div>'">`;

            if (rating) {
                const ratingColor = getRatingColor(parseFloat(rating));
                posterDiv.innerHTML = `
                    ${posterHtml}
                    <div style="
                        position: absolute;
                        top: 8px;
                        right: 8px;
                        background: rgba(0, 0, 0, 0.8);
                        color: ${ratingColor};
                        font-weight: bold;
                        font-size: 14px;
                        padding: 4px 8px;
                        border-radius: 12px;
                        z-index: 10;
                        border: 1px solid ${ratingColor};
                        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                        backdrop-filter: blur(2px);
                    ">
                        ${rating}
                    </div>
                `;
            } else {
                posterDiv.innerHTML = posterHtml;
            }
            return;
        }
    }

    const rating = card.dataset.rating;

    try {
        let posterUrl = null;

        const cacheParams = { id: tmdbId, type: mediaType };
        const cachedTmdbData = getFromTmdbCache('poster', cacheParams);

        if (cachedTmdbData && cachedTmdbData.posterUrl) {
            posterUrl = cachedTmdbData.posterUrl;
            console.log(`📦 TMDB кэш: найден постер для ${title}`);
        } else {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            if (tmdbId) {
                console.log(`🔍 Загрузка постера для ${title} (ID: ${tmdbId}, type: ${mediaType})`);

                const response = await fetch(`/api/tmdb/item?id=${tmdbId}&type=${mediaType}`, {
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!catalogState.currentCatalog) {
                    posterDiv.innerHTML = '<div class="no-poster">Загрузка отменена</div>';
                    return;
                }

                if (response.ok) {
                    const data = await response.json();
                    if (data.poster_path) {
                        posterUrl = `https://nmtmdb.duckdns.org/t/p/w342${data.poster_path}`;
                        saveToTmdbCache('poster', cacheParams, { posterUrl: posterUrl, data: data });
                    }
                }
            }

            if (!posterUrl && window.tmdb && window.tmdb.searchPoster) {
                console.log(`🔍 Поиск постера через search для ${title}`);

                const controller2 = new AbortController();
                const timeoutId2 = setTimeout(() => controller2.abort(), 5000);

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
            catalogState.posterCache.set(cacheKey, posterUrl);
        }

        let posterHtml = '';

        if (posterUrl) {
            posterHtml = `<img src="${posterUrl}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'no-poster\\'>Нет постера</div>'">`;
        } else {
            posterHtml = '<div class="no-poster">Нет постера</div>';
        }

        if (rating) {
            const ratingColor = getRatingColor(parseFloat(rating));
            posterDiv.innerHTML = `
                ${posterHtml}
                <div style="
                    position: absolute;
                    top: 8px;
                    right: 8px;
                    background: rgba(0, 0, 0, 0.8);
                    color: ${ratingColor};
                    font-weight: bold;
                    font-size: 14px;
                    padding: 4px 8px;
                    border-radius: 12px;
                    z-index: 10;
                    border: 1px solid ${ratingColor};
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                    backdrop-filter: blur(2px);
                ">
                    ${rating}
                </div>
            `;
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

async function showCatalogDetail(item, index, posterUrl = null) {
    catalogState.lastSelectedIndex = index;
    catalogState.lastSelectedId = item.id;

    const detailView = document.getElementById('detail-view');
    const mainContainer = document.getElementById('main-container');
    const posterEl = document.getElementById('detail-poster');
    const titleEl = document.getElementById('detail-title-text');
    const subtitleEl = document.getElementById('detail-subtitle');
    const extraEl = document.getElementById('catalog-detail-extra');
    const backdropEl = document.getElementById('catalog-detail-backdrop');
    const metaEl = document.getElementById('catalog-detail-meta');
    const overviewEl = document.getElementById('catalog-detail-overview');
    const trailersWrap = document.getElementById('catalog-detail-trailers-wrap');
    const trailersEl = document.getElementById('catalog-detail-trailers');
    const filesList = document.getElementById('files-list');
    const watchBtn = document.getElementById('catalog-watch-btn');

    const existingProgress = document.querySelector('.detail-progress');
    if (existingProgress) {
        existingProgress.remove();
    }

    let actorsWrap = document.getElementById('catalog-detail-actors-wrap');
    let actorsEl = document.getElementById('catalog-detail-actors');

    if (!actorsWrap) {
        const overviewContainer = overviewEl?.parentElement;
        if (overviewContainer) {
            const actorsContainer = document.createElement('div');
            actorsContainer.id = 'catalog-detail-actors-wrap';
            actorsContainer.className = 'catalog-detail-actors-wrap';
            actorsContainer.innerHTML = `
                <div class="catalog-detail-section-title">В главных ролях</div>
                <div id="catalog-detail-actors" class="catalog-detail-actors-grid"></div>
            `;
            overviewContainer.insertAdjacentElement('afterend', actorsContainer);
            actorsWrap = actorsContainer;
            actorsEl = document.getElementById('catalog-detail-actors');
        }
    }

    let recommendationsWrap = document.getElementById('catalog-detail-recommendations-wrap');
    let recommendationsEl = document.getElementById('catalog-detail-recommendations');

    if (!recommendationsWrap) {
        const actorsContainer = actorsWrap || overviewEl?.parentElement;
        if (actorsContainer) {
            const recContainer = document.createElement('div');
            recContainer.id = 'catalog-detail-recommendations-wrap';
            recContainer.className = 'catalog-detail-recommendations-wrap';
            recContainer.innerHTML = `
                <div class="catalog-detail-section-title">Похожие фильмы</div>
                <div id="catalog-detail-recommendations" class="catalog-detail-recommendations-grid"></div>
            `;
            actorsContainer.insertAdjacentElement('afterend', recContainer);
            recommendationsWrap = recContainer;
            recommendationsEl = document.getElementById('catalog-detail-recommendations');
        }
    }

    const title = getCatalogItemTitle(item);
    const mediaType = item.media_type || 'movie';

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

    const tempPoster = posterUrl || catalogState.posterCache.get(`${item.id}_${mediaType}`) || '';
    posterEl.innerHTML = tempPoster ? `<img src="${tempPoster}" alt="poster">` : '<div class="no-poster">Нет постера</div>';

    updateCatalogWatchButton(title);

    if (watchBtn) {
        watchBtn.onclick = () => {
            detailView.style.display = 'none';
            detailView.style.pointerEvents = 'none';
            if (mainContainer) {
                mainContainer.style.pointerEvents = 'auto';
            }
            AppState.currentScreen = 'search';
            AppState.isSearch = false;

            const searchTitle = watchBtn.dataset.searchTitle || title;
            showCatalogSearch(searchTitle, tempPoster, item);
        };
    }

    const details = await fetchCatalogItemDetails(item);
    const source = details || item || {};

    let finalPosterUrl = tempPoster;

    if (source.poster_path) {
        const tmdbPosterUrl = `https://nmtmdb.duckdns.org/t/p/w342${source.poster_path}`;
        if (!tempPoster || tempPoster === '' || posterEl.innerHTML.includes('Нет постера')) {
            finalPosterUrl = tmdbPosterUrl;
            posterEl.innerHTML = `<img src="${tmdbPosterUrl}" alt="poster" onerror="this.parentElement.innerHTML='<div class=\'no-poster\'>Нет постера</div>'">`;
        } else {
            catalogState.posterCache.set(`${item.id}_${mediaType}`, tmdbPosterUrl);
        }
    } else if (source.image?.original || source.image?.medium) {
        const sourcePoster = source.image?.original || source.image?.medium;
        if (!tempPoster || tempPoster === '' || posterEl.innerHTML.includes('Нет постера')) {
            finalPosterUrl = sourcePoster;
            posterEl.innerHTML = `<img src="${sourcePoster}" alt="poster" onerror="this.parentElement.innerHTML='<div class=\'no-poster\'>Нет постера</div>'">`;
        }
    }

    subtitleEl.textContent = getCatalogItemSubtitle(item, source);

    const chips = [];
    const releaseYear = getCatalogItemYear(source);
    if (releaseYear) chips.push(`<span class="catalog-meta-chip">${escapeHtml(releaseYear)}</span>`);
    const safeRating = getSafeCatalogRating(source);
    if (safeRating !== null) chips.push(`<span class="catalog-meta-chip">${escapeHtml(String(safeRating))}</span>`);
    if (source.source_name) chips.push(`<span class="catalog-meta-chip">ℹ${escapeHtml(String(source.source_name))}</span>`);
    const genres = getNormalizedCatalogGenres(source).slice(0, 4);
    genres.forEach(g => chips.push(`<span class="catalog-meta-chip">${escapeHtml(g)}</span>`));
    metaEl.innerHTML = chips.join('') || '<span class="catalog-meta-chip">Каталог</span>';

    const overview = source.overview || item.overview || 'Описание пока недоступно';
    overviewEl.textContent = overview;

    const backdropPath = source.backdrop_path || (Array.isArray(source.backdrops) && source.backdrops[0]?.file_path) || null;
    if (backdropPath) {
        const backdropUrl = backdropPath.startsWith('http') ? backdropPath : `https://nmtmdb.duckdns.org/t/p/original${backdropPath}`;
        backdropEl.style.backgroundImage = `url(${backdropUrl})`;
        backdropEl.classList.remove('hidden');
    } else {
        backdropEl.classList.add('hidden');
        backdropEl.style.backgroundImage = '';
    }

    if (actorsWrap && actorsEl) {
        actorsEl.innerHTML = '<div class="catalog-loading"><div class="loading-spinner-small"></div><span>Загрузка актеров...</span></div>';
        actorsWrap.classList.remove('hidden');

        const actors = await fetchCatalogActors(item);

        if (actors.length > 0) {
            actorsEl.innerHTML = actors.map(actor => {
                const profileUrl = actor.profilePath
                    ? `https://nmtmdb.duckdns.org/t/p/w185${actor.profilePath}`
                    : null;

                return `
                    <div class="catalog-actor-card" data-actor-id="${actor.id}">
                        <div class="catalog-actor-photo">
                            ${profileUrl
                        ? `<img src="${profileUrl}" alt="${escapeHtml(actor.name)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'catalog-actor-no-photo\\'>Нет фото</div>'">`
                        : '<div class="catalog-actor-no-photo">Нет фото</div>'
                    }
                        </div>
                        <div class="catalog-actor-info">
                            <div class="catalog-actor-name">${escapeHtml(actor.name)}</div>
                            <div class="catalog-actor-character">${escapeHtml(actor.character || '')}</div>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            actorsEl.innerHTML = '<div class="catalog-empty">Актеры не найдены</div>';
        }
    }

    if (recommendationsWrap && recommendationsEl && source.recommendations && source.recommendations.length > 0) {
        recommendationsEl.innerHTML = '<div class="catalog-loading"><div class="loading-spinner-small"></div><span>Загрузка похожих фильмов...</span></div>';
        recommendationsWrap.classList.remove('hidden');

        const recommendations = source.recommendations.slice(0, 12);

        recommendationsEl.innerHTML = recommendations.map(rec => {
            const recPosterUrl = rec.poster_path
                ? `https://nmtmdb.duckdns.org/t/p/w185${rec.poster_path}`
                : null;
            const recTitle = rec.title || rec.name || 'Без названия';
            const recYear = rec.release_date ? rec.release_date.substring(0, 4) : '';
            const recRating = rec.vote_average ? Math.round(rec.vote_average * 10) / 10 : null;

            return `
                <div class="catalog-recommendation-card" data-tmdb-id="${rec.id}" data-media-type="${mediaType}" data-title="${escapeHtml(recTitle)}">
                    <div class="catalog-recommendation-poster">
                        ${recPosterUrl
                    ? `<img src="${recPosterUrl}" alt="${escapeHtml(recTitle)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'catalog-recommendation-no-poster\\'></div>'">`
                    : '<div class="catalog-recommendation-no-poster"></div>'
                }
                        ${recRating ? `<div class="catalog-recommendation-rating">${recRating}</div>` : ''}
                    </div>
                    <div class="catalog-recommendation-info">
                        <div class="catalog-recommendation-title">${escapeHtml(recTitle)}</div>
                        ${recYear ? `<div class="catalog-recommendation-year">${recYear}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        recommendationsEl.querySelectorAll('.catalog-recommendation-card').forEach(card => {
            card.addEventListener('click', async () => {
                const tmdbId = card.dataset.tmdbId;
                const recMediaType = card.dataset.mediaType;
                const recTitle = card.dataset.title;

                if (tmdbId) {
                    const loadingDiv = document.createElement('div');
                    loadingDiv.className = 'catalog-loading-overlay';
                    loadingDiv.innerHTML = '<div class="loading-spinner"></div><span>Загрузка...</span>';
                    detailView.appendChild(loadingDiv);

                    try {
                        const newItem = {
                            id: tmdbId,
                            media_type: recMediaType,
                            torrent: [{ name: recTitle }],
                            title: recTitle,
                            name: recTitle
                        };

                        const newDetails = await fetchCatalogItemDetails(newItem);

                        let newPosterUrl = null;
                        if (newDetails.poster_path) {
                            newPosterUrl = `https://nmtmdb.duckdns.org/t/p/w342${newDetails.poster_path}`;
                        }

                        await showCatalogDetail(newItem, 0, newPosterUrl);

                        setTimeout(() => {
                            const newWatchBtn = document.getElementById('catalog-watch-btn');
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
        });
    } else if (recommendationsWrap && source.recommendations && source.recommendations.length === 0) {
        recommendationsWrap.classList.add('hidden');
    }

    let videos = (source.videos && Array.isArray(source.videos) ? source.videos : [])
        .filter(v => {
            const type = (v.type || '').toLowerCase();
            return type.includes('trailer') || type.includes('teaser');
        })
        .slice(0, 6);

    if (videos.length > 0) {
        trailersWrap.classList.remove('hidden');
        trailersEl.classList.add('catalog-detail-trailers-grid');
        trailersEl.classList.remove('catalog-detail-trailers-links');

        trailersEl.style.cssText = `
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 16px;
            padding: 10px;
        `;

        trailersEl.innerHTML = videos.map(video => {
            const thumbUrl = `https://img.youtube.com/vi/${video.key}/mqdefault.jpg`;
            const videoTitle = video.name || 'Трейлер';
            const duration = video.duration || '';
            const formattedDuration = duration ? formatDuration(duration) : '';

            return `
                <div class="catalog-trailer-card-item" data-video-id="${escapeHtml(video.key)}" data-video-url="https://www.youtube.com/watch?v=${video.key}" data-video-title="${escapeHtml(videoTitle)}">
                    <div class="catalog-trailer-poster" style="position: relative; aspect-ratio: 16/9; overflow: hidden; border-radius: 12px; background: linear-gradient(135deg, #1a1a2e, #16213e);">
                        <img src="${thumbUrl}" alt="${escapeHtml(videoTitle)}" loading="lazy" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.parentElement.innerHTML='<div class=\\'no-poster\\' style=\\'display: flex; align-items: center; justify-content: center; height: 100%;\\'></div>'">
                        <div class="catalog-trailer-play-overlay" style="
                            position: absolute;
                            top: 0;
                            left: 0;
                            right: 0;
                            bottom: 0;
                            background: rgba(0, 0, 0, 0.4);
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            opacity: 0;
                            transition: opacity 0.3s;
                            cursor: pointer;
                        ">
                            <div style="
                                width: 60px;
                                height: 60px;
                                background: rgba(74, 158, 255, 0.9);
                                border-radius: 50%;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                font-size: 30px;
                                color: white;
                            ">▶</div>
                        </div>
                        ${formattedDuration ? `
                            <div style="
                                position: absolute;
                                bottom: 8px;
                                right: 8px;
                                background: rgba(0, 0, 0, 0.8);
                                color: white;
                                font-size: 12px;
                                padding: 3px 8px;
                                border-radius: 12px;
                                font-family: monospace;
                            ">${formattedDuration}</div>
                        ` : ''}
                    </div>
                    <div class="catalog-trailer-info" style="padding: 10px;">
                        <div class="catalog-trailer-title" style="
                            font-size: 14px;
                            font-weight: 600;
                            color: #fff;
                            margin-bottom: 5px;
                            overflow: hidden;
                            text-overflow: ellipsis;
                            white-space: nowrap;
                        ">${escapeHtml(videoTitle)}</div>
                        <div class="catalog-trailer-meta" style="
                            display: flex;
                            gap: 10px;
                            font-size: 12px;
                            color: #aaa;
                        ">
                            <span>Трейлер</span>
                            ${formattedDuration ? `<span>⏱️ ${formattedDuration}</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        trailersEl.querySelectorAll('.catalog-trailer-card-item').forEach(card => {
            const videoUrl = card.dataset.videoUrl;
            const videoTitle = card.dataset.videoTitle;

            const posterDiv = card.querySelector('.catalog-trailer-poster');
            const overlay = card.querySelector('.catalog-trailer-play-overlay');

            if (posterDiv && overlay) {
                posterDiv.addEventListener('mouseenter', () => {
                    overlay.style.opacity = '1';
                });
                posterDiv.addEventListener('mouseleave', () => {
                    overlay.style.opacity = '0';
                });
            }

            card.addEventListener('click', () => {
                if (videoUrl) {
                    hideCatalogDetailView();
                    openYoutubeInPlayer(videoUrl, videoTitle);
                }
            });
        });
    } else {
        trailersWrap.classList.add('hidden');
    }

    setTimeout(() => {
        if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
            updateFocusableElements();
            const watchIndex = typeof focusableElements !== 'undefined'
                ? focusableElements.findIndex(el => el.id === 'catalog-watch-btn')
                : -1;
            setFocus(watchIndex !== -1 ? watchIndex : 0);
        }
    }, 120);
}

function hideCatalogDetailView() {
    const detailView = document.getElementById('detail-view');
    if (!detailView) return;
    detailView.classList.remove('catalog-detail-mode');
    detailView.style.backgroundImage = '';
    const subtitleEl = document.getElementById('detail-title-subtitle');
    if (subtitleEl) subtitleEl.textContent = '';
    AppState.detailMode = null;
}

function updateCatalogWatchButton(title) {
    const watchBtn = document.getElementById('catalog-watch-btn');
    if (watchBtn) {
        if (title) {
            watchBtn.textContent = `Найти торренты для "${title}"`;
            watchBtn.dataset.searchTitle = title;
        } else {
            watchBtn.textContent = `Найти торренты`;
        }
    }
}

function onCatalogItemClick(item, index) {
    catalogState.lastSelectedIndex = index;
    catalogState.lastSelectedId = item.id;

    const numIndex = item.num_index || index;
    localStorage.setItem('lastCatalogCardIndex', numIndex);

    const card = document.querySelector(`.torrent-card.catalog-card[data-catalog-index="${index}"]`);
    let posterUrl = null;

    if (card) {
        const img = card.querySelector('.torrent-poster img');
        if (img && img.src) {
            posterUrl = img.src;
        }
    }

    showCatalogDetail(item, index, posterUrl);
}

// ==================== ПОИСК ИЗ КАТАЛОГА ====================

function showCatalogSearch(query, posterUrl = null, catalogItem = null) {
    const searchTab = document.getElementById('tab-search');
    const torrentsTab = document.getElementById('tab-torrents');
    const catalogTab = document.getElementById('tab-catalog');
    const searchOverlay = document.getElementById('search-overlay');
    const searchInput = document.getElementById('search-query');

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
            document.getElementById('torrent-movie').value = 'torrentsearch';
            window.searchTorrentsLegacy(query);
        }

        setTimeout(() => {
            if (typeof window.focusSearchHome === 'function') {
                window.focusSearchHome(true);
            } else if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
                updateFocusableElements();
                const searchInputIndex = focusableElements.findIndex(el => el.id === 'search-query');
                setFocus(searchInputIndex !== -1 ? searchInputIndex : 0);
            }
        }, 200);
    }
}

// ==================== YOUTUBE ПЛЕЕР ====================

async function openYoutubeInPlayer(youtubeUrl, videoTitle) {
    console.log('Открываем YouTube в плеере:', youtubeUrl);

    const currentDetailItem = AppState.currentDetailItem;
    const catalogName = catalogState.currentCatalog;
    const itemIndex = catalogState.lastSelectedIndex;

    const detailView = document.getElementById('detail-view');
    const mainContainer = document.getElementById('main-container');
    if (detailView) {
        detailView.style.display = 'none';
        detailView.style.pointerEvents = 'none';
    }
    if (mainContainer) {
        mainContainer.style.pointerEvents = 'none';
    }

    const playbackOverlay = document.getElementById('playback-overlay');
    if (playbackOverlay) {
        playbackOverlay.classList.add('active');
        document.querySelector('.playback-text').textContent = `Загрузка трейлера: ${videoTitle}...`;
    }

    try {
        const statusResponse = await fetch(`${SERVER_URL}/api/youtube/status`);
        const status = await statusResponse.json();

        if (!status.available) {
            throw new Error('yt-dlp не установлен на сервере');
        }

        const streamResponse = await fetch(`${SERVER_URL}/hls/youtube?url=${encodeURIComponent(youtubeUrl)}&quality=best`);

        if (!streamResponse.ok) {
            throw new Error(`HTTP ${streamResponse.status}`);
        }

        const streamData = await streamResponse.json();

        if (!streamData.success) {
            throw new Error(streamData.error || 'Ошибка создания потока');
        }

        console.log('✅ YouTube поток создан:', streamData);

        const oldStreamId = AppState.currentStreamId;
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

        const fakeItem = {
            title: videoTitle,
            hash: null,
            isYoutube: true,
            youtubeUrl: youtubeUrl
        };
        AppState.currentDetailItem = fakeItem;

        if (oldStreamId) {
            await fetch(`${SERVER_URL}/hls/stop/${oldStreamId}`, { method: 'POST' }).catch(() => { });
        }

        if (window.destroyHls) {
            window.destroyHls();
        }

        const videoPlayer = document.getElementById('video-player');

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

            let playbackStarted = false;
            let bufferCheckInterval = null;

            AppState.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                console.log('📜 YouTube манифест распарсен');

                if (typeof window.updatePlayerTitle === 'function') {
                    window.updatePlayerTitle(`Трейлер: ${videoTitle}`);
                }

                videoPlayer.currentTime = 0;
                videoPlayer.pause();

                const checkBuffer = () => {
                    if (playbackStarted) return;

                    if (videoPlayer.buffered && videoPlayer.buffered.length > 0) {
                        const bufferedEnd = videoPlayer.buffered.end(videoPlayer.buffered.length - 1);
                        const currentTime = videoPlayer.currentTime;
                        const bufferAhead = bufferedEnd - currentTime;

                        if (bufferAhead >= 3) {
                            if (bufferCheckInterval) clearInterval(bufferCheckInterval);

                            if (playbackOverlay) playbackOverlay.classList.remove('active');

                            videoPlayer.play().catch((err) => {
                                console.log('🔇 Автоплей заблокирован');
                                videoPlayer.muted = true;
                                videoPlayer.play().catch(() => { });
                                if (typeof window.updateMuteButton === 'function') window.updateMuteButton();
                            });

                            playbackStarted = true;

                            document.getElementById('player-screen').style.display = 'block';
                            document.getElementById('config-screen').style.display = 'none';
                            document.getElementById('torrserver-section').style.display = 'none';

                            document.querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));

                            if (typeof window.resetMouseIdleTimer === 'function') {
                                window.resetMouseIdleTimer();
                            }
                        }
                    }
                };

                bufferCheckInterval = setInterval(checkBuffer, 500);

                setTimeout(() => {
                    if (!playbackStarted) {
                        if (bufferCheckInterval) clearInterval(bufferCheckInterval);
                        if (playbackOverlay) playbackOverlay.classList.remove('active');
                        videoPlayer.play().catch(() => { });
                        playbackStarted = true;
                        document.getElementById('player-screen').style.display = 'block';
                    }
                }, 10000);
            });

            AppState.hls.on(Hls.Events.ERROR, (event, data) => {
                console.error('HLS ошибка:', data);
                if (data.fatal) {
                    if (playbackOverlay) playbackOverlay.classList.remove('active');
                    alert('Ошибка воспроизведения трейлера');
                }
            });

        } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
            videoPlayer.src = streamData.playlistUrl;

            videoPlayer.addEventListener('loadedmetadata', () => {
                if (typeof window.updatePlayerTitle === 'function') {
                    window.updatePlayerTitle(`Трейлер: ${videoTitle}`);
                }

                if (playbackOverlay) playbackOverlay.classList.remove('active');
                videoPlayer.play().catch(() => { });
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
        fetch(`${SERVER_URL}/hls/stop/${AppState.currentStreamId}`, { method: 'POST' }).catch(() => { });
        AppState.currentStreamId = null;
    }

    if (AppState.hls) {
        AppState.hls.destroy();
        AppState.hls = null;
    }

    AppState.isYoutubePlayback = false;

    const context = AppState.youtubeContext;

    if (context && context.currentDetailItem && context.currentDetailItem.id) {
        console.log('Возвращаемся к детальному просмотру:', context.currentDetailItem.title);

        AppState.currentScreen = 'detail';
        document.getElementById('player-screen').style.display = 'none';

        const detailView = document.getElementById('detail-view');
        const mainContainer = document.getElementById('main-container');

        if (detailView) {
            detailView.style.display = 'block';
            detailView.style.pointerEvents = 'auto';
        }

        if (mainContainer) {
            mainContainer.style.pointerEvents = 'auto';
        }

        setTimeout(async () => {
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
        const torrserverSection = document.getElementById('torrserver-section');
        if (torrserverSection) {
            torrserverSection.style.display = 'block';
        }
        document.getElementById('config-screen').style.display = 'none';
        if (typeof loadTorrents === 'function') {
            loadTorrents(true);
        }
    }

    setTimeout(() => {
        if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
            updateFocusableElements();

            const watchBtn = document.getElementById('catalog-watch-btn');
            if (watchBtn) {
                const watchIndex = focusableElements.findIndex(el => el.id === 'catalog-watch-btn');
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
        const response = await fetch(`${SERVER_URL}/api/catalogs`);
        if (!response.ok) throw new Error('Ошибка загрузки списка каталогов');

        const data = await response.json();
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
    const torrentsGrid = document.getElementById('torrents-grid');
    if (!torrentsGrid) return;

    abortCatalogRequests();

    catalogState.currentCatalog = null;
    catalogState.items = [];
    catalogState.loading = false;
    catalogState.loadedPostersCount = 0;
    catalogState.posterLoadQueue = [];

    catalogState.lastSelectedIndex = 0;
    catalogState.lastSelectedId = null;

    const tabCatalog = document.getElementById('tab-catalog');
    const tabTorrents = document.getElementById('tab-torrents');
    const tabSearch = document.getElementById('tab-search');

    if (tabCatalog) tabCatalog.classList.add('active');
    if (tabTorrents) tabTorrents.classList.remove('active');
    if (tabSearch) tabSearch.classList.remove('active');

    torrentsGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">
            <div class="loading-spinner" style="margin: 0 auto 20px;"></div>
            <div style="font-size: 16px; color: #aaa;">Загрузка списка каталогов...</div>
        </div>
    `;

    const availableCatalogs = await fetchAvailableCatalogs();

    if (AppState.currentScreen !== 'catalog') {
        return;
    }

    torrentsGrid.innerHTML = '';

    if (availableCatalogs.length === 0) {
        Object.entries(CATALOG_CONFIG).forEach(([key, config]) => {
            const card = createCatalogFolderCard(key, config);
            torrentsGrid.appendChild(card);
        });
    } else {
        availableCatalogs.forEach((catalog) => {
            const config = CATALOG_CONFIG[catalog.id] || {
                name: catalog.displayName || catalog.id,
                mediaType: catalog.id.includes('tv') ? 'tv' : 'movie'
            };

            const card = createCatalogFolderCard(catalog.id, config);
            torrentsGrid.appendChild(card);
        });
    }

    setTimeout(() => {
        if (AppState.currentScreen === 'catalog') {
            if (typeof updateFocusableElements === 'function') {
                updateFocusableElements();
            }
            setTimeout(() => {
                if (typeof window.focusFirstCatalogCard === 'function') {
                    window.focusFirstCatalogCard();
                }
            }, 100);
        }
    }, 200);
}

function createCatalogFolderCard(key, config) {
    const card = document.createElement('div');
    card.className = 'torrent-card catalog-folder-card';
    card.dataset.catalogKey = key;

    let posterHtml = '';
    if (key.includes('movie')) posterHtml = '<img src="https://cash94.github.io/msx/img/Films.jpg" style="width: 100%; height: 100%; object-fit: cover;">';
    else if (key.includes('quadhd')) posterHtml = '<img src="https://cash94.github.io/msx/img/Films4k.jpg" style="width: 100%; height: 100%; object-fit: cover;">';
    else if (key.includes('legends')) posterHtml = '<img src="https://cash94.github.io/msx/img/BestFilms.jpg" style="width: 100%; height: 100%; object-fit: cover;">';
    else if (key.includes('tv')) posterHtml = '<img src="https://cash94.github.io/msx/img/Serials.jpg" style="width: 100%; height: 100%; object-fit: cover;">';
    else if (key.includes('cartoons')) posterHtml = '<img src="https://cash94.github.io/msx/img/Anime.jpg" style="width: 100%; height: 100%; object-fit: cover;">';
    else if (key.includes('anime')) posterHtml = '<img src="https://cash94.github.io/msx/img/Anime.jpg" style="width: 100%; height: 100%; object-fit: cover;">';
    else posterHtml = '<div style="font-size: 64px; display: flex; align-items: center; justify-content: center; height: 100%;"></div>';

    card.innerHTML = `
        <div class="torrent-poster catalog-folder-poster">
            <div style="position: relative; width: 100%; height: 100%;">
                ${posterHtml}
            </div>
        </div>
        <div class="torrent-info">
            <div class="torrent-title">${config.name}</div>
            <div class="torrent-meta">
                <span></span>
                <span class="torrent-badge catalog-badge"></span>
            </div>
        </div>
    `;

    card.addEventListener('click', () => {
        catalogState.selectedCatalog = key;
        loadCatalog(key);
    });

    return card;
}

function showCatalogLoading(message) {
    const torrentsGrid = document.getElementById('torrents-grid');
    if (torrentsGrid) {
        torrentsGrid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">
                <div class="loading-spinner" style="margin: 0 auto 20px;"></div>
                <div style="font-size: 16px; color: #aaa;">${message || 'Загрузка каталога...'}</div>
            </div>
        `;
    }
}

function showCatalogError(message) {
    const torrentsGrid = document.getElementById('torrents-grid');
    if (torrentsGrid) {
        torrentsGrid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">
                <div style="font-size: 48px; margin-bottom: 20px;"></div>
                <div style="font-size: 16px; color: #ff6a6a;">${message}</div>
                <button class="btn" style="margin-top: 20px;" onclick="window.loadCatalogList()">Попробовать снова</button>
            </div>
        `;
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
    catalogState.loadedItemIds.clear();
    catalogState.loadedPostersCount = 0;
    catalogState.posterLoadQueue = [];

    catalogState.lastSelectedIndex = 0;
    catalogState.lastSelectedId = null;

    localStorage.removeItem('lastCatalogCardIndex');

    showCatalogList();

    setTimeout(() => {
        if (AppState.currentScreen === 'catalog') {
            if (typeof updateFocusableElements === 'function') {
                updateFocusableElements();
            }
            setTimeout(() => {
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

    const trigger = document.getElementById('load-more-trigger');
    if (trigger) {
        const spinner = trigger.querySelector('.loading-spinner-small');
        if (spinner) spinner.style.display = 'inline-block';
    }

    const targetRow = Math.floor(currentIndex / cols) + 1;

    await loadMoreCatalogItems();

    setTimeout(() => {
        const updatedCards = Array.from(document.querySelectorAll('.torrent-card.catalog-card')).filter(
            el => el && el.offsetParent !== null
        );

        const newIndex = targetRow * cols;

        if (updatedCards.length > newIndex) {
            if (typeof updateFocusableElements === 'function') {
                updateFocusableElements();
            }

            setTimeout(() => {
                const targetCard = updatedCards[newIndex];
                if (targetCard && typeof setFocus === 'function') {
                    const globalIndex = focusableElements.indexOf(targetCard);
                    if (globalIndex !== -1) {
                        setFocus(globalIndex);
                        console.log(`Автофокус на карточку ${newIndex + 1}`);
                    }
                }
            }, 100);
        }

        if (trigger) {
            const spinner = trigger.querySelector('.loading-spinner-small');
            if (spinner) spinner.style.display = 'none';
        }
    }, 300);
};

window.checkAndLoadMoreOnNavigation = function () {
    if (catalogState.currentCatalog &&
        catalogState.hasMore &&
        !catalogState.isLoadingMore) {
        console.log('📦 Навигация вниз, загружаем следующую страницу');

        const trigger = document.getElementById('load-more-trigger');
        if (trigger) {
            const spinner = trigger.querySelector('.loading-spinner-small');
            if (spinner) spinner.style.display = 'inline-block';
        }

        loadMoreCatalogItems().finally(() => {
            if (trigger) {
                const spinner = trigger.querySelector('.loading-spinner-small');
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

    const cards = document.querySelectorAll('.torrent-card.catalog-card');
    let targetIndex = 0;

    for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const numIndex = card.dataset.numIndex;
        if (numIndex && parseInt(numIndex) === targetNumIndex) {
            targetIndex = i;
            break;
        }
    }

    if (targetIndex === 0 && targetNumIndex < cards.length) {
        targetIndex = targetNumIndex;
    }

    console.log(`Возвращаем индекс ${targetIndex} для num_index ${targetNumIndex}`);
    return targetIndex;
};

// ==================== ПЕРИОДИЧЕСКАЯ ОЧИСТКА КЭША ====================

let tmdbCacheCleanupInterval = null;

function startTmdbCacheCleanup() {
    if (tmdbCacheCleanupInterval) {
        clearInterval(tmdbCacheCleanupInterval);
    }

    tmdbCacheCleanupInterval = setInterval(() => {
        cleanOldTmdbCache();
    }, TMDB_CACHE_CONFIG.cleanupInterval);

    console.log(`Запущена периодическая очистка TMDB кэша (каждые ${TMDB_CACHE_CONFIG.cleanupInterval / 1000} сек)`);
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
        setEnabled: (enabled) => { TMDB_CACHE_CONFIG.enabled = enabled; },
        isEnabled: () => TMDB_CACHE_CONFIG.enabled,
        setTtl: (ttlMs) => { TMDB_CACHE_CONFIG.ttl = ttlMs; }
    };
}

document.addEventListener('keydown', function (e) {
    if (AppState.currentScreen === 'catalog' && catalogState.currentCatalog) {
        const isBackKey = [8, 27, 461, 10009].includes(e.keyCode) ||
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

window.catalog = {
    loadCatalog,
    showCatalogList,
    backToCatalogList,
    tmdbCache: {
        clear: clearTmdbCache,
        stats: getTmdbCacheStats
    }
};
