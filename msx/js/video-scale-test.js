/*
 * Проверка масштабирования видео: Настройки → Об устройстве → «Проверка
 * масштабирования видео».
 *
 * Зачем. На телевизорах (Hisense Vidaa и др.) видео часто выводит не страница, а
 * аппаратный слой под ней — и он понимает не все способы масштабирования, которые
 * в Chrome на ПК работают. Здесь три способа, каждый в четырёх режимах кнопки
 * масштаба плеера, на тестовом кадре 2,40:1 (красная рамка по краю — срезаны ли
 * края, круг — растянута ли картинка). Кто проверяет на ТВ, проходит пультом по
 * пунктам и говорит, где картинка меняется.
 *
 * Модуль грузится по нажатию кнопки (app.js: openVideoScaleTest), в общей
 * загрузке его нет. ES5 — открывают его и на Chrome 66.
 */
(function () {
  var MODES = [
    { id: 'contain', name: 'С полосами' },
    { id: 'fill', name: 'Растянуть' },
    { id: 'cover', name: 'Обрезка' },
    { id: 'none', name: 'Оригинал' }
  ];
  var METHODS = [
    { id: 'fit', name: 'A · object-fit' },
    { id: 'box', name: 'B · рамка' },
    { id: 'transform', name: 'C · transform' }
  ];
  var VIDEOS = ['1920x800', '3840x1600'];

  var state = { video: 0, method: 0, mode: 0 };
  var overlay = null, video = null, info = null, rows = [], focus = { row: 0, col: 0 };

  // Ролики лежат рядом с js/ на зеркале (или в public/ при ?local=1): адрес берём
  // у уже загруженного app.js, как и сам этот модуль
  function baseUrl() {
    var s = document.querySelector('script[src*="/js/app.js"]');
    var src = s ? s.src : '';
    var i = src.indexOf('/js/app.js');
    return i !== -1 ? src.slice(0, i) + '/' : '/';
  }

  function css(el, props) {
    for (var k in props) el.style[k] = props[k];
  }

  function screenSize() {
    return { w: overlay.clientWidth || window.innerWidth, h: overlay.clientHeight || window.innerHeight };
  }

  /** Сброс к «видео во весь экран, contain» — от него считает каждый способ */
  function resetVideo() {
    css(video, {
      position: 'absolute', left: '0px', top: '0px', width: '100%', height: '100%',
      maxWidth: 'none', maxHeight: 'none', objectFit: 'contain',
      transform: 'none', webkitTransform: 'none', transformOrigin: '50% 50%'
    });
  }

  function apply() {
    if (!video) return;
    resetVideo();
    var mode = MODES[state.mode].id, method = METHODS[state.method].id;
    var s = screenSize(), vw = video.videoWidth, vh = video.videoHeight;

    if (method === 'fit') {
      // A: элемент во весь экран, режим только свойством object-fit
      video.style.objectFit = mode;
    } else if (vw && vh) {
      var rc = Math.min(s.w / vw, s.h / vh);                 // «С полосами»
      var r = mode === 'cover' ? Math.max(s.w / vw, s.h / vh) : mode === 'none' ? 1 : rc;
      if (method === 'box') {
        // B: рамка элемента ровно по кадру нужного размера (больше экрана —
        // для «Обрезки» и «Оригинала»), object-fit: fill — без своего масштаба
        video.style.objectFit = 'fill';
        var w = mode === 'fill' ? s.w : Math.round(vw * r);
        var h = mode === 'fill' ? s.h : Math.round(vh * r);
        css(video, {
          width: w + 'px', height: h + 'px',
          left: Math.round((s.w - w) / 2) + 'px', top: Math.round((s.h - h) / 2) + 'px'
        });
      } else {
        // C: рамка «С полосами», дальше увеличение transform: scale — по ширине
        // и высоте отдельно для «Растянуть»
        var bw = Math.round(vw * rc), bh = Math.round(vh * rc);
        video.style.objectFit = 'fill';
        css(video, {
          width: bw + 'px', height: bh + 'px',
          left: Math.round((s.w - bw) / 2) + 'px', top: Math.round((s.h - bh) / 2) + 'px'
        });
        var sx = mode === 'fill' ? s.w / bw : r / rc;
        var sy = mode === 'fill' ? s.h / bh : r / rc;
        var t = 'scale(' + sx.toFixed(4) + ',' + sy.toFixed(4) + ')';
        video.style.transform = t;
        video.style.webkitTransform = t;
      }
    }
    render();
  }

  function render() {
    var rect = video.getBoundingClientRect();
    var s = screenSize();
    info.innerHTML =
      '<b>' + METHODS[state.method].name + ' — ' + MODES[state.mode].name + '</b>' +
      '<span>Кадр ' + (video.videoWidth ? video.videoWidth + '×' + video.videoHeight : VIDEOS[state.video] + ' (грузится)') +
      ' · экран ' + s.w + '×' + s.h + (window.devicePixelRatio && window.devicePixelRatio !== 1 ? ' (×' + window.devicePixelRatio + ')' : '') +
      ' · элемент ' + Math.round(rect.width) + '×' + Math.round(rect.height) + '</span>';
    for (var r = 0; r < rows.length; r++) {
      for (var c = 0; c < rows[r].items.length; c++) {
        var b = rows[r].items[c];
        b.classList.toggle('vst-active', !!rows[r].key && state[rows[r].key] === c);
        b.classList.toggle('focused', r === focus.row && c === focus.col);
      }
    }
  }

  function loadVideo() {
    video.src = baseUrl() + 'videotest/' + VIDEOS[state.video] + '.mp4';
    var p = video.play();
    if (p && typeof p.catch === 'function') p.catch(function () { });
    render();
  }

  function choose(row, col) {
    var r = rows[row];
    if (!r) return;
    if (r.key) {
      var changedVideo = r.key === 'video' && state.video !== col;
      state[r.key] = col;
      if (changedVideo) loadVideo(); else apply();
    } else if (r.action) {
      r.action(col);
    }
  }

  function button(label, row, col) {
    var b = document.createElement('button');
    b.className = 'vst-btn';
    b.textContent = label;
    b.onclick = function () { focus.row = row; focus.col = col; choose(row, col); };
    return b;
  }

  function build() {
    overlay = document.createElement('div');
    overlay.id = 'vst-overlay';
    overlay.innerHTML =
      '<style>' +
      '#vst-overlay{position:fixed;top:0;left:0;right:0;bottom:0;z-index:100000;background:#000;overflow:hidden;font-family:inherit;}' +
      '#vst-overlay video{position:absolute;}' +
      '.vst-info{position:absolute;top:0;left:0;right:0;padding:1.2vw 2vw;background:rgba(0,0,0,.72);color:#fff;font-size:1.5vw;line-height:1.4;}' +
      '.vst-info b{display:block;font-size:1.9vw;}' +
      '.vst-info span{color:#c9d3ea;}' +
      '.vst-panel{position:absolute;left:0;right:0;bottom:0;padding:1vw 2vw 1.4vw;background:rgba(0,0,0,.72);}' +
      '.vst-row{display:flex;flex-wrap:wrap;align-items:center;margin-top:.5vw;}' +
      '.vst-row-label{width:9vw;color:#8b9ac0;font-size:1.2vw;}' +
      '.vst-btn{margin:0 .6vw .3vw 0;padding:.5vw 1.2vw;border:2px solid transparent;border-radius:.6vw;background:rgba(255,255,255,.12);color:#fff;font-size:1.3vw;font-family:inherit;cursor:pointer;}' +
      '.vst-btn.vst-active{background:#4a9eff;}' +
      '.vst-btn.focused{border-color:var(--focus-color,#ff8c00);}' +
      '</style>';
    video = document.createElement('video');
    video.muted = true;
    video.loop = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('autoplay', '');
    video.addEventListener('loadedmetadata', apply);
    overlay.appendChild(video);

    info = document.createElement('div');
    info.className = 'vst-info';
    overlay.appendChild(info);

    var panel = document.createElement('div');
    panel.className = 'vst-panel';
    var defs = [
      { label: 'Видео', key: 'video', names: VIDEOS },
      { label: 'Способ', key: 'method', names: METHODS.map(function (m) { return m.name; }) },
      { label: 'Режим', key: 'mode', names: MODES.map(function (m) { return m.name; }) },
      { label: '', names: ['Скрыть на 5 с', 'Закрыть'], action: function (col) { if (col === 0) peek(); else close(); } }
    ];
    rows = [];
    for (var r = 0; r < defs.length; r++) {
      var rowEl = document.createElement('div');
      rowEl.className = 'vst-row';
      var lab = document.createElement('div');
      lab.className = 'vst-row-label';
      lab.textContent = defs[r].label;
      rowEl.appendChild(lab);
      var items = [];
      for (var c = 0; c < defs[r].names.length; c++) {
        var b = button(defs[r].names[c], r, c);
        items.push(b);
        rowEl.appendChild(b);
      }
      rows.push({ key: defs[r].key, action: defs[r].action, items: items });
      panel.appendChild(rowEl);
    }
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  }

  // Пульт: стрелки по кнопкам, OK — выбрать, «Назад» — закрыть. На window в фазе
  // захвата: раньше control.js, иначе настройки под оверлеем ловили бы стрелки
  function onKey(e) {
    if (!overlay) return;
    if (peekTimer) {
      // Пока панель спрятана, первое нажатие только возвращает её
      e.preventDefault(); e.stopImmediatePropagation();
      clearTimeout(peekTimer); peekTimer = null; setChrome(true);
      return;
    }
    var kc = e.keyCode;
    var back = typeof isBackKey === 'function' ? isBackKey(kc) : (kc === 8 || kc === 27 || kc === 461);
    var ok = typeof isOkKey === 'function' ? isOkKey(kc) : kc === 13;
    var dir = typeof arrowDir === 'function' ? arrowDir(kc) : null;
    // «Назад» — первым: на Tizen 10009 значит и «влево», и «Назад»
    if (back) { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    if (ok) { e.preventDefault(); e.stopImmediatePropagation(); choose(focus.row, focus.col); return; }
    if (!dir) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (dir === 'left') focus.col = Math.max(0, focus.col - 1);
    if (dir === 'right') focus.col = Math.min(rows[focus.row].items.length - 1, focus.col + 1);
    if (dir === 'up' || dir === 'down') {
      focus.row = Math.max(0, Math.min(rows.length - 1, focus.row + (dir === 'up' ? -1 : 1)));
      focus.col = Math.min(focus.col, rows[focus.row].items.length - 1);
    }
    render();
  }

  function onResize() { apply(); }

  // Панель и подпись прикрывают края кадра, а по красной рамке как раз и видно,
  // срезаны ли они: на 5 секунд прячем всё, кроме видео (любая клавиша — назад)
  var peekTimer = null;
  function setChrome(visible) {
    if (!overlay) return;
    var els = overlay.querySelectorAll('.vst-info, .vst-panel');
    for (var i = 0; i < els.length; i++) els[i].style.visibility = visible ? '' : 'hidden';
  }
  function peek() {
    setChrome(false);
    clearTimeout(peekTimer);
    peekTimer = setTimeout(function () { peekTimer = null; setChrome(true); }, 5000);
  }

  function open() {
    if (overlay) return;
    build();
    focus = { row: 2, col: 0 };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    loadVideo();
  }

  function close() {
    if (!overlay) return;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    clearTimeout(peekTimer); peekTimer = null;
    try { video.pause(); video.removeAttribute('src'); video.load(); } catch (e) { }
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = video = info = null;
    rows = [];
    // Фокус пульта — обратно на кнопку, с которой открыли
    var btn = document.getElementById('video-scale-test-btn');
    if (btn && typeof window.focusEl === 'function') window.focusEl(btn);
  }

  window.VideoScaleTest = { open: open, close: close };
})();
