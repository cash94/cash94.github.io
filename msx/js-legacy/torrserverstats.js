/* Сборка для старых браузеров (Chrome 53) из js/torrserverstats.js — tools/legacy-build/build.js. Руками не править. */
function asyncGeneratorStep(n, t, e, r, o, a, c) { try { var i = n[a](c), u = i.value; } catch (n) { return void e(n); } i.done ? t(u) : Promise.resolve(u).then(r, o); }
function _asyncToGenerator(n) { return function () { var t = this, e = arguments; return new Promise(function (r, o) { var a = n.apply(t, e); function _next(n) { asyncGeneratorStep(a, r, o, _next, _throw, "next", n); } function _throw(n) { asyncGeneratorStep(a, r, o, _next, _throw, "throw", n); } _next(void 0); }); }; }
var torrentStatsCache = {
  preloaded: 0,
  preloadSize: 0,
  downloadSpeed: 0,
  percent: 0,
  activePeers: 0,
  totalPeers: 0,
  connectedSeeders: 0
};
function fetchTorrentStatsForBuffer(_x) {
  return _fetchTorrentStatsForBuffer.apply(this, arguments);
}
function _fetchTorrentStatsForBuffer() {
  _fetchTorrentStatsForBuffer = _asyncToGenerator(function* (hash) {
    if (!hash || !AppState.currentTorrserverUrl) return null;
    try {
      var statsUrl = AppState.currentTorrserverUrl + '/cache';
      var headers = {
        'Content-Type': 'application/json'
      };
      var authHeaders = getAuthHeaders();
      for (var key in authHeaders) {
        if (authHeaders.hasOwnProperty(key)) {
          headers[key] = authHeaders[key];
        }
      }
      var response = yield fetch(statsUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          action: 'get',
          hash: hash.toLowerCase()
        })
      });
      if (response.ok) {
        var data = yield response.json();
        var torrent = data.Torrent || data;
        if (torrent) {
          var torrentData = {
            preloaded_bytes: torrent.preloaded_bytes || 0,
            preload_size: torrent.torrent_size || torrent.preload_size || 1,
            download_speed: torrent.download_speed || 0,
            active_peers: torrent.active_peers || 0,
            total_peers: torrent.total_peers || 0,
            connected_seeders: torrent.connected_seeders || 0,
            percent: torrent.torrent_size ? Math.floor((torrent.preloaded_bytes || 0) * 100 / torrent.torrent_size) : 0
          };
          return torrentData;
        }
      }
      return null;
    } catch (error) {
      console.log('⚠️ Ошибка получения статистики TorrServer:', error);
      return null;
    }
  });
  return _fetchTorrentStatsForBuffer.apply(this, arguments);
}
function updateTorrentStatsCache() {
  return _updateTorrentStatsCache.apply(this, arguments);
}
function _updateTorrentStatsCache() {
  _updateTorrentStatsCache = _asyncToGenerator(function* () {
    if (!currentTimecodeData.hash) {
      torrentStatsCache = {
        preloaded: 0,
        preloadSize: 0,
        downloadSpeed: 0,
        percent: 0,
        activePeers: 0,
        totalPeers: 0,
        connectedSeeders: 0
      };
      return;
    }
    var stats = yield fetchTorrentStatsForBuffer(currentTimecodeData.hash);
    if (stats) {
      torrentStatsCache.preloaded = stats.preloaded_bytes || 0;
      torrentStatsCache.preloadSize = stats.preload_size || 1;
      torrentStatsCache.downloadSpeed = stats.download_speed || 0;
      torrentStatsCache.percent = stats.percent;
      torrentStatsCache.activePeers = stats.active_peers || 0;
      torrentStatsCache.totalPeers = stats.total_peers || 0;
      torrentStatsCache.connectedSeeders = stats.connected_seeders || 0;
    }
  });
  return _updateTorrentStatsCache.apply(this, arguments);
}
function formatSpeed(speedInBytes) {
  if (speedInBytes === 0 || !speedInBytes) return '0 Mb/s';
  var speedInMegabits = speedInBytes * 8 / 1000000;
  if (speedInMegabits < 1) {
    var speedInKilobits = speedInBytes * 8 / 1000;
    return speedInKilobits.toFixed(1) + ' Kb/s';
  }
  return speedInMegabits.toFixed(1) + ' Mb/s';
}
function formatSize(bytes) {
  if (bytes === 0 || !bytes) return '0 B';
  if (bytes < 1024) return bytes.toFixed(0) + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}
var TORRENT_STATS_VISIBLE_MS = 1000;
var TORRENT_STATS_HIDDEN_MS = 10000;
var torrentStatsTimer = null;
var torrentStatsRunning = false;
var torrentStatsInFlight = false;
var torrentStatsLastAt = 0;
var torrentStatsObserver = null;
var torrentStatsWasVisible = false;
function isTorrentStatsVisible() {
  if (typeof AppState !== 'undefined' && AppState.bufferHidden) return false;
  var controls = getEl('controls-container');
  return !!controls && !controls.classList.contains('idle-hidden');
}
function scheduleTorrentStats(delay) {
  if (torrentStatsTimer) clearTimeout(torrentStatsTimer);
  torrentStatsTimer = setTimeout(torrentStatsTick, delay);
}
function torrentStatsTick() {
  torrentStatsTimer = null;
  if (!torrentStatsRunning || torrentStatsInFlight) return;
  torrentStatsInFlight = true;
  torrentStatsLastAt = Date.now();
  var done = function () {
    torrentStatsInFlight = false;
    if (!torrentStatsRunning) return;
    scheduleTorrentStats(isTorrentStatsVisible() ? TORRENT_STATS_VISIBLE_MS : TORRENT_STATS_HIDDEN_MS);
  };
  updateTorrentStatsCache().then(done, done);
}
function refreshTorrentStatsCadence() {
  if (!torrentStatsRunning) return;
  var visible = isTorrentStatsVisible();
  var becameVisible = visible && !torrentStatsWasVisible;
  torrentStatsWasVisible = visible;
  if (!becameVisible || torrentStatsInFlight) return;
  var sinceLast = Date.now() - torrentStatsLastAt;
  scheduleTorrentStats(sinceLast >= TORRENT_STATS_VISIBLE_MS ? 0 : TORRENT_STATS_VISIBLE_MS - sinceLast);
}
function watchTorrentStatsVisibility() {
  if (torrentStatsObserver || typeof MutationObserver !== 'function') return;
  var controls = getEl('controls-container');
  if (!controls) return;
  torrentStatsObserver = new MutationObserver(refreshTorrentStatsCadence);
  torrentStatsObserver.observe(controls, {
    attributes: true,
    attributeFilter: ['class']
  });
}
function startTorrentStatsUpdates() {
  stopTorrentStatsUpdates();
  console.log('📊 Запуск опроса статистики TorrServer');
  torrentStatsRunning = true;
  torrentStatsWasVisible = isTorrentStatsVisible();
  watchTorrentStatsVisibility();
  scheduleTorrentStats(0);
}
function stopTorrentStatsUpdates() {
  var wasRunning = torrentStatsRunning;
  torrentStatsRunning = false;
  if (torrentStatsTimer) {
    clearTimeout(torrentStatsTimer);
    torrentStatsTimer = null;
  }
  if (torrentStatsObserver) {
    torrentStatsObserver.disconnect();
    torrentStatsObserver = null;
  }
  if (wasRunning) console.log('📊 Остановлен опрос статистики TorrServer');
}
var PRELOAD_TARGET_BYTES = 32 * 1024 * 1024;
var PRELOAD_POLL_MS = 1000;
var PRELOAD_PROBE_AFTER_BYTES = 4 * 1024 * 1024;
function preloadWantsProbe() {
  return !window.AndroidJS && !AppState.transcodingOnOff && !AppState.transcodingFullOnOff;
}
function startPreloadProbe(state) {
  if (state.probeStarted || !preloadWantsProbe()) return;
  state.probeStarted = true;
  var clientId = null;
  try {
    clientId = localStorage.getItem('clientId');
  } catch (e) {}
  var url = SERVER_URL + '/api/file/info?hash=' + state.hash + '&fileId=' + state.fileId + (clientId ? '&clientId=' + encodeURIComponent(clientId) : '');
  console.log('🔎 Проба файла во время предзагрузки');
  if (typeof fetchWithTimeout === 'function') {
    fetchWithTimeout(url, null, typeof FILE_INFO_FETCH_TIMEOUT_MS === 'number' ? FILE_INFO_FETCH_TIMEOUT_MS : 60000)['catch'](function () {});
  } else {
    fetch(url)['catch'](function () {});
  }
}
var activePlaybackPreload = null;
var preloadSwallowKeyup = false;
var preloadPanelEls = null;
function getPreloadPanel() {
  if (preloadPanelEls) return preloadPanelEls;
  var root = document.createElement('div');
  root.id = 'preload-panel';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-live', 'polite');
  root.innerHTML = '<img class="preload-backdrop hidden" alt="">' + '<div class="preload-shade"></div>' + '<div class="preload-mark"><div class="preload-mark-bg"></div><div class="preload-mark-fill"></div></div>' + '<div class="preload-status">' + '<span class="preload-peers hidden"><svg class="preload-peers-icon" viewBox="0 0 24 24" aria-hidden="true">' + '<path d="M12 3v12m0 0 5-5m-5 5-5-5M5 19h14"></path></svg><span class="preload-peers-value"></span></span>' + '<span class="preload-sep preload-sep-peers hidden"></span>' + '<span class="preload-speed hidden"></span>' + '<span class="preload-sep preload-sep-speed hidden"></span>' + '<span class="preload-percent">0%</span>' + '</div>' + '<div class="preload-hint">' + '<button type="button" class="preload-btn" data-action="cancel"><span class="preload-key">←</span>Отменить</button>' + '<button type="button" class="preload-btn" data-action="play"><span class="preload-key">ОК</span>Смотреть сейчас</button>' + '</div>';
  var webs = buildPreloadSpiders(root);
  document.body.appendChild(root);
  root.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.preload-btn') : null;
    if (!btn || !activePlaybackPreload) return;
    finishPlaybackPreload(activePlaybackPreload, btn.getAttribute('data-action') === 'play');
  });
  preloadPanelEls = {
    root: root,
    backdrop: root.querySelector('.preload-backdrop'),
    markBg: root.querySelector('.preload-mark-bg'),
    fill: root.querySelector('.preload-mark-fill'),
    peers: root.querySelector('.preload-peers'),
    peersValue: root.querySelector('.preload-peers-value'),
    sepPeers: root.querySelector('.preload-sep-peers'),
    speed: root.querySelector('.preload-speed'),
    sepSpeed: root.querySelector('.preload-sep-speed'),
    percent: root.querySelector('.preload-percent'),
    webs: webs
  };
  return preloadPanelEls;
}
var PRELOAD_SPIDER_SPOTS = [[0.05, 56, 0], [0.14, 38, 0.18], [0.24, 48, 0.08], [0.35, 26, 0.26], [0.65, 22, 0.12], [0.76, 44, 0.22], [0.86, 34, 0.04], [0.95, 60, 0.15]];
var PRELOAD_SPIDER_H = 5;
function buildPreloadSpiders(root) {
  if (typeof isSeasonActive !== 'function' || !isSeasonActive('halloween')) return null;
  var layer = document.createElement('div');
  layer.className = 'preload-webs';
  var list = [];
  for (var i = 0; i < PRELOAD_SPIDER_SPOTS.length; i++) {
    var spot = PRELOAD_SPIDER_SPOTS[i];
    var web = document.createElement('div');
    web.className = 'preload-web';
    web.style.left = spot[0] * 100 + '%';
    var thread = document.createElement('div');
    thread.className = 'preload-thread';
    thread.style.height = spot[1] + 'vh';
    var spider = document.createElement('div');
    spider.className = 'preload-spider';
    var img = document.createElement('div');
    img.className = 'preload-spider-img';
    img.style.webkitAnimationDelay = img.style.animationDelay = -i * 0.45 + 's';
    spider.appendChild(img);
    web.appendChild(thread);
    web.appendChild(spider);
    layer.appendChild(web);
    list.push({
      thread: thread,
      spider: spider,
      len: spot[1],
      lag: spot[2]
    });
  }
  root.insertBefore(layer, root.querySelector('.preload-mark'));
  return {
    layer: layer,
    list: list
  };
}
function setPreloadSpiders(fraction, instant) {
  var webs = preloadPanelEls && preloadPanelEls.webs;
  if (!webs) return;
  if (instant) webs.layer.classList.add('preload-webs-instant');
  for (var i = 0; i < webs.list.length; i++) {
    var w = webs.list[i];
    var k = Math.max(0, Math.min(1, (fraction - w.lag) / (1 - w.lag)));
    var y = -PRELOAD_SPIDER_H + k * (w.len + PRELOAD_SPIDER_H);
    var ts = 'scaleY(' + (Math.max(0, y + 0.6) / w.len).toFixed(4) + ')';
    w.thread.style.webkitTransform = ts;
    w.thread.style.transform = ts;
    var t = 'translateY(' + y.toFixed(2) + 'vh)';
    w.spider.style.webkitTransform = t;
    w.spider.style.transform = t;
  }
  if (instant) {
    void webs.layer.offsetWidth;
    webs.layer.classList.remove('preload-webs-instant');
  }
}
function formatPreloadMb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}
function preloadMarkContent(logoUrl, title) {
  var box = document.createElement('div');
  box.className = 'preload-mark-content';
  if (logoUrl) {
    var img = document.createElement('img');
    img.className = 'preload-logo';
    img.alt = '';
    img.src = logoUrl;
    box.appendChild(img);
  } else {
    var text = document.createElement('div');
    text.className = 'preload-title-text';
    text.textContent = title || '';
    box.appendChild(text);
  }
  return box;
}
function setPreloadMark(logoUrl, title) {
  var els = getPreloadPanel();
  els.markBg.innerHTML = '';
  els.fill.innerHTML = '';
  els.markBg.appendChild(preloadMarkContent(logoUrl, title));
  els.fill.appendChild(preloadMarkContent(logoUrl, title));
}
function preloadTmdbRef() {
  var item = AppState.currentDetailItem || null;
  var id = null,
    type = null;
  if (item) {
    id = item.tmdbId || item.knownTmdbId || null;
    if (!id) {
      var m = String(item.title || item.name || '').match(/\[(\d+)\]/);
      if (m) id = m[1];
    }
    if (!id && !item.hash) id = item.id || null;
    type = item.media_type || item.mediaType || item.knownMediaType || null;
  }
  if (!id && AppState.pendingDetailTmdbId) {
    id = AppState.pendingDetailTmdbId;
    type = AppState.pendingDetailMediaType || type;
    item = AppState.pendingDetailItem || item;
  }
  if (!id) return null;
  return {
    id: id,
    type: type === 'tv' ? 'tv' : 'movie',
    item: item
  };
}
var preloadMediaGen = 0;
function setPreloadMedia(state, title) {
  var els = getPreloadPanel();
  var gen = ++preloadMediaGen;
  var current = function () {
    return gen === preloadMediaGen && els.root.classList.contains('active');
  };
  els.backdrop.classList.add('hidden');
  els.backdrop.removeAttribute('src');
  setPreloadMark(null, title);
  var ref = preloadTmdbRef();
  if (!ref || typeof getTmdbDetailsWithCache !== 'function') return;
  var item = ref.item || {};
  var tmdbId = ref.id,
    mediaType = ref.type;
  var image = function (path, size) {
    return typeof getTmdbImageUrl === 'function' ? getTmdbImageUrl(path, size) : path;
  };
  Promise.resolve(getTmdbDetailsWithCache(tmdbId, mediaType)).then(function (details) {
    if (!current() || !details) return;
    var name = title || details.title || details.name || '';
    if (!title && name) setPreloadMark(null, name);
    var backdropPath = details.backdrop_path || item.backdrop_path;
    if (backdropPath) {
      els.backdrop.onload = function () {
        if (current()) els.backdrop.classList.remove('hidden');
      };
      els.backdrop.onerror = function () {
        els.backdrop.classList.add('hidden');
      };
      els.backdrop.src = image(backdropPath, 'w1280');
    }
    var logoPath = details.logo && details.logo.file_path;
    if (logoPath) {
      var probe = new Image();
      probe.onload = function () {
        if (current()) setPreloadMark(probe.src, name);
      };
      probe.src = image(logoPath, 'w500');
    }
  })['catch'](function () {});
}
function renderPlaybackPreload(state) {
  var els = getPreloadPanel();
  var stats = state.stats;
  var loaded = Math.min(state.loaded, PRELOAD_TARGET_BYTES);
  var progress = loaded * 100 / PRELOAD_TARGET_BYTES;
  els.fill.style.width = progress.toFixed(1) + '%';
  els.percent.textContent = Math.round(progress) + '%';
  setPreloadSpiders(progress / 100);
  var showPeers = !!stats;
  els.peers.classList.toggle('hidden', !showPeers);
  els.sepPeers.classList.toggle('hidden', !showPeers);
  els.peersValue.textContent = showPeers ? (stats.active_peers || 0) + ' / ' + (stats.total_peers || 0) : '';
  var speed = state.error || (stats ? formatSpeed(stats.download_speed) : '');
  els.speed.textContent = speed;
  els.speed.classList.toggle('hidden', !speed);
  els.sepSpeed.classList.toggle('hidden', !speed);
}
function schedulePlaybackPreloadTick(state, delay) {
  state.timer = setTimeout(function () {
    playbackPreloadTick(state);
  }, delay);
}
function playbackPreloadTick(state) {
  state.timer = null;
  if (activePlaybackPreload !== state) return;
  fetchTorrentStatsForBuffer(state.hash).then(function (stats) {
    if (activePlaybackPreload !== state) return;
    if (stats) {
      state.stats = stats;
      state.loaded = Math.max(state.loaded, stats.preloaded_bytes || 0);
    }
    if (state.loaded >= PRELOAD_PROBE_AFTER_BYTES) startPreloadProbe(state);
    renderPlaybackPreload(state);
    if (state.loaded >= PRELOAD_TARGET_BYTES) {
      finishPlaybackPreload(state, true);
      return;
    }
    schedulePlaybackPreloadTick(state, PRELOAD_POLL_MS);
  });
}
function finishPlaybackPreload(state, play) {
  if (activePlaybackPreload !== state) return;
  activePlaybackPreload = null;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  if (play && preloadHoldsUntilPlaying()) holdPreloadScreen();else if (play) holdPreloadUntilHidden();else releasePreloadScreen(true);
  if (!play) {
    if (state.controller) {
      try {
        state.controller.abort();
      } catch (e) {}
    }
    if (typeof preloadedFilesAt !== 'undefined') delete preloadedFilesAt[state.key];
    if (typeof dropTorrentToServer === 'function') {
      dropTorrentToServer(state.hash)['catch'](function () {});
    }
    console.log('⏹️ Предзагрузка отменена');
  } else {
    console.log('▶️ Предзагрузка завершена: ' + formatPreloadMb(state.loaded) + ' МБ');
  }
  state.resolve(play);
}
var PRELOAD_HOLD_MAX_MS = 45000;
var PRELOAD_FADE_MS = 300;
var preloadHold = null;
function preloadHoldsUntilPlaying() {
  if (window.AndroidJS) return false;
  var apple = typeof getApplePlayer === 'function' ? getApplePlayer() : null;
  return !(apple && apple.template);
}
function holdPreloadScreen() {
  var els = getPreloadPanel();
  els.fill.style.width = '100%';
  els.percent.textContent = '100%';
  setPreloadSpiders(1);
  els.root.classList.add('preload-holding');
  var video = document.getElementById('video-player');
  var onPlaying = function () {
    if (!preloadHold) return;
    preloadHold.played = true;
    if (!playerOverlaysBusy()) releasePreloadScreen(false);
  };
  if (preloadHold) releasePreloadScreen(true);
  preloadHold = {
    video: video,
    onPlaying: onPlaying,
    timer: setTimeout(function () {
      releasePreloadScreen(false);
    }, PRELOAD_HOLD_MAX_MS),
    seenPlayer: false,
    played: false,
    watch: setInterval(function () {
      if (!preloadHold) return;
      if (AppState.currentScreen === 'player') preloadHold.seenPlayer = true;else if (preloadHold.seenPlayer) {
        releasePreloadScreen(true);
        return;
      }
      if (preloadHold.played && !playerOverlaysBusy()) releasePreloadScreen(false);
    }, 300)
  };
  if (video) video.addEventListener('playing', onPlaying);
}
var PRELOAD_EXTERNAL_HOLD_MS = 5000;
function holdPreloadUntilHidden() {
  var els = getPreloadPanel();
  els.fill.style.width = '100%';
  els.percent.textContent = '100%';
  setPreloadSpiders(1);
  els.root.classList.add('preload-holding');
  if (preloadHold) releasePreloadScreen(true);
  var onHide = function (e) {
    if (e.type === 'pagehide' || document.hidden) releasePreloadScreen(true);
  };
  preloadHold = {
    onHide: onHide,
    timer: setTimeout(function () {
      releasePreloadScreen(false);
    }, PRELOAD_EXTERNAL_HOLD_MS)
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);
}
function playerOverlaysBusy() {
  var po = document.getElementById('playback-overlay');
  var lo = document.getElementById('loading-player-overlay');
  return !!(po && po.classList.contains('active') || lo && lo.classList.contains('active'));
}
function releasePreloadScreen(immediate) {
  var els = preloadPanelEls;
  if (preloadHold) {
    clearTimeout(preloadHold.timer);
    clearInterval(preloadHold.watch);
    if (preloadHold.video) preloadHold.video.removeEventListener('playing', preloadHold.onPlaying);
    if (preloadHold.onHide) {
      document.removeEventListener('visibilitychange', preloadHold.onHide);
      window.removeEventListener('pagehide', preloadHold.onHide);
    }
    preloadHold = null;
  }
  if (!els || activePlaybackPreload) return;
  clearTimeout(els.fadeTimer);
  els.root.classList.remove('preload-holding');
  if (immediate || !els.root.classList.contains('active')) {
    els.root.classList.remove('active', 'preload-leaving');
    return;
  }
  els.root.classList.add('preload-leaving');
  els.fadeTimer = setTimeout(function () {
    els.root.classList.remove('active', 'preload-leaving');
  }, PRELOAD_FADE_MS);
}
window.releasePreloadScreen = releasePreloadScreen;
function onPlaybackPreloadKeyDown(e) {
  if (!activePlaybackPreload) return;
  var kc = e.keyCode || e.which;
  e.preventDefault();
  e.stopImmediatePropagation();
  var isBack = e.key === 'Escape' || (typeof isBackKey === 'function' ? isBackKey(kc) : kc === 27 || kc === 8);
  if (isBack) {
    finishPlaybackPreload(activePlaybackPreload, false);
    return;
  }
  if (typeof isOkKey === 'function' ? isOkKey(kc) : kc === 13) {
    preloadSwallowKeyup = true;
    finishPlaybackPreload(activePlaybackPreload, true);
  }
}
function onPlaybackPreloadKeyUp(e) {
  if (!activePlaybackPreload && !preloadSwallowKeyup) return;
  preloadSwallowKeyup = false;
  e.preventDefault();
  e.stopImmediatePropagation();
}
window.addEventListener('keydown', onPlaybackPreloadKeyDown, true);
window.addEventListener('keyup', onPlaybackPreloadKeyUp, true);
function runPlaybackPreload(hash, fileId, title) {
  if (activePlaybackPreload) finishPlaybackPreload(activePlaybackPreload, false);
  return new Promise(function (resolve) {
    var state = {
      hash: hash,
      fileId: fileId,
      key: String(hash).toLowerCase() + ':' + fileId,
      resolve: resolve,
      timer: null,
      controller: typeof AbortController === 'function' ? new AbortController() : null,
      stats: null,
      loaded: 0,
      error: '',
      probeStarted: false
    };
    activePlaybackPreload = state;
    var els = getPreloadPanel();
    releasePreloadScreen(true);
    setPreloadMedia(state, title);
    els.fill.style.transition = 'none';
    setPreloadSpiders(0, true);
    renderPlaybackPreload(state);
    void els.fill.offsetWidth;
    els.fill.style.transition = '';
    els.root.classList.add('active');
    if (typeof abortPendingPreload === 'function') abortPendingPreload();
    if (typeof wasPreloadedRecently === 'function') wasPreloadedRecently(hash, fileId);
    var url = AppState.currentTorrserverUrl + '/stream?link=' + hash + '&index=' + fileId + '&preload=preload';
    var options = {
      method: 'GET',
      headers: getAuthHeaders()
    };
    if (state.controller) options.signal = state.controller.signal;
    fetch(url, options).then(function (response) {
      if (activePlaybackPreload !== state) return;
      if (response.ok) {
        state.loaded = Math.max(state.loaded, PRELOAD_TARGET_BYTES);
        renderPlaybackPreload(state);
        finishPlaybackPreload(state, true);
      } else {
        state.error = 'TorrServer ответил ' + response.status;
        renderPlaybackPreload(state);
      }
    }, function (error) {
      if (activePlaybackPreload !== state || error && error.name === 'AbortError') return;
      state.error = 'Нет ответа от TorrServer';
      renderPlaybackPreload(state);
    });
    schedulePlaybackPreloadTick(state, 0);
  });
}
function isPlaybackPreloadActive() {
  return !!activePlaybackPreload;
}
window.fetchTorrentStatsForBuffer = fetchTorrentStatsForBuffer;
window.updateTorrentStatsCache = updateTorrentStatsCache;
window.formatSpeed = formatSpeed;
window.formatSize = formatSize;
window.startTorrentStatsUpdates = startTorrentStatsUpdates;
window.stopTorrentStatsUpdates = stopTorrentStatsUpdates;
window.torrentStatsCache = torrentStatsCache;
window.refreshTorrentStatsCadence = refreshTorrentStatsCadence;
window.runPlaybackPreload = runPlaybackPreload;
window.isPlaybackPreloadActive = isPlaybackPreloadActive;
