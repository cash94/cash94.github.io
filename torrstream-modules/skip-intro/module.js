// Модуль: Skip Intro
// version: '1.0.2'
// Данные о заставках и титрах из двух источников.
//
// Основной источник — api.introdb.app: он знает только IMDB, поэтому id
// переводится через TMDB. Запасной — tsskip.torrstream.online (зеркало
// api.theintrodb.org), он отвечает по tmdb_id. Спрашиваем оба сразу и берём
// каждый отрезок (заставку, титры) из introdb, а чего у него нет — из tsskip.
// Ответ приводится к формату theintrodb — клиент (player.js, fetchSkipData) и
// встроенный плеер Android разбирают именно его.
//
// До 1.0.2 основным был tsskip, а introdb спрашивали, только если у tsskip
// не было ничего. Серия, где tsskip знал одни титры, оставалась без заставки,
// хотя introdb её знал (например, «Басс из машины», TMDB 314271, S01E01).
//
// Эндпоинты:
//   GET /api/skip/v2/media?tmdb_id=&season=&episode=  — данные для серии
//   GET /api/skip/status                              — проверка модуля
//
// Ответ (как у theintrodb):
//   { tmdb_id, type, season, episode,
//     intro:   [{ start_ms, end_ms }],
//     credits: [{ start_ms, end_ms }],
//     source:  'theintrodb' | 'introdb' }

var TSSKIP_HOST = 'tsskip.torrstream.online';
var INTRODB_URL = 'https://api.introdb.app/segments';
var APIPROXY_URL = 'https://cash94.github.io/apiproxy.json';

var REQUEST_TIMEOUT = 8000;
// Найденное держим сутки, «ничего нет» — час: у introdb сегменты добавляют
// пользователи, и вчерашнее «нет» завтра может стать «есть»
var CACHE_TTL_MS = 24 * 60 * 60 * 1000;
var NEGATIVE_TTL_MS = 60 * 60 * 1000;
// Сбой (не ответило зеркало TMDB или introdb) — не «данных нет», держим недолго
var FAILURE_TTL_MS = 2 * 60 * 1000;
var CACHE_MAX = 500;

// Запасные значения: те же, что зашиты в сервере (services/api-proxy.js)
var FALLBACK_TMDB_API = 'http://tsapi.torrstream.online';   // hnar.online мёртв
var FALLBACK_TMDB_KEY = '064ea5b59beec7eccb3fe99059d58a50';

// ==================== КЭШ ====================

var cache = new Map();   // 'tmdb_s_e' → { at, ttl, body }

function cacheGet(key) {
  var hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > hit.ttl) {
    cache.delete(key);
    return null;
  }
  return hit.body;
}

function cacheSet(key, body, ttl) {
  // Самая старая запись вперёд: Map хранит порядок вставки
  if (cache.size >= CACHE_MAX) {
    var oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { at: Date.now(), ttl: ttl, body: body });
}

// ==================== ЗАПРОСЫ ====================

function fetchJson(url, ctx) {
  // AbortController в песочнице модулей может отсутствовать (её глобалы —
  // список в module-loader.js), поэтому таймаут ещё и гонкой промисов
  var timer = null;
  var options = { headers: { 'Accept': 'application/json' } };
  var controller = null;
  if (typeof AbortController !== 'undefined') {
    controller = new AbortController();
    options.signal = controller.signal;
  }

  var request = fetch(url, options).then(function (res) {
    // 404 — законный ответ «нет данных», не ошибка
    if (res.status === 404) return { status: 404, data: null };
    if (!res.ok) return { status: res.status, data: null };
    return res.json().then(function (data) { return { status: res.status, data: data }; });
  });

  var timeout = new Promise(function (resolve) {
    timer = setTimeout(function () {
      if (controller) { try { controller.abort(); } catch (e) { } }
      resolve({ status: 0, data: null, timedOut: true });
    }, REQUEST_TIMEOUT);
  });

  return Promise.race([request, timeout])
    .then(function (r) {
      if (timer) clearTimeout(timer);
      if (r && r.timedOut && ctx) ctx.log.warn('Таймаут запроса: ' + safeUrl(url));
      return r;
    })
    .catch(function (e) {
      if (timer) clearTimeout(timer);
      if (ctx) ctx.log.warn('Запрос не удался: ' + safeUrl(url) + ' — ' + e.message);
      return { status: 0, data: null };
    });
}

/** Ключ TMDB в логи не пишем. */
function safeUrl(url) {
  return String(url).replace(/api_key=[^&]*/, 'api_key=…');
}

// Зеркала TMDB и ключ берём из общего конфига; он же лежит на сервере, но
// модулю доступен только HTTP, а apiproxy.json открыт.
//
// 1.0.0 держала конфиг сутки и брала из него только первое зеркало. Когда в
// apiproxy.json сменили зеркала, модуль ещё сутки ходил на старое, уже не
// отвечавшее, — и запасной источник молча не работал. Теперь конфиг живёт
// полчаса и перечитывается сразу, если не ответило ни одно зеркало, а зеркала
// перебираются по порядку.
var CONFIG_TTL_MS = 30 * 60 * 1000;
var proxyMirrors = null;
var proxyMirrorsAt = 0;

function tmdbMirrors(ctx) {
  if (proxyMirrors && Date.now() - proxyMirrorsAt < CONFIG_TTL_MS) return Promise.resolve(proxyMirrors);
  return fetchJson(APIPROXY_URL, ctx).then(function (r) {
    var data = r.data || {};
    // Формат: { tmdb: [{ api, key }], tmdbApiKey } или старый { tmdbApi, tmdbApiKey }
    var commonKey = (typeof data.tmdbApiKey === 'string' && data.tmdbApiKey) ? data.tmdbApiKey : FALLBACK_TMDB_KEY;
    var list = [];
    if (Array.isArray(data.tmdb)) {
      data.tmdb.forEach(function (m) {
        if (m && typeof m.api === 'string' && m.api) list.push({ api: m.api, key: m.key || commonKey });
      });
    }
    if (typeof data.tmdbApi === 'string' && data.tmdbApi) list.push({ api: data.tmdbApi, key: commonKey });
    // Зашитое зеркало — последним: на случай, если конфиг не скачался вовсе
    list.push({ api: FALLBACK_TMDB_API, key: FALLBACK_TMDB_KEY });

    var seen = {};
    proxyMirrors = list
      .map(function (m) { return { api: String(m.api).replace(/\/+$/, ''), key: m.key }; })
      .filter(function (m) { if (seen[m.api]) return false; seen[m.api] = true; return true; });
    // Конфиг не скачался — не держим запасной список полчаса, перечитаем при следующем запросе
    proxyMirrorsAt = r.data ? Date.now() : 0;
    return proxyMirrors;
  });
}

// IMDB-идентификатор сериала: introdb работает только с ним.
// Найденный держим неделю (он не меняется), неудачу — десять минут: в 1.0.0
// неудача запоминалась до перезапуска сервера.
var IMDB_TTL_MS = 7 * 24 * 60 * 60 * 1000;
var IMDB_NEGATIVE_TTL_MS = 10 * 60 * 1000;
var imdbCache = new Map();   // tmdbId → { imdb, at }

function resolveImdbId(tmdbId, ctx) {
  var hit = imdbCache.get(tmdbId);
  if (hit && Date.now() - hit.at < (hit.imdb ? IMDB_TTL_MS : IMDB_NEGATIVE_TTL_MS)) {
    return Promise.resolve(hit.imdb);
  }

  return tmdbMirrors(ctx).then(function (mirrors) {
    var i = 0;
    var failures = [];
    var tryNext = function () {
      if (i >= mirrors.length) {
        ctx.log.warn('IMDB для TMDB ' + tmdbId + ' не получен ни с одного зеркала: ' + failures.join('; '));
        proxyMirrorsAt = 0;   // вдруг зеркала в apiproxy.json уже сменили
        return null;
      }
      var m = mirrors[i++];
      return fetchJson(m.api + '/tv/' + tmdbId + '/external_ids?api_key=' + m.key, ctx).then(function (r) {
        if (r.data && r.data.imdb_id) return String(r.data.imdb_id);
        failures.push(m.api + ' → ' + (r.status || 'нет ответа'));
        return tryNext();
      });
    };
    return Promise.resolve(tryNext()).then(function (imdb) {
      if (imdbCache.size > CACHE_MAX) imdbCache.clear();
      imdbCache.set(tmdbId, { imdb: imdb, at: Date.now() });
      return imdb;
    });
  });
}

// ==================== ПРЕОБРАЗОВАНИЕ ====================

// { start_sec, end_sec, start_ms, end_ms } → [{ start_ms, end_ms }]
function segmentToList(seg) {
  if (!seg) return [];
  var start = (seg.start_ms !== null && seg.start_ms !== undefined)
    ? seg.start_ms
    : (typeof seg.start_sec === 'number' ? Math.round(seg.start_sec * 1000) : null);
  var end = (seg.end_ms !== null && seg.end_ms !== undefined)
    ? seg.end_ms
    : (typeof seg.end_sec === 'number' ? Math.round(seg.end_sec * 1000) : null);
  if (start === null) return [];
  return [{ start_ms: start, end_ms: end }];
}

// outro у introdb — это и есть титры (credits) клиента. post_credits (сцена
// после титров) не переносим: клиент знает только intro и credits, а перемотка
// на сцену после титров — это не пропуск.

/** Отрезки одного типа из ответа theintrodb: только с началом */
function theintrodbList(data, type) {
  if (!data || !Array.isArray(data[type])) return [];
  return data[type].filter(function (seg) {
    return seg && seg.start_ms !== null && seg.start_ms !== undefined;
  });
}

/**
 * Ответ клиенту: каждый отрезок — из introdb, а чего у него нет — из tsskip.
 * Рекап introdb — заставкой, но только если заставки нет ни там, ни там.
 * null — ни у кого ничего.
 */
function mergeSources(introdb, theintrodb, tmdbId, season, episode) {
  var intro = [], credits = [], used = {};
  if (introdb) {
    intro = segmentToList(introdb.intro);
    credits = segmentToList(introdb.outro);
    if (intro.length || credits.length) used.introdb = true;
  }
  if (!intro.length) {
    intro = theintrodbList(theintrodb, 'intro');
    if (intro.length) used.theintrodb = true;
  }
  if (!credits.length) {
    credits = theintrodbList(theintrodb, 'credits');
    if (credits.length) used.theintrodb = true;
  }
  if (!intro.length && introdb) {
    intro = segmentToList(introdb.recap);
    if (intro.length) used.introdb = true;
  }
  if (!intro.length && !credits.length) return null;
  return {
    tmdb_id: Number(tmdbId),
    type: 'tv',
    season: Number(season),
    episode: Number(episode),
    intro: intro,
    credits: credits,
    source: Object.keys(used).join('+')
  };
}

/** introdb: { status, data } или { status: 0 }, если не нашёлся IMDB */
function fetchIntrodb(tmdbId, season, episode, ctx) {
  return resolveImdbId(tmdbId, ctx).then(function (imdbId) {
    if (!imdbId) return { status: 0, data: null, noImdb: true };
    var url = INTRODB_URL + '?imdb_id=' + encodeURIComponent(imdbId) +
      '&season=' + season + '&episode=' + episode;
    return fetchJson(url, ctx).then(function (r) {
      if (r.status !== 200 && r.status !== 404) {
        ctx.log.warn('introdb ответил ' + (r.status || 'нет ответа') + ' для ' + imdbId +
          ' S' + season + 'E' + episode);
      }
      return r;
    });
  });
}

module.exports = {
  name: 'skip-intro',
  version: '1.0.2',

  init: function (app, ctx) {
    ctx.log.log('Инициализация Skip Intro...');

    app.get('/api/skip/v2/media', function (req, res) {
      var tmdbId = String(req.query.tmdb_id || '').trim();
      var season = String(req.query.season || '').trim();
      var episode = String(req.query.episode || '').trim();

      if (!/^\d+$/.test(tmdbId) || !/^\d+$/.test(season) || !/^\d+$/.test(episode)) {
        return res.status(400).json({ error: 'tmdb_id, season и episode обязательны и должны быть числами' });
      }

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-cache');

      var key = tmdbId + '_' + season + '_' + episode;
      var cached = cacheGet(key);
      if (cached !== null) {
        if (cached === false) return res.status(404).json({ error: 'media not found' });
        return res.json(cached);
      }

      var tsskipUrl = 'https://' + TSSKIP_HOST + '/v2/media?tmdb_id=' + tmdbId +
        '&season=' + season + '&episode=' + episode;

      // Оба источника — сразу: ждать introdb, а потом tsskip, — это два таймаута подряд
      Promise.all([
        fetchIntrodb(tmdbId, season, episode, ctx),
        fetchJson(tsskipUrl, ctx)
      ]).then(function (results) {
        var alt = results[0], ts = results[1];
        var introdbData = alt.status === 200 ? alt.data : null;
        var tsData = ts.status === 200 ? ts.data : null;
        var merged = mergeSources(introdbData, tsData, tmdbId, season, episode);
        if (merged) {
          cacheSet(key, merged, CACHE_TTL_MS);
          return res.json(merged);
        }
        // Настоящее «данных нет» (оба ответили 404 или пусто) кэшируем на час,
        // а сбой (не нашёлся IMDB, источник ответил ошибкой) — на пару минут:
        // иначе один неудачный момент на сервере час выглядел бы как
        // отсутствие заставок у серии
        var failed = function (r) { return r.status !== 200 && r.status !== 404; };
        cacheSet(key, false, failed(alt) || failed(ts) ? FAILURE_TTL_MS : NEGATIVE_TTL_MS);
        res.status(404).json({ error: 'media not found' });
      }).catch(function (e) {
        ctx.log.error('Ошибка получения заставок:', e.message);
        if (!res.headersSent) res.status(502).json({ error: 'skip lookup failed' });
      });
    });

    app.get('/api/skip/status', function (req, res) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.json({
        module: 'skip-intro',
        version: '1.0.2',
        ok: true,
        primary: 'api.introdb.app',
        fallback: TSSKIP_HOST,
        cached: cache.size
      });
    });

    ctx.onDestroy(function () { cache.clear(); imdbCache.clear(); });

    ctx.log.log('Skip Intro зарегистрирован: /api/skip/v2/media (api.introdb.app, запасной ' + TSSKIP_HOST + ')');
    return { ready: true };
  },

  destroy: function () {
    cache.clear();
    imdbCache.clear();
  }
};
