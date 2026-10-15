/* Сборка для старых браузеров (Chrome 53) из js/torrents-worker-bridge.js — tools/legacy-build/build.js. Руками не править. */

var TorrentsWorker = function () {
  var worker = null;
  var pendingCallbacks = {};
  var requestCounter = 0;
  var isReady = false;
  var readyQueue = [];
  var failed = false;








  var READY_TIMEOUT_MS = 5000;
  var readyTimer = null;


  function markFailed(reason) {
    if (failed) return;
    failed = true;
    if (readyTimer) {clearTimeout(readyTimer);readyTimer = null;}
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




        failed = false;
        if (readyTimer) {clearTimeout(readyTimer);readyTimer = null;}
        for (var i = 0; i < readyQueue.length; i++) {
          worker.postMessage(readyQueue[i]);
        }
        readyQueue = [];
        return;
      }

      var cb = pendingCallbacks[msg.id];
      if (cb) {
        delete pendingCallbacks[msg.id];
        if (msg.type === 'ERROR') cb.reject(new Error(msg.error));else
        cb.resolve(msg.data);
      }
    };

    worker.onerror = function (e) {
      console.error('❌ TorrentsWorker runtime error:', e.message);


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

      var id = 'tw_' + ++requestCounter + '_' + Date.now();
      var msg = { id: id, type: type, payload: payload || {} };

      var timer = setTimeout(function () {
        if (pendingCallbacks[id]) {
          delete pendingCallbacks[id];
          reject(new Error('TorrentsWorker timeout: ' + type));
        }
      }, timeout);

      pendingCallbacks[id] = {
        resolve: function (data) {clearTimeout(timer);resolve(data);},
        reject: function (err) {clearTimeout(timer);reject(err);}
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

    isReady: function () {return isReady;},


    normalizeBatch: function (items) {
      return request('NORMALIZE_BATCH', { items: items });
    },


    applyFiltersAndSort: function (items, filters) {
      return request('APPLY_FILTERS', { items: items, filters: filters });
    },


    computeFilters: function (items) {
      return request('COMPUTE_FILTERS', { items: items });
    },


    loadAllTmdbData: function (torrent) {
      return request('LOAD_ALL_TMDB_DATA', { torrent: torrent }, 15000);
    },


    clearCaches: function () {
      return request('CLEAR_CACHES', {});
    },


    destroy: function () {
      if (readyTimer) {clearTimeout(readyTimer);readyTimer = null;}
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
}();


TorrentsWorker.init();
