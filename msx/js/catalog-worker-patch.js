// catalog-worker-patch.js — Патчи для catalog.js
// Подключается ПОСЛЕ catalog.js и catalog-worker-bridge.js

(function () {
    'use strict';

    // Сохраняем оригиналы для фоллбека
    var _origSafeFetch = window.safeFetch || safeFetch;
    var _origFetchTmdbDetails = window.fetchTmdbDetails || fetchTmdbDetails;
    var _origFetchCatalogActors = window.fetchCatalogActors || fetchCatalogActors;
    var _origFetchCatalogItemDetails = window.fetchCatalogItemDetails || fetchCatalogItemDetails;
    var _origFetchCatalogItemMeta = window.fetchCatalogItemMeta || fetchCatalogItemMeta;
    var _origLoadMoreCatalogItems = window.loadMoreCatalogItems || loadMoreCatalogItems;
    var _origFallbackLoadAll = window.fallbackLoadAllCatalogItems || fallbackLoadAllCatalogItems;
    var _origLoadHistory = window.loadHistoryCatalog || loadHistoryCatalog;
    var _origFetchAvailable = window.fetchAvailableCatalogs || fetchAvailableCatalogs;
    var _origAddToWatchHistory = window.addToWatchHistory;

    // ==================== ЗАМЕНА: fetchTmdbDetails ====================
    window.fetchTmdbDetails = fetchTmdbDetails = function (item) {
        return CatalogWorker.fetchTmdbDetails(item).catch(function () {
            return _origFetchTmdbDetails(item);
        });
    };

    // ==================== ЗАМЕНА: fetchCatalogActors ====================
    window.fetchCatalogActors = fetchCatalogActors = function (item) {
        return CatalogWorker.fetchActors(item).catch(function () {
            return _origFetchCatalogActors(item);
        });
    };

    // ==================== ЗАМЕНА: fetchCatalogItemDetails ====================
    window.fetchCatalogItemDetails = fetchCatalogItemDetails = function (item) {
        return CatalogWorker.fetchItemDetails(item).catch(function () {
            return _origFetchCatalogItemDetails(item);
        });
    };

    // ==================== ЗАМЕНА: fetchCatalogItemMeta ====================
    window.fetchCatalogItemMeta = fetchCatalogItemMeta = function (item, mediaType) {
        return CatalogWorker.fetchItemMeta(item, mediaType).catch(function () {
            return _origFetchCatalogItemMeta(item, mediaType);
        });
    };

    // ==================== ЗАМЕНА: loadMoreCatalogItems ====================
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
                return CatalogWorker.deduplicate(newItems, catalogState.loadedItemIds).then(function (dedup) {
                    catalogState.loadedItemIds = dedup.loadedItemIds;
                    var unique = dedup.unique;
                    for (var j = 0; j < unique.length; j++) catalogState.items.push(unique[j]);
                    catalogState.currentPage++;

                    if (reset) renderCatalogGrid();
                    else appendCatalogItems(unique);

                    // Сохраняем в кэш Worker
                    CatalogWorker.catalogCacheSet(catalogState.currentCatalog, {
                        items: catalogState.items.slice(),
                        totalItems: catalogState.totalItems,
                        currentPage: catalogState.currentPage,
                        hasMore: catalogState.hasMore
                    });

                    return true;
                });
            })
            .catch(function (e) {
                console.error('Catalog load error (worker):', e);
                return _origFallbackLoadAll();
            })
            .finally(function () {
                catalogState.isLoadingMore = false;
            });
    };

    // ==================== ЗАМЕНА: fallbackLoadAllCatalogItems ====================
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
                CatalogWorker.catalogCacheSet(catalogState.currentCatalog, {
                    items: catalogState.items.slice(),
                    totalItems: catalogState.totalItems,
                    currentPage: 1,
                    hasMore: false
                });
            })
            .catch(function (e) {
                console.error('Fallback error:', e);
                showCatalogError('Ошибка загрузки каталога');
            });
    };

    // ==================== ЗАМЕНА: loadHistoryCatalog ====================
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
                    CatalogWorker.catalogCacheSet('history', {
                        items: catalogState.items.slice(),
                        totalItems: catalogState.totalItems,
                        currentPage: 1,
                        hasMore: false
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

    // ==================== ЗАМЕНА: fetchAvailableCatalogs ====================
    window.fetchAvailableCatalogs = fetchAvailableCatalogs = function () {
        return CatalogWorker.fetchCatalogs()
            .then(function (d) {
                return (d && d.success && d.catalogs) ? d.catalogs : [];
            })
            .catch(function () { return []; });
    };

    // ==================== ЗАМЕНА: addToWatchHistory ====================
    window.addToWatchHistory = function (id, title, mt, pp) {
        return CatalogWorker.saveToHistory(id, title, mt, pp).catch(function (e) {
            console.error('History save error:', e);
        });
    };

    // ==================== ЗАМЕНА: clearHistory ====================
    window.clearHistory = clearHistory = function () {
        if (!confirm('Очистить историю просмотра?')) return Promise.resolve();
        return CatalogWorker.clearHistory()
            .then(function (d) {
                if (d && d.success) return loadHistoryCatalog();
                else alert('Ошибка очистки');
            })
            .catch(function (e) {
                console.error(e);
                alert('Ошибка очистки: ' + e.message);
            });
    };

    // ==================== ЗАМЕНА: loadCatalogPoster (постеры через Worker) ====================
    var _origLoadCatalogPoster = window.loadCatalogPoster || loadCatalogPoster;

    window.loadCatalogPoster = loadCatalogPoster = function (card, title, mt, id, index) {
        var div = card.querySelector('.torrent-poster');
        if (!div) return Promise.resolve();

        var key = id + '_' + mt;

        if (!catalogState.currentCatalog) {
            div.innerHTML = '<div class="no-poster">Каталог закрыт</div>';
            return Promise.resolve();
        }

        // Проверяем локальный LRU-кэш (быстрый путь, без Worker)
        var cached = catalogState.posterCache.get(key);
        if (cached) {
            updatePosterDOM(div, card.dataset.rating, cached);
            return Promise.resolve();
        }

        // History items — прямая ссылка
        var item = catalogState.items[index];
        if (catalogState.currentCatalog === 'history' && item && item.poster_path) {
            var pp = item.poster_path.indexOf('http') === 0 ? item.poster_path :
                (AppState.protocol + '//tsimg.hnar.online/t/p/' + CATALOG_CONSTANTS.IMG_SIZES.POSTER_MEDIUM +
                    (item.poster_path.indexOf('/') === 0 ? item.poster_path : '/' + item.poster_path));
            if (pp) {
                catalogState.posterCache.set(key, pp);
                updatePosterDOM(div, card.dataset.rating, pp);
                return Promise.resolve();
            }
        }

        // Запрашиваем URL постера через Worker
        return CatalogWorker.fetchPosterUrl(id, mt, title)
            .then(function (result) {
                var url = result && result.posterUrl;
                if (url) {
                    catalogState.posterCache.set(key, url);
                }
                updatePosterDOM(div, card.dataset.rating, url || '');
            })
            .catch(function (e) {
                console.warn('❌ Ошибка загрузки постера:', e.message);
                if (catalogState.currentCatalog) div.innerHTML = '<div class="no-poster">Нет постера</div>';
            });
    };

    // ==================== ЗАМЕНА: checkAndUpdateCatalogIfNeeded ====================
    window.checkAndUpdateCatalogIfNeeded = checkAndUpdateCatalogIfNeeded = function (id, iso) {
        return CatalogWorker.checkCatalogUpdate(id, iso)
            .then(function (updated) {
                if (updated) {
                    CatalogWorker.catalogCacheDelete(id);
                    if (catalogState.currentCatalog === id) {
                        setTimeout(function () { loadCatalog(id); }, 500);
                    }
                }
                return updated;
            })
            .catch(function () { return false; });
    };

    // ==================== ЗАМЕНА: initCatalog (tmdbCache API) ====================
    var _origInitCatalog = window.initCatalog || initCatalog;

    window.initCatalog = initCatalog = function () {
        // Запускаем Worker
        CatalogWorker.init();

        // Переопределяем API кэша
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

    console.log('✅ Catalog Worker patches applied');
})();