// Глобальные константы и утилиты
// Адрес сервера TorrStream. Обычно страница открыта с него самого. В
// приложении для Tizen страница лежит в пакете (file://): запускалка пишет в
// неё HTML с сервера и задаёт window.TS_SERVER и <base href> на сервер — так
// Chrome 94+ пускает её к TorrServer в домашней сети (Private Network Access
// не пускает туда страницу с публичного http-адреса).
var SERVER_URL = window.TS_SERVER || window.location.origin;

// ==================== ВХОД ПО ТОКЕНУ (СТРАНИЦА ИЗ ПАКЕТА) ====================
//
// С сервера страница входит по cookie ts_auth (services/access.js): её ставит
// сервер, и она уходит сама — со страницы, воркеров, hls.js и <video>. У
// страницы из пакета Tizen (window.TS_SERVER) адрес другой, и cookie с
// SameSite=Lax на её запросы не уходит, а SameSite=None требует https. Сервер
// понимает и Authorization: Bearer — его и добавляем ко всем запросам на
// сервер из fetch и XMLHttpRequest (hls.js тоже). Токен — тот же authToken,
// что пишут login.html и account.js. Воркерам его передаёт мост
// (tsWorkerUrl ниже), <video> и <img> заголовков не умеют — на закрытые
// пути с паролем им не попасть (трейлер встроенным HLS на старом Tizen).
function tsAuthToken() {
  try { return localStorage.getItem('authToken') || ''; } catch (e) { return ''; }
}
/** Запрос на сервер TorrStream: относительный путь или адрес с SERVER_URL */
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
        var url = typeof input === 'string' ? input : (input && input.url);
        var token = tsAuthToken();
        if (token && isTsServerUrl(url)) {
          var opts = {}, k;
          if (init) for (k in init) opts[k] = init[k];
          var headers = new Headers(opts.headers || (typeof input !== 'string' && input.headers) || {});
          if (!headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);
          opts.headers = headers;
          return origFetch.call(this, input, opts);
        }
        return origFetch.apply(this, arguments);
      };
    }
    var proto = XMLHttpRequest.prototype;
    var origOpen = proto.open, origSend = proto.send, origSetHeader = proto.setRequestHeader;
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
      if (token) { try { origSetHeader.call(this, 'Authorization', 'Bearer ' + token); } catch (e) { } }
      return origSend.apply(this, arguments);
    };
  })();
}

// Состояние приложения
var AppState = {
  // Настройки сервера
  // Схема для адресов на других хостах (картинки, трекеры) — как у сервера:
  // у страницы из пакета Tizen location.protocol — «file:»
  protocol: window.TS_SERVER ? window.TS_SERVER.split('//')[0] : window.location.protocol,
  currentTorrserverUrl: '',
  currentVersion: 'TorrStream.1.0.54',
  authEnabled: false,
  serverOnline: false,
  clientId: null,
  userlogin: '',
  userpassword: '',
  // «Добавлять торренты в базу» и «Предзагрузка» включены по умолчанию —
  // выключает пользователь сам (в localStorage тогда 'false')
  addToDbEnabled: true,
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
  // Настройка «Предзагрузка» (TorrServer): перед стартом плеера набрать буфер
  // в окне со статистикой раздачи (torrserverstats.js, runPlaybackPreload).
  // Из localStorage; по умолчанию включена.
  preloadBeforePlay: true,
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
  // Hisense: версия VIDAA OS («U09.50»), номер прошивки и прямой режим плеера
  // на VIDAA 9.5+ (detectVidaaInfo)
  vidaaOsVersion: '',
  vidaaFirmware: '',
  vidaaDirectPlay: false,
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
  // Заставка Bing на экране (screensaver.js)
  screensaverActive: false,
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
  } else if (typeof window.PalmSystem !== 'undefined' || typeof window.webOSSystem !== 'undefined') {
    // webOS — только внутри приложения TorrStream-webOS, как Android — по
    // window.AndroidJS. Эти объекты (и PalmServiceBridge для вызовов Luna)
    // среда приложений webOS сама кладёт в каждую страницу, открытую в
    // приложении, — в том числе в torrstream.online после перехода из ipk.
    // Свою переменную из ipk передать нельзя: переход её стирает. По
    // User-Agent («Web0S») не определяем: браузер телевизора — обычный браузер
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

// Приложение TorrStream для Samsung Tizen (TorrStream-Tizen, wgt) — как webOS:
// запускалка из wgt открывает этот сервер, и дальше всё как в браузере, кроме
// плеера (прямой режим, см. app.js: setupCheckboxes). Признаков два:
// - window.tizen — Device API, его среда веб-приложений Tizen кладёт в
//   страницы приложения. Есть ли он у страницы, открытой с чужого сервера
//   после перехода, зависит от прошивки — поэтому есть и второй;
// - метка ?tsapp=tizen, её добавляет запускалка. Помним её в sessionStorage:
//   внутри приложения он живёт до выхода и переживает перезагрузку страницы,
//   а браузер телевизора (обычный браузер, не приложение) метку не получит.
// По User-Agent («Tizen») приложение от браузера Samsung не отличить.
var _tizenApp = null;
function detectTizenApp() {
  if (_tizenApp !== null) return _tizenApp;
  var mark = false;
  try {
    if (/[?&]tsapp=tizen(?:&|$)/.test(location.search)) {
      sessionStorage.setItem('tsApp', 'tizen');
      // Метку из адреса убираем: иначе она попадёт в ссылки «поделиться»
      if (window.history && history.replaceState) {
        var q = location.search.replace(/([?&])tsapp=tizen(&|$)/, function (m, a, b) { return b ? a : ''; }).replace(/[?&]$/, '');
        history.replaceState(history.state, '', location.pathname + q + location.hash);
      }
    }
    mark = sessionStorage.getItem('tsApp') === 'tizen';
  } catch (e) { }
  _tizenApp = typeof window.tizen !== 'undefined' || mark;
  return _tizenApp;
}

// Версия Tizen и модель телевизора — для «Об устройстве». Версию Samsung пишет
// в User-Agent и браузера, и приложений: «Mozilla/5.0 (SMART-TV; LINUX;
// Tizen 6.0) … SamsungBrowser/… TV Safari/…». Device API (только в приложении)
// отвечает точнее и знает модель: tizen.systeminfo.getCapability.
// webapis.productinfo (прошивка, модель) странице с сервера недоступен: его
// скрипт $WEBAPIS/webapis/webapis.js открывается только из самого пакета.
function detectTizenInfo() {
  var info = { version: '', model: '' };
  var m = /Tizen\s*([\d.]+)/i.exec(navigator.userAgent || '');
  if (m) info.version = m[1];
  if (window.tizen && tizen.systeminfo) {
    try { info.version = tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version') || info.version; } catch (e) { }
    try { info.model = tizen.systeminfo.getCapability('http://tizen.org/system/model_name') || ''; } catch (e) { }
  }
  return info;
}

// Медиаклавиши пульта Samsung (▶‖, ■, ⏪, ⏩, цветные) Tizen отдаёт странице,
// только если их зарегистрировать. Запускалка регистрирует их до перехода,
// здесь — ещё раз, если Device API доступен и этой странице.
function registerTizenKeys() {
  var input = window.tizen && tizen.tvinputdevice;
  if (!input) return;
  var names = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind',
    'MediaTrackPrevious', 'MediaTrackNext', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'Info',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  for (var i = 0; i < names.length; i++) {
    try { input.registerKey(names[i]); } catch (e) { }
  }
}

/**
 * Устройство Apple — для выбора внешнего плеера (player.js: APPLE_PLAYERS), по
 * тем же признакам, что у Lampa (src/core/platform.js):
 * - apple_tv — клиент для tvOS называет себя iPad и открывает окно ровно 1920×1080;
 * - apple — iPhone, iPad (iPadOS в режиме ПК пишет «Macintosh», но с сенсором);
 * - macos — Mac.
 * null — не Apple. AppState.platform для всех них остаётся 'ios' / 'desktop':
 * на него опирается остальной код.
 */
function detectApplePlatform() {
  var ua = navigator.userAgent.toLowerCase();
  var touch = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
  if (ua.indexOf('ipad') !== -1 && window.innerWidth === 1920 && window.innerHeight === 1080) return 'apple_tv';
  if (ua.indexOf('iphone') !== -1 || ua.indexOf('ipad') !== -1 || ua.indexOf('ipod') !== -1) return 'apple';
  if (ua.indexOf('macintosh') !== -1 || ua.indexOf('mac os x') !== -1) return touch ? 'apple' : 'macos';
  return null;
}

// VIDAA OS, начиная с которой <video> сам играет файл с TorrServer (MKV, HEVC,
// многоканальный звук) — поток через сервер TorrStream там не нужен
var VIDAA_DIRECT_PLAY_MIN = 9.5;

/**
 * Версия VIDAA OS и прошивки телевизора Hisense. Функции Hisense_* прошивка
 * кладёт в каждую страницу сама (userjs движка браузера, system.user.js):
 * - Hisense_GetOSVersion — «U09.50»; если служба не ответила, прошивка
 *   отдаёт заглушку «U07.00», и такой телевизор считается старым;
 * - Hisense_GetFirmWareVersion — номер ПО из меню телевизора.
 * Обе — синхронный запрос к службам ТВ, поэтому спрашиваем один раз при
 * загрузке. На старых прошивках функций может не быть — тогда всё пусто, и
 * режим плеера выбирают вручную, как раньше.
 */
function detectVidaaInfo() {
  var info = { os: '', firmware: '', version: 0 };
  try {
    if (typeof window.Hisense_GetOSVersion === 'function') info.os = String(window.Hisense_GetOSVersion() || '');
  } catch (e) { }
  try {
    if (typeof window.Hisense_GetFirmWareVersion === 'function') info.firmware = String(window.Hisense_GetFirmWareVersion() || '');
  } catch (e) { }
  // «U09.50», «U9.5», «U10.00» → 9.5, 9.5, 10
  var m = info.os.match(/(\d+)\.(\d+)/);
  if (m) info.version = parseInt(m[1], 10) + parseFloat('0.' + m[2]);
  return info;
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

  // Samsung Tizen: 10009 — «Назад» (Return), 19 — MediaPause. В общей карте
  // они же стоят у LEFT и UP (коды других пультов), и в плеере «Назад»
  // перематывал бы, а пауза — двигала фокус вверх. Добавляем ▶‖ и ⏮/⏭
  if (AppState.platform === 'tizen') {
    _keyMap.LEFT = [37, 21];
    _keyMap.UP = [38, 10011];
    _keyMap.PLAY_PAUSE = [179, 85, 10252];
    _keyMap.PREV = [88, 427, 10232];
    _keyMap.NEXT = [87, 428, 10233];
  }

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
AppState.applePlatform = detectApplePlatform();
AppState.tizenApp = detectTizenApp();
if (AppState.tizenApp) registerTizenKeys();
if (AppState.platform === 'tizen') {
  (function () {
    var tz = detectTizenInfo();
    AppState.tizenVersion = tz.version;
    AppState.tizenModel = tz.model;
    // Tizen до 7 (движок до Chrome 94): видео выводит аппаратный слой, и
    // трейлер на нём играет звуком без картинки. Под классом tizen-legacy у
    // трейлеров нет маски, плавного появления и скрытия до первого кадра
    // (styles.css), а поток идёт без hls.js (catalog.js: trailerUsesHlsJs)
    AppState.tizenLegacy = parseFloat(tz.version) < 7;
    if (AppState.tizenLegacy) document.documentElement.classList.add('tizen-legacy');
    console.log('📺 Tizen ' + (tz.version || '?') + (tz.model ? ', ' + tz.model : '') + (AppState.tizenApp ? ' — приложение, прямой режим плеера' : ''));
  })();
}
(function () {
  var vidaa = detectVidaaInfo();
  AppState.vidaaOsVersion = vidaa.os;
  AppState.vidaaFirmware = vidaa.firmware;
  // Прямой режим (как «Полностью отключить транскодирование») на VIDAA 9.5+
  // включает app.js (setupCheckboxes: directPlay)
  AppState.vidaaDirectPlay = vidaa.version >= VIDAA_DIRECT_PLAY_MIN;
  if (vidaa.os || vidaa.firmware) {
    console.log('📺 VIDAA ' + (vidaa.os || '?') + ', прошивка ' + (vidaa.firmware || '?') +
      (AppState.vidaaDirectPlay ? ' — прямой режим плеера' : ''));
  }
})();
// Android-приложение (мост AndroidJS есть ещё до загрузки страницы) — для CSS:
// боковой вырез там не отодвигает шапку и баннер (styles.css: html.android-app)
if (window.AndroidJS) document.documentElement.classList.add('android-app');
// Apple TV, iPhone, iPad: TorrStream открыт внутри приложения-обёртки, и та сама
// держит страницу в безопасной зоне. Свои отступы под вырез (iPhone) и под
// безопасную зону телевизора (Apple TV) удваивали её: на iPhone приложение не
// помещалось на экран, на Apple TV шапка и баннер уезжали вправо от рядов.
// Mac — обычный браузер, его не трогаем (styles.css: html.apple-device)
if (AppState.applePlatform === 'apple_tv' || AppState.applePlatform === 'apple') {
  document.documentElement.classList.add('apple-device');
}
console.log('📱 Платформа: ' + AppState.platform + (AppState.applePlatform ? ' (' + AppState.applePlatform + ')' : ''));
window.getEl = getEl;
window.clearFocused = clearFocused;


/**
 * Воркер каталога или торрентов. Обычно — файл с этого же сервера
 * (routes/proxy.js). У страницы из пакета Tizen воркер с сервера — чужой:
 * браузер его не запустит (или запустит молча неработающим, как на Tizen 9).
 * Тогда воркер — из Blob: заглушка подставляет к относительным /api адрес
 * сервера и токен входа, а сам воркер подгружает importScripts'ом с сервера.
 */
function tsWorkerUrl(file) {
  var path = file + '?v=' + (window.VERSION || Date.now());
  if (location.search.indexOf('local=1') !== -1) path += '&local=1';
  if (!window.TS_SERVER || !window.Blob || !window.URL || !URL.createObjectURL) {
    return new URL(path, document.baseURI).href;
  }
  var code =
    'self.TS_SERVER = ' + JSON.stringify(SERVER_URL) + ';\n' +
    '(function () {\n' +
    '  var base = self.TS_SERVER, token = ' + JSON.stringify(tsAuthToken()) + ', origFetch = self.fetch;\n' +
    '  self.fetch = function (url, init) {\n' +
    '    if (typeof url === "string" && url.charAt(0) === "/" && url.charAt(1) !== "/") url = base + url;\n' +
    '    if (token && typeof url === "string" && url.indexOf(base + "/") === 0) {\n' +
    '      var opts = {}, k;\n' +
    '      if (init) for (k in init) opts[k] = init[k];\n' +
    '      var headers = new Headers(opts.headers || {});\n' +
    '      if (!headers.has("Authorization")) headers.set("Authorization", "Bearer " + token);\n' +
    '      opts.headers = headers;\n' +
    '      return origFetch.call(self, url, opts);\n' +
    '    }\n' +
    '    return origFetch.call(self, url, init);\n' +
    '  };\n' +
    '})();\n' +
    'importScripts(' + JSON.stringify(SERVER_URL + '/' + path) + ');\n';
  return URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
}

window.tsWorkerUrl = tsWorkerUrl;

// ==================== clientId В ЗАПРОСАХ ====================
//
// Всё, что сервер хранит «по клиенту» (история, таймкоды, дорожки, настройки
// TorrServer), он ищет по clientId из запроса. Без него сервер вычисляет
// идентификатор сам — по IP и браузеру, — и запрос попадает в чужие (пустые)
// данные: так история не синхронизировалась между устройствами аккаунта, хотя
// таймкоды, которые clientId передают, синхронизировались.
//
// В адресе, а не в теле: сервер определяет клиента ещё до разбора тела.
function withClientId(url) {
  var id = null;
  try { id = localStorage.getItem('clientId'); } catch (e) { }
  if (!id) return url;
  return url + (url.indexOf('?') === -1 ? '?' : '&') + 'clientId=' + encodeURIComponent(id);
}

window.withClientId = withClientId;

// ==================== BACKSPACE В ПОЛЕ ВВОДА И ОДИН «НАЗАД» НА НАЖАТИЕ ====================
//
// Код 8 — это и Backspace, и «Назад» пульта Vidaa, поэтому он стоит в
// BACK. Раньше модули разбирали это сами, каждый по-своему: «пока поле не
// пустое — клавиша полю, опустело — это уже „Назад“». На Android TV с
// G-Board это давало тяжёлый сбой: зажали стирание — текст кончился —
// автоповтор того же Backspace превращался в «Назад», фокус с поля снимался,
// клавиатура закрывалась посреди удержания и не получала отпускания, а
// дальше повторы шли пачкой «Назад» по всем экранам. Выглядело как залипшая
// кнопка, помогала только перезагрузка устройства.
//
// Теперь одно правило на всё приложение: пока нативный фокус в текстовом
// поле, Backspace только стирает (действие браузера по умолчанию), и ни один
// обработчик его не видит. Из поля выводят настоящие «Назад» (Esc, пульты
// webOS/Tizen), стрелки и ОК. Встроенная клавиатура (osk.js) нативный фокус с
// поля снимает и клавиши разбирает сама — её это правило не касается.
//
// И второе: зажатый «Назад» срабатывает один раз. Автоповтор его не
// повторяет — иначе удержание кнопки пролистывало бы экраны каскадом.
//
// Перехватчик стоит на window в фазе захвата и регистрируется первым из всех
// (config.js грузится раньше остальных модулей), поэтому
// stopImmediatePropagation отсекает и обработчики на window, и всё остальное.
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
    e.stopImmediatePropagation();   // без preventDefault: стирание делает браузер
    return;
  }

  if (!e.repeat && isKeyPressed('BACK', kc)) startBackHoldExit(kc);

  if (e.repeat && isKeyPressed('BACK', kc)) {
    // Встроенная клавиатура: там удержание «⌫» стирает подряд — пусть
    if (window.OSK && typeof OSK.isOpen === 'function' && OSK.isOpen()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}, true);

// ==================== ВЫХОД ИЗ ПРИЛОЖЕНИЯ: УДЕРЖАНИЕ «НАЗАД» (webOS, Tizen) ====================
//
// Своего «выхода» у приложения на webOS не было: «Назад» (disableBackHistoryAPI
// в appinfo.json) разбирает страница, и с главной оно никуда не ведёт, а Home
// только сворачивает. Теперь «Назад», зажатый на секунду, закрывает приложение
// (window.close() у веб-приложения webOS — выход). Первое нажатие при этом
// отрабатывает как обычно, автоповтор и так гасится выше. Отпустили раньше —
// ничего. Перед выходом встроенный TorrServer гасим сразу (галка «Выключать
// TorrServer при выходе»), не дожидаясь сторожа watch.sh — тот ловит выход
// только через 30–45 с. В приложении для Tizen — так же (выход через
// tizen.application, см. exitApp).
var BACK_HOLD_EXIT_MS = 1000;
var backHoldTimer = null;
var backHoldKey = 0;

function cancelBackHoldExit() {
  if (backHoldTimer) { clearTimeout(backHoldTimer); backHoldTimer = null; }
}

function startBackHoldExit(kc) {
  if ((AppState.platform !== 'webos' && !AppState.tizenApp) || backHoldTimer) return;
  // Удержание «⌫» на встроенной клавиатуре и в поле ввода — это стирание
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
// Окно потеряло фокус (системное меню, другое приложение) — отпускания не будет
window.addEventListener('blur', cancelBackHoldExit);
document.addEventListener('visibilitychange', function () { if (document.hidden) cancelBackHoldExit(); });

var exitingApp = false;

function exitApp() {
  if (exitingApp) return;
  exitingApp = true;
  if (typeof window.showToast === 'function') window.showToast('Выход из TorrStream…');
  var closed = false;
  var close = function () {
    if (closed) return;
    closed = true;
    // Tizen: window.close() веб-приложение не закрывает, выход — через
    // Application API (если Device API у страницы есть, см. detectTizenApp)
    try {
      if (window.tizen && tizen.application) { tizen.application.getCurrentApplication().exit(); return; }
    } catch (e) { }
    try { window.close(); } catch (e) { }
  };
  // Ответа Homebrew Channel ждём не дольше 2,5 с — выход важнее
  setTimeout(close, 2500);
  try {
    if (window.WebOSTorrServer && WebOSTorrServer.enabled()) { WebOSTorrServer.stopForExit(close); return; }
  } catch (e) { }
  close();
}

window.exitApp = exitApp;

// ==================== ЗАКРЫЛИ КЛАВИАТУРУ — СНИМАЕМ ФОКУС С ПОЛЯ (ТЕЛЕФОН) ====================
//
// На новых Android (проверено на 15) жест «Назад» не доходит до страницы, пока
// в WebView стоит фокус в поле ввода: первый свайп закрывает клавиатуру, а
// дальше WebView глотает жест, и страница его не видит, — «назад» не работает,
// пока не ткнёшь пальцем мимо поля. Системная кнопка «Назад» при этом доходит.
//
// Поэтому на сенсорных устройствах, как только клавиатура закрылась, снимаем
// фокус с поля сами. Закрытие видно по высоте окна: с клавиатурой оно ниже,
// без неё — возвращается. Поворот экрана (меняется ширина) не в счёт.
// Телевизоры с пультом (maxTouchPoints = 0) не затрагиваются: там «Назад» в
// поле разбирает control.js.
(function () {
  if (!navigator.maxTouchPoints) return;
  var vv = window.visualViewport;
  var target = vv || window;
  function size() {
    return vv ? { w: Math.round(vv.width), h: Math.round(vv.height) }
              : { w: window.innerWidth, h: window.innerHeight };
  }
  var last = size();
  var keyboardShown = false;
  target.addEventListener('resize', function () {
    var cur = size();
    var a = document.activeElement;
    var editing = isTextEntryElement(a);
    if (cur.w !== last.w) {
      keyboardShown = false;            // поворот, а не клавиатура
    } else if (cur.h < last.h) {
      if (editing) keyboardShown = true;
    } else if (cur.h > last.h && keyboardShown) {
      keyboardShown = false;
      if (editing) { try { a.blur(); } catch (e) { } }
    }
    last = cur;
  });
})();

// ==================== СИСТЕМНАЯ КЛАВИАТУРА ТВ — ШАПКА ПОИСКА НЕ МЕЛЬЧАЕТ ====================
//
// На Tizen родная клавиатура не ложится поверх страницы, а ужимает окно
// браузера. Размеры шапки поиска выбирают @media по высоте/ширине окна, и
// телевизор 1920x1080 на время набора попадал в профиль 720p (max-height:
// 820px) — строка и кнопки становились мелкими как раз тогда, когда в них
// печатают.
//
// Поэтому помним размер окна без клавиатуры (stable). Окно стало меньше, пока
// нативный фокус в текстовом поле, — это клавиатура: на <html> ставим класс
// kbd-<профиль> по stable (kbd-1080 — 1920x1080, kbd-540 — 960x540, ТВ 1080p
// при DPR 2), и css/styles.css держит шапку поиска в размерах этого профиля.
// Окно вернулось — класс снимаем. Обычное изменение размера окна без фокуса в
// поле (монитор, поворот) просто обновляет stable.
//
// Размеры до и во время набора — в «Об устройстве» → «Экран»
// (window.kbdViewportInfo): видно, ужимает ли клавиатура окно и до скольких.
(function () {
  var root = document.documentElement;
  var SHRINK_PX = 60;   // мельче — дрожание окна, а не клавиатура
  function size() { return { w: window.innerWidth, h: window.innerHeight }; }
  function profile(s) {
    if (s.w >= 1400 && s.w <= 2048 && s.h >= 821) return '1080';
    if (s.w >= 720 && s.w <= 1024 && s.h <= 620) return '540';
    return '';
  }
  var stable = size();
  var open = false;
  var cls = '';
  var blurTimer = null;
  var info = window.kbdViewportInfo = { stable: stable, keyboard: null };

  function setState(isOpen) {
    var next = isOpen && profile(stable) ? 'kbd-' + profile(stable) : '';
    if (next !== cls) {
      if (cls) root.classList.remove(cls);
      if (next) root.classList.add(next);
      cls = next;
    }
    open = isOpen;
  }

  function check() {
    var cur = size();
    var shrunk = cur.h < stable.h - SHRINK_PX || cur.w < stable.w - SHRINK_PX;
    // Фокус уже ушёл, а клавиатура ещё уезжает — держим, пока окно не вернётся
    if (shrunk && (open || isTextEntryElement(document.activeElement))) {
      info.keyboard = cur;
      setState(true);
    } else {
      setState(false);
      stable = info.stable = cur;
    }
  }

  window.addEventListener('resize', check);
  document.addEventListener('focusin', check);
  // Поле потеряло фокус, а окно так и не вернулось (клавиатуру закрыли без
  // resize или окно действительно изменили) — через 1,5 с считаем новый размер
  // обычным
  document.addEventListener('focusout', function () {
    if (blurTimer) clearTimeout(blurTimer);
    blurTimer = setTimeout(function () {
      blurTimer = null;
      if (!open || isTextEntryElement(document.activeElement)) return;
      setState(false);
      stable = info.stable = size();
    }, 1500);
  });
})();
