/* Сборка для старых браузеров (Chrome 53) из js/player.js — tools/legacy-build/build.js. Руками не править. */
function asyncGeneratorStep(n, t, e, r, o, a, c) { try { var i = n[a](c), u = i.value; } catch (n) { return void e(n); } i.done ? t(u) : Promise.resolve(u).then(r, o); }
function _asyncToGenerator(n) { return function () { var t = this, e = arguments; return new Promise(function (r, o) { var a = n.apply(t, e); function _next(n) { asyncGeneratorStep(a, r, o, _next, _throw, "next", n); } function _throw(n) { asyncGeneratorStep(a, r, o, _next, _throw, "throw", n); } _next(void 0); }); }; }
var currentEpisodeFiles = [];
var currentEpisodeIndex = 0;
var currentTorrentHash = null;
var lastCleanedSegment = -1;
var nearEndCheckInterval = null;
var thisisseek = false;
var BUFFER_TARGET_SEC = 10;
var LOADING_TIMEOUT_MS = 15000;
var EPISODES_LOAD_DELAY_MS = 1000;
var EPISODES_LOAD_DELAY_SEARCH_MS = 1600;
var ANDROID_EPISODE_META_WAIT_MS = 2500;
var MAX_PLAYBACK_RETRIES = 3;
var PLAYER_FETCH_TIMEOUT_MS = 15000;
var FILE_INFO_FETCH_TIMEOUT_MS = 60000;
var DIRECT_PREPARE_TIMEOUT_MS = 4000;
var MAX_HLS_NETWORK_RETRIES = 5;
var timecodeSaveInterval = null;
var currentTimecodeData = {
  hash: null,
  fileId: null,
  timecode: 0,
  duration: 0
};
var mouseIdleTimer = null;
var IDLE_TIMEOUT = 4000;
var currentAudioTracks = [];
var currentSubTracks = [];
var currentAudioTrack = 0;
var currentSubtitleTrack = -1;
var currentFileInfo = null;
var heartbeatInterval = null;
var currentBufferAhead = 0;
var wasImmediatePause = false;
var pauseTimer = null;
var pauseStartTime = null;
var PAUSE_THRESHOLD = 60000;
var currentPlaybackController = null;
var skipData = [];
var skipDataKey = '';
var skipButton = null;
var skipButtonTimeout = null;
var currentSkipData = null;
var skipButtonActive = false;
var currentSkipInfo = null;
var currentSkipRangeKey = null;
var skipIntro = 0;
var skipCredits = 0;
function fetchWithTimeout(url, options, timeoutMs) {
  options = options || {};
  var controller = new AbortController();
  var timer = setTimeout(function () {
    controller.abort();
  }, timeoutMs || PLAYER_FETCH_TIMEOUT_MS);
  var outer = options.signal;
  var onOuterAbort = function () {
    controller.abort();
  };
  if (outer) {
    if (outer.aborted) controller.abort();else outer.addEventListener('abort', onOuterAbort);
  }
  var opts = Object.assign({}, options, {
    signal: controller.signal
  });
  return (typeof bgFetch === 'function' ? bgFetch(url, opts) : fetch(url, opts)).finally(function () {
    clearTimeout(timer);
    if (outer) outer.removeEventListener('abort', onOuterAbort);
  });
}
window.fetchWithTimeout = fetchWithTimeout;
function showPlaybackUnavailableBanner(detail) {
  var text = 'TorrServer недоступен или TorrStream не смог получить информацию от TorrServer. ' + 'Попробуйте перезапустить данный контент или выбрать другую раздачу.';
  if (typeof window.showErrorBanner === 'function') {
    window.showErrorBanner('Не удалось начать воспроизведение', text);
  } else {
    alert(text + (detail ? '\n\n' + detail : ''));
  }
  if (detail) console.warn('▶️ Воспроизведение не поднялось:', detail);
}
window.showPlaybackUnavailableBanner = showPlaybackUnavailableBanner;
function showSwitchFailedBanner(what, detail) {
  if (typeof window.showErrorBanner === 'function') {
    window.showErrorBanner('Не удалось переключить ' + what, 'TorrServer недоступен или TorrStream не смог получить информацию от TorrServer. ' + 'Попробуйте перезапустить данный контент или выбрать другую раздачу.');
  } else alert('Ошибка при переключении: ' + what);
  if (detail) console.warn('🔀 Переключение (' + what + ') не удалось:', detail);
}
window.showSwitchFailedBanner = showSwitchFailedBanner;
var FS_OVERLAY_IDS = ['playback-overlay', 'loading-overlay', 'skip-button'];
var fsOverlayHome = {};
function getFullscreenEl() {
  return document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement || null;
}
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
    var target = host === document.body ? fsOverlayHome[id] : host;
    if (el.parentNode !== target) target.appendChild(el);
  }
}
window.syncFullscreenOverlays = syncFullscreenOverlays;
document.addEventListener('fullscreenchange', syncFullscreenOverlays);
document.addEventListener('webkitfullscreenchange', syncFullscreenOverlays);
document.addEventListener('mozfullscreenchange', syncFullscreenOverlays);
document.addEventListener('MSFullscreenChange', syncFullscreenOverlays);
function createSkipButton() {
  if (skipButton) {
    skipButton.remove();
    skipButton = null;
  }
  skipButton = document.createElement('div');
  skipButton.id = 'skip-button';
  skipButton.className = 'skip-button hidden';
  skipButton.innerHTML = '⏩ Пропустить';
  skipButton.setAttribute('role', 'button');
  skipButton.setAttribute('tabindex', '0');
  skipButton.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (typeof window.executeSkip === 'function') window.executeSkip();
  });
  skipButton.addEventListener('touchend', function (e) {
    if (e.cancelable) e.preventDefault();
    if (typeof window.executeSkip === 'function') window.executeSkip();
  }, {
    passive: false
  });
  document.body.appendChild(skipButton);
  syncFullscreenOverlays();
  return skipButton;
}
var AUTO_SKIP_INTRO_SEC = 5;
var autoSkipTimer = null;
var autoSkipLeft = 0;
function hasNextEpisode() {
  return currentEpisodeFiles.length > 0 && currentEpisodeIndex !== undefined && currentEpisodeIndex + 1 < currentEpisodeFiles.length;
}
function shouldAutoSkip(type) {
  if (!AppState.autoSkipIntro) return false;
  return type === 'intro' || type === 'credits' && hasNextEpisode();
}
function skipButtonText(type) {
  return type === 'intro' ? '⏩ Пропустить вступление' : '⏩ Пропустить титры';
}
function autoSkipLabel() {
  if (currentSkipInfo && currentSkipInfo.type === 'credits') {
    return '⏭ Следующая серия через ' + autoSkipLeft + ' · ОК — смотреть титры';
  }
  return '⏩ Пропуск заставки через ' + autoSkipLeft + ' · ОК — смотреть';
}
function startAutoSkipCountdown() {
  stopAutoSkipCountdown();
  autoSkipLeft = AUTO_SKIP_INTRO_SEC;
  if (skipButton) skipButton.innerHTML = autoSkipLabel();
  autoSkipTimer = setInterval(function () {
    if (!skipButtonActive || !currentSkipInfo) {
      stopAutoSkipCountdown();
      return;
    }
    var videoPlayer = getEl('video-player');
    if (videoPlayer && videoPlayer.paused) return;
    autoSkipLeft--;
    if (autoSkipLeft <= 0) {
      stopAutoSkipCountdown();
      console.log('⏩ Автопропуск:', currentSkipInfo.type === 'intro' ? 'заставка' : 'титры');
      performSkip();
      return;
    }
    if (skipButton) skipButton.innerHTML = autoSkipLabel();
  }, 1000);
}
function stopAutoSkipCountdown() {
  if (autoSkipTimer) {
    clearInterval(autoSkipTimer);
    autoSkipTimer = null;
  }
}
function syncAutoSkipCountdown() {
  if (!skipButtonActive || !currentSkipInfo) return;
  var want = shouldAutoSkip(currentSkipInfo.type);
  if (want && !autoSkipTimer) {
    if (skipButtonTimeout) {
      clearTimeout(skipButtonTimeout);
      skipButtonTimeout = null;
    }
    startAutoSkipCountdown();
  } else if (!want && autoSkipTimer) {
    stopAutoSkipCountdown();
    if (skipButton) skipButton.innerHTML = skipButtonText(currentSkipInfo.type);
    skipButtonTimeout = setTimeout(function () {
      hideSkipButton();
    }, 10000);
  }
}
window.syncAutoSkipCountdown = syncAutoSkipCountdown;
window.executeSkip = function () {
  if (!skipButtonActive || !currentSkipInfo) return false;
  if (autoSkipTimer) {
    console.log('⏩ Автопропуск отменён:', currentSkipInfo.type === 'intro' ? 'заставка' : 'титры');
    hideSkipButton();
    return true;
  }
  return performSkip();
};
function performSkip() {
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
}
function showSkipButton(type, startMs, endMs) {
  if (!skipButton) createSkipButton();
  syncFullscreenOverlays();
  var rangeKey = type + '' + startMs + '' + endMs;
  if (skipButtonActive && currentSkipRangeKey === rangeKey) return;
  if (skipButtonActive) hideSkipButton();
  if (skipButtonTimeout) {
    clearTimeout(skipButtonTimeout);
    skipButtonTimeout = null;
  }
  skipButton.classList.remove('filled');
  skipButton.innerHTML = skipButtonText(type);
  skipButton.classList.remove('hidden');
  skipButton.classList.add('visible');
  skipButton.style.display = 'flex';
  currentSkipInfo = {
    type: type,
    startMs: startMs,
    endMs: endMs
  };
  currentSkipRangeKey = rangeKey;
  skipButtonActive = true;
  if (typeof window.focusEl === 'function') window.focusEl(skipButton);
  if (shouldAutoSkip(type)) {
    startAutoSkipCountdown();
  } else {
    skipButtonTimeout = setTimeout(function () {
      hideSkipButton();
    }, 10000);
  }
  setTimeout(function () {
    if (skipButton && skipButtonActive) skipButton.classList.add('filled');
  }, 50);
  console.log('🎬 Показана кнопка пропуска:', type, 'старт:', (startMs / 1000).toFixed(1), 'сек, конец:', (endMs / 1000).toFixed(1), 'сек');
}
function hideSkipButton() {
  stopAutoSkipCountdown();
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
    setTimeout(function () {
      window.updateFocusableElements();
    }, 50);
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
  var newRangeKey = null,
    newType = null,
    newStartMs = null,
    newEndMs = null;
  if (skipData.intro && Array.isArray(skipData.intro) && skipData.intro.length > 0) {
    for (var i = 0; i < skipData.intro.length; i++) {
      var intro = skipData.intro[i];
      var introStartMs = intro.start_ms !== null && intro.start_ms !== undefined ? intro.start_ms : 0;
      var introEndMs = intro.end_ms !== null && intro.end_ms !== undefined ? intro.end_ms : 0;
      if (currentTimeMs >= introStartMs && currentTimeMs <= introEndMs) {
        inAnyRange = true;
        newRangeKey = 'intro_' + introStartMs + '_' + introEndMs;
        newType = 'intro';
        newStartMs = introStartMs;
        newEndMs = introEndMs;
        skipIntro = skipIntro + 1;
        break;
      }
    }
  }
  if (!inAnyRange && skipData.credits && Array.isArray(skipData.credits) && skipData.credits.length > 0) {
    for (var j = 0; j < skipData.credits.length; j++) {
      var credits = skipData.credits[j];
      var creditsStartMs = credits.start_ms !== null && credits.start_ms !== undefined ? credits.start_ms : 0;
      var creditsEndMs = credits.end_ms !== null && credits.end_ms !== undefined ? credits.end_ms : totalDurationMs;
      if (currentTimeMs >= creditsStartMs && currentTimeMs <= creditsEndMs) {
        inAnyRange = true;
        newRangeKey = 'credits_' + creditsStartMs + '_' + creditsEndMs;
        newType = 'credits';
        newStartMs = creditsStartMs;
        newEndMs = credits.end_ms;
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
      bgFetch(SERVER_URL + '/hls/activity/' + AppState.currentStreamId, {
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
document.addEventListener('DOMContentLoaded', function () {
  var episodesBtn = getEl('episodes-btn');
  if (episodesBtn) episodesBtn.style.display = 'none';
  var prevBtn = getEl('prev-episode-btn');
  var nextBtn = getEl('next-episode-btn');
  if (prevBtn) prevBtn.style.display = 'none';
  if (nextBtn) nextBtn.style.display = 'none';
});
function setControlDisabled(btn, disabled) {
  if (!btn) return;
  if (disabled) btn.classList.add('is-disabled');else btn.classList.remove('is-disabled');
}
function updateEpisodeButtons() {
  var prevBtn = getEl('prev-episode-btn');
  var nextBtn = getEl('next-episode-btn');
  if (!prevBtn || !nextBtn) return;
  var filesLen = currentEpisodeFiles.length;
  if (filesLen > 0) {
    prevBtn.style.display = 'flex';
    nextBtn.style.display = 'flex';
    setControlDisabled(prevBtn, currentEpisodeIndex === 0);
    setControlDisabled(nextBtn, currentEpisodeIndex === filesLen - 1);
  } else {
    prevBtn.style.display = 'none';
    nextBtn.style.display = 'none';
  }
}
var soundGestureArmed = false;
function restoreSoundOnGesture() {
  var video = getEl('video-player');
  if (!video || !video.muted || soundGestureArmed) return;
  soundGestureArmed = true;
  var unmute = function () {
    document.removeEventListener('keydown', unmute, true);
    document.removeEventListener('click', unmute, true);
    soundGestureArmed = false;
    if (AppState.currentScreen === 'player') video.muted = false;
  };
  document.addEventListener('keydown', unmute, true);
  document.addEventListener('click', unmute, true);
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
function getFileNameByHash(_x, _x2) {
  return _getFileNameByHash.apply(this, arguments);
}
function _getFileNameByHash() {
  _getFileNameByHash = _asyncToGenerator(function* (hash, fileId) {
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
    if (torrent.file_stats && Array.isArray(torrent.file_stats)) files = torrent.file_stats;else if (torrent.data) {
      try {
        var data = JSON.parse(torrent.data);
        if (data.TorrServer && data.TorrServer.Files) files = data.TorrServer.Files;
      } catch (e) {}
    }
    for (var j = 0; j < files.length; j++) {
      if (files[j].id == fileId) return files[j].path.split('/').pop() || 'Файл ' + fileId;
    }
    return null;
  });
  return _getFileNameByHash.apply(this, arguments);
}
var idleControlEls = null;
function getIdleControlEls() {
  if (idleControlEls) return idleControlEls;
  var ids = ['controls-container', 'buffer-stats', 'player-hint', 'exit-player-btn', 'player-title'];
  var list = [];
  for (var i = 0; i < ids.length; i++) {
    var el = getEl(ids[i]);
    if (el) list.push(el);
  }
  if (list.length) idleControlEls = list;
  return list;
}
function setPlayerControlsIdle(hidden) {
  var els = getIdleControlEls();
  for (var i = 0; i < els.length; i++) {
    if (hidden) els[i].classList.add('idle-hidden');else els[i].classList.remove('idle-hidden');
  }
  syncPlayerTitleVisibility(!hidden);
  setPlayerCursorHidden(hidden);
}
window.setPlayerControlsIdle = setPlayerControlsIdle;
function setPlayerCursorHidden(hidden) {
  var ps = getEl('player-screen');
  if (ps) ps.classList.toggle('player-cursor-hidden', !!hidden);
}
window.setPlayerCursorHidden = setPlayerCursorHidden;
var playerMouseMuteUntil = 0;
function mutePlayerMouse(ms) {
  playerMouseMuteUntil = Date.now() + ms;
}
function isPlayerMouseMuted() {
  return Date.now() < playerMouseMuteUntil;
}
function onPlayerMouseMove() {
  if (!isPlayerMouseMuted()) resetMouseIdleTimer();
}
function resetMouseIdleTimer() {
  var playerScreen = getEl('player-screen');
  if (!playerScreen || playerScreen.style.display !== 'block') return;
  var playerOverlay = getEl('player-overlay');
  if (playerOverlay) playerOverlay.classList.add('touch-active');
  var controls = getEl('controls-container');
  if (!controls || controls.classList.contains('idle-hidden')) setPlayerControlsIdle(false);
  if (mouseIdleTimer) clearTimeout(mouseIdleTimer);
  mouseIdleTimer = null;
  if (AppState.playerManualHide) return;
  mouseIdleTimer = setTimeout(function () {
    if (playerScreen.style.display !== 'block') return;
    if (isPlayerPanelOpen('onlinesubs')) {
      mouseIdleTimer = null;
      return;
    }
    if (playerOverlay) playerOverlay.classList.remove('touch-active');
    closePlayerPanelsOnIdle();
    setPlayerControlsIdle(true);
  }, IDLE_TIMEOUT);
}
function closePlayerPanelsOnIdle() {
  var panel = getOpenPlayerPanel();
  if (!panel) return;
  var focused = panel.querySelectorAll('.focused');
  for (var i = 0; i < focused.length; i++) focused[i].classList.remove('focused');
  closePlayerPanels();
  if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
}
function setupPlayerPanelsActivity() {
  if (setupPlayerPanelsActivity._bound) return;
  setupPlayerPanelsActivity._bound = true;
  var seen = {};
  for (var name in PLAYER_PANELS) {
    var id = PLAYER_PANELS[name].panel;
    var panel = getEl(id);
    if (!panel || seen[id]) continue;
    seen[id] = true;
    panel.addEventListener('touchstart', resetMouseIdleTimer, {
      passive: true
    });
    panel.addEventListener('touchmove', resetMouseIdleTimer, {
      passive: true
    });
    panel.addEventListener('wheel', resetMouseIdleTimer, {
      passive: true
    });
    panel.addEventListener('scroll', resetMouseIdleTimer, true);
  }
}
function nextEpisode() {
  currentBufferAhead = 0;
  wasImmediatePause = false;
  pauseTimer = null;
  pauseStartTime = null;
  if (currentEpisodeFiles.length === 0 || currentEpisodeIndex === undefined) return;
  var nextIndex = currentEpisodeIndex + 1;
  if (nextIndex < currentEpisodeFiles.length) switchToEpisode(nextIndex, currentEpisodeFiles[nextIndex].id);
}
function prevEpisode() {
  currentBufferAhead = 0;
  wasImmediatePause = false;
  pauseTimer = null;
  pauseStartTime = null;
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
  btn.classList.toggle('is-paused', !!videoPlayer.paused);
  btn.title = videoPlayer.paused ? 'Воспроизвести' : 'Пауза';
}
var NEXT_EPISODE_WARMUP_SEC = 180;
var warmedNextEpisodeKey = null;
function maybeWarmNextEpisode(absoluteTime) {
  if (!currentTorrentHash || !currentEpisodeFiles || !currentEpisodeFiles.length) return;
  var next = currentEpisodeFiles[currentEpisodeIndex + 1];
  if (!next || !next.id) return;
  var videoPlayer = getEl('video-player');
  var total = AppState.originalDuration || AppState.expectedDuration || videoPlayer && videoPlayer.duration;
  if (!total || !isFinite(total) || total < 2 * NEXT_EPISODE_WARMUP_SEC) return;
  if (total - absoluteTime > NEXT_EPISODE_WARMUP_SEC) return;
  var key = currentTorrentHash + ':' + next.id;
  if (warmedNextEpisodeKey === key) return;
  warmedNextEpisodeKey = key;
  console.log('🔥 Прогрев следующей серии: ' + (currentEpisodeIndex + 2));
  preloadTorrents(currentTorrentHash, next.id);
  if (!AppState.transcodingOnOff && !AppState.transcodingFullOnOff) {
    var savedClientId = localStorage.getItem('clientId');
    fetchWithTimeout(SERVER_URL + '/api/file/info?hash=' + currentTorrentHash + '&fileId=' + next.id + '&clientId=' + encodeURIComponent(savedClientId), null, FILE_INFO_FETCH_TIMEOUT_MS)['catch'](function () {});
  }
}
function hudStat(label, value, valueClass) {
  return '<span class="hud-stat"><span class="hud-stat-label">' + label + '</span>' + '<span class="hud-stat-value' + (valueClass ? ' ' + valueClass : '') + '">' + value + '</span></span>';
}
function setHudHtml(el, html) {
  if (el && el._hudHtml !== html) {
    el.innerHTML = html;
    el._hudHtml = html;
  }
}
function bufferLevelClass(seconds) {
  if (seconds < 10) return 'hud-low';
  if (seconds < 20) return 'hud-mid';
  return 'hud-ok';
}
function updateBufferDisplay() {
  var bufferStats = getEl('buffer-stats');
  var subtitleElement = getEl('player-subtitle');
  var videoPlayer = getEl('video-player');
  if (!bufferStats || !videoPlayer) return;
  checkAndShowSkipButton(videoPlayer.currentTime + AppState.seekOffset);
  maybeWarmNextEpisode(videoPlayer.currentTime + AppState.seekOffset);
  if (AppState.bufferHidden) {
    bufferStats.classList.add('hidden');
    if (subtitleElement) subtitleElement.classList.add('hidden');
    return;
  }
  bufferStats.classList.remove('hidden');
  if (subtitleElement) subtitleElement.classList.remove('hidden');
  var torrServerHtml = '';
  if (currentTimecodeData.hash && typeof torrentStatsCache !== 'undefined' && torrentStatsCache.preloadSize > 0) {
    torrServerHtml = hudStat('TorrServer', formatSize(torrentStatsCache.preloaded)) + hudStat('Скорость', formatSpeed(torrentStatsCache.downloadSpeed));
    if (torrentStatsCache.activePeers > 0) {
      torrServerHtml += hudStat('Пиры', torrentStatsCache.activePeers + ' / ' + torrentStatsCache.totalPeers) + hudStat('Сиды', torrentStatsCache.connectedSeeders);
    }
  }
  setHudHtml(subtitleElement, torrServerHtml);
  var absoluteCurrentTime = videoPlayer.currentTime + AppState.seekOffset;
  var bufferHtml;
  if (videoPlayer.buffered && videoPlayer.buffered.length > 0) {
    var absoluteBuffered = videoPlayer.buffered.end(videoPlayer.buffered.length - 1) + AppState.seekOffset;
    var bufferAhead = absoluteBuffered - absoluteCurrentTime;
    if (bufferAhead < 0) bufferAhead = 0;
    currentBufferAhead = bufferAhead;
    var bufferAheadText = bufferAhead < 60 ? Math.floor(bufferAhead) + ' сек' : bufferAhead < 3600 ? Math.floor(bufferAhead / 60) + ' мин' : Math.floor(bufferAhead / 3600) + ' ч';
    bufferHtml = hudStat('Буфер', bufferAheadText, bufferLevelClass(bufferAhead));
  } else if (window.TizenAVPlay && TizenAVPlay.active()) {
    bufferHtml = '';
  } else {
    bufferHtml = hudStat('Буфер', '0 сек', 'hud-low');
  }
  var totalDuration = AppState.originalDuration || AppState.expectedDuration || videoPlayer.duration;
  if (totalDuration && totalDuration > 0 && isFinite(totalDuration)) {
    var remainingTime = totalDuration - absoluteCurrentTime;
    if (remainingTime < 0) remainingTime = 0;
    var remainingHours = Math.floor(remainingTime / 3600);
    var remainingMinutes = Math.floor(remainingTime % 3600 / 60);
    var remainingSeconds = Math.floor(remainingTime % 60);
    var remainingText = (remainingHours > 0 ? remainingHours + ' ч ' + (remainingMinutes > 0 ? remainingMinutes + ' мин' : '') : remainingMinutes > 0 ? remainingMinutes + ' мин ' + (remainingSeconds > 0 ? remainingSeconds + ' сек' : '') : remainingSeconds + ' сек').trim();
    var endTime = new Date(Date.now() + remainingTime * 1000);
    var endTimeText = endTime.getHours().toString().padStart(2, '0') + ':' + endTime.getMinutes().toString().padStart(2, '0');
    bufferHtml += hudStat('До конца', remainingText) + hudStat('Конец в', endTimeText);
  }
  setHudHtml(bufferStats, bufferHtml);
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
  if (window.TizenAVPlay) TizenAVPlay.detach();
  ServerSubs.stop();
  AppState.serverTracks = null;
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
  if (AppState.seekTimeout) {
    clearTimeout(AppState.seekTimeout);
    AppState.seekTimeout = null;
  }
  if (AppState._seekExecuted) AppState._seekExecuted = false;
  if (AppState._directPlaybackDetach) {
    AppState._directPlaybackDetach();
    AppState._directPlaybackDetach = null;
  }
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
function restartServerGeneration(what) {
  var v = getEl('video-player');
  if (!v || !AppState.currentStreamId) return false;
  var origin = AppState.streamTimeOrigin;
  var at = v.currentTime + (origin !== null && origin !== undefined ? origin : AppState.seekOffset || 0);
  AppState._forceServerSeek = true;
  AppState._forceServerSeekWhat = what || 'дорожки';
  seekStream(at, 'user');
  return true;
}
function applyServerTracks(tracks) {
  AppState.serverTracks = tracks || null;
  AppState.serverAvailableFrom = 0;
  AppState.streamTimeOrigin = null;
  ServerSubs.stop();
}
function applyServerTrackSelection() {
  if (!AppState.serverTracks) return;
  selectHlsAudio(currentAudioTrack);
  if (currentSubtitleTrack >= 0 && ServerSubs.index !== currentSubtitleTrack) ServerSubs.select(currentSubtitleTrack);
}
function serverAudioPos(trackIndex) {
  var t = AppState.serverTracks;
  return t && t.audio ? t.audio.indexOf(trackIndex) : -1;
}
function isTextSubtitle(trackIndex) {
  var t = currentSubTracks && currentSubTracks[trackIndex];
  var codec = String(t && (t.codec || t.format) || '').toLowerCase();
  return /^(subrip|srt|ass|ssa|mov_text|webvtt|text)$/.test(codec);
}
function serverSubEntry(trackIndex) {
  var t = AppState.serverTracks;
  if (!t || !t.subs) return null;
  for (var i = 0; i < t.subs.length; i++) if (t.subs[i].index === trackIndex) return t.subs[i];
  return null;
}
function selectHlsAudio(trackIndex) {
  var pos = serverAudioPos(trackIndex);
  if (pos < 0 || !AppState.hls) return false;
  if (AppState.hls.audioTrack !== pos) AppState.hls.audioTrack = pos;
  return true;
}
function isPositionInServerRange(targetTime) {
  if (!AppState.serverTracks || !AppState.hls || !AppState.hls.levels) return false;
  var lvl = AppState.hls.levels[AppState.hls.currentLevel >= 0 ? AppState.hls.currentLevel : 0];
  var details = lvl && lvl.details;
  if (!details || !details.totalduration) return false;
  var rel = targetTime - (AppState.seekOffset || 0);
  return rel >= (AppState.serverAvailableFrom || 0) + 1 && rel <= details.totalduration - 1;
}
var ServerSubs = {
  track: null,
  trackVideo: null,
  url: null,
  index: -1,
  timer: null,
  gen: 0,
  keys: {},
  polls: 0,
  POLL_MS: 4000,
  POLL_FAST_MS: 1000,
  POLL_FAST_COUNT: 6,
  ensureTrack: function () {
    var v = getEl('video-player');
    if (!v || typeof v.addTextTrack !== 'function') return null;
    if (!this.track || this.trackVideo !== v) {
      this.track = v.addTextTrack('subtitles', 'TorrStream', '');
      this.trackVideo = v;
      if (typeof watchCuesRaise === 'function') watchCuesRaise(v);
    }
    return this.track;
  },
  clear: function () {
    var t = this.track;
    try {
      if (t && t.cues) while (t.cues.length) t.removeCue(t.cues[0]);
    } catch (e) {}
    this.keys = {};
  },
  stop: function () {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.gen++;
    this.clear();
    if (this.track) this.track.mode = 'disabled';
    this.index = -1;
    this.url = null;
  },
  select: function (subIndex) {
    this.stop();
    var entry = subIndex >= 0 ? serverSubEntry(subIndex) : null;
    if (!entry) return false;
    var t = this.ensureTrack();
    if (!t) return false;
    var v = this.trackVideo;
    for (var i = 0; i < v.textTracks.length; i++) if (v.textTracks[i] !== t) v.textTracks[i].mode = 'disabled';
    t.mode = 'showing';
    this.index = subIndex;
    this.url = entry.url;
    this.polls = 0;
    this.poll(this.gen);
    return true;
  },
  poll: function (gen) {
    var self = this;
    bgFetch(SERVER_URL + self.url, {
      cache: 'no-store'
    }).then(function (r) {
      return r.ok ? r.text() : '';
    }).then(function (text) {
      if (gen === self.gen && text) self.addCues(text);
    })['catch'](function () {}).then(function () {
      if (gen !== self.gen) return;
      self.polls++;
      self.timer = setTimeout(function () {
        self.poll(gen);
      }, self.polls < self.POLL_FAST_COUNT ? self.POLL_FAST_MS : self.POLL_MS);
    });
  },
  parseTime: function (t) {
    var p = t.split(':');
    var sec = parseFloat(p[p.length - 1]) || 0;
    if (p.length > 1) sec += (parseInt(p[p.length - 2], 10) || 0) * 60;
    if (p.length > 2) sec += (parseInt(p[p.length - 3], 10) || 0) * 3600;
    return sec;
  },
  addCues: function (text) {
    var t = this.track;
    if (!t || typeof VTTCue !== 'function') return;
    var origin = AppState.streamTimeOrigin;
    if (origin === null || origin === undefined) return;
    var blocks = text.replace(/\r/g, '').split(/\n\n+/);
    blocks.pop();
    for (var i = 0; i < blocks.length; i++) {
      var lines = blocks[i].split('\n');
      for (var j = 0; j < lines.length; j++) {
        var m = lines[j].match(/^\s*([\d:.]+)\s+-->\s+([\d:.]+)/);
        if (!m) continue;
        var body = lines.slice(j + 1).join('\n');
        var key = m[1] + '|' + m[2] + '|' + body;
        if (!body || this.keys[key]) break;
        this.keys[key] = 1;
        try {
          t.addCue(new VTTCue(this.parseTime(m[1]) - origin, this.parseTime(m[2]) - origin, body));
        } catch (e) {}
        break;
      }
    }
  }
};
function checkPlaylistExists(_x3, _x4) {
  return _checkPlaylistExists.apply(this, arguments);
}
function _checkPlaylistExists() {
  _checkPlaylistExists = _asyncToGenerator(function* (playlistUrl, maxAttempts) {
    if (maxAttempts === undefined) maxAttempts = 40;
    for (var i = 0; i < maxAttempts; i++) {
      try {
        var response = yield bgFetch(playlistUrl, {
          method: 'HEAD'
        });
        if (response.ok) return true;
      } catch (e) {}
      if (i % 4 === 0) showPlayerLoading('Ожидание плейлиста... ' + ((i + 1) * 0.5).toFixed(0) + 'с', AppState.previewTime);
      yield new Promise(function (r) {
        setTimeout(r, 500);
      });
    }
    return false;
  });
  return _checkPlaylistExists.apply(this, arguments);
}
function reloadHlsPlaylist(playlistUrl) {
  return new Promise(function (resolve, reject) {
    if (!AppState.hls || !Hls.isSupported()) {
      reject(new Error('HLS не инициализирован'));
      return;
    }
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
function saveTimecodeToServer() {
  return _saveTimecodeToServer.apply(this, arguments);
}
function _saveTimecodeToServer() {
  _saveTimecodeToServer = _asyncToGenerator(function* () {
    if (!currentTimecodeData.hash || !currentTimecodeData.fileId) return;
    if (currentTimecodeData.timecode < 5) return;
    if (currentTimecodeData.duration > 0 && currentTimecodeData.timecode > currentTimecodeData.duration - 10) return;
    try {
      var savedClientId = localStorage.getItem('clientId');
      var response = yield bgFetch(SERVER_URL + '/api/timecode/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          clientId: savedClientId,
          hash: currentTimecodeData.hash,
          fileId: currentTimecodeData.fileId,
          timecode: currentTimecodeData.timecode,
          duration: currentTimecodeData.duration,
          mediaKey: currentTimecodeMediaKey()
        })
      });
      if (response.ok) console.log('💾 Таймкод сохранен: ' + formatTime(currentTimecodeData.timecode));
    } catch (error) {
      console.error('Ошибка сохранения таймкода:', error);
    }
  });
  return _saveTimecodeToServer.apply(this, arguments);
}
function loadTimecodeFromServer(_x5, _x6) {
  return _loadTimecodeFromServer.apply(this, arguments);
}
function _loadTimecodeFromServer() {
  _loadTimecodeFromServer = _asyncToGenerator(function* (hash, fileId) {
    if (!hash || !fileId) return 0;
    try {
      var savedClientId = localStorage.getItem('clientId');
      yield ensureCollectionMap(hash, 1500);
      noteCollectionPlayback(hash, fileId);
      var mediaKey = getTimecodeMediaKey(hash, fileId);
      var response = yield fetchWithTimeout(SERVER_URL + '/api/timecode/get?hash=' + hash + '&fileId=' + fileId + '&clientId=' + encodeURIComponent(savedClientId) + (mediaKey ? '&mediaKey=' + encodeURIComponent(mediaKey) : ''));
      if (response.ok) {
        var data = yield response.json();
        if (data.success && data.timecode > 0) return data.timecode;
      }
    } catch (error) {
      console.error('Ошибка загрузки таймкода:', error);
    }
    return 0;
  });
  return _loadTimecodeFromServer.apply(this, arguments);
}
function currentTimecodeMediaKey() {
  try {
    return getTimecodeMediaKey(currentTimecodeData.hash, currentTimecodeData.fileId) || undefined;
  } catch (e) {
    return undefined;
  }
}
function clearTimecodeData() {
  currentTimecodeData = {
    hash: null,
    fileId: null,
    timecode: 0,
    duration: 0
  };
}
var pendingTimecodeSave = null;
function trackTimecodeSave(promise) {
  var p = Promise.resolve(promise)['catch'](function () {});
  pendingTimecodeSave = p;
  p.then(function () {
    if (pendingTimecodeSave === p) pendingTimecodeSave = null;
  });
  return p;
}
function awaitPendingTimecodeSave() {
  return pendingTimecodeSave || Promise.resolve();
}
function startTimecodeSaving() {
  if (timecodeSaveInterval) clearInterval(timecodeSaveInterval);
  timecodeSaveInterval = setInterval(function () {
    saveTimecodeToServer();
  }, 10000);
}
function stopTimecodeSaving() {
  if (timecodeSaveInterval) {
    clearInterval(timecodeSaveInterval);
    timecodeSaveInterval = null;
  }
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
function seekStream(_x7, _x8) {
  return _seekStream.apply(this, arguments);
}
function _seekStream() {
  _seekStream = _asyncToGenerator(function* (absoluteSeekTime, source) {
    currentBufferAhead = 0;
    wasImmediatePause = false;
    pauseTimer = null;
    pauseStartTime = null;
    thisisseek = true;
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
      AppState.isSeeking = true;
      AppState.suppressTimeUpdate = true;
      AppState.previewTime = absoluteSeekTime;
      videoPlayer.currentTime = relativeTime;
      if (currentTimecodeData.hash && currentTimecodeData.fileId) currentTimecodeData.timecode = absoluteSeekTime;
      var seekSlider = getEl('seek-slider');
      if (seekSlider) seekSlider.value = Math.min(absoluteSeekTime, totalDuration);
      updateTimeDisplay();
      var timeUpdateHandler = function () {
        if (videoPlayer.currentTime > 0) {
          hidePlayerLoading();
          AppState.isSeeking = false;
          AppState.isSliderDragging = false;
          AppState.previewTime = null;
          AppState.suppressTimeUpdate = false;
          videoPlayer.removeEventListener('timeupdate', timeUpdateHandler);
        }
      };
      videoPlayer.addEventListener('timeupdate', timeUpdateHandler);
      AppState._seekTimeout = setTimeout(function () {
        hidePlayerLoading();
        AppState.isSeeking = false;
        AppState.isSliderDragging = false;
        AppState.previewTime = null;
        AppState.suppressTimeUpdate = false;
        videoPlayer.removeEventListener('timeupdate', timeUpdateHandler);
      }, 3000);
      AppState._seekTimeUpdateHandler = timeUpdateHandler;
      return true;
    }
    AppState.seekQueue.push(absoluteSeekTime);
    if (AppState.isSeeking) return false;
    if (source === 'slider' && AppState.seekTimeout) clearTimeout(AppState.seekTimeout);
    return new Promise(function (resolve) {
      var executeSeek = function () {
        var _ref = _asyncToGenerator(function* () {
          var targetTime = AppState.seekQueue[AppState.seekQueue.length - 1];
          AppState.seekQueue = [];
          if (targetTime === undefined) {
            hidePlayerLoading();
            resolve(false);
            return;
          }
          var wasPlaying = !videoPlayer.paused;
          var episodesPanel = getEl('episodes-panel');
          var episodesBtn = getEl('episodes-btn');
          if (episodesPanel && !episodesPanel.classList.contains('hidden')) {
            episodesPanel.classList.add('hidden');
            if (episodesBtn) episodesBtn.classList.remove('active');
          }
          AppState.isSeeking = true;
          AppState.suppressTimeUpdate = true;
          AppState.previewTime = targetTime;
          var forceServer = !!AppState._forceServerSeek;
          var switchWhat = forceServer ? AppState._forceServerSeekWhat : null;
          AppState._forceServerSeek = false;
          AppState._forceServerSeekWhat = null;
          var positionInBuffer = !forceServer && isPositionInBuffer(targetTime);
          var inServerRange = !forceServer && !positionInBuffer && isPositionInServerRange(targetTime);
          if (inServerRange) {
            showPlayerLoading('Перемотка...', targetTime);
            var onPlaying = function () {
              hidePlayerLoading();
              videoPlayer.removeEventListener('playing', onPlaying);
              videoPlayer.removeEventListener('seeked', onSeeked);
            };
            var onSeeked = function () {
              if (!wasPlaying) onPlaying();
            };
            videoPlayer.addEventListener('playing', onPlaying);
            videoPlayer.addEventListener('seeked', onSeeked);
            setTimeout(onPlaying, 8000);
          }
          if (positionInBuffer || inServerRange) {
            var relativeTime = targetTime - AppState.seekOffset;
            videoPlayer.currentTime = relativeTime;
            if (wasPlaying) videoPlayer.play()['catch'](function (err) {});
            AppState.previewTime = null;
            AppState.suppressTimeUpdate = false;
            AppState.isSeeking = false;
            var seekSlider = getEl('seek-slider');
            if (seekSlider) seekSlider.value = targetTime;
            updateTimeDisplay();
            resolve(true);
            return;
          }
          lastCleanedSegment = -1;
          var playbackOverlay = getEl('playback-overlay');
          var playbackText = document.querySelector('.playback-text');
          playbackOverlay.classList.add('active');
          playbackText.textContent = switchWhat ? 'Переключение ' + switchWhat + '...' : 'Перемотка на ' + formatTime(targetTime) + '...';
          if (wasPlaying) videoPlayer.pause();
          var _retrySeek = function () {
            var _ref2 = _asyncToGenerator(function* (retryCount, maxRetries) {
              if (retryCount === undefined) retryCount = 0;
              if (maxRetries === undefined) maxRetries = 2;
              try {
                var savedClientId = localStorage.getItem('clientId');
                var seekResponse = yield bgFetch(SERVER_URL + '/hls/stream/seek', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    streamId: AppState.currentStreamId,
                    seekTime: targetTime,
                    multiChannel: AppState.multiChannelEnabled,
                    clientId: savedClientId,
                    duration: AppState.originalDuration,
                    sub: currentSubtitleTrack,
                    dv: AppState.dvPreferred ? 'true' : 'false',
                    audio: currentAudioTrack,
                    tracks: !!AppState.serverTracks
                  })
                });
                if (!seekResponse.ok) throw new Error('HTTP ' + seekResponse.status);
                var seekData = yield seekResponse.json();
                if (!seekData.success) throw new Error(seekData.error || 'Ошибка перемотки');
                AppState.expectedDuration = seekData.duration;
                AppState.originalDuration = seekData.originalDuration;
                AppState.seekOffset = seekData.seekOffset;
                AppState.currentStreamId = seekData.streamId;
                AppState.lastSuccessfulSeek = targetTime;
                applyServerTracks(seekData.tracks);
                if (videoPlayer) {
                  videoPlayer.dataset.expectedDuration = AppState.expectedDuration;
                  videoPlayer.dataset.originalDuration = AppState.originalDuration;
                  videoPlayer.dataset.seekOffset = AppState.seekOffset;
                }
                playbackText.textContent = 'Загрузка потока...';
                if (!AppState.serverTracks) {
                  var playlistReady = yield checkPlaylistExists(seekData.playlistUrl, 60);
                  if (!playlistReady) throw new Error('Таймаут ожидания плейлиста');
                }
                playbackText.textContent = 'Загрузка видео...';
                if (AppState.hls) {
                  AppState.hls.destroy();
                  AppState.hls = null;
                }
                if (Hls.isSupported()) {
                  AppState.hls = createHlsInstance();
                  if (currentPlaybackController) currentPlaybackController.abort();
                  currentPlaybackController = new AbortController();
                  var newSignal = currentPlaybackController.signal;
                  attachHlsEventListeners(AppState.hls, videoPlayer, newSignal, 0);
                  var subtitleTracksHandler = function () {
                    if (currentSubtitleTrack >= 0 && AppState.hls.subtitleTracks.length > currentSubtitleTrack) {
                      setTimeout(function () {
                        if (AppState.hls) AppState.hls.subtitleTrack = currentSubtitleTrack;
                      }, 200);
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
                    videoPlayer.play()['catch'](function (err) {
                      videoPlayer.muted = true;
                      videoPlayer.play()['catch'](function () {});
                      restoreSoundOnGesture();
                    });
                  }
                  videoPlayer.muted = false;
                  restoreSoundOnGesture();
                  forceUpdateDuration(AppState.expectedDuration, AppState.originalDuration, AppState.seekOffset);
                  var seekSlider = getEl('seek-slider');
                  if (seekSlider) seekSlider.value = Math.min(targetTime, parseFloat(seekSlider.max) || targetTime);
                  AppState.previewTime = null;
                  AppState.suppressTimeUpdate = false;
                  playbackOverlay.classList.remove('active');
                  playbackText.textContent = 'Воспроизведение...';
                  hidePlayerLoading();
                  startTimecodeSaving();
                  resetMouseIdleTimer();
                  startNearEndCheck();
                  startHeartbeat();
                  videoPlayer.removeEventListener('loadedmetadata', onMetaData);
                };
                videoPlayer.addEventListener('loadedmetadata', onMetaData, {
                  once: true
                });
                AppState._loadingTimeout = setTimeout(function () {
                  var loadingOverlay = getEl('loading-player-overlay');
                  if (loadingOverlay && loadingOverlay.classList.contains('active')) {
                    hidePlayerLoading();
                    if (wasPlaying) videoPlayer.play()['catch'](function () {});
                  }
                }, 10000);
                return true;
              } catch (error) {
                if (retryCount < maxRetries) {
                  playbackText.textContent = '⚠️ Ошибка ' + (switchWhat ? 'переключения' : 'перемотки') + '. Попытка ' + (retryCount + 1) + '/' + (maxRetries + 1) + '...';
                  yield new Promise(function (resolve) {
                    setTimeout(resolve, 1000);
                  });
                  return _retrySeek(retryCount + 1, maxRetries);
                }
                throw error;
              }
            });
            return function retrySeek(_x77, _x78) {
              return _ref2.apply(this, arguments);
            };
          }();
          try {
            var success = yield _retrySeek(0, 2);
            resolve(success);
          } catch (error) {
            playbackText.textContent = switchWhat ? '❌ Ошибка переключения ' + switchWhat : '❌ Ошибка перемотки!';
            setTimeout(function () {
              playbackOverlay.classList.remove('active');
              playbackText.textContent = 'Воспроизведение...';
            }, 2000);
            if (wasPlaying) setTimeout(function () {
              videoPlayer.play()['catch'](function () {});
            }, 1000);
            AppState.previewTime = null;
            AppState.suppressTimeUpdate = false;
            resolve(false);
          } finally {
            AppState.isSeeking = false;
          }
        });
        return function executeSeek() {
          return _ref.apply(this, arguments);
        };
      }();
      if (source === 'slider') {
        if (AppState.seekTimeout) clearTimeout(AppState.seekTimeout);
        AppState.seekTimeout = setTimeout(executeSeek, 300);
      } else {
        executeSeek();
      }
    });
  });
  return _seekStream.apply(this, arguments);
}
function extractVideoFiles(files) {
  if (files === undefined) files = [];
  var videoFiles = window.pickPlayableVideoFiles(files);
  return typeof window.sortEpisodeFiles === 'function' ? window.sortEpisodeFiles(videoFiles) : videoFiles;
}
function resolveTorrentWithFiles(_x9, _x0, _x1) {
  return _resolveTorrentWithFiles.apply(this, arguments);
}
function _resolveTorrentWithFiles() {
  _resolveTorrentWithFiles = _asyncToGenerator(function* (hash, maxAttempts, delayMs) {
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
      if (torrent && torrent.file_stats && Array.isArray(torrent.file_stats)) files = torrent.file_stats;else if (torrent && torrent.data) {
        try {
          var data = JSON.parse(torrent.data);
          if (data.TorrServer && Array.isArray(data.TorrServer.Files)) files = data.TorrServer.Files;
        } catch (e) {}
      }
      if (extractVideoFiles(files).length > 0) return torrent;
      if (attempt < maxAttempts - 1) {
        yield refreshTorrentsList();
        for (var j = 0; j < AppState.torrents.length; j++) {
          if (AppState.torrents[j].hash && AppState.torrents[j].hash.toLowerCase() === hash.toLowerCase()) {
            torrent = AppState.torrents[j];
            break;
          }
        }
        yield new Promise(function (resolve) {
          setTimeout(resolve, delayMs);
        });
      }
    }
    return torrent;
  });
  return _resolveTorrentWithFiles.apply(this, arguments);
}
function getEpisodeMetaForFile(file) {
  if (!file || !currentTorrentHash || typeof window.getTorrentEpisodeMeta !== 'function') return null;
  return window.getTorrentEpisodeMeta(currentTorrentHash, file.id);
}
function getEpisodeLabel(file, idx) {
  var meta = getEpisodeMetaForFile(file);
  if (typeof window.formatEpisodeLabel === 'function') return window.formatEpisodeLabel(meta, idx + 1);
  return 'Серия ' + (idx + 1);
}
function getEpisodePlayerTitle(hash, fileId) {
  if (!hash || !currentEpisodeFiles || currentEpisodeFiles.length < 2) return null;
  if (typeof window.getTorrentEpisodeMeta !== 'function') return null;
  var meta = window.getTorrentEpisodeMeta(hash, fileId);
  if (!meta || !meta.name) return null;
  var idx = 0;
  for (var i = 0; i < currentEpisodeFiles.length; i++) {
    if (String(currentEpisodeFiles[i].id) === String(fileId)) {
      idx = i;
      break;
    }
  }
  return window.formatEpisodeLabel(meta, idx + 1);
}
function refreshEpisodePlayerTitle() {
  if (AppState.currentScreen !== 'player') return;
  var file = currentEpisodeFiles[currentEpisodeIndex];
  if (!file) return;
  var title = getEpisodePlayerTitle(currentTorrentHash, file.id);
  if (title) updatePlayerTitle(title);
}
function loadEpisodesInfo(_x10, _x11) {
  return _loadEpisodesInfo.apply(this, arguments);
}
function _loadEpisodesInfo() {
  _loadEpisodesInfo = _asyncToGenerator(function* (hash, currentFileId) {
    if (currentFileId === undefined) currentFileId = null;
    if (!hash || !AppState.currentTorrserverUrl) return;
    try {
      var torrent = yield resolveTorrentWithFiles(hash, 4, 800);
      if (!torrent) return;
      var files = [];
      if (torrent.file_stats && Array.isArray(torrent.file_stats)) files = torrent.file_stats;else if (torrent.data) {
        try {
          var data = JSON.parse(torrent.data);
          if (data.TorrServer && data.TorrServer.Files) files = data.TorrServer.Files;
        } catch (e) {}
      }
      var videoFiles = extractVideoFiles(files);
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
          }
        }
        if (currentEpisodeIndex === -1 || currentEpisodeIndex === undefined) currentEpisodeIndex = 0;
        renderEpisodesList();
        if (typeof window.ensureTorrentEpisodeMeta === 'function') {
          window.ensureTorrentEpisodeMeta(torrent, videoFiles).then(function (changed) {
            if (!changed || currentTorrentHash !== hash) return;
            renderEpisodesList();
            refreshEpisodePlayerTitle();
            var playing = currentEpisodeFiles[currentEpisodeIndex];
            if (AppState.isSerials && playing) fetchSkipData(torrent, playing.id, true);
          });
        }
        refreshEpisodePlayerTitle();
        if (AppState.isSerials) fetchSkipData(torrent, videoFiles[currentEpisodeIndex].id);
        var episodesBtn = getEl('episodes-btn');
        if (episodesBtn) episodesBtn.style.display = videoFiles.length > 1 ? 'flex' : 'none';
        updateEpisodeButtons();
      } else {
        currentEpisodeFiles = [];
        currentEpisodeIndex = 0;
        var episodesBtn = getEl('episodes-btn');
        if (episodesBtn) episodesBtn.style.display = 'none';
        updateEpisodeButtons();
      }
    } catch (error) {
      console.error('Ошибка загрузки серий:', error);
    }
  });
  return _loadEpisodesInfo.apply(this, arguments);
}
function fetchSkipData(_x12, _x13, _x14) {
  return _fetchSkipData.apply(this, arguments);
}
function _fetchSkipData() {
  _fetchSkipData = _asyncToGenerator(function* (torrent, fileId, onlyIfChanged) {
    var target = resolveSkipTarget(torrent, fileId);
    var key = target ? target.tmdbId + '_' + target.season + '_' + target.episode : '';
    if (onlyIfChanged && key === skipDataKey) return skipData;
    skipDataKey = key;
    skipIntro = 0;
    skipCredits = 0;
    if (!target) {
      skipData = {
        error: true
      };
      return skipData;
    }
    var url = getSkipApiBase() + '/v2/media?tmdb_id=' + target.tmdbId + '&season=' + target.season + '&episode=' + target.episode;
    try {
      var response = yield bgFetch(url);
      var data = yield response.json();
      if (key !== skipDataKey) return skipData;
      if (data.error) {
        skipData = {
          error: true
        };
      } else {
        skipData = data;
        skipData.error = false;
      }
      return skipData;
    } catch (error) {
      if (key === skipDataKey) skipData = {
        error: true
      };
      return skipData;
    }
  });
  return _fetchSkipData.apply(this, arguments);
}
function getTorrentTmdbId(torrent) {
  if (!torrent) return null;
  if (torrent.tmdbId || torrent.tmdb_id) return String(torrent.tmdbId || torrent.tmdb_id);
  var hash = torrent.hash ? String(torrent.hash).toLowerCase() : '';
  var known = hash && typeof knownTorrentMeta !== 'undefined' ? knownTorrentMeta.get(hash) : null;
  if (known && known.id) return String(known.id);
  var m = String(torrent.title || '').match(/\[(\d+)\]/);
  return m ? m[1] : null;
}
function findLoadedTorrent(hash) {
  if (!hash || !Array.isArray(AppState.torrents)) return null;
  var h = String(hash).toLowerCase();
  for (var i = 0; i < AppState.torrents.length; i++) {
    var t = AppState.torrents[i];
    if (t && t.hash && String(t.hash).toLowerCase() === h) return t;
  }
  return null;
}
function getTorrentSingleSeason(torrent) {
  if (!torrent || typeof window.getTorrentSeasons !== 'function') return null;
  var seasons = window.getTorrentSeasons(torrent);
  return seasons.length === 1 ? seasons[0] : null;
}
function getTimecodeMediaKey(hash, fileId, files) {
  if (!hash || fileId === null || fileId === undefined) return null;
  var h = String(hash).toLowerCase();
  var torrent = findLoadedTorrent(h) || {
    hash: h
  };
  var tmdbId = parseInt(getTorrentTmdbId(torrent) || '', 10);
  if (!(tmdbId > 0)) return null;
  var known = typeof knownTorrentMeta !== 'undefined' && knownTorrentMeta ? knownTorrentMeta.get(h) : null;
  var seasons = typeof window.getTorrentSeasons === 'function' ? window.getTorrentSeasons(torrent) : [];
  var type = torrent.media_type || known && known.mediaType || (seasons.length ? 'tv' : null);
  if (!files) files = currentTorrentHash && String(currentTorrentHash).toLowerCase() === h ? currentEpisodeFiles : null;
  var file = null;
  for (var i = 0; files && i < files.length; i++) {
    if (String(files[i].id) === String(fileId)) {
      file = files[i];
      break;
    }
  }
  var ref = file && typeof parseEpisodeRef === 'function' ? parseEpisodeRef(file.path || file.name) : null;
  if (type === 'tv' || !type && ref) {
    var meta = typeof window.getTorrentEpisodeMeta === 'function' ? window.getTorrentEpisodeMeta(h, fileId) : null;
    var season = null,
      episode = null;
    if (meta && meta.season !== undefined && meta.season !== null && meta.episode) {
      season = meta.season;
      episode = meta.episode;
    } else if (ref) {
      season = ref.season !== null ? ref.season : seasons.length === 1 ? seasons[0] : null;
      episode = ref.episode;
    }
    season = parseInt(season, 10);
    episode = parseInt(episode, 10);
    return season >= 0 && episode > 0 ? 'tv:' + tmdbId + ':' + season + ':' + episode : null;
  }
  if (files && files.length === 1 && file) return 'movie:' + tmdbId;
  var part = collectionPartFor(h, fileId);
  return part ? 'movie:' + part.id : null;
}
window.getTimecodeMediaKey = getTimecodeMediaKey;
var COLLECTION_MAP_PREFIX = 'ts_collmap_';
var COLLECTION_MAP_TTL_MS = 30 * 24 * 60 * 60 * 1000;
var COLLECTION_MAX_PARTS = 15;
var collectionMaps = {};
var collectionMapPending = {};
function collNorm(s) {
  return ' ' + String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
}
function collFileYears(name) {
  var out = [],
    re = /(?:^|[^0-9])((?:19|20)\d{2})(?![0-9])/g,
    m;
  while (m = re.exec(name)) out.push(+m[1]);
  return out;
}
var COLL_SEQUEL_RE = /^(\d{1,2}|ii|iii|iv|v|vi|vii|viii|ix|x)$/;
function collTitleHit(fn, part, strict) {
  var best = 0;
  for (var i = 0; i < part.names.length; i++) {
    var n = part.names[i],
      at = fn.indexOf(n);
    if (n.length <= 3 || at === -1 || n.length <= best) continue;
    if (strict && COLL_SEQUEL_RE.test(fn.slice(at + n.length).split(' ')[0])) continue;
    best = n.length;
  }
  return best;
}
function matchCollectionFile(path, parts) {
  var base = String(path || '').split('/').pop().replace(/\.[a-z0-9]{2,4}$/i, '');
  var fn = collNorm(base),
    years = collFileYears(base);
  var hits = [],
    bestT = 0,
    i;
  for (i = 0; i < parts.length; i++) {
    var t = collTitleHit(fn, parts[i], !years.length);
    hits.push({
      p: parts[i],
      t: t,
      y: years.indexOf(parts[i].year) !== -1
    });
    if (t > bestT) bestT = t;
  }
  var pool = [],
    top = 0,
    pick = [];
  for (i = 0; i < hits.length; i++) if (hits[i].y) {
    pool.push(hits[i]);
    if (hits[i].t > top) top = hits[i].t;
  }
  if (pool.length === 1) return pool[0].p;
  if (pool.length > 1) {
    for (i = 0; i < pool.length; i++) if (top > 0 && pool[i].t === top) pick.push(pool[i]);
  } else if (bestT > 0) {
    for (i = 0; i < hits.length; i++) {
      if (hits[i].t !== bestT) continue;
      var near = !years.length;
      for (var k = 0; k < years.length; k++) if (Math.abs(years[k] - hits[i].p.year) <= 1) near = true;
      if (near) pick.push(hits[i]);
    }
  }
  return pick.length === 1 ? pick[0].p : null;
}
window.matchCollectionFile = matchCollectionFile;
function readCollectionMap(h) {
  if (collectionMaps[h]) return collectionMaps[h];
  try {
    var raw = localStorage.getItem(COLLECTION_MAP_PREFIX + h);
    var m = raw ? JSON.parse(raw) : null;
    if (m && m.files && Date.now() - (m.at || 0) < COLLECTION_MAP_TTL_MS) return collectionMaps[h] = m;
  } catch (e) {}
  return null;
}
function collectionPartFor(hash, fileId) {
  if (!hash || fileId === null || fileId === undefined) return null;
  var m = readCollectionMap(String(hash).toLowerCase());
  return m && m.files[String(fileId)] || null;
}
window.collectionPartFor = collectionPartFor;
function looksLikeMovieCollection(torrent, videoFiles) {
  if (!torrent || videoFiles.length < 2) return false;
  var known = typeof knownTorrentMeta !== 'undefined' && knownTorrentMeta ? knownTorrentMeta.get(String(torrent.hash).toLowerCase()) : null;
  var type = torrent.media_type || torrent.category || known && known.mediaType || '';
  if (type === 'tv' || type === 'serial') return false;
  if (typeof window.getTorrentSeasons === 'function' && window.getTorrentSeasons(torrent).length) return false;
  for (var i = 0; i < videoFiles.length; i++) {
    if (typeof parseEpisodeRef === 'function' && parseEpisodeRef(videoFiles[i].path || videoFiles[i].name)) return false;
  }
  return true;
}
function buildCollectionMap(_x15) {
  return _buildCollectionMap.apply(this, arguments);
}
function _buildCollectionMap() {
  _buildCollectionMap = _asyncToGenerator(function* (h) {
    var torrent = yield resolveTorrentWithFiles(h, 2, 500);
    if (!torrent) return null;
    var files = torrent.file_stats || [];
    if (!files.length && torrent.data) {
      try {
        var d = JSON.parse(torrent.data);
        files = d.TorrServer && d.TorrServer.Files || [];
      } catch (e) {}
    }
    var video = extractVideoFiles(files);
    var tmdbId = parseInt(getTorrentTmdbId(torrent) || '', 10);
    var empty = {
      files: {},
      at: Date.now()
    };
    if (!(tmdbId > 0) || !looksLikeMovieCollection(torrent, video)) return empty;
    var details = yield safeFetch(SERVER_URL + '/api/tmdb/details?id=' + tmdbId + '&type=movie', {
      timeout: 10000
    });
    var bc = details && details.belongs_to_collection;
    if (!bc || !bc.id) return details ? empty : null;
    var coll = yield safeFetch(SERVER_URL + '/api/tmdb/collection/parts?id=' + encodeURIComponent(bc.id), {
      timeout: 15000
    });
    var items = coll && coll.success && coll.items;
    if (!items) return null;
    items = items.slice(0, COLLECTION_MAX_PARTS);
    var orig = yield Promise.all(items.map(function (it) {
      return safeFetch(SERVER_URL + '/api/tmdb/item?id=' + it.id + '&type=movie', {
        timeout: 10000
      });
    }));
    var parts = [];
    for (var i = 0; i < items.length; i++) {
      var year = parseInt(String(items[i].release_date || '').slice(0, 4), 10);
      if (!(year > 0)) continue;
      var names = [collNorm(items[i].title)];
      var o = orig[i] && orig[i].original_title;
      if (o && names.indexOf(collNorm(o)) === -1) names.push(collNorm(o));
      parts.push({
        id: String(items[i].id),
        year: year,
        title: items[i].title,
        poster: items[i].poster_path || null,
        names: names
      });
    }
    var map = {
        files: {},
        at: Date.now()
      },
      n = 0;
    for (var j = 0; j < video.length; j++) {
      var p = matchCollectionFile(video[j].path || video[j].name, parts);
      if (p) {
        map.files[String(video[j].id)] = {
          id: p.id,
          title: p.title,
          poster: p.poster
        };
        n++;
      }
    }
    console.log('🎞️ Сборник ' + h.slice(0, 8) + ': коллекция «' + (coll.name || bc.id) + '», сопоставлено файлов ' + n + ' из ' + video.length);
    return map;
  });
  return _buildCollectionMap.apply(this, arguments);
}
function ensureCollectionMap(hash, waitMs) {
  if (!hash) return Promise.resolve(null);
  var h = String(hash).toLowerCase();
  var ready = readCollectionMap(h);
  if (ready) return Promise.resolve(ready);
  if (!collectionMapPending[h]) {
    collectionMapPending[h] = buildCollectionMap(h).then(function (m) {
      delete collectionMapPending[h];
      if (!m) return null;
      collectionMaps[h] = m;
      try {
        localStorage.setItem(COLLECTION_MAP_PREFIX + h, JSON.stringify(m));
      } catch (e) {}
      return m;
    }, function (e) {
      delete collectionMapPending[h];
      console.warn('Сборник: карта файлов не посчиталась:', e && e.message);
      return null;
    });
  }
  if (!(waitMs > 0)) return collectionMapPending[h];
  return Promise.race([collectionMapPending[h], new Promise(function (r) {
    setTimeout(function () {
      r(null);
    }, waitMs);
  })]);
}
window.ensureCollectionMap = ensureCollectionMap;
var collectionHistoryNoted = {
  key: '',
  at: 0
};
function noteCollectionPlayback(hash, fileId) {
  if (!hash || fileId === null || fileId === undefined) return;
  ensureCollectionMap(hash).then(function () {
    var part = collectionPartFor(hash, fileId);
    if (!part || !window.addToWatchHistory) return;
    var key = String(hash).toLowerCase() + ':' + fileId,
      now = Date.now();
    if (collectionHistoryNoted.key === key && now - collectionHistoryNoted.at < 60000) return;
    collectionHistoryNoted = {
      key: key,
      at: now
    };
    Promise.resolve(window.addToWatchHistory(part.id, part.title, 'movie', part.poster))['catch'](function () {});
  });
}
function resolveSkipTarget(torrent, fileId) {
  var tmdbId = getTorrentTmdbId(torrent) || AppState.currentTMDB || null;
  if (!tmdbId) return null;
  var season = null,
    episode = null;
  var hash = torrent && torrent.hash ? torrent.hash : currentTorrentHash;
  var meta = hash && typeof window.getTorrentEpisodeMeta === 'function' ? window.getTorrentEpisodeMeta(hash, fileId) : null;
  if (meta && meta.season !== undefined && meta.season !== null && meta.episode) {
    season = meta.season;
    episode = meta.episode;
  } else {
    var idx = -1;
    for (var i = 0; i < currentEpisodeFiles.length; i++) {
      if (String(currentEpisodeFiles[i].id) === String(fileId)) {
        idx = i;
        break;
      }
    }
    var file = idx !== -1 ? currentEpisodeFiles[idx] : null;
    var ref = file && typeof parseEpisodeRef === 'function' ? parseEpisodeRef(file.path || file.name) : null;
    season = ref && ref.season !== null ? ref.season : getTorrentSingleSeason(torrent);
    if (season === null && AppState.currentSeason && String(AppState.currentTMDB) === String(tmdbId)) season = AppState.currentSeason;
    episode = ref ? ref.episode : idx !== -1 ? idx + 1 : null;
  }
  tmdbId = parseInt(tmdbId, 10);
  season = parseInt(season, 10);
  episode = parseInt(episode, 10);
  if (!(tmdbId > 0) || !(season >= 0) || !(episode > 0)) return null;
  return {
    tmdbId: tmdbId,
    season: season,
    episode: episode
  };
}
function renderEpisodesList() {
  var episodesList = getEl('episodes-list');
  if (!episodesList) return;
  var currentInfo = getEl('current-episode-info');
  if (!currentInfo) {
    currentInfo = document.createElement('div');
    currentInfo.id = 'current-episode-info';
    currentInfo.className = 'current-episode-info';
    episodesList.parentNode.insertBefore(currentInfo, episodesList);
  }
  if (currentEpisodeFiles.length === 0) {
    currentInfo.innerHTML = '<span class="current-episode-badge">Пусто</span><span>Нет доступных серий</span>';
    episodesList.innerHTML = '<div class="search-result-empty">Нет доступных серий</div>';
    return;
  }
  currentInfo.innerHTML = '<span class="current-episode-badge">Текущая</span><span>Серия ' + (currentEpisodeIndex + 1) + ' из ' + currentEpisodeFiles.length + '</span>';
  var html = '';
  for (var idx = 0; idx < currentEpisodeFiles.length; idx++) {
    var file = currentEpisodeFiles[idx];
    var isActive = idx === currentEpisodeIndex;
    var fileSize = formatBytes(file.length);
    var meta = getEpisodeMetaForFile(file);
    var episodeNumber = meta && meta.episode || idx + 1;
    var episodeTitle = getEpisodeLabel(file, idx);
    html += '<div class="episode-item ' + (isActive ? 'active' : '') + '" data-index="' + idx + '" data-file-id="' + file.id + '">' + '<div class="episode-number">' + episodeNumber + '</div>' + '<div class="episode-info"><div class="episode-title">' + escapeHtml(episodeTitle) + '</div><div class="episode-duration">' + fileSize + '</div></div>' + '<button class="episode-play" title="Воспроизвести">▶</button></div>';
  }
  episodesList.innerHTML = html;
  setupEpisodesListDelegation();
}
function switchToEpisode(_x16, _x17) {
  return _switchToEpisode.apply(this, arguments);
}
function _switchToEpisode() {
  _switchToEpisode = _asyncToGenerator(function* (index, fileId) {
    stopTorrentStatsUpdates();
    currentBufferAhead = 0;
    wasImmediatePause = false;
    pauseTimer = null;
    pauseStartTime = null;
    thisisseek = false;
    hideSkipButton();
    stopHeartbeat();
    if (!currentTorrentHash || !AppState.currentTorrserverUrl) return;
    if (index === currentEpisodeIndex) {
      toggleEpisodesPanel();
      return;
    }
    if (nearEndCheckInterval) {
      clearInterval(nearEndCheckInterval);
      nearEndCheckInterval = null;
    }
    yield saveTimecodeToServer();
    var savedAudioTrack = currentAudioTrack;
    var episodesPanel = getEl('episodes-panel');
    var episodesBtn = getEl('episodes-btn');
    if (episodesPanel) {
      episodesPanel.classList.add('hidden');
      if (episodesBtn) episodesBtn.classList.remove('active');
    }
    getEl('playback-overlay').classList.add('active');
    document.querySelector('.playback-text').textContent = 'Переключение на серию ' + (index + 1) + '...';
    try {
      var playUrl = AppState.currentTorrserverUrl + '/play/' + currentTorrentHash + '/' + fileId;
      currentEpisodeIndex = index;
      AppState.videoUrl = playUrl;
      if (AppState.currentStreamId) {
        yield bgFetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, {
          method: 'POST'
        });
        AppState.currentStreamId = null;
      }
      var videoPlayer = getEl('video-player');
      videoPlayer.removeEventListener('ended', handleVideoEnded);
      destroyHls();
      if (currentTorrentHash && fileId) yield saveAudioPreference(currentTorrentHash, fileId, savedAudioTrack);
      yield startHLSPlayback(playUrl, 0, lastPlaybackFromSearch, index, savedAudioTrack);
      var episodeTitle = getEpisodePlayerTitle(currentTorrentHash, fileId);
      if (episodeTitle) updatePlayerTitle(episodeTitle);else {
        var fileName = yield getFileNameByHash(currentTorrentHash, fileId);
        if (fileName && AppState.currentDetailItem) updatePlayerTitle(AppState.currentDetailItem.title + ' - ' + fileName);
      }
      renderEpisodesList();
      updateEpisodeButtons();
    } catch (error) {
      showSwitchFailedBanner('серию', error && error.message);
    } finally {
      getEl('playback-overlay').classList.remove('active');
      document.querySelector('.playback-text').textContent = 'Воспроизведение...';
      hidePlayerLoading();
      startHeartbeat();
      startTorrentStatsUpdates();
    }
  });
  return _switchToEpisode.apply(this, arguments);
}
var PLAYER_PANELS = {
  episodes: {
    panel: 'episodes-panel',
    btn: 'episodes-btn'
  },
  tracks: {
    panel: 'tracks-panel',
    btn: 'tracks-btn'
  },
  audio: {
    panel: 'audio-panel',
    btn: 'tracks-btn'
  },
  subtitles: {
    panel: 'subtitles-panel',
    btn: 'tracks-btn'
  },
  onlinesubs: {
    panel: 'online-subs-panel',
    btn: 'tracks-btn'
  },
  settings: {
    panel: 'player-settings-panel',
    btn: 'player-settings-btn'
  }
};
function setPlayerPanel(name, open) {
  var cfg = PLAYER_PANELS[name];
  if (!cfg) return false;
  var panel = getEl(cfg.panel),
    btn = getEl(cfg.btn);
  if (!panel) return false;
  if (open) {
    panel.classList.remove('hidden');
    if (btn) btn.classList.add('active');
  } else {
    panel.classList.add('hidden');
    if (btn) btn.classList.remove('active');
  }
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
  if (except && isPlayerPanelOpen(except)) setPlayerPanel(except, true);
  if (!except) tracksMenuOrigin = null;
}
window.closePlayerPanels = closePlayerPanels;
function getOpenPlayerPanel() {
  for (var name in PLAYER_PANELS) {
    if (isPlayerPanelOpen(name)) return getEl(PLAYER_PANELS[name].panel);
  }
  return null;
}
window.getOpenPlayerPanel = getOpenPlayerPanel;
function togglePlayerPanel(name) {
  var willOpen = !isPlayerPanelOpen(name);
  closePlayerPanels(name);
  if (willOpen) {
    if (name === 'episodes') {
      var hash = AppState.currentDetailItem && AppState.currentDetailItem.hash;
      if (hash && currentEpisodeFiles.length && currentTorrentHash === hash) renderEpisodesList();else if (hash) loadEpisodesInfo(hash);
    } else if (name === 'audio') renderAudioTracks();else if (name === 'subtitles') renderSubtitleTracks();else if (name === 'onlinesubs') OnlineSubs.open();else if (name === 'tracks') updateTracksMenu();else if (name === 'settings') updatePlayerSettingsMenu();
  }
  tracksMenuOrigin = null;
  setPlayerPanel(name, willOpen);
  return willOpen;
}
window.togglePlayerPanel = togglePlayerPanel;
var tracksMenuOrigin = null;
function updateTracksMenu() {
  var audioValue = getEl('tracks-audio-value');
  var subsValue = getEl('tracks-subtitles-value');
  if (audioValue) {
    var a = currentAudioTracks && currentAudioTracks[currentAudioTrack];
    audioValue.textContent = !currentAudioTracks || !currentAudioTracks.length ? 'Нет дорожек' : a ? (a.title || 'Дорожка ' + (currentAudioTrack + 1)) + (a.language && a.language !== 'und' ? ' · ' + a.language.toUpperCase() : '') : 'По умолчанию';
  }
  if (subsValue) {
    var s = currentSubTracks && currentSubTracks[currentSubtitleTrack];
    subsValue.textContent = !currentSubTracks || !currentSubTracks.length ? 'Нет субтитров' : s ? (s.title || 'Субтитры ' + (currentSubtitleTrack + 1)) + (s.language && s.language !== 'und' ? ' · ' + s.language.toUpperCase() : '') : 'Выключены';
  }
  var onlineValue = getEl('tracks-online-value');
  if (onlineValue) onlineValue.textContent = OnlineSubs.summary();
}
function openTracksSection(section) {
  togglePlayerPanel(section);
  tracksMenuOrigin = section;
  if (typeof focusActivePanelItem === 'function') focusActivePanelItem(section);
}
function playerPanelBack() {
  var section = tracksMenuOrigin;
  if (!section || !isPlayerPanelOpen(section)) return false;
  togglePlayerPanel('tracks');
  var row = getEl(section === 'audio' ? 'tracks-audio-item' : section === 'onlinesubs' ? 'tracks-online-item' : 'tracks-subtitles-item');
  if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
  if (row && typeof focusEl === 'function') setTimeout(function () {
    focusEl(row);
  }, 0);
  return true;
}
window.playerPanelBack = playerPanelBack;
function setupTracksButton() {
  var tracksBtn = getEl('tracks-btn');
  var panel = getEl('tracks-panel');
  if (!tracksBtn || !panel) return;
  tracksBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (isPlayerPanelOpen('audio') || isPlayerPanelOpen('subtitles') || isPlayerPanelOpen('onlinesubs')) closePlayerPanels();else togglePlayerPanel('tracks');
    resetMouseIdleTimer();
  });
  panel.addEventListener('click', function (e) {
    e.stopPropagation();
    var item = e.target && e.target.closest ? e.target.closest('.player-menu-item') : null;
    if (item && item.dataset.section) openTracksSection(item.dataset.section);
    resetMouseIdleTimer();
  });
  var closeBtn = getEl('close-tracks');
  if (closeBtn) closeBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    setPlayerPanel('tracks', false);
    resetMouseIdleTimer();
  });
  setupPlayerPanelsOutsideClick();
}
var SUBTITLE_SIZES = [{
  label: 'Очень мелкие',
  scale: 0.7
}, {
  label: 'Мелкие',
  scale: 0.85
}, {
  label: 'Обычные',
  scale: 1
}, {
  label: 'Крупные',
  scale: 1.3
}, {
  label: 'Очень крупные',
  scale: 1.6
}];
var SUBTITLE_SIZE_DEFAULT = 2;
var AVPLAY_SUBS_VH = 4.4;
window.SUBTITLE_SIZES = SUBTITLE_SIZES;
function getSubtitleSize() {
  var v = NaN;
  try {
    v = parseInt(localStorage.getItem('subtitleSize'), 10);
  } catch (e) {}
  return v >= 0 && v < SUBTITLE_SIZES.length ? v : SUBTITLE_SIZE_DEFAULT;
}
window.getSubtitleSize = getSubtitleSize;
function webosSubtitleFontSize(mediaId) {
  if (!mediaId) return;
  lunaRequest('luna://com.webos.media', 'setSubtitleFontSize', {
    mediaId: mediaId,
    fontSize: getSubtitleSize()
  }, null, null, true);
}
function applySubtitleSize() {
  var scale = SUBTITLE_SIZES[getSubtitleSize()].scale;
  var style = getEl('subtitle-size-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'subtitle-size-style';
    document.head.appendChild(style);
  }
  style.textContent = scale === 1 ? '' : '#video-player::cue{font-size:' + Math.round(scale * 100) + '%;}' + '#tizen-avplay-subs,#online-subs-box{font-size:' + (AVPLAY_SUBS_VH * scale).toFixed(2) + 'vh;}';
  if (webosSubs.enabled && webosSubs.mediaId) webosSubtitleFontSize(webosSubs.mediaId);
}
function setSubtitleSize(level) {
  level = parseInt(level, 10);
  if (!(level >= 0 && level < SUBTITLE_SIZES.length)) return;
  try {
    localStorage.setItem('subtitleSize', String(level));
  } catch (e) {}
  applySubtitleSize();
  updatePlayerSettingsMenu();
  if (typeof window.updateSubtitleSizeSetting === 'function') window.updateSubtitleSizeSetting();
}
window.setSubtitleSize = setSubtitleSize;
function updatePlayerSettingsMenu() {
  var clock = getEl('psetting-clock'),
    buffer = getEl('psetting-buffer');
  var clockShown = typeof hideClockEnabled === 'undefined' || !hideClockEnabled;
  if (clock) clock.classList.toggle('is-on', clockShown);
  if (buffer) buffer.classList.toggle('is-on', !AppState.bufferHidden);
  var autoSkip = getEl('psetting-autoskip');
  if (autoSkip) autoSkip.classList.toggle('is-on', !!AppState.autoSkipIntro);
  var manualHide = getEl('psetting-manualhide');
  if (manualHide) manualHide.classList.toggle('is-on', !!AppState.playerManualHide);
  var saver = getEl('psetting-screensaver');
  if (saver) {
    saver.classList.toggle('is-on', AppState.playerScreensaver !== false);
    saver.style.display = window.AndroidJS || AppState.screensaver === false ? 'none' : '';
  }
  var diag = getEl('psetting-diag');
  if (diag) {
    diag.classList.toggle('is-on', !!(window.PlayerDiag && PlayerDiag.enabled()));
    diag.style.display = window.AndroidJS || !window.PlayerDiag ? 'none' : '';
  }
  var rememberZoom = getEl('psetting-zoom');
  if (rememberZoom) rememberZoom.classList.toggle('is-on', !!AppState.playerRememberZoom);
  var subSize = getEl('psetting-subsize-value');
  if (subSize) subSize.textContent = SUBTITLE_SIZES[getSubtitleSize()].label;
}
window.updatePlayerSettingsMenu = updatePlayerSettingsMenu;
function setupPlayerSettingsButton() {
  applySubtitleSize();
  var subSizeItem = getEl('psetting-subsize');
  if (subSizeItem && window.AndroidJS) subSizeItem.style.display = 'none';
  var autoSkipItem = getEl('psetting-autoskip');
  if (autoSkipItem && window.AndroidJS) autoSkipItem.style.display = 'none';
  var manualHideItem = getEl('psetting-manualhide');
  if (manualHideItem && window.AndroidJS) manualHideItem.style.display = 'none';
  var zoomItem = getEl('psetting-zoom');
  if (zoomItem && window.AndroidJS) zoomItem.style.display = 'none';
  var btn = getEl('player-settings-btn');
  var panel = getEl('player-settings-panel');
  if (!btn || !panel) return;
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    togglePlayerPanel('settings');
    resetMouseIdleTimer();
  });
  panel.addEventListener('click', function (e) {
    var item = e.target && e.target.closest ? e.target.closest('.player-menu-item') : null;
    if (item && item.id === 'psetting-clock' && typeof setClockHidden === 'function') {
      setClockHidden(item.classList.contains('is-on'));
    } else if (item && item.id === 'psetting-buffer' && typeof toggleBufferVisibility === 'function') {
      toggleBufferVisibility();
    } else if (item && item.id === 'psetting-autoskip' && typeof setAutoSkip === 'function') {
      setAutoSkip(!AppState.autoSkipIntro);
    } else if (item && item.id === 'psetting-manualhide' && typeof setPlayerManualHide === 'function') {
      setPlayerManualHide(!AppState.playerManualHide);
    } else if (item && item.id === 'psetting-diag' && window.PlayerDiag) {
      PlayerDiag.setEnabled(!PlayerDiag.enabled());
    } else if (item && item.id === 'psetting-zoom' && typeof setPlayerRememberZoom === 'function') {
      setPlayerRememberZoom(!AppState.playerRememberZoom);
    } else if (item && item.id === 'psetting-screensaver' && typeof setPlayerScreensaver === 'function') {
      setPlayerScreensaver(AppState.playerScreensaver === false);
    } else if (item && item.id === 'psetting-subsize') {
      setSubtitleSize((getSubtitleSize() + 1) % SUBTITLE_SIZES.length);
    }
    updatePlayerSettingsMenu();
    resetMouseIdleTimer();
  });
  var closeBtn = getEl('close-player-settings');
  if (closeBtn) closeBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    setPlayerPanel('settings', false);
    resetMouseIdleTimer();
  });
  setupPlayerPanelsOutsideClick();
}
var HUD_SEEK_STEP_SEC = 10;
function seekRelative(delta) {
  var video = getEl('video-player');
  if (!video) return;
  var base = AppState.isSeeking && typeof AppState.previewTime === 'number' ? AppState.previewTime : video.currentTime + (AppState.seekOffset || 0);
  var total = AppState.originalDuration || AppState.expectedDuration || video.duration;
  var target = base + delta;
  if (target < 0) target = 0;
  if (total && isFinite(total) && target > total - 1) target = Math.max(0, total - 1);
  var slider = getEl('seek-slider');
  if (slider) slider.value = target;
  var currentTimeEl = getEl('current-time');
  if (currentTimeEl) currentTimeEl.textContent = formatTime(target);
  if (typeof window.showSeekOverlay === 'function') {
    window.showSeekOverlay(target, delta < 0 ? -1 : 1, Math.abs(delta));
    if (typeof window.scheduleHideSeekOverlay === 'function') window.scheduleHideSeekOverlay();
  }
  if (!AppState.hls) {
    video.currentTime = target - (AppState.seekOffset || 0);
    if (typeof updateTimeDisplay === 'function') updateTimeDisplay();
  } else {
    AppState.previewTime = target;
    AppState.suppressTimeUpdate = true;
    seekStream(target, 'button');
  }
}
window.seekRelative = seekRelative;
function setupSeekButtons() {
  var rew = getEl('rewind-btn'),
    fwd = getEl('forward-btn');
  if (rew) rew.addEventListener('click', function (e) {
    e.stopPropagation();
    seekRelative(-HUD_SEEK_STEP_SEC);
    resetMouseIdleTimer();
  });
  if (fwd) fwd.addEventListener('click', function (e) {
    e.stopPropagation();
    seekRelative(HUD_SEEK_STEP_SEC);
    resetMouseIdleTimer();
  });
}
function setupPlayerPanelsOutsideClick() {
  setupPlayerPanelsActivity();
  if (setupPlayerPanelsOutsideClick._bound) return;
  setupPlayerPanelsOutsideClick._bound = true;
  document.addEventListener('click', function (e) {
    var inPlayer = AppState && AppState.currentScreen === 'player';
    if (e.target && e.target.isConnected === false) {
      if (inPlayer) resetMouseIdleTimer();
      return;
    }
    for (var name in PLAYER_PANELS) {
      if (!isPlayerPanelOpen(name)) continue;
      var cfg = PLAYER_PANELS[name];
      var panel = getEl(cfg.panel),
        btn = getEl(cfg.btn);
      if (panel && panel.contains(e.target)) continue;
      if (btn && btn.contains(e.target)) continue;
      setPlayerPanel(name, false);
    }
    if (inPlayer) resetMouseIdleTimer();
  });
}
function toggleEpisodesPanel() {
  return togglePlayerPanel('episodes');
}
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
function setupEpisodesButton() {
  var episodesBtn = getEl('episodes-btn');
  var closeEpisodesBtn = getEl('close-episodes');
  var episodesPanel = getEl('episodes-panel');
  if (!episodesBtn || !closeEpisodesBtn || !episodesPanel) return;
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
var preloadedFilesAt = {};
var PRELOAD_TTL_MS = 5 * 60 * 1000;
var PRELOADED_FILES_LIMIT = 200;
var preloadedFilesCount = 0;
function wasPreloadedRecently(hash, fileId) {
  var key = String(hash).toLowerCase() + ':' + fileId;
  var at = preloadedFilesAt[key];
  if (at && Date.now() - at < PRELOAD_TTL_MS) return true;
  if (!at) {
    if (preloadedFilesCount >= PRELOADED_FILES_LIMIT) {
      preloadedFilesAt = {};
      preloadedFilesCount = 0;
    }
    preloadedFilesCount++;
  }
  preloadedFilesAt[key] = Date.now();
  return false;
}
var pendingPreload = null;
function abortPendingPreload() {
  if (!pendingPreload) return;
  var stale = pendingPreload;
  pendingPreload = null;
  delete preloadedFilesAt[stale.key];
  try {
    stale.controller.abort();
  } catch (e) {}
}
function preloadTorrents(hash, fileId) {
  if (!hash || !fileId || !AppState.currentTorrserverUrl) return;
  if (wasPreloadedRecently(hash, fileId)) return;
  var key = String(hash).toLowerCase() + ':' + fileId;
  var preloadUrl = AppState.currentTorrserverUrl + "/stream?link=" + hash + "&index=" + fileId + "&preload=preload";
  var headers = typeof getAuthHeaders === 'function' ? getAuthHeaders() : {};
  var options = {
    method: 'GET',
    keepalive: true,
    headers: headers
  };
  var controller = typeof AbortController === 'function' ? new AbortController() : null;
  abortPendingPreload();
  if (controller) {
    options.signal = controller.signal;
    pendingPreload = {
      key: key,
      controller: controller
    };
  }
  var done = function () {
    if (pendingPreload && pendingPreload.key === key) pendingPreload = null;
  };
  options.bgMode = 'none';
  return (window.bgFetch ? window.bgFetch(preloadUrl, options) : fetch(preloadUrl, options)).then(function (response) {
    done();
    return new Promise(function (resolve) {
      setTimeout(resolve, 4000);
    });
  }).catch(function (error) {
    done();
    return Promise.resolve();
  });
}
function getCurrentItemPoster() {
  var item = AppState.currentDetailItem;
  if (!item) return null;
  if (item.poster) return item.poster;
  if (item.poster_path && typeof getTmdbImageUrl === 'function') {
    try {
      return getTmdbImageUrl(item.poster_path, 'w342');
    } catch (e) {}
  }
  return null;
}
function buildEpisodesPlaylist(fromIndex, startSeekTime) {
  if (!Array.isArray(currentEpisodeFiles) || currentEpisodeFiles.length < 2) return null;
  if (!currentTorrentHash || !AppState.currentTorrserverUrl) return null;
  var startIndex = typeof fromIndex === 'number' && fromIndex >= 0 ? fromIndex : currentEpisodeIndex;
  if (typeof startIndex !== 'number' || startIndex < 0) return null;
  var progress = null;
  try {
    if (typeof torrentProgressCache !== 'undefined' && torrentProgressCache) progress = torrentProgressCache.get(currentTorrentHash);
  } catch (e) {}
  var byFileId = progress && progress.byFileId || {};
  var playlist = [];
  for (var i = 0; i < currentEpisodeFiles.length; i++) {
    var file = currentEpisodeFiles[i];
    if (!file || file.id === undefined || file.id === null) continue;
    var itemUrl = AppState.currentTorrserverUrl + "/stream?link=" + currentTorrentHash + "&index=" + file.id + "&play=play";
    var saved = byFileId[String(file.id)];
    var itemTime = i === startIndex && startSeekTime > 0 ? Math.floor(startSeekTime) : saved && saved.timecode > 0 ? Math.floor(saved.timecode) : 0;
    var itemDuration = saved && saved.duration > 0 ? saved.duration : 0;
    playlist.push({
      url: itemUrl,
      title: file.name || file.path || 'Серия ' + (i + 1),
      episode_title: getEpisodeLabel(file, i),
      timecode: itemTime,
      timeline: {
        hash: currentTorrentHash + '_' + file.id,
        time: itemTime,
        duration: itemDuration,
        percent: itemDuration > 0 ? Math.round(itemTime / itemDuration * 100) : 0
      },
      episode: i + 1,
      season: AppState.currentSeason || null,
      online_subs: onlineSubsPayload(currentTorrentHash, file.id)
    });
  }
  return playlist.length > 1 ? playlist : null;
}
function buildBasePlayerTitle() {
  var base = cleanPlayerBaseTitle(AppState.currentDetailItem && AppState.currentDetailItem.title);
  if (!base) return '';
  if (AppState.currentSeason) return base + ' · Сезон ' + AppState.currentSeason;
  return base;
}
function cleanPlayerBaseTitle(title) {
  return String(title || '').replace(/\[\d+\]/g, '').replace(/\[(сезон|season)[^\]]*\]/gi, '').replace(/\s+/g, ' ').trim();
}
function buildExternalPlayerTitle() {
  var base = cleanPlayerBaseTitle(AppState.currentDetailItem && AppState.currentDetailItem.title);
  if (!currentEpisodeFiles || currentEpisodeFiles.length < 2) return base || 'Видео';
  var idx = currentEpisodeIndex;
  if (typeof idx !== 'number' || idx < 0 || !currentEpisodeFiles[idx]) return base || 'Видео';
  var part = getEpisodeLabel(currentEpisodeFiles[idx], idx);
  if (AppState.currentSeason) part = 'Сезон ' + AppState.currentSeason + ', ' + part;
  if (!base) {
    var file = currentEpisodeFiles[idx];
    return file.name || file.path || part;
  }
  return base + ' · ' + part;
}
var lastExternalOpen = {
  url: null,
  time: 0
};
var EXTERNAL_OPEN_DEDUP_MS = 2500;
function openAndroidPlayer(playURL, playerData) {
  if (!window.AndroidJS || !playURL) return false;
  var playable = resolvePlayableStream(playURL);
  if (playable.error) {
    if (typeof showErrorBanner === 'function') showErrorBanner(playable.error);else if (typeof window.showToast === 'function') window.showToast(playable.error);
    return false;
  }
  if (playable.fileId && playable.url !== playURL) {
    var oldUrl = playURL;
    playURL = playable.url;
    if (playerData) {
      if (playerData.url === oldUrl) playerData.url = playURL;
      if (playerData.timeline && playerData.timeline.hash) {
        playerData.timeline.hash = String(playerData.timeline.hash).replace(/_\d+$/, '_' + playable.fileId);
      }
    }
  }
  var urlData = parseHashFromUrl(playURL);
  if (urlData) {
    currentTimecodeData.hash = urlData.torrentHash;
    currentTimecodeData.fileId = urlData.fileId;
    currentTimecodeData.timecode = playerData && playerData.timecode || 0;
  }
  if (lastExternalOpen.url === playURL && Date.now() - lastExternalOpen.time < EXTERNAL_OPEN_DEDUP_MS) return false;
  lastExternalOpen.url = playURL;
  lastExternalOpen.time = Date.now();
  if (playerData && !playerData.focus_color && window.UICustomizer && UICustomizer.getFocusColor) {
    playerData.focus_color = UICustomizer.getFocusColor();
  }
  AndroidJS.openPlayer(playURL, JSON.stringify(playerData));
  return true;
}
window.openAndroidPlayer = openAndroidPlayer;
function playInExternalPlayer(url, title, timecode, fromSearch) {
  if (!window.AndroidJS || !url) return false;
  var ref = parseStreamRef(url);
  if (ref) {
    var torrentHash = ref.hash;
    var fileId = parseInt(ref.fileId);
    var seekTime = timecode != null && timecode > 0 ? Math.floor(timecode) : 0;
    currentTimecodeData.hash = torrentHash;
    currentTimecodeData.fileId = fileId;
    currentTimecodeData.timecode = seekTime;
    var playURL = AppState.currentTorrserverUrl + "/stream?link=" + torrentHash + "&index=" + fileId + "&play=play";
    var item = AppState.currentDetailItem;
    var skipTorrent = findLoadedTorrent(torrentHash) || item;
    var playerData = {
      url: playURL,
      title: title || 'Видео',
      iptv: false,
      timecode: seekTime,
      title_base: buildBasePlayerTitle(),
      skip_api: getSkipApiBase() + '/v2/media',
      tmdb_id: getTorrentTmdbId(skipTorrent) || AppState.currentTMDB || null,
      season: getTorrentSingleSeason(skipTorrent) || AppState.currentSeason || null,
      timecode_api: SERVER_URL + '/api/timecode/save',
      client_id: localStorage.getItem('clientId') || null,
      timeline: {
        hash: torrentHash + '_' + fileId,
        time: seekTime,
        duration: 0,
        percent: 0
      },
      poster: getCurrentItemPoster(),
      id: item && (item.tmdbId || item.id) || null,
      type: item && item.media_type || (AppState.isCatalogSerials ? 'tv' : 'movie'),
      online_subs: onlineSubsPayload(torrentHash, fileId),
      online_subs_proxy: AppState.subsApiHost ? AppState.protocol + '//' + AppState.subsApiHost : ''
    };
    var canStopAtEpisodeEnd = typeof window.AndroidJS.playlistAutoNext === 'function';
    if (AppState.autoSwitchEpisodes || canStopAtEpisodeEnd) {
      var playlist = buildEpisodesPlaylist(currentEpisodeIndex, seekTime);
      if (playlist) playerData.playlist = playlist;
    }
    playerData.auto_next = !!AppState.autoSwitchEpisodes;
    playerData.auto_skip = !!AppState.autoSkipIntro;
    var authHeaders = getAuthHeaders();
    if (authHeaders && authHeaders.Authorization) playerData.headers = {
      Authorization: authHeaders.Authorization
    };
    lastPlaybackFromSearch = fromSearch;
    androidReturnHome = resumingFromHome ? torrentHash : null;
    if (!AppState.playFromHash) AppState.inSearch = 'torrents';else {
      AppState.currentDetailItem = AppState.androidBackCatalog;
      AppState.inSearch = 'catalog';
    }
    AppState.currentScreen = 'detail';
    openAndroidPlayer(playURL, playerData);
    return true;
  }
  return false;
}
var RESUME_FINISHED_SHARE = 0.92;
function isResumeFinished(resume) {
  return !!(resume && resume.duration > 0 && resume.timecode >= resume.duration * RESUME_FINISHED_SHARE);
}
window.isResumeFinished = isResumeFinished;
var resumingFromHome = false;
var androidReturnHome = null;
var androidReturnHomeTimer = null;
var androidReturnSearch = false;
function returnHomeFromAndroidPlayer() {
  AppState.playFromHash = false;
  AppState.isCatalogSearch = false;
  if (androidReturnHomeTimer) return;
  androidReturnHomeTimer = setTimeout(function () {
    androidReturnHomeTimer = null;
    var hash = androidReturnHome;
    if (hash) {
      dropTorrentToServer(hash)['catch'](function () {});
      if (torrentProgressCache.has(hash)) torrentProgressCache.delete(hash);
    }
    if (AppState.cardPlayback) {
      returnToDetailCard();
      return;
    }
    AppState.currentDetailItem = null;
    if (!window.HomeScreen) return;
    HomeScreen.show();
  }, 0);
}
function returnSearchFromAndroidPlayer() {
  AppState.isCatalogSearch = false;
  setTimeout(function () {
    androidReturnSearch = false;
    AppState.playFromHash = false;
  }, 0);
}
function searchOriginCard() {
  if (!AppState.searchLocked) return null;
  var card = AppState.androidBackCatalog || AppState.pendingDetailItem;
  return card && card.id ? card : null;
}
function returnToCardFromSearch(hash) {
  var card = searchOriginCard();
  if (!card || typeof window.hideSearchResults !== 'function') return false;
  if (hash) {
    dropTorrentToServer(hash)['catch'](function () {});
    if (torrentProgressCache.has(hash)) torrentProgressCache.delete(hash);
  }
  lastPlaybackFromSearch = false;
  androidReturnSearch = false;
  AppState.playFromHash = false;
  AppState.isCatalogSearch = false;
  AppState.isCatalogSerials = false;
  AppState.currentDetailItem = card;
  window.hideSearchResults({
    returnTo: 'detail'
  });
  return true;
}
var androidReturnCardTimer = null;
function returnCardFromAndroidPlayer(hash) {
  if (androidReturnCardTimer) return;
  androidReturnCardTimer = setTimeout(function () {
    androidReturnCardTimer = null;
    returnToCardFromSearch(hash);
  }, 0);
}
function returnToDetailCard() {
  var ctx = AppState.cardPlayback;
  AppState.cardPlayback = null;
  AppState.playFromHash = false;
  AppState.isCatalogSearch = false;
  AppState.currentDetailItem = ctx.item;
  AppState.currentScreen = 'detail';
  if (typeof Animations !== 'undefined' && typeof Animations.ensureDetailVisible === 'function') Animations.ensureDetailVisible();else getEl('detail-view').style.display = 'block';
  getEl('detail-view').scrollTop = ctx.scrollTop;
  if (typeof window.invalidateFocusCache === 'function') window.invalidateFocusCache();
  if (ctx.from && ctx.from.offsetParent !== null) focusEl(ctx.from);
}
function torrentFileList(torrent) {
  if (Array.isArray(torrent.file_stats)) return torrent.file_stats;
  if (torrent.data) {
    try {
      var data = JSON.parse(torrent.data);
      if (data.TorrServer && data.TorrServer.Files) return data.TorrServer.Files;
    } catch (e) {}
  }
  return [];
}
function findSameTitleSource(item, resume) {
  var list = AppState.torrents || [];
  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    var idMatch = String(t.title || '').match(/\[(\d+)\]/);
    var id = t.tmdbId || idMatch && idMatch[1];
    if (!id || String(id) !== String(item.id)) continue;
    var files = extractVideoFiles(torrentFileList(t));
    if (item.media_type !== 'tv') {
      var big = null;
      for (var m = 0; m < files.length; m++) if (!big || (files[m].length || 0) > (big.length || 0)) big = files[m];
      if (big) return {
        torrent: t,
        files: files,
        fileId: big.id
      };
      continue;
    }
    for (var f = 0; resume.episode && f < files.length; f++) {
      var ref = parseEpisodeRef(files[f].path);
      if (ref && ref.episode === resume.episode && (ref.season === null || ref.season === resume.season)) {
        return {
          torrent: t,
          files: files,
          fileId: files[f].id
        };
      }
    }
  }
  return null;
}
function findResumeSource(_x18, _x19) {
  return _findResumeSource.apply(this, arguments);
}
function _findResumeSource() {
  _findResumeSource = _asyncToGenerator(function* (item, resume) {
    var hash = String(resume.hash).toLowerCase();
    var pick = function (torrent) {
      var files = torrent ? extractVideoFiles(torrentFileList(torrent)) : [];
      for (var i = 0; i < files.length; i++) {
        if (String(files[i].id) === String(resume.fileId)) return {
          torrent: torrent,
          files: files,
          fileId: resume.fileId
        };
      }
      return null;
    };
    var source = pick(yield resolveTorrentWithFiles(hash, 2, 500));
    if (!source && window.MagnetStore && (yield MagnetStore.ensure(hash))) {
      source = pick(yield resolveTorrentWithFiles(hash, 3, 700));
    }
    return source || findSameTitleSource(item, resume);
  });
  return _findResumeSource.apply(this, arguments);
}
function loadResumeEpisodes(_x20, _x21) {
  return _loadResumeEpisodes.apply(this, arguments);
}
function _loadResumeEpisodes() {
  _loadResumeEpisodes = _asyncToGenerator(function* (item, resume) {
    var source = yield findResumeSource(item, resume);
    if (!source || source.files.length < 2) return null;
    var torrent = source.torrent,
      files = source.files;
    if (!torrent.tmdbId && item.id) torrent.tmdbId = String(item.id);
    if (!torrent.media_type) torrent.media_type = 'tv';
    yield ensureTorrentEpisodeMeta(torrent, files);
    var progress = yield getTorrentProgressBatch(torrent.hash, files);
    var current = source.fileId;
    if (isResumeFinished(resume)) {
      for (var i = 0; i + 1 < files.length; i++) {
        if (String(files[i].id) === String(source.fileId)) {
          current = files[i + 1].id;
          break;
        }
      }
    }
    return {
      hash: torrent.hash,
      files: files,
      progress: progress.byFileId,
      current: current
    };
  });
  return _loadResumeEpisodes.apply(this, arguments);
}
window.loadResumeEpisodes = loadResumeEpisodes;
var seriesStartCancel = null;
function fileEpisodeRef(hash, file, seasons) {
  var meta = window.getTorrentEpisodeMeta(hash, file.id);
  if (meta && meta.episode) return {
    season: meta.season,
    episode: meta.episode
  };
  var ref = parseEpisodeRef(file.path || file.name);
  if (!ref) return null;
  return {
    season: ref.season !== null ? ref.season : seasons.length === 1 ? seasons[0] : null,
    episode: ref.episode
  };
}
function pickSeriesEpisode(torrent, files, resume) {
  if (!resume) return {
    index: 0,
    seek: null
  };
  var hash = String(torrent.hash).toLowerCase();
  var finished = isResumeFinished(resume);
  var seek = Math.floor(resume.timecode) || 0;
  if (String(resume.hash).toLowerCase() === hash) {
    for (var i = 0; i < files.length; i++) {
      if (String(files[i].id) !== String(resume.fileId)) continue;
      if (!finished) return {
        index: i,
        seek: seek
      };
      return i + 1 < files.length ? {
        index: i + 1,
        seek: null
      } : null;
    }
  }
  if (!resume.episode) return null;
  var season = resume.season || 0,
    seasons = getTorrentSeasons(torrent);
  var best = -1,
    bestSeason = 0,
    bestEpisode = 0;
  for (var f = 0; f < files.length; f++) {
    var ref = fileEpisodeRef(hash, files[f], seasons);
    if (!ref) continue;
    var s = ref.season === null ? season : ref.season,
      e = ref.episode;
    var after = s > season || s === season && e > resume.episode;
    var same = s === season && e === resume.episode;
    if (!after && !(same && !finished)) continue;
    if (best === -1 || s < bestSeason || s === bestSeason && e < bestEpisode) {
      best = f;
      bestSeason = s;
      bestEpisode = e;
    }
  }
  if (best === -1) return null;
  return {
    index: best,
    seek: bestSeason === season && bestEpisode === resume.episode ? seek : null
  };
}
function pickSeasonEpisode(torrent, files, start, season) {
  var hash = String(torrent.hash).toLowerCase(),
    seasons = getTorrentSeasons(torrent);
  var refs = [],
    seen = {},
    many = false,
    first = -1,
    firstEpisode = 0,
    i;
  for (i = 0; i < files.length; i++) {
    refs[i] = fileEpisodeRef(hash, files[i], seasons);
    if (refs[i] && refs[i].season !== null) seen[refs[i].season] = true;
  }
  many = Object.keys(seen).length > 1;
  if (!many) return start || {
    index: 0,
    seek: 0
  };
  if (start && refs[start.index] && refs[start.index].season === season) return start;
  for (i = 0; i < files.length; i++) {
    if (!refs[i] || refs[i].season !== season) continue;
    if (first === -1 || refs[i].episode < firstEpisode) {
      first = i;
      firstEpisode = refs[i].episode;
    }
  }
  return {
    index: first === -1 ? 0 : first,
    seek: 0
  };
}
function findSeriesStart(_x22, _x23) {
  return _findSeriesStart.apply(this, arguments);
}
function _findSeriesStart() {
  _findSeriesStart = _asyncToGenerator(function* (torrent, item) {
    var cancelled = false;
    var onCancel = new Promise(function (resolve) {
      seriesStartCancel = function () {
        cancelled = true;
        resolve('cancelled');
      };
    });
    var files = yield Promise.race([waitSeasonFiles(torrent, function () {
      return cancelled;
    }), onCancel]);
    seriesStartCancel = null;
    if (files === 'cancelled') return files;
    if (!files.length) return null;
    var resume = window.HomeScreen ? yield HomeScreen.fetchResume({
      id: item.id,
      media_type: 'tv'
    }) : null;
    if (resume) {
      yield Promise.race([window.ensureTorrentEpisodeMeta(torrent, files), new Promise(function (resolve) {
        setTimeout(resolve, ANDROID_EPISODE_META_WAIT_MS);
      })]);
    }
    var start = pickSeriesEpisode(torrent, files, resume);
    return start ? {
      fileId: files[start.index].id,
      index: start.index,
      seek: start.seek
    } : null;
  });
  return _findSeriesStart.apply(this, arguments);
}
window.findSeriesStart = findSeriesStart;
var SEASON_FILES_WAIT_MS = 60000;
var SEASON_FILES_RETRY_MS = 1500;
function pauseMs(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}
function waitSeasonFiles(_x24, _x25) {
  return _waitSeasonFiles.apply(this, arguments);
}
function _waitSeasonFiles() {
  _waitSeasonFiles = _asyncToGenerator(function* (torrent, isCancelled) {
    var deadline = Date.now() + SEASON_FILES_WAIT_MS;
    while (!isCancelled() && Date.now() < deadline) {
      var left = deadline - Date.now();
      var list = yield Promise.race([getTorrentFilesWithCache(torrent, true), pauseMs(left).then(function () {
        return [];
      })]);
      var files = extractVideoFiles(list || []);
      if (files.length) return files;
      yield pauseMs(SEASON_FILES_RETRY_MS);
    }
    return [];
  });
  return _waitSeasonFiles.apply(this, arguments);
}
function filesHaveEpisodeNumbers(files) {
  for (var i = 0; i < files.length; i++) {
    if (!parseEpisodeRef(files[i].path || files[i].name)) return false;
  }
  return true;
}
function biggestFileIndex(files) {
  var best = 0;
  for (var i = 1; i < files.length; i++) if ((files[i].length || 0) > (files[best].length || 0)) best = i;
  return best;
}
function bestPickTitle(item) {
  var t = item && (item.title || item.name);
  if (!t && item && item.torrent && item.torrent[0]) t = item.torrent[0].name;
  if (!t) {
    var head = getEl('detail-title-text');
    t = head ? String(head.textContent || '').trim() : '';
  }
  return t || '';
}
function playBestPick(_x26, _x27, _x28, _x29) {
  return _playBestPick.apply(this, arguments);
}
function _playBestPick() {
  _playBestPick = _asyncToGenerator(function* (item, row, season, from) {
    if (typeof ensureTorrserverOnline === 'function' && !(yield ensureTorrserverOnline())) return 'offline';
    var hash = String(row.hash).toLowerCase();
    var serial = item.media_type === 'tv';
    var overlay = getEl('playback-overlay'),
      overlayText = document.querySelector('.playback-text');
    var withWindow = !!AppState.preloadBeforePlay && typeof runPlaybackPreload === 'function';
    var cancelled = false;
    var onCancel = new Promise(function (resolve) {
      seriesStartCancel = function () {
        cancelled = true;
        resolve('cancelled');
      };
    });
    if (withWindow) {
      runPlaybackPreload(hash, null, bestPickTitle(item)).then(function (ok) {
        if (ok === false && seriesStartCancel) seriesStartCancel();
      });
    } else {
      overlay.classList.add('active');
      if (overlayText) overlayText.textContent = 'Запуск...';
    }
    try {
      var poster = typeof window.getCatalogKnownPosterUrl === 'function' ? window.getCatalogKnownPosterUrl(item, null) : null;
      var resumeRead = serial && window.HomeScreen ? Promise.resolve(HomeScreen.fetchResume({
        id: item.id,
        media_type: 'tv'
      }))['catch'](function () {
        return null;
      }) : Promise.resolve(null);
      var adding = window.addBestPickToServer(item, row, poster);
      adding.then(function () {
        if (cancelled && typeof dropTorrentToServer === 'function') dropTorrentToServer(hash)['catch'](function () {});
      }, function () {});
      var torrent = yield Promise.race([adding, onCancel]);
      if (torrent === 'cancelled') return torrent;
      if (!torrent) {
        if (withWindow) endPlaybackPreloadWait();
        return 'failed';
      }
      var files = yield Promise.race([waitSeasonFiles(torrent, function () {
        return cancelled;
      }), onCancel]);
      if (files === 'cancelled') return files;
      if (!files.length) {
        seriesStartCancel = null;
        if (withWindow) endPlaybackPreloadWait();else if (typeof dropTorrentToServer === 'function') dropTorrentToServer(hash)['catch'](function () {});
        return 'dead';
      }
      var start = {
        index: biggestFileIndex(files),
        seek: null
      };
      if (serial) {
        var resume = yield Promise.race([resumeRead, onCancel]);
        if (resume === 'cancelled') return resume;
        if (!filesHaveEpisodeNumbers(files)) {
          yield Promise.race([window.ensureTorrentEpisodeMeta(torrent, files), pauseMs(ANDROID_EPISODE_META_WAIT_MS), onCancel]);
          if (cancelled) return 'cancelled';
        }
        start = pickSeasonEpisode(torrent, files, pickSeriesEpisode(torrent, files, resume), season);
      }
      seriesStartCancel = null;
      overlay.classList.remove('active');
      if (window.addToWatchHistory) {
        Promise.resolve(window.addToWatchHistory(String(item.id), bestPickTitle(item), item.media_type, poster))['catch'](function () {});
      }
      var started = yield playOpenedTorrent(item, torrent, files, start.index, start.seek, from);
      if (withWindow) endPlaybackPreloadWait();
      return started === false ? 'cancelled' : 'started';
    } finally {
      seriesStartCancel = null;
      overlay.classList.remove('active');
      if (overlayText) overlayText.textContent = 'Воспроизведение...';
    }
  });
  return _playBestPick.apply(this, arguments);
}
window.playBestPick = playBestPick;
function playOpenedTorrent(_x30, _x31, _x32, _x33, _x34, _x35) {
  return _playOpenedTorrent.apply(this, arguments);
}
function _playOpenedTorrent() {
  _playOpenedTorrent = _asyncToGenerator(function* (item, torrent, videoFiles, idx, seek, from) {
    var hash = String(torrent.hash).toLowerCase();
    if (!torrent.tmdbId && item.id) torrent.tmdbId = String(item.id);
    if (!torrent.media_type && item.media_type) torrent.media_type = item.media_type;
    if (typeof knownTorrentMeta !== 'undefined' && knownTorrentMeta && item.id) {
      var known = knownTorrentMeta.get(hash) || {};
      knownTorrentMeta.set(hash, {
        id: known.id || String(item.id),
        mediaType: known.mediaType || item.media_type,
        poster: known.poster || torrent.poster || null,
        title: known.title || torrent.title
      });
    }
    var fromCard = !!from;
    AppState.cardPlayback = fromCard ? {
      item: item,
      from: from,
      scrollTop: getEl('detail-view').scrollTop
    } : null;
    AppState.currentDetailItem = torrent;
    AppState.androidBackCatalog = item;
    AppState.isCatalogSerials = false;
    if (window.AndroidJS) AppState.playFromHash = true;
    var playUrl = AppState.currentTorrserverUrl + '/play/' + hash + '/' + videoFiles[idx].id;
    var overlay = getEl('playback-overlay');
    if (overlay) overlay.classList.remove('active');
    resumingFromHome = true;
    var started;
    try {
      started = yield startHLSPlayback(playUrl, seek, false, idx);
    } finally {
      resumingFromHome = false;
    }
    if (window.AndroidJS) AppState.currentScreen = fromCard ? 'detail' : 'home';
    if (started === false && fromCard) {
      AppState.cardPlayback = null;
      AppState.currentDetailItem = item;
    }
    return started;
  });
  return _playOpenedTorrent.apply(this, arguments);
}
function resumeWatching(_x36, _x37, _x38) {
  return _resumeWatching.apply(this, arguments);
}
function _resumeWatching() {
  _resumeWatching = _asyncToGenerator(function* (item, resume, opts) {
    if (!resume || !resume.hash) return 'missing';
    if (typeof ensureTorrserverOnline === 'function' && !(yield ensureTorrserverOnline())) return 'offline';
    var overlay = getEl('playback-overlay');
    if (overlay) overlay.classList.add('active');
    try {
      var source = yield findResumeSource(item, resume);
      if (!source) return 'missing';
      var torrent = source.torrent,
        videoFiles = source.files;
      var hash = String(torrent.hash).toLowerCase();
      var idx = -1;
      for (var i = 0; i < videoFiles.length; i++) {
        if (String(videoFiles[i].id) === String(source.fileId)) {
          idx = i;
          break;
        }
      }
      if (idx === -1) return 'missing';
      var seek = Math.floor(resume.timecode) || 0;
      if (isResumeFinished(resume)) {
        if (item.media_type !== 'tv' || idx + 1 >= videoFiles.length) return 'last';
        idx++;
        seek = null;
      }
      var started = yield playOpenedTorrent(item, torrent, videoFiles, idx, seek, opts && opts.card);
      return started === false ? 'missing' : 'started';
    } finally {
      if (overlay) overlay.classList.remove('active');
    }
  });
  return _resumeWatching.apply(this, arguments);
}
window.resumeWatching = resumeWatching;
var APPLE_PLAYERS = {
  apple_tv: [['inner', 'Встроенный TorrStream'], ['tvospro', 'tvOS Pro', 'lampa://video?player=tvospro&src=${url}&playlist=${playlist}'], ['tvos', 'tvOS Universal', 'lampa://video?player=tvos&src=${url}&playlist=${playlist}'], ['tvosl', 'tvOS Online', 'lampa://video?player=tvosav&src=${url}&playlist=${playlist}'], ['tvosSelect', 'Внешний — выбор при запуске', 'lampa://video?player=lists&src=${url}&playlist=${playlist}'], ['vlc', 'VLC', 'vlc-x-callback://x-callback-url/stream?url=${url}'], ['infuse', 'Infuse', 'infuse://x-callback-url/play?x-success=lampa://infuseDidFinish&x-error=lampa://infuseDidFail&url=${url}&playlist=${playlist}'], ['senplayer', 'SenPlayer', 'SenPlayer://x-callback-url/play?url=${url}'], ['vidhub', 'Vidhub', 'open-vidhub://x-callback-url/open?url=${url}'], ['svplayer', 'SVPlayer', 'svplayer://x-callback-url/stream?url=${url}']],
  apple: [['inner', 'Встроенный TorrStream'], ['vlc', 'VLC', 'vlc://${furl}'], ['nplayer', 'nPlayer', 'nplayer-${furl}'], ['infuse', 'Infuse', 'infuse://x-callback-url/play?url=${url}'], ['senplayer', 'SenPlayer', 'senplayer://x-callback-url/play?url=${url}'], ['vidhub', 'Vidhub', 'open-vidhub://x-callback-url/open?&url=${url}'], ['svplayer', 'SVPlayer', 'svplayer://x-callback-url/stream?url=${url}'], ['tracyplayer', 'TracyPlayer', 'tracy://open?url=${url}']],
  macos: [['inner', 'Встроенный TorrStream'], ['mpv', 'mpv', 'mpv://${_url}'], ['iina', 'IINA', 'iina://weblink?url=${url}'], ['nplayer', 'nPlayer', 'nplayer-${_url}'], ['infuse', 'Infuse', 'infuse://x-callback-url/play?url=${url}'], ['senplayer', 'SenPlayer', 'senplayer://x-callback-url/play?url=${url}']]
};
var APPLE_PLAYER_KEY = 'applePlayer';
function getApplePlayers() {
  var list = AppState.applePlatform && APPLE_PLAYERS[AppState.applePlatform];
  if (!list) return null;
  return list.map(function (p) {
    return {
      id: p[0],
      name: p[1],
      template: p[2] || null
    };
  });
}
window.getApplePlayers = getApplePlayers;
function getApplePlayer() {
  var list = getApplePlayers();
  if (!list) return null;
  var id = null;
  try {
    id = localStorage.getItem(APPLE_PLAYER_KEY);
  } catch (e) {}
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return list[0];
}
window.getApplePlayer = getApplePlayer;
function setApplePlayer(id) {
  try {
    localStorage.setItem(APPLE_PLAYER_KEY, id);
  } catch (e) {}
}
window.setApplePlayer = setApplePlayer;
function appleStreamUrl(hash, fileId) {
  var u = AppState.currentTorrserverUrl + '/stream?link=' + hash + '&index=' + fileId + '&play=play';
  if (AppState.authEnabled && AppState.authLogin) {
    u = u.replace(/^(https?:\/\/)/, '$1' + encodeURIComponent(AppState.authLogin) + ':' + encodeURIComponent(AppState.authPassword || '') + '@');
  }
  return u;
}
function buildAppleExternalUrl(originalUrl, seekTime) {
  var player = getApplePlayer();
  if (!player || !player.template || !AppState.currentTorrserverUrl) return null;
  var ref = parseStreamRef(originalUrl);
  if (!ref) return null;
  var furl = appleStreamUrl(ref.hash, ref.fileId);
  var playlist = '';
  if (AppState.autoSwitchEpisodes) {
    var episodes = buildEpisodesPlaylist(currentEpisodeIndex, seekTime || 0);
    if (episodes) {
      episodes.forEach(function (e) {
        var m = /[?&]index=(\d+)/.exec(e.url);
        if (m) e.url = appleStreamUrl(ref.hash, m[1]);
      });
      playlist = encodeURIComponent(JSON.stringify(episodes));
    }
  }
  return {
    player: player,
    ref: ref,
    url: player.template.replace('${url}', encodeURIComponent(furl)).replace('${_url}', encodeURI(furl)).replace('${furl}', furl).replace('${playlist}', playlist)
  };
}
window.buildAppleExternalUrl = buildAppleExternalUrl;
function openAppleExternalPlayer(originalUrl, title, seekTime) {
  var built = buildAppleExternalUrl(originalUrl, seekTime);
  if (!built) return false;
  if (lastExternalOpen.url === built.url && Date.now() - lastExternalOpen.time < EXTERNAL_OPEN_DEDUP_MS) return true;
  lastExternalOpen.url = built.url;
  lastExternalOpen.time = Date.now();
  currentTimecodeData.hash = built.ref.hash;
  currentTimecodeData.fileId = built.ref.fileId;
  currentTimecodeData.timecode = seekTime || 0;
  console.log('🍎 Внешний плеер ' + built.player.name + ': ' + (title || ''));
  if (AppState.applePlatform !== 'apple_tv' && navigator.userActivation && !navigator.userActivation.isActive) {
    showAppleLaunchDialog(built.player.name, built.url);
    return true;
  }
  window.location.assign(built.url);
  if (AppState.applePlatform !== 'apple_tv') watchAppleLaunch(built.player.name, built.url);
  return true;
}
var APPLE_LAUNCH_CHECK_MS = 2000;
function watchAppleLaunch(name, url) {
  var left = false;
  var onHide = function (e) {
    if (e.type === 'pagehide' || document.hidden) left = true;
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);
  setTimeout(function () {
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onHide);
    if (!left && !document.hidden) showAppleLaunchDialog(name, url);
  }, APPLE_LAUNCH_CHECK_MS);
}
function closeAppleLaunchDialog() {
  var el = document.getElementById('apple-launch-dialog');
  if (el && el.parentNode) el.parentNode.removeChild(el);
}
function showAppleLaunchDialog(name, url) {
  closeAppleLaunchDialog();
  if (typeof releasePreloadScreen === 'function') releasePreloadScreen(true);
  var root = document.createElement('div');
  root.id = 'apple-launch-dialog';
  root.innerHTML = '<div class="apple-launch-box">' + '<div class="apple-launch-title"></div>' + '<div class="apple-launch-text">Плеер не открылся сам. Нажмите кнопку — если он установлен, откроется.</div>' + '<div class="apple-launch-actions">' + '<a class="apple-launch-btn apple-launch-open"></a>' + '<button type="button" class="apple-launch-btn apple-launch-cancel">Отмена</button>' + '</div></div>';
  root.querySelector('.apple-launch-title').textContent = name;
  var open = root.querySelector('.apple-launch-open');
  open.textContent = 'Открыть в ' + name;
  open.href = url;
  open.addEventListener('click', function () {
    setTimeout(closeAppleLaunchDialog, 300);
  });
  root.querySelector('.apple-launch-cancel').addEventListener('click', closeAppleLaunchDialog);
  root.addEventListener('click', function (e) {
    if (e.target === root) closeAppleLaunchDialog();
  });
  document.body.appendChild(root);
  try {
    open.focus();
  } catch (e) {}
}
function startGstPlayback(m3u8Url) {
  var videoPlayer = getEl('video-player');
  if (!videoPlayer) return false;
  if (Hls.isSupported()) {
    AppState.hls = createHlsInstance({
      maxBufferSize: 80 * 1024 * 1024,
      maxBufferLength: 30,
      backBufferLength: 20,
      startLevel: -1,
      abrEwmaDefaultEstimate: 500000,
      fragLoadingTimeOut: 10000,
      manifestLoadingTimeOut: 10000,
      enableWorker: true,
      progressive: true
    });
    AppState.hls.loadSource(m3u8Url);
    AppState.hls.attachMedia(videoPlayer);
    return true;
  }
  return false;
}
function createHlsInstance(configOverrides) {
  var defaultConfig = {
    enableABR: false,
    startLevel: 0,
    maxBufferLength: 15,
    maxMaxBufferLength: 25,
    startFragPrefetch: true,
    fragLoadingTimeOut: 15000,
    manifestLoadingTimeOut: 10000,
    enableWorker: true,
    progressive: true,
    maxBufferSize: 60 * 1000 * 1000,
    maxBufferHole: 0.5
  };
  if (AppState.dvPreferred) defaultConfig.videoPreference = {
    preferHDR: true
  };
  return new Hls(Object.assign({}, defaultConfig, configOverrides || {}));
}
function resetPlaybackState() {
  cancelCurrentPlayback();
  destroyHls();
  var videoPlayer = getEl('video-player');
  if (videoPlayer) videoPlayer.removeEventListener('ended', handleVideoEnded);
}
function capturePreplaybackScreen() {
  var dv = getEl('detail-view'),
    ts = getEl('torrserver-section'),
    cs = getEl('config-screen');
  return {
    screen: AppState.currentScreen,
    detail: dv ? dv.style.display : null,
    torrserver: ts ? ts.style.display : null,
    config: cs ? cs.style.display : null
  };
}
function restorePreplaybackScreen(snapshot) {
  if (!snapshot) return;
  var ps = getEl('player-screen');
  if (ps) ps.style.display = 'none';
  var dv = getEl('detail-view'),
    ts = getEl('torrserver-section'),
    cs = getEl('config-screen');
  if (dv && snapshot.detail !== null) dv.style.display = snapshot.detail;
  if (ts && snapshot.torrserver !== null) ts.style.display = snapshot.torrserver;
  if (cs && snapshot.config !== null) cs.style.display = snapshot.config;
  AppState.currentScreen = snapshot.screen;
  hidePlayerLoading();
  setTimeout(function () {
    if (typeof updateFocusableElements === 'function') updateFocusableElements();
    if (typeof setFocus === 'function' && typeof focusableElements !== 'undefined' && focusableElements.length) setFocus(0);
  }, 80);
}
function transitionToPlayerScreen() {
  if (window.Nav) Nav.push('player', {
    key: 'player'
  });
  AppState.currentScreen = 'player';
  if (typeof window.startBufferUpdates === 'function') window.startBufferUpdates();
  getEl('config-screen').style.display = 'none';
  getEl('torrserver-section').style.display = 'none';
  getEl('detail-view').style.display = 'none';
  if (typeof Animations !== 'undefined' && typeof Animations.hideDetailLoading === 'function') Animations.hideDetailLoading(true);
  getEl('player-screen').style.display = 'block';
  clearFocused();
  if (typeof updateClock === 'function') updateClock();
  var controlsContainer = getEl('controls-container');
  if (controlsContainer) controlsContainer.classList.add('idle-hidden');
  if (typeof currentFocusIndex !== 'undefined') currentFocusIndex = 0;
  if (typeof updateFocusableElements === 'function') updateFocusableElements();
}
var DEFAULT_PLAYER_HINT = '← Назад для выхода';
function showPlayerHint(message, durationMs) {
  var playerHint = getEl('player-hint');
  if (!playerHint) return;
  playerHint.textContent = message || DEFAULT_PLAYER_HINT;
  playerHint.style.opacity = '1';
  playerHint.classList.toggle('player-hint-alert', !!message);
  if (AppState.hintTimeout) clearTimeout(AppState.hintTimeout);
  AppState.hintTimeout = setTimeout(function () {
    playerHint.style.opacity = '0';
    playerHint.classList.remove('player-hint-alert');
    playerHint.textContent = DEFAULT_PLAYER_HINT;
  }, durationMs || 4000);
}
function preparePlaybackMetadata(_x39, _x40, _x41, _x42) {
  return _preparePlaybackMetadata.apply(this, arguments);
}
function _preparePlaybackMetadata() {
  _preparePlaybackMetadata = _asyncToGenerator(function* (originalUrl, initialSeek, audioTrack, signal) {
    var match = originalUrl.match(/\/play\/([a-fA-F0-9]+)\/(\d+)\/?/);
    if (!match) {
      console.error('❌ Некорректный URL для воспроизведения:', originalUrl);
      if (typeof window.showErrorBanner === 'function') {
        window.showErrorBanner('Не удалось начать воспроизведение', 'Некорректная ссылка на видео');
      } else alert('Ошибка: Некорректная ссылка на видео');
      return null;
    }
    currentTimecodeData.hash = match[1];
    currentTimecodeData.fileId = match[2];
    currentTimecodeData.timecode = 0;
    noteCollectionPlayback(currentTimecodeData.hash, currentTimecodeData.fileId);
    var wantTimecode = initialSeek === null;
    var requests = [loadPlaybackPrepare(currentTimecodeData.hash, currentTimecodeData.fileId, wantTimecode), getFileNameByHash(currentTimecodeData.hash, currentTimecodeData.fileId)];
    if (initialSeek === null || initialSeek === 0) preloadTorrents(currentTimecodeData.hash, currentTimecodeData.fileId);
    var promiseResults = yield Promise.all(requests);
    if (signal.aborted) return null;
    var prepared = promiseResults[0];
    var fileName = promiseResults[1];
    var fileInfo = prepared.fileInfo;
    var savedAudioTrack = prepared.audioTrack;
    var savedSubTrack = prepared.subtitleTrack;
    var savedTimecode = prepared.timecode || null;
    directProbe.serverInfo = fileInfo ? {
      hash: currentTimecodeData.hash,
      fileId: currentTimecodeData.fileId,
      info: fileInfo
    } : null;
    if (fileInfo && fileInfo.audio) {
      currentAudioTracks = fileInfo.audio;
      currentAudioTrack = audioTrack !== null ? audioTrack : 0;
    }
    if (fileInfo && fileInfo.subtitles) currentSubTracks = fileInfo.subtitles;
    if (savedAudioTrack !== null && savedAudioTrack < currentAudioTracks.length) {
      currentAudioTrack = savedAudioTrack;
      if (audioTrack !== savedAudioTrack) audioTrack = savedAudioTrack;
    } else currentAudioTrack = audioTrack !== null ? audioTrack : 0;
    if (savedSubTrack !== null && savedSubTrack < currentSubTracks.length) currentSubtitleTrack = savedSubTrack;
    var seekTime = initialSeek;
    if (seekTime === null && wantTimecode) seekTime = savedTimecode > 0 ? savedTimecode : 0;
    return {
      match: match,
      fileInfo: fileInfo,
      savedAudioTrack: savedAudioTrack,
      fileName: fileName,
      savedSubTrack: savedSubTrack,
      savedTimecode: savedTimecode,
      seekTime: seekTime,
      audioTrack: audioTrack
    };
  });
  return _preparePlaybackMetadata.apply(this, arguments);
}
function initGstPlayback(_x43, _x44, _x45) {
  return _initGstPlayback.apply(this, arguments);
}
function _initGstPlayback() {
  _initGstPlayback = _asyncToGenerator(function* (metadata, initialSeek, signal) {
    var playURL = AppState.currentTorrserverUrl + "/gst/" + currentTimecodeData.hash + "/master.m3u8?index=" + currentTimecodeData.fileId + "&audio=" + currentAudioTrack;
    var videoPlayer = getEl('video-player');
    destroyHls();
    var isTimeUpdated = false;
    var seekExecuted = false;
    var executeSeek = function () {
      if (seekExecuted) return;
      if (initialSeek > 0) {
        seekExecuted = true;
        try {
          var relativeTime = initialSeek - (AppState.seekOffset || 0);
          if (relativeTime > 0) videoPlayer.currentTime = parseInt(relativeTime);
        } catch (e) {}
        setTimeout(function () {
          seekStream(parseInt(initialSeek - (AppState.seekOffset || 0)), 'slider');
        }, 800);
        setTimeout(function () {
          if (Math.abs(videoPlayer.currentTime + (AppState.seekOffset || 0) - initialSeek) > 2) seekStream(parseInt(initialSeek - (AppState.seekOffset || 0)), 'slider');
        }, 2000);
      }
    };
    var timeUpdateHandler = function () {
      if (!isTimeUpdated && videoPlayer.currentTime > 0) {
        isTimeUpdated = true;
        hidePlayerLoading();
        executeSeek();
        videoPlayer.removeEventListener('timeupdate', timeUpdateHandler);
      }
    };
    videoPlayer.addEventListener('timeupdate', timeUpdateHandler);
    var canPlayHandler = function () {
      if (!isTimeUpdated && initialSeek > 0 && !seekExecuted) {
        try {
          var relativeTime = initialSeek - (AppState.seekOffset || 0);
          if (relativeTime > 0) videoPlayer.currentTime = parseInt(relativeTime);
        } catch (e) {}
        setTimeout(function () {
          if (!seekExecuted) {
            seekExecuted = true;
            seekStream(parseInt(initialSeek - (AppState.seekOffset || 0)), 'slider');
          }
        }, 300);
      }
    };
    videoPlayer.addEventListener('canplay', canPlayHandler);
    AppState._loadingTimeout = setTimeout(function () {
      if (!isTimeUpdated) {
        hidePlayerLoading();
        if (initialSeek > 0 && !seekExecuted) {
          seekExecuted = true;
          try {
            var relativeTime = initialSeek - (AppState.seekOffset || 0);
            if (relativeTime > 0) videoPlayer.currentTime = parseInt(relativeTime);
          } catch (e) {}
          setTimeout(function () {
            seekStream(parseInt(initialSeek - (AppState.seekOffset || 0)), 'slider');
          }, 500);
        }
        videoPlayer.removeEventListener('timeupdate', timeUpdateHandler);
        videoPlayer.removeEventListener('canplay', canPlayHandler);
      }
    }, LOADING_TIMEOUT_MS);
    if (Hls.isSupported()) {
      AppState.hls = createHlsInstance({
        maxBufferLength: 20,
        maxMaxBufferLength: 40,
        startFragPrefetch: false,
        fragLoadingTimeOut: 20000,
        manifestLoadingTimeOut: 20000,
        enableWorker: false,
        cache: true
      });
      AppState.hls.loadSource(playURL);
      AppState.hls.attachMedia(videoPlayer);
      var manifestHandler = function () {
        videoPlayer.play()['catch'](function (err) {
          videoPlayer.muted = true;
          videoPlayer.play()['catch'](function () {});
          restoreSoundOnGesture();
        });
        startTimecodeSaving();
        resetMouseIdleTimer();
        startNearEndCheck();
        startHeartbeat();
        startTorrentStatsUpdates();
        AppState.hls.off(Hls.Events.MANIFEST_PARSED, manifestHandler);
      };
      AppState.hls.on(Hls.Events.MANIFEST_PARSED, manifestHandler);
      var gstNetworkRetries = 0;
      AppState.hls.on(Hls.Events.ERROR, function (event, data) {
        if (data.fatal) {
          hidePlayerLoading();
          videoPlayer.removeEventListener('timeupdate', timeUpdateHandler);
          videoPlayer.removeEventListener('canplay', canPlayHandler);
          clearTimeout(AppState._loadingTimeout);
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            if (signal.aborted) return;
            if (++gstNetworkRetries > MAX_HLS_NETWORK_RETRIES) {
              showPlaybackUnavailableBanner('gst: сеть не отвечает после ' + MAX_HLS_NETWORK_RETRIES + ' попыток');
              if (typeof showDetailView === 'function') showDetailView();
              return;
            }
            showPlayerLoading('Обрыв связи, попытка ' + gstNetworkRetries + ' из ' + MAX_HLS_NETWORK_RETRIES + '...', null);
            AppState.hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) AppState.hls.recoverMediaError();
        }
      });
      AppState._timeUpdateHandler = timeUpdateHandler;
      AppState._canPlayHandler = canPlayHandler;
      AppState._seekExecuted = seekExecuted;
      showPlayerLoading('Подготовка потока...', null);
    } else throw new Error('Устройство не поддерживает HLS');
  });
  return _initGstPlayback.apply(this, arguments);
}
var directPlaybackDiag = {
  file: '',
  audio: null,
  text: null,
  kinds: '',
  probe: '',
  subs: '',
  local: ''
};
window.directPlaybackDiag = directPlaybackDiag;
function updateDirectTrackDiag(videoPlayer) {
  var a = videoPlayer && videoPlayer.audioTracks,
    t = videoPlayer && videoPlayer.textTracks;
  directPlaybackDiag.audio = a ? a.length : 'нет audioTracks';
  directPlaybackDiag.text = t ? t.length : 'нет textTracks';
  var kinds = [];
  if (t) for (var i = 0; i < t.length; i++) kinds.push((t[i].kind || '?') + (t[i].language ? '/' + t[i].language : ''));
  directPlaybackDiag.kinds = kinds.join(', ');
}
function initTranscodingOffPlayback(_x46, _x47, _x48) {
  return _initTranscodingOffPlayback.apply(this, arguments);
}
function _initTranscodingOffPlayback() {
  _initTranscodingOffPlayback = _asyncToGenerator(function* (initialSeek, signal, knownFileName) {
    var fileName = knownFileName || null;
    var playURL = AppState.currentTorrserverUrl + '/stream' + (fileName ? '/' + encodeURIComponent(fileName) : '') + '?link=' + currentTimecodeData.hash + '&index=' + currentTimecodeData.fileId + '&play';
    directPlaybackDiag.file = fileName || 'без имени';
    directPlaybackDiag.audio = null;
    directPlaybackDiag.text = null;
    directPlaybackDiag.kinds = '';
    directPlaybackDiag.probe = '';
    directPlaybackDiag.subs = '';
    var videoPlayer = getEl('video-player');
    destroyHls();
    if (window.TizenAVPlay && TizenAVPlay.enabled()) TizenAVPlay.attach(videoPlayer);
    resetNativeSubtitles();
    currentSubTracks = [];
    renderSubtitleTracks();
    listenNativeTextTracks(videoPlayer);
    AppState.seekOffset = 0;
    AppState.expectedDuration = null;
    AppState.originalDuration = null;
    showPlayerLoading('Подготовка потока...', null);
    var started = false;
    var startPlayback = function () {
      if (started || signal.aborted) return;
      started = true;
      if (AppState._loadingTimeout) {
        clearTimeout(AppState._loadingTimeout);
        AppState._loadingTimeout = null;
      }
      videoPlayer.removeEventListener('canplay', onCanPlay);
      if (!AppState.tizenApp) hidePlayerLoading();
      if (nativeAudioPref >= 0 && AppState.platform !== 'webos') {
        var lateAudio = applyNativeAudioPref(videoPlayer);
        if (lateAudio >= 0) {
          var lateTracks = collectNativeAudioTracks(videoPlayer);
          if (lateTracks.length && !probeAudio.on) currentAudioTracks = lateTracks;
          currentAudioTrack = lateAudio;
          renderAudioTracks();
        }
      }
      if (initialSeek > 0) {
        try {
          videoPlayer.currentTime = initialSeek;
        } catch (e) {}
      }
      videoPlayer.play()['catch'](function () {
        videoPlayer.muted = true;
        videoPlayer.play()['catch'](function () {});
        restoreSoundOnGesture();
      });
      videoPlayer.muted = false;
      restoreSoundOnGesture();
      startTimecodeSaving();
      resetMouseIdleTimer();
      startNearEndCheck();
      startHeartbeat();
      startTorrentStatsUpdates();
    };
    var detachDirectListeners = function () {
      videoPlayer.removeEventListener('loadedmetadata', onLoadedMetadata);
      videoPlayer.removeEventListener('canplay', onCanPlay);
      videoPlayer.removeEventListener('error', onError);
      videoPlayer.removeEventListener('playing', onPlaying);
    };
    var onPlaying = function () {
      videoPlayer.removeEventListener('playing', onPlaying);
      hidePlayerLoading();
    };
    var onLoadedMetadata = function () {
      videoPlayer.removeEventListener('loadedmetadata', onLoadedMetadata);
      AppState.expectedDuration = videoPlayer.duration;
      AppState.originalDuration = videoPlayer.duration;
      forceUpdateDuration(videoPlayer.duration, videoPlayer.duration, 0);
      var nativeTracks = webosAudio.mode || probeAudio.on ? [] : collectNativeAudioTracks(videoPlayer);
      if (nativeTracks.length) {
        currentAudioTracks = nativeTracks;
        var enabled = applyNativeAudioPref(videoPlayer);
        if (enabled < 0) {
          for (var i = 0; i < videoPlayer.audioTracks.length; i++) {
            if (videoPlayer.audioTracks[i].enabled) {
              enabled = i;
              break;
            }
          }
        }
        currentAudioTrack = enabled >= 0 ? enabled : 0;
        renderAudioTracks();
      }
      refreshNativeSubtitles(videoPlayer);
      applyDirectProbe();
    };
    var onCanPlay = function () {
      startPlayback();
    };
    var onError = function () {
      detachDirectListeners();
      if (signal.aborted || AppState.currentScreen !== 'player') return;
      hidePlayerLoading();
      if (typeof window.showErrorBanner === 'function') {
        window.showErrorBanner('Файл не воспроизводится напрямую', 'TorrServer не отдал поток либо кодек/контейнер не поддерживается устройством. ' + 'Попробуйте перезапустить контент, выбрать другую раздачу или включить перекодирование.');
      } else alert('Файл не воспроизводится напрямую: кодек/контейнер не поддерживается устройством');
    };
    videoPlayer.addEventListener('loadedmetadata', onLoadedMetadata);
    videoPlayer.addEventListener('canplay', onCanPlay);
    videoPlayer.addEventListener('error', onError);
    if (AppState.tizenApp) videoPlayer.addEventListener('playing', onPlaying);
    AppState._directPlaybackDetach = detachDirectListeners;
    AppState._loadingTimeout = setTimeout(function () {
      if (!started && !signal.aborted) startPlayback();
    }, LOADING_TIMEOUT_MS);
    var staleMediaId = videoPlayer.mediaId;
    videoPlayer.src = playURL;
    videoPlayer.load();
    webosSubsStart(videoPlayer, staleMediaId);
    directProbeStart();
    AppState.nativeVideoPlayer = videoPlayer;
    if (AppState.tizenApp) showPlayerLoading('Воспроизведение...', null);else hidePlayerLoading();
  });
  return _initTranscodingOffPlayback.apply(this, arguments);
}
function initServerProxyPlayback(_x49, _x50, _x51) {
  return _initServerProxyPlayback.apply(this, arguments);
}
function _initServerProxyPlayback() {
  _initServerProxyPlayback = _asyncToGenerator(function* (metadata, initialSeek, signal) {
    var seekParam = initialSeek && initialSeek > 0 ? '&start=' + initialSeek.toFixed(2) : '';
    var durationParam = metadata.fileInfo.duration && metadata.fileInfo.duration > 0 ? '&duration=' + metadata.fileInfo.duration.toFixed(0) : '';
    var audioParam = metadata.audioTrack !== null && metadata.audioChosen !== false ? '&audio=' + metadata.audioTrack : '';
    var subParam = currentSubtitleTrack >= 0 ? '&sub=' + currentSubtitleTrack : '';
    var multiChannelParam = AppState.multiChannelEnabled === true ? '&multiChannel=true' : '';
    var savedClientId = localStorage.getItem('clientId');
    var dvParam = '&dv=' + (AppState.dvPreferred ? 'true' : 'false');
    var streamUrl = SERVER_URL + '/hls/stream?url=' + encodeURIComponent(AppState.videoUrl) + seekParam + audioParam + multiChannelParam + '&clientId=' + encodeURIComponent(savedClientId) + durationParam + subParam + dvParam + '&tracks=1';
    var response;
    try {
      response = yield fetchWithTimeout(streamUrl, {
        signal: signal
      }, PLAYER_FETCH_TIMEOUT_MS);
    } catch (e) {
      if (signal.aborted) throw e;
      if (e && e.name === 'AbortError') throw new Error('Сервер не создал поток за ' + Math.round(PLAYER_FETCH_TIMEOUT_MS / 1000) + ' с');
      throw e;
    }
    if (!response.ok) throw new Error('HTTP ' + response.status);
    var data = yield response.json();
    if (!data.success) throw new Error(data.error || 'Ошибка создания потока');
    AppState.currentStreamId = data.streamId;
    AppState.expectedDuration = data.duration;
    AppState.originalDuration = data.originalDuration || data.duration;
    AppState.seekOffset = data.seekOffset || initialSeek || 0;
    AppState.lastSuccessfulSeek = AppState.seekOffset;
    applyServerTracks(data.tracks);
    if (data.tracks && (metadata.audioTrack === null || metadata.audioChosen === false) && typeof data.tracks.selectedAudio === 'number') {
      currentAudioTrack = data.tracks.selectedAudio;
      renderAudioTracks();
    }
    var videoPlayer = getEl('video-player');
    if (Hls.isSupported()) {
      AppState.hls = createHlsInstance();
      attachHlsEventListeners(AppState.hls, videoPlayer, signal, initialSeek);
      AppState.hls.loadSource(data.playlistUrl);
      AppState.hls.attachMedia(videoPlayer);
    } else throw new Error('Ваш браузер не поддерживает HLS');
  });
  return _initServerProxyPlayback.apply(this, arguments);
}
function attachHlsEventListeners(hls, videoPlayer, signal, initialSeek) {
  var isPlaybackCancelled = false;
  var manifestParsedHandler = function () {
    if (signal.aborted || isPlaybackCancelled) return;
    applyServerTrackSelection();
    forceUpdateDuration(AppState.expectedDuration, AppState.originalDuration, AppState.seekOffset);
    videoPlayer.currentTime = 0;
    videoPlayer.pause();
    startTorrentStatsUpdates();
    if (thisisseek) {
      hidePlayerLoading();
      if (!signal.aborted && !isPlaybackCancelled) videoPlayer.play()['catch'](function (err) {
        videoPlayer.muted = true;
        videoPlayer.play()['catch'](function () {});
        restoreSoundOnGesture();
      });
      videoPlayer.muted = false;
      restoreSoundOnGesture();
      startTimecodeSaving();
      resetMouseIdleTimer();
      if (nearEndCheckInterval) clearInterval(nearEndCheckInterval);
      startNearEndCheck();
      startHeartbeat();
      return;
    }
    showPlayerLoading('Буферизация...', null);
    var onCanPlay = function () {
      if (AppState._loadingTimeout) {
        clearTimeout(AppState._loadingTimeout);
        AppState._loadingTimeout = null;
      }
      hidePlayerLoading();
      if (!signal.aborted && !isPlaybackCancelled) videoPlayer.play()['catch'](function (err) {
        videoPlayer.muted = true;
        videoPlayer.play()['catch'](function () {});
        restoreSoundOnGesture();
      });
      videoPlayer.muted = false;
      restoreSoundOnGesture();
      startTimecodeSaving();
      resetMouseIdleTimer();
      if (nearEndCheckInterval) clearInterval(nearEndCheckInterval);
      startNearEndCheck();
      startHeartbeat();
      videoPlayer.removeEventListener('canplay', onCanPlay);
    };
    videoPlayer.addEventListener('canplay', onCanPlay);
    AppState._loadingTimeout = setTimeout(function () {
      if (!signal.aborted && !isPlaybackCancelled) {
        videoPlayer.removeEventListener('canplay', onCanPlay);
        hidePlayerLoading();
        videoPlayer.play()['catch'](function (err) {
          videoPlayer.muted = true;
          videoPlayer.play()['catch'](function () {});
          restoreSoundOnGesture();
        });
        videoPlayer.muted = false;
        restoreSoundOnGesture();
        startTimecodeSaving();
        resetMouseIdleTimer();
        if (nearEndCheckInterval) clearInterval(nearEndCheckInterval);
        startNearEndCheck();
        startHeartbeat();
      }
    }, 3000);
  };
  hls.off(Hls.Events.MANIFEST_PARSED, manifestParsedHandler);
  hls.on(Hls.Events.MANIFEST_PARSED, manifestParsedHandler);
  hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, function () {
    if (!signal.aborted && AppState.serverTracks) selectHlsAudio(currentAudioTrack);
  });
  hls.on(Hls.Events.INIT_PTS_FOUND, function (e, d) {
    if (signal.aborted || !AppState.serverTracks || !d || d.id !== 'main' || !d.timescale) return;
    AppState.streamTimeOrigin = d.initPTS / d.timescale;
  });
  var fragLoadingHandler = function (event, data) {
    if (signal.aborted) return;
  };
  hls.off(Hls.Events.FRAG_LOADING, fragLoadingHandler);
  hls.on(Hls.Events.FRAG_LOADING, fragLoadingHandler);
  var bufferAppendedHandler = function (event, data) {
    if (signal.aborted) return;
  };
  hls.off(Hls.Events.BUFFER_APPENDED, bufferAppendedHandler);
  hls.on(Hls.Events.BUFFER_APPENDED, bufferAppendedHandler);
  var currentPlayingSegment = -1;
  var fragChangedHandler = function (event, data) {
    if (signal.aborted) return;
    if (data && data.frag) {
      var segmentNumber = data.frag.sn;
      if (currentPlayingSegment !== segmentNumber) {
        currentPlayingSegment = segmentNumber;
        if (segmentNumber > 0) {
          var now = Date.now();
          if (!window._lastCleanupTime || now - window._lastCleanupTime > 2000) {
            window._lastCleanupTime = now;
            bgFetch(SERVER_URL + '/hls/cleanup-segments/' + AppState.currentStreamId, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                keepFromSegment: segmentNumber
              })
            }).then(function (r) {
              return r.json();
            }).then(function (d) {
              if (d && typeof d.availableFrom === 'number') AppState.serverAvailableFrom = d.availableFrom;
            })['catch'](function () {});
          }
        }
      }
    }
  };
  hls.off(Hls.Events.FRAG_CHANGED, fragChangedHandler);
  hls.on(Hls.Events.FRAG_CHANGED, fragChangedHandler);
  var networkRetries = 0;
  var errorHandler = function (event, data) {
    if (signal.aborted || !data.fatal) return;
    switch (data.type) {
      case Hls.ErrorTypes.NETWORK_ERROR:
        if (++networkRetries > MAX_HLS_NETWORK_RETRIES) {
          hidePlayerLoading();
          showPlaybackUnavailableBanner('HLS: сеть не отвечает после ' + MAX_HLS_NETWORK_RETRIES + ' попыток');
          if (typeof showDetailView === 'function') showDetailView();
          break;
        }
        showPlayerLoading('Обрыв связи, попытка ' + networkRetries + ' из ' + MAX_HLS_NETWORK_RETRIES + '...', null);
        AppState.hls.startLoad();
        break;
      case Hls.ErrorTypes.MEDIA_ERROR:
        var errorMessage = data.error ? data.error.message || data.error : '';
        var errorDetails = data.details || '';
        var isUnsupportedCodec = errorMessage.toLowerCase().includes('codec') || errorDetails.toLowerCase().includes('codec');
        if (AppState.videoUrl && (AppState.videoUrl.toLowerCase().includes('.avi') || AppState.videoUrl.toLowerCase().includes('.vc1'))) isUnsupportedCodec = true;
        if (isUnsupportedCodec) {
          getEl('playback-overlay').classList.add('active');
          document.querySelector('.playback-text').textContent = 'Формат AVI или VC1 не поддерживаются на вашем устройстве';
          hidePlayerLoading();
          setTimeout(function () {
            var exitBtn = getEl('exit-player-btn');
            if (exitBtn) exitBtn.click();else if (typeof showDetailView === 'function') showDetailView();
            getEl('playback-overlay').classList.remove('active');
          }, 4000);
        } else AppState.hls.recoverMediaError();
        break;
      default:
        AppState.playbackRetryCount = (AppState.playbackRetryCount || 0) + 1;
        if (AppState.playbackRetryCount <= MAX_PLAYBACK_RETRIES) {
          showPlayerLoading('Ошибка воспроизведения, попытка ' + AppState.playbackRetryCount + '...');
          setTimeout(function () {
            if (AppState.currentStreamId && !signal.aborted) startHLSPlayback(AppState.videoUrl, videoPlayer.currentTime + AppState.seekOffset, false);
          }, 2000);
        } else {
          hidePlayerLoading();
          if (typeof window.showErrorBanner === 'function') {
            window.showErrorBanner('Не удалось воспроизвести видео', 'Проверьте соединение или формат файла. Попробуйте перезапустить контент или выбрать другую раздачу.');
          } else alert('Не удалось воспроизвести видео. Проверьте соединение или формат файла.');
          if (typeof showDetailView === 'function') showDetailView();
        }
        break;
    }
  };
  hls.off(Hls.Events.ERROR, errorHandler);
  hls.on(Hls.Events.ERROR, errorHandler);
}
function parseStreamRef(url) {
  if (!url) return null;
  var direct = url.match(/\/play\/([a-fA-F0-9]{40})\/(\d+)/);
  if (direct) return {
    hash: direct[1],
    fileId: direct[2]
  };
  var linkParam = (url.match(/[?&]link=([^&]+)/) || [])[1];
  var indexParam = (url.match(/[?&]index=(\d+)/) || [])[1];
  if (!linkParam || !indexParam) return null;
  var decoded = decodeURIComponent(linkParam);
  var hash = /^[a-fA-F0-9]{40}$/.test(decoded) ? decoded : typeof extractHashFromMagnet === 'function' ? extractHashFromMagnet(decoded) : null;
  return hash ? {
    hash: hash,
    fileId: indexParam
  } : null;
}
function resolvePlayableStream(url) {
  var ref = parseStreamRef(url);
  if (!ref || typeof window.pickPlayableVideoFiles !== 'function') return {
    url: url
  };
  var hashLower = String(ref.hash).toLowerCase();
  var torrent = null;
  var list = AppState.torrents || [];
  for (var i = 0; i < list.length && !torrent; i++) {
    if (list[i].hash && list[i].hash.toLowerCase() === hashLower) torrent = list[i];
  }
  if (!torrent && AppState.currentDetailItem && String(AppState.currentDetailItem.hash || '').toLowerCase() === hashLower) {
    torrent = AppState.currentDetailItem;
  }
  var files = torrent && typeof getTorrentFiles === 'function' ? getTorrentFiles(torrent) : [];
  if (!files.length) return {
    url: url
  };
  var file = null;
  for (var k = 0; k < files.length && !file; k++) {
    if (String(files[k].id) === String(ref.fileId)) file = files[k];
  }
  if (!file || window.isPlayableVideoPath(file.path || file.name)) return {
    url: url
  };
  var videos = sortEpisodeFiles(window.pickPlayableVideoFiles(files));
  if (!videos.length) return {
    error: window.describeUnplayableTorrent(files)
  };
  var id = String(videos[0].id);
  console.log('▶️ Файл ' + ref.fileId + ' не видео (' + (file.path || '') + ') — играем ' + id + ' (' + (videos[0].path || '') + ')');
  return {
    url: url.replace(/(\/play\/[a-fA-F0-9]{40}\/)\d+/, '$1' + id).replace(/([?&]index=)\d+/, '$1' + id),
    fileId: id
  };
}
window.resolvePlayableStream = resolvePlayableStream;
function startHLSPlayback(_x52, _x53, _x54, _x55, _x56) {
  return _startHLSPlayback.apply(this, arguments);
}
function _startHLSPlayback() {
  _startHLSPlayback = _asyncToGenerator(function* (originalUrl, initialSeek, fromSearch, episodeIndex, audioTrack) {
    var playable = resolvePlayableStream(originalUrl);
    if (playable.error) {
      if (typeof showErrorBanner === 'function') showErrorBanner(playable.error);else if (typeof window.showToast === 'function') window.showToast(playable.error);
      return false;
    }
    originalUrl = playable.url;
    if (initialSeek === undefined) initialSeek = null;
    if (fromSearch === undefined) fromSearch = false;
    if (episodeIndex === undefined) episodeIndex = null;
    var audioExplicit = audioTrack !== undefined && audioTrack !== null;
    if (audioTrack === undefined) audioTrack = currentAudioTrack !== undefined ? currentAudioTrack : null;
    var ensureRef = window.MagnetStore ? parseStreamRef(originalUrl) : null;
    if (ensureRef) yield MagnetStore.ensure(ensureRef.hash);
    if (AppState.preloadBeforePlay && AppState.currentScreen !== 'player' && typeof runPlaybackPreload === 'function') {
      var preloadRef = parseStreamRef(originalUrl);
      if (preloadRef) {
        var preloadTitle = AppState.currentDetailItem ? AppState.currentDetailItem.title || AppState.currentDetailItem.name || '' : '';
        if (!(yield runPlaybackPreload(preloadRef.hash, preloadRef.fileId, preloadTitle))) return false;
      }
    }
    var applePlayer = typeof getApplePlayer === 'function' ? getApplePlayer() : null;
    if (applePlayer && applePlayer.template) {
      var appleRef = parseStreamRef(originalUrl);
      if (AppState.currentDetailItem && AppState.currentDetailItem.hash) {
        try {
          yield loadEpisodesInfo(AppState.currentDetailItem.hash, appleRef ? appleRef.fileId : null);
        } catch (e) {}
        if (AppState.autoSwitchEpisodes && typeof getTorrentProgressBatch === 'function') {
          try {
            yield getTorrentProgressBatch(AppState.currentDetailItem.hash, currentEpisodeFiles);
          } catch (e) {}
        }
      }
      var appleSeek = initialSeek;
      if (appleSeek === null && appleRef) {
        try {
          var appleSaved = yield loadTimecodeFromServer(appleRef.hash, appleRef.fileId);
          if (appleSaved > 0) appleSeek = appleSaved;
        } catch (e) {}
      }
      if (openAppleExternalPlayer(originalUrl, buildExternalPlayerTitle(), appleSeek)) return;
    }
    if (window.AndroidJS) {
      var androidRef = parseStreamRef(originalUrl);
      if (AppState.currentDetailItem && AppState.currentDetailItem.hash) {
        try {
          yield loadEpisodesInfo(AppState.currentDetailItem.hash, androidRef ? androidRef.fileId : null);
        } catch (e) {}
        if (typeof window.ensureTorrentEpisodeMeta === 'function' && currentEpisodeFiles.length > 1) {
          yield Promise.race([window.ensureTorrentEpisodeMeta(AppState.currentDetailItem, currentEpisodeFiles), new Promise(function (resolve) {
            setTimeout(resolve, ANDROID_EPISODE_META_WAIT_MS);
          })]);
        }
        if (typeof getTorrentProgressBatch === 'function') {
          try {
            yield getTorrentProgressBatch(AppState.currentDetailItem.hash, currentEpisodeFiles);
          } catch (e) {}
        }
      }
      var androidSeek = initialSeek;
      if (androidSeek === null && androidRef) {
        try {
          var savedSeek = yield loadTimecodeFromServer(androidRef.hash, androidRef.fileId);
          if (savedSeek > 0) androidSeek = savedSeek;
        } catch (e) {}
      }
      if (playInExternalPlayer(originalUrl, buildExternalPlayerTitle(), androidSeek, fromSearch)) {
        getEl('config-screen').style.display = 'none';
        if (!androidReturnHome) getEl('torrserver-section').style.display = 'none';
        return;
      }
    }
    resetPlaybackState();
    currentPlaybackController = new AbortController();
    var signal = currentPlaybackController.signal;
    currentBufferAhead = 0;
    wasImmediatePause = false;
    pauseTimer = null;
    pauseStartTime = null;
    AppState.playbackRetryCount = 0;
    if (!originalUrl || !originalUrl.trim()) {
      if (typeof window.showErrorBanner === 'function') {
        window.showErrorBanner('Не удалось начать воспроизведение', 'Ссылка на видео не указана');
      } else alert('Ошибка: URL не указан');
      return false;
    }
    lastPlaybackFromSearch = fromSearch;
    var metadata = yield preparePlaybackMetadata(originalUrl, initialSeek, audioTrack, signal);
    if (metadata) metadata.audioChosen = audioExplicit || metadata.savedAudioTrack !== null;
    if (!metadata || signal.aborted) return false;
    var {
      fileInfo,
      savedAudioTrack,
      fileName,
      savedSubTrack,
      savedTimecode,
      seekTime
    } = metadata;
    initialSeek = seekTime;
    var needsFileInfo = !AppState.transcodingOnOff && !AppState.transcodingFullOnOff;
    if (needsFileInfo && (!fileInfo || fileInfo.success === false)) {
      showPlaybackUnavailableBanner('/api/file/info не отдал данные о ' + currentTimecodeData.hash + '/' + currentTimecodeData.fileId);
      return false;
    }
    var startRef = parseStreamRef(originalUrl);
    if (startRef) OnlineSubs.onFileStart(startRef.hash, startRef.fileId);
    var startEpisodeTitle = startRef ? getEpisodePlayerTitle(startRef.hash, startRef.fileId) : null;
    if (startEpisodeTitle) updatePlayerTitle(startEpisodeTitle);else if (fileName) updatePlayerTitle(fileName);else if (AppState.currentDetailItem && AppState.currentDetailItem.title) updatePlayerTitle(AppState.currentDetailItem.title);
    if (AppState.currentDetailItem && AppState.currentDetailItem.hash) {
      var currentFileId = episodeIndex !== null && currentEpisodeFiles[episodeIndex] ? currentEpisodeFiles[episodeIndex].id : metadata.match ? metadata.match[2] : null;
      setTimeout(function () {
        if (!signal.aborted) loadEpisodesInfo(AppState.currentDetailItem.hash, currentFileId);
      }, fromSearch ? EPISODES_LOAD_DELAY_SEARCH_MS : EPISODES_LOAD_DELAY_MS);
    }
    var preplayback = capturePreplaybackScreen();
    transitionToPlayerScreen();
    AppState.videoUrl = originalUrl;
    var videoPlayer = getEl('video-player');
    videoPlayer.removeEventListener('ended', handleVideoEnded);
    videoPlayer.addEventListener('ended', handleVideoEnded);
    try {
      if (AppState.transcodingOnOff) {
        yield initGstPlayback(metadata, initialSeek, signal);
      } else if (AppState.transcodingFullOnOff) {
        nativeSubState.savedPref = metadata && metadata.savedSubTrack !== null && metadata.savedSubTrack !== undefined ? metadata.savedSubTrack : -1;
        var directAudio = metadata && metadata.savedAudioTrack !== null && metadata.savedAudioTrack !== undefined ? metadata.savedAudioTrack : metadata && metadata.audioChosen ? metadata.audioTrack : null;
        directAudio = parseInt(directAudio, 10);
        nativeAudioPref = directAudio >= 0 ? directAudio : -1;
        yield initTranscodingOffPlayback(initialSeek, signal, metadata && metadata.fileName);
      } else {
        yield initServerProxyPlayback(metadata, initialSeek, signal);
      }
      showPlayerHint();
      return true;
    } catch (error) {
      if (error.name === 'AbortError') return false;
      cancelCurrentPlayback();
      restorePreplaybackScreen(preplayback);
      showPlaybackUnavailableBanner(error && error.message);
      return false;
    }
  });
  return _startHLSPlayback.apply(this, arguments);
}
function cancelCurrentPlayback() {
  if (seriesStartCancel) seriesStartCancel();
  if (currentPlaybackController) {
    currentPlaybackController.abort();
    currentPlaybackController = null;
  }
  if (AppState.bufferCheckInterval) {
    clearInterval(AppState.bufferCheckInterval);
    AppState.bufferCheckInterval = null;
  }
  if (AppState._loadingTimeout) {
    clearTimeout(AppState._loadingTimeout);
    AppState._loadingTimeout = null;
  }
  if (AppState._seekTimeout) {
    clearTimeout(AppState._seekTimeout);
    AppState._seekTimeout = null;
  }
  if (AppState.seekTimeout) {
    clearTimeout(AppState.seekTimeout);
    AppState.seekTimeout = null;
  }
  if (AppState.hls) {
    try {
      AppState.hls.destroy();
      AppState.hls = null;
    } catch (e) {}
  }
  if (AppState.currentStreamId) {
    bgFetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, {
      method: 'POST'
    })['catch'](function () {});
    AppState.currentStreamId = null;
  }
  hidePlayerLoading();
}
function showDetailView(field = null) {
  var navUnder = window.Nav ? Nav.pop('player') || Nav.top() : null;
  if (!window.AndroidJS) {
    resetNativeSubtitles();
    currentSubtitleTrack = -1;
    stopTorrentStatsUpdates();
    hideSkipButton();
    skipIntro = 0;
    skipCredits = 0;
    currentBufferAhead = 0;
    wasImmediatePause = false;
    pauseTimer = null;
    pauseStartTime = null;
    thisisseek = false;
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
    if (AppState.isYoutubePlayback) {
      if (typeof window.exitYoutubePlayer === 'function') window.exitYoutubePlayer();else {
        if (AppState.currentStreamId) {
          bgFetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, {
            method: 'POST'
          })['catch'](function () {});
          AppState.currentStreamId = null;
        }
        if (AppState.hls) {
          AppState.hls.destroy();
          AppState.hls = null;
        }
        AppState.isYoutubePlayback = false;
        AppState.currentScreen = 'catalog';
        getEl('player-screen').style.display = 'none';
        var detailView = getEl('detail-view');
        if (detailView && AppState.youtubeContext) {
          if (typeof Animations !== 'undefined' && typeof Animations.ensureDetailVisible === 'function') Animations.ensureDetailVisible();else {
            detailView.style.display = 'block';
            detailView.style.pointerEvents = 'auto';
          }
        } else if (typeof window.showCatalogList === 'function') window.showCatalogList();
      }
      return;
    }
    trackTimecodeSave(saveTimecodeToServer()).then(function () {
      stopTimecodeSaving();
    });
    if (typeof window.refreshDetailResume === 'function') window.refreshDetailResume();
    stopHeartbeat();
    if (nearEndCheckInterval) {
      clearInterval(nearEndCheckInterval);
      nearEndCheckInterval = null;
    }
    lastCleanedSegment = -1;
    currentEpisodeFiles = [];
    currentEpisodeIndex = 0;
    currentTorrentHash = null;
    updatePlayerTitle(null);
    clearTimecodeData();
    if (typeof window.hideSeekOverlay === 'function') window.hideSeekOverlay();
    closePlayerPanels();
    var episodesBtn = getEl('episodes-btn');
    if (episodesBtn) episodesBtn.style.display = 'none';
    var prevBtn = getEl('prev-episode-btn');
    var nextBtn = getEl('next-episode-btn');
    if (prevBtn) prevBtn.style.display = 'none';
    if (nextBtn) nextBtn.style.display = 'none';
    AppState.currentScreen = 'detail';
    var videoPlayer = getEl('video-player');
    videoPlayer.removeEventListener('ended', handleVideoEnded);
    videoPlayer.pause();
    videoPlayer.removeAttribute('src');
    videoPlayer.load();
    destroyHls();
    hidePlayerLoading();
    if (AppState.currentStreamId) {
      bgFetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, {
        method: 'POST'
      })['catch'](function () {});
      AppState.currentStreamId = null;
    }
    getEl('player-screen').style.display = 'none';
    getEl('config-screen').style.display = 'none';
    if (navUnder && navUnder.screen === 'search') {
      if (returnToCardFromSearch(AppState.currentDetailItem && AppState.currentDetailItem.hash)) return;
      lastPlaybackFromSearch = false;
      AppState.playFromHash = false;
      AppState.isCatalogSearch = false;
      AppState.currentScreen = 'search';
      var searchOverlay = getEl('search-overlay');
      if (searchOverlay) searchOverlay.classList.remove('hidden');
      var mainContainer = getEl('main-container');
      if (mainContainer) mainContainer.style.pointerEvents = 'auto';
      setTimeout(function () {
        if (typeof window.focusLastSearchResult === 'function' && window.focusLastSearchResult()) return;
        if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
          updateFocusableElements();
          for (var i = 0; i < focusableElements.length; i++) {
            if (focusableElements[i].classList && focusableElements[i].classList.contains('search-result-item')) {
              setFocus(i);
              break;
            }
          }
        }
      }, 100);
      return;
    }
    if (navUnder && navUnder.screen === 'home' && window.HomeScreen && !AppState.cardPlayback) {
      var homeHash = AppState.currentDetailItem && AppState.currentDetailItem.hash || null;
      if (homeHash) {
        dropTorrentToServer(homeHash)['catch'](function () {});
        if (torrentProgressCache.has(homeHash)) torrentProgressCache.delete(homeHash);
      }
      AppState.playFromHash = false;
      AppState.currentDetailItem = null;
      HomeScreen.show();
      return;
    }
    getEl('torrserver-section').style.display = 'block';
    if (AppState.cardPlayback) {
      var cardHash = AppState.currentDetailItem && AppState.currentDetailItem.hash || null;
      if (cardHash) {
        dropTorrentToServer(cardHash)['catch'](function () {});
        if (torrentProgressCache.has(cardHash)) torrentProgressCache.delete(cardHash);
      }
      returnToDetailCard();
      return;
    }
  }
  var watchedHash = AppState.currentDetailItem && AppState.currentDetailItem.hash || null;
  var dropped = watchedHash ? dropTorrentToServer(watchedHash)['catch'](function (error) {
    return null;
  }) : Promise.resolve(null);
  dropped.then(function () {
    return refreshTorrentsList();
  }).then(function () {
    if (watchedHash && torrentProgressCache.has(watchedHash)) torrentProgressCache.delete(watchedHash);
  })['catch'](function (error) {});
  if (lastPlaybackFromSearch && lastAddedTorrentHash) {
    setTimeout(function () {
      var found = showDetailByHash(lastAddedTorrentHash);
      if (!found) refreshTorrentsList().then(function () {
        showDetailByHash(lastAddedTorrentHash);
      });
    }, 500);
    lastPlaybackFromSearch = false;
  } else {
    var detailView = getEl('detail-view');
    var restoreDetail = typeof Animations !== 'undefined' && typeof Animations.ensureDetailVisible === 'function' ? Animations.ensureDetailVisible : function () {
      detailView.style.display = 'block';
    };
    if (AppState.currentDetailItem) {
      restoreDetail();
      updateDetailProgress(AppState.currentDetailItem);
    } else detailView.style.display = 'none';
    setTimeout(function () {
      if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
        updateFocusableElements();
        var progressBtnIndex = -1;
        if (typeof focusableElements !== 'undefined') {
          var fieldAsNumber = Number(field);
          if (field != null && !isNaN(fieldAsNumber)) setFocus(fieldAsNumber + 1);else {
            for (var i = 0; i < focusableElements.length; i++) {
              var el = focusableElements[i];
              if (el && (el.classList.contains('detail-progress-btn') || el.classList.contains('file-item') || el.classList.contains('back-btn'))) {
                progressBtnIndex = i;
                break;
              }
            }
            setFocus(progressBtnIndex !== -1 ? progressBtnIndex : 0);
          }
        }
      }
    }, 250);
  }
}
function updateDetailProgress(_x57) {
  return _updateDetailProgress.apply(this, arguments);
}
function _updateDetailProgress() {
  _updateDetailProgress = _asyncToGenerator(function* (torrent) {
    if (!torrent || !torrent.hash) return null;
    var btn = getEl('detail-progress-btn');
    if (!btn) return null;
    yield awaitPendingTimecodeSave();
    var cacheKey = torrent.hash;
    if (torrentProgressCache.has(cacheKey)) torrentProgressCache.delete(cacheKey);
    if (typeof torrentProgressInFlight !== 'undefined') delete torrentProgressInFlight[cacheKey];
    var oldProgressBlocks = document.querySelectorAll('#detail-progress');
    for (var i = 0; i < oldProgressBlocks.length; i++) oldProgressBlocks[i].remove();
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
    btn.dataset.hash = torrent.hash;
    btn.dataset.fileId = '1';
    btn.dataset.timecode = '0';
    btn.dataset.episodeIndex = '0';
    btn.classList.remove('has-progress');
    btn.innerHTML = '<span class="btn-label">▶ Играть</span>';
    var progress = yield loadProgressForTorrent(torrent, getTorrentFiles(torrent));
    if (!progress || !(progress.timecode > 0)) return null;
    var fileId = parseInt(progress.fileId, 10) || 1;
    var timecode = progress.timecode;
    var episodeIndex = progress.episodeIndex || 0;
    var percent = progress.duration > 0 ? timecode / progress.duration * 100 : 0;
    var remaining = 100 - percent;
    var isNextFile = false;
    if (remaining <= 5) {
      var videoFiles = getVideoFilesFromTorrent(torrent);
      var nextFile = videoFiles.length ? videoFiles[episodeIndex + 1] : null;
      if (nextFile) {
        fileId = nextFile.id || fileId + 1;
        timecode = 0;
        episodeIndex = episodeIndex + 1;
        isNextFile = true;
      } else if (progress.isSeries && episodeIndex + 1 < (progress.totalEpisodes || 0)) {
        fileId = fileId + 1;
        timecode = 0;
        episodeIndex = episodeIndex + 1;
        isNextFile = true;
      } else {
        timecode = 0;
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
    btn.innerHTML = '<span class="btn-label">▶ Продолжить</span>' + '<span class="btn-hint">' + hint + '</span>';
    updateCurrentFileProgress(torrent.hash, progress.fileId, progress.timecode, progress.duration);
    return fileId;
  });
  return _updateDetailProgress.apply(this, arguments);
}
function updateCurrentFileProgress(hash, fileId, timecode, duration) {
  if (!hash || !fileId) return;
  if (!(timecode > 0) || !(duration > 0)) return;
  var fileItems = document.querySelectorAll('.file-item');
  var targetItem = null;
  for (var i = 0; i < fileItems.length; i++) {
    if (fileItems[i].dataset.hash === hash && fileItems[i].dataset.fileId == fileId) {
      targetItem = fileItems[i];
      break;
    }
  }
  if (!targetItem) return;
  var progressPercent = Math.min(timecode / duration * 100, 98);
  var progressFill = targetItem.querySelector('.file-progress-fill');
  if (progressFill) {
    progressFill.style.width = progressPercent + '%';
    if (progressPercent > 5) targetItem.classList.add('has-progress');
  }
}
function loadFileInfo(_x58, _x59) {
  return _loadFileInfo.apply(this, arguments);
}
function _loadFileInfo() {
  _loadFileInfo = _asyncToGenerator(function* (hash, fileId) {
    try {
      var savedClientId = localStorage.getItem('clientId');
      var response = yield fetchWithTimeout(SERVER_URL + '/api/file/info?hash=' + hash + '&fileId=' + fileId + '&clientId=' + encodeURIComponent(savedClientId), null, FILE_INFO_FETCH_TIMEOUT_MS);
      if (response.ok) return yield response.json();
      console.warn('⚠️ /api/file/info вернул HTTP ' + response.status);
    } catch (error) {
      console.warn('⚠️ /api/file/info недоступен:', error && error.name === 'AbortError' ? 'таймаут' : error && error.message);
    }
    return null;
  });
  return _loadFileInfo.apply(this, arguments);
}
function renderAudioTracks() {
  var audioList = getEl('audio-list');
  if (!audioList) return;
  if (AppState.transcodingFullOnOff && (!currentAudioTracks || currentAudioTracks.length === 0)) {
    audioList.innerHTML = '<div class="search-result-empty">Нет аудиодорожек</div>';
    return;
  }
  if (!currentAudioTracks || currentAudioTracks.length === 0) {
    audioList.innerHTML = '<div class="search-result-empty">Нет аудиодорожек</div>';
    return;
  }
  var html = '';
  for (var idx = 0; idx < currentAudioTracks.length; idx++) {
    var track = currentAudioTracks[idx];
    var isActive = idx === currentAudioTrack;
    var language = track.language || 'unknown';
    var channels = track.channels ? track.channels + ' ch' : '';
    var codec = track.codec || '';
    html += '<div class="audio-item ' + (isActive ? 'active' : '') + '" data-track-index="' + idx + '">' + '<div class="audio-icon">🔊</div><div class="audio-info"><div class="audio-title">' + escapeHtml(track.title || 'Дорожка ' + (idx + 1)) + '</div>' + '<div class="audio-details"><span class="audio-language">' + language.toUpperCase() + '</span>' + (channels ? ' <span class="audio-channels">' + channels + '</span>' : '') + (codec ? ' <span class="audio-codec">' + codec + '</span>' : '') + '</div></div><div class="audio-check">✓</div></div>';
  }
  audioList.innerHTML = html;
  setupAudioListDelegation();
}
function collectNativeAudioTracks(videoPlayer) {
  var list = videoPlayer.audioTracks;
  if (!list || list.length === 0) return [];
  var tracks = [];
  for (var i = 0; i < list.length; i++) {
    tracks.push({
      title: list[i].label || 'Аудиодорожка ' + (i + 1),
      language: list[i].language || 'und',
      channels: null,
      codec: null
    });
  }
  return tracks;
}
var nativeAudioPref = -1;
function applyNativeAudioPref(videoPlayer) {
  var list = videoPlayer && videoPlayer.audioTracks;
  if (nativeAudioPref < 0 || !list || list.length === 0) return -1;
  if (AppState.tizenAvplayActive && !probeAudio.gaveUp) return -1;
  var index = nativeAudioPref;
  if (!(AppState.platform === 'webos' && lunaAvailable())) nativeAudioPref = -1;
  if (index >= list.length) return -1;
  for (var i = 0; i < list.length; i++) list[i].enabled = i === index;
  return index;
}
function switchAudioTrack(_x60) {
  return _switchAudioTrack.apply(this, arguments);
}
function _switchAudioTrack() {
  _switchAudioTrack = _asyncToGenerator(function* (trackIndex) {
    if (trackIndex === currentAudioTrack) {
      toggleAudioPanel();
      return;
    }
    if (AppState.transcodingFullOnOff) {
      switchNativeAudioTrack(AppState.nativeVideoPlayer || getEl('video-player'), trackIndex);
      return;
    }
    if (AppState.serverTracks) {
      var inStream = selectHlsAudio(trackIndex);
      currentAudioTrack = trackIndex;
      AppState.serverTracks.selectedAudio = trackIndex;
      if (currentTimecodeData.hash && currentTimecodeData.fileId) saveAudioPreference(currentTimecodeData.hash, currentTimecodeData.fileId, trackIndex);
      renderAudioTracks();
      toggleAudioPanel();
      if (!inStream) restartServerGeneration('аудиодорожки');
      return;
    }
    thisisseek = false;
    yield saveTimecodeToServer();
    if (currentTimecodeData.hash && currentTimecodeData.fileId) yield saveAudioPreference(currentTimecodeData.hash, currentTimecodeData.fileId, trackIndex);
    setPlayerPanel('audio', false);
    var videoPlayer = getEl('video-player');
    var currentTime = videoPlayer.currentTime + AppState.seekOffset;
    getEl('playback-overlay').classList.add('active');
    document.querySelector('.playback-text').textContent = 'Переключение аудиодорожки...';
    try {
      var parsed = AppState.videoUrl.match(/\/play\/([a-fA-F0-9]+)\/(\d+)/);
      if (!parsed) return;
      var hash = parsed[1];
      var fileId = parsed[2];
      var playUrl = AppState.currentTorrserverUrl + '/play/' + hash + '/' + fileId;
      if (AppState.currentStreamId) {
        yield bgFetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, {
          method: 'POST'
        });
        AppState.currentStreamId = null;
      }
      destroyHls();
      yield startHLSPlayback(playUrl, currentTime, lastPlaybackFromSearch, currentEpisodeIndex, trackIndex);
      currentAudioTrack = trackIndex;
      renderAudioTracks();
    } catch (error) {
      showSwitchFailedBanner('аудиодорожку', error && error.message);
    } finally {
      getEl('playback-overlay').classList.remove('active');
      document.querySelector('.playback-text').textContent = 'Воспроизведение...';
    }
  });
  return _switchAudioTrack.apply(this, arguments);
}
function switchNativeAudioTrack(videoPlayer, index) {
  nativeAudioPref = -1;
  if (webosAudio.mode && webosSubs.mediaId) {
    lunaCall('selectTrack', {
      type: 'audio',
      mediaId: webosSubs.mediaId,
      index: index
    });
    var at = videoPlayer && videoPlayer.audioTracks;
    if (at && at.length === webosAudio.list.length) {
      for (var j = 0; j < at.length; j++) at[j].enabled = j === index;
    }
    currentAudioTrack = index;
    if (currentTimecodeData.hash && currentTimecodeData.fileId) {
      saveAudioPreference(currentTimecodeData.hash, currentTimecodeData.fileId, index);
    }
    renderAudioTracks();
    toggleAudioPanel();
    return;
  }
  if (!videoPlayer) return;
  if (AppState.transcodingFullOnOff && videoPlayer.audioTracks && videoPlayer.audioTracks.length > 0) {
    var tv = probeAudio.on ? probeAudio.map[index] : index;
    if (tv === undefined || tv < 0) return;
    for (var i = 0; i < videoPlayer.audioTracks.length; i++) {
      videoPlayer.audioTracks[i].enabled = i === tv;
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
var webosSubs = {
  mediaId: null,
  timer: null,
  bridge: null,
  list: null,
  enabled: false,
  index: -1,
  onSeeked: null,
  gen: 0
};
var webosSubsDiag = {
  bridge: '',
  mediaId: '',
  waitedMs: 0,
  responses: 0,
  keys: '',
  sourceInfo: false,
  tracks: null,
  audio: null,
  probe: '',
  error: ''
};
var webosAudio = {
  mode: false,
  list: []
};
window.webosSubsDiag = webosSubsDiag;
function lunaBridgeName() {
  if (window.webOS && webOS.service && webOS.service.request) return 'webOS.service';
  if (typeof window.PalmServiceBridge !== 'undefined') return 'PalmServiceBridge';
  return '';
}
function lunaAvailable() {
  return !!lunaBridgeName();
}
function lunaCall(method, params, onSuccess, onFailure) {
  return lunaRequest('luna://com.webos.media', method, params, onSuccess, onFailure);
}
function lunaRequest(uri, method, params, onSuccess, onFailure, quiet) {
  var fail = function (r) {
    var text = r && (r.errorText || r.errorCode) || 'ошибка';
    console.warn('webOS luna ' + method + ' failed:', text);
    if (!quiet) webosSubsDiag.error = method + ': ' + text;
    if (onFailure) onFailure(r);
  };
  try {
    if (window.webOS && webOS.service && webOS.service.request) {
      return webOS.service.request(uri, {
        method: method,
        parameters: params,
        onSuccess: onSuccess,
        onFailure: fail,
        subscribe: !!params.subscribe
      });
    }
    if (typeof window.PalmServiceBridge === 'undefined') {
      fail({
        errorText: 'нет PalmServiceBridge'
      });
      return null;
    }
    var bridge = new window.PalmServiceBridge();
    bridge.onservicecallback = function (msg) {
      var r = {};
      try {
        r = JSON.parse(msg);
      } catch (e) {}
      if (r.returnValue === false || r.errorCode) fail(r);else if (onSuccess) onSuccess(r);
    };
    bridge.call(uri + '/' + method, JSON.stringify(params));
    return bridge;
  } catch (e) {
    fail({
      errorText: e.message
    });
    return null;
  }
}
function webosSubsCancel() {
  if (webosSubs.timer) {
    clearInterval(webosSubs.timer);
    webosSubs.timer = null;
  }
  if (webosSubs.bridge) {
    try {
      if (typeof webosSubs.bridge.cancel === 'function') webosSubs.bridge.cancel();
    } catch (e) {}
    webosSubs.bridge = null;
  }
}
function webosSetSubtitle(index) {
  if (!webosSubs.mediaId) return;
  var on = index >= 0;
  lunaCall('setSubtitleEnable', {
    mediaId: webosSubs.mediaId,
    enable: on
  });
  webosSubs.enabled = on;
  webosSubs.index = index;
  if (on) {
    var mediaId = webosSubs.mediaId;
    setTimeout(function () {
      if (webosSubs.mediaId !== mediaId) return;
      lunaCall('selectTrack', {
        type: 'text',
        mediaId: mediaId,
        index: index
      });
      webosSubtitleFontSize(mediaId);
    }, 500);
  }
}
function webosSubsApply(info) {
  var audio = info && info.audioTrackInfo || [];
  webosSubsDiag.audio = audio.length;
  if (audio.length) {
    webosAudio.mode = true;
    webosAudio.list = audio;
    currentAudioTracks = audio.map(function (a, i) {
      var lang = a.language && a.language !== '(null)' ? a.language : '';
      return {
        title: lang ? LANG_NAMES[lang] || lang.toUpperCase() : 'Аудиодорожка ' + (i + 1),
        language: lang || 'und',
        channels: a.channels || null,
        codec: a.codec || null
      };
    });
    var vp = getEl('video-player'),
      at = vp && vp.audioTracks,
      playing = -1;
    if (at && at.length === audio.length) {
      for (var k = 0; k < at.length; k++) if (at[k].enabled) {
        playing = k;
        break;
      }
    }
    if (playing < 0) playing = currentAudioTrack >= 0 && currentAudioTrack < audio.length ? currentAudioTrack : 0;
    if (nativeAudioPref >= 0 && nativeAudioPref < audio.length) {
      playing = nativeAudioPref;
      nativeAudioPref = -1;
      lunaCall('selectTrack', {
        type: 'audio',
        mediaId: webosSubs.mediaId,
        index: playing
      });
      if (at && at.length === audio.length) {
        for (var m = 0; m < at.length; m++) at[m].enabled = m === playing;
      }
    }
    currentAudioTrack = playing;
    renderAudioTracks();
  }
  var subs = info && info.subtitleTrackInfo || [];
  webosSubs.list = subs;
  webosSubsDiag.tracks = subs.length;
  if (!subs.length) {
    applyDirectProbe();
    return;
  }
  nativeSubState.mode = 'webos';
  currentSubTracks = subs.map(function (s, i) {
    var lang = s.language && s.language !== '(null)' ? s.language : '';
    return {
      title: s.title || s.name || (lang ? lang.toUpperCase() : 'Субтитры ' + (i + 1)),
      language: lang || 'und',
      format: s.type || ''
    };
  });
  var want = currentSubtitleTrack >= 0 ? currentSubtitleTrack : nativeSubState.savedPref;
  currentSubtitleTrack = want >= 0 && want < subs.length ? want : -1;
  if (currentSubtitleTrack >= 0) webosSetSubtitle(currentSubtitleTrack);
  renderSubtitleTracks();
  applyDirectProbe();
}
var directProbe = {
  gen: 0,
  streams: null,
  count: '',
  serverInfo: null
};
var probeAudio = {
  on: false,
  map: [],
  gaveUp: false
};
var LANG_NAMES = {
  rus: 'Русский',
  ru: 'Русский',
  eng: 'English',
  en: 'English',
  ukr: 'Українська',
  uk: 'Українська',
  bel: 'Беларуская',
  kaz: 'Қазақша',
  jpn: '日本語',
  ja: '日本語',
  kor: '한국어',
  chi: '中文',
  zho: '中文',
  ger: 'Deutsch',
  deu: 'Deutsch',
  fre: 'Français',
  fra: 'Français',
  spa: 'Español',
  ita: 'Italiano',
  por: 'Português',
  pol: 'Polski',
  tur: 'Türkçe',
  ara: 'العربية',
  heb: 'עברית',
  hin: 'हिन्दी',
  zh: '中文',
  ko: '한국어',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  it: 'Italiano',
  pt: 'Português',
  pl: 'Polski',
  tr: 'Türkçe',
  ar: 'العربية',
  he: 'עברית',
  iw: 'עברית',
  hi: 'हिन्दी',
  be: 'Беларуская',
  kk: 'Қазақша',
  russian: 'Русский',
  english: 'English',
  ukrainian: 'Українська',
  japanese: '日本語',
  korean: '한국어',
  chinese: '中文',
  german: 'Deutsch',
  french: 'Français',
  spanish: 'Español',
  italian: 'Italiano'
};
var TEXT_SUB_CODECS = {
  subrip: 1,
  srt: 1,
  ass: 1,
  ssa: 1,
  webvtt: 1,
  mov_text: 1,
  text: 1
};
var HIDDEN_AUDIO_CODECS = {
  dts: 1,
  truehd: 1,
  mlp: 1
};
function langKey(l) {
  l = String(l || '').toLowerCase().replace(/^\s+|\s+$/g, '');
  if (!l || l === 'und' || l === 'unknown' || l === '(null)') return '';
  return LANG_NAMES[l] || l;
}
function alignProbeStreams(tracks, streams, hidden) {
  if (!tracks.length || !streams.length) return null;
  if (streams.length === tracks.length && langsAgree(tracks, streams)) return streams;
  var visible = streams.filter(function (s) {
    return !hidden(s);
  });
  if (visible.length === tracks.length && langsAgree(tracks, visible)) return visible;
  var byLang = matchProbeByLanguage(tracks, streams, hidden, false);
  if (byLang) return byLang;
  var sources = [visible, streams];
  for (var n = 0; n < sources.length; n++) {
    var src = sources[n],
      out = [],
      j = 0;
    if (src.length < tracks.length) continue;
    for (var i = 0; i < tracks.length; i++) {
      var want = langKey(tracks[i].language);
      while (j < src.length && want && langKey(probeLang(src[j])) && langKey(probeLang(src[j])) !== want) j++;
      if (j >= src.length) break;
      out.push(src[j++]);
    }
    if (out.length === tracks.length) return out;
  }
  return null;
}
function langsAgree(tracks, streams) {
  for (var i = 0; i < tracks.length; i++) {
    var a = langKey(tracks[i].language),
      b = langKey(probeLang(streams[i]));
    if (a && b && a !== b) return false;
  }
  return true;
}
function matchProbeByLanguage(tracks, streams, hidden, partial) {
  var used = [],
    out = [];
  var take = function (want, allowHidden) {
    for (var j = 0; j < streams.length; j++) {
      if (used[j] || !allowHidden && hidden(streams[j])) continue;
      if (want && langKey(probeLang(streams[j])) !== want) continue;
      used[j] = true;
      return streams[j];
    }
    return null;
  };
  for (var i = 0; i < tracks.length; i++) {
    var want = langKey(tracks[i].language);
    var pick = take(want, false) || (want ? take(want, true) : null);
    if (!pick && !partial) return null;
    out.push(pick);
  }
  return out;
}
function probeLang(s) {
  var l = s && s.tags && s.tags.language || '';
  return l && l !== 'und' ? l : '';
}
function probeTitle(s, kind, i) {
  var t = String(s && s.tags && s.tags.title || '').replace(/^["'«\s]+|["'»\s]+$/g, '');
  var lang = probeLang(s);
  var name = LANG_NAMES[lang] || (lang ? lang.toUpperCase() : '');
  if (t && name && t.toLowerCase().indexOf(name.toLowerCase()) === -1) return t + ' · ' + name;
  return t || name || (kind === 'audio' ? 'Аудиодорожка ' : 'Субтитры ') + (i + 1);
}
function applyDirectProbe() {
  var streams = directProbe.streams;
  if (!streams) return;
  var audio = [],
    subs = [];
  for (var i = 0; i < streams.length; i++) {
    if (streams[i].codec_type === 'audio') audio.push(streams[i]);else if (streams[i].codec_type === 'subtitle') subs.push(streams[i]);
  }
  var diag = [];
  if (applyProbeAudioList(audio)) {
    diag.push('звук из файла ' + audio.length + ', у AVPlay ' + getEl('video-player').audioTracks.length);
  } else if (currentAudioTracks.length && !currentAudioTracks[0].probed) {
    var a = alignProbeStreams(currentAudioTracks, audio, function (s) {
      return HIDDEN_AUDIO_CODECS[s.codec_name];
    });
    if (a) {
      currentAudioTracks = currentAudioTracks.map(function (t, k) {
        return {
          title: probeTitle(a[k], 'audio', k),
          language: probeLang(a[k]) || t.language,
          channels: a[k].channels || null,
          codec: (a[k].codec_name || '').toUpperCase(),
          probed: true
        };
      });
      renderAudioTracks();
    }
    diag.push('звук ' + currentAudioTracks.length + '/' + audio.length + (a ? ' ✓' : ' ✗'));
  }
  if (currentSubTracks.length && !currentSubTracks[0].probed) {
    var s = alignProbeStreams(currentSubTracks, subs, function (x) {
      return !TEXT_SUB_CODECS[x.codec_name];
    });
    if (s) {
      currentSubTracks = currentSubTracks.map(function (t, k) {
        var d = s[k].disposition || {};
        return {
          title: probeTitle(s[k], 'subtitle', k),
          language: probeLang(s[k]) || t.language,
          format: (s[k].codec_name || '').toUpperCase(),
          default: !!d.default,
          forced: !!d.forced,
          probed: true
        };
      });
      renderSubtitleTracks();
    }
    diag.push('субтитры ' + currentSubTracks.length + '/' + subs.length + (s ? ' ✓' : ' ✗'));
  }
  if (diag.length) webosSubsDiag.probe = directProbe.count + ' · ' + diag.join(', ');
}
function applyProbeAudioList(streams) {
  var vp = getEl('video-player'),
    at = vp && vp.audioTracks;
  if (!AppState.tizenAvplayActive || !at || !at.length || !streams.length) return false;
  var native = [];
  for (var i = 0; i < at.length; i++) native.push(at[i]);
  probeAudio.map = tizenAudioMap(native, streams);
  probeAudio.on = true;
  currentAudioTracks = streams.map(function (s, k) {
    return {
      title: probeTitle(s, 'audio', k),
      language: probeLang(s) || 'und',
      channels: s.channels || null,
      codec: (s.codec_name || '').toUpperCase(),
      probed: true
    };
  });
  if (nativeAudioPref >= 0 && nativeAudioPref < streams.length) {
    var tv = probeAudio.map[nativeAudioPref];
    nativeAudioPref = -1;
    if (tv >= 0) for (var j = 0; j < at.length; j++) at[j].enabled = j === tv;
  }
  currentAudioTrack = 0;
  for (var k = 0; k < at.length; k++) {
    if (!at[k].enabled) continue;
    var item = probeAudio.map.indexOf(k);
    if (item >= 0) currentAudioTrack = item;
    break;
  }
  renderAudioTracks();
  return true;
}
function tizenAudioMap(native, streams) {
  var map = [],
    used = [];
  var codec = function (c) {
    c = String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return c === 'ec3' ? 'eac3' : c === 'mp4a' ? 'aac' : c;
  };
  var tests = [function (t, s) {
    return codec(t.codec) === codec(s.codec_name) && (parseInt(t.channels, 10) || 0) === (parseInt(s.channels, 10) || 0);
  }, function (t, s) {
    return codec(t.codec) === codec(s.codec_name);
  }, function () {
    return true;
  }];
  for (var p = 0; p < tests.length; p++) {
    for (var k = 0; k < streams.length; k++) {
      if (map[k] !== undefined) continue;
      var want = langKey(probeLang(streams[k]));
      for (var i = 0; i < native.length; i++) {
        var have = langKey(native[i].language);
        if (used[i] || want && have && want !== have || !tests[p](native[i], streams[k])) continue;
        map[k] = i;
        used[i] = true;
        break;
      }
    }
  }
  for (var n = 0; n < streams.length; n++) if (map[n] === undefined) map[n] = -1;
  return map;
}
function directProbeGaveUp() {
  if (!AppState.tizenAvplayActive || probeAudio.on) return;
  probeAudio.gaveUp = true;
  var vp = getEl('video-player');
  var index = applyNativeAudioPref(vp);
  if (index < 0) return;
  currentAudioTrack = index;
  renderAudioTracks();
}
var DIRECT_PROBE_WS = 'ws://185.204.0.61:8080/';
var DIRECT_PROBE_TIMEOUT_MS = 15000;
var DIRECT_PROBE_LUNA_WAIT_MS = 8000;
var TIZEN_TRACKS_PORT = 8096;
var TIZEN_FFPROBE_PORT = 8095;
var TIZEN_FFPROBE_WAIT_MS = 20000;
var tizenServiceBase = {};
var tizenOwnIp = '';
function detectTizenIp() {
  if (tizenOwnIp) return tizenOwnIp;
  try {
    if (window.webapis && webapis.network && typeof webapis.network.getIp === 'function') tizenOwnIp = webapis.network.getIp() || '';
  } catch (e) {}
  return tizenOwnIp;
}
if (window.AppState && AppState.tizenApp && window.tizen && tizen.systeminfo) {
  ['ETHERNET_NETWORK', 'WIFI_NETWORK'].forEach(function (prop) {
    try {
      tizen.systeminfo.getPropertyValue(prop, function (n) {
        if (!tizenOwnIp && n && n.ipAddress && n.ipAddress !== '0.0.0.0') tizenOwnIp = n.ipAddress;
      }, function () {});
    } catch (e) {}
  });
}
function tizenServiceBases(port) {
  if (tizenServiceBase[port]) return [tizenServiceBase[port]];
  var list = [],
    ip = detectTizenIp();
  if (ip) list.push('http://' + ip + ':' + port);
  list.push('http://127.0.0.1:' + port);
  return list;
}
function tizenServiceGet(port, path, timeoutMs, cb) {
  var bases = tizenServiceBases(port),
    i = 0;
  var next = function (lastErr) {
    if (i >= bases.length) {
      cb(lastErr || 'служба не установлена или не запущена', null, null);
      return;
    }
    var base = bases[i++],
      x = new XMLHttpRequest();
    try {
      x.open('GET', base + path, true);
      x.timeout = timeoutMs;
      x.onload = function () {
        tizenServiceBase[port] = base;
        cb(null, x, base);
      };
      x.onerror = function () {
        next('служба не установлена или не запущена');
      };
      x.ontimeout = function () {
        cb('нет ответа', null, base);
      };
      x.send();
    } catch (e) {
      next(e.message);
    }
  };
  next(null);
}
window.tizenServiceGet = tizenServiceGet;
window.TIZEN_TRACKS_PORT = TIZEN_TRACKS_PORT;
window.TIZEN_FFPROBE_PORT = TIZEN_FFPROBE_PORT;
function directProbeUri(hash, fileId) {
  var playURL = AppState.currentTorrserverUrl + '/stream?link=' + hash + '&index=' + fileId + '&play=play';
  var uri = playURL.replace(/^(https?:\/\/)localhost(?=[:\/]|$)/i, '$1127.0.0.1');
  if (AppState.authEnabled && AppState.authLogin) {
    uri = uri.replace(/^(https?:\/\/)/, '$1' + encodeURIComponent(AppState.authLogin) + ':' + encodeURIComponent(AppState.authPassword || '') + '@');
  }
  return uri;
}
function serverInfoStreams(entry, hash, fileId) {
  if (!entry || entry.hash !== hash || String(entry.fileId) !== String(fileId) || !entry.info) return [];
  var info = entry.info,
    out = [];
  var clean = function (v, generic) {
    v = v || '';
    return generic.test(v) || v === 'unknown' ? '' : v;
  };
  (info.audio || []).forEach(function (a) {
    out.push({
      codec_type: 'audio',
      codec_name: a.codec || '',
      channels: a.channels || null,
      tags: {
        language: clean(a.language, /^$/),
        title: clean(a.title, /^Дорожка \d+$/)
      },
      disposition: {
        default: a['default'] ? 1 : 0
      }
    });
  });
  (info.subtitles || []).forEach(function (t) {
    out.push({
      codec_type: 'subtitle',
      codec_name: t.codec || t.format || '',
      tags: {
        language: clean(t.language, /^$/),
        title: clean(t.title, /^Субтитры \d+$/)
      },
      disposition: {
        default: t['default'] ? 1 : 0,
        forced: t.forced ? 1 : 0
      }
    });
  });
  return out;
}
function directProbeStart() {
  directProbe.streams = null;
  directProbe.count = '';
  probeAudio.on = false;
  probeAudio.map = [];
  probeAudio.gaveUp = false;
  var gen = ++directProbe.gen;
  var hash = currentTimecodeData.hash,
    fileId = currentTimecodeData.fileId;
  var done = function (streams, via) {
    if (gen !== directProbe.gen || directProbe.streams || !streams || !streams.length) return;
    directProbe.streams = streams;
    directProbe.count = 'потоков: ' + streams.length + ' (' + via + ')';
    webosSubsDiag.probe = directProbe.count;
    directPlaybackDiag.probe = directProbe.count;
    if (AppState.transcodingFullOnOff && nativeSubState.mode !== 'webos' && AppState.platform !== 'webos' && AppState.currentScreen === 'player') refreshNativeSubtitles(getEl('video-player'));else applyDirectProbe();
  };
  if (!hash || fileId === undefined || fileId === null) return;
  var fromServer = serverInfoStreams(directProbe.serverInfo, hash, fileId);
  var cubFirst = AppState.platform === 'tizen';
  if (fromServer.length && !cubFirst) {
    done(fromServer, 'сервер');
    return;
  }
  var serverFallback = function () {
    if (fromServer.length) done(fromServer, 'сервер');else if (gen === directProbe.gen && !directProbe.streams) directProbeGaveUp();
  };
  var cubStarted = false;
  var startCub = function () {
    if (cubStarted || gen !== directProbe.gen || directProbe.streams || typeof WebSocket !== 'function') return;
    cubStarted = true;
    var socket = null,
      timer = null;
    var finish = function () {
      clearTimeout(timer);
      try {
        if (socket) socket.close();
      } catch (e) {}
      socket = null;
    };
    directPlaybackDiag.probe = 'сервис: запрос…';
    try {
      socket = new WebSocket(DIRECT_PROBE_WS + '?' + hash + '&index=' + fileId);
      socket.onmessage = function (event) {
        var json = null;
        try {
          json = JSON.parse(event.data);
        } catch (e) {}
        finish();
        if (!(json && json.streams && json.streams.length) && !directProbe.streams) {
          directPlaybackDiag.probe = 'сервис: пустой ответ';
          serverFallback();
          return;
        }
        done(json && json.streams, 'сервис');
      };
      socket.onerror = function () {
        finish();
        if (!directProbe.streams) directPlaybackDiag.probe = 'сервис: ошибка соединения' + (location.protocol === 'https:' ? ' (страница по https)' : '');
        serverFallback();
      };
      timer = setTimeout(function () {
        finish();
        if (!directProbe.streams) directPlaybackDiag.probe = 'сервис: нет ответа за ' + DIRECT_PROBE_TIMEOUT_MS / 1000 + ' с';
        serverFallback();
      }, DIRECT_PROBE_TIMEOUT_MS);
    } catch (e) {
      finish();
      directPlaybackDiag.probe = 'сервис: ' + e.message;
      serverFallback();
    }
  };
  if (AppState.tizenApp) {
    setTimeout(startCub, TIZEN_FFPROBE_WAIT_MS);
    directPlaybackDiag.probe = 'на ТВ: запрос…';
    directPlaybackDiag.local = 'запрос…';
    var asked = Date.now();
    var probePath = '/ffprobe?url=' + encodeURIComponent(directProbeUri(hash, fileId));
    var localWhy = [];
    var localNote = function (text) {
      if (gen === directProbe.gen) directPlaybackDiag.local = text + ' за ' + Math.round((Date.now() - asked) / 100) / 10 + ' с';
    };
    var askService = function (port, label, next) {
      tizenServiceGet(port, probePath, 70000, function (err, tx, base) {
        var parsed = null;
        if (!err) {
          try {
            parsed = JSON.parse(tx.responseText || '{}');
          } catch (e) {}
        }
        if (parsed && parsed.streams && parsed.streams.length) {
          localNote(label + ': потоков ' + parsed.streams.length + ' (' + base.replace(/^http:\/\//, '') + ')');
          done(parsed.streams, label);
          return;
        }
        localWhy.push(label + ': ' + (err || parsed && parsed.error || 'пустой ответ, HTTP ' + tx.status));
        next();
      });
    };
    askService(TIZEN_TRACKS_PORT, 'MKV/MP4 на ТВ', function () {
      askService(TIZEN_FFPROBE_PORT, 'ffprobe на ТВ', function () {
        localNote('ошибка: ' + localWhy.join('; '));
        if (gen !== directProbe.gen || directProbe.streams) return;
        directPlaybackDiag.probe = localWhy.join('; ');
        startCub();
      });
    });
    return;
  }
  if (AppState.platform !== 'webos' || !lunaAvailable()) {
    startCub();
    return;
  }
  setTimeout(startCub, DIRECT_PROBE_LUNA_WAIT_MS);
  var uri = directProbeUri(hash, fileId);
  webosSubsDiag.probe = 'запрос…';
  lunaRequest('luna://com.torrstream.app.service', 'ffprobe', {
    uri: uri
  }, function (r) {
    if (gen !== directProbe.gen) return;
    var parsed = null;
    try {
      parsed = JSON.parse(r.data || '{}');
    } catch (e) {}
    if (!parsed || !parsed.streams || !parsed.streams.length) {
      if (!directProbe.streams) webosSubsDiag.probe = 'служба: пустой ответ';
      startCub();
      return;
    }
    done(parsed.streams, 'служба');
  }, function (r) {
    if (gen !== directProbe.gen || directProbe.streams) return;
    webosSubsDiag.probe = 'служба: ошибка ' + (r && (r.errorText || r.errorCode) || '?');
    startCub();
  }, true);
}
function webosSubsStart(videoPlayer, staleId) {
  webosSubsReset();
  if (AppState.platform !== 'webos' || !videoPlayer) return;
  webosSubsDiag.bridge = lunaBridgeName() || 'нет';
  webosSubsDiag.mediaId = '';
  webosSubsDiag.waitedMs = 0;
  webosSubsDiag.responses = 0;
  webosSubsDiag.keys = '';
  webosSubsDiag.sourceInfo = false;
  webosSubsDiag.tracks = null;
  webosSubsDiag.error = '';
  if (!lunaAvailable()) return;
  var gen = ++webosSubs.gen;
  var startedAt = Date.now();
  webosSubs.timer = setInterval(function () {
    var waited = Date.now() - startedAt;
    webosSubsDiag.waitedMs = waited;
    if (gen !== webosSubs.gen || AppState.currentScreen !== 'player' || waited > 30000) {
      webosSubsCancel();
      return;
    }
    var id = videoPlayer.mediaId;
    if (id && /^<|invalid/i.test(String(id))) {
      webosSubsDiag.mediaId = String(id) + ' (ждём)';
      return;
    }
    if (!id || id === staleId && waited < 3000) return;
    clearInterval(webosSubs.timer);
    webosSubs.timer = null;
    webosSubs.mediaId = id;
    webosSubsDiag.mediaId = String(id);
    var deadline = setTimeout(function () {
      if (gen === webosSubs.gen && !webosSubs.list) {
        if (!webosSubsDiag.error) webosSubsDiag.error = 'sourceInfo не пришёл за 20 с';
        webosSubsCancel();
      }
    }, 20000);
    webosSubs.bridge = lunaCall('subscribe', {
      mediaId: id,
      subscribe: true
    }, function (r) {
      if (gen !== webosSubs.gen || webosSubs.list) return;
      webosSubsDiag.responses++;
      if (r && !webosSubsDiag.keys) webosSubsDiag.keys = Object.keys(r).join(',');
      if (!r || !r.sourceInfo) return;
      webosSubsDiag.sourceInfo = true;
      clearTimeout(deadline);
      webosSubsApply((r.sourceInfo.programInfo || [])[0] || {});
      webosSubsCancel();
    });
  }, 300);
  webosSubs.onSeeked = function () {
    if (webosSubs.enabled && webosSubs.index >= 0) webosSetSubtitle(webosSubs.index);
  };
  videoPlayer.addEventListener('seeked', webosSubs.onSeeked);
}
function webosSubsReset() {
  webosSubs.gen++;
  webosSubsCancel();
  var v = getEl('video-player');
  if (v && webosSubs.onSeeked) v.removeEventListener('seeked', webosSubs.onSeeked);
  webosSubs.onSeeked = null;
  webosSubs.mediaId = null;
  webosSubs.list = null;
  webosSubs.enabled = false;
  webosSubs.index = -1;
  webosAudio.mode = false;
  webosAudio.list = [];
  if (nativeSubState.mode === 'webos') nativeSubState.mode = 'tracks';
}
var nativeSubState = {
  tracks: [],
  savedPref: -1,
  listening: false,
  mode: 'tracks',
  waitTimer: null,
  snapTimer: null,
  fromProbe: false,
  tvIndex: -1
};
function collectNativeTextTracks(videoPlayer) {
  var list = videoPlayer && videoPlayer.textTracks,
    out = [];
  if (!list) return out;
  for (var i = 0; i < list.length; i++) {
    if (list[i].kind === 'chapters' || list[i].kind === 'descriptions') continue;
    out.push(list[i]);
  }
  return out;
}
function watchCuesRaise(videoPlayer) {
  var controls = getEl('controls-container');
  if (!videoPlayer || !controls || videoPlayer._cuesRaiseWatched || typeof MutationObserver !== 'function') return;
  videoPlayer._cuesRaiseWatched = true;
  var sync = function () {
    videoPlayer.classList.toggle('cues-raised', !controls.classList.contains('idle-hidden'));
  };
  new MutationObserver(sync).observe(controls, {
    attributes: true,
    attributeFilter: ['class']
  });
  sync();
}
function applyNativeSubtitle(index) {
  var tracks = collectNativeTextTracks(getEl('video-player'));
  nativeSubState.tracks = tracks;
  var tv = nativeTrackForItem(index, tracks);
  for (var i = 0; i < tracks.length; i++) {
    try {
      tracks[i].mode = i === tv ? 'showing' : 'disabled';
    } catch (e) {}
  }
  var total = Math.max(tracks.length, currentSubTracks ? currentSubTracks.length : 0);
  currentSubtitleTrack = index >= 0 && index < total ? index : -1;
  nativeSubState.tvIndex = tv;
  return tv >= 0;
}
function isImageSubStream(s) {
  return !TEXT_SUB_CODECS[s.codec_name];
}
function nativeTrackForItem(index, tracks) {
  if (index < 0) return -1;
  if (!nativeSubState.fromProbe) return index < tracks.length ? index : -1;
  var probeSubs = directProbeSubs();
  var map = matchProbeByLanguage(tracks, probeSubs, isImageSubStream, true);
  for (var i = 0; i < map.length; i++) if (map[i] && map[i] === probeSubs[index]) return i;
  if (!langsOverlap(tracks, probeSubs)) return index < tracks.length ? index : -1;
  return -1;
}
function langsOverlap(tracks, streams) {
  var have = {};
  for (var j = 0; j < streams.length; j++) {
    var l = langKey(probeLang(streams[j]));
    if (l) have[l] = true;
  }
  for (var i = 0; i < tracks.length; i++) {
    var k = langKey(tracks[i].language);
    if (k && have[k]) return true;
  }
  return false;
}
function directProbeSubs() {
  var streams = directProbe.streams || [],
    out = [];
  for (var i = 0; i < streams.length; i++) if (streams[i].codec_type === 'subtitle') out.push(streams[i]);
  return out;
}
function refreshNativeSubtitles(videoPlayer) {
  if (!AppState.transcodingFullOnOff) return;
  if (nativeSubState.mode === 'webos') return;
  updateDirectTrackDiag(videoPlayer);
  var tracks = collectNativeTextTracks(videoPlayer);
  nativeSubState.tracks = tracks;
  var probeSubs = AppState.platform !== 'webos' ? directProbeSubs() : [];
  nativeSubState.fromProbe = probeSubs.length > tracks.length || !!AppState.tizenAvplayActive && probeSubs.length > 0;
  if (nativeSubState.fromProbe) {
    currentSubTracks = probeSubs.map(function (st, k) {
      var d = st.disposition || {};
      return {
        title: probeTitle(st, 'subtitle', k),
        language: probeLang(st) || 'und',
        format: (st.codec_name || '').toUpperCase(),
        default: !!d.default,
        forced: !!d.forced,
        probed: true
      };
    });
  } else {
    currentSubTracks = tracks.map(function (t, i) {
      return {
        title: t.label || 'Субтитры ' + (i + 1),
        language: t.language || 'und',
        format: ''
      };
    });
  }
  var want = currentSubtitleTrack >= 0 ? currentSubtitleTrack : nativeSubState.savedPref;
  want = want >= 0 && want < currentSubTracks.length ? want : -1;
  if (!applyNativeSubtitle(want) && want >= 0) waitNativeSubtitle(want);
  renderSubtitleTracks();
  applyDirectProbe();
}
function listenNativeTextTracks(videoPlayer) {
  watchCuesRaise(videoPlayer);
  if (nativeSubState.listening || !videoPlayer || !videoPlayer.textTracks || typeof videoPlayer.textTracks.addEventListener !== 'function') return;
  nativeSubState.listening = true;
  var onChange = function () {
    if (AppState.transcodingFullOnOff && AppState.currentScreen === 'player') refreshNativeSubtitles(videoPlayer);
  };
  videoPlayer.textTracks.addEventListener('addtrack', onChange);
  videoPlayer.textTracks.addEventListener('removetrack', onChange);
}
var NATIVE_SUB_WAIT_MS = 30000;
function waitNativeSubtitle(index) {
  clearInterval(nativeSubState.waitTimer);
  var started = Date.now();
  nativeSubState.waitTimer = setInterval(function () {
    var gone = AppState.currentScreen !== 'player' || currentSubtitleTrack !== index;
    if (gone || Date.now() - started > NATIVE_SUB_WAIT_MS) {
      clearInterval(nativeSubState.waitTimer);
      return;
    }
    if (applyNativeSubtitle(index)) {
      clearInterval(nativeSubState.waitTimer);
      updateDirectTrackDiag(getEl('video-player'));
    }
  }, 1000);
}
function snapshotNativeSubs() {
  var tracks = collectNativeTextTracks(getEl('video-player'));
  var item = currentSubTracks && currentSubTracks[currentSubtitleTrack];
  var parts = [];
  for (var i = 0; i < tracks.length; i++) {
    var t = tracks[i],
      cues = null,
      active = null;
    try {
      cues = t.cues ? t.cues.length : null;
      active = t.activeCues;
    } catch (e) {}
    var txt = active && active.length ? String(active[0].text || '').replace(/\s+/g, ' ').slice(0, 24) : '';
    parts.push(i + 1 + ' ' + (t.language || '?') + (t.label ? ' «' + t.label + '»' : '') + ' ' + t.mode + (cues !== null ? ' реплик ' + cues : '') + (txt ? ' «' + txt + '»' : ''));
  }
  directPlaybackDiag.subs = 'пункт ' + (currentSubtitleTrack + 1) + (item ? ' «' + item.title + '»' : '') + ' → дорожка ' + (nativeSubState.tvIndex >= 0 ? nativeSubState.tvIndex + 1 : 'нет') + (nativeSubState.fromProbe ? ' (список из ffprobe)' : '') + ' | ' + parts.join(' | ');
}
function resetNativeSubtitles() {
  webosSubsReset();
  clearInterval(nativeSubState.waitTimer);
  clearTimeout(nativeSubState.snapTimer);
  applyNativeSubtitle(-1);
  nativeSubState.tracks = [];
}
function switchNativeSubtitleTrack(index) {
  if (nativeSubState.mode === 'webos') {
    webosSetSubtitle(index);
    currentSubtitleTrack = index >= 0 ? index : -1;
  } else {
    if (!applyNativeSubtitle(index) && index >= 0) waitNativeSubtitle(index);
    clearTimeout(nativeSubState.snapTimer);
    nativeSubState.snapTimer = setTimeout(snapshotNativeSubs, 3000);
  }
  if (currentTimecodeData.hash && currentTimecodeData.fileId) {
    saveSubtitlePreference(currentTimecodeData.hash, currentTimecodeData.fileId, currentSubtitleTrack);
  }
  renderSubtitleTracks();
  toggleSubtitlesPanel();
}
function toggleAudioPanel() {
  return togglePlayerPanel('audio');
}
function setupAudioButton() {
  var closeAudioBtn = getEl('close-audio');
  var audioPanel = getEl('audio-panel');
  if (!closeAudioBtn || !audioPanel) return;
  setupAudioListDelegation();
  closeAudioBtn.addEventListener('click', function () {
    setPlayerPanel('audio', false);
    resetMouseIdleTimer();
  });
  setupPlayerPanelsOutsideClick();
}
function saveAudioPreference(_x61, _x62, _x63) {
  return _saveAudioPreference.apply(this, arguments);
}
function _saveAudioPreference() {
  _saveAudioPreference = _asyncToGenerator(function* (hash, fileId, audioTrack) {
    try {
      var savedClientId = localStorage.getItem('clientId');
      var response = yield bgFetch(SERVER_URL + '/api/audio/pref/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          hash: hash,
          fileId: fileId,
          audioTrack: audioTrack,
          clientId: savedClientId
        })
      });
    } catch (error) {}
  });
  return _saveAudioPreference.apply(this, arguments);
}
function loadMediaPreferences(_x64, _x65) {
  return _loadMediaPreferences.apply(this, arguments);
}
function _loadMediaPreferences() {
  _loadMediaPreferences = _asyncToGenerator(function* (hash, fileId) {
    var savedClientId = localStorage.getItem('clientId');
    var query = '?hash=' + hash + '&fileId=' + fileId + '&clientId=' + encodeURIComponent(savedClientId);
    try {
      var response = yield fetchWithTimeout(SERVER_URL + '/api/media/prefs/get' + query);
      if (response.ok) {
        var data = yield response.json();
        if (data.success) {
          return {
            audioTrack: data.audioTrack !== null && data.audioTrack !== undefined ? data.audioTrack : null,
            subtitleTrack: data.subtitleTrack !== null && data.subtitleTrack !== undefined ? data.subtitleTrack : -1
          };
        }
      }
    } catch (error) {}
    var pair = yield Promise.all([loadAudioPreference(hash, fileId), loadSubtitlePreference(hash, fileId)]);
    return {
      audioTrack: pair[0],
      subtitleTrack: pair[1]
    };
  });
  return _loadMediaPreferences.apply(this, arguments);
}
function loadPlaybackPrepare(_x66, _x67, _x68) {
  return _loadPlaybackPrepare.apply(this, arguments);
}
function _loadPlaybackPrepare() {
  _loadPlaybackPrepare = _asyncToGenerator(function* (hash, fileId, wantTimecode) {
    if (AppState.tizenApp) {
      var quick = yield Promise.all([loadMediaPreferences(hash, fileId), wantTimecode ? loadTimecodeFromServer(hash, fileId) : Promise.resolve(null)]);
      var quickPrefs = quick[0] || {};
      return {
        fileInfo: null,
        audioTrack: quickPrefs.audioTrack !== undefined ? quickPrefs.audioTrack : null,
        subtitleTrack: quickPrefs.subtitleTrack !== undefined ? quickPrefs.subtitleTrack : -1,
        timecode: quick[1]
      };
    }
    var savedClientId = localStorage.getItem('clientId');
    var url = SERVER_URL + '/api/playback/prepare?hash=' + hash + '&fileId=' + fileId + '&clientId=' + encodeURIComponent(savedClientId) + (wantTimecode ? '&timecode=1' : '');
    var timedOut = false;
    try {
      var needsFileInfo = !AppState.transcodingOnOff && !AppState.transcodingFullOnOff;
      var response = yield fetchWithTimeout(url, null, needsFileInfo ? FILE_INFO_FETCH_TIMEOUT_MS : DIRECT_PREPARE_TIMEOUT_MS);
      if (response.ok) {
        var data = yield response.json();
        if (data && data.success) {
          if (data.fileInfoError) console.warn('⚠️ /api/playback/prepare: ' + data.fileInfoError);
          var prefs = data.prefs || {};
          return {
            fileInfo: data.fileInfo || null,
            audioTrack: prefs.audioTrack !== null && prefs.audioTrack !== undefined ? prefs.audioTrack : null,
            subtitleTrack: prefs.subtitleTrack !== null && prefs.subtitleTrack !== undefined ? prefs.subtitleTrack : -1,
            timecode: wantTimecode ? data.timecode || 0 : null
          };
        }
      }
      console.warn('⚠️ /api/playback/prepare вернул HTTP ' + response.status + ' — старые запросы');
    } catch (error) {
      timedOut = !!(error && error.name === 'AbortError');
      console.warn('⚠️ /api/playback/prepare недоступен:', timedOut ? 'таймаут' : error && error.message);
    }
    var results = yield Promise.all([timedOut ? Promise.resolve(null) : loadFileInfo(hash, fileId), loadMediaPreferences(hash, fileId), wantTimecode ? loadTimecodeFromServer(hash, fileId) : Promise.resolve(null)]);
    var fallbackPrefs = results[1] || {};
    return {
      fileInfo: results[0],
      audioTrack: fallbackPrefs.audioTrack !== undefined ? fallbackPrefs.audioTrack : null,
      subtitleTrack: fallbackPrefs.subtitleTrack !== undefined ? fallbackPrefs.subtitleTrack : -1,
      timecode: results[2]
    };
  });
  return _loadPlaybackPrepare.apply(this, arguments);
}
function loadAudioPreference(_x69, _x70) {
  return _loadAudioPreference.apply(this, arguments);
}
function _loadAudioPreference() {
  _loadAudioPreference = _asyncToGenerator(function* (hash, fileId) {
    try {
      var savedClientId = localStorage.getItem('clientId');
      var response = yield fetchWithTimeout(SERVER_URL + '/api/audio/pref/get?hash=' + hash + '&fileId=' + fileId + '&clientId=' + encodeURIComponent(savedClientId));
      if (response.ok) {
        var data = yield response.json();
        if (data.success && data.audioTrack !== null) return data.audioTrack;
      }
    } catch (error) {}
    return null;
  });
  return _loadAudioPreference.apply(this, arguments);
}
function renderSubtitleTracks() {
  var subtitlesList = getEl('subtitles-list');
  if (!subtitlesList) return;
  if (!currentSubTracks || currentSubTracks.length === 0) {
    subtitlesList.innerHTML = '<div class="search-result-empty">Нет субтитров</div>';
    return;
  }
  var html = '';
  var isOff = currentSubtitleTrack === -1;
  html += '<div class="subtitle-item ' + (isOff ? 'active' : '') + '" data-track-index="-1"><div class="subtitle-icon">🚫</div><div class="subtitle-info"><div class="subtitle-title">Выключить субтитры</div></div><div class="subtitle-check">✓</div></div>';
  for (var idx = 0; idx < currentSubTracks.length; idx++) {
    var sub = currentSubTracks[idx];
    var isActive = idx === currentSubtitleTrack;
    var language = sub.language || 'unknown';
    var format = sub.format || sub.codec || '';
    var title = sub.title || 'Субтитры ' + (idx + 1);
    var badges = '';
    if (sub.default) badges += ' <span style="color: #4eff6a; font-size: 0.6em;">[DEFAULT]</span>';
    if (sub.forced) badges += ' <span style="color: #ffd966; font-size: 0.6em;">[FORCED]</span>';
    html += '<div class="subtitle-item ' + (isActive ? 'active' : '') + '" data-track-index="' + idx + '"><div class="subtitle-icon">💬</div><div class="subtitle-info"><div class="subtitle-title">' + escapeHtml(title) + badges + '</div><div class="subtitle-details"><span class="subtitle-language">' + language.toUpperCase() + '</span>' + (format ? '<span class="subtitle-format">' + escapeHtml(format) + '</span>' : '') + '</div></div><div class="subtitle-check">✓</div></div>';
  }
  subtitlesList.innerHTML = html;
  setupSubtitlesListDelegation();
}
function switchSubtitleTrack(_x71) {
  return _switchSubtitleTrack.apply(this, arguments);
}
function _switchSubtitleTrack() {
  _switchSubtitleTrack = _asyncToGenerator(function* (trackIndex) {
    if (trackIndex === currentSubtitleTrack) {
      toggleSubtitlesPanel();
      return;
    }
    if (trackIndex >= 0) OnlineSubs.off(false);
    if (AppState.transcodingFullOnOff) {
      switchNativeSubtitleTrack(trackIndex);
      return;
    }
    if (AppState.serverTracks && (trackIndex === -1 || serverSubEntry(trackIndex) || isTextSubtitle(trackIndex))) {
      var subInStream = trackIndex === -1 || !!serverSubEntry(trackIndex);
      currentSubtitleTrack = trackIndex;
      if (trackIndex === -1) ServerSubs.stop();else if (subInStream) ServerSubs.select(trackIndex);
      if (currentTimecodeData.hash && currentTimecodeData.fileId) saveSubtitlePreference(currentTimecodeData.hash, currentTimecodeData.fileId, trackIndex);
      renderSubtitleTracks();
      toggleSubtitlesPanel();
      if (!subInStream) restartServerGeneration('субтитров');
      return;
    }
    thisisseek = false;
    yield saveTimecodeToServer();
    if (currentTimecodeData.hash && currentTimecodeData.fileId) yield saveSubtitlePreference(currentTimecodeData.hash, currentTimecodeData.fileId, trackIndex);
    setPlayerPanel('subtitles', false);
    var videoPlayer = getEl('video-player');
    var currentTime = videoPlayer ? videoPlayer.currentTime + AppState.seekOffset : 0;
    getEl('playback-overlay').classList.add('active');
    document.querySelector('.playback-text').textContent = 'Переключение субтитров...';
    try {
      var parsed = AppState.videoUrl.match(/\/play\/([a-fA-F0-9]+)\/(\d+)/);
      if (!parsed) return;
      var hash = parsed[1];
      var fileId = parsed[2];
      var playUrl = AppState.currentTorrserverUrl + '/play/' + hash + '/' + fileId;
      if (AppState.currentStreamId) {
        yield bgFetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, {
          method: 'POST'
        });
        AppState.currentStreamId = null;
      }
      destroyHls();
      currentSubtitleTrack = trackIndex;
      yield startHLSPlayback(playUrl, currentTime, lastPlaybackFromSearch, currentEpisodeIndex, currentAudioTrack);
      renderSubtitleTracks();
    } catch (error) {
      showSwitchFailedBanner('субтитры', error && error.message);
    } finally {
      getEl('playback-overlay').classList.remove('active');
      document.querySelector('.playback-text').textContent = 'Воспроизведение...';
    }
  });
  return _switchSubtitleTrack.apply(this, arguments);
}
function toggleSubtitlesPanel() {
  return togglePlayerPanel('subtitles');
}
var ONLINE_SUBS_LANGS = [{
  code: 'ru',
  os: 'rus',
  label: 'Русские'
}, {
  code: 'uk',
  os: 'ukr',
  label: 'Украинские'
}, {
  code: 'en',
  os: 'eng',
  label: 'Английские'
}];
var ONLINE_SUBS_PER_LANG = 15;
var ONLINE_SUBS_STEP_SEC = 0.5;
var ONLINE_SUBS_TICK_MS = 200;
var ONLINE_SUBS_RESTORE_DELAY_MS = 4000;
var ONLINE_SUBS_STORE_KEY = 'onlineSubs';
var ONLINE_SUBS_STORE_MAX = 300;
var ONLINE_SUBS_FETCH_MS = 12000;
var TSDB_API = 'https://api.thesubtitledb.org/v1/';
var OS_STREMIO_API = 'https://opensubtitles-v3.strem.io/subtitles/';
var ONLINE_SUBS_FORMATS = {
  srt: 1,
  vtt: 1,
  webvtt: 1,
  ass: 1,
  ssa: 1
};
function onlineSubsLang(code) {
  code = String(code || '').toLowerCase();
  for (var i = 0; i < ONLINE_SUBS_LANGS.length; i++) {
    var l = ONLINE_SUBS_LANGS[i];
    if (code === l.code || code === l.os) return l;
  }
  return null;
}
function getOnlineSubsTarget(hash, fileId) {
  if (!hash) return null;
  var h = String(hash).toLowerCase();
  var item = AppState.currentDetailItem;
  var torrent = findLoadedTorrent(h) || (item && item.hash && String(item.hash).toLowerCase() === h ? item : null) || {
    hash: h
  };
  var known = typeof knownTorrentMeta !== 'undefined' && knownTorrentMeta ? knownTorrentMeta.get(h) : null;
  var type = torrent.media_type || known && known.mediaType || null;
  if (type !== 'movie') {
    var ep = resolveSkipTarget(torrent, fileId);
    if (ep) return {
      tmdbId: ep.tmdbId,
      type: 'tv',
      season: ep.season,
      episode: ep.episode
    };
    if (type === 'tv') return null;
  }
  var tmdbId = parseInt(getTorrentTmdbId(torrent) || AppState.currentTMDB || '', 10);
  return tmdbId > 0 ? {
    tmdbId: tmdbId,
    type: 'movie',
    season: null,
    episode: null
  } : null;
}
window.getOnlineSubsTarget = getOnlineSubsTarget;
function onlineSubsPayload(hash, fileId) {
  var t = getOnlineSubsTarget(hash, fileId);
  return t ? {
    tmdb_id: t.tmdbId,
    type: t.type,
    season: t.season,
    episode: t.episode
  } : null;
}
var ONLINE_SUBS_PROXY_TIMEOUT_MS = 8000;
var ONLINE_SUBS_PROXY_REST_MS = 5 * 60 * 1000;
var onlineSubsProxyDownUntil = 0;
function onlineSubsProxied(url) {
  var host = AppState.subsApiHost;
  if (!host || Date.now() < onlineSubsProxyDownUntil) return null;
  var m = String(url).match(/^https:\/\/(api\.thesubtitledb\.org|opensubtitles-v3\.strem\.io|subs\d*\.strem\.io)\/(.*)$/);
  if (!m) return null;
  var prefix = m[1] === 'api.thesubtitledb.org' ? '/tsdb/' : m[1] === 'opensubtitles-v3.strem.io' ? '/os/' : '/strem/' + m[1] + '/';
  return AppState.protocol + '//' + host + prefix + m[2];
}
function onlineSubsDirect(url) {
  var m = String(url || '').match(/^https?:\/\/([^\/]+)\/(tsdb|os|strem\/(subs\d*\.strem\.io))\/(.*)$/);
  if (!m || !AppState.subsApiHost || m[1].split(':')[0] !== AppState.subsApiHost.split(/[\/:]/)[0]) return url;
  var host = m[2] === 'tsdb' ? 'api.thesubtitledb.org' : m[2] === 'os' ? 'opensubtitles-v3.strem.io' : m[3];
  return 'https://' + host + '/' + m[4];
}
function onlineSubsFetch(url, timeoutMs) {
  var direct = function () {
    return fetchWithTimeout(url, {
      bgMode: 'buffer'
    }, timeoutMs);
  };
  var proxied = onlineSubsProxied(url);
  if (!proxied) return direct();
  var proxyFailed = function (e) {
    onlineSubsProxyDownUntil = Date.now() + ONLINE_SUBS_PROXY_REST_MS;
    console.warn('[онлайн-субтитры] прокси ' + AppState.subsApiHost + ' не ответил — напрямую:', e && e.message);
    return direct();
  };
  return fetchWithTimeout(proxied, {
    bgMode: 'buffer'
  }, Math.min(timeoutMs, ONLINE_SUBS_PROXY_TIMEOUT_MS)).then(function (r) {
    if (r.ok) return r;
    if (r.status >= 500) return proxyFailed(new Error('HTTP ' + r.status));
    return direct();
  }, proxyFailed);
}
function onlineSubsFetchJson(url) {
  return onlineSubsFetch(url, ONLINE_SUBS_FETCH_MS).then(function (r) {
    return r.ok ? r.json() : null;
  })['catch'](function () {
    return null;
  });
}
function tsdbItems(data, lang) {
  var items = data && data.subtitles && data.subtitles.items || [];
  var out = [];
  for (var i = 0; i < items.length; i++) {
    var s = items[i];
    var fmt = String(s.format || 'srt').toLowerCase();
    if (!s.download_url || !ONLINE_SUBS_FORMATS[fmt]) continue;
    out.push({
      lang: lang,
      url: onlineSubsDirect(s.download_url),
      format: fmt,
      encoding: s.encoding || '',
      name: String(s.release_name || '').trim(),
      hi: !!s.hearing_impaired,
      source: 'TheSubtitleDB'
    });
  }
  return out;
}
function searchOnlineSubs(t) {
  var base = TSDB_API + 'by-tmdb/' + t.type + '/' + t.tmdbId;
  var head = t.type === 'tv' ? onlineSubsFetchJson(base + '?limit=1') : Promise.resolve(null);
  return head.then(function (info) {
    var tsdbPath = null;
    var imdb = info && info.title && info.title.imdb;
    if (t.type === 'tv') {
      var seasons = info && info.seasons || [];
      for (var i = 0; i < seasons.length && !tsdbPath; i++) {
        var eps = seasons[i].episodes || [];
        for (var j = 0; j < eps.length; j++) {
          if (eps[j].season === t.season && eps[j].episode === t.episode && eps[j].imdb) {
            tsdbPath = TSDB_API + 'by-imdb/' + eps[j].imdb;
            break;
          }
        }
      }
    } else tsdbPath = base;
    var perLang = ONLINE_SUBS_LANGS.map(function (l) {
      if (!tsdbPath) return Promise.resolve({
        lang: l.code,
        data: null
      });
      return onlineSubsFetchJson(tsdbPath + '?lang=' + l.code + '&limit=' + ONLINE_SUBS_PER_LANG).then(function (data) {
        return {
          lang: l.code,
          data: data
        };
      });
    });
    return Promise.all(perLang).then(function (res) {
      for (var k = 0; k < res.length && !imdb; k++) imdb = res[k].data && res[k].data.title && res[k].data.title.imdb;
      var os = !imdb ? Promise.resolve(null) : onlineSubsFetchJson(OS_STREMIO_API + (t.type === 'tv' ? 'series/' + imdb + ':' + t.season + ':' + t.episode : 'movie/' + imdb) + '.json');
      return os.then(function (osData) {
        var list = [],
          seen = {};
        var add = function (s) {
          if (seen[s.url]) return;
          seen[s.url] = 1;
          list.push(s);
        };
        for (var a = 0; a < ONLINE_SUBS_LANGS.length; a++) {
          var lang = ONLINE_SUBS_LANGS[a],
            count = 0;
          var own = tsdbItems(res[a].data, lang.code);
          for (var b = 0; b < own.length && count < ONLINE_SUBS_PER_LANG; b++, count++) add(own[b]);
          var subs = osData && osData.subtitles || [];
          for (var c = 0; c < subs.length && count < ONLINE_SUBS_PER_LANG; c++) {
            var s = subs[c];
            if (!s.url || onlineSubsLang(s.lang) !== lang) continue;
            var osUrl = onlineSubsDirect(s.url);
            add({
              lang: lang.code,
              url: osUrl,
              format: 'srt',
              encoding: 'utf-8',
              name: String(s.subtitleFileName || s.movieReleaseName || '').trim(),
              hi: false,
              source: 'OpenSubtitles'
            });
            count++;
          }
        }
        return list;
      });
    });
  });
}
function decodeSubtitleBytes(buf, declared) {
  try {
    return new TextDecoder('utf-8', {
      fatal: true
    }).decode(buf);
  } catch (e) {}
  var enc = String(declared || '').toLowerCase().replace(/[_\s]/g, '-');
  var cp = enc.match(/^(?:cp|windows-?)(\d{3,4})$/);
  try {
    return new TextDecoder(cp ? 'windows-' + cp[1] : 'windows-1251').decode(buf);
  } catch (e) {}
  return new TextDecoder('utf-8').decode(buf);
}
function cleanSubtitleText(s) {
  return s.replace(/\{[^}]*\}/g, '').replace(/<[^>]*>/g, '').replace(/\\N/gi, '\n').replace(/\\h/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/[ \t]+\n/g, '\n').trim();
}
function parseSubtitleCues(text) {
  text = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  var cues = [],
    i,
    lines;
  var time = function (v) {
    return ServerSubs.parseTime(String(v).replace(',', '.'));
  };
  if (/^\s*\[Script Info\]/i.test(text) || /\n\[Events\]/i.test(text)) {
    lines = text.split('\n');
    var fmt = null;
    for (i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^Format:/i.test(line)) fmt = line.slice(7).split(',').map(function (f) {
        return f.trim().toLowerCase();
      });else if (fmt && /^Dialogue:/i.test(line)) {
        var parts = line.slice(9).split(',');
        var tail = parts.splice(fmt.length - 1).join(',');
        parts.push(tail);
        var body = cleanSubtitleText(parts[fmt.indexOf('text')] || '');
        if (body) cues.push({
          s: time(parts[fmt.indexOf('start')]),
          e: time(parts[fmt.indexOf('end')]),
          t: body
        });
      }
    }
  } else {
    var blocks = text.split(/\n[ \t]*\n/);
    for (i = 0; i < blocks.length; i++) {
      lines = blocks[i].split('\n');
      for (var j = 0; j < lines.length; j++) {
        var m = lines[j].match(/([\d:]+[,.]\d+)\s*-->\s*([\d:]+[,.]\d+)/);
        if (!m) continue;
        var txt = cleanSubtitleText(lines.slice(j + 1).join('\n'));
        if (txt) cues.push({
          s: time(m[1]),
          e: time(m[2]),
          t: txt
        });
        break;
      }
    }
  }
  cues.sort(function (a, b) {
    return a.s - b.s;
  });
  return cues;
}
function disableRegularSubtitles() {
  if (currentSubtitleTrack === undefined || currentSubtitleTrack === null || currentSubtitleTrack < 0) return;
  var save = function () {
    if (currentTimecodeData.hash && currentTimecodeData.fileId) saveSubtitlePreference(currentTimecodeData.hash, currentTimecodeData.fileId, -1);
  };
  if (AppState.transcodingFullOnOff) {
    if (nativeSubState.mode === 'webos') webosSetSubtitle(-1);else applyNativeSubtitle(-1);
    currentSubtitleTrack = -1;
    save();
  } else if (AppState.serverTracks) {
    ServerSubs.stop();
    currentSubtitleTrack = -1;
    save();
  } else {
    switchSubtitleTrack(-1);
  }
}
var OnlineSubs = {
  fileKey: null,
  hash: null,
  fileId: null,
  target: null,
  list: null,
  searching: false,
  searchGen: 0,
  active: null,
  loadingUrl: null,
  failedUrl: null,
  offset: 0,
  timer: null,
  restoreTimer: null,
  lastText: null,
  readStore: function () {
    var st = null;
    try {
      st = JSON.parse(localStorage.getItem(ONLINE_SUBS_STORE_KEY) || 'null');
    } catch (e) {}
    if (!st || typeof st !== 'object') st = {};
    if (!st.f || typeof st.f !== 'object') st.f = {};
    if (!st.t || typeof st.t !== 'object') st.t = {};
    return st;
  },
  writeStore: function (st) {
    ['f', 't'].forEach(function (k) {
      var keys = Object.keys(st[k]);
      if (keys.length <= ONLINE_SUBS_STORE_MAX) return;
      keys.sort(function (a, b) {
        return (st[k][a].ts || 0) - (st[k][b].ts || 0);
      });
      for (var i = 0; i < keys.length - ONLINE_SUBS_STORE_MAX; i++) delete st[k][keys[i]];
    });
    try {
      localStorage.setItem(ONLINE_SUBS_STORE_KEY, JSON.stringify(st));
    } catch (e) {}
  },
  remember: function () {
    if (!this.fileKey) return;
    var st = this.readStore();
    if (this.active) {
      var it = this.active.item;
      st.f[this.fileKey] = {
        item: it,
        offset: this.offset,
        ts: Date.now()
      };
      st.t[this.hash] = {
        lang: it.lang,
        ts: Date.now()
      };
    } else {
      delete st.f[this.fileKey];
      delete st.t[this.hash];
    }
    this.writeStore(st);
  },
  onFileStart: function (hash, fileId) {
    if (!hash || fileId === undefined || fileId === null) return;
    var key = String(hash).toLowerCase() + '_' + fileId;
    if (key === this.fileKey) {
      if (this.active) this.startTicker();
      return;
    }
    this.reset();
    this.fileKey = key;
    this.hash = String(hash).toLowerCase();
    this.fileId = fileId;
    var st = this.readStore();
    var saved = st.f[key];
    if (saved && saved.item && saved.item.url) {
      this.offset = Number(saved.offset) || 0;
      this.load(saved.item, true);
      return;
    }
    var torrentPick = st.t[this.hash];
    if (!torrentPick || !torrentPick.lang) return;
    var self = this,
      gen = this.searchGen;
    this.restoreTimer = setTimeout(function () {
      self.restoreTimer = null;
      self.ensureList().then(function () {
        if (gen !== self.searchGen || self.active || self.loadingUrl || currentSubtitleTrack >= 0) return;
        var list = self.list || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i].lang === torrentPick.lang) {
            self.load(list[i], true);
            return;
          }
        }
      });
    }, ONLINE_SUBS_RESTORE_DELAY_MS);
  },
  reset: function () {
    this.stopTicker();
    if (this.restoreTimer) {
      clearTimeout(this.restoreTimer);
      this.restoreTimer = null;
    }
    this.searchGen++;
    this.fileKey = null;
    this.hash = null;
    this.fileId = null;
    this.target = null;
    this.list = null;
    this.searching = false;
    this.active = null;
    this.loadingUrl = null;
    this.failedUrl = null;
    this.offset = 0;
  },
  ensureList: function () {
    var self = this,
      gen = this.searchGen;
    if (this.list) return Promise.resolve(this.list);
    if (!this.target) this.target = getOnlineSubsTarget(this.hash, this.fileId);
    if (!this.target) {
      this.list = [];
      return Promise.resolve(this.list);
    }
    this.searching = true;
    return searchOnlineSubs(this.target).then(function (list) {
      if (gen !== self.searchGen) return [];
      self.list = list;
      self.searching = false;
      self.refreshPanel();
      return list;
    }, function () {
      if (gen === self.searchGen) {
        self.list = [];
        self.searching = false;
        self.refreshPanel();
      }
      return [];
    });
  },
  load: function (item, quiet) {
    var self = this,
      gen = this.searchGen;
    this.loadingUrl = item.url;
    this.failedUrl = null;
    this.refreshPanel();
    return onlineSubsFetch(item.url, ONLINE_SUBS_FETCH_MS * 2).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return typeof TextDecoder === 'function' ? r.arrayBuffer().then(function (buf) {
        return decodeSubtitleBytes(buf, item.encoding);
      }) : r.text();
    }).then(function (text) {
      if (gen !== self.searchGen || self.loadingUrl !== item.url) return;
      var cues = parseSubtitleCues(text);
      if (!cues.length) throw new Error('пустой файл');
      self.loadingUrl = null;
      disableRegularSubtitles();
      self.active = {
        item: item,
        cues: cues
      };
      self.lastText = null;
      self.remember();
      self.startTicker();
      self.refreshPanel();
      updateTracksMenu();
    })['catch'](function (err) {
      if (gen !== self.searchGen || self.loadingUrl !== item.url) return;
      console.warn('[онлайн-субтитры] не загрузились:', item.url, err && err.message);
      self.loadingUrl = null;
      self.failedUrl = item.url;
      self.refreshPanel();
      if (!quiet && typeof showToast === 'function') showToast('Не удалось загрузить субтитры');
    });
  },
  off: function (byUser) {
    if (!this.active && !this.loadingUrl) return;
    this.active = null;
    this.loadingUrl = null;
    this.offset = 0;
    this.stopTicker();
    if (byUser) this.remember();else if (this.fileKey) {
      var st = this.readStore();
      delete st.f[this.fileKey];
      delete st.t[this.hash];
      this.writeStore(st);
    }
    this.refreshPanel();
    updateTracksMenu();
  },
  shift: function (delta) {
    this.offset = Math.round((this.offset + delta) * 10) / 10;
    this.lastText = null;
    this.remember();
    this.refreshPanel();
    updateTracksMenu();
  },
  getBox: function () {
    var box = getEl('online-subs-box');
    if (box && typeof watchCuesRaise === 'function') watchCuesRaise(getEl('video-player'));
    return box;
  },
  startTicker: function () {
    var self = this;
    if (this.timer) return;
    this.timer = setInterval(function () {
      self.tick();
    }, ONLINE_SUBS_TICK_MS);
    this.tick();
  },
  stopTicker: function () {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.show('');
  },
  show: function (text) {
    if (text === this.lastText) return;
    this.lastText = text;
    var box = this.getBox();
    if (!box) return;
    box.textContent = text;
    box.classList.toggle('hidden', !text);
  },
  tick: function () {
    var v = getEl('video-player');
    if (!this.active || !v || AppState.currentScreen !== 'player' || AppState.isSeeking) {
      this.show('');
      return;
    }
    var t = (v.currentTime || 0) + (AppState.seekOffset || 0) - this.offset;
    var cues = this.active.cues;
    var lo = 0,
      hi = cues.length;
    while (lo < hi) {
      var mid = lo + hi >> 1;
      if (cues[mid].s <= t) lo = mid + 1;else hi = mid;
    }
    var parts = [];
    for (var i = lo - 1; i >= 0 && i >= lo - 8; i--) if (cues[i].e > t) parts.unshift(cues[i].t);
    this.show(parts.join('\n'));
  },
  summary: function () {
    if (!this.active) return this.loadingUrl ? 'Загрузка…' : 'Выключены';
    var it = this.active.item,
      lang = onlineSubsLang(it.lang);
    return (lang ? lang.label : it.lang.toUpperCase()) + (it.name ? ' · ' + it.name : '') + (this.offset ? ' · ' + this.offsetLabel() : '');
  },
  offsetLabel: function (o) {
    if (o === undefined) o = this.offset;
    var abs = Math.abs(o);
    var num = abs % 1 ? abs.toFixed(1).replace('.', ',') : String(abs);
    return (o > 0 ? '+' : o < 0 ? '−' : '') + num + ' с';
  },
  open: function () {
    if (!this.fileKey && currentTimecodeData.hash) this.onFileStart(currentTimecodeData.hash, currentTimecodeData.fileId);
    this.render();
    if (!this.list && !this.searching) this.ensureList();
  },
  refreshPanel: function () {
    if (!isPlayerPanelOpen('onlinesubs')) return;
    var list = getEl('online-subs-list');
    var focused = list && document.activeElement && list.contains(document.activeElement);
    var focusedKey = null;
    var f = list ? list.querySelector('.subtitle-item.focused') : null;
    if (f) focusedKey = f.getAttribute('data-online');
    this.render();
    if (list && (focused || focusedKey !== null) && typeof focusActivePanelItem === 'function') {
      var same = focusedKey !== null ? list.querySelector('[data-online="' + focusedKey + '"]') : null;
      if (same && typeof focusEl === 'function') {
        if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
        focusEl(same);
      } else focusActivePanelItem('onlinesubs');
    }
  },
  render: function () {
    var el = getEl('online-subs-list');
    if (!el) return;
    var html = '';
    var row = function (key, icon, title, details, active) {
      return '<div class="subtitle-item' + (active ? ' active' : '') + '" data-online="' + key + '"><div class="subtitle-icon">' + icon + '</div>' + '<div class="subtitle-info"><div class="subtitle-title">' + title + '</div>' + (details ? '<div class="subtitle-details">' + details + '</div>' : '') + '</div><div class="subtitle-check">✓</div></div>';
    };
    var self = this;
    var delayRow = function (key, icon, title, sign) {
      var o = self.offset,
        on = sign > 0 ? o > 0 : o < 0;
      return '<div class="subtitle-item online-subs-delay-item" data-online="' + key + '"><div class="subtitle-icon">' + icon + '</div>' + '<div class="subtitle-info"><div class="subtitle-title">' + title + '</div>' + '<div class="subtitle-details"><span class="subtitle-format">шаг ' + escapeHtml(self.offsetLabel(sign * ONLINE_SUBS_STEP_SEC)) + '</span></div>' + '</div><div class="online-subs-delay' + (on ? ' is-set' : '') + '">' + escapeHtml(on ? self.offsetLabel() : '0 с') + '</div></div>';
    };
    html += row('off', '🚫', 'Выключить онлайн субтитры', '', !this.active && !this.loadingUrl);
    if (this.active) {
      html += delayRow('earlier', '⏪', 'Показывать раньше', -1);
      html += delayRow('later', '⏩', 'Показывать позже', 1);
    }
    if (this.searching || !this.list && this.fileKey) html += '<div class="search-result-empty">Поиск субтитров…</div>';else if (!this.target && this.list) html += '<div class="search-result-empty">Не удалось определить фильм или серию</div>';else if (this.list && !this.list.length) html += '<div class="search-result-empty">Субтитры не найдены</div>';
    var list = this.list || [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i],
        lang = onlineSubsLang(s.lang);
      var isActive = !!(this.active && this.active.item.url === s.url);
      var state = this.loadingUrl === s.url ? 'Загрузка…' : this.failedUrl === s.url ? 'Не загрузились' : '';
      var details = '<span class="subtitle-language">' + escapeHtml(s.lang.toUpperCase()) + '</span>' + '<span class="subtitle-format">' + escapeHtml(s.source) + '</span>' + (s.hi ? '<span class="subtitle-format">для слабослышащих</span>' : '') + (state ? '<span class="subtitle-format">' + state + '</span>' : '');
      html += row(String(i), '💬', escapeHtml((lang ? lang.label : s.lang) + (s.name ? ' · ' + s.name : '')), details, isActive);
    }
    el.innerHTML = html;
    if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
  },
  onItem: function (key) {
    if (key === 'off') {
      this.off(true);
      if (isPlayerPanelOpen('onlinesubs')) togglePlayerPanel('onlinesubs');
    } else if (key === 'earlier') this.shift(-ONLINE_SUBS_STEP_SEC);else if (key === 'later') this.shift(ONLINE_SUBS_STEP_SEC);else {
      var s = this.list && this.list[parseInt(key, 10)];
      if (!s) return;
      if (this.active && this.active.item.url === s.url) return;
      this.offset = 0;
      this.load(s, false);
    }
  }
};
window.OnlineSubs = OnlineSubs;
function setupOnlineSubsPanel() {
  var list = getEl('online-subs-list');
  if (list && !list._delegated) {
    list._delegated = true;
    list.addEventListener('click', function (e) {
      var item = e.target && e.target.closest ? e.target.closest('.subtitle-item') : null;
      if (item) OnlineSubs.onItem(item.getAttribute('data-online'));
      resetMouseIdleTimer();
    });
  }
  var closeBtn = getEl('close-online-subs');
  if (closeBtn && !closeBtn._bound) {
    closeBtn._bound = true;
    closeBtn.addEventListener('click', function () {
      setPlayerPanel('onlinesubs', false);
      resetMouseIdleTimer();
    });
  }
}
function setupSubtitlesButton() {
  var closeSubtitlesBtn = getEl('close-subtitles');
  var subtitlesPanel = getEl('subtitles-panel');
  if (!closeSubtitlesBtn || !subtitlesPanel) return;
  setupSubtitlesListDelegation();
  setupOnlineSubsPanel();
  closeSubtitlesBtn.addEventListener('click', function () {
    setPlayerPanel('subtitles', false);
    resetMouseIdleTimer();
  });
  setupPlayerPanelsOutsideClick();
}
function saveSubtitlePreference(_x72, _x73, _x74) {
  return _saveSubtitlePreference.apply(this, arguments);
}
function _saveSubtitlePreference() {
  _saveSubtitlePreference = _asyncToGenerator(function* (hash, fileId, subtitleTrack) {
    try {
      var savedClientId = localStorage.getItem('clientId');
      yield bgFetch(SERVER_URL + '/api/subtitle/pref/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          hash: hash,
          fileId: fileId,
          subtitleTrack: subtitleTrack,
          clientId: savedClientId
        })
      });
    } catch (error) {}
  });
  return _saveSubtitlePreference.apply(this, arguments);
}
function loadSubtitlePreference(_x75, _x76) {
  return _loadSubtitlePreference.apply(this, arguments);
}
function _loadSubtitlePreference() {
  _loadSubtitlePreference = _asyncToGenerator(function* (hash, fileId) {
    try {
      var savedClientId = localStorage.getItem('clientId');
      var response = yield fetchWithTimeout(SERVER_URL + '/api/subtitle/pref/get?hash=' + hash + '&fileId=' + fileId + '&clientId=' + encodeURIComponent(savedClientId));
      if (response.ok) {
        var data = yield response.json();
        if (data.success && data.subtitleTrack !== null) return data.subtitleTrack;
      }
    } catch (error) {}
    return -1;
  });
  return _loadSubtitlePreference.apply(this, arguments);
}
function handleVideoEnded() {
  return _handleVideoEnded.apply(this, arguments);
}
function _handleVideoEnded() {
  _handleVideoEnded = _asyncToGenerator(function* () {
    if (playbackEndHandled) return;
    playbackEndHandled = true;
    if (nearEndCheckInterval) {
      clearInterval(nearEndCheckInterval);
      nearEndCheckInterval = null;
    }
    stopHeartbeat();
    stopTorrentStatsUpdates();
    yield saveTimecodeToServer();
    if (AppState.autoSwitchEpisodes && currentEpisodeFiles.length > 0 && currentEpisodeIndex < currentEpisodeFiles.length - 1) {
      getEl('playback-overlay').classList.add('active');
      document.querySelector('.playback-text').textContent = 'Автоматическое переключение на серию ' + (currentEpisodeIndex + 2) + '...';
      try {
        var nextFile = currentEpisodeFiles[currentEpisodeIndex + 1];
        yield switchToEpisode(currentEpisodeIndex + 1, nextFile.id);
      } catch (error) {} finally {
        getEl('playback-overlay').classList.remove('active');
        document.querySelector('.playback-text').textContent = 'Воспроизведение...';
      }
    } else {
      var overlay = getEl('playback-overlay');
      overlay.classList.add('active');
      document.querySelector('.playback-text').textContent = 'Воспроизведение завершено';
      setTimeout(function () {
        overlay.classList.remove('active');
        showDetailView();
      }, 1500);
    }
  });
  return _handleVideoEnded.apply(this, arguments);
}
var END_EPS_SEC = 1.5;
var END_STALL_ZONE_SEC = 20;
var END_STALL_MS = 4000;
var playbackEndHandled = false;
function startNearEndCheck() {
  if (nearEndCheckInterval) {
    clearInterval(nearEndCheckInterval);
    nearEndCheckInterval = null;
  }
  playbackEndHandled = false;
  var lastAbs = -1,
    lastMoveAt = Date.now();
  nearEndCheckInterval = setInterval(function () {
    var v = getEl('video-player');
    var now = Date.now();
    if (!v || AppState.currentScreen !== 'player' || AppState.isSeeking || v.paused) {
      lastMoveAt = now;
      return;
    }
    var total = AppState.originalDuration || AppState.expectedDuration || 0;
    if (!(total > 0)) return;
    var abs = (v.currentTime || 0) + (AppState.seekOffset || 0);
    if (Math.abs(abs - lastAbs) > 0.05) {
      lastAbs = abs;
      lastMoveAt = now;
    }
    var left = total - abs;
    if (left <= END_EPS_SEC || left <= END_STALL_ZONE_SEC && now - lastMoveAt >= END_STALL_MS) {
      console.log('🏁 Конец файла: позиция ' + abs.toFixed(1) + ' из ' + total.toFixed(1) + ' с');
      handleVideoEnded();
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
  if (!window.AndroidJS) {
    currentSubtitleTrack = -1;
    window.addEventListener('unload', function () {
      if (AppState && AppState.currentStreamId) navigator.sendBeacon(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, '');
      if (currentTimecodeData && currentTimecodeData.hash && currentTimecodeData.fileId && currentTimecodeData.timecode > 0) {
        var savedClientId = localStorage.getItem('clientId');
        navigator.sendBeacon(SERVER_URL + '/api/timecode/save', JSON.stringify({
          clientId: savedClientId,
          hash: currentTimecodeData.hash,
          fileId: currentTimecodeData.fileId,
          timecode: currentTimecodeData.timecode,
          duration: currentTimecodeData.duration,
          mediaKey: currentTimecodeMediaKey()
        }));
      }
    });
    window.addEventListener('beforeunload', function () {
      if (AppState.currentStreamId) {
        navigator.sendBeacon(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, '');
        fetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, {
          method: 'POST',
          keepalive: true
        })['catch'](function () {});
      }
      if (currentTimecodeData.hash && currentTimecodeData.fileId && currentTimecodeData.timecode > 0) {
        var savedClientId = localStorage.getItem('clientId');
        navigator.sendBeacon(SERVER_URL + '/api/timecode/save', JSON.stringify({
          clientId: savedClientId,
          hash: currentTimecodeData.hash,
          fileId: currentTimecodeData.fileId,
          timecode: currentTimecodeData.timecode,
          duration: currentTimecodeData.duration,
          mediaKey: currentTimecodeMediaKey()
        }));
      }
    });
    window.addEventListener('pagehide', function () {
      if (AppState.currentStreamId) navigator.sendBeacon(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, '');
      if (currentTimecodeData.hash && currentTimecodeData.fileId && currentTimecodeData.timecode > 0) {
        var savedClientId = localStorage.getItem('clientId');
        navigator.sendBeacon(SERVER_URL + '/api/timecode/save', JSON.stringify({
          clientId: savedClientId,
          hash: currentTimecodeData.hash,
          fileId: currentTimecodeData.fileId,
          timecode: currentTimecodeData.timecode,
          duration: currentTimecodeData.duration,
          mediaKey: currentTimecodeMediaKey()
        }));
      }
    });
    document.addEventListener('visibilitychange', function () {
      var videoPlayer = getEl('video-player');
      if (document.hidden && videoPlayer && !videoPlayer.paused) videoPlayer.pause();
    });
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupPageUnloadHandler);else setupPageUnloadHandler();
function updateClock() {
  var clock = getEl('clock-display');
  if (!clock) return;
  var now = new Date();
  clock.textContent = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
}
updateClock();
setInterval(updateClock, 60000);
function updatePlayerTimeline(timelineData) {
  try {
    var data = typeof timelineData === 'string' ? JSON.parse(timelineData) : timelineData;
    var isCompleted = data.percent === 100;
    if (!data.hash || data.hash === '0') {
      var urlData = data.currentUrl ? parseHashFromUrl(data.currentUrl) : null;
      if (urlData) {
        data.hash = urlData.hash;
        data.torrentHash = urlData.torrentHash;
        data.fileId = urlData.fileId;
      } else if (currentTimecodeData && currentTimecodeData.hash && currentTimecodeData.fileId) {
        data.hash = currentTimecodeData.hash + '_' + currentTimecodeData.fileId;
      } else return;
    }
    if (currentTimecodeData) {
      if (isCompleted) {
        currentTimecodeData.timecode = 100;
        currentTimecodeData.duration = 100;
      } else {
        currentTimecodeData.timecode = data.time;
        currentTimecodeData.duration = data.duration;
      }
      var hashParts = data.hash.split('_');
      if (hashParts.length >= 2) {
        currentTimecodeData.hash = hashParts[0];
        currentTimecodeData.fileId = hashParts[1];
      } else currentTimecodeData.hash = data.hash;
    }
    if (data.currentUrl && (!currentTimecodeData.hash || !currentTimecodeData.fileId)) {
      var urlData = parseHashFromUrl(data.currentUrl);
      if (urlData) {
        currentTimecodeData.hash = urlData.torrentHash;
        currentTimecodeData.fileId = urlData.fileId;
      }
    }
    var savedClientId = localStorage.getItem('clientId');
    if (savedClientId && currentTimecodeData.hash && currentTimecodeData.fileId) {
      var timecodeToSave = isCompleted ? Math.floor(currentTimecodeData.duration) : Math.floor(data.time);
      trackTimecodeSave(bgFetch(SERVER_URL + '/api/timecode/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          clientId: savedClientId,
          hash: currentTimecodeData.hash,
          fileId: currentTimecodeData.fileId,
          timecode: timecodeToSave,
          duration: currentTimecodeData.duration,
          completed: isCompleted,
          mediaKey: currentTimecodeMediaKey()
        })
      }));
    }
    if (typeof window.refreshDetailResume === 'function') window.refreshDetailResume();
    if (androidReturnHome) {
      returnHomeFromAndroidPlayer();
      return;
    }
    if (androidReturnCardTimer) return;
    if ((androidReturnSearch || AppState.playFromHash) && searchOriginCard()) {
      returnCardFromAndroidPlayer(currentTimecodeData.hash);
      return;
    }
    if (androidReturnSearch) {
      returnSearchFromAndroidPlayer();
      return;
    }
    if (AppState.playFromHash && AppState.isCatalogSerials) {
      AppState.isCatalogSearch = false;
      return;
    } else if (AppState.playFromHash) {
      AppState.playFromHash = false;
      AppState.isCatalogSearch = false;
      return;
    }
    showDetailView(currentTimecodeData.fileId);
    if (AppState && AppState.currentDetailItem && currentTimecodeData.hash) updateDetailProgress(AppState.currentDetailItem);
  } catch (error) {}
}
function parseHashFromUrl(url) {
  if (!url) return null;
  try {
    var playMatch = url.match(/\/play\/([a-fA-F0-9]+)\/(\d+)/);
    if (playMatch) return {
      torrentHash: playMatch[1],
      fileId: playMatch[2],
      hash: playMatch[1] + '_' + playMatch[2]
    };
    var urlObj = new URL(url);
    var link = urlObj.searchParams.get('link');
    var index = urlObj.searchParams.get('index');
    if (link && index) return {
      torrentHash: link,
      fileId: index,
      hash: link + '_' + index
    };
    return null;
  } catch (e) {
    return null;
  }
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
