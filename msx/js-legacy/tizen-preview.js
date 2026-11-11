/* Сборка для старых браузеров (Chrome 53) из js/tizen-preview.js — tools/legacy-build/build.js. Руками не править. */
(function () {
  'use strict';

  if (!window.tizen || !tizen.application) return;
  var SERVICE_ID = 'TorrStrm01.preview';
  var PER_SECTION = 8;
  var IMG_SIZE = 'w185';
  var MIN_INTERVAL_MS = 10 * 60 * 1000;
  var REPEAT_MS = 12 * 60 * 60 * 1000;
  var CHECK_MS = 10 * 60 * 1000;
  var FIRST_DELAY_MS = 5000;
  var SENT_KEY = 'tsSmartHubPreview';
  var COLD_KEY = 'tsPreviewColdDone';
  var TORRENT_HASH = /^[0-9a-f]{40}$/;
  var SECTIONS = [{
    key: 'history',
    title: 'Продолжить просмотр',
    source: 'history'
  }, {
    key: 'my_torrents',
    title: 'Мои торренты',
    source: 'torrents'
  }, {
    key: 'trending_week',
    title: 'В тренде на этой неделе',
    source: 'tmdb'
  }, {
    key: 'popular_movies',
    title: 'Популярные фильмы',
    source: 'tmdb'
  }, {
    key: 'popular_tv',
    title: 'Популярные сериалы',
    source: 'tmdb'
  }];
  function log(msg) {
    try {
      console.log('📺 Smart Hub: ' + msg);
    } catch (e) {}
  }
  function serverUrl() {
    return window.SERVER_URL || window.location.origin;
  }
  function serviceSupported() {
    try {
      return !!(tizen.systeminfo && tizen.systeminfo.getCapability('http://tizen.org/feature/web.service'));
    } catch (e) {
      return false;
    }
  }
  function imageUrl(pathOrUrl) {
    if (!pathOrUrl) return '';
    var p = String(pathOrUrl);
    if (typeof window.getTmdbImageUrl === 'function') return window.getTmdbImageUrl(p, IMG_SIZE);
    return /^https?:\/\//i.test(p) ? p : '';
  }
  function yearOf(item) {
    var m = String(item && (item.release_date || item.first_air_date || item.year) || '').match(/(19|20)\d{2}/);
    return m ? m[0] : '';
  }
  function tile(sectionKey, card, poster, subtitle) {
    var img = imageUrl(poster);
    if (!img || !card.title) return null;
    var data = {
      s: sectionKey,
      id: card.id ? String(card.id) : '',
      media_type: card.media_type || 'movie',
      title: card.title
    };
    if (card.hash) data.hash = card.hash;
    if (poster && !/^https?:/i.test(poster)) data.poster = poster;
    var t = {
      title: card.title,
      image_ratio: '2by3',
      image_url: img,
      action_data: JSON.stringify(data),
      is_playable: false
    };
    if (subtitle) t.subtitle = subtitle;
    return t;
  }
  function typeLabel(mediaType) {
    return mediaType === 'tv' ? 'Сериал' : 'Фильм';
  }
  function historyTiles(key) {
    var hs = window.HomeScreen && HomeScreen.state;
    var items = hs && hs.data && hs.data.history || [];
    var out = [];
    for (var i = 0; i < items.length && out.length < PER_SECTION; i++) {
      var it = items[i];
      if (!it || it.id == null) continue;
      var title = it.title || it.name;
      var t = tile(key, {
        id: it.id,
        media_type: it.media_type,
        title: title
      }, it.poster_path, typeLabel(it.media_type));
      if (t) out.push(t);
    }
    return out;
  }
  function torrentPoster(t) {
    if (t.poster) return t.poster;
    try {
      var data = t.data ? JSON.parse(t.data) : null;
      var movie = data && data.movie;
      if (movie) return movie.img || movie.poster_path || '';
    } catch (e) {}
    return '';
  }
  function torrentTiles(key) {
    var list = window.AppState && AppState.torrents || [];
    list = list.slice().sort(function (a, b) {
      return (b.timestamp || 0) - (a.timestamp || 0);
    });
    var out = [];
    for (var i = 0; i < list.length && out.length < PER_SECTION; i++) {
      var t = list[i];
      var hash = String(t && t.hash || '').toLowerCase();
      if (!TORRENT_HASH.test(hash) || !t.title) continue;
      var mediaType = typeof window.getTorrentMediaTypeFromCard === 'function' ? window.getTorrentMediaTypeFromCard(t) : 'movie';
      var x = tile(key, {
        id: t.tmdbId || '',
        media_type: mediaType,
        title: t.title,
        hash: hash
      }, torrentPoster(t), typeLabel(mediaType));
      if (x) out.push(x);
    }
    return out;
  }
  function collectionItems(key) {
    var hs = window.HomeScreen && HomeScreen.state;
    var items = hs && hs.data && hs.data[key];
    if (items && items.length) return Promise.resolve(items);
    return fetch(serverUrl() + '/api/tmdb/collection?preset=' + encodeURIComponent(key)).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (d) {
      return d && d.success && d.items || [];
    })['catch'](function () {
      return [];
    });
  }
  function collectionTiles(key) {
    return collectionItems(key).then(function (items) {
      var out = [];
      for (var i = 0; i < items.length && out.length < PER_SECTION; i++) {
        var it = items[i];
        if (!it || it.id == null) continue;
        var title = it.title || it.name;
        var year = yearOf(it);
        var t = tile(key, {
          id: it.id,
          media_type: it.media_type,
          title: title
        }, it.poster_path, typeLabel(it.media_type) + (year ? ' · ' + year : ''));
        if (t) out.push(t);
      }
      return out;
    });
  }
  function buildPreview() {
    return Promise.all(SECTIONS.map(function (s) {
      if (s.source === 'history') return Promise.resolve(historyTiles(s.key));
      if (s.source === 'torrents') return Promise.resolve(torrentTiles(s.key));
      return collectionTiles(s.key);
    })).then(function (lists) {
      var sections = [];
      for (var i = 0; i < SECTIONS.length; i++) {
        if (lists[i] && lists[i].length) sections.push({
          title: SECTIONS[i].title,
          tiles: lists[i]
        });
      }
      return sections.length ? {
        sections: sections
      } : null;
    });
  }
  function hashOf(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = (h << 5) + h + s.charCodeAt(i) | 0;
    return String(h >>> 0) + ':' + s.length;
  }
  function readSent() {
    try {
      return JSON.parse(localStorage.getItem(SENT_KEY) || 'null') || {};
    } catch (e) {
      return {};
    }
  }
  function writeSent(h) {
    try {
      localStorage.setItem(SENT_KEY, JSON.stringify({
        h: h,
        at: Date.now()
      }));
    } catch (e) {}
  }
  function chunks(s, size) {
    var out = [];
    for (var i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
    return out;
  }
  function sendToService(json, h) {
    try {
      var ctrl = new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/pick', null, null, null, [new tizen.ApplicationControlData('caller', ['ForegroundApp']), new tizen.ApplicationControlData('preview', chunks(json, 4000))]);
      tizen.application.launchAppControl(ctrl, SERVICE_ID, function () {
        writeSent(h);
        log('карточки переданы службе (' + json.length + ' байт)');
      }, function (e) {
        log('служба не запустилась: ' + (e && e.message));
      });
    } catch (e) {
      log('служба не запустилась: ' + e.message);
    }
  }
  var updating = false,
    retryTimer = null;
  function update() {
    if (updating) return;
    if (window.AppState && AppState.currentScreen === 'player') return;
    updating = true;
    buildPreview().then(function (data) {
      updating = false;
      if (!data) return;
      var json = JSON.stringify(data);
      var h = hashOf(json);
      var sent = readSent();
      var since = Date.now() - (sent.at || 0);
      if (sent.h === h && since < REPEAT_MS) return;
      if (since < MIN_INTERVAL_MS) {
        if (!retryTimer) retryTimer = setTimeout(function () {
          retryTimer = null;
          update();
        }, MIN_INTERVAL_MS - since + 1000);
        return;
      }
      sendToService(json, h);
    }, function (e) {
      updating = false;
      log('не собрал карточки: ' + (e && e.message));
    });
  }
  function startWhenReady() {
    var tries = 0;
    (function wait() {
      var hs = window.HomeScreen && HomeScreen.state;
      var homeReady = hs && hs.built;
      var torrentsReady = window.AppState && (AppState.torrentsLoaded || !AppState.torrentsLoading);
      if ((!homeReady || !torrentsReady) && ++tries < 60) {
        setTimeout(wait, 1000);
        return;
      }
      setTimeout(update, FIRST_DELAY_MS);
      setInterval(update, CHECK_MS);
    })();
  }
  function payloadCard() {
    try {
      var req = tizen.application.getCurrentApplication().getRequestedAppControl();
      var data = req && req.appControl && req.appControl.data || [];
      for (var i = 0; i < data.length; i++) {
        if (data[i].key !== 'PAYLOAD' || !data[i].value || !data[i].value.length) continue;
        var values = JSON.parse(data[i].value[0]).values;
        return typeof values === 'string' ? JSON.parse(values) : values;
      }
    } catch (e) {
      log('PAYLOAD: ' + e.message);
    }
    return null;
  }
  function openCard(raw) {
    if (!raw) return;
    var c = {
      id: raw.id ? String(raw.id) : '',
      hash: TORRENT_HASH.test(String(raw.hash || '').toLowerCase()) ? String(raw.hash).toLowerCase() : '',
      media_type: raw.media_type === 'tv' ? 'tv' : 'movie',
      title: String(raw.title || ''),
      poster: raw.poster ? String(raw.poster) : null
    };
    if (!c.id && !c.hash) return;
    log('открываю ' + c.title);
    var readyTries = 0,
      rowsTries = 0,
      listTries = 0,
      playerTries = 0;
    function ready() {
      return window.HomeScreen && window.Nav && window.AppState && typeof window.showCatalogDetail === 'function' && (!c.hash || typeof window.showDetail === 'function');
    }
    function findTorrent() {
      var l = AppState.torrents || [];
      for (var i = 0; i < l.length; i++) if (l[i].hash && l[i].hash.toLowerCase() === c.hash) return l[i];
      return null;
    }
    function openTmdb() {
      if (!c.id) return;
      var item = {
        id: c.id,
        media_type: c.media_type,
        title: c.title,
        name: c.title,
        poster_path: c.poster,
        torrent: [{
          name: c.title
        }]
      };
      Nav.push('detail', Nav.detailData(item, 0));
      AppState.catalogIndex = 0;
      AppState.androidBackCatalog = item;
      AppState.catalogPu = null;
      AppState.openInRow = true;
      window.showCatalogDetail(item, 0, null);
    }
    function open() {
      if (!ready()) {
        if (++readyTries < 150) setTimeout(open, 200);
        return;
      }
      if (AppState.currentScreen === 'player') {
        if (playerTries++ === 0 && typeof window.showDetailView === 'function') window.showDetailView();
        if (playerTries < 25) {
          setTimeout(open, 200);
          return;
        }
      }
      var st = HomeScreen.state;
      if (st && !st.built && ++rowsTries < 75) {
        setTimeout(open, 200);
        return;
      }
      if (c.hash && !AppState.torrentsLoaded && ++listTries < 75) {
        setTimeout(open, 200);
        return;
      }
      try {
        if (AppState.currentScreen === 'search' && typeof window.hideSearchResults === 'function') {
          window.hideSearchResults({
            returnTo: 'home'
          });
        }
      } catch (e) {}
      if (AppState.currentScreen !== 'home' && AppState.currentScreen !== 'detail') HomeScreen.show({
        restoreFocus: false
      });
      Nav.reset('home');
      if (typeof HomeScreen.stopTrailer === 'function') HomeScreen.stopTrailer();
      if (window.Screensaver && typeof Screensaver.hide === 'function') Screensaver.hide();
      if (!c.hash) return openTmdb();
      var t = findTorrent();
      if (t) return window.showDetail(t);
      if (typeof window.refreshTorrentsList !== 'function') return openTmdb();
      window.refreshTorrentsList().then(function () {
        var t2 = findTorrent();
        if (t2) window.showDetail(t2);else openTmdb();
      }, openTmdb);
    }
    open();
  }
  window.addEventListener('appcontrol', function () {
    openCard(payloadCard());
  });
  var cold = false;
  try {
    cold = !sessionStorage.getItem(COLD_KEY);
    sessionStorage.setItem(COLD_KEY, '1');
  } catch (e) {}
  if (cold) openCard(payloadCard());
  if (serviceSupported()) startWhenReady();else log('веб-службы на этом ТВ нет — карточки не публикуем');
  window.TizenPreview = {
    update: update,
    build: buildPreview,
    open: openCard
  };
})();
