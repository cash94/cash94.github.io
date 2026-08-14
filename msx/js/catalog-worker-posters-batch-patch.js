// catalog-worker-posters-batch-patch.js
// Пакетная загрузка постеров: один запрос Worker'а на партию вместо N одиночных.
// Подключать ПОСЛЕ catalog-worker-posters-patch.js
(function () {
    'use strict';

    if (!window.CatalogWorker || typeof CatalogWorker.fetchPosterUrlsBatch !== 'function') {
        console.warn('❌ batch-poster-patch пропущен: bridge без поддержки батча');
        return;
    }
    if (!window.CATALOG_CONSTANTS || !window.catalogState) {
        console.warn('❌ batch-poster-patch пропущен: catalog.js не загружен');
        return;
    }
    var _origLoadPosterBatch = window.loadPosterBatch;
    var _singleLoadCatalogPoster = window.loadCatalogPoster; // одиночная версия (fallback промахов)
    var _singleLoadRowPoster = window.loadRowPoster;
    if (typeof _origLoadPosterBatch !== 'function') {
        console.warn('❌ batch-poster-patch пропущен: loadPosterBatch не найден');
        return;
    }

    // ---------- хелперы (те же, что в posters-patch) ----------
    function getPosterCardSize() {
        return CATALOG_CONSTANTS.IMG_SIZES.POSTER_CARD ||
            CATALOG_CONSTANTS.IMG_SIZES.POSTER_SMALL || 'w185';
    }
    function getProtocolBase() {
        var p = (window.AppState && AppState.protocol) || 'https:';
        p = String(p).replace(/\/+$/, '');
        if (p.indexOf(':') === -1) p += ':';
        return p;
    }
    function buildLocalPosterUrl(path, size) {
        if (!path) return '';
        if (path.indexOf('http') === 0) return path;
        var fp = path.charAt(0) === '/' ? path : '/' + path;
        return getProtocolBase() + '//tsimg.hnar.online/t/p/' + size + fp;
    }
    function normalizePosterUrl(url) {
        if (!url) return '';
        if (url.indexOf('http') !== 0) return url;
        var size = getPosterCardSize();
        var protocol = getProtocolBase();
        if (url.indexOf('tsimg.hnar.online/t/p/') !== -1) {
            url = url.replace(/^https?:/, protocol);
            url = url.replace(/\/t\/p\/[^/]+\//, '/t/p/' + size + '/');
        }
        return url;
    }

    var SINGLES_CONCURRENCY = 3;

    // Ограниченный параллелизм для точечных догрузок
    function runWithConcurrency(list, workerFn) {
        if (!list.length) return Promise.resolve();
        var idx = 0;
        var runners = [];
        var n = Math.min(SINGLES_CONCURRENCY, list.length);
        for (var i = 0; i < n; i++) {
            runners.push((function () {
                function step() {
                    if (idx >= list.length) return Promise.resolve();
                    var entry = list[idx++];
                    return Promise.resolve()
                        .then(function () { return workerFn(entry); })
                        .catch(function () { })
                        .then(step);
                }
                return step();
            })());
        }
        return Promise.all(runners).then(function () { });
    }

    // ---------- ядро батча ----------
    /**
     * entries: [{ key, id, mt, title, item, ... }]
     * Возвращает Promise<{ resolved: {key: url}, missed: [entry] }>
     */
    function resolvePosterUrls(entries) {
        var resolved = {};
        var miss = [];
        var singles = [];

        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            // 1. memory LRU
            var cached = catalogState.posterCache.get(e.key);
            if (cached) { resolved[e.key] = cached; continue; }
            // 2. poster_path прямо в элементе (история, сервер с poster_path)
            if (e.item && e.item.poster_path) {
                var direct = normalizePosterUrl(buildLocalPosterUrl(e.item.poster_path, getPosterCardSize()));
                catalogState.posterCache.set(e.key, direct);
                resolved[e.key] = direct;
                continue;
            }
            // 3. локальный TMDB-кэш
            var t = (typeof getFromTmdbCache === 'function')
                ? getFromTmdbCache('poster', { id: e.id, type: e.mt })
                : null;
            if (t && t.posterUrl) {
                var tu = normalizePosterUrl(t.posterUrl);
                catalogState.posterCache.set(e.key, tu);
                resolved[e.key] = tu;
                continue;
            }
            // 4. нет id — только поиск по названию (индивидуально)
            if (!(e.id && e.id !== 'undefined' && e.id !== 'null')) {
                singles.push(e);
                continue;
            }
            miss.push(e);
        }

        if (!miss.length) return Promise.resolve({ resolved: resolved, missed: singles });

        var payloadItems = [];
        for (var m = 0; m < miss.length; m++) {
            payloadItems.push({ id: miss[m].id, mt: miss[m].mt, title: miss[m].title });
        }

        return CatalogWorker.fetchPosterUrlsBatch(payloadItems, getProtocolBase(), getPosterCardSize())
            .then(function (map) {
                map = map || {};
                for (var j = 0; j < miss.length; j++) {
                    var e2 = miss[j];
                    var r = map[e2.key];
                    if (r && r.posterUrl) {
                        catalogState.posterCache.set(e2.key, r.posterUrl);
                        if (typeof saveToTmdbCache === 'function') {
                            saveToTmdbCache('poster', { id: e2.id, type: e2.mt }, { posterUrl: r.posterUrl });
                        }
                        if (window.PosterDB && PosterDB.set) {
                            try { PosterDB.set(e2.key, r.posterUrl); } catch (err) { }
                        }
                        resolved[e2.key] = r.posterUrl;
                    } else {
                        singles.push(e2); // не найден → точечный поиск по названию
                    }
                }
                return { resolved: resolved, missed: singles };
            })
            .catch(function (err) {
                console.warn('⚠️ Батч-запрос постеров не удался, всё поодиночке:', err);
                return { resolved: resolved, missed: miss.concat(singles) };
            });
    }

    // ---------- PATCH: сетка каталога (loadPosterBatch) ----------
    function patchedLoadPosterBatch(indices) {
        if (!indices || indices.length === 0) return;
        catalogState.isPosterLoading = true;

        var entries = [];
        for (var i = 0; i < indices.length; i++) {
            var index = indices[i];
            var item = catalogState.items[index];
            var card = catalogState.cardElements[index];
            if (!item || !card) continue;
            var div = card.querySelector('.torrent-poster');
            if (!div) continue;
            var mt = item.media_type || 'movie';
            entries.push({
                index: index,
                id: item.id,
                mt: mt,
                key: item.id + '_' + mt,
                title: getCatalogItemTitle(item),
                item: item,
                card: card,
                div: div
            });
        }

        function finish() {
            catalogState.isPosterLoading = false;
            if (catalogState.posterLoadQueue.length > 0) {
                setTimeout(loadNextPosterBatch, 10);
            }
        }

        if (!entries.length) { finish(); return; }

        resolvePosterUrls(entries).then(function (out) {
            // Применяем найденное
            for (var i = 0; i < entries.length; i++) {
                var e = entries[i];
                var url = out.resolved[e.key];
                if (url) updatePosterDOM(e.div, e.card.dataset.rating, url);
            }
            // Промахи — поодиночке (PosterDB → Worker → поиск по названию)
            return runWithConcurrency(out.missed, function (e2) {
                if (!e2.card.isConnected) return null;
                return _singleLoadCatalogPoster(e2.card, e2.title, e2.mt, e2.id, e2.index);
            });
        }).catch(function (err) {
            console.warn('patchedLoadPosterBatch error:', err);
            return runWithConcurrency(entries, function (e3) {
                if (!e3.card.isConnected) return null;
                return _singleLoadCatalogPoster(e3.card, e3.title, e3.mt, e3.id, e3.index);
            });
        }).then(finish);
    }

    // ---------- PATCH: ряды главной (processRowPosterQueue) ----------
    function patchedProcessRowPosterQueue() {
        if (!catalogState.rowPosterQueue || catalogState.rowPosterQueue.length === 0) return;
        if (catalogState._rowBatchActive) return;

        var tasks = catalogState.rowPosterQueue.splice(0, 60);
        var alive = [];
        for (var i = 0; i < tasks.length; i++) {
            if (tasks[i].card && tasks[i].card.isConnected) alive.push(tasks[i]);
        }
        if (!alive.length) return;

        catalogState._rowBatchActive = true;

        var entries = [];
        for (var j = 0; j < alive.length; j++) {
            var t = alive[j];
            var mt = t.item.media_type || 'movie';
            entries.push({
                id: t.item.id,
                mt: mt,
                key: t.item.id + '_' + mt,
                title: getCatalogItemTitle(t.item),
                item: t.item,
                task: t
            });
        }

        resolvePosterUrls(entries).then(function (out) {
            for (var k = 0; k < entries.length; k++) {
                var e = entries[k];
                var url = out.resolved[e.key];
                if (url && e.task.card.isConnected) {
                    var box = e.task.card.querySelector('.row-poster-img');
                    if (box) setRowPosterImg(box, url);
                }
            }
            return runWithConcurrency(out.missed, function (e2) {
                if (!e2.task.card.isConnected) return null;
                return _singleLoadRowPoster(e2.task.card, e2.task.item);
            });
        }).catch(function (err) {
            console.warn('row batch error:', err);
        }).then(function () {
            catalogState._rowBatchActive = false;
            if (catalogState.rowPosterQueue.length > 0) {
                setTimeout(patchedProcessRowPosterQueue, 10);
            }
        });
    }

    // ---------- применяем ----------
    window.loadPosterBatch = patchedLoadPosterBatch;
    try { if (typeof loadPosterBatch !== 'undefined') loadPosterBatch = patchedLoadPosterBatch; } catch (e) { }

    window.processRowPosterQueue = patchedProcessRowPosterQueue;
    try { if (typeof processRowPosterQueue !== 'undefined') processRowPosterQueue = patchedProcessRowPosterQueue; } catch (e) { }

    // Батчи дешёвые — увеличиваем порции и зону предзагрузки
    CATALOG_CONSTANTS.POSTER_BATCH_SIZE = 40;
    catalogState.postersPerBatch = 40;
    CATALOG_CONSTANTS.POSTER_OBSERVER_MARGIN_PX = 800;

    console.log('✅ Batch poster loading enabled');
})();