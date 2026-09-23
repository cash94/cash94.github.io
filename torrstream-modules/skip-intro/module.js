// Модуль: Skip Intro
// version: '1.0.0'
// Данные о заставках и титрах с запасным источником.
//
// Основной источник — tsskip.torrstream.online (зеркало api.theintrodb.org),
// он отвечает по tmdb_id. Когда данных там нет (404), модуль спрашивает
// api.introdb.app: тот знает только IMDB, поэтому id переводится через TMDB,
// а ответ приводится к формату theintrodb — клиент (player.js, fetchSkipData)
// и встроенный плеер Android разбирают именно его.
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

var PRIMARY_HOST = 'tsskip.torrstream.online';
var INTRODB_URL = 'https://api.introdb.app/segments';
var APIPROXY_URL = 'https://cash94.github.io/apiproxy.json';

var REQUEST_TIMEOUT = 8000;
// Найденное держим сутки, «ничего нет» — час: у introdb сегменты добавляют
// пользователи, и вчерашнее «нет» завтра может стать «есть»
var CACHE_TTL_MS = 24 * 60 * 60 * 1000;
var NEGATIVE_TTL_MS = 60 * 60 * 1000;
var CACHE_MAX = 500;

// Запасные значения: те же, что зашиты в сервере (services/api-proxy.js)
var FALLBACK_TMDB_API = 'http://tsapi.hnar.online';
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

// Зеркало TMDB и ключ берём из общего конфига; он же лежит на сервере, но
// модулю доступен только HTTP, а apiproxy.json открыт
var proxyConf = null;
var proxyConfAt = 0;

function tmdbConfig(ctx) {
  if (proxyConf && Date.now() - proxyConfAt < CACHE_TTL_MS) return Promise.resolve(proxyConf);
  return fetchJson(APIPROXY_URL, ctx).then(function (r) {
    var conf = { api: FALLBACK_TMDB_API, key: FALLBACK_TMDB_KEY };
    var data = r.data;
    if (data) {
      // Формат: либо { tmdbApi, tmdbApiKey }, либо { tmdb: [{ api, key }] }
      if (typeof data.tmdbApi === 'string' && data.tmdbApi) conf.api = data.tmdbApi;
      if (typeof data.tmdbApiKey === 'string' && data.tmdbApiKey) conf.key = data.tmdbApiKey;
      if (Array.isArray(data.tmdb) && data.tmdb.length) {
        var first = data.tmdb[0];
        if (first && first.api) conf.api = first.api;
        if (first && first.key) conf.key = first.key;
      }
    }
    conf.api = String(conf.api).replace(/\/+$/, '');
    proxyConf = conf;
    proxyConfAt = Date.now();
    return conf;
  });
}

// IMDB-идентификатор сериала: introdb работает только с ним
var imdbCache = new Map();

function resolveImdbId(tmdbId, ctx) {
  var cached = imdbCache.get(tmdbId);
  if (cached !== undefined) return Promise.resolve(cached);
  return tmdbConfig(ctx).then(function (conf) {
    var url = conf.api + '/tv/' + tmdbId + '/external_ids?api_key=' + conf.key;
    return fetchJson(url, ctx).then(function (r) {
      var imdb = (r.data && r.data.imdb_id) ? String(r.data.imdb_id) : null;
      if (imdbCache.size > CACHE_MAX) imdbCache.clear();
      imdbCache.set(tmdbId, imdb);
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

/**
 * Ответ introdb → формат theintrodb.
 *
 * outro у introdb — это и есть титры (credits) клиента. post_credits
 * (сцена после титров) не переносим: клиент знает только intro и credits,
 * а перемотка на сцену после титров — это не пропуск.
 */
function convertIntrodb(data, tmdbId, season, episode) {
  var intro = segmentToList(data.intro);
  var credits = segmentToList(data.outro);
  // Рекап показываем как заставку: для зрителя это тот же пропуск в начале
  if (!intro.length) intro = segmentToList(data.recap);
  if (!intro.length && !credits.length) return null;
  return {
    tmdb_id: Number(tmdbId),
    type: 'tv',
    season: Number(season),
    episode: Number(episode),
    intro: intro,
    credits: credits,
    source: 'introdb'
  };
}

function hasSegments(data) {
  if (!data) return false;
  var intro = Array.isArray(data.intro) ? data.intro.length : 0;
  var credits = Array.isArray(data.credits) ? data.credits.length : 0;
  return intro + credits > 0;
}

module.exports = {
  name: 'skip-intro',
  version: '1.0.0',

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

      var primary = 'https://' + PRIMARY_HOST + '/v2/media?tmdb_id=' + tmdbId +
        '&season=' + season + '&episode=' + episode;

      var notFound = function () {
        cacheSet(key, false, NEGATIVE_TTL_MS);
        res.status(404).json({ error: 'media not found' });
      };

      fetchJson(primary, ctx).then(function (r) {
        if (r.status === 200 && hasSegments(r.data)) {
          r.data.source = 'theintrodb';
          cacheSet(key, r.data, CACHE_TTL_MS);
          return res.json(r.data);
        }
        // Ни данных, ни ответа основного источника — пробуем запасной
        return resolveImdbId(tmdbId, ctx).then(function (imdbId) {
          if (!imdbId) {
            ctx.log.log('IMDB для TMDB ' + tmdbId + ' не найден — запасной источник пропущен');
            return notFound();
          }
          var url = INTRODB_URL + '?imdb_id=' + encodeURIComponent(imdbId) +
            '&season=' + season + '&episode=' + episode;
          return fetchJson(url, ctx).then(function (alt) {
            if (alt.status !== 200 || !alt.data) return notFound();
            var converted = convertIntrodb(alt.data, tmdbId, season, episode);
            if (!converted) return notFound();
            ctx.log.log('Заставки из introdb: ' + imdbId + ' S' + season + 'E' + episode +
              ' (intro ' + converted.intro.length + ', credits ' + converted.credits.length + ')');
            cacheSet(key, converted, CACHE_TTL_MS);
            res.json(converted);
          });
        });
      }).catch(function (e) {
        ctx.log.error('Ошибка получения заставок:', e.message);
        if (!res.headersSent) res.status(502).json({ error: 'skip lookup failed' });
      });
    });

    app.get('/api/skip/status', function (req, res) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.json({
        module: 'skip-intro',
        version: '1.0.0',
        ok: true,
        primary: PRIMARY_HOST,
        fallback: 'api.introdb.app',
        cached: cache.size
      });
    });

    ctx.onDestroy(function () { cache.clear(); imdbCache.clear(); });

    ctx.log.log('Skip Intro зарегистрирован: /api/skip/v2/media (запасной источник api.introdb.app)');
    return { ready: true };
  },

  destroy: function () {
    cache.clear();
    imdbCache.clear();
  }
};
