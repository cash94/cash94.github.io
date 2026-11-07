/* Сборка для старых браузеров (Chrome 53) из js/poster-prefetch.js — tools/legacy-build/build.js. Руками не править. */
(function () {
  'use strict';

  var PF = {
    CONCURRENCY: 6,
    QUEUE_MAX: 120,
    LOW_QUEUE_MAX: 600,
    LOW_CONCURRENCY: 3,
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
  var WORKER_SRC = 'var q=[],lq=[],active=0,la=0,max=' + PF.CONCURRENCY + ',lmax=' + PF.LOW_CONCURRENCY + ',cap=' + PF.QUEUE_MAX + ',lcap=' + PF.LOW_QUEUE_MAX + ',acc="",ctl={};' + 'onmessage=function(e){var d=e.data;if(d.accept)acc=d.accept;' + 'if(d.rid){if(d.abort){if(ctl[d.rid]){try{ctl[d.rid].abort();}catch(x){}delete ctl[d.rid];}return;}req(d);return;}' + 'if(d.urls&&d.low){for(var a=0;a<d.urls.length;a++){var w=d.urls[a];if(q.indexOf(w)===-1&&lq.indexOf(w)===-1)lq.push(w);}if(lq.length>lcap)lq.length=lcap;}' + 'else if(d.urls){for(var i=d.urls.length-1;i>=0;i--){var u=d.urls[i],j=q.indexOf(u),k=lq.indexOf(u);if(j!==-1)q.splice(j,1);if(k!==-1)lq.splice(k,1);q.unshift(u);}' + 'if(q.length>cap)q.length=cap;}pump();};' + 'function req(d){var c=null;try{c=new AbortController();}catch(x){}if(c)ctl[d.rid]=c;' + 'var o={method:d.method||"GET",headers:d.headers||{}};if(d.body!=null)o.body=d.body;if(c)o.signal=c.signal;if(d.keepalive)o.keepalive=true;if(d.cache)o.cache=d.cache;' + 'fetch(d.url,o).then(function(r){var m={rid:d.rid,status:r.status,statusText:r.statusText,ok:r.ok,ct:r.headers.get("content-type")||"",url:r.url,h:{}};try{r.headers.forEach(function(v,k){m.h[String(k).toLowerCase()]=v;});}catch(x){}' + 'if(d.mode==="none"){postMessage(m);var fin=function(){delete ctl[d.rid];};r.blob().then(fin,fin);return;}' + 'if(d.mode==="buffer"){return r.arrayBuffer().then(function(b){delete ctl[d.rid];m.buf=b;postMessage(m,[b]);});}' + 'return r.text().then(function(t){delete ctl[d.rid];' + 'if(d.mode!=="text"){var s=String(t).trim(),f=s.charAt(0);if(f==="{"||f==="["||/json/i.test(m.ct)){try{m.json=JSON.parse(t);m.parsed=1;postMessage(m);return;}catch(x){}}}' + 'm.text=t;postMessage(m);});})' + '.catch(function(e){delete ctl[d.rid];postMessage({rid:d.rid,err:(e&&e.name)||"TypeError",msg:(e&&e.message)||""});});}' + 'function pump(){while(active<max){if(q.length){active++;get(q.shift(),0);}else if(lq.length&&la<lmax){active++;la++;get(lq.shift(),1);}else break;}}' + 'function get(u,low){fetch(u,{mode:"cors",headers:{Accept:acc}})' + '.then(function(r){if(!r.ok)throw 0;return r.blob();})' + '.then(function(){postMessage({ok:u});},function(){postMessage({fail:u});})' + '.then(function(){active--;if(low)la--;pump();});}' + 'postMessage({ready:1});';
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
        workerReady = false;
        worker = null;
        failAllRequests();
        flushReadyWaiters();
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
    if (d.ready) {
      workerReady = true;
      workerSilent = false;
      flushReadyWaiters();
      return;
    }
    if (d.rid) {
      settleRequest(d);
      return;
    }
    if (d.ok || d.fail) delete lowPending[d.ok || d.fail];
    if (d.ok) remember(d.ok, now());else if (d.fail && Object.prototype.hasOwnProperty.call(known, d.fail)) known[d.fail] = -1;
  }
  function now() {
    return window.performance && performance.now ? performance.now() : Date.now();
  }
  var lowPending = {};
  function want(urls, opts) {
    if (!urls || !urls.length) return;
    var low = !!(opts && opts.low);
    var fresh = [];
    for (var i = 0; i < urls.length; i++) {
      var u = urls[i];
      if (!u) continue;
      var st = Object.prototype.hasOwnProperty.call(known, u) ? known[u] : null;
      if (st === 0 && !low && lowPending[u]) {
        delete lowPending[u];
        fresh.push(u);
        continue;
      }
      if (st !== null && st !== -1) continue;
      remember(u, 0);
      if (low) lowPending[u] = true;
      fresh.push(u);
    }
    if (!fresh.length) return;
    var w = getWorker();
    if (w) w.postMessage(low ? {
      urls: fresh,
      low: 1
    } : {
      urls: fresh
    });
  }
  var reqSeq = 0;
  var reqPending = {};
  var workerReady = false;
  function absServerUrl(path) {
    var p = String(path || '');
    if (/^https?:\/\//i.test(p)) return p;
    try {
      if (window.TS_SERVER && typeof SERVER_URL !== 'undefined' && p.charAt(0) === '/' && p.charAt(1) !== '/') return SERVER_URL + p;
      return new URL(p, document.baseURI).href;
    } catch (e) {
      return p;
    }
  }
  function plainHeaders(h) {
    var out = {};
    if (!h) return out;
    if (typeof h.forEach === 'function' && typeof h.get === 'function') {
      h.forEach(function (v, k) {
        out[k] = v;
      });
      return out;
    }
    for (var k in h) if (Object.prototype.hasOwnProperty.call(h, k)) out[k] = h[k];
    return out;
  }
  function hasHeader(h, name) {
    name = name.toLowerCase();
    for (var k in h) if (Object.prototype.hasOwnProperty.call(h, k) && k.toLowerCase() === name) return true;
    return false;
  }
  function makeError(name, msg) {
    var e = name === 'TypeError' ? new TypeError(msg || 'Failed to fetch') : new Error(msg || name);
    e.name = name;
    return e;
  }
  function makeResponse(m) {
    var used = false;
    var bodyText = function () {
      if (m.text != null) return m.text;
      if (m.parsed) return JSON.stringify(m.json);
      if (m.buf && typeof TextDecoder === 'function') return new TextDecoder('utf-8').decode(m.buf);
      return '';
    };
    var take = function () {
      if (used) return Promise.reject(new TypeError('Body has already been consumed.'));
      used = true;
      return null;
    };
    return {
      ok: !!m.ok,
      status: m.status,
      statusText: m.statusText || '',
      url: m.url || '',
      headers: {
        get: function (n) {
          var h = m.h || {};
          var v = h[String(n).toLowerCase()];
          return v != null ? v : /^content-type$/i.test(n) ? m.ct || null : null;
        }
      },
      json: function () {
        var r = take();
        if (r) return r;
        if (m.parsed) return Promise.resolve(m.json);
        return Promise.resolve().then(function () {
          return JSON.parse(bodyText());
        });
      },
      text: function () {
        var r = take();
        if (r) return r;
        return Promise.resolve(bodyText());
      },
      arrayBuffer: function () {
        var r = take();
        if (r) return r;
        if (m.buf) return Promise.resolve(m.buf);
        var t = bodyText();
        if (typeof TextEncoder === 'function') return Promise.resolve(new TextEncoder().encode(t).buffer);
        return Promise.reject(new TypeError('arrayBuffer() недоступен'));
      }
    };
  }
  function settleRequest(d) {
    var job = reqPending[d.rid];
    if (!job) return;
    delete reqPending[d.rid];
    if (job.unlisten) job.unlisten();
    if (d.err) job.reject(makeError(d.err, d.msg));else job.resolve(makeResponse(d));
  }
  function failAllRequests() {
    for (var id in reqPending) {
      if (!reqPending.hasOwnProperty(id)) continue;
      settleRequest({
        rid: id,
        err: 'TypeError',
        msg: 'Failed to fetch'
      });
    }
  }
  function nativeFetch(url, init) {
    var o = {},
      k;
    init = init || {};
    for (k in init) if (k !== 'bgMode' && Object.prototype.hasOwnProperty.call(init, k)) o[k] = init[k];
    return window.fetch(url, o);
  }
  var READY_WAIT_MS = 1000;
  var readyWaiters = [];
  var readyWaitTimer = null;
  var workerSilent = false;
  function whenWorkerReady(cb) {
    if (workerReady) {
      cb(true);
      return;
    }
    if (workerSilent || !getWorker()) {
      cb(false);
      return;
    }
    readyWaiters.push(cb);
    if (!readyWaitTimer) {
      readyWaitTimer = setTimeout(function () {
        readyWaitTimer = null;
        if (!workerReady) workerSilent = true;
        flushReadyWaiters();
      }, READY_WAIT_MS);
    }
  }
  function flushReadyWaiters() {
    if (readyWaitTimer && workerReady) {
      clearTimeout(readyWaitTimer);
      readyWaitTimer = null;
    }
    var list = readyWaiters;
    readyWaiters = [];
    for (var i = 0; i < list.length; i++) list[i](workerReady);
  }
  function bgFetch(url, init) {
    init = init || {};
    if (init.body != null && typeof init.body !== 'string') return nativeFetch(url, init);
    if (workerReady) return workerFetch(url, init);
    return new Promise(function (resolve) {
      whenWorkerReady(function (ok) {
        resolve(ok && worker ? workerFetch(url, init) : nativeFetch(url, init));
      });
    });
  }
  function workerFetch(url, init) {
    var w = getWorker();
    var body = init.body;
    if (!w) return nativeFetch(url, init);
    var headers = plainHeaders(init.headers);
    try {
      if (typeof isTsServerUrl === 'function' && isTsServerUrl(url) && typeof tsAuthToken === 'function' && !hasHeader(headers, 'Authorization')) {
        var token = tsAuthToken();
        if (token) headers.Authorization = 'Bearer ' + token;
      }
    } catch (e) {}
    var signal = init.signal;
    if (signal && signal.aborted) return Promise.reject(makeError('AbortError', 'The user aborted a request.'));
    return new Promise(function (resolve, reject) {
      var rid = 'r' + ++reqSeq;
      var job = {
        resolve: resolve,
        reject: reject,
        unlisten: null
      };
      if (signal && typeof signal.addEventListener === 'function') {
        var onAbort = function () {
          if (!reqPending[rid]) return;
          delete reqPending[rid];
          if (worker) worker.postMessage({
            rid: rid,
            abort: 1
          });
          reject(makeError('AbortError', 'The user aborted a request.'));
        };
        signal.addEventListener('abort', onAbort);
        job.unlisten = function () {
          signal.removeEventListener('abort', onAbort);
        };
      }
      reqPending[rid] = job;
      w.postMessage({
        rid: rid,
        url: absServerUrl(url),
        method: init.method || 'GET',
        headers: headers,
        body: body != null ? body : null,
        keepalive: !!init.keepalive,
        cache: init.cache || null,
        mode: init.bgMode || 'auto'
      });
    });
  }
  var jsonInflight = {};
  function json(path) {
    if (!path) return Promise.resolve(null);
    if (jsonInflight[path]) return jsonInflight[path];
    var p = bgFetch(path, {
      headers: {
        Accept: 'application/json'
      }
    }).then(function (r) {
      return r.ok ? r.json() : null;
    }).catch(function () {
      return null;
    });
    jsonInflight[path] = p;
    p.then(function () {
      delete jsonInflight[path];
    });
    return p;
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
    lowPending = {};
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
  getWorker();
  window.PosterPrefetch = {
    want: want,
    json: json,
    fetch: bgFetch,
    state: function () {
      return {
        accept: ACCEPTS[acceptIdx],
        idx: acceptIdx,
        calibrated: calibrated,
        stats: stats,
        known: knownOrder.length,
        worker: !!worker,
        ready: workerReady
      };
    }
  };
  window.BgFetch = {
    fetch: bgFetch,
    json: json
  };
  var early = window._bgFetchQueue;
  if (early && early.length) {
    var q = early.splice(0);
    for (var i = 0; i < q.length; i++) q[i].resolve(bgFetch(q[i].url, q[i].init));
  }
})();
function bgFetch(url, init) {
  if (window.BgFetch && typeof window.BgFetch.fetch === 'function') return window.BgFetch.fetch(url, init);
  var o = {},
    k;
  init = init || {};
  for (k in init) if (k !== 'bgMode' && Object.prototype.hasOwnProperty.call(init, k)) o[k] = init[k];
  return window.fetch(url, o);
}
