// torrents-worker.js — только вычисления, БЕЗ fetch, БЕЗ DOM
'use strict';

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
        details: item.Details || item.details || null
    };
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    var k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ==================== applyFiltersAndSort (чистая) ====================
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

        // Trackers
        if (r.tracker) {
            var trackers = String(r.tracker).split(',');
            for (var t = 0; t < trackers.length; t++) {
                var tr = trackers[t].trim().toLowerCase();
                if (tr) trackerSet[tr] = true;
            }
        }

        // Years
        if (r.released && !isNaN(r.released)) yearSet[r.released] = true;

        // Seasons
        if (r.seasons && Array.isArray(r.seasons)) {
            for (var s = 0; s < r.seasons.length; s++) seasonSet[r.seasons[s]] = true;
        }

        // Voices
        if (r.voices && Array.isArray(r.voices)) {
            for (var v = 0; v < r.voices.length; v++) {
                if (r.voices[v] && r.voices[v].trim()) voiceSet[r.voices[v].trim()] = true;
            }
        }

        // Videotype
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

// ==================== ОБРАБОТЧИК ====================
self.onmessage = function (e) {
    var msg = e.data;
    var id = msg.id;

    switch (msg.type) {
        case 'NORMALIZE_BATCH':
            var items = msg.payload.items || [];
            var normalized = [];
            for (var i = 0; i < items.length; i++) {
                normalized.push(normalizeSearchResult(items[i]));
            }
            self.postMessage({ id: id, type: 'RESULT', data: normalized });
            break;

        case 'APPLY_FILTERS':
            var result = computeFilteredAndSorted(msg.payload.items || [], msg.payload.filters || {});
            self.postMessage({ id: id, type: 'RESULT', data: result });
            break;

        case 'COMPUTE_FILTERS':
            var filters = computeAvailableFilters(msg.payload.items || []);
            self.postMessage({ id: id, type: 'RESULT', data: filters });
            break;

        default:
            self.postMessage({ id: id, type: 'ERROR', error: 'Unknown: ' + msg.type });
    }
};

self.postMessage({ type: 'WORKER_READY' });