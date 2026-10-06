/* Сборка для старых браузеров (Chrome 53) из js/../tools/legacy-build/polyfills.js — tools/legacy-build/build.js. Руками не править. */
/*
 * Заглушки для старых браузеров (webOS 4 — Chrome 53).
 *
 * Подключается ТОЛЬКО там, где не разбирается async/await (index.html,
 * LEGACY_JS), первым из скриптов приложения. Каждая заглушка ставится, только
 * если своего у браузера нет. Синтаксис — ES5.
 *
 * Собирается в public/js-legacy/legacy-polyfills.js (tools/legacy-build/build.js).
 * Его же подтягивают воркеры (importScripts) — поэтому всё через G, а не
 * window, и DOM-части под проверками typeof.
 */
(function () {
  'use strict';
  var G = typeof self !== 'undefined' ? self : window;

  function define(obj, name, value) {
    if (obj && !(name in obj)) {
      Object.defineProperty(obj, name, { value: value, configurable: true, writable: true });
    }
  }

  if (typeof G.globalThis === 'undefined') G.globalThis = G;

  // ---- Promise.prototype.finally (Chrome 63) ----
  if (typeof Promise !== 'undefined') {
    define(Promise.prototype, 'finally', function (fn) {
      var P = this.constructor || Promise;
      return this.then(
        function (v) { return P.resolve(fn && fn()).then(function () { return v; }); },
        function (e) { return P.resolve(fn && fn()).then(function () { throw e; }); }
      );
    });
  }

  // ---- Object.values / Object.entries (Chrome 54) ----
  define(Object, 'values', function (o) {
    return Object.keys(o).map(function (k) { return o[k]; });
  });
  define(Object, 'entries', function (o) {
    return Object.keys(o).map(function (k) { return [k, o[k]]; });
  });

  // ---- String.prototype.padStart / padEnd (Chrome 57) ----
  function pad(str, len, fill, atStart) {
    str = String(str);
    len = len >> 0;
    fill = fill === undefined ? ' ' : String(fill);
    if (str.length >= len || !fill) return str;
    var need = len - str.length;
    while (fill.length < need) fill += fill;
    fill = fill.slice(0, need);
    return atStart ? fill + str : str + fill;
  }
  define(String.prototype, 'padStart', function (len, fill) { return pad(this, len, fill, true); });
  define(String.prototype, 'padEnd', function (len, fill) { return pad(this, len, fill, false); });

  // ---- Array/String .at (Chrome 92) ----
  function at(i) {
    i = Math.trunc ? Math.trunc(i) || 0 : (i >> 0);
    if (i < 0) i += this.length;
    return i < 0 || i >= this.length ? undefined : this[i];
  }
  define(Array.prototype, 'at', at);
  define(String.prototype, 'at', function (i) { return at.call(String(this), i); });

  // ---- Node.isConnected (Chrome 54) ----
  // Без неё !img.isConnected всегда true — постеры не вставлялись вовсе
  if (typeof Node !== 'undefined' && !('isConnected' in Node.prototype)) {
    Object.defineProperty(Node.prototype, 'isConnected', {
      configurable: true,
      get: function () {
        var doc = this.ownerDocument || document;
        return this === doc || doc.documentElement.contains(this);
      }
    });
  }

  // ---- IntersectionObserverEntry.isIntersecting (Chrome 58) ----
  if (typeof IntersectionObserverEntry !== 'undefined' &&
      !('isIntersecting' in IntersectionObserverEntry.prototype)) {
    Object.defineProperty(IntersectionObserverEntry.prototype, 'isIntersecting', {
      configurable: true,
      get: function () { return this.intersectionRatio > 0; }
    });
  }

  // ---- Element.scrollTo / scrollBy (Chrome 61) ----
  if (typeof Element !== 'undefined') {
    define(Element.prototype, 'scrollTo', function (a, b) {
      if (a && typeof a === 'object') {
        if (a.left !== undefined) this.scrollLeft = a.left;
        if (a.top !== undefined) this.scrollTop = a.top;
      } else {
        this.scrollLeft = a;
        this.scrollTop = b;
      }
    });
    define(Element.prototype, 'scrollBy', function (a, b) {
      if (a && typeof a === 'object') {
        this.scrollLeft += a.left || 0;
        this.scrollTop += a.top || 0;
      } else {
        this.scrollLeft += a || 0;
        this.scrollTop += b || 0;
      }
    });
  }

  // ---- addEventListener(…, { once: true }) (Chrome 55) ----
  // Объект параметров Chrome 53 понимает, но once пропускает — обработчик
  // срабатывал бы каждый раз. Оборачиваем: обёртку снимаем после первого вызова
  // и находим её же в removeEventListener.
  (function () {
    var onceSupported = false;
    try {
      var probe = {};
      Object.defineProperty(probe, 'once', { get: function () { onceSupported = true; return false; } });
      G.addEventListener('legacy-once-probe', null, probe);
    } catch (e) { }
    if (onceSupported || typeof EventTarget === 'undefined') return;

    var proto = EventTarget.prototype;
    var add = proto.addEventListener, remove = proto.removeEventListener;
    var KEY = '__legacyOnce';
    function capture(o) { return !!(o && typeof o === 'object' ? o.capture : o); }

    proto.addEventListener = function (type, fn, options) {
      if (!fn || !options || typeof options !== 'object' || !options.once) {
        return add.call(this, type, fn, options);
      }
      var target = this, cap = capture(options);
      var wrapper = function (ev) {
        remove.call(target, type, wrapper, cap);
        if (fn[KEY]) delete fn[KEY][type + (cap ? '1' : '0')];
        return typeof fn === 'function' ? fn.call(this, ev) : fn.handleEvent(ev);
      };
      (fn[KEY] = fn[KEY] || {})[type + (cap ? '1' : '0')] = wrapper;
      return add.call(this, type, wrapper, cap);
    };
    proto.removeEventListener = function (type, fn, options) {
      var cap = capture(options);
      var map = fn && fn[KEY], w = map && map[type + (cap ? '1' : '0')];
      if (w) { delete map[type + (cap ? '1' : '0')]; remove.call(this, type, w, cap); }
      return remove.call(this, type, fn, options);
    };
  })();

  // ---- AbortController (Chrome 66) + fetch с signal ----
  // Свой fetch Chrome 53 запрос не прерывает, но промис отклоняем сразу с
  // AbortError — код ждёт именно этого (и проверяет signal.aborted).
  if (typeof G.AbortController === 'undefined') {
    var AbortSignal = function () {
      this.aborted = false;
      this.onabort = null;
      this._listeners = [];
    };
    AbortSignal.prototype.addEventListener = function (type, fn) {
      if (type === 'abort' && fn) this._listeners.push(fn);
    };
    AbortSignal.prototype.removeEventListener = function (type, fn) {
      if (type !== 'abort') return;
      var i = this._listeners.indexOf(fn);
      if (i !== -1) this._listeners.splice(i, 1);
    };
    AbortSignal.prototype.dispatchEvent = function (ev) {
      var list = this._listeners.slice();
      if (typeof this.onabort === 'function') this.onabort(ev);
      for (var i = 0; i < list.length; i++) {
        try { typeof list[i] === 'function' ? list[i].call(this, ev) : list[i].handleEvent(ev); } catch (e) { setTimeout(function () { throw e; }); }
      }
      return true;
    };
    AbortSignal.prototype.throwIfAborted = function () {
      if (this.aborted) throw this.reason;
    };

    var makeAbortError = function () {
      var e;
      try { e = new DOMException('The operation was aborted.', 'AbortError'); }
      catch (x) { e = new Error('The operation was aborted.'); e.name = 'AbortError'; }
      return e;
    };

    var AbortController = function () { this.signal = new AbortSignal(); };
    AbortController.prototype.abort = function (reason) {
      var s = this.signal;
      if (s.aborted) return;
      s.aborted = true;
      s.reason = reason === undefined ? makeAbortError() : reason;
      s.dispatchEvent({ type: 'abort', target: s });
    };

    G.AbortController = AbortController;
    G.AbortSignal = AbortSignal;

    if (typeof G.fetch === 'function') {
      var nativeFetch = G.fetch;
      G.fetch = function (input, init) {
        var signal = init && init.signal;
        if (!signal || !(signal instanceof AbortSignal)) return nativeFetch.apply(this, arguments);
        if (signal.aborted) return Promise.reject(makeAbortError());
        // Свой signal в родной fetch не передаём — Chrome 53 его не знает
        var clean = {};
        for (var k in init) if (k !== 'signal') clean[k] = init[k];
        var self = this;
        return new Promise(function (resolve, reject) {
          var onAbort = function () { reject(makeAbortError()); };
          signal.addEventListener('abort', onAbort);
          nativeFetch.call(self, input, clean).then(function (r) {
            signal.removeEventListener('abort', onAbort);
            resolve(r);
          }, function (e) {
            signal.removeEventListener('abort', onAbort);
            reject(e);
          });
        });
      };
    }
  }
})();
