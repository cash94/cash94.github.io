/* Сборка для старых браузеров (Chrome 53) из js/player.js — tools/legacy-build/build.js. Руками не править. */
function asyncGeneratorStep(n, t, e, r, o, a, c) {try {var i = n[a](c),u = i.value;} catch (n) {return void e(n);}i.done ? t(u) : Promise.resolve(u).then(r, o);}function _asyncToGenerator(n) {return function () {var t = this,e = arguments;return new Promise(function (r, o) {var a = n.apply(t, e);function _next(n) {asyncGeneratorStep(a, r, o, _next, _throw, "next", n);}function _throw(n) {asyncGeneratorStep(a, r, o, _next, _throw, "throw", n);}_next(void 0);});};}

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
var MAX_PLAYBACK_RETRIES = 3;










var PLAYER_FETCH_TIMEOUT_MS = 15000;










var FILE_INFO_FETCH_TIMEOUT_MS = 60000;


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
  var timer = setTimeout(function () {controller.abort();}, timeoutMs || PLAYER_FETCH_TIMEOUT_MS);
  var outer = options.signal;
  var onOuterAbort = function () {controller.abort();};
  if (outer) {
    if (outer.aborted) controller.abort();else
    outer.addEventListener('abort', onOuterAbort);
  }
  var opts = Object.assign({}, options, { signal: controller.signal });
  return fetch(url, opts).finally(function () {
    clearTimeout(timer);
    if (outer) outer.removeEventListener('abort', onOuterAbort);
  });
}
window.fetchWithTimeout = fetchWithTimeout;









function showPlaybackUnavailableBanner(detail) {
  var text = 'TorrServer недоступен или TorrStream не смог получить информацию от TorrServer. ' +
  'Попробуйте перезапустить данный контент или выбрать другую раздачу.';
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
    window.showErrorBanner('Не удалось переключить ' + what,
    'TorrServer недоступен или TorrStream не смог получить информацию от TorrServer. ' +
    'Попробуйте перезапустить данный контент или выбрать другую раздачу.');
  } else alert('Ошибка при переключении: ' + what);
  if (detail) console.warn('🔀 Переключение (' + what + ') не удалось:', detail);
}
window.showSwitchFailedBanner = showSwitchFailedBanner;


















var FS_OVERLAY_IDS = ['playback-overlay', 'loading-overlay', 'skip-button'];
var fsOverlayHome = {};

function getFullscreenEl() {
  return document.fullscreenElement || document.webkitFullscreenElement ||
  document.mozFullScreenElement || document.msFullscreenElement || null;
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
  }, { passive: false });






  document.body.appendChild(skipButton);
  syncFullscreenOverlays();
  return skipButton;
}












var AUTO_SKIP_INTRO_SEC = 5;
var autoSkipTimer = null;
var autoSkipLeft = 0;

function autoSkipLabel() {
  return '⏩ Пропуск заставки через ' + autoSkipLeft + ' · ОК — смотреть';
}

function startAutoSkipCountdown() {
  stopAutoSkipCountdown();
  autoSkipLeft = AUTO_SKIP_INTRO_SEC;
  if (skipButton) skipButton.innerHTML = autoSkipLabel();
  autoSkipTimer = setInterval(function () {
    if (!skipButtonActive || !currentSkipInfo) {stopAutoSkipCountdown();return;}
    var videoPlayer = getEl('video-player');
    if (videoPlayer && videoPlayer.paused) return;
    autoSkipLeft--;
    if (autoSkipLeft <= 0) {
      stopAutoSkipCountdown();
      console.log('⏩ Автопропуск заставки');
      performSkip();
      return;
    }
    if (skipButton) skipButton.innerHTML = autoSkipLabel();
  }, 1000);
}

function stopAutoSkipCountdown() {
  if (autoSkipTimer) {clearInterval(autoSkipTimer);autoSkipTimer = null;}
}

window.executeSkip = function () {
  if (!skipButtonActive || !currentSkipInfo) return false;

  if (autoSkipTimer) {
    console.log('⏩ Автопропуск заставки отменён');
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
  var buttonText = type === 'intro' ? '⏩ Пропустить вступление' : '⏩ Пропустить титры';
  skipButton.innerHTML = buttonText;
  skipButton.classList.remove('hidden');
  skipButton.classList.add('visible');
  skipButton.style.display = 'flex';
  currentSkipInfo = { type: type, startMs: startMs, endMs: endMs };
  currentSkipRangeKey = rangeKey;
  skipButtonActive = true;
  if (typeof window.focusEl === 'function') window.focusEl(skipButton);

  if (type === 'intro' && AppState.autoSkipIntro) {


    startAutoSkipCountdown();
  } else {
    skipButtonTimeout = setTimeout(function () {hideSkipButton();}, 10000);
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
    setTimeout(function () {window.updateFocusableElements();}, 50);
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
  var newRangeKey = null,newType = null,newStartMs = null,newEndMs = null;

  if (skipData.intro && Array.isArray(skipData.intro) && skipData.intro.length > 0) {
    for (var i = 0; i < skipData.intro.length; i++) {
      var intro = skipData.intro[i];
      var introStartMs = intro.start_ms !== null && intro.start_ms !== undefined ? intro.start_ms : 0;
      var introEndMs = intro.end_ms !== null && intro.end_ms !== undefined ? intro.end_ms : 0;
      if (currentTimeMs >= introStartMs && currentTimeMs <= introEndMs) {
        inAnyRange = true;
        newRangeKey = 'intro_' + introStartMs + '_' + introEndMs;
        newType = 'intro';newStartMs = introStartMs;newEndMs = introEndMs;
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
        newType = 'credits';newStartMs = creditsStartMs;newEndMs = credits.end_ms;
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


function setControlDisabled(btn, disabled) {
  if (!btn) return;
  if (disabled) btn.classList.add('is-disabled');else
  btn.classList.remove('is-disabled');
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
window.syncPlayerTitleVisibility = syncPlayerTitleVisibility;function

getFileNameByHash(_x, _x2) {return _getFileNameByHash.apply(this, arguments);}function _getFileNameByHash() {_getFileNameByHash = _asyncToGenerator(function* (hash, fileId) {
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
    if (torrent.file_stats && Array.isArray(torrent.file_stats)) files = torrent.file_stats;else
    if (torrent.data) {
      try {
        var data = JSON.parse(torrent.data);
        if (data.TorrServer && data.TorrServer.Files) files = data.TorrServer.Files;
      } catch (e) {}
    }
    for (var j = 0; j < files.length; j++) {
      if (files[j].id == fileId) return files[j].path.split('/').pop() || 'Файл ' + fileId;
    }
    return null;
  });return _getFileNameByHash.apply(this, arguments);}







var idleControlEls = null;

function getIdleControlEls() {
  if (idleControlEls) return idleControlEls;
  var ids = ['controls-container', 'buffer-stats', 'player-hint', 'toggle-buffer-btn',
  'exit-player-btn', 'episodes-btn', 'subtitles-btn', 'prev-episode-btn',
  'next-episode-btn', 'player-title'];
  var list = [];
  for (var i = 0; i < ids.length; i++) {var el = getEl(ids[i]);if (el) list.push(el);}
  if (list.length) idleControlEls = list;
  return list;
}










function setPlayerControlsIdle(hidden) {
  var els = getIdleControlEls();
  for (var i = 0; i < els.length; i++) {
    if (hidden) els[i].classList.add('idle-hidden');else
    els[i].classList.remove('idle-hidden');
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

function resetMouseIdleTimer() {
  var playerScreen = getEl('player-screen');
  if (!playerScreen || playerScreen.style.display !== 'block') return;
  var playerOverlay = getEl('player-overlay');
  if (playerOverlay) playerOverlay.classList.add('touch-active');





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
  currentBufferAhead = 0;wasImmediatePause = false;pauseTimer = null;pauseStartTime = null;
  if (currentEpisodeFiles.length === 0 || currentEpisodeIndex === undefined) return;
  var nextIndex = currentEpisodeIndex + 1;
  if (nextIndex < currentEpisodeFiles.length) switchToEpisode(nextIndex, currentEpisodeFiles[nextIndex].id);
}

function prevEpisode() {
  currentBufferAhead = 0;wasImmediatePause = false;pauseTimer = null;pauseStartTime = null;
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





  btn.innerHTML = videoPlayer.muted ? '<i class="fi fi-rr-volume-slash"></i>' : '<i class="fi fi-rr-volume"></i>';
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
    fetchWithTimeout(SERVER_URL + '/api/file/info?hash=' + currentTorrentHash + '&fileId=' + next.id +
    '&clientId=' + encodeURIComponent(savedClientId), null, FILE_INFO_FETCH_TIMEOUT_MS)['catch'](function () {});
  }
}






function hudStat(label, value, valueClass) {
  return '<span class="hud-stat"><span class="hud-stat-label">' + label + '</span>' +
  '<span class="hud-stat-value' + (valueClass ? ' ' + valueClass : '') + '">' + value + '</span></span>';
}



function setHudHtml(el, html) {
  if (el && el._hudHtml !== html) {el.innerHTML = html;el._hudHtml = html;}
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
      var bufferAheadText = bufferAhead < 60 ? Math.floor(bufferAhead) + ' сек' : bufferAhead < 3600 ? Math.floor(bufferAhead / 60) + ' мин' : Math.floor(bufferAhead / 3600) + ' ч';
      var remainingHours = Math.floor(remainingTime / 3600);
      var remainingMinutes = Math.floor(remainingTime % 3600 / 60);
      var remainingSeconds = Math.floor(remainingTime % 60);
      var remainingText = (remainingHours > 0 ? remainingHours + ' ч ' + (remainingMinutes > 0 ? remainingMinutes + ' мин' : '') : remainingMinutes > 0 ? remainingMinutes + ' мин ' + (remainingSeconds > 0 ? remainingSeconds + ' сек' : '') : remainingSeconds + ' сек').trim();
      var endTime = new Date(Date.now() + remainingTime * 1000);
      var endTimeText = endTime.getHours().toString().padStart(2, '0') + ':' + endTime.getMinutes().toString().padStart(2, '0');
      var torrServerHtml = '';
      if (currentTimecodeData.hash && typeof torrentStatsCache !== 'undefined' && torrentStatsCache.preloadSize > 0) {
        torrServerHtml = hudStat('TorrServer', formatSize(torrentStatsCache.preloaded)) +
        hudStat('Скорость', formatSpeed(torrentStatsCache.downloadSpeed));
        if (torrentStatsCache.activePeers > 0) {
          torrServerHtml += hudStat('Пиры', torrentStatsCache.activePeers + ' / ' + torrentStatsCache.totalPeers) +
          hudStat('Сиды', torrentStatsCache.connectedSeeders);
        }
      }
      setHudHtml(bufferStats,
      hudStat('Буфер', bufferAheadText, bufferLevelClass(bufferAhead)) +
      hudStat('До конца', remainingText) +
      hudStat('Конец в', endTimeText));
      setHudHtml(subtitleElement, torrServerHtml);
    }
  } else {
    setHudHtml(bufferStats, hudStat('Буфер', '0 сек', 'hud-low'));
    setHudHtml(subtitleElement, '');
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



  if (AppState.seekTimeout) {
    clearTimeout(AppState.seekTimeout);
    AppState.seekTimeout = null;
  }
  if (AppState._seekExecuted) AppState._seekExecuted = false;

  if (AppState._directPlaybackDetach) {AppState._directPlaybackDetach();AppState._directPlaybackDetach = null;}

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
}function

checkPlaylistExists(_x3, _x4) {return _checkPlaylistExists.apply(this, arguments);}function _checkPlaylistExists() {_checkPlaylistExists = _asyncToGenerator(function* (playlistUrl, maxAttempts) {
    if (maxAttempts === undefined) maxAttempts = 40;
    for (var i = 0; i < maxAttempts; i++) {
      try {
        var response = yield fetch(playlistUrl, { method: 'HEAD' });
        if (response.ok) return true;
      } catch (e) {}
      if (i % 4 === 0) showPlayerLoading('Ожидание плейлиста... ' + ((i + 1) * 0.5).toFixed(0) + 'с', AppState.previewTime);
      yield new Promise(function (r) {setTimeout(r, 500);});
    }
    return false;
  });return _checkPlaylistExists.apply(this, arguments);}

function reloadHlsPlaylist(playlistUrl) {
  return new Promise(function (resolve, reject) {
    if (!AppState.hls || !Hls.isSupported()) {reject(new Error('HLS не инициализирован'));return;}
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
    try {AppState.hls.loadSource(playlistUrl);} catch (e) {reject(e);}
    setTimeout(function () {
      if (!manifestParsed && !loadError) {
        AppState.hls.off(Hls.Events.MANIFEST_PARSED, onManifestParsed);
        AppState.hls.off(Hls.Events.ERROR, onError);
        reject(new Error('Таймаут загрузки плейлиста'));
      }
    }, 15000);
  });
}function

saveTimecodeToServer() {return _saveTimecodeToServer.apply(this, arguments);}function _saveTimecodeToServer() {_saveTimecodeToServer = _asyncToGenerator(function* () {
    if (!currentTimecodeData.hash || !currentTimecodeData.fileId) return;
    if (currentTimecodeData.timecode < 5) return;
    if (currentTimecodeData.duration > 0 && currentTimecodeData.timecode > currentTimecodeData.duration - 10) return;
    try {
      var savedClientId = localStorage.getItem('clientId');
      var response = yield fetch(SERVER_URL + '/api/timecode/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: savedClientId, hash: currentTimecodeData.hash, fileId: currentTimecodeData.fileId,
          timecode: currentTimecodeData.timecode, duration: currentTimecodeData.duration
        })
      });
      if (response.ok) console.log('💾 Таймкод сохранен: ' + formatTime(currentTimecodeData.timecode));
    } catch (error) {console.error('Ошибка сохранения таймкода:', error);}
  });return _saveTimecodeToServer.apply(this, arguments);}function

loadTimecodeFromServer(_x5, _x6) {return _loadTimecodeFromServer.apply(this, arguments);}function _loadTimecodeFromServer() {_loadTimecodeFromServer = _asyncToGenerator(function* (hash, fileId) {
    if (!hash || !fileId) return 0;
    try {
      var savedClientId = localStorage.getItem('clientId');
      var response = yield fetchWithTimeout(SERVER_URL + '/api/timecode/get?hash=' + hash + '&fileId=' + fileId + '&clientId=' + encodeURIComponent(savedClientId));
      if (response.ok) {
        var data = yield response.json();
        if (data.success && data.timecode > 0) return data.timecode;
      }
    } catch (error) {console.error('Ошибка загрузки таймкода:', error);}
    return 0;
  });return _loadTimecodeFromServer.apply(this, arguments);}

function clearTimecodeData() {currentTimecodeData = { hash: null, fileId: null, timecode: 0, duration: 0 };}














var pendingTimecodeSave = null;
function trackTimecodeSave(promise) {
  var p = Promise.resolve(promise)['catch'](function () {});
  pendingTimecodeSave = p;
  p.then(function () {if (pendingTimecodeSave === p) pendingTimecodeSave = null;});
  return p;
}
function awaitPendingTimecodeSave() {
  return pendingTimecodeSave || Promise.resolve();
}
function startTimecodeSaving() {
  if (timecodeSaveInterval) clearInterval(timecodeSaveInterval);
  timecodeSaveInterval = setInterval(function () {saveTimecodeToServer();}, 10000);
}
function stopTimecodeSaving() {
  if (timecodeSaveInterval) {clearInterval(timecodeSaveInterval);timecodeSaveInterval = null;}
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
}function

seekStream(_x7, _x8) {return _seekStream.apply(this, arguments);}function _seekStream() {_seekStream = _asyncToGenerator(function* (absoluteSeekTime, source) {
    currentBufferAhead = 0;wasImmediatePause = false;pauseTimer = null;pauseStartTime = null;thisisseek = true;
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
      AppState.isSeeking = true;AppState.suppressTimeUpdate = true;AppState.previewTime = absoluteSeekTime;
      videoPlayer.currentTime = relativeTime;
      if (currentTimecodeData.hash && currentTimecodeData.fileId) currentTimecodeData.timecode = absoluteSeekTime;
      var seekSlider = getEl('seek-slider');
      if (seekSlider) seekSlider.value = Math.min(absoluteSeekTime, totalDuration);
      updateTimeDisplay();
      var timeUpdateHandler = function () {
        if (videoPlayer.currentTime > 0) {
          hidePlayerLoading();AppState.isSeeking = false;AppState.isSliderDragging = false;
          AppState.previewTime = null;AppState.suppressTimeUpdate = false;
          videoPlayer.removeEventListener('timeupdate', timeUpdateHandler);
        }
      };
      videoPlayer.addEventListener('timeupdate', timeUpdateHandler);
      AppState._seekTimeout = setTimeout(function () {
        hidePlayerLoading();AppState.isSeeking = false;AppState.isSliderDragging = false;
        AppState.previewTime = null;AppState.suppressTimeUpdate = false;
        videoPlayer.removeEventListener('timeupdate', timeUpdateHandler);
      }, 3000);
      AppState._seekTimeUpdateHandler = timeUpdateHandler;
      return true;
    }

    AppState.seekQueue.push(absoluteSeekTime);
    if (AppState.isSeeking) return false;
    if (source === 'slider' && AppState.seekTimeout) clearTimeout(AppState.seekTimeout);

    return new Promise(function (resolve) {
      var executeSeek = function () {var _ref = _asyncToGenerator(function* () {
          var targetTime = AppState.seekQueue[AppState.seekQueue.length - 1];
          AppState.seekQueue = [];
          if (targetTime === undefined) {hidePlayerLoading();resolve(false);return;}
          var wasPlaying = !videoPlayer.paused;
          var episodesPanel = getEl('episodes-panel');
          var episodesBtn = getEl('episodes-btn');
          if (episodesPanel && !episodesPanel.classList.contains('hidden')) {
            episodesPanel.classList.add('hidden');
            if (episodesBtn) episodesBtn.classList.remove('active');
          }
          AppState.isSeeking = true;AppState.suppressTimeUpdate = true;AppState.previewTime = targetTime;
          var positionInBuffer = isPositionInBuffer(targetTime);
          if (positionInBuffer) {
            var relativeTime = targetTime - AppState.seekOffset;
            videoPlayer.currentTime = relativeTime;
            if (wasPlaying) videoPlayer.play()['catch'](function (err) {});
            AppState.previewTime = null;AppState.suppressTimeUpdate = false;AppState.isSeeking = false;
            var seekSlider = getEl('seek-slider');
            if (seekSlider) seekSlider.value = targetTime;
            updateTimeDisplay();resolve(true);return;
          }

          lastCleanedSegment = -1;
          var playbackOverlay = getEl('playback-overlay');
          var playbackText = document.querySelector('.playback-text');
          playbackOverlay.classList.add('active');
          playbackText.textContent = 'Перемотка на ' + formatTime(targetTime) + '...';
          if (wasPlaying) videoPlayer.pause();

          var _retrySeek = function () {var _ref2 = _asyncToGenerator(function* (retryCount, maxRetries) {
              if (retryCount === undefined) retryCount = 0;
              if (maxRetries === undefined) maxRetries = 2;
              try {
                var savedClientId = localStorage.getItem('clientId');
                var seekResponse = yield fetch(SERVER_URL + '/hls/stream/seek', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    streamId: AppState.currentStreamId, seekTime: targetTime, multiChannel: AppState.multiChannelEnabled,
                    clientId: savedClientId, duration: AppState.originalDuration, sub: currentSubtitleTrack, dv: AppState.dvPreferred ? 'true' : 'false'
                  })
                });
                if (!seekResponse.ok) throw new Error('HTTP ' + seekResponse.status);
                var seekData = yield seekResponse.json();
                if (!seekData.success) throw new Error(seekData.error || 'Ошибка перемотки');
                AppState.expectedDuration = seekData.duration;AppState.originalDuration = seekData.originalDuration;
                AppState.seekOffset = seekData.seekOffset;AppState.currentStreamId = seekData.streamId;AppState.lastSuccessfulSeek = targetTime;
                if (videoPlayer) {
                  videoPlayer.dataset.expectedDuration = AppState.expectedDuration;
                  videoPlayer.dataset.originalDuration = AppState.originalDuration;
                  videoPlayer.dataset.seekOffset = AppState.seekOffset;
                }
                playbackText.textContent = 'Загрузка потока...';
                var playlistReady = yield checkPlaylistExists(seekData.playlistUrl, 60);
                if (!playlistReady) throw new Error('Таймаут ожидания плейлиста');
                playbackText.textContent = 'Загрузка видео...';

                if (AppState.hls) {AppState.hls.destroy();AppState.hls = null;}
                if (Hls.isSupported()) {
                  AppState.hls = createHlsInstance();

                  if (currentPlaybackController) currentPlaybackController.abort();
                  currentPlaybackController = new AbortController();
                  var newSignal = currentPlaybackController.signal;


                  attachHlsEventListeners(AppState.hls, videoPlayer, newSignal, 0);


                  var subtitleTracksHandler = function () {
                    if (currentSubtitleTrack >= 0 && AppState.hls.subtitleTracks.length > currentSubtitleTrack) {
                      setTimeout(function () {if (AppState.hls) AppState.hls.subtitleTrack = currentSubtitleTrack;}, 200);
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
                    videoPlayer.play()['catch'](function (err) {videoPlayer.muted = true;videoPlayer.play()['catch'](function () {});updateMuteButton();});
                  }
                  videoPlayer.muted = false;updateMuteButton();
                  forceUpdateDuration(AppState.expectedDuration, AppState.originalDuration, AppState.seekOffset);
                  var seekSlider = getEl('seek-slider');
                  if (seekSlider) seekSlider.value = Math.min(targetTime, parseFloat(seekSlider.max) || targetTime);
                  AppState.previewTime = null;AppState.suppressTimeUpdate = false;
                  playbackOverlay.classList.remove('active');playbackText.textContent = 'Воспроизведение...';
                  hidePlayerLoading();startTimecodeSaving();resetMouseIdleTimer();startNearEndCheck();startHeartbeat();
                  videoPlayer.removeEventListener('loadedmetadata', onMetaData);
                };
                videoPlayer.addEventListener('loadedmetadata', onMetaData, { once: true });
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
                  playbackText.textContent = '⚠️ Ошибка перемотки. Попытка ' + (retryCount + 1) + '/' + (maxRetries + 1) + '...';
                  yield new Promise(function (resolve) {setTimeout(resolve, 1000);});
                  return _retrySeek(retryCount + 1, maxRetries);
                }
                throw error;
              }
            });return function retrySeek(_x54, _x55) {return _ref2.apply(this, arguments);};}();
          try {
            var success = yield _retrySeek(0, 2);resolve(success);
          } catch (error) {
            playbackText.textContent = '❌ Ошибка перемотки!';
            setTimeout(function () {playbackOverlay.classList.remove('active');playbackText.textContent = 'Воспроизведение...';}, 2000);
            if (wasPlaying) setTimeout(function () {videoPlayer.play()['catch'](function () {});}, 1000);
            AppState.previewTime = null;AppState.suppressTimeUpdate = false;resolve(false);
          } finally {AppState.isSeeking = false;}
        });return function executeSeek() {return _ref.apply(this, arguments);};}();
      if (source === 'slider') {
        if (AppState.seekTimeout) clearTimeout(AppState.seekTimeout);
        AppState.seekTimeout = setTimeout(executeSeek, 300);
      } else {executeSeek();}
    });
  });return _seekStream.apply(this, arguments);}

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
}function

resolveTorrentWithFiles(_x9, _x0, _x1) {return _resolveTorrentWithFiles.apply(this, arguments);}function _resolveTorrentWithFiles() {_resolveTorrentWithFiles = _asyncToGenerator(function* (hash, maxAttempts, delayMs) {
    if (maxAttempts === undefined) maxAttempts = 3;
    if (delayMs === undefined) delayMs = 700;
    var torrent = null;
    for (var i = 0; i < AppState.torrents.length; i++) {
      if (AppState.torrents[i].hash && AppState.torrents[i].hash.toLowerCase() === hash.toLowerCase()) {torrent = AppState.torrents[i];break;}
    }
    for (var attempt = 0; attempt < maxAttempts; attempt++) {
      var files = [];
      if (torrent && torrent.file_stats && Array.isArray(torrent.file_stats)) files = torrent.file_stats;else
      if (torrent && torrent.data) {
        try {var data = JSON.parse(torrent.data);if (data.TorrServer && Array.isArray(data.TorrServer.Files)) files = data.TorrServer.Files;} catch (e) {}
      }
      if (extractVideoFiles(files).length > 0) return torrent;
      if (attempt < maxAttempts - 1) {
        yield refreshTorrentsList();
        for (var j = 0; j < AppState.torrents.length; j++) {
          if (AppState.torrents[j].hash && AppState.torrents[j].hash.toLowerCase() === hash.toLowerCase()) {torrent = AppState.torrents[j];break;}
        }
        yield new Promise(function (resolve) {setTimeout(resolve, delayMs);});
      }
    }
    return torrent;
  });return _resolveTorrentWithFiles.apply(this, arguments);}function

loadEpisodesInfo(_x10, _x11) {return _loadEpisodesInfo.apply(this, arguments);}function _loadEpisodesInfo() {_loadEpisodesInfo = _asyncToGenerator(function* (hash, currentFileId) {
    if (currentFileId === undefined) currentFileId = null;
    if (!hash || !AppState.currentTorrserverUrl) return;
    try {
      var torrent = yield resolveTorrentWithFiles(hash, 4, 800);
      if (!torrent) return;
      var files = [];
      if (torrent.file_stats && Array.isArray(torrent.file_stats)) files = torrent.file_stats;else
      if (torrent.data) {
        try {var data = JSON.parse(torrent.data);if (data.TorrServer && data.TorrServer.Files) files = data.TorrServer.Files;} catch (e) {}
      }
      var videoFiles = extractVideoFiles(files);
      if (videoFiles.length > 0) {
        currentEpisodeFiles = videoFiles;currentTorrentHash = hash;
        if (currentFileId) {
          currentEpisodeIndex = -1;
          for (var i = 0; i < videoFiles.length; i++) {if (String(videoFiles[i].id) == String(currentFileId)) {currentEpisodeIndex = i;break;}}
        } else if (AppState.videoUrl) {
          var match = AppState.videoUrl.match(/\/(\d+)$/);
          if (match && match[1]) {
            currentEpisodeIndex = -1;
            for (var j = 0; j < videoFiles.length; j++) {if (String(videoFiles[j].id) == String(match[1])) {currentEpisodeIndex = j;break;}}
          }
        }
        if (currentEpisodeIndex === -1 || currentEpisodeIndex === undefined) currentEpisodeIndex = 0;
        renderEpisodesList();
        if (AppState.isSerials) fetchSkipData(AppState.currentTMDB, AppState.currentSeason, currentFileId);
        var episodesBtn = getEl('episodes-btn');
        if (episodesBtn) episodesBtn.style.display = videoFiles.length > 1 ? 'flex' : 'none';
        updateEpisodeButtons();
      } else {
        currentEpisodeFiles = [];currentEpisodeIndex = 0;
        var episodesBtn = getEl('episodes-btn');
        if (episodesBtn) episodesBtn.style.display = 'none';
        updateEpisodeButtons();
      }
    } catch (error) {console.error('Ошибка загрузки серий:', error);}
  });return _loadEpisodesInfo.apply(this, arguments);}function














fetchSkipData(_x12, _x13, _x14) {return _fetchSkipData.apply(this, arguments);}function _fetchSkipData() {_fetchSkipData = _asyncToGenerator(function* (tmdbId, season, episode) {
    skipIntro = 0;
    skipCredits = 0;
    var url = getSkipApiBase() + '/v2/media?tmdb_id=' + tmdbId + '&season=' + season + '&episode=' + episode;
    try {
      var response = yield fetch(url);
      var data = yield response.json();
      if (data.error) {skipData = { error: true };} else
      {skipData = data;skipData.error = false;}
      return skipData;
    } catch (error) {skipData = { error: true };return skipData;}
  });return _fetchSkipData.apply(this, arguments);}

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
    var episodeNumber = idx + 1;
    html += '<div class="episode-item ' + (isActive ? 'active' : '') + '" data-index="' + idx + '" data-file-id="' + file.id + '">' +
    '<div class="episode-number">' + episodeNumber + '</div>' +
    '<div class="episode-info"><div class="episode-title">Серия ' + episodeNumber + '</div><div class="episode-duration">' + fileSize + '</div></div>' +
    '<button class="episode-play" title="Воспроизвести">▶</button></div>';
  }
  episodesList.innerHTML = html;



















  setupEpisodesListDelegation();
}function

switchToEpisode(_x15, _x16) {return _switchToEpisode.apply(this, arguments);}function _switchToEpisode() {_switchToEpisode = _asyncToGenerator(function* (index, fileId) {
    stopTorrentStatsUpdates();
    currentBufferAhead = 0;wasImmediatePause = false;pauseTimer = null;pauseStartTime = null;thisisseek = false;



    hideSkipButton();
    stopHeartbeat();
    if (!currentTorrentHash || !AppState.currentTorrserverUrl) return;
    if (index === currentEpisodeIndex) {toggleEpisodesPanel();return;}
    if (nearEndCheckInterval) {clearInterval(nearEndCheckInterval);nearEndCheckInterval = null;}
    yield saveTimecodeToServer();
    var savedAudioTrack = currentAudioTrack;
    var episodesPanel = getEl('episodes-panel');
    var episodesBtn = getEl('episodes-btn');
    if (episodesPanel) {episodesPanel.classList.add('hidden');if (episodesBtn) episodesBtn.classList.remove('active');}
    getEl('playback-overlay').classList.add('active');
    document.querySelector('.playback-text').textContent = 'Переключение на серию ' + (index + 1) + '...';
    try {
      var playUrl = AppState.currentTorrserverUrl + '/play/' + currentTorrentHash + '/' + fileId;
      currentEpisodeIndex = index;AppState.videoUrl = playUrl;
      if (AppState.currentStreamId) {
        yield fetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST' });
        AppState.currentStreamId = null;
      }
      var videoPlayer = getEl('video-player');
      videoPlayer.removeEventListener('ended', handleVideoEnded);
      destroyHls();
      if (currentTorrentHash && fileId) yield saveAudioPreference(currentTorrentHash, fileId, savedAudioTrack);
      yield startHLSPlayback(playUrl, 0, lastPlaybackFromSearch, index, savedAudioTrack);
      var fileName = yield getFileNameByHash(currentTorrentHash, fileId);
      if (fileName && AppState.currentDetailItem) updatePlayerTitle(AppState.currentDetailItem.title + ' - ' + fileName);
      renderEpisodesList();updateEpisodeButtons();
    } catch (error) {showSwitchFailedBanner('серию', error && error.message);} finally
    {
      getEl('playback-overlay').classList.remove('active');
      document.querySelector('.playback-text').textContent = 'Воспроизведение...';
      hidePlayerLoading();startHeartbeat();startTorrentStatsUpdates();
    }
  });return _switchToEpisode.apply(this, arguments);}







var PLAYER_PANELS = {
  episodes: { panel: 'episodes-panel', btn: 'episodes-btn' },
  audio: { panel: 'audio-panel', btn: 'audio-btn' },
  subtitles: { panel: 'subtitles-panel', btn: 'subtitles-btn' }
};

function setPlayerPanel(name, open) {
  var cfg = PLAYER_PANELS[name];
  if (!cfg) return false;
  var panel = getEl(cfg.panel),btn = getEl(cfg.btn);
  if (!panel) return false;
  if (open) {panel.classList.remove('hidden');if (btn) btn.classList.add('active');} else
  {panel.classList.add('hidden');if (btn) btn.classList.remove('active');}
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



      if (hash && currentEpisodeFiles.length && currentTorrentHash === hash) renderEpisodesList();else
      if (hash) loadEpisodesInfo(hash);
    } else if (name === 'audio') renderAudioTracks();else
    if (name === 'subtitles') renderSubtitleTracks();
  }
  setPlayerPanel(name, willOpen);
  return willOpen;
}






function setupPlayerPanelsOutsideClick() {
  if (setupPlayerPanelsOutsideClick._bound) return;
  setupPlayerPanelsOutsideClick._bound = true;
  document.addEventListener('click', function (e) {
    var inPlayer = AppState && AppState.currentScreen === 'player';
    for (var name in PLAYER_PANELS) {
      if (!isPlayerPanelOpen(name)) continue;
      var cfg = PLAYER_PANELS[name];
      var panel = getEl(cfg.panel),btn = getEl(cfg.btn);
      if (panel && panel.contains(e.target)) continue;
      if (btn && btn.contains(e.target)) continue;
      setPlayerPanel(name, false);
    }
    if (inPlayer) resetMouseIdleTimer();
  });
}

function toggleEpisodesPanel() {return togglePlayerPanel('episodes');}


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
  try {stale.controller.abort();} catch (e) {}
}

function preloadTorrents(hash, fileId) {
  if (!hash || !fileId || !AppState.currentTorrserverUrl) return;
  if (wasPreloadedRecently(hash, fileId)) return;
  var key = String(hash).toLowerCase() + ':' + fileId;
  var preloadUrl = AppState.currentTorrserverUrl + "/stream?link=" + hash + "&index=" + fileId + "&preload=preload";


  var headers = typeof getAuthHeaders === 'function' ? getAuthHeaders() : {};
  var options = { method: 'GET', keepalive: true, headers: headers };
  var controller = typeof AbortController === 'function' ? new AbortController() : null;
  abortPendingPreload();
  if (controller) {
    options.signal = controller.signal;
    pendingPreload = { key: key, controller: controller };
  }
  var done = function () {
    if (pendingPreload && pendingPreload.key === key) pendingPreload = null;
  };
  return fetch(preloadUrl, options).
  then(function (response) {done();return new Promise(function (resolve) {setTimeout(resolve, 4000);});}).
  catch(function (error) {done();return Promise.resolve();});
}

function getCurrentItemPoster() {
  var item = AppState.currentDetailItem;
  if (!item) return null;
  if (item.poster) return item.poster;
  if (item.poster_path && typeof getTmdbImageUrl === 'function') {
    try {return getTmdbImageUrl(item.poster_path, 'w342');} catch (e) {}
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
    var itemTime = i === startIndex && startSeekTime > 0 ? Math.floor(startSeekTime) :
    saved && saved.timecode > 0 ? Math.floor(saved.timecode) : 0;
    var itemDuration = saved && saved.duration > 0 ? saved.duration : 0;
    playlist.push({
      url: itemUrl,
      title: file.name || file.path || 'Серия ' + (i + 1),
      timecode: itemTime,
      timeline: {
        hash: currentTorrentHash + '_' + file.id,
        time: itemTime,
        duration: itemDuration,
        percent: itemDuration > 0 ? Math.round(itemTime / itemDuration * 100) : 0
      },
      episode: i + 1,
      season: AppState.currentSeason || null
    });
  }
  return playlist.length > 1 ? playlist : null;
}




























function buildBasePlayerTitle() {
  var base = AppState.currentDetailItem && AppState.currentDetailItem.title || '';
  if (!base) return '';
  if (AppState.currentSeason) return base + ' · Сезон ' + AppState.currentSeason;
  return base;
}

function buildExternalPlayerTitle() {
  var base = AppState.currentDetailItem && AppState.currentDetailItem.title || '';

  if (!currentEpisodeFiles || currentEpisodeFiles.length < 2) return base || 'Видео';

  var idx = currentEpisodeIndex;
  if (typeof idx !== 'number' || idx < 0 || !currentEpisodeFiles[idx]) return base || 'Видео';

  var part = 'Серия ' + (idx + 1);
  if (AppState.currentSeason) part = 'Сезон ' + AppState.currentSeason + ', ' + part;



  if (!base) {
    var file = currentEpisodeFiles[idx];
    return file.name || file.path || part;
  }

  return base + ' · ' + part;
}





var lastExternalOpen = { url: null, time: 0 };
var EXTERNAL_OPEN_DEDUP_MS = 2500;






function openAndroidPlayer(playURL, playerData) {
  if (!window.AndroidJS || !playURL) return false;
  var urlData = parseHashFromUrl(playURL);
  if (urlData) {
    currentTimecodeData.hash = urlData.torrentHash;
    currentTimecodeData.fileId = urlData.fileId;
    currentTimecodeData.timecode = playerData && playerData.timecode || 0;
  }
  if (lastExternalOpen.url === playURL && Date.now() - lastExternalOpen.time < EXTERNAL_OPEN_DEDUP_MS) return false;
  lastExternalOpen.url = playURL;lastExternalOpen.time = Date.now();
  AndroidJS.openPlayer(playURL, JSON.stringify(playerData));
  return true;
}
window.openAndroidPlayer = openAndroidPlayer;

function playInExternalPlayer(url, title, timecode, fromSearch) {
  if (!window.AndroidJS || !url) return false;
  var ref = parseStreamRef(url);
  if (ref) {
    var torrentHash = ref.hash;var fileId = parseInt(ref.fileId);
    var seekTime = timecode != null && timecode > 0 ? Math.floor(timecode) : 0;
    currentTimecodeData.hash = torrentHash;currentTimecodeData.fileId = fileId;currentTimecodeData.timecode = seekTime;
    var playURL = AppState.currentTorrserverUrl + "/stream?link=" + torrentHash + "&index=" + fileId + "&play=play";
    var item = AppState.currentDetailItem;
    var playerData = {
      url: playURL, title: title || 'Видео', iptv: false, timecode: seekTime,

      title_base: buildBasePlayerTitle(),



      skip_api: getSkipApiBase() + '/v2/media',
      tmdb_id: AppState.currentTMDB || null,
      season: AppState.currentSeason || null,




      timecode_api: SERVER_URL + '/api/timecode/save',
      client_id: localStorage.getItem('clientId') || null,
      timeline: { hash: torrentHash + '_' + fileId, time: seekTime, duration: 0, percent: 0 },
      poster: getCurrentItemPoster(),
      id: item && (item.tmdbId || item.id) || null,
      type: item && item.media_type || (AppState.isCatalogSerials ? 'tv' : 'movie')
    };
    if (AppState.autoSwitchEpisodes) {
      var playlist = buildEpisodesPlaylist(currentEpisodeIndex, seekTime);
      if (playlist) playerData.playlist = playlist;
    }



    var authHeaders = getAuthHeaders();
    if (authHeaders && authHeaders.Authorization) playerData.headers = { Authorization: authHeaders.Authorization };
    lastPlaybackFromSearch = fromSearch;
    if (!AppState.playFromHash) AppState.inSearch = 'torrents';else
    {AppState.currentDetailItem = AppState.androidBackCatalog;AppState.inSearch = 'catalog';}
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
    AppState.hls.loadSource(m3u8Url);AppState.hls.attachMedia(videoPlayer);
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


  if (AppState.dvPreferred) defaultConfig.videoPreference = { preferHDR: true };
  return new Hls(Object.assign({}, defaultConfig, configOverrides || {}));
}

function resetPlaybackState() {
  cancelCurrentPlayback();
  destroyHls();
  var videoPlayer = getEl('video-player');
  if (videoPlayer) videoPlayer.removeEventListener('ended', handleVideoEnded);
}












function capturePreplaybackScreen() {
  var dv = getEl('detail-view'),ts = getEl('torrserver-section'),cs = getEl('config-screen');
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
  var dv = getEl('detail-view'),ts = getEl('torrserver-section'),cs = getEl('config-screen');
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
  if (window.Nav) Nav.push('player', { key: 'player' });
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
}function

preparePlaybackMetadata(_x17, _x18, _x19, _x20) {return _preparePlaybackMetadata.apply(this, arguments);}function _preparePlaybackMetadata() {_preparePlaybackMetadata = _asyncToGenerator(function* (originalUrl, initialSeek, audioTrack, signal) {
    var match = originalUrl.match(/\/play\/([a-fA-F0-9]+)\/(\d+)\/?/);
    if (!match) {
      console.error('❌ Некорректный URL для воспроизведения:', originalUrl);

      if (typeof window.showErrorBanner === 'function') {
        window.showErrorBanner('Не удалось начать воспроизведение', 'Некорректная ссылка на видео');
      } else alert('Ошибка: Некорректная ссылка на видео');
      return null;
    }
    currentTimecodeData.hash = match[1];currentTimecodeData.fileId = match[2];currentTimecodeData.timecode = 0;




    var wantTimecode = initialSeek === null;
    var requests = [
    loadPlaybackPrepare(currentTimecodeData.hash, currentTimecodeData.fileId, wantTimecode),
    getFileNameByHash(currentTimecodeData.hash, currentTimecodeData.fileId)];

    if (initialSeek === null || initialSeek === 0) preloadTorrents(currentTimecodeData.hash, currentTimecodeData.fileId);
    var promiseResults = yield Promise.all(requests);
    if (signal.aborted) return null;
    var prepared = promiseResults[0];var fileName = promiseResults[1];
    var fileInfo = prepared.fileInfo;
    var savedAudioTrack = prepared.audioTrack;
    var savedSubTrack = prepared.subtitleTrack;
    var savedTimecode = prepared.timecode || null;
    if (fileInfo && fileInfo.audio) {currentAudioTracks = fileInfo.audio;currentAudioTrack = audioTrack !== null ? audioTrack : 0;}
    if (fileInfo && fileInfo.subtitles) currentSubTracks = fileInfo.subtitles;
    if (savedAudioTrack !== null && savedAudioTrack < currentAudioTracks.length) {
      currentAudioTrack = savedAudioTrack;
      if (audioTrack !== savedAudioTrack) audioTrack = savedAudioTrack;
    } else currentAudioTrack = audioTrack !== null ? audioTrack : 0;
    if (savedSubTrack !== null && savedSubTrack < currentSubTracks.length) currentSubtitleTrack = savedSubTrack;
    var seekTime = initialSeek;
    if (seekTime === null && wantTimecode) seekTime = savedTimecode > 0 ? savedTimecode : 0;
    return { match: match, fileInfo: fileInfo, savedAudioTrack: savedAudioTrack, fileName: fileName, savedSubTrack: savedSubTrack, savedTimecode: savedTimecode, seekTime: seekTime, audioTrack: audioTrack };
  });return _preparePlaybackMetadata.apply(this, arguments);}function

initGstPlayback(_x21, _x22, _x23) {return _initGstPlayback.apply(this, arguments);}function _initGstPlayback() {_initGstPlayback = _asyncToGenerator(function* (metadata, initialSeek, signal) {
    var playURL = AppState.currentTorrserverUrl + "/gst/" + currentTimecodeData.hash + "/master.m3u8?index=" + currentTimecodeData.fileId + "&audio=" + currentAudioTrack;
    var videoPlayer = getEl('video-player');
    destroyHls();
    var isTimeUpdated = false;var seekExecuted = false;
    var executeSeek = function () {
      if (seekExecuted) return;
      if (initialSeek > 0) {
        seekExecuted = true;
        try {var relativeTime = initialSeek - (AppState.seekOffset || 0);if (relativeTime > 0) videoPlayer.currentTime = parseInt(relativeTime);} catch (e) {}
        setTimeout(function () {seekStream(parseInt(initialSeek - (AppState.seekOffset || 0)), 'slider');}, 800);
        setTimeout(function () {if (Math.abs(videoPlayer.currentTime + (AppState.seekOffset || 0) - initialSeek) > 2) seekStream(parseInt(initialSeek - (AppState.seekOffset || 0)), 'slider');}, 2000);
      }
    };
    var timeUpdateHandler = function () {
      if (!isTimeUpdated && videoPlayer.currentTime > 0) {isTimeUpdated = true;hidePlayerLoading();executeSeek();videoPlayer.removeEventListener('timeupdate', timeUpdateHandler);}
    };
    videoPlayer.addEventListener('timeupdate', timeUpdateHandler);
    var canPlayHandler = function () {
      if (!isTimeUpdated && initialSeek > 0 && !seekExecuted) {
        try {var relativeTime = initialSeek - (AppState.seekOffset || 0);if (relativeTime > 0) videoPlayer.currentTime = parseInt(relativeTime);} catch (e) {}
        setTimeout(function () {if (!seekExecuted) {seekExecuted = true;seekStream(parseInt(initialSeek - (AppState.seekOffset || 0)), 'slider');}}, 300);
      }
    };
    videoPlayer.addEventListener('canplay', canPlayHandler);
    AppState._loadingTimeout = setTimeout(function () {
      if (!isTimeUpdated) {
        hidePlayerLoading();
        if (initialSeek > 0 && !seekExecuted) {
          seekExecuted = true;
          try {var relativeTime = initialSeek - (AppState.seekOffset || 0);if (relativeTime > 0) videoPlayer.currentTime = parseInt(relativeTime);} catch (e) {}
          setTimeout(function () {seekStream(parseInt(initialSeek - (AppState.seekOffset || 0)), 'slider');}, 500);
        }
        videoPlayer.removeEventListener('timeupdate', timeUpdateHandler);videoPlayer.removeEventListener('canplay', canPlayHandler);
      }
    }, LOADING_TIMEOUT_MS);
    if (Hls.isSupported()) {
      AppState.hls = createHlsInstance({ maxBufferLength: 20, maxMaxBufferLength: 40, startFragPrefetch: false, fragLoadingTimeOut: 20000, manifestLoadingTimeOut: 20000, enableWorker: false, cache: true });
      AppState.hls.loadSource(playURL);AppState.hls.attachMedia(videoPlayer);
      var manifestHandler = function () {
        videoPlayer.play()['catch'](function (err) {videoPlayer.muted = true;videoPlayer.play()['catch'](function () {});updateMuteButton();});
        startTimecodeSaving();resetMouseIdleTimer();startNearEndCheck();startHeartbeat();startTorrentStatsUpdates();
        AppState.hls.off(Hls.Events.MANIFEST_PARSED, manifestHandler);
      };
      AppState.hls.on(Hls.Events.MANIFEST_PARSED, manifestHandler);
      var gstNetworkRetries = 0;
      AppState.hls.on(Hls.Events.ERROR, function (event, data) {
        if (data.fatal) {
          hidePlayerLoading();videoPlayer.removeEventListener('timeupdate', timeUpdateHandler);videoPlayer.removeEventListener('canplay', canPlayHandler);
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
          } else
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) AppState.hls.recoverMediaError();
        }
      });
      AppState._timeUpdateHandler = timeUpdateHandler;AppState._canPlayHandler = canPlayHandler;AppState._seekExecuted = seekExecuted;
      showPlayerLoading('Подготовка потока...', null);
    } else throw new Error('Устройство не поддерживает HLS');
  });return _initGstPlayback.apply(this, arguments);}function

initTranscodingOffPlayback(_x24, _x25) {return _initTranscodingOffPlayback.apply(this, arguments);}function _initTranscodingOffPlayback() {_initTranscodingOffPlayback = _asyncToGenerator(function* (initialSeek, signal) {
    var playURL = AppState.currentTorrserverUrl + '/stream?link=' + currentTimecodeData.hash + '&index=' + currentTimecodeData.fileId + '&play=play';
    var videoPlayer = getEl('video-player');
    destroyHls();



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
      if (AppState._loadingTimeout) {clearTimeout(AppState._loadingTimeout);AppState._loadingTimeout = null;}
      videoPlayer.removeEventListener('canplay', onCanPlay);
      hidePlayerLoading();
      if (initialSeek > 0) {
        try {videoPlayer.currentTime = initialSeek;} catch (e) {}
      }
      videoPlayer.play()['catch'](function () {
        videoPlayer.muted = true;
        videoPlayer.play()['catch'](function () {});
        updateMuteButton();
      });
      videoPlayer.muted = false;updateMuteButton();
      startTimecodeSaving();resetMouseIdleTimer();startNearEndCheck();startHeartbeat();startTorrentStatsUpdates();
    };



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






      var nativeTracks = webosAudio.mode ? [] : collectNativeAudioTracks(videoPlayer);
      if (nativeTracks.length) {
        currentAudioTracks = nativeTracks;
        var enabled = -1;
        for (var i = 0; i < videoPlayer.audioTracks.length; i++) {
          if (videoPlayer.audioTracks[i].enabled) {enabled = i;break;}
        }
        currentAudioTrack = enabled >= 0 ? enabled : 0;
        renderAudioTracks();
      }
      refreshNativeSubtitles(videoPlayer);
      if (AppState.platform === 'webos') applyWebosProbe();
    };

    var onCanPlay = function () {
      startPlayback();
    };

    var onError = function () {
      detachDirectListeners();
      if (signal.aborted || AppState.currentScreen !== 'player') return;
      hidePlayerLoading();



      if (typeof window.showErrorBanner === 'function') {
        window.showErrorBanner('Файл не воспроизводится напрямую',
        'TorrServer не отдал поток либо кодек/контейнер не поддерживается устройством. ' +
        'Попробуйте перезапустить контент, выбрать другую раздачу или включить перекодирование.');
      } else alert('Файл не воспроизводится напрямую: кодек/контейнер не поддерживается устройством');
    };

    videoPlayer.addEventListener('loadedmetadata', onLoadedMetadata);
    videoPlayer.addEventListener('canplay', onCanPlay);
    videoPlayer.addEventListener('error', onError);


    AppState._directPlaybackDetach = detachDirectListeners;

    AppState._loadingTimeout = setTimeout(function () {
      if (!started && !signal.aborted) startPlayback();
    }, LOADING_TIMEOUT_MS);

    var staleMediaId = videoPlayer.mediaId;
    videoPlayer.src = playURL;
    videoPlayer.load();

    webosSubsStart(videoPlayer, staleMediaId);
    webosProbeStart(playURL);
    AppState.nativeVideoPlayer = videoPlayer;
    hidePlayerLoading();
  });return _initTranscodingOffPlayback.apply(this, arguments);}function

initServerProxyPlayback(_x26, _x27, _x28) {return _initServerProxyPlayback.apply(this, arguments);}function _initServerProxyPlayback() {_initServerProxyPlayback = _asyncToGenerator(function* (metadata, initialSeek, signal) {
    var seekParam = initialSeek && initialSeek > 0 ? '&start=' + initialSeek.toFixed(2) : '';
    var durationParam = metadata.fileInfo.duration && metadata.fileInfo.duration > 0 ? '&duration=' + metadata.fileInfo.duration.toFixed(0) : '';
    var audioParam = metadata.audioTrack !== null ? '&audio=' + metadata.audioTrack : '';
    var subParam = currentSubtitleTrack >= 0 ? '&sub=' + currentSubtitleTrack : '';
    var multiChannelParam = AppState.multiChannelEnabled === true ? '&multiChannel=true' : '';
    var savedClientId = localStorage.getItem('clientId');
    var dvParam = '&dv=' + (AppState.dvPreferred ? 'true' : 'false');

    var streamUrl = SERVER_URL + '/hls/stream?url=' + encodeURIComponent(AppState.videoUrl) + seekParam + audioParam + multiChannelParam + '&clientId=' + encodeURIComponent(savedClientId) + durationParam + subParam + dvParam;
    var response;
    try {

      response = yield fetchWithTimeout(streamUrl, { signal: signal }, PLAYER_FETCH_TIMEOUT_MS);
    } catch (e) {


      if (signal.aborted) throw e;
      if (e && e.name === 'AbortError') throw new Error('Сервер не создал поток за ' + Math.round(PLAYER_FETCH_TIMEOUT_MS / 1000) + ' с');
      throw e;
    }
    if (!response.ok) throw new Error('HTTP ' + response.status);
    var data = yield response.json();
    if (!data.success) throw new Error(data.error || 'Ошибка создания потока');
    AppState.currentStreamId = data.streamId;AppState.expectedDuration = data.duration;AppState.originalDuration = data.originalDuration || data.duration;
    AppState.seekOffset = data.seekOffset || initialSeek || 0;AppState.lastSuccessfulSeek = AppState.seekOffset;
    var videoPlayer = getEl('video-player');
    if (Hls.isSupported()) {
      AppState.hls = createHlsInstance();
      attachHlsEventListeners(AppState.hls, videoPlayer, signal, initialSeek);
      AppState.hls.loadSource(data.playlistUrl);AppState.hls.attachMedia(videoPlayer);
    } else throw new Error('Ваш браузер не поддерживает HLS');
  });return _initServerProxyPlayback.apply(this, arguments);}

function attachHlsEventListeners(hls, videoPlayer, signal, initialSeek) {
  var isPlaybackCancelled = false;
  var manifestParsedHandler = function () {
    if (signal.aborted || isPlaybackCancelled) return;
    forceUpdateDuration(AppState.expectedDuration, AppState.originalDuration, AppState.seekOffset);
    videoPlayer.currentTime = 0;videoPlayer.pause();startTorrentStatsUpdates();
    if (thisisseek) {
      hidePlayerLoading();
      if (!signal.aborted && !isPlaybackCancelled) videoPlayer.play()['catch'](function (err) {videoPlayer.muted = true;videoPlayer.play()['catch'](function () {});updateMuteButton();});
      videoPlayer.muted = false;updateMuteButton();startTimecodeSaving();resetMouseIdleTimer();
      if (nearEndCheckInterval) clearInterval(nearEndCheckInterval);
      startNearEndCheck();startHeartbeat();return;
    }
    showPlayerLoading('Буферизация...', null);
    var onCanPlay = function () {



      if (AppState._loadingTimeout) {clearTimeout(AppState._loadingTimeout);AppState._loadingTimeout = null;}
      hidePlayerLoading();
      if (!signal.aborted && !isPlaybackCancelled) videoPlayer.play()['catch'](function (err) {videoPlayer.muted = true;videoPlayer.play()['catch'](function () {});updateMuteButton();});
      videoPlayer.muted = false;updateMuteButton();startTimecodeSaving();resetMouseIdleTimer();
      if (nearEndCheckInterval) clearInterval(nearEndCheckInterval);
      startNearEndCheck();startHeartbeat();videoPlayer.removeEventListener('canplay', onCanPlay);
    };
    videoPlayer.addEventListener('canplay', onCanPlay);
    AppState._loadingTimeout = setTimeout(function () {
      if (!signal.aborted && !isPlaybackCancelled) {
        videoPlayer.removeEventListener('canplay', onCanPlay);hidePlayerLoading();
        videoPlayer.play()['catch'](function (err) {videoPlayer.muted = true;videoPlayer.play()['catch'](function () {});updateMuteButton();});
        videoPlayer.muted = false;updateMuteButton();startTimecodeSaving();resetMouseIdleTimer();
        if (nearEndCheckInterval) clearInterval(nearEndCheckInterval);
        startNearEndCheck();startHeartbeat();
      }
    }, 3000);
  };
  hls.off(Hls.Events.MANIFEST_PARSED, manifestParsedHandler);hls.on(Hls.Events.MANIFEST_PARSED, manifestParsedHandler);
  var fragLoadingHandler = function (event, data) {if (signal.aborted) return;};
  hls.off(Hls.Events.FRAG_LOADING, fragLoadingHandler);hls.on(Hls.Events.FRAG_LOADING, fragLoadingHandler);
  var bufferAppendedHandler = function (event, data) {if (signal.aborted) return;};
  hls.off(Hls.Events.BUFFER_APPENDED, bufferAppendedHandler);hls.on(Hls.Events.BUFFER_APPENDED, bufferAppendedHandler);
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
            fetch(SERVER_URL + '/hls/cleanup-segments/' + AppState.currentStreamId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keepFromSegment: segmentNumber }) }).catch(function () {});
          }
        }
      }
    }
  };
  hls.off(Hls.Events.FRAG_CHANGED, fragChangedHandler);hls.on(Hls.Events.FRAG_CHANGED, fragChangedHandler);
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
        var errorMessage = data.error ? data.error.message || data.error : '';var errorDetails = data.details || '';
        var isUnsupportedCodec = errorMessage.toLowerCase().includes('codec') || errorDetails.toLowerCase().includes('codec');
        if (AppState.videoUrl && (AppState.videoUrl.toLowerCase().includes('.avi') || AppState.videoUrl.toLowerCase().includes('.vc1'))) isUnsupportedCodec = true;
        if (isUnsupportedCodec) {
          getEl('playback-overlay').classList.add('active');document.querySelector('.playback-text').textContent = 'Формат AVI или VC1 не поддерживаются на вашем устройстве';hidePlayerLoading();
          setTimeout(function () {var exitBtn = getEl('exit-player-btn');if (exitBtn) exitBtn.click();else if (typeof showDetailView === 'function') showDetailView();getEl('playback-overlay').classList.remove('active');}, 4000);
        } else AppState.hls.recoverMediaError();
        break;
      default:
        AppState.playbackRetryCount = (AppState.playbackRetryCount || 0) + 1;
        if (AppState.playbackRetryCount <= MAX_PLAYBACK_RETRIES) {
          showPlayerLoading('Ошибка воспроизведения, попытка ' + AppState.playbackRetryCount + '...');
          setTimeout(function () {if (AppState.currentStreamId && !signal.aborted) startHLSPlayback(AppState.videoUrl, videoPlayer.currentTime + AppState.seekOffset, false);}, 2000);
        } else {
          hidePlayerLoading();

          if (typeof window.showErrorBanner === 'function') {
            window.showErrorBanner('Не удалось воспроизвести видео',
            'Проверьте соединение или формат файла. Попробуйте перезапустить контент или выбрать другую раздачу.');
          } else alert('Не удалось воспроизвести видео. Проверьте соединение или формат файла.');
          if (typeof showDetailView === 'function') showDetailView();
        }
        break;
    }
  };
  hls.off(Hls.Events.ERROR, errorHandler);hls.on(Hls.Events.ERROR, errorHandler);
}








function parseStreamRef(url) {
  if (!url) return null;
  var direct = url.match(/\/play\/([a-fA-F0-9]{40})\/(\d+)/);
  if (direct) return { hash: direct[1], fileId: direct[2] };

  var linkParam = (url.match(/[?&]link=([^&]+)/) || [])[1];
  var indexParam = (url.match(/[?&]index=(\d+)/) || [])[1];
  if (!linkParam || !indexParam) return null;

  var decoded = decodeURIComponent(linkParam);
  var hash = /^[a-fA-F0-9]{40}$/.test(decoded) ?
  decoded :
  typeof extractHashFromMagnet === 'function' ? extractHashFromMagnet(decoded) : null;
  return hash ? { hash: hash, fileId: indexParam } : null;
}function

startHLSPlayback(_x29, _x30, _x31, _x32, _x33) {return _startHLSPlayback.apply(this, arguments);}function _startHLSPlayback() {_startHLSPlayback = _asyncToGenerator(function* (originalUrl, initialSeek, fromSearch, episodeIndex, audioTrack) {
    if (initialSeek === undefined) initialSeek = null;
    if (fromSearch === undefined) fromSearch = false;
    if (episodeIndex === undefined) episodeIndex = null;
    if (audioTrack === undefined) audioTrack = currentAudioTrack !== undefined ? currentAudioTrack : null;




    if (AppState.preloadBeforePlay && AppState.currentScreen !== 'player' && typeof runPlaybackPreload === 'function') {
      var preloadRef = parseStreamRef(originalUrl);
      if (preloadRef) {
        var preloadTitle = AppState.currentDetailItem ? AppState.currentDetailItem.title || AppState.currentDetailItem.name || '' : '';
        if (!(yield runPlaybackPreload(preloadRef.hash, preloadRef.fileId, preloadTitle))) return false;
      }
    }
    if (window.AndroidJS) {
      var androidRef = parseStreamRef(originalUrl);





      if (AppState.autoSwitchEpisodes && AppState.currentDetailItem && AppState.currentDetailItem.hash) {
        try {yield loadEpisodesInfo(AppState.currentDetailItem.hash, androidRef ? androidRef.fileId : null);} catch (e) {}



        if (typeof getTorrentProgressBatch === 'function') {
          try {yield getTorrentProgressBatch(AppState.currentDetailItem.hash, currentEpisodeFiles);} catch (e) {}
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
        getEl('config-screen').style.display = 'none';getEl('torrserver-section').style.display = 'none';return;
      }
    }
    resetPlaybackState();
    currentPlaybackController = new AbortController();var signal = currentPlaybackController.signal;
    currentBufferAhead = 0;wasImmediatePause = false;pauseTimer = null;pauseStartTime = null;AppState.playbackRetryCount = 0;
    if (!originalUrl || !originalUrl.trim()) {
      if (typeof window.showErrorBanner === 'function') {
        window.showErrorBanner('Не удалось начать воспроизведение', 'Ссылка на видео не указана');
      } else alert('Ошибка: URL не указан');
      return false;
    }
    lastPlaybackFromSearch = fromSearch;

    var metadata = yield preparePlaybackMetadata(originalUrl, initialSeek, audioTrack, signal);
    if (!metadata || signal.aborted) return false;
    var { fileInfo, savedAudioTrack, fileName, savedSubTrack, savedTimecode, seekTime } = metadata;
    initialSeek = seekTime;












    var needsFileInfo = !AppState.transcodingOnOff && !AppState.transcodingFullOnOff;
    if (needsFileInfo && (!fileInfo || fileInfo.success === false)) {
      showPlaybackUnavailableBanner('/api/file/info не отдал данные о ' +
      currentTimecodeData.hash + '/' + currentTimecodeData.fileId);
      return false;
    }

    if (fileName) updatePlayerTitle(fileName);else
    if (AppState.currentDetailItem && AppState.currentDetailItem.title) updatePlayerTitle(AppState.currentDetailItem.title);
    if (AppState.currentDetailItem && AppState.currentDetailItem.hash) {
      var currentFileId = episodeIndex !== null && currentEpisodeFiles[episodeIndex] ? currentEpisodeFiles[episodeIndex].id : metadata.match ? metadata.match[2] : null;
      setTimeout(function () {if (!signal.aborted) loadEpisodesInfo(AppState.currentDetailItem.hash, currentFileId);}, fromSearch ? EPISODES_LOAD_DELAY_SEARCH_MS : EPISODES_LOAD_DELAY_MS);
    }
    var preplayback = capturePreplaybackScreen();
    transitionToPlayerScreen();AppState.videoUrl = originalUrl;
    var videoPlayer = getEl('video-player');
    videoPlayer.removeEventListener('ended', handleVideoEnded);videoPlayer.addEventListener('ended', handleVideoEnded);
    try {
      if (AppState.transcodingOnOff) {
        yield initGstPlayback(metadata, initialSeek, signal);
      } else if (AppState.transcodingFullOnOff) {
        nativeSubState.savedPref = metadata && metadata.savedSubTrack !== null && metadata.savedSubTrack !== undefined ?
        metadata.savedSubTrack : -1;
        yield initTranscodingOffPlayback(initialSeek, signal);
      } else {
        yield initServerProxyPlayback(metadata, initialSeek, signal);
      }
      showPlayerHint();return true;
    } catch (error) {
      if (error.name === 'AbortError') return false;



      cancelCurrentPlayback();
      restorePreplaybackScreen(preplayback);
      showPlaybackUnavailableBanner(error && error.message);
      return false;
    }
  });return _startHLSPlayback.apply(this, arguments);}

function cancelCurrentPlayback() {
  if (currentPlaybackController) {currentPlaybackController.abort();currentPlaybackController = null;}
  if (AppState.bufferCheckInterval) {clearInterval(AppState.bufferCheckInterval);AppState.bufferCheckInterval = null;}
  if (AppState._loadingTimeout) {clearTimeout(AppState._loadingTimeout);AppState._loadingTimeout = null;}
  if (AppState._seekTimeout) {clearTimeout(AppState._seekTimeout);AppState._seekTimeout = null;}
  if (AppState.seekTimeout) {clearTimeout(AppState.seekTimeout);AppState.seekTimeout = null;}
  if (AppState.hls) {try {AppState.hls.destroy();AppState.hls = null;} catch (e) {}}
  if (AppState.currentStreamId) {fetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST' })['catch'](function () {});AppState.currentStreamId = null;}
  hidePlayerLoading();
}

function showDetailView(field = null) {



  var navUnder = window.Nav ? Nav.pop('player') || Nav.top() : null;
  if (!window.AndroidJS) {
    resetNativeSubtitles();
    currentSubtitleTrack = -1;stopTorrentStatsUpdates();hideSkipButton();skipIntro = 0;skipCredits = 0;
    currentBufferAhead = 0;wasImmediatePause = false;pauseTimer = null;pauseStartTime = null;thisisseek = false;
    var seekSlider = getEl('seek-slider');if (seekSlider) seekSlider.value = 0;
    var currentTimeSpan = getEl('current-time');if (currentTimeSpan) currentTimeSpan.textContent = '00:00';
    if (AppState) {AppState.seekQueue = [];AppState.isSeeking = false;AppState.previewTime = null;AppState.suppressTimeUpdate = false;}
    if (AppState.isYoutubePlayback) {
      if (typeof window.exitYoutubePlayer === 'function') window.exitYoutubePlayer();else
      {
        if (AppState.currentStreamId) {fetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST' })['catch'](function () {});AppState.currentStreamId = null;}
        if (AppState.hls) {AppState.hls.destroy();AppState.hls = null;}
        AppState.isYoutubePlayback = false;AppState.currentScreen = 'catalog';getEl('player-screen').style.display = 'none';
        var detailView = getEl('detail-view');
        if (detailView && AppState.youtubeContext) {
          if (typeof Animations !== 'undefined' && typeof Animations.ensureDetailVisible === 'function') Animations.ensureDetailVisible();else
          {detailView.style.display = 'block';detailView.style.pointerEvents = 'auto';}
        } else
        if (typeof window.showCatalogList === 'function') window.showCatalogList();
      }
      return;
    }
    trackTimecodeSave(saveTimecodeToServer()).then(function () {stopTimecodeSaving();});
    stopHeartbeat();
    if (nearEndCheckInterval) {clearInterval(nearEndCheckInterval);nearEndCheckInterval = null;}
    lastCleanedSegment = -1;currentEpisodeFiles = [];currentEpisodeIndex = 0;currentTorrentHash = null;
    updatePlayerTitle(null);clearTimecodeData();
    if (typeof window.hideSeekOverlay === 'function') window.hideSeekOverlay();
    closePlayerPanels();
    var episodesBtn = getEl('episodes-btn');
    if (episodesBtn) episodesBtn.style.display = 'none';
    var prevBtn = getEl('prev-episode-btn');var nextBtn = getEl('next-episode-btn');
    if (prevBtn) prevBtn.style.display = 'none';if (nextBtn) nextBtn.style.display = 'none';
    AppState.currentScreen = 'detail';
    var videoPlayer = getEl('video-player');
    videoPlayer.removeEventListener('ended', handleVideoEnded);videoPlayer.pause();videoPlayer.removeAttribute('src');videoPlayer.load();
    destroyHls();hidePlayerLoading();
    if (AppState.currentStreamId) {fetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST' })['catch'](function () {});AppState.currentStreamId = null;}
    getEl('player-screen').style.display = 'none';
    getEl('config-screen').style.display = 'none';



    if (navUnder && navUnder.screen === 'search') {
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
            if (focusableElements[i].classList && focusableElements[i].classList.contains('search-result-item')) {setFocus(i);break;}
          }
        }
      }, 100);
      return;
    }

    getEl('torrserver-section').style.display = 'block';
  }












  var watchedHash = AppState.currentDetailItem && AppState.currentDetailItem.hash || null;
  var dropped = watchedHash ?
  dropTorrentToServer(watchedHash)['catch'](function (error) {return null;}) :
  Promise.resolve(null);
  dropped.then(function () {
    return refreshTorrentsList();
  }).then(function () {
    if (watchedHash && torrentProgressCache.has(watchedHash)) torrentProgressCache.delete(watchedHash);
  })['catch'](function (error) {});
  if (lastPlaybackFromSearch && lastAddedTorrentHash) {
    setTimeout(function () {
      var found = showDetailByHash(lastAddedTorrentHash);
      if (!found) refreshTorrentsList().then(function () {showDetailByHash(lastAddedTorrentHash);});
    }, 500);
    lastPlaybackFromSearch = false;
  } else {
    var detailView = getEl('detail-view');
    var restoreDetail = typeof Animations !== 'undefined' && typeof Animations.ensureDetailVisible === 'function' ?
    Animations.ensureDetailVisible :
    function () {detailView.style.display = 'block';};
    if (AppState.currentDetailItem) {restoreDetail();updateDetailProgress(AppState.currentDetailItem);} else
    detailView.style.display = 'none';
    setTimeout(function () {
      if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
        updateFocusableElements();var progressBtnIndex = -1;
        if (typeof focusableElements !== 'undefined') {
          var fieldAsNumber = Number(field);
          if (field != null && !isNaN(fieldAsNumber)) setFocus(fieldAsNumber + 1);else
          {
            for (var i = 0; i < focusableElements.length; i++) {
              var el = focusableElements[i];
              if (el && (el.classList.contains('detail-progress-btn') || el.classList.contains('file-item') || el.classList.contains('back-btn'))) {progressBtnIndex = i;break;}
            }
            setFocus(progressBtnIndex !== -1 ? progressBtnIndex : 0);
          }
        }
      }
    }, 250);
  }
}function

updateDetailProgress(_x34) {return _updateDetailProgress.apply(this, arguments);}function _updateDetailProgress() {_updateDetailProgress = _asyncToGenerator(function* (torrent) {
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
    btn.innerHTML =
    '<span class="btn-label">▶ Продолжить</span>' +
    '<span class="btn-hint">' + hint + '</span>';


    updateCurrentFileProgress(torrent.hash, progress.fileId, progress.timecode, progress.duration);

    return fileId;
  });return _updateDetailProgress.apply(this, arguments);}











function updateCurrentFileProgress(hash, fileId, timecode, duration) {
  if (!hash || !fileId) return;
  if (!(timecode > 0) || !(duration > 0)) return;
  var fileItems = document.querySelectorAll('.file-item');var targetItem = null;
  for (var i = 0; i < fileItems.length; i++) {if (fileItems[i].dataset.hash === hash && fileItems[i].dataset.fileId == fileId) {targetItem = fileItems[i];break;}}
  if (!targetItem) return;
  var progressPercent = Math.min(timecode / duration * 100, 98);
  var progressFill = targetItem.querySelector('.file-progress-fill');
  if (progressFill) {progressFill.style.width = progressPercent + '%';if (progressPercent > 5) targetItem.classList.add('has-progress');}
}function










loadFileInfo(_x35, _x36) {return _loadFileInfo.apply(this, arguments);}function _loadFileInfo() {_loadFileInfo = _asyncToGenerator(function* (hash, fileId) {
    try {
      var savedClientId = localStorage.getItem('clientId');
      var response = yield fetchWithTimeout(SERVER_URL + '/api/file/info?hash=' + hash + '&fileId=' + fileId + '&clientId=' + encodeURIComponent(savedClientId), null, FILE_INFO_FETCH_TIMEOUT_MS);
      if (response.ok) return yield response.json();
      console.warn('⚠️ /api/file/info вернул HTTP ' + response.status);
    } catch (error) {
      console.warn('⚠️ /api/file/info недоступен:', error && error.name === 'AbortError' ? 'таймаут' : error && error.message);
    }
    return null;
  });return _loadFileInfo.apply(this, arguments);}

function renderAudioTracks() {
  var audioList = getEl('audio-list');if (!audioList) return;
  if (AppState.transcodingFullOnOff && (!currentAudioTracks || currentAudioTracks.length === 0)) {
    audioList.innerHTML = '<div class="search-result-empty">Нет аудиодорожек</div>';return;
  }
  if (!currentAudioTracks || currentAudioTracks.length === 0) {audioList.innerHTML = '<div class="search-result-empty">Нет аудиодорожек</div>';return;}
  var html = '';
  for (var idx = 0; idx < currentAudioTracks.length; idx++) {
    var track = currentAudioTracks[idx];var isActive = idx === currentAudioTrack;
    var language = track.language || 'unknown';var channels = track.channels ? track.channels + ' ch' : '';var codec = track.codec || '';
    html += '<div class="audio-item ' + (isActive ? 'active' : '') + '" data-track-index="' + idx + '">' +
    '<div class="audio-icon">🔊</div><div class="audio-info"><div class="audio-title">' + escapeHtml(track.title || 'Дорожка ' + (idx + 1)) + '</div>' +
    '<div class="audio-details"><span class="audio-language">' + language.toUpperCase() + '</span>' + (channels ? ' <span class="audio-channels">' + channels + '</span>' : '') + (codec ? ' <span class="audio-codec">' + codec + '</span>' : '') + '</div></div><div class="audio-check">✓</div></div>';
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
      title: list[i].label || 'Дорожка ' + (i + 1),
      language: list[i].language || 'und',
      channels: null,
      codec: null
    });
  }
  return tracks;
}function

switchAudioTrack(_x37) {return _switchAudioTrack.apply(this, arguments);}function _switchAudioTrack() {_switchAudioTrack = _asyncToGenerator(function* (trackIndex) {
    if (trackIndex === currentAudioTrack) {toggleAudioPanel();return;}
    if (AppState.transcodingFullOnOff) {


      switchNativeAudioTrack(AppState.nativeVideoPlayer || getEl('video-player'), trackIndex);
      return;
    }
    thisisseek = false;yield saveTimecodeToServer();
    if (currentTimecodeData.hash && currentTimecodeData.fileId) yield saveAudioPreference(currentTimecodeData.hash, currentTimecodeData.fileId, trackIndex);
    var audioPanel = getEl('audio-panel');var audioBtn = getEl('audio-btn');
    if (audioPanel) {audioPanel.classList.add('hidden');if (audioBtn) audioBtn.classList.remove('active');}
    var videoPlayer = getEl('video-player');var currentTime = videoPlayer.currentTime + AppState.seekOffset;
    getEl('playback-overlay').classList.add('active');document.querySelector('.playback-text').textContent = 'Переключение аудиодорожки...';
    try {
      var parsed = AppState.videoUrl.match(/\/play\/([a-fA-F0-9]+)\/(\d+)/);if (!parsed) return;
      var hash = parsed[1];var fileId = parsed[2];var playUrl = AppState.currentTorrserverUrl + '/play/' + hash + '/' + fileId;
      if (AppState.currentStreamId) {yield fetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST' });AppState.currentStreamId = null;}
      destroyHls();yield startHLSPlayback(playUrl, currentTime, lastPlaybackFromSearch, currentEpisodeIndex, trackIndex);
      currentAudioTrack = trackIndex;renderAudioTracks();
    } catch (error) {showSwitchFailedBanner('аудиодорожку', error && error.message);} finally
    {getEl('playback-overlay').classList.remove('active');document.querySelector('.playback-text').textContent = 'Воспроизведение...';}
  });return _switchAudioTrack.apply(this, arguments);}

function switchNativeAudioTrack(videoPlayer, index) {
  if (webosAudio.mode && webosSubs.mediaId) {
    lunaCall('selectTrack', { type: 'audio', mediaId: webosSubs.mediaId, index: index });


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
    for (var i = 0; i < videoPlayer.audioTracks.length; i++) {
      videoPlayer.audioTracks[i].enabled = i === index;
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












var webosSubs = { mediaId: null, timer: null, bridge: null, list: null, enabled: false, index: -1, onSeeked: null, gen: 0 };


var webosSubsDiag = { bridge: '', mediaId: '', waitedMs: 0, responses: 0, keys: '', sourceInfo: false, tracks: null, audio: null, probe: '', error: '' };



var webosAudio = { mode: false, list: [] };
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
      return webOS.service.request(uri, { method: method, parameters: params, onSuccess: onSuccess, onFailure: fail, subscribe: !!params.subscribe });
    }
    if (typeof window.PalmServiceBridge === 'undefined') {fail({ errorText: 'нет PalmServiceBridge' });return null;}
    var bridge = new window.PalmServiceBridge();
    bridge.onservicecallback = function (msg) {
      var r = {};
      try {r = JSON.parse(msg);} catch (e) {}
      if (r.returnValue === false || r.errorCode) fail(r);else
      if (onSuccess) onSuccess(r);
    };
    bridge.call(uri + '/' + method, JSON.stringify(params));
    return bridge;
  } catch (e) {fail({ errorText: e.message });return null;}
}

function webosSubsCancel() {
  if (webosSubs.timer) {clearInterval(webosSubs.timer);webosSubs.timer = null;}
  if (webosSubs.bridge) {
    try {if (typeof webosSubs.bridge.cancel === 'function') webosSubs.bridge.cancel();} catch (e) {}
    webosSubs.bridge = null;
  }
}

function webosSetSubtitle(index) {
  if (!webosSubs.mediaId) return;
  var on = index >= 0;
  lunaCall('setSubtitleEnable', { mediaId: webosSubs.mediaId, enable: on });
  webosSubs.enabled = on;
  webosSubs.index = index;
  if (on) {
    var mediaId = webosSubs.mediaId;


    setTimeout(function () {
      if (webosSubs.mediaId !== mediaId) return;
      lunaCall('selectTrack', { type: 'text', mediaId: mediaId, index: index });
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
      return { title: lang ? LANG_NAMES[lang] || lang.toUpperCase() : 'Дорожка ' + (i + 1), language: lang || 'und', channels: a.channels || null, codec: a.codec || null };
    });

    var vp = getEl('video-player'),at = vp && vp.audioTracks,playing = -1;
    if (at && at.length === audio.length) {
      for (var k = 0; k < at.length; k++) if (at[k].enabled) {playing = k;break;}
    }
    if (playing < 0) playing = currentAudioTrack >= 0 && currentAudioTrack < audio.length ? currentAudioTrack : 0;
    currentAudioTrack = playing;
    renderAudioTracks();
  }
  var subs = info && info.subtitleTrackInfo || [];
  webosSubs.list = subs;
  webosSubsDiag.tracks = subs.length;
  if (!subs.length) {applyWebosProbe();return;}
  nativeSubState.mode = 'webos';
  currentSubTracks = subs.map(function (s, i) {
    var lang = s.language && s.language !== '(null)' ? s.language : '';
    return { title: s.title || s.name || (lang ? lang.toUpperCase() : 'Субтитры ' + (i + 1)), language: lang || 'und', format: s.type || '' };
  });
  var want = currentSubtitleTrack >= 0 ? currentSubtitleTrack : nativeSubState.savedPref;
  currentSubtitleTrack = want >= 0 && want < subs.length ? want : -1;
  if (currentSubtitleTrack >= 0) webosSetSubtitle(currentSubtitleTrack);
  renderSubtitleTracks();
  applyWebosProbe();
}










var webosProbe = { gen: 0, streams: null, count: '' };
var LANG_NAMES = {
  rus: 'Русский', ru: 'Русский', eng: 'English', en: 'English', ukr: 'Українська', uk: 'Українська',
  bel: 'Беларуская', kaz: 'Қазақша', jpn: '日本語', ja: '日本語', kor: '한국어', chi: '中文', zho: '中文',
  ger: 'Deutsch', deu: 'Deutsch', fre: 'Français', fra: 'Français', spa: 'Español', ita: 'Italiano',
  por: 'Português', pol: 'Polski', tur: 'Türkçe', ara: 'العربية', heb: 'עברית', hin: 'हिन्दी'
};
var TEXT_SUB_CODECS = { subrip: 1, srt: 1, ass: 1, ssa: 1, webvtt: 1, mov_text: 1, text: 1 };

var HIDDEN_AUDIO_CODECS = { dts: 1, truehd: 1, mlp: 1 };


function langKey(l) {
  l = String(l || '').toLowerCase();
  if (!l || l === 'und' || l === 'unknown' || l === '(null)') return '';
  return LANG_NAMES[l] || l;
}








function alignProbeStreams(tracks, streams, hidden) {
  if (!tracks.length || !streams.length) return null;
  if (streams.length === tracks.length) return streams;
  var visible = streams.filter(function (s) {return !hidden(s);});
  if (visible.length === tracks.length) return visible;
  var sources = [visible, streams];
  for (var n = 0; n < sources.length; n++) {
    var src = sources[n],out = [],j = 0;
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

function probeLang(s) {
  var l = s && s.tags && s.tags.language || '';
  return l && l !== 'und' ? l : '';
}

function probeTitle(s, kind, i) {

  var t = String(s && s.tags && s.tags.title || '').replace(/^["'«\s]+|["'»\s]+$/g, '');
  var lang = probeLang(s);
  var name = LANG_NAMES[lang] || (lang ? lang.toUpperCase() : '');
  if (t && name && t.toLowerCase().indexOf(name.toLowerCase()) === -1) return t + ' · ' + name;
  return t || name || (kind === 'audio' ? 'Дорожка ' : 'Субтитры ') + (i + 1);
}






function applyWebosProbe() {
  var streams = webosProbe.streams;
  if (!streams) return;
  var audio = [],subs = [];
  for (var i = 0; i < streams.length; i++) {
    if (streams[i].codec_type === 'audio') audio.push(streams[i]);else
    if (streams[i].codec_type === 'subtitle') subs.push(streams[i]);
  }
  var diag = [];
  if (currentAudioTracks.length && !currentAudioTracks[0].probed) {
    var a = alignProbeStreams(currentAudioTracks, audio, function (s) {return HIDDEN_AUDIO_CODECS[s.codec_name];});
    if (a) {
      currentAudioTracks = currentAudioTracks.map(function (t, k) {
        return { title: probeTitle(a[k], 'audio', k), language: probeLang(a[k]) || t.language, channels: a[k].channels || null, codec: (a[k].codec_name || '').toUpperCase(), probed: true };
      });
      renderAudioTracks();
    }
    diag.push('звук ' + currentAudioTracks.length + '/' + audio.length + (a ? ' ✓' : ' ✗'));
  }
  if (currentSubTracks.length && !currentSubTracks[0].probed) {

    var s = alignProbeStreams(currentSubTracks, subs, function (x) {return !TEXT_SUB_CODECS[x.codec_name];});
    if (s) {
      currentSubTracks = currentSubTracks.map(function (t, k) {
        var d = s[k].disposition || {};
        return { title: probeTitle(s[k], 'subtitle', k), language: probeLang(s[k]) || t.language, format: (s[k].codec_name || '').toUpperCase(), default: !!d.default, forced: !!d.forced, probed: true };
      });
      renderSubtitleTracks();
    }
    diag.push('субтитры ' + currentSubTracks.length + '/' + subs.length + (s ? ' ✓' : ' ✗'));
  }

  if (diag.length) webosSubsDiag.probe = webosProbe.count + ' · ' + diag.join(', ');
}


function webosProbeStart(playURL) {
  webosProbe.streams = null;
  var gen = ++webosProbe.gen;
  if (AppState.platform !== 'webos' || !lunaAvailable()) return;
  var uri = playURL;

  if (AppState.authEnabled && AppState.authLogin) {
    uri = uri.replace(/^(https?:\/\/)/, '$1' + encodeURIComponent(AppState.authLogin) + ':' + encodeURIComponent(AppState.authPassword || '') + '@');
  }
  webosSubsDiag.probe = 'запрос…';
  lunaRequest('luna://com.torrstream.app.service', 'ffprobe', { uri: uri }, function (r) {
    if (gen !== webosProbe.gen) return;
    var parsed = null;
    try {parsed = JSON.parse(r.data || '{}');} catch (e) {}
    if (!parsed || !parsed.streams) {webosSubsDiag.probe = 'пустой ответ';return;}
    webosProbe.streams = parsed.streams;
    webosProbe.count = 'потоков: ' + parsed.streams.length;
    webosSubsDiag.probe = webosProbe.count;
    applyWebosProbe();
  }, function (r) {
    if (gen !== webosProbe.gen) return;
    webosSubsDiag.probe = 'ошибка: ' + (r && (r.errorText || r.errorCode) || '?');
  }, true);
}









function webosSubsStart(videoPlayer, staleId) {
  webosSubsReset();
  if (AppState.platform !== 'webos' || !videoPlayer) return;
  webosSubsDiag.bridge = lunaBridgeName() || 'нет';
  webosSubsDiag.mediaId = '';webosSubsDiag.waitedMs = 0;webosSubsDiag.responses = 0;
  webosSubsDiag.keys = '';webosSubsDiag.sourceInfo = false;webosSubsDiag.tracks = null;webosSubsDiag.error = '';
  if (!lunaAvailable()) return;
  var gen = ++webosSubs.gen;
  var startedAt = Date.now();
  webosSubs.timer = setInterval(function () {
    var waited = Date.now() - startedAt;
    webosSubsDiag.waitedMs = waited;
    if (gen !== webosSubs.gen || AppState.currentScreen !== 'player' || waited > 30000) {webosSubsCancel();return;}
    var id = videoPlayer.mediaId;


    if (!id || id === staleId && waited < 3000) return;
    clearInterval(webosSubs.timer);webosSubs.timer = null;
    webosSubs.mediaId = id;
    webosSubsDiag.mediaId = String(id);
    var deadline = setTimeout(function () {
      if (gen === webosSubs.gen && !webosSubs.list) {
        if (!webosSubsDiag.error) webosSubsDiag.error = 'sourceInfo не пришёл за 20 с';
        webosSubsCancel();
      }
    }, 20000);
    webosSubs.bridge = lunaCall('subscribe', { mediaId: id, subscribe: true }, function (r) {
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










var nativeSubState = { tracks: [], active: null, onCue: null, savedPref: -1, listening: false, mode: 'tracks' };

function collectNativeTextTracks(videoPlayer) {
  var list = videoPlayer && videoPlayer.textTracks,out = [];
  if (!list) return out;
  for (var i = 0; i < list.length; i++) {

    if (list[i].kind === 'chapters' || list[i].kind === 'descriptions') continue;
    out.push(list[i]);
  }
  return out;
}

function nativeSubtitleBox() {
  var box = getEl('native-subtitles');
  if (!box) {
    box = document.createElement('div');
    box.id = 'native-subtitles';
    box.className = 'native-subtitles';
    var ps = getEl('player-screen');
    (ps || document.body).appendChild(box);



    var controls = getEl('controls-container');
    var sync = function () {
      var shown = !!controls && !controls.classList.contains('idle-hidden');
      box.classList.toggle('native-subtitles-raised', shown);
    };
    if (controls && typeof MutationObserver === 'function') {
      new MutationObserver(sync).observe(controls, { attributes: true, attributeFilter: ['class'] });
    }
    sync();
  }
  return box;
}


function nativeCueText(cue) {
  return String(cue && cue.text || '').
  replace(/\{\\[^}]*\}/g, '').
  replace(/<[^>]+>/g, '').
  replace(/\\N/g, '\n').
  replace(/^\s+|\s+$/g, '');
}

function showNativeCues(track) {
  var box = nativeSubtitleBox();
  var lines = [];
  var cues = track && track.activeCues;
  if (cues) {
    for (var i = 0; i < cues.length; i++) {
      var t = nativeCueText(cues[i]);
      if (t) lines.push(t);
    }
  }
  box.textContent = lines.join('\n');
  box.style.display = lines.length ? 'block' : 'none';
}

function applyNativeSubtitle(index) {
  if (nativeSubState.active && nativeSubState.onCue) {
    nativeSubState.active.removeEventListener('cuechange', nativeSubState.onCue);
  }
  nativeSubState.active = null;
  nativeSubState.onCue = null;
  var tracks = nativeSubState.tracks;
  for (var i = 0; i < tracks.length; i++) {
    try {tracks[i].mode = i === index ? 'hidden' : 'disabled';} catch (e) {}
  }
  var track = index >= 0 && index < tracks.length ? tracks[index] : null;
  if (track) {
    nativeSubState.active = track;
    nativeSubState.onCue = function () {showNativeCues(track);};
    track.addEventListener('cuechange', nativeSubState.onCue);
  }
  showNativeCues(track);
  currentSubtitleTrack = track ? index : -1;
}


function refreshNativeSubtitles(videoPlayer) {
  if (!AppState.transcodingFullOnOff) return;

  if (nativeSubState.mode === 'webos') return;
  var tracks = collectNativeTextTracks(videoPlayer);
  nativeSubState.tracks = tracks;
  currentSubTracks = tracks.map(function (t, i) {
    return { title: t.label || 'Субтитры ' + (i + 1), language: t.language || 'und', format: '' };
  });

  var want = currentSubtitleTrack >= 0 ? currentSubtitleTrack : nativeSubState.savedPref;
  applyNativeSubtitle(want >= 0 && want < tracks.length ? want : -1);
  renderSubtitleTracks();
}


function listenNativeTextTracks(videoPlayer) {
  if (nativeSubState.listening || !videoPlayer || !videoPlayer.textTracks ||
  typeof videoPlayer.textTracks.addEventListener !== 'function') return;
  nativeSubState.listening = true;
  var onChange = function () {
    if (AppState.transcodingFullOnOff && AppState.currentScreen === 'player') refreshNativeSubtitles(videoPlayer);
  };
  videoPlayer.textTracks.addEventListener('addtrack', onChange);
  videoPlayer.textTracks.addEventListener('removetrack', onChange);
}


function resetNativeSubtitles() {
  webosSubsReset();
  applyNativeSubtitle(-1);
  nativeSubState.tracks = [];
  var box = getEl('native-subtitles');
  if (box) {box.textContent = '';box.style.display = 'none';}
}

function switchNativeSubtitleTrack(index) {
  if (nativeSubState.mode === 'webos') {
    webosSetSubtitle(index);
    currentSubtitleTrack = index >= 0 ? index : -1;
  } else {
    applyNativeSubtitle(index);
  }
  if (currentTimecodeData.hash && currentTimecodeData.fileId) {
    saveSubtitlePreference(currentTimecodeData.hash, currentTimecodeData.fileId, currentSubtitleTrack);
  }
  renderSubtitleTracks();
  toggleSubtitlesPanel();
}

function toggleAudioPanel() {return togglePlayerPanel('audio');}

function setupAudioButton() {
  var audioBtn = getEl('audio-btn');
  var closeAudioBtn = getEl('close-audio');
  var audioPanel = getEl('audio-panel');

  if (!audioBtn || !closeAudioBtn || !audioPanel) return;


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
}function

saveAudioPreference(_x38, _x39, _x40) {return _saveAudioPreference.apply(this, arguments);}function _saveAudioPreference() {_saveAudioPreference = _asyncToGenerator(function* (hash, fileId, audioTrack) {
    try {
      var savedClientId = localStorage.getItem('clientId');
      var response = yield fetch(SERVER_URL + '/api/audio/pref/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hash: hash, fileId: fileId, audioTrack: audioTrack, clientId: savedClientId }) });
    } catch (error) {}
  });return _saveAudioPreference.apply(this, arguments);}function












loadMediaPreferences(_x41, _x42) {return _loadMediaPreferences.apply(this, arguments);}function _loadMediaPreferences() {_loadMediaPreferences = _asyncToGenerator(function* (hash, fileId) {
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
    return { audioTrack: pair[0], subtitleTrack: pair[1] };
  });return _loadMediaPreferences.apply(this, arguments);}function


















loadPlaybackPrepare(_x43, _x44, _x45) {return _loadPlaybackPrepare.apply(this, arguments);}function _loadPlaybackPrepare() {_loadPlaybackPrepare = _asyncToGenerator(function* (hash, fileId, wantTimecode) {
    var savedClientId = localStorage.getItem('clientId');
    var url = SERVER_URL + '/api/playback/prepare?hash=' + hash + '&fileId=' + fileId +
    '&clientId=' + encodeURIComponent(savedClientId) + (wantTimecode ? '&timecode=1' : '');
    var timedOut = false;
    try {
      var response = yield fetchWithTimeout(url, null, FILE_INFO_FETCH_TIMEOUT_MS);
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
    var results = yield Promise.all([
    timedOut ? Promise.resolve(null) : loadFileInfo(hash, fileId),
    loadMediaPreferences(hash, fileId),
    wantTimecode ? loadTimecodeFromServer(hash, fileId) : Promise.resolve(null)]
    );
    var fallbackPrefs = results[1] || {};
    return {
      fileInfo: results[0],
      audioTrack: fallbackPrefs.audioTrack !== undefined ? fallbackPrefs.audioTrack : null,
      subtitleTrack: fallbackPrefs.subtitleTrack !== undefined ? fallbackPrefs.subtitleTrack : -1,
      timecode: results[2]
    };
  });return _loadPlaybackPrepare.apply(this, arguments);}function

loadAudioPreference(_x46, _x47) {return _loadAudioPreference.apply(this, arguments);}function _loadAudioPreference() {_loadAudioPreference = _asyncToGenerator(function* (hash, fileId) {
    try {
      var savedClientId = localStorage.getItem('clientId');
      var response = yield fetchWithTimeout(SERVER_URL + '/api/audio/pref/get?hash=' + hash + '&fileId=' + fileId + '&clientId=' + encodeURIComponent(savedClientId));
      if (response.ok) {var data = yield response.json();if (data.success && data.audioTrack !== null) return data.audioTrack;}
    } catch (error) {}
    return null;
  });return _loadAudioPreference.apply(this, arguments);}

function renderSubtitleTracks() {
  var subtitlesList = getEl('subtitles-list');if (!subtitlesList) return;
  if (!currentSubTracks || currentSubTracks.length === 0) {subtitlesList.innerHTML = '<div class="search-result-empty">Нет субтитров</div>';return;}
  var html = '';var isOff = currentSubtitleTrack === -1;
  html += '<div class="subtitle-item ' + (isOff ? 'active' : '') + '" data-track-index="-1"><div class="subtitle-icon">🚫</div><div class="subtitle-info"><div class="subtitle-title">Выключить субтитры</div></div><div class="subtitle-check">✓</div></div>';
  for (var idx = 0; idx < currentSubTracks.length; idx++) {
    var sub = currentSubTracks[idx];var isActive = idx === currentSubtitleTrack;
    var language = sub.language || 'unknown';var format = sub.format || sub.codec || '';var title = sub.title || 'Субтитры ' + (idx + 1);
    var badges = '';if (sub.default) badges += ' <span style="color: #4eff6a; font-size: 9px;">[DEFAULT]</span>';if (sub.forced) badges += ' <span style="color: #ffd966; font-size: 9px;">[FORCED]</span>';
    html += '<div class="subtitle-item ' + (isActive ? 'active' : '') + '" data-track-index="' + idx + '"><div class="subtitle-icon">💬</div><div class="subtitle-info"><div class="subtitle-title">' + escapeHtml(title) + badges + '</div><div class="subtitle-details"><span class="subtitle-language">' + language.toUpperCase() + '</span>' + (format ? '<span class="subtitle-format">' + escapeHtml(format) + '</span>' : '') + '</div></div><div class="subtitle-check">✓</div></div>';
  }
  subtitlesList.innerHTML = html;





  setupSubtitlesListDelegation();
}function

switchSubtitleTrack(_x48) {return _switchSubtitleTrack.apply(this, arguments);}function _switchSubtitleTrack() {_switchSubtitleTrack = _asyncToGenerator(function* (trackIndex) {
    if (trackIndex === currentSubtitleTrack) {toggleSubtitlesPanel();return;}

    if (AppState.transcodingFullOnOff) {switchNativeSubtitleTrack(trackIndex);return;}
    thisisseek = false;yield saveTimecodeToServer();
    if (currentTimecodeData.hash && currentTimecodeData.fileId) yield saveSubtitlePreference(currentTimecodeData.hash, currentTimecodeData.fileId, trackIndex);
    var subtitlesPanel = getEl('subtitles-panel');var subtitlesBtn = getEl('subtitles-btn');
    if (subtitlesPanel) {subtitlesPanel.classList.add('hidden');if (subtitlesBtn) subtitlesBtn.classList.remove('active');}
    var videoPlayer = getEl('video-player');var currentTime = videoPlayer ? videoPlayer.currentTime + AppState.seekOffset : 0;
    getEl('playback-overlay').classList.add('active');document.querySelector('.playback-text').textContent = 'Переключение субтитров...';
    try {
      var parsed = AppState.videoUrl.match(/\/play\/([a-fA-F0-9]+)\/(\d+)/);if (!parsed) return;
      var hash = parsed[1];var fileId = parsed[2];var playUrl = AppState.currentTorrserverUrl + '/play/' + hash + '/' + fileId;
      if (AppState.currentStreamId) {yield fetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST' });AppState.currentStreamId = null;}
      destroyHls();currentSubtitleTrack = trackIndex;
      yield startHLSPlayback(playUrl, currentTime, lastPlaybackFromSearch, currentEpisodeIndex, currentAudioTrack);
      renderSubtitleTracks();
    } catch (error) {showSwitchFailedBanner('субтитры', error && error.message);} finally
    {getEl('playback-overlay').classList.remove('active');document.querySelector('.playback-text').textContent = 'Воспроизведение...';}
  });return _switchSubtitleTrack.apply(this, arguments);}

function toggleSubtitlesPanel() {return togglePlayerPanel('subtitles');}

function setupSubtitlesButton() {
  var subtitlesBtn = getEl('subtitles-btn');
  var closeSubtitlesBtn = getEl('close-subtitles');
  var subtitlesPanel = getEl('subtitles-panel');

  if (!subtitlesBtn || !closeSubtitlesBtn || !subtitlesPanel) return;


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
}function

saveSubtitlePreference(_x49, _x50, _x51) {return _saveSubtitlePreference.apply(this, arguments);}function _saveSubtitlePreference() {_saveSubtitlePreference = _asyncToGenerator(function* (hash, fileId, subtitleTrack) {
    try {
      var savedClientId = localStorage.getItem('clientId');
      yield fetch(SERVER_URL + '/api/subtitle/pref/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hash: hash, fileId: fileId, subtitleTrack: subtitleTrack, clientId: savedClientId }) });
    } catch (error) {}
  });return _saveSubtitlePreference.apply(this, arguments);}function

loadSubtitlePreference(_x52, _x53) {return _loadSubtitlePreference.apply(this, arguments);}function _loadSubtitlePreference() {_loadSubtitlePreference = _asyncToGenerator(function* (hash, fileId) {
    try {
      var savedClientId = localStorage.getItem('clientId');
      var response = yield fetchWithTimeout(SERVER_URL + '/api/subtitle/pref/get?hash=' + hash + '&fileId=' + fileId + '&clientId=' + encodeURIComponent(savedClientId));
      if (response.ok) {var data = yield response.json();if (data.success && data.subtitleTrack !== null) return data.subtitleTrack;}
    } catch (error) {}
    return -1;
  });return _loadSubtitlePreference.apply(this, arguments);}function

handleVideoEnded() {return _handleVideoEnded.apply(this, arguments);}function _handleVideoEnded() {_handleVideoEnded = _asyncToGenerator(function* () {

    if (playbackEndHandled) return;
    playbackEndHandled = true;
    if (nearEndCheckInterval) {clearInterval(nearEndCheckInterval);nearEndCheckInterval = null;}
    stopHeartbeat();stopTorrentStatsUpdates();yield saveTimecodeToServer();

    if (AppState.autoSwitchEpisodes && currentEpisodeFiles.length > 0 && currentEpisodeIndex < currentEpisodeFiles.length - 1) {
      getEl('playback-overlay').classList.add('active');document.querySelector('.playback-text').textContent = 'Автоматическое переключение на серию ' + (currentEpisodeIndex + 2) + '...';
      try {var nextFile = currentEpisodeFiles[currentEpisodeIndex + 1];yield switchToEpisode(currentEpisodeIndex + 1, nextFile.id);}
      catch (error) {} finally
      {getEl('playback-overlay').classList.remove('active');document.querySelector('.playback-text').textContent = 'Воспроизведение...';}
    } else {
      var overlay = getEl('playback-overlay');overlay.classList.add('active');document.querySelector('.playback-text').textContent = 'Воспроизведение завершено';
      setTimeout(function () {overlay.classList.remove('active');showDetailView();}, 1500);
    }
  });return _handleVideoEnded.apply(this, arguments);}















var END_EPS_SEC = 1.5;
var END_STALL_ZONE_SEC = 20;
var END_STALL_MS = 4000;
var playbackEndHandled = false;

function startNearEndCheck() {
  if (nearEndCheckInterval) {clearInterval(nearEndCheckInterval);nearEndCheckInterval = null;}
  playbackEndHandled = false;
  var lastAbs = -1,lastMoveAt = Date.now();
  nearEndCheckInterval = setInterval(function () {
    var v = getEl('video-player');
    var now = Date.now();
    if (!v || AppState.currentScreen !== 'player' || AppState.isSeeking || v.paused) {lastMoveAt = now;return;}
    var total = AppState.originalDuration || AppState.expectedDuration || 0;
    if (!(total > 0)) return;
    var abs = (v.currentTime || 0) + (AppState.seekOffset || 0);
    if (Math.abs(abs - lastAbs) > 0.05) {lastAbs = abs;lastMoveAt = now;}
    var left = total - abs;
    if (left <= END_EPS_SEC || left <= END_STALL_ZONE_SEC && now - lastMoveAt >= END_STALL_MS) {
      console.log('🏁 Конец файла: позиция ' + abs.toFixed(1) + ' из ' + total.toFixed(1) + ' с');
      handleVideoEnded();
    }
  }, 1000);
}

function exitPlayer() {if (nearEndCheckInterval) {clearInterval(nearEndCheckInterval);nearEndCheckInterval = null;}}

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
        fetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST', keepalive: true })['catch'](function () {});
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

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupPageUnloadHandler);else
setupPageUnloadHandler();

function updateClock() {
  var clock = getEl('clock-display');if (!clock) return;
  var now = new Date();clock.textContent = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
}
updateClock();setInterval(updateClock, 60000);

function updatePlayerTimeline(timelineData) {
  try {
    var data = typeof timelineData === 'string' ? JSON.parse(timelineData) : timelineData;
    var isCompleted = data.percent === 100;
    if (!data.hash || data.hash === '0') {
      var urlData = data.currentUrl ? parseHashFromUrl(data.currentUrl) : null;
      if (urlData) {data.hash = urlData.hash;data.torrentHash = urlData.torrentHash;data.fileId = urlData.fileId;} else



      if (currentTimecodeData && currentTimecodeData.hash && currentTimecodeData.fileId) {
        data.hash = currentTimecodeData.hash + '_' + currentTimecodeData.fileId;
      } else
      return;
    }
    if (currentTimecodeData) {
      if (isCompleted) {currentTimecodeData.timecode = 100;currentTimecodeData.duration = 100;} else
      {currentTimecodeData.timecode = data.time;currentTimecodeData.duration = data.duration;}
      var hashParts = data.hash.split('_');
      if (hashParts.length >= 2) {currentTimecodeData.hash = hashParts[0];currentTimecodeData.fileId = hashParts[1];} else
      currentTimecodeData.hash = data.hash;
    }
    if (data.currentUrl && (!currentTimecodeData.hash || !currentTimecodeData.fileId)) {
      var urlData = parseHashFromUrl(data.currentUrl);
      if (urlData) {currentTimecodeData.hash = urlData.torrentHash;currentTimecodeData.fileId = urlData.fileId;}
    }
    var savedClientId = localStorage.getItem('clientId');
    if (savedClientId && currentTimecodeData.hash && currentTimecodeData.fileId) {
      var timecodeToSave = isCompleted ? Math.floor(currentTimecodeData.duration) : Math.floor(data.time);


      trackTimecodeSave(fetch(SERVER_URL + '/api/timecode/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: savedClientId, hash: currentTimecodeData.hash, fileId: currentTimecodeData.fileId, timecode: timecodeToSave, duration: currentTimecodeData.duration, completed: isCompleted })
      }));
    }
    if (AppState.playFromHash && AppState.isCatalogSerials) {AppState.isCatalogSearch = false;return;} else
    if (AppState.playFromHash) {AppState.playFromHash = false;AppState.isCatalogSearch = false;return;}
    showDetailView(currentTimecodeData.fileId);
    if (AppState && AppState.currentDetailItem && currentTimecodeData.hash) updateDetailProgress(AppState.currentDetailItem);
  } catch (error) {}
}

function parseHashFromUrl(url) {
  if (!url) return null;
  try {
    var playMatch = url.match(/\/play\/([a-fA-F0-9]+)\/(\d+)/);
    if (playMatch) return { torrentHash: playMatch[1], fileId: playMatch[2], hash: playMatch[1] + '_' + playMatch[2] };
    var urlObj = new URL(url);var link = urlObj.searchParams.get('link');var index = urlObj.searchParams.get('index');
    if (link && index) return { torrentHash: link, fileId: index, hash: link + '_' + index };
    return null;
  } catch (e) {return null;}
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
