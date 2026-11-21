/* Сборка для старых браузеров (Chrome 53) из js/magnet-store.js — tools/legacy-build/build.js. Руками не править. */
(function () {
  'use strict';

  var DB_NAME = 'TorrentMagnetsDB';
  var DB_VERSION = 1;
  var STORE_NAME = 'magnets';
  var MAX_RECORDS = 1000;
  var VERIFIED_TTL_MS = 15000;
  var CHECK_TIMEOUT_MS = 4000;
  var dbPromise = null;
  var verifiedAt = {};
  var inFlight = {};
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB недоступна'));
        return;
      }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          var store = db.createObjectStore(STORE_NAME, {
            keyPath: 'hash'
          });
          store.createIndex('savedAt', 'savedAt', {
            unique: false
          });
        }
      };
      req.onsuccess = function (e) {
        resolve(e.target.result);
      };
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
  function hasTrackers(magnet) {
    return /[?&]tr=/i.test(String(magnet || ''));
  }
  function getRecord(hash) {
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        var req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(hash);
        req.onsuccess = function () {
          resolve(req.result || null);
        };
        req.onerror = function () {
          resolve(null);
        };
      });
    })['catch'](function () {
      return null;
    });
  }
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
    } catch (e) {}
  }
  function remember(hash, magnet, meta) {
    var h = normHash(hash);
    if (!h || !hasTrackers(magnet)) return Promise.resolve(false);
    meta = meta || {};
    var rec = {
      hash: h,
      magnet: String(magnet),
      savedAt: Date.now()
    };
    ['title', 'category', 'poster', 'tmdb_id', 'seasons'].forEach(function (k) {
      if (meta[k] !== undefined && meta[k] !== null && meta[k] !== '') rec[k] = meta[k];
    });
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(rec);
        tx.oncomplete = function () {
          prune(db);
          resolve(true);
        };
        tx.onerror = tx.onabort = function () {
          resolve(false);
        };
      });
    })['catch'](function () {
      return false;
    });
  }
  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () {
        reject(new Error('timeout'));
      }, ms);
      promise.then(function (v) {
        clearTimeout(t);
        resolve(v);
      }, function (e) {
        clearTimeout(t);
        reject(e);
      });
    });
  }
  function postTorrents(body) {
    return torrServerFetch('/torrents', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }
  function torrServerHas(hash) {
    return withTimeout(postTorrents({
      action: 'get',
      hash: hash
    }), CHECK_TIMEOUT_MS).then(function (r) {
      if (r.status === 404) return false;
      if (r.ok) {
        return r.json().then(function (t) {
          return !!(t && String(t.hash || '').toLowerCase() === hash);
        }, function () {
          return null;
        });
      }
      return withTimeout(postTorrents({
        action: 'list'
      }), CHECK_TIMEOUT_MS).then(function (lr) {
        if (!lr.ok) return null;
        return lr.json().then(function (list) {
          if (!Array.isArray(list)) return null;
          for (var i = 0; i < list.length; i++) {
            if (String(list[i].hash || '').toLowerCase() === hash) return true;
          }
          return false;
        });
      });
    })['catch'](function () {
      return null;
    });
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
    })['catch'](function () {
      return false;
    });
  }
  function ensure(hash) {
    var h = normHash(hash);
    if (!h || typeof torrServerFetch !== 'function' || !(window.AppState && AppState.currentTorrserverUrl)) return Promise.resolve(false);
    if (verifiedAt[h] && Date.now() - verifiedAt[h] < VERIFIED_TTL_MS) return Promise.resolve(false);
    if (inFlight[h]) return inFlight[h];
    var p = getRecord(h).then(function (rec) {
      if (!rec) return false;
      return torrServerHas(h).then(function (has) {
        if (has === true) {
          verifiedAt[h] = Date.now();
          return false;
        }
        if (has === null) return false;
        console.log('🧲 Раздачи нет в TorrServer — добавляем снова полным magnet:', h);
        return reAdd(rec).then(function (ok) {
          if (ok) verifiedAt[h] = Date.now();else console.warn('🧲 Не удалось добавить раздачу magnet-ссылкой:', h);
          return ok;
        });
      });
    })['catch'](function () {
      return false;
    });
    inFlight[h] = p;
    p.then(function () {
      delete inFlight[h];
    });
    return p;
  }
  function forget(hash) {
    var h = normHash(hash);
    if (h) delete verifiedAt[h];
  }
  window.MagnetStore = {
    remember: remember,
    ensure: ensure,
    forget: forget,
    get: function (hash) {
      var h = normHash(hash);
      return h ? getRecord(h) : Promise.resolve(null);
    }
  };
})();
