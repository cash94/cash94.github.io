/* Сборка для старых браузеров (Chrome 53) из js/app.js — tools/legacy-build/build.js. Руками не править. */
function asyncGeneratorStep(n, t, e, r, o, a, c) {try {var i = n[a](c),u = i.value;} catch (n) {return void e(n);}i.done ? t(u) : Promise.resolve(u).then(r, o);}function _asyncToGenerator(n) {return function () {var t = this,e = arguments;return new Promise(function (r, o) {var a = n.apply(t, e);function _next(n) {asyncGeneratorStep(a, r, o, _next, _throw, "next", n);}function _throw(n) {asyncGeneratorStep(a, r, o, _next, _throw, "throw", n);}_next(void 0);});};}

var APP_CONSTANTS = {
  DEBOUNCE_DELAY_MS: 300,
  CHECK_SERVER_TIMEOUT_MS: 500,
  FOCUS_RESTORE_DELAY_MS: 100,
  IDLE_TIMEOUT_MS: 3000,
  TOUCH_TAP_THRESHOLD_MS: 300,
  TOUCH_MOVE_THRESHOLD_PX: 10,
  INITIAL_CHECK_DELAY_MS: 1000,
  NAVIGATION_DELAY_MS: 300,
  DETAIL_HIDE_DELAY_MS: 250,
  FILTER_PANEL_DELAY_MS: 60,
  ZOOM_TOAST_DURATION_MS: 1500,
  HINT_DISPLAY_DURATION_MS: 2000,
  JACRED_SAVE_DELAY_MS: 500
};

var CLICKABLE_SELECTORS = [
'button', '.control-btn', '.play-btn', '.torrent-card', '.file-item',
'.search-result-item', '.back-btn', '.settings-btn', '.view-tab',
'#play-pause-btn', '#mute-btn', '#prev-episode-btn', '#next-episode-btn',
'#episodes-btn', '#audio-btn', '#subtitles-btn', '#exit-player-btn', '#toggle-buffer-btn',
'.episode-item', '.audio-item', '.subtitle-item', '.close-panel-btn', '.filter-select',
'.filter-reset-btn', '.progress-continue-btn', '.detail-progress-btn',
'#close-search', '#filter-toggle', '#search-btn',
'#torrserver-tab-content', '#torrents-tab-content', '#player-tab-content', '#account-tab-content', '#sync-tab-content', '#other-tab-content', '#device-tab-content',
'.menu-item', '.skip-button'].
join(', ');


function debounce(fn, delay) {
  var timeoutId;
  return function () {
    var context = this,args = arguments;
    clearTimeout(timeoutId);
    timeoutId = setTimeout(function () {
      fn.apply(context, args);
    }, delay);
  };
}

function safeExecute(fn, errorMessage) {
  try {
    return fn();
  } catch (error) {
    console.error(errorMessage, error);
    return null;
  }
}



function showContentScreen(screen, restoreScrollTop) {



  if (window.DetailTopbar && typeof DetailTopbar.ensureHome === 'function') {
    DetailTopbar.ensureHome();
  }

  var torrentsScreen = getEl('content-torrents');
  var catalogScreen = getEl('content-catalog');
  var mainContainer = getEl('main-container');
  if (!torrentsScreen || !catalogScreen) return;

  if (typeof AppState !== 'undefined' && mainContainer && (
  AppState.currentScreen === 'torrents' || AppState.currentScreen === 'catalog')) {
    AppState.contentScroll = AppState.contentScroll || {};
    AppState.contentScroll[AppState.currentScreen] = mainContainer.scrollTop;
  }





  var hasScreenFade = typeof Animations !== 'undefined' && typeof Animations.fadeIn === 'function';
  var incoming = screen === 'torrents' ? torrentsScreen : screen === 'catalog' ? catalogScreen : null;
  var outgoing = incoming === torrentsScreen ? catalogScreen : torrentsScreen;
  var wasHidden = incoming ? incoming.hidden : false;

  if (hasScreenFade) Animations.resetFade(outgoing);
  outgoing.hidden = true;

  if (!incoming) {

    if (hasScreenFade) Animations.resetFade(torrentsScreen);
    torrentsScreen.hidden = true;
    catalogScreen.hidden = true;
  } else if (wasHidden && hasScreenFade) {

    Animations.fadeIn(incoming, { duration: Animations.UI_FADE.screen });
  } else {
    if (hasScreenFade) Animations.resetFade(incoming);
    incoming.hidden = false;
  }



  if (typeof window.ensureTopbarFit === 'function') window.ensureTopbarFit();

  if (typeof AppState !== 'undefined') {
    AppState.currentScreen = screen;
    AppState.contentScroll = AppState.contentScroll || {};


    if (typeof restoreScrollTop === 'number') {
      AppState.contentScroll[screen] = restoreScrollTop;
    }
  }

  requestAnimationFrame(function () {
    if (!mainContainer || typeof AppState === 'undefined' || !AppState.contentScroll) return;
    mainContainer.scrollTop = AppState.contentScroll[screen] || 0;
    if (typeof window.invalidateFocusCache === 'function') window.invalidateFocusCache();
  });
}
window.showContentScreen = showContentScreen;


var hideClockEnabled = false;
var addToDbEnabled = false;
var transcodingOnOff = false;
var multiChannelEnabled = false;
var dvPreferred = false;
var detailView = getEl('detail-view');


function initialServerCheck() {
  setTimeout(function () {
    var torrserverUrlInput = getEl('torrserver-url');
    if (torrserverUrlInput && torrserverUrlInput.value && torrserverUrlInput.value.trim() !== '') {
      console.log('🔍 Автоматическая проверка сервера...');
      if (typeof checkServer === 'function') checkServer(true);
    } else {
      console.log('ℹ️ URL сервера не задан, пробуем использовать SERVER_URL с портом 8090');
      safeExecute(function () {
        var serverUrl = SERVER_URL;
        var urlObj = new URL(serverUrl);
        urlObj.port = '8090';
        var torrserverUrl = urlObj.toString().replace(/\/$/, '');
        console.log('🔄 Автоматически установлен URL TorrServer:', torrserverUrl);
        if (torrserverUrlInput) torrserverUrlInput.value = torrserverUrl;
        if (typeof checkServer === 'function') checkServer(true);
      }, '❌ Ошибка при парсинге SERVER_URL');
    }
  }, APP_CONSTANTS.INITIAL_CHECK_DELAY_MS);
}function

init() {return _init.apply(this, arguments);}function _init() {_init = _asyncToGenerator(function* () {
    try {
      console.log('🚀 Начало инициализации приложения');

      safeExecute(loadClientConfig, '❌ Ошибка загрузки конфигурации');
      checkAppVersion();

      if (!window.AndroidJS) {
        setupVideoPlayerControls();
        setupClockVisibility();
      }

      setupNavigation();
      setupSearch();
      setupFavoritesTab();
      setupSearchFilters();
      setupServerCheck();
      setupAuth();
      setupPlayerAutoHide();
      setupTouchControls(getEl('seek-slider'), getEl('volume-slider'));
      setupFullscreen();
      setupAutoFullscreen();
      setupSpeedTest();

      if (typeof initSearchModeToggle === 'function') initSearchModeToggle();

      initialServerCheck();
      setupCheckboxes();
      initJacredUrlStorage();
      setupConfigMenu();

      if (typeof AppState !== 'undefined') {
        AppState.addToDbEnabled = addToDbEnabled;
        AppState.multiChannelEnabled = multiChannelEnabled;
        console.log('📦 AppState.addToDbEnabled =', AppState.addToDbEnabled);
        console.log('🎵 AppState.multiChannelEnabled =', AppState.multiChannelEnabled);
      }
      initDolbyVisionCheck();

      console.log('✅ Инициализация приложения завершена');
    } catch (error) {
      console.error('❌ Критическая ошибка при инициализации:', error);
      showInitError();
    }
  });return _init.apply(this, arguments);}

function setupVideoPlayerControls() {
  var requiredElements = [
  'seek-slider', 'volume-slider', 'play-pause-btn', 'mute-btn',
  'toggle-buffer-btn', 'exit-player-btn', 'player-overlay', 'video-player'];

  var modes = ['contain', 'fill', 'cover', 'none'];
  var modeIndex = 0;
  var video = getEl('video-player');

  if (!video) {
    console.error('Video player element not found');
    return;
  }









  var zoomMode = 'contain';
  var FIT_CLASSES = ['video-object-fit-contain', 'video-object-fit-fill',
  'video-object-fit-cover', 'video-object-fit-none'];

  function setFitClass(fit) {
    for (var i = 0; i < FIT_CLASSES.length; i++) video.classList.remove(FIT_CLASSES[i]);
    video.classList.add('video-object-fit-' + fit);
  }

  function applyVideoBox() {
    var st = video.style;
    var ps = getEl('player-screen');
    var cw = ps && ps.clientWidth || window.innerWidth;
    var ch = ps && ps.clientHeight || window.innerHeight;
    var vw = video.videoWidth,vh = video.videoHeight;
    if (zoomMode === 'fill' || !vw || !vh || !cw || !ch) {
      st.position = st.left = st.top = st.width = st.height = st.maxWidth = st.maxHeight = '';


      setFitClass(zoomMode);
      return;
    }





    setFitClass(zoomMode === 'none' ? 'contain' : zoomMode);
    var r = zoomMode === 'cover' ? Math.max(cw / vw, ch / vh) :
    zoomMode === 'none' ? 1 :
    Math.min(cw / vw, ch / vh);
    var w = Math.round(vw * r),h = Math.round(vh * r);
    st.position = 'absolute';
    st.maxWidth = 'none';
    st.maxHeight = 'none';
    st.width = w + 'px';
    st.height = h + 'px';
    st.left = Math.round((cw - w) / 2) + 'px';
    st.top = Math.round((ch - h) / 2) + 'px';
  }

  function setVideoObjectFit(mode) {
    zoomMode = mode;
    applyVideoBox();
  }



  video.addEventListener('loadedmetadata', applyVideoBox);
  video.addEventListener('resize', applyVideoBox);
  window.addEventListener('resize', applyVideoBox);
  document.addEventListener('fullscreenchange', applyVideoBox);
  document.addEventListener('webkitfullscreenchange', applyVideoBox);

  setVideoObjectFit('contain');

  var zoomBtn = getEl('zoom-mode-btn');
  if (zoomBtn) {
    zoomBtn.onclick = function () {
      modeIndex = (modeIndex + 1) % modes.length;
      setVideoObjectFit(modes[modeIndex]);
      var modeNames = {
        'contain': 'С полосами',
        'fill': 'Растянуть',
        'cover': 'Обрезка',
        'none': 'Оригинал'
      };
      showToast(modeNames[modes[modeIndex]]);
    };
  }

  var missingElements = requiredElements.filter(function (el) {return !getEl(el);});
  if (missingElements.length > 0) {
    console.warn('⚠️ Отсутствуют DOM элементы:', missingElements);
  }

  var seekSlider = getEl('seek-slider');
  var volumeSlider = getEl('volume-slider');
  var playPauseBtn = getEl('play-pause-btn');
  var muteBtn = getEl('mute-btn');
  var toggleBufferBtn = getEl('toggle-buffer-btn');
  var exitPlayerBtn = getEl('exit-player-btn');
  var overlay = getEl('player-overlay');

  if (seekSlider) {
    seekSlider.value = 0;
    seekSlider.max = 100;
    setupSeekSliderEvents(seekSlider, video);
  }
  if (volumeSlider) volumeSlider.value = 1;
  if (playPauseBtn && video) setupPlayPauseButton(playPauseBtn, video);
  if (muteBtn && video && volumeSlider) setupMuteButton(muteBtn, video, volumeSlider);
  if (volumeSlider && video) setupVolumeSlider(volumeSlider, video);
  if (exitPlayerBtn) setupExitButton(exitPlayerBtn);

  if (typeof setupEpisodesButton === 'function') setupEpisodesButton();
  if (typeof setupAudioButton === 'function') setupAudioButton();
  if (typeof setupSubtitlesButton === 'function') setupSubtitlesButton();

  setupEpisodeNavigation();
  if (video) setupVideoEvents(video, volumeSlider, seekSlider);
  if (toggleBufferBtn) setupToggleBufferButton(toggleBufferBtn);
  if (overlay) setupOverlayControls(overlay);

  var savedVolume = localStorage.getItem('playerVolume');
  if (savedVolume !== null && video) {
    video.volume = parseFloat(savedVolume);
    if (volumeSlider) volumeSlider.value = video.volume;
  }
}

function showToast(message) {
  var toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = 'position:fixed;bottom:20%;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:white;padding:8px 16px;border-radius:8px;z-index:9999;font-size:14px;pointer-events:none;';

  var host = typeof window.getOverlayHost === 'function' ? window.getOverlayHost() : document.body;
  host.appendChild(toast);
  setTimeout(function () {
    if (toast && toast.remove) toast.remove();else
    if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
  }, APP_CONSTANTS.ZOOM_TOAST_DURATION_MS);
}















var ERROR_BANNER_ID = 'app-error-banner';
var ERROR_BANNER_MS = 6000;
var errorBannerTimer = null;

function showErrorBanner(message, detail) {
  if (!message) return;

  var host = typeof window.getOverlayHost === 'function' ? window.getOverlayHost() : document.body;
  if (!host) return;


  var banner = document.getElementById(ERROR_BANNER_ID);
  if (banner && banner.parentNode !== host) {
    if (banner.remove) banner.remove();else banner.parentNode.removeChild(banner);
    banner = null;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = ERROR_BANNER_ID;
    banner.style.cssText =
    'position:fixed;top:12%;left:50%;transform:translateX(-50%);' +
    'max-width:80%;box-sizing:border-box;' +
    'background:rgba(20,10,10,0.96);border:2px solid #ff5050;border-radius:16px;' +
    'padding:20px 32px;text-align:center;z-index:10060;pointer-events:none;' +
    'box-shadow:0 8px 40px rgba(0,0,0,0.6);';
    host.appendChild(banner);
  }

  banner.innerHTML =
  '<div style="font-size:22px;font-weight:600;color:#ff8a8a;line-height:1.3">' +
  escapeBannerText(message) + '</div>' + (
  detail ? '<div style="font-size:15px;color:#c8c8c8;margin-top:10px;line-height:1.35">' +
  escapeBannerText(detail) + '</div>' : '');

  if (errorBannerTimer) clearTimeout(errorBannerTimer);
  errorBannerTimer = setTimeout(function () {
    errorBannerTimer = null;
    var b = document.getElementById(ERROR_BANNER_ID);
    if (!b) return;
    if (b.remove) b.remove();else if (b.parentNode) b.parentNode.removeChild(b);
  }, ERROR_BANNER_MS);
}

function escapeBannerText(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, function (m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m];
  });
}

window.showErrorBanner = showErrorBanner;


function checkAppVersion() {
  fetch('/api/version').
  then(function (response) {return response.json();}).
  then(function (data) {
    var serverVersion = data.version;
    var currentVersion = AppState.currentVersion;
    if (serverVersion !== currentVersion) {
      console.warn('⚠️ Версии не совпадают: локальная ' + currentVersion + ', серверная ' + serverVersion);
      var sectionTitle = document.querySelector('.section-title-header');
      if (sectionTitle && !document.querySelector('.version-warning')) {
        var warningBlock = document.createElement('div');
        warningBlock.className = 'version-warning';
        warningBlock.style.cssText = 'color: #ff4444; font-size: 14px; margin-top: 8px; text-align: center;';
        warningBlock.textContent = 'Требуется обновить TorrStream. Версия сервера ' + serverVersion + ', версия клиента ' + currentVersion;
        sectionTitle.parentNode.insertBefore(warningBlock, sectionTitle.nextSibling);
      }
    }
  }).
  catch(function (error) {console.error('❌ Ошибка проверки версии:', error);});
}


function setupSeekSliderEvents(seekSlider, videoPlayer) {
  var currentTimeEl = getEl('current-time');
  var loadingOverlay = getEl('loading-player-overlay');
  var loadingTimeEl = getEl('loading-time');


  var seekStartValue = 0;

  seekSlider.addEventListener('mousedown', function () {
    if (typeof AppState !== 'undefined') {
      AppState.isSliderDragging = true;
      AppState.suppressTimeUpdate = true;
    }

    seekStartValue = parseFloat(seekSlider.value) || 0;
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });

  seekSlider.addEventListener('touchstart', function () {
    if (typeof AppState !== 'undefined') {
      AppState.isSliderDragging = true;
      AppState.suppressTimeUpdate = true;
    }

    seekStartValue = parseFloat(seekSlider.value) || 0;
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });

  seekSlider.addEventListener('input', function (e) {
    var newPreviewTime = parseFloat(e.target.value);
    if (isFinite(newPreviewTime)) {
      if (typeof AppState !== 'undefined') {
        AppState.previewTime = newPreviewTime;
      }
      if (currentTimeEl) currentTimeEl.textContent = formatTime(newPreviewTime);
      if (typeof AppState !== 'undefined' && (AppState.isSeeking || loadingOverlay && loadingOverlay.classList.contains('active'))) {
        if (loadingTimeEl) loadingTimeEl.textContent = formatTime(newPreviewTime);
      }


      if (typeof window.showSeekOverlay === 'function') {

        var direction = newPreviewTime >= seekStartValue ? 1 : -1;
        window.showSeekOverlay(newPreviewTime, direction);
      }
    }
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });

  seekSlider.addEventListener('change', function () {var _ref = _asyncToGenerator(function* (e) {
      var targetAbsoluteTime = parseFloat(e.target.value);
      if (typeof AppState !== 'undefined') {
        AppState.isSliderDragging = false;
        AppState.previewTime = targetAbsoluteTime;
        AppState.suppressTimeUpdate = true;
      }


      if (typeof window.scheduleHideSeekOverlay === 'function') {
        window.scheduleHideSeekOverlay();
      }

      if (!isFinite(targetAbsoluteTime) || targetAbsoluteTime < 0) {
        if (typeof AppState !== 'undefined') {
          AppState.previewTime = null;
          AppState.suppressTimeUpdate = false;
        }
        return;
      }
      console.log('🎚️ Seek to: ' + formatTime(targetAbsoluteTime));

      if (!AppState || !AppState.hls) {
        if (videoPlayer) {
          videoPlayer.currentTime = targetAbsoluteTime - (AppState && AppState.seekOffset || 0);
        }
        if (typeof AppState !== 'undefined') {
          AppState.previewTime = null;
          AppState.suppressTimeUpdate = false;
        }
        if (typeof updateTimeDisplay === 'function') updateTimeDisplay();
        if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
        return;
      }

      if (typeof seekStream === 'function') {
        yield seekStream(targetAbsoluteTime, 'slider');
      }
      if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
    });return function (_x) {return _ref.apply(this, arguments);};}());

  seekSlider.addEventListener('mouseup', function () {

    if (typeof window.scheduleHideSeekOverlay === 'function') {
      window.scheduleHideSeekOverlay();
    }

    setTimeout(function () {
      if (!AppState || !AppState.isSliderDragging) return;
      if (typeof AppState !== 'undefined') {
        AppState.isSliderDragging = false;
        if (!AppState.isSeeking) {
          AppState.previewTime = null;
          AppState.suppressTimeUpdate = false;
        }
      }
      if (typeof updateTimeDisplay === 'function') updateTimeDisplay();
    }, 200);
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });

  seekSlider.addEventListener('touchend', function () {

    if (typeof window.scheduleHideSeekOverlay === 'function') {
      window.scheduleHideSeekOverlay();
    }

    setTimeout(function () {
      if (!AppState || !AppState.isSliderDragging) return;
      if (typeof AppState !== 'undefined') {
        AppState.isSliderDragging = false;
        if (!AppState.isSeeking) {
          AppState.previewTime = null;
          AppState.suppressTimeUpdate = false;
        }
      }
      if (typeof updateTimeDisplay === 'function') updateTimeDisplay();
    }, 200);
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });
}

function setupPlayPauseButton(playPauseBtn, videoPlayer) {
  playPauseBtn.addEventListener('click', function (e) {
    var loadingOverlay = getEl('loading-player-overlay');
    if (AppState && (AppState.isSeeking || loadingOverlay && loadingOverlay.classList.contains('active'))) {
      e.preventDefault();
      return;
    }
    if (videoPlayer.paused) {
      videoPlayer.play().then(function () {
        if (typeof updatePlayPauseButton === 'function') updatePlayPauseButton();
      }).catch(function () {});
    } else {
      videoPlayer.pause();
      if (typeof updatePlayPauseButton === 'function') updatePlayPauseButton();
    }
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });
}

function setupMuteButton(muteBtn, videoPlayer, volumeSlider) {
  muteBtn.addEventListener('click', function () {
    var loadingOverlay = getEl('loading-player-overlay');
    if (AppState && (AppState.isSeeking || loadingOverlay && loadingOverlay.classList.contains('active'))) return;
    videoPlayer.muted = !videoPlayer.muted;
    if (typeof updateMuteButton === 'function') updateMuteButton();
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });
}

function setupVolumeSlider(volumeSlider, videoPlayer) {
  volumeSlider.addEventListener('input', function (e) {
    var loadingOverlay = getEl('loading-player-overlay');
    if (AppState && (AppState.isSeeking || loadingOverlay && loadingOverlay.classList.contains('active'))) return;
    var vol = parseFloat(e.target.value);
    videoPlayer.volume = vol;
    if (vol > 0 && videoPlayer.muted) {
      videoPlayer.muted = false;
      if (typeof updateMuteButton === 'function') updateMuteButton();
    }
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
    localStorage.setItem('playerVolume', vol);
  });
}

function setupExitButton(exitPlayerBtn) {
  exitPlayerBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (typeof showDetailView === 'function') showDetailView(currentTimecodeData.fileId);
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
    if (typeof window.exitPlayer === 'function') window.exitPlayer();
  });
}

function setupEpisodeNavigation() {
  var prevEpisodeBtn = getEl('prev-episode-btn');
  var nextEpisodeBtn = getEl('next-episode-btn');

  if (prevEpisodeBtn) {
    prevEpisodeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (typeof prevEpisode === 'function') prevEpisode();
      if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
    });
  }
  if (nextEpisodeBtn) {
    nextEpisodeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (typeof nextEpisode === 'function') nextEpisode();
      if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
    });
  }
}

function setupVideoEvents(videoPlayer, volumeSlider, seekSlider) {
  var handlers = {
    volumechange: function () {
      if (volumeSlider) volumeSlider.value = videoPlayer.volume;
      if (typeof updateMuteButton === 'function') updateMuteButton();
      if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
      localStorage.setItem('playerVolume', videoPlayer.volume);
    },
    timeupdate: function () {
      if (typeof isSeekHoldActive !== 'undefined' && isSeekHoldActive) return;
      if (AppState && (AppState.isSliderDragging || AppState.suppressTimeUpdate)) return;
      var totalDuration = AppState && (AppState.originalDuration || AppState.expectedDuration) || videoPlayer.duration;
      if (totalDuration && isFinite(totalDuration) && totalDuration > 0) {
        if (seekSlider) seekSlider.max = totalDuration;
        var absoluteTime = videoPlayer.currentTime + (AppState && AppState.seekOffset || 0);
        if (seekSlider) seekSlider.value = Math.min(absoluteTime, totalDuration);
        if (typeof updateTimeDisplay === 'function') updateTimeDisplay();
      }
    },
    loadedmetadata: function () {
      console.log('📊 loadedmeta', videoPlayer.duration);
      if (AppState && AppState.expectedDuration && typeof forceUpdateDuration === 'function') {
        forceUpdateDuration(AppState.expectedDuration, AppState.originalDuration, AppState.seekOffset);
      }
      if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
    },
    progress: function () {
      if (typeof updateBufferDisplay === 'function') updateBufferDisplay();
    },
    ended: function () {
      console.log('🏁 Видео закончилось');
      if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
    }
  };

  Object.keys(handlers).forEach(function (event) {
    videoPlayer.addEventListener(event, handlers[event]);
  });
}


















var BUFFER_TICK_MS = 300;
var bufferTickTimer = null;

function bufferTick() {
  bufferTickTimer = null;
  if (typeof AppState === 'undefined' || !AppState) return;
  if (AppState.currentScreen !== 'player') return;
  if (!AppState.isSeeking && typeof updateBufferDisplay === 'function') updateBufferDisplay();
  bufferTickTimer = setTimeout(bufferTick, BUFFER_TICK_MS);
}

function startBufferUpdates() {
  if (bufferTickTimer) return;
  bufferTick();
}
window.startBufferUpdates = startBufferUpdates;

function setupToggleBufferButton(toggleBufferBtn) {
  toggleBufferBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (typeof AppState !== 'undefined') AppState.bufferHidden = !AppState.bufferHidden;
    toggleBufferBtn.style.opacity = AppState && AppState.bufferHidden ? '0.6' : '1';
    toggleBufferBtn.title = AppState && AppState.bufferHidden ? 'показать буфер' : 'скрыть буфер';
    if (AppState && !AppState.bufferHidden && typeof updateBufferDisplay === 'function') {
      updateBufferDisplay();
    } else {
      var bufferStats = getEl('buffer-stats');
      if (bufferStats) bufferStats.classList.add('hidden');
    }


    if (typeof refreshTorrentStatsCadence === 'function') refreshTorrentStatsCadence();
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });
}

function setupOverlayControls(overlay) {
  function showControls() {
    overlay.classList.add('touch-active');
    clearTimeout(overlay.timer);
    overlay.timer = setTimeout(function () {
      if (!overlay.matches(':hover')) overlay.classList.remove('touch-active');
    }, APP_CONSTANTS.IDLE_TIMEOUT_MS);
  }

  overlay.addEventListener('mousemove', function () {
    showControls();
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });

  overlay.addEventListener('touchstart', function (e) {
    showControls();
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
    if (e.touches.length === 1) e.preventDefault();
  }, { passive: false });

  var lastTap = 0;
  overlay.addEventListener('touchend', function (e) {
    var currentTime = Date.now();
    if (currentTime - lastTap < 300) {
      if (overlay.classList.contains('touch-active')) overlay.classList.remove('touch-active');else
      showControls();
    } else showControls();
    lastTap = currentTime;
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });
}


function setupNavigation() {
  var settingsBtn = getEl('settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', function () {
      var torrserverSection = getEl('torrserver-section');
      var configScreen = getEl('config-screen');



      if (window.Nav) Nav.push('config', { key: 'config' });
      if (torrserverSection) torrserverSection.style.display = 'none';
      if (configScreen) {

        if (typeof Animations !== 'undefined' && typeof Animations.fadeIn === 'function') {
          Animations.fadeIn(configScreen, { display: 'flex', duration: Animations.UI_FADE.screen });
        } else {
          configScreen.style.display = 'flex';
        }
      }
      if (typeof AppState !== 'undefined') AppState.currentScreen = 'config';
      setTimeout(function () {
        if (typeof updateFocusableElements === 'function') updateFocusableElements();
        if (typeof setFocus === 'function') setFocus(0);
      }, APP_CONSTANTS.NAVIGATION_DELAY_MS);
    });
  }

  var backFromDetail = getEl('back-from-detail');
  if (backFromDetail) {
    backFromDetail.addEventListener('click', function () {
      console.log('🔙 Возврат из детального просмотра');



      var navLeft = window.Nav ? Nav.top() : null;
      var navTo = navLeft && (navLeft.screen === 'detail' || navLeft.screen === 'torrent-detail') ?
      Nav.pop(navLeft.screen) : null;
      var mainContainer = getEl('main-container');




      var savedScroll = typeof AppState.backupScroll === 'number' ? AppState.backupScroll : 0;

      var currentTorrentHash = AppState && AppState.currentDetailItem ? AppState.currentDetailItem.hash : null;
      console.log('🔍 Hash для восстановления:', currentTorrentHash);

      if (typeof window.dropOpenTorrentDetail === 'function') window.dropOpenTorrentDetail();





      if (navLeft && navLeft.screen === 'torrent-detail' && navTo && navTo.screen === 'search') {
        AppState.playFromHash = false;
        AppState.isCatalogSerials = false;
      }


      var target = navTo ? navTo.screen : null;
      if (!target) target = AppState.inSearch === 'catalog' || AppState.inSearch === 'home' ? AppState.inSearch : 'torrents';
      console.log('📍 «назад» из карточки →', target);





      if (target === 'detail' || target === 'torrent-detail') {
        setTimeout(function () {
          if (target === 'detail') window.showCatalogDetail(navTo.data.item, navTo.data.index || 0, null);else
          if (typeof window.showDetail === 'function') window.showDetail(navTo.data.torrent);
        }, APP_CONSTANTS.DETAIL_HIDE_DELAY_MS);
        return;
      }









      var backToSearch = target === 'search';
      if (!backToSearch) hideDetailView();
      if (mainContainer) mainContainer.style.pointerEvents = 'auto';

      var torrserverSection = getEl('torrserver-section');
      if (torrserverSection && !backToSearch) torrserverSection.style.display = 'block';

      var returnTo = target === 'grid' ? 'catalog' : target;

      if (navTo && navTo.restore && typeof navTo.restore.scrollTop === 'number') savedScroll = navTo.restore.scrollTop;


      if (['home', 'catalog', 'torrents', 'search'].indexOf(returnTo) === -1) {
        returnTo = AppState.inSearch === 'catalog' || AppState.inSearch === 'home' ? AppState.inSearch : 'torrents';
      }
      var restoreCtx = { currentTorrentHash: currentTorrentHash, savedScroll: savedScroll, navEntry: navTo };



      if (backToSearch) {
        restoreFocusAfterNavigation('search', restoreCtx);
        return;
      }

      setTimeout(function () {
        if (typeof updateFocusableElements !== 'function' || typeof setFocus !== 'function') {
          console.error('❌ Функции навигации еще не загружены');
          return;
        }

        restoreFocusAfterNavigation(returnTo, restoreCtx);



        if (typeof Animations !== 'undefined') Animations.animateDetailHide();
      }, APP_CONSTANTS.DETAIL_HIDE_DELAY_MS);
    });
    AppState.isCatalogSearch = false;
  }
}









function hideDetailView(opts) {
  if (typeof Animations !== 'undefined' && typeof Animations.animateDetailHide === 'function') {
    Animations.animateDetailHide(null, opts);
    return;
  }
  if (detailView) detailView.style.display = 'none';
}





if (window.Nav) {
  var navScrollSnapshot = {
    snapshot: function () {
      var mc = getEl('main-container');
      return { scrollTop: mc ? mc.scrollTop : 0 };
    }
  };
  Nav.register('catalog', navScrollSnapshot);
  Nav.register('torrents', navScrollSnapshot);
}

function restoreFocusAfterNavigation(returnTo, context) {
  if (returnTo === 'catalog') {
    showContentScreen('catalog', context.savedScroll);




    if (typeof window.rearmCatalogObservers === 'function') window.rearmCatalogObservers();

    if (typeof isCatalogRowsMode === 'function' && isCatalogRowsMode()) {
      hideDetailView();



      if (typeof window.withInstantScroll === 'function') window.withInstantScroll(restoreRowFocus);else
      restoreRowFocus();
      return;
    }



    if (catalogState.currentCatalog === 'favorites' && catalogState.favoritesGridStale &&
    typeof window.reloadFavoritesGrid === 'function') {
      hideDetailView();
      window.reloadFavoritesGrid();
      return;
    }


    var catalogGrid = getEl('catalog-grid');
    if (catalogState.currentCatalog === AppState.backCurrentCatalog &&
    catalogState.items.length > 0 && catalogGrid && catalogGrid.children.length > 0) {

      hideDetailView();


      var mc = getEl('main-container');
      if (mc && typeof context.savedScroll === 'number') {
        mc.scrollTop = context.savedScroll;
      }


      if (typeof window.ensureCatalogFocus === 'function') {
        window.ensureCatalogFocus(true);
      }
      return;
    }


    window.loadCatalog(AppState.backCurrentCatalog).then(function () {

      var mc = getEl('main-container');
      if (mc && typeof context.savedScroll === 'number') {
        mc.scrollTop = context.savedScroll;
      }
      hideDetailView();
      if (typeof window.ensureCatalogFocus === 'function') {
        window.ensureCatalogFocus(true);
      }
    });
    return;
  }



  if (returnTo === 'home' && window.HomeScreen && typeof window.HomeScreen.show === 'function') {
    hideDetailView();
    window.HomeScreen.show({ restoreFocus: true });
    return;
  }

  if (returnTo === 'search') {
    if (typeof window.showSearchResults === 'function') {


      if (typeof window.restoreSearchEntry === 'function') window.restoreSearchEntry(context && context.navEntry);







      AppState.detailUnderSearch = true;
      window.showSearchResults({
        restoreCard: true,
        onShown: function () {
          if (!AppState.detailUnderSearch) return;
          AppState.detailUnderSearch = false;
          hideDetailView();
        }
      });
      return;
    }
    if (typeof window.clearSearchResults === 'function') window.clearSearchResults();
    hideDetailView();
    return;
  }

  if (returnTo === 'torrents') {
    if (typeof window.clearSearchResultsContainer === 'function') window.clearSearchResultsContainer();
    showContentScreen('torrents');





    var mcTorrents = getEl('main-container');
    var savedTorrentsScroll = AppState.contentScroll ? AppState.contentScroll.torrents : null;
    if (mcTorrents && typeof savedTorrentsScroll === 'number') {
      mcTorrents.scrollTop = savedTorrentsScroll;
    }

    if (context.currentTorrentHash) {
      window.lastSelectedTorrentHash = context.currentTorrentHash;
      console.log('💾 Сохранен hash для восстановления:', context.currentTorrentHash);
    }

    updateFocusableElements();

    if (typeof window.ensureTorrentFocus === 'function') {
      hideDetailView();
      window.ensureTorrentFocus(true);
      console.log('🎯 Фокус восстановлен через ensureTorrentFocus');
      return;
    }

    var targetIndex = findTorrentCardIndex(context.currentTorrentHash);
    if (targetIndex === -1 && typeof lastSelectedTorrentIndex !== 'undefined') {
      targetIndex = findTorrentCardByIndex(lastSelectedTorrentIndex);
    }
    if (targetIndex === -1) {
      targetIndex = findFirstTorrentCardIndex();
    }

    setFocus(targetIndex !== -1 ? targetIndex : 0);
    hideDetailView();
  }
}

function findTorrentCardIndex(hash) {
  if (!hash) return -1;
  console.log('🔍 Поиск карточки с hash:', hash);
  var fLen = focusableElements.length;
  for (var i = 0; i < fLen; i++) {
    var el = focusableElements[i];
    if (el.classList && el.classList.contains('torrent-card')) {
      var cardHash = el.dataset.hash;
      if (cardHash && cardHash.toLowerCase() === hash.toLowerCase()) {
        console.log('✅ Найдена карточка по hash, индекс:', i);
        return i;
      }
    }
  }
  return -1;
}

function findTorrentCardByIndex(savedIndex) {
  console.log('🔍 Поиск по сохраненному индексу:', savedIndex);
  var cardIndices = [];
  var fLen = focusableElements.length;
  for (var j = 0; j < fLen; j++) {
    if (focusableElements[j].classList && focusableElements[j].classList.contains('torrent-card')) {
      cardIndices.push(j);
    }
  }
  if (savedIndex < cardIndices.length) {
    var targetIndex = cardIndices[savedIndex];
    console.log('✅ Найдена карточка по индексу, глобальный индекс:', targetIndex);
    return targetIndex;
  }
  return -1;
}

function findFirstTorrentCardIndex() {
  var fLen = focusableElements.length;
  for (var k = 0; k < fLen; k++) {
    if (focusableElements[k].classList && focusableElements[k].classList.contains('torrent-card')) {
      console.log('⚠️ Используем первую карточку, индекс:', k);
      return k;
    }
  }
  return -1;
}


function setupSearch() {
  var searchInput = getEl('search-query');
  var searchBtn = getEl('search-btn');
  var closeSearchBtn = getEl('close-search');
  var tabTorrents = getEl('tab-torrents');
  var tabSearch = getEl('tab-search');
  var tabCatalog = getEl('tab-catalog');

  if (searchBtn && searchInput) {
    searchBtn.addEventListener('click', function () {





      if (window.AppState && AppState.searchLocked) return;

      var query = searchInput.value.trim();

      if (typeof window.clearCatalogSearchContext === 'function') window.clearCatalogSearchContext();
      if (typeof showSearchResults === 'function') showSearchResults();
      if (query && typeof searchTorrents === 'function') searchTorrents(query);
    });
  }

  if (searchInput) {
    searchInput.addEventListener('keypress', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var query = searchInput.value.trim();
        if (typeof searchTorrents === 'function') searchTorrents(query);
      }
    });
  }

  if (closeSearchBtn && typeof hideSearchResults === 'function') {
    closeSearchBtn.addEventListener('click', function () {

      hideSearchResults();
    });
  }

  if (tabTorrents && typeof hideSearchResults === 'function' && typeof loadTorrents === 'function') {
    tabTorrents.addEventListener('click', function () {


      if (AppState.torrentsLoaded && typeof window.syncTorrentsList === 'function') {
        window.syncTorrentsList();
      }
      if (!tabTorrents.classList.contains('active')) {
        console.log('📁 Переключение на вкладку "Мои торренты"');
        AppState.currentScreen = 'torrents';
        window.pendingCatalogPoster = null;
        window.pendingCatalogItem = null;
        if (typeof AppState !== 'undefined') AppState.inSearch = 'torrents';
        hideSearchResults();
        if (window.Nav) Nav.reset('torrents');
        tabTorrents.classList.add('active');
        if (tabSearch) tabSearch.classList.remove('active');
        if (tabCatalog) tabCatalog.classList.remove('active');
        var tabFavoritesEl = getEl('tab-favorites');
        if (tabFavoritesEl) tabFavoritesEl.classList.remove('active');


        showContentScreen('torrents');
        var torrentsGrid = getEl('torrents-grid');
        if (!AppState.torrentsLoaded && !AppState.torrentsLoading) {
          if (torrentsGrid) {
            torrentsGrid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;"><div class="loading-spinner" style="margin: 0 auto 20px;"></div><div style="font-size: 16px; color: #aaa;">Загрузка торрентов...</div></div>';
          }
          loadTorrents(true).catch(function (error) {
            console.error('Ошибка загрузки торрентов:', error);
            if (torrentsGrid) {
              torrentsGrid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;"><div style="font-size: 48px; margin-bottom: 20px;">❌</div><div style="font-size: 16px; color: #ff6a6a;">Ошибка загрузки торрентов</div><button class="btn" style="margin-top: 20px;" onclick="getEl(\'tab-torrents\').click()">Попробовать снова</button></div>';
            }
          });
        }
      }
    });
  }

  if (tabSearch && typeof showSearchResults === 'function') {
    tabSearch.addEventListener('click', function () {


      if (typeof window.setSearchLocked === 'function') window.setSearchLocked(false);
      if (typeof window.clearCatalogSearchContext === 'function') window.clearCatalogSearchContext();
      showSearchResults();
      if (searchInput && searchInput.value.trim() && typeof searchResults !== 'undefined' && searchResults.length === 0 && typeof searchTorrents === 'function') {
        searchTorrents(searchInput.value.trim());
      }
    });
  }

  if (tabCatalog && typeof window.loadCatalogList === 'function') {
    tabCatalog.addEventListener('click', function () {
      if (typeof AppState !== 'undefined') AppState.inSearch = 'catalog';
      if (!tabCatalog.classList.contains('active')) {
        window.pendingCatalogPoster = null;
        window.pendingCatalogItem = null;


        if (typeof catalogState !== 'undefined') {
          catalogState.lastSelectedIndex = 0;
          catalogState.lastSelectedId = null;
          catalogState.lastSelectedRowKey = null;
          catalogState.lastSelectedColIndex = 0;
        }
        if (typeof AppState !== 'undefined') {
          AppState.contentScroll = AppState.contentScroll || {};
          AppState.contentScroll.catalog = 0;
        }
        localStorage.removeItem('lastCatalogCardIndex');
        if (typeof hideSearchResults === 'function') hideSearchResults();

        var tabTorrentsEl = getEl('tab-torrents');
        var tabSearchEl = getEl('tab-search');
        var tabFavoritesEl = getEl('tab-favorites');
        if (tabTorrentsEl) tabTorrentsEl.classList.remove('active');
        if (tabSearchEl) tabSearchEl.classList.remove('active');
        if (tabFavoritesEl) tabFavoritesEl.classList.remove('active');
        tabCatalog.classList.add('active');
        showContentScreen('catalog');
        if (window.Nav) Nav.reset('catalog');


        if (typeof catalogState !== 'undefined' && catalogState.favoritesFromTopbar) {
          catalogState.favoritesFromTopbar = false;
          window.loadCatalogList();
          return;
        }


        var catalogView = typeof catalogState !== 'undefined' && catalogState.currentCatalog ?
        getEl('catalog-grid') :
        getEl('catalog-rows');
        if (!catalogView || !catalogView.hasChildNodes()) {
          window.loadCatalogList();
        } else {

          setTimeout(function () {
            if (AppState.currentScreen === 'catalog' && typeof window.ensureCatalogFocus === 'function') {
              window.ensureCatalogFocus(true);
            }
          }, APP_CONSTANTS.FOCUS_RESTORE_DELAY_MS);
        }
      }
    });
  }
}







function setupFavoritesTab() {
  var tabFavorites = getEl('tab-favorites');
  if (!tabFavorites || typeof window.loadFavoritesCatalog !== 'function') return;
  tabFavorites.addEventListener('click', function () {

    if (tabFavorites.classList.contains('active')) return;
    AppState.inSearch = 'catalog';
    window.pendingCatalogPoster = null;
    window.pendingCatalogItem = null;
    if (typeof hideSearchResults === 'function') hideSearchResults();
    ['tab-torrents', 'tab-search', 'tab-catalog'].forEach(function (id) {
      var t = getEl(id);
      if (t) t.classList.remove('active');
    });
    tabFavorites.classList.add('active');
    showContentScreen('catalog');
    if (window.Nav) Nav.reset('catalog');
    if (typeof catalogState !== 'undefined') catalogState.favoritesFromTopbar = true;

    localStorage.removeItem('lastCatalogCardIndex');
    Promise.resolve(window.loadFavoritesCatalog()).then(function () {
      setTimeout(function () {
        if (AppState.currentScreen !== 'catalog' || !tabFavorites.classList.contains('active')) return;


        if (typeof window.ensureCatalogFocus === 'function' && window.ensureCatalogFocus(true)) return;
        if (typeof updateFocusableElements === 'function') updateFocusableElements();
        if (typeof focusEl === 'function') focusEl(tabFavorites);
      }, APP_CONSTANTS.FOCUS_RESTORE_DELAY_MS);
    });
  });
}


function createFilterHandler(setter) {
  return function (e) {
    setter(e.target.value);
    if (typeof applyFiltersAndSort === 'function') applyFiltersAndSort();
  };
}

function setupSearchFilters() {
  var filterToggleBtn = getEl('filter-toggle');
  var torrentmovie = getEl('torrent-movie');
  var sortBy = getEl('sort-by');
  var filterQuality = getEl('filter-quality');
  var filterTracker = getEl('filter-tracker');
  var filterYear = getEl('filter-year');
  var resetFiltersBtn = getEl('reset-filters');
  var filterSeason = getEl('filter-season');
  var filterVoice = getEl('filter-voice');
  var filtervideotype = getEl('filter-videotype');


  if (filterToggleBtn) {
    filterToggleBtn.addEventListener('click', function () {
      console.log('🔘 filter-toggle нажат');
      var opened = false;
      if (typeof toggleSearchFiltersPanel === 'function') {
        opened = toggleSearchFiltersPanel();
        console.log('Панель открыта:', opened);
      } else {
        console.warn('toggleSearchFiltersPanel не определена');
        var panel = getEl('search-filters-panel');
        if (panel) {
          if (panel.classList.contains('collapsed')) {
            panel.classList.remove('collapsed');
            panel.classList.add('active');
            filterToggleBtn.classList.add('active');
            opened = true;
          } else {
            panel.classList.add('collapsed');
            panel.classList.remove('active');
            filterToggleBtn.classList.remove('active');
            opened = false;
          }
        }
      }
      if (opened && typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
        setTimeout(function () {
          if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
          updateFocusableElements();
          var panel = getEl('search-filters-panel');
          if (panel && panel.classList.contains('active')) {
            var closeBtn = getEl('filter-close-btn');
            if (closeBtn && closeBtn.offsetParent !== null) {
              focusEl(closeBtn);
            } else {
              var firstItem = panel.querySelector('.filter-item:not(.hidden)');
              if (firstItem) focusEl(firstItem);
            }
          }
        }, APP_CONSTANTS.FILTER_PANEL_DELAY_MS);
      }
    });
  }


  var filterConfigs = [
  { el: torrentmovie, setter: function (v) {if (typeof currentSearchMode !== 'undefined') currentSearchMode = v;} },
  { el: sortBy, setter: function (v) {if (typeof currentSort !== 'undefined') currentSort = v;} },
  { el: filterQuality, setter: function (v) {if (typeof currentQualityFilter !== 'undefined') currentQualityFilter = v;} },
  { el: filterTracker, setter: function (v) {if (typeof currentTrackerFilter !== 'undefined') currentTrackerFilter = v;} },
  { el: filterYear, setter: function (v) {if (typeof currentYearFilter !== 'undefined') currentYearFilter = v === 'all' ? '' : v;} },
  { el: filterSeason, setter: function (v) {if (typeof currentSeasonFilter !== 'undefined') currentSeasonFilter = v;} },
  { el: filterVoice, setter: function (v) {if (typeof currentVoiceFilter !== 'undefined') currentVoiceFilter = v;} },
  { el: filtervideotype, setter: function (v) {if (typeof currentvideotypeFilter !== 'undefined') currentvideotypeFilter = v;} }];


  filterConfigs.forEach(function (config) {
    if (config.el) {
      config.el.addEventListener('change', createFilterHandler(config.setter));
    }
  });

  if (resetFiltersBtn && typeof resetFilters === 'function') {
    resetFiltersBtn.addEventListener('click', function () {
      resetFilters();
      setTimeout(function () {
        updateFilterValueDisplays();
        if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
        if (typeof updateFocusableElements === 'function') updateFocusableElements();
      }, 100);
    });
  }


  var filterPanel = getEl('search-filters-panel');
  if (filterPanel) {
    var filterMainScreen = filterPanel.querySelector('.filter-main-screen');
    var filterValuesScreen = filterPanel.querySelector('.filter-values-screen');
    var filterValuesList = filterPanel.querySelector('#filter-values-list');
    var filterBackBtn = getEl('filter-back-btn');
    var filterCloseBtn = getEl('filter-close-btn');
    var currentFilterId = null;


    function showFilterMainScreen() {
      if (filterMainScreen) filterMainScreen.style.display = 'block';
      if (filterValuesScreen) filterValuesScreen.style.display = 'none';
      if (filterBackBtn) filterBackBtn.style.display = 'none';
      currentFilterId = null;
      updateFilterValueDisplays();
    }


    function showFilterValuesScreen(filterId) {
      var filterSelect = getEl(filterId);
      if (!filterSelect || !filterValuesList) return;

      currentFilterId = filterId;
      if (filterMainScreen) filterMainScreen.style.display = 'none';
      if (filterValuesScreen) filterValuesScreen.style.display = 'block';
      if (filterBackBtn) filterBackBtn.style.display = 'flex';

      filterValuesList.innerHTML = '';
      var currentValue = filterSelect.value;
      var options = filterSelect.querySelectorAll('option');



      var multi = filterId === 'filter-quality' && typeof window.parseQualityFilter === 'function';
      var multiSelected = multi ? window.parseQualityFilter(currentQualityFilter) : null;

      for (var i = 0; i < options.length; i++) {
        var option = options[i];
        var item = document.createElement('button');
        item.className = 'filter-value-item';
        var isSelected = multi ?
        option.value === 'all' ? !multiSelected.length : multiSelected.indexOf(option.value) !== -1 :
        option.value === currentValue;
        if (isSelected) {
          item.classList.add('selected');
        }

        var label = document.createElement('span');
        label.className = 'filter-value-label';
        label.textContent = option.textContent;
        item.appendChild(label);
        item.dataset.value = option.value;
        item.dataset.label = option.textContent;
        item.dataset.filterId = filterId;

        item.addEventListener('click', function (fid, val, lbl) {
          return function () {
            if (fid === 'filter-quality' && typeof window.toggleQualityFilterValue === 'function') {
              toggleQualityValue(val);
              return;
            }
            applyFilterValue(fid, val, lbl);
          };
        }(filterId, option.value, option.textContent));

        filterValuesList.appendChild(item);
      }


      setTimeout(function () {
        if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
        if (typeof updateFocusableElements === 'function') updateFocusableElements();
        var selectedItem = filterValuesList.querySelector('.filter-value-item.selected');
        if (selectedItem && selectedItem.offsetParent !== null) {
          focusEl(selectedItem);
        } else {
          var firstItem = filterValuesList.querySelector('.filter-value-item');
          if (firstItem) focusEl(firstItem);
        }
      }, 50);
    }



    function toggleQualityValue(value) {
      currentQualityFilter = window.toggleQualityFilterValue(currentQualityFilter, value);
      var selected = window.parseQualityFilter(currentQualityFilter);
      var items = filterValuesList.querySelectorAll('.filter-value-item');
      for (var i = 0; i < items.length; i++) {
        var v = items[i].dataset.value;
        var on = v === 'all' ? !selected.length : selected.indexOf(v) !== -1;
        items[i].classList.toggle('selected', on);
      }
      if (typeof applyFiltersAndSort === 'function') applyFiltersAndSort();
      updateFilterValueDisplays();
    }


    function applyFilterValue(filterId, value, label) {
      var filterSelect = getEl(filterId);
      if (filterSelect) {
        filterSelect.value = value;


        switch (filterId) {
          case 'torrent-movie':
            if (typeof currentSearchMode !== 'undefined') {
              currentSearchMode = value;
              if (typeof getCurrentSearchMode === 'function') getCurrentSearchMode();
            }
            break;
          case 'sort-by':
            if (typeof currentSort !== 'undefined') currentSort = value;
            break;
          case 'filter-quality':
            if (typeof currentQualityFilter !== 'undefined') currentQualityFilter = value;
            break;
          case 'filter-tracker':
            if (typeof currentTrackerFilter !== 'undefined') currentTrackerFilter = value;
            break;
          case 'filter-year':
            if (typeof currentYearFilter !== 'undefined') currentYearFilter = value === 'all' ? '' : value;
            break;
          case 'filter-season':
            if (typeof currentSeasonFilter !== 'undefined') currentSeasonFilter = value;
            break;
          case 'filter-voice':
            if (typeof currentVoiceFilter !== 'undefined') currentVoiceFilter = value;
            break;
          case 'filter-videotype':
            if (typeof currentvideotypeFilter !== 'undefined') currentvideotypeFilter = value;
            break;
        }


        try {
          var event = new Event('change', { bubbles: true });
          filterSelect.dispatchEvent(event);
        } catch (e) {}


        if (typeof applyFiltersAndSort === 'function') {
          applyFiltersAndSort();
        }
      }


      showFilterMainScreen();


      setTimeout(function () {
        if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
        if (typeof updateFocusableElements === 'function') updateFocusableElements();
        var targetItem = filterPanel.querySelector('.filter-item[data-filter="' + filterId + '"]');
        if (targetItem) {
          focusEl(targetItem);
        }
      }, 50);
    }


    function updateFilterValueDisplays() {
      var filterIds = [
      'torrent-movie', 'sort-by', 'filter-quality', 'filter-tracker',
      'filter-year', 'filter-season', 'filter-voice', 'filter-videotype'];

      for (var i = 0; i < filterIds.length; i++) {
        var fid = filterIds[i];
        var sel = getEl(fid);
        var display = getEl('filter-value-' + fid);
        if (fid === 'filter-quality' && display && typeof window.qualityFilterLabel === 'function') {

          display.textContent = window.qualityFilterLabel(currentQualityFilter);
          if (display.parentNode && display.parentNode.classList) {
            display.parentNode.classList.toggle('filter-item-set',
            window.parseQualityFilter(currentQualityFilter).length > 0);
          }
          continue;
        }
        if (sel && display) {
          var selectedOption = sel.options[sel.selectedIndex];
          display.textContent = selectedOption ? selectedOption.textContent : 'Все';





          var item = display.parentNode;
          if (item && item.classList) {
            if (sel.selectedIndex > 0) item.classList.add('filter-item-set');else
            item.classList.remove('filter-item-set');
          }
        }
      }
    }




    window.updateFilterValueDisplays = updateFilterValueDisplays;


    var filterItems = filterPanel.querySelectorAll('.filter-item');
    for (var fi = 0; fi < filterItems.length; fi++) {
      filterItems[fi].addEventListener('click', function (item) {
        return function () {
          var filterId = item.dataset.filter;
          if (filterId) {
            showFilterValuesScreen(filterId);
          }
        };
      }(filterItems[fi]));
    }


    if (filterBackBtn) {
      filterBackBtn.addEventListener('click', function () {


        var fromId = currentFilterId;
        showFilterMainScreen();
        setTimeout(function () {
          if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
          if (typeof updateFocusableElements === 'function') updateFocusableElements();
          var target = fromId && filterPanel.querySelector('.filter-item[data-filter="' + fromId + '"]') ||
          filterPanel.querySelector('.filter-item:not(.hidden)');
          if (target) focusEl(target);
        }, 50);
      });
    }


    if (filterCloseBtn) {
      filterCloseBtn.addEventListener('click', function () {
        if (typeof closeFilterPanel === 'function') closeFilterPanel();
      });
    }


    var resetBtnNew = filterPanel.querySelector('.filter-reset-btn-new');
    if (resetBtnNew) {
      resetBtnNew.addEventListener('click', function () {
        if (typeof resetFilters === 'function') resetFilters();
        setTimeout(function () {
          updateFilterValueDisplays();
          if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
          if (typeof updateFocusableElements === 'function') updateFocusableElements();
          var firstItem = filterPanel.querySelector('.filter-item:not(.hidden)');
          if (firstItem) focusEl(firstItem);
        }, 100);
      });
    }


    updateFilterValueDisplays();


    var observeIds = ['torrent-movie', 'sort-by', 'filter-quality', 'filter-tracker',
    'filter-year', 'filter-season', 'filter-voice', 'filter-videotype'];
    for (var oi = 0; oi < observeIds.length; oi++) {
      var obsSel = getEl(observeIds[oi]);
      if (obsSel) {
        obsSel.addEventListener('change', updateFilterValueDisplays);
      }
    }
  }
}


function setupServerCheck() {
  var torrserverUrl = getEl('torrserver-url');
  if (torrserverUrl) {
    var debouncedCheck = debounce(function () {
      if (typeof checkServer === 'function') checkServer(true);
    }, APP_CONSTANTS.DEBOUNCE_DELAY_MS);
    torrserverUrl.addEventListener('input', debouncedCheck);
  }
}


function setupAuth() {
  var authCheckbox = getEl('auth-checkbox');
  var authLogin = getEl('auth-login');
  var authPassword = getEl('auth-password');

  var debouncedCheckAuth = debounce(function () {
    if (typeof checkServer === 'function') checkServer(true);
  }, APP_CONSTANTS.DEBOUNCE_DELAY_MS);

  if (authCheckbox) {
    authCheckbox.addEventListener('change', function (e) {
      if (typeof AppState !== 'undefined') AppState.authEnabled = e.target.checked;
      var authFields = getEl('auth-fields');
      if (authFields) {
        if (AppState && AppState.authEnabled) authFields.classList.add('visible');else
        authFields.classList.remove('visible');
      }
      setTimeout(debouncedCheckAuth, APP_CONSTANTS.CHECK_SERVER_TIMEOUT_MS);
    });
  }

  if (authLogin) authLogin.addEventListener('input', debouncedCheckAuth);
  if (authPassword) authPassword.addEventListener('input', debouncedCheckAuth);
}


function setupPlayerAutoHide() {
  var playerScreen = getEl('player-screen');
  if (!playerScreen || typeof resetMouseIdleTimer !== 'function') return;




  playerScreen.addEventListener('mousemove', resetMouseIdleTimer);
  playerScreen.addEventListener('mousedown', resetMouseIdleTimer);
  playerScreen.addEventListener('mouseenter', resetMouseIdleTimer);
}


function setupTouchControls(seekSlider, volumeSlider) {
  var touchTarget = null;
  var touchStartX = 0;
  var touchStartY = 0;
  var touchStartTime = 0;
  var touchMoved = false;


  function handleTouchStart(e) {
    var target = e.target;


    var isInSearchOverlay = target.closest && target.closest('#search-overlay');
    var isCloseBtn = target.id === 'close-search' || target.closest && target.closest('#close-search');
    var isFilterBtn = target.id === 'filter-toggle' || target.closest && target.closest('#filter-toggle');
    if ((isCloseBtn || isFilterBtn) && isInSearchOverlay) return;

    touchTarget = target;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartTime = Date.now();
    touchMoved = false;

    if (touchTarget.closest('button') || touchTarget.closest('.control-btn')) {
      touchTarget.classList.add('touch-active');
    }
  }




  var syntheticClickTarget = null;
  var syntheticClickTime = 0;
  function suppressNextRealClick(el) {
    syntheticClickTarget = el;
    syntheticClickTime = Date.now();
  }
  document.addEventListener('click', function (e) {
    if (!syntheticClickTarget || !e.isTrusted) return;
    if (Date.now() - syntheticClickTime > 1500) {syntheticClickTarget = null;return;}
    if (e.target !== syntheticClickTarget && !syntheticClickTarget.contains(e.target)) return;
    syntheticClickTarget = null;
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true);

  function handleTouchEnd(e) {
    if (!touchStartX) return;

    var deltaX = e.changedTouches[0].clientX - touchStartX;
    var deltaY = e.changedTouches[0].clientY - touchStartY;
    var deltaTime = Date.now() - touchStartTime;

    if (touchTarget) touchTarget.classList.remove('touch-active');

    var elementAtTouch = document.elementFromPoint(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    var clickableElement = null;
    if (elementAtTouch) {
      clickableElement = elementAtTouch.closest(CLICKABLE_SELECTORS);
    }


    if (!touchMoved && deltaTime < APP_CONSTANTS.TOUCH_TAP_THRESHOLD_MS &&
    Math.abs(deltaX) < APP_CONSTANTS.TOUCH_MOVE_THRESHOLD_PX &&
    Math.abs(deltaY) < APP_CONSTANTS.TOUCH_MOVE_THRESHOLD_PX) {









      var targetToClick = clickableElement || touchTarget;
      if (targetToClick && (
      targetToClick.closest('button') ||
      targetToClick.closest('.control-btn') ||
      targetToClick.closest('.play-btn') ||
      targetToClick.closest('.torrent-card') ||
      targetToClick.closest('.file-item') ||
      targetToClick.closest('.search-result-item') ||
      targetToClick.closest('.episode-item') ||
      targetToClick.closest('.audio-item') ||
      targetToClick.closest('.subtitle-item') ||
      targetToClick.closest('.skip-button') ||
      targetToClick.id === 'close-search' ||
      targetToClick.id === 'filter-toggle' ||
      targetToClick.id === 'search-btn'))
      {
        e.stopPropagation();




        if (e.cancelable) e.preventDefault();
        suppressNextRealClick(targetToClick);
        targetToClick.click();
      }
    }

    touchStartX = 0;
    touchStartY = 0;
  }

  function handleTouchCancel(e) {
    if (touchTarget) touchTarget.classList.remove('touch-active');
    touchStartX = 0;
    touchStartY = 0;
  }




  document.addEventListener('touchstart', function (e) {
    var el = e.target.closest ? e.target.closest(CLICKABLE_SELECTORS) : null;
    if (el) handleTouchStart.call(el, e);
  }, { passive: true });



  document.addEventListener('touchend', function (e) {
    var el = e.target.closest ? e.target.closest(CLICKABLE_SELECTORS) : null;
    if (el) handleTouchEnd.call(el, e);
  }, { passive: false });

  document.addEventListener('touchcancel', function (e) {
    var el = e.target.closest ? e.target.closest(CLICKABLE_SELECTORS) : null;
    if (el) handleTouchCancel.call(el, e);
  }, { passive: true });


  if (seekSlider) {
    seekSlider.addEventListener('touchstart', function (e) {
      e.stopPropagation();
      if (typeof AppState !== 'undefined') {
        AppState.isSliderDragging = true;
        AppState.suppressTimeUpdate = true;
      }
    }, { passive: true });
    seekSlider.addEventListener('touchmove', function (e) {e.stopPropagation();}, { passive: true });
    seekSlider.addEventListener('touchend', function (e) {
      e.stopPropagation();
      if (typeof AppState !== 'undefined') AppState.isSliderDragging = false;
      setTimeout(function () {
        if (typeof AppState !== 'undefined') AppState.suppressTimeUpdate = false;
      }, 100);
    }, { passive: true });
  }

  if (volumeSlider) {
    volumeSlider.addEventListener('touchstart', function (e) {e.stopPropagation();}, { passive: true });
    volumeSlider.addEventListener('touchmove', function (e) {e.stopPropagation();}, { passive: true });
    volumeSlider.addEventListener('touchend', function (e) {e.stopPropagation();}, { passive: true });
  }



}


function setupFullscreen() {
  var fullscreenBtn = getEl('fullscreen-btn');
  if (!fullscreenBtn) return;

  function toggleFullscreen() {
    var isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
    if (!isFullscreen) {





      var element = document.documentElement;
      if (element.requestFullscreen) element.requestFullscreen();else
      if (element.webkitRequestFullscreen) element.webkitRequestFullscreen();else
      if (element.mozRequestFullScreen) element.mozRequestFullScreen();else
      if (element.msRequestFullscreen) element.msRequestFullscreen();
      fullscreenBtn.innerHTML = '<i class="fi fi-rr-compress"></i>';
      fullscreenBtn.title = 'Выйти из полноэкранного режима';
    } else {
      if (document.exitFullscreen) document.exitFullscreen();else
      if (document.webkitExitFullscreen) document.webkitExitFullscreen();else
      if (document.mozCancelFullScreen) document.mozCancelFullScreen();else
      if (document.msExitFullscreen) document.msExitFullscreen();
      fullscreenBtn.innerHTML = '<i class="fi fi-rr-expand"></i>';
      fullscreenBtn.title = 'Полный экран';
    }
  }

  function updateFullscreenIcon() {
    var isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
    fullscreenBtn.innerHTML = isFullscreen ? '<i class="fi fi-rr-compress"></i>' : '<i class="fi fi-rr-expand"></i>';
    fullscreenBtn.title = isFullscreen ? 'Выйти из полноэкранного режима' : 'Полный экран';


    if (typeof window.syncFullscreenOverlays === 'function') window.syncFullscreenOverlays();
  }

  fullscreenBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    toggleFullscreen();
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });

  document.addEventListener('fullscreenchange', updateFullscreenIcon);
  document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);
}

function setupAutoFullscreen() {
  var autoFullscreenCheckbox = getEl('auto-fullscreen');
  if (!autoFullscreenCheckbox) return;

  var savedAutoFullscreen = localStorage.getItem('autoFullscreen') === 'true';
  autoFullscreenCheckbox.checked = savedAutoFullscreen;

  autoFullscreenCheckbox.addEventListener('change', function (e) {
    localStorage.setItem('autoFullscreen', e.target.checked);
    if (e.target.checked) {
      var element = document.documentElement;
      if (element.requestFullscreen) element.requestFullscreen();else
      if (element.webkitRequestFullscreen) element.webkitRequestFullscreen();else
      if (element.mozRequestFullScreen) element.mozRequestFullScreen();else
      if (element.msRequestFullscreen) element.msRequestFullscreen();
    }
  });

  function enterFullscreenIfEnabled() {
    var autoFullscreen = localStorage.getItem('autoFullscreen') === 'true';
    if (autoFullscreen) {
      setTimeout(function () {
        var element = document.documentElement;
        if (element.requestFullscreen) element.requestFullscreen();else
        if (element.webkitRequestFullscreen) element.webkitRequestFullscreen();else
        if (element.mozRequestFullScreen) element.mozRequestFullScreen();else
        if (element.msRequestFullscreen) element.msRequestFullscreen();
      }, 500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enterFullscreenIfEnabled);
  } else {
    enterFullscreenIfEnabled();
  }
}











function setupSearchFilterDefaults() {
  var box = getEl('search-filter-defaults');
  if (!box || typeof window.getSearchFilterDefaults !== 'function') return;

  var groups = [
  { key: 'sort', title: 'Сортировка', options: window.SORT_OPTIONS },
  { key: 'quality', title: 'Качество', hint: 'можно выбрать несколько', options: window.QUALITY_OPTIONS },
  { key: 'videotype', title: 'Тип видео', options: window.VIDEOTYPE_OPTIONS }];


  var html = '';
  for (var g = 0; g < groups.length; g++) {
    var grp = groups[g];
    html += '<div class="settings-field">' +
    '<div class="field-label">' + grp.title + (grp.hint ? ' <span class="field-hint">— ' + grp.hint + '</span>' : '') + '</div>' +
    '<div class="settings-chips" data-group="' + grp.key + '">';
    for (var i = 0; i < grp.options.length; i++) {
      var o = grp.options[i];
      html += '<button class="settings-chip" data-group="' + grp.key + '" data-value="' + o.value + '">' + o.label + '</button>';
    }
    html += '</div></div>';
  }
  box.innerHTML = html;

  function render() {
    var d = window.getSearchFilterDefaults();
    var qualityList = window.parseQualityFilter(d.quality);
    var chips = box.querySelectorAll('.settings-chip');
    for (var i = 0; i < chips.length; i++) {
      var c = chips[i],grp = c.dataset.group,val = c.dataset.value,on;
      if (grp === 'quality') on = val === 'all' ? !qualityList.length : qualityList.indexOf(val) !== -1;else
      on = d[grp] === val;
      c.classList.toggle('active', on);
    }
  }

  box.addEventListener('click', function (e) {
    var chip = e.target.closest ? e.target.closest('.settings-chip') : null;
    if (!chip) return;
    var grp = chip.dataset.group,val = chip.dataset.value;
    var d = window.getSearchFilterDefaults();
    if (grp === 'quality') d.quality = window.toggleQualityFilterValue(d.quality, val);else
    d[grp] = val;
    window.saveSearchFilterDefaults(d);
    window.applySearchFilterDefaults(grp);
    if (typeof syncSearchFilterButtons === 'function') syncSearchFilterButtons();
    render();
  });

  render();
}


function setupCheckboxWithStorage(elementId, storageKey, stateKey, onChange) {
  var checkbox = getEl(elementId);
  if (!checkbox) return;

  var saved = localStorage.getItem(storageKey) === 'true';
  if (stateKey && typeof AppState !== 'undefined') AppState[stateKey] = saved;
  checkbox.checked = saved;

  checkbox.addEventListener('change', function (e) {
    var value = e.target.checked;
    localStorage.setItem(storageKey, value);
    if (stateKey && typeof AppState !== 'undefined') AppState[stateKey] = value;
    if (onChange) onChange(value);
  });

  return saved;
}

function setupCheckboxes() {

  setupExternalPlayerCheckbox();
  var container = '';



  var autoSkipCheckbox = getEl('auto-skip-intro');
  if (autoSkipCheckbox) {
    if (window.AndroidJS) {
      var autoSkipContainer = autoSkipCheckbox.closest('.checkbox-container');
      if (autoSkipContainer) autoSkipContainer.classList.add('hidden');
    }
    AppState.autoSkipIntro = localStorage.getItem('autoSkipIntro') === 'true';
    autoSkipCheckbox.checked = AppState.autoSkipIntro;
    autoSkipCheckbox.addEventListener('change', function (e) {
      AppState.autoSkipIntro = e.target.checked;
      localStorage.setItem('autoSkipIntro', AppState.autoSkipIntro);
      console.log('⏩ Автопропуск заставки:', AppState.autoSkipIntro ? 'включён' : 'выключен');
    });
  }



  var builtinKeyboardCheckbox = getEl('builtin-keyboard');
  if (builtinKeyboardCheckbox) {
    AppState.builtinKeyboard = localStorage.getItem('builtinKeyboard') === 'true';
    builtinKeyboardCheckbox.checked = AppState.builtinKeyboard;
    builtinKeyboardCheckbox.addEventListener('change', function (e) {
      AppState.builtinKeyboard = e.target.checked;
      localStorage.setItem('builtinKeyboard', AppState.builtinKeyboard);
      if (window.OSK && typeof window.OSK.applySetting === 'function') window.OSK.applySetting();
      console.log('⌨️ Встроенная клавиатура:', AppState.builtinKeyboard ? 'включена' : 'выключена');
    });
  }

  setupSearchFilterDefaults();


  var hideClockCheckbox = getEl('hide-clock');
  if (window.AndroidJS) {
    container = hideClockCheckbox.closest('.checkbox-container');
    if (container) container.classList.add('hidden');
  }
  if (hideClockCheckbox) {
    var savedHideClock = localStorage.getItem('hideClockEnabled') === 'true';
    hideClockEnabled = savedHideClock;
    hideClockCheckbox.checked = savedHideClock;


    setupClockVisibility();
    hideClockCheckbox.addEventListener('change', function (e) {
      hideClockEnabled = e.target.checked;
      localStorage.setItem('hideClockEnabled', hideClockEnabled);
      setupClockVisibility();
      console.log('🕐 Скрытие часов:', hideClockEnabled ? 'включено' : 'выключено');
    });
  }


  var addToDbCheckbox = getEl('add-to-db');
  if (addToDbCheckbox) {
    var savedAddToDb = localStorage.getItem('addToDbEnabled') === 'true';
    addToDbEnabled = savedAddToDb;
    addToDbCheckbox.checked = savedAddToDb;
    if (typeof AppState !== 'undefined') {
      AppState.addToDbEnabled = addToDbEnabled;
    }
    addToDbCheckbox.addEventListener('change', function (e) {
      addToDbEnabled = e.target.checked;
      localStorage.setItem('addToDbEnabled', addToDbEnabled);
      if (typeof AppState !== 'undefined') {
        AppState.addToDbEnabled = addToDbEnabled;
      }
      console.log('💾 Добавление в базу:', addToDbEnabled ? 'включено' : 'выключено');
    });
  }



  var preloadCheckbox = getEl('preload-before-play');
  if (preloadCheckbox) {
    AppState.preloadBeforePlay = localStorage.getItem('preloadBeforePlay') === 'true';
    preloadCheckbox.checked = AppState.preloadBeforePlay;
    preloadCheckbox.addEventListener('change', function (e) {
      AppState.preloadBeforePlay = e.target.checked;
      localStorage.setItem('preloadBeforePlay', AppState.preloadBeforePlay);
      console.log('⏳ Предзагрузка:', AppState.preloadBeforePlay ? 'включена' : 'выключена');
    });
  }






  var tvApp = !!window.AndroidJS || AppState.platform === 'webos';
  var transcodingCheckbox = getEl('transcoding-off');
  if (AppState.platform === 'webos' && transcodingCheckbox) {
    transcodingCheckbox.checked = false;
    AppState.transcodingOnOff = false;
  }
  if (tvApp) {
    container = transcodingCheckbox.closest('.checkbox-container');
    if (container) container.classList.add('hidden');
  }
  if (transcodingCheckbox && AppState.platform !== 'webos') {
    var savedTranscoding = localStorage.getItem('transcodingOnOff') === 'true';
    transcodingOnOff = savedTranscoding;
    transcodingCheckbox.checked = savedTranscoding;
    if (typeof AppState !== 'undefined') {
      AppState.transcodingOnOff = transcodingOnOff;
    }
    transcodingCheckbox.addEventListener('change', function (e) {
      transcodingOnOff = e.target.checked;
      localStorage.setItem('transcodingOnOff', transcodingOnOff);
      if (typeof AppState !== 'undefined') {
        AppState.transcodingOnOff = transcodingOnOff;
      }
      console.log('🎬 Транскодирование:', transcodingOnOff ? 'включено' : 'выключено');
    });
  }


  var multiChannelCheckbox = getEl('multi-channel-audio');
  if (tvApp) {
    container = multiChannelCheckbox.closest('.checkbox-container');
    if (container) container.classList.add('hidden');
  }
  if (multiChannelCheckbox) {
    var savedMultiChannel = localStorage.getItem('multiChannelEnabled') === 'true';
    multiChannelEnabled = savedMultiChannel;
    multiChannelCheckbox.checked = savedMultiChannel;
    if (typeof AppState !== 'undefined') {
      AppState.multiChannelEnabled = multiChannelEnabled;
    }
    multiChannelCheckbox.addEventListener('change', function (e) {
      multiChannelEnabled = e.target.checked;
      localStorage.setItem('multiChannelEnabled', multiChannelEnabled);
      if (typeof AppState !== 'undefined') {
        AppState.multiChannelEnabled = multiChannelEnabled;
      }
      console.log('🎵 Многоканальный звук:', multiChannelEnabled ? 'включен' : 'выключен');
      if (multiChannelEnabled) {
        var hint = getEl('player-hint');
        if (hint) {
          var originalText = hint.textContent;
          hint.textContent = 'Многоканальный звук включен. Новые потоки будут использовать оригинальные аудиодорожки (AC3/E-AC3/AAC)';
          hint.style.opacity = '1';
          setTimeout(function () {
            hint.textContent = originalText;
            hint.style.opacity = '0';
          }, 3000);
        }
      }
    });
  }


  var transcodingCheckboxOnOff = getEl('transcoding-on-off');
  if (tvApp) {
    container = transcodingCheckboxOnOff.closest('.checkbox-container');
    if (container) container.classList.add('hidden');
  }




  if (transcodingCheckboxOnOff && AppState.platform === 'webos') {
    transcodingFullOnOff = true;
    AppState.transcodingFullOnOff = true;
    transcodingCheckboxOnOff.checked = true;
    transcodingCheckboxOnOff = null;
  }
  if (transcodingCheckboxOnOff) {
    var savedTranscodingFull = localStorage.getItem('transcodingFullOnOff') === 'true';
    transcodingFullOnOff = savedTranscodingFull;
    transcodingCheckboxOnOff.checked = savedTranscodingFull;
    if (typeof AppState !== 'undefined') {
      AppState.transcodingFullOnOff = transcodingFullOnOff;
    }
    transcodingCheckboxOnOff.addEventListener('change', function (e) {
      transcodingFullOnOff = e.target.checked;
      localStorage.setItem('transcodingFullOnOff', transcodingFullOnOff);
      if (typeof AppState !== 'undefined') {
        AppState.transcodingFullOnOff = transcodingFullOnOff;
      }
      console.log('🎬 Транскодирование:', transcodingFullOnOff ? 'включено' : 'выключено');
    });
  }




  if (!window.AndroidJS && localStorage.getItem('autoSwitchEpisodes') === null) {
    localStorage.setItem('autoSwitchEpisodes', 'true');
  }
  setupCheckboxWithStorage('auto-switch-episodes', 'autoSwitchEpisodes', 'autoSwitchEpisodes');

  if (window.AndroidJS) {


    var choosePlayerContainer = getEl('choose-player-container');
    if (choosePlayerContainer) choosePlayerContainer.hidden = false;
    var choosePlayerBtn = getEl('choose-player-btn');
    if (choosePlayerBtn) {
      choosePlayerBtn.addEventListener('click', function () {
        if (typeof AndroidJS.choosePlayer === 'function') AndroidJS.choosePlayer();
      });
    }
  } else {

    if (typeof initDolbyVisionCheck === 'function') {
      try {
        initDolbyVisionCheck();
      } catch (e) {
        console.warn('⚠️ Ошибка инициализации Dolby Vision check:', e);
      }
    } else {
      console.log('ℹ️ initDolbyVisionCheck не найдена, пропускаем');
    }
  }
}

function setupExternalPlayerCheckbox() {
  var externalPlayerCheckbox = getEl('out-player');
  if (!externalPlayerCheckbox) return;

  var savedExternalPlayer = localStorage.getItem('externalPlayerEnabled') === 'true';
  window.externalPlayerEnabled = savedExternalPlayer;
  externalPlayerCheckbox.checked = savedExternalPlayer;

  if (typeof AppState !== 'undefined') AppState.externalPlayerEnabled = window.externalPlayerEnabled;
  console.log('📱 Внешний плеер:', window.externalPlayerEnabled ? 'включен' : 'выключен');

  externalPlayerCheckbox.addEventListener('change', function (e) {
    window.externalPlayerEnabled = e.target.checked;
    localStorage.setItem('externalPlayerEnabled', window.externalPlayerEnabled);
    if (typeof AppState !== 'undefined') AppState.externalPlayerEnabled = window.externalPlayerEnabled;
    console.log('📱 Внешний плеер:', window.externalPlayerEnabled ? 'включен' : 'выключен');
    if (window.externalPlayerEnabled && typeof showPlayerHint === 'function') {
      showPlayerHint('Внешний плеер включен. При воспроизведении будет открыт выбор приложений.');
    } else if (!window.externalPlayerEnabled && typeof showPlayerHint === 'function') {
      showPlayerHint('Внешний плеер выключен. Используется встроенный плеер.');
    }
  });
}

function setupClockVisibility() {
  var clockDisplay = getEl('clock-display');
  if (clockDisplay) {
    clockDisplay.style.display = hideClockEnabled ? 'none' : 'block';
  }
}





var PLATFORM_NAMES = {
  vidaa: 'Hisense Vidaa',
  androidtv: 'Android TV',
  webos: 'LG webOS',
  tizen: 'Samsung Tizen',
  smarttv: 'Smart TV',
  ios: 'iOS',
  android: 'Android',
  desktop: 'Компьютер'
};

function deviceAppName() {
  if (window.AndroidJS) return 'Android-приложение TorrStream';
  if (AppState.platform === 'webos') return 'Приложение TorrStream для webOS';
  return 'Браузер (web)';
}

function devicePlayerName() {
  if (window.AndroidJS) return 'Внешний плеер Android';
  if (AppState.transcodingFullOnOff) return 'Встроенный, файл напрямую с TorrServer';
  if (AppState.transcodingOnOff) return 'Встроенный, транскодирование TorrServer (HLS)';
  return 'Встроенный, поток через сервер TorrStream (HLS)';
}







function browserVersionName() {
  var ua = navigator.userAgent || '';
  var known = [
  ['Edge', /Edg(?:e|A|iOS)?\/([\d.]+)/],
  ['Opera', /OPR\/([\d.]+)/],
  ['Яндекс Браузер', /YaBrowser\/([\d.]+)/],
  ['Samsung Internet', /SamsungBrowser\/([\d.]+)/],
  ['Firefox', /Firefox\/([\d.]+)/],
  ['Chrome', /(?:Chrome|CriOS)\/([\d.]+)/],
  ['Safari', /Version\/([\d.]+).*Safari/]];

  for (var i = 0; i < known.length; i++) {
    var m = ua.match(known[i][1]);
    if (m) {

      var wv = known[i][0] === 'Chrome' && /; wv\)/.test(ua) ? 'WebView ' : '';
      return wv + known[i][0] + ' ' + m[1];
    }
  }
  return '—';
}

function renderDeviceInfo() {
  var box = getEl('device-info');
  if (!box) return;
  var dpr = window.devicePixelRatio || 1;
  var rows = [
  ['Приложение', deviceAppName()],
  ['Платформа', PLATFORM_NAMES[AppState.platform] || AppState.platform || '—'],
  ['Плеер', devicePlayerName()],
  ['Версия', AppState.currentVersion || '—'],
  ['Браузер', browserVersionName()],
  ['User-Agent', navigator.userAgent || '—'],
  ['Экран', window.innerWidth + '×' + window.innerHeight + (dpr !== 1 ? ' (×' + Math.round(dpr * 100) / 100 + ')' : '')]];



  if (AppState.platform === 'webos') {
    var d = window.webosSubsDiag;
    var subs;
    if (!d || !d.bridge) subs = 'видео ещё не запускали';else
    if (d.bridge === 'нет') subs = 'нет доступа к Luna (PalmServiceBridge)';else
    {
      subs = d.bridge + ' · mediaId: ' + (d.mediaId || 'нет за ' + Math.round(d.waitedMs / 1000) + ' с') +
      ' · ответов: ' + d.responses +
      ' · sourceInfo: ' + (d.sourceInfo ? 'да' : 'нет') + (
      d.tracks !== null ? ' · дорожек: ' + d.tracks : '') + (
      d.audio !== null && d.audio !== undefined ? ' · звук: ' + d.audio : '') + (
      d.probe ? ' · ffprobe: ' + d.probe : '') + (
      d.keys ? ' · поля: ' + d.keys : '') + (
      d.error ? ' · ошибка: ' + d.error : '');
    }
    rows.push(['Субтитры webOS', subs]);
  }
  var html = '';
  for (var i = 0; i < rows.length; i++) {
    html += '<div class="device-info-row"><span class="device-info-label">' + escapeHtml(rows[i][0]) +
    '</span><span class="device-info-value">' + escapeHtml(String(rows[i][1])) + '</span></div>';
  }
  box.innerHTML = html;
}
window.renderDeviceInfo = renderDeviceInfo;


function setupConfigMenu() {
  if (!Element.prototype.closest) {
    Element.prototype.closest = function (selector) {
      var element = this;
      while (element && element.nodeType === 1) {
        if (element.matches(selector)) return element;
        element = element.parentNode;
      }
      return null;
    };
  }

  var menuItems = document.querySelectorAll('.menu-item');
  for (var i = 0; i < menuItems.length; i++) {
    var menuItem = menuItems[i];
    menuItem.removeEventListener('click', menuItem._configClickHandler);

    var clickHandler = function (event) {
      if (event.stopPropagation) event.stopPropagation();
      var tabId = this.getAttribute('data-tab') || this.id;
      var isActive = this.classList.contains('active');
      console.log('🔘 Нажато меню:', tabId, 'Активно:', isActive);

      if (isActive) {
        var content = getEl(tabId + '-content');
        if (content) content.style.display = 'none';
        this.classList.remove('active');
        if (this.blur) this.blur();
      } else {
        if (typeof switchConfigTab === 'function') switchConfigTab(tabId);
        if (typeof setConfigMenuActive === 'function') setConfigMenuActive(this.id);
        if (this.focus) this.focus();
      }
    };

    menuItem._configClickHandler = clickHandler;
    menuItem.addEventListener('click', clickHandler);
  }
  console.log('✅ Настройки меню инициализированы, элементов:', menuItems.length);
}


function showInitError() {
  var errorDiv = document.createElement('div');
  errorDiv.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.9); color: #ff6a6a; padding: 20px; border-radius: 12px; text-align: center; z-index: 10000; border: 1px solid #ff6a6a;';
  errorDiv.innerHTML = '<div style="font-size: 48px; margin-bottom: 10px;">⚠️</div>' +
  '<div style="margin-bottom: 10px;">Ошибка инициализации приложения</div>' +
  '<div style="font-size: 12px; color: #aaa;">Попробуйте обновить страницу</div>' +
  '<button onclick="location.reload()" style="margin-top: 15px; padding: 8px 20px; background: #4a9eff; border: none; border-radius: 6px; color: white; cursor: pointer;">Обновить</button>';
  document.body.appendChild(errorDiv);
}


function showPlayerHint(message) {
  var hint = getEl('player-hint');
  if (!hint) return;
  hint.textContent = message;
  hint.style.opacity = '1';
  clearTimeout(window.hintTimeout);
  window.hintTimeout = setTimeout(function () {
    hint.style.opacity = '0';
  }, APP_CONSTANTS.HINT_DISPLAY_DURATION_MS);
}


function setupSpeedTest() {
  var speedtestBtn = getEl('speedtest-btn');
  if (!speedtestBtn) return;

  speedtestBtn.addEventListener('click', _asyncToGenerator(function* () {
    console.log('📡 Запуск замера скорости...');
    var torrserverUrlInput = getEl('torrserver-url');

    var torrServerUrl = typeof window.torrServerUrlFromField === 'function' ?
    window.torrServerUrlFromField() :
    torrserverUrlInput ? torrserverUrlInput.value.trim() : '';

    if (!torrServerUrl) {
      var resultsDiv = getEl('speedtest-results');
      var torrEl = getEl('speedtest-torrserver');
      if (resultsDiv) resultsDiv.style.display = 'block';
      if (torrEl) torrEl.innerHTML = '❌ Укажите URL TorrServer';
      setTimeout(function () {
        if (torrEl && torrEl.innerHTML === '❌ Укажите URL TorrServer') {
          torrEl.innerHTML = 'TorrServer → Сервер: -- Mbps';
        }
      }, 3000);
      return;
    }

    if (typeof SpeedTest !== 'undefined' && SpeedTest.run) {
      yield SpeedTest.run(torrServerUrl);
    } else {
      console.error('❌ Модуль SpeedTest не загружен');
      var resultsDiv = getEl('speedtest-results');
      if (resultsDiv) {
        resultsDiv.style.display = 'block';
        resultsDiv.innerHTML = '<div style="color: #ff4e4e;">❌ Модуль замера скорости не загружен. Обновите страницу.</div>';
      }
    }
  }));
}


function initJacredUrlStorage() {
  var jacredUrlInput = getEl('jacred-url');
  if (!jacredUrlInput) return;

  var savedUrl = localStorage.getItem('jacred-url');
  if (savedUrl) {
    jacredUrlInput.value = savedUrl;
    console.log('📦 Загружен jacred URL:', savedUrl);
  }

  var debouncedSave = debounce(function () {
    var value = jacredUrlInput.value.trim();
    localStorage.setItem('jacred-url', value);
    console.log('💾 Сохранён jacred URL:', value);
  }, APP_CONSTANTS.JACRED_SAVE_DELAY_MS);

  jacredUrlInput.addEventListener('input', debouncedSave);
  jacredUrlInput.addEventListener('blur', function () {
    var value = jacredUrlInput.value.trim();
    localStorage.setItem('jacred-url', value);
  });
}




function isCodecSupportedAnywhere(type) {
  try {
    if (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported && MediaSource.isTypeSupported(type)) return true;
  } catch (e) {}
  try {
    if (typeof ManagedMediaSource !== 'undefined' && ManagedMediaSource.isTypeSupported && ManagedMediaSource.isTypeSupported(type)) return true;
  } catch (e) {}
  try {
    var v = document.createElement('video');
    if (v.canPlayType && v.canPlayType(type) === 'probably') return true;
  } catch (e) {}
  return false;
}

function checkDolbyVisionSupport() {
  var tests = [
  { name: 'HEVC Main 10', codec: 'video/mp4; codecs="hvc1.2.4.L150.B0"' },
  { name: 'H.264 (AVC)', codec: 'video/mp4; codecs="avc1.640028"' },
  { name: 'Dolby Vision Profile 8 (dvh1)', codec: 'video/mp4; codecs="dvh1.08.06"', dv: 'p8' },
  { name: 'Dolby Vision Profile 8 (dvhe)', codec: 'video/mp4; codecs="dvhe.08.06"', dv: 'p8' },
  { name: 'Dolby Vision Profile 5 (dvh1)', codec: 'video/mp4; codecs="dvh1.05.06"', dv: 'p5' },
  { name: 'Dolby Vision Profile 5 (dvhe)', codec: 'video/mp4; codecs="dvhe.05.06"', dv: 'p5' },
  { name: 'Dolby Vision AV1 (dav1)', codec: 'video/mp4; codecs="dav1.10.06"', dv: 'av1' },
  { name: 'AV1 Main', codec: 'video/mp4; codecs="av01.0.08M.08"' }];


  var results = [];
  var variants = { p8: false, p5: false, av1: false };

  console.log('🔍 Проверка поддержки кодеков:');
  for (var i = 0; i < tests.length; i++) {
    var test = tests[i];
    var supported = isCodecSupportedAnywhere(test.codec);
    results.push({ name: test.name, codec: test.codec, supported: supported });
    console.log('   ' + (supported ? '✅' : '❌') + ' ' + test.name);
    if (supported && test.dv) variants[test.dv] = true;
  }

  return {
    supported: variants.p8 || variants.av1,
    variants: variants,
    codecs: results
  };
}

function updateDolbyVisionUI(result) {
  var statusIcon = getEl('dv-status-icon');
  var statusText = getEl('dv-status-text');
  var codecsList = getEl('dv-codecs-list');

  if (!statusIcon || !statusText) return;

  if (result.supported) {
    statusIcon.textContent = '✅';
    statusIcon.style.color = '#4caf50';
    statusText.innerHTML = '<span style="color: #4caf50; font-weight: 600;">Dolby Vision поддерживается</span>';
    statusText.innerHTML += '<div style="font-size: 12px; color: #aaa; margin-top: 4px;">Ваше устройство может воспроизводить контент в Dolby Vision</div>';
  } else {
    statusIcon.textContent = '❌';
    statusIcon.style.color = '#ff6a6a';
    statusText.innerHTML = '<span style="color: #ff6a6a; font-weight: 600;">Dolby Vision НЕ поддерживается</span>';
    statusText.innerHTML += '<div style="font-size: 12px; color: #aaa; margin-top: 4px;">Будет использоваться стандартное HDR или SDR</div>';
  }

  if (codecsList && result.codecs && result.codecs.length > 0) {
    var html = '<div style="color: #888; margin-bottom: 8px;">Поддержка кодеков:</div>';
    for (var i = 0; i < result.codecs.length; i++) {
      var codec = result.codecs[i];
      var icon = codec.supported ? '✅' : '❌';
      var color = codec.supported ? '#4caf50' : '#ff6a6a';
      html += '<div style="margin: 4px 0; color: ' + color + ';">';
      html += icon + ' ' + codec.name;
      html += '</div>';
    }
    codecsList.innerHTML = html;
    codecsList.style.display = 'block';
  }

  if (typeof AppState !== 'undefined') {
    AppState.dolbyVisionSupported = result.supported;
    AppState.supportedCodecs = result.codecs;
  }

  try {
    localStorage.setItem('dolbyVisionSupported', result.supported ? 'true' : 'false');
    localStorage.setItem('supportedCodecs', JSON.stringify(result.codecs));


    localStorage.setItem('dolbyVisionCheckUA', navigator.userAgent);
  } catch (e) {
    console.warn('Не удалось сохранить результаты проверки DV:', e);
  }
}

function initDolbyVisionCheck() {
  var checkBtn = getEl('dv-check-btn');







  var dvSection = getEl('dv-support-section');
  if (dvSection) dvSection.hidden = true;


  var dvOnOffEl = getEl('dvOnOff');
  var dvCheckboxContainer = dvOnOffEl ? dvOnOffEl.closest('.checkbox-container') : null;
  var dvCheckbox = dvOnOffEl;

  var dvSupported = false;
  try {
    var savedSupported = localStorage.getItem('dolbyVisionSupported');
    var savedCodecs = localStorage.getItem('supportedCodecs');
    var savedUA = localStorage.getItem('dolbyVisionCheckUA');
    if (savedSupported !== null && savedCodecs && savedUA === navigator.userAgent) {
      var result = {
        supported: savedSupported === 'true',
        codecs: JSON.parse(savedCodecs)
      };
      updateDolbyVisionUI(result);
      dvSupported = result.supported;
    }
  } catch (e) {
    console.warn('Не удалось загрузить сохранённые результаты DV:', e);
  }

  if (dvCheckboxContainer) {
    if (dvSupported) {
      dvCheckboxContainer.classList.remove('hidden');
      console.log('✅ Dolby Vision поддерживается - чекбокс предпочтения виден');
    } else {
      dvCheckboxContainer.classList.add('hidden');
      console.log('❌ Dolby Vision не поддерживается - чекбокс предпочтения скрыт');
    }
  }

  if (dvCheckbox) {

    var rawDvPreferred = localStorage.getItem('dvPreferred');
    var savedDvPreferred = rawDvPreferred === null ? dvSupported : rawDvPreferred === 'true';
    dvPreferred = savedDvPreferred;
    dvCheckbox.checked = savedDvPreferred;

    if (typeof AppState !== 'undefined') {
      AppState.dvPreferred = dvPreferred;
    }
    console.log('🎬 Предпочтение Dolby Vision:', dvPreferred ? 'включено' : 'выключено');

    dvCheckbox.addEventListener('change', function (e) {
      dvPreferred = e.target.checked;
      try {
        localStorage.setItem('dvPreferred', dvPreferred);
      } catch (err) {
        console.warn('Не удалось сохранить предпочтение DV:', err);
      }

      if (typeof AppState !== 'undefined') {
        AppState.dvPreferred = dvPreferred;
      }

      console.log('🎬 Предпочтение Dolby Vision:', dvPreferred ? 'включено' : 'выключено');

      if (typeof showPlayerHint === 'function') {
        var msg = dvPreferred ?
        '🎬 Dolby Vision будет предпочитаться при наличии' :
        '🎬 Стандартное HDR будет использоваться по умолчанию';
        showPlayerHint(msg);
      }
    });
  }

  if (checkBtn) {
    checkBtn.addEventListener('click', function () {
      checkBtn.disabled = true;
      checkBtn.textContent = 'Проверка...';

      setTimeout(function () {
        try {
          var result = checkDolbyVisionSupport();
          updateDolbyVisionUI(result);

          if (dvCheckboxContainer) {
            if (result.supported) {
              dvCheckboxContainer.classList.remove('hidden');
            } else {
              dvCheckboxContainer.classList.add('hidden');
            }
          }

          if (typeof showPlayerHint === 'function') {
            var msg = result.supported ?
            '✅ Dolby Vision поддерживается на вашем устройстве' :
            '❌ Dolby Vision не поддерживается, будет использоваться HDR/SDR';
            showPlayerHint(msg);
          }
        } catch (e) {
          console.error('Ошибка проверки DV:', e);
          alert('Ошибка при проверке: ' + e.message);
        }
        checkBtn.disabled = false;
        checkBtn.textContent = 'Проверить снова';
      }, 100);
    });
  }
}


(function () {
  function runAutoCheck() {
    try {



      if (localStorage.getItem('dolbyVisionSupported') === 'true' &&
      localStorage.getItem('dolbyVisionCheckUA') === navigator.userAgent) {
        return;
      }
    } catch (e) {

    }

    setTimeout(function () {
      try {
        var result = checkDolbyVisionSupport();
        updateDolbyVisionUI(result);


        var dvOnOffEl = getEl('dvOnOff');
        var dvCheckboxContainer = dvOnOffEl ? dvOnOffEl.closest('.checkbox-container') : null;

        if (dvCheckboxContainer) {
          if (result.supported) {
            dvCheckboxContainer.classList.remove('hidden');
          } else {
            dvCheckboxContainer.classList.add('hidden');
          }
        }



        var rawPref = null;
        try {rawPref = localStorage.getItem('dvPreferred');} catch (e) {}
        if (rawPref === null) {
          dvPreferred = !!result.supported;
          if (typeof AppState !== 'undefined') AppState.dvPreferred = dvPreferred;
          if (dvOnOffEl) dvOnOffEl.checked = dvPreferred;
        }
      } catch (e) {
        console.warn('Ошибка автоматической проверки DV:', e);
      }
    }, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runAutoCheck);
  } else {
    runAutoCheck();
  }
})();

window.checkDolbyVisionSupport = checkDolbyVisionSupport;



window.setupSpeedTest = setupSpeedTest;
window.showPlayerHint = showPlayerHint;
window.updateTimeDisplay = updateTimeDisplay;
window.updatePlayPauseButton = updatePlayPauseButton;
window.updateMuteButton = updateMuteButton;
window.updateBufferDisplay = updateBufferDisplay;
window.forceUpdateDuration = forceUpdateDuration;
window.destroyHls = destroyHls;
window.seekStream = seekStream;
window.checkPlaylistExists = checkPlaylistExists;
window.reloadHlsPlaylist = reloadHlsPlaylist;
window.getFileNameByHash = getFileNameByHash;
window.syncPlayerTitleVisibility = syncPlayerTitleVisibility;
window.updatePlayerTitle = updatePlayerTitle;
window.updateEpisodeButtons = updateEpisodeButtons;
window.showPlayerLoading = showPlayerLoading;
window.hidePlayerLoading = hidePlayerLoading;
window.startTimecodeSaving = startTimecodeSaving;
window.stopTimecodeSaving = stopTimecodeSaving;
window.saveTimecodeToServer = saveTimecodeToServer;
window.loadTimecodeFromServer = loadTimecodeFromServer;
window.clearTimecodeData = clearTimecodeData;
window.startNearEndCheck = startNearEndCheck;
window.exitPlayer = exitPlayer;
window.switchToEpisode = switchToEpisode;
window.toggleEpisodesPanel = toggleEpisodesPanel;
window.renderEpisodesList = renderEpisodesList;
window.toggleAudioPanel = toggleAudioPanel;
window.switchAudioTrack = switchAudioTrack;
window.renderAudioTracks = renderAudioTracks;
window.loadFileInfo = loadFileInfo;
window.saveAudioPreference = saveAudioPreference;
window.loadAudioPreference = loadAudioPreference;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () {
    init();
  });
} else {

  init();
}







if (location.search.indexOf('perf=1') !== -1 && !window.__perfProbe) {
  (function () {
    var s = document.createElement('script');
    s.src = 'js/perf-probe.js?v=' + Date.now();
    document.head.appendChild(s);
  })();
}
