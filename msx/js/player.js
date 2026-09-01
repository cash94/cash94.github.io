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

// ==================== ОВЕРЛЕИ И ПОЛНОЭКРАННЫЙ РЕЖИМ ====================
/**
 * В полноэкранном режиме браузер рисует ТОЛЬКО полноэкранный элемент и его
 * потомков. Оверлеи плеера — #playback-overlay («Переключение на серию…»),
 * #loading-overlay и кнопка пропуска — лежат в <body> рядом с #player-screen,
 * поэтому раньше в fullscreen их просто не было видно: серия переключалась
 * молча, без единого сообщения.
 *
 * Держим их внутри текущего полноэкранного элемента и возвращаем на место при
 * выходе. Перенос узла сохраняет и слушатели, и классы, а клики по ним и так
 * ловит делегирование на document (CLICKABLE_SELECTORS в app.js).
 *
 * Само окно на весь экран app.js просит у document.documentElement — тогда
 * переносить обычно нечего. Этот код нужен для случаев, когда полноэкранным
 * стал другой элемент: часть ТВ-браузеров сама разворачивает <video> или
 * #player-screen.
 */
var FS_OVERLAY_IDS = ['playback-overlay', 'loading-overlay', 'skip-button'];
var fsOverlayHome = {};

function getFullscreenEl() {
  return document.fullscreenElement || document.webkitFullscreenElement ||
    document.mozFullScreenElement || document.msFullscreenElement || null;
}

/** Куда вешать оверлей, чтобы он был виден и в обычном режиме, и в fullscreen */
function getOverlayHost() {
  var fs = getFullscreenEl();
  if (fs && fs !== document.documentElement && fs !== document.body) return fs;
  return document.body;
}
window.getOverlayHost = getOverlayHost;

function syncFullscreenOverlays() {
  var host = getOverlayHost();
  for (var i = 0; i < FS_OVERLAY_IDS.length; i++) {
    var id = FS_OVERLAY_IDS[i];
    var el = document.getElementById(id);
    if (!el) continue;
    if (!fsOverlayHome[id]) fsOverlayHome[id] = el.parentNode || document.body;
    var target = (host === document.body) ? fsOverlayHome[id] : host;
    if (el.parentNode !== target) target.appendChild(el);
  }
}
window.syncFullscreenOverlays = syncFullscreenOverlays;

document.addEventListener('fullscreenchange', syncFullscreenOverlays);
document.addEventListener('webkitfullscreenchange', syncFullscreenOverlays);

function createSkipButton() {
  if (skipButton) {
    skipButton.remove();
    skipButton = null;
  }
  skipButton = document.createElement('div');
  skipButton.id = 'skip-button';
  skipButton.className = 'skip-button hidden';
  skipButton.innerHTML = '⏩ Пропустить';
  getOverlayHost().appendChild(skipButton);
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
  if (!videoPlayer) return;
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

/** Недоступная кнопка управления: гасится классом, .control-btn.is-disabled */
function setControlDisabled(btn, disabled) {
  if (!btn) return;
  if (disabled) btn.classList.add('is-disabled');
  else btn.classList.remove('is-disabled');
}

function updateEpisodeButtons() {
  var prevBtn = getEl('prev-episode-btn');
  var nextBtn = getEl('next-episode-btn');
  if (!prevBtn || !nextBtn) return;
  var filesLen = currentEpisodeFiles.length;
  if (filesLen > 0) {
    prevBtn.style.display = 'flex';
    nextBtn.style.display = 'flex';
    // Класс, а не inline-стиль: гашение по бездействию (setPlayerControlsIdle)
    // переписывает opacity всем кнопкам подряд, и «серым» кнопкам возвращался
    // полный цвет — недоступная кнопка выглядела рабочей
    setControlDisabled(prevBtn, currentEpisodeIndex === 0);
    setControlDisabled(nextBtn, currentEpisodeIndex === filesLen - 1);
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
    if (subtitleElement) subtitleElement.classList.add('hidden', 'idle-hidden');
    return;
  }
  var shouldShow = forceVisible === null ? !!(controlsContainer && !controlsContainer.classList.contains('idle-hidden')) : !!forceVisible;
  if (shouldShow) {
    titleElement.classList.remove('hidden', 'idle-hidden');
    if (subtitleElement) subtitleElement.classList.remove('hidden', 'idle-hidden');
  } else {
    titleElement.classList.add('hidden', 'idle-hidden');
    if (subtitleElement) subtitleElement.classList.add('hidden', 'idle-hidden');
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

/**
 * Элементы, которые гаснут вместе с панелью управления. Список статический,
 * поэтому собираем его один раз: resetMouseIdleTimer зовётся на КАЖДОЕ движение
 * мыши и нажатие пульта, и десять getElementById + переписывание inline-стилей
 * на каждый вызов на ТВ заметны.
 */
var idleControlEls = null;

function getIdleControlEls() {
  if (idleControlEls) return idleControlEls;
  var ids = ['controls-container', 'buffer-stats', 'player-hint', 'toggle-buffer-btn',
    'exit-player-btn', 'episodes-btn', 'subtitles-btn', 'prev-episode-btn',
    'next-episode-btn', 'player-title'];
  var list = [];
  for (var i = 0; i < ids.length; i++) { var el = getEl(ids[i]); if (el) list.push(el); }
  if (list.length) idleControlEls = list;   // пусто — DOM ещё не готов, попробуем позже
  return list;
}

/**
 * Гасим и показываем только классом idle-hidden — под него в styles.css уже
 * прописаны opacity и pointer-events с !important. Раньше тут вдобавок
 * переписывались inline-стили, и они спорили с hidePlayerControls/
 * showPlayerControls из control.js, которые работают ровно с этим классом.
 *
 * Кнопки внутри #controls-container (аудио, субтитры, буфер, серии) отдельно
 * трогать незачем: гаснет контейнер — гаснут и они.
 */
function setPlayerControlsIdle(hidden) {
  var els = getIdleControlEls();
  for (var i = 0; i < els.length; i++) {
    if (hidden) els[i].classList.add('idle-hidden');
    else els[i].classList.remove('idle-hidden');
  }
  syncPlayerTitleVisibility(!hidden);
}
window.setPlayerControlsIdle = setPlayerControlsIdle;

function resetMouseIdleTimer() {
  var playerScreen = getEl('player-screen');
  if (!playerScreen || playerScreen.style.display !== 'block') return;
  var playerOverlay = getEl('player-overlay');
  if (playerOverlay) playerOverlay.classList.add('touch-active');

  // Классы трогаем, только если панель действительно спрятана. Раньше на
  // каждое нажатие пульта переписывались inline-стили десяти элементов подряд.
  // Состояние читаем из DOM, а не из своего флага: панель прячет и показывает
  // ещё и control.js (hidePlayerControls / showPlayerControls).
  var controls = getEl('controls-container');
  if (!controls || controls.classList.contains('idle-hidden')) setPlayerControlsIdle(false);

  if (mouseIdleTimer) clearTimeout(mouseIdleTimer);
  mouseIdleTimer = setTimeout(function () {
    if (playerScreen.style.display !== 'block') return;
    if (playerOverlay) playerOverlay.classList.remove('touch-active');
    setPlayerControlsIdle(true);
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

  // Кнопка «Пропустить вступление / титры» не зависит от того, показана ли
  // строка буфера. Раньше проверка жила внутри ветки отрисовки, и жёлтая кнопка
  // на пульте (скрыть буфер) заодно отключала пропуск заставки.
  checkAndShowSkipButton(videoPlayer.currentTime + AppState.seekOffset);

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
  var videoPlayer = getEl('video-player');
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
    if (videoPlayer) videoPlayer.removeEventListener('timeupdate', AppState._timeUpdateHandler);
    AppState._timeUpdateHandler = null;
  }
  if (AppState._canPlayHandler) {
    if (videoPlayer) videoPlayer.removeEventListener('canplay', AppState._canPlayHandler);
    AppState._canPlayHandler = null;
  }
  if (AppState._loadingTimeout) {
    clearTimeout(AppState._loadingTimeout);
    AppState._loadingTimeout = null;
  }
  // Отложенная перемотка ползунком (debounce 300 мс в seekStream). Раньше её
  // никто не отменял: уйти из плеера сразу после ползунка — и seek уходил уже
  // в уничтоженный поток
  if (AppState.seekTimeout) {
    clearTimeout(AppState.seekTimeout);
    AppState.seekTimeout = null;
  }
  if (AppState._seekExecuted) AppState._seekExecuted = false;
  // Слушатели прямого воспроизведения (initTranscodingOffPlayback)
  if (AppState._directPlaybackDetach) { AppState._directPlaybackDetach(); AppState._directPlaybackDetach = null; }

  if (AppState.hls) {
    AppState.expectedDuration = null;
    AppState.originalDuration = null;
    AppState.seekOffset = 0;
    AppState.lastSuccessfulSeek = 0;
    if (videoPlayer) {
      delete videoPlayer.dataset.expectedDuration;
      delete videoPlayer.dataset.originalDuration;
      delete videoPlayer.dataset.seekOffset;
    }
    AppState.hls.destroy();
    AppState.hls = null;
  }
  AppState.nativeVideoPlayer = null;
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
  // var episodeItems = episodesList.querySelectorAll('.episode-item');
  // for (var i = 0; i < episodeItems.length; i++) {
  //   (function (item) {
  //     var index = parseInt(item.dataset.index);
  //     var fileId = item.dataset.fileId;
  //     item.addEventListener('click', function (e) {
  //       if (e.target.classList && e.target.classList.contains('episode-play')) return;
  //       switchToEpisode(index, fileId);
  //     });
  //     var playBtn = item.querySelector('.episode-play');
  //     if (playBtn) playBtn.addEventListener('click', function (e) {
  //       e.stopPropagation();
  //       switchToEpisode(index, fileId);
  //     });
  //   })(episodeItems[i]);
  // }
  // Клики обрабатываются делегированием
  setupEpisodesListDelegation();
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

// ==================== ПАНЕЛИ ПЛЕЕРА (серии / аудио / субтитры) ====================
/**
 * Три панели устроены одинаково, поэтому и открываются одинаково: открыта
 * ровно одна. Раньше у каждой был свой toggle, и «Серии» не закрывали аудио и
 * субтитры — на экране могли оказаться две панели сразу.
 */
var PLAYER_PANELS = {
  episodes: { panel: 'episodes-panel', btn: 'episodes-btn' },
  audio: { panel: 'audio-panel', btn: 'audio-btn' },
  subtitles: { panel: 'subtitles-panel', btn: 'subtitles-btn' }
};

function setPlayerPanel(name, open) {
  var cfg = PLAYER_PANELS[name];
  if (!cfg) return false;
  var panel = getEl(cfg.panel), btn = getEl(cfg.btn);
  if (!panel) return false;
  if (open) { panel.classList.remove('hidden'); if (btn) btn.classList.add('active'); }
  else { panel.classList.add('hidden'); if (btn) btn.classList.remove('active'); }
  return true;
}

function isPlayerPanelOpen(name) {
  var cfg = PLAYER_PANELS[name];
  var panel = cfg && getEl(cfg.panel);
  return !!(panel && !panel.classList.contains('hidden'));
}

function closePlayerPanels(except) {
  for (var name in PLAYER_PANELS) {
    if (name !== except) setPlayerPanel(name, false);
  }
}
window.closePlayerPanels = closePlayerPanels;

function togglePlayerPanel(name) {
  var willOpen = !isPlayerPanelOpen(name);
  closePlayerPanels(name);
  if (willOpen) {
    if (name === 'episodes') {
      var hash = AppState.currentDetailItem && AppState.currentDetailItem.hash;
      // Список уже собран для этого торрента — только перерисовываем.
      // loadEpisodesInfo ходит в TorrServer до четырёх раз с паузами по 800 мс,
      // а раньше это повторялось на каждое открытие панели.
      if (hash && currentEpisodeFiles.length && currentTorrentHash === hash) renderEpisodesList();
      else if (hash) loadEpisodesInfo(hash);
    } else if (name === 'audio') renderAudioTracks();
    else if (name === 'subtitles') renderSubtitleTracks();
  }
  setPlayerPanel(name, willOpen);
  return willOpen;
}

/**
 * Клик мимо открытой панели закрывает её. Один слушатель на все три: раньше
 * setupEpisodesButton / setupAudioButton / setupSubtitlesButton вешали по
 * своему на document.
 */
function setupPlayerPanelsOutsideClick() {
  if (setupPlayerPanelsOutsideClick._bound) return;
  setupPlayerPanelsOutsideClick._bound = true;
  document.addEventListener('click', function (e) {
    var inPlayer = AppState && AppState.currentScreen === 'player';
    for (var name in PLAYER_PANELS) {
      if (!isPlayerPanelOpen(name)) continue;
      var cfg = PLAYER_PANELS[name];
      var panel = getEl(cfg.panel), btn = getEl(cfg.btn);
      if (panel && panel.contains(e.target)) continue;
      if (btn && btn.contains(e.target)) continue;
      setPlayerPanel(name, false);
    }
    if (inPlayer) resetMouseIdleTimer();
  });
}

function toggleEpisodesPanel() { return togglePlayerPanel('episodes'); }

// ==================== ДЕЛЕГИРОВАНИЕ СПИСКОВ ПЛЕЕРА ====================
function setupEpisodesListDelegation() {
  var episodesList = getEl('episodes-list');
  if (!episodesList || episodesList._delegated) return;

  episodesList._delegated = true;

  episodesList.addEventListener('click', function (e) {
    var item = e.target && e.target.closest ? e.target.closest('.episode-item') : null;
    if (!item) return;

    var index = parseInt(item.dataset.index, 10);
    var fileId = item.dataset.fileId;

    if (isNaN(index) || !fileId) return;

    switchToEpisode(index, fileId);

    if (typeof resetMouseIdleTimer === 'function') {
      resetMouseIdleTimer();
    }
  });
}

function setupAudioListDelegation() {
  var audioList = getEl('audio-list');
  if (!audioList || audioList._delegated) return;

  audioList._delegated = true;

  audioList.addEventListener('click', function (e) {
    var item = e.target && e.target.closest ? e.target.closest('.audio-item') : null;
    if (!item) return;

    var trackIndex = parseInt(item.dataset.trackIndex, 10);
    if (isNaN(trackIndex)) return;

    switchAudioTrack(trackIndex);

    if (typeof resetMouseIdleTimer === 'function') {
      resetMouseIdleTimer();
    }
  });
}

function setupSubtitlesListDelegation() {
  var subtitlesList = getEl('subtitles-list');
  if (!subtitlesList || subtitlesList._delegated) return;

  subtitlesList._delegated = true;

  subtitlesList.addEventListener('click', function (e) {
    var item = e.target && e.target.closest ? e.target.closest('.subtitle-item') : null;
    if (!item) return;

    var trackIndex = parseInt(item.dataset.trackIndex, 10);
    if (isNaN(trackIndex)) return;

    switchSubtitleTrack(trackIndex);

    if (typeof resetMouseIdleTimer === 'function') {
      resetMouseIdleTimer();
    }
  });
}
// ==================== /ДЕЛЕГИРОВАНИЕ СПИСКОВ ПЛЕЕРА ====================

function setupEpisodesButton() {
  var episodesBtn = getEl('episodes-btn');
  var closeEpisodesBtn = getEl('close-episodes');
  var episodesPanel = getEl('episodes-panel');

  if (!episodesBtn || !closeEpisodesBtn || !episodesPanel) return;

  // Делегирование кликов по списку серий
  setupEpisodesListDelegation();

  episodesBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    toggleEpisodesPanel();
    resetMouseIdleTimer();
  });

  closeEpisodesBtn.addEventListener('click', function () {
    setPlayerPanel('episodes', false);
    resetMouseIdleTimer();
  });

  setupPlayerPanelsOutsideClick();
}

function preloadTorrents(hash, fileId) {
  if (!hash || !fileId || !AppState.currentTorrserverUrl) return;
  var preloadUrl = AppState.currentTorrserverUrl + "/stream?link=" + hash + "&index=" + fileId + "&preload=preload";
  return fetch(preloadUrl, { method: 'GET', keepalive: true })
    .then(function (response) { return new Promise(function (resolve) { setTimeout(resolve, 4000); }); })
    .catch(function (error) { return Promise.resolve(); });
}

function getCurrentItemPoster() {
  var item = AppState.currentDetailItem;
  if (!item) return null;
  if (item.poster) return item.poster;
  if (item.poster_path && typeof getTmdbImageUrl === 'function') {
    try { return getTmdbImageUrl(item.poster_path, 'w342'); } catch (e) { /* ignore */ }
  }
  return null;
}

/**
 * Строит плейлист ВСЕХ серий торрента, чтобы нативный плеер переключал их сам,
 * без возврата в веб-страницу между сериями.
 *
 * Раньше список резался «с текущей серии и до конца». Из-за этого при запуске
 * со второй серии плеер получал 5 файлов вместо 6, вторая серия становилась в
 * плейлисте первой, и он показывал «Эпизод 1 из 5». Плюс кнопка «предыдущая
 * серия» не могла увести назад.
 *
 * Отдаём весь список целиком: с какого элемента стартовать, MainActivity
 * вычисляет сама — ищет в плейлисте совпадение по url с запускаемым файлом
 * (runPlayer, indexOfFirst), а startSeekTime применяется только к нему.
 */
function buildEpisodesPlaylist(fromIndex, startSeekTime) {
  if (!Array.isArray(currentEpisodeFiles) || currentEpisodeFiles.length < 2) return null;
  if (!currentTorrentHash || !AppState.currentTorrserverUrl) return null;
  var startIndex = (typeof fromIndex === 'number' && fromIndex >= 0) ? fromIndex : currentEpisodeIndex;
  if (typeof startIndex !== 'number' || startIndex < 0) return null;
  // Прогресс по всем файлам торрента уже лежит в кэше (его греет
  // startHLSPlayback перед открытием внешнего плеера) — берём его синхронно.
  var progress = null;
  try {
    if (typeof torrentProgressCache !== 'undefined' && torrentProgressCache) progress = torrentProgressCache.get(currentTorrentHash);
  } catch (e) { /* кэша нет — пойдём с нулевыми таймкодами */ }
  var byFileId = (progress && progress.byFileId) || {};
  var playlist = [];
  for (var i = 0; i < currentEpisodeFiles.length; i++) {
    var file = currentEpisodeFiles[i];
    if (!file || file.id === undefined || file.id === null) continue;
    var itemUrl = AppState.currentTorrserverUrl + "/stream?link=" + currentTorrentHash + "&index=" + file.id + "&play=play";
    // Свой timeline у КАЖДОГО элемента плейлиста обязателен: именно его
    // нативный плеер вернёт в updatePlayerTimeline при выходе. Без него hash
    // приходил пустым ('0'), и таймкод серии терялся целиком.
    var saved = byFileId[String(file.id)];
    var itemTime = (i === startIndex && startSeekTime > 0) ? Math.floor(startSeekTime)
      : (saved && saved.timecode > 0 ? Math.floor(saved.timecode) : 0);
    var itemDuration = (saved && saved.duration > 0) ? saved.duration : 0;
    playlist.push({
      url: itemUrl,
      title: file.name || file.path || ('Серия ' + (i + 1)),
      timecode: itemTime,
      timeline: {
        hash: currentTorrentHash + '_' + file.id,
        time: itemTime,
        duration: itemDuration,
        percent: itemDuration > 0 ? Math.round((itemTime / itemDuration) * 100) : 0
      },
      episode: i + 1,
      season: AppState.currentSeason || null
    });
  }
  return playlist.length > 1 ? playlist : null;
}

/**
 * Заголовок для внешнего плеера (AndroidJS): название плюс номер серии.
 *
 * Встроенный плеер показывает имя файла (updatePlayerTitle(fileName) в
 * startHLSPlayback), и серия в нём видна сама собой. Внешнему же передавалось
 * голое AppState.currentDetailItem.title — какую серию смотришь, на экране
 * телевизора было не понять.
 *
 * Данные к этому моменту уже есть: ветка AndroidJS специально дожидается
 * loadEpisodesInfo до запуска плеера (ей нужен плейлист), а тот заполняет
 * currentEpisodeFiles и currentEpisodeIndex.
 *
 * Формат «Серия N» — тот же, что в панели серий и в fallback'е
 * buildEpisodesPlaylist. Для фильма (файл один) остаётся чистое
 * название: дописывать «Серия 1» там незачем.
 */
/**
 * Название БЕЗ номера серии: сериал и, если известен, сезон.
 *
 * Нужно встроенному плееру (AndroidJS + Media3): он ведёт плейлист сам и знает
 * текущий индекс, поэтому номер эпизода дописывает уже на своей стороне. Если
 * отдать ему готовое «Серия 1», номер останется от той серии, с которой запуск
 * начался, и на второй серии заголовок превратится в «Серия 1 · Эпизод 2».
 *
 * Внешним плеерам по-прежнему уходит buildExternalPlayerTitle(): они плейлист
 * не отслеживают, и номер им надо вшить в строку заранее.
 */
function buildBasePlayerTitle() {
  var base = (AppState.currentDetailItem && AppState.currentDetailItem.title) || '';
  if (!base) return '';
  if (AppState.currentSeason) return base + ' · Сезон ' + AppState.currentSeason;
  return base;
}

function buildExternalPlayerTitle() {
  var base = (AppState.currentDetailItem && AppState.currentDetailItem.title) || '';

  if (!currentEpisodeFiles || currentEpisodeFiles.length < 2) return base || 'Видео';

  var idx = currentEpisodeIndex;
  if (typeof idx !== 'number' || idx < 0 || !currentEpisodeFiles[idx]) return base || 'Видео';

  var part = 'Серия ' + (idx + 1);
  if (AppState.currentSeason) part = 'Сезон ' + AppState.currentSeason + ', ' + part;

  // Без названия сериала (из поиска торрентов такое бывает) — отдаём хотя бы
  // имя файла, оно информативнее одинокого «Серия 3»
  if (!base) {
    var file = currentEpisodeFiles[idx];
    return file.name || file.path || part;
  }

  return base + ' · ' + part;
}

// Последний запуск внешнего плеера: любой повторный вызов с тем же URL в
// пределах пары секунд — это дубль (двойной клик, досланный WebView click),
// а не осознанный перезапуск. Две подряд AndroidJS.openPlayer открывают две
// активити, и вторая вылезает ровно в момент выхода из первой.
var lastExternalOpen = { url: null, time: 0 };
var EXTERNAL_OPEN_DEDUP_MS = 2500;

/**
 * Единственная точка запуска внешнего плеера: глушит дубли и запоминает,
 * чем плеер открывали — чтобы updatePlayerTimeline было от чего оттолкнуться,
 * если нативный плеер вернёт таймлайн без hash.
 */
function openAndroidPlayer(playURL, playerData) {
  if (!window.AndroidJS || !playURL) return false;
  var urlData = parseHashFromUrl(playURL);
  if (urlData) {
    currentTimecodeData.hash = urlData.torrentHash;
    currentTimecodeData.fileId = urlData.fileId;
    currentTimecodeData.timecode = (playerData && playerData.timecode) || 0;
  }
  if (lastExternalOpen.url === playURL && Date.now() - lastExternalOpen.time < EXTERNAL_OPEN_DEDUP_MS) return false;
  lastExternalOpen.url = playURL; lastExternalOpen.time = Date.now();
  AndroidJS.openPlayer(playURL, JSON.stringify(playerData));
  return true;
}
window.openAndroidPlayer = openAndroidPlayer;

function playInExternalPlayer(url, title, timecode, fromSearch) {
  if (!window.AndroidJS || !url) return false;
  var ref = parseStreamRef(url);
  if (ref) {
    var torrentHash = ref.hash; var fileId = parseInt(ref.fileId);
    var seekTime = (timecode != null && timecode > 0) ? Math.floor(timecode) : 0;
    currentTimecodeData.hash = torrentHash; currentTimecodeData.fileId = fileId; currentTimecodeData.timecode = seekTime;
    var playURL = AppState.currentTorrserverUrl + "/stream?link=" + torrentHash + "&index=" + fileId + "&play=play";
    var item = AppState.currentDetailItem;
    var playerData = {
      url: playURL, title: title || 'Видео', iptv: false, timecode: seekTime,
      // Для встроенного плеера — без номера серии, он допишет его сам
      title_base: buildBasePlayerTitle(),
      // Данные для кнопки «Пропустить»: встроенный плеер сам дёргает этот API на
      // каждую серию (номер эпизода он берёт из index= в ссылке файла). Адрес
      // передаём отсюда, чтобы смена хоста не требовала пересборки приложения.
      skip_api: (AppState.protocol || 'https:') + '//tsskip.hnar.online/v2/media',
      tmdb_id: AppState.currentTMDB || null,
      season: AppState.currentSeason || null,
      // Периодическое сохранение таймкода прямо из встроенного плеера. Веб-плеер
      // шлёт его раз в 10 секунд (startTimecodeSaving), а из нативного таймкод
      // приходил только при выходе — через updatePlayerTimeline. Если приложение
      // убьют или пропадёт питание, прогресс терялся целиком.
      timecode_api: SERVER_URL + '/api/timecode/save',
      client_id: localStorage.getItem('clientId') || null,
      timeline: { hash: torrentHash + '_' + fileId, time: seekTime, duration: 0, percent: 0 },
      poster: getCurrentItemPoster(),
      id: item && (item.tmdbId || item.id) || null,
      type: (item && item.media_type) || (AppState.isCatalogSerials ? 'tv' : 'movie')
    };
    if (AppState.autoSwitchEpisodes) {
      var playlist = buildEpisodesPlaylist(currentEpisodeIndex, seekTime);
      if (playlist) playerData.playlist = playlist;
    }
    lastPlaybackFromSearch = fromSearch;
    if (!AppState.playFromHash) AppState.inSearch = 'torrents';
    else { AppState.currentDetailItem = AppState.androidBackCatalog; AppState.inSearch = 'catalog'; }
    AppState.currentScreen = 'detail';
    openAndroidPlayer(playURL, playerData);
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
  // Тик буфера и проверки «Пропустить» заводится вместе с плеером и гаснет сам,
  // когда экран сменится (app.js)
  if (typeof window.startBufferUpdates === 'function') window.startBufferUpdates();
  getEl('config-screen').style.display = 'none';
  getEl('torrserver-section').style.display = 'none';
  getEl('detail-view').style.display = 'none';
  // Уходим в плеер мгновенно: затухание карточки тут не нужно, но недоигранный
  // индикатор «Загрузка…» гасим, чтобы он не всплыл при возврате
  if (typeof Animations !== 'undefined' && typeof Animations.hideDetailLoading === 'function') Animations.hideDetailLoading(true);
  getEl('player-screen').style.display = 'block';
  clearFocused();
  // Часы тикают раз в минуту от загрузки страницы: без этого при входе в плеер
  // они могли показывать время почти минутной давности
  if (typeof updateClock === 'function') updateClock();
  var controlsContainer = getEl('controls-container');
  if (controlsContainer) controlsContainer.classList.add('idle-hidden');
  if (typeof currentFocusIndex !== 'undefined') currentFocusIndex = 0;
  if (typeof updateFocusableElements === 'function') updateFocusableElements();
}

var DEFAULT_PLAYER_HINT = '← Назад для выхода';

/**
 * Подсказка внизу экрана. Аргумент нужен control.js: по первому Back он
 * показывает «Нажмите Back ещё раз для выхода». Раньше текст игнорировался,
 * и вместо предупреждения всплывала обычная подсказка.
 */
function showPlayerHint(message) {
  var playerHint = getEl('player-hint');
  if (!playerHint) return;
  playerHint.textContent = message || DEFAULT_PLAYER_HINT;
  playerHint.style.opacity = '1';
  if (AppState.hintTimeout) clearTimeout(AppState.hintTimeout);
  AppState.hintTimeout = setTimeout(function () {
    playerHint.style.opacity = '0';
    playerHint.textContent = DEFAULT_PLAYER_HINT;
  }, 4000);
}

async function preparePlaybackMetadata(originalUrl, initialSeek, audioTrack, signal) {
  var match = originalUrl.match(/\/play\/([a-fA-F0-9]+)\/(\d+)\/?/);
  if (!match) {
    console.error('❌ Некорректный URL для воспроизведения:', originalUrl);
    alert('Ошибка: Некорректная ссылка на видео');
    return null;
  }
  currentTimecodeData.hash = match[1]; currentTimecodeData.fileId = match[2]; currentTimecodeData.timecode = 0;
  // if (AppState.transcodingFullOnOff) {
  //   return true;
  // }
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
  destroyHls();   // заодно снимает слушатели прошлого прямого файла

  // Прямой файл — без hls.js, отдаём ссылку нативному <video>
  AppState.seekOffset = 0;
  AppState.expectedDuration = null;
  AppState.originalDuration = null;

  showPlayerLoading('Подготовка потока...', null);

  var started = false;
  var startPlayback = function () {
    if (started || signal.aborted) return;
    started = true;
    if (AppState._loadingTimeout) { clearTimeout(AppState._loadingTimeout); AppState._loadingTimeout = null; }
    videoPlayer.removeEventListener('canplay', onCanPlay);
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

  // Все три слушателя снимаем одной функцией: раньше 'error' не снимался
  // вообще, и на каждом переключении серии на <video> оседал ещё один
  var detachDirectListeners = function () {
    videoPlayer.removeEventListener('loadedmetadata', onLoadedMetadata);
    videoPlayer.removeEventListener('canplay', onCanPlay);
    videoPlayer.removeEventListener('error', onError);
  };

  var onLoadedMetadata = function () {
    videoPlayer.removeEventListener('loadedmetadata', onLoadedMetadata);
    AppState.expectedDuration = videoPlayer.duration;
    AppState.originalDuration = videoPlayer.duration;
    forceUpdateDuration(videoPlayer.duration, videoPlayer.duration, 0);

    // Дорожки прямого файла отдаёт сам <video>. Раньше их только печатали в
    // консоль, поэтому панель аудио в этом режиме всегда была пустой, хотя
    // переключение (switchNativeAudioTrack) уже было написано.
    var nativeTracks = collectNativeAudioTracks(videoPlayer);
    if (nativeTracks.length) {
      currentAudioTracks = nativeTracks;
      var enabled = -1;
      for (var i = 0; i < videoPlayer.audioTracks.length; i++) {
        if (videoPlayer.audioTracks[i].enabled) { enabled = i; break; }
      }
      currentAudioTrack = enabled >= 0 ? enabled : 0;
      renderAudioTracks();
    }
  };

  var onCanPlay = function () {
    startPlayback();
  };

  var onError = function () {
    detachDirectListeners();
    if (signal.aborted || AppState.currentScreen !== 'player') return;
    hidePlayerLoading();
    alert('Файл не воспроизводится напрямую: кодек/контейнер не поддерживается устройством');
  };

  videoPlayer.addEventListener('loadedmetadata', onLoadedMetadata);
  videoPlayer.addEventListener('canplay', onCanPlay);
  videoPlayer.addEventListener('error', onError);
  // Ссылку держим, чтобы снять слушатели прошлого файла: 'error' живёт всё
  // воспроизведение, и без этого на <video> оседал ещё один на каждую серию
  AppState._directPlaybackDetach = detachDirectListeners;

  AppState._loadingTimeout = setTimeout(function () {
    if (!started && !signal.aborted) startPlayback();
  }, LOADING_TIMEOUT_MS);

  videoPlayer.src = playURL;
  videoPlayer.load();
  AppState.nativeVideoPlayer = videoPlayer;
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
      // Страховочный таймаут ниже больше не нужен: без этого он срабатывал
      // через 3 секунды после начала и повторно жал play — поставленное сразу
      // после старта видео само снималось с паузы
      if (AppState._loadingTimeout) { clearTimeout(AppState._loadingTimeout); AppState._loadingTimeout = null; }
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

/**
 * Хеш торрента и номер файла из ссылки потока.
 *
 * У TorrServer параметр link= принимает и голый хеш, и магнет целиком. Прежняя
 * регулярка ([a-fA-F0-9]+) на магнете не срабатывала вовсе — Android-ветка тогда
 * оставалась и без плейлиста серий, и без таймкода, молча стартуя с нуля.
 */
function parseStreamRef(url) {
  if (!url) return null;
  var direct = url.match(/\/play\/([a-fA-F0-9]{40})\/(\d+)/);
  if (direct) return { hash: direct[1], fileId: direct[2] };

  var linkParam = (url.match(/[?&]link=([^&]+)/) || [])[1];
  var indexParam = (url.match(/[?&]index=(\d+)/) || [])[1];
  if (!linkParam || !indexParam) return null;

  var decoded = decodeURIComponent(linkParam);
  var hash = /^[a-fA-F0-9]{40}$/.test(decoded)
    ? decoded
    : (typeof extractHashFromMagnet === 'function' ? extractHashFromMagnet(decoded) : null);
  return hash ? { hash: hash, fileId: indexParam } : null;
}

async function startHLSPlayback(originalUrl, initialSeek, fromSearch, episodeIndex, audioTrack) {
  if (initialSeek === undefined) initialSeek = null;
  if (fromSearch === undefined) fromSearch = false;
  if (episodeIndex === undefined) episodeIndex = null;
  if (audioTrack === undefined) audioTrack = currentAudioTrack !== undefined ? currentAudioTrack : null;
  if (window.AndroidJS) {
    var androidRef = parseStreamRef(originalUrl);

    // Заголовок считаем ПОСЛЕ loadEpisodesInfo ниже — до него currentEpisodeIndex
    // ещё не знает, какая серия открыта, и в название не попал бы её номер.
    // Плейлист серий нужен ДО открытия нативного плеера: иначе currentEpisodeFiles
    // ещё пуст (обычно он подгружается уже после старта воспроизведения, с задержкой).
    if (AppState.autoSwitchEpisodes && AppState.currentDetailItem && AppState.currentDetailItem.hash) {
      try { await loadEpisodesInfo(AppState.currentDetailItem.hash, androidRef ? androidRef.fileId : null); } catch (e) { /* ignore, fall back to single episode */ }
      // Прогрев кэша прогресса: buildEpisodesPlaylist синхронный, а
      // таймкоды серий нужны ему, чтобы у каждого элемента плейлиста был
      // осмысленный timeline (и позиция, с которой серию продолжат).
      if (typeof getTorrentProgressBatch === 'function') {
        try { await getTorrentProgressBatch(AppState.currentDetailItem.hash, currentEpisodeFiles); } catch (e) { /* без прогресса — нули */ }
      }
    }
    // Возобновление с сохранённой позиции. Ветка AndroidJS выходит из функции ДО
    // preparePlaybackMetadata, а именно там веб-плеер читает таймкод с сервера
    // (loadTimecodeFromServer). Из-за этого нативный плеер всегда стартовал с нуля:
    // прогресс сохранялся, но никто его не запрашивал обратно.
    var androidSeek = initialSeek;
    if (androidSeek === null && androidRef) {
      try {
        var savedSeek = await loadTimecodeFromServer(androidRef.hash, androidRef.fileId);
        if (savedSeek > 0) androidSeek = savedSeek;
      } catch (e) { /* нет таймкода — стартуем с начала */ }
    }

    if (playInExternalPlayer(originalUrl, buildExternalPlayerTitle(), androidSeek, fromSearch)) {
      getEl('config-screen').style.display = 'none'; getEl('torrserver-section').style.display = 'none'; return;
    }
  }
  resetPlaybackState();
  currentPlaybackController = new AbortController(); var signal = currentPlaybackController.signal;
  currentBufferAhead = 0; wasImmediatePause = false; pauseTimer = null; pauseStartTime = null; AppState.playbackRetryCount = 0;
  if (!originalUrl || !originalUrl.trim()) { alert('Ошибка: URL не указан'); return false; }
  lastPlaybackFromSearch = fromSearch;
  //if (!AppState.transcodingFullOnOff) {
  var metadata = await preparePlaybackMetadata(originalUrl, initialSeek, audioTrack, signal);
  if (!metadata || signal.aborted) return false;
  var { fileInfo, savedAudioTrack, fileName, savedSubTrack, savedTimecode, seekTime } = metadata;
  initialSeek = seekTime;
  // } else {
  //   var metadata = await preparePlaybackMetadata(originalUrl, initialSeek, audioTrack, signal);
  //   if (metadata) {
  //     if (initialSeek === null) initialSeek = 0;
  //     var fileName = '';
  //   }
  // }
  if (fileName) updatePlayerTitle(fileName);
  else if (AppState.currentDetailItem && AppState.currentDetailItem.title) updatePlayerTitle(AppState.currentDetailItem.title);
  if (AppState.currentDetailItem && AppState.currentDetailItem.hash) {
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
  if (AppState.seekTimeout) { clearTimeout(AppState.seekTimeout); AppState.seekTimeout = null; }
  if (AppState.hls) { try { AppState.hls.destroy(); AppState.hls = null; } catch (e) { } }
  if (AppState.currentStreamId) { fetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST' })['catch'](function () { }); AppState.currentStreamId = null; }
  hidePlayerLoading();
}

function showDetailView(field = null) {
  if (!window.AndroidJS) {
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
        if (detailView && AppState.youtubeContext) {
          if (typeof Animations !== 'undefined' && typeof Animations.ensureDetailVisible === 'function') Animations.ensureDetailVisible();
          else { detailView.style.display = 'block'; detailView.style.pointerEvents = 'auto'; }
        }
        else if (typeof window.showCatalogList === 'function') window.showCatalogList();
      }
      return;
    }
    saveTimecodeToServer().then(function () { stopTimecodeSaving(); });
    stopHeartbeat();
    if (nearEndCheckInterval) { clearInterval(nearEndCheckInterval); nearEndCheckInterval = null; }
    lastCleanedSegment = -1; currentEpisodeFiles = []; currentEpisodeIndex = 0; currentTorrentHash = null;
    updatePlayerTitle(null); clearTimecodeData();
    if (typeof window.hideSeekOverlay === 'function') window.hideSeekOverlay();
    closePlayerPanels();
    var episodesBtn = getEl('episodes-btn');
    if (episodesBtn) episodesBtn.style.display = 'none';
    var prevBtn = getEl('prev-episode-btn'); var nextBtn = getEl('next-episode-btn');
    if (prevBtn) prevBtn.style.display = 'none'; if (nextBtn) nextBtn.style.display = 'none';
    AppState.currentScreen = 'detail';
    var videoPlayer = getEl('video-player');
    videoPlayer.removeEventListener('ended', handleVideoEnded); videoPlayer.pause(); videoPlayer.removeAttribute('src'); videoPlayer.load();
    destroyHls(); hidePlayerLoading();
    if (AppState.currentStreamId) { fetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST' })['catch'](function () { }); AppState.currentStreamId = null; }
    getEl('player-screen').style.display = 'none';
    getEl('config-screen').style.display = 'none';

    // Пришли из поиска (transcodingFullOnOff) — просто возвращаем оверлей с результатами
    if (AppState.returnToSearchResults) {
      AppState.returnToSearchResults = false;
      lastPlaybackFromSearch = false;
      AppState.playFromHash = false;
      AppState.isCatalogSearch = false;
      AppState.currentScreen = 'search';
      var searchOverlay = getEl('search-overlay');
      if (searchOverlay) searchOverlay.classList.remove('hidden');
      var mainContainer = getEl('main-container');
      if (mainContainer) mainContainer.style.pointerEvents = 'auto';
      setTimeout(function () {
        if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
          updateFocusableElements();
          for (var i = 0; i < focusableElements.length; i++) {
            if (focusableElements[i].classList && focusableElements[i].classList.contains('search-result-item')) { setFocus(i); break; }
          }
        }
      }, 100);
      return; // не открываем detail и не дропаем торрент
    }

    getEl('torrserver-section').style.display = 'block';
  }
  if (AppState.currentDetailItem && AppState.currentDetailItem.hash) {
    dropTorrentToServer(AppState.currentDetailItem.hash).then(function (result) { })['catch'](function (error) { });
  }
  refreshTorrentsList().then(function () {
    if (AppState.currentDetailItem && AppState.currentDetailItem.hash) {
      var cacheKey = AppState.currentDetailItem.hash; if (torrentProgressCache.has(cacheKey)) torrentProgressCache.delete(cacheKey);
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
    var restoreDetail = (typeof Animations !== 'undefined' && typeof Animations.ensureDetailVisible === 'function')
      ? Animations.ensureDetailVisible
      : function () { detailView.style.display = 'block'; };
    if (AppState.currentDetailItem) { restoreDetail(); updateDetailProgress(AppState.currentDetailItem); }
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

  // Принудительное обновление: сбрасываем кэш прогресса.
  // Именно torrentProgressCache — тот, из которого читает loadProgressForTorrent.
  // Раньше тут чистился давно осиротевший progressCache, и кнопка «Продолжить»
  // после выхода из плеера могла показывать позицию до минуты назад.
  var cacheKey = torrent.hash;
  if (torrentProgressCache.has(cacheKey)) torrentProgressCache.delete(cacheKey);

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

  var progress = await loadProgressForTorrent(torrent, getTorrentFiles(torrent));
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
  if (AppState.transcodingFullOnOff && (!currentAudioTracks || currentAudioTracks.length === 0)) {
    audioList.innerHTML = '<div class="search-result-empty">Нет аудиодорожек</div>'; return;
  }
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
  // var audioItems = audioList.querySelectorAll('.audio-item');
  // for (var i = 0; i < audioItems.length; i++) {
  //   (function (item) { item.addEventListener('click', function () { switchAudioTrack(parseInt(item.dataset.trackIndex)); }); })(audioItems[i]);
  // }
  // Клики обрабатываются делегированием
  setupAudioListDelegation();
}

function collectNativeAudioTracks(videoPlayer) {
  var list = videoPlayer.audioTracks;
  if (!list || list.length === 0) return [];
  var tracks = [];
  for (var i = 0; i < list.length; i++) {
    tracks.push({
      title: list[i].label || ('Дорожка ' + (i + 1)),
      language: list[i].language || 'und',
      channels: null,   // audioTracks не отдаёт ни каналы, ни кодек
      codec: null
    });
  }
  return tracks;
}

async function switchAudioTrack(trackIndex) {
  if (trackIndex === currentAudioTrack) { toggleAudioPanel(); return; }
  if (AppState.transcodingFullOnOff) {
    // nativeVideoPlayer обнуляет destroyHls(), а элемент <video> никуда не
    // девается — берём его напрямую, иначе тут падало на null.audioTracks
    switchNativeAudioTrack(AppState.nativeVideoPlayer || getEl('video-player'), trackIndex);
    return;
  }
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

function switchNativeAudioTrack(videoPlayer, index) {
  if (!videoPlayer) return;
  if (AppState.transcodingFullOnOff && videoPlayer.audioTracks && videoPlayer.audioTracks.length > 0) {
    for (var i = 0; i < videoPlayer.audioTracks.length; i++) {
      videoPlayer.audioTracks[i].enabled = (i === index);
    }
    currentAudioTrack = index;
    if (currentTimecodeData.hash && currentTimecodeData.fileId) {
      saveAudioPreference(currentTimecodeData.hash, currentTimecodeData.fileId, index);
    }
    renderAudioTracks();
    toggleAudioPanel();
    return;
  }
}

function toggleAudioPanel() { return togglePlayerPanel('audio'); }

function setupAudioButton() {
  var audioBtn = getEl('audio-btn');
  var closeAudioBtn = getEl('close-audio');
  var audioPanel = getEl('audio-panel');

  if (!audioBtn || !closeAudioBtn || !audioPanel) return;

  // Делегирование кликов по списку аудиодорожек
  setupAudioListDelegation();

  audioBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    toggleAudioPanel();
    resetMouseIdleTimer();
  });

  closeAudioBtn.addEventListener('click', function () {
    setPlayerPanel('audio', false);
    resetMouseIdleTimer();
  });

  setupPlayerPanelsOutsideClick();
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
  // var subtitleItems = subtitlesList.querySelectorAll('.subtitle-item');
  // for (var i = 0; i < subtitleItems.length; i++) {
  //   (function (item) { item.addEventListener('click', function () { switchSubtitleTrack(parseInt(item.dataset.trackIndex)); }); })(subtitleItems[i]);
  // }
  // Клики обрабатываются делегированием
  setupSubtitlesListDelegation();
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

function toggleSubtitlesPanel() { return togglePlayerPanel('subtitles'); }

function setupSubtitlesButton() {
  var subtitlesBtn = getEl('subtitles-btn');
  var closeSubtitlesBtn = getEl('close-subtitles');
  var subtitlesPanel = getEl('subtitles-panel');

  if (!subtitlesBtn || !closeSubtitlesBtn || !subtitlesPanel) return;

  // Делегирование кликов по списку субтитров
  setupSubtitlesListDelegation();

  subtitlesBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    toggleSubtitlesPanel();
    resetMouseIdleTimer();
  });

  closeSubtitlesBtn.addEventListener('click', function () {
    setPlayerPanel('subtitles', false);
    resetMouseIdleTimer();
  });

  setupPlayerPanelsOutsideClick();
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

/**
 * Раньше здесь крутился секундный интервал с пустым телом if — просыпался
 * каждую секунду всё время просмотра и ничего не делал. Конец файла ловит
 * событие 'ended' (handleVideoEnded), отдельная проверка не нужна.
 *
 * Функцию и nearEndCheckInterval оставляем: их гасят из полудюжины мест
 * (выход из плеера, смена серии, ошибки), и все эти вызовы должны остаться
 * рабочими, если проверка когда-нибудь вернётся.
 */
function startNearEndCheck() {
  if (nearEndCheckInterval) { clearInterval(nearEndCheckInterval); nearEndCheckInterval = null; }
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
      var urlData = data.currentUrl ? parseHashFromUrl(data.currentUrl) : null;
      if (urlData) { data.hash = urlData.hash; data.torrentHash = urlData.torrentHash; data.fileId = urlData.fileId; }
      // Плеер может вернуть таймлайн без hash и без currentUrl. Тогда опираемся
      // на то, чем его открывали (openAndroidPlayer). При автопереключении серий
      // это уже не та серия, но потерять таймкод целиком хуже.
      else if (currentTimecodeData && currentTimecodeData.hash && currentTimecodeData.fileId) {
        data.hash = currentTimecodeData.hash + '_' + currentTimecodeData.fileId;
      }
      else return;
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
