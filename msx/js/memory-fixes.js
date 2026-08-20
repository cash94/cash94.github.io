// =====================================================
// ИСПРАВЛЕНИЯ УТЕЧЕК ПАМЯТИ
// Применять после загрузки основных модулей
// =====================================================

(function() {
    'use strict';

    console.log('🧹 Загрузка патчей для утечек памяти...');

    // ==================== 1. УПРАВЛЕНИЕ EVENT LISTENERS ====================

    // Глобальное хранилище для обработчиков событий
    window._eventListenersRegistry = window._eventListenersRegistry || new WeakMap();

    // Патч для безопасного добавления обработчиков
    function safeAddEventListener(element, event, handler, options) {
        if (!element) return;

        // Удаляем старый обработчик, если есть
        var registry = window._eventListenersRegistry.get(element);
        if (!registry) {
            registry = {};
            window._eventListenersRegistry.set(element, registry);
        }

        var key = event + '_' + (options ? JSON.stringify(options) : '');
        if (registry[key]) {
            element.removeEventListener(event, registry[key], options);
        }

        element.addEventListener(event, handler, options);
        registry[key] = handler;
    }

    // ==================== 2. ОЧИСТКА HLS INSTANCES ====================

    var originalDestroyHls = window.destroyHls;
    window.destroyHls = function() {
        if (originalDestroyHls) originalDestroyHls();

        // Очистка всех HLS-связанных объектов
        var videoPlayer = document.getElementById('video-player');
        if (videoPlayer && videoPlayer._hls) {
            try {
                videoPlayer._hls.destroy();
                delete videoPlayer._hls;
            } catch(e) {}
        }

        // Очистка фонового трейлера
        var trailerBg = document.getElementById('trailer-bg-video');
        if (trailerBg) {
            if (trailerBg._hls) {
                try {
                    trailerBg._hls.destroy();
                    delete trailerBg._hls;
                } catch(e) {}
            }
            if (trailerBg._volumeTimer) {
                clearInterval(trailerBg._volumeTimer);
                delete trailerBg._volumeTimer;
            }
        }
    };

    // ==================== 3. ОЧИСТКА INTERSECTION OBSERVERS ====================

    // Глобальный реестр наблюдателей
    window._observersRegistry = window._observersRegistry || [];

    function registerObserver(observer, name) {
        window._observersRegistry.push({ observer: observer, name: name });
    }

    function cleanupAllObservers() {
        console.log('🧹 Очистка ' + window._observersRegistry.length + ' observers');
        for (var i = 0; i < window._observersRegistry.length; i++) {
            try {
                window._observersRegistry[i].observer.disconnect();
            } catch(e) {}
        }
        window._observersRegistry = [];
    }

    // Патч для catalogState observers
    if (typeof catalogState !== 'undefined') {
        var originalInitPosterLazyLoading = window.initPosterLazyLoading;
        window.initPosterLazyLoading = function() {
            if (catalogState.posterObserver) {
                catalogState.posterObserver.disconnect();
            }
            if (originalInitPosterLazyLoading) {
                originalInitPosterLazyLoading();
            }
            if (catalogState.posterObserver) {
                registerObserver(catalogState.posterObserver, 'posterObserver');
            }
        };

        var originalInitPosterUnloading = window.initPosterUnloading;
        window.initPosterUnloading = function() {
            if (catalogState.unloadObserver) {
                catalogState.unloadObserver.disconnect();
            }
            if (originalInitPosterUnloading) {
                originalInitPosterUnloading();
            }
            if (catalogState.unloadObserver) {
                registerObserver(catalogState.unloadObserver, 'unloadObserver');
            }
        };
    }

    // ==================== 4. ОЧИСТКА ТАЙМЕРОВ ====================

    window._activeTimers = window._activeTimers || [];

    function registerTimer(timerId, name) {
        window._activeTimers.push({ id: timerId, name: name });
    }

    function clearAllTimers() {
        console.log('🧹 Очистка ' + window._activeTimers.length + ' таймеров');
        for (var i = 0; i < window._activeTimers.length; i++) {
            clearTimeout(window._activeTimers[i].id);
            clearInterval(window._activeTimers[i].id);
        }
        window._activeTimers = [];
    }

    // Патч setTimeout/setInterval для автоматической регистрации
    var originalSetTimeout = window.setTimeout;
    var originalSetInterval = window.setInterval;

    window.setTimeout = function(callback, delay) {
        var args = Array.prototype.slice.call(arguments, 2);
        var timerId = originalSetTimeout.apply(window, [callback, delay].concat(args));
        registerTimer(timerId, 'timeout');
        return timerId;
    };

    window.setInterval = function(callback, delay) {
        var args = Array.prototype.slice.call(arguments, 2);
        var timerId = originalSetInterval.apply(window, [callback, delay].concat(args));
        registerTimer(timerId, 'interval');
        return timerId;
    };

    // ==================== 5. ОГРАНИЧЕНИЕ РАЗМЕРА КЭШЕЙ ====================

    // Патч для rutubeTrailerCache
    var TRAILER_CACHE_MAX_SIZE = 20;
    var originalFetchRutubeTrailer = window.fetchRutubeTrailer;

    if (originalFetchRutubeTrailer) {
        window.fetchRutubeTrailer = function() {
            // Очистка старого кэша при переполнении
            if (typeof rutubeTrailerCache !== 'undefined') {
                var keys = Object.keys(rutubeTrailerCache);
                if (keys.length > TRAILER_CACHE_MAX_SIZE) {
                    console.log('🧹 Очистка rutubeTrailerCache: ' + keys.length + ' -> ' + TRAILER_CACHE_MAX_SIZE);
                    // Удаляем старые записи (первые 10)
                    for (var i = 0; i < 10; i++) {
                        delete rutubeTrailerCache[keys[i]];
                    }
                }
            }
            return originalFetchRutubeTrailer.apply(this, arguments);
        };
    }

    // ==================== 6. ПЕРИОДИЧЕСКАЯ ОЧИСТКА ПАМЯТИ ====================

    var CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 минут

    function performMemoryCleanup() {
        console.log('🧹 Выполнение периодической очистки памяти...');

        // 1. Очистка неиспользуемых observers
        if (typeof catalogState !== 'undefined') {
            if (catalogState.posterObserver && AppState.currentScreen !== 'catalog') {
                catalogState.posterObserver.disconnect();
            }
            if (catalogState.unloadObserver && AppState.currentScreen !== 'catalog') {
                catalogState.unloadObserver.disconnect();
            }
        }

        // 2. Очистка старых элементов в posterCache (LRU уже управляет размером)
        if (typeof catalogState !== 'undefined' && catalogState.posterCache) {
            if (catalogState.posterCache.size && catalogState.posterCache.size() > 100) {
                console.log('⚠️ posterCache превышает лимит: ' + catalogState.posterCache.size());
            }
        }

        // 3. Очистка detailHistory
        if (typeof detailHistory !== 'undefined' && detailHistory.length > 50) {
            console.log('🧹 Очистка detailHistory: ' + detailHistory.length + ' -> 50');
            detailHistory.splice(0, detailHistory.length - 50);
        }

        // 4. Очистка tmdbCache
        if (typeof tmdbCache !== 'undefined' && tmdbCache.cleanExpired) {
            tmdbCache.cleanExpired();
        }

        // 5. Принудительная сборка мусора (если доступна)
        if (typeof window.gc === 'function') {
            try {
                window.gc();
                console.log('✅ Принудительная сборка мусора выполнена');
            } catch(e) {}
        }
    }

    // Запуск периодической очистки
    setInterval(performMemoryCleanup, CLEANUP_INTERVAL);

    // ==================== 7. ОЧИСТКА ПРИ СМЕНЕ ЭКРАНА ====================

    var originalShowDetailView = window.showDetailView;
    if (originalShowDetailView) {
        window.showDetailView = function() {
            // Очистка перед показом detail view
            if (typeof stopTrailerBackground === 'function') {
                stopTrailerBackground();
            }
            return originalShowDetailView.apply(this, arguments);
        };
    }

    // ==================== 8. ОЧИСТКА ПРИ ВЫГРУЗКЕ СТРАНИЦЫ ====================

    window.addEventListener('beforeunload', function() {
        console.log('🧹 Очистка при выгрузке страницы...');
        cleanupAllObservers();
        clearAllTimers();

        if (typeof catalogState !== 'undefined') {
            if (catalogState.posterCache && catalogState.posterCache.clear) {
                catalogState.posterCache.clear();
            }
        }
    });

    // ==================== 9. МОНИТОРИНГ ПАМЯТИ (для отладки) ====================

    if (window.performance && window.performance.memory) {
        setInterval(function() {
            var mem = window.performance.memory;
            var used = (mem.usedJSHeapSize / 1048576).toFixed(2);
            var total = (mem.totalJSHeapSize / 1048576).toFixed(2);
            var limit = (mem.jsHeapSizeLimit / 1048576).toFixed(2);

            console.log('💾 Память: ' + used + ' MB / ' + total + ' MB (лимит: ' + limit + ' MB)');

            // Предупреждение при высоком использовании
            if (mem.usedJSHeapSize > mem.jsHeapSizeLimit * 0.9) {
                console.warn('⚠️ КРИТИЧЕСКОЕ использование памяти! Выполнение очистки...');
                performMemoryCleanup();
            }
        }, 60000); // каждую минуту
    }

    console.log('✅ Патчи для утечек памяти загружены');

})();
