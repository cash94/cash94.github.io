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

        // Обёртка над initPosterUnloading убрана: сама функция удалена из
        // catalog.js (её вызовы были закомментированы, наблюдатель никогда не
        // создавался). Патч подменял несуществующее и только держал ссылку.
    }

    // ==================== 4. ТАЙМЕРЫ — БЕЗ ПАТЧА ====================
    //
    // Здесь window.setTimeout и window.setInterval подменялись обёртками,
    // которые складывали id каждого таймера в window._activeTimers. Это было
    // хуже, чем проблема, которую лечило:
    //
    //   • массив не чистился никогда — отработавшие таймауты оставались в нём
    //     до конца сессии. Приложение заводит таймеры на каждое нажатие пульта,
    //     на анимации, на debounce; за несколько часов работы телевизора это
    //     сотни тысяч записей, то есть ровно та утечка, ради которой файл и
    //     написан;
    //   • каждый вызов setTimeout стоил трёх лишних выделений памяти
    //     (slice + массив + concat) на самом горячем пути в приложении;
    //   • собранное использовалось единственный раз — в clearAllTimers() на
    //     beforeunload, где гасить таймеры уже бессмысленно: страница
    //     уничтожается вместе с ними.
    //
    // Не возвращайте обёртки сюда.

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

        // 1. Очистка неиспользуемых observers.
        // Экран 'detail' — оверлей поверх живой сетки каталога: возврат из карточки
        // сетку не перерисовывает, а disconnect() не обнуляет ссылку, поэтому
        // initPosterLazyLoading() сам не вызовется и постеры больше не грузятся.
        // Поднимает их обратно window.rearmCatalogObservers() (catalog-memory-fix.js).
        var screen = (typeof AppState !== 'undefined') ? AppState.currentScreen : null;
        var catalogAlive = (screen === 'catalog' || screen === 'detail');
        if (typeof catalogState !== 'undefined' && !catalogAlive) {
            if (catalogState.posterObserver) {
                catalogState.posterObserver.disconnect();
                window._catalogObserversDisarmed = true;
            }
        }

        // 2. Контроль размера posterCache (LRU сам управляет размером,
        // порог берём из конфига — иначе после подъёма лимита лог засорялся)
        if (typeof catalogState !== 'undefined' && catalogState.posterCache) {
            var posterCap = (typeof CATALOG_CONSTANTS !== 'undefined' && CATALOG_CONSTANTS.MAX_POSTER_CACHE) || 400;
            if (catalogState.posterCache.size && catalogState.posterCache.size() > posterCap) {
                console.log('⚠️ posterCache превышает лимит: ' + catalogState.posterCache.size());
            }
        }

        // 3. Очистка detailHistory
        if (typeof detailHistory !== 'undefined' && detailHistory.length > 50) {
            console.log('🧹 Очистка detailHistory: ' + detailHistory.length + ' -> 50');
            detailHistory.splice(0, detailHistory.length - 50);
        }

        // tmdbCache здесь не трогаем: у него свой планировщик в catalog.js
        // (startTmdbCleanup → cleanOldTmdbCache), и он же делает trimToMax

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

        if (typeof catalogState !== 'undefined') {
            if (catalogState.posterCache && catalogState.posterCache.clear) {
                catalogState.posterCache.clear();
            }
        }
    });

    // ==================== 9. МОНИТОРИНГ ПАМЯТИ (для отладки) ====================

    // Раз в минуту сюда шла строка в консоль независимо ни от чего. На ТВ
    // (особенно с подключённым logcat) это не бесплатно, а смотреть на неё
    // некому. Оставили сам сторож: логируем, только когда память подходит
    // к пределу, либо когда отладка включена явно — ?memdebug=1 в адресе.
    if (window.performance && window.performance.memory) {
        var MEM_DEBUG = location.search.indexOf('memdebug=1') !== -1;
        setInterval(function() {
            var mem = window.performance.memory;
            var ratio = mem.jsHeapSizeLimit ? (mem.usedJSHeapSize / mem.jsHeapSizeLimit) : 0;

            if (MEM_DEBUG || ratio > 0.75) {
                console.log('💾 Память: ' + (mem.usedJSHeapSize / 1048576).toFixed(2) + ' MB / ' +
                    (mem.totalJSHeapSize / 1048576).toFixed(2) + ' MB (лимит: ' +
                    (mem.jsHeapSizeLimit / 1048576).toFixed(2) + ' MB)');
            }

            // Предупреждение при высоком использовании
            if (ratio > 0.9) {
                console.warn('⚠️ КРИТИЧЕСКОЕ использование памяти! Выполнение очистки...');
                performMemoryCleanup();
            }
        }, 60000); // каждую минуту
    }

    console.log('✅ Патчи для утечек памяти загружены');

})();
