// Инициализация приложения и обработчики событий
document.addEventListener('DOMContentLoaded', () => {
  init();
});

let checkServerTimeout = null;

async function init() {
  // Получаем ссылки на DOM элементы
  const seekSlider = document.getElementById('seek-slider');
  const volumeSlider = document.getElementById('volume-slider');
  const playPauseBtn = document.getElementById('play-pause-btn');
  const muteBtn = document.getElementById('mute-btn');
  const toggleBufferBtn = document.getElementById('toggle-buffer-btn');
  const exitPlayerBtn = document.getElementById('exit-player-btn');
  const overlay = document.getElementById('player-overlay');
  const videoPlayer = document.getElementById('video-player');
  const playerHint = document.getElementById('player-hint');

  // Инициализация значений
  seekSlider.value = 0;
  seekSlider.max = 100;
  volumeSlider.value = 1;

  // Загружаем сохраненную конфигурацию клиента
  await loadClientConfig();

  const ua = navigator.userAgent.toLowerCase();
  document.body.classList.toggle('msx', !!window.MSX || ua.includes('msx'));

  // Настройка обработчиков событий для плеера
  // Слайдер перемотки
  seekSlider.addEventListener('mousedown', () => {
    AppState.isSliderDragging = true;
    AppState.suppressTimeUpdate = true;
    resetMouseIdleTimer();
  });
  seekSlider.addEventListener('touchstart', () => {
    AppState.isSliderDragging = true;
    AppState.suppressTimeUpdate = true;
    resetMouseIdleTimer();
  });
  seekSlider.addEventListener('input', (e) => {
    const newPreviewTime = parseFloat(e.target.value);
    if (isFinite(newPreviewTime)) {
      AppState.previewTime = newPreviewTime;
      document.getElementById('current-time').textContent = formatTime(AppState.previewTime);
      if (AppState.isSeeking || document.getElementById('loading-player-overlay').classList.contains('active')) {
        document.getElementById('loading-time').textContent = formatTime(AppState.previewTime);
      }
    }
    resetMouseIdleTimer();
  });
  seekSlider.addEventListener('change', async (e) => {
    const targetAbsoluteTime = parseFloat(e.target.value);
    AppState.isSliderDragging = false;
    AppState.previewTime = targetAbsoluteTime;
    AppState.suppressTimeUpdate = true;

    if (!isFinite(targetAbsoluteTime) || targetAbsoluteTime < 0) {
      AppState.previewTime = null;
      AppState.suppressTimeUpdate = false;
      return;
    }

    console.log(`🎚️ Seek to: ${formatTime(targetAbsoluteTime)}`);

    if (!AppState.hls) {
      videoPlayer.currentTime = targetAbsoluteTime - AppState.seekOffset;
      AppState.previewTime = null;
      AppState.suppressTimeUpdate = false;
      updateTimeDisplay();
      resetMouseIdleTimer();
      return;
    }

    const controlBtns = document.querySelectorAll('.control-btn');
    controlBtns.forEach(btn => {
      btn.style.pointerEvents = 'none';
      btn.style.opacity = '0.5';
    });

    await seekStream(targetAbsoluteTime, 'slider');
    resetMouseIdleTimer();
  });
  seekSlider.addEventListener('mouseup', () => {
    setTimeout(() => {
      if (!AppState.isSliderDragging) return;
      AppState.isSliderDragging = false;
      if (!AppState.isSeeking) {
        AppState.previewTime = null;
        AppState.suppressTimeUpdate = false;
        updateTimeDisplay();
      }
    }, 200);
    resetMouseIdleTimer();
  });
  seekSlider.addEventListener('touchend', () => {
    setTimeout(() => {
      if (!AppState.isSliderDragging) return;
      AppState.isSliderDragging = false;
      if (!AppState.isSeeking) {
        AppState.previewTime = null;
        AppState.suppressTimeUpdate = false;
        updateTimeDisplay();
      }
    }, 200);
    resetMouseIdleTimer();
  });

  // Кнопки управления
  playPauseBtn.addEventListener('click', (e) => {
    if (AppState.isSeeking || document.getElementById('loading-player-overlay').classList.contains('active')) {
      e.preventDefault();
      return;
    }
    if (videoPlayer.paused) {
      videoPlayer.play().then(updatePlayPauseButton).catch(() => { });
    } else {
      videoPlayer.pause();
      updatePlayPauseButton();
    }
    resetMouseIdleTimer();
  });
  muteBtn.addEventListener('click', () => {
    if (AppState.isSeeking || document.getElementById('loading-player-overlay').classList.contains('active')) return;
    videoPlayer.muted = !videoPlayer.muted;
    updateMuteButton();
    resetMouseIdleTimer();
  });
  volumeSlider.addEventListener('input', (e) => {
    if (AppState.isSeeking || document.getElementById('loading-player-overlay').classList.contains('active')) return;
    const vol = parseFloat(e.target.value);
    videoPlayer.volume = vol;
    if (vol > 0 && videoPlayer.muted) {
      videoPlayer.muted = false;
      updateMuteButton();
    }
    resetMouseIdleTimer();
  });

  // Кнопка выхода из плеера
  exitPlayerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showDetailView();
    resetMouseIdleTimer();
    // Вызываем глобальную функцию остановки проверки
    if (typeof window.exitPlayer() === 'function') {
      window.exitPlayer();
    }
  });

  setupEpisodesButton();
  setupAudioButton();

  const prevEpisodeBtn = document.getElementById('prev-episode-btn');
  const nextEpisodeBtn = document.getElementById('next-episode-btn');
  if (prevEpisodeBtn) {
    prevEpisodeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      prevEpisode();
      resetMouseIdleTimer();
    });
  }
  if (nextEpisodeBtn) {
    nextEpisodeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      nextEpisode();
      resetMouseIdleTimer();
    });
  }

  // События видео
  videoPlayer.addEventListener('volumechange', () => {
    volumeSlider.value = videoPlayer.volume;
    updateMuteButton();
    resetMouseIdleTimer();
  });

  // Проверка флага isSeekHoldActive
  videoPlayer.addEventListener('timeupdate', () => {
    if (typeof isSeekHoldActive !== 'undefined' && isSeekHoldActive) {
      return;
    }

    if (AppState.isSliderDragging || AppState.suppressTimeUpdate) {
      return;
    }
    const totalDuration = AppState.originalDuration || AppState.expectedDuration || videoPlayer.duration;

    if (totalDuration && isFinite(totalDuration) && totalDuration > 0) {
      seekSlider.max = totalDuration;
      const absoluteTime = videoPlayer.currentTime + AppState.seekOffset;
      seekSlider.value = Math.min(absoluteTime, totalDuration);
      updateTimeDisplay();
    }
  });

  videoPlayer.addEventListener('loadedmetadata', () => {
    console.log('📊 loadedmeta', videoPlayer.duration);
    if (AppState.expectedDuration) {
      forceUpdateDuration(AppState.expectedDuration, AppState.originalDuration, AppState.seekOffset);
    }
    resetMouseIdleTimer();
  });
  videoPlayer.addEventListener('progress', updateBufferDisplay);
  videoPlayer.addEventListener('ended', () => {
    console.log('🏁 Видео закончилось');
    updatePlayPauseButton();
    resetMouseIdleTimer();
  });

  setInterval(() => {
    if (AppState.currentScreen === 'player' && !AppState.bufferHidden && !AppState.isSeeking) {
      updateBufferDisplay();
    }
  }, 300);

  toggleBufferBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    AppState.bufferHidden = !AppState.bufferHidden;
    toggleBufferBtn.style.opacity = AppState.bufferHidden ? '0.6' : '1';
    toggleBufferBtn.title = AppState.bufferHidden ? 'показать буфер' : 'скрыть буфер';
    if (!AppState.bufferHidden) updateBufferDisplay();
    else document.getElementById('buffer-stats').classList.add('hidden');
    resetMouseIdleTimer();
  });

  function showControls() {
    overlay.classList.add('touch-active');
    clearTimeout(overlay.timer);
    overlay.timer = setTimeout(() => {
      if (!overlay.matches(':hover')) overlay.classList.remove('touch-active');
    }, 3000);
  }
  overlay.addEventListener('mousemove', (e) => {
    showControls();
    resetMouseIdleTimer();
  });
  overlay.addEventListener('touchstart', (e) => {
    showControls();
    resetMouseIdleTimer();
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
    resetMouseIdleTimer();
  });

  // Навигация
  document.getElementById('settings-btn').addEventListener('click', () => {
    document.getElementById('torrserver-section').style.display = 'none';
    document.getElementById('config-screen').style.display = 'flex';
    AppState.currentScreen = 'config';
    setTimeout(() => {
      updateFocusableElements();
      setFocus(0);
    }, 300);
  });

  // Кнопка назад из детального просмотра
  document.getElementById('back-from-detail').addEventListener('click', () => {
    console.log('🔙 Возврат из детального просмотра');
    if (!AppState.isSearch) {
      document.getElementById('detail-view').style.display = 'none';
    }
    const mainContainer = document.getElementById('main-container');
    if (mainContainer) {
      mainContainer.style.pointerEvents = 'auto';
    }
    document.getElementById('torrserver-section').style.display = 'block';
    AppState.detailReturnTo = AppState.inSearch;
    const returnTo = !AppState.isSearch
      ? (AppState.detailReturnTo === 'catalog' ? 'catalog' : 'torrents')
      : 'search';

    const currentTorrentHash = AppState.currentDetailItem?.hash;
    console.log('🔍 Hash для восстановления:', currentTorrentHash, 'returnTo=', returnTo);

    // Даем время на перерисовку
    setTimeout(() => {
      if (typeof updateFocusableElements !== 'function' || typeof setFocus !== 'function') {
        console.error('❌ Функции навигации еще не загружены');
        return;
      }

      if (returnTo === 'catalog') {
        if (typeof window.ensureCatalogFocus === 'function') {
          window.ensureCatalogFocus(true);
          document.getElementById('detail-view').style.display = 'none';
          return;
        }
        if (typeof window.focusFirstCatalogCard === 'function') {
          window.focusFirstCatalogCard();
          document.getElementById('detail-view').style.display = 'none';
          return;
        }
      } else if (returnTo === 'search') {
        if (AppState.isSearch) {
          AppState.isSearch = false;
          window.showSearchResults();
        } else{
          window.clearSearchResults();
        }
        document.getElementById('detail-view').style.display = 'none';
        return;
      }

      window.clearSearchResultsContainer();
      AppState.currentScreen = 'torrents';
      updateFocusableElements();

      let targetIndex = -1;

      // Сначала пробуем найти по hash
      if (currentTorrentHash) {
        console.log('🔍 Поиск карточки с hash:', currentTorrentHash);

        // Ищем карточку в focusableElements по dataset.hash
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

      // Если не нашли по hash, пробуем по сохраненному индексу
      if (targetIndex === -1 && typeof lastSelectedTorrentIndex !== 'undefined') {
        console.log('🔍 Поиск по сохраненному индексу:', lastSelectedTorrentIndex);

        // Находим все карточки торрентов
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

      // Если все еще не нашли, берем первую карточку
      if (targetIndex === -1) {
        const firstCardIndex = focusableElements.findIndex(el =>
          el.classList && el.classList.contains('torrent-card')
        );
        targetIndex = firstCardIndex !== -1 ? firstCardIndex : 0;
        console.log('⚠️ Используем первую карточку, индекс:', targetIndex);
      }

      setFocus(targetIndex);
    }, 250); // Увеличил задержку для гарантии
  });

  // Кнопка назад из каталога
  //const backFromCatalog = document.getElementById('back-from-catalog');
  //if (backFromCatalog) {
  //backFromCatalog.addEventListener('click', () => {
  //if (typeof window.backToCatalogList === 'function') {
  //window.backToCatalogList();
  //}
  //});
  //}

  // Поиск торрентов
  const searchInput = document.getElementById('search-query');
  const searchBtn = document.getElementById('search-btn');
  const closeSearchBtn = document.getElementById('close-search');
  const tabTorrents = document.getElementById('tab-torrents');
  const tabSearch = document.getElementById('tab-search');
  const tabCatalog = document.getElementById('tab-catalog');

  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      const query = searchInput ? searchInput.value.trim() : '';
      showSearchResults();
      if (query) {
        searchTorrents(query);
      }
    });
  }
  if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const query = searchInput.value.trim();
        searchTorrents(query);
      }
    });
  }

  if (closeSearchBtn) {
    closeSearchBtn.addEventListener('click', () => {
      hideSearchResults();
    });
  }

  if (tabTorrents) {
    tabTorrents.addEventListener('click', () => {
      console.log('📁 Переключение на вкладку "Мои торренты"');
      // Очищаем временные данные каталога при переключении
      window.pendingCatalogPoster = null;
      window.pendingCatalogItem = null;
      AppState.inSearch = 'torrents';

      // Скрываем результаты поиска если они открыты
      hideSearchResults();

      // Обновляем активные вкладки
      tabTorrents.classList.add('active');
      if (tabSearch) tabSearch.classList.remove('active');
      if (tabCatalog) tabCatalog.classList.remove('active');

      // Скрываем оверлей поиска
      const searchOverlay = document.getElementById('search-overlay');
      if (searchOverlay) {
        searchOverlay.classList.add('hidden');
      }

      // Устанавливаем текущий экран
      AppState.currentScreen = 'torrents';

      // Показываем загрузку
      const torrentsGrid = document.getElementById('torrents-grid');
      if (torrentsGrid) {
        torrentsGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">
          <div class="loading-spinner" style="margin: 0 auto 20px;"></div>
          <div style="font-size: 16px; color: #aaa;">Загрузка торрентов...</div>
        </div>
      `;
      }

      // Загружаем торренты
      loadTorrents(true).then(() => {
        console.log('✅ Торренты загружены');

        // Обновляем фокус
        setTimeout(() => {
          updateFocusableElements();
          if (typeof window.focusFirstTorrentCard === 'function') {
            window.focusFirstTorrentCard();
          }
        }, 200);
      }).catch(error => {
        console.error('❌ Ошибка загрузки торрентов:', error);
        if (torrentsGrid) {
          torrentsGrid.innerHTML = `
          <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">
            <div style="font-size: 48px; margin-bottom: 20px;">❌</div>
            <div style="font-size: 16px; color: #ff6a6a;">Ошибка загрузки торрентов</div>
            <button class="btn" style="margin-top: 20px;" onclick="document.getElementById('tab-torrents').click()">Попробовать снова</button>
          </div>
        `;
        }
      });
    });
  }

  if (tabSearch) {
    tabSearch.addEventListener('click', () => {
      showSearchResults();
      if (searchInput && searchInput.value.trim() && searchResults.length === 0) {
        searchTorrents(searchInput.value.trim());
      }
    });
  }

  // Вкладка каталога
  if (tabCatalog) {
    tabCatalog.addEventListener('click', () => {
      AppState.inSearch = 'catalog';

      // Очищаем временные данные каталога при переключении
      window.pendingCatalogPoster = null;
      window.pendingCatalogItem = null;

      // Сбрасываем сохраненный индекс для восстановления фокуса
      catalogState.lastSelectedIndex = 0;
      catalogState.lastSelectedId = null;

      // Очищаем localStorage, чтобы при следующем входе в каталог фокус был на первой карточке
      localStorage.removeItem('lastCatalogCardIndex');

      // Скрываем результаты поиска если они открыты
      hideSearchResults();

      // Показываем список каталогов
      document.getElementById('search-overlay').classList.add('hidden');
      document.getElementById('tab-torrents').classList.remove('active');
      document.getElementById('tab-search').classList.remove('active');
      tabCatalog.classList.add('active');

      AppState.currentScreen = 'catalog';

      // Загружаем список каталогов
      if (typeof window.loadCatalogList === 'function') {
        window.loadCatalogList();
      }

      // Обновляем фокус
      setTimeout(() => {
        updateFocusableElements();
        if (typeof window.focusFirstCatalogCard === 'function') {
          window.focusFirstCatalogCard();
        }
      }, 200);
    });
  }

  // Инициализация фильтров поиска
  const filterToggleBtn = document.getElementById('filter-toggle');
  const torrentmovie = document.getElementById('torrent-movie');
  const sortBy = document.getElementById('sort-by');
  const filterQuality = document.getElementById('filter-quality');
  const filterTracker = document.getElementById('filter-tracker');
  const filterYear = document.getElementById('filter-year');
  const resetFiltersBtn = document.getElementById('reset-filters');

  if (filterToggleBtn) {
    filterToggleBtn.addEventListener('click', () => {
      const opened = typeof toggleSearchFiltersPanel === 'function' ? toggleSearchFiltersPanel() : false;
      if (opened && typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
        setTimeout(() => {
          updateFocusableElements();
          const firstFilterIndex = focusableElements.findIndex(el => ['torrent-movie', 'sort-by', 'filter-quality', 'filter-tracker', 'filter-year', 'reset-filters'].includes(el.id));
          if (firstFilterIndex !== -1) {
            setFocus(firstFilterIndex);
          }
        }, 60);
      }
    });
  }
  if (torrentmovie) {
    torrentmovie.addEventListener('change', (e) => {
      currentSort = e.target.value;
      applyFiltersAndSort();
    });
  }
  if (sortBy) {
    sortBy.addEventListener('change', (e) => {
      currentSort = e.target.value;
      applyFiltersAndSort();
    });
  }
  if (filterQuality) {
    filterQuality.addEventListener('change', (e) => {
      currentQualityFilter = e.target.value;
      applyFiltersAndSort();
    });
  }
  if (filterTracker) {
    filterTracker.addEventListener('change', (e) => {
      currentTrackerFilter = e.target.value;
      applyFiltersAndSort();
    });
  }
  if (filterYear) {
    filterYear.addEventListener('input', (e) => {
      currentYearFilter = e.target.value;
      applyFiltersAndSort();
    });
  }
  if (resetFiltersBtn) {
    resetFiltersBtn.addEventListener('click', resetFilters);
  }

  // Автоматическая проверка при вводе URL
  const torrserverUrl = document.getElementById('torrserver-url');
  if (torrserverUrl) {
    torrserverUrl.addEventListener('input', (e) => {
      if (checkServerTimeout) {
        clearTimeout(checkServerTimeout);
      }
      checkServerTimeout = setTimeout(() => {
        checkServer(true);
      }, 300);
    });
  }

  // Аутентификация
  document.getElementById('auth-checkbox').addEventListener('change', (e) => {
    AppState.authEnabled = e.target.checked;
    if (AppState.authEnabled) {
      document.getElementById('auth-fields').classList.add('visible');
    } else {
      document.getElementById('auth-fields').classList.remove('visible');
    }
    if (checkServerTimeout) {
      clearTimeout(checkServerTimeout);
    }
    checkServerTimeout = setTimeout(() => {
      checkServer(true);
    }, 500);
  });

  document.getElementById('auth-login').addEventListener('input', () => {
    if (checkServerTimeout) {
      clearTimeout(checkServerTimeout);
    }
    checkServerTimeout = setTimeout(() => {
      checkServer(true);
    }, 300);
  });
  document.getElementById('auth-password').addEventListener('input', () => {
    if (checkServerTimeout) {
      clearTimeout(checkServerTimeout);
    }
    checkServerTimeout = setTimeout(() => {
      checkServer(true);
    }, 300);
  });

  // Обработчики для автоматического скрытия элементов в плеере
  const playerScreen = document.getElementById('player-screen');
  if (playerScreen) {
    playerScreen.addEventListener('mousemove', resetMouseIdleTimer);
    playerScreen.addEventListener('mousedown', resetMouseIdleTimer);
    playerScreen.addEventListener('mouseenter', resetMouseIdleTimer);
  }

  const controls = document.querySelectorAll('.control-btn, #seek-slider, #volume-slider');
  controls.forEach(control => {
    control.addEventListener('mouseenter', resetMouseIdleTimer);
    control.addEventListener('mousedown', resetMouseIdleTimer);
  });

  window.addEventListener('beforeunload', () => {
    if (AppState.currentStreamId) {
      navigator.sendBeacon(`${SERVER_URL}/hls/stop/${AppState.currentStreamId}`);
    }
  });

  // ============ СЕНСОРНОЕ УПРАВЛЕНИЕ ============
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
      '.filter-reset-btn, .progress-continue-btn, .detail-progress-btn'+
      '#close-search', '#filter-toggle'
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
        touchTarget.closest('.audio-item')
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

  seekSlider.addEventListener('touchstart', (e) => {
    e.stopPropagation();
    AppState.isSliderDragging = true;
    AppState.suppressTimeUpdate = true;
  }, { passive: true });
  seekSlider.addEventListener('touchmove', (e) => {
    e.stopPropagation();
  }, { passive: true });
  seekSlider.addEventListener('touchend', (e) => {
    e.stopPropagation();
    AppState.isSliderDragging = false;
    setTimeout(() => {
      AppState.suppressTimeUpdate = false;
    }, 100);
  }, { passive: true });

  volumeSlider.addEventListener('touchstart', (e) => {
    e.stopPropagation();
  }, { passive: true });
  volumeSlider.addEventListener('touchmove', (e) => {
    e.stopPropagation();
  }, { passive: true });
  volumeSlider.addEventListener('touchend', (e) => {
    e.stopPropagation();
  }, { passive: true });

  setupTouchButtons();

  const observer = new MutationObserver(() => {
    setupTouchButtons();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  setTimeout(() => {
    const savedUrl = document.getElementById('torrserver-url').value;
    if (savedUrl) {
      checkServer(true);
    }
  }, 300);

  console.log('🎬 VideoLoop инициализирован');
  if (AppState.clientId) {
    console.log('👤 Client ID:', AppState.clientId);
  }

  let autoRefreshInterval = null;
  function startAutoRefresh() {
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
    }
    autoRefreshInterval = setInterval(() => {
      if (document.getElementById('torrserver-section').style.display === 'block' &&
        AppState.currentScreen !== 'player' &&
        AppState.currentScreen !== 'detail' &&
        AppState.currentScreen !== 'search' &&
        AppState.currentScreen !== 'catalog') {
        console.log('🔄 Автоматическое обновление списка торрентов');
        loadTorrents();
      }
    }, 300000);
  }
  function stopAutoRefresh() {
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
      autoRefreshInterval = null;
    }
  }

  const originalStartHLSPlayback = startHLSPlayback;
  window.startHLSPlayback = function (...args) {
    stopAutoRefresh();
    return originalStartHLSPlayback.apply(this, args);
  };

  const originalShowDetailView = showDetailView;
  window.showDetailView = function (...args) {
    const result = originalShowDetailView.apply(this, args);
    startAutoRefresh();
    return result;
  };

  // ============ УПРАВЛЕНИЕ С ПУЛЬТА ============
  let focusableElements = [];
  let currentFocusIndex = 0;
  let lastSelectedTorrentHash = null;
  let lastSelectedTorrentIndex = 0;

  // Переменные для удержания клавиш перемотки
  let seekHoldInterval = null;
  let seekHoldStep = 5;
  let seekHoldDelay = 150;
  let isSeekHoldActive = false;

  let lastPlayerBackPressAt = 0;

  function isPlayerControlsVisible() {
    const controlsContainer = document.getElementById('controls-container');
    return !!controlsContainer && !controlsContainer.classList.contains('idle-hidden');
  }

  function getTorrentGridColumns() {
    const grid = document.getElementById('torrents-grid');
    if (!grid) return 8;
    const style = window.getComputedStyle(grid);
    const cols = style.gridTemplateColumns ? style.gridTemplateColumns.split(' ').filter(Boolean).length : 0;
    return cols || 8;
  }

  function focusFirstTorrentCard(retries = 6, delay = 120) {
    if (AppState.currentScreen !== 'torrents') return false;
    updateFocusableElements();
    const firstCardIndex = focusableElements.findIndex(el => el.classList && el.classList.contains('torrent-card'));
    if (firstCardIndex !== -1) {
      setFocus(firstCardIndex);
      return true;
    }
    if (retries > 0) {
      setTimeout(() => focusFirstTorrentCard(retries - 1, delay), delay);
    }
    return false;
  }

  function focusSearchHome(preferQuery = true) {
    updateFocusableElements();
    const queryIndex = focusableElements.findIndex(el => el.id === 'search-query');
    const searchBtnIndex = focusableElements.findIndex(el => el.id === 'search-btn');
    const filterIndex = focusableElements.findIndex(el => ['filter-toggle', 'torrent-movie', 'sort-by', 'filter-quality', 'filter-tracker', 'filter-year', 'reset-filters', 'close-search'].includes(el.id));
    const targetIndex = preferQuery && queryIndex !== -1
      ? queryIndex
      : (searchBtnIndex !== -1 ? searchBtnIndex : (filterIndex !== -1 ? filterIndex : 0));
    setFocus(targetIndex);
  }

  function showPlayerControls(preferredFocusId = 'play-pause-btn') {
    const ids = [
      'controls-container', 'buffer-stats', 'player-hint', 'toggle-buffer-btn',
      'exit-player-btn', 'episodes-btn', 'prev-episode-btn', 'next-episode-btn',
      'audio-btn', 'player-title'
    ];
    ids.forEach(id => document.getElementById(id)?.classList.remove('idle-hidden'));
    if (typeof window.syncPlayerTitleVisibility === 'function') {
      window.syncPlayerTitleVisibility(true);
    }
    document.getElementById('player-title')?.classList.remove('hidden');
    resetMouseIdleTimer();
    setTimeout(() => {
      updateFocusableElements();
      const targetIndex = focusableElements.findIndex(el => el.id === preferredFocusId);
      setFocus(targetIndex !== -1 ? targetIndex : 0);
    }, 60);
  }

  function hidePlayerControls() {
    const ids = [
      'controls-container', 'buffer-stats', 'player-hint', 'toggle-buffer-btn',
      'exit-player-btn', 'episodes-btn', 'prev-episode-btn', 'next-episode-btn',
      'audio-btn', 'player-title'
    ];
    ids.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        console.log(`Найден элемент: ${id}`); // отладка
        element.classList.add('idle-hidden');
      } else {
        console.warn(`Элемент не найден: ${id}`); // отладка
      }
    });
    if (typeof window.syncPlayerTitleVisibility === 'function') {
      window.syncPlayerTitleVisibility(false);
    }
    document.getElementById('player-title')?.classList.add('hidden');
    document.querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));
    currentFocusIndex = 0;
    if (mouseIdleTimer) {
      clearTimeout(mouseIdleTimer);
      mouseIdleTimer = null;
    }
  }

  function hidePlayerPanelsOnly() {
    let hidden = false;
    const episodesPanel = document.getElementById('episodes-panel');
    const audioPanel = document.getElementById('audio-panel');
    if (episodesPanel && !episodesPanel.classList.contains('hidden')) {
      episodesPanel.classList.add('hidden');
      document.getElementById('episodes-btn')?.classList.remove('active');
      hidden = true;
    }
    if (audioPanel && !audioPanel.classList.contains('hidden')) {
      audioPanel.classList.add('hidden');
      document.getElementById('audio-btn')?.classList.remove('active');
      hidden = true;
    }
    return hidden;
  }

  function hidePlayerUi() {
    const panelsHidden = hidePlayerPanelsOnly();
    const controlsWereVisible = isPlayerControlsVisible();
    if (controlsWereVisible) {
      hidePlayerControls();
    }
    if (panelsHidden || controlsWereVisible) {
      document.getElementById('player-title')?.classList.add('hidden');
    }
    return panelsHidden || controlsWereVisible;
  }

  function updateFocusableElements() {
    const screen = AppState.currentScreen;

    const episodesPanel = document.getElementById('episodes-panel');
    const audioPanel = document.getElementById('audio-panel');
    const isEpisodesOpen = episodesPanel && !episodesPanel.classList.contains('hidden');
    const isAudioOpen = audioPanel && !audioPanel.classList.contains('hidden');

    if (isEpisodesOpen) {
      focusableElements = Array.from(document.querySelectorAll('.episode-item, .close-panel-btn'))
        .filter(el => el && el.offsetParent !== null);
      console.log('🎯 Фокус на панели серий');
      return;
    }

    if (isAudioOpen) {
      focusableElements = Array.from(document.querySelectorAll('.audio-item, .close-panel-btn'))
        .filter(el => el && el.offsetParent !== null);
      console.log('🎯 Фокус на панели аудио');
      return;
    }

    if (screen === 'player') {
      const controlsContainer = document.getElementById('controls-container');
      const controlsVisible = !!controlsContainer && !controlsContainer.classList.contains('idle-hidden');

      if (controlsVisible) {
        const seekSliderEl = document.getElementById('seek-slider');
        const buttons = Array.from(document.querySelectorAll(
          '#prev-episode-btn, #play-pause-btn, #next-episode-btn, #audio-btn, #episodes-btn, #mute-btn'
        )).filter(el => el && el.offsetParent !== null);

        focusableElements = [seekSliderEl, ...buttons].filter(el => el && el.offsetParent !== null);
      } else {
        focusableElements = [];
      }
    } else if (screen === 'detail') {
      const progressElements = Array.from(document.querySelectorAll('.detail-progress-btn'));
      const fileElements = Array.from(document.querySelectorAll('.file-item'));
      const backButton = Array.from(document.querySelectorAll('.back-btn'));
      focusableElements = [...progressElements, ...fileElements, ...backButton];
    } else if (screen === 'torrents') {
      const searchInputEl = document.getElementById('search-query');
      const searchBtnEl = document.getElementById('search-btn');
      const settingsBtnEl = document.getElementById('settings-btn');
      const tabTorrentsEl = document.getElementById('tab-torrents');
      const tabSearchEl = document.getElementById('tab-search');
      const tabCatalogEl = document.getElementById('tab-catalog');
      const cards = Array.from(document.querySelectorAll('.torrent-card')).filter(el => el && el.offsetParent !== null);
      const cardsPerRow = getTorrentGridColumns();

      const rows = [];
      for (let i = 0; i < cards.length; i += cardsPerRow) {
        rows.push(cards.slice(i, i + cardsPerRow));
      }

      window.torrentRows = {
        row1: [searchInputEl, searchBtnEl, settingsBtnEl].filter(Boolean),
        row2: [tabTorrentsEl, tabSearchEl, tabCatalogEl].filter(Boolean),
        cardRows: rows,
        allCards: cards
      };

      focusableElements = [
        ...cards,
        searchInputEl,
        searchBtnEl,
        tabTorrentsEl,
        tabSearchEl,
        tabCatalogEl,
        settingsBtnEl
      ].filter(el => el && el.offsetParent !== null);
    } else if (screen === 'catalog') {
      const cards = Array.from(document.querySelectorAll('.torrent-card.catalog-card, .torrent-card.catalog-folder-card'))
        .filter(el => el && el.offsetParent !== null);
      focusableElements = cards;
      window.catalogCards = cards;
    } else if (screen === 'search') {
      const searchInputEl = document.getElementById('search-query');
      const filterToggleEl = document.getElementById('filter-toggle');
      const searchBtnEl = document.getElementById('search-btn');
      const closeSearchEl = document.getElementById('close-search');
      const filterControls = Array.from(document.querySelectorAll(
        '#torrent-movie, #sort-by, #filter-quality, #filter-tracker, #filter-year, #reset-filters'
      )).filter(el => el && el.offsetParent !== null);
      const resultItems = Array.from(document.querySelectorAll('.search-result-item')).filter(el => el && el.offsetParent !== null);
      focusableElements = [searchInputEl, filterToggleEl, searchBtnEl, closeSearchEl, ...filterControls, ...resultItems].filter(Boolean);
    } else if (screen === 'config') {
      focusableElements = Array.from(document.querySelectorAll(
        '#torrserver-url, #auth-checkbox, #auth-login, #auth-password, .settings-btn'
      ));
    } else {
      focusableElements = [];
    }

    focusableElements = focusableElements.filter(el => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        el.offsetParent !== null;
    });

    if (currentFocusIndex >= focusableElements.length) {
      currentFocusIndex = 0;
    }

    console.log(`🎯 Найдено ${focusableElements.length} фокусируемых элементов на экране ${screen}`);
  }

  function setFocus(index) {
    document.querySelectorAll('.focused').forEach(el => {
      el.classList.remove('focused');
    });
    if (focusableElements.length === 0) return;

    if (index < 0) index = focusableElements.length - 1;
    if (index >= focusableElements.length) index = 0;

    currentFocusIndex = index;
    const element = focusableElements[currentFocusIndex];

    if (AppState.currentScreen === 'torrents') {
      if (element && element.classList.contains('torrent-card')) {
        const torrentIndex = currentFocusIndex - ((window.torrentRows?.row1?.length || 0) + (window.torrentRows?.row2?.length || 0));

        if (AppState.torrents[torrentIndex] && AppState.torrents[torrentIndex].hash) {
          lastSelectedTorrentHash = AppState.torrents[torrentIndex].hash;
          lastSelectedTorrentIndex = torrentIndex;
        } else if (element.dataset.hash) {
          lastSelectedTorrentHash = element.dataset.hash;
          lastSelectedTorrentIndex = torrentIndex >= 0 ? torrentIndex : 0;
        }
        window.lastSelectedTorrentHash = lastSelectedTorrentHash;
        window.lastSelectedTorrentIndex = lastSelectedTorrentIndex;
      }
    }

    if (element) {
      element.classList.add('focused');

      if (element.id === 'search-query') {
        if (document.activeElement && document.activeElement.tagName === 'INPUT') {
          document.activeElement.blur();
        }
      } else if (element.id === 'torrserver-url' ||
        element.id === 'auth-login' ||
        element.id === 'auth-password') {
        if (document.activeElement && document.activeElement.tagName === 'INPUT') {
          document.activeElement.blur();
        }
      } else {
        if (document.activeElement && document.activeElement.tagName === 'INPUT') {
          document.activeElement.blur();
        }
      }

      element.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'center'
      });
      console.log(`🎯 Фокус на элементе:`, element);
    }
  }

  let seekInterval = null;
  let seekDirection = null;
  const SEEK_DELAY = 100;
  const SEEK_STEP = 5;

  function navigate(direction) {
    const activeElement = document.activeElement;
    if (activeElement && activeElement.id === 'search-query') {
      activeElement.blur();
      updateFocusableElements();
      if (AppState.currentScreen === 'search') {
        const firstFilterIndex = focusableElements.findIndex(el =>
          ['filter-toggle', 'sort-by', 'filter-quality', 'filter-tracker', 'filter-year', 'reset-filters', 'close-search'].includes(el.id)
        );
        const firstResultIndex = focusableElements.findIndex(el => el.classList.contains('search-result-item'));
        if (direction === 'down' && firstResultIndex !== -1) {
          setFocus(firstResultIndex);
        } else {
          setFocus(firstFilterIndex !== -1 ? firstFilterIndex : (firstResultIndex !== -1 ? firstResultIndex : 0));
        }
        return;
      }
      const firstCardIndex = focusableElements.findIndex(el =>
        el.classList.contains('torrent-card')
      );
      setFocus(firstCardIndex !== -1 ? firstCardIndex : 0);
      return;
    }
    if (focusableElements.length === 0) {
      updateFocusableElements();
      if (focusableElements.length === 0) return;
      if (AppState.currentScreen === 'torrents') {
        const firstCardIndex = focusableElements.findIndex(el => el.classList.contains('torrent-card'));
        setFocus(firstCardIndex !== -1 ? firstCardIndex : 0);
      } else if (AppState.currentScreen === 'search') {
        const firstFilterIndex = focusableElements.findIndex(el => ['filter-toggle', 'sort-by', 'filter-quality', 'filter-tracker', 'filter-year', 'reset-filters', 'close-search'].includes(el.id));
        setFocus(firstFilterIndex !== -1 ? firstFilterIndex : 0);
      }
      return;
    }

    const currentElement = focusableElements[currentFocusIndex];

    // ===== НАВИГАЦИЯ ДЛЯ ТОРРЕНТОВ =====
    if (AppState.currentScreen === 'torrents') {
      const settingsBtnEl = document.getElementById('settings-btn');
      const tabTorrentsEl = document.getElementById('tab-torrents');
      const tabSearchEl = document.getElementById('tab-search');
      const tabCatalogEl = document.getElementById('tab-catalog');
      const cards = window.torrentRows?.allCards || [];

      if (!currentElement) {
        if (cards.length > 0) {
          setFocus(focusableElements.indexOf(cards[0]));
        } else {
          const fallbackIndex = focusableElements.findIndex(el => el.id === 'tab-torrents');
          setFocus(fallbackIndex !== -1 ? fallbackIndex : 0);
        }
        return;
      }

      const isSettings = currentElement === settingsBtnEl;
      const isTabTorrents = currentElement === tabTorrentsEl;
      const isTabSearch = currentElement === tabSearchEl;
      const isTabCatalog = currentElement === tabCatalogEl;
      const isCard = cards.includes(currentElement);

      const cardIndex = isCard ? cards.indexOf(currentElement) : -1;
      const cardsPerRow = getTorrentGridColumns();

      switch (direction) {
        case 'up':
          if (isCard) {
            if (cardIndex < cardsPerRow) {
              setFocus(focusableElements.indexOf(tabTorrentsEl));
            } else {
              const newIndex = cardIndex - cardsPerRow;
              setFocus(focusableElements.indexOf(cards[newIndex]));
            }
          } else if (isTabTorrents || isTabSearch || isTabCatalog) {
            if (cards.length > 0) {
              setFocus(focusableElements.indexOf(cards[0]));
            }
          }
          break;

        case 'down':
          if (isSettings) {
            setFocus(focusableElements.indexOf(tabTorrentsEl));
          } else if (isTabTorrents || isTabSearch || isTabCatalog) {
            if (cards.length > 0) {
              setFocus(focusableElements.indexOf(cards[0]));
            }
          } else if (isCard) {
            if (cardIndex + cardsPerRow < cards.length) {
              const newIndex = cardIndex + cardsPerRow;
              setFocus(focusableElements.indexOf(cards[newIndex]));
            }
          }
          break;

        case 'left':
          if (isSettings) {
            setFocus(focusableElements.indexOf(tabCatalogEl));
          } else if (isTabCatalog) {
            setFocus(focusableElements.indexOf(tabSearchEl));
          } else if (isTabSearch) {
            setFocus(focusableElements.indexOf(tabTorrentsEl));
          } else if (isCard && cardIndex > 0 && cardIndex % cardsPerRow !== 0) {
            setFocus(focusableElements.indexOf(cards[cardIndex - 1]));
          }
          break;

        case 'right':
          if (isTabTorrents) {
            setFocus(focusableElements.indexOf(tabSearchEl));
          } else if (isTabSearch) {
            setFocus(focusableElements.indexOf(tabCatalogEl));
          } else if (isCard && cardIndex < cards.length - 1 && (cardIndex + 1) % cardsPerRow !== 0) {
            setFocus(focusableElements.indexOf(cards[cardIndex + 1]));
          }
          break;
      }
      return;
    }

    // ===== НАВИГАЦИЯ ДЛЯ КАТАЛОГА =====
    if (AppState.currentScreen === 'catalog') {
      const cards = window.catalogCards || [];
      if (cards.length === 0) return;

      const currentIndex = cards.indexOf(currentElement);
      const cardsPerRow = getTorrentGridColumns();

      switch (direction) {
        case 'left':
          if (currentIndex > 0 && currentIndex % cardsPerRow !== 0) {
            setFocus(focusableElements.indexOf(cards[currentIndex - 1]));
          }
          break;
        case 'right':
          if (currentIndex < cards.length - 1 && (currentIndex + 1) % cardsPerRow !== 0) {
            setFocus(focusableElements.indexOf(cards[currentIndex + 1]));
          }
          break;
        case 'up':
          if (currentIndex >= cardsPerRow) {
            setFocus(focusableElements.indexOf(cards[currentIndex - cardsPerRow]));
          }
          break;
        case 'down':
          if (currentIndex + cardsPerRow < cards.length) {
            setFocus(focusableElements.indexOf(cards[currentIndex + cardsPerRow]));

            // Проверяем, нужно ли подгрузить следующую страницу
            if (typeof window.checkAndLoadMoreOnNavigation === 'function') {
              window.checkAndLoadMoreOnNavigation();
            }
          } else if (currentIndex === cards.length - 1) {
            // Если мы на последней карточке и жмем вниз, тоже проверяем
            if (typeof window.checkAndLoadMoreOnNavigation === 'function') {
              window.checkAndLoadMoreOnNavigation();
            }
          }
          break;
      }
      return;
    }

    // ===== НАВИГАЦИЯ ДЛЯ ПЛЕЕРА И ПАНЕЛЕЙ =====
    if (AppState.currentScreen === 'player') {
      const controlsContainer = document.getElementById('controls-container');
      const controlsVisible = !controlsContainer.classList.contains('idle-hidden');

      if (!controlsVisible) {
        return;
      }

      const playerCurrentElement = focusableElements[currentFocusIndex];
      const isSeekSliderFocused = playerCurrentElement && playerCurrentElement.id === 'seek-slider';

      // Проверка: открыты ли панели серий или аудио?
      const episodesPanel = document.getElementById('episodes-panel');
      const audioPanel = document.getElementById('audio-panel');
      const isPanelOpen = (episodesPanel && !episodesPanel.classList.contains('hidden')) ||
        (audioPanel && !audioPanel.classList.contains('hidden'));

      if (isPanelOpen) {
        if (direction === 'up') {
          setFocus(currentFocusIndex - 1);
          return;
        }
        if (direction === 'down') {
          setFocus(currentFocusIndex + 1);
          return;
        }
        if (direction === 'left' || direction === 'right') {
          return;
        }
        return;
      }

      // Логика для основного интерфейса плеера (слайдер + кнопки)
      if (isSeekSliderFocused) {
        // Логика для ползунка перемотки
        if (direction === 'down') {
          // Переход на первую кнопку (индекс 1)
          if (focusableElements.length > 1) {
            setFocus(1);
          }
          return;
        }
        // Влево/Вправо игнорируем здесь (обрабатываются в keydown для перемотки)
        if (direction === 'left' || direction === 'right') {
          return;
        }
        // Вверх - ничего
        return;
      } else {
        // Логика для кнопок
        const isFirstButton = currentFocusIndex === 1; // Индекс 1 - это первая кнопка (#prev-episode-btn)
        const isLastButton = currentFocusIndex === focusableElements.length - 1; // Последняя кнопка (#mute-btn)

        if (direction === 'up') {
          // Переход на ползунок (индекс 0)
          setFocus(0);
          return;
        }
        if (direction === 'down') {
          // Игнорируем вниз на кнопках
          return;
        }

        if (direction === 'left') {
          if (isFirstButton) {
            // Если мы на первой кнопке и жмем влево - остаемся на месте
            return;
          }
          setFocus(currentFocusIndex - 1);
          return;
        }
        if (direction === 'right') {
          if (isLastButton) {
            // Если мы на последней кнопке и жмем вправо - остаемся на месте
            return;
          }
          setFocus(currentFocusIndex + 1);
          return;
        }
      }

      return;
    }


    if (AppState.currentScreen === 'search') {
      const searchInputEl = document.getElementById('search-query');
      const filters = focusableElements.filter(el =>
        el.id === 'sort-by' || el.id === 'filter-quality' || el.id === 'filter-tracker' ||
        el.id === 'filter-year' || el.id === 'reset-filters' || el.id === 'close-search'
      );
      const results = focusableElements.filter(el => el.classList.contains('search-result-item'));
      const current = focusableElements[currentFocusIndex];
      const filterIndex = filters.indexOf(current);
      const resultIndex = results.indexOf(current);
      const isSearchInput = current === searchInputEl;

      if (!current) {
        if (searchInputEl && focusableElements.includes(searchInputEl)) {
          setFocus(focusableElements.indexOf(searchInputEl));
        } else if (filters.length > 0) {
          setFocus(focusableElements.indexOf(filters[0]));
        } else if (results.length > 0) {
          setFocus(focusableElements.indexOf(results[0]));
        }
        return;
      }

      if (isSearchInput) {
        if (direction === 'left' || direction === 'right' || direction === 'down' || direction === 'up') {
          if (filters.length > 0) {
            setFocus(focusableElements.indexOf(filters[0]));
          } else if (results.length > 0) {
            setFocus(focusableElements.indexOf(results[0]));
          }
          return;
        }
      }

      if (filterIndex !== -1) {
        if (direction === 'left') {
          setFocus(focusableElements.indexOf(filters[Math.max(0, filterIndex - 1)]));
          return;
        }
        if (direction === 'right') {
          setFocus(focusableElements.indexOf(filters[Math.min(filters.length - 1, filterIndex + 1)]));
          return;
        }
        if (direction === 'down') {
          if (results.length > 0) {
            setFocus(focusableElements.indexOf(results[0]));
          } else {
            setFocus(focusableElements.indexOf(filters[Math.min(filters.length - 1, filterIndex + 1)]));
          }
          return;
        }
        if (direction === 'up') {
          if (searchInputEl && focusableElements.includes(searchInputEl)) {
            setFocus(focusableElements.indexOf(searchInputEl));
          } else {
            setFocus(focusableElements.indexOf(filters[Math.max(0, filterIndex - 1)]));
          }
          return;
        }
        return;
      }

      if (resultIndex !== -1) {
        if (direction === 'up') {
          if (resultIndex === 0 && filters.length > 0) {
            setFocus(focusableElements.indexOf(filters[0]));
          } else {
            setFocus(focusableElements.indexOf(results[Math.max(0, resultIndex - 1)]));
          }
          return;
        }
        if (direction === 'down') {
          setFocus(focusableElements.indexOf(results[Math.min(results.length - 1, resultIndex + 1)]));
          return;
        }
        if (direction === 'left' || direction === 'right') {
          return;
        }
      }
    }

    // Обычная навигация для остальных экранов
    const columns = 1;
    switch (direction) {
      case 'up': setFocus(currentFocusIndex - columns); break;
      case 'down': setFocus(currentFocusIndex + columns); break;
      case 'left': setFocus(currentFocusIndex - 1); break;
      case 'right': setFocus(currentFocusIndex + 1); break;
    }
  }

  function stopSeeking() {
    if (seekInterval) {
      clearInterval(seekInterval);
      seekInterval = null;
      seekDirection = null;
      hidePlayerLoading();
    }
  }

  // Обработчик отпускания клавиши
  document.addEventListener('keyup', (e) => {
    const key = e.keyCode;
    if (isKeyPressed('LEFT', key) || isKeyPressed('RIGHT', key)) {
      if (seekHoldInterval) {
        clearInterval(seekHoldInterval);
        seekHoldInterval = null;

        // Очищаем таймер ускорения
        if (typeof accelerationTimer !== 'undefined' && accelerationTimer) {
          clearInterval(accelerationTimer);
          accelerationTimer = null;
        }

        const slider = document.getElementById('seek-slider');
        if (slider) {
          slider.dispatchEvent(new Event('change', { bubbles: true }));
        }

        console.log('⏹️ Удержание прекращено, инициирована перемотка');

        setTimeout(() => {
          isSeekHoldActive = false;
        }, 500);
      }

      stopSeeking();
    }
  });

  document.addEventListener('keydown', (e) => {
    const key = e.keyCode;
    const activeElement = document.activeElement;

    if (AppState.currentScreen === 'torrents') {
      if (isKeyPressed('UP', key) || isKeyPressed('DOWN', key) ||
        isKeyPressed('LEFT', key) || isKeyPressed('RIGHT', key)) {
        e.preventDefault();
        if (!document.querySelector('.focused')) {
          focusFirstTorrentCard();
          return;
        }
        navigate(keyToDirection(key));
        return;
      }

      if (isKeyPressed('OK', key) || key === 13) {
        e.preventDefault();
        if (e.repeat) {
          return;
        }
        const focused = document.querySelector('.focused');
        if (!focused) {
          focusFirstTorrentCard();
          return;
        }

        if (focused.id === 'search-query') {
          showSearchResults({ focusQuery: true });
          return;
        }
        if (focused.id === 'search-btn' || focused.id === 'tab-search') {
          showSearchResults({ focusQuery: true, runSearch: focused.id === 'search-btn' });
          return;
        }
        if (focused.id === 'tab-catalog') {
          focused.click();
          return;
        }
        if (focused.id === 'settings-btn' || focused.id === 'tab-torrents') {
          focused.click();
          return;
        }
        if (focused.classList.contains('torrent-card')) {
          return;
        }
        focused.click?.();
        return;
      }
      return;
    }

    if (activeElement && activeElement.id === 'search-query') {
      if (isKeyPressed('BACK', key) || isKeyPressed('EXIT', key)) {
        e.preventDefault();
        activeElement.blur();
        updateFocusableElements();
        const searchIndex = focusableElements.findIndex(el => el.id === 'search-query');
        setFocus(searchIndex !== -1 ? searchIndex : 0);
        return;
      }
      if (isKeyPressed('DOWN', key) || isKeyPressed('UP', key) || isKeyPressed('LEFT', key) || isKeyPressed('RIGHT', key)) {
        e.preventDefault();
        const direction = keyToDirection(key);
        activeElement.blur();
        updateFocusableElements();

        if (AppState.currentScreen === 'search') {
          if (direction === 'right') {
            const searchBtnIndex = focusableElements.findIndex(el => el.id === 'search-btn');
            setFocus(searchBtnIndex !== -1 ? searchBtnIndex : 0);
          } else {
            const firstFilterIndex = focusableElements.findIndex(el => ['filter-toggle', 'sort-by', 'filter-quality', 'filter-tracker', 'filter-year', 'reset-filters', 'close-search'].includes(el.id));
            const firstResultIndex = focusableElements.findIndex(el => el.classList.contains('search-result-item'));
            if (direction === 'down' && firstFilterIndex !== -1) {
              setFocus(firstFilterIndex);
            } else if (firstFilterIndex !== -1) {
              setFocus(firstFilterIndex);
            } else if (firstResultIndex !== -1) {
              setFocus(firstResultIndex);
            } else {
              setFocus(0);
            }
          }
          return;
        }

        navigate(direction);
        return;
      }
      if (isKeyPressed('OK', key)) {
        e.preventDefault();
        const query = activeElement.value.trim();
        if (AppState.currentScreen === 'search') {
          if (query) {
            searchTorrents(query);
          }
          activeElement.blur();
          setTimeout(() => focusSearchHome(true), 100);
          return;
        }
        showSearchResults({ focusQuery: true, runSearch: !!query });
        activeElement.blur();
        return;
      }
    }

    if (AppState.currentScreen === 'config') {
      const isInputFocused = activeElement && (
        activeElement.id === 'torrserver-url' ||
        activeElement.id === 'auth-login' ||
        activeElement.id === 'auth-password'
      );

      if (isInputFocused) {
        if (isKeyPressed('OK', key)) {
          e.preventDefault();
          activeElement.blur();
          updateFocusableElements();
          const currentIndex = focusableElements.findIndex(el => el.id === activeElement.id);
          if (currentIndex !== -1 && currentIndex < focusableElements.length - 1) {
            setFocus(currentIndex + 1);
          } else {
            setFocus(0);
          }
          return;
        }
        return;
      }

      updateFocusableElements();

      if (isKeyPressed('UP', key)) {
        e.preventDefault();
        setFocus(currentFocusIndex - 1);
        return;
      }
      if (isKeyPressed('DOWN', key)) {
        e.preventDefault();
        setFocus(currentFocusIndex + 1);
        return;
      }
      if (isKeyPressed('LEFT', key)) {
        e.preventDefault();
        setFocus(currentFocusIndex - 1);
        return;
      }
      if (isKeyPressed('RIGHT', key)) {
        e.preventDefault();
        setFocus(currentFocusIndex + 1);
        return;
      }
      if (isKeyPressed('OK', key)) {
        e.preventDefault();
        const focused = document.querySelector('.focused');
        if (focused) {
          if (focused.id === 'torrserver-url' ||
            focused.id === 'auth-login' ||
            focused.id === 'auth-password') {
            focused.focus();
          } else {
            focused.click();
          }
        }
        return;
      }
    }

    if (AppState.currentScreen === 'search') {
      const activeTag = e.target.tagName;
      const isFilterControl = activeTag === 'SELECT' || e.target.id === 'filter-year';
      if (isFilterControl && (isKeyPressed('UP', key) || isKeyPressed('DOWN', key) || isKeyPressed('LEFT', key) || isKeyPressed('RIGHT', key))) {
        e.preventDefault();
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
          document.activeElement.blur();
        }
        updateFocusableElements();
        const firstFilterIndex = focusableElements.findIndex(el => ['filter-toggle', 'sort-by', 'filter-quality', 'filter-tracker', 'filter-year', 'reset-filters', 'close-search'].includes(el.id));
        if (firstFilterIndex !== -1) {
          setFocus(firstFilterIndex);
          if (keyToDirection(key) !== 'left') {
            navigate(keyToDirection(key));
          }
          return;
        }
      }
    }

    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }

    updateFocusableElements();

    // ===== СПЕЦИАЛЬНАЯ ОБРАБОТКА ДЛЯ ПЛЕЕРА =====
    if (AppState.currentScreen === 'player') {
      const controlsContainer = document.getElementById('controls-container');
      const controlsVisible = !controlsContainer.classList.contains('idle-hidden');

      if (isKeyPressed('UP', key) && !controlsVisible) {
        e.preventDefault();
        showPlayerControls('play-pause-btn');
        return;
      }

      // OK - активация выбранного элемента ИЛИ показать/скрыть элементы
      if (isKeyPressed('OK', key)) {
        e.preventDefault();

        const focused = document.querySelector('.focused');

        // 1. Если панель СКРЫТА -> Показываем её и ставим фокус на Play/Pause
        if (!controlsVisible) {
          showPlayerControls('play-pause-btn');
          return;
        }

        // 2. Если панель ВИДИМА -> Выполняем действие, затем СКРЫВАЕМ панель и СБРАСЫВАЕМ фокус
        if (focused) {
          console.log('🎯 OK на элементе (панель видима):', focused.id || focused.className);

          let actionPerformed = false;

          if (focused.id === 'play-pause-btn') {
            if (videoPlayer.paused) {
              videoPlayer.play();
            } else {
              videoPlayer.pause();
            }
            updatePlayPauseButton();
            actionPerformed = true;
          } else if (focused.id === 'mute-btn') {
            videoPlayer.muted = !videoPlayer.muted;
            updateMuteButton();
            actionPerformed = true;
          } else if (focused.id === 'prev-episode-btn') {
            if (typeof prevEpisode === 'function') prevEpisode();
            actionPerformed = true;
          } else if (focused.id === 'next-episode-btn') {
            if (typeof nextEpisode === 'function') nextEpisode();
            actionPerformed = true;
          } else if (focused.id === 'episodes-btn') {
            document.getElementById('episodes-btn')?.click();
            actionPerformed = false;
          } else if (focused.id === 'audio-btn') {
            document.getElementById('audio-btn')?.click();
            actionPerformed = false;
          } else if (focused.id === 'exit-player-btn') {
            showDetailView();
            return;
          } else if (focused.id === 'toggle-buffer-btn') {
            toggleBufferBtn?.click();
            actionPerformed = true;
          } else if (focused.id === 'seek-slider') {
            const currentTime = parseFloat(focused.value);
            showPlayerLoading(`⏱️ ${formatTime(currentTime)}`);
            setTimeout(hidePlayerLoading, 1000);
            actionPerformed = true;
          } else {
            focused.click();
            actionPerformed = true;
          }

          if (actionPerformed) {
            setTimeout(() => {
              hidePlayerControls();
              console.log('✅ Действие выполнено, панель скрыта, фокус сброшен');
            }, 400);
          }

          resetMouseIdleTimer();
          return;
        }

        if (controlsVisible) {
          hidePlayerControls();
        }
        return;
      }

      // Стрелки ВЛЕВО / ВПРАВО - специальная логика для ползунка
      if (isKeyPressed('LEFT', key) || isKeyPressed('RIGHT', key)) {
        e.preventDefault();
        resetMouseIdleTimer();

        const focusedElement = focusableElements[currentFocusIndex];
        const isSeekSliderFocused = focusedElement && focusedElement.id === 'seek-slider';

        if (isSeekSliderFocused) {
          const slider = document.getElementById('seek-slider');
          const direction = isKeyPressed('LEFT', key) ? -1 : 1;

          // Настройки нарастающего шага
          let holdDuration = 0;
          let currentStep = seekHoldStep; // начальный шаг 5 сек
          const maxStep = 120; // максимальный шаг 120 сек (2 минуты)
          const accelerationCurve = [
            { time: 0, step: 5 },      // 0-500ms: 5 сек
            { time: 500, step: 10 },   // 500-1000ms: 10 сек
            { time: 1000, step: 20 },  // 1000-1500ms: 20 сек
            { time: 1500, step: 30 },  // 1500-2000ms: 30 сек
            { time: 2000, step: 45 },  // 2000-2500ms: 45 сек
            { time: 2500, step: 60 },  // 2500-3000ms: 60 сек
            { time: 3000, step: 90 },  // 3000+ ms: 90 сек
            { time: 4000, step: 120 }  // 4000+ ms: 120 сек
          ];

          let lastUpdateTime = Date.now();
          let accelerationTimer = null;

          const updateStepByDuration = () => {
            const elapsed = Date.now() - lastUpdateTime;

            // Находим подходящий шаг по времени удержания
            let newStep = seekHoldStep;
            for (let i = accelerationCurve.length - 1; i >= 0; i--) {
              if (elapsed >= accelerationCurve[i].time) {
                newStep = accelerationCurve[i].step;
                break;
              }
            }

            if (newStep !== currentStep) {
              currentStep = newStep;
              console.log(`⚡ Ускорение перемотки: ${currentStep} сек (удержание ${(elapsed / 1000).toFixed(1)}с)`);
            }
          };

          const performSeekStep = () => {
            let currentValue = parseFloat(slider.value);
            const maxVal = parseFloat(slider.max);
            const step = currentStep * direction;

            let newValue = currentValue + step;

            if (newValue < 0) newValue = 0;
            if (newValue > maxVal) newValue = maxVal;

            slider.value = newValue;

            AppState.previewTime = newValue;
            document.getElementById('current-time').textContent = formatTime(newValue);

            if (AppState.isSeeking || document.getElementById('loading-player-overlay').classList.contains('active')) {
              document.getElementById('loading-time').textContent = formatTime(newValue);
            }
          };

          if (!seekHoldInterval) {
            isSeekHoldActive = true;
            holdDuration = 0;
            currentStep = seekHoldStep;
            lastUpdateTime = Date.now();

            // Выполняем первый шаг
            performSeekStep();

            // Запускаем интервал перемотки
            seekHoldInterval = setInterval(performSeekStep, seekHoldDelay);

            // Запускаем таймер для обновления шага
            accelerationTimer = setInterval(() => {
              if (seekHoldInterval) {
                updateStepByDuration();
              } else {
                if (accelerationTimer) {
                  clearInterval(accelerationTimer);
                  accelerationTimer = null;
                }
              }
            }, 200);
          }
          return;
        } else {
          // На кнопках влево/вправо работает наша новая логика в navigate
          navigate(keyToDirection(key));
          return;
        }
      }

      if (controlsVisible) {
        updateFocusableElements();

        if (isKeyPressed('UP', key)) {
          e.preventDefault();
          navigate('up');
          resetMouseIdleTimer();
          return;
        }
        if (isKeyPressed('DOWN', key)) {
          e.preventDefault();
          navigate('down');
          resetMouseIdleTimer();
          return;
        }
      }

      if (isKeyPressed('PLAY', key) || isKeyPressed('PAUSE', key) || isKeyPressed('PLAY_PAUSE', key)) {
        e.preventDefault();
        if (videoPlayer.paused) {
          videoPlayer.play();
        } else {
          videoPlayer.pause();
        }
        resetMouseIdleTimer();
        return;
      }

      if (isKeyPressed('VOL_UP', key)) {
        e.preventDefault();
        const newVolume = Math.min(1, videoPlayer.volume + 0.1);
        videoPlayer.volume = newVolume;
        volumeSlider.value = newVolume;
        resetMouseIdleTimer();
        return;
      }
      if (isKeyPressed('VOL_DOWN', key)) {
        e.preventDefault();
        const newVolume = Math.max(0, videoPlayer.volume - 0.1);
        videoPlayer.volume = newVolume;
        volumeSlider.value = newVolume;
        resetMouseIdleTimer();
        return;
      }
      if (isKeyPressed('MUTE', key)) {
        e.preventDefault();
        videoPlayer.muted = !videoPlayer.muted;
        updateMuteButton();
        resetMouseIdleTimer();
        return;
      }

      if (isKeyPressed('RED', key)) {
        e.preventDefault();
        document.getElementById('audio-btn')?.click();
        resetMouseIdleTimer();
        return;
      }
      if (isKeyPressed('GREEN', key)) {
        e.preventDefault();
        document.getElementById('episodes-btn')?.click();
        resetMouseIdleTimer();
        return;
      }
      if (isKeyPressed('YELLOW', key)) {
        e.preventDefault();
        toggleBufferBtn?.click();
        resetMouseIdleTimer();
        return;
      }
      if (isKeyPressed('BLUE', key)) {
        e.preventDefault();
        exitPlayerBtn?.click();
        resetMouseIdleTimer();
        return;
      }

      if (isKeyPressed('BACK', key) || isKeyPressed('EXIT', key)) {
        e.preventDefault();
        if (hidePlayerUi()) {
          lastPlayerBackPressAt = 0;
          return;
        }
        const now = Date.now();
        if (now - lastPlayerBackPressAt < 1500) {
          lastPlayerBackPressAt = 0;
          showDetailView();
        } else {
          lastPlayerBackPressAt = now;
          showPlayerHint('Нажмите Back ещё раз для выхода');
        }
        return;
      }

      if (isKeyPressed('FF', key)) {
        e.preventDefault();
        videoPlayer.currentTime = Math.min(videoPlayer.duration, videoPlayer.currentTime + 30);
        resetMouseIdleTimer();
        return;
      }
      if (isKeyPressed('REW', key)) {
        e.preventDefault();
        videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - 30);
        resetMouseIdleTimer();
        return;
      }

      if (!controlsVisible) {
        return;
      }
    }

    if (AppState.currentScreen === 'search' && isKeyPressed('OK', key)) {
      e.preventDefault();
      const focused = document.querySelector('.focused');

      if (focused) {
        if (focused.id === 'search-query') {
          focused.focus();
          try { focused.select && focused.select(); } catch (err) { }
        } else if (focused.tagName === 'SELECT' || focused.id === 'filter-year') {
          if (typeof openNativeSearchControl === 'function') {
            openNativeSearchControl(focused);
          } else {
            focused.focus();
            focused.click();
          }
        } else if (focused.id === 'search-btn') {
          const query = document.getElementById('search-query')?.value?.trim();
          if (query) {
            searchTorrents(query);
          }
        } else {
          focused.click();
        }
      } else {
        focusSearchHome(true);
      }

      return;
    }

    if (isKeyPressed('UP', key)) {
      e.preventDefault();
      navigate('up');
    } else if (isKeyPressed('DOWN', key)) {
      e.preventDefault();
      navigate('down');
    } else if (isKeyPressed('LEFT', key)) {
      e.preventDefault();
      navigate('left');
    } else if (isKeyPressed('RIGHT', key)) {
      e.preventDefault();
      navigate('right');
    } else if (isKeyPressed('OK', key)) {
      e.preventDefault();

      const focused = document.querySelector('.focused');
      if (focused) {
        if (focused.classList.contains('file-item')) {
          const playBtn = focused.querySelector('.play-btn');
          if (playBtn) {
            playBtn.click();
          } else {
            focused.click();
          }
        } else {
          focused.click();
        }
      } else if (focusableElements.length > 0) {
        focusableElements[0].click();
      }
    } else if (isKeyPressed('BACK', key) || isKeyPressed('EXIT', key)) {
      e.preventDefault();
      if (AppState.currentScreen === 'detail') {
        document.getElementById('back-from-detail')?.click();
      } else if (AppState.currentScreen === 'search') {
        hideSearchResults();
      } else if (AppState.currentScreen === 'catalog') {
        if (typeof window.backToCatalogList === 'function') {
          window.backToCatalogList();
        } else {
          document.getElementById('back-from-catalog')?.click();
        }
      } else if (AppState.currentScreen === 'torrents') {
        const hasFocus = !!document.querySelector('.focused');
        if (!hasFocus) {
          focusFirstTorrentCard();
        } else {
          document.getElementById('settings-btn')?.click();
        }
      }
    } else if (isKeyPressed('INFO', key)) {
      e.preventDefault();
      console.log('ℹ️ Информация:', {
        screen: AppState.currentScreen,
        platform: AppState.platform,
        focusIndex: currentFocusIndex,
        focusableCount: focusableElements.length
      });
    }
  });

  function keyToDirection(keyCode) {
    if (isKeyPressed('UP', keyCode)) return 'up';
    if (isKeyPressed('DOWN', keyCode)) return 'down';
    if (isKeyPressed('LEFT', keyCode)) return 'left';
    if (isKeyPressed('RIGHT', keyCode)) return 'right';
    return null;
  }
  window.focusSearchHome = focusSearchHome;

  // Внутри функции init(), после остальных инициализаций, добавьте:

  // Полноэкранный режим
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  if (fullscreenBtn) {
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
      const updateFullscreenIcon = () => {
  const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
  fullscreenBtn.innerHTML = isFullscreen 
    ? '<i class="fi fi-rr-compress"></i>' 
    : '<i class="fi fi-rr-expand"></i>';
  fullscreenBtn.title = isFullscreen ? 'Выйти из полноэкранного режима' : 'Полный экран';
};
    }

    fullscreenBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFullscreen();
      resetMouseIdleTimer();
    });

    document.addEventListener('fullscreenchange', updateFullscreenIcon);
    document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);
  }
  // В HTML добавьте в секцию настроек:
  // <div class="checkbox-container">
  //   <input type="checkbox" id="auto-fullscreen">
  //   <span>Автоматический полноэкранный режим при запуске</span>
  // </div>

  // В init() функции добавьте:
  const autoFullscreenCheckbox = document.getElementById('auto-fullscreen');
  if (autoFullscreenCheckbox) {
    // Загружаем сохраненное состояние
    const savedAutoFullscreen = localStorage.getItem('autoFullscreen') === 'true';
    autoFullscreenCheckbox.checked = savedAutoFullscreen;

    // Сохраняем при изменении
    autoFullscreenCheckbox.addEventListener('change', (e) => {
      localStorage.setItem('autoFullscreen', e.target.checked);
      if (e.target.checked) {
        // Если включили сейчас, сразу переходим в полноэкранный режим
        const element = document.documentElement;
        if (element.requestFullscreen) element.requestFullscreen();
        else if (element.webkitRequestFullscreen) element.webkitRequestFullscreen();
        else if (element.mozRequestFullScreen) element.mozRequestFullScreen();
        else if (element.msRequestFullscreen) element.msRequestFullscreen();
      }
    });
  }

  // Функция автоматического полноэкранного режима
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

  // Запускаем после загрузки
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enterFullscreenIfEnabled);
  } else {
    enterFullscreenIfEnabled();
  }
  // Добавляем в инициализацию
  document.addEventListener('DOMContentLoaded', () => {
    initSearchModeToggle();
  });
}

window.focusFirstTorrentCard = function () {
  return focusFirstTorrentCard(0, 0);
};

//setTimeout(() => {
//if (!window.focusFirstTorrentCard || !window.focusFirstTorrentCard()) {
//updateFocusableElements();
//const firstCardIndex = focusableElements.findIndex(el => el.classList && el.classList.contains('torrent-card'));
//setFocus(firstCardIndex !== -1 ? firstCardIndex : 0);
//}
//}, 300);


/* ===== TV focus rescue patch v9 ===== */
(function () {
  const VISIBLE = (el) => !!(el && el.offsetParent !== null && !el.disabled);
  const byId = (id) => document.getElementById(id);
  const clearFocused = () => document.querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));
  const clickEl = (el) => { try { el && el.click && el.click(); } catch (e) { } };
  const blurEditor = () => {
    const a = document.activeElement;
    if (a && a !== document.body && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA')) {
      try { a.blur(); } catch (e) { }
    }
  };
  function focusEl(el, opts = {}) {
    if (!VISIBLE(el)) return false;
    clearFocused();
    el.classList.add('focused');
    if (opts.nativeFocus) {
      try { el.focus(); } catch (e) { }
    } else {
      blurEditor();
    }
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { }
    return true;
  }

  let customFilterMenuState = null;

  function ensureCustomFilterMenu() {
    let menu = document.getElementById('custom-filter-menu');
    if (menu) return menu;

    menu = document.createElement('div');
    menu.id = 'custom-filter-menu';
    menu.className = 'custom-filter-menu hidden';
    menu.innerHTML = `
      <div class="custom-filter-menu-backdrop"></div>
      <div class="custom-filter-menu-panel">
        <div class="custom-filter-menu-title" id="custom-filter-menu-title">Выбор</div>
        <div class="custom-filter-menu-options" id="custom-filter-menu-options"></div>
      </div>
    `;
    document.body.appendChild(menu);
    menu.querySelector('.custom-filter-menu-backdrop').addEventListener('click', closeCustomFilterMenu);
    return menu;
  }

  function renderCustomFilterMenu() {
    const menu = ensureCustomFilterMenu();
    const titleEl = document.getElementById('custom-filter-menu-title');
    const optionsEl = document.getElementById('custom-filter-menu-options');
    if (!customFilterMenuState || !titleEl || !optionsEl) return;

    titleEl.textContent = customFilterMenuState.title || 'Выбор';
    optionsEl.innerHTML = customFilterMenuState.options.map((opt, idx) => {
      const cls = idx === customFilterMenuState.index ? 'custom-filter-option active' : 'custom-filter-option';
      const selected = String(opt.value) === String(customFilterMenuState.value) ? ' ✓' : '';
      return `<div class="${cls}" data-index="${idx}">${opt.label}${selected}</div>`;
    }).join('');
  }

  function closeCustomFilterMenu() {
    const menu = document.getElementById('custom-filter-menu');
    if (menu) menu.classList.add('hidden');
    customFilterMenuState = null;
    return true;
  }

  function moveCustomFilterMenu(delta) {
    if (!customFilterMenuState || !customFilterMenuState.options.length) return true;
    const len = customFilterMenuState.options.length;
    customFilterMenuState.index = (customFilterMenuState.index + delta + len) % len;
    renderCustomFilterMenu();
    return true;
  }

  function applyCustomFilterMenuSelection() {
    if (!customFilterMenuState || !customFilterMenuState.selectEl) return false;
    const { selectEl, options, index } = customFilterMenuState;
    const chosen = options[index];
    if (!chosen) return false;
    selectEl.value = String(chosen.value);
    try { selectEl.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { }
    getCurrentSearchMode();
    closeCustomFilterMenu();
    try { focusEl(selectEl); } catch (e) { }
    return true;
  }

  function isCustomFilterMenuOpen() {
    const menu = document.getElementById('custom-filter-menu');
    return !!(menu && !menu.classList.contains('hidden') && customFilterMenuState);
  }

  function openNativeSearchControl(el) {
    if (!VISIBLE(el)) return false;

    if (el.tagName === 'SELECT') {
      const title = el.closest('.filter-group')?.querySelector('.filter-label')?.textContent?.trim() || 'Выбор';
      const options = Array.from(el.options || []).map(opt => ({ value: opt.value, label: opt.textContent || opt.label || opt.value }));
      let index = Math.max(0, options.findIndex(opt => String(opt.value) === String(el.value)));
      if (index < 0) index = 0;
      customFilterMenuState = { selectEl: el, title, options, index, value: el.value };
      const menu = ensureCustomFilterMenu();
      menu.classList.remove('hidden');
      renderCustomFilterMenu();
      return true;
    }

    focusEl(el, { nativeFocus: true });
    try { el.focus(); } catch (e) { }
    try { el.click(); } catch (e) { }
    return true;
  }

  function currentScreen() {
    try {
      const stateScreen = window.AppState?.currentScreen;
      const player = byId('player-screen');
      const detail = byId('detail-view');
      const config = byId('config-screen');
      const search = byId('search-overlay');
      const catalogTab = byId('tab-catalog');
      const donateTab = byId('donate-overlay');

      const catalogGrid = document.getElementById('torrents-grid');

      if (stateScreen === 'player') return 'player';
      if (player && getComputedStyle(player).display !== 'none') return 'player';
      if (config && getComputedStyle(config).display !== 'none') return 'config';
      if (detail && getComputedStyle(detail).display !== 'none') return 'detail';
      if (search && !search.classList.contains('hidden') && getComputedStyle(search).display !== 'none') return 'search';
      if (donateTab && !donateTab.classList.contains('hidden') && getComputedStyle(donateTab).display !== 'none') return 'donate';

      // Проверяем активную вкладку каталога
      if (catalogTab && catalogTab.classList.contains('active')) {
        return 'catalog';
      }

      // Проверяем наличие карточек каталога
      if (catalogGrid) {
        const hasCatalogCards = catalogGrid.querySelector('.catalog-card, .catalog-folder-card') !== null;
        const hasTorrentCards = catalogGrid.querySelector('.torrent-card:not(.catalog-card):not(.catalog-folder-card)') !== null;

        // Если есть карточки каталога и нет обычных карточек торрентов
        if (hasCatalogCards && !hasTorrentCards) {
          return 'catalog';
        }
      }

      return stateScreen || 'torrents';
    } catch (e) {
      return 'torrents';
    }
  }

  function getTorrentCards() { return Array.from(document.querySelectorAll('.torrent-card')).filter(VISIBLE); }
  function getTorrentHeader() { return ['settings-btn'].map(byId).filter(VISIBLE); }
  function getTorrentTabs() { return ['tab-catalog', 'tab-torrents', 'tab-search', 'tab-donate'].map(byId).filter(VISIBLE); }
  function getSearchTop() { return ['search-query', 'filter-toggle', 'search-btn', 'close-search'].map(byId).filter(VISIBLE); }
  function getSearchFilters() { return ['torrent-movie', 'sort-by', 'filter-quality', 'filter-tracker', 'filter-year', 'reset-filters'].map(byId).filter(VISIBLE); }
  //function getSearchResults() { return Array.from(document.querySelectorAll('.search-result-item')).filter(VISIBLE); }
  function getSearchResults() {
    const currentMode = getCurrentSearchMode();
    if (currentMode === 'torrentsearch') {
      return Array.from(document.querySelectorAll('.search-result-item')).filter(VISIBLE);
    } else if (currentMode === 'globalsearch') {
      return Array.from(document.querySelectorAll('.global-search-card')).filter(VISIBLE);
    }
    return [];
  }

  function getDetailItems() {
    return Array.from(document.querySelectorAll(
      '.detail-progress-btn, .file-item, .back-btn, #catalog-watch-btn, ' +
      '.catalog-trailer-link, .catalog-trailer-play, .catalog-trailer-card-item, ' + // ДОБАВЛЕНО: новые карточки трейлеров
      '#catalog-trailer-close, ' +
      '.catalog-actor-card, .catalog-recommendation-card'
    )).filter(VISIBLE);
  }
  function getConfigItems() { return Array.from(document.querySelectorAll('#torrserver-url, #auth-checkbox, #auth-login, #auth-password, .settings-btn, #auto-fullscreen')).filter(VISIBLE); }

  function getColumns() {
    const grid = byId('torrents-grid');
    if (!grid) return 8;
    try {
      const cols = (getComputedStyle(grid).gridTemplateColumns || '').split(' ').filter(Boolean).length;
      return cols || 8;
    } catch (e) { return 8; }
  }

  function belongsToScreen(el, screen) {
    //if (!VISIBLE(el)) return false;
    if (!el) return false;
    if (screen === 'torrents') {
      return el.closest('.torrent-card') || el.classList.contains('file-item') || ['search-query', 'search-btn', 'settings-btn', 'tab-torrents', 'tab-search', 'tab-donate', 'back-from-detail', 'tab-catalog'].includes(el.id);
    }
    if (screen === 'catalog') {
      return el.closest('.torrent-card.catalog-card') ||
        el.closest('.torrent-card.catalog-folder-card') ||
        (el.closest('#torrents-grid') && !el.closest('.torrent-card:not(.catalog-card):not(.catalog-folder-card)')) ||
        el.id === 'back-from-catalog' ||
        el.classList.contains('file-item') ||
        el.classList.contains('back-btn') || ['search-query', 'search-btn', 'settings-btn', 'tab-torrents', 'tab-search', 'tab-catalog', 'tab-donate'].includes(el.id);
    }
    if (screen === 'search') {
      return el.closest('.search-result-item') || el.closest('.global-search-card') ||
        ['search-query', 'filter-toggle', 'search-btn', 'close-search', 'torrent-movie', 'sort-by', 'filter-quality', 'filter-tracker', 'filter-year', 'reset-filters'].includes(el.id);
    }
    if (screen === 'detail') {
      return !!(
        el.closest('#detail-view') ||
        el.closest('.file-item') ||
        el.closest('back-from-detail') ||
        el.classList.contains('back-btn') ||
        el.classList.contains('detail-progress-btn')
      );
    }
    if (screen === 'config') {
      return !!(
        el.closest('#config-screen') ||
        ['torrserver-url', 'auth-checkbox', 'auth-login', 'auth-password'].includes(el.id) ||
        el.classList.contains('settings-btn')
      );
    }
    return false;
  }

  function ensureTorrentFocus(force = false) {
    if (currentScreen() !== 'torrents') return false;
    if (window.AppState?.restoringFocus) return false;

    const focused = document.querySelector('.focused');
    if (!force && belongsToScreen(focused, 'torrents')) return true;

    return focusEl(getTorrentCards()[0] || getTorrentTabs()[0] || getTorrentHeader()[0]);
  }

  function ensureCatalogFocus(force = false) {
    if (currentScreen() !== 'catalog') return false;

    const focused = document.querySelector('.focused');

    // Если уже есть фокус на элементе экрана catalog, не сбрасываем сохраненную позицию.
    if (!force && focused && belongsToScreen(focused, 'catalog')) {
      return true;
    }

    const cards = Array.from(document.querySelectorAll('.torrent-card.catalog-card, .torrent-card.catalog-folder-card')).filter(VISIBLE);
    if (!cards.length) return false;

    const savedIndexRaw = localStorage.getItem('lastCatalogCardIndex');
    let targetCard = null;

    if (savedIndexRaw !== null) {
      const savedNumIndex = parseInt(savedIndexRaw, 10);
      if (Number.isFinite(savedNumIndex)) {
        targetCard = cards.find(card => {
          const cardNumIndex = parseInt(card.dataset.numIndex || '-1', 10);
          return Number.isFinite(cardNumIndex) && cardNumIndex === savedNumIndex;
        }) || null;

        if (!targetCard && savedNumIndex >= 0 && savedNumIndex < cards.length) {
          targetCard = cards[savedNumIndex];
        }
      }
    }

    if (!targetCard) {
      targetCard = cards[0];
    }

    const targetIndex = cards.indexOf(targetCard);
    console.log(`🎯 ensureCatalogFocus: восстанавливаем фокус на карточке ${targetIndex}, saved=${savedIndexRaw}`);
    return focusEl(targetCard);
  }

  function ensureSearchFocus(force = false, preferInput = true) {
    if (currentScreen() !== 'search') return false;
    const focused = document.querySelector('.focused');
    if (!force && belongsToScreen(focused, 'search')) return true;
    const top = getSearchTop();
    const filters = getSearchFilters();
    const results = getSearchResults();
    const query = byId('search-query');
    return focusEl((preferInput && query) ? query : (top[0] || filters[0] || results[0] || query));
  }
  function ensureDetailFocus(force = false) {
    if (currentScreen() !== 'detail') return false;
    const focused = document.querySelector('.focused');
    if (!force && belongsToScreen(focused, 'detail')) return true;
    return focusEl(getDetailItems()[0] || byId('back-from-detail'));
  }
  function ensureConfigFocus(force = false) {
    if (currentScreen() !== 'config') return false;
    const focused = document.querySelector('.focused');
    if (!force && belongsToScreen(focused, 'config')) return true;
    return focusEl(getConfigItems()[0]);
  }

  window.focusFirstTorrentCard = function () { return ensureTorrentFocus(true); };
  window.focusFirstCatalogCard = function () { return ensureCatalogFocus(true); };
  window.focusSearchHome = function (preferQuery = true) { return ensureSearchFocus(true, preferQuery); };

  function openSearchScreen(focusInput = true) {
    clickEl(byId('tab-search') || byId('search-btn'));
    setTimeout(() => {
      ensureSearchFocus(true, focusInput);
      if (focusInput) {
        const q = byId('search-query');
        focusEl(q, { nativeFocus: true });
        try { q && q.click && q.click(); } catch (e) { }
        try { q && q.select && q.select(); } catch (e) { }
      }
    }, 120);
  }
  function leaveSearchToTorrents() {
    if (typeof window.hideSearchResults === 'function') {
      window.hideSearchResults();
    } else {
      clickEl(byId('close-search') || byId('tab-torrents'));
      setTimeout(() => {
        const returnTo = window.AppState?.searchReturnTo === 'catalog' ? 'catalog' : 'torrents';
        if (returnTo === 'catalog') {
          ensureCatalogFocus(true);
        } else {
          ensureTorrentFocus(true);
        }
      }, 150);
    }
  }

  function torrentHandle(direction) {
    const focused = belongsToScreen(document.querySelector('.focused'), 'torrents') ? document.querySelector('.focused') : null;
    const cards = getTorrentCards();
    const header = getTorrentHeader();
    const tabs = getTorrentTabs();
    const cols = getColumns();
    if (!focused) return ensureTorrentFocus(true);
    const cardIndex = cards.indexOf(focused);
    const headerIndex = header.indexOf(focused);
    const tabIndex = tabs.indexOf(focused);
    if (cardIndex !== -1) {
      const row = Math.floor(cardIndex / cols);
      if (direction === 'left') return focusEl(cards[Math.max(0, cardIndex - 1)] || focused);
      if (direction === 'right') return focusEl(cards[Math.min(cards.length - 1, cardIndex + 1)] || focused);
      if (direction === 'up') return focusEl(row === 0 ? (tabs[0] || header[0] || focused) : (cards[Math.max(0, cardIndex - cols)] || focused));
      if (direction === 'down') return focusEl(cards[Math.min(cards.length - 1, cardIndex + cols)] || focused);
      return true;
    }
    if (tabIndex !== -1) {
      if (direction === 'left') return focusEl(tabs[Math.max(0, tabIndex - 1)] || focused);
      if (direction === 'right') return focusEl(tabs[Math.min(tabs.length - 1, tabIndex + 1)] || focused);
      if (direction === 'down') return focusEl(cards[0] || focused);
      if (direction === 'up') return focusEl(header[Math.min(tabIndex, header.length - 1)] || header[0] || focused);
      return true;
    }
    if (headerIndex !== -1) {
      if (direction === 'left') return focusEl(header[Math.max(0, headerIndex - 1)] || focused);
      if (direction === 'right') return focusEl(header[Math.min(header.length - 1, headerIndex + 1)] || focused);
      if (direction === 'down') return focusEl((focused.id === 'settings-btn' ? tabs[0] : tabs[1]) || tabs[0] || cards[0] || focused);
      return true;
    }
    return false;
  }

  function catalogHandle(direction) {
    const focused = belongsToScreen(document.querySelector('.focused'), 'catalog') ? document.querySelector('.focused') : null;
    const cards = Array.from(document.querySelectorAll('.torrent-card.catalog-card, .torrent-card.catalog-folder-card')).filter(VISIBLE);
    const header = getTorrentHeader(); // ['settings-btn']
    const tabs = getTorrentTabs(); // ['tab-catalog', 'tab-torrents', 'tab-search']
    const cols = getColumns();

    if (!focused) return ensureCatalogFocus(true);

    const cardIndex = cards.indexOf(focused);
    const headerIndex = header.indexOf(focused);
    const tabIndex = tabs.indexOf(focused);

    // Навигация по карточкам каталога
    if (cardIndex !== -1) {
      const row = Math.floor(cardIndex / cols);

      if (direction === 'left') {
        return focusEl(cards[Math.max(0, cardIndex - 1)] || focused);
      }

      if (direction === 'right') {
        return focusEl(cards[Math.min(cards.length - 1, cardIndex + 1)] || focused);
      }

      if (direction === 'up') {
        // Если мы в первом ряду, переходим к вкладкам
        if (row === 0) {
          return focusEl(tabs[0] || header[0] || focused);
        }
        return focusEl(cards[Math.max(0, cardIndex - cols)] || focused);
      }

      if (direction === 'down') {
        // Проверяем, нужно ли подгрузить следующую страницу
        //if (cardIndex + cols >= cards.length) {
        //if (typeof window.loadMoreAndFocus === 'function') {
        window.loadMoreAndFocus(cardIndex, cols);
        //return true; // Не перемещаем фокус сразу
        return focusEl(cards[Math.min(cards.length - 1, cardIndex + cols)] || focused);
        // }
        // }
        //return focusEl(cards[Math.min(cards.length - 1, cardIndex + cols)] || focused);
      }

      return true;
    }

    // Навигация по вкладкам (tab-catalog, tab-torrents, tab-search)
    if (tabIndex !== -1) {
      if (direction === 'left') {
        return focusEl(tabs[Math.max(0, tabIndex - 1)] || focused);
      }
      if (direction === 'right') {
        return focusEl(tabs[Math.min(tabs.length - 1, tabIndex + 1)] || focused);
      }
      if (direction === 'down') {
        // При нажатии вниз переходим на первую карточку каталога
        return focusEl(cards[0] || focused);
      }
      if (direction === 'up') {
        // При нажатии вверх переходим к header (settings-btn)
        return focusEl(header[Math.min(tabIndex, header.length - 1)] || header[0] || focused);
      }
      return true;
    }

    // Навигация по header (settings-btn)
    if (headerIndex !== -1) {
      if (direction === 'left') {
        return focusEl(header[Math.max(0, headerIndex - 1)] || focused);
      }
      if (direction === 'right') {
        return focusEl(header[Math.min(header.length - 1, headerIndex + 1)] || focused);
      }
      if (direction === 'down') {
        // При нажатии вниз переходим к вкладкам
        // Если focused это settings-btn, переходим на первую вкладку (tab-catalog)
        return focusEl((focused.id === 'settings-btn' ? tabs[0] : tabs[1]) || tabs[0] || cards[0] || focused);
      }
      return true;
    }

    return false;
  }

  function detailHandle(direction) {
    const items = getDetailItems();
    const focused = belongsToScreen(document.querySelector('.focused'), 'detail') ? document.querySelector('.focused') : null;
    if (!focused) return ensureDetailFocus(true);
    const idx = items.indexOf(focused);
    if (idx === -1) return ensureDetailFocus(true);

    // Получаем все типы элементов
    const trailerLinks = items.filter(el => el.classList.contains('catalog-trailer-play') ||
      el.classList.contains('catalog-trailer-link') ||
      el.classList.contains('catalog-trailer-card-item')); // ДОБАВЛЕНО: новые карточки трейлеров
    const actorCards = items.filter(el => el.classList.contains('catalog-actor-card'));
    const recommendationCards = items.filter(el => el.classList.contains('catalog-recommendation-card'));
    const watchBtn = byId('catalog-watch-btn');
    const backBtn = byId('back-from-detail');

    // Определяем тип текущего элемента
    const isTrailer = focused.classList.contains('catalog-trailer-play') ||
      focused.classList.contains('catalog-trailer-link') ||
      focused.classList.contains('catalog-trailer-card-item'); // ДОБАВЛЕНО: новые карточки трейлеров
    const isActor = focused.classList.contains('catalog-actor-card');
    const isRecommendation = focused.classList.contains('catalog-recommendation-card');
    const isWatchBtn = focused.id === 'catalog-watch-btn';
    const isBackBtn = focused.id === 'back-from-detail';

    const trailerIndex = trailerLinks.indexOf(focused);
    const actorIndex = actorCards.indexOf(focused);
    const recommendationIndex = recommendationCards.indexOf(focused);

    // Исправленная функция для прокрутки к элементу
    const scrollToElement = (element) => {
      if (!element) return;

      const detailView = document.getElementById('detail-view');
      if (detailView) {
        // Получаем позицию элемента относительно detail-view
        const elementRect = element.getBoundingClientRect();
        const containerRect = detailView.getBoundingClientRect();
        const scrollTop = detailView.scrollTop;
        const elementTop = elementRect.top - containerRect.top + scrollTop;

        // Прокручиваем с учетом отступа сверху (например, 20px)
        const offset = 20; // Отступ сверху, чтобы элемент не прилипал к краю
        detailView.scrollTo({
          top: Math.max(0, elementTop - offset),
          behavior: 'smooth'
        });
      } else {
        // Fallback для обычного скролла
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };

    // Функция для прокрутки в начало detail-view
    const scrollToTop = () => {
      const detailView = document.getElementById('detail-view');
      if (detailView) {
        detailView.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
      }
    };

    // 1. НАВИГАЦИЯ ПО ТРЕЙЛЕРАМ
    if (isTrailer && trailerIndex !== -1) {
      if (direction === 'left') {
        return focusEl(trailerLinks[Math.max(0, trailerIndex - 1)] || focused);
      }
      if (direction === 'right') {
        return focusEl(trailerLinks[Math.min(trailerLinks.length - 1, trailerIndex + 1)] || focused);
      }
      if (direction === 'up') {
        // Вверх: переходим на кнопку просмотра
        if (watchBtn && watchBtn.offsetParent !== null) {
          focusEl(watchBtn);
          scrollToTop(); // Прокручиваем вверх, чтобы кнопка была видна
          return true;
        }
        return focusEl(items[Math.max(0, idx - 1)] || focused);
      }
      if (direction === 'down') {
        // Вниз: переходим к актерам или рекомендациям
        if (actorCards.length > 0) {
          focusEl(actorCards[0]);
          scrollToElement(actorCards[0]);
          return true;
        } else if (recommendationCards.length > 0) {
          focusEl(recommendationCards[0]);
          scrollToElement(recommendationCards[0]);
          return true;
        }
        return true;
      }
      return true;
    }

    // 2. НАВИГАЦИЯ ПО АКТЕРАМ
    if (isActor && actorIndex !== -1) {
      if (direction === 'left') {
        return focusEl(actorCards[Math.max(0, actorIndex - 1)] || focused);
      }
      if (direction === 'right') {
        return focusEl(actorCards[Math.min(actorCards.length - 1, actorIndex + 1)] || focused);
      }
      if (direction === 'up') {
        // Вверх: переходим к трейлерам или кнопке просмотра
        if (trailerLinks.length > 0) {
          focusEl(trailerLinks[trailerLinks.length - 1]);
          scrollToElement(trailerLinks[trailerLinks.length - 1]);
          //scrollToTop();
          return true;
        } else if (watchBtn && watchBtn.offsetParent !== null) {
          focusEl(watchBtn);
          scrollToTop(); // Прокручиваем вверх
          return true;
        }
        return focusEl(items[Math.max(0, idx - 1)] || focused);
      }
      if (direction === 'down') {
        // Вниз: переходим к рекомендациям
        if (recommendationCards.length > 0) {
          focusEl(recommendationCards[0]);
          scrollToElement(recommendationCards[0]);
          return true;
        }
        return true;
      }
      return true;
    }

    // 3. НАВИГАЦИЯ ПО РЕКОМЕНДАЦИЯМ
    if (isRecommendation && recommendationIndex !== -1) {
      if (direction === 'left') {
        return focusEl(recommendationCards[Math.max(0, recommendationIndex - 1)] || focused);
      }
      if (direction === 'right') {
        return focusEl(recommendationCards[Math.min(recommendationCards.length - 1, recommendationIndex + 1)] || focused);
      }
      if (direction === 'up') {
        // Вверх: переходим к актерам
        if (actorCards.length > 0) {
          focusEl(actorCards[actorCards.length - 1]);
          scrollToElement(actorCards[actorCards.length - 1]);
          return true;
        } else if (trailerLinks.length > 0) {
          focusEl(trailerLinks[trailerLinks.length - 1]);
          scrollToElement(trailerLinks[trailerLinks.length - 1]);
          //scrollToTop();
          return true;
        } else if (watchBtn && watchBtn.offsetParent !== null) {
          focusEl(watchBtn);
          scrollToTop(); // Прокручиваем вверх
          return true;
        }
        return focusEl(items[Math.max(0, idx - 1)] || focused);
      }
      if (direction === 'down') {
        // Вниз: если есть еще рекомендации, остаемся, иначе ничего
        if (recommendationIndex + 1 < recommendationCards.length) {
          focusEl(recommendationCards[recommendationIndex + 1]);
          scrollToElement(recommendationCards[recommendationIndex + 1]);
          return true;
        }
        return true;
      }
      return true;
    }

    // 4. КНОПКА ПРОСМОТРА (catalog-watch-btn)
    if (isWatchBtn) {
      // Прокручиваем страницу вверх, чтобы кнопка была видна
      scrollToTop();

      if (direction === 'down') {
        // Вниз: переходим к трейлерам, актерам или рекомендациям
        if (trailerLinks.length > 0) {
          focusEl(trailerLinks[0]);
          scrollToElement(trailerLinks[0]);
          //scrollToTop();
          return true;
        } else if (actorCards.length > 0) {
          focusEl(actorCards[0]);
          scrollToElement(actorCards[0]);
          return true;
        } else if (recommendationCards.length > 0) {
          focusEl(recommendationCards[0]);
          scrollToElement(recommendationCards[0]);
          return true;
        }
        return true;
      }
      if (direction === 'left') {
        return focusEl(backBtn || focused);
      }
      if (direction === 'right') {
        return true;
      }
      if (direction === 'up') {
        return focusEl(backBtn || focused);
      }
      return true;
    }

    // 5. КНОПКА НАЗАД (back-from-detail)
    if (isBackBtn) {
      // Прокручиваем страницу вверх, чтобы кнопка была видна
      scrollToTop();

      if (direction === 'down') {
        // Вниз: переходим к кнопке просмотра
        if (watchBtn && watchBtn.offsetParent !== null) {
          focusEl(watchBtn);
          scrollToTop(); // Прокручиваем вверх
          return true;
        }
        return focusEl(items[Math.min(items.length - 1, idx + 1)] || focused);
      }
      if (direction === 'up') {
        // Вверх: остаемся на кнопке, прокручиваем вверх
        scrollToTop();
        return true;
      }
      if (direction === 'left' || direction === 'right') {
        return true;
      }
      return true;
    }

    // 6. ОБЩАЯ НАВИГАЦИЯ ДЛЯ ОСТАЛЬНЫХ ЭЛЕМЕНТОВ
    if (direction === 'up') {
      const targetEl = items[Math.max(0, idx - 1)] || focused;
      focusEl(targetEl);
      if (targetEl.id === 'catalog-watch-btn' || targetEl.id === 'back-from-detail') {
        scrollToTop(); // Для кнопки просмотра и кнопки назад прокручиваем вверх
      } else {
        scrollToElement(targetEl);
      }
      return true;
    }
    if (direction === 'down') {
      const targetEl = items[Math.min(items.length - 1, idx + 1)] || focused;
      focusEl(targetEl);
      if (targetEl.id === 'catalog-watch-btn' || targetEl.id === 'back-from-detail') {
        scrollToTop(); // Для кнопки просмотра и кнопки назад прокручиваем вверх
      } else {
        scrollToElement(targetEl);
      }
      return true;
    }
    if (direction === 'left' || direction === 'right') {
      return true;
    }
    return true;
  }

  function searchHandle(direction) {
    // Получаем текущий режим поиска
    const currentMode = getCurrentSearchMode();

    // Общая часть для обоих режимов до навигации по результатам
    const focused = belongsToScreen(document.querySelector('.focused'), 'search') ? document.querySelector('.focused') : null;
    const query = byId('search-query');
    const top = getSearchTop();
    const filters = getSearchFilters();
    const results = getSearchResults();
    const topWithoutQuery = top.filter(el => el && el.id !== 'search-query');
    const topEntry = topWithoutQuery[0] || filters[0] || results[0] || query;

    if (!focused) return ensureSearchFocus(true, false);

    if (document.activeElement === query && ['left', 'right', 'up', 'down'].includes(direction)) {
      blurEditor();
      return focusEl(topEntry);
    }

    const topIndex = top.indexOf(focused);
    const filterIndex = filters.indexOf(focused);
    const resultIndex = results.indexOf(focused);

    // Если режим torrentsearch - работаем как раньше
    if (currentMode === 'torrentsearch') {
      if (topIndex !== -1) {
        if (direction === 'left') return focusEl(top[Math.max(0, topIndex - 1)] || focused);
        if (direction === 'right') return focusEl(top[Math.min(top.length - 1, topIndex + 1)] || focused);
        if (direction === 'down') {
          if (focused.id === 'search-query') return focusEl(results[0] || focused);
          return focusEl(filters[0] || results[0] || focused);
        }
        if (direction === 'up') return true;
        return true;
      }

      if (filterIndex !== -1) {
        if (direction === 'left') return focusEl(filters[Math.max(0, filterIndex - 1)] || topWithoutQuery[topWithoutQuery.length - 1] || focused);
        if (direction === 'right') {
          if (filterIndex === filters.length - 1 && topWithoutQuery.length) return focusEl(topWithoutQuery[0]);
          return focusEl(filters[Math.min(filters.length - 1, filterIndex + 1)] || focused);
        }
        if (direction === 'up') {
          document.getElementById('filter-toggle').click();
          return focusEl(top[Math.max(0, topIndex - 1)] || focused);
        }
        if (direction === 'down') {
          document.getElementById('filter-toggle').click();
          return focusEl(results[0] || focused);
        } else {
          return true;
        }
      }

      if (resultIndex !== -1) {
        if (direction === 'up') {
          if (resultIndex > 0) return focusEl(results[resultIndex - 1] || focused);
          return focusEl(top[Math.max(0, topIndex - 1)] || focused);
        }
        if (direction === 'down') return focusEl(results[Math.min(results.length - 1, resultIndex + 1)] || focused);
        if (direction === 'left' || direction === 'right') return document.getElementById('filter-toggle').click();
        return true;
      }

      return false;
    }
    // Если режим globalsearch - используем другую навигацию для результатов
    else if (currentMode === 'globalsearch') {
      if (topIndex !== -1) {
        if (direction === 'left') return focusEl(top[Math.max(0, topIndex - 1)] || focused);
        if (direction === 'right') return focusEl(top[Math.min(top.length - 1, topIndex + 1)] || focused);
        if (direction === 'down') {
          if (focused.id === 'search-query') return focusEl(results[0] || focused);
          return focusEl(filters[0] || results[0] || focused);
        }
        if (direction === 'up') return true;
        return true;
      }

      if (filterIndex !== -1) {
        if (direction === 'left') return focusEl(filters[Math.max(0, filterIndex - 1)] || topWithoutQuery[topWithoutQuery.length - 1] || focused);
        if (direction === 'right') {
          if (filterIndex === filters.length - 1 && topWithoutQuery.length) return focusEl(topWithoutQuery[0]);
          return focusEl(filters[Math.min(filters.length - 1, filterIndex + 1)] || focused);
        }
        if (direction === 'up') {
          document.getElementById('filter-toggle').click();
          return focusEl(top[Math.max(0, topIndex - 1)] || focused);
        }
        if (direction === 'down') {
          document.getElementById('filter-toggle').click();
          return focusEl(results[0] || focused);
        } else {
          return true;
        }
      }

      // Навигация по результатам для globalsearch (похожая на torrentHandle)
      if (resultIndex !== -1) {
        // Получаем количество колонок для результатов
        const cols = getColumns(); // предполагаем, что эта функция доступна

        const row = Math.floor(resultIndex / cols);

        if (direction === 'left') {
          return focusEl(results[Math.max(0, resultIndex - 1)] || focused);
        }

        if (direction === 'right') {
          return focusEl(results[Math.min(results.length - 1, resultIndex + 1)] || focused);
        }

        if (direction === 'up') {
          if (row === 0) {
            // Возвращаемся к фильтрам или верхней панели
            return focusEl(top[Math.max(0, topIndex - 1)] || focused);
          }
          return focusEl(results[Math.max(0, resultIndex - cols)] || focused);
        }

        if (direction === 'down') {
          return focusEl(results[Math.min(results.length - 1, resultIndex + cols)] || focused);
        }

        return true;
      }

      return false;
    }

    return false;
  }
  // Вспомогательная функция для получения последнего активного элемента управления
  let lastActiveControl = null;

  function getLastActiveControl() {
    return lastActiveControl;
  }

  // Обновляем функцию focusEl для запоминания последнего активного управления
  const originalFocusEl = window.focusEl;
  window.focusEl = function (element) {
    if (element && element.id &&
      ['search-query', 'search-btn', 'filter-toggle', 'torrent-movie', 'sort-by', 'filter-quality',
        'filter-tracker', 'filter-year', 'search-mode', 'filter-content-type'].includes(element.id)) {
      lastActiveControl = element;
    }
    return originalFocusEl ? originalFocusEl(element) : false;
  };

  function configHandle(direction) {
    const items = getConfigItems();
    const focused = belongsToScreen(document.querySelector('.focused'), 'config') ? document.querySelector('.focused') : null;
    if (!focused) return ensureConfigFocus(true);
    const idx = items.indexOf(focused);
    if (idx === -1) return ensureConfigFocus(true);
    if (direction === 'up') return focusEl(items[Math.max(0, idx - 1)] || focused);
    if (direction === 'down') return focusEl(items[Math.min(items.length - 1, idx + 1)] || focused);
    if (direction === 'left' || direction === 'right') return true;
    return false;
  }

  function onOk() {
    const screen = currentScreen();
    const focused = document.querySelector('.focused');
    if (screen === 'torrents') {
      if (!belongsToScreen(focused, 'torrents')) return ensureTorrentFocus(true);
      if (focused.id === 'search-query' || focused.id === 'search-btn' || focused.id === 'tab-search') return openSearchScreen(true);
      if (focused.id === 'tab-catalog') {
        clickEl(focused);
        return true;
      }
      clickEl(focused);
      return true;
    }
    if (screen === 'catalog') {
      if (!belongsToScreen(focused, 'catalog')) return ensureCatalogFocus(true);
      clickEl(focused);
      return true;
    }
    if (screen === 'search') {
      if (!belongsToScreen(focused, 'search')) return ensureSearchFocus(true, true);

      if (focused.id === 'search-query') {
        focusEl(focused, { nativeFocus: true });
        try { focused.click(); } catch (e) { }
        try { focused.focus(); } catch (e) { }
        try { focused.select && focused.select(); } catch (e) { }
        return true;
      }

      if (focused.tagName === 'SELECT' || focused.id === 'filter-year') {
        return openNativeSearchControl(focused);
      }

      clickEl(focused);
      return true;
    }
    if (screen === 'detail') {
      if (!belongsToScreen(focused, 'detail')) return ensureDetailFocus(true);

      if (focused.classList.contains('file-item')) {
        clickEl(focused.querySelector('.play-btn') || focused);
        return true;
      }

      if (focused.classList.contains('detail-progress-btn')) {
        clickEl(focused);
        return true;
      }

      clickEl(focused);
      return true;
    }
    if (screen === 'config') {
      if (!belongsToScreen(focused, 'config')) return ensureConfigFocus(true);
      focusEl(focused, { nativeFocus: focused.tagName === 'INPUT' });
      clickEl(focused);
      return true;
    }
    return false;
  }

  function onBack() {
    const search = byId('search-overlay');
    const detail = byId('detail-view');
    const config = byId('config-screen');
    //const searchBtn = byId('search-btn');
    const catalog = currentScreen() === 'catalog';
    const donate = currentScreen() === 'donate';

    if (typeof window.closeCatalogTrailerOverlay === 'function' && window.closeCatalogTrailerOverlay()) {
      setTimeout(() => ensureDetailFocus(true), 80);
      return true;
    }

    if (search && !search.classList.contains('hidden') && getComputedStyle(search).display !== 'none') {
      if (typeof window.hideSearchResults === 'function') {
        window.hideSearchResults();
        focusEl(getTorrentTabs()[2]);
      } else {
        leaveSearchToTorrents();
      }
      return true;
    }

    if (detail && getComputedStyle(detail).display !== 'none') {
      clickEl(byId('back-from-detail') || document.querySelector('.back-btn'));
      return true;
    }

    if (donate) {
      window.closeDonateOverlay();
      return true;
    }

    if (catalog) {
      // Сбрасываем сохраненный индекс при возврате к списку каталогов
      if (catalogState) {
        catalogState.lastSelectedIndex = 0;
        catalogState.lastSelectedId = null;
        localStorage.removeItem('lastCatalogCardIndex');
        console.log('🧹 Очищен num_index при выходе из каталога');
      }

      if (typeof window.backToCatalogList === 'function') {
        AppState.currentScreen = 'catalog';
        window.backToCatalogList();
      } else {
        clickEl(byId('back-from-catalog'));
      }
      setTimeout(() => ensureCatalogFocus(true), 180);
      return true;
    }

    if (config && getComputedStyle(config).display !== 'none') {
      const main = byId('torrserver-section');
      config.style.display = 'none';
      if (main) main.style.display = 'block';
      try { window.AppState.currentScreen = 'torrents'; } catch (e) { }
      setTimeout(() => ensureTorrentFocus(true), 180);
      return true;
    }

    return false;
  }

  function isArrowKey(keyCode) { return [37, 38, 39, 40].includes(keyCode) || (typeof isKeyPressed === 'function' && (isKeyPressed('UP', keyCode) || isKeyPressed('DOWN', keyCode) || isKeyPressed('LEFT', keyCode) || isKeyPressed('RIGHT', keyCode))); }
  function arrowDir(keyCode) { return ({ 37: 'left', 38: 'up', 39: 'right', 40: 'down' })[keyCode] || ((typeof isKeyPressed === 'function' && isKeyPressed('UP', keyCode)) ? 'up' : (typeof isKeyPressed === 'function' && isKeyPressed('DOWN', keyCode)) ? 'down' : (typeof isKeyPressed === 'function' && isKeyPressed('LEFT', keyCode)) ? 'left' : (typeof isKeyPressed === 'function' && isKeyPressed('RIGHT', keyCode)) ? 'right' : null); }
  function isOkKey(keyCode) { return keyCode === 13 || (typeof isKeyPressed === 'function' && isKeyPressed('OK', keyCode)); }
  function isBackKey(keyCode) { return [8, 27, 461, 10009].includes(keyCode) || (typeof isKeyPressed === 'function' && (isKeyPressed('BACK', keyCode) || isKeyPressed('EXIT', keyCode))); }
  let okHoldTimer = null;
  let okHoldHandled = false;
  let okHoldFocused = null;

  function clearOkHold() {
    if (okHoldTimer) {
      clearTimeout(okHoldTimer);
      okHoldTimer = null;
    }
  }


  document.addEventListener('keydown', function (e) {
    const screen = currentScreen();
    if (screen === 'player') return;
    if (!['torrents', 'catalog', 'search', 'detail', 'config', 'donate'].includes(screen)) return;
    const active = document.activeElement;
    const editing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');

    if (isBackKey(e.keyCode)) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (typeof isCustomFilterMenuOpen === 'function' && isCustomFilterMenuOpen()) {
        closeCustomFilterMenu();
        return;
      }

      // Если мы в каталоге и есть открытый контент (не список каталогов)
      if (screen === 'catalog' && catalogState.currentCatalog) {
        // Сбрасываем сохраненный индекс при возврате к списку каталогов
        catalogState.lastSelectedIndex = 0;
        catalogState.lastSelectedId = null;
        localStorage.removeItem('lastCatalogCardIndex');
        console.log('🧹 Очищен num_index при выходе из каталога');
      }

      if (editing) {
        blurEditor();
        if (screen === 'search') ensureSearchFocus(true, true);
        else if (screen === 'catalog') ensureCatalogFocus(true);
        else if (screen === 'config') ensureConfigFocus(true);
        else if (screen === 'detail') ensureDetailFocus(true);
        else ensureTorrentFocus(true);
        return;
      }
      onBack();
      return;
    }

    if (isArrowKey(e.keyCode)) {
      e.preventDefault(); e.stopImmediatePropagation();
      const dir = arrowDir(e.keyCode);
      if (typeof isCustomFilterMenuOpen === 'function' && isCustomFilterMenuOpen()) {
        if (dir === 'up') moveCustomFilterMenu(-1);
        else if (dir === 'down') moveCustomFilterMenu(1);
        return;
      }
      if (screen === 'torrents') torrentHandle(dir);
      else if (screen === 'catalog') catalogHandle(dir);
      else if (screen === 'search') searchHandle(dir);
      else if (screen === 'detail') detailHandle(dir);
      else if (screen === 'config') configHandle(dir);
      return;
    }

    if (isOkKey(e.keyCode)) {
      e.preventDefault(); e.stopImmediatePropagation();

      if (typeof isCustomFilterMenuOpen === 'function' && isCustomFilterMenuOpen()) {
        applyCustomFilterMenuSelection();
        return;
      }

      if (screen === 'torrents') {
        const focused = document.querySelector('.focused');
        if (focused && focused.classList.contains('torrent-card')) {
          if (!e.repeat) {
            okHoldHandled = false;
            okHoldFocused = focused;
            clearOkHold();
            okHoldTimer = setTimeout(async () => {
              okHoldHandled = true;
              const hash = okHoldFocused?.dataset?.hash;
              if (typeof window.setTorrentClickSuppressed === 'function') {
                window.setTorrentClickSuppressed(1500);
              }
              if (okHoldFocused) {
                okHoldFocused.dataset.suppressClick = '1';
              }
              if (hash && typeof window.removeTorrentByHash === 'function') {
                await window.removeTorrentByHash(hash, { skipConfirm: true });
              }
              setTimeout(() => {
                if (okHoldFocused) delete okHoldFocused.dataset.suppressClick;
              }, 1500);
            }, 900);
          }
          return;
        }
      }

      onOk();
      return;
    }
  }, true);

  document.addEventListener('keyup', function (e) {
    const screen = currentScreen();
    if (typeof isCustomFilterMenuOpen === 'function' && isCustomFilterMenuOpen()) return;
    if (!isOkKey(e.keyCode) || screen !== 'torrents') return;

    const focused = document.querySelector('.focused');
    const cardStillFocused = focused && okHoldFocused && focused === okHoldFocused;

    clearOkHold();

    if (!okHoldHandled && cardStillFocused && focused.classList.contains('torrent-card')) {
      focused.click();
    }

    okHoldHandled = false;
    okHoldFocused = null;
  }, true);

  setInterval(() => {
    const s = currentScreen();
    if (s === 'player') return;
    if (s === 'torrents') ensureTorrentFocus(false);
    else if (s === 'catalog') ensureCatalogFocus(false);
    else if (s === 'search') ensureSearchFocus(false, true);
    else if (s === 'detail') ensureDetailFocus(false);
    else if (s === 'config') ensureConfigFocus(false);
  }, 250);

  const prevShowDetail = window.showDetail;
  if (typeof prevShowDetail === 'function') {
    window.showDetail = function () {
      const out = prevShowDetail.apply(this, arguments);
      setTimeout(() => {
        if (currentScreen() !== 'player') ensureDetailFocus(true);
      }, 220);
      return out;
    };
  }

  const prevShowSearchResults = window.showSearchResults;
  if (typeof prevShowSearchResults === 'function') {
    window.showSearchResults = function () {
      const out = prevShowSearchResults.apply(this, arguments);
      setTimeout(() => ensureSearchFocus(true, true), 120);
      return out;
    };
  }

  setTimeout(() => ensureTorrentFocus(true), 120);
})();
