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
    currentFolderStack: [] // Стек для навигации по папкам
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

// Получение имени папки из пути
function getFolderNameFromPath(fullPath) {
    if (!fullPath) return 'Корень';
    // Нормализуем путь
    var normalized = fullPath.replace(/\\/g, '/');
    // Убираем trailing slash
    if (normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
    }

    // Для корневого пути (совпадает с базовым путем) - показываем имя последней папки или "Корень"
    var basePath = LocalState.currentPath ? LocalState.currentPath.replace(/\\/g, '/') : '';
    if (basePath.endsWith('/')) {
        basePath = basePath.slice(0, -1);
    }

    // Если это корневая папка
    if (normalized === basePath) {
        // Извлекаем имя последней папки из пути
        var parts = normalized.split('/');
        var nonEmptyParts = [];
        for (var i = 0; i < parts.length; i++) {
            if (parts[i] && parts[i] !== '') {
                nonEmptyParts.push(parts[i]);
            }
        }
        if (nonEmptyParts.length > 0) {
            return nonEmptyParts[nonEmptyParts.length - 1];
        }
        return 'Корень';
    }

    // Для вложенных папок - возвращаем имя текущей папки
    var pathParts = normalized.split('/');
    var nonEmptyParts = [];
    for (var i = 0; i < pathParts.length; i++) {
        if (pathParts[i] && pathParts[i] !== '') {
            nonEmptyParts.push(pathParts[i]);
        }
    }
    if (nonEmptyParts.length === 0) return 'Корень';
    return nonEmptyParts[nonEmptyParts.length - 1];
}

// Функция для отображения полного пути в хлебных крошках (только имена папок)
function getBreadcrumbPath() {
    var basePath = LocalState.currentPath ? LocalState.currentPath.replace(/\\/g, '/') : '';
    if (basePath.endsWith('/')) {
        basePath = basePath.slice(0, -1);
    }

    var result = [];

    if (LocalState.currentFolderStack.length === 0) {
        // Показываем имя корневой папки
        var rootName = getFolderNameFromPath(basePath);
        result.push({ name: rootName, path: basePath, isRoot: true });
    } else {
        // Строим путь от корня
        var currentPath = basePath;
        var rootName = getFolderNameFromPath(basePath);
        result.push({ name: rootName, path: currentPath, isRoot: true });

        for (var i = 0; i < LocalState.currentFolderStack.length; i++) {
            var folder = LocalState.currentFolderStack[i];
            currentPath = currentPath + '/' + folder.name;
            result.push({ name: folder.name, path: currentPath, isRoot: false });
        }
    }

    return result;
}

// Построение дерева папок для текущего уровня
function buildFolderTreeForPath(files, currentFolderPath) {
    if (!files || files.length === 0) {
        return { folders: [], files: [] };
    }

    var folders = {};
    var currentLevelFiles = [];

    // Нормализуем текущий путь
    var normalizedCurrentPath = currentFolderPath ? currentFolderPath.replace(/\\/g, '/') : '';
    if (normalizedCurrentPath && !normalizedCurrentPath.endsWith('/')) {
        normalizedCurrentPath += '/';
    }

    // Нормализуем базовый путь
    var basePath = LocalState.currentPath ? LocalState.currentPath.replace(/\\/g, '/') : '';
    if (basePath && !basePath.endsWith('/')) {
        basePath += '/';
    }

    for (var i = 0; i < files.length; i++) {
        var file = files[i];
        if (!file || !file.path) continue;

        var normalizedPath = file.path.replace(/\\/g, '/');

        // Проверяем, находится ли файл в текущей папке или подпапке
        if (normalizedCurrentPath && !normalizedPath.startsWith(normalizedCurrentPath)) {
            continue;
        }

        // Получаем относительный путь
        var relativePath = normalizedCurrentPath ?
            normalizedPath.substring(normalizedCurrentPath.length) :
            normalizedPath.substring(basePath.length);

        var parts = relativePath.split('/');
        var firstPart = parts[0];

        if (parts.length > 1 && firstPart && firstPart !== '') {
            // Это файл в подпапке
            if (!folders[firstPart]) {
                var folderFullPath = (normalizedCurrentPath || basePath) + firstPart;
                folders[firstPart] = {
                    name: firstPart,
                    fullPath: folderFullPath,
                    files: [],
                    subfolderCount: 0
                };
            }
            folders[firstPart].subfolderCount++;
        } else if (firstPart && firstPart !== '') {
            // Это файл в текущей папке
            currentLevelFiles.push(file);
        }
    }

    // Преобразуем объект папок в массив и сортируем
    var foldersArray = [];
    for (var folderName in folders) {
        if (folders.hasOwnProperty(folderName)) {
            foldersArray.push(folders[folderName]);
        }
    }
    foldersArray.sort(function (a, b) {
        return a.name.localeCompare(b.name);
    });

    // Сортируем файлы
    currentLevelFiles.sort(function (a, b) {
        return a.name.localeCompare(b.name);
    });

    return {
        folders: foldersArray,
        files: currentLevelFiles
    };
}

// Получение постера для папки
async function getFolderPoster(folderName, folderPath, filesInFolder) {
    var cacheKey = 'folder_' + folderPath;

    if (LocalState.posterCache.has(cacheKey)) {
        return LocalState.posterCache.get(cacheKey);
    }

    // Сначала пробуем найти постер по первому видеофайлу в папке
    var videoFiles = (filesInFolder || []).filter(function (f) {
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

// Создание карточки папки
function createFolderCard(folder, index) {
    var card = document.createElement('div');
    card.className = 'torrent-card local-folder-card';
    card.dataset.folderIndex = index;
    card.dataset.folderPath = folder.fullPath;
    card.dataset.folderName = folder.name;

    // Используем getFolderNameFromPath для отображения имени
    var displayName = getFolderNameFromPath(folder.fullPath);
    var fileCount = folder.subfolderCount || 0;
    var fileCountText = fileCount + ' ' + (fileCount === 1 ? 'файл' : (fileCount < 5 ? 'файла' : 'файлов'));

    card.innerHTML = '\n        <div class="torrent-poster folder-poster">\n            <div class="no-poster" style="display: flex; align-items: center; justify-content: center; height: 100%; font-size: 48px;">\n                📁\n            </div>\n        </div>\n        <div class="torrent-info">\n            <div class="torrent-title">' + escapeHtml(displayName.substring(0, 50)) + (displayName.length > 50 ? '...' : '') + '</div>\n            <div class="torrent-meta">\n                <span>' + fileCountText + '</span>\n                <span class="torrent-badge local-folder-badge">Папка</span>\n            </div>\n        </div>\n    ';

    // Асинхронно загружаем постер
    (function (cardEl, fName, fPath) {
        getFolderPoster(fName, fPath, []).then(function (posterUrl) {
            if (posterUrl && cardEl && cardEl.querySelector('.torrent-poster')) {
                var posterDiv = cardEl.querySelector('.torrent-poster');
                posterDiv.innerHTML = '<img src="' + posterUrl + '" loading="lazy" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.parentElement.innerHTML=\'<div class=\\\'no-poster\\\' style=\\\'display: flex; align-items: center; justify-content: center; height: 100%; font-size: 48px;\\\'>📁</div>\'">';
            }
        });
    })(card, folder.name, folder.fullPath);

    card.addEventListener('click', function () {
        onFolderClick(folder);
    });

    return card;
}

// Создание карточки файла
function createLocalFileCard(file, index) {
    var card = document.createElement('div');
    card.className = 'torrent-card local-file-card';
    card.dataset.localIndex = index;
    card.dataset.filePath = file.path;
    card.dataset.fileName = file.name;

    var fileName = file.name || 'Неизвестный файл';
    var fileSize = formatBytes(file.size || 0);
    var fileExt = fileName.split('.').pop().toUpperCase();

    card.innerHTML = '\n        <div class="torrent-poster">\n            <div class="no-poster" style="display: flex; align-items: center; justify-content: center; height: 100%; font-size: 32px;">\n                🎬\n            </div>\n        </div>\n        <div class="torrent-info">\n            <div class="torrent-title">' + escapeHtml(fileName.substring(0, 60)) + (fileName.length > 60 ? '...' : '') + '</div>\n            <div class="torrent-meta">\n                <span>' + fileSize + '</span>\n                <span class="torrent-badge local-file-badge">' + fileExt + '</span>\n            </div>\n        </div>\n    ';

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

// Создание элемента файла для детального просмотра
function createFileItemForFolder(file, folderName) {
    var item = document.createElement('div');
    item.className = 'file-item';

    var fileName = file.name || 'Неизвестный файл';
    var fileSize = formatBytes(file.size || 0);

    item.innerHTML = '\n        <div class="file-name">\n            <div>' + escapeHtml(fileName) + '</div>\n            <div style="font-size: 12px; color: #888; margin-top: 4px;">' + fileSize + '</div>\n        </div>\n        <button class="play-btn local-play-btn" data-path="' + escapeHtml(file.path || '') + '" data-name="' + escapeHtml(fileName) + '">▶ Воспроизвести</button>\n    ';

    var playBtn = item.querySelector('.local-play-btn');
    playBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        playLocalFile(file.path, folderName + ' - ' + fileName);
    });

    return item;
}

// Обработчик клика по папке - открываем её содержимое
function onFolderClick(folder) {
    console.log('📁 Открываем папку:', folder.fullPath);

    // Добавляем в стек
    LocalState.currentFolderStack.push({
        name: folder.name,
        fullPath: folder.fullPath
    });

    // Отображаем содержимое папки
    renderCurrentFolder();
}

// Возврат на уровень выше
function goUpFolder() {
    if (LocalState.currentFolderStack.length > 0) {
        LocalState.currentFolderStack.pop();
        renderCurrentFolder();
    }
}

// Навигация к конкретному пути
function navigateToPath(targetPath) {
    console.log('🔍 Навигация к пути:', targetPath);

    var basePath = LocalState.currentPath ? LocalState.currentPath.replace(/\\/g, '/') : '';
    if (basePath.endsWith('/')) {
        basePath = basePath.slice(0, -1);
    }

    // Если это корневой путь
    if (targetPath === basePath) {
        LocalState.currentFolderStack = [];
        renderCurrentFolder();
        return;
    }

    // Вычисляем относительный путь от корня
    var relativePath = targetPath.substring(basePath.length + 1);
    var pathParts = relativePath.split('/');

    // Строим стек
    var newStack = [];
    var currentBuildPath = basePath;

    for (var i = 0; i < pathParts.length; i++) {
        var part = pathParts[i];
        if (part && part !== '') {
            currentBuildPath = currentBuildPath + '/' + part;
            newStack.push({
                name: part,
                fullPath: currentBuildPath
            });
        }
    }

    LocalState.currentFolderStack = newStack;
    renderCurrentFolder();
}

// Отображение текущей папки
function renderCurrentFolder() {
    var torrentsGrid = document.getElementById('torrents-grid');
    if (!torrentsGrid) return;

    // Определяем текущий путь
    var currentPath = '';
    if (LocalState.currentFolderStack.length > 0) {
        currentPath = LocalState.currentFolderStack[LocalState.currentFolderStack.length - 1].fullPath;
    } else {
        currentPath = LocalState.currentPath ? LocalState.currentPath.replace(/\\/g, '/') : '';
    }

    // Получаем содержимое текущей папки
    var content = buildFolderTreeForPath(LocalState.files, currentPath);

    torrentsGrid.innerHTML = '';

    // Добавляем хлебные крошки и заголовок
    var header = document.createElement('div');
    header.className = 'catalog-header local-header';
    header.style.display = 'flex';
    header.style.flexDirection = 'column';
    header.style.alignItems = 'stretch';
    header.style.gap = '10px';

    // Хлебные крошки
    var breadcrumbs = '<div style="display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 12px;">';
    breadcrumbs += '<span style="color: #4a9eff;">📁</span>';

    // Кнопка "Назад" если есть стек
    if (LocalState.currentFolderStack.length > 0) {
        breadcrumbs += '<button class="folder-nav-btn" data-action="up" style="background: #282837; border: none; color: #4a9eff; padding: 4px 12px; border-radius: 16px; cursor: pointer;">⬆ Наверх</button>';
        breadcrumbs += '<span style="color: #888;">/</span>';
    }

    // Строим путь для отображения
    var breadcrumbPath = getBreadcrumbPath();
    for (var i = 0; i < breadcrumbPath.length; i++) {
        var item = breadcrumbPath[i];
        if (i > 0) {
            breadcrumbs += '<span style="color: #888;">/</span>';
        }
        if (item.isRoot && LocalState.currentFolderStack.length === 0) {
            // Текущая корневая папка - не кликабельная
            breadcrumbs += '<span style="color: #fff;">' + escapeHtml(item.name) + '</span>';
        } else {
            // Папка в хлебных крошках - кликабельная
            breadcrumbs += '<button class="breadcrumb-btn" data-path="' + escapeHtml(item.path) + '" style="background: none; border: none; color: #4a9eff; cursor: pointer; padding: 2px 4px; border-radius: 4px;">' + escapeHtml(item.name) + '</button>';
        }
    }

    breadcrumbs += '</div>';

    // Статистика
    var fileCount = content.files.length;
    var folderCount = content.folders.length;
    var statsHtml = '<div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">';
    statsHtml += '<span>' + folderCount + ' папок, ' + fileCount + ' файлов</span>';
    statsHtml += '</div>';

    header.innerHTML = breadcrumbs + statsHtml;
    torrentsGrid.appendChild(header);

    // Добавляем обработчики для кнопок навигации
    var upBtn = header.querySelector('.folder-nav-btn');
    if (upBtn) {
        upBtn.addEventListener('click', function () {
            goUpFolder();
        });
    }

    // Добавляем обработчики для хлебных крошек
    var breadcrumbBtns = header.querySelectorAll('.breadcrumb-btn');
    for (var i = 0; i < breadcrumbBtns.length; i++) {
        (function (btn) {
            btn.addEventListener('click', function () {
                var targetPath = this.dataset.path;
                navigateToPath(targetPath);
            });
        })(breadcrumbBtns[i]);
    }

    // Если нет содержимого
    if (content.folders.length === 0 && content.files.length === 0) {
        var emptyDiv = document.createElement('div');
        emptyDiv.style.cssText = 'grid-column: 1 / -1; text-align: center; padding: 60px 20px;';
        emptyDiv.innerHTML = '\n            <div style="font-size: 48px; margin-bottom: 20px;">📂</div>\n            <div style="font-size: 16px; color: #aaa;">Папка пуста</div>\n        ';
        torrentsGrid.appendChild(emptyDiv);

        setTimeout(function () {
            if (AppState.currentScreen === 'local' && typeof updateFocusableElements === 'function') {
                updateFocusableElements();
            }
        }, 100);
        return;
    }

    // Отображаем папки
    for (var i = 0; i < content.folders.length; i++) {
        var folder = content.folders[i];
        var card = createFolderCard(folder, i);
        torrentsGrid.appendChild(card);
    }

    // Отображаем файлы
    for (var i = 0; i < content.files.length; i++) {
        var file = content.files[i];
        var card = createLocalFileCard(file, i);
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

// Показ содержимого папки в детальном режиме (для сериалов)
async function showFolderDetail(folder) {
    console.log('📂 Открытие деталей папки:', folder.fullPath);

    // Получаем все файлы из этой папки
    var content = buildFolderTreeForPath(LocalState.files, folder.fullPath);
    var videoFiles = content.files.filter(function (f) {
        return f && f.name && /\.(mp4|mkv|avi|mov|webm|m4v)$/i.test(f.name);
    });

    var folderName = getFolderNameFromPath(folder.fullPath);

    // Создаем объект для детального просмотра
    var detailItem = {
        id: 'local_' + Date.now() + '_' + (folder.fullPath || ''),
        media_type: videoFiles.length > 1 ? 'tv' : 'movie',
        title: folderName,
        name: folderName,
        torrent: [{ name: folderName }],
        localPath: folder.fullPath,
        localFiles: videoFiles,
        isSeries: videoFiles.length > 1
    };

    // Показываем детальный просмотр
    if (typeof window.showCatalogDetail === 'function') {
        AppState.currentScreen = 'detail';
        AppState.detailReturnTo = 'local';
        AppState.currentDetailItem = detailItem;

        var posterUrl = await getFolderPoster(folderName, folder.fullPath, videoFiles);

        var fakeItem = {
            id: detailItem.id,
            media_type: detailItem.media_type,
            title: detailItem.title,
            poster_path: posterUrl ? posterUrl.split('/').pop() : null
        };

        await window.showCatalogDetail(fakeItem, 0, posterUrl);

        setTimeout(function () {
            var filesList = document.getElementById('files-list');
            if (filesList) {
                filesList.innerHTML = '';
                filesList.style.display = 'block';

                for (var f = 0; f < videoFiles.length; f++) {
                    var file = videoFiles[f];
                    var item = createFileItemForFolder(file, folderName);
                    filesList.appendChild(item);
                }
            }

            var watchBtn = document.getElementById('catalog-watch-btn');
            if (watchBtn && videoFiles.length > 0) {
                watchBtn.textContent = '▶ Воспроизвести';
                watchBtn.onclick = function () {
                    var firstFile = videoFiles[0];
                    playLocalFile(firstFile.path, folderName + ' - ' + firstFile.name);
                };
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

    // Нормализуем путь
    mediaPath = mediaPath.replace(/\\/g, '/');
    if (mediaPath.endsWith('/')) {
        mediaPath = mediaPath.slice(0, -1);
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

            // Сбрасываем навигацию
            LocalState.currentFolderStack = [];

            var fileCount = LocalState.files.length;
            var sizeTotal = LocalState.files.reduce(function (sum, f) { return sum + (f.size || 0); }, 0);

            if (statsDiv) {
                statsDiv.innerHTML = '<span style="color: #4eff6a;">✅ Найдено ' + fileCount + ' файлов (' + formatBytes(sizeTotal) + ')</span>';
            }

            if (AppState.currentScreen === 'local') {
                renderCurrentFolder();
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
                console.log('📦 Загружено из кэша ' + LocalState.files.length + ' файлов');
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
    LocalState.currentFolderStack = [];

    var statsDiv = document.getElementById('local-stats');
    if (statsDiv) statsDiv.innerHTML = '<span style="color: #ffd966;">🧹 Кэш очищен</span>';

    if (AppState.currentScreen === 'local') {
        renderCurrentFolder();
    }

    console.log('🗑️ Кэш локальных файлов очищен');
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
            body: JSON.stringify({ path: filePath, start: 0, audioTrack: null })
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

    if (LocalState.files.length === 0) {
        loadLocalFilesFromCache();
    }

    // Сбрасываем навигацию при открытии
    LocalState.currentFolderStack = [];

    renderCurrentFolder();
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
