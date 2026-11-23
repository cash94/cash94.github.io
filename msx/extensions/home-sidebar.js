/*
 * Боковое меню главной — пример расширения на мосту к DOM (TS.dom / TS.keys /
 * TS.app). Открывается «влево», когда левее идти некуда (первая карточка
 * ряда, первый пункт шапки): событие nav с moved: false. В меню — подборки
 * (с общей приставкой «Кинопоиск · …» — группой), плитки категорий и разделы
 * шапки. Вверх/вниз — выбор, ОК — перейти, вправо или «Назад» — закрыть.
 * Заодно «★ 7.5» в углу постеров рядов.
 */
TS.register({
  name: 'Боковое меню главной',
  version: '1.0',
  description: '«Влево» с края главной — меню всех подборок, категорий и разделов. Оценки на постерах.'
});

TS.ui.addStyle([
  '#ext-sb{position:fixed;left:0;top:0;bottom:0;width:30vw;min-width:280px;max-width:520px;z-index:9000;',
  ' background:rgba(14,17,22,.97);box-shadow:8px 0 40px rgba(0,0,0,.6);overflow:hidden;',
  ' font-size:calc(14px + .45vw);color:#e8edf4;transform:translateX(-102%);transition:transform .18s}',
  '#ext-sb.open{transform:none}',
  '#ext-sb .sb-list{position:absolute;left:0;right:0;top:0;bottom:3.2em;overflow:hidden;padding:1.2em 0}',
  '#ext-sb .sb-group{padding:.9em 1.4em .3em;font-size:.72em;letter-spacing:.06em;text-transform:uppercase;color:#8b98ab}',
  '#ext-sb .sb-item{display:flex;align-items:center;padding:.5em 1.4em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '#ext-sb .sb-item.in-group{padding-left:2.2em}',
  '#ext-sb .sb-item i{margin-right:.6em;opacity:.8}',
  '#ext-sb .sb-item.cur{color:var(--focus-color,#ff8c00)}',
  '#ext-sb .sb-item.sel{background:#fff;color:#000;border-radius:0 .5em .5em 0}',
  '#ext-sb .sb-hint{position:absolute;left:0;right:0;bottom:0;padding:.9em 1.4em;font-size:.7em;color:#8b98ab;',
  ' border-top:1px solid rgba(255,255,255,.08)}',
  '.ext-rate{position:absolute;right:.4em;top:.4em;z-index:3;padding:.15em .45em;border-radius:.4em;',
  ' background:rgba(0,0,0,.72);color:#fff;font-size:.8em;font-weight:700;line-height:1.3}',
  '.ext-rate b{color:#f5c518;margin-right:.2em}'
].join('\n'));

var menu = null;        // { root, list, items, sel }
var opening = false;

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function splitName(name) {
  var m = /^(.+?)\s*(?:·|:|—|\|)\s*(.+)$/.exec(name);
  return m ? { prefix: m[1], rest: m[2].charAt(0).toUpperCase() + m[2].slice(1) } : null;
}

/** Пункты меню: подборки (группы по приставке), плитки категорий, шапка */
function buildItems(home, navBtns) {
  var out = [];
  home.rows.forEach(function (row) {
    if (!row.cards.length) return;
    if (row.cards[0].tile) {
      out.push({ group: row.title || 'Категории' });
      row.cards.forEach(function (c) {
        out.push({ name: c.title, h: c.h, click: true, inGroup: true, icon: 'fi fi-rr-apps', split: splitName(c.title) });
      });
      return;
    }
    var card = row.cards[Math.min(row.col, row.cards.length - 1)];
    out.push({ name: row.title, h: card.h, cur: row.index === home.activeRow, split: splitName(row.title) });
  });
  // Подряд идущие с общей приставкой — группой (и внутри «Категорий» тоже)
  for (var i = 0; i < out.length; i++) {
    var cur = out[i].split;
    if (!cur) continue;
    var prev = i > 0 && out[i - 1].split, next = out[i + 1] && out[i + 1].split;
    var samePrev = prev && prev.prefix === cur.prefix, sameNext = next && next.prefix === cur.prefix;
    if (!samePrev && !sameNext) continue;
    if (!samePrev) { out.splice(i, 0, { group: cur.prefix }); i++; }
    out[i].name = cur.rest;
    out[i].inGroup = true;
    out[i].split = cur;   // сосед сверяется по приставке, а имя уже хвост
  }
  if (navBtns.length) {
    out.push({ group: 'Разделы' });
    navBtns.forEach(function (b) {
      if (b.text) out.push({ name: b.text, h: b.h, click: true, inGroup: true, icon: 'fi fi-rr-angle-small-right' });
    });
  }
  return out;
}

function render() {
  var html = '';
  menu.items.forEach(function (it, i) {
    if (it.group) { html += '<div class="sb-group">' + esc(it.group) + '</div>'; return; }
    html += '<div class="sb-item' + (it.inGroup ? ' in-group' : '') + (it.cur ? ' cur' : '') +
      (i === menu.sel ? ' sel' : '') + '" data-i="' + i + '">' +
      (it.icon ? '<i class="' + esc(it.icon) + '"></i>' : '') + esc(it.name) + '</div>';
  });
  // Выбранный пункт держим в середине списка: прокрутки у ТВ нет — сдвигаем отступом
  var before = menu.items.slice(0, menu.sel).length;
  var shift = Math.max(0, before - 6);
  TS.dom.update(menu.list, { html: '<div style="margin-top:' + (-shift * 2.1) + 'em">' + html + '</div>' });
}

function move(step) {
  var i = menu.sel;
  do { i += step; } while (menu.items[i] && menu.items[i].group);
  if (!menu.items[i]) return;
  menu.sel = i;
  render();
}

function open() {
  if (menu || opening) return;
  opening = true;
  Promise.all([TS.app.home(), TS.dom.query('#home-topbar .home-nav-btn')]).then(function (r) {
    var home = r[0], nav = r[1];
    if (!home.ready) { opening = false; return; }
    var items = buildItems(home, nav);
    var sel = 0;
    items.forEach(function (it, i) { if (it.cur) sel = i; });
    while (items[sel] && items[sel].group) sel++;
    return TS.dom.create(
      '<aside id="ext-sb"><div class="sb-list"></div>' +
      '<div class="sb-hint">OK — перейти · ▶ или «Назад» — закрыть</div></aside>'
    ).then(function (root) {
      return TS.dom.query('.sb-list', { root: root.h, limit: 1 }).then(function (l) {
        menu = { root: root, list: l[0], items: items, sel: sel };
        opening = false;
        render();
        TS.keys.capture(true);
        setTimeout(function () { if (menu) TS.dom.update(menu.root, { addClass: 'open' }); }, 20);
      });
    });
  }).catch(function () { opening = false; });
}

function close(go) {
  if (!menu) return;
  var m = menu;
  menu = null;
  TS.keys.capture(false);
  TS.dom.remove(m.root);
  if (!go) return;
  var it = m.items[m.sel];
  if (!it || !it.h) return;
  if (it.click) TS.dom.click(it.h); else TS.dom.focus(it.h);
}

// Мышью и пальцем — клик по пункту
TS.dom.on('#ext-sb .sb-item', 'click', function (node) {
  if (!menu) return;
  menu.sel = +node.attrs['data-i'];
  close(true);
});

TS.on('nav', function (e) {
  if (menu || e.screen !== 'home' || e.key !== 'left' || e.moved) return;
  open();
});

TS.on('key', function (dir) {
  if (!menu) return false;
  if (dir === 'up') move(-1);
  else if (dir === 'down') move(1);
  else if (dir === 'enter') close(true);
  else if (dir === 'right' || dir === 'back') close(false);
  return true;
});

// ---- Оценки на постерах ----
var decorating = false;

function fmt(v) { v = Number(v); return v > 0 ? (Math.round(v * 10) / 10).toFixed(1) : ''; }

function decorate() {
  if (decorating) return;
  decorating = true;
  TS.app.home().then(function (home) {
    if (!home.ready) return;
    var jobs = [];
    home.rows.forEach(function (row) {
      row.cards.forEach(function (c) {
        var r = c.item && fmt(c.item.vote);
        if (!r) return;
        jobs.push(TS.dom.query('.torrent-poster', { root: c.h, limit: 1, text: false }).then(function (box) {
          if (!box[0]) return;
          return TS.dom.query('.ext-rate', { root: box[0].h, limit: 1, text: false }).then(function (have) {
            if (!have.length) return TS.dom.create('<span class="ext-rate"><b>★</b>' + r + '</span>', { parent: box[0].h });
          });
        }).catch(function () { }));
      });
    });
    return Promise.all(jobs);
  }).then(function () { decorating = false; }, function () { decorating = false; });
}

TS.on('home', decorate);
TS.on('screen', function (s) { if (s !== 'home') close(false); });
