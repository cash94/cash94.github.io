// catalog-worker.js — Web Worker для вычислений и сети
// Совместим с Chromium 70+ (Android TV)
// НЕ имеет доступа к DOM, localStorage, IntersectionObserver

'use strict';

// ==================== КОНСТАНТЫ ====================
var WORKER_CONSTANTS = {
  CACHE_TTL_MS: 3600000,
  FETCH_TIMEOUT_MS: 5000,
  CATALOG_CACHE_TTL_MS: 3600000,
  ITEMS_PER_PAGE: 100,
  MAX_POSTER_CACHE: 150,
  TMDB_MAX_CACHE_SIZE: 75,
  TMDB_CLEANUP_INTERVAL_MS: 300000,
  MAX_ACTORS: 12,
  MAX_RECOMMENDATIONS: 12,
  MAX_TRAILERS: 6,
  IMG_SIZES: {
    POSTER_CARD: 'w342',
    POSTER_SMALL: 'w185',
    POSTER_MEDIUM: 'w342',
    BACKDROP: 'w1920'
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

// ==================== TMDB ЗАПРОСЫ ====================
function workerFetchTmdbDetails(item) {
  var id = item && item.id, type = (item && item.media_type) || 'movie';
  if (!id) return Promise.resolve(null);
  var p = { id: id, type: type };
  var cached = getFromTmdbCache('details', p);
  if (cached !== null) return Promise.resolve(cached);

  var urls = [
    '/api/tmdb/details?id=' + encodeURIComponent(id) + '&type=' + encodeURIComponent(type),
    '/api/tmdb/item?id=' + encodeURIComponent(id) + '&type=' + encodeURIComponent(type)
  ];

  return safeFetch(urls[0])
    .then(function (d) {
      if (d && (d.id || d.overview || d.videos || d.backdrops)) {
        saveToTmdbCache('details', p, d);
        return d;
      }
      return safeFetch(urls[1]);
    })
    .then(function (d) {
      if (d && (d.id || d.overview || d.videos || d.backdrops)) {
        saveToTmdbCache('details', p, d);
        return d;
      }
      return null;
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
  var p = { id: item && item.id, media_type: (item && item.media_type) || 'movie', title: getCatalogItemTitle(item) };
  var c = getFromTmdbCache('itemDetails', p);
  if (c !== null) return Promise.resolve(c);

  return workerFetchTmdbDetails(item).then(function (tmdb) {
    var merged = mergeCatalogDetails(item, tmdb);
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
    byIdPromise = safeFetch(
      '/api/tmdb/item?id=' + encodeURIComponent(id) + '&type=' + encodeURIComponent(mt)
    ).then(function (d) {
      if (d && d.poster_path) {
        return buildPosterUrl(d.poster_path, protocol, size);
      }

      return null;
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

    default:
      self.postMessage({ id: id, type: 'ERROR', error: 'Unknown message type: ' + type });
  }
};

// ==================== ПЕРИОДИЧЕСКАЯ ОЧИСТКА КЭША ====================
setInterval(cleanOldTmdbCache, WORKER_CONSTANTS.TMDB_CLEANUP_INTERVAL_MS);

// Готовность
self.postMessage({ type: 'WORKER_READY' });
