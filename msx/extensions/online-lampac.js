/*
 * «Онлайн (Lampac)» — фильмы и сериалы онлайн с серверов Lampac через их API
 * «lite», как онлайн-плагины Lampa. ТОЛЬКО ДЛЯ ЛОКАЛЬНЫХ ТЕСТОВ: в каталог не
 * входит, ставится по ссылке.
 *
 * Цепочка (как в online.js Lampa):
 *   externalids?id=…        → imdb_id / kinopoisk_id
 *   lite/events?…&life=true → список источников или {life, memkey} →
 *   lifeevents?memkey=…     → список источников (собирается в фоне)
 *   <ссылка источника>      → HTML: .videos__button (озвучки) и .videos__item
 *                             с data-json {method: link | play | call, url}
 *   call                    → JSON {method: 'play', url, quality, subtitles}
 *   play                    → TS.player.play (серии папки — плейлистом)
 *
 * В приложении — источник онлайна (TS.online.register): кнопку «Онлайн» в
 * карточке рисует приложение, а нажатие приходит событием 'online'.
 *
 * Не поддерживаются: источники с rch (сервер просит само устройство качать
 * страницы по WebSocket) и с iframe (свой веб-плеер источника).
 */
TS.register({
  name: 'Онлайн (Lampac)',
  version: '0.2',
  description: 'Фильмы и сериалы онлайн с серверов Lampac (z01, l-vid). Для тестов.',
  settings: true
});

var SERVERS = [
  { id: 'z01', name: 'z01.online', host: 'https://z01.online/', note: 'без входа' },
  { id: 'lvid', name: 'l-vid.online', host: 'https://beta.l-vid.online/', note: 'вход через Telegram' }
];

var item = null;          // карточка, для которой открыто окно
var stack = [];           // экраны окна для «← Назад»: { kind, url?, title }
var reqSeq = 0;           // ответ на устаревший запрос не рисуем
var authTimer = null;

// ---------- хранилище ----------

function server() {
  var id = TS.storage.get('server', 'z01');
  for (var i = 0; i < SERVERS.length; i++) if (SERVERS[i].id === id) return SERVERS[i];
  return SERVERS[0];
}

function uid() {
  var u = TS.storage.get('uid', '');
  if (!u) {
    u = '';
    var a = new Uint8Array(6);
    try { crypto.getRandomValues(a); for (var i = 0; i < a.length; i++) u += ('0' + a[i].toString(16)).slice(-2); } catch (e) { }
    if (u.length < 12) u = (Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 12);
    TS.storage.set('uid', u);
  }
  return u;
}

function token() { return (TS.storage.get('tokens', {}) || {})[server().id] || ''; }

function setToken(t) {
  var all = TS.storage.get('tokens', {}) || {};
  if (t) all[server().id] = t; else delete all[server().id];
  TS.storage.set('tokens', all);
}

// ---------- запросы ----------

function addParam(url, kv) { return url + (url.indexOf('?') >= 0 ? '&' : '?') + kv; }

/** uid и токен — к каждому запросу, как account() в online.js */
function account(url) {
  if (url.indexOf('uid=') < 0) url = addParam(url, 'uid=' + encodeURIComponent(uid()));
  var t = token();
  if (t && url.indexOf('token=') < 0) url = addParam(url, 'token=' + encodeURIComponent(t));
  return url;
}

function movieParams(url) {
  var q = [];
  q.push('id=' + encodeURIComponent(item.tmdbId));
  q.push('tmdb_id=' + encodeURIComponent(item.tmdbId));
  if (item.imdb_id) q.push('imdb_id=' + encodeURIComponent(item.imdb_id));
  if (item.kinopoisk_id) q.push('kinopoisk_id=' + encodeURIComponent(item.kinopoisk_id));
  q.push('title=' + encodeURIComponent(item.title || ''));
  q.push('original_title=' + encodeURIComponent(item.originalTitle || item.title || ''));
  q.push('serial=' + (item.type === 'tv' ? 1 : 0));
  q.push('original_language=');
  q.push('year=' + (item.year || '0000'));
  q.push('source=tmdb');
  q.push('clarification=0');
  q.push('similar=false');
  q.push('rchtype=');
  return url + (url.indexOf('?') >= 0 ? '&' : '?') + q.join('&');
}

function get(url, asText) {
  return TS.fetch(account(url)).then(function (r) {
    if (!r.ok) {
      // Lampac кладёт причину в тело ({"msg": …} или текст) — покажем её
      return r.text().then(function (t) {
        var m = '';
        try { var j = JSON.parse(t); m = j.msg || j.message || j.error || ''; } catch (e) { m = String(t || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160); }
        throw new Error('Источник недоступен (' + r.status + ')' + (m ? ': ' + m : ''));
      });
    }
    return r.text();
  }).then(function (text) {
    if (asText) return text;
    try { return JSON.parse(text); } catch (e) { return text; }
  });
}

// ---------- окно ----------

var CSS = '<style>' +
  'body{padding:20px 28px}' +
  'h2{margin:0 0 4px;font-size:24px}' +
  '.sub{color:#8b98ab;font-size:15px;margin-bottom:16px}' +
  '.row{display:flex;flex-wrap:wrap;margin:0 0 12px}' +
  '.row button{margin:0 10px 10px 0}' +
  '.list button{display:block;width:100%;text-align:left;margin:0 0 8px}' +
  'button.on{box-shadow:inset 0 -3px 0 var(--focus-color,#ff8c00)}' +
  'button.dim{opacity:.55}' +
  'button small{display:block;font-size:13px;opacity:.7;margin-top:2px}' +
  '.msg{color:#cfd4dc;margin:16px 0;line-height:1.5}' +
  '.err{color:#ff8a80}' +
  '.qr{background:#fff;padding:10px;border-radius:12px;width:200px;height:200px;margin:12px 0}' +
  '.code{font-size:28px;font-weight:700;letter-spacing:.08em}' +
  '</style>';

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Окно: заголовок, «← Назад», содержимое; фокус — на первый пункт содержимого */
function show(html, focusSel) {
  var head = '<h2>' + esc(item ? item.title : 'Онлайн') + (item && item.year ? ' (' + item.year + ')' : '') + '</h2>' +
    '<div class="sub">' + esc(server().name) + (stack.length > 1 ? ' · ' + esc(stack[stack.length - 1].title || '') : '') + '</div>' +
    '<div class="row">' + (stack.length > 1 ? '<button data-act="back">← Назад</button>' : '') +
    '<button data-act="servers">Сервер: ' + esc(server().name) + '</button></div>';
  document.body.innerHTML = CSS + head + html;
  bind();
  var f = (focusSel && document.querySelector(focusSel)) || document.querySelector('[data-go], [data-play], [data-src]') || document.querySelector('button');
  if (f) TS.panel.focus(f);
}

function loading(text) { show('<p class="msg">' + esc(text || 'Загрузка…') + '</p>'); }

function error(text) { show('<p class="msg err">' + esc(text) + '</p><div class="row"><button data-act="retry">Повторить</button></div>'); }

var handlers = {};
function bind() {
  Array.prototype.forEach.call(document.querySelectorAll('button'), function (b) {
    b.onclick = function () {
      var act = b.getAttribute('data-act');
      if (act === 'back') { stack.pop(); render(stack.pop()); return; }
      if (act === 'retry') { render(stack.pop()); return; }
      if (act === 'servers') { showServers(); return; }
      if (act === 'server') {
        TS.storage.set('server', b.getAttribute('data-id'));
        // Из карточки — сразу источники нового сервера; из настроек — список серверов
        if (item) { stack = []; render(); } else { stack = []; showServers(); }
        return;
      }
      if (act === 'logout') { setToken(''); TS.toast('Вход сброшен'); showServers(); return; }
      if (b.hasAttribute('data-src')) { var s = handlers.sources[+b.getAttribute('data-src')]; render({ kind: 'page', url: s.url, title: s.name, src: s.balanser }); return; }
      if (b.hasAttribute('data-go')) { var g = handlers.links[+b.getAttribute('data-go')]; render({ kind: 'page', url: g.url, title: g.text, src: (stack[stack.length - 1] || {}).src }); return; }
      if (b.hasAttribute('data-play')) { playItem(handlers.videos[+b.getAttribute('data-play')]); return; }
    };
  });
}

// ---------- экраны ----------

function render(view) {
  if (!view) view = { kind: 'sources', title: 'Источники' };
  stack.push(view);
  if (view.kind === 'sources') return loadSources();
  if (view.kind === 'page') return loadPage(view);
}

function open() {
  if (!item) return;
  stack = [];
  TS.panel.open('онлайн');
  render();
}

function loadSources() {
  var my = ++reqSeq;
  loading('Ищу источники…');
  var host = server().host;
  var ready = item.imdb_id && item.kinopoisk_id ? Promise.resolve() :
    get(host + 'externalids?id=' + encodeURIComponent(item.tmdbId) + '&serial=' + (item.type === 'tv' ? 1 : 0)).then(function (j) {
      if (j && typeof j === 'object' && !j.accsdb) { if (j.imdb_id && !item.imdb_id) item.imdb_id = j.imdb_id; if (j.kinopoisk_id && !item.kinopoisk_id) item.kinopoisk_id = j.kinopoisk_id; }
    })['catch'](function () { });
  ready.then(function () {
    return get(movieParams(host + 'lite/events?life=true'));
  }).then(function (j) {
    if (my !== reqSeq) return;
    if (j && j.accsdb) return showAuth(j);
    if (j && j.life) return pollLife(j.memkey, my, 0);
    drawSources(sourcesOf(j), true);
  })['catch'](function (e) { if (my === reqSeq) error(e.message || 'Нет связи с сервером'); });
}

function sourcesOf(j) {
  var list = (j && (j.online || j)) || [];
  return Array.isArray(list) ? list.filter(function (s) { return s && s.url && s.name; }) : [];
}

/** lifeevents: источники собираются на сервере, забираем по готовности */
function pollLife(memkey, my, n) {
  get(movieParams(server().host + 'lifeevents?memkey=' + encodeURIComponent(memkey || ''))).then(function (j) {
    if (my !== reqSeq) return;
    if (j && j.accsdb) return showAuth(j);
    var list = sourcesOf(j);
    var done = (j && j.ready) || n >= 12;
    drawSources(list, done);
    if (!done) setTimeout(function () { if (my === reqSeq) pollLife(memkey, my, n + 1); }, 1500);
  })['catch'](function (e) { if (my === reqSeq) error(e.message || 'Нет связи с сервером'); });
}

function drawSources(list, done) {
  // Окно перерисовываем, только пока человек стоит на списке источников
  if (stack[stack.length - 1].kind !== 'sources') return;
  handlers.sources = list;
  var last = TS.storage.get('src:' + item.tmdbId, '');
  var html = '<div class="list">';
  list.forEach(function (s, i) {
    html += '<button data-src="' + i + '" class="' + (s.show === false ? 'dim ' : '') + (s.balanser === last ? 'on' : '') + '">' +
      esc(s.name) + '</button>';
  });
  html += '</div>';
  if (!list.length) html = '<p class="msg">' + (done ? 'Ничего не нашлось.' : 'Ищу источники…') + '</p>';
  else if (!done) html = '<p class="msg">Ищу ещё…</p>' + html;
  var focusedSrc = document.querySelector('.focused[data-src]');
  show(html, focusedSrc ? '[data-src="' + focusedSrc.getAttribute('data-src') + '"]' : (last ? 'button.on' : null));
}

/** HTML источника → кнопки (озвучки), папки (сезоны), видео */
function parsePage(text) {
  var doc = new DOMParser().parseFromString('<div>' + text + '</div>', 'text/html');
  function grab(sel) {
    var out = [];
    Array.prototype.forEach.call(doc.querySelectorAll(sel), function (el) {
      var data;
      try { data = JSON.parse(el.getAttribute('data-json')); } catch (e) { return; }
      var t = el.querySelector('.videos__item-title, .videos__season-title');
      data.text = ((t || el).textContent || '').replace(/\s+/g, ' ').trim();
      if (el.getAttribute('s')) data.season = +el.getAttribute('s');
      if (el.getAttribute('e')) data.episode = +el.getAttribute('e');
      data.active = el.classList.contains('active');
      out.push(data);
    });
    return out;
  }
  return { buttons: grab('.videos__button'), items: grab('.videos__item') };
}

function loadPage(view) {
  var my = ++reqSeq;
  loading('Загрузка…');
  if (view.src) TS.storage.set('src:' + item.tmdbId, view.src);
  var url = view.url.indexOf('id=') >= 0 || view.url.indexOf('kinopoisk_id=') >= 0 ? view.url : movieParams(view.url);
  get(url, true).then(function (text) {
    if (my !== reqSeq) return;
    var j = null;
    try { j = JSON.parse(text); } catch (e) { }
    if (j && j.accsdb) return showAuth(j);
    if (j && j.rch) return error('Этот источник требует rch (устройство само качает страницы) — пока не поддерживается. Выберите другой.');
    if (j && j.method === 'play') return drawPage({ buttons: [], items: [j] });
    var page = parsePage(text);
    // Единственная папка — сразу в неё, как online.js
    if (!page.buttons.length && page.items.length === 1 && page.items[0].method === 'link') {
      stack.pop();
      return render({ kind: 'page', url: page.items[0].url, title: page.items[0].text || view.title, src: view.src });
    }
    drawPage(page);
  })['catch'](function (e) { if (my === reqSeq) error(e.message || 'Источник не ответил'); });
}

function drawPage(page) {
  handlers.links = [];
  handlers.videos = [];
  var html = '';
  if (page.buttons.length) {
    html += '<div class="row">';
    page.buttons.forEach(function (b) {
      handlers.links.push(b);
      html += '<button data-go="' + (handlers.links.length - 1) + '" class="' + (b.active ? 'on' : '') + '">' + esc(b.text) + '</button>';
    });
    html += '</div>';
  }
  var folders = page.items.filter(function (i) { return i.method === 'link'; });
  var videos = page.items.filter(function (i) { return i.method !== 'link'; });
  if (folders.length) {
    html += '<div class="row">';
    folders.forEach(function (f) {
      handlers.links.push(f);
      html += '<button data-go="' + (handlers.links.length - 1) + '" class="' + (f.active ? 'on' : '') + '">' + esc(f.text) + '</button>';
    });
    html += '</div>';
  }
  if (videos.length) {
    html += '<div class="list">';
    videos.forEach(function (v) {
      handlers.videos.push(v);
      var note = [v.translate, v.maxquality, v.details].filter(Boolean).join(' · ');
      html += '<button data-play="' + (handlers.videos.length - 1) + '">' + esc(v.text || v.title || 'Видео') +
        (note && note !== v.text ? '<small>' + esc(note) + '</small>' : '') + '</button>';
    });
    html += '</div>';
  }
  if (!html) html = '<p class="msg">Здесь пусто.</p>';
  var first = document.querySelector('[data-play]');
  show(html, videos.length ? '[data-play]' : null);
}

// ---------- воспроизведение ----------

function titleFor(v) {
  var t = item.title;
  if (v.season || v.episode) t += ' · ' + (v.season ? 'S' + v.season : '') + (v.episode ? 'E' + v.episode : '');
  else if (v.text && v.text !== item.title) t += ' · ' + v.text;
  return t;
}

function subsOf(v) {
  return (v.subtitles || []).map(function (s) { return { label: s.label || s.lang || 'Субтитры', url: s.url, language: s.lang || '' }; })
    .filter(function (s) { return s.url; });
}

/** Готовые ссылки (play) соседних серий — плейлистом: плеер сам переключит дальше */
function playlistFor(v, url, extra) {
  var list = [], index = 0;
  (handlers.videos || []).forEach(function (o) {
    if (o.method !== 'play' || !o.url) return;
    if (o === v) index = list.length;
    var cur = o === v ? (extra || v) : o;
    list.push({ url: o === v ? url : o.url, quality: cur.quality, title: titleFor(o), season: o.season, episode: o.episode, subtitles: subsOf(cur) });
  });
  return list.length > 1 ? { playlist: list, index: index } : null;
}

function playUrl(v, url, extra) {
  var opts = { url: url, title: titleFor(v), poster: item.poster, subtitles: subsOf(extra || v) };
  if (extra && extra.quality) opts.quality = extra.quality;
  var pl = playlistFor(v, url, extra);
  if (pl) { opts.playlist = pl.playlist; opts.index = pl.index; }
  TS.player.play(opts)['catch'](function (e) {
    error('Не удалось включить: ' + (e.message || e));
  });
}

function playItem(v) {
  if (v.method === 'play' && v.url) return playUrl(v, v.url);
  if (v.method === 'iframe') return error('Источник показывает видео в своём веб-плеере (iframe) — пока не поддерживается.');
  if (!v.url) return error('У этого пункта нет ссылки.');
  loading('Получаю ссылку…');
  var my = ++reqSeq;
  get(v.url).then(function (j) {
    if (my !== reqSeq) return;
    if (j && j.accsdb) return showAuth(j);
    if (j && j.rch) return error('Источник требует rch — пока не поддерживается.');
    if (j && j.method === 'iframe') return error('Источник показывает видео в своём веб-плеере (iframe) — пока не поддерживается.');
    if (j && j.url) return playUrl(v, j.url, j);
    error('Источник не дал ссылку на видео.');
  })['catch'](function (e) { if (my === reqSeq) error(e.message || 'Источник не ответил'); });
}

// ---------- вход (l-vid: Telegram-бот) ----------

function showAuth(j) {
  if (authTimer) { clearTimeout(authTimer); authTimer = null; }
  var html = '<p class="msg">' + esc(j.msg || 'Нужен вход.') + '</p>';
  if (j.qr && /^data:image\//.test(j.qr)) html += '<img class="qr" src="' + esc(j.qr) + '" alt="QR">';
  if (j.code) html += '<div class="code">' + esc(j.code) + '</div>';
  html += '<p class="msg">Как только бот подтвердит вход, список откроется сам.</p><div class="row"><button data-act="retry">Проверить сейчас</button></div>';
  show(html);
  var tries = 0;
  (function poll() {
    authTimer = setTimeout(function () {
      if (++tries > 100) return;
      TS.fetch(server().host + 'tg/auth/status?uid=' + encodeURIComponent(uid())).then(function (r) { return r.json(); }).then(function (s) {
        if (s && s.authorized && s.token) {
          setToken(s.token);
          TS.toast('Вход выполнен');
          stack = [];
          render();
          return;
        }
        poll();
      })['catch'](poll);
    }, 3000);
  })();
}

function showServers() {
  if (authTimer) { clearTimeout(authTimer); authTimer = null; }
  var cur = server().id;
  var html = '<div class="list">';
  SERVERS.forEach(function (s) {
    var signed = ((TS.storage.get('tokens', {}) || {})[s.id]) ? ' · вход выполнен' : '';
    html += '<button data-act="server" data-id="' + s.id + '" class="' + (s.id === cur ? 'on' : '') + '">' + esc(s.name) +
      '<small>' + esc(s.note + signed) + '</small></button>';
  });
  html += '</div>';
  if (token()) html += '<div class="row"><button data-act="logout">Выйти на ' + esc(server().name) + '</button></div>';
  stack.push({ kind: 'servers', title: 'Сервер' });
  show(html, 'button.on');
}

// ---------- события ----------

TS.online.register({ name: 'Lampac (z01, l-vid)' });

// Кнопку «Онлайн» рисует приложение — сюда приходит её нажатие (или выбор
// этого источника, если их несколько). IMDb и Кинопоиск — из карточки, если
// приложение их знает; нет — externalids спросит сервер Lampac
TS.on('online', function (e) {
  var it = e.item;
  item = { tmdbId: it.tmdbId, type: it.type, title: it.title, originalTitle: it.originalTitle, year: it.year,
    poster: it.poster, imdb_id: it.imdbId || '', kinopoisk_id: it.kinopoiskId || '' };
  open();
});

TS.on('settings', function () {
  stack = [];
  TS.panel.open('сервер');
  showServers();
});

TS.on('panel', function (e) {
  if (!e.open) { reqSeq++; if (authTimer) { clearTimeout(authTimer); authTimer = null; } }
});
