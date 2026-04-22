// local.js - Модуль для работы с локальными файлами

// Состояние локального каталога
var LocalState = {
    files: [],
    currentPath: '',
    scanSubdirs: true,
    isLoading: false,
    posterCache: new Map(),
    currentFile: null,
    lastSelectedIndex: 0,
    lastSelectedPath: null
};

// Кэш для локальных файлов
var localFilesCache = null;
var LOCAL_CACHE_KEY = 'local_media_cache';
var LOCAL_CACHE_TTL = 5 * 60 * 1000; // 5 минут

// Загрузка настроек локального каталога
function loadLocalSettings() {
    var savedPath = localStorage.getItem('localMediaPath');
    var savedScanSubdirs = localStorage.getItem('localScanSubdirs');

    var pathInput = document.getElementById('local-media-path');
    var scanCheckbox = document.getElementById('local-scan-subdirs');

    if (savedPath && pathInput) {
        pathInput.value = savedPath;
        LocalState.currentPath = savedPath;
    }

    if (savedScanSubdirs !== null && scanCheckbox) {
        scanCheckbox.checked = savedScanSubdirs === 'true';
        LocalState.scanSubdirs = scanCheckbox.checked;
    }
}

// Сохранение настроек локального каталога
function saveLocalSettings() {
    var pathInput = document.getElementById('local-media-path');
    var scanCheckbox = document.getElementById('local-scan-subdirs');

    if (pathInput) {
        localStorage.setItem('localMediaPath', pathInput.value);
        LocalState.currentPath = pathInput.value;
    }

    if (scanCheckbox) {
        localStorage.setItem('localScanSubdirs', scanCheckbox.checked);
        LocalState.scanSubdirs = scanCheckbox.checked;
    }
}

// Сканирование локального каталога
async function scanLocalDirectory() {
    var pathInput = document.getElementById('local-media-path');
    var statsDiv = document.getElementById('local-stats');
    var scanBtn = document.getElementById('scan-local-btn');

    var mediaPath = pathInput ? pathInput.value.trim() : '';

    if (!mediaPath) {
        if (statsDiv) statsDiv.innerHTML = '<span style="color: #ff6a6a;">❌ Укажите путь к папке</span>';
        return false;
    }

    saveLocalSettings();

    LocalState.isLoading = true;
    if (scanBtn) {
        scanBtn.disabled = true;
        scanBtn.textContent = 'Сканирование...';
    }
    if (statsDiv) statsDiv.innerHTML = '<span style="color: #ffd966;">🔄 Сканирование...</span>';

    try {
        var response = await fetch(SERVER_URL + '/api/local/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: mediaPath,
                scanSubdirs: LocalState.scanSubdirs
            })
        });

        if (!response.ok) {
            throw new Error('HTTP ' + response.status);
        }

        var data = await response.json();

        if (data.success) {
            LocalState.files = data.files || [];

            // Сохраняем в кэш
            localFilesCache = {
                files: LocalState.files.slice(),
                timestamp: Date.now(),
                path: mediaPath
            };
            localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(localFilesCache));

            var fileCount = LocalState.files.length;
            var sizeTotal = LocalState.files.reduce(function (sum, f) { return sum + (f.size || 0); }, 0);

            if (statsDiv) {
                statsDiv.innerHTML = '<span style="color: #4eff6a;">✅ Найдено ' + fileCount + ' файлов (' + formatBytes(sizeTotal) + ')</span>';
            }

            // Если мы на вкладке локального каталога, обновляем отображение
            if (AppState.currentScreen === 'local') {
                renderLocalFiles();
            }

            return true;
        } else {
            throw new Error(data.error || 'Ошибка сканирования');
        }

    } catch (error) {
        console.error('❌ Ошибка сканирования:', error);
        if (statsDiv) statsDiv.innerHTML = '<span style="color: #ff6a6a;">❌ ' + error.message + '</span>';
        return false;
    } finally {
        LocalState.isLoading = false;
        if (scanBtn) {
            scanBtn.disabled = false;
            scanBtn.textContent = 'Сканировать';
        }
    }
}

// Загрузка кэшированных локальных файлов
function loadLocalFilesFromCache() {
    var cached = localStorage.getItem(LOCAL_CACHE_KEY);
    if (cached) {
        try {
            var data = JSON.parse(cached);
            if (data && data.files && data.timestamp && (Date.now() - data.timestamp < LOCAL_CACHE_TTL)) {
                LocalState.files = data.files;
                console.log('📦 Загружено из кэша ' + LocalState.files.length + ' локальных файлов');
                return true;
            }
        } catch (e) {
            console.error('Ошибка чтения кэша:', e);
        }
    }
    return false;
}

// Очистка кэша локальных файлов
function clearLocalCache() {
    localStorage.removeItem(LOCAL_CACHE_KEY);
    localFilesCache = null;
    LocalState.files = [];
    LocalState.posterCache.clear();

    var statsDiv = document.getElementById('local-stats');
    if (statsDiv) statsDiv.innerHTML = '<span style="color: #ffd966;">🧹 Кэш очищен</span>';

    if (AppState.currentScreen === 'local') {
        renderLocalFiles();
    }

    console.log('🗑️ Кэш локальных файлов очищен');
}

// Получение постера для локального файла по имени
async function getLocalFilePoster(fileName, folderPath) {
    var cacheKey = folderPath + '_' + fileName;

    if (LocalState.posterCache.has(cacheKey)) {
        return LocalState.posterCache.get(cacheKey);
    }

    // Пытаемся найти постер по имени файла
    var cleanName = fileName
        .replace(/\.(mp4|mkv|avi|mov|webm|m4v)$/i, '')
        .replace(/[\[\(].*?[\]\)]/g, '')
        .trim();

    // Извлекаем год
    var yearMatch = cleanName.match(/\b(19|20)\d{2}\b/);
    var year = yearMatch ? yearMatch[0] : null;
    if (year) cleanName = cleanName.replace(year, '').trim();

    // Определяем тип (сериал или фильм)
    var isSeries = /s\d{2}e\d{2}|season|\d+ серия|сезон/i.test(fileName);
    var mediaType = isSeries ? 'tv' : 'movie';

    try {
        var posterUrl = await tmdb.searchPoster(cleanName, year, mediaType, true);

        if (posterUrl) {
            LocalState.posterCache.set(cacheKey, posterUrl);
            return posterUrl;
        }
    } catch (e) {
        console.warn('Ошибка поиска постера для', fileName, e);
    }

    LocalState.posterCache.set(cacheKey, null);
    return null;
}

// Определение типа файла (сериал или фильм)
function detectLocalFileType(fileName, filesInFolder) {
    // Если в папке несколько видеофайлов - вероятно сериал
    if (filesInFolder && filesInFolder.length > 1) {
        return 'tv';
    }

    // Проверяем по имени
    var lowerName = fileName.toLowerCase();
    if (/s\d{2}e\d{2}|season|\d+ серия|сезон|episode/i.test(lowerName)) {
        return 'tv';
    }

    return 'movie';
}

// Получение информации о сериях из папки
function getEpisodesFromFolder(folderPath, files) {
    var videoFiles = files.filter(function (f) {
        return /\.(mp4|mkv|avi|mov|webm|m4v)$/i.test(f.name);
    });

    // Сортируем по имени
    videoFiles.sort(function (a, b) {
        return a.name.localeCompare(b.name);
    });

    return videoFiles.map(function (file, idx) {
        // Извлекаем номер серии из имени
        var episodeNum = idx + 1;
        var match = file.name.match(/[sS](\d+)[eE](\d+)/);
        if (match && match[2]) {
            episodeNum = parseInt(match[2], 10);
        } else {
            match = file.name.match(/(\d+)\s*серия/i);
            if (match && match[1]) episodeNum = parseInt(match[1], 10);
        }

        return {
            id: file.id,
            name: file.name,
            path: file.path,
            size: file.size,
            episodeNumber: episodeNum,
            index: idx
        };
    });
}

// Создание карточки локального файла
function createLocalFileCard(file, index) {
    var card = document.createElement('div');
    card.className = 'torrent-card local-card';
    card.dataset.localIndex = index;
    card.dataset.filePath = file.path;
    card.dataset.fileName = file.name;

    var fileName = file.name;
    var fileSize = formatBytes(file.size);
    var fileExt = fileName.split('.').pop().toUpperCase();

    // Определяем тип
    var fileType = detectLocalFileType(fileName, null);
    var typeLabel = fileType === 'tv' ? 'Сериал' : 'Фильм';

    card.innerHTML = '\n        <div class="torrent-poster">\n            <div class="no-poster" style="display: flex; align-items: center; justify-content: center; height: 100%; font-size: 32px;">\n                📁\n            </div>\n        </div>\n        <div class="torrent-info">\n            <div class="torrent-title">' + escapeHtml(fileName.substring(0, 60)) + (fileName.length > 60 ? '...' : '') + '</div>\n            <div class="torrent-meta">\n                <span>' + fileSize + '</span>\n                <span class="torrent-badge local-badge">' + typeLabel + '</span>\n            </div>\n        </div>\n    ';

    // Асинхронно загружаем постер
    (function (cardEl, fName, fPath, idx) {
        var folderPath = fPath.substring(0, fPath.lastIndexOf('/'));
        getLocalFilePoster(fName, folderPath).then(function (posterUrl) {
            if (posterUrl && cardEl && cardEl.querySelector('.torrent-poster')) {
                var posterDiv = cardEl.querySelector('.torrent-poster');
                posterDiv.innerHTML = '<img src="' + posterUrl + '" loading="lazy" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.parentElement.innerHTML=\'<div class=\\\'no-poster\\\' style=\\\'display: flex; align-items: center; justify-content: center; height: 100%; font-size: 32px;\\\'>📁</div>\'">';
            }
        });
    })(card, fileName, file.path, index);

    card.addEventListener('click', function () {
        onLocalFileClick(file, index);
    });

    return card;
}

// Обработчик клика по локальному файлу
async function onLocalFileClick(file, index) {
    console.log('📂 Выбран локальный файл:', file.name);

    LocalState.lastSelectedIndex = index;
    LocalState.lastSelectedPath = file.path;
    LocalState.currentFile = file;

    // Определяем, есть ли в той же папке другие файлы (для сериалов)
    var folderPath = file.path.substring(0, file.path.lastIndexOf('/'));
    var filesInFolder = LocalState.files.filter(function (f) {
        return f.path.substring(0, f.path.lastIndexOf('/')) === folderPath;
    });

    var fileType = detectLocalFileType(file.name, filesInFolder);

    if (fileType === 'tv' && filesInFolder.length > 1) {
        // Это сериал - показываем детали с сериями
        await showLocalSeriesDetail(file, filesInFolder, index);
    } else {
        // Это фильм - сразу воспроизводим
        await playLocalFile(file.path, file.name);
    }
}

// Показ деталей локального сериала
async function showLocalSeriesDetail(file, filesInFolder, index) {
    var folderPath = file.path.substring(0, file.path.lastIndexOf('/'));
    var folderName = folderPath.split('/').pop() || 'Сериал';

    var episodes = getEpisodesFromFolder(folderPath, filesInFolder);
    var currentEpisodeIndex = episodes.findIndex(function (e) { return e.id === file.id; });

    // Создаем объект, совместимый с catalog.js
    var seriesItem = {
        id: 'local_' + Date.now(),
        media_type: 'tv',
        title: folderName,
        name: folderName,
        torrent: [{ name: folderName }],
        localPath: folderPath,
        localEpisodes: episodes,
        localCurrentEpisode: currentEpisodeIndex
    };

    // Показываем детальный просмотр (переиспользуем catalog.js)
    if (typeof window.showCatalogDetail === 'function') {
        AppState.currentScreen = 'detail';
        AppState.detailReturnTo = 'local';
        AppState.currentDetailItem = seriesItem;

        await window.showCatalogDetail(seriesItem, index, null);

        // Модифицируем кнопку для локального воспроизведения
        setTimeout(function () {
            var watchBtn = document.getElementById('catalog-watch-btn');
            if (watchBtn) {
                watchBtn.textContent = 'Воспроизвести серию';
                watchBtn.onclick = function () {
                    playLocalEpisode(seriesItem, currentEpisodeIndex);
                };
            }
        }, 100);
    }
}

// Воспроизведение серии локального сериала
async function playLocalEpisode(seriesItem, episodeIndex) {
    var episodes = seriesItem.localEpisodes;
    if (!episodes || episodeIndex >= episodes.length) return;

    var episode = episodes[episodeIndex];
    await playLocalFile(episode.path, seriesItem.title + ' - ' + episode.name);
}

// Воспроизведение локального файла
async function playLocalFile(filePath, title) {
    console.log('▶️ Воспроизведение локального файла:', filePath, title);

    document.getElementById('playback-overlay').classList.add('active');
    document.querySelector('.playback-text').textContent = 'Загрузка локального файла...';

    try {
        var response = await fetch(SERVER_URL + '/api/local/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: filePath })
        });

        if (!response.ok) {
            var errorData = await response.json();
            throw new Error(errorData.error || 'Ошибка воспроизведения');
        }

        var streamData = await response.json();

        if (!streamData.success) {
            throw new Error(streamData.error || 'Ошибка создания потока');
        }

        console.log('✅ Локальный поток создан:', streamData);

        // Используем существующий плеер
        if (typeof startHLSPlayback === 'function') {
            await startHLSPlayback(streamData.playlistUrl, 0, false, null, null);

            // Обновляем заголовок плеера
            if (typeof updatePlayerTitle === 'function') {
                updatePlayerTitle(title);
            }
        } else {
            throw new Error('Плеер не инициализирован');
        }

    } catch (error) {
        console.error('❌ Ошибка воспроизведения локального файла:', error);
        alert('Ошибка воспроизведения: ' + error.message);
    } finally {
        document.getElementById('playback-overlay').classList.remove('active');
        document.querySelector('.playback-text').textContent = 'Воспроизведение...';
    }
}

// Отображение списка локальных файлов
function renderLocalFiles() {
    var torrentsGrid = document.getElementById('torrents-grid');
    if (!torrentsGrid) return;

    torrentsGrid.innerHTML = '';

    if (LocalState.files.length === 0) {
        var hasPath = !!LocalState.currentPath;
        torrentsGrid.innerHTML = '\n            <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">\n                <div style="font-size: 48px; margin-bottom: 20px;">📁</div>\n                <div style="font-size: 18px; color: #aaa; margin-bottom: 10px;">' +
            (hasPath ? 'Нет видеофайлов' : 'Не настроен локальный каталог') +
            '</div>\n                <div style="font-size: 14px; color: #666;">' +
            (hasPath ? 'Нажмите "Сканировать" в настройках' : 'Перейдите в настройки и укажите путь к папке с медиафайлами') +
            '</div>\n            </div>\n        ';
        return;
    }

    // Добавляем заголовок
    var header = document.createElement('div');
    header.className = 'catalog-header';
    header.innerHTML = '\n        <span>📁 Локальный каталог</span>\n        <span>' + LocalState.files.length + ' файлов</span>\n    ';
    torrentsGrid.appendChild(header);

    // Добавляем карточки
    for (var i = 0; i < LocalState.files.length; i++) {
        var card = createLocalFileCard(LocalState.files[i], i);
        torrentsGrid.appendChild(card);
    }

    setTimeout(function () {
        if (AppState.currentScreen === 'local') {
            if (typeof updateFocusableElements === 'function') {
                updateFocusableElements();
            }
            setTimeout(function () {
                if (typeof window.focusFirstLocalCard === 'function') {
                    window.focusFirstLocalCard();
                }
            }, 100);
        }
    }, 200);
}

// Фокус на первую карточку локального каталога
function focusFirstLocalCard() {
    if (AppState.currentScreen !== 'local') return false;

    if (typeof updateFocusableElements === 'function') {
        updateFocusableElements();
    }

    var firstCardIndex = -1;
    for (var i = 0; i < focusableElements.length; i++) {
        if (focusableElements[i].classList && focusableElements[i].classList.contains('local-card')) {
            firstCardIndex = i;
            break;
        }
    }

    if (firstCardIndex !== -1 && typeof setFocus === 'function') {
        setFocus(firstCardIndex);
        return true;
    }

    return false;
}

// Показать локальный каталог
function showLocalCatalog() {
    console.log('📁 Открытие локального каталога');

    var tabLocal = document.getElementById('tab-local');
    var tabTorrents = document.getElementById('tab-torrents');
    var tabSearch = document.getElementById('tab-search');
    var tabCatalog = document.getElementById('tab-catalog');
    var tabDonate = document.getElementById('tab-donate');
    var searchOverlay = document.getElementById('search-overlay');

    if (tabLocal) tabLocal.classList.add('active');
    if (tabTorrents) tabTorrents.classList.remove('active');
    if (tabSearch) tabSearch.classList.remove('active');
    if (tabCatalog) tabCatalog.classList.remove('active');
    if (tabDonate) tabDonate.classList.remove('active');
    if (searchOverlay) searchOverlay.classList.add('hidden');

    AppState.currentScreen = 'local';

    // Загружаем из кэша или показываем сообщение
    if (LocalState.files.length === 0) {
        loadLocalFilesFromCache();
    }

    renderLocalFiles();
}

// Настройка обработчиков для локального каталога
function setupLocal() {
    console.log('🔧 Настройка локального каталога...');

    loadLocalSettings();

    // Кнопка сканирования
    var scanBtn = document.getElementById('scan-local-btn');
    if (scanBtn) {
        scanBtn.addEventListener('click', function () {
            scanLocalDirectory();
        });
    }

    // Кнопка очистки кэша
    var clearBtn = document.getElementById('clear-local-cache-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', function () {
            clearLocalCache();
        });
    }

    // Сохранение настроек при изменении
    var pathInput = document.getElementById('local-media-path');
    if (pathInput) {
        pathInput.addEventListener('change', function () {
            saveLocalSettings();
        });
    }

    var scanCheckbox = document.getElementById('local-scan-subdirs');
    if (scanCheckbox) {
        scanCheckbox.addEventListener('change', function () {
            saveLocalSettings();
            LocalState.scanSubdirs = scanCheckbox.checked;
        });
    }

    // Вкладка локального каталога
    var tabLocal = document.getElementById('tab-local');
    if (tabLocal) {
        tabLocal.addEventListener('click', function () {
            showLocalCatalog();
        });
    }

    // Показываем статистику при загрузке
    if (loadLocalFilesFromCache() && LocalState.files.length > 0) {
        var statsDiv = document.getElementById('local-stats');
        if (statsDiv) {
            var totalSize = LocalState.files.reduce(function (sum, f) { return sum + (f.size || 0); }, 0);
            statsDiv.innerHTML = '<span style="color: #4eff6a;">✅ ' + LocalState.files.length + ' файлов (' + formatBytes(totalSize) + ') в кэше</span>';
        }
    }

    console.log('✅ Локальный каталог настроен');
}

// Экспорт функций
window.showLocalCatalog = showLocalCatalog;
window.focusFirstLocalCard = focusFirstLocalCard;
window.scanLocalDirectory = scanLocalDirectory;
window.clearLocalCache = clearLocalCache;

// Инициализация
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupLocal);
} else {
    setupLocal();
}