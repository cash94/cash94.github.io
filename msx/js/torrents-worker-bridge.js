// torrents-worker-bridge.js
var TorrentsWorker = (function () {
    var worker = null;
    var pendingCallbacks = {};
    var requestCounter = 0;
    var isReady = false;
    var readyQueue = [];

    function init() {
        if (worker) return;
        try {
            worker = new Worker('/torrents-worker.js');
        } catch (e) {
            console.error('❌ TorrentsWorker creation failed:', e);
            worker = null;
            return;
        }

        worker.onmessage = function (e) {
            var msg = e.data;
            if (msg.type === 'WORKER_READY') {
                isReady = true;
                for (var i = 0; i < readyQueue.length; i++) worker.postMessage(readyQueue[i]);
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
            console.error('❌ TorrentsWorker error:', e.message);
        };
    }

    function request(type, payload, timeout) {
        timeout = timeout || 8000;
        return new Promise(function (resolve, reject) {
            if (!worker) { reject(new Error('TorrentsWorker not available')); return; }
            var id = 'tw_' + (++requestCounter) + '_' + Date.now();
            var msg = { id: id, type: type, payload: payload || {} };
            var timer = setTimeout(function () {
                if (pendingCallbacks[id]) { delete pendingCallbacks[id]; reject(new Error('TorrentsWorker timeout')); }
            }, timeout);
            pendingCallbacks[id] = {
                resolve: function (d) { clearTimeout(timer); resolve(d); },
                reject: function (e) { clearTimeout(timer); reject(e); }
            };
            if (isReady) worker.postMessage(msg);
            else readyQueue.push(msg);
        });
    }

    return {
        init: init,
        isReady: function () { return isReady; },

        normalizeBatch: function (items) {
            return request('NORMALIZE_BATCH', { items: items });
        },

        applyFiltersAndSort: function (items, filters) {
            return request('APPLY_FILTERS', { items: items, filters: filters });
        },

        computeFilters: function (items) {
            return request('COMPUTE_FILTERS', { items: items });
        },

        destroy: function () {
            if (worker) { worker.terminate(); worker = null; }
            isReady = false;
            pendingCallbacks = {};
            readyQueue = [];
        }
    };
})();

TorrentsWorker.init();