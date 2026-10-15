/* Сборка для старых браузеров (Chrome 53) из js/config.js — tools/legacy-build/build.js. Руками не править. */

var SERVER_URL = window.location.origin;


var AppState = {

  protocol: window.location.protocol,
  currentTorrserverUrl: '',
  currentVersion: 'TorrStream.1.0.49',
  authEnabled: false,
  serverOnline: false,
  clientId: null,
  userlogin: '',
  userpassword: '',
  addToDbEnabled: false,
  multiChannelEnabled: false,


  torrents: [],
  currentDetailItem: null,
  mediaType: "",


  externalPlayerEnabled: false,
  currentScreen: 'config',
  videoUrl: '',
  bufferHidden: false,


  autoSkipIntro: false,



  preloadBeforePlay: false,



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
  openInRow: false,




  imageMirrors: [
  'tsimg.torrstream.online',
  'nl.imagetmdb.com',
  'mocha.stull.xyz',
  'proxy.vokino.pro/image',
  'nmtmdb.duckdns.org'],

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
  return fetch(SERVER_URL + '/api/client-config').
  then(function (r) {return r.ok ? r.json() : null;}).
  then(function (data) {
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
  })[
  'catch'](function () {});
}







function getSkipApiBase() {
  if (AppState.skipApiBase) return AppState.skipApiBase;
  return AppState.protocol + '//' + AppState.skipApiHost;
}


function loadSkipApiBase() {
  return fetch(SERVER_URL + '/api/skip/status').
  then(function (r) {return r.ok ? r.json() : null;}).
  then(function (data) {
    if (!data || !data.ok) return;
    AppState.skipApiBase = SERVER_URL + '/api/skip';
    console.log('🎬 Заставки через модуль сервера: ' + data.primary + ' → ' + data.fallback);
  })[
  'catch'](function () {});
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

function clearDomCache() {domCache = {};}

function clearFocused() {var f = document.querySelectorAll('.focused');for (var i = 0; i < f.length; i++) {f[i].style.boxShadow = '';f[i].style.transform = '';f[i].style.scale = '';f[i].style.translate = '';f[i].classList.remove('focused');}};


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
    var login = getEl('auth-login').value.trim();
    var password = getEl('auth-password').value.trim();

    AppState.userlogin = login;
    AppState.userpassword = password;
    if (AppState.userlogin && AppState.userpassword) {
      headers['Authorization'] = 'Basic ' + btoa(AppState.userlogin + ':' + AppState.userpassword);
    } else if (login && password) {
      headers['Authorization'] = 'Basic ' + btoa(login + ':' + password);
    }
  }
  return headers;
}
















var LOADING_FADE_SEC = 0.22;

function loadingFadeDuration() {
  if (typeof Animations !== 'undefined' && Animations.UI_FADE &&
  typeof Animations.UI_FADE.overlay === 'number') return Animations.UI_FADE.overlay;
  return LOADING_FADE_SEC;
}

function showLoading(message) {
  var overlay = getEl('loading-overlay');
  if (!overlay) return;
  var textEl = document.querySelector('.loading-text');
  if (textEl) textEl.textContent = message || 'Загрузка...';

  var canFade = typeof Animations !== 'undefined' && typeof Animations.fadeIn === 'function';
  if (!canFade) {overlay.classList.add('active');return;}



  if (!overlay.classList.contains('active')) overlay.style.opacity = '0';
  overlay.classList.add('active');
  Animations.fadeIn(overlay, { duration: loadingFadeDuration() });
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
  } else if (ua.indexOf('tizen') !== -1) {
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
console.log('📱 Платформа: ' + AppState.platform);
window.getEl = getEl;
window.clearFocused = clearFocused;











function withClientId(url) {
  var id = null;
  try {id = localStorage.getItem('clientId');} catch (e) {}
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

  if (e.repeat && isKeyPressed('BACK', kc)) {

    if (window.OSK && typeof OSK.isOpen === 'function' && OSK.isOpen()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}, true);













(function () {
  if (!navigator.maxTouchPoints) return;
  var vv = window.visualViewport;
  var target = vv || window;
  function size() {
    return vv ? { w: Math.round(vv.width), h: Math.round(vv.height) } :
    { w: window.innerWidth, h: window.innerHeight };
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
      if (editing) {try {a.blur();} catch (e) {}}
    }
    last = cur;
  });
})();
