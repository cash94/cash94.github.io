/* Сборка для старых браузеров (Chrome 53) из js/poster-prefetch.js — tools/legacy-build/build.js. Руками не править. */
(function () {
  'use strict';

  var PF = {
    CONCURRENCY: 6,
    QUEUE_MAX: 120,
    DONE_MAX: 1500,
    HIT_MS: 80,
    MISS_MS: 250,
    MISS_LIMIT: 4,
    STORE_KEY: 'ts_img_accept'
  };
  var ua = navigator.userAgent || '';
  var chromeMajor = function () {
    var m = /Chrom(?:e|ium)\/(\d+)/.exec(ua);
    return m ? parseInt(m[1], 10) : 0;
  }();
  var ACCEPTS = ['image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8', 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8', 'image/webp,image/apng,image/*,*/*;q=0.8', 'image/webp,*/*', 'image/webp,image/avif,image/jxl,image/heic,image/heic-sequence,video/*;q=0.8,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5', 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5'];
  function guessAccept() {
    if (!chromeMajor) return /Firefox\//.test(ua) ? 5 : 4;
    if (chromeMajor >= 100) return 0;
    if (chromeMajor >= 85) return 1;
    if (chromeMajor >= 66) return 2;
    return 3;
  }
  var acceptIdx = guessAccept();
  var storeKey = PF.STORE_KEY + '_' + (chromeMajor || ua.length);
  try {
    var saved = parseInt(localStorage.getItem(storeKey), 10);
    if (saved >= 0 && saved < ACCEPTS.length) acceptIdx = saved;
  } catch (e) {}
  var WORKER_SRC = 'var q=[],active=0,max=' + PF.CONCURRENCY + ',cap=' + PF.QUEUE_MAX + ',acc="";' + 'onmessage=function(e){var d=e.data;if(d.accept)acc=d.accept;' + 'if(d.urls){for(var i=d.urls.length-1;i>=0;i--){var u=d.urls[i],j=q.indexOf(u);if(j!==-1)q.splice(j,1);q.unshift(u);}' + 'if(q.length>cap)q.length=cap;}pump();};' + 'function pump(){while(active<max&&q.length){active++;get(q.shift());}}' + 'function get(u){fetch(u,{mode:"cors",headers:{Accept:acc}})' + '.then(function(r){if(!r.ok)throw 0;return r.blob();})' + '.then(function(){postMessage({ok:u});},function(){postMessage({fail:u});})' + '.then(function(){active--;pump();});}';
  var worker = null;
  var workerFailed = false;
  function getWorker() {
    if (worker || workerFailed) return worker;
    try {
      if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || !window.URL) throw 0;
      var url = URL.createObjectURL(new Blob([WORKER_SRC], {
        type: 'text/javascript'
      }));
      worker = new Worker(url);
      worker.onmessage = onWorkerMessage;
      worker.onerror = function () {
        workerFailed = true;
        worker = null;
      };
      worker.postMessage({
        accept: ACCEPTS[acceptIdx]
      });
    } catch (e) {
      workerFailed = true;
      worker = null;
    }
    return worker;
  }
  var known = {};
  var knownOrder = [];
  function remember(url, at) {
    if (!Object.prototype.hasOwnProperty.call(known, url)) {
      knownOrder.push(url);
      if (knownOrder.length > PF.DONE_MAX) delete known[knownOrder.shift()];
    }
    known[url] = at;
  }
  function onWorkerMessage(e) {
    var d = e.data || {};
    if (d.ok) remember(d.ok, now());else if (d.fail && Object.prototype.hasOwnProperty.call(known, d.fail)) known[d.fail] = -1;
  }
  function now() {
    return window.performance && performance.now ? performance.now() : Date.now();
  }
  function want(urls) {
    if (!urls || !urls.length) return;
    var fresh = [];
    for (var i = 0; i < urls.length; i++) {
      var u = urls[i];
      if (!u) continue;
      var st = Object.prototype.hasOwnProperty.call(known, u) ? known[u] : null;
      if (st !== null && st !== -1) continue;
      remember(u, 0);
      fresh.push(u);
    }
    if (!fresh.length) return;
    var w = getWorker();
    if (w) w.postMessage({
      urls: fresh
    });
  }
  var stats = {};
  var calibrated = false;
  var switches = 0;
  function hostOf(url) {
    var m = /^https?:\/\/([^/]+)/.exec(url);
    return m ? m[1] : '';
  }
  function onResourceEntries(list) {
    if (calibrated) return;
    var entries = list.getEntries();
    for (var i = 0; i < entries.length; i++) {
      var en = entries[i];
      if (en.initiatorType !== 'img') continue;
      var doneAt = known[en.name];
      if (!(doneAt > 0) || en.startTime < doneAt) continue;
      var host = hostOf(en.name);
      var s = stats[host] || (stats[host] = {
        hit: 0,
        miss: 0
      });
      if (en.duration < PF.HIT_MS) s.hit++;else if (en.duration > PF.MISS_MS) s.miss++;else continue;
      if (s.miss >= PF.MISS_LIMIT && s.hit === 0) {
        nextAccept();
        return;
      }
    }
    rememberIfGood();
  }
  function rememberIfGood() {
    var hits = 0;
    for (var h in stats) {
      if (!stats.hasOwnProperty(h)) continue;
      if (stats[h].hit === 0 && stats[h].miss > 0) return;
      hits += stats[h].hit;
    }
    if (hits >= 10) {
      try {
        localStorage.setItem(storeKey, String(acceptIdx));
      } catch (e) {}
    }
  }
  function nextAccept() {
    if (++switches >= ACCEPTS.length) {
      calibrated = true;
      return;
    }
    stats = {};
    acceptIdx = (acceptIdx + 1) % ACCEPTS.length;
    if (worker) worker.postMessage({
      accept: ACCEPTS[acceptIdx]
    });
    known = {};
    knownOrder = [];
    try {
      localStorage.removeItem(storeKey);
    } catch (e) {}
  }
  try {
    if (typeof PerformanceObserver === 'function') {
      new PerformanceObserver(onResourceEntries).observe({
        entryTypes: ['resource']
      });
    }
  } catch (e) {}
  window.PosterPrefetch = {
    want: want,
    state: function () {
      return {
        accept: ACCEPTS[acceptIdx],
        idx: acceptIdx,
        calibrated: calibrated,
        stats: stats,
        known: knownOrder.length,
        worker: !!worker
      };
    }
  };
})();
