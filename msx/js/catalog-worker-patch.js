// catalog-worker-patch.js — v4 (same-origin Worker, полный оффлоад)
(function () {
    'use strict';

    // Захваты только тех оригиналов, к которым реально есть фолбэк ниже.
    // loadMoreCatalogItems / fallbackLoadAllCatalogItems / checkAndUpdateCatalogIfNeeded /
    // addCatalogHeader / fetchAvailableCatalogs здесь больше не переопределяются —
    // см. комментарии в соответствующих местах.
    var _origFetchTmdbDetails = window.fetchTmdbDetails || fetchTmdbDetails;
    var _origFetchCatalogActors = window.fetchCatalogActors || fetchCatalogActors;
    var _origFetchCatalogItemDetails = window.fetchCatalogItemDetails || fetchCatalogItemDetails;
    var _origFetchCatalogItemMeta = window.fetchCatalogItemMeta || fetchCatalogItemMeta;
    var _origAddToWatchHistory = window.addToWatchHistory;

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

    // ==================== loadMoreCatalogItems / fallbackLoadAllCatalogItems ====================
    //
    // Обе переопределялись здесь через Worker (LOAD_CATALOG_ITEMS,
    // LOAD_ALL_CATALOG_ITEMS, DEDUPLICATE) и обе перекрыты catalog-idb-patch.js,
    // который грузится следом (index.html). Постраничная загрузка из сети больше
    // не используется вовсе: полный каталог лежит в IndexedDB, а страницы
    // нарезаются локально из catalogState.fullItems. Код был недостижим.

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

    // ==================== checkAndUpdateCatalogIfNeeded / addCatalogHeader ====================
    //
    // Тоже перекрыты catalog-idb-patch.js. Вместе с ними убраны _applyCatalogInfo
    // и локальный минутный кэш /api/catalogs (_catalogsCache): в idb-patch есть
    // свой, на шесть часов, и обновление каталога там же завязано на IndexedDB.

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
                    return loadHistoryCatalog();
                }
                alert('Ошибка очистки');
            })
            .catch(function (e) {
                console.error(e);
                alert('Ошибка очистки: ' + e.message);
            });
    };

    // ==================== loadRowItems (ряд «История просмотра») ====================
    //
    // catalog-idb-patch.js перекрывает loadRowItems и для всех каталогов ходит в
    // IndexedDB. История каталогом /items не является, и для неё idb-patch зовёт
    // обратно наш _origLoadRowItems — то есть живой осталась только эта ветка.
    // Ветка обычных каталогов (LOAD_CATALOG_ITEMS) отсюда убрана как недостижимая.
    var _origLoadRowItems = window.loadRowItems || loadRowItems;

    window.loadRowItems = loadRowItems = async function (key) {
        var LIMIT = 10;

        // Избранное и обычные каталоги — не наша забота, отдаём дальше по цепочке
        if (key !== 'history') return _origLoadRowItems(key);

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
    };

    var _origFetchRutubeTrailer = window.fetchRutubeTrailer || fetchRutubeTrailer;

    // ==================== fetchRutubeTrailer ====================
    window.fetchRutubeTrailer = fetchRutubeTrailer = function (title, originalTitle, releaseDate) {
        return CatalogWorker.fetchRutubeTrailer(title, originalTitle, releaseDate)
            .then(function (data) {
                if (data && data.url) return data;
                return _origFetchRutubeTrailer(title, originalTitle, releaseDate);
            })
            .catch(function () {
                return _origFetchRutubeTrailer(title, originalTitle, releaseDate);
            });
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
