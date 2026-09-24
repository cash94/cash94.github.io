// Глобальные константы и утилиты
var SERVER_URL = window.location.origin;

// Состояние приложения
var AppState = {
  // Настройки сервера
  protocol: window.location.protocol,
  currentTorrserverUrl: '',
  currentVersion: 'TorrStream.1.0.47',
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
  // Настройка «Автопропуск заставки»: кнопка пропуска отсчитывает и
  // пропускает сама (player.js, startAutoSkipCountdown). Из localStorage.
  autoSkipIntro: false,
  // Настройка «Использовать встроенную клавиатуру» (Прочее): на текстовых
  // полях вместо системной открывается своя экранная клавиатура (js/osk.js).
  // Из localStorage.
  builtinKeyboard: false,
  // Карточка фильма ещё стоит под проявляющейся выдачей поиска (возврат
  // «назад» из карточки в поиск, app.js) и ждёт, чтобы её спрятали
  detailUnderSearch: false,
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
  // Раздачу запустили из результатов поиска, а сами результаты не уничтожили —
  // только спрятали оверлей. Выход из плеера (player.js: showDetailView) и выход
  // из деталей торрента (app.js: back-from-detail) возвращают человека туда,
  // откуда он запускал, а не на «Мои торренты».
  // Чем кончился последний поиск торрентов: null — искали и нашли (или честно
  // не нашли), объект {host, timedOut} — Jacred не ответил. По этому признаку
  // кнопка «Торренты» в карточке каталога не рисует свой «Торренты не найдены»
  // поверх баннера «Jacred недоступен» (torrents.js: setJacredSearchFailure).
  lastSearchFailure: null,
  dvPreferred: false,
  trailerPlay: false,
  openInRow: false,
  // Зеркала картинок TMDB и хост API заставок. Значения по умолчанию —
  // прежние зашитые; настоящие приходят с сервера из apiproxy.json
  // (loadClientConfig ниже). Массив меняется НА МЕСТЕ: catalog.js держит
  // ссылку на него как на свой список mirrors.
  imageMirrors: [
    'tsimg.torrstream.online',
    'nl.imagetmdb.com',
    'mocha.stull.xyz',
    'proxy.vokino.pro/image',
    'nmtmdb.duckdns.org'
  ],
  skipApiHost: 'tsskip.torrstream.online',
  // База API заставок. Пусто — ходим напрямую на skipApiHost, как раньше.
  // Если на сервере стоит модуль skip-intro, сюда встаёт его адрес: он делает
  // то же самое, но при отсутствии данных спрашивает запасной источник
  // (см. getSkipApiBase ниже и loadSkipApiBase).
  skipApiBase: ''
};

/**
 * Основное зеркало картинок — первое в списке.
 *
 * Его берут места, где запасного перехода на следующее зеркало при ошибке
 * загрузки нет (постеры торрентов, поиск по названию, воркер каталога): там
 * балансировка по всему списку уронила бы все постеры, попавшие на мёртвый
 * хост. Балансирует только каталог (getTmdbImageUrl в catalog.js) — у него
 * такой переход есть.
 */
function getPrimaryImageHost() {
  return (AppState.imageMirrors && AppState.imageMirrors[0]) || 'tsimg.torrstream.online';
}

/** База URL картинок основного зеркала: «https://tsimg.torrstream.online/t/p/». */
function getPrimaryImageBase() {
  var proto = String(AppState.protocol || 'https:').replace(/:+$/, '') + ':';
  return proto + '//' + getPrimaryImageHost() + '/t/p/';
}

/**
 * Клиентская часть apiproxy.json с сервера (/api/client-config).
 *
 * Картинки начинают грузиться раньше, чем придёт ответ, — первые постеры
 * уходят на зеркала по умолчанию, дальнейшие уже на настоящие. Ждать ответа
 * перед отрисовкой не стоит: это задержка первого экрана ради редкого случая.
 * Старый сервер маршрута не знает — тогда просто остаются значения по умолчанию.
 */
function loadClientConfig() {
  return fetch(SERVER_URL + '/api/client-config')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
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
    })
    ['catch'](function () { });
}
/**
 * База API заставок: адрес, к которому дописывается «/v2/media?...».
 *
 * Модуль на своём сервере предпочтительнее прямого обращения: он держит тот же
 * основной источник, но добавляет запасной, кэш и работает same-origin (без
 * смешанного содержимого на https-страницах).
 */
function getSkipApiBase() {
  if (AppState.skipApiBase) return AppState.skipApiBase;
  return AppState.protocol + '//' + AppState.skipApiHost;
}

/** Есть ли на сервере модуль skip-intro. Ответ — один раз при старте. */
function loadSkipApiBase() {
  return fetch(SERVER_URL + '/api/skip/status')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data || !data.ok) return;
      AppState.skipApiBase = SERVER_URL + '/api/skip';
      console.log('🎬 Заставки через модуль сервера: ' + data.primary + ' → ' + data.fallback);
    })
    ['catch'](function () { });
}

window.getPrimaryImageHost = getPrimaryImageHost;
window.getPrimaryImageBase = getPrimaryImageBase;
window.getSkipApiBase = getSkipApiBase;
window.loadClientConfig = loadClientConfig;
loadClientConfig();
loadSkipApiBase();

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

function clearFocused() { var f = document.querySelectorAll('.focused'); for (var i = 0; i < f.length; i++) { f[i].style.boxShadow = ''; f[i].style.transform = ''; f[i].style.scale = ''; f[i].style.translate = ''; f[i].classList.remove('focused'); } };

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

/* Показать/скрыть загрузочный оверлей.
 *
 * Оверлей чёрный и во весь экран (#loading-overlay в styles.css), поэтому
 * мгновенное появление и исчезновение читаются как два щелчка. Особенно заметно
 * при поиске торрентов из карточки фильма: карточка → чёрный экран со
 * спиннером → результаты, и всё это резкими сменами кадра.
 *
 * С затуханием переход выходит непрерывным, и заодно решается вторая половина
 * задачи: под непрозрачным оверлеем можно спокойно спрятать detail-view — для
 * зрителя этого просто не существует.
 *
 * Прозрачность ведём инлайном, а видимостью по-прежнему управляет класс
 * .active: display:none обрывает переход мгновенно, поэтому снимаем класс
 * только в конце затухания.
 */
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
  if (!canFade) { overlay.classList.add('active'); return; }

  // Стартовая прозрачность до показа: иначе fadeIn увидит уже непрозрачный
  // элемент и решит, что анимировать нечего
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

  // keepFaded: прозрачность нельзя возвращать раньше, чем снят .active, —
  // иначе оверлей на кадр вспыхнет обратно перед тем, как исчезнуть
  Animations.fadeOut(overlay, {
    duration: loadingFadeDuration(),
    keepFaded: true,
    onDone: function () {
      overlay.classList.remove('active');
      overlay.style.opacity = '';
    }
  });
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

// Карта клавиш для Vidaa OS и других платформ.
//
// Строится один раз. isKeyPressed() зовут по нескольку десятков раз на КАЖДОЕ
// нажатие пульта: isArrowKey, isBackKey, isOkKey и keyToDirection в control.js
// каждая перебирает по нескольку имён, а ветка плеера сверяется ещё и с PLAY,
// VOL_UP, VOL_DOWN, MUTE, цветными кнопками. Раньше на каждый такой вызов
// создавался новый объект из трёх десятков массивов — на удержании стрелки
// (автоповтор) это сотни выброшенных объектов в секунду.
var _keyMap = null;

function getKeyMap() {
  if (_keyMap) return _keyMap;
  _keyMap = {
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

  return _keyMap;
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
