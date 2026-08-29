// catalog-idb-patch.js
// IndexedDB-кэширование каталогов: limit=1000, TTL=6 часов
(function () {
    'use strict';

    if (!window.CatalogWorker) {
        console.error('❌ catalog-idb-patch: CatalogWorker недоступен');
        return;
    }

    // ==================== Кэширование /api/catalogs ====================

    var _catalogsListCache = null;
    var _catalogsListCacheTime = 0;
    var CATALOGS_LIST_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 часов

    function invalidateCatalogsListCache() {
        _catalogsListCache = null;
        _catalogsListCacheTime = 0;
    }

    function fetchCatalogsWithCache() {
        var now = Date.now();

        // Если кэш свежий — возвращаем из памяти
        if (_catalogsListCache && (now - _catalogsListCacheTime < CATALOGS_LIST_CACHE_TTL)) {
            return Promise.resolve(_catalogsListCache);
        }

        // Запрашиваем с сервера
        return fetch(SERVER_URL + '/api/catalogs')
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }
                return response.json();
            })
            .then(function (data) {
                if (data && data.success && Array.isArray(data.catalogs)) {
                    _catalogsListCache = data.catalogs;
                    _catalogsListCacheTime = Date.now();
                    return data.catalogs;
                }
                throw new Error('Invalid catalogs response');
            })
            .catch(function (error) {
                console.warn('⚠️ fetchCatalogsWithCache error:', error);
                // Если есть старый кэш — возвращаем его
                if (_catalogsListCache) {
                    return _catalogsListCache;
                }
                return [];
            });
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

    function getPageSize() {
        return (window.CATALOG_CONSTANTS && CATALOG_CONSTANTS.ITEMS_PER_PAGE) ||
            (window.catalogState && catalogState.itemsPerPage) ||
            150;
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

    /**
     * Сколько элементов просим у воркера на первый показ категории.
     *
     * Полная запись — до CATALOG_FULL_LIMIT элементов плюс словарь loadedItemIds
     * на столько же ключей, и всё это раскладывается structured clone'ом в
     * ГЛАВНОМ потоке ровно в момент перехода в категорию. При этом на экран
     * попадает одна страница. Берём две (запас на первую прокрутку), остальное
     * дотягиваем только если человек действительно долистает — до конца тысячи
     * доходят единицы.
     */
    function getInitialTake() {
        return getPageSize() * 2;
    }

    /**
     * Отмечает, что воркер прислал урезанную выборку.
     *
     * data.fullCount добавляет sliceCatalogResult в воркере. Его может не быть
     * совсем: устаревший закэшированный воркер про take не знает и присылает всё
     * целиком — тогда обрезки не было и дотягивать нечего.
     */
    function setFullItemsTruncation(key, data) {
        var items = Array.isArray(data.items) ? data.items : [];
        catalogState.fullItemsTruncated =
            typeof data.fullCount === 'number' && data.fullCount > items.length;
    }

    /**
     * Дотягивает остаток каталога, когда локальные элементы закончились.
     * Возвращает true, если fullItems пополнился.
     */
    function extendFullItems(key) {
        var cfg = window.CATALOG_CONFIG && CATALOG_CONFIG[key];
        if (!cfg || !cfg.url) return Promise.resolve(false);

        // Без take — теперь нужен весь список
        return CatalogWorker.catalogGetFresh(key, cfg.url, CATALOG_FULL_LIMIT)
            .then(function (result) {
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
            })
            .catch(function (error) {
                console.warn('⚠️ Не удалось дотянуть остаток каталога "' + key + '":', error);
                return false;
            });
    }

    function applyFullCatalogData(key, data, timestamp) {
        if (!key || !data) return;

        var items = Array.isArray(data.items) ? data.items : [];
        var pageSize = getPageSize();
        var ts = timestamp || Date.now();

        // Сохраняем meta для даты в шапке
        setCatalogIdbMeta(key, ts, data.totalItems || items.length);

        catalogState.currentCatalog = key;

        // Загруженная часть каталога держится в памяти, в DOM выводим порциями
        catalogState.fullItems = items;
        catalogState.idbTimestamp = ts;
        setFullItemsTruncation(key, data);

        // Первая страница
        catalogState.items = items.slice(0, pageSize);

        catalogState.totalItems = data.totalItems || items.length;
        catalogState.currentPage = 1;
        // hasMore true и когда локальных элементов больше, и когда воркер
        // прислал урезанную выборку — остаток дотянет loadMoreCatalogItems
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

    /**
     * Ушёл ли пользователь с первого экрана категории.
     *
     * renderCatalogGrid() очищает сетку, строит карточки заново и переводит
     * фокус на первую (catalog.js: focusFirstCatalogCard). Для первого показа
     * это норма, но фоновое обновление приходит секундами позже — и человек,
     * успевший пролистать вниз, получает мигание всей сетки и прыжок фокуса
     * в начало. В таком случае обновляем данные молча.
     */
    function hasUserMovedInGrid(key) {
        if (catalogState.currentCatalog !== key) return false;

        // Догрузил хотя бы одну дополнительную страницу
        if (catalogState.items.length > getPageSize()) return true;

        var mc = typeof getEl === 'function' ? getEl('main-container') : null;
        if (mc && mc.scrollTop > 0) return true;

        // Фокус стоит не на первой карточке
        var focused = document.querySelector('#catalog-grid .torrent-card.catalog-card.focused');
        if (focused && focused.dataset.catalogIndex &&
            parseInt(focused.dataset.catalogIndex, 10) > 0) return true;

        return false;
    }

    /**
     * Обновляет данные каталога, не трогая DOM и фокус.
     *
     * Свежий полный список уезжает в fullItems (оттуда его берёт
     * loadMoreCatalogItems), обновляются счётчики и meta для даты в шапке.
     * Уже отрисованные карточки остаются как есть: дальше по списку человек
     * доберётся до свежих элементов сам, а дубликаты отсечёт loadedItemIds.
     */
    function applyFullCatalogDataQuiet(key, data, timestamp) {
        if (!key || !data) return;

        var items = Array.isArray(data.items) ? data.items : [];
        var ts = timestamp || Date.now();
        var have = Array.isArray(catalogState.fullItems) ? catalogState.fullItems : [];

        setCatalogIdbMeta(key, ts, data.totalItems || items.length);

        catalogState.idbTimestamp = ts;
        catalogState.totalItems = data.totalItems || items.length;

        // Фоновое обновление приходит урезанным (getInitialTake), а сюда мы
        // попадаем ровно тогда, когда человек уже пролистал дальше этой
        // выборки. Укоротить fullItems значило бы оборвать ему подгрузку на
        // ровном месте, поэтому короткий список не принимаем — помечаем, что
        // полный ещё предстоит дотянуть.
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

    /** Фоновое обновление: перерисовываем только если человек ещё на первом экране */
    function applyFullCatalogUpdate(key, data, timestamp) {
        if (catalogState.currentCatalog !== key) return;

        if (hasUserMovedInGrid(key)) {
            applyFullCatalogDataQuiet(key, data, timestamp);
            return;
        }

        applyFullCatalogData(key, data, timestamp);
    }

    // Префетч прогревает IndexedDB и больше ни для чего не нужен — результат
    // вызывающая сторона выбрасывает. Поэтому:
    //   • summary: true — воркер присылает сводку, а не 8 каталогов по 1000 элементов;
    //   • один запуск за сессию — TTL записей 6 часов, а первая сборка рядов и так
    //     зовёт getFullCatalogFresh по всем каталогам через loadRowItems.
    var _prefetchPromise = null;
    var _prefetchDone = false;

    function prefetchAllFullCatalogs() {
        if (_prefetchDone) return Promise.resolve({});
        if (_prefetchPromise) return _prefetchPromise;

        var entries = getFullCatalogEntries();

        if (!entries.length) {
            return Promise.resolve({});
        }

        _prefetchPromise = CatalogWorker.catalogPrefetchAll(entries, CATALOG_FULL_LIMIT, true)
            .then(function (summary) {
                _prefetchDone = true;
                _prefetchPromise = null;
                console.log('📦 Каталоги прогреты в IndexedDB:', summary);
                return summary;
            })
            .catch(function (error) {
                console.warn('⚠️ Prefetch catalogs error:', error);
                _prefetchPromise = null;   // дать шанс следующему входу в каталог
                return {};
            });

        return _prefetchPromise;
    }

    // ==================== showCatalogList ====================

    var _origShowCatalogList = window.showCatalogList || showCatalogList;

    window.showCatalogList = showCatalogList = function () {
        // Прогреваем IndexedDB (сам вызов не чаще одного раза за сессию — см. выше).
        // Если нужно ждать полную загрузку до показа списка, замените строку ниже на:
        // return prefetchAllFullCatalogs().then(function () { return _origShowCatalogList.apply(window, args); });
        prefetchAllFullCatalogs();

        // apply, а не call: showCatalogList принимает force (пересборка рядов)
        return _origShowCatalogList.apply(window, arguments);
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
        // Список прошлой категории и его признак урезанности — чужие для новой.
        // Заполнит applyFullCatalogData; если загрузка упадёт, здесь останется
        // пусто, а не хвост предыдущего каталога.
        catalogState.fullItems = null;
        catalogState.fullItemsTruncated = false;

        AppState.mediaType = config.mediaType;

        if (typeof showCatalogLoading === 'function') {
            showCatalogLoading('Загрузка ' + config.name + '...');
        }

        try {
            fetchCatalogsWithCache().catch(function () {
                // Игнорируем ошибку — не критично
            });
            // take: на первый показ нужны две страницы, а не вся тысяча —
            // остаток дотянет loadMoreCatalogItems, если человек долистает
            var record = await CatalogWorker.catalogIdbGet(key, getInitialTake());

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
                CatalogWorker.catalogGetFresh(key, config.url, CATALOG_FULL_LIMIT, getInitialTake())
                    .then(function (freshResult) {
                        if (freshResult && freshResult.data) {
                            applyFullCatalogUpdate(key, freshResult.data, freshResult.timestamp || Date.now());
                        }
                    })
                    .catch(function (error) {
                        console.warn('⚠️ Background catalog update failed:', error);
                    });

                return;
            }

            // 2. Если кэша нет вообще — грузим из сети и сохраняем в IndexedDB
            var freshResult = await CatalogWorker.catalogGetFresh(key, config.url, CATALOG_FULL_LIMIT, getInitialTake());

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

        if (!catalogState.currentCatalog || catalogState.isLoadingMore) {
            return Promise.resolve(false);
        }

        // Если полного каталога в памяти нет — подгружать локально нечего
        if (!catalogState.fullItems || !catalogState.hasMore) {
            return Promise.resolve(false);
        }

        catalogState.isLoadingMore = true;

        var key = catalogState.currentCatalog;

        // Локальные элементы кончились, но выборка была урезана (getInitialTake) —
        // сначала дотягиваем остаток каталога, потом режем страницу как обычно.
        var ready = (catalogState.items.length >= catalogState.fullItems.length &&
            catalogState.fullItemsTruncated)
            ? extendFullItems(key)
            : Promise.resolve(false);

        return ready.then(function () {
            if (catalogState.currentCatalog !== key) {
                catalogState.isLoadingMore = false;
                return false;
            }

            var pageSize = getPageSize();

            // Берём следующую порцию из уже загруженного полного каталога
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
            // take: LIMIT — воркер обрежет выборку до postMessage, чтобы не пересылать
            // 1000 элементов ради 10. slice ниже оставлен: устаревший закэшированный
            // воркер про take не знает и вернёт весь каталог.
            var result = await CatalogWorker.catalogGetFresh(key, cfg.url, CATALOG_FULL_LIMIT, LIMIT);

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

    /**
     * Защита от цикла обновления каталога.
     *
     * Цепочка замкнута сама на себя: renderCatalogGrid → addCatalogHeader →
     * fetchCatalogsWithCache → checkAndUpdateCatalogIfNeeded → POST /update →
     * invalidateCatalogsListCache + перекачка каталога → applyFullCatalogData →
     * renderCatalogGrid. Раньше единственным тормозом был пятиминутный таймаут,
     * то есть при сервере, который принимает /update, но не двигает
     * lastModifiedISO, всё это крутилось вечно с периодом 5 минут: POST,
     * перекачка тысячи элементов и перерисовка сетки под пользователем.
     *
     * Теперь два дополнительных стопа:
     *   • дата не сдвинулась после успешного обновления — до конца сессии больше
     *     не пробуем (giveUp): сервер сказал «обновил», но обновлять нечего;
     *   • не больше MAX_UPDATE_ATTEMPTS попыток на каталог за сессию — на случай
     *     источника, который каждый раз отдаёт новую, но всё ещё старую дату.
     *
     * id -> { at, iso, done, attempts, giveUp }
     */
    var _catalogServerUpdateAttempts = {};
    var UPDATE_RETRY_MS = 5 * 60 * 1000;
    var MAX_UPDATE_ATTEMPTS = 2;

    window.checkAndUpdateCatalogIfNeeded = checkAndUpdateCatalogIfNeeded = async function (id, iso) {
        if (!id || !iso || _catalogIdbUpdating) {
            return false;
        }

        var thresholdHours =
            window.CATALOG_CONSTANTS && CATALOG_CONSTANTS.CATALOG_UPDATE_THRESHOLD_HOURS
                ? CATALOG_CONSTANTS.CATALOG_UPDATE_THRESHOLD_HOURS
                : 6;

        var serverTime = new Date(iso).getTime();

        if (isNaN(serverTime)) {
            return false;
        }

        var hours = (Date.now() - serverTime) / 3600000;

        // Если серверная дата свежая — ничего не делаем
        if (hours <= thresholdHours) {
            return false;
        }

        var now = Date.now();
        var attempt = _catalogServerUpdateAttempts[id];

        if (attempt) {
            // Сдались на этом каталоге до конца сессии
            if (attempt.giveUp) {
                return false;
            }

            // Прошлый POST отработал успешно, а сервер отдаёт ТУ ЖЕ дату —
            // обновлять нечего, дальше был бы бесконечный круг
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

            // 1. Серверное обновление каталога
            var updateResponse = await safeFetch(
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

            // Помечаем попытку как отработавшую: если следующий проход придёт с
            // той же lastModifiedISO, значит обновление ничего не изменило —
            // и цикл остановится на проверке в начале функции.
            attempt.done = true;

            // 2. Инвалидируем кэш /api/catalogs,
            // чтобы при следующем рендере получить свежую lastModifiedISO
            if (typeof invalidateCatalogsListCache === 'function') {
                invalidateCatalogsListCache();
            }

            // 3. Удаляем старый полный каталог из IndexedDB
            if (window.CatalogWorker && CatalogWorker.catalogIdbDelete) {
                await CatalogWorker.catalogIdbDelete(id);
            }

            // 4. Заново загружаем полный каталог в IndexedDB
            var cfg = window.CATALOG_CONFIG && CATALOG_CONFIG[id];

            if (cfg && cfg.url) {
                var freshResult = await CatalogWorker.catalogGetFresh(
                    id,
                    cfg.url,
                    typeof CATALOG_FULL_LIMIT !== 'undefined' ? CATALOG_FULL_LIMIT : 1000
                );

                // 5. Если пользователь сейчас находится в этом каталоге — обновляем данные.
                // Экран перерисовываем только пока он на первом экране: обновление
                // приходит через POST + перекачку каталога, к этому моменту человек
                // мог уйти вниз, и перерисовка сбросила бы ему фокус в начало.
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

        // Базовая структура заголовка
        header.innerHTML =
            '<div style="display:flex;flex-direction:column;gap:5px">' +
            '<span style="font-size:20px;font-weight:600;color:#4a9eff">' + name + '</span>' +
            '<div class="catalog-meta-info" style="display:flex;gap:15px;font-size:12px;color:#aaa;flex-wrap:wrap">' +
            '<span>' + catalogState.items.length + ' / ' + (catalogState.totalItems || catalogState.items.length) + '</span>' +
            '<span class="catalog-update-date">Загрузка даты...</span>' +
            '</div>' +
            '</div>' +
            '<span style="font-size:14px;color:#aaa;background:rgba(0,0,0,0.3);padding:5px 12px;border-radius:20px">' +
            getPageSize() + ' на страницу' +
            '</span>';

        grid.appendChild(header);

        // Запрашиваем список каталогов с кэшированием
        fetchCatalogsWithCache()
            .then(function (catalogs) {
                if (!header.isConnected) return;

                var catalogInfo = null;

                for (var i = 0; i < catalogs.length; i++) {
                    if (catalogs[i].id === catalogState.currentCatalog) {
                        catalogInfo = catalogs[i];
                        break;
                    }
                }

                var dateElement = header.querySelector('.catalog-update-date');

                if (!dateElement) return;

                if (catalogInfo && catalogInfo.lastModifiedISO) {
                    // Проверяем, нужно ли обновить каталог
                    if (typeof checkAndUpdateCatalogIfNeeded === 'function') {
                        checkAndUpdateCatalogIfNeeded(catalogInfo.id, catalogInfo.lastModifiedISO);
                    }

                    // Форматируем серверную дату
                    var dateText =
                        typeof formatLastModifiedDate === 'function'
                            ? formatLastModifiedDate(catalogInfo.lastModifiedISO)
                            : new Date(catalogInfo.lastModifiedISO).toLocaleString();

                    dateElement.textContent = 'Обновлено: ' + dateText;
                } else {
                    // Fallback на локальный timestamp из IndexedDB
                    var meta = getCatalogIdbMeta(catalogState.currentCatalog);
                    var ts = (meta && meta.timestamp) || catalogState.idbTimestamp || null;

                    if (ts) {
                        var dateText =
                            typeof formatLastModifiedDate === 'function'
                                ? formatLastModifiedDate(new Date(ts).toISOString())
                                : new Date(ts).toLocaleString();

                        dateElement.textContent = 'Обновлено: ' + dateText;
                    } else {
                        dateElement.textContent = '';
                    }
                }
            })
            .catch(function (error) {
                console.warn('⚠️ Failed to load catalogs list:', error);
            });

        return header;
    };

    console.log('✅ Catalog IndexedDB patch applied: limit=' + CATALOG_FULL_LIMIT + ', ttl=6h');
})();
