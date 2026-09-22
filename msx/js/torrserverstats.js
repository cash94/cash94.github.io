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

// Экспортируем функции для использования в других модулях
window.fetchTorrentStatsForBuffer = fetchTorrentStatsForBuffer;
window.updateTorrentStatsCache = updateTorrentStatsCache;
window.formatSpeed = formatSpeed;
window.formatSize = formatSize;
window.startTorrentStatsUpdates = startTorrentStatsUpdates;
window.stopTorrentStatsUpdates = stopTorrentStatsUpdates;
window.torrentStatsCache = torrentStatsCache;
window.refreshTorrentStatsCadence = refreshTorrentStatsCadence;
