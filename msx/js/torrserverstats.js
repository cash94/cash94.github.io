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
var torrentStatsInterval = null;

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

// Запуск интервала обновления статистики
function startTorrentStatsUpdates() {
  stopTorrentStatsUpdates();

  console.log('📊 Запуск интервала обновления статистики TorrServer');

  // Первоначальное обновление
  updateTorrentStatsCache();

  // Обновляем каждые 2 секунды
  torrentStatsInterval = setInterval(function () {
    updateTorrentStatsCache();
  }, 2000);
}

// Остановка интервала обновления статистики
function stopTorrentStatsUpdates() {
  if (torrentStatsInterval) {
    clearInterval(torrentStatsInterval);
    torrentStatsInterval = null;
    console.log('📊 Остановлен интервал обновления статистики TorrServer');
  }
}

// Экспортируем функции для использования в других модулях
window.fetchTorrentStatsForBuffer = fetchTorrentStatsForBuffer;
window.updateTorrentStatsCache = updateTorrentStatsCache;
window.formatSpeed = formatSpeed;
window.formatSize = formatSize;
window.startTorrentStatsUpdates = startTorrentStatsUpdates;
window.stopTorrentStatsUpdates = stopTorrentStatsUpdates;
window.torrentStatsCache = torrentStatsCache;
window.torrentStatsInterval = torrentStatsInterval;
