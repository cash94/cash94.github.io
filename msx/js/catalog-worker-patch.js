// catalog-worker-patch.js — v4 (same-origin Worker, полный оффлоад)
(function () {
    'use strict';

    var _origLoadMoreCatalogItems = window.loadMoreCatalogItems || loadMoreCatalogItems;
    var _origFallbackLoadAll = window.fallbackLoadAllCatalogItems || fallbackLoadAllCatalogItems;
    var _origLoadHistoryCatalog = window.loadHistoryCatalog || loadHistoryCatalog;
    var _origFetchAvailableCatalogs = window.fetchAvailableCatalogs || fetchAvailableCatalogs;
    var _origFetchTmdbDetails = window.fetchTmdbDetails || fetchTmdbDetails;
    var _origFetchCatalogActors = window.fetchCatalogActors || fetchCatalogActors;
    var _origFetchCatalogItemDetails = window.fetchCatalogItemDetails || fetchCatalogItemDetails;
    var _origFetchCatalogItemMeta = window.fetchCatalogItemMeta || fetchCatalogItemMeta;
    var _origAddToWatchHistory = window.addToWatchHistory;
    var _origCheckAndUpdate = window.checkAndUpdateCatalogIfNeeded || checkAndUpdateCatalogIfNeeded;

    var _isUpdating = false;
    var _catalogsCache = null;
    var _catalogsCacheTime = 0;
    var CATALOGS_CACHE_TTL = 60000;

    // ==================== TMDB (через Worker) ====================
    window.fetchTmdbDetails = fetchTmdbDetails = function (item) {
        return CatalogWorker.fetchTmdbDetails(item)
            .then(function (data) {
                if (!data || (!data.id && !data.overview && !data.videos && !data.cast)) {
                    return _origFetchTmdbDetails(item);
                }
                return data;
            })
            .catch(function () { return _origFetchTmdbDetails(item); });
    };

    window.fetchCatalogActors = fetchCatalogActors = function (item) {
        return CatalogWorker.fetchActors(item)
            .then(function (actors) {
                if (!actors || !Array.isArray(actors) || actors.length === 0) {
                    return _origFetchCatalogActors(item);
                }
                return actors;
            })
            .catch(function () { return _origFetchCatalogActors(item); });
    };

    window.fetchCatalogItemDetails = fetchCatalogItemDetails = function (item) {
        return CatalogWorker.fetchItemDetails(item)
            .then(function (data) {
                if (!data || (!data.overview && !data.cast && !data.videos && !data.backdrop_path)) {
                    return _origFetchCatalogItemDetails(item);
                }
                return data;
            })
            .catch(function () { return _origFetchCatalogItemDetails(item); });
    };

    window.fetchCatalogItemMeta = fetchCatalogItemMeta = function (item, mediaType) {
        return CatalogWorker.fetchItemMeta(item, mediaType)
            .then(function (meta) {
                if (!meta || (!meta.overview && !meta.posterPath && !meta.rating)) {
                    return _origFetchCatalogItemMeta(item, mediaType);
                }
                return meta;
            })
            .catch(function () { return _origFetchCatalogItemMeta(item, mediaType); });
    };

    // ==================== loadMoreCatalogItems ====================
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

                // Дедупликация в Worker
                return CatalogWorker.deduplicate(newItems, catalogState.loadedItemIds)
                    .then(function (dedup) {
                        catalogState.loadedItemIds = dedup.loadedItemIds;
                        var unique = dedup.unique;
                        for (var j = 0; j < unique.length; j++) catalogState.items.push(unique[j]);
                        catalogState.currentPage++;
                        if (reset) renderCatalogGrid();
                        else appendCatalogItems(unique);

                        // ★ Локальный кэш (для loadCatalog)
                        catalogCache.set(catalogState.currentCatalog, {
                            data: { items: catalogState.items.slice(), totalItems: catalogState.totalItems, currentPage: catalogState.currentPage, hasMore: catalogState.hasMore },
                            timestamp: Date.now()
                        });
                        return true;
                    });
            })
            .catch(function (e) {
                if (e.name !== 'AbortError') {
                    console.error('Catalog load error (worker):', e);
                    return _origFallbackLoadAll.call(window);
                }
                return false;
            })
            .finally(function () {
                catalogState.isLoadingMore = false;
            });
    };

    // ==================== fallbackLoadAllCatalogItems ====================
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
                catalogCache.set(catalogState.currentCatalog, {
                    data: { items: catalogState.items.slice(), totalItems: catalogState.totalItems, currentPage: 1, hasMore: false },
                    timestamp: Date.now()
                });
            })
            .catch(function (e) {
                console.error('Fallback error:', e);
                showCatalogError('Ошибка загрузки каталога');
            });
    };

    // ==================== loadHistoryCatalog ====================
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
                            watchedAt: item.watchedAt, timestamp: item.timestamp,
                            isHistoryItem: true, historyIndex: idx
                        };
                    }).sort(function (a, b) { return b.timestamp - a.timestamp; });
                    catalogState.totalItems = catalogState.items.length;
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

    // ==================== checkAndUpdateCatalogIfNeeded ====================
    window.checkAndUpdateCatalogIfNeeded = checkAndUpdateCatalogIfNeeded = function (id, iso) {
        if (!iso || _isUpdating) return Promise.resolve(false);

        var h = (new Date() - new Date(iso)) / 3600000;
        if (h > CATALOG_CONSTANTS.CATALOG_UPDATE_THRESHOLD_HOURS) {
            _isUpdating = true;

            return CatalogWorker.checkCatalogUpdate(id, iso)
                .then(function (result) {
                    if (result && result.updated) {
                        catalogCache.delete(id);

                        // чтобы следующий addCatalogHeader получил СВЕЖИЙ lastModifiedISO
                        _catalogsCache = null;
                        _catalogsCacheTime = 0;

                        if (catalogState.currentCatalog === id) {
                            // Держим _isUpdating до завершения перезагрузки каталога
                            setTimeout(function () {
                                loadCatalog(id).then(function () {
                                    _isUpdating = false;
                                }).catch(function () {
                                    _isUpdating = false;
                                });
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

    // ==================== addCatalogHeader (кэш /api/catalogs) ====================
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

        var now = Date.now();
        if (_catalogsCache && (now - _catalogsCacheTime < CATALOGS_CACHE_TTL)) {
            _applyCatalogInfo(header, _catalogsCache);
            return;
        }

        CatalogWorker.fetchCatalogs()
            .then(function (data) {
                var catalogs = (data && data.success && data.catalogs) ? data.catalogs : [];
                _catalogsCache = catalogs;
                _catalogsCacheTime = Date.now();
                _applyCatalogInfo(header, catalogs);
            })
            .catch(function () {
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

    // ==================== fetchAvailableCatalogs ====================
    window.fetchAvailableCatalogs = fetchAvailableCatalogs = function () {
        return CatalogWorker.fetchCatalogs()
            .then(function (data) {
                // Worker возвращает полный ответ — извлекаем массив
                return (data && data.success && data.catalogs) ? data.catalogs : [];
            })
            .catch(function () { return []; });
    };

    // ==================== addToWatchHistory ====================
    window.addToWatchHistory = function (id, title, mt, pp) {
        return CatalogWorker.saveToHistory(id, title, mt, pp)
            .catch(function () { return _origAddToWatchHistory(id, title, mt, pp); });
    };

    // ==================== clearHistory ====================
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

    // ==================== loadRowItems (карусель главной страницы) ====================
    var _origLoadRowItems = window.loadRowItems || loadRowItems;

    window.loadRowItems = loadRowItems = async function (key) {
        var LIMIT = 10;

        if (key === 'history') {
            try {
                var data = await CatalogWorker.loadHistory();
                if (data && data.success && data.history && data.history.length) {
                    return data.history.slice(0, LIMIT).map(function (item) {
                        var pp = item.posterPath;
                        if (pp && pp.indexOf('http') !== 0) pp = (pp.indexOf('/') === 0 ? pp : '/' + pp);
                        return {
                            id: item.tmdbId, title: item.title, name: item.title,
                            media_type: item.mediaType, poster_path: pp,
                            vote_average: null, isHistoryItem: true
                        };
                    });
                }
                return [];
            } catch (e) {
                console.error('History load error (worker):', e);
                return _origLoadRowItems(key);
            }
        }

        var cfg = CATALOG_CONFIG[key];
        if (!cfg || !cfg.url) return [];

        try {
            var d = await CatalogWorker.loadCatalogItems(cfg.url, 0, LIMIT);
            if (d && d.success && d.items) return d.items.slice(0, LIMIT);
            return [];
        } catch (e) {
            console.error('Row items load error (worker):', e);
            return _origLoadRowItems(key);
        }
    };

    // ==================== initCatalog ====================
    var _origInitCatalog = window.initCatalog || initCatalog;

    window.initCatalog = initCatalog = function () {
        CatalogWorker.init();
        _origInitCatalog.call(window);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { initCatalog(); });
    } else {
        initCatalog();
    }

    console.log('✅ Catalog Worker patches applied (v4 — same-origin, full offload)');
})();
