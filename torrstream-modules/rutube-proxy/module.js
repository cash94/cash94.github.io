// Модуль: RuTube Proxy
// version: '1.6.0'
// Проксирует запросы к RuTube API и HLS-потоки, добавляя заголовки и cookie.
// Обходит CORS на Android TV: все запросы hls.js идут same-origin через сервер.
//
// Эндпоинты:
//   GET /api/rutube/proxy?url=<rutube api url>      — JSON API (поиск, play/options)
//   GET /api/rutube/hls/proxy?u=<m3u8/segment url>  — HLS плейлисты и сегменты
//   GET /api/rutube/status                          — проверка модуля

// ★ Cookie для RuTube — обновляйте при необходимости
var RUTUBE_COOKIE = 'spid=1766485521715_a77f23010cdb2d595b1554114fb6f689_lpeubwr8l73rbj7b; uuid=0cab4513-d084-416d-8089-9b792761c06e; uxs_uid=fd74f680-f2c7-11f0-9a79-41744765d973; canary1={"tags_predicto":{"active":"A","term":[{"id":44,"label":"A","percent":100},{"id":45,"label":"B","percent":100}]},"new_player":{"active":"A","term":[{"id":50,"label":"A","percent":100},{"id":51,"label":"B","percent":100}]},"ds_player":{"active":"A","term":[{"id":87,"label":"A","percent":100},{"id":88,"label":"B","percent":100}]},"current_stage_ds":{"active":"A","term":[{"id":120,"label":"A","percent":100},{"id":121,"label":"B","percent":100}]}}; _ym_uid=1776148732703051562; _ym_d=1776148732; spsc=1780471971036_1b41a6459433b1f447b9b16f43105aaa_ixPogLLQJLgcsdfdWhT4SmL3kLAYYYZ.rEh5YDrdsM8Z; csrftoken=3f0a7800e9fa4e25841271c8d831019c; session_id=56394752411768560119_1785129481972; _ym_isad=1; eg=bd9935fc; cid=56394752411768560119; ea=d26cbd9a; qrator_msid2=v2.0.1785133427.827.53efb7baWQaS0gGR|u8D0UAjJB1ZSn0PV|JQKRXAcgWlZb5s2gvzKrVWgyJtl+eLKMaCE6UHhwqjtDTpSB0tNTUwUZwwvRFWLHZSpg4/m4FdT0JSL0/CRhbA==-B1r8pT0cR1AzsGSzQeg3OmOuK3o=';

// Заголовки для JSON API
var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.110 Safari/537.36',
  'Accept': 'application/json',
  'Referer': 'https://rutube.ru/',
  'Cookie': RUTUBE_COOKIE
};

// Заголовки для HLS (плейлисты/сегменты) — Accept шире, добавлен Origin
var HLS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.110 Safari/537.36',
  'Accept': '*/*',
  'Referer': 'https://rutube.ru/',
  'Origin': 'https://rutube.ru',
  'Cookie': RUTUBE_COOKIE
};

var REQUEST_TIMEOUT = 15000;
var HLS_PROXY_PATH = '/api/rutube/hls/proxy';

// Повтор одиночного сбоя. Обрыв соединения с CDN RuTube (ECONNRESET, таймаут,
// 502–504) — обычное дело, а без повтора он сразу превращался в 500 для
// hls.js, тот переспрашивал соседние сегменты, и в лог сыпались десятки
// одинаковых «fetch failed».
var RETRIES = 1;
var RETRY_DELAY_MS = 300;
// Ошибки копим и пишем одной сводкой не чаще раза в столько
var ERROR_REPORT_MS = 30000;

// ★ Домены RuTube: основной + CDN для HLS-сегментов
var RUTUBE_DOMAINS = ['rutube.ru', 'rtbcdn.ru'];

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

// Проверка, что URL принадлежит RuTube (защита от SSRF)
function isRutubeUrl(url) {
  if (!url) return false;
  for (var i = 0; i < RUTUBE_DOMAINS.length; i++) {
    if (url.indexOf(RUTUBE_DOMAINS[i]) !== -1) return true;
  }
  return false;
}

// Оборачивает URL сегмента/плейлиста в прокси
function wrapToProxy(url) {
  return HLS_PROXY_PATH + '?u=' + encodeURIComponent(url);
}

// Резолвит URL: абсолютный возвращает как есть, относительный — относительно base
function resolveUrl(url, baseUrl) {
  if (!url) return null;
  if (url.indexOf('http') === 0) return url;   // уже абсолютный
  if (!baseUrl) return null;
  try {
    return new URL(url, baseUrl).toString();     // относительный → абсолютный
  } catch (e) {
    return null;
  }
}

// Переписывает URL внутри m3u8 (абсолютные И относительные) на прокси
function rewriteRutubePlaylist(text, baseUrl) {
  var lines = text.split('\n');
  var result = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var trimmed = line.trim();

    // Пустые строки
    if (!trimmed) { result.push(line); continue; }

    // Строка-URI сегмента или вложенного плейлиста (не комментарий #EXT...)
    if (trimmed.indexOf('#') !== 0) {
      var absoluteUrl = resolveUrl(trimmed, baseUrl);
      if (absoluteUrl && isRutubeUrl(absoluteUrl)) {
        result.push(wrapToProxy(absoluteUrl));
      } else {
        result.push(line);
      }
      continue;
    }

    // URI="..." внутри тегов (#EXT-X-KEY, субтитры, аудио)
    if (trimmed.indexOf('URI="') !== -1) {
      line = line.replace(/URI="([^"]*)"/g, function (m, url) {
        var absoluteUrl = resolveUrl(url, baseUrl);
        if (absoluteUrl && isRutubeUrl(absoluteUrl)) {
          return 'URI="' + wrapToProxy(absoluteUrl) + '"';
        }
        return m;
      });
    }

    result.push(line);
  }
  return result.join('\n');
}

// ==================== ЗАПРОСЫ К RUTUBE ====================

/**
 * Запрос с таймаутом на весь ответ — заголовки И тело.
 *
 * AbortController в песочницу модулей не передаётся (module-loader.js), и
 * прежняя проверка `typeof AbortController` всегда была ложной: таймаута не
 * было вовсе, зависший запрос висел до внутренних таймаутов undici и падал
 * безликим «fetch failed». Отменить fetch без него нельзя, поэтому таймаут —
 * гонкой: клиент получает ответ вовремя, а запоздавший результат просто
 * выбрасывается.
 *
 * @param {Function} read  что сделать с Response: r.json() / r.text() / r.arrayBuffer()
 * @returns {Promise<{status, headers, body}>}
 */
function fetchWithTimeout(url, headers, read) {
  return new Promise(function (resolve, reject) {
    var done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      var e = new Error('нет ответа за ' + (REQUEST_TIMEOUT / 1000) + ' с');
      e.code = 'TIMEOUT';
      reject(e);
    }, REQUEST_TIMEOUT);

    fetch(url, { headers: headers }).then(function (r) {
      if (!r.ok) return { status: r.status, headers: r.headers, body: null };
      return read(r).then(function (body) {
        return { status: r.status, headers: r.headers, body: body };
      });
    }).then(function (out) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(out);
    }, function (e) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(e);
    });
  });
}

/** Сбой, который есть смысл повторить: сеть, таймаут, 502–504 от RuTube */
function isTransient(result, err) {
  if (err) return true;
  return result && (result.status === 502 || result.status === 503 || result.status === 504);
}

/**
 * fetchWithTimeout с одним повтором. clientGone() — клиент уже закрыл
 * соединение (трейлер остановили, фокус ушёл): тогда не повторяем и ошибку не
 * считаем — отвечать всё равно некому.
 */
function fetchRetry(url, headers, read, clientGone, attempt) {
  attempt = attempt || 0;
  return fetchWithTimeout(url, headers, read).then(function (result) {
    if (attempt < RETRIES && isTransient(result, null) && !clientGone()) {
      return delay(RETRY_DELAY_MS).then(function () { return fetchRetry(url, headers, read, clientGone, attempt + 1); });
    }
    return result;
  }, function (e) {
    if (attempt < RETRIES && !clientGone()) {
      return delay(RETRY_DELAY_MS).then(function () { return fetchRetry(url, headers, read, clientGone, attempt + 1); });
    }
    throw e;
  });
}

function delay(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

/** Причина сбоя одним словом: у undici e.message — просто «fetch failed», суть в cause */
function errorReason(e) {
  if (!e) return 'ошибка';
  if (e.code) return e.code;
  var c = e.cause;
  if (c && (c.code || c.message)) return c.code || c.message;
  return e.message || 'ошибка';
}

function hostOf(url) {
  try { return new URL(url).host; } catch (e) { return '?'; }
}

/**
 * Сводка ошибок: вместо строки на каждый сегмент — одна строка раз в
 * ERROR_REPORT_MS: сколько, каких и с каких хостов.
 */
function createErrorReporter(log) {
  var counts = {};
  var total = 0;
  var timer = null;
  function flush() {
    timer = null;
    if (!total) return;
    var parts = [];
    for (var k in counts) if (counts.hasOwnProperty(k)) parts.push(k + ' ×' + counts[k]);
    log.warn('Сбои запросов к RuTube за ' + (ERROR_REPORT_MS / 1000) + ' с: ' + total + ' (' + parts.join(', ') + ')');
    counts = {};
    total = 0;
  }
  return {
    add: function (kind, url, reason) {
      var key = kind + ' ' + hostOf(url) + ': ' + reason;
      counts[key] = (counts[key] || 0) + 1;
      total++;
      if (!timer) timer = setTimeout(flush, ERROR_REPORT_MS);
    },
    stop: function () {
      if (timer) clearTimeout(timer);
      flush();
    }
  };
}

/** Клиент закрыл соединение раньше ответа */
function watchClient(req, res) {
  var gone = false;
  req.on('close', function () { if (!res.writableEnded) gone = true; });
  return function () { return gone || res.destroyed; };
}

// ==================== МОДУЛЬ ====================

var reporter = null;

module.exports = {
  name: 'rutube-proxy',
  version: '1.6.0',

  init: function (app, ctx) {
    ctx.log.log('Инициализация RuTube proxy...');
    reporter = createErrorReporter(ctx.log);

    // ---------- 1. JSON API прокси ----------
    app.get('/api/rutube/proxy', function (req, res) {
      var targetUrl = req.query.url;

      if (!isRutubeUrl(targetUrl)) {
        return res.status(400).json({ error: 'Invalid URL' });
      }
      if (targetUrl.indexOf('https://') !== 0) {
        return res.status(400).json({ error: 'Only HTTPS allowed' });
      }

      var clientGone = watchClient(req, res);
      fetchRetry(targetUrl, HEADERS, function (r) { return r.json(); }, clientGone)
        .then(function (result) {
          if (clientGone()) return;
          if (!result.body) {
            reporter.add('API', targetUrl, 'HTTP ' + result.status);
            return res.status(result.status).json({ error: 'Upstream error: ' + result.status });
          }
          res.json(result.body);
        })
        .catch(function (e) {
          if (clientGone()) return;
          var reason = errorReason(e);
          reporter.add('API', targetUrl, reason);
          if (!res.headersSent) res.status(reason === 'TIMEOUT' ? 504 : 502).json({ error: reason });
        });
    });

    // ---------- 2. HLS прокси (обход CORS для трейлеров) ----------
    app.get(HLS_PROXY_PATH, function (req, res) {
      var targetUrl = req.query.u;

      if (!isRutubeUrl(targetUrl)) {
        return res.status(400).send('Invalid URL');
      }

      var isPlaylist = targetUrl.indexOf('.m3u8') !== -1;
      var clientGone = watchClient(req, res);

      fetchRetry(targetUrl, HLS_HEADERS, function (r) {
        // Тип определяем по заголовку, если в URL нет .m3u8
        var ct = r.headers.get('content-type') || '';
        if (ct.indexOf('mpegurl') !== -1) isPlaylist = true;
        return isPlaylist ? r.text() : r.arrayBuffer();
      }, clientGone)
        .then(function (result) {
          if (clientGone()) return;
          if (!result.body) {
            reporter.add('HLS', targetUrl, 'HTTP ' + result.status);
            return res.status(result.status).send('Upstream error: ' + result.status);
          }

          // CORS для клиента + запрет кэширования
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

          if (isPlaylist) {
            // ★ targetUrl — база для резолва относительных путей сегментов
            var rewritten = rewriteRutubePlaylist(result.body, targetUrl);
            var leftover = rewritten.match(/https?:\/\/[^\s"']*(rutube\.ru|rtbcdn\.ru)[^\s"']*/g) || [];
            if (leftover.length) ctx.log.warn('⚠️ Непереписанные URL:\n' + leftover.join('\n'));
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.send(rewritten);
          } else {
            // Сегмент (.mp4/.ts): отдаём бинарно
            res.setHeader('Content-Type', result.headers.get('content-type') || 'video/mp4');
            res.send(Buffer.from(result.body));
          }
        })
        .catch(function (e) {
          if (clientGone()) return;
          var reason = errorReason(e);
          reporter.add('HLS', targetUrl, reason);
          if (!res.headersSent) res.status(reason === 'TIMEOUT' ? 504 : 502).send(reason);
        });
    });

    // ---------- 3. Проверка работоспособности ----------
    app.get('/api/rutube/status', function (req, res) {
      res.json({ module: 'rutube-proxy', version: '1.6.0', ok: true });
    });

    ctx.log.log('RuTube proxy зарегистрирован: /api/rutube/proxy, ' + HLS_PROXY_PATH);
    return { ready: true };
  },

  destroy: function () {
    if (reporter) reporter.stop();
    reporter = null;
    console.log('[rutube-proxy] Уничтожение...');
  }
};
