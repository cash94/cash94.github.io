// catalog-idb-patch.js
// IndexedDB-кэширование каталогов: limit=1000, TTL=6 часов
(function () {
    'use strict';

    if (!window.CatalogWorker) {
        console.error('❌ catalog-idb-patch: CatalogWorker недоступен');
        return;
    }

    var CATALOG_FULL_LIMIT = 1000;
    var _catalogIdbUpdating = false;

    function getTtlMs() {
        var hours = window.CATALOG_CONSTANTS && CATALOG_CONSTANTS.CATALOG_UPDATE_THRESHOLD_HOURS
            ? CATALOG_CONSTANTS.CATALOG_UPDATE_THRESHOLD_HOURS
            : 6;

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
            if (key === 'history') continue;

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

    function applyFullCatalogData(key, data, timestamp) {
        if (!key || !data) return;

        var items = Array.isArray(data.items) ? data.items : [];

        catalogState.currentCatalog = key;
        catalogState.items = items;
        catalogState.totalItems = data.totalItems || items.length;
        catalogState.currentPage = 1;
        catalogState.hasMore = false;
        catalogState.isLoadingMore = false;

        catalogState.loadedItemIds =
            data.loadedItemIds && Object.keys(data.loadedItemIds).length > 0
                ? data.loadedItemIds
                : buildLoadedItemIds(items);

        catalogState.cardElements = {};
        catalogState.loadedPostersCount = 0;
        catalogState.posterLoadQueue = [];

        if (window.catalogCache && catalogCache.set) {
            catalogCache.set(key, {
                data: {
                    items: items.slice(),
                    totalItems: catalogState.totalItems,
                    currentPage: 1,
                    hasMore: false
                },
                timestamp: timestamp || Date.now()
            });
        }

        if (typeof renderCatalogGrid === 'function') {
            renderCatalogGrid();
        }
    }

    function prefetchAllFullCatalogs() {
        var entries = getFullCatalogEntries();

        if (!entries.length) {
            return Promise.resolve({});
        }

        return CatalogWorker.catalogPrefetchAll(entries, CATALOG_FULL_LIMIT)
            .catch(function (error) {
                console.warn('⚠️ Prefetch catalogs error:', error);
                return {};
            });
    }

    // ==================== showCatalogList ====================

    var _origShowCatalogList = window.showCatalogList || showCatalogList;

    window.showCatalogList = showCatalogList = function () {
        // Загружаем все каталоги в IndexedDB.
        // Если нужно ждать полную загрузку до показа списка,
        // замените строку ниже на:
        // return prefetchAllFullCatalogs().then(function () { return _origShowCatalogList.call(window); });
        prefetchAllFullCatalogs();

        return _origShowCatalogList.call(window);
    };

    // ==================== loadCatalog ====================

    var _origLoadCatalog = window.loadCatalog || loadCatalog;

    window.loadCatalog = loadCatalog = async function (key) {
        if (!window.CATALOG_CONFIG || !CATALOG_CONFIG[key]) {
            return;
        }

        if (key === 'history') {
            return loadHistoryCatalog();
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

        AppState.mediaType = config.mediaType;

        if (typeof showCatalogLoading === 'function') {
            showCatalogLoading('Загрузка ' + config.name + '...');
        }

        try {
            var record = await CatalogWorker.catalogIdbGet(key);

            // 1. Если есть кэш в IndexedDB
            if (record && record.data) {
                applyFullCatalogData(key, record.data, record.timestamp);

                if (typeof hideCatalogLoading === 'function') {
                    hideCatalogLoading();
                }

                // Кэш свежий — сеть не трогаем
                if (isFreshTimestamp(record.timestamp)) {
                    return;
                }

                // Кэш старше 6 часов — обновляем.
                // Сейчас он обновляется в фоне, показывая старый каталог.
                // Если хотите блокировать показ до полного обновления,
                // замените этот блок на await CatalogWorker.catalogGetFresh(...)
                CatalogWorker.catalogGetFresh(key, config.url, CATALOG_FULL_LIMIT)
                    .then(function (freshResult) {
                        if (catalogState.currentCatalog === key && freshResult && freshResult.data) {
                            applyFullCatalogData(key, freshResult.data, freshResult.timestamp || Date.now());
                        }
                    })
                    .catch(function (error) {
                        console.warn('⚠️ Background catalog update failed:', error);
                    });

                return;
            }

            // 2. Если кэша нет вообще — грузим из сети и сохраняем в IndexedDB
            var freshResult = await CatalogWorker.catalogGetFresh(key, config.url, CATALOG_FULL_LIMIT);

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
    };

    // ==================== loadMoreCatalogItems ====================

    window.loadMoreCatalogItems = loadMoreCatalogItems = function (reset) {
        if (reset && catalogState.currentCatalog) {
            return loadCatalog(catalogState.currentCatalog);
        }

        // Так как каталог теперь загружается целиком через limit=1000,
        // дополнительная подгрузка страниц не используется.
        return Promise.resolve(false);
    };

    // ==================== fallbackLoadAllCatalogItems ====================

    window.fallbackLoadAllCatalogItems = fallbackLoadAllCatalogItems = async function () {
        var key = catalogState.currentCatalog;

        if (!key) return;

        var cfg = window.CATALOG_CONFIG && CATALOG_CONFIG[key];

        if (!cfg || !cfg.url) return;

        try {
            var result = await CatalogWorker.catalogGetFresh(key, cfg.url, CATALOG_FULL_LIMIT);

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
    };

    // ==================== loadRowItems ====================

    var _origLoadRowItems = window.loadRowItems || loadRowItems;

    window.loadRowItems = loadRowItems = async function (key) {
        var LIMIT = 10;

        // История не является каталогом /items, её оставляем как было
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
            var result = await CatalogWorker.catalogGetFresh(key, cfg.url, CATALOG_FULL_LIMIT);

            if (result && result.data && Array.isArray(result.data.items)) {
                return result.data.items.slice(0, LIMIT);
            }

            return [];
        } catch (error) {
            console.warn('⚠️ loadRowItems IDB error:', error);
            return [];
        }
    };

    // ==================== checkAndUpdateCatalogIfNeeded ====================

    window.checkAndUpdateCatalogIfNeeded = checkAndUpdateCatalogIfNeeded = function (id) {
        if (!id || _catalogIdbUpdating) {
            return Promise.resolve(false);
        }

        return CatalogWorker.catalogIdbGet(id)
            .then(function (record) {
                if (record && isFreshTimestamp(record.timestamp)) {
                    return false;
                }

                var cfg = window.CATALOG_CONFIG && CATALOG_CONFIG[id];

                if (!cfg || !cfg.url) {
                    return false;
                }

                _catalogIdbUpdating = true;

                return CatalogWorker.catalogGetFresh(id, cfg.url, CATALOG_FULL_LIMIT)
                    .then(function (result) {
                        if (result && result.source === 'network') {
                            if (window.catalogCache && catalogCache.delete) {
                                catalogCache.delete(id);
                            }

                            if (catalogState.currentCatalog === id && result.data) {
                                applyFullCatalogData(id, result.data, result.timestamp || Date.now());
                            }

                            return true;
                        }

                        return false;
                    })
                    .catch(function () {
                        return false;
                    })
                    .then(function (updated) {
                        _catalogIdbUpdating = false;
                        return updated;
                    });
            })
            .catch(function () {
                _catalogIdbUpdating = false;
                return false;
            });
    };

    // ==================== addCatalogHeader ====================
    // Убираем лишний запрос /api/catalogs из шапки, чтобы каталоги читались только из IDB.

    window.addCatalogHeader = addCatalogHeader = function (grid) {
        if (!grid) return null;

        var header = document.createElement('div');
        header.className = 'catalog-header';
        header.style.cssText =
            'grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;' +
            'margin-bottom:20px;padding:15px 20px;background:rgba(74,158,255,0.1);' +
            'border-radius:16px;border:1px solid rgba(74,158,255,0.3);flex-wrap:wrap;gap:10px;';

        var name =
            window.CATALOG_CONFIG &&
                CATALOG_CONFIG[catalogState.currentCatalog] &&
                CATALOG_CONFIG[catalogState.currentCatalog].name
                ? CATALOG_CONFIG[catalogState.currentCatalog].name
                : 'Каталог';

        if (catalogState.currentCatalog === 'history') {
            header.innerHTML =
                '<div style="display:flex;flex-direction:column;gap:5px">' +
                '<span style="font-size:20px;font-weight:600;color:#4a9eff">' + name + '</span>' +
                '<div style="display:flex;gap:15px;font-size:12px;color:#aaa">' +
                '<span>' + catalogState.items.length + ' записей</span>' +
                '</div>' +
                '</div>';

            var btn = getEl('clear-history-btn');
            if (btn && typeof clearHistory === 'function') {
                btn.onclick = clearHistory;
            }

            grid.appendChild(header);
            return header;
        }

        header.innerHTML =
            '<span style="font-size:20px;font-weight:600;color:#4a9eff">' + name + '</span>' +
            '<span style="font-size:14px;color:#aaa;background:rgba(0,0,0,0.3);padding:5px 12px;border-radius:20px">' +
            catalogState.items.length + ' / ' + (catalogState.totalItems || catalogState.items.length) +
            '</span>';

        grid.appendChild(header);
        return header;
    };

    console.log('✅ Catalog IndexedDB patch applied: limit=' + CATALOG_FULL_LIMIT + ', ttl=6h');
})();