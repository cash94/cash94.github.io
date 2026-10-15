/* Сборка для старых браузеров (Chrome 53) из js/favorites-db.js — tools/legacy-build/build.js. Руками не править. */









(function () {
  'use strict';

  var DB_NAME = 'FavoritesDB';
  var DB_VERSION = 1;
  var STORE_NAME = 'favorites';

  var dbPromise = null;
  var keyIndex = null;
  var readyPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          var store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          store.createIndex('addedAt', 'addedAt', { unique: false });
        }
      };

      req.onsuccess = function (e) {resolve(e.target.result);};

      req.onerror = function (e) {
        console.warn('⚠️ FavoritesDB open error:', e);
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

        try {result = callback(store);} catch (e) {reject(e);return;}

        tx.oncomplete = function () {
          resolve(result && result.__req ? result.__req.result : result);
        };
        tx.onerror = function () {reject(tx.error);};
        tx.onabort = function () {reject(tx.error);};
      });
    });
  }


  function makeKey(id, mediaType) {
    if (id === undefined || id === null || id === '') return null;
    return String(id) + '_' + (mediaType || 'movie');
  }

  function itemKey(item) {
    if (!item) return null;
    return makeKey(item.id !== undefined ? item.id : item.tmdbId, item.media_type);
  }








  function project(item) {
    var key = itemKey(item);
    if (!key) return null;

    return {
      key: key,
      id: item.id !== undefined ? item.id : item.tmdbId,
      media_type: item.media_type || 'movie',
      title: item.title || item.name || '',
      name: item.name || item.title || '',
      poster_path: item.poster_path || null,
      vote_average: typeof item.vote_average === 'number' ? item.vote_average : null,
      release_date: item.release_date || item.first_air_date || null,
      addedAt: Date.now()
    };
  }


  function ready() {
    if (keyIndex) return Promise.resolve(keyIndex);
    if (readyPromise) return readyPromise;

    readyPromise = runTx('readonly', function (store) {
      var out = { __req: store.getAllKeys() };
      return out;
    }).then(function (keys) {
      keyIndex = {};
      if (keys && keys.length) {
        for (var i = 0; i < keys.length; i++) keyIndex[keys[i]] = true;
      }
      readyPromise = null;
      return keyIndex;
    }).catch(function (e) {
      console.warn('⚠️ FavoritesDB: индекс не загружен:', e);


      keyIndex = {};
      readyPromise = null;
      return keyIndex;
    });

    return readyPromise;
  }


  function has(id, mediaType) {
    var key = makeKey(id, mediaType);
    if (!key || !keyIndex) return false;
    return !!keyIndex[key];
  }

  function add(item) {
    var rec = project(item);
    if (!rec) return Promise.resolve(false);

    return runTx('readwrite', function (store) {store.put(rec);return true;}).
    then(function () {
      if (keyIndex) keyIndex[rec.key] = true;
      return true;
    }).
    catch(function (e) {
      console.warn('⚠️ FavoritesDB add error:', e);
      return false;
    });
  }

  function remove(id, mediaType) {
    var key = makeKey(id, mediaType);
    if (!key) return Promise.resolve(false);

    return runTx('readwrite', function (store) {store.delete(key);return true;}).
    then(function () {
      if (keyIndex) delete keyIndex[key];
      return true;
    }).
    catch(function (e) {
      console.warn('⚠️ FavoritesDB remove error:', e);
      return false;
    });
  }





  function toggle(item) {
    var id = item && (item.id !== undefined ? item.id : item.tmdbId);
    var mt = item && item.media_type;
    if (has(id, mt)) return remove(id, mt).then(function () {return false;});
    return add(item).then(function (ok) {return !!ok;});
  }


  function list() {
    return runTx('readonly', function (store) {
      var out = { __req: store.getAll() };
      return out;
    }).then(function (items) {
      if (!items || !items.length) return [];
      items.sort(function (a, b) {return (b.addedAt || 0) - (a.addedAt || 0);});
      return items;
    }).catch(function (e) {
      console.warn('⚠️ FavoritesDB list error:', e);
      return [];
    });
  }

  function clear() {
    return runTx('readwrite', function (store) {store.clear();return true;}).
    then(function () {keyIndex = {};return true;}).
    catch(function () {return false;});
  }

  function count() {
    return keyIndex ? Object.keys(keyIndex).length : 0;
  }

  window.FavoritesDB = {
    ready: ready,
    has: has,
    add: add,
    remove: remove,
    toggle: toggle,
    list: list,
    clear: clear,
    count: count
  };


  ready();
})();
