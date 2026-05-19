// Функции плеера

// Переменные для хранения информации о сериях
var currentEpisodeFiles = [];
var currentEpisodeIndex = 0;
var currentTorrentHash = null;
var lastCleanedSegment = -1;
var nearEndCheckInterval = null;
var thisisseek = false;

// Переменные для таймкода
var timecodeSaveInterval = null;
var currentTimecodeData = {
  hash: null,
  fileId: null,
  timecode: 0,
  duration: 0
};

// Переменные для скрытия элементов
var mouseIdleTimer = null;
var IDLE_TIMEOUT = 3000; // 3 секунды

// Переменные для хранения информации об аудиодорожках
var currentAudioTracks = [];
var currentAudioTrack = 0;
var currentFileInfo = null;

var heartbeatInterval = null;
var currentBufferAhead = 0;
var wasImmediatePause = false;
var pauseTimer = null;
var pauseStartTime = null;
var PAUSE_THRESHOLD = 60000; // 1 минута

//Для отмены воспроизведения
var currentPlaybackController = null;

// Функции heartbeat
function startHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  heartbeatInterval = setInterval(function () {
    if (AppState.currentStreamId && AppState.currentScreen === 'player') {
      fetch(SERVER_URL + '/hls/activity/' + AppState.currentStreamId, {
        method: 'POST'
      })['catch'](function (e) {
        console.log('⚠️ Heartbeat error:', e);
      });
    }
  }, 20000);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// Скрываем кнопку серий по умолчанию
document.addEventListener('DOMContentLoaded', function () {
  var episodesBtn = document.getElementById('episodes-btn');
  if (episodesBtn) {
    episodesBtn.style.display = 'none';
  }

  // Скрываем кнопки переключения серий по умолчанию
  var prevBtn = document.getElementById('prev-episode-btn');
  var nextBtn = document.getElementById('next-episode-btn');
  if (prevBtn) prevBtn.style.display = 'none';
  if (nextBtn) nextBtn.style.display = 'none';
});

// НОВАЯ ФУНКЦИЯ: Обновление видимости кнопок переключения серий
function updateEpisodeButtons() {
  var prevBtn = document.getElementById('prev-episode-btn');
  var nextBtn = document.getElementById('next-episode-btn');

  if (!prevBtn || !nextBtn) return;

  if (currentEpisodeFiles.length > 0) {
    // Показываем кнопки только если есть серии
    prevBtn.style.display = 'flex';
    nextBtn.style.display = 'flex';

    // Делаем кнопки активными/неактивными в зависимости от текущей серии
    if (currentEpisodeIndex === 0) {
      prevBtn.style.opacity = '0.3';
      prevBtn.style.pointerEvents = 'none';
    } else {
      prevBtn.style.opacity = '1';
      prevBtn.style.pointerEvents = 'auto';
    }

    if (currentEpisodeIndex === currentEpisodeFiles.length - 1) {
      nextBtn.style.opacity = '0.3';
      nextBtn.style.pointerEvents = 'none';
    } else {
      nextBtn.style.opacity = '1';
      nextBtn.style.pointerEvents = 'auto';
    }
  } else {
    // Скрываем кнопки если нет серий
    prevBtn.style.display = 'none';
    nextBtn.style.display = 'none';
  }
}

// НОВАЯ ФУНКЦИЯ: Обновление названия текущего воспроизводимого файла
function updatePlayerTitle(title) {
  var titleElement = document.getElementById('player-title');
  var controlsContainer = document.getElementById('controls-container');
  if (!titleElement) return;

  if (title) {
    titleElement.textContent = title;
    titleElement.dataset.hasTitle = '1';
    if (controlsContainer && controlsContainer.classList.contains('idle-hidden')) {
      titleElement.classList.add('hidden');
      titleElement.classList.add('idle-hidden');
    } else {
      titleElement.classList.remove('hidden');
      titleElement.classList.remove('idle-hidden');
    }
  } else {
    titleElement.dataset.hasTitle = '';
    titleElement.classList.add('hidden');
    titleElement.classList.add('idle-hidden');
  }
}

function syncPlayerTitleVisibility(forceVisible) {
  if (forceVisible === undefined) forceVisible = null;
  var titleElement = document.getElementById('player-title');
  var subtitleElement = document.getElementById('player-subtitle');
  var controlsContainer = document.getElementById('controls-container');
  if (!titleElement) return;

  var hasTitle = !!titleElement.dataset.hasTitle;
  if (!hasTitle) {
    titleElement.classList.add('hidden');
    titleElement.classList.add('idle-hidden');
    subtitleElement.classList.add('hidden');
    subtitleElement.classList.add('idle-hidden');
    return;
  }

  var shouldShow = forceVisible === null
    ? !!(controlsContainer && !controlsContainer.classList.contains('idle-hidden'))
    : !!forceVisible;

  if (shouldShow) {
    titleElement.classList.remove('hidden');
    titleElement.classList.remove('idle-hidden');
    subtitleElement.classList.remove('hidden');
    subtitleElement.classList.remove('idle-hidden');
  } else {
    titleElement.classList.add('hidden');
    titleElement.classList.add('idle-hidden');
    subtitleElement.classList.add('hidden');
    subtitleElement.classList.add('idle-hidden');
  }
}
window.syncPlayerTitleVisibility = syncPlayerTitleVisibility;

// НОВАЯ ФУНКЦИЯ: Получение названия файла по hash и fileId
async function getFileNameByHash(hash, fileId) {
  if (!hash || !fileId) return null;

  // Ищем торрент в текущем списке
  var torrent = null;
  for (var i = 0; i < AppState.torrents.length; i++) {
    if (AppState.torrents[i].hash && AppState.torrents[i].hash.toLowerCase() === hash.toLowerCase()) {
      torrent = AppState.torrents[i];
      break;
    }
  }

  if (!torrent) {
    console.log('⚠️ Торрент не найден для получения названия');
    return null;
  }

  // Получаем список файлов
  var files = [];
  if (torrent.file_stats && Array.isArray(torrent.file_stats)) {
    files = torrent.file_stats;
  } else if (torrent.data) {
    try {
      var data = JSON.parse(torrent.data);
      if (data.TorrServer && data.TorrServer.Files) {
        files = data.TorrServer.Files;
      }
    } catch (e) {
      console.error('Ошибка парсинга data:', e);
    }
  }

  // Ищем нужный файл
  var file = null;
  for (var j = 0; j < files.length; j++) {
    if (files[j].id == fileId) {
      file = files[j];
      break;
    }
  }

  if (file) {
    // Извлекаем имя файла из пути
    var fileName = file.path.split('/').pop() || ('Файл ' + fileId);
    return fileName;
  }

  return null;
}

// НОВАЯ ФУНКЦИЯ: Сброс таймера бездействия мыши
function resetMouseIdleTimer() {
  var playerScreen = document.getElementById('player-screen');
  var playerOverlay = document.getElementById('player-overlay');
  var controlsContainer = document.getElementById('controls-container');
  var bufferStats = document.getElementById('buffer-stats');
  var playerHint = document.getElementById('player-hint');
  var toggleBufferBtn = document.getElementById('toggle-buffer-btn');
  var exitPlayerBtn = document.getElementById('exit-player-btn');
  var episodesBtn = document.getElementById('episodes-btn');
  var episodesPanel = document.getElementById('episodes-panel');
  var prevBtn = document.getElementById('prev-episode-btn');
  var nextBtn = document.getElementById('next-episode-btn');
  var playerTitle = document.getElementById('player-title');

  if (!playerScreen || playerScreen.style.display !== 'block') return;

  // Показываем элементы
  if (playerOverlay) playerOverlay.classList.add('touch-active');

  // Показываем все элементы управления
  var controlElements = [
    controlsContainer, bufferStats, playerHint,
    toggleBufferBtn, exitPlayerBtn, episodesBtn,
    prevBtn, nextBtn, playerTitle
  ];

  for (var i = 0; i < controlElements.length; i++) {
    var el = controlElements[i];
    if (el) {
      el.classList.remove('idle-hidden');
      el.style.opacity = '1';
      el.style.pointerEvents = 'auto';
    }
  }
  syncPlayerTitleVisibility(true);

  // Если панель серий открыта, оставляем её видимой
  if (episodesPanel && !episodesPanel.classList.contains('hidden')) {
    episodesPanel.style.opacity = '1';
    episodesPanel.style.pointerEvents = 'auto';
  }

  // Сбрасываем предыдущий таймер
  if (mouseIdleTimer) {
    clearTimeout(mouseIdleTimer);
  }

  // Устанавливаем новый таймер
  mouseIdleTimer = setTimeout(function () {
    if (playerScreen.style.display === 'block') {
      // Скрываем элементы, кроме панели серий если она открыта
      if (playerOverlay) playerOverlay.classList.remove('touch-active');

      for (var j = 0; j < controlElements.length; j++) {
        var el = controlElements[j];
        if (el) {
          el.classList.add('idle-hidden');
          el.style.opacity = '0';
          el.style.pointerEvents = 'none';
        }
      }
      syncPlayerTitleVisibility(false);

      // Панель серий скрываем только если она закрыта
      if (episodesPanel && episodesPanel.classList.contains('hidden')) {
        episodesPanel.style.opacity = '0';
        episodesPanel.style.pointerEvents = 'none';
      }
    }
  }, IDLE_TIMEOUT);
}

// НОВАЯ ФУНКЦИЯ: Переключение на следующую серию
function nextEpisode() {
  console.log('➡️ Попытка переключения на следующую серию');
  console.log('Текущий индекс:', currentEpisodeIndex);
  console.log('Всего серий:', currentEpisodeFiles.length);

  currentBufferAhead = 0;
  wasImmediatePause = false;
  pauseTimer = null;
  pauseStartTime = null;

  if (currentEpisodeFiles.length === 0 || currentEpisodeIndex === undefined) {
    console.log('❌ Нет данных о сериях');
    return;
  }

  var nextIndex = currentEpisodeIndex + 1;
  if (nextIndex < currentEpisodeFiles.length) {
    var nextFile = currentEpisodeFiles[nextIndex];
    console.log('✅ Переключаемся на серию ' + (nextIndex + 1) + ', fileId: ' + nextFile.id);
    switchToEpisode(nextIndex, nextFile.id);
  } else {
    console.log('⚠️ Это последняя серия');
  }
}

// НОВАЯ ФУНКЦИЯ: Переключение на предыдущую серию
function prevEpisode() {
  console.log('⬅️ Попытка переключения на предыдущую серию');
  console.log('Текущий индекс:', currentEpisodeIndex);
  console.log('Всего серий:', currentEpisodeFiles.length);

  currentBufferAhead = 0;
  wasImmediatePause = false;
  pauseTimer = null;
  pauseStartTime = null;

  if (currentEpisodeFiles.length === 0 || currentEpisodeIndex === undefined) {
    console.log('❌ Нет данных о сериях');
    return;
  }

  var prevIndex = currentEpisodeIndex - 1;
  if (prevIndex >= 0) {
    var prevFile = currentEpisodeFiles[prevIndex];
    console.log('✅ Переключаемся на серию ' + (prevIndex + 1) + ', fileId: ' + prevFile.id);
    switchToEpisode(prevIndex, prevFile.id);
  } else {
    console.log('⚠️ Это первая серия');
  }
}

function showPlayerLoading(message, targetTime) {
  if (message === undefined) message = 'Перемотка...';
  if (targetTime === undefined) targetTime = null;
  var overlay = document.getElementById('loading-player-overlay');
  var playerOverlay = document.getElementById('player-overlay');
  var loadingTime = document.getElementById('loading-time');

  overlay.classList.add('active');
  playerOverlay.classList.add('loading');

  if (targetTime !== null && !isNaN(targetTime)) {
    loadingTime.textContent = formatTime(targetTime);
    loadingTime.style.display = 'block';
  } else {
    loadingTime.style.display = 'none';
  }

  document.querySelector('.loading-player-text').textContent = message;
}

function hidePlayerLoading() {
  document.getElementById('loading-player-overlay').classList.remove('active');
  document.getElementById('player-overlay').classList.remove('loading');
}

function updateTimeDisplay() {
  var currentTimeSpan = document.getElementById('current-time');
  var durationSpan = document.getElementById('duration-time');
  var seekSlider = document.getElementById('seek-slider');
  var videoPlayer = document.getElementById('video-player');

  if (AppState.isSliderDragging && AppState.previewTime !== null) {
    currentTimeSpan.textContent = formatTime(AppState.previewTime);
  } else {
    var absoluteTime = videoPlayer.currentTime + AppState.seekOffset;
    currentTimeSpan.textContent = formatTime(absoluteTime);

    // Обновляем текущий таймкод для сохранения
    if (currentTimecodeData.hash && currentTimecodeData.fileId) {
      currentTimecodeData.timecode = absoluteTime;
    }
  }

  var totalDuration = AppState.originalDuration || AppState.expectedDuration || videoPlayer.duration;
  durationSpan.textContent = formatTime(totalDuration);

  // Обновляем длительность в данных таймкода
  if (totalDuration && isFinite(totalDuration) && totalDuration > 0) {
    currentTimecodeData.duration = totalDuration;
  }
}

function updatePlayPauseButton() {
  var btn = document.getElementById('play-pause-btn');
  var videoPlayer = document.getElementById('video-player');

  if (videoPlayer.paused) {
    btn.innerHTML = '<i class="fi fi-rr-play"></i>';

    pauseStartTime = Date.now();
    wasImmediatePause = false;

    if (pauseTimer) clearTimeout(pauseTimer);

    // Буфер > 20 секунд - пауза сразу
    if (currentBufferAhead > 20) {
      console.log(`📊 Буфер ${currentBufferAhead.toFixed(1)}с > 20с, пауза немедленно`);
      wasImmediatePause = true;
      fetch(SERVER_URL + '/api/stream/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamId: AppState.currentStreamId })
      }).catch(e => console.error('Ошибка паузы:', e));
    } else {
      // Буфер < 20 секунд - пауза через минуту
      console.log(`📊 Буфер ${currentBufferAhead.toFixed(1)}с < 20с, пауза через минуту`);
      pauseTimer = setTimeout(async () => {
        console.log('⏸️ Пауза больше минуты, приостанавливаем поток');
        await fetch(SERVER_URL + '/api/stream/pause', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ streamId: AppState.currentStreamId })
        });
      }, PAUSE_THRESHOLD);
    }

  } else {
    btn.innerHTML = '<i class="fi fi-rr-pause"></i>';

    if (pauseStartTime) {
      var pauseDuration = Date.now() - pauseStartTime;

      // Возобновляем если: была мгновенная пауза ИЛИ пауза длилась больше минуты
      if (wasImmediatePause || pauseDuration >= PAUSE_THRESHOLD) {
        console.log(`▶️ Возобновляем поток (${wasImmediatePause ? 'мгновенная пауза' : 'пауза ' + (pauseDuration / 1000).toFixed(0) + ' сек'})`);
        fetch(SERVER_URL + '/api/stream/resume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ streamId: AppState.currentStreamId })
        }).catch(e => console.error('Ошибка возобновления:', e));
      } else {
        console.log(`▶️ Короткая пауза (${(pauseDuration / 1000).toFixed(0)} сек), возобновление не требуется`);
      }
    }

    if (pauseTimer) clearTimeout(pauseTimer);
    pauseStartTime = null;
    pauseTimer = null;
    wasImmediatePause = false;
  }
}

function updateMuteButton() {
  var btn = document.getElementById('mute-btn');
  var videoPlayer = document.getElementById('video-player');

  if (videoPlayer.muted) {
    btn.innerHTML = '<i class="fi fi-tc-volume-slash"></i>';
  } else {
    btn.innerHTML = '<i class="fi fi-rr-volume"></i>';
  }
}

function updateBufferDisplay() {
  var bufferStats = document.getElementById('buffer-stats');
  var subtitleElement = document.getElementById('player-subtitle');
  var videoPlayer = document.getElementById('video-player');

  if (AppState.bufferHidden) {
    bufferStats.classList.add('hidden');
    if (subtitleElement) subtitleElement.classList.add('hidden');
    return;
  }
  bufferStats.classList.remove('hidden');
  if (subtitleElement) subtitleElement.classList.remove('hidden');

  if (videoPlayer.buffered && videoPlayer.buffered.length > 0) {
    var buffered = videoPlayer.buffered.end(videoPlayer.buffered.length - 1);
    var totalDuration = AppState.originalDuration || AppState.expectedDuration || videoPlayer.duration;
    var currentTime = videoPlayer.currentTime;

    if (totalDuration && totalDuration > 0 && isFinite(totalDuration)) {
      var absoluteBuffered = buffered + AppState.seekOffset;
      var absoluteCurrent = currentTime + AppState.seekOffset;
      var bufferAhead = absoluteBuffered - absoluteCurrent;
      var remainingTime = totalDuration - absoluteCurrent;

      // Защита от отрицательных значений
      if (remainingTime < 0) remainingTime = 0;
      if (bufferAhead < 0) bufferAhead = 0;

      currentBufferAhead = bufferAhead;

      // Форматируем буфер
      var bufferAheadText;
      if (bufferAhead < 60) {
        bufferAheadText = Math.floor(bufferAhead) + ' сек';
      } else if (bufferAhead < 3600) {
        bufferAheadText = Math.floor(bufferAhead / 60) + ' мин';
      } else {
        bufferAheadText = Math.floor(bufferAhead / 3600) + ' ч';
      }

      // ИСПРАВЛЕННОЕ форматирование оставшегося времени
      var remainingText;
      var remainingHours = Math.floor(remainingTime / 3600);
      var remainingMinutes = Math.floor((remainingTime % 3600) / 60);
      var remainingSeconds = Math.floor(remainingTime % 60);

      if (remainingHours > 0) {
        if (remainingMinutes > 0) {
          remainingText = remainingHours + ' ч ' + remainingMinutes + ' мин';
        } else {
          remainingText = remainingHours + ' ч';
        }
      } else if (remainingMinutes > 0) {
        if (remainingSeconds > 0) {
          remainingText = remainingMinutes + ' мин ' + remainingSeconds + ' сек';
        } else {
          remainingText = remainingMinutes + ' мин';
        }
      } else {
        remainingText = remainingSeconds + ' сек';
      }

      // Вычисляем время окончания
      var endTime = new Date(Date.now() + remainingTime * 1000);
      var endTimeHours = endTime.getHours().toString().padStart(2, '0');
      var endTimeMinutes = endTime.getMinutes().toString().padStart(2, '0');
      var endTimeText = endTimeHours + ':' + endTimeMinutes;

      // Добавляем статистику TorrServer из кэша
      var torrServerText = '';
      if (currentTimecodeData.hash && torrentStatsCache.preloadSize > 0) {
        var preloadedText = formatSize(torrentStatsCache.preloaded);
        var speedText = formatSpeed(torrentStatsCache.downloadSpeed);
        torrServerText = 'TorrServer: ' + preloadedText + ' | скорость: ' + speedText;

        if (torrentStatsCache.activePeers > 0) {
          torrServerText += ' | пиры: ' + torrentStatsCache.totalPeers + ' / ' + torrentStatsCache.activePeers + ' - ' + torrentStatsCache.connectedSeeders;
        }
      }

      bufferStats.innerText = 'Буфер: ' + bufferAheadText + ' | до конца: ' + remainingText + ' | конец в: ' + endTimeText;

      if (subtitleElement && torrServerText) {
        subtitleElement.innerText = torrServerText;
      } else if (subtitleElement) {
        subtitleElement.innerText = '';
      }
    }
  } else {
    bufferStats.innerText = 'буфер: 0%';
    if (subtitleElement) {
      subtitleElement.innerText = '';
    }
  }
}

function forceUpdateDuration(duration, origDur, offset) {
  if (origDur === undefined) origDur = null;
  if (offset === undefined) offset = 0;
  var videoPlayer = document.getElementById('video-player');
  var durationSpan = document.getElementById('duration-time');
  var seekSlider = document.getElementById('seek-slider');

  if (!duration || !isFinite(duration) || duration <= 0) return;

  console.log('⏱️ Устанавливаем: отрезок=' + formatTime(duration) + ', полная=' + (origDur ? formatTime(origDur) : 'N/A') + ', offset=' + offset.toFixed(2) + 's');

  AppState.expectedDuration = duration;
  AppState.originalDuration = origDur;
  AppState.seekOffset = offset;

  videoPlayer.dataset.expectedDuration = duration;
  videoPlayer.dataset.originalDuration = origDur;
  videoPlayer.dataset.seekOffset = offset;

  durationSpan.textContent = formatTime(origDur || duration);
  seekSlider.max = origDur || duration;

  // Обновляем длительность в данных таймкода
  currentTimecodeData.duration = origDur || duration;

  updateTimeDisplay();
}

function destroyHls() {
  hidePlayerLoading();
  if (AppState.hls) {
    AppState.expectedDuration = null;
    AppState.originalDuration = null;
    AppState.seekOffset = 0;
    AppState.lastSuccessfulSeek = 0;
    delete document.getElementById('video-player').dataset.expectedDuration;
    delete document.getElementById('video-player').dataset.originalDuration;
    delete document.getElementById('video-player').dataset.seekOffset;
    AppState.hls.destroy();
    AppState.hls = null;
  }
  AppState.isPlaying = false;
}

async function checkPlaylistExists(playlistUrl, maxAttempts) {
  if (maxAttempts === undefined) maxAttempts = 40;
  console.log('🔍 Начинаем проверку плейлиста: ' + playlistUrl);

  for (var i = 0; i < maxAttempts; i++) {
    try {
      var response = await fetch(playlistUrl, { method: 'HEAD' });
      if (response.ok) {
        console.log('✅ Плейлист готов после ' + (i + 1) + ' попыток (' + ((i + 1) * 500) + 'ms)');
        return true;
      } else {
        console.log('⚠️ Плейлист еще не готов, статус: ' + response.status);
      }
    } catch (e) {
      console.log('⏳ Попытка ' + (i + 1) + '/' + maxAttempts + ': плейлист не доступен, ошибка: ' + e.message);
    }

    if (i % 4 === 0) {
      var seconds = ((i + 1) * 0.5).toFixed(0);
      showPlayerLoading('Ожидание плейлиста... ' + seconds + 'с', AppState.previewTime);
    }

    await new Promise(function (r) { setTimeout(r, 500); });
  }

  console.error('❌ Плейлист не появился после ' + maxAttempts + ' попыток (' + (maxAttempts * 0.5) + ' секунд)');
  return false;
}

function reloadHlsPlaylist(playlistUrl) {
  return new Promise(function (resolve, reject) {
    if (!AppState.hls || !Hls.isSupported()) {
      reject(new Error('HLS не инициализирован'));
      return;
    }

    console.log('🔄 Перезагрузка плейлиста:', playlistUrl);

    var manifestParsed = false;
    var loadError = null;

    var onManifestParsed = function () {
      manifestParsed = true;
      AppState.hls.off(Hls.Events.MANIFEST_PARSED, onManifestParsed);
      AppState.hls.off(Hls.Events.ERROR, onError);
      console.log('✅ Новый плейлист загружен');
      resolve();
    };

    var onError = function (event, data) {
      console.error('HLS ошибка при загрузке:', data);
      if (data.fatal && !manifestParsed) {
        loadError = new Error(data.details || 'Ошибка загрузки плейлиста');
        AppState.hls.off(Hls.Events.MANIFEST_PARSED, onManifestParsed);
        AppState.hls.off(Hls.Events.ERROR, onError);
        reject(loadError);
      }
    };

    AppState.hls.on(Hls.Events.MANIFEST_PARSED, onManifestParsed);
    AppState.hls.on(Hls.Events.ERROR, onError);

    try {
      AppState.hls.loadSource(playlistUrl);
    } catch (e) {
      reject(e);
    }

    setTimeout(function () {
      if (!manifestParsed && !loadError) {
        AppState.hls.off(Hls.Events.MANIFEST_PARSED, onManifestParsed);
        AppState.hls.off(Hls.Events.ERROR, onError);
        reject(new Error('Таймаут загрузки плейлиста'));
      }
    }, 15000);
  });
}

// НОВАЯ ФУНКЦИЯ: Сохранение таймкода на сервер
async function saveTimecodeToServer() {
  if (!currentTimecodeData.hash || !currentTimecodeData.fileId) return;

  // Не сохраняем если таймкод 0 или близок к 0 (начало видео)
  if (currentTimecodeData.timecode < 5) return;

  // Не сохраняем если таймкод близок к концу (меньше 10 секунд до конца)
  if (currentTimecodeData.duration > 0 &&
    currentTimecodeData.timecode > currentTimecodeData.duration - 10) return;

  try {
    var savedClientId = localStorage.getItem('clientId');
    var response = await fetch(SERVER_URL + '/api/timecode/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: savedClientId,
        hash: currentTimecodeData.hash,
        fileId: currentTimecodeData.fileId,
        timecode: currentTimecodeData.timecode,
        duration: currentTimecodeData.duration
      })
    });

    if (response.ok) {
      console.log('💾 Таймкод сохранен: ' + formatTime(currentTimecodeData.timecode));
    }
  } catch (error) {
    console.error('Ошибка сохранения таймкода:', error);
  }
}

// НОВАЯ ФУНКЦИЯ: Загрузка таймкода с сервера
async function loadTimecodeFromServer(hash, fileId) {
  if (!hash || !fileId) return 0;

  try {
    var savedClientId = localStorage.getItem('clientId');
    var response = await fetch(SERVER_URL + '/api/timecode/get?hash=' + hash + '&fileId=' + fileId +'&clientId=' + encodeURIComponent(savedClientId));
    if (response.ok) {
      var data = await response.json();
      if (data.success && data.timecode > 0) {
        console.log('⏱️ Загружен сохраненный таймкод: ' + formatTime(data.timecode));
        return data.timecode;
      }
    }
  } catch (error) {
    console.error('Ошибка загрузки таймкода:', error);
  }
  return 0;
}

// НОВАЯ ФУНКЦИЯ: Очистка данных таймкода
function clearTimecodeData() {
  currentTimecodeData = {
    hash: null,
    fileId: null,
    timecode: 0,
    duration: 0
  };
}

// НОВАЯ ФУНКЦИЯ: Запуск интервала сохранения таймкода
function startTimecodeSaving() {
  if (timecodeSaveInterval) {
    clearInterval(timecodeSaveInterval);
  }

  // Сохраняем каждые 10 секунд
  timecodeSaveInterval = setInterval(function () {
    saveTimecodeToServer();
  }, 10000);
}

// НОВАЯ ФУНКЦИЯ: Остановка интервала сохранения таймкода
function stopTimecodeSaving() {
  if (timecodeSaveInterval) {
    clearInterval(timecodeSaveInterval);
    timecodeSaveInterval = null;
  }
}

// НОВАЯ ФУНКЦИЯ: Проверка, доступна ли позиция в буфере
function isPositionInBuffer(targetTime) {
  var videoPlayer = document.getElementById('video-player');

  if (!videoPlayer || !videoPlayer.buffered || videoPlayer.buffered.length === 0) {
    return false;
  }

  // Переводим абсолютное время в относительное для видео (учитываем seekOffset)
  var relativeTargetTime = targetTime - AppState.seekOffset;

  // Проверяем все диапазоны буфера
  for (var i = 0; i < videoPlayer.buffered.length; i++) {
    var start = videoPlayer.buffered.start(i);
    var end = videoPlayer.buffered.end(i);

    // Добавляем небольшой запас (0.5 секунды) для более плавной перемотки
    if (relativeTargetTime >= start - 0.5 && relativeTargetTime <= end + 0.5) {
      console.log('✅ Позиция ' + formatTime(targetTime) + ' (' + relativeTargetTime.toFixed(2) + 's) в буфере [' + start.toFixed(2) + '-' + end.toFixed(2) + ']');
      return true;
    }
  }

  console.log('❌ Позиция ' + formatTime(targetTime) + ' (' + relativeTargetTime.toFixed(2) + 's) вне буфера');
  return false;
}

// Обновленная функция перемотки с блокировкой интерфейса
async function seekStream(absoluteSeekTime, source) {
  currentBufferAhead = 0;
  wasImmediatePause = false;
  pauseTimer = null;
  pauseStartTime = null;
  thisisseek = true;
  if (source === undefined) source = 'user';
  if (!AppState.currentStreamId || !AppState.videoUrl) {
    console.warn('⚠️ Нет активного потока для перемотки');
    return false;
  }

  var videoPlayer = document.getElementById('video-player');
  var totalDuration = AppState.originalDuration || AppState.expectedDuration || 0;

  if (absoluteSeekTime < 0) absoluteSeekTime = 0;
  if (totalDuration > 0 && absoluteSeekTime >= totalDuration - 1) {
    console.log('⚠️ Попытка перемотки за конец видео');
    return false;
  }

  AppState.seekQueue.push(absoluteSeekTime);

  if (AppState.isSeeking) {
    console.log('⏳ В очереди: ' + formatTime(absoluteSeekTime));
    return false;
  }

  if (source === 'slider' && AppState.seekTimeout) {
    clearTimeout(AppState.seekTimeout);
  }

  return new Promise(function (resolve) {
    var executeSeek = async function () {
      var targetTime = AppState.seekQueue[AppState.seekQueue.length - 1];
      AppState.seekQueue = [];

      if (targetTime === undefined) {
        hidePlayerLoading();
        resolve(false);
        return;
      }

      var wasPlaying = !videoPlayer.paused;

      // Сначала закрываем панель серий если открыта
      var episodesPanel = document.getElementById('episodes-panel');
      var episodesBtn = document.getElementById('episodes-btn');
      if (episodesPanel && !episodesPanel.classList.contains('hidden')) {
        episodesPanel.classList.add('hidden');
        episodesBtn.classList.remove('active');
      }

      AppState.isSeeking = true;
      AppState.suppressTimeUpdate = true;
      AppState.previewTime = targetTime;

      console.log('🔍 SEEK: ' + formatTime(targetTime));

      // 🔥 НОВАЯ ЛОГИКА: Проверяем, есть ли позиция в буфере
      var positionInBuffer = isPositionInBuffer(targetTime);

      if (positionInBuffer) {
        console.log('🎯 Перемотка в пределах буфера - используем простой seek');

        // Простая перемотка через videoPlayer.currentTime
        var relativeTime = targetTime - AppState.seekOffset;
        videoPlayer.currentTime = relativeTime;

        // Возобновляем воспроизведение если было
        if (wasPlaying) {
          videoPlayer.play()['catch'](function (err) {
            console.log('🔇 Ошибка автоплея после перемотки:', err);
          });
        }

        // Обновляем интерфейс
        AppState.previewTime = null;
        AppState.suppressTimeUpdate = false;
        AppState.isSeeking = false;

        // Обновляем ползунок
        var seekSlider = document.getElementById('seek-slider');
        if (seekSlider) {
          seekSlider.value = targetTime;
        }

        updateTimeDisplay();

        console.log('✅ Простая перемотка выполнена');
        resolve(true);
        return;
      }

      // Если позиция вне буфера - используем сложную перемотку с перезапуском ffmpeg
      console.log('🎯 Перемотка вне буфера - перезапуск ffmpeg');

      // 🔥 СБРАСЫВАЕМ lastCleanedSegment ПЕРЕД ПЕРЕМОТКОЙ
      if (typeof lastCleanedSegment !== 'undefined') {
        console.log('🔄 Сброс lastCleanedSegment: ' + lastCleanedSegment + ' -> -1');
        lastCleanedSegment = -1;
      }

      // Показываем оверлей загрузки и блокируем интерфейс
      var playbackOverlay = document.getElementById('playback-overlay');
      var playbackText = document.querySelector('.playback-text');
      playbackOverlay.classList.add('active');
      playbackText.textContent = 'Перемотка на ' + formatTime(targetTime) + '...';

      // Блокируем кнопки управления
      var controlBtns = document.querySelectorAll('.control-btn');
      for (var i = 0; i < controlBtns.length; i++) {
        var btn = controlBtns[i];
        btn.style.pointerEvents = 'none';
        btn.style.opacity = '0.5';
      }

      if (wasPlaying) {
        videoPlayer.pause();
        updatePlayPauseButton();
      }

      // Функция для повторной попытки
      var retrySeek = async function (retryCount, maxRetries) {
        if (retryCount === undefined) retryCount = 0;
        if (maxRetries === undefined) maxRetries = 2;
        try {
          var savedClientId = localStorage.getItem('clientId');
          var seekResponse = await fetch(SERVER_URL + '/hls/stream/seek', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              streamId: AppState.currentStreamId,
              seekTime: targetTime,
              multiChannel: AppState.multiChannelEnabled,
              clientId: savedClientId, 
              duration: AppState.originalDuration
            })
          });

          if (!seekResponse.ok) {
            throw new Error('HTTP ' + seekResponse.status);
          }

          var seekData = await seekResponse.json();

          if (!seekData.success) {
            throw new Error(seekData.error || 'Ошибка перемотки');
          }

          console.log('✅ Ответ сервера:', seekData);

          AppState.expectedDuration = seekData.duration;
          AppState.originalDuration = seekData.originalDuration;
          AppState.seekOffset = seekData.seekOffset;
          AppState.currentStreamId = seekData.streamId;
          AppState.lastSuccessfulSeek = targetTime;

          videoPlayer.dataset.expectedDuration = AppState.expectedDuration;
          videoPlayer.dataset.originalDuration = AppState.originalDuration;
          videoPlayer.dataset.seekOffset = AppState.seekOffset;

          playbackText.textContent = 'Загрузка потока...';

          var playlistReady = await checkPlaylistExists(seekData.playlistUrl, 60);

          if (!playlistReady) {
            throw new Error('Таймаут ожидания плейлиста');
          }

          playbackText.textContent = 'Загрузка видео...';

          await reloadHlsPlaylist(seekData.playlistUrl);

          var onMetaData = function () {
            console.log('📦 Метаданные загружены');
            videoPlayer.currentTime = 0;

            if (wasPlaying) {
              videoPlayer.play()['catch'](function (err) {
                console.log('🔇 Автоплей после перемотки заблокирован');
                videoPlayer.muted = true;
                videoPlayer.play()['catch'](function () { });
                updateMuteButton();
              });
            }
            videoPlayer.muted = false;
            updateMuteButton();
            forceUpdateDuration(AppState.expectedDuration, AppState.originalDuration, AppState.seekOffset);
            updatePlayPauseButton();
            var seekSlider = document.getElementById('seek-slider');
            if (seekSlider) {
              seekSlider.value = Math.min(targetTime, parseFloat(seekSlider.max) || targetTime);
            }
            AppState.previewTime = null;
            AppState.suppressTimeUpdate = false;

            // Скрываем оверлей и разблокируем интерфейс
            playbackOverlay.classList.remove('active');
            playbackText.textContent = 'Воспроизведение...';

            for (var j = 0; j < controlBtns.length; j++) {
              var btn = controlBtns[j];
              btn.style.pointerEvents = 'auto';
              btn.style.opacity = '1';
            }

            hidePlayerLoading();

            videoPlayer.removeEventListener('loadedmetadata', onMetaData);
          };

          videoPlayer.addEventListener('loadedmetadata', onMetaData, { once: true });

          setTimeout(function () {
            if (document.getElementById('loading-player-overlay').classList.contains('active')) {
              console.log('⚠️ Таймаут загрузки метаданных');
              hidePlayerLoading();
              if (wasPlaying) {
                videoPlayer.play()['catch'](function () { });
              }
            }
          }, 10000);

          return true;

        } catch (error) {
          console.error('❌ Ошибка перемотки (попытка ' + (retryCount + 1) + '/' + (maxRetries + 1) + '):', error);

          if (retryCount < maxRetries) {
            // Обновляем сообщение о повторной попытке
            playbackText.textContent = '⚠️ Ошибка перемотки. Попытка ' + (retryCount + 1) + '/' + (maxRetries + 1) + '...';

            // Небольшая задержка перед повторной попыткой
            await new Promise(function (resolve) { setTimeout(resolve, 1000); });

            return retrySeek(retryCount + 1, maxRetries);
          }

          // Если это последняя попытка или другая ошибка
          throw error;
        }
      };

      try {
        // Выполняем перемотку с возможностью повторных попыток
        var success = await retrySeek(0, 2);
        resolve(success);

      } catch (error) {
        console.error('❌ Финальная ошибка перемотки:', error);

        playbackText.textContent = '❌ Ошибка перемотки!';

        setTimeout(function () {
          // Скрываем оверлей и разблокируем интерфейс
          playbackOverlay.classList.remove('active');
          playbackText.textContent = 'Воспроизведение...';

          for (var k = 0; k < controlBtns.length; k++) {
            var btn = controlBtns[k];
            btn.style.pointerEvents = 'auto';
            btn.style.opacity = '1';
          }
        }, 2000);

        if (wasPlaying) {
          setTimeout(function () {
            videoPlayer.play()['catch'](function () { });
          }, 1000);
        }

        AppState.previewTime = null;
        AppState.suppressTimeUpdate = false;
        resolve(false);
      } finally {
        AppState.isSeeking = false;
      }
    };

    if (source === 'slider') {
      if (AppState.seekTimeout) clearTimeout(AppState.seekTimeout);
      AppState.seekTimeout = setTimeout(executeSeek, 300);
    } else {
      executeSeek();
    }
  });
}

function extractVideoFiles(files) {
  if (files === undefined) files = [];
  var videoFiles = [];

  for (var i = 0; i < files.length; i++) {
    var name = (files[i].path || '').toLowerCase();
    if (name.indexOf('.mp4') !== -1 || name.indexOf('.mkv') !== -1 || name.indexOf('.avi') !== -1 ||
      name.indexOf('.mov') !== -1 || name.indexOf('.webm') !== -1 || name.indexOf('.m4v') !== -1) {
      videoFiles.push(files[i]);
    }
  }

  return videoFiles;
}

async function resolveTorrentWithFiles(hash, maxAttempts, delayMs) {
  if (maxAttempts === undefined) maxAttempts = 3;
  if (delayMs === undefined) delayMs = 700;

  var torrent = null;
  for (var i = 0; i < AppState.torrents.length; i++) {
    if (AppState.torrents[i].hash && AppState.torrents[i].hash.toLowerCase() === hash.toLowerCase()) {
      torrent = AppState.torrents[i];
      break;
    }
  }

  for (var attempt = 0; attempt < maxAttempts; attempt++) {
    var files = [];

    if (torrent && torrent.file_stats && Array.isArray(torrent.file_stats)) {
      files = torrent.file_stats;
    } else if (torrent && torrent.data) {
      try {
        var data = JSON.parse(torrent.data);
        if (data.TorrServer && Array.isArray(data.TorrServer.Files)) {
          files = data.TorrServer.Files;
        }
      } catch (e) {
        console.error('Ошибка парсинга data:', e);
      }
    }

    if (extractVideoFiles(files).length > 0) {
      return torrent;
    }

    if (attempt < maxAttempts - 1) {
      console.log('🔄 Попытка ' + (attempt + 1) + '/' + maxAttempts + ': обновляем список, чтобы получить файлы серий');
      await refreshTorrentsList();
      for (var j = 0; j < AppState.torrents.length; j++) {
        if (AppState.torrents[j].hash && AppState.torrents[j].hash.toLowerCase() === hash.toLowerCase()) {
          torrent = AppState.torrents[j];
          break;
        }
      }
      await new Promise(function (resolve) { setTimeout(resolve, delayMs); });
    }
  }

  return torrent;
}

// Функция для загрузки информации о сериях
async function loadEpisodesInfo(hash, currentFileId) {
  if (currentFileId === undefined) currentFileId = null;
  console.log('🔍 Загрузка информации о сериях для hash:', hash, 'fileId:', currentFileId);

  if (!hash || !AppState.currentTorrserverUrl) {
    console.log('❌ Нет hash или URL сервера');
    return;
  }

  try {
    var torrent = await resolveTorrentWithFiles(hash, 4, 800);

    console.log('📦 Найден торрент:', torrent ? torrent.title : 'не найден');

    if (!torrent) {
      console.log('❌ Торрент всё ещё не найден');
      return;
    }

    var files = [];

    if (torrent.file_stats && Array.isArray(torrent.file_stats)) {
      console.log('📁 Используем file_stats, найдено файлов:', torrent.file_stats.length);
      files = torrent.file_stats;
    } else if (torrent.data) {
      try {
        var data = JSON.parse(torrent.data);
        if (data.TorrServer && data.TorrServer.Files) {
          console.log('📁 Используем data.TorrServer.Files, найдено файлов:', data.TorrServer.Files.length);
          files = data.TorrServer.Files;
        }
      } catch (e) {
        console.error('Ошибка парсинга data:', e);
      }
    }

    var videoFiles = extractVideoFiles(files);

    console.log('Видеофайлов найдено:', videoFiles.length);

    if (videoFiles.length > 0) {
      currentEpisodeFiles = videoFiles;
      currentTorrentHash = hash;

      if (currentFileId) {
        currentEpisodeIndex = -1;
        for (var i = 0; i < videoFiles.length; i++) {
          if (String(videoFiles[i].id) == String(currentFileId)) {
            currentEpisodeIndex = i;
            break;
          }
        }
        console.log('📍 Текущая серия по fileId:', currentEpisodeIndex + 1);
      } else if (AppState.videoUrl) {
        var match = AppState.videoUrl.match(/\/(\d+)$/);
        if (match && match[1]) {
          currentEpisodeIndex = -1;
          for (var j = 0; j < videoFiles.length; j++) {
            if (String(videoFiles[j].id) == String(match[1])) {
              currentEpisodeIndex = j;
              break;
            }
          }
          console.log('📍 Текущая серия по URL:', currentEpisodeIndex + 1);
        }
      }

      if (currentEpisodeIndex === -1 || currentEpisodeIndex === undefined) {
        currentEpisodeIndex = 0;
        console.log('📍 Индекс не найден, используем первую серию');
      }

      renderEpisodesList();

      var episodesBtn = document.getElementById('episodes-btn');
      if (episodesBtn) {
        episodesBtn.style.display = videoFiles.length > 1 ? 'flex' : 'none';
      }

      updateEpisodeButtons();
    } else {
      console.log('❌ Видеофайлы не найдены');
      currentEpisodeFiles = [];
      currentEpisodeIndex = 0;
      var episodesBtn = document.getElementById('episodes-btn');
      if (episodesBtn) {
        episodesBtn.style.display = 'none';
      }
      updateEpisodeButtons();
    }
  } catch (error) {
    console.error('Ошибка загрузки серий:', error);
  }
}

// Функция для отрисовки списка серий
function renderEpisodesList() {
  var episodesList = document.getElementById('episodes-list');
  if (!episodesList) return;

  if (currentEpisodeFiles.length === 0) {
    episodesList.innerHTML = '<div class="search-result-empty">Нет доступных серий</div>';
    return;
  }

  var html = '';

  // Добавляем информацию о текущей серии
  html += '\n    <div class="current-episode-info">\n      <span class="current-episode-badge">Текущая</span>\n      <span>Серия ' + (currentEpisodeIndex + 1) + ' из ' + currentEpisodeFiles.length + '</span>\n    </div>\n  ';

  for (var idx = 0; idx < currentEpisodeFiles.length; idx++) {
    var file = currentEpisodeFiles[idx];
    var index = idx;
    var isActive = index === currentEpisodeIndex;
    var fileSize = formatBytes(file.length);

    // Номер серии (начинаем с 1)
    var episodeNumber = index + 1;

    html += '\n      <div class="episode-item ' + (isActive ? 'active' : '') + '" data-index="' + index + '" data-file-id="' + file.id + '">\n        <div class="episode-number">' + episodeNumber + '</div>\n        <div class="episode-info">\n          <div class="episode-title">Серия ' + episodeNumber + '</div>\n          <div class="episode-duration">' + fileSize + '</div>\n        </div>\n        <button class="episode-play" title="Воспроизвести">▶</button>\n      </div>\n    ';
  }

  episodesList.innerHTML = html;

  // Добавляем обработчики
  var episodeItems = episodesList.querySelectorAll('.episode-item');
  for (var i = 0; i < episodeItems.length; i++) {
    (function (item) {
      var index = parseInt(item.dataset.index);
      var fileId = item.dataset.fileId;

      // Клик по элементу (переключение серии)
      item.addEventListener('click', function (e) {
        // Игнорируем клик по кнопке play
        if (e.target.classList && e.target.classList.contains('episode-play')) return;
        switchToEpisode(index, fileId);
      });

      // Клик по кнопке play
      var playBtn = item.querySelector('.episode-play');
      if (playBtn) {
        playBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          switchToEpisode(index, fileId);
        });
      }
    })(episodeItems[i]);
  }
}

// Функция переключения на другую серию
async function switchToEpisode(index, fileId) {
  stopTorrentStatsUpdates();
  console.log('🔄 Переключение на серию ' + (index + 1) + ', fileId: ' + fileId);
  console.log('Текущий hash:', currentTorrentHash);

  currentBufferAhead = 0;
  wasImmediatePause = false;
  pauseTimer = null;
  pauseStartTime = null;
  thisisseek = false;

  stopHeartbeat();

  if (!currentTorrentHash || !AppState.currentTorrserverUrl) {
    console.error('❌ Нет hash или URL сервера');
    return;
  }

  // Не переключаемся на текущую серию
  if (index === currentEpisodeIndex) {
    console.log('⚠️ Это уже текущая серия');
    toggleEpisodesPanel();
    return;
  }

  // Останавливаем проверку приближения к концу видео
  if (nearEndCheckInterval) {
    clearInterval(nearEndCheckInterval);
    nearEndCheckInterval = null;
  }

  // Сохраняем таймкод перед переключением
  await saveTimecodeToServer();

  var savedAudioTrack = currentAudioTrack;
  console.log('🎵 Сохраняем аудиодорожку для следующей серии:', savedAudioTrack);

  // Сначала закрываем панель серий
  var episodesPanel = document.getElementById('episodes-panel');
  var episodesBtn = document.getElementById('episodes-btn');
  if (episodesPanel) {
    episodesPanel.classList.add('hidden');
    episodesBtn.classList.remove('active');
  }

  // Показываем оверлей загрузки и блокируем интерфейс
  document.getElementById('playback-overlay').classList.add('active');
  document.querySelector('.playback-text').textContent = 'Переключение на серию ' + (index + 1) + '...';

  // Блокируем кнопки управления
  var controlBtns = document.querySelectorAll('.control-btn');
  for (var i = 0; i < controlBtns.length; i++) {
    var btn = controlBtns[i];
    btn.style.pointerEvents = 'none';
    btn.style.opacity = '0.5';
  }

  try {
    var playUrl = AppState.currentTorrserverUrl + '/play/' + currentTorrentHash + '/' + fileId;

    // Обновляем текущий индекс
    currentEpisodeIndex = index;
    console.log('✅ Новый индекс серии:', currentEpisodeIndex);

    // Обновляем URL в AppState
    AppState.videoUrl = playUrl;

    // Останавливаем текущий HLS поток
    if (AppState.currentStreamId) {
      await fetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST' });
      AppState.currentStreamId = null;
    }

    // Получаем видео элемент и удаляем старый обработчик
    var videoPlayer = document.getElementById('video-player');
    videoPlayer.removeEventListener('ended', handleVideoEnded);

    destroyHls();

    // Сохраняем предпочтение аудиодорожки
    if (currentTorrentHash && fileId) {
      await saveAudioPreference(currentTorrentHash, fileId, savedAudioTrack);
    }

    // Начинаем с начала серии (initialSeek = 0) и передаем сохраненную аудиодорожку
    await startHLSPlayback(playUrl, 0, lastPlaybackFromSearch, index, savedAudioTrack);

    // Обновляем название для новой серии
    var fileName = await getFileNameByHash(currentTorrentHash, fileId);
    if (fileName && AppState.currentDetailItem) {
      updatePlayerTitle(AppState.currentDetailItem.title + ' - ' + fileName);
    }

    // Обновляем список серий
    renderEpisodesList();

    // Обновляем состояние кнопок переключения
    updateEpisodeButtons();

  } catch (error) {
    console.error('❌ Ошибка переключения серии:', error);
    alert('Ошибка при переключении серии');
  } finally {
    // Скрываем оверлей и разблокируем интерфейс
    document.getElementById('playback-overlay').classList.remove('active');
    document.querySelector('.playback-text').textContent = 'Воспроизведение...';

    // Разблокируем кнопки управления
    for (var j = 0; j < controlBtns.length; j++) {
      var btn = controlBtns[j];
      btn.style.pointerEvents = 'auto';
      btn.style.opacity = '1';
    }

    hidePlayerLoading();
    startTorrentStatsUpdates();
  }
}

// Функция для открытия/закрытия панели серий
function toggleEpisodesPanel() {
  var panel = document.getElementById('episodes-panel');
  var btn = document.getElementById('episodes-btn');

  if (!panel || !btn) return;

  if (panel.classList.contains('hidden')) {
    // Загружаем информацию о сериях перед открытием
    if (AppState.currentDetailItem) {
      loadEpisodesInfo(AppState.currentDetailItem.hash);
    }
    panel.classList.remove('hidden');
    btn.classList.add('active');
  } else {
    panel.classList.add('hidden');
    btn.classList.remove('active');
  }
}

// Настройка обработчиков для кнопки серий
function setupEpisodesButton() {
  console.log('🔄 Настройка кнопки серий...');

  var episodesBtn = document.getElementById('episodes-btn');
  var closeEpisodesBtn = document.getElementById('close-episodes');
  var episodesPanel = document.getElementById('episodes-panel');

  console.log('📊 Элементы:', {
    episodesBtn: !!episodesBtn,
    closeEpisodesBtn: !!closeEpisodesBtn,
    episodesPanel: !!episodesPanel
  });

  if (!episodesBtn || !closeEpisodesBtn || !episodesPanel) {
    console.error('❌ Не найдены элементы для кнопки серий');
    return;
  }

  episodesBtn.addEventListener('click', function (e) {
    console.log('👆 Нажата кнопка серий');
    e.stopPropagation();
    toggleEpisodesPanel();
    resetMouseIdleTimer();
  });

  closeEpisodesBtn.addEventListener('click', function () {
    console.log('👆 Нажата кнопка закрытия');
    episodesPanel.classList.add('hidden');
    episodesBtn.classList.remove('active');
    resetMouseIdleTimer();
  });

  // Закрытие панели при клике вне её
  document.addEventListener('click', function (e) {
    if (!episodesPanel.contains(e.target) && !episodesBtn.contains(e.target)) {
      episodesPanel.classList.add('hidden');
      episodesBtn.classList.remove('active');
    }
    resetMouseIdleTimer();
  });

  console.log('✅ Кнопка серий настроена');
}

// Функция для предзагрузки торрента
function preloadTorrents(hash, fileId) {
  if (!hash || !fileId) return;
  if (!AppState.currentTorrserverUrl) return;

  var preloadUrl = AppState.currentTorrserverUrl + "/stream?link=" + hash + "&index=" + fileId + "&preload=preload";

  console.log('🚀 Предзагрузка торрента:', preloadUrl);

  // Используем fetch с keepalive для надежности
  return fetch(preloadUrl, {
    method: 'GET',
    keepalive: true
  }).then(function (response) {
    if (response.ok) {
      console.log('✅ Торрент отправлен на предзагрузку:', hash);
    } else {
      console.log('⚠️ Ошибка предзагрузки торрента:', response.status);
    }

    // Ждем 4 секунды только при успешном выполнении
    return new Promise(function (resolve) {
      setTimeout(resolve, 4500);
    });
  }).catch(function (error) {
    console.error('❌ Ошибка при предзагрузке торрента:', error);
    // При ошибке ничего не ждем, просто возвращаем resolved Promise
    return Promise.resolve();
  });
}

function playInExternalPlayer(url, title) {
  if (!externalPlayerEnabled) return false;

  console.log('📱 Открытие во внешнем плеере:', url);

  // Показываем диалог с инструкцией и ссылкой для ручного нажатия
  var overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.95);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    padding: 20px;
  `;

  overlay.innerHTML = `
    <div style="background: #1e1e1e; border-radius: 12px; padding: 24px; max-width: 300px; text-align: center;">
      <div style="font-size: 48px; margin-bottom: 16px;">📱</div>
      <h3 style="margin: 0 0 8px; color: #fff;">Открыть во внешнем плеере?</h3>
      <p style="margin: 0 0 20px; color: #aaa; font-size: 14px;">${title || 'Видео'}</p>
      <button id="external-player-open-btn" style="
        background: #4a9eff;
        border: none;
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 16px;
        cursor: pointer;
        width: 100%;
        margin-bottom: 12px;
      ">Открыть</button>
      <button id="external-player-cancel-btn" style="
        background: transparent;
        border: 1px solid #555;
        color: #aaa;
        padding: 10px 20px;
        border-radius: 8px;
        font-size: 14px;
        cursor: pointer;
        width: 100%;
      ">Отмена</button>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('external-player-open-btn').onclick = function () {
    // Прямой переход по реальному клику пользователя - РАБОТАЕТ!
    var match = originalUrl.match(/\/play\/([a-fA-F0-9]+)\/(\d+)/);
    if (match) {
      preloadTorrents(match[1], match[2]);
    }      
    window.location.href = 'vlc://'+url;
    overlay.remove();
  };

  document.getElementById('external-player-cancel-btn').onclick = function () {
    overlay.remove();
    return false;
  };

  return true;
}
// Обновленная функция startHLSPlayback с ожиданием буфера (видео на паузе)
async function startHLSPlayback(originalUrl, initialSeek, fromSearch, episodeIndex, audioTrack) {
  if (initialSeek === undefined) initialSeek = null;
  if (fromSearch === undefined) fromSearch = false;
  if (episodeIndex === undefined) episodeIndex = null;
  if (audioTrack === undefined) {
    audioTrack = currentAudioTrack !== undefined ? currentAudioTrack : null;
  }

  if (externalPlayerEnabled) {
    if (playInExternalPlayer(originalUrl, AppState.currentDetailItem.title)) {
      console.log('📱 Запуск во внешнем плеере');
      return; // прерываем встроенное воспроизведение
    }
  }

  // Отменяем предыдущее воспроизведение, если оно есть
  cancelCurrentPlayback();

  // Создаем новый AbortController для текущего воспроизведения
  currentPlaybackController = new AbortController();
  var signal = currentPlaybackController.signal;

  AppState.inSearch = 'torrents';
  currentBufferAhead = 0;
  wasImmediatePause = false;
  pauseTimer = null;
  pauseStartTime = null;

  if (!originalUrl || !originalUrl.trim()) {
    alert('Ошибка: URL не указан');
    return false;
  }

  console.log('Запуск HLS для URL:', originalUrl);
  console.log('Из поиска:', fromSearch);
  console.log('Индекс серии:', episodeIndex);
  console.log('Аудиодорожка:', audioTrack);
  console.log('Начальная позиция (initialSeek):', initialSeek !== null ? formatTime(initialSeek) : 'не указана');

  lastPlaybackFromSearch = fromSearch;

  var match = originalUrl.match(/\/play\/([a-fA-F0-9]+)\/(\d+)/);
  if (match) {
    currentTimecodeData.hash = match[1];
    currentTimecodeData.fileId = match[2];
    currentTimecodeData.timecode = 0;

    // 🚀 ЗАПУСКАЕМ ВСЕ ЗАПРОСЫ ПАРАЛЛЕЛЬНО с поддержкой отмены
    var requests = [
      loadFileInfo(currentTimecodeData.hash, currentTimecodeData.fileId),
      loadAudioPreference(currentTimecodeData.hash, currentTimecodeData.fileId),
      getFileNameByHash(currentTimecodeData.hash, currentTimecodeData.fileId)
    ];

    // Добавляем предзагрузку торрента если initialSeek = null или 0
    if (initialSeek === null || initialSeek === 0) {
      preloadTorrents(currentTimecodeData.hash, currentTimecodeData.fileId);
    }

    // Добавляем загрузку таймкода только если initialSeek === null
    var timecodePromise = null;
    if (initialSeek === null) {
      timecodePromise = loadTimecodeFromServer(currentTimecodeData.hash, currentTimecodeData.fileId);
      requests.push(timecodePromise);
    }

    // Ждем выполнения всех запросов параллельно с проверкой отмены
    var promiseResults = await Promise.all(requests);
    var fileInfo = promiseResults[0];
    var savedAudioTrack = promiseResults[1];
    var fileName = promiseResults[2];
    var savedTimecode = promiseResults[3];

    // Проверяем, не была ли операция отменена
    if (signal.aborted) {
      console.log('⏹️ Воспроизведение отменено во время загрузки данных');
      return false;
    }

    // Обрабатываем результаты
    if (fileInfo && fileInfo.audio) {
      currentAudioTracks = fileInfo.audio;
      currentAudioTrack = audioTrack !== null ? audioTrack : 0;
      console.log('🎵 Загружено аудиодорожек:', currentAudioTracks.length);
    }

    if (savedAudioTrack !== null && savedAudioTrack < currentAudioTracks.length) {
      currentAudioTrack = savedAudioTrack;
      if (audioTrack !== savedAudioTrack) {
        audioTrack = savedAudioTrack;
      }
      console.log('🎵 Используем сохраненное предпочтение: дорожка ' + currentAudioTrack);
    } else {
      currentAudioTrack = audioTrack !== null ? audioTrack : 0;
    }

    console.log('🎵 Загружено аудиодорожек:', currentAudioTracks.length);

    var seekTime = initialSeek;
    if (seekTime === null && timecodePromise) {
      if (savedTimecode > 0) {
        seekTime = savedTimecode;
        console.log('⏱️ Будем использовать сохраненный таймкод: ' + formatTime(savedTimecode));
      } else {
        seekTime = 0;
        console.log('⏱️ Сохраненного таймкода нет, начинаем с начала');
      }
    } else if (seekTime === 0) {
      console.log('⏱️ Явно указано воспроизведение с начала (seekTime=0)');
    } else if (seekTime !== null) {
      console.log('⏱️ Явно указана позиция: ' + formatTime(seekTime));
    }

    initialSeek = seekTime;

    if (fileName) {
      if (AppState.currentDetailItem && AppState.currentDetailItem.title) {
        //updatePlayerTitle(AppState.currentDetailItem.title + ' - ' + fileName);
        updatePlayerTitle(fileName);
      } else {
        updatePlayerTitle(fileName);
      }
    } else if (AppState.currentDetailItem && AppState.currentDetailItem.title) {
      updatePlayerTitle(AppState.currentDetailItem.title);
    }
  }

  // Если есть текущий торрент, загружаем информацию о сериях
  if (AppState.currentDetailItem) {
    console.log('📂 Загружаем информацию о сериях для:', AppState.currentDetailItem.title);

    var currentFileId = (episodeIndex !== null && currentEpisodeFiles[episodeIndex])
      ? currentEpisodeFiles[episodeIndex].id
      : (match ? match[2] : null);

    setTimeout(function () {
      // Проверяем, не была ли операция отменена
      if (!signal.aborted) {
        loadEpisodesInfo(AppState.currentDetailItem.hash, currentFileId);
      }
    }, fromSearch ? 1600 : 1000);
  }

  try {
    var seekParam = (initialSeek && initialSeek > 0) ? ('&start=' + initialSeek.toFixed(2)) : '';
    var durationParam = (fileInfo.duration && fileInfo.duration > 0) ? ('&duration=' + fileInfo.duration.toFixed(0)) : '';
    var audioParam = audioTrack !== null ? ('&audio=' + audioTrack) : '';
    var multiChannelParam = (AppState.multiChannelEnabled === true) ? '&multiChannel=true' : '';
    
    // Используем AbortController для fetch запроса
    var savedClientId = localStorage.getItem('clientId');
    var response = await fetch(SERVER_URL + '/hls/stream?url=' + encodeURIComponent(originalUrl) + seekParam + audioParam + multiChannelParam + '&clientId=' + encodeURIComponent(savedClientId) + durationParam, {
      signal: signal
    });

    if (!response.ok) {
      throw new Error('HTTP ' + response.status);
    }

    var data = await response.json();

    if (!data.success) throw new Error(data.error || 'Ошибка создания потока');

    console.log('📦 Данные потока:', data);
    console.log('👤 Client ID:', data.clientId);
    console.log('🎵 Используемая аудиодорожка:', data.audioTrack);

    AppState.currentStreamId = data.streamId;
    AppState.videoUrl = originalUrl;

    AppState.expectedDuration = data.duration;
    AppState.originalDuration = data.originalDuration || data.duration;
    AppState.seekOffset = data.seekOffset || initialSeek || 0;
    AppState.lastSuccessfulSeek = AppState.seekOffset;

    console.log('📊 Длительность: полная=' + formatTime(AppState.originalDuration) + ', offset=' + AppState.seekOffset.toFixed(2) + 's');

    AppState.currentScreen = 'player';

    // Скрываем все другие экраны
    document.getElementById('config-screen').style.display = 'none';
    document.getElementById('torrserver-section').style.display = 'none';
    document.getElementById('detail-view').style.display = 'none';
    document.getElementById('player-screen').style.display = 'block';

    var focusedElements = document.querySelectorAll('.focused');
    for (var i = 0; i < focusedElements.length; i++) {
      focusedElements[i].classList.remove('focused');
    }

    var controlsContainer = document.getElementById('controls-container');
    if (controlsContainer) {
      controlsContainer.classList.add('idle-hidden');
    }

    if (typeof currentFocusIndex !== 'undefined') {
      currentFocusIndex = 0;
    }

    if (typeof updateFocusableElements === 'function') {
      updateFocusableElements();
    }

    destroyHls();

    var videoPlayer = document.getElementById('video-player');

    videoPlayer.removeEventListener('ended', handleVideoEnded);
    videoPlayer.addEventListener('ended', handleVideoEnded);

    if (Hls.isSupported()) {
      AppState.hls = new Hls({
        maxBufferSize: 64 * 1024 * 1024,
        maxBufferLength: 20,
        maxMaxBufferLength: 30,
        backBufferLength: 5,
        startFragPrefetch: true,
        startLevel: -1,
        abrEwmaDefaultEstimate: 500000,
        abrBandWidthFactor: 0.8,
        abrBandWidthUpFactor: 0.7,
        fragLoadingTimeOut: 10000,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 500,
        manifestLoadingTimeOut: 10000,
        manifestLoadingMaxRetry: 4,
        maxFragLookUpTolerance: 0.25,
        lowLatencyMode: false,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: Infinity,
        maxLiveSyncPlaybackRate: 1,
        liveDurationInfinity: false,
        liveBackBufferLength: 20,
        abrEwmaSlowVoD: 4000,
        abrEwmaFastVoD: 1000,
        enableWorker: !navigator.userAgent.includes('Firefox'),
        //progressive: !navigator.userAgent.includes('Firefox'),
        progressive: false,
        fetchSetup: function (context, initParams) {
          initParams.headers = {
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          };
          return new Request(context.url, initParams);
        }
      });

      var isPlaybackCancelled = false;

      // Обработчик манифеста
      var manifestParsedHandler = function () {
        if (signal.aborted || isPlaybackCancelled) {
          console.log('⏹️ Пропускаем MANIFEST_PARSED из-за отмены');
          return;
        }

        console.log('📜 Манифест распарсен');
        forceUpdateDuration(AppState.expectedDuration, AppState.originalDuration, AppState.seekOffset);
        videoPlayer.currentTime = 0;
        videoPlayer.pause();
        updatePlayPauseButton();
        startTorrentStatsUpdates();

        
        if (thisisseek) {
          console.log('⚡ Продолжение воспроизведения с позиции ' + formatTime(initialSeek) + ', пропускаем накопление буфера');
          hidePlayerLoading();

          if (!signal.aborted && !isPlaybackCancelled) {
            videoPlayer.play()['catch'](function (err) {
              console.log('🔇 Автоплей заблокирован');
              videoPlayer.muted = true;
              videoPlayer.play()['catch'](function () { });
              updateMuteButton();
            });
          }

          videoPlayer.muted = false;
          updateMuteButton();
          videoPlayer.play();
          updatePlayPauseButton(); // Обновляем кнопку паузы/плея (теперь будет пауза)
          startTimecodeSaving();
          resetMouseIdleTimer();
          if (nearEndCheckInterval) clearInterval(nearEndCheckInterval);
          startNearEndCheck();
          startHeartbeat();
          return; // Выходим, чтобы не запускать буферизацию
        }

        console.log('⏳ Ожидание накопления буфера 10 секунд... (видео на паузе)');
        showPlayerLoading('Буферизация... 0/10 сек', null);

        var bufferCheckInterval = null;

        var checkBuffer = function () {
          if (signal.aborted || isPlaybackCancelled) {
            if (bufferCheckInterval) {
              clearInterval(bufferCheckInterval);
              bufferCheckInterval = null;
            }
            return;
          }

          if (videoPlayer.buffered && videoPlayer.buffered.length > 0) {
            var bufferedEnd = videoPlayer.buffered.end(videoPlayer.buffered.length - 1);
            var currentTimeVar = videoPlayer.currentTime;
            var bufferAhead = bufferedEnd - currentTimeVar;

            console.log('📊 Текущий буфер: ' + bufferAhead.toFixed(2) + ' сек');
            var torrServerText = '';
            if (currentTimecodeData.hash && torrentStatsCache.preloadSize > 0) {
              var preloadedText = formatSize(torrentStatsCache.preloaded);
              var speedText = formatSpeed(torrentStatsCache.downloadSpeed);
              torrServerText = preloadedText + ' ' + speedText;
              if (torrentStatsCache.activePeers > 0) {
                torrServerText += ' | пиры: ' + torrentStatsCache.totalPeers + ' / ' + torrentStatsCache.activePeers + ' - ' + torrentStatsCache.connectedSeeders;
              }
            }
            showPlayerLoading('Буферизация... ' + Math.min(10, Math.floor(bufferAhead)) + '/10 сек ' + torrServerText, null);

            if (bufferAhead >= 10) {
              console.log('✅ Буфер накоплен, запускаем воспроизведение');
              if (bufferCheckInterval) {
                clearInterval(bufferCheckInterval);
                bufferCheckInterval = null;
              }
              hidePlayerLoading();

              if (!signal.aborted && !isPlaybackCancelled) {
                videoPlayer.play()['catch'](function (err) {
                  console.log('🔇 Автоплей заблокирован');
                  videoPlayer.muted = true;
                  videoPlayer.play()['catch'](function () { });
                  updateMuteButton();
                });
              }

              videoPlayer.muted = false;
              updateMuteButton();
              updatePlayPauseButton();
              startTimecodeSaving();
              resetMouseIdleTimer();
              if (nearEndCheckInterval) clearInterval(nearEndCheckInterval);
              startNearEndCheck();
              startHeartbeat();
            }
          }
        };

        bufferCheckInterval = setInterval(checkBuffer, 500);

        // Сохраняем интервал для возможной очистки при отмене
        AppState.bufferCheckInterval = bufferCheckInterval;

        setTimeout(function () {
          if (!signal.aborted && !isPlaybackCancelled && bufferCheckInterval) {
            console.log('⚠️ Таймаут ожидания буфера, запускаем принудительно');
            clearInterval(bufferCheckInterval);
            hidePlayerLoading();
            videoPlayer.play()['catch'](function (err) {
              console.log('🔇 Автоплей заблокирован');
              videoPlayer.muted = true;
              videoPlayer.play()['catch'](function () { });
              updateMuteButton();
            });
            videoPlayer.muted = false;
            updateMuteButton();
            updatePlayPauseButton();
            startTimecodeSaving();
            resetMouseIdleTimer();
            if (nearEndCheckInterval) clearInterval(nearEndCheckInterval);
            startNearEndCheck();
            startHeartbeat();
          }
        }, 7000);
      };

      AppState.hls.on(Hls.Events.MANIFEST_PARSED, manifestParsedHandler);

      // Обработчик загрузки фрагментов
      AppState.hls.on(Hls.Events.FRAG_LOADING, function (event, data) {
        if (signal.aborted) return;
        try {
          if (data && data.frag && data.frag.sn !== undefined) {
            console.log('📥 Загрузка сегмента ' + data.frag.sn);
          }
        } catch (e) { }
      });

      AppState.hls.on(Hls.Events.FRAG_LOADED, function (event, data) {
        if (signal.aborted) return;
        try {
          if (!data || !data.frag || !data.stats) return;
          var stats = data.stats;
          if (stats && stats.loading && stats.loading.end && stats.loading.start && stats.loaded) {
            var loadTimeMs = stats.loading.end - stats.loading.start;
            if (loadTimeMs > 0) {
              var sizeKB = stats.loaded / 1024;
              var speedKBps = (sizeKB / loadTimeMs) * 1000;
              console.log('✅ Сегмент ' + data.frag.sn + ' загружен: ' + sizeKB.toFixed(2) + ' KB за ' + loadTimeMs + 'ms (' + speedKBps.toFixed(2) + ' KB/s)');
            } else {
              console.log('✅ Сегмент ' + data.frag.sn + ' загружен (мгновенно)');
            }
          } else {
            console.log('✅ Сегмент ' + data.frag.sn + ' загружен');
          }
        } catch (e) {
          console.log('⚠️ Ошибка при обработке статистики загрузки сегмента');
        }
      });

      AppState.hls.on(Hls.Events.BUFFER_APPENDED, function (event, data) {
        if (signal.aborted) return;
        try {
          var videoPlayerEl = document.getElementById('video-player');
          if (videoPlayerEl && videoPlayerEl.buffered && videoPlayerEl.buffered.length > 0) {
            var bufferedEnd = videoPlayerEl.buffered.end(videoPlayerEl.buffered.length - 1);
            var currentTimeVar = videoPlayerEl.currentTime;
            var bufferAhead = bufferedEnd - currentTimeVar;
            if (bufferAhead > 0 && isFinite(bufferAhead)) {
              console.log('📊 Буфер впереди: ' + bufferAhead.toFixed(2) + 's');
            }
          }
        } catch (e) { }
      });

      var currentPlayingSegment = -1;
      var lastLogTime = 0;
      var lastCleanedSegment = -1;

      AppState.hls.on(Hls.Events.FRAG_CHANGED, function (event, data) {
        if (signal.aborted) return;
        try {
          if (data && data.frag) {
            var frag = data.frag;
            var segmentNumber = frag.sn;
            var segmentDuration = frag.duration || 0;
            var segmentStart = frag.start || 0;

            if (currentPlayingSegment !== segmentNumber) {
              currentPlayingSegment = segmentNumber;
              var startTimeFormatted = formatTime(segmentStart);
              console.log('ВОСПРОИЗВЕДЕНИЕ: Сегмент #' + segmentNumber + ' | Начало: ' + startTimeFormatted + ' | Длительность: ' + segmentDuration.toFixed(2) + 'с | Уровень: ' + frag.level);

              if (frag.programDateTime) {
                var date = new Date(frag.programDateTime);
                console.log('Время сегмента: ' + date.toLocaleTimeString());
              }

              var segmentToDelete = segmentNumber - 3;
              if (segmentToDelete >= 0 && segmentToDelete > lastCleanedSegment) {
                console.log('🧹 Запускаем очистку: текущий сегмент ' + segmentNumber + ', удаляем сегменты до ' + (segmentNumber - 3));
                fetch(SERVER_URL + '/hls/cleanup-segments/' + AppState.currentStreamId, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ keepFromSegment: segmentNumber - 3 })
                })
                  .then(function (response) { return response.json(); })
                  .then(function (data) {
                    if (data.success) {
                      console.log('Очистка выполнена: удалено ' + data.deleted + ' сегментов');
                      lastCleanedSegment = segmentNumber - 3;
                    } else {
                      console.error('Ошибка очистки:', data.error);
                    }
                  })
                ['catch'](function (error) {
                  console.error('Ошибка при вызове cleanup:', error);
                });
              }
            }
          }
        } catch (e) {
          console.log('⚠️ Ошибка при отслеживании сегмента:', e);
        }
      });

      var timeUpdateHandler = function () {
        if (signal.aborted) return;
        try {
          var currentTimeVar = videoPlayer.currentTime;
          if (Date.now() - lastLogTime > 30000) {
            if (videoPlayer.buffered && videoPlayer.buffered.length > 0) {
              for (var idx = 0; idx < videoPlayer.buffered.length; idx++) {
                var start = videoPlayer.buffered.start(idx);
                var end = videoPlayer.buffered.end(idx);
                if (currentTimeVar >= start && currentTimeVar <= end) {
                  var segmentEstimate = Math.floor(currentTimeVar / 10);
                  console.log('⏱️ Текущая позиция: ' + formatTime(currentTimeVar) + ' (примерно сегмент #' + segmentEstimate + ')');
                  lastLogTime = Date.now();
                  break;
                }
              }
            }
          }
        } catch (e) { }
      };

      videoPlayer.addEventListener('timeupdate', timeUpdateHandler);

      AppState.hls.on(Hls.Events.LEVEL_SWITCHED, function (event, data) {
        if (signal.aborted) return;
        console.log('📊 Качество переключено на уровень ' + data.level);
      });

      AppState.hls.on(Hls.Events.ERROR, function (event, data) {
        if (signal.aborted) return;
        console.log('HLS событие ошибки:', {
          type: data.type,
          details: data.details,
          fatal: data.fatal,
          error: data.error ? data.error.message : 'Unknown error'
        });

        if (!data.fatal) return;

        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            console.log('Сетевая ошибка, пробуем восстановить...');
            AppState.hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            console.log('Медиа ошибка, пробуем восстановить...');
            var errorMessage = data.error ? data.error.message || data.error : '';
            var errorDetails = data.details || '';
            var isUnsupportedCodec = false;
            if (errorMessage.toLowerCase().includes('codec') || errorDetails.toLowerCase().includes('codec')) {
              isUnsupportedCodec = true;
            }
            if (AppState.videoUrl && (AppState.videoUrl.toLowerCase().includes('.avi') || AppState.videoUrl.toLowerCase().includes('.vc1'))) {
              isUnsupportedCodec = true;
            }

            if (isUnsupportedCodec) {
              console.log('Обнаружен неподдерживаемый формат (AVI/VC1)');
              document.getElementById('playback-overlay').classList.add('active');
              document.querySelector('.playback-text').textContent = 'Формат AVI или VC1 не поддерживаются на вашем устройстве';
              hidePlayerLoading();
              setTimeout(function () {
                console.log('🚪 Автоматический выход из плеера из-за неподдерживаемого формата');
                var exitBtn = document.getElementById('exit-player-btn');
                if (exitBtn) {
                  exitBtn.click();
                  document.getElementById('playback-overlay').classList.remove('active');
                  document.querySelector('.playback-text').textContent = 'Воспроизведение...';
                } else {
                  if (typeof showDetailView === 'function') {
                    showDetailView();
                    document.getElementById('playback-overlay').classList.remove('active');
                    document.querySelector('.playback-text').textContent = 'Воспроизведение...';
                  }
                }
              }, 4000);
            } else {
              AppState.hls.recoverMediaError();
            }
            break;
          default:
            console.log('Неизвестная фатальная ошибка');
            showPlayerLoading('Ошибка воспроизведения, перезагрузка...');
            setTimeout(function () {
              if (AppState.currentStreamId && !signal.aborted) {
                var videoPlayerEl = document.getElementById('video-player');
                var currentTimeVar = videoPlayerEl.currentTime + AppState.seekOffset;
                startHLSPlayback(AppState.videoUrl, currentTimeVar, false);
              }
            }, 2000);
            break;
        }
      });

      AppState.hls.loadSource(data.playlistUrl);
      AppState.hls.attachMedia(videoPlayer);

    } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari версия с поддержкой отмены
      videoPlayer.src = data.playlistUrl;
      videoPlayer.removeEventListener('ended', handleVideoEnded);
      videoPlayer.addEventListener('ended', handleVideoEnded);

      var isPlaybackCancelled = false;
      var bufferCheckInterval = null;

      var loadedMetadataHandler = function () {
        if (signal.aborted || isPlaybackCancelled) return;

        forceUpdateDuration(AppState.expectedDuration, AppState.originalDuration, AppState.seekOffset);
        videoPlayer.currentTime = 0;
        videoPlayer.pause();
        updatePlayPauseButton();

        console.log('⏳ Ожидание накопления буфера 10 секунд... (Safari, видео на паузе)');
        showPlayerLoading('Буферизация... 0/10 сек', null);

        var checkBuffer = function () {
          if (signal.aborted || isPlaybackCancelled) {
            if (bufferCheckInterval) {
              clearInterval(bufferCheckInterval);
              bufferCheckInterval = null;
            }
            return;
          }

          if (videoPlayer.buffered && videoPlayer.buffered.length > 0) {
            var bufferedEnd = videoPlayer.buffered.end(videoPlayer.buffered.length - 1);
            var currentTimeVar = videoPlayer.currentTime;
            var bufferAhead = bufferedEnd - currentTimeVar;
            showPlayerLoading('Буферизация... ' + Math.min(10, Math.floor(bufferAhead)) + '/10 сек', null);
            if (bufferAhead >= 10) {
              console.log('✅ Буфер накоплен, запускаем воспроизведение (Safari)');
              if (bufferCheckInterval) {
                clearInterval(bufferCheckInterval);
                bufferCheckInterval = null;
              }
              hidePlayerLoading();

              if (!signal.aborted && !isPlaybackCancelled) {
                videoPlayer.play()['catch'](function (err) {
                  videoPlayer.muted = true;
                  videoPlayer.play()['catch'](function () { });
                  updateMuteButton();
                });
              }

              videoPlayer.muted = false;
              updateMuteButton();
              startTimecodeSaving();
              resetMouseIdleTimer();
              if (nearEndCheckInterval) clearInterval(nearEndCheckInterval);
              startNearEndCheck();
              startHeartbeat();
            }
          }
        };

        bufferCheckInterval = setInterval(checkBuffer, 500);
        AppState.bufferCheckInterval = bufferCheckInterval;

        setTimeout(function () {
          if (!signal.aborted && !isPlaybackCancelled && bufferCheckInterval) {
            console.log('⚠️ Таймаут ожидания буфера (Safari)');
            clearInterval(bufferCheckInterval);
            hidePlayerLoading();
            videoPlayer.play()['catch'](function (err) {
              videoPlayer.muted = true;
              videoPlayer.play()['catch'](function () { });
              updateMuteButton();
            });
            videoPlayer.muted = false;
            updateMuteButton();
            startTimecodeSaving();
            resetMouseIdleTimer();
            if (nearEndCheckInterval) clearInterval(nearEndCheckInterval);
            startNearEndCheck();
            startHeartbeat();
          }
        }, 30000);
      };

      videoPlayer.addEventListener('loadedmetadata', loadedMetadataHandler, { once: true });
      AppState.isPlaying = true;
    } else {
      throw new Error('Ваш браузер не поддерживает HLS');
    }

    var playerHint = document.getElementById('player-hint');
    playerHint.style.opacity = '1';
    if (AppState.hintTimeout) clearTimeout(AppState.hintTimeout);
    AppState.hintTimeout = setTimeout(function () { playerHint.style.opacity = '0'; }, 4000);

    return true;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('⏹️ Воспроизведение отменено пользователем');
      return false;
    }
    console.error('❌ Ошибка:', error);
    alert('Ошибка воспроизведения: ' + error.message);
    return false;
  }
}

// Функция для отмены текущего воспроизведения
function cancelCurrentPlayback() {
  if (currentPlaybackController) {
    console.log('⏹️ Отмена текущего воспроизведения...');
    currentPlaybackController.abort();
    currentPlaybackController = null;
    //document.getElementById('playback-overlay').classList.remove('active');
    //document.querySelector('.playback-text').textContent = 'Воспроизведение...';
  }
  
  // Очищаем интервалы буфера
  if (AppState.bufferCheckInterval) {
    clearInterval(AppState.bufferCheckInterval);
    AppState.bufferCheckInterval = null;
  }
  
  // Останавливаем HLS поток
  if (AppState.hls) {
    try {
      AppState.hls.destroy();
      AppState.hls = null;
    } catch(e) {
      console.error('Ошибка при уничтожении HLS:', e);
    }
  }
  
  // Останавливаем поток на сервере
  if (AppState.currentStreamId) {
    fetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST' }).catch(() => {});
    AppState.currentStreamId = null;
  }
  
  // Скрываем оверлей загрузки
  hidePlayerLoading();
  
  // Разблокируем кнопки управления
  var controlBtns = document.querySelectorAll('.control-btn');
  for (var i = 0; i < controlBtns.length; i++) {
    var btn = controlBtns[i];
    btn.style.pointerEvents = 'auto';
    btn.style.opacity = '1';
  }
  //showDetailView();
}

// функция выхода из плеера
function showDetailView() {

  stopTorrentStatsUpdates();
  currentBufferAhead = 0;
  wasImmediatePause = false;
  pauseTimer = null;
  pauseStartTime = null;
  thisisseek = false;
  // Проверяем, не является ли текущее воспроизведение YouTube
  if (AppState.isYoutubePlayback) {
    console.log('Выход из YouTube плеера');

    if (typeof window.exitYoutubePlayer === 'function') {
      window.exitYoutubePlayer();
    } else {
      if (AppState.currentStreamId) {
        fetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST' })['catch'](function () { });
        AppState.currentStreamId = null;
      }
      if (AppState.hls) {
        AppState.hls.destroy();
        AppState.hls = null;
      }
      AppState.isYoutubePlayback = false;
      AppState.currentScreen = 'catalog';
      document.getElementById('player-screen').style.display = 'none';

      var detailView = document.getElementById('detail-view');
      if (detailView && AppState.youtubeContext) {
        detailView.style.display = 'block';
        detailView.style.pointerEvents = 'auto';
      } else {
        if (typeof window.showCatalogList === 'function') {
          window.showCatalogList();
        }
      }
    }

    return;
  }

  // Сохраняем таймкод перед выходом
  saveTimecodeToServer().then(function () {
    // Останавливаем интервал сохранения
    stopTimecodeSaving();

    // После сохранения таймкода, обновляем прогресс в текущей карточке
    if (AppState.currentDetailItem) {
      console.log('🔄 Обновляем прогресс в текущей карточке:', AppState.currentDetailItem.title);
      updateDetailProgress(AppState.currentDetailItem);
    }
  });

  stopHeartbeat();

  // Останавливаем проверку приближения к концу видео
  if (nearEndCheckInterval) {
    clearInterval(nearEndCheckInterval);
    nearEndCheckInterval = null;
  }

  // 🔥 СБРАСЫВАЕМ lastCleanedSegment ПРИ ВЫХОДЕ ИЗ ПЛЕЕРА
  if (typeof lastCleanedSegment !== 'undefined') {
    console.log('🔄 Сброс lastCleanedSegment при выходе: ' + lastCleanedSegment + ' -> -1');
    lastCleanedSegment = -1;
  }

  // Сбрасываем информацию о сериях
  currentEpisodeFiles = [];
  currentEpisodeIndex = 0;
  currentTorrentHash = null;

  // Скрываем название
  updatePlayerTitle(null);

  // Очищаем данные таймкода
  clearTimecodeData();

  // Скрываем панель серий если открыта
  var episodesPanel = document.getElementById('episodes-panel');
  var episodesBtn = document.getElementById('episodes-btn');
  if (episodesPanel) {
    episodesPanel.classList.add('hidden');
    episodesBtn.classList.remove('active');
  }

  // Скрываем панель аудиодорожек
  var audioPanel = document.getElementById('audio-panel');
  var audioBtn = document.getElementById('audio-btn');
  if (audioPanel) {
    audioPanel.classList.add('hidden');
    if (audioBtn) audioBtn.classList.remove('active');
  }

  // Скрываем кнопки
  if (episodesBtn) {
    episodesBtn.style.display = 'none';
  }

  // Скрываем кнопки переключения серий
  var prevBtn = document.getElementById('prev-episode-btn');
  var nextBtn = document.getElementById('next-episode-btn');
  if (prevBtn) prevBtn.style.display = 'none';
  if (nextBtn) nextBtn.style.display = 'none';

  AppState.currentScreen = 'detail';
  var videoPlayer = document.getElementById('video-player');

  // Удаляем обработчик окончания видео
  videoPlayer.removeEventListener('ended', handleVideoEnded);

  videoPlayer.pause();
  videoPlayer.removeAttribute('src');
  videoPlayer.load();
  destroyHls();
  hidePlayerLoading();

  if (AppState.currentStreamId) {
    fetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST' })['catch'](function () { });
    AppState.currentStreamId = null;
  }

  // Скрываем плеер
  document.getElementById('player-screen').style.display = 'none';

  // Показываем секцию торрентов
  document.getElementById('config-screen').style.display = 'none';
  document.getElementById('torrserver-section').style.display = 'block';

  setTimeout(function () {
    if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
      updateFocusableElements();

      var progressBtnIndex = -1;
      if (typeof focusableElements !== 'undefined') {
        for (var i = 0; i < focusableElements.length; i++) {
          var el = focusableElements[i];
          if (el && (el.classList.contains('detail-progress-btn') || el.classList.contains('file-item') || el.classList.contains('back-btn'))) {
            progressBtnIndex = i;
            break;
          }
        }
      }

      setFocus(progressBtnIndex !== -1 ? progressBtnIndex : 0);
    }
  }, 250);
  // сбрасываем торрент при выходе из плеера
  dropTorrentToServer(AppState.currentDetailItem.hash).then(function (result) {
    if (result) {
      console.log('Торрент сброшен');
    } else {
      console.log('Торрент не был сброшен (нет подключения)');
    }
  }).catch(function (error) {  // убраны квадратные скобки
    console.error('❌ Ошибка сброса торрента:', error);
  });
  // Обновляем список торрентов в фоне
  refreshTorrentsList().then(function () {
    console.log('🔄 Список торрентов обновлен после выхода из плеера');

    if (AppState.currentDetailItem && AppState.currentDetailItem.hash) {
      var cacheKey = AppState.currentDetailItem.hash;
      if (progressCache.has(cacheKey)) {
        progressCache.delete(cacheKey);
        console.log('🗑️ Кэш прогресса очищен для', cacheKey);
      }
    }
  })['catch'](function (error) {
    console.error('❌ Ошибка обновления списка:', error);
  });

  // Открываем карточку только если воспроизведение было из поиска
  if (lastPlaybackFromSearch && lastAddedTorrentHash) {
    console.log('📂 Открываем карточку торрента из поиска:', lastAddedTorrentHash);

    setTimeout(function () {
      var found = showDetailByHash(lastAddedTorrentHash);
      if (!found) {
        console.log('⚠️ Торрент не найден по hash, пробуем обновить список еще раз');
        refreshTorrentsList().then(function () {
          showDetailByHash(lastAddedTorrentHash);
        });
      }
    }, 500);

    lastPlaybackFromSearch = false;
  } else {
    console.log('📂 Возврат к исходной карточке (не из поиска)');
    if (AppState.currentDetailItem) {
      var detailView = document.getElementById('detail-view');
      detailView.style.display = 'block';
      updateDetailProgress(AppState.currentDetailItem);
    } else {
      document.getElementById('detail-view').style.display = 'none';
    }
  }
}


// Обновление прогресса в детальном просмотре
async function updateDetailProgress(torrent) {
  if (!torrent || !torrent.hash) return;

  console.log('🔄 Обновление прогресса для:', torrent.title);

  // Очищаем кэш для этого торрента
  var cacheKey = torrent.hash;
  if (progressCache.has(cacheKey)) {
    progressCache.delete(cacheKey);
  }

  // Удаляем ВСЕ старые блоки прогресса (не только с id='detail-progress')
  var oldProgresses = document.querySelectorAll('#detail-progress, .detail-progress');
  for (var i = 0; i < oldProgresses.length; i++) {
    console.log('🗑️ Удаляем старый блок прогресса');
    oldProgresses[i].remove();
  }

  // Загружаем новый прогресс
  var progress = await loadProgressForTorrent(torrent);

  if (!progress) {
    console.log('📭 Нет прогресса для отображения');
    return;
  }

  var detailHeader = document.querySelector('.detail-header');
  if (!detailHeader) return;

  var progressDiv = document.createElement('div');
  progressDiv.id = 'detail-progress';
  progressDiv.className = 'detail-progress';
  progressDiv.dataset.hash = torrent.hash;

  var timeStr = formatTime(progress.timecode);
  var totalStr = progress.duration ? formatTime(progress.duration) : '??:??';

  if (progress.isSeries) {
    var episodeNum = progress.episodeIndex + 1;
    progressDiv.innerHTML = '\n      <div class="detail-progress-content">\n        <div class="detail-progress-info">\n          <span class="detail-progress-label">Продолжить просмотр:</span>\n          <span class="detail-progress-episode">📺 Серия ' + episodeNum + '</span>\n          <span class="detail-progress-time">⏱️ ' + timeStr + ' / ' + totalStr + '</span>\n        </div>\n        <button class="detail-progress-btn" data-hash="' + progress.hash + '" data-file-id="' + progress.fileId + '" data-timecode="' + progress.timecode + '" data-episode-index="' + progress.episodeIndex + '">\n          ▶ Продолжить с ' + timeStr + '\n        </button>\n      </div>\n    ';
  } else {
    progressDiv.innerHTML = '\n      <div class="detail-progress-content">\n        <div class="detail-progress-info">\n          <span class="detail-progress-label">Продолжить просмотр:</span>\n          <span class="detail-progress-time">⏱️ ' + timeStr + ' / ' + totalStr + '</span>\n        </div>\n        <button class="detail-progress-btn" data-hash="' + progress.hash + '" data-file-id="' + progress.fileId + '" data-timecode="' + progress.timecode + '" data-episode-index="0">\n          ▶ Продолжить с ' + timeStr + '\n        </button>\n      </div>\n    ';
  }

  var progressBtn = progressDiv.querySelector('.detail-progress-btn');
  progressBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    var hash = progress.hash;
    var fileId = progress.fileId;
    var timecode = progress.timecode;
    var episodeIndex = parseInt(progressBtn.dataset.episodeIndex || 0);

    var playUrl = AppState.currentTorrserverUrl + '/play/' + hash + '/' + fileId;

    document.getElementById('playback-overlay').classList.add('active');
    document.getElementById('detail-view').style.pointerEvents = 'none';

    startHLSPlayback(playUrl, timecode, false, episodeIndex).then(function () {
      document.getElementById('playback-overlay').classList.remove('active');
      document.getElementById('detail-view').style.pointerEvents = 'auto';
    })['catch'](function () {
      document.getElementById('playback-overlay').classList.remove('active');
      document.getElementById('detail-view').style.pointerEvents = 'auto';
    });
  });

  // Убеждаемся, что вставляем только один раз
  var existingProgress = document.getElementById('detail-progress');
  if (existingProgress) {
    existingProgress.remove();
  }

  detailHeader.parentNode.insertBefore(progressDiv, detailHeader.nextSibling);
  console.log('✅ Прогресс обновлен в карточке');

  // 🔥 ОБНОВЛЯЕМ ПОЛОСКУ ПРОГРЕССА ДЛЯ ТЕКУЩЕГО ФАЙЛА
  await updateCurrentFileProgress(torrent.hash, progress.fileId, progress.episodeIndex);
}

// Вспомогательная функция для обновления полоски прогресса
async function updateCurrentFileProgress(hash, fileId, episodeIndex) {
  if (!hash || !fileId) return;

  // Находим file-item с соответствующим hash и fileId
  var fileItems = document.querySelectorAll('.file-item');
  var targetItem = null;

  for (var i = 0; i < fileItems.length; i++) {
    var item = fileItems[i];
    if (item.dataset.hash === hash && item.dataset.fileId == fileId) {
      targetItem = item;
      break;
    }
  }

  if (!targetItem) {
    console.log('⚠️ Не найден file-item для обновления полоски прогресса');
    return;
  }

  try {
    var savedClientId = localStorage.getItem('clientId');
    var response = await fetch(SERVER_URL + '/api/timecode/get?hash=' + hash + '&fileId=' + fileId + '&clientId=' + encodeURIComponent(savedClientId));

    if (response.ok) {
      var data = await response.json();
      if (data.success && data.timecode > 0 && data.duration && data.duration > 0) {
        var progressPercent = (data.timecode / data.duration) * 100;
        progressPercent = Math.min(progressPercent, 98);

        var progressFill = targetItem.querySelector('.file-progress-fill');
        if (progressFill) {
          progressFill.style.width = progressPercent + '%';
          if (progressPercent > 5) {
            targetItem.classList.add('has-progress');
          }
        }
        console.log('✅ Полоска прогресса обновлена:', progressPercent.toFixed(1) + '%');
      }
    }
  } catch (error) {
    console.error('Ошибка обновления полоски прогресса:', error);
  }
}

// НОВАЯ ФУНКЦИЯ: Загрузка информации о файле
async function loadFileInfo(hash, fileId) {
  try {
    var savedClientId = localStorage.getItem('clientId');
    var response = await fetch(SERVER_URL + '/api/file/info?hash=' + hash + '&fileId=' + fileId + '&clientId=' + encodeURIComponent(savedClientId));
    if (response.ok) {
      var data = await response.json();
      return data;
    }
  } catch (error) {
    console.error('Ошибка загрузки информации о файле:', error);
  }
  return null;
}

// НОВАЯ ФУНКЦИЯ: Отображение списка аудиодорожек
function renderAudioTracks() {
  var audioList = document.getElementById('audio-list');
  if (!audioList) return;

  if (!currentAudioTracks || currentAudioTracks.length === 0) {
    audioList.innerHTML = '<div class="search-result-empty">Нет аудиодорожек</div>';
    return;
  }

  var html = '';

  for (var idx = 0; idx < currentAudioTracks.length; idx++) {
    var track = currentAudioTracks[idx];
    var index = idx;
    var isActive = index === currentAudioTrack;
    var language = track.language || 'unknown';
    var channels = track.channels ? (track.channels + ' ch') : '';
    var codec = track.codec || '';

    html += '\n      <div class="audio-item ' + (isActive ? 'active' : '') + '" data-track-index="' + index + '">\n        <div class="audio-icon">🔊</div>\n        <div class="audio-info">\n          <div class="audio-title">' + escapeHtml(track.title || ('Дорожка ' + (index + 1))) + '</div>\n          <div class="audio-details">\n            <span class="audio-language">' + language.toUpperCase() + '</span>\n            ' + (channels ? '<span class="audio-channels">' + channels + '</span>' : '') + '\n            ' + (codec ? '<span class="audio-codec">' + codec + '</span>' : '') + '\n          </div>\n        </div>\n        <div class="audio-check">✓</div>\n      </div>\n    ';
  }

  audioList.innerHTML = html;

  // Добавляем обработчики
  var audioItems = audioList.querySelectorAll('.audio-item');
  for (var i = 0; i < audioItems.length; i++) {
    (function (item) {
      item.addEventListener('click', function () {
        var trackIndex = parseInt(item.dataset.trackIndex);
        switchAudioTrack(trackIndex);
      });
    })(audioItems[i]);
  }
}

// НОВАЯ ФУНКЦИЯ: Переключение аудиодорожки
async function switchAudioTrack(trackIndex) {
  if (trackIndex === currentAudioTrack) {
    toggleAudioPanel();
    return;
  }

  thisisseek = false;

  console.log('🔊 Переключение на аудиодорожку ' + trackIndex);

  // Сохраняем текущий таймкод
  await saveTimecodeToServer();

  // Сохраняем предпочтение аудиодорожки
  if (currentTimecodeData.hash && currentTimecodeData.fileId) {
    await saveAudioPreference(currentTimecodeData.hash, currentTimecodeData.fileId, trackIndex);
  }

  // Закрываем панель
  var audioPanel = document.getElementById('audio-panel');
  var audioBtn = document.getElementById('audio-btn');
  if (audioPanel) {
    audioPanel.classList.add('hidden');
    audioBtn.classList.remove('active');
  }

  // Получаем текущее время
  var videoPlayer = document.getElementById('video-player');
  var currentTime = videoPlayer.currentTime + AppState.seekOffset;

  // Показываем оверлей загрузки
  document.getElementById('playback-overlay').classList.add('active');
  document.querySelector('.playback-text').textContent = 'Переключение аудиодорожки...';

  try {
    // Формируем URL с параметром аудиодорожки
    var parsed = AppState.videoUrl.match(/\/play\/([a-fA-F0-9]+)\/(\d+)/);
    if (!parsed) return;

    var hash = parsed[1];
    var fileId = parsed[2];
    var playUrl = AppState.currentTorrserverUrl + '/play/' + hash + '/' + fileId;

    // Останавливаем текущий поток
    if (AppState.currentStreamId) {
      await fetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST' });
      AppState.currentStreamId = null;
    }

    destroyHls();

    // Запускаем новый поток с выбранной аудиодорожкой и текущим временем
    await startHLSPlayback(playUrl, currentTime, lastPlaybackFromSearch, currentEpisodeIndex, trackIndex);

    // Обновляем текущую дорожку
    currentAudioTrack = trackIndex;

    // Обновляем отображение
    renderAudioTracks();

  } catch (error) {
    console.error('❌ Ошибка переключения аудиодорожки:', error);
    alert('Ошибка при переключении аудиодорожки');
  } finally {
    document.getElementById('playback-overlay').classList.remove('active');
    document.querySelector('.playback-text').textContent = 'Воспроизведение...';
  }
}

// НОВАЯ ФУНКЦИЯ: Открытие/закрытие панели аудиодорожек
function toggleAudioPanel() {
  var panel = document.getElementById('audio-panel');
  var btn = document.getElementById('audio-btn');
  var episodesPanel = document.getElementById('episodes-panel');
  var episodesBtn = document.getElementById('episodes-btn');

  if (!panel || !btn) return;

  if (panel.classList.contains('hidden')) {
    // Закрываем панель серий если открыта
    if (episodesPanel && !episodesPanel.classList.contains('hidden')) {
      episodesPanel.classList.add('hidden');
      episodesBtn.classList.remove('active');
    }

    panel.classList.remove('hidden');
    btn.classList.add('active');
    renderAudioTracks();
  } else {
    panel.classList.add('hidden');
    btn.classList.remove('active');
  }
}

// НОВАЯ ФУНКЦИЯ: Настройка кнопки аудиодорожек
function setupAudioButton() {
  console.log('🔄 Настройка кнопки аудиодорожек...');

  var audioBtn = document.getElementById('audio-btn');
  var closeAudioBtn = document.getElementById('close-audio');
  var audioPanel = document.getElementById('audio-panel');

  if (!audioBtn || !closeAudioBtn || !audioPanel) {
    console.error('❌ Не найдены элементы для кнопки аудиодорожек');
    return;
  }

  audioBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    toggleAudioPanel();
    resetMouseIdleTimer();
  });

  closeAudioBtn.addEventListener('click', function () {
    audioPanel.classList.add('hidden');
    audioBtn.classList.remove('active');
    resetMouseIdleTimer();
  });

  // Закрытие панели при клике вне её
  document.addEventListener('click', function (e) {
    if (!audioPanel.contains(e.target) && !audioBtn.contains(e.target)) {
      audioPanel.classList.add('hidden');
      audioBtn.classList.remove('active');
    }
  });

  console.log('✅ Кнопка аудиодорожек настроена');
}

// НОВАЯ ФУНКЦИЯ: Сохранение предпочтения аудиодорожки
async function saveAudioPreference(hash, fileId, audioTrack) {
  try {
    var savedClientId = localStorage.getItem('clientId');
    var response = await fetch(SERVER_URL + '/api/audio/pref/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: hash, fileId: fileId, audioTrack: audioTrack, clientId: savedClientId})
    });

    if (response.ok) {
      console.log('🎵 Предпочтение аудиодорожки сохранено: ' + audioTrack);
    }
  } catch (error) {
    console.error('Ошибка сохранения предпочтения аудиодорожки:', error);
  }
}

// НОВАЯ ФУНКЦИЯ: Загрузка предпочтения аудиодорожки
async function loadAudioPreference(hash, fileId) {
  try {
    var savedClientId = localStorage.getItem('clientId');
    var response = await fetch(SERVER_URL + '/api/audio/pref/get?hash=' + hash + '&fileId=' + fileId + '&clientId=' + encodeURIComponent(savedClientId));
    if (response.ok) {
      var data = await response.json();
      if (data.success && data.audioTrack !== null) {
        console.log('🎵 Загружено предпочтение аудиодорожки: ' + data.audioTrack);
        return data.audioTrack;
      }
    }
  } catch (error) {
    console.error('Ошибка загрузки предпочтения аудиодорожки:', error);
  }
  return null;
}

async function handleVideoEnded() {
  console.log('🏁 Видео завершено');

  stopHeartbeat();
  stopTorrentStatsUpdates();

  // Сохраняем таймкод перед переключением
  await saveTimecodeToServer();

  // Проверяем, есть ли следующая серия
  if (currentEpisodeFiles.length > 0 && currentEpisodeIndex < currentEpisodeFiles.length - 1) {
    console.log('➡️ Автоматическое переключение на следующую серию');

    // Показываем оверлей загрузки
    document.getElementById('playback-overlay').classList.add('active');
    document.querySelector('.playback-text').textContent = 'Автоматическое переключение на серию ' + (currentEpisodeIndex + 2) + '...';

    // Блокируем кнопки управления
    var controlBtns = document.querySelectorAll('.control-btn');
    for (var i = 0; i < controlBtns.length; i++) {
      var btn = controlBtns[i];
      btn.style.pointerEvents = 'none';
      btn.style.opacity = '0.5';
    }

    try {
      // Переключаем на следующую серию
      var nextFile = currentEpisodeFiles[currentEpisodeIndex + 1];
      await switchToEpisode(currentEpisodeIndex + 1, nextFile.id);
    } catch (error) {
      console.error('❌ Ошибка автоматического переключения:', error);
    } finally {
      // Скрываем оверлей и разблокируем интерфейс
      document.getElementById('playback-overlay').classList.remove('active');
      document.querySelector('.playback-text').textContent = 'Воспроизведение...';

      for (var j = 0; j < controlBtns.length; j++) {
        var btn = controlBtns[j];
        btn.style.pointerEvents = 'auto';
        btn.style.opacity = '1';
      }
    }
  } else {
    // Если серий больше нет или сериальный режим не активен, закрываем плеер
    console.log('Серии закончились или сериальный режим не активен, закрываем плеер');

    // Показываем сообщение перед закрытием
    var overlay = document.getElementById('playback-overlay');
    overlay.classList.add('active');
    document.querySelector('.playback-text').textContent = 'Воспроизведение завершено';

    // Небольшая задержка перед закрытием, чтобы пользователь увидел сообщение
    setTimeout(function () {
      overlay.classList.remove('active');
      // Закрываем плеер
      showDetailView();
    }, 1500);
  }
}

function startNearEndCheck() {
  if (nearEndCheckInterval) {
    clearInterval(nearEndCheckInterval);
  }

  nearEndCheckInterval = setInterval(function () {
    var videoPlayer = document.getElementById('video-player');
    var totalDuration = AppState.originalDuration || AppState.expectedDuration || videoPlayer.duration;
    var currentTime = videoPlayer.currentTime + AppState.seekOffset;

    // Если до конца осталось меньше 5 секунд и видео не на паузе и не завершено
    if (totalDuration > 0 &&
      currentTime >= totalDuration - 5 &&
      !videoPlayer.paused &&
      !videoPlayer.ended) {

      console.log('⚠️ Приближаемся к концу видео, осталось:', (totalDuration - currentTime).toFixed(1), 'сек');

      // Можно добавить визуальное предупреждение здесь
      // Например, показать уведомление о скором переключении серии
    }
  }, 1000);
}

function exitPlayer() {
  if (nearEndCheckInterval) {
    clearInterval(nearEndCheckInterval);
    nearEndCheckInterval = null;
  }
}

function setupPageUnloadHandler() {

  if (!externalPlayerEnabled) {

    // Добавляем событие unload - оно срабатывает даже при закрытии приложения
    window.addEventListener('unload', function () {
      console.log('🔄 Приложение закрывается, останавливаем HLS поток...');

      // Синхронный вызов через sendBeacon (самый надежный)
      if (AppState && AppState.currentStreamId) {
        navigator.sendBeacon(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, '');
      }

      // Сохраняем таймкод
      if (currentTimecodeData && currentTimecodeData.hash && currentTimecodeData.fileId && currentTimecodeData.timecode > 0) {
        var savedClientId = localStorage.getItem('clientId');
        var timecodeData = JSON.stringify({
          clientId: savedClientId,
          hash: currentTimecodeData.hash,
          fileId: currentTimecodeData.fileId,
          timecode: currentTimecodeData.timecode,
          duration: currentTimecodeData.duration
        });
        navigator.sendBeacon(SERVER_URL + '/api/timecode/save', timecodeData);
      }
    });

    // Обработчик закрытия страницы/вкладки
    window.addEventListener('beforeunload', function () {
      console.log('🔄 Страница закрывается, останавливаем HLS поток...');

      // Синхронный запрос на остановку потока
      if (AppState.currentStreamId) {
        // Используем sendBeacon для гарантированной отправки даже при закрытии
        var blob = new Blob([], { type: 'application/json' });
        navigator.sendBeacon(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, blob);

        // Также пытаемся отправить обычный fetch (но он может не успеть)
        fetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, {
          method: 'POST',
          keepalive: true  // Важно! Позволяет запросу выполняться после закрытия страницы
        }).catch(() => { });
      }

      // Сохраняем таймкод при закрытии
      if (currentTimecodeData.hash && currentTimecodeData.fileId && currentTimecodeData.timecode > 0) {
        var savedClientId = localStorage.getItem('clientId');
        var timecodeData = JSON.stringify({
          clientId: savedClientId,
          hash: currentTimecodeData.hash,
          fileId: currentTimecodeData.fileId,
          timecode: currentTimecodeData.timecode,
          duration: currentTimecodeData.duration
        });

        navigator.sendBeacon(SERVER_URL + '/api/timecode/save', timecodeData);
      }
    });

    // Также обрабатываем событие pagehide (для мобильных браузеров)
    window.addEventListener('pagehide', function () {
      console.log('🔄 Страница скрывается, останавливаем HLS поток...');

      if (AppState.currentStreamId) {
        navigator.sendBeacon(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, '');
      }

      if (currentTimecodeData.hash && currentTimecodeData.fileId && currentTimecodeData.timecode > 0) {
        var savedClientId = localStorage.getItem('clientId');
        var timecodeData = JSON.stringify({
          clientId: savedClientId,
          hash: currentTimecodeData.hash,
          fileId: currentTimecodeData.fileId,
          timecode: currentTimecodeData.timecode,
          duration: currentTimecodeData.duration
        });

        navigator.sendBeacon(SERVER_URL + '/api/timecode/save', timecodeData);
      }
    });

    // Для visibilitychange (переключение вкладок) - останавливаем видео для экономии ресурсов
    document.addEventListener('visibilitychange', function () {
      var videoPlayer = document.getElementById('video-player');
      if (document.hidden && videoPlayer && !videoPlayer.paused) {
        console.log('👁️ Вкладка скрыта, ставим видео на паузу');
        videoPlayer.pause();
        updatePlayPauseButton();
      }
    });
  }
}

// Вызовите эту функцию при загрузке
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupPageUnloadHandler);
} else {
  setupPageUnloadHandler();
}

// Функция обновления часов
function updateClock() {
  var clock = document.getElementById('clock-display');
  if (!clock) return;

  var now = new Date();
  var hours = now.getHours().toString().padStart(2, '0');
  var minutes = now.getMinutes().toString().padStart(2, '0');

  clock.textContent = hours + ':' + minutes;
}

// Запускаем обновление каждую минуту
updateClock();
setInterval(updateClock, 60000);

// Делаем функции доступными глобально
window.showDetailView = showDetailView;
window.setupEpisodesButton = setupEpisodesButton;
window.nextEpisode = nextEpisode;
window.prevEpisode = prevEpisode;
window.exitPlayer = exitPlayer;
window.cancelCurrentPlayback = cancelCurrentPlayback;
