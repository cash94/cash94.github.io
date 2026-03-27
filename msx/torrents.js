// Работа с TorrServer и торрентами

// Переменные для поиска
let searchResults = [];
let filteredResults = [];
let currentSearchQuery = '';
let currentSearchMode = 'globalsearch'; // 'torrentsearch' или 'globalsearch'
let globalSearchResults = []; // Результаты глобального поиска

// Настройки фильтрации и сортировки
let currentSort = 'date-desc';
let currentQualityFilter = 'all';
let currentTrackerFilter = 'all';
let currentYearFilter = '';

// Список уникальных трекеров из результатов поиска
let availableTrackers = [];

// Hash последнего добавленного торрента из поиска (в нижнем регистре)
let lastAddedTorrentHash = null;
// Флаг, что последнее воспроизведение было из поиска
let lastPlaybackFromSearch = false;

// Таймеры для long press удаления
const torrentDeleteHoldTimers = new WeakMap();
const TORRENT_DELETE_HOLD_MS = 900;
let suppressTorrentClickUntil = 0;
let pendingRemoteHoldHash = null;


// Кэш для хранения информации о прогрессе
let progressCache = new Map();


const SORT_OPTIONS = [
  { value: 'date-desc', label: '📅 Сначала новые' },
  { value: 'date-asc', label: '📅 Сначала старые' },
  { value: 'size-desc', label: '📏 Размер ↓' },
  { value: 'size-asc', label: '📏 Размер ↑' },
  { value: 'sid-desc', label: '🆔 Сиды ↓' },
  { value: 'sid-asc', label: '🆔 Сиды ↑' },
  { value: 'pir-desc', label: '📊 Пиры ↓' },
  { value: 'pir-asc', label: '📊 Пиры ↑' }
];

const QUALITY_OPTIONS = [
  { value: 'all', label: '🎬 Все качества' },
  { value: '2160', label: '🎬 4K (2160p)' },
  { value: '1080', label: '🎬 Full HD (1080p)' },
  { value: '720', label: '🎬 HD (720p)' },
  { value: '480', label: '🎬 SD (480p)' },
  { value: '360', label: '🎬 360p' }
];

function getTrackerFilterOptions() {
  return [
    { value: 'all', label: '📁 Все трекеры' },
    ...availableTrackers.map(tracker => ({
      value: tracker,
      label: `📁 ${tracker.charAt(0).toUpperCase() + tracker.slice(1)}`
    }))
  ];
}

function getFilterOptions(type) {
  if (type === 'sort') return SORT_OPTIONS;
  if (type === 'quality') return QUALITY_OPTIONS;
  if (type === 'tracker') return getTrackerFilterOptions();
  return [];
}

function getCurrentFilterValue(type) {
  if (type === 'sort') return currentSort;
  if (type === 'quality') return currentQualityFilter;
  if (type === 'tracker') return currentTrackerFilter;
  return '';
}

function setCurrentFilterValue(type, value) {
  if (type === 'sort') currentSort = value;
  if (type === 'quality') currentQualityFilter = value;
  if (type === 'tracker') currentTrackerFilter = value;
}

function fillSelectOptions(select, options, selectedValue) {
  if (!select) return;

  const normalizedSelected = String(selectedValue ?? '');
  select.innerHTML = options.map(option => {
    const selected = String(option.value) === normalizedSelected ? ' selected' : '';
    return `<option value="${option.value}"${selected}>${option.label}</option>`;
  }).join('');

  if (options.some(option => String(option.value) === normalizedSelected)) {
    select.value = normalizedSelected;
  }
}

function syncSearchFilterButtons() {
  fillSelectOptions(document.getElementById('sort-by'), SORT_OPTIONS, currentSort);
  fillSelectOptions(document.getElementById('filter-quality'), QUALITY_OPTIONS, currentQualityFilter);
  fillSelectOptions(document.getElementById('filter-tracker'), getTrackerFilterOptions(), currentTrackerFilter);
}

function cycleFilterButton(filterType, direction = 1) {
  const options = getFilterOptions(filterType);
  if (!options.length) return;

  const currentValue = getCurrentFilterValue(filterType);
  const currentIndex = Math.max(0, options.findIndex(option => option.value === currentValue));
  const nextIndex = (currentIndex + direction + options.length) % options.length;

  setCurrentFilterValue(filterType, options[nextIndex].value);
  syncSearchFilterButtons();
  applyFiltersAndSort();
}

function toggleSearchFiltersPanel(forceOpen = null) {
  const panel = document.getElementById('search-filters-panel');
  const toggleBtn = document.getElementById('filter-toggle');
  if (!panel) return false;

  const shouldOpen = forceOpen === null ? panel.classList.contains('collapsed') : !!forceOpen;
  panel.classList.toggle('collapsed', !shouldOpen);
  if (toggleBtn) {
    toggleBtn.classList.toggle('active', shouldOpen);
    toggleBtn.textContent = shouldOpen ? '🛠️' : '⚙️';
  }
  return shouldOpen;
}

window.toggleSearchFiltersPanel = toggleSearchFiltersPanel;

function getTorrentFiles(torrent) {
  if (!torrent) return [];

  if (torrent.file_stats && Array.isArray(torrent.file_stats) && torrent.file_stats.length > 0) {
    return torrent.file_stats;
  }

  if (torrent.data) {
    try {
      const data = JSON.parse(torrent.data);
      if (data.TorrServer && Array.isArray(data.TorrServer.Files)) {
        return data.TorrServer.Files;
      }
    } catch (e) {
      console.warn('Ошибка парсинга torrent.data:', e);
    }
  }

  return [];
}

function getVideoFilesFromTorrent(torrent) {
  return getTorrentFiles(torrent).filter(file => {
    const name = (file.path || '').toLowerCase();
    return name.endsWith('.mp4') || name.endsWith('.mkv') || name.endsWith('.avi') ||
      name.endsWith('.mov') || name.endsWith('.webm') || name.endsWith('.m4v');
  });
}

function inferSearchResultIsSeries(searchResult = null, torrent = null) {
  if (searchResult?.types && Array.isArray(searchResult.types) && searchResult.types.includes('tv')) {
    return true;
  }

  if (torrent) {
    const videoFiles = getVideoFilesFromTorrent(torrent);
    if (videoFiles.length > 1) {
      return true;
    }
  }

  const title = (searchResult?.title || searchResult?.name || torrent?.title || '').toLowerCase();
  return /(s\d{1,2}e\d{1,2})|(season|сезон|серия|эпизод)/i.test(title);
}

function getPreferredPlaybackFile(torrent, searchResult = null) {
  const videoFiles = getVideoFilesFromTorrent(torrent);
  if (videoFiles.length === 0) {
    return { fileId: 1, episodeIndex: null, isSeries: inferSearchResultIsSeries(searchResult, torrent) };
  }

  const isSeries = inferSearchResultIsSeries(searchResult, torrent) || videoFiles.length > 1;
  const targetIndex = 0;
  const targetFile = videoFiles[targetIndex] || videoFiles[0];

  return {
    fileId: targetFile?.id || 1,
    episodeIndex: isSeries ? targetIndex : null,
    isSeries
  };
}

function clearTorrentDeleteHoldTimer(card) {
  const timer = torrentDeleteHoldTimers.get(card);
  if (timer) {
    clearTimeout(timer);
    torrentDeleteHoldTimers.delete(card);
  }
}

window.removeTorrentByHash = removeTorrentByHash;
window.setTorrentClickSuppressed = function (ms = 1200) { suppressTorrentClickUntil = Date.now() + ms; };

async function removeTorrentByHash(hash, options = {}) {
  if (!hash || !AppState.currentTorrserverUrl) {
    return false;
  }

  const { skipConfirm = false } = options;
  const torrent = AppState.torrents.find(t => (t.hash || '').toLowerCase() === String(hash).toLowerCase());
  const title = torrent?.title || 'эту раздачу';

  if (!skipConfirm && !window.confirm(`Удалить ${title}?`)) {
    return false;
  }

  showLoading('Удаление торрента...');

  try {
    const response = await fetch(`${AppState.currentTorrserverUrl}/torrents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({
        action: 'rem',
        hash
      })
    });

    if (!response.ok) {
      throw new Error(`Ошибка удаления: HTTP ${response.status}`);
    }

    try {
      await response.json();
    } catch (e) { }

    if (AppState.currentDetailItem && (AppState.currentDetailItem.hash || '').toLowerCase() === String(hash).toLowerCase()) {
      document.getElementById('detail-view').style.display = 'none';
      AppState.currentDetailItem = null;
      AppState.currentScreen = 'torrents';
      const mainContainer = document.getElementById('main-container');
      if (mainContainer) mainContainer.style.pointerEvents = 'auto';
      document.getElementById('torrserver-section').style.display = 'block';
    }

    await refreshTorrentsList();
    return true;
  } catch (error) {
    console.error('Ошибка удаления торрента:', error);
    alert('Ошибка удаления: ' + error.message);
    return false;
  } finally {
    hideLoading();
  }
}

function attachTorrentDeleteLongPress(card, torrent) {
  if (!card || !torrent || !torrent.hash) return;

  const startHold = (event) => {
    if (event?.target?.closest && event.target.closest('button, input, select, textarea, a')) {
      return;
    }

    clearTorrentDeleteHoldTimer(card);
    const timer = setTimeout(async () => {
      suppressTorrentClickUntil = Date.now() + 1200;
      pendingRemoteHoldHash = null;
      card.dataset.suppressClick = '1';
      card.classList.remove('touch-active');
      await removeTorrentByHash(torrent.hash, { skipConfirm: true });
      setTimeout(() => {
        if (card) delete card.dataset.suppressClick;
      }, 1200);
    }, TORRENT_DELETE_HOLD_MS);
    torrentDeleteHoldTimers.set(card, timer);
  };

  const stopHold = () => clearTorrentDeleteHoldTimer(card);

  card.addEventListener('touchstart', startHold, { passive: true });
  card.addEventListener('touchend', stopHold);
  card.addEventListener('touchcancel', stopHold);
  card.addEventListener('touchmove', stopHold);
  card.addEventListener('mousedown', startHold);
  card.addEventListener('mouseup', stopHold);
  card.addEventListener('mouseleave', stopHold);
  card.addEventListener('click', (e) => {
    const shouldSuppress = card.dataset.suppressClick === '1' || Date.now() < suppressTorrentClickUntil;
    if (shouldSuppress) {
      e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();
      delete card.dataset.suppressClick;
      return false;
    }
  }, true);
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    suppressTorrentClickUntil = Date.now() + 1200;
    card.dataset.suppressClick = '1';
    removeTorrentByHash(torrent.hash, { skipConfirm: true }).finally(() => {
      setTimeout(() => {
        if (card) delete card.dataset.suppressClick;
      }, 1200);
    });
  });
}

// Загрузка сохраненной конфигурации клиента
async function loadClientConfig() {
  try {
    const response = await fetch(`${SERVER_URL}/api/client/config`);
    if (response.ok) {
      const data = await response.json();
      AppState.clientId = data.clientId;

      // Заполняем поля формы сохраненными данными
      if (data.config) {
        const urlInput = document.getElementById('torrserver-url');
        const authCheckbox = document.getElementById('auth-checkbox');
        const authLogin = document.getElementById('auth-login');
        const authPassword = document.getElementById('auth-password');

        if (data.config.url) {
          urlInput.value = data.config.url;
        }

        if (data.config.authEnabled) {
          authCheckbox.checked = true;
          AppState.authEnabled = true;
          document.getElementById('auth-fields').classList.add('visible');

          if (data.config.login) {
            authLogin.value = data.config.login;
          }

          // Пароль не заполняем, только показываем, что он сохранен
          if (data.config.hasPassword) {
            authPassword.placeholder = '•••••••• (сохранен)';
          }
        }

        console.log('✅ Загружена конфигурация клиента:', data.clientId);
      }

      return data;
    }
  } catch (error) {
    console.error('Ошибка загрузки конфигурации:', error);
  }
  return null;
}

// Сохранение конфигурации клиента
async function saveClientConfig() {
  const url = document.getElementById('torrserver-url').value.trim();
  const authEnabled = document.getElementById('auth-checkbox').checked;
  const login = document.getElementById('auth-login').value.trim();
  const password = document.getElementById('auth-password').value.trim();

  const config = {
    url,
    authEnabled,
    login
  };

  // Отправляем пароль только если он был изменен
  if (password) {
    config.password = password;
  }

  try {
    const response = await fetch(`${SERVER_URL}/api/client/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });

    if (response.ok) {
      const data = await response.json();
      console.log('✅ Конфигурация сохранена:', data);
      return true;
    }
  } catch (error) {
    console.error('Ошибка сохранения конфигурации:', error);
  }
  return false;
}

// НОВАЯ ФУНКЦИЯ: Загрузка прогресса для торрента
async function loadProgressForTorrent(torrent) {
  if (!torrent || !torrent.hash) return null;

  // Проверяем кэш
  const cacheKey = torrent.hash;
  if (progressCache.has(cacheKey)) {
    const cached = progressCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < 60000)) { // Кэш на 1 минуту
      return cached.data;
    }
  }

  try {
    // Парсим данные торрента для получения списка файлов
    let files = [];
    if (torrent.file_stats && Array.isArray(torrent.file_stats)) {
      files = torrent.file_stats;
    } else if (torrent.data) {
      try {
        const data = JSON.parse(torrent.data);
        if (data.TorrServer && data.TorrServer.Files) {
          files = data.TorrServer.Files;
        }
      } catch (e) {
        console.error('Ошибка парсинга data:', e);
      }
    }

    // Если это фильм (один файл или data.lampa)
    if (files.length === 0 && torrent.data) {
      try {
        const data = JSON.parse(torrent.data);
        if (data.lampa && data.movie) {
          // Это фильм из LAMPA, используем hash для запроса
          const response = await fetch(`${SERVER_URL}/api/timecode/get?hash=${torrent.hash}&fileId=1`);
          if (response.ok) {
            const timecodeData = await response.json();
            if (timecodeData.success && timecodeData.timecode > 0) {
              const progress = {
                hash: torrent.hash,
                fileId: '1',
                timecode: timecodeData.timecode,
                duration: timecodeData.duration,
                isMovie: true,
                episodeIndex: 0
              };
              // Сохраняем в кэш
              progressCache.set(cacheKey, {
                data: progress,
                timestamp: Date.now()
              });
              return progress;
            }
          }
        }
      } catch (e) {
        console.error('Ошибка парсинга LAMPA data:', e);
      }
      return null;
    }

    // Для сериала - проверяем каждый файл
    if (files.length > 0) {
      // Сортируем файлы (предполагаем, что они уже в правильном порядке)
      const videoFiles = files.filter(file => {
        const name = file.path.toLowerCase();
        return name.endsWith('.mp4') || name.endsWith('.mkv') || name.endsWith('.avi') ||
          name.endsWith('.mov') || name.endsWith('.webm') || name.endsWith('.m4v');
      });

      if (videoFiles.length === 0) return null;

      // Загружаем таймкоды для всех файлов
      const progressPromises = videoFiles.map(async (file, index) => {
        try {
          const response = await fetch(`${SERVER_URL}/api/timecode/get?hash=${torrent.hash}&fileId=${file.id}`);
          if (response.ok) {
            const data = await response.json();
            if (data.success && data.timecode > 0) {
              return {
                hash: torrent.hash,
                fileId: file.id,
                timecode: data.timecode,
                duration: data.duration,
                index: index,
                fileName: file.path.split('/').pop()
              };
            }
          }
        } catch (e) {
          console.error(`Ошибка загрузки прогресса для файла ${file.id}:`, e);
        }
        return null;
      });

      const results = await Promise.all(progressPromises);
      const validProgress = results.filter(r => r !== null);

      if (validProgress.length > 0) {
        // Находим последнюю просмотренную серию (по индексу)
        validProgress.sort((a, b) => b.index - a.index);
        const lastWatched = validProgress[0];

        const progress = {
          hash: torrent.hash,
          fileId: lastWatched.fileId,
          timecode: lastWatched.timecode,
          duration: lastWatched.duration,
          episodeIndex: lastWatched.index,
          totalEpisodes: videoFiles.length,
          episodeName: lastWatched.fileName,
          isSeries: true
        };

        // Сохраняем в кэш
        progressCache.set(cacheKey, {
          data: progress,
          timestamp: Date.now()
        });

        return progress;
      }
    }

    return null;
  } catch (error) {
    console.error('Ошибка загрузки прогресса:', error);
    return null;
  }
}

// НОВАЯ ФУНКЦИЯ: Добавление информации о прогрессе в карточку
async function addProgressToCard(card, torrent) {
  if (!torrent || !torrent.hash) return;

  // Проверяем кэш
  const cacheKey = torrent.hash;
  if (progressCache.has(cacheKey)) {
    const cached = progressCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < 60000)) { // Кэш на 1 минуту
      renderProgressBadge(card, cached.data);
      return;
    }
  }

  const progress = await loadProgressForTorrent(torrent);

  if (progress) {
    // Сохраняем в кэш
    progressCache.set(cacheKey, {
      data: progress,
      timestamp: Date.now()
    });

    renderProgressBadge(card, progress);
  }
}

// НОВАЯ ФУНКЦИЯ: Отрисовка бейджа прогресса
function renderProgressBadge(card, progress) {
  // Удаляем старый бейдж если есть
  const oldBadge = card.querySelector('.progress-badge');
  if (oldBadge) oldBadge.remove();

  const progressBadge = document.createElement('div');
  progressBadge.className = 'progress-badge';

  const timeStr = formatTime(progress.timecode);
  const totalStr = progress.duration ? formatTime(progress.duration) : '??:??';

  if (progress.isSeries) {
    // Для сериала
    const episodeNum = progress.episodeIndex + 1;
    progressBadge.innerHTML = `
      <div class="progress-content" data-hash="${progress.hash}" data-file-id="${progress.fileId}" data-timecode="${progress.timecode}" data-episode-index="${progress.episodeIndex}">
        <div class="progress-info">
          <span class="progress-episode">📺 Серия ${episodeNum}</span>
          <span class="progress-time">⏱️ ${timeStr} / ${totalStr}</span>
        </div>
        <button class="progress-continue-btn">▶ Продолжить</button>
      </div>
    `;
  } else if (progress.isMovie) {
    // Для фильма
    progressBadge.innerHTML = `
      <div class="progress-content" data-hash="${progress.hash}" data-file-id="${progress.fileId}" data-timecode="${progress.timecode}" data-episode-index="0">
        <div class="progress-info">
          <span class="progress-time">⏱️ ${timeStr} / ${totalStr}</span>
        </div>
        <button class="progress-continue-btn">▶ Продолжить</button>
      </div>
    `;
  } else {
    // Для обычного файла
    progressBadge.innerHTML = `
      <div class="progress-content" data-hash="${progress.hash}" data-file-id="${progress.fileId}" data-timecode="${progress.timecode}" data-episode-index="0">
        <div class="progress-info">
          <span class="progress-time">⏱️ ${timeStr} / ${totalStr}</span>
        </div>
        <button class="progress-continue-btn">▶ Продолжить</button>
      </div>
    `;
  }

  // Добавляем обработчик для кнопки "Продолжить"
  const continueBtn = progressBadge.querySelector('.progress-continue-btn');
  continueBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const hash = progress.hash;
    const fileId = progress.fileId;
    const timecode = progress.timecode;
    const episodeIndex = progress.episodeIndex || 0;

    // Формируем URL с таймкодом
    const playUrl = `${AppState.currentTorrserverUrl}/play/${hash}/${fileId}`;

    document.getElementById('playback-overlay').classList.add('active');
    document.getElementById('detail-view').style.pointerEvents = 'none';

    // Передаем episodeIndex в startHLSPlayback
    startHLSPlayback(playUrl, timecode, false, episodeIndex).then(() => {
      document.getElementById('playback-overlay').classList.remove('active');
      document.getElementById('detail-view').style.pointerEvents = 'auto';
    }).catch(() => {
      document.getElementById('playback-overlay').classList.remove('active');
      document.getElementById('detail-view').style.pointerEvents = 'auto';
    });
  });

  card.appendChild(progressBadge);
}

// НОВАЯ ФУНКЦИЯ: Добавление информации о прогрессе в детальный просмотр
async function addProgressToDetail(torrent) {
  if (!torrent || !torrent.hash) return;

  const progress = await loadProgressForTorrent(torrent);

  // Если нет прогресса, ничего не добавляем
  if (!progress) return;

  const detailHeader = document.querySelector('.detail-header');
  if (!detailHeader) return;

  const progressDiv = document.createElement('div');
  progressDiv.id = 'detail-progress';
  progressDiv.className = 'detail-progress';
  progressDiv.dataset.hash = torrent.hash;

  const timeStr = formatTime(progress.timecode);
  const totalStr = progress.duration ? formatTime(progress.duration) : '??:??';

  if (progress.isSeries) {
    const episodeNum = progress.episodeIndex + 1;
    progressDiv.innerHTML = `
      <div class="detail-progress-content">
        <div class="detail-progress-info">
          <span class="detail-progress-label">Продолжить просмотр:</span>
          <span class="detail-progress-episode">📺 Серия ${episodeNum}</span>
          <span class="detail-progress-time">⏱️ ${timeStr} / ${totalStr}</span>
        </div>
        <button class="detail-progress-btn" data-hash="${progress.hash}" data-file-id="${progress.fileId}" data-timecode="${progress.timecode}" data-episode-index="${progress.episodeIndex}">
          ▶ Продолжить с ${timeStr}
        </button>
      </div>
    `;
  } else {
    progressDiv.innerHTML = `
      <div class="detail-progress-content">
        <div class="detail-progress-info">
          <span class="detail-progress-label">Продолжить просмотр:</span>
          <span class="detail-progress-time">⏱️ ${timeStr} / ${totalStr}</span>
        </div>
        <button class="detail-progress-btn" data-hash="${progress.hash}" data-file-id="${progress.fileId}" data-timecode="${progress.timecode}" data-episode-index="0">
          ▶ Продолжить с ${timeStr}
        </button>
      </div>
    `;
  }

  const progressBtn = progressDiv.querySelector('.detail-progress-btn');
  progressBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const hash = progress.hash;
    const fileId = progress.fileId;
    const timecode = progress.timecode;
    const episodeIndex = parseInt(progressBtn.dataset.episodeIndex || 0);

    const playUrl = `${AppState.currentTorrserverUrl}/play/${hash}/${fileId}`;

    document.getElementById('playback-overlay').classList.add('active');
    document.getElementById('detail-view').style.pointerEvents = 'none';

    // Передаем episodeIndex в startHLSPlayback через дополнительный параметр
    startHLSPlayback(playUrl, timecode, false, episodeIndex).then(() => {
      document.getElementById('playback-overlay').classList.remove('active');
      document.getElementById('detail-view').style.pointerEvents = 'auto';
    }).catch(() => {
      document.getElementById('playback-overlay').classList.remove('active');
      document.getElementById('detail-view').style.pointerEvents = 'auto';
    });
  });

  detailHeader.parentNode.insertBefore(progressDiv, detailHeader.nextSibling);
}

// Проверка сервера
async function checkServer(shouldLoadTorrents = true) {
  const urlInput = document.getElementById('torrserver-url');
  const statusIndicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');

  const url = urlInput.value.trim();
  if (!url) {
    statusIndicator.className = 'status-indicator status-offline';
    statusText.textContent = 'Введите адрес сервера';
    return false;
  }

  statusIndicator.className = 'status-indicator status-checking';
  statusText.textContent = 'Проверка...';

  try {
    const testUrl = url.endsWith('/') ? url.slice(0, -1) : url;
    const response = await fetch(`${testUrl}/echo`, {
      method: 'GET',
      headers: getAuthHeaders()
    });

    if (response.ok) {
      const text = await response.text();
      if (/MatriX\.\d+/.test(text)) {
        statusIndicator.className = 'status-indicator status-online';
        statusText.textContent = 'Сервер доступен ✓';
        AppState.currentTorrserverUrl = testUrl;
        AppState.serverOnline = true;

        // Сохраняем конфигурацию после успешной проверки
        await saveClientConfig();

        // Если нужно, загружаем торренты
        if (shouldLoadTorrents) {
          await loadTorrents();
        }

        return true;
      }
    }

    throw new Error('Сервер не отвечает');
  } catch (error) {
    statusIndicator.className = 'status-indicator status-offline';
    statusText.textContent = 'Сервер недоступен ✗';
    AppState.serverOnline = false;
    return false;
  }
}

// Загрузка списка торрентов
async function loadTorrents(silent = false) {
  const torrentsGrid = document.getElementById('torrents-grid');

  if (!AppState.serverOnline) {
    const checked = await checkServer(false);
    if (!checked) {
      if (!silent) {
        alert('Сначала подключитесь к серверу');
        // Показываем экран настроек
        document.getElementById('config-screen').style.display = 'flex';
        document.getElementById('torrserver-section').style.display = 'none';
        AppState.currentScreen = 'config';
      }
      return;
    }
  }

  if (!silent) {
    showLoading('Загрузка торрентов...');
    if (torrentsGrid) {
      torrentsGrid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 40px;">Загрузка...</div>';
    }
  }

  try {
    console.log('📥 Загрузка списка торрентов с сервера...');
    const response = await fetch(`${AppState.currentTorrserverUrl}/torrents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({ action: 'list' })
    });

    if (!response.ok) {
      throw new Error(`Ошибка загрузки: HTTP ${response.status}`);
    }

    const data = await response.json();
    console.log('📦 Получены данные торрентов:', Array.isArray(data) ? `${data.length} шт.` : data);

    AppState.torrents = Array.isArray(data) ? data : [];

    // Показываем секцию торрентов
    document.getElementById('config-screen').style.display = 'none';
    document.getElementById('torrserver-section').style.display = 'block';
    AppState.currentScreen = 'torrents';

    // Рендерим список
    renderTorrents();

    return true;

  } catch (error) {
    console.error('❌ Ошибка загрузки торрентов:', error);

    if (!silent) {
      if (torrentsGrid) {
        torrentsGrid.innerHTML = `
          <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">
            <div style="font-size: 48px; margin-bottom: 20px;">❌</div>
            <div style="font-size: 16px; color: #ff6a6a;">Ошибка: ${error.message}</div>
            <button class="btn" style="margin-top: 20px;" onclick="loadTorrents()">Попробовать снова</button>
          </div>
        `;
      }
    }

    return false;
  } finally {
    if (!silent) {
      hideLoading();
    }
  }
}

// Принудительное обновление списка торрентов (с очисткой кэша)
async function refreshTorrents(showLoading = true) {
  console.log('🔄 Принудительное обновление списка торрентов');

  // Очищаем кэш прогресса
  if (typeof progressCache !== 'undefined') {
    progressCache.clear();
  }

  // Загружаем торренты
  return await loadTorrents(!showLoading);
}

// Отрисовка карточек торрентов
function renderTorrents() {
  const torrentsGrid = document.getElementById('torrents-grid');
  torrentsGrid.innerHTML = '';

  // Очищаем кэш прогресса при обновлении списка
  progressCache.clear();

  if (AppState.torrents.length === 0) {
    // Показываем сообщение о пустом списке
    torrentsGrid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">
        <div style="font-size: 48px; margin-bottom: 20px;">📁</div>
        <div style="font-size: 18px; color: #aaa; margin-bottom: 10px;">Нет торрентов</div>
        <div style="font-size: 14px; color: #666;">Используйте поиск выше, чтобы найти и добавить торренты</div>
      </div>
    `;
    return;
  }

  // Здесь остается существующий код для отрисовки торрентов
  AppState.torrents.forEach(async (torrent) => {
    let poster = '';
    let title = torrent.title || 'Без названия';
    let category = torrent.category || '';
    let isTv = false;

    try {
      // Проверяем наличие file_stats (активный торрент)
      if (torrent.file_stats && Array.isArray(torrent.file_stats) && torrent.file_stats.length > 0) {
        isTv = torrent.file_stats.length > 1;
      }
      // Проверяем data поле
      else if (torrent.data) {
        const data = JSON.parse(torrent.data);

        if (data.TorrServer && data.TorrServer.Files && data.TorrServer.Files.length > 0) {
          isTv = data.TorrServer.Files.length > 1;
        }

        if (data.movie) {
          if (data.movie.img) {
            poster = data.movie.img;
          } else if (data.movie.poster_path) {
            poster = `https://image.tmdb.org/t/p/w342${data.movie.poster_path}`;
          }
        }
      }
    } catch (e) {
      console.warn('Ошибка парсинга data для торрента:', e);
    }

    if (!poster && torrent.poster) {
      poster = torrent.poster;
    }

    let displayCategory = isTv ? 'tv' : (category || 'movie');

    const card = document.createElement('div');
    card.className = 'torrent-card';
    card.dataset.hash = torrent.hash;
    card.onclick = () => showDetail(torrent);
    attachTorrentDeleteLongPress(card, torrent);

    card.innerHTML = `
      <div class="torrent-poster">
        ${poster ? `<img src="${poster}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'no-poster\\'>Нет постера</div>'">` : '<div class="no-poster">Нет постера</div>'}
      </div>
      <div class="torrent-info">
        <div class="torrent-title">${escapeHtml(title)}</div>
        <div class="torrent-meta">
          <span>${formatBytes(torrent.torrent_size)}</span>
          <span class="torrent-badge">${displayCategory === 'tv' ? 'Сериал' : 'Фильм'}</span>
        </div>
      </div>
    `;

    torrentsGrid.appendChild(card);

    // Загружаем и добавляем прогресс
    await addProgressToCard(card, torrent);
  });

  if (AppState.currentScreen === 'torrents' && !document.querySelector('.torrent-card.focused')) {
    setTimeout(() => {
      if (typeof window.focusFirstTorrentCard === 'function') {
        window.focusFirstTorrentCard();
      }
    }, 80);
  }
}
// Показать детали торрента по hash
function showDetailByHash(hash) {
  if (!hash) return false;

  // Приводим hash к нижнему регистру для поиска
  const hashLower = hash.toLowerCase();

  // Ищем торрент по hash (без учета регистра)
  const torrent = AppState.torrents.find(t => t.hash && t.hash.toLowerCase() === hashLower);

  if (torrent) {
    showDetail(torrent);
    return true;
  }

  return false;
}

function hideCatalogDetailExtra() {
  const extra = document.getElementById('catalog-detail-extra');
  const filesList = document.getElementById('files-list');
  const subtitle = document.getElementById('detail-subtitle');
  const backdrop = document.getElementById('catalog-detail-backdrop');
  const meta = document.getElementById('catalog-detail-meta');
  const overview = document.getElementById('catalog-detail-overview');
  const trailersWrap = document.getElementById('catalog-detail-trailers-wrap');
  const trailers = document.getElementById('catalog-detail-trailers');
  const shotsWrap = document.getElementById('catalog-detail-screenshots-wrap');
  const shots = document.getElementById('catalog-detail-screenshots');
  if (extra) extra.classList.add('hidden');
  if (filesList) filesList.style.display = 'block';
  if (subtitle) subtitle.textContent = '';
  if (backdrop) {
    backdrop.classList.add('hidden');
    backdrop.style.backgroundImage = '';
  }
  if (meta) meta.innerHTML = '';
  if (overview) overview.textContent = '';
  if (trailersWrap) trailersWrap.classList.add('hidden');
  if (trailers) trailers.innerHTML = '';
  if (shotsWrap) shotsWrap.classList.add('hidden');
  if (shots) shots.innerHTML = '';
}

window.hideCatalogDetailExtra = hideCatalogDetailExtra;

// Показать детали торрента
async function showDetail(torrent) {
  // Сохраняем hash и индекс перед открытием
  if (torrent && torrent.hash) {
    lastSelectedTorrentHash = torrent.hash;
    console.log('💾 Сохранен hash перед открытием деталей:', lastSelectedTorrentHash);
  }

  if (typeof currentFocusIndex !== 'undefined') {
    lastSelectedTorrentIndex = currentFocusIndex;
    console.log('💾 Сохранен индекс перед открытием:', currentFocusIndex);
  }

  AppState.currentDetailItem = torrent;
  const detailView = document.getElementById('detail-view');

  // Убеждаемся что detail-view перекрывает все
  detailView.style.display = 'block';
  detailView.style.zIndex = '100';

  // Блокируем взаимодействие с основным контентом
  const mainContainer = document.getElementById('main-container');
  if (mainContainer) {
    mainContainer.style.pointerEvents = 'none';
  }

  AppState.currentScreen = 'detail';
  AppState.detailReturnTo = 'torrents';
  hideCatalogDetailExtra();

  const posterImg = document.getElementById('detail-poster');
  const titleEl = document.getElementById('detail-title-text');
  const filesList = document.getElementById('files-list');

  let poster = '';
  try {
    if (torrent.data) {
      const data = JSON.parse(torrent.data);
      if (data.movie && data.movie.img) {
        poster = data.movie.img;
      } else if (data.movie && data.movie.poster_path) {
        poster = `https://image.tmdb.org/t/p/w342${data.movie.poster_path}`;
      }
    }
  } catch (e) { }

  if (!poster && torrent.poster) {
    poster = torrent.poster;
  }

  posterImg.innerHTML = poster ? `<img src="${poster}" alt="poster">` : '<div class="no-poster">Нет постера</div>';
  titleEl.textContent = torrent.title || 'Без названия';

  // Удаляем старый прогресс если есть
  const oldProgress = document.getElementById('detail-progress');
  if (oldProgress) oldProgress.remove();

  // Добавляем прогресс для текущего торрента
  await addProgressToDetail(torrent);

  filesList.innerHTML = '<div style="text-align: center; padding: 20px;">Загрузка...</div>';

  try {
    let files = [];

    // Проверяем наличие file_stats (активный торрент)
    if (torrent.file_stats && Array.isArray(torrent.file_stats) && torrent.file_stats.length > 0) {
      files = torrent.file_stats;
    }
    // Проверяем data поле
    else if (torrent.data) {
      const data = JSON.parse(torrent.data);

      if (data.TorrServer && data.TorrServer.Files) {
        files = data.TorrServer.Files;
      } else if (data.lampa && data.movie) {
        // Для LAMPA формата
        filesList.innerHTML = '';
        addMovieItem(torrent);
        return;
      }
    }

    if (files.length === 0) {
      filesList.innerHTML = '<div style="text-align: center; padding: 20px;">Нет файлов</div>';
    } else {
      filesList.innerHTML = '';
      files.forEach(file => {
        addFileItem(file, torrent.hash);
      });
    }

  } catch (e) {
    console.error('Ошибка парсинга данных:', e);
    filesList.innerHTML = '<div style="text-align: center; padding: 20px; color: #ff6a6a;">Ошибка загрузки файлов</div>';
  }

  // Устанавливаем фокус на первый элемент в детальном просмотре
  setTimeout(() => {
    if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
      updateFocusableElements();

      // 1. Ищем все элементы файлов
      const fileItems = document.querySelectorAll('.file-item');

      let targetIndex = -1;

      // 2. Если есть файлы, ставим фокус на первый файл
      if (fileItems.length > 0) {
        targetIndex = focusableElements.findIndex(el => el.classList.contains('file-item'));

        if (targetIndex !== -1) {
          setFocus(targetIndex);
          console.log('🎯 Фокус в детальном просмотре на первый файл');
          return;
        }
      }

      // 3. Если файлов нет, пробуем найти кнопку "Продолжить"
      const progressBtn = document.querySelector('.detail-progress-btn');
      if (progressBtn) {
        targetIndex = focusableElements.findIndex(el =>
          el.classList.contains('detail-progress-btn')
        );

        if (targetIndex !== -1) {
          setFocus(targetIndex);
          console.log('🎯 Фокус в детальном просмотре на кнопке "Продолжить"');
          return;
        }
      }

      // 4. Фолбэк на кнопку "Назад"
      const backBtn = document.querySelector('.back-btn');
      if (backBtn) {
        targetIndex = focusableElements.findIndex(el => el.classList.contains('back-btn'));
        if (targetIndex !== -1) {
          setFocus(targetIndex);
          console.log('🎯 Фокус в детальном просмотре на кнопке "Назад"');
          return;
        }
      }

      setFocus(0);
      console.log('🎯 Фокус в детальном просмотре на первый элемент');
    }
  }, 300);
}

// Добавить элемент файла (для сериалов)
function addFileItem(file, hash) {
  const fileName = file.path.split('/').pop() || `Файл ${file.id}`;
  const fileSize = formatBytes(file.length);

  const item = document.createElement('div');
  item.className = 'file-item';
  item.innerHTML = `
    <div class="file-name">
      <div>${escapeHtml(fileName)}</div>
      <div style="font-size: 12px; color: #888; margin-top: 4px;">${fileSize}</div>
    </div>
    <button class="play-btn" data-hash="${hash}" data-file-id="${file.id}">▶ Воспроизвести</button>
  `;

  item.querySelector('.play-btn').onclick = (e) => {
    e.stopPropagation();
    const btn = e.currentTarget;

    const playUrl = file.id ?
      `${AppState.currentTorrserverUrl}/play/${hash}/${file.id}` :
      `${AppState.currentTorrserverUrl}/play/${hash}/1`;

    document.getElementById('playback-overlay').classList.add('active');
    document.getElementById('detail-view').style.pointerEvents = 'none';

    // Явно передаем timecode = 0 для воспроизведения с начала
    startHLSPlayback(playUrl, 0, false).then(() => {
      document.getElementById('playback-overlay').classList.remove('active');
      document.getElementById('detail-view').style.pointerEvents = 'auto';
    }).catch(() => {
      document.getElementById('playback-overlay').classList.remove('active');
      document.getElementById('detail-view').style.pointerEvents = 'auto';
    });
  };

  document.getElementById('files-list').appendChild(item);
}

// Добавить элемент фильма
function addMovieItem(torrent) {
  const filesList = document.getElementById('files-list');
  filesList.innerHTML = '';

  const item = document.createElement('div');
  item.className = 'file-item';
  item.innerHTML = `
    <div class="file-name">
      <div>${escapeHtml(torrent.title || 'Фильм')}</div>
      <div style="font-size: 12px; color: #888; margin-top: 4px;">${formatBytes(torrent.torrent_size)}</div>
    </div>
    <button class="play-btn" data-hash="${torrent.hash}">▶ Воспроизвести</button>
  `;

  item.querySelector('.play-btn').onclick = (e) => {
    e.stopPropagation();
    const btn = e.currentTarget;

    const playUrl = `${AppState.currentTorrserverUrl}/play/${torrent.hash}/1`;

    document.getElementById('playback-overlay').classList.add('active');
    document.getElementById('detail-view').style.pointerEvents = 'none';

    // Явно передаем timecode = 0 для воспроизведения с начала
    startHLSPlayback(playUrl, 0, false).then(() => {
      document.getElementById('playback-overlay').classList.remove('active');
      document.getElementById('detail-view').style.pointerEvents = 'auto';
    }).catch(() => {
      document.getElementById('playback-overlay').classList.remove('active');
      document.getElementById('detail-view').style.pointerEvents = 'auto';
    });
  };

  filesList.appendChild(item);
}

function normalizeSearchResult(item) {
  const normalized = { ...item };

  const releasedRaw = normalized.released ?? normalized.relased ?? normalized.year ?? null;
  const releasedYear = parseInt(releasedRaw, 10);

  normalized.released = Number.isFinite(releasedYear) ? releasedYear : null;
  normalized.relased = normalized.released;
  normalized.tracker = (normalized.tracker || '').toString().trim().toLowerCase();

  return normalized;
}

async function searchTorrents(query) {
  if (!query || !query.trim()) {
    alert('Введите поисковый запрос');
    return;
  }

  // Получаем текущий режим поиска
  const searchMode = getCurrentSearchMode();

  if (searchMode === 'globalsearch') {
    // Используем глобальный поиск через TMDB
    await searchTMDB(query);
  } else {
    // Оригинальный поиск по торрентам
    await searchTorrentsLegacy(query);
  }
}

// Функция поиска торрентов
async function searchTorrentsLegacy(query) {
  if (!query || !query.trim()) {
    alert('Введите поисковый запрос');
    return;
  }

  const encodedQuery = encodeURIComponent(query.trim());
  const searchUrl = `https://jac.red/api/v1.0/torrents?search=${encodedQuery}&apikey=null&exact=true`;

  showLoading('Поиск...');

  try {
    const response = await fetch(searchUrl);
    if (!response.ok) throw new Error('Ошибка поиска');

    const data = await response.json();
    searchResults = (Array.isArray(data) ? data : []).map(normalizeSearchResult);
    currentSearchQuery = query;

    const searchInput = document.getElementById('search-query');
    if (searchInput) {
      searchInput.value = '';
    }

    updateAvailableTrackers();
    applyFiltersAndSort();
    showSearchResults();

  } catch (error) {
    console.error('Ошибка поиска:', error);
    alert('Ошибка при поиске: ' + error.message);
  } finally {
    hideLoading();
  }
}

// Добавляем обработчик изменения режима поиска
function initSearchModeToggle() {
  const modeSelect = document.getElementById('search-mode');
  if (modeSelect) {
    modeSelect.addEventListener('change', (e) => {
      currentSearchMode = e.target.value;

      // Адаптируем интерфейс под выбранный режим
      const trackerFilter = document.getElementById('filter-tracker');
      const qualityFilter = document.getElementById('filter-quality');
      const contentTypeFilter = document.getElementById('filter-content-type');

      if (currentSearchMode === 'globalsearch') {
        // Для глобального поиска отключаем ненужные фильтры
        if (trackerFilter) trackerFilter.disabled = true;
        if (qualityFilter) qualityFilter.disabled = true;
        if (!contentTypeFilter) showContentTypeFilter();
      } else {
        // Для поиска по торрентам включаем обратно
        if (trackerFilter) trackerFilter.disabled = false;
        if (qualityFilter) qualityFilter.disabled = false;
        if (contentTypeFilter) contentTypeFilter.remove();
      }

      // Если есть текущий поиск, обновляем результаты
      if (currentSearchQuery) {
        searchTorrents(currentSearchQuery);
      }
    });
  }
}


// Обновление списка доступных трекеров
function updateAvailableTrackers() {
  const trackerSet = new Set();

  searchResults.forEach(result => {
    if (result.tracker) {
      trackerSet.add(result.tracker);
    }
  });

  availableTrackers = Array.from(trackerSet).sort();
  if (!availableTrackers.includes(currentTrackerFilter)) {
    currentTrackerFilter = 'all';
  }
  syncSearchFilterButtons();
}

// Применение фильтров и сортировки
function applyFiltersAndSort() {
  filteredResults = searchResults.filter(item => {
    if (currentQualityFilter !== 'all') {
      const quality = parseInt(currentQualityFilter, 10);
      if ((item.quality || 0) !== quality) return false;
    }

    if (currentTrackerFilter !== 'all') {
      const tracker = (item.tracker || '').toLowerCase();
      if (tracker !== currentTrackerFilter) return false;
    }

    if (currentYearFilter) {
      const year = parseInt(currentYearFilter, 10);
      if (!Number.isFinite(year) || item.released !== year) return false;
    }

    return true;
  });

  filteredResults.sort((a, b) => {
    switch (currentSort) {
      case 'date-desc':
        return new Date(b.createTime || 0) - new Date(a.createTime || 0);
      case 'date-asc':
        return new Date(a.createTime || 0) - new Date(b.createTime || 0);
      case 'size-desc':
        return (b.size || 0) - (a.size || 0);
      case 'size-asc':
        return (a.size || 0) - (b.size || 0);
      case 'sid-desc':
        return (b.sid || 0) - (a.sid || 0);
      case 'sid-asc':
        return (a.sid || 0) - (b.sid || 0);
      case 'pir-desc':
        return (b.pir || 0) - (a.pir || 0);
      case 'pir-asc':
        return (a.pir || 0) - (b.pir || 0);
      default:
        return 0;
    }
  });

  renderSearchResults();
}

// Отображение результатов поиска
function showSearchResults(options = {}) {
  const searchOverlay = document.getElementById('search-overlay');
  const searchTab = document.getElementById('tab-search');
  const torrentsTab = document.getElementById('tab-torrents');
  const catalogTab = document.getElementById('tab-catalog');
  const searchInput = document.getElementById('search-query');

  if (!searchOverlay || !searchTab || !torrentsTab) return;

  //const previousScreen = AppState.currentScreen;
  //if (previousScreen === 'catalog') {
    //AppState.searchReturnTo = 'catalog';
  //} else if (previousScreen !== 'search') {
   // AppState.searchReturnTo = 'catalog';
  //}

  if (searchInput && document.activeElement === searchInput) {
    searchInput.blur();
  }

  searchOverlay.classList.remove('hidden');
  searchTab.classList.add('active');
  torrentsTab.classList.remove('active');
  catalogTab?.classList.remove('active');
  AppState.currentScreen = 'search';

  syncSearchFilterButtons();
  toggleSearchFiltersPanel(false);

  if (options.runSearch && searchInput && searchInput.value.trim()) {
    setTimeout(() => searchTorrents(searchInput.value.trim()), 0);
  }

  setTimeout(() => {
    if (typeof window.focusSearchHome === 'function') {
      window.focusSearchHome(options.focusQuery !== false);
      return;
    }

    if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
      updateFocusableElements();

      const searchInputIndex = focusableElements.findIndex(el => el.id === 'search-query');
      const searchBtnIndex = focusableElements.findIndex(el => el.id === 'search-btn');
      const filterToggleIndex = focusableElements.findIndex(el => el.id === 'filter-toggle');
      const firstFilterIndex = focusableElements.findIndex(el =>
        ['sort-by', 'filter-quality', 'filter-tracker', 'filter-year', 'reset-filters', 'close-search'].includes(el.id)
      );

      const targetIndex = options.focusQuery !== false
        ? (searchInputIndex !== -1 ? searchInputIndex : (searchBtnIndex !== -1 ? searchBtnIndex : filterToggleIndex))
        : (firstFilterIndex !== -1 ? firstFilterIndex : (filterToggleIndex !== -1 ? filterToggleIndex : 0));

      setFocus(targetIndex !== -1 ? targetIndex : 0);
    }
  }, 80);
}

// Скрытие результатов поиска
function hideSearchResults() {
  const searchOverlay = document.getElementById('search-overlay');
  const searchTab = document.getElementById('tab-search');
  const torrentsTab = document.getElementById('tab-torrents');
  const catalogTab = document.getElementById('tab-catalog');
  const searchInput = document.getElementById('search-query');
  document.getElementById('torrent-movie').value = 'globalsearch';

  if (!searchOverlay || !searchTab || !torrentsTab) return;

  // Определяем куда возвращаться
  const returnTo = AppState.searchReturnTo || 'torrents';

  searchOverlay.classList.add('hidden');
  searchTab.classList.remove('active');
  toggleSearchFiltersPanel(false);

  // Обработка возврата в зависимости от режима
  if (returnTo === 'detail') {
    // Возврат в детальный просмотр
    AppState.currentScreen = 'detail';

    // Скрываем вкладки каталога/торрентов
    catalogTab?.classList.remove('active');
    torrentsTab.classList.remove('active');

    // Показываем детальный просмотр, если он скрыт
    const detailView = document.getElementById('detail-view');
    if (detailView && detailView.style.display !== 'block') {
      detailView.style.display = 'block';
    }

    // Восстанавливаем детальный просмотр
    if (AppState.pendingDetailItem) {
      console.log('📺 Возврат к детальному просмотру:',
        AppState.pendingDetailItem.torrent?.[0]?.name || 'Фильм');

      showCatalogDetail(
        AppState.pendingDetailItem,
        AppState.pendingDetailIndex || 0,
        AppState.pendingDetailPoster
      );

      // Очищаем сохраненные данные
      AppState.pendingDetailItem = null;
      AppState.pendingDetailPoster = null;
      AppState.pendingDetailIndex = null;
    } else if (AppState.currentDetailItem) {
      // Если есть текущий элемент детального просмотра
      showCatalogDetail(
        AppState.currentDetailItem,
        catalogState.lastSelectedIndex || 0,
        null
      );
    }

    // Устанавливаем фокус на кнопку просмотра
    setTimeout(() => {
      if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
        updateFocusableElements();
        const watchBtn = document.getElementById('catalog-watch-btn');
        if (watchBtn) {
          const watchIndex = focusableElements.findIndex(el => el.id === 'catalog-watch-btn');
          if (watchIndex !== -1) {
            setFocus(watchIndex);
            return;
          }
        }
      }
      // Если кнопка не найдена, фокус на первую карточку
      if (typeof window.ensureCatalogDetailFocus === 'function') {
        window.ensureCatalogDetailFocus(true);
      }
    }, 100);

  } else if (returnTo === 'catalog') {
    // Возврат в каталог
    catalogTab?.classList.add('active');
    torrentsTab.classList.remove('active');
    AppState.currentScreen = 'catalog';

    setTimeout(() => {
      if (typeof window.focusCatalogCardByIndex === 'function') {
        const savedIndex = localStorage.getItem('lastCatalogCardIndex');
        const targetIndex = savedIndex !== null ?
          window.focusCatalogCardByIndex(parseInt(savedIndex)) : 0;

        if (typeof window.ensureCatalogFocus === 'function') {
          window.ensureCatalogFocus(true);
        } else if (typeof window.focusFirstCatalogCard === 'function') {
          window.focusFirstCatalogCard();
        }
      } else if (typeof window.focusFirstCatalogCard === 'function') {
        window.focusFirstCatalogCard();
      }
    }, 80);

  } else {
    // Возврат в торренты (по умолчанию)
    torrentsTab.classList.add('active');
    catalogTab?.classList.remove('active');
    AppState.currentScreen = 'torrents';

    setTimeout(() => {
      if (typeof window.focusFirstTorrentCard === 'function' && window.focusFirstTorrentCard()) {
        return;
      }

      if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
        updateFocusableElements();
        const firstCardIndex = focusableElements.findIndex(el =>
          el.classList && el.classList.contains('torrent-card')
        );
        setFocus(firstCardIndex !== -1 ? firstCardIndex : 0);
      }
    }, 80);
  }

  if (searchInput && document.activeElement === searchInput) {
    searchInput.blur();
  }

  // Очищаем searchReturnTo после использования
  AppState.searchReturnTo = null;
}

// Сброс всех фильтров
function resetFilters() {
  currentSort = 'date-desc';
  currentQualityFilter = 'all';
  currentTrackerFilter = 'all';
  currentYearFilter = '';

  syncSearchFilterButtons();
  const filterYear = document.getElementById('filter-year');
  if (filterYear) {
    filterYear.value = '';
  }

  applyFiltersAndSort();
}

// Добавление торрента в TorrServer
async function addTorrentToServer(magnet, hash, searchResult = null) {
  if (!AppState.currentTorrserverUrl) {
    alert('Сначала подключитесь к TorrServer');
    return null;
  }

  // Используем постер из каталога, если он есть
  let poster = null;

  // Сначала проверяем, есть ли сохраненный постер из каталога
  if (window.pendingCatalogPoster) {
    poster = window.pendingCatalogPoster;
    console.log('🖼️ Используем постер из каталога:', poster);
  }
  // Если нет, ищем через TMDB
  else if (searchResult) {
    console.log('🖼️ Поиск постера через TMDB для:', searchResult.title || searchResult.name);
    poster = await tmdb.findPosterFromSearchResult(searchResult);
    if (poster) {
      console.log('✅ Постер найден через TMDB:', poster);
    }
  }

  try {
    console.log('➕ Добавление торрента в TorrServer:', magnet);

    const requestBody = {
      action: 'add',
      link: magnet,
      save_to_db: true
    };

    // Добавляем постер, если нашли
    if (poster) {
      requestBody.poster = poster;
      console.log('🖼️ Добавляем постер в запрос');
    }

    const response = await fetch(`${AppState.currentTorrserverUrl}/torrents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`Ошибка добавления: ${response.status}`);
    }

    const data = await response.json();
    console.log('✅ Торрент добавлен:', data);

    // Очищаем временные данные
    window.pendingCatalogPoster = null;
    window.pendingCatalogItem = null;

    // Сохраняем hash добавленного торрента в нижнем регистре
    lastAddedTorrentHash = hash.toLowerCase();

    // Ждем немного для обновления списка
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Обновляем список торрентов
    await refreshTorrentsList();

    // Ищем добавленный торрент по hash (в нижнем регистре)
    const addedTorrent = AppState.torrents.find(t => t.hash && t.hash.toLowerCase() === lastAddedTorrentHash);

    return addedTorrent || null;

  } catch (error) {
    console.error('❌ Ошибка добавления торрента:', error);
    alert('Ошибка при добавлении торрента: ' + error.message);

    // Очищаем временные данные даже при ошибке
    window.pendingCatalogPoster = null;
    window.pendingCatalogItem = null;

    return null;
  }
}

// Обновление списка торрентов
async function refreshTorrentsList() {
  const focusedCard = document.querySelector('.torrent-card.focused');
  const preserveHash = focusedCard?.dataset.hash || window.lastSelectedTorrentHash || null;
  const preserveIndex = typeof window.lastSelectedTorrentIndex === 'number' ? window.lastSelectedTorrentIndex : 0;

  try {
    const response = await fetch(`${AppState.currentTorrserverUrl}/torrents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({ action: 'list' })
    });

    if (response.ok) {
      const data = await response.json();
      AppState.torrents = Array.isArray(data) ? data : [];
      renderTorrents();

      if (AppState.currentScreen === 'torrents') {
        setTimeout(() => {
          if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
            updateFocusableElements();
            let targetIndex = focusableElements.findIndex(el => el.classList.contains('torrent-card') && preserveHash && el.dataset.hash === preserveHash);
            if (targetIndex === -1) {
              const cards = focusableElements.filter(el => el.classList.contains('torrent-card'));
              if (cards[preserveIndex]) {
                targetIndex = focusableElements.indexOf(cards[preserveIndex]);
              }
            }
            if (targetIndex === -1) {
              targetIndex = focusableElements.findIndex(el => el.classList.contains('torrent-card'));
            }
            if (targetIndex !== -1) setFocus(targetIndex);
          }
        }, 80);
      }
      return true;
    }
  } catch (error) {
    console.error('Ошибка обновления списка:', error);
  }
  return false;
}

// Воспроизведение по hash
async function playFromHash(hash, magnet, searchResult = null) {
  console.log('🎬 playFromHash вызван:');
  console.log('   Hash:', hash);
  console.log('   SearchResult:', searchResult ? searchResult.title || searchResult.name : 'null');

  if (!hash) {
    alert('Ошибка: hash не найден');
    return;
  }

  if (!AppState.currentTorrserverUrl) {
    alert('Сначала подключитесь к TorrServer');
    return;
  }

  document.getElementById('playback-overlay').classList.add('active');
  document.querySelector('.playback-text').textContent = 'Поиск постера и добавление...';

  try {
    let addedTorrent = await addTorrentToServer(magnet, hash, searchResult);

    hideSearchResults();

    if (!addedTorrent) {
      await refreshTorrentsList();
      addedTorrent = AppState.torrents.find(t => (t.hash || '').toLowerCase() === hash.toLowerCase()) || null;
    }

    if (addedTorrent) {
      AppState.currentDetailItem = addedTorrent;
    }

    const playbackTarget = getPreferredPlaybackFile(addedTorrent, searchResult);
    const fileId = playbackTarget.fileId || 1;

    document.querySelector('.playback-text').textContent = playbackTarget.isSeries
      ? 'Воспроизведение серии...'
      : 'Воспроизведение...';

    const playUrl = `${AppState.currentTorrserverUrl}/play/${hash}/${fileId}`;
    console.log('🎬 URL воспроизведения:', playUrl, 'isSeries:', playbackTarget.isSeries, 'episodeIndex:', playbackTarget.episodeIndex);

    await startHLSPlayback(playUrl, null, true, playbackTarget.episodeIndex);

  } catch (error) {
    console.error('❌ Ошибка воспроизведения:', error);
    alert('Ошибка воспроизведения: ' + error.message);
  } finally {
    document.getElementById('playback-overlay').classList.remove('active');
    document.querySelector('.playback-text').textContent = 'Воспроизведение...';
  }
}

// Очистка результатов поиска (только при новом поиске)
function clearSearchResults() {
  searchResults = [];
  filteredResults = [];
  currentSearchQuery = '';
  availableTrackers = [];
  currentTrackerFilter = 'all';
  syncSearchFilterButtons();
}

// Рендеринг результатов поиска
function renderSearchResults() {
  const searchResultsDiv = document.getElementById('search-results');

  if (!searchResultsDiv) return;

  if (filteredResults.length === 0) {
    const totalResults = searchResults.length;
    searchResultsDiv.innerHTML = `
      <div class="filter-stats">Всего найдено: <span>${totalResults}</span></div>
      <div class="search-result-empty">
        ${currentSearchQuery ? `Нет результатов по фильтрам для "${escapeHtml(currentSearchQuery)}"` : 'Введите запрос для поиска'}
      </div>
    `;
    return;
  }

  let html = `<div class="filter-stats">Показано: <span>${filteredResults.length}</span> из <span>${searchResults.length}</span></div>`;

  filteredResults.forEach((result, index) => {
    const voices = Array.isArray(result.voices) ? result.voices : [];
    const quality = result.quality || 'N/A';
    const size = result.sizeName || formatBytes(result.size);
    const year = result.released || 'N/A';
    const type = result.types && result.types.includes('tv') ? 'Сериал' : 'Фильм';
    const date = result.createTime ? new Date(result.createTime).toLocaleDateString() : 'N/A';

    // Информация о sid и pir
    const sid = result.sid !== undefined ? result.sid : 0;
    const pir = result.pir !== undefined ? result.pir : 0;

    // Извлекаем hash из magnet ссылки (в нижнем регистре)
    const hash = extractHashFromMagnet(result.magnet);

    // Форматируем трекер для отображения
    const tracker = result.tracker || 'Unknown';
    const trackerDisplay = tracker.charAt(0).toUpperCase() + tracker.slice(1);

    // 👇 НОВЫЙ БЛОК С DATA-RESULT
    html += `
      <div class="search-result-item" data-index="${index}">
        <div class="search-result-info">
          <div class="search-result-title">${escapeHtml(result.title || result.name || 'Без названия')}</div>
          
          <div class="search-result-meta">
            <div class="search-result-meta-item">
              <span>📁</span> ${escapeHtml(trackerDisplay)}
            </div>
            <div class="search-result-meta-item">
              <span>📏</span> ${escapeHtml(size)}
            </div>
            <div class="search-result-meta-item">
              <span>📅</span> ${year} (${date})
            </div>
            <div class="search-result-meta-item">
              <span>🎬</span> ${type} / ${quality}p
            </div>
            <div class="search-result-meta-item">
              <span>🆔</span> сиды: ${sid}
            </div>
            <div class="search-result-meta-item">
              <span>📊</span> пиры: ${pir}
            </div>
          </div>
          
          ${voices.length > 0 ? `
            <div class="search-result-voices">
              ${voices.map(v => `<span class="search-result-voice">${escapeHtml(v)}</span>`).join('')}
            </div>
          ` : ''}
        </div>
        
        <button class="search-result-play" 
                data-hash="${hash}" 
                data-magnet="${escapeHtml(result.magnet)}"
                data-result='${escapeHtml(JSON.stringify(result))}'
                ${!hash ? 'disabled' : ''}>
          ${hash ? '▶ PLAY' : '❌ Нет hash'}
        </button>
      </div>
    `;
  });

  searchResultsDiv.innerHTML = html;

  // Добавляем обработчики для кнопок PLAY
  searchResultsDiv.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', () => {
      const playBtn = item.querySelector('.search-result-play');
      playBtn?.click();
    });
  });

  searchResultsDiv.querySelectorAll('.search-result-play').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const hash = btn.dataset.hash;
      const magnet = btn.dataset.magnet;
      const resultJson = btn.dataset.result;

      console.log('▶️ Нажата кнопка PLAY');
      console.log('   Hash:', hash);
      console.log('   Magnet:', magnet);
      console.log('   Есть постер из каталога:', !!window.pendingCatalogPoster);

      if (hash) {
        let searchResult = null;
        if (resultJson) {
          try {
            searchResult = JSON.parse(resultJson);
            console.log('   Найден сохраненный результат:', searchResult.title || searchResult.name);

            // Если есть постер из каталога, добавляем его в searchResult
            if (window.pendingCatalogPoster) {
              searchResult.poster = window.pendingCatalogPoster;
              console.log('   Добавлен постер из каталога в searchResult');
            }
          } catch (e) {
            console.error('Ошибка парсинга resultJson:', e);
          }
        }

        playFromHash(hash, magnet, searchResult);
      } else {
        alert('Не удалось извлечь hash из magnet ссылки');
      }
    });
  });
}

// Получение класса для трекера
function getTrackerClass(tracker) {
  if (!tracker) return 'tracker-other';

  const t = tracker.toLowerCase();
  if (t.includes('kinozal')) return 'tracker-kinozal';
  if (t.includes('rutor')) return 'tracker-rutor';
  if (t.includes('rutracker')) return 'tracker-rutracker';
  return 'tracker-other';
}

// Извлечение hash из magnet ссылки (в нижнем регистре)
function extractHashFromMagnet(magnet) {
  if (!magnet) return null;

  // Ищем xt=urn:btih:ХЕШ
  const match = magnet.match(/xt=urn:btih:([a-fA-F0-9]{40})/i);
  if (match && match[1]) {
    return match[1].toLowerCase(); // Возвращаем в нижнем регистре
  }

  // Альтернативный формат
  const altMatch = magnet.match(/[a-fA-F0-9]{40}/);
  if (altMatch) {
    return altMatch[0].toLowerCase(); // Возвращаем в нижнем регистре
  }

  return null;
}

// Функция для получения текущего режима поиска
function getCurrentSearchMode() {
  const modeSelect = document.getElementById('torrent-movie');
  if (modeSelect) {
    currentSearchMode = modeSelect.value;
  }
  return currentSearchMode;
}

// НОВАЯ ФУНКЦИЯ: Поиск через TMDB
async function searchTMDB(query) {
  if (!query || !query.trim()) {
    alert('Введите поисковый запрос');
    return;
  }

  showLoading('Поиск в TMDB...');

  try {
    const encodedQuery = encodeURIComponent(query.trim());

    // Параллельный поиск фильмов и сериалов для лучших результатов
    const [moviesResponse, tvResponse] = await Promise.allSettled([
      fetch(`/api/tmdb/search?query=${encodedQuery}&type=movie&year=`),
      fetch(`/api/tmdb/search?query=${encodedQuery}&type=tv&year=`),
      fetch(`/api/tmdb/search?query=${encodedQuery}&type=person&year=`)
    ]);

    let allResults = [];

    // Обрабатываем фильмы
    if (moviesResponse.status === 'fulfilled' && moviesResponse.value.ok) {
      const moviesData = await moviesResponse.value.json();
      if (moviesData.results) {
        const movieItems = moviesData.results.map(item => ({
          ...item,
          media_type: 'movie',
          title: item.title,
          name: item.title,
          release_date: item.release_date,
          vote_average: item.vote_average,
          vote_count: item.vote_count,
          overview: item.overview,
          poster_path: item.poster_path,
          backdrop_path: item.backdrop_path,
          id: item.id,
          // Добавляем метаданные для поиска
          searchQuery: query
        }));
        allResults.push(...movieItems);
      }
    }

    // Обрабатываем сериалы
    if (tvResponse.status === 'fulfilled' && tvResponse.value.ok) {
      const tvData = await tvResponse.value.json();
      if (tvData.results) {
        const tvItems = tvData.results.map(item => ({
          ...item,
          media_type: 'tv',
          title: item.name,
          name: item.name,
          first_air_date: item.first_air_date,
          vote_average: item.vote_average,
          vote_count: item.vote_count,
          overview: item.overview,
          poster_path: item.poster_path,
          backdrop_path: item.backdrop_path,
          id: item.id,
          searchQuery: query
        }));
        allResults.push(...tvItems);
      }
    }

    // Сортируем по рейтингу и количеству голосов
    allResults.sort((a, b) => {
      // Сначала по рейтингу
      const ratingDiff = (b.vote_average || 0) - (a.vote_average || 0);
      if (ratingDiff !== 0) return ratingDiff;
      // Затем по количеству голосов
      return (b.vote_count || 0) - (a.vote_count || 0);
    });

    globalSearchResults = allResults;
    currentSearchQuery = query;

    console.log(`✅ Найдено ${globalSearchResults.length} результатов в TMDB`);

    // Очищаем фильтры для глобального поиска
    if (currentSearchMode === 'globalsearch') {
      // Скрываем фильтры трекеров и качества (они не нужны для TMDB)
      //const trackerFilter = document.getElementById('filter-tracker');
      //const qualityFilter = document.getElementById('filter-quality');
      //if (trackerFilter) trackerFilter.disabled = true;
      //if (qualityFilter) qualityFilter.disabled = true;

      // Показываем фильтр по типу контента
      showContentTypeFilter();
    }

    // Отображаем результаты
    showGlobalSearchResults();

  } catch (error) {
    console.error('Ошибка поиска в TMDB:', error);
    alert('Ошибка при поиске: ' + error.message);
  } finally {
    hideLoading();
  }
}

// НОВАЯ ФУНКЦИЯ: Показать результаты глобального поиска
function showGlobalSearchResults() {
  const searchResultsDiv = document.getElementById('search-results');
  const searchOverlay = document.getElementById('search-overlay');

  if (!searchResultsDiv) return;

  // Убеждаемся, что overlay виден
  if (searchOverlay) {
    searchOverlay.classList.remove('hidden');
  }

  if (globalSearchResults.length === 0) {
    searchResultsDiv.innerHTML = `
            <div class="filter-stats">Всего найдено: <span>0</span></div>
            <div class="search-result-empty">
                ${currentSearchQuery ? `Ничего не найдено для "${escapeHtml(currentSearchQuery)}" в TMDB` : 'Введите запрос для поиска'}
            </div>
        `;
    return;
  }

  // Вычисляем оптимальное количество колонок (максимум 8)
  const containerWidth = searchResultsDiv.clientWidth;
  const cardMinWidth = 200;
  let columns = Math.floor(containerWidth / cardMinWidth);
  columns = Math.min(columns, 8); // Ограничиваем максимум 8 колонками
  columns = Math.max(columns, 1); // Минимум 1 колонка

  // Используем CSS Grid с фиксированным количеством колонок
  const gridTemplateColumns = `repeat(${columns}, minmax(${cardMinWidth}px, 1fr))`;

  let html = `<div class="filter-stats">Найдено в TMDB: <span>${globalSearchResults.length}</span></div>`;
  html += `<div class="global-search-grid" style="display: grid; grid-template-columns: ${gridTemplateColumns}; gap: 20px; padding: 20px 0;">`;

  globalSearchResults.forEach((result, index) => {
    const title = result.title || result.name || 'Без названия';
    const year = result.release_date || result.first_air_date;
    const yearStr = year ? new Date(year).getFullYear() : 'N/A';
    const mediaType = result.media_type === 'tv' ? 'Сериал' : 'Фильм';
    const rating = result.vote_average ? result.vote_average.toFixed(1) : null;
    const posterUrl = result.poster_path
      ? `https://nmtmdb.duckdns.org/t/p/w342${result.poster_path}`
      : null;

    html += `
            <div class="global-search-card" data-index="${index}" data-tmdb-id="${result.id}" data-media-type="${result.media_type}" style="
                background: rgba(30, 30, 40, 0.9);
                border-radius: 12px;
                overflow: hidden;
                cursor: pointer;
                transition: transform 0.2s, box-shadow 0.2s;
                border: 1px solid rgba(74, 158, 255, 0.3);
            ">
                <div class="global-search-poster" style="
                    position: relative;
                    aspect-ratio: 2/3;
                    overflow: hidden;
                    background: linear-gradient(135deg, #1a1a2e, #16213e);
                ">
                    ${posterUrl ? `
                        <img src="${posterUrl}" alt="${escapeHtml(title)}" style="
                            width: 100%;
                            height: 100%;
                            object-fit: cover;
                        " onerror="this.parentElement.innerHTML='<div style=\'display: flex; align-items: center; justify-content: center; height: 100%; font-size: 48px;\'>🎬</div>'">
                    ` : `
                        <div style="display: flex; align-items: center; justify-content: center; height: 100%; font-size: 48px;">
                            ${mediaType === 'Сериал' ? '📺' : '🎬'}
                        </div>
                    `}
                    ${rating ? `
                        <div style="
                            position: absolute;
                            top: 8px;
                            right: 8px;
                            background: rgba(0, 0, 0, 0.8);
                            color: ${getRatingColor(parseFloat(rating))};
                            font-weight: bold;
                            font-size: 12px;
                            padding: 4px 8px;
                            border-radius: 12px;
                            border: 1px solid ${getRatingColor(parseFloat(rating))};
                        ">
                            ⭐ ${rating}
                        </div>
                    ` : ''}
                </div>
                <div class="global-search-info" style="padding: 12px;">
                    <div class="global-search-title" style="
                        font-weight: 600;
                        font-size: 14px;
                        margin-bottom: 6px;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    ">${escapeHtml(title)}</div>
                    <div style="
                        display: flex;
                        justify-content: space-between;
                        font-size: 12px;
                        color: #aaa;
                    ">
                        <span>${mediaType}</span>
                        <span>${yearStr}</span>
                    </div>
                </div>
            </div>
        `;
  });

  html += `</div>`;
  searchResultsDiv.innerHTML = html;

  // Добавляем обработчики кликов на карточки
  document.querySelectorAll('.global-search-card').forEach(card => {
    card.addEventListener('click', async () => {
      const tmdbId = card.dataset.tmdbId;
      const mediaType = card.dataset.mediaType;
      const index = parseInt(card.dataset.index);
      const result = globalSearchResults[index];

      if (result) {
        await showGlobalSearchDetail(result);
      }
    });
  });
}

function renderFilteredGlobalResults(results) {
  const searchResultsDiv = document.getElementById('search-results');
  if (!searchResultsDiv) return;

  if (results.length === 0) {
    searchResultsDiv.innerHTML = `
            <div class="filter-stats">Всего найдено: <span>0</span></div>
            <div class="search-result-empty">
                Нет результатов для выбранного типа контента
            </div>
        `;
    return;
  }

  // Вычисляем оптимальное количество колонок (максимум 8)
  const containerWidth = searchResultsDiv.clientWidth;
  const cardMinWidth = 200;
  let columns = Math.floor(containerWidth / cardMinWidth);
  columns = Math.min(columns, 8); // Ограничиваем максимум 8 колонками
  columns = Math.max(columns, 8); // Минимум 1 колонка

  // Используем CSS Grid с фиксированным количеством колонок
  const gridTemplateColumns = `repeat(${columns}, minmax(${cardMinWidth}px, 1fr))`;

  let html = `<div class="filter-stats">Найдено в TMDB: <span>${results.length}</span></div>`;
  html += `<div class="global-search-grid" style="display: grid; grid-template-columns: ${gridTemplateColumns}; gap: 20px; padding: 20px 0;">`;

  results.forEach((result, idx) => {
    const title = result.title || result.name || 'Без названия';
    const year = result.release_date || result.first_air_date;
    const yearStr = year ? new Date(year).getFullYear() : 'N/A';
    const mediaType = result.media_type === 'tv' ? 'Сериал' : 'Фильм';
    const rating = result.vote_average ? result.vote_average.toFixed(1) : null;
    const posterUrl = result.poster_path
      ? `https://nmtmdb.duckdns.org/t/p/w342${result.poster_path}`
      : null;

    html += `
            <div class="global-search-card" data-tmdb-id="${result.id}" data-media-type="${result.media_type}" style="
                background: rgba(30, 30, 40, 0.9);
                border-radius: 12px;
                overflow: hidden;
                cursor: pointer;
                transition: transform 0.2s, box-shadow 0.2s;
                border: 1px solid rgba(74, 158, 255, 0.3);
            ">
                <div class="global-search-poster" style="
                    position: relative;
                    aspect-ratio: 2/3;
                    overflow: hidden;
                    background: linear-gradient(135deg, #1a1a2e, #16213e);
                ">
                    ${posterUrl ? `
                        <img src="${posterUrl}" alt="${escapeHtml(title)}" style="
                            width: 100%;
                            height: 100%;
                            object-fit: cover;
                        " onerror="this.parentElement.innerHTML='<div style=\'display: flex; align-items: center; justify-content: center; height: 100%; font-size: 48px;\'>🎬</div>'">
                    ` : `
                        <div style="display: flex; align-items: center; justify-content: center; height: 100%; font-size: 48px;">
                            ${mediaType === 'Сериал' ? '📺' : '🎬'}
                        </div>
                    `}
                    ${rating ? `
                        <div style="
                            position: absolute;
                            top: 8px;
                            right: 8px;
                            background: rgba(0, 0, 0, 0.8);
                            color: ${getRatingColor(parseFloat(rating))};
                            font-weight: bold;
                            font-size: 12px;
                            padding: 4px 8px;
                            border-radius: 12px;
                            border: 1px solid ${getRatingColor(parseFloat(rating))};
                        ">
                            ⭐ ${rating}
                        </div>
                    ` : ''}
                </div>
                <div class="global-search-info" style="padding: 12px;">
                    <div class="global-search-title" style="
                        font-weight: 600;
                        font-size: 14px;
                        margin-bottom: 6px;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    ">${escapeHtml(title)}</div>
                    <div style="
                        display: flex;
                        justify-content: space-between;
                        font-size: 12px;
                        color: #aaa;
                    ">
                        <span>${mediaType}</span>
                        <span>${yearStr}</span>
                    </div>
                </div>
            </div>
        `;
  });

  html += `</div>`;
  searchResultsDiv.innerHTML = html;

  // Добавляем обработчики
  document.querySelectorAll('.global-search-card').forEach(card => {
    card.addEventListener('click', async () => {
      const tmdbId = card.dataset.tmdbId;
      const mediaType = card.dataset.mediaType;
      const result = results.find(r => String(r.id) === tmdbId);
      if (result) {
        await showGlobalSearchDetail(result);
      }
    });
  });
}

// НОВАЯ ФУНКЦИЯ: Показать детали элемента из глобального поиска
async function showGlobalSearchDetail(item) {
  console.log('📺 Открываем детали из глобального поиска:', item.title || item.name);

  // Формируем объект, совместимый с catalog.js
  const catalogItem = {
    id: item.id,
    media_type: item.media_type,
    title: item.title || item.name,
    name: item.name || item.title,
    overview: item.overview,
    poster_path: item.poster_path,
    backdrop_path: item.backdrop_path,
    vote_average: item.vote_average,
    release_date: item.release_date,
    first_air_date: item.first_air_date,
    // Добавляем торрент информацию для поиска
    torrent: [{
      name: item.title || item.name
    }]
  };

  // Получаем URL постера
  const posterUrl = item.poster_path
    ? `https://nmtmdb.duckdns.org/t/p/w342${item.poster_path}`
    : null;

  // Используем catalog.js для показа деталей
  if (typeof window.showCatalogDetail === 'function') {
    // Сохраняем контекст для возврата
    AppState.searchReturnTo = 'search';
    AppState.currentScreen = 'detail';

    // Показываем детали
    await window.showCatalogDetail(catalogItem, 0, posterUrl);

    // Скрываем поиск
    const searchOverlay = document.getElementById('search-overlay');
    if (searchOverlay) {
      searchOverlay.classList.add('hidden');
    }
  } else {
    console.error('showCatalogDetail не доступен');
  }
}

// НОВАЯ ФУНКЦИЯ: Показать фильтр по типу контента
function showContentTypeFilter() {
  const filterGroup = document.querySelector('.filter-group:has(#filter-quality)');
  if (!filterGroup) return;

  // Проверяем, есть ли уже фильтр по типу
  let contentTypeFilter = document.getElementById('filter-content-type');
  if (!contentTypeFilter) {
    const newFilter = document.createElement('div');
    newFilter.className = 'filter-group';
    newFilter.innerHTML = `
            <label class="filter-label" for="filter-content-type">Тип контента</label>
            <select id="filter-content-type" class="filter-select">
                <option value="all">Все</option>
                <option value="movie">Фильмы</option>
                <option value="tv">Сериалы</option>
            </select>
        `;

    // Вставляем после фильтра качества
    filterGroup.parentNode.insertBefore(newFilter, filterGroup.nextSibling);

    // Добавляем обработчик
    document.getElementById('filter-content-type').addEventListener('change', (e) => {
      filterGlobalSearchByType(e.target.value);
    });
  }
}

// НОВАЯ ФУНКЦИЯ: Фильтрация глобального поиска по типу
function filterGlobalSearchByType(type) {
  if (!globalSearchResults.length) return;

  let filtered = globalSearchResults;
  if (type !== 'all') {
    filtered = globalSearchResults.filter(item => item.media_type === type);
  }

  // Перерисовываем с фильтрацией
  renderFilteredGlobalResults(filtered);
}

function showGlobalSearchResults() {
  const searchResultsDiv = document.getElementById('search-results');
  const searchOverlay = document.getElementById('search-overlay');

  if (!searchResultsDiv) return;

  // Убеждаемся, что overlay виден
  if (searchOverlay) {
    searchOverlay.classList.remove('hidden');
  }

  if (globalSearchResults.length === 0) {
    searchResultsDiv.innerHTML = `
            <div class="filter-stats">Всего найдено: <span>0</span></div>
            <div class="search-result-empty">
                ${currentSearchQuery ? `Ничего не найдено для "${escapeHtml(currentSearchQuery)}" в TMDB` : 'Введите запрос для поиска'}
            </div>
        `;
    return;
  }

  // Вычисляем оптимальное количество колонок (максимум 8)
  const containerWidth = searchResultsDiv.clientWidth;
  const cardMinWidth = 200;
  let columns = Math.floor(containerWidth / cardMinWidth);
  columns = Math.min(columns, 8); // Ограничиваем максимум 8 колонками
  columns = Math.max(columns, 1); // Минимум 1 колонка

  // Используем CSS Grid с фиксированным количеством колонок
  const gridTemplateColumns = `repeat(${columns}, minmax(${cardMinWidth}px, 1fr))`;

  let html = `<div class="filter-stats">Найдено в TMDB: <span>${globalSearchResults.length}</span></div>`;
  html += `<div class="global-search-grid" style="display: grid; grid-template-columns: ${gridTemplateColumns}; gap: 20px; padding: 20px 0;">`;

  globalSearchResults.forEach((result, index) => {
    const title = result.title || result.name || 'Без названия';
    const year = result.release_date || result.first_air_date;
    const yearStr = year ? new Date(year).getFullYear() : 'N/A';
    const mediaType = result.media_type === 'tv' ? 'Сериал' : 'Фильм';
    const rating = result.vote_average ? result.vote_average.toFixed(1) : null;
    const posterUrl = result.poster_path
      ? `https://nmtmdb.duckdns.org/t/p/w342${result.poster_path}`
      : null;

    html += `
            <div class="global-search-card" data-index="${index}" data-tmdb-id="${result.id}" data-media-type="${result.media_type}" style="
                background: rgba(30, 30, 40, 0.9);
                border-radius: 12px;
                overflow: hidden;
                cursor: pointer;
                transition: transform 0.2s, box-shadow 0.2s;
                border: 1px solid rgba(74, 158, 255, 0.3);
            ">
                <div class="global-search-poster" style="
                    position: relative;
                    aspect-ratio: 2/3;
                    overflow: hidden;
                    background: linear-gradient(135deg, #1a1a2e, #16213e);
                ">
                    ${posterUrl ? `
                        <img src="${posterUrl}" alt="${escapeHtml(title)}" style="
                            width: 100%;
                            height: 100%;
                            object-fit: cover;
                        " onerror="this.parentElement.innerHTML='<div style=\'display: flex; align-items: center; justify-content: center; height: 100%; font-size: 48px;\'>🎬</div>'">
                    ` : `
                        <div style="display: flex; align-items: center; justify-content: center; height: 100%; font-size: 48px;">
                            ${mediaType === 'Сериал' ? '📺' : '🎬'}
                        </div>
                    `}
                    ${rating ? `
                        <div style="
                            position: absolute;
                            top: 8px;
                            right: 8px;
                            background: rgba(0, 0, 0, 0.8);
                            color: ${getRatingColor(parseFloat(rating))};
                            font-weight: bold;
                            font-size: 12px;
                            padding: 4px 8px;
                            border-radius: 12px;
                            border: 1px solid ${getRatingColor(parseFloat(rating))};
                        ">
                            ⭐ ${rating}
                        </div>
                    ` : ''}
                </div>
                <div class="global-search-info" style="padding: 12px;">
                    <div class="global-search-title" style="
                        font-weight: 600;
                        font-size: 14px;
                        margin-bottom: 6px;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    ">${escapeHtml(title)}</div>
                    <div style="
                        display: flex;
                        justify-content: space-between;
                        font-size: 12px;
                        color: #aaa;
                    ">
                        <span>${mediaType}</span>
                        <span>${yearStr}</span>
                    </div>
                </div>
            </div>
        `;
  });

  html += `</div>`;
  searchResultsDiv.innerHTML = html;

  // Добавляем обработчики кликов на карточки
  document.querySelectorAll('.global-search-card').forEach(card => {
    card.addEventListener('click', async () => {
      AppState.isSearch = true;
      const tmdbId = card.dataset.tmdbId;
      const mediaType = card.dataset.mediaType;
      const index = parseInt(card.dataset.index);
      const result = globalSearchResults[index];

      if (result) {
        await showGlobalSearchDetail(result);
      }
    });
  });
}

function renderFilteredGlobalResults(results) {
  const searchResultsDiv = document.getElementById('search-results');
  if (!searchResultsDiv) return;

  if (results.length === 0) {
    searchResultsDiv.innerHTML = `
            <div class="filter-stats">Всего найдено: <span>0</span></div>
            <div class="search-result-empty">
                Нет результатов для выбранного типа контента
            </div>
        `;
    return;
  }

  // Вычисляем оптимальное количество колонок (максимум 8)
  const containerWidth = searchResultsDiv.clientWidth;
  const cardMinWidth = 200;
  let columns = Math.floor(containerWidth / cardMinWidth);
  columns = Math.min(columns, 8); // Ограничиваем максимум 8 колонками
  columns = Math.max(columns, 8); // Минимум 1 колонка

  // Используем CSS Grid с фиксированным количеством колонок
  const gridTemplateColumns = `repeat(${columns}, minmax(${cardMinWidth}px, 1fr))`;

  let html = `<div class="filter-stats">Найдено в TMDB: <span>${results.length}</span></div>`;
  html += `<div class="global-search-grid" style="display: grid; grid-template-columns: ${gridTemplateColumns}; gap: 20px; padding: 20px 0;">`;

  results.forEach((result, idx) => {
    const title = result.title || result.name || 'Без названия';
    const year = result.release_date || result.first_air_date;
    const yearStr = year ? new Date(year).getFullYear() : 'N/A';
    const mediaType = result.media_type === 'tv' ? 'Сериал' : 'Фильм';
    const rating = result.vote_average ? result.vote_average.toFixed(1) : null;
    const posterUrl = result.poster_path
      ? `https://nmtmdb.duckdns.org/t/p/w342${result.poster_path}`
      : null;

    html += `
            <div class="global-search-card" data-tmdb-id="${result.id}" data-media-type="${result.media_type}" style="
                background: rgba(30, 30, 40, 0.9);
                border-radius: 12px;
                overflow: hidden;
                cursor: pointer;
                transition: transform 0.2s, box-shadow 0.2s;
                border: 1px solid rgba(74, 158, 255, 0.3);
            ">
                <div class="global-search-poster" style="
                    position: relative;
                    aspect-ratio: 2/3;
                    overflow: hidden;
                    background: linear-gradient(135deg, #1a1a2e, #16213e);
                ">
                    ${posterUrl ? `
                        <img src="${posterUrl}" alt="${escapeHtml(title)}" style="
                            width: 100%;
                            height: 100%;
                            object-fit: cover;
                        " onerror="this.parentElement.innerHTML='<div style=\'display: flex; align-items: center; justify-content: center; height: 100%; font-size: 48px;\'>🎬</div>'">
                    ` : `
                        <div style="display: flex; align-items: center; justify-content: center; height: 100%; font-size: 48px;">
                            ${mediaType === 'Сериал' ? '📺' : '🎬'}
                        </div>
                    `}
                    ${rating ? `
                        <div style="
                            position: absolute;
                            top: 8px;
                            right: 8px;
                            background: rgba(0, 0, 0, 0.8);
                            color: ${getRatingColor(parseFloat(rating))};
                            font-weight: bold;
                            font-size: 12px;
                            padding: 4px 8px;
                            border-radius: 12px;
                            border: 1px solid ${getRatingColor(parseFloat(rating))};
                        ">
                            ⭐ ${rating}
                        </div>
                    ` : ''}
                </div>
                <div class="global-search-info" style="padding: 12px;">
                    <div class="global-search-title" style="
                        font-weight: 600;
                        font-size: 14px;
                        margin-bottom: 6px;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    ">${escapeHtml(title)}</div>
                    <div style="
                        display: flex;
                        justify-content: space-between;
                        font-size: 12px;
                        color: #aaa;
                    ">
                        <span>${mediaType}</span>
                        <span>${yearStr}</span>
                    </div>
                </div>
            </div>
        `;
  });

  html += `</div>`;
  searchResultsDiv.innerHTML = html;

  // Добавляем обработчики
  document.querySelectorAll('.global-search-card').forEach(card => {
    card.addEventListener('click', async () => {
      const tmdbId = card.dataset.tmdbId;
      const mediaType = card.dataset.mediaType;
      const result = results.find(r => String(r.id) === tmdbId);
      if (result) {
        await showGlobalSearchDetail(result);
      }
    });
  });
}

function clearSearchResultsContainer() {
  const searchResultsDiv = document.getElementById('search-results');
  if (searchResultsDiv) {
    searchResultsDiv.innerHTML = '';
  }
}

// Делаем доступной через window
window.clearSearchResultsContainer = clearSearchResultsContainer;
window.refreshTorrents = refreshTorrents;
window.clearSearchResults = clearSearchResults;
