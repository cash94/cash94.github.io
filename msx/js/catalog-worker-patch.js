// catalog-worker-patch.js — ИСПРАВЛЕННАЯ ВЕРСИЯ
(function () {
    'use strict';

    // ==================== ОРИГИНАЛЫ ====================
    var _origLoadMoreCatalogItems = window.loadMoreCatalogItems || loadMoreCatalogItems;
    var _origFallbackLoadAll = window.fallbackLoadAllCatalogItems || fallbackLoadAllCatalogItems;
    var _origLoadHistoryCatalog = window.loadHistoryCatalog || loadHistoryCatalog;
    var _origFetchAvailableCatalogs = window.fetchAvailableCatalogs || fetchAvailableCatalogs;
    //var _origFetchTmdbDetails = window.fetchTmdbDetails || fetchTmdbDetails;
    //var _origFetchCatalogActors = window.fetchCatalogActors || fetchCatalogActors;
    //var _origFetchCatalogItemDetails = window.fetchCatalogItemDetails || fetchCatalogItemDetails;
    //var _origFetchCatalogItemMeta = window.fetchCatalogItemMeta || fetchCatalogItemMeta;
    //var _origAddToWatchHistory = window.addToWatchHistory;
    var _origCheckAndUpdate = window.checkAndUpdateCatalogIfNeeded || checkAndUpdateCatalogIfNeeded;

    // Флаг: идёт ли обновление каталога (защита от цикла)
    var _isUpdating = false;

    // ==================== loadCatalog (ПАТЧ) ====================
    // Оборачиваем оригинал, добавляя проверку Worker-кэша
    var _origLoadCatalog = window.catalog ? window.catalog.loadCatalog : loadCatalog;

    window.loadCatalog = loadCatalog = function (key) {
        if (!CATALOG_CONFIG[key]) return Promise.resolve();

        AppState.backCurrentCatalog = key;
        abortCatalogRequests();
        catalogState.abortController = new AbortController();

        var config = CATALOG_CONFIG[key];
        catalogState.currentCatalog = key;
        catalogState.cardElements = {};
        catalogState.items = [];
        catalogState.totalItems = 0;
        catalogState.currentPage = 0;
        catalogState.hasMore = true;
        catalogState.isLoadingMore = false;
        catalogState.loadedItemIds = {};
        catalogState.loadedPostersCount = 0;
        catalogState.posterLoadQueue = [];
        catalogState.posterCache.clear();
        AppState.mediaType = config.mediaType;

        showCatalogLoading('Загрузка ' + config.name + '...');

        // 1. Проверяем ЛОКАЛЬНЫЙ кэш (как в оригинале)
        if (catalogCache.has(key)) {
            var cached = catalogCache.get(key);
            if (Date.now() - cached.timestamp < CATALOG_CONSTANTS.CATALOG_CACHE_TTL_MS) {
                catalogState.items = cached.data.items || [];
                catalogState.totalItems = cached.data.totalItems || catalogState.items.length;
                catalogState.currentPage = cached.data.currentPage || 0;
                catalogState.hasMore = cached.data.hasMore || false;
                for (var i = 0; i < catalogState.items.length; i++) {
                    if (catalogState.items[i].id) catalogState.loadedItemIds[catalogState.items[i].id] = true;
                }
                catalogState.loading = false;
                hideCatalogLoading();
                renderCatalogGrid();
                catalogState.abortController = null;
                return Promise.resolve();
            }
        }

        // 2. Загружаем через Worker
        return loadMoreCatalogItems(true).then(function () {
            catalogState.abortController = null;
        });
    };

    // ==================== loadMoreCatalogItems (ПАТЧ) ====================
    window.loadMoreCatalogItems = loadMoreCatalogItems = function (reset) {
        reset = reset || false;
        if (!catalogState.currentCatalog || catalogState.isLoadingMore) return Promise.resolve(false);

        if (reset) {
            catalogState.currentPage = 0;
            catalogState.items = [];
            catalogState.loadedItemIds = {};
            catalogState.hasMore = true;
            catalogState.totalItems = 0;
        }

        if (!catalogState.hasMore) return Promise.resolve(false);
        catalogState.isLoadingMore = true;

        var cfg = CATALOG_CONFIG[catalogState.currentCatalog];
        var from = catalogState.currentPage * catalogState.itemsPerPage;

        return CatalogWorker.loadCatalogItems(cfg.url, from, catalogState.itemsPerPage)
            .then(function (d) {
                var newItems = d.items || [], pag = d.pagination || {};
                if (pag.total) catalogState.totalItems = pag.total;
                catalogState.hasMore = pag.hasMore !== undefined ? pag.hasMore : newItems.length === catalogState.itemsPerPage;

                // Дедупликация
                var unique = [];
                for (var i = 0; i < newItems.length; i++) {
                    if (!newItems[i].id || !catalogState.loadedItemIds[newItems[i].id]) {
                        if (newItems[i].id) catalogState.loadedItemIds[newItems[i].id] = true;
                        unique.push(newItems[i]);
                    }
                }

                for (var j = 0; j < unique.length; j++) catalogState.items.push(unique[j]);
                catalogState.currentPage++;

                if (reset) renderCatalogGrid();
                else appendCatalogItems(unique);

                // ★ КЛЮЧЕВОЙ ФИКС: сохраняем в ЛОКАЛЬНЫЙ catalogCache
                catalogCache.set(catalogState.currentCatalog, {
                    data: {
                        items: catalogState.items.slice(),
                        totalItems: catalogState.totalItems,
                        currentPage: catalogState.currentPage,
                        hasMore: catalogState.hasMore
                    },
                    timestamp: Date.now()
                });

                return true;
            })
            .catch(function (e) {
                console.error('Catalog load error (worker):', e);
                // Фоллбек на оригинальную загрузку
                return _origFallbackLoadAll.call(window);
            })
            .finally(function () {
                catalogState.isLoadingMore = false;
            });
    };

    // ==================== checkAndUpdateCatalogIfNeeded (ПАТЧ) ====================
    window.checkAndUpdateCatalogIfNeeded = checkAndUpdateCatalogIfNeeded = function (id, iso) {
        if (!iso || _isUpdating) return Promise.resolve(false);

        var h = (new Date() - new Date(iso)) / 3600000;
        if (h > CATALOG_CONSTANTS.CATALOG_UPDATE_THRESHOLD_HOURS) {
            _isUpdating = true;

            return CatalogWorker.checkCatalogUpdate(id, iso)
                .then(function (result) {
                    if (result && result.updated) {
                        // Удаляем из ЛОКАЛЬНОГО кэша
                        catalogCache.delete(id);
                        if (catalogState.currentCatalog === id) {
                            setTimeout(function () {
                                _isUpdating = false;
                                loadCatalog(id);
                            }, 500);
                        } else {
                            _isUpdating = false;
                        }
                        return true;
                    }
                    _isUpdating = false;
                    return false;
                })
                .catch(function () {
                    _isUpdating = false;
                    return false;
                });
        }
        return Promise.resolve(false);
    };

    // ==================== addCatalogHeader (ПАТЧ) ====================
    // Кэшируем результат /api/catalogs чтобы не дёргать каждый рендер
    var _catalogsCache = null;
    var _catalogsCacheTime = 0;
    var CATALOGS_CACHE_TTL = 60000; // 1 минута

    var _origAddCatalogHeader = addCatalogHeader;

    window.addCatalogHeader = addCatalogHeader = function (grid) {
        var header = document.createElement('div');
        header.className = 'catalog-header';
        header.style.cssText = 'grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;padding:15px 20px;background:rgba(74,158,255,0.1);border-radius:16px;border:1px solid rgba(74,158,255,0.3);flex-wrap:wrap;gap:10px;';

        var name = (CATALOG_CONFIG[catalogState.currentCatalog] && CATALOG_CONFIG[catalogState.currentCatalog].name) || 'Каталог';

        if (catalogState.currentCatalog === 'history') {
            header.innerHTML = '<div style="display:flex;flex-direction:column;gap:5px"><span style="font-size:20px;font-weight:600;color:#4a9eff">' + name + '</span><div style="display:flex;gap:15px;font-size:12px;color:#aaa"><span>' + catalogState.items.length + ' записей</span></div></div>';
            var btn = getEl('clear-history-btn');
            if (btn) btn.onclick = clearHistory;
            grid.appendChild(header);
            return;
        }

        header.innerHTML = '<span style="font-size:20px;font-weight:600;color:#4a9eff">' + name + '</span><span style="font-size:14px;color:#aaa;background:rgba(0,0,0,0.3);padding:5px 12px;border-radius:20px">' + catalogState.items.length + ' / ' + (catalogState.totalItems || catalogState.items.length) + '</span>';
        grid.appendChild(header);

        // ★ Кэшируем /api/catalogs (не дёргаем при каждом renderCatalogGrid)
        var now = Date.now();
        if (_catalogsCache && (now - _catalogsCacheTime < CATALOGS_CACHE_TTL)) {
            _applyCatalogInfo(header, _catalogsCache);
            return;
        }

        CatalogWorker.fetchCatalogs()
            .then(function (catalogs) {
                _catalogsCache = catalogs;
                _catalogsCacheTime = Date.now();
                _applyCatalogInfo(header, catalogs);
            })
            .catch(function () {
                // Фоллбек
                safeFetch(SERVER_URL + '/api/catalogs').then(function (d) {
                    if (d && d.success && d.catalogs) {
                        _catalogsCache = d.catalogs;
                        _catalogsCacheTime = Date.now();
                        _applyCatalogInfo(header, d.catalogs);
                    }
                });
            });
    };

    function _applyCatalogInfo(header, catalogs) {
        if (!catalogs || !header.isConnected) return;
        var info = null;
        for (var i = 0; i < catalogs.length; i++) {
            if (catalogs[i].id === catalogState.currentCatalog) { info = catalogs[i]; break; }
        }
        if (info && info.lastModifiedISO) {
            checkAndUpdateCatalogIfNeeded(info.id, info.lastModifiedISO);
            header.innerHTML += '<div style="display:flex;gap:15px;font-size:12px;color:#aaa;margin-top:4px"><span>' + formatLastModifiedDate(info.lastModifiedISO) + '</span></div>';
        }
    }

    // ==================== fallbackLoadAllCatalogItems (ПАТЧ) ====================
    window.fallbackLoadAllCatalogItems = fallbackLoadAllCatalogItems = function () {
        if (!catalogState.currentCatalog) return Promise.resolve();
        var cfg = CATALOG_CONFIG[catalogState.currentCatalog];

        return CatalogWorker.loadAllCatalogItems(cfg.url)
            .then(function (d) {
                catalogState.items = d.items || [];
                catalogState.totalItems = catalogState.items.length;
                catalogState.hasMore = false;
                catalogState.currentPage = 1;
                catalogState.loadedItemIds = {};
                for (var i = 0; i < catalogState.items.length; i++) {
                    if (catalogState.items[i].id) catalogState.loadedItemIds[catalogState.items[i].id] = true;
                }
                renderCatalogGrid();

                // ★ Сохраняем в ЛОКАЛЬНЫЙ кэш
                catalogCache.set(catalogState.currentCatalog, {
                    data: {
                        items: catalogState.items.slice(),
                        totalItems: catalogState.totalItems,
                        currentPage: 1,
                        hasMore: false
                    },
                    timestamp: Date.now()
                });
            })
            .catch(function (e) {
                console.error('Fallback error:', e);
                showCatalogError('Ошибка загрузки каталога');
            });
    };

    // ==================== loadHistoryCatalog (ПАТЧ) ====================
    window.loadHistoryCatalog = loadHistoryCatalog = function () {
        abortCatalogRequests();
        catalogState.currentCatalog = 'history';
        catalogState.cardElements = {};
        catalogState.items = [];
        catalogState.totalItems = 0;
        catalogState.currentPage = 0;
        catalogState.hasMore = false;
        catalogState.isLoadingMore = false;
        catalogState.loadedItemIds = {};
        catalogState.loadedPostersCount = 0;
        catalogState.posterLoadQueue = [];
        AppState.mediaType = 'history';
        showCatalogLoading('Загрузка истории просмотра...');

        return CatalogWorker.loadHistory()
            .then(function (data) {
                if (data && data.success && data.history && data.history.length > 0) {
                    catalogState.items = data.history.map(function (item, idx) {
                        var pp = item.posterPath;
                        if (pp && pp.indexOf('http') !== 0) pp = (pp.indexOf('/') === 0 ? pp : '/' + pp);
                        return {
                            id: item.tmdbId, title: item.title, name: item.title, media_type: item.mediaType,
                            poster_path: pp, vote_average: null, overview: null,
                            release_date: item.watchedAt ? item.watchedAt.split('T')[0] : null,
                            watchededAt: item.watchedAt, timestamp: item.timestamp,
                            isHistoryItem: true, historyIndex: idx
                        };
                    }).sort(function (a, b) { return b.timestamp - a.timestamp; });
                    catalogState.totalItems = catalogState.items.length;

                    // ★ Локальный кэш
                    catalogCache.set('history', {
                        data: { items: catalogState.items.slice(), totalItems: catalogState.totalItems, currentPage: 1, hasMore: false },
                        timestamp: Date.now()
                    });

                    renderCatalogGrid();
                } else {
                    showEmptyHistory();
                }
            })
            .catch(function (e) {
                console.error('History load error:', e);
                showCatalogError('Не удалось загрузить историю просмотра');
            })
            .finally(function () {
                hideCatalogLoading();
                catalogState.abortController = null;
            });
    };

    // ==================== fetchAvailableCatalogs (ПАТЧ) ====================
    window.fetchAvailableCatalogs = fetchAvailableCatalogs = function () {
        return CatalogWorker.fetchCatalogs()
            .then(function (catalogs) { return catalogs || []; })
            .catch(function () { return []; });
    };

    // ==================== TMDB функции (ПАТЧ) ====================
    window.fetchTmdbDetails = fetchTmdbDetails = function (item) {
        return CatalogWorker.fetchTmdbDetails(item).catch(function () {
            return _origFetchTmdbDetails(item);
        });
    };

    window.fetchCatalogActors = fetchCatalogActors = function (item) {
        return CatalogWorker.fetchActors(item).catch(function () {
            return _origFetchCatalogActors(item);
        });
    };

    window.fetchCatalogItemDetails = fetchCatalogItemDetails = function (item) {
        return CatalogWorker.fetchItemDetails(item).catch(function () {
            return _origFetchCatalogItemDetails(item);
        });
    };

    window.fetchCatalogItemMeta = fetchCatalogItemMeta = function (item, mediaType) {
        return CatalogWorker.fetchItemMeta(item, mediaType).catch(function () {
            return _origFetchCatalogItemMeta(item, mediaType);
        });
    };

    // ==================== addToWatchHistory (ПАТЧ) ====================
    window.addToWatchHistory = function (id, title, mt, pp) {
        return CatalogWorker.saveToHistory(id, title, mt, pp).catch(function (e) {
            console.error('History save error:', e);
        });
    };

    // ==================== clearHistory (ПАТЧ) ====================
    window.clearHistory = clearHistory = function () {
        if (!confirm('Очистить историю просмотра?')) return Promise.resolve();
        return CatalogWorker.clearHistory()
            .then(function (d) {
                if (d && d.success) {
                    catalogCache.delete('history');
                    return loadHistoryCatalog();
                }
                alert('Ошибка очистки');
            })
            .catch(function (e) {
                console.error(e);
                alert('Ошибка очистки: ' + e.message);
            });
    };

    // ==================== initCatalog (ПАТЧ) ====================
    var _origInitCatalog = window.initCatalog || initCatalog;

    window.initCatalog = initCatalog = function () {
        CatalogWorker.init();

        window.tmdbCache = {
            clear: function () { CatalogWorker.cacheClear(); },
            stats: function () { return CatalogWorker.cacheStats(); },
            setEnabled: function (v) { CatalogWorker.cacheSetEnabled(v); },
            isEnabled: function () { return true; },
            setTtl: function (v) { CatalogWorker.cacheSetTtl(v); }
        };
    };

    // Переинициализация
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { initCatalog(); });
    } else {
        initCatalog();
    }

    console.log('✅ Catalog Worker patches applied (v2 — loop fix)');
})();
