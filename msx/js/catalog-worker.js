// catalog-worker.js — Web Worker для вычислений и сети
// Совместим с Chromium 70+ (Android TV)
// НЕ имеет доступа к DOM, localStorage, IntersectionObserver

'use strict';

// ==================== КОНСТАНТЫ ====================
var WORKER_CONSTANTS = {
  CACHE_TTL_MS: 3600000,
  FETCH_TIMEOUT_MS: 5000,
  CATALOG_CACHE_TTL_MS: 3600000,
  MAX_POSTER_CACHE: 400, // только строки-URL, ~50 КБ; см. CATALOG_CONSTANTS в catalog.js
  TMDB_MAX_CACHE_SIZE: 10,
  TMDB_CLEANUP_INTERVAL_MS: 300000,
  MAX_ACTORS: 12,
  MAX_RECOMMENDATIONS: 12,
  MAX_TRAILERS: 6,
  IMG_SIZES: {
    POSTER_CARD: 'w200',
    POSTER_SMALL: 'w185',
    POSTER_MEDIUM: 'w200',
    BACKDROP: 'w1280'
  }
};

var TMDB_GENRES = {
  movie: { 28: 'Боевик', 12: 'Приключения', 16: 'Анимация', 35: 'Комедия', 80: 'Криминал', 99: 'Документальный', 18: 'Драма', 10751: 'Семейный', 14: 'Фэнтези', 36: 'История', 27: 'Ужасы', 10402: 'Музыка', 9648: 'Детектив', 10749: 'Мелодрама', 878: 'Фантастика', 10770: 'ТВ фильм', 53: 'Триллер', 10752: 'Военный', 37: 'Вестерн' },
  tv: { 10759: 'Боевик', 16: 'Анимация', 35: 'Комедия', 80: 'Криминал', 99: 'Документальный', 18: 'Драма', 10751: 'Семейный', 10762: 'Детский', 9648: 'Детектив', 10763: 'Новости', 10764: 'Реалити', 10765: 'Фантастика', 10766: 'Мыльная опера', 10767: 'Ток-шоу', 10768: 'Война и политика', 37: 'Вестерн' }
};

// ==================== LRU КЭШ (в Worker) ====================
function LRUCache(maxSize) {
  this.maxSize = maxSize || 100;
  this.cache = new Map();
}

LRUCache.prototype.get = function (key) {
  if (!this.cache.has(key)) return undefined;
  var value = this.cache.get(key);
  this.cache.delete(key);
  this.cache.set(key, value);
  return value;
};

LRUCache.prototype.set = function (key, value) {
  if (this.cache.has(key)) {
    this.cache.delete(key);
  } else if (this.cache.size >= this.maxSize) {
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

// ==================== TMDB КЭШ ====================
var tmdbCache = {};
var posterUrlCache = new LRUCache(WORKER_CONSTANTS.MAX_POSTER_CACHE);
var catalogDataCache = new Map();

var TMDB_CACHE_CONFIG = {
  ttl: WORKER_CONSTANTS.CACHE_TTL_MS,
  maxSize: WORKER_CONSTANTS.TMDB_MAX_CACHE_SIZE,
  cleanupInterval: WORKER_CONSTANTS.TMDB_CLEANUP_INTERVAL_MS,
  enabled: true
};

function getTmdbCacheKey(endpoint, params) {
  var keys = Object.keys(params).sort();
  var sorted = {};
  for (var i = 0; i < keys.length; i++) sorted[keys[i]] = params[keys[i]];
  return endpoint + ':' + JSON.stringify(sorted);
}

function getFromTmdbCache(endpoint, params) {
  if (!TMDB_CACHE_CONFIG.enabled) return null;
  var key = getTmdbCacheKey(endpoint, params);
  var cached = tmdbCache[key];
  if (cached && (Date.now() - cached.timestamp < TMDB_CACHE_CONFIG.ttl)) {
    return cached.data;
  }
  if (cached) delete tmdbCache[key];
  return null;
}

function saveToTmdbCache(endpoint, params, data) {
  if (!TMDB_CACHE_CONFIG.enabled) return;
  var key = getTmdbCacheKey(endpoint, params);
  if (Object.keys(tmdbCache).length >= TMDB_CACHE_CONFIG.maxSize) cleanOldTmdbCache();
  tmdbCache[key] = { data: data, timestamp: Date.now() };
}

function cleanOldTmdbCache() {
  var now = Date.now();
  var keys = Object.keys(tmdbCache);
  if (keys.length === 0) return;
  var expired = [];
  for (var i = 0; i < keys.length; i++) {
    if (now - tmdbCache[keys[i]].timestamp >= TMDB_CACHE_CONFIG.ttl) expired.push(keys[i]);
  }
  for (var j = 0; j < expired.length; j++) delete tmdbCache[expired[j]];
  keys = Object.keys(tmdbCache);
  if (keys.length >= TMDB_CACHE_CONFIG.maxSize) {
    var entries = keys.map(function (k) { return { k: k, t: tmdbCache[k].timestamp }; });
    entries.sort(function (a, b) { return a.t - b.t; });
    var toRemove = keys.length - TMDB_CACHE_CONFIG.maxSize + 15;
    for (var r = 0; r < toRemove && r < entries.length; r++) delete tmdbCache[entries[r].k];
  }
}

function clearTmdbCache() { tmdbCache = {}; }

function getTmdbCacheStats() {
  var now = Date.now(), valid = 0, expired = 0, size = 0;
  var keys = Object.keys(tmdbCache);
  for (var i = 0; i < keys.length; i++) {
    var v = tmdbCache[keys[i]];
    size += JSON.stringify(v.data).length;
    (now - v.timestamp < TMDB_CACHE_CONFIG.ttl ? valid++ : expired++);
  }
  return {
    totalEntries: keys.length, validEntries: valid, expiredEntries: expired,
    totalSizeMB: (size / 1048576).toFixed(2), maxSize: TMDB_CACHE_CONFIG.maxSize,
    ttlHours: TMDB_CACHE_CONFIG.ttl / 3600000, enabled: TMDB_CACHE_CONFIG.enabled
  };
}

// ==================== СЕТЬ (fetch в Worker) ====================
function safeFetch(url, options, fallback) {
  options = options || {};
  var timeout = options.timeout || WORKER_CONSTANTS.FETCH_TIMEOUT_MS;
  var controller = new AbortController();
  var timeoutId = setTimeout(function () { controller.abort(); }, timeout);

  // Копируем options (method, headers, body), исключая служебный timeout
  var fetchOptions = {};
  for (var k in options) {
    if (options.hasOwnProperty(k) && k !== 'timeout') fetchOptions[k] = options[k];
  }
  fetchOptions.signal = controller.signal;

  return fetch(url, fetchOptions)
    .then(function (resp) {
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return resp.json();
    })
    .catch(function (e) {
      if (e.name === 'AbortError') {
        // timeout — молча
      }
      return fallback !== undefined ? fallback : null;
    })
    .finally(function () {
      clearTimeout(timeoutId);
    });
}

// ==================== ОБРАБОТКА ДАННЫХ ====================
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

function getNormalizedCatalogGenres(src) {
  if (!src) return [];
  var list = [];
  var mt = (src.media_type || ((src.types && src.types.indexOf('tv') !== -1) ? 'tv' : 'movie')) === 'tv' ? 'tv' : 'movie';
  var map = TMDB_GENRES[mt] || TMDB_GENRES.movie;
  if (Array.isArray(src.genres)) for (var i = 0; i < src.genres.length; i++) { var g = src.genres[i]; if (g) list.push(String(g.name || g).trim()); }
  if (Array.isArray(src.genre_ids)) for (var j = 0; j < src.genre_ids.length; j++) { var id = src.genre_ids[j]; if (map[id] || map[String(id)]) list.push(String(map[id] || map[String(id)]).trim()); }
  if (src.genre) list.push(String(src.genre).trim());
  if (src.genre_name) list.push(String(src.genre_name).trim());
  var u = [];
  for (var k = 0; k < list.length; k++) if (list[k] && u.indexOf(list[k]) === -1) u.push(list[k]);
  return u;
}

function getCatalogRating(item) {
  var v = Number(item && item.vote_average);
  return Number.isFinite(v) && v > 0 ? (Math.round(v * 10) / 10).toFixed(1) : '';
}

function getSafeCatalogRating(s) {
  var r = Number((s && s.vote_average) || (s && s.rating) || (s && s.tmdb_rating));
  return Number.isFinite(r) && r > 0 && r <= 10 ? Math.round(r * 10) / 10 : null;
}

function mergeCatalogDetails(base) {
  var m = {};
  for (var k in base) if (base.hasOwnProperty(k)) m[k] = base[k];
  for (var i = 1; i < arguments.length; i++) {
    var src = arguments[i];
    if (!src || typeof src !== 'object') continue;
    for (var k2 in src) {
      if (!src.hasOwnProperty(k2)) continue;
      var v = src[k2];
      if (v === null || v === undefined) continue;
      if (Array.isArray(v)) { if (!Array.isArray(m[k2]) || m[k2].length === 0) m[k2] = v.slice(); continue; }
      if (typeof v === 'string') { if (!m[k2] || !String(m[k2]).trim()) m[k2] = v; continue; }
      if (typeof v === 'number') { if (!m[k2]) m[k2] = v; continue; }
      if (typeof v === 'object') {
        if (!m[k2]) m[k2] = {};
        for (var sk in v) if (v.hasOwnProperty(sk)) m[k2][sk] = v[sk];
      }
    }
  }
  return m;
}

// ==================== IndexedDB: кэш TMDB details ====================
var TMDB_DETAILS_DB = {
  name: 'TmdbDetailsCacheDB',
  version: 1,
  store: 'details',
  maxItems: 500,
  maxAgeMs: 30 * 24 * 60 * 60 * 1000 // 30 дней
};

var tmdbDetailsDbPromise = null;

function openTmdbDetailsDb() {
  if (tmdbDetailsDbPromise) return tmdbDetailsDbPromise;

  tmdbDetailsDbPromise = new Promise(function (resolve, reject) {
    var req = self.indexedDB.open(TMDB_DETAILS_DB.name, TMDB_DETAILS_DB.version);

    req.onupgradeneeded = function (e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains(TMDB_DETAILS_DB.store)) {
        var store = db.createObjectStore(TMDB_DETAILS_DB.store, { keyPath: 'key' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    req.onsuccess = function (e) { resolve(e.target.result); };
    req.onerror = function () {
      tmdbDetailsDbPromise = null;
      reject(req.error);
    };
  });

  return tmdbDetailsDbPromise;
}

function tmdbDetailsGet(key) {
  return openTmdbDetailsDb().then(function (db) {
    return new Promise(function (resolve) {
      var tx = db.transaction(TMDB_DETAILS_DB.store, 'readonly');
      var req = tx.objectStore(TMDB_DETAILS_DB.store).get(key);
      req.onsuccess = function () {
        var row = req.result;
        if (!row) return resolve(null);
        if (Date.now() - row.timestamp > TMDB_DETAILS_DB.maxAgeMs) return resolve(null);
        resolve(row.data || null);
      };
      req.onerror = function () { resolve(null); };
    });
  }).catch(function () { return null; });
}

function tmdbDetailsSet(key, data) {
  if (!data) return Promise.resolve();
  return openTmdbDetailsDb().then(function (db) {
    return new Promise(function (resolve) {
      var tx = db.transaction(TMDB_DETAILS_DB.store, 'readwrite');
      tx.objectStore(TMDB_DETAILS_DB.store).put({
        key: key,
        data: data,
        timestamp: Date.now()
      });
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { resolve(); };
      tx.onabort = function () { resolve(); };
    });
  }).then(function () {
    if (Math.random() < 0.05) tmdbDetailsTrim();
  }).catch(function () { });
}

function tmdbDetailsTrim() {
  return openTmdbDetailsDb().then(function (db) {
    return new Promise(function (resolve) {
      var tx = db.transaction(TMDB_DETAILS_DB.store, 'readwrite');
      var store = tx.objectStore(TMDB_DETAILS_DB.store);
      var countReq = store.count();
      countReq.onsuccess = function () {
        var total = countReq.result;
        if (total <= TMDB_DETAILS_DB.maxItems) { resolve(); return; }
        var cursorReq = store.index('timestamp').openCursor();
        var toDelete = total - TMDB_DETAILS_DB.maxItems + 50;
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
      countReq.onerror = function () { resolve(); };
    });
  }).catch(function () { });
}

function tmdbDetailsClear() {
  return openTmdbDetailsDb().then(function (db) {
    return new Promise(function (resolve) {
      var tx = db.transaction(TMDB_DETAILS_DB.store, 'readwrite');
      tx.objectStore(TMDB_DETAILS_DB.store).clear();
      tx.oncomplete = function () { resolve({ success: true }); };
      tx.onerror = function () { resolve({ success: false }); };
    });
  }).catch(function () { return { success: false }; });
}

function tmdbDetailsStats() {
  return openTmdbDetailsDb().then(function (db) {
    return new Promise(function (resolve) {
      var tx = db.transaction(TMDB_DETAILS_DB.store, 'readonly');
      var countReq = tx.objectStore(TMDB_DETAILS_DB.store).count();
      countReq.onsuccess = function () {
        resolve({ total: countReq.result, max: TMDB_DETAILS_DB.maxItems });
      };
      countReq.onerror = function () { resolve({ total: 0, max: TMDB_DETAILS_DB.maxItems }); };
    });
  }).catch(function () { return { total: 0, max: TMDB_DETAILS_DB.maxItems }; });
}

// ==================== TMDB ЗАПРОСЫ ====================
// Details, cast and recommendations often request the same item together.
// Keep one in-flight request per item and share its result between consumers.
var tmdbDetailsInFlight = {};

function workerFetchTmdbDetailsUncached(item) {
  var id = item && item.id, type = (item && item.media_type) || 'movie';
  if (!id) return Promise.resolve(null);

  var p = { id: id, type: type };

  // 1. In-memory кэш (мгновенно)
  var cached = getFromTmdbCache('details', p);
  if (cached !== null) return Promise.resolve(cached);

  var idbKey = id + '_' + type;
  var detailsUrl = '/api/tmdb/details?id=' + encodeURIComponent(id) + '&type=' + encodeURIComponent(type);
  var itemUrl = '/api/tmdb/item?id=' + encodeURIComponent(id) + '&type=' + encodeURIComponent(type);

  function isValidDetails(d) {
    if (!d) return false;
    return !!(d.id || d.overview || d.videos || d.backdrops || d.cast ||
      (d.recommendations && d.recommendations.length > 0));
  }

  function saveEverywhere(data) {
    saveToTmdbCache('details', p, data);
    tmdbDetailsSet(idbKey, data);
    return data;
  }

  // 2. IndexedDB
  return tmdbDetailsGet(idbKey).then(function (idbRow) {
    if (isValidDetails(idbRow)) {
      saveToTmdbCache('details', p, idbRow);
      return idbRow;
    }

    // 3. Сеть — сначала details (он богаче: recommendations, videos, cast)
    return safeFetch(detailsUrl).then(function (d) {
      if (isValidDetails(d)) {
        return saveEverywhere(d);
      }

      // 4. Fallback на /api/tmdb/item
      return safeFetch(itemUrl).then(function (d2) {
        if (isValidDetails(d2)) {
          // Мерджим с IDB, если там было что-то полезное
          var merged = (idbRow && idbRow.poster_path && !d2.poster_path)
            ? mergeCatalogDetails(idbRow, d2)
            : d2;
          return saveEverywhere(merged);
        }

        // Ничего из сети — возвращаем то, что было в IDB
        if (idbRow) {
          saveToTmdbCache('details', p, idbRow);
          return idbRow;
        }
        return null;
      });
    });
  });
}

function workerFetchTmdbDetails(item) {
  var id = item && item.id, type = (item && item.media_type) || 'movie';
  if (!id) return Promise.resolve(null);

  var p = { id: id, type: type };
  var cached = getFromTmdbCache('details', p);
  if (cached !== null) return Promise.resolve(cached);

  var key = String(id) + '_' + type;
  if (tmdbDetailsInFlight[key]) return tmdbDetailsInFlight[key];

  var request = workerFetchTmdbDetailsUncached(item);
  tmdbDetailsInFlight[key] = request;
  return request.then(function (data) {
    delete tmdbDetailsInFlight[key];
    return data;
  }, function (error) {
    delete tmdbDetailsInFlight[key];
    throw error;
  });
}

function workerFetchCatalogActors(item) {
  var id = item && item.id, type = (item && item.media_type) || 'movie';
  if (!id) return Promise.resolve([]);
  var p = { id: id, type: type };
  var cached = getFromTmdbCache('actors', p);
  if (cached !== null) return Promise.resolve(cached);

  return workerFetchTmdbDetails(item).then(function (data) {
    var actors = [];
    if (data && data.cast && Array.isArray(data.cast)) {
      var limit = Math.min(WORKER_CONSTANTS.MAX_ACTORS, data.cast.length);
      for (var i = 0; i < limit; i++) {
        var a = data.cast[i];
        actors.push({ id: a.id, name: a.name, character: a.character, profilePath: a.profile_path, order: a.order });
      }
    }
    saveToTmdbCache('actors', p, actors);
    return actors;
  }).catch(function () { return []; });
}

function workerFetchCatalogItemDetails(item) {
  var p = {
    id: item && item.id,
    media_type: (item && item.media_type) || 'movie',
    title: getCatalogItemTitle(item)
  };

  var c = getFromTmdbCache('itemDetails', p);
  if (c !== null) return Promise.resolve(c);

  return workerFetchTmdbDetails(item).then(function (tmdb) {
    var merged = mergeCatalogDetails(item, tmdb);

    // Если рекомендаций нет — пробуем отдельный запрос
    if (!merged.recommendations || merged.recommendations.length === 0) {
      var id = item && item.id;
      var type = (item && item.media_type) || 'movie';
      if (id) {
        var recUrl = '/api/tmdb/details?id=' + encodeURIComponent(id) +
          '&type=' + encodeURIComponent(type);
        return safeFetch(recUrl).then(function (recData) {
          if (recData && recData.recommendations && recData.recommendations.length > 0) {
            merged.recommendations = recData.recommendations;
          }
          saveToTmdbCache('itemDetails', p, merged);
          return merged;
        }).catch(function () {
          saveToTmdbCache('itemDetails', p, merged);
          return merged;
        });
      }
    }

    saveToTmdbCache('itemDetails', p, merged);
    return merged;
  });
}

function workerFetchCatalogItemMeta(item, mediaType) {
  mediaType = mediaType || 'movie';
  var title = getCatalogItemTitle(item), year = getCatalogItemYear(item);
  var p = { title: title, year: year, mediaType: mediaType, tmdbId: item && item.id };
  var c = getFromTmdbCache('itemMeta', p);
  if (c !== null) return Promise.resolve(c);

  var best = {};
  for (var k in item) if (item.hasOwnProperty(k)) best[k] = item[k];

  var url = '/api/tmdb/search?query=' + encodeURIComponent(title) + '&type=' + mediaType + (year ? '&year=' + year : '');
  return safeFetch(url).then(function (d) {
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
  });
}

// ==================== IndexedDB: кэш /api/tmdb/item ====================
var TMDB_ITEM_DB = {
  name: 'TmdbItemCacheDB',
  version: 1,
  store: 'items',
  maxItems: 500,
  maxAgeMs: 30 * 24 * 60 * 60 * 1000 // 30 дней
};

var tmdbItemDbPromise = null;

function openTmdbItemDb() {
  if (tmdbItemDbPromise) return tmdbItemDbPromise;

  tmdbItemDbPromise = new Promise(function (resolve, reject) {
    var req = self.indexedDB.open(TMDB_ITEM_DB.name, TMDB_ITEM_DB.version);

    req.onupgradeneeded = function (e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains(TMDB_ITEM_DB.store)) {
        var store = db.createObjectStore(TMDB_ITEM_DB.store, { keyPath: 'key' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    req.onsuccess = function (e) { resolve(e.target.result); };
    req.onerror = function () {
      tmdbItemDbPromise = null;
      reject(req.error);
    };
  });

  return tmdbItemDbPromise;
}

function tmdbItemGet(key) {
  return openTmdbItemDb().then(function (db) {
    return new Promise(function (resolve) {
      var tx = db.transaction(TMDB_ITEM_DB.store, 'readonly');
      var req = tx.objectStore(TMDB_ITEM_DB.store).get(key);
      req.onsuccess = function () {
        var row = req.result;
        if (!row) return resolve(null);
        if (Date.now() - row.timestamp > TMDB_ITEM_DB.maxAgeMs) return resolve(null);
        resolve(row.data || null);
      };
      req.onerror = function () { resolve(null); };
    });
  }).catch(function () { return null; });
}

function tmdbItemSet(key, data) {
  if (!data) return Promise.resolve();
  return openTmdbItemDb().then(function (db) {
    return new Promise(function (resolve) {
      var tx = db.transaction(TMDB_ITEM_DB.store, 'readwrite');
      tx.objectStore(TMDB_ITEM_DB.store).put({
        key: key,
        data: data,
        timestamp: Date.now()
      });
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { resolve(); };
      tx.onabort = function () { resolve(); };
    });
  }).then(function () {
    if (Math.random() < 0.05) tmdbItemTrim();
  }).catch(function () { });
}

function tmdbItemTrim() {
  return openTmdbItemDb().then(function (db) {
    return new Promise(function (resolve) {
      var tx = db.transaction(TMDB_ITEM_DB.store, 'readwrite');
      var store = tx.objectStore(TMDB_ITEM_DB.store);
      var countReq = store.count();
      countReq.onsuccess = function () {
        var total = countReq.result;
        if (total <= TMDB_ITEM_DB.maxItems) { resolve(); return; }
        var cursorReq = store.index('timestamp').openCursor();
        var toDelete = total - TMDB_ITEM_DB.maxItems + 50;
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
      countReq.onerror = function () { resolve(); };
    });
  }).catch(function () { });
}

function tmdbItemClear() {
  return openTmdbItemDb().then(function (db) {
    return new Promise(function (resolve) {
      var tx = db.transaction(TMDB_ITEM_DB.store, 'readwrite');
      tx.objectStore(TMDB_ITEM_DB.store).clear();
      tx.oncomplete = function () { resolve({ success: true }); };
      tx.onerror = function () { resolve({ success: false }); };
    });
  }).catch(function () { return { success: false }; });
}

function tmdbItemStats() {
  return openTmdbItemDb().then(function (db) {
    return new Promise(function (resolve) {
      var tx = db.transaction(TMDB_ITEM_DB.store, 'readonly');
      var countReq = tx.objectStore(TMDB_ITEM_DB.store).count();
      countReq.onsuccess = function () {
        resolve({ total: countReq.result, max: TMDB_ITEM_DB.maxItems });
      };
      countReq.onerror = function () { resolve({ total: 0, max: TMDB_ITEM_DB.maxItems }); };
    });
  }).catch(function () { return { total: 0, max: TMDB_ITEM_DB.maxItems }; });
}

// ==================== ПОСТЕРЫ: helper'ы ====================

function normalizeProtocol(protocol) {
  var p = String(protocol || 'https:').replace(/\/+$/, '');
  if (p.indexOf(':') === -1) p += ':';
  return p;
}

function buildPosterUrl(posterPath, protocol, size) {
  if (!posterPath) return null;

  if (posterPath.indexOf('http') === 0) {
    return posterPath;
  }

  var path = posterPath.charAt(0) === '/' ? posterPath : '/' + posterPath;
  var finalSize = size ||
    WORKER_CONSTANTS.IMG_SIZES.POSTER_CARD ||
    WORKER_CONSTANTS.IMG_SIZES.POSTER_MEDIUM ||
    'w185';

  return normalizeProtocol(protocol) + '//tsimg.hnar.online/t/p/' + finalSize + path;
}

function normalizePosterUrl(url, protocol, size) {
  if (!url) return '';

  if (url.indexOf('http') !== 0) return url;

  var proto = normalizeProtocol(protocol);
  var finalSize = size ||
    WORKER_CONSTANTS.IMG_SIZES.POSTER_CARD ||
    WORKER_CONSTANTS.IMG_SIZES.POSTER_MEDIUM ||
    'w185';

  if (url.indexOf('tsimg.hnar.online/t/p/') !== -1) {
    url = url.replace(/^https?:/, proto);
    url = url.replace(/\/t\/p\/[^/]+\//, '/t/p/' + finalSize + '/');
  }

  return url;
}

function pickSearchPosterPath(results, id) {
  var first = null;

  for (var i = 0; i < results.length; i++) {
    var r = results[i];

    if (!r || !r.poster_path) continue;

    if (id && String(r.id) === String(id)) {
      return r.poster_path;
    }

    if (!first) {
      first = r.poster_path;
    }
  }

  return first;
}

// ==================== ПОСТЕРЫ: основная функция ====================

function workerFetchPosterUrl(payload) {
  payload = payload || {};

  var id = payload.id;
  var mt = payload.mt || 'movie';
  var title = payload.title || '';
  var protocol = normalizeProtocol(payload.protocol);
  var size = payload.size ||
    WORKER_CONSTANTS.IMG_SIZES.POSTER_CARD ||
    WORKER_CONSTANTS.IMG_SIZES.POSTER_MEDIUM ||
    'w185';

  var validId = !!(id && id !== 'undefined' && id !== 'null');

  var cacheKey =
    (validId ? id : 'title_' + (title || 'unknown')) +
    '_' + mt +
    '_' + size +
    '_' + protocol;

  var cachedUrl = posterUrlCache.get(cacheKey);

  if (cachedUrl) {
    return Promise.resolve({
      posterUrl: cachedUrl,
      source: 'worker-poster-cache'
    });
  }

  var tmdbParams = validId
    ? { id: id, type: mt }
    : { q: title || '', type: mt };

  var cachedTmdb = getFromTmdbCache('poster', tmdbParams);

  if (cachedTmdb && cachedTmdb.posterUrl) {
    var normalizedCachedUrl = normalizePosterUrl(
      cachedTmdb.posterUrl,
      protocol,
      size
    );

    posterUrlCache.set(cacheKey, normalizedCachedUrl);

    return Promise.resolve({
      posterUrl: normalizedCachedUrl,
      source: 'worker-tmdb-cache'
    });
  }

  function saveAndReturn(url) {
    if (!url) {
      return { posterUrl: null };
    }

    var finalUrl = normalizePosterUrl(url, protocol, size);

    saveToTmdbCache('poster', tmdbParams, {
      posterUrl: finalUrl
    });

    posterUrlCache.set(cacheKey, finalUrl);

    return {
      posterUrl: finalUrl,
      source: 'worker-fetch'
    };
  }

  var byIdPromise = Promise.resolve(null);
  if (validId) {
    var itemKey = id + '_' + mt;

    byIdPromise = tmdbItemGet(itemKey).then(function (cachedItem) {
      // ★ Сначала IndexedDB — без сети
      if (cachedItem && cachedItem.poster_path) {
        return buildPosterUrl(cachedItem.poster_path, protocol, size);
      }

      // ★ Только при miss — сеть, и сразу пишем в IDB
      return safeFetch(
        '/api/tmdb/item?id=' + encodeURIComponent(id) + '&type=' + encodeURIComponent(mt)
      ).then(function (d) {
        if (d && d.poster_path) {
          tmdbItemSet(itemKey, d);
          return buildPosterUrl(d.poster_path, protocol, size);
        }
        return null;
      });
    });
  }

  return byIdPromise.then(function (url) {
    if (url) {
      return saveAndReturn(url);
    }

    if (!title) {
      return { posterUrl: null };
    }

    var searchUrl =
      '/api/tmdb/search?query=' + encodeURIComponent(title) +
      '&type=' + encodeURIComponent(mt);

    return safeFetch(searchUrl).then(function (d) {
      var posterPath = null;

      if (d && Array.isArray(d.results) && d.results.length > 0) {
        posterPath = pickSearchPosterPath(d.results, validId ? id : null);
      }

      if (posterPath) {
        return saveAndReturn(buildPosterUrl(posterPath, protocol, size));
      }

      return { posterUrl: null };
    });
  }).catch(function () {
    return { posterUrl: null };
  });
}

// ==================== ПОСТЕРЫ: БАТЧ-ЗАГРУЗКА ====================
var POSTER_BATCH_HTTP_LIMIT = 50;           // макс. id в одном HTTP-запросе
var POSTER_BATCH_FALLBACK_CONCURRENCY = 10;  // параллельных одиночных, если батч-эндпоинта нет
var batchEndpointSupported = true;          // сбрасывается при рестарте Worker'а

// Пакетное чтение из IndexedDB в ОДНОЙ транзакции
function tmdbItemGetMany(keys) {
  if (!keys || !keys.length) return Promise.resolve({});
  return openTmdbItemDb().then(function (db) {
    return new Promise(function (resolve) {
      var result = {};
      var pending = keys.length;
      var tx = db.transaction(TMDB_ITEM_DB.store, 'readonly');
      var store = tx.objectStore(TMDB_ITEM_DB.store);
      for (var i = 0; i < keys.length; i++) {
        (function (key) {
          var req = store.get(key);
          req.onsuccess = function () {
            var row = req.result;
            if (row && row.data && (Date.now() - row.timestamp <= TMDB_ITEM_DB.maxAgeMs)) {
              result[key] = row.data;
            }
            if (--pending === 0) resolve(result);
          };
          req.onerror = function () {
            if (--pending === 0) resolve(result);
          };
        })(keys[i]);
      }
    });
  }).catch(function () { return {}; });
}

// Толерантный парсинг ответа батч-эндпоинта
// Поддерживает: {items:[]}, {results:[]}, просто [], или map {"603":{...}}
function parsePosterBatchResponse(d) {
  var map = {};
  if (!d) return map;
  var list = null;
  if (Array.isArray(d)) list = d;
  else if (Array.isArray(d.items)) list = d.items;
  else if (Array.isArray(d.results)) list = d.results;
  if (list) {
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (it && it.id !== undefined && it.id !== null) map[String(it.id)] = it;
    }
    return map;
  }
  for (var k in d) {
    if (d.hasOwnProperty(k) && d[k] && typeof d[k] === 'object' &&
      typeof d[k].poster_path !== 'undefined') {
      map[String(k)] = d[k];
    }
  }
  return map;
}

// Фоллбэк: параллельные одиночные /api/tmdb/item (если батч-эндпоинта нет)
function fetchPostersIndividually(entries) {
  var map = {};
  var idx = 0;
  var active = 0;
  return new Promise(function (resolve) {
    function next() {
      if (idx >= entries.length && active === 0) { resolve(map); return; }
      while (active < POSTER_BATCH_FALLBACK_CONCURRENCY && idx < entries.length) {
        (function (entry) {
          active++;
          safeFetch('/api/tmdb/item?id=' + encodeURIComponent(entry.id) +
            '&type=' + encodeURIComponent(entry.mt))
            .then(function (d) {
              if (d && (d.id || d.poster_path)) {
                map[String(entry.id)] = d;
                tmdbItemSet(entry.id + '_' + entry.mt, d);
              }
            })
            .then(function () { active--; next(); });
        })(entries[idx]);
        idx++;
      }
    }
    next();
  });
}

// Один HTTP-запрос на чанк id
function fetchPosterChunk(chunk, mt) {
  if (!batchEndpointSupported) return fetchPostersIndividually(chunk);
  var ids = [];
  for (var i = 0; i < chunk.length; i++) ids.push(chunk[i].id);
  var url = '/api/tmdb/items?ids=' + encodeURIComponent(ids.join(',')) +
    '&type=' + encodeURIComponent(mt);
  var controller = new AbortController();
  var timeoutId = setTimeout(function () { controller.abort(); }, 10000);
  return fetch(url, { signal: controller.signal })
    .then(function (resp) {
      clearTimeout(timeoutId);
      if (resp.status === 404 || resp.status === 405) {
        // Эндпоинт ещё не развёрнут — переключаемся на параллельные одиночные
        batchEndpointSupported = false;
        return fetchPostersIndividually(chunk);
      }
      if (!resp.ok) return {};
      return resp.json().then(parsePosterBatchResponse);
    })
    .catch(function () {
      clearTimeout(timeoutId);
      return {};
    });
}

// Главная батч-функция: N постеров за минимум запросов
function workerFetchPosterUrlsBatch(payload) {
  payload = payload || {};
  var items = payload.items || [];
  var protocol = normalizeProtocol(payload.protocol);
  var size = payload.size ||
    WORKER_CONSTANTS.IMG_SIZES.POSTER_CARD ||
    WORKER_CONSTANTS.IMG_SIZES.POSTER_MEDIUM || 'w185';
  var results = {}; // ключ "id_mt" -> { posterUrl, source }
  if (!items.length) return Promise.resolve(results);

  var missing = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    var id = it.id;
    var mt = it.mt || 'movie';
    var validId = !!(id && id !== 'undefined' && id !== 'null');
    if (!validId) continue; // без id батчом нельзя — main thread решит отдельно
    id = String(id);
    var key = id + '_' + mt;
    var cacheKey = id + '_' + mt + '_' + size + '_' + protocol;

    // 1. memory LRU (формат ключа идентичен workerFetchPosterUrl)
    var cachedUrl = posterUrlCache.get(cacheKey);
    if (cachedUrl) {
      results[key] = { posterUrl: cachedUrl, source: 'worker-poster-cache' };
      continue;
    }
    // 2. TMDB-кэш
    var cachedTmdb = getFromTmdbCache('poster', { id: id, type: mt });
    if (cachedTmdb && cachedTmdb.posterUrl) {
      var normCached = normalizePosterUrl(cachedTmdb.posterUrl, protocol, size);
      posterUrlCache.set(cacheKey, normCached);
      results[key] = { posterUrl: normCached, source: 'worker-tmdb-cache' };
      continue;
    }
    missing.push({ id: id, mt: mt, key: key, cacheKey: cacheKey });
  }

  if (!missing.length) return Promise.resolve(results);

  // 3. IndexedDB — одна транзакция на все ключи
  var idbKeys = [];
  for (var m = 0; m < missing.length; m++) idbKeys.push(missing[m].id + '_' + missing[m].mt);

  return tmdbItemGetMany(idbKeys).then(function (idbMap) {
    var networkQueue = [];
    for (var i = 0; i < missing.length; i++) {
      var mi = missing[i];
      var cachedItem = idbMap[mi.id + '_' + mi.mt];
      if (cachedItem && cachedItem.poster_path) {
        var url = buildPosterUrl(cachedItem.poster_path, protocol, size);
        saveToTmdbCache('poster', { id: mi.id, type: mi.mt }, { posterUrl: url });
        posterUrlCache.set(mi.cacheKey, url);
        results[mi.key] = { posterUrl: url, source: 'worker-idb' };
      } else {
        networkQueue.push(mi);
      }
    }
    if (!networkQueue.length) return results;

    // 4. Сеть: группируем по media_type, режем на чанки по 50 id
    var groups = {};
    for (var g = 0; g < networkQueue.length; g++) {
      var gmt = networkQueue[g].mt;
      if (!groups[gmt]) groups[gmt] = [];
      groups[gmt].push(networkQueue[g]);
    }
    var chain = Promise.resolve();
    Object.keys(groups).forEach(function (gmt) {
      chain = chain.then(function () {
        var group = groups[gmt];
        var chunks = [];
        for (var c = 0; c < group.length; c += POSTER_BATCH_HTTP_LIMIT) {
          chunks.push(group.slice(c, c + POSTER_BATCH_HTTP_LIMIT));
        }
        var innerChain = Promise.resolve();
        chunks.forEach(function (chunk) {
          innerChain = innerChain.then(function () {
            return fetchPosterChunk(chunk, gmt).then(function (map) {
              for (var n = 0; n < chunk.length; n++) {
                var nq = chunk[n];
                var itemData = map[nq.id];
                if (!itemData) continue;
                // Сохраняем полный элемент в IDB (пригодится для деталей)
                if (itemData.id || itemData.overview || itemData.poster_path) {
                  tmdbItemSet(nq.id + '_' + nq.mt, itemData);
                }
                if (itemData.poster_path) {
                  var url2 = buildPosterUrl(itemData.poster_path, protocol, size);
                  saveToTmdbCache('poster', { id: nq.id, type: nq.mt }, { posterUrl: url2 });
                  posterUrlCache.set(nq.cacheKey, url2);
                  results[nq.key] = { posterUrl: url2, source: 'worker-network' };
                }
              }
            });
          });
        });
        return innerChain;
      });
    });
    return chain.then(function () { return results; });
  }).catch(function () {
    return results; // что успели найти — возвращаем
  });
}

// ==================== RUTUBE ТРЕЙЛЕРЫ ====================
function workerParseMaxQualityFromM3u8Url(url) {
  if (!url) return null;
  try {
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

function workerExtractBalancerUrl(playData) {
  if (!playData || !playData.video_balancer) return null;
  var vb = playData.video_balancer;
  return vb.default || vb.m3u8 || null;
}

function workerFetchRutubeTrailer(payload) {
  var title = payload.title || '';
  var originalTitle = payload.originalTitle || '';
  var releaseDate = payload.releaseDate || '';

  if (!title) return Promise.resolve(null);

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

  var searchApiUrl = 'https://rutube.ru/api/search/combined/video_playlist?query=' +
    encodeURIComponent(query) + '&duration=short&client=wdp&page=1';
  var searchUrl = '/api/rutube/proxy?url=' + encodeURIComponent(searchApiUrl);

  return safeFetch(searchUrl, { timeout: 10000 }).then(function (searchData) {
    if (!searchData || !Array.isArray(searchData.results) || searchData.results.length === 0) {
      return null;
    }

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

    // Последовательные запросы play/options
    var bestUrl = null;
    var bestQuality = null;
    var bestTitle = '';

    function fetchPlayOptions(index) {
      if (index >= matchedIds.length) {
        if (!bestUrl) return null;
        return { url: bestUrl, quality: bestQuality, title: bestTitle };
      }

      var playApiUrl = 'https://rutube.ru/api/play/options/' + matchedIds[index];
      var playProxyUrl = '/api/rutube/proxy?url=' + encodeURIComponent(playApiUrl);

      return safeFetch(playProxyUrl, { timeout: 10000 }).then(function (playData) {
        if (playData) {
          var balancerUrl = workerExtractBalancerUrl(playData);
          if (balancerUrl) {
            var quality = workerParseMaxQualityFromM3u8Url(balancerUrl);
            if (quality) {
              if (!bestQuality || quality.pixels > bestQuality.pixels) {
                bestUrl = balancerUrl;
                bestQuality = quality;
                bestTitle = playData.title || title;
              }
            }
          }
        }
        return fetchPlayOptions(index + 1);
      });
    }

    return fetchPlayOptions(0);
  }).catch(function () {
    return null;
  });
}

// ==================== ЗАГРУЗКА КАТАЛОГА ====================
function workerLoadCatalogItems(catalogUrl, from, limit, abortSignal) {
  var url = catalogUrl + '/items?from=' + from + '&limit=' + limit;
  return safeFetch(url, { timeout: WORKER_CONSTANTS.FETCH_TIMEOUT_MS })
    .then(function (d) {
      if (!d || !d.success) throw new Error('Server error');
      return d;
    });
}

function workerLoadAllCatalogItems(catalogUrl) {
  return safeFetch(catalogUrl + '/items', { timeout: 10000 })
    .then(function (d) {
      if (!d || !d.success) throw new Error('Server error');
      return d;
    });
}

function workerLoadHistory() {
  return safeFetch('/api/history', { timeout: WORKER_CONSTANTS.FETCH_TIMEOUT_MS });
}

function workerFetchAvailableCatalogs() {
  return safeFetch('/api/catalogs');
}

function workerCheckCatalogUpdate(id, iso) {
  if (!iso) return Promise.resolve(false);
  var h = (Date.now() - new Date(iso).getTime()) / 3600000;
  if (h > 6) {
    return safeFetch('/api/catalog/' + id + '/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: WORKER_CONSTANTS.FETCH_TIMEOUT_MS
    }).then(function (d) {
      return !!(d && d.success);
    }).catch(function () { return false; });
  }
  return Promise.resolve(false);
}

function workerSaveToHistory(id, title, mt, pp) {
  var save = pp || null;
  var pre = 'https://tsimg.hnar.online/t/p/' + WORKER_CONSTANTS.IMG_SIZES.POSTER_MEDIUM;
  if (save && save.indexOf(pre) === 0) save = save.replace(pre, '');
  return safeFetch('/api/history/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tmdbId: String(id), title: title, mediaType: mt, posterPath: save })
  });
}

function workerClearHistory() {
  return safeFetch('/api/history/clear', { method: 'DELETE' });
}

// ==================== ДЕДУПЛИКАЦИЯ ====================
function deduplicateItems(newItems, loadedItemIds) {
  var unique = [];
  for (var i = 0; i < newItems.length; i++) {
    if (!newItems[i].id || !loadedItemIds[newItems[i].id]) {
      if (newItems[i].id) loadedItemIds[newItems[i].id] = true;
      unique.push(newItems[i]);
    }
  }
  return { unique: unique, loadedItemIds: loadedItemIds };
}

// ==================== IndexedDB: полный кэш каталогов ====================

var CATALOG_IDB_DB = {
  name: 'CatalogFullCacheDB',
  version: 1,
  store: 'catalogs',
  maxAgeMs: 6 * 60 * 60 * 1000 // 6 часов
};

var catalogIdbDbPromise = null;
var catalogFullFetchInFlight = {};

function openCatalogIdb() {
  if (catalogIdbDbPromise) return catalogIdbDbPromise;

  catalogIdbDbPromise = new Promise(function (resolve, reject) {
    var req = self.indexedDB.open(CATALOG_IDB_DB.name, CATALOG_IDB_DB.version);

    req.onupgradeneeded = function (e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains(CATALOG_IDB_DB.store)) {
        db.createObjectStore(CATALOG_IDB_DB.store, { keyPath: 'key' });
      }
    };

    req.onsuccess = function (e) {
      resolve(e.target.result);
    };

    req.onerror = function () {
      catalogIdbDbPromise = null;
      reject(req.error);
    };
  });

  return catalogIdbDbPromise;
}

function catalogIdbGetRecord(key) {
  if (!key) return Promise.resolve(null);

  return openCatalogIdb().then(function (db) {
    return new Promise(function (resolve) {
      var tx = db.transaction(CATALOG_IDB_DB.store, 'readonly');
      var store = tx.objectStore(CATALOG_IDB_DB.store);
      var req = store.get(key);

      req.onsuccess = function () {
        resolve(req.result || null);
      };

      req.onerror = function () {
        resolve(null);
      };
    });
  }).catch(function () {
    return null;
  });
}

function catalogIdbPutRecord(key, data, timestamp) {
  if (!key || !data) return Promise.resolve(false);

  return openCatalogIdb().then(function (db) {
    return new Promise(function (resolve) {
      var tx = db.transaction(CATALOG_IDB_DB.store, 'readwrite');
      var store = tx.objectStore(CATALOG_IDB_DB.store);

      store.put({
        key: key,
        data: data,
        timestamp: timestamp || Date.now()
      });

      tx.oncomplete = function () {
        resolve(true);
      };

      tx.onerror = function () {
        resolve(false);
      };

      tx.onabort = function () {
        resolve(false);
      };
    });
  }).catch(function () {
    return false;
  });
}

function catalogIdbDeleteRecord(key) {
  if (!key) return Promise.resolve(false);

  return openCatalogIdb().then(function (db) {
    return new Promise(function (resolve) {
      var tx = db.transaction(CATALOG_IDB_DB.store, 'readwrite');
      var store = tx.objectStore(CATALOG_IDB_DB.store);
      var req = store.delete(key);

      req.onsuccess = function () {
        resolve(true);
      };

      req.onerror = function () {
        resolve(false);
      };
    });
  }).catch(function () {
    return false;
  });
}

function catalogIdbClearStore() {
  return openCatalogIdb().then(function (db) {
    return new Promise(function (resolve) {
      var tx = db.transaction(CATALOG_IDB_DB.store, 'readwrite');
      var store = tx.objectStore(CATALOG_IDB_DB.store);
      var req = store.clear();

      req.onsuccess = function () {
        resolve(true);
      };

      req.onerror = function () {
        resolve(false);
      };
    });
  }).catch(function () {
    return false;
  });
}

function isCatalogIdbFresh(timestamp) {
  if (!timestamp) return false;
  return Date.now() - timestamp < CATALOG_IDB_DB.maxAgeMs;
}

function normalizeFullCatalogData(responseData) {
  var items = responseData && Array.isArray(responseData.items)
    ? responseData.items
    : [];

  var loadedItemIds = {};

  for (var i = 0; i < items.length; i++) {
    if (items[i] && items[i].id !== undefined && items[i].id !== null) {
      loadedItemIds[items[i].id] = true;
    }
  }

  return {
    items: items,
    totalItems: responseData && responseData.pagination && responseData.pagination.total
      ? responseData.pagination.total
      : items.length,
    currentPage: 1,
    hasMore: false,
    loadedItemIds: loadedItemIds
  };
}

function getFullCatalogFresh(key, url, limit) {
  if (!key || !url) return Promise.resolve(null);

  if (catalogFullFetchInFlight[key]) {
    return catalogFullFetchInFlight[key];
  }

  var promise = catalogIdbGetRecord(key).then(function (record) {
    // 1. Если есть свежий кэш в IndexedDB — возвращаем без сети
    if (record && record.data && isCatalogIdbFresh(record.timestamp)) {
      return {
        source: 'idb',
        key: key,
        timestamp: record.timestamp,
        data: record.data
      };
    }

    // 2. Если кэша нет или он старше 6 часов — обновляем через сеть
    var fetchUrl = url + '/items?from=0&limit=' + (limit || 1000);

    return safeFetch(fetchUrl, { timeout: 30000 }).then(function (responseData) {
      if (!responseData || !responseData.success) {
        // Если сеть недоступна, но есть старый кэш — отдаём старый кэш
        if (record && record.data) {
          return {
            source: 'idb-stale',
            key: key,
            timestamp: record.timestamp,
            data: record.data,
            networkFailed: true
          };
        }

        throw new Error('Catalog fetch failed');
      }

      var normalized = normalizeFullCatalogData(responseData);
      var now = Date.now();

      return catalogIdbPutRecord(key, normalized, now)
        .catch(function () {
          // Если IndexedDB недоступна, всё равно возвращаем данные
        })
        .then(function () {
          return {
            source: 'network',
            key: key,
            timestamp: now,
            data: normalized
          };
        });
    }).catch(function (error) {
      // Fallback на старый кэш, если сеть упала
      if (record && record.data) {
        return {
          source: 'idb-stale',
          key: key,
          timestamp: record.timestamp,
          data: record.data,
          networkFailed: true,
          error: error && error.message
        };
      }

      throw error;
    });
  });

  catalogFullFetchInFlight[key] = promise;

  return promise.then(function (result) {
    delete catalogFullFetchInFlight[key];
    return result;
  }, function (error) {
    delete catalogFullFetchInFlight[key];
    throw error;
  });
}

function prefetchFullCatalogs(entries, limit) {
  var results = {};
  var queue = Array.isArray(entries) ? entries.slice() : [];
  var active = 0;
  var maxActive = 2;

  return new Promise(function (resolve) {
    function next() {
      if (!queue.length && active === 0) {
        resolve(results);
        return;
      }

      while (active < maxActive && queue.length) {
        (function (entry) {
          active++;

          getFullCatalogFresh(entry.key, entry.url, limit || 1000)
            .then(function (result) {
              results[entry.key] = result;
            })
            .catch(function () {
              results[entry.key] = null;
            })
            .then(function () {
              active--;
              setTimeout(next, 0);
            });
        })(queue.shift());
      }
    }

    next();
  });
}

// ==================== /IndexedDB: полный кэш каталогов ====================

/**
 * Обрезает результат getFullCatalogFresh до take элементов ПЕРЕД postMessage.
 *
 * Ряды каталога показывают по 10 карточек, а полный каталог — до 1000 элементов.
 * Пересылать все 1000 через structured clone, чтобы взять 10, — это синхронная
 * десериализация в главном потоке и мгновенный мусор: главный источник микрофризов
 * на входе в каталог. loadedItemIds (словарь на 1000 ключей) рядам не нужен вовсе.
 *
 * Строим НОВЫЙ объект: result.data — это тот же объект, что лежит в записи
 * IndexedDB и в общем in-flight-промисе (catalogFullFetchInFlight), его нельзя
 * мутировать, иначе параллельный запрос из режима сетки получит обрезанный каталог.
 */
function sliceCatalogResult(result, take) {
  if (!take || take <= 0) return result;
  if (!result || !result.data || !Array.isArray(result.data.items)) return result;
  if (result.data.items.length <= take && !result.data.loadedItemIds) return result;

  var all = result.data.items;

  return {
    source: result.source,
    key: result.key,
    timestamp: result.timestamp,
    networkFailed: result.networkFailed,
    data: {
      items: all.slice(0, take),
      totalItems: result.data.totalItems,
      // Сколько элементов лежит в кэше на самом деле. НЕ totalItems: тот
      // приходит из pagination.total сервера и может быть больше выборки
      // (каталог глубже, чем limit запроса). Вызывающей стороне нужно ровно
      // «обрезали ли мы то, что уже есть» — чтобы знать, надо ли дозапрашивать
      // остаток, когда пользователь долистает до конца.
      fullCount: all.length,
      currentPage: 1,
      hasMore: false
    }
  };
}

/**
 * Сводка вместо содержимого всех каталогов.
 *
 * Префетч нужен только чтобы прогреть IndexedDB — данные вызывающая сторона
 * выбрасывает. Без этого в главный поток уезжали все 8 каталогов по 1000
 * элементов плюс 8 словарей loadedItemIds одним блобом.
 */
function summarizePrefetchResults(results) {
  var summary = {};

  if (!results) return summary;

  for (var key in results) {
    if (!results.hasOwnProperty(key)) continue;

    var r = results[key];

    if (!r) {
      summary[key] = null;
      continue;
    }

    summary[key] = {
      source: r.source,
      timestamp: r.timestamp,
      totalItems: r.data && r.data.totalItems || 0,
      items: r.data && Array.isArray(r.data.items) ? r.data.items.length : 0,
      networkFailed: !!r.networkFailed
    };
  }

  return summary;
}

// ==================== ОБРАБОТЧИК СООБЩЕНИЙ ====================
var pendingRequests = {};
var requestId = 0;

self.onmessage = function (e) {
  var msg = e.data;
  var id = msg.id;
  var type = msg.type;
  var payload = msg.payload;

  switch (type) {
    // --- TMDB Details ---
    case 'FETCH_TMDB_DETAILS':
      workerFetchTmdbDetails(payload.item).then(function (data) {
        self.postMessage({ id: id, type: 'RESULT', data: data });
      });
      break;

    // --- Actors ---
    case 'FETCH_ACTORS':
      workerFetchCatalogActors(payload.item).then(function (data) {
        self.postMessage({ id: id, type: 'RESULT', data: data });
      });
      break;

    // --- Item Details (merged) ---
    case 'FETCH_ITEM_DETAILS':
      workerFetchCatalogItemDetails(payload.item).then(function (data) {
        self.postMessage({ id: id, type: 'RESULT', data: data });
      });
      break;

    // --- Item Meta (search) ---
    case 'FETCH_ITEM_META':
      workerFetchCatalogItemMeta(payload.item, payload.mediaType).then(function (data) {
        self.postMessage({ id: id, type: 'RESULT', data: data });
      });
      break;

    // --- Poster URL ---
    case 'FETCH_POSTER_URL':
      workerFetchPosterUrl(payload).then(function (data) {
        self.postMessage({
          id: id,
          type: 'RESULT',
          data: data
        });
      });
      break;

    // --- Poster URL Batch ---
    case 'FETCH_POSTER_URLS_BATCH':
      workerFetchPosterUrlsBatch(payload).then(function (data) {
        self.postMessage({ id: id, type: 'RESULT', data: data });
      });
      break;

    // --- Catalog Items (pagination) ---
    case 'LOAD_CATALOG_ITEMS':
      workerLoadCatalogItems(payload.url, payload.from, payload.limit)
        .then(function (data) {
          self.postMessage({ id: id, type: 'RESULT', data: data });
        })
        .catch(function (err) {
          self.postMessage({ id: id, type: 'ERROR', error: err.message });
        });
      break;

    // --- All Catalog Items (fallback) ---
    case 'LOAD_ALL_CATALOG_ITEMS':
      workerLoadAllCatalogItems(payload.url)
        .then(function (data) {
          self.postMessage({ id: id, type: 'RESULT', data: data });
        })
        .catch(function (err) {
          self.postMessage({ id: id, type: 'ERROR', error: err.message });
        });
      break;

    // --- History ---
    case 'LOAD_HISTORY':
      workerLoadHistory().then(function (data) {
        self.postMessage({ id: id, type: 'RESULT', data: data });
      });
      break;

    // --- Available Catalogs ---
    case 'FETCH_CATALOGS':
      workerFetchAvailableCatalogs().then(function (data) {
        self.postMessage({ id: id, type: 'RESULT', data: data });
      });
      break;

    // --- Check & Update Catalog ---
    case 'CHECK_CATALOG_UPDATE':
      workerCheckCatalogUpdate(payload.catalogId, payload.iso).then(function (updated) {
        self.postMessage({ id: id, type: 'RESULT', data: { updated: updated } });
      });
      break;

    // --- Save to History ---
    case 'SAVE_TO_HISTORY':
      workerSaveToHistory(payload.id, payload.title, payload.mt, payload.pp).then(function (data) {
        self.postMessage({ id: id, type: 'RESULT', data: data });
      });
      break;

    // --- Clear History ---
    case 'CLEAR_HISTORY':
      workerClearHistory().then(function (data) {
        self.postMessage({ id: id, type: 'RESULT', data: data });
      });
      break;

    // --- Deduplication ---
    case 'DEDUPLICATE':
      var result = deduplicateItems(payload.newItems, payload.loadedItemIds);
      self.postMessage({ id: id, type: 'RESULT', data: result });
      break;

    // --- Merge Details (pure computation) ---
    case 'MERGE_DETAILS':
      var merged = mergeCatalogDetails(payload.base, payload.extra);
      self.postMessage({ id: id, type: 'RESULT', data: merged });
      break;

    // --- Normalize Genres ---
    case 'NORMALIZE_GENRES':
      var genres = getNormalizedCatalogGenres(payload.src);
      self.postMessage({ id: id, type: 'RESULT', data: genres });
      break;

    // --- Cache Management ---
    case 'CACHE_CLEAR':
      clearTmdbCache();
      posterUrlCache.clear();
      catalogDataCache.clear();
      self.postMessage({ id: id, type: 'RESULT', data: { success: true } });
      break;

    case 'CACHE_STATS':
      self.postMessage({ id: id, type: 'RESULT', data: getTmdbCacheStats() });
      break;

    case 'CACHE_SET_ENABLED':
      TMDB_CACHE_CONFIG.enabled = payload.enabled;
      self.postMessage({ id: id, type: 'RESULT', data: { enabled: TMDB_CACHE_CONFIG.enabled } });
      break;

    case 'CACHE_SET_TTL':
      TMDB_CACHE_CONFIG.ttl = payload.ttl;
      self.postMessage({ id: id, type: 'RESULT', data: { ttl: TMDB_CACHE_CONFIG.ttl } });
      break;

    // --- Poster URL Cache ---
    case 'POSTER_CACHE_GET':
      var cachedUrl = posterUrlCache.get(payload.key);
      self.postMessage({ id: id, type: 'RESULT', data: { url: cachedUrl || null } });
      break;

    case 'POSTER_CACHE_SET':
      posterUrlCache.set(payload.key, payload.url);
      self.postMessage({ id: id, type: 'RESULT', data: { success: true } });
      break;

    case 'POSTER_CACHE_HAS':
      self.postMessage({ id: id, type: 'RESULT', data: { has: posterUrlCache.has(payload.key) } });
      break;

    case 'POSTER_CACHE_CLEAR':
      posterUrlCache.clear();
      self.postMessage({ id: id, type: 'RESULT', data: { success: true } });
      break;

    // --- Catalog Data Cache ---
    case 'CATALOG_CACHE_GET':
      var catCached = catalogDataCache.get(payload.key);
      if (catCached && (Date.now() - catCached.timestamp < WORKER_CONSTANTS.CATALOG_CACHE_TTL_MS)) {
        self.postMessage({ id: id, type: 'RESULT', data: catCached.data });
      } else {
        if (catCached) catalogDataCache.delete(payload.key);
        self.postMessage({ id: id, type: 'RESULT', data: null });
      }
      break;

    case 'CATALOG_CACHE_SET':
      catalogDataCache.set(payload.key, { data: payload.data, timestamp: Date.now() });
      self.postMessage({ id: id, type: 'RESULT', data: { success: true } });
      break;

    case 'CATALOG_CACHE_DELETE':
      catalogDataCache.delete(payload.key);
      self.postMessage({ id: id, type: 'RESULT', data: { success: true } });
      break;

    case 'CATALOG_CACHE_CLEAR':
      catalogDataCache.clear();
      self.postMessage({ id: id, type: 'RESULT', data: { success: true } });
      break;

    // --- RuTube Trailer ---
    case 'FETCH_RUTUBE_TRAILER':
      workerFetchRutubeTrailer(payload).then(function (data) {
        self.postMessage({ id: id, type: 'RESULT', data: data });
      });
      break;

    // --- TMDB Item IDB Cache ---
    case 'TMDB_ITEM_CACHE_STATS':
      tmdbItemStats().then(function (data) {
        self.postMessage({ id: id, type: 'RESULT', data: data });
      });
      break;
    case 'TMDB_ITEM_CACHE_CLEAR':
      tmdbItemClear().then(function (data) {
        self.postMessage({ id: id, type: 'RESULT', data: data });
      });
      break;

    // --- TMDB Details IDB Cache ---
    case 'TMDB_DETAILS_CACHE_STATS':
      tmdbDetailsStats().then(function (data) {
        self.postMessage({ id: id, type: 'RESULT', data: data });
      });
      break;

    case 'TMDB_DETAILS_CACHE_CLEAR':
      tmdbDetailsClear().then(function (data) {
        self.postMessage({ id: id, type: 'RESULT', data: data });
      });
      break;

    // --- IndexedDB: полный кэш каталогов ---
    case 'CATALOG_IDB_GET':
      catalogIdbGetRecord(payload && payload.key)
        .then(function (record) {
          // take: обрезаем выборку ДО postMessage — тем же приёмом, что и
          // CATALOG_GET_FRESH. Запись в IndexedDB держит до CATALOG_FULL_LIMIT
          // элементов плюс словарь loadedItemIds на столько же ключей, и всё
          // это раскладывалось structured clone'ом в главном потоке ради
          // первых полутора экранов сетки.
          self.postMessage({
            id: id,
            type: 'RESULT',
            data: sliceCatalogResult(record, payload && payload.take)
          });
        })
        .catch(function (error) {
          self.postMessage({ id: id, type: 'ERROR', error: error && error.message || 'CATALOG_IDB_GET error' });
        });
      break;

    case 'CATALOG_IDB_SET':
      catalogIdbPutRecord(payload && payload.key, payload && payload.data, Date.now())
        .then(function (success) {
          self.postMessage({ id: id, type: 'RESULT', data: { success: !!success } });
        })
        .catch(function (error) {
          self.postMessage({ id: id, type: 'ERROR', error: error && error.message || 'CATALOG_IDB_SET error' });
        });
      break;

    case 'CATALOG_IDB_DELETE':
      catalogIdbDeleteRecord(payload && payload.key)
        .then(function (success) {
          self.postMessage({ id: id, type: 'RESULT', data: { success: !!success } });
        })
        .catch(function (error) {
          self.postMessage({ id: id, type: 'ERROR', error: error && error.message || 'CATALOG_IDB_DELETE error' });
        });
      break;

    case 'CATALOG_IDB_CLEAR':
      catalogIdbClearStore()
        .then(function (success) {
          self.postMessage({ id: id, type: 'RESULT', data: { success: !!success } });
        })
        .catch(function (error) {
          self.postMessage({ id: id, type: 'ERROR', error: error && error.message || 'CATALOG_IDB_CLEAR error' });
        });
      break;

    case 'CATALOG_GET_FRESH':
      getFullCatalogFresh(
        payload && payload.key,
        payload && payload.url,
        payload && payload.limit
      )
        .then(function (result) {
          self.postMessage({ id: id, type: 'RESULT', data: sliceCatalogResult(result, payload && payload.take) });
        })
        .catch(function (error) {
          self.postMessage({ id: id, type: 'ERROR', error: error && error.message || 'CATALOG_GET_FRESH error' });
        });
      break;

    case 'CATALOG_PREFETCH_ALL':
      prefetchFullCatalogs(
        payload && payload.entries,
        payload && payload.limit
      )
        .then(function (result) {
          self.postMessage({
            id: id,
            type: 'RESULT',
            data: (payload && payload.summary) ? summarizePrefetchResults(result) : result
          });
        })
        .catch(function (error) {
          self.postMessage({ id: id, type: 'ERROR', error: error && error.message || 'CATALOG_PREFETCH_ALL error' });
        });
      break;

    default:
      self.postMessage({ id: id, type: 'ERROR', error: 'Unknown message type: ' + type });
  }
};

// ==================== ПЕРИОДИЧЕСКАЯ ОЧИСТКА КЭША ====================
setInterval(cleanOldTmdbCache, WORKER_CONSTANTS.TMDB_CLEANUP_INTERVAL_MS);

// Готовность
try { openTmdbItemDb(); } catch (e) { }
try { openTmdbDetailsDb(); } catch (e) { }
self.postMessage({ type: 'WORKER_READY' });
