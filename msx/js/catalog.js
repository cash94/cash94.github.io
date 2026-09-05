// catalog.js - Оптимизированный модуль для работы с каталогами
// Совместим с Android TV (Chromium 70+)

// ==================== КОНСТАНТЫ ====================
var CATALOG_CONSTANTS = {
    CACHE_TTL_MS: 3600000,              // 1 час
    FETCH_TIMEOUT_MS: 5000,             // 5 секунд
    CATALOG_CACHE_TTL_MS: 3600000,      // 1 час для каталогов
    // 50, а не 150: столько карточек отрисовывается при входе в категорию и
    // добавляется за одну догрузку. Сетка всё равно виртуализуется чанками
    // (см. блок перед renderCatalogGrid), поэтому крупная страница ничего не
    // экономила — она лишь делала вход в категорию втрое дороже и собирала
    // работу в редкие большие рывки вместо частых мелких.
    // При 5 колонках страница совпадает с чанком (CHUNK_ROWS × колонки).
    ITEMS_PER_PAGE: 50,
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
    ROW_POSTER_RETRY_MS: 120,           // как часто переспрашивать «навигация утихла?»
    POSTER_INSERT_GAP_MS: 16,           // пауза между вставками готовых постеров (кадр)
    // Длительность проявления постера. Держать в согласии с transition
    // у .catalog-poster-img в styles.css — по ней снимается скелет под ним.
    POSTER_FADE_MS: 380,
    VISIBILITY_WINDOW_ROWS: 2,          // сколько строк «запаса» держим отрисованными
    VISIBILITY_FALLBACK_MARGIN_PX: 800, // если высоту строки измерить не удалось
    // Фон детального просмотра: сколько зеркал TMDB пробуем на один путь
    // (первое + следующие по кругу) и сколько ждём молчащее зеркало, прежде чем
    // идти к следующему — ни load, ни error от него может не прийти вообще.
    // Значение — по числу зеркал в mirrors ниже: при трёх попытках из пяти два
    // подряд мёртвых хоста оставляли карточку с чёрным фоном, хотя рабочие
    // зеркала ещё оставались. Лишнего обхода не будет: очередь сама
    // останавливается, когда круг замкнулся (_detailBackdropQueue).
    DETAIL_BACKDROP_TRIES: 5,
    DETAIL_BACKDROP_GRACE_MS: 1200,
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
    // Подборки Кинопоиска. Собирает их тот же парсер, что и остальные каталоги
    // (releases/kp.go), поэтому здесь обычные серверные каталоги — со своими
    // файлами в CATALOG_SOURCES и с торрентом у каждой карточки.
    //
    // Категориями становятся только подборки больше пятидесяти элементов;
    // мелкие лежат рядами главной и приходят из модуля kinopoisk-collections,
    // см. HOME_ROWS в home.js.
    kp_popular: { name: 'Кинопоиск · Популярное', url: SERVER_URL + '/api/catalog/kp_popular', mediaType: 'movie' },
    kp_pop_movies: { name: 'Кинопоиск · Популярные фильмы', url: SERVER_URL + '/api/catalog/kp_pop_movies', mediaType: 'movie' },
    kp_pop_series: { name: 'Кинопоиск · Популярные сериалы', url: SERVER_URL + '/api/catalog/kp_pop_series', mediaType: 'tv' },
    kp_top250: { name: 'Кинопоиск · Топ 250 фильмов', url: SERVER_URL + '/api/catalog/kp_top250', mediaType: 'movie' },
    kp_top250_tv: { name: 'Кинопоиск · Топ 250 сериалов', url: SERVER_URL + '/api/catalog/kp_top250_tv', mediaType: 'tv' },
    kp_family: { name: 'Кинопоиск · Семейное', url: SERVER_URL + '/api/catalog/kp_family', mediaType: 'movie' },
    kp_comics: { name: 'Кинопоиск · Комиксы', url: SERVER_URL + '/api/catalog/kp_comics', mediaType: 'movie' },
    kp_love: { name: 'Кинопоиск · Про любовь', url: SERVER_URL + '/api/catalog/kp_love', mediaType: 'movie' },
    quadhd: { name: 'Фильмы в 4K', url: SERVER_URL + '/api/catalog/quadhd', mediaType: 'movie' },
    legends: { name: 'Лучшие фильмы', url: SERVER_URL + '/api/catalog/legends', mediaType: 'movie' },
    history: { name: 'История', url: null, mediaType: 'history', isHistory: true },
    // Избранное — как и история, не серверный каталог: url нет, данные лежат
    // локально (favorites-db.js, IndexedDB). Порядок ключей здесь = порядок
    // рядов на экране каталога.
    favorites: { name: 'Избранное', url: null, mediaType: 'favorites', isFavorites: true }
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
            // Что именно разворачивать, зависит от режима карточки: в каталоге
            // описание лежит в отдельном блоке, в карточке торрента — прямо в
            // подзаголовке (там оно и остаётся, отдельный блок не показываем).
            // Обрезку задаёт CSS: -webkit-line-clamp, снимает класс .expanded.
            var dv = getEl('detail-view');
            var torrentMode = !!(dv && dv.classList.contains('torrent-detail-mode'));
            var target = torrentMode ? getEl('detail-subtitle') : getEl('catalog-detail-overview');
            if (!target) return;
            var exp = target.classList.toggle('expanded');
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
    // Звёздочку не гасим, а пересинхронизируем: resetDetailButtons зовётся из
    // renderDetailHeader, то есть УЖЕ после setupFavoriteButton и с актуальным
    // AppState.currentDetailItem. Гашение здесь просто отменяло бы кнопку,
    // выставленную мгновением раньше.
    if (typeof syncFavoriteButton === 'function') syncFavoriteButton(AppState.currentDetailItem);

    var togBtn = getEl('catalog-toggle-overview-btn');
    if (togBtn) togBtn.textContent = 'Подробнее';

    var ov = getEl('catalog-detail-overview');
    if (ov) ov.classList.remove('expanded');

    // Подзаголовок разворачивает та же кнопка в режиме карточки торрента
    var sub = getEl('detail-subtitle');
    if (sub) sub.classList.remove('expanded');

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
    // Очередь загрузки пережидает возобновившееся движение (schedulePosterBatchRetry)
    posterBatchTimer: null,
    cardElements: {},
    posterCache: new LRUCache(CATALOG_CONSTANTS.MAX_POSTER_CACHE),
    maxPosterCacheSize: CATALOG_CONSTANTS.MAX_POSTER_CACHE,
    rowPosterObserver: null,
    rowPosterQueue: [],
    rowPosterQueueTimer: null,      // отложенный прогон очереди (ждём конца навигации)
    activeRowPosterLoads: 0,
    // Постер карточки под фокусом: ждёт конца твина карусели (ensureRowPosterNow)
    focusPosterCard: null,
    focusPosterTimer: null,
    // Оконная видимость (см. initRowVisibilityWindow / initGridVisibilityWindow)
    rowVisibilityObserver: null,
    gridVisibilityObserver: null,
    // Чанковая виртуализация сетки категории (см. блок перед renderCatalogGrid)
    chunks: [],
    chunkSize: 0,
    chunkCols: 0,
    chunkObserver: null,
    chunkTrimTimer: null
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
    if (catalogState.chunkObserver) { catalogState.chunkObserver.disconnect(); catalogState.chunkObserver = null; }
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
    // Фильмография актёра — не серверный каталог, в CATALOG_CONFIG её нет.
    // Сюда приходит возврат из карточки фильма, открытой из этой же сетки
    // (restoreFocusAfterNavigation в app.js), поэтому пересобираем по
    // запомненному актёру.
    if (key === 'person') {
        if (!catalogState.person) return;
        return loadPersonCatalog(catalogState.person.id, catalogState.person.name);
    }
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


/* ==================== ИЗБРАННОЕ ==================== */

/** Перерисовать звёздочку под текущее состояние */
function syncFavoriteButton(item) {
    var btn = getEl('catalog-favorite-btn');
    if (!btn) return;

    if (!item || item.id === undefined || item.id === null || !window.FavoritesDB) {
        btn.classList.add('hidden');
        return;
    }

    var active = FavoritesDB.has(item.id, item.media_type || 'movie');
    var icon = btn.querySelector('.favorite-btn-icon');
    if (icon) icon.textContent = active ? '★' : '☆';
    btn.classList.toggle('is-favorite', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.classList.remove('hidden');
    btn.style.removeProperty('display');
}

/**
 * Кнопка «Избранное» в карточке каталога.
 *
 * Состояние читается синхронно из индекса FavoritesDB — иначе звезда успевала
 * бы моргнуть пустой на уже открытой карточке. Запись асинхронная, но кнопку
 * перерисовываем сразу по возвращённому состоянию.
 */
function setupFavoriteButton(item) {
    var btn = getEl('catalog-favorite-btn');
    if (!btn) return;

    if (!item || item.id === undefined || item.id === null || !window.FavoritesDB) {
        btn.classList.add('hidden');
        return;
    }

    // Индекс мог не успеть загрузиться к первой карточке — перерисуем, когда придёт
    FavoritesDB.ready().then(function () { syncFavoriteButton(item); });
    syncFavoriteButton(item);

    // onclick, а не addEventListener: пересобирается на каждую карточку,
    // накопления обработчиков от прошлых фильмов быть не должно
    btn.onclick = function () {
        // Название и год берём резолверами, а не полем item.title: у элементов
        // серверного каталога его нет вовсе — заголовок лежит в torrent[0].name
        // либо приходит из TMDB. Без этого в избранном оказывались безымянные
        // карточки.
        FavoritesDB.toggle(buildFavoriteRecord(item)).then(function () {
            syncFavoriteButton(item);
            // Ряд «Избранное» на экране каталога устарел
            invalidateFavoritesRow();
        });
    };
}

/**
 * Ряд «Избранное» собран из данных, которые только что изменились.
 *
 * Ряды каталога переиспользуются (showCatalogList без force берёт готовый DOM),
 * поэтому просто пометим: при следующем показе список пересобрать.
 */
function invalidateFavoritesRow() {
    if (window.catalogRowsData) delete window.catalogRowsData.favorites;
    catalogState.favoritesRowStale = true;
}

/**
 * Запись для избранного из элемента каталога.
 *
 * Заголовок собираем getCatalogItemTitle: у элементов серверного каталога поля
 * title нет вовсе — оно либо в torrent[0].name, либо приходит из TMDB и оседает
 * в AppState.currentDetailItem. Без этого в избранное попадали безымянные
 * карточки. Постер берём уже известный, чтобы ряд избранного не ждал
 * повторного запроса.
 */
function buildFavoriteRecord(item) {
    var title = getCatalogItemTitle(item);
    if (title === 'Без названия') {
        var cur = AppState.currentDetailItem;
        if (cur && cur.id === item.id) title = cur.title || cur.name || title;
    }

    return {
        id: item.id,
        media_type: item.media_type || 'movie',
        title: title,
        name: title,
        poster_path: getCatalogKnownPosterUrl(item, item.poster_path) || item.poster_path || null,
        vote_average: (typeof item.vote_average === 'number') ? item.vote_average : null,
        release_date: item.release_date || item.first_air_date || null
    };
}

/**
 * window.catalogRows заново из DOM.
 *
 * createCatalogRow всегда дописывает ряд в КОНЕЦ массива, а точечная замена
 * ставит его на прежнее место в разметке — порядок разъехался бы. Собираем
 * список по документу: он и есть источник истины для порядка рядов.
 */
function syncCatalogRowsFromDom() {
    var rows = document.querySelectorAll('#catalog-rows .catalog-row');
    window.catalogRows = [];
    for (var i = 0; i < rows.length; i++) {
        var cards = rows[i].querySelectorAll('.catalog-row-card');
        var arr = [];
        for (var j = 0; j < cards.length; j++) arr.push(cards[j]);
        if (arr.length) window.catalogRows.push(arr);
    }
}

/**
 * Перерисовать ТОЛЬКО ряд «Избранное», если он устарел.
 *
 * Звёздочку в карточке можно нажимать много раз подряд, и перестраивать ряд на
 * каждое нажатие — лишняя работа на телевизоре. Поэтому клик лишь помечает
 * ряд устаревшим (invalidateFavoritesRow), а собственно перерисовка происходит
 * здесь — один раз, на возврате к рядам каталога.
 *
 * Полная пересборка всех рядов (showCatalogList с force) для этого не годится:
 * она заново тянет по десять элементов на каждую из восьми категорий.
 */
function refreshFavoritesRow() {
    if (!catalogState.favoritesRowStale) return Promise.resolve(false);
    catalogState.favoritesRowStale = false;

    var container = getCatalogRowsEl();
    if (!container) return Promise.resolve(false);

    return loadFavoritesItems(10).then(function (items) {
        var existing = container.querySelector('.catalog-row[data-catalog-key="favorites"]');

        // Избранное опустело — ряд убираем совсем, как это делает
        // прогрессивная сборка с пустыми категориями
        if (!items.length) {
            if (existing) {
                if (catalogState.rowVisibilityObserver) catalogState.rowVisibilityObserver.unobserve(existing);
                container.removeChild(existing);
            }
            if (window.catalogRowsData) delete window.catalogRowsData.favorites;
            syncCatalogRowsFromDom();
            if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
            return true;
        }

        var fresh = createCatalogRow('favorites', items);
        if (!fresh) return false;

        if (existing) {
            if (catalogState.rowVisibilityObserver) catalogState.rowVisibilityObserver.unobserve(existing);
            container.replaceChild(fresh, existing);
        } else {
            // Ряда не было (избранное было пустым). favorites — последний ключ
            // CATALOG_CONFIG, поэтому его место в конце.
            container.appendChild(fresh);
        }

        // Новый ряд надо отдать наблюдателям: постеры и оконная видимость
        if (catalogState.rowPosterObserver) {
            var cards = fresh.querySelectorAll('.catalog-row-card');
            for (var i = 0; i < cards.length; i++) {
                if (cards[i].dataset.itemIndex !== undefined) {
                    cards[i].dataset.posterStarted = '0';
                    catalogState.rowPosterObserver.observe(cards[i]);
                }
            }
        }
        observeRowVisibility(fresh);

        syncCatalogRowsFromDom();
        if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
        return true;
    }).catch(function (e) {
        console.warn('⚠️ Ряд «Избранное» не обновился:', e);
        return false;
    });
}
window.refreshFavoritesRow = refreshFavoritesRow;

/** Элементы избранного в том же виде, что и остальные карточки каталога */
function loadFavoritesItems(limit) {
    if (!window.FavoritesDB) return Promise.resolve([]);
    return FavoritesDB.list().then(function (items) {
        var out = [];
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            out.push({
                id: it.id,
                title: it.title,
                name: it.name || it.title,
                media_type: it.media_type,
                poster_path: it.poster_path,
                vote_average: it.vote_average,
                release_date: it.release_date,
                isFavoriteItem: true
            });
        }
        return (limit && out.length > limit) ? out.slice(0, limit) : out;
    });
}

function showEmptyFavorites() {
    var g = getCatalogGridEl();
    if (!g) return;
    showCatalogGridView();
    g.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px;">' +
        '<div style="font-size:64px;margin-bottom:20px">★</div>' +
        '<div style="font-size:18px;color:#aaa;margin-bottom:10px">В избранном пусто</div>' +
        '<div style="font-size:14px;color:#666">Открой карточку фильма и нажми «Избранное»</div></div>';
}

/** Категория «Избранное» — сеткой, как история */
function loadFavoritesCatalog() {
    abortCatalogRequests();
    catalogState.currentCatalog = 'favorites';
    catalogState.cardElements = {};
    catalogState.items = [];
    catalogState.totalItems = 0;
    catalogState.currentPage = 0;
    catalogState.hasMore = false;
    catalogState.isLoadingMore = false;
    catalogState.loadedItemIds = {};
    catalogState.loadedPostersCount = 0;
    catalogState.posterLoadQueue = [];
    catalogState.fullItems = null;
    catalogState.fullItemsTruncated = false;
    AppState.mediaType = 'favorites';
    AppState.openInRow = false;
    AppState.backCurrentCatalog = 'favorites';
    showCatalogLoading('Загрузка избранного...');

    return loadFavoritesItems(0).then(function (items) {
        if (!items.length) { showEmptyFavorites(); return; }
        catalogState.items = items;
        catalogState.totalItems = items.length;
        for (var i = 0; i < items.length; i++) {
            if (items[i].id) catalogState.loadedItemIds[items[i].id] = true;
        }
        renderCatalogGrid();
    }).catch(function (e) {
        console.error('Ошибка загрузки избранного:', e);
        showCatalogError('Не удалось загрузить избранное');
    }).finally(function () {
        hideCatalogLoading();
    });
}
window.loadFavoritesCatalog = loadFavoritesCatalog;
window.loadFavoritesItems = loadFavoritesItems;
window.syncFavoriteButton = syncFavoriteButton;

/* ==================== ФИЛЬМОГРАФИЯ АКТЁРА ==================== */

/**
 * Категория «фильмы с этим актёром» — по нажатию на карточку в ряду
 * «В главных ролях».
 *
 * Ведёт себя как история и избранное: своя сетка, серверного каталога нет,
 * догрузки нет (сервер отдаёт готовую сотню). Ключ категории один на всех
 * актёров — 'person', а кто именно, лежит в catalogState.person: так возврат
 * из карточки фильма (restoreFocusAfterNavigation → loadCatalog) попадает
 * туда же, откуда ушёл, не разбирая ключ на части.
 *
 * «Назад» из сетки уводит в список категорий, как и из любой другой.
 */
/**
 * Переход в фильмографию — новый шаг пути.
 *
 * Путь (catalogState.personTrail) — стек карточек, ИЗ которых уходили к актёру.
 * Каждый шаг помнит и саму карточку, и фильмографию, которой она принадлежала:
 * без второго поля цепочка «актёр → фильм → актёр» замкнулась бы сама на себя,
 * потому что возврат из фильма смотрит на текущую сетку, а она уже чужая.
 *
 * Флаги приложения (personRoot) снимаются один раз, на входе в экскурсию, и
 * возвращаются на выходе. Полагаться на них по ходу нельзя: обработчик «назад»
 * в app.js перед вычислением returnTo делает detailReturnTo = inSearch, то есть
 * затирает то, что мы могли бы туда положить.
 */
function openPersonCatalog(personId, personName) {
    if (!personId) return Promise.resolve();
    if (!catalogState.personTrail) catalogState.personTrail = [];

    if (!catalogState.personTrail.length) {
        catalogState.personRoot = {
            fromHome: !!(window.HomeScreen && HomeScreen.state && HomeScreen.state.detailFromHome),
            realCatalog: (catalogState.currentCatalog && catalogState.currentCatalog !== 'person')
                ? catalogState.currentCatalog
                : (AppState.backCurrentCatalog !== 'person' ? AppState.backCurrentCatalog : ''),
            isSearch: !!AppState.isSearch,
            inSearch: AppState.inSearch,
            detailReturnTo: AppState.detailReturnTo,
            // Позиция в категории, из которой уходим. localStorage один на все
            // сетки, и за экскурсию его перетрут фильмографии — без снимка
            // возврат в категорию встал бы на чужую карточку
            lastIndex: catalogState.lastSelectedIndex,
            lastId: catalogState.lastSelectedId,
            storedIndex: (function () {
                try { return localStorage.getItem('lastCatalogCardIndex'); } catch (e) { return null; }
            })()
        };
    }

    catalogState.personTrail.push({
        item: AppState.currentDetailItem || null,
        index: catalogState.lastSelectedIndex || 0,
        // Сетка, из карточки которой уходим. null — карточку открыли из
        // каталога, с главной или из поиска, то есть это начало экскурсии
        person: catalogState.currentCatalog === 'person' ? catalogState.person : null
    });

    return showPersonCatalog(personId, personName);
}

/**
 * Показ фильмографии без записи пути. Этим же путём идёт возврат в сетку из
 * открытой из неё карточки (loadCatalog('person')): шаг там уже снят, добавлять
 * его второй раз нельзя.
 */
function loadPersonCatalog(personId, personName) {
    if (!personId) return Promise.resolve();
    return showPersonCatalog(personId, personName);
}

function showPersonCatalog(personId, personName) {

    abortCatalogRequests();

    // Уходим из карточки: без этого сетка отрисуется под открытым detail-view.
    // Историю карточек тоже сбрасываем — иначе «назад» из фильмографии полезет
    // обратно по цепочке рекомендаций, из которой мы только что вышли.
    if (typeof clearDetailHistory === 'function') clearDetailHistory();
    if (typeof hideCatalogDetailView === 'function') hideCatalogDetailView();
    // hideCatalogDetailView снимает только свой класс раскладки. Уйти сюда
    // можно и из торрентной карточки — её класс тогда остался бы на #detail-view,
    // и isTorrentDetailMode() врал бы про режим до следующего открытия.
    var dvEl = getEl('detail-view');
    if (dvEl) dvEl.classList.remove('torrent-detail-mode');
    // Открытая карточка гасит #main-container (showCatalogDetail:
    // mc.style.pointerEvents = 'none'), а возвращает его только «назад» из
    // карточки (app.js, back-from-detail). Сюда уходят мимо него, и в сетке
    // фильмографии не работали ни тап, ни мышь, ни прокрутка контейнера:
    // пульт слушает document и потому продолжал ходить по карточкам, а всё
    // указательное упиралось в pointer-events: none.
    var mcEl = getEl('main-container');
    if (mcEl) mcEl.style.pointerEvents = 'auto';
    if (typeof Animations !== 'undefined' && typeof Animations.animateDetailHide === 'function') {
        Animations.animateDetailHide();
    } else {
        var dv = getEl('detail-view');
        if (dv) dv.style.display = 'none';
    }

    // Каждая фильмография помнит свою карточку отдельно. Тот же актёр — это
    // возврат в уже открытую сетку, и объект переиспользуется вместе с
    // запомненной позицией; другой — сетка новая, фокус начинается с первой
    // карточки.
    //
    // Без этого позиция приезжала из прошлой категории: ensureFocus в control.js
    // читает localStorage.lastCatalogCardIndex, а у элементов фильмографии нет
    // num_index, поэтому число применяется как порядковый номер в списке.
    var samePerson = catalogState.person && String(catalogState.person.id) === String(personId);
    if (!samePerson) {
        catalogState.person = { id: String(personId), name: personName || '', lastIndex: 0, lastId: null };
    } else if (personName) {
        catalogState.person.name = personName;
    }
    catalogState.lastSelectedIndex = catalogState.person.lastIndex || 0;
    catalogState.lastSelectedId = catalogState.person.lastId || null;
    try {
        if (catalogState.lastSelectedIndex) {
            localStorage.setItem('lastCatalogCardIndex', String(catalogState.lastSelectedIndex));
        } else {
            localStorage.removeItem('lastCatalogCardIndex');
        }
    } catch (e) { }

    catalogState.currentCatalog = 'person';
    catalogState.cardElements = {};
    catalogState.items = [];
    catalogState.totalItems = 0;
    catalogState.currentPage = 0;
    catalogState.hasMore = false;
    catalogState.isLoadingMore = false;
    catalogState.loadedItemIds = {};
    catalogState.loadedPostersCount = 0;
    catalogState.posterLoadQueue = [];
    catalogState.fullItems = null;
    catalogState.fullItemsTruncated = false;
    // Список смешанный, тип у каждой карточки свой — общий берём нейтральным
    AppState.mediaType = 'movie';
    AppState.openInRow = false;
    AppState.backCurrentCatalog = 'person';
    // Из поиска карточка открывается поверх оверлея результатов, и он остался бы
    // висеть над сеткой. Закрываем его до смены экрана, назначив возврат в
    // каталог: сам hideSearchResults уводит туда, куда указывает searchReturnTo.
    var searchOverlay = getEl('search-overlay');
    if (searchOverlay && !searchOverlay.hidden && searchOverlay.style.display !== 'none' &&
        typeof hideSearchResults === 'function') {
        AppState.searchReturnTo = 'catalog';
        hideSearchResults();
    }

    // Карточку открывают и из каталога, и с главной, и из поиска, а сетка
    // живёт на экране каталога. Просто переставить AppState.currentScreen мало:
    // с главной #content-catalog скрыт (hidden), и сетка отрисовалась бы в
    // невидимый экран. showContentScreen пропатчен в home.js — он и прячет
    // главную, и показывает каталог, и обновляет currentScreen.
    if (typeof showContentScreen === 'function') showContentScreen('catalog');
    else AppState.currentScreen = 'catalog';

    // Признак «карточка открыта с главной» перебил бы возврат: пропатченный
    // restoreFocusAfterNavigation увёл бы «назад» из фильма на главную, а не в
    // эту сетку. Трейлер баннера тоже останавливаем — экран он больше не свой.
    if (window.HomeScreen) {
        if (HomeScreen.state) HomeScreen.state.detailFromHome = false;
        if (typeof HomeScreen.stopTrailer === 'function') HomeScreen.stopTrailer();
    }

    // Куда уводит «назад» из карточки, открытой уже отсюда: в эту же сетку,
    // даже если сюда пришли из поиска или с главной.
    //
    // Решает здесь именно inSearch. Обработчик «назад» в app.js первым делом
    // делает detailReturnTo = inSearch и только потом сравнивает его с
    // 'catalog' — то есть значение, положенное в detailReturnTo, до сравнения
    // не доживает. С главной там лежало 'home', и возврат уходил в торренты.
    AppState.inSearch = 'catalog';
    AppState.detailReturnTo = 'catalog';
    AppState.isSearch = false;
    showCatalogLoading('Загрузка фильмографии...');

    return safeFetch(SERVER_URL + '/api/tmdb/person/credits?id=' + encodeURIComponent(personId), { timeout: 15000 })
        .then(function (d) {
            if (!d || !d.success || !d.items || !d.items.length) {
                showEmptyPerson(personName);
                return;
            }
            catalogState.items = d.items;
            catalogState.totalItems = d.items.length;
            for (var i = 0; i < d.items.length; i++) {
                if (d.items[i].id) catalogState.loadedItemIds[d.items[i].id] = true;
            }
            renderCatalogGrid();
            // Сетку собрали после смены экрана — состав фокусируемого сменился
            // целиком, кэш в control.js держится на счётчике поколений DOM
            if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
            if (typeof updateFocusableElements === 'function') updateFocusableElements();
            if (typeof window.ensureCatalogFocus === 'function') window.ensureCatalogFocus(true);
        })
        .catch(function (e) {
            console.error('Ошибка загрузки фильмографии:', e);
            showCatalogError('Не удалось загрузить фильмографию');
        })
        .finally(function () {
            hideCatalogLoading();
        });
}

function showEmptyPerson(personName) {
    var g = getCatalogGridEl();
    if (!g) return;
    showCatalogGridView();
    g.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px;">' +
        '<div style="font-size:64px;margin-bottom:20px">🎭</div>' +
        '<div style="font-size:18px;color:#aaa;margin-bottom:10px">Ничего не нашлось</div>' +
        '<div style="font-size:14px;color:#666">' + escapeHtml(personName || 'У этого актёра') + ' — фильмов и сериалов нет</div></div>';
}

window.openPersonCatalog = openPersonCatalog;
window.loadPersonCatalog = loadPersonCatalog;

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
        resetGridChunks();
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

/* ==================== ЧАНКОВАЯ ВИРТУАЛИЗАЦИЯ СЕТКИ ====================
 *
 * Карточки категории копились в DOM без предела: 150 за страницу, до
 * CATALOG_FULL_LIMIT. На 900 карточках это 11 тысяч узлов, и каждое нажатие
 * пульта дорожало вчетверо против 150 — не из-за памяти (куча стояла на месте),
 * а из-за layout: focusEl на каждый шаг зовёт getBoundingClientRect дважды
 * (isElementFullyVisible и scrollCatalogGridCardIntoView), а стоимость
 * принудительного пересчёта линейна по размеру документа.
 *
 * Поэтому сетка держится нарезанной на чанки по CHUNK_ROWS строк. Далёкие от
 * фокуса чанки СВОРАЧИВАЮТСЯ: карточки удаляются, а на их место встаёт одна
 * распорка ровно той же высоты. Ключевое здесь — именно распорка, а не простое
 * удаление: scrollHeight не меняется, значит позицию прокрутки компенсировать
 * не надо и рывка нет в принципе.
 *
 * От дёрганья на границе (быстро мотать вверх-вниз) защищают три вещи:
 *   • гистерезис — сворачиваем, только перевалив за CHUNK_HYDRATED_MAX, и лишь
 *     до CHUNK_HYDRATED_KEEP, так что у границы всегда есть запас;
 *   • CHUNK_FOCUS_GUARD — чанк с фокусом и соседние не трогаем вообще;
 *   • работаем только в тишине — тем же условием, что очередь постеров
 *     и оконная видимость (navHold + isCatalogScrollAnimating).
 *
 * Границы чанков выравнены по строкам сетки (кратны числу колонок): иначе
 * распорка во всю ширину встала бы посреди строки и разъехалась бы вёрстка.
 */
var CHUNK_ROWS = 5;              // строк сетки в одном чанке
var CHUNK_HYDRATED_MAX = 4;      // сверх этого начинаем сворачивать
var CHUNK_HYDRATED_KEEP = 3;     // до скольких сворачиваем: предыдущий, текущий, следующий
var CHUNK_FOCUS_GUARD = 1;       // чанков по обе стороны от фокуса не трогаем

/* Почему именно 4 и 3.
 *
 * KEEP = 3 — это ровно то, что защищает CHUNK_FOCUS_GUARD: чанк с фокусом плюс
 * по одному с каждой стороны. Меньше поставить нельзя — обрезка всё равно не
 * тронет защищённые и просто отработает вхолостую.
 *
 * MAX = KEEP + 1 даёт запас ровно на одно пересечение границы, и этого хватает,
 * чтобы мотание вверх-вниз через границу не дёргало DOM. Перешли из чанка n в
 * n+1: ensureChunksAroundFocus поднимает n+2, живых становится 4 — это ещё не
 * больше MAX, обрезка молчит. Вернулись в n: n-1 уже живой, ничего поднимать не
 * надо, живых по-прежнему 4. Сколько ни качайся у этой границы, ни одной
 * свёртки и ни одной развёртки не происходит. Только уйдя на чанк дальше,
 * получаем 5 живых, и хвост сворачивается до 3.
 *
 * При 5 колонках это 75–100 карточек в DOM вместо неограниченного роста. */

/* Почему CHUNK_ROWS = 5, а не 10, как было.
 *
 * Живого DOM всегда (2 × GUARD + 1) × колонок × CHUNK_ROWS, то есть при
 * десяти строках выходило 150–200 карточек — вчетверо больше, чем помещается
 * на экран. Пять строк дают 75–100 и заодно вдвое уменьшают ПИК: развернуть
 * чанк ensureChunksAroundFocus обязан синхронно, прямо в обработчике нажатия,
 * и создание 25 карточек — это вдвое более короткая задержка, чем 50. Общая
 * работа на пройденное расстояние та же, но размазана мельче, а зонд считает
 * именно рывки, а не суммарные миллисекунды.
 *
 * Ограничение, которое при этом нельзя нарушить: наблюдатель разворачивает
 * всякую распорку в пределах CHUNK_OBSERVER_MARGIN_PX, а обрезка сворачивает
 * всё, что дальше GUARD чанков от фокуса. Если наблюдатель дотягивается ДАЛЬШЕ,
 * чем достаёт защита, они начинают воевать: обрезка свернула — наблюдатель
 * тут же развернул обратно, и карточки мерцают. Отсюда правило
 *
 *     CHUNK_OBSERVER_MARGIN_PX  <  GUARD × высота чанка
 *
 * Высота чанка = CHUNK_ROWS × высота строки, а строка тем ниже, чем больше
 * колонок выставлено в ui-customizer. Худший случай — много колонок: при
 * десяти строка около 200px, чанк ≈ 1000px. Поэтому вместе с CHUNK_ROWS
 * уменьшен и запас наблюдателя — до 600px, что укладывается в предел на всех
 * поддерживаемых плотностях. Пульту этого хватает с избытком: соседние чанки
 * разворачивает синхронно ensureChunksAroundFocus, не дожидаясь наблюдателя,
 * а тот остаётся для прокрутки пальцем. */
var CHUNK_OBSERVER_MARGIN_PX = 600;    // за сколько до вьюпорта разворачивать
var CHUNK_SCROLL_QUIET_MS = 250;       // сколько ждать после последнего события прокрутки

/* Тишина прокрутки.
 *
 * Свёртку чанков нельзя делать во время движения — иначе карточки исчезают
 * прямо под пальцем. Для пульта это ловят navHold и твин прокрутки, но
 * при свайпе на телефоне нет ни того, ни другого: инерционный скролл идёт
 * сам по себе, обрезка срабатывает посреди него, наблюдатель тут же
 * разворачивает чанк обратно — и карточки мерцают.
 *
 * Поэтому отдельно слушаем сам scroll. Обработчик только пишет отметку
 * времени, ничего не читает из layout и потому ничего не форсирует. */
var _gridScrollAt = 0;

function initChunkScrollWatch() {
    var mc = getEl('main-container');
    if (!mc || mc._chunkScrollWatch) return;
    mc._chunkScrollWatch = true;
    mc.addEventListener('scroll', function () { _gridScrollAt = Date.now(); }, false);
}

function isGridScrolling() {
    return (Date.now() - _gridScrollAt) < CHUNK_SCROLL_QUIET_MS;
}

function getChunkSize() {
    var cols = (typeof getColumns === 'function' && getColumns()) || 5;
    return cols * CHUNK_ROWS;
}

/** Сетка перерисована или каталог сменился — прежняя нарезка недействительна */
function resetGridChunks() {
    if (catalogState.chunkObserver) {
        catalogState.chunkObserver.disconnect();
        catalogState.chunkObserver = null;
    }
    if (catalogState.chunkTrimTimer) {
        clearTimeout(catalogState.chunkTrimTimer);
        catalogState.chunkTrimTimer = null;
    }
    catalogState.chunks = [];
    catalogState.chunkSize = 0;
    catalogState.chunkCols = 0;
}

/**
 * Пересобирает описание чанков по текущему составу catalogState.items.
 * Сами карточки при этом не трогаются — только границы диапазонов.
 */
function rebuildChunkRanges() {
    var size = catalogState.chunkSize || getChunkSize();
    var total = catalogState.items.length;
    var chunks = catalogState.chunks;

    for (var start = chunks.length * size; start < total; start += size) {
        chunks.push({
            index: chunks.length,
            start: start,
            end: Math.min(start + size, total),
            spacer: null
        });
    }

    // Последний чанк мог быть неполным и дорасти новой страницей
    if (chunks.length) {
        var last = chunks[chunks.length - 1];
        last.end = Math.min(last.start + size, total);
    }
}

function initChunkObserver() {
    if (catalogState.chunkObserver) catalogState.chunkObserver.disconnect();

    catalogState.chunkObserver = new IntersectionObserver(function (entries) {
        var grew = false;
        for (var i = 0; i < entries.length; i++) {
            if (!entries[i].isIntersecting) continue;
            var ch = entries[i].target._chunk;
            if (ch && ch.spacer) { hydrateChunk(ch); grew = true; }
        }
        if (grew) {
            if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
            updatePosterObservers();
            updateGridVisibilityWindow();
            scheduleChunkTrim();
        }
    }, { root: getEl('main-container'), rootMargin: CHUNK_OBSERVER_MARGIN_PX + 'px 0px', threshold: 0 });
}

/**
 * Начинается и заканчивается ли чанк на границе СТРОКИ сетки.
 *
 * Распорка занимает всю ширину (grid-column: 1/-1). Если чанк начинается
 * посреди строки, карточки перед ним в этой же строке остаются сиротами, а
 * распорка уезжает на следующую строку — раскладка разъезжается, и замер
 * высоты по «первая.top … последняя.bottom» тоже врёт.
 *
 * Такое случается, когда число колонок изменилось уже после построения сетки:
 * его задаёт ui-customizer, а chunkSize считался один раз в renderCatalogGrid.
 * Ниже это лечит realignChunksToColumns(), а здесь стоит последний заслон.
 */
function chunkAlignedToRows(ch, cols) {
    if (!cols || cols < 1) return false;
    if (ch.start % cols !== 0) return false;
    // Последний чанк вправе быть неполным — он и так упирается в конец списка
    if (ch.end < catalogState.items.length && (ch.end - ch.start) % cols !== 0) return false;
    return true;
}

/**
 * Число колонок изменилось (настройки внешнего вида) — режем сетку заново.
 * Сначала разворачиваем всё, иначе прежние распорки останутся с чужой
 * геометрией, а их чанки — с чужими границами.
 */
function realignChunksToColumns() {
    var cols = (typeof getColumns === 'function' && getColumns()) || 0;
    if (!cols || !catalogState.chunks || !catalogState.chunks.length) return false;
    if (cols === catalogState.chunkCols) return false;

    var chunks = catalogState.chunks;
    for (var i = 0; i < chunks.length; i++) {
        if (chunks[i].spacer) hydrateChunk(chunks[i]);
    }

    catalogState.chunks = [];
    catalogState.chunkCols = cols;
    catalogState.chunkSize = cols * CHUNK_ROWS;
    rebuildChunkRanges();

    if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
    updatePosterObservers();
    updateGridVisibilityWindow();
    return true;
}

/** Свернуть чанк: карточки → одна распорка той же высоты */
function dehydrateChunk(ch) {
    if (!ch || ch.spacer) return false;
    if (!chunkAlignedToRows(ch, (typeof getColumns === 'function' && getColumns()) || 0)) return false;

    var first = catalogState.cardElements[ch.start];
    var last = catalogState.cardElements[ch.end - 1];
    if (!first || !last || !first.isConnected || !last.isConnected) return false;

    // Высоту МЕРЯЕМ, а не считаем из числа строк и gap: посчитанная разъедется
    // с реальной при любой правке плотности в ui-customizer, а разъехавшаяся
    // распорка — это тот самый сдвиг, ради отсутствия которого всё и затевалось.
    var height = last.getBoundingClientRect().bottom - first.getBoundingClientRect().top;
    if (!(height > 0)) return false;

    var spacer = document.createElement('div');
    spacer.className = 'catalog-chunk-spacer';
    spacer.style.cssText = 'grid-column:1/-1;height:' + height + 'px;';
    spacer._chunk = ch;

    var grid = getCatalogGridEl();
    if (!grid) return false;
    grid.insertBefore(spacer, first);

    for (var i = ch.start; i < ch.end; i++) {
        var card = catalogState.cardElements[i];
        if (card && card.parentNode === grid) grid.removeChild(card);
        delete catalogState.cardElements[i];
    }

    ch.spacer = spacer;
    if (catalogState.chunkObserver) catalogState.chunkObserver.observe(spacer);
    return true;
}

/** Развернуть чанк обратно: распорка → карточки */
function hydrateChunk(ch) {
    if (!ch || !ch.spacer) return false;

    var grid = getCatalogGridEl();
    var spacer = ch.spacer;
    if (!grid || spacer.parentNode !== grid) { ch.spacer = null; return false; }

    var frag = document.createDocumentFragment();
    for (var i = ch.start; i < ch.end; i++) {
        var item = catalogState.items[i];
        if (!item) continue;
        frag.appendChild(createCatalogCard(item, i));
    }

    grid.insertBefore(frag, spacer);
    if (catalogState.chunkObserver) catalogState.chunkObserver.unobserve(spacer);
    grid.removeChild(spacer);
    ch.spacer = null;
    return true;
}

/**
 * Чанк, вокруг которого держим развёрнутое окно.
 *
 * Обычно это чанк с фокусом. Но догрузка страниц идёт и без фокуса в сетке —
 * её запускает наблюдатель load-more-trigger при прокрутке. Раньше в этом
 * случае обрезка просто не срабатывала, и карточки копились как прежде,
 * поэтому есть запасной путь: чанк, ближайший к верху видимой области.
 */
function anchorChunkIndex() {
    var size = catalogState.chunkSize || getChunkSize();

    var f = document.querySelector('#catalog-grid .torrent-card.catalog-card.focused');
    if (f && f.dataset.catalogIndex) {
        var idx = parseInt(f.dataset.catalogIndex, 10);
        if (!isNaN(idx)) return Math.floor(idx / size);
    }

    var mc = getEl('main-container');
    var chunks = catalogState.chunks;
    if (!mc || !chunks || !chunks.length) return -1;

    var viewTop = mc.getBoundingClientRect().top;
    var best = -1, bestDist = Infinity;
    for (var i = 0; i < chunks.length; i++) {
        if (chunks[i].spacer) continue;
        var card = catalogState.cardElements[chunks[i].start];
        if (!card || !card.isConnected) continue;
        var d = Math.abs(card.getBoundingClientRect().top - viewTop);
        if (d < bestDist) { bestDist = d; best = chunks[i].index; }
    }
    return best;
}

/** Отложить обрезку до конца навигации — как очередь постеров */
function scheduleChunkTrim() {
    if (catalogState.chunkTrimTimer) return;
    catalogState.chunkTrimTimer = setTimeout(function () {
        catalogState.chunkTrimTimer = null;
        trimGridChunks();
    }, CATALOG_CONSTANTS.ROW_POSTER_RETRY_MS);
}

function trimGridChunks() {
    realignChunksToColumns();
    var chunks = catalogState.chunks;
    if (!chunks || chunks.length <= CHUNK_HYDRATED_MAX) return;

    var live = [];
    for (var i = 0; i < chunks.length; i++) if (!chunks[i].spacer) live.push(chunks[i]);
    if (live.length <= CHUNK_HYDRATED_MAX) return;

    // Пока кнопку держат, едет твин или палец тянет список — DOM не трогаем
    if (window.navHold || isCatalogScrollAnimating() || isGridScrolling()) {
        scheduleChunkTrim();
        return;
    }

    var focusIdx = anchorChunkIndex();
    if (focusIdx === -1) return;    // не от чего отсчитывать «далёкий» чанк

    live.sort(function (a, b) {
        return Math.abs(b.index - focusIdx) - Math.abs(a.index - focusIdx);
    });

    // Запоминаем, где стоял фокус: CHUNK_FOCUS_GUARD его чанк защищает, но
    // защита строится вокруг anchorChunkIndex(), а тот при уже потерянном
    // фокусе переходит на вьюпорт. Если такое совпадёт с моментом обрезки,
    // карточка под фокусом может уехать вместе с чанком — ниже поднимем.
    var focusedEl = document.querySelector('#catalog-grid .torrent-card.catalog-card.focused');
    var focusedIdx = focusedEl && focusedEl.dataset
        ? parseInt(focusedEl.dataset.catalogIndex, 10)
        : NaN;

    var removed = 0;
    for (var j = 0; j < live.length && live.length - removed > CHUNK_HYDRATED_KEEP; j++) {
        if (Math.abs(live[j].index - focusIdx) <= CHUNK_FOCUS_GUARD) continue;
        if (dehydrateChunk(live[j])) removed++;
    }

    if (!removed) return;

    if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
    updateGridVisibilityWindow();

    // Самовосстановление фокуса. Экран без фокуса на телевизоре — это
    // намертво: пульт перестаёт что-либо делать, пока не сработает
    // setupFocusRescue. Возвращаем на ту же карточку, а если её чанк всё-таки
    // свернули — на ближайшую живую, но НЕ на первую в каталоге: прыжок
    // в начало списка хуже самой потери.
    var still = document.querySelector('#catalog-grid .torrent-card.catalog-card.focused');
    if (still && still.isConnected) return;

    var target = !isNaN(focusedIdx) ? catalogState.cardElements[focusedIdx] : null;
    if (!target || !target.isConnected) {
        var cards = document.querySelectorAll('#catalog-grid .torrent-card.catalog-card');
        var best = null, bestD = Infinity;
        for (var k = 0; k < cards.length; k++) {
            var n = parseInt(cards[k].dataset.catalogIndex, 10);
            if (isNaN(n)) continue;
            var d = isNaN(focusedIdx) ? k : Math.abs(n - focusedIdx);
            if (d < bestD) { bestD = d; best = cards[k]; }
        }
        target = best;
    }
    if (target && typeof focusEl === 'function') focusEl(target);
}

/**
 * Страховка на шаг вперёд: соседние с фокусом чанки обязаны быть развёрнуты.
 *
 * Разворачиванием вообще-то заведует наблюдатель (CHUNK_OBSERVER_MARGIN_PX даёт
 * запас примерно в три строки), но его колбэк приходит через кадр, а фокус
 * двигается синхронно. Здесь тот же приём, что и с оконной видимостью:
 * сфокусированный элемент готовим сами, не дожидаясь наблюдателя. Зовётся из
 * focusEl → revealCatalogElement на каждое перемещение по сетке, поэтому к
 * следующему нажатию соседний чанк уже на месте.
 */
function ensureChunksAroundFocus(card) {
    realignChunksToColumns();
    var chunks = catalogState.chunks;
    if (!chunks || !chunks.length || !card.dataset) return;

    var idx = parseInt(card.dataset.catalogIndex, 10);
    if (isNaN(idx)) return;

    var size = catalogState.chunkSize || getChunkSize();
    var here = Math.floor(idx / size);
    var grew = false;

    for (var i = here - 1; i <= here + 1; i++) {
        if (i < 0 || i >= chunks.length) continue;
        if (chunks[i].spacer && hydrateChunk(chunks[i])) grew = true;
    }

    if (grew) {
        if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
        updatePosterObservers();
        updateGridVisibilityWindow();
        // Обязательно: развернув чанк, мы увеличили окно, и хвост надо
        // подрезать. Без этого вызова окно только росло — при движении по
        // сетке чанки поднимались один за другим и не сворачивались никогда,
        // потому что обрезку планировали лишь догрузка страницы и наблюдатель.
        scheduleChunkTrim();
    }
}

window.trimGridChunks = trimGridChunks;
// Зовёт ui-customizer сразу после смены настроек внешнего вида: число колонок
// могло измениться, и нарезку надо переложить под новые строки, не дожидаясь
// следующего нажатия пульта.
window.realignCatalogChunks = realignChunksToColumns;

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
    resetGridChunks();
    catalogState.chunkCols = (typeof getColumns === 'function' && getColumns()) || 5;
    catalogState.chunkSize = catalogState.chunkCols * CHUNK_ROWS;
    rebuildChunkRanges();
    initChunkObserver();
    initChunkScrollWatch();
    initPosterLazyLoading();
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
    updateGridVisibilityWindow();
    initLoadMoreObserver();

    // Новая страница — новые чанки; сворачивание отложено до тишины
    rebuildChunkRanges();
    scheduleChunkTrim();

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
        rememberRowEntry(fkey, folder);
        if (fkey === 'history') loadHistoryCatalog();
        else if (fkey === 'favorites') loadFavoritesCatalog();
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
    header.style.cssText = 'grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding:1px 20px;background:rgba(74,158,255,0.1);border-radius:16px;border:1px solid rgba(74,158,255,0.3);flex-wrap:wrap;gap:10px;';
    var name = (CATALOG_CONFIG[catalogState.currentCatalog] && CATALOG_CONFIG[catalogState.currentCatalog].name) || 'Каталог';
    // Фильмографии в CATALOG_CONFIG нет: её имя меняется от актёра к актёру.
    // Ниже по функции идёт запрос к /api/catalogs за датой обновления — для
    // фильмографии там ничего нет и быть не может, поэтому выходим раньше.
    if (catalogState.currentCatalog === 'person') {
        var pname = (catalogState.person && catalogState.person.name) || 'Фильмография';
        header.innerHTML =
            '<div style="display:flex;flex-direction:column;gap:5px">' +
            '<span style="font-size:20px;font-weight:600;color:#4a9eff">' + escapeHtml(pname) + '</span>' +
            '<div style="display:flex;gap:15px;font-size:12px;color:#aaa"><span>фильмы и сериалы с этим актёром</span></div>' +
            '</div>' +
            '<span style="font-size:14px;color:#aaa;background:rgba(0,0,0,0.3);padding:5px 12px;border-radius:20px">' +
            catalogState.items.length + '</span>';
        grid.appendChild(header);
        return;
    }
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

// initPosterUnloading() удалён вместе с catalogState.unloadObserver.
//
// Он выгружал постеры карточек, ушедших дальше 1200px за экран, но вызовы были
// закомментированы в renderCatalogGrid и appendCatalogItems — наблюдатель не
// создавался никогда. При этом функцию продолжали оборачивать патчи из
// catalog-memory-fix.js и memory-fixes.js, а ветки с unloadObserver висели в
// их периодической уборке. Ту же работу сейчас делают оконная видимость
// (initGridVisibilityWindow) и content-visibility: auto в styles.css.
// Если выгрузка снова понадобится — писать её заново, а не воскрешать эту.

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
 * картинки. Сигнал — Animations.isScrollTweening(main-container): он ровно
 * совпадает с «переход идёт» и остаётся false, когда прокрутка мгновенная
 * (duration 0, колесо мыши) — там ждать нечего, поведение прежнее.
 *
 * Первый экран (loadInitialPosters) и допечатка страниц (updatePosterObservers)
 * идут своими путями и не задерживаются: прокрутки в этот момент нет.
 */

/** Идёт ли сейчас твин прокрутки сетки */
function isCatalogScrollAnimating() {
    if (typeof Animations === 'undefined' || typeof Animations.isScrollTweening !== 'function') return false;
    var main = getEl('main-container');
    return !!main && Animations.isScrollTweening(main);
}

/**
 * Навигация по сетке в разгаре: либо едет твин прокрутки, либо кнопку держат.
 * Второе обязательно — твин теперь заканчивается ДО следующего шага серии
 * (шаги притормаживаются под скорость прокрутки, см. navStepUntil в
 * control.js), и по одному лишь isCatalogScrollAnimating постеры влезали бы
 * в каждую паузу между шагами.
 */
function isGridNavBusy() {
    return !!window.navHold || isCatalogScrollAnimating();
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
    // Пользователь ещё едет — ждём и этот шаг, и всю серию
    if (isGridNavBusy()) { scheduleDeferredPosters(); return; }
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
    if (catalogState.posterBatchTimer) {
        clearTimeout(catalogState.posterBatchTimer);
        catalogState.posterBatchTimer = null;
    }
    dropPosterReveals();     // ждущие показа картинки — от прежней сетки
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
                // Навигация идёт — постер ждёт её конца. Не только твина: при
                // зажатой кнопке между шагами есть паузы, в которые прокрутка
                // уже докрутилась, а движение продолжается, и загрузка успевала
                // влезть ровно туда (см. navHold в control.js).
                if (isGridNavBusy()) { deferPosterUntilScrollEnds(idx); continue; }
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

/**
 * Движение возобновилось — очередь ждёт следующей остановки.
 *
 * Таймер один на всю очередь: пока он взведён, повторные вызовы ничего не
 * добавляют, иначе каждая карточка, доехавшая до наблюдателя, заводила бы свой.
 */
function schedulePosterBatchRetry() {
    if (catalogState.posterBatchTimer) return;
    catalogState.posterBatchTimer = setTimeout(function () {
        catalogState.posterBatchTimer = null;
        loadNextPosterBatch();
    }, CATALOG_CONSTANTS.ROW_POSTER_RETRY_MS);
}

function loadNextPosterBatch() {
    if (catalogState.isPosterLoading || catalogState.posterLoadQueue.length === 0) return;

    // Человек снова поехал — новую пачку не начинаем. Раньше проверки здесь не
    // было вовсе: очередь пережидала только первую остановку, а стоило тронуться
    // снова — запросы, ответы и вставки шли прямо поверх прокрутки.
    if (isGridNavBusy()) { schedulePosterBatchRetry(); return; }

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

        // Движение возобновилось посреди пачки: уже запущенное доедет само (его
        // не остановить), а новое не начинаем. Таймер заводим только когда в
        // работе ничего не осталось — иначе повторный вызов придёт из .then()
        // завершившейся загрузки, и насосов стало бы несколько.
        if (ptr < indices.length && isGridNavBusy()) {
            if (active === 0) setTimeout(next, CATALOG_CONSTANTS.ROW_POSTER_RETRY_MS);
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
    // Каталог закрыли, пока постер стоял в очереди. Плашку не рисуем: надпись
    // «Каталог закрыт» доезжала до человека как ошибка на всех карточках сразу,
    // хотя это обычная гонка. Оставляем прежний placeholder — если каталог
    // откроется снова, rearmCatalogObservers() сбросит posterRequested и
    // карточка догрузится.
    if (!catalogState.currentCatalog) return;

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

    // Плейсхолдер-скелет НЕ снимаем здесь. Раньше снимали — и всё время, пока
    // идёт сеть (а это сотни миллисекунд), карточка стояла плоским фоном, после
    // чего постер проявлялся из пустоты. Теперь картинка лежит поверх скелета
    // (position: absolute в styles.css) и проявляется прямо на нём, а скелет
    // снимается уже после перехода — переход читается как кроссфейд.
    var placeholder = div.querySelector('.no-poster');

    // Вставляем сразу
    div.appendChild(img);

    // Само проявление ждёт паузы в навигации и своего кадра — та же очередь,
    // что у рядов. Картинку в DOM кладём сразу (её ищут проверки «постер уже
    // есть» в initPosterLazyLoading и rearmCatalogObservers), но она прозрачна
    // и лежит поверх скелета, так что до показа ничего не стоит.
    img.onload = function () {
        queuePosterReveal(function () {
            if (!img.isConnected) return;
            img.classList.add('loaded');
            if (placeholder) dropPosterPlaceholder(placeholder);
        });
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

/**
 * Скелет под проявившимся постером. Ждём конца перехода — иначе снимать нечего
 * прятать, и кроссфейд превращается обратно во вспышку пустой карточки.
 *
 * По таймеру, а не по transitionend: событие не придёт, если карточку в этот
 * момент погасила оконная видимость (visibility: hidden переход не запускает),
 * и скелет остался бы под постером навсегда.
 */
function dropPosterPlaceholder(placeholder) {
    setTimeout(function () {
        if (placeholder && placeholder.parentNode) placeholder.remove();
    }, CATALOG_CONSTANTS.POSTER_FADE_MS + 60);
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

    // Backdrop через img.decode().
    // item.backdrop_path — обязательный фоллбэк: ответ /details иногда приходит
    // без кадра (обрезанный ответ зеркала, запись из своего кэша), а в самом
    // элементе каталога путь есть. Без него карточка молча оставалась чёрной.
    var bp = src.backdrop_path || (item && item.backdrop_path) ||
        (Array.isArray(src.backdrops) && src.backdrops[0] && src.backdrops[0].file_path);
    if (bp) {
        var bpUrl = getTmdbImageUrl(bp, CATALOG_CONSTANTS.IMG_SIZES.BACKDROP);
        _loadBackdropDecoded(be, bpUrl);
    } else {
        resetDetailBackdrop(be);
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
    video.setAttribute('playsinline', '');
    // Штатные контролы WebView не нужны совсем: на Android TV они и рисуют тот
    // самый значок «плей» во весь экран поверх пустого видео (остальное добивают
    // правила #trailer-bg-video::-webkit-media-controls* в styles.css)
    video.controls = false;
    video.removeAttribute('controls');
    video.setAttribute('disableremoteplayback', '');
    // visibility, а не только opacity: на Android TV видео живёт в отдельном слое,
    // и его собственная отрисовка прозрачность не всегда слушается. Слой снят,
    // пока не появится первый кадр (см. revealVideo ниже).
    video.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;opacity:0;visibility:hidden;pointer-events:none;transition:opacity 10s ease;';

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

    // Показ видео — только когда есть первый кадр, иначе WebView успевает
    // нарисовать поверх пустого элемента свой значок «плей»
    function revealVideo() {
        if (rutubeTrailerState.bgVideo !== video) return;
        video.style.visibility = 'visible';
        video.style.opacity = '1';
    }

    // ★ Нарастание звука — когда видео реально заиграло
    video.addEventListener('playing', function () {
        revealVideo();
        startVolumeFade();
    });
    video.addEventListener('timeupdate', function () {
        // playing на части устройств приходит раньше первого кадра
        if (video.currentTime > 0) revealVideo();
        startVolumeFade();
    });
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
            // Плеер трейлера открывается мимо transitionToPlayerScreen (player.js),
            // поэтому тик буфера заводим здесь
            if (typeof window.startBufferUpdates === 'function') window.startBufferUpdates();

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
// Метка последнего запроса картинки для узла: постер детального просмотра
// грузится в один и тот же #detail-poster, и опоздавший ответ прошлой карточки
// иначе встаёт в уже открытую следующую — та же болезнь, что была у фона
var imageLoadToken = 0;

function _loadImageDecoded(container, src, alt) {
    if (!container || !container.isConnected) return;

    var token = String(++imageLoadToken);
    container.dataset.imgToken = token;

    var img = new Image();
    img.alt = alt || '';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.3s ease';

    function stale() { return container.dataset.imgToken !== token; }

    // Отпускаем картинку, которая никуда не вставится. Вызывать после успешной
    // вставки нельзя: сброс src обнулит уже показанный <img> в DOM
    function release() {
        img.onload = null;
        img.onerror = null;
        img.src = '';
    }

    var insert = function () {
        if (stale() || !container.isConnected) { release(); return; }
        // naturalWidth, а не только факт decode(): на части телевизоров decode()
        // отклоняет живые картинки, а битые, наоборот, доходят до сюда
        if (!img.naturalWidth) {
            release();
            container.innerHTML = '<div class="no-poster">Нет постера</div>';
            return;
        }
        container.innerHTML = '';
        img.style.opacity = '1';
        container.appendChild(img);
    };

    img.onerror = function () {
        var wasStale = stale();
        release();
        if (!wasStale && container.isConnected) container.innerHTML = '<div class="no-poster">Нет постера</div>';
    };
    img.src = src;

    if (typeof img.decode === 'function') {
        img.decode().then(insert).catch(insert);
    } else {
        img.onload = insert;
    }
}

//   Вспомогательная: предзагрузка backdrop с decode(), потом CSS background
//
// Поколение загрузки: открыли другую карточку — ответы прошлой цепочки (а у неё
// несколько попыток по зеркалам) должны молча уйти в никуда. Без этого кадр
// предыдущего фильма догружался поверх новой карточки, иногда через несколько
// секунд после перехода.
var detailBackdropLoad = 0;
var detailBackdropTimer = null;

function _clearDetailBackdropTimer() {
    if (detailBackdropTimer) {
        clearTimeout(detailBackdropTimer);
        detailBackdropTimer = null;
    }
}

/**
 * Убрать фон совсем. backgroundImage чистим обязательно, а не только вешаем
 * .hidden: stopTrailerBackground() безусловно снимает этот класс (и при старте
 * карточки, и когда трейлер отыграл), так что оставленный в стиле URL
 * предыдущего фильма всплывал обратно спустя десяток секунд.
 */
function resetDetailBackdrop(container) {
    var box = container || getEl('catalog-detail-backdrop');
    detailBackdropLoad++;                 // всё, что грузилось до этого, теперь чужое
    _clearDetailBackdropTimer();
    if (!box) return;
    box.classList.add('hidden');
    box.style.backgroundImage = '';
}
window.resetDetailBackdrop = resetDetailBackdrop;

/** Кандидаты на один кадр: сам URL и следующие зеркала того же пути */
function _detailBackdropQueue(url) {
    var out = [];
    if (!url) return out;
    out.push(url);
    var next = url;
    for (var i = 0; i < CATALOG_CONSTANTS.DETAIL_BACKDROP_TRIES - 1; i++) {
        next = getTmdbNextMirrorUrl(next);
        if (!next || out.indexOf(next) !== -1) break;   // не TMDB или круг замкнулся
        out.push(next);
    }
    return out;
}

/**
 * Фон детального просмотра. Кадр может не отдаться (зеркало отвалилось, пришёл
 * битый файл) — тогда пробуем следующие зеркала того же пути, а если молчат и
 * они, убираем фон совсем: чёрный прямоугольник на месте кадра выглядит хуже,
 * чем его отсутствие.
 * Смотрим naturalWidth, а не только факт onload/decode: decode() на части
 * телевизоров отклоняет вполне живые картинки, а на битых, наоборот, попадали
 * в catch — раньше в обоих случаях фон ставился как есть.
 */
function _loadBackdropDecoded(container, url) {
    var queue = _detailBackdropQueue(url);
    resetDetailBackdrop(container);       // заодно поднимает поколение
    // Узел вне документа грузить незачем: картинка приедет в никуда и будет
    // держать память до сборки мусора
    if (!queue.length || !container || !container.isConnected) return;

    var mine = detailBackdropLoad;
    var at = 0;
    var shown = false;

    function tryNext() {
        _clearDetailBackdropTimer();
        if (shown || mine !== detailBackdropLoad) return;
        if (at >= queue.length) return;                // кандидаты кончились — фон уже убран

        var candidate = queue[at++];
        var img = new Image();

        // Отпускаем неудачную попытку: без сброса src декодированный кадр
        // (1280px) висит в памяти до сборки мусора, а на ТВ таких попыток
        // накапливается по нескольку на каждую открытую карточку
        function release() {
            img.onload = null;
            img.onerror = null;
            img.src = '';
        }

        function finish() {
            if (shown || mine !== detailBackdropLoad) { release(); return; }
            if (!img.naturalWidth) { release(); tryNext(); return; }   // битый файл
            if (!container.isConnected) { release(); return; }
            shown = true;
            _clearDetailBackdropTimer();
            container.style.backgroundImage = 'url(' + candidate + ')';
            // Пока играет фоновый трейлер, backdrop лежит под .hidden намеренно
            // (startTrailerBackground) — класс снимет stopTrailerBackground
            if (!rutubeTrailerState.bgVideo) container.classList.remove('hidden');
        }

        img.onerror = function () { release(); tryNext(); };
        img.onload = function () {
            // Смотрим naturalWidth, а не только факт decode(): на части
            // телевизоров decode() отклоняет вполне живые кадры, и наоборот
            if (typeof img.decode === 'function') img.decode().then(finish).catch(finish);
            else finish();
        };
        img.src = candidate;

        // Зеркало может не ответить вообще — ни load, ни error. Не ждём его
        // вечно; опоздавший ответ ещё успеет показаться, у finish() проверка на
        // shown, а не «моя ли это попытка».
        detailBackdropTimer = setTimeout(tryNext, CATALOG_CONSTANTS.DETAIL_BACKDROP_GRACE_MS);
    }

    tryNext();
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
            // id и имя нужны обработчику нажатия: он открывает фильмографию
            // (см. setupDetailDelegation → loadPersonCatalog)
            if (a.id) d.dataset.personId = a.id;
            d.dataset.personName = a.name || '';
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
        // Клик по актёру — уходим из карточки в сетку с его фильмографией
        var actorCard = e.target.closest('.catalog-actor-card');
        if (actorCard && actorCard.dataset.personId) {
            openPersonCatalog(actorCard.dataset.personId, actorCard.dataset.personName);
            return;
        }
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
/**
 * Та же карточка сейчас открыта или пользователь успел уйти в другую?
 *
 * showCatalogDetail ждёт /details и актёров, а всё, что после await, пишет в
 * ОБЩИЙ #detail-view. Успел выйти и открыть соседний фильм — и опоздавший ответ
 * первой карточки затирал заголовок, постер, описание и фон уже открытой
 * второй. Экран специально не проверяем: из карточки можно уйти в поиск
 * торрентов, и там дорисовать её содержимое как раз нужно — вернёмся мы в неё же.
 */
function isDetailStillCurrent(item) {
    var cur = AppState.currentDetailItem;
    if (!cur || !item) return false;
    if (cur === item) return true;
    return item.id != null && String(cur.id) === String(item.id);
}

async function showCatalogDetail(item, index, posterUrl) {
    var layout = setupDetailLayout(item, index, posterUrl);
    var dv = layout.dv, mc = layout.mc, aw = layout.aw, rw = layout.rw, savedScroll = layout.savedScroll;
    var title = getCatalogItemTitle(item), mt = item.media_type || 'movie';
    // Режим раскладки. Под .catalog-detail-mode в styles.css лежит вся адаптация
    // каталожной карточки под 1920 / 1280x720 / 1024 / 960x540, под
    // .torrent-detail-mode — раскладка торрентной. Класс ставит и
    // visibleItemsforDetail('showCatalogDetail'), но на ТВ может раздаваться его
    // старая сборка, поэтому дублируем здесь: без класса вернётся старая вёрстка.
    dv.classList.add('catalog-detail-mode');
    dv.classList.remove('torrent-detail-mode');
    // Фон прошлой карточки убираем сразу, а не в renderDetailHeader: тот ждёт
    // ответа fetchCatalogItemDetails, и всё это время открытая карточка стояла
    // на кадре предыдущего фильма. Вместе с кадром снимается и его цепочка
    // загрузки — догрузиться поверх новой карточки она уже не сможет.
    resetDetailBackdrop();
    AppState.currentDetailItem = item;
    AppState.currentScreen = 'detail';
    AppState.detailReturnTo = 'catalog';
    if (typeof Animations !== 'undefined') Animations.animateDetailShow();
    dv.style.pointerEvents = 'auto';
    if (mc) mc.style.pointerEvents = 'none';
    if (typeof window.hideCatalogDetailExtra === 'function') window.hideCatalogDetailExtra();
    if (typeof window.visibleItemsforDetail === 'function') window.visibleItemsforDetail('showCatalogDetail');
    var wb = getEl('catalog-watch-btn');
    // Звёздочка не ждёт ответа TMDB: id и media_type известны сразу из элемента
    setupFavoriteButton(item);
    if (aw) aw.classList.add('hidden');
    if (rw) rw.classList.add('hidden');
    if (wb) {
        var knownPoster = getCatalogKnownPosterUrl(item, posterUrl);

        wb.onclick = function () {
            AppState.currentScreen = 'search';
            AppState.isSearch = false;

            // Карточку прячем ТОЛЬКО когда поиск что-то нашёл. Раньше её гасили
            // сразу, синхронно с запуском поиска, — и при пустом ответе (или
            // недоступном Jacred) человек оставался на пустом экране поиска без
            // возможности вернуться к фильму иначе как кнопкой «назад».
            // Пока идёт поиск, карточка остаётся на месте: оверлей поиска лежит
            // выше неё (z-index 1000 против 100) и всё равно её закрывает.
            showCatalogSearch(wb.dataset.searchTitle || title, knownPoster, item)
                .then(function (found) {
                    if (found > 0) {
                        dv.style.display = 'none';
                        dv.style.pointerEvents = 'none';
                        if (mc) mc.style.pointerEvents = 'auto';
                        return;
                    }

                    // Ничего не нашли — возвращаем человека в карточку фильма
                    var so = getEl('search-overlay');
                    if (so) so.classList.add('hidden');
                    AppState.currentScreen = 'detail';
                    AppState.searchReturnTo = null;
                    dv.style.display = 'block';
                    dv.style.pointerEvents = 'auto';
                    if (mc) mc.style.pointerEvents = 'none';

                    if (typeof window.showErrorBanner === 'function') {
                        window.showErrorBanner('Торренты не найдены',
                            'По запросу «' + (wb.dataset.searchTitle || title) + '» ничего нет');
                    }
                    // Фокус обратно в карточку, иначе он остаётся на сетке
                    // каталога под ней и пульт управляет не тем, что видно
                    setTimeout(function () {
                        if (window.ScreenStrategies && ScreenStrategies.detail &&
                            typeof ScreenStrategies.detail.ensureFocus === 'function') {
                            ScreenStrategies.detail.ensureFocus(true);
                        }
                    }, 80);
                });
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
    if (!isDetailStillCurrent(item)) return;   // пока ждали, открыли другую карточку
    restore();
    renderDetailHeader(item, posterUrl, details);

    // Ждём актёров (уже загружаются параллельно с деталями)
    var actors = await actorsPromise;
    if (!isDetailStillCurrent(item)) return;
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
    // Фильмография помнит открытую карточку у себя: localStorage один на все
    // категории, и после захода в другую сетку возврат в эту вернул бы чужую
    // позицию
    if (catalogState.currentCatalog === 'person' && catalogState.person) {
        catalogState.person.lastIndex = index;
        catalogState.person.lastId = item.id;
    }
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
        // Запрос задан карточкой — править его нельзя, иначе к найденному
        // прикрепится TMDB-контекст совсем другого фильма (см. setSearchLocked)
        if (typeof window.setSearchLocked === 'function') window.setSearchLocked(true, q);
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

        // Возвращаем промис с числом найденного: вызывающая сторона (кнопка
        // «Торренты» в карточке) прячет detail-view только если искать было что.
        var searching = Promise.resolve(0);
        if (typeof window.searchTorrentsLegacy === 'function') {
            var tm = getEl('torrent-movie');
            if (tm) tm.value = 'torrentsearch';
            searching = Promise.resolve(window.searchTorrentsLegacy(q))
                .then(function (n) { return typeof n === 'number' ? n : 0; })
                .catch(function () { return 0; });
        }
        setTimeout(function () {
            if (typeof window.focusSearchHome === 'function') window.focusSearchHome(true);
        }, 200);
        return searching;
    }
    return Promise.resolve(0);
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
            // Плеер трейлера открывается мимо transitionToPlayerScreen (player.js),
            // поэтому тик буфера заводим здесь
            if (typeof window.startBufferUpdates === 'function') window.startBufferUpdates();
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

        // Звёздочку могли нажимать в карточке — ряд «Избранное» пересобираем
        // здесь, один раз на возврат, а не на каждое нажатие. Ждём до
        // восстановления фокуса: иначе restoreRowFocus искал бы карточку в
        // ряду, который вот-вот заменят.
        await refreshFavoritesRow();

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
    if (key === 'favorites') return await loadFavoritesItems(LIMIT);
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
        rememberRowEntry(key, null);
        if (key === 'history') loadHistoryCatalog();
        else if (key === 'favorites') loadFavoritesCatalog();
        else loadCatalog(key);
    });
    row.appendChild(header);

    // Карусель: вьюпорт прокручивается нативно по scrollLeft, трек — просто
    // флекс-лента с отступами. Позицию читают/пишут getScrollX / setScrollX
    // (control.js).
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
    if (cached) { await setRowPosterImg(imgBox, cached, true); return; }

    if (item.poster_path) {
        // Размер — getPosterCardSize(), как в сетке: тогда URL совпадает
        // с тем, что уже лежит в posterCache, и setRowPosterImg не пересобирает его.
        var url = getTmdbImageUrl(item.poster_path, getPosterCardSize());
        catalogState.posterCache.set(cacheKey, url);
        await setRowPosterImg(imgBox, url, true);
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

                if (card.isConnected) await setRowPosterImg(imgBox, url2, true);

                return;
            }
        } catch (e) { }
    }

    if (card.isConnected) imgBox.innerHTML = '<div class="no-poster">Нет постера</div>';
}

/**
 * Постер карточки, на которую только что встал фокус, — вне очереди и вне
 * пейсинга. Пока пользователь листает, processRowPosterQueue стоит (см. там же),
 * и без этой врезки фокус ехал бы по пустым рамкам. Один постер на нажатие
 * потянет любой телевизор, а очередь доберёт остальные, когда навигация утихнет.
 *
 * Зовётся из revealCatalogElement, то есть из focusEl (control.js) — ровно там,
 * где с карточки уже снимается оконное погашение.
 *
 * Но не сразу: сначала фокус переезжает и докручивается карусель, и только потом
 * вставляется картинка. Раньше загрузка стартовала здесь же, параллельно твину,
 * и вставка (замена содержимого бокса 260×460 внутри анимируемого слоя) попадала
 * ровно в середину анимации — те самые микрофризы на горизонтальной прокрутке.
 * Ждём по тем же условиям, что и общая очередь: твин докрутился и кнопку не держат.
 */
function ensureRowPosterNow(card) {
    if (!card || !card.classList || !card.classList.contains('catalog-row-card')) return;
    // Карточки главной тоже .catalog-row-card, но ключ у них свой (data-home-key)
    // и грузит их home.js — сюда они попадать не должны.
    if (!card.dataset.catalogKey) return;
    if (card.dataset.posterStarted === '1') return;      // загрузка уже идёт

    // Одна карточка в ожидании: ушли дальше — прежнюю доберёт очередь, она из
    // неё не вынималась. Ноль в задержке не для красоты: твин карусели запускает
    // focusEl уже ПОСЛЕ этого вызова, и без отступа проверять было бы нечего.
    catalogState.focusPosterCard = card;
    scheduleFocusRowPoster(0);
}

function scheduleFocusRowPoster(delay) {
    if (catalogState.focusPosterTimer) clearTimeout(catalogState.focusPosterTimer);
    catalogState.focusPosterTimer = setTimeout(function () {
        catalogState.focusPosterTimer = null;
        var card = catalogState.focusPosterCard;
        if (!card) return;
        if (!card.isConnected) { catalogState.focusPosterCard = null; return; }
        if (isRowScrollAnimating() || window.navHold) {
            scheduleFocusRowPoster(CATALOG_CONSTANTS.ROW_POSTER_RETRY_MS);
            return;
        }
        catalogState.focusPosterCard = null;
        loadFocusRowPoster(card);
    }, delay);
}

function loadFocusRowPoster(card) {
    if (card.dataset.posterStarted === '1') return;
    var key = card.dataset.catalogKey;
    if (!key) return;

    var box = card.querySelector('.row-poster-img');
    if (!box || box.querySelector('img')) return;        // постер уже на месте

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
    dropPosterReveals();
    if (catalogState.rowPosterQueueTimer) {
        clearTimeout(catalogState.rowPosterQueueTimer);
        catalogState.rowPosterQueueTimer = null;
    }
    if (catalogState.focusPosterTimer) {
        clearTimeout(catalogState.focusPosterTimer);
        catalogState.focusPosterTimer = null;
    }
    catalogState.focusPosterCard = null;

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
            // Карточку берём под наблюдение заново, значит прежняя попытка
            // загрузки не в счёт (её могли обнулить вместе с очередью —
            // см. rearmCatalogObservers в catalog-memory-fix.js).
            cards[i].dataset.posterStarted = '0';
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

/**
 * Переключения оконной видимости, дождавшиеся конца навигации.
 *
 * Снятие класса возвращает в отрисовку целый ряд — семь карточек 260×460 плюс
 * заголовок. Посреди твана перехода это скачок на несколько кадров, а спешить
 * незачем: ряд, куда встал фокус, показывает сам revealCatalogElement (его
 * зовёт focusEl синхронно с перемещением фокуса), а всё остальное — запас
 * вперёд, который никто в этот момент не видит.
 */
var visibilityPending = [];
var visibilityFlushTimer = null;

function queueVisibilityToggle(el, show) {
    for (var i = 0; i < visibilityPending.length; i++) {
        // Последнее слово за свежей записью: ряд мог войти и выйти за одну пачку
        if (visibilityPending[i].el === el) { visibilityPending[i].show = show; return; }
    }
    visibilityPending.push({ el: el, show: show });
}

function flushVisibilityToggles() {
    if (!visibilityPending.length) return;

    if (window.navHold || isRowScrollAnimating()) {
        if (visibilityFlushTimer) return;
        visibilityFlushTimer = setTimeout(function () {
            visibilityFlushTimer = null;
            flushVisibilityToggles();
        }, CATALOG_CONSTANTS.ROW_POSTER_RETRY_MS);
        return;
    }

    var list = visibilityPending;
    visibilityPending = [];
    for (var i = 0; i < list.length; i++) {
        if (!list[i].el.isConnected) continue;
        if (list[i].show) list[i].el.classList.remove(OFFSCREEN_CLASS);
        else list[i].el.classList.add(OFFSCREEN_CLASS);
    }
}

/** Позиция скролла сброшена — отложенные решения посчитаны для старой и не годятся */
function dropPendingVisibilityToggles() {
    if (visibilityFlushTimer) { clearTimeout(visibilityFlushTimer); visibilityFlushTimer = null; }
    visibilityPending.length = 0;
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
            queueVisibilityToggle(el, entries[i].isIntersecting);
        }
        flushVisibilityToggles();
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

    // Ряд и его постер есть только в режиме рядов. В сетке категории closest()
    // всё равно поднимался до корня и всегда возвращал null, а звалось это из
    // focusEl на каждое перемещение фокуса.
    if (!el.classList.contains('catalog-row-card')) {
        ensureChunksAroundFocus(el);
        return;
    }

    var row = el.closest ? el.closest('.catalog-row') : null;
    if (row) row.classList.remove(OFFSCREEN_CLASS);
    ensureRowPosterNow(el);
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
    dropPendingVisibilityToggles();
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
    dropPendingVisibilityToggles();     // решения от прежней позиции скролла
    var rows = document.querySelectorAll('#catalog-rows .catalog-row');
    for (var i = 0; i < rows.length; i++) rows[i].classList.remove(OFFSCREEN_CLASS);
}

window.revealCatalogElement = revealCatalogElement;
window.initRowVisibilityWindow = initRowVisibilityWindow;
window.initGridVisibilityWindow = initGridVisibilityWindow;
window.measureCatalogCardHeight = measureCatalogCardHeight;   // зовёт ui-customizer после смены настроек

/**
 * Идёт ли прокрутка, задевающая ряды. Два источника: вертикальный тван
 * scrollTop у #main-container (переход на другой ряд) и горизонтальный тван
 * scrollLeft той карусели, где сейчас фокус (движение внутри ряда). Вьюпорт
 * проверяем только у сфокусированного ряда — остальные при навигации не
 * двигаются.
 */
function isRowScrollAnimating() {
    if (isCatalogScrollAnimating()) return true;
    if (typeof Animations === 'undefined' || typeof Animations.isScrollTweening !== 'function') return false;
    var f = document.querySelector('#catalog-rows .catalog-row-card.focused');
    var vp = (f && f.closest) ? f.closest('.catalog-row-viewport') : null;
    return !!vp && Animations.isScrollTweening(vp);
}

/**
 * Обрабатывает очередь: не более ROW_POSTER_CONCURRENCY загрузок одновременно.
 * Как только одна завершается (загрузка + декод), берётся следующая.
 *
 * Пока идёт навигация, очередь стоит — тем же приёмом, что и у сетки
 * (deferPosterUntilScrollEnds): вставка постера это замена содержимого бокса и
 * перерисовка карточки 260×460, а несколько таких посреди твана ряда и есть те
 * самые фризы. Ждём двух условий: тван прокрутки докрутился и кнопку навигации
 * не держат (navHold в control.js) — иначе при зажатой кнопке пульта постеры
 * вставлялись бы в паузах между твинами. Карточку под фокусом это не
 * задерживает: её тянет ensureRowPosterNow вне очереди.
 */
function processRowPosterQueue() {
    if (!catalogState.rowPosterQueue || !catalogState.rowPosterQueue.length) return;

    if (window.navHold || isRowScrollAnimating()) {
        if (catalogState.rowPosterQueueTimer) return;        // ожидание уже заведено
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

/**
 * Очередь ПОЯВЛЕНИЯ готовых постеров — общая для рядов и сетки категории.
 *
 * Очереди загрузки (processRowPosterQueue у рядов, posterDeferred у сетки)
 * придерживают только СТАРТ. Между стартом и готовностью картинки проходят
 * сотни миллисекунд сети, поэтому пачка, ушедшая в работу во время паузы,
 * приезжала ровно посреди следующего движения — и показывалась без всяких
 * проверок. А показ это декод и paint постера в полкарточки поверх
 * прокручивающегося контейнера, то есть тяжёлый кадр прямо во время перехода.
 * Отсюда и оставались фризы «особенно когда подгружаются постеры»: сам скролл
 * уже нативный и дешёвый, дорогой была работа поверх него.
 *
 * Поэтому готовый постер ждёт здесь двух вещей: тишины в навигации (те же
 * условия, что у очередей загрузки — твин прокрутки докрутился И кнопку не
 * держат) и своего кадра: показываем по одному с интервалом
 * POSTER_INSERT_GAP_MS, иначе десяток разом завершившихся загрузок снова
 * сложился бы в один кадр.
 *
 * Картинка к этому моменту уже скачана, так что задержка ничего не грузит
 * заново — она только выбирает момент, когда тронуть экран.
 */
var posterReveals = [];
var posterRevealTimer = null;

function queuePosterReveal(insert) {
    posterReveals.push(insert);
    if (!posterRevealTimer) pumpPosterReveals();
}

function pumpPosterReveals() {
    posterRevealTimer = null;
    if (!posterReveals.length) return;

    // isRowScrollAnimating годится и для сетки: там нет сфокусированной карточки
    // ряда, и проверка сводится к вертикальному твину #main-container — ровно
    // тому, что двигает сетку.
    //
    // Предохранителя по времени здесь больше нет, и он не нужен: оба условия
    // гаснут сами. navHold — через NAV_HOLD_IDLE_MS тишины, а у твина есть срок
    // по стенным часам (endAt в Animations), поэтому остановка кадров его не
    // «заморозит». С gsap.isTweening было иначе, и просроченную вставку
    // приходилось пропускать силой — а это давало залп постеров посреди
    // долгого удержания, ради устранения которого всё и заведено.
    if (window.navHold || isRowScrollAnimating()) {
        posterRevealTimer = setTimeout(pumpPosterReveals, CATALOG_CONSTANTS.ROW_POSTER_RETRY_MS);
        return;
    }

    var run = posterReveals.shift();
    try { run(); } catch (e) { }

    if (posterReveals.length) {
        posterRevealTimer = setTimeout(pumpPosterReveals, CATALOG_CONSTANTS.POSTER_INSERT_GAP_MS);
    }
}

/** Ряды пересобраны — ждущие вставки указывают на оторванные боксы */
function dropPosterReveals() {
    if (posterRevealTimer) { clearTimeout(posterRevealTimer); posterRevealTimer = null; }
    posterReveals.length = 0;
}

/**
 * @param {boolean} [deferDuringNav] придержать вставку до паузы в навигации.
 *        Ставят только ряды каталога: на главной постеры ряда грузятся разом при
 *        его переключении, горизонтальное движение их не задевает, и придержка
 *        там только оставила бы пустые рамки под фокусом.
 */
function setRowPosterImg(box, url, deferDuringNav) {
    return new Promise(function (resolve) {
        // URL уже собран под нужный размер (быстрый путь, posterCache) — не
        // пересобираем, как и в updatePosterDOM: лишний разбор строки, а раньше
        // это ещё и меняло зеркало.
        var size = getPosterCardSize();
        if (url && url.indexOf('/t/p/' + size + '/') === -1) {
            url = getTmdbImageUrl(url, size);
        }
        // Геометрия и переход — в styles.css (.row-poster-img > img), там же,
        // где у сетки. Инлайн тут был со своей копией правил, и одна из них
        // (opacity) ниже гасилась раньше вставки, см. insert.
        var img = new Image();
        img.decoding = 'async';
        var settled = false;
        var settle = function () { if (!settled) { settled = true; resolve(); } };

        // Промис резолвится ПОСЛЕ вставки, а не по готовности картинки: на нём
        // висит счётчик activeRowPosterLoads, и пока вставки ждут паузы, слоты
        // очереди заняты — новых загрузок посреди движения не начнётся.
        var whenIdle = deferDuringNav ? queuePosterReveal : function (fn) { fn(); };

        var insert = function () {
            whenIdle(function () {
                if (box.isConnected && img.naturalWidth > 0) {
                    // Скелет остаётся под картинкой до конца проявления — тот же
                    // кроссфейд, что и в сетке (см. updatePosterDOM)
                    var placeholder = box.querySelector('.no-poster');
                    box.appendChild(img);

                    // Принудительный пересчёт фиксирует стартовое состояние
                    // (opacity: 0 из CSS). Без него браузер схлопывает вставку и
                    // смену класса в одно вычисление, перехода не происходит — на
                    // этом и держалась прежняя вставка, где постер просто возникал.
                    // Именно reflow, а не requestAnimationFrame: кадры может не
                    // быть вовсе (приложение свернули), и картинка осталась бы
                    // прозрачной до возвращения.
                    void img.offsetWidth;
                    img.classList.add('loaded');

                    if (placeholder) dropPosterPlaceholder(placeholder);
                }
                settle();
            });
        };
        var fail = function () {
            whenIdle(function () {
                if (box.isConnected) box.innerHTML = '<div class="no-poster">Нет постера</div>';
                settle();
            });
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
/**
 * Запоминает, из какого ряда ушли в категорию.
 *
 * Раньше lastSelectedRowKey писал только onRowItemClick — то есть клик по
 * фильму внутри ряда. Вход в саму категорию (карточка «Показать все» или
 * заголовок ряда) ничего не запоминал, и возврат всегда ставил фокус на первую
 * карточку первого ряда: ушёл в «Сериалы» — вернулся в «Фильмы».
 *
 * col = 'showall' — вернуться на ту же карточку «Показать все», а не в начало
 * ряда: карусель тогда не отматывается к первому элементу.
 */
function rememberRowEntry(key, card) {
    if (!key) return;
    catalogState.lastSelectedRowKey = key;
    catalogState.lastSelectedColIndex =
        (card && card.classList && card.classList.contains('catalog-show-all')) ? 'showall' : null;
}

function restoreRowFocus() {
    var savedKey = catalogState.lastSelectedRowKey;
    var savedCol = catalogState.lastSelectedColIndex;
    catalogState.lastSelectedRowKey = 0;
    catalogState.lastSelectedColIndex = 0;

    if (savedKey != null) {
        // 0) Вернулись из категории, куда ушли по «Показать все» — на неё же
        if (savedCol === 'showall') {
            var sa = document.querySelector(
                '.catalog-show-all[data-catalog-key="' + savedKey + '"]'
            );
            if (sa && sa.offsetParent !== null) { focusRowCardByElement(sa); return; }
        }
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

// ==================== НАВИГАЦИЯ ПО РЯДАМ — ЖИВЁТ В control.js ====================
//
// Здесь были свои focusRowCard / findRowPosition / handleRowsNavigation /
// scrollRowToCard. Все четыре — обычные function-декларации в глобальной
// области, и control.js объявляет их же под теми же именами. Он грузится
// позже (index.html), поэтому его версии перекрывали наши: код был мёртвым,
// но при чтении выглядел работающим, а правки в нём ни на что не влияли.
// Отличие версий существенное: control.js берёт ряды из getCatalogRows() с
// кэшем по поколению DOM, здешние читали window.catalogRows.
//
// Вместе с ними убран setupCatalogRowsNavigation() — он патчил
// ScreenStrategies.catalog, но не вызывался ниоткуда. Патч и не был нужен:
// ScreenStrategies.catalog.handleNavigation сам разбирает режим рядов через
// isCatalogRowsMode(). А его ensureFocus звал focusRowCard(0, 0) без третьего
// аргумента rows — версия из control.js на !rows молча возвращает true, так что
// фокус в рядах не восстанавливался бы вовсе, если бы функция работала.
//
// window.catalogRows по-прежнему заполняется createCatalogRow() и читается
// showCatalogList() как признак «ряды уже собраны».

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
    // Назад по пути экскурсии по актёрам: снимаем последний шаг и
    // возвращаемся в карточку, из которой ушли к этому актёру.
    if (catalogState.currentCatalog === 'person' &&
        catalogState.personTrail && catalogState.personTrail.length &&
        typeof showCatalogDetail === 'function') {

        var step = catalogState.personTrail.pop();
        var root = catalogState.personRoot;

        abortCatalogRequests();

        // Какой фильмографии принадлежала та карточка — в неё же уйдёт
        // следующее «назад» из неё. Элементы чистим обязательно: в сетке
        // лежит содержимое той фильмографии, из которой мы сейчас уходим, и
        // без сброса быстрый путь возврата показал бы чужую.
        catalogState.person = step.person || null;
        catalogState.items = [];
        catalogState.cardElements = {};
        catalogState.currentCatalog = step.person ? 'person' : null;
        AppState.backCurrentCatalog = step.person
            ? 'person'
            : ((root && root.realCatalog) || '');

        // Экскурсия началась не с сетки категории, а с рядов-каруселей или с
        // главной — возвращаться некуда: ключа категории нет, и loadCatalog('')
        // в app.js (restoreFocusAfterNavigation) выходит на первой же строке.
        // Без переключения вида на экране осталась бы сетка фильмографии при
        // закрытом состоянии каталога (currentCatalog = null, items пуст):
        // постеры не грузятся и пишут «Каталог закрыт», а «назад» из карточки
        // ставит фокус на её осиротевшие карточки — состояние, из которого
        // пульт уже не выбирается. Ряды же делают isCatalogRowsMode() честным,
        // и возврат из карточки уходит в restoreRowFocus().
        if (!step.person && !AppState.backCurrentCatalog &&
            typeof showCatalogRowsView === 'function') {
            showCatalogRowsView();
        }

        // Путь кончился — приложение возвращается к своим флагам, и следующее
        // «назад» из карточки уйдёт туда, откуда экскурсия начиналась
        if (!catalogState.personTrail.length && root) {
            if (window.HomeScreen && HomeScreen.state) HomeScreen.state.detailFromHome = root.fromHome;
            AppState.isSearch = root.isSearch;
            AppState.inSearch = root.inSearch;
            AppState.detailReturnTo = root.detailReturnTo;
            // Позицию в категории тоже возвращаем: за экскурсию её перетёрли
            catalogState.lastSelectedIndex = root.lastIndex || 0;
            catalogState.lastSelectedId = root.lastId || null;
            try {
                if (root.storedIndex === null || root.storedIndex === undefined) {
                    localStorage.removeItem('lastCatalogCardIndex');
                } else {
                    localStorage.setItem('lastCatalogCardIndex', root.storedIndex);
                }
            } catch (e) { }
            catalogState.personRoot = null;
        }

        if (step.item) {
            showCatalogDetail(step.item, step.index, null);
            return;
        }
        // Карточки в шаге нет — уходим обычным путём, в список категорий
    }

    abortCatalogRequests();
    // Выход в список категорий заканчивает экскурсию целиком
    catalogState.personTrail = [];
    catalogState.personRoot = null;
    catalogState.person = null;
    if (AppState.backCurrentCatalog === 'person') AppState.backCurrentCatalog = '';
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
// window.loadMoreAndFocus() удалён — вызовов не было ни в одном модуле.
// Догрузку по «вниз» из последнего ряда делает ScreenStrategies.catalog
// (control.js), а по скроллу — initLoadMoreObserver ниже.

window.checkAndLoadMoreOnNavigation = function () {
    if (catalogState.currentCatalog && catalogState.hasMore && !catalogState.isLoadingMore) {
        loadMoreCatalogItems().then(function () {
            var t = getEl('load-more-trigger');
            if (t) { var s = t.querySelector('.loading-spinner-small'); if (s) s.style.display = 'none'; }
        });
    }
};

/**
 * Ставит фокус на карточку сетки по её num_index (его пишет onCatalogItemClick
 * в localStorage.lastCatalogCardIndex).
 *
 * Раньше функция считала индекс и просто возвращала его, никого не фокусируя —
 * при том, что зовут её именно ради фокуса (torrents.js, возврат в каталог из
 * поиска / деталей) и возвращённое значение там отбрасывают. Поэтому по этому
 * маршруту фокус в каталог не возвращался вовсе.
 *
 * @returns {boolean} удалось ли сфокусировать карточку
 */
window.focusCatalogCardByIndex = function (target) {
    if (AppState.currentScreen !== 'catalog') return false;

    var cards = document.querySelectorAll('#catalog-grid .torrent-card.catalog-card');
    if (!cards.length) return false;

    var idx = -1;
    if (!isNaN(target)) {
        for (var i = 0; i < cards.length; i++) {
            if (cards[i].dataset.numIndex && parseInt(cards[i].dataset.numIndex, 10) === target) { idx = i; break; }
        }
        // num_index не совпал ни с одной карточкой — пробуем как порядковый номер
        if (idx === -1 && target >= 0 && target < cards.length) idx = target;
    }
    if (idx === -1) idx = 0;

    var card = cards[idx];
    if (!card || card.offsetParent === null) return false;

    if (typeof updateFocusableElements === 'function') updateFocusableElements();
    var gi = (typeof focusableElements !== 'undefined') ? focusableElements.indexOf(card) : -1;
    if (gi !== -1 && typeof setFocus === 'function') { setFocus(gi); return true; }
    if (typeof focusEl === 'function') { focusEl(card); return true; }
    return false;
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

var catalogInited = false;

function initCatalog() {
    // Два обработчика DOMContentLoaded: свой (внизу файла) и ещё один в
    // catalog-worker-patch.js — тот подменяет initCatalog обёрткой, но наш
    // слушатель держит ссылку на исходную функцию, поэтому тело звалось дважды
    // (лишнее чтение PosterDB на старте). CatalogWorker.init() остаётся в
    // обёртке и от этой проверки не страдает.
    if (catalogInited) return;
    catalogInited = true;

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
// Публичный фасад. Функции берутся через window В МОМЕНТ ВЫЗОВА, а не
// защёлкиваются здесь: этот файл выполняется раньше catalog-worker-patch.js и
// catalog-idb-patch.js, которые переопределяют loadCatalog и showCatalogList.
// Прямые ссылки держали исходные версии, и вход в каталог через этот фасад
// пошёл бы мимо IndexedDB — со старой постраничной загрузкой из сети.
window.catalog = {
    loadCatalog: function (key) { return window.loadCatalog(key); },
    showCatalogList: function (force) { return window.showCatalogList(force); },
    backToCatalogList: function () { return window.backToCatalogList(); },
    tmdbCache: { clear: clearTmdbCache, stats: getTmdbCacheStats }
};
window.showCatalogDetail = showCatalogDetail;
window.detailHistory = detailHistory;
window.clearDetailHistory = clearDetailHistory;
