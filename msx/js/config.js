// Глобальные константы и утилиты
var SERVER_URL = window.location.origin;

// Состояние приложения
var AppState = {
  // Настройки сервера
  protocol: window.location.protocol,
  currentTorrserverUrl: '',
  currentVersion: 'TorrStream.1.0.36',
  authEnabled: false,
  serverOnline: false,
  clientId: null,
  userlogin: '',
  userpassword: '',
  addToDbEnabled: false,
  multiChannelEnabled: false,

  // Данные торрентов
  torrents: [],
  currentDetailItem: null,
  mediaType: "",

  // Состояние плеера
  externalPlayerEnabled: false,
  currentScreen: 'config',
  videoUrl: '',
  bufferHidden: false,
  hls: null,
  currentStreamId: null,

  // Метаданные длительности
  expectedDuration: null,
  originalDuration: null,
  seekOffset: 0,

  // Флаги для управления плеером
  isSeeking: false,
  seekQueue: [],
  seekTimeout: null,
  lastSuccessfulSeek: 0,
  isSliderDragging: false,
  previewTime: null,
  suppressTimeUpdate: false,
  isPlaying: false,
  hintTimeout: null,

  // Навигация / фокус
  focusIndex: 0,
  platform: 'unknown',
  lastFocusedElement: null,
  isSearch: false,
  inSearch: 'torrents',
  searchReturnTo: 'torrents',
  detailReturnTo: 'torrents',
  restoringFocus: false,

  //Синхронизация
  syncCodeScreen: false,
  syncCode: null,
  syncCodeTimer: null,

  //Восстановление скролла
  backupScroll: 0,

  //Для получения skip кодов
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
  dvPreferred: false
};

var noCacheElements = ['load-more-trigger', 'detail-progress'];
var domCache = {};

// Кэш для часто используемых DOM-элементов (ленивая инициализация)
function getEl(id) {
  // Проверяем, нужно ли кэшировать этот элемент
  if (noCacheElements.includes(id)) {
    // Не кэшируем, каждый раз ищем заново
    return document.getElementById(id);
  }
  
  // Для остальных элементов используем кэш
  if (!domCache[id]) {
    domCache[id] = document.getElementById(id);
  }
  return domCache[id];
}

function clearDomCache() { domCache = {}; }

function clearFocused() { var f = document.querySelectorAll('.focused'); for (var i = 0; i < f.length; i++) { if (typeof gsap !== 'undefined') gsap.killTweensOf(f[i]); f[i].style.boxShadow = ''; f[i].style.transform = ''; f[i].style.scale = ''; f[i].style.translate = ''; f[i].classList.remove('focused'); } };

// Вспомогательные функции
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
  var m = Math.floor((seconds % 3600) / 60);
  var s = Math.floor(seconds % 60);
  if (h > 0) return h + ':' + m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
  return m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
}

// Получение заголовков аутентификации
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

// Показать/скрыть загрузочный оверлей
function showLoading(message) {
  var overlay = getEl('loading-overlay');
  overlay.classList.add('active');
  var textEl = document.querySelector('.loading-text');
  if (textEl) textEl.textContent = message || 'Загрузка...';
}

function hideLoading() {
  getEl('loading-overlay').classList.remove('active');
}

// НОВАЯ ФУНКЦИЯ: Определение платформы
function detectPlatform() {
  var ua = navigator.userAgent.toLowerCase();

  if (ua.indexOf('vidaa') !== -1) {
    return 'vidaa';
  } else if (ua.indexOf('android') !== -1 && ua.indexOf('tv') !== -1) {
    return 'androidtv';
  } else if (ua.indexOf('webos') !== -1) {
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

// НОВАЯ ФУНКЦИЯ: Карта клавиш для Vidaa OS и других платформ
function getKeyMap() {
  return {
    // Стрелки (основные)
    'UP': [38, 19, 10011],
    'DOWN': [40, 20, 10012],
    'LEFT': [37, 21, 10009],
    'RIGHT': [39, 22, 10010],
    'OK': [13, 23, 10013, 10020],

    // Vidaa OS специфичные
    'BACK': [4, 8, 27, 461, 111, 10009, 10014], // Backspace, Escape, Return
    //'EXIT': [27, 10182], // Escape
    'HOME': [36, 3],
    'MENU': [18, 82, 457], // Alt, Menu

    // Мультимедиа
    'PLAY': [415, 126, 179],
    'PAUSE': [19, 127, 179],
    'PLAY_PAUSE': [179, 85],
    'STOP': [413, 86],
    'FF': [417, 90, 10019], // Fast Forward
    'REW': [412, 89, 10020], // Rewind
    'NEXT': [87, 428], // Next track/chapter
    'PREV': [88, 427], // Previous track/chapter

    // Громкость
    'VOL_UP': [447, 24, 175],
    'VOL_DOWN': [448, 25, 174],
    'MUTE': [449, 164, 173],

    // Цветные кнопки (часто есть на пультах Vidaa)
    'RED': [403, 434],
    'GREEN': [404, 435],
    'YELLOW': [405, 436],
    'BLUE': [406, 437],

    // Инфо
    'INFO': [457, 166],

    // Цифры
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
}

// НОВАЯ ФУНКЦИЯ: Проверка клавиши
function isKeyPressed(keyName, keyCode) {
  var keyMap = getKeyMap();
  var keyCodes = keyMap[keyName];

  if (!keyCodes) return false;

  for (var i = 0; i < keyCodes.length; i++) {
    if (keyCodes[i] === keyCode) return true;
  }
  return false;
}

// Определяем платформу при загрузке
AppState.platform = detectPlatform();
console.log('📱 Платформа: ' + AppState.platform);
window.getEl = getEl;
window.clearFocused = clearFocused;
