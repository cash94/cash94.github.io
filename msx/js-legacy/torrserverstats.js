/* Сборка для старых браузеров (Chrome 53) из js/torrserverstats.js — tools/legacy-build/build.js. Руками не править. */
function asyncGeneratorStep(n, t, e, r, o, a, c) {try {var i = n[a](c),u = i.value;} catch (n) {return void e(n);}i.done ? t(u) : Promise.resolve(u).then(r, o);}function _asyncToGenerator(n) {return function () {var t = this,e = arguments;return new Promise(function (r, o) {var a = n.apply(t, e);function _next(n) {asyncGeneratorStep(a, r, o, _next, _throw, "next", n);}function _throw(n) {asyncGeneratorStep(a, r, o, _next, _throw, "throw", n);}_next(void 0);});};}


var torrentStatsCache = {
  preloaded: 0,
  preloadSize: 0,
  downloadSpeed: 0,
  percent: 0,
  activePeers: 0,
  totalPeers: 0,
  connectedSeeders: 0
};function


fetchTorrentStatsForBuffer(_x) {return _fetchTorrentStatsForBuffer.apply(this, arguments);}function _fetchTorrentStatsForBuffer() {_fetchTorrentStatsForBuffer = _asyncToGenerator(function* (hash) {
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
            percent: torrent.torrent_size ?
            Math.floor((torrent.preloaded_bytes || 0) * 100 / torrent.torrent_size) :
            0
          };

          return torrentData;
        }
      }
      return null;
    } catch (error) {
      console.log('⚠️ Ошибка получения статистики TorrServer:', error);
      return null;
    }
  });return _fetchTorrentStatsForBuffer.apply(this, arguments);}function


updateTorrentStatsCache() {return _updateTorrentStatsCache.apply(this, arguments);}function _updateTorrentStatsCache() {_updateTorrentStatsCache = _asyncToGenerator(function* () {
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
  });return _updateTorrentStatsCache.apply(this, arguments);}


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
  torrentStatsObserver.observe(controls, { attributes: true, attributeFilter: ['class'] });
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
  try {clientId = localStorage.getItem('clientId');} catch (e) {}
  var url = SERVER_URL + '/api/file/info?hash=' + state.hash + '&fileId=' + state.fileId + (
  clientId ? '&clientId=' + encodeURIComponent(clientId) : '');
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
  root.innerHTML =
  '<div class="preload-card" role="dialog" aria-live="polite">' +
  '<div class="preload-eyebrow">TorrServer</div>' +
  '<div class="preload-title">Предзагрузка</div>' +
  '<div class="preload-name"></div>' +
  '<div class="preload-bar"><div class="preload-bar-fill"></div></div>' +
  '<div class="preload-amount"><span class="preload-bytes"></span><span class="preload-status"></span></div>' +
  '<div class="preload-stats">' +
  '<div class="preload-stat"><div class="preload-stat-label">Скорость</div><div class="preload-stat-value" data-stat="speed">—</div></div>' +
  '<div class="preload-stat"><div class="preload-stat-label">Пиры</div><div class="preload-stat-value" data-stat="peers">—</div></div>' +
  '<div class="preload-stat"><div class="preload-stat-label">Сиды</div><div class="preload-stat-value" data-stat="seeds">—</div></div>' +
  '</div>' +
  '<div class="preload-actions">' +
  '<button type="button" class="preload-btn" data-action="cancel"><span class="preload-key">←</span>Отменить</button>' +
  '<button type="button" class="preload-btn preload-btn-primary" data-action="play"><span class="preload-key">ОК</span>Смотреть сейчас</button>' +
  '</div>' +
  '</div>';
  document.body.appendChild(root);

  root.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.preload-btn') : null;
    if (!btn || !activePlaybackPreload) return;
    finishPlaybackPreload(activePlaybackPreload, btn.getAttribute('data-action') === 'play');
  });
  preloadPanelEls = {
    root: root,
    name: root.querySelector('.preload-name'),
    fill: root.querySelector('.preload-bar-fill'),
    bytes: root.querySelector('.preload-bytes'),
    status: root.querySelector('.preload-status'),
    speed: root.querySelector('[data-stat="speed"]'),
    peers: root.querySelector('[data-stat="peers"]'),
    seeds: root.querySelector('[data-stat="seeds"]')
  };
  return preloadPanelEls;
}

function formatPreloadMb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function renderPlaybackPreload(state) {
  var els = getPreloadPanel();
  var stats = state.stats;
  var loaded = Math.min(state.loaded, PRELOAD_TARGET_BYTES);
  els.fill.style.width = (loaded * 100 / PRELOAD_TARGET_BYTES).toFixed(1) + '%';
  els.bytes.textContent = formatPreloadMb(loaded) + ' / ' + formatPreloadMb(PRELOAD_TARGET_BYTES) + ' МБ';
  els.status.textContent = state.error || (stats ? '' : 'Подключение к раздаче…');
  els.speed.textContent = stats ? formatSpeed(stats.download_speed) : '—';
  els.peers.textContent = stats ? stats.active_peers + ' / ' + stats.total_peers : '—';
  els.seeds.textContent = stats ? String(stats.connected_seeders) : '—';
}

function schedulePlaybackPreloadTick(state, delay) {
  state.timer = setTimeout(function () {playbackPreloadTick(state);}, delay);
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
    if (state.loaded >= PRELOAD_TARGET_BYTES) {finishPlaybackPreload(state, true);return;}
    schedulePlaybackPreloadTick(state, PRELOAD_POLL_MS);
  });
}






function finishPlaybackPreload(state, play) {
  if (activePlaybackPreload !== state) return;
  activePlaybackPreload = null;
  if (state.timer) {clearTimeout(state.timer);state.timer = null;}
  getPreloadPanel().root.classList.remove('active');
  if (!play) {
    if (state.controller) {try {state.controller.abort();} catch (e) {}}


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

function onPlaybackPreloadKeyDown(e) {
  if (!activePlaybackPreload) return;
  var kc = e.keyCode || e.which;
  e.preventDefault();
  e.stopImmediatePropagation();
  var isBack = e.key === 'Escape' || (typeof isBackKey === 'function' ? isBackKey(kc) : kc === 27 || kc === 8);
  if (isBack) {finishPlaybackPreload(activePlaybackPreload, false);return;}
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
    els.name.textContent = title || '';

    els.fill.style.transition = 'none';
    renderPlaybackPreload(state);
    void els.fill.offsetWidth;
    els.fill.style.transition = '';
    els.root.classList.add('active');




    if (typeof abortPendingPreload === 'function') abortPendingPreload();
    if (typeof wasPreloadedRecently === 'function') wasPreloadedRecently(hash, fileId);
    var url = AppState.currentTorrserverUrl + '/stream?link=' + hash + '&index=' + fileId + '&preload=preload';
    var options = { method: 'GET', headers: getAuthHeaders() };
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
