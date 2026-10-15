/* Сборка для старых браузеров (Chrome 53) из js/nav.js — tools/legacy-build/build.js. Руками не править. */






















var Nav = function () {
  'use strict';

  var MAX_DEPTH = 40;
  var SECTIONS = { home: 1, catalog: 1, torrents: 1 };

  var stack = [];
  var handlers = {};
  var debug = /[?&]navdebug=1/.test(String(window.location && window.location.search));

  function describe(e) {
    if (!e) return '∅';
    var label = e.data && e.data.label;
    return e.screen + (label ? '(' + label + ')' : '');
  }

  function dump() {
    var out = [];
    for (var i = 0; i < stack.length; i++) out.push(describe(stack[i]));
    return out.join(' → ');
  }

  function log() {
    if (!debug) return;
    var args = ['🧭'];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    console.log.apply(console, args);
  }

  function top() {return stack[stack.length - 1] || null;}
  function prev() {return stack[stack.length - 2] || null;}
  function depth() {return stack.length;}

  function find(screen) {
    for (var i = stack.length - 1; i >= 0; i--) if (stack[i].screen === screen) return stack[i];
    return null;
  }

  function register(screen, h) {handlers[screen] = h || {};}

  function currentSection() {
    var s = window.AppState && AppState.currentScreen;
    return SECTIONS[s] ? s : 'home';
  }


  function reset(section, data) {
    if (!SECTIONS[section]) section = currentSection();
    stack = [{ screen: section, data: data || {}, restore: null }];
    log('reset', dump());
  }

  function snapshotTop() {
    var t = top();
    if (!t) return;
    var h = handlers[t.screen];
    if (h && typeof h.snapshot === 'function') {
      try {t.restore = h.snapshot(t);} catch (e) {t.restore = null;}
    }
  }






  function push(screen, data) {
    data = data || {};
    if (!stack.length) reset(currentSection());
    var t = top();
    if (t && t.screen === screen && (data.key === undefined || t.data.key === data.key)) {
      if (data.label) t.data = data;
      log('push (повтор, пропущен)', dump());
      return t;
    }
    snapshotTop();
    var e = { screen: screen, data: data, restore: null };
    stack.push(e);

    while (stack.length > MAX_DEPTH) stack.splice(1, 1);
    log('push', dump());
    return e;
  }







  function pop(screen) {
    var t = top();
    if (!t || t.screen !== screen || stack.length <= 1) return null;
    stack.pop();
    log('pop:', describe(t), '⇒', describe(top()), '|', dump());
    return top();
  }





  function returnTarget(entry) {
    if (!entry) return null;
    switch (entry.screen) {
      case 'grid':return 'catalog';
      case 'torrent-detail':return 'detail';
      case 'home':case 'catalog':case 'torrents':case 'detail':case 'search':return entry.screen;
      default:return null;
    }
  }








  function dropDetailsUnderTop(reason) {
    var t = stack.pop();
    if (!t) return;
    while (stack.length > 1) {
      var s = stack[stack.length - 1].screen;
      if (s !== 'detail' && s !== 'torrent-detail' && !(s === t.screen && s === 'search')) break;
      stack.pop();
    }
    stack.push(t);
    log('drop (' + (reason || '') + ')', dump());
  }





  function detailData(item, index) {
    item = item || {};
    return {
      index: index || 0,
      key: 'd:' + (item.id || item.tmdbId || '') + ':' + (item.media_type || ''),
      label: item.title || item.name || item.original_title ||
      item.torrent && item.torrent[0] && item.torrent[0].name || String(item.id || ''),
      item: item
    };
  }

  return {
    detailData: detailData,
    dropDetailsUnderTop: dropDetailsUnderTop,
    pop: pop,
    returnTarget: returnTarget,
    register: register,
    reset: reset,
    push: push,
    top: top,
    prev: prev,
    depth: depth,
    find: find,
    dump: dump
  };
}();

window.Nav = Nav;
