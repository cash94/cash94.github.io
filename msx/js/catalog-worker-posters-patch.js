// catalog-worker-posters-patch.js
// Переводит получение URL постеров в CatalogWorker
(function () {
    'use strict';

    if (!window.CatalogWorker) {
        console.warn('❌ CatalogWorker недоступен, poster-patch пропущен');
        return;
    }

    if (!window.CATALOG_CONSTANTS || !CATALOG_CONSTANTS.IMG_SIZES) {
        console.warn('❌ CATALOG_CONSTANTS недоступны, poster-patch пропущен');
        return;
    }

    if (!CATALOG_CONSTANTS.IMG_SIZES.POSTER_CARD) {
        CATALOG_CONSTANTS.IMG_SIZES.POSTER_CARD =
            CATALOG_CONSTANTS.IMG_SIZES.POSTER_SMALL || 'w185';
    }

    var _origLoadCatalogPoster = window.loadCatalogPoster;
    var _origLoadRowPoster = window.loadRowPoster;

    if (typeof _origLoadCatalogPoster !== 'function') {
        console.warn('❌ loadCatalogPoster не найден, poster-patch пропущен');
        return;
    }

    if (typeof _origLoadRowPoster !== 'function') {
        console.warn('❌ loadRowPoster не найден, poster-patch пропущен');
        return;
    }

    function getPosterCardSize() {
        return (
            CATALOG_CONSTANTS.IMG_SIZES.POSTER_CARD ||
            CATALOG_CONSTANTS.IMG_SIZES.POSTER_SMALL ||
            'w185'
        );
    }

    function getProtocolBase() {
        var p = (window.AppState && AppState.protocol) || 'https:';

        p = String(p).replace(/\/+$/, '');

        if (p.indexOf(':') === -1) {
            p += ':';
        }

        return p;
    }

    function buildLocalPosterUrl(path, size) {
        if (!path) return '';

        if (path.indexOf('http') === 0) {
            return path;
        }

        var finalPath = path.charAt(0) === '/' ? path : '/' + path;

        return getProtocolBase() +
            '//tsimg.hnar.online/t/p/' +
            size +
            finalPath;
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

    async function fetchPosterUrlViaWorker(id, mt, title) {
        var validId = !!(id && id !== 'undefined' && id !== 'null');

        if (!window.CatalogWorker) {
            return {
                ok: false,
                url: null
            };
        }

        if (!validId && !title) {
            return {
                ok: false,
                url: null
            };
        }

        try {
            var res = await CatalogWorker.fetchPosterUrl(
                validId ? id : null,
                mt || 'movie',
                title || '',
                getProtocolBase(),
                getPosterCardSize()
            );

            var url = null;

            if (res && res.posterUrl) {
                url = normalizePosterUrl(res.posterUrl);
            }

            return {
                ok: true,
                url: url
            };
        } catch (e) {
            console.warn('⚠️ Ошибка Worker-загрузки постера, fallback:', e);

            return {
                ok: false,
                url: null
            };
        }
    }

    // ==================== PATCH: loadCatalogPoster ====================

    var patchedLoadCatalogPoster = async function (card, title, mt, id, index) {
        var div = card && card.querySelector('.torrent-poster');
        if (!div) return;
        if (!catalogState.currentCatalog) {
            div.innerHTML = '<div class="no-poster">Каталог закрыт</div>';
            return;
        }

        var key = id + '_' + mt;

        // 1. In-memory кэш (мгновенно)
        var cached = catalogState.posterCache.get(key);
        if (cached) {
            updatePosterDOM(div, card.dataset.rating, cached);
            return;
        }

        var item = catalogState.items[index];
        var directPath = (item && item.poster_path) || null;
        if (directPath) {
            var directUrl = normalizePosterUrl(
                buildLocalPosterUrl(directPath, getPosterCardSize())
            );
            catalogState.posterCache.set(key, directUrl);
            updatePosterDOM(div, card.dataset.rating, directUrl);
            return;
        }

        // 2. Локальный TMDB-кэш
        var tmdbParams = { id: id, type: mt };
        var localTmdbCached = getFromTmdbCache('poster', tmdbParams);
        if (localTmdbCached && localTmdbCached.posterUrl) {
            var localUrl = normalizePosterUrl(localTmdbCached.posterUrl);
            catalogState.posterCache.set(key, localUrl);
            updatePosterDOM(div, card.dataset.rating, localUrl);
            return;
        }

        // 3. ★ IndexedDB + Worker параллельно
        var resolved = false;

        function applyUrl(url) {
            if (resolved || !url) return;
            if (!div.isConnected) return;
            resolved = true;
            catalogState.posterCache.set(key, url);
            saveToTmdbCache('poster', tmdbParams, { posterUrl: url });
            updatePosterDOM(div, card.dataset.rating, url);
        }

        // IndexedDB — быстрый локальный запрос
        if (window.PosterDB) {
            PosterDB.get(key).then(function (dbUrl) {
                if (dbUrl) applyUrl(dbUrl);
            });
        }

        // Worker — сетевой запрос (если в IndexedDB не нашли)
        fetchPosterUrlViaWorker(id, mt, title).then(function (workerResult) {
            if (workerResult.ok && workerResult.url) {
                applyUrl(workerResult.url);
                // ★ Сохраняем в IndexedDB на будущее
                if (window.PosterDB) {
                    PosterDB.set(key, workerResult.url);
                }
            } else if (!resolved) {
                resolved = true;
                updatePosterDOM(div, card.dataset.rating, '');
            }
        });
    };

    window.loadCatalogPoster = patchedLoadCatalogPoster;

    try {
        if (typeof loadCatalogPoster !== 'undefined') {
            loadCatalogPoster = patchedLoadCatalogPoster;
        }
    } catch (e) {
        // ignore
    }

    // ==================== PATCH: loadRowPoster ====================
    var patchedLoadRowPoster = async function (card, item) {
        var imgBox = card && card.querySelector('.row-poster-img');
        if (!imgBox || !item) return;

        var id = item.id;
        var mt = item.media_type || 'movie';
        var key = id + '_' + mt;

        // 1. Уже есть готовый URL в локальном LRU-кэше постеров
        var cached = catalogState.posterCache.get(key);
        if (cached) {
            await setRowPosterImg(imgBox, cached);
            return;
        }

        // 2. poster_path уже есть в элементе каталога — Worker не нужен
        if (item.poster_path) {
            var directUrl = normalizePosterUrl(
                buildLocalPosterUrl(item.poster_path, getPosterCardSize())
            );
            catalogState.posterCache.set(key, directUrl);
            if (card.isConnected) {
                await setRowPosterImg(imgBox, directUrl);
            }
            return;
        }

        // 3. Проверяем основной TMDB-кэш
        var tmdbParams = { id: id, type: mt };
        var localTmdbCached = getFromTmdbCache('poster', tmdbParams);
        if (localTmdbCached && localTmdbCached.posterUrl) {
            var localUrl = normalizePosterUrl(localTmdbCached.posterUrl);
            catalogState.posterCache.set(key, localUrl);
            if (card.isConnected) {
                await setRowPosterImg(imgBox, localUrl);
            }
            return;
        }

        // 4. ★ Опционально: проверяем IndexedDB (если внедрён PosterDB)
        if (window.PosterDB) {
            try {
                var dbUrl = await PosterDB.get(key);
                if (dbUrl) {
                    var normalizedDbUrl = normalizePosterUrl(dbUrl);
                    catalogState.posterCache.set(key, normalizedDbUrl);
                    if (card.isConnected) {
                        await setRowPosterImg(imgBox, normalizedDbUrl);
                    }
                    return;
                }
            } catch (e) {
                // IndexedDB недоступен — продолжаем как обычно
            }
        }

        // 5. Запрашиваем URL постера через Worker
        var workerResult = await fetchPosterUrlViaWorker(
            id,
            mt,
            getCatalogItemTitle(item)
        );

        if (workerResult.ok) {
            if (workerResult.url) {
                var finalUrl = normalizePosterUrl(workerResult.url);

                // Сохраняем во все уровни кэша
                saveToTmdbCache('poster', tmdbParams, { posterUrl: finalUrl });
                catalogState.posterCache.set(key, finalUrl);

                // ★ Опционально: сохраняем в IndexedDB
                if (window.PosterDB) {
                    PosterDB.set(key, finalUrl).catch(function () { });
                }

                if (card.isConnected) {
                    await setRowPosterImg(imgBox, finalUrl);
                }
            } else {
                // Worker ответил, но постер не найден
                if (card.isConnected) {
                    imgBox.innerHTML = '<div class="no-poster">Нет постера</div>';
                }
            }
            return;
        }

        // 6. Fallback на старую логику, если Worker недоступен/упал
        return _origLoadRowPoster.call(window, card, item);
    };

    window.loadRowPoster = patchedLoadRowPoster;
    try {
        if (typeof loadRowPoster !== 'undefined') {
            loadRowPoster = patchedLoadRowPoster;
        }
    } catch (e) {
        // ignore
    }

    window.loadRowPoster = patchedLoadRowPoster;

    try {
        if (typeof loadRowPoster !== 'undefined') {
            loadRowPoster = patchedLoadRowPoster;
        }
    } catch (e) {
        // ignore
    }

    console.log('✅ Poster fetching patched through CatalogWorker');
})();
