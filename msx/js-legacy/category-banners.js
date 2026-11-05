/* Сборка для старых браузеров (Chrome 53) из js/category-banners.js — tools/legacy-build/build.js. Руками не править. */
(function () {
  'use strict';

  var CB = {
    TTL_MS: 24 * 60 * 60 * 1000,
    BANNER_SIZE: 10,
    CANDIDATES: 40,
    CHECK_BATCH: 4,
    FETCH_TIMEOUT_MS: 10000
  };
  var memory = {};
  var inflight = {};
  function serverUrl() {
    return window.SERVER_URL || window.location.origin;
  }
  function itemKey(item) {
    return String(item.id) + '_' + (item.media_type === 'tv' ? 'tv' : 'movie');
  }
  function fetchJson(url) {
    return new Promise(function (resolve) {
      var ctrl = null;
      try {
        ctrl = new AbortController();
      } catch (e) {
        ctrl = null;
      }
      var timer = setTimeout(function () {
        if (ctrl) {
          try {
            ctrl.abort();
          } catch (e) {}
        }
      }, CB.FETCH_TIMEOUT_MS);
      var init = ctrl ? {
        signal: ctrl.signal
      } : {};
      (window.bgFetch ? window.bgFetch(url, init) : fetch(url, init)).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (d) {
        clearTimeout(timer);
        resolve(d);
      }).catch(function () {
        clearTimeout(timer);
        resolve(null);
      });
    });
  }
  var DB_NAME = 'CategoryBannersDB';
  var DB_VERSION = 1;
  var DB_STORE = 'banners';
  var ITEMS_SCHEMA_VERSION = 1;
  var dbPromise = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      if (!window.indexedDB) {
        resolve(null);
        return;
      }
      var req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        resolve(null);
        return;
      }
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          db.createObjectStore(DB_STORE, {
            keyPath: 'key'
          });
        }
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        resolve(null);
      };
      req.onblocked = function () {
        resolve(null);
      };
    });
    return dbPromise;
  }
  function dbGet(key) {
    return openDb().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        try {
          var rq = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
          rq.onsuccess = function () {
            resolve(rq.result || null);
          };
          rq.onerror = function () {
            resolve(null);
          };
        } catch (e) {
          resolve(null);
        }
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
            key: key,
            items: items,
            ts: Date.now(),
            v: ITEMS_SCHEMA_VERSION
          });
          tx.oncomplete = function () {
            resolve();
          };
          tx.onerror = function () {
            resolve();
          };
          tx.onabort = function () {
            resolve();
          };
        } catch (e) {
          resolve();
        }
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
          tx.oncomplete = function () {
            resolve();
          };
          tx.onerror = function () {
            resolve();
          };
          tx.onabort = function () {
            resolve();
          };
        } catch (e) {
          resolve();
        }
      });
    });
  }
  function loadCandidates(key) {
    var cfg = typeof CATALOG_CONFIG !== 'undefined' ? CATALOG_CONFIG[key] : null;
    if (!cfg || !cfg.url) return Promise.resolve([]);
    return fetchJson(cfg.url + '/items?from=0&limit=' + CB.CANDIDATES).then(function (d) {
      return d && d.success && d.items ? d.items : [];
    });
  }
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
      return fetchJson(serverUrl() + '/api/tmdb/logo' + q).then(function (l) {
        if (l && l.logo && l.logo.file_path) item.logo = {
          file_path: l.logo.file_path
        };
        return item;
      });
    });
  }
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
      var loose = [];
      var at = 0;
      var notified = false;
      function step() {
        if (strict.length >= CB.BANNER_SIZE || at >= cand.length) {
          return strict.length ? strict : loose.slice(0, CB.BANNER_SIZE);
        }
        var batch = cand.slice(at, at + CB.CHECK_BATCH);
        at += batch.length;
        return Promise.all(batch.map(checkCandidate)).then(function (res) {
          for (var j = 0; j < res.length; j++) {
            var r = res[j];
            if (!r) continue;
            if (r.logo) {
              if (strict.length < CB.BANNER_SIZE) strict.push(r);
            } else if (loose.length < CB.BANNER_SIZE) loose.push(r);
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
  function get(key, onFirst) {
    if (memory[key]) return Promise.resolve(memory[key]);
    if (inflight[key]) return inflight[key];
    var p = dbGet(key).then(function (rec) {
      var fresh = rec && rec.items && rec.items.length && rec.v === ITEMS_SCHEMA_VERSION && Date.now() - (rec.ts || 0) < CB.TTL_MS;
      if (fresh) return rec.items;
      return collect(key, onFirst).then(function (items) {
        if (items.length) {
          dbPut(key, items);
          return items;
        }
        return rec && rec.items ? rec.items : [];
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
  function peek(key) {
    return memory[key] || null;
  }
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
