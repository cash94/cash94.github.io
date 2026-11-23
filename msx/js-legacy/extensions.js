/* Сборка для старых браузеров (Chrome 53) из js/extensions.js — tools/legacy-build/build.js. Руками не править. */
(function () {
  'use strict';

  var LIST_KEY = 'extensions';
  var DB_NAME = 'ts-extensions';
  var DB_STORE = 'data';
  var STORAGE_LIMIT = 1000000;
  var CSS_LIMIT = 100000;
  var HTML_LIMIT = 50000;
  var FETCH_LIMIT = 2 * 1024 * 1024;
  var FETCH_TIMEOUT_MS = 15000;
  var FETCH_PARALLEL = 6;
  var MAX_BUTTONS = 3;
  var START_DELAY_MS = 2500;
  var POLL_MS = 600;
  var plugins = [];
  var running = {};
  var catalogCache = null;
  var panelPlugin = null;
  var panelReturnFocus = null;
  function log() {
    try {
      console.log.apply(console, ['🧩'].concat([].slice.call(arguments)));
    } catch (e) {}
  }
  function mirrorBase() {
    return location.search.indexOf('local=1') !== -1 ? '/' : 'https://cash94.github.io/msx/';
  }
  function loadList() {
    try {
      var raw = JSON.parse(localStorage.getItem(LIST_KEY) || '[]');
      plugins = [];
      for (var i = 0; i < raw.length; i++) {
        if (raw[i] && raw[i].id && raw[i].url) plugins.push(raw[i]);
      }
    } catch (e) {
      plugins = [];
    }
  }
  function saveList() {
    try {
      localStorage.setItem(LIST_KEY, JSON.stringify(plugins));
    } catch (e) {}
  }
  function findPlugin(id) {
    for (var i = 0; i < plugins.length; i++) if (plugins[i].id === id) return plugins[i];
    return null;
  }
  function pluginIdFor(url) {
    var h = 5381;
    for (var i = 0; i < url.length; i++) h = (h << 5) + h + url.charCodeAt(i) >>> 0;
    return 'x' + h.toString(36);
  }
  function nameFromUrl(url) {
    var m = /\/([^\/?#]+?)(?:\.js)?(?:[?#].*)?$/.exec(url);
    return m ? decodeURIComponent(m[1]) : url;
  }
  function parseUrl(url) {
    try {
      return new URL(url, location.href);
    } catch (e) {}
    var a = document.createElement('a');
    a.href = url;
    return {
      protocol: a.protocol,
      hostname: a.hostname,
      host: a.host,
      href: a.href,
      origin: a.protocol + '//' + a.host
    };
  }
  function validPluginUrl(url) {
    if (!/^https?:\/\/[^\s"'<>]+$/i.test(url)) return null;
    var u = parseUrl(url);
    if (!u || !/^https?:$/.test(u.protocol) || !u.hostname) return null;
    return u;
  }
  var dbPromise = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      try {
        if (!window.indexedDB) {
          resolve(null);
          return;
        }
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () {
          if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
        };
        req.onsuccess = function () {
          resolve(req.result);
        };
        req.onerror = function () {
          resolve(null);
        };
        req.onblocked = function () {
          resolve(null);
        };
      } catch (e) {
        resolve(null);
      }
    });
    return dbPromise;
  }
  function dbGet(id) {
    return openDb().then(function (db) {
      if (!db) return {};
      return new Promise(function (resolve) {
        try {
          var r = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(id);
          r.onsuccess = function () {
            resolve(r.result && typeof r.result === 'object' ? r.result : {});
          };
          r.onerror = function () {
            resolve({});
          };
        } catch (e) {
          resolve({});
        }
      });
    });
  }
  function dbPut(id, data) {
    return openDb().then(function (db) {
      if (!db) return;
      try {
        var store = db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE);
        if (data === null) store['delete'](id);else store.put(data, id);
      } catch (e) {
        log('хранилище: запись не удалась', e);
      }
    });
  }
  function scheduleSave(st) {
    if (st.saveTimer) clearTimeout(st.saveTimer);
    st.saveTimer = setTimeout(function () {
      st.saveTimer = null;
      dbPut(st.id, st.data);
    }, 300);
  }
  function sandboxRuntime() {
    var parentWin = window.parent;
    var handlers = {};
    var pending = {};
    var reqSeq = 0;
    var store = {};
    var info = {};
    var keyHandlerSet = false;
    function send(msg) {
      msg.__tsx = 1;
      parentWin.postMessage(msg, '*');
    }
    function emit(name, data) {
      var list = handlers[name] || [];
      var handled = false;
      for (var i = 0; i < list.length; i++) {
        try {
          if (list[i](data) === true) handled = true;
        } catch (e) {
          reportError(e);
        }
      }
      return handled;
    }
    function reportError(e) {
      send({
        type: 'error',
        message: String(e && e.message || e).slice(0, 500)
      });
    }
    window.onerror = function (msg, src, line) {
      send({
        type: 'error',
        message: String(msg).slice(0, 400) + (line ? ' (строка ' + line + ')' : '')
      });
    };
    function copy(v) {
      return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    }
    function focusables() {
      var all = document.querySelectorAll('button, a[href], [data-focus]');
      var out = [];
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (el.disabled || el.offsetParent === null) continue;
        out.push(el);
      }
      return out;
    }
    function current() {
      return document.querySelector('.focused');
    }
    function focus(el) {
      var c = current();
      if (c) c.classList.remove('focused');
      if (!el) return;
      el.classList.add('focused');
      if (el.scrollIntoView) {
        try {
          el.scrollIntoView({
            block: 'nearest'
          });
        } catch (e) {
          el.scrollIntoView(false);
        }
      }
    }
    function move(dir) {
      var list = focusables();
      if (!list.length) return;
      var c = current();
      if (!c || list.indexOf(c) === -1) {
        focus(list[0]);
        return;
      }
      var r = c.getBoundingClientRect();
      var cx = r.left + r.width / 2,
        cy = r.top + r.height / 2;
      var best = null,
        bestScore = Infinity;
      for (var i = 0; i < list.length; i++) {
        if (list[i] === c) continue;
        var q = list[i].getBoundingClientRect();
        var qx = q.left + q.width / 2,
          qy = q.top + q.height / 2;
        var dx = qx - cx,
          dy = qy - cy;
        var ok = dir === 'up' ? dy < -1 : dir === 'down' ? dy > 1 : dir === 'left' ? dx < -1 : dx > 1;
        if (!ok) continue;
        var main = dir === 'up' || dir === 'down' ? Math.abs(dy) : Math.abs(dx);
        var side = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
        var score = main + side * 2;
        if (score < bestScore) {
          bestScore = score;
          best = list[i];
        }
      }
      if (best) focus(best);
    }
    var TS = {
      version: 1,
      info: function () {
        return copy(info);
      },
      on: function (name, fn) {
        if (typeof fn !== 'function') return;
        (handlers[name] = handlers[name] || []).push(fn);
      },
      off: function (name, fn) {
        var list = handlers[name] || [];
        var i = list.indexOf(fn);
        if (i !== -1) list.splice(i, 1);
      },
      register: function (meta) {
        meta = meta || {};
        send({
          type: 'register',
          name: String(meta.name || '').slice(0, 60),
          version: String(meta.version || '').slice(0, 20),
          description: String(meta.description || '').slice(0, 300),
          settings: !!meta.settings
        });
      },
      toast: function (text) {
        send({
          type: 'toast',
          text: String(text).slice(0, 200)
        });
      },
      storage: {
        get: function (key, def) {
          return store.hasOwnProperty(key) ? copy(store[key]) : def;
        },
        set: function (key, value) {
          store[String(key)] = copy(value);
          send({
            type: 'storage',
            op: 'set',
            key: String(key),
            value: store[String(key)]
          });
        },
        remove: function (key) {
          delete store[key];
          send({
            type: 'storage',
            op: 'remove',
            key: String(key)
          });
        },
        keys: function () {
          return Object.keys(store);
        },
        clear: function () {
          store = {};
          send({
            type: 'storage',
            op: 'clear'
          });
        }
      },
      ui: {
        addStyle: function (css) {
          send({
            type: 'style',
            css: String(css)
          });
        },
        hide: function (selector) {
          send({
            type: 'hide',
            selector: String(selector)
          });
        },
        setText: function (selector, text) {
          send({
            type: 'text',
            selector: String(selector),
            text: String(text)
          });
        },
        addButton: function (opts) {
          opts = opts || {};
          send({
            type: 'button',
            id: String(opts.id || 'main'),
            label: String(opts.label || ''),
            icon: String(opts.icon || '')
          });
        },
        removeButton: function (id) {
          send({
            type: 'button-remove',
            id: String(id || 'main')
          });
        },
        setDetailBlock: function (html) {
          send({
            type: 'block',
            html: String(html || '')
          });
        }
      },
      panel: {
        open: function (title) {
          send({
            type: 'panel',
            open: true,
            title: title ? String(title).slice(0, 80) : ''
          });
        },
        close: function () {
          send({
            type: 'panel',
            open: false
          });
        },
        focus: function (el) {
          focus(el);
        }
      },
      fetch: function (url, opts) {
        opts = opts || {};
        return new Promise(function (resolve, reject) {
          var id = ++reqSeq;
          pending[id] = {
            resolve: resolve,
            reject: reject
          };
          send({
            type: 'fetch',
            reqId: id,
            url: String(url),
            method: String(opts.method || 'GET').toUpperCase(),
            headers: opts.headers || {},
            body: opts.body == null ? null : String(opts.body)
          });
        });
      },
      dom: {
        query: function (selector, opts) {
          return call('query', {
            sel: String(selector),
            opts: opts || {}
          });
        },
        closest: function (node, selector) {
          return call('closest', {
            h: hid(node),
            sel: String(selector)
          });
        },
        children: function (node) {
          return call('children', {
            h: hid(node)
          });
        },
        focused: function () {
          return call('focused', {});
        },
        create: function (html, opts) {
          opts = opts || {};
          var parent = opts.parent;
          return call('create', {
            html: String(html),
            parent: parent && typeof parent === 'object' ? parent.h : parent,
            where: opts.where || 'append'
          });
        },
        update: function (node, changes) {
          return call('update', {
            h: hid(node),
            ch: changes || {}
          });
        },
        remove: function (node) {
          return call('remove', {
            h: hid(node)
          });
        },
        click: function (node) {
          return call('click', {
            h: hid(node)
          });
        },
        focus: function (node) {
          return call('focus', {
            h: hid(node)
          });
        },
        on: function (selector, type, fn) {
          if (typeof fn !== 'function') return;
          var lid = ++reqSeq;
          domHandlers[lid] = fn;
          send({
            type: 'listen',
            lid: lid,
            sel: String(selector),
            ev: String(type || 'click')
          });
        }
      },
      keys: {
        capture: function (on) {
          send({
            type: 'capture',
            on: !!on
          });
        }
      },
      app: {
        home: function () {
          return call('home', {});
        },
        screen: function () {
          return call('screen', {});
        },
        item: function (node) {
          return call('item', {
            h: hid(node)
          });
        }
      }
    };
    window.TS = TS;
    var domHandlers = {};
    function hid(x) {
      return x && typeof x === 'object' ? x.h : x;
    }
    function call(op, args) {
      return new Promise(function (resolve, reject) {
        var id = ++reqSeq;
        pending[id] = {
          resolve: resolve,
          reject: reject,
          call: true
        };
        send({
          type: 'call',
          reqId: id,
          op: op,
          args: args
        });
      });
    }
    var origOn = TS.on;
    TS.on = function (name, fn) {
      if ((name === 'nav' || name === 'home') && !(handlers[name] && handlers[name].length)) {
        send({
          type: 'subscribe',
          name: name
        });
      }
      origOn(name, fn);
    };
    window.addEventListener('message', function (e) {
      if (e.source !== parentWin) return;
      var m = e.data;
      if (!m || m.__tsx !== 1) return;
      if (m.type === 'init') {
        store = m.storage || {};
        info = m.info || {};
        document.documentElement.style.setProperty('--focus-color', m.focusColor || '#ff8c00');
        var s = document.createElement('script');
        s.src = m.src;
        s.onerror = function () {
          send({
            type: 'need-code'
          });
        };
        document.head.appendChild(s);
      } else if (m.type === 'code') {
        if (m.error) {
          send({
            type: 'error',
            message: m.error
          });
          return;
        }
        try {
          (0, eval)(String(m.text) + '\n//# sourceURL=' + m.src);
        } catch (err) {
          reportError(err);
        }
      } else if (m.type === 'event') {
        if (m.name === 'key') {
          if (!emit('key', m.data)) {
            if (m.data === 'enter') {
              var c = current();
              if (c && c.click) c.click();
            } else move(m.data);
          }
        } else {
          if (m.name === 'panel' && m.data && m.data.open && !current()) {
            setTimeout(function () {
              var l = focusables();
              if (l.length && !current()) focus(l[0]);
            }, 0);
          }
          emit(m.name, m.data);
        }
      } else if (m.type === 'call') {
        var pc = pending[m.reqId];
        if (!pc) return;
        delete pending[m.reqId];
        if (m.error) pc.reject(new Error(m.error));else pc.resolve(m.result);
      } else if (m.type === 'dom-event') {
        var fn = domHandlers[m.lid];
        if (fn) {
          try {
            fn(m.node);
          } catch (err) {
            reportError(err);
          }
        }
      } else if (m.type === 'fetch') {
        var p = pending[m.reqId];
        if (!p) return;
        delete pending[m.reqId];
        if (m.error) {
          p.reject(new Error(m.error));
          return;
        }
        var text = m.text || '';
        p.resolve({
          ok: m.ok,
          status: m.status,
          url: m.url,
          text: function () {
            return Promise.resolve(text);
          },
          json: function () {
            try {
              return Promise.resolve(JSON.parse(text));
            } catch (err) {
              return Promise.reject(err);
            }
          }
        });
      }
    });
    send({
      type: 'hello'
    });
  }
  var SANDBOX_CSS = 'html,body{margin:0;padding:0;background:transparent;color:#fff;' + 'font-family:Inter,Roboto,"Segoe UI",Arial,sans-serif;font-size:20px;line-height:1.4}' + 'body{padding:24px 32px;box-sizing:border-box}' + 'button,a,[data-focus]{outline:none}' + 'button{font:inherit;color:#fff;background:rgba(255,255,255,.12);border:0;border-radius:10px;' + 'padding:10px 20px;margin:0 10px 10px 0;cursor:pointer}' + '.focused{background:var(--focus-color,#ff8c00)!important;color:#fff!important;' + 'box-shadow:0 0 0 3px rgba(255,255,255,.45)}' + 'a{color:inherit}';
  function escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function sandboxDocument(u) {
    var csp = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' " + u.origin + "; style-src 'unsafe-inline'; img-src https: data: blob:; media-src https: blob:; font-src https: data:; connect-src 'none'";
    return '<!doctype html><html><head><meta charset="utf-8">' + '<meta http-equiv="Content-Security-Policy" content="' + escAttr(csp) + '">' + '<style>' + SANDBOX_CSS + '</style>' + '<script>(' + sandboxRuntime.toString() + ')();<\/script>' + '</head><body></body></html>';
  }
  function hostLayer() {
    var el = document.getElementById('ext-host');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'ext-host';
    document.body.appendChild(el);
    return el;
  }
  function startPlugin(p) {
    if (running[p.id]) return;
    var u = validPluginUrl(p.url);
    if (!u) {
      p.error = 'Неверная ссылка';
      return;
    }
    var frame = document.createElement('iframe');
    frame.className = 'ext-frame';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('title', 'Расширение ' + (p.name || ''));
    frame.setAttribute('tabindex', '-1');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    var st = {
      id: p.id,
      plugin: p,
      frame: frame,
      url: u,
      data: null,
      dataPromise: dbGet(p.id),
      buttons: [],
      styleEl: null,
      cssParts: [],
      block: '',
      fetching: 0,
      loads: 0,
      ready: false,
      nodes: [null],
      ids: window.WeakMap ? new WeakMap() : null,
      listeners: [],
      undo: [],
      wantsNav: false,
      wantsHome: false
    };
    running[p.id] = st;
    p.error = '';
    frame.addEventListener('load', function () {
      st.loads++;
      if (st.loads > 1) {
        log('плагин ушёл со своей страницы — остановлен:', p.name);
        stopPlugin(p.id);
        p.error = 'Остановлен: попытка перейти по другому адресу';
        renderSettings();
      }
    });
    frame.srcdoc = sandboxDocument(u);
    hostLayer().appendChild(frame);
    log('запуск', p.name || p.url);
  }
  function stopPlugin(id) {
    var st = running[id];
    if (!st) return;
    if (panelPlugin === id) closePanel();
    if (st.saveTimer) {
      clearTimeout(st.saveTimer);
      dbPut(id, st.data);
    }
    if (st.frame && st.frame.parentNode) st.frame.parentNode.removeChild(st.frame);
    if (st.styleEl && st.styleEl.parentNode) st.styleEl.parentNode.removeChild(st.styleEl);
    if (captureOwner === id) captureOwner = null;
    revertDom(st);
    delete running[id];
    renderDetailExtras();
  }
  function stateBySource(win) {
    for (var id in running) {
      if (running.hasOwnProperty(id) && running[id].frame.contentWindow === win) return running[id];
    }
    return null;
  }
  function post(st, msg) {
    if (!st || !st.frame.contentWindow) return;
    msg.__tsx = 1;
    try {
      st.frame.contentWindow.postMessage(msg, '*');
    } catch (e) {}
  }
  function emitTo(st, name, data) {
    if (st.ready) post(st, {
      type: 'event',
      name: name,
      data: data
    });
  }
  function emitAll(name, data) {
    for (var id in running) if (running.hasOwnProperty(id)) emitTo(running[id], name, data);
  }
  var CSS_FORBIDDEN = /\\|url\s*\(|image-set\s*\(|image\s*\(|cross-fade\s*\(|element\s*\(|@import|@namespace|@font-face|expression\s*\(|javascript:|behavior\s*:|-moz-binding|<\/?\s*style/i;
  function cleanCss(css) {
    css = String(css || '');
    if (css.length > CSS_LIMIT) return null;
    if (CSS_FORBIDDEN.test(css)) return null;
    return css;
  }
  function validSelector(sel) {
    sel = String(sel || '');
    if (!sel || sel.length > 500 || /[{}<>\\]/.test(sel)) return false;
    try {
      document.querySelector(sel);
      return true;
    } catch (e) {
      return false;
    }
  }
  var PROTECTED_SEL = '#config-screen, #ext-host, #ext-panel-head, .ext-modal, #osk, script, style, head, input[type="password"]';
  function isProtected(el) {
    if (!el || !el.closest || el.nodeType !== 1) return true;
    return !!el.closest(PROTECTED_SEL);
  }
  var HTML_TAGS = {
    DIV: 1,
    SPAN: 1,
    P: 1,
    B: 1,
    I: 1,
    U: 1,
    S: 1,
    STRONG: 1,
    EM: 1,
    SMALL: 1,
    BR: 1,
    HR: 1,
    UL: 1,
    OL: 1,
    LI: 1,
    H3: 1,
    H4: 1,
    H5: 1,
    IMG: 1,
    TABLE: 1,
    THEAD: 1,
    TBODY: 1,
    TR: 1,
    TD: 1,
    TH: 1
  };
  var RICH_TAGS = {
    BUTTON: 1,
    SECTION: 1,
    HEADER: 1,
    FOOTER: 1,
    NAV: 1,
    ASIDE: 1,
    ARTICLE: 1,
    LABEL: 1,
    H1: 1,
    H2: 1,
    H6: 1,
    FIGURE: 1,
    FIGCAPTION: 1
  };
  var SAFE_ATTR = /^(data-(?!ext$)[\w-]+|aria-[\w-]+|title|role|alt|hidden)$/;
  function cleanStyleAttr(style) {
    var css = cleanCss(style);
    return css && css.length < 1000 ? css : '';
  }
  function cleanNode(src, dst, extId) {
    for (var n = src.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) {
        dst.appendChild(document.createTextNode(n.nodeValue));
        continue;
      }
      if (n.nodeType !== 1) continue;
      var tag = n.tagName.toUpperCase();
      if (!HTML_TAGS[tag] && !(extId && RICH_TAGS[tag])) {
        if (tag !== 'SCRIPT' && tag !== 'STYLE') cleanNode(n, dst, extId);
        continue;
      }
      var el = document.createElement(tag);
      if (extId) {
        el.setAttribute('data-ext', extId);
        for (var a = 0; a < n.attributes.length; a++) {
          var an = n.attributes[a].name.toLowerCase();
          if (SAFE_ATTR.test(an)) el.setAttribute(an, String(n.attributes[a].value).slice(0, 500));
        }
        var nid = n.getAttribute('id');
        if (nid && /^ext-[\w-]{1,60}$/.test(nid)) el.id = nid;
        var ti = n.getAttribute('tabindex');
        if (ti !== null && /^-?\d$/.test(ti)) el.setAttribute('tabindex', ti);
        if (tag === 'BUTTON') el.setAttribute('type', 'button');
      }
      var cls = n.getAttribute('class');
      if (cls) el.setAttribute('class', String(cls).slice(0, 200));
      var style = n.getAttribute('style');
      if (style) {
        var cs = cleanStyleAttr(style);
        if (cs) el.setAttribute('style', cs);
      }
      var title = n.getAttribute('title');
      if (title) el.setAttribute('title', String(title).slice(0, 200));
      if (tag === 'IMG') {
        var s = String(n.getAttribute('src') || '');
        if (!/^https:\/\//i.test(s) && !/^data:image\/(png|jpe?g|gif|webp);/i.test(s)) continue;
        el.setAttribute('src', s);
        el.setAttribute('referrerpolicy', 'no-referrer');
        var alt = n.getAttribute('alt');
        if (alt) el.setAttribute('alt', String(alt).slice(0, 200));
      }
      cleanNode(n, el, extId);
      dst.appendChild(el);
    }
  }
  function cleanHtml(html, extId) {
    html = String(html || '');
    if (html.length > HTML_LIMIT) return null;
    var frag = document.createDocumentFragment();
    try {
      var doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
      cleanNode(doc.body, frag, extId);
    } catch (e) {
      return null;
    }
    return frag;
  }
  var CLICK_ALLOWED = '.home-nav-btn, .catalog-row-card, .catalog-card, .home-cat-tile, .torrent-card, ' + '.search-result-item, .catalog-actor-card, .catalog-recommendation-card, .catalog-episode-card, ' + '#catalog-detail-actions > button:not(#catalog-favorite-btn), .back-btn';
  var QUERY_LIMIT = 500;
  var captureOwner = null;
  function handleOf(st, el) {
    if (st.ids) {
      var known = st.ids.get(el);
      if (known && st.nodes[known] === el) return known;
    } else {
      for (var i = 1; i < st.nodes.length; i++) if (st.nodes[i] === el) return i;
    }
    if (st.nodes.length > 5000) {
      for (var j = 1; j < st.nodes.length; j++) {
        if (st.nodes[j] && !document.documentElement.contains(st.nodes[j])) st.nodes[j] = null;
      }
    }
    var h = st.nodes.length;
    st.nodes.push(el);
    if (st.ids) st.ids.set(el, h);
    return h;
  }
  function nodeOf(st, h) {
    var el = st.nodes[+h];
    if (!el || !document.documentElement.contains(el)) return null;
    return el;
  }
  function isOwn(st, el) {
    return el.getAttribute('data-ext') === st.id;
  }
  function safeUrl(u) {
    u = String(u || '');
    if (/^data:image\//i.test(u)) return u;
    return /^https?:/i.test(u) && !fetchAllowed(u) ? u : '';
  }
  function describe(st, el, opts) {
    opts = opts || {};
    var d = {
      h: handleOf(st, el),
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      cls: typeof el.className === 'string' ? el.className : el.getAttribute('class') || '',
      own: isOwn(st, el),
      focused: el.classList.contains('focused'),
      visible: el.offsetParent !== null || el === document.body
    };
    if (opts.text !== false) d.text = String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    var attrs = {};
    for (var i = 0; i < el.attributes.length; i++) {
      var n = el.attributes[i].name;
      if (SAFE_ATTR.test(n)) attrs[n] = String(el.attributes[i].value).slice(0, 300);
    }
    if (el.tagName === 'IMG') {
      var s = safeUrl(el.getAttribute('src'));
      if (s) attrs.src = s;
    }
    d.attrs = attrs;
    if (opts.rect) {
      var r = el.getBoundingClientRect();
      d.rect = {
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height)
      };
    }
    return d;
  }
  function describeAll(st, list, opts) {
    var out = [];
    var limit = Math.min(+(opts || {}).limit || 200, QUERY_LIMIT);
    for (var i = 0; i < list.length && out.length < limit; i++) {
      if (!isProtected(list[i])) out.push(describe(st, list[i], opts));
    }
    return out;
  }
  function logUndo(st, el, kind, name, old) {
    if (isOwn(st, el)) return;
    st.undo.push({
      el: el,
      kind: kind,
      name: name,
      old: old
    });
    if (st.undo.length > 5000) st.undo.splice(0, 1000);
  }
  function revertDom(st) {
    var own = document.querySelectorAll('[data-ext="' + st.id + '"]');
    for (var i = 0; i < own.length; i++) if (own[i].parentNode) own[i].parentNode.removeChild(own[i]);
    for (var j = st.undo.length - 1; j >= 0; j--) {
      var u = st.undo[j],
        el = u.el;
      try {
        if (u.kind === 'class-add') el.classList.remove(u.name);else if (u.kind === 'class-remove') el.classList.add(u.name);else if (u.kind === 'style') el.style.setProperty(u.name, u.old.v, u.old.p);else if (u.kind === 'attr') {
          if (u.old === null) el.removeAttribute(u.name);else el.setAttribute(u.name, u.old);
        } else if (u.kind === 'text') el.textContent = u.old;
      } catch (e) {}
    }
    st.undo = [];
    st.nodes = [null];
    if (st.ids) st.ids = new WeakMap();
  }
  var CLASS_RE = /^[\w-]{1,60}$/;
  function classList(v) {
    var out = [];
    var parts = String(v || '').split(/\s+/);
    for (var i = 0; i < parts.length; i++) if (CLASS_RE.test(parts[i])) out.push(parts[i]);
    return out;
  }
  function applyUpdate(st, el, ch) {
    var own = isOwn(st, el);
    var leaf = !el.children.length && !/^(INPUT|TEXTAREA|SELECT|OPTION)$/.test(el.tagName);
    if (ch.html != null) {
      if (!own) throw new Error('Разметку можно менять только у своих элементов');
      var frag = cleanHtml(ch.html, st.id);
      if (!frag) throw new Error('Разметка отклонена');
      while (el.firstChild) el.removeChild(el.firstChild);
      el.appendChild(frag);
    } else if (ch.text != null) {
      if (!own && !leaf) throw new Error('Текст можно менять только у элементов без вложенных');
      logUndo(st, el, 'text', null, el.textContent);
      el.textContent = String(ch.text).slice(0, 2000);
    }
    var add = classList(ch.addClass),
      rem = classList(ch.removeClass);
    for (var a = 0; a < add.length; a++) {
      if (!el.classList.contains(add[a])) {
        logUndo(st, el, 'class-add', add[a]);
        el.classList.add(add[a]);
      }
    }
    for (var r = 0; r < rem.length; r++) {
      if (el.classList.contains(rem[r])) {
        logUndo(st, el, 'class-remove', rem[r]);
        el.classList.remove(rem[r]);
      }
    }
    if (ch.style && typeof ch.style === 'object') {
      for (var prop in ch.style) {
        if (!ch.style.hasOwnProperty(prop) || !/^-?[a-z][a-z-]{0,40}$/.test(prop)) continue;
        var val = ch.style[prop] == null ? '' : String(ch.style[prop]);
        var important = /\s*!important\s*$/.test(val) ? 'important' : '';
        val = val.replace(/\s*!important\s*$/, '');
        if (val.length > 300 || CSS_FORBIDDEN.test(val) || /[;{}]/.test(val)) continue;
        logUndo(st, el, 'style', prop, {
          v: el.style.getPropertyValue(prop),
          p: el.style.getPropertyPriority(prop)
        });
        el.style.setProperty(prop, val, important);
      }
    }
    if (ch.attrs && typeof ch.attrs === 'object') {
      for (var name in ch.attrs) {
        if (!ch.attrs.hasOwnProperty(name)) continue;
        var n = String(name).toLowerCase();
        var v = ch.attrs[name];
        var ok = SAFE_ATTR.test(n) || own && n === 'src' && el.tagName === 'IMG' || own && n === 'id' && (v === null || /^ext-[\w-]{1,60}$/.test(v));
        if (!ok) continue;
        if (n === 'src' && v !== null && !/^https:\/\//i.test(v) && !/^data:image\//i.test(v)) continue;
        logUndo(st, el, 'attr', n, el.getAttribute(n));
        if (v === null || v === false) el.removeAttribute(n);else el.setAttribute(n, String(v).slice(0, 500));
      }
    }
    if (typeof window.invalidateFocusCache === 'function') window.invalidateFocusCache();
  }
  function homeState() {
    return window.HomeScreen && HomeScreen.state && HomeScreen.state.built ? HomeScreen.state : null;
  }
  function cardItem(card) {
    var hs = homeState();
    if (!hs || !card) return null;
    for (var i = 0; i < hs.rows.length; i++) {
      var j = hs.rows[i] ? hs.rows[i].indexOf(card) : -1;
      if (j === -1) continue;
      var items = hs.data && hs.data[hs.rowKeys[i]];
      var idx = parseInt(card.getAttribute('data-item-index'), 10);
      var item = items ? items[isNaN(idx) ? j : idx] : null;
      return item && !item.catKey ? detailMeta(item) : null;
    }
    return null;
  }
  function homeData(st) {
    var hs = homeState();
    if (!hs) return {
      ready: false,
      rows: []
    };
    var rows = [];
    for (var i = 0; i < hs.rowEls.length; i++) {
      var rowEl = hs.rowEls[i];
      var titleEl = rowEl && rowEl.querySelector('.catalog-row-title');
      var cards = hs.rows[i] || [];
      var list = [];
      for (var j = 0; j < cards.length; j++) {
        var c = cards[j];
        list.push({
          h: handleOf(st, c),
          title: c.getAttribute('data-title') || String((c.querySelector('.home-tile-label, .catalog-card-title, .torrent-title') || {}).textContent || '').trim(),
          tile: c.classList.contains('home-cat-tile'),
          item: cardItem(c)
        });
      }
      rows.push({
        index: i,
        key: String(hs.rowKeys[i] || ''),
        title: titleEl ? String(titleEl.textContent || '').replace(/\s+/g, ' ').trim() : '',
        h: rowEl ? handleOf(st, rowEl) : null,
        col: hs.rowCols[i] || 0,
        cards: list
      });
    }
    return {
      ready: true,
      activeRow: hs.activeRow,
      rows: rows
    };
  }
  function needNode(st, h) {
    var el = nodeOf(st, h);
    if (!el) throw new Error('Элемента больше нет на странице');
    if (isProtected(el)) throw new Error('Этот элемент расширениям закрыт');
    return el;
  }
  function domCall(st, op, a) {
    switch (op) {
      case 'query':
        {
          if (!validSelector(a.sel)) throw new Error('Неверный селектор');
          var root = a.opts && a.opts.root ? needNode(st, a.opts.root) : document;
          return describeAll(st, root.querySelectorAll(a.sel), a.opts);
        }
      case 'closest':
        {
          if (!validSelector(a.sel)) throw new Error('Неверный селектор');
          var c = needNode(st, a.h).closest(a.sel);
          return c && !isProtected(c) ? describe(st, c) : null;
        }
      case 'children':
        return describeAll(st, needNode(st, a.h).children, {});
      case 'focused':
        {
          var f = document.querySelector('.focused');
          return f && !isProtected(f) ? describe(st, f, {
            rect: true
          }) : null;
        }
      case 'create':
        {
          var parent = a.parent == null ? document.body : typeof a.parent === 'number' ? needNode(st, a.parent) : validSelector(a.parent) ? document.querySelector(a.parent) : null;
          if (!parent || isProtected(parent) && parent !== document.body) throw new Error('Сюда вставлять нельзя');
          var where = a.where;
          if ((where === 'before' || where === 'after') && (!parent.parentNode || parent === document.body || isProtected(parent.parentNode))) {
            throw new Error('Сюда вставлять нельзя');
          }
          var frag = cleanHtml(a.html, st.id);
          if (!frag) throw new Error('Разметка отклонена');
          var first = null;
          for (var n = frag.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) {
            first = n;
            break;
          }
          if (!first) throw new Error('В разметке нет элементов');
          if (where === 'prepend') parent.insertBefore(frag, parent.firstChild);else if (where === 'before') parent.parentNode.insertBefore(frag, parent);else if (where === 'after') parent.parentNode.insertBefore(frag, parent.nextSibling);else parent.appendChild(frag);
          if (typeof window.invalidateFocusCache === 'function') window.invalidateFocusCache();
          return describe(st, first);
        }
      case 'update':
        applyUpdate(st, needNode(st, a.h), a.ch || {});
        return true;
      case 'remove':
        {
          var el = needNode(st, a.h);
          if (!isOwn(st, el)) throw new Error('Удалять можно только свои элементы');
          el.parentNode.removeChild(el);
          if (typeof window.invalidateFocusCache === 'function') window.invalidateFocusCache();
          return true;
        }
      case 'click':
        {
          var t = needNode(st, a.h);
          if (!isOwn(st, t) && !(t.matches && t.matches(CLICK_ALLOWED))) throw new Error('По этому элементу расширению нажимать нельзя');
          t.click();
          return true;
        }
      case 'focus':
        {
          var target = needNode(st, a.h);
          if (target.offsetParent === null) throw new Error('Элемент не виден');
          var s = typeof ScreenStrategies !== 'undefined' && ScreenStrategies[currentScreen()];
          if (s && typeof s.focusItem === 'function') s.focusItem(target);else if (typeof window.focusEl === 'function') window.focusEl(target);
          return true;
        }
      case 'home':
        return homeData(st);
      case 'screen':
        return currentScreen();
      case 'item':
        {
          var card = needNode(st, a.h);
          return cardItem(card) || (card.closest('#detail-view') ? detailMeta(AppState.currentDetailItem) : null);
        }
    }
    throw new Error('Неизвестная операция ' + op);
  }
  function onDocumentClick(e) {
    var t = e.target;
    if (!t || !t.closest || isProtected(t)) return;
    for (var id in running) {
      if (!running.hasOwnProperty(id)) continue;
      var st = running[id];
      for (var i = 0; i < st.listeners.length; i++) {
        var l = st.listeners[i];
        var m = null;
        try {
          m = t.closest(l.sel);
        } catch (err) {}
        if (m && !isProtected(m)) post(st, {
          type: 'dom-event',
          lid: l.lid,
          node: describe(st, m)
        });
      }
    }
  }
  var navTimer = null;
  function emitNav(dir, before, screen) {
    var any = false;
    for (var id in running) if (running.hasOwnProperty(id) && running[id].wantsNav) {
      any = true;
      break;
    }
    if (!any) return;
    if (navTimer) clearTimeout(navTimer);
    navTimer = setTimeout(function () {
      navTimer = null;
      var after = document.querySelector('.focused');
      for (var pid in running) {
        if (!running.hasOwnProperty(pid) || !running[pid].wantsNav) continue;
        var st = running[pid];
        emitTo(st, 'nav', {
          key: dir,
          screen: screen,
          moved: after !== before,
          focused: after && !isProtected(after) ? describe(st, after, {
            rect: true
          }) : null
        });
      }
    }, 60);
  }
  var homeSig = '';
  function pollHome() {
    var any = false;
    for (var id in running) if (running.hasOwnProperty(id) && running[id].wantsHome) {
      any = true;
      break;
    }
    if (!any) return;
    var hs = homeState();
    var sig = '';
    if (hs) {
      var n = 0;
      for (var i = 0; i < hs.rows.length; i++) n += hs.rows[i] ? hs.rows[i].length : 0;
      sig = hs.rowEls.length + ':' + n + ':' + (hs.rowEls[0] ? handleOfGlobal(hs.rowEls[0]) : '');
    }
    if (sig === homeSig) return;
    homeSig = sig;
    if (sig) emitAll('home', {});
  }
  var globalMarks = window.WeakMap ? new WeakMap() : null,
    globalSeq = 0;
  function handleOfGlobal(el) {
    if (!globalMarks) return '';
    if (!globalMarks.has(el)) globalMarks.set(el, ++globalSeq);
    return globalMarks.get(el);
  }
  function hostOf(url) {
    var u = url ? parseUrl(url) : null;
    return u && u.hostname ? String(u.hostname).toLowerCase() : '';
  }
  function isPrivateHost(h) {
    h = String(h || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!h) return true;
    if (h === 'localhost' || /\.(local|localhost|lan|home|internal|intranet)$/.test(h)) return true;
    if (h.indexOf(':') !== -1) {
      if (h === '::' || h === '::1' || /^(fc|fd|fe8|fe9|fea|feb)/.test(h)) return true;
      var m6 = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
      return m6 ? isPrivateHost(m6[1]) : false;
    }
    var m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
    if (!m) return !/\./.test(h);
    var a = +m[1],
      b = +m[2];
    return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a >= 224;
  }
  function deniedHosts() {
    var list = [String(location.hostname || '').toLowerCase()];
    try {
      if (typeof SERVER_URL !== 'undefined') list.push(hostOf(SERVER_URL));
    } catch (e) {}
    var A = window.AppState || {};
    list.push(hostOf(A.currentTorrserverUrl));
    var ts = document.getElementById('torrserver-url');
    if (ts && ts.value) list.push(hostOf(/^https?:/i.test(ts.value) ? ts.value : 'http://' + ts.value));
    return list;
  }
  function fetchAllowed(url) {
    var u = validPluginUrl(url);
    if (!u) return 'Разрешены только адреса http(s)';
    var h = String(u.hostname).toLowerCase();
    if (isPrivateHost(h)) return 'Адреса домашней сети расширениям закрыты';
    var denied = deniedHosts();
    for (var i = 0; i < denied.length; i++) {
      if (denied[i] && denied[i] === h) return 'Сервер TorrStream и TorrServer расширениям закрыты';
    }
    return '';
  }
  var HEADER_FORBIDDEN = /^(cookie|cookie2|host|origin|referer|x-ts-.*|proxy-.*|sec-.*)$/i;
  function doFetch(st, m) {
    function reply(r) {
      r.type = 'fetch';
      r.reqId = m.reqId;
      post(st, r);
    }
    var why = fetchAllowed(m.url);
    if (why) {
      reply({
        error: why
      });
      return;
    }
    if (st.fetching >= FETCH_PARALLEL) {
      reply({
        error: 'Слишком много запросов одновременно'
      });
      return;
    }
    var method = /^(GET|HEAD|POST|PUT|PATCH|DELETE)$/.test(m.method) ? m.method : 'GET';
    var headers = {};
    if (m.headers && typeof m.headers === 'object') {
      for (var k in m.headers) {
        if (m.headers.hasOwnProperty(k) && !HEADER_FORBIDDEN.test(k)) headers[k] = String(m.headers[k]).slice(0, 2000);
      }
    }
    st.fetching++;
    var done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      st.fetching--;
      reply({
        error: 'Нет ответа за ' + FETCH_TIMEOUT_MS / 1000 + ' с'
      });
    }, FETCH_TIMEOUT_MS);
    var opts = {
      method: method,
      headers: headers,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      redirect: method === 'GET' || method === 'HEAD' ? 'follow' : 'error'
    };
    if (m.body != null && method !== 'GET' && method !== 'HEAD') opts.body = String(m.body).slice(0, FETCH_LIMIT);
    fetch(m.url, opts).then(function (res) {
      if (res.url && fetchAllowed(res.url)) throw new Error('Перенаправление на закрытый адрес');
      return res.text().then(function (text) {
        if (text.length > FETCH_LIMIT) text = text.slice(0, FETCH_LIMIT);
        return {
          ok: res.ok,
          status: res.status,
          url: res.url,
          text: text
        };
      });
    }).then(function (r) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      st.fetching--;
      reply(r);
    }, function (err) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      st.fetching--;
      reply({
        error: String(err && err.message || err || 'Ошибка сети')
      });
    });
  }
  function onMessage(e) {
    var m = e.data;
    if (!m || m.__tsx !== 1 || typeof m.type !== 'string') return;
    var st = stateBySource(e.source);
    if (!st) return;
    var p = st.plugin;
    switch (m.type) {
      case 'hello':
        st.dataPromise.then(function (data) {
          st.data = data || {};
          st.ready = true;
          post(st, {
            type: 'init',
            src: st.url.href,
            storage: st.data,
            info: {
              id: p.id,
              appVersion: 1,
              platform: platformName()
            },
            focusColor: focusColor()
          });
          if (lastDetailMeta && currentScreen() === 'detail') emitTo(st, 'detail', lastDetailMeta);
          emitTo(st, 'screen', currentScreen());
        });
        break;
      case 'need-code':
        loadCode(st);
        break;
      case 'call':
        var result,
          error = '';
        try {
          result = domCall(st, String(m.op), m.args || {});
        } catch (err) {
          error = String(err && err.message || err);
        }
        post(st, {
          type: 'call',
          reqId: m.reqId,
          result: result,
          error: error
        });
        break;
      case 'listen':
        if (m.ev !== 'click' || !validSelector(m.sel) || st.listeners.length >= 50) return;
        st.listeners.push({
          lid: m.lid,
          sel: m.sel
        });
        break;
      case 'subscribe':
        if (m.name === 'nav') st.wantsNav = true;
        if (m.name === 'home') {
          st.wantsHome = true;
          homeSig = '';
        }
        break;
      case 'capture':
        if (m.on) {
          if (currentScreen() === 'player' || modal || panelPlugin) return;
          captureOwner = st.id;
        } else if (captureOwner === st.id) {
          captureOwner = null;
        }
        break;
      case 'register':
        if (m.name) p.name = m.name;
        p.version = m.version || '';
        p.description = m.description || '';
        p.settings = !!m.settings;
        saveList();
        renderSettings();
        break;
      case 'error':
        p.error = String(m.message || '').slice(0, 300);
        log('ошибка в «' + (p.name || p.url) + '»:', p.error);
        renderSettings();
        break;
      case 'toast':
        if (typeof window.showToast === 'function') window.showToast((p.name ? p.name + ': ' : '') + m.text);
        break;
      case 'storage':
        if (!st.data) st.data = {};
        if (m.op === 'clear') st.data = {};else if (m.op === 'remove') delete st.data[m.key];else if (m.op === 'set') {
          var prev = st.data[m.key];
          st.data[m.key] = m.value;
          if (JSON.stringify(st.data).length > STORAGE_LIMIT) {
            if (prev === undefined) delete st.data[m.key];else st.data[m.key] = prev;
            p.error = 'Хранилище переполнено (больше ' + Math.round(STORAGE_LIMIT / 1000) + ' КБ)';
            renderSettings();
            return;
          }
        }
        scheduleSave(st);
        break;
      case 'style':
        var css = cleanCss(m.css);
        if (css === null) {
          p.error = 'Стиль отклонён: url(), @import и «\\» запрещены';
          renderSettings();
          return;
        }
        addCss(st, css);
        break;
      case 'hide':
        if (!validSelector(m.selector)) return;
        addCss(st, m.selector + '{display:none!important}');
        break;
      case 'text':
        if (!validSelector(m.selector)) return;
        var els = document.querySelectorAll(m.selector);
        for (var i = 0; i < els.length && i < 50; i++) {
          if (isProtected(els[i]) || els[i].children.length) continue;
          if (/^(INPUT|TEXTAREA|SELECT|OPTION)$/.test(els[i].tagName)) continue;
          els[i].textContent = String(m.text).slice(0, 200);
        }
        break;
      case 'button':
        setButton(st, m);
        break;
      case 'button-remove':
        for (var b = 0; b < st.buttons.length; b++) {
          if (st.buttons[b].id === m.id) {
            st.buttons.splice(b, 1);
            break;
          }
        }
        renderDetailExtras();
        break;
      case 'block':
        st.block = String(m.html || '').slice(0, HTML_LIMIT);
        renderDetailExtras();
        break;
      case 'panel':
        if (m.open) openPanel(st, m.title);else if (panelPlugin === st.id) closePanel();
        break;
      case 'fetch':
        doFetch(st, m);
        break;
    }
  }
  function loadCode(st) {
    if (st.codeRequested) return;
    st.codeRequested = true;
    var src = st.url.href;
    function reply(r) {
      r.type = 'code';
      r.src = src;
      post(st, r);
    }
    var h = String(st.url.hostname).toLowerCase();
    var denied = deniedHosts();
    var devLocal = location.search.indexOf('local=1') !== -1 && st.url.host === location.host && /^\/extensions\/[\w.-]+\.js$/.test(st.url.pathname);
    for (var i = 0; i < denied.length && !devLocal; i++) {
      if (denied[i] && denied[i] === h) {
        reply({
          error: 'С этого адреса расширения не загружаются'
        });
        return;
      }
    }
    fetch(src, {
      credentials: 'omit',
      cache: 'no-cache',
      referrerPolicy: 'no-referrer'
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (text) {
      if (text.length > FETCH_LIMIT) throw new Error('Слишком большой файл');
      reply({
        text: text
      });
    }, function (err) {
      reply({
        error: 'Не удалось загрузить ' + src + ' (' + (err && err.message || err) + ')'
      });
    });
  }
  function addCss(st, css) {
    st.cssParts.push(css);
    if (!st.styleEl) {
      st.styleEl = document.createElement('style');
      st.styleEl.setAttribute('data-ext', st.id);
      if (suspended) st.styleEl.media = 'not all';
      document.head.appendChild(st.styleEl);
    }
    st.styleEl.textContent = st.cssParts.join('\n');
  }
  var ICON_RE = /^[a-z0-9-]{1,40}$/;
  function setButton(st, m) {
    var id = String(m.id || 'main').slice(0, 30);
    var label = String(m.label || st.plugin.name || 'Расширение').slice(0, 30);
    var icon = ICON_RE.test(m.icon) ? m.icon : 'puzzle';
    for (var i = 0; i < st.buttons.length; i++) {
      if (st.buttons[i].id === id) {
        st.buttons[i].label = label;
        st.buttons[i].icon = icon;
        renderDetailExtras();
        return;
      }
    }
    if (st.buttons.length >= MAX_BUTTONS) return;
    st.buttons.push({
      id: id,
      label: label,
      icon: icon
    });
    renderDetailExtras();
  }
  function renderDetailExtras() {
    var row = document.getElementById('catalog-detail-actions');
    if (!row) return;
    var f = document.querySelector('.focused');
    var refocus = f && f.classList.contains('ext-detail-btn') && row.contains(f) ? f.getAttribute('data-ext') + '|' + f.getAttribute('data-ext-button') : '';
    var old = row.querySelectorAll('.ext-detail-btn');
    for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
    var oldBlocks = document.querySelectorAll('.ext-detail-block');
    for (var j = 0; j < oldBlocks.length; j++) oldBlocks[j].parentNode.removeChild(oldBlocks[j]);
    var anchor = row.nextSibling;
    for (var id in running) {
      if (!running.hasOwnProperty(id)) continue;
      var st = running[id];
      for (var b = 0; b < st.buttons.length; b++) {
        var def = st.buttons[b];
        var btn = document.createElement('button');
        btn.className = 'catalog-toggle-overview-btn ext-detail-btn';
        btn.setAttribute('data-label', def.label);
        btn.setAttribute('data-ext', id);
        btn.setAttribute('data-ext-button', def.id);
        btn.innerHTML = '<i class="fi fi-rr-' + def.icon + ' ext-detail-icon"></i>';
        btn.appendChild(document.createTextNode(' ' + def.label));
        btn.addEventListener('click', onDetailButton);
        row.appendChild(btn);
      }
      if (st.block) {
        var frag = cleanHtml(st.block);
        if (frag && frag.childNodes.length) {
          var box = document.createElement('div');
          box.className = 'ext-detail-block';
          box.setAttribute('data-ext', id);
          box.appendChild(frag);
          row.parentNode.insertBefore(box, anchor);
        }
      }
    }
    if (typeof window.invalidateFocusCache === 'function') window.invalidateFocusCache();
    if (refocus) {
      var parts = refocus.split('|');
      var again = row.querySelector('.ext-detail-btn[data-ext="' + parts[0] + '"][data-ext-button="' + parts[1] + '"]');
      var target = again || row.querySelector('button.catalog-watch-btn');
      if (target && typeof window.focusEl === 'function') window.focusEl(target);
    }
  }
  function onDetailButton(e) {
    if (e && e.preventDefault) e.preventDefault();
    var btn = e.currentTarget;
    var st = running[btn.getAttribute('data-ext')];
    if (!st) return;
    panelReturnFocus = btn;
    var item = window.AppState ? detailMeta(AppState.currentDetailItem) : null;
    if (item) lastDetailMeta = item;
    emitTo(st, 'button', {
      id: btn.getAttribute('data-ext-button'),
      item: lastDetailMeta
    });
  }
  function detailMeta(item) {
    if (!item || item.isYoutube) return null;
    var title = typeof getCatalogItemTitle === 'function' ? getCatalogItemTitle(item) : item.title || item.name || '';
    if (title === 'Без названия') title = '';
    var year = typeof getCatalogItemYear === 'function' ? getCatalogItemYear(item) : null;
    if (!year) {
      var date = String(item.release_date || item.first_air_date || item.year || '');
      var ym = /(19|20)\d{2}/.exec(date);
      year = ym ? ym[0] : null;
    }
    var poster = item.poster_path || item.poster || null;
    if (poster && !/^https?:/i.test(poster)) poster = 'https://image.tmdb.org/t/p/w342' + poster;
    if (poster) poster = String(poster).replace(/^http:\/\/image\.tmdb\.org\//i, 'https://image.tmdb.org/');
    if (poster && !/^https:/i.test(poster)) poster = null;
    var tmdbId = item.tmdbId || item.tmdb_id || (item.hash ? null : item.id) || null;
    return {
      tmdbId: tmdbId ? String(tmdbId) : null,
      type: item.media_type === 'tv' || !item.media_type && (item.first_air_date || item.name) ? 'tv' : 'movie',
      title: String(title || '').slice(0, 300),
      originalTitle: String(item.original_title || item.original_name || '').slice(0, 300),
      year: year ? +year : null,
      poster: poster,
      vote: typeof item.vote_average === 'number' ? item.vote_average : null,
      torrent: !!item.hash
    };
  }
  var lastScreen = null,
    lastItem = null,
    lastDetailMeta = null;
  function currentScreen() {
    return window.AppState && AppState.currentScreen || '';
  }
  function poll() {
    var s = currentScreen();
    suspendInSettings(s === 'config');
    if (s !== lastScreen) {
      lastScreen = s;
      emitAll('screen', s);
      if (panelPlugin && s === 'player') closePanel();
      if (captureOwner) {
        var owner = running[captureOwner];
        captureOwner = null;
        if (owner) emitTo(owner, 'key', 'back');
      }
    }
    var item = window.AppState ? AppState.currentDetailItem : null;
    if (item !== lastItem) {
      lastItem = item;
      lastDetailMeta = detailMeta(item);
      if (lastDetailMeta && s === 'detail') emitAll('detail', lastDetailMeta);
      if (hasDetailExtras() && !document.querySelector('#catalog-detail-actions .ext-detail-btn')) renderDetailExtras();
    }
  }
  function hasDetailExtras() {
    for (var id in running) if (running.hasOwnProperty(id) && (running[id].buttons.length || running[id].block)) return true;
    return false;
  }
  function panelHead() {
    var head = document.getElementById('ext-panel-head');
    if (head) return head;
    head = document.createElement('div');
    head.id = 'ext-panel-head';
    head.className = 'ext-panel-head';
    head.innerHTML = '<span class="ext-panel-title"></span><span class="ext-panel-hint">«Назад» — закрыть</span>' + '<span class="ext-panel-close" role="button" aria-label="Закрыть">✕</span>';
    head.querySelector('.ext-panel-close').addEventListener('click', closePanel);
    document.body.appendChild(head);
    return head;
  }
  function openPanel(st, title) {
    if (currentScreen() === 'player') return;
    if (panelPlugin && panelPlugin !== st.id) closePanel();
    panelPlugin = st.id;
    if (!panelReturnFocus) panelReturnFocus = document.querySelector('.focused');
    var head = panelHead();
    head.querySelector('.ext-panel-title').textContent = 'Расширение «' + (st.plugin.name || nameFromUrl(st.plugin.url)) + '»' + (title ? ' — ' + title : '');
    head.classList.add('open');
    st.frame.classList.add('open');
    document.documentElement.classList.add('ext-panel-open');
    emitTo(st, 'panel', {
      open: true
    });
  }
  function closePanel() {
    var id = panelPlugin;
    if (!id) return;
    panelPlugin = null;
    var st = running[id];
    var head = document.getElementById('ext-panel-head');
    if (head) head.classList.remove('open');
    if (st) {
      st.frame.classList.remove('open');
      emitTo(st, 'panel', {
        open: false
      });
    }
    document.documentElement.classList.remove('ext-panel-open');
    var back = panelReturnFocus;
    panelReturnFocus = null;
    if (back && back.isConnected !== false && back.offsetParent !== null && typeof window.focusEl === 'function') window.focusEl(back);
  }
  function onKeyDown(e) {
    var k = e.keyCode || e.which;
    if (modal) {
      onModalKey(e, k);
      return;
    }
    if (holdKeyDown(e, k)) return;
    var dir = null;
    if (typeof isBackKey === 'function' && isBackKey(k)) dir = 'back';else if (typeof isArrowKey === 'function' && isArrowKey(k)) dir = arrowDir(k);else if (typeof isOkKey === 'function' && isOkKey(k)) dir = 'enter';
    if (!dir) return;
    if (window.OSK && OSK.isOpen && OSK.isOpen()) return;
    if (panelPlugin) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (dir === 'back') {
        closePanel();
        return;
      }
      if (running[panelPlugin]) emitTo(running[panelPlugin], 'key', dir);
      return;
    }
    var screen = currentScreen();
    if (captureOwner) {
      var cst = running[captureOwner];
      if (!cst || screen === 'player') {
        captureOwner = null;
      } else {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (dir === 'back') captureOwner = null;
        emitTo(cst, 'key', dir);
        return;
      }
    }
    if (dir === 'back' || screen === 'player' || screen === 'config') return;
    var a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
    emitNav(dir, document.querySelector('.focused'), screen);
  }
  function platformName() {
    try {
      if (typeof detectPlatform === 'function') return String(detectPlatform());
    } catch (e) {}
    return '';
  }
  function focusColor() {
    try {
      if (window.UICustomizer && UICustomizer.getFocusColor) return UICustomizer.getFocusColor();
    } catch (e) {}
    return '#ff8c00';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function setStatus(text, isError) {
    var el = document.getElementById('extensions-status');
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || '';
    el.classList.toggle('is-error', !!isError);
  }
  var TILE_COLORS = ['#2b7fff', '#ff4d5e', '#8e5cf7', '#16a37a', '#f08a24', '#e0447c', '#1fa0c4', '#6b7a8f'];
  function tileColor(name) {
    var h = 0;
    name = String(name || '');
    for (var i = 0; i < name.length; i++) h = h * 31 + name.charCodeAt(i) >>> 0;
    return TILE_COLORS[h % TILE_COLORS.length];
  }
  function tileIcon(name) {
    var letter = String(name || '?').replace(/^[^0-9A-Za-zА-Яа-яЁё]+/, '').charAt(0).toUpperCase() || '?';
    return '<span class="ext-tile-icon" style="background-color:' + tileColor(name) + '">' + esc(letter) + '</span>';
  }
  function pluginTitle(p) {
    return p.name || nameFromUrl(p.url);
  }
  function tileName(name) {
    return '<span class="ext-tile-name marquee-text"><span>' + esc(name) + '</span></span>';
  }
  function renderSettings() {
    var box = document.getElementById('extensions-installed');
    if (!box) return;
    var f = document.querySelector('.focused');
    var focusId = f && box.contains(f) ? f.getAttribute('data-ext-id') || 'add' : '';
    var html = '<button class="settings-chip ext-tile add" data-ext-add="1">' + '<span class="ext-tile-box"><span class="ext-plus">+</span></span>' + tileName('Добавить') + '</button>';
    for (var i = 0; i < plugins.length; i++) {
      var p = plugins[i];
      var sub = p.error ? '⚠ Ошибка' : p.enabled ? p.version ? 'Версия ' + p.version : 'Включено' : 'Выключено';
      html += '<button class="settings-chip ext-tile' + (p.enabled ? '' : ' is-off') + (p.error ? ' has-error' : '') + '" data-ext-id="' + esc(p.id) + '" title="' + esc(p.description || p.url) + '">' + '<span class="ext-tile-box">' + tileIcon(pluginTitle(p)) + '<span class="ext-tile-sub">' + esc(sub) + '</span>' + '<span class="ext-holdbar"><i></i></span></span>' + tileName(pluginTitle(p)) + '</button>';
    }
    box.innerHTML = html;
    renderCatalog();
    if (typeof window.invalidateFocusCache === 'function') window.invalidateFocusCache();
    if (focusId && !modal && typeof window.focusEl === 'function') {
      var again = focusId === 'add' ? box.querySelector('[data-ext-add]') : box.querySelector('[data-ext-id="' + focusId + '"]');
      window.focusEl(again || box.querySelector('[data-ext-add]'));
    }
  }
  function renderCatalog() {
    var box = document.getElementById('extensions-catalog');
    if (!box) return;
    if (!catalogCache) {
      box.innerHTML = '<p class="settings-lead">Загрузка…</p>';
      return;
    }
    if (!catalogCache.length) {
      box.innerHTML = '<p class="settings-lead">Каталог недоступен.</p>';
      return;
    }
    var f = document.querySelector('.focused');
    var focusIdx = f && box.contains(f) ? f.getAttribute('data-ext-catalog') : null;
    var html = '';
    for (var i = 0; i < catalogCache.length; i++) {
      var c = catalogCache[i];
      var installed = !!findPlugin(pluginIdFor(c.url));
      html += '<button class="settings-chip ext-tile' + (installed ? ' is-installed' : '') + '" data-ext-catalog="' + i + '" title="' + esc(c.description) + '">' + '<span class="ext-tile-box">' + tileIcon(c.name) + '<span class="ext-tile-sub">' + (installed ? '✓ Установлено' : 'Установить') + '</span></span>' + tileName(c.name) + '</button>';
    }
    box.innerHTML = html;
    if (focusIdx !== null && typeof window.focusEl === 'function') {
      var again = box.querySelector('[data-ext-catalog="' + focusIdx + '"]');
      if (again) window.focusEl(again);
    }
  }
  function loadCatalog() {
    fetch(mirrorBase() + 'extensions/catalog.json', {
      cache: 'no-cache',
      credentials: 'omit'
    }).then(function (r) {
      return r.ok ? r.json() : [];
    }).then(function (list) {
      var out = [];
      list = list && list.plugins ? list.plugins : list;
      for (var i = 0; list && i < list.length; i++) {
        var c = list[i];
        if (!c || !c.url || !c.name) continue;
        var url = /^https?:/i.test(c.url) ? c.url : parseUrl(mirrorBase() + 'extensions/' + c.url).href;
        out.push({
          name: String(c.name),
          description: String(c.description || ''),
          url: url
        });
      }
      catalogCache = out;
    }, function () {
      catalogCache = [];
    }).then(renderCatalog);
  }
  function normalizeUrl(url) {
    url = String(url || '').trim();
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
    var u = validPluginUrl(url);
    return u ? u.href : '';
  }
  function install(url, meta) {
    var href = normalizeUrl(url);
    if (!href) return 'Нужна ссылка на файл расширения вида https://…/plugin.js';
    var id = pluginIdFor(href);
    if (findPlugin(id)) return 'Это расширение уже установлено';
    var p = {
      id: id,
      url: href,
      enabled: true,
      name: meta && meta.name || nameFromUrl(href),
      description: meta && meta.description || '',
      version: ''
    };
    plugins.push(p);
    saveList();
    if (!noExtensions()) startPlugin(p);
    setStatus('Установлено: ' + p.name);
    renderSettings();
    return '';
  }
  function uninstall(id) {
    var p = findPlugin(id);
    stopPlugin(id);
    for (var i = 0; i < plugins.length; i++) {
      if (plugins[i].id === id) {
        plugins.splice(i, 1);
        break;
      }
    }
    saveList();
    dbPut(id, null);
    setStatus(p ? 'Удалено: ' + pluginTitle(p) : '');
    renderSettings();
  }
  function setEnabled(id, on) {
    var p = findPlugin(id);
    if (!p) return;
    p.enabled = !!on;
    saveList();
    if (on) {
      if (!noExtensions()) startPlugin(p);
    } else {
      stopPlugin(id);
      p.error = '';
    }
    renderSettings();
  }
  function disableAll() {
    var n = 0;
    for (var i = 0; i < plugins.length; i++) {
      if (!plugins[i].enabled) continue;
      plugins[i].enabled = false;
      stopPlugin(plugins[i].id);
      n++;
    }
    saveList();
    renderSettings();
    setStatus(n ? 'Выключено расширений: ' + n + '. Включить — ОК на плитке' : 'Включённых расширений нет');
  }
  var suspended = null;
  function suspendInSettings(on) {
    if (on && !suspended) {
      suspended = [];
      for (var id in running) {
        if (running.hasOwnProperty(id) && running[id].styleEl) running[id].styleEl.media = 'not all';
      }
      var own = document.querySelectorAll('[data-ext]');
      for (var i = 0; i < own.length; i++) {
        if (own[i].closest('#ext-host') || own[i].tagName === 'STYLE') continue;
        suspended.push([own[i], own[i].style.cssText]);
        own[i].style.setProperty('display', 'none', 'important');
      }
    } else if (!on && suspended) {
      for (var rid in running) {
        if (running.hasOwnProperty(rid) && running[rid].styleEl) running[rid].styleEl.media = '';
      }
      for (var j = 0; j < suspended.length; j++) suspended[j][0].style.cssText = suspended[j][1];
      suspended = null;
    }
  }
  function openPluginSettings(id, from) {
    var st = running[id];
    if (!st) {
      setStatus('Расширение не запущено', true);
      return;
    }
    panelReturnFocus = from || null;
    emitTo(st, 'settings', {});
  }
  var modal = null;
  function modalFocusables() {
    if (!modal) return [];
    var all = modal.el.querySelectorAll('input, button');
    var out = [];
    for (var i = 0; i < all.length; i++) if (all[i].offsetParent !== null && !all[i].disabled) out.push(all[i]);
    return out;
  }
  function modalFocus(el) {
    var cur = document.querySelectorAll('.focused');
    for (var i = 0; i < cur.length; i++) cur[i].classList.remove('focused');
    if (el) el.classList.add('focused');
  }
  function modalMove(dir) {
    var list = modalFocusables();
    var c = modal.el.querySelector('.focused');
    if (!c) {
      modalFocus(list[0]);
      return;
    }
    var r = c.getBoundingClientRect(),
      cx = r.left + r.width / 2,
      cy = r.top + r.height / 2;
    var best = null,
      bestScore = Infinity;
    for (var i = 0; i < list.length; i++) {
      if (list[i] === c) continue;
      var q = list[i].getBoundingClientRect();
      var dx = q.left + q.width / 2 - cx,
        dy = q.top + q.height / 2 - cy;
      var ok = dir === 'up' ? dy < -4 : dir === 'down' ? dy > 4 : dir === 'left' ? dx < -4 && Math.abs(dy) < 4 : dx > 4 && Math.abs(dy) < 4;
      if (!ok) continue;
      var score = dir === 'up' || dir === 'down' ? Math.abs(dy) + Math.abs(dx) * 0.2 : Math.abs(dx);
      if (score < bestScore) {
        bestScore = score;
        best = list[i];
      }
    }
    if (best) modalFocus(best);
  }
  function openModal(html, returnFocus) {
    closeModal(true);
    var el = document.createElement('div');
    el.className = 'ext-modal';
    el.innerHTML = '<div class="ext-modal-box">' + html + '</div>';
    el.addEventListener('click', function (e) {
      if (e.target === el) closeModal();
    });
    var host = typeof window.getOverlayHost === 'function' ? window.getOverlayHost() : document.body;
    host.appendChild(el);
    modal = {
      el: el,
      returnFocus: returnFocus || document.querySelector('.focused')
    };
    modalFocus(modalFocusables()[0]);
    return el;
  }
  function closeModal(silent) {
    if (!modal) return;
    var m = modal;
    modal = null;
    if (window.OSK && OSK.isOpen && OSK.isOpen()) OSK.close(false);
    if (m.el.parentNode) m.el.parentNode.removeChild(m.el);
    if (!silent && m.returnFocus && m.returnFocus.isConnected !== false && typeof window.focusEl === 'function') {
      window.focusEl(m.returnFocus);
    }
  }
  function showAddModal(from) {
    var el = openModal('<h3>Добавить расширение</h3>' + '<label class="ext-modal-label">Ссылка на расширение</label>' + '<input type="text" class="text-input ext-modal-input" id="ext-add-url" placeholder="https://…/plugin.js" autocomplete="off" spellcheck="false">' + '<label class="ext-modal-label">Наименование <span class="ext-modal-opt">— необязательно, иначе возьмётся из расширения</span></label>' + '<input type="text" class="text-input ext-modal-input" id="ext-add-name" placeholder="Например: Посмотреть позже" autocomplete="off">' + '<div class="ext-modal-error" hidden></div>' + '<p class="ext-modal-note">Расширение работает в песочнице: паролей, входа в учётку и адресов серверов оно не видит. Но открытые вами фильмы видит — ставьте только то, чему доверяете.</p>' + '<div class="ext-modal-actions">' + '<button class="ext-modal-btn primary" data-act="save">Сохранить</button>' + '<button class="ext-modal-btn" data-act="cancel">Отмена</button></div>', from);
    el.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!b) return;
      if (b.getAttribute('data-act') === 'cancel') {
        closeModal();
        return;
      }
      var url = el.querySelector('#ext-add-url').value;
      var name = el.querySelector('#ext-add-name').value.trim();
      var err = install(url, name ? {
        name: name
      } : null);
      if (err) {
        var box = el.querySelector('.ext-modal-error');
        box.textContent = err;
        box.hidden = false;
        return;
      }
      closeModal(true);
      focusTile(pluginIdFor(normalizeUrl(url)));
    });
  }
  function showPluginMenu(id, from) {
    var p = findPlugin(id);
    if (!p) return;
    var info = p.error ? '<p class="ext-modal-error">⚠ ' + esc(p.error) + '</p>' : p.description ? '<p class="ext-modal-desc">' + esc(p.description) + '</p>' : '';
    var el = openModal('<div class="ext-modal-head">' + tileIcon(pluginTitle(p)) + '<div><h3>' + esc(pluginTitle(p)) + '</h3>' + '<div class="ext-modal-url">' + esc(p.url) + (p.version ? ' · версия ' + esc(p.version) : '') + '</div></div></div>' + info + '<div class="ext-modal-actions">' + (p.enabled && p.settings && running[id] ? '<button class="ext-modal-btn primary" data-act="open">Открыть</button>' : '') + '<button class="ext-modal-btn' + (p.enabled ? '' : ' primary') + '" data-act="toggle">' + (p.enabled ? 'Выключить' : 'Включить') + '</button>' + '<button class="ext-modal-btn danger" data-act="remove">Удалить</button>' + '<button class="ext-modal-btn" data-act="cancel">Отмена</button></div>', from);
    el.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'cancel') {
        closeModal();
        return;
      }
      if (act === 'remove') {
        if (!b.classList.contains('armed')) {
          b.classList.add('armed');
          b.textContent = 'Точно удалить?';
          return;
        }
        closeModal(true);
        uninstall(id);
        focusTile('add');
        return;
      }
      if (act === 'toggle') {
        closeModal(true);
        setEnabled(id, !p.enabled);
        focusTile(id);
        return;
      }
      if (act === 'open') {
        closeModal(true);
        focusTile(id);
        openPluginSettings(id, document.querySelector('.focused'));
      }
    });
  }
  function focusTile(id) {
    var box = document.getElementById('extensions-installed');
    if (!box || typeof window.focusEl !== 'function') return;
    var t = id === 'add' ? null : box.querySelector('[data-ext-id="' + id + '"]');
    window.focusEl(t || box.querySelector('[data-ext-add]'));
  }
  function onModalKey(e, k) {
    var a = document.activeElement;
    var typing = a && a.tagName === 'INPUT' && modal.el.contains(a);
    var dir = null;
    if (typeof isBackKey === 'function' && isBackKey(k)) dir = 'back';else if (typeof isArrowKey === 'function' && isArrowKey(k)) dir = arrowDir(k);else if (typeof isOkKey === 'function' && isOkKey(k)) dir = 'enter';
    if (!dir) return;
    if (typing && (dir === 'left' || dir === 'right')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (typing) {
      try {
        a.blur();
      } catch (err) {}
      if (dir === 'up' || dir === 'down') modalMove(dir);
      return;
    }
    if (dir === 'back') {
      closeModal();
      return;
    }
    if (dir === 'enter') {
      var c = modal.el.querySelector('.focused');
      if (!c) return;
      if (c.tagName === 'INPUT') {
        try {
          c.focus();
        } catch (err) {}
      } else c.click();
      return;
    }
    modalMove(dir);
  }
  var HOLD_MS = 1200;
  var hold = null;
  function holdStart(tile) {
    holdCancel();
    hold = {
      tile: tile,
      id: tile.getAttribute('data-ext-id')
    };
    tile.classList.add('holding');
    hold.timer = setTimeout(function () {
      var h = hold;
      hold = null;
      if (!h) return;
      if (h.release) clearTimeout(h.release);
      h.tile.classList.remove('holding');
      h.tile.classList.add('removing');
      swallowOk = true;
      setTimeout(function () {
        uninstall(h.id);
        focusTile('add');
      }, 180);
    }, HOLD_MS);
  }
  function holdCancel() {
    if (!hold) return;
    clearTimeout(hold.timer);
    if (hold.release) clearTimeout(hold.release);
    hold.tile.classList.remove('holding');
    hold = null;
  }
  var swallowOk = false,
    swallowTimer = null;
  function holdKeyDown(e, k) {
    if (typeof isOkKey !== 'function' || !isOkKey(k)) return false;
    if (swallowOk) {
      if (swallowTimer) {
        clearTimeout(swallowTimer);
        swallowTimer = null;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      return true;
    }
    if (currentScreen() !== 'config') return false;
    var f = document.querySelector('.focused');
    if (!f || !f.classList.contains('ext-tile') || !f.hasAttribute('data-ext-id')) return false;
    if (typeof isAppleRemote === 'function' && isAppleRemote()) return false;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (hold && hold.tile === f) {
      if (hold.release) {
        clearTimeout(hold.release);
        hold.release = null;
      }
      return true;
    }
    holdStart(f);
    return true;
  }
  function onKeyUp(e) {
    var k = e.keyCode || e.which;
    if (typeof isOkKey !== 'function' || !isOkKey(k)) return;
    if (swallowOk) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (swallowTimer) clearTimeout(swallowTimer);
      swallowTimer = setTimeout(function () {
        swallowOk = false;
        swallowTimer = null;
      }, 250);
      return;
    }
    if (!hold) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (hold.release) return;
    hold.release = setTimeout(function () {
      var h = hold;
      if (!h) return;
      holdCancel();
      showPluginMenu(h.id, h.tile);
    }, 180);
  }
  function onSettingsClick(e) {
    var t = e.target;
    var btn = t && t.closest ? t.closest('button') : null;
    if (!btn || modal) return;
    if (btn.hasAttribute('data-ext-add')) {
      showAddModal(btn);
      return;
    }
    if (btn.hasAttribute('data-ext-id')) {
      showPluginMenu(btn.getAttribute('data-ext-id'), btn);
      return;
    }
    if (btn.hasAttribute('data-ext-catalog')) {
      var c = catalogCache && catalogCache[+btn.getAttribute('data-ext-catalog')];
      if (!c) return;
      var id = pluginIdFor(normalizeUrl(c.url));
      if (findPlugin(id)) {
        showPluginMenu(id, btn);
        return;
      }
      var err = install(c.url, c);
      if (err) setStatus(err, true);
    }
  }
  function keepTileVisible(tile) {
    if (typeof window.scrollRowToCard === 'function') window.scrollRowToCard(tile);
  }
  function watchTileFocus(row) {
    if (!row || !window.MutationObserver) return;
    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var t = list[i].target;
        if (t.parentNode === row && t.classList.contains('focused')) {
          keepTileVisible(t);
          return;
        }
      }
    }).observe(row, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    });
  }
  function setupSettings() {
    var tab = document.getElementById('extensions-tab-content');
    if (!tab) return;
    watchTileFocus(document.getElementById('extensions-installed'));
    var offAll = document.getElementById('extensions-disable-all');
    if (offAll) offAll.addEventListener('click', disableAll);
    watchTileFocus(document.getElementById('extensions-catalog'));
    tab.addEventListener('click', onSettingsClick);
    window.addEventListener('keyup', onKeyUp, true);
    if (noExtensions()) setStatus('Расширения отключены: в адресе страницы ?noext=1', true);
    renderSettings();
    var loaded = false;
    function lazy() {
      if (!loaded && tab.style.display !== 'none') {
        loaded = true;
        loadCatalog();
      }
    }
    if (window.MutationObserver) {
      new MutationObserver(lazy).observe(tab, {
        attributes: true,
        attributeFilter: ['style']
      });
    } else {
      loadCatalog();
    }
  }
  function noExtensions() {
    return /[?&]noext=1/.test(location.search);
  }
  function start() {
    loadList();
    setupSettings();
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('message', onMessage);
    if (noExtensions()) {
      log('отключены (?noext=1)');
      return;
    }
    var any = false;
    for (var i = 0; i < plugins.length; i++) {
      if (plugins[i].enabled) {
        any = true;
        break;
      }
    }
    setTimeout(function () {
      for (var j = 0; j < plugins.length; j++) if (plugins[j].enabled) startPlugin(plugins[j]);
    }, any ? START_DELAY_MS : 0);
    setInterval(function () {
      if (hasRunning()) {
        poll();
        pollHome();
      }
    }, POLL_MS);
    document.addEventListener('click', onDocumentClick, true);
  }
  function hasRunning() {
    for (var id in running) if (running.hasOwnProperty(id)) return true;
    return false;
  }
  window.Extensions = {
    install: install,
    uninstall: uninstall,
    setEnabled: setEnabled,
    list: function () {
      return JSON.parse(JSON.stringify(plugins));
    },
    closePanel: closePanel,
    isPanelOpen: function () {
      return !!panelPlugin;
    },
    _fetchAllowed: fetchAllowed,
    _running: function () {
      return running;
    },
    _cleanCss: cleanCss
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);else start();
})();
