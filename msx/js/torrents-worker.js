// torrents-worker.js — Web Worker для torrents.js
// Вычисления + TMDB-запросы. БЕЗ DOM, БЕЗ localStorage.
// Same-origin (через прокси Express), fetch работает.
'use strict';

// ==================== КОНСТАНТЫ ====================
var TMDB_CACHE_TTL = 86400000; // 24 часа

// ==================== КЭШИ ====================
var workerSeasonCache = {};
var workerTmdbDetailsCache = {};

// ==================== УТИЛИТЫ ====================
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    var k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function workerSafeFetch(url, timeout) {
    timeout = timeout || 5000;
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeout);
    return fetch(url, { signal: controller.signal })
        .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        })
        .catch(function () { return null; })
        .finally(function () { clearTimeout(timer); });
}

// ==================== normalizeSearchResult ====================
function normalizeSearchResult(item) {
    var info = item.info || {};
    var rawTracker = item.Tracker || item.tracker || '';
    var tracker = String(rawTracker).trim();
    var title = item.Title || item.title || info.name || info.originalname || item.name || 'Без названия';
    var cleanName = info.name || item.name || title;

    var releasedRaw = info.relased || info.released || item.PublishDate || null;
    var releasedYear = null;
    if (typeof releasedRaw === 'number') {
        releasedYear = releasedRaw;
    } else if (typeof releasedRaw === 'string') {
        var match = releasedRaw.match(/(19|20)\d{2}/);
        releasedYear = match ? parseInt(match[0], 10) : null;
    }

    var types = Array.isArray(info.types) ? info.types.slice() : [];
    var categoryDesc = (item.CategoryDesc || '').toLowerCase();
    if (categoryDesc.indexOf('tv') !== -1 || categoryDesc.indexOf('сериал') !== -1 || categoryDesc.indexOf('series') !== -1) {
        if (types.indexOf('tv') === -1) types.push('tv');
    }
    if (categoryDesc.indexOf('movie') !== -1 || categoryDesc.indexOf('фильм') !== -1 || categoryDesc.indexOf('film') !== -1) {
        if (types.indexOf('movie') === -1) types.push('movie');
    }

    var magnet = item.MagnetUri || item.magnet || null;
    var size = item.Size || item.size || 0;
    var sizeName = info.sizeName || item.sizeName;
    if (!sizeName && size > 0) sizeName = formatBytes(size);

    var createTime = item.createTime || 0;
    if (!createTime && item.PublishDate) {
        try { createTime = new Date(item.PublishDate).getTime() || 0; } catch (e) { createTime = 0; }
    }

    return {
        title: title,
        name: cleanName,
        originalname: info.originalname || '',
        magnet: magnet,
        size: size,
        sizeName: sizeName || '0 B',
        tracker: tracker,
        sid: item.Seeders !== undefined ? parseInt(item.Seeders, 10) : (item.sid || 0),
        pir: item.Peers !== undefined ? parseInt(item.Peers, 10) : (item.pir || 0),
        quality: info.quality || item.quality || 0,
        videotype: info.videotype || item.videotype || '',
        voices: Array.isArray(info.voices) ? info.voices : (Array.isArray(item.voices) ? item.voices : []),
        types: types,
        released: releasedYear,
        relased: releasedYear,
        year: releasedYear,
        languages: Array.isArray(info.languages) ? info.languages : (Array.isArray(item.languages) ? item.languages : []),
        createTime: createTime,
        details: item.Details || item.details || null,
        seasons: Array.isArray(info.seasons) ? info.seasons : (Array.isArray(item.seasons) ? item.seasons : [])  // ★ ДОБАВЛЕНО
    };
}

// ==================== computeFilteredAndSorted ====================
function computeFilteredAndSorted(searchResults, f) {
    var filtered = searchResults.filter(function (item) {
        if (f.quality !== 'all' && (item.quality || 0) !== parseInt(f.quality, 10)) return false;
        if (f.tracker !== 'all') {
            var trackerField = (item.tracker || '').toLowerCase();
            if (trackerField.indexOf(f.tracker.toLowerCase()) === -1) return false;
        }
        if (f.year && f.year !== 'all' && item.released !== parseInt(f.year, 10)) return false;
        if (f.season && f.season !== 'all' && (!item.seasons || item.seasons.indexOf(parseInt(f.season, 10)) === -1)) return false;
        if (f.voice && f.voice !== 'all' && (!item.voices || item.voices.indexOf(f.voice) === -1)) return false;
        if (f.videotype && f.videotype !== 'all' && item.videotype != f.videotype) return false;
        return true;
    });

    filtered.sort(function (a, b) {
        switch (f.sort) {
            case 'date-desc': return new Date(b.createTime || 0) - new Date(a.createTime || 0);
            case 'date-asc': return new Date(a.createTime || 0) - new Date(b.createTime || 0);
            case 'size-desc': return (b.size || 0) - (a.size || 0);
            case 'size-asc': return (a.size || 0) - (b.size || 0);
            case 'sid-desc': return (b.sid || 0) - (a.sid || 0);
            case 'sid-asc': return (a.sid || 0) - (b.sid || 0);
            case 'pir-desc': return (b.pir || 0) - (a.pir || 0);
            case 'pir-asc': return (a.pir || 0) - (b.pir || 0);
            default: return 0;
        }
    });

    return filtered;
}

// ==================== computeAvailableFilters ====================
function computeAvailableFilters(searchResults) {
    var trackerSet = {}, yearSet = {}, seasonSet = {}, voiceSet = {}, videotypeSet = {};

    for (var i = 0; i < searchResults.length; i++) {
        var r = searchResults[i];

        if (r.tracker) {
            var trackers = String(r.tracker).split(',');
            for (var t = 0; t < trackers.length; t++) {
                var tr = trackers[t].trim().toLowerCase();
                if (tr) trackerSet[tr] = true;
            }
        }

        if (r.released && !isNaN(r.released)) yearSet[r.released] = true;

        if (r.seasons && Array.isArray(r.seasons)) {
            for (var s = 0; s < r.seasons.length; s++) seasonSet[r.seasons[s]] = true;
        }

        if (r.voices && Array.isArray(r.voices)) {
            for (var v = 0; v < r.voices.length; v++) {
                if (r.voices[v] && r.voices[v].trim()) voiceSet[r.voices[v].trim()] = true;
            }
        }

        if (r.videotype && r.videotype.trim()) videotypeSet[r.videotype.trim()] = true;
    }

    return {
        trackers: Object.keys(trackerSet).sort(),
        years: Object.keys(yearSet).map(Number).sort(function (a, b) { return b - a; }),
        seasons: Object.keys(seasonSet).map(Number).sort(function (a, b) { return a - b; }),
        voices: Object.keys(voiceSet).sort(),
        videotypes: Object.keys(videotypeSet).sort()
    };
}

// ==================== extractSeasonsFromTitle ====================
function extractSeasonsFromTitle(title) {
    if (!title) return [];
    var seasons = [];

    var rangePatterns = [
        /\[сезон\s*(\d+)\s*[-–]\s*(\d+)\]/i,
        /\[season\s*(\d+)\s*[-–]\s*(\d+)\]/i,
        /сезон\s*(\d+)\s*[-–]\s*(\d+)/i,
        /season\s*(\d+)\s*[-–]\s*(\d+)/i,
        /S(\d+)\s*[-–]\s*S?(\d+)/i
    ];
    for (var p = 0; p < rangePatterns.length; p++) {
        var m = title.match(rangePatterns[p]);
        if (m && m[1] && m[2]) {
            for (var s = parseInt(m[1], 10); s <= parseInt(m[2], 10); s++) {
                if (seasons.indexOf(s) === -1) seasons.push(s);
            }
            return seasons.sort(function (a, b) { return a - b; });
        }
    }

    var listPatterns = [
        /\[сезон\s*([\d,\s]+)\]/i,
        /\[season\s*([\d,\s]+)\]/i,
        /сезон\s*([\d,\s]+)/i,
        /season\s*([\d,\s]+)/i,
        /S([\d,\s]+)/i
    ];
    for (var p = 0; p < listPatterns.length; p++) {
        var m = title.match(listPatterns[p]);
        if (m && m[1]) {
            m[1].split(/[,\s]+/).forEach(function (part) {
                var n = parseInt(part, 10);
                if (!isNaN(n) && seasons.indexOf(n) === -1) seasons.push(n);
            });
            if (seasons.length > 0) break;
        }
    }

    if (seasons.length === 0) {
        var singlePatterns = [
            /\[сезон\s*(\d+)\]/i,
            /\[season\s*(\d+)\]/i,
            /сезон\s*(\d+)/i,
            /season\s*(\d+)/i,
            /S(\d+)/i
        ];
        for (var p = 0; p < singlePatterns.length; p++) {
            var m = title.match(singlePatterns[p]);
            if (m && m[1]) {
                var n = parseInt(m[1], 10);
                if (!isNaN(n)) seasons.push(n);
                break;
            }
        }
    }

    return seasons.sort(function (a, b) { return a - b; });
}

// ==================== cleanTitleFromSeasons ====================
function cleanTitleFromSeasons(title, seasons) {
    if (!title) return title;
    return title
        .replace(/\[\s*сезон\s*[\d\s,\-–]+\s*\]/gi, '')
        .replace(/\[\s*season\s*[\d\s,\-–]+\s*\]/gi, '')
        .replace(/сезон\s*[\d\s,\-–]+/gi, '')
        .replace(/season\s*[\d\s,\-–]+/gi, '')
        .replace(/S\d+/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\s*[-–]\s*/g, '')
        .trim();
}

// ==================== getTorrentFiles ====================
function getTorrentFiles(torrent) {
    if (!torrent) return [];
    if (torrent.file_stats && Array.isArray(torrent.file_stats) && torrent.file_stats.length > 0) return torrent.file_stats;
    if (torrent.data) {
        try {
            var d = JSON.parse(torrent.data);
            if (d.TorrServer && Array.isArray(d.TorrServer.Files)) return d.TorrServer.Files;
        } catch (e) { }
    }
    return [];
}

// ==================== getVideoFilesFromTorrent ====================
function getVideoFilesFromTorrent(torrent) {
    var files = getTorrentFiles(torrent);
    var exts = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v'];
    return files.filter(function (f) {
        var name = (f.path || '').toLowerCase();
        for (var i = 0; i < exts.length; i++) {
            if (name.indexOf(exts[i]) !== -1) return true;
        }
        return false;
    });
}

// ==================== inferSearchResultIsSeries ====================
function inferSearchResultIsSeries(searchResult, torrent) {
    if (searchResult && searchResult.types && Array.isArray(searchResult.types) && searchResult.types.indexOf('tv') !== -1) return true;
    if (torrent && getVideoFilesFromTorrent(torrent).length > 1) return true;
    var title = ((searchResult && (searchResult.title || searchResult.name)) || (torrent && torrent.title) || '').toLowerCase();
    return (title.indexOf('s') !== -1 && title.indexOf('e') !== -1) ||
        title.indexOf('season') !== -1 || title.indexOf('сезон') !== -1 ||
        title.indexOf('серия') !== -1 || title.indexOf('эпизод') !== -1;
}

// ==================== TMDB: loadSeasonStills ====================
function workerLoadSeasonStills(tmdbId, seasonNumber) {
    var key = tmdbId + '_s' + seasonNumber;
    var cached = workerSeasonCache[key];
    if (cached && (Date.now() - cached.t < TMDB_CACHE_TTL)) return Promise.resolve(cached.d);

    return workerSafeFetch('/api/tmdb/season?id=' + tmdbId + '&seasonNumber=' + seasonNumber)
        .then(function (data) {
            var eps = (data && data.episodes) || [];
            workerSeasonCache[key] = { d: eps, t: Date.now() };
            return eps;
        });
}

// ==================== TMDB: loadMovieStill ====================
function workerLoadMovieStill(tmdbId) {
    var key = tmdbId + '_movie';
    var cached = workerSeasonCache[key];
    if (cached && (Date.now() - cached.t < TMDB_CACHE_TTL)) return Promise.resolve(cached.d);

    return workerSafeFetch('/api/tmdb/details?id=' + tmdbId + '&type=movie')
        .then(function (data) {
            var pp = (data && data.poster_path) || null;
            workerSeasonCache[key] = { d: pp, t: Date.now() };
            return pp;
        });
}

// ==================== TMDB: getTmdbDetails ====================
function workerGetTmdbDetails(tmdbId, mediaType) {
    if (!tmdbId) return Promise.resolve(null);
    var key = tmdbId + '_' + mediaType;
    var cached = workerTmdbDetailsCache[key];
    if (cached && (Date.now() - cached.t < TMDB_CACHE_TTL)) return Promise.resolve(cached.d);

    return workerSafeFetch('/api/tmdb/details?id=' + tmdbId + '&type=' + mediaType)
        .then(function (data) {
            if (data) workerTmdbDetailsCache[key] = { d: data, t: Date.now() };
            return data || null;
        });
}

// ==================== extractSeasonsFromFiles ====================
function extractSeasonsFromFiles(torrent) {
    var files = getTorrentFiles(torrent);
    var seasons = [];
    var patterns = [
        /S(\d{1,2})/i,
        /(\d{1,2})x\d{2}/i,
        /Season\s*(\d{1,2})/i,
        /сезон\s*(\d{1,2})/i
    ];
    for (var i = 0; i < files.length; i++) {
        var path = String(files[i].path || '');
        for (var p = 0; p < patterns.length; p++) {
            var m = path.match(patterns[p]);
            if (m && m[1]) {
                var n = parseInt(m[1], 10);
                if (!isNaN(n) && n > 0 && n < 1000 && seasons.indexOf(n) === -1) {
                    seasons.push(n);
                }
                break;
            }
        }
    }
    return seasons.sort(function (a, b) { return a - b; });
}

// ==================== ГЛАВНАЯ: workerLoadAllTmdbData ====================
function workerLoadAllTmdbData(torrent) {
    var cleanTitle = torrent.title || 'Без названия';
    var tmdbId = torrent.tmdbId || torrent.knownTmdbId || null;
    var knownMediaType = torrent.media_type || torrent.knownMediaType || null;

    if (!tmdbId) {
        var bracketMatch = cleanTitle.match(/\[(\d+)\]/);
        if (bracketMatch && bracketMatch[1]) {
            tmdbId = bracketMatch[1];
        }
    }

    // ★ FIX: Извлекаем сезоны ИЗ ОРИГИНАЛЬНОГО заголовка ДО очистки
    var seasonNumbers = extractSeasonsFromTitle(cleanTitle);

    // Теперь очищаем заголовок
    cleanTitle = cleanTitle
        .replace(/\[\d+\]/g, '')
        .replace(/\[сезон[^\]]*\]/gi, '')
        .trim();

    if (seasonNumbers.length > 0) {
        cleanTitle = cleanTitleFromSeasons(cleanTitle, seasonNumbers);
    }

    var videoFiles = getVideoFilesFromTorrent(torrent);
    var videoFilesCount = videoFiles.length;

    var isTvSeries;
    if (knownMediaType) {
        isTvSeries = knownMediaType === 'tv';
    } else if (seasonNumbers.length > 0) {
        isTvSeries = true;
    } else if (videoFilesCount > 1) {
        isTvSeries = true;
    } else {
        isTvSeries = /(^|[^a-z0-9а-яё])(сезон|season|серия|эпизод|s\d+)([^a-z0-9а-яё]|$)/i.test(torrent.title || '');
    }

    // ★ FIX: Если сезоны не найдены в заголовке — ищем в именах файлов
    if (seasonNumbers.length === 0 && isTvSeries) {
        seasonNumbers = extractSeasonsFromFiles(torrent);
    }

    // ★ FIX: Если это точно сериал, но сезоны так и не определены — берём сезон 1
    if (seasonNumbers.length === 0 && isTvSeries) {
        seasonNumbers = [1];
    }

    var mediaType = isTvSeries ? 'tv' : 'movie';

    var detailsP = tmdbId
        ? workerGetTmdbDetails(tmdbId, mediaType)
        : Promise.resolve(null);

    var seasonStillsP;
    if (tmdbId && isTvSeries && seasonNumbers.length > 0) {
        var sp = seasonNumbers.map(function (sn) {
            return workerLoadSeasonStills(tmdbId, sn).then(function (eps) {
                return { s: sn, e: eps };
            });
        });
        seasonStillsP = Promise.all(sp).then(function (arr) {
            var map = {};
            for (var i = 0; i < arr.length; i++) {
                if (arr[i].e && arr[i].e.length > 0) {
                    map[arr[i].s] = arr[i].e;
                }
            }
            return map;
        });
    } else {
        seasonStillsP = Promise.resolve({});
    }

    var movieStillP;
    if (tmdbId && !isTvSeries && seasonNumbers.length === 0) {
        movieStillP = workerLoadMovieStill(tmdbId);
    } else {
        movieStillP = Promise.resolve(null);
    }

    return Promise.all([detailsP, seasonStillsP, movieStillP]).then(function (res) {
        return {
            tmdbId: tmdbId,
            cleanTitle: cleanTitle,
            seasonNumbers: seasonNumbers,
            isTvSeries: isTvSeries,
            mediaType: mediaType,
            videoFilesCount: videoFilesCount,
            details: res[0],
            allSeasonEpisodes: res[1],
            movieStillPosterPath: res[2]
        };
    });
}
// ==================== ОБРАБОТЧИК СООБЩЕНИЙ ====================
self.onmessage = function (e) {
    var msg = e.data;
    var id = msg.id;

    switch (msg.type) {

        // --- Батч нормализация результатов поиска ---
        case 'NORMALIZE_BATCH':
            var items = msg.payload.items || [];
            var normalized = [];
            for (var i = 0; i < items.length; i++) {
                normalized.push(normalizeSearchResult(items[i]));
            }
            self.postMessage({ id: id, type: 'RESULT', data: normalized });
            break;

        // --- Фильтрация + сортировка ---
        case 'APPLY_FILTERS':
            var filtered = computeFilteredAndSorted(msg.payload.items || [], msg.payload.filters || {});
            self.postMessage({ id: id, type: 'RESULT', data: filtered });
            break;

        // --- Вычисление доступных фильтров ---
        case 'COMPUTE_FILTERS':
            var filters = computeAvailableFilters(msg.payload.items || []);
            self.postMessage({ id: id, type: 'RESULT', data: filters });
            break;

        // --- Загрузка всех TMDB данных для торрента ---
        case 'LOAD_ALL_TMDB_DATA':
            workerLoadAllTmdbData(msg.payload.torrent)
                .then(function (data) {
                    self.postMessage({ id: id, type: 'RESULT', data: data });
                })
                .catch(function (err) {
                    self.postMessage({ id: id, type: 'ERROR', error: err.message || 'Unknown error' });
                });
            break;

        // --- Очистка кэшей Worker'а ---
        case 'CLEAR_CACHES':
            workerSeasonCache = {};
            workerTmdbDetailsCache = {};
            self.postMessage({ id: id, type: 'RESULT', data: { success: true } });
            break;

        default:
            self.postMessage({ id: id, type: 'ERROR', error: 'Unknown message type: ' + msg.type });
    }
};

// Готовность
self.postMessage({ type: 'WORKER_READY' });
