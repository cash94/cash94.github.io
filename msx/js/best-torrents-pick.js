// best-torrents-pick.js — подбор лучших раздач по уровням качества.
//
// Чистая логика, без DOM и хранилищ: один и тот же файл работает и в
// torrents-worker.js (importScripts, адрес передаёт best-torrents.js), и в
// основном потоке, когда воркер не поднялся. Поэтому близнеца у этих функций
// нет и заводить его не надо.
//
// На вход — выдача после normalizeSearchResult, на выход — по одной раздаче на
// уровень (4K DV, 4K HDR, 4K SDR, 1080, 720, 480), у сериала — на каждый сезон.
//
// Оценка внутри уровня: 0,30 сиды + 0,30 свежесть + 0,20 озвучки + 0,20 размер.
// Числа подобраны на настоящих выдачах jac.red, а не умозрительно:
//  - сиды — логарифм с потолком на 1000. Потолок на 100 был ошибкой: у «Аркейна»
//    2792 сида и 359 выходили равны, и лучшей стала мёртвая раздача;
//  - свежесть — дата раздачи. Сиды Jacred берёт с трекеров, и у старой раздачи
//    это нередко давний счётчик: те 359 были у раздачи двухлетней давности;
//  - размер: больше — не значит лучше. Он только отсекает пережатое и
//    неподъёмное, внутри разумных границ разницы нет. Считается через
//    битрейт (размер ÷ длительность), а не в гигабайтах: так
//    сравнимы фильм на полтора часа и на три, серия и целый сезон. HEVC и AV1
//    при том же качестве легче, поэтому нижняя граница у них ниже;
//  - озвучки — потолок на 4, больше на выборе уже не сказывается.
(function (root) {
    'use strict';

    var TIERS = [
        { key: 'dv', label: '4K DV', quality: 2160 },
        { key: 'hdr', label: '4K HDR', quality: 2160 },
        { key: 'sdr', label: '4K SDR', quality: 2160 },
        { key: '1080', label: '1080p', quality: 1080 },
        { key: '720', label: '720p', quality: 720 },
        { key: '480', label: '480p', quality: 480 }
    ];

    /** Разумный битрейт уровня, Мбит/с. Ниже — пережато, выше — ремукс, который не всякая сеть потянет */
    var BAND = { 2160: [18, 45], 1080: [6, 16], 720: [3, 7], 480: [1.2, 3] };

    var MIN_SEEDERS = 2;
    var SEEDERS_CAP_LOG = 3;      // log10(1 + 1000)
    var VOICES_CAP = 4;
    var W_SEEDERS = 0.30, W_FRESH = 0.30, W_VOICES = 0.20, W_SIZE = 0.20;
    /** Младше — раздача полностью свежая, старше второго срока — свежесть ноль */
    var FRESH_FULL_DAYS = 180, FRESH_ZERO_DAYS = 1460;
    /** Даты нет — ни в плюс, ни в минус */
    var FRESH_UNKNOWN = 0.5;
    /** Во сколько раз HEVC и AV1 экономнее H.264 при том же качестве */
    var EFFICIENT_CODEC_GAIN = 1.5;
    /** Потеря оценки за октаву от разумного битрейта */
    var SIZE_OCTAVE_PENALTY = 0.6;
    /* Потеря всей оценки за октаву сверх разумного битрейта. Одного веса размера мало:
       свежий ремукс на 98 ГБ обходил раздачу на 39 ГБ у «Пацанов», хотя лишний вес
       ничего не даёт, а поток тяжелее */
    var OVERSIZE_OCTAVE_PENALTY = 0.25;
    var OVERSIZE_FLOOR = 0.5;
    /** Длительность неизвестна — размер не оцениваем ни в плюс, ни в минус */
    var SIZE_UNKNOWN = 0.5;
    /** Сколько серий в раздаче, название не сказало: скорее всего сезон целый, но не наверняка */
    var EPISODES_UNKNOWN_COVER = 0.9;

    // Граница слова здесь своя: \b в JS кириллицу не считает буквами.
    var BAD_RE = /(^|[^a-zа-я])3D([^a-zа-я]|$)|HSBS|H-?OU([^a-z]|$)|Anaglyph|CAM-?Rip|HDTS|TeleSync|Экранка|Трейлер|Trailer/i;
    // TS отдельно и с учётом регистра: иначе попадётся любое «ts» внутри названия
    var TS_RE = /(^|[\s\/|(\[])TS([\s\/|)\]]|$)/;
    var DV_RE = /Dolby\s*Vision|DoVi|(^|[^a-zа-я])DV([^a-zа-я]|$)/i;
    var UKR_RE = /(^|[^a-z])Ukr([^a-z]|$)/i;
    var EFFICIENT_RE = /HEVC|H\.?265|x265|AV1/i;

    /* Озвучки в шапке раздачи: «ДБ, 3 x ПМ, АП (Есарев, Яроцкий), ЛД, СТ».
     * info.voices заметно занижает: у «4 x ПМ, ПД» там бывает пусто. Множитель
     * пишут и латинской x, и кириллической х; имена в скобках — это тоже счёт. */
    var VOICE_RE = /(?:^|[\s,\/|])(?:(\d+)\s*[xх]\s*)?(ДБ|ПМ|ПД|ПО|АП|ЛД|ЛО|ЛМ|ДО)(?=[\s,\/|(]|$)(?:\s*\(([^)]*)\))?/g;

    function countTitleVoices(title) {
        var t = String(title || ''), count = 0, m;
        VOICE_RE.lastIndex = 0;
        while ((m = VOICE_RE.exec(t)) !== null) {
            count += m[1] ? parseInt(m[1], 10) : (m[3] ? m[3].split(',').length : 1);
        }
        return count;
    }

    /** Сводка ffprobe подрезана до нескольких дорожек, но потолок счёта и так 4 */
    function audioInfo(item) {
        var audio = (item.media && item.media.audio) || [];
        var russian = 0, labelled = 0;
        for (var i = 0; i < audio.length; i++) {
            var lang = String(audio[i].lang || '').toLowerCase();
            var title = String(audio[i].title || '');
            if (lang && lang !== 'und') labelled++;
            if (lang === 'rus' || lang === 'ru' || /[а-яё]/i.test(title)) russian++;
        }
        return { russian: russian, labelled: labelled };
    }

    function countVoices(item, audio) {
        var listed = (item.voices && item.voices.length) || 0;
        return Math.max(audio.russian, listed, countTitleVoices(item.title));
    }

    /**
     * Раздача без русского. Метки языка у части русских рипов нет вовсе, так что
     * пустая метка — не приговор: нужно, чтобы метки были и русской среди них не
     * оказалось.
     */
    function lacksRussian(item, audio, voices) {
        if (voices > 0 || audio.russian > 0) return false;
        return audio.labelled > 0 || UKR_RE.test(item.title || '');
    }

    function tierOf(item) {
        var q = item.quality || 0;
        if (q >= 2160) {
            if (DV_RE.test(item.title || '')) return 'dv';
            return item.videotype === 'hdr' ? 'hdr' : 'sdr';
        }
        if (q >= 1080) return '1080';
        if (q >= 720) return '720';
        if (q >= 480) return '480';
        return null;
    }

    /* ==================== СЕРИИ В НАЗВАНИИ ====================
     *
     * Единого формата нет, у каждого трекера свой. Все ветки ниже взяты из
     * настоящих выдач («Пацаны», «Во все тяжкие», «Атака титанов», идущие
     * сериалы):
     *   (3 сезон: 1-8 серии из 8)     [04x01-03 из 08]     (1-3 из 8)
     *   [01-04x01-31 из 32]           (1 сезон: 7 серий из 7)     [25 из 25]
     *   Серии: 1-16 (16)              s03e01-08            [+7 серия]
     *   [05x01]                       5 сезон 8 серия
     * «из ?» и «из XX» бывают у идущих сериалов: всего серий ещё не знают.
     */
    function parseEpisodes(title) {
        var t = String(title || ''), m;

        // Диапазон с итогом. 01-04x01-31: первая пара — сезоны, «из» стоит за второй
        m = t.match(/(\d{1,4})\s*[-–]\s*(\d{1,4})\s*(?:сери\S*\s*)?из\s*(\d{1,4}|[?xх]+)/i);
        if (m) return episodeRange(m[1], m[2], m[3]);

        // [04x01 из 08] — вышла одна серия с таким номером
        m = t.match(/\d{1,2}x(\d{1,4})\s*из\s*(\d{1,4}|[?xх]+)/i);
        if (m) return { have: 1, total: parseTotal(m[2]) };

        // 7 серий из 7, 25 из 25
        m = t.match(/(\d{1,4})\s*(?:сери\S*\s*)?из\s*(\d{1,4}|[?xх]+)/i);
        if (m) return { have: parseInt(m[1], 10), total: parseTotal(m[2]) };

        // Серии: 1-16 (16), Серии 1-7 (7)
        m = t.match(/сери\S*:?\s*(\d{1,4})\s*[-–]\s*(\d{1,4})\s*\((\d{1,4})\)/i);
        if (m) return episodeRange(m[1], m[2], m[3]);

        // s03e01-08, S03E01-E08
        m = t.match(/s\d{1,2}e(\d{1,4})\s*[-–]\s*e?(\d{1,4})/i);
        if (m) return episodeRange(m[1], m[2], null);

        // [+7 серия]: так помечают обновление раздачи, серии внутри — с первой по эту
        m = t.match(/\[\s*\+\s*(\d{1,4})\s*сери/i);
        if (m) return { have: parseInt(m[1], 10), total: null };

        // Серии 1-8 без итога
        m = t.match(/сери\S*:?\s*(\d{1,4})\s*[-–]\s*(\d{1,4})/i);
        if (m) return episodeRange(m[1], m[2], null);

        // 1-8 серии
        m = t.match(/(\d{1,4})\s*[-–]\s*(\d{1,4})\s*сери/i);
        if (m) return episodeRange(m[1], m[2], null);

        // Одна серия: [05x01], s05e03, «5 сезон 8 серия»
        if (/\[\d{1,2}x\d{1,4}\]|s\d{1,2}e\d{1,4}|сезон\s+\d{1,4}\s*сери/i.test(t)) {
            return { have: 1, total: null };
        }
        return null;
    }

    function parseTotal(s) {
        var n = parseInt(s, 10);
        return n > 0 ? n : null;
    }

    function episodeRange(from, to, total) {
        var a = parseInt(from, 10), b = parseInt(to, 10);
        if (!(b >= a)) return null;
        return { have: b - a + 1, total: total === null ? null : parseTotal(total) };
    }

    /** Сезоны раздачи. У аниме Jacred их часто не знает: «ТВ-3», «3rd Season» */
    function seasonsOf(item, showSeasons) {
        if (item.seasons && item.seasons.length) return item.seasons;
        var t = String(item.title || '');
        var m = t.match(/ТВ-?\s*(\d{1,2})/i) || t.match(/(\d{1,2})(?:st|nd|rd|th)\s+season/i) ||
            t.match(/season\s*(\d{1,2})/i) || t.match(/(\d{1,2})\s*сезон/i);
        if (m) return [parseInt(m[1], 10)];
        return showSeasons.length === 1 ? [showSeasons[0].n] : [];
    }

    /* Верхняя граница у всех одна: она про то, потянет ли поток сеть, а сети всё
       равно, каким кодеком сжато */
    function sizeScore(mbps, quality, efficient) {
        var band = BAND[quality];
        if (!band || !(mbps > 0)) return SIZE_UNKNOWN;
        var low = efficient ? band[0] / EFFICIENT_CODEC_GAIN : band[0];
        var octaves = 0;
        if (mbps < low) octaves = Math.log(low / mbps) / Math.LN2;
        else if (mbps > band[1]) octaves = Math.log(mbps / band[1]) / Math.LN2;
        return Math.max(0, 1 - SIZE_OCTAVE_PENALTY * octaves);
    }

    /** Множитель всей оценки: 1, пока битрейт не выше разумного */
    function oversizeFactor(mbps, quality) {
        var band = BAND[quality];
        if (!band || !(mbps > band[1])) return 1;
        return Math.max(OVERSIZE_FLOOR, 1 - OVERSIZE_OCTAVE_PENALTY * Math.log(mbps / band[1]) / Math.LN2);
    }

    function isEfficientCodec(item) {
        var codec = item.media && item.media.vcodec;
        return codec === 'hevc' || codec === 'av1' || EFFICIENT_RE.test(item.title || '');
    }

    /** Логарифм: разница между годом и двумя важнее, чем между тремя и четырьмя */
    function freshScore(createTime, now) {
        if (!createTime) return FRESH_UNKNOWN;
        var days = (now - createTime) / 86400000;
        if (days <= FRESH_FULL_DAYS) return 1;
        return Math.max(0, 1 - Math.log(days / FRESH_FULL_DAYS) / Math.log(FRESH_ZERO_DAYS / FRESH_FULL_DAYS));
    }

    function baseScore(item, voices, minutes, russianOriginal, now) {
        var mbps = minutes > 0 ? item.size * 8 / (minutes * 60) / 1000000 : 0;
        var seeders = Math.min(1, (Math.log(1 + (item.sid || 0)) / Math.LN10) / SEEDERS_CAP_LOG);
        var common = W_SEEDERS * seeders + W_SIZE * sizeScore(mbps, tierQuality(item), isEfficientCodec(item)) +
            W_FRESH * freshScore(item.createTime, now);
        // У русского кино озвучек нет по определению: считай мы их, «Сталкер»
        // проигрывал бы ни за что
        var oversize = oversizeFactor(mbps, tierQuality(item));
        if (russianOriginal) return oversize * common / (1 - W_VOICES);
        return oversize * (common + W_VOICES * Math.min(1, voices / VOICES_CAP));
    }

    function tierQuality(item) {
        var q = item.quality || 0;
        return q >= 2160 ? 2160 : q >= 1080 ? 1080 : q >= 720 ? 720 : 480;
    }

    /** Только то, что нужно строке списка и запуску: запись живёт в IndexedDB */
    function compactRow(item, tier, voices, episodes, seasons) {
        return {
            tier: tier.key,
            label: tier.label,
            hash: hashOf(item.magnet),
            magnet: item.magnet,
            title: item.title,
            size: item.size,
            sizeName: item.sizeName,
            sid: item.sid || 0,
            date: item.createTime || 0,
            voices: voices,
            have: episodes ? episodes.have : null,
            total: episodes ? episodes.total : null,
            seasons: seasons || null
        };
    }

    function hashOf(magnet) {
        var m = String(magnet || '').match(/xt=urn:btih:([a-z0-9]+)/i);
        return m ? m[1].toLowerCase() : '';
    }

    /** Отсев и всё, что считается один раз на раздачу */
    function prepare(items) {
        var out = [];
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            if (!item || !item.size || !item.magnet || (item.sid || 0) < MIN_SEEDERS) continue;
            var title = item.title || '';
            if (BAD_RE.test(title) || TS_RE.test(title)) continue;
            var tier = tierOf(item);
            if (!tier) continue;
            var audio = audioInfo(item);
            var voices = countVoices(item, audio);
            if (lacksRussian(item, audio, voices)) continue;
            out.push({ item: item, tier: tier, voices: voices, episodes: parseEpisodes(title) });
        }
        return out;
    }

    function tierByKey(key) {
        for (var i = 0; i < TIERS.length; i++) if (TIERS[i].key === key) return TIERS[i];
        return null;
    }

    function better(a, b) {
        if (!b) return true;
        if (a.score !== b.score) return a.score > b.score;
        return (a.item.sid || 0) > (b.item.sid || 0);
    }

    function rowsInOrder(best) {
        var rows = [];
        for (var i = 0; i < TIERS.length; i++) {
            var b = best[TIERS[i].key];
            if (b) rows.push(compactRow(b.item, TIERS[i], b.voices, b.episodes, b.seasons));
        }
        return rows;
    }

    function pickMovie(prepared, ctx) {
        var best = {}, now = Date.now();
        for (var i = 0; i < prepared.length; i++) {
            var p = prepared[i];
            p.score = baseScore(p.item, p.voices, ctx.minutes || 0, ctx.russianOriginal, now);
            if (better(p, best[p.tier])) best[p.tier] = p;
        }
        return { serial: false, groups: [{ season: null, rows: rowsInOrder(best) }] };
    }

    /** Минут в раздаче сериала: на серии из названия, а нет их — на весь сезон по TMDB */
    function serialMinutes(p, seasons, showSeasons, epMinutes) {
        if (!epMinutes) return 0;
        var episodes = p.episodes && p.episodes.have;
        if (!episodes) {
            for (var i = 0; i < seasons.length; i++) {
                for (var k = 0; k < showSeasons.length; k++) {
                    if (showSeasons[k].n === seasons[i]) episodes = (episodes || 0) + (showSeasons[k].episodes || 0);
                }
            }
        }
        return (episodes || 0) * epMinutes;
    }

    /* Сериал: у каждого сезона свои уровни. Сборник нескольких сезонов — кандидат
     * в каждом из них.
     *
     * Полнота важнее сидов. Если в 1080 вышло 5 серий, а раздача с 4 сериями
     * раздаётся бодрее, лучшая всё равно та, где серий больше: за новой серией
     * сюда и пришли. Поэтому оценка умножается на квадрат полноты. Считается она
     * внутри уровня, а не по сезону: в 4K может быть на серию меньше, чем в
     * 1080, и это честно покажут обе строки. */
    function pickSerial(prepared, ctx) {
        var showSeasons = ctx.seasons || [];
        var bySeason = {}, now = Date.now();

        for (var i = 0; i < prepared.length; i++) {
            var p = prepared[i];
            var seasons = seasonsOf(p.item, showSeasons);
            p.seasons = seasons;
            p.baseScore = baseScore(p.item, p.voices, serialMinutes(p, seasons, showSeasons, ctx.episodeMinutes),
                ctx.russianOriginal, now);
            for (var s = 0; s < seasons.length; s++) {
                var n = seasons[s];
                if (!bySeason[n]) bySeason[n] = {};
                if (!bySeason[n][p.tier]) bySeason[n][p.tier] = [];
                bySeason[n][p.tier].push(p);
            }
        }

        var groups = [];
        var numbers = Object.keys(bySeason).map(Number).sort(function (a, b) { return a - b; });
        for (var g = 0; g < numbers.length; g++) {
            var tiers = bySeason[numbers[g]], best = {};
            for (var key in tiers) {
                if (!tierByKey(key)) continue;
                var list = tiers[key], most = 0, c;
                for (c = 0; c < list.length; c++) {
                    var one = list[c];
                    if (one.seasons.length === 1 && one.episodes && one.episodes.have > most) most = one.episodes.have;
                }
                for (c = 0; c < list.length; c++) {
                    var cand = list[c], cover = coverOf(cand, most);
                    var scored = { item: cand.item, voices: cand.voices, episodes: cand.episodes, seasons: cand.seasons,
                        score: cand.baseScore * cover * cover };
                    if (better(scored, best[key])) best[key] = scored;
                }
            }
            groups.push({ season: numbers[g], rows: rowsInOrder(best) });
        }
        return { serial: true, groups: groups };
    }

    function coverOf(p, most) {
        // Сборник сезонов считаем полным: сколько в нём серий именно этого
        // сезона, из названия не узнать. Недобранный сборник («1-31 из 32») — по доле
        if (p.seasons.length > 1) {
            if (p.episodes && p.episodes.total) return Math.min(1, p.episodes.have / p.episodes.total);
            return 1;
        }
        if (!p.episodes || !p.episodes.have) return EPISODES_UNKNOWN_COVER;
        return most > 0 ? Math.min(1, p.episodes.have / most) : 1;
    }

    /**
     * @param {Array} items выдача после normalizeSearchResult
     * @param {Object} ctx {serial, minutes, episodeMinutes, russianOriginal, seasons: [{n, episodes}]}
     * @returns {{serial: boolean, groups: Array<{season: ?number, rows: Array}>}}
     */
    function pick(items, ctx) {
        ctx = ctx || {};
        var prepared = prepare(items || []);
        return ctx.serial ? pickSerial(prepared, ctx) : pickMovie(prepared, ctx);
    }

    root.BestTorrentsPick = {
        pick: pick,
        parseEpisodes: parseEpisodes,
        countTitleVoices: countTitleVoices,
        tierOf: tierOf,
        TIERS: TIERS
    };
})(typeof self !== 'undefined' ? self : this);
