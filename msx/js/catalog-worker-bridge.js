// catalog-worker-bridge.js
var CatalogWorker = (function () {
  var worker = null;
  var pendingCallbacks = {};
  var requestCounter = 0;
  var isReady = false;
  var readyQueue = [];

  function init() {
    if (worker) return;

    try {
      // ★ Прямой путь — same-origin, без Blob, без GitHub
      // ?v= обязателен: без него WebView отдаёт воркер из своего HTTP-кэша, пока
      // все остальные скрипты приходят свежими (index.html грузит их с ?v=VERSION).
      // Правки catalog-worker.js без этого могут не доехать до телевизора.
      var workerUrl = 'catalog-worker.js';
      if (window.VERSION) workerUrl += '?v=' + window.VERSION;
      worker = new Worker(new URL(workerUrl, document.baseURI));
    } catch (e) {
      console.error('❌ Worker creation failed:', e);
      worker = null;
      return;
    }

    worker.onmessage = function (e) {
      var msg = e.data;

      if (msg.type === 'WORKER_READY') {
        isReady = true;
        for (var i = 0; i < readyQueue.length; i++) {
          worker.postMessage(readyQueue[i]);
        }
        readyQueue = [];
        return;
      }

      var cb = pendingCallbacks[msg.id];
      if (cb) {
        delete pendingCallbacks[msg.id];
        if (msg.type === 'ERROR') cb.reject(new Error(msg.error));
        else cb.resolve(msg.data);
      }
    };

    worker.onerror = function (e) {
      console.error('❌ Worker error:', e.message);
    };
  }

  function request(type, payload, timeout) {
    timeout = timeout || 10000;
    return new Promise(function (resolve, reject) {
      if (!worker) { reject(new Error('Worker not available')); return; }

      var id = 'req_' + (++requestCounter) + '_' + Date.now();
      var msg = { id: id, type: type, payload: payload || {} };

      var timer = setTimeout(function () {
        if (pendingCallbacks[id]) {
          delete pendingCallbacks[id];
          reject(new Error('Worker timeout: ' + type));
        }
      }, timeout);

      pendingCallbacks[id] = {
        resolve: function (data) { clearTimeout(timer); resolve(data); },
        reject: function (err) { clearTimeout(timer); reject(err); }
      };

      if (isReady) worker.postMessage(msg);
      else readyQueue.push(msg);
    });
  }

  return {
    init: init,
    isReady: function () { return isReady; },

    fetchTmdbDetails: function (item) { return request('FETCH_TMDB_DETAILS', { item: item }); },
    fetchActors: function (item) { return request('FETCH_ACTORS', { item: item }); },
    fetchItemDetails: function (item) { return request('FETCH_ITEM_DETAILS', { item: item }); },
    fetchItemMeta: function (item, mt) { return request('FETCH_ITEM_META', { item: item, mediaType: mt }); },
    fetchPosterUrl: function (id, mt, title, protocol, size) {
      return request('FETCH_POSTER_URL', {
        id: id,
        mt: mt,
        title: title,
        protocol: protocol,
        size: size
      });
    },
    fetchPosterUrlsBatch: function (items, protocol, size) {
      // items: [{ id, mt, title }]
      return request('FETCH_POSTER_URLS_BATCH', {
        items: items,
        protocol: protocol,
        size: size
      }, 15000);
    },
    fetchRutubeTrailer: function (title, originalTitle, releaseDate) {
      return request('FETCH_RUTUBE_TRAILER', {
        title: title,
        originalTitle: originalTitle,
        releaseDate: releaseDate
      }, 15000);
    },
    tmdbItemCacheStats: function () { return request('TMDB_ITEM_CACHE_STATS', {}); },
    tmdbItemCacheClear: function () { return request('TMDB_ITEM_CACHE_CLEAR', {}); },
    tmdbDetailsCacheStats: function () { return request('TMDB_DETAILS_CACHE_STATS', {}); },
    tmdbDetailsCacheClear: function () { return request('TMDB_DETAILS_CACHE_CLEAR', {}); },
    loadCatalogItems: function (url, from, limit) { return request('LOAD_CATALOG_ITEMS', { url: url, from: from, limit: limit }); },
    loadAllCatalogItems: function (url) { return request('LOAD_ALL_CATALOG_ITEMS', { url: url }, 15000); },
    loadHistory: function () { return request('LOAD_HISTORY', {}); },
    fetchCatalogs: function () { return request('FETCH_CATALOGS', {}); },
    checkCatalogUpdate: function (id, iso) { return request('CHECK_CATALOG_UPDATE', { catalogId: id, iso: iso }); },
    saveToHistory: function (id, title, mt, pp) { return request('SAVE_TO_HISTORY', { id: id, title: title, mt: mt, pp: pp }); },
    clearHistory: function () { return request('CLEAR_HISTORY', {}); },
    deduplicate: function (items, ids) { return request('DEDUPLICATE', { newItems: items, loadedItemIds: ids }); },
    mergeDetails: function (base, extra) { return request('MERGE_DETAILS', { base: base, extra: extra }); },
    normalizeGenres: function (src) { return request('NORMALIZE_GENRES', { src: src }); },
    cacheClear: function () { return request('CACHE_CLEAR', {}); },
    cacheStats: function () { return request('CACHE_STATS', {}); },
    cacheSetEnabled: function (v) { return request('CACHE_SET_ENABLED', { enabled: v }); },
    cacheSetTtl: function (v) { return request('CACHE_SET_TTL', { ttl: v }); },
    posterCacheGet: function (key) { return request('POSTER_CACHE_GET', { key: key }); },
    posterCacheSet: function (key, url) { return request('POSTER_CACHE_SET', { key: key, url: url }); },
    posterCacheHas: function (key) { return request('POSTER_CACHE_HAS', { key: key }); },
    posterCacheClear: function () { return request('POSTER_CACHE_CLEAR', {}); },
    catalogCacheGet: function (key) { return request('CATALOG_CACHE_GET', { key: key }); },
    catalogCacheSet: function (key, data) { return request('CATALOG_CACHE_SET', { key: key, data: data }); },
    catalogCacheDelete: function (key) { return request('CATALOG_CACHE_DELETE', { key: key }); },
    catalogCacheClear: function () { return request('CATALOG_CACHE_CLEAR', {}); },
    // --- IndexedDB: полный кэш каталогов ---
    catalogIdbGet: function (key, take) {
      // take: сколько элементов реально нужно вызывающей стороне. Воркер
      // обрежет запись до postMessage и добавит data.fullCount — сколько
      // элементов лежит в кэше целиком. Старый закэшированный воркер про take
      // не знает и вернёт всё, поэтому вызывающий код обязан пережить и это.
      return request('CATALOG_IDB_GET', { key: key, take: take }, 15000);
    },

    catalogIdbSet: function (key, data) {
      return request('CATALOG_IDB_SET', { key: key, data: data }, 20000);
    },

    catalogIdbDelete: function (key) {
      return request('CATALOG_IDB_DELETE', { key: key }, 10000);
    },

    catalogIdbClear: function () {
      return request('CATALOG_IDB_CLEAR', {}, 10000);
    },

    catalogGetFresh: function (key, url, limit, take) {
      return request('CATALOG_GET_FRESH', {
        key: key,
        url: url,
        limit: limit,
        // take: сколько элементов реально нужно вызывающей стороне. Воркер обрежет
        // выборку до postMessage. Старый закэшированный воркер параметр проигнорирует
        // и вернёт всё, как раньше, — вызывающий код всё равно делает свой slice.
        take: take
      }, 60000);
    },

    catalogPrefetchAll: function (entries, limit, summary) {
      return request('CATALOG_PREFETCH_ALL', {
        entries: entries,
        limit: limit,
        // summary: вернуть только метаданные вместо содержимого всех каталогов
        summary: !!summary
      }, 240000);
    },

    destroy: function () {
      if (worker) { worker.terminate(); worker = null; }
      isReady = false;
      pendingCallbacks = {};
      readyQueue = [];
    }
  };
})();

CatalogWorker.init();
