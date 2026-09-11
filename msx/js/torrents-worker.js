// torrents-worker.js — Web Worker для torrents.js
// Вычисления + TMDB-запросы. БЕЗ DOM, БЕЗ localStorage.
// Same-origin (через прокси Express), fetch работает.
'use strict';

// ==================== КОНСТАНТЫ ====================
var TMDB_CACHE_TTL = 86400000; // 24 часа

// ==================== КЭШИ ====================
// Сообщение CLEAR_CACHES есть, но его никто не шлёт, а TTL проверяется только
// при чтении — то есть протухшая запись висит в памяти, пока её не спросят
// повторно. За долгий сеанс (десятки открытых раздач, у сериала ещё и список
// серий на каждый сезон) в потоке воркера копились мегабайты. Поэтому держим
// оба кэша ограниченными.
var TMDB_CACHE_MAX = 60;
var workerSeasonCache = {};
var workerTmdbDetailsCache = {};

/** Положить в кэш и подрезать: сначала протухшее, потом самое старое */
function cachePut(store, key, value) {
    store[key] = { d: value, t: Date.now() };

    var keys = Object.keys(store);
    if (keys.length <= TMDB_CACHE_MAX) return;

    var now = Date.now();
    for (var i = 0; i < keys.length; i++) {
        if (now - store[keys[i]].t >= TMDB_CACHE_TTL) delete store[keys[i]];
    }

    keys = Object.keys(store);
    while (keys.length > TMDB_CACHE_MAX) {
        var oldest = keys[0];
        for (var j = 1; j < keys.length; j++) {
            if (store[keys[j]].t < store[oldest].t) oldest = keys[j];
        }
        delete store[oldest];
        keys = Object.keys(store);
    }
}

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
/* ==================== РАЗБОР ffprobe ====================
 *
 * Рядом с каждой раздачей Jacred отдаёт ffprobe — реальные потоки файла:
 * разрешение, кодеки, битрейт, звуковые дорожки с языками и названиями,
 * субтитры. Отсюда берётся и качество, и та сводка, что показана в списке.
 *
 * Качество берём отсюда, а не из info.quality, потому что info.quality Jacred
 * выводит из НАЗВАНИЯ и на рипах регулярно ошибается. Замер по выдаче «Дюны»
 * (169 раздач, 137 с ffprobe): разошёлся с файлом в 25 случаях, и в 24 из них
 * занизил до 480 — это и есть «в названии 1080p, а в фильтре SD». Ошибается
 * предсказуемо: нет явного «1080p» в названии (BDRip, WEBRip, WEB-DLRip) —
 * ставится 480; а когда «(1080p)» есть, но перед ним лишние блоки в скобках
 * («3D (HSBS) / BDRip (1080p)», «Blu-Ray Remux (1080p)»), разбор до
 * разрешения не доходит.
 *
 * У этих функций есть близнец в torrents.js (там же живёт запасной путь,
 * когда воркер недоступен). Править обе копии.
 */

/* Обложку раздачи часто вшивают в контейнер ОТДЕЛЬНЫМ видеопотоком, и она
 * бывает крупнее самого фильма: внутри рипа 1150x480 попадался mjpeg
 * 3840x2160. Без этого списка такой рип определялся бы как 4K. */
var FFPROBE_COVER_CODECS = ['mjpeg', 'png', 'bmp', 'gif', 'jpeg', 'webp'];

var FFPROBE_VIDEO_NAMES = {
    h264: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9',
    mpeg4: 'MPEG-4', mpeg2video: 'MPEG-2', vc1: 'VC-1', xvid: 'XviD'
};

/** Сколько дорожек и языков субтитров показываем, прежде чем свернуть в «+N» */
var FFPROBE_MAX_AUDIO = 4;
var FFPROBE_MAX_SUBS = 5;
var FFPROBE_TRACK_TITLE_MAX = 26;

/** Главный видеопоток: самый крупный из тех, что не обложка */
function pickFfprobeVideoStream(ffprobe) {
    if (!ffprobe || !ffprobe.length) return null;

    var best = null;
    for (var i = 0; i < ffprobe.length; i++) {
        var s = ffprobe[i];
        if (!s || s.codec_type !== 'video') continue;
        if (FFPROBE_COVER_CODECS.indexOf(String(s.codec_name || '').toLowerCase()) !== -1) continue;

        var w = s.width || 0, h = s.height || 0;
        if (!w || !h) continue;
        if (!best || w * h > best.width * best.height) best = s;
    }
    return best;
}

/**
 * Качество по размеру кадра.
 *
 * Ни ширины, ни высоты поодиночке не хватает. У кино чёрные поля обрезаны
 * прямо в файле (1920x800, 3840x1608) — по высоте это уехало бы на ступень
 * вниз. А у кадров 4:3 и обрезанных по бокам (1080x720, 960x720) наоборот
 * мала ширина. Поэтому берём большее из двух прочтений: собственной высоты и
 * высоты, восстановленной из ширины по 16:9.
 *
 * Отдельно — 3D: там два кадра сложены в один файл, сверху-вниз (1920x2160)
 * или бок о бок. Такой кадр не бывает почти квадратным или втрое шире
 * широкоэкранного, так что по форме их и узнаём, возвращая к одному кадру.
 *
 * Проверено на 212 раздачах из четырёх выдач, где разрешение названо и в
 * заголовке: совпало 210. Оба расхождения — там, где врёт заголовок
 * (1024x576 с подписью «720p | iPad», 960x720 с подписью «1080»).
 *
 * Границы подобраны так, чтобы на выходе были только значения из
 * QUALITY_OPTIONS: качество, которого нет в списке фильтра, сделало бы
 * раздачу недостижимой ни одним его вариантом.
 */
function qualityFromFrame(width, height) {
    var w = width || 0, h = height || 0;
    if (!w || !h) return 0;

    if (h > w * 0.9) h = h / 2;        // 3D, кадры сложены сверху-вниз
    if (w > h * 3) w = w / 2;          // 3D, кадры сложены бок о бок

    var eff = Math.max(h, w * 9 / 16);

    if (eff >= 1700) return 2160;
    if (eff >= 900) return 1080;
    if (eff >= 650) return 720;
    if (eff >= 380) return 480;
    return 360;
}

/**
 * Запасной разбор — по названию, когда ffprobe нет (около пятой части выдачи).
 *
 * Берём НАИБОЛЬШЕЕ из встреченных «1080p», «2160p»: в «UHD BDRip 1080p»
 * первым стоит слово UHD, но настоящее разрешение названо цифрой. Латинская p
 * и кириллическая р равноправны — на трекерах встречаются обе.
 */
function qualityFromTitle(title) {
    var t = String(title || '');
    var re = /(\d{3,4})\s*[pi\u0440](?![\da-z\u0430-\u044f])/gi;
    var best = 0, m;

    while ((m = re.exec(t)) !== null) {
        var v = parseInt(m[1], 10);
        if (v > best) best = v;
    }

    if (best >= 2000) return 2160;
    if (best >= 1000) return 1080;
    if (best >= 700) return 720;
    if (best >= 400) return 480;
    if (best >= 300) return 360;

    // Цифр нет вовсе — остаётся словесная пометка
    if (/4\s*[k\u043a]|\buhd\b/i.test(t)) return 2160;
    return 0;
}

/* Признаки HDR в названии. Хвост «(?![буквы])» обязателен: без него под HDR
 * попадала бы студия HDRezka, а она стоит в названии почти каждой второй
 * раздачи. */
var HDR_TITLE_RE = /HDR(?![a-z\u0430-\u044f])|HDR10|Dolby\s*Vision|\bDV\s*[\d.]|\bHLG\b|PQ10/i;

/**
 * SDR или HDR.
 *
 * info.videotype Jacred тоже выводит из названия и тоже иногда не дочитывает:
 * на четырёх раздачах из 449 в заголовке стоит «4K, HEVC, Dolby Vision» или
 * «4K, HEVC, HDR», а videotype всё равно sdr.
 *
 * Поправка односторонняя — только sdr → hdr. Обратный случай тоже встречается
 * (пять раздач помечены hdr, хотя в названии лишь «10-bit» или AV1, а 10 бит
 * сами по себе не HDR), но там нечем проверить: цветовых полей ffprobe не
 * отдаёт. Пропустить значок — ошибка меньшая, чем нарисовать несуществующий.
 */
function resolveVideotype(item, info) {
    var vt = String((info && info.videotype) || (item && item.videotype) || '').toLowerCase();
    if (vt === 'hdr') return vt;

    var title = String((item && (item.Title || item.title)) || '');
    if (HDR_TITLE_RE.test(title)) return 'hdr';

    return vt;
}

/**
 * Качество раздачи: измеренное важнее заявленного.
 *
 * ffprobe (реальный файл) → название (что обещает раздающий) → info.quality
 * (догадка Jacred). Последняя ступень оставлена, чтобы при пустом ffprobe и
 * безымянном разрешении поведение было прежним, а не «N/A».
 */
function resolveTorrentQuality(item, info) {
    var v = pickFfprobeVideoStream(item && item.ffprobe);
    if (v) {
        var byFrame = qualityFromFrame(v.width, v.height);
        if (byFrame) return byFrame;
    }

    var byTitle = qualityFromTitle(item && (item.Title || item.title));
    if (byTitle) return byTitle;

    return (info && info.quality) || (item && item.quality) || 0;
}

/** Раскладка звука в привычном виде: «5.1(side)» → «5.1», «stereo» → «2.0» */
function normalizeChannelLayout(stream) {
    var layout = String((stream && stream.channel_layout) || '').toLowerCase();

    if (layout) {
        if (layout.indexOf('mono') !== -1) return '1.0';
        if (layout.indexOf('stereo') !== -1) return '2.0';
        // «5.1(side)», «7.1(wide)» — уточнение в скобках лишнее
        var m = layout.match(/^(\d+\.\d+)/);
        if (m) return m[1];
    }

    // Раскладку заполняют не всегда, но число каналов есть почти везде
    var ch = stream && stream.channels;
    if (ch === 1) return '1.0';
    if (ch === 2) return '2.0';
    if (ch === 6) return '5.1';
    if (ch === 8) return '7.1';
    return '';
}

/** Битрейт одного потока: BPS (тег Matroska) и bit_rate (поле контейнера)
 *  дополняют друг друга — у одних раздач заполнено одно, у других другое */
function streamBitrate(stream) {
    if (!stream) return 0;
    var bps = parseInt((stream.tags && stream.tags.BPS) || 0, 10) || 0;
    if (!bps) bps = parseInt(stream.bit_rate || 0, 10) || 0;
    return bps > 0 ? bps : 0;
}

/**
 * Битрейт раздачи — сумма битрейтов потоков, но только если известен битрейт
 * ВИДЕО. Иначе ноль: пусть лучше числа не будет совсем.
 *
 * Оба ограничения вынужденные, каждое проверено на данных.
 *
 * Считать из размера и длительности нельзя, хотя соблазн есть: у сборников
 * Size — это ВЕСЬ сезон, а DURATION — одна серия, и деление завышало
 * результат до трёх тысяч раз («Во все тяжкие», 1-5 сезоны). Сумма потоков
 * относится к одному файлу и на фильмах совпадает с делением до сотых.
 *
 * А без битрейта видео сумма вырождается в звук: у 179 раздач из 449 битрейт
 * заполнен только у части звуковых дорожек, и «сумма» давала 0,58 Мбит/с для
 * раздачи 720p на 3,4 ГБ. Битрейт — это ровно то число, по которому сравнивают
 * раздачи одного разрешения, поэтому неверное здесь хуже отсутствующего.
 */
function ffprobeBitrate(ffprobe, videoStream) {
    var videoBps = streamBitrate(videoStream);
    if (!videoBps) return 0;

    var total = videoBps;
    for (var i = 0; i < ffprobe.length; i++) {
        var s = ffprobe[i];
        if (!s || s === videoStream) continue;
        if (s.codec_type !== 'audio' && s.codec_type !== 'subtitle') continue;
        total += streamBitrate(s);
    }

    return total;
}

/**
 * Название дорожки коротко.
 *
 * Выбирают дорожку по студии, а она на трекерах стоит в скобках:
 * «Двухголосый закадровый [Кубик в Кубе]». Обрезание с конца съело бы именно
 * её и оставило четыре неразличимых «Двухголосый закадровый…», поэтому из
 * длинного названия берём скобки, а обрезаем только если и без них длинно.
 */
function shortTrackTitle(title) {
    var t = String(title || '').replace(/\s+/g, ' ').trim();
    if (t.length <= FFPROBE_TRACK_TITLE_MAX) return t;

    var bracket = t.match(/[\[(]([^\])]+)[\])]/);
    if (bracket && bracket[1].length <= FFPROBE_TRACK_TITLE_MAX) return bracket[1].trim();

    return t.slice(0, FFPROBE_TRACK_TITLE_MAX - 1) + '…';
}

/**
 * Короткая сводка по файлу для показа в списке — то, что решает, стоит ли
 * брать именно эту раздачу и пойдёт ли она на конкретном телевизоре:
 * разрешение, видеокодек (HEVC и AV1 старые приставки не тянут), битрейт,
 * раскладка звука, языки и названия дорожек, языки субтитров.
 *
 * Полный ffprobe не храним: в выдаче бывают сотни раздач, у иной по два
 * десятка субтитров, и весь этот массив ещё и передаётся из воркера.
 * Поэтому списки здесь же подрезаются, а остаток считается в more*.
 */
function summarizeFfprobe(ffprobe) {
    if (!ffprobe || !ffprobe.length) return null;

    var v = pickFfprobeVideoStream(ffprobe);
    var audio = [], subs = [], layout = '', bestChannels = 0;
    var audioSeen = {}, audioTotal = 0, subsTotal = 0;

    for (var i = 0; i < ffprobe.length; i++) {
        var s = ffprobe[i];
        if (!s) continue;
        var tags = s.tags || {};
        var lang = String(tags.language || '').toLowerCase();

        if (s.codec_type === 'audio') {
            audioTotal++;

            // Лучшую раскладку показываем одну на раздачу: человеку важно, есть
            // ли вообще многоканальный звук, а не какой он у каждой дорожки
            if ((s.channels || 0) > bestChannels) {
                bestChannels = s.channels || 0;
                layout = normalizeChannelLayout(s);
            }

            var title = shortTrackTitle(tags.title);
            // Безымянная дорожка без языка чипом не станет — рисовать в ней
            // нечего. Считать её «дорожкой» тоже нельзя: по наличию дорожек
            // ниже скрывается список озвучек из info.voices, и такая пустышка
            // прятала бы единственное, что о раздаче вообще известно
            if (lang || title) {
                var key = lang + '\u0000' + title;
                if (!audioSeen[key]) {
                    audioSeen[key] = 1;
                    if (audio.length < FFPROBE_MAX_AUDIO) audio.push({ lang: lang, title: title });
                }
            }
        } else if (s.codec_type === 'subtitle') {
            subsTotal++;
            if (lang && subs.indexOf(lang) === -1 && subs.length < FFPROBE_MAX_SUBS) subs.push(lang);
        }
    }

    if (!v && !audioTotal && !subsTotal) return null;

    return {
        w: v ? v.width : 0,
        h: v ? v.height : 0,
        vcodec: v ? String(v.codec_name || '').toLowerCase() : '',
        bitrate: ffprobeBitrate(ffprobe, v),
        layout: layout,
        audio: audio,
        subs: subs,
        // Сколько РАЗНЫХ дорожек не поместилось. audioTotal считает все, включая
        // дубли по языку и названию, поэтому вычитаем именно показанные
        moreAudio: Math.max(0, Object.keys(audioSeen).length - audio.length),
        moreSubs: 0
    };
}

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
        quality: resolveTorrentQuality(item, info),
        media: summarizeFfprobe(item.ffprobe),
        videotype: resolveVideotype(item, info),
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
            cachePut(workerSeasonCache, key, eps);
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
            cachePut(workerSeasonCache, key, pp);
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
            if (data) cachePut(workerTmdbDetailsCache, key, data);
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
        var titlePattern = /(^|[^a-z0-9а-яё])(сезон|season|серия|эпизод|s\d+)([^a-z0-9а-яё]|$)/i;
        var filePattern = /s\d+e\d+|сезон|серия/i;
        var hasTitleMarker = titlePattern.test(torrent.title || '');
        var hasFileMarker = videoFiles.some(function(f) {
            return filePattern.test((f.path || '').toLowerCase());
        });
        isTvSeries = hasTitleMarker || hasFileMarker;
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
