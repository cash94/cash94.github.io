/*
 * Боковое меню главной — пример расширения на мосту к DOM (TS.dom / TS.keys /
 * TS.app). Открывается «влево», когда левее идти некуда (первая карточка
 * ряда, первый пункт шапки): событие nav с moved: false. В меню — подборки
 * (с общей приставкой «Кинопоиск · …» — группой), плитки категорий и разделы
 * шапки. Вверх/вниз — выбор, ОК — перейти, вправо или «Назад» — закрыть.
 * Заодно «★ 7.5» в углу постеров рядов.
 *
 * С 1.1 — под пульт: без кнопок баннера («Смотреть», «‹ ›» — с пульта до них не
 * дойти, пока листаешь ряд), карточки рядов на 20% крупнее за их счёт, «▶» на
 * карточке под фокусом, заметный фокус в шапке, значки категорий в меню и
 * «В кинотеатрах» первым пунктом категорий.
 */
TS.register({
  name: 'Боковое меню главной',
  version: '1.1',
  description: '«Влево» с края главной — меню всех подборок, категорий и разделов. Оценки на постерах, карточки крупнее, без кнопок баннера.'
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
  // Оценка — в левом верхнем углу и тем же оранжевым, что «★» в строке баннера
  '.ext-rate{position:absolute;left:.4em;top:.4em;z-index:3;padding:.15em .45em;border-radius:.4em;',
  ' background:rgba(0,0,0,.72);color:#fff;font-size:.8em;font-weight:700;line-height:1.3}',
  '.ext-rate b{color:#ff8c00;margin-right:.2em}',

  // Кнопки баннера: с пульта до них не дойти, пока листаешь ряд. Скрытые главная
  // пропускает сама (offsetParent === null) — «вверх» с ряда ведёт в ряд выше
  '#home-play-btn,#home-prev-btn,#home-next-btn{display:none!important}',

  // «▶» по центру карточки под фокусом (::after постера занят рамкой фокуса)
  '.catalog-row-card.home-card.focused:not(.home-cat-tile) .row-poster-img:before{content:"";position:absolute;',
  ' left:50%;top:50%;z-index:3;width:9vh;height:9vh;margin:-4.5vh 0 0 -4.5vh;box-sizing:border-box;',
  ' border-radius:50%;border:.35vh solid rgba(255,140,0,.9);background:rgba(0,0,0,.42);pointer-events:none}',
  '.catalog-row-card.home-card.focused:not(.home-cat-tile) .row-poster-img:after{content:"";position:absolute;',
  ' left:50%;top:50%;z-index:4;margin:-1.6vh 0 0 -.9vh;border-style:solid;border-width:1.6vh 0 1.6vh 2.6vh;',
  ' border-color:transparent transparent transparent rgba(255,140,0,.95);pointer-events:none}',

  // Фокус в шапке: у пунктов он — только цвет текста, его не отличить от текущего раздела
  'body #home-topbar .home-nav-btn.focused,body #detail-view .home-nav-btn.focused{',
  ' background:#fff!important;color:#000!important;border-radius:.45em;box-shadow:0 0 0 .4em #fff!important}',
  'body #home-topbar .home-nav-btn.focused i,body #detail-view .home-nav-btn.focused i{color:#000!important}',
  'body #home-topbar .home-nav-btn.home-nav-icon.focused,body #detail-view .home-nav-btn.home-nav-icon.focused{',
  ' border-radius:50%;border-color:#fff!important;box-shadow:none!important}'
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

// «…В кинотеатрах» — первым пунктом категорий: самое свежее, туда заходят чаще всего
var PIN_FIRST = /в кинотеатрах$/i;

/** Подборку «…В кинотеатрах» — сразу под заголовок категорий. Нет её или категорий — как было. */
function pinFirst(out) {
  var pin = -1, head = -1;
  for (var i = 0; i < out.length; i++) {
    if (pin < 0 && !out[i].group && !out[i].click && PIN_FIRST.test(out[i].name)) pin = i;
    if (head < 0 && out[i].group) head = i;
  }
  if (pin < 0 || head < 0) return;
  var it = out.splice(pin, 1)[0];
  if (pin < head) head--;
  it.name = it.split ? it.split.rest : it.name;
  it.split = null;
  it.inGroup = true;
  it.icon = 'fi fi-rr-popcorn';
  out.splice(head + 1, 0, it);
}

/** Значок плитки категории — тот же глиф, что водяным знаком на самой плитке */
var tileIcons = {};

function loadTileIcons(home) {
  var jobs = [];
  home.rows.forEach(function (row) {
    row.cards.forEach(function (c) {
      if (!c.tile || tileIcons[c.h]) return;
      jobs.push(TS.dom.query('.home-cat-watermark', { root: c.h, limit: 1, text: false }).then(function (r) {
        var cls = r[0] && r[0].cls.split(' ').filter(function (x) { return x && x !== 'home-cat-watermark'; }).join(' ');
        if (cls) tileIcons[c.h] = cls;
      }).catch(function () { }));
    });
  });
  return Promise.all(jobs).then(function () { return tileIcons; });
}

/** Пункты меню: подборки (группы по приставке), плитки категорий, шапка */
function buildItems(home, navBtns, icons) {
  var out = [];
  home.rows.forEach(function (row) {
    if (!row.cards.length) return;
    if (row.cards[0].tile) {
      out.push({ group: row.title || 'Категории' });
      row.cards.forEach(function (c) {
        out.push({ name: c.title, h: c.h, click: true, inGroup: true, icon: icons[c.h] || 'fi fi-rr-apps', split: splitName(c.title) });
      });
      return;
    }
    var card = row.cards[Math.min(row.col, row.cards.length - 1)];
    out.push({ name: row.title, h: card.h, cur: row.index === home.activeRow, split: splitName(row.title) });
  });
  pinFirst(out);
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
    return loadTileIcons(home).then(function (icons) { return { home: home, nav: nav, icons: icons }; });
  }).then(function (r) {
    if (!r) return;
    var home = r.home;
    var items = buildItems(home, r.nav, r.icons);
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

// ---- Карточки рядов крупнее ----
// Раскладку считает главная: высоту баннера и размер плиток под экран. Её числа мост
// не отдаёт, поэтому один раз меряем, как она разложила, и ставим поверх: плитки в
// CARD_SCALE раз крупнее, баннер ниже ровно на столько, на сколько выросли картинки.
// Меряем один раз: после нашего стиля замер показал бы уже наши размеры, а свой
// размер экран телевизора не меняет.
var CARD_SCALE = 1.2;
var HERO_MIN = 150;
var scaled = false;

function scaleCards() {
  if (scaled) return;
  Promise.all([
    TS.dom.query('#home-hero', { limit: 1, rect: true, text: false }),
    TS.dom.query('#home-rows .catalog-row-card.home-card', { limit: 60, rect: true, text: false })
  ]).then(function (r) {
    var hero = r[0][0], card = null;
    r[1].forEach(function (c) { if (!card && c.visible && c.rect && c.rect.w > 0 && c.rect.h > 0) card = c; });
    if (scaled || !hero || !hero.visible || !hero.rect || !card) return;
    return TS.dom.query('.torrent-poster', { root: card.h, limit: 1, rect: true, text: false }).then(function (p) {
      var poster = p[0];
      if (scaled || !poster || !poster.rect || !(poster.rect.h > 0)) return;
      var w = poster.rect.w, ih = poster.rect.h, ch = card.rect.h, hh = hero.rect.h;
      var delta = Math.round(ih * CARD_SCALE) - ih;
      if (hh - delta < HERO_MIN) delta = Math.max(0, hh - HERO_MIN);
      if (delta <= 0) return;
      scaled = true;
      var nih = ih + delta, nw = Math.round(w * nih / ih);
      TS.ui.addStyle(
        'body .catalog-row-card.home-card,body .catalog-row-viewport .catalog-row-card.home-card{' +
        'flex:0 0 ' + nw + 'px!important;width:' + nw + 'px!important;height:' + (ch + delta) + 'px!important}' +
        'body .catalog-row-card.home-card .torrent-poster,' +
        'body .catalog-row-viewport .catalog-row-card.home-card .torrent-poster,' +
        'body .catalog-row-card.home-card .row-poster-img{width:' + nw + 'px!important;height:' + nih + 'px!important}' +
        'body #home-hero{height:' + (hh - delta) + 'px!important}');
    });
  }).catch(function () { });
}

// Раскладка готова чуть позже рядов: даём ей время. Расширение может запуститься и
// на уже построенной главной (установили только что) — тогда пробуем сразу, а не
// вышло (главная не на экране) — при первом нажатии на ней
TS.on('home', function () { setTimeout(scaleCards, 600); });
TS.on('screen', function (s) { if (s === 'home') setTimeout(scaleCards, 600); });
TS.on('nav', function (e) { if (!scaled && e.screen === 'home') scaleCards(); });
setTimeout(scaleCards, 600);
