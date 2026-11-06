/* Сборка для старых браузеров (Chrome 53) из js/best-torrents-pick.js — tools/legacy-build/build.js. Руками не править. */
(function (root) {
  'use strict';

  var TIERS = [{
    key: 'dv',
    label: '4K DV',
    quality: 2160
  }, {
    key: 'hdr',
    label: '4K HDR',
    quality: 2160
  }, {
    key: 'sdr',
    label: '4K SDR',
    quality: 2160
  }, {
    key: '1080',
    label: '1080p',
    quality: 1080
  }, {
    key: '720',
    label: '720p',
    quality: 720
  }, {
    key: '480',
    label: '480p',
    quality: 480
  }];
  var BAND = {
    2160: [18, 45],
    1080: [6, 16],
    720: [3, 7],
    480: [1.2, 3]
  };
  var MIN_SEEDERS = 2;
  var SEEDERS_CAP_LOG = 3;
  var VOICES_CAP = 4;
  var W_SEEDERS = 0.30,
    W_FRESH = 0.30,
    W_VOICES = 0.20,
    W_SIZE = 0.20;
  var FRESH_FULL_DAYS = 180,
    FRESH_ZERO_DAYS = 1460;
  var FRESH_UNKNOWN = 0.5;
  var EFFICIENT_CODEC_GAIN = 1.5;
  var SIZE_OCTAVE_PENALTY = 0.6;
  var OVERSIZE_OCTAVE_PENALTY = 0.25;
  var OVERSIZE_FLOOR = 0.5;
  var SIZE_UNKNOWN = 0.5;
  var EPISODES_UNKNOWN_COVER = 0.9;
  var BAD_RE = /(^|[^a-zа-я])3D([^a-zа-я]|$)|HSBS|H-?OU([^a-z]|$)|Anaglyph|CAM-?Rip|HDTS|TeleSync|Экранка|Трейлер|Trailer/i;
  var TS_RE = /(^|[\s\/|(\[])TS([\s\/|)\]]|$)/;
  var DV_RE = /Dolby\s*Vision|DoVi|(^|[^a-zа-я])DV([^a-zа-я]|$)/i;
  var UKR_RE = /(^|[^a-z])Ukr([^a-z]|$)/i;
  var EFFICIENT_RE = /HEVC|H\.?265|x265|AV1/i;
  var VOICE_RE = /(?:^|[\s,\/|])(?:(\d+)\s*[xх]\s*)?(ДБ|ПМ|ПД|ПО|АП|ЛД|ЛО|ЛМ|ДО)(?=[\s,\/|(]|$)(?:\s*\(([^)]*)\))?/g;
  function countTitleVoices(title) {
    var t = String(title || ''),
      count = 0,
      m;
    VOICE_RE.lastIndex = 0;
    while ((m = VOICE_RE.exec(t)) !== null) {
      count += m[1] ? parseInt(m[1], 10) : m[3] ? m[3].split(',').length : 1;
    }
    return count;
  }
  function audioInfo(item) {
    var audio = item.media && item.media.audio || [];
    var russian = 0,
      labelled = 0;
    for (var i = 0; i < audio.length; i++) {
      var lang = String(audio[i].lang || '').toLowerCase();
      var title = String(audio[i].title || '');
      if (lang && lang !== 'und') labelled++;
      if (lang === 'rus' || lang === 'ru' || /[а-яё]/i.test(title)) russian++;
    }
    return {
      russian: russian,
      labelled: labelled
    };
  }
  function countVoices(item, audio) {
    var listed = item.voices && item.voices.length || 0;
    return Math.max(audio.russian, listed, countTitleVoices(item.title));
  }
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
  function parseEpisodes(title) {
    var t = String(title || ''),
      m;
    m = t.match(/(\d{1,4})\s*[-–]\s*(\d{1,4})\s*(?:сери\S*\s*)?из\s*(\d{1,4}|[?xх]+)/i);
    if (m) return episodeRange(m[1], m[2], m[3]);
    m = t.match(/\d{1,2}x(\d{1,4})\s*из\s*(\d{1,4}|[?xх]+)/i);
    if (m) return {
      have: 1,
      total: parseTotal(m[2])
    };
    m = t.match(/(\d{1,4})\s*(?:сери\S*\s*)?из\s*(\d{1,4}|[?xх]+)/i);
    if (m) return {
      have: parseInt(m[1], 10),
      total: parseTotal(m[2])
    };
    m = t.match(/сери\S*:?\s*(\d{1,4})\s*[-–]\s*(\d{1,4})\s*\((\d{1,4})\)/i);
    if (m) return episodeRange(m[1], m[2], m[3]);
    m = t.match(/s\d{1,2}e(\d{1,4})\s*[-–]\s*e?(\d{1,4})/i);
    if (m) return episodeRange(m[1], m[2], null);
    m = t.match(/\[\s*\+\s*(\d{1,4})\s*сери/i);
    if (m) return {
      have: parseInt(m[1], 10),
      total: null
    };
    m = t.match(/сери\S*:?\s*(\d{1,4})\s*[-–]\s*(\d{1,4})/i);
    if (m) return episodeRange(m[1], m[2], null);
    m = t.match(/(\d{1,4})\s*[-–]\s*(\d{1,4})\s*сери/i);
    if (m) return episodeRange(m[1], m[2], null);
    if (/\[\d{1,2}x\d{1,4}\]|s\d{1,2}e\d{1,4}|сезон\s+\d{1,4}\s*сери/i.test(t)) {
      return {
        have: 1,
        total: null
      };
    }
    return null;
  }
  function parseTotal(s) {
    var n = parseInt(s, 10);
    return n > 0 ? n : null;
  }
  function episodeRange(from, to, total) {
    var a = parseInt(from, 10),
      b = parseInt(to, 10);
    if (!(b >= a)) return null;
    return {
      have: b - a + 1,
      total: total === null ? null : parseTotal(total)
    };
  }
  function seasonsOf(item, showSeasons) {
    if (item.seasons && item.seasons.length) return item.seasons;
    var t = String(item.title || '');
    var m = t.match(/ТВ-?\s*(\d{1,2})/i) || t.match(/(\d{1,2})(?:st|nd|rd|th)\s+season/i) || t.match(/season\s*(\d{1,2})/i) || t.match(/(\d{1,2})\s*сезон/i);
    if (m) return [parseInt(m[1], 10)];
    return showSeasons.length === 1 ? [showSeasons[0].n] : [];
  }
  function sizeScore(mbps, quality, efficient) {
    var band = BAND[quality];
    if (!band || !(mbps > 0)) return SIZE_UNKNOWN;
    var low = efficient ? band[0] / EFFICIENT_CODEC_GAIN : band[0];
    var octaves = 0;
    if (mbps < low) octaves = Math.log(low / mbps) / Math.LN2;else if (mbps > band[1]) octaves = Math.log(mbps / band[1]) / Math.LN2;
    return Math.max(0, 1 - SIZE_OCTAVE_PENALTY * octaves);
  }
  function oversizeFactor(mbps, quality) {
    var band = BAND[quality];
    if (!band || !(mbps > band[1])) return 1;
    return Math.max(OVERSIZE_FLOOR, 1 - OVERSIZE_OCTAVE_PENALTY * Math.log(mbps / band[1]) / Math.LN2);
  }
  function isEfficientCodec(item) {
    var codec = item.media && item.media.vcodec;
    return codec === 'hevc' || codec === 'av1' || EFFICIENT_RE.test(item.title || '');
  }
  function freshScore(createTime, now) {
    if (!createTime) return FRESH_UNKNOWN;
    var days = (now - createTime) / 86400000;
    if (days <= FRESH_FULL_DAYS) return 1;
    return Math.max(0, 1 - Math.log(days / FRESH_FULL_DAYS) / Math.log(FRESH_ZERO_DAYS / FRESH_FULL_DAYS));
  }
  function baseScore(item, voices, minutes, russianOriginal, now) {
    var mbps = minutes > 0 ? item.size * 8 / (minutes * 60) / 1000000 : 0;
    var seeders = Math.min(1, Math.log(1 + (item.sid || 0)) / Math.LN10 / SEEDERS_CAP_LOG);
    var common = W_SEEDERS * seeders + W_SIZE * sizeScore(mbps, tierQuality(item), isEfficientCodec(item)) + W_FRESH * freshScore(item.createTime, now);
    var oversize = oversizeFactor(mbps, tierQuality(item));
    if (russianOriginal) return oversize * common / (1 - W_VOICES);
    return oversize * (common + W_VOICES * Math.min(1, voices / VOICES_CAP));
  }
  function tierQuality(item) {
    var q = item.quality || 0;
    return q >= 2160 ? 2160 : q >= 1080 ? 1080 : q >= 720 ? 720 : 480;
  }
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
      out.push({
        item: item,
        tier: tier,
        voices: voices,
        episodes: parseEpisodes(title)
      });
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
    var best = {},
      now = Date.now();
    for (var i = 0; i < prepared.length; i++) {
      var p = prepared[i];
      p.score = baseScore(p.item, p.voices, ctx.minutes || 0, ctx.russianOriginal, now);
      if (better(p, best[p.tier])) best[p.tier] = p;
    }
    return {
      serial: false,
      groups: [{
        season: null,
        rows: rowsInOrder(best)
      }]
    };
  }
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
  function pickSerial(prepared, ctx) {
    var showSeasons = ctx.seasons || [];
    var bySeason = {},
      now = Date.now();
    for (var i = 0; i < prepared.length; i++) {
      var p = prepared[i];
      var seasons = seasonsOf(p.item, showSeasons);
      p.seasons = seasons;
      p.baseScore = baseScore(p.item, p.voices, serialMinutes(p, seasons, showSeasons, ctx.episodeMinutes), ctx.russianOriginal, now);
      for (var s = 0; s < seasons.length; s++) {
        var n = seasons[s];
        if (!bySeason[n]) bySeason[n] = {};
        if (!bySeason[n][p.tier]) bySeason[n][p.tier] = [];
        bySeason[n][p.tier].push(p);
      }
    }
    var groups = [];
    var numbers = Object.keys(bySeason).map(Number).sort(function (a, b) {
      return a - b;
    });
    for (var g = 0; g < numbers.length; g++) {
      var tiers = bySeason[numbers[g]],
        best = {};
      for (var key in tiers) {
        if (!tierByKey(key)) continue;
        var list = tiers[key],
          most = 0,
          c;
        for (c = 0; c < list.length; c++) {
          var one = list[c];
          if (one.seasons.length === 1 && one.episodes && one.episodes.have > most) most = one.episodes.have;
        }
        for (c = 0; c < list.length; c++) {
          var cand = list[c],
            cover = coverOf(cand, most);
          var scored = {
            item: cand.item,
            voices: cand.voices,
            episodes: cand.episodes,
            seasons: cand.seasons,
            score: cand.baseScore * cover * cover
          };
          if (better(scored, best[key])) best[key] = scored;
        }
      }
      groups.push({
        season: numbers[g],
        rows: rowsInOrder(best)
      });
    }
    return {
      serial: true,
      groups: groups
    };
  }
  function coverOf(p, most) {
    if (p.seasons.length > 1) {
      if (p.episodes && p.episodes.total) return Math.min(1, p.episodes.have / p.episodes.total);
      return 1;
    }
    if (!p.episodes || !p.episodes.have) return EPISODES_UNKNOWN_COVER;
    return most > 0 ? Math.min(1, p.episodes.have / most) : 1;
  }
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
