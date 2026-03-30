// app.js - Инициализация приложения и обработчики событий

document.addEventListener('DOMContentLoaded', () => {
  init();
});

let checkServerTimeout = null;

// Функция для начальной проверки сервера
function initialServerCheck() {
  setTimeout(() => {
    const torrserverUrlInput = document.getElementById('torrserver-url');
    if (torrserverUrlInput && torrserverUrlInput.value && torrserverUrlInput.value.trim() !== '') {
      console.log('🔍 Автоматическая проверка сервера...');
      if (typeof checkServer === 'function') {
        checkServer(true);
      }
    } else {
      console.log('ℹ️ URL сервера не задан, пропускаем автоматическую проверку');
    }
  }, 1000); // Увеличил задержку до 1 секунды для полной загрузки всех модулей
}

async function init() {
  try {
    console.log('🚀 Начало инициализации приложения');

    // Проверяем, что все необходимые DOM элементы существуют
    const requiredElements = [
      'seek-slider', 'volume-slider', 'play-pause-btn', 'mute-btn',
      'toggle-buffer-btn', 'exit-player-btn', 'player-overlay', 'video-player'
    ];

    const missingElements = requiredElements.filter(id => !document.getElementById(id));
    if (missingElements.length > 0) {
      console.warn('⚠️ Отсутствуют DOM элементы:', missingElements);
      // Не прерываем инициализацию полностью, но логируем предупреждение
    }

    // Получаем ссылки на DOM элементы с проверкой существования
    const seekSlider = document.getElementById('seek-slider');
    const volumeSlider = document.getElementById('volume-slider');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const muteBtn = document.getElementById('mute-btn');
    const toggleBufferBtn = document.getElementById('toggle-buffer-btn');
    const exitPlayerBtn = document.getElementById('exit-player-btn');
    const overlay = document.getElementById('player-overlay');
    const videoPlayer = document.getElementById('video-player');

    // Инициализация значений с проверкой существования элементов
    if (seekSlider) {
      seekSlider.value = 0;
      seekSlider.max = 100;
    }
    if (volumeSlider) {
      volumeSlider.value = 1;
    }

    // Загружаем сохраненную конфигурацию клиента с обработкой ошибок
    try {
      await loadClientConfig();
    } catch (error) {
      console.error('❌ Ошибка загрузки конфигурации:', error);
    }

    // Определение платформы с fallback
    const ua = navigator.userAgent ? navigator.userAgent.toLowerCase() : '';
    const body = document.body;
    if (body) {
      body.classList.toggle('msx', !!window.MSX || ua.includes('msx'));
    }

    // Настройка обработчиков событий для плеера с проверкой существования элементов
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

    // Инициализация кнопок серий и аудио (с проверкой существования функций)
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

    // Настройка кнопок переключения серий
    setupEpisodeNavigation();

    // События видео с проверкой существования
    if (videoPlayer) {
      setupVideoEvents(videoPlayer, volumeSlider, seekSlider);
    }

    // Периодическое обновление буфера
    setupBufferUpdateInterval();

    // Кнопка переключения буфера
    if (toggleBufferBtn) {
      setupToggleBufferButton(toggleBufferBtn);
    }

    // Управление overlay
    if (overlay) {
      setupOverlayControls(overlay);
    }

    // Навигация (с проверкой существования элементов)
    setupNavigation();

    // Поиск торрентов
    setupSearch();

    // Фильтры поиска
    setupSearchFilters();

    // Автоматическая проверка сервера
    setupServerCheck();

    // Аутентификация
    setupAuth();

    // Обработчики для автоматического скрытия элементов в плеере
    setupPlayerAutoHide();

    // Сенсорное управление
    setupTouchControls(seekSlider, volumeSlider);

    // Автоматическое обновление списка торрентов
    setupAutoRefresh();

    // Полноэкранный режим
    setupFullscreen();

    // Автоматический полноэкранный режим
    setupAutoFullscreen();

    // Инициализация поиска
    if (typeof initSearchModeToggle === 'function') {
      initSearchModeToggle();
    }

    initialServerCheck();

    console.log('✅ Инициализация приложения завершена');

  } catch (error) {
    console.error('❌ Критическая ошибка при инициализации:', error);
    // Показываем сообщение пользователю, если приложение не загрузилось
    showInitError();
  }
}

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ РАЗБИЕНИЯ ЛОГИКИ ====================

function setupSeekSliderEvents(seekSlider, videoPlayer) {
  seekSlider.addEventListener('mousedown', () => {
    if (typeof AppState !== 'undefined') {
      AppState.isSliderDragging = true;
      AppState.suppressTimeUpdate = true;
    }
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });

  seekSlider.addEventListener('touchstart', () => {
    if (typeof AppState !== 'undefined') {
      AppState.isSliderDragging = true;
      AppState.suppressTimeUpdate = true;
    }
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });

  seekSlider.addEventListener('input', (e) => {
    const newPreviewTime = parseFloat(e.target.value);
    if (isFinite(newPreviewTime)) {
      if (typeof AppState !== 'undefined') {
        AppState.previewTime = newPreviewTime;
      }
      const currentTimeEl = document.getElementById('current-time');
      if (currentTimeEl) currentTimeEl.textContent = formatTime(newPreviewTime);

      if (typeof AppState !== 'undefined' && (AppState.isSeeking ||
        (document.getElementById('loading-player-overlay') &&
          document.getElementById('loading-player-overlay').classList.contains('active')))) {
        const loadingTimeEl = document.getElementById('loading-time');
        if (loadingTimeEl) loadingTimeEl.textContent = formatTime(newPreviewTime);
      }
    }
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });

  seekSlider.addEventListener('change', async (e) => {
    const targetAbsoluteTime = parseFloat(e.target.value);
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

    console.log(`🎚️ Seek to: ${formatTime(targetAbsoluteTime)}`);

    if (!AppState || !AppState.hls) {
      if (videoPlayer) {
        videoPlayer.currentTime = targetAbsoluteTime - (AppState?.seekOffset || 0);
      }
      if (typeof AppState !== 'undefined') {
        AppState.previewTime = null;
        AppState.suppressTimeUpdate = false;
      }
      if (typeof updateTimeDisplay === 'function') updateTimeDisplay();
      if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
      return;
    }

    const controlBtns = document.querySelectorAll('.control-btn');
    controlBtns.forEach(btn => {
      btn.style.pointerEvents = 'none';
      btn.style.opacity = '0.5';
    });

    if (typeof seekStream === 'function') {
      await seekStream(targetAbsoluteTime, 'slider');
    }
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });

  seekSlider.addEventListener('mouseup', () => {
    setTimeout(() => {
      if (!AppState?.isSliderDragging) return;
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

  seekSlider.addEventListener('touchend', () => {
    setTimeout(() => {
      if (!AppState?.isSliderDragging) return;
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
  playPauseBtn.addEventListener('click', (e) => {
    if (AppState?.isSeeking || (document.getElementById('loading-player-overlay') &&
      document.getElementById('loading-player-overlay').classList.contains('active'))) {
      e.preventDefault();
      return;
    }
    if (videoPlayer.paused) {
      videoPlayer.play().then(() => {
        if (typeof updatePlayPauseButton === 'function') updatePlayPauseButton();
      }).catch(() => { });
    } else {
      videoPlayer.pause();
      if (typeof updatePlayPauseButton === 'function') updatePlayPauseButton();
    }
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });
}

function setupMuteButton(muteBtn, videoPlayer, volumeSlider) {
  muteBtn.addEventListener('click', () => {
    if (AppState?.isSeeking || (document.getElementById('loading-player-overlay') &&
      document.getElementById('loading-player-overlay').classList.contains('active'))) return;
    videoPlayer.muted = !videoPlayer.muted;
    if (typeof updateMuteButton === 'function') updateMuteButton();
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });
}

function setupVolumeSlider(volumeSlider, videoPlayer) {
  volumeSlider.addEventListener('input', (e) => {
    if (AppState?.isSeeking || (document.getElementById('loading-player-overlay') &&
      document.getElementById('loading-player-overlay').classList.contains('active'))) return;
    const vol = parseFloat(e.target.value);
    videoPlayer.volume = vol;
    if (vol > 0 && videoPlayer.muted) {
      videoPlayer.muted = false;
      if (typeof updateMuteButton === 'function') updateMuteButton();
    }
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });
}

function setupExitButton(exitPlayerBtn) {
  exitPlayerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (typeof showDetailView === 'function') showDetailView();
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
    if (typeof window.exitPlayer === 'function') {
      window.exitPlayer();
    }
  });
}

function setupEpisodeNavigation() {
  const prevEpisodeBtn = document.getElementById('prev-episode-btn');
  const nextEpisodeBtn = document.getElementById('next-episode-btn');

  if (prevEpisodeBtn) {
    prevEpisodeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof prevEpisode === 'function') prevEpisode();
      if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
    });
  }
  if (nextEpisodeBtn) {
    nextEpisodeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof nextEpisode === 'function') nextEpisode();
      if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
    });
  }
}

function setupVideoEvents(videoPlayer, volumeSlider, seekSlider) {
  videoPlayer.addEventListener('volumechange', () => {
    if (volumeSlider) volumeSlider.value = videoPlayer.volume;
    if (typeof updateMuteButton === 'function') updateMuteButton();
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });

  videoPlayer.addEventListener('timeupdate', () => {
    if (typeof isSeekHoldActive !== 'undefined' && isSeekHoldActive) {
      return;
    }

    if (AppState?.isSliderDragging || AppState?.suppressTimeUpdate) {
      return;
    }
    const totalDuration = AppState?.originalDuration || AppState?.expectedDuration || videoPlayer.duration;

    if (totalDuration && isFinite(totalDuration) && totalDuration > 0) {
      if (seekSlider) seekSlider.max = totalDuration;
      const absoluteTime = videoPlayer.currentTime + (AppState?.seekOffset || 0);
      if (seekSlider) seekSlider.value = Math.min(absoluteTime, totalDuration);
      if (typeof updateTimeDisplay === 'function') updateTimeDisplay();
    }
  });

  videoPlayer.addEventListener('loadedmetadata', () => {
    console.log('📊 loadedmeta', videoPlayer.duration);
    if (AppState?.expectedDuration && typeof forceUpdateDuration === 'function') {
      forceUpdateDuration(AppState.expectedDuration, AppState.originalDuration, AppState.seekOffset);
    }
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });

  videoPlayer.addEventListener('progress', () => {
    if (typeof updateBufferDisplay === 'function') updateBufferDisplay();
  });

  videoPlayer.addEventListener('ended', () => {
    console.log('🏁 Видео закончилось');
    if (typeof updatePlayPauseButton === 'function') updatePlayPauseButton();
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });
}

function setupBufferUpdateInterval() {
  setInterval(() => {
    if (AppState?.currentScreen === 'player' && !AppState?.bufferHidden && !AppState?.isSeeking) {
      if (typeof updateBufferDisplay === 'function') updateBufferDisplay();
    }
  }, 300);
}

function setupToggleBufferButton(toggleBufferBtn) {
  toggleBufferBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (typeof AppState !== 'undefined') {
      AppState.bufferHidden = !AppState.bufferHidden;
    }
    toggleBufferBtn.style.opacity = AppState?.bufferHidden ? '0.6' : '1';
    toggleBufferBtn.title = AppState?.bufferHidden ? 'показать буфер' : 'скрыть буфер';
    if (!AppState?.bufferHidden && typeof updateBufferDisplay === 'function') {
      updateBufferDisplay();
    } else {
      const bufferStats = document.getElementById('buffer-stats');
      if (bufferStats) bufferStats.classList.add('hidden');
    }
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });
}

function setupOverlayControls(overlay) {
  function showControls() {
    overlay.classList.add('touch-active');
    clearTimeout(overlay.timer);
    overlay.timer = setTimeout(() => {
      if (!overlay.matches(':hover')) overlay.classList.remove('touch-active');
    }, 3000);
  }

  overlay.addEventListener('mousemove', () => {
    showControls();
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });

  overlay.addEventListener('touchstart', (e) => {
    showControls();
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
    if (e.touches.length === 1) e.preventDefault();
  }, { passive: false });

  let lastTap = 0;
  overlay.addEventListener('touchend', (e) => {
    const currentTime = Date.now();
    if (currentTime - lastTap < 300) {
      if (overlay.classList.contains('touch-active')) overlay.classList.remove('touch-active');
      else showControls();
    } else showControls();
    lastTap = currentTime;
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });
}

function setupNavigation() {
  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      const torrserverSection = document.getElementById('torrserver-section');
      const configScreen = document.getElementById('config-screen');
      if (torrserverSection) torrserverSection.style.display = 'none';
      if (configScreen) configScreen.style.display = 'flex';
      if (typeof AppState !== 'undefined') AppState.currentScreen = 'config';
      setTimeout(() => {
        if (typeof updateFocusableElements === 'function') updateFocusableElements();
        if (typeof setFocus === 'function') setFocus(0);
      }, 300);
    });
  }

  const backFromDetail = document.getElementById('back-from-detail');
  if (backFromDetail) {
    backFromDetail.addEventListener('click', () => {
      console.log('🔙 Возврат из детального просмотра');
      if (!AppState?.isSearch) {
        const detailView = document.getElementById('detail-view');
        if (detailView) detailView.style.display = 'none';
      }
      const mainContainer = document.getElementById('main-container');
      if (mainContainer) {
        mainContainer.style.pointerEvents = 'auto';
      }
      const torrserverSection = document.getElementById('torrserver-section');
      if (torrserverSection) torrserverSection.style.display = 'block';
      if (typeof AppState !== 'undefined') {
        AppState.detailReturnTo = AppState.inSearch;
      }
      const returnTo = !AppState?.isSearch
        ? (AppState?.detailReturnTo === 'catalog' ? 'catalog' : 'torrents')
        : 'search';

      const currentTorrentHash = AppState?.currentDetailItem?.hash;
      console.log('🔍 Hash для восстановления:', currentTorrentHash, 'returnTo=', returnTo);

      setTimeout(() => {
        if (typeof updateFocusableElements !== 'function' || typeof setFocus !== 'function') {
          console.error('❌ Функции навигации еще не загружены');
          return;
        }

        if (returnTo === 'catalog') {
          if (typeof window.ensureCatalogFocus === 'function') {
            window.ensureCatalogFocus(true);
            const detailView = document.getElementById('detail-view');
            if (detailView) detailView.style.display = 'none';
            return;
          }
          if (typeof window.focusFirstCatalogCard === 'function') {
            window.focusFirstCatalogCard();
            const detailView = document.getElementById('detail-view');
            if (detailView) detailView.style.display = 'none';
            return;
          }
        } else if (returnTo === 'search') {
          if (AppState?.isSearch) {
            if (typeof AppState !== 'undefined') AppState.isSearch = false;
            if (typeof window.showSearchResults === 'function') window.showSearchResults();
          } else {
            if (typeof window.clearSearchResults === 'function') window.clearSearchResults();
          }
          const detailView = document.getElementById('detail-view');
          if (detailView) detailView.style.display = 'none';
          return;
        }

        if (typeof window.clearSearchResultsContainer === 'function') window.clearSearchResultsContainer();
        if (typeof AppState !== 'undefined') AppState.currentScreen = 'torrents';
        updateFocusableElements();

        let targetIndex = -1;

        if (currentTorrentHash) {
          console.log('🔍 Поиск карточки с hash:', currentTorrentHash);

          for (let i = 0; i < focusableElements.length; i++) {
            const el = focusableElements[i];
            if (el.classList && el.classList.contains('torrent-card')) {
              const cardHash = el.dataset.hash;
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

          const cardIndices = [];
          focusableElements.forEach((el, idx) => {
            if (el.classList && el.classList.contains('torrent-card')) {
              cardIndices.push(idx);
            }
          });

          if (lastSelectedTorrentIndex < cardIndices.length) {
            targetIndex = cardIndices[lastSelectedTorrentIndex];
            console.log('✅ Найдена карточка по индексу, глобальный индекс:', targetIndex);
          }
        }

        if (targetIndex === -1) {
          const firstCardIndex = focusableElements.findIndex(el =>
            el.classList && el.classList.contains('torrent-card')
          );
          targetIndex = firstCardIndex !== -1 ? firstCardIndex : 0;
          console.log('⚠️ Используем первую карточку, индекс:', targetIndex);
        }

        setFocus(targetIndex);
      }, 250);
    });
  }
}

function setupSearch() {
  const searchInput = document.getElementById('search-query');
  const searchBtn = document.getElementById('search-btn');
  const closeSearchBtn = document.getElementById('close-search');
  const tabTorrents = document.getElementById('tab-torrents');
  const tabSearch = document.getElementById('tab-search');
  const tabCatalog = document.getElementById('tab-catalog');

  if (searchBtn && searchInput) {
    searchBtn.addEventListener('click', () => {
      const query = searchInput.value.trim();
      if (typeof showSearchResults === 'function') showSearchResults();
      if (query && typeof searchTorrents === 'function') searchTorrents(query);
    });
  }

  if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const query = searchInput.value.trim();
        if (typeof searchTorrents === 'function') searchTorrents(query);
      }
    });
  }

  if (closeSearchBtn && typeof hideSearchResults === 'function') {
    closeSearchBtn.addEventListener('click', () => hideSearchResults());
  }

  if (tabTorrents && typeof hideSearchResults === 'function' && typeof loadTorrents === 'function') {
    tabTorrents.addEventListener('click', () => {
      console.log('📁 Переключение на вкладку "Мои торренты"');
      window.pendingCatalogPoster = null;
      window.pendingCatalogItem = null;
      if (typeof AppState !== 'undefined') AppState.inSearch = 'torrents';
      hideSearchResults();
      tabTorrents.classList.add('active');
      if (tabSearch) tabSearch.classList.remove('active');
      if (tabCatalog) tabCatalog.classList.remove('active');
      const searchOverlay = document.getElementById('search-overlay');
      if (searchOverlay) searchOverlay.classList.add('hidden');
      if (typeof AppState !== 'undefined') AppState.currentScreen = 'torrents';
      const torrentsGrid = document.getElementById('torrents-grid');
      if (torrentsGrid) {
        torrentsGrid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">
          <div class="loading-spinner" style="margin: 0 auto 20px;"></div>
          <div style="font-size: 16px; color: #aaa;">Загрузка торрентов...</div>
        </div>`;
      }
      loadTorrents(true).then(() => {
        setTimeout(() => {
          if (typeof updateFocusableElements === 'function') updateFocusableElements();
          if (typeof window.focusFirstTorrentCard === 'function') window.focusFirstTorrentCard();
        }, 200);
      }).catch(error => {
        console.error('Ошибка загрузки торрентов:', error);
        if (torrentsGrid) {
          torrentsGrid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">
            <div style="font-size: 48px; margin-bottom: 20px;">❌</div>
            <div style="font-size: 16px; color: #ff6a6a;">Ошибка загрузки торрентов</div>
            <button class="btn" style="margin-top: 20px;" onclick="document.getElementById('tab-torrents').click()">Попробовать снова</button>
          </div>`;
        }
      });
    });
  }

  if (tabSearch && typeof showSearchResults === 'function') {
    tabSearch.addEventListener('click', () => {
      showSearchResults();
      if (searchInput && searchInput.value.trim() && typeof searchResults !== 'undefined' && searchResults.length === 0 && typeof searchTorrents === 'function') {
        searchTorrents(searchInput.value.trim());
      }
    });
  }

  if (tabCatalog && typeof window.loadCatalogList === 'function') {
    tabCatalog.addEventListener('click', () => {
      if (typeof AppState !== 'undefined') AppState.inSearch = 'catalog';
      window.pendingCatalogPoster = null;
      window.pendingCatalogItem = null;
      if (typeof catalogState !== 'undefined') {
        catalogState.lastSelectedIndex = 0;
        catalogState.lastSelectedId = null;
      }
      localStorage.removeItem('lastCatalogCardIndex');
      if (typeof hideSearchResults === 'function') hideSearchResults();
      const searchOverlay = document.getElementById('search-overlay');
      if (searchOverlay) searchOverlay.classList.add('hidden');
      const tabTorrentsEl = document.getElementById('tab-torrents');
      const tabSearchEl = document.getElementById('tab-search');
      if (tabTorrentsEl) tabTorrentsEl.classList.remove('active');
      if (tabSearchEl) tabSearchEl.classList.remove('active');
      tabCatalog.classList.add('active');
      if (typeof AppState !== 'undefined') AppState.currentScreen = 'catalog';
      window.loadCatalogList();
      setTimeout(() => {
        if (typeof updateFocusableElements === 'function') updateFocusableElements();
        if (typeof window.focusFirstCatalogCard === 'function') window.focusFirstCatalogCard();
      }, 200);
    });
  }
}

function setupSearchFilters() {
  const filterToggleBtn = document.getElementById('filter-toggle');
  const torrentmovie = document.getElementById('torrent-movie');
  const sortBy = document.getElementById('sort-by');
  const filterQuality = document.getElementById('filter-quality');
  const filterTracker = document.getElementById('filter-tracker');
  const filterYear = document.getElementById('filter-year');
  const resetFiltersBtn = document.getElementById('reset-filters');

  if (filterToggleBtn && typeof toggleSearchFiltersPanel === 'function') {
    filterToggleBtn.addEventListener('click', () => {
      const opened = toggleSearchFiltersPanel();
      if (opened && typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
        setTimeout(() => {
          updateFocusableElements();
          const firstFilterIndex = focusableElements.findIndex(el =>
            ['torrent-movie', 'sort-by', 'filter-quality', 'filter-tracker', 'filter-year', 'reset-filters'].includes(el.id));
          if (firstFilterIndex !== -1) setFocus(firstFilterIndex);
        }, 60);
      }
    });
  }

  if (torrentmovie && typeof applyFiltersAndSort === 'function') {
    torrentmovie.addEventListener('change', (e) => {
      if (typeof currentSort !== 'undefined') currentSort = e.target.value;
      applyFiltersAndSort();
    });
  }

  if (sortBy && typeof applyFiltersAndSort === 'function') {
    sortBy.addEventListener('change', (e) => {
      if (typeof currentSort !== 'undefined') currentSort = e.target.value;
      applyFiltersAndSort();
    });
  }

  if (filterQuality && typeof applyFiltersAndSort === 'function') {
    filterQuality.addEventListener('change', (e) => {
      if (typeof currentQualityFilter !== 'undefined') currentQualityFilter = e.target.value;
      applyFiltersAndSort();
    });
  }

  if (filterTracker && typeof applyFiltersAndSort === 'function') {
    filterTracker.addEventListener('change', (e) => {
      if (typeof currentTrackerFilter !== 'undefined') currentTrackerFilter = e.target.value;
      applyFiltersAndSort();
    });
  }

  if (filterYear && typeof applyFiltersAndSort === 'function') {
    filterYear.addEventListener('input', (e) => {
      if (typeof currentYearFilter !== 'undefined') currentYearFilter = e.target.value;
      applyFiltersAndSort();
    });
  }

  if (resetFiltersBtn && typeof resetFilters === 'function') {
    resetFiltersBtn.addEventListener('click', resetFilters);
  }
}

function setupServerCheck() {
  const torrserverUrl = document.getElementById('torrserver-url');
  if (torrserverUrl) {
    torrserverUrl.addEventListener('input', () => {
      if (checkServerTimeout) clearTimeout(checkServerTimeout);
      checkServerTimeout = setTimeout(() => {
        if (typeof checkServer === 'function') checkServer(true);
      }, 300);
    });
  }
}

// Добавляем функцию для начальной проверки сервера
function initialServerCheck() {
  setTimeout(() => {
    const savedUrl = document.getElementById('torrserver-url')?.value;
    if (savedUrl && savedUrl.trim() !== '') {
      console.log('🔍 Автоматическая проверка сервера...');
      if (typeof checkServer === 'function') {
        checkServer(true);
      }
    }
  }, 500);
}

function setupAuth() {
  const authCheckbox = document.getElementById('auth-checkbox');
  const authLogin = document.getElementById('auth-login');
  const authPassword = document.getElementById('auth-password');

  if (authCheckbox) {
    authCheckbox.addEventListener('change', (e) => {
      if (typeof AppState !== 'undefined') AppState.authEnabled = e.target.checked;
      const authFields = document.getElementById('auth-fields');
      if (authFields) {
        if (AppState?.authEnabled) authFields.classList.add('visible');
        else authFields.classList.remove('visible');
      }
      if (checkServerTimeout) clearTimeout(checkServerTimeout);
      checkServerTimeout = setTimeout(() => {
        if (typeof checkServer === 'function') checkServer(true);
      }, 500);
    });
  }

  if (authLogin) {
    authLogin.addEventListener('input', () => {
      if (checkServerTimeout) clearTimeout(checkServerTimeout);
      checkServerTimeout = setTimeout(() => {
        if (typeof checkServer === 'function') checkServer(true);
      }, 300);
    });
  }

  if (authPassword) {
    authPassword.addEventListener('input', () => {
      if (checkServerTimeout) clearTimeout(checkServerTimeout);
      checkServerTimeout = setTimeout(() => {
        if (typeof checkServer === 'function') checkServer(true);
      }, 300);
    });
  }
}

function setupPlayerAutoHide() {
  const playerScreen = document.getElementById('player-screen');
  if (playerScreen && typeof resetMouseIdleTimer === 'function') {
    playerScreen.addEventListener('mousemove', resetMouseIdleTimer);
    playerScreen.addEventListener('mousedown', resetMouseIdleTimer);
    playerScreen.addEventListener('mouseenter', resetMouseIdleTimer);
  }

  const controls = document.querySelectorAll('.control-btn, #seek-slider, #volume-slider');
  if (typeof resetMouseIdleTimer === 'function') {
    controls.forEach(control => {
      control.addEventListener('mouseenter', resetMouseIdleTimer);
      control.addEventListener('mousedown', resetMouseIdleTimer);
    });
  }
}

function setupTouchControls(seekSlider, volumeSlider) {
  let touchTarget = null;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  let touchMoved = false;

  function setupTouchButtons() {
    const clickableElements = document.querySelectorAll(
      'button, .control-btn, .play-btn, .torrent-card, .file-item, ' +
      '.search-result-item, .back-btn, .settings-btn, .view-tab, ' +
      '#play-pause-btn, #mute-btn, #prev-episode-btn, #next-episode-btn, ' +
      '#episodes-btn, #audio-btn, #exit-player-btn, #toggle-buffer-btn, ' +
      '.episode-item, .audio-item, .close-panel-btn, .filter-select, ' +
      '.filter-reset-btn, .progress-continue-btn, .detail-progress-btn, ' +
      '#close-search, #filter-toggle'
    );
    clickableElements.forEach(el => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchCancel);

      el.addEventListener('touchstart', handleTouchStart, { passive: true });
      el.addEventListener('touchend', handleTouchEnd, { passive: true });
      el.addEventListener('touchcancel', handleTouchCancel, { passive: true });
    });
  }

  function handleTouchStart(e) {
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
    const deltaX = e.changedTouches[0].clientX - touchStartX;
    const deltaY = e.changedTouches[0].clientY - touchStartY;
    const deltaTime = Date.now() - touchStartTime;

    if (touchTarget) {
      touchTarget.classList.remove('touch-active');
    }

    if (!touchMoved && deltaTime < 300 && Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) {
      if (touchTarget && (
        touchTarget.closest('button') ||
        touchTarget.closest('.control-btn') ||
        touchTarget.closest('.play-btn') ||
        touchTarget.closest('.torrent-card') ||
        touchTarget.closest('.file-item') ||
        touchTarget.closest('.search-result-item') ||
        touchTarget.closest('.episode-item') ||
        touchTarget.closest('.audio-item') ||
        touchTarget.id === 'close-search' ||
        touchTarget.id === 'filter-toggle'
      )) {
        e.preventDefault();
        touchTarget.click();
      }
    }
    touchStartX = 0;
    touchStartY = 0;
  }

  function handleTouchCancel(e) {
    if (touchTarget) {
      touchTarget.classList.remove('touch-active');
    }
    touchStartX = 0;
    touchStartY = 0;
  }

  if (seekSlider) {
    seekSlider.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      if (typeof AppState !== 'undefined') {
        AppState.isSliderDragging = true;
        AppState.suppressTimeUpdate = true;
      }
    }, { passive: true });
    seekSlider.addEventListener('touchmove', (e) => {
      e.stopPropagation();
    }, { passive: true });
    seekSlider.addEventListener('touchend', (e) => {
      e.stopPropagation();
      if (typeof AppState !== 'undefined') AppState.isSliderDragging = false;
      setTimeout(() => {
        if (typeof AppState !== 'undefined') AppState.suppressTimeUpdate = false;
      }, 100);
    }, { passive: true });
  }

  if (volumeSlider) {
    volumeSlider.addEventListener('touchstart', (e) => {
      e.stopPropagation();
    }, { passive: true });
    volumeSlider.addEventListener('touchmove', (e) => {
      e.stopPropagation();
    }, { passive: true });
    volumeSlider.addEventListener('touchend', (e) => {
      e.stopPropagation();
    }, { passive: true });
  }

  setupTouchButtons();

  const observer = new MutationObserver(() => {
    setupTouchButtons();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function setupAutoRefresh() {
  let autoRefreshInterval = null;

  function startAutoRefresh() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    autoRefreshInterval = setInterval(() => {
      const torrserverSection = document.getElementById('torrserver-section');
      if (torrserverSection && torrserverSection.style.display === 'block' &&
        AppState?.currentScreen !== 'player' &&
        AppState?.currentScreen !== 'detail' &&
        AppState?.currentScreen !== 'search' &&
        AppState?.currentScreen !== 'catalog') {
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

  const originalStartHLSPlayback = typeof startHLSPlayback === 'function' ? startHLSPlayback : null;
  if (originalStartHLSPlayback) {
    window.startHLSPlayback = function (...args) {
      stopAutoRefresh();
      return originalStartHLSPlayback.apply(this, args);
    };
  }

  const originalShowDetailView = typeof showDetailView === 'function' ? showDetailView : null;
  if (originalShowDetailView) {
    window.showDetailView = function (...args) {
      const result = originalShowDetailView.apply(this, args);
      startAutoRefresh();
      return result;
    };
  }
}

function setupFullscreen() {
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  if (!fullscreenBtn) return;

  const playerScreen = document.getElementById('player-screen');

  function toggleFullscreen() {
    const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;

    if (!isFullscreen) {
      const element = playerScreen || document.documentElement;
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
    const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
    fullscreenBtn.innerHTML = isFullscreen
      ? '<i class="fi fi-rr-compress"></i>'
      : '<i class="fi fi-rr-expand"></i>';
    fullscreenBtn.title = isFullscreen ? 'Выйти из полноэкранного режима' : 'Полный экран';
  }

  fullscreenBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFullscreen();
    if (typeof resetMouseIdleTimer === 'function') resetMouseIdleTimer();
  });

  document.addEventListener('fullscreenchange', updateFullscreenIcon);
  document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);
}

function setupAutoFullscreen() {
  const autoFullscreenCheckbox = document.getElementById('auto-fullscreen');
  if (!autoFullscreenCheckbox) return;

  const savedAutoFullscreen = localStorage.getItem('autoFullscreen') === 'true';
  autoFullscreenCheckbox.checked = savedAutoFullscreen;

  autoFullscreenCheckbox.addEventListener('change', (e) => {
    localStorage.setItem('autoFullscreen', e.target.checked);
    if (e.target.checked) {
      const element = document.documentElement;
      if (element.requestFullscreen) element.requestFullscreen();
      else if (element.webkitRequestFullscreen) element.webkitRequestFullscreen();
      else if (element.mozRequestFullScreen) element.mozRequestFullScreen();
      else if (element.msRequestFullscreen) element.msRequestFullscreen();
    }
  });

  function enterFullscreenIfEnabled() {
    const autoFullscreen = localStorage.getItem('autoFullscreen') === 'true';
    if (autoFullscreen) {
      setTimeout(() => {
        const element = document.documentElement;
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

function showInitError() {
  const errorDiv = document.createElement('div');
  errorDiv.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0,0,0,0.9);
    color: #ff6a6a;
    padding: 20px;
    border-radius: 12px;
    text-align: center;
    z-index: 10000;
    border: 1px solid #ff6a6a;
  `;
  errorDiv.innerHTML = `
    <div style="font-size: 48px; margin-bottom: 10px;">⚠️</div>
    <div style="margin-bottom: 10px;">Ошибка инициализации приложения</div>
    <div style="font-size: 12px; color: #aaa;">Попробуйте обновить страницу</div>
    <button onclick="location.reload()" style="margin-top: 15px; padding: 8px 20px; background: #4a9eff; border: none; border-radius: 6px; color: white; cursor: pointer;">Обновить</button>
  `;
  document.body.appendChild(errorDiv);
}

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ МЫШИ ====================

function resetMouseIdleTimer() {
  const playerScreen = document.getElementById('player-screen');
  const playerOverlay = document.getElementById('player-overlay');
  const controlsContainer = document.getElementById('controls-container');
  const bufferStats = document.getElementById('buffer-stats');
  const playerHint = document.getElementById('player-hint');
  const toggleBufferBtn = document.getElementById('toggle-buffer-btn');
  const exitPlayerBtn = document.getElementById('exit-player-btn');
  const episodesBtn = document.getElementById('episodes-btn');
  const episodesPanel = document.getElementById('episodes-panel');
  const prevBtn = document.getElementById('prev-episode-btn');
  const nextBtn = document.getElementById('next-episode-btn');
  const playerTitle = document.getElementById('player-title');

  if (!playerScreen || playerScreen.style.display !== 'block') return;

  if (playerOverlay) playerOverlay.classList.add('touch-active');

  const controlElements = [
    controlsContainer, bufferStats, playerHint,
    toggleBufferBtn, exitPlayerBtn, episodesBtn,
    prevBtn, nextBtn, playerTitle
  ];

  controlElements.forEach(el => {
    if (el) {
      el.classList.remove('idle-hidden');
      el.style.opacity = '1';
      el.style.pointerEvents = 'auto';
    }
  });
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

  window.mouseIdleTimer = setTimeout(() => {
    if (playerScreen.style.display === 'block') {
      if (playerOverlay) playerOverlay.classList.remove('touch-active');

      controlElements.forEach(el => {
        if (el) {
          el.classList.add('idle-hidden');
          el.style.opacity = '0';
          el.style.pointerEvents = 'none';
        }
      });
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

window.resetMouseIdleTimer = resetMouseIdleTimer;

function showPlayerHint(message) {
  const hint = document.getElementById('player-hint');
  if (!hint) return;
  hint.textContent = message;
  hint.style.opacity = '1';
  clearTimeout(window.hintTimeout);
  window.hintTimeout = setTimeout(() => {
    hint.style.opacity = '0';
  }, 2000);
}

window.showPlayerHint = showPlayerHint;

// Экспортируем функции для использования в других модулях
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
