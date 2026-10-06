/* Сборка для старых браузеров (Chrome 53) из js/catalog-idb-patch.js — tools/legacy-build/build.js. Руками не править. */
function asyncGeneratorStep(n, t, e, r, o, a, c) {try {var i = n[a](c),u = i.value;} catch (n) {return void e(n);}i.done ? t(u) : Promise.resolve(u).then(r, o);}function _asyncToGenerator(n) {return function () {var t = this,e = arguments;return new Promise(function (r, o) {var a = n.apply(t, e);function _next(n) {asyncGeneratorStep(a, r, o, _next, _throw, "next", n);}function _throw(n) {asyncGeneratorStep(a, r, o, _next, _throw, "throw", n);}_next(void 0);});};}

(function () {
  'use strict';

  if (!window.CatalogWorker) {
    console.error('❌ catalog-idb-patch: CatalogWorker недоступен');
    return;
  }



  var _catalogsListCache = null;
  var _catalogsListCacheTime = 0;
  var CATALOGS_LIST_CACHE_TTL = 6 * 60 * 60 * 1000;








  var _catalogsListInFlight = null;


  var _catalogsListGeneration = 0;

  function invalidateCatalogsListCache() {
    _catalogsListCache = null;
    _catalogsListCacheTime = 0;
    _catalogsListInFlight = null;
    _catalogsListGeneration++;
  }

  function fetchCatalogsWithCache() {
    var now = Date.now();


    if (_catalogsListCache && now - _catalogsListCacheTime < CATALOGS_LIST_CACHE_TTL) {
      return Promise.resolve(_catalogsListCache);
    }

    if (_catalogsListInFlight) {
      return _catalogsListInFlight;
    }

    var generation = _catalogsListGeneration;


    var request = fetch(SERVER_URL + '/api/catalogs').
    then(function (response) {
      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }
      return response.json();
    }).
    then(function (data) {
      if (data && data.success && Array.isArray(data.catalogs)) {
        if (generation === _catalogsListGeneration) {
          _catalogsListCache = data.catalogs;
          _catalogsListCacheTime = Date.now();
        }
        return data.catalogs;
      }
      throw new Error('Invalid catalogs response');
    }).
    catch(function (error) {
      console.warn('⚠️ fetchCatalogsWithCache error:', error);

      if (_catalogsListCache) {
        return _catalogsListCache;
      }
      return [];
    });

    _catalogsListInFlight = request;



    var release = function () {
      if (_catalogsListInFlight === request) {
        _catalogsListInFlight = null;
      }
    };
    request.then(release, release);

    return request;
  }

  function getCatalogInfoFromCache(catalogKey) {
    if (!_catalogsListCache || !Array.isArray(_catalogsListCache)) {
      return null;
    }

    for (var i = 0; i < _catalogsListCache.length; i++) {
      if (_catalogsListCache[i].id === catalogKey) {
        return _catalogsListCache[i];
      }
    }

    return null;
  }

  var CATALOG_FULL_LIMIT = 1000;
  var _catalogIdbUpdating = false;

  function getTtlMs() {
    var hours = window.CATALOG_CONSTANTS && CATALOG_CONSTANTS.CATALOG_UPDATE_THRESHOLD_HOURS ?
    CATALOG_CONSTANTS.CATALOG_UPDATE_THRESHOLD_HOURS :
    6;

    return hours * 60 * 60 * 1000;
  }

  function isFreshTimestamp(timestamp) {
    if (!timestamp) return false;
    return Date.now() - timestamp < getTtlMs();
  }

  function getFullCatalogEntries() {
    var entries = [];

    if (!window.CATALOG_CONFIG) return entries;

    for (var key in CATALOG_CONFIG) {
      if (!CATALOG_CONFIG.hasOwnProperty(key)) continue;

      if (key === 'history' || key === 'favorites') continue;

      var cfg = CATALOG_CONFIG[key];

      if (cfg && cfg.url) {
        entries.push({
          key: key,
          url: cfg.url
        });
      }
    }

    return entries;
  }

  function buildLoadedItemIds(items) {
    var ids = {};

    if (!Array.isArray(items)) return ids;

    for (var i = 0; i < items.length; i++) {
      if (items[i] && items[i].id !== undefined && items[i].id !== null) {
        ids[items[i].id] = true;
      }
    }

    return ids;
  }

  function getPageSize() {
    return window.CATALOG_CONSTANTS && CATALOG_CONSTANTS.ITEMS_PER_PAGE ||
    window.catalogState && catalogState.itemsPerPage ||
    50;
  }

  if (!window.__catalogIdbMeta) {
    window.__catalogIdbMeta = {};
  }

  function setCatalogIdbMeta(key, timestamp, totalItems) {
    if (!key) return;

    window.__catalogIdbMeta[key] = {
      timestamp: timestamp || Date.now(),
      totalItems: totalItems || 0
    };
  }

  function getCatalogIdbMeta(key) {
    if (!window.__catalogIdbMeta || !window.__catalogIdbMeta[key]) {
      return null;
    }

    return window.__catalogIdbMeta[key];
  }
















  var CATALOG_INITIAL_TAKE = 300;

  function getInitialTake() {
    return CATALOG_INITIAL_TAKE;
  }








  function setFullItemsTruncation(key, data) {
    var items = Array.isArray(data.items) ? data.items : [];
    catalogState.fullItemsTruncated =
    typeof data.fullCount === 'number' && data.fullCount > items.length;
  }





  function extendFullItems(key) {
    var cfg = window.CATALOG_CONFIG && CATALOG_CONFIG[key];
    if (!cfg || !cfg.url) return Promise.resolve(false);


    return CatalogWorker.catalogGetFresh(key, cfg.url, CATALOG_FULL_LIMIT).
    then(function (result) {
      if (catalogState.currentCatalog !== key) return false;
      if (!result || !result.data || !Array.isArray(result.data.items)) return false;

      var items = result.data.items;
      if (items.length <= catalogState.fullItems.length) {
        catalogState.fullItemsTruncated = false;
        return false;
      }

      catalogState.fullItems = items;
      catalogState.fullItemsTruncated = false;
      catalogState.totalItems = result.data.totalItems || items.length;
      return true;
    }).
    catch(function (error) {
      console.warn('⚠️ Не удалось дотянуть остаток каталога "' + key + '":', error);
      return false;
    });
  }

  function applyFullCatalogData(key, data, timestamp) {
    if (!key || !data) return;

    var items = Array.isArray(data.items) ? data.items : [];
    var pageSize = getPageSize();
    var ts = timestamp || Date.now();


    setCatalogIdbMeta(key, ts, data.totalItems || items.length);

    catalogState.currentCatalog = key;


    catalogState.fullItems = items;
    catalogState.idbTimestamp = ts;
    setFullItemsTruncation(key, data);


    catalogState.items = items.slice(0, pageSize);

    catalogState.totalItems = data.totalItems || items.length;
    catalogState.currentPage = 1;


    catalogState.hasMore =
    catalogState.items.length < items.length || catalogState.fullItemsTruncated;
    catalogState.isLoadingMore = false;

    catalogState.loadedItemIds = buildLoadedItemIds(catalogState.items);

    catalogState.cardElements = {};
    catalogState.loadedPostersCount = 0;
    catalogState.posterLoadQueue = [];

    if (typeof renderCatalogGrid === 'function') {
      renderCatalogGrid();
    }
  }










  function hasUserMovedInGrid(key) {
    if (catalogState.currentCatalog !== key) return false;


    if (catalogState.items.length > getPageSize()) return true;

    var mc = typeof getEl === 'function' ? getEl('main-container') : null;
    if (mc && mc.scrollTop > 0) return true;


    var focused = document.querySelector('#catalog-grid .torrent-card.catalog-card.focused');
    if (focused && focused.dataset.catalogIndex &&
    parseInt(focused.dataset.catalogIndex, 10) > 0) return true;

    return false;
  }









  function applyFullCatalogDataQuiet(key, data, timestamp) {
    if (!key || !data) return;

    var items = Array.isArray(data.items) ? data.items : [];
    var ts = timestamp || Date.now();
    var have = Array.isArray(catalogState.fullItems) ? catalogState.fullItems : [];

    setCatalogIdbMeta(key, ts, data.totalItems || items.length);

    catalogState.idbTimestamp = ts;
    catalogState.totalItems = data.totalItems || items.length;






    if (items.length < have.length) {
      catalogState.fullItemsTruncated = true;
    } else {
      catalogState.fullItems = items;
      setFullItemsTruncation(key, data);
    }

    catalogState.hasMore =
    catalogState.items.length < catalogState.fullItems.length ||
    catalogState.fullItemsTruncated;
  }


  function applyFullCatalogUpdate(key, data, timestamp) {
    if (catalogState.currentCatalog !== key) return;

    if (hasUserMovedInGrid(key)) {
      applyFullCatalogDataQuiet(key, data, timestamp);
      return;
    }

    applyFullCatalogData(key, data, timestamp);
  }






  var _prefetchPromise = null;
  var _prefetchDone = false;

  function prefetchAllFullCatalogs() {
    if (_prefetchDone) return Promise.resolve({});
    if (_prefetchPromise) return _prefetchPromise;

    var entries = getFullCatalogEntries();

    if (!entries.length) {
      return Promise.resolve({});
    }

    _prefetchPromise = CatalogWorker.catalogPrefetchAll(entries, CATALOG_FULL_LIMIT, true).
    then(function (summary) {
      _prefetchDone = true;
      _prefetchPromise = null;
      console.log('📦 Каталоги прогреты в IndexedDB:', summary);
      return summary;
    }).
    catch(function (error) {
      console.warn('⚠️ Prefetch catalogs error:', error);
      _prefetchPromise = null;
      return {};
    });

    return _prefetchPromise;
  }



  var _origShowCatalogList = window.showCatalogList || showCatalogList;

  window.showCatalogList = showCatalogList = function () {



    prefetchAllFullCatalogs();


    return _origShowCatalogList.apply(window, arguments);
  };



  var _origLoadCatalog = window.loadCatalog || loadCatalog;

  window.loadCatalog = loadCatalog = function () {var _ref = _asyncToGenerator(function* (key) {




      if (key === 'person') {
        if (!catalogState.person || typeof window.loadPersonCatalog !== 'function') return;
        return window.loadPersonCatalog(catalogState.person.id, catalogState.person.name);
      }

      if (!window.CATALOG_CONFIG || !CATALOG_CONFIG[key]) {
        return;
      }

      if (key === 'history') {
        return loadHistoryCatalog();
      }
      if (key === 'favorites') {
        return loadFavoritesCatalog();
      }

      AppState.openInRow = false;
      AppState.backCurrentCatalog = key;

      if (typeof abortCatalogRequests === 'function') {
        abortCatalogRequests();
      }

      var config = CATALOG_CONFIG[key];

      catalogState.currentCatalog = key;
      catalogState.cardElements = {};
      catalogState.items = [];
      catalogState.totalItems = 0;
      catalogState.currentPage = 1;
      catalogState.hasMore = false;
      catalogState.isLoadingMore = false;
      catalogState.loadedItemIds = {};
      catalogState.loadedPostersCount = 0;
      catalogState.posterLoadQueue = [];



      catalogState.fullItems = null;
      catalogState.fullItemsTruncated = false;

      AppState.mediaType = config.mediaType;

      if (typeof showCatalogLoading === 'function') {
        showCatalogLoading('Загрузка ' + config.name + '...');
      }

      try {
        fetchCatalogsWithCache().catch(function () {

        });


        var record = yield CatalogWorker.catalogIdbGet(key, getInitialTake());


        if (record && record.data) {
          applyFullCatalogData(key, record.data, record.timestamp);

          if (typeof hideCatalogLoading === 'function') {
            hideCatalogLoading();
          }


          if (isFreshTimestamp(record.timestamp)) {
            return;
          }





          CatalogWorker.catalogGetFresh(key, config.url, CATALOG_FULL_LIMIT, getInitialTake()).
          then(function (freshResult) {
            if (freshResult && freshResult.data) {
              applyFullCatalogUpdate(key, freshResult.data, freshResult.timestamp || Date.now());
            }
          }).
          catch(function (error) {
            console.warn('⚠️ Background catalog update failed:', error);
          });

          return;
        }


        var freshResult = yield CatalogWorker.catalogGetFresh(key, config.url, CATALOG_FULL_LIMIT, getInitialTake());

        if (freshResult && freshResult.data) {
          applyFullCatalogData(key, freshResult.data, freshResult.timestamp || Date.now());
        } else {
          if (typeof showCatalogError === 'function') {
            showCatalogError('Ошибка загрузки каталога');
          }
        }
      } catch (error) {
        console.error('❌ loadCatalog IDB error:', error);

        if (typeof showCatalogError === 'function') {
          showCatalogError('Ошибка загрузки каталога');
        }
      } finally {
        if (typeof hideCatalogLoading === 'function') {
          hideCatalogLoading();
        }
      }
    });return function loadCatalog(_x) {return _ref.apply(this, arguments);};}();



  window.loadMoreCatalogItems = loadMoreCatalogItems = function (reset) {
    if (reset && catalogState.currentCatalog) {
      return loadCatalog(catalogState.currentCatalog);
    }

    if (!catalogState.currentCatalog || catalogState.isLoadingMore) {
      return Promise.resolve(false);
    }


    if (!catalogState.fullItems || !catalogState.hasMore) {
      return Promise.resolve(false);
    }

    catalogState.isLoadingMore = true;

    var key = catalogState.currentCatalog;



    var ready = catalogState.items.length >= catalogState.fullItems.length &&
    catalogState.fullItemsTruncated ?
    extendFullItems(key) :
    Promise.resolve(false);

    return ready.then(function () {
      if (catalogState.currentCatalog !== key) {
        catalogState.isLoadingMore = false;
        return false;
      }

      var pageSize = getPageSize();


      var start = catalogState.items.length;
      var nextItems = catalogState.fullItems.slice(start, start + pageSize);

      if (!nextItems.length) {
        catalogState.hasMore = false;
        catalogState.isLoadingMore = false;
        return false;
      }

      var unique = [];

      for (var i = 0; i < nextItems.length; i++) {
        var item = nextItems[i];

        if (!item) continue;

        if (!item.id || !catalogState.loadedItemIds[item.id]) {
          if (item.id) {
            catalogState.loadedItemIds[item.id] = true;
          }

          unique.push(item);
        }
      }

      for (var j = 0; j < unique.length; j++) {
        catalogState.items.push(unique[j]);
      }

      catalogState.currentPage = Math.ceil(catalogState.items.length / pageSize);
      catalogState.hasMore =
      catalogState.items.length < catalogState.fullItems.length ||
      catalogState.fullItemsTruncated;

      if (typeof appendCatalogItems === 'function') {
        appendCatalogItems(unique);
      } else {
        renderCatalogGrid();
      }

      catalogState.isLoadingMore = false;
      return true;
    }).catch(function (error) {
      console.error('loadMoreCatalogItems IDB error:', error);
      catalogState.isLoadingMore = false;
      return false;
    });
  };



  window.fallbackLoadAllCatalogItems = fallbackLoadAllCatalogItems = function () {var _ref2 = _asyncToGenerator(function* () {
      var key = catalogState.currentCatalog;

      if (!key) return;

      var cfg = window.CATALOG_CONFIG && CATALOG_CONFIG[key];

      if (!cfg || !cfg.url) return;

      try {
        var result = yield CatalogWorker.catalogGetFresh(key, cfg.url, CATALOG_FULL_LIMIT);

        if (result && result.data) {
          applyFullCatalogData(key, result.data, result.timestamp || Date.now());
        } else {
          if (typeof showCatalogError === 'function') {
            showCatalogError('Ошибка загрузки каталога');
          }
        }
      } catch (error) {
        console.error('❌ fallbackLoadAllCatalogItems IDB error:', error);

        if (typeof showCatalogError === 'function') {
          showCatalogError('Ошибка загрузки каталога');
        }
      }
    });return function fallbackLoadAllCatalogItems() {return _ref2.apply(this, arguments);};}();



  var _origLoadRowItems = window.loadRowItems || loadRowItems;



  var _rowStamps = {};

  window.loadRowItems = loadRowItems = function () {var _ref3 = _asyncToGenerator(function* (key) {
      var LIMIT = 10;


      if (key === 'favorites') {
        if (typeof window.loadFavoritesItems !== 'function') {
          return _origLoadRowItems ? _origLoadRowItems.call(window, key) : [];
        }


        var favs = yield window.loadFavoritesItems(0);
        window.catalogRowTotals[key] = favs.length;
        return favs.slice(0, LIMIT);
      }


      if (key === 'history') {
        if (_origLoadRowItems) {
          return _origLoadRowItems.call(window, key);
        }

        return [];
      }

      var cfg = window.CATALOG_CONFIG && CATALOG_CONFIG[key];

      if (!cfg || !cfg.url) {
        return [];
      }

      try {



        var result = yield CatalogWorker.catalogGetFresh(key, cfg.url, CATALOG_FULL_LIMIT, LIMIT);

        if (result && result.data && Array.isArray(result.data.items)) {
          if (result.data.totalItems) window.catalogRowTotals[key] = result.data.totalItems;
          if (result.timestamp) _rowStamps[key] = result.timestamp;
          return result.data.items.slice(0, LIMIT);
        }

        return [];
      } catch (error) {
        console.warn('⚠️ loadRowItems IDB error:', error);
        return [];
      }
    });return function loadRowItems(_x2) {return _ref3.apply(this, arguments);};}();






















  var _catalogServerUpdateAttempts = {};
  var UPDATE_RETRY_MS = 5 * 60 * 1000;
  var MAX_UPDATE_ATTEMPTS = 2;

  window.checkAndUpdateCatalogIfNeeded = checkAndUpdateCatalogIfNeeded = function () {var _ref4 = _asyncToGenerator(function* (id, iso) {
      if (!id || !iso || _catalogIdbUpdating) {
        return false;
      }

      var thresholdHours =
      window.CATALOG_CONSTANTS && CATALOG_CONSTANTS.CATALOG_UPDATE_THRESHOLD_HOURS ?
      CATALOG_CONSTANTS.CATALOG_UPDATE_THRESHOLD_HOURS :
      6;

      var serverTime = new Date(iso).getTime();

      if (isNaN(serverTime)) {
        return false;
      }

      var hours = (Date.now() - serverTime) / 3600000;


      if (hours <= thresholdHours) {
        return false;
      }

      var now = Date.now();
      var attempt = _catalogServerUpdateAttempts[id];

      if (attempt) {

        if (attempt.giveUp) {
          return false;
        }



        if (attempt.done && attempt.iso === iso) {
          attempt.giveUp = true;
          console.warn('⚠️ Каталог "' + id + '": дата не изменилась после обновления, больше не пробуем');
          return false;
        }

        if (attempt.attempts >= MAX_UPDATE_ATTEMPTS) {
          attempt.giveUp = true;
          console.warn('⚠️ Каталог "' + id + '": исчерпан лимит попыток обновления за сессию');
          return false;
        }

        if (now - attempt.at < UPDATE_RETRY_MS) {
          return false;
        }

        attempt.at = now;
        attempt.iso = iso;
        attempt.done = false;
        attempt.attempts++;
      } else {
        _catalogServerUpdateAttempts[id] = attempt =
        { at: now, iso: iso, done: false, attempts: 1, giveUp: false };
      }

      _catalogIdbUpdating = true;

      try {
        console.log('⏳ Каталог "' + id + '" старше ' + thresholdHours + ' часов, отправляем запрос на обновление');


        var updateResponse = yield safeFetch(
          SERVER_URL + '/api/catalog/' + encodeURIComponent(id) + '/update',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            timeout: 30000
          }
        );

        var updated = !!(updateResponse && updateResponse.success);

        if (!updated) {
          console.warn('⚠️ Каталог "' + id + '" не был обновлён сервером');
          return false;
        }

        console.log('✅ Каталог "' + id + '" обновлён на сервере');




        attempt.done = true;



        if (typeof invalidateCatalogsListCache === 'function') {
          invalidateCatalogsListCache();
        }


        if (window.CatalogWorker && CatalogWorker.catalogIdbDelete) {
          yield CatalogWorker.catalogIdbDelete(id);
        }


        var cfg = window.CATALOG_CONFIG && CATALOG_CONFIG[id];

        if (cfg && cfg.url) {
          var freshResult = yield CatalogWorker.catalogGetFresh(
            id,
            cfg.url,
            typeof CATALOG_FULL_LIMIT !== 'undefined' ? CATALOG_FULL_LIMIT : 1000
          );





          if (freshResult && freshResult.data) {
            applyFullCatalogUpdate(
              id,
              freshResult.data,
              freshResult.timestamp || Date.now()
            );
          }
        }

        return true;
      } catch (error) {
        console.error('❌ checkAndUpdateCatalogIfNeeded error:', error);
        return false;
      } finally {
        _catalogIdbUpdating = false;
      }
    });return function checkAndUpdateCatalogIfNeeded(_x3, _x4) {return _ref4.apply(this, arguments);};}();





  function catalogUpdateText(key, catalogs) {
    for (var i = 0; i < catalogs.length; i++) {
      if (catalogs[i].id === key && catalogs[i].lastModifiedISO) {
        return formatShowAllDate(catalogs[i].lastModifiedISO);
      }
    }
    var meta = getCatalogIdbMeta(key);
    var ts = meta && meta.timestamp || _rowStamps[key];
    return ts ? formatShowAllDate(new Date(ts).toISOString()) : '';
  }


  function formatShowAllDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + ' ' +
    ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }





  var _origCreateShowAllCard = window.createShowAllCard || createShowAllCard;

  window.createShowAllCard = createShowAllCard = function (key) {
    var card = _origCreateShowAllCard.call(window, key);
    var dateEl = card.querySelector('.show-all-date');
    var cfg = window.CATALOG_CONFIG && CATALOG_CONFIG[key];


    if (!dateEl || !cfg || !cfg.url) return card;

    fetchCatalogsWithCache().
    then(function (catalogs) {
      var text = catalogUpdateText(key, catalogs);


      if (text) dateEl.innerHTML = 'обновлено<br>' + text;
    }).
    catch(function () {});

    return card;
  };







  window.addCatalogHeader = addCatalogHeader = function (grid) {
    if (!grid) return null;

    var key = catalogState.currentCatalog;

    if (key === 'person') {
      var header = document.createElement('div');
      header.className = 'catalog-header';
      header.style.cssText =
      'grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;' +
      'margin-bottom:20px;padding:15px 20px;background:rgba(74,158,255,0.1);' +
      'border-radius:16px;border:1px solid rgba(74,158,255,0.3);flex-wrap:wrap;gap:10px;';
      var pname = catalogState.person && catalogState.person.name || 'Фильмография';
      header.innerHTML =
      '<div class="fg-col-5" style="display:flex;flex-direction:column;gap:5px">' +
      '<span style="font-size:20px;font-weight:600;color:#4a9eff">' + escapeHtml(pname) + '</span>' +
      '<div class="fg-row-15" style="display:flex;gap:15px;font-size:12px;color:#aaa">' +
      '<span>фильмы и сериалы с этим актёром</span>' +
      '</div>' +
      '</div>' +
      '<span style="font-size:14px;color:#aaa;background:rgba(0,0,0,0.3);padding:5px 12px;border-radius:20px">' +
      catalogState.items.length + '</span>';
      grid.appendChild(header);
      return header;
    }

    var cfg = window.CATALOG_CONFIG && CATALOG_CONFIG[key];


    if (!cfg || !cfg.url) return null;

    fetchCatalogsWithCache().
    then(function (catalogs) {
      if (catalogState.currentCatalog !== key) return;
      for (var i = 0; i < catalogs.length; i++) {
        if (catalogs[i].id === key && catalogs[i].lastModifiedISO) {
          if (typeof checkAndUpdateCatalogIfNeeded === 'function') {
            checkAndUpdateCatalogIfNeeded(key, catalogs[i].lastModifiedISO);
          }
          return;
        }
      }
    }).
    catch(function (error) {
      console.warn('⚠️ Failed to load catalogs list:', error);
    });

    return null;
  };

  console.log('✅ Catalog IndexedDB patch applied: limit=' + CATALOG_FULL_LIMIT + ', ttl=6h');
})();
