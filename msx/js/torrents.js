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
var currentSeasonFilter = 'all';
var currentVoiceFilter = 'all';
var currentvideotypeFilter = 'all';
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
var torrentFilesCache = new Map(); // ключ: hash, значение: { files: [], timestamp: Date }
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
  { value: 'all', label: 'Все' },
  { value: '2160', label: '4K (2160p)' },
  { value: '1080', label: 'Full HD (1080p)' },
  { value: '720', label: 'HD (720p)' },
  { value: '480', label: 'SD (480p)' },
  { value: '360', label: '360p' }
];
function getTrackerFilterOptions() {
  var options = [{ value: 'all', label: 'Все' }];
  var len = availableTrackers.length;
  for (var i = 0; i < len; i++) {
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
  if (type === 'season') return [];
  if (type === 'voice') return [];
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
  var len = options.length;
  for (var i = 0; i < len; i++) {
    var option = options[i];
    var selected = String(option.value) === normalizedSelected ? ' selected' : '';
    optionsHtml += '<option value="' + option.value + '"' + selected + '>' + option.label + '</option>';
  }
  select.innerHTML = optionsHtml;
  var hasSelected = false;
  var optLen = options.length;
  for (var j = 0; j < optLen; j++) {
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
  // Синхронизируем фильтр сезона
  var seasonFilter = document.getElementById('filter-season');
  if (seasonFilter) {
    if (currentSeasonFilter && currentSeasonFilter !== 'all') {
      seasonFilter.value = currentSeasonFilter;
    } else {
      seasonFilter.value = 'all';
    }
  }
  // Синхронизируем фильтр озвучки
  var voiceFilter = document.getElementById('filter-voice');
  if (voiceFilter) {
    if (currentVoiceFilter && currentVoiceFilter !== 'all') {
      voiceFilter.value = currentVoiceFilter;
    } else {
      voiceFilter.value = 'all';
    }
  }
  // Синхронизируем фильтр по типу видео
  var videotypeFilter = document.getElementById('filter-videotype');
  if (videotypeFilter) {
    if (currentvideotypeFilter && currentvideotypeFilter !== 'all') {
      videotypeFilter.value = currentvideotypeFilter;
    } else {
      videotypeFilter.value = 'all';
    }
  }
}
function cycleFilterButton(filterType, direction) {
  if (direction === undefined) direction = 1;
  var options = getFilterOptions(filterType);
  if (!options.length) return;
  var currentValue = getCurrentFilterValue(filterType);
  var currentIndex = 0;
  var len = options.length;
  for (var i = 0; i < len; i++) {
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
  var len = files.length;
  for (var i = 0; i < len; i++) {
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
    var typesLen = searchResult.types.length;
    for (var i = 0; i < typesLen; i++) {
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
  var torrentsLen = AppState.torrents.length;
  for (var i = 0; i < torrentsLen; i++) {
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

    // Очищаем кэш для удаленного торрента
    clearTorrentFilesCache(hash);

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
    // Проверяем наличие clientId в localStorage
    var savedClientId = localStorage.getItem('clientId');
    // Формируем URL с параметром clientId, если он есть
    var url = SERVER_URL + '/api/client/config';
    if (savedClientId) {
      url += '?clientId=' + encodeURIComponent(savedClientId);
    }

    var response = await fetch(url);
    if (response.ok) {
      var data = await response.json();
      AppState.clientId = data.clientId;

      // Сохраняем clientId в localStorage с проверкой
      if (localStorage.getItem('clientId') !== data.clientId) {
        localStorage.setItem('clientId', data.clientId);
      }

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
            authPassword.value = data.config.password;
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
  var savedClientId = localStorage.getItem('clientId');
  var config = {
    url: url,
    authEnabled: authEnabled,
    login: login,
    clientId: savedClientId
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
// Загрузка прогресса для торрента
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
    var files = [];
    var hash = cacheKey;
    // Проверяем наличие file_stats (активный торрент)
    if (torrent.file_stats && Array.isArray(torrent.file_stats) && torrent.file_stats.length > 0) {
      files = torrent.file_stats;
    }

    // Если всё ещё нет файлов, делаем запрос к TorrServer
    if (files.length === 0 && AppState.currentTorrserverUrl) {
      var headers = {
        'accept': 'application/octet-stream',
      };
      var authHeaders = getAuthHeaders();
      for (var key in authHeaders) {
        if (authHeaders.hasOwnProperty(key)) {
          headers[key] = authHeaders[key];
        }
      }

      var response = await fetch(AppState.currentTorrserverUrl + '/stream?link=' + hash + '&stat=stat', {
        method: 'GET',
        headers: headers
      });

      if (response.ok) {
        var apiData = await response.json();
        if (apiData.file_stats && Array.isArray(apiData.file_stats)) {
          files = apiData.file_stats;
          // Обновляем torrent.file_stats для будущего использования
          torrent.file_stats = files;
        } else if (apiData.data) {
          try {
            var parsedData = JSON.parse(apiData.data);
            if (parsedData.TorrServer && parsedData.TorrServer.Files) {
              files = parsedData.TorrServer.Files;
              torrent.file_stats = files;
            }
          } catch (e) { }
        }
      }
    }

    // Для сериала - проверяем каждый файл
    if (files.length > 0) {
      // Сортируем файлы (предполагаем, что они уже в правильном порядке)
      var videoFiles = [];
      var filesLen = files.length;
      for (var i = 0; i < filesLen; i++) {
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
      var videoLen = videoFiles.length;
      for (var j = 0; j < videoLen; j++) {
        var file = videoFiles[j];
        var index = j;
        progressPromises.push((function (file, idx) {
          return async function () {
            try {
              var savedClientId = localStorage.getItem('clientId');
              var response = await fetch(SERVER_URL + '/api/timecode/get?hash=' + torrent.hash + '&fileId=' + file.id + '&clientId=' + encodeURIComponent(savedClientId));
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
      var promisesLen = progressPromises.length;
      for (var k = 0; k < promisesLen; k++) {
        var result = await progressPromises[k]();
        results.push(result);
      }

      var validProgress = [];
      var resultsLen = results.length;
      for (var m = 0; m < resultsLen; m++) {
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
// Добавление информации о прогрессе в карточку
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
// Отрисовка бейджа прогресса
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
    progressBadge.innerHTML = '\n       <div class="progress-content" data-hash="' + progress.hash + '" data-file-id="' + progress.fileId + '" data-timecode="' + progress.timecode + '" data-episode-index="' + progress.episodeIndex + '">\n         <div class="progress-info">\n           <span class="progress-episode">Серия ' + episodeNum + '</span>\n           <span class="progress-time">' + timeStr + ' / ' + totalStr + '</span>\n         </div>\n         <button class="progress-continue-btn">▶ Продолжить</button>\n       </div>\n    ';
  } else if (progress.isMovie) {
    // Для фильма
    progressBadge.innerHTML = '\n       <div class="progress-content" data-hash="' + progress.hash + '" data-file-id="' + progress.fileId + '" data-timecode="' + progress.timecode + '" data-episode-index="0">\n         <div class="progress-info">\n           <span class="progress-time">' + timeStr + ' / ' + totalStr + '</span>\n         </div>\n         <button class="progress-continue-btn">▶ Продолжить</button>\n       </div>\n    ';
  } else {
    // Для обычного файла
    progressBadge.innerHTML = '\n       <div class="progress-content" data-hash="' + progress.hash + '" data-file-id="' + progress.fileId + '" data-timecode="' + progress.timecode + '" data-episode-index="0">\n         <div class="progress-info">\n           <span class="progress-time">' + timeStr + ' / ' + totalStr + '</span>\n         </div>\n         <button class="progress-continue-btn">▶ Продолжить</button>\n       </div>\n    ';
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
// Добавление информации о прогрессе в детальный просмотр
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
    if (episodeNum == 1) {
      progressDiv.innerHTML = '\n       <div class="detail-progress-content">\n         <div class="detail-progress-info">\n           <span class="detail-progress-label">Продолжить просмотр: </span>\n           <span class="detail-progress-time">' + timeStr + ' / ' + totalStr + '</span>\n         </div>\n         <button class="detail-progress-btn" data-hash="' + progress.hash + '" data-file-id="' + progress.fileId + '" data-timecode="' + progress.timecode + '" data-episode-index="' + progress.episodeIndex + '">\n          ▶ Продолжить с ' + timeStr + '\n         </button>\n       </div>\n    ';
    } else {
      progressDiv.innerHTML =  '\n       <div class="detail-progress-content">\n         <div class="detail-progress-info">\n           <span class="detail-progress-label">Продолжить просмотр: </span>\n           <span class="detail-progress-episode">📺 Серия ' + episodeNum + '</span>\n           <span class="detail-progress-time">⏱️ ' + timeStr + ' / ' + totalStr + '</span>\n         </div>\n         <button class="detail-progress-btn" data-hash="' + progress.hash + '" data-file-id="' + progress.fileId + '" data-timecode="' + progress.timecode + '" data-episode-index="' + progress.episodeIndex + '">\n          ▶ Продолжить с ' + timeStr + '\n         </button>\n       </div>\n    ';
    }
  } else {
    progressDiv.innerHTML = '\n       <div class="detail-progress-content">\n         <div class="detail-progress-info">\n           <span class="detail-progress-label">Продолжить просмотр: </span>\n           <span class="detail-progress-time">' + timeStr + ' / ' + totalStr + '</span>\n         </div>\n         <button class="detail-progress-btn" data-hash="' + progress.hash + '" data-file-id="' + progress.fileId + '" data-timecode="' + progress.timecode + '" data-episode-index="0">\n          ▶ Продолжить с ' + timeStr + '\n         </button>\n       </div>\n    ';
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
        torrentsGrid.innerHTML = '\n           <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">\n             <div style="font-size: 48px; margin-bottom: 20px;"></div>\n             <div style="font-size: 16px; color: #ff6a6a;">Ошибка: ' + error.message + '</div>\n             <button class="btn" style="margin-top: 20px;" onclick="loadTorrents()">Попробовать снова</button>\n           </div>\n        ';
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
  // Очищаем кэш файлов торрентов (чтобы перезагрузить актуальные данные)
  //clearAllTorrentFilesCache();
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
    torrentsGrid.innerHTML = '\n       <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">\n         <div style="font-size: 48px; margin-bottom: 20px;"></div>\n         <div style="font-size: 18px; color: #aaa; margin-bottom: 10px;">Нет торрентов</div>\n         <div style="font-size: 14px; color: #666;">Используйте поиск выше, чтобы найти и добавить торренты</div>\n       </div>\n    ';
    return;
  }
  // Здесь остается существующий код для отрисовки торрентов
  var torrentsLen = AppState.torrents.length;
  for (var i = 0; i < torrentsLen; i++) {
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

      var playStatus = null;

      if (torrent.stat_string == "Torrent working") {
        playStatus = '<span style="color: #4caf50; font-weight: bold; text-shadow: 0 0 2px rgba(0,0,0,0.5);">▶ Идет просмотр</span>';
      } else {
        playStatus = formatBytes(torrent.torrent_size);
      }

      card.innerHTML = '\n       <div class="torrent-poster">\n        ' + (poster ? '<img src="' + poster + '" loading="lazy" onerror="this.parentElement.innerHTML=\'<div class=\\\'no-poster\\\'>Нет постера</div>\'">' : '<div class="no-poster">Нет постера</div>') + '\n       </div>\n       <div class="torrent-info">\n         <div class="torrent-title">' + escapeHtml(title) + '</div>\n         <div class="torrent-meta">\n           <span>' + playStatus + '</span>\n           <span class="torrent-badge">' + (displayCategory === 'tv' ? 'Сериал' : 'Фильм') + '</span>\n         </div>\n       </div>\n    ';

      torrentsGrid.appendChild(card);

      // Загружаем и добавляем прогресс
      //addProgressToCard(card, torrent);
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
  var torrentsLen = AppState.torrents.length;
  for (var i = 0; i < torrentsLen; i++) {
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
  //if (filesList) filesList.style.display = 'block';
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
async function getTmdbDetailsWithCache(tmdbId, mediaType) {
  if (!tmdbId) return null;
  // Определяем тип, если не передан
  if (!mediaType) {
    // Ищем текущий торрент по hash или title
    mediaType = 'movie'; // по умолчанию фильм
  }
  // Проверяем, доступен ли кэш из catalog.js
  if (window.getFromTmdbCache && window.saveToTmdbCache) {
    // Используем существующий кэш catalog.js
    var cacheParams = { id: tmdbId, type: mediaType };
    var cachedData = window.getFromTmdbCache('details', cacheParams);
    if (cachedData) {
      console.log('📦 TMDB данные взяты из catalog.js кэша для ID:', tmdbId, 'тип:', mediaType);
      return cachedData;
    }

    // Загружаем данные
    console.log('🌐 Загрузка TMDB данных для ID:', tmdbId, 'тип:', mediaType);
    try {
      var response = await fetch('/api/tmdb/details?id=' + tmdbId + '&type=' + mediaType);
      if (response.ok) {
        var data = await response.json();
        // Сохраняем в кэш catalog.js
        window.saveToTmdbCache('details', cacheParams, data);
        console.log('💾 TMDB данные сохранены в catalog.js кэш');
        return data;
      }
    } catch (error) {
      console.error('Ошибка загрузки TMDB данных:', error);
    }
  } else {
    // Fallback: используем локальный кэш если catalog.js не загружен
    console.log('⚠️ catalog.js кэш не доступен, используем локальный');
    if (!window.tmdbDetailsCache) {
      window.tmdbDetailsCache = new Map();
    }

    var cacheKey = tmdbId + '_' + mediaType;
    if (window.tmdbDetailsCache.has(cacheKey)) {
      var cached = window.tmdbDetailsCache.get(cacheKey);
      if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
        return cached.data;
      }
    }

    try {
      var response = await fetch('/api/tmdb/details?id=' + tmdbId + '&type=' + mediaType);
      if (response.ok) {
        var data = await response.json();
        window.tmdbDetailsCache.set(cacheKey, {
          data: data,
          timestamp: Date.now()
        });
        return data;
      }
    } catch (error) {
      console.error('Ошибка загрузки TMDB данных:', error);
    }
  }
  return null;
}
function resetDetailBackground() {
  var detailView = document.getElementById('detail-view');
  if (!detailView) return;
  // Очищаем фон
  detailView.style.backgroundImage = '';
  detailView.style.backgroundColor = '#000000';
  // Удаляем overlay затемнения
  var existingOverlay = document.getElementById('detail-backdrop-overlay');
  if (existingOverlay) {
    existingOverlay.remove();
  }
  // Очищаем subtitle
  var detailSubtitle = document.getElementById('detail-subtitle');
  if (detailSubtitle) {
    detailSubtitle.textContent = '';
    detailSubtitle.style.display = 'none';
  }
  // Очищаем meta информацию
  var metaContainer = document.getElementById('catalog-detail-meta');
  if (metaContainer) {
    metaContainer.innerHTML = '';
    metaContainer.classList.add('hidden');
  }
  // Очищаем список файлов
  var filesList = document.getElementById('files-list');
  if (filesList) {
    filesList.innerHTML = '';
    // Сбрасываем стили, если нужно
    filesList.style.display = '';
    filesList.style.flexDirection = '';
  }
  // Очищаем постер
  var detailPoster = document.getElementById('detail-poster');
  if (detailPoster) {
    detailPoster.innerHTML = '';
  }
  // Очищаем название
  var detailTitleText = document.getElementById('detail-title-text');
  if (detailTitleText) {
    detailTitleText.textContent = '';
  }
}
// Функция для извлечения номера сезона из названия
function extractSeasonsFromTitle(title) {
  if (!title) return [];
  var seasons = [];
  // Шаблоны для поиска сезонов
  var patterns = [
    // [сезон 1, 2, 3] или [сезон 1,2,3]
    /\[сезон\s*([\d,\s]+)\]/i,
    /\[season\s*([\d,\s]+)\]/i,
    // сезон 1, 2, 3
    /сезон\s*([\d,\s]+)/i,
    /season\s*([\d,\s]+)/i,
    // S1-3 или S1,2,3
    /S([\d-,\s]+)/i,
    // [сезон 1-3]
    /\[сезон\s*(\d+)\s*[-–]\s*(\d+)\]/i,
    /\[season\s*(\d+)\s*[-–]\s*(\d+)\]/i
  ];
  var patternsLen = patterns.length;
  for (var p = 0; p < patternsLen; p++) {
    var match = title.match(patterns[p]);
    if (match) {
      // Проверяем на диапазон (1-3)
      if (match[2] && parseInt(match[2])) {
        var start = parseInt(match[1], 10);
        var end = parseInt(match[2], 10);
        for (var s = start; s <= end; s++) {
          if (seasons.indexOf(s) === -1) seasons.push(s);
        }
      }
      // Проверяем на список (1,2,3)
      else if (match[1] && match[1].match(/[\d,]+/)) {
        var parts = match[1].split(/[,\s]+/);
        var partsLen = parts.length;
        for (var i = 0; i < partsLen; i++) {
          var num = parseInt(parts[i], 10);
          if (!isNaN(num) && seasons.indexOf(num) === -1) {
            seasons.push(num);
          }
        }
      }
      // Одиночный сезон
      else if (match[1] && parseInt(match[1])) {
        var singleNum = parseInt(match[1], 10);
        if (seasons.indexOf(singleNum) === -1) seasons.push(singleNum);
      }

      if (seasons.length > 0) break;
    }
  }
  // Также ищем множественные сезоны в формате "S1-S3" или "S1, S2, S3"
  var multiSeasonPatterns = [
    /S(\d+)\s*[-–]\s*S?(\d+)/i,
    /S(\d+)[,\s]+S(\d+)/i
  ];
  var multiLen = multiSeasonPatterns.length;
  for (var p = 0; p < multiLen; p++) {
    var multiMatch = title.match(multiSeasonPatterns[p]);
    if (multiMatch && multiMatch[1] && multiMatch[2]) {
      var startSeason = parseInt(multiMatch[1], 10);
      var endSeason = parseInt(multiMatch[2], 10);
      for (var s = startSeason; s <= endSeason; s++) {
        if (seasons.indexOf(s) === -1) seasons.push(s);
      }
      break;
    }
  }
  return seasons.sort(function (a, b) { return a - b; });
}
// Функция для очистки названия от информации о сезонах
function cleanTitleFromSeasons(title, seasons) {
  if (!title) return title;
  var cleaned = title;
  // Удаляем [сезон X, Y, Z]
  cleaned = cleaned.replace(/[сезон\s*[\d,\s-]+]/i, '');
  cleaned = cleaned.replace(/[season\s*[\d,\s-]+]/i, '');
  // Удаляем сезон X, Y, Z без скобок
  cleaned = cleaned.replace(/сезон\s*[\d,\s-]+/i, '');
  cleaned = cleaned.replace(/season\s*[\d,\s-]+/i, '');
  // Удаляем S1, S2, S3
  if (seasons && seasons.length > 0) {
    var seasonsLen = seasons.length;
    for (var i = 0; i < seasonsLen; i++) {
      cleaned = cleaned.replace(new RegExp('S' + seasons[i] + '\\b', 'ig'), '');
    }
  }
  cleaned = cleaned.replace(/S\d+/ig, '');
  // Удаляем лишние пробелы
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}
// Кэш для сезонов
var seasonCache = new Map();
// Функция для загрузки кадров сезона из TMDB с кэшированием
async function loadSeasonStills(tmdbId, seasonNumber) {
  var cacheKey = tmdbId + 'season' + seasonNumber;
  // Проверяем кэш
  if (seasonCache.has(cacheKey)) {
    var cached = seasonCache.get(cacheKey);
    if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) { // 24 часа
      console.log('📦 Кадры сезона взяты из кэша для', cacheKey);
      return cached.data;
    }
  }
  try {
    var response = await fetch('/api/tmdb/season?id=' + tmdbId + '&seasonNumber=' + seasonNumber);
    if (response.ok) {
      var seasonData = await response.json();
      var episodes = seasonData.episodes || [];
      // Сохраняем в кэш
      seasonCache.set(cacheKey, {
        data: episodes,
        timestamp: Date.now()
      });

      console.log('💾 Кадры сезона сохранены в кэш для', cacheKey);
      return episodes;
    }
  } catch (error) {
    console.error('Ошибка загрузки кадров сезона:', error);
  }
  return [];
}
// Функция для загрузки постера для фильма из TMDB (для кадра)
async function loadMovieStill(tmdbId) {
  var cacheKey = tmdbId + '_movie_still';
  // Проверяем кэш
  if (seasonCache.has(cacheKey)) {
    var cached = seasonCache.get(cacheKey);
    if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
      console.log('📦 Постер фильма взят из кэша для', tmdbId);
      return cached.data;
    }
  }
  try {
    var response = await fetch('/api/tmdb/details?id=' + tmdbId + '&type=movie');
    if (response.ok) {
      var data = await response.json();
      var posterPath = data.poster_path;

      if (posterPath) {
        var stillUrl = AppState.protocol + '//tsimg.hnar.online/t/p/w300' + posterPath;

        // Сохраняем в кэш
        seasonCache.set(cacheKey, {
          data: stillUrl,
          timestamp: Date.now()
        });

        console.log('💾 Постер фильма сохранен в кэш для', tmdbId);
        return stillUrl;
      }
    }
  } catch (error) {
    console.error('Ошибка загрузки постера фильма:', error);
  }
  return null;
}
// Функция для получения файлов торрента с кэшированием
async function getTorrentFilesWithCache(torrent, forceRefresh) {
  if (forceRefresh === undefined) forceRefresh = false;
  var hash = torrent.hash;
  if (!hash) return [];
  // Проверяем кэш
  if (!forceRefresh && torrentFilesCache.has(hash)) {
    var cached = torrentFilesCache.get(hash);
    // Кэш на 60 минут
    if (Date.now() - cached.timestamp < 60 * 60 * 1000) {
      console.log('📦 Используем кэш для файлов торрента:', hash);
      return cached.files;
    } else {
      console.log('🕐 Кэш устарел для:', hash);
      torrentFilesCache.delete(hash);
    }
  }
  console.log('🌐 Загружаем файлы с сервера для:', hash);
  var files = [];
  try {
    // Проверяем наличие file_stats (активный торрент) - они уже есть в объекте
    if (torrent.file_stats && Array.isArray(torrent.file_stats) && torrent.file_stats.length > 0) {
      files = torrent.file_stats;
    }
    // Если нет, запрашиваем через API
    // else if (torrent.data) {
    //   try {
    //     var data = JSON.parse(torrent.data);
    //     if (data.TorrServer && data.TorrServer.Files) {
    //       files = data.TorrServer.Files;
    //     }
    //   } catch (e) {
    //     console.warn('Ошибка парсинга torrent.data:', e);
    //   }
    // }
    // Если всё ещё нет файлов, делаем запрос к TorrServer
    if (files.length === 0 && AppState.currentTorrserverUrl) {
      var headers = {
        'accept': 'application/octet-stream',
      };
      var authHeaders = getAuthHeaders();
      for (var key in authHeaders) {
        if (authHeaders.hasOwnProperty(key)) {
          headers[key] = authHeaders[key];
        }
      }

      var response = await fetch(AppState.currentTorrserverUrl + '/stream?link=' + hash + '&index=1&stat=stat', {
        method: 'GET',
        headers: headers
      });

      if (response.ok) {

        // response = await fetch(AppState.currentTorrserverUrl + '/torrents', {
        //   method: 'POST',
        //   headers: headers,
        //   body: JSON.stringify({ action: 'get', hash: hash })
        // });

        // if (response.ok) {
        var apiData = await response.json();
        if (apiData.file_stats && Array.isArray(apiData.file_stats)) {
          files = apiData.file_stats;
          // Обновляем torrent.file_stats для будущего использования
          torrent.file_stats = files;
        } else if (apiData.data) {
          try {
            var parsedData = JSON.parse(apiData.data);
            if (parsedData.TorrServer && parsedData.TorrServer.Files) {
              files = parsedData.TorrServer.Files;
              torrent.file_stats = files;
            }
          } catch (e) { }
        }
        //}
      }
    }
  } catch (error) {
    console.error('Ошибка загрузки файлов:', error);
  }
  // Сохраняем в кэш
  torrentFilesCache.set(hash, {
    files: files,
    timestamp: Date.now()
  });
  return files;
}
// Функция для очистки кэша для конкретного торрента
function clearTorrentFilesCache(hash) {
  if (hash && torrentFilesCache.has(hash)) {
    torrentFilesCache.delete(hash);
    console.log('🗑️ Очищен кэш для торрента:', hash);
  }
}
// Функция для очистки всего кэша файлов
function clearAllTorrentFilesCache() {
  torrentFilesCache.clear();
  console.log('🗑️ Полностью очищен кэш файлов торрентов');
}
// Показать детали торрента
async function showDetail(torrent) {
  window.initHorizontalScroll();
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
  //detailView.style.display = 'block';
  //detailView.style.zIndex = '100';
  resetDetailBackground();
  if (typeof Animations !== 'undefined') {
    Animations.animateDetailShow();
  }
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
  var detailSubtitle = document.getElementById('detail-subtitle');
  var detailViewDiv = document.getElementById('detail-view');
  if (filesList) {
    filesList.style.display = 'flex';
    filesList.style.flexDirection = 'row';
  }
  // Показываем индикатор загрузки
  filesList.innerHTML = ' <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; gap: 15px;">' +
    ' <div class="spinner" style="width: 50px; height: 50px; border: 3px solid rgba(74, 158, 255, 0.2); border-top: 3px solid #4a9eff; border-right: 3px solid #4a9eff; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>' +
    ' <div style="font-size: 16px; color: #aaa;">Загрузка файлов...</div>' +
    ' </div>';
  // Запускаем загрузку TMDB данных в фоне (НЕ ждем)
  var tmdbPromise = loadAllTmdbDataForTorrent(torrent, {
    titleEl: titleEl,
    detailViewDiv: detailViewDiv,
    detailSubtitle: detailSubtitle
  });
  // Временно устанавливаем заголовок из torrent.title
  var displayTitle = torrent.title || 'Без названия';
  displayTitle = displayTitle.replace(/[\d+]/, '').trim();
  titleEl.textContent = displayTitle;
  // Удаляем старый прогресс если есть
  var oldProgress = document.getElementById('detail-progress');
  if (oldProgress) oldProgress.remove();
  // Добавляем прогресс для текущего торрента
  await addProgressToDetail(torrent);
  try {
    // Получаем файлы с кэшированием (этот метод уже получает и file_stats, и данные)
    var files = await getTorrentFilesWithCache(torrent, false);
    // После получения файлов, пытаемся извлечь постер из тех же данных
    var poster = torrent.poster || '';

    if (!poster && torrent.data) {
      try {
        var data = JSON.parse(torrent.data);
        if (data.movie && data.movie.img) {
          poster = data.movie.img;
        } else if (data.movie && data.movie.poster_path) {
          poster = 'https://image.tmdb.org/t/p/w342' + data.movie.poster_path;
        }
      } catch (e) { }
    }

    posterImg.innerHTML = poster ? '<img src="' + poster + '" alt="poster">' : '<div class="no-poster">Нет постера</div>';

    if (files.length === 0) {
      filesList.innerHTML = '<div style="text-align: center; padding: 20px; color: #aaa;">📁 Нет файлов</div>';
    } else {
      // Фильтруем только видео файлы
      var videoFiles = [];
      var filesLen = files.length;
      for (var i = 0; i < filesLen; i++) {
        var fileName = files[i].path.split('/').pop().toLowerCase();
        if (fileName.indexOf('.mp4') !== -1 || fileName.indexOf('.mkv') !== -1 ||
          fileName.indexOf('.avi') !== -1 || fileName.indexOf('.mov') !== -1 ||
          fileName.indexOf('.webm') !== -1 || fileName.indexOf('.m4v') !== -1) {
          videoFiles.push(files[i]);
        }
      }

      var totalVideoFiles = videoFiles.length;
      console.log('Всего видео файлов:', totalVideoFiles);

      // Очищаем индикатор загрузки
      filesList.innerHTML = '';

      // Создаем файлы с помощью DocumentFragment
      var fragment = document.createDocumentFragment();

      var videoLen = videoFiles.length;
      for (var i = 0; i < videoLen; i++) {
        var file = videoFiles[i];
        var item;

        if (videoFiles.length === 1) {
          item = addFileItem(file, torrent.hash, torrent.title, null, null, true);
        } else {
          item = addFileItem(file, torrent.hash, 'Серия ' + (i + 1), i, null, true);
        }

        if (item) {
          fragment.appendChild(item);
        }
      }

      filesList.appendChild(fragment);

      // Ждем TMDB данные в фоне и обновляем постеры когда они придут
      tmdbPromise.then(function (tmdbData) {
        // Обновляем заголовок если есть чистое название
        if (tmdbData.cleanTitle && tmdbData.cleanTitle !== 'Без названия') {
          titleEl.textContent = tmdbData.cleanTitle;
        }

        // Если есть несколько сезонов, добавляем индикатор
        if (tmdbData.seasonNumbers && tmdbData.seasonNumbers.length > 1) {
          var seasonsText = titleEl.textContent;
          if (seasonsText.indexOf('сезон') === -1) {
            var seasonsList = tmdbData.seasonNumbers.join(', ');
            titleEl.textContent = seasonsText + ' [сезон ' + seasonsList + ']';
          }
        }

        // Запускаем загрузку кадров с полученными данными
        loadStillsAndUpdateFiles(
          tmdbData.seasonNumbers || [],
          tmdbData.allSeasonEpisodes || {},
          tmdbData.movieStill,
          totalVideoFiles
        );
      }).catch(function (error) {
        console.error('Ошибка загрузки TMDB данных:', error);
      });
    }
  } catch (e) {
    console.error('Ошибка:', e);
    filesList.innerHTML = '<div style="text-align: center; padding: 20px; color: #ff6a6a;">❌ Ошибка загрузки файлов: ' + (e.message || 'Неизвестная ошибка') + '</div>';
  }
  // Устанавливаем фокус на первый элемент
  setTimeout(function () {
    if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
      updateFocusableElements();
      var fileItems = document.querySelectorAll('.file-item');
      if (fileItems.length > 0) {
        var focusLen = focusableElements.length;
        for (var i = 0; i < focusLen; i++) {
          if (focusableElements[i].classList && focusableElements[i].classList.contains('file-item')) {
            setFocus(i);
            break;
          }
        }
      } else {
        setFocus(0);
      }
    }
  }, 200);
  AppState.mediaType = "";
}
// Асинхронная функция для загрузки всех TMDB данных
async function loadAllTmdbDataForTorrent(torrent, elements) {
  // Извлекаем TMDB ID из названия торрента
  var tmdbId = null;
  var cleanTitle = torrent.title || 'Без названия';
  var seasonNumbers = [];
  // Ищем ID в квадратных скобках [ID] - только цифры
  var bracketMatch = cleanTitle.match(/\[(\d+)\]/);
  if (bracketMatch && bracketMatch[1]) {
    tmdbId = bracketMatch[1];
    cleanTitle = cleanTitle.replace(/\[\d+\]/, '').trim();
    console.log('Найден TMDB ID в названии:', tmdbId);
  }
  // Извлекаем номера сезонов из названия
  seasonNumbers = extractSeasonsFromTitle(cleanTitle);
  if (seasonNumbers.length > 0) {
    console.log('Найден номера сезонов:', seasonNumbers);
    cleanTitle = cleanTitleFromSeasons(cleanTitle, seasonNumbers);
  }
  // Обновляем заголовок
  if (elements.titleEl) {
    elements.titleEl.textContent = cleanTitle;
  }
  // Определяем, сериал ли это
  var isTvSeries = false;
  try {
    if (torrent.file_stats && Array.isArray(torrent.file_stats) && torrent.file_stats.length > 1) {
      isTvSeries = true;
    } else if (torrent.data) {
      var data = JSON.parse(torrent.data);
      if (data.TorrServer && data.TorrServer.Files && data.TorrServer.Files.length > 1) {
        isTvSeries = true;
      }
    }
  } catch (e) {
    console.warn('Ошибка при определении типа контента:', e);
  }
  // Переменные для данных TMDB
  var allSeasonEpisodes = {};
  var movieStill = null;
  var tmdbDetails = null;
  // Запускаем фоновую загрузку кадров (не ждем)
  if (tmdbId && isTvSeries && seasonNumbers.length > 0) {
    var seasonsLen = seasonNumbers.length;
    for (var s = 0; s < seasonsLen; s++) {
      var seasonNum = seasonNumbers[s];
      (function (season) {
        loadSeasonStills(tmdbId, season).then(function (episodes) {
          if (episodes && episodes.length > 0) {
            allSeasonEpisodes[season] = episodes;
            console.log('Фоново загружено ' + episodes.length + ' кадров для сезона ' + season);
            // После загрузки кадров - обновляем файлы
            var videoFiles = [];
            var files = getTorrentFiles(torrent);
            var filesLen = files.length;
            for (var i = 0; i < filesLen; i++) {
              var fileName = files[i].path.split('/').pop().toLowerCase();
              if (fileName.indexOf('.mp4') !== -1 || fileName.indexOf('.mkv') !== -1 ||
                fileName.indexOf('.avi') !== -1 || fileName.indexOf('.mov') !== -1 ||
                fileName.indexOf('.webm') !== -1 || fileName.indexOf('.m4v') !== -1) {
                videoFiles.push(files[i]);
              }
            }
            loadStillsAndUpdateFiles(seasonNumbers, allSeasonEpisodes, movieStill, videoFiles.length);
          }
        });
      })(seasonNum);
    }
  }
  // Загружаем постер для фильма в фоне
  if (tmdbId && !isTvSeries && seasonNumbers.length === 0) {
    loadMovieStill(tmdbId).then(function (still) {
      if (still) {
        movieStill = still;
        console.log('Фоново загружен постер фильма');
        // Обновляем файл с постером
        var fileItem = document.querySelector('.file-item');
        if (fileItem) {
          updateFileItemStill(fileItem, movieStill);
        }
      }
    });
  }
  // Загружаем детальные TMDB данные для фона
  if (tmdbId) {
    (function () {
      var mediaType = isTvSeries ? 'tv' : 'movie';
      getTmdbDetailsWithCache(tmdbId, mediaType).then(function (details) {
        if (details) {
          console.log('TMDB детальные данные загружены');
          tmdbDetails = details;
          if (details.backdrop_path && elements.detailViewDiv) {
            var backdropPath = AppState.protocol + '//tsimg.hnar.online/t/p/original' + details.backdrop_path;
            elements.detailViewDiv.style.backgroundImage = 'url(' + backdropPath + ')';
            elements.detailViewDiv.style.backgroundSize = 'cover';
            elements.detailViewDiv.style.backgroundPosition = 'center';
            elements.detailViewDiv.style.backgroundRepeat = 'no-repeat';

            var existingOverlay = document.getElementById('detail-backdrop-overlay');
            if (!existingOverlay && elements.detailViewDiv) {
              var overlay = document.createElement('div');
              overlay.id = 'detail-backdrop-overlay';
              overlay.style.position = 'fixed';
              overlay.style.top = '0';
              overlay.style.left = '0';
              overlay.style.right = '0';
              overlay.style.bottom = '0';
              overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
              overlay.style.zIndex = '-1';
              elements.detailViewDiv.appendChild(overlay);
            }
          }

          if (details.overview && elements.detailSubtitle) {
            elements.detailSubtitle.textContent = details.overview;
            elements.detailSubtitle.style.display = 'block';
          }

          if (typeof updateDetailMetaInfo === 'function') {
            updateDetailMetaInfo(details);
          }
        }
      });
    })();
  }
  // Возвращаем сразу, без ожидания кадров
  return {
    tmdbId: tmdbId,
    cleanTitle: cleanTitle,
    seasonNumbers: seasonNumbers,
    isTvSeries: isTvSeries,
    allSeasonEpisodes: allSeasonEpisodes,
    movieStill: movieStill,
    tmdbDetails: tmdbDetails
  };
}
// Функция для обновления кадра у существующей плитки
function updateFileItemStill(fileItem, stillImage) {
  if (!fileItem || !stillImage) return;
  var existingContainer = fileItem.querySelector('.file-still-container');
  var existingOverlay = fileItem.querySelector('.file-overlay');
  if (existingContainer) {
    // Обновляем существующее изображение
    var img = existingContainer.querySelector('img');
    if (img) {
      img.src = stillImage;
    }
  } else {
    // Создаем новые элементы
    var stillHtml = '<div class="file-still-container">' +
      '<img src="' + stillImage + '" onerror="this.parentElement.style.display=\'none\'">' +
      '</div>' +
      '<div class="file-overlay"></div>';
    var tempDiv = document.createElement('div');
    tempDiv.innerHTML = stillHtml;

    var stillContainer = tempDiv.firstChild;
    var overlay = stillContainer.nextSibling;

    fileItem.insertBefore(stillContainer, fileItem.firstChild);
    fileItem.insertBefore(overlay, fileItem.firstChild.nextSibling);
  }
}
// Вспомогательная функция для обновления meta информации в детальном просмотре
function updateDetailMetaInfo(tmdbData) {
  var metaContainer = document.getElementById('catalog-detail-meta');
  if (!metaContainer) return;
  metaContainer.innerHTML = '';
  metaContainer.classList.remove('hidden');
  // Год
  if (tmdbData.release_date || tmdbData.first_air_date) {
    var year = (tmdbData.release_date || tmdbData.first_air_date).substring(0, 4);
    var yearChip = document.createElement('div');
    yearChip.className = 'catalog-meta-chip';
    yearChip.textContent = year;
    metaContainer.appendChild(yearChip);
  }
  // Рейтинг
  if (tmdbData.vote_average) {
    var ratingChip = document.createElement('div');
    ratingChip.className = 'catalog-meta-chip';
    ratingChip.textContent = '⭐ ' + tmdbData.vote_average.toFixed(1);
    metaContainer.appendChild(ratingChip);
  }
  // Тип контента
  var typeChip = document.createElement('div');
  typeChip.className = 'catalog-meta-chip';
  if (tmdbData.media_type === 'tv' || (tmdbData.number_of_seasons !== undefined)) {
    typeChip.textContent = 'Сериал';
  } else {
    typeChip.textContent = 'Фильм';
  }
  metaContainer.appendChild(typeChip);
  // Жанры
  if (tmdbData.genres && Array.isArray(tmdbData.genres)) {
    var genresLen = Math.min(tmdbData.genres.length, 3);
    for (var i = 0; i < genresLen; i++) {
      var genreChip = document.createElement('div');
      genreChip.className = 'catalog-meta-chip';
      genreChip.textContent = tmdbData.genres[i].name;
      metaContainer.appendChild(genreChip);
    }
  }
}
// Добавить элемент файла (для сериалов)
// Добавить элемент файла (для сериалов)
function addFileItem(file, hash, name, episodeIndex, stillImage, returnOnly) {
  if (returnOnly === undefined) returnOnly = false;
  // Проверяем расширение файла
  var fileName = file.path.split('/').pop() || ('Файл ' + file.id);
  var fileExt = fileName.split('.').pop().toLowerCase();
  var allowedExtensions = ['mkv', 'mp4', 'avi', 'mov', 'webm', 'm4v'];
  // Проверка поддержки массива includes (используем indexOf для старых браузеров)
  var isAllowed = false;
  var extLen = allowedExtensions.length;
  for (var extIndex = 0; extIndex < extLen; extIndex++) {
    if (fileExt === allowedExtensions[extIndex]) {
      isAllowed = true;
      break;
    }
  }
  if (!isAllowed) {
    console.log('Пропускаем файл (не видео): ' + fileName);
    return null;
  }
  var fileSize = formatBytes(file.length);
  var item = document.createElement('div');
  item.className = 'file-item';
  // Добавляем data-атрибуты для идентификации
  item.dataset.hash = hash;
  item.dataset.fileId = file.id;
  if (episodeIndex !== undefined && episodeIndex !== null) {
    item.dataset.episodeIndex = episodeIndex;
  }
  // Создаем HTML с плейсхолдером
  //var placeholderHtml = '<div class="file-still-placeholder" style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #2a2a3a, #1a1a2a);">' +
  //'<div style="font-size: 24px; opacity: 0.3;">🎬</div>' +
  //'</div>';
  var progressBarHtml = '<div class="file-progress-container" style="width: 100%; height: 3px; background: rgba(255,255,255,0.2); border-radius: 0 0 12px 12px; overflow: hidden; position: absolute; bottom: 0; left: 0;">' +
    '<div class="file-progress-fill" style="width: 0%; height: 100%; background: #ff8c00; transition: width 0.2s ease;"></div>' +
    '</div>';
  item.innerHTML = '<div class="file-content">' +
    '<button class="play-btn" data-hash="' + hash + '" data-file-id="' + file.id + '" data-episode-index="' + (episodeIndex !== undefined ? episodeIndex : '') + '">▶</button>' +
    '</div>' +
    '<div class="file-info">' +
    '<div class="file-name" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</div>' +
    '<div class="file-size">' + fileSize + '</div>' +
    '</div>' +
    progressBarHtml;
  // Обычная функция вместо стрелочной
  var playBtn = item.querySelector('.play-btn');
  playBtn.onclick = function (e) {
    e.stopPropagation();
    var btn = e.currentTarget;
    var episodeIdx = btn.dataset.episodeIndex ? parseInt(btn.dataset.episodeIndex, 10) : null;
    var playUrl = file.id ?
      AppState.currentTorrserverUrl + '/play/' + hash + '/' + file.id :
      AppState.currentTorrserverUrl + '/play/' + hash + '/1';

    document.getElementById('playback-overlay').classList.add('active');
    document.getElementById('detail-view').style.pointerEvents = 'none';

    startHLSPlayback(playUrl, 0, false, episodeIdx).then(function () {
      document.getElementById('playback-overlay').classList.remove('active');
      document.getElementById('detail-view').style.pointerEvents = 'auto';
    })['catch'](function () {
      document.getElementById('playback-overlay').classList.remove('active');
      document.getElementById('detail-view').style.pointerEvents = 'auto';
    });
  };
  // Сохраняем stillImage для последующей загрузки
  if (stillImage) {
    item.dataset.pendingStill = stillImage;
  }
  // Загружаем прогресс для этого файла
  loadProgressForFileItem(item, hash, file.id, episodeIndex);
  // Если returnOnly === true, просто возвращаем элемент, иначе добавляем в DOM
  if (returnOnly) {
    return item;
  } else {
    var filesList = document.getElementById('files-list');
    if (filesList) {
      filesList.appendChild(item);
    }
    return item;
  }
}
// Функция для загрузки кадров и обновления существующих файлов
async function loadStillsAndUpdateFiles(seasonNumbers, allSeasonEpisodes, movieStill, totalVideoFiles) {
  console.log('loadStillsAndUpdateFiles: начинаем загрузку кадров');
  // Если есть данные о сезонах и кадрах
  if (seasonNumbers.length > 0 && Object.keys(allSeasonEpisodes).length > 0) {
    // Сортируем сезоны по возрастанию
    var sortedSeasons = seasonNumbers.slice().sort(function (a, b) { return a - b; });
    // Собираем все кадры в один массив по порядку
    var allStillsInOrder = [];
    var seasonsLen = sortedSeasons.length;
    for (var s = 0; s < seasonsLen; s++) {
      var seasonNum = sortedSeasons[s];
      var episodes = allSeasonEpisodes[seasonNum] || [];
      episodes.sort(function (a, b) { return (a.episodeNumber || 0) - (b.episodeNumber || 0); });

      var epLen = episodes.length;
      for (var e = 0; e < epLen; e++) {
        if (episodes[e].stillPath) {
          allStillsInOrder.push({
            season: seasonNum,
            episode: episodes[e].episodeNumber,
            stillPath: episodes[e].stillPath
          });
        }
      }
    }

    console.log('Найдено кадров для обновления:', allStillsInOrder.length);

    // Обновляем каждый файл соответствующей картинкой
    var fileItems = document.querySelectorAll('.file-item');
    var itemsLen = Math.min(fileItems.length, allStillsInOrder.length);
    for (var i = 0; i < itemsLen; i++) {
      var fileItem = fileItems[i];
      var stillData = allStillsInOrder[i];
      var stillUrl = AppState.protocol + '//tsimg.hnar.online/t/p/w300' + stillData.stillPath;

      // Обновляем с задержкой для плавности
      (function (item, url, index) {
        setTimeout(function () {
          updateFileItemStill(item, url);
        }, index * 30);
      })(fileItem, stillUrl, i);
    }
  }
  // Если это фильм с постером
  else if (totalVideoFiles === 1 && movieStill) {
    var fileItem = document.querySelector('.file-item');
    if (fileItem) {
      setTimeout(function () {
        updateFileItemStill(fileItem, movieStill);
      }, 100);
    }
  }
}
async function loadPendingStills() {
  var fileItems = document.querySelectorAll('.file-item');
  var itemsLen = fileItems.length;
  for (var i = 0; i < itemsLen; i++) {
    var item = fileItems[i];
    var stillImage = item.dataset.pendingStill;
    if (stillImage && !item.querySelector('.file-still-container')) {
      (function (fileItem, imgUrl) {
        setTimeout(function () {
          // Создаем контейнер для кадра
          var stillContainer = document.createElement('div');
          stillContainer.className = 'file-still-container';
          var img = document.createElement('img');
          img.src = imgUrl;
          img.onerror = function () { this.parentElement.style.display = 'none'; };
          stillContainer.appendChild(img);

          var overlay = document.createElement('div');
          overlay.className = 'file-overlay';

          // Удаляем плейсхолдер
          var placeholder = fileItem.querySelector('.file-still-placeholder');
          if (placeholder) {
            placeholder.remove();
          }

          // Вставляем в начало файл-айтема
          fileItem.insertBefore(stillContainer, fileItem.firstChild);
          fileItem.insertBefore(overlay, stillContainer.nextSibling);

          // Добавляем анимацию появления
          stillContainer.style.opacity = '0';
          stillContainer.style.transition = 'opacity 0.3s ease';
          setTimeout(function () { stillContainer.style.opacity = '1'; }, 10);

          // Удаляем data-атрибут после использования
          delete fileItem.dataset.pendingStill;
        }, i * 50); // Небольшая задержка между загрузками
      })(item, stillImage);
    }
  }
}
// Загрузка прогресса для конкретного file-item
async function loadProgressForFileItem(item, hash, fileId, episodeIndex) {
  if (!item || !hash) return;
  // Создаем ключ для кэша (такой же как в loadProgressForTorrent)
  var cacheKey = hash;
  // Проверяем кэш прогресса
  if (progressCache.has(cacheKey)) {
    var cached = progressCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < 60000)) { // Кэш на 1 минуту
      var cachedProgress = cached.data;
      // Ищем данные для конкретного файла
      var fileProgress = null;
      if (cachedProgress.isSeries && cachedProgress.fileId == fileId) {
        fileProgress = cachedProgress;
      } else if (!cachedProgress.isSeries && fileId === '1') {
        fileProgress = cachedProgress;
      }

      // Если нашли данные в кэше, отображаем их
      if (fileProgress && fileProgress.timecode > 0 && fileProgress.duration && fileProgress.duration > 0) {
        var progressPercent = (fileProgress.timecode / fileProgress.duration) * 100;
        progressPercent = Math.min(progressPercent, 98);

        var progressFill = item.querySelector('.file-progress-fill');
        if (progressFill) {
          progressFill.style.width = progressPercent + '%';
          if (progressPercent > 5) {
            progressFill.style.opacity = '1';
            item.classList.add('has-progress');
          }
        }

        item.dataset.progressTimecode = fileProgress.timecode;
        item.dataset.progressDuration = fileProgress.duration;

        console.log('📦 Используем кэш для прогресса файла:', cacheKey, 'fileId:', fileId);
        return;
      }
    }
  }
  // Если в кэше нет, загружаем с сервера
  try {
    var savedClientId = localStorage.getItem('clientId');
    var response = await fetch(SERVER_URL + '/api/timecode/get?hash=' + hash + '&fileId=' + fileId + '&clientId=' + encodeURIComponent(savedClientId));
    if (response.ok) {
      var data = await response.json();
      if (data.success && data.timecode > 0 && data.duration && data.duration > 0) {
        var progressPercent = (data.timecode / data.duration) * 100;
        progressPercent = Math.min(progressPercent, 98);

        var progressFill = item.querySelector('.file-progress-fill');
        if (progressFill) {
          progressFill.style.width = progressPercent + '%';
          if (progressPercent > 5) {
            progressFill.style.opacity = '1';
            item.classList.add('has-progress');
          }
        }

        item.dataset.progressTimecode = data.timecode;
        item.dataset.progressDuration = data.duration;

        // Сохраняем в кэш (если нет общих данных, сохраняем для этого файла)
        if (!progressCache.has(cacheKey)) {
          var progress = {
            hash: hash,
            fileId: fileId,
            timecode: data.timecode,
            duration: data.duration,
            episodeIndex: episodeIndex || 0,
            isSeries: episodeIndex !== undefined && episodeIndex !== null
          };

          progressCache.set(cacheKey, {
            data: progress,
            timestamp: Date.now()
          });
        }

        console.log('💾 Сохранено в кэш прогресса:', cacheKey, 'fileId:', fileId);
      }
    }
  } catch (error) {
    console.error('Ошибка загрузки прогресса для файла:', error);
  }
}
// Добавить элемент фильма
function addMovieItem(torrent) {
  var filesList = document.getElementById('files-list');
  filesList.innerHTML = '';
  var item = document.createElement('div');
  item.className = 'file-item';
  item.innerHTML = '\n     <div class="file-name">\n       <div>' + escapeHtml(torrent.title || 'Фильм') + '</div>\n       <div style="font-size: 12px; color: #888; margin-top: 4px;">' + formatBytes(torrent.torrent_size) + '</div>\n     </div>\n     <button class="play-btn" data-hash="' + torrent.hash + '">▶</button>\n  ';
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
  var searchUrl = AppState.protocol + '//jac.red/api/v1.0/torrents?search=' + encodedQuery + '&apikey=null&exact=true';
  showLoading('Поиск...');
  try {
    var response = await fetch(searchUrl);
    if (!response.ok) throw new Error('Ошибка поиска');
    var data = await response.json();
    searchResults = (Array.isArray(data) ? data : []);
    var resultsLen = searchResults.length;
    for (var i = 0; i < resultsLen; i++) {
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
  var resultsLen = searchResults.length;
  for (var i = 0; i < resultsLen; i++) {
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
    yearFilter.innerHTML = '<option value="all">Все</option>';

    var yearsLen = availableYears.length;
    for (var j = 0; j < yearsLen; j++) {
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
  var resultsLen = searchResults.length;
  for (var i = 0; i < resultsLen; i++) {
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
  var trackersLen = availableTrackers.length;
  for (var j = 0; j < trackersLen; j++) {
    if (availableTrackers[j] === currentTrackerFilter) {
      trackerFilterAll = true;
      break;
    }
  }
  if (!trackerFilterAll) {
    currentTrackerFilter = 'all';
  }
  syncSearchFilterButtons();
  updateAvailableSeasons();
  updateAvailableVoices();
  updateAvailableVideotype();
}
// Применение фильтров и сортировки
function applyFiltersAndSort() {
  filteredResults = [];
  var resultsLen = searchResults.length;
  for (var i = 0; i < resultsLen; i++) {
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
    // По сезону
    if (shouldInclude && currentSeasonFilter && currentSeasonFilter !== 'all') {
      var seasonNum = parseInt(currentSeasonFilter, 10);
      var hasSeason = item.seasons && Array.isArray(item.seasons) && item.seasons.indexOf(seasonNum) !== -1;
      if (!hasSeason) shouldInclude = false;
    }

    // По озвучке
    if (shouldInclude && currentVoiceFilter && currentVoiceFilter !== 'all') {
      var hasVoice = item.voices && Array.isArray(item.voices) && item.voices.indexOf(currentVoiceFilter) !== -1;
      if (!hasVoice) shouldInclude = false;
    }

    // По типу
    if (shouldInclude && currentvideotypeFilter && currentvideotypeFilter !== 'all') {
      var hasvideotype = item.videotype == currentvideotypeFilter;
      if (!hasvideotype) shouldInclude = false;
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
// Обновление списка доступных сезонов
function updateAvailableSeasons() {
  var seasonSet = {};
  var seasonFilter = document.getElementById('filter-season');
  if (!seasonFilter) return;
  // Собираем все уникальные сезоны из результатов поиска
  var resultsLen = searchResults.length;
  for (var i = 0; i < resultsLen; i++) {
    var result = searchResults[i];
    if (result.seasons && Array.isArray(result.seasons)) {
      var seasonsLen = result.seasons.length;
      for (var j = 0; j < seasonsLen; j++) {
        seasonSet[result.seasons[j]] = true;
      }
    }
  }
  // Получаем сезоны и сортируем по возрастанию
  availableSeasons = Object.keys(seasonSet).map(Number).sort(function (a, b) {
    return a - b;
  });
  // Обновляем select с сезонами
  var currentSeason = seasonFilter.value;
  seasonFilter.innerHTML = '<option value="all">Все</option>';
  var seasonsLen = availableSeasons.length;
  for (var j = 0; j < seasonsLen; j++) {
    var season = availableSeasons[j];
    var selected = (currentSeason !== 'all' && String(season) === currentSeason) ? 'selected' : '';
    seasonFilter.innerHTML += '<option value="' + season + '" ' + selected + '>' + season + ' сезон</option>';
  }
  // Если текущий сезон не найден в новом списке, сбрасываем на "Все сезоны"
  if (currentSeason !== 'all' && !seasonSet[parseInt(currentSeason)]) {
    seasonFilter.value = 'all';
    currentSeasonFilter = 'all';
  }
}
// Обновление списка доступных озвучек
function updateAvailableVoices() {
  var voiceSet = {};
  var voiceFilter = document.getElementById('filter-voice');
  if (!voiceFilter) return;
  // Собираем все уникальные озвучки из результатов поиска
  var resultsLen = searchResults.length;
  for (var i = 0; i < resultsLen; i++) {
    var result = searchResults[i];
    if (result.voices && Array.isArray(result.voices)) {
      var voicesLen = result.voices.length;
      for (var j = 0; j < voicesLen; j++) {
        var voice = result.voices[j];
        if (voice && voice.trim()) {
          voiceSet[voice.trim()] = true;
        }
      }
    }
  }
  // Получаем озвучки и сортируем по алфавиту
  availableVoices = Object.keys(voiceSet).sort();
  // Обновляем select с озвучками
  var currentVoice = voiceFilter.value;
  voiceFilter.innerHTML = '<option value="all">Все</option>';
  var voicesLen = availableVoices.length;
  for (var j = 0; j < voicesLen; j++) {
    var voice = availableVoices[j];
    var selected = (currentVoice !== 'all' && voice === currentVoice) ? 'selected' : '';
    voiceFilter.innerHTML += '<option value="' + escapeHtml(voice) + '" ' + selected + '>' + escapeHtml(voice) + '</option>';
  }
  // Если текущая озвучка не найдена в новом списке, сбрасываем на "Все озвучки"
  if (currentVoice !== 'all' && !voiceSet[currentVoice]) {
    voiceFilter.value = 'all';
    currentVoiceFilter = 'all';
  }
}
// Обновление списка доступных типов видео
function updateAvailableVideotype() {
  var videotypeSet = {};
  var videotypeFilter = document.getElementById('filter-videotype');
  if (!videotypeFilter) return;
  // Собираем все уникальные типы из результатов поиска
  var resultsLen = searchResults.length;
  for (var i = 0; i < resultsLen; i++) {
    var result = searchResults[i];
    if (result.videotype) {
      var videotype = result.videotype;
      if (videotype && videotype.trim()) {
        videotypeSet[videotype.trim()] = true;
      }
    }
  }
  // Получаем типы и сортируем по алфавиту
  availablevideotype = Object.keys(videotypeSet).sort();
  // Обновляем select с типами
  var currentvideotype = videotypeFilter.value;
  videotypeFilter.innerHTML = '<option value="all">Все</option>';
  var vtLen = availablevideotype.length;
  for (var j = 0; j < vtLen; j++) {
    var videotype = availablevideotype[j];
    var selected = (currentvideotype !== 'all' && videotype === currentvideotype) ? 'selected' : '';
    videotypeFilter.innerHTML += '<option value="' + escapeHtml(videotype) + '" ' + selected + '>' + escapeHtml(videotype) + '</option>';
  }
  // Если текущая озвучка не найдена в новом списке, сбрасываем на "Все озвучки"
  if (currentvideotype !== 'all' && !videotypeSet[currentvideotype]) {
    videotypeFilter.value = 'all';
    currentvideotypeFilter = 'all';
  }
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
  document.getElementById('torrserver-section').style.display = 'none';
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

      var focusLen = focusableElements.length;
      for (var i = 0; i < focusLen; i++) {
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
  var returnTo = AppState.searchReturnTo || AppState.inSearch;
  document.getElementById('torrserver-section').style.display = 'block';
  searchOverlay.classList.add('hidden');
  searchTab.classList.remove('active');
  document.getElementById('search-results').innerHTML = '';
  toggleSearchFiltersPanel(false);
  // Обработка возврата в зависимости от режима
  if (returnTo === 'detail') {
    // Возврат в детальный просмотр
    AppState.currentScreen = 'detail';
    var mainContainer = document.getElementById('main-container');
    if (mainContainer && AppState.backupScroll > 0) {
      mainContainer.scrollTop = AppState.backupScroll;
    }
    // Скрываем вкладки каталога/торрентов
    if (catalogTab) catalogTab.classList.remove('active');
    torrentsTab.classList.remove('active');

    // Показываем детальный просмотр, если он скрыт
    var detailView = document.getElementById('detail-view');
    if (detailView && detailView.style.display !== 'block') {
      detailView.style.display = 'block';
      detailView.style.zIndex = '100';
      detailView.style.pointerEvents = 'auto';
    }

    // Восстанавливаем детальный просмотр
    //if (AppState.pendingDetailItem) {
    //console.log('Возврат к детальному просмотру:',
    //AppState.pendingDetailItem.torrent && AppState.pendingDetailItem.torrent[0] && AppState.pendingDetailItem.torrent[0].name || 'Фильм');

    //showCatalogDetail(
    //AppState.pendingDetailItem,
    //AppState.pendingDetailIndex || 0,
    //AppState.pendingDetailPoster
    //);

    // Очищаем сохраненные данные
    //AppState.pendingDetailItem = null;
    //AppState.pendingDetailPoster = null;
    //AppState.pendingDetailIndex = null;
    //} else if (AppState.currentDetailItem) {
    // Если есть текущий элемент детального просмотра
    //showCatalogDetail(
    //AppState.currentDetailItem,
    //catalogState.lastSelectedIndex || 0,
    //null
    //);
    //}

    // Устанавливаем фокус на кнопку просмотра
    setTimeout(function () {
      if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
        updateFocusableElements();
        var watchBtn = document.getElementById('catalog-watch-btn');
        if (watchBtn) {
          var watchIndex = -1;
          var focusLen = focusableElements.length;
          for (var i = 0; i < focusLen; i++) {
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
        var focusLen = focusableElements.length;
        for (var i = 0; i < focusLen; i++) {
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
  currentSeasonFilter = 'all';
  currentVoiceFilter = 'all';
  currentvideotypeFilter = 'all';
  syncSearchFilterButtons();
  var filterYear = document.getElementById('filter-year');
  if (filterYear) {
    filterYear.value = 'all';
  }
  // Сбрасываем фильтр сезона
  var filterSeason = document.getElementById('filter-season');
  if (filterSeason) {
    filterSeason.value = 'all';
  }
  // Сбрасываем фильтр озвучки
  var filterVoice = document.getElementById('filter-voice');
  if (filterVoice) {
    filterVoice.value = 'all';
  }
  // Сбрасываем фильтр по типу
  var filtervideotype = document.getElementById('filter-videotype');
  if (filtervideotype) {
    filtervideotype.value = 'all';
  }
  applyFiltersAndSort();
}
function initYearFilter() {
  var yearFilter = document.getElementById('filter-year');
  if (yearFilter) {
    yearFilter.addEventListener('change', function (e) {
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
// сброс торрента в TorrServer
async function dropTorrentToServer(hash) {
  if (!AppState.currentTorrserverUrl) {
    alert('Сначала подключитесь к TorrServer');
    return null;
  }
  try {
    var requestBody = {
      action: 'drop',
      hash: hash
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

    if (!response.ok) {
      throw new Error('Ошибка остановки: ' + response.status);
    }

    return true;
  } catch (error) {
    console.error('Ошибка остановки торрента:', error);
    throw error;
  }
}
// Добавление торрента в TorrServer из поиска
async function addTorrentSearchToServer(magnet, hash, searchResult) {
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
    var torrname = '';
    if (AppState.mediaType == 'tv') {
      if (searchResult.seasons && searchResult.seasons.length > 0) {
        torrname = '[' + catalogState.lastSelectedId + '] ' + searchResult.name + ' [сезон ' + searchResult.seasons[0] + ']';
      } else {
        // обработка случая, когда массив пустой или отсутствует
        torrname = '[' + catalogState.lastSelectedId + '] ' + searchResult.name;
      }
    } else {
      torrname = '[' + catalogState.lastSelectedId + '] ' + searchResult.name;
    }

    var requestBody = {
      action: 'add',
      link: magnet,
      title: torrname, //+' S['+searchResult.seasons[0]+']',
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

    var addedTorrent = true;

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
    var torrname = '';
    if (AppState.mediaType == 'tv') {
      if (searchResult.seasons && searchResult.seasons.length > 0) {
        torrname = '[' + catalogState.lastSelectedId + '] ' + searchResult.name + ' [сезон ' + searchResult.seasons[0] + ']';
      } else {
        // обработка случая, когда массив пустой или отсутствует
        torrname = '[' + catalogState.lastSelectedId + '] ' + searchResult.name;
      }
    } else {
      torrname = '[' + catalogState.lastSelectedId + '] ' + searchResult.name;
    }

    var requestBody = {
      action: 'add',
      link: magnet,
      title: torrname, //+' S['+searchResult.seasons[0]+']',
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
    var torrentsLen = AppState.torrents.length;
    for (var i = 0; i < torrentsLen; i++) {
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
            var focusLen = focusableElements.length;
            for (var i = 0; i < focusLen; i++) {
              if (focusableElements[i].classList && focusableElements[i].classList.contains('torrent-card') && preserveHash && focusableElements[i].dataset.hash === preserveHash) {
                targetIndex = i;
                break;
              }
            }
            if (targetIndex === -1) {
              var cards = [];
              for (var j = 0; j < focusLen; j++) {
                if (focusableElements[j].classList && focusableElements[j].classList.contains('torrent-card')) {
                  cards.push(focusableElements[j]);
                }
              }
              if (cards[preserveIndex]) {
                for (var k = 0; k < focusLen; k++) {
                  if (focusableElements[k] === cards[preserveIndex]) {
                    targetIndex = k;
                    break;
                  }
                }
              }
            }
            if (targetIndex === -1) {
              for (var l = 0; l < focusLen; l++) {
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
  if (window.addToWatchHistory && AppState.pendingDetailItem.id) {
    await window.addToWatchHistory(
      String(AppState.pendingDetailItem.id),
      currentSearchQuery,
      AppState.pendingDetailItem.media_type,
      AppState.pendingDetailPoster || null
    );
  }
  document.getElementById('playback-overlay').classList.add('active');
  document.querySelector('.playback-text').textContent = 'Поиск постера и добавление...';
  try {
    // Проверяем, является ли контент сериалом
    var isSerial = false;
    // Сначала проверяем AppState.mediaType
    if (AppState.mediaType === "tv") {
      isSerial = true;
    }
    // Если нет, проверяем searchResult.types
    else if (searchResult && searchResult.types &&
      Array.isArray(searchResult.types) &&
      searchResult.types.includes('serial')) {
      isSerial = true;
    }
    var addedTorrent = await addTorrentToServer(magnet, hash, searchResult);

    hideSearchResults();

    if (!addedTorrent) {
      await refreshTorrentsList();
      addedTorrent = null;
      var torrentsLen = AppState.torrents.length;
      for (var i = 0; i < torrentsLen; i++) {
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

      document.querySelector('.playback-text').textContent = 'Воспроизведение...';

      var playUrl = AppState.currentTorrserverUrl + '/play/' + hash + '/' + fileId;
      console.log('URL воспроизведения:', playUrl, 'isSeries:', playbackTarget.isSeries, 'episodeIndex:', playbackTarget.episodeIndex);

      await startHLSPlayback(playUrl, null, true, playbackTarget.episodeIndex);
    } else {
      await new Promise(resolve => setTimeout(resolve, 3000));
      AppState.inSearch = "torrents";
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
  availableSeasons = [];
  availableVoices = [];
  currentTrackerFilter = 'all';
  currentSeasonFilter = 'all';
  currentVoiceFilter = 'all';
  currentvideotypeFilter = 'all';
  syncSearchFilterButtons();
}
// Рендеринг результатов поиска
function renderSearchResults() {
  var searchResultsDiv = document.getElementById('search-results');
  if (!searchResultsDiv) return;
  if (filteredResults.length === 0) {
    var totalResults = searchResults.length;
    searchResultsDiv.innerHTML = '\n       <div class="filter-stats">Всего найдено:<span>' + totalResults + '</span></div>\n       <div class="search-result-empty">\n        ' + (currentSearchQuery ? 'Нет результатов по фильтрам для "' + escapeHtml(currentSearchQuery) + '"' : 'Введите запрос для поиска') + '\n       </div>\n    ';
    return;
  }
  var html = '<div class="filter-stats">Показано:<span>' + filteredResults.length + '</span>из <span>' + searchResults.length + '</span></div>';
  var resultsLen = filteredResults.length;
  for (var idx = 0; idx < resultsLen; idx++) {
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

    html += '\n       <div class="search-result-item" data-index="' + idx + '">\n         <div class="search-result-info">\n           <div class="search-result-title">' + escapeHtml(result.title || result.name || 'Без названия') + '</div>\n          \n           <div class="search-result-meta">\n             <div class="search-result-meta-item">\n              ' + escapeHtml(trackerDisplay) + '\n             </div>\n             <div class="search-result-meta-item">\n              ' + escapeHtml(size) + '\n             </div>\n             <div class="search-result-meta-item">\n              ' + year + ' (' + date + ')\n             </div>\n             <div class="search-result-meta-item">\n              ' + type + ' / ' + quality + 'p\n             </div>\n             <div class="search-result-meta-item">\n              сиды: ' + sid + '\n             </div>\n             <div class="search-result-meta-item">\n              пиры: ' + pir + '\n             </div>\n           </div>\n          \n          ' + (voices.length > 0 ? '\n             <div class="search-result-voices">\n              ' + (function () {
      var voicesHtml = '';
      var voicesLen = voices.length;
      for (var v = 0; v < voicesLen; v++) {
        voicesHtml += '<span class="search-result-voice">' + escapeHtml(voices[v]) + '</span>';
      }
      return voicesHtml;
    })() + '\n             </div>\n          ' : '') + '\n         </div>\n        \n         <button class="search-result-play"\n                data-hash="' + hash + '"\n                data-magnet="' + escapeHtml(result.magnet) + '"\n                data-result="' + resultJsonEncoded + '"\n                ' + (!hash ? 'disabled' : '') + '>\n          ' + (hash ? '▶' : '❌ Нет hash') + '\n         </button>\n       </div>\n    ';
  }
  searchResultsDiv.innerHTML = html;
  // Добавляем обработчики для кнопок PLAY
  var resultItems = searchResultsDiv.querySelectorAll('.search-result-item');
  var itemsLen = resultItems.length;
  for (var i = 0; i < itemsLen; i++) {
    (function (item) {
      item.addEventListener('click', function () {
        var playBtn = item.querySelector('.search-result-play');
        if (playBtn) playBtn.click();
      });
    })(resultItems[i]);
  }
  var playButtons = searchResultsDiv.querySelectorAll('.search-result-play');
  var btnsLen = playButtons.length;
  for (var j = 0; j < btnsLen; j++) {
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
        var moviesLen = moviesData.results.length;
        for (var i = 0; i < moviesLen; i++) {
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
        var tvLen = tvData.results.length;
        for (var j = 0; j < tvLen; j++) {
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
    searchResultsDiv.innerHTML = '\n             <div class="filter-stats">Всего найдено:<span>0</span></div>\n             <div class="search-result-empty">\n                ' + (currentSearchQuery ? 'Ничего не найдено для "' + escapeHtml(currentSearchQuery) + '" в TMDB' : 'Введите запрос для поиска') + '\n             </div>\n        ';
    return;
  }
  var gridTemplateColumns = 'repeat(6, 1fr)';
  var html = '<div class="filter-stats">Найдено в TMDB:<span>' + globalSearchResults.length + '</span></div>';
  html += '<div class="global-search-grid" style="display: grid; grid-template-columns: ' + gridTemplateColumns + '; gap: 20px; padding: 20px 0;">';
  var resultsLen = globalSearchResults.length;
  for (var idx = 0; idx < resultsLen; idx++) {
    var result = globalSearchResults[idx];
    var title = result.title || result.name || 'Без названия';
    var year = result.release_date || result.first_air_date;
    var yearStr = year ? new Date(year).getFullYear() : 'N/A';
    var mediaType = result.media_type === 'tv' ? 'Сериал' : 'Фильм';
    var rating = result.vote_average ? result.vote_average.toFixed(1) : null;
    var posterUrl = result.poster_path
      ? AppState.protocol + '//tsimg.hnar.online/t/p/w342' + result.poster_path
      : null;
    html += '\n             <div class="global-search-card" data-index="' + idx + '" data-tmdb-id="' + result.id + '" data-media-type="' + result.media_type + '" style="\n                background: rgba(30, 30, 40, 0.9);\n                border-radius: 12px;\n                overflow: hidden;\n                cursor: pointer;\n                border: 1px solid rgba(74, 158, 255, 0.3);\n             ">\n                 <div class="global-search-poster" style="\n                    position: relative;\n                    aspect-ratio: 2/3;\n                    overflow: hidden;\n                    background: linear-gradient(135deg, #1a1a2e, #16213e);\n                 ">\n                    ' + (posterUrl ? '\n                         <img src="' + posterUrl + '" alt="' + escapeHtml(title) + '" style="\n                            width: 100%;\n                            height: 100%;\n                            object-fit: cover;\n                         " onerror="this.parentElement.innerHTML=\'<div style=\\\'display: flex; align-items: center; justify-content: center; height: 100%; font-size: 48px;\\\'> </div>\'">\n                    ' : '\n                         <div style="display: flex; align-items: center; justify-content: center; height: 100%; font-size: 48px;">\n                            ' + (mediaType === 'Сериал' ? 'Сериал' : 'Фильм') + '\n                         </div>\n                    ') + '\n                    ' + (rating ? '\n                         <div style="\n                            position: absolute;\n                            top: 8px;\n                            right: 8px;\n                            background: rgba(0, 0, 0, 0.8);\n                            color: ' + getRatingColor(parseFloat(rating)) + ';\n                            font-weight: bold;\n                            font-size: 12px;\n                            padding: 4px 8px;\n                            border-radius: 12px;\n                            border: 1px solid ' + getRatingColor(parseFloat(rating)) + ';\n                         ">\n                            ' + rating + '\n                         </div>\n                    ' : '') + '\n                 </div>\n                 <div class="global-search-info" style="padding: 12px;">\n                     <div class="global-search-title" style="\n                        font-weight: 600;\n                        font-size: 14px;\n                        margin-bottom: 6px;\n                        overflow: hidden;\n                        text-overflow: ellipsis;\n                        white-space: nowrap;\n                     ">' + escapeHtml(title) + '</div>\n                     <div style="\n                        display: flex;\n                        justify-content: space-between;\n                        font-size: 12px;\n                        color: #aaa;\n                     ">\n                         <span>' + mediaType + '</span>\n                         <span>' + yearStr + '</span>\n                     </div>\n                 </div>\n             </div>\n        ';
  }
  html += '</div>';
  searchResultsDiv.innerHTML = html;
  // Добавляем обработчики кликов на карточки
  var cards = document.querySelectorAll('.global-search-card');
  var cardsLen = cards.length;
  for (var i = 0; i < cardsLen; i++) {
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
    searchResultsDiv.innerHTML = '\n             <div class="filter-stats">Всего найдено:<span>0</span></div>\n             <div class="search-result-empty">\n                Нет результатов для выбранного типа контента\n             </div>\n        ';
    return;
  }
  var gridTemplateColumns = 'repeat(6, 1fr)';
  var html = '<div class="filter-stats">Найдено в TMDB:<span>' + results.length + '</span></div>';
  html += '<div class="global-search-grid" style="display: grid; grid-template-columns: ' + gridTemplateColumns + '; gap: 20px; padding: 20px 0;">';
  var resultsLen = results.length;
  for (var idx = 0; idx < resultsLen; idx++) {
    var result = results[idx];
    var title = result.title || result.name || 'Без названия';
    var year = result.release_date || result.first_air_date;
    var yearStr = year ? new Date(year).getFullYear() : 'N/A';
    var mediaType = result.media_type === 'tv' ? 'Сериал' : 'Фильм';
    var rating = result.vote_average ? result.vote_average.toFixed(1) : null;
    var posterUrl = result.poster_path
      ? AppState.protocol + '//tsimg.hnar.online/t/p/w342' + result.poster_path
      : null;
    html += '\n             <div class="global-search-card" data-tmdb-id="' + result.id + '" data-media-type="' + result.media_type + '" style="\n                background: rgba(30, 30, 40, 0.9);\n                border-radius: 12px;\n                overflow: hidden;\n                cursor: pointer;\n                border: 1px solid rgba(74, 158, 255, 0.3);\n             ">\n                 <div class="global-search-poster" style="\n                    position: relative;\n                    aspect-ratio: 2/3;\n                    overflow: hidden;\n                    background: linear-gradient(135deg, #1a1a2e, #16213e);\n                 ">\n                    ' + (posterUrl ? '\n                         <img src="' + posterUrl + '" alt="' + escapeHtml(title) + '" style="\n                            width: 100%;\n                            height: 100%;\n                            object-fit: cover;\n                         " onerror="this.parentElement.innerHTML=\'<div style=\\\'display: flex; align-items: center; justify-content: center; height: 100%; font-size: 48px;\\\'> </div>\'">\n                    ' : '\n                         <div style="display: flex; align-items: center; justify-content: center; height: 100%; font-size: 48px;">\n                            ' + (mediaType === 'Сериал' ? 'Сериал' : 'Фильм') + '\n                         </div>\n                    ') + '\n                    ' + (rating ? '\n                         <div style="\n                            position: absolute;\n                            top: 8px;\n                            right: 8px;\n                            background: rgba(0, 0, 0, 0.8);\n                            color: ' + getRatingColor(parseFloat(rating)) + ';\n                            font-weight: bold;\n                            font-size: 12px;\n                            padding: 4px 8px;\n                            border-radius: 12px;\n                            border: 1px solid ' + getRatingColor(parseFloat(rating)) + ';\n                         ">\n                            ' + rating + '\n                         </div>\n                    ' : '') + '\n                 </div>\n                 <div class="global-search-info" style="padding: 12px;">\n                     <div class="global-search-title" style="\n                        font-weight: 600;\n                        font-size: 14px;\n                        margin-bottom: 6px;\n                        overflow: hidden;\n                        text-overflow: ellipsis;\n                        white-space: nowrap;\n                     ">' + escapeHtml(title) + '</div>\n                     <div style="\n                        display: flex;\n                        justify-content: space-between;\n                        font-size: 12px;\n                        color: #aaa;\n                     ">\n                         <span>' + mediaType + '</span>\n                         <span>' + yearStr + '</span>\n                     </div>\n                 </div>\n             </div>\n        ';
  }
  html += '</div>';
  searchResultsDiv.innerHTML = html;
  // Добавляем обработчики
  var cards = document.querySelectorAll('.global-search-card');
  var cardsLen = cards.length;
  for (var i = 0; i < cardsLen; i++) {
    (function (card) {
      card.addEventListener('click', async function () {
        AppState.isSearch = true;
        var tmdbId = card.dataset.tmdbId;
        var mediaType = card.dataset.mediaType;
        var result = null;
        var resultsLen = results.length;
        for (var j = 0; j < resultsLen; j++) {
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
  AppState.mediaType = item.media_type;
  // Получаем URL постера
  var posterUrl = item.poster_path
    ? AppState.protocol + '//tsimg.hnar.online/t/p/w342' + item.poster_path
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
    newFilter.innerHTML = '\n             <label class="filter-label" for="filter-content-type">Тип контента</label>\n             <select id="filter-content-type" class="filter-select">\n                 <option value="all">Все</option>\n                 <option value="movie">Фильмы</option>\n                 <option value="tv">Сериалы</option>\n             </select>\n        ';
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
    var resultsLen = globalSearchResults.length;
    for (var i = 0; i < resultsLen; i++) {
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
window.addTorrentSearchToServer = addTorrentSearchToServer;
window.playFromHash = playFromHash;
window.refreshTorrentsList = refreshTorrentsList;
window.dropTorrentToServer = dropTorrentToServer;
window.resetDetailBackground = resetDetailBackground;
