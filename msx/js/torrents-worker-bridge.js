// torrents-worker-bridge.js — мост между main thread и torrents-worker.js
var TorrentsWorker = (function () {
    var worker = null;
    var pendingCallbacks = {};
    var requestCounter = 0;
    var isReady = false;
    var readyQueue = [];
    var failed = false;

    // Сколько ждём WORKER_READY, прежде чем считать воркер неживым.
    // Молчащий воркер — не редкость: /torrents-worker.js отдаёт маршрут
    // routes/proxy.js, и если зеркало на GitHub недоступно, он присылает 502
    // с телом «// Worker unavailable». Такой скрипт грузится успешно, ошибку не
    // вызывает и просто ничего не делает. Без сторожа каждый запрос к воркеру
    // ждал свой таймаут (8 секунд, а у TMDB все 15), и один поиск повисал на
    // полминуты, прежде чем свалиться на запасной путь в главном потоке.
    var READY_TIMEOUT_MS = 5000;
    var readyTimer = null;

    /** Воркер мёртв: дальше не ждём, все ожидающие получают отказ сразу */
    function markFailed(reason) {
        if (failed) return;
        failed = true;
        if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
        var ids = Object.keys(pendingCallbacks);
        for (var i = 0; i < ids.length; i++) {
            var cb = pendingCallbacks[ids[i]];
            delete pendingCallbacks[ids[i]];
            cb.reject(new Error(reason));
        }
        readyQueue = [];
    }

    function init() {
        if (worker) return;

        try {
            // ?v= обязателен: без него WebView телевизора может отдать воркер
            // из своего HTTP-кэша, пока все остальные скрипты приходят свежими
            // (index.html грузит их с ?v=VERSION). Так же сделано в
            // catalog-worker-bridge.js.
            // ?local=1 пробрасываем в маршрут routes/proxy.js: без него он всегда
            // тянет воркер с зеркала на GitHub, и локальные правки этого файла
            // не видно вообще ничем, даже при отладке всего остального локально.
            var workerPath = 'torrents-worker.js?v=' + (window.VERSION || Date.now());
            if (location.search.indexOf('local=1') !== -1) workerPath += '&local=1';
            worker = new Worker(new URL(workerPath, document.baseURI));
        } catch (e) {
            console.error('❌ TorrentsWorker creation failed:', e);
            worker = null;
            failed = true;
            return;
        }

        readyTimer = setTimeout(function () {
            readyTimer = null;
            if (!isReady) markFailed('TorrentsWorker did not start');
        }, READY_TIMEOUT_MS);

        worker.onmessage = function (e) {
            var msg = e.data;

            if (msg.type === 'WORKER_READY') {
                isReady = true;
                // Воркер мог просто медленно стартовать (маршрут тянет его с
                // зеркала). Раз он ожил — снимаем приговор: те запросы, что уже
                // ушли на запасной путь, ничего не потеряли, а следующие снова
                // пойдут в поток
                failed = false;
                if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
                for (var i = 0; i < readyQueue.length; i++) {
                    worker.postMessage(readyQueue[i]);
                }
                readyQueue = [];
                return;
            }

            var cb = pendingCallbacks[msg.id];
            if (cb) {
                delete pendingCallbacks[msg.id];
                if (msg.type === 'ERROR') cb.reject(new Error(msg.error));
                else cb.resolve(msg.data);
            }
        };

        worker.onerror = function (e) {
            console.error('❌ TorrentsWorker runtime error:', e.message);
            // Ожидающие не должны висеть до своего таймаута — пусть вызывающий
            // сразу уходит на запасной путь в главном потоке
            markFailed('TorrentsWorker crashed');
        };
    }

    function request(type, payload, timeout) {
        timeout = timeout || 8000;

        return new Promise(function (resolve, reject) {
            if (!worker || failed) {
                reject(new Error('TorrentsWorker not available'));
                return;
            }

            var id = 'tw_' + (++requestCounter) + '_' + Date.now();
            var msg = { id: id, type: type, payload: payload || {} };

            var timer = setTimeout(function () {
                if (pendingCallbacks[id]) {
                    delete pendingCallbacks[id];
                    reject(new Error('TorrentsWorker timeout: ' + type));
                }
            }, timeout);

            pendingCallbacks[id] = {
                resolve: function (data) { clearTimeout(timer); resolve(data); },
                reject: function (err) { clearTimeout(timer); reject(err); }
            };

            if (isReady) {
                worker.postMessage(msg);
            } else {
                readyQueue.push(msg);
            }
        });
    }

    return {
        init: init,

        isReady: function () { return isReady; },

        // --- Поиск: батч нормализация ---
        normalizeBatch: function (items) {
            return request('NORMALIZE_BATCH', { items: items });
        },

        // --- Поиск: фильтрация + сортировка ---
        applyFiltersAndSort: function (items, filters) {
            return request('APPLY_FILTERS', { items: items, filters: filters });
        },

        // --- Поиск: вычисление доступных фильтров ---
        computeFilters: function (items) {
            return request('COMPUTE_FILTERS', { items: items });
        },

        // --- Детали: загрузка всех TMDB данных ---
        loadAllTmdbData: function (torrent) {
            return request('LOAD_ALL_TMDB_DATA', { torrent: torrent }, 15000);
        },

        // --- Очистка кэшей ---
        clearCaches: function () {
            return request('CLEAR_CACHES', {});
        },

        // --- Уничтожение ---
        destroy: function () {
            if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
            if (worker) {
                worker.terminate();
                worker = null;
            }
            isReady = false;
            failed = false;
            pendingCallbacks = {};
            readyQueue = [];
        }
    };
})();

// Автоинициализация
TorrentsWorker.init();
