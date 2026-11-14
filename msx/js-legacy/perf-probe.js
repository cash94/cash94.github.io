/* Сборка для старых браузеров (Chrome 53) из js/perf-probe.js — tools/legacy-build/build.js. Руками не править. */
(function () {
  'use strict';

  if (location.search.indexOf('perf=1') === -1) return;
  if (window.__perfProbe) return;
  window.__perfProbe = true;
  var LONG_FRAME_MS = 32;
  var STALL_MS = 50;
  var NO_POSTERS = location.search.indexOf('noposters=1') !== -1;
  var NO_WINDOW = location.search.indexOf('nowindow=1') !== -1;
  var BLINK = location.search.indexOf('blink=1') !== -1;
  var blinkLog = {};
  var blinkTotal = 0;
  var frames = 0,
    longFrames = 0,
    stalls = 0,
    worst = 0;
  var lastFrame = 0;
  var stats = {};
  var recent = [];
  var blame = {};
  function bucket(name) {
    if (!stats[name]) stats[name] = {
      ms: 0,
      calls: 0,
      max: 0
    };
    return stats[name];
  }
  var clock = window.performance && typeof performance.now === 'function' ? function () {
    return performance.now();
  } : function () {
    return Date.now();
  };
  var BY_SCREEN = {
    updateFocusableElements: 1,
    focusEl: 1
  };
  function bucketName(name) {
    if (!BY_SCREEN[name]) return name;
    var sc = window.AppState && AppState.currentScreen || '?';
    return name + '@' + sc;
  }
  function wrap(name) {
    var orig = window[name];
    if (typeof orig !== 'function' || orig.__probed) return false;
    var probed = function () {
      var t0 = clock();
      var key = bucketName(name);
      try {
        return orig.apply(this, arguments);
      } finally {
        var dt = clock() - t0;
        var b = bucket(key);
        b.ms += dt;
        b.calls++;
        if (dt > b.max) b.max = dt;
        if (dt >= 4) recent.push(key + ':' + Math.round(dt));
      }
    };
    probed.__probed = true;
    window[name] = probed;
    return true;
  }
  var TARGETS = ['appendCatalogItems', 'updatePosterObservers', 'updateGridVisibilityWindow', 'updateFocusableElements', 'rebuildChunkRanges', 'hydrateChunk', 'dehydrateChunk', 'trimGridChunks', 'ensureChunksAroundFocus', 'flushVisibilityToggles', 'flushDeferredPosters', 'updatePosterDOM', 'loadPosterDirect', 'createCatalogCard', 'focusEl', 'scrollToElementIfNeeded', 'revealCatalogElement', 'hydrationStep', 'insertChunkCards', 'finishHydration', 'setRowPosterImg', 'flushPosterRevealBatch', 'pumpPosterReveals', 'processRowPosterQueue', 'loadPosterBatch', 'runGridPosterAhead'];
  var wrapped = [];
  function installWraps() {
    for (var i = 0; i < TARGETS.length; i++) {
      if (wrapped.indexOf(TARGETS[i]) === -1 && wrap(TARGETS[i])) {
        wrapped.push(TARGETS[i]);
      }
    }
    if (NO_POSTERS) installNoPosters();
  }
  function installNoPosters() {
    if (typeof window.updatePosterDOM === 'function' && !window.updatePosterDOM.__neutered) {
      var f1 = function () {};
      f1.__neutered = true;
      f1.__probed = true;
      window.updatePosterDOM = f1;
    }
    if (typeof window.setRowPosterImg === 'function' && !window.setRowPosterImg.__neutered) {
      var f2 = function () {
        return typeof Promise !== 'undefined' ? Promise.resolve() : null;
      };
      f2.__neutered = true;
      f2.__probed = true;
      window.setRowPosterImg = f2;
    }
  }
  function appFrame(stack) {
    var lines = String(stack || '').split('\n');
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (l.indexOf('perf-probe') !== -1) continue;
      if (l.indexOf('appFrame') !== -1 || l.indexOf('traceRemoval') !== -1) continue;
      var m = /at\s+([A-Za-z0-9_$.]+)\s/.exec(l);
      if (m && m[1] !== 'Object' && m[1] !== 'Function') return m[1];
      var m2 = /\/js\/([a-z-]+\.js).*?:(\d+):/.exec(l);
      if (m2) return m2[1] + ':' + m2[2];
    }
    return '?';
  }
  function traceRemoval(node) {
    if (!node || node.nodeType !== 1) return;
    var hit = false;
    if (node.tagName === 'IMG') {
      hit = node.className && node.className.indexOf('poster') !== -1;
    } else if (node.querySelector) {
      hit = !!node.querySelector('img.catalog-poster-img, .row-poster-img img');
    }
    if (!hit) return;
    blinkTotal++;
    var st;
    try {
      throw new Error('x');
    } catch (e) {
      st = e.stack;
    }
    var who = appFrame(st);
    blinkLog[who] = (blinkLog[who] || 0) + 1;
  }
  function installBlinkTrace() {
    var origRemoveChild = Node.prototype.removeChild;
    Node.prototype.removeChild = function (n) {
      traceRemoval(n);
      return origRemoveChild.call(this, n);
    };
    if (Element.prototype.remove) {
      var origRemove = Element.prototype.remove;
      Element.prototype.remove = function () {
        traceRemoval(this);
        return origRemove.apply(this, arguments);
      };
    }
    try {
      var d = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
      if (d && d.set) {
        Object.defineProperty(Element.prototype, 'innerHTML', {
          configurable: true,
          enumerable: d.enumerable,
          get: d.get,
          set: function (v) {
            traceRemoval(this);
            return d.set.call(this, v);
          }
        });
      }
    } catch (e) {}
  }
  function installNoWindow() {
    var st = document.createElement('style');
    st.textContent = '.catalog-offscreen{visibility:visible !important;}';
    document.head.appendChild(st);
  }
  var longTasks = 0,
    longTaskMs = 0;
  try {
    if (window.PerformanceObserver) {
      new PerformanceObserver(function (list) {
        var e = list.getEntries();
        for (var i = 0; i < e.length; i++) {
          longTasks++;
          longTaskMs += e[i].duration;
        }
      }).observe({
        entryTypes: ['longtask']
      });
    }
  } catch (e) {}
  function tick(now) {
    if (lastFrame) {
      var gap = now - lastFrame;
      frames++;
      if (gap > worst) worst = gap;
      if (gap >= LONG_FRAME_MS) {
        longFrames++;
        if (gap >= STALL_MS) stalls++;
        for (var i = 0; i < recent.length; i++) {
          var nm = recent[i].split(':')[0];
          blame[nm] = (blame[nm] || 0) + 1;
        }
      }
    }
    lastFrame = now;
    recent.length = 0;
    requestAnimationFrame(tick);
  }
  var box = null;
  function ensureBox() {
    if (box && box.parentNode) return box;
    box = document.createElement('div');
    box.id = 'perf-probe';
    box.style.cssText = ['position:fixed', 'top:8px', 'right:8px', 'z-index:99999', 'background:rgba(0,0,0,0.85)', 'color:#0f0', 'font:13px/1.35 monospace', 'padding:8px 10px', 'border-radius:8px', 'white-space:pre', 'pointer-events:none', 'max-width:46vw'].join(';');
    document.body.appendChild(box);
    return box;
  }
  function top3(map, unit) {
    var keys = Object.keys(map);
    keys.sort(function (a, b) {
      return (map[b].ms !== undefined ? map[b].ms : map[b]) - (map[a].ms !== undefined ? map[a].ms : map[a]);
    });
    var out = [];
    for (var i = 0; i < keys.length && i < 3; i++) {
      var v = map[keys[i]];
      out.push('  ' + keys[i] + ' ' + (v.ms !== undefined ? Math.round(v.ms) + unit + ' x' + v.calls + ' макс ' + Math.round(v.max) + unit : v));
    }
    return out.length ? out.join('\n') : '  —';
  }
  function render() {
    var el = ensureBox();
    el.textContent = (NO_POSTERS ? 'ОПЫТ: без постеров\n' : '') + (NO_WINDOW ? 'ОПЫТ: без окна видимости\n' : '') + 'кадров: ' + frames + '\n' + 'длинных (>' + LONG_FRAME_MS + 'мс): ' + longFrames + '\n' + 'рывков (>' + STALL_MS + 'мс): ' + stalls + '\n' + 'худший кадр: ' + Math.round(worst) + 'мс\n' + (longTasks ? 'long tasks: ' + longTasks + ' / ' + Math.round(longTaskMs) + 'мс\n' : '') + '\nпо времени:\n' + top3(stats, 'мс') + '\nперед рывками:\n' + top3(blame, '') + (BLINK ? '\nпостер убрал (' + blinkTotal + '):\n' + top3(blinkLog, '') : '');
  }
  function start() {
    if (NO_WINDOW) installNoWindow();
    if (BLINK) installBlinkTrace();
    installWraps();
    setInterval(installWraps, 2000);
    requestAnimationFrame(tick);
    setInterval(render, 500);
    console.log('[perf=1] зонд включён');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(start, 1500);
    });
  } else {
    setTimeout(start, 1500);
  }
  window.perfProbeReset = function () {
    frames = longFrames = stalls = 0;
    worst = 0;
    longTasks = 0;
    longTaskMs = 0;
    stats = {};
    blame = {};
  };
})();
