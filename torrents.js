// Работа с TorrServer и торрентами

// Переменные для поиска
let searchResults = [];
let filteredResults = [];
let currentSearchQuery = '';

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

// Кэш для хранения информации о прогрессе
let progressCache = new Map();

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
      if (!silent) alert('Сначала подключитесь к серверу');
      return;
    }
  }
  
  if (!silent) {
    showLoading('Загрузка торрентов...');
    torrentsGrid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 40px;">Загрузка...</div>';
  }
  
  try {
    const response = await fetch(`${AppState.currentTorrserverUrl}/torrents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({ action: 'list' })
    });
    
    if (!response.ok) throw new Error('Ошибка загрузки');
    
    const data = await response.json();
    console.log('Полученные данные:', data);
    
    AppState.torrents = Array.isArray(data) ? data : [];
    
    // ВСЕГДА показываем секцию торрентов, даже если список пуст
    document.getElementById('config-screen').style.display = 'none';
    document.getElementById('torrserver-section').style.display = 'block';
    
    // Рендерим список (пустой или с торрентами)
    renderTorrents();
    
  } catch (error) {
    console.error('Ошибка:', error);
    if (!silent) {
      torrentsGrid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #ff6a6a;">Ошибка: ${error.message}</div>`;
    }
  } finally {
    if (!silent) {
      hideLoading();
    }
  }
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
    card.onclick = () => showDetail(torrent);
    
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

// Показать детали торрента
async function showDetail(torrent) {
  AppState.currentDetailItem = torrent;
  const detailView = document.getElementById('detail-view');
  detailView.style.display = 'block';
  
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
  } catch (e) {}
  
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
    
    // Сохраняем текущий торрент перед воспроизведением (для возврата)
    // AppState.currentDetailItem уже должен быть установлен из showDetail()
    
    document.getElementById('playback-overlay').classList.add('active');
    document.getElementById('detail-view').style.pointerEvents = 'none';
    
    startHLSPlayback(playUrl, null, false).then(() => {
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
    
    // Сохраняем текущий торрент перед воспроизведением (для возврата)
    // AppState.currentDetailItem уже должен быть установлен из showDetail()
    
    document.getElementById('playback-overlay').classList.add('active');
    document.getElementById('detail-view').style.pointerEvents = 'none';
    
    startHLSPlayback(playUrl, null, false).then(() => {
      document.getElementById('playback-overlay').classList.remove('active');
      document.getElementById('detail-view').style.pointerEvents = 'auto';
    }).catch(() => {
      document.getElementById('playback-overlay').classList.remove('active');
      document.getElementById('detail-view').style.pointerEvents = 'auto';
    });
  };
  
  filesList.appendChild(item);
}

// Функция поиска торрентов
async function searchTorrents(query) {
  if (!query || query.trim().length < 2) {
    alert('Введите минимум 2 символа для поиска');
    return;
  }
  
  const encodedQuery = encodeURIComponent(query.trim());
  const searchUrl = `https://jac.red/api/v1.0/torrents?search=${encodedQuery}&apikey=null&exact=true`;
  
  showLoading('Поиск...');
  
  try {
    const response = await fetch(searchUrl);
    if (!response.ok) throw new Error('Ошибка поиска');
    
    const data = await response.json();
    searchResults = Array.isArray(data) ? data : [];
    currentSearchQuery = query;
    
    // Собираем уникальные трекеры
    updateAvailableTrackers();
    
    // Применяем фильтры и сортировку
    applyFiltersAndSort();
    
    // Показываем результаты
    showSearchResults();
    
  } catch (error) {
    console.error('Ошибка поиска:', error);
    alert('Ошибка при поиске: ' + error.message);
  } finally {
    hideLoading();
  }
}

// Обновление списка доступных трекеров
function updateAvailableTrackers() {
  const trackerSet = new Set();
  searchResults.forEach(result => {
    if (result.tracker) {
      trackerSet.add(result.tracker.toLowerCase());
    }
  });
  
  availableTrackers = Array.from(trackerSet).sort();
  
  // Обновляем выпадающий список трекеров
  const trackerSelect = document.getElementById('filter-tracker');
  if (trackerSelect) {
    const currentValue = trackerSelect.value;
    trackerSelect.innerHTML = '<option value="all">📁 Все трекеры</option>';
    
    availableTrackers.forEach(tracker => {
      const displayName = tracker.charAt(0).toUpperCase() + tracker.slice(1);
      trackerSelect.innerHTML += `<option value="${tracker}">${displayName}</option>`;
    });
    
    trackerSelect.innerHTML += '<option value="other">📁 Другие</option>';
    trackerSelect.value = currentValue;
  }
}

// Применение фильтров и сортировки
function applyFiltersAndSort() {
  // Фильтрация
  filteredResults = searchResults.filter(item => {
    // Фильтр по качеству
    if (currentQualityFilter !== 'all') {
      const quality = parseInt(currentQualityFilter);
      if (item.quality !== quality) return false;
    }
    
    // Фильтр по трекеру
    if (currentTrackerFilter !== 'all') {
      const tracker = (item.tracker || '').toLowerCase();
      if (currentTrackerFilter === 'other') {
        // "Другие" - это трекеры, которых нет в списке availableTrackers
        if (availableTrackers.includes(tracker)) {
          return false;
        }
      } else if (tracker !== currentTrackerFilter) {
        return false;
      }
    }
    
    // Фильтр по году
    if (currentYearFilter) {
      const year = parseInt(currentYearFilter);
      if (item.relased !== year) return false;
    }
    
    return true;
  });
  
  // Сортировка
  filteredResults.sort((a, b) => {
    switch(currentSort) {
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
function showSearchResults() {
  const searchOverlay = document.getElementById('search-overlay');
  const searchTab = document.getElementById('tab-search');
  const torrentsTab = document.getElementById('tab-torrents');
  
  if (!searchOverlay || !searchTab || !torrentsTab) return;
  
  // Показываем оверлей
  searchOverlay.classList.remove('hidden');
  
  // Обновляем активную вкладку
  searchTab.classList.add('active');
  torrentsTab.classList.remove('active');
}

// Скрытие результатов поиска
function hideSearchResults() {
  const searchOverlay = document.getElementById('search-overlay');
  const searchTab = document.getElementById('tab-search');
  const torrentsTab = document.getElementById('tab-torrents');
  
  if (!searchOverlay || !searchTab || !torrentsTab) return;
  
  // Скрываем оверлей
  searchOverlay.classList.add('hidden');
  
  // Обновляем активную вкладку
  searchTab.classList.remove('active');
  torrentsTab.classList.add('active');
}

// Сброс всех фильтров
function resetFilters() {
  currentSort = 'date-desc';
  currentQualityFilter = 'all';
  currentTrackerFilter = 'all';
  currentYearFilter = '';
  
  // Обновляем UI
  document.getElementById('sort-by').value = currentSort;
  document.getElementById('filter-quality').value = currentQualityFilter;
  document.getElementById('filter-tracker').value = currentTrackerFilter;
  document.getElementById('filter-year').value = '';
  
  applyFiltersAndSort();
}

// Добавление торрента в TorrServer
async function addTorrentToServer(magnet, hash) {
  if (!AppState.currentTorrserverUrl) {
    alert('Сначала подключитесь к TorrServer');
    return null;
  }
  
  try {
    console.log('➕ Добавление торрента в TorrServer:', magnet);
    
    const response = await fetch(`${AppState.currentTorrserverUrl}/torrents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({
        action: 'add',
        link: magnet,
        save_to_db: true
      })
    });
    
    if (!response.ok) {
      throw new Error(`Ошибка добавления: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('✅ Торрент добавлен:', data);
    
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
    return null;
  }
}

// Обновление списка торрентов
async function refreshTorrentsList() {
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
      return true;
    }
  } catch (error) {
    console.error('Ошибка обновления списка:', error);
  }
  return false;
}

// Воспроизведение по hash
async function playFromHash(hash, magnet) {
  if (!hash) {
    alert('Ошибка: hash не найден');
    return;
  }
  
  if (!AppState.currentTorrserverUrl) {
    alert('Сначала подключитесь к TorrServer');
    return;
  }
  
  // Показываем оверлей загрузки
  document.getElementById('playback-overlay').classList.add('active');
  document.querySelector('.playback-text').textContent = 'Добавление торрента...';
  
  try {
    // Добавляем торрент в TorrServer
    const addedTorrent = await addTorrentToServer(magnet, hash);
    
    // Скрываем результаты поиска
    hideSearchResults();
    
    // Сохраняем информацию о торренте для серий
    if (addedTorrent) {
      AppState.currentDetailItem = addedTorrent;
    }
    
    // Извлекаем fileId из magnet или используем 1 по умолчанию
    const fileId = 1; // По умолчанию первая серия/файл
    
    // Формируем URL для воспроизведения
    document.querySelector('.playback-text').textContent = 'Воспроизведение...';
    const playUrl = `${AppState.currentTorrserverUrl}/play/${hash}/${fileId}`;
    console.log('🎬 Воспроизведение по hash:', hash);
    console.log('🔗 URL:', playUrl);
    
    // Запускаем воспроизведение с флагом "из поиска"
    await startHLSPlayback(playUrl, null, true);
    
  } catch (error) {
    console.error('Ошибка воспроизведения:', error);
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
  
  // Обновляем выпадающий список трекеров
  const trackerSelect = document.getElementById('filter-tracker');
  if (trackerSelect) {
    trackerSelect.innerHTML = '<option value="all">📁 Все трекеры</option>';
    trackerSelect.innerHTML += '<option value="other">📁 Другие</option>';
  }
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
    const year = result.relased || 'N/A';
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
        
        <button class="search-result-play" data-hash="${hash}" data-magnet="${escapeHtml(result.magnet)}" ${!hash ? 'disabled' : ''}>
          ${hash ? '▶ PLAY' : '❌ Нет hash'}
        </button>
      </div>
    `;
  });
  
  searchResultsDiv.innerHTML = html;
  
  // Добавляем обработчики для кнопок PLAY
  searchResultsDiv.querySelectorAll('.search-result-play').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const hash = btn.dataset.hash;
      const magnet = btn.dataset.magnet;
      
      if (hash) {
        playFromHash(hash, magnet);
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