// category-banners.js — фильмы для баннера главной, когда фокус на плитке
// категории (ряд «Категории» в home.js).
//
// На баннер идут первые BANNER_SIZE фильмов категории, у которых есть
// описание, широкий кадр и логотип названия. У элементов категории
// (GET <категория>/items) ничего этого нет — только id и торрент, поэтому
// кандидатов дотягиваем по одному: /api/tmdb/item (описание, кадр) и
// /api/tmdb/logo. Это десятки запросов на категорию, и готовый список ложится в
// IndexedDB (CategoryBannersDB) на сутки: повторный показ плитки — и в этой
// сессии, и после перезапуска — сети не трогает.
//
// Отрисовкой модуль не занимается: баннер, логотип, трейлер и смена фильмов —
// в home.js. Здесь только данные: CategoryBanners.get(key, onFirst).
(function () {
    'use strict';

    var CB = {
        TTL_MS: 24 * 60 * 60 * 1000,
        BANNER_SIZE: 10,
        // Сколько первых элементов категории перебираем в поисках десяти
        // подходящих. У свежих раздач логотипа часто ещё нет
        CANDIDATES: 40,
        // Кандидатов проверяем пачками: пачка — параллельно, пачки — по
        // очереди, чтобы остановиться, как только набралось BANNER_SIZE
        CHECK_BATCH: 4,
        FETCH_TIMEOUT_MS: 10000
    };

    // key → список на эту сессию; key → идущая сборка
    var memory = {};
    var inflight = {};

    function serverUrl() {
        return (window.SERVER_URL || window.location.origin);
    }

    function itemKey(item) {
        return String(item.id) + '_' + (item.media_type === 'tv' ? 'tv' : 'movie');
    }

    function fetchJson(url) {
        return new Promise(function (resolve) {
            var ctrl = null;
            try { ctrl = new AbortController(); } catch (e) { ctrl = null; }
            var timer = setTimeout(function () {
                if (ctrl) { try { ctrl.abort(); } catch (e) { } }
            }, CB.FETCH_TIMEOUT_MS);
            fetch(url, ctrl ? { signal: ctrl.signal } : {})
                .then(function (r) {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.json();
                })
                .then(function (d) { clearTimeout(timer); resolve(d); })
                .catch(function () { clearTimeout(timer); resolve(null); });
        });
    }

    // ==================== IndexedDB: CategoryBannersDB ====================
    //
    // Своя база, как у главной (HomeCacheDB): чужие базы со своими версиями и
    // миграциями поднимать из другого модуля нельзя. Запись {key, items, ts, v}.
    var DB_NAME = 'CategoryBannersDB';
    var DB_VERSION = 1;
    var DB_STORE = 'banners';
    // Версия проекции элемента: поменяли набор полей — подними, и сохранённые
    // раньше списки соберутся заново
    var ITEMS_SCHEMA_VERSION = 1;
    var dbPromise = null;

    function openDb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise(function (resolve) {
            if (!window.indexedDB) { resolve(null); return; }
            var req;
            try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { resolve(null); return; }
            req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(DB_STORE)) {
                    db.createObjectStore(DB_STORE, { keyPath: 'key' });
                }
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { resolve(null); };
            req.onblocked = function () { resolve(null); };
        });
        return dbPromise;
    }

    function dbGet(key) {
        return openDb().then(function (db) {
            if (!db) return null;
            return new Promise(function (resolve) {
                try {
                    var rq = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
                    rq.onsuccess = function () { resolve(rq.result || null); };
                    rq.onerror = function () { resolve(null); };
                } catch (e) { resolve(null); }
            });
        });
    }

    function dbPut(key, items) {
        return openDb().then(function (db) {
            if (!db) return;
            return new Promise(function (resolve) {
                try {
                    var tx = db.transaction(DB_STORE, 'readwrite');
                    tx.objectStore(DB_STORE).put({
                        key: key, items: items, ts: Date.now(), v: ITEMS_SCHEMA_VERSION
                    });
                    tx.oncomplete = function () { resolve(); };
                    tx.onerror = function () { resolve(); };
                    tx.onabort = function () { resolve(); };
                } catch (e) { resolve(); }
            });
        });
    }

    function dbClear() {
        return openDb().then(function (db) {
            if (!db) return;
            return new Promise(function (resolve) {
                try {
                    var tx = db.transaction(DB_STORE, 'readwrite');
                    tx.objectStore(DB_STORE).clear();
                    tx.oncomplete = function () { resolve(); };
                    tx.onerror = function () { resolve(); };
                    tx.onabort = function () { resolve(); };
                } catch (e) { resolve(); }
            });
        });
    }

    // ==================== СБОРКА СПИСКА ====================

    /** Первые CB.CANDIDATES элементов категории: нужны только id и тип */
    function loadCandidates(key) {
        var cfg = (typeof CATALOG_CONFIG !== 'undefined') ? CATALOG_CONFIG[key] : null;
        if (!cfg || !cfg.url) return Promise.resolve([]);
        return fetchJson(cfg.url + '/items?from=0&limit=' + CB.CANDIDATES).then(function (d) {
            return (d && d.success && d.items) ? d.items : [];
        });
    }

    /**
     * Элемент баннера или null. Проекция маленькая — в IndexedDB лежит только
     * то, что рисует баннер, — и того же вида, что элементы подборок главной
     * (routes/tmdb.js): renderHero и applyHeroLogo разбирают её без переделок.
     */
    function checkCandidate(it) {
        var type = it.media_type === 'tv' ? 'tv' : 'movie';
        var q = '?id=' + encodeURIComponent(it.id) + '&type=' + type;
        return fetchJson(serverUrl() + '/api/tmdb/item' + q).then(function (d) {
            if (!d || !d.overview || !d.backdrop_path) return null;
            var genres = [];
            if (d.genres) {
                for (var i = 0; i < d.genres.length; i++) {
                    if (d.genres[i] && d.genres[i].id != null) genres.push(d.genres[i].id);
                }
            }
            var item = {
                id: it.id,
                media_type: type,
                title: d.title || d.name || '',
                original_title: d.original_title || d.original_name || '',
                overview: d.overview,
                backdrop_path: d.backdrop_path,
                poster_path: d.poster_path || null,
                vote_average: d.vote_average || null,
                release_date: d.release_date || d.first_air_date || '',
                genre_ids: genres,
                logo: null
            };
            // Логотип спрашиваем только у прошедших первое сито: запросов вдвое меньше
            return fetchJson(serverUrl() + '/api/tmdb/logo' + q).then(function (l) {
                if (l && l.logo && l.logo.file_path) item.logo = { file_path: l.logo.file_path };
                return item;
            });
        });
    }

    /**
     * Порядок — порядок категории: «первые десять с описанием, кадром и
     * логотипом», а не те, что ответили быстрее. onFirst(items) — как только
     * готов хотя бы один: баннер не ждёт всех десяти.
     */
    function collect(key, onFirst) {
        return loadCandidates(key).then(function (all) {
            var seen = {};
            var cand = [];
            for (var i = 0; i < all.length && cand.length < CB.CANDIDATES; i++) {
                var it = all[i];
                if (!it || it.id == null) continue;
                var k = itemKey(it);
                if (seen[k]) continue;
                seen[k] = true;
                cand.push(it);
            }

            var strict = [];
            var loose = [];      // без логотипа — только запас
            var at = 0;
            var notified = false;

            function step() {
                if (strict.length >= CB.BANNER_SIZE || at >= cand.length) {
                    // Логотипов нет ни у кого (сервер без /api/tmdb/logo или
                    // категория из одних свежих раздач) — пустой баннер хуже,
                    // чем баннер с текстовым названием
                    return strict.length ? strict : loose.slice(0, CB.BANNER_SIZE);
                }
                var batch = cand.slice(at, at + CB.CHECK_BATCH);
                at += batch.length;
                return Promise.all(batch.map(checkCandidate)).then(function (res) {
                    for (var j = 0; j < res.length; j++) {
                        var r = res[j];
                        if (!r) continue;
                        if (r.logo) { if (strict.length < CB.BANNER_SIZE) strict.push(r); }
                        else if (loose.length < CB.BANNER_SIZE) loose.push(r);
                    }
                    if (!notified && strict.length && onFirst) {
                        notified = true;
                        onFirst(strict.slice());
                    }
                    return step();
                });
            }
            return step();
        });
    }

    /**
     * Список баннера категории: память → IndexedDB → сеть. Сеть не ответила —
     * берём просроченную запись, лишь бы баннер не пустовал.
     */
    function get(key, onFirst) {
        if (memory[key]) return Promise.resolve(memory[key]);
        if (inflight[key]) return inflight[key];

        var p = dbGet(key).then(function (rec) {
            var fresh = rec && rec.items && rec.items.length && rec.v === ITEMS_SCHEMA_VERSION &&
                (Date.now() - (rec.ts || 0)) < CB.TTL_MS;
            if (fresh) return rec.items;
            return collect(key, onFirst).then(function (items) {
                if (items.length) {
                    dbPut(key, items);
                    return items;
                }
                return (rec && rec.items) ? rec.items : [];
            });
        }).then(function (items) {
            if (items.length) memory[key] = items;
            delete inflight[key];
            return items;
        }, function () {
            delete inflight[key];
            return [];
        });
        inflight[key] = p;
        return p;
    }

    /** Уже собранный список — без ожидания; null, если его ещё нет в памяти */
    function peek(key) {
        return memory[key] || null;
    }
    /** «Обновить подборки» на главной: списки баннера соберутся заново */
    function clear() {
        memory = {};
        return dbClear();
    }

    window.CategoryBanners = {
        get: get,
        peek: peek,
        clear: clear
    };
})();
