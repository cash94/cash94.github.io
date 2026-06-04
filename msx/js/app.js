// app.js - Инициализация приложения и обработчики событий
document.addEventListener('DOMContentLoaded', function () {
  init();
});

var checkServerTimeout = null;
var hideClockEnabled = false;
var addToDbEnabled = false;
var multiChannelEnabled = false;
var clickableElements = document.querySelectorAll(
  'button, .control-btn, .play-btn, .torrent-card, .file-item, ' +
  '.search-result-item, .back-btn, .settings-btn, .view-tab, ' +
  '#play-pause-btn, #mute-btn, #prev-episode-btn, #next-episode-btn, ' +
  '#episodes-btn, #audio-btn, #exit-player-btn, #toggle-buffer-btn, ' +
  '.episode-item, .audio-item, .close-panel-btn, .filter-select, ' +
  '.filter-reset-btn, .progress-continue-btn, .detail-progress-btn, ' +
  '#close-search, #filter-toggle, #search-btn'
);

var controls = document.querySelectorAll('.control-btn, #seek-slider, #volume-slider');
var controlBtns = document.querySelectorAll('.control-btn');

// Функция для начальной проверки сервера
function initialServerCheck() {
  setTimeout(function () {
    var torrserverUrlInput = getEl('torrserver-url');
    if (torrserverUrlInput && torrserverUrlInput.value && torrserverUrlInput.value.trim() !== '') {
      console.log('🔍 Автоматическая проверка сервера...');
      if (typeof checkServer === 'function') {
        checkServer(true);
      }
    } else {
      console.log('ℹ️ URL сервера не задан, пробуем использовать SERVER_URL с портом 8090');
      try {
        var serverUrl = SERVER_URL;
        var urlObj = new URL(serverUrl);
        urlObj.port = '8090';
        var torrserverUrl = urlObj.toString().replace(/\/$/, '');

        console.log('🔄 Автоматически установлен URL TorrServer:', torrserverUrl);

        if (torrserverUrlInput) {
          torrserverUrlInput.value = torrserverUrl;
        }

        if (typeof checkServer === 'function') {
          checkServer(true);
        }
      } catch (error) {
        console.error('❌ Ошибка при парсинге SERVER_URL:', error);
      }
    }
  }, 1000);
}

async function init() {
  try {
    console.log('🚀 Начало инициализации приложения');
    //if (typeof Animations !== 'undefined') {
      //Animations.init();
      //setTimeout(function () {
        //Animations.addCardHoverAnimation('.torrent-card');
        //Animations.addCardHoverAnimation('.catalog-card');
        //Animations.addCardHoverAnimation('.catalog-folder-card');
      //}, 1000);
    //}

    try {
      await loadClientConfig();
    } catch (error) {
      console.error('❌ Ошибка загрузки конфигурации:', error);
    }

    checkAppVersion();

    if (!window.AndroidJS) {

      var requiredElements = [
        'seek-slider', 'volume-slider', 'play-pause-btn', 'mute-btn',
        'toggle-buffer-btn', 'exit-player-btn', 'player-overlay', 'video-player'
      ];

      var modes = ['contain', 'fill', 'cover', 'none'];
      var modeIndex = 0;
      var video = getEl('video-player');

      // Проверка, что видео существует
      if (!video) {
        console.error('Video player element not found');
        return;
      }

      function setVideoObjectFit(mode) {
        // Удаляем все классы
        video.classList.remove('video-object-fit-contain', 'video-object-fit-fill',
          'video-object-fit-cover', 'video-object-fit-none');

        // Добавляем новый класс
        if (mode === 'contain') video.classList.add('video-object-fit-contain');
        else if (mode === 'fill') video.classList.add('video-object-fit-fill');
        else if (mode === 'cover') video.classList.add('video-object-fit-cover');
        else video.classList.add('video-object-fit-none');

        // Для Vidaa 9 - принудительный рефлоу (помогает применить стиль)
        void video.offsetHeight;
      }

      // Устанавливаем начальный режим (contain)
      setVideoObjectFit('fill');

      var zoomBtn = getEl('zoom-mode-btn');
      if (zoomBtn) {
        zoomBtn.onclick = function () {
          modeIndex = (modeIndex + 1) % modes.length;
          setVideoObjectFit(modes[modeIndex]);

          // Всплывашка с совместимым удалением
          var modeNames = {
            'contain': 'С полосами',
            'fill': 'Растянуть',
            'cover': 'Обрезка',
            'none': 'Оригинал'
          };

          var toast = document.createElement('div');
          toast.textContent = modeNames[modes[modeIndex]];
          toast.style.cssText = 'position:fixed;bottom:20%;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:white;padding:8px 16px;border-radius:8px;z-index:9999;font-size:14px;pointer-events:none;';
          document.body.appendChild(toast);

          setTimeout(function () {
            if (toast && toast.remove) {
              toast.remove();
            } else if (toast && toast.parentNode) {
              toast.parentNode.removeChild(toast);
            }
          }, 1500);
        };
      } else {
        console.warn('Zoom mode button not found');
      }

      var missingElements = [];
      var reqLen = requiredElements.length;
      for (var i = 0; i < reqLen; i++) {
        if (!getEl(requiredElements[i])) {
          missingElements.push(requiredElements[i]);
        }
      }
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
      var videoPlayer = getEl('video-player');

      if (seekSlider) {
        seekSlider.value = 0;
        seekSlider.max = 100;
      }
      if (volumeSlider) {
        volumeSlider.value = 1;
      }

      var ua = navigator.userAgent ? navigator.userAgent.toLowerCase() : '';
      var body = document.body;
      if (body) {
        if (window.MSX || ua.indexOf('msx') !== -1) {
          body.classList.add('msx');
        } else {
          body.classList.remove('msx');
        }
      }

      if (seekSlider) {
        setupSeekSliderEvents(seekSlider, videoPlayer);
      }
      if (playPauseBtn && videoPlayer) {
        setupPlayPauseButton(playPauseBtn, videoPlayer);
      }
      if (muteBtn && videoPlayer && volumeSlider) {
        setupMuteButton(muteBtn, videoPlayer, volumeSlider);
      }
      if (volumeSlider && videoPlayer) {
        setupVolumeSlider(volumeSlider, videoPlayer);
      }
      if (exitPlayerBtn) {
        setupExitButton(exitPlayerBtn);
      }

      if (typeof setupEpisodesButton === 'function') {
        setupEpisodesButton();
      } else {
        console.warn('⚠️ setupEpisodesButton не определена');
      }
      if (typeof setupAudioButton === 'function') {
        setupAudioButton();
      } else {
        console.warn('⚠️ setupAudioButton не определена');
      }

      setupEpisodeNavigation();

      if (videoPlayer) {
        setupVideoEvents(videoPlayer, volumeSlider, seekSlider);
      }

      setupBufferUpdateInterval();

      if (toggleBufferBtn) {
        setupToggleBufferButton(toggleBufferBtn);
      }
      if (overlay) {
        setupOverlayControls(overlay);
      }

      var savedVolume = localStorage.getItem('playerVolume');
      if (savedVolume !== null && videoPlayer) {
        videoPlayer.volume = parseFloat(savedVolume);
        if (volumeSlider) volumeSlider.value = videoPlayer.volume;
      }
      setupClockVisibility();
    }

    setupNavigation();
    setupSearch();
    setupSearchFilters();
    setupServerCheck();
    setupAuth();
    setupPlayerAutoHide();
    setupTouchControls(seekSlider, volumeSlider);
    setupAutoRefresh();
    setupFullscreen();
    setupAutoFullscreen();
    setupSpeedTest();

    if (typeof initSearchModeToggle === 'function') {
      initSearchModeToggle();
    }

    initialServerCheck();
    setupCheckboxes();


    if (typeof AppState !== 'undefined') {
      AppState.addToDbEnabled = addToDbEnabled;
      AppState.multiChannelEnabled = multiChannelEnabled;
      console.log('📦 AppState.addToDbEnabled =', AppState.addToDbEnabled);
      console.log('🎵 AppState.multiChannelEnabled =', AppState.multiChannelEnabled);
    }

    console.log('✅ Инициализация приложения завершена');
  } catch (error) {
    console.error('❌ Критическая ошибка при инициализации:', error);
    showInitError();
  }
}

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function checkAppVersion() {
  fetch('/api/version')
    .then(function (response) {
      return response.json();
    })
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
  ['catch'](function (error) {
    console.error('❌ Ошибка проверки версии:', error);
  });
}

function setupSeekSliderEvents(seekSlider, videoPlayer) {
  var currentTimeEl = getEl('current-time');
  var loadingOverlay = getEl('loading-player-overlay');
  var loadingTimeEl = getEl('loading-time');

  seekSlider.addEventListener('mousedown', function () {
    if (typeof AppState !== 'undefined') {
      AppState.isSliderDragging = true;
      AppState.suppressTimeUpdate = true;
    }
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });
  seekSlider.addEventListener('touchstart', function () {
    if (typeof AppState !== 'undefined') {
      AppState.isSliderDragging = true;
      AppState.suppressTimeUpdate = true;
    }
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

    var btnLen = controlBtns.length;
    for (var i = 0; i < btnLen; i++) {
      var btn = controlBtns[i];
      btn.style.pointerEvents = 'none';
      btn.style.opacity = '0.5';
    }

    if (typeof seekStream === 'function') {
      await seekStream(targetAbsoluteTime, 'slider');
    }
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });
  seekSlider.addEventListener('mouseup', function () {
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
      })['catch'](function () { });
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
    if (typeof showDetailView === 'function') showDetailView();
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
    if (typeof window.exitPlayer === 'function') {
      window.exitPlayer();
    }
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
  videoPlayer.addEventListener('volumechange', function () {
    if (volumeSlider) volumeSlider.value = videoPlayer.volume;
    if (typeof updateMuteButton === 'function') updateMuteButton();
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
    localStorage.setItem('playerVolume', videoPlayer.volume);
  });
  videoPlayer.addEventListener('timeupdate', function () {
    if (typeof isSeekHoldActive !== 'undefined' && isSeekHoldActive) return;
    if (AppState && (AppState.isSliderDragging || AppState.suppressTimeUpdate)) return;

    var totalDuration = (AppState && (AppState.originalDuration || AppState.expectedDuration)) || videoPlayer.duration;
    if (totalDuration && isFinite(totalDuration) && totalDuration > 0) {
      if (seekSlider) seekSlider.max = totalDuration;
      var absoluteTime = videoPlayer.currentTime + (AppState && AppState.seekOffset || 0);
      if (seekSlider) seekSlider.value = Math.min(absoluteTime, totalDuration);
      if (typeof updateTimeDisplay === 'function') updateTimeDisplay();
    }
  });
  videoPlayer.addEventListener('loadedmetadata', function () {
    console.log('📊 loadedmeta', videoPlayer.duration);
    if (AppState && AppState.expectedDuration && typeof forceUpdateDuration === 'function') {
      forceUpdateDuration(AppState.expectedDuration, AppState.originalDuration, AppState.seekOffset);
    }
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });
  videoPlayer.addEventListener('progress', function () {
    if (typeof updateBufferDisplay === 'function') updateBufferDisplay();
  });
  videoPlayer.addEventListener('ended', function () {
    console.log('🏁 Видео закончилось');
    //if (typeof updatePlayPauseButton === 'function') updatePlayPauseButton();
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
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
    if (typeof AppState !== 'undefined') {
      AppState.bufferHidden = !AppState.bufferHidden;
    }
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
    }, 3000);
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
      }, 300);
    });
  }

  var backFromDetail = getEl('back-from-detail');
  if (backFromDetail) {
    backFromDetail.addEventListener('click', function () {
      console.log('🔙 Возврат из детального просмотра');
      var mainContainer = getEl('main-container');
      resetDetailBackground();
      //if (typeof Animations !== 'undefined') {
      //Animations.animateDetailHide();
      //}
      var currentTorrentHash = AppState && AppState.currentDetailItem ? AppState.currentDetailItem.hash : null;
      console.log('🔍 Hash для восстановления:', currentTorrentHash);
      if (AppState && !AppState.isSearch) {
        var detailView = getEl('detail-view');
        if (detailView) detailView.style.display = 'none';
      }
      if (mainContainer) {
        mainContainer.style.pointerEvents = 'auto';
      }
      var torrserverSection = getEl('torrserver-section');
      if (torrserverSection) torrserverSection.style.display = 'block';
      if (typeof AppState !== 'undefined') {
        AppState.detailReturnTo = AppState.inSearch;
      }
      var returnTo = (!AppState || !AppState.isSearch)
        ? ((AppState && AppState.detailReturnTo === 'catalog') ? 'catalog' : 'torrents')
        : 'search';

      console.log('📍 returnTo =', returnTo);

      setTimeout(function () {
        if (typeof updateFocusableElements !== 'function' || typeof setFocus !== 'function') {
          console.error('❌ Функции навигации еще не загружены');
          return;
        }

        if (returnTo === 'catalog') {
          if (typeof window.ensureCatalogFocus === 'function') {
            AppState.backupScroll = 0;
            AppState.currentScreen = 'catalog';
            window.ensureCatalogFocus(true);
            var detailView = getEl('detail-view');
            if (detailView) detailView.style.display = 'none';
            return;
          }
          if (typeof window.focusFirstCatalogCard === 'function') {
            window.focusFirstCatalogCard();
            var detailView = getEl('detail-view');
            if (detailView) detailView.style.display = 'none';
            return;
          }
        } else if (returnTo === 'search') {
          if (AppState && AppState.isSearch) {
            if (typeof AppState !== 'undefined') AppState.isSearch = false;
            if (typeof window.showSearchResults === 'function') window.showSearchResults();
          } else {
            if (typeof window.clearSearchResults === 'function') window.clearSearchResults();
          }
          var detailView = getEl('detail-view');
          if (detailView) detailView.style.display = 'none';
          return;
        } else if (returnTo === 'torrents') {
          if (typeof window.clearSearchResultsContainer === 'function') window.clearSearchResultsContainer();
          if (typeof AppState !== 'undefined') {
            AppState.currentScreen = 'torrents';
          }
          if (currentTorrentHash) {
            window.lastSelectedTorrentHash = currentTorrentHash;
            console.log('💾 Сохранен hash для восстановления:', currentTorrentHash);
          }
          updateFocusableElements();
          if (typeof window.ensureTorrentFocus === 'function') {
            var focused = window.ensureTorrentFocus(true);
            var detailView = getEl('detail-view');
            if (detailView) detailView.style.display = 'none';
            console.log('🎯 Фокус восстановлен через ensureTorrentFocus');
            return;
          }
          var targetIndex = -1;
          if (currentTorrentHash) {
            console.log('🔍 Поиск карточки с hash:', currentTorrentHash);
            var fLen = focusableElements.length;
            for (var i = 0; i < fLen; i++) {
              var el = focusableElements[i];
              if (el.classList && el.classList.contains('torrent-card')) {
                var cardHash = el.dataset.hash;
                if (cardHash && cardHash.toLowerCase() === currentTorrentHash.toLowerCase()) {
                  targetIndex = i;
                  console.log('✅ Найдена карточка по hash, индекс:', targetIndex);
                  break;
                }
              }
            }
          }
          if (targetIndex === -1 && typeof lastSelectedTorrentIndex !== 'undefined') {
            console.log('🔍 Поиск по сохраненному индексу:', lastSelectedTorrentIndex);
            var cardIndices = [];
            var fLen = focusableElements.length;
            for (var j = 0; j < fLen; j++) {
              if (focusableElements[j].classList && focusableElements[j].classList.contains('torrent-card')) {
                cardIndices.push(j);
              }
            }
            if (lastSelectedTorrentIndex < cardIndices.length) {
              targetIndex = cardIndices[lastSelectedTorrentIndex];
              console.log('✅ Найдена карточка по индексу, глобальный индекс:', targetIndex);
            }
          }
          if (targetIndex === -1) {
            var firstCardIndex = -1;
            var fLen = focusableElements.length;
            for (var k = 0; k < fLen; k++) {
              if (focusableElements[k].classList && focusableElements[k].classList.contains('torrent-card')) {
                firstCardIndex = k;
                break;
              }
            }
            targetIndex = firstCardIndex !== -1 ? firstCardIndex : 0;
            console.log('⚠️ Используем первую карточку, индекс:', targetIndex);
          }
          setFocus(targetIndex);
          var detailView = getEl('detail-view');
          if (detailView) detailView.style.display = 'none';
        } else {
          if (typeof window.clearSearchResultsContainer === 'function') window.clearSearchResultsContainer();
          if (typeof AppState !== 'undefined') AppState.currentScreen = 'torrents';
          updateFocusableElements();
          if (typeof window.ensureTorrentFocus === 'function') {
            window.ensureTorrentFocus(true);
          } else {
            var firstCardIndex = -1;
            var fLen = focusableElements.length;
            for (var i = 0; i < fLen; i++) {
              if (focusableElements[i].classList && focusableElements[i].classList.contains('torrent-card')) {
                firstCardIndex = i;
                break;
              }
            }
            setFocus(firstCardIndex !== -1 ? firstCardIndex : 0);
          }
          var detailView = getEl('detail-view');
          if (detailView) detailView.style.display = 'none';
        }
        if (typeof Animations !== 'undefined') {
          Animations.animateDetailHide();
        }
      }, 250);
    });
  }
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
    closeSearchBtn.addEventListener('click', function () { hideSearchResults(); });
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
          torrentsGrid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">\n           <div class="loading-spinner" style="margin: 0 auto 20px;"></div>\n           <div style="font-size: 16px; color: #aaa;">Загрузка торрентов...</div>\n         </div>';
        }
        loadTorrents(true).then(function () { })['catch'](function (error) {
          console.error('Ошибка загрузки торрентов:', error);
          if (torrentsGrid) {
            torrentsGrid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">\n             <div style="font-size: 48px; margin-bottom: 20px;">❌</div>\n             <div style="font-size: 16px; color: #ff6a6a;">Ошибка загрузки торрентов</div>\n             <button class="btn" style="margin-top: 20px;" onclick="getEl(\'tab-torrents\').click()">Попробовать снова</button>\n           </div>';
          }
        });
      } else {
        loadTorrents(true).then(function () { })['catch'](function (error) {
          console.error('Ошибка загрузки торрентов:', error);
          if (torrentsGrid) {
            torrentsGrid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">\n             <div style="font-size: 48px; margin-bottom: 20px;">❌</div>\n             <div style="font-size: 16px; color: #ff6a6a;">Ошибка загрузки торрентов</div>\n             <button class="btn" style="margin-top: 20px;" onclick="getEl(\'tab-torrents\').click()">Попробовать снова</button>\n           </div>';
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
        }, 60);
      }
    });
  }
  if (torrentmovie && typeof applyFiltersAndSort === 'function') {
    torrentmovie.addEventListener('change', function (e) {
      if (typeof currentSort !== 'undefined') currentSort = e.target.value;
      applyFiltersAndSort();
    });
  }
  if (sortBy && typeof applyFiltersAndSort === 'function') {
    sortBy.addEventListener('change', function (e) {
      if (typeof currentSort !== 'undefined') currentSort = e.target.value;
      applyFiltersAndSort();
    });
  }
  if (filterQuality && typeof applyFiltersAndSort === 'function') {
    filterQuality.addEventListener('change', function (e) {
      if (typeof currentQualityFilter !== 'undefined') currentQualityFilter = e.target.value;
      applyFiltersAndSort();
    });
  }
  if (filterTracker && typeof applyFiltersAndSort === 'function') {
    filterTracker.addEventListener('change', function (e) {
      if (typeof currentTrackerFilter !== 'undefined') currentTrackerFilter = e.target.value;
      applyFiltersAndSort();
    });
  }
  if (filterYear && typeof applyFiltersAndSort === 'function') {
    filterYear.addEventListener('change', function (e) {
      if (typeof currentYearFilter !== 'undefined') currentYearFilter = e.target.value;
      applyFiltersAndSort();
    });
  }
  if (filterSeason && typeof applyFiltersAndSort === 'function') {
    filterSeason.addEventListener('change', function (e) {
      if (typeof currentSeasonFilter !== 'undefined') currentSeasonFilter = e.target.value;
      applyFiltersAndSort();
    });
  }
  if (filterVoice && typeof applyFiltersAndSort === 'function') {
    filterVoice.addEventListener('change', function (e) {
      if (typeof currentVoiceFilter !== 'undefined') currentVoiceFilter = e.target.value;
      applyFiltersAndSort();
    });
  }
  if (filtervideotype && typeof applyFiltersAndSort === 'function') {
    filtervideotype.addEventListener('change', function (e) {
      if (typeof currentvideotypeFilter !== 'undefined') currentvideotypeFilter = e.target.value;
      applyFiltersAndSort();
    });
  }
  if (resetFiltersBtn && typeof resetFilters === 'function') {
    resetFiltersBtn.addEventListener('click', resetFilters);
  }
}

function setupServerCheck() {
  var torrserverUrl = getEl('torrserver-url');
  if (torrserverUrl) {
    torrserverUrl.addEventListener('input', function () {
      if (checkServerTimeout) clearTimeout(checkServerTimeout);
      checkServerTimeout = setTimeout(function () {
        if (typeof checkServer === 'function') checkServer(true);
      }, 300);
    });
  }
}

function setupAuth() {
  var authCheckbox = getEl('auth-checkbox');
  var authLogin = getEl('auth-login');
  var authPassword = getEl('auth-password');
  if (authCheckbox) {
    authCheckbox.addEventListener('change', function (e) {
      if (typeof AppState !== 'undefined') AppState.authEnabled = e.target.checked;
      var authFields = getEl('auth-fields');
      if (authFields) {
        if (AppState && AppState.authEnabled) authFields.classList.add('visible');
        else authFields.classList.remove('visible');
      }
      if (checkServerTimeout) clearTimeout(checkServerTimeout);
      checkServerTimeout = setTimeout(function () {
        if (typeof checkServer === 'function') checkServer(true);
      }, 500);
    });
  }
  if (authLogin) {
    authLogin.addEventListener('input', function () {
      if (checkServerTimeout) clearTimeout(checkServerTimeout);
      checkServerTimeout = setTimeout(function () {
        if (typeof checkServer === 'function') checkServer(true);
      }, 300);
    });
  }
  if (authPassword) {
    authPassword.addEventListener('input', function () {
      if (checkServerTimeout) clearTimeout(checkServerTimeout);
      checkServerTimeout = setTimeout(function () {
        if (typeof checkServer === 'function') checkServer(true);
      }, 300);
    });
  }
}

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

function setupTouchControls(seekSlider, volumeSlider) {
  var touchTarget = null;
  var touchStartX = 0;
  var touchStartY = 0;
  var touchStartTime = 0;
  var touchMoved = false;

  function setupTouchButtons() {
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
    if (touchTarget) {
      touchTarget.classList.remove('touch-active');
    }

    var elementAtTouch = document.elementFromPoint(
      e.changedTouches[0].clientX,
      e.changedTouches[0].clientY
    );

    var clickableElement = null;
    if (elementAtTouch) {
      clickableElement = elementAtTouch.closest('button, .control-btn, .play-btn, .torrent-card, .file-item, .search-result-item, .episode-item, .audio-item, .close-panel-btn, .filter-reset-btn, .progress-continue-btn, .detail-progress-btn, #close-search, #filter-toggle, #search-btn');
    }

    if (!touchMoved && deltaTime < 300 && Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) {
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
    seekSlider.addEventListener('touchmove', function (e) {
      e.stopPropagation();
    }, { passive: true });
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
  var observer = new MutationObserver(function () {
    setupTouchButtons();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function setupAutoRefresh() {
  var autoRefreshInterval = null;
  function startAutoRefresh() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    autoRefreshInterval = setInterval(function () {
      var torrserverSection = getEl('torrserver-section');
      if (torrserverSection && torrserverSection.style.display === 'block' &&
        AppState && AppState.currentScreen !== 'player' &&
        AppState.currentScreen !== 'detail' &&
        AppState.currentScreen !== 'search' &&
        AppState.currentScreen !== 'catalog') {
        console.log('🔄 Автоматическое обновление списка торрентов');
        if (typeof loadTorrents === 'function') loadTorrents();
      }
    }, 300000);
  }
  function stopAutoRefresh() {
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
      autoRefreshInterval = null;
    }
  }
  var originalStartHLSPlayback = typeof startHLSPlayback === 'function' ? startHLSPlayback : null;
  if (originalStartHLSPlayback) {
    window.startHLSPlayback = function () {
      var args = arguments;
      stopAutoRefresh();
      return originalStartHLSPlayback.apply(this, args);
    };
  }
  var originalShowDetailView = typeof showDetailView === 'function' ? showDetailView : null;
  if (originalShowDetailView) {
    window.showDetailView = function () {
      var args = arguments;
      var result = originalShowDetailView.apply(this, args);
      startAutoRefresh();
      return result;
    };
  }
}

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
    fullscreenBtn.innerHTML = isFullscreen
      ? '<i class="fi fi-rr-compress"></i>'
      : '<i class="fi fi-rr-expand"></i>';
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

function setupExternalPlayerCheckbox() {
  var externalPlayerCheckbox = getEl('out-player');
  if (!externalPlayerCheckbox) return;
  var savedExternalPlayer = localStorage.getItem('externalPlayerEnabled') === 'true';
  window.externalPlayerEnabled = savedExternalPlayer;
  externalPlayerCheckbox.checked = savedExternalPlayer;
  if (typeof AppState !== 'undefined') {
    AppState.externalPlayerEnabled = window.externalPlayerEnabled;
  }
  console.log('📱 Внешний плеер:', window.externalPlayerEnabled ? 'включен' : 'выключен');
  externalPlayerCheckbox.addEventListener('change', function (e) {
    window.externalPlayerEnabled = e.target.checked;
    localStorage.setItem('externalPlayerEnabled', window.externalPlayerEnabled);
    if (typeof AppState !== 'undefined') {
      AppState.externalPlayerEnabled = window.externalPlayerEnabled;
    }
    console.log('📱 Внешний плеер:', window.externalPlayerEnabled ? 'включен' : 'выключен');
    if (window.externalPlayerEnabled && typeof showPlayerHint === 'function') {
      showPlayerHint('Внешний плеер включен. При воспроизведении будет открыт выбор приложений.');
    } else if (!window.externalPlayerEnabled && typeof showPlayerHint === 'function') {
      showPlayerHint('Внешний плеер выключен. Используется встроенный плеер.');
    }
  });
}

function setupCheckboxes() {
  setupExternalPlayerCheckbox();
  var hideClockCheckbox = getEl('hide-clock');
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
  var multiChannelCheckbox = getEl('multi-channel-audio');
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
}

function setupClockVisibility() {
  var clockDisplay = getEl('clock-display');
  if (clockDisplay) {
    clockDisplay.style.display = hideClockEnabled ? 'none' : 'block';
  }
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

// ==================== ФУНКЦИИ МЫШИ И ИНТЕРФЕЙСА ====================
function resetMouseIdleTimer() {
  if (AppState.currentScreen == 'player') {
    var playerScreen = getEl('player-screen');
    var playerOverlay = getEl('player-overlay');
    var controlsContainer = getEl('controls-container');
    var bufferStats = getEl('buffer-stats');
    var playerHint = getEl('player-hint');
    var toggleBufferBtn = getEl('toggle-buffer-btn');
    var exitPlayerBtn = getEl('exit-player-btn');
    var episodesBtn = getEl('episodes-btn');
    var episodesPanel = getEl('episodes-panel');
    var prevBtn = getEl('prev-episode-btn');
    var nextBtn = getEl('next-episode-btn');
    var playerTitle = getEl('player-title');
    if (!playerScreen || playerScreen.style.display !== 'block') return;

    if (playerOverlay) playerOverlay.classList.add('touch-active');
    var controlElements = [controlsContainer, bufferStats, playerHint, toggleBufferBtn, exitPlayerBtn, episodesBtn, prevBtn, nextBtn, playerTitle];
    var len = controlElements.length;
    for (var i = 0; i < len; i++) {
      var el = controlElements[i];
      if (el) {
        el.classList.remove('idle-hidden');
        el.style.opacity = '1';
        el.style.pointerEvents = 'auto';
      }
    }
    if (typeof syncPlayerTitleVisibility === 'function') {
      syncPlayerTitleVisibility(true);
    }
    if (episodesPanel && !episodesPanel.classList.contains('hidden')) {
      episodesPanel.style.opacity = '1';
      episodesPanel.style.pointerEvents = 'auto';
    }
    if (window.mouseIdleTimer) {
      clearTimeout(window.mouseIdleTimer);
    }
    window.mouseIdleTimer = setTimeout(function () {
      if (playerScreen.style.display === 'block') {
        if (playerOverlay) playerOverlay.classList.remove('touch-active');
        for (var j = 0; j < len; j++) {
          var el = controlElements[j];
          if (el) {
            el.classList.add('idle-hidden');
            el.style.opacity = '0';
            el.style.pointerEvents = 'none';
          }
        }
        if (typeof syncPlayerTitleVisibility === 'function') {
          syncPlayerTitleVisibility(false);
        }
        if (episodesPanel && episodesPanel.classList.contains('hidden')) {
          episodesPanel.style.opacity = '0';
          episodesPanel.style.pointerEvents = 'none';
        }
      }
    }, 3000);
  }
}
window.resetMouseIdleTimer = resetMouseIdleTimer;

function showPlayerHint(message) {
  var hint = getEl('player-hint');
  if (!hint) return;
  hint.textContent = message;
  hint.style.opacity = '1';
  clearTimeout(window.hintTimeout);
  window.hintTimeout = setTimeout(function () {
    hint.style.opacity = '0';
  }, 2000);
}

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

// Экспортируем функции
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
