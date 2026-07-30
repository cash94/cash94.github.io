// Функции плеера
// Переменные для хранения информации о сериях
var currentEpisodeFiles = [];
var currentEpisodeIndex = 0;
var currentTorrentHash = null;
var lastCleanedSegment = -1;
var nearEndCheckInterval = null;
var thisisseek = false;

// Константы конфигурации
var BUFFER_TARGET_SEC = 10;
var LOADING_TIMEOUT_MS = 15000;
var EPISODES_LOAD_DELAY_MS = 1000;
var EPISODES_LOAD_DELAY_SEARCH_MS = 1600;
var MAX_PLAYBACK_RETRIES = 3;

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
var currentSubTracks = [];
var currentAudioTrack = 0;
var currentSubtitleTrack = -1; // -1 означает "выключены"
var currentFileInfo = null;
var heartbeatInterval = null;
var currentBufferAhead = 0;
var wasImmediatePause = false;
var pauseTimer = null;
var pauseStartTime = null;
var PAUSE_THRESHOLD = 60000; // 1 минута

// Для отмены воспроизведения
var currentPlaybackController = null;
var skipData = [];

// Переменные для кнопки пропуска
var skipButton = null;
var skipButtonTimeout = null;
var currentSkipData = null;
var skipButtonActive = false;
var currentSkipInfo = null;
var currentSkipRangeKey = null;
var skipIntro = 0;
var skipCredits = 0;

function createSkipButton() {
  if (skipButton) {
    skipButton.remove();
    skipButton = null;
  }
  skipButton = document.createElement('div');
  skipButton.id = 'skip-button';
  skipButton.className = 'skip-button hidden';
  skipButton.innerHTML = '⏩ Пропустить';
  document.body.appendChild(skipButton);
  return skipButton;
}

window.executeSkip = function () {
  if (!skipButtonActive || !currentSkipInfo) return false;
  var videoPlayer = getEl('video-player');
  if (!videoPlayer) return false;
  if (currentSkipInfo && currentSkipInfo.type === 'intro') {
    var seekTime = currentSkipInfo.endMs / 1000;
    seekStream(seekTime, 'slider');
    console.log('⏩ Пропуск интро, перемотка на ' + formatTime(seekTime));
  } else if (currentSkipInfo && currentSkipInfo.type === 'credits') {
    console.log('⏩ Пропуск титров, переключение на следующую серию');
    nextEpisode();
  }
  hideSkipButton();
  return true;
};

function showSkipButton(type, startMs, endMs) {
  if (!skipButton) createSkipButton();
  var rangeKey = type + '' + startMs + '' + endMs;
  if (skipButtonActive && currentSkipRangeKey === rangeKey) return;
  if (skipButtonActive) hideSkipButton();
  if (skipButtonTimeout) {
    clearTimeout(skipButtonTimeout);
    skipButtonTimeout = null;
  }
  skipButton.classList.remove('filled');
  var buttonText = type === 'intro' ? '⏩ Пропустить вступление' : '⏩ Пропустить титры';
  skipButton.innerHTML = buttonText;
  skipButton.classList.remove('hidden');
  skipButton.classList.add('visible');
  skipButton.style.display = 'flex';
  currentSkipInfo = { type: type, startMs: startMs, endMs: endMs };
  currentSkipRangeKey = rangeKey;
  skipButtonActive = true;
  if (typeof window.focusEl === 'function') window.focusEl(skipButton);

  skipButtonTimeout = setTimeout(function () { hideSkipButton(); }, 10000);
  setTimeout(function () {
    if (skipButton && skipButtonActive) skipButton.classList.add('filled');
  }, 50);
  console.log('🎬 Показана кнопка пропуска:', type, 'старт:', (startMs / 1000).toFixed(1), 'сек, конец:', (endMs / 1000).toFixed(1), 'сек');
}

function hideSkipButton() {
  if (skipButton) {
    skipButton.classList.add('hidden');
    skipButton.classList.remove('visible');
    skipButton.classList.remove('focused');
    skipButton.style.display = 'none';
  }
  if (skipButtonTimeout) {
    clearTimeout(skipButtonTimeout);
    skipButtonTimeout = null;
  }
  skipButtonActive = false;
  currentSkipInfo = null;
  currentSkipRangeKey = null;
  if (typeof window.updateFocusableElements === 'function') {
    setTimeout(function () { window.updateFocusableElements(); }, 50);
  }
}

function checkAndShowSkipButton(currentTimeSec) {
  if (!skipData || skipData.error) {
    if (skipButtonActive) hideSkipButton();
    return;
  }
  var currentTimeMs = currentTimeSec * 1000;
  var videoPlayer = getEl('video-player');
  var totalDuration = AppState.originalDuration || AppState.expectedDuration || videoPlayer.duration;
  var totalDurationMs = totalDuration * 1000;
  var inAnyRange = false;
  var newRangeKey = null, newType = null, newStartMs = null, newEndMs = null;

  if (skipData.intro && Array.isArray(skipData.intro) && skipData.intro.length > 0) {
    for (var i = 0; i < skipData.intro.length; i++) {
      var intro = skipData.intro[i];
      var introStartMs = (intro.start_ms !== null && intro.start_ms !== undefined) ? intro.start_ms : 0;
      var introEndMs = (intro.end_ms !== null && intro.end_ms !== undefined) ? intro.end_ms : 0;
      if (currentTimeMs >= introStartMs && currentTimeMs <= introEndMs) {
        inAnyRange = true;
        newRangeKey = 'intro_' + introStartMs + '_' + introEndMs;
        newType = 'intro'; newStartMs = introStartMs; newEndMs = introEndMs;
        skipIntro = skipIntro + 1;
        break;
      }
    }
  }

  if (!inAnyRange && skipData.credits && Array.isArray(skipData.credits) && skipData.credits.length > 0) {
    for (var j = 0; j < skipData.credits.length; j++) {
      var credits = skipData.credits[j];
      var creditsStartMs = (credits.start_ms !== null && credits.start_ms !== undefined) ? credits.start_ms : 0;
      var creditsEndMs = (credits.end_ms !== null && credits.end_ms !== undefined) ? credits.end_ms : totalDurationMs;
      if (currentTimeMs >= creditsStartMs && currentTimeMs <= creditsEndMs) {
        inAnyRange = true;
        newRangeKey = 'credits_' + creditsStartMs + '_' + creditsEndMs;
        newType = 'credits'; newStartMs = creditsStartMs; newEndMs = credits.end_ms;
        skipCredits = skipCredits + 1;
        break;
      }
    }
  }

  if (inAnyRange) {
    if (!skipButtonActive || currentSkipRangeKey !== newRangeKey) {
      if (skipIntro == 1 || skipCredits == 1) showSkipButton(newType, newStartMs, newEndMs);
    }
  } else if (skipButtonActive) {
    hideSkipButton();
  }
}

function startHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(function () {
    if (AppState.currentStreamId && AppState.currentScreen === 'player') {
      fetch(SERVER_URL + '/hls/activity/' + AppState.currentStreamId, { method: 'POST' })['catch'](function (e) {
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

document.addEventListener('DOMContentLoaded', function () {
  var episodesBtn = getEl('episodes-btn');
  if (episodesBtn) episodesBtn.style.display = 'none';
  var prevBtn = getEl('prev-episode-btn');
  var nextBtn = getEl('next-episode-btn');
  if (prevBtn) prevBtn.style.display = 'none';
  if (nextBtn) nextBtn.style.display = 'none';
});

function updateEpisodeButtons() {
  var prevBtn = getEl('prev-episode-btn');
  var nextBtn = getEl('next-episode-btn');
  if (!prevBtn || !nextBtn) return;
  var filesLen = currentEpisodeFiles.length;
  if (filesLen > 0) {
    prevBtn.style.display = 'flex';
    nextBtn.style.display = 'flex';
    prevBtn.style.opacity = currentEpisodeIndex === 0 ? '0.3' : '1';
    prevBtn.style.pointerEvents = currentEpisodeIndex === 0 ? 'none' : 'auto';
    nextBtn.style.opacity = currentEpisodeIndex === filesLen - 1 ? '0.3' : '1';
    nextBtn.style.pointerEvents = currentEpisodeIndex === filesLen - 1 ? 'none' : 'auto';
  } else {
    prevBtn.style.display = 'none';
    nextBtn.style.display = 'none';
  }
}

function updatePlayerTitle(title) {
  var titleElement = getEl('player-title');
  var controlsContainer = getEl('controls-container');
  if (!titleElement) return;
  if (title) {
    titleElement.textContent = title;
    titleElement.dataset.hasTitle = '1';
    if (controlsContainer && controlsContainer.classList.contains('idle-hidden')) {
      titleElement.classList.add('hidden', 'idle-hidden');
    } else {
      titleElement.classList.remove('hidden', 'idle-hidden');
    }
  } else {
    titleElement.dataset.hasTitle = '';
    titleElement.classList.add('hidden', 'idle-hidden');
  }
}

function syncPlayerTitleVisibility(forceVisible) {
  if (forceVisible === undefined) forceVisible = null;
  var titleElement = getEl('player-title');
  var subtitleElement = getEl('player-subtitle');
  var controlsContainer = getEl('controls-container');
  if (!titleElement) return;
  var hasTitle = !!titleElement.dataset.hasTitle;
  if (!hasTitle) {
    titleElement.classList.add('hidden', 'idle-hidden');
    subtitleElement.classList.add('hidden', 'idle-hidden');
    return;
  }
  var shouldShow = forceVisible === null ? !!(controlsContainer && !controlsContainer.classList.contains('idle-hidden')) : !!forceVisible;
  if (shouldShow) {
    titleElement.classList.remove('hidden', 'idle-hidden');
    subtitleElement.classList.remove('hidden', 'idle-hidden');
  } else {
    titleElement.classList.add('hidden', 'idle-hidden');
    subtitleElement.classList.add('hidden', 'idle-hidden');
  }
}
window.syncPlayerTitleVisibility = syncPlayerTitleVisibility;

async function getFileNameByHash(hash, fileId) {
  if (!hash || !fileId) return null;
  var torrent = null;
  for (var i = 0; i < AppState.torrents.length; i++) {
    if (AppState.torrents[i].hash && AppState.torrents[i].hash.toLowerCase() === hash.toLowerCase()) {
      torrent = AppState.torrents[i];
      break;
    }
  }
  if (!torrent) return null;
  var files = [];
  if (torrent.file_stats && Array.isArray(torrent.file_stats)) files = torrent.file_stats;
  else if (torrent.data) {
    try {
      var data = JSON.parse(torrent.data);
      if (data.TorrServer && data.TorrServer.Files) files = data.TorrServer.Files;
    } catch (e) { }
  }
  for (var j = 0; j < files.length; j++) {
    if (files[j].id == fileId) return files[j].path.split('/').pop() || ('Файл ' + fileId);
  }
  return null;
}

function resetMouseIdleTimer() {
  var playerScreen = getEl('player-screen');
  if (!playerScreen || playerScreen.style.display !== 'block') return;
  var playerOverlay = getEl('player-overlay');
  var controlElements = [
    getEl('controls-container'), getEl('buffer-stats'), getEl('player-hint'),
    getEl('toggle-buffer-btn'), getEl('exit-player-btn'), getEl('episodes-btn'),
    getEl('subtitles-btn'), getEl('prev-episode-btn'), getEl('next-episode-btn'), getEl('player-title')
  ];
  if (playerOverlay) playerOverlay.classList.add('touch-active');
  for (var i = 0; i < controlElements.length; i++) {
    if (controlElements[i]) {
      controlElements[i].classList.remove('idle-hidden');
      controlElements[i].style.opacity = '1';
      controlElements[i].style.pointerEvents = 'auto';
    }
  }
  syncPlayerTitleVisibility(true);
  var episodesPanel = getEl('episodes-panel');
  if (episodesPanel && !episodesPanel.classList.contains('hidden')) {
    episodesPanel.style.opacity = '1'; episodesPanel.style.pointerEvents = 'auto';
  }
  var subtitlesPanel = getEl('subtitles-panel');
  if (subtitlesPanel && !subtitlesPanel.classList.contains('hidden')) {
    subtitlesPanel.style.opacity = '1'; subtitlesPanel.style.pointerEvents = 'auto';
  }
  if (mouseIdleTimer) clearTimeout(mouseIdleTimer);
  mouseIdleTimer = setTimeout(function () {
    if (playerScreen.style.display === 'block') {
      if (playerOverlay) playerOverlay.classList.remove('touch-active');
      for (var j = 0; j < controlElements.length; j++) {
        if (controlElements[j]) {
          controlElements[j].classList.add('idle-hidden');
          controlElements[j].style.opacity = '0';
          controlElements[j].style.pointerEvents = 'none';
        }
      }
      syncPlayerTitleVisibility(false);
      if (episodesPanel && episodesPanel.classList.contains('hidden')) {
        episodesPanel.style.opacity = '0'; episodesPanel.style.pointerEvents = 'none';
      }
      if (subtitlesPanel && subtitlesPanel.classList.contains('hidden')) {
        subtitlesPanel.style.opacity = '0'; subtitlesPanel.style.pointerEvents = 'none';
      }
    }
  }, IDLE_TIMEOUT);
}

function nextEpisode() {
  currentBufferAhead = 0; wasImmediatePause = false; pauseTimer = null; pauseStartTime = null;
  if (currentEpisodeFiles.length === 0 || currentEpisodeIndex === undefined) return;
  var nextIndex = currentEpisodeIndex + 1;
  if (nextIndex < currentEpisodeFiles.length) switchToEpisode(nextIndex, currentEpisodeFiles[nextIndex].id);
}

function prevEpisode() {
  currentBufferAhead = 0; wasImmediatePause = false; pauseTimer = null; pauseStartTime = null;
  if (currentEpisodeFiles.length === 0 || currentEpisodeIndex === undefined) return;
  var prevIndex = currentEpisodeIndex - 1;
  if (prevIndex >= 0) switchToEpisode(prevIndex, currentEpisodeFiles[prevIndex].id);
}

function showPlayerLoading(message, targetTime) {
  if (message === undefined) message = 'Перемотка...';
  if (targetTime === undefined) targetTime = null;
  var overlay = getEl('loading-player-overlay');
  var playerOverlay = getEl('player-overlay');
  var loadingTime = getEl('loading-time');
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
  var overlay = getEl('loading-player-overlay');
  var playerOverlay = getEl('player-overlay');
  if (overlay) overlay.classList.remove('active');
  if (playerOverlay) playerOverlay.classList.remove('loading');
}

function updateTimeDisplay() {
  var currentTimeSpan = getEl('current-time');
  var durationSpan = getEl('duration-time');
  var seekSlider = getEl('seek-slider');
  var videoPlayer = getEl('video-player');
  if (!currentTimeSpan || !durationSpan || !videoPlayer) return;
  if (AppState.isSeeking || AppState.isSliderDragging) return;

  var absoluteTime = videoPlayer.currentTime + AppState.seekOffset;
  currentTimeSpan.textContent = formatTime(absoluteTime);
  if (currentTimecodeData.hash && currentTimecodeData.fileId) currentTimecodeData.timecode = absoluteTime;

  var totalDuration = AppState.originalDuration || AppState.expectedDuration || videoPlayer.duration;
  durationSpan.textContent = formatTime(totalDuration);
  if (totalDuration && isFinite(totalDuration) && totalDuration > 0) currentTimecodeData.duration = totalDuration;
  if (seekSlider) seekSlider.max = totalDuration || 0;
}

function updatePlayPauseButton() {
  var btn = getEl('play-pause-btn');
  var videoPlayer = getEl('video-player');
  if (!btn || !videoPlayer) return;
  btn.innerHTML = videoPlayer.paused ? '<i class="fi fi-rr-play"></i>' : '<i class="fi fi-rr-pause"></i>';
}

function updateMuteButton() {
  var btn = getEl('mute-btn');
  var videoPlayer = getEl('video-player');
  if (!btn || !videoPlayer) return;
  btn.innerHTML = videoPlayer.muted ? '<i class="fi fi-tc-volume-slash"></i>' : '<i class="fi fi-rr-volume"></i>';
}

function updateBufferDisplay() {
  var bufferStats = getEl('buffer-stats');
  var subtitleElement = getEl('player-subtitle');
  var videoPlayer = getEl('video-player');
  if (!bufferStats || !videoPlayer) return;
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
    var absoluteCurrentTime = currentTime + AppState.seekOffset;
    if (totalDuration && totalDuration > 0 && isFinite(totalDuration)) {
      var absoluteBuffered = buffered + AppState.seekOffset;
      var bufferAhead = absoluteBuffered - absoluteCurrentTime;
      var remainingTime = totalDuration - absoluteCurrentTime;
      if (remainingTime < 0) remainingTime = 0;
      if (bufferAhead < 0) bufferAhead = 0;
      currentBufferAhead = bufferAhead;
      var bufferAheadText = bufferAhead < 60 ? Math.floor(bufferAhead) + ' сек' : (bufferAhead < 3600 ? Math.floor(bufferAhead / 60) + ' мин' : Math.floor(bufferAhead / 3600) + ' ч');
      var remainingHours = Math.floor(remainingTime / 3600);
      var remainingMinutes = Math.floor((remainingTime % 3600) / 60);
      var remainingSeconds = Math.floor(remainingTime % 60);
      var remainingText = remainingHours > 0 ? remainingHours + ' ч ' + (remainingMinutes > 0 ? remainingMinutes + ' мин' : '') : (remainingMinutes > 0 ? remainingMinutes + ' мин ' + (remainingSeconds > 0 ? remainingSeconds + ' сек' : '') : remainingSeconds + ' сек');
      var endTime = new Date(Date.now() + remainingTime * 1000);
      var endTimeText = endTime.getHours().toString().padStart(2, '0') + ':' + endTime.getMinutes().toString().padStart(2, '0');
      var torrServerText = '';
      if (currentTimecodeData.hash && typeof torrentStatsCache !== 'undefined' && torrentStatsCache.preloadSize > 0) {
        torrServerText = 'TorrServer: ' + formatSize(torrentStatsCache.preloaded) + ' | скорость: ' + formatSpeed(torrentStatsCache.downloadSpeed);
        if (torrentStatsCache.activePeers > 0) torrServerText += ' | пиры: ' + torrentStatsCache.activePeers + ' / ' + torrentStatsCache.totalPeers + ' - ' + torrentStatsCache.connectedSeeders;
      }
      bufferStats.innerText = 'Буфер: ' + bufferAheadText + ' | до конца: ' + remainingText + ' | конец в: ' + endTimeText;
      if (subtitleElement) subtitleElement.innerText = torrServerText || '';
      checkAndShowSkipButton(absoluteCurrentTime);
    }
  } else {
    bufferStats.innerText = 'буфер: 0%';
    if (subtitleElement) subtitleElement.innerText = '';
  }
}

function forceUpdateDuration(duration, origDur, offset) {
  if (origDur === undefined) origDur = null;
  if (offset === undefined) offset = 0;
  var videoPlayer = getEl('video-player');
  var durationSpan = getEl('duration-time');
  var seekSlider = getEl('seek-slider');
  if (!duration || !isFinite(duration) || duration <= 0) return;
  AppState.expectedDuration = duration;
  AppState.originalDuration = origDur;
  AppState.seekOffset = offset;
  if (videoPlayer) {
    videoPlayer.dataset.expectedDuration = duration;
    videoPlayer.dataset.originalDuration = origDur;
    videoPlayer.dataset.seekOffset = offset;
  }
  if (durationSpan) durationSpan.textContent = formatTime(origDur || duration);
  if (seekSlider) seekSlider.max = origDur || duration;
  currentTimecodeData.duration = origDur || duration;
  updateTimeDisplay();
}

function destroyHls() {
  hidePlayerLoading();
  var seekSlider = getEl('seek-slider');
  if (seekSlider) seekSlider.value = 0;
  var currentTimeSpan = getEl('current-time');
  if (currentTimeSpan) currentTimeSpan.textContent = '00:00';
  if (AppState) {
    AppState.seekQueue = [];
    AppState.isSeeking = false;
    AppState.previewTime = null;
    AppState.suppressTimeUpdate = false;
  }
  if (AppState._timeUpdateHandler) {
    var videoPlayer = getEl('video-player');
    if (videoPlayer) videoPlayer.removeEventListener('timeupdate', AppState._timeUpdateHandler);
    AppState._timeUpdateHandler = null;
  }
  if (AppState._canPlayHandler) {
    var videoPlayer = getEl('video-player');
    if (videoPlayer) videoPlayer.removeEventListener('canplay', AppState._canPlayHandler);
    AppState._canPlayHandler = null;
  }
  if (AppState._loadingTimeout) {
    clearTimeout(AppState._loadingTimeout);
    AppState._loadingTimeout = null;
  }
  if (AppState._seekExecuted) AppState._seekExecuted = false;

  if (AppState.hls) {
    AppState.expectedDuration = null;
    AppState.originalDuration = null;
    AppState.seekOffset = 0;
    AppState.lastSuccessfulSeek = 0;
    var videoPlayer = getEl('video-player');
    if (videoPlayer) {
      delete videoPlayer.dataset.expectedDuration;
      delete videoPlayer.dataset.originalDuration;
      delete videoPlayer.dataset.seekOffset;
    }
    AppState.hls.destroy();
    AppState.hls = null;
  }
  AppState.isPlaying = false;
}

async function checkPlaylistExists(playlistUrl, maxAttempts) {
  if (maxAttempts === undefined) maxAttempts = 40;
  for (var i = 0; i < maxAttempts; i++) {
    try {
      var response = await fetch(playlistUrl, { method: 'HEAD' });
      if (response.ok) return true;
    } catch (e) { }
    if (i % 4 === 0) showPlayerLoading('Ожидание плейлиста... ' + ((i + 1) * 0.5).toFixed(0) + 'с', AppState.previewTime);
    await new Promise(function (r) { setTimeout(r, 500); });
  }
  return false;
}

function reloadHlsPlaylist(playlistUrl) {
  return new Promise(function (resolve, reject) {
    if (!AppState.hls || !Hls.isSupported()) { reject(new Error('HLS не инициализирован')); return; }
    var manifestParsed = false;
    var loadError = null;
    var onManifestParsed = function () {
      manifestParsed = true;
      AppState.hls.off(Hls.Events.MANIFEST_PARSED, onManifestParsed);
      AppState.hls.off(Hls.Events.ERROR, onError);
      resolve();
    };
    var onError = function (event, data) {
      if (data.fatal && !manifestParsed) {
        loadError = new Error(data.details || 'Ошибка загрузки плейлиста');
        AppState.hls.off(Hls.Events.MANIFEST_PARSED, onManifestParsed);
        AppState.hls.off(Hls.Events.ERROR, onError);
        reject(loadError);
      }
    };
    AppState.hls.on(Hls.Events.MANIFEST_PARSED, onManifestParsed);
    AppState.hls.on(Hls.Events.ERROR, onError);
    try { AppState.hls.loadSource(playlistUrl); } catch (e) { reject(e); }
    setTimeout(function () {
      if (!manifestParsed && !loadError) {
        AppState.hls.off(Hls.Events.MANIFEST_PARSED, onManifestParsed);
        AppState.hls.off(Hls.Events.ERROR, onError);
        reject(new Error('Таймаут загрузки плейлиста'));
      }
    }, 15000);
  });
}

async function saveTimecodeToServer() {
  if (!currentTimecodeData.hash || !currentTimecodeData.fileId) return;
  if (currentTimecodeData.timecode < 5) return;
  if (currentTimecodeData.duration > 0 && currentTimecodeData.timecode > currentTimecodeData.duration - 10) return;
  try {
    var savedClientId = localStorage.getItem('clientId');
    var response = await fetch(SERVER_URL + '/api/timecode/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: savedClientId, hash: currentTimecodeData.hash, fileId: currentTimecodeData.fileId,
        timecode: currentTimecodeData.timecode, duration: currentTimecodeData.duration
      })
    });
    if (response.ok) console.log('💾 Таймкод сохранен: ' + formatTime(currentTimecodeData.timecode));
  } catch (error) { console.error('Ошибка сохранения таймкода:', error); }
}

async function loadTimecodeFromServer(hash, fileId) {
  if (!hash || !fileId) return 0;
  try {
    var savedClientId = localStorage.getItem('clientId');
    var response = await fetch(SERVER_URL + '/api/timecode/get?hash=' + hash + '&fileId=' + fileId + '&clientId=' + encodeURIComponent(savedClientId));
    if (response.ok) {
      var data = await response.json();
      if (data.success && data.timecode > 0) return data.timecode;
    }
  } catch (error) { console.error('Ошибка загрузки таймкода:', error); }
  return 0;
}

function clearTimecodeData() { currentTimecodeData = { hash: null, fileId: null, timecode: 0, duration: 0 }; }
function startTimecodeSaving() {
  if (timecodeSaveInterval) clearInterval(timecodeSaveInterval);
  timecodeSaveInterval = setInterval(function () { saveTimecodeToServer(); }, 10000);
}
function stopTimecodeSaving() {
  if (timecodeSaveInterval) { clearInterval(timecodeSaveInterval); timecodeSaveInterval = null; }
}

function isPositionInBuffer(targetTime) {
  var videoPlayer = getEl('video-player');
  if (!videoPlayer || !videoPlayer.buffered || videoPlayer.buffered.length === 0) return false;
  var relativeTargetTime = targetTime - AppState.seekOffset;
  for (var i = 0; i < videoPlayer.buffered.length; i++) {
    var start = videoPlayer.buffered.start(i);
    var end = videoPlayer.buffered.end(i);
    if (relativeTargetTime >= start - 0.5 && relativeTargetTime <= end + 0.5) return true;
  }
  return false;
}

async function seekStream(absoluteSeekTime, source) {
  currentBufferAhead = 0; wasImmediatePause = false; pauseTimer = null; pauseStartTime = null; thisisseek = true;
  if (source === undefined) source = 'user';
  if (!AppState.currentStreamId && !AppState.transcodingOnOff && !AppState.transcodingFullOnOff) return false;
  var videoPlayer = getEl('video-player');
  var totalDuration = AppState.originalDuration || AppState.expectedDuration || 0;
  if (absoluteSeekTime < 0) absoluteSeekTime = 0;
  if (totalDuration > 0 && absoluteSeekTime >= totalDuration - 1) return false;

  if (AppState.transcodingOnOff || AppState.transcodingFullOnOff) {
    showPlayerLoading('Перемотка...', absoluteSeekTime);
    var relativeTime = absoluteSeekTime - (AppState.seekOffset || 0);
    if (relativeTime < 0) relativeTime = 0;
    AppState.seekQueue.push(absoluteSeekTime);
    if (AppState.isSeeking) return false;
    if (source === 'slider' && AppState.seekTimeout) clearTimeout(AppState.seekTimeout);
    AppState.isSeeking = true; AppState.suppressTimeUpdate = true; AppState.previewTime = absoluteSeekTime;
    videoPlayer.currentTime = relativeTime;
    if (currentTimecodeData.hash && currentTimecodeData.fileId) currentTimecodeData.timecode = absoluteSeekTime;
    var seekSlider = getEl('seek-slider');
    if (seekSlider) seekSlider.value = Math.min(absoluteSeekTime, totalDuration);
    updateTimeDisplay();
    var timeUpdateHandler = function () {
      if (videoPlayer.currentTime > 0) {
        hidePlayerLoading(); AppState.isSeeking = false; AppState.isSliderDragging = false;
        AppState.previewTime = null; AppState.suppressTimeUpdate = false;
        videoPlayer.removeEventListener('timeupdate', timeUpdateHandler);
      }
    };
    videoPlayer.addEventListener('timeupdate', timeUpdateHandler);
    AppState._seekTimeout = setTimeout(function () {
      hidePlayerLoading(); AppState.isSeeking = false; AppState.isSliderDragging = false;
      AppState.previewTime = null; AppState.suppressTimeUpdate = false;
      videoPlayer.removeEventListener('timeupdate', timeUpdateHandler);
    }, 3000);
    AppState._seekTimeUpdateHandler = timeUpdateHandler;
    return true;
  }

  AppState.seekQueue.push(absoluteSeekTime);
  if (AppState.isSeeking) return false;
  if (source === 'slider' && AppState.seekTimeout) clearTimeout(AppState.seekTimeout);

  return new Promise(function (resolve) {
    var executeSeek = async function () {
      var targetTime = AppState.seekQueue[AppState.seekQueue.length - 1];
      AppState.seekQueue = [];
      if (targetTime === undefined) { hidePlayerLoading(); resolve(false); return; }
      var wasPlaying = !videoPlayer.paused;
      var episodesPanel = getEl('episodes-panel');
      var episodesBtn = getEl('episodes-btn');
      if (episodesPanel && !episodesPanel.classList.contains('hidden')) {
        episodesPanel.classList.add('hidden');
        if (episodesBtn) episodesBtn.classList.remove('active');
      }
      AppState.isSeeking = true; AppState.suppressTimeUpdate = true; AppState.previewTime = targetTime;
      var positionInBuffer = isPositionInBuffer(targetTime);
      if (positionInBuffer) {
        var relativeTime = targetTime - AppState.seekOffset;
        videoPlayer.currentTime = relativeTime;
        if (wasPlaying) videoPlayer.play()['catch'](function (err) { });
        AppState.previewTime = null; AppState.suppressTimeUpdate = false; AppState.isSeeking = false;
        var seekSlider = getEl('seek-slider');
        if (seekSlider) seekSlider.value = targetTime;
        updateTimeDisplay(); resolve(true); return;
      }

      lastCleanedSegment = -1;
      var playbackOverlay = getEl('playback-overlay');
      var playbackText = document.querySelector('.playback-text');
      playbackOverlay.classList.add('active');
      playbackText.textContent = 'Перемотка на ' + formatTime(targetTime) + '...';
      if (wasPlaying) videoPlayer.pause();

      var retrySeek = async function (retryCount, maxRetries) {
        if (retryCount === undefined) retryCount = 0;
        if (maxRetries === undefined) maxRetries = 2;
        try {
          var savedClientId = localStorage.getItem('clientId');
          var seekResponse = await fetch(SERVER_URL + '/hls/stream/seek', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              streamId: AppState.currentStreamId, seekTime: targetTime, multiChannel: AppState.multiChannelEnabled,
              clientId: savedClientId, duration: AppState.originalDuration, sub: currentSubtitleTrack, dv: AppState.dvPreferred
            })
          });
          if (!seekResponse.ok) throw new Error('HTTP ' + seekResponse.status);
          var seekData = await seekResponse.json();
          if (!seekData.success) throw new Error(seekData.error || 'Ошибка перемотки');
          AppState.expectedDuration = seekData.duration; AppState.originalDuration = seekData.originalDuration;
          AppState.seekOffset = seekData.seekOffset; AppState.currentStreamId = seekData.streamId; AppState.lastSuccessfulSeek = targetTime;
          if (videoPlayer) {
            videoPlayer.dataset.expectedDuration = AppState.expectedDuration;
            videoPlayer.dataset.originalDuration = AppState.originalDuration;
            videoPlayer.dataset.seekOffset = AppState.seekOffset;
          }
          playbackText.textContent = 'Загрузка потока...';
          var playlistReady = await checkPlaylistExists(seekData.playlistUrl, 60);
          if (!playlistReady) throw new Error('Таймаут ожидания плейлиста');
          playbackText.textContent = 'Загрузка видео...';

          if (AppState.hls) { AppState.hls.destroy(); AppState.hls = null; }
          if (Hls.isSupported()) {
            AppState.hls = createHlsInstance();

            if (currentPlaybackController) currentPlaybackController.abort();
            currentPlaybackController = new AbortController();
            var newSignal = currentPlaybackController.signal;

            // Используем существующую функцию привязки всех обработчиков
            attachHlsEventListeners(AppState.hls, videoPlayer, newSignal, 0);

            // Обработчик субтитров
            var subtitleTracksHandler = function () {
              if (currentSubtitleTrack >= 0 && AppState.hls.subtitleTracks.length > currentSubtitleTrack) {
                setTimeout(function () { if (AppState.hls) AppState.hls.subtitleTrack = currentSubtitleTrack; }, 200);
              } else if (currentSubtitleTrack === -1) {
                if (AppState.hls) AppState.hls.subtitleTrack = -1;
              }
              AppState.hls.off(Hls.Events.SUBTITLE_TRACKS_UPDATED, subtitleTracksHandler);
            };
            AppState.hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, subtitleTracksHandler);

            AppState.hls.loadSource(seekData.playlistUrl);
            AppState.hls.attachMedia(videoPlayer);
          }
          var onMetaData = function () {
            videoPlayer.currentTime = 0;
            if (wasPlaying) {
              videoPlayer.play()['catch'](function (err) { videoPlayer.muted = true; videoPlayer.play()['catch'](function () { }); updateMuteButton(); });
            }
            videoPlayer.muted = false; updateMuteButton();
            forceUpdateDuration(AppState.expectedDuration, AppState.originalDuration, AppState.seekOffset);
            var seekSlider = getEl('seek-slider');
            if (seekSlider) seekSlider.value = Math.min(targetTime, parseFloat(seekSlider.max) || targetTime);
            AppState.previewTime = null; AppState.suppressTimeUpdate = false;
            playbackOverlay.classList.remove('active'); playbackText.textContent = 'Воспроизведение...';
            hidePlayerLoading(); startTimecodeSaving(); resetMouseIdleTimer(); startNearEndCheck(); startHeartbeat();
            videoPlayer.removeEventListener('loadedmetadata', onMetaData);
          };
          videoPlayer.addEventListener('loadedmetadata', onMetaData, { once: true });
          AppState._loadingTimeout = setTimeout(function () {
            var loadingOverlay = getEl('loading-player-overlay');
            if (loadingOverlay && loadingOverlay.classList.contains('active')) {
              hidePlayerLoading();
              if (wasPlaying) videoPlayer.play()['catch'](function () { });
            }
          }, 10000);
          return true;
        } catch (error) {
          if (retryCount < maxRetries) {
            playbackText.textContent = '⚠️ Ошибка перемотки. Попытка ' + (retryCount + 1) + '/' + (maxRetries + 1) + '...';
            await new Promise(function (resolve) { setTimeout(resolve, 1000); });
            return retrySeek(retryCount + 1, maxRetries);
          }
          throw error;
        }
      };
      try {
        var success = await retrySeek(0, 2); resolve(success);
      } catch (error) {
        playbackText.textContent = '❌ Ошибка перемотки!';
        setTimeout(function () { playbackOverlay.classList.remove('active'); playbackText.textContent = 'Воспроизведение...'; }, 2000);
        if (wasPlaying) setTimeout(function () { videoPlayer.play()['catch'](function () { }); }, 1000);
        AppState.previewTime = null; AppState.suppressTimeUpdate = false; resolve(false);
      } finally { AppState.isSeeking = false; }
    };
    if (source === 'slider') {
      if (AppState.seekTimeout) clearTimeout(AppState.seekTimeout);
      AppState.seekTimeout = setTimeout(executeSeek, 300);
    } else { executeSeek(); }
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
    if (AppState.torrents[i].hash && AppState.torrents[i].hash.toLowerCase() === hash.toLowerCase()) { torrent = AppState.torrents[i]; break; }
  }
  for (var attempt = 0; attempt < maxAttempts; attempt++) {
    var files = [];
    if (torrent && torrent.file_stats && Array.isArray(torrent.file_stats)) files = torrent.file_stats;
    else if (torrent && torrent.data) {
      try { var data = JSON.parse(torrent.data); if (data.TorrServer && Array.isArray(data.TorrServer.Files)) files = data.TorrServer.Files; } catch (e) { }
    }
    if (extractVideoFiles(files).length > 0) return torrent;
    if (attempt < maxAttempts - 1) {
      await refreshTorrentsList();
      for (var j = 0; j < AppState.torrents.length; j++) {
        if (AppState.torrents[j].hash && AppState.torrents[j].hash.toLowerCase() === hash.toLowerCase()) { torrent = AppState.torrents[j]; break; }
      }
      await new Promise(function (resolve) { setTimeout(resolve, delayMs); });
    }
  }
  return torrent;
}

async function loadEpisodesInfo(hash, currentFileId) {
  if (currentFileId === undefined) currentFileId = null;
  if (!hash || !AppState.currentTorrserverUrl) return;
  try {
    var torrent = await resolveTorrentWithFiles(hash, 4, 800);
    if (!torrent) return;
    var files = [];
    if (torrent.file_stats && Array.isArray(torrent.file_stats)) files = torrent.file_stats;
    else if (torrent.data) {
      try { var data = JSON.parse(torrent.data); if (data.TorrServer && data.TorrServer.Files) files = data.TorrServer.Files; } catch (e) { }
    }
    var videoFiles = extractVideoFiles(files);
    if (videoFiles.length > 0) {
      currentEpisodeFiles = videoFiles; currentTorrentHash = hash;
      if (currentFileId) {
        currentEpisodeIndex = -1;
        for (var i = 0; i < videoFiles.length; i++) { if (String(videoFiles[i].id) == String(currentFileId)) { currentEpisodeIndex = i; break; } }
      } else if (AppState.videoUrl) {
        var match = AppState.videoUrl.match(/\/(\d+)$/);
        if (match && match[1]) {
          currentEpisodeIndex = -1;
          for (var j = 0; j < videoFiles.length; j++) { if (String(videoFiles[j].id) == String(match[1])) { currentEpisodeIndex = j; break; } }
        }
      }
      if (currentEpisodeIndex === -1 || currentEpisodeIndex === undefined) currentEpisodeIndex = 0;
      renderEpisodesList();
      if (AppState.isSerials) fetchSkipData(AppState.currentTMDB, AppState.currentSeason, currentFileId);
      var episodesBtn = getEl('episodes-btn');
      if (episodesBtn) episodesBtn.style.display = videoFiles.length > 1 ? 'flex' : 'none';
      updateEpisodeButtons();
    } else {
      currentEpisodeFiles = []; currentEpisodeIndex = 0;
      var episodesBtn = getEl('episodes-btn');
      if (episodesBtn) episodesBtn.style.display = 'none';
      updateEpisodeButtons();
    }
  } catch (error) { console.error('Ошибка загрузки серий:', error); }
}

async function fetchSkipData(tmdbId, season, episode) {
  var url = AppState.protocol + '//tsskip.hnar.online/v2/media?tmdb_id=' + tmdbId + '&season=' + season + '&episode=' + episode;
  try {
    var response = await fetch(url);
    var data = await response.json();
    if (data.error) { skipData = { error: true }; }
    else { skipData = data; skipData.error = false; }
    return skipData;
  } catch (error) { skipData = { error: true }; return skipData; }
}

function renderEpisodesList() {
  var episodesList = getEl('episodes-list');
  if (!episodesList) return;

  // Находим или создаем current-episode-info
  var currentInfo = getEl('current-episode-info');
  if (!currentInfo) {
    // Создаем элемент, если его нет
    currentInfo = document.createElement('div');
    currentInfo.id = 'current-episode-info';
    currentInfo.className = 'current-episode-info';
    // Вставляем перед episodes-list
    episodesList.parentNode.insertBefore(currentInfo, episodesList);
  }

  // Обновляем current-episode-info
  if (currentEpisodeFiles.length === 0) {
    currentInfo.innerHTML = '<span class="current-episode-badge">Пусто</span><span>Нет доступных серий</span>';
    episodesList.innerHTML = '<div class="search-result-empty">Нет доступных серий</div>';
    return;
  }

  // Обновляем информацию о текущей серии
  currentInfo.innerHTML = '<span class="current-episode-badge">Текущая</span><span>Серия ' + (currentEpisodeIndex + 1) + ' из ' + currentEpisodeFiles.length + '</span>';

  // Рендерим список серий (без current-episode-info внутри)
  var html = '';
  for (var idx = 0; idx < currentEpisodeFiles.length; idx++) {
    var file = currentEpisodeFiles[idx];
    var isActive = idx === currentEpisodeIndex;
    var fileSize = formatBytes(file.length);
    var episodeNumber = idx + 1;
    html += '<div class="episode-item ' + (isActive ? 'active' : '') + '" data-index="' + idx + '" data-file-id="' + file.id + '">' +
      '<div class="episode-number">' + episodeNumber + '</div>' +
      '<div class="episode-info"><div class="episode-title">Серия ' + episodeNumber + '</div><div class="episode-duration">' + fileSize + '</div></div>' +
      '<button class="episode-play" title="Воспроизвести">▶</button></div>';
  }
  episodesList.innerHTML = html;

  // Добавляем обработчики событий
  var episodeItems = episodesList.querySelectorAll('.episode-item');
  for (var i = 0; i < episodeItems.length; i++) {
    (function (item) {
      var index = parseInt(item.dataset.index);
      var fileId = item.dataset.fileId;
      item.addEventListener('click', function (e) {
        if (e.target.classList && e.target.classList.contains('episode-play')) return;
        switchToEpisode(index, fileId);
      });
      var playBtn = item.querySelector('.episode-play');
      if (playBtn) playBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        switchToEpisode(index, fileId);
      });
    })(episodeItems[i]);
  }
}

async function switchToEpisode(index, fileId) {
  stopTorrentStatsUpdates();
  currentBufferAhead = 0; wasImmediatePause = false; pauseTimer = null; pauseStartTime = null; thisisseek = false;
  stopHeartbeat();
  if (!currentTorrentHash || !AppState.currentTorrserverUrl) return;
  if (index === currentEpisodeIndex) { toggleEpisodesPanel(); return; }
  if (nearEndCheckInterval) { clearInterval(nearEndCheckInterval); nearEndCheckInterval = null; }
  await saveTimecodeToServer();
  var savedAudioTrack = currentAudioTrack;
  var episodesPanel = getEl('episodes-panel');
  var episodesBtn = getEl('episodes-btn');
  if (episodesPanel) { episodesPanel.classList.add('hidden'); if (episodesBtn) episodesBtn.classList.remove('active'); }
  getEl('playback-overlay').classList.add('active');
  document.querySelector('.playback-text').textContent = 'Переключение на серию ' + (index + 1) + '...';
  try {
    var playUrl = AppState.currentTorrserverUrl + '/play/' + currentTorrentHash + '/' + fileId;
    currentEpisodeIndex = index; AppState.videoUrl = playUrl;
    if (AppState.currentStreamId) {
      await fetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST' });
      AppState.currentStreamId = null;
    }
    var videoPlayer = getEl('video-player');
    videoPlayer.removeEventListener('ended', handleVideoEnded);
    destroyHls();
    if (currentTorrentHash && fileId) await saveAudioPreference(currentTorrentHash, fileId, savedAudioTrack);
    await startHLSPlayback(playUrl, 0, lastPlaybackFromSearch, index, savedAudioTrack);
    var fileName = await getFileNameByHash(currentTorrentHash, fileId);
    if (fileName && AppState.currentDetailItem) updatePlayerTitle(AppState.currentDetailItem.title + ' - ' + fileName);
    renderEpisodesList(); updateEpisodeButtons();
  } catch (error) { alert('Ошибка при переключении серии'); }
  finally {
    getEl('playback-overlay').classList.remove('active');
    document.querySelector('.playback-text').textContent = 'Воспроизведение...';
    hidePlayerLoading(); startHeartbeat(); startTorrentStatsUpdates();
  }
}

function toggleEpisodesPanel() {
  var panel = getEl('episodes-panel'); var btn = getEl('episodes-btn');
  if (!panel || !btn) return;
  if (panel.classList.contains('hidden')) {
    if (AppState.currentDetailItem) loadEpisodesInfo(AppState.currentDetailItem.hash);
    panel.classList.remove('hidden'); btn.classList.add('active');
  } else { panel.classList.add('hidden'); btn.classList.remove('active'); }
}

function setupEpisodesButton() {
  var episodesBtn = getEl('episodes-btn'); var closeEpisodesBtn = getEl('close-episodes'); var episodesPanel = getEl('episodes-panel');
  if (!episodesBtn || !closeEpisodesBtn || !episodesPanel) return;
  episodesBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleEpisodesPanel(); resetMouseIdleTimer(); });
  closeEpisodesBtn.addEventListener('click', function () { episodesPanel.classList.add('hidden'); episodesBtn.classList.remove('active'); resetMouseIdleTimer(); });
  document.addEventListener('click', function (e) {
    if (!episodesPanel.contains(e.target) && !episodesBtn.contains(e.target)) { episodesPanel.classList.add('hidden'); episodesBtn.classList.remove('active'); }
    resetMouseIdleTimer();
  });
}

function preloadTorrents(hash, fileId) {
  if (!hash || !fileId || !AppState.currentTorrserverUrl) return;
  var preloadUrl = AppState.currentTorrserverUrl + "/stream?link=" + hash + "&index=" + fileId + "&preload=preload";
  return fetch(preloadUrl, { method: 'GET', keepalive: true })
    .then(function (response) { return new Promise(function (resolve) { setTimeout(resolve, 4000); }); })
    .catch(function (error) { return Promise.resolve(); });
}

function playInExternalPlayer(url, title, timecode, fromSearch) {
  if (!window.AndroidJS || !url) return false;
  var match = url.match(/\/play\/([a-fA-F0-9]+)\/(\d+)/);
  if (!match) match = url.match(/[?&]link=([a-fA-F0-9]+)[&]index=(\d+)/);
  if (match) {
    var torrentHash = match[1]; var fileId = parseInt(match[2]);
    var seekTime = (timecode != null && timecode > 0) ? Math.floor(timecode) : 0;
    currentTimecodeData.hash = torrentHash; currentTimecodeData.fileId = fileId; currentTimecodeData.timecode = seekTime;
    var playURL = AppState.currentTorrserverUrl + "/stream?link=" + torrentHash + "&index=" + fileId + "&play=play";
    var playerData = { url: playURL, title: title || 'Видео', iptv: false, timecode: seekTime, timeline: { hash: torrentHash + '_' + fileId, time: seekTime, duration: 0, percent: 0 } };
    lastPlaybackFromSearch = fromSearch;
    if (!AppState.playFromHash) AppState.inSearch = 'torrents';
    else { AppState.currentDetailItem = AppState.androidBackCatalog; AppState.inSearch = 'catalog'; }
    AppState.currentScreen = 'detail';
    AndroidJS.openPlayer(playURL, JSON.stringify(playerData));
    return true;
  }
  return false;
}

function startGstPlayback(m3u8Url) {
  var videoPlayer = getEl('video-player');
  if (!videoPlayer) return false;
  if (Hls.isSupported()) {
    AppState.hls = createHlsInstance({
      maxBufferSize: 80 * 1024 * 1024, maxBufferLength: 30, backBufferLength: 20, startLevel: -1,
      abrEwmaDefaultEstimate: 500000, fragLoadingTimeOut: 10000, manifestLoadingTimeOut: 10000, enableWorker: true, progressive: true
    });
    AppState.hls.loadSource(m3u8Url); AppState.hls.attachMedia(videoPlayer);
    return true;
  }
  return false;
}

function createHlsInstance(configOverrides) {
  var defaultConfig = {
    enableABR: false, startLevel: 0, maxBufferLength: 15, maxMaxBufferLength: 25, startFragPrefetch: true,
    fragLoadingTimeOut: 15000, manifestLoadingTimeOut: 10000, enableWorker: true, progressive: true,
    maxBufferSize: 60 * 1000 * 1000, maxBufferHole: 0.5
  };
  return new Hls(Object.assign({}, defaultConfig, configOverrides || {}));
}

function resetPlaybackState() {
  cancelCurrentPlayback();
  destroyHls();
  var videoPlayer = getEl('video-player');
  if (videoPlayer) videoPlayer.removeEventListener('ended', handleVideoEnded);
}

function transitionToPlayerScreen() {
  AppState.currentScreen = 'player';
  getEl('config-screen').style.display = 'none';
  getEl('torrserver-section').style.display = 'none';
  getEl('detail-view').style.display = 'none';
  getEl('player-screen').style.display = 'block';
  clearFocused();
  var controlsContainer = getEl('controls-container');
  if (controlsContainer) controlsContainer.classList.add('idle-hidden');
  if (typeof currentFocusIndex !== 'undefined') currentFocusIndex = 0;
  if (typeof updateFocusableElements === 'function') updateFocusableElements();
}

function showPlayerHint() {
  var playerHint = getEl('player-hint');
  if (playerHint) {
    playerHint.style.opacity = '1';
    if (AppState.hintTimeout) clearTimeout(AppState.hintTimeout);
    AppState.hintTimeout = setTimeout(function () { playerHint.style.opacity = '0'; }, 4000);
  }
}

async function preparePlaybackMetadata(originalUrl, initialSeek, audioTrack, signal) {
  var match = originalUrl.match(/\/play\/([a-fA-F0-9]+)\/(\d+)\/?/);
  if (!match) {
    console.error('❌ Некорректный URL для воспроизведения:', originalUrl);
    alert('Ошибка: Некорректная ссылка на видео');
    return null;
  }
  currentTimecodeData.hash = match[1]; currentTimecodeData.fileId = match[2]; currentTimecodeData.timecode = 0;
  if (!AppState.transcodingFullOnOff) {
    return true;
  }
  var requests = [
    loadFileInfo(currentTimecodeData.hash, currentTimecodeData.fileId),
    loadAudioPreference(currentTimecodeData.hash, currentTimecodeData.fileId),
    getFileNameByHash(currentTimecodeData.hash, currentTimecodeData.fileId),
    loadSubtitlePreference(currentTimecodeData.hash, currentTimecodeData.fileId)
  ];
  if (initialSeek === null || initialSeek === 0) preloadTorrents(currentTimecodeData.hash, currentTimecodeData.fileId);
  var timecodePromise = null;
  if (initialSeek === null) {
    timecodePromise = loadTimecodeFromServer(currentTimecodeData.hash, currentTimecodeData.fileId);
    requests.push(timecodePromise);
  }
  var promiseResults = await Promise.all(requests);
  if (signal.aborted) return null;
  var fileInfo = promiseResults[0]; var savedAudioTrack = promiseResults[1]; var fileName = promiseResults[2];
  var savedSubTrack = promiseResults[3]; var savedTimecode = promiseResults[4] || null;
  if (fileInfo && fileInfo.audio) { currentAudioTracks = fileInfo.audio; currentAudioTrack = audioTrack !== null ? audioTrack : 0; }
  if (fileInfo && fileInfo.subtitles) currentSubTracks = fileInfo.subtitles;
  if (savedAudioTrack !== null && savedAudioTrack < currentAudioTracks.length) {
    currentAudioTrack = savedAudioTrack;
    if (audioTrack !== savedAudioTrack) audioTrack = savedAudioTrack;
  } else currentAudioTrack = audioTrack !== null ? audioTrack : 0;
  if (savedSubTrack !== null && savedSubTrack < currentSubTracks.length) currentSubtitleTrack = savedSubTrack;
  var seekTime = initialSeek;
  if (seekTime === null && timecodePromise) seekTime = savedTimecode > 0 ? savedTimecode : 0;
  return { match: match, fileInfo: fileInfo, savedAudioTrack: savedAudioTrack, fileName: fileName, savedSubTrack: savedSubTrack, savedTimecode: savedTimecode, seekTime: seekTime, audioTrack: audioTrack };
}

async function initGstPlayback(metadata, initialSeek, signal) {
  var playURL = AppState.currentTorrserverUrl + "/gst/" + currentTimecodeData.hash + "/master.m3u8?index=" + currentTimecodeData.fileId + "&audio=" + currentAudioTrack;
  var videoPlayer = getEl('video-player');
  destroyHls();
  var isTimeUpdated = false; var seekExecuted = false;
  var executeSeek = function () {
    if (seekExecuted) return;
    if (initialSeek > 0) {
      seekExecuted = true;
      try { var relativeTime = initialSeek - (AppState.seekOffset || 0); if (relativeTime > 0) videoPlayer.currentTime = parseInt(relativeTime); } catch (e) { }
      setTimeout(function () { seekStream(parseInt(initialSeek - (AppState.seekOffset || 0)), 'slider'); }, 800);
      setTimeout(function () { if (Math.abs(videoPlayer.currentTime + (AppState.seekOffset || 0) - initialSeek) > 2) seekStream(parseInt(initialSeek - (AppState.seekOffset || 0)), 'slider'); }, 2000);
    }
  };
  var timeUpdateHandler = function () {
    if (!isTimeUpdated && videoPlayer.currentTime > 0) { isTimeUpdated = true; hidePlayerLoading(); executeSeek(); videoPlayer.removeEventListener('timeupdate', timeUpdateHandler); }
  };
  videoPlayer.addEventListener('timeupdate', timeUpdateHandler);
  var canPlayHandler = function () {
    if (!isTimeUpdated && initialSeek > 0 && !seekExecuted) {
      try { var relativeTime = initialSeek - (AppState.seekOffset || 0); if (relativeTime > 0) videoPlayer.currentTime = parseInt(relativeTime); } catch (e) { }
      setTimeout(function () { if (!seekExecuted) { seekExecuted = true; seekStream(parseInt(initialSeek - (AppState.seekOffset || 0)), 'slider'); } }, 300);
    }
  };
  videoPlayer.addEventListener('canplay', canPlayHandler);
  AppState._loadingTimeout = setTimeout(function () {
    if (!isTimeUpdated) {
      hidePlayerLoading();
      if (initialSeek > 0 && !seekExecuted) {
        seekExecuted = true;
        try { var relativeTime = initialSeek - (AppState.seekOffset || 0); if (relativeTime > 0) videoPlayer.currentTime = parseInt(relativeTime); } catch (e) { }
        setTimeout(function () { seekStream(parseInt(initialSeek - (AppState.seekOffset || 0)), 'slider'); }, 500);
      }
      videoPlayer.removeEventListener('timeupdate', timeUpdateHandler); videoPlayer.removeEventListener('canplay', canPlayHandler);
    }
  }, LOADING_TIMEOUT_MS);
  if (Hls.isSupported()) {
    AppState.hls = createHlsInstance({ maxBufferLength: 20, maxMaxBufferLength: 40, startFragPrefetch: false, fragLoadingTimeOut: 20000, manifestLoadingTimeOut: 20000, enableWorker: false, cache: true });
    AppState.hls.loadSource(playURL); AppState.hls.attachMedia(videoPlayer);
    var manifestHandler = function () {
      videoPlayer.play()['catch'](function (err) { videoPlayer.muted = true; videoPlayer.play()['catch'](function () { }); updateMuteButton(); });
      startTimecodeSaving(); resetMouseIdleTimer(); startNearEndCheck(); startHeartbeat(); startTorrentStatsUpdates();
      AppState.hls.off(Hls.Events.MANIFEST_PARSED, manifestHandler);
    };
    AppState.hls.on(Hls.Events.MANIFEST_PARSED, manifestHandler);
    AppState.hls.on(Hls.Events.ERROR, function (event, data) {
      if (data.fatal) {
        hidePlayerLoading(); videoPlayer.removeEventListener('timeupdate', timeUpdateHandler); videoPlayer.removeEventListener('canplay', canPlayHandler);
        clearTimeout(AppState._loadingTimeout);
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) AppState.hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) AppState.hls.recoverMediaError();
      }
    });
    AppState._timeUpdateHandler = timeUpdateHandler; AppState._canPlayHandler = canPlayHandler; AppState._seekExecuted = seekExecuted;
    showPlayerLoading('Подготовка потока...', null);
  } else throw new Error('Ваш браузер не поддерживает HLS');
}

async function initTranscodingOffPlayback(initialSeek, signal) {
  var playURL = AppState.currentTorrserverUrl + '/stream?link=' + currentTimecodeData.hash + '&index=' + currentTimecodeData.fileId + '&play=play';
  var videoPlayer = getEl('video-player');
  destroyHls();

  // Прямой файл — без hls.js, отдаём ссылку нативному <video>
  AppState.seekOffset = 0;
  AppState.expectedDuration = null;
  AppState.originalDuration = null;

  showPlayerLoading('Подготовка потока...', null);

  var started = false;
  var startPlayback = function () {
    if (started || signal.aborted) return;
    started = true;
    if (AppState._loadingTimeout) clearTimeout(AppState._loadingTimeout);
    hidePlayerLoading();
    if (initialSeek > 0) {
      try { videoPlayer.currentTime = initialSeek; } catch (e) { }
    }
    videoPlayer.play()['catch'](function () {
      videoPlayer.muted = true;
      videoPlayer.play()['catch'](function () { });
      updateMuteButton();
    });
    videoPlayer.muted = false; updateMuteButton();
    startTimecodeSaving(); resetMouseIdleTimer(); startNearEndCheck(); startHeartbeat(); startTorrentStatsUpdates();
  };

  var onLoadedMetadata = function () {
    videoPlayer.removeEventListener('loadedmetadata', onLoadedMetadata);
    AppState.expectedDuration = videoPlayer.duration;
    AppState.originalDuration = videoPlayer.duration;
    forceUpdateDuration(videoPlayer.duration, videoPlayer.duration, 0);
  };

  var onCanPlay = function () {
    videoPlayer.removeEventListener('canplay', onCanPlay);
    startPlayback();
    hidePlayerLoading();
  };

  var onError = function () {
    videoPlayer.removeEventListener('error', onError);
    if (signal.aborted || AppState.currentScreen !== 'player') return;
    hidePlayerLoading();
    alert('Файл не воспроизводится напрямую: кодек/контейнер не поддерживается устройством');
  };

  videoPlayer.addEventListener('loadedmetadata', onLoadedMetadata);
  videoPlayer.addEventListener('canplay', onCanPlay);
  videoPlayer.addEventListener('error', onError);

  AppState._loadingTimeout = setTimeout(function () {
    if (!started && !signal.aborted) startPlayback();
  }, LOADING_TIMEOUT_MS);

  videoPlayer.src = playURL;
  videoPlayer.load();
  hidePlayerLoading();
}

async function initServerProxyPlayback(metadata, initialSeek, signal) {
  var seekParam = (initialSeek && initialSeek > 0) ? ('&start=' + initialSeek.toFixed(2)) : '';
  var durationParam = (metadata.fileInfo.duration && metadata.fileInfo.duration > 0) ? ('&duration=' + metadata.fileInfo.duration.toFixed(0)) : '';
  var audioParam = metadata.audioTrack !== null ? ('&audio=' + metadata.audioTrack) : '';
  var subParam = currentSubtitleTrack >= 0 ? ('&sub=' + currentSubtitleTrack) : '';
  var multiChannelParam = (AppState.multiChannelEnabled === true) ? '&multiChannel=true' : '';
  var savedClientId = localStorage.getItem('clientId');
  var dvParam = '&dv=' + AppState.dvPreferred;
  var response = await fetch(SERVER_URL + '/hls/stream?url=' + encodeURIComponent(AppState.videoUrl) + seekParam + audioParam + multiChannelParam + '&clientId=' + encodeURIComponent(savedClientId) + durationParam + subParam + dvParam, { signal: signal });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  var data = await response.json();
  if (!data.success) throw new Error(data.error || 'Ошибка создания потока');
  AppState.currentStreamId = data.streamId; AppState.expectedDuration = data.duration; AppState.originalDuration = data.originalDuration || data.duration;
  AppState.seekOffset = data.seekOffset || initialSeek || 0; AppState.lastSuccessfulSeek = AppState.seekOffset;
  var videoPlayer = getEl('video-player');
  if (Hls.isSupported()) {
    AppState.hls = createHlsInstance();
    attachHlsEventListeners(AppState.hls, videoPlayer, signal, initialSeek);
    AppState.hls.loadSource(data.playlistUrl); AppState.hls.attachMedia(videoPlayer);
  } else throw new Error('Ваш браузер не поддерживает HLS');
}

function attachHlsEventListeners(hls, videoPlayer, signal, initialSeek) {
  var isPlaybackCancelled = false;
  var manifestParsedHandler = function () {
    if (signal.aborted || isPlaybackCancelled) return;
    forceUpdateDuration(AppState.expectedDuration, AppState.originalDuration, AppState.seekOffset);
    videoPlayer.currentTime = 0; videoPlayer.pause(); startTorrentStatsUpdates();
    if (thisisseek) {
      hidePlayerLoading();
      if (!signal.aborted && !isPlaybackCancelled) videoPlayer.play()['catch'](function (err) { videoPlayer.muted = true; videoPlayer.play()['catch'](function () { }); updateMuteButton(); });
      videoPlayer.muted = false; updateMuteButton(); startTimecodeSaving(); resetMouseIdleTimer();
      if (nearEndCheckInterval) clearInterval(nearEndCheckInterval);
      startNearEndCheck(); startHeartbeat(); return;
    }
    showPlayerLoading('Буферизация...', null);
    var onCanPlay = function () {
      hidePlayerLoading();
      if (!signal.aborted && !isPlaybackCancelled) videoPlayer.play()['catch'](function (err) { videoPlayer.muted = true; videoPlayer.play()['catch'](function () { }); updateMuteButton(); });
      videoPlayer.muted = false; updateMuteButton(); startTimecodeSaving(); resetMouseIdleTimer();
      if (nearEndCheckInterval) clearInterval(nearEndCheckInterval);
      startNearEndCheck(); startHeartbeat(); videoPlayer.removeEventListener('canplay', onCanPlay);
    };
    videoPlayer.addEventListener('canplay', onCanPlay);
    AppState._loadingTimeout = setTimeout(function () {
      if (!signal.aborted && !isPlaybackCancelled) {
        videoPlayer.removeEventListener('canplay', onCanPlay); hidePlayerLoading();
        videoPlayer.play()['catch'](function (err) { videoPlayer.muted = true; videoPlayer.play()['catch'](function () { }); updateMuteButton(); });
        videoPlayer.muted = false; updateMuteButton(); startTimecodeSaving(); resetMouseIdleTimer();
        if (nearEndCheckInterval) clearInterval(nearEndCheckInterval);
        startNearEndCheck(); startHeartbeat();
      }
    }, 3000);
  };
  hls.off(Hls.Events.MANIFEST_PARSED, manifestParsedHandler); hls.on(Hls.Events.MANIFEST_PARSED, manifestParsedHandler);
  var fragLoadingHandler = function (event, data) { if (signal.aborted) return; };
  hls.off(Hls.Events.FRAG_LOADING, fragLoadingHandler); hls.on(Hls.Events.FRAG_LOADING, fragLoadingHandler);
  var bufferAppendedHandler = function (event, data) { if (signal.aborted) return; };
  hls.off(Hls.Events.BUFFER_APPENDED, bufferAppendedHandler); hls.on(Hls.Events.BUFFER_APPENDED, bufferAppendedHandler);
  var currentPlayingSegment = -1;
  var fragChangedHandler = function (event, data) {
    if (signal.aborted) return;
    if (data && data.frag) {
      var segmentNumber = data.frag.sn;
      if (currentPlayingSegment !== segmentNumber) {
        currentPlayingSegment = segmentNumber;
        if (segmentNumber > 0) {
          var now = Date.now();
          if (!window._lastCleanupTime || (now - window._lastCleanupTime) > 2000) {
            window._lastCleanupTime = now;
            fetch(SERVER_URL + '/hls/cleanup-segments/' + AppState.currentStreamId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keepFromSegment: segmentNumber }) }).catch(function () { });
          }
        }
      }
    }
  };
  hls.off(Hls.Events.FRAG_CHANGED, fragChangedHandler); hls.on(Hls.Events.FRAG_CHANGED, fragChangedHandler);
  var errorHandler = function (event, data) {
    if (signal.aborted || !data.fatal) return;
    switch (data.type) {
      case Hls.ErrorTypes.NETWORK_ERROR: AppState.hls.startLoad(); break;
      case Hls.ErrorTypes.MEDIA_ERROR:
        var errorMessage = data.error ? data.error.message || data.error : ''; var errorDetails = data.details || '';
        var isUnsupportedCodec = errorMessage.toLowerCase().includes('codec') || errorDetails.toLowerCase().includes('codec');
        if (AppState.videoUrl && (AppState.videoUrl.toLowerCase().includes('.avi') || AppState.videoUrl.toLowerCase().includes('.vc1'))) isUnsupportedCodec = true;
        if (isUnsupportedCodec) {
          getEl('playback-overlay').classList.add('active'); document.querySelector('.playback-text').textContent = 'Формат AVI или VC1 не поддерживаются на вашем устройстве'; hidePlayerLoading();
          setTimeout(function () { var exitBtn = getEl('exit-player-btn'); if (exitBtn) exitBtn.click(); else if (typeof showDetailView === 'function') showDetailView(); getEl('playback-overlay').classList.remove('active'); }, 4000);
        } else AppState.hls.recoverMediaError();
        break;
      default:
        AppState.playbackRetryCount = (AppState.playbackRetryCount || 0) + 1;
        if (AppState.playbackRetryCount <= MAX_PLAYBACK_RETRIES) {
          showPlayerLoading('Ошибка воспроизведения, попытка ' + AppState.playbackRetryCount + '...');
          setTimeout(function () { if (AppState.currentStreamId && !signal.aborted) startHLSPlayback(AppState.videoUrl, videoPlayer.currentTime + AppState.seekOffset, false); }, 2000);
        } else {
          hidePlayerLoading(); alert('Не удалось воспроизвести видео. Проверьте соединение или формат файла.');
          if (typeof showDetailView === 'function') showDetailView();
        }
        break;
    }
  };
  hls.off(Hls.Events.ERROR, errorHandler); hls.on(Hls.Events.ERROR, errorHandler);
}

async function startHLSPlayback(originalUrl, initialSeek, fromSearch, episodeIndex, audioTrack) {
  if (initialSeek === undefined) initialSeek = null;
  if (fromSearch === undefined) fromSearch = false;
  if (episodeIndex === undefined) episodeIndex = null;
  if (audioTrack === undefined) audioTrack = currentAudioTrack !== undefined ? currentAudioTrack : null;
  if (window.AndroidJS) {
    if (playInExternalPlayer(originalUrl, AppState.currentDetailItem.title, initialSeek, fromSearch)) {
      getEl('config-screen').style.display = 'none'; getEl('torrserver-section').style.display = 'none'; return;
    }
  }
  resetPlaybackState();
  currentPlaybackController = new AbortController(); var signal = currentPlaybackController.signal;
  currentBufferAhead = 0; wasImmediatePause = false; pauseTimer = null; pauseStartTime = null; AppState.playbackRetryCount = 0;
  if (!originalUrl || !originalUrl.trim()) { alert('Ошибка: URL не указан'); return false; }
  lastPlaybackFromSearch = fromSearch;
  if (!AppState.transcodingFullOnOff) {
    var metadata = await preparePlaybackMetadata(originalUrl, initialSeek, audioTrack, signal);
    if (!metadata || signal.aborted) return false;
    var { fileInfo, savedAudioTrack, fileName, savedSubTrack, savedTimecode, seekTime } = metadata;
    initialSeek = seekTime;
  } else {
    var metadata = await preparePlaybackMetadata(originalUrl, initialSeek, audioTrack, signal);
    if (metadata) {
      if (initialSeek === null) initialSeek = 0;
      var fileName = '';
    }
  }
  if (fileName) updatePlayerTitle(fileName);
  else if (AppState.currentDetailItem && AppState.currentDetailItem.title) updatePlayerTitle(AppState.currentDetailItem.title);
  if (AppState.currentDetailItem.hash) {
    var currentFileId = (episodeIndex !== null && currentEpisodeFiles[episodeIndex]) ? currentEpisodeFiles[episodeIndex].id : (metadata.match ? metadata.match[2] : null);
    setTimeout(function () { if (!signal.aborted) loadEpisodesInfo(AppState.currentDetailItem.hash, currentFileId); }, fromSearch ? EPISODES_LOAD_DELAY_SEARCH_MS : EPISODES_LOAD_DELAY_MS);
  }
  transitionToPlayerScreen(); AppState.videoUrl = originalUrl;
  var videoPlayer = getEl('video-player');
  videoPlayer.removeEventListener('ended', handleVideoEnded); videoPlayer.addEventListener('ended', handleVideoEnded);
  try {
    if (AppState.transcodingOnOff) {
      await initGstPlayback(metadata, initialSeek, signal);
    } else if (AppState.transcodingFullOnOff) {
      await initTranscodingOffPlayback(initialSeek, signal);
    } else {
      await initServerProxyPlayback(metadata, initialSeek, signal);
    }
    showPlayerHint(); return true;
  } catch (error) {
    if (error.name === 'AbortError') return false;
    alert('Ошибка воспроизведения: ' + error.message); return false;
  }
}

function cancelCurrentPlayback() {
  if (currentPlaybackController) { currentPlaybackController.abort(); currentPlaybackController = null; }
  if (AppState.bufferCheckInterval) { clearInterval(AppState.bufferCheckInterval); AppState.bufferCheckInterval = null; }
  if (AppState._loadingTimeout) { clearTimeout(AppState._loadingTimeout); AppState._loadingTimeout = null; }
  if (AppState._seekTimeout) { clearTimeout(AppState._seekTimeout); AppState._seekTimeout = null; }
  if (AppState.hls) { try { AppState.hls.destroy(); AppState.hls = null; } catch (e) { } }
  if (AppState.currentStreamId) { fetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST' })['catch'](function () { }); AppState.currentStreamId = null; }
  hidePlayerLoading();
}

function showDetailView(field = null) {
  if (!window.AndroidJS || !AppState.transcodingFullOnOff) {
    currentSubtitleTrack = -1; stopTorrentStatsUpdates(); hideSkipButton(); skipIntro = 0; skipCredits = 0;
    currentBufferAhead = 0; wasImmediatePause = false; pauseTimer = null; pauseStartTime = null; thisisseek = false;
    var seekSlider = getEl('seek-slider'); if (seekSlider) seekSlider.value = 0;
    var currentTimeSpan = getEl('current-time'); if (currentTimeSpan) currentTimeSpan.textContent = '00:00';
    if (AppState) { AppState.seekQueue = []; AppState.isSeeking = false; AppState.previewTime = null; AppState.suppressTimeUpdate = false; }
    if (AppState.isYoutubePlayback) {
      if (typeof window.exitYoutubePlayer === 'function') window.exitYoutubePlayer();
      else {
        if (AppState.currentStreamId) { fetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST' })['catch'](function () { }); AppState.currentStreamId = null; }
        if (AppState.hls) { AppState.hls.destroy(); AppState.hls = null; }
        AppState.isYoutubePlayback = false; AppState.currentScreen = 'catalog'; getEl('player-screen').style.display = 'none';
        var detailView = getEl('detail-view');
        if (detailView && AppState.youtubeContext) { detailView.style.display = 'block'; detailView.style.pointerEvents = 'auto'; }
        else if (typeof window.showCatalogList === 'function') window.showCatalogList();
      }
      return;
    }
    saveTimecodeToServer().then(function () { stopTimecodeSaving(); });
    stopHeartbeat();
    if (nearEndCheckInterval) { clearInterval(nearEndCheckInterval); nearEndCheckInterval = null; }
    lastCleanedSegment = -1; currentEpisodeFiles = []; currentEpisodeIndex = 0; currentTorrentHash = null;
    updatePlayerTitle(null); clearTimecodeData();
    var episodesPanel = getEl('episodes-panel'); var episodesBtn = getEl('episodes-btn');
    if (episodesPanel) episodesPanel.classList.add('hidden'); if (episodesBtn) episodesBtn.classList.remove('active');
    var audioPanel = getEl('audio-panel'); var audioBtn = getEl('audio-btn');
    if (audioPanel) { audioPanel.classList.add('hidden'); if (audioBtn) audioBtn.classList.remove('active'); }
    if (episodesBtn) episodesBtn.style.display = 'none';
    var prevBtn = getEl('prev-episode-btn'); var nextBtn = getEl('next-episode-btn');
    if (prevBtn) prevBtn.style.display = 'none'; if (nextBtn) nextBtn.style.display = 'none';
    AppState.currentScreen = 'detail';
    var videoPlayer = getEl('video-player');
    videoPlayer.removeEventListener('ended', handleVideoEnded); videoPlayer.pause(); videoPlayer.removeAttribute('src'); videoPlayer.load();
    destroyHls(); hidePlayerLoading();
    if (AppState.currentStreamId) { fetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST' })['catch'](function () { }); AppState.currentStreamId = null; }
    getEl('player-screen').style.display = 'none'; getEl('config-screen').style.display = 'none'; getEl('torrserver-section').style.display = 'block';
  }
  dropTorrentToServer(AppState.currentDetailItem.hash).then(function (result) { })['catch'](function (error) { });
  refreshTorrentsList().then(function () {
    if (AppState.currentDetailItem && AppState.currentDetailItem.hash) {
      var cacheKey = AppState.currentDetailItem.hash; if (progressCache.has(cacheKey)) progressCache.delete(cacheKey);
    }
  })['catch'](function (error) { });
  if (lastPlaybackFromSearch && lastAddedTorrentHash) {
    setTimeout(function () {
      var found = showDetailByHash(lastAddedTorrentHash);
      if (!found) refreshTorrentsList().then(function () { showDetailByHash(lastAddedTorrentHash); });
    }, 500);
    lastPlaybackFromSearch = false;
  } else {
    var detailView = getEl('detail-view');
    if (AppState.currentDetailItem) { detailView.style.display = 'block'; updateDetailProgress(AppState.currentDetailItem); }
    else detailView.style.display = 'none';
    setTimeout(function () {
      if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
        updateFocusableElements(); var progressBtnIndex = -1;
        if (typeof focusableElements !== 'undefined') {
          var fieldAsNumber = Number(field);
          if (field != null && !isNaN(fieldAsNumber)) setFocus(fieldAsNumber + 1);
          else {
            for (var i = 0; i < focusableElements.length; i++) {
              var el = focusableElements[i];
              if (el && (el.classList.contains('detail-progress-btn') || el.classList.contains('file-item') || el.classList.contains('back-btn'))) { progressBtnIndex = i; break; }
            }
            setFocus(progressBtnIndex !== -1 ? progressBtnIndex : 0);
          }
        }
      }
    }, 250);
  }
}

async function updateDetailProgress(torrent) {
  if (!torrent || !torrent.hash) return null;

  var btn = getEl('detail-progress-btn');
  if (!btn) return null;

  // Принудительное обновление: сбрасываем кэш прогресса
  var cacheKey = torrent.hash;
  if (progressCache.has(cacheKey)) progressCache.delete(cacheKey);

  // Чистим старые блоки (могли остаться от предыдущей версии)
  var oldProgressBlocks = document.querySelectorAll('#detail-progress');
  for (var i = 0; i < oldProgressBlocks.length; i++) oldProgressBlocks[i].remove();

  // Обработчик вешаем один раз (флаг общий с addProgressToDetail — кнопка одна),
  // читает dataset в момент клика
  if (!btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var hash = btn.dataset.hash || '';
      var fileId = parseInt(btn.dataset.fileId || '1', 10) || 1;
      var timecode = parseInt(btn.dataset.timecode || '0', 10) || 0;
      var episodeIndex = parseInt(btn.dataset.episodeIndex || '0', 10) || 0;
      if (!hash || !AppState.currentTorrserverUrl) return;
      var playUrl = AppState.currentTorrserverUrl + '/play/' + hash + '/' + fileId;
      getEl('playback-overlay').classList.add('active');
      var detailView = getEl('detail-view');
      if (detailView) detailView.style.pointerEvents = 'none';
      var done = function () {
        getEl('playback-overlay').classList.remove('active');
        if (detailView) detailView.style.pointerEvents = 'auto';
      };
      startHLSPlayback(playUrl, timecode, false, episodeIndex).then(done)['catch'](done);
    });
  }

  // === Состояние по умолчанию: «Играть» → первое видео (fileId = 1) ===
  btn.dataset.hash = torrent.hash;
  btn.dataset.fileId = '1';
  btn.dataset.timecode = '0';
  btn.dataset.episodeIndex = '0';
  btn.classList.remove('has-progress');
  btn.innerHTML = '<span class="btn-label">▶ Играть</span>';

  var progress = await loadProgressForTorrent(torrent);
  if (!progress || !(progress.timecode > 0)) return null; // прогресса нет — остаётся «Играть»

  // === Есть прогресс: «Продолжить» ===
  var fileId = parseInt(progress.fileId, 10) || 1;
  var timecode = progress.timecode;
  var episodeIndex = progress.episodeIndex || 0;

  var percent = progress.duration > 0 ? (timecode / progress.duration) * 100 : 0;
  var remaining = 100 - percent;
  var isNextFile = false;

  // Осталось ≤ 5% — запускаем следующий файл
  if (remaining <= 5) {
    var videoFiles = getVideoFilesFromTorrent(torrent);
    var nextFile = videoFiles.length ? videoFiles[episodeIndex + 1] : null;
    if (nextFile) {
      fileId = nextFile.id || (fileId + 1);
      timecode = 0;
      episodeIndex = episodeIndex + 1;
      isNextFile = true;
    } else if (progress.isSeries && episodeIndex + 1 < (progress.totalEpisodes || 0)) {
      fileId = fileId + 1; // фоллбэк, если список файлов ещё не загружен
      timecode = 0;
      episodeIndex = episodeIndex + 1;
      isNextFile = true;
    } else {
      timecode = 0; // это последний файл — начинаем с начала
    }
  }

  btn.dataset.fileId = String(fileId);
  btn.dataset.timecode = String(timecode);
  btn.dataset.episodeIndex = String(episodeIndex);
  btn.classList.add('has-progress');

  var timeStr = formatTime(progress.timecode);
  var totalStr = progress.duration ? formatTime(progress.duration) : '??:??';
  var hint = '';
  if (isNextFile) {
    hint = 'Серия ' + (episodeIndex + 1);
  } else {
    hint = timeStr + ' / ' + totalStr;
    if (progress.isSeries) hint = 'Серия ' + (episodeIndex + 1) + ' · ' + hint;
  }
  btn.innerHTML =
    '<span class="btn-label">▶ Продолжить</span>' +
    '<span class="btn-hint">' + hint + '</span>';

  // Обновляем полосу прогресса на элементе файла (как в оригинале)
  await updateCurrentFileProgress(torrent.hash, progress.fileId, progress.episodeIndex);

  return fileId;
}

async function updateCurrentFileProgress(hash, fileId, episodeIndex) {
  if (!hash || !fileId) return;
  var fileItems = document.querySelectorAll('.file-item'); var targetItem = null;
  for (var i = 0; i < fileItems.length; i++) { if (fileItems[i].dataset.hash === hash && fileItems[i].dataset.fileId == fileId) { targetItem = fileItems[i]; break; } }
  if (!targetItem) return;
  try {
    var savedClientId = localStorage.getItem('clientId');
    var response = await fetch(SERVER_URL + '/api/timecode/get?hash=' + hash + '&fileId=' + fileId + '&clientId=' + encodeURIComponent(savedClientId));
    if (response.ok) {
      var data = await response.json();
      if (data.success && data.timecode > 0 && data.duration && data.duration > 0) {
        var progressPercent = Math.min((data.timecode / data.duration) * 100, 98);
        var progressFill = targetItem.querySelector('.file-progress-fill');
        if (progressFill) { progressFill.style.width = progressPercent + '%'; if (progressPercent > 5) targetItem.classList.add('has-progress'); }
      }
    }
  } catch (error) { }
}

async function loadFileInfo(hash, fileId) {
  try {
    var savedClientId = localStorage.getItem('clientId');
    var response = await fetch(SERVER_URL + '/api/file/info?hash=' + hash + '&fileId=' + fileId + '&clientId=' + encodeURIComponent(savedClientId));
    if (response.ok) return await response.json();
  } catch (error) { }
  return null;
}

function renderAudioTracks() {
  var audioList = getEl('audio-list'); if (!audioList) return;
  if (AppState.transcodingFullOnOff) { audioList.innerHTML = '<div class="search-result-empty">Нет аудиодорожек</div>'; return; }
  if (!currentAudioTracks || currentAudioTracks.length === 0) { audioList.innerHTML = '<div class="search-result-empty">Нет аудиодорожек</div>'; return; }
  var html = '';
  for (var idx = 0; idx < currentAudioTracks.length; idx++) {
    var track = currentAudioTracks[idx]; var isActive = idx === currentAudioTrack;
    var language = track.language || 'unknown'; var channels = track.channels ? (track.channels + ' ch') : ''; var codec = track.codec || '';
    html += '<div class="audio-item ' + (isActive ? 'active' : '') + '" data-track-index="' + idx + '">' +
      '<div class="audio-icon">🔊</div><div class="audio-info"><div class="audio-title">' + escapeHtml(track.title || ('Дорожка ' + (idx + 1))) + '</div>' +
      '<div class="audio-details"><span class="audio-language">' + language.toUpperCase() + '</span>' + (channels ? ' <span class="audio-channels">' + channels + '</span>' : '') + (codec ? ' <span class="audio-codec">' + codec + '</span>' : '') + '</div></div><div class="audio-check">✓</div></div>';
  }
  audioList.innerHTML = html;
  var audioItems = audioList.querySelectorAll('.audio-item');
  for (var i = 0; i < audioItems.length; i++) {
    (function (item) { item.addEventListener('click', function () { switchAudioTrack(parseInt(item.dataset.trackIndex)); }); })(audioItems[i]);
  }
}

async function switchAudioTrack(trackIndex) {
  if (trackIndex === currentAudioTrack) { toggleAudioPanel(); return; }
  thisisseek = false; await saveTimecodeToServer();
  if (currentTimecodeData.hash && currentTimecodeData.fileId) await saveAudioPreference(currentTimecodeData.hash, currentTimecodeData.fileId, trackIndex);
  var audioPanel = getEl('audio-panel'); var audioBtn = getEl('audio-btn');
  if (audioPanel) { audioPanel.classList.add('hidden'); if (audioBtn) audioBtn.classList.remove('active'); }
  var videoPlayer = getEl('video-player'); var currentTime = videoPlayer.currentTime + AppState.seekOffset;
  getEl('playback-overlay').classList.add('active'); document.querySelector('.playback-text').textContent = 'Переключение аудиодорожки...';
  try {
    var parsed = AppState.videoUrl.match(/\/play\/([a-fA-F0-9]+)\/(\d+)/); if (!parsed) return;
    var hash = parsed[1]; var fileId = parsed[2]; var playUrl = AppState.currentTorrserverUrl + '/play/' + hash + '/' + fileId;
    if (AppState.currentStreamId) { await fetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST' }); AppState.currentStreamId = null; }
    destroyHls(); await startHLSPlayback(playUrl, currentTime, lastPlaybackFromSearch, currentEpisodeIndex, trackIndex);
    currentAudioTrack = trackIndex; renderAudioTracks();
  } catch (error) { alert('Ошибка при переключении аудиодорожки'); }
  finally { getEl('playback-overlay').classList.remove('active'); document.querySelector('.playback-text').textContent = 'Воспроизведение...'; }
}

function toggleAudioPanel() {
  var panel = getEl('audio-panel'); var btn = getEl('audio-btn');
  var episodesPanel = getEl('episodes-panel'); var episodesBtn = getEl('episodes-btn');
  if (!panel || !btn) return;
  if (panel.classList.contains('hidden')) {
    if (episodesPanel && !episodesPanel.classList.contains('hidden')) { episodesPanel.classList.add('hidden'); if (episodesBtn) episodesBtn.classList.remove('active'); }
    panel.classList.remove('hidden'); btn.classList.add('active'); renderAudioTracks();
  } else { panel.classList.add('hidden'); btn.classList.remove('active'); }
}

function setupAudioButton() {
  var audioBtn = getEl('audio-btn'); var closeAudioBtn = getEl('close-audio'); var audioPanel = getEl('audio-panel');
  if (!audioBtn || !closeAudioBtn || !audioPanel) return;
  audioBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleAudioPanel(); resetMouseIdleTimer(); });
  closeAudioBtn.addEventListener('click', function () { audioPanel.classList.add('hidden'); audioBtn.classList.remove('active'); resetMouseIdleTimer(); });
  document.addEventListener('click', function (e) { if (!audioPanel.contains(e.target) && !audioBtn.contains(e.target)) { audioPanel.classList.add('hidden'); audioBtn.classList.remove('active'); } });
}

async function saveAudioPreference(hash, fileId, audioTrack) {
  try {
    var savedClientId = localStorage.getItem('clientId');
    var response = await fetch(SERVER_URL + '/api/audio/pref/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hash: hash, fileId: fileId, audioTrack: audioTrack, clientId: savedClientId }) });
  } catch (error) { }
}

async function loadAudioPreference(hash, fileId) {
  try {
    var savedClientId = localStorage.getItem('clientId');
    var response = await fetch(SERVER_URL + '/api/audio/pref/get?hash=' + hash + '&fileId=' + fileId + '&clientId=' + encodeURIComponent(savedClientId));
    if (response.ok) { var data = await response.json(); if (data.success && data.audioTrack !== null) return data.audioTrack; }
  } catch (error) { }
  return null;
}

function renderSubtitleTracks() {
  var subtitlesList = getEl('subtitles-list'); if (!subtitlesList) return;
  if (AppState.transcodingFullOnOff) { subtitlesList.innerHTML = '<div class="search-result-empty">Нет субтитров</div>'; return; }
  if (!currentSubTracks || currentSubTracks.length === 0) { subtitlesList.innerHTML = '<div class="search-result-empty">Нет субтитров</div>'; return; }
  var html = ''; var isOff = currentSubtitleTrack === -1;
  html += '<div class="subtitle-item ' + (isOff ? 'active' : '') + '" data-track-index="-1"><div class="subtitle-icon">🚫</div><div class="subtitle-info"><div class="subtitle-title">Выключить субтитры</div></div><div class="subtitle-check">✓</div></div>';
  for (var idx = 0; idx < currentSubTracks.length; idx++) {
    var sub = currentSubTracks[idx]; var isActive = idx === currentSubtitleTrack;
    var language = sub.language || 'unknown'; var format = sub.format || sub.codec || ''; var title = sub.title || ('Субтитры ' + (idx + 1));
    var badges = ''; if (sub.default) badges += ' <span style="color: #4eff6a; font-size: 9px;">[DEFAULT]</span>'; if (sub.forced) badges += ' <span style="color: #ffd966; font-size: 9px;">[FORCED]</span>';
    html += '<div class="subtitle-item ' + (isActive ? 'active' : '') + '" data-track-index="' + idx + '"><div class="subtitle-icon">💬</div><div class="subtitle-info"><div class="subtitle-title">' + escapeHtml(title) + badges + '</div><div class="subtitle-details"><span class="subtitle-language">' + language.toUpperCase() + '</span>' + (format ? '<span class="subtitle-format">' + escapeHtml(format) + '</span>' : '') + '</div></div><div class="subtitle-check">✓</div></div>';
  }
  subtitlesList.innerHTML = html;
  var subtitleItems = subtitlesList.querySelectorAll('.subtitle-item');
  for (var i = 0; i < subtitleItems.length; i++) {
    (function (item) { item.addEventListener('click', function () { switchSubtitleTrack(parseInt(item.dataset.trackIndex)); }); })(subtitleItems[i]);
  }
}

async function switchSubtitleTrack(trackIndex) {
  if (trackIndex === currentSubtitleTrack) { toggleSubtitlesPanel(); return; }
  thisisseek = false; await saveTimecodeToServer();
  if (currentTimecodeData.hash && currentTimecodeData.fileId) await saveSubtitlePreference(currentTimecodeData.hash, currentTimecodeData.fileId, trackIndex);
  var subtitlesPanel = getEl('subtitles-panel'); var subtitlesBtn = getEl('subtitles-btn');
  if (subtitlesPanel) { subtitlesPanel.classList.add('hidden'); if (subtitlesBtn) subtitlesBtn.classList.remove('active'); }
  var videoPlayer = getEl('video-player'); var currentTime = videoPlayer ? (videoPlayer.currentTime + AppState.seekOffset) : 0;
  getEl('playback-overlay').classList.add('active'); document.querySelector('.playback-text').textContent = 'Переключение субтитров...';
  try {
    var parsed = AppState.videoUrl.match(/\/play\/([a-fA-F0-9]+)\/(\d+)/); if (!parsed) return;
    var hash = parsed[1]; var fileId = parsed[2]; var playUrl = AppState.currentTorrserverUrl + '/play/' + hash + '/' + fileId;
    if (AppState.currentStreamId) { await fetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST' }); AppState.currentStreamId = null; }
    destroyHls(); currentSubtitleTrack = trackIndex;
    await startHLSPlayback(playUrl, currentTime, lastPlaybackFromSearch, currentEpisodeIndex, currentAudioTrack);
    renderSubtitleTracks();
  } catch (error) { alert('Ошибка при переключении субтитров'); }
  finally { getEl('playback-overlay').classList.remove('active'); document.querySelector('.playback-text').textContent = 'Воспроизведение...'; }
}

function toggleSubtitlesPanel() {
  var panel = getEl('subtitles-panel'); var btn = getEl('subtitles-btn');
  var audioPanel = getEl('audio-panel'); var audioBtn = getEl('audio-btn');
  if (!panel || !btn) return;
  if (audioPanel && !audioPanel.classList.contains('hidden')) { audioPanel.classList.add('hidden'); if (audioBtn) audioBtn.classList.remove('active'); }
  if (panel.classList.contains('hidden')) {
    var episodesPanel = getEl('episodes-panel'); var episodesBtn = getEl('episodes-btn');
    if (episodesPanel && !episodesPanel.classList.contains('hidden')) { episodesPanel.classList.add('hidden'); if (episodesBtn) episodesBtn.classList.remove('active'); }
    panel.classList.remove('hidden'); btn.classList.add('active'); renderSubtitleTracks();
  } else { panel.classList.add('hidden'); btn.classList.remove('active'); }
}

function setupSubtitlesButton() {
  var subtitlesBtn = getEl('subtitles-btn'); var closeSubtitlesBtn = getEl('close-subtitles'); var subtitlesPanel = getEl('subtitles-panel');
  if (!subtitlesBtn || !closeSubtitlesBtn || !subtitlesPanel) return;
  subtitlesBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleSubtitlesPanel(); resetMouseIdleTimer(); });
  closeSubtitlesBtn.addEventListener('click', function () { subtitlesPanel.classList.add('hidden'); subtitlesBtn.classList.remove('active'); resetMouseIdleTimer(); });
  document.addEventListener('click', function (e) { if (!subtitlesPanel.contains(e.target) && !subtitlesBtn.contains(e.target)) { subtitlesPanel.classList.add('hidden'); subtitlesBtn.classList.remove('active'); } });
}

async function saveSubtitlePreference(hash, fileId, subtitleTrack) {
  try {
    var savedClientId = localStorage.getItem('clientId');
    await fetch(SERVER_URL + '/api/subtitle/pref/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hash: hash, fileId: fileId, subtitleTrack: subtitleTrack, clientId: savedClientId }) });
  } catch (error) { }
}

async function loadSubtitlePreference(hash, fileId) {
  try {
    var savedClientId = localStorage.getItem('clientId');
    var response = await fetch(SERVER_URL + '/api/subtitle/pref/get?hash=' + hash + '&fileId=' + fileId + '&clientId=' + encodeURIComponent(savedClientId));
    if (response.ok) { var data = await response.json(); if (data.success && data.subtitleTrack !== null) return data.subtitleTrack; }
  } catch (error) { }
  return -1;
}

async function handleVideoEnded() {
  stopHeartbeat(); stopTorrentStatsUpdates(); await saveTimecodeToServer();
  if (currentEpisodeFiles.length > 0 && currentEpisodeIndex < currentEpisodeFiles.length - 1) {
    getEl('playback-overlay').classList.add('active'); document.querySelector('.playback-text').textContent = 'Автоматическое переключение на серию ' + (currentEpisodeIndex + 2) + '...';
    try { var nextFile = currentEpisodeFiles[currentEpisodeIndex + 1]; await switchToEpisode(currentEpisodeIndex + 1, nextFile.id); }
    catch (error) { }
    finally { getEl('playback-overlay').classList.remove('active'); document.querySelector('.playback-text').textContent = 'Воспроизведение...'; }
  } else {
    var overlay = getEl('playback-overlay'); overlay.classList.add('active'); document.querySelector('.playback-text').textContent = 'Воспроизведение завершено';
    setTimeout(function () { overlay.classList.remove('active'); showDetailView(); }, 1500);
  }
}

function startNearEndCheck() {
  if (nearEndCheckInterval) clearInterval(nearEndCheckInterval);
  nearEndCheckInterval = setInterval(function () {
    var videoPlayer = getEl('video-player');
    var totalDuration = AppState.originalDuration || AppState.expectedDuration || videoPlayer.duration;
    var currentTime = videoPlayer.currentTime + AppState.seekOffset;
    if (totalDuration > 0 && currentTime >= totalDuration - 5 && !videoPlayer.paused && !videoPlayer.ended) { }
  }, 1000);
}

function exitPlayer() { if (nearEndCheckInterval) { clearInterval(nearEndCheckInterval); nearEndCheckInterval = null; } }

function setupPageUnloadHandler() {
  if (!window.AndroidJS) {
    currentSubtitleTrack = -1;
    window.addEventListener('unload', function () {
      if (AppState && AppState.currentStreamId) navigator.sendBeacon(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, '');
      if (currentTimecodeData && currentTimecodeData.hash && currentTimecodeData.fileId && currentTimecodeData.timecode > 0) {
        var savedClientId = localStorage.getItem('clientId');
        navigator.sendBeacon(SERVER_URL + '/api/timecode/save', JSON.stringify({ clientId: savedClientId, hash: currentTimecodeData.hash, fileId: currentTimecodeData.fileId, timecode: currentTimecodeData.timecode, duration: currentTimecodeData.duration }));
      }
    });
    window.addEventListener('beforeunload', function () {
      if (AppState.currentStreamId) {
        navigator.sendBeacon(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, '');
        fetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST', keepalive: true })['catch'](function () { });
      }
      if (currentTimecodeData.hash && currentTimecodeData.fileId && currentTimecodeData.timecode > 0) {
        var savedClientId = localStorage.getItem('clientId');
        navigator.sendBeacon(SERVER_URL + '/api/timecode/save', JSON.stringify({ clientId: savedClientId, hash: currentTimecodeData.hash, fileId: currentTimecodeData.fileId, timecode: currentTimecodeData.timecode, duration: currentTimecodeData.duration }));
      }
    });
    window.addEventListener('pagehide', function () {
      if (AppState.currentStreamId) navigator.sendBeacon(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, '');
      if (currentTimecodeData.hash && currentTimecodeData.fileId && currentTimecodeData.timecode > 0) {
        var savedClientId = localStorage.getItem('clientId');
        navigator.sendBeacon(SERVER_URL + '/api/timecode/save', JSON.stringify({ clientId: savedClientId, hash: currentTimecodeData.hash, fileId: currentTimecodeData.fileId, timecode: currentTimecodeData.timecode, duration: currentTimecodeData.duration }));
      }
    });
    document.addEventListener('visibilitychange', function () {
      var videoPlayer = getEl('video-player');
      if (document.hidden && videoPlayer && !videoPlayer.paused) videoPlayer.pause();
    });
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupPageUnloadHandler);
else setupPageUnloadHandler();

function updateClock() {
  var clock = getEl('clock-display'); if (!clock) return;
  var now = new Date(); clock.textContent = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
}
updateClock(); setInterval(updateClock, 60000);

function updatePlayerTimeline(timelineData) {
  try {
    var data = typeof timelineData === 'string' ? JSON.parse(timelineData) : timelineData;
    var isCompleted = data.percent === 100;
    if (!data.hash || data.hash === '0') {
      if (data.currentUrl) {
        var urlData = parseHashFromUrl(data.currentUrl);
        if (urlData) { data.hash = urlData.hash; data.torrentHash = urlData.torrentHash; data.fileId = urlData.fileId; }
        else return;
      } else return;
    }
    if (currentTimecodeData) {
      if (isCompleted) { currentTimecodeData.timecode = 100; currentTimecodeData.duration = 100; }
      else { currentTimecodeData.timecode = data.time; currentTimecodeData.duration = data.duration; }
      var hashParts = data.hash.split('_');
      if (hashParts.length >= 2) { currentTimecodeData.hash = hashParts[0]; currentTimecodeData.fileId = hashParts[1]; }
      else currentTimecodeData.hash = data.hash;
    }
    if (data.currentUrl && (!currentTimecodeData.hash || !currentTimecodeData.fileId)) {
      var urlData = parseHashFromUrl(data.currentUrl);
      if (urlData) { currentTimecodeData.hash = urlData.torrentHash; currentTimecodeData.fileId = urlData.fileId; }
    }
    var savedClientId = localStorage.getItem('clientId');
    if (savedClientId && currentTimecodeData.hash && currentTimecodeData.fileId) {
      var timecodeToSave = isCompleted ? Math.floor(currentTimecodeData.duration) : Math.floor(data.time);
      fetch(SERVER_URL + '/api/timecode/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: savedClientId, hash: currentTimecodeData.hash, fileId: currentTimecodeData.fileId, timecode: timecodeToSave, duration: currentTimecodeData.duration, completed: isCompleted })
      }).catch(function (e) { });
    }
    if (AppState.playFromHash && AppState.isCatalogSerials) { AppState.isCatalogSearch = false; return; }
    else if (AppState.playFromHash) { AppState.playFromHash = false; AppState.isCatalogSearch = false; return; }
    showDetailView(currentTimecodeData.fileId);
    if (AppState && AppState.currentDetailItem && currentTimecodeData.hash) updateDetailProgress(AppState.currentDetailItem);
  } catch (error) { }
}

function parseHashFromUrl(url) {
  if (!url) return null;
  try {
    var playMatch = url.match(/\/play\/([a-fA-F0-9]+)\/(\d+)/);
    if (playMatch) return { torrentHash: playMatch[1], fileId: playMatch[2], hash: playMatch[1] + '_' + playMatch[2] };
    var urlObj = new URL(url); var link = urlObj.searchParams.get('link'); var index = urlObj.searchParams.get('index');
    if (link && index) return { torrentHash: link, fileId: index, hash: link + '_' + index };
    return null;
  } catch (e) { return null; }
}

window.updatePlayerTimeline = updatePlayerTimeline;
window.parseHashFromUrl = parseHashFromUrl;
window.showDetailView = showDetailView;
window.setupEpisodesButton = setupEpisodesButton;
window.nextEpisode = nextEpisode;
window.prevEpisode = prevEpisode;
window.exitPlayer = exitPlayer;
window.cancelCurrentPlayback = cancelCurrentPlayback;

(function () {
  if (typeof window.Lampa === 'undefined') window.Lampa = {};
  if (typeof window.Lampa.Timeline === 'undefined') window.Lampa.Timeline = {};
  window.Lampa.Timeline.update = function (timelineData) {
    if (typeof updatePlayerTimeline === 'function') updatePlayerTimeline(timelineData);
  };
})();
