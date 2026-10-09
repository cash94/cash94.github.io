/*
 * Проверка пульта: Настройки → Об устройстве → «Проверка пульта».
 *
 * Зачем. Браузеры для Apple TV и других приставок на одно нажатие ОК присылают
 * разное: Enter, свой клик по элементу под их собственным фокусом, фокус в поле
 * ввода. Без устройства этого не увидеть, поэтому здесь журнал всех таких
 * событий и те же элементы, что в настройках: переключатели и поле ввода,
 * которое появляется под переключателем (как логин под «Требуется
 * аутентификация»). Кто проверяет, нажимает ОК и присылает снимок экрана.
 *
 * «отброшено» в журнале — событие погасила защита пульта Apple
 * (app.js: setupAppleRemoteGuard). Модуль грузится по нажатию кнопки
 * (app.js: openRemoteTest). ES5 — открывают его и на Chrome 66.
 */
(function () {
  var LOG_TYPES = ['keydown', 'keyup', 'keypress', 'mousedown', 'mouseup', 'click',
    'pointerdown', 'pointerup', 'touchstart', 'touchend', 'focusin', 'focusout', 'change'];
  var LOG_MAX = 60;
  var BURST_GAP_MS = 1500;

  var overlay = null, logEl = null, items = [], focusIdx = 0;
  var entries = [], burstStart = 0, lastAt = 0;

  function describe(el) {
    if (!el || el === window) return 'window';
    if (el === document) return 'document';
    if (!el.tagName) return String(el.nodeName || '?');
    var s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    else if (el.className && typeof el.className === 'string') s += '.' + el.className.split(' ')[0];
    if (el.tagName === 'INPUT') s += '[' + el.type + ']';
    return s;
  }

  function onAny(e) {
    var now = Date.now();
    if (!lastAt || now - lastAt > BURST_GAP_MS) {
      burstStart = now;
      entries.unshift({ sep: true });
    }
    lastAt = now;
    var entry = {
      t: now - burstStart,
      type: e.type,
      key: e.type.indexOf('key') === 0 ? (e.key || '?') + ' (' + (e.keyCode || e.which || 0) + ')' : '',
      target: describe(e.target),
      trusted: e.isTrusted,
      event: e
    };
    entries.unshift(entry);
    if (entries.length > LOG_MAX) entries.length = LOG_MAX;
    // Отбросила ли событие защита, станет известно после её обработчика
    // (он на document, этот — на window, раньше): смотрим в следующей задаче
    setTimeout(render, 0);
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function render() {
    if (!overlay) return;
    for (var i = 0; i < items.length; i++) items[i].el.classList.toggle('focused', i === focusIdx);
    var field = overlay.querySelector('.rt-field-row');
    if (field) field.style.display = items[0].cb.checked ? '' : 'none';
    var html = '';
    for (var j = 0; j < entries.length; j++) {
      var en = entries[j];
      if (en.sep) { html += '<div class="rt-sep"></div>'; continue; }
      if (en.event) { en.swallowed = !!en.event.__tsSwallowed; en.event = null; }
      html += '<div class="rt-line' + (en.swallowed ? ' rt-swallowed' : '') + '">' +
        '<span class="rt-t">+' + en.t + '</span>' +
        '<span class="rt-type">' + esc(en.type) + '</span>' +
        (en.key ? '<span class="rt-key">' + esc(en.key) + '</span>' : '') +
        '<span class="rt-target">' + esc(en.target) + '</span>' +
        (en.trusted ? '' : '<span class="rt-tag">код</span>') +
        (en.swallowed ? '<span class="rt-tag rt-tag-drop">отброшено</span>' : '') +
        '</div>';
    }
    logEl.innerHTML = html || '<div class="rt-empty">Нажмите ОК на любом пункте слева</div>';
  }

  /** Действие пункта — тем же путём, что control.js в настройках: click() */
  function activate(i) {
    var it = items[i];
    if (!it) return;
    if (it.cb) it.cb.click();
    else if (it.input) it.input.focus();
    else if (it.action) it.action();
    render();
  }

  function build() {
    overlay = document.createElement('div');
    overlay.id = 'rt-overlay';
    overlay.innerHTML =
      '<style>' +
      '#rt-overlay{position:fixed;top:0;left:0;right:0;bottom:0;z-index:100000;background:#0b0b12;color:#fff;display:flex;font-family:inherit;}' +
      '.rt-side{width:38%;padding:2vw;box-sizing:border-box;overflow:hidden;}' +
      '.rt-side h2{margin:0 0 .4vw;font-size:1.9vw;}' +
      '.rt-env{color:#8b9ac0;font-size:1vw;line-height:1.4;margin-bottom:1.2vw;word-break:break-all;}' +
      '.rt-item{display:flex;align-items:center;margin-bottom:.7vw;padding:.8vw 1vw;border:2px solid transparent;border-radius:.7vw;background:rgba(255,255,255,.07);font-size:1.4vw;cursor:pointer;}' +
      '.rt-item.focused{border-color:var(--focus-color,#ff8c00);background:rgba(255,255,255,.12);}' +
      '.rt-item input[type=checkbox]{width:1.6vw;height:1.6vw;margin:0 1vw 0 0;flex-shrink:0;}' +
      '.rt-item input[type=text]{flex:1;min-width:0;padding:.4vw .6vw;font-size:1.3vw;border-radius:.4vw;border:1px solid #444;background:#15151f;color:#fff;font-family:inherit;}' +
      '.rt-item .rt-label{margin-right:1vw;white-space:nowrap;}' +
      '.rt-log{flex:1;padding:2vw 2vw 2vw 0;overflow:hidden;font-size:1.15vw;line-height:1.5;}' +
      '.rt-line{display:flex;align-items:baseline;white-space:nowrap;}' +
      '.rt-line span{margin-right:.8vw;}' +
      '.rt-t{width:5vw;text-align:right;color:#8b9ac0;}' +
      '.rt-type{width:8vw;font-weight:700;}' +
      '.rt-key{color:#ffb459;}' +
      '.rt-target{color:#9fd0ff;}' +
      '.rt-tag{padding:0 .5vw;border-radius:.3vw;background:rgba(255,255,255,.12);font-size:.95vw;}' +
      '.rt-tag-drop{background:rgba(255,90,90,.25);color:#ff9d9d;}' +
      '.rt-swallowed{opacity:.6;}' +
      '.rt-sep{height:1px;margin:.5vw 0;background:rgba(255,255,255,.15);}' +
      '.rt-empty{color:#8b9ac0;}' +
      '</style>';

    var side = document.createElement('div');
    side.className = 'rt-side';
    side.innerHTML = '<h2>Проверка пульта</h2><div class="rt-env"></div>';
    side.querySelector('.rt-env').textContent =
      (AppState.applePlatform ? 'Apple: ' + AppState.applePlatform + ' · защита пульта включена · ' : '') +
      window.innerWidth + '×' + window.innerHeight + ' · ' + navigator.userAgent;

    function addItem(html, extra) {
      var el = document.createElement('div');
      el.className = 'rt-item' + (extra && extra.cls ? ' ' + extra.cls : '');
      el.innerHTML = html;
      side.appendChild(el);
      var it = { el: el, cb: el.querySelector('input[type=checkbox]'), input: el.querySelector('input[type=text]'), action: extra && extra.action };
      var idx = items.length;
      items.push(it);
      // Мышь и касание: клик по строке, но не по самому чекбоксу — тот
      // переключается сам, второй click() вернул бы его назад
      el.addEventListener('click', function (e) {
        focusIdx = idx;
        if (it.cb && e.target === it.cb) { render(); return; }
        if (it.input && e.target === it.input) { render(); return; }
        activate(idx);
      });
      return it;
    }
    addItem('<input type="checkbox" id="rt-cb-auth"><span>Переключатель с полем ввода</span>');
    addItem('<span class="rt-label">Логин</span><input type="text" id="rt-input" placeholder="поле под переключателем">', { cls: 'rt-field-row' });
    addItem('<input type="checkbox" id="rt-cb-2"><span>Переключатель 2</span>');
    addItem('<input type="checkbox" id="rt-cb-3"><span>Переключатель 3</span>');
    addItem('<span>Очистить журнал</span>', { action: function () { entries = []; lastAt = 0; } });
    addItem('<span>Закрыть</span>', { action: close });
    overlay.appendChild(side);

    logEl = document.createElement('div');
    logEl.className = 'rt-log';
    overlay.appendChild(logEl);
    document.body.appendChild(overlay);
  }

  function visibleItems() {
    var out = [];
    for (var i = 0; i < items.length; i++) if (items[i].el.style.display !== 'none') out.push(i);
    return out;
  }

  // Пульт: вверх/вниз по пунктам, ОК — действие, «Назад» — закрыть. На window
  // в фазе захвата, раньше control.js. Пока поле ввода в нативном фокусе,
  // клавиши — ему (кроме «Назад», он только снимает фокус)
  function onKey(e) {
    if (!overlay) return;
    var kc = e.keyCode;
    var back = typeof isBackKey === 'function' ? isBackKey(kc) : (kc === 8 || kc === 27 || kc === 461);
    var ok = typeof isOkKey === 'function' ? isOkKey(kc) : kc === 13;
    var dir = typeof arrowDir === 'function' ? arrowDir(kc) : null;
    var a = document.activeElement;
    var typing = a && a.id === 'rt-input';
    if (back && !(typing && kc === 8)) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (typing) { a.blur(); return; }
      close(); return;
    }
    if (typing) { if (ok) { e.preventDefault(); a.blur(); } e.stopImmediatePropagation(); return; }
    if (ok) { e.preventDefault(); e.stopImmediatePropagation(); activate(focusIdx); return; }
    if (dir !== 'up' && dir !== 'down') { if (dir) { e.preventDefault(); e.stopImmediatePropagation(); } return; }
    e.preventDefault(); e.stopImmediatePropagation();
    var vis = visibleItems(), pos = vis.indexOf(focusIdx);
    if (pos === -1) pos = 0;
    pos = Math.max(0, Math.min(vis.length - 1, pos + (dir === 'up' ? -1 : 1)));
    focusIdx = vis[pos];
    render();
  }

  function open() {
    if (overlay) return;
    items = []; entries = []; lastAt = 0; focusIdx = 0;
    build();
    // Журнал — раньше обработчика клавиш: тот гасит событие для остальных
    for (var i = 0; i < LOG_TYPES.length; i++) window.addEventListener(LOG_TYPES[i], onAny, true);
    window.addEventListener('keydown', onKey, true);
    render();
  }

  function close() {
    if (!overlay) return;
    for (var i = 0; i < LOG_TYPES.length; i++) window.removeEventListener(LOG_TYPES[i], onAny, true);
    window.removeEventListener('keydown', onKey, true);
    if (document.activeElement && overlay.contains(document.activeElement)) document.activeElement.blur();
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null; logEl = null; items = []; entries = [];
    var btn = document.getElementById('remote-test-btn');
    if (btn && typeof focusEl === 'function') setTimeout(function () { focusEl(btn); }, 0);
  }

  window.RemoteTest = { open: open, close: close };
})();
