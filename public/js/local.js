// local.js - Модуль для работы с локальными файлами

// Состояние локального каталога
var LocalState = {
    files: [],
    folders: [],
    currentPath: '',
    scanSubdirs: true,
    isLoading: false,
    posterCache: new Map(),
    currentFile: null,
    lastSelectedIndex: 0,
    lastSelectedPath: null,
    viewMode: 'grid', // 'grid' или 'folders'
    expandedFolders: new Map() // для хранения состояния раскрытых папок
};

// Кэш для локальных файлов
var localFilesCache = null;
var LOCAL_CACHE_KEY = 'local_media_cache';
var LOCAL_CACHE_TTL = 5 * 60 * 1000; // 5 минут

// Загрузка настроек локального каталога
function loadLocalSettings() {
    var savedPath = localStorage.getItem('localMediaPath');
    var savedScanSubdirs = localStorage.getItem('localScanSubdirs');
    var savedViewMode = localStorage.getItem('localViewMode');

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

    if (savedViewMode) {
        LocalState.viewMode = savedViewMode;
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

    localStorage.setItem('localViewMode', LocalState.viewMode);
}

// Построение древовидной структуры папок
function buildFolderTree(files) {
    if (!files || files.length === 0) {
        return [];
    }

    var tree = {};

    for (var i = 0; i < files.length; i++) {
        var file = files[i];
        if (!file || !file.path) continue;

        // Нормализуем путь (заменяем обратные слеши на прямые)
        var normalizedPath = file.path.replace(/\\/g, '/');
        var pathParts = normalizedPath.split('/');
        var fileName = pathParts.pop();
        var currentLevel = tree;

        // Создаем вложенную структуру
        for (var j = 0; j < pathParts.length; j++) {
            var part = pathParts[j];
            if (!part) continue;

            if (!currentLevel[part]) {
                currentLevel[part] = {
                    name: part,
                    fullPath: pathParts.slice(0, j + 1).join('/'),
                    files: [],
                    subfolders: {},
                    isExpanded: LocalState.expandedFolders.get(pathParts.slice(0, j + 1).join('/')) || false
                };
            }
            currentLevel = currentLevel[part].subfolders;
        }

        // Добавляем файл в текущую папку
        var folderKey = pathParts.join('/');
        var targetFolder = tree;
        for (var k = 0; k < pathParts.length; k++) {
            var partName = pathParts[k];
            if (!partName) break;
            if (!targetFolder[partName]) {
                targetFolder[partName] = {
                    name: partName,
                    fullPath: pathParts.slice(0, k + 1).join('/'),
                    files: [],
                    subfolders: {},
                    isExpanded: false
                };
            }
            if (k < pathParts.length - 1) {
                targetFolder = targetFolder[partName].subfolders;
            } else {
                targetFolder = targetFolder[partName];
            }
        }

        if (targetFolder && targetFolder.files) {
            targetFolder.files.push(file);
        }
    }

    // Преобразуем дерево в массив для отображения
    function flattenTree(node, parentPath) {
        if (!node || typeof node !== 'object') {
            return [];
        }

        var result = [];
        var folders = Object.keys(node);

        for (var i = 0; i < folders.length; i++) {
            var folderName = folders[i];
            var folder = node[folderName];

            if (!folder || typeof folder !== 'object') continue;

            var fullPath = parentPath ? parentPath + '/' + folderName : folderName;

            result.push({
                type: 'folder',
                name: folderName,
                fullPath: fullPath,
                files: folder.files || [],
                subfoldersCount: Object.keys(folder.subfolders || {}).length,
                isExpanded: folder.isExpanded || false,
                children: flattenTree(folder.subfolders || {}, fullPath)
            });

            if (folder.isExpanded && folder.children && folder.children.length) {
                for (var j = 0; j < folder.children.length; j++) {
                    result.push(folder.children[j]);
                }
            }
        }

        return result;
    }

    return flattenTree(tree, '');
}

// Получение постера для папки (по первому файлу или по имени)
async function getFolderPoster(folderName, folderPath, files) {
    var cacheKey = 'folder_' + folderPath;

    if (LocalState.posterCache.has(cacheKey)) {
        return LocalState.posterCache.get(cacheKey);
    }

    // Сначала пробуем найти постер по первому видеофайлу в папке
    var videoFiles = files.filter(function (f) {
        return f && f.name && /\.(mp4|mkv|avi|mov|webm|m4v)$/i.test(f.name);
    });

    if (videoFiles.length > 0) {
        var firstFile = videoFiles[0];
        var poster = await getLocalFilePoster(firstFile.name, folderPath);
        if (poster) {
            LocalState.posterCache.set(cacheKey, poster);
            return poster;
        }
    }

    // Если не нашли, пробуем по имени папки
    var cleanName = folderName
        .replace(/[\[\(].*?[\]\)]/g, '')
        .replace(/\./g, ' ')
        .trim();

    var yearMatch = cleanName.match(/\b(19|20)\d{2}\b/);
    var year = yearMatch ? yearMatch[0] : null;
    if (year) cleanName = cleanName.replace(year, '').trim();

    var isSeries = /s\d{2}e\d{2}|season|\d+ серия|сезон|tv|series/i.test(folderName);
    var mediaType = isSeries ? 'tv' : 'movie';

    try {
        var posterUrl = await tmdb.searchPoster(cleanName, year, mediaType, true);
        if (posterUrl) {
            LocalState.posterCache.set(cacheKey, posterUrl);
            return posterUrl;
        }
    } catch (e) {
        console.warn('Ошибка поиска постера для папки', folderName, e);
    }

    LocalState.posterCache.set(cacheKey, null);
    return null;
}

// Определение типа папки (сериал или фильм)
function detectFolderType(folderName, files) {
    if (!files) return 'movie';

    var videoFiles = files.filter(function (f) {
        return f && f.name && /\.(mp4|mkv|avi|mov|webm|m4v)$/i.test(f.name);
    });

    // Если в папке несколько видеофайлов - сериал
    if (videoFiles.length > 1) {
        return 'tv';
    }

    // Проверяем по имени
    var lowerName = (folderName || '').toLowerCase();
    if (/s\d{2}e\d{2}|season|\d+ серия|сезон|episode|tv|series/i.test(lowerName)) {
        return 'tv';
    }

    return 'movie';
}

// Создание карточки папки
function createFolderCard(folder, index) {
    var card = document.createElement('div');
    card.className = 'torrent-card local-folder-card';
    card.dataset.folderIndex = index;
    card.dataset.folderPath = folder.fullPath;
    card.dataset.folderName = folder.name;

    var fileCount = folder.files ? folder.files.length : 0;
    var folderType = detectFolderType(folder.name, folder.files);
    var typeLabel = folderType === 'tv' ? 'Сериал' : 'Фильм';
    var fileCountText = fileCount + ' ' + (fileCount === 1 ? 'файл' : (fileCount < 5 ? 'файла' : 'файлов'));

    card.innerHTML = '\n        <div class="torrent-poster folder-poster">\n            <div class="no-poster" style="display: flex; align-items: center; justify-content: center; height: 100%; font-size: 48px;">\n                📁\n            </div>\n        </div>\n        <div class="torrent-info">\n            <div class="torrent-title">' + escapeHtml((folder.name || '').substring(0, 50)) + ((folder.name || '').length > 50 ? '...' : '') + '</div>\n            <div class="torrent-meta">\n                <span>' + fileCountText + '</span>\n                <span class="torrent-badge local-folder-badge">' + typeLabel + '</span>\n            </div>\n        </div>\n    ';

    // Асинхронно загружаем постер
    (function (cardEl, fName, fPath, fFiles, idx) {
        getFolderPoster(fName, fPath, fFiles).then(function (posterUrl) {
            if (posterUrl && cardEl && cardEl.querySelector('.torrent-poster')) {
                var posterDiv = cardEl.querySelector('.torrent-poster');
                posterDiv.innerHTML = '<img src="' + posterUrl + '" loading="lazy" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.parentElement.innerHTML=\'<div class=\\\'no-poster\\\' style=\\\'display: flex; align-items: center; justify-content: center; height: 100%; font-size: 48px;\\\'>📁</div>\'">';
            }
        });
    })(card, folder.name, folder.fullPath, folder.files || [], index);

    card.addEventListener('click', function () {
        onFolderClick(folder);
    });

    return card;
}

// Обработчик клика по папке
function onFolderClick(folder) {
    console.log('📁 Открыта папка:', folder.name);

    // Переключаем состояние раскрытия
    folder.isExpanded = !folder.isExpanded;
    LocalState.expandedFolders.set(folder.fullPath, folder.isExpanded);

    // Перерисовываем
    renderLocalFiles();
}

// Создание карточки файла
function createLocalFileCard(file, index, parentFolder) {
    var card = document.createElement('div');
    card.className = 'torrent-card local-file-card';
    card.dataset.localIndex = index;
    card.dataset.filePath = file.path;
    card.dataset.fileName = file.name;

    var fileName = file.name || 'Неизвестный файл';
    var fileSize = formatBytes(file.size || 0);

    // Определяем тип
    var fileType = (parentFolder && parentFolder.name) ? detectFolderType(parentFolder.name, [file]) : 'movie';
    var typeLabel = fileType === 'tv' ? 'Серия' : 'Фильм';

    card.innerHTML = '\n        <div class="torrent-poster">\n            <div class="no-poster" style="display: flex; align-items: center; justify-content: center; height: 100%; font-size: 32px;">\n                🎬\n            </div>\n        </div>\n        <div class="torrent-info">\n            <div class="torrent-title">' + escapeHtml(fileName.substring(0, 60)) + (fileName.length > 60 ? '...' : '') + '</div>\n            <div class="torrent-meta">\n                <span>' + fileSize + '</span>\n                <span class="torrent-badge local-file-badge">' + typeLabel + '</span>\n            </div>\n        </div>\n    ';

    // Асинхронно загружаем постер
    (function (cardEl, fName, fPath, idx) {
        var folderPath = fPath ? fPath.substring(0, fPath.lastIndexOf('/')) : '';
        getLocalFilePoster(fName, folderPath).then(function (posterUrl) {
            if (posterUrl && cardEl && cardEl.querySelector('.torrent-poster')) {
                var posterDiv = cardEl.querySelector('.torrent-poster');
                posterDiv.innerHTML = '<img src="' + posterUrl + '" loading="lazy" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.parentElement.innerHTML=\'<div class=\\\'no-poster\\\' style=\\\'display: flex; align-items: center; justify-content: center; height: 100%; font-size: 32px;\\\'>🎬</div>\'">';
            }
        });
    })(card, fileName, file.path, index);

    card.addEventListener('click', function () {
        onLocalFileClick(file, index);
    });

    return card;
}

// Создание элемента файла в детальном просмотре папки
function createFileItemForFolder(file, parentFolder) {
    var item = document.createElement('div');
    item.className = 'file-item';

    var fileName = file.name || 'Неизвестный файл';
    var fileSize = formatBytes(file.size || 0);

    item.innerHTML = '\n        <div class="file-name">\n            <div>' + escapeHtml(fileName) + '</div>\n            <div style="font-size: 12px; color: #888; margin-top: 4px;">' + fileSize + '</div>\n        </div>\n        <button class="play-btn local-play-btn" data-path="' + escapeHtml(file.path || '') + '" data-name="' + escapeHtml(fileName) + '">▶ Воспроизвести</button>\n    ';

    var playBtn = item.querySelector('.local-play-btn');
    playBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var title = parentFolder ? (parentFolder.name + ' - ' + fileName) : fileName;
        playLocalFile(file.path, title);
    });

    return item;
}

// Показ содержимого папки в детальном режиме
async function showFolderDetail(folder) {
    console.log('📂 Открытие деталей папки:', folder.name);

    var videoFiles = (folder.files || []).filter(function (f) {
        return f && f.name && /\.(mp4|mkv|avi|mov|webm|m4v)$/i.test(f.name);
    });

    videoFiles.sort(function (a, b) {
        return (a.name || '').localeCompare(b.name || '');
    });

    var folderType = detectFolderType(folder.name, folder.files);
    var isSeries = folderType === 'tv';

    // Создаем объект для детального просмотра
    var detailItem = {
        id: 'local_' + Date.now() + '_' + (folder.fullPath || ''),
        media_type: isSeries ? 'tv' : 'movie',
        title: folder.name || 'Папка',
        name: folder.name || 'Папка',
        torrent: [{ name: folder.name || 'Папка' }],
        localPath: folder.fullPath || '',
        localFiles: videoFiles,
        isSeries: isSeries
    };

    // Если это сериал, группируем по сезонам
    if (isSeries && videoFiles.length > 1) {
        var seasons = {};

        for (var i = 0; i < videoFiles.length; i++) {
            var file = videoFiles[i];
            var seasonMatch = file.name.match(/[sS](\d+)[eE]/);
            var seasonNum = seasonMatch ? parseInt(seasonMatch[1], 10) : 1;

            if (!seasons[seasonNum]) {
                seasons[seasonNum] = {
                    number: seasonNum,
                    files: []
                };
            }

            var episodeMatch = file.name.match(/[sS]\d+[eE](\d+)/);
            var episodeNum = episodeMatch ? parseInt(episodeMatch[1], 10) : seasons[seasonNum].files.length + 1;

            seasons[seasonNum].files.push({
                id: Buffer.from(file.path || '').toString('base64'),
                name: file.name,
                path: file.path,
                size: file.size,
                episodeNumber: episodeNum,
                seasonNumber: seasonNum
            });
        }

        // Сортируем эпизоды в каждом сезоне
        for (var s in seasons) {
            seasons[s].files.sort(function (a, b) {
                return a.episodeNumber - b.episodeNumber;
            });
        }

        detailItem.seasons = Object.values(seasons).sort(function (a, b) {
            return a.number - b.number;
        });

        detailItem.episodes = [];
        for (var s in seasons) {
            for (var e = 0; e < seasons[s].files.length; e++) {
                detailItem.episodes.push(seasons[s].files[e]);
            }
        }
    } else {
        detailItem.files = videoFiles;
    }

    // Показываем детальный просмотр
    if (typeof window.showCatalogDetail === 'function') {
        AppState.currentScreen = 'detail';
        AppState.detailReturnTo = 'local';
        AppState.currentDetailItem = detailItem;

        // Получаем постер для папки
        var posterUrl = await getFolderPoster(folder.name, folder.fullPath, folder.files);

        // Создаем фейковый элемент для совместимости
        var fakeItem = {
            id: detailItem.id,
            media_type: detailItem.media_type,
            title: detailItem.title,
            poster_path: posterUrl ? posterUrl.split('/').pop() : null
        };

        await window.showCatalogDetail(fakeItem, 0, posterUrl);

        // Заменяем список файлов на наши
        setTimeout(function () {
            var filesList = document.getElementById('files-list');
            if (filesList) {
                filesList.innerHTML = '';
                filesList.style.display = 'block';

                if (isSeries && detailItem.seasons) {
                    for (var s = 0; s < detailItem.seasons.length; s++) {
                        var season = detailItem.seasons[s];
                        var seasonDiv = document.createElement('div');
                        seasonDiv.className = 'season-section';
                        seasonDiv.style.marginBottom = '20px';

                        seasonDiv.innerHTML = '<div class="season-title" style="font-size: 16px; font-weight: 600; color: #4a9eff; margin-bottom: 10px; padding-bottom: 5px; border-bottom: 1px solid #4a9eff;">Сезон ' + season.number + '</div>';

                        for (var e = 0; e < season.files.length; e++) {
                            var file = season.files[e];
                            var item = createFileItemForFolder(file, folder);
                            seasonDiv.appendChild(item);
                        }

                        filesList.appendChild(seasonDiv);
                    }
                } else {
                    for (var f = 0; f < detailItem.files.length; f++) {
                        var file = detailItem.files[f];
                        var item = createFileItemForFolder(file, folder);
                        filesList.appendChild(item);
                    }
                }
            }

            var watchBtn = document.getElementById('catalog-watch-btn');
            if (watchBtn) {
                if (isSeries && detailItem.episodes && detailItem.episodes.length > 0) {
                    watchBtn.textContent = '▶ Воспроизвести первую серию';
                    watchBtn.onclick = function () {
                        var firstEpisode = detailItem.episodes[0];
                        playLocalFile(firstEpisode.path, folder.name + ' - ' + firstEpisode.name);
                    };
                } else if (detailItem.files && detailItem.files.length > 0) {
                    watchBtn.textContent = '▶ Воспроизвести';
                    watchBtn.onclick = function () {
                        var firstFile = detailItem.files[0];
                        playLocalFile(firstFile.path, folder.name + ' - ' + firstFile.name);
                    };
                }
            }
        }, 100);
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

            // Строим дерево папок
            LocalState.folders = buildFolderTree(LocalState.files);

            // Сохраняем в кэш
            localFilesCache = {
                files: LocalState.files.slice(),
                folders: LocalState.folders,
                timestamp: Date.now(),
                path: mediaPath
            };
            localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(localFilesCache));

            var fileCount = LocalState.files.length;
            var folderCount = LocalState.folders.length;
            var sizeTotal = LocalState.files.reduce(function (sum, f) { return sum + (f.size || 0); }, 0);

            if (statsDiv) {
                statsDiv.innerHTML = '<span style="color: #4eff6a;">✅ ' + folderCount + ' папок, ' + fileCount + ' файлов (' + formatBytes(sizeTotal) + ')</span>';
            }

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
                LocalState.folders = data.folders || buildFolderTree(LocalState.files);
                console.log('📦 Загружено из кэша ' + (LocalState.folders ? LocalState.folders.length : 0) + ' папок, ' + LocalState.files.length + ' файлов');
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
    LocalState.folders = [];
    LocalState.posterCache.clear();
    LocalState.expandedFolders.clear();

    var statsDiv = document.getElementById('local-stats');
    if (statsDiv) statsDiv.innerHTML = '<span style="color: #ffd966;">🧹 Кэш очищен</span>';

    if (AppState.currentScreen === 'local') {
        renderLocalFiles();
    }

    console.log('🗑️ Кэш локальных файлов очищен');
}

// Отображение списка локальных файлов и папок
function renderLocalFiles() {
    var torrentsGrid = document.getElementById('torrents-grid');
    if (!torrentsGrid) return;

    torrentsGrid.innerHTML = '';

    if ((!LocalState.folders || LocalState.folders.length === 0) && (!LocalState.files || LocalState.files.length === 0)) {
        var hasPath = !!LocalState.currentPath;
        torrentsGrid.innerHTML = '\n            <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">\n                <div style="font-size: 48px; margin-bottom: 20px;">📁</div>\n                <div style="font-size: 18px; color: #aaa; margin-bottom: 10px;">' +
            (hasPath ? 'Нет видеофайлов' : 'Не настроен локальный каталог') +
            '</div>\n                <div style="font-size: 14px; color: #666;">' +
            (hasPath ? 'Нажмите "Сканировать" в настройках' : 'Перейдите в настройки и укажите путь к папке с медиафайлами') +
            '</div>\n            </div>\n        ';
        return;
    }

    // Добавляем заголовок с переключателем режимов
    var header = document.createElement('div');
    header.className = 'catalog-header local-header';
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.flexWrap = 'wrap';
    header.style.gap = '10px';

    var modeButtons = '';
    if (LocalState.folders && LocalState.folders.length > 0) {
        modeButtons = '\n            <div style="display: flex; gap: 8px;">\n                <button class="view-mode-btn ' + (LocalState.viewMode === 'folders' ? 'active' : '') + '" data-mode="folders" style="padding: 6px 12px; background: ' + (LocalState.viewMode === 'folders' ? '#4a9eff' : '#282837') + '; border: none; border-radius: 20px; color: white; cursor: pointer;">📁 По папкам</button>\n                <button class="view-mode-btn ' + (LocalState.viewMode === 'grid' ? 'active' : '') + '" data-mode="grid" style="padding: 6px 12px; background: ' + (LocalState.viewMode === 'grid' ? '#4a9eff' : '#282837') + '; border: none; border-radius: 20px; color: white; cursor: pointer;">🎬 Списком</button>\n            </div>\n        ';
    }

    var folderCount = LocalState.folders ? LocalState.folders.length : 0;
    var fileCount = LocalState.files ? LocalState.files.length : 0;

    header.innerHTML = '\n        <span>📁 Локальный каталог</span>\n        <div style="display: flex; gap: 15px; align-items: center;">\n            <span style="font-size: 12px; color: #aaa;">' + folderCount + ' папок, ' + fileCount + ' файлов</span>\n            ' + modeButtons + '\n        </div>\n    ';
    torrentsGrid.appendChild(header);

    // Добавляем обработчики для кнопок переключения режима
    var modeBtns = header.querySelectorAll('.view-mode-btn');
    for (var i = 0; i < modeBtns.length; i++) {
        modeBtns[i].addEventListener('click', function (e) {
            var mode = this.dataset.mode;
            LocalState.viewMode = mode;
            saveLocalSettings();
            renderLocalFiles();
        });
    }

    if (LocalState.viewMode === 'folders' && LocalState.folders && LocalState.folders.length > 0) {
        for (var i = 0; i < LocalState.folders.length; i++) {
            var folder = LocalState.folders[i];

            if (folder && folder.type === 'folder') {
                var card = createFolderCard(folder, i);
                torrentsGrid.appendChild(card);
            } else if (folder) {
                var fileCard = createLocalFileCard(folder, i, null);
                torrentsGrid.appendChild(fileCard);
            }
        }
    } else {
        for (var i = 0; i < LocalState.files.length; i++) {
            var card = createLocalFileCard(LocalState.files[i], i, null);
            torrentsGrid.appendChild(card);
        }
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

// Получение постера для локального файла по имени
async function getLocalFilePoster(fileName, folderPath) {
    if (!fileName) return null;

    var cacheKey = (folderPath || '') + '_' + fileName;

    if (LocalState.posterCache.has(cacheKey)) {
        return LocalState.posterCache.get(cacheKey);
    }

    var cleanName = fileName
        .replace(/\.(mp4|mkv|avi|mov|webm|m4v)$/i, '')
        .replace(/[\[\(].*?[\]\)]/g, '')
        .trim();

    var yearMatch = cleanName.match(/\b(19|20)\d{2}\b/);
    var year = yearMatch ? yearMatch[0] : null;
    if (year) cleanName = cleanName.replace(year, '').trim();

    var isSeries = /s\d{2}e\d{2}|season|\d+ серия|сезон|episode/i.test(fileName);
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

// Обработчик клика по локальному файлу
async function onLocalFileClick(file, index) {
    if (!file || !file.path) {
        console.error('❌ Некорректный файл');
        return;
    }

    console.log('🎬 Выбран локальный файл:', file.name);

    LocalState.lastSelectedIndex = index;
    LocalState.lastSelectedPath = file.path;
    LocalState.currentFile = file;

    await playLocalFile(file.path, file.name);
}

// Воспроизведение локального файла
async function playLocalFile(filePath, title) {
    if (!filePath) {
        console.error('❌ Путь к файлу не указан');
        return;
    }

    console.log('▶️ Воспроизведение локального файла:', filePath, title);

    var overlay = document.getElementById('playback-overlay');
    var textEl = document.querySelector('.playback-text');
    if (overlay) overlay.classList.add('active');
    if (textEl) textEl.textContent = 'Загрузка локального файла...';

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

        if (typeof startHLSPlayback === 'function') {
            await startHLSPlayback(streamData.playlistUrl, 0, false, null, null);

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
        if (overlay) overlay.classList.remove('active');
        if (textEl) textEl.textContent = 'Воспроизведение...';
    }
}

// Фокус на первую карточку локального каталога
function focusFirstLocalCard() {
    if (AppState.currentScreen !== 'local') return false;

    if (typeof updateFocusableElements === 'function') {
        updateFocusableElements();
    }

    var firstCardIndex = -1;
    for (var i = 0; i < focusableElements.length; i++) {
        if (focusableElements[i].classList &&
            (focusableElements[i].classList.contains('local-folder-card') ||
                focusableElements[i].classList.contains('local-file-card'))) {
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

    if (LocalState.files.length === 0 || (LocalState.folders && LocalState.folders.length === 0)) {
        loadLocalFilesFromCache();
    }

    renderLocalFiles();
}

// Настройка обработчиков для локального каталога
function setupLocal() {
    console.log('🔧 Настройка локального каталога...');

    loadLocalSettings();

    var scanBtn = document.getElementById('scan-local-btn');
    if (scanBtn) {
        scanBtn.addEventListener('click', function () {
            scanLocalDirectory();
        });
    }

    var clearBtn = document.getElementById('clear-local-cache-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', function () {
            clearLocalCache();
        });
    }

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

    var tabLocal = document.getElementById('tab-local');
    if (tabLocal) {
        tabLocal.addEventListener('click', function () {
            showLocalCatalog();
        });
    }

    if (loadLocalFilesFromCache() && (LocalState.files.length > 0 || (LocalState.folders && LocalState.folders.length > 0))) {
        var statsDiv = document.getElementById('local-stats');
        if (statsDiv) {
            var totalSize = LocalState.files.reduce(function (sum, f) { return sum + (f.size || 0); }, 0);
            var folderCount = LocalState.folders ? LocalState.folders.length : 0;
            statsDiv.innerHTML = '<span style="color: #4eff6a;">✅ ' + folderCount + ' папок, ' + LocalState.files.length + ' файлов (' + formatBytes(totalSize) + ') в кэше</span>';
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
