/* Сборка для старых браузеров (Chrome 53) из js/screensaver.js — tools/legacy-build/build.js. Руками не править. */
(function () {
  'use strict';

  var IDLE_MS = 2 * 60 * 1000;
  var PLAYER_DIM_MS = 10 * 1000;
  var PLAYER_IDLE_MS = 60 * 1000;
  var SLIDE_MS = 30 * 1000;
  var CHECK_MS = 1000;
  var FADE_MS = 1500;
  var DIM_OUT_MS = 300;
  var LIST_TTL_MS = 3 * 24 * 60 * 60 * 1000;
  var DB_NAME = 'ScreensaverDB',
    DB_STORE = 'cache',
    DB_KEY = 'bing';
  var LIST_RETRY_MS = 10 * 60 * 1000;
  var LIST_URL = 'https://cash94.github.io/msx/cache/bing.json';
  var MOUSE_WAKE_PX = 12;
  var lastActivity = Date.now();
  var active = false;
  var root = null,
    layers = [],
    front = 0;
  var captionEl = null,
    clockEl = null;
  var images = [],
    listAt = 0,
    listFailedAt = 0,
    listLoading = false,
    dbChecked = false;
  var index = -1,
    slideTimer = null,
    slideGen = 0;
  var swallowKeyUp = null;
  var mouseX = -1,
    mouseY = -1;
  var swallowClickUntil = 0;
  var heroSuspended = false;
  var pausedSince = 0;
  var dimEl = null,
    dimmed = false;
  function anyVideoPlaying() {
    var vids = document.getElementsByTagName('video');
    for (var i = 0; i < vids.length; i++) {
      var v = vids[i];
      if (!v.paused && !v.ended) return true;
    }
    return false;
  }
  function playerPaused() {
    var st = window.AppState;
    if (!st || st.currentScreen !== 'player' || st.isYoutubePlayback || st.isSeeking) return false;
    var v = document.getElementById('video-player');
    if (!v || !v.paused || v.readyState < 2) return false;
    var po = document.getElementById('player-overlay');
    if (po && po.classList.contains('loading')) return false;
    var pb = document.getElementById('playback-overlay');
    if (pb && pb.classList.contains('active')) return false;
    return true;
  }
  function canStart() {
    if (document.hidden) return false;
    var st = window.AppState;
    if (!st) return false;
    if (st.currentScreen === 'player') return playerPaused();
    if (st.isYoutubePlayback) return false;
    if (st.trailerPlay) return false;
    if (anyVideoPlaying()) return false;
    var loader = document.getElementById('module-loader');
    if (loader && loader.style.display !== 'none') return false;
    return true;
  }
  function withStore(mode, fn) {
    var called = false;
    var once = function (store) {
      if (!called) {
        called = true;
        fn(store);
      }
    };
    try {
      var req = window.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(DB_STORE);
      };
      req.onerror = function () {
        once(null);
      };
      req.onblocked = function () {
        once(null);
      };
      req.onsuccess = function () {
        var db = req.result;
        try {
          var tx = db.transaction(DB_STORE, mode);
          tx.oncomplete = tx.onerror = tx.onabort = function () {
            db.close();
          };
          once(tx.objectStore(DB_STORE));
        } catch (e) {
          db.close();
          once(null);
        }
      };
    } catch (e) {
      once(null);
    }
  }
  function readCachedList(cb) {
    withStore('readonly', function (store) {
      if (!store) {
        cb(null);
        return;
      }
      var called = false;
      var once = function (v) {
        if (!called) {
          called = true;
          cb(v);
        }
      };
      try {
        var r = store.get(DB_KEY);
        r.onsuccess = function () {
          once(r.result || null);
        };
        r.onerror = function () {
          once(null);
        };
      } catch (e) {
        once(null);
      }
    });
  }
  function saveCachedList(list, at) {
    withStore('readwrite', function (store) {
      if (!store) return;
      try {
        store.put({
          at: at,
          images: list
        }, DB_KEY);
      } catch (e) {}
    });
  }
  function fetchList(done) {
    var finish = function (list) {
      listLoading = false;
      if (list && list.length) {
        images = list;
        listAt = Date.now();
        listFailedAt = 0;
        saveCachedList(list, listAt);
      } else {
        listFailedAt = Date.now();
      }
      done();
    };
    try {
      fetch(LIST_URL, {
        credentials: 'omit'
      }).then(function (r) {
        return r.ok ? r.json() : null;
      }).then(function (d) {
        finish(d && d.images);
      })['catch'](function () {
        finish(null);
      });
    } catch (e) {
      finish(null);
    }
  }
  function loadList(done) {
    if (listLoading) return;
    listLoading = true;
    if (dbChecked) {
      fetchList(done);
      return;
    }
    readCachedList(function (rec) {
      dbChecked = true;
      if (rec && rec.images && rec.images.length) {
        images = rec.images;
        listAt = rec.at || 0;
        if (listFresh()) {
          listLoading = false;
          done();
          return;
        }
      }
      fetchList(done);
    });
  }
  function listFresh() {
    return images.length && Date.now() - listAt < LIST_TTL_MS;
  }
  function attachToHost(el) {
    var host = typeof window.getOverlayHost === 'function' ? window.getOverlayHost() : document.body;
    if (el.parentNode !== host) host.appendChild(el);
  }
  function build() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'screensaver';
    for (var i = 0; i < 2; i++) {
      var layer = document.createElement('div');
      layer.className = 'screensaver-layer';
      root.appendChild(layer);
      layers.push(layer);
    }
    var info = document.createElement('div');
    info.className = 'screensaver-info';
    captionEl = document.createElement('div');
    captionEl.className = 'screensaver-caption';
    clockEl = document.createElement('div');
    clockEl.className = 'screensaver-clock';
    info.appendChild(captionEl);
    info.appendChild(clockEl);
    root.appendChild(info);
    document.body.appendChild(root);
  }
  function updateClock() {
    if (!clockEl) return;
    var d = new Date();
    var m = d.getMinutes();
    clockEl.textContent = d.getHours() + ':' + (m < 10 ? '0' : '') + m;
  }
  function showNext(tries) {
    if (!active || !images.length) return;
    if (tries === undefined) tries = images.length;
    if (tries <= 0) {
      scheduleSlide();
      return;
    }
    index = (index + 1) % images.length;
    var item = images[index];
    var gen = ++slideGen;
    var img = new Image();
    img.onload = function () {
      img.onload = img.onerror = null;
      if (!active || gen !== slideGen) return;
      var next = 1 - front;
      layers[next].style.backgroundImage = 'url("' + item.url + '")';
      layers[next].style.opacity = '1';
      layers[front].style.opacity = '0';
      front = next;
      var text = item.title || '';
      if (item.copyright) text += (text ? ' ' : '') + item.copyright;
      captionEl.textContent = text;
      updateClock();
      scheduleSlide();
    };
    img.onerror = function () {
      img.onload = img.onerror = null;
      if (!active || gen !== slideGen) return;
      showNext(tries - 1);
    };
    img.src = item.url;
  }
  function scheduleSlide() {
    if (slideTimer) clearTimeout(slideTimer);
    slideTimer = setTimeout(function () {
      slideTimer = null;
      showNext();
    }, SLIDE_MS);
  }
  function hideKeyboards() {
    try {
      var a = document.activeElement;
      if (typeof window.isTextEntryElement === 'function' && window.isTextEntryElement(a)) a.blur();
    } catch (e) {}
    try {
      if (window.OSK && OSK.isOpen()) OSK.close(false);
    } catch (e) {}
  }
  function start() {
    if (active) return;
    active = true;
    if (window.AppState) AppState.screensaverActive = true;
    hideKeyboards();
    build();
    var home = window.HomeScreen;
    heroSuspended = false;
    if (home && home.state && home.state.hero && home.state.hero.timer && typeof home.stopTrailer === 'function') {
      home.stopTrailer();
      heroSuspended = true;
    }
    attachToHost(root);
    root.style.display = 'block';
    requestAnimationFrame(function () {
      if (active) root.classList.add('screensaver-visible');
    });
    showNext();
  }
  function stop() {
    if (!active) return;
    active = false;
    slideGen++;
    if (window.AppState) AppState.screensaverActive = false;
    if (slideTimer) {
      clearTimeout(slideTimer);
      slideTimer = null;
    }
    if (root) {
      root.classList.remove('screensaver-visible');
      var r = root;
      setTimeout(function () {
        if (!active) r.style.display = 'none';
      }, FADE_MS);
    }
    if (heroSuspended) {
      heroSuspended = false;
      var home = window.HomeScreen;
      if (home && typeof home.rearmTrailer === 'function') home.rearmTrailer();
    }
  }
  function dim() {
    if (dimmed) return;
    dimmed = true;
    if (!dimEl) {
      dimEl = document.createElement('div');
      dimEl.id = 'player-dim';
    }
    attachToHost(dimEl);
    dimEl.style.display = 'block';
    requestAnimationFrame(function () {
      if (dimmed) dimEl.classList.add('player-dim-visible');
    });
  }
  function undim() {
    if (!dimmed) return;
    dimmed = false;
    dimEl.classList.remove('player-dim-visible');
    setTimeout(function () {
      if (!dimmed) dimEl.style.display = 'none';
    }, DIM_OUT_MS);
  }
  function showPlayerHud() {
    if (typeof window.showPlayerControls === 'function') window.showPlayerControls();else if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();
  }
  function idleReached() {
    if (pausedSince) return Date.now() - Math.max(lastActivity, pausedSince) >= PLAYER_IDLE_MS;
    return Date.now() - lastActivity >= IDLE_MS;
  }
  function tick() {
    if (playerPaused()) {
      if (!pausedSince) pausedSince = Date.now();
      if (!dimmed && Date.now() - Math.max(lastActivity, pausedSince) >= PLAYER_DIM_MS) dim();
    } else {
      pausedSince = 0;
      undim();
    }
    if (active) {
      if (!canStart()) stop();else updateClock();
      return;
    }
    if (!idleReached()) return;
    if (!canStart()) return;
    if (listFresh()) {
      start();
      return;
    }
    if (listFailedAt && Date.now() - listFailedAt < LIST_RETRY_MS) {
      if (images.length) start();
      return;
    }
    loadList(function () {
      if (!active && images.length && canStart() && idleReached()) start();
    });
  }
  function wake(e) {
    lastActivity = Date.now();
    if (!active && !dimmed) return false;
    var inPlayer = !!(window.AppState && AppState.currentScreen === 'player');
    stop();
    undim();
    if (inPlayer) showPlayerHud();
    if (e) {
      if (e.cancelable) e.preventDefault();
      e.stopImmediatePropagation();
    }
    return true;
  }
  window.addEventListener('keydown', function (e) {
    var kc = e.keyCode || e.which;
    if (wake(e)) swallowKeyUp = kc;
  }, true);
  window.addEventListener('keyup', function (e) {
    var kc = e.keyCode || e.which;
    if (swallowKeyUp !== null && kc === swallowKeyUp) {
      swallowKeyUp = null;
      e.stopImmediatePropagation();
    }
  }, true);
  var pointerWake = function (e) {
    if (wake(e)) swallowClickUntil = Date.now() + 1000;
  };
  window.addEventListener('mousedown', pointerWake, true);
  window.addEventListener('touchstart', pointerWake, true);
  window.addEventListener('wheel', function (e) {
    wake(e);
  }, true);
  window.addEventListener('click', function (e) {
    if (Date.now() < swallowClickUntil) {
      swallowClickUntil = 0;
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);
  window.addEventListener('mousemove', function (e) {
    if (mouseX >= 0 && Math.abs(e.clientX - mouseX) + Math.abs(e.clientY - mouseY) < MOUSE_WAKE_PX) return;
    mouseX = e.clientX;
    mouseY = e.clientY;
    wake(null);
  }, true);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) lastActivity = Date.now();
  });
  setInterval(tick, CHECK_MS);
  window.Screensaver = {
    isActive: function () {
      return active;
    },
    isDimmed: function () {
      return dimmed;
    },
    show: function () {
      lastActivity = 0;
      if (pausedSince) pausedSince = 1;
      tick();
    },
    hide: function () {
      wake(null);
    }
  };
})();
