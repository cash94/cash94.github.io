// catalog.js - Оптимизированный модуль для работы с каталогами
// Совместим с Android TV (Chromium 70+)

// ==================== КОНСТАНТЫ ====================
var CATALOG_CONSTANTS = {
    CACHE_TTL_MS: 3600000,              // 1 час
    FETCH_TIMEOUT_MS: 5000,             // 5 секунд
    CATALOG_CACHE_TTL_MS: 3600000,      // 1 час для каталогов
    ITEMS_PER_PAGE: 150,
    MAX_POSTER_CACHE: 400,              // только строки-URL: ~50 КБ на 400 записей.
    // Карточек на экране рядов ~90, в сетке до 150 — при лимите 20 кэш почти
    // всегда промахивался и URL постера каждый раз запрашивался у воркера.
    MAX_DETAIL_HISTORY: 50,
    POSTER_BATCH_SIZE: 15,
    TMDB_MAX_CACHE_SIZE: 10,
    TMDB_CLEANUP_INTERVAL_MS: 300000,   // 5 минут
    MAX_ACTORS: 12,
    MAX_RECOMMENDATIONS: 12,
    MAX_TRAILERS: 6,
    LOAD_MORE_MARGIN_PX: 300,
    POSTER_OBSERVER_MARGIN_PX: 1200,
    // Ряды: запас по горизонтали держим маленьким. Вертикальные 1200px — это
    // «следующие ряды», их надо готовить заранее. По горизонтали же 1200px дают
    // +5 карточек за краем экрана, и при входе ряда в кадр в очередь разом
    // улетают все видимые плюс запас — десяток декодов и вставок посреди
    // навигации, то есть фриз. 400px — полторы карточки: постер успевает
    // появиться до того, как до него дойдёт фокус, а работа размазана
    // по нажатиям вместо одного залпа.
    ROW_POSTER_MARGIN_X_PX: 400,
    CATALOG_UPDATE_THRESHOLD_HOURS: 6,
    MAX_POSTER_DECODES: 8,
    FOCUS_DELAY_MS: 100,
    ROW_POSTER_CONCURRENCY: 10,
    VISIBILITY_WINDOW_ROWS: 2,          // сколько строк «запаса» держим отрисованными
    VISIBILITY_FALLBACK_MARGIN_PX: 800, // если высоту строки измерить не удалось
    IMG_SIZES: {
        POSTER_CARD: 'w342',
        POSTER_SMALL: 'w185',
        POSTER_MEDIUM: 'w342',
        BACKDROP: 'w1280'
    }
};

// Массив доменов, который легко расширять
var mirrors = [
    'tsimg.hnar.online',
    'nl.imagetmdb.com',
    'mocha.stull.xyz',
    'proxy.vokino.pro/image',
    'nmtmdb.duckdns.org'
    // 'another-mirror.com' // можно добавлять новые через запятую
];

/**
 * Выбирает зеркало детерминированно — по пути самого изображения.
 * Раньше здесь был Math.random(): один и тот же постер каждый раз приезжал
 * с другого хоста, поэтому HTTP-кэш браузера почти не работал (при 5 зеркалах
 * шанс попасть в уже скачанный файл — 1/5), а URL в posterCache не совпадал
 * с тем, что реально грузилось. Балансировка сохраняется: разные постеры
 * по-прежнему расходятся по всем зеркалам, но каждый — всегда на своё.
 */
function pickMirror(path) {
    var h = 0;
    for (var i = 0; i < path.length; i++) {
        h = ((h << 5) - h + path.charCodeAt(i)) | 0;
    }
    return mirrors[Math.abs(h) % mirrors.length];
}

/**
 * Тот же путь на следующем зеркале — фоллбэк для img.onerror.
 * Нужен именно из-за детерминированного выбора: мёртвый хост иначе ронял бы
 * один и тот же набор постеров всегда, а не случайную пятую часть.
 */
function getTmdbNextMirrorUrl(url) {
    if (!url || typeof url !== 'string') return null;
    var m = url.match(/^(https?:)\/\/(.+?)(\/t\/p\/.+)$/i);
    if (!m) return null;
    var i = mirrors.indexOf(m[2]);
    if (i === -1) return null;
    return m[1] + '//' + mirrors[(i + 1) % mirrors.length] + m[3];
}

function getTmdbImageUrl(pathOrUrl, size) {
    if (!pathOrUrl || typeof pathOrUrl !== 'string') return pathOrUrl || '';

    var path = null;
    var value = pathOrUrl.trim();

    // Старые записи в кэше могут уже содержать URL tsimg/TMDB/другого зеркала.
    // Для них извлекаем только путь изображения и выбираем зеркало заново.
    if (/^https?:\/\//i.test(value)) {
        var match = value.match(/\/t\/p\/[^/]+(\/[^?#]+)(?:[?#].*)?$/i);
        if (!match) return value; // не TMDB-изображение, например внешний постер
        path = match[1];
    } else {
        path = value.charAt(0) === '/' ? value : '/' + value;
    }

    var mirror = pickMirror(path);
    return getProtocolBase() + '//' + mirror + '/t/p/' +
        (size || CATALOG_CONSTANTS.IMG_SIZES.POSTER_MEDIUM) + path;
}

function replaceTmdbWithProxy(url) {
    if (!url || typeof url !== 'string' || url.indexOf('image.tmdb.org') === -1) return url;
    return getTmdbImageUrl(url);
}

window.replaceTmdbWithProxy = replaceTmdbWithProxy;
window.getTmdbImageUrl = getTmdbImageUrl;

// ==================== КОНФИГУРАЦИЯ КАТАЛОГОВ ====================
var CATALOG_CONFIG = {
    movie: { name: 'Фильмы', url: SERVER_URL + '/api/catalog/movie', mediaType: 'movie' },
    tv: { name: 'Сериалы', url: SERVER_URL + '/api/catalog/tv', mediaType: 'tv' },
    cartoons: { name: 'Мультфильмы', url: SERVER_URL + '/api/catalog/cartoons', mediaType: 'movie' },
    cartoons_tv: { name: 'Мультсериалы', url: SERVER_URL + '/api/catalog/cartoons_tv', mediaType: 'tv' },
    anime: { name: 'Аниме', url: SERVER_URL + '/api/catalog/anime', mediaType: 'tv' },
    rus: { name: 'Русские', url: SERVER_URL + '/api/rus', mediaType: 'movie' },
    quadhd: { name: 'Фильмы в 4K', url: SERVER_URL + '/api/catalog/quadhd', mediaType: 'movie' },
    legends: { name: 'Лучшие фильмы', url: SERVER_URL + '/api/catalog/legends', mediaType: 'movie' },
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

// ==================== LRU + TTL КЭШ ====================
function LRUTTLCache(maxSize, ttl) {
    this.maxSize = maxSize > 0 ? maxSize : 100;
    this.ttl = ttl > 0 ? ttl : 0;
    this.cache = new Map();
}

LRUTTLCache.prototype._isExpired = function (entry) {
    if (!entry) return true;
    if (this.ttl <= 0) return false;

    var ts = (entry.value && entry.value.timestamp)
        ? entry.value.timestamp
        : entry.timestamp;

    return (Date.now() - ts) > this.ttl;
};

LRUTTLCache.prototype.get = function (key) {
    var entry = this.cache.get(key);

    if (!entry) return undefined;

    if (this._isExpired(entry)) {
        this.cache.delete(key);
        return undefined;
    }

    // LRU: поднимаем запись в конец
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
};

LRUTTLCache.prototype.has = function (key) {
    var entry = this.cache.get(key);

    if (!entry) return false;

    if (this._isExpired(entry)) {
        this.cache.delete(key);
        return false;
    }

    return true;
};

LRUTTLCache.prototype.set = function (key, value) {
    if (this.cache.has(key)) {
        this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
        var firstKey = this.cache.keys().next().value;
        if (firstKey !== undefined) {
            this.cache.delete(firstKey);
        }
    }

    var now = Date.now();
    var ts = (value && value.timestamp) ? value.timestamp : now;

    this.cache.set(key, {
        value: value,
        timestamp: ts
    });
};

LRUTTLCache.prototype.delete = function (key) {
    return this.cache.delete(key);
};

LRUTTLCache.prototype.clear = function () {
    this.cache.clear();
};

LRUTTLCache.prototype.size = function () {
    return this.cache.size;
};

LRUTTLCache.prototype.forEach = function (callback, includeExpired) {
    var self = this;

    this.cache.forEach(function (entry, key) {
        if (includeExpired || !self._isExpired(entry)) {
            callback(entry.value, key, entry);
        }
    });
};

LRUTTLCache.prototype.cleanExpired = function () {
    var self = this;

    this.cache.forEach(function (entry, key) {
        if (self._isExpired(entry)) {
            self.cache.delete(key);
        }
    });
};

LRUTTLCache.prototype.trimToMax = function () {
    while (this.cache.size > this.maxSize) {
        var firstKey = this.cache.keys().next().value;
        if (firstKey === undefined) break;
        this.cache.delete(firstKey);
    }
};
// ==================== /LRU + TTL КЭШ ====================

function getPosterCardSize() {
    return (
        CATALOG_CONSTANTS.IMG_SIZES.POSTER_CARD ||
        CATALOG_CONSTANTS.IMG_SIZES.POSTER_SMALL ||
        'w185'
    );
}

function getProtocolBase() {
    var p = (window.AppState && AppState.protocol) || 'https:';
    p = String(p).replace(/\/+$/, '');
    if (p.indexOf(':') === -1) p += ':';
    return p;
}

function normalizePosterUrl(url) {
    if (!url) return '';

    var size = getPosterCardSize();
    return getTmdbImageUrl(url, size);
}

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
var cats = [];

var TMDB_CACHE_CONFIG = {
    ttl: CATALOG_CONSTANTS.CACHE_TTL_MS,
    maxSize: CATALOG_CONSTANTS.TMDB_MAX_CACHE_SIZE,
    cleanupInterval: CATALOG_CONSTANTS.TMDB_CLEANUP_INTERVAL_MS,
    enabled: true
};

var tmdbCache = new LRUTTLCache(
    TMDB_CACHE_CONFIG.maxSize,
    TMDB_CACHE_CONFIG.ttl
);

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
    if (!TMDB_CACHE_CONFIG.enabled || !tmdbCache) return null;

    var key = getTmdbCacheKey(endpoint, params);
    var cached = tmdbCache.get(key);

    if (!cached) return null;

    return cached.data !== undefined ? cached.data : null;
}

function saveToTmdbCache(endpoint, params, data) {
    if (!TMDB_CACHE_CONFIG.enabled || !tmdbCache) return;

    var key = getTmdbCacheKey(endpoint, params);

    tmdbCache.set(key, {
        data: data,
        timestamp: Date.now()
    });
}

function cleanOldTmdbCache() {
    if (!tmdbCache) return;

    tmdbCache.cleanExpired();
    tmdbCache.trimToMax();
}

function clearTmdbCache() {
    if (tmdbCache) tmdbCache.clear();
}

function getTmdbCacheStats() {
    var now = Date.now();
    var valid = 0;
    var expired = 0;
    var size = 0;

    if (!tmdbCache) {
        return {
            totalEntries: 0,
            validEntries: 0,
            expiredEntries: 0,
            totalSizeMB: '0.00',
            maxSize: TMDB_CACHE_CONFIG.maxSize,
            ttlHours: TMDB_CACHE_CONFIG.ttl / 3600000,
            enabled: TMDB_CACHE_CONFIG.enabled
        };
    }

    tmdbCache.forEach(function (cached, key, entry) {
        try {
            size += JSON.stringify(cached.data).length;
        } catch (e) {
            // если данные не сериализуются — просто пропускаем размер
        }

        var ts = (cached && cached.timestamp)
            ? cached.timestamp
            : entry.timestamp;

        if (now - ts < TMDB_CACHE_CONFIG.ttl) {
            valid++;
        } else {
            expired++;
        }
    }, true);

    return {
        totalEntries: valid + expired,
        validEntries: valid,
        expiredEntries: expired,
        totalSizeMB: (size / 1048576).toFixed(2),
        maxSize: TMDB_CACHE_CONFIG.maxSize,
        ttlHours: TMDB_CACHE_CONFIG.ttl / 3600000,
        enabled: TMDB_CACHE_CONFIG.enabled
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
    // Постеры, дождавшиеся конца перехода на другую строку (см. deferPosterUntilScrollEnds)
    posterDeferred: [], posterDeferredRaf: 0,
    cardElements: {},
    posterCache: new LRUCache(CATALOG_CONSTANTS.MAX_POSTER_CACHE),
    maxPosterCacheSize: CATALOG_CONSTANTS.MAX_POSTER_CACHE,
    rowPosterObserver: null,
    rowPosterQueue: [],
    activeRowPosterLoads: 0,
    // Оконная видимость (см. initRowVisibilityWindow / initGridVisibilityWindow)
    rowVisibilityObserver: null,
    gridVisibilityObserver: null
};

// catalogCache удалён: единственным его читателем был loadCatalog ниже, а он
// целиком переопределён в catalog-idb-patch.js. Полные каталоги теперь живут
// в IndexedDB (catalog-worker.js), кэш в куче был только записью в мусор.

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function abortCatalogRequests() {
    if (catalogState.abortController) { catalogState.abortController.abort(); catalogState.abortController = null; }
    if (catalogState.posterObserver) { catalogState.posterObserver.disconnect(); catalogState.posterObserver = null; }
    if (catalogState.loadMoreObserver) { catalogState.loadMoreObserver.disconnect(); catalogState.loadMoreObserver = null; }
    if (catalogState.rowPosterObserver) { catalogState.rowPosterObserver.disconnect(); catalogState.rowPosterObserver = null; }
    resetDeferredPosters();
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
    AppState.openInRow = false;

    if (catalogState.currentCatalog === key &&
        catalogState.items.length > 0 &&
        getCatalogGridEl() &&
        getCatalogGridEl().querySelector('.torrent-card.catalog-card')) {
        showCatalogGridView();
        return;
    }

    AppState.backCurrentCatalog = key;
    abortCatalogRequests();
    catalogState.abortController = new AbortController();
    var config = CATALOG_CONFIG[key];
    catalogState.currentCatalog = key;
    catalogState.cardElements = {};
    catalogState.items = []; catalogState.totalItems = 0; catalogState.currentPage = 0;
    catalogState.hasMore = true; catalogState.isLoadingMore = false; catalogState.loadedItemIds = {};
    catalogState.loadedPostersCount = 0; catalogState.posterLoadQueue = [];
    // Keep the bounded LRU across catalog switches so cached w342 poster URLs
    // can be rendered immediately without another Worker or IndexedDB lookup.
    AppState.mediaType = config.mediaType;
    showCatalogLoading('Загрузка ' + config.name + '...');
    await loadMoreCatalogItems(true);
    catalogState.abortController = null;
}

async function loadHistoryCatalog() {
    abortCatalogRequests();
    AppState.openInRow = false;
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
    var g = getCatalogGridEl();
    if (!g) return;
    showCatalogGridView();
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

// Подмена одного вида другим раньше была рывком: содержимое #catalog-grid
// заменялось мгновенно. Теперь уходящий вид затухает, и только потом на его
// место проявляется приходящий (см. backToCatalogList → showCatalogRowsView).
//
// Гасится всегда ровно один вид, поэтому вместо флага храним сам элемент: только
// он имеет право на проявление через fadeIn, остальным достаётся обычный display.
var catalogFadedEl = null;                // вид, спрятанный затуханием и ждущий проявления

function getCatalogRowsEl() { return getEl('catalog-rows'); }
function getCatalogGridEl() { return getEl('catalog-grid'); }

// Плавно спрятать вид перед подменой содержимого. display не трогаем: спиннер
// «Загрузка...» пишется в невидимый контейнер, а display:none помешал бы
// потом его проявить.
function fadeOutCatalogGrid(onDone, el) {
    var target = el || getCatalogGridEl();
    if (!target || typeof Animations === 'undefined' || typeof Animations.fadeOut !== 'function') {
        if (onDone) onDone();
        return;
    }
    Animations.fadeOut(target, {
        duration: 0.2,
        keepFaded: true,
        onDone: function () {
            catalogFadedEl = target;
            if (onDone) onDone();
        }
    });
}

// Проявить вид обратно. Если его никто не прятал — обычное присвоение display,
// как было раньше.
function revealCatalogGrid(display, el) {
    var target = el || getCatalogGridEl();
    if (!target) return;
    if (catalogFadedEl !== target || typeof Animations === 'undefined' || typeof Animations.fadeIn !== 'function') {
        if (typeof display === 'string') target.style.display = display;
        return;
    }
    catalogFadedEl = null;
    var options = { duration: Animations.UI_FADE.content };
    if (typeof display === 'string') options.display = display;
    Animations.fadeIn(target, options);
}

// Сбросить незакончившееся затухание: содержимое, записанное в контейнер помимо
// обычного пути, не должно остаться невидимым
function ensureCatalogGridVisible(el) {
    var target = el || getCatalogGridEl();
    if (catalogFadedEl === target) catalogFadedEl = null;
    if (target && typeof Animations !== 'undefined' && typeof Animations.resetFade === 'function') {
        Animations.resetFade(target);
    } else if (target) {
        target.style.opacity = '';
    }
}

// ==================== ПЕРЕКЛЮЧЕНИЕ ВИДОВ КАТАЛОГА ====================
// Оба вида лежат в общем потоке #content-catalog, одновременно показать их нельзя —
// сетка встала бы под рядами. Поэтому уходящий прячем через display:none.
// Вертикальный скролл (#main-container) у видов общий.

function showCatalogGridView() {
    var rows = getCatalogRowsEl(), grid = getCatalogGridEl();
    if (rows && rows.style.display !== 'none') {
        if (typeof Animations !== 'undefined' && typeof Animations.resetFade === 'function') {
            Animations.resetFade(rows);
        }
        if (catalogFadedEl === rows) catalogFadedEl = null;
        rows.style.display = 'none';
    }
    if (grid) grid.style.display = '';
    // Сменился видимый контейнер → сменился состав фокусируемых элементов
    if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
}

function showCatalogRowsView() {
    var rows = getCatalogRowsEl(), grid = getCatalogGridEl();
    // Сетку категории не держим в DOM: сотни карточек с постерами на слабом ТВ
    // дороже, чем повторная отрисовка при следующем входе в категорию.
    if (grid) {
        if (typeof Animations !== 'undefined' && typeof Animations.resetFade === 'function') {
            Animations.resetFade(grid);
        }
        if (catalogFadedEl === grid) catalogFadedEl = null;
        grid.style.display = 'none';
        grid.innerHTML = '';
        resetGridVisibilityWindow();
    }
    if (!rows) return;
    // Скролл сбрасываем ДО показа: #main-container остался на позиции сетки
    // категории, а фокус всё равно уедет на первую карточку первого ряда
    // (restoreRowFocus без lastSelectedRowKey). Без сброса ряды сначала
    // появились бы на чужой позиции и только потом прыгнули наверх.
    var mc = getEl('main-container');
    if (mc) mc.scrollTop = 0;
    // Оконная видимость: классы остались от прежней позиции скролла
    revealAllCatalogRows();
    var wasHidden = rows.style.display === 'none';
    if (wasHidden && typeof Animations !== 'undefined' && typeof Animations.fadeIn === 'function') {
        Animations.fadeIn(rows, { duration: Animations.UI_FADE.content, display: '' });
    } else {
        ensureCatalogGridVisible(rows);
        rows.style.display = '';
    }
    // Сменился видимый контейнер (плюс сетка категории только что очищена)
    if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
}

function renderCatalogGrid() {
    var grid = getCatalogGridEl();
    if (!grid) return;
    ensureCatalogGridVisible();
    showCatalogGridView();
    grid.innerHTML = '';
    if (catalogState.items.length === 0) { showEmptyCatalog(); return; }
    addCatalogHeader(grid);

    // ⚡ Рендерим ВСЁ сразу — постеры загрузятся фоном через lazy loading
    var frag = document.createDocumentFragment();
    for (var i = 0; i < catalogState.items.length; i++) {
        frag.appendChild(createCatalogCard(catalogState.items[i], i));
    }
    grid.appendChild(frag);

    // Финализация
    if (catalogState.hasMore) addLoadMoreTrigger(grid);
    catalogState.loadedPostersCount = 0;
    if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
    resetDeferredPosters();   // индексы прошлой сетки больше не действительны
    initPosterLazyLoading();
    //initPosterUnloading();   // ⚡ Включаем выгрузку постеров
    initGridVisibilityWindow();
    initLoadMoreObserver();
    loadInitialPosters();

    requestAnimationFrame(function () {
        measureCatalogCardHeight();   // высота ряда известна только после отрисовки
        if (AppState.currentScreen === 'catalog' && catalogState.currentCatalog) {
            if (typeof updateFocusableElements === 'function') updateFocusableElements();
            setTimeout(function () {
                if (typeof window.focusFirstCatalogCard === 'function') window.focusFirstCatalogCard();
            }, CATALOG_CONSTANTS.FOCUS_DELAY_MS);
        }
    });
}

function appendCatalogItems(newItems) {
    var grid = getCatalogGridEl();
    if (!grid) return;
    showCatalogGridView();

    var old = getEl('load-more-trigger');
    if (old) old.remove();

    var start = catalogState.items.length - newItems.length;
    var currentCatalogKey = catalogState.currentCatalog;

    // ⚡ Рендерим все новые элементы сразу (их обычно 18-50 штук)
    if (catalogState.currentCatalog !== currentCatalogKey) return;

    var frag = document.createDocumentFragment();
    for (var i = 0; i < newItems.length; i++) {
        frag.appendChild(createCatalogCard(newItems[i], start + i));
    }
    grid.appendChild(frag);

    // Финализация
    if (catalogState.hasMore) addLoadMoreTrigger(grid);
    if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
    updatePosterObservers();
    //initPosterUnloading();   // ⚡ Включаем выгрузку постеров
    updateGridVisibilityWindow();
    initLoadMoreObserver();

    if (AppState.currentScreen === 'catalog' && catalogState.currentCatalog) {
        if (typeof updateFocusableElements === 'function') updateFocusableElements();
    }
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

    var posterHtml = '<div class="no-poster catalog-poster-loading"></div>';

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

// Event Delegation для обоих видов каталога: карточки рядов лежат в #catalog-rows,
// карточки категории — в #catalog-grid, обработчик один и тот же.
function onCatalogViewClick(e) {
    // Карточка «Показать все» / папка категории
    var folder = e.target.closest('.catalog-folder-card');
    if (folder) {
        var fkey = folder.dataset.catalogKey;
        if (fkey === 'history') loadHistoryCatalog();
        else loadCatalog(fkey);
        return;
    }

    var card = e.target.closest('.torrent-card.catalog-card');
    if (!card) return;

    // Режим сетки (открыт конкретный каталог)
    if (catalogState.currentCatalog) {
        var idx = parseInt(card.dataset.catalogIndex, 10);
        if (!isNaN(idx) && catalogState.items[idx]) onCatalogItemClick(catalogState.items[idx], idx);
        return;
    }

    // Режим рядов (список каталогов)
    var rkey = card.dataset.catalogKey;
    var itemIdx = parseInt(card.dataset.itemIndex, 10);
    if (rkey && !isNaN(itemIdx) && window.catalogRowsData &&
        window.catalogRowsData[rkey] && window.catalogRowsData[rkey][itemIdx]) {
        onRowItemClick(window.catalogRowsData[rkey][itemIdx], rkey, itemIdx);
    }
}

document.addEventListener('DOMContentLoaded', function () {
    var grid = getCatalogGridEl();
    if (grid) grid.addEventListener('click', onCatalogViewClick);
    var rows = getCatalogRowsEl();
    if (rows) rows.addEventListener('click', onCatalogViewClick);
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
    var g = getCatalogGridEl();
    if (!g) return;
    showCatalogGridView();
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

    // ⚡ Выгружаем постеры, которые далеко за экраном (экономим RAM)
    catalogState.unloadObserver = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            var card = entry.target;
            var posterDiv = card.querySelector('.torrent-poster');
            if (!posterDiv) continue;
            var img = posterDiv.querySelector('img');

            if (entry.isIntersecting) {
                // Карточка вернулась в зону видимости — перезагружаем постер
                if (!img) {
                    var idx = parseInt(card.dataset.catalogIndex, 10);
                    if (!isNaN(idx) && catalogState.items[idx]) {
                        if (!loadPosterDirect(idx, card)) addToPosterQueue(idx);
                    }
                }
            } else {
                // Карточка далеко — выгружаем постер
                if (img) {
                    posterDiv.innerHTML = '<div class="no-poster catalog-poster-loading">⏳</div>';
                    card.dataset.posterRequested = '0';  // ⚡ Сбрасываем флаг
                }
            }
        }
    }, { rootMargin: '1200px 0px', threshold: 0 });  // ⚡ Уменьшили с 1500px до 1200px

    var cards = document.querySelectorAll('#catalog-grid .torrent-card.catalog-card');
    for (var i = 0; i < cards.length; i++) {
        catalogState.unloadObserver.observe(cards[i]);
    }
}

function loadInitialPosters() {
    var idxs = [];
    var limit = Math.min(
        CATALOG_CONSTANTS.POSTER_BATCH_SIZE,
        catalogState.items.length
    );

    for (var i = 0; i < limit; i++) {
        var it = catalogState.items[i];
        if (!it) continue;

        var card = catalogState.cardElements[i];
        if (!card) continue;

        if (card.querySelector('img.catalog-poster-img') || card.dataset.posterRequested === '1') continue;
        card.dataset.posterRequested = '1';

        // Быстрый путь — сразу, в очередь попадает только то, что требует запроса
        if (!loadPosterDirect(i, card)) idxs.push(i);
    }

    if (idxs.length > 0) {
        loadPosterBatch(idxs);
    }
}

/* ============ ПОСТЕРЫ ЖДУТ КОНЦА ПЕРЕХОДА НА ДРУГУЮ СТРОКУ ============
 *
 * При навигации вниз фокус переезжает на следующую строку тваном scrollTop
 * (focusEl -> scrollToElementIfNeeded -> Animations.scrollToIfNotVisible).
 * Ровно в это время IntersectionObserver сообщает о карточках новой строки, и
 * постеры вставляются и декодируются посреди анимации — переход дёргается.
 *
 * Поэтому пока тван идёт, индексы карточек складываются в posterDeferred, а
 * загрузка начинается сразу после его завершения: сначала переход, потом
 * картинки. Сигнал — gsap.isTweening(main-container): он ровно совпадает с
 * «переход идёт» и остаётся false, когда прокрутка мгновенная (нет gsap,
 * duration 0, колесо мыши) — там ждать нечего, поведение прежнее.
 *
 * Первый экран (loadInitialPosters) и допечатка страниц (updatePosterObservers)
 * идут своими путями и не задерживаются: прокрутки в этот момент нет.
 */

/** Идёт ли сейчас тван прокрутки сетки */
function isCatalogScrollAnimating() {
    if (typeof gsap === 'undefined' || typeof gsap.isTweening !== 'function') return false;
    var main = getEl('main-container');
    return !!main && gsap.isTweening(main);
}

/** Откладывает постер карточки до конца перехода */
function deferPosterUntilScrollEnds(idx) {
    if (catalogState.posterDeferred.indexOf(idx) === -1) catalogState.posterDeferred.push(idx);
    scheduleDeferredPosters();
}

function scheduleDeferredPosters() {
    if (catalogState.posterDeferredRaf) return;
    if (typeof requestAnimationFrame !== 'function') { flushDeferredPosters(); return; }
    catalogState.posterDeferredRaf = requestAnimationFrame(deferredPostersStep);
}

function deferredPostersStep() {
    catalogState.posterDeferredRaf = 0;
    // Пользователь нажал «вниз» ещё раз — ждём и этот тван
    if (isCatalogScrollAnimating()) { scheduleDeferredPosters(); return; }
    flushDeferredPosters();
}

/**
 * Отдаёт отложенное в обычный конвейер: быстрый путь вставляет картинку сразу,
 * остальное уходит в очередь. Порциями по POSTER_BATCH_SIZE за кадр — за долгую
 * прокрутку накапливается больше карточек, чем стоит вставлять в один кадр.
 */
function flushDeferredPosters() {
    var pending = catalogState.posterDeferred;
    if (!pending.length) return;

    pending.sort(function (a, b) { return a - b; });   // сверху вниз, как читают
    var chunk = pending.splice(0, CATALOG_CONSTANTS.POSTER_BATCH_SIZE);

    var slow = [];
    for (var i = 0; i < chunk.length; i++) {
        if (!catalogState.items[chunk[i]]) continue;
        if (!loadPosterDirect(chunk[i])) slow.push(chunk[i]);
    }
    for (var j = 0; j < slow.length; j++) addToPosterQueue(slow[j]);

    if (pending.length) scheduleDeferredPosters();
}

/** Сетка перерисована или каталог сменился — отложенные индексы больше не действительны */
function resetDeferredPosters() {
    if (catalogState.posterDeferredRaf && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(catalogState.posterDeferredRaf);
    }
    catalogState.posterDeferredRaf = 0;
    catalogState.posterDeferred.length = 0;
}

function initPosterLazyLoading() {
    if (catalogState.posterObserver) catalogState.posterObserver.disconnect();
    catalogState.posterObserver = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
            if (entries[i].isIntersecting) {
                var target = entries[i].target;
                if (target.dataset.posterRequested === '1') continue;
                target.dataset.posterRequested = '1';
                catalogState.posterObserver.unobserve(target);
                var idx = parseInt(target.dataset.catalogIndex, 10);
                var it = catalogState.items[idx];
                if (!it) continue;
                // Идёт переход на другую строку — постер ждёт его конца
                if (isCatalogScrollAnimating()) { deferPosterUntilScrollEnds(idx); continue; }
                // Есть poster_path — вставляем сразу; в очередь только медленный путь
                if (!loadPosterDirect(idx, target)) addToPosterQueue(idx);
            }
        }
    }, { rootMargin: CATALOG_CONSTANTS.POSTER_OBSERVER_MARGIN_PX + 'px', threshold: 0.1 });
    var cards = document.querySelectorAll('#catalog-grid .torrent-card.catalog-card');
    for (var i = 0; i < cards.length; i++) {
        var it = catalogState.items[i];
        if (!it) continue;
        if (!cards[i].querySelector('img.catalog-poster-img') && cards[i].dataset.posterRequested !== '1') {
            catalogState.posterObserver.observe(cards[i]);
        }
    }
}

function updatePosterObservers() {
    if (!catalogState.posterObserver) return;
    var cards = document.querySelectorAll('#catalog-grid .torrent-card.catalog-card');
    for (var i = 0; i < cards.length; i++) {
        var it = catalogState.items[i];
        if (!it) continue;
        if (!cards[i].querySelector('img.catalog-poster-img') && cards[i].dataset.posterRequested !== '1') {
            try { catalogState.posterObserver.observe(cards[i]); } catch (e) { }
        }
    }
}

/**
 * Быстрый путь: у элемента уже есть poster_path, значит адрес известен сразу —
 * собираем его через то же зеркало-прокси, что и все остальные постеры
 * (getTmdbImageUrl, никаких прямых обращений к image.tmdb.org), и вставляем
 * картинку на месте, синхронно.
 *
 * Очередь, батчи и requestIdleCallback здесь не нужны: ничего асинхронного мы
 * не ждём — декодированием занимается сам браузер (img.decoding='async'), а
 * число одновременных HTTP-загрузок он же и ограничивает. Очередь остаётся для
 * медленного пути: элементов без poster_path, которым нужен запрос к Worker/TMDB.
 *
 * @returns {boolean} true — постер обработан, в очередь ставить не нужно
 */
function loadPosterDirect(idx, card) {
    if (!catalogState.currentCatalog) return false;

    var item = catalogState.items[idx];
    if (!item || !item.poster_path) return false;

    if (!card) card = catalogState.cardElements[idx];
    if (!card) return false;

    var div = card.querySelector('.torrent-poster');
    if (!div) return false;

    var url = getTmdbImageUrl(item.poster_path, getPosterCardSize());
    if (!url) return false;

    catalogState.posterCache.set(item.id + '_' + (item.media_type || 'movie'), url);
    card.dataset.posterRequested = '1';   // как в addToPosterQueue: карточка обработана
    updatePosterDOM(div, card.dataset.rating, url);
    return true;
}

function addToPosterQueue(idx) {
    var card = catalogState.cardElements[idx];
    if (card) card.dataset.posterRequested = '1';
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
    if (!indices || indices.length === 0) return;

    catalogState.isPosterLoading = true;

    var active = 0;
    var ptr = 0;
    var maxActive = CATALOG_CONSTANTS.MAX_POSTER_DECODES || 3;

    // requestIdleCallback без timeout браузер вправе откладывать сколько угодно,
    // пока телевизор занят скроллом или декодированием — постеры «капали».
    // Здесь остался только медленный путь (запросы к Worker/TMDB), но ждать его
    // бесконечно всё равно нельзя, поэтому задаём предельную задержку.
    function scheduleIdle(cb, timeout) {
        if (window.requestIdleCallback) window.requestIdleCallback(cb, { timeout: timeout });
        else setTimeout(cb, 16);
    }

    function next() {
        if (ptr >= indices.length && active === 0) {
            catalogState.isPosterLoading = false;

            if (catalogState.posterLoadQueue.length > 0) {
                scheduleIdle(loadNextPosterBatch, 200);
            }

            return;
        }

        while (active < maxActive && ptr < indices.length) {
            active++;

            var index = indices[ptr];
            ptr++;

            loadPosterForIndex(index)
                .catch(function () {
                    // игнорируем ошибку отдельного постера
                })
                .then(function () {
                    active--;
                    scheduleIdle(next, 100);
                });
        }
    }

    next();
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

    var item = catalogState.items[index];

    // ⚡ БЫСТРЫЙ ПУТЬ: если у item есть poster_path — сразу рендерим.
    // Обычно сюда уже не попадаем (loadPosterDirect отработал синхронно ещё в
    // колбэке observer'а), но путь оставлен для вызовов мимо очереди.
    // Размер — getPosterCardSize(), тот же, что ждёт updatePosterDOM,
    // иначе URL пересобирался бы там второй раз.
    if (item && item.poster_path) {
        var quickUrl = getTmdbImageUrl(item.poster_path, getPosterCardSize());
        if (quickUrl) {
            updatePosterDOM(div, card.dataset.rating, quickUrl);
            catalogState.posterCache.set(key, quickUrl);
            return;
        }
    }

    // Проверяем LRU-кэш
    var cached = catalogState.posterCache.get(key);
    if (cached) {
        updatePosterDOM(div, card.dataset.rating, cached);
        return;
    }

    // Проверяем TMDB-кэш
    var p = { id: id, type: mt };
    var cachedTmdb = getFromTmdbCache('poster', p);
    if (cachedTmdb && cachedTmdb.posterUrl) {
        var url = normalizePosterUrl(cachedTmdb.posterUrl);
        updatePosterDOM(div, card.dataset.rating, url);
        catalogState.posterCache.set(key, url);
        return;
    }

    // МЕДЛЕННЫЙ ПУТЬ: запросы к Worker / API
    try {
        var url = null;

        if (id && id !== 'undefined' && id !== 'null' && window.CatalogWorker) {
            try {
                var posterResult = await CatalogWorker.fetchPosterUrl(
                    id,
                    mt,
                    title,
                    getProtocolBase(),
                    getPosterCardSize()
                );

                if (posterResult && posterResult.posterUrl) {
                    url = normalizePosterUrl(posterResult.posterUrl);
                    saveToTmdbCache('poster', p, { posterUrl: url });
                }
            } catch (e) {
                console.warn('fetchPosterUrl worker error:', e);
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
            updatePosterDOM(div, card.dataset.rating, url);
        } else {
            div.innerHTML = '<div class="no-poster">Нет постера</div>';
        }
    } catch (e) {
        console.warn('❌ Ошибка загрузки постера:', e.message);
        if (catalogState.currentCatalog) div.innerHTML = '<div class="no-poster">Нет постера</div>';
    }
}

function updatePosterDOM(div, rating, url) {
    if (!div || !url) {
        if (div) div.innerHTML = '<div class="no-poster">Нет постера</div>';
        return;
    }

    // URL уже собран нами под нужный размер (быстрый путь, posterCache,
    // normalizePosterUrl) — не пересобираем: это лишний разбор строки, а раньше
    // ещё и меняло зеркало, из-за чего в кэш попадал один адрес, а грузился другой.
    var size = getPosterCardSize();
    if (url.indexOf('/t/p/' + size + '/') === -1) {
        url = getTmdbImageUrl(url, size);
    }

    // ⚡ Мгновенная вставка — браузер декодирует асинхронно сам
    var img = new Image();
    img.className = 'catalog-poster-img';
    img.decoding = 'async';  // Браузер декодирует в фоне
    img.alt = '';
    img.src = url;

    // Убираем старый контент
    var oldImg = div.querySelector('img.catalog-poster-img');
    if (oldImg) oldImg.remove();

    var placeholder = div.querySelector('.no-poster');
    if (placeholder) placeholder.remove();

    // Вставляем сразу
    div.appendChild(img);

    // Анимация при загрузке (опционально)
    img.onload = function () {
        img.classList.add('loaded');
    };

    // Обработка ошибок: зеркало теперь выбирается детерминированно, поэтому
    // мёртвый хост ронял бы один и тот же набор постеров всегда — пробуем один
    // раз следующее зеркало и только потом сдаёмся.
    var mirrorRetried = false;
    img.onerror = function () {
        if (!mirrorRetried) {
            var alt = getTmdbNextMirrorUrl(img.src);
            if (alt && alt !== img.src) {
                mirrorRetried = true;
                img.src = alt;
                return;
            }
        }
        if (div.isConnected && !div.querySelector('.no-poster')) {
            div.innerHTML = '<div class="no-poster">Нет постера</div>';
        }
    };
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
    // Сохраняем и нулевую позицию: это валидное состояние, а не признак того,
    // что позиция ещё не была инициализирована.
    var savedScroll = mc ? mc.scrollTop : 0;
    AppState.backupScroll = savedScroll;
    if (AppState.currentScreen === 'catalog') {
        AppState.contentScroll = AppState.contentScroll || {};
        AppState.contentScroll.catalog = savedScroll;
    }
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
        posterSrc = getTmdbImageUrl(src.poster_path, CATALOG_CONSTANTS.IMG_SIZES.POSTER_MEDIUM);
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
        var bpUrl = getTmdbImageUrl(bp, CATALOG_CONSTANTS.IMG_SIZES.BACKDROP);
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
    video.volume = 0;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    video.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;opacity:0;pointer-events:none;transition:opacity 10s ease;';

    var backdrop = getEl('catalog-detail-backdrop');
    var cde = getEl('catalog-detail-extra');
    var sub = getEl('detail-subtitle');          // ★ подзаголовок
    var bb = getEl('back-from-detail');          // ★ кнопка «Назад»
    if (AppState) {
        AppState.trailerPlay = true;
    }

    if (backdrop && backdrop.parentNode === dv) {
        dv.insertBefore(video, backdrop);
    } else {
        dv.insertBefore(video, dv.firstChild);
    }

    // Скрываем backdrop, пока играет трейлер
    if (backdrop) backdrop.classList.add('hidden');
    dv.classList.add('hide-before');

    // ★ Плавное угасание cde / subtitle / back-btn за 10 секунд
    var fadeOutEls = [cde, sub, bb];
    for (var i = 0; i < fadeOutEls.length; i++) {
        (function (el) {
            if (!el) return;
            el.style.transition = 'opacity 10s ease';
            requestAnimationFrame(function () {
                requestAnimationFrame(function () {
                    el.style.opacity = '0';
                });
            });
        })(fadeOutEls[i]);
    }

    rutubeTrailerState.bgVideo = video;

    // ★ Плавное нарастание громкости: 0 → 100 за 10 секунд
    var volumeStarted = false;
    function startVolumeFade() {
        if (volumeStarted) return;
        volumeStarted = true;
        video.muted = false;
        video.volume = 0;
        var vol = 0;
        video._volumeTimer = setInterval(function () {
            vol = Math.min(1, vol + 0.1);
            try { video.volume = vol; } catch (e) { }
            if (vol >= 1 && video._volumeTimer) {
                clearInterval(video._volumeTimer);
                video._volumeTimer = null;
            }
        }, 1000);
    }

    // Запуск HLS или прямого URL
    if (window.Hls && Hls.isSupported()) {
        var hls = new Hls({
            maxBufferSize: 30 * 1024 * 1024,
            maxBufferLength: 10,
            startLevel: 2,
            enableWorker: true
        });
        hls.loadSource(wrapRutubeHls(url));
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, function () {
            video.play().catch(function () { });
        });
        video._hls = hls;
    } else {
        video.src = wrapRutubeHls(url);
        video.play().catch(function () { });
    }

    // Плавное проявление видео
    requestAnimationFrame(function () {
        video.style.opacity = '1';
    });

    // ★ Нарастание звука — когда видео реально заиграло
    video.addEventListener('playing', startVolumeFade);
    video.addEventListener('timeupdate', startVolumeFade);
}

/**
 * Останавливает и удаляет фоновое видео, возвращает backdrop
 */
function stopTrailerBackground() {
    var video = rutubeTrailerState.bgVideo || getEl('trailer-bg-video');
    if (AppState) {
        AppState.trailerPlay = false;
    }
    if (video) {
        if (video._volumeTimer) {
            clearInterval(video._volumeTimer);
            video._volumeTimer = null;
        }
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

    var backdrop = getEl('catalog-detail-backdrop');
    var cde = getEl('catalog-detail-extra');
    var sub = getEl('detail-subtitle');          // ★ подзаголовок
    var bb = getEl('back-from-detail');          // ★ кнопка «Назад»

    // ★ Плавное возвращение cde / subtitle / back-btn за 3 секунды
    var fadeInEls = [cde, sub, bb];
    for (var i = 0; i < fadeInEls.length; i++) {
        (function (el) {
            if (!el) return;
            el.style.transition = 'opacity 1.5s ease';
            requestAnimationFrame(function () {
                requestAnimationFrame(function () {
                    el.style.opacity = '1';
                });
            });
        })(fadeInEls[i]);
    }

    if (backdrop) backdrop.classList.remove('hidden');
    var dv = getEl('detail-view');
    if (dv) dv.classList.remove('hide-before');
}
window.stopTrailerBackground = stopTrailerBackground;

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
/**
Рендер списка актёров
@param {object} item - элемент каталога
@param {HTMLElement} aw - обёртка для актёров
@param {Array} [preloadedActors] - если переданы, используем их без запроса
*/
async function renderDetailActors(item, aw, preloadedActors) {
    if (!aw) return;
    var ae = getEl('catalog-detail-actors');
    var actors;

    if (preloadedActors) {
        // Данные уже загружены параллельно — рендерим сразу
        actors = preloadedActors;
    } else {
        // Фоллбэк: грузим как раньше
        ae.innerHTML = '<div class="catalog-loading"><div class="loading-spinner-small"></div><span>Загрузка актеров...</span></div>';
        aw.classList.remove('hidden');
        actors = await fetchCatalogActors(item);
    }

    if (actors.length > 0) {
        var frag = document.createDocumentFragment();
        actors.forEach(function (a) {
            var d = document.createElement('div');
            d.className = 'catalog-actor-card';
            d.innerHTML = '<div class="catalog-actor-photo">' +
                (a.profilePath ? '<img src="' + getTmdbImageUrl(a.profilePath, CATALOG_CONSTANTS.IMG_SIZES.POSTER_SMALL) + '" loading="lazy" decoding="async" alt="' + escapeHtml(a.name) + '" onerror="this.parentElement.innerHTML=\'<div class=\\\'catalog-actor-no-photo\\\'>Нет фото</div>\'">' : '<div class="catalog-actor-no-photo">Нет фото</div>') +
                '</div><div class="catalog-actor-info"><div class="catalog-actor-name">' + escapeHtml(a.name) + '</div><div class="catalog-actor-character">' + escapeHtml(a.character || '') + '</div></div>';
            frag.appendChild(d);
        });
        ae.innerHTML = '';
        ae.appendChild(frag);
        aw.classList.remove('hidden');
    } else {
        ae.innerHTML = '<div class="catalog-empty">Актеры не найдены</div>';
        aw.classList.remove('hidden');
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
            var pu = r.poster_path ? getTmdbImageUrl(r.poster_path, CATALOG_CONSTANTS.IMG_SIZES.POSTER_SMALL) : null;
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
    if (typeof window.visibleItemsforDetail === 'function') window.visibleItemsforDetail('showCatalogDetail');
    var wb = getEl('catalog-watch-btn');
    if (aw) aw.classList.add('hidden');
    if (rw) rw.classList.add('hidden');
    if (wb) {
        var knownPoster = getCatalogKnownPosterUrl(item, posterUrl);

        wb.onclick = function () {
            dv.style.display = 'none';
            dv.style.pointerEvents = 'none';
            if (mc) mc.style.pointerEvents = 'auto';
            AppState.currentScreen = 'search';
            AppState.isSearch = false;
            showCatalogSearch(wb.dataset.searchTitle || title, knownPoster, item);
        };
    }
    var restore = function () {
        if (mc && savedScroll > 0) setTimeout(function () { mc.scrollTop = savedScroll; }, 50);
    };

    // ==================== ПАРАЛЛЕЛЬНАЯ ЗАГРУЗКА ====================
    // Запускаем все независимые запросы одновременно
    var detailsPromise = fetchCatalogItemDetails(item);
    var actorsPromise = fetchCatalogActors(item);

    // Ждём детали для рендера шапки (обычно самый быстрый запрос)
    var details = await detailsPromise;
    restore();
    renderDetailHeader(item, posterUrl, details);

    // Ждём актёров (уже загружаются параллельно с деталями)
    var actors = await actorsPromise;
    renderDetailActors(item, aw, actors);

    // Рекомендации — рендерим сразу из details
    var src = details || item || {};
    renderDetailRecommendations(src, rw, mt);

    // ==================== RUTUBE ТРЕЙЛЕР (параллельно) ====================
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
    // ==================== КОНЕЦ БЛОКА ====================

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
        // Шапка, актёры и похожие отрисованы, фокус на месте — снимаем «Загрузка…»
        if (typeof Animations !== 'undefined' && typeof Animations.detailContentReady === 'function') {
            Animations.detailContentReady();
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
    var card = document.querySelector('#catalog-grid .torrent-card.catalog-card[data-catalog-index="' + index + '"]');
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
            pu = getCatalogKnownPosterUrl(item, pu);

            window.pendingCatalogPoster = pu;
            window.pendingCatalogItem = item;

            AppState.pendingDetailItem = item;
            AppState.pendingDetailPoster = pu;
            AppState.pendingDetailTmdbId = item && (item.id || item.tmdbId) || null;
            AppState.pendingDetailMediaType = item && item.media_type || null;

            if (item && item.media_type) {
                AppState.mediaType = item.media_type;
            }
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

/**
 * Главный экран каталога — ряды-карусели в #catalog-rows.
 *
 * Ряды собираются один раз и остаются в DOM, пока открыта категория, поэтому
 * обычный возврат идёт по быстрому пути: ни сети, ни пересборки DOM, ни повторной
 * загрузки постеров. Полная пересборка — только при первом входе или force === true
 * (window.refreshCatalogRows).
 */
async function showCatalogList(force) {
    var rows = getCatalogRowsEl();
    if (!rows) return;
    abortCatalogRequests();

    catalogState.currentCatalog = null;
    catalogState.items = [];
    catalogState.cardElements = {};
    catalogState.loading = false;
    catalogState.loadedPostersCount = 0;
    catalogState.posterLoadQueue = [];
    catalogState.lastSelectedIndex = 0;
    catalogState.lastSelectedId = null;
    // lastSelectedRowKey / lastSelectedColIndex не сбрасываем: на них держится
    // restoreRowFocus(). Обнуляет их только обработчик вкладки «Каталог» (app.js),
    // чтобы обычное открытие вкладки начиналось с первой карточки.

    var catalogTab = getEl('tab-catalog');
    if (catalogTab) catalogTab.classList.add('active');
    var torrentsTab = getEl('tab-torrents');
    if (torrentsTab) torrentsTab.classList.remove('active');
    var searchTab = getEl('tab-search');
    if (searchTab) searchTab.classList.remove('active');

    // Быстрый путь: ряды уже в DOM — только показываем их обратно
    if (!force && rows.querySelector('.catalog-row') &&
        window.catalogRows && window.catalogRows.length) {
        showCatalogRowsView();
        // abortCatalogRequests() выше отключил наблюдателя, поднимаем заново:
        // недогруженные постеры должны продолжить появляться при скролле
        resetStrandedRowPosters();
        initRowPosterLazyLoading();
        requestAnimationFrame(function () {
            if (AppState.currentScreen !== 'catalog' || catalogState.currentCatalog) return;
            if (typeof updateFocusableElements === 'function') updateFocusableElements();
            setTimeout(function () {
                if (AppState.currentScreen !== 'catalog' || catalogState.currentCatalog) return;
                restoreRowFocus();
            }, CATALOG_CONSTANTS.FOCUS_DELAY_MS);
        });
        return true;
    }

    window.catalogRows = [];
    window.catalogRowsData = {};

    showCatalogRowsView();
    rows.innerHTML = '<div class="catalog-rows-loading"><div class="loading-spinner" style="margin:0 auto 20px"></div><div style="font-size:16px;color:#aaa">Загрузка каталогов...</div></div>';
    if (typeof invalidateFocusCache === 'function') invalidateFocusCache();

    // Категории из CATALOG_CONFIG (в порядке объявления)
    var keys = [];
    for (var k in CATALOG_CONFIG) {
        if (CATALOG_CONFIG.hasOwnProperty(k)) keys.push(k);
    }

    // Прогрессивная загрузка рядов: каждый готовый ряд сразу уходит в DOM
    return loadCatalogRowsProgressively(rows, keys);
}

// ==================== РЯДЫ-КАРУСЕЛИ (список каталогов) ====================

/**
 * Загружает до 19 элементов для ряда категории
 */
function loadCatalogRowsProgressively(container, keys) {
    var MAX_PARALLEL_ROW_LOADS = 3;
    var results = new Array(keys.length);
    var nextToLoad = 0;
    var nextToRender = 0;
    var activeLoads = 0;
    var completedLoads = 0;
    var renderedRows = 0;
    var rowsActivated = false;
    var finished = false;

    function isCurrentCatalogList() {
        return AppState.currentScreen === 'catalog' && !catalogState.currentCatalog;
    }

    function finish(value, resolve) {
        if (finished) return;
        finished = true;
        resolve(value);
    }

    function observeRowPosters(row) {
        if (!catalogState.rowPosterObserver) {
            initRowPosterLazyLoading();
            return;
        }
        var cards = row.querySelectorAll('.catalog-row-card');
        for (var i = 0; i < cards.length; i++) {
            if (cards[i].dataset.itemIndex !== undefined && cards[i].dataset.posterLoaded !== '1') {
                catalogState.rowPosterObserver.observe(cards[i]);
            }
        }
    }

    function activateRows() {
        if (rowsActivated) return;
        rowsActivated = true;
        requestAnimationFrame(function () {
            if (!isCurrentCatalogList()) return;
            if (typeof updateFocusableElements === 'function') updateFocusableElements();
            setTimeout(function () {
                if (!isCurrentCatalogList()) return;
                // Контейнер уже показан самим showCatalogList; display здесь —
                // страховка от чужого display:none, чтобы фокус нашёл карточки.
                container.style.display = '';
                restoreRowFocus();
            }, CATALOG_CONSTANTS.FOCUS_DELAY_MS);
        });
    }

    return new Promise(function (resolve) {
        function renderReadyRows() {
            if (!isCurrentCatalogList()) {
                finish(false, resolve);
                return;
            }
            var appended = 0;
            while (nextToRender < keys.length && results[nextToRender] !== undefined) {
                var result = results[nextToRender++];
                if (!result.items || result.items.length === 0) continue;
                var row = createCatalogRow(result.key, result.items);
                if (!row) continue;
                if (renderedRows === 0) {
                    container.innerHTML = '';
                    // Ряды пересобираются с нуля: наблюдатель оконной видимости
                    // держит ссылки на уже отсоединённые ряды — отпускаем его,
                    // observeRowVisibility создаст новый по первому же ряду.
                    resetRowVisibilityWindow();
                }
                container.appendChild(row);
                renderedRows++;
                appended++;
                observeRowPosters(row);
                observeRowVisibility(row);
                activateRows();
            }
            // Появились новые карточки — кэш фокуса в control.js держится на
            // счётчике поколений DOM, поэтому обязаны сказать об этом явно.
            if (appended && typeof invalidateFocusCache === 'function') invalidateFocusCache();
        }

        function scheduleLoads() {
            if (finished) return;
            if (!isCurrentCatalogList()) {
                finish(false, resolve);
                return;
            }
            if (completedLoads === keys.length) {
                if (renderedRows === 0) {
                    container.innerHTML = '<div class="catalog-rows-loading"><div style="font-size:48px;margin-bottom:20px">🎬</div><div style="font-size:18px;color:#aaa">Каталоги пусты</div></div>';
                    // Прежние ряды (если пересобирались по force) только что
                    // отсоединены — наблюдателю их держать незачем
                    resetRowVisibilityWindow();
                    if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
                }
                // Все ряды в DOM. Страховка на случай, если контейнер остался
                // погашенным (пустые каталоги, обрыв загрузки) — проявляем.
                revealCatalogGrid('', container);
                finish(true, resolve);
                return;
            }
            while (activeLoads < MAX_PARALLEL_ROW_LOADS && nextToLoad < keys.length) {
                (function (index, key) {
                    activeLoads++;
                    loadRowItems(key)
                        .then(function (items) { results[index] = { key: key, items: items || [] }; })
                        .catch(function () { results[index] = { key: key, items: [] }; })
                        .then(function () {
                            activeLoads--;
                            completedLoads++;
                            renderReadyRows();
                            scheduleLoads();
                        });
                })(nextToLoad, keys[nextToLoad]);
                nextToLoad++;
            }
        }

        scheduleLoads();
    });
}

async function loadRowItems(key) {
    var LIMIT = 10;
    if (key === 'history') {
        var data = await safeFetch(SERVER_URL + '/api/history', { timeout: 10000 });
        if (data && data.success && data.history && data.history.length) {
            return data.history.slice(0, LIMIT).map(function (item) {
                var pp = item.posterPath;
                if (pp && pp.indexOf('http') !== 0) pp = (pp.indexOf('/') === 0 ? pp : '/' + pp);
                return {
                    id: item.tmdbId, title: item.title, name: item.title,
                    media_type: item.mediaType, poster_path: pp,
                    vote_average: null, isHistoryItem: true
                };
            });
        }
        return [];
    }
    var cfg = CATALOG_CONFIG[key];
    if (!cfg || !cfg.url) return [];
    var d = await safeFetch(cfg.url + '/items?from=0&limit=' + LIMIT, { timeout: 10000 });
    if (d && d.success && d.items) return d.items.slice(0, LIMIT);
    return [];
}

/**
 * Создаёт DOM-структуру одного ряда
 */
function createCatalogRow(key, items) {
    var cfg = CATALOG_CONFIG[key];
    if (!cfg) return null;

    var row = document.createElement('section');
    row.className = 'catalog-row';
    row.dataset.catalogKey = key;

    // Заголовок ряда
    var header = document.createElement('div');
    header.className = 'catalog-row-header';
    header.innerHTML =
        '<h2 class="catalog-row-title">' + escapeHtml(cfg.name) + '</h2>' +
        '<div class="catalog-row-showall-hint">Показать все →</div>';
    header.addEventListener('click', function () {
        if (key === 'history') loadHistoryCatalog();
        else loadCatalog(key);
    });
    row.appendChild(header);

    // Карусель.
    // Вьюпорт — только окно-обрезка (overflow: hidden), а двигается внутренний
    // трек через transform: translate3d — так кадр обходится композитору без
    // layout + paint, в отличие от твана scrollLeft. Позицию читают/пишут
    // getScrollX / setScrollX (control.js), они ищут трек по первому дочернему
    // элементу вьюпорта с классом catalog-row-track.
    var carousel = document.createElement('div');
    carousel.className = 'catalog-row-carousel';
    var viewport = document.createElement('div');
    viewport.className = 'catalog-row-viewport';
    var track = document.createElement('div');
    track.className = 'catalog-row-track';

    var rowCards = [];
    window.catalogRowsData[key] = items;

    // Карточки фильмов (до 19)
    for (var i = 0; i < items.length; i++) {
        var card = createRowCard(items[i], key, i);
        track.appendChild(card);
        rowCards.push(card);
    }

    // 20-я карточка — «Показать все»
    var showAll = createShowAllCard(key);
    track.appendChild(showAll);
    rowCards.push(showAll);

    viewport.appendChild(track);
    carousel.appendChild(viewport);
    row.appendChild(carousel);

    window.catalogRows.push(rowCards);
    return row;
}

/**
 * Карточка фильма в ряду
 */
function createRowCard(item, key, index) {
    var title = getCatalogItemTitle(item);
    var mt = item.media_type || 'movie';
    var id = item.id;
    var rating = item.vote_average ? Math.round(item.vote_average * 10) / 10 : null;
    var year = getCatalogItemYear(item);
    var ratingColor = rating ? getRatingColor(rating) : '';

    var ratingHtml = rating ?
        '<div class="rating-badge" style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.55);color:' + ratingColor +
        ';font-weight:bold;font-size:13px;padding:3px 7px;border-radius:10px;z-index:10;border:1px solid ' + ratingColor + '">' + rating + '</div>' : '';

    var card = document.createElement('div');
    card.className = 'torrent-card catalog-card catalog-row-card';
    card.dataset.catalogKey = key;
    card.dataset.itemIndex = index;
    card.dataset.itemId = id;
    card.dataset.mediaType = mt;
    card.dataset.title = title;

    card.innerHTML =
        '<div class="torrent-poster">' +
        '<div class="row-poster-img"><div class="no-poster catalog-poster-loading"></div></div>' +
        ratingHtml +
        '</div>' +
        '<div class="torrent-info">' +
        '<div class="torrent-title">' + escapeHtml(title.length > 40 ? title.substring(0, 40) + '...' : title) + '</div>' +
        '<div class="torrent-meta"><span>' + (mt === 'tv' ? 'Сериал' : 'Фильм') + '</span>' +
        (year ? '<span>' + year + '</span>' : '') + '</div>' +
        '</div>';

    //loadRowPoster(card, item);
    return card;
}

/**
 * Карточка «Показать все» (20-я)
 */
function createShowAllCard(key) {
    var card = document.createElement('div');
    card.className = 'torrent-card catalog-folder-card catalog-row-card catalog-show-all';
    card.dataset.catalogKey = key;
    card.innerHTML =
        '<div class="show-all-inner">' +
        '<div class="show-all-icon">→</div>' +
        '<div class="show-all-text">Показать<br>все</div>' +
        '</div>';
    return card;
}

/**
 * Загрузка постера для карточки ряда
 */
async function loadRowPoster(card, item) {
    var imgBox = card.querySelector('.row-poster-img');
    if (!imgBox) return;
    var id = item.id;
    var mt = item.media_type || 'movie';
    var cacheKey = id + '_' + mt;

    var cached = catalogState.posterCache.get(cacheKey);
    if (cached) { await setRowPosterImg(imgBox, cached); return; }

    if (item.poster_path) {
        // Размер — getPosterCardSize(), как в сетке: тогда URL совпадает
        // с тем, что уже лежит в posterCache, и setRowPosterImg не пересобирает его.
        var url = getTmdbImageUrl(item.poster_path, getPosterCardSize());
        catalogState.posterCache.set(cacheKey, url);
        await setRowPosterImg(imgBox, url);
        return;
    }

    if (id && id !== 'undefined' && id !== 'null' && window.CatalogWorker) {
        try {
            var posterResult = await CatalogWorker.fetchPosterUrl(
                id,
                mt,
                getCatalogItemTitle(item),
                getProtocolBase(),
                getPosterCardSize()
            );

            if (posterResult && posterResult.posterUrl) {
                var url2 = normalizePosterUrl(posterResult.posterUrl);

                catalogState.posterCache.set(cacheKey, url2);

                if (card.isConnected) await setRowPosterImg(imgBox, url2);

                return;
            }
        } catch (e) { }
    }

    if (card.isConnected) imgBox.innerHTML = '<div class="no-poster">Нет постера</div>';
}

/**
 * Постер карточки, на которую только что встал фокус, — вне очереди и вне
 * пейсинга. Пока кнопка пульта зажата, processRowPosterQueue стоит (см.
 * isNavBusy), и без этой врезки пользователь ехал бы по пустым рамкам. Один
 * постер на нажатие потянет любой телевизор, а очередь доберёт остальные,
 * когда навигация утихнет.
 *
 * Зовётся из revealCatalogElement, то есть из focusEl (control.js) — ровно там,
 * где с карточки уже снимается оконное погашение.
 */
function ensureRowPosterNow(card) {
    if (!card || !card.classList || !card.classList.contains('catalog-row-card')) return;
    if (card.dataset.posterStarted === '1') return;      // загрузка уже идёт

    var box = card.querySelector('.row-poster-img');
    if (!box || box.querySelector('img')) return;        // постер уже на месте

    var key = card.dataset.catalogKey;
    var idx = parseInt(card.dataset.itemIndex, 10);
    if (isNaN(idx)) return;                              // «Показать все» — без постера
    var items = window.catalogRowsData && window.catalogRowsData[key];
    if (!items || !items[idx]) return;

    // Карточка могла уже стоять в очереди — вынимаем, иначе загрузим дважды
    var q = catalogState.rowPosterQueue;
    if (q) {
        for (var i = 0; i < q.length; i++) {
            if (q[i].card === card) { q.splice(i, 1); break; }
        }
    }
    if (card.dataset.posterLoaded !== '1') {
        card.dataset.posterLoaded = '1';
        if (catalogState.rowPosterObserver) catalogState.rowPosterObserver.unobserve(card);
    }
    card.dataset.posterStarted = '1';
    loadRowPoster(card, items[idx]).catch(function () { });
}

// ==================== ЛЕНИВАЯ ЗАГРУЗКА ПОСТЕРОВ РЯДОВ ====================
/**
 * Снимает posterLoaded с карточек, которым постер так и не достался.
 *
 * Флаг ставится в момент попадания карточки в зону видимости, ещё до самой
 * загрузки. Если очередь после этого обнулили (вход в категорию → abortCatalogRequests,
 * повторный initRowPosterLazyLoading), такая карточка остаётся с флагом, но без
 * картинки — и наблюдатель её больше не возьмёт. Тот же приём, что в
 * rearmCatalogObservers (catalog-memory-fix.js).
 */
function resetStrandedRowPosters() {
    var cards = document.querySelectorAll('#catalog-rows .catalog-row-card');
    for (var i = 0; i < cards.length; i++) {
        if (cards[i].dataset.posterLoaded !== '1') continue;
        var box = cards[i].querySelector('.row-poster-img');
        if (box && !box.querySelector('img')) {
            cards[i].dataset.posterLoaded = '0';
            cards[i].dataset.posterStarted = '0';   // иначе ensureRowPosterNow её пропустит
        }
    }
}

/**
 * Наблюдает за карточками рядов и ставит в очередь постеры тех,
 * что попали в зону видимости.
 *
 * В очередь идут все без исключения: раньше карточки с готовым poster_path
 * вставлялись здесь же, минуя очередь, и при входе ряда в кадр браузер получал
 * весь залп декодов сразу — на телевизоре это и есть фризы навигации. Теперь
 * единственный путь — processRowPosterQueue, который знает и про предел
 * параллельности, и про то, что во время прокрутки надо помолчать.
 */
function initRowPosterLazyLoading() {
    if (catalogState.rowPosterObserver) catalogState.rowPosterObserver.disconnect();
    catalogState.rowPosterQueue = [];
    catalogState.activeRowPosterLoads = 0;

    catalogState.rowPosterObserver = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
            if (!entries[i].isIntersecting) continue;
            var card = entries[i].target;
            if (card.dataset.posterLoaded === '1') continue;

            var key = card.dataset.catalogKey;
            var idx = parseInt(card.dataset.itemIndex, 10);
            if (isNaN(idx)) continue;                       // «Показать все» — без постера
            var items = window.catalogRowsData && window.catalogRowsData[key];
            if (!items || !items[idx]) continue;

            card.dataset.posterLoaded = '1';                // защита от повторной постановки
            catalogState.rowPosterObserver.unobserve(card);
            catalogState.rowPosterQueue.push({ card: card, item: items[idx] });
        }
        processRowPosterQueue();
    }, {
        rootMargin: CATALOG_CONSTANTS.POSTER_OBSERVER_MARGIN_PX + 'px ' +
            CATALOG_CONSTANTS.ROW_POSTER_MARGIN_X_PX + 'px',
        threshold: 0.1
    });

    var cards = document.querySelectorAll('#catalog-rows .catalog-row-card');
    for (var i = 0; i < cards.length; i++) {
        if (cards[i].dataset.itemIndex !== undefined && cards[i].dataset.posterLoaded !== '1') {
            catalogState.rowPosterObserver.observe(cards[i]);
        }
    }
}

// ==================== ОКОННАЯ ВИДИМОСТЬ (как в Lampa) ====================

/**
 * Строки/карточки, которые дальше VISIBILITY_WINDOW_ROWS строк от вьюпорта,
 * получают класс catalog-offscreen (visibility: hidden) и перестают
 * отрисовываться. По мере приближения класс снимается, с уходящей стороны —
 * ставится, поэтому «живыми» всегда остаются только видимые строки плюс запас.
 *
 * Почему visibility, а не display: none — бокс остаётся на месте, значит
 * scrollHeight контейнера и позиция скролла не меняются, и IntersectionObserver
 * продолжает видеть элемент (у display:none прямоугольник нулевой, класс уже
 * никогда бы не снялся). Фокус по скрытым элементам ходить может: offsetParent
 * у них не null, то есть VISIBLE() в control.js их по-прежнему считает.
 *
 * Отличие от content-visibility: auto на .torrent-card.catalog-card
 * (styles.css:3305): тот работает только с Chromium 85+ (на Vidaa OS его нет),
 * решает сам, что считать «около вьюпорта», и гасит карточку, но не ряд целиком
 * с заголовком и композиторным слоем карусели.
 *
 * Ошибка в безопасную сторону: элементы создаются видимыми, скрывает их только
 * колбэк наблюдателя. Если IntersectionObserver не сработает, мы потеряем
 * оптимизацию, но не покажем пустой экран.
 */
var OFFSCREEN_CLASS = 'catalog-offscreen';

/**
 * Запас в пикселях = высота образцового элемента × VISIBILITY_WINDOW_ROWS.
 * Считается один раз на создание наблюдателя (rootMargin потом не поменять),
 * поэтому меряем уже лежащий в DOM элемент.
 */
function measureVisibilityMargin(sample) {
    var h = sample ? sample.offsetHeight : 0;
    if (!h) return CATALOG_CONSTANTS.VISIBILITY_FALLBACK_MARGIN_PX;
    return Math.round(h * CATALOG_CONSTANTS.VISIBILITY_WINDOW_ROWS);
}

/**
 * Под неотрисованной карточкой (content-visibility: auto) браузер резервирует
 * ровно то, что объявлено в contain-intrinsic-size. Если это число не совпадает
 * с реальной высотой ряда, каждый входящий в кадр ряд меняет размер и толкает
 * всё, что ниже: при 1920 и настройках по умолчанию резерв был 375px против
 * реальных 402px — сдвиг на 27px на каждом шаге прокрутки.
 *
 * Реальную высоту знает только отрисованная сетка: она зависит от ширины окна,
 * числа колонок, шрифта и плотности (всё это задаёт ui-customizer.js). Поэтому
 * замеряем её здесь и отдаём в CSS-переменную --catalog-card-h, которую читают
 * оба правила contain-intrinsic-size (styles.css и ui-customizer.js).
 *
 * Попутно выправляется и rootMargin оконной видимости: measureVisibilityMargin
 * зовут сразу после вставки карточек, когда те ещё пропущены рендером и отдают
 * как раз объявленный резерв.
 */
function measureCatalogCardHeight() {
    var grid = getCatalogGridEl();
    if (!grid) return;

    // Число колонок задаёт ui-customizer, поэтому берём его из вычисленных стилей
    var cols = 5;
    var tpl = window.getComputedStyle(grid).gridTemplateColumns;
    if (tpl && tpl !== 'none') cols = tpl.split(/\s+/).length;

    // Ряд растягивает карточки по самой высокой, значит максимум по первому ряду
    // и есть высота ряда (заголовок сетки занимает свой ряд: grid-column 1/-1).
    // Пропущенные рендером карточки пропускаем — они отдают старое значение
    // intrinsic-size, и замер закольцевался бы сам на себя.
    // clientHeight, а не offsetHeight: contain-intrinsic-size задаёт content box,
    // то есть без бордеров карточки (иначе резерв был бы на 2px больше реального).
    var cards = grid.querySelectorAll('.torrent-card.catalog-card');
    var h = 0;
    for (var i = 0; i < cards.length && i < cols; i++) {
        var poster = cards[i].querySelector('.torrent-poster');
        if (!poster || !poster.offsetHeight) continue;
        if (cards[i].clientHeight > h) h = cards[i].clientHeight;
    }
    if (h > 0) document.documentElement.style.setProperty('--catalog-card-h', h + 'px');
}

function createVisibilityObserver(marginPx) {
    return new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
            var el = entries[i].target;
            // Элемент не отрисован: ушли в режим сетки (#catalog-rows скрыт),
            // сменили экран, контейнер погашен. Прямоугольник нулевой, поэтому
            // наблюдатель честно рапортует «не пересекается» — но гасить по
            // такому сообщению нельзя, иначе при возврате увидим пустой экран
            // до следующего пересчёта. Классы не трогаем.
            if (!entries[i].boundingClientRect.height) continue;
            if (entries[i].isIntersecting) el.classList.remove(OFFSCREEN_CLASS);
            else el.classList.add(OFFSCREEN_CLASS);
        }
    }, {
        root: getEl('main-container'),
        rootMargin: marginPx + 'px 0px',   // запас только по вертикали
        threshold: 0
    });
}

/**
 * Снимает погашение с элемента (и с его ряда) немедленно.
 * Нужно потому, что колбэк наблюдателя приходит через кадр-два после сдвига
 * скролла, а сфокусированный элемент обязан быть видимым сразу. Рассинхрон
 * с наблюдателем самоисправляется: он всё равно пришлёт своё состояние,
 * когда элемент пересечёт границу окна.
 */
function revealCatalogElement(el) {
    if (!el || !el.classList) return;
    el.classList.remove(OFFSCREEN_CLASS);
    var row = el.closest ? el.closest('.catalog-row') : null;
    if (row) row.classList.remove(OFFSCREEN_CLASS);
}

/** Ряды-карусели: гасим ряд целиком вместе с заголовком */
function initRowVisibilityWindow() {
    if (catalogState.rowVisibilityObserver) catalogState.rowVisibilityObserver.disconnect();

    var rows = document.querySelectorAll('#catalog-rows .catalog-row');
    if (!rows.length) { catalogState.rowVisibilityObserver = null; return; }

    catalogState.rowVisibilityObserver = createVisibilityObserver(measureVisibilityMargin(rows[0]));
    for (var i = 0; i < rows.length; i++) {
        rows[i].classList.remove(OFFSCREEN_CLASS);
        catalogState.rowVisibilityObserver.observe(rows[i]);
    }
}

/** Ряды добавляются по одному, поэтому наблюдателю их отдаём тоже по одному */
function observeRowVisibility(row) {
    if (!catalogState.rowVisibilityObserver) { initRowVisibilityWindow(); return; }
    catalogState.rowVisibilityObserver.observe(row);
}

/**
 * Ряды отсоединены от DOM (пересборка каталога, заглушка «Каталоги пусты»):
 * наблюдатель держал бы их ссылками. Новый создаст observeRowVisibility.
 */
function resetRowVisibilityWindow() {
    if (!catalogState.rowVisibilityObserver) return;
    catalogState.rowVisibilityObserver.disconnect();
    catalogState.rowVisibilityObserver = null;
}

/** Сетка категории: гасим отдельные карточки, строк как элементов там нет */
function initGridVisibilityWindow() {
    if (catalogState.gridVisibilityObserver) catalogState.gridVisibilityObserver.disconnect();

    var cards = document.querySelectorAll('#catalog-grid .torrent-card.catalog-card');
    if (!cards.length) { catalogState.gridVisibilityObserver = null; return; }

    catalogState.gridVisibilityObserver = createVisibilityObserver(measureVisibilityMargin(cards[0]));
    for (var i = 0; i < cards.length; i++) {
        cards[i].classList.remove(OFFSCREEN_CLASS);
        catalogState.gridVisibilityObserver.observe(cards[i]);
    }
}

/** Догрузка страницы: новые карточки надо взять под наблюдение */
function updateGridVisibilityWindow() {
    if (!catalogState.gridVisibilityObserver) { initGridVisibilityWindow(); return; }
    var cards = document.querySelectorAll('#catalog-grid .torrent-card.catalog-card');
    for (var i = 0; i < cards.length; i++) {
        try { catalogState.gridVisibilityObserver.observe(cards[i]); } catch (e) { }
    }
}

/**
 * Сетка категории очищена (showCatalogRowsView): наблюдатель держал бы сотни
 * отсоединённых карточек. Новый создаст renderCatalogGrid при следующем входе.
 */
function resetGridVisibilityWindow() {
    if (!catalogState.gridVisibilityObserver) return;
    catalogState.gridVisibilityObserver.disconnect();
    catalogState.gridVisibilityObserver = null;
}

/**
 * Возврат к рядам. Пока #catalog-rows был display:none, наблюдатель геометрию
 * не видел (см. проверку height в колбэке), поэтому классы остались от той
 * позиции скролла, с которой уходили в категорию, — а showCatalogRowsView
 * сбрасывает scrollTop в 0. Показываем всё сразу, иначе первый кадр после
 * возврата будет с дырами вместо верхних рядов. Лишнее наблюдатель погасит
 * через кадр-два, уже незаметно.
 */
function revealAllCatalogRows() {
    var rows = document.querySelectorAll('#catalog-rows .catalog-row');
    for (var i = 0; i < rows.length; i++) rows[i].classList.remove(OFFSCREEN_CLASS);
}

window.revealCatalogElement = revealCatalogElement;
window.initRowVisibilityWindow = initRowVisibilityWindow;
window.initGridVisibilityWindow = initGridVisibilityWindow;
window.measureCatalogCardHeight = measureCatalogCardHeight;   // зовёт ui-customizer после смены настроек

/**
 * Обрабатывает очередь: не более ROW_POSTER_CONCURRENCY загрузок одновременно.
 * Как только одна завершается (загрузка + декод), берётся следующая.
 *
 * Пока идёт прокрутка (window.isNavBusy — отметку ставит control.js в момент
 * старта твина), очередь стоит. Вставка постера — это замена содержимого бокса
 * и перерисовка карточки 260×460; несколько таких посреди анимации ряда и есть
 * те самые фризы навигации. Постер карточки под фокусом это не задерживает:
 * его тянет ensureRowPosterNow вне очереди.
 */
function processRowPosterQueue() {
    if (!catalogState.rowPosterQueue || !catalogState.rowPosterQueue.length) return;

    if (typeof window.isNavBusy === 'function' && window.isNavBusy()) {
        if (catalogState.rowPosterQueueTimer) return;        // ждём уже
        catalogState.rowPosterQueueTimer = setTimeout(function () {
            catalogState.rowPosterQueueTimer = null;
            processRowPosterQueue();
        }, CATALOG_CONSTANTS.ROW_POSTER_RETRY_MS);
        return;
    }

    while (catalogState.activeRowPosterLoads < CATALOG_CONSTANTS.ROW_POSTER_CONCURRENCY &&
        catalogState.rowPosterQueue.length > 0) {
        var task = catalogState.rowPosterQueue.shift();
        if (!task.card.isConnected) continue;               // карточку могли удалить
        if (task.card.dataset.posterStarted === '1') continue;  // уже тянет ensureRowPosterNow
        task.card.dataset.posterStarted = '1';
        catalogState.activeRowPosterLoads++;
        loadRowPoster(task.card, task.item)
            .catch(function () { })
            .then(function () {
                catalogState.activeRowPosterLoads--;
                setTimeout(processRowPosterQueue, 5);       // дать главному потоку отрисовать кадр
            });
    }
}

function setRowPosterImg(box, url) {
    return new Promise(function (resolve) {
        // URL уже собран под нужный размер (быстрый путь, posterCache) — не
        // пересобираем, как и в updatePosterDOM: лишний разбор строки, а раньше
        // это ещё и меняло зеркало.
        var size = getPosterCardSize();
        if (url && url.indexOf('/t/p/' + size + '/') === -1) {
            url = getTmdbImageUrl(url, size);
        }
        var img = new Image();
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.3s ease';
        var settled = false;
        var settle = function () { if (!settled) { settled = true; resolve(); } };
        var insert = function () {
            if (box.isConnected && img.naturalWidth > 0) {
                box.innerHTML = '';
                img.style.opacity = '1';
                box.appendChild(img);
            }
            settle();
        };
        var fail = function () {
            if (box.isConnected) box.innerHTML = '<div class="no-poster">Нет постера</div>';
            settle();
        };

        // Как и в updatePosterDOM: зеркало детерминированное, поэтому один раз
        // пробуем следующее, прежде чем показать «Нет постера».
        var mirrorRetried = false;
        img.onerror = function () {
            if (!mirrorRetried) {
                var alt = getTmdbNextMirrorUrl(img.src);
                if (alt && alt !== img.src) {
                    mirrorRetried = true;
                    img.src = alt;
                    return;
                }
            }
            fail();
        };
        img.onload = function () {
            // Декодируем в фоновом потоке (Chromium 64+), не блокируя main thread
            if (typeof img.decode === 'function') img.decode().then(insert).catch(insert);
            else insert();
        };
        img.src = url;
    });
}

/**
 * Клик по карточке фильма в ряду
 */
function onRowItemClick(item, key, index) {
    catalogState.lastSelectedIndex = index;
    catalogState.lastSelectedId = item.id;
    catalogState.lastSelectedRowKey = key;
    catalogState.lastSelectedColIndex = index;
    AppState.catalogIndex = index;
    AppState.androidBackCatalog = item;
    AppState.openInRow = true;
    showCatalogDetail(item, index, null);
}

// Фокус на конкретную карточку ряда + скролл карусели
function focusRowCardByElement(card) {
    if (!card) return;
    // invalidateFocusCache() здесь не нужен: перемещение фокуса DOM не меняет,
    // а сброс кэша только заставлял updateFocusableElements() обойти все карточки.
    if (typeof updateFocusableElements === 'function') updateFocusableElements();
    var idx = (typeof focusableElements !== 'undefined') ? focusableElements.indexOf(card) : -1;
    if (idx !== -1 && typeof setFocus === 'function') {
        setFocus(idx);
    } else if (typeof focusEl === 'function') {
        focusEl(card);
    }
    if (typeof scrollRowToCard === 'function') scrollRowToCard(card);
}

// Возврат фокуса на кликнутую карточку ряда
function restoreRowFocus() {
    var savedKey = catalogState.lastSelectedRowKey;
    var savedCol = catalogState.lastSelectedColIndex;
    catalogState.lastSelectedRowKey = 0;
    catalogState.lastSelectedColIndex = 0;

    if (savedKey != null) {
        // 1) Точное совпадение: нужный ряд + нужная колонка
        var card = document.querySelector(
            '.catalog-row-card[data-catalog-key="' + savedKey + '"][data-item-index="' + savedCol + '"]'
        );
        if (card && card.offsetParent !== null) {
            focusRowCardByElement(card);
            return;
        }
        // 2) Ряд есть, но колонка недоступна — первая карточка этого ряда
        var firstInRow = document.querySelector(
            '.catalog-row-card[data-catalog-key="' + savedKey + '"]'
        );
        if (firstInRow && firstInRow.offsetParent !== null) {
            focusRowCardByElement(firstInRow);
            return;
        }
    }

    // 3) Fallback — первая карточка первого ряда
    if (typeof getCatalogRows === 'function' && typeof focusRowCard === 'function') {
        var rows = getCatalogRows();
        if (rows.length) focusRowCard(0, 0, rows);
    }
}

// ==================== НАВИГАЦИЯ ПО РЯДАМ ====================

function focusRowCard(ri, ci) {
    var rows = window.catalogRows;
    if (!rows || !rows[ri] || !rows[ri][ci]) return true;
    var card = rows[ri][ci];
    if (typeof updateFocusableElements === 'function') updateFocusableElements();
    var idx = (typeof focusableElements !== 'undefined') ? focusableElements.indexOf(card) : -1;
    if (idx !== -1 && typeof setFocus === 'function') setFocus(idx);
    else if (typeof focusEl === 'function') focusEl(card);
    scrollRowToCard(card);
    return true;
}

function findRowPosition(el) {
    var rows = window.catalogRows || [];
    for (var i = 0; i < rows.length; i++) {
        for (var j = 0; j < rows[i].length; j++) {
            if (rows[i][j] === el) return { row: i, col: j };
        }
    }
    return null;
}

function handleRowsNavigation(dir) {
    var rows = window.catalogRows;
    if (!rows || !rows.length) return false;

    var f = document.querySelector('.focused');
    var pos = f ? findRowPosition(f) : null;

    if (!pos) return focusRowCard(0, 0);

    if (dir === 'left') {
        if (pos.col > 0) return focusRowCard(pos.row, pos.col - 1);
        return true;
    }
    if (dir === 'right') {
        if (pos.col < rows[pos.row].length - 1) return focusRowCard(pos.row, pos.col + 1);
        return true;
    }
    if (dir === 'up') {
        if (pos.row > 0) {
            var tc = Math.min(pos.col, rows[pos.row - 1].length - 1);
            return focusRowCard(pos.row - 1, tc);
        }
        // верхний ряд → на табы
        if (typeof getTorrentTabs === 'function') {
            var t = getTorrentTabs();
            if (t.length && typeof focusEl === 'function') { focusEl(t[0]); return true; }
        }
        return true;
    }
    if (dir === 'down') {
        if (pos.row < rows.length - 1) {
            var tc2 = Math.min(pos.col, rows[pos.row + 1].length - 1);
            return focusRowCard(pos.row + 1, tc2);
        }
        return true;
    }
    return true;
}

function scrollRowToCard(card) {
    var viewport = card.closest ? card.closest('.catalog-row-viewport') : null;
    if (!viewport) return;

    // Эту функцию перекрывает одноимённая из control.js (грузится позже) —
    // правки держим синхронными. Карусель двигается трансформацией внутреннего
    // трека, поэтому позицию читаем/пишем хелперами control.js; они появляются
    // позже нас, но к моменту вызова уже есть.
    var cur = (typeof getScrollX === 'function') ? getScrollX(viewport) : viewport.scrollLeft;
    var cr = card.getBoundingClientRect();
    var vr = viewport.getBoundingClientRect();
    var pad = 50;
    var target = null;
    if (cr.left < vr.left + pad) target = cur + (cr.left - vr.left - pad);
    else if (cr.right > vr.right - pad) target = cur + (cr.right - vr.right + pad);
    if (target === null) return;

    if (typeof setScrollX === 'function') {
        setScrollX(viewport, target, true, 0.42);
        return;
    }

    // control.js не загружен: остаётся нативный скролл. Тем же путём, что и вся
    // навигация (Animations.tweenScroll) — scrollBy({behavior:'smooth'}) на
    // телевизоре не работает.
    target = Math.max(0, target);
    if (typeof Animations !== 'undefined' && typeof Animations.tweenScroll === 'function') {
        Animations.tweenScroll(viewport, { scrollLeft: target }, { duration: 0.42, ease: 'power3.out' });
    } else {
        viewport.scrollLeft = target;
    }
}

/**
 * Переопределяет стратегию catalog для поддержки режима рядов.
 * Режим сетки (открыт конкретный каталог) сохраняет старую логику.
 */
function setupCatalogRowsNavigation() {
    if (typeof ScreenStrategies === 'undefined' || !ScreenStrategies.catalog) {
        setTimeout(setupCatalogRowsNavigation, 100); // control.js ещё не готов
        return;
    }
    if (ScreenStrategies.catalog._rowsPatched) return;

    var _origHandleNav = ScreenStrategies.catalog.handleNavigation;
    var _origEnsureFocus = ScreenStrategies.catalog.ensureFocus;

    ScreenStrategies.catalog.handleNavigation = function (dir) {
        if (!catalogState.currentCatalog && window.catalogRows && window.catalogRows.length) {
            return handleRowsNavigation(dir);
        }
        return _origHandleNav.call(this, dir);
    };

    ScreenStrategies.catalog.ensureFocus = function (force) {
        if (force === undefined) force = false;
        if (!catalogState.currentCatalog && window.catalogRows && window.catalogRows.length) {
            if (typeof currentScreen === 'function' && currentScreen() !== 'catalog') return false;
            var f = document.querySelector('.focused');
            if (!force && f && typeof belongsToScreen === 'function' && belongsToScreen(f, 'catalog')) return true;
            return focusRowCard(0, 0);
        }
        return _origEnsureFocus.call(this, force);
    };

    ScreenStrategies.catalog._rowsPatched = true;
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
    var g = getCatalogGridEl();
    ensureCatalogGridVisible();
    showCatalogGridView();
    if (g) g.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px"><div class="loading-spinner" style="margin:0 auto 20px"></div><div style="font-size:16px;color:#aaa">' + (msg || 'Загрузка...') + '</div></div>';
}

function showCatalogError(msg) {
    var g = getCatalogGridEl();
    ensureCatalogGridVisible();
    showCatalogGridView();
    if (g) g.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px"><div style="font-size:48px;margin-bottom:20px">⚠️</div><div style="font-size:16px;color:#ff6a6a">' + msg + '</div><button class="btn" style="margin-top:20px" onclick="window.loadCatalogList()">Попробовать снова</button></div>';
}

function hideCatalogLoading() { }

function backToCatalogList() {
    abortCatalogRequests();
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
    // The LRU is already capped; retaining it keeps the catalog home screen warm.
    catalogState.lastSelectedIndex = 0;
    catalogState.lastSelectedId = null;
    localStorage.removeItem('lastCatalogCardIndex');
    // Сначала затухает сетка категории, и только потом показываются ряды —
    // иначе подмена содержимого выглядит рывком. Фокусом занимается сам
    // showCatalogList: и быстрый путь, и пересборка зовут restoreRowFocus().
    fadeOutCatalogGrid(function () {
        showCatalogList();
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
        var cards = document.querySelectorAll('#catalog-grid .torrent-card.catalog-card');
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
    var cards = document.querySelectorAll('#catalog-grid .torrent-card.catalog-card'), idx = 0;
    for (var i = 0; i < cards.length; i++) {
        if (cards[i].dataset.numIndex && parseInt(cards[i].dataset.numIndex) === target) { idx = i; break; }
    }
    if (idx === 0 && target < cards.length) idx = target;
    return idx;
};

window.addToWatchHistory = async function (id, title, mt, pp) {
    try {
        var save = pp || null;
        if (save) {
            var tmdbPath = save.match(/\/t\/p\/[^/]+(\/[^?#]+)(?:[?#].*)?$/i);
            if (tmdbPath) save = tmdbPath[1];
        }
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

function getCatalogKnownPosterUrl(item, posterUrl) {
    if (!item) return posterUrl || null;

    var mt = item.media_type || 'movie';
    var url = posterUrl || null;

    if (!url && catalogState && catalogState.posterCache) {
        url = catalogState.posterCache.get((item.id || '') + '_' + mt);
    }

    if (!url && item.poster_path) {
        url = getTmdbImageUrl(item.poster_path, CATALOG_CONSTANTS.IMG_SIZES.POSTER_MEDIUM);
    }

    return url;
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
var tmdbCleanupIv = null;

function startTmdbCleanup() {
    if (tmdbCleanupIv) clearInterval(tmdbCleanupIv);
    tmdbCleanupIv = setInterval(cleanOldTmdbCache, TMDB_CACHE_CONFIG.cleanupInterval);
}

function stopTmdbCleanup() {
    if (tmdbCleanupIv) { clearInterval(tmdbCleanupIv); tmdbCleanupIv = null; }
}

function preloadPosterCacheFromDB() {
    if (!window.PosterDB || !window.PosterDB.getAll) return Promise.resolve();

    return PosterDB.getAll().then(function (all) {
        if (!all) return;
        var keys = Object.keys(all);
        for (var i = 0; i < keys.length; i++) {
            // Не перезаписываем, если уже есть в памяти
            if (!catalogState.posterCache.has(keys[i])) {
                catalogState.posterCache.set(keys[i], all[keys[i]]);
            }
        }
        console.log('✅ PosterDB: загружено ' + keys.length + ' постеров в память');
    }).catch(function (e) {
        console.warn('PosterDB preload error:', e);
    });
}

function initCatalog() {
    startTmdbCleanup();
    initCatalogDetailButtons();
    preloadPosterCacheFromDB();

    // Используем другое имя для публичного API
    window.tmdbCacheAPI = {
        clear: clearTmdbCache,
        stats: getTmdbCacheStats,
        setEnabled: function (v) { TMDB_CACHE_CONFIG.enabled = v; },
        isEnabled: function () { return TMDB_CACHE_CONFIG.enabled; },
        setTtl: function (v) {
            TMDB_CACHE_CONFIG.ttl = v;
            if (tmdbCache) tmdbCache.ttl = v;
        }
    };
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initCatalog);
else initCatalog();

window.loadCatalogList = showCatalogList;
window.backToCatalogList = backToCatalogList;
// Явная пересборка рядов: обычный вход в ряды их переиспользует, поэтому обновить
// содержимое (например, ряд «История просмотра») можно только так.
window.refreshCatalogRows = function () { return showCatalogList(true); };
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
