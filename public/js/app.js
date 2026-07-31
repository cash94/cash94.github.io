// app.js - Инициализация приложения и обработчики событий
// ==================== КОНСТАНТЫ ====================
var APP_CONSTANTS = {
  DEBOUNCE_DELAY_MS: 300,
  CHECK_SERVER_TIMEOUT_MS: 500,
  AUTO_REFRESH_INTERVAL_MS: 300000,
  FOCUS_RESTORE_DELAY_MS: 100,
  TOAST_DURATION_MS: 1500,
  IDLE_TIMEOUT_MS: 3000,
  TOUCH_TAP_THRESHOLD_MS: 300,
  TOUCH_MOVE_THRESHOLD_PX: 10,
  INITIAL_CHECK_DELAY_MS: 1000,
  SEEK_RESET_DELAY_MS: 200,
  NAVIGATION_DELAY_MS: 300,
  DETAIL_HIDE_DELAY_MS: 250,
  TORRENT_LOAD_DELAY_MS: 80,
  SEARCH_FOCUS_DELAY_MS: 200,
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
  '#torrserver-tab-content', '#torrents-tab-content', '#player-tab-content', '#sync-tab-content',
  '.menu-item', '.skip-button'
].join(', ');

// ==================== УТИЛИТЫ ====================
function debounce(fn, delay) {
  var timeoutId;
  return function () {
    var context = this, args = arguments;
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

// ==================== СОСТОЯНИЕ ====================
var hideClockEnabled = false;
var addToDbEnabled = false;
var transcodingOnOff = false;
var multiChannelEnabled = false;
var dvPreferred = false;
var detailView = getEl('detail-view');
var controls = document.querySelectorAll('.control-btn, #seek-slider, #volume-slider');

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
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
}

async function init() {
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
}

function setupVideoPlayerControls() {
  var requiredElements = [
    'seek-slider', 'volume-slider', 'play-pause-btn', 'mute-btn',
    'toggle-buffer-btn', 'exit-player-btn', 'player-overlay', 'video-player'
  ];
  var modes = ['contain', 'fill', 'cover', 'none'];
  var modeIndex = 0;
  var video = getEl('video-player');

  if (!video) {
    console.error('Video player element not found');
    return;
  }

  function setVideoObjectFit(mode) {
    video.classList.remove('video-object-fit-contain', 'video-object-fit-fill',
      'video-object-fit-cover', 'video-object-fit-none');
    if (mode === 'contain') video.classList.add('video-object-fit-contain');
    else if (mode === 'fill') video.classList.add('video-object-fit-fill');
    else if (mode === 'cover') video.classList.add('video-object-fit-cover');
    else video.classList.add('video-object-fit-none');
    void video.offsetHeight;
  }

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

  var missingElements = requiredElements.filter(function (el) { return !getEl(el); });
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
  setupBufferUpdateInterval();
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
  document.body.appendChild(toast);
  setTimeout(function () {
    if (toast && toast.remove) toast.remove();
    else if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
  }, APP_CONSTANTS.ZOOM_TOAST_DURATION_MS);
}

// ==================== ПРОВЕРКА ВЕРСИИ ====================
function checkAppVersion() {
  fetch('/api/version')
    .then(function (response) { return response.json(); })
    .then(function (data) {
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
    })
    .catch(function (error) { console.error('❌ Ошибка проверки версии:', error); });
}

// ==================== ОБРАБОТЧИКИ ПЛЕЕРА ====================
function setupSeekSliderEvents(seekSlider, videoPlayer) {
  var currentTimeEl = getEl('current-time');
  var loadingOverlay = getEl('loading-player-overlay');
  var loadingTimeEl = getEl('loading-time');

  // Переменная для отслеживания начального значения ползунка при начале перетаскивания
  var seekStartValue = 0;

  seekSlider.addEventListener('mousedown', function () {
    if (typeof AppState !== 'undefined') {
      AppState.isSliderDragging = true;
      AppState.suppressTimeUpdate = true;
    }
    // Запоминаем значение в момент начала перетаскивания
    seekStartValue = parseFloat(seekSlider.value) || 0;
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });

  seekSlider.addEventListener('touchstart', function () {
    if (typeof AppState !== 'undefined') {
      AppState.isSliderDragging = true;
      AppState.suppressTimeUpdate = true;
    }
    // Запоминаем значение в момент начала перетаскивания
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
      if (typeof AppState !== 'undefined' && (AppState.isSeeking || (loadingOverlay && loadingOverlay.classList.contains('active')))) {
        if (loadingTimeEl) loadingTimeEl.textContent = formatTime(newPreviewTime);
      }

      // ПОКАЗЫВАЕМ ОВЕРЛЕЙ ПЕРЕМОТКИ ПРИ ПЕРЕТАСКИВАНИИ ПОЛЗУНКА
      if (typeof window.showSeekOverlay === 'function') {
        // Определяем направление на основе сравнения с начальным значением
        var direction = newPreviewTime >= seekStartValue ? 1 : -1;
        window.showSeekOverlay(newPreviewTime, direction);
      }
    }
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });

  seekSlider.addEventListener('change', async function (e) {
    var targetAbsoluteTime = parseFloat(e.target.value);
    if (typeof AppState !== 'undefined') {
      AppState.isSliderDragging = false;
      AppState.previewTime = targetAbsoluteTime;
      AppState.suppressTimeUpdate = true;
    }

    // СКРЫВАЕМ ОВЕРЛЕЙ С ЗАДЕРЖКОЙ после окончания перетаскивания
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
      await seekStream(targetAbsoluteTime, 'slider');
    }
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });

  seekSlider.addEventListener('mouseup', function () {
    // СКРЫВАЕМ ОВЕРЛЕЙ С ЗАДЕРЖКОЙ
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
    // СКРЫВАЕМ ОВЕРЛЕЙ С ЗАДЕРЖКОЙ
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
    if (AppState && (AppState.isSeeking || (loadingOverlay && loadingOverlay.classList.contains('active')))) {
      e.preventDefault();
      return;
    }
    if (videoPlayer.paused) {
      videoPlayer.play().then(function () {
        if (typeof updatePlayPauseButton === 'function') updatePlayPauseButton();
      }).catch(function () { });
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
    if (AppState && (AppState.isSeeking || (loadingOverlay && loadingOverlay.classList.contains('active')))) return;
    videoPlayer.muted = !videoPlayer.muted;
    if (typeof updateMuteButton === 'function') updateMuteButton();
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });
}

function setupVolumeSlider(volumeSlider, videoPlayer) {
  volumeSlider.addEventListener('input', function (e) {
    var loadingOverlay = getEl('loading-player-overlay');
    if (AppState && (AppState.isSeeking || (loadingOverlay && loadingOverlay.classList.contains('active')))) return;
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
      var totalDuration = (AppState && (AppState.originalDuration || AppState.expectedDuration)) || videoPlayer.duration;
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

function setupBufferUpdateInterval() {
  setInterval(function () {
    if (AppState && AppState.currentScreen === 'player' && !AppState.bufferHidden && !AppState.isSeeking) {
      if (typeof updateBufferDisplay === 'function') updateBufferDisplay();
    }
  }, 300);
}

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
      if (overlay.classList.contains('touch-active')) overlay.classList.remove('touch-active');
      else showControls();
    } else showControls();
    lastTap = currentTime;
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });
}

// ==================== НАВИГАЦИЯ ====================
function setupNavigation() {
  var settingsBtn = getEl('settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', function () {
      var torrserverSection = getEl('torrserver-section');
      var configScreen = getEl('config-screen');
      if (torrserverSection) torrserverSection.style.display = 'none';
      if (configScreen) configScreen.style.display = 'flex';
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
      var mainContainer = getEl('main-container');
      resetDetailBackground();

      var currentTorrentHash = AppState && AppState.currentDetailItem ? AppState.currentDetailItem.hash : null;
      console.log('🔍 Hash для восстановления:', currentTorrentHash);

      if (window.AndroidJS || AppState.transcodingFullOnOff) {
        if (AppState.searchResultsHidden) {
          var searchOverlay = getEl('search-overlay');
          if (searchOverlay) searchOverlay.classList.remove('hidden');
          AppState.searchResultsHidden = false;
        }
      }

      if (AppState && !AppState.isSearch && !AppState.playFromHash && detailHistory.length <= 1) {
        if (detailView) detailView.style.display = 'none';
      }
      if (mainContainer) mainContainer.style.pointerEvents = 'auto';

      var torrserverSection = getEl('torrserver-section');
      if (torrserverSection) torrserverSection.style.display = 'block';
      if (typeof AppState !== 'undefined') AppState.detailReturnTo = AppState.inSearch;

      var returnTo = (!AppState || !AppState.isSearch)
        ? ((AppState && AppState.detailReturnTo === 'catalog') ? 'catalog' : 'torrents')
        : 'search';

      console.log('📍 returnTo =', returnTo);

      setTimeout(function () {
        if (typeof updateFocusableElements !== 'function' || typeof setFocus !== 'function') {
          console.error('❌ Функции навигации еще не загружены');
          return;
        }

        if (detailHistory.length > 1) {
          detailHistory.pop();
          var lastItem = detailHistory[detailHistory.length - 1];
          window.showCatalogDetail(lastItem, 0, null);
          console.log('🔙 Возврат к элементу:', lastItem.title || lastItem.name);
          return;
        } else {
          clearDetailHistory();
        }

        restoreFocusAfterNavigation(returnTo, { currentTorrentHash: currentTorrentHash });

        if (typeof Animations !== 'undefined') Animations.animateDetailHide();
      }, APP_CONSTANTS.DETAIL_HIDE_DELAY_MS);
    });
    AppState.isCatalogSearch = false;
  }
}

function restoreFocusAfterNavigation(returnTo, context) {
  if (returnTo === 'catalog' && AppState.playFromHash && AppState.isCatalogSerials) {
    AppState.playFromHash = false;
    AppState.isCatalogSerials = false;
    window.loadCatalog(AppState.backCurrentCatalog).then(function () {
      window.showCatalogDetail(AppState.androidBackCatalog, AppState.catalogIndex, AppState.catalogPu);
    });
    return;
  }

  if (returnTo === 'catalog') {
    AppState.backupScroll = 0;
    AppState.currentScreen = 'catalog';
    if (detailView) detailView.style.display = 'none';

    if (typeof isCatalogRowsMode === 'function' && isCatalogRowsMode()) {
      restoreRowFocus();
      return;
    }

    // Режим сетки (открыт конкретный каталог) — как раньше
    if (typeof window.ensureCatalogFocus === 'function') {
      window.ensureCatalogFocus(true);
      return;
    }
    if (typeof window.focusFirstCatalogCard === 'function') {
      window.focusFirstCatalogCard();
      return;
    }
  }

  if (returnTo === 'search') {
    if (AppState && AppState.isSearch) {
      if (typeof AppState !== 'undefined') AppState.isSearch = false;
      if (typeof window.showSearchResults === 'function') window.showSearchResults();
    } else {
      if (typeof window.clearSearchResults === 'function') window.clearSearchResults();
    }
    if (detailView) detailView.style.display = 'none';
    return;
  }

  if (returnTo === 'torrents') {
    if (typeof window.clearSearchResultsContainer === 'function') window.clearSearchResultsContainer();
    if (typeof AppState !== 'undefined') AppState.currentScreen = 'torrents';
    torrentsGrid = getEl('torrents-grid');
    if (torrentsGrid) torrentsGrid.style.display = 'grid';

    if (context.currentTorrentHash) {
      window.lastSelectedTorrentHash = context.currentTorrentHash;
      console.log('💾 Сохранен hash для восстановления:', context.currentTorrentHash);
    }

    updateFocusableElements();

    if (typeof window.ensureTorrentFocus === 'function') {
      window.ensureTorrentFocus(true);
      if (detailView) detailView.style.display = 'none';
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
    if (detailView) detailView.style.display = 'none';
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

// ==================== ПОИСК ====================
function setupSearch() {
  var searchInput = getEl('search-query');
  var searchBtn = getEl('search-btn');
  var closeSearchBtn = getEl('close-search');
  var tabTorrents = getEl('tab-torrents');
  var tabSearch = getEl('tab-search');
  var tabCatalog = getEl('tab-catalog');

  if (searchBtn && searchInput) {
    searchBtn.addEventListener('click', function () {
      var query = searchInput.value.trim();
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
      // Цепочка: карточка каталога → поиск → detail.
      // Если вернулись из detail в поиск — закрытие открывает карточку обратно
      if (AppState && AppState.openCatalogDetailOnSearchClose) {
        var catalogItem = AppState.openCatalogDetailOnSearchClose;
        AppState.openCatalogDetailOnSearchClose = null;
        AppState.searchReturnTo = null;
        if (catalogItem && catalogItem.id && typeof window.showCatalogDetail === 'function') {
          var searchOverlay = getEl('search-overlay');
          if (searchOverlay) searchOverlay.classList.add('hidden');
          window.showCatalogDetail(catalogItem, AppState.catalogIndex || 0, AppState.catalogPu || null);
          return;
        }
        // пришли не из карточки каталога — обычное закрытие
      }
      hideSearchResults();
    });
  }

  if (tabTorrents && typeof hideSearchResults === 'function' && typeof loadTorrents === 'function') {
    tabTorrents.addEventListener('click', function () {
      if (!tabTorrents.classList.contains('active')) {
        console.log('📁 Переключение на вкладку "Мои торренты"');
        window.pendingCatalogPoster = null;
        window.pendingCatalogItem = null;
        if (typeof AppState !== 'undefined') AppState.inSearch = 'torrents';
        hideSearchResults();
        tabTorrents.classList.add('active');
        if (tabSearch) tabSearch.classList.remove('active');
        if (tabCatalog) tabCatalog.classList.remove('active');
        var searchOverlay = getEl('search-overlay');
        if (searchOverlay) searchOverlay.classList.add('hidden');
        if (typeof AppState !== 'undefined') AppState.currentScreen = 'torrents';
        var torrentsGrid = getEl('torrents-grid');
        if (torrentsGrid) {
          torrentsGrid.style.display = 'grid';
          torrentsGrid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;"><div class="loading-spinner" style="margin: 0 auto 20px;"></div><div style="font-size: 16px; color: #aaa;">Загрузка торрентов...</div></div>';
        }
        loadTorrents(true).catch(function (error) {
          console.error('Ошибка загрузки торрентов:', error);
          if (torrentsGrid) {
            torrentsGrid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;"><div style="font-size: 48px; margin-bottom: 20px;">❌</div><div style="font-size: 16px; color: #ff6a6a;">Ошибка загрузки торрентов</div><button class="btn" style="margin-top: 20px;" onclick="getEl(\'tab-torrents\').click()">Попробовать снова</button></div>';
          }
        });
      }
    });
  }

  if (tabSearch && typeof showSearchResults === 'function') {
    tabSearch.addEventListener('click', function () {
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
        }
        localStorage.removeItem('lastCatalogCardIndex');
        if (typeof hideSearchResults === 'function') hideSearchResults();
        var searchOverlay = getEl('search-overlay');
        if (searchOverlay) searchOverlay.classList.add('hidden');
        var tabTorrentsEl = getEl('tab-torrents');
        var tabSearchEl = getEl('tab-search');
        if (tabTorrentsEl) tabTorrentsEl.classList.remove('active');
        if (tabSearchEl) tabSearchEl.classList.remove('active');
        tabCatalog.classList.add('active');
        if (typeof AppState !== 'undefined') AppState.currentScreen = 'catalog';
        window.loadCatalogList();
      }
    });
  }
}

// ==================== ФИЛЬТРЫ ПОИСКА ====================
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
            filterToggleBtn.classList.add('active');
            opened = true;
          } else {
            panel.classList.add('collapsed');
            filterToggleBtn.classList.remove('active');
            opened = false;
          }
        }
      }
      if (opened && typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
        setTimeout(function () {
          updateFocusableElements();
          var firstFilterIndex = -1;
          var fLen = focusableElements.length;
          for (var i = 0; i < fLen; i++) {
            var el = focusableElements[i];
            if (el && el.id) {
              var elId = el.id;
              if (['torrent-movie', 'sort-by', 'filter-quality', 'filter-tracker', 'filter-year', 'reset-filters'].indexOf(elId) !== -1) {
                firstFilterIndex = i;
                break;
              }
            }
          }
          console.log('Первый фильтр индекс:', firstFilterIndex);
          if (firstFilterIndex !== -1) setFocus(firstFilterIndex);
        }, APP_CONSTANTS.FILTER_PANEL_DELAY_MS);
      }
    });
  }

  var filterConfigs = [
    { el: torrentmovie, setter: function (v) { if (typeof currentSort !== 'undefined') currentSort = v; } },
    { el: sortBy, setter: function (v) { if (typeof currentSort !== 'undefined') currentSort = v; } },
    { el: filterQuality, setter: function (v) { if (typeof currentQualityFilter !== 'undefined') currentQualityFilter = v; } },
    { el: filterTracker, setter: function (v) { if (typeof currentTrackerFilter !== 'undefined') currentTrackerFilter = v; } },
    { el: filterYear, setter: function (v) { if (typeof currentYearFilter !== 'undefined') currentYearFilter = v; } },
    { el: filterSeason, setter: function (v) { if (typeof currentSeasonFilter !== 'undefined') currentSeasonFilter = v; } },
    { el: filterVoice, setter: function (v) { if (typeof currentVoiceFilter !== 'undefined') currentVoiceFilter = v; } },
    { el: filtervideotype, setter: function (v) { if (typeof currentvideotypeFilter !== 'undefined') currentvideotypeFilter = v; } }
  ];

  filterConfigs.forEach(function (config) {
    if (config.el) {
      config.el.addEventListener('change', createFilterHandler(config.setter));
    }
  });

  if (resetFiltersBtn && typeof resetFilters === 'function') {
    resetFiltersBtn.addEventListener('click', resetFilters);
  }
}

// ==================== ПРОВЕРКА СЕРВЕРА ====================
function setupServerCheck() {
  var torrserverUrl = getEl('torrserver-url');
  if (torrserverUrl) {
    var debouncedCheck = debounce(function () {
      if (typeof checkServer === 'function') checkServer(true);
    }, APP_CONSTANTS.DEBOUNCE_DELAY_MS);
    torrserverUrl.addEventListener('input', debouncedCheck);
  }
}

// ==================== АВТОРИЗАЦИЯ ====================
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
        if (AppState && AppState.authEnabled) authFields.classList.add('visible');
        else authFields.classList.remove('visible');
      }
      setTimeout(debouncedCheckAuth, APP_CONSTANTS.CHECK_SERVER_TIMEOUT_MS);
    });
  }

  if (authLogin) authLogin.addEventListener('input', debouncedCheckAuth);
  if (authPassword) authPassword.addEventListener('input', debouncedCheckAuth);
}

// ==================== АВТОСКРЫТИЕ ПЛЕЕРА ====================
function setupPlayerAutoHide() {
  var playerScreen = getEl('player-screen');
  if (playerScreen && typeof resetMouseIdleTimer === 'function') {
    playerScreen.addEventListener('mousemove', resetMouseIdleTimer);
    playerScreen.addEventListener('mousedown', resetMouseIdleTimer);
    playerScreen.addEventListener('mouseenter', resetMouseIdleTimer);
  }
  if (typeof resetMouseIdleTimer === 'function') {
    var cLen = controls.length;
    for (var i = 0; i < cLen; i++) {
      var control = controls[i];
      control.addEventListener('mouseenter', resetMouseIdleTimer);
      control.addEventListener('mousedown', resetMouseIdleTimer);
    }
  }
}

// ==================== СЕНСОРНОЕ УПРАВЛЕНИЕ ====================
function setupTouchControls(seekSlider, volumeSlider) {
  var touchTarget = null;
  var touchStartX = 0;
  var touchStartY = 0;
  var touchStartTime = 0;
  var touchMoved = false;
  var observer = null;

  function setupTouchButtons() {
    var clickableElements = document.querySelectorAll(CLICKABLE_SELECTORS);
    var elLen = clickableElements.length;
    for (var i = 0; i < elLen; i++) {
      var el = clickableElements[i];
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchCancel);
      el.addEventListener('touchstart', handleTouchStart, { passive: true });
      el.addEventListener('touchend', handleTouchEnd, { passive: true });
      el.addEventListener('touchcancel', handleTouchCancel, { passive: true });
    }
  }

  function handleTouchStart(e) {
    var target = e.target;
    var isInSearchOverlay = target.closest && target.closest('#search-overlay');
    var isCloseBtn = target.id === 'close-search' || (target.closest && target.closest('#close-search'));
    var isFilterBtn = target.id === 'filter-toggle' || (target.closest && target.closest('#filter-toggle'));
    if ((isCloseBtn || isFilterBtn) && isInSearchOverlay) return;

    touchTarget = e.target;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartTime = Date.now();
    touchMoved = false;

    if (touchTarget.closest('button') || touchTarget.closest('.control-btn')) {
      touchTarget.classList.add('touch-active');
    }
  }

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
        targetToClick.id === 'close-search' ||
        targetToClick.id === 'filter-toggle' ||
        targetToClick.id === 'search-btn'
      )) {
        e.stopPropagation();
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

  if (seekSlider) {
    seekSlider.addEventListener('touchstart', function (e) {
      e.stopPropagation();
      if (typeof AppState !== 'undefined') {
        AppState.isSliderDragging = true;
        AppState.suppressTimeUpdate = true;
      }
    }, { passive: true });
    seekSlider.addEventListener('touchmove', function (e) { e.stopPropagation(); }, { passive: true });
    seekSlider.addEventListener('touchend', function (e) {
      e.stopPropagation();
      if (typeof AppState !== 'undefined') AppState.isSliderDragging = false;
      setTimeout(function () {
        if (typeof AppState !== 'undefined') AppState.suppressTimeUpdate = false;
      }, 100);
    }, { passive: true });
  }

  if (volumeSlider) {
    volumeSlider.addEventListener('touchstart', function (e) { e.stopPropagation(); }, { passive: true });
    volumeSlider.addEventListener('touchmove', function (e) { e.stopPropagation(); }, { passive: true });
    volumeSlider.addEventListener('touchend', function (e) { e.stopPropagation(); }, { passive: true });
  }

  setupTouchButtons();

  // Исправление утечки памяти: observer теперь отключается при необходимости
  observer = new MutationObserver(function (mutations) {
    // Проверяем, действительно ли добавлены новые кликабельные элементы
    var hasNewClickable = mutations.some(function (mutation) {
      return Array.from(mutation.addedNodes).some(function (node) {
        return node.nodeType === 1 && node.matches && node.matches(CLICKABLE_SELECTORS);
      });
    });
    if (hasNewClickable) setupTouchButtons();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Сохраняем observer для возможного отключения
  window._touchObserver = observer;
}

// ==================== ПОЛНОЭКРАННЫЙ РЕЖИМ ====================
function setupFullscreen() {
  var fullscreenBtn = getEl('fullscreen-btn');
  if (!fullscreenBtn) return;
  var playerScreen = getEl('player-screen');

  function toggleFullscreen() {
    var isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
    if (!isFullscreen) {
      var element = playerScreen || document.documentElement;
      if (element.requestFullscreen) element.requestFullscreen();
      else if (element.webkitRequestFullscreen) element.webkitRequestFullscreen();
      else if (element.mozRequestFullScreen) element.mozRequestFullScreen();
      else if (element.msRequestFullscreen) element.msRequestFullscreen();
      fullscreenBtn.innerHTML = '<i class="fi fi-rr-compress"></i>';
      fullscreenBtn.title = 'Выйти из полноэкранного режима';
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
      else if (document.msExitFullscreen) document.msExitFullscreen();
      fullscreenBtn.innerHTML = '<i class="fi fi-rr-expand"></i>';
      fullscreenBtn.title = 'Полный экран';
    }
  }

  function updateFullscreenIcon() {
    var isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
    fullscreenBtn.innerHTML = isFullscreen ? '<i class="fi fi-rr-compress"></i>' : '<i class="fi fi-rr-expand"></i>';
    fullscreenBtn.title = isFullscreen ? 'Выйти из полноэкранного режима' : 'Полный экран';
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
      if (element.requestFullscreen) element.requestFullscreen();
      else if (element.webkitRequestFullscreen) element.webkitRequestFullscreen();
      else if (element.mozRequestFullScreen) element.mozRequestFullScreen();
      else if (element.msRequestFullscreen) element.msRequestFullscreen();
    }
  });

  function enterFullscreenIfEnabled() {
    var autoFullscreen = localStorage.getItem('autoFullscreen') === 'true';
    if (autoFullscreen) {
      setTimeout(function () {
        var element = document.documentElement;
        if (element.requestFullscreen) element.requestFullscreen();
        else if (element.webkitRequestFullscreen) element.webkitRequestFullscreen();
        else if (element.mozRequestFullScreen) element.mozRequestFullScreen();
        else if (element.msRequestFullscreen) element.msRequestFullscreen();
      }, 500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enterFullscreenIfEnabled);
  } else {
    enterFullscreenIfEnabled();
  }
}

// ==================== ЧЕКБОКСЫ ====================
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
  // 1. Внешний плеер
  setupExternalPlayerCheckbox();
  var container = '';

  // 2. Скрытие часов
  var hideClockCheckbox = getEl('hide-clock');
  if (window.AndroidJS) {
    container = hideClockCheckbox.closest('.checkbox-container');
    if (container) container.classList.add('hidden');
  }
  if (hideClockCheckbox) {
    var savedHideClock = localStorage.getItem('hideClockEnabled') === 'true';
    hideClockEnabled = savedHideClock;
    hideClockCheckbox.checked = savedHideClock;
    hideClockCheckbox.addEventListener('change', function (e) {
      hideClockEnabled = e.target.checked;
      localStorage.setItem('hideClockEnabled', hideClockEnabled);
      setupClockVisibility();
      console.log('🕐 Скрытие часов:', hideClockEnabled ? 'включено' : 'выключено');
    });
  }

  // 3. Добавление в базу
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

  // 4. Транскодирование
  var transcodingCheckbox = getEl('transcoding-off');
  if (window.AndroidJS) {
    container = transcodingCheckbox.closest('.checkbox-container');
    if (container) container.classList.add('hidden');
  }
  if (transcodingCheckbox) {
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

  // 5. Многоканальный звук
  var multiChannelCheckbox = getEl('multi-channel-audio');
  if (window.AndroidJS) {
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

  // 6. Включить или отключить полностью транскодинг
  var transcodingCheckboxOnOff = getEl('transcoding-on-off');
  if (window.AndroidJS) {
    container = transcodingCheckboxOnOff.closest('.checkbox-container');
    if (container) container.classList.add('hidden');
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

  if (!window.AndroidJS) {
    // 7. Инициализация проверки Dolby Vision (безопасный вызов)
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

// ==================== МЕНЮ КОНФИГУРАЦИИ ====================
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

// ==================== ОШИБКИ ====================
function showInitError() {
  var errorDiv = document.createElement('div');
  errorDiv.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.9); color: #ff6a6a; padding: 20px; border-radius: 12px; text-align: center; z-index: 10000; border: 1px solid #ff6a6a;';
  errorDiv.innerHTML = '<div style="font-size: 48px; margin-bottom: 10px;">⚠️</div>' +
    '<div style="margin-bottom: 10px;">Ошибка инициализации приложения</div>' +
    '<div style="font-size: 12px; color: #aaa;">Попробуйте обновить страницу</div>' +
    '<button onclick="location.reload()" style="margin-top: 15px; padding: 8px 20px; background: #4a9eff; border: none; border-radius: 6px; color: white; cursor: pointer;">Обновить</button>';
  document.body.appendChild(errorDiv);
}

// ==================== МЫШЬ И ИНТЕРФЕЙС ====================
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

// ==================== ТЕСТ СКОРОСТИ ====================
function setupSpeedTest() {
  var speedtestBtn = getEl('speedtest-btn');
  if (!speedtestBtn) return;

  speedtestBtn.addEventListener('click', async function () {
    console.log('📡 Запуск замера скорости...');
    var torrserverUrlInput = getEl('torrserver-url');
    var torrServerUrl = torrserverUrlInput ? torrserverUrlInput.value.trim() : '';

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
      await SpeedTest.run(torrServerUrl);
    } else {
      console.error('❌ Модуль SpeedTest не загружен');
      var resultsDiv = getEl('speedtest-results');
      if (resultsDiv) {
        resultsDiv.style.display = 'block';
        resultsDiv.innerHTML = '<div style="color: #ff4e4e;">❌ Модуль замера скорости не загружен. Обновите страницу.</div>';
      }
    }
  });
}

// ==================== JACRED URL ====================
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
// ==================== ПРОВЕРКА DOLBY VISION ====================
function checkDolbyVisionSupport() {
  // Проверка для старых браузеров
  if (typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported) {
    console.log('⚠️ MediaSource не поддерживается');
    return {
      supported: false,
      codecs: []
    };
  }

  var tests = [
    { name: 'HEVC Main 10', codec: 'video/mp4; codecs="hvc1.2.4.L150.B0"' },
    { name: 'H.264 (AVC)', codec: 'video/mp4; codecs="avc1.640028"' },
    { name: 'Dolby Vision Profile 5', codec: 'video/mp4; codecs="dvh1.05.01"' },
    { name: 'Dolby Vision Profile 8 (HEVC)', codec: 'video/mp4; codecs="dvh1.08.06"' },
    { name: 'HDR10 (HEVC)', codec: 'video/mp4; codecs="hvc1.2.4.L150.B0"' },
    { name: 'AV1 Main', codec: 'video/mp4; codecs="av01.0.08M.08"' }
  ];

  var results = [];
  var dvSupported = false;

  console.log('🔍 Проверка поддержки кодеков:');
  for (var i = 0; i < tests.length; i++) {
    var test = tests[i];
    var supported = MediaSource.isTypeSupported(test.codec);
    results.push({
      name: test.name,
      codec: test.codec,
      supported: supported
    });
    console.log('   ' + (supported ? '✅' : '❌') + ' ' + test.name + ': ' + (supported ? 'поддерживается' : 'НЕ поддерживается'));

    if (test.name.indexOf('Dolby Vision Profile 8') !== -1 && supported) {
      dvSupported = true;
    }
  }

  return {
    supported: dvSupported,
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
  } catch (e) {
    console.warn('Не удалось сохранить результаты проверки DV:', e);
  }
}

function initDolbyVisionCheck() {
  var checkBtn = getEl('dv-check-btn');

  // ИСПРАВЛЕНО: убран Optional Chaining (?.)
  var dvOnOffEl = getEl('dvOnOff');
  var dvCheckboxContainer = dvOnOffEl ? dvOnOffEl.closest('.checkbox-container') : null;
  var dvCheckbox = dvOnOffEl;

  var dvSupported = false;
  try {
    var savedSupported = localStorage.getItem('dolbyVisionSupported');
    var savedCodecs = localStorage.getItem('supportedCodecs');
    if (savedSupported !== null && savedCodecs) {
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
    var savedDvPreferred = localStorage.getItem('dvPreferred') === 'true';
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
        var msg = dvPreferred
          ? '🎬 Dolby Vision будет предпочитаться при наличии'
          : '🎬 Стандартное HDR будет использоваться по умолчанию';
        showPlayerHint(msg);
      }
    });
  }

  if (checkBtn) {
    checkBtn.addEventListener('click', function () {
      checkBtn.disabled = true;
      checkBtn.textContent = '⏳ Проверка...';

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
            var msg = result.supported
              ? '✅ Dolby Vision поддерживается на вашем устройстве'
              : '❌ Dolby Vision не поддерживается, будет использоваться HDR/SDR';
            showPlayerHint(msg);
          }
        } catch (e) {
          console.error('Ошибка проверки DV:', e);
          alert('Ошибка при проверке: ' + e.message);
        }
        checkBtn.disabled = false;
        checkBtn.textContent = '🔄 Проверить снова';
      }, 100);
    });
  }
}

// Автоматическая проверка при загрузке (один раз)
(function () {
  function runAutoCheck() {
    try {
      if (localStorage.getItem('dolbyVisionSupported')) {
        return; // Уже есть сохранённые результаты
      }
    } catch (e) {
      // localStorage недоступен
    }

    setTimeout(function () {
      try {
        var result = checkDolbyVisionSupport();
        updateDolbyVisionUI(result);

        // ИСПРАВЛЕНО: убран Optional Chaining
        var dvOnOffEl = getEl('dvOnOff');
        var dvCheckboxContainer = dvOnOffEl ? dvOnOffEl.closest('.checkbox-container') : null;

        if (dvCheckboxContainer) {
          if (result.supported) {
            dvCheckboxContainer.classList.remove('hidden');
          } else {
            dvCheckboxContainer.classList.add('hidden');
          }
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


// ==================== ЭКСПОРТ ====================
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
  // DOM уже готов (скрипт загружен асинхронно) — запускаем сразу
  init();
}
