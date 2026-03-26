// Функции плеера

// Переменные для хранения информации о сериях
let currentEpisodeFiles = [];
let currentEpisodeIndex = 0;
let currentTorrentHash = null;
let lastCleanedSegment = -1;
let nearEndCheckInterval = null;

// Переменные для таймкода
let timecodeSaveInterval = null;
let currentTimecodeData = {
  hash: null,
  fileId: null,
  timecode: 0,
  duration: 0
};

// Переменные для скрытия элементов
let mouseIdleTimer = null;
const IDLE_TIMEOUT = 3000; // 3 секунды

// Скрываем кнопку серий по умолчанию
document.addEventListener('DOMContentLoaded', () => {
  const episodesBtn = document.getElementById('episodes-btn');
  if (episodesBtn) {
    episodesBtn.style.display = 'none';
  }

  // Скрываем кнопки переключения серий по умолчанию
  const prevBtn = document.getElementById('prev-episode-btn');
  const nextBtn = document.getElementById('next-episode-btn');
  if (prevBtn) prevBtn.style.display = 'none';
  if (nextBtn) nextBtn.style.display = 'none';
});

// НОВАЯ ФУНКЦИЯ: Обновление видимости кнопок переключения серий
function updateEpisodeButtons() {
  const prevBtn = document.getElementById('prev-episode-btn');
  const nextBtn = document.getElementById('next-episode-btn');

  if (!prevBtn || !nextBtn) return;

  if (currentEpisodeFiles.length > 0) {
    // Показываем кнопки только если есть серии
    prevBtn.style.display = 'flex';
    nextBtn.style.display = 'flex';

    // Делаем кнопки активными/неактивными в зависимости от текущей серии
    if (currentEpisodeIndex === 0) {
      prevBtn.style.opacity = '0.3';
      prevBtn.style.pointerEvents = 'none';
    } else {
      prevBtn.style.opacity = '1';
      prevBtn.style.pointerEvents = 'auto';
    }

    if (currentEpisodeIndex === currentEpisodeFiles.length - 1) {
      nextBtn.style.opacity = '0.3';
      nextBtn.style.pointerEvents = 'none';
    } else {
      nextBtn.style.opacity = '1';
      nextBtn.style.pointerEvents = 'auto';
    }
  } else {
    // Скрываем кнопки если нет серий
    prevBtn.style.display = 'none';
    nextBtn.style.display = 'none';
  }
}

// НОВАЯ ФУНКЦИЯ: Обновление названия текущего воспроизводимого файла
function updatePlayerTitle(title) {
  const titleElement = document.getElementById('player-title');
  const controlsContainer = document.getElementById('controls-container');
  if (!titleElement) return;

  if (title) {
    titleElement.textContent = title;
    titleElement.dataset.hasTitle = '1';
    if (controlsContainer && controlsContainer.classList.contains('idle-hidden')) {
      titleElement.classList.add('hidden');
      titleElement.classList.add('idle-hidden');
    } else {
      titleElement.classList.remove('hidden');
      titleElement.classList.remove('idle-hidden');
    }
  } else {
    titleElement.dataset.hasTitle = '';
    titleElement.classList.add('hidden');
    titleElement.classList.add('idle-hidden');
  }
}

function syncPlayerTitleVisibility(forceVisible = null) {
  const titleElement = document.getElementById('player-title');
  const controlsContainer = document.getElementById('controls-container');
  if (!titleElement) return;

  const hasTitle = !!titleElement.dataset.hasTitle;
  if (!hasTitle) {
    titleElement.classList.add('hidden');
    titleElement.classList.add('idle-hidden');
    return;
  }

  const shouldShow = forceVisible === null
    ? !!(controlsContainer && !controlsContainer.classList.contains('idle-hidden'))
    : !!forceVisible;

  if (shouldShow) {
    titleElement.classList.remove('hidden');
    titleElement.classList.remove('idle-hidden');
  } else {
    titleElement.classList.add('hidden');
    titleElement.classList.add('idle-hidden');
  }
}
window.syncPlayerTitleVisibility = syncPlayerTitleVisibility;

// НОВАЯ ФУНКЦИЯ: Получение названия файла по hash и fileId
async function getFileNameByHash(hash, fileId) {
  if (!hash || !fileId) return null;

  // Ищем торрент в текущем списке
  const torrent = AppState.torrents.find(t => t.hash && t.hash.toLowerCase() === hash.toLowerCase());

  if (!torrent) {
    console.log('⚠️ Торрент не найден для получения названия');
    return null;
  }

  // Получаем список файлов
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

  // Ищем нужный файл
  const file = files.find(f => f.id == fileId);
  if (file) {
    // Извлекаем имя файла из пути
    const fileName = file.path.split('/').pop() || `Файл ${fileId}`;
    return fileName;
  }

  return null;
}

// НОВАЯ ФУНКЦИЯ: Сброс таймера бездействия мыши
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

  // Показываем элементы
  if (playerOverlay) playerOverlay.classList.add('touch-active');

  // Показываем все элементы управления
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
  syncPlayerTitleVisibility(true);

  // Если панель серий открыта, оставляем её видимой
  if (episodesPanel && !episodesPanel.classList.contains('hidden')) {
    episodesPanel.style.opacity = '1';
    episodesPanel.style.pointerEvents = 'auto';
  }

  // Сбрасываем предыдущий таймер
  if (mouseIdleTimer) {
    clearTimeout(mouseIdleTimer);
  }

  // Устанавливаем новый таймер
  mouseIdleTimer = setTimeout(() => {
    if (playerScreen.style.display === 'block') {
      // Скрываем элементы, кроме панели серий если она открыта
      if (playerOverlay) playerOverlay.classList.remove('touch-active');

      controlElements.forEach(el => {
        if (el) {
          el.classList.add('idle-hidden');
          el.style.opacity = '0';
          el.style.pointerEvents = 'none';
        }
      });
      syncPlayerTitleVisibility(false);

      // Панель серий скрываем только если она закрыта
      if (episodesPanel && episodesPanel.classList.contains('hidden')) {
        episodesPanel.style.opacity = '0';
        episodesPanel.style.pointerEvents = 'none';
      }
    }
  }, IDLE_TIMEOUT);
}

// НОВАЯ ФУНКЦИЯ: Переключение на следующую серию
function nextEpisode() {
  console.log('➡️ Попытка переключения на следующую серию');
  console.log('Текущий индекс:', currentEpisodeIndex);
  console.log('Всего серий:', currentEpisodeFiles.length);

  if (currentEpisodeFiles.length === 0 || currentEpisodeIndex === undefined) {
    console.log('❌ Нет данных о сериях');
    return;
  }

  const nextIndex = currentEpisodeIndex + 1;
  if (nextIndex < currentEpisodeFiles.length) {
    const nextFile = currentEpisodeFiles[nextIndex];
    console.log(`✅ Переключаемся на серию ${nextIndex + 1}, fileId: ${nextFile.id}`);
    switchToEpisode(nextIndex, nextFile.id);
  } else {
    console.log('⚠️ Это последняя серия');
  }
}

// НОВАЯ ФУНКЦИЯ: Переключение на предыдущую серию
function prevEpisode() {
  console.log('⬅️ Попытка переключения на предыдущую серию');
  console.log('Текущий индекс:', currentEpisodeIndex);
  console.log('Всего серий:', currentEpisodeFiles.length);

  if (currentEpisodeFiles.length === 0 || currentEpisodeIndex === undefined) {
    console.log('❌ Нет данных о сериях');
    return;
  }

  const prevIndex = currentEpisodeIndex - 1;
  if (prevIndex >= 0) {
    const prevFile = currentEpisodeFiles[prevIndex];
    console.log(`✅ Переключаемся на серию ${prevIndex + 1}, fileId: ${prevFile.id}`);
    switchToEpisode(prevIndex, prevFile.id);
  } else {
    console.log('⚠️ Это первая серия');
  }
}

function showPlayerLoading(message = 'Перемотка...', targetTime = null) {
  const overlay = document.getElementById('loading-player-overlay');
  const playerOverlay = document.getElementById('player-overlay');
  const loadingTime = document.getElementById('loading-time');

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
  document.getElementById('loading-player-overlay').classList.remove('active');
  document.getElementById('player-overlay').classList.remove('loading');
}

function updateTimeDisplay() {
  const currentTimeSpan = document.getElementById('current-time');
  const durationSpan = document.getElementById('duration-time');
  const seekSlider = document.getElementById('seek-slider');
  const videoPlayer = document.getElementById('video-player');

  if (AppState.isSliderDragging && AppState.previewTime !== null) {
    currentTimeSpan.textContent = formatTime(AppState.previewTime);
  } else {
    const absoluteTime = videoPlayer.currentTime + AppState.seekOffset;
    currentTimeSpan.textContent = formatTime(absoluteTime);

    // Обновляем текущий таймкод для сохранения
    if (currentTimecodeData.hash && currentTimecodeData.fileId) {
      currentTimecodeData.timecode = absoluteTime;
    }
  }

  const totalDuration = AppState.originalDuration || AppState.expectedDuration || videoPlayer.duration;
  durationSpan.textContent = formatTime(totalDuration);

  // Обновляем длительность в данных таймкода
  if (totalDuration && isFinite(totalDuration) && totalDuration > 0) {
    currentTimecodeData.duration = totalDuration;
  }
}

function updatePlayPauseButton() {
  const btn = document.getElementById('play-pause-btn');
  const videoPlayer = document.getElementById('video-player');

  if (videoPlayer.paused) {
    btn.innerHTML = '<i class="fi fi-rr-play"></i>';
  } else {
    btn.innerHTML = '<i class="fi fi-rr-pause"></i>';
  }
}

function updateMuteButton() {
  const btn = document.getElementById('mute-btn');
  const videoPlayer = document.getElementById('video-player');

  if (videoPlayer.muted) {
    btn.innerHTML = '<i class="fi fi-tc-volume-slash"></i>';
  } else {
    btn.innerHTML = '<i class="fi fi-rr-volume"></i>';
  }
}

function updateBufferDisplay() {
  const bufferStats = document.getElementById('buffer-stats');
  const videoPlayer = document.getElementById('video-player');

  if (AppState.bufferHidden) {
    bufferStats.classList.add('hidden');
    return;
  }
  bufferStats.classList.remove('hidden');

  if (videoPlayer.buffered && videoPlayer.buffered.length > 0) {
    const buffered = videoPlayer.buffered.end(videoPlayer.buffered.length - 1);
    const totalDuration = AppState.originalDuration || AppState.expectedDuration || videoPlayer.duration;
    const currentTime = videoPlayer.currentTime;

    if (totalDuration && totalDuration > 0) {
      const absoluteBuffered = buffered + AppState.seekOffset;
      const absoluteCurrent = currentTime + AppState.seekOffset;
      const bufferAhead = absoluteBuffered - absoluteCurrent;

      const percent = Math.min(100, (absoluteBuffered / totalDuration * 100).toFixed(0));

      // Форматируем разницу в зависимости от величины
      let bufferAheadText;
      if (bufferAhead < 60) {
        bufferAheadText = `${bufferAhead.toFixed(0)} сек`;
      } else if (bufferAhead < 3600) {
        bufferAheadText = `${(bufferAhead / 60).toFixed(1)} мин`;
      } else {
        bufferAheadText = `${(bufferAhead / 3600).toFixed(1)} ч`;
      }

      bufferStats.innerText = `⬇️ Прогресс: ${percent}% (впереди ${bufferAheadText})`;
    }
  } else {
    bufferStats.innerText = '⬇️ буфер: 0%';
  }
}

function forceUpdateDuration(duration, origDur = null, offset = 0) {
  const videoPlayer = document.getElementById('video-player');
  const durationSpan = document.getElementById('duration-time');
  const seekSlider = document.getElementById('seek-slider');

  if (!duration || !isFinite(duration) || duration <= 0) return;

  console.log(`⏱️ Устанавливаем: отрезок=${formatTime(duration)}, полная=${origDur ? formatTime(origDur) : 'N/A'}, offset=${offset.toFixed(2)}s`);

  AppState.expectedDuration = duration;
  AppState.originalDuration = origDur;
  AppState.seekOffset = offset;

  videoPlayer.dataset.expectedDuration = duration;
  videoPlayer.dataset.originalDuration = origDur;
  videoPlayer.dataset.seekOffset = offset;

  durationSpan.textContent = formatTime(origDur || duration);
  seekSlider.max = origDur || duration;

  // Обновляем длительность в данных таймкода
  currentTimecodeData.duration = origDur || duration;

  updateTimeDisplay();
}

function destroyHls() {
  hidePlayerLoading();
  if (AppState.hls) {
    AppState.expectedDuration = null;
    AppState.originalDuration = null;
    AppState.seekOffset = 0;
    AppState.lastSuccessfulSeek = 0;
    delete document.getElementById('video-player').dataset.expectedDuration;
    delete document.getElementById('video-player').dataset.originalDuration;
    delete document.getElementById('video-player').dataset.seekOffset;
    AppState.hls.destroy();
    AppState.hls = null;
  }
  AppState.isPlaying = false;
}

async function checkPlaylistExists(playlistUrl, maxAttempts = 40) {
  console.log(`🔍 Начинаем проверку плейлиста: ${playlistUrl}`);

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(playlistUrl, { method: 'HEAD' });
      if (response.ok) {
        console.log(`✅ Плейлист готов после ${i + 1} попыток (${(i + 1) * 500}ms)`);
        return true;
      } else {
        console.log(`⚠️ Плейлист еще не готов, статус: ${response.status}`);
      }
    } catch (e) {
      console.log(`⏳ Попытка ${i + 1}/${maxAttempts}: плейлист не доступен, ошибка: ${e.message}`);
    }

    if (i % 4 === 0) {
      const seconds = ((i + 1) * 0.5).toFixed(0);
      showPlayerLoading(`Ожидание плейлиста... ${seconds}с`, AppState.previewTime);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  console.error(`❌ Плейлист не появился после ${maxAttempts} попыток (${maxAttempts * 0.5} секунд)`);
  return false;
}

function reloadHlsPlaylist(playlistUrl) {
  return new Promise((resolve, reject) => {
    if (!AppState.hls || !Hls.isSupported()) {
      reject(new Error('HLS не инициализирован'));
      return;
    }

    console.log('🔄 Перезагрузка плейлиста:', playlistUrl);

    let manifestParsed = false;
    let loadError = null;

    const onManifestParsed = () => {
      manifestParsed = true;
      AppState.hls.off(Hls.Events.MANIFEST_PARSED, onManifestParsed);
      AppState.hls.off(Hls.Events.ERROR, onError);
      console.log('✅ Новый плейлист загружен');
      resolve();
    };

    const onError = (event, data) => {
      console.error('HLS ошибка при загрузке:', data);
      if (data.fatal && !manifestParsed) {
        loadError = new Error(data.details || 'Ошибка загрузки плейлиста');
        AppState.hls.off(Hls.Events.MANIFEST_PARSED, onManifestParsed);
        AppState.hls.off(Hls.Events.ERROR, onError);
        reject(loadError);
      }
    };

    AppState.hls.on(Hls.Events.MANIFEST_PARSED, onManifestParsed);
    AppState.hls.on(Hls.Events.ERROR, onError);

    try {
      AppState.hls.loadSource(playlistUrl);
    } catch (e) {
      reject(e);
    }

    setTimeout(() => {
      if (!manifestParsed && !loadError) {
        AppState.hls.off(Hls.Events.MANIFEST_PARSED, onManifestParsed);
        AppState.hls.off(Hls.Events.ERROR, onError);
        reject(new Error('Таймаут загрузки плейлиста'));
      }
    }, 15000);
  });
}

// НОВАЯ ФУНКЦИЯ: Сохранение таймкода на сервер
async function saveTimecodeToServer() {
  if (!currentTimecodeData.hash || !currentTimecodeData.fileId) return;

  // Не сохраняем если таймкод 0 или близок к 0 (начало видео)
  if (currentTimecodeData.timecode < 5) return;

  // Не сохраняем если таймкод близок к концу (меньше 10 секунд до конца)
  if (currentTimecodeData.duration > 0 &&
    currentTimecodeData.timecode > currentTimecodeData.duration - 10) return;

  try {
    const response = await fetch(`${SERVER_URL}/api/timecode/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hash: currentTimecodeData.hash,
        fileId: currentTimecodeData.fileId,
        timecode: currentTimecodeData.timecode,
        duration: currentTimecodeData.duration
      })
    });

    if (response.ok) {
      console.log(`💾 Таймкод сохранен: ${formatTime(currentTimecodeData.timecode)}`);
    }
  } catch (error) {
    console.error('Ошибка сохранения таймкода:', error);
  }
}

// НОВАЯ ФУНКЦИЯ: Загрузка таймкода с сервера
async function loadTimecodeFromServer(hash, fileId) {
  if (!hash || !fileId) return 0;

  try {
    const response = await fetch(`${SERVER_URL}/api/timecode/get?hash=${hash}&fileId=${fileId}`);
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.timecode > 0) {
        console.log(`⏱️ Загружен сохраненный таймкод: ${formatTime(data.timecode)}`);
        return data.timecode;
      }
    }
  } catch (error) {
    console.error('Ошибка загрузки таймкода:', error);
  }
  return 0;
}

// НОВАЯ ФУНКЦИЯ: Очистка данных таймкода
function clearTimecodeData() {
  currentTimecodeData = {
    hash: null,
    fileId: null,
    timecode: 0,
    duration: 0
  };
}

// НОВАЯ ФУНКЦИЯ: Запуск интервала сохранения таймкода
function startTimecodeSaving() {
  if (timecodeSaveInterval) {
    clearInterval(timecodeSaveInterval);
  }

  // Сохраняем каждые 10 секунд
  timecodeSaveInterval = setInterval(() => {
    saveTimecodeToServer();
  }, 10000);
}

// НОВАЯ ФУНКЦИЯ: Остановка интервала сохранения таймкода
function stopTimecodeSaving() {
  if (timecodeSaveInterval) {
    clearInterval(timecodeSaveInterval);
    timecodeSaveInterval = null;
  }
}
// НОВАЯ ФУНКЦИЯ: Проверка, доступна ли позиция в буфере
function isPositionInBuffer(targetTime) {
  const videoPlayer = document.getElementById('video-player');

  if (!videoPlayer || !videoPlayer.buffered || videoPlayer.buffered.length === 0) {
    return false;
  }

  // Переводим абсолютное время в относительное для видео (учитываем seekOffset)
  const relativeTargetTime = targetTime - AppState.seekOffset;

  // Проверяем все диапазоны буфера
  for (let i = 0; i < videoPlayer.buffered.length; i++) {
    const start = videoPlayer.buffered.start(i);
    const end = videoPlayer.buffered.end(i);

    // Добавляем небольшой запас (0.5 секунды) для более плавной перемотки
    if (relativeTargetTime >= start - 0.5 && relativeTargetTime <= end + 0.5) {
      console.log(`✅ Позиция ${formatTime(targetTime)} (${relativeTargetTime.toFixed(2)}s) в буфере [${start.toFixed(2)}-${end.toFixed(2)}]`);
      return true;
    }
  }

  console.log(`❌ Позиция ${formatTime(targetTime)} (${relativeTargetTime.toFixed(2)}s) вне буфера`);
  return false;
}

// Обновленная функция перемотки с блокировкой интерфейса
async function seekStream(absoluteSeekTime, source = 'user') {
  if (!AppState.currentStreamId || !AppState.videoUrl) {
    console.warn('⚠️ Нет активного потока для перемотки');
    return false;
  }

  const videoPlayer = document.getElementById('video-player');
  const totalDuration = AppState.originalDuration || AppState.expectedDuration || 0;

  if (absoluteSeekTime < 0) absoluteSeekTime = 0;
  if (totalDuration > 0 && absoluteSeekTime >= totalDuration - 1) {
    console.log('⚠️ Попытка перемотки за конец видео');
    return false;
  }

  AppState.seekQueue.push(absoluteSeekTime);

  if (AppState.isSeeking) {
    console.log(`⏳ В очереди: ${formatTime(absoluteSeekTime)}`);
    return false;
  }

  if (source === 'slider' && AppState.seekTimeout) {
    clearTimeout(AppState.seekTimeout);
  }

  return new Promise((resolve) => {
    const executeSeek = async () => {
      const targetTime = AppState.seekQueue[AppState.seekQueue.length - 1];
      AppState.seekQueue = [];

      if (targetTime === undefined) {
        hidePlayerLoading();
        resolve(false);
        return;
      }

      const wasPlaying = !videoPlayer.paused;

      // Сначала закрываем панель серий если открыта
      const episodesPanel = document.getElementById('episodes-panel');
      const episodesBtn = document.getElementById('episodes-btn');
      if (episodesPanel && !episodesPanel.classList.contains('hidden')) {
        episodesPanel.classList.add('hidden');
        episodesBtn.classList.remove('active');
      }

      AppState.isSeeking = true;
      AppState.suppressTimeUpdate = true;
      AppState.previewTime = targetTime;

      console.log(`🔍 SEEK: ${formatTime(targetTime)}`);

      // 🔥 НОВАЯ ЛОГИКА: Проверяем, есть ли позиция в буфере
      const positionInBuffer = isPositionInBuffer(targetTime);

      if (positionInBuffer) {
        console.log('🎯 Перемотка в пределах буфера - используем простой seek');

        // Простая перемотка через videoPlayer.currentTime
        const relativeTime = targetTime - AppState.seekOffset;
        videoPlayer.currentTime = relativeTime;

        // Возобновляем воспроизведение если было
        if (wasPlaying) {
          videoPlayer.play().catch(err => {
            console.log('🔇 Ошибка автоплея после перемотки:', err);
          });
        }

        // Обновляем интерфейс
        AppState.previewTime = null;
        AppState.suppressTimeUpdate = false;
        AppState.isSeeking = false;

        // Обновляем ползунок
        const seekSlider = document.getElementById('seek-slider');
        if (seekSlider) {
          seekSlider.value = targetTime;
        }

        updateTimeDisplay();

        console.log('✅ Простая перемотка выполнена');
        resolve(true);
        return;
      }

      // Если позиция вне буфера - используем сложную перемотку с перезапуском ffmpeg
      console.log('🎯 Перемотка вне буфера - перезапуск ffmpeg');

      // 🔥 СБРАСЫВАЕМ lastCleanedSegment ПЕРЕД ПЕРЕМОТКОЙ
      if (typeof lastCleanedSegment !== 'undefined') {
        console.log(`🔄 Сброс lastCleanedSegment: ${lastCleanedSegment} -> -1`);
        lastCleanedSegment = -1;
      }

      // Показываем оверлей загрузки и блокируем интерфейс
      document.getElementById('playback-overlay').classList.add('active');
      document.querySelector('.playback-text').textContent = `Перемотка на ${formatTime(targetTime)}...`;

      // Блокируем кнопки управления
      const controlBtns = document.querySelectorAll('.control-btn');
      controlBtns.forEach(btn => {
        btn.style.pointerEvents = 'none';
        btn.style.opacity = '0.5';
      });

      if (wasPlaying) {
        videoPlayer.pause();
        updatePlayPauseButton();
      }

      try {
        const seekResponse = await fetch(`${SERVER_URL}/hls/stream/seek`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            streamId: AppState.currentStreamId,
            seekTime: targetTime
          })
        });

        if (!seekResponse.ok) {
          throw new Error(`HTTP ${seekResponse.status}`);
        }

        const seekData = await seekResponse.json();

        if (!seekData.success) {
          throw new Error(seekData.error || 'Ошибка перемотки');
        }

        console.log('✅ Ответ сервера:', seekData);

        AppState.expectedDuration = seekData.duration;
        AppState.originalDuration = seekData.originalDuration;
        AppState.seekOffset = seekData.seekOffset;
        AppState.currentStreamId = seekData.streamId;
        AppState.lastSuccessfulSeek = targetTime;

        videoPlayer.dataset.expectedDuration = AppState.expectedDuration;
        videoPlayer.dataset.originalDuration = AppState.originalDuration;
        videoPlayer.dataset.seekOffset = AppState.seekOffset;

        document.querySelector('.playback-text').textContent = 'Загрузка потока...';

        const playlistReady = await checkPlaylistExists(seekData.playlistUrl, 60);

        if (!playlistReady) {
          throw new Error('Таймаут ожидания плейлиста');
        }

        document.querySelector('.playback-text').textContent = 'Загрузка видео...';

        await reloadHlsPlaylist(seekData.playlistUrl);

        const onMetaData = () => {
          console.log(`📦 Метаданные загружены`);
          videoPlayer.currentTime = 0;

          if (wasPlaying) {
            videoPlayer.play().catch(err => {
              console.log('🔇 Автоплей после перемотки заблокирован');
              videoPlayer.muted = true;
              videoPlayer.play().catch(() => { });
              updateMuteButton();
            });
          }

          forceUpdateDuration(AppState.expectedDuration, AppState.originalDuration, AppState.seekOffset);
          updatePlayPauseButton();
          const seekSlider = document.getElementById('seek-slider');
          if (seekSlider) {
            seekSlider.value = Math.min(targetTime, parseFloat(seekSlider.max) || targetTime);
          }
          AppState.previewTime = null;
          AppState.suppressTimeUpdate = false;

          // Скрываем оверлей и разблокируем интерфейс
          document.getElementById('playback-overlay').classList.remove('active');
          document.querySelector('.playback-text').textContent = 'Воспроизведение...';

          controlBtns.forEach(btn => {
            btn.style.pointerEvents = 'auto';
            btn.style.opacity = '1';
          });

          hidePlayerLoading();

          videoPlayer.removeEventListener('loadedmetadata', onMetaData);
        };

        videoPlayer.addEventListener('loadedmetadata', onMetaData, { once: true });

        setTimeout(() => {
          if (document.getElementById('loading-player-overlay').classList.contains('active')) {
            console.log('⚠️ Таймаут загрузки метаданных');
            hidePlayerLoading();
            if (wasPlaying) {
              videoPlayer.play().catch(() => { });
            }
          }
        }, 10000);

        resolve(true);

      } catch (error) {
        console.error('❌ Ошибка перемотки:', error);

        document.querySelector('.playback-text').textContent = 'Ошибка перемотки!';

        setTimeout(() => {
          // Скрываем оверлей и разблокируем интерфейс
          document.getElementById('playback-overlay').classList.remove('active');
          document.querySelector('.playback-text').textContent = 'Воспроизведение...';

          controlBtns.forEach(btn => {
            btn.style.pointerEvents = 'auto';
            btn.style.opacity = '1';
          });
        }, 2000);

        if (wasPlaying) {
          setTimeout(() => {
            videoPlayer.play().catch(() => { });
          }, 1000);
        }

        if (error.message.includes('не найден') || error.message.includes('404') || error.message.includes('Таймаут')) {
          console.log('🔄 Пробуем создать поток заново...');
          await startHLSPlayback(AppState.videoUrl, targetTime, false);
        }

        AppState.previewTime = null;
        AppState.suppressTimeUpdate = false;
        resolve(false);
      } finally {
        AppState.isSeeking = false;
      }
    };

    if (source === 'slider') {
      if (AppState.seekTimeout) clearTimeout(AppState.seekTimeout);
      AppState.seekTimeout = setTimeout(executeSeek, 300);
    } else {
      executeSeek();
    }
  });
}

function extractVideoFiles(files = []) {
  return files.filter(file => {
    const name = (file.path || '').toLowerCase();
    return name.endsWith('.mp4') || name.endsWith('.mkv') || name.endsWith('.avi') ||
      name.endsWith('.mov') || name.endsWith('.webm') || name.endsWith('.m4v');
  });
}

async function resolveTorrentWithFiles(hash, maxAttempts = 3, delayMs = 700) {
  let torrent = AppState.torrents.find(t => t.hash && t.hash.toLowerCase() === hash.toLowerCase());

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let files = [];

    if (torrent?.file_stats && Array.isArray(torrent.file_stats)) {
      files = torrent.file_stats;
    } else if (torrent?.data) {
      try {
        const data = JSON.parse(torrent.data);
        if (data.TorrServer && Array.isArray(data.TorrServer.Files)) {
          files = data.TorrServer.Files;
        }
      } catch (e) {
        console.error('Ошибка парсинга data:', e);
      }
    }

    if (extractVideoFiles(files).length > 0) {
      return torrent;
    }

    if (attempt < maxAttempts - 1) {
      console.log(`🔄 Попытка ${attempt + 1}/${maxAttempts}: обновляем список, чтобы получить файлы серий`);
      await refreshTorrentsList();
      torrent = AppState.torrents.find(t => t.hash && t.hash.toLowerCase() === hash.toLowerCase());
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return torrent;
}

// Функция для загрузки информации о сериях
async function loadEpisodesInfo(hash, currentFileId = null) {
  console.log('🔍 Загрузка информации о сериях для hash:', hash, 'fileId:', currentFileId);

  if (!hash || !AppState.currentTorrserverUrl) {
    console.log('❌ Нет hash или URL сервера');
    return;
  }

  try {
    let torrent = await resolveTorrentWithFiles(hash, 4, 800);

    console.log('📦 Найден торрент:', torrent ? torrent.title : 'не найден');

    if (!torrent) {
      console.log('❌ Торрент всё ещё не найден');
      return;
    }

    let files = [];

    if (torrent.file_stats && Array.isArray(torrent.file_stats)) {
      console.log('📁 Используем file_stats, найдено файлов:', torrent.file_stats.length);
      files = torrent.file_stats;
    } else if (torrent.data) {
      try {
        const data = JSON.parse(torrent.data);
        if (data.TorrServer && data.TorrServer.Files) {
          console.log('📁 Используем data.TorrServer.Files, найдено файлов:', data.TorrServer.Files.length);
          files = data.TorrServer.Files;
        }
      } catch (e) {
        console.error('Ошибка парсинга data:', e);
      }
    }

    const videoFiles = extractVideoFiles(files);

    console.log('🎬 Видеофайлов найдено:', videoFiles.length);

    if (videoFiles.length > 0) {
      currentEpisodeFiles = videoFiles;
      currentTorrentHash = hash;

      if (currentFileId) {
        currentEpisodeIndex = videoFiles.findIndex(f => String(f.id) == String(currentFileId));
        console.log('📍 Текущая серия по fileId:', currentEpisodeIndex + 1);
      } else if (AppState.videoUrl) {
        const match = AppState.videoUrl.match(/\/(\d+)$/);
        if (match && match[1]) {
          currentEpisodeIndex = videoFiles.findIndex(f => String(f.id) == String(match[1]));
          console.log('📍 Текущая серия по URL:', currentEpisodeIndex + 1);
        }
      }

      if (currentEpisodeIndex === -1 || currentEpisodeIndex === undefined) {
        currentEpisodeIndex = 0;
        console.log('📍 Индекс не найден, используем первую серию');
      }

      renderEpisodesList();

      const episodesBtn = document.getElementById('episodes-btn');
      if (episodesBtn) {
        episodesBtn.style.display = videoFiles.length > 1 ? 'flex' : 'none';
      }

      updateEpisodeButtons();
    } else {
      console.log('❌ Видеофайлы не найдены');
      currentEpisodeFiles = [];
      currentEpisodeIndex = 0;
      const episodesBtn = document.getElementById('episodes-btn');
      if (episodesBtn) {
        episodesBtn.style.display = 'none';
      }
      updateEpisodeButtons();
    }
  } catch (error) {
    console.error('Ошибка загрузки серий:', error);
  }
}

// Функция для отрисовки списка серий
function renderEpisodesList() {
  const episodesList = document.getElementById('episodes-list');
  if (!episodesList) return;

  if (currentEpisodeFiles.length === 0) {
    episodesList.innerHTML = '<div class="search-result-empty">Нет доступных серий</div>';
    return;
  }

  let html = '';

  // Добавляем информацию о текущей серии
  html += `
    <div class="current-episode-info">
      <span class="current-episode-badge">Текущая</span>
      <span>Серия ${currentEpisodeIndex + 1} из ${currentEpisodeFiles.length}</span>
    </div>
  `;

  currentEpisodeFiles.forEach((file, index) => {
    const fileName = file.path.split('/').pop() || `Серия ${index + 1}`;
    const isActive = index === currentEpisodeIndex;
    const fileSize = formatBytes(file.length);

    // Пытаемся извлечь номер серии из названия
    let episodeNumber = index + 1;
    const episodeMatch = fileName.match(/[eE](\d+)|(\d+)[\s._-]*[серия]/);
    if (episodeMatch) {
      episodeNumber = episodeMatch[1] || episodeMatch[2];
    }

    html += `
      <div class="episode-item ${isActive ? 'active' : ''}" data-index="${index}" data-file-id="${file.id}">
        <div class="episode-number">${episodeNumber}</div>
        <div class="episode-info">
          <div class="episode-title">${escapeHtml(fileName.substring(0, 40))}${fileName.length > 40 ? '...' : ''}</div>
          <div class="episode-duration">${fileSize}</div>
        </div>
        <button class="episode-play" title="Воспроизвести">▶</button>
      </div>
    `;
  });

  episodesList.innerHTML = html;

  // Добавляем обработчики
  episodesList.querySelectorAll('.episode-item').forEach(item => {
    const index = parseInt(item.dataset.index);
    const fileId = item.dataset.fileId;

    // Клик по элементу (переключение серии)
    item.addEventListener('click', (e) => {
      // Игнорируем клик по кнопке play
      if (e.target.classList.contains('episode-play')) return;
      switchToEpisode(index, fileId);
    });

    // Клик по кнопке play
    item.querySelector('.episode-play').addEventListener('click', (e) => {
      e.stopPropagation();
      switchToEpisode(index, fileId);
    });
  });
}

// Функция переключения на другую серию
async function switchToEpisode(index, fileId) {
  console.log(`🔄 Переключение на серию ${index + 1}, fileId: ${fileId}`);
  console.log('Текущий hash:', currentTorrentHash);

  if (!currentTorrentHash || !AppState.currentTorrserverUrl) {
    console.error('❌ Нет hash или URL сервера');
    return;
  }

  // Не переключаемся на текущую серию
  if (index === currentEpisodeIndex) {
    console.log('⚠️ Это уже текущая серия');
    toggleEpisodesPanel();
    return;
  }

  // Останавливаем проверку приближения к концу видео
  if (nearEndCheckInterval) {
    clearInterval(nearEndCheckInterval);
    nearEndCheckInterval = null;
  }

  // Сохраняем таймкод перед переключением
  await saveTimecodeToServer();

  // Сначала закрываем панель серий
  const episodesPanel = document.getElementById('episodes-panel');
  const episodesBtn = document.getElementById('episodes-btn');
  if (episodesPanel) {
    episodesPanel.classList.add('hidden');
    episodesBtn.classList.remove('active');
  }

  // Показываем оверлей загрузки и блокируем интерфейс
  document.getElementById('playback-overlay').classList.add('active');
  document.querySelector('.playback-text').textContent = `Переключение на серию ${index + 1}...`;

  // Блокируем кнопки управления
  const controlBtns = document.querySelectorAll('.control-btn');
  controlBtns.forEach(btn => {
    btn.style.pointerEvents = 'none';
    btn.style.opacity = '0.5';
  });

  try {
    const playUrl = `${AppState.currentTorrserverUrl}/play/${currentTorrentHash}/${fileId}`;

    // Обновляем текущий индекс
    currentEpisodeIndex = index;
    console.log('✅ Новый индекс серии:', currentEpisodeIndex);

    // Обновляем URL в AppState
    AppState.videoUrl = playUrl;

    // Останавливаем текущий HLS поток
    if (AppState.currentStreamId) {
      await fetch(`${SERVER_URL}/hls/stop/${AppState.currentStreamId}`, { method: 'POST' });
      AppState.currentStreamId = null;
    }

    // Получаем видео элемент и удаляем старый обработчик
    const videoPlayer = document.getElementById('video-player');
    videoPlayer.removeEventListener('ended', handleVideoEnded);

    destroyHls();

    // Запускаем новый поток (начинаем с начала серии)
    await startHLSPlayback(playUrl, 0, lastPlaybackFromSearch, index);

    // Обновляем название для новой серии
    const fileName = await getFileNameByHash(currentTorrentHash, fileId);
    if (fileName && AppState.currentDetailItem) {
      updatePlayerTitle(`${AppState.currentDetailItem.title} - ${fileName}`);
    }

    // Обновляем список серий
    renderEpisodesList();

    // Обновляем состояние кнопок переключения
    updateEpisodeButtons();

  } catch (error) {
    console.error('❌ Ошибка переключения серии:', error);
    alert('Ошибка при переключении серии');
  } finally {
    // Скрываем оверлей и разблокируем интерфейс
    document.getElementById('playback-overlay').classList.remove('active');
    document.querySelector('.playback-text').textContent = 'Воспроизведение...';

    // Разблокируем кнопки управления
    controlBtns.forEach(btn => {
      btn.style.pointerEvents = 'auto';
      btn.style.opacity = '1';
    });

    hidePlayerLoading();
  }
}
// Функция для открытия/закрытия панели серий
function toggleEpisodesPanel() {
  const panel = document.getElementById('episodes-panel');
  const btn = document.getElementById('episodes-btn');

  if (!panel || !btn) return;

  if (panel.classList.contains('hidden')) {
    // Загружаем информацию о сериях перед открытием
    if (AppState.currentDetailItem) {
      loadEpisodesInfo(AppState.currentDetailItem.hash);
    }
    panel.classList.remove('hidden');
    btn.classList.add('active');
  } else {
    panel.classList.add('hidden');
    btn.classList.remove('active');
  }
}

// Настройка обработчиков для кнопки серий
function setupEpisodesButton() {
  console.log('🔄 Настройка кнопки серий...');

  const episodesBtn = document.getElementById('episodes-btn');
  const closeEpisodesBtn = document.getElementById('close-episodes');
  const episodesPanel = document.getElementById('episodes-panel');

  console.log('📊 Элементы:', {
    episodesBtn: !!episodesBtn,
    closeEpisodesBtn: !!closeEpisodesBtn,
    episodesPanel: !!episodesPanel
  });

  if (!episodesBtn || !closeEpisodesBtn || !episodesPanel) {
    console.error('❌ Не найдены элементы для кнопки серий');
    return;
  }

  episodesBtn.addEventListener('click', (e) => {
    console.log('👆 Нажата кнопка серий');
    e.stopPropagation();
    toggleEpisodesPanel();
    resetMouseIdleTimer();
  });

  closeEpisodesBtn.addEventListener('click', () => {
    console.log('👆 Нажата кнопка закрытия');
    episodesPanel.classList.add('hidden');
    episodesBtn.classList.remove('active');
    resetMouseIdleTimer();
  });

  // Закрытие панели при клике вне её
  document.addEventListener('click', (e) => {
    if (!episodesPanel.contains(e.target) && !episodesBtn.contains(e.target)) {
      episodesPanel.classList.add('hidden');
      episodesBtn.classList.remove('active');
    }
    resetMouseIdleTimer();
  });

  console.log('✅ Кнопка серий настроена');
}

// Обновленная функция startHLSPlayback с ожиданием буфера (видео на паузе)
async function startHLSPlayback(originalUrl, initialSeek = null, fromSearch = false, episodeIndex = null, audioTrack = null) {
  if (!originalUrl || !originalUrl.trim()) {
    alert('Ошибка: URL не указан');
    return false;
  }

  console.log('🎬 Запуск HLS для URL:', originalUrl);
  console.log('🔍 Из поиска:', fromSearch);
  console.log('📺 Индекс серии:', episodeIndex);
  console.log('🎵 Аудиодорожка:', audioTrack);
  console.log('⏱️ Начальная позиция (initialSeek):', initialSeek !== null ? formatTime(initialSeek) : 'не указана');

  // Устанавливаем флаг, откуда было начато воспроизведение
  lastPlaybackFromSearch = fromSearch;

  // Парсим URL для получения hash и fileId
  const match = originalUrl.match(/\/play\/([a-fA-F0-9]+)\/(\d+)/);
  if (match) {
    currentTimecodeData.hash = match[1];
    currentTimecodeData.fileId = match[2];
    currentTimecodeData.timecode = 0;

    // Загружаем информацию о файле (аудиодорожки)
    const fileInfo = await loadFileInfo(currentTimecodeData.hash, currentTimecodeData.fileId);
    if (fileInfo && fileInfo.audio) {
      currentAudioTracks = fileInfo.audio;
      // Если передана конкретная аудиодорожка, используем её, иначе первую
      currentAudioTrack = audioTrack !== null ? audioTrack : 0;
      console.log('🎵 Загружено аудиодорожек:', currentAudioTracks.length);
    }
    // Загружаем предпочтение аудиодорожки
    const savedAudioTrack = await loadAudioPreference(currentTimecodeData.hash, currentTimecodeData.fileId);

    // Если есть сохраненное предпочтение, используем его, иначе первую дорожку
    if (savedAudioTrack !== null && savedAudioTrack < currentAudioTracks.length) {
      currentAudioTrack = savedAudioTrack;
      // Если переданная audioTrack отличается от сохраненной, обновляем её
      if (audioTrack !== savedAudioTrack) {
        audioTrack = savedAudioTrack;
      }
      console.log(`🎵 Используем сохраненное предпочтение: дорожка ${currentAudioTrack}`);
    } else {
      currentAudioTrack = audioTrack !== null ? audioTrack : 0;
    }

    console.log('🎵 Загружено аудиодорожек:', currentAudioTracks.length);

    // 🔥 ИСПРАВЛЕННАЯ ЛОГИКА: обрабатываем initialSeek
    let seekTime = initialSeek;

    if (seekTime === null) {
      // Только если initialSeek не передан, загружаем сохраненный таймкод
      const savedTimecode = await loadTimecodeFromServer(currentTimecodeData.hash, currentTimecodeData.fileId);
      if (savedTimecode > 0) {
        seekTime = savedTimecode;
        console.log(`⏱️ Будем использовать сохраненный таймкод: ${formatTime(savedTimecode)}`);
      } else {
        seekTime = 0;
        console.log(`⏱️ Сохраненного таймкода нет, начинаем с начала`);
      }
    } else if (seekTime === 0) {
      console.log(`⏱️ Явно указано воспроизведение с начала (seekTime=0)`);
    } else {
      console.log(`⏱️ Явно указана позиция: ${formatTime(seekTime)}`);
    }

    // Используем вычисленный seekTime для дальнейшего воспроизведения
    initialSeek = seekTime;

    // Получаем и отображаем название файла
    const fileName = await getFileNameByHash(currentTimecodeData.hash, currentTimecodeData.fileId);
    if (fileName) {
      if (AppState.currentDetailItem && AppState.currentDetailItem.title) {
        updatePlayerTitle(`${AppState.currentDetailItem.title} - ${fileName}`);
      } else {
        updatePlayerTitle(fileName);
      }
    } else if (AppState.currentDetailItem && AppState.currentDetailItem.title) {
      updatePlayerTitle(AppState.currentDetailItem.title);
    }
  }

  // Если есть текущий торрент, загружаем информацию о сериях
  if (AppState.currentDetailItem) {
    console.log('📂 Загружаем информацию о сериях для:', AppState.currentDetailItem.title);

    const currentFileId = episodeIndex !== null && currentEpisodeFiles[episodeIndex]
      ? currentEpisodeFiles[episodeIndex].id
      : (match ? match[2] : null);

    setTimeout(() => {
      loadEpisodesInfo(AppState.currentDetailItem.hash, currentFileId);
    }, fromSearch ? 1600 : 1000);
  }

  try {
    const seekParam = initialSeek && initialSeek > 0 ? `&start=${initialSeek.toFixed(2)}` : '';
    const audioParam = audioTrack !== null ? `&audio=${audioTrack}` : '';
    const response = await fetch(`${SERVER_URL}/hls/stream?url=${encodeURIComponent(originalUrl)}${seekParam}${audioParam}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data.success) throw new Error(data.error || 'Ошибка создания потока');

    console.log('📦 Данные потока:', data);
    console.log('👤 Client ID:', data.clientId);
    console.log('🎵 Используемая аудиодорожка:', data.audioTrack);

    AppState.currentStreamId = data.streamId;
    AppState.videoUrl = originalUrl;

    AppState.expectedDuration = data.duration;
    AppState.originalDuration = data.originalDuration || data.duration;
    AppState.seekOffset = data.seekOffset || initialSeek || 0;
    AppState.lastSuccessfulSeek = AppState.seekOffset;

    console.log(`📊 Длительность: полная=${formatTime(AppState.originalDuration)}, offset=${AppState.seekOffset.toFixed(2)}s`);

    AppState.currentScreen = 'player';

    // Скрываем все другие экраны
    document.getElementById('config-screen').style.display = 'none';
    document.getElementById('torrserver-section').style.display = 'none';
    document.getElementById('detail-view').style.display = 'none';
    document.getElementById('player-screen').style.display = 'block';

    // 👇 ВАЖНО: СБРАСЫВАЕМ ФОКУС ПЕРЕД ЗАПУСКОМ ПЛЕЕРА
    document.querySelectorAll('.focused').forEach(el => {
      el.classList.remove('focused');
    });

    // Скрываем элементы управления (они должны быть скрыты по умолчанию)
    const controlsContainer = document.getElementById('controls-container');
    if (controlsContainer) {
      controlsContainer.classList.add('idle-hidden');
    }

    // Сбрасываем индекс фокуса в глобальной переменной
    if (typeof currentFocusIndex !== 'undefined') {
      currentFocusIndex = 0;
    }

    if (typeof updateFocusableElements === 'function') {
      updateFocusableElements();
    }

    destroyHls();

    const videoPlayer = document.getElementById('video-player');

    // Удаляем старый обработчик окончания видео
    videoPlayer.removeEventListener('ended', handleVideoEnded);
    // Добавляем новый обработчик
    videoPlayer.addEventListener('ended', handleVideoEnded);

    if (Hls.isSupported()) {
      AppState.hls = new Hls({
        maxBufferSize: 80 * 1024 * 1024, // 80MB
        maxBufferLength: 30,
        maxMaxBufferLength: 30,
        backBufferLength: 20,
        startFragPrefetch: true,
        startLevel: -1,
        abrEwmaDefaultEstimate: 500000,
        abrBandWidthFactor: 0.8,
        abrBandWidthUpFactor: 0.7,
        fragLoadingTimeOut: 10000,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 500,
        manifestLoadingTimeOut: 10000,
        manifestLoadingMaxRetry: 4,
        maxFragLookUpTolerance: 0.25,
        lowLatencyMode: false,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: Infinity,
        maxLiveSyncPlaybackRate: 1,
        liveDurationInfinity: false,
        liveBackBufferLength: 20,
        enableWorker: true,
        abrEwmaSlowVoD: 4000,
        abrEwmaFastVoD: 1000,
        progressive: true,
        fetchSetup: (context, initParams) => {
          initParams.headers = {
            ...initParams.headers,
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          };
          return new Request(context.url, initParams);
        }
      });

      // Обработчики HLS событий
      AppState.hls.on(Hls.Events.FRAG_LOADING, (event, data) => {
        try {
          if (data && data.frag && data.frag.sn !== undefined) {
            console.log(`📥 Загрузка сегмента ${data.frag.sn}`);
          }
        } catch (e) {
          // Игнорируем ошибки в обработчике
        }
      });

      AppState.hls.on(Hls.Events.FRAG_LOADED, (event, data) => {
        try {
          if (!data || !data.frag || !data.stats) {
            return;
          }

          const stats = data.stats;
          if (stats && stats.loading && stats.loading.end && stats.loading.start && stats.loaded) {
            const loadTimeMs = stats.loading.end - stats.loading.start;
            if (loadTimeMs > 0) {
              const sizeKB = stats.loaded / 1024;
              const speedKBps = (sizeKB / loadTimeMs) * 1000;
              console.log(`✅ Сегмент ${data.frag.sn} загружен: ${sizeKB.toFixed(2)} KB за ${loadTimeMs}ms (${speedKBps.toFixed(2)} KB/s)`);
            } else {
              console.log(`✅ Сегмент ${data.frag.sn} загружен (мгновенно)`);
            }
          } else {
            console.log(`✅ Сегмент ${data.frag.sn} загружен`);
          }
        } catch (e) {
          console.log('⚠️ Ошибка при обработке статистики загрузки сегмента');
        }
      });

      AppState.hls.on(Hls.Events.BUFFER_APPENDED, (event, data) => {
        try {
          const videoPlayer = document.getElementById('video-player');
          if (videoPlayer && videoPlayer.buffered && videoPlayer.buffered.length > 0) {
            const bufferedEnd = videoPlayer.buffered.end(videoPlayer.buffered.length - 1);
            const currentTime = videoPlayer.currentTime;
            const bufferAhead = bufferedEnd - currentTime;

            if (bufferAhead > 0 && isFinite(bufferAhead)) {
              console.log(`📊 Буфер впереди: ${bufferAhead.toFixed(2)}s`);
            }
          }
        } catch (e) {
          // Игнорируем ошибки в обработчике
        }
      });

      let currentPlayingSegment = -1;
      let lastLogTime = 0;

      AppState.hls.on(Hls.Events.FRAG_CHANGED, (event, data) => {
        try {
          if (data && data.frag) {
            const frag = data.frag;
            const segmentNumber = frag.sn;
            const segmentDuration = frag.duration || 0;
            const segmentStart = frag.start || 0;

            if (currentPlayingSegment !== segmentNumber) {
              currentPlayingSegment = segmentNumber;
              const startTimeFormatted = formatTime(segmentStart);
              console.log(`🎬 ВОСПРОИЗВЕДЕНИЕ: Сегмент #${segmentNumber} | Начало: ${startTimeFormatted} | Длительность: ${segmentDuration.toFixed(2)}с | Уровень: ${frag.level}`);

              if (frag.programDateTime) {
                const date = new Date(frag.programDateTime);
                console.log(`   📅 Время сегмента: ${date.toLocaleTimeString()}`);
              }

              const segmentToDelete = segmentNumber - 3;
              if (segmentToDelete >= 0 && segmentToDelete > lastCleanedSegment) {
                console.log(`🧹 Запускаем очистку: текущий сегмент ${segmentNumber}, удаляем сегменты до ${segmentNumber - 3}`);
                fetch(`${SERVER_URL}/hls/cleanup-segments/${AppState.currentStreamId}`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    keepFromSegment: segmentNumber - 3
                  })
                })
                  .then(response => response.json())
                  .then(data => {
                    if (data.success) {
                      console.log(`✅ Очистка выполнена: удалено ${data.deleted} сегментов`);
                      lastCleanedSegment = segmentNumber - 3;
                    } else {
                      console.error('❌ Ошибка очистки:', data.error);
                    }
                  })
                  .catch(error => {
                    console.error('❌ Ошибка при вызове cleanup:', error);
                  });
              }
            }
          }
        } catch (e) {
          console.log('⚠️ Ошибка при отслеживании сегмента:', e);
        }
      });

      const timeUpdateHandler = () => {
        try {
          const currentTime = videoPlayer.currentTime;
          if (Date.now() - lastLogTime > 30000) {
            if (videoPlayer.buffered && videoPlayer.buffered.length > 0) {
              for (let i = 0; i < videoPlayer.buffered.length; i++) {
                const start = videoPlayer.buffered.start(i);
                const end = videoPlayer.buffered.end(i);
                if (currentTime >= start && currentTime <= end) {
                  const segmentEstimate = Math.floor(currentTime / 10);
                  console.log(`⏱️ Текущая позиция: ${formatTime(currentTime)} (примерно сегмент #${segmentEstimate})`);
                  lastLogTime = Date.now();
                  break;
                }
              }
            }
          }
        } catch (e) {
          // Игнорируем
        }
      };

      videoPlayer.addEventListener('timeupdate', timeUpdateHandler);

      AppState.hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
        console.log(`📊 Качество переключено на уровень ${data.level}`);
      });

      AppState.hls.loadSource(data.playlistUrl);
      AppState.hls.attachMedia(videoPlayer);

      let playbackStarted = false;
      let bufferCheckInterval = null;

      AppState.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('📜 Манифест распарсен');

        forceUpdateDuration(AppState.expectedDuration, AppState.originalDuration, AppState.seekOffset);
        videoPlayer.currentTime = 0;
        videoPlayer.pause();
        updatePlayPauseButton();

        console.log('⏳ Ожидание накопления буфера 10 секунд... (видео на паузе)');
        showPlayerLoading('Буферизация... 0/10 сек', null);

        const checkBuffer = () => {
          if (playbackStarted) return;

          if (videoPlayer.buffered && videoPlayer.buffered.length > 0) {
            const bufferedEnd = videoPlayer.buffered.end(videoPlayer.buffered.length - 1);
            const currentTime = videoPlayer.currentTime;
            const bufferAhead = bufferedEnd - currentTime;

            console.log(`📊 Текущий буфер: ${bufferAhead.toFixed(2)} сек`);
            showPlayerLoading(`Буферизация... ${Math.min(10, Math.floor(bufferAhead))}/10 сек`, null);

            if (bufferAhead >= 10) {
              console.log('✅ Буфер накоплен, запускаем воспроизведение');

              if (bufferCheckInterval) {
                clearInterval(bufferCheckInterval);
                bufferCheckInterval = null;
              }

              hidePlayerLoading();

              videoPlayer.play().catch((err) => {
                console.log('🔇 Автоплей заблокирован');
                videoPlayer.muted = true;
                videoPlayer.play().catch(() => { });
                updateMuteButton();
              });

              playbackStarted = true;
              updatePlayPauseButton();
              startTimecodeSaving();
              resetMouseIdleTimer();

              // Запускаем проверку приближения к концу видео
              if (nearEndCheckInterval) {
                clearInterval(nearEndCheckInterval);
              }
              startNearEndCheck();
            }
          }
        };

        bufferCheckInterval = setInterval(checkBuffer, 500);

        setTimeout(() => {
          if (!playbackStarted) {
            console.log('⚠️ Таймаут ожидания буфера, запускаем принудительно');

            if (bufferCheckInterval) {
              clearInterval(bufferCheckInterval);
              bufferCheckInterval = null;
            }

            hidePlayerLoading();

            videoPlayer.play().catch((err) => {
              console.log('🔇 Автоплей заблокирован');
              videoPlayer.muted = true;
              videoPlayer.play().catch(() => { });
              updateMuteButton();
            });

            playbackStarted = true;
            startTimecodeSaving();
            resetMouseIdleTimer();

            // Запускаем проверку приближения к концу видео
            if (nearEndCheckInterval) {
              clearInterval(nearEndCheckInterval);
            }
            startNearEndCheck();
          }
        }, 30000);
      });

      AppState.hls.on(Hls.Events.ERROR, (event, data) => {
        console.log('HLS событие ошибки:', {
          type: data.type,
          details: data.details,
          fatal: data.fatal,
          error: data.error ? data.error.message : 'Unknown error'
        });

        if (!data.fatal) {
          return;
        }

        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            console.log('🌐 Сетевая ошибка, пробуем восстановить...');
            AppState.hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            console.log('🎬 Медиа ошибка, пробуем восстановить...');
            AppState.hls.recoverMediaError();
            break;
          default:
            console.log('❌ Неизвестная фатальная ошибка');
            showPlayerLoading('Ошибка воспроизведения, перезагрузка...');
            setTimeout(() => {
              if (AppState.currentStreamId) {
                const videoPlayer = document.getElementById('video-player');
                const currentTime = videoPlayer.currentTime + AppState.seekOffset;
                startHLSPlayback(AppState.videoUrl, currentTime, false);
              }
            }, 2000);
            break;
        }
      });

    } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
      videoPlayer.src = data.playlistUrl;

      // Удаляем и добавляем обработчик для Safari
      videoPlayer.removeEventListener('ended', handleVideoEnded);
      videoPlayer.addEventListener('ended', handleVideoEnded);

      let playbackStarted = false;
      let bufferCheckInterval = null;

      videoPlayer.addEventListener('loadedmetadata', () => {
        forceUpdateDuration(AppState.expectedDuration, AppState.originalDuration, AppState.seekOffset);
        videoPlayer.currentTime = 0;
        videoPlayer.pause();
        updatePlayPauseButton();

        console.log('⏳ Ожидание накопления буфера 10 секунд... (Safari, видео на паузе)');
        showPlayerLoading('Буферизация... 0/10 сек', null);

        const checkBuffer = () => {
          if (playbackStarted) return;

          if (videoPlayer.buffered && videoPlayer.buffered.length > 0) {
            const bufferedEnd = videoPlayer.buffered.end(videoPlayer.buffered.length - 1);
            const currentTime = videoPlayer.currentTime;
            const bufferAhead = bufferedEnd - currentTime;

            showPlayerLoading(`Буферизация... ${Math.min(10, Math.floor(bufferAhead))}/10 сек`, null);

            if (bufferAhead >= 10) {
              console.log('✅ Буфер накоплен, запускаем воспроизведение (Safari)');

              if (bufferCheckInterval) {
                clearInterval(bufferCheckInterval);
                bufferCheckInterval = null;
              }

              hidePlayerLoading();

              videoPlayer.play().catch((err) => {
                videoPlayer.muted = true;
                videoPlayer.play().catch(() => { });
                updateMuteButton();
              });

              playbackStarted = true;
              startTimecodeSaving();
              resetMouseIdleTimer();

              // Запускаем проверку приближения к концу видео
              if (nearEndCheckInterval) {
                clearInterval(nearEndCheckInterval);
              }
              startNearEndCheck();
            }
          }
        };

        bufferCheckInterval = setInterval(checkBuffer, 500);

        setTimeout(() => {
          if (!playbackStarted) {
            console.log('⚠️ Таймаут ожидания буфера (Safari)');

            if (bufferCheckInterval) {
              clearInterval(bufferCheckInterval);
              bufferCheckInterval = null;
            }

            hidePlayerLoading();

            videoPlayer.play().catch((err) => {
              videoPlayer.muted = true;
              videoPlayer.play().catch(() => { });
              updateMuteButton();
            });

            playbackStarted = true;
            startTimecodeSaving();
            resetMouseIdleTimer();

            // Запускаем проверку приближения к концу видео
            if (nearEndCheckInterval) {
              clearInterval(nearEndCheckInterval);
            }
            startNearEndCheck();
          }
        }, 30000);

      }, { once: true });

      AppState.isPlaying = true;
    } else {
      throw new Error('Ваш браузер не поддерживает HLS');
    }

    const playerHint = document.getElementById('player-hint');
    playerHint.style.opacity = '1';
    if (AppState.hintTimeout) clearTimeout(AppState.hintTimeout);
    AppState.hintTimeout = setTimeout(() => { playerHint.style.opacity = '0'; }, 4000);

    return true;
  } catch (error) {
    console.error('❌ Ошибка:', error);
    alert('Ошибка воспроизведения: ' + error.message);
    return false;
  }
}
// Обновленная функция выхода из плеера
function showDetailView() {
  // Проверяем, не является ли текущее воспроизведение YouTube
  if (AppState.isYoutubePlayback) {
    console.log('🎬 Выход из YouTube плеера');

    if (typeof window.exitYoutubePlayer === 'function') {
      window.exitYoutubePlayer();
    } else {
      if (AppState.currentStreamId) {
        fetch(`${SERVER_URL}/hls/stop/${AppState.currentStreamId}`, { method: 'POST' }).catch(() => { });
        AppState.currentStreamId = null;
      }
      if (AppState.hls) {
        AppState.hls.destroy();
        AppState.hls = null;
      }
      AppState.isYoutubePlayback = false;
      AppState.currentScreen = 'catalog';
      document.getElementById('player-screen').style.display = 'none';

      const detailView = document.getElementById('detail-view');
      if (detailView && AppState.youtubeContext) {
        detailView.style.display = 'block';
        detailView.style.pointerEvents = 'auto';
      } else {
        if (typeof window.showCatalogList === 'function') {
          window.showCatalogList();
        }
      }
    }

    return;
  }

  // Сохраняем таймкод перед выходом
  saveTimecodeToServer().then(() => {
    // Останавливаем интервал сохранения
    stopTimecodeSaving();

    // После сохранения таймкода, обновляем прогресс в текущей карточке
    if (AppState.currentDetailItem) {
      console.log('🔄 Обновляем прогресс в текущей карточке:', AppState.currentDetailItem.title);
      updateDetailProgress(AppState.currentDetailItem);
    }
  });

  // Останавливаем проверку приближения к концу видео
  if (nearEndCheckInterval) {
    clearInterval(nearEndCheckInterval);
    nearEndCheckInterval = null;
  }

  // 🔥 СБРАСЫВАЕМ lastCleanedSegment ПРИ ВЫХОДЕ ИЗ ПЛЕЕРА
  if (typeof lastCleanedSegment !== 'undefined') {
    console.log(`🔄 Сброс lastCleanedSegment при выходе: ${lastCleanedSegment} -> -1`);
    lastCleanedSegment = -1;
  }

  // Сбрасываем информацию о сериях
  currentEpisodeFiles = [];
  currentEpisodeIndex = 0;
  currentTorrentHash = null;

  // Скрываем название
  updatePlayerTitle(null);

  // Очищаем данные таймкода
  clearTimecodeData();

  // Скрываем панель серий если открыта
  const episodesPanel = document.getElementById('episodes-panel');
  const episodesBtn = document.getElementById('episodes-btn');
  if (episodesPanel) {
    episodesPanel.classList.add('hidden');
    episodesBtn.classList.remove('active');
  }

  // Скрываем панель аудиодорожек
  const audioPanel = document.getElementById('audio-panel');
  const audioBtn = document.getElementById('audio-btn');
  if (audioPanel) {
    audioPanel.classList.add('hidden');
    if (audioBtn) audioBtn.classList.remove('active');
  }

  // Скрываем кнопки
  if (episodesBtn) {
    episodesBtn.style.display = 'none';
  }

  // Скрываем кнопки переключения серий
  const prevBtn = document.getElementById('prev-episode-btn');
  const nextBtn = document.getElementById('next-episode-btn');
  if (prevBtn) prevBtn.style.display = 'none';
  if (nextBtn) nextBtn.style.display = 'none';

  AppState.currentScreen = 'detail';
  const videoPlayer = document.getElementById('video-player');

  // Удаляем обработчик окончания видео
  videoPlayer.removeEventListener('ended', handleVideoEnded);

  videoPlayer.pause();
  videoPlayer.removeAttribute('src');
  videoPlayer.load();
  destroyHls();
  hidePlayerLoading();

  if (AppState.currentStreamId) {
    fetch(`${SERVER_URL}/hls/stop/${AppState.currentStreamId}`, { method: 'POST' }).catch(() => { });
    AppState.currentStreamId = null;
  }

  // Скрываем плеер
  document.getElementById('player-screen').style.display = 'none';

  // Показываем секцию торрентов
  document.getElementById('config-screen').style.display = 'none';
  document.getElementById('torrserver-section').style.display = 'block';

  setTimeout(() => {
    if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
      updateFocusableElements();

      const progressBtnIndex = typeof focusableElements !== 'undefined'
        ? focusableElements.findIndex(el => el && (el.classList.contains('detail-progress-btn') || el.classList.contains('file-item') || el.classList.contains('back-btn')))
        : -1;

      setFocus(progressBtnIndex !== -1 ? progressBtnIndex : 0);
    }
  }, 250);

  // Обновляем список торрентов в фоне
  refreshTorrentsList().then(() => {
    console.log('🔄 Список торрентов обновлен после выхода из плеера');

    if (AppState.currentDetailItem && AppState.currentDetailItem.hash) {
      const cacheKey = AppState.currentDetailItem.hash;
      if (progressCache.has(cacheKey)) {
        progressCache.delete(cacheKey);
        console.log('🗑️ Кэш прогресса очищен для', cacheKey);
      }
    }
  }).catch(error => {
    console.error('❌ Ошибка обновления списка:', error);
  });

  // Открываем карточку только если воспроизведение было из поиска
  if (lastPlaybackFromSearch && lastAddedTorrentHash) {
    console.log('📂 Открываем карточку торрента из поиска:', lastAddedTorrentHash);

    setTimeout(() => {
      const found = showDetailByHash(lastAddedTorrentHash);
      if (!found) {
        console.log('⚠️ Торрент не найден по hash, пробуем обновить список еще раз');
        refreshTorrentsList().then(() => {
          showDetailByHash(lastAddedTorrentHash);
        });
      }
    }, 500);

    lastPlaybackFromSearch = false;
  } else {
    console.log('📂 Возврат к исходной карточке (не из поиска)');
    if (AppState.currentDetailItem) {
      const detailView = document.getElementById('detail-view');
      detailView.style.display = 'block';
      updateDetailProgress(AppState.currentDetailItem);
    } else {
      document.getElementById('detail-view').style.display = 'none';
    }
  }
}

// НОВАЯ ФУНКЦИЯ: Обновление прогресса в детальном просмотре
async function updateDetailProgress(torrent) {
  if (!torrent || !torrent.hash) return;

  console.log('🔄 Обновление прогресса для:', torrent.title);

  // Очищаем кэш для этого торрента
  const cacheKey = torrent.hash;
  if (progressCache.has(cacheKey)) {
    progressCache.delete(cacheKey);
  }

  // Удаляем ВСЕ старые блоки прогресса (не только с id='detail-progress')
  const oldProgresses = document.querySelectorAll('#detail-progress, .detail-progress');
  oldProgresses.forEach(el => {
    console.log('🗑️ Удаляем старый блок прогресса');
    el.remove();
  });

  // Загружаем новый прогресс
  const progress = await loadProgressForTorrent(torrent);

  if (!progress) {
    console.log('📭 Нет прогресса для отображения');
    return;
  }

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

    startHLSPlayback(playUrl, timecode, false, episodeIndex).then(() => {
      document.getElementById('playback-overlay').classList.remove('active');
      document.getElementById('detail-view').style.pointerEvents = 'auto';
    }).catch(() => {
      document.getElementById('playback-overlay').classList.remove('active');
      document.getElementById('detail-view').style.pointerEvents = 'auto';
    });
  });

  // Убеждаемся, что вставляем только один раз
  const existingProgress = document.getElementById('detail-progress');
  if (existingProgress) {
    existingProgress.remove();
  }

  detailHeader.parentNode.insertBefore(progressDiv, detailHeader.nextSibling);
  console.log('✅ Прогресс обновлен в карточке');
}

// Переменные для хранения информации об аудиодорожках
let currentAudioTracks = [];
let currentAudioTrack = 0;
let currentFileInfo = null;

// НОВАЯ ФУНКЦИЯ: Загрузка информации о файле
async function loadFileInfo(hash, fileId) {
  try {
    const response = await fetch(`${SERVER_URL}/api/file/info?hash=${hash}&fileId=${fileId}`);
    if (response.ok) {
      const data = await response.json();
      return data;
    }
  } catch (error) {
    console.error('Ошибка загрузки информации о файле:', error);
  }
  return null;
}

// НОВАЯ ФУНКЦИЯ: Отображение списка аудиодорожек
function renderAudioTracks() {
  const audioList = document.getElementById('audio-list');
  if (!audioList) return;

  if (!currentAudioTracks || currentAudioTracks.length === 0) {
    audioList.innerHTML = '<div class="search-result-empty">Нет аудиодорожек</div>';
    return;
  }

  let html = '';

  currentAudioTracks.forEach((track, index) => {
    const isActive = index === currentAudioTrack;
    const language = track.language || 'unknown';
    const channels = track.channels ? `${track.channels} ch` : '';
    const codec = track.codec || '';

    html += `
      <div class="audio-item ${isActive ? 'active' : ''}" data-track-index="${index}">
        <div class="audio-icon">🔊</div>
        <div class="audio-info">
          <div class="audio-title">${escapeHtml(track.title || `Дорожка ${index + 1}`)}</div>
          <div class="audio-details">
            <span class="audio-language">${language.toUpperCase()}</span>
            ${channels ? `<span class="audio-channels">${channels}</span>` : ''}
            ${codec ? `<span class="audio-codec">${codec}</span>` : ''}
          </div>
        </div>
        <div class="audio-check">✓</div>
      </div>
    `;
  });

  audioList.innerHTML = html;

  // Добавляем обработчики
  audioList.querySelectorAll('.audio-item').forEach(item => {
    item.addEventListener('click', () => {
      const trackIndex = parseInt(item.dataset.trackIndex);
      switchAudioTrack(trackIndex);
    });
  });
}

// НОВАЯ ФУНКЦИЯ: Переключение аудиодорожки
async function switchAudioTrack(trackIndex) {
  if (trackIndex === currentAudioTrack) {
    toggleAudioPanel();
    return;
  }

  console.log(`🔊 Переключение на аудиодорожку ${trackIndex}`);

  // Сохраняем текущий таймкод
  await saveTimecodeToServer();

  // Сохраняем предпочтение аудиодорожки
  if (currentTimecodeData.hash && currentTimecodeData.fileId) {
    await saveAudioPreference(currentTimecodeData.hash, currentTimecodeData.fileId, trackIndex);
  }

  // Закрываем панель
  const audioPanel = document.getElementById('audio-panel');
  const audioBtn = document.getElementById('audio-btn');
  if (audioPanel) {
    audioPanel.classList.add('hidden');
    audioBtn.classList.remove('active');
  }

  // Получаем текущее время
  const videoPlayer = document.getElementById('video-player');
  const currentTime = videoPlayer.currentTime + AppState.seekOffset;

  // Показываем оверлей загрузки
  document.getElementById('playback-overlay').classList.add('active');
  document.querySelector('.playback-text').textContent = `Переключение аудиодорожки...`;

  try {
    // Формируем URL с параметром аудиодорожки
    const parsed = AppState.videoUrl.match(/\/play\/([a-fA-F0-9]+)\/(\d+)/);
    if (!parsed) return;

    const hash = parsed[1];
    const fileId = parsed[2];
    const playUrl = `${AppState.currentTorrserverUrl}/play/${hash}/${fileId}`;

    // Останавливаем текущий поток
    if (AppState.currentStreamId) {
      await fetch(`${SERVER_URL}/hls/stop/${AppState.currentStreamId}`, { method: 'POST' });
      AppState.currentStreamId = null;
    }

    destroyHls();

    // Запускаем новый поток с выбранной аудиодорожкой и текущим временем
    await startHLSPlayback(playUrl, currentTime, lastPlaybackFromSearch, currentEpisodeIndex, trackIndex);

    // Обновляем текущую дорожку
    currentAudioTrack = trackIndex;

    // Обновляем отображение
    renderAudioTracks();

  } catch (error) {
    console.error('❌ Ошибка переключения аудиодорожки:', error);
    alert('Ошибка при переключении аудиодорожки');
  } finally {
    document.getElementById('playback-overlay').classList.remove('active');
    document.querySelector('.playback-text').textContent = 'Воспроизведение...';
  }
}

// НОВАЯ ФУНКЦИЯ: Открытие/закрытие панели аудиодорожек
function toggleAudioPanel() {
  const panel = document.getElementById('audio-panel');
  const btn = document.getElementById('audio-btn');
  const episodesPanel = document.getElementById('episodes-panel');
  const episodesBtn = document.getElementById('episodes-btn');

  if (!panel || !btn) return;

  if (panel.classList.contains('hidden')) {
    // Закрываем панель серий если открыта
    if (episodesPanel && !episodesPanel.classList.contains('hidden')) {
      episodesPanel.classList.add('hidden');
      episodesBtn.classList.remove('active');
    }

    panel.classList.remove('hidden');
    btn.classList.add('active');
    renderAudioTracks();
  } else {
    panel.classList.add('hidden');
    btn.classList.remove('active');
  }
}

// НОВАЯ ФУНКЦИЯ: Настройка кнопки аудиодорожек
function setupAudioButton() {
  console.log('🔄 Настройка кнопки аудиодорожек...');

  const audioBtn = document.getElementById('audio-btn');
  const closeAudioBtn = document.getElementById('close-audio');
  const audioPanel = document.getElementById('audio-panel');

  if (!audioBtn || !closeAudioBtn || !audioPanel) {
    console.error('❌ Не найдены элементы для кнопки аудиодорожек');
    return;
  }

  audioBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleAudioPanel();
    resetMouseIdleTimer();
  });

  closeAudioBtn.addEventListener('click', () => {
    audioPanel.classList.add('hidden');
    audioBtn.classList.remove('active');
    resetMouseIdleTimer();
  });

  // Закрытие панели при клике вне её
  document.addEventListener('click', (e) => {
    if (!audioPanel.contains(e.target) && !audioBtn.contains(e.target)) {
      audioPanel.classList.add('hidden');
      audioBtn.classList.remove('active');
    }
  });

  console.log('✅ Кнопка аудиодорожек настроена');
}



// НОВАЯ ФУНКЦИЯ: Сохранение предпочтения аудиодорожки
async function saveAudioPreference(hash, fileId, audioTrack) {
  try {
    const response = await fetch(`${SERVER_URL}/api/audio/pref/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash, fileId, audioTrack })
    });

    if (response.ok) {
      console.log(`🎵 Предпочтение аудиодорожки сохранено: ${audioTrack}`);
    }
  } catch (error) {
    console.error('Ошибка сохранения предпочтения аудиодорожки:', error);
  }
}

// НОВАЯ ФУНКЦИЯ: Загрузка предпочтения аудиодорожки
async function loadAudioPreference(hash, fileId) {
  try {
    const response = await fetch(`${SERVER_URL}/api/audio/pref/get?hash=${hash}&fileId=${fileId}`);
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.audioTrack !== null) {
        console.log(`🎵 Загружено предпочтение аудиодорожки: ${data.audioTrack}`);
        return data.audioTrack;
      }
    }
  } catch (error) {
    console.error('Ошибка загрузки предпочтения аудиодорожки:', error);
  }
  return null;
}

async function handleVideoEnded() {
  console.log('🏁 Видео завершено');

  // Сохраняем таймкод перед переключением
  await saveTimecodeToServer();

  // Проверяем, есть ли следующая серия
  if (currentEpisodeFiles.length > 0 && currentEpisodeIndex < currentEpisodeFiles.length - 1) {
    console.log('➡️ Автоматическое переключение на следующую серию');

    // Показываем оверлей загрузки
    document.getElementById('playback-overlay').classList.add('active');
    document.querySelector('.playback-text').textContent = `Автоматическое переключение на серию ${currentEpisodeIndex + 2}...`;

    // Блокируем кнопки управления
    const controlBtns = document.querySelectorAll('.control-btn');
    controlBtns.forEach(btn => {
      btn.style.pointerEvents = 'none';
      btn.style.opacity = '0.5';
    });

    try {
      // Переключаем на следующую серию
      const nextFile = currentEpisodeFiles[currentEpisodeIndex + 1];
      await switchToEpisode(currentEpisodeIndex + 1, nextFile.id);
    } catch (error) {
      console.error('❌ Ошибка автоматического переключения:', error);
    } finally {
      // Скрываем оверлей и разблокируем интерфейс
      document.getElementById('playback-overlay').classList.remove('active');
      document.querySelector('.playback-text').textContent = 'Воспроизведение...';

      controlBtns.forEach(btn => {
        btn.style.pointerEvents = 'auto';
        btn.style.opacity = '1';
      });
    }
  } else {
    // Если серий больше нет или сериальный режим не активен, закрываем плеер
    console.log('🎬 Серии закончились или сериальный режим не активен, закрываем плеер');

    // Показываем сообщение перед закрытием
    const overlay = document.getElementById('playback-overlay');
    overlay.classList.add('active');
    document.querySelector('.playback-text').textContent = 'Воспроизведение завершено';

    // Небольшая задержка перед закрытием, чтобы пользователь увидел сообщение
    setTimeout(() => {
      overlay.classList.remove('active');
      // Закрываем плеер
      showDetailView();
    }, 1500);
  }
}

function startNearEndCheck() {
  if (nearEndCheckInterval) {
    clearInterval(nearEndCheckInterval);
  }

  nearEndCheckInterval = setInterval(() => {
    const videoPlayer = document.getElementById('video-player');
    const totalDuration = AppState.originalDuration || AppState.expectedDuration || videoPlayer.duration;
    const currentTime = videoPlayer.currentTime + AppState.seekOffset;

    // Если до конца осталось меньше 5 секунд и видео не на паузе и не завершено
    if (totalDuration > 0 &&
      currentTime >= totalDuration - 5 &&
      !videoPlayer.paused &&
      !videoPlayer.ended) {

      console.log('⚠️ Приближаемся к концу видео, осталось:', (totalDuration - currentTime).toFixed(1), 'сек');

      // Можно добавить визуальное предупреждение здесь
      // Например, показать уведомление о скором переключении серии
    }
  }, 1000);
}

function exitPlayer() {
  if (nearEndCheckInterval) {
    clearInterval(nearEndCheckInterval);
    nearEndCheckInterval = null;
  }
}

// Делаем функции доступными глобально
window.showDetailView = showDetailView;
window.setupEpisodesButton = setupEpisodesButton;
window.nextEpisode = nextEpisode;
window.prevEpisode = prevEpisode;
window.exitPlayer = exitPlayer;
