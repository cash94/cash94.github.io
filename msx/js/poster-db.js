// poster-db.js — асинхронный персистентный кэш постеров через IndexedDB
(function () {
    'use strict';

    var DB_NAME = 'PosterCacheDB';
    var DB_VERSION = 1;
    var STORE_NAME = 'posters';
    var MAX_ITEMS = 500;

    var dbPromise = null;

    function openDB() {
        if (dbPromise) return dbPromise;

        dbPromise = new Promise(function (resolve, reject) {
            var req = indexedDB.open(DB_NAME, DB_VERSION);

            req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    var store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };

            req.onsuccess = function (e) {
                resolve(e.target.result);
            };

            req.onerror = function (e) {
                console.warn('IndexedDB open error:', e);
                dbPromise = null;
                reject(e);
            };
        });

        return dbPromise;
    }

    function runTx(mode, callback) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, mode);
                var store = tx.objectStore(STORE_NAME);
                var result = null;

                try {
                    result = callback(store, resolve, reject);
                } catch (e) {
                    reject(e);
                }

                tx.oncomplete = function () {
                    if (result && typeof result.then === 'function') {
                        result.then(resolve).catch(reject);
                    }
                };
                tx.onerror = function (e) { reject(e); };
                tx.onabort = function (e) { reject(e); };
            });
        }).catch(function () {
            return null;
        });
    }

    function get(key) {
        return runTx('readonly', function (store, resolve) {
            var req = store.get(key);
            req.onsuccess = function () {
                var row = req.result;
                resolve(row ? row.url : null);
            };
            req.onerror = function () { resolve(null); };
        });
    }

    function set(key, url) {
        if (!url) return Promise.resolve();
        return runTx('readwrite', function (store) {
            store.put({
                key: key,
                url: url,
                timestamp: Date.now()
            });
            return Promise.resolve();
        }).then(function () {
            // Очистка старых записей (не чаще раза в N операций)
            if (Math.random() < 0.05) trimOld();
        });
    }

    function setMany(items) {
        // items = { key1: url1, key2: url2, ... }
        var keys = Object.keys(items);
        if (keys.length === 0) return Promise.resolve();

        return runTx('readwrite', function (store) {
            for (var i = 0; i < keys.length; i++) {
                store.put({
                    key: keys[i],
                    url: items[keys[i]],
                    timestamp: Date.now()
                });
            }
            return Promise.resolve();
        }).then(function () {
            trimOld();
        });
    }

    function trimOld() {
        return runTx('readwrite', function (store, resolve) {
            var countReq = store.count();
            countReq.onsuccess = function () {
                var total = countReq.result;
                if (total <= MAX_ITEMS) {
                    resolve();
                    return;
                }

                var index = store.index('timestamp');
                var cursorReq = index.openCursor();
                var toDelete = total - MAX_ITEMS + 50;
                var deleted = 0;

                cursorReq.onsuccess = function (e) {
                    var cursor = e.target.result;
                    if (cursor && deleted < toDelete) {
                        cursor.delete();
                        deleted++;
                        cursor.continue();
                    } else {
                        resolve();
                    }
                };
                cursorReq.onerror = function () { resolve(); };
            };
        });
    }

    function clear() {
        return runTx('readwrite', function (store) {
            store.clear();
            return Promise.resolve();
        });
    }

    window.PosterDB = {
        get: get,
        set: set,
        setMany: setMany,
        clear: clear
    };
})();