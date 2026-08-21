// torrents-worker-bridge.js — мост между main thread и torrents-worker.js
var TorrentsWorker = (function () {
    var worker = null;
    var pendingCallbacks = {};
    var requestCounter = 0;
    var isReady = false;
    var readyQueue = [];

    function init() {
        if (worker) return;

        try {
            worker = new Worker(new URL('torrents-worker.js', document.baseURI));
        } catch (e) {
            console.error('❌ TorrentsWorker creation failed:', e);
            worker = null;
            return;
        }

        worker.onmessage = function (e) {
            var msg = e.data;

            if (msg.type === 'WORKER_READY') {
                isReady = true;
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
        };
    }

    function request(type, payload, timeout) {
        timeout = timeout || 8000;

        return new Promise(function (resolve, reject) {
            if (!worker) {
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
            if (worker) {
                worker.terminate();
                worker = null;
            }
            isReady = false;
            pendingCallbacks = {};
            readyQueue = [];
        }
    };
})();

// Автоинициализация
TorrentsWorker.init();
