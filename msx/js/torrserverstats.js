// torrserverstats.js - Модуль для работы со статистикой TorrServer

// Переменные для статистики TorrServer
var torrentStatsCache = {
  preloaded: 0,
  preloadSize: 0,
  downloadSpeed: 0,
  percent: 0,
  activePeers: 0,
  totalPeers: 0,
  connectedSeeders: 0
};

// Функция для получения статистики TorrServer
async function fetchTorrentStatsForBuffer(hash) {
  if (!hash || !AppState.currentTorrserverUrl) return null;

  try {
    var statsUrl = AppState.currentTorrserverUrl + '/cache';

    var headers = {
      'Content-Type': 'application/json',
    };

    var authHeaders = getAuthHeaders();
    for (var key in authHeaders) {
      if (authHeaders.hasOwnProperty(key)) {
        headers[key] = authHeaders[key];
      }
    }

    var response = await fetch(statsUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        action: 'get',
        hash: hash.toLowerCase()
      })
    });

    if (response.ok) {
      var data = await response.json();

      // Данные могут быть в data.Torrent или прямо в data
      var torrent = data.Torrent || data;

      if (torrent) {
        var torrentData = {
          preloaded_bytes: torrent.preloaded_bytes || 0,
          preload_size: torrent.torrent_size || torrent.preload_size || 1,
          download_speed: torrent.download_speed || 0,  // уже в байтах/с
          active_peers: torrent.active_peers || 0,
          total_peers: torrent.total_peers || 0,
          connected_seeders: torrent.connected_seeders || 0,
          percent: torrent.torrent_size
            ? Math.floor((torrent.preloaded_bytes || 0) * 100 / torrent.torrent_size)
            : 0
        };

        return torrentData;
      }
    }
    return null;
  } catch (error) {
    console.log('⚠️ Ошибка получения статистики TorrServer:', error);
    return null;
  }
}

// Функция для обновления кэша статистики
async function updateTorrentStatsCache() {
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

  var stats = await fetchTorrentStatsForBuffer(currentTimecodeData.hash);
  if (stats) {
    torrentStatsCache.preloaded = stats.preloaded_bytes || 0;
    torrentStatsCache.preloadSize = stats.preload_size || 1;
    torrentStatsCache.downloadSpeed = stats.download_speed || 0;  // уже в байтах/с
    torrentStatsCache.percent = stats.percent;
    torrentStatsCache.activePeers = stats.active_peers || 0;
    torrentStatsCache.totalPeers = stats.total_peers || 0;
    torrentStatsCache.connectedSeeders = stats.connected_seeders || 0;
  }
}

// Функция форматирования скорости
function formatSpeed(speedInBytes) {
  if (speedInBytes === 0 || !speedInBytes) return '0 Mb/s';

  // Переводим байты/с в мегабиты/с: (байты * 8) / 1_000_000
  var speedInMegabits = (speedInBytes * 8) / 1000000;

  if (speedInMegabits < 1) {
    // Если меньше 1 Мбит/с, показываем в килобитах
    var speedInKilobits = (speedInBytes * 8) / 1000;
    return speedInKilobits.toFixed(1) + ' Kb/s';
  }

  return speedInMegabits.toFixed(1) + ' Mb/s';
}

// Функция форматирования размера
function formatSize(bytes) {
  if (bytes === 0 || !bytes) return '0 B';
  if (bytes < 1024) return bytes.toFixed(0) + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// ==================== Частота опроса /cache ====================
//
// Статистику показывает только строка «TorrServer: … скорость … пиры» в HUD
// плеера, других потребителей у неё нет. Пока HUD скрыт, опрашивать TorrServer
// раз в пару секунд незачем: никто этих цифр не видит. Поэтому частота зависит
// от того, видна ли строка: открыт HUD — раз в секунду, скрыт — раз в 10 с.
// «Не видна» — это ещё и скрытый жёлтой кнопкой буфер (AppState.bufferHidden):
// тогда строки нет даже при открытом HUD.
//
// Цепочка setTimeout, а не setInterval: следующий запрос планируется только
// после ответа на предыдущий. Прежний setInterval на медленном TorrServer
// накладывал запросы друг на друга.
//
// HUD прячут и показывают двое: player.js (setPlayerControlsIdle) и control.js
// (hidePlayerControls / showPlayerControls). Оба работают классом idle-hidden
// на #controls-container, поэтому смену видимости ловим MutationObserver'ом на
// этом классе, а не вызовами из каждого пути. При открытии HUD данные нужны
// сразу, а не через оставшиеся до десяти секунд, — тогда запрос уходит
// немедленно.

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

/**
 * Пересчитать частоту после смены видимости. Строка стала видна — запрос
 * сразу (если последний был не только что), дальше раз в секунду. Скрылась —
 * ничего не делаем: уже назначенный тик отработает и сам перейдёт на 10 с.
 */
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

// Запуск опроса статистики
function startTorrentStatsUpdates() {
  stopTorrentStatsUpdates();

  console.log('📊 Запуск опроса статистики TorrServer');

  torrentStatsRunning = true;
  torrentStatsWasVisible = isTorrentStatsVisible();
  watchTorrentStatsVisibility();
  // Первоначальное обновление — сразу
  scheduleTorrentStats(0);
}

// Остановка опроса статистики
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

// ==================== Предзагрузка перед воспроизведением ====================
//
// Настройка TorrServer → «Предзагрузка» (AppState.preloadBeforePlay). Перед
// стартом плеера startHLSPlayback (player.js) зовёт runPlaybackPreload: тот
// просит TorrServer прогреть файл (?preload=preload, как preloadTorrents в
// player.js) и раз в секунду показывает в окне скорость, пиры, сиды и сколько
// буфера уже набрано. Набралось PRELOAD_TARGET_BYTES — окно закрывается и
// воспроизведение стартует. По окну видно, живая ли раздача, и если нет —
// «Назад» отменяет запуск и останавливает раздачу на сервере.
//
// Ответ на ?preload=preload TorrServer держит открытым, пока греет свой объём
// (настройка «Размер предзагрузки» у него). Если тот меньше 32 МБ, до цели
// счётчик не дорастёт никогда — поэтому успешный ответ тоже значит «готово».
//
// Клавиши ловим в фазе перехвата на window, как встроенная клавиатура (osk.js):
// раньше обработчиков control.js, которые иначе увели бы фокус по экрану под
// окном. «Назад» с Android приходит синтетическим Escape из popstate
// (control.js), у него keyCode 0 — поэтому проверяем ещё и e.key.

var PRELOAD_TARGET_BYTES = 32 * 1024 * 1024;
var PRELOAD_POLL_MS = 1000;
var activePlaybackPreload = null;
var preloadSwallowKeyup = false;
var preloadPanelEls = null;

function getPreloadPanel() {
  if (preloadPanelEls) return preloadPanelEls;
  var root = document.createElement('div');
  root.id = 'preload-panel';
  root.innerHTML =
    '<div class="preload-card" role="dialog" aria-live="polite">' +
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
    '<button type="button" class="preload-btn" data-action="play"><span class="preload-key">ОК</span>Смотреть сейчас</button>' +
    '</div>' +
    '</div>';
  document.body.appendChild(root);
  // Кнопки — для мыши и тача; с пульта то же делают «Назад» и ОК
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
  state.timer = setTimeout(function () { playbackPreloadTick(state); }, delay);
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
    renderPlaybackPreload(state);
    if (state.loaded >= PRELOAD_TARGET_BYTES) { finishPlaybackPreload(state, true); return; }
    schedulePlaybackPreloadTick(state, PRELOAD_POLL_MS);
  });
}

/**
 * Закрыть окно. play = true — запускаем воспроизведение, false — отмена:
 * обрываем прогрев и останавливаем раздачу на TorrServer, чтобы негодная
 * раздача не качалась дальше в фоне (так же делает выход из плеера).
 */
function finishPlaybackPreload(state, play) {
  if (activePlaybackPreload !== state) return;
  activePlaybackPreload = null;
  if (state.timer) { clearTimeout(state.timer); state.timer = null; }
  getPreloadPanel().root.classList.remove('active');
  if (!play) {
    if (state.controller) { try { state.controller.abort(); } catch (e) { } }
    // Отметка «уже прогревали» из player.js: без неё повторный запуск того же
    // файла не стал бы греть его заново — а ничего и не прогрелось
    if (typeof preloadedFilesAt !== 'undefined') delete preloadedFilesAt[state.key];
    if (typeof dropTorrentToServer === 'function') {
      dropTorrentToServer(state.hash)['catch'](function () { });
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
  if (isBack) { finishPlaybackPreload(activePlaybackPreload, false); return; }
  if (typeof isOkKey === 'function' ? isOkKey(kc) : kc === 13) {
    // keyup этого ОК придёт уже без окна — не отдаём его экрану под ним
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

/**
 * Показать окно предзагрузки и ждать буфер. Промис: true — запускать
 * воспроизведение, false — пользователь отменил.
 */
function runPlaybackPreload(hash, fileId, title) {
  if (activePlaybackPreload) finishPlaybackPreload(activePlaybackPreload, false);
  return new Promise(function (resolve) {
    var state = {
      hash: hash,
      fileId: fileId,
      key: String(hash).toLowerCase() + ':' + fileId,
      resolve: resolve,
      timer: null,
      controller: (typeof AbortController === 'function') ? new AbortController() : null,
      stats: null,
      loaded: 0,
      error: ''
    };
    activePlaybackPreload = state;

    var els = getPreloadPanel();
    els.name.textContent = title || '';
    // Полоска с нуля без анимации отката от прошлого запуска
    els.fill.style.transition = 'none';
    renderPlaybackPreload(state);
    void els.fill.offsetWidth;
    els.fill.style.transition = '';
    els.root.classList.add('active');

    // Прогрев после отмены чужого: старый (карточка, с которой ушли) держал
    // бы соединение к TorrServer впустую. Отметка в player.js — чтобы
    // preparePlaybackMetadata не повторил прогрев этого же файла
    if (typeof abortPendingPreload === 'function') abortPendingPreload();
    if (typeof wasPreloadedRecently === 'function') wasPreloadedRecently(hash, fileId);
    var url = AppState.currentTorrserverUrl + '/stream?link=' + hash + '&index=' + fileId + '&preload=preload';
    var options = { method: 'GET', headers: getAuthHeaders() };
    if (state.controller) options.signal = state.controller.signal;
    fetch(url, options).then(function (response) {
      if (activePlaybackPreload !== state) return;
      if (response.ok) {
        // TorrServer догрел свой объём — ждать больше нечего
        state.loaded = Math.max(state.loaded, PRELOAD_TARGET_BYTES);
        renderPlaybackPreload(state);
        finishPlaybackPreload(state, true);
      } else {
        state.error = 'TorrServer ответил ' + response.status;
        renderPlaybackPreload(state);
      }
    }, function (error) {
      if (activePlaybackPreload !== state || (error && error.name === 'AbortError')) return;
      state.error = 'Нет ответа от TorrServer';
      renderPlaybackPreload(state);
    });

    schedulePlaybackPreloadTick(state, 0);
  });
}

function isPlaybackPreloadActive() {
  return !!activePlaybackPreload;
}

// Экспортируем функции для использования в других модулях
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
