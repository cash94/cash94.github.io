/* Сборка для старых браузеров (Chrome 53) из js/config.js — tools/legacy-build/build.js. Руками не править. */
var SERVER_URL = window.TS_SERVER || window.location.origin;
function tsAuthToken() {
  try {
    return localStorage.getItem('authToken') || '';
  } catch (e) {
    return '';
  }
}
function isTsServerUrl(url) {
  url = String(url || '');
  if (url.charAt(0) === '/' && url.charAt(1) !== '/') return true;
  return url.indexOf(SERVER_URL + '/') === 0 || url === SERVER_URL;
}
if (window.TS_SERVER) {
  (function () {
    if (window.fetch) {
      var origFetch = window.fetch;
      window.fetch = function (input, init) {
        var url = typeof input === 'string' ? input : input && input.url;
        var token = tsAuthToken();
        if (token && isTsServerUrl(url)) {
          var opts = {},
            k;
          if (init) for (k in init) opts[k] = init[k];
          var headers = new Headers(opts.headers || typeof input !== 'string' && input.headers || {});
          if (!headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);
          opts.headers = headers;
          return origFetch.call(this, input, opts);
        }
        return origFetch.apply(this, arguments);
      };
    }
    var proto = XMLHttpRequest.prototype;
    var origOpen = proto.open,
      origSend = proto.send,
      origSetHeader = proto.setRequestHeader;
    proto.open = function (method, url) {
      this._tsAuth = isTsServerUrl(url);
      this._tsHasAuth = false;
      return origOpen.apply(this, arguments);
    };
    proto.setRequestHeader = function (name) {
      if (String(name).toLowerCase() === 'authorization') this._tsHasAuth = true;
      return origSetHeader.apply(this, arguments);
    };
    proto.send = function () {
      var token = this._tsAuth && !this._tsHasAuth ? tsAuthToken() : '';
      if (token) {
        try {
          origSetHeader.call(this, 'Authorization', 'Bearer ' + token);
        } catch (e) {}
      }
      return origSend.apply(this, arguments);
    };
  })();
}
var AppState = {
  protocol: window.TS_SERVER ? window.TS_SERVER.split('//')[0] : window.location.protocol,
  currentTorrserverUrl: '',
  currentVersion: 'TorrStream.1.0.54',
  authEnabled: false,
  serverOnline: false,
  clientId: null,
  userlogin: '',
  userpassword: '',
  addToDbEnabled: true,
  multiChannelEnabled: false,
  torrents: [],
  currentDetailItem: null,
  mediaType: "",
  externalPlayerEnabled: false,
  currentScreen: 'config',
  videoUrl: '',
  bufferHidden: false,
  autoSkipIntro: false,
  preloadBeforePlay: true,
  builtinKeyboard: false,
  detailUnderSearch: false,
  hls: null,
  currentStreamId: null,
  expectedDuration: null,
  originalDuration: null,
  seekOffset: 0,
  isSeeking: false,
  seekQueue: [],
  seekTimeout: null,
  lastSuccessfulSeek: 0,
  isSliderDragging: false,
  previewTime: null,
  suppressTimeUpdate: false,
  isPlaying: false,
  hintTimeout: null,
  focusIndex: 0,
  platform: 'unknown',
  vidaaOsVersion: '',
  vidaaFirmware: '',
  vidaaDirectPlay: false,
  lastFocusedElement: null,
  isSearch: false,
  inSearch: 'torrents',
  restoringFocus: false,
  syncCodeScreen: false,
  syncCode: null,
  syncCodeTimer: null,
  backupScroll: 0,
  currentTMDB: '',
  currentSeason: '',
  isSerials: false,
  playFromHash: false,
  androidBackCatalog: '',
  catalogIndex: null,
  catalogPu: null,
  backCurrentCatalog: '',
  isCatalogSerials: false,
  isCatalogSearch: false,
  lastSearchFailure: null,
  dvPreferred: false,
  trailerPlay: false,
  screensaverActive: false,
  openInRow: false,
  imageMirrors: ['tsimg.torrstream.online', 'nl.imagetmdb.com', 'mocha.stull.xyz', 'proxy.vokino.pro/image', 'nmtmdb.duckdns.org'],
  skipApiHost: 'tsskip.torrstream.online',
  skipApiBase: ''
};
function getPrimaryImageHost() {
  return AppState.imageMirrors && AppState.imageMirrors[0] || 'tsimg.torrstream.online';
}
function getPrimaryImageBase() {
  var proto = String(AppState.protocol || 'https:').replace(/:+$/, '') + ':';
  return proto + '//' + getPrimaryImageHost() + '/t/p/';
}
function loadClientConfig() {
  return fetch(SERVER_URL + '/api/client-config').then(function (r) {
    return r.ok ? r.json() : null;
  }).then(function (data) {
    if (!data || !data.success) return;
    if (Array.isArray(data.tmdbImages) && data.tmdbImages.length) {
      AppState.imageMirrors.length = 0;
      for (var i = 0; i < data.tmdbImages.length; i++) AppState.imageMirrors.push(String(data.tmdbImages[i]));
      if (window.CatalogWorker && typeof CatalogWorker.setImageMirrors === 'function') {
        CatalogWorker.setImageMirrors(AppState.imageMirrors);
      }
    }
    if (data.skipApi) AppState.skipApiHost = String(data.skipApi);
    console.log('🌐 Зеркала картинок: ' + AppState.imageMirrors.join(', ') + '; заставки: ' + AppState.skipApiHost);
  })['catch'](function () {});
}
function getSkipApiBase() {
  if (AppState.skipApiBase) return AppState.skipApiBase;
  return AppState.protocol + '//' + AppState.skipApiHost;
}
function loadSkipApiBase() {
  return fetch(SERVER_URL + '/api/skip/status').then(function (r) {
    return r.ok ? r.json() : null;
  }).then(function (data) {
    if (!data || !data.ok) return;
    AppState.skipApiBase = SERVER_URL + '/api/skip';
    console.log('🎬 Заставки через модуль сервера: ' + data.primary + ' → ' + data.fallback);
  })['catch'](function () {});
}
window.getPrimaryImageHost = getPrimaryImageHost;
window.getPrimaryImageBase = getPrimaryImageBase;
window.getSkipApiBase = getSkipApiBase;
window.loadClientConfig = loadClientConfig;
loadClientConfig();
loadSkipApiBase();
var noCacheElements = ['load-more-trigger', 'detail-progress'];
var domCache = {};
function getEl(id) {
  if (noCacheElements.includes(id)) {
    return document.getElementById(id);
  }
  if (!domCache[id]) {
    domCache[id] = document.getElementById(id);
  }
  return domCache[id];
}
function clearDomCache() {
  domCache = {};
}
function clearFocused() {
  var f = document.querySelectorAll('.focused');
  for (var i = 0; i < f.length; i++) {
    f[i].style.boxShadow = '';
    f[i].style.transform = '';
    f[i].style.scale = '';
    f[i].style.translate = '';
    f[i].classList.remove('focused');
  }
}
;
function escapeHtml(text) {
  if (!text) return '';
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
function formatBytes(bytes) {
  if (bytes === 0 || !bytes) return '0 B';
  var k = 1024;
  var sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  var i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '00:00';
  var h = Math.floor(seconds / 3600);
  var m = Math.floor(seconds % 3600 / 60);
  var s = Math.floor(seconds % 60);
  if (h > 0) return h + ':' + m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
  return m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
}
function getAuthHeaders() {
  var headers = {};
  if (AppState.authEnabled) {
    var loginEl = getEl('auth-login');
    var passEl = getEl('auth-password');
    var login = loginEl ? loginEl.value.trim() : '';
    var password = passEl ? passEl.value.trim() : '';
    AppState.userlogin = login;
    AppState.userpassword = password;
    if (AppState.userlogin) {
      headers['Authorization'] = 'Basic ' + btoa(AppState.userlogin + ':' + AppState.userpassword);
    } else if (login) {
      headers['Authorization'] = 'Basic ' + btoa(login + ':' + password);
    }
  }
  return headers;
}
var LOADING_FADE_SEC = 0.22;
function loadingFadeDuration() {
  if (typeof Animations !== 'undefined' && Animations.UI_FADE && typeof Animations.UI_FADE.overlay === 'number') return Animations.UI_FADE.overlay;
  return LOADING_FADE_SEC;
}
function showLoading(message) {
  var overlay = getEl('loading-overlay');
  if (!overlay) return;
  var textEl = document.querySelector('.loading-text');
  if (textEl) textEl.textContent = message || 'Загрузка...';
  var canFade = typeof Animations !== 'undefined' && typeof Animations.fadeIn === 'function';
  if (!canFade) {
    overlay.classList.add('active');
    return;
  }
  if (!overlay.classList.contains('active')) overlay.style.opacity = '0';
  overlay.classList.add('active');
  Animations.fadeIn(overlay, {
    duration: loadingFadeDuration()
  });
}
function hideLoading() {
  var overlay = getEl('loading-overlay');
  if (!overlay) return;
  var canFade = typeof Animations !== 'undefined' && typeof Animations.fadeOut === 'function';
  if (!canFade || !overlay.classList.contains('active')) {
    overlay.classList.remove('active');
    overlay.style.opacity = '';
    return;
  }
  Animations.fadeOut(overlay, {
    duration: loadingFadeDuration(),
    keepFaded: true,
    onDone: function () {
      overlay.classList.remove('active');
      overlay.style.opacity = '';
    }
  });
}
function detectPlatform() {
  var ua = navigator.userAgent.toLowerCase();
  if (ua.indexOf('vidaa') !== -1) {
    return 'vidaa';
  } else if (ua.indexOf('android') !== -1 && ua.indexOf('tv') !== -1) {
    return 'androidtv';
  } else if (typeof window.PalmSystem !== 'undefined' || typeof window.webOSSystem !== 'undefined') {
    return 'webos';
  } else if (ua.indexOf('tizen') !== -1 || detectTizenApp()) {
    return 'tizen';
  } else if (ua.indexOf('smart-tv') !== -1 || ua.indexOf('smarttv') !== -1) {
    return 'smarttv';
  } else if (ua.indexOf('iphone') !== -1 || ua.indexOf('ipad') !== -1 || ua.indexOf('ipod') !== -1) {
    return 'ios';
  } else if (ua.indexOf('android') !== -1) {
    return 'android';
  }
  return 'desktop';
}
var _tizenApp = null;
function detectTizenApp() {
  if (_tizenApp !== null) return _tizenApp;
  var mark = false;
  try {
    if (/[?&]tsapp=tizen(?:&|$)/.test(location.search)) {
      sessionStorage.setItem('tsApp', 'tizen');
      if (window.history && history.replaceState) {
        var q = location.search.replace(/([?&])tsapp=tizen(&|$)/, function (m, a, b) {
          return b ? a : '';
        }).replace(/[?&]$/, '');
        history.replaceState(history.state, '', location.pathname + q + location.hash);
      }
    }
    mark = sessionStorage.getItem('tsApp') === 'tizen';
  } catch (e) {}
  _tizenApp = typeof window.tizen !== 'undefined' || mark;
  return _tizenApp;
}
function detectTizenInfo() {
  var info = {
    version: '',
    model: ''
  };
  var m = /Tizen\s*([\d.]+)/i.exec(navigator.userAgent || '');
  if (m) info.version = m[1];
  if (window.tizen && tizen.systeminfo) {
    try {
      info.version = tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version') || info.version;
    } catch (e) {}
    try {
      info.model = tizen.systeminfo.getCapability('http://tizen.org/system/model_name') || '';
    } catch (e) {}
  }
  return info;
}
function registerTizenKeys() {
  var input = window.tizen && tizen.tvinputdevice;
  if (!input) return;
  var names = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind', 'MediaTrackPrevious', 'MediaTrackNext', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'Info', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  for (var i = 0; i < names.length; i++) {
    try {
      input.registerKey(names[i]);
    } catch (e) {}
  }
}
function detectApplePlatform() {
  var ua = navigator.userAgent.toLowerCase();
  var touch = 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
  if (ua.indexOf('ipad') !== -1 && window.innerWidth === 1920 && window.innerHeight === 1080) return 'apple_tv';
  if (ua.indexOf('iphone') !== -1 || ua.indexOf('ipad') !== -1 || ua.indexOf('ipod') !== -1) return 'apple';
  if (ua.indexOf('macintosh') !== -1 || ua.indexOf('mac os x') !== -1) return touch ? 'apple' : 'macos';
  return null;
}
var VIDAA_DIRECT_PLAY_MIN = 9.5;
function detectVidaaInfo() {
  var info = {
    os: '',
    firmware: '',
    version: 0
  };
  try {
    if (typeof window.Hisense_GetOSVersion === 'function') info.os = String(window.Hisense_GetOSVersion() || '');
  } catch (e) {}
  try {
    if (typeof window.Hisense_GetFirmWareVersion === 'function') info.firmware = String(window.Hisense_GetFirmWareVersion() || '');
  } catch (e) {}
  var m = info.os.match(/(\d+)\.(\d+)/);
  if (m) info.version = parseInt(m[1], 10) + parseFloat('0.' + m[2]);
  return info;
}
var _keyMap = null;
function getKeyMap() {
  if (_keyMap) return _keyMap;
  _keyMap = {
    'UP': [38, 19, 10011],
    'DOWN': [40, 20, 10012],
    'LEFT': [37, 21, 10009],
    'RIGHT': [39, 22, 10010],
    'OK': [13, 23, 10013, 10020],
    'BACK': [4, 8, 27, 461, 111, 10009, 10014],
    'HOME': [36, 3],
    'MENU': [18, 82, 457],
    'PLAY': [415, 126, 179],
    'PAUSE': [19, 127, 179],
    'PLAY_PAUSE': [179, 85],
    'STOP': [413, 86],
    'FF': [417, 90, 10019],
    'REW': [412, 89, 10020],
    'NEXT': [87, 428],
    'PREV': [88, 427],
    'VOL_UP': [447, 24, 175],
    'VOL_DOWN': [448, 25, 174],
    'MUTE': [449, 164, 173],
    'RED': [403, 434],
    'GREEN': [404, 435],
    'YELLOW': [405, 436],
    'BLUE': [406, 437],
    'INFO': [457, 166],
    '0': [48, 96],
    '1': [49, 97],
    '2': [50, 98],
    '3': [51, 99],
    '4': [52, 100],
    '5': [53, 101],
    '6': [54, 102],
    '7': [55, 103],
    '8': [56, 104],
    '9': [57, 105]
  };
  if (AppState.platform === 'tizen') {
    _keyMap.LEFT = [37, 21];
    _keyMap.UP = [38, 10011];
    _keyMap.PLAY_PAUSE = [179, 85, 10252];
    _keyMap.PREV = [88, 427, 10232];
    _keyMap.NEXT = [87, 428, 10233];
  }
  return _keyMap;
}
function isKeyPressed(keyName, keyCode) {
  var keyMap = getKeyMap();
  var keyCodes = keyMap[keyName];
  if (!keyCodes) return false;
  for (var i = 0; i < keyCodes.length; i++) {
    if (keyCodes[i] === keyCode) return true;
  }
  return false;
}
AppState.platform = detectPlatform();
AppState.applePlatform = detectApplePlatform();
AppState.tizenApp = detectTizenApp();
if (AppState.tizenApp) registerTizenKeys();
if (AppState.platform === 'tizen') {
  (function () {
    var tz = detectTizenInfo();
    AppState.tizenVersion = tz.version;
    AppState.tizenModel = tz.model;
    AppState.tizenLegacy = parseFloat(tz.version) < 7;
    if (AppState.tizenLegacy) document.documentElement.classList.add('tizen-legacy');
    console.log('📺 Tizen ' + (tz.version || '?') + (tz.model ? ', ' + tz.model : '') + (AppState.tizenApp ? ' — приложение, прямой режим плеера' : ''));
  })();
}
(function () {
  var vidaa = detectVidaaInfo();
  AppState.vidaaOsVersion = vidaa.os;
  AppState.vidaaFirmware = vidaa.firmware;
  AppState.vidaaDirectPlay = vidaa.version >= VIDAA_DIRECT_PLAY_MIN;
  if (vidaa.os || vidaa.firmware) {
    console.log('📺 VIDAA ' + (vidaa.os || '?') + ', прошивка ' + (vidaa.firmware || '?') + (AppState.vidaaDirectPlay ? ' — прямой режим плеера' : ''));
  }
})();
if (window.AndroidJS) document.documentElement.classList.add('android-app');
if (AppState.applePlatform === 'apple_tv' || AppState.applePlatform === 'apple') {
  document.documentElement.classList.add('apple-device');
}
console.log('📱 Платформа: ' + AppState.platform + (AppState.applePlatform ? ' (' + AppState.applePlatform + ')' : ''));
window.getEl = getEl;
window.clearFocused = clearFocused;
function tsWorkerUrl(file) {
  var path = file + '?v=' + (window.VERSION || Date.now());
  if (location.search.indexOf('local=1') !== -1) path += '&local=1';
  if (!window.TS_SERVER || !window.Blob || !window.URL || !URL.createObjectURL) {
    return new URL(path, document.baseURI).href;
  }
  var code = 'self.TS_SERVER = ' + JSON.stringify(SERVER_URL) + ';\n' + '(function () {\n' + '  var base = self.TS_SERVER, token = ' + JSON.stringify(tsAuthToken()) + ', origFetch = self.fetch;\n' + '  self.fetch = function (url, init) {\n' + '    if (typeof url === "string" && url.charAt(0) === "/" && url.charAt(1) !== "/") url = base + url;\n' + '    if (token && typeof url === "string" && url.indexOf(base + "/") === 0) {\n' + '      var opts = {}, k;\n' + '      if (init) for (k in init) opts[k] = init[k];\n' + '      var headers = new Headers(opts.headers || {});\n' + '      if (!headers.has("Authorization")) headers.set("Authorization", "Bearer " + token);\n' + '      opts.headers = headers;\n' + '      return origFetch.call(self, url, opts);\n' + '    }\n' + '    return origFetch.call(self, url, init);\n' + '  };\n' + '})();\n' + 'importScripts(' + JSON.stringify(SERVER_URL + '/' + path) + ');\n';
  return URL.createObjectURL(new Blob([code], {
    type: 'text/javascript'
  }));
}
window.tsWorkerUrl = tsWorkerUrl;
function withClientId(url) {
  var id = null;
  try {
    id = localStorage.getItem('clientId');
  } catch (e) {}
  if (!id) return url;
  return url + (url.indexOf('?') === -1 ? '?' : '&') + 'clientId=' + encodeURIComponent(id);
}
window.withClientId = withClientId;
function isTextEntryElement(el) {
  if (!el || el === document.body) return false;
  if (el.isContentEditable) return true;
  if (el.disabled || el.readOnly) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  var t = (el.type || 'text').toLowerCase();
  return ['text', 'search', 'url', 'email', 'password', 'tel', 'number'].indexOf(t) !== -1;
}
window.isTextEntryElement = isTextEntryElement;
window.addEventListener('keydown', function (e) {
  var kc = e.keyCode || e.which;
  if ((kc === 8 || e.key === 'Backspace') && isTextEntryElement(document.activeElement)) {
    e.stopImmediatePropagation();
    return;
  }
  if (!e.repeat && isKeyPressed('BACK', kc)) startBackHoldExit(kc);
  if (e.repeat && isKeyPressed('BACK', kc)) {
    if (window.OSK && typeof OSK.isOpen === 'function' && OSK.isOpen()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}, true);
var BACK_HOLD_EXIT_MS = 1000;
var backHoldTimer = null;
var backHoldKey = 0;
function cancelBackHoldExit() {
  if (backHoldTimer) {
    clearTimeout(backHoldTimer);
    backHoldTimer = null;
  }
}
function startBackHoldExit(kc) {
  if (AppState.platform !== 'webos' && !AppState.tizenApp || backHoldTimer) return;
  if (window.OSK && typeof OSK.isOpen === 'function' && OSK.isOpen()) return;
  if (isTextEntryElement(document.activeElement)) return;
  backHoldKey = kc;
  backHoldTimer = setTimeout(function () {
    backHoldTimer = null;
    exitApp();
  }, BACK_HOLD_EXIT_MS);
}
window.addEventListener('keyup', function (e) {
  if ((e.keyCode || e.which) === backHoldKey) cancelBackHoldExit();
}, true);
window.addEventListener('blur', cancelBackHoldExit);
document.addEventListener('visibilitychange', function () {
  if (document.hidden) cancelBackHoldExit();
});
var exitingApp = false;
function exitApp() {
  if (exitingApp) return;
  exitingApp = true;
  if (typeof window.showToast === 'function') window.showToast('Выход из TorrStream…');
  var closed = false;
  var close = function () {
    if (closed) return;
    closed = true;
    try {
      if (window.tizen && tizen.application) {
        tizen.application.getCurrentApplication().exit();
        return;
      }
    } catch (e) {}
    try {
      window.close();
    } catch (e) {}
  };
  setTimeout(close, 2500);
  try {
    if (window.WebOSTorrServer && WebOSTorrServer.enabled()) {
      WebOSTorrServer.stopForExit(close);
      return;
    }
  } catch (e) {}
  close();
}
window.exitApp = exitApp;
(function () {
  if (!navigator.maxTouchPoints) return;
  var vv = window.visualViewport;
  var target = vv || window;
  function size() {
    return vv ? {
      w: Math.round(vv.width),
      h: Math.round(vv.height)
    } : {
      w: window.innerWidth,
      h: window.innerHeight
    };
  }
  var last = size();
  var keyboardShown = false;
  target.addEventListener('resize', function () {
    var cur = size();
    var a = document.activeElement;
    var editing = isTextEntryElement(a);
    if (cur.w !== last.w) {
      keyboardShown = false;
    } else if (cur.h < last.h) {
      if (editing) keyboardShown = true;
    } else if (cur.h > last.h && keyboardShown) {
      keyboardShown = false;
      if (editing) {
        try {
          a.blur();
        } catch (e) {}
      }
    }
    last = cur;
  });
})();
