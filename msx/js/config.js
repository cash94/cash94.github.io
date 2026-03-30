// Глобальные константы и утилиты
const SERVER_URL = window.location.origin;

// Состояние приложения
const AppState = {
  // Настройки сервера
  currentTorrserverUrl: '',
  authEnabled: false,
  serverOnline: false,
  clientId: null,

  // Данные торрентов
  torrents: [],
  currentDetailItem: null,

  // Состояние плеера
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
  restoringFocus: false
};

// Вспомогательные функции
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatBytes(bytes) {
  if (bytes === 0 || !bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// Получение заголовков аутентификации
function getAuthHeaders() {
  const headers = {};
  if (AppState.authEnabled) {
    const login = document.getElementById('auth-login').value.trim();
    const password = document.getElementById('auth-password').value.trim();
    if (login && password) {
      headers['Authorization'] = 'Basic ' + btoa(login + ':' + password);
    }
  }
  return headers;
}

// Показать/скрыть загрузочный оверлей
function showLoading(message) {
  const overlay = document.getElementById('loading-overlay');
  overlay.classList.add('active');
  const textEl = document.querySelector('.loading-text');
  if (textEl) textEl.textContent = message || 'Загрузка...';
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.remove('active');
}

// НОВАЯ ФУНКЦИЯ: Определение платформы
function detectPlatform() {
  const ua = navigator.userAgent.toLowerCase();

  if (ua.includes('vidaa')) {
    return 'vidaa';
  } else if (ua.includes('android') && ua.includes('tv')) {
    return 'androidtv';
  } else if (ua.includes('webos')) {
    return 'webos';
  } else if (ua.includes('tizen')) {
    return 'tizen';
  } else if (ua.includes('smart-tv') || ua.includes('smarttv')) {
    return 'smarttv';
  } else if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) {
    return 'ios';
  } else if (ua.includes('android')) {
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
    'BACK': [8, 27, 461, 10009, 10014], // Backspace, Escape, Return
    'EXIT': [27, 10182], // Escape
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
  const keyMap = getKeyMap();
  return keyMap[keyName]?.includes(keyCode) || false;
}

// Определяем платформу при загрузке
AppState.platform = detectPlatform();
console.log(`📱 Платформа: ${AppState.platform}`);
