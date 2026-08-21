// =====================================================
// ИСПРАВЛЕНИЯ УТЕЧЕК ПАМЯТИ В CATALOG.JS
// Специфичные патчи для модуля каталога
// =====================================================

(function() {
    'use strict';

    console.log('🧹 Загрузка патчей памяти для catalog.js...');

    // ==================== 1. ОПТИМИЗАЦИЯ POSTER LOADING ====================

    // Здесь был патч window.loadPosterBatch, ограничивавший число одновременных
    // загрузок постеров. Удалён: он повторял catalog.js:1407 один в один, а лимит
    // получался тот же самый — Math.min(8, MAX_POSTER_DECODES) === MAX_POSTER_DECODES === 8.
    // Единственным его эффектом были три лишних кадра стека на каждый постер.
    // Ограничение живёт в самом catalog.js (CATALOG_CONSTANTS.MAX_POSTER_DECODES) —
    // менять его надо там, а не переопределением функции.

    // ==================== 2. CLEANUP DETACHED DOM NODES ====================

    function cleanupDetachedPosterImages() {
        if (typeof catalogState === 'undefined') return;

        var cleaned = 0;
        var cards = document.querySelectorAll('.catalog-card');

        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            if (!card.isConnected) {
                // Удаляем ссылки на изображения из отключенных карточек
                var img = card.querySelector('img');
                if (img) {
                    img.src = '';
                    img.remove();
                    cleaned++;
                }
            }
        }

        if (cleaned > 0) {
            console.log('🧹 Очищено ' + cleaned + ' отключенных изображений');
        }
    }

    // ==================== 3. OBSERVER CLEANUP ====================

    var originalInitPosterUnloading = window.initPosterUnloading;
    if (originalInitPosterUnloading) {
        window.initPosterUnloading = function() {
            // Отключаем старый observer перед созданием нового
            if (typeof catalogState !== 'undefined' && catalogState.unloadObserver) {
                try {
                    catalogState.unloadObserver.disconnect();
                    delete catalogState.unloadObserver;
                } catch(e) {}
            }

            originalInitPosterUnloading();
        };
    }

    var originalInitPosterLazyLoading = window.initPosterLazyLoading;
    if (originalInitPosterLazyLoading) {
        window.initPosterLazyLoading = function() {
            // Отключаем старый observer
            if (typeof catalogState !== 'undefined' && catalogState.posterObserver) {
                try {
                    catalogState.posterObserver.disconnect();
                    delete catalogState.posterObserver;
                } catch(e) {}
            }

            originalInitPosterLazyLoading();
        };
    }

    var originalInitRowPosterLazyLoading = window.initRowPosterLazyLoading;
    if (originalInitRowPosterLazyLoading) {
        window.initRowPosterLazyLoading = function() {
            // Отключаем старый observer
            if (typeof catalogState !== 'undefined' && catalogState.rowPosterObserver) {
                try {
                    catalogState.rowPosterObserver.disconnect();
                    delete catalogState.rowPosterObserver;
                } catch(e) {}
            }

            originalInitRowPosterLazyLoading();
        };
    }

    // ==================== 4. CLEANUP TRAILER CACHE ====================

    var TRAILER_CACHE_LIMIT = 20;

    function cleanupTrailerCache() {
        if (typeof rutubeTrailerCache === 'undefined') return;

        var keys = Object.keys(rutubeTrailerCache);
        if (keys.length > TRAILER_CACHE_LIMIT) {
            console.log('🧹 Очистка rutubeTrailerCache: ' + keys.length + ' элементов');

            // Удаляем половину старых записей
            var toRemove = Math.floor(keys.length / 2);
            for (var i = 0; i < toRemove; i++) {
                delete rutubeTrailerCache[keys[i]];
            }
        }
    }

    // ==================== 5. DELEGATION CLEANUP ====================

    var originalSetupDetailDelegation = window.setupDetailDelegation;
    if (originalSetupDetailDelegation) {
        window.setupDetailDelegation = function(dv) {
            // Удаляем старый обработчик перед добавлением нового
            if (dv && dv._detailClickHandler) {
                dv.removeEventListener('click', dv._detailClickHandler);
                delete dv._detailClickHandler;
            }

            originalSetupDetailDelegation(dv);
        };
    }

    // ==================== 6. TMDB CACHE CLEANUP ====================

    if (typeof tmdbCache !== 'undefined' && tmdbCache.cleanExpired) {
        // Очистка каждые 5 минут
        setInterval(function() {
            try {
                tmdbCache.cleanExpired();
                console.log('🧹 TMDB кэш очищен от устаревших записей');
            } catch(e) {
                console.warn('Ошибка очистки TMDB кэша:', e);
            }
        }, 300000);
    }

    // ==================== 7. CATALOG STATE CLEANUP ====================

    function cleanupCatalogState() {
        if (typeof catalogState === 'undefined' || typeof AppState === 'undefined') return;

        // 'detail' — это оверлей ПОВЕРХ живой сетки каталога. Пользователь вернётся
        // кнопкой «Назад», а возврат сетку не перерисовывает (app.js: «если каталог
        // уже загружен и сетка в DOM — НЕ перерендериваем»), значит отключённые здесь
        // наблюдатели сами уже не поднимутся и постеры грузиться перестанут.
        if (AppState.currentScreen === 'catalog' || AppState.currentScreen === 'detail') return;

        // Отключаем observers
        if (catalogState.posterObserver) {
            catalogState.posterObserver.disconnect();
        }
        if (catalogState.unloadObserver) {
            catalogState.unloadObserver.disconnect();
        }
        if (catalogState.rowPosterObserver) {
            catalogState.rowPosterObserver.disconnect();
        }
        if (catalogState.loadMoreObserver) {
            catalogState.loadMoreObserver.disconnect();
        }

        // Очищаем очереди
        catalogState.posterLoadQueue = [];
        catalogState.rowPosterQueue = [];

        // disconnect() не обнуляет ссылку — объект остаётся truthy, поэтому
        // ни initPosterLazyLoading(), ни updatePosterObservers() не вызовутся сами.
        window._catalogObserversDisarmed = true;

        console.log('🧹 Catalog state очищен (экран изменён)');
    }

    // ==================== 7b. ВОССТАНОВЛЕНИЕ НАБЛЮДАТЕЛЕЙ ====================

    /**
     * Поднимает IntersectionObserver'ы каталога после периодической чистки.
     * Вызывается при возврате на экран каталога (app.js), при показе страницы
     * и как страховка на периодическом тике. Ничего не делает, если чистки не было.
     */
    function rearmCatalogObservers() {
        if (typeof catalogState === 'undefined' || typeof AppState === 'undefined') return;
        if (!window._catalogObserversDisarmed) return;
        if (AppState.currentScreen !== 'catalog') return;
        window._catalogObserversDisarmed = false;

        // Режим рядов
        if (typeof isCatalogRowsMode === 'function' && isCatalogRowsMode()) {
            // Очередь рядов была очищена, но у карточек остался posterLoaded='1',
            // а initRowPosterLazyLoading такие карточки не наблюдает (catalog.js:2900) —
            // сбрасываем флаг у тех, где картинка так и не появилась.
            var rows = document.querySelectorAll('#catalog-rows .catalog-row-card');
            for (var r = 0; r < rows.length; r++) {
                var box = rows[r].querySelector('.row-poster-img');
                if (box && !box.querySelector('img')) rows[r].dataset.posterLoaded = '0';
            }
            if (typeof window.initRowPosterLazyLoading === 'function') window.initRowPosterLazyLoading();
            console.log('♻️ Наблюдатели рядов каталога восстановлены (' + rows.length + ' карточек)');
            return;
        }

        // Сетка: то же самое с флагом posterRequested (catalog.js:1374)
        var cards = document.querySelectorAll('#catalog-grid .torrent-card.catalog-card');
        for (var i = 0; i < cards.length; i++) {
            if (!cards[i].querySelector('img.catalog-poster-img')) cards[i].dataset.posterRequested = '0';
        }
        if (typeof window.initPosterLazyLoading === 'function') window.initPosterLazyLoading();
        if (typeof window.initLoadMoreObserver === 'function') window.initLoadMoreObserver();
        console.log('♻️ Наблюдатели каталога восстановлены (' + cards.length + ' карточек)');
    }

    window.rearmCatalogObservers = rearmCatalogObservers;

    // ==================== 8. PERIODIC CLEANUP ====================

    setInterval(function() {
        cleanupDetachedPosterImages();
        cleanupTrailerCache();
        cleanupCatalogState();
        rearmCatalogObservers();   // страховка: вернулись в каталог мимо app.js
    }, 120000); // каждые 2 минуты

    // ==================== 9. CLEANUP ON VISIBILITY CHANGE ====================

    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
            rearmCatalogObservers();
            return;
        }
        console.log('🧹 Страница скрыта, выполнение очистки...');
        cleanupCatalogState();

        // Принудительная очистка неиспользуемых изображений
        if (typeof catalogState !== 'undefined' && catalogState.posterCache) {
            // Оставляем только последние 50 постеров
            if (catalogState.posterCache.size && catalogState.posterCache.size() > 50) {
                console.log('🧹 Сокращение posterCache с ' + catalogState.posterCache.size() + ' до 50');
                catalogState.posterCache.trimToMax && catalogState.posterCache.trimToMax();
            }
        }
    });

    // ==================== 10. PATCH BACKDROP LOADING ====================

    var original_loadBackdropDecoded = window._loadBackdropDecoded;
    if (original_loadBackdropDecoded) {
        window._loadBackdropDecoded = function(container, url) {
            if (!container || !container.isConnected) {
                // Не загружаем backdrop для отключенных элементов
                return;
            }

            var img = new Image();
            img.src = url;

            var apply = function() {
                // Проверяем, что элемент всё ещё в DOM
                if (!container.isConnected) {
                    img.src = ''; // Освобождаем память
                    return;
                }
                container.style.backgroundImage = 'url(' + url + ')';
                container.classList.remove('hidden');
            };

            if (typeof img.decode === 'function') {
                img.decode().then(apply).catch(function() {
                    img.src = '';
                });
            } else {
                img.onload = apply;
                img.onerror = function() {
                    img.src = '';
                };
            }
        };
    }

    // ==================== 11. PATCH IMAGE LOADING ====================

    var original_loadImageDecoded = window._loadImageDecoded;
    if (original_loadImageDecoded) {
        window._loadImageDecoded = function(container, src, alt) {
            if (!container || !container.isConnected) {
                return;
            }

            var img = new Image();
            img.alt = alt || '';
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.3s ease';

            var cleanup = function() {
                img.src = '';
                img.onload = null;
                img.onerror = null;
            };

            var insert = function() {
                if (!container.isConnected) {
                    cleanup();
                    return;
                }
                container.innerHTML = '';
                img.style.opacity = '1';
                container.appendChild(img);
            };

            img.onerror = function() {
                if (container.isConnected) {
                    container.innerHTML = '<div class="no-poster">Нет постера</div>';
                }
                cleanup();
            };

            img.src = src;

            if (typeof img.decode === 'function') {
                img.decode().then(insert).catch(function() {
                    insert();
                    cleanup();
                });
            } else {
                img.onload = insert;
            }
        };
    }

    console.log('✅ Патчи памяти для catalog.js загружены');

})();
