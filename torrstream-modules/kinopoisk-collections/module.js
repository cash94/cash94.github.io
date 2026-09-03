// module.js — Модуль «Подборки Кинопоиска» (kinopoisk-collections)
//
// Отдаёт ряды главной, собранные из мелких подборок Кинопоиска
// (kinopoiskapiunofficial.tech, films/collections?type=...).
//
// Здесь остались только подборки на пятьдесят элементов и меньше. Крупные
// (Популярное, Топ 250, Семейное, Комиксы, Про любовь и остальные) стали
// категориями каталога и приезжают файлами от парсера — releases/kp.go в
// NUMParser собирает их тем же путём, что и «Фильмы» с «Легендами», и
// подставляет каждой карточке раздачу с Rutor. Ряду главной ни того, ни
// другого не нужно: двадцать карточек, format как у /api/tmdb/collection.
//
// CLOSES_RELEASES («Скоро в кино», 7 элементов) и OSKAR_WINNERS_2021
// («Оскар 2021», 15) исключены совсем: дублируют то, что на главной и так есть.
//
// Зачем маппинг в TMDB. Весь фронт работает с TMDB-идентификаторами: по
// item.id открывается карточка (описание, актёры, похожие, трейлер), по нему же
// пишется история просмотра. Кинопоиск отдаёт свой kinopoiskId, поэтому каждый
// элемент переводится в TMDB — точно, через imdbId (find?external_source=imdb_id),
// а если imdbId нет (у свежих сериалов бывает) — поиском по названию и году.
// Что не нашлось, в ряд не попадает: битая карточка хуже отсутствующей.
// Заодно от TMDB берутся backdrop_path и overview — без них баннер главной
// дёргал бы /api/tmdb/details на каждое перемещение фокуса.
//
// Формат ответа намеренно совпадает с /api/tmdb/collection (routes/tmdb.js),
// чтобы на фронте не появилось второго пути разбора данных. Ряды объявлены в
// HOME_ROWS (public/js/home.js) с source: 'kinopoisk'.
//
// Песочница module-loader (useSandbox: true) не даёт ни require, ни fs, поэтому
// собранные подборки живут в памяти и переcобираются по TTL — так же, как
// каталог «Русские» в rus-catalog.

var KP_API_KEY = '85d30ae5-d875-4c5f-900d-8e37bb20625e';
var KP_BASE = 'https://kinopoiskapiunofficial.tech/api/v2.2/films/collections';

// Тот же ключ и то же зеркало, что использует сам сервер (services/tmdb.js).
var TMDB_API_KEY = '064ea5b59beec7eccb3fe99059d58a50';
var TMDB_BASE = 'https://tsapi.hnar.online';

// Ряд главной показывает 20 карточек — ровно страница Кинопоиска. Поэтому
// каждая подборка это ровно один запрос к Кинопоиску, сколько бы элементов в
// ней ни лежало.
var ROW_LIMIT = 20;
// Столько же, сколько COLLECTION_CACHE_TTL_MS у серверных подборок.
var TTL_MS = 3 * 24 * 60 * 60 * 1000;
// Одновременных запросов к TMDB при сборке. Выше 6 зеркало начинает терять
// ответы: на 8 из ста элементов не сопоставились 28 против шести на четырёх.
var TMDB_CONCURRENCY = 6;
// Один повтор на элемент: одиночные обрывы к зеркалу — обычное дело, а терять
// из-за них карточку жалко.
var TMDB_RETRIES = 1;
var FETCH_TIMEOUT_MS = 15000;
// Пауза между подборками при прогреве
var WARMUP_PAUSE_MS = 800;
// Через столько после старта прогреваем все четыре ряда: иначе первый заход на
// Главную ждёт сборку прямо в запросе, а на телевизоре это заметно. Задержка —
// чтобы не мешать загрузке каталогов самого сервера.
var WARMUP_DELAY_MS = 15000;

// В скобках — сколько всего элементов в подборке. Всё, что больше пятидесяти,
// живёт категорией каталога (CATALOG_CONFIG в public/js/catalog.js) и сюда не
// попадает.
var COLLECTIONS = {
    kp_zombie: { type: 'ZOMBIE_THEME', name: 'Кинопоиск · Про зомби' },          // 31
    kp_vampire: { type: 'VAMPIRE_THEME', name: 'Кинопоиск · Про вампиров' },     // 30
    kp_disaster: { type: 'CATASTROPHE_THEME', name: 'Кинопоиск · Катастрофы' },  // 30
    kp_kids: { type: 'KIDS_ANIMATION_THEME', name: 'Кинопоиск · Мультфильмы детям' } // 30
};

// key → { ts, items }
var cache = {};
// key → Promise: параллельные запросы к одной подборке ждут одну сборку,
// а не запускают по своей
var inflight = {};
// Таймеры прогрева: без них destroy() оставит после себя сборку, пишущую в кэш
// уже выгруженного модуля
var timers = [];
var destroyed = false;

// ==================== УТИЛИТЫ ====================

function later(fn, ms) {
    if (destroyed) return null;
    var t = setTimeout(function () {
        var i = timers.indexOf(t);
        if (i !== -1) timers.splice(i, 1);
        if (!destroyed) fn();
    }, ms);
    timers.push(t);
    return t;
}

function timeoutFetch(url, options) {
    var opts = options || {};
    return new Promise(function (resolve, reject) {
        var done = false;
        var timer = setTimeout(function () {
            if (done) return;
            done = true;
            reject(new Error('timeout'));
        }, FETCH_TIMEOUT_MS);

        fetch(url, opts).then(function (res) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(res);
        }, function (err) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            reject(err);
        });
    });
}

function fetchJson(url, options) {
    return timeoutFetch(url, options).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
    });
}

/** То же, что fetchJson, но с повтором: обрыв к зеркалу — не повод терять элемент */
function fetchJsonRetry(url, options, retries) {
    return fetchJson(url, options).catch(function (e) {
        if (!retries || destroyed) throw e;
        return fetchJsonRetry(url, options, retries - 1);
    });
}

/** Прогон списка с ограничением параллельности */
function mapLimit(list, limit, worker) {
    return new Promise(function (resolve) {
        var results = new Array(list.length);
        var next = 0;
        var active = 0;
        var finished = 0;

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

// ==================== КИНОПОИСК ====================

function fetchKpPage(type) {
    var url = KP_BASE + '?type=' + encodeURIComponent(type) + '&page=1';
    return fetchJson(url, {
        headers: { 'accept': 'application/json', 'X-API-KEY': KP_API_KEY }
    }).then(function (data) {
        return (data && Array.isArray(data.items)) ? data.items : [];
    });
}

// ==================== TMDB ====================

function kpMediaType(kpItem) {
    return kpItem && kpItem.type === 'TV_SERIES' ? 'tv' : 'movie';
}

/** Точный путь: imdbId → TMDB */
function tmdbByImdb(imdbId, mediaType) {
    var url = TMDB_BASE + '/find/' + encodeURIComponent(imdbId) +
        '?api_key=' + TMDB_API_KEY + '&external_source=imdb_id&language=ru-RU';

    return fetchJsonRetry(url, null, TMDB_RETRIES).then(function (data) {
        if (!data) return null;
        var movies = Array.isArray(data.movie_results) ? data.movie_results : [];
        var shows = Array.isArray(data.tv_results) ? data.tv_results : [];
        // Сначала пробуем ту ветку, которую назвал Кинопоиск, потом вторую:
        // тип у него иногда расходится с TMDB (мини-сериалы, спецвыпуски).
        var primary = mediaType === 'tv' ? shows : movies;
        var secondary = mediaType === 'tv' ? movies : shows;
        if (primary.length) return { raw: primary[0], media_type: mediaType };
        if (secondary.length) return { raw: secondary[0], media_type: mediaType === 'tv' ? 'movie' : 'tv' };
        return null;
    }).catch(function () { return null; });
}

/** Запасной путь: название + год */
function tmdbBySearch(title, year, mediaType) {
    if (!title) return Promise.resolve(null);
    var endpoint = mediaType === 'tv' ? 'search/tv' : 'search/movie';
    var url = TMDB_BASE + '/' + endpoint +
        '?api_key=' + TMDB_API_KEY + '&language=ru-RU&query=' + encodeURIComponent(title);
    if (year) url += (mediaType === 'tv' ? '&first_air_date_year=' : '&year=') + year;

    return fetchJsonRetry(url, null, TMDB_RETRIES).then(function (data) {
        var results = (data && Array.isArray(data.results)) ? data.results : [];
        if (!results.length) return null;
        return { raw: results[0], media_type: mediaType };
    }).catch(function () { return null; });
}

function resolveTmdb(kpItem) {
    var mediaType = kpMediaType(kpItem);
    var title = kpItem.nameRu || kpItem.nameOriginal || kpItem.nameEn || '';

    if (kpItem.imdbId) {
        return tmdbByImdb(kpItem.imdbId, mediaType).then(function (hit) {
            return hit || tmdbBySearch(title, kpItem.year, mediaType);
        });
    }
    return tmdbBySearch(title, kpItem.year, mediaType);
}

// ==================== СБОРКА ПОДБОРКИ ====================

/**
 * Проекция ровно та же, что у /api/tmdb/collection: телевизору нужны только
 * поля карточки ряда и баннера.
 *
 * vote_average берём кинопоисковский — подборка его, и рейтинг в ней
 * осмысленная часть. Шкала та же десятибалльная, что у TMDB, поэтому
 * раскраска бейджа (getRatingColor) работает без правок. Если захочется
 * рейтинг TMDB — поменять на raw.vote_average в одной строке ниже.
 */
function projectItem(kpItem, hit) {
    if (!hit || !hit.raw) return null;
    var raw = hit.raw;
    if (!raw.id) return null;

    // Постер: сначала TMDB-путь, потом полный URL Кинопоиска.
    //
    // TMDB предпочтительнее не из принципа, а по трём причинам: он идёт через
    // ротацию зеркал (getTmdbImageUrl → pickMirror), подставляется под текущий
    // размер карточки (ui-customizer его меняет) и ложится в posterCache вместе
    // с остальными. У Кинопоиска хост один, размер фиксированный.
    //
    // Но если у TMDB постера нет, элемент терять незачем: и getTmdbImageUrl
    // (catalog.js), и tmdbImage (home.js) отдают полный сторонний URL как есть —
    // проверено, обе ветки. Берём posterUrl, а не posterUrlPreview: preview это
    // kp_small, для карточки на телевизоре он мелковат.
    var poster = raw.poster_path || kpItem.posterUrl || kpItem.posterUrlPreview || null;
    if (!poster) return null;                       // без постера карточка пустая

    var rating = (typeof kpItem.ratingKinopoisk === 'number') ? kpItem.ratingKinopoisk :
        (typeof raw.vote_average === 'number' ? raw.vote_average : null);

    return {
        id: raw.id,
        media_type: hit.media_type,
        title: raw.title || raw.name || kpItem.nameRu || kpItem.nameOriginal || '',
        poster_path: poster,
        vote_average: rating,
        release_date: raw.release_date || raw.first_air_date ||
            (kpItem.year ? String(kpItem.year) : null),
        backdrop_path: raw.backdrop_path || null,
        overview: raw.overview || kpItem.description || '',
        genre_ids: Array.isArray(raw.genre_ids) ? raw.genre_ids.slice(0, 4) : []
    };
}

function buildCollection(key, log) {
    var cfg = COLLECTIONS[key];
    if (!cfg) return Promise.resolve([]);

    if (inflight[key]) return inflight[key];

    var promise = fetchKpPage(cfg.type)
        .then(function (kpItems) {
            var slice = kpItems.slice(0, ROW_LIMIT);
            if (!slice.length) throw new Error('пустой ответ Кинопоиска');

            return mapLimit(slice, TMDB_CONCURRENCY, function (kpItem) {
                return resolveTmdb(kpItem).then(function (hit) {
                    return projectItem(kpItem, hit);
                });
            }).then(function (mapped) {
                var items = [];
                var seen = {};
                for (var i = 0; i < mapped.length; i++) {
                    if (!mapped[i]) continue;
                    // Два разных kinopoiskId нет-нет да и сходятся в один TMDB
                    var uid = mapped[i].id + '_' + mapped[i].media_type;
                    if (seen[uid]) continue;
                    seen[uid] = true;
                    items.push(mapped[i]);
                }
                log.log('Подборка ' + key + ': ' + items.length + ' из ' + slice.length +
                    ' (не сопоставлено с TMDB: ' + (slice.length - items.length) + ')');
                cache[key] = { ts: Date.now(), items: items };
                return items;
            });
        })
        .catch(function (e) {
            log.warn('Подборка ' + key + ' не собралась: ' + e.message);
            // Протухший кэш лучше пустого ряда
            return (cache[key] && cache[key].items) ? cache[key].items : [];
        })
        .then(function (items) {
            delete inflight[key];
            return items;
        }, function (e) {
            delete inflight[key];
            throw e;
        });

    inflight[key] = promise;
    return promise;
}

function getCollection(key, log) {
    var rec = cache[key];
    if (rec && rec.items.length && (Date.now() - rec.ts) < TTL_MS) {
        return Promise.resolve(rec.items);
    }
    return buildCollection(key, log);
}

// ==================== МОДУЛЬ ====================

module.exports = {
    name: 'kinopoisk-collections',
    version: '3.0.0',

    init: function (app, ctx) {
        var log = ctx.log;
        destroyed = false;

        // Список доступных подборок — по нему фронт может строить ряды,
        // не дублируя названия у себя.
        app.get('/api/kinopoisk/collections', function (req, res) {
            var list = [];
            for (var key in COLLECTIONS) {
                if (!COLLECTIONS.hasOwnProperty(key)) continue;
                var rec = cache[key];
                list.push({
                    key: key,
                    name: COLLECTIONS[key].name,
                    type: COLLECTIONS[key].type,
                    cached: !!(rec && rec.items.length),
                    count: rec ? rec.items.length : 0,
                    updatedAt: rec ? rec.ts : null
                });
            }
            res.json({ success: true, collections: list });
        });

        // Одна подборка. Формат ответа — как у /api/tmdb/collection.
        app.get('/api/kinopoisk/collection', function (req, res) {
            var key = req.query.preset;
            if (!key || !COLLECTIONS[key]) {
                return res.status(400).json({ success: false, error: 'Неизвестная подборка' });
            }
            getCollection(key, log).then(function (items) {
                res.json({
                    success: true,
                    preset: key,
                    name: COLLECTIONS[key].name,
                    items: items
                });
            }, function (e) {
                res.status(500).json({ success: false, error: e.message });
            });
        });

        // Принудительная пересборка — как /api/rus/update у «Русских»
        app.post('/api/kinopoisk/update', function (req, res) {
            var key = req.query.preset;
            var keys = (key && COLLECTIONS[key]) ? [key] : Object.keys(COLLECTIONS);
            for (var i = 0; i < keys.length; i++) delete cache[keys[i]];

            Promise.all(keys.map(function (k) { return buildCollection(k, log); }))
                .then(function (all) {
                    var counts = {};
                    for (var j = 0; j < keys.length; j++) counts[keys[j]] = all[j].length;
                    res.json({ success: true, counts: counts });
                }, function (e) {
                    res.status(500).json({ success: false, error: e.message });
                });
        });

        // Прогрев: по одной подборке за раз, чтобы не тянуть зеркало вчетвером.
        // Всего четыре запроса к Кинопоиску и восемьдесят к TMDB — меньше
        // минуты фоновой работы на старте.
        function warmup(list, i) {
            if (destroyed || i >= list.length) return;
            function next() {
                later(function () { warmup(list, i + 1); }, WARMUP_PAUSE_MS);
            }
            getCollection(list[i], log).then(next, next);
        }
        later(function () { warmup(Object.keys(COLLECTIONS), 0); }, WARMUP_DELAY_MS);

        ctx.onDestroy(function () {
            destroyed = true;
            for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
            timers = [];
        });

        log.log('Ряды главной (' + Object.keys(COLLECTIONS).length + '): ' +
            Object.keys(COLLECTIONS).join(', '));
        return { ready: true };
    },

    destroy: function () {
        destroyed = true;
        for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
        timers = [];
        cache = {};
        inflight = {};
        console.log('[kinopoisk-collections] Уничтожение...');
    }
};
