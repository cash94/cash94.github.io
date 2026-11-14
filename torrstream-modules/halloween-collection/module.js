// module.js — Модуль «Хэллоуин» (halloween-collection)
//
// Сезонная подборка: всё, что на TMDB помечено ключевым словом «halloween»
// (id 3335). Отдельной праздничной подборки у TMDB нет: коллекция
// «Хэллоуин» (91361) — это франшиза про Майкла Майерса, а не тематика.
//
// Отдаёт два вида данных:
//   /api/halloween/collection — ряд главной, 20 карточек, формат как у
//     /api/tmdb/collection (routes/tmdb.js), с логотипами названий;
//   /api/halloween, /api/halloween/items — категория каталога целиком, формат
//     как у /api/rus (модуль rus-catalog) и /api/catalog/:name/items.
//
// Когда показывать, решает фронт (SEASONS в public/js/config.js): ряд и
// категория появляются только в сезон. Модуль отвечает всегда — так конец
// сезона не зависит от того, обновился ли модуль на конкретном сервере.
// Сам модуль в межсезонье только не прогревает подборку.
//
// Торрента у карточек нет (в отличие от каталогов парсера): детальный
// просмотр ищет раздачи по названию, как у рядов Кинопоиска на главной.

var TMDB_KEYWORD = 3335;

// Порог голосов отсекает безвестные фильмы, у которых ключевое слово есть, а
// зрителей нет. Для каталога он мягче (там «всё»), для ряда главной — строже:
// двадцать карточек на виду должны быть узнаваемыми. У сериалов порог выше:
// с меньшим числом голосов там одни спецвыпуски ситкомов.
var CATALOG_MIN_VOTES_MOVIE = 50;
var CATALOG_MIN_VOTES_TV = 100;
var HOME_MIN_VOTES = 200;
var HOME_LIMIT = 20;
// Популярность сериалов у TMDB раздута относительно фильмов: при общей
// сортировке первые страницы каталога были бы сплошь сериалами, вплоть до
// «Семейки монстров» 1964 года. Поэтому в каталоге они вставлены через
// равные промежутки — один на столько фильмов.
var CATALOG_MOVIES_PER_TV = 4;
// TMDB отдаёт discover страницами по 20; ~450 фильмов — это 23 страницы.
// Предел — страховка, если тег вдруг расползётся.
var MAX_PAGES = 40;

// Подборка меняется медленно, и пересобирать её чаще раза в сутки незачем
var TTL_MS = 24 * 60 * 60 * 1000;
var TMDB_CONCURRENCY = 6;
var FETCH_TIMEOUT_MS = 15000;
// Прогрев после старта, чтобы первый заход на Главную не ждал сборку в
// запросе (клиент ждёт ряд 10 с). Задержка — не мешать каталогам сервера.
var WARMUP_DELAY_MS = 20000;
// Прогреваем только около сезона (месяц 0–11, день): с 1 октября по 10 ноября
var WARMUP_FROM = [9, 1];
var WARMUP_TO = [10, 10];

// Зеркала TMDB на случай сервера без ctx.tmdbGet — тот же apiproxy.json,
// откуда их читает сервер (services/api-proxy.js) и kinopoisk-collections
var APIPROXY_URL = 'https://cash94.github.io/apiproxy.json';
var DEFAULT_TMDB_KEY = '064ea5b59beec7eccb3fe99059d58a50';
var DEFAULT_TMDB_MIRRORS = [
    { api: 'http://tsapi.torrstream.online', key: DEFAULT_TMDB_KEY },
    { api: 'http://nmapi.duckdns.org', key: DEFAULT_TMDB_KEY }
];
var mirrorList = null;
var serverTmdbGet = null;

// { ts, catalog: [...], home: [...] }
var cache = null;
var inflight = null;
var timers = [];
var destroyed = false;

// ==================== УТИЛИТЫ ====================

function later(fn, ms) {
    if (destroyed) return;
    var t = setTimeout(function () {
        var i = timers.indexOf(t);
        if (i !== -1) timers.splice(i, 1);
        if (!destroyed) fn();
    }, ms);
    timers.push(t);
}

function fetchJson(url) {
    return new Promise(function (resolve, reject) {
        var done = false;
        var timer = setTimeout(function () {
            if (done) return;
            done = true;
            reject(new Error('timeout'));
        }, FETCH_TIMEOUT_MS);
        fetch(url).then(function (res) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            if (!res.ok) return reject(new Error('HTTP ' + res.status));
            res.json().then(resolve, reject);
        }, function (err) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            reject(err);
        });
    });
}

/** Прогон списка с ограничением параллельности; сбой элемента → null */
function mapLimit(list, limit, worker) {
    return new Promise(function (resolve) {
        var results = new Array(list.length);
        var next = 0, active = 0, finished = 0;
        if (!list.length) return resolve(results);
        function launch() {
            while (active < limit && next < list.length) {
                (function (i) {
                    active++;
                    next++;
                    Promise.resolve()
                        .then(function () { return worker(list[i], i); })
                        .then(function (v) { results[i] = v; }, function () { results[i] = null; })
                        .then(function () {
                            active--;
                            finished++;
                            if (finished === list.length) resolve(results);
                            else launch();
                        });
                })(next);
            }
        }
        launch();
    });
}

function inWarmupWindow() {
    var d = new Date();
    var md = d.getMonth() * 100 + d.getDate();
    return md >= WARMUP_FROM[0] * 100 + WARMUP_FROM[1] && md <= WARMUP_TO[0] * 100 + WARMUP_TO[1];
}

// ==================== TMDB ====================

function tmdbJson(pathAndQuery) {
    if (serverTmdbGet) {
        return Promise.resolve(serverTmdbGet(pathAndQuery)).then(function (r) {
            if (!r || !r.ok) throw new Error('HTTP ' + (r ? r.status : '?'));
            return r.json();
        }).catch(function () {
            if (destroyed) throw new Error('модуль остановлен');
            return tmdbJsonOwn(pathAndQuery);
        });
    }
    return tmdbJsonOwn(pathAndQuery);
}

function getMirrors() {
    if (mirrorList) return Promise.resolve(mirrorList);
    return fetchJson(APIPROXY_URL + '?t=' + Date.now()).then(function (cfg) {
        var list = [];
        var raw = (cfg && Array.isArray(cfg.tmdb)) ? cfg.tmdb : [];
        for (var i = 0; i < raw.length; i++) {
            if (raw[i] && typeof raw[i].api === 'string' && raw[i].api) {
                list.push({ api: raw[i].api.replace(/\/+$/, ''), key: raw[i].key || DEFAULT_TMDB_KEY });
            }
        }
        mirrorList = list.length ? list : DEFAULT_TMDB_MIRRORS;
        return mirrorList;
    }, function () {
        mirrorList = DEFAULT_TMDB_MIRRORS;
        return mirrorList;
    });
}

function tmdbJsonOwn(pathAndQuery) {
    return getMirrors().then(function (mirrors) {
        function attempt(i) {
            var m = mirrors[i];
            var sep = pathAndQuery.indexOf('?') === -1 ? '?' : '&';
            return fetchJson(m.api + '/' + pathAndQuery + sep + 'api_key=' + encodeURIComponent(m.key))
                .catch(function (e) {
                    if (destroyed || i + 1 >= mirrors.length) throw e;
                    return attempt(i + 1);
                });
        }
        return attempt(0);
    });
}

function discoverPath(mediaType, minVotes, page) {
    return 'discover/' + mediaType + '?with_keywords=' + TMDB_KEYWORD +
        '&sort_by=popularity.desc&vote_count.gte=' + minVotes +
        '&language=ru-RU&page=' + page;
}

/** Все страницы discover одного типа: первая говорит, сколько их всего */
function fetchAllPages(mediaType, minVotes) {
    return tmdbJson(discoverPath(mediaType, minVotes, 1)).then(function (first) {
        var results = (first && Array.isArray(first.results)) ? first.results.slice() : [];
        var total = Math.min((first && first.total_pages) || 1, MAX_PAGES);
        var pages = [];
        for (var p = 2; p <= total; p++) pages.push(p);
        return mapLimit(pages, TMDB_CONCURRENCY, function (p) {
            return tmdbJson(discoverPath(mediaType, minVotes, p));
        }).then(function (rest) {
            for (var i = 0; i < rest.length; i++) {
                if (rest[i] && Array.isArray(rest[i].results)) {
                    results = results.concat(rest[i].results);
                }
            }
            for (var j = 0; j < results.length; j++) {
                if (results[j]) results[j]._media = mediaType;
            }
            return results;
        });
    });
}

// Логотип названия для баннера главной — выбор тот же, что у сервера
// (pickLogo в services/tmdb.js): русский, английский, без языка; PNG раньше SVG
var LOGO_LANGS = ['ru', 'en', null];

function pickLogo(logos) {
    if (!Array.isArray(logos) || !logos.length) return null;
    for (var li = 0; li < LOGO_LANGS.length; li++) {
        var lang = LOGO_LANGS[li];
        var list = logos.filter(function (l) { return l && l.file_path && (l.iso_639_1 || null) === lang; });
        if (!list.length) continue;
        list.sort(function (a, b) {
            var svgA = /\.svg$/i.test(a.file_path) ? 1 : 0;
            var svgB = /\.svg$/i.test(b.file_path) ? 1 : 0;
            if (svgA !== svgB) return svgA - svgB;
            return (b.vote_average || 0) - (a.vote_average || 0) || (b.width || 0) - (a.width || 0);
        });
        return { file_path: list[0].file_path, aspect_ratio: list[0].aspect_ratio || null, lang: lang || '' };
    }
    return null;
}

/** item.logo: объект или null. Сбой запроса — поля нет, телевизор спросит /api/tmdb/logo сам */
function attachLogo(item) {
    var path = (item.media_type === 'tv' ? 'tv/' : 'movie/') + item.id +
        '/images?include_image_language=ru,en,null';
    return tmdbJson(path).then(function (data) {
        item.logo = pickLogo(data && data.logos);
        return item;
    }, function () { return item; });
}

// ==================== ПРОЕКЦИИ ====================

// «2009-02-05» → «05.02.2009»: так дата лежит во всех каталогах парсера
function ruDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? m[3] + '.' + m[2] + '.' + m[1] : null;
}

/** Элемент каталога — те же поля, что у /api/catalog/:name/items */
function toCatalogItem(raw, index) {
    return {
        num_index: index,
        id: raw.id,
        media_type: raw._media,
        title: raw.title || raw.name || '',
        original_title: raw.original_title || raw.original_name || '',
        genre_ids: Array.isArray(raw.genre_ids) ? raw.genre_ids : [],
        vote_average: typeof raw.vote_average === 'number' ? raw.vote_average : null,
        vote_count: raw.vote_count || 0,
        release_date: ruDate(raw.release_date || raw.first_air_date),
        poster_path: 'http://image.tmdb.org/t/p/w342' + raw.poster_path,
        backdrop_path: raw.backdrop_path || null,
        overview: raw.overview || ''
    };
}

/** Карточка ряда главной — проекция /api/tmdb/collection */
function toHomeItem(raw) {
    return {
        id: raw.id,
        media_type: raw._media,
        title: raw.title || raw.name || '',
        poster_path: raw.poster_path,
        vote_average: typeof raw.vote_average === 'number' ? raw.vote_average : null,
        release_date: raw.release_date || raw.first_air_date || null,
        backdrop_path: raw.backdrop_path || null,
        overview: raw.overview || '',
        genre_ids: Array.isArray(raw.genre_ids) ? raw.genre_ids.slice(0, 4) : []
    };
}

// ==================== СБОРКА ====================

/** Без постера карточка пустая; страницы discover на стыке могут повторяться */
function cleanList(list) {
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length; i++) {
        var r = list[i];
        if (!r || !r.id || !r.poster_path || seen[r.id]) continue;
        seen[r.id] = true;
        out.push(r);
    }
    return out;
}

/** Фильмы подряд, и после каждых CATALOG_MOVIES_PER_TV — один сериал */
function interleave(movies, shows) {
    var out = [];
    var m = 0, t = 0;
    while (m < movies.length || t < shows.length) {
        for (var k = 0; k < CATALOG_MOVIES_PER_TV && m < movies.length; k++) out.push(movies[m++]);
        if (t < shows.length) out.push(shows[t++]);
    }
    return out;
}

function build(log) {
    if (inflight) return inflight;

    inflight = Promise.all([
        fetchAllPages('movie', CATALOG_MIN_VOTES_MOVIE),
        fetchAllPages('tv', CATALOG_MIN_VOTES_TV)
    ]).then(function (parts) {
        var movies = cleanList(parts[0]);
        var shows = cleanList(parts[1]);
        if (!movies.length && !shows.length) throw new Error('пустой ответ TMDB');

        var catalog = interleave(movies, shows).map(toCatalogItem);
        // На главной только фильмы: двадцать самых популярных из узнаваемых
        var homeRaw = movies.filter(function (r) { return (r.vote_count || 0) >= HOME_MIN_VOTES; })
            .slice(0, HOME_LIMIT);

        return mapLimit(homeRaw.map(toHomeItem), TMDB_CONCURRENCY, attachLogo).then(function (home) {
            cache = {
                ts: Date.now(),
                catalog: catalog,
                home: home.filter(Boolean)
            };
            log.log('Подборка собрана: каталог ' + catalog.length + ', главная ' + cache.home.length);
            return cache;
        });
    }).catch(function (e) {
        log.warn('Подборка не собралась: ' + e.message);
        // Протухший кэш лучше пустого
        if (cache) return cache;
        return { ts: 0, catalog: [], home: [] };
    }).then(function (res) {
        inflight = null;
        return res;
    });

    return inflight;
}

function getData(log) {
    if (cache && (Date.now() - cache.ts) < TTL_MS) return Promise.resolve(cache);
    return build(log);
}

// ==================== МОДУЛЬ ====================

module.exports = {
    name: 'halloween-collection',
    version: '1.0.0',

    init: function (app, ctx) {
        var log = ctx.log;
        destroyed = false;
        mirrorList = null;
        serverTmdbGet = typeof ctx.tmdbGet === 'function' ? ctx.tmdbGet : null;

        // Ряд главной (HOME_ROWS в public/js/home.js)
        app.get('/api/halloween/collection', function (req, res) {
            getData(log).then(function (data) {
                res.json({ success: true, preset: 'halloween', name: 'Хэллоуин', items: data.home });
            });
        });

        // Метаданные категории каталога — как /api/rus
        app.get('/api/halloween', function (req, res) {
            getData(log).then(function (data) {
                res.json({
                    success: true,
                    name: 'halloween',
                    displayName: 'Хэллоуин',
                    itemsCount: data.catalog.length,
                    lastModified: data.ts,
                    lastModifiedISO: data.ts ? new Date(data.ts).toISOString() : null
                });
            });
        });

        // Элементы категории с пагинацией — формат /api/catalog/:name/items
        app.get('/api/halloween/items', function (req, res) {
            var from = Math.max(0, parseInt(req.query.from, 10) || 0);
            var limit = Math.max(1, Math.min(1000, parseInt(req.query.limit, 10) || 50));
            getData(log).then(function (data) {
                var slice = data.catalog.slice(from, from + limit);
                res.json({
                    success: true,
                    items: slice,
                    pagination: {
                        from: from,
                        limit: limit,
                        returned: slice.length,
                        total: data.catalog.length,
                        hasMore: from + slice.length < data.catalog.length
                    }
                });
            });
        });

        // Принудительная пересборка
        app.post('/api/halloween/update', function (req, res) {
            cache = null;
            build(log).then(function (data) {
                res.json({ success: true, catalog: data.catalog.length, home: data.home.length });
            });
        });

        if (inWarmupWindow()) {
            later(function () { getData(log); }, WARMUP_DELAY_MS);
        }

        ctx.onDestroy(function () {
            destroyed = true;
            for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
            timers = [];
        });

        log.log('Подборка «Хэллоуин» зарегистрирована');
        return { ready: true };
    },

    destroy: function () {
        destroyed = true;
        serverTmdbGet = null;
        for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
        timers = [];
        cache = null;
        inflight = null;
        console.log('[halloween-collection] Уничтожение...');
    }
};
