// Работа с TorrServer и торрентами

// Переменные для поиска
var searchResults = [];
var filteredResults = [];
var currentSearchQuery = '';
var currentSearchMode = 'globalsearch'; // 'torrentsearch' или 'globalsearch'
var globalSearchResults = []; // Результаты глобального поиска

// Настройки фильтрации и сортировки
var currentSort = 'date-desc';
var currentQualityFilter = 'all';
var currentTrackerFilter = 'all';
var currentYearFilter = '';

// Список уникальных трекеров из результатов поиска
var availableTrackers = [];

// Hash последнего добавленного торрента из поиска (в нижнем регистре)
var lastAddedTorrentHash = null;
// Флаг, что последнее воспроизведение было из поиска
var lastPlaybackFromSearch = false;

// Таймеры для long press удаления
var torrentDeleteHoldTimers = new WeakMap();
var TORRENT_DELETE_HOLD_MS = 900;
var suppressTorrentClickUntil = 0;
var pendingRemoteHoldHash = null;


// Кэш для хранения информации о прогрессе
var progressCache = new Map();


var SORT_OPTIONS = [
  { value: 'date-desc', label: 'Сначала новые' },
  { value: 'date-asc', label: 'Сначала старые' },
  { value: 'size-desc', label: 'Размер ↓' },
  { value: 'size-asc', label: 'Размер ↑' },
  { value: 'sid-desc', label: 'Сиды ↓' },
  { value: 'sid-asc', label: 'Сиды ↑' },
  { value: 'pir-desc', label: 'Пиры ↓' },
  { value: 'pir-asc', label: 'Пиры ↑' }
];

var QUALITY_OPTIONS = [
  { value: 'all', label: 'Все качества' },
  { value: '2160', label: '4K (2160p)' },
  { value: '1080', label: 'Full HD (1080p)' },
  { value: '720', label: 'HD (720p)' },
  { value: '480', label: 'SD (480p)' },
  { value: '360', label: '360p' }
];

function getTrackerFilterOptions() {
  var options = [{ value: 'all', label: 'Все трекеры' }];
  for (var i = 0; i < availableTrackers.length; i++) {
    var tracker = availableTrackers[i];
    options.push({
      value: tracker,
      label: tracker.charAt(0).toUpperCase() + tracker.slice(1)
    });
  }
  return options;
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

  var normalizedSelected = String(selectedValue !== null && selectedValue !== undefined ? selectedValue : '');
  var optionsHtml = '';

  for (var i = 0; i < options.length; i++) {
    var option = options[i];
    var selected = String(option.value) === normalizedSelected ? ' selected' : '';
    optionsHtml += '<option value="' + option.value + '"' + selected + '>' + option.label + '</option>';
  }

  select.innerHTML = optionsHtml;

  var hasSelected = false;
  for (var j = 0; j < options.length; j++) {
    if (String(options[j].value) === normalizedSelected) {
      hasSelected = true;
      break;
    }
  }

  if (hasSelected) {
    select.value = normalizedSelected;
  }
}

function syncSearchFilterButtons() {
  fillSelectOptions(document.getElementById('sort-by'), SORT_OPTIONS, currentSort);
  fillSelectOptions(document.getElementById('filter-quality'), QUALITY_OPTIONS, currentQualityFilter);
  fillSelectOptions(document.getElementById('filter-tracker'), getTrackerFilterOptions(), currentTrackerFilter);

  // Синхронизируем фильтр года
  var yearFilter = document.getElementById('filter-year');
  if (yearFilter) {
    if (currentYearFilter && currentYearFilter !== 'all') {
      yearFilter.value = currentYearFilter;
    } else {
      yearFilter.value = 'all';
    }
  }
}

function cycleFilterButton(filterType, direction) {
  if (direction === undefined) direction = 1;
  var options = getFilterOptions(filterType);
  if (!options.length) return;

  var currentValue = getCurrentFilterValue(filterType);
  var currentIndex = 0;
  for (var i = 0; i < options.length; i++) {
    if (options[i].value === currentValue) {
      currentIndex = i;
      break;
    }
  }

  var nextIndex = (currentIndex + direction + options.length) % options.length;

  setCurrentFilterValue(filterType, options[nextIndex].value);
  syncSearchFilterButtons();
  applyFiltersAndSort();
}

function toggleSearchFiltersPanel(forceOpen) {
  var panel = document.getElementById('search-filters-panel');
  var toggleBtn = document.getElementById('filter-toggle');
  if (!panel) return false;

  // Если параметр не передан (undefined) - переключаем, иначе используем forceOpen
  var shouldOpen = (forceOpen === undefined) ? panel.classList.contains('collapsed') : !!forceOpen;

  if (shouldOpen) {
    panel.classList.remove('collapsed');
    if (toggleBtn) toggleBtn.classList.add('active');
  } else {
    panel.classList.add('collapsed');
    if (toggleBtn) toggleBtn.classList.remove('active');
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
      var data = JSON.parse(torrent.data);
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
  var files = getTorrentFiles(torrent);
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

function inferSearchResultIsSeries(searchResult, torrent) {
  if (searchResult && searchResult.types && Array.isArray(searchResult.types)) {
    for (var i = 0; i < searchResult.types.length; i++) {
      if (searchResult.types[i] === 'tv') return true;
    }
  }

  if (torrent) {
    var videoFiles = getVideoFilesFromTorrent(torrent);
    if (videoFiles.length > 1) {
      return true;
    }
  }

  var title = (searchResult && (searchResult.title || searchResult.name || torrent && torrent.title) || '').toLowerCase();
  return (title.indexOf('s') !== -1 && title.indexOf('e') !== -1) ||
    title.indexOf('season') !== -1 ||
    title.indexOf('сезон') !== -1 ||
    title.indexOf('серия') !== -1 ||
    title.indexOf('эпизод') !== -1;
}

function getPreferredPlaybackFile(torrent, searchResult) {
  if (searchResult === undefined) searchResult = null;
  var videoFiles = getVideoFilesFromTorrent(torrent);
  if (videoFiles.length === 0) {
    return { fileId: 1, episodeIndex: null, isSeries: inferSearchResultIsSeries(searchResult, torrent) };
  }

  var isSeries = inferSearchResultIsSeries(searchResult, torrent) || videoFiles.length > 1;
  var targetFile = videoFiles[0] || videoFiles[0];

  return {
    fileId: targetFile && targetFile.id || 1,
    episodeIndex: isSeries ? 0 : null,
    isSeries: isSeries
  };
}

function clearTorrentDeleteHoldTimer(card) {
  var timer = torrentDeleteHoldTimers.get(card);
  if (timer) {
    clearTimeout(timer);
    torrentDeleteHoldTimers.delete(card);
  }
}

window.removeTorrentByHash = removeTorrentByHash;
window.setTorrentClickSuppressed = function (ms) {
  if (ms === undefined) ms = 1200;
  suppressTorrentClickUntil = Date.now() + ms;
};

async function removeTorrentByHash(hash, options) {
  if (options === undefined) options = {};
  if (!hash || !AppState.currentTorrserverUrl) {
    return false;
  }

  var skipConfirm = options.skipConfirm || false;
  var torrent = null;
  for (var i = 0; i < AppState.torrents.length; i++) {
    if ((AppState.torrents[i].hash || '').toLowerCase() === String(hash).toLowerCase()) {
      torrent = AppState.torrents[i];
      break;
    }
  }
  var title = (torrent && torrent.title) || 'эту раздачу';

  if (!skipConfirm && !window.confirm('Удалить ' + title + '?')) {
    return false;
  }

  showLoading('Удаление торрента...');

  try {
    var headers = {
      'Content-Type': 'application/json',
    };

    var authHeaders = getAuthHeaders();
    for (var key in authHeaders) {
      if (authHeaders.hasOwnProperty(key)) {
        headers[key] = authHeaders[key];
      }
    }

    var response = await fetch(AppState.currentTorrserverUrl + '/torrents', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        action: 'rem',
        hash: hash
      })
    });

    if (!response.ok) {
      throw new Error('Ошибка удаления: HTTP ' + response.status);
    }

    try {
      await response.json();
    } catch (e) { }

    if (AppState.currentDetailItem && (AppState.currentDetailItem.hash || '').toLowerCase() === String(hash).toLowerCase()) {
      document.getElementById('detail-view').style.display = 'none';
      AppState.currentDetailItem = null;
      AppState.currentScreen = 'torrents';
      var mainContainer = document.getElementById('main-container');
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

  var startHold = function (event) {
    if (event && event.target && event.target.closest && event.target.closest('button, input, select, textarea, a')) {
      return;
    }

    clearTorrentDeleteHoldTimer(card);
    var timer = setTimeout(async function () {
      suppressTorrentClickUntil = Date.now() + 1200;
      pendingRemoteHoldHash = null;
      card.dataset.suppressClick = '1';
      card.classList.remove('touch-active');
      await removeTorrentByHash(torrent.hash, { skipConfirm: true });
      setTimeout(function () {
        if (card) delete card.dataset.suppressClick;
      }, 1200);
    }, TORRENT_DELETE_HOLD_MS);
    torrentDeleteHoldTimers.set(card, timer);
  };

  var stopHold = function () { clearTorrentDeleteHoldTimer(card); };

  card.addEventListener('touchstart', startHold, { passive: true });
  card.addEventListener('touchend', stopHold);
  card.addEventListener('touchcancel', stopHold);
  card.addEventListener('touchmove', stopHold);
  card.addEventListener('mousedown', startHold);
  card.addEventListener('mouseup', stopHold);
  card.addEventListener('mouseleave', stopHold);
  card.addEventListener('click', function (e) {
    var shouldSuppress = card.dataset.suppressClick === '1' || Date.now() < suppressTorrentClickUntil;
    if (shouldSuppress) {
      e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();
      delete card.dataset.suppressClick;
      return false;
    }
  }, true);
  card.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    suppressTorrentClickUntil = Date.now() + 1200;
    card.dataset.suppressClick = '1';
    removeTorrentByHash(torrent.hash, { skipConfirm: true }).finally(function () {
      setTimeout(function () {
        if (card) delete card.dataset.suppressClick;
      }, 1200);
    });
  });
}

// Загрузка сохраненной конфигурации клиента
async function loadClientConfig() {
  try {
    var response = await fetch(SERVER_URL + '/api/client/config');
    if (response.ok) {
      var data = await response.json();
      AppState.clientId = data.clientId;

      // Заполняем поля формы сохраненными данными
      if (data.config) {
        var urlInput = document.getElementById('torrserver-url');
        var authCheckbox = document.getElementById('auth-checkbox');
        var authLogin = document.getElementById('auth-login');
        var authPassword = document.getElementById('auth-password');

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

        console.log('Загружена конфигурация клиента:', data.clientId);
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
  var url = document.getElementById('torrserver-url').value.trim();
  var authEnabled = document.getElementById('auth-checkbox').checked;
  var login = document.getElementById('auth-login').value.trim();
  var password = document.getElementById('auth-password').value.trim();

  var config = {
    url: url,
    authEnabled: authEnabled,
    login: login
  };

  // Отправляем пароль только если он был изменен
  if (password) {
    config.password = password;
  }

  try {
    var response = await fetch(SERVER_URL + '/api/client/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });

    if (response.ok) {
      var data = await response.json();
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
  var cacheKey = torrent.hash;
  if (progressCache.has(cacheKey)) {
    var cached = progressCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < 60000)) { // Кэш на 1 минуту
      return cached.data;
    }
  }

  try {
    // Парсим данные торрента для получения списка файлов
    var files = [];
    if (torrent.file_stats && Array.isArray(torrent.file_stats)) {
      files = torrent.file_stats;
    } else if (torrent.data) {
      try {
        var data = JSON.parse(torrent.data);
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
        var data = JSON.parse(torrent.data);
        if (data.lampa && data.movie) {
          // Это фильм из LAMPA, используем hash для запроса
          var response = await fetch(SERVER_URL + '/api/timecode/get?hash=' + torrent.hash + '&fileId=1');
          if (response.ok) {
            var timecodeData = await response.json();
            if (timecodeData.success && timecodeData.timecode > 0) {
              var progress = {
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
      var videoFiles = [];
      for (var i = 0; i < files.length; i++) {
        var file = files[i];
        var name = file.path.toLowerCase();
        if (name.indexOf('.mp4') !== -1 || name.indexOf('.mkv') !== -1 || name.indexOf('.avi') !== -1 ||
          name.indexOf('.mov') !== -1 || name.indexOf('.webm') !== -1 || name.indexOf('.m4v') !== -1) {
          videoFiles.push(file);
        }
      }

      if (videoFiles.length === 0) return null;

      // Загружаем таймкоды для всех файлов
      var progressPromises = [];
      for (var j = 0; j < videoFiles.length; j++) {
        var file = videoFiles[j];
        var index = j;
        progressPromises.push((function (file, idx) {
          return async function () {
            try {
              var response = await fetch(SERVER_URL + '/api/timecode/get?hash=' + torrent.hash + '&fileId=' + file.id);
              if (response.ok) {
                var data = await response.json();
                if (data.success && data.timecode > 0) {
                  return {
                    hash: torrent.hash,
                    fileId: file.id,
                    timecode: data.timecode,
                    duration: data.duration,
                    index: idx,
                    fileName: file.path.split('/').pop()
                  };
                }
              }
            } catch (e) {
              console.error('Ошибка загрузки прогресса для файла ' + file.id + ':', e);
            }
            return null;
          };
        })(file, index));
      }

      var results = [];
      for (var k = 0; k < progressPromises.length; k++) {
        var result = await progressPromises[k]();
        results.push(result);
      }

      var validProgress = [];
      for (var m = 0; m < results.length; m++) {
        if (results[m] !== null) validProgress.push(results[m]);
      }

      if (validProgress.length > 0) {
        // Находим последнюю просмотренную серию (по индексу)
        validProgress.sort(function (a, b) { return b.index - a.index; });
        var lastWatched = validProgress[0];

        var progress = {
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
  var cacheKey = torrent.hash;
  if (progressCache.has(cacheKey)) {
    var cached = progressCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < 60000)) { // Кэш на 1 минуту
      renderProgressBadge(card, cached.data);
      return;
    }
  }

  var progress = await loadProgressForTorrent(torrent);

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
  var oldBadge = card.querySelector('.progress-badge');
  if (oldBadge) oldBadge.remove();

  var progressBadge = document.createElement('div');
  progressBadge.className = 'progress-badge';

  var timeStr = formatTime(progress.timecode);
  var totalStr = progress.duration ? formatTime(progress.duration) : '??:??';

  if (progress.isSeries) {
    // Для сериала
    var episodeNum = progress.episodeIndex + 1;
    progressBadge.innerHTML = '\n      <div class="progress-content" data-hash="' + progress.hash + '" data-file-id="' + progress.fileId + '" data-timecode="' + progress.timecode + '" data-episode-index="' + progress.episodeIndex + '">\n        <div class="progress-info">\n          <span class="progress-episode">Серия ' + episodeNum + '</span>\n          <span class="progress-time">' + timeStr + ' / ' + totalStr + '</span>\n        </div>\n        <button class="progress-continue-btn">▶ Продолжить</button>\n      </div>\n    ';
  } else if (progress.isMovie) {
    // Для фильма
    progressBadge.innerHTML = '\n      <div class="progress-content" data-hash="' + progress.hash + '" data-file-id="' + progress.fileId + '" data-timecode="' + progress.timecode + '" data-episode-index="0">\n        <div class="progress-info">\n          <span class="progress-time"> ' + timeStr + ' / ' + totalStr + '</span>\n        </div>\n        <button class="progress-continue-btn">▶ Продолжить</button>\n      </div>\n    ';
  } else {
    // Для обычного файла
    progressBadge.innerHTML = '\n      <div class="progress-content" data-hash="' + progress.hash + '" data-file-id="' + progress.fileId + '" data-timecode="' + progress.timecode + '" data-episode-index="0">\n        <div class="progress-info">\n          <span class="progress-time">' + timeStr + ' / ' + totalStr + '</span>\n        </div>\n        <button class="progress-continue-btn">▶ Продолжить</button>\n      </div>\n    ';
  }

  // Добавляем обработчик для кнопки "Продолжить"
  var continueBtn = progressBadge.querySelector('.progress-continue-btn');
  continueBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    var hash = progress.hash;
    var fileId = progress.fileId;
    var timecode = progress.timecode;
    var episodeIndex = progress.episodeIndex || 0;

    // Формируем URL с таймкодом
    var playUrl = AppState.currentTorrserverUrl + '/play/' + hash + '/' + fileId;

    document.getElementById('playback-overlay').classList.add('active');
    document.getElementById('detail-view').style.pointerEvents = 'none';

    // Передаем episodeIndex в startHLSPlayback
    startHLSPlayback(playUrl, timecode, false, episodeIndex).then(function () {
      document.getElementById('playback-overlay').classList.remove('active');
      document.getElementById('detail-view').style.pointerEvents = 'auto';
    })['catch'](function () {
      document.getElementById('playback-overlay').classList.remove('active');
      document.getElementById('detail-view').style.pointerEvents = 'auto';
    });
  });

  card.appendChild(progressBadge);
}

// НОВАЯ ФУНКЦИЯ: Добавление информации о прогрессе в детальный просмотр
async function addProgressToDetail(torrent) {
  if (!torrent || !torrent.hash) return;

  var progress = await loadProgressForTorrent(torrent);

  // Если нет прогресса, ничего не добавляем
  if (!progress) return;

  var detailHeader = document.querySelector('.detail-header');
  if (!detailHeader) return;

  var progressDiv = document.createElement('div');
  progressDiv.id = 'detail-progress';
  progressDiv.className = 'detail-progress';
  progressDiv.dataset.hash = torrent.hash;

  var timeStr = formatTime(progress.timecode);
  var totalStr = progress.duration ? formatTime(progress.duration) : '??:??';

  if (progress.isSeries) {
    var episodeNum = progress.episodeIndex + 1;
    progressDiv.innerHTML = '\n      <div class="detail-progress-content">\n        <div class="detail-progress-info">\n          <span class="detail-progress-label">Продолжить просмотр:</span>\n          <span class="detail-progress-episode">Серия ' + episodeNum + '</span>\n          <span class="detail-progress-time">' + timeStr + ' / ' + totalStr + '</span>\n        </div>\n        <button class="detail-progress-btn" data-hash="' + progress.hash + '" data-file-id="' + progress.fileId + '" data-timecode="' + progress.timecode + '" data-episode-index="' + progress.episodeIndex + '">\n          ▶ Продолжить с ' + timeStr + '\n        </button>\n      </div>\n    ';
  } else {
    progressDiv.innerHTML = '\n      <div class="detail-progress-content">\n        <div class="detail-progress-info">\n          <span class="detail-progress-label">Продолжить просмотр:</span>\n          <span class="detail-progress-time">' + timeStr + ' / ' + totalStr + '</span>\n        </div>\n        <button class="detail-progress-btn" data-hash="' + progress.hash + '" data-file-id="' + progress.fileId + '" data-timecode="' + progress.timecode + '" data-episode-index="0">\n          ▶ Продолжить с ' + timeStr + '\n        </button>\n      </div>\n    ';
  }

  var progressBtn = progressDiv.querySelector('.detail-progress-btn');
  progressBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    var hash = progress.hash;
    var fileId = progress.fileId;
    var timecode = progress.timecode;
    var episodeIndex = parseInt(progressBtn.dataset.episodeIndex || 0);

    var playUrl = AppState.currentTorrserverUrl + '/play/' + hash + '/' + fileId;

    document.getElementById('playback-overlay').classList.add('active');
    document.getElementById('detail-view').style.pointerEvents = 'none';

    // Передаем episodeIndex в startHLSPlayback через дополнительный параметр
    startHLSPlayback(playUrl, timecode, false, episodeIndex).then(function () {
      document.getElementById('playback-overlay').classList.remove('active');
      document.getElementById('detail-view').style.pointerEvents = 'auto';
    })['catch'](function () {
      document.getElementById('playback-overlay').classList.remove('active');
      document.getElementById('detail-view').style.pointerEvents = 'auto';
    });
  });

  detailHeader.parentNode.insertBefore(progressDiv, detailHeader.nextSibling);
}

// Проверка сервера
async function checkServer(shouldLoadTorrents) {
  if (shouldLoadTorrents === undefined) shouldLoadTorrents = true;
  var urlInput = document.getElementById('torrserver-url');
  var statusIndicator = document.getElementById('status-indicator');
  var statusText = document.getElementById('status-text');
  var authCheckbox = document.getElementById('auth-checkbox');
  var authLogin = document.getElementById('auth-login');
  var authPassword = document.getElementById('auth-password');

  var url = urlInput.value.trim();
  if (!url) {
    statusIndicator.className = 'status-indicator status-offline';
    statusText.textContent = 'Введите адрес сервера';
    return false;
  }

  statusIndicator.className = 'status-indicator status-checking';
  statusText.textContent = 'Проверка...';

  try {
    var testUrl = url.indexOf('/') === url.length - 1 ? url.slice(0, -1) : url;

    // Формируем заголовки с учетом Basic Auth
    var headers = getAuthHeaders();

    // Если включена авторизация, добавляем Basic Auth
    if (authCheckbox && authCheckbox.checked) {
      var login = authLogin ? authLogin.value.trim() : '';
      var password = authPassword ? authPassword.value : '';

      if (login && password) {
        var credentials = btoa(login + ':' + password);
        headers['Authorization'] = 'Basic ' + credentials;
        console.log('🔐 Используется Basic Auth для проверки сервера');
      }
    }

    var response = await fetch(testUrl + '/echo', {
      method: 'GET',
      headers: headers
    });

    if (response.ok) {
      var text = await response.text();
      if (text.indexOf('MatriX.') !== -1) {
        statusIndicator.className = 'status-indicator status-online';
        statusText.textContent = 'Сервер доступен ✓';
        AppState.currentTorrserverUrl = testUrl;
        AppState.serverOnline = true;

        // Сохраняем Basic Auth в AppState при успешной проверке
        if (authCheckbox && authCheckbox.checked) {
          AppState.authEnabled = true;
          AppState.authLogin = authLogin ? authLogin.value.trim() : '';
          AppState.authPassword = authPassword ? authPassword.value : '';
        } else {
          AppState.authEnabled = false;
        }

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
    console.error('Ошибка проверки сервера:', error);
    statusIndicator.className = 'status-indicator status-offline';
    statusText.textContent = 'Сервер недоступен ✗';
    AppState.serverOnline = false;
    return false;
  }
}

// Загрузка списка торрентов
async function loadTorrents(silent) {
  if (silent === undefined) silent = false;
  var torrentsGrid = document.getElementById('torrents-grid');

  if (!AppState.serverOnline) {
    var checked = await checkServer(false);
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
    var headers = {
      'Content-Type': 'application/json',
    };

    var authHeaders = getAuthHeaders();
    for (var key in authHeaders) {
      if (authHeaders.hasOwnProperty(key)) {
        headers[key] = authHeaders[key];
      }
    }

    var response = await fetch(AppState.currentTorrserverUrl + '/torrents', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ action: 'list' })
    });

    if (!response.ok) {
      throw new Error('Ошибка загрузки: HTTP ' + response.status);
    }

    var data = await response.json();
    console.log('Получены данные торрентов:', Array.isArray(data) ? data.length + ' шт.' : data);

    AppState.torrents = Array.isArray(data) ? data : [];

    // Показываем секцию торрентов
    document.getElementById('config-screen').style.display = 'none';
    document.getElementById('torrserver-section').style.display = 'block';
    AppState.currentScreen = 'torrents';

    // Рендерим список
    renderTorrents();

    return true;

  } catch (error) {
    console.error('Ошибка загрузки торрентов:', error);

    if (!silent) {
      if (torrentsGrid) {
        torrentsGrid.innerHTML = '\n          <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">\n            <div style="font-size: 48px; margin-bottom: 20px;"></div>\n            <div style="font-size: 16px; color: #ff6a6a;">Ошибка: ' + error.message + '</div>\n            <button class="btn" style="margin-top: 20px;" onclick="loadTorrents()">Попробовать снова</button>\n          </div>\n        ';
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
async function refreshTorrents(showLoadingFlag) {
  if (showLoadingFlag === undefined) showLoadingFlag = true;
  console.log('Принудительное обновление списка торрентов');

  // Очищаем кэш прогресса
  if (typeof progressCache !== 'undefined') {
    progressCache.clear();
  }

  // Загружаем торренты
  return await loadTorrents(!showLoadingFlag);
}

// Отрисовка карточек торрентов
function renderTorrents() {
  var torrentsGrid = document.getElementById('torrents-grid');
  torrentsGrid.innerHTML = '';

  // Очищаем кэш прогресса при обновлении списка
  progressCache.clear();

  if (AppState.torrents.length === 0) {
    // Показываем сообщение о пустом списке
    torrentsGrid.innerHTML = '\n      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">\n        <div style="font-size: 48px; margin-bottom: 20px;"></div>\n        <div style="font-size: 18px; color: #aaa; margin-bottom: 10px;">Нет торрентов</div>\n        <div style="font-size: 14px; color: #666;">Используйте поиск выше, чтобы найти и добавить торренты</div>\n      </div>\n    ';
    return;
  }

  // Здесь остается существующий код для отрисовки торрентов
  for (var i = 0; i < AppState.torrents.length; i++) {
    (function (torrent) {
      var poster = '';
      var title = torrent.title || 'Без названия';
      var category = torrent.category || '';
      var isTv = false;

      try {
        // Проверяем наличие file_stats (активный торрент)
        if (torrent.file_stats && Array.isArray(torrent.file_stats) && torrent.file_stats.length > 0) {
          isTv = torrent.file_stats.length > 1;
        }
        // Проверяем data поле
        else if (torrent.data) {
          var data = JSON.parse(torrent.data);

          if (data.TorrServer && data.TorrServer.Files && data.TorrServer.Files.length > 0) {
            isTv = data.TorrServer.Files.length > 1;
          }

          if (data.movie) {
            if (data.movie.img) {
              poster = data.movie.img;
            } else if (data.movie.poster_path) {
              poster = 'https://image.tmdb.org/t/p/w342' + data.movie.poster_path;
            }
          }
        }
      } catch (e) {
        console.warn('Ошибка парсинга data для торрента:', e);
      }

      if (!poster && torrent.poster) {
        poster = torrent.poster;
      }

      var displayCategory = isTv ? 'tv' : (category || 'movie');

      var card = document.createElement('div');
      card.className = 'torrent-card';
      card.dataset.hash = torrent.hash;
      card.onclick = function () { showDetail(torrent); };
      attachTorrentDeleteLongPress(card, torrent);

      card.innerHTML = '\n      <div class="torrent-poster">\n        ' + (poster ? '<img src="' + poster + '" loading="lazy" onerror="this.parentElement.innerHTML=\'<div class=\\\'no-poster\\\'>Нет постера</div>\'">' : '<div class="no-poster">Нет постера</div>') + '\n      </div>\n      <div class="torrent-info">\n        <div class="torrent-title">' + escapeHtml(title) + '</div>\n        <div class="torrent-meta">\n          <span>' + formatBytes(torrent.torrent_size) + '</span>\n          <span class="torrent-badge">' + (displayCategory === 'tv' ? 'Сериал' : 'Фильм') + '</span>\n        </div>\n      </div>\n    ';

      torrentsGrid.appendChild(card);

      // Загружаем и добавляем прогресс
      addProgressToCard(card, torrent);
    })(AppState.torrents[i]);
  }

  if (AppState.currentScreen === 'torrents' && !document.querySelector('.torrent-card.focused')) {
    setTimeout(function () {
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
  var hashLower = hash.toLowerCase();

  // Ищем торрент по hash (без учета регистра)
  var torrent = null;
  for (var i = 0; i < AppState.torrents.length; i++) {
    if (AppState.torrents[i].hash && AppState.torrents[i].hash.toLowerCase() === hashLower) {
      torrent = AppState.torrents[i];
      break;
    }
  }

  if (torrent) {
    showDetail(torrent);
    return true;
  }

  return false;
}

function hideCatalogDetailExtra() {
  var extra = document.getElementById('catalog-detail-extra');
  var filesList = document.getElementById('files-list');
  var subtitle = document.getElementById('detail-subtitle');
  var backdrop = document.getElementById('catalog-detail-backdrop');
  var meta = document.getElementById('catalog-detail-meta');
  var overview = document.getElementById('catalog-detail-overview');
  var trailersWrap = document.getElementById('catalog-detail-trailers-wrap');
  var trailers = document.getElementById('catalog-detail-trailers');
  var shotsWrap = document.getElementById('catalog-detail-screenshots-wrap');
  var shots = document.getElementById('catalog-detail-screenshots');
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
    console.log('Сохранен hash перед открытием деталей:', lastSelectedTorrentHash);
  }

  if (typeof currentFocusIndex !== 'undefined') {
    lastSelectedTorrentIndex = currentFocusIndex;
    console.log('Сохранен индекс перед открытием:', currentFocusIndex);
  }

  AppState.currentDetailItem = torrent;
  var detailView = document.getElementById('detail-view');

  // Убеждаемся что detail-view перекрывает все
  detailView.style.display = 'block';
  detailView.style.zIndex = '100';

  // Блокируем взаимодействие с основным контентом
  var mainContainer = document.getElementById('main-container');
  if (mainContainer) {
    mainContainer.style.pointerEvents = 'none';
  }

  AppState.currentScreen = 'detail';
  AppState.detailReturnTo = 'torrents';
  hideCatalogDetailExtra();

  var posterImg = document.getElementById('detail-poster');
  var titleEl = document.getElementById('detail-title-text');
  var filesList = document.getElementById('files-list');

  var poster = '';
  var dataParsed = false;

  try {
    if (torrent.data) {
      var data = JSON.parse(torrent.data);
      if (data.movie && data.movie.img) {
        poster = data.movie.img;
        dataParsed = true;
      } else if (data.movie && data.movie.poster_path) {
        poster = 'https://image.tmdb.org/t/p/w342' + data.movie.poster_path;
        dataParsed = true;
      } else if (data.TorrServer && data.TorrServer.Files) {
        // Данные есть, но не для постера
        dataParsed = true;
      }
    }
  } catch (e) {
    console.log('Ошибка парсинга torrent.data:', e);
  }

  // Если не удалось получить данные из torrent.data, делаем запрос к API
  if (!dataParsed && torrent.hash && AppState.currentTorrserverUrl) {
    try {
      console.log('Пытаемся получить данные через API для hash:', torrent.hash);

      var requestBody = {
        action: 'get',
        hash: torrent.hash
      };

      var headers = {
        'Content-Type': 'application/json',
      };

      var authHeaders = getAuthHeaders();
      for (var key in authHeaders) {
        if (authHeaders.hasOwnProperty(key)) {
          headers[key] = authHeaders[key];
        }
      }

      var response = await fetch(AppState.currentTorrserverUrl + '/torrents', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody)
      });

      if (response.ok) {
        var apiData = await response.json();

        // Обновляем torrent данными из API
        if (apiData.data) {
          torrent.data = apiData.data;

          // Пробуем снова распарсить
          try {
            var parsedData = JSON.parse(apiData.data);
            if (parsedData.movie && parsedData.movie.img) {
              poster = parsedData.movie.img;
            } else if (parsedData.movie && parsedData.movie.poster_path) {
              poster = 'https://image.tmdb.org/t/p/w342' + parsedData.movie.poster_path;
            }

            // Обновляем file_stats если есть
            if (apiData.file_stats && Array.isArray(apiData.file_stats)) {
              torrent.file_stats = apiData.file_stats;
            }
          } catch (e) {
            console.log('Ошибка парсинга API data:', e);
          }
        }

        // Обновляем постер если есть в ответе
        if (apiData.poster && !poster) {
          poster = apiData.poster;
        }

        // Обновляем title если есть
        if (apiData.title && (!torrent.title || torrent.title === 'Без названия')) {
          torrent.title = apiData.title;
        }
      }
    } catch (apiError) {
      console.error('Ошибка при запросе к API:', apiError);
    }
  }

  if (!poster && torrent.poster) {
    poster = torrent.poster;
  }

  posterImg.innerHTML = poster ? '<img src="' + poster + '" alt="poster">' : '<div class="no-poster">Нет постера</div>';
  titleEl.textContent = torrent.title || 'Без названия';

  // Удаляем старый прогресс если есть
  var oldProgress = document.getElementById('detail-progress');
  if (oldProgress) oldProgress.remove();

  // Добавляем прогресс для текущего торрента
  await addProgressToDetail(torrent);

  filesList.innerHTML = '<div style="text-align: center; padding: 20px;">Загрузка...</div>';

  try {
    var files = [];

    // Проверяем наличие file_stats (активный торрент)
    if (torrent.file_stats && Array.isArray(torrent.file_stats) && torrent.file_stats.length > 0) {
      files = torrent.file_stats;
    }
    // Проверяем data поле
    else if (torrent.data) {
      var data = JSON.parse(torrent.data);

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
      for (var i = 0; i < files.length; i++) {
        addFileItem(files[i], torrent.hash);
      }
    }

  } catch (e) {
    console.error('Ошибка парсинга данных:', e);
    filesList.innerHTML = '<div style="text-align: center; padding: 20px; color: #ff6a6a;">Ошибка загрузки файлов</div>';
  }

  // Устанавливаем фокус на первый элемент в детальном просмотре
  setTimeout(function () {
    if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
      updateFocusableElements();

      // 1. Ищем все элементы файлов
      var fileItems = document.querySelectorAll('.file-item');

      var targetIndex = -1;

      // 2. Если есть файлы, ставим фокус на первый файл
      if (fileItems.length > 0) {
        for (var i = 0; i < focusableElements.length; i++) {
          if (focusableElements[i].classList && focusableElements[i].classList.contains('file-item')) {
            targetIndex = i;
            break;
          }
        }

        if (targetIndex !== -1) {
          setFocus(targetIndex);
          console.log('Фокус в детальном просмотре на первый файл');
          return;
        }
      }

      // 3. Если файлов нет, пробуем найти кнопку "Продолжить"
      var progressBtn = document.querySelector('.detail-progress-btn');
      if (progressBtn) {
        for (var i = 0; i < focusableElements.length; i++) {
          if (focusableElements[i].classList && focusableElements[i].classList.contains('detail-progress-btn')) {
            targetIndex = i;
            break;
          }
        }

        if (targetIndex !== -1) {
          setFocus(targetIndex);
          console.log('Фокус в детальном просмотре на кнопке "Продолжить"');
          return;
        }
      }

      // 4. Фолбэк на кнопку "Назад"
      var backBtn = document.querySelector('.back-btn');
      if (backBtn) {
        for (var i = 0; i < focusableElements.length; i++) {
          if (focusableElements[i].classList && focusableElements[i].classList.contains('back-btn')) {
            targetIndex = i;
            break;
          }
        }
        if (targetIndex !== -1) {
          setFocus(targetIndex);
          console.log('Фокус в детальном просмотре на кнопке "Назад"');
          return;
        }
      }

      setFocus(0);
      console.log('Фокус в детальном просмотре на первый элемент');
    }
  }, 300);
}

// Добавить элемент файла (для сериалов)
function addFileItem(file, hash) {
  // Проверяем расширение файла
  var fileName = file.path.split('/').pop() || ('Файл ' + file.id);
  var fileExt = fileName.split('.').pop().toLowerCase();
  var allowedExtensions = ['mkv', 'mp4', 'avi', 'mov', 'webm', 'm4v'];

  // Если расширение не в списке разрешенных - не добавляем
  if (!allowedExtensions.includes(fileExt)) {
    console.log(`⏭️ Пропускаем файл (не видео): ${fileName}`);
    return;
  }

  var fileSize = formatBytes(file.length);

  var item = document.createElement('div');
  item.className = 'file-item';
  item.innerHTML = '\n    <div class="file-name">\n      <div>' + escapeHtml(fileName) + '</div>\n      <div style="font-size: 12px; color: #888; margin-top: 4px;">' + fileSize + '</div>\n    </div>\n    <button class="play-btn" data-hash="' + hash + '" data-file-id="' + file.id + '">▶ Воспроизвести</button>\n  ';

  item.querySelector('.play-btn').onclick = function (e) {
    e.stopPropagation();
    var btn = e.currentTarget;

    var playUrl = file.id ?
      AppState.currentTorrserverUrl + '/play/' + hash + '/' + file.id :
      AppState.currentTorrserverUrl + '/play/' + hash + '/1';

    document.getElementById('playback-overlay').classList.add('active');
    document.getElementById('detail-view').style.pointerEvents = 'none';

    // Явно передаем timecode = 0 для воспроизведения с начала
    startHLSPlayback(playUrl, 0, false).then(function () {
      document.getElementById('playback-overlay').classList.remove('active');
      document.getElementById('detail-view').style.pointerEvents = 'auto';
    })['catch'](function () {
      document.getElementById('playback-overlay').classList.remove('active');
      document.getElementById('detail-view').style.pointerEvents = 'auto';
    });
  };

  document.getElementById('files-list').appendChild(item);
}

// Добавить элемент фильма
function addMovieItem(torrent) {
  var filesList = document.getElementById('files-list');
  filesList.innerHTML = '';

  var item = document.createElement('div');
  item.className = 'file-item';
  item.innerHTML = '\n    <div class="file-name">\n      <div>' + escapeHtml(torrent.title || 'Фильм') + '</div>\n      <div style="font-size: 12px; color: #888; margin-top: 4px;">' + formatBytes(torrent.torrent_size) + '</div>\n    </div>\n    <button class="play-btn" data-hash="' + torrent.hash + '">▶ Воспроизвести</button>\n  ';

  item.querySelector('.play-btn').onclick = function (e) {
    e.stopPropagation();
    var btn = e.currentTarget;

    var playUrl = AppState.currentTorrserverUrl + '/play/' + torrent.hash + '/1';

    document.getElementById('playback-overlay').classList.add('active');
    document.getElementById('detail-view').style.pointerEvents = 'none';

    // Явно передаем timecode = 0 для воспроизведения с начала
    startHLSPlayback(playUrl, 0, false).then(function () {
      document.getElementById('playback-overlay').classList.remove('active');
      document.getElementById('detail-view').style.pointerEvents = 'auto';
    })['catch'](function () {
      document.getElementById('playback-overlay').classList.remove('active');
      document.getElementById('detail-view').style.pointerEvents = 'auto';
    });
  };

  filesList.appendChild(item);
}

function normalizeSearchResult(item) {
  var normalized = {};
  for (var key in item) {
    if (item.hasOwnProperty(key)) {
      normalized[key] = item[key];
    }
  }

  var releasedRaw = normalized.released || normalized.relased || normalized.year || null;
  var releasedYear = parseInt(releasedRaw, 10);

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
  var searchMode = getCurrentSearchMode();

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

  var encodedQuery = encodeURIComponent(query.trim());
  var searchUrl = 'https://jac.red/api/v1.0/torrents?search=' + encodedQuery + '&apikey=null&exact=true';

  showLoading('Поиск...');

  try {
    var response = await fetch(searchUrl);
    if (!response.ok) throw new Error('Ошибка поиска');

    var data = await response.json();
    searchResults = (Array.isArray(data) ? data : []);
    for (var i = 0; i < searchResults.length; i++) {
      searchResults[i] = normalizeSearchResult(searchResults[i]);
    }
    currentSearchQuery = query;

    var searchInput = document.getElementById('search-query');
    if (searchInput) {
      searchInput.value = '';
    }

    updateAvailableTrackers();
    updateAvailableYears(); // Добавляем обновление доступных годов
    applyFiltersAndSort();
    showSearchResults();

  } catch (error) {
    console.error('Ошибка поиска:', error);
    alert('Ошибка при поиске: ' + error.message);
  } finally {
    hideLoading();
  }
}

// Новая функция: Обновление списка доступных годов
function updateAvailableYears() {
  var yearSet = {};
  var yearFilter = document.getElementById('filter-year');

  // Собираем все уникальные года из результатов поиска
  for (var i = 0; i < searchResults.length; i++) {
    var result = searchResults[i];
    if (result.released && !isNaN(result.released)) {
      yearSet[result.released] = true;
    }
  }

  // Получаем года и сортируем по убыванию (сначала новые)
  var availableYears = Object.keys(yearSet).map(Number).sort(function (a, b) {
    return b - a;
  });

  // Обновляем select с годами
  if (yearFilter) {
    // Сохраняем текущее значение
    var currentYear = yearFilter.value;

    // Очищаем и заполняем заново
    yearFilter.innerHTML = '<option value="all">Все года</option>';

    for (var j = 0; j < availableYears.length; j++) {
      var year = availableYears[j];
      var selected = (currentYear !== 'all' && String(year) === currentYear) ? 'selected' : '';
      yearFilter.innerHTML += '<option value="' + year + '" ' + selected + '>' + year + '</option>';
    }

    // Если текущий год не найден в новом списке, сбрасываем на "Все года"
    if (currentYear !== 'all' && !yearSet[currentYear]) {
      yearFilter.value = 'all';
      currentYearFilter = '';
    }
  }
}

// Добавляем обработчик изменения режима поиска
function initSearchModeToggle() {
  var modeSelect = document.getElementById('search-mode');
  if (modeSelect) {
    modeSelect.addEventListener('change', function (e) {
      currentSearchMode = e.target.value;

      // Адаптируем интерфейс под выбранный режим
      var trackerFilter = document.getElementById('filter-tracker');
      var qualityFilter = document.getElementById('filter-quality');
      var contentTypeFilter = document.getElementById('filter-content-type');

      if (currentSearchMode === 'globalsearch') {
        // Для глобального поиска отключаем ненужные фильтры
        if (trackerFilter) trackerFilter.disabled = true;
        if (qualityFilter) qualityFilter.disabled = true;
        if (!contentTypeFilter) showContentTypeFilter();
      } else {
        // Для поиска по торрентам включаем обратно
        if (trackerFilter) trackerFilter.disabled = false;
        if (qualityFilter) qualityFilter.disabled = false;
        if (contentTypeFilter && contentTypeFilter.remove) contentTypeFilter.remove();
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
  var trackerSet = {};

  for (var i = 0; i < searchResults.length; i++) {
    var result = searchResults[i];
    if (result.tracker) {
      trackerSet[result.tracker] = true;
    }
  }

  availableTrackers = [];
  for (var key in trackerSet) {
    if (trackerSet.hasOwnProperty(key)) {
      availableTrackers.push(key);
    }
  }
  availableTrackers.sort();

  var trackerFilterAll = false;
  for (var j = 0; j < availableTrackers.length; j++) {
    if (availableTrackers[j] === currentTrackerFilter) {
      trackerFilterAll = true;
      break;
    }
  }
  if (!trackerFilterAll) {
    currentTrackerFilter = 'all';
  }
  syncSearchFilterButtons();
}

// Применение фильтров и сортировки
function applyFiltersAndSort() {
  filteredResults = [];

  for (var i = 0; i < searchResults.length; i++) {
    var item = searchResults[i];
    var shouldInclude = true;

    // Фильтр по качеству
    if (currentQualityFilter !== 'all') {
      var quality = parseInt(currentQualityFilter, 10);
      if ((item.quality || 0) !== quality) shouldInclude = false;
    }

    // Фильтр по трекеру
    if (shouldInclude && currentTrackerFilter !== 'all') {
      var tracker = (item.tracker || '').toLowerCase();
      if (tracker !== currentTrackerFilter) shouldInclude = false;
    }

    // Фильтр по году
    if (shouldInclude && currentYearFilter && currentYearFilter !== 'all') {
      var year = parseInt(currentYearFilter, 10);
      if (!Number.isFinite(year) || item.released !== year) shouldInclude = false;
    }

    if (shouldInclude) {
      filteredResults.push(item);
    }
  }

  filteredResults.sort(function (a, b) {
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
function showSearchResults(options) {
  if (options === undefined) options = {};
  var searchOverlay = document.getElementById('search-overlay');
  var searchTab = document.getElementById('tab-search');
  var torrentsTab = document.getElementById('tab-torrents');
  var catalogTab = document.getElementById('tab-catalog');
  var searchInput = document.getElementById('search-query');

  if (!searchOverlay || !searchTab || !torrentsTab) return;

  if (searchInput && document.activeElement === searchInput) {
    searchInput.blur();
  }

  searchOverlay.classList.remove('hidden');
  searchTab.classList.add('active');
  torrentsTab.classList.remove('active');
  if (catalogTab) catalogTab.classList.remove('active');
  AppState.currentScreen = 'search';

  syncSearchFilterButtons();
  toggleSearchFiltersPanel(false);

  if (options.runSearch && searchInput && searchInput.value.trim()) {
    setTimeout(function () { searchTorrents(searchInput.value.trim()); }, 0);
  }

  setTimeout(function () {
    if (typeof window.focusSearchHome === 'function') {
      window.focusSearchHome(options.focusQuery !== false);
      return;
    }

    if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
      updateFocusableElements();

      var searchInputIndex = -1;
      var searchBtnIndex = -1;
      var filterToggleIndex = -1;
      var firstFilterIndex = -1;

      for (var i = 0; i < focusableElements.length; i++) {
        var el = focusableElements[i];
        if (el.id === 'search-query') searchInputIndex = i;
        if (el.id === 'search-btn') searchBtnIndex = i;
        if (el.id === 'filter-toggle') filterToggleIndex = i;
        if (['sort-by', 'filter-quality', 'filter-tracker', 'filter-year', 'reset-filters', 'close-search'].indexOf(el.id) !== -1 && firstFilterIndex === -1) {
          firstFilterIndex = i;
        }
      }

      var targetIndex = options.focusQuery !== false
        ? (searchInputIndex !== -1 ? searchInputIndex : (searchBtnIndex !== -1 ? searchBtnIndex : filterToggleIndex))
        : (firstFilterIndex !== -1 ? firstFilterIndex : (filterToggleIndex !== -1 ? filterToggleIndex : 0));

      setFocus(targetIndex !== -1 ? targetIndex : 0);
    }
  }, 80);
}

// Скрытие результатов поиска
function hideSearchResults() {
  var searchOverlay = document.getElementById('search-overlay');
  var searchTab = document.getElementById('tab-search');
  var torrentsTab = document.getElementById('tab-torrents');
  var catalogTab = document.getElementById('tab-catalog');
  var searchInput = document.getElementById('search-query');
  var modeSelect = document.getElementById('torrent-movie');
  if (modeSelect) modeSelect.value = 'globalsearch';

  if (!searchOverlay || !searchTab || !torrentsTab) return;

  // Определяем куда возвращаться
  var returnTo = AppState.searchReturnTo || 'torrents';

  searchOverlay.classList.add('hidden');
  searchTab.classList.remove('active');
  toggleSearchFiltersPanel(false);

  // Обработка возврата в зависимости от режима
  if (returnTo === 'detail') {
    // Возврат в детальный просмотр
    AppState.currentScreen = 'detail';

    // Скрываем вкладки каталога/торрентов
    if (catalogTab) catalogTab.classList.remove('active');
    torrentsTab.classList.remove('active');

    // Показываем детальный просмотр, если он скрыт
    var detailView = document.getElementById('detail-view');
    if (detailView && detailView.style.display !== 'block') {
      detailView.style.display = 'block';
    }

    // Восстанавливаем детальный просмотр
    if (AppState.pendingDetailItem) {
      console.log('Возврат к детальному просмотру:',
        AppState.pendingDetailItem.torrent && AppState.pendingDetailItem.torrent[0] && AppState.pendingDetailItem.torrent[0].name || 'Фильм');

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
    setTimeout(function () {
      if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
        updateFocusableElements();
        var watchBtn = document.getElementById('catalog-watch-btn');
        if (watchBtn) {
          var watchIndex = -1;
          for (var i = 0; i < focusableElements.length; i++) {
            if (focusableElements[i].id === 'catalog-watch-btn') {
              watchIndex = i;
              break;
            }
          }
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
    if (catalogTab) catalogTab.classList.add('active');
    torrentsTab.classList.remove('active');
    AppState.currentScreen = 'catalog';

    setTimeout(function () {
      if (typeof window.focusCatalogCardByIndex === 'function') {
        var savedIndex = localStorage.getItem('lastCatalogCardIndex');
        var targetIndex = savedIndex !== null ?
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
    if (catalogTab) catalogTab.classList.remove('active');
    AppState.currentScreen = 'torrents';

    setTimeout(function () {
      if (typeof window.focusFirstTorrentCard === 'function' && window.focusFirstTorrentCard()) {
        return;
      }

      if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
        updateFocusableElements();
        var firstCardIndex = -1;
        for (var i = 0; i < focusableElements.length; i++) {
          if (focusableElements[i].classList && focusableElements[i].classList.contains('torrent-card')) {
            firstCardIndex = i;
            break;
          }
        }
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
  var filterYear = document.getElementById('filter-year');
  if (filterYear) {
    filterYear.value = 'all';
  }

  applyFiltersAndSort();
}

function initYearFilter() {
  var yearFilter = document.getElementById('filter-year');
  if (yearFilter) {
    yearFilter.addEventListener('change', function(e) {
      var value = e.target.value;
      if (value === 'all') {
        currentYearFilter = '';
      } else {
        currentYearFilter = value;
      }
      applyFiltersAndSort();
    });
  }
}

// Добавление торрента в TorrServer
async function addTorrentToServer(magnet, hash, searchResult) {
  if (searchResult === undefined) searchResult = null;
  if (!AppState.currentTorrserverUrl) {
    alert('Сначала подключитесь к TorrServer');
    return null;
  }

  // Используем постер из каталога, если он есть
  var poster = null;

  // Сначала проверяем, есть ли сохраненный постер из каталога
  if (window.pendingCatalogPoster) {
    poster = window.pendingCatalogPoster;
    console.log('Используем постер из каталога:', poster);
  }
  // Если нет, ищем через TMDB
  else if (searchResult) {
    console.log('Поиск постера через TMDB для:', searchResult.title || searchResult.name);
    poster = await tmdb.findPosterFromSearchResult(searchResult);
    if (poster) {
      console.log('Постер найден через TMDB:', poster);
    }
  }

  try {
    console.log('Добавление торрента в TorrServer:', magnet);

    var requestBody = {
      action: 'add',
      link: magnet,
      title: searchResult.name,
      save_to_db: AppState.addToDbEnabled
    };

    // Добавляем постер, если нашли
    if (poster) {
      requestBody.poster = poster;
      console.log('Добавляем постер в запрос');
    }

    var headers = {
      'Content-Type': 'application/json',
    };

    var authHeaders = getAuthHeaders();
    for (var key in authHeaders) {
      if (authHeaders.hasOwnProperty(key)) {
        headers[key] = authHeaders[key];
      }
    }

    var response = await fetch(AppState.currentTorrserverUrl + '/torrents', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error('Ошибка добавления: ' + response.status);
    }

    var data = await response.json();
    console.log('Торрент добавлен:', data);

    // Очищаем временные данные
    window.pendingCatalogPoster = null;
    window.pendingCatalogItem = null;

    // Сохраняем hash добавленного торрента в нижнем регистре
    lastAddedTorrentHash = hash.toLowerCase();

    // Ждем немного для обновления списка
    await new Promise(function (resolve) { setTimeout(resolve, 1000); });

    // Обновляем список торрентов
    await refreshTorrentsList();

    // Ищем добавленный торрент по hash (в нижнем регистре)
    var addedTorrent = null;
    for (var i = 0; i < AppState.torrents.length; i++) {
      if (AppState.torrents[i].hash && AppState.torrents[i].hash.toLowerCase() === lastAddedTorrentHash) {
        addedTorrent = AppState.torrents[i];
        break;
      }
    }

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
  var focusedCard = document.querySelector('.torrent-card.focused');
  var preserveHash = (focusedCard && focusedCard.dataset.hash) || window.lastSelectedTorrentHash || null;
  var preserveIndex = typeof window.lastSelectedTorrentIndex === 'number' ? window.lastSelectedTorrentIndex : 0;

  try {
    var headers = {
      'Content-Type': 'application/json',
    };

    var authHeaders = getAuthHeaders();
    for (var key in authHeaders) {
      if (authHeaders.hasOwnProperty(key)) {
        headers[key] = authHeaders[key];
      }
    }

    var response = await fetch(AppState.currentTorrserverUrl + '/torrents', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ action: 'list' })
    });

    if (response.ok) {
      var data = await response.json();
      AppState.torrents = Array.isArray(data) ? data : [];
      renderTorrents();

      if (AppState.currentScreen === 'torrents') {
        setTimeout(function () {
          if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
            updateFocusableElements();
            var targetIndex = -1;
            for (var i = 0; i < focusableElements.length; i++) {
              if (focusableElements[i].classList && focusableElements[i].classList.contains('torrent-card') && preserveHash && focusableElements[i].dataset.hash === preserveHash) {
                targetIndex = i;
                break;
              }
            }
            if (targetIndex === -1) {
              var cards = [];
              for (var j = 0; j < focusableElements.length; j++) {
                if (focusableElements[j].classList && focusableElements[j].classList.contains('torrent-card')) {
                  cards.push(focusableElements[j]);
                }
              }
              if (cards[preserveIndex]) {
                for (var k = 0; k < focusableElements.length; k++) {
                  if (focusableElements[k] === cards[preserveIndex]) {
                    targetIndex = k;
                    break;
                  }
                }
              }
            }
            if (targetIndex === -1) {
              for (var l = 0; l < focusableElements.length; l++) {
                if (focusableElements[l].classList && focusableElements[l].classList.contains('torrent-card')) {
                  targetIndex = l;
                  break;
                }
              }
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
async function playFromHash(hash, magnet, searchResult) {
  if (searchResult === undefined) searchResult = null;
  console.log('playFromHash вызван:');
  console.log('Hash:', hash);
  console.log('SearchResult:', searchResult ? searchResult.title || searchResult.name : 'null');

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
    // Проверяем, является ли контент сериалом
    const isSerial = searchResult && searchResult.types &&
      Array.isArray(searchResult.types) &&
      searchResult.types.includes('serial');
    var addedTorrent = await addTorrentToServer(magnet, hash, searchResult);

    hideSearchResults();

    if (!addedTorrent) {
      await refreshTorrentsList();
      addedTorrent = null;
      for (var i = 0; i < AppState.torrents.length; i++) {
        if ((AppState.torrents[i].hash || '').toLowerCase() === hash.toLowerCase()) {
          addedTorrent = AppState.torrents[i];
          break;
        }
      }
    }

    if (addedTorrent) {
      AppState.currentDetailItem = addedTorrent;
    }

    if (!isSerial) {
      var playbackTarget = getPreferredPlaybackFile(addedTorrent, searchResult);
      var fileId = playbackTarget.fileId || 1;

      document.querySelector('.playback-text').textContent = playbackTarget.isSeries
        ? 'Воспроизведение серии...'
        : 'Воспроизведение...';

      var playUrl = AppState.currentTorrserverUrl + '/play/' + hash + '/' + fileId;
      console.log('URL воспроизведения:', playUrl, 'isSeries:', playbackTarget.isSeries, 'episodeIndex:', playbackTarget.episodeIndex);

      await startHLSPlayback(playUrl, null, true, playbackTarget.episodeIndex);
    } else {
      await new Promise(resolve => setTimeout(resolve, 3000));
      showDetail(addedTorrent);
    }

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
  var searchResultsDiv = document.getElementById('search-results');

  if (!searchResultsDiv) return;

  if (filteredResults.length === 0) {
    var totalResults = searchResults.length;
    searchResultsDiv.innerHTML = '\n      <div class="filter-stats">Всего найдено: <span>' + totalResults + '</span></div>\n      <div class="search-result-empty">\n        ' + (currentSearchQuery ? 'Нет результатов по фильтрам для "' + escapeHtml(currentSearchQuery) + '"' : 'Введите запрос для поиска') + '\n      </div>\n    ';
    return;
  }

  var html = '<div class="filter-stats">Показано: <span>' + filteredResults.length + '</span> из <span>' + searchResults.length + '</span></div>';

  for (var idx = 0; idx < filteredResults.length; idx++) {
    var result = filteredResults[idx];
    var voices = Array.isArray(result.voices) ? result.voices : [];
    var quality = result.quality || 'N/A';
    var size = result.sizeName || formatBytes(result.size);
    var year = result.released || 'N/A';
    var type = (result.types && result.types.indexOf('tv') !== -1) ? 'Сериал' : 'Фильм';
    var date = result.createTime ? new Date(result.createTime).toLocaleDateString() : 'N/A';

    var sid = result.sid !== undefined ? result.sid : 0;
    var pir = result.pir !== undefined ? result.pir : 0;
    var hash = extractHashFromMagnet(result.magnet);
    var tracker = result.tracker || 'Unknown';
    var trackerDisplay = tracker.charAt(0).toUpperCase() + tracker.slice(1);

    // ПРАВИЛЬНО: кодируем JSON для data-атрибута
    var resultJsonEncoded = encodeURIComponent(JSON.stringify(result));

    html += '\n      <div class="search-result-item" data-index="' + idx + '">\n        <div class="search-result-info">\n          <div class="search-result-title">' + escapeHtml(result.title || result.name || 'Без названия') + '</div>\n          \n          <div class="search-result-meta">\n            <div class="search-result-meta-item">\n              <span></span> ' + escapeHtml(trackerDisplay) + '\n            </div>\n            <div class="search-result-meta-item">\n              <span></span> ' + escapeHtml(size) + '\n            </div>\n            <div class="search-result-meta-item">\n              <span></span> ' + year + ' (' + date + ')\n            </div>\n            <div class="search-result-meta-item">\n              <span></span> ' + type + ' / ' + quality + 'p\n            </div>\n            <div class="search-result-meta-item">\n              <span></span> сиды: ' + sid + '\n            </div>\n            <div class="search-result-meta-item">\n              <span></span> пиры: ' + pir + '\n            </div>\n          </div>\n          \n          ' + (voices.length > 0 ? '\n            <div class="search-result-voices">\n              ' + (function () {
      var voicesHtml = '';
      for (var v = 0; v < voices.length; v++) {
        voicesHtml += '<span class="search-result-voice">' + escapeHtml(voices[v]) + '</span>';
      }
      return voicesHtml;
    })() + '\n            </div>\n          ' : '') + '\n        </div>\n        \n        <button class="search-result-play" \n                data-hash="' + hash + '" \n                data-magnet="' + escapeHtml(result.magnet) + '"\n                data-result="' + resultJsonEncoded + '"\n                ' + (!hash ? 'disabled' : '') + '>\n          ' + (hash ? '▶ PLAY' : '❌ Нет hash') + '\n        </button>\n      </div>\n    ';
  }

  searchResultsDiv.innerHTML = html;

  // Добавляем обработчики для кнопок PLAY
  var resultItems = searchResultsDiv.querySelectorAll('.search-result-item');
  for (var i = 0; i < resultItems.length; i++) {
    (function (item) {
      item.addEventListener('click', function () {
        var playBtn = item.querySelector('.search-result-play');
        if (playBtn) playBtn.click();
      });
    })(resultItems[i]);
  }

  var playButtons = searchResultsDiv.querySelectorAll('.search-result-play');
  for (var j = 0; j < playButtons.length; j++) {
    (function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var hash = btn.dataset.hash;
        var magnet = btn.dataset.magnet;
        var resultJsonEncoded = btn.dataset.result;

        console.log('Нажата кнопка PLAY');
        console.log('Hash:', hash);
        console.log('Magnet:', magnet);
        console.log('Есть постер из каталога:', !!window.pendingCatalogPoster);

        if (hash) {
          var searchResult = null;
          if (resultJsonEncoded) {
            try {
              // Декодируем и парсим JSON
              var resultJson = decodeURIComponent(resultJsonEncoded);
              searchResult = JSON.parse(resultJson);
              console.log('   Найден сохраненный результат:', searchResult.title || searchResult.name);

              if (window.pendingCatalogPoster) {
                searchResult.poster = window.pendingCatalogPoster;
                console.log('   Добавлен постер из каталога в searchResult');
              }
            } catch (e) {
              console.error('Ошибка парсинга resultJson:', e);
              console.error('Данные:', resultJsonEncoded);
            }
          }

          playFromHash(hash, magnet, searchResult);
        } else {
          alert('Не удалось извлечь hash из magnet ссылки');
        }
      });
    })(playButtons[j]);
  }
}

// Получение класса для трекера
function getTrackerClass(tracker) {
  if (!tracker) return 'tracker-other';

  var t = tracker.toLowerCase();
  if (t.indexOf('kinozal') !== -1) return 'tracker-kinozal';
  if (t.indexOf('rutor') !== -1) return 'tracker-rutor';
  if (t.indexOf('rutracker') !== -1) return 'tracker-rutracker';
  return 'tracker-other';
}

// Извлечение hash из magnet ссылки (в нижнем регистре)
function extractHashFromMagnet(magnet) {
  if (!magnet) return null;

  // Ищем xt=urn:btih:ХЕШ
  var match = magnet.match(/xt=urn:btih:([a-fA-F0-9]{40})/i);
  if (match && match[1]) {
    return match[1].toLowerCase(); // Возвращаем в нижнем регистре
  }

  // Альтернативный формат
  var altMatch = magnet.match(/[a-fA-F0-9]{40}/);
  if (altMatch) {
    return altMatch[0].toLowerCase(); // Возвращаем в нижнем регистре
  }

  return null;
}

// Функция для получения текущего режима поиска
function getCurrentSearchMode() {
  var modeSelect = document.getElementById('torrent-movie');
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
    var encodedQuery = encodeURIComponent(query.trim());

    // Параллельный поиск фильмов и сериалов для лучших результатов
    var moviesResponse = await fetch('/api/tmdb/search?query=' + encodedQuery + '&type=movie&year=');
    var tvResponse = await fetch('/api/tmdb/search?query=' + encodedQuery + '&type=tv&year=');

    var allResults = [];

    // Обрабатываем фильмы
    if (moviesResponse && moviesResponse.ok) {
      var moviesData = await moviesResponse.json();
      if (moviesData.results) {
        for (var i = 0; i < moviesData.results.length; i++) {
          var item = moviesData.results[i];
          allResults.push({
            id: item.id,
            media_type: 'movie',
            title: item.title,
            name: item.title,
            release_date: item.release_date,
            vote_average: item.vote_average,
            vote_count: item.vote_count,
            overview: item.overview,
            poster_path: item.poster_path,
            backdrop_path: item.backdrop_path,
            searchQuery: query
          });
        }
      }
    }

    // Обрабатываем сериалы
    if (tvResponse && tvResponse.ok) {
      var tvData = await tvResponse.json();
      if (tvData.results) {
        for (var j = 0; j < tvData.results.length; j++) {
          var tvItem = tvData.results[j];
          allResults.push({
            id: tvItem.id,
            media_type: 'tv',
            title: tvItem.name,
            name: tvItem.name,
            first_air_date: tvItem.first_air_date,
            vote_average: tvItem.vote_average,
            vote_count: tvItem.vote_count,
            overview: tvItem.overview,
            poster_path: tvItem.poster_path,
            backdrop_path: tvItem.backdrop_path,
            searchQuery: query
          });
        }
      }
    }

    // Сортируем по рейтингу и количеству голосов
    allResults.sort(function (a, b) {
      // Сначала по рейтингу
      var ratingDiff = (b.vote_average || 0) - (a.vote_average || 0);
      if (ratingDiff !== 0) return ratingDiff;
      // Затем по количеству голосов
      return (b.vote_count || 0) - (a.vote_count || 0);
    });

    globalSearchResults = allResults;
    currentSearchQuery = query;

    console.log('Найдено ' + globalSearchResults.length + ' результатов в TMDB');

    // Очищаем фильтры для глобального поиска
    if (currentSearchMode === 'globalsearch') {
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

function getRatingColor(rating) {
  if (rating >= 8) return '#4caf50';
  if (rating >= 6) return '#ffc107';
  if (rating >= 4) return '#ff9800';
  return '#f44336';
}

// НОВАЯ ФУНКЦИЯ: Показать результаты глобального поиска
function showGlobalSearchResults() {
  var searchResultsDiv = document.getElementById('search-results');
  var searchOverlay = document.getElementById('search-overlay');

  if (!searchResultsDiv) return;

  // Убеждаемся, что overlay виден
  if (searchOverlay) {
    searchOverlay.classList.remove('hidden');
  }

  if (globalSearchResults.length === 0) {
    searchResultsDiv.innerHTML = '\n            <div class="filter-stats">Всего найдено: <span>0</span></div>\n            <div class="search-result-empty">\n                ' + (currentSearchQuery ? 'Ничего не найдено для "' + escapeHtml(currentSearchQuery) + '" в TMDB' : 'Введите запрос для поиска') + '\n            </div>\n        ';
    return;
  }

  var gridTemplateColumns = 'repeat(8, 1fr)';

  var html = '<div class="filter-stats">Найдено в TMDB: <span>' + globalSearchResults.length + '</span></div>';
  html += '<div class="global-search-grid" style="display: grid; grid-template-columns: ' + gridTemplateColumns + '; gap: 20px; padding: 20px 0;">';

  for (var idx = 0; idx < globalSearchResults.length; idx++) {
    var result = globalSearchResults[idx];
    var title = result.title || result.name || 'Без названия';
    var year = result.release_date || result.first_air_date;
    var yearStr = year ? new Date(year).getFullYear() : 'N/A';
    var mediaType = result.media_type === 'tv' ? 'Сериал' : 'Фильм';
    var rating = result.vote_average ? result.vote_average.toFixed(1) : null;
    var posterUrl = result.poster_path
      ? 'https://tsimg.hnar.online/t/p/w342' + result.poster_path
      : null;

    html += '\n            <div class="global-search-card" data-index="' + idx + '" data-tmdb-id="' + result.id + '" data-media-type="' + result.media_type + '" style="\n                background: rgba(30, 30, 40, 0.9);\n                border-radius: 12px;\n                overflow: hidden;\n                cursor: pointer;\n                border: 1px solid rgba(74, 158, 255, 0.3);\n            ">\n                <div class="global-search-poster" style="\n                    position: relative;\n                    aspect-ratio: 2/3;\n                    overflow: hidden;\n                    background: linear-gradient(135deg, #1a1a2e, #16213e);\n                ">\n                    ' + (posterUrl ? '\n                        <img src="' + posterUrl + '" alt="' + escapeHtml(title) + '" style="\n                            width: 100%;\n                            height: 100%;\n                            object-fit: cover;\n                        " onerror="this.parentElement.innerHTML=\'<div style=\\\'display: flex; align-items: center; justify-content: center; height: 100%; font-size: 48px;\\\'></div>\'">\n                    ' : '\n                        <div style="display: flex; align-items: center; justify-content: center; height: 100%; font-size: 48px;">\n                            ' + (mediaType === 'Сериал' ? 'Сериал' : 'Фильм') + '\n                        </div>\n                    ') + '\n                    ' + (rating ? '\n                        <div style="\n                            position: absolute;\n                            top: 8px;\n                            right: 8px;\n                            background: rgba(0, 0, 0, 0.8);\n                            color: ' + getRatingColor(parseFloat(rating)) + ';\n                            font-weight: bold;\n                            font-size: 12px;\n                            padding: 4px 8px;\n                            border-radius: 12px;\n                            border: 1px solid ' + getRatingColor(parseFloat(rating)) + ';\n                        ">\n                            ' + rating + '\n                        </div>\n                    ' : '') + '\n                </div>\n                <div class="global-search-info" style="padding: 12px;">\n                    <div class="global-search-title" style="\n                        font-weight: 600;\n                        font-size: 14px;\n                        margin-bottom: 6px;\n                        overflow: hidden;\n                        text-overflow: ellipsis;\n                        white-space: nowrap;\n                    ">' + escapeHtml(title) + '</div>\n                    <div style="\n                        display: flex;\n                        justify-content: space-between;\n                        font-size: 12px;\n                        color: #aaa;\n                    ">\n                        <span>' + mediaType + '</span>\n                        <span>' + yearStr + '</span>\n                    </div>\n                </div>\n            </div>\n        ';
  }

  html += '</div>';
  searchResultsDiv.innerHTML = html;

  // Добавляем обработчики кликов на карточки
  var cards = document.querySelectorAll('.global-search-card');
  for (var i = 0; i < cards.length; i++) {
    (function (card) {
      card.addEventListener('click', async function () {
        AppState.isSearch = true;
        var tmdbId = card.dataset.tmdbId;
        var mediaType = card.dataset.mediaType;
        var index = parseInt(card.dataset.index);
        var result = globalSearchResults[index];

        if (result) {
          await showGlobalSearchDetail(result);
        }
      });
    })(cards[i]);
  }
}

function renderFilteredGlobalResults(results) {
  var searchResultsDiv = document.getElementById('search-results');
  if (!searchResultsDiv) return;

  if (results.length === 0) {
    searchResultsDiv.innerHTML = '\n            <div class="filter-stats">Всего найдено: <span>0</span></div>\n            <div class="search-result-empty">\n                Нет результатов для выбранного типа контента\n            </div>\n        ';
    return;
  }

  var gridTemplateColumns = 'repeat(8, 1fr)';

  var html = '<div class="filter-stats">Найдено в TMDB: <span>' + results.length + '</span></div>';
  html += '<div class="global-search-grid" style="display: grid; grid-template-columns: ' + gridTemplateColumns + '; gap: 20px; padding: 20px 0;">';

  for (var idx = 0; idx < results.length; idx++) {
    var result = results[idx];
    var title = result.title || result.name || 'Без названия';
    var year = result.release_date || result.first_air_date;
    var yearStr = year ? new Date(year).getFullYear() : 'N/A';
    var mediaType = result.media_type === 'tv' ? 'Сериал' : 'Фильм';
    var rating = result.vote_average ? result.vote_average.toFixed(1) : null;
    var posterUrl = result.poster_path
      ? 'https://tsimg.hnar.online/t/p/w342' + result.poster_path
      : null;

    html += '\n            <div class="global-search-card" data-tmdb-id="' + result.id + '" data-media-type="' + result.media_type + '" style="\n                background: rgba(30, 30, 40, 0.9);\n                border-radius: 12px;\n                overflow: hidden;\n                cursor: pointer;\n                border: 1px solid rgba(74, 158, 255, 0.3);\n            ">\n                <div class="global-search-poster" style="\n                    position: relative;\n                    aspect-ratio: 2/3;\n                    overflow: hidden;\n                    background: linear-gradient(135deg, #1a1a2e, #16213e);\n                ">\n                    ' + (posterUrl ? '\n                        <img src="' + posterUrl + '" alt="' + escapeHtml(title) + '" style="\n                            width: 100%;\n                            height: 100%;\n                            object-fit: cover;\n                        " onerror="this.parentElement.innerHTML=\'<div style=\\\'display: flex; align-items: center; justify-content: center; height: 100%; font-size: 48px;\\\'></div>\'">\n                    ' : '\n                        <div style="display: flex; align-items: center; justify-content: center; height: 100%; font-size: 48px;">\n                            ' + (mediaType === 'Сериал' ? 'Сериал' : 'Фильм') + '\n                        </div>\n                    ') + '\n                    ' + (rating ? '\n                        <div style="\n                            position: absolute;\n                            top: 8px;\n                            right: 8px;\n                            background: rgba(0, 0, 0, 0.8);\n                            color: ' + getRatingColor(parseFloat(rating)) + ';\n                            font-weight: bold;\n                            font-size: 12px;\n                            padding: 4px 8px;\n                            border-radius: 12px;\n                            border: 1px solid ' + getRatingColor(parseFloat(rating)) + ';\n                        ">\n                            ' + rating + '\n                        </div>\n                    ' : '') + '\n                </div>\n                <div class="global-search-info" style="padding: 12px;">\n                    <div class="global-search-title" style="\n                        font-weight: 600;\n                        font-size: 14px;\n                        margin-bottom: 6px;\n                        overflow: hidden;\n                        text-overflow: ellipsis;\n                        white-space: nowrap;\n                    ">' + escapeHtml(title) + '</div>\n                    <div style="\n                        display: flex;\n                        justify-content: space-between;\n                        font-size: 12px;\n                        color: #aaa;\n                    ">\n                        <span>' + mediaType + '</span>\n                        <span>' + yearStr + '</span>\n                    </div>\n                </div>\n            </div>\n        ';
  }

  html += '</div>';
  searchResultsDiv.innerHTML = html;

  // Добавляем обработчики
  var cards = document.querySelectorAll('.global-search-card');
  for (var i = 0; i < cards.length; i++) {
    (function (card) {
      card.addEventListener('click', async function () {
        AppState.isSearch = true;
        var tmdbId = card.dataset.tmdbId;
        var mediaType = card.dataset.mediaType;
        var result = null;
        for (var j = 0; j < results.length; j++) {
          if (String(results[j].id) === tmdbId) {
            result = results[j];
            break;
          }
        }
        if (result) {
          await showGlobalSearchDetail(result);
        }
      });
    })(cards[i]);
  }
}

// НОВАЯ ФУНКЦИЯ: Показать детали элемента из глобального поиска
async function showGlobalSearchDetail(item) {
  console.log('📺 Открываем детали из глобального поиска:', item.title || item.name);

  // Формируем объект, совместимый с catalog.js
  var catalogItem = {
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
  var posterUrl = item.poster_path
    ? 'https://tsimg.hnar.online/t/p/w342' + item.poster_path
    : null;

  // Используем catalog.js для показа деталей
  if (typeof window.showCatalogDetail === 'function') {
    // Сохраняем контекст для возврата
    AppState.searchReturnTo = 'search';
    AppState.currentScreen = 'detail';

    // Показываем детали
    await window.showCatalogDetail(catalogItem, 0, posterUrl);

    // Скрываем поиск
    var searchOverlay = document.getElementById('search-overlay');
    if (searchOverlay) {
      searchOverlay.classList.add('hidden');
    }
  } else {
    console.error('showCatalogDetail не доступен');
  }
}

// НОВАЯ ФУНКЦИЯ: Показать фильтр по типу контента
function showContentTypeFilter() {
  var filterGroup = document.querySelector('.filter-group');
  if (!filterGroup) return;

  // Проверяем, есть ли уже фильтр по типу
  var contentTypeFilter = document.getElementById('filter-content-type');
  if (!contentTypeFilter) {
    var newFilter = document.createElement('div');
    newFilter.className = 'filter-group';
    newFilter.innerHTML = '\n            <label class="filter-label" for="filter-content-type">Тип контента</label>\n            <select id="filter-content-type" class="filter-select">\n                <option value="all">Все</option>\n                <option value="movie">Фильмы</option>\n                <option value="tv">Сериалы</option>\n            </select>\n        ';

    // Вставляем после фильтра качества
    var qualityFilter = document.getElementById('filter-quality');
    if (qualityFilter && qualityFilter.parentNode) {
      qualityFilter.parentNode.parentNode.insertBefore(newFilter, qualityFilter.parentNode.nextSibling);
    } else {
      filterGroup.parentNode.appendChild(newFilter);
    }

    // Добавляем обработчик
    document.getElementById('filter-content-type').addEventListener('change', function (e) {
      filterGlobalSearchByType(e.target.value);
    });
  }
}

// НОВАЯ ФУНКЦИЯ: Фильтрация глобального поиска по типу
function filterGlobalSearchByType(type) {
  if (!globalSearchResults.length) return;

  var filtered = globalSearchResults;
  if (type !== 'all') {
    filtered = [];
    for (var i = 0; i < globalSearchResults.length; i++) {
      if (globalSearchResults[i].media_type === type) {
        filtered.push(globalSearchResults[i]);
      }
    }
  }

  // Перерисовываем с фильтрацией
  renderFilteredGlobalResults(filtered);
}

function clearSearchResultsContainer() {
  var searchResultsDiv = document.getElementById('search-results');
  if (searchResultsDiv) {
    searchResultsDiv.innerHTML = '';
  }
}

// Делаем доступной через window
window.clearSearchResultsContainer = clearSearchResultsContainer;
window.refreshTorrents = refreshTorrents;
window.clearSearchResults = clearSearchResults;
