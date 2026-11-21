// magnet-store.js — полные magnet-ссылки раздач: своя база IndexedDB на устройстве
//
// Зачем. Раздачу из поиска мы добавляем в TorrServer полным magnet, со списком
// трекеров. Дальше всё — карточка, плеер, «Продолжить», история — обращается к
// ней только по хешу (/stream?link=<хеш>, /play/<хеш>/<файл>). Пока раздача
// живёт в TorrServer, это работает. Но её там может не оказаться: «Добавлять в
// базу» выключено и раздачу остановили (drop на выходе из плеера и карточки),
// TorrServer перезапустили, раздачу удалили. Тогда TorrServer поднимает её
// заново по одному хешу — без трекеров. Для обычных раздач это терпимо (пиров
// находит DHT), а раздачи LostFilm держатся на своих ретрекерах
// (bt.tracktor.in и др., с ключом в адресе) — без них ни одного пира.
//
// Что делаем. При добавлении из поиска запоминаем magnet (только если в нём
// есть трекеры — без них хеш ничем не хуже). Перед открытием раздачи по хешу
// (getTorrentFilesWithCache в torrents.js, startHLSPlayback в player.js)
// ensure(hash): есть запись — спрашиваем TorrServer, знает ли он раздачу;
// не знает — добавляем её снова сохранённым magnet с тем же названием,
// постером и категорией.
//
// Отдельная база, а не общая с кэшами каталога: те чистятся по TTL, а это
// единственное место, где у устройства остаются трекеры раздачи.
(function () {
    'use strict';

    var DB_NAME = 'TorrentMagnetsDB';
    var DB_VERSION = 1;
    var STORE_NAME = 'magnets';
    // Записей больше — удаляем самые давние. Запись ~0,5–1 КБ
    var MAX_RECORDS = 1000;
    // Ответ TorrServer «раздача на месте» помним недолго: карточка и следом
    // запуск плеера не должны спрашивать дважды. Дольше нельзя — раздачу
    // могли остановить (drop) между двумя открытиями
    var VERIFIED_TTL_MS = 15000;
    // Проверка не должна держать запуск: TorrServer молчит — идём дальше по хешу
    var CHECK_TIMEOUT_MS = 4000;

    var dbPromise = null;
    var verifiedAt = {};      // hash -> время последней проверки «на месте»
    var inFlight = {};        // hash -> Promise ensure

    function openDB() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise(function (resolve, reject) {
            if (!window.indexedDB) { reject(new Error('IndexedDB недоступна')); return; }
            var req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    var store = db.createObjectStore(STORE_NAME, { keyPath: 'hash' });
                    store.createIndex('savedAt', 'savedAt', { unique: false });
                }
            };
            req.onsuccess = function (e) { resolve(e.target.result); };
            req.onerror = function (e) {
                console.warn('⚠️ TorrentMagnetsDB: не открылась', e);
                dbPromise = null;
                reject(e);
            };
        });
        return dbPromise;
    }

    function normHash(hash) {
        var h = String(hash || '').toLowerCase();
        return /^[a-f0-9]{40}$/.test(h) ? h : null;
    }

    /** В magnet есть трекеры — есть что хранить */
    function hasTrackers(magnet) {
        return /[?&]tr=/i.test(String(magnet || ''));
    }

    function getRecord(hash) {
        return openDB().then(function (db) {
            return new Promise(function (resolve) {
                var req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(hash);
                req.onsuccess = function () { resolve(req.result || null); };
                req.onerror = function () { resolve(null); };
            });
        })['catch'](function () { return null; });
    }

    /** Самые давние записи сверх MAX_RECORDS — прочь (по индексу savedAt) */
    function prune(db) {
        try {
            var store = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME);
            var countReq = store.count();
            countReq.onsuccess = function () {
                var extra = countReq.result - MAX_RECORDS;
                if (extra <= 0) return;
                var cur = store.index('savedAt').openCursor();
                cur.onsuccess = function () {
                    var c = cur.result;
                    if (!c || extra <= 0) return;
                    c['delete']();
                    extra--;
                    c['continue']();
                };
            };
        } catch (e) { /* уборка не обязательна */ }
    }

    /**
     * Запомнить magnet раздачи.
     * @param {string} hash
     * @param {string} magnet полный magnet из поиска
     * @param {object} meta то, с чем раздачу добавляли: title, category, poster,
     *        tmdb_id, seasons (MonoServer) — чтобы повторное добавление выглядело
     *        в списке так же
     */
    function remember(hash, magnet, meta) {
        var h = normHash(hash);
        if (!h || !hasTrackers(magnet)) return Promise.resolve(false);
        meta = meta || {};
        var rec = { hash: h, magnet: String(magnet), savedAt: Date.now() };
        ['title', 'category', 'poster', 'tmdb_id', 'seasons'].forEach(function (k) {
            if (meta[k] !== undefined && meta[k] !== null && meta[k] !== '') rec[k] = meta[k];
        });
        return openDB().then(function (db) {
            return new Promise(function (resolve) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                tx.objectStore(STORE_NAME).put(rec);
                tx.oncomplete = function () { prune(db); resolve(true); };
                tx.onerror = tx.onabort = function () { resolve(false); };
            });
        })['catch'](function () { return false; });
    }

    function withTimeout(promise, ms) {
        return new Promise(function (resolve, reject) {
            var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
            promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
        });
    }

    function postTorrents(body) {
        return torrServerFetch('/torrents', { method: 'POST', body: JSON.stringify(body) });
    }

    /**
     * Знает ли TorrServer раздачу: true / false / null (не удалось выяснить).
     * action:get отвечает 404 на незнакомый хеш; в базе TorrServer раздача
     * тоже считается «на месте» — там она хранится вместе с трекерами. Если
     * get не поддержан (иной ответ), смотрим общий список.
     */
    function torrServerHas(hash) {
        return withTimeout(postTorrents({ action: 'get', hash: hash }), CHECK_TIMEOUT_MS).then(function (r) {
            if (r.status === 404) return false;
            if (r.ok) {
                return r.json().then(function (t) {
                    return !!(t && String(t.hash || '').toLowerCase() === hash);
                }, function () { return null; });
            }
            return withTimeout(postTorrents({ action: 'list' }), CHECK_TIMEOUT_MS).then(function (lr) {
                if (!lr.ok) return null;
                return lr.json().then(function (list) {
                    if (!Array.isArray(list)) return null;
                    for (var i = 0; i < list.length; i++) {
                        if (String(list[i].hash || '').toLowerCase() === hash) return true;
                    }
                    return false;
                });
            });
        })['catch'](function () { return null; });
    }

    function reAdd(rec) {
        var body = {
            action: 'add',
            link: rec.magnet,
            title: rec.title || '',
            category: rec.category || '',
            save_to_db: !!(window.AppState && AppState.addToDbEnabled)
        };
        if (rec.poster) body.poster = rec.poster;
        if (rec.tmdb_id) body.tmdb_id = rec.tmdb_id;
        if (rec.seasons) body.seasons = rec.seasons;
        return withTimeout(postTorrents(body), CHECK_TIMEOUT_MS * 2).then(function (r) {
            return !!(r && r.ok);
        })['catch'](function () { return false; });
    }

    /**
     * Перед открытием раздачи по хешу: если для неё сохранён magnet, а в
     * TorrServer её нет — добавить снова этим magnet.
     *
     * Всегда разрешается (никогда не отклоняется): любые сбои здесь не должны
     * мешать запуску — тогда всё идёт по хешу, как раньше.
     * @returns {Promise<boolean>} true — раздачу добавили заново
     */
    function ensure(hash) {
        var h = normHash(hash);
        if (!h || typeof torrServerFetch !== 'function' ||
            !(window.AppState && AppState.currentTorrserverUrl)) return Promise.resolve(false);
        if (verifiedAt[h] && Date.now() - verifiedAt[h] < VERIFIED_TTL_MS) return Promise.resolve(false);
        if (inFlight[h]) return inFlight[h];

        var p = getRecord(h).then(function (rec) {
            if (!rec) return false;          // magnet не сохраняли — по хешу, как всегда
            return torrServerHas(h).then(function (has) {
                if (has === true) { verifiedAt[h] = Date.now(); return false; }
                if (has === null) return false;   // не выяснили — не трогаем
                console.log('🧲 Раздачи нет в TorrServer — добавляем снова полным magnet:', h);
                return reAdd(rec).then(function (ok) {
                    if (ok) verifiedAt[h] = Date.now();
                    else console.warn('🧲 Не удалось добавить раздачу magnet-ссылкой:', h);
                    return ok;
                });
            });
        })['catch'](function () { return false; });

        inFlight[h] = p;
        p.then(function () { delete inFlight[h]; });
        return p;
    }

    /** Раздачу остановили или удалили — прежнее «на месте» больше не верно */
    function forget(hash) {
        var h = normHash(hash);
        if (h) delete verifiedAt[h];
    }

    window.MagnetStore = {
        remember: remember,
        ensure: ensure,
        forget: forget,
        get: function (hash) { var h = normHash(hash); return h ? getRecord(h) : Promise.resolve(null); }
    };
})();
