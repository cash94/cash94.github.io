/* Сборка для старых браузеров (Chrome 53) из js/home.js — tools/legacy-build/build.js. Руками не править. */





























(function () {
  'use strict';


  var HOME = {

    TTL_MS: 3 * 24 * 60 * 60 * 1000,


    FOCUS_DELAY_MS: 100,
    POSTER_CONCURRENCY: 10,
    MAX_PARALLEL_ROW_LOADS: 3,
    FETCH_TIMEOUT_MS: 10000,
    ITEMS_PER_ROW: 20,



    HIDDEN_ROW_CLASS: 'home-row-hidden',







    WARM_ROW_CLASS: 'home-row-warm',



    ROW_SHARE: 0.48,
    HERO_MIN_H: 190,

    BOTTOM_PAD_PX: 16,

    ROW_CHROME_FALLBACK_PX: 72,
    CARD_ASPECT: 460 / 260,
    CARD_MIN_W: 84,
    CARD_MAX_W: 240,

    HERO_DEBOUNCE_MS: 260,



    BACKDROP_GRACE_MS: 1200,


    BACKDROP_MIRROR_TRIES: 3,






    LOGO_WAIT_MS: 700,
    LOGO_FETCH_TIMEOUT_MS: 6000,
    LOGO_SIZE: 'w500',




    LOGO_NEAR: 2,
    LOGO_PRELOAD_MAX: 2,

    TRAILER_DELAY_MS: 5000,

    RING_LEN: 119.4,






    RING_TICK_MS: 250,

    WATCHDOG_MS: 1000,

    PREFETCH_DELAY_MS: 700,




    WHEEL_STEP_PX: 40,

    SWIPE_STEP_PX: 60,


    SWIPE_AXIS_PX: 10,


    GESTURE_COOLDOWN_MS: 260,



    HOVER_SCROLL_MS: 320,
    HOVER_SCROLL_SEC: 0.3
  };


  var HOME_ROWS = [
  { key: 'history', name: 'Продолжить просмотр', source: 'history' },
  { key: 'trending_week', name: 'В тренде на этой неделе', source: 'tmdb' },
  { key: 'pop_streaming', name: 'Что популярно · Онлайн', source: 'tmdb' },
  { key: 'pop_ontv', name: 'Что популярно · По ТВ', source: 'tmdb' },
  { key: 'pop_rent', name: 'Что популярно · Напрокат', source: 'tmdb' },
  { key: 'pop_theatres', name: 'Что популярно · В кинотеатрах', source: 'tmdb' },
  { key: 'top_movies', name: 'Топ рейтинга: фильмы', source: 'tmdb' },
  { key: 'top_tv', name: 'Топ рейтинга: сериалы', source: 'tmdb' },
  { key: 'popular_movies', name: 'Популярные фильмы', source: 'tmdb' },
  { key: 'popular_tv', name: 'Популярные сериалы', source: 'tmdb' },







  { key: 'kp_zombie', name: 'Кинопоиск · Про зомби', source: 'kinopoisk' },
  { key: 'kp_vampire', name: 'Кинопоиск · Про вампиров', source: 'kinopoisk' },
  { key: 'kp_disaster', name: 'Кинопоиск · Катастрофы', source: 'kinopoisk' },
  { key: 'kp_kids', name: 'Кинопоиск · Мультфильмы детям', source: 'kinopoisk' }];






  var NAV_BUTTONS = ['home-nav-home', 'tab-catalog', 'tab-torrents',
  'tab-donate', 'tab-favorites', 'tab-search', 'settings-btn'];

  var homeState = {
    built: false,
    loading: false,
    activated: false,
    rows: [],
    rowEls: [],
    rowKeys: [],
    rowCols: [],
    activeRow: 0,
    data: {},
    lastRowKey: null,
    lastColIndex: 0,
    lastNavBtnId: 'home-nav-home',
    posterQueue: [],
    activePosterLoads: 0,
    prefetchTimer: null,
    resizeTimer: null,
    cardWidth: 0,
    heroTopCache: null,
    heroDetails: {},


    logos: {},
    logoInflight: {},
    logoUnsupported: false,
    hero: {
      key: null,
      pendingKey: null,
      item: null,
      timer: null,
      ringTimer: null,
      ringTick: null,
      ringDone: false,
      gen: 0,
      backdropUrl: null,
      trailerUrl: null,
      trailerSearched: false,
      video: null,
      hls: null,
      watchdog: null,
      logoTimer: null
    }
  };



  function el(id) {return document.getElementById(id);}

  function serverUrl() {
    return window.SERVER_URL || window.location.origin;
  }

  function esc(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return s ? String(s).replace(/[&<>]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m];
    }) : '';
  }

  function itemTitle(item) {
    return item && (item.title || item.name) || 'Без названия';
  }

  function itemYear(item) {
    var r = item && (item.release_date || item.first_air_date) || '';
    var m = String(r).match(/(19|20)\d{2}/);
    return m ? m[0] : null;
  }

  function posterSize() {
    return typeof window.getPosterCardSize === 'function' ?
    window.getPosterCardSize() : 'w342';
  }



  function tmdbImage(path, size) {
    if (!path) return '';
    if (typeof window.getTmdbImageUrl === 'function') {
      return window.getTmdbImageUrl(path, size);
    }
    var p = String(path);
    if (/^https?:\/\//i.test(p)) return p;
    if (p.charAt(0) !== '/') p = '/' + p;
    return getPrimaryImageBase() + size + p;
  }

  function posterUrlFor(path) {return tmdbImage(path, posterSize());}
  function backdropUrlFor(path) {return tmdbImage(path, 'w1280');}

  function invalidateFocus() {
    if (typeof window.invalidateFocusCache === 'function') window.invalidateFocusCache();
  }






  function scrollHomeToTop() {
    var mc = el('main-container');
    if (mc && isHomeVisible()) mc.scrollTop = 0;
    if (window.AppState) {
      AppState.contentScroll = AppState.contentScroll || {};
      AppState.contentScroll.home = 0;
    }
  }


  function isHomeVisible() {
    var screen = el('content-home');
    if (!screen || screen.hidden) return false;
    var section = el('torrserver-section');
    if (section && section.style.display === 'none') return false;
    return true;
  }


  function isHomeFocusable() {
    if (playerBusy()) return false;
    return isHomeVisible() && !!(window.AppState && AppState.currentScreen === 'home');
  }









  function playerBusy() {
    if (window.AppState && AppState.currentScreen === 'player') return true;
    var overlay = el('playback-overlay');
    if (overlay && overlay.classList.contains('active')) return true;






    var screen = el('player-screen');
    if (screen && screen.style.display && screen.style.display !== 'none') return true;
    return false;
  }







  function moduleLoaderUp() {
    var l = el('module-loader');
    if (!l) return false;





    return l.style.display !== 'none' && l.style.opacity !== '0';
  }






  function heroTrailersOn() {
    try {
      if (window.UICustomizer && typeof UICustomizer.getHeroTrailers === 'function') {
        return UICustomizer.getHeroTrailers();
      }
    } catch (e) {}
    return true;
  }








  function dismissModuleLoader() {
    if (typeof window.hideModuleLoader === 'function') {
      window.hideModuleLoader();
      return;
    }
    var l = el('module-loader');
    if (l) l.style.display = 'none';
  }

  function homeFetch(url) {
    return new Promise(function (resolve) {
      var ctrl = null;
      try {ctrl = new AbortController();} catch (e) {ctrl = null;}
      var timer = setTimeout(function () {
        if (ctrl) {try {ctrl.abort();} catch (e) {}}
      }, HOME.FETCH_TIMEOUT_MS);
      fetch(url, ctrl ? { signal: ctrl.signal } : {}).
      then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).
      then(function (d) {clearTimeout(timer);resolve(d);}).
      catch(function (e) {
        clearTimeout(timer);
        console.warn('🏠 Запрос не удался:', url, e && e.message);
        resolve(null);
      });
    });
  }






  var DB_NAME = 'HomeCacheDB';
  var DB_VERSION = 1;
  var DB_STORE = 'collections';




  var ITEMS_SCHEMA_VERSION = 3;
  var dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      if (!window.indexedDB) {resolve(null);return;}
      var req;
      try {req = indexedDB.open(DB_NAME, DB_VERSION);} catch (e) {resolve(null);return;}
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          db.createObjectStore(DB_STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = function () {resolve(req.result);};
      req.onerror = function () {
        console.warn('🏠 IndexedDB недоступна:', req.error && req.error.message);
        resolve(null);
      };
      req.onblocked = function () {resolve(null);};
    });
    return dbPromise;
  }

  function dbGet(key) {
    return openDb().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        try {
          var rq = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
          rq.onsuccess = function () {resolve(rq.result || null);};
          rq.onerror = function () {resolve(null);};
        } catch (e) {resolve(null);}
      });
    });
  }

  function dbPut(key, items) {
    return openDb().then(function (db) {
      if (!db) return;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(DB_STORE, 'readwrite');
          tx.objectStore(DB_STORE).put({
            key: key, items: items, ts: Date.now(), v: ITEMS_SCHEMA_VERSION
          });
          tx.oncomplete = function () {resolve();};
          tx.onerror = function () {resolve();};
          tx.onabort = function () {resolve();};
        } catch (e) {resolve();}
      });
    });
  }

  function dbClear() {
    return openDb().then(function (db) {
      if (!db) return;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(DB_STORE, 'readwrite');
          tx.objectStore(DB_STORE).clear();
          tx.oncomplete = function () {resolve();};
          tx.onerror = function () {resolve();};
          tx.onabort = function () {resolve();};
        } catch (e) {resolve();}
      });
    });
  }



  function loadHistoryItems() {
    return homeFetch(withClientId(serverUrl() + '/api/history')).then(function (data) {
      if (!data || !data.success || !data.history || !data.history.length) return [];
      return data.history.slice(0, HOME.ITEMS_PER_ROW).map(function (it) {


        var pp = it.posterPath;
        if (pp && pp.indexOf('http') !== 0) pp = pp.charAt(0) === '/' ? pp : '/' + pp;
        return {
          id: it.tmdbId,
          title: it.title,
          name: it.title,
          media_type: it.mediaType,
          poster_path: pp,
          vote_average: null,
          isHistoryItem: true
        };
      });
    });
  }







  function loadCollectionItems(cfg) {
    return dbGet(cfg.key).then(function (rec) {
      var fresh = rec && rec.items && rec.items.length &&
      rec.v === ITEMS_SCHEMA_VERSION &&
      Date.now() - (rec.ts || 0) < HOME.TTL_MS;
      if (fresh) return rec.items;




      var url = cfg.source === 'kinopoisk' ?
      serverUrl() + '/api/kinopoisk/collection?preset=' + encodeURIComponent(cfg.key) :
      serverUrl() + '/api/tmdb/collection?preset=' + encodeURIComponent(cfg.key);

      return homeFetch(url).then(function (data) {
        if (data && data.success && data.items && data.items.length) {

          dbPut(cfg.key, data.items);
          return data.items;
        }
        if (rec && rec.items && rec.items.length) {
          console.warn('🏠 Подборка ' + cfg.key + ': сеть недоступна, берём старый кэш');
          return rec.items;
        }
        return [];
      });
    });
  }

  function loadRowItems(cfg) {
    if (cfg.source === 'history') return loadHistoryItems();
    return loadCollectionItems(cfg);
  }



  function heroKey(item) {
    if (!item || item.id == null) return null;
    return String(item.id) + '_' + (item.media_type || 'movie');
  }

  function ensureHeroDom() {
    var hero = el('home-hero');
    if (hero) return hero;
    var screen = el('content-home');
    if (!screen) return null;

    hero = document.createElement('section');
    hero.id = 'home-hero';
    hero.innerHTML =
    '<div id="home-hero-media">' +
    '<div id="home-hero-backdrop" class="home-hero-empty"></div>' +
    '</div>' +
    '<div id="home-hero-shade"></div>' +





    '<div class="home-hero-ring" id="home-hero-ring" hidden>' +
    '<svg viewBox="0 0 44 44">' +
    '<circle class="home-ring-track" cx="22" cy="22" r="19"></circle>' +
    '<circle class="home-ring-bar" cx="22" cy="22" r="19" transform="rotate(-90 22 22)"></circle>' +
    '</svg>' +
    '<div class="home-ring-icon">▶</div>' +
    '</div>' +
    '<div id="home-hero-body">' +
    '<div id="home-hero-logo"><img alt=""></div>' +
    '<h1 id="home-hero-title"></h1>' +
    '<div id="home-hero-meta"></div>' +
    '<div id="home-hero-overview"></div>' +

    '<button type="button" class="home-hero-btn" id="home-play-btn" hidden>' +
    '<span class="home-hero-btn-icon">▶</span>Смотреть</button>' +
    '</div>';

    var rows = el('home-rows');
    if (rows) screen.insertBefore(hero, rows);else
    screen.appendChild(hero);

    hero.addEventListener('click', function (e) {
      if (!e.target.closest) return;
      if (e.target.closest('#home-play-btn')) playHeroItem();
    });
    return hero;
  }

  function heroMetaText(item, details) {
    var src = details || item || {};
    var mt = (item && item.media_type) === 'tv' ? 'tv' : 'movie';
    var parts = [];
    parts.push(mt === 'tv' ? 'Сериал' : 'Фильм');
    var year = itemYear(src) || itemYear(item);
    if (year) parts.push(year);
    var rating = Number(src.vote_average || item && item.vote_average);
    if (rating > 0) parts.push('★ ' + Math.round(rating * 10) / 10);



    var genres = typeof window.getNormalizedCatalogGenres === 'function' ?
    window.getNormalizedCatalogGenres({
      media_type: mt, genres: src.genres,
      genre_ids: src.genre_ids || item && item.genre_ids
    }) : [];
    if (genres.length) parts.push(genres.slice(0, 2).join(', '));
    return parts.join('  •  ');
  }



  var backdropLoad = 0;
  var backdropTimer = null;




  var backdropFailed = false;

  function cancelBackdropTimer() {
    if (backdropTimer) {clearTimeout(backdropTimer);backdropTimer = null;}
  }






  function clearHeroBackdrop() {
    var box = el('home-hero-backdrop');
    if (!box) return;
    box.style.removeProperty('background-image');
    box.classList.add('home-hero-empty');
  }


  function pushMirrors(out, url) {
    if (!url || out.indexOf(url) !== -1) return;
    out.push(url);
    if (typeof window.getTmdbNextMirrorUrl !== 'function') return;
    var next = url;

    for (var i = 0; i < HOME.BACKDROP_MIRROR_TRIES - 1; i++) {
      next = window.getTmdbNextMirrorUrl(next);
      if (!next || out.indexOf(next) !== -1) break;
      out.push(next);
    }
  }












  function applyHeroBackdrop(url, extra) {
    var box = el('home-hero-backdrop');
    if (!box) return;

    var queue = [];
    pushMirrors(queue, url);
    pushMirrors(queue, extra);
    if (!queue.length) {
      backdropLoad++;
      cancelBackdropTimer();
      homeState.hero.backdropUrl = null;
      clearHeroBackdrop();
      return;
    }




    if (homeState.hero.backdropUrl === queue[0] && !backdropFailed) return;
    homeState.hero.backdropUrl = queue[0];
    backdropFailed = false;

    var mine = ++backdropLoad;
    var at = 0;
    var shown = false;



    function fallback() {
      if (!shown) clearHeroBackdrop();
    }

    function tryNext() {
      cancelBackdropTimer();
      if (shown) return;
      if (mine !== backdropLoad) return;
      if (at >= queue.length) {backdropFailed = true;fallback();return;}
      var candidate = queue[at++];
      var img = new Image();
      var settled = false;






      backdropTimer = setTimeout(function () {
        backdropTimer = null;
        if (mine !== backdropLoad) return;
        fallback();
        tryNext();
      }, HOME.BACKDROP_GRACE_MS);

      function finish() {
        if (settled) return;
        settled = true;
        if (mine !== backdropLoad) return;



        if (!img.naturalWidth) {fallback();tryNext();return;}
        cancelBackdropTimer();
        shown = true;
        backdropFailed = false;
        box.style.backgroundImage = 'url("' + candidate + '")';
        box.classList.remove('home-hero-empty');
      }

      img.onerror = function () {
        if (settled) return;
        settled = true;
        if (mine !== backdropLoad) return;
        fallback();
        tryNext();
      };
      img.onload = function () {
        if (typeof img.decode === 'function') img.decode().then(finish).catch(finish);else
        finish();
      };
      img.src = candidate;
    }

    tryNext();
  }

  function renderHero(item, details) {
    var hero = ensureHeroDom();
    if (!hero) return;
    var src = details || item || {};

    var t = el('home-hero-title');
    if (t) t.textContent = itemTitle(src) !== 'Без названия' ? itemTitle(src) : itemTitle(item);
    var m = el('home-hero-meta');
    if (m) m.textContent = heroMetaText(item, details);
    var o = el('home-hero-overview');
    if (o) o.textContent = src.overview || item && item.overview || '';
    var btn = el('home-play-btn');


    if (btn && btn.hidden) {
      btn.hidden = false;
      invalidateFocus();
    }




    var path = src.backdrop_path || item && item.backdrop_path;
    var poster = src.poster_path || item && item.poster_path || '';
    applyHeroBackdrop(path ? backdropUrlFor(path) : '',
    poster ? posterUrlFor(poster) : '');
  }




  function setHeroItem(item) {
    var k = heroKey(item);
    if (!k) return;
    if (k === homeState.hero.pendingKey) return;
    homeState.hero.pendingKey = k;


    homeState.hero.item = item;
    if (homeState.hero.timer) clearTimeout(homeState.hero.timer);
    homeState.hero.timer = setTimeout(function () {
      homeState.hero.timer = null;
      applyHero(item);
    }, HOME.HERO_DEBOUNCE_MS);
  }

  function applyHero(item) {
    var hero = ensureHeroDom();
    if (!hero || !item) return;
    var k = heroKey(item);

    var gen = ++homeState.hero.gen;

    stopHeroTrailer();
    resetHeroRing();
    homeState.hero.key = k;
    homeState.hero.pendingKey = k;
    homeState.hero.item = item;
    homeState.hero.trailerUrl = null;
    homeState.hero.trailerSearched = false;

    var cached = homeState.heroDetails[k] || null;
    renderHero(item, cached);
    applyHeroLogo(item, k, gen);

    if (cached || item.backdrop_path && item.overview) {
      if (!cached) homeState.heroDetails[k] = item;
      startTrailerCountdown(item, cached || item, gen);
    } else {
      enrichHero(item, k, gen);
    }
  }





  function enrichHero(item, k, gen) {
    if (typeof window.fetchCatalogItemDetails !== 'function') {
      startTrailerCountdown(item, null, gen);
      return;
    }
    Promise.resolve(window.fetchCatalogItemDetails(item)).then(function (d) {
      if (gen !== homeState.hero.gen) return;
      if (d) {
        homeState.heroDetails[k] = d;
        renderHero(item, d);
      }
      startTrailerCountdown(item, d, gen);
    }).catch(function () {
      if (gen !== homeState.hero.gen) return;
      startTrailerCountdown(item, null, gen);
    });
  }







  function logoFromData(src) {
    if (!src || !Object.prototype.hasOwnProperty.call(src, 'logo')) return undefined;
    return src.logo && src.logo.file_path ?
    { url: tmdbImage(src.logo.file_path, HOME.LOGO_SIZE), loaded: false } :
    null;
  }


  function knownLogo(item, k) {
    if (Object.prototype.hasOwnProperty.call(homeState.logos, k)) return homeState.logos[k];
    var info = logoFromData(item);
    if (info === undefined) info = logoFromData(homeState.heroDetails[k]);
    if (info !== undefined) homeState.logos[k] = info;
    return info;
  }


  function fetchHeroLogo(item, k) {
    var known = knownLogo(item, k);
    if (known !== undefined) return Promise.resolve(known);
    if (homeState.logoUnsupported) return Promise.resolve(null);
    if (homeState.logoInflight[k]) return homeState.logoInflight[k];

    var url = serverUrl() + '/api/tmdb/logo?id=' + encodeURIComponent(item.id) +
    '&type=' + (item.media_type === 'tv' ? 'tv' : 'movie');
    var timeout = new Promise(function (resolve, reject) {
      setTimeout(function () {reject(new Error('timeout'));}, HOME.LOGO_FETCH_TIMEOUT_MS);
    });
    var p = Promise.race([fetch(url), timeout]).then(function (r) {

      if (r.status === 404) {homeState.logoUnsupported = true;return null;}
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json().then(function (d) {
        var info = logoFromData(d || {});
        if (info === undefined) info = null;
        homeState.logos[k] = info;
        return info;
      });
    }).catch(function () {

      return null;
    });
    homeState.logoInflight[k] = p;
    p.then(function () {delete homeState.logoInflight[k];});
    return p;
  }





  function preloadLogo(k, info, done) {
    if (info.loaded) {if (done) done(true);return;}
    if (!info.waiters) info.waiters = [];
    if (done) info.waiters.push(done);
    if (info.loading) return;
    info.loading = true;
    var im = new Image();
    var finish = function (ok) {
      info.loading = false;
      info.loaded = ok;
      if (!ok) homeState.logos[k] = null;
      var w = info.waiters;
      info.waiters = [];
      for (var i = 0; i < w.length; i++) w[i](ok);
    };
    im.onload = function () {finish(true);};
    im.onerror = function () {finish(false);};
    im.src = info.url;
  }









  var logoPreloadJob = null;

  function preloadNearLogos(items, idx) {
    if (logoPreloadJob !== null) {
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(logoPreloadJob);else
      clearTimeout(logoPreloadJob);
    }
    var runJob = function () {
      logoPreloadJob = null;
      var started = 0;

      for (var d = 1; d <= HOME.LOGO_NEAR && started < HOME.LOGO_PRELOAD_MAX; d++) {
        var pair = [idx + d, idx - d];
        for (var j = 0; j < 2 && started < HOME.LOGO_PRELOAD_MAX; j++) {
          var it = items[pair[j]];
          var k = it ? heroKey(it) : null;
          if (!k) continue;
          var info = knownLogo(it, k);
          if (!info || info.loaded || info.loading) continue;
          preloadLogo(k, info, null);
          started++;
        }
      }
    };
    logoPreloadJob = typeof window.requestIdleCallback === 'function' ?
    window.requestIdleCallback(runJob, { timeout: 1500 }) :
    setTimeout(runJob, 400);
  }

  function setHeroLogoState(hasLogo, url) {
    var body = el('home-hero-body');
    if (!body) return;
    if (homeState.hero.logoTimer) {
      clearTimeout(homeState.hero.logoTimer);
      homeState.hero.logoTimer = null;
    }
    var img = hasLogo ? document.querySelector('#home-hero-logo img') : null;
    if (img && img.getAttribute('src') !== url) img.setAttribute('src', url);


    var cl = body.classList;
    if (cl.contains('home-hero-has-logo') !== !!hasLogo) cl.toggle('home-hero-has-logo', !!hasLogo);
    if (cl.contains('home-hero-logo-wait')) cl.remove('home-hero-logo-wait');
  }






  function applyHeroLogo(item, k, gen) {
    var body = el('home-hero-body');
    if (!body) return;
    var known = k ? knownLogo(item, k) : null;
    if (known === null || known === undefined && homeState.logoUnsupported) {
      setHeroLogoState(false);
      return;
    }
    if (known && known.loaded) {setHeroLogoState(true, known.url);return;}

    body.classList.remove('home-hero-has-logo');
    body.classList.add('home-hero-logo-wait');
    if (homeState.hero.logoTimer) clearTimeout(homeState.hero.logoTimer);
    homeState.hero.logoTimer = setTimeout(function () {
      homeState.hero.logoTimer = null;
      if (gen === homeState.hero.gen) body.classList.remove('home-hero-logo-wait');
    }, HOME.LOGO_WAIT_MS);

    fetchHeroLogo(item, k).then(function (info) {
      if (gen !== homeState.hero.gen) return;
      if (!info) {setHeroLogoState(false);return;}
      preloadLogo(k, info, function (ok) {
        if (gen === homeState.hero.gen) setHeroLogoState(ok, info.url);
      });
    });
  }



  function ringBar() {return document.querySelector('#home-hero-ring .home-ring-bar');}


  function runHeroRing() {
    stopRingTick();
    var ring = el('home-hero-ring');
    if (ring) ring.hidden = false;
    var bar = ringBar();
    if (!bar) return;
    bar.style.strokeDashoffset = HOME.RING_LEN;
    var started = Date.now();
    homeState.hero.ringTick = setInterval(function () {
      var p = Math.min(1, (Date.now() - started) / HOME.TRAILER_DELAY_MS);
      if (!bar.isConnected) {stopRingTick();return;}
      bar.style.strokeDashoffset = (HOME.RING_LEN * (1 - p)).toFixed(1);
      if (p >= 1) stopRingTick();
    }, HOME.RING_TICK_MS);
  }

  function stopRingTick() {
    if (homeState.hero.ringTick) {
      clearInterval(homeState.hero.ringTick);
      homeState.hero.ringTick = null;
    }
  }

  function resetHeroRing() {
    if (homeState.hero.ringTimer) {
      clearTimeout(homeState.hero.ringTimer);
      homeState.hero.ringTimer = null;
    }
    homeState.hero.ringDone = false;
    hideHeroRing();
    var bar = ringBar();
    if (bar) bar.style.strokeDashoffset = HOME.RING_LEN;
  }

  function hideHeroRing() {
    stopRingTick();
    var ring = el('home-hero-ring');
    if (ring) ring.hidden = true;
  }


  function focusedIsHeroCard() {
    var f = document.querySelector('.focused');
    if (!f || !f.dataset || !findCardPosition(f)) return false;
    var items = homeState.data[f.dataset.homeKey];
    var idx = parseInt(f.dataset.itemIndex, 10);
    if (!items || isNaN(idx) || !items[idx]) return false;
    return heroKey(items[idx]) === homeState.hero.key;
  }








  function startTrailerCountdown(item, details, gen) {
    if (gen !== homeState.hero.gen) return;
    if (!isHomeVisible() || playerBusy() || moduleLoaderUp()) return;


    if (!heroTrailersOn()) {hideHeroRing();return;}
    runHeroRing();
    homeState.hero.ringTimer = setTimeout(function () {
      homeState.hero.ringTimer = null;
      if (gen !== homeState.hero.gen) return;
      homeState.hero.ringDone = true;
      if (!isHomeVisible() || playerBusy() || !focusedIsHeroCard()) {hideHeroRing();return;}
      if (!heroTrailersOn()) {hideHeroRing();return;}
      if (homeState.hero.trailerUrl) {
        startHeroTrailer(homeState.hero.trailerUrl, gen);
        return;
      }
      if (homeState.hero.trailerSearched) {hideHeroRing();return;}
      findHeroTrailer(item, details, gen);
    }, HOME.TRAILER_DELAY_MS);
  }

  function findHeroTrailer(item, details, gen) {
    var src = details || item || {};
    var mt = item.media_type || 'movie';
    var cacheKey = String(item.id || '') + '_' + mt;
    var title = itemTitle(src) !== 'Без названия' ? itemTitle(src) : itemTitle(item);



    var shared = window.rutubeTrailerCache;
    if (shared && shared[cacheKey] && shared[cacheKey].url) {
      onTrailerFound(shared[cacheKey].url, gen);
      return;
    }
    if (typeof window.fetchRutubeTrailer !== 'function') {onTrailerMissing(gen);return;}

    var orig = src.original_title || src.original_name || '';
    var date = src.release_date || src.first_air_date ||
    item.release_date || item.first_air_date || '';
    Promise.resolve(window.fetchRutubeTrailer(title, orig, date)).then(function (res) {
      if (gen !== homeState.hero.gen) return;
      if (res && res.url) {
        if (shared) shared[cacheKey] = { url: res.url, title: res.title || title };
        onTrailerFound(res.url, gen);
      } else {
        onTrailerMissing(gen);
      }
    }).catch(function (e) {
      console.warn('🏠 Поиск трейлера не удался:', e && e.message);
      onTrailerMissing(gen);
    });
  }

  function onTrailerFound(url, gen) {
    if (gen !== homeState.hero.gen) return;
    homeState.hero.trailerUrl = url;
    homeState.hero.trailerSearched = true;

    if (homeState.hero.ringDone && !playerBusy() && focusedIsHeroCard()) startHeroTrailer(url, gen);else
    hideHeroRing();
  }

  function onTrailerMissing(gen) {
    if (gen !== homeState.hero.gen) return;
    homeState.hero.trailerSearched = true;
    hideHeroRing();
  }



  function hlsUrl(url) {
    if (typeof window.wrapRutubeHls === 'function') return window.wrapRutubeHls(url);
    return url;
  }







  function startHeroTrailer(url, gen) {
    if (!url || gen !== homeState.hero.gen) return;
    if (!isHomeVisible() || playerBusy()) return;

    if (!heroTrailersOn()) {hideHeroRing();return;}
    var media = el('home-hero-media');
    if (!media) return;

    stopHeroTrailer();
    hideHeroRing();

    var video = document.createElement('video');
    video.id = 'home-hero-video';
    video.className = 'home-hero-video';
    video.muted = true;
    video.volume = 0;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');


    video.controls = false;
    video.removeAttribute('controls');
    video.setAttribute('disableremoteplayback', '');
    media.appendChild(video);
    homeState.hero.video = video;


    var volumeStarted = false;
    function startVolumeFade() {
      if (volumeStarted) return;
      volumeStarted = true;
      try {video.muted = false;video.volume = 0;} catch (e) {}
      var vol = 0;
      video._volumeTimer = setInterval(function () {
        vol = Math.min(1, vol + 0.1);
        try {video.volume = vol;} catch (e) {}
        if (vol >= 1 && video._volumeTimer) {
          clearInterval(video._volumeTimer);
          video._volumeTimer = null;
        }
      }, 1000);
    }







    function revealVideo() {
      if (homeState.hero.video !== video) return;
      if (video.classList.contains('home-hero-video-on')) return;
      fitTrailerBox(video);
      video.classList.add('home-hero-video-on');
      var hero = el('home-hero');
      if (hero) hero.classList.add('home-hero-playing');
    }


    video.addEventListener('loadedmetadata', function () {fitTrailerBox(video);});
    video.addEventListener('resize', function () {fitTrailerBox(video);});
    video.addEventListener('playing', function () {
      revealVideo();
      startVolumeFade();
    });
    video.addEventListener('timeupdate', function () {

      if (video.currentTime > 0) revealVideo();
      startVolumeFade();
    });

    if (window.Hls && Hls.isSupported()) {
      var hls = new Hls({
        maxBufferSize: 30 * 1024 * 1024,
        maxBufferLength: 10,
        startLevel: 2,
        enableWorker: true
      });
      hls.loadSource(hlsUrl(url));
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, function () {
        video.play().catch(function () {});
      });
      homeState.hero.hls = hls;
    } else {
      video.src = hlsUrl(url);
      video.play().catch(function () {});
    }

    startHeroWatchdog();
  }










  var TRAILER_WIDEN = 1.08;

  function fitTrailerBox(video) {
    var hero = el('home-hero');
    if (!hero || !video) return;
    var ar = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
    var h = hero.clientHeight - 2;
    var w = Math.min(hero.clientWidth, Math.round(h * ar * TRAILER_WIDEN));
    if (w > 0) hero.style.setProperty('--trailer-w', w + 'px');
  }








  function startHeroWatchdog() {
    stopHeroWatchdog();
    homeState.hero.watchdog = setInterval(function () {
      if (!homeState.hero.video) {stopHeroWatchdog();return;}
      if (isHomeVisible() && !playerBusy() && focusedIsHeroCard()) return;
      suspendHero();
    }, HOME.WATCHDOG_MS);
  }

  function stopHeroWatchdog() {
    if (homeState.hero.watchdog) {
      clearInterval(homeState.hero.watchdog);
      homeState.hero.watchdog = null;
    }
  }








  function destroyHlsLater(hls) {
    var run = function () {try {hls.destroy();} catch (e) {}};
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 1500 });else
    setTimeout(run, 600);
  }

  function stopHeroTrailer() {
    stopHeroWatchdog();
    var hero = el('home-hero');
    if (hero) hero.classList.remove('home-hero-playing');
    if (homeState.hero.hls) {
      destroyHlsLater(homeState.hero.hls);
      homeState.hero.hls = null;
    }
    var video = homeState.hero.video || el('home-hero-video');
    if (video) {
      if (video._volumeTimer) {
        clearInterval(video._volumeTimer);
        video._volumeTimer = null;
      }
      try {video.pause();} catch (e) {}
      video.removeAttribute('src');
      try {video.load();} catch (e) {}
      if (video.parentNode) video.parentNode.removeChild(video);
    }
    homeState.hero.video = null;
  }







  function suspendHero() {
    homeState.hero.gen++;
    if (homeState.hero.timer) {clearTimeout(homeState.hero.timer);homeState.hero.timer = null;}
    homeState.hero.key = null;
    homeState.hero.pendingKey = null;
    resetHeroRing();
    stopHeroTrailer();
  }







  function rearmHeroTrailer() {
    if (!isHomeVisible() || !heroTrailersOn()) return;
    var f = document.querySelector('.focused');
    if (!f || !findCardPosition(f)) return;
    homeState.hero.pendingKey = null;
    setHeroFromCard(f);
  }



  function userCardWidth() {
    try {
      if (window.UICustomizer && typeof UICustomizer.getCardSize === 'function') {
        var s = UICustomizer.getCardSize();
        if (s && s.width) return s.width;
      }
    } catch (e) {}
    return 0;
  }







  function applyCardCss(w, h) {
    if (homeState.cardWidth === w) return;
    homeState.cardWidth = w;
    var st = el('home-card-style');
    if (!st) {
      st = document.createElement('style');
      st.id = 'home-card-style';
      document.head.appendChild(st);
    }
    st.textContent =
    '.catalog-row-card.home-card,' +
    '.catalog-row-viewport .catalog-row-card.home-card{' +
    'flex:0 0 ' + w + 'px!important;width:' + w + 'px!important;height:' + h + 'px!important}' +
    '.catalog-row-card.home-card .torrent-poster,' +
    '.catalog-row-viewport .catalog-row-card.home-card .torrent-poster,' +
    '.catalog-row-card.home-card .row-poster-img{' +
    'width:' + w + 'px!important;height:' + h + 'px!important}';
  }


  function rowChrome() {
    var row = homeState.rowEls[homeState.activeRow];
    var cards = homeState.rows[homeState.activeRow];
    if (row && row.offsetHeight && cards && cards.length && cards[0].offsetHeight) {
      var c = row.offsetHeight - cards[0].offsetHeight;
      if (c > 20 && c < 220) return c;
    }
    return HOME.ROW_CHROME_FALLBACK_PX;
  }



















  function cachedHeroTop(hero, mc, availH, availW) {
    var c = homeState.heroTopCache;
    if (c && c.h === availH && c.w === availW) return c.top;




    hero.style.marginTop = '0px';
    var mcTop = mc ? mc.getBoundingClientRect().top : 0;
    var top = Math.max(0, Math.round(hero.getBoundingClientRect().top - mcTop));

    homeState.heroTopCache = { h: availH, w: availW, top: top };
    return top;
  }


  function invalidateHeroTop() {homeState.heroTopCache = null;}
  window.invalidateHomeLayoutCache = invalidateHeroTop;











  function layoutHome() {

    if (cover.on) {cover.layoutPending = true;return;}
    var hero = ensureHeroDom();
    if (!hero || !isHomeVisible()) return;
    var mc = el('main-container');


    var avail = mc && mc.clientHeight || window.innerHeight || 720;
    var availW = mc && mc.clientWidth || 0;



    var needScrollReset = !!(mc && mc.scrollTop);



    var chrome = rowChrome();

    var heroTop = cachedHeroTop(hero, mc, avail, availW);


    var free = Math.max(200, avail - heroTop - HOME.BOTTOM_PAD_PX);

    var rowBlock = Math.round(free * HOME.ROW_SHARE);
    var maxRow = free - HOME.HERO_MIN_H;
    if (rowBlock > maxRow) rowBlock = maxRow;

    var w = Math.round((rowBlock - chrome) / HOME.CARD_ASPECT);
    var lim = userCardWidth();
    if (lim && w > lim) w = lim;
    w = Math.max(HOME.CARD_MIN_W, Math.min(HOME.CARD_MAX_W, w));
    var posterH = Math.round(w * HOME.CARD_ASPECT);


    var heroH = Math.max(HOME.HERO_MIN_H, free - (posterH + chrome));


    if (needScrollReset) mc.scrollTop = 0;
    applyCardCss(w, posterH);
    hero.style.marginTop = -heroTop + 'px';
    hero.style.height = heroH + heroTop + 'px';


    if (homeState.hero.video) fitTrailerBox(homeState.hero.video);
  }



  function createHomeCard(item, key, index) {
    var title = itemTitle(item);
    var mt = item.media_type || 'movie';
    var year = itemYear(item);




    var card = document.createElement('div');
    card.className = 'torrent-card catalog-card catalog-row-card home-card';



    card.dataset.homeKey = key;
    card.dataset.itemIndex = index;
    card.dataset.itemId = item.id;
    card.dataset.mediaType = mt;
    card.dataset.title = title;

    card.innerHTML =
    '<div class="torrent-poster">' +
    '<div class="row-poster-img"><div class="no-poster catalog-poster-loading"></div></div>' +
    '</div>' +
    '<div class="torrent-info">' +
    '<div class="torrent-title">' + esc(title.length > 40 ? title.substring(0, 40) + '...' : title) + '</div>' +
    '<div class="torrent-meta"><span>' + (mt === 'tv' ? 'Сериал' : 'Фильм') + '</span>' + (
    year ? '<span>' + year + '</span>' : '') + '</div>' +
    '</div>';

    return card;
  }

  function createHomeRow(cfg, items) {
    var row = document.createElement('section');


    row.className = 'catalog-row home-row ' + HOME.HIDDEN_ROW_CLASS;
    row.dataset.homeKey = cfg.key;




    var header = document.createElement('div');
    header.className = 'catalog-row-header';
    header.innerHTML = '<h2 class="catalog-row-title">' + esc(cfg.name) + '</h2>' +
    '<div class="home-row-counter"></div>';
    row.appendChild(header);



    var carousel = document.createElement('div');
    carousel.className = 'catalog-row-carousel';
    var viewport = document.createElement('div');
    viewport.className = 'catalog-row-viewport';
    var track = document.createElement('div');
    track.className = 'catalog-row-track';

    homeState.data[cfg.key] = items;

    var cards = [];
    for (var i = 0; i < items.length; i++) {
      var card = createHomeCard(items[i], cfg.key, i);
      track.appendChild(card);
      cards.push(card);
    }

    viewport.appendChild(track);
    carousel.appendChild(viewport);
    row.appendChild(carousel);

    homeState.rows.push(cards);
    homeState.rowEls.push(row);
    homeState.rowKeys.push(cfg.key);
    homeState.rowCols.push(0);
    return row;
  }

  function updateRowCounters() {
    var total = homeState.rowEls.length;
    for (var i = 0; i < total; i++) {
      var c = homeState.rowEls[i].querySelector('.home-row-counter');
      if (c) c.textContent = total > 1 ? i + 1 + ' / ' + total : '';
    }
  }







  function setPosterFallback(box, url) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.style.cssText = 'width:100%;height:100%;object-fit:cover';
      img.onload = function () {
        if (box.isConnected) {box.innerHTML = '';box.appendChild(img);}
        resolve();
      };
      img.onerror = function () {
        if (box.isConnected) box.innerHTML = '<div class="no-poster">Нет постера</div>';
        resolve();
      };
      img.src = url;
    });
  }

  function loadCardPoster(card, item) {
    var box = card.querySelector('.row-poster-img');
    if (!box) return Promise.resolve();
    var url = item && item.poster_path ? posterUrlFor(item.poster_path) : '';
    if (!url) {
      box.innerHTML = '<div class="no-poster">Нет постера</div>';
      return Promise.resolve();
    }


    if (typeof window.setRowPosterImg === 'function') {
      return window.setRowPosterImg(box, url);
    }
    return setPosterFallback(box, url);
  }


  function processPosterQueue() {
    while (homeState.activePosterLoads < HOME.POSTER_CONCURRENCY &&
    homeState.posterQueue.length > 0) {
      var task = homeState.posterQueue.shift();
      if (!task.card.isConnected) {delete task.card.dataset.posterPending;continue;}
      homeState.activePosterLoads++;


      (function (card, item) {
        loadCardPoster(card, item).
        catch(function () {}).
        then(function () {
          if (card.dataset) delete card.dataset.posterPending;
          homeState.activePosterLoads--;
          setTimeout(processPosterQueue, 5);
        });
      })(task.card, task.item);
    }
  }

  function loadRowPosters(index) {
    var cards = homeState.rows[index];
    if (!cards) return;
    var items = homeState.data[homeState.rowKeys[index]] || [];
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var box = card.querySelector('.row-poster-img');






      if (card.dataset.posterPending === '1') continue;


      if (card.dataset.posterLoaded === '1' && box && box.querySelector('img')) continue;
      var idx = parseInt(card.dataset.itemIndex, 10);
      if (isNaN(idx) || !items[idx]) continue;
      card.dataset.posterLoaded = '1';
      card.dataset.posterPending = '1';
      homeState.posterQueue.push({ card: card, item: items[idx] });
    }
    processPosterQueue();
  }






  function prefetchNeighbourPosters(index) {
    if (homeState.prefetchTimer) clearTimeout(homeState.prefetchTimer);
    homeState.prefetchTimer = setTimeout(function () {
      homeState.prefetchTimer = null;
      if (homeState.activeRow !== index) return;
      warmRow(index + 1);
      warmRow(index - 1);
      loadRowPosters(index + 1);
      loadRowPosters(index - 1);
    }, HOME.PREFETCH_DELAY_MS);
  }

  function warmRow(i) {
    var row = homeState.rowEls[i];
    if (row && i !== homeState.activeRow) row.classList.add(HOME.WARM_ROW_CLASS);
  }

  function resetPosterQueue() {


    for (var i = 0; i < homeState.posterQueue.length; i++) {
      var c = homeState.posterQueue[i].card;
      if (c && c.dataset) delete c.dataset.posterPending;
    }
    homeState.posterQueue = [];
    homeState.activePosterLoads = 0;
    if (homeState.prefetchTimer) {
      clearTimeout(homeState.prefetchTimer);
      homeState.prefetchTimer = null;
    }
  }








  function setActiveRow(index) {
    if (index < 0 || index >= homeState.rowEls.length) return false;
    var changed = homeState.activeRow !== index;
    homeState.activeRow = index;
    for (var i = 0; i < homeState.rowEls.length; i++) {
      var cl = homeState.rowEls[i].classList;
      if (i === index) cl.remove(HOME.HIDDEN_ROW_CLASS);else
      cl.add(HOME.HIDDEN_ROW_CLASS);




      if (i === index || Math.abs(i - index) > 1) cl.remove(HOME.WARM_ROW_CLASS);
    }
    homeState.lastRowKey = homeState.rowKeys[index];
    if (changed) invalidateFocus();
    layoutHome();
    loadRowPosters(index);
    prefetchNeighbourPosters(index);
    return true;
  }



  function getNavButtons() {
    var out = [];
    for (var i = 0; i < NAV_BUTTONS.length; i++) {
      var b = el(NAV_BUTTONS[i]);
      if (b && b.offsetParent !== null) out.push(b);
    }
    return out;
  }

  function playButton() {
    var b = el('home-play-btn');
    return b && !b.hidden && b.offsetParent !== null ? b : null;
  }

  function focusHomeEl(target) {
    if (!target) return true;
    if (typeof updateFocusableElements === 'function') updateFocusableElements();
    var list = window.focusableElements;
    var idx = list && list.indexOf ? list.indexOf(target) : -1;
    if (idx !== -1 && typeof setFocus === 'function') setFocus(idx);else
    if (typeof focusEl === 'function') focusEl(target);
    return true;
  }

  function scrollToCard(card) {
    if (typeof window.scrollRowToCard === 'function') {
      window.scrollRowToCard(card);
      return;
    }
    var viewport = card.closest ? card.closest('.catalog-row-viewport') : null;
    if (!viewport || typeof getScrollX !== 'function' || typeof setScrollX !== 'function') return;
    var cur = getScrollX(viewport);
    var cr = card.getBoundingClientRect(),vr = viewport.getBoundingClientRect();
    var pad = 50,target = null;
    if (cr.left < vr.left + pad) target = cur + (cr.left - vr.left - pad);else
    if (cr.right > vr.right - pad) target = cur + (cr.right - vr.right + pad);
    if (target === null) return;
    setScrollX(viewport, target, true, 0.42);
  }

  function focusCard(ri, ci, noScroll) {
    var cards = homeState.rows[ri];
    if (!cards || !cards[ci]) return true;
    if (ri !== homeState.activeRow) setActiveRow(ri);
    homeState.rowCols[ri] = ci;
    homeState.lastRowKey = homeState.rowKeys[ri];
    homeState.lastColIndex = ci;
    focusHomeEl(cards[ci]);


    if (!noScroll) scrollToCard(cards[ci]);
    setHeroFromCard(cards[ci]);
    return true;
  }

  function setHeroFromCard(card) {
    var items = homeState.data[card.dataset.homeKey];
    var idx = parseInt(card.dataset.itemIndex, 10);
    if (!items || isNaN(idx) || !items[idx]) return;
    setHeroItem(items[idx]);
    preloadNearLogos(items, idx);
  }


  function focusActiveRowCard(col) {
    var ri = homeState.activeRow;
    var cards = homeState.rows[ri];
    if (!cards || !cards.length) return focusTopbar();
    if (col === undefined || col === null || isNaN(col)) col = homeState.rowCols[ri] || 0;
    return focusCard(ri, Math.max(0, Math.min(cards.length - 1, col)));
  }

  function focusRow(index) {
    if (!setActiveRow(index)) return true;
    return focusActiveRowCard(homeState.rowCols[index]);
  }

  function findCardPosition(target) {
    var rows = homeState.rows;
    for (var i = 0; i < rows.length; i++) {
      for (var j = 0; j < rows[i].length; j++) {
        if (rows[i][j] === target) return { row: i, col: j };
      }
    }
    return null;
  }

  function focusTopbar() {
    var btns = getNavButtons();
    if (!btns.length) return true;
    var target = el(homeState.lastNavBtnId);
    if (!target || btns.indexOf(target) === -1) target = el('home-nav-home') || btns[0];
    return focusHomeEl(target);
  }







  function removeHistoryItem(id, mediaType, focusNext) {
    var ri = homeState.rowKeys.indexOf('history');
    if (ri === -1) return false;
    var cards = homeState.rows[ri];
    var ci = -1;
    for (var i = 0; i < cards.length; i++) {
      if (String(cards[i].dataset.itemId) === String(id) && cards[i].dataset.mediaType === mediaType) {ci = i;break;}
    }
    if (ci === -1) return false;
    var card = cards[ci];
    if (card.parentNode) card.parentNode.removeChild(card);
    cards.splice(ci, 1);
    if (homeState.data.history) homeState.data.history.splice(ci, 1);

    for (var k = ci; k < cards.length; k++) cards[k].dataset.itemIndex = k;
    invalidateFocus();

    if (cards.length) {
      homeState.rowCols[ri] = Math.min(ci, cards.length - 1);
      if (homeState.lastRowKey === 'history') homeState.lastColIndex = homeState.rowCols[ri];
      if (focusNext) focusCard(ri, homeState.rowCols[ri]);
      return true;
    }


    var rowEl = homeState.rowEls[ri];
    if (rowEl.parentNode) rowEl.parentNode.removeChild(rowEl);
    var wasActive = homeState.activeRow === ri;
    homeState.rows.splice(ri, 1);
    homeState.rowEls.splice(ri, 1);
    homeState.rowKeys.splice(ri, 1);
    homeState.rowCols.splice(ri, 1);
    if (homeState.activeRow > ri) homeState.activeRow--;
    updateRowCounters();
    invalidateFocus();
    if (!homeState.rowEls.length) return focusNext ? focusTopbar() : true;
    if (wasActive) {
      homeState.activeRow = -1;
      setActiveRow(Math.min(ri, homeState.rowEls.length - 1));
      if (focusNext) focusActiveRowCard(0);
    }
    return true;
  }


  function restoreHomeFocus() {
    uncoverHome();
    if (!homeState.rowEls.length) return focusTopbar();
    var idx = homeState.rowKeys.indexOf(homeState.lastRowKey);
    if (idx === -1) idx = Math.min(homeState.activeRow, homeState.rowEls.length - 1);
    setActiveRow(idx);
    var col = homeState.rowKeys[idx] === homeState.lastRowKey ?
    homeState.lastColIndex : homeState.rowCols[idx];
    return focusActiveRowCard(col);
  }

  function ensureHomeFocus(force) {
    if (force === undefined) force = false;
    if (!isHomeFocusable()) return false;
    if (window.AppState && AppState.restoringFocus) return false;
    var f = document.querySelector('.focused');
    if (!force && f && belongsToHome(f)) return true;
    return restoreHomeFocus();
  }

  function belongsToHome(target) {
    if (!target) return false;

    if (target.classList && target.classList.contains('home-nav-btn')) return true;
    if (!target.closest) return false;
    return !!target.closest('#content-home');
  }

  function handleHomeNavigation(dir) {


    window.lastNavDirection = dir;
    var f = document.querySelector('.focused');
    var btns = getNavButtons();
    var bi = f && btns.indexOf ? btns.indexOf(f) : -1;


    if (bi !== -1) {
      homeState.lastNavBtnId = f.id || homeState.lastNavBtnId;
      if (dir === 'left') return focusHomeEl(btns[Math.max(0, bi - 1)]);
      if (dir === 'right') return focusHomeEl(btns[Math.min(btns.length - 1, bi + 1)]);
      if (dir === 'down') {
        var pb = playButton();
        if (pb) return focusHomeEl(pb);
        if (!homeState.rowEls.length) return true;
        return focusActiveRowCard();
      }
      return true;
    }


    if (f && f.id === 'home-play-btn') {
      if (dir === 'up') return focusTopbar();
      if (dir === 'down') {
        if (!homeState.rowEls.length) return true;
        return focusActiveRowCard();
      }
      return true;
    }


    var pos = f ? findCardPosition(f) : null;
    if (!pos) return ensureHomeFocus(true);
    var cards = homeState.rows[pos.row];

    if (dir === 'left') {
      if (pos.col > 0) return focusCard(pos.row, pos.col - 1);
      return true;
    }
    if (dir === 'right') {
      if (pos.col < cards.length - 1) return focusCard(pos.row, pos.col + 1);
      return true;
    }


    if (dir === 'up') {
      if (pos.row > 0) return focusRow(pos.row - 1);
      var pb2 = playButton();
      if (pb2) return focusHomeEl(pb2);
      return focusTopbar();
    }
    if (dir === 'down') {
      if (pos.row < homeState.rowEls.length - 1) return focusRow(pos.row + 1);
      return true;
    }
    return true;
  }

  function handleHomeBack() {
    var f = document.querySelector('.focused');
    var btns = getNavButtons();
    if (f && btns.indexOf(f) !== -1) return true;
    if (f && f.id === 'home-play-btn') {focusTopbar();return true;}
    if (f && findCardPosition(f)) {
      var pb = playButton();
      if (pb) {focusHomeEl(pb);return true;}
      focusTopbar();
      return true;
    }
    ensureHomeFocus(true);
    return true;
  }



  function openHomeItem(item, key, index) {
    homeState.lastRowKey = key;
    homeState.lastColIndex = index;
    if (window.Nav) Nav.push('detail', Nav.detailData(item, index));
    suspendHero();
    scrollHomeToTop();
    if (window.AppState) {
      AppState.catalogIndex = index;
      AppState.androidBackCatalog = item;
      AppState.catalogPu = null;
      AppState.openInRow = true;
    }
    if (typeof window.showCatalogDetail === 'function') {
      window.showCatalogDetail(item, index, null);
    }
    return true;
  }







  function playHeroItem() {
    var item = homeState.hero.item;
    if (!item) return ensureHomeFocus(true);
    suspendHero();

    var details = homeState.heroDetails[heroKey(item)] || item;
    var title = itemTitle(details) !== 'Без названия' ? itemTitle(details) : itemTitle(item);
    var poster = item.poster_path ? posterUrlFor(item.poster_path) : null;

    if (typeof window.showCatalogSearch === 'function') {
      if (window.AppState) {
        AppState.androidBackCatalog = item;
        AppState.catalogIndex = homeState.lastColIndex;
      }
      window.showCatalogSearch(title, poster, item);
      return true;
    }

    return openHomeItem(item, homeState.rowKeys[homeState.activeRow], homeState.lastColIndex);
  }

  function onHomeRowsClick(e) {
    var card = e.target.closest ? e.target.closest('.catalog-row-card') : null;
    if (!card) return;
    var key = card.dataset.homeKey;
    var idx = parseInt(card.dataset.itemIndex, 10);
    var items = homeState.data[key];
    if (!key || isNaN(idx) || !items || !items[idx]) return;
    openHomeItem(items[idx], key, idx);
  }


  function openSearchFromHome() {


    if (typeof window.setSearchLocked === 'function') window.setSearchLocked(false);
    if (typeof window.clearCatalogSearchContext === 'function') window.clearCatalogSearchContext();
    if (typeof window.showSearchResults === 'function') {
      window.showSearchResults({ focusQuery: true });
      return true;
    }
    var tab = el('tab-search');
    if (tab) tab.click();
    return true;
  }






  function clickHidden(id) {
    var target = el(id);
    if (!target) return false;
    try {target.click();} catch (e) {return false;}
    return true;
  }

  function onNavButton(id, viaClick) {
    homeState.lastNavBtnId = id;



    if (window.AppState && AppState.currentScreen === 'detail' &&
    typeof window.dropOpenTorrentDetail === 'function') window.dropOpenTorrentDetail();


    if (id === 'home-nav-home') return goHome();



    suspendHero();
    scrollHomeToTop();





    if (viaClick) return true;
    if (id === 'tab-search') return openSearchFromHome();
    return clickHidden(id);
  }






  function goHome() {
    if (window.Nav) Nav.reset('home');
    if (!isHomeVisible()) return showHome({ restoreFocus: true });
    if (!homeState.rowEls.length) return true;
    return focusRow(0);
  }

  function onHomeOk(f) {
    if (!f) return ensureHomeFocus(true);
    if (f.id === 'home-play-btn') return playHeroItem();
    if (f.classList && f.classList.contains('home-nav-btn')) return onNavButton(f.id);
    var pos = findCardPosition(f);
    if (pos) {
      var items = homeState.data[homeState.rowKeys[pos.row]];
      if (items && items[pos.col]) {
        return openHomeItem(items[pos.col], homeState.rowKeys[pos.row], pos.col);
      }
      return true;
    }
    return ensureHomeFocus(true);
  }



  function loadHomeRows() {
    var container = el('home-rows');
    if (!container) return Promise.resolve(false);

    var cfgs = HOME_ROWS;
    var results = new Array(cfgs.length);
    var nextToLoad = 0,nextToRender = 0;
    var activeLoads = 0,completedLoads = 0,renderedRows = 0;
    var finished = false;

    homeState.rows = [];
    homeState.rowEls = [];
    homeState.rowKeys = [];
    homeState.rowCols = [];
    homeState.activeRow = 0;
    homeState.data = {};
    homeState.activated = false;
    resetPosterQueue();

    container.innerHTML = '<div class="catalog-rows-loading">' +
    '<div class="loading-spinner" style="margin:0 auto 20px"></div>' +
    '<div style="font-size:16px;color:#aaa">Загрузка подборок...</div></div>';
    invalidateFocus();

    return new Promise(function (resolve) {
      function finish(value) {
        if (finished) return;
        finished = true;
        resolve(value);
      }

      function activate() {
        if (homeState.activated) return;
        homeState.activated = true;

        dismissModuleLoader();
        requestAnimationFrame(function () {
          if (!isHomeFocusable()) {loadRowPosters(homeState.activeRow);return;}
          if (typeof updateFocusableElements === 'function') updateFocusableElements();
          setTimeout(function () {


            if (isHomeFocusable()) restoreHomeFocus();else
            loadRowPosters(homeState.activeRow);
          }, HOME.FOCUS_DELAY_MS);
        });
      }

      function renderReadyRows() {
        if (!isHomeVisible()) {finish(false);return;}
        var appended = 0;
        while (nextToRender < cfgs.length && results[nextToRender] !== undefined) {
          var res = results[nextToRender++];
          if (!res.items || !res.items.length) continue;
          var row = createHomeRow(res.cfg, res.items);
          if (!row) continue;
          if (renderedRows === 0) container.innerHTML = '';
          container.appendChild(row);
          renderedRows++;
          appended++;


          if (renderedRows === 1) setActiveRow(0);
          activate();
        }
        if (appended) {
          updateRowCounters();


          invalidateFocus();
        }
      }

      function scheduleLoads() {
        if (finished) return;
        if (!isHomeVisible()) {finish(false);return;}
        if (completedLoads === cfgs.length) {
          if (renderedRows === 0) {
            container.innerHTML = '<div class="catalog-rows-loading">' +
            '<div style="font-size:48px;margin-bottom:20px">🎬</div>' +
            '<div style="font-size:18px;color:#aaa">Подборки недоступны</div>' +
            '<div style="font-size:14px;color:#777;margin-top:10px">Проверьте подключение к интернету</div></div>';
            invalidateFocus();
            if (isHomeFocusable()) focusTopbar();

            dismissModuleLoader();
          }
          finish(renderedRows > 0);
          return;
        }
        while (activeLoads < HOME.MAX_PARALLEL_ROW_LOADS && nextToLoad < cfgs.length) {
          (function (index, cfg) {
            activeLoads++;
            loadRowItems(cfg).
            then(function (items) {results[index] = { cfg: cfg, items: items || [] };}).
            catch(function () {results[index] = { cfg: cfg, items: [] };}).
            then(function () {
              activeLoads--;
              completedLoads++;
              renderReadyRows();
              scheduleLoads();
            });
          })(nextToLoad, cfgs[nextToLoad]);
          nextToLoad++;
        }
      }

      scheduleLoads();
    });
  }



  function showHome(opts) {
    opts = opts || {};
    var screen = el('content-home');
    if (!screen) return false;
    uncoverHome();

    var section = el('torrserver-section');


    if (section) section.style.display = 'block';

    var configScreen = el('config-screen');
    if (configScreen) configScreen.style.display = 'none';



    var tabs = document.querySelectorAll('.view-tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');




    if (typeof window.showContentScreen === 'function') window.showContentScreen('home');else
    if (window.AppState) AppState.currentScreen = 'home';
    screen.hidden = false;
    var homeBtn = el('home-nav-home');
    if (homeBtn) homeBtn.classList.add('active');

    if (window.AppState) {
      AppState.inSearch = 'home';
      AppState.isCatalogSearch = false;
    }
    ensureHeroDom();
    invalidateFocus();

    if (!homeState.built && !homeState.loading) {
      homeState.loading = true;
      layoutHome();
      loadHomeRows().then(function (ok) {
        homeState.loading = false;
        homeState.built = !!ok;
      });
      return true;
    }




    homeState.hero.key = null;
    homeState.hero.pendingKey = null;
    homeState.cardWidth = 0;
    invalidateHeroTop();
    homeState.activated = true;
    setActiveRow(Math.min(homeState.activeRow, Math.max(0, homeState.rowEls.length - 1)));

    requestAnimationFrame(function () {
      if (!isHomeFocusable()) return;
      if (typeof updateFocusableElements === 'function') updateFocusableElements();
      setTimeout(function () {
        if (!isHomeFocusable()) return;
        if (opts.restoreFocus === false) return;
        restoreHomeFocus();
      }, HOME.FOCUS_DELAY_MS);
    });
    return true;
  }

  function refreshHome() {
    return dbClear().then(function () {
      suspendHero();
      homeState.built = false;
      homeState.loading = false;
      homeState.lastRowKey = null;
      homeState.lastColIndex = 0;
      homeState.heroDetails = {};
      return showHome();
    });
  }








  function patchGlobals() {


    var origShowContentScreen = window.showContentScreen;
    window.showContentScreen = function (screen) {
      var homeScreen = el('content-home');
      var homeBtn = el('home-nav-home');
      if (window.AppState && AppState.currentScreen === 'home' && screen !== 'home') {

        AppState.contentScroll = AppState.contentScroll || {};
        AppState.contentScroll.home = 0;
        suspendHero();
      }




      if (screen === 'home') {
        var screens = document.querySelectorAll('#torrserver-section .content-screen');
        for (var i = 0; i < screens.length; i++) {
          if (screens[i] !== homeScreen) screens[i].hidden = true;
        }
      }




      if (homeScreen) {
        var canFade = typeof Animations !== 'undefined' && typeof Animations.fadeIn === 'function';
        if (screen === 'home' && homeScreen.hidden && canFade) {
          Animations.fadeIn(homeScreen, { duration: Animations.UI_FADE.screen });
        } else {
          if (canFade) Animations.resetFade(homeScreen);
          homeScreen.hidden = screen !== 'home';
        }
      }


      if (homeBtn) {
        if (screen === 'home') homeBtn.classList.add('active');else
        homeBtn.classList.remove('active');
      }
      if (typeof origShowContentScreen === 'function') {
        return origShowContentScreen.apply(this, arguments);
      }
      if (window.AppState) AppState.currentScreen = screen;
    };






    var origCloseDonate = window.closeDonateOverlay;
    window.closeDonateOverlay = function () {
      var r = typeof origCloseDonate === 'function' ?
      origCloseDonate.apply(this, arguments) : undefined;
      scheduleFocusAfterOverlay();
      return r;
    };


    document.addEventListener('click', function (e) {
      if (!e.target.closest) return;
      if (!e.target.closest('#donate-close-btn, .donate-overlay-backdrop')) return;
      scheduleFocusAfterOverlay();
    });



    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {suspendHero();return;}
      if (!isHomeVisible()) return;
      var f = document.querySelector('.focused');
      if (f && findCardPosition(f)) setHeroFromCard(f);
    });






    var origStartPlayback = window.startHLSPlayback;
    if (typeof origStartPlayback === 'function') {
      window.startHLSPlayback = function () {
        suspendHero();
        return origStartPlayback.apply(this, arguments);
      };
    }


    window.addEventListener('resize', function () {
      if (!isHomeVisible()) return;
      if (homeState.resizeTimer) clearTimeout(homeState.resizeTimer);
      homeState.resizeTimer = setTimeout(function () {
        homeState.resizeTimer = null;
        homeState.cardWidth = 0;
        invalidateHeroTop();
        layoutHome();
      }, 150);
    });
  }


  function scheduleFocusAfterOverlay() {
    setTimeout(function () {
      if (!isHomeFocusable()) return;
      var f = document.querySelector('.focused');
      if (f && belongsToHome(f)) return;
      restoreHomeFocus();
    }, 160);
  }


  function registerStrategy() {
    if (typeof ScreenStrategies === 'undefined' || !ScreenStrategies.torrents) {
      setTimeout(registerStrategy, 100);
      return;
    }
    if (ScreenStrategies.home) return;
    ScreenStrategies.home = {
      getItems: function () {
        var out = getNavButtons();
        var pb = playButton();
        if (pb) out.push(pb);






        var rows = document.querySelectorAll('#home-rows .catalog-row');
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].classList.contains(HOME.HIDDEN_ROW_CLASS)) continue;
          var cards = rows[i].querySelectorAll('.catalog-row-card');
          for (var k = 0; k < cards.length; k++) out.push(cards[k]);
        }
        return out;
      },
      ensureFocus: ensureHomeFocus,
      handleNavigation: handleHomeNavigation,
      onOk: onHomeOk
    };
  }















  var wheelAccum = 0;
  var wheelAccumAt = 0;
  var wheelScrollable = false;
  var gestureLockUntil = 0;
  var swipe = null;







  function pageScrollable() {
    var mc = el('main-container');
    return !!(mc && mc.scrollHeight - mc.clientHeight > 2);
  }











  function homeGestureTarget(target) {
    if (playerBusy() || moduleLoaderUp() || !isHomeVisible()) return false;
    if (!target || !target.closest) return false;
    return !!(target.closest('#content-home') || target.closest('#home-topbar'));
  }


  function gestureStepRow(down) {
    if (!homeState.rowEls.length) return false;


    window.lastNavDirection = down ? 'down' : 'up';

    var f = document.querySelector('.focused');
    var pos = f ? findCardPosition(f) : null;


    if (!pos && f && belongsToHome(f)) {
      if (!down) return false;
      focusActiveRowCard();
      return true;
    }



    var from = pos ? pos.row : homeState.activeRow;
    var next = from + (down ? 1 : -1);
    if (next < 0 || next >= homeState.rowEls.length) return false;
    focusRow(next);
    return true;
  }

  function onHomeWheel(e) {
    if (e.defaultPrevented) return;
    if (!homeGestureTarget(e.target)) return;

    var dy = e.deltaY || e.wheelDeltaY || (
    e.wheelDelta ? -e.wheelDelta / 40 : 0) || e.detail || 0;
    var dx = e.deltaX || e.wheelDeltaX || 0;
    if (!dy || Math.abs(dx) > Math.abs(dy)) return;

    var now = Date.now();


    if (now - wheelAccumAt > 400 || wheelAccum > 0 !== dy > 0) {
      wheelAccum = 0;


      wheelScrollable = pageScrollable();
    }
    wheelAccumAt = now;
    wheelAccum += dy;
    if (!wheelScrollable) e.preventDefault();

    if (Math.abs(wheelAccum) < HOME.WHEEL_STEP_PX) return;
    if (now < gestureLockUntil) return;
    wheelAccum = 0;
    gestureLockUntil = now + HOME.GESTURE_COOLDOWN_MS;
    gestureStepRow(dy > 0);
  }

  function onHomeTouchStart(e) {
    swipe = null;
    touchedAt = Date.now();
    stopHoverScroll();
    if (!e.touches || e.touches.length !== 1) return;
    if (!homeGestureTarget(e.target)) return;
    var t = e.touches[0];
    swipe = { x: t.clientX, y: t.clientY, anchor: t.clientY, vertical: false, scrollable: false };
  }

  function onHomeTouchMove(e) {
    if (!swipe || !e.touches || e.touches.length !== 1) return;

    var t = e.touches[0];
    var dx = t.clientX - swipe.x;
    var dy = t.clientY - swipe.y;

    if (!swipe.vertical) {
      if (Math.abs(dx) < HOME.SWIPE_AXIS_PX && Math.abs(dy) < HOME.SWIPE_AXIS_PX) return;

      if (Math.abs(dx) > Math.abs(dy)) {swipe = null;return;}
      swipe.vertical = true;
      swipe.anchor = t.clientY;
      swipe.scrollable = pageScrollable();
    }

    if (!swipe.scrollable) e.preventDefault();

    var now = Date.now();
    if (now < gestureLockUntil) return;



    var travel = t.clientY - swipe.anchor;
    if (Math.abs(travel) < HOME.SWIPE_STEP_PX) return;
    swipe.anchor = t.clientY;
    gestureLockUntil = now + HOME.GESTURE_COOLDOWN_MS;
    gestureStepRow(travel < 0);
  }

  function onHomeTouchEnd() {
    swipe = null;
    touchedAt = Date.now();
  }









  var hover = { viewport: null, dir: 0, timer: null };




  var hoverMetrics = { el: null, at: 0, box: null, step: 0 };
  var lastMoveAt = 0;
  var lastMoveX = -1;
  var lastMoveY = -1;
  var touchedAt = 0;


  function cardStep(viewport) {
    var track = viewport.firstElementChild;
    var cards = track ? track.children : null;
    if (cards && cards.length > 1) {
      var s = cards[1].offsetLeft - cards[0].offsetLeft;
      if (s > 10) return s;
    }
    if (cards && cards.length === 1) return cards[0].offsetWidth;
    return Math.max(120, (viewport.clientWidth || 600) * 0.25);
  }

  function rowMetrics(v) {
    var now = Date.now();
    if (hoverMetrics.el !== v || now - hoverMetrics.at > 500) {
      hoverMetrics.el = v;
      hoverMetrics.at = now;
      hoverMetrics.box = v.getBoundingClientRect();
      hoverMetrics.step = cardStep(v);
    }
    return hoverMetrics;
  }

  function stopHoverScroll() {
    if (hover.timer) {clearInterval(hover.timer);hover.timer = null;}
    hover.viewport = null;
    hover.dir = 0;
  }

  function hoverScrollStep() {
    var v = hover.viewport;
    if (!v || !v.isConnected || !hover.dir) {stopHoverScroll();return;}

    if (playerBusy() || !isHomeVisible()) {stopHoverScroll();return;}


    if (v.offsetParent === null || v.closest && v.closest('.' + HOME.HIDDEN_ROW_CLASS)) {stopHoverScroll();return;}
    if (typeof getScrollX !== 'function' || typeof setScrollX !== 'function') {stopHoverScroll();return;}

    var cur = getScrollX(v);
    var max = typeof getMaxScrollX === 'function' ? getMaxScrollX(v) : 0;


    if (hover.dir < 0 && cur <= 0.5 || hover.dir > 0 && cur >= max - 0.5) {
      stopHoverScroll();
      return;
    }
    setScrollX(v, cur + hover.dir * rowMetrics(v).step, true, HOME.HOVER_SCROLL_SEC);
  }


  function startHoverScroll(viewport, dir) {
    if (hover.viewport === viewport && hover.dir === dir && hover.timer) return true;
    stopHoverScroll();
    hover.viewport = viewport;
    hover.dir = dir;
    hoverScrollStep();

    if (!hover.dir) return false;
    hover.timer = setInterval(hoverScrollStep, HOME.HOVER_SCROLL_MS);
    return true;
  }









  function hoverFocusableFrom(node) {
    if (!node || !node.closest) return null;
    return node.closest('#home-rows .torrent-card.catalog-card') ||
    node.closest('#home-topbar .home-nav-btn') ||
    node.closest('#home-play-btn');
  }

  function hoverFocus(target) {

    if (!target || target.classList.contains('focused')) return;

    var pos = findCardPosition(target);
    if (pos) {



      var vp = target.closest('.catalog-row-viewport');
      if (vp) {
        var cb = target.getBoundingClientRect(),vb = rowMetrics(vp).box;
        if (cb.left < vb.left - 1 || cb.right > vb.right + 1) return;
      }
      focusCard(pos.row, pos.col, true);
      return;
    }


    if (target.classList.contains('home-nav-btn')) {
      homeState.lastNavBtnId = target.id || homeState.lastNavBtnId;
    }
    focusHomeEl(target);
  }

  function onHomeMouseMove(e) {
    var now = Date.now();


    if (now - touchedAt < 800) return;
    if (now - lastMoveAt < 50) return;

    if (e.clientX === lastMoveX && e.clientY === lastMoveY) return;
    lastMoveAt = now;
    lastMoveX = e.clientX;
    lastMoveY = e.clientY;

    if (!homeGestureTarget(e.target)) {stopHoverScroll();return;}

    var v = e.target && e.target.closest ?
    e.target.closest('#home-rows .catalog-row-viewport') : null;
    if (v) {
      var m = rowMetrics(v);

      var w = m.box.width || v.clientWidth || 0;
      var zone = Math.max(60, Math.min(m.step, w * 0.3));



      if (e.clientX >= m.box.right - zone) {
        if (startHoverScroll(v, 1)) return;
      } else if (e.clientX <= m.box.left + zone) {
        if (startHoverScroll(v, -1)) return;
      }
    }
    stopHoverScroll();
    hoverFocus(hoverFocusableFrom(e.target));
  }

  function initGestures() {


    document.addEventListener('wheel', onHomeWheel, { passive: false });
    document.addEventListener('touchstart', onHomeTouchStart, { passive: true });
    document.addEventListener('touchmove', onHomeTouchMove, { passive: false });
    document.addEventListener('touchend', onHomeTouchEnd, { passive: true });
    document.addEventListener('touchcancel', onHomeTouchEnd, { passive: true });


    document.addEventListener('mousemove', onHomeMouseMove, { passive: true });
    document.addEventListener('mouseout', function (e) {
      if (!e.relatedTarget) stopHoverScroll();
    }, { passive: true });
    window.addEventListener('blur', stopHoverScroll);
  }



  var CLOCK_DAYS = ['воскресенье', 'понедельник', 'вторник', 'среда',
  'четверг', 'пятница', 'суббота'];
  var CLOCK_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];








  function startTopbarClock() {
    var timeEl = el('home-clock-time');
    if (!timeEl) return;
    var dayEl = el('home-clock-day');
    var wdEl = el('home-clock-weekday');
    var lastTime = '';
    var lastDay = '';

    function pad(n) {return (n < 10 ? '0' : '') + n;}

    function tick() {
      var d = new Date();
      var t = d.getHours() + ':' + pad(d.getMinutes());
      if (t !== lastTime) {
        lastTime = t;
        timeEl.textContent = t;
      }
      var day = d.getDate() + ' ' + CLOCK_MONTHS[d.getMonth()] + ' ' +
      d.getFullYear() + 'г.';
      if (day !== lastDay) {
        lastDay = day;
        if (dayEl) dayEl.textContent = day;
        if (wdEl) wdEl.textContent = CLOCK_DAYS[d.getDay()];
      }
    }

    tick();
    setInterval(tick, 1000);
  }





















  var COVER_CLASS = 'home-under-detail';


  var COVER_DELAY_MS = 700;
  var cover = { on: false, timer: null, rows: null, layoutPending: false };

  function detailShownState(dv) {
    if (!dv || !dv.style.display || dv.style.display === 'none') return false;
    return dv.getAttribute('data-hiding') !== '1';
  }

  function coverHome() {
    cover.timer = null;
    var screen = el('content-home');
    var dv = el('detail-view');
    if (cover.on || !screen || screen.hidden || !detailShownState(dv)) return;

    if (parseFloat(window.getComputedStyle(dv).opacity) < 0.99) {
      cover.timer = setTimeout(coverHome, COVER_DELAY_MS);
      return;
    }

    var vps = screen.querySelectorAll('.catalog-row-viewport');
    cover.rows = [];
    for (var i = 0; i < vps.length; i++) cover.rows.push([vps[i], vps[i].scrollLeft]);
    screen.classList.add(COVER_CLASS);
    cover.on = true;
  }


  function uncoverHome() {
    if (cover.timer) {clearTimeout(cover.timer);cover.timer = null;}
    if (!cover.on) return false;
    cover.on = false;
    var screen = el('content-home');
    if (screen) screen.classList.remove(COVER_CLASS);
    var rows = cover.rows || [];
    cover.rows = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i][0].isConnected && rows[i][0].scrollLeft !== rows[i][1]) rows[i][0].scrollLeft = rows[i][1];
    }
    if (cover.layoutPending) {
      cover.layoutPending = false;
      layoutHome();
    }
    return true;
  }

  function watchDetailForCover() {
    var dv = el('detail-view');
    if (!dv || typeof MutationObserver === 'undefined') return;
    new MutationObserver(function () {
      if (!detailShownState(dv)) {uncoverHome();return;}
      if (!cover.on && !cover.timer) cover.timer = setTimeout(coverHome, COVER_DELAY_MS);
    }).observe(dv, { attributes: true, attributeFilter: ['style', 'data-hiding'] });
  }



















  var topbarHome = null;

  function detailTopbarShown() {
    var bar = el('home-topbar');
    return !!(bar && bar.parentNode && bar.parentNode.id === 'detail-view');
  }

  function detailTopbarShow() {
    var bar = el('home-topbar');
    var dv = el('detail-view');
    if (!bar || !dv) return false;
    if (detailTopbarShown()) return true;
    topbarHome = { parent: bar.parentNode, next: bar.nextSibling };
    bar.classList.add('detail-topbar');
    dv.insertBefore(bar, dv.firstChild);
    return true;
  }


  function detailTopbarEnsureHome() {
    var bar = el('home-topbar');
    if (!bar || !detailTopbarShown()) return false;
    bar.classList.remove('detail-topbar');
    var parent = topbarHome && topbarHome.parent;
    if (parent && parent.isConnected) {
      var next = topbarHome.next;
      parent.insertBefore(bar, next && next.parentNode === parent ? next : null);
    } else {

      var sec = el('torrserver-section');
      if (sec) sec.insertBefore(bar, sec.firstChild);
    }
    topbarHome = null;
    return true;
  }


















  function detailTopbarFocus(btn) {
    if (!btn) return false;
    homeState.lastNavBtnId = btn.id || homeState.lastNavBtnId;
    focusHomeEl(btn);
    return true;
  }

  function detailTopbarPreferred() {
    var btns = getNavButtons();
    if (!btns.length) return null;
    var last = el(homeState.lastNavBtnId);
    if (last && btns.indexOf(last) !== -1) return last;
    return el('home-nav-home') || btns[0];
  }

  window.DetailTopbar = {
    show: detailTopbarShow,
    hide: detailTopbarEnsureHome,
    ensureHome: detailTopbarEnsureHome,
    isShown: detailTopbarShown,
    buttons: getNavButtons,
    focus: detailTopbarFocus,
    preferred: detailTopbarPreferred
  };












  var MOBILE_NAV_QUERY = '(max-width: 600px) and (orientation: portrait)';
  var BACK_KEYS = { 8: 1, 27: 1, 461: 1, 10009: 1 };

  function mobileNavApplies() {
    return !!(window.matchMedia && window.matchMedia(MOBILE_NAV_QUERY).matches);
  }

  function mobileNavOpen() {
    return document.body.classList.contains('mobile-nav-open');
  }




  var topbarRaisedForMenu = false;

  function setMobileNav(open) {
    if (open && !mobileNavApplies()) return;
    document.body.classList.toggle('mobile-nav-open', !!open);
    if (!open && topbarRaisedForMenu) {
      topbarRaisedForMenu = false;
      detailTopbarEnsureHome();
    }
  }








  function openMenuFromDetail() {
    if (!mobileNavApplies()) return;
    if (!detailTopbarShown()) {
      if (!detailTopbarShow()) return;
      topbarRaisedForMenu = true;
    }
    setMobileNav(true);
  }



  function settingsNavOpen() {
    return document.body.classList.contains('settings-nav-open');
  }

  function setSettingsNav(open) {
    if (open && !mobileNavApplies()) return;
    document.body.classList.toggle('settings-nav-open', !!open);
  }

  function initSettingsNav() {
    var title = document.querySelector('#config-screen .settings-title');
    if (title) title.addEventListener('click', function () {setSettingsNav(!settingsNavOpen());});
    var backdrop = el('settings-nav-backdrop');
    if (backdrop) backdrop.addEventListener('click', function () {setSettingsNav(false);});
    var nav = document.querySelector('#config-screen .settings-nav');
    if (nav) {


      nav.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('.menu-item')) setSettingsNav(false);
      }, true);
    }
  }

  function initMobileNav(topbar) {
    var detailMenu = el('detail-menu-btn');
    if (detailMenu) detailMenu.addEventListener('click', openMenuFromDetail);
    var logo = topbar.querySelector('.section-title-header');
    if (logo) {
      logo.addEventListener('click', function () {setMobileNav(!mobileNavOpen());});
    }
    var backdrop = el('home-nav-backdrop');
    if (backdrop) backdrop.addEventListener('click', function () {setMobileNav(false);});




    window.addEventListener('keydown', function (e) {
      if (!mobileNavOpen() && !settingsNavOpen()) return;
      if (!BACK_KEYS[e.keyCode] && e.key !== 'Escape' && e.key !== 'GoBack') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setMobileNav(false);
      setSettingsNav(false);
    }, true);


    if (window.matchMedia) {
      var mq = window.matchMedia(MOBILE_NAV_QUERY);
      var onChange = function () {
        if (mq.matches) return;
        setMobileNav(false);
        setSettingsNav(false);
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);else
      if (mq.addListener) mq.addListener(onChange);
    }
    initSettingsNav();
  }

  function initHome() {
    var screen = el('content-home');
    if (!screen) {
      console.warn('🏠 #content-home не найден — главная не запускается');
      return;
    }

    var topbar = el('home-topbar');
    if (topbar) {


      topbar.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.home-nav-btn') : null;
        if (!btn) return;

        setMobileNav(false);
        onNavButton(btn.id, true);
      }, true);
      initMobileNav(topbar);
    }





    var detailView = el('detail-view');
    if (detailView) {
      detailView.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.home-nav-btn') : null;
        if (!btn) return;


        if (typeof window.detailTopbarNavigate === 'function') {
          window.detailTopbarNavigate(btn.id);
        }
      }, true);
    }

    var rows = el('home-rows');
    if (rows) rows.addEventListener('click', onHomeRowsClick);

    startTopbarClock();
    watchDetailForCover();
    patchGlobals();
    registerStrategy();
    initGestures();


    if (window.Nav) Nav.reset('home');
    showHome({ initial: true });
    console.log('🏠 Главная страница инициализирована');
  }

  window.HomeScreen = {
    show: showHome,
    isActive: isHomeVisible,
    isFocusable: isHomeFocusable,
    ensureFocus: ensureHomeFocus,
    restoreFocus: restoreHomeFocus,
    handleBack: handleHomeBack,
    refresh: refreshHome,
    layout: layoutHome,
    stopTrailer: suspendHero,
    uncover: uncoverHome,
    rearmTrailer: rearmHeroTrailer,
    removeHistoryItem: removeHistoryItem,
    state: homeState
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHome);
  } else {
    initHome();
  }
})();
