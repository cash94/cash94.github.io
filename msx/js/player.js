// Функции плеера
// Переменные для хранения информации о сериях
var currentEpisodeFiles = [];
var currentEpisodeIndex = 0;
var currentTorrentHash = null;
var lastCleanedSegment = -1;
var nearEndCheckInterval = null;
var thisisseek = false;

// Константы конфигурации
var BUFFER_TARGET_SEC = 10;
var LOADING_TIMEOUT_MS = 15000;
var EPISODES_LOAD_DELAY_MS = 1000;
var EPISODES_LOAD_DELAY_SEARCH_MS = 1600;
// Сколько ветка AndroidJS ждёт названий серий из TMDB перед запуском плеера
var ANDROID_EPISODE_META_WAIT_MS = 2500;
var MAX_PLAYBACK_RETRIES = 3;

/**
 * Сколько ждём ответа TorrStream по служебным запросам плеера.
 *
 * Все они (/api/file/info, дорожки, субтитры, таймкод, создание HLS-потока)
 * идут к нашему серверу, а тот — к TorrServer. Если лежит любой из двух, fetch
 * без ограничения висит столько, сколько отмерит системный стек TCP: на
 * телевизоре это минуты чёрного экрана с оверлеем «Воспроизведение…».
 * Пятнадцати секунд живой связке хватает даже на медленном канале.
 */
var PLAYER_FETCH_TIMEOUT_MS = 15000;

/**
 * Отдельный, заметно больший таймаут для /api/file/info.
 *
 * Там сервер запускает ffprobe по сети на TorrServer, и первая проба холодной
 * раздачи спокойно уходит за 15 с: TorrServer ищет пиров и тянет голову файла.
 * Сервер на такой случай пробует ещё раз с дедлайном 40 с (services/probe.js),
 * и общий таймаут запроса обязан этот бюджет перекрывать — иначе клиент
 * оборвёт пробу ровно перед тем, как она удастся.
 */
var FILE_INFO_FETCH_TIMEOUT_MS = 60000;

/**
 * Прямой файл и gst сведения ffprobe для запуска не используют (названия
 * дорожек у прямого файла — свои источники, directProbeStart), а сервер в
 * /api/playback/prepare пробует TorrServer из настроек аккаунта: TorrServer
 * на устройстве (localhost, адрес в домашней сети, «Свой TorrServer») ему
 * недоступен, и запуск ждал таймаут пробы — 15 с и повтор. Здесь ждём
 * недолго, дальше — таймкод и дорожки отдельными быстрыми запросами; проба
 * на сервере идёт своим чередом и ложится в кэш к следующему запуску.
 */
var DIRECT_PREPARE_TIMEOUT_MS = 4000;

/** Сколько раз подряд переподключаемся после сетевой ошибки HLS, прежде чем сдаться */
var MAX_HLS_NETWORK_RETRIES = 5;

// Переменные для таймкода
var timecodeSaveInterval = null;
var currentTimecodeData = {
  hash: null,
  fileId: null,
  timecode: 0,
  duration: 0
};

// Переменные для скрытия элементов
var mouseIdleTimer = null;
var IDLE_TIMEOUT = 4000; // 4 секунды без нажатий и движения мыши — панель плеера гаснет

// Переменные для хранения информации об аудиодорожках
var currentAudioTracks = [];
var currentSubTracks = [];
var currentAudioTrack = 0;
var currentSubtitleTrack = -1; // -1 означает "выключены"
var currentFileInfo = null;
var heartbeatInterval = null;
var currentBufferAhead = 0;
var wasImmediatePause = false;
var pauseTimer = null;
var pauseStartTime = null;
var PAUSE_THRESHOLD = 60000; // 1 минута

// Для отмены воспроизведения
var currentPlaybackController = null;
var skipData = [];
// Для какой серии skipData: «tmdbId_сезон_серия» (fetchSkipData)
var skipDataKey = '';

// Переменные для кнопки пропуска
var skipButton = null;
var skipButtonTimeout = null;
var currentSkipData = null;
var skipButtonActive = false;
var currentSkipInfo = null;
var currentSkipRangeKey = null;
var skipIntro = 0;
var skipCredits = 0;

/**
 * fetch с ограничением по времени. Возвращает то же, что обычный fetch,
 * но по истечении timeout запрос прерывается и наружу летит AbortError.
 *
 * Свой сигнал вызывающей стороны (отмена воспроизведения) не теряется:
 * подписываемся на него и прерываем запрос вместе с ним.
 */
function fetchWithTimeout(url, options, timeoutMs) {
  options = options || {};
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs || PLAYER_FETCH_TIMEOUT_MS);
  var outer = options.signal;
  var onOuterAbort = function () { controller.abort(); };
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', onOuterAbort);
  }
  var opts = Object.assign({}, options, { signal: controller.signal });
  // Через фоновый поток (BgFetch в poster-prefetch.js): file/info, prepare,
  // создание потока, таймкоды, дорожки — запрос и разбор JSON в воркере
  return (typeof bgFetch === 'function' ? bgFetch(url, opts) : fetch(url, opts)).finally(function () {
    clearTimeout(timer);
    if (outer) outer.removeEventListener('abort', onOuterAbort);
  });
}
window.fetchWithTimeout = fetchWithTimeout;

/**
 * Баннер «воспроизведение не поднялось».
 *
 * Раньше на этом месте стоял alert(), а он на телевизоре не показывается вовсе:
 * человек жал «смотреть», получал чёрный экран плеера — и всё. Причина у отказа
 * почти всегда одна из двух, и различить их снаружи нельзя: либо не отвечает
 * наш сервер, либо TorrServer не отдал ему данные о файле.
 */
function showPlaybackUnavailableBanner(detail) {
  var text = 'TorrServer недоступен или TorrStream не смог получить информацию от TorrServer. ' +
    'Попробуйте перезапустить данный контент или выбрать другую раздачу.';
  if (typeof window.showErrorBanner === 'function') {
    window.showErrorBanner('Не удалось начать воспроизведение', text);
  } else {
    alert(text + (detail ? '\n\n' + detail : ''));
  }
  if (detail) console.warn('▶️ Воспроизведение не поднялось:', detail);
}
window.showPlaybackUnavailableBanner = showPlaybackUnavailableBanner;

/**
 * Не удалось переключить серию / дорожку / субтитры.
 *
 * Все три пути перезапускают воспроизведение, поэтому и падают они по одной
 * причине — связка TorrStream + TorrServer не ответила. Раньше на каждом стоял
 * свой alert(), то есть на телевизоре — ничего: оверлей «Переключение…» гас, а
 * почему ничего не переключилось, узнать было неоткуда.
 */
function showSwitchFailedBanner(what, detail) {
  if (typeof window.showErrorBanner === 'function') {
    window.showErrorBanner('Не удалось переключить ' + what,
      'TorrServer недоступен или TorrStream не смог получить информацию от TorrServer. ' +
      'Попробуйте перезапустить данный контент или выбрать другую раздачу.');
  } else alert('Ошибка при переключении: ' + what);
  if (detail) console.warn('🔀 Переключение (' + what + ') не удалось:', detail);
}
window.showSwitchFailedBanner = showSwitchFailedBanner;

// ==================== ОВЕРЛЕИ И ПОЛНОЭКРАННЫЙ РЕЖИМ ====================
/**
 * В полноэкранном режиме браузер рисует ТОЛЬКО полноэкранный элемент и его
 * потомков. Оверлеи плеера — #playback-overlay («Переключение на серию…»),
 * #loading-overlay и кнопка пропуска — лежат в <body> рядом с #player-screen,
 * поэтому раньше в fullscreen их просто не было видно: серия переключалась
 * молча, без единого сообщения.
 *
 * Держим их внутри текущего полноэкранного элемента и возвращаем на место при
 * выходе. Перенос узла сохраняет и слушатели, и классы, а клики по ним и так
 * ловит делегирование на document (CLICKABLE_SELECTORS в app.js).
 *
 * Само окно на весь экран app.js просит у document.documentElement — тогда
 * переносить обычно нечего. Этот код нужен для случаев, когда полноэкранным
 * стал другой элемент: часть ТВ-браузеров сама разворачивает <video> или
 * #player-screen.
 */
var FS_OVERLAY_IDS = ['playback-overlay', 'loading-overlay', 'skip-button'];
var fsOverlayHome = {};

function getFullscreenEl() {
  return document.fullscreenElement || document.webkitFullscreenElement ||
    document.mozFullScreenElement || document.msFullscreenElement || null;
}

/** Куда вешать оверлей, чтобы он был виден и в обычном режиме, и в fullscreen */
function getOverlayHost() {
  var fs = getFullscreenEl();
  if (fs && fs !== document.documentElement && fs !== document.body) return fs;
  return document.body;
}
window.getOverlayHost = getOverlayHost;

function syncFullscreenOverlays() {
  var host = getOverlayHost();
  for (var i = 0; i < FS_OVERLAY_IDS.length; i++) {
    var id = FS_OVERLAY_IDS[i];
    var el = document.getElementById(id);
    if (!el) continue;
    if (!fsOverlayHome[id]) fsOverlayHome[id] = el.parentNode || document.body;
    var target = (host === document.body) ? fsOverlayHome[id] : host;
    if (el.parentNode !== target) target.appendChild(el);
  }
}
window.syncFullscreenOverlays = syncFullscreenOverlays;

document.addEventListener('fullscreenchange', syncFullscreenOverlays);
document.addEventListener('webkitfullscreenchange', syncFullscreenOverlays);
// Часть ТВ-браузеров шлёт только свой префикс — без этих двух кнопка
// «Пропустить» оставалась в <body> и в полноэкранном режиме была не видна
document.addEventListener('mozfullscreenchange', syncFullscreenOverlays);
document.addEventListener('MSFullscreenChange', syncFullscreenOverlays);

/**
 * Кнопка «Пропустить вступление / титры».
 *
 * До сих пор она отвечала только пульту: нажатие OK ловил обработчик keydown в
 * control.js, а собственного слушателя у кнопки не было — ни клик мышью, ни тап
 * пальцем не делали ничего. Тач-делегирование в app.js доводило тап до
 * targetToClick.click(), но click-а никто не слушал, и вызов уходил в пустоту.
 *
 * Слушатель вешаем на сам узел, а не на document: в полноэкранном режиме
 * syncFullscreenOverlays переносит кнопку внутрь полноэкранного элемента, и
 * при переносе узла слушатели сохраняются — значит работает и там.
 */
function createSkipButton() {
  if (skipButton) {
    skipButton.remove();
    skipButton = null;
  }
  skipButton = document.createElement('div');
  skipButton.id = 'skip-button';
  skipButton.className = 'skip-button hidden';
  skipButton.innerHTML = '⏩ Пропустить';
  // Кнопка по смыслу, а не по тегу: без role/tabindex её не видят ни
  // скринридеры, ни нативная фокусировка в полноэкранном режиме
  skipButton.setAttribute('role', 'button');
  skipButton.setAttribute('tabindex', '0');

  skipButton.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (typeof window.executeSkip === 'function') window.executeSkip();
  });

  // Пояс к делегированию в app.js: часть ТВ-браузеров после touchend не
  // досылает синтетический click, и тап остался бы без ответа. Двойного
  // срабатывания не будет — executeSkip первым делом гасит кнопку и снимает
  // skipButtonActive, а без него сразу возвращает false. Всплытие не
  // останавливаем: следом должен отработать app.js и снять .touch-active.
  skipButton.addEventListener('touchend', function (e) {
    if (e.cancelable) e.preventDefault();
    if (typeof window.executeSkip === 'function') window.executeSkip();
  }, { passive: false });

  // В <body>, а не сразу в полноэкранный элемент, — и только потом отдаём
  // syncFullscreenOverlays. Тот при первом переносе запоминает родителя как
  // «дом», куда вернуть оверлей при выходе из fullscreen; создай мы кнопку
  // внутри полноэкранного <video>, домом стал бы он — и после выхода кнопка
  // уехала бы внутрь видео, где её не видно вовсе.
  document.body.appendChild(skipButton);
  syncFullscreenOverlays();
  return skipButton;
}

/**
 * Автопропуск заставки и титров (настройка «Автопропуск заставки и титров»,
 * AppState.autoSkipIntro — имя и ключ localStorage прежние, с тех пор как она
 * пропускала одну заставку). Переключается в разделе «Плеер» и в шестерёнке.
 *
 * Вместо «нажми, чтобы пропустить» кнопка отсчитывает AUTO_SKIP_INTRO_SEC и
 * пропускает сама, а нажатие на неё — наоборот, отменяет: заставку или титры
 * хотят посмотреть. Пока видео на паузе, отсчёт стоит — иначе, поставив на
 * паузу в начале заставки, человек возвращался бы уже после неё.
 *
 * Пропуск титров — это переход на следующую серию, поэтому сам он идёт, только
 * если она есть. В фильме и последней серии — обычная кнопка.
 */
var AUTO_SKIP_INTRO_SEC = 5;
var autoSkipTimer = null;
var autoSkipLeft = 0;

function hasNextEpisode() {
  return currentEpisodeFiles.length > 0 && currentEpisodeIndex !== undefined &&
    currentEpisodeIndex + 1 < currentEpisodeFiles.length;
}

function shouldAutoSkip(type) {
  if (!AppState.autoSkipIntro) return false;
  return type === 'intro' || (type === 'credits' && hasNextEpisode());
}

function skipButtonText(type) {
  return type === 'intro' ? '⏩ Пропустить вступление' : '⏩ Пропустить титры';
}

function autoSkipLabel() {
  if (currentSkipInfo && currentSkipInfo.type === 'credits') {
    return '⏭ Следующая серия через ' + autoSkipLeft + ' · ОК — смотреть титры';
  }
  return '⏩ Пропуск заставки через ' + autoSkipLeft + ' · ОК — смотреть';
}

function startAutoSkipCountdown() {
  stopAutoSkipCountdown();
  autoSkipLeft = AUTO_SKIP_INTRO_SEC;
  if (skipButton) skipButton.innerHTML = autoSkipLabel();
  autoSkipTimer = setInterval(function () {
    if (!skipButtonActive || !currentSkipInfo) { stopAutoSkipCountdown(); return; }
    var videoPlayer = getEl('video-player');
    if (videoPlayer && videoPlayer.paused) return;
    autoSkipLeft--;
    if (autoSkipLeft <= 0) {
      stopAutoSkipCountdown();
      console.log('⏩ Автопропуск:', currentSkipInfo.type === 'intro' ? 'заставка' : 'титры');
      performSkip();
      return;
    }
    if (skipButton) skipButton.innerHTML = autoSkipLabel();
  }, 1000);
}

function stopAutoSkipCountdown() {
  if (autoSkipTimer) { clearInterval(autoSkipTimer); autoSkipTimer = null; }
}

/**
 * Настройку переключили, пока кнопка пропуска на экране (шестерёнка плеера):
 * включили — заводим отсчёт, выключили — кнопка снова обычная, на 10 секунд
 */
function syncAutoSkipCountdown() {
  if (!skipButtonActive || !currentSkipInfo) return;
  var want = shouldAutoSkip(currentSkipInfo.type);
  if (want && !autoSkipTimer) {
    if (skipButtonTimeout) { clearTimeout(skipButtonTimeout); skipButtonTimeout = null; }
    startAutoSkipCountdown();
  } else if (!want && autoSkipTimer) {
    stopAutoSkipCountdown();
    if (skipButton) skipButton.innerHTML = skipButtonText(currentSkipInfo.type);
    skipButtonTimeout = setTimeout(function () { hideSkipButton(); }, 10000);
  }
}
window.syncAutoSkipCountdown = syncAutoSkipCountdown;

window.executeSkip = function () {
  if (!skipButtonActive || !currentSkipInfo) return false;
  // Идёт автоотсчёт — нажатие значит «не пропускай»
  if (autoSkipTimer) {
    console.log('⏩ Автопропуск отменён:', currentSkipInfo.type === 'intro' ? 'заставка' : 'титры');
    hideSkipButton();
    return true;
  }
  return performSkip();
};

function performSkip() {
  if (!skipButtonActive || !currentSkipInfo) return false;
  var videoPlayer = getEl('video-player');
  if (!videoPlayer) return false;
  if (currentSkipInfo && currentSkipInfo.type === 'intro') {
    var seekTime = currentSkipInfo.endMs / 1000;
    seekStream(seekTime, 'slider');
    console.log('⏩ Пропуск интро, перемотка на ' + formatTime(seekTime));
  } else if (currentSkipInfo && currentSkipInfo.type === 'credits') {
    console.log('⏩ Пропуск титров, переключение на следующую серию');
    nextEpisode();
  }
  hideSkipButton();
  return true;
}

function showSkipButton(type, startMs, endMs) {
  if (!skipButton) createSkipButton();
  // В полноэкранный режим могли войти событием, о котором нам не сообщили
  // (у префиксов разный набор). Кнопка вне полноэкранного элемента не видна
  // вовсе, поэтому хост сверяем на каждом показе, а не только по событию.
  syncFullscreenOverlays();
  var rangeKey = type + '' + startMs + '' + endMs;
  if (skipButtonActive && currentSkipRangeKey === rangeKey) return;
  if (skipButtonActive) hideSkipButton();
  if (skipButtonTimeout) {
    clearTimeout(skipButtonTimeout);
    skipButtonTimeout = null;
  }
  skipButton.classList.remove('filled');
  skipButton.innerHTML = skipButtonText(type);
  skipButton.classList.remove('hidden');
  skipButton.classList.add('visible');
  skipButton.style.display = 'flex';
  currentSkipInfo = { type: type, startMs: startMs, endMs: endMs };
  currentSkipRangeKey = rangeKey;
  skipButtonActive = true;
  if (typeof window.focusEl === 'function') window.focusEl(skipButton);

  if (shouldAutoSkip(type)) {
    // Своё время жизни у кнопки в этом режиме — отсчёт. Десятисекундного
    // автоскрытия нет: на паузе отсчёт стоит, и кнопка должна его дождаться.
    startAutoSkipCountdown();
  } else {
    skipButtonTimeout = setTimeout(function () { hideSkipButton(); }, 10000);
  }
  setTimeout(function () {
    if (skipButton && skipButtonActive) skipButton.classList.add('filled');
  }, 50);
  console.log('🎬 Показана кнопка пропуска:', type, 'старт:', (startMs / 1000).toFixed(1), 'сек, конец:', (endMs / 1000).toFixed(1), 'сек');
}

function hideSkipButton() {
  stopAutoSkipCountdown();
  if (skipButton) {
    skipButton.classList.add('hidden');
    skipButton.classList.remove('visible');
    skipButton.classList.remove('focused');
    skipButton.style.display = 'none';
  }
  if (skipButtonTimeout) {
    clearTimeout(skipButtonTimeout);
    skipButtonTimeout = null;
  }
  skipButtonActive = false;
  currentSkipInfo = null;
  currentSkipRangeKey = null;
  if (typeof window.updateFocusableElements === 'function') {
    setTimeout(function () { window.updateFocusableElements(); }, 50);
  }
}

function checkAndShowSkipButton(currentTimeSec) {
  if (!skipData || skipData.error) {
    if (skipButtonActive) hideSkipButton();
    return;
  }
  var currentTimeMs = currentTimeSec * 1000;
  var videoPlayer = getEl('video-player');
  if (!videoPlayer) return;
  var totalDuration = AppState.originalDuration || AppState.expectedDuration || videoPlayer.duration;
  var totalDurationMs = totalDuration * 1000;
  var inAnyRange = false;
  var newRangeKey = null, newType = null, newStartMs = null, newEndMs = null;

  if (skipData.intro && Array.isArray(skipData.intro) && skipData.intro.length > 0) {
    for (var i = 0; i < skipData.intro.length; i++) {
      var intro = skipData.intro[i];
      var introStartMs = (intro.start_ms !== null && intro.start_ms !== undefined) ? intro.start_ms : 0;
      var introEndMs = (intro.end_ms !== null && intro.end_ms !== undefined) ? intro.end_ms : 0;
      if (currentTimeMs >= introStartMs && currentTimeMs <= introEndMs) {
        inAnyRange = true;
        newRangeKey = 'intro_' + introStartMs + '_' + introEndMs;
        newType = 'intro'; newStartMs = introStartMs; newEndMs = introEndMs;
        skipIntro = skipIntro + 1;
        break;
      }
    }
  }

  if (!inAnyRange && skipData.credits && Array.isArray(skipData.credits) && skipData.credits.length > 0) {
    for (var j = 0; j < skipData.credits.length; j++) {
      var credits = skipData.credits[j];
      var creditsStartMs = (credits.start_ms !== null && credits.start_ms !== undefined) ? credits.start_ms : 0;
      var creditsEndMs = (credits.end_ms !== null && credits.end_ms !== undefined) ? credits.end_ms : totalDurationMs;
      if (currentTimeMs >= creditsStartMs && currentTimeMs <= creditsEndMs) {
        inAnyRange = true;
        newRangeKey = 'credits_' + creditsStartMs + '_' + creditsEndMs;
        newType = 'credits'; newStartMs = creditsStartMs; newEndMs = credits.end_ms;
        skipCredits = skipCredits + 1;
        break;
      }
    }
  }

  if (inAnyRange) {
    if (!skipButtonActive || currentSkipRangeKey !== newRangeKey) {
      if (skipIntro == 1 || skipCredits == 1) showSkipButton(newType, newStartMs, newEndMs);
    }
  } else if (skipButtonActive) {
    hideSkipButton();
  }
}

function startHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(function () {
    if (AppState.currentStreamId && AppState.currentScreen === 'player') {
      bgFetch(SERVER_URL + '/hls/activity/' + AppState.currentStreamId, { method: 'POST' })['catch'](function (e) {
        console.log('⚠️ Heartbeat error:', e);
      });
    }
  }, 20000);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

document.addEventListener('DOMContentLoaded', function () {
  var episodesBtn = getEl('episodes-btn');
  if (episodesBtn) episodesBtn.style.display = 'none';
  var prevBtn = getEl('prev-episode-btn');
  var nextBtn = getEl('next-episode-btn');
  if (prevBtn) prevBtn.style.display = 'none';
  if (nextBtn) nextBtn.style.display = 'none';
});

/** Недоступная кнопка управления: гасится классом, .control-btn.is-disabled */
function setControlDisabled(btn, disabled) {
  if (!btn) return;
  if (disabled) btn.classList.add('is-disabled');
  else btn.classList.remove('is-disabled');
}

function updateEpisodeButtons() {
  var prevBtn = getEl('prev-episode-btn');
  var nextBtn = getEl('next-episode-btn');
  if (!prevBtn || !nextBtn) return;
  var filesLen = currentEpisodeFiles.length;
  if (filesLen > 0) {
    prevBtn.style.display = 'flex';
    nextBtn.style.display = 'flex';
    // Класс, а не inline-стиль: гашение по бездействию (setPlayerControlsIdle)
    // переписывает opacity всем кнопкам подряд, и «серым» кнопкам возвращался
    // полный цвет — недоступная кнопка выглядела рабочей
    setControlDisabled(prevBtn, currentEpisodeIndex === 0);
    setControlDisabled(nextBtn, currentEpisodeIndex === filesLen - 1);
  } else {
    prevBtn.style.display = 'none';
    nextBtn.style.display = 'none';
  }
}

/**
 * Браузер не дал запустить видео со звуком (политика автозапуска), и плеер
 * включил его без звука. Кнопки звука на панели больше нет, поэтому звук
 * возвращаем на первое же нажатие или клик в плеере: это жест пользователя, и
 * после него браузер звук разрешает. Зовут только пути автозапуска — не
 * кнопка MUTE пульта, иначе намеренно выключенный звук включался бы сам.
 */
var soundGestureArmed = false;
function restoreSoundOnGesture() {
  var video = getEl('video-player');
  if (!video || !video.muted || soundGestureArmed) return;
  soundGestureArmed = true;
  var unmute = function () {
    document.removeEventListener('keydown', unmute, true);
    document.removeEventListener('click', unmute, true);
    soundGestureArmed = false;
    if (AppState.currentScreen === 'player') video.muted = false;
  };
  document.addEventListener('keydown', unmute, true);
  document.addEventListener('click', unmute, true);
}

function updatePlayerTitle(title) {
  var titleElement = getEl('player-title');
  var controlsContainer = getEl('controls-container');
  if (!titleElement) return;
  if (title) {
    titleElement.textContent = title;
    titleElement.dataset.hasTitle = '1';
    if (controlsContainer && controlsContainer.classList.contains('idle-hidden')) {
      titleElement.classList.add('hidden', 'idle-hidden');
    } else {
      titleElement.classList.remove('hidden', 'idle-hidden');
    }
  } else {
    titleElement.dataset.hasTitle = '';
    titleElement.classList.add('hidden', 'idle-hidden');
  }
}

function syncPlayerTitleVisibility(forceVisible) {
  if (forceVisible === undefined) forceVisible = null;
  var titleElement = getEl('player-title');
  var subtitleElement = getEl('player-subtitle');
  var controlsContainer = getEl('controls-container');
  if (!titleElement) return;
  var hasTitle = !!titleElement.dataset.hasTitle;
  if (!hasTitle) {
    titleElement.classList.add('hidden', 'idle-hidden');
    if (subtitleElement) subtitleElement.classList.add('hidden', 'idle-hidden');
    return;
  }
  var shouldShow = forceVisible === null ? !!(controlsContainer && !controlsContainer.classList.contains('idle-hidden')) : !!forceVisible;
  if (shouldShow) {
    titleElement.classList.remove('hidden', 'idle-hidden');
    if (subtitleElement) subtitleElement.classList.remove('hidden', 'idle-hidden');
  } else {
    titleElement.classList.add('hidden', 'idle-hidden');
    if (subtitleElement) subtitleElement.classList.add('hidden', 'idle-hidden');
  }
}
window.syncPlayerTitleVisibility = syncPlayerTitleVisibility;

async function getFileNameByHash(hash, fileId) {
  if (!hash || !fileId) return null;
  var torrent = null;
  for (var i = 0; i < AppState.torrents.length; i++) {
    if (AppState.torrents[i].hash && AppState.torrents[i].hash.toLowerCase() === hash.toLowerCase()) {
      torrent = AppState.torrents[i];
      break;
    }
  }
  if (!torrent) return null;
  var files = [];
  if (torrent.file_stats && Array.isArray(torrent.file_stats)) files = torrent.file_stats;
  else if (torrent.data) {
    try {
      var data = JSON.parse(torrent.data);
      if (data.TorrServer && data.TorrServer.Files) files = data.TorrServer.Files;
    } catch (e) { }
  }
  for (var j = 0; j < files.length; j++) {
    if (files[j].id == fileId) return files[j].path.split('/').pop() || ('Файл ' + fileId);
  }
  return null;
}

/**
 * Элементы, которые гаснут вместе с панелью управления. Список статический,
 * поэтому собираем его один раз: resetMouseIdleTimer зовётся на КАЖДОЕ движение
 * мыши и нажатие пульта, и десять getElementById + переписывание inline-стилей
 * на каждый вызов на ТВ заметны.
 */
var idleControlEls = null;

function getIdleControlEls() {
  if (idleControlEls) return idleControlEls;
  // Кнопки панели здесь не нужны: они внутри #controls-container и гаснут с ним
  var ids = ['controls-container', 'buffer-stats', 'player-hint',
    'exit-player-btn', 'player-title'];
  var list = [];
  for (var i = 0; i < ids.length; i++) { var el = getEl(ids[i]); if (el) list.push(el); }
  if (list.length) idleControlEls = list;   // пусто — DOM ещё не готов, попробуем позже
  return list;
}

/**
 * Гасим и показываем только классом idle-hidden — под него в styles.css уже
 * прописаны opacity и pointer-events с !important. Раньше тут вдобавок
 * переписывались inline-стили, и они спорили с hidePlayerControls/
 * showPlayerControls из control.js, которые работают ровно с этим классом.
 *
 * Кнопки внутри #controls-container (аудио, субтитры, буфер, серии) отдельно
 * трогать незачем: гаснет контейнер — гаснут и они.
 */
function setPlayerControlsIdle(hidden) {
  var els = getIdleControlEls();
  for (var i = 0; i < els.length; i++) {
    if (hidden) els[i].classList.add('idle-hidden');
    else els[i].classList.remove('idle-hidden');
  }
  syncPlayerTitleVisibility(!hidden);
  setPlayerCursorHidden(hidden);
}
window.setPlayerControlsIdle = setPlayerControlsIdle;

/**
 * Курсор мыши над плеером прячется вместе с панелью и возвращается с ней
 * (движение мыши → resetMouseIdleTimer). Зовут и отсюда, и control.js
 * (hidePlayerControls / showPlayerControls — панель с пульта).
 */
function setPlayerCursorHidden(hidden) {
  var ps = getEl('player-screen');
  if (ps) ps.classList.toggle('player-cursor-hidden', !!hidden);
}
window.setPlayerCursorHidden = setPlayerCursorHidden;

// Движение мыши не показывает HUD до этого момента. На webOS аэромышь пульта
// двигает курсор от малейшего движения руки, и HUD, который «Назад» только что
// спрятал, тут же возвращался (control.js: playerBackPress). Глушим только
// движение — клики и нажатия пульта работают как обычно.
var playerMouseMuteUntil = 0;
function mutePlayerMouse(ms) { playerMouseMuteUntil = Date.now() + ms; }
function isPlayerMouseMuted() { return Date.now() < playerMouseMuteUntil; }
/** Движение мыши над плеером: показать HUD, если движение сейчас не заглушено. */
function onPlayerMouseMove() {
  if (!isPlayerMouseMuted()) resetMouseIdleTimer();
}

function resetMouseIdleTimer() {
  var playerScreen = getEl('player-screen');
  if (!playerScreen || playerScreen.style.display !== 'block') return;
  var playerOverlay = getEl('player-overlay');
  if (playerOverlay) playerOverlay.classList.add('touch-active');

  // Классы трогаем, только если панель действительно спрятана. Раньше на
  // каждое нажатие пульта переписывались inline-стили десяти элементов подряд.
  // Состояние читаем из DOM, а не из своего флага: панель прячет и показывает
  // ещё и control.js (hidePlayerControls / showPlayerControls).
  var controls = getEl('controls-container');
  if (!controls || controls.classList.contains('idle-hidden')) setPlayerControlsIdle(false);

  if (mouseIdleTimer) clearTimeout(mouseIdleTimer);
  mouseIdleTimer = null;
  // «Скрывать вручную»: таймера нет, HUD убирают «Назад» или «вверх» с
  // ползунка (control.js). Боковые панели тоже остаются — их закрывает «Назад»
  if (AppState.playerManualHide) return;
  mouseIdleTimer = setTimeout(function () {
    if (playerScreen.style.display !== 'block') return;
    // Подбирают задержку онлайн-субтитров: смотрят на реплики и жмут
    // «раньше/позже» — панель не гасим, закроют «Назад»
    if (isPlayerPanelOpen('onlinesubs')) { mouseIdleTimer = null; return; }
    if (playerOverlay) playerOverlay.classList.remove('touch-active');
    closePlayerPanelsOnIdle();
    setPlayerControlsIdle(true);
  }, IDLE_TIMEOUT);
}

/**
 * HUD гаснет по бездействию — боковая панель (серии, дорожки, настройки)
 * закрывается вместе с ним. Раньше она оставалась висеть поверх видео без
 * HUD, и убрать её можно было только «Назад».
 *
 * Фокус из панели снимаем: иначе он остался бы на скрытом пункте, и следующее
 * нажатие пульта ходило бы по списку, которого на экране нет. Без фокуса
 * первое же нажатие покажет HUD с фокусом на воспроизведении (control.js:
 * showPlayerControls).
 */
function closePlayerPanelsOnIdle() {
  var panel = getOpenPlayerPanel();
  if (!panel) return;
  var focused = panel.querySelectorAll('.focused');
  for (var i = 0; i < focused.length; i++) focused[i].classList.remove('focused');
  closePlayerPanels();
  if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
}

/**
 * Прокрутка списка в панели — тоже действие пользователя: пульт и мышь
 * таймер бездействия перезапускают сами, а прокрутка пальцем или колесом —
 * нет, и длинный список серий закрывался бы прямо под пальцем.
 */
function setupPlayerPanelsActivity() {
  if (setupPlayerPanelsActivity._bound) return;
  setupPlayerPanelsActivity._bound = true;
  var seen = {};
  for (var name in PLAYER_PANELS) {
    var id = PLAYER_PANELS[name].panel;
    var panel = getEl(id);
    if (!panel || seen[id]) continue;
    seen[id] = true;
    panel.addEventListener('touchstart', resetMouseIdleTimer, { passive: true });
    panel.addEventListener('touchmove', resetMouseIdleTimer, { passive: true });
    panel.addEventListener('wheel', resetMouseIdleTimer, { passive: true });
    // scroll не всплывает — ловим на погружении, со списков внутри панели
    panel.addEventListener('scroll', resetMouseIdleTimer, true);
  }
}

function nextEpisode() {
  currentBufferAhead = 0; wasImmediatePause = false; pauseTimer = null; pauseStartTime = null;
  if (currentEpisodeFiles.length === 0 || currentEpisodeIndex === undefined) return;
  var nextIndex = currentEpisodeIndex + 1;
  if (nextIndex < currentEpisodeFiles.length) switchToEpisode(nextIndex, currentEpisodeFiles[nextIndex].id);
}

function prevEpisode() {
  currentBufferAhead = 0; wasImmediatePause = false; pauseTimer = null; pauseStartTime = null;
  if (currentEpisodeFiles.length === 0 || currentEpisodeIndex === undefined) return;
  var prevIndex = currentEpisodeIndex - 1;
  if (prevIndex >= 0) switchToEpisode(prevIndex, currentEpisodeFiles[prevIndex].id);
}

function showPlayerLoading(message, targetTime) {
  if (message === undefined) message = 'Перемотка...';
  if (targetTime === undefined) targetTime = null;
  var overlay = getEl('loading-player-overlay');
  var playerOverlay = getEl('player-overlay');
  var loadingTime = getEl('loading-time');
  overlay.classList.add('active');
  playerOverlay.classList.add('loading');
  if (targetTime !== null && !isNaN(targetTime)) {
    loadingTime.textContent = formatTime(targetTime);
    loadingTime.style.display = 'block';
  } else {
    loadingTime.style.display = 'none';
  }
  document.querySelector('.loading-player-text').textContent = message;
}

function hidePlayerLoading() {
  var overlay = getEl('loading-player-overlay');
  var playerOverlay = getEl('player-overlay');
  if (overlay) overlay.classList.remove('active');
  if (playerOverlay) playerOverlay.classList.remove('loading');
}

function updateTimeDisplay() {
  var currentTimeSpan = getEl('current-time');
  var durationSpan = getEl('duration-time');
  var seekSlider = getEl('seek-slider');
  var videoPlayer = getEl('video-player');
  if (!currentTimeSpan || !durationSpan || !videoPlayer) return;
  if (AppState.isSeeking || AppState.isSliderDragging) return;

  var absoluteTime = videoPlayer.currentTime + AppState.seekOffset;
  currentTimeSpan.textContent = formatTime(absoluteTime);
  if (currentTimecodeData.hash && currentTimecodeData.fileId) currentTimecodeData.timecode = absoluteTime;

  var totalDuration = AppState.originalDuration || AppState.expectedDuration || videoPlayer.duration;
  durationSpan.textContent = formatTime(totalDuration);
  if (totalDuration && isFinite(totalDuration) && totalDuration > 0) currentTimecodeData.duration = totalDuration;
  if (seekSlider) seekSlider.max = totalDuration || 0;
}

function updatePlayPauseButton() {
  var btn = getEl('play-pause-btn');
  var videoPlayer = getEl('video-player');
  if (!btn || !videoPlayer) return;
  // В кнопке лежат обе иконки, видна одна — по классу (styles.css: .hud-play)
  btn.classList.toggle('is-paused', !!videoPlayer.paused);
  btn.title = videoPlayer.paused ? 'Воспроизвести' : 'Пауза';
}

/**
 * Прогрев следующей серии, пока досматривается текущая.
 *
 * Переход на следующую серию (автоматически по окончании, «Пропустить титры»,
 * кнопка ▶▶) раньше начинался с холодной раздачи: TorrServer только тогда
 * начинал тянуть её голову, а сервер — пробовать файл, и человек смотрел на
 * «Переключение на серию…» те же секунды, что при первом запуске. За три
 * минуты до конца делаем обе вещи заранее: preload в TorrServer и
 * /api/file/info — сервер положит пробу в кэш навсегда, и к переходу
 * /api/playback/prepare ответит сразу.
 *
 * Одна попытка на серию. Ролики короче шести минут не трогаем: там «за три
 * минуты до конца» — это почти сразу после старта.
 */
var NEXT_EPISODE_WARMUP_SEC = 180;
var warmedNextEpisodeKey = null;

function maybeWarmNextEpisode(absoluteTime) {
  if (!currentTorrentHash || !currentEpisodeFiles || !currentEpisodeFiles.length) return;
  var next = currentEpisodeFiles[currentEpisodeIndex + 1];
  if (!next || !next.id) return;
  var videoPlayer = getEl('video-player');
  var total = AppState.originalDuration || AppState.expectedDuration || (videoPlayer && videoPlayer.duration);
  if (!total || !isFinite(total) || total < 2 * NEXT_EPISODE_WARMUP_SEC) return;
  if (total - absoluteTime > NEXT_EPISODE_WARMUP_SEC) return;
  var key = currentTorrentHash + ':' + next.id;
  if (warmedNextEpisodeKey === key) return;
  warmedNextEpisodeKey = key;

  console.log('🔥 Прогрев следующей серии: ' + (currentEpisodeIndex + 2));
  preloadTorrents(currentTorrentHash, next.id);
  // Пробу файла нужна только обычному режиму — транскодирование живёт без неё
  if (!AppState.transcodingOnOff && !AppState.transcodingFullOnOff) {
    var savedClientId = localStorage.getItem('clientId');
    fetchWithTimeout(SERVER_URL + '/api/file/info?hash=' + currentTorrentHash + '&fileId=' + next.id +
      '&clientId=' + encodeURIComponent(savedClientId), null, FILE_INFO_FETCH_TIMEOUT_MS)['catch'](function () { });
  }
}

/**
 * Один показатель строки HUD: приглушённая подпись и крупное значение
 * (стили .hud-stat в styles.css). Значения — числа и время, которые мы
 * считаем сами, поэтому экранировать нечего.
 */
function hudStat(label, value, valueClass) {
  return '<span class="hud-stat"><span class="hud-stat-label">' + label + '</span>' +
    '<span class="hud-stat-value' + (valueClass ? ' ' + valueClass : '') + '">' + value + '</span></span>';
}

// Строки HUD переписываем, только когда текст поменялся: функция зовётся
// несколько раз в секунду, а пересборка разметки на телевизоре — не бесплатна
function setHudHtml(el, html) {
  if (el && el._hudHtml !== html) { el.innerHTML = html; el._hudHtml = html; }
}

// Цвет запаса буфера: меньше 10 с — вот-вот встанет, до 20 с — впритык
function bufferLevelClass(seconds) {
  if (seconds < 10) return 'hud-low';
  if (seconds < 20) return 'hud-mid';
  return 'hud-ok';
}

function updateBufferDisplay() {
  var bufferStats = getEl('buffer-stats');
  var subtitleElement = getEl('player-subtitle');
  var videoPlayer = getEl('video-player');
  if (!bufferStats || !videoPlayer) return;

  // Кнопка «Пропустить вступление / титры» не зависит от того, показана ли
  // строка буфера. Раньше проверка жила внутри ветки отрисовки, и жёлтая кнопка
  // на пульте (скрыть буфер) заодно отключала пропуск заставки.
  checkAndShowSkipButton(videoPlayer.currentTime + AppState.seekOffset);
  maybeWarmNextEpisode(videoPlayer.currentTime + AppState.seekOffset);

  if (AppState.bufferHidden) {
    bufferStats.classList.add('hidden');
    if (subtitleElement) subtitleElement.classList.add('hidden');
    return;
  }
  bufferStats.classList.remove('hidden');
  if (subtitleElement) subtitleElement.classList.remove('hidden');

  // Статистика TorrServer от <video> не зависит. Раньше она, «До конца» и
  // «Конец в» рисовались только при непустом videoPlayer.buffered, а на Tizen
  // прямой файл играет AVPlay (tizen-avplay.js): сколько набрано наперёд, он
  // не сообщает, buffered у него всегда пустой — и в HUD оставалось одно
  // «Буфер 0 сек»
  var torrServerHtml = '';
  if (currentTimecodeData.hash && typeof torrentStatsCache !== 'undefined' && torrentStatsCache.preloadSize > 0) {
    torrServerHtml = hudStat('TorrServer', formatSize(torrentStatsCache.preloaded)) +
      hudStat('Скорость', formatSpeed(torrentStatsCache.downloadSpeed));
    if (torrentStatsCache.activePeers > 0) {
      torrServerHtml += hudStat('Пиры', torrentStatsCache.activePeers + ' / ' + torrentStatsCache.totalPeers) +
        hudStat('Сиды', torrentStatsCache.connectedSeeders);
    }
  }
  setHudHtml(subtitleElement, torrServerHtml);

  var absoluteCurrentTime = videoPlayer.currentTime + AppState.seekOffset;
  var bufferHtml;
  if (videoPlayer.buffered && videoPlayer.buffered.length > 0) {
    var absoluteBuffered = videoPlayer.buffered.end(videoPlayer.buffered.length - 1) + AppState.seekOffset;
    var bufferAhead = absoluteBuffered - absoluteCurrentTime;
    if (bufferAhead < 0) bufferAhead = 0;
    currentBufferAhead = bufferAhead;
    var bufferAheadText = bufferAhead < 60 ? Math.floor(bufferAhead) + ' сек' : (bufferAhead < 3600 ? Math.floor(bufferAhead / 60) + ' мин' : Math.floor(bufferAhead / 3600) + ' ч');
    bufferHtml = hudStat('Буфер', bufferAheadText, bufferLevelClass(bufferAhead));
  } else if (window.TizenAVPlay && TizenAVPlay.active()) {
    bufferHtml = '';   // AVPlay запас не отдаёт — не пишем вечный ноль
  } else {
    bufferHtml = hudStat('Буфер', '0 сек', 'hud-low');
  }

  var totalDuration = AppState.originalDuration || AppState.expectedDuration || videoPlayer.duration;
  if (totalDuration && totalDuration > 0 && isFinite(totalDuration)) {
    var remainingTime = totalDuration - absoluteCurrentTime;
    if (remainingTime < 0) remainingTime = 0;
    var remainingHours = Math.floor(remainingTime / 3600);
    var remainingMinutes = Math.floor((remainingTime % 3600) / 60);
    var remainingSeconds = Math.floor(remainingTime % 60);
    var remainingText = (remainingHours > 0 ? remainingHours + ' ч ' + (remainingMinutes > 0 ? remainingMinutes + ' мин' : '') : (remainingMinutes > 0 ? remainingMinutes + ' мин ' + (remainingSeconds > 0 ? remainingSeconds + ' сек' : '') : remainingSeconds + ' сек')).trim();
    var endTime = new Date(Date.now() + remainingTime * 1000);
    var endTimeText = endTime.getHours().toString().padStart(2, '0') + ':' + endTime.getMinutes().toString().padStart(2, '0');
    bufferHtml += hudStat('До конца', remainingText) + hudStat('Конец в', endTimeText);
  }
  setHudHtml(bufferStats, bufferHtml);
}

function forceUpdateDuration(duration, origDur, offset) {
  if (origDur === undefined) origDur = null;
  if (offset === undefined) offset = 0;
  var videoPlayer = getEl('video-player');
  var durationSpan = getEl('duration-time');
  var seekSlider = getEl('seek-slider');
  if (!duration || !isFinite(duration) || duration <= 0) return;
  AppState.expectedDuration = duration;
  AppState.originalDuration = origDur;
  AppState.seekOffset = offset;
  if (videoPlayer) {
    videoPlayer.dataset.expectedDuration = duration;
    videoPlayer.dataset.originalDuration = origDur;
    videoPlayer.dataset.seekOffset = offset;
  }
  if (durationSpan) durationSpan.textContent = formatTime(origDur || duration);
  if (seekSlider) seekSlider.max = origDur || duration;
  currentTimecodeData.duration = origDur || duration;
  updateTimeDisplay();
}

function destroyHls() {
  hidePlayerLoading();
  // AVPlay прошлого файла закрыть, <video> вернуть обычным (tizen-avplay.js)
  if (window.TizenAVPlay) TizenAVPlay.detach();
  ServerSubs.stop();
  AppState.serverTracks = null;
  var videoPlayer = getEl('video-player');
  var seekSlider = getEl('seek-slider');
  if (seekSlider) seekSlider.value = 0;
  var currentTimeSpan = getEl('current-time');
  if (currentTimeSpan) currentTimeSpan.textContent = '00:00';
  if (AppState) {
    AppState.seekQueue = [];
    AppState.isSeeking = false;
    AppState.previewTime = null;
    AppState.suppressTimeUpdate = false;
  }
  if (AppState._timeUpdateHandler) {
    if (videoPlayer) videoPlayer.removeEventListener('timeupdate', AppState._timeUpdateHandler);
    AppState._timeUpdateHandler = null;
  }
  if (AppState._canPlayHandler) {
    if (videoPlayer) videoPlayer.removeEventListener('canplay', AppState._canPlayHandler);
    AppState._canPlayHandler = null;
  }
  if (AppState._loadingTimeout) {
    clearTimeout(AppState._loadingTimeout);
    AppState._loadingTimeout = null;
  }
  // Отложенная перемотка ползунком (debounce 300 мс в seekStream). Раньше её
  // никто не отменял: уйти из плеера сразу после ползунка — и seek уходил уже
  // в уничтоженный поток
  if (AppState.seekTimeout) {
    clearTimeout(AppState.seekTimeout);
    AppState.seekTimeout = null;
  }
  if (AppState._seekExecuted) AppState._seekExecuted = false;
  // Слушатели прямого воспроизведения (initTranscodingOffPlayback)
  if (AppState._directPlaybackDetach) { AppState._directPlaybackDetach(); AppState._directPlaybackDetach = null; }

  if (AppState.hls) {
    AppState.expectedDuration = null;
    AppState.originalDuration = null;
    AppState.seekOffset = 0;
    AppState.lastSuccessfulSeek = 0;
    if (videoPlayer) {
      delete videoPlayer.dataset.expectedDuration;
      delete videoPlayer.dataset.originalDuration;
      delete videoPlayer.dataset.seekOffset;
    }
    AppState.hls.destroy();
    AppState.hls = null;
  }
  AppState.nativeVideoPlayer = null;
  AppState.isPlaying = false;
}

// ==================== ДОРОЖКИ В СЕРВЕРНОМ ПОТОКЕ ====================
//
// Сервер 1.0.53+ по запросу с tracks=1 кладёт в поток сразу несколько
// аудиодорожек (hls.js переключает их сам, без перезапуска ffmpeg) и текстовые
// субтитры отдельными растущими файлами subs/sN.vtt — их показывает ServerSubs.
// AppState.serverTracks = { audio: [индексы дорожек в порядке master],
// selectedAudio, subs: [{ index, url }], backWindowSec } или null — старый сервер
// (тогда смена дорожки, как раньше, перезапускает поток).
// AppState.serverAvailableFrom — с какой секунды поколения сегменты ещё лежат на
// сервере (позади держится окно, старше удаляется): перемотка в пределах
// [serverAvailableFrom, конец плейлиста] — без перезапуска.

/**
 * Дорожки нет в окне потока — новое поколение с текущего места с центром окна
 * на выбранной (сервер берёт audio/sub из запроса перемотки). Как перемотка:
 * ~0,7 с вместо полного перезапуска потока. Место — точное: в режиме дорожек
 * шкала исходная, её начало знает hls.js (streamTimeOrigin)
 */
function restartServerGeneration(what) {
  var v = getEl('video-player');
  if (!v || !AppState.currentStreamId) return false;
  var origin = AppState.streamTimeOrigin;
  var at = v.currentTime + (origin !== null && origin !== undefined ? origin : (AppState.seekOffset || 0));
  AppState._forceServerSeek = true;
  // Подпись на экране: это смена дорожки, а не перемотка
  AppState._forceServerSeekWhat = what || 'дорожки';
  seekStream(at, 'user');
  return true;
}

function applyServerTracks(tracks) {
  AppState.serverTracks = tracks || null;
  AppState.serverAvailableFrom = 0;
  // Метки потока — исходные (-copyts): реплика c показывается на c − начало
  // поколения. Начало узнаём у hls.js с первым фрагментом (INIT_PTS_FOUND)
  AppState.streamTimeOrigin = null;
  // Субтитры включает applyServerTrackSelection после разбора master: hls.js,
  // загружая новый плейлист, чистит реплики во всех текстовых дорожках <video>
  ServerSubs.stop();
}

/** Выбранные дорожки — в только что загруженный поток (после MANIFEST_PARSED) */
function applyServerTrackSelection() {
  if (!AppState.serverTracks) return;
  selectHlsAudio(currentAudioTrack);
  if (currentSubtitleTrack >= 0 && ServerSubs.index !== currentSubtitleTrack) ServerSubs.select(currentSubtitleTrack);
}

/** Номер дорожки в master (порядок hls.audioTracks) для индекса дорожки файла, -1 — её нет в потоке */
function serverAudioPos(trackIndex) {
  var t = AppState.serverTracks;
  return t && t.audio ? t.audio.indexOf(trackIndex) : -1;
}

/** Субтитры файла trackIndex — текстовые (их сервер умеет класть в поток) */
function isTextSubtitle(trackIndex) {
  var t = currentSubTracks && currentSubTracks[trackIndex];
  var codec = String((t && (t.codec || t.format)) || '').toLowerCase();
  return /^(subrip|srt|ass|ssa|mov_text|webvtt|text)$/.test(codec);
}

function serverSubEntry(trackIndex) {
  var t = AppState.serverTracks;
  if (!t || !t.subs) return null;
  for (var i = 0; i < t.subs.length; i++) if (t.subs[i].index === trackIndex) return t.subs[i];
  return null;
}

/** Включить в hls.js аудиодорожку файла trackIndex. false — её нет в потоке */
function selectHlsAudio(trackIndex) {
  var pos = serverAudioPos(trackIndex);
  if (pos < 0 || !AppState.hls) return false;
  if (AppState.hls.audioTrack !== pos) AppState.hls.audioTrack = pos;
  return true;
}

/** Позиция (абсолютная) есть на сервере в текущем поколении — перемотка без перезапуска */
function isPositionInServerRange(targetTime) {
  if (!AppState.serverTracks || !AppState.hls || !AppState.hls.levels) return false;
  var lvl = AppState.hls.levels[AppState.hls.currentLevel >= 0 ? AppState.hls.currentLevel : 0];
  var details = lvl && lvl.details;
  if (!details || !details.totalduration) return false;
  var rel = targetTime - (AppState.seekOffset || 0);
  return rel >= (AppState.serverAvailableFrom || 0) + 1 && rel <= details.totalduration - 1;
}

/**
 * Субтитры серверного потока: растущий WebVTT выбранной дорожки раз в
 * несколько секунд дочитывается, новые реплики добавляются в свою
 * текстовую дорожку <video> — телевизор рисует их сам, как и раньше.
 */
var ServerSubs = {
  track: null, trackVideo: null, url: null, index: -1, timer: null, gen: 0, keys: {}, polls: 0,
  // Сразу после включения или перемотки файл только начинает наполняться —
  // первые опросы чаще
  POLL_MS: 4000, POLL_FAST_MS: 1000, POLL_FAST_COUNT: 6,

  ensureTrack: function () {
    var v = getEl('video-player');
    if (!v || typeof v.addTextTrack !== 'function') return null;
    // Удалить дорожку из <video> нельзя — заводим одну и переиспользуем
    if (!this.track || this.trackVideo !== v) {
      this.track = v.addTextTrack('subtitles', 'TorrStream', '');
      this.trackVideo = v;
      if (typeof watchCuesRaise === 'function') watchCuesRaise(v);
    }
    return this.track;
  },

  clear: function () {
    var t = this.track;
    try { if (t && t.cues) while (t.cues.length) t.removeCue(t.cues[0]); } catch (e) { }
    this.keys = {};
  },

  stop: function () {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.gen++;
    this.clear();
    if (this.track) this.track.mode = 'disabled';
    this.index = -1; this.url = null;
  },

  /** Показать дорожку файла subIndex (-1 — выключить) */
  select: function (subIndex) {
    this.stop();
    var entry = subIndex >= 0 ? serverSubEntry(subIndex) : null;
    if (!entry) return false;
    var t = this.ensureTrack();
    if (!t) return false;
    // Прочие текстовые дорожки (hls.js, прямой файл) — прячем, чтобы не было двух
    var v = this.trackVideo;
    for (var i = 0; i < v.textTracks.length; i++) if (v.textTracks[i] !== t) v.textTracks[i].mode = 'disabled';
    t.mode = 'showing';
    this.index = subIndex; this.url = entry.url; this.polls = 0;
    this.poll(this.gen);
    return true;
  },

  poll: function (gen) {
    var self = this;
    bgFetch(SERVER_URL + self.url, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (text) { if (gen === self.gen && text) self.addCues(text); })
      ['catch'](function () { })
      .then(function () {
        if (gen !== self.gen) return;
        self.polls++;
        self.timer = setTimeout(function () { self.poll(gen); }, self.polls < self.POLL_FAST_COUNT ? self.POLL_FAST_MS : self.POLL_MS);
      });
  },

  parseTime: function (t) {
    var p = t.split(':');
    var sec = parseFloat(p[p.length - 1]) || 0;
    if (p.length > 1) sec += (parseInt(p[p.length - 2], 10) || 0) * 60;
    if (p.length > 2) sec += (parseInt(p[p.length - 3], 10) || 0) * 3600;
    return sec;
  },

  addCues: function (text) {
    var t = this.track;
    if (!t || typeof VTTCue !== 'function') return;
    // Начала поколения ещё нет — реплики добавим следующим опросом
    var origin = AppState.streamTimeOrigin;
    if (origin === null || origin === undefined) return;
    var blocks = text.replace(/\r/g, '').split(/\n\n+/);
    // Последний блок может быть дописан не до конца — берём его в следующий раз
    blocks.pop();
    for (var i = 0; i < blocks.length; i++) {
      var lines = blocks[i].split('\n');
      for (var j = 0; j < lines.length; j++) {
        var m = lines[j].match(/^\s*([\d:.]+)\s+-->\s+([\d:.]+)/);
        if (!m) continue;
        var body = lines.slice(j + 1).join('\n');
        var key = m[1] + '|' + m[2] + '|' + body;
        if (!body || this.keys[key]) break;
        this.keys[key] = 1;
        try { t.addCue(new VTTCue(this.parseTime(m[1]) - origin, this.parseTime(m[2]) - origin, body)); } catch (e) { }
        break;
      }
    }
  }
};

async function checkPlaylistExists(playlistUrl, maxAttempts) {
  if (maxAttempts === undefined) maxAttempts = 40;
  for (var i = 0; i < maxAttempts; i++) {
    try {
      var response = await bgFetch(playlistUrl, { method: 'HEAD' });
      if (response.ok) return true;
    } catch (e) { }
    if (i % 4 === 0) showPlayerLoading('Ожидание плейлиста... ' + ((i + 1) * 0.5).toFixed(0) + 'с', AppState.previewTime);
    await new Promise(function (r) { setTimeout(r, 500); });
  }
  return false;
}

function reloadHlsPlaylist(playlistUrl) {
  return new Promise(function (resolve, reject) {
    if (!AppState.hls || !Hls.isSupported()) { reject(new Error('HLS не инициализирован')); return; }
    var manifestParsed = false;
    var loadError = null;
    var onManifestParsed = function () {
      manifestParsed = true;
      AppState.hls.off(Hls.Events.MANIFEST_PARSED, onManifestParsed);
      AppState.hls.off(Hls.Events.ERROR, onError);
      resolve();
    };
    var onError = function (event, data) {
      if (data.fatal && !manifestParsed) {
        loadError = new Error(data.details || 'Ошибка загрузки плейлиста');
        AppState.hls.off(Hls.Events.MANIFEST_PARSED, onManifestParsed);
        AppState.hls.off(Hls.Events.ERROR, onError);
        reject(loadError);
      }
    };
    AppState.hls.on(Hls.Events.MANIFEST_PARSED, onManifestParsed);
    AppState.hls.on(Hls.Events.ERROR, onError);
    try { AppState.hls.loadSource(playlistUrl); } catch (e) { reject(e); }
    setTimeout(function () {
      if (!manifestParsed && !loadError) {
        AppState.hls.off(Hls.Events.MANIFEST_PARSED, onManifestParsed);
        AppState.hls.off(Hls.Events.ERROR, onError);
        reject(new Error('Таймаут загрузки плейлиста'));
      }
    }, 15000);
  });
}

async function saveTimecodeToServer() {
  if (!currentTimecodeData.hash || !currentTimecodeData.fileId) return;
  if (currentTimecodeData.timecode < 5) return;
  if (currentTimecodeData.duration > 0 && currentTimecodeData.timecode > currentTimecodeData.duration - 10) return;
  try {
    var savedClientId = localStorage.getItem('clientId');
    var response = await bgFetch(SERVER_URL + '/api/timecode/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: savedClientId, hash: currentTimecodeData.hash, fileId: currentTimecodeData.fileId,
        timecode: currentTimecodeData.timecode, duration: currentTimecodeData.duration,
        mediaKey: currentTimecodeMediaKey()
      })
    });
    if (response.ok) console.log('💾 Таймкод сохранен: ' + formatTime(currentTimecodeData.timecode));
  } catch (error) { console.error('Ошибка сохранения таймкода:', error); }
}

async function loadTimecodeFromServer(hash, fileId) {
  if (!hash || !fileId) return 0;
  try {
    var savedClientId = localStorage.getItem('clientId');
    // Сборник: ключ фильма файла нужен уже здесь — по нему сервер свяжет файл с
    // фильмом и для нативных плееров (Android, Apple), которые шлют только hash
    await ensureCollectionMap(hash, 1500);
    noteCollectionPlayback(hash, fileId);
    var mediaKey = getTimecodeMediaKey(hash, fileId);
    var response = await fetchWithTimeout(SERVER_URL + '/api/timecode/get?hash=' + hash + '&fileId=' + fileId + '&clientId=' + encodeURIComponent(savedClientId) +
      (mediaKey ? '&mediaKey=' + encodeURIComponent(mediaKey) : ''));
    if (response.ok) {
      var data = await response.json();
      if (data.success && data.timecode > 0) return data.timecode;
    }
  } catch (error) { console.error('Ошибка загрузки таймкода:', error); }
  return 0;
}

/**
 * Фильм/серия текущего таймкода для сервера (getTimecodeMediaKey): по нему
 * таймкод становится общим для всех раздач фильма. undefined — поле не уйдёт
 * в JSON вовсе.
 */
function currentTimecodeMediaKey() {
  try { return getTimecodeMediaKey(currentTimecodeData.hash, currentTimecodeData.fileId) || undefined; }
  catch (e) { return undefined; }
}

function clearTimecodeData() { currentTimecodeData = { hash: null, fileId: null, timecode: 0, duration: 0 }; }

/**
 * Последнее сохранение таймкода, ещё не доехавшее до сервера.
 *
 * Выход из плеера отправляет POST /api/timecode/save и тут же, не дожидаясь
 * ответа, перерисовывает кнопку «Продолжить» — а та читает /api/timecode/batch.
 * Два запроса гонялись, батч нередко успевал первым и отвечал состоянием ДО
 * сохранения. Отсюда и «не та серия»: только что просмотренной в ответе ещё не
 * было, и последней просмотренной оказывалась предыдущая. Помогал лишь выход из
 * карточки и повторный вход — к тому моменту сохранение уже доезжало.
 *
 * Обещание кладём сюда, а updateDetailProgress ждёт его перед чтением батча.
 * Ошибку глушим: не сохранился таймкод — кнопку всё равно надо перерисовать.
 */
var pendingTimecodeSave = null;
function trackTimecodeSave(promise) {
  var p = Promise.resolve(promise)['catch'](function () { });
  pendingTimecodeSave = p;
  p.then(function () { if (pendingTimecodeSave === p) pendingTimecodeSave = null; });
  return p;
}
function awaitPendingTimecodeSave() {
  return pendingTimecodeSave || Promise.resolve();
}
function startTimecodeSaving() {
  if (timecodeSaveInterval) clearInterval(timecodeSaveInterval);
  timecodeSaveInterval = setInterval(function () { saveTimecodeToServer(); }, 10000);
}
function stopTimecodeSaving() {
  if (timecodeSaveInterval) { clearInterval(timecodeSaveInterval); timecodeSaveInterval = null; }
}

function isPositionInBuffer(targetTime) {
  var videoPlayer = getEl('video-player');
  if (!videoPlayer || !videoPlayer.buffered || videoPlayer.buffered.length === 0) return false;
  var relativeTargetTime = targetTime - AppState.seekOffset;
  for (var i = 0; i < videoPlayer.buffered.length; i++) {
    var start = videoPlayer.buffered.start(i);
    var end = videoPlayer.buffered.end(i);
    if (relativeTargetTime >= start - 0.5 && relativeTargetTime <= end + 0.5) return true;
  }
  return false;
}

async function seekStream(absoluteSeekTime, source) {
  currentBufferAhead = 0; wasImmediatePause = false; pauseTimer = null; pauseStartTime = null; thisisseek = true;
  if (source === undefined) source = 'user';
  if (!AppState.currentStreamId && !AppState.transcodingOnOff && !AppState.transcodingFullOnOff) return false;
  var videoPlayer = getEl('video-player');
  var totalDuration = AppState.originalDuration || AppState.expectedDuration || 0;
  if (absoluteSeekTime < 0) absoluteSeekTime = 0;
  if (totalDuration > 0 && absoluteSeekTime >= totalDuration - 1) return false;

  if (AppState.transcodingOnOff || AppState.transcodingFullOnOff) {
    showPlayerLoading('Перемотка...', absoluteSeekTime);
    var relativeTime = absoluteSeekTime - (AppState.seekOffset || 0);
    if (relativeTime < 0) relativeTime = 0;
    AppState.seekQueue.push(absoluteSeekTime);
    if (AppState.isSeeking) return false;
    if (source === 'slider' && AppState.seekTimeout) clearTimeout(AppState.seekTimeout);
    AppState.isSeeking = true; AppState.suppressTimeUpdate = true; AppState.previewTime = absoluteSeekTime;
    videoPlayer.currentTime = relativeTime;
    if (currentTimecodeData.hash && currentTimecodeData.fileId) currentTimecodeData.timecode = absoluteSeekTime;
    var seekSlider = getEl('seek-slider');
    if (seekSlider) seekSlider.value = Math.min(absoluteSeekTime, totalDuration);
    updateTimeDisplay();
    var timeUpdateHandler = function () {
      if (videoPlayer.currentTime > 0) {
        hidePlayerLoading(); AppState.isSeeking = false; AppState.isSliderDragging = false;
        AppState.previewTime = null; AppState.suppressTimeUpdate = false;
        videoPlayer.removeEventListener('timeupdate', timeUpdateHandler);
      }
    };
    videoPlayer.addEventListener('timeupdate', timeUpdateHandler);
    AppState._seekTimeout = setTimeout(function () {
      hidePlayerLoading(); AppState.isSeeking = false; AppState.isSliderDragging = false;
      AppState.previewTime = null; AppState.suppressTimeUpdate = false;
      videoPlayer.removeEventListener('timeupdate', timeUpdateHandler);
    }, 3000);
    AppState._seekTimeUpdateHandler = timeUpdateHandler;
    return true;
  }

  AppState.seekQueue.push(absoluteSeekTime);
  if (AppState.isSeeking) return false;
  if (source === 'slider' && AppState.seekTimeout) clearTimeout(AppState.seekTimeout);

  return new Promise(function (resolve) {
    var executeSeek = async function () {
      var targetTime = AppState.seekQueue[AppState.seekQueue.length - 1];
      AppState.seekQueue = [];
      if (targetTime === undefined) { hidePlayerLoading(); resolve(false); return; }
      var wasPlaying = !videoPlayer.paused;
      var episodesPanel = getEl('episodes-panel');
      var episodesBtn = getEl('episodes-btn');
      if (episodesPanel && !episodesPanel.classList.contains('hidden')) {
        episodesPanel.classList.add('hidden');
        if (episodesBtn) episodesBtn.classList.remove('active');
      }
      AppState.isSeeking = true; AppState.suppressTimeUpdate = true; AppState.previewTime = targetTime;
      // Смена дорожки вне окна потока — новое поколение с того же места,
      // даже если позиция в буфере (restartServerGeneration)
      var forceServer = !!AppState._forceServerSeek;
      var switchWhat = forceServer ? AppState._forceServerSeekWhat : null;
      AppState._forceServerSeek = false; AppState._forceServerSeekWhat = null;
      var positionInBuffer = !forceServer && isPositionInBuffer(targetTime);
      // Не в буфере плеера, но уже лежит на сервере (впереди до ~100 с, позади —
      // окно) — тоже без перезапуска: hls.js сам подгрузит нужный сегмент
      var inServerRange = !forceServer && !positionInBuffer && isPositionInServerRange(targetTime);
      if (inServerRange) {
        showPlayerLoading('Перемотка...', targetTime);
        var onPlaying = function () { hidePlayerLoading(); videoPlayer.removeEventListener('playing', onPlaying); videoPlayer.removeEventListener('seeked', onSeeked); };
        var onSeeked = function () { if (!wasPlaying) onPlaying(); };
        videoPlayer.addEventListener('playing', onPlaying);
        videoPlayer.addEventListener('seeked', onSeeked);
        setTimeout(onPlaying, 8000);
      }
      if (positionInBuffer || inServerRange) {
        var relativeTime = targetTime - AppState.seekOffset;
        videoPlayer.currentTime = relativeTime;
        if (wasPlaying) videoPlayer.play()['catch'](function (err) { });
        AppState.previewTime = null; AppState.suppressTimeUpdate = false; AppState.isSeeking = false;
        var seekSlider = getEl('seek-slider');
        if (seekSlider) seekSlider.value = targetTime;
        updateTimeDisplay(); resolve(true); return;
      }

      lastCleanedSegment = -1;
      var playbackOverlay = getEl('playback-overlay');
      var playbackText = document.querySelector('.playback-text');
      playbackOverlay.classList.add('active');
      playbackText.textContent = switchWhat ? 'Переключение ' + switchWhat + '...' : 'Перемотка на ' + formatTime(targetTime) + '...';
      if (wasPlaying) videoPlayer.pause();

      var retrySeek = async function (retryCount, maxRetries) {
        if (retryCount === undefined) retryCount = 0;
        if (maxRetries === undefined) maxRetries = 2;
        try {
          var savedClientId = localStorage.getItem('clientId');
          var seekResponse = await bgFetch(SERVER_URL + '/hls/stream/seek', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              streamId: AppState.currentStreamId, seekTime: targetTime, multiChannel: AppState.multiChannelEnabled,
              clientId: savedClientId, duration: AppState.originalDuration, sub: currentSubtitleTrack, dv: AppState.dvPreferred ? 'true' : 'false',
              audio: currentAudioTrack, tracks: !!AppState.serverTracks
            })
          });
          if (!seekResponse.ok) throw new Error('HTTP ' + seekResponse.status);
          var seekData = await seekResponse.json();
          if (!seekData.success) throw new Error(seekData.error || 'Ошибка перемотки');
          AppState.expectedDuration = seekData.duration; AppState.originalDuration = seekData.originalDuration;
          AppState.seekOffset = seekData.seekOffset; AppState.currentStreamId = seekData.streamId; AppState.lastSuccessfulSeek = targetTime;
          applyServerTracks(seekData.tracks);
          if (videoPlayer) {
            videoPlayer.dataset.expectedDuration = AppState.expectedDuration;
            videoPlayer.dataset.originalDuration = AppState.originalDuration;
            videoPlayer.dataset.seekOffset = AppState.seekOffset;
          }
          playbackText.textContent = 'Загрузка потока...';
          // Новый сервер отвечает, только когда плейлист готов, — лишний круг не нужен
          if (!AppState.serverTracks) {
            var playlistReady = await checkPlaylistExists(seekData.playlistUrl, 60);
            if (!playlistReady) throw new Error('Таймаут ожидания плейлиста');
          }
          playbackText.textContent = 'Загрузка видео...';

          if (AppState.hls) { AppState.hls.destroy(); AppState.hls = null; }
          if (Hls.isSupported()) {
            AppState.hls = createHlsInstance();

            if (currentPlaybackController) currentPlaybackController.abort();
            currentPlaybackController = new AbortController();
            var newSignal = currentPlaybackController.signal;

            // Используем существующую функцию привязки всех обработчиков
            attachHlsEventListeners(AppState.hls, videoPlayer, newSignal, 0);

            // Обработчик субтитров
            var subtitleTracksHandler = function () {
              if (currentSubtitleTrack >= 0 && AppState.hls.subtitleTracks.length > currentSubtitleTrack) {
                setTimeout(function () { if (AppState.hls) AppState.hls.subtitleTrack = currentSubtitleTrack; }, 200);
              } else if (currentSubtitleTrack === -1) {
                if (AppState.hls) AppState.hls.subtitleTrack = -1;
              }
              AppState.hls.off(Hls.Events.SUBTITLE_TRACKS_UPDATED, subtitleTracksHandler);
            };
            AppState.hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, subtitleTracksHandler);

            AppState.hls.loadSource(seekData.playlistUrl);
            AppState.hls.attachMedia(videoPlayer);
          }
          var onMetaData = function () {
            videoPlayer.currentTime = 0;
            if (wasPlaying) {
              videoPlayer.play()['catch'](function (err) { videoPlayer.muted = true; videoPlayer.play()['catch'](function () { }); restoreSoundOnGesture(); });
            }
            videoPlayer.muted = false; restoreSoundOnGesture();
            forceUpdateDuration(AppState.expectedDuration, AppState.originalDuration, AppState.seekOffset);
            var seekSlider = getEl('seek-slider');
            if (seekSlider) seekSlider.value = Math.min(targetTime, parseFloat(seekSlider.max) || targetTime);
            AppState.previewTime = null; AppState.suppressTimeUpdate = false;
            playbackOverlay.classList.remove('active'); playbackText.textContent = 'Воспроизведение...';
            hidePlayerLoading(); startTimecodeSaving(); resetMouseIdleTimer(); startNearEndCheck(); startHeartbeat();
            videoPlayer.removeEventListener('loadedmetadata', onMetaData);
          };
          videoPlayer.addEventListener('loadedmetadata', onMetaData, { once: true });
          AppState._loadingTimeout = setTimeout(function () {
            var loadingOverlay = getEl('loading-player-overlay');
            if (loadingOverlay && loadingOverlay.classList.contains('active')) {
              hidePlayerLoading();
              if (wasPlaying) videoPlayer.play()['catch'](function () { });
            }
          }, 10000);
          return true;
        } catch (error) {
          if (retryCount < maxRetries) {
            playbackText.textContent = '⚠️ Ошибка ' + (switchWhat ? 'переключения' : 'перемотки') + '. Попытка ' + (retryCount + 1) + '/' + (maxRetries + 1) + '...';
            await new Promise(function (resolve) { setTimeout(resolve, 1000); });
            return retrySeek(retryCount + 1, maxRetries);
          }
          throw error;
        }
      };
      try {
        var success = await retrySeek(0, 2); resolve(success);
      } catch (error) {
        playbackText.textContent = switchWhat ? '❌ Ошибка переключения ' + switchWhat : '❌ Ошибка перемотки!';
        setTimeout(function () { playbackOverlay.classList.remove('active'); playbackText.textContent = 'Воспроизведение...'; }, 2000);
        if (wasPlaying) setTimeout(function () { videoPlayer.play()['catch'](function () { }); }, 1000);
        AppState.previewTime = null; AppState.suppressTimeUpdate = false; resolve(false);
      } finally { AppState.isSeeking = false; }
    };
    if (source === 'slider') {
      if (AppState.seekTimeout) clearTimeout(AppState.seekTimeout);
      AppState.seekTimeout = setTimeout(executeSeek, 300);
    } else { executeSeek(); }
  });
}

function extractVideoFiles(files) {
  if (files === undefined) files = [];
  // Те же правила, что у списка серий в карточке раздачи (torrents.js)
  var videoFiles = window.pickPlayableVideoFiles(files);
  // В порядке серий, а не как в .torrent (torrents.js: sortEpisodeFiles)
  return typeof window.sortEpisodeFiles === 'function' ? window.sortEpisodeFiles(videoFiles) : videoFiles;
}

async function resolveTorrentWithFiles(hash, maxAttempts, delayMs) {
  if (maxAttempts === undefined) maxAttempts = 3;
  if (delayMs === undefined) delayMs = 700;
  var torrent = null;
  for (var i = 0; i < AppState.torrents.length; i++) {
    if (AppState.torrents[i].hash && AppState.torrents[i].hash.toLowerCase() === hash.toLowerCase()) { torrent = AppState.torrents[i]; break; }
  }
  for (var attempt = 0; attempt < maxAttempts; attempt++) {
    var files = [];
    if (torrent && torrent.file_stats && Array.isArray(torrent.file_stats)) files = torrent.file_stats;
    else if (torrent && torrent.data) {
      try { var data = JSON.parse(torrent.data); if (data.TorrServer && Array.isArray(data.TorrServer.Files)) files = data.TorrServer.Files; } catch (e) { }
    }
    if (extractVideoFiles(files).length > 0) return torrent;
    if (attempt < maxAttempts - 1) {
      await refreshTorrentsList();
      for (var j = 0; j < AppState.torrents.length; j++) {
        if (AppState.torrents[j].hash && AppState.torrents[j].hash.toLowerCase() === hash.toLowerCase()) { torrent = AppState.torrents[j]; break; }
      }
      await new Promise(function (resolve) { setTimeout(resolve, delayMs); });
    }
  }
  return torrent;
}

/** Сведения TMDB о серии файла текущей раздачи (torrents.js) или null */
function getEpisodeMetaForFile(file) {
  if (!file || !currentTorrentHash || typeof window.getTorrentEpisodeMeta !== 'function') return null;
  return window.getTorrentEpisodeMeta(currentTorrentHash, file.id);
}

/** «Серия 5 - Название» / «Серия 5» — как на плитках detail-view */
function getEpisodeLabel(file, idx) {
  var meta = getEpisodeMetaForFile(file);
  if (typeof window.formatEpisodeLabel === 'function') return window.formatEpisodeLabel(meta, idx + 1);
  return 'Серия ' + (idx + 1);
}

/**
 * Заголовок плеера для серии сериала: «Серия 5 - Название». Только когда
 * серий несколько и название серии известно — иначе остаётся прежний
 * заголовок (имя файла), он информативнее голого «Серия 5».
 * @returns {string|null}
 */
function getEpisodePlayerTitle(hash, fileId) {
  if (!hash || !currentEpisodeFiles || currentEpisodeFiles.length < 2) return null;
  if (typeof window.getTorrentEpisodeMeta !== 'function') return null;
  var meta = window.getTorrentEpisodeMeta(hash, fileId);
  if (!meta || !meta.name) return null;
  var idx = 0;
  for (var i = 0; i < currentEpisodeFiles.length; i++) {
    if (String(currentEpisodeFiles[i].id) === String(fileId)) { idx = i; break; }
  }
  return window.formatEpisodeLabel(meta, idx + 1);
}

/** Сведения о сериях пришли уже после старта — переписать заголовок */
function refreshEpisodePlayerTitle() {
  if (AppState.currentScreen !== 'player') return;
  var file = currentEpisodeFiles[currentEpisodeIndex];
  if (!file) return;
  var title = getEpisodePlayerTitle(currentTorrentHash, file.id);
  if (title) updatePlayerTitle(title);
}

async function loadEpisodesInfo(hash, currentFileId) {
  if (currentFileId === undefined) currentFileId = null;
  if (!hash || !AppState.currentTorrserverUrl) return;
  try {
    var torrent = await resolveTorrentWithFiles(hash, 4, 800);
    if (!torrent) return;
    var files = [];
    if (torrent.file_stats && Array.isArray(torrent.file_stats)) files = torrent.file_stats;
    else if (torrent.data) {
      try { var data = JSON.parse(torrent.data); if (data.TorrServer && data.TorrServer.Files) files = data.TorrServer.Files; } catch (e) { }
    }
    var videoFiles = extractVideoFiles(files);
    if (videoFiles.length > 0) {
      currentEpisodeFiles = videoFiles; currentTorrentHash = hash;
      if (currentFileId) {
        currentEpisodeIndex = -1;
        for (var i = 0; i < videoFiles.length; i++) { if (String(videoFiles[i].id) == String(currentFileId)) { currentEpisodeIndex = i; break; } }
      } else if (AppState.videoUrl) {
        var match = AppState.videoUrl.match(/\/(\d+)$/);
        if (match && match[1]) {
          currentEpisodeIndex = -1;
          for (var j = 0; j < videoFiles.length; j++) { if (String(videoFiles[j].id) == String(match[1])) { currentEpisodeIndex = j; break; } }
        }
      }
      if (currentEpisodeIndex === -1 || currentEpisodeIndex === undefined) currentEpisodeIndex = 0;
      renderEpisodesList();
      // Названий серий ещё нет (detail этой раздачи не открывали) — догружаем
      // и перерисовываем список и заголовок, если плеер всё ещё на ней
      if (typeof window.ensureTorrentEpisodeMeta === 'function') {
        window.ensureTorrentEpisodeMeta(torrent, videoFiles).then(function (changed) {
          if (!changed || currentTorrentHash !== hash) return;
          renderEpisodesList();
          refreshEpisodePlayerTitle();
          // Серии сопоставлены с TMDB — сезон и номер могли уточниться
          // (раздача из нескольких сезонов без S01E05 в именах файлов)
          var playing = currentEpisodeFiles[currentEpisodeIndex];
          if (AppState.isSerials && playing) fetchSkipData(torrent, playing.id, true);
        });
      }
      // Сведения уже были (detail открывали) — заголовок на старте ставился
      // до появления списка серий и остался именем файла
      refreshEpisodePlayerTitle();
      if (AppState.isSerials) fetchSkipData(torrent, videoFiles[currentEpisodeIndex].id);
      var episodesBtn = getEl('episodes-btn');
      if (episodesBtn) episodesBtn.style.display = videoFiles.length > 1 ? 'flex' : 'none';
      updateEpisodeButtons();
    } else {
      currentEpisodeFiles = []; currentEpisodeIndex = 0;
      var episodesBtn = getEl('episodes-btn');
      if (episodesBtn) episodesBtn.style.display = 'none';
      updateEpisodeButtons();
    }
  } catch (error) { console.error('Ошибка загрузки серий:', error); }
}

/**
 * Диапазоны заставки и титров для серии.
 *
 * Счётчики показов сбрасываются здесь же. Они считают тики внутри диапазона и
 * относятся к одной серии: показ идёт по условию skipIntro == 1, то есть на
 * первом тике. Раньше обнуляли их только в showDetailView, на выходе из
 * плеера, — поэтому на второй серии подряд счётчик был уже далеко за единицей,
 * и кнопка не появлялась, пока не выйдешь из плеера и не зайдёшь заново.
 *
 * Сброс привязан именно к загрузке данных, а не к переключению серии: между
 * переключением и ответом tsskip проходит около секунды, и обнулённые заранее
 * счётчики успели бы показать кнопку по диапазонам предыдущей серии.
 */
async function fetchSkipData(torrent, fileId, onlyIfChanged) {
  var target = resolveSkipTarget(torrent, fileId);
  var key = target ? target.tmdbId + '_' + target.season + '_' + target.episode : '';
  // Повторный вызов для той же серии не сбрасывает счётчики — кнопка не
  // всплывёт второй раз посреди заставки
  if (onlyIfChanged && key === skipDataKey) return skipData;
  skipDataKey = key;
  skipIntro = 0;
  skipCredits = 0;
  // Без id, сезона или серии сервер отвечает «tmdb_id, season и episode
  // обязательны» — не спрашиваем
  if (!target) { skipData = { error: true }; return skipData; }
  var url = getSkipApiBase() + '/v2/media?tmdb_id=' + target.tmdbId + '&season=' + target.season + '&episode=' + target.episode;
  try {
    var response = await bgFetch(url);   // через фоновый поток
    var data = await response.json();
    // Пока ждали, переключили серию — её данные уже запрошены
    if (key !== skipDataKey) return skipData;
    if (data.error) { skipData = { error: true }; }
    else { skipData = data; skipData.error = false; }
    return skipData;
  } catch (error) {
    if (key === skipDataKey) skipData = { error: true };
    return skipData;
  }
}

/** id TMDB раздачи: поле (MonoServer), knownTorrentMeta, «[603]» в названии (TorrServer) */
function getTorrentTmdbId(torrent) {
  if (!torrent) return null;
  if (torrent.tmdbId || torrent.tmdb_id) return String(torrent.tmdbId || torrent.tmdb_id);
  var hash = torrent.hash ? String(torrent.hash).toLowerCase() : '';
  var known = hash && typeof knownTorrentMeta !== 'undefined' ? knownTorrentMeta.get(hash) : null;
  if (known && known.id) return String(known.id);
  var m = String(torrent.title || '').match(/\[(\d+)\]/);
  return m ? m[1] : null;
}

/** Торрент из загруженного списка по hash или null */
function findLoadedTorrent(hash) {
  if (!hash || !Array.isArray(AppState.torrents)) return null;
  var h = String(hash).toLowerCase();
  for (var i = 0; i < AppState.torrents.length; i++) {
    var t = AppState.torrents[i];
    if (t && t.hash && String(t.hash).toLowerCase() === h) return t;
  }
  return null;
}

/** Единственный сезон раздачи или null (сезонов несколько или не знаем) */
function getTorrentSingleSeason(torrent) {
  if (!torrent || typeof window.getTorrentSeasons !== 'function') return null;
  var seasons = window.getTorrentSeasons(torrent);
  return seasons.length === 1 ? seasons[0] : null;
}

/**
 * Ключ фильма / серии TMDB для общего таймкода (сервер, services/timecodes.js):
 * «movie:<id>» или «tv:<id>:<сезон>:<серия>», null — не знаем наверняка.
 * По нему разные раздачи одного фильма продолжают просмотр с одного места.
 *
 * Ошибка здесь хуже, чем отсутствие ключа: чужой таймкод перемотал бы фильм не
 * туда. Поэтому без догадок: серия — только из сопоставления с TMDB или из
 * имени файла (S01E05), без запасного «порядковый номер = серия»; фильм — только
 * если видеофайл в раздаче один (в сборнике у каждого файла свой фильм, а id у
 * раздачи один).
 *
 * @param {string} hash
 * @param {string|number} fileId
 * @param {Array} [files] видеофайлы раздачи; без них — серии текущей раздачи плеера
 */
function getTimecodeMediaKey(hash, fileId, files) {
  if (!hash || fileId === null || fileId === undefined) return null;
  var h = String(hash).toLowerCase();
  var torrent = findLoadedTorrent(h) || { hash: h };
  var tmdbId = parseInt(getTorrentTmdbId(torrent) || '', 10);
  if (!(tmdbId > 0)) return null;
  var known = typeof knownTorrentMeta !== 'undefined' && knownTorrentMeta ? knownTorrentMeta.get(h) : null;
  var seasons = typeof window.getTorrentSeasons === 'function' ? window.getTorrentSeasons(torrent) : [];
  var type = torrent.media_type || (known && known.mediaType) || (seasons.length ? 'tv' : null);
  if (!files) files = (currentTorrentHash && String(currentTorrentHash).toLowerCase() === h) ? currentEpisodeFiles : null;
  var file = null;
  for (var i = 0; files && i < files.length; i++) {
    if (String(files[i].id) === String(fileId)) { file = files[i]; break; }
  }
  var ref = (file && typeof parseEpisodeRef === 'function') ? parseEpisodeRef(file.path || file.name) : null;

  if (type === 'tv' || (!type && ref)) {
    var meta = typeof window.getTorrentEpisodeMeta === 'function' ? window.getTorrentEpisodeMeta(h, fileId) : null;
    var season = null, episode = null;
    if (meta && meta.season !== undefined && meta.season !== null && meta.episode) {
      season = meta.season; episode = meta.episode;
    } else if (ref) {
      season = ref.season !== null ? ref.season : (seasons.length === 1 ? seasons[0] : null);
      episode = ref.episode;
    }
    season = parseInt(season, 10); episode = parseInt(episode, 10);
    return (season >= 0 && episode > 0) ? 'tv:' + tmdbId + ':' + season + ':' + episode : null;
  }
  if (files && files.length === 1 && file) return 'movie:' + tmdbId;
  // Сборник фильмов: у файла свой фильм коллекции (collectionPartFor ниже)
  var part = collectionPartFor(h, fileId);
  return part ? 'movie:' + part.id : null;
}
window.getTimecodeMediaKey = getTimecodeMediaKey;

/* ============ СБОРНИКИ ФИЛЬМОВ: ФАЙЛ → ФИЛЬМ КОЛЛЕКЦИИ ============
 *
 * «Матрица трилогия», «Кошмар на улице Вязов (все части)» — одна раздача,
 * один id TMDB (первого фильма), а внутри несколько фильмов. Общий таймкод
 * (getTimecodeMediaKey) такой раздаче не доставался вовсе: записать всем файлам
 * id первого фильма — значит перематывать «Перезагрузку» по таймкоду «Матрицы».
 * Без общего таймкода сервер не знал, где остановились (resume в
 * /api/history), и ни главная, ни карточка не предлагали «Продолжить» — хотя
 * «Мои торренты» по таймкодам самих файлов продолжали.
 *
 * Теперь у фильма раздачи берём коллекцию TMDB (belongs_to_collection) и её
 * части (/api/tmdb/collection/parts — тот же ряд «Коллекция» в карточке), а
 * каждому файлу ищем его часть по имени:
 *   • год в имени совпал с одной частью — она (на 2003 у «Матрицы» две части —
 *     тогда решает название);
 *   • года нет — по названию (русскому или оригинальному), только если
 *     совпадение одно и за названием не стоит номер: «Кошмар на улице Вязов 4»
 *     без года — не первый фильм, а неизвестно какой.
 * Не нашлась часть — у файла ключа нет, как раньше: чужой таймкод хуже, чем
 * никакого. Сопоставленный файл получает ключ «movie:<id части>», а при
 * запуске в историю попадает сама часть — её карточка и ряд «Продолжить
 * просмотр» показывают «Продолжить» с нужного файла этой раздачи.
 *
 * Карта файлов считается один раз на раздачу и лежит в localStorage
 * (COLLECTION_MAP_TTL_MS): состав раздачи и коллекции не меняется.
 */
var COLLECTION_MAP_PREFIX = 'ts_collmap_';
var COLLECTION_MAP_TTL_MS = 30 * 24 * 60 * 60 * 1000;
var COLLECTION_MAX_PARTS = 15;
var collectionMaps = {};          // hash → { files: {fileId: part}, at } ({} files — не сборник)
var collectionMapPending = {};    // hash → Promise

function collNorm(s) {
  return ' ' + String(s || '').toLowerCase().replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
}

function collFileYears(name) {
  var out = [], re = /(?:^|[^0-9])((?:19|20)\d{2})(?![0-9])/g, m;
  while ((m = re.exec(name))) out.push(+m[1]);
  return out;
}

// Номер сиквела сразу за названием: «Кошмар на улице Вязов 4», «Matrix II»
var COLL_SEQUEL_RE = /^(\d{1,2}|ii|iii|iv|v|vi|vii|viii|ix|x)$/;

/** Длина самого длинного названия части, найденного в имени файла (0 — нет) */
function collTitleHit(fn, part, strict) {
  var best = 0;
  for (var i = 0; i < part.names.length; i++) {
    var n = part.names[i], at = fn.indexOf(n);
    if (n.length <= 3 || at === -1 || n.length <= best) continue;
    if (strict && COLL_SEQUEL_RE.test(fn.slice(at + n.length).split(' ')[0])) continue;
    best = n.length;
  }
  return best;
}

/** Часть коллекции для файла или null. parts: [{id, year, title, names, poster}] */
function matchCollectionFile(path, parts) {
  var base = String(path || '').split('/').pop().replace(/\.[a-z0-9]{2,4}$/i, '');
  var fn = collNorm(base), years = collFileYears(base);
  var hits = [], bestT = 0, i;
  for (i = 0; i < parts.length; i++) {
    // Без года в имени название — единственная улика, и номер за ним её отменяет
    var t = collTitleHit(fn, parts[i], !years.length);
    hits.push({ p: parts[i], t: t, y: years.indexOf(parts[i].year) !== -1 });
    if (t > bestT) bestT = t;
  }
  var pool = [], top = 0, pick = [];
  for (i = 0; i < hits.length; i++) if (hits[i].y) { pool.push(hits[i]); if (hits[i].t > top) top = hits[i].t; }
  if (pool.length === 1) return pool[0].p;
  if (pool.length > 1) {
    for (i = 0; i < pool.length; i++) if (top > 0 && pool[i].t === top) pick.push(pool[i]);
  } else if (bestT > 0) {
    for (i = 0; i < hits.length; i++) {
      if (hits[i].t !== bestT) continue;
      var near = !years.length;
      for (var k = 0; k < years.length; k++) if (Math.abs(years[k] - hits[i].p.year) <= 1) near = true;
      if (near) pick.push(hits[i]);
    }
  }
  return pick.length === 1 ? pick[0].p : null;
}
window.matchCollectionFile = matchCollectionFile;

function readCollectionMap(h) {
  if (collectionMaps[h]) return collectionMaps[h];
  try {
    var raw = localStorage.getItem(COLLECTION_MAP_PREFIX + h);
    var m = raw ? JSON.parse(raw) : null;
    if (m && m.files && Date.now() - (m.at || 0) < COLLECTION_MAP_TTL_MS) return (collectionMaps[h] = m);
  } catch (e) { }
  return null;
}

/** Фильм коллекции для файла сборника, если карта уже посчитана, иначе null */
function collectionPartFor(hash, fileId) {
  if (!hash || fileId === null || fileId === undefined) return null;
  var m = readCollectionMap(String(hash).toLowerCase());
  return (m && m.files[String(fileId)]) || null;
}
window.collectionPartFor = collectionPartFor;

/** Раздача — сборник фильмов: фильм, видеофайлов больше одного, серий в именах нет */
function looksLikeMovieCollection(torrent, videoFiles) {
  if (!torrent || videoFiles.length < 2) return false;
  var known = typeof knownTorrentMeta !== 'undefined' && knownTorrentMeta ? knownTorrentMeta.get(String(torrent.hash).toLowerCase()) : null;
  var type = torrent.media_type || torrent.category || (known && known.mediaType) || '';
  if (type === 'tv' || type === 'serial') return false;
  if (typeof window.getTorrentSeasons === 'function' && window.getTorrentSeasons(torrent).length) return false;
  for (var i = 0; i < videoFiles.length; i++) {
    if (typeof parseEpisodeRef === 'function' && parseEpisodeRef(videoFiles[i].path || videoFiles[i].name)) return false;
  }
  return true;
}

async function buildCollectionMap(h) {
  var torrent = await resolveTorrentWithFiles(h, 2, 500);
  if (!torrent) return null;
  var files = torrent.file_stats || [];
  if (!files.length && torrent.data) {
    try { var d = JSON.parse(torrent.data); files = (d.TorrServer && d.TorrServer.Files) || []; } catch (e) { }
  }
  var video = extractVideoFiles(files);
  var tmdbId = parseInt(getTorrentTmdbId(torrent) || '', 10);
  var empty = { files: {}, at: Date.now() };
  if (!(tmdbId > 0) || !looksLikeMovieCollection(torrent, video)) return empty;

  var details = await safeFetch(SERVER_URL + '/api/tmdb/details?id=' + tmdbId + '&type=movie', { timeout: 10000 });
  var bc = details && details.belongs_to_collection;
  if (!bc || !bc.id) return details ? empty : null;       // null — сеть, попробуем в другой раз
  var coll = await safeFetch(SERVER_URL + '/api/tmdb/collection/parts?id=' + encodeURIComponent(bc.id), { timeout: 15000 });
  var items = coll && coll.success && coll.items;
  if (!items) return null;
  items = items.slice(0, COLLECTION_MAX_PARTS);
  // Оригинальные названия — для английских имён файлов. /api/tmdb/item кэширует сервер
  var orig = await Promise.all(items.map(function (it) {
    return safeFetch(SERVER_URL + '/api/tmdb/item?id=' + it.id + '&type=movie', { timeout: 10000 });
  }));
  var parts = [];
  for (var i = 0; i < items.length; i++) {
    var year = parseInt(String(items[i].release_date || '').slice(0, 4), 10);
    if (!(year > 0)) continue;                               // анонс — файла у него ещё нет
    var names = [collNorm(items[i].title)];
    var o = orig[i] && orig[i].original_title;
    if (o && names.indexOf(collNorm(o)) === -1) names.push(collNorm(o));
    parts.push({ id: String(items[i].id), year: year, title: items[i].title, poster: items[i].poster_path || null, names: names });
  }
  var map = { files: {}, at: Date.now() }, n = 0;
  for (var j = 0; j < video.length; j++) {
    var p = matchCollectionFile(video[j].path || video[j].name, parts);
    if (p) { map.files[String(video[j].id)] = { id: p.id, title: p.title, poster: p.poster }; n++; }
  }
  console.log('🎞️ Сборник ' + h.slice(0, 8) + ': коллекция «' + (coll.name || bc.id) + '», сопоставлено файлов ' + n + ' из ' + video.length);
  return map;
}

/**
 * Посчитать карту файлов сборника (один раз на раздачу). Promise<карта|null>;
 * waitMs — не ждать дольше (запуск плеера не должен стоять из-за TMDB).
 */
function ensureCollectionMap(hash, waitMs) {
  if (!hash) return Promise.resolve(null);
  var h = String(hash).toLowerCase();
  var ready = readCollectionMap(h);
  if (ready) return Promise.resolve(ready);
  if (!collectionMapPending[h]) {
    collectionMapPending[h] = buildCollectionMap(h).then(function (m) {
      delete collectionMapPending[h];
      if (!m) return null;
      collectionMaps[h] = m;
      try { localStorage.setItem(COLLECTION_MAP_PREFIX + h, JSON.stringify(m)); } catch (e) { }
      return m;
    }, function (e) {
      delete collectionMapPending[h];
      console.warn('Сборник: карта файлов не посчиталась:', e && e.message);
      return null;
    });
  }
  if (!(waitMs > 0)) return collectionMapPending[h];
  return Promise.race([collectionMapPending[h], new Promise(function (r) { setTimeout(function () { r(null); }, waitMs); })]);
}
window.ensureCollectionMap = ensureCollectionMap;

/**
 * Запущен файл сборника — в историю его фильм, а не фильм раздачи: по нему
 * главная и карточка найдут «Продолжить». Повтор того же файла за минуту
 * (несколько путей запуска зовут это по очереди) — не дублируем.
 */
var collectionHistoryNoted = { key: '', at: 0 };
function noteCollectionPlayback(hash, fileId) {
  if (!hash || fileId === null || fileId === undefined) return;
  ensureCollectionMap(hash).then(function () {
    var part = collectionPartFor(hash, fileId);
    if (!part || !window.addToWatchHistory) return;
    var key = String(hash).toLowerCase() + ':' + fileId, now = Date.now();
    if (collectionHistoryNoted.key === key && now - collectionHistoryNoted.at < 60000) return;
    collectionHistoryNoted = { key: key, at: now };
    Promise.resolve(window.addToWatchHistory(part.id, part.title, 'movie', part.poster))['catch'](function () { });
  });
}

/**
 * id TMDB, сезон и серия файла для запроса заставок или null.
 * Раньше брались AppState.currentTMDB/currentSeason, а их detail ставит только
 * для раздачи из одного сезона: у MonoServer сезоны приходят полем, обычно
 * все сразу, — и запрос уходил с пустыми tmdb_id и season. Номером серии
 * шёл id файла в TorrServer, а не номер серии.
 * Порядок: сведения о серии (сопоставлены с TMDB), имя файла (S01E05),
 * единственный сезон раздачи и порядковый номер файла.
 */
function resolveSkipTarget(torrent, fileId) {
  var tmdbId = getTorrentTmdbId(torrent) || AppState.currentTMDB || null;
  if (!tmdbId) return null;
  var season = null, episode = null;
  var hash = torrent && torrent.hash ? torrent.hash : currentTorrentHash;
  var meta = (hash && typeof window.getTorrentEpisodeMeta === 'function') ? window.getTorrentEpisodeMeta(hash, fileId) : null;
  if (meta && meta.season !== undefined && meta.season !== null && meta.episode) {
    season = meta.season; episode = meta.episode;
  } else {
    var idx = -1;
    for (var i = 0; i < currentEpisodeFiles.length; i++) {
      if (String(currentEpisodeFiles[i].id) === String(fileId)) { idx = i; break; }
    }
    var file = idx !== -1 ? currentEpisodeFiles[idx] : null;
    var ref = (file && typeof parseEpisodeRef === 'function') ? parseEpisodeRef(file.path || file.name) : null;
    season = ref && ref.season !== null ? ref.season : getTorrentSingleSeason(torrent);
    // Сезон из detail — только той же раздачи, а не оставшийся от прошлой
    if (season === null && AppState.currentSeason && String(AppState.currentTMDB) === String(tmdbId)) season = AppState.currentSeason;
    episode = ref ? ref.episode : (idx !== -1 ? idx + 1 : null);
  }
  tmdbId = parseInt(tmdbId, 10); season = parseInt(season, 10); episode = parseInt(episode, 10);
  if (!(tmdbId > 0) || !(season >= 0) || !(episode > 0)) return null;
  return { tmdbId: tmdbId, season: season, episode: episode };
}

function renderEpisodesList() {
  var episodesList = getEl('episodes-list');
  if (!episodesList) return;

  // Находим или создаем current-episode-info
  var currentInfo = getEl('current-episode-info');
  if (!currentInfo) {
    // Создаем элемент, если его нет
    currentInfo = document.createElement('div');
    currentInfo.id = 'current-episode-info';
    currentInfo.className = 'current-episode-info';
    // Вставляем перед episodes-list
    episodesList.parentNode.insertBefore(currentInfo, episodesList);
  }

  // Обновляем current-episode-info
  if (currentEpisodeFiles.length === 0) {
    currentInfo.innerHTML = '<span class="current-episode-badge">Пусто</span><span>Нет доступных серий</span>';
    episodesList.innerHTML = '<div class="search-result-empty">Нет доступных серий</div>';
    return;
  }

  // Обновляем информацию о текущей серии
  currentInfo.innerHTML = '<span class="current-episode-badge">Текущая</span><span>Серия ' + (currentEpisodeIndex + 1) + ' из ' + currentEpisodeFiles.length + '</span>';

  // Рендерим список серий (без current-episode-info внутри)
  var html = '';
  for (var idx = 0; idx < currentEpisodeFiles.length; idx++) {
    var file = currentEpisodeFiles[idx];
    var isActive = idx === currentEpisodeIndex;
    var fileSize = formatBytes(file.length);
    // Номер и название серии из TMDB (сведения собирает torrents.js), иначе порядковый
    var meta = getEpisodeMetaForFile(file);
    var episodeNumber = (meta && meta.episode) || (idx + 1);
    var episodeTitle = getEpisodeLabel(file, idx);
    html += '<div class="episode-item ' + (isActive ? 'active' : '') + '" data-index="' + idx + '" data-file-id="' + file.id + '">' +
      '<div class="episode-number">' + episodeNumber + '</div>' +
      '<div class="episode-info"><div class="episode-title">' + escapeHtml(episodeTitle) + '</div><div class="episode-duration">' + fileSize + '</div></div>' +
      '<button class="episode-play" title="Воспроизвести">▶</button></div>';
  }
  episodesList.innerHTML = html;

  // Добавляем обработчики событий
  // var episodeItems = episodesList.querySelectorAll('.episode-item');
  // for (var i = 0; i < episodeItems.length; i++) {
  //   (function (item) {
  //     var index = parseInt(item.dataset.index);
  //     var fileId = item.dataset.fileId;
  //     item.addEventListener('click', function (e) {
  //       if (e.target.classList && e.target.classList.contains('episode-play')) return;
  //       switchToEpisode(index, fileId);
  //     });
  //     var playBtn = item.querySelector('.episode-play');
  //     if (playBtn) playBtn.addEventListener('click', function (e) {
  //       e.stopPropagation();
  //       switchToEpisode(index, fileId);
  //     });
  //   })(episodeItems[i]);
  // }
  // Клики обрабатываются делегированием
  setupEpisodesListDelegation();
}

async function switchToEpisode(index, fileId) {
  stopTorrentStatsUpdates();
  currentBufferAhead = 0; wasImmediatePause = false; pauseTimer = null; pauseStartTime = null; thisisseek = false;
  // Кнопка на экране относится к прежней серии: её диапазон в новой ничего не
  // значит. Сама она сбрасывается и по первому тику вне диапазона, но до него
  // успевает повисеть поверх переключения.
  hideSkipButton();
  stopHeartbeat();
  if (!currentTorrentHash || !AppState.currentTorrserverUrl) return;
  if (index === currentEpisodeIndex) { toggleEpisodesPanel(); return; }
  if (nearEndCheckInterval) { clearInterval(nearEndCheckInterval); nearEndCheckInterval = null; }
  await saveTimecodeToServer();
  var savedAudioTrack = currentAudioTrack;
  var episodesPanel = getEl('episodes-panel');
  var episodesBtn = getEl('episodes-btn');
  if (episodesPanel) { episodesPanel.classList.add('hidden'); if (episodesBtn) episodesBtn.classList.remove('active'); }
  getEl('playback-overlay').classList.add('active');
  document.querySelector('.playback-text').textContent = 'Переключение на серию ' + (index + 1) + '...';
  try {
    var playUrl = AppState.currentTorrserverUrl + '/play/' + currentTorrentHash + '/' + fileId;
    currentEpisodeIndex = index; AppState.videoUrl = playUrl;
    if (AppState.currentStreamId) {
      await bgFetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST' });
      AppState.currentStreamId = null;
    }
    var videoPlayer = getEl('video-player');
    videoPlayer.removeEventListener('ended', handleVideoEnded);
    destroyHls();
    if (currentTorrentHash && fileId) await saveAudioPreference(currentTorrentHash, fileId, savedAudioTrack);
    await startHLSPlayback(playUrl, 0, lastPlaybackFromSearch, index, savedAudioTrack);
    var episodeTitle = getEpisodePlayerTitle(currentTorrentHash, fileId);
    if (episodeTitle) updatePlayerTitle(episodeTitle);
    else {
      var fileName = await getFileNameByHash(currentTorrentHash, fileId);
      if (fileName && AppState.currentDetailItem) updatePlayerTitle(AppState.currentDetailItem.title + ' - ' + fileName);
    }
    renderEpisodesList(); updateEpisodeButtons();
  } catch (error) { showSwitchFailedBanner('серию', error && error.message); }
  finally {
    getEl('playback-overlay').classList.remove('active');
    document.querySelector('.playback-text').textContent = 'Воспроизведение...';
    hidePlayerLoading(); startHeartbeat(); startTorrentStatsUpdates();
  }
}

// ==================== ПАНЕЛИ ПЛЕЕРА (серии / аудио / субтитры) ====================
/**
 * Три панели устроены одинаково, поэтому и открываются одинаково: открыта
 * ровно одна. Раньше у каждой был свой toggle, и «Серии» не закрывали аудио и
 * субтитры — на экране могли оказаться две панели сразу.
 */
// Аудио и субтитры открываются из одного меню («Аудио и субтитры»), поэтому
// у всех трёх одна кнопка — tracks-btn: она подсвечена, пока открыто любое из них
var PLAYER_PANELS = {
  episodes: { panel: 'episodes-panel', btn: 'episodes-btn' },
  tracks: { panel: 'tracks-panel', btn: 'tracks-btn' },
  audio: { panel: 'audio-panel', btn: 'tracks-btn' },
  subtitles: { panel: 'subtitles-panel', btn: 'tracks-btn' },
  onlinesubs: { panel: 'online-subs-panel', btn: 'tracks-btn' },
  settings: { panel: 'player-settings-panel', btn: 'player-settings-btn' }
};

function setPlayerPanel(name, open) {
  var cfg = PLAYER_PANELS[name];
  if (!cfg) return false;
  var panel = getEl(cfg.panel), btn = getEl(cfg.btn);
  if (!panel) return false;
  if (open) { panel.classList.remove('hidden'); if (btn) btn.classList.add('active'); }
  else { panel.classList.add('hidden'); if (btn) btn.classList.remove('active'); }
  return true;
}

function isPlayerPanelOpen(name) {
  var cfg = PLAYER_PANELS[name];
  var panel = cfg && getEl(cfg.panel);
  return !!(panel && !panel.classList.contains('hidden'));
}

function closePlayerPanels(except) {
  // Кнопка у аудио и субтитров общая: панель, которая остаётся открытой,
  // красит её последней, иначе закрытие соседки сняло бы подсветку
  for (var name in PLAYER_PANELS) {
    if (name !== except) setPlayerPanel(name, false);
  }
  if (except && isPlayerPanelOpen(except)) setPlayerPanel(except, true);
  if (!except) tracksMenuOrigin = null;
}
window.closePlayerPanels = closePlayerPanels;

/** Открытая панель плеера (элемент) или null. Читает control.js. */
function getOpenPlayerPanel() {
  for (var name in PLAYER_PANELS) {
    if (isPlayerPanelOpen(name)) return getEl(PLAYER_PANELS[name].panel);
  }
  return null;
}
window.getOpenPlayerPanel = getOpenPlayerPanel;

function togglePlayerPanel(name) {
  var willOpen = !isPlayerPanelOpen(name);
  closePlayerPanels(name);
  if (willOpen) {
    if (name === 'episodes') {
      var hash = AppState.currentDetailItem && AppState.currentDetailItem.hash;
      // Список уже собран для этого торрента — только перерисовываем.
      // loadEpisodesInfo ходит в TorrServer до четырёх раз с паузами по 800 мс,
      // а раньше это повторялось на каждое открытие панели.
      if (hash && currentEpisodeFiles.length && currentTorrentHash === hash) renderEpisodesList();
      else if (hash) loadEpisodesInfo(hash);
    } else if (name === 'audio') renderAudioTracks();
    else if (name === 'subtitles') renderSubtitleTracks();
    else if (name === 'onlinesubs') OnlineSubs.open();
    else if (name === 'tracks') updateTracksMenu();
    else if (name === 'settings') updatePlayerSettingsMenu();
  }
  // Раздел открыли не из меню (красная кнопка пульта) — «Назад» из него
  // закрывает панель. Из меню — openTracksSection поставит origin заново
  tracksMenuOrigin = null;
  setPlayerPanel(name, willOpen);
  return willOpen;
}
window.togglePlayerPanel = togglePlayerPanel;

// ==================== МЕНЮ «АУДИО И СУБТИТРЫ» ====================
// Раздел, открытый из меню: «Назад» в нём возвращает в меню на тот же пункт
var tracksMenuOrigin = null;

/** Подписи под пунктами меню — выбранные сейчас дорожка звука и субтитры */
function updateTracksMenu() {
  var audioValue = getEl('tracks-audio-value');
  var subsValue = getEl('tracks-subtitles-value');
  if (audioValue) {
    var a = currentAudioTracks && currentAudioTracks[currentAudioTrack];
    audioValue.textContent = !currentAudioTracks || !currentAudioTracks.length ? 'Нет дорожек'
      : a ? (a.title || ('Дорожка ' + (currentAudioTrack + 1))) +
        (a.language && a.language !== 'und' ? ' · ' + a.language.toUpperCase() : '')
      : 'По умолчанию';
  }
  if (subsValue) {
    var s = currentSubTracks && currentSubTracks[currentSubtitleTrack];
    subsValue.textContent = !currentSubTracks || !currentSubTracks.length ? 'Нет субтитров'
      : s ? (s.title || ('Субтитры ' + (currentSubtitleTrack + 1))) +
        (s.language && s.language !== 'und' ? ' · ' + s.language.toUpperCase() : '')
      : 'Выключены';
  }
  var onlineValue = getEl('tracks-online-value');
  if (onlineValue) onlineValue.textContent = OnlineSubs.summary();
}

/** Пункт меню → список дорожек этого раздела */
function openTracksSection(section) {
  togglePlayerPanel(section);
  tracksMenuOrigin = section;
  if (typeof focusActivePanelItem === 'function') focusActivePanelItem(section);
}

/**
 * «Назад» в плеере (control.js: playerBackPress). Из раздела, открытого через
 * меню, — обратно в меню на тот же пункт. true — нажатие обработано.
 */
function playerPanelBack() {
  var section = tracksMenuOrigin;
  if (!section || !isPlayerPanelOpen(section)) return false;
  togglePlayerPanel('tracks');
  var row = getEl(section === 'audio' ? 'tracks-audio-item' : section === 'onlinesubs' ? 'tracks-online-item' : 'tracks-subtitles-item');
  if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
  if (row && typeof focusEl === 'function') setTimeout(function () { focusEl(row); }, 0);
  return true;
}
window.playerPanelBack = playerPanelBack;

function setupTracksButton() {
  var tracksBtn = getEl('tracks-btn');
  var panel = getEl('tracks-panel');
  if (!tracksBtn || !panel) return;

  tracksBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    // Открыт раздел (аудио или субтитры) — кнопка его закрывает, а не
    // открывает меню поверх
    if (isPlayerPanelOpen('audio') || isPlayerPanelOpen('subtitles') || isPlayerPanelOpen('onlinesubs')) closePlayerPanels();
    else togglePlayerPanel('tracks');
    resetMouseIdleTimer();
  });
  panel.addEventListener('click', function (e) {
    // Дальше не пускаем: общий «клик мимо панели» (setupPlayerPanelsOutsideClick)
    // увидел бы клик вне только что открытого раздела и тут же его закрыл
    e.stopPropagation();
    var item = e.target && e.target.closest ? e.target.closest('.player-menu-item') : null;
    if (item && item.dataset.section) openTracksSection(item.dataset.section);
    resetMouseIdleTimer();
  });
  var closeBtn = getEl('close-tracks');
  if (closeBtn) closeBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    setPlayerPanel('tracks', false);
    resetMouseIdleTimer();
  });
  setupPlayerPanelsOutsideClick();
}

// ==================== РАЗМЕР СУБТИТРОВ ====================
// Одна настройка на два места: «Размер субтитров» в разделе «Плеер» настроек
// (app.js: setupSubtitleSizeSetting) и пункт в шестерёнке плеера. Не на
// Android — там играет нативный плеер приложения. Субтитры рисуют трое:
//  - браузер — дорожки <video> (прямой файл, VTTCue из потока сервера):
//    ::cue{font-size} в процентах от его размера по умолчанию;
//  - свой блок #tizen-avplay-subs (Tizen, AVPlay) — 4.4vh из styles.css × масштаб;
//  - медиасервис webOS (прямой файл) — luna setSubtitleFontSize, уровни 0–4,
//    2 — его обычный размер. Метод недокументированный (им пользуется плеер
//    Stremio), поэтому ошибку молча пропускаем.
// Пять уровней — по числу уровней webOS, номер уровня и есть fontSize.
// Правила пишем готовыми числами, без CSS-переменных: Tizen 3 — Chrome 47.
var SUBTITLE_SIZES = [
  { label: 'Очень мелкие', scale: 0.7 },
  { label: 'Мелкие', scale: 0.85 },
  { label: 'Обычные', scale: 1 },
  { label: 'Крупные', scale: 1.3 },
  { label: 'Очень крупные', scale: 1.6 }
];
var SUBTITLE_SIZE_DEFAULT = 2;
var AVPLAY_SUBS_VH = 4.4;   // font-size #tizen-avplay-subs в styles.css
window.SUBTITLE_SIZES = SUBTITLE_SIZES;

function getSubtitleSize() {
  var v = NaN;
  try { v = parseInt(localStorage.getItem('subtitleSize'), 10); } catch (e) { }
  return v >= 0 && v < SUBTITLE_SIZES.length ? v : SUBTITLE_SIZE_DEFAULT;
}
window.getSubtitleSize = getSubtitleSize;

/** Размер субтитров webOS для включённых субтитров прямого файла */
function webosSubtitleFontSize(mediaId) {
  if (!mediaId) return;
  lunaRequest('luna://com.webos.media', 'setSubtitleFontSize',
    { mediaId: mediaId, fontSize: getSubtitleSize() }, null, null, true);
}

function applySubtitleSize() {
  var scale = SUBTITLE_SIZES[getSubtitleSize()].scale;
  var style = getEl('subtitle-size-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'subtitle-size-style';
    document.head.appendChild(style);
  }
  // Обычный размер — без правил: браузер и styles.css как были
  style.textContent = scale === 1 ? '' :
    '#video-player::cue{font-size:' + Math.round(scale * 100) + '%;}' +
    '#tizen-avplay-subs,#online-subs-box{font-size:' + (AVPLAY_SUBS_VH * scale).toFixed(2) + 'vh;}';
  if (webosSubs.enabled && webosSubs.mediaId) webosSubtitleFontSize(webosSubs.mediaId);
}

function setSubtitleSize(level) {
  level = parseInt(level, 10);
  if (!(level >= 0 && level < SUBTITLE_SIZES.length)) return;
  try { localStorage.setItem('subtitleSize', String(level)); } catch (e) { }
  applySubtitleSize();
  updatePlayerSettingsMenu();
  if (typeof window.updateSubtitleSizeSetting === 'function') window.updateSubtitleSizeSetting();
}
window.setSubtitleSize = setSubtitleSize;

// ==================== НАСТРОЙКИ ПЛЕЕРА (шестерёнка) ====================
/** Переключатели в панели — по текущему состоянию часов и строки буфера */
function updatePlayerSettingsMenu() {
  var clock = getEl('psetting-clock'), buffer = getEl('psetting-buffer');
  var clockShown = typeof hideClockEnabled === 'undefined' || !hideClockEnabled;
  if (clock) clock.classList.toggle('is-on', clockShown);
  if (buffer) buffer.classList.toggle('is-on', !AppState.bufferHidden);
  var autoSkip = getEl('psetting-autoskip');
  if (autoSkip) autoSkip.classList.toggle('is-on', !!AppState.autoSkipIntro);
  var manualHide = getEl('psetting-manualhide');
  if (manualHide) manualHide.classList.toggle('is-on', !!AppState.playerManualHide);
  var saver = getEl('psetting-screensaver');
  if (saver) {
    saver.classList.toggle('is-on', AppState.playerScreensaver !== false);
    // Общий «Скринсейвер» (раздел «Прочее») снят — пункт ни на что не влияет.
    // Android прячет его всегда: там нативный плеер
    saver.style.display = (window.AndroidJS || AppState.screensaver === false) ? 'none' : '';
  }
  var diag = getEl('psetting-diag');
  if (diag) {
    diag.classList.toggle('is-on', !!(window.PlayerDiag && PlayerDiag.enabled()));
    diag.style.display = (window.AndroidJS || !window.PlayerDiag) ? 'none' : '';
  }
  var rememberZoom = getEl('psetting-zoom');
  if (rememberZoom) rememberZoom.classList.toggle('is-on', !!AppState.playerRememberZoom);
  var subSize = getEl('psetting-subsize-value');
  if (subSize) subSize.textContent = SUBTITLE_SIZES[getSubtitleSize()].label;
}
window.updatePlayerSettingsMenu = updatePlayerSettingsMenu;

function setupPlayerSettingsButton() {
  applySubtitleSize();
  // Android: субтитры рисует нативный плеер приложения
  var subSizeItem = getEl('psetting-subsize');
  if (subSizeItem && window.AndroidJS) subSizeItem.style.display = 'none';
  // ...и кнопки пропуска там тоже нет
  var autoSkipItem = getEl('psetting-autoskip');
  if (autoSkipItem && window.AndroidJS) autoSkipItem.style.display = 'none';
  // ...и HUD там свой, нативный
  var manualHideItem = getEl('psetting-manualhide');
  if (manualHideItem && window.AndroidJS) manualHideItem.style.display = 'none';
  // ...и масштаб кадра тоже его
  var zoomItem = getEl('psetting-zoom');
  if (zoomItem && window.AndroidJS) zoomItem.style.display = 'none';
  var btn = getEl('player-settings-btn');
  var panel = getEl('player-settings-panel');
  if (!btn || !panel) return;

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    togglePlayerPanel('settings');
    resetMouseIdleTimer();
  });
  panel.addEventListener('click', function (e) {
    var item = e.target && e.target.closest ? e.target.closest('.player-menu-item') : null;
    if (item && item.id === 'psetting-clock' && typeof setClockHidden === 'function') {
      setClockHidden(item.classList.contains('is-on'));
    } else if (item && item.id === 'psetting-buffer' && typeof toggleBufferVisibility === 'function') {
      toggleBufferVisibility();
    } else if (item && item.id === 'psetting-autoskip' && typeof setAutoSkip === 'function') {
      setAutoSkip(!AppState.autoSkipIntro);
    } else if (item && item.id === 'psetting-manualhide' && typeof setPlayerManualHide === 'function') {
      setPlayerManualHide(!AppState.playerManualHide);
    } else if (item && item.id === 'psetting-diag' && window.PlayerDiag) {
      PlayerDiag.setEnabled(!PlayerDiag.enabled());
    } else if (item && item.id === 'psetting-zoom' && typeof setPlayerRememberZoom === 'function') {
      setPlayerRememberZoom(!AppState.playerRememberZoom);
    } else if (item && item.id === 'psetting-screensaver' && typeof setPlayerScreensaver === 'function') {
      setPlayerScreensaver(AppState.playerScreensaver === false);
    } else if (item && item.id === 'psetting-subsize') {
      // ОК — следующий размер, после самого крупного — снова самый мелкий
      setSubtitleSize((getSubtitleSize() + 1) % SUBTITLE_SIZES.length);
    }
    updatePlayerSettingsMenu();
    resetMouseIdleTimer();
  });
  var closeBtn = getEl('close-player-settings');
  if (closeBtn) closeBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    setPlayerPanel('settings', false);
    resetMouseIdleTimer();
  });
  setupPlayerPanelsOutsideClick();
}

/**
 * Перемотка кнопками ±10 с. Время абсолютное (currentTime + seekOffset), как у
 * ползунка; без hls.js (прямой файл, транскодирование) серверной перемотки
 * нет — двигаем <video> сам, как это делает ползунок (app.js: change).
 */
var HUD_SEEK_STEP_SEC = 10;
function seekRelative(delta) {
  var video = getEl('video-player');
  if (!video) return;
  // Идёт перемотка: последнюю цель держит очередь seekStream, считаем от неё
  var base = AppState.isSeeking && typeof AppState.previewTime === 'number' ? AppState.previewTime
    : video.currentTime + (AppState.seekOffset || 0);
  var total = AppState.originalDuration || AppState.expectedDuration || video.duration;
  var target = base + delta;
  if (target < 0) target = 0;
  if (total && isFinite(total) && target > total - 1) target = Math.max(0, total - 1);

  var slider = getEl('seek-slider');
  if (slider) slider.value = target;
  var currentTimeEl = getEl('current-time');
  if (currentTimeEl) currentTimeEl.textContent = formatTime(target);
  if (typeof window.showSeekOverlay === 'function') {
    window.showSeekOverlay(target, delta < 0 ? -1 : 1, Math.abs(delta));
    if (typeof window.scheduleHideSeekOverlay === 'function') window.scheduleHideSeekOverlay();
  }

  if (!AppState.hls) {
    video.currentTime = target - (AppState.seekOffset || 0);
    if (typeof updateTimeDisplay === 'function') updateTimeDisplay();
  } else {
    AppState.previewTime = target;
    AppState.suppressTimeUpdate = true;
    seekStream(target, 'button');
  }
}
window.seekRelative = seekRelative;

function setupSeekButtons() {
  var rew = getEl('rewind-btn'), fwd = getEl('forward-btn');
  if (rew) rew.addEventListener('click', function (e) { e.stopPropagation(); seekRelative(-HUD_SEEK_STEP_SEC); resetMouseIdleTimer(); });
  if (fwd) fwd.addEventListener('click', function (e) { e.stopPropagation(); seekRelative(HUD_SEEK_STEP_SEC); resetMouseIdleTimer(); });
}

/**
 * Клик мимо открытой панели закрывает её. Один слушатель на все три: раньше
 * setupEpisodesButton / setupAudioButton / setupSubtitlesButton вешали по
 * своему на document.
 */
function setupPlayerPanelsOutsideClick() {
  setupPlayerPanelsActivity();
  if (setupPlayerPanelsOutsideClick._bound) return;
  setupPlayerPanelsOutsideClick._bound = true;
  document.addEventListener('click', function (e) {
    var inPlayer = AppState && AppState.currentScreen === 'player';
    // Пункт панели, перерисовавший её на своём же клике (онлайн-субтитры:
    // «раньше/позже», выбор файла), к document доходит уже оторванным — и
    // panel.contains его не находит. Это клик внутри, а не мимо
    if (e.target && e.target.isConnected === false) {
      if (inPlayer) resetMouseIdleTimer();
      return;
    }
    for (var name in PLAYER_PANELS) {
      if (!isPlayerPanelOpen(name)) continue;
      var cfg = PLAYER_PANELS[name];
      var panel = getEl(cfg.panel), btn = getEl(cfg.btn);
      if (panel && panel.contains(e.target)) continue;
      if (btn && btn.contains(e.target)) continue;
      setPlayerPanel(name, false);
    }
    if (inPlayer) resetMouseIdleTimer();
  });
}

function toggleEpisodesPanel() { return togglePlayerPanel('episodes'); }

// ==================== ДЕЛЕГИРОВАНИЕ СПИСКОВ ПЛЕЕРА ====================
function setupEpisodesListDelegation() {
  var episodesList = getEl('episodes-list');
  if (!episodesList || episodesList._delegated) return;

  episodesList._delegated = true;

  episodesList.addEventListener('click', function (e) {
    var item = e.target && e.target.closest ? e.target.closest('.episode-item') : null;
    if (!item) return;

    var index = parseInt(item.dataset.index, 10);
    var fileId = item.dataset.fileId;

    if (isNaN(index) || !fileId) return;

    switchToEpisode(index, fileId);

    if (typeof resetMouseIdleTimer === 'function') {
      resetMouseIdleTimer();
    }
  });
}

function setupAudioListDelegation() {
  var audioList = getEl('audio-list');
  if (!audioList || audioList._delegated) return;

  audioList._delegated = true;

  audioList.addEventListener('click', function (e) {
    var item = e.target && e.target.closest ? e.target.closest('.audio-item') : null;
    if (!item) return;

    var trackIndex = parseInt(item.dataset.trackIndex, 10);
    if (isNaN(trackIndex)) return;

    switchAudioTrack(trackIndex);

    if (typeof resetMouseIdleTimer === 'function') {
      resetMouseIdleTimer();
    }
  });
}

function setupSubtitlesListDelegation() {
  var subtitlesList = getEl('subtitles-list');
  if (!subtitlesList || subtitlesList._delegated) return;

  subtitlesList._delegated = true;

  subtitlesList.addEventListener('click', function (e) {
    var item = e.target && e.target.closest ? e.target.closest('.subtitle-item') : null;
    if (!item) return;

    var trackIndex = parseInt(item.dataset.trackIndex, 10);
    if (isNaN(trackIndex)) return;

    switchSubtitleTrack(trackIndex);

    if (typeof resetMouseIdleTimer === 'function') {
      resetMouseIdleTimer();
    }
  });
}
// ==================== /ДЕЛЕГИРОВАНИЕ СПИСКОВ ПЛЕЕРА ====================

function setupEpisodesButton() {
  var episodesBtn = getEl('episodes-btn');
  var closeEpisodesBtn = getEl('close-episodes');
  var episodesPanel = getEl('episodes-panel');

  if (!episodesBtn || !closeEpisodesBtn || !episodesPanel) return;

  // Делегирование кликов по списку серий
  setupEpisodesListDelegation();

  episodesBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    toggleEpisodesPanel();
    resetMouseIdleTimer();
  });

  closeEpisodesBtn.addEventListener('click', function () {
    setPlayerPanel('episodes', false);
    resetMouseIdleTimer();
  });

  setupPlayerPanelsOutsideClick();
}

/**
 * Просит TorrServer поднять куски файла заранее.
 *
 * Вызывается из двух мест: отсюда, перед стартом воспроизведения, и из
 * showDetail (torrents.js) — там прогрев идёт ещё пока человек читает описание,
 * чтобы серверный ffprobe не уткнулся в холодную раздачу.
 */

/**
 * Когда какой файл грели: ключ '<hash>:<fileId>' → отметка времени.
 *
 * Открыть карточку и нажать «Играть» — это два прогрева одного файла подряд,
 * второй бесполезен. Просто убрать вызов из preparePlaybackMetadata нельзя:
 * переключение серии внутри плеера (next/prev, список серий, автопереход по
 * окончании) идёт мимо экрана деталей, и там прогрев единственный.
 *
 * Отметка со сроком, а не «однажды за сеанс»: через полчаса TorrServer уже
 * мог вытеснить куски из кэша, а лишний preload стоит одного запроса против
 * пятнадцати секунд таймаута ffprobe на холодной раздаче.
 */
var preloadedFilesAt = {};
var PRELOAD_TTL_MS = 5 * 60 * 1000;
var PRELOADED_FILES_LIMIT = 200;
var preloadedFilesCount = 0;

function wasPreloadedRecently(hash, fileId) {
  var key = String(hash).toLowerCase() + ':' + fileId;
  var at = preloadedFilesAt[key];
  if (at && Date.now() - at < PRELOAD_TTL_MS) return true;
  if (!at) {
    // Переполнение сбрасываем целиком: худшее последствие — лишний preload
    // для файла, открытого две сотни карточек назад.
    if (preloadedFilesCount >= PRELOADED_FILES_LIMIT) {
      preloadedFilesAt = {};
      preloadedFilesCount = 0;
    }
    preloadedFilesCount++;
  }
  preloadedFilesAt[key] = Date.now();
  return false;
}
/**
 * Прогрев в полёте — не больше одного.
 *
 * TorrServer держит ответ на ?preload=preload открытым, пока буферизует: на
 * прогретой раздаче это секунда, на холодной — сколько угодно. Пока прогрев
 * звали только перед стартом воспроизведения, один висящий запрос никому не
 * мешал. С прогревом на экране деталей каждая открытая карточка добавляла свой,
 * а браузер держит к одному хосту лишь шесть соединений по HTTP/1.1 — после
 * пяти-шести карточек всё остальное к TorrServer (stat, /torrents, постеры)
 * вставало в очередь, и приложение выглядело зависшим.
 *
 * Поэтому новый прогрев отменяет предыдущий: он всё равно спекулятивный, и
 * греть карточку, с которой человек уже ушёл, незачем. Отменённый файл убираем
 * из отметок, иначе при возврате на ту же карточку прогрев не повторился бы —
 * хотя ничего и не прогрелось.
 */
var pendingPreload = null;

function abortPendingPreload() {
  if (!pendingPreload) return;
  var stale = pendingPreload;
  pendingPreload = null;
  delete preloadedFilesAt[stale.key];
  try { stale.controller.abort(); } catch (e) { }
}

function preloadTorrents(hash, fileId) {
  if (!hash || !fileId || !AppState.currentTorrserverUrl) return;
  if (wasPreloadedRecently(hash, fileId)) return;
  var key = String(hash).toLowerCase() + ':' + fileId;
  var preloadUrl = AppState.currentTorrserverUrl + "/stream?link=" + hash + "&index=" + fileId + "&preload=preload";
  // Без заголовков авторизации TorrServer с включённым паролем отдаёт 401, и
  // прогрев молча не происходит — заметить это по поведению нельзя.
  var headers = (typeof getAuthHeaders === 'function') ? getAuthHeaders() : {};
  var options = { method: 'GET', keepalive: true, headers: headers };
  var controller = (typeof AbortController === 'function') ? new AbortController() : null;
  abortPendingPreload();
  if (controller) {
    options.signal = controller.signal;
    pendingPreload = { key: key, controller: controller };
  }
  var done = function () {
    if (pendingPreload && pendingPreload.key === key) pendingPreload = null;
  };
  // Через фоновый поток (poster-prefetch.js: BgFetch); тело ответа не нужно
  options.bgMode = 'none';
  return (window.bgFetch ? window.bgFetch(preloadUrl, options) : fetch(preloadUrl, options))
    .then(function (response) { done(); return new Promise(function (resolve) { setTimeout(resolve, 4000); }); })
    .catch(function (error) { done(); return Promise.resolve(); });
}

function getCurrentItemPoster() {
  var item = AppState.currentDetailItem;
  if (!item) return null;
  if (item.poster) return item.poster;
  if (item.poster_path && typeof getTmdbImageUrl === 'function') {
    try { return getTmdbImageUrl(item.poster_path, 'w342'); } catch (e) { /* ignore */ }
  }
  return null;
}

/**
 * Строит плейлист ВСЕХ серий торрента, чтобы нативный плеер переключал их сам,
 * без возврата в веб-страницу между сериями.
 *
 * Раньше список резался «с текущей серии и до конца». Из-за этого при запуске
 * со второй серии плеер получал 5 файлов вместо 6, вторая серия становилась в
 * плейлисте первой, и он показывал «Эпизод 1 из 5». Плюс кнопка «предыдущая
 * серия» не могла увести назад.
 *
 * Отдаём весь список целиком: с какого элемента стартовать, MainActivity
 * вычисляет сама — ищет в плейлисте совпадение по url с запускаемым файлом
 * (runPlayer, indexOfFirst), а startSeekTime применяется только к нему.
 */
function buildEpisodesPlaylist(fromIndex, startSeekTime) {
  if (!Array.isArray(currentEpisodeFiles) || currentEpisodeFiles.length < 2) return null;
  if (!currentTorrentHash || !AppState.currentTorrserverUrl) return null;
  var startIndex = (typeof fromIndex === 'number' && fromIndex >= 0) ? fromIndex : currentEpisodeIndex;
  if (typeof startIndex !== 'number' || startIndex < 0) return null;
  // Прогресс по всем файлам торрента уже лежит в кэше (его греет
  // startHLSPlayback перед открытием внешнего плеера) — берём его синхронно.
  var progress = null;
  try {
    if (typeof torrentProgressCache !== 'undefined' && torrentProgressCache) progress = torrentProgressCache.get(currentTorrentHash);
  } catch (e) { /* кэша нет — пойдём с нулевыми таймкодами */ }
  var byFileId = (progress && progress.byFileId) || {};
  var playlist = [];
  for (var i = 0; i < currentEpisodeFiles.length; i++) {
    var file = currentEpisodeFiles[i];
    if (!file || file.id === undefined || file.id === null) continue;
    var itemUrl = AppState.currentTorrserverUrl + "/stream?link=" + currentTorrentHash + "&index=" + file.id + "&play=play";
    // Свой timeline у КАЖДОГО элемента плейлиста обязателен: именно его
    // нативный плеер вернёт в updatePlayerTimeline при выходе. Без него hash
    // приходил пустым ('0'), и таймкод серии терялся целиком.
    var saved = byFileId[String(file.id)];
    var itemTime = (i === startIndex && startSeekTime > 0) ? Math.floor(startSeekTime)
      : (saved && saved.timecode > 0 ? Math.floor(saved.timecode) : 0);
    var itemDuration = (saved && saved.duration > 0) ? saved.duration : 0;
    playlist.push({
      url: itemUrl,
      title: file.name || file.path || ('Серия ' + (i + 1)),
      // «Серия 1 - Название» для встроенного плеера приложения (с 1.1.12 он
      // показывает её в списке серий и заголовке вместо «Эпизод N»). Отдельным
      // полем: title по-прежнему уходит внешним плеерам и старым версиям
      episode_title: getEpisodeLabel(file, i),
      timecode: itemTime,
      timeline: {
        hash: currentTorrentHash + '_' + file.id,
        time: itemTime,
        duration: itemDuration,
        percent: itemDuration > 0 ? Math.round((itemTime / itemDuration) * 100) : 0
      },
      episode: i + 1,
      season: AppState.currentSeason || null,
      online_subs: onlineSubsPayload(currentTorrentHash, file.id)
    });
  }
  return playlist.length > 1 ? playlist : null;
}

/**
 * Заголовок для внешнего плеера (AndroidJS): название плюс номер серии.
 *
 * Встроенный плеер показывает имя файла (updatePlayerTitle(fileName) в
 * startHLSPlayback), и серия в нём видна сама собой. Внешнему же передавалось
 * голое AppState.currentDetailItem.title — какую серию смотришь, на экране
 * телевизора было не понять.
 *
 * Данные к этому моменту уже есть: ветка AndroidJS специально дожидается
 * loadEpisodesInfo до запуска плеера (ей нужен плейлист), а тот заполняет
 * currentEpisodeFiles и currentEpisodeIndex.
 *
 * Формат «Серия N» — тот же, что в панели серий и в fallback'е
 * buildEpisodesPlaylist. Для фильма (файл один) остаётся чистое
 * название: дописывать «Серия 1» там незачем.
 */
/**
 * Название БЕЗ номера серии: сериал и, если известен, сезон.
 *
 * Нужно встроенному плееру (AndroidJS + Media3): он ведёт плейлист сам и знает
 * текущий индекс, поэтому номер эпизода дописывает уже на своей стороне. Если
 * отдать ему готовое «Серия 1», номер останется от той серии, с которой запуск
 * начался, и на второй серии заголовок превратится в «Серия 1 · Эпизод 2».
 *
 * Внешним плеерам по-прежнему уходит buildExternalPlayerTitle(): они плейлист
 * не отслеживают, и номер им надо вшить в строку заранее.
 */
function buildBasePlayerTitle() {
  var base = cleanPlayerBaseTitle(AppState.currentDetailItem && AppState.currentDetailItem.title);
  if (!base) return '';
  if (AppState.currentSeason) return base + ' · Сезон ' + AppState.currentSeason;
  return base;
}

/**
 * Название раздачи без служебных пометок: «[1622] Сверхъестественное
 * [сезон 1-15]» → «Сверхъестественное». TMDB id в квадратных скобках —
 * метка, по которой раздача связана с карточкой; сезон теперь виден в
 * подписи серии («Сезон 1, Серия 1 - …»), а «[сезон 1-15]» рядом с ней
 * только путает. Так же чистит название detail-view (torrents.js: showDetail).
 */
function cleanPlayerBaseTitle(title) {
  return String(title || '')
    .replace(/\[\d+\]/g, '')
    .replace(/\[(сезон|season)[^\]]*\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildExternalPlayerTitle() {
  var base = cleanPlayerBaseTitle(AppState.currentDetailItem && AppState.currentDetailItem.title);

  if (!currentEpisodeFiles || currentEpisodeFiles.length < 2) return base || 'Видео';

  var idx = currentEpisodeIndex;
  if (typeof idx !== 'number' || idx < 0 || !currentEpisodeFiles[idx]) return base || 'Видео';

  var part = getEpisodeLabel(currentEpisodeFiles[idx], idx);
  if (AppState.currentSeason) part = 'Сезон ' + AppState.currentSeason + ', ' + part;

  // Без названия сериала (из поиска торрентов такое бывает) — отдаём хотя бы
  // имя файла, оно информативнее одинокого «Серия 3»
  if (!base) {
    var file = currentEpisodeFiles[idx];
    return file.name || file.path || part;
  }

  return base + ' · ' + part;
}

// Последний запуск внешнего плеера: любой повторный вызов с тем же URL в
// пределах пары секунд — это дубль (двойной клик, досланный WebView click),
// а не осознанный перезапуск. Две подряд AndroidJS.openPlayer открывают две
// активити, и вторая вылезает ровно в момент выхода из первой.
var lastExternalOpen = { url: null, time: 0 };
var EXTERNAL_OPEN_DEDUP_MS = 2500;

/**
 * Единственная точка запуска внешнего плеера: глушит дубли и запоминает,
 * чем плеер открывали — чтобы updatePlayerTimeline было от чего оттолкнуться,
 * если нативный плеер вернёт таймлайн без hash.
 */
function openAndroidPlayer(playURL, playerData) {
  if (!window.AndroidJS || !playURL) return false;
  // Не видео (служебный файл Blu-ray, .exe, ISO) — подменить на фильм или не играть
  var playable = resolvePlayableStream(playURL);
  if (playable.error) {
    if (typeof showErrorBanner === 'function') showErrorBanner(playable.error);
    else if (typeof window.showToast === 'function') window.showToast(playable.error);
    return false;
  }
  if (playable.fileId && playable.url !== playURL) {
    var oldUrl = playURL;
    playURL = playable.url;
    if (playerData) {
      if (playerData.url === oldUrl) playerData.url = playURL;
      if (playerData.timeline && playerData.timeline.hash) {
        playerData.timeline.hash = String(playerData.timeline.hash).replace(/_\d+$/, '_' + playable.fileId);
      }
    }
  }
  var urlData = parseHashFromUrl(playURL);
  if (urlData) {
    currentTimecodeData.hash = urlData.torrentHash;
    currentTimecodeData.fileId = urlData.fileId;
    currentTimecodeData.timecode = (playerData && playerData.timecode) || 0;
  }
  if (lastExternalOpen.url === playURL && Date.now() - lastExternalOpen.time < EXTERNAL_OPEN_DEDUP_MS) return false;
  lastExternalOpen.url = playURL; lastExternalOpen.time = Date.now();
  // Цвет фокуса «Внешнего вида»: встроенный плеер Android красит им фокус своих
  // кнопок, чтобы он был того же цвета, что и в интерфейсе
  if (playerData && !playerData.focus_color && window.UICustomizer && UICustomizer.getFocusColor) {
    playerData.focus_color = UICustomizer.getFocusColor();
  }
  AndroidJS.openPlayer(playURL, JSON.stringify(playerData));
  return true;
}
window.openAndroidPlayer = openAndroidPlayer;

function playInExternalPlayer(url, title, timecode, fromSearch) {
  if (!window.AndroidJS || !url) return false;
  var ref = parseStreamRef(url);
  if (ref) {
    var torrentHash = ref.hash; var fileId = parseInt(ref.fileId);
    var seekTime = (timecode != null && timecode > 0) ? Math.floor(timecode) : 0;
    currentTimecodeData.hash = torrentHash; currentTimecodeData.fileId = fileId; currentTimecodeData.timecode = seekTime;
    var playURL = AppState.currentTorrserverUrl + "/stream?link=" + torrentHash + "&index=" + fileId + "&play=play";
    var item = AppState.currentDetailItem;
    var skipTorrent = findLoadedTorrent(torrentHash) || item;
    var playerData = {
      url: playURL, title: title || 'Видео', iptv: false, timecode: seekTime,
      // Для встроенного плеера — без номера серии, он допишет его сам
      title_base: buildBasePlayerTitle(),
      // Данные для кнопки «Пропустить»: встроенный плеер сам дёргает этот API на
      // каждую серию (номер эпизода он берёт из index= в ссылке файла). Адрес
      // передаём отсюда, чтобы смена хоста не требовала пересборки приложения.
      skip_api: getSkipApiBase() + '/v2/media',
      // id и сезон — с самой раздачи (у MonoServer они полями, сезонов бывает
      // несколько — тогда сезон из detail, если он есть)
      tmdb_id: getTorrentTmdbId(skipTorrent) || AppState.currentTMDB || null,
      season: getTorrentSingleSeason(skipTorrent) || AppState.currentSeason || null,
      // Периодическое сохранение таймкода прямо из встроенного плеера. Веб-плеер
      // шлёт его раз в 10 секунд (startTimecodeSaving), а из нативного таймкод
      // приходил только при выходе — через updatePlayerTimeline. Если приложение
      // убьют или пропадёт питание, прогресс терялся целиком.
      timecode_api: SERVER_URL + '/api/timecode/save',
      client_id: localStorage.getItem('clientId') || null,
      timeline: { hash: torrentHash + '_' + fileId, time: seekTime, duration: 0, percent: 0 },
      poster: getCurrentItemPoster(),
      id: item && (item.tmdbId || item.id) || null,
      type: (item && item.media_type) || (AppState.isCatalogSerials ? 'tv' : 'movie'),
      // Что искать в «Онлайн субтитрах» встроенного плеера (с 1.1.x); у
      // элементов плейлиста — своё на каждую серию
      online_subs: onlineSubsPayload(torrentHash, fileId),
      // Прокси онлайн-субтитров (apiproxy.json: subsApi): сначала через него,
      // при отказе — напрямую; пусто — сразу напрямую
      online_subs_proxy: AppState.subsApiHost ? AppState.protocol + '//' + AppState.subsApiHost : ''
    };
    // Список серий — всегда, если приложение умеет его не листать само
    // (AndroidJS.playlistAutoNext, с 1.1.26): «Переключать серии
    // автоматически» выключает только автопереход, а не список серий в плеере.
    // Старому приложению плейлист без автоперехода не объяснить — ему, как
    // раньше, только при включённой настройке.
    var canStopAtEpisodeEnd = typeof window.AndroidJS.playlistAutoNext === 'function';
    if (AppState.autoSwitchEpisodes || canStopAtEpisodeEnd) {
      var playlist = buildEpisodesPlaylist(currentEpisodeIndex, seekTime);
      if (playlist) playerData.playlist = playlist;
    }
    playerData.auto_next = !!AppState.autoSwitchEpisodes;
    // Basic-авторизация TorrServer. Встроенный плеер вешает эти заголовки и на
    // видеопоток, и на опрос /cache (строка статистики под заголовком): без них
    // при включённой авторизации TorrServer отвечает 401 на то и на другое
    var authHeaders = getAuthHeaders();
    if (authHeaders && authHeaders.Authorization) playerData.headers = { Authorization: authHeaders.Authorization };
    lastPlaybackFromSearch = fromSearch;
    androidReturnHome = resumingFromHome ? torrentHash : null;
    if (!AppState.playFromHash) AppState.inSearch = 'torrents';
    else { AppState.currentDetailItem = AppState.androidBackCatalog; AppState.inSearch = 'catalog'; }
    AppState.currentScreen = 'detail';
    openAndroidPlayer(playURL, playerData);
    return true;
  }
  return false;
}

// ==================== «ПРОДОЛЖИТЬ» С ГЛАВНОЙ ====================
// Кнопка баннера главной на карточке ряда «Продолжить просмотр» (home.js):
// запуск прямо оттуда, без захода в карточку фильма и раздачи. Где
// остановились, отдаёт сервер в /api/history (поле resume — общий таймкод
// фильма/серии, routes/history.js).

// Серия досмотрена — дальше этой доли «Продолжить» ведёт на следующую
var RESUME_FINISHED_SHARE = 0.92;

function isResumeFinished(resume) {
  return !!(resume && resume.duration > 0 && resume.timecode >= resume.duration * RESUME_FINISHED_SHARE);
}
window.isResumeFinished = isResumeFinished;

// Нативный плеер Android. resumingFromHome — идёт запуск из resumeWatching;
// androidReturnHome — хэш раздачи, запущенной так (ставит playInExternalPlayer
// на каждый запуск): по возврату (updatePlayerTimeline) — на главную, а не в
// карточку, и раздачу остановить
var resumingFromHome = false;
var androidReturnHome = null;
var androidReturnHomeTimer = null;
// Сериал запущен из выдачи поиска: по возврату остаёмся в ней
var androidReturnSearch = false;

/**
 * Возврат из нативного плеера, запущенного с главной. Таймлайнов приходит
 * пачка (по серии на каждую досмотренную при автопереключении) — главную
 * показываем один раз, после пачки.
 */
function returnHomeFromAndroidPlayer() {
  AppState.playFromHash = false;
  AppState.isCatalogSearch = false;
  if (androidReturnHomeTimer) return;
  androidReturnHomeTimer = setTimeout(function () {
    androidReturnHomeTimer = null;
    var hash = androidReturnHome;
    if (hash) {
      dropTorrentToServer(hash)['catch'](function () { });
      if (torrentProgressCache.has(hash)) torrentProgressCache.delete(hash);
    }
    if (AppState.cardPlayback) { returnToDetailCard(); return; }
    AppState.currentDetailItem = null;
    if (!window.HomeScreen) return;
    // Новое место в кнопку баннера приносит сам показ (updateHistoryResume)
    HomeScreen.show();
  }, 0);
}

/**
 * Возврат из нативного плеера в выдачу поиска, откуда запустили сериал
 * (playFromHash). Оверлей с выдачей и не прятался. Таймлайны приходят пачкой, как
 * и у returnHomeFromAndroidPlayer: флаги снимаем после неё, иначе следующий
 * таймлайн ушёл бы в showDetailView.
 */
function returnSearchFromAndroidPlayer() {
  AppState.isCatalogSearch = false;
  setTimeout(function () {
    androidReturnSearch = false;
    AppState.playFromHash = false;
  }, 0);
}

/**
 * Карточка фильма или сериала, из которой открыли поиск раздач («Поиск
 * торрентов» — строка под замком, setSearchLocked). null — поиск свободный.
 */
function searchOriginCard() {
  if (!AppState.searchLocked) return null;
  var card = AppState.androidBackCatalog || AppState.pendingDetailItem;
  return card && card.id ? card : null;
}

/**
 * Раздачу запускали из выдачи поиска, открытого из карточки: из плеера — в эту
 * карточку, а не обратно в выдачу (выдача закрывается, как по «Назад»).
 * Раздачу останавливаем, как после просмотра из самой карточки.
 * @returns {boolean} false — поиск свободный, остаёмся в выдаче
 */
function returnToCardFromSearch(hash) {
  var card = searchOriginCard();
  if (!card || typeof window.hideSearchResults !== 'function') return false;
  if (hash) {
    dropTorrentToServer(hash)['catch'](function () { });
    if (torrentProgressCache.has(hash)) torrentProgressCache.delete(hash);
  }
  lastPlaybackFromSearch = false;
  androidReturnSearch = false;
  AppState.playFromHash = false;
  AppState.isCatalogSearch = false;
  AppState.isCatalogSerials = false;
  AppState.currentDetailItem = card;
  window.hideSearchResults({ returnTo: 'detail' });
  return true;
}

/**
 * То же для нативного плеера. Таймлайны приходят пачкой (по серии на каждую
 * досмотренную) — карточку показываем один раз, после пачки.
 */
var androidReturnCardTimer = null;
function returnCardFromAndroidPlayer(hash) {
  if (androidReturnCardTimer) return;
  androidReturnCardTimer = setTimeout(function () {
    androidReturnCardTimer = null;
    returnToCardFromSearch(hash);
  }, 0);
}

/**
 * Возврат в карточку-«сцену», откуда запускали «Продолжить» или серию из
 * ленты: она так и лежит собранной, снова только показать. Раздача в
 * currentDetailItem была нужна плееру — возвращаем сам фильм.
 */
function returnToDetailCard() {
  var ctx = AppState.cardPlayback;
  AppState.cardPlayback = null;
  AppState.playFromHash = false;
  AppState.isCatalogSearch = false;
  AppState.currentDetailItem = ctx.item;
  AppState.currentScreen = 'detail';
  if (typeof Animations !== 'undefined' && typeof Animations.ensureDetailVisible === 'function') Animations.ensureDetailVisible();
  else getEl('detail-view').style.display = 'block';
  // Скрытая карточка теряет прокрутку, и лента приезжала бы от самого верха
  getEl('detail-view').scrollTop = ctx.scrollTop;
  // Фокус — сразу: без него его подхватит запасной путь на первую кнопку, и
  // сцена съедет к ней и обратно
  if (typeof window.invalidateFocusCache === 'function') window.invalidateFocusCache();
  if (ctx.from && ctx.from.offsetParent !== null) focusEl(ctx.from);
}

function torrentFileList(torrent) {
  if (Array.isArray(torrent.file_stats)) return torrent.file_stats;
  if (torrent.data) {
    try { var data = JSON.parse(torrent.data); if (data.TorrServer && data.TorrServer.Files) return data.TorrServer.Files; } catch (e) { }
  }
  return [];
}

/**
 * Та же серия или фильм в другой раздаче на сервере: прежнюю удалили, а сервер
 * TorrStream помнит место просмотра по фильму и серии, а не по раздаче. Раздача
 * опознаётся по id TMDB, серия — по номеру в имени файла, файл фильма — самый большой.
 */
function findSameTitleSource(item, resume) {
  var list = AppState.torrents || [];
  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    var idMatch = String(t.title || '').match(/\[(\d+)\]/);
    var id = t.tmdbId || (idMatch && idMatch[1]);
    if (!id || String(id) !== String(item.id)) continue;
    var files = extractVideoFiles(torrentFileList(t));
    if (item.media_type !== 'tv') {
      var big = null;
      for (var m = 0; m < files.length; m++) if (!big || (files[m].length || 0) > (big.length || 0)) big = files[m];
      if (big) return { torrent: t, files: files, fileId: big.id };
      continue;
    }
    for (var f = 0; resume.episode && f < files.length; f++) {
      var ref = parseEpisodeRef(files[f].path);
      if (ref && ref.episode === resume.episode && (ref.season === null || ref.season === resume.season)) {
        return { torrent: t, files: files, fileId: files[f].id };
      }
    }
  }
  return null;
}

/**
 * Откуда играть запись истории: её раздача, а если TorrServer её забыл — она
 * же, возвращённая сохранённым magnet (magnet-store.js), иначе та же серия или
 * фильм в другой раздаче. Раньше забытая раздача сразу давала 'missing', до
 * возврата magnet в startHLSPlayback дело не доходило.
 * @returns {Promise<?Object>} {torrent, files, fileId}; null — играть нечего
 */
async function findResumeSource(item, resume) {
  var hash = String(resume.hash).toLowerCase();
  var pick = function (torrent) {
    var files = torrent ? extractVideoFiles(torrentFileList(torrent)) : [];
    for (var i = 0; i < files.length; i++) {
      if (String(files[i].id) === String(resume.fileId)) return { torrent: torrent, files: files, fileId: resume.fileId };
    }
    return null;
  };
  // Раздачу удалили из TorrServer — ждать её незачем: две короткие попытки
  var source = pick(await resolveTorrentWithFiles(hash, 2, 500));
  if (!source && window.MagnetStore && await MagnetStore.ensure(hash)) {
    source = pick(await resolveTorrentWithFiles(hash, 3, 700));
  }
  return source || findSameTitleSource(item, resume);
}

/**
 * Серии раздачи, которую смотрели, — для ленты в карточке сериала.
 * @returns {Promise<?Object>} {hash, files, progress: {fileId: запись},
 *          current: fileId серии, которую запустит «Продолжить»}; null — раздачи
 *          нет или в ней один файл, показывать нечего
 */
async function loadResumeEpisodes(item, resume) {
  var source = await findResumeSource(item, resume);
  if (!source || source.files.length < 2) return null;
  var torrent = source.torrent, files = source.files;
  if (!torrent.tmdbId && item.id) torrent.tmdbId = String(item.id);
  if (!torrent.media_type) torrent.media_type = 'tv';
  await ensureTorrentEpisodeMeta(torrent, files);
  var progress = await getTorrentProgressBatch(torrent.hash, files);
  var current = source.fileId;
  if (isResumeFinished(resume)) {
    for (var i = 0; i + 1 < files.length; i++) {
      if (String(files[i].id) === String(source.fileId)) { current = files[i + 1].id; break; }
    }
  }
  return { hash: torrent.hash, files: files, progress: progress.byFileId, current: current };
}
window.loadResumeEpisodes = loadResumeEpisodes;

// ==================== СЕРИАЛ ИЗ ВЫДАЧИ РАЗДАЧ ====================
// Раздачу сериала выбрали в поиске, открытом из его карточки: сразу в плеер, на
// нужной серии, а не в карточку раздачи. Свободный поиск сюда не ходит — там
// раздачу именно добавляют, и она открывается как в «Моих торрентах».

var seriesStartCancel = null;

/** Сезон и серия файла — те же, что у таймкода (getTimecodeMediaKey) */
function fileEpisodeRef(hash, file, seasons) {
  var meta = window.getTorrentEpisodeMeta(hash, file.id);
  if (meta && meta.episode) return { season: meta.season, episode: meta.episode };
  var ref = parseEpisodeRef(file.path || file.name);
  if (!ref) return null;
  return { season: ref.season !== null ? ref.season : (seasons.length === 1 ? seasons[0] : null), episode: ref.episode };
}

/**
 * Серия, с которой запускать раздачу.
 *  - смотрели в этой же раздаче — её файл, досмотренная — следующий;
 *  - в другой — серия из таймкода по номеру. Досмотрена — ближайшая после неё,
 *    такой же ближайшей заменяем и серию, которой в этой раздаче нет;
 *  - не смотрели — первая.
 * @param {Array} files видеофайлы раздачи в порядке серий
 * @returns {?Object} {index, seek}; seek null — плеер спросит сервер.
 *          null — запускать нечего: новых серий нет или место неизвестно
 */
function pickSeriesEpisode(torrent, files, resume) {
  if (!resume) return { index: 0, seek: null };
  var hash = String(torrent.hash).toLowerCase();
  var finished = isResumeFinished(resume);
  var seek = Math.floor(resume.timecode) || 0;
  if (String(resume.hash).toLowerCase() === hash) {
    for (var i = 0; i < files.length; i++) {
      if (String(files[i].id) !== String(resume.fileId)) continue;
      if (!finished) return { index: i, seek: seek };
      return i + 1 < files.length ? { index: i + 1, seek: null } : null;
    }
  }
  if (!resume.episode) return null;
  var season = resume.season || 0, seasons = getTorrentSeasons(torrent);
  var best = -1, bestSeason = 0, bestEpisode = 0;
  for (var f = 0; f < files.length; f++) {
    var ref = fileEpisodeRef(hash, files[f], seasons);
    if (!ref) continue;
    var s = ref.season === null ? season : ref.season, e = ref.episode;
    var after = s > season || (s === season && e > resume.episode);
    var same = s === season && e === resume.episode;
    if (!after && !(same && !finished)) continue;
    if (best === -1 || s < bestSeason || (s === bestSeason && e < bestEpisode)) { best = f; bestSeason = s; bestEpisode = e; }
  }
  if (best === -1) return null;
  return { index: best, seek: bestSeason === season && bestEpisode === resume.episode ? seek : null };
}

/**
 * Сезон выбран явно (список «Лучшие»): серия берётся внутри него.
 *
 * Место просмотра годится, только если оно в этом сезоне. Иначе — первая серия
 * сезона: человек ушёл дальше или досмотрел его и пришёл пересмотреть.
 * pickSeriesEpisode таких серий «после места просмотра» не находит. seek 0, а не
 * null: на null плеер спросит сервер и включит досмотренную серию с конца.
 *
 * Раздача одного сезона — вся в нём, какой бы номер ни стоял в именах файлов: у
 * аниме «ТВ-3» файлы нередко S01. Сверяем номера только в сборнике.
 *
 * @param {?Object} start ответ pickSeriesEpisode
 * @returns {Object} {index, seek}
 */
function pickSeasonEpisode(torrent, files, start, season) {
  var hash = String(torrent.hash).toLowerCase(), seasons = getTorrentSeasons(torrent);
  var refs = [], seen = {}, many = false, first = -1, firstEpisode = 0, i;
  for (i = 0; i < files.length; i++) {
    refs[i] = fileEpisodeRef(hash, files[i], seasons);
    if (refs[i] && refs[i].season !== null) seen[refs[i].season] = true;
  }
  many = Object.keys(seen).length > 1;
  if (!many) return start || { index: 0, seek: 0 };
  if (start && refs[start.index] && refs[start.index].season === season) return start;
  for (i = 0; i < files.length; i++) {
    if (!refs[i] || refs[i].season !== season) continue;
    if (first === -1 || refs[i].episode < firstEpisode) { first = i; firstEpisode = refs[i].episode; }
  }
  return { index: first === -1 ? 0 : first, seek: 0 };
}

/**
 * Откуда запускать выбранную раздачу сериала.
 * @param {Object} torrent раздача, уже добавленная в TorrServer
 * @param {Object} item    карточка сериала (id)
 * @returns {Promise<?Object|string>} {fileId, index, seek}; null — открыть
 *          карточку раздачи; 'cancelled' — ждать файлы передумали («Назад»)
 */
async function findSeriesStart(torrent, item) {
  // Файлы ждём с повторами, как у списка «Лучшие» (waitSeasonFiles). Раньше
  // был один запрос на 15 с: у свежей раздачи (вышла новая серия, пиров пока
  // мало) метаданные не успевали, и вместо плеера открывалась карточка
  // раздачи, будто серию не нашли. «Назад» — отмена.
  var cancelled = false;
  var onCancel = new Promise(function (resolve) { seriesStartCancel = function () { cancelled = true; resolve('cancelled'); }; });
  var files = await Promise.race([waitSeasonFiles(torrent, function () { return cancelled; }), onCancel]);
  seriesStartCancel = null;
  if (files === 'cancelled') return files;
  if (!files.length) return null;
  var resume = window.HomeScreen ? await HomeScreen.fetchResume({ id: item.id, media_type: 'tv' }) : null;
  // Имена файлов не у всех раздач с номером: тогда серию знает только TMDB
  if (resume) {
    await Promise.race([
      window.ensureTorrentEpisodeMeta(torrent, files),
      new Promise(function (resolve) { setTimeout(resolve, ANDROID_EPISODE_META_WAIT_MS); })
    ]);
  }
  var start = pickSeriesEpisode(torrent, files, resume);
  return start ? { fileId: files[start.index].id, index: start.index, seek: start.seek } : null;
}
window.findSeriesStart = findSeriesStart;

// Сколько ждём файлы раздачи сериала (список «Лучшие», раздача из поиска в
// карточке сериала). Столько же ждёт метаданные и MonoServer; «Назад» — отмена
var SEASON_FILES_WAIT_MS = 60000;
var SEASON_FILES_RETRY_MS = 1500;

function pauseMs(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

/** Ответ TorrServer без файлов — ещё не приговор: метаданные могли не дойти */
async function waitSeasonFiles(torrent, isCancelled) {
  var deadline = Date.now() + SEASON_FILES_WAIT_MS;
  while (!isCancelled() && Date.now() < deadline) {
    var left = deadline - Date.now();
    var list = await Promise.race([
      getTorrentFilesWithCache(torrent, true),
      pauseMs(left).then(function () { return []; })
    ]);
    var files = extractVideoFiles(list || []);
    if (files.length) return files;
    await pauseMs(SEASON_FILES_RETRY_MS);
  }
  return [];
}

function filesHaveEpisodeNumbers(files) {
  for (var i = 0; i < files.length; i++) {
    if (!parseEpisodeRef(files[i].path || files[i].name)) return false;
  }
  return true;
}

/** Файл фильма — самый большой: первым в раздаче бывает и сэмпл */
function biggestFileIndex(files) {
  var best = 0;
  for (var i = 1; i < files.length; i++) if ((files[i].length || 0) > (files[best].length || 0)) best = i;
  return best;
}

/**
 * Название фильма для истории и окна предзагрузки. У элементов категорий
 * (каталоги сервера) нет title/name — название лежит в torrent[0].name, как
 * его и берёт карточка (getCatalogItemTitle). Без него /api/history/add
 * отвечал 400 (title обязателен), сериал в историю не попадал, и после плеера
 * не было ни «Продолжить» в карточке, ни записи в ряду главной.
 */
function bestPickTitle(item) {
  var t = item && (item.title || item.name);
  if (!t && item && item.torrent && item.torrent[0]) t = item.torrent[0].name;
  if (!t) {
    var head = getEl('detail-title-text');
    t = head ? String(head.textContent || '').trim() : '';
  }
  return t || '';
}

/**
 * Запуск из списка «Лучшие» прямо из карточки, как «Продолжить»: поиск не
 * открывается, из плеера возвращаемся в карточку (AppState.cardPlayback).
 *
 * Сразу показываем окно предзагрузки, а раздачу добавляем и файлы ждём уже за ним.
 * Ждать приходится только их: без метаданных торрента неизвестно, какой файл
 * открыть. Зато по пирам в окне видно, живая ли раздача, и «Назад» отменяет запуск.
 * Окно одно на весь запуск: startHLSPlayback продолжает в нём прогрев файла.
 * TMDB спрашиваем, только если в именах файлов нет номеров.
 *
 * @param {Object} item карточка
 * @param {Object} row  строка списка (best-torrents-pick.js)
 * @param {?number} season сезон, на котором выбрали строку; у фильма null
 * @param {Element} from кнопка, к которой вернуть фокус
 * @returns {Promise<string>} 'started' | 'cancelled' | 'dead' — файлов нет |
 *          'failed' — раздача не добавилась | 'offline'
 */
async function playBestPick(item, row, season, from) {
  if (typeof ensureTorrserverOnline === 'function' && !(await ensureTorrserverOnline())) return 'offline';
  var hash = String(row.hash).toLowerCase();
  var serial = item.media_type === 'tv';
  var overlay = getEl('playback-overlay'), overlayText = document.querySelector('.playback-text');
  var withWindow = !!AppState.preloadBeforePlay && typeof runPlaybackPreload === 'function';
  var cancelled = false;
  var onCancel = new Promise(function (resolve) {
    seriesStartCancel = function () { cancelled = true; resolve('cancelled'); };
  });
  if (withWindow) {
    runPlaybackPreload(hash, null, bestPickTitle(item)).then(function (ok) {
      if (ok === false && seriesStartCancel) seriesStartCancel();
    });
  } else {
    overlay.classList.add('active');
    if (overlayText) overlayText.textContent = 'Запуск...';
  }

  try {
    var poster = typeof window.getCatalogKnownPosterUrl === 'function' ? window.getCatalogKnownPosterUrl(item, null) : null;
    var resumeRead = serial && window.HomeScreen
      ? Promise.resolve(HomeScreen.fetchResume({ id: item.id, media_type: 'tv' }))['catch'](function () { return null; })
      : Promise.resolve(null);
    var adding = window.addBestPickToServer(item, row, poster);
    // Отменили, пока раздача добавлялась: окно её уже останавливало, но тогда её
    // на сервере ещё не было
    adding.then(function () {
      if (cancelled && typeof dropTorrentToServer === 'function') dropTorrentToServer(hash)['catch'](function () { });
    }, function () { });

    var torrent = await Promise.race([adding, onCancel]);
    if (torrent === 'cancelled') return torrent;
    if (!torrent) {
      if (withWindow) endPlaybackPreloadWait();
      return 'failed';
    }
    var files = await Promise.race([waitSeasonFiles(torrent, function () { return cancelled; }), onCancel]);
    if (files === 'cancelled') return files;
    if (!files.length) {
      seriesStartCancel = null;
      if (withWindow) endPlaybackPreloadWait();
      else if (typeof dropTorrentToServer === 'function') dropTorrentToServer(hash)['catch'](function () { });
      return 'dead';
    }

    var start = { index: biggestFileIndex(files), seek: null };
    if (serial) {
      var resume = await Promise.race([resumeRead, onCancel]);
      if (resume === 'cancelled') return resume;
      if (!filesHaveEpisodeNumbers(files)) {
        await Promise.race([window.ensureTorrentEpisodeMeta(torrent, files), pauseMs(ANDROID_EPISODE_META_WAIT_MS), onCancel]);
        if (cancelled) return 'cancelled';
      }
      start = pickSeasonEpisode(torrent, files, pickSeriesEpisode(torrent, files, resume), season);
    }

    seriesStartCancel = null;
    overlay.classList.remove('active');
    if (window.addToWatchHistory) {
      Promise.resolve(window.addToWatchHistory(String(item.id), bestPickTitle(item), item.media_type, poster))['catch'](function () { });
    }
    var started = await playOpenedTorrent(item, torrent, files, start.index, start.seek, from);
    // Плеер упал раньше предзагрузки — окно ожидания само не закроется
    if (withWindow) endPlaybackPreloadWait();
    return started === false ? 'cancelled' : 'started';
  } finally {
    seriesStartCancel = null;
    overlay.classList.remove('active');
    if (overlayText) overlayText.textContent = 'Воспроизведение...';
  }
}
window.playBestPick = playBestPick;

/**
 * Запустить раздачу так, чтобы плеер считал её открытой, а вернуться — на главную
 * или в карточку. Общая часть «Продолжить» и списка «Лучшие».
 * @param {Element} [from] запуск из карточки — элемент под фокусом
 * @returns {Promise<boolean|undefined>} false — плеер не поднялся
 */
async function playOpenedTorrent(item, torrent, videoFiles, idx, seek, from) {
  var hash = String(torrent.hash).toLowerCase();
  // Раздача становится «открытой»: плеер берёт из неё серии, заголовок и тип
  if (!torrent.tmdbId && item.id) torrent.tmdbId = String(item.id);
  if (!torrent.media_type && item.media_type) torrent.media_type = item.media_type;
  if (typeof knownTorrentMeta !== 'undefined' && knownTorrentMeta && item.id) {
    var known = knownTorrentMeta.get(hash) || {};
    knownTorrentMeta.set(hash, {
      id: known.id || String(item.id), mediaType: known.mediaType || item.media_type,
      poster: known.poster || torrent.poster || null, title: known.title || torrent.title
    });
  }
  var fromCard = !!from;
  AppState.cardPlayback = fromCard ? { item: item, from: from, scrollTop: getEl('detail-view').scrollTop } : null;
  AppState.currentDetailItem = torrent;
  AppState.androidBackCatalog = item;
  AppState.isCatalogSerials = false;
  // Нативный плеер Android: по возврату не открывать карточку раздачи
  // (updatePlayerTimeline), экран под плеером — главная
  if (window.AndroidJS) AppState.playFromHash = true;

  var playUrl = AppState.currentTorrserverUrl + '/play/' + hash + '/' + videoFiles[idx].id;
  var overlay = getEl('playback-overlay');
  if (overlay) overlay.classList.remove('active');
  resumingFromHome = true;
  var started;
  try { started = await startHLSPlayback(playUrl, seek, false, idx); }
  finally { resumingFromHome = false; }
  if (window.AndroidJS) AppState.currentScreen = fromCard ? 'detail' : 'home';
  if (started === false && fromCard) {
    // Плеер не поднялся — карточка на месте, раздача ей больше не нужна
    AppState.cardPlayback = null;
    AppState.currentDetailItem = item;
  }
  return started;
}

/**
 * Продолжить просмотр записи истории.
 * @param {Object} item   элемент ряда главной (id, media_type, title, poster_path)
 * @param {Object} resume {hash, fileId, timecode, duration, season?, episode?}
 * @param {Object} [opts] card — запуск из карточки фильма, значение — элемент
 *          под фокусом: по выходу из плеера вернуться к нему, а не на главную
 * @returns {Promise<string>} 'started' — ушли в плеер; 'missing' — раздачи
 *          (или файла) нет в TorrServer, пусть вызывающий откроет карточку;
 *          'last' — досмотрена последняя серия раздачи, следующей нет;
 *          'offline' — TorrServer недоступен (баннер уже показан)
 */
async function resumeWatching(item, resume, opts) {
  if (!resume || !resume.hash) return 'missing';
  if (typeof ensureTorrserverOnline === 'function' && !(await ensureTorrserverOnline())) return 'offline';
  var overlay = getEl('playback-overlay');
  if (overlay) overlay.classList.add('active');
  try {
    var source = await findResumeSource(item, resume);
    if (!source) return 'missing';
    var torrent = source.torrent, videoFiles = source.files;
    var hash = String(torrent.hash).toLowerCase();
    var idx = -1;
    for (var i = 0; i < videoFiles.length; i++) {
      if (String(videoFiles[i].id) === String(source.fileId)) { idx = i; break; }
    }
    if (idx === -1) return 'missing';
    // Досмотренная серия — следующая, со своего места (null: плеер спросит
    // сервер); досмотренного фильма здесь не бывает — баннер такой не предлагает
    var seek = Math.floor(resume.timecode) || 0;
    if (isResumeFinished(resume)) {
      if (item.media_type !== 'tv' || idx + 1 >= videoFiles.length) return 'last';
      idx++;
      seek = null;
    }

    var started = await playOpenedTorrent(item, torrent, videoFiles, idx, seek, opts && opts.card);
    return started === false ? 'missing' : 'started';
  } finally {
    if (overlay) overlay.classList.remove('active');
  }
}
window.resumeWatching = resumeWatching;

// ==================== ВНЕШНИЕ ПЛЕЕРЫ НА УСТРОЙСТВАХ APPLE ====================
// Выбор — Настройки → Плеер (app.js: setupApplePlayerChoice), список и URL-схемы —
// как у Lampa (src/interaction/player.js, settings/params.js). Плееру уходит прямая
// ссылка на файл в TorrServer, как и встроенному плееру Android. В шаблонах
// ${url} — ссылка в encodeURIComponent, ${furl} — как есть, ${_url} — encodeURI,
// ${playlist} — серии JSON-ом в encodeURIComponent.
// tvOS Pro / Universal / Online и «Внешний» — плееры самого клиента для Apple TV
// (схема lampa://, в нём TorrStream и открыт), остальные — отдельные приложения.
var APPLE_PLAYERS = {
  apple_tv: [
    ['inner', 'Встроенный TorrStream'],
    ['tvospro', 'tvOS Pro', 'lampa://video?player=tvospro&src=${url}&playlist=${playlist}'],
    ['tvos', 'tvOS Universal', 'lampa://video?player=tvos&src=${url}&playlist=${playlist}'],
    ['tvosl', 'tvOS Online', 'lampa://video?player=tvosav&src=${url}&playlist=${playlist}'],
    ['tvosSelect', 'Внешний — выбор при запуске', 'lampa://video?player=lists&src=${url}&playlist=${playlist}'],
    ['vlc', 'VLC', 'vlc-x-callback://x-callback-url/stream?url=${url}'],
    ['infuse', 'Infuse', 'infuse://x-callback-url/play?x-success=lampa://infuseDidFinish&x-error=lampa://infuseDidFail&url=${url}&playlist=${playlist}'],
    ['senplayer', 'SenPlayer', 'SenPlayer://x-callback-url/play?url=${url}'],
    ['vidhub', 'Vidhub', 'open-vidhub://x-callback-url/open?url=${url}'],
    ['svplayer', 'SVPlayer', 'svplayer://x-callback-url/stream?url=${url}']
  ],
  apple: [
    ['inner', 'Встроенный TorrStream'],
    ['vlc', 'VLC', 'vlc://${furl}'],
    ['nplayer', 'nPlayer', 'nplayer-${furl}'],
    ['infuse', 'Infuse', 'infuse://x-callback-url/play?url=${url}'],
    ['senplayer', 'SenPlayer', 'senplayer://x-callback-url/play?url=${url}'],
    ['vidhub', 'Vidhub', 'open-vidhub://x-callback-url/open?&url=${url}'],
    ['svplayer', 'SVPlayer', 'svplayer://x-callback-url/stream?url=${url}'],
    ['tracyplayer', 'TracyPlayer', 'tracy://open?url=${url}']
  ],
  macos: [
    ['inner', 'Встроенный TorrStream'],
    ['mpv', 'mpv', 'mpv://${_url}'],
    ['iina', 'IINA', 'iina://weblink?url=${url}'],
    ['nplayer', 'nPlayer', 'nplayer-${_url}'],
    ['infuse', 'Infuse', 'infuse://x-callback-url/play?url=${url}'],
    ['senplayer', 'SenPlayer', 'senplayer://x-callback-url/play?url=${url}']
  ]
};
var APPLE_PLAYER_KEY = 'applePlayer';

/** Плееры этого устройства Apple: [{id, name, template}] или null — не Apple */
function getApplePlayers() {
  var list = AppState.applePlatform && APPLE_PLAYERS[AppState.applePlatform];
  if (!list) return null;
  return list.map(function (p) { return { id: p[0], name: p[1], template: p[2] || null }; });
}
window.getApplePlayers = getApplePlayers;

/** Выбранный плеер (объект из getApplePlayers) или null — играет встроенный */
function getApplePlayer() {
  var list = getApplePlayers();
  if (!list) return null;
  var id = null;
  try { id = localStorage.getItem(APPLE_PLAYER_KEY); } catch (e) { }
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return list[0];
}
window.getApplePlayer = getApplePlayer;

function setApplePlayer(id) {
  try { localStorage.setItem(APPLE_PLAYER_KEY, id); } catch (e) { }
}
window.setApplePlayer = setApplePlayer;

/**
 * Прямая ссылка на файл в TorrServer. Логин и пароль TorrServer — в самой ссылке:
 * заголовков чужому плееру не передать (так же уходит ссылка в ffprobe на webOS)
 */
function appleStreamUrl(hash, fileId) {
  var u = AppState.currentTorrserverUrl + '/stream?link=' + hash + '&index=' + fileId + '&play=play';
  if (AppState.authEnabled && AppState.authLogin) {
    u = u.replace(/^(https?:\/\/)/, '$1' + encodeURIComponent(AppState.authLogin) + ':' + encodeURIComponent(AppState.authPassword || '') + '@');
  }
  return u;
}

/**
 * Ссылка для внешнего плеера Apple: URL-схема выбранного плеера с прямой ссылкой
 * на файл и, для сериала, списком серий. null — выбран встроенный или ссылка не
 * разобралась.
 */
function buildAppleExternalUrl(originalUrl, seekTime) {
  var player = getApplePlayer();
  if (!player || !player.template || !AppState.currentTorrserverUrl) return null;
  var ref = parseStreamRef(originalUrl);
  if (!ref) return null;
  var furl = appleStreamUrl(ref.hash, ref.fileId);
  var playlist = '';
  if (AppState.autoSwitchEpisodes) {
    var episodes = buildEpisodesPlaylist(currentEpisodeIndex, seekTime || 0);
    if (episodes) {
      episodes.forEach(function (e) {
        var m = /[?&]index=(\d+)/.exec(e.url);
        if (m) e.url = appleStreamUrl(ref.hash, m[1]);
      });
      playlist = encodeURIComponent(JSON.stringify(episodes));
    }
  }
  return {
    player: player,
    ref: ref,
    url: player.template
      .replace('${url}', encodeURIComponent(furl))
      .replace('${_url}', encodeURI(furl))
      .replace('${furl}', furl)
      .replace('${playlist}', playlist)
  };
}
window.buildAppleExternalUrl = buildAppleExternalUrl;

/**
 * Открыть файл во внешнем плеере Apple по URL-схеме. false — выбран встроенный
 * (или ссылка не разобралась): тогда играет веб-плеер, как раньше.
 * Позицию просмотра чужой плеер обратно не сообщает — как и у Lampa.
 */
function openAppleExternalPlayer(originalUrl, title, seekTime) {
  var built = buildAppleExternalUrl(originalUrl, seekTime);
  if (!built) return false;
  if (lastExternalOpen.url === built.url && Date.now() - lastExternalOpen.time < EXTERNAL_OPEN_DEDUP_MS) return true;
  lastExternalOpen.url = built.url; lastExternalOpen.time = Date.now();
  currentTimecodeData.hash = built.ref.hash; currentTimecodeData.fileId = built.ref.fileId; currentTimecodeData.timecode = seekTime || 0;
  console.log('🍎 Внешний плеер ' + built.player.name + ': ' + (title || ''));
  if (AppState.applePlatform !== 'apple_tv' && navigator.userActivation && !navigator.userActivation.isActive) {
    // Нажатие уже «остыло» — переход заведомо пропустят, сразу кнопка
    showAppleLaunchDialog(built.player.name, built.url);
    return true;
  }
  window.location.assign(built.url);
  if (AppState.applePlatform !== 'apple_tv') watchAppleLaunch(built.player.name, built.url);
  return true;
}

/**
 * Safari и оболочки на WebKit (iPhone, iPad, Mac; проверено в Prisma TV на
 * iPhone) открывают чужое приложение по URL-схеме только в ответ на нажатие.
 * Запуск же идёт после предзагрузки, серий и позиции просмотра — через
 * секунды после нажатия, и такой переход молча пропускают: плеер не
 * открывается. Поэтому показываем кнопку-ссылку «Открыть в …» — переход по
 * ней уже по нажатию: сразу, если браузер сообщает, что нажатие истекло
 * (navigator.userActivation), иначе — если за APPLE_LAUNCH_CHECK_MS
 * страница не ушла на задний план (плеер не открылся поверх).
 * На Apple TV оболочка открывает плееры сама, там кнопка не нужна.
 */
var APPLE_LAUNCH_CHECK_MS = 2000;

function watchAppleLaunch(name, url) {
  var left = false;
  var onHide = function (e) { if (e.type === 'pagehide' || document.hidden) left = true; };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);
  setTimeout(function () {
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onHide);
    if (!left && !document.hidden) showAppleLaunchDialog(name, url);
  }, APPLE_LAUNCH_CHECK_MS);
}

function closeAppleLaunchDialog() {
  var el = document.getElementById('apple-launch-dialog');
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

function showAppleLaunchDialog(name, url) {
  closeAppleLaunchDialog();
  if (typeof releasePreloadScreen === 'function') releasePreloadScreen(true);
  var root = document.createElement('div');
  root.id = 'apple-launch-dialog';
  root.innerHTML =
    '<div class="apple-launch-box">' +
    '<div class="apple-launch-title"></div>' +
    '<div class="apple-launch-text">Плеер не открылся сам. Нажмите кнопку — если он установлен, откроется.</div>' +
    '<div class="apple-launch-actions">' +
    '<a class="apple-launch-btn apple-launch-open"></a>' +
    '<button type="button" class="apple-launch-btn apple-launch-cancel">Отмена</button>' +
    '</div></div>';
  root.querySelector('.apple-launch-title').textContent = name;
  var open = root.querySelector('.apple-launch-open');
  open.textContent = 'Открыть в ' + name;
  open.href = url;
  open.addEventListener('click', function () { setTimeout(closeAppleLaunchDialog, 300); });
  root.querySelector('.apple-launch-cancel').addEventListener('click', closeAppleLaunchDialog);
  root.addEventListener('click', function (e) { if (e.target === root) closeAppleLaunchDialog(); });
  document.body.appendChild(root);
  try { open.focus(); } catch (e) { }
}

function startGstPlayback(m3u8Url) {
  var videoPlayer = getEl('video-player');
  if (!videoPlayer) return false;
  if (Hls.isSupported()) {
    AppState.hls = createHlsInstance({
      maxBufferSize: 80 * 1024 * 1024, maxBufferLength: 30, backBufferLength: 20, startLevel: -1,
      abrEwmaDefaultEstimate: 500000, fragLoadingTimeOut: 10000, manifestLoadingTimeOut: 10000, enableWorker: true, progressive: true
    });
    AppState.hls.loadSource(m3u8Url); AppState.hls.attachMedia(videoPlayer);
    return true;
  }
  return false;
}

function createHlsInstance(configOverrides) {
  var defaultConfig = {
    enableABR: false, startLevel: 0, maxBufferLength: 15, maxMaxBufferLength: 25, startFragPrefetch: true,
    fragLoadingTimeOut: 15000, manifestLoadingTimeOut: 10000, enableWorker: true, progressive: true,
    maxBufferSize: 60 * 1000 * 1000, maxBufferHole: 0.5
  };
  // Без явного preferHDR hls.js решает по matchMedia('(dynamic-range: high)'),
  // а на телевизорах это часто false даже при HDR/DV-панели
  if (AppState.dvPreferred) defaultConfig.videoPreference = { preferHDR: true };
  return new Hls(Object.assign({}, defaultConfig, configOverrides || {}));
}

function resetPlaybackState() {
  cancelCurrentPlayback();
  destroyHls();
  var videoPlayer = getEl('video-player');
  if (videoPlayer) videoPlayer.removeEventListener('ended', handleVideoEnded);
}

/**
 * Как выглядел экран до входа в плеер — чтобы вернуть его, если плеер не
 * поднялся.
 *
 * transitionToPlayerScreen гасит карточку и секцию TorrServer безусловно, и
 * при отказе воспроизведения человек оставался на чёрном #player-screen: alert
 * («Ошибка воспроизведения: … duration») на телевизоре не виден, а под ним
 * ничего нет. Возвращаем ровно то, что было, вместо showDetailView(): тот
 * попутно сохраняет таймкод и дропает раздачу с сервера, а мы ничего и не
 * начинали.
 */
function capturePreplaybackScreen() {
  var dv = getEl('detail-view'), ts = getEl('torrserver-section'), cs = getEl('config-screen');
  return {
    screen: AppState.currentScreen,
    detail: dv ? dv.style.display : null,
    torrserver: ts ? ts.style.display : null,
    config: cs ? cs.style.display : null
  };
}

function restorePreplaybackScreen(snapshot) {
  if (!snapshot) return;
  var ps = getEl('player-screen');
  if (ps) ps.style.display = 'none';
  var dv = getEl('detail-view'), ts = getEl('torrserver-section'), cs = getEl('config-screen');
  if (dv && snapshot.detail !== null) dv.style.display = snapshot.detail;
  if (ts && snapshot.torrserver !== null) ts.style.display = snapshot.torrserver;
  if (cs && snapshot.config !== null) cs.style.display = snapshot.config;
  // Тик буфера отдельно гасить не надо: цепочка в app.js обрывается сама,
  // как только currentScreen перестал быть 'player'
  AppState.currentScreen = snapshot.screen;
  hidePlayerLoading();
  // Фокус ушёл в плеер вместе с clearFocused() — без возврата пульт мёртв
  setTimeout(function () {
    if (typeof updateFocusableElements === 'function') updateFocusableElements();
    if (typeof setFocus === 'function' && typeof focusableElements !== 'undefined' && focusableElements.length) setFocus(0);
  }, 80);
}

function transitionToPlayerScreen() {
  if (window.Nav) Nav.push('player', { key: 'player' });
  AppState.currentScreen = 'player';
  // Тик буфера и проверки «Пропустить» заводится вместе с плеером и гаснет сам,
  // когда экран сменится (app.js)
  if (typeof window.startBufferUpdates === 'function') window.startBufferUpdates();
  getEl('config-screen').style.display = 'none';
  getEl('torrserver-section').style.display = 'none';
  getEl('detail-view').style.display = 'none';
  // Уходим в плеер мгновенно: затухание карточки тут не нужно, но недоигранный
  // индикатор «Загрузка…» гасим, чтобы он не всплыл при возврате
  if (typeof Animations !== 'undefined' && typeof Animations.hideDetailLoading === 'function') Animations.hideDetailLoading(true);
  getEl('player-screen').style.display = 'block';
  clearFocused();
  // Часы тикают раз в минуту от загрузки страницы: без этого при входе в плеер
  // они могли показывать время почти минутной давности
  if (typeof updateClock === 'function') updateClock();
  var controlsContainer = getEl('controls-container');
  if (controlsContainer) controlsContainer.classList.add('idle-hidden');
  if (typeof currentFocusIndex !== 'undefined') currentFocusIndex = 0;
  if (typeof updateFocusableElements === 'function') updateFocusableElements();
}

var DEFAULT_PLAYER_HINT = '← Назад для выхода';

/**
 * Подсказка внизу экрана. Аргумент нужен control.js: по первому Back он
 * показывает «Нажмите Back ещё раз для выхода». Раньше текст игнорировался,
 * и вместо предупреждения всплывала обычная подсказка.
 */
function showPlayerHint(message, durationMs) {
  var playerHint = getEl('player-hint');
  if (!playerHint) return;
  playerHint.textContent = message || DEFAULT_PLAYER_HINT;
  playerHint.style.opacity = '1';
  // Предупреждение показываем и при скрытом HUD (styles.css:
  // .player-hint-alert): «Нажмите Назад ещё раз» приходит именно тогда
  playerHint.classList.toggle('player-hint-alert', !!message);
  if (AppState.hintTimeout) clearTimeout(AppState.hintTimeout);
  AppState.hintTimeout = setTimeout(function () {
    playerHint.style.opacity = '0';
    playerHint.classList.remove('player-hint-alert');
    playerHint.textContent = DEFAULT_PLAYER_HINT;
  }, durationMs || 4000);
}

async function preparePlaybackMetadata(originalUrl, initialSeek, audioTrack, signal) {
  var match = originalUrl.match(/\/play\/([a-fA-F0-9]+)\/(\d+)\/?/);
  if (!match) {
    console.error('❌ Некорректный URL для воспроизведения:', originalUrl);
    // alert на телевизоре не показывается — только баннер
    if (typeof window.showErrorBanner === 'function') {
      window.showErrorBanner('Не удалось начать воспроизведение', 'Некорректная ссылка на видео');
    } else alert('Ошибка: Некорректная ссылка на видео');
    return null;
  }
  currentTimecodeData.hash = match[1]; currentTimecodeData.fileId = match[2]; currentTimecodeData.timecode = 0;
  noteCollectionPlayback(currentTimecodeData.hash, currentTimecodeData.fileId);
  // if (AppState.transcodingFullOnOff) {
  //   return true;
  // }
  // Позицию спрашиваем, только если её не передали явно (initialSeek === null)
  var wantTimecode = initialSeek === null;
  var requests = [
    loadPlaybackPrepare(currentTimecodeData.hash, currentTimecodeData.fileId, wantTimecode),
    getFileNameByHash(currentTimecodeData.hash, currentTimecodeData.fileId)
  ];
  if (initialSeek === null || initialSeek === 0) preloadTorrents(currentTimecodeData.hash, currentTimecodeData.fileId);
  var promiseResults = await Promise.all(requests);
  if (signal.aborted) return null;
  var prepared = promiseResults[0]; var fileName = promiseResults[1];
  var fileInfo = prepared.fileInfo;
  var savedAudioTrack = prepared.audioTrack;
  var savedSubTrack = prepared.subtitleTrack;
  var savedTimecode = prepared.timecode || null;
  // Прямой файл берёт отсюда названия дорожек, если ffprobe не ответит (directProbeStart)
  directProbe.serverInfo = fileInfo ? { hash: currentTimecodeData.hash, fileId: currentTimecodeData.fileId, info: fileInfo } : null;
  if (fileInfo && fileInfo.audio) { currentAudioTracks = fileInfo.audio; currentAudioTrack = audioTrack !== null ? audioTrack : 0; }
  if (fileInfo && fileInfo.subtitles) currentSubTracks = fileInfo.subtitles;
  if (savedAudioTrack !== null && savedAudioTrack < currentAudioTracks.length) {
    currentAudioTrack = savedAudioTrack;
    if (audioTrack !== savedAudioTrack) audioTrack = savedAudioTrack;
  } else currentAudioTrack = audioTrack !== null ? audioTrack : 0;
  if (savedSubTrack !== null && savedSubTrack < currentSubTracks.length) currentSubtitleTrack = savedSubTrack;
  var seekTime = initialSeek;
  if (seekTime === null && wantTimecode) seekTime = savedTimecode > 0 ? savedTimecode : 0;
  return { match: match, fileInfo: fileInfo, savedAudioTrack: savedAudioTrack, fileName: fileName, savedSubTrack: savedSubTrack, savedTimecode: savedTimecode, seekTime: seekTime, audioTrack: audioTrack };
}

async function initGstPlayback(metadata, initialSeek, signal) {
  var playURL = AppState.currentTorrserverUrl + "/gst/" + currentTimecodeData.hash + "/master.m3u8?index=" + currentTimecodeData.fileId + "&audio=" + currentAudioTrack;
  var videoPlayer = getEl('video-player');
  destroyHls();
  var isTimeUpdated = false; var seekExecuted = false;
  var executeSeek = function () {
    if (seekExecuted) return;
    if (initialSeek > 0) {
      seekExecuted = true;
      try { var relativeTime = initialSeek - (AppState.seekOffset || 0); if (relativeTime > 0) videoPlayer.currentTime = parseInt(relativeTime); } catch (e) { }
      setTimeout(function () { seekStream(parseInt(initialSeek - (AppState.seekOffset || 0)), 'slider'); }, 800);
      setTimeout(function () { if (Math.abs(videoPlayer.currentTime + (AppState.seekOffset || 0) - initialSeek) > 2) seekStream(parseInt(initialSeek - (AppState.seekOffset || 0)), 'slider'); }, 2000);
    }
  };
  var timeUpdateHandler = function () {
    if (!isTimeUpdated && videoPlayer.currentTime > 0) { isTimeUpdated = true; hidePlayerLoading(); executeSeek(); videoPlayer.removeEventListener('timeupdate', timeUpdateHandler); }
  };
  videoPlayer.addEventListener('timeupdate', timeUpdateHandler);
  var canPlayHandler = function () {
    if (!isTimeUpdated && initialSeek > 0 && !seekExecuted) {
      try { var relativeTime = initialSeek - (AppState.seekOffset || 0); if (relativeTime > 0) videoPlayer.currentTime = parseInt(relativeTime); } catch (e) { }
      setTimeout(function () { if (!seekExecuted) { seekExecuted = true; seekStream(parseInt(initialSeek - (AppState.seekOffset || 0)), 'slider'); } }, 300);
    }
  };
  videoPlayer.addEventListener('canplay', canPlayHandler);
  AppState._loadingTimeout = setTimeout(function () {
    if (!isTimeUpdated) {
      hidePlayerLoading();
      if (initialSeek > 0 && !seekExecuted) {
        seekExecuted = true;
        try { var relativeTime = initialSeek - (AppState.seekOffset || 0); if (relativeTime > 0) videoPlayer.currentTime = parseInt(relativeTime); } catch (e) { }
        setTimeout(function () { seekStream(parseInt(initialSeek - (AppState.seekOffset || 0)), 'slider'); }, 500);
      }
      videoPlayer.removeEventListener('timeupdate', timeUpdateHandler); videoPlayer.removeEventListener('canplay', canPlayHandler);
    }
  }, LOADING_TIMEOUT_MS);
  if (Hls.isSupported()) {
    AppState.hls = createHlsInstance({ maxBufferLength: 20, maxMaxBufferLength: 40, startFragPrefetch: false, fragLoadingTimeOut: 20000, manifestLoadingTimeOut: 20000, enableWorker: false, cache: true });
    AppState.hls.loadSource(playURL); AppState.hls.attachMedia(videoPlayer);
    var manifestHandler = function () {
      videoPlayer.play()['catch'](function (err) { videoPlayer.muted = true; videoPlayer.play()['catch'](function () { }); restoreSoundOnGesture(); });
      startTimecodeSaving(); resetMouseIdleTimer(); startNearEndCheck(); startHeartbeat(); startTorrentStatsUpdates();
      AppState.hls.off(Hls.Events.MANIFEST_PARSED, manifestHandler);
    };
    AppState.hls.on(Hls.Events.MANIFEST_PARSED, manifestHandler);
    var gstNetworkRetries = 0;
    AppState.hls.on(Hls.Events.ERROR, function (event, data) {
      if (data.fatal) {
        hidePlayerLoading(); videoPlayer.removeEventListener('timeupdate', timeUpdateHandler); videoPlayer.removeEventListener('canplay', canPlayHandler);
        clearTimeout(AppState._loadingTimeout);
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          // Раньше здесь был безусловный startLoad(): с лежащим TorrServer он
          // переподключался бесконечно, молча, и человек сидел перед чёрным
          // экраном без единого сообщения
          if (signal.aborted) return;
          if (++gstNetworkRetries > MAX_HLS_NETWORK_RETRIES) {
            showPlaybackUnavailableBanner('gst: сеть не отвечает после ' + MAX_HLS_NETWORK_RETRIES + ' попыток');
            if (typeof showDetailView === 'function') showDetailView();
            return;
          }
          showPlayerLoading('Обрыв связи, попытка ' + gstNetworkRetries + ' из ' + MAX_HLS_NETWORK_RETRIES + '...', null);
          AppState.hls.startLoad();
        }
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) AppState.hls.recoverMediaError();
      }
    });
    AppState._timeUpdateHandler = timeUpdateHandler; AppState._canPlayHandler = canPlayHandler; AppState._seekExecuted = seekExecuted;
    showPlayerLoading('Подготовка потока...', null);
  } else throw new Error('Устройство не поддерживает HLS');
}

/**
 * Сведения о последнем запуске прямого файла — для «Об устройстве»: на
 * телевизоре без отладчика иначе не понять, отдал ли он дорожки вовсе
 */
var directPlaybackDiag = { file: '', audio: null, text: null, kinds: '', probe: '', subs: '', local: '' };
window.directPlaybackDiag = directPlaybackDiag;

function updateDirectTrackDiag(videoPlayer) {
  var a = videoPlayer && videoPlayer.audioTracks, t = videoPlayer && videoPlayer.textTracks;
  directPlaybackDiag.audio = a ? a.length : 'нет audioTracks';
  directPlaybackDiag.text = t ? t.length : 'нет textTracks';
  var kinds = [];
  if (t) for (var i = 0; i < t.length; i++) kinds.push((t[i].kind || '?') + (t[i].language ? '/' + t[i].language : ''));
  directPlaybackDiag.kinds = kinds.join(', ');
}

async function initTranscodingOffPlayback(initialSeek, signal, knownFileName) {
  // Адрес как у Lampa (Torserver.stream): с именем файла в пути, если оно уже
  // известно (getFileNameByHash по списку торрентов). Отдельно у TorrServer его
  // не спрашиваем: Vidaa отдаёт встроенные субтитры и по адресу без имени
  // (проверено), а лишний запрос задерживал запуск
  var fileName = knownFileName || null;
  var playURL = AppState.currentTorrserverUrl + '/stream' + (fileName ? '/' + encodeURIComponent(fileName) : '') +
    '?link=' + currentTimecodeData.hash + '&index=' + currentTimecodeData.fileId + '&play';
  directPlaybackDiag.file = fileName || 'без имени';
  directPlaybackDiag.audio = null; directPlaybackDiag.text = null; directPlaybackDiag.kinds = ''; directPlaybackDiag.probe = ''; directPlaybackDiag.subs = '';
  var videoPlayer = getEl('video-player');
  destroyHls();   // заодно снимает слушатели прошлого прямого файла
  // Samsung Tizen (приложение): файл играет нативный AVPlay — у <video> там нет
  // ни аудиодорожек, ни встроенных субтитров. tizen-avplay.js подменяет
  // свойства <video>, и всё ниже работает как обычно
  if (window.TizenAVPlay && TizenAVPlay.enabled()) TizenAVPlay.attach(videoPlayer);

  // Прямой файл — без hls.js, отдаём ссылку нативному <video>
  // Субтитры — дорожки самого <video> (refreshNativeSubtitles), не ffprobe
  resetNativeSubtitles();
  currentSubTracks = [];
  renderSubtitleTracks();
  listenNativeTextTracks(videoPlayer);
  AppState.seekOffset = 0;
  AppState.expectedDuration = null;
  AppState.originalDuration = null;

  showPlayerLoading('Подготовка потока...', null);

  var started = false;
  var startPlayback = function () {
    if (started || signal.aborted) return;
    started = true;
    if (AppState._loadingTimeout) { clearTimeout(AppState._loadingTimeout); AppState._loadingTimeout = null; }
    videoPlayer.removeEventListener('canplay', onCanPlay);
    // Tizen: спиннер «Воспроизведение…» — до первых кадров (onPlaying ниже)
    if (!AppState.tizenApp) hidePlayerLoading();
    // audioTracks к loadedmetadata был пуст — пробуем ещё раз
    // (на webOS дорожку включает webosSubsApply)
    if (nativeAudioPref >= 0 && AppState.platform !== 'webos') {
      var lateAudio = applyNativeAudioPref(videoPlayer);
      if (lateAudio >= 0) {
        var lateTracks = collectNativeAudioTracks(videoPlayer);
        if (lateTracks.length && !probeAudio.on) currentAudioTracks = lateTracks;
        currentAudioTrack = lateAudio;
        renderAudioTracks();
      }
    }
    if (initialSeek > 0) {
      try { videoPlayer.currentTime = initialSeek; } catch (e) { }
    }
    videoPlayer.play()['catch'](function () {
      videoPlayer.muted = true;
      videoPlayer.play()['catch'](function () { });
      restoreSoundOnGesture();
    });
    videoPlayer.muted = false; restoreSoundOnGesture();
    startTimecodeSaving(); resetMouseIdleTimer(); startNearEndCheck(); startHeartbeat(); startTorrentStatsUpdates();
  };

  // Все три слушателя снимаем одной функцией: раньше 'error' не снимался
  // вообще, и на каждом переключении серии на <video> оседал ещё один
  var detachDirectListeners = function () {
    videoPlayer.removeEventListener('loadedmetadata', onLoadedMetadata);
    videoPlayer.removeEventListener('canplay', onCanPlay);
    videoPlayer.removeEventListener('error', onError);
    videoPlayer.removeEventListener('playing', onPlaying);
  };

  // Спиннер — пока не пошли кадры. Без предзагрузки TorrServer отдаёт начало
  // файла не сразу, а AVPlay (tizen-avplay.js) ещё и готовит файл целиком до
  // canplay: заставка «Воспроизведение…» гасла с концом startHLSPlayback, и
  // секунды, а то и десятки секунд был просто чёрный экран. Пока только в
  // приложении для Tizen — у остальных спиннер гаснет, как раньше
  var onPlaying = function () {
    videoPlayer.removeEventListener('playing', onPlaying);
    hidePlayerLoading();
  };

  var onLoadedMetadata = function () {
    videoPlayer.removeEventListener('loadedmetadata', onLoadedMetadata);
    AppState.expectedDuration = videoPlayer.duration;
    AppState.originalDuration = videoPlayer.duration;
    forceUpdateDuration(videoPlayer.duration, videoPlayer.duration, 0);

    // Дорожки прямого файла отдаёт сам <video>. Раньше их только печатали в
    // консоль, поэтому панель аудио в этом режиме всегда была пустой, хотя
    // переключение (switchNativeAudioTrack) уже было написано.
    // На webOS список звука ведёт конвейер (webosSubsApply) — если он уже
    // пришёл, не перетираем его дорожками <video>
    var nativeTracks = webosAudio.mode || probeAudio.on ? [] : collectNativeAudioTracks(videoPlayer);
    if (nativeTracks.length) {
      currentAudioTracks = nativeTracks;
      // Раньше бралась включённая — то есть дорожка по умолчанию, и выбор
      // прошлой серии на каждой следующей терялся
      var enabled = applyNativeAudioPref(videoPlayer);
      if (enabled < 0) {
        for (var i = 0; i < videoPlayer.audioTracks.length; i++) {
          if (videoPlayer.audioTracks[i].enabled) { enabled = i; break; }
        }
      }
      currentAudioTrack = enabled >= 0 ? enabled : 0;
      renderAudioTracks();
    }
    refreshNativeSubtitles(videoPlayer);
    applyDirectProbe();
  };

  var onCanPlay = function () {
    startPlayback();
  };

  var onError = function () {
    detachDirectListeners();
    if (signal.aborted || AppState.currentScreen !== 'player') return;
    hidePlayerLoading();
    // Причин две и различить их снаружи нельзя: либо TorrServer не отдал файл,
    // либо устройство не умеет этот кодек. Баннер называет обе — alert здесь
    // и вовсе не показывался
    if (typeof window.showErrorBanner === 'function') {
      window.showErrorBanner('Файл не воспроизводится напрямую',
        'TorrServer не отдал поток либо кодек/контейнер не поддерживается устройством. ' +
        'Попробуйте перезапустить контент, выбрать другую раздачу или включить перекодирование.');
    } else alert('Файл не воспроизводится напрямую: кодек/контейнер не поддерживается устройством');
  };

  videoPlayer.addEventListener('loadedmetadata', onLoadedMetadata);
  videoPlayer.addEventListener('canplay', onCanPlay);
  videoPlayer.addEventListener('error', onError);
  if (AppState.tizenApp) videoPlayer.addEventListener('playing', onPlaying);
  // Ссылку держим, чтобы снять слушатели прошлого файла: 'error' живёт всё
  // воспроизведение, и без этого на <video> оседал ещё один на каждую серию
  AppState._directPlaybackDetach = detachDirectListeners;

  AppState._loadingTimeout = setTimeout(function () {
    if (!started && !signal.aborted) startPlayback();
  }, LOADING_TIMEOUT_MS);

  var staleMediaId = videoPlayer.mediaId;
  videoPlayer.src = playURL;
  videoPlayer.load();
  // webOS: mediaId и подписку ловим сразу, как Lampa (см. webosSubsStart)
  webosSubsStart(videoPlayer, staleMediaId);
  directProbeStart();
  AppState.nativeVideoPlayer = videoPlayer;
  if (AppState.tizenApp) showPlayerLoading('Воспроизведение...', null);
  else hidePlayerLoading();
}

async function initServerProxyPlayback(metadata, initialSeek, signal) {
  var seekParam = (initialSeek && initialSeek > 0) ? ('&start=' + initialSeek.toFixed(2)) : '';
  var durationParam = (metadata.fileInfo.duration && metadata.fileInfo.duration > 0) ? ('&duration=' + metadata.fileInfo.duration.toFixed(0)) : '';
  // Не выбрана — без audio: сервер возьмёт дорожку с пометкой default
  var audioParam = metadata.audioTrack !== null && metadata.audioChosen !== false ? ('&audio=' + metadata.audioTrack) : '';
  var subParam = currentSubtitleTrack >= 0 ? ('&sub=' + currentSubtitleTrack) : '';
  var multiChannelParam = (AppState.multiChannelEnabled === true) ? '&multiChannel=true' : '';
  var savedClientId = localStorage.getItem('clientId');
  var dvParam = '&dv=' + (AppState.dvPreferred ? 'true' : 'false');
  // fileInfo проверен в startHLSPlayback — сюда мы попадаем только с данными
  // tracks=1 — дорожки сразу в потоке (сервер 1.0.53+; старый параметр не знает)
  var streamUrl = SERVER_URL + '/hls/stream?url=' + encodeURIComponent(AppState.videoUrl) + seekParam + audioParam + multiChannelParam + '&clientId=' + encodeURIComponent(savedClientId) + durationParam + subParam + dvParam + '&tracks=1';
  var response;
  try {
    // С таймаутом: молчащий сервер иначе держит плеер открытым и пустым
    response = await fetchWithTimeout(streamUrl, { signal: signal }, PLAYER_FETCH_TIMEOUT_MS);
  } catch (e) {
    // Отмену воспроизведения пропускаем наверх как есть, а таймаут — как
    // обычную ошибку: наверху она превратится в баннер, а не в тихий выход
    if (signal.aborted) throw e;
    if (e && e.name === 'AbortError') throw new Error('Сервер не создал поток за ' + Math.round(PLAYER_FETCH_TIMEOUT_MS / 1000) + ' с');
    throw e;
  }
  if (!response.ok) throw new Error('HTTP ' + response.status);
  var data = await response.json();
  if (!data.success) throw new Error(data.error || 'Ошибка создания потока');
  AppState.currentStreamId = data.streamId; AppState.expectedDuration = data.duration; AppState.originalDuration = data.originalDuration || data.duration;
  AppState.seekOffset = data.seekOffset || initialSeek || 0; AppState.lastSuccessfulSeek = AppState.seekOffset;
  applyServerTracks(data.tracks);
  // Дорожку никто не выбирал — сервер взял с пометкой default (иначе первую)
  if (data.tracks && (metadata.audioTrack === null || metadata.audioChosen === false) && typeof data.tracks.selectedAudio === 'number') {
    currentAudioTrack = data.tracks.selectedAudio;
    renderAudioTracks();
  }
  var videoPlayer = getEl('video-player');
  if (Hls.isSupported()) {
    AppState.hls = createHlsInstance();
    attachHlsEventListeners(AppState.hls, videoPlayer, signal, initialSeek);
    AppState.hls.loadSource(data.playlistUrl); AppState.hls.attachMedia(videoPlayer);
  } else throw new Error('Ваш браузер не поддерживает HLS');
}

function attachHlsEventListeners(hls, videoPlayer, signal, initialSeek) {
  var isPlaybackCancelled = false;
  var manifestParsedHandler = function () {
    if (signal.aborted || isPlaybackCancelled) return;
    applyServerTrackSelection();
    forceUpdateDuration(AppState.expectedDuration, AppState.originalDuration, AppState.seekOffset);
    videoPlayer.currentTime = 0; videoPlayer.pause(); startTorrentStatsUpdates();
    if (thisisseek) {
      hidePlayerLoading();
      if (!signal.aborted && !isPlaybackCancelled) videoPlayer.play()['catch'](function (err) { videoPlayer.muted = true; videoPlayer.play()['catch'](function () { }); restoreSoundOnGesture(); });
      videoPlayer.muted = false; restoreSoundOnGesture(); startTimecodeSaving(); resetMouseIdleTimer();
      if (nearEndCheckInterval) clearInterval(nearEndCheckInterval);
      startNearEndCheck(); startHeartbeat(); return;
    }
    showPlayerLoading('Буферизация...', null);
    var onCanPlay = function () {
      // Страховочный таймаут ниже больше не нужен: без этого он срабатывал
      // через 3 секунды после начала и повторно жал play — поставленное сразу
      // после старта видео само снималось с паузы
      if (AppState._loadingTimeout) { clearTimeout(AppState._loadingTimeout); AppState._loadingTimeout = null; }
      hidePlayerLoading();
      if (!signal.aborted && !isPlaybackCancelled) videoPlayer.play()['catch'](function (err) { videoPlayer.muted = true; videoPlayer.play()['catch'](function () { }); restoreSoundOnGesture(); });
      videoPlayer.muted = false; restoreSoundOnGesture(); startTimecodeSaving(); resetMouseIdleTimer();
      if (nearEndCheckInterval) clearInterval(nearEndCheckInterval);
      startNearEndCheck(); startHeartbeat(); videoPlayer.removeEventListener('canplay', onCanPlay);
    };
    videoPlayer.addEventListener('canplay', onCanPlay);
    AppState._loadingTimeout = setTimeout(function () {
      if (!signal.aborted && !isPlaybackCancelled) {
        videoPlayer.removeEventListener('canplay', onCanPlay); hidePlayerLoading();
        videoPlayer.play()['catch'](function (err) { videoPlayer.muted = true; videoPlayer.play()['catch'](function () { }); restoreSoundOnGesture(); });
        videoPlayer.muted = false; restoreSoundOnGesture(); startTimecodeSaving(); resetMouseIdleTimer();
        if (nearEndCheckInterval) clearInterval(nearEndCheckInterval);
        startNearEndCheck(); startHeartbeat();
      }
    }, 3000);
  };
  hls.off(Hls.Events.MANIFEST_PARSED, manifestParsedHandler); hls.on(Hls.Events.MANIFEST_PARSED, manifestParsedHandler);
  // Список аудиодорожек hls.js получает и после MANIFEST_PARSED и тогда сам
  // выбирает первую — возвращаем выбранную в плеере
  hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, function () { if (!signal.aborted && AppState.serverTracks) selectHlsAudio(currentAudioTrack); });
  // Начало шкалы поколения (первый PTS видео) — для субтитров ServerSubs
  hls.on(Hls.Events.INIT_PTS_FOUND, function (e, d) {
    if (signal.aborted || !AppState.serverTracks || !d || d.id !== 'main' || !d.timescale) return;
    AppState.streamTimeOrigin = d.initPTS / d.timescale;
  });
  var fragLoadingHandler = function (event, data) { if (signal.aborted) return; };
  hls.off(Hls.Events.FRAG_LOADING, fragLoadingHandler); hls.on(Hls.Events.FRAG_LOADING, fragLoadingHandler);
  var bufferAppendedHandler = function (event, data) { if (signal.aborted) return; };
  hls.off(Hls.Events.BUFFER_APPENDED, bufferAppendedHandler); hls.on(Hls.Events.BUFFER_APPENDED, bufferAppendedHandler);
  var currentPlayingSegment = -1;
  var fragChangedHandler = function (event, data) {
    if (signal.aborted) return;
    if (data && data.frag) {
      var segmentNumber = data.frag.sn;
      if (currentPlayingSegment !== segmentNumber) {
        currentPlayingSegment = segmentNumber;
        if (segmentNumber > 0) {
          var now = Date.now();
          if (!window._lastCleanupTime || (now - window._lastCleanupTime) > 2000) {
            window._lastCleanupTime = now;
            bgFetch(SERVER_URL + '/hls/cleanup-segments/' + AppState.currentStreamId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keepFromSegment: segmentNumber }) })
              .then(function (r) { return r.json(); })
              .then(function (d) { if (d && typeof d.availableFrom === 'number') AppState.serverAvailableFrom = d.availableFrom; })
              ['catch'](function () { });
          }
        }
      }
    }
  };
  hls.off(Hls.Events.FRAG_CHANGED, fragChangedHandler); hls.on(Hls.Events.FRAG_CHANGED, fragChangedHandler);
  var networkRetries = 0;
  var errorHandler = function (event, data) {
    if (signal.aborted || !data.fatal) return;
    switch (data.type) {
      case Hls.ErrorTypes.NETWORK_ERROR:
        // Число попыток ограничено: раньше startLoad() звался без счётчика, и
        // при упавшем TorrStream/TorrServer плеер вечно и молча дёргал сервер
        if (++networkRetries > MAX_HLS_NETWORK_RETRIES) {
          hidePlayerLoading();
          showPlaybackUnavailableBanner('HLS: сеть не отвечает после ' + MAX_HLS_NETWORK_RETRIES + ' попыток');
          if (typeof showDetailView === 'function') showDetailView();
          break;
        }
        showPlayerLoading('Обрыв связи, попытка ' + networkRetries + ' из ' + MAX_HLS_NETWORK_RETRIES + '...', null);
        AppState.hls.startLoad();
        break;
      case Hls.ErrorTypes.MEDIA_ERROR:
        var errorMessage = data.error ? data.error.message || data.error : ''; var errorDetails = data.details || '';
        var isUnsupportedCodec = errorMessage.toLowerCase().includes('codec') || errorDetails.toLowerCase().includes('codec');
        if (AppState.videoUrl && (AppState.videoUrl.toLowerCase().includes('.avi') || AppState.videoUrl.toLowerCase().includes('.vc1'))) isUnsupportedCodec = true;
        if (isUnsupportedCodec) {
          getEl('playback-overlay').classList.add('active'); document.querySelector('.playback-text').textContent = 'Формат AVI или VC1 не поддерживаются на вашем устройстве'; hidePlayerLoading();
          setTimeout(function () { var exitBtn = getEl('exit-player-btn'); if (exitBtn) exitBtn.click(); else if (typeof showDetailView === 'function') showDetailView(); getEl('playback-overlay').classList.remove('active'); }, 4000);
        } else AppState.hls.recoverMediaError();
        break;
      default:
        AppState.playbackRetryCount = (AppState.playbackRetryCount || 0) + 1;
        if (AppState.playbackRetryCount <= MAX_PLAYBACK_RETRIES) {
          showPlayerLoading('Ошибка воспроизведения, попытка ' + AppState.playbackRetryCount + '...');
          setTimeout(function () { if (AppState.currentStreamId && !signal.aborted) startHLSPlayback(AppState.videoUrl, videoPlayer.currentTime + AppState.seekOffset, false); }, 2000);
        } else {
          hidePlayerLoading();
          // alert на телевизоре не виден — раньше плеер просто закрывался молча
          if (typeof window.showErrorBanner === 'function') {
            window.showErrorBanner('Не удалось воспроизвести видео',
              'Проверьте соединение или формат файла. Попробуйте перезапустить контент или выбрать другую раздачу.');
          } else alert('Не удалось воспроизвести видео. Проверьте соединение или формат файла.');
          if (typeof showDetailView === 'function') showDetailView();
        }
        break;
    }
  };
  hls.off(Hls.Events.ERROR, errorHandler); hls.on(Hls.Events.ERROR, errorHandler);
}

/**
 * Хеш торрента и номер файла из ссылки потока.
 *
 * У TorrServer параметр link= принимает и голый хеш, и магнет целиком. Прежняя
 * регулярка ([a-fA-F0-9]+) на магнете не срабатывала вовсе — Android-ветка тогда
 * оставалась и без плейлиста серий, и без таймкода, молча стартуя с нуля.
 */
function parseStreamRef(url) {
  if (!url) return null;
  var direct = url.match(/\/play\/([a-fA-F0-9]{40})\/(\d+)/);
  if (direct) return { hash: direct[1], fileId: direct[2] };

  var linkParam = (url.match(/[?&]link=([^&]+)/) || [])[1];
  var indexParam = (url.match(/[?&]index=(\d+)/) || [])[1];
  if (!linkParam || !indexParam) return null;

  var decoded = decodeURIComponent(linkParam);
  var hash = /^[a-fA-F0-9]{40}$/.test(decoded)
    ? decoded
    : (typeof extractHashFromMagnet === 'function' ? extractHashFromMagnet(decoded) : null);
  return hash ? { hash: hash, fileId: indexParam } : null;
}

/**
 * Видео ли файл, который просят играть. Запуск часто идёт с «файлом № 1» по
 * умолчанию («Играть», поиск), а у раздачи Blu-ray это служебный .clpi, у
 * подделки — .exe. { url } — играть этот адрес (файл, может, уже другой: фильм
 * из папки BDMV), { error } — не играть, показать текст. Список файлов раздачи
 * не загружен — как раньше, играть то, что просили.
 */
function resolvePlayableStream(url) {
  var ref = parseStreamRef(url);
  if (!ref || typeof window.pickPlayableVideoFiles !== 'function') return { url: url };
  var hashLower = String(ref.hash).toLowerCase();
  var torrent = null;
  var list = AppState.torrents || [];
  for (var i = 0; i < list.length && !torrent; i++) {
    if (list[i].hash && list[i].hash.toLowerCase() === hashLower) torrent = list[i];
  }
  if (!torrent && AppState.currentDetailItem && String(AppState.currentDetailItem.hash || '').toLowerCase() === hashLower) {
    torrent = AppState.currentDetailItem;
  }
  var files = torrent && typeof getTorrentFiles === 'function' ? getTorrentFiles(torrent) : [];
  if (!files.length) return { url: url };
  var file = null;
  for (var k = 0; k < files.length && !file; k++) {
    if (String(files[k].id) === String(ref.fileId)) file = files[k];
  }
  if (!file || window.isPlayableVideoPath(file.path || file.name)) return { url: url };
  var videos = sortEpisodeFiles(window.pickPlayableVideoFiles(files));
  if (!videos.length) return { error: window.describeUnplayableTorrent(files) };
  var id = String(videos[0].id);
  console.log('▶️ Файл ' + ref.fileId + ' не видео (' + (file.path || '') + ') — играем ' + id + ' (' + (videos[0].path || '') + ')');
  return {
    url: url.replace(/(\/play\/[a-fA-F0-9]{40}\/)\d+/, '$1' + id).replace(/([?&]index=)\d+/, '$1' + id),
    fileId: id
  };
}
window.resolvePlayableStream = resolvePlayableStream;

async function startHLSPlayback(originalUrl, initialSeek, fromSearch, episodeIndex, audioTrack) {
  // Не видео (служебный файл Blu-ray, .exe, ISO) — подменить на фильм или не играть
  var playable = resolvePlayableStream(originalUrl);
  if (playable.error) {
    if (typeof showErrorBanner === 'function') showErrorBanner(playable.error);
    else if (typeof window.showToast === 'function') window.showToast(playable.error);
    return false;
  }
  originalUrl = playable.url;
  if (initialSeek === undefined) initialSeek = null;
  if (fromSearch === undefined) fromSearch = false;
  if (episodeIndex === undefined) episodeIndex = null;
  // Дорожку передали явно (смена дорожки, следующая серия с той же озвучкой)
  // или она сохранена для файла — это выбор; иначе серверный поток с
  // дорожками берёт ту, что помечена default (initServerProxyPlayback)
  var audioExplicit = audioTrack !== undefined && audioTrack !== null;
  if (audioTrack === undefined) audioTrack = currentAudioTrack !== undefined ? currentAudioTrack : null;
  // Раздачу TorrServer мог забыть (остановили без базы, перезапуск, удалили), и
  // по хешу он поднял бы её без трекеров. Сохранённый полный magnet — вернуть
  // им до любых запросов по хешу: предзагрузки, внешнего плеера, потока
  // (magnet-store.js; без записи — сразу дальше)
  var ensureRef = window.MagnetStore ? parseStreamRef(originalUrl) : null;
  if (ensureRef) await MagnetStore.ensure(ensureRef.hash);
  // Настройка «Предзагрузка»: до плеера — окно с буфером и статистикой раздачи
  // (torrserverstats.js). Только при запуске из интерфейса: смена серии,
  // дорожки и перезапуск потока идут изнутри плеера, и там окно ни к чему.
  // «Назад» в окне — отмена: возвращаем false, как при неподнявшемся плеере.
  if (AppState.preloadBeforePlay && AppState.currentScreen !== 'player' && typeof runPlaybackPreload === 'function') {
    var preloadRef = parseStreamRef(originalUrl);
    if (preloadRef) {
      var preloadTitle = AppState.currentDetailItem ? (AppState.currentDetailItem.title || AppState.currentDetailItem.name || '') : '';
      if (!(await runPlaybackPreload(preloadRef.hash, preloadRef.fileId, preloadTitle))) return false;
    }
  }
  // Устройство Apple с выбранным внешним плеером (Infuse, VLC, плееры tvOS…):
  // как у Android — серии и сохранённая позиция до запуска, дальше URL-схема
  var applePlayer = (typeof getApplePlayer === 'function') ? getApplePlayer() : null;
  if (applePlayer && applePlayer.template) {
    var appleRef = parseStreamRef(originalUrl);
    // Серии — при любой настройке автопереключения: по ним номер серии в
    // заголовке и ключ серии у таймкода (getTimecodeMediaKey). Плейлист чужому
    // плееру уходит только при включённой (buildAppleExternalUrl)
    if (AppState.currentDetailItem && AppState.currentDetailItem.hash) {
      try { await loadEpisodesInfo(AppState.currentDetailItem.hash, appleRef ? appleRef.fileId : null); } catch (e) { /* без серий — один файл */ }
      if (AppState.autoSwitchEpisodes && typeof getTorrentProgressBatch === 'function') {
        try { await getTorrentProgressBatch(AppState.currentDetailItem.hash, currentEpisodeFiles); } catch (e) { /* без прогресса — нули */ }
      }
    }
    var appleSeek = initialSeek;
    if (appleSeek === null && appleRef) {
      try {
        var appleSaved = await loadTimecodeFromServer(appleRef.hash, appleRef.fileId);
        if (appleSaved > 0) appleSeek = appleSaved;
      } catch (e) { /* нет таймкода — с начала */ }
    }
    if (openAppleExternalPlayer(originalUrl, buildExternalPlayerTitle(), appleSeek)) return;
  }

  if (window.AndroidJS) {
    var androidRef = parseStreamRef(originalUrl);

    // Заголовок считаем ПОСЛЕ loadEpisodesInfo ниже — до него currentEpisodeIndex
    // ещё не знает, какая серия открыта, и в название не попал бы её номер.
    // Плейлист серий нужен ДО открытия нативного плеера: иначе currentEpisodeFiles
    // ещё пуст (обычно он подгружается уже после старта воспроизведения, с задержкой).
    // Грузим и при выключенном «Переключать серии автоматически»: без
    // currentEpisodeFiles у таймкода нет ключа серии (getTimecodeMediaKey),
    // сервер не связывает файл с сериалом — и после плеера не было ни
    // «Продолжить», ни серий в карточке, ни записи в «Продолжить просмотр».
    if (AppState.currentDetailItem && AppState.currentDetailItem.hash) {
      try { await loadEpisodesInfo(AppState.currentDetailItem.hash, androidRef ? androidRef.fileId : null); } catch (e) { /* ignore, fall back to single episode */ }
      // Названия серий для плейлиста. Карточку раздачи не открывали (запуск с
      // главной, из «Продолжить») — их ещё нет, loadEpisodesInfo только начал
      // их грузить. Ждём недолго: без названий плеер покажет «Эпизод N».
      if (typeof window.ensureTorrentEpisodeMeta === 'function' && currentEpisodeFiles.length > 1) {
        await Promise.race([
          window.ensureTorrentEpisodeMeta(AppState.currentDetailItem, currentEpisodeFiles),
          new Promise(function (resolve) { setTimeout(resolve, ANDROID_EPISODE_META_WAIT_MS); })
        ]);
      }
      // Прогрев кэша прогресса: buildEpisodesPlaylist синхронный, а
      // таймкоды серий нужны ему, чтобы у каждого элемента плейлиста был
      // осмысленный timeline (и позиция, с которой серию продолжат).
      if (typeof getTorrentProgressBatch === 'function') {
        try { await getTorrentProgressBatch(AppState.currentDetailItem.hash, currentEpisodeFiles); } catch (e) { /* без прогресса — нули */ }
      }
    }
    // Возобновление с сохранённой позиции. Ветка AndroidJS выходит из функции ДО
    // preparePlaybackMetadata, а именно там веб-плеер читает таймкод с сервера
    // (loadTimecodeFromServer). Из-за этого нативный плеер всегда стартовал с нуля:
    // прогресс сохранялся, но никто его не запрашивал обратно.
    var androidSeek = initialSeek;
    if (androidSeek === null && androidRef) {
      try {
        var savedSeek = await loadTimecodeFromServer(androidRef.hash, androidRef.fileId);
        if (savedSeek > 0) androidSeek = savedSeek;
      } catch (e) { /* нет таймкода — стартуем с начала */ }
    }

    if (playInExternalPlayer(originalUrl, buildExternalPlayerTitle(), androidSeek, fromSearch)) {
      getEl('config-screen').style.display = 'none';
      // Запуск с главной: главная (она внутри torrserver-section) остаётся под
      // плеером. Иначе по возврату чёрный экран, если таймлайн не пришёл —
      // плеер закрыли до начала показа (resultPlayer пропускает 0/0)
      if (!androidReturnHome) getEl('torrserver-section').style.display = 'none';
      return;
    }
  }
  resetPlaybackState();
  currentPlaybackController = new AbortController(); var signal = currentPlaybackController.signal;
  currentBufferAhead = 0; wasImmediatePause = false; pauseTimer = null; pauseStartTime = null; AppState.playbackRetryCount = 0;
  if (!originalUrl || !originalUrl.trim()) {
    if (typeof window.showErrorBanner === 'function') {
      window.showErrorBanner('Не удалось начать воспроизведение', 'Ссылка на видео не указана');
    } else alert('Ошибка: URL не указан');
    return false;
  }
  lastPlaybackFromSearch = fromSearch;
  //if (!AppState.transcodingFullOnOff) {
  var metadata = await preparePlaybackMetadata(originalUrl, initialSeek, audioTrack, signal);
  if (metadata) metadata.audioChosen = audioExplicit || metadata.savedAudioTrack !== null;
  if (!metadata || signal.aborted) return false;
  var { fileInfo, savedAudioTrack, fileName, savedSubTrack, savedTimecode, seekTime } = metadata;
  initialSeek = seekTime;
  // } else {
  //   var metadata = await preparePlaybackMetadata(originalUrl, initialSeek, audioTrack, signal);
  //   if (metadata) {
  //     if (initialSeek === null) initialSeek = 0;
  //     var fileName = '';
  //   }
  // }
  // Обычный режим собирает поток из данных ffprobe, и без них дальше идти
  // некуда: раньше отсутствие fileInfo вылезало уже внутри
  // initServerProxyPlayback как «Cannot read properties of null (reading
  // duration)» — поверх уже открытого пустого плеера. Режимы gst и прямого
  // файла fileInfo не используют, их не трогаем.
  var needsFileInfo = !AppState.transcodingOnOff && !AppState.transcodingFullOnOff;
  if (needsFileInfo && (!fileInfo || fileInfo.success === false)) {
    showPlaybackUnavailableBanner('/api/file/info не отдал данные о ' +
      currentTimecodeData.hash + '/' + currentTimecodeData.fileId);
    return false;
  }

  var startRef = parseStreamRef(originalUrl);
  if (startRef) OnlineSubs.onFileStart(startRef.hash, startRef.fileId);
  var startEpisodeTitle = startRef ? getEpisodePlayerTitle(startRef.hash, startRef.fileId) : null;
  if (startEpisodeTitle) updatePlayerTitle(startEpisodeTitle);
  else if (fileName) updatePlayerTitle(fileName);
  else if (AppState.currentDetailItem && AppState.currentDetailItem.title) updatePlayerTitle(AppState.currentDetailItem.title);
  if (AppState.currentDetailItem && AppState.currentDetailItem.hash) {
    var currentFileId = (episodeIndex !== null && currentEpisodeFiles[episodeIndex]) ? currentEpisodeFiles[episodeIndex].id : (metadata.match ? metadata.match[2] : null);
    setTimeout(function () { if (!signal.aborted) loadEpisodesInfo(AppState.currentDetailItem.hash, currentFileId); }, fromSearch ? EPISODES_LOAD_DELAY_SEARCH_MS : EPISODES_LOAD_DELAY_MS);
  }
  var preplayback = capturePreplaybackScreen();
  transitionToPlayerScreen(); AppState.videoUrl = originalUrl;
  var videoPlayer = getEl('video-player');
  videoPlayer.removeEventListener('ended', handleVideoEnded); videoPlayer.addEventListener('ended', handleVideoEnded);
  try {
    if (AppState.transcodingOnOff) {
      await initGstPlayback(metadata, initialSeek, signal);
    } else if (AppState.transcodingFullOnOff) {
      nativeSubState.savedPref = (metadata && metadata.savedSubTrack !== null && metadata.savedSubTrack !== undefined)
        ? metadata.savedSubTrack : -1;
      // Дорожку передали (следующая серия, смена дорожки) или она сохранена
      // для файла — включим её, когда <video> отдаст список
      var directAudio = metadata && metadata.savedAudioTrack !== null && metadata.savedAudioTrack !== undefined
        ? metadata.savedAudioTrack : (metadata && metadata.audioChosen ? metadata.audioTrack : null);
      directAudio = parseInt(directAudio, 10);
      nativeAudioPref = directAudio >= 0 ? directAudio : -1;
      await initTranscodingOffPlayback(initialSeek, signal, metadata && metadata.fileName);
    } else {
      await initServerProxyPlayback(metadata, initialSeek, signal);
    }
    showPlayerHint(); return true;
  } catch (error) {
    if (error.name === 'AbortError') return false;
    // Поток не поднялся: сервер не ответил, не создал поток или отдал не-200.
    // Плеер уже открыт, и оставить его так нельзя — под ним чёрный экран,
    // а alert на телевизоре не виден. Возвращаем то, что было, и объясняем.
    cancelCurrentPlayback();
    restorePreplaybackScreen(preplayback);
    showPlaybackUnavailableBanner(error && error.message);
    return false;
  }
}

function cancelCurrentPlayback() {
  if (seriesStartCancel) seriesStartCancel();
  if (currentPlaybackController) { currentPlaybackController.abort(); currentPlaybackController = null; }
  if (AppState.bufferCheckInterval) { clearInterval(AppState.bufferCheckInterval); AppState.bufferCheckInterval = null; }
  if (AppState._loadingTimeout) { clearTimeout(AppState._loadingTimeout); AppState._loadingTimeout = null; }
  if (AppState._seekTimeout) { clearTimeout(AppState._seekTimeout); AppState._seekTimeout = null; }
  if (AppState.seekTimeout) { clearTimeout(AppState.seekTimeout); AppState.seekTimeout = null; }
  if (AppState.hls) { try { AppState.hls.destroy(); AppState.hls = null; } catch (e) { } }
  if (AppState.currentStreamId) { bgFetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST' })['catch'](function () { }); AppState.currentStreamId = null; }
  hidePlayerLoading();
}

function showDetailView(field = null) {
  // Куда вернуться из плеера — запись стека переходов под ним (nav.js). Плеер
  // мог и не подняться (ошибка до transitionToPlayerScreen) — тогда его записи
  // в стеке нет, и место возврата — то, что наверху сейчас.
  var navUnder = window.Nav ? (Nav.pop('player') || Nav.top()) : null;
  if (!window.AndroidJS) {
    resetNativeSubtitles();
    currentSubtitleTrack = -1; stopTorrentStatsUpdates(); hideSkipButton(); skipIntro = 0; skipCredits = 0;
    currentBufferAhead = 0; wasImmediatePause = false; pauseTimer = null; pauseStartTime = null; thisisseek = false;
    var seekSlider = getEl('seek-slider'); if (seekSlider) seekSlider.value = 0;
    var currentTimeSpan = getEl('current-time'); if (currentTimeSpan) currentTimeSpan.textContent = '00:00';
    if (AppState) { AppState.seekQueue = []; AppState.isSeeking = false; AppState.previewTime = null; AppState.suppressTimeUpdate = false; }
    if (AppState.isYoutubePlayback) {
      if (typeof window.exitYoutubePlayer === 'function') window.exitYoutubePlayer();
      else {
        if (AppState.currentStreamId) { bgFetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST' })['catch'](function () { }); AppState.currentStreamId = null; }
        if (AppState.hls) { AppState.hls.destroy(); AppState.hls = null; }
        AppState.isYoutubePlayback = false; AppState.currentScreen = 'catalog'; getEl('player-screen').style.display = 'none';
        var detailView = getEl('detail-view');
        if (detailView && AppState.youtubeContext) {
          if (typeof Animations !== 'undefined' && typeof Animations.ensureDetailVisible === 'function') Animations.ensureDetailVisible();
          else { detailView.style.display = 'block'; detailView.style.pointerEvents = 'auto'; }
        }
        else if (typeof window.showCatalogList === 'function') window.showCatalogList();
      }
      return;
    }
    trackTimecodeSave(saveTimecodeToServer()).then(function () { stopTimecodeSaving(); });
    // Откуда бы ни запускали: и ряд главной, и лежащая под поиском карточка
    if (typeof window.refreshDetailResume === 'function') window.refreshDetailResume();
    stopHeartbeat();
    if (nearEndCheckInterval) { clearInterval(nearEndCheckInterval); nearEndCheckInterval = null; }
    lastCleanedSegment = -1; currentEpisodeFiles = []; currentEpisodeIndex = 0; currentTorrentHash = null;
    updatePlayerTitle(null); clearTimecodeData();
    if (typeof window.hideSeekOverlay === 'function') window.hideSeekOverlay();
    closePlayerPanels();
    var episodesBtn = getEl('episodes-btn');
    if (episodesBtn) episodesBtn.style.display = 'none';
    var prevBtn = getEl('prev-episode-btn'); var nextBtn = getEl('next-episode-btn');
    if (prevBtn) prevBtn.style.display = 'none'; if (nextBtn) nextBtn.style.display = 'none';
    AppState.currentScreen = 'detail';
    var videoPlayer = getEl('video-player');
    videoPlayer.removeEventListener('ended', handleVideoEnded); videoPlayer.pause(); videoPlayer.removeAttribute('src'); videoPlayer.load();
    destroyHls(); hidePlayerLoading();
    if (AppState.currentStreamId) { bgFetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST' })['catch'](function () { }); AppState.currentStreamId = null; }
    getEl('player-screen').style.display = 'none';
    getEl('config-screen').style.display = 'none';

    // Запускали из выдачи поиска (под плеером в стеке — поиск): просто
    // возвращаем оверлей с результатами, раздачу не открываем и не останавливаем
    if (navUnder && navUnder.screen === 'search') {
      // Поиск открыт из карточки фильма/сериала — возвращаемся в неё
      if (returnToCardFromSearch(AppState.currentDetailItem && AppState.currentDetailItem.hash)) return;
      lastPlaybackFromSearch = false;
      AppState.playFromHash = false;
      AppState.isCatalogSearch = false;
      AppState.currentScreen = 'search';
      var searchOverlay = getEl('search-overlay');
      if (searchOverlay) searchOverlay.classList.remove('hidden');
      var mainContainer = getEl('main-container');
      if (mainContainer) mainContainer.style.pointerEvents = 'auto';
      setTimeout(function () {
        // На ту раздачу, которую запускали (torrents.js: focusLastSearchResult)
        if (typeof window.focusLastSearchResult === 'function' && window.focusLastSearchResult()) return;
        if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
          updateFocusableElements();
          for (var i = 0; i < focusableElements.length; i++) {
            if (focusableElements[i].classList && focusableElements[i].classList.contains('search-result-item')) { setFocus(i); break; }
          }
        }
      }, 100);
      return; // не открываем detail и не дропаем торрент
    }

    // Запускали с главной («Продолжить» в баннере, resumeWatching): туда и
    // возвращаемся, карточку раздачи не открываем. Раздачу останавливаем, как
    // и после просмотра из карточки, — TorrServer незачем её дальше качать
    if (navUnder && navUnder.screen === 'home' && window.HomeScreen && !AppState.cardPlayback) {
      var homeHash = (AppState.currentDetailItem && AppState.currentDetailItem.hash) || null;
      if (homeHash) {
        dropTorrentToServer(homeHash)['catch'](function () { });
        if (torrentProgressCache.has(homeHash)) torrentProgressCache.delete(homeHash);
      }
      AppState.playFromHash = false;
      AppState.currentDetailItem = null;
      // Новое место в кнопку баннера приносит сам показ (updateHistoryResume)
      HomeScreen.show();
      return;
    }

    getEl('torrserver-section').style.display = 'block';

    // Запускали из карточки фильма: в неё и возвращаемся, а раздачу
    // останавливаем — как после запуска с главной
    if (AppState.cardPlayback) {
      var cardHash = (AppState.currentDetailItem && AppState.currentDetailItem.hash) || null;
      if (cardHash) {
        dropTorrentToServer(cardHash)['catch'](function () { });
        if (torrentProgressCache.has(cardHash)) torrentProgressCache.delete(cardHash);
      }
      returnToDetailCard();
      return;
    }
  }
  // Сначала drop, только потом список.
  //
  // Раньше оба запроса уходили параллельно, и список успевал вернуться до
  // того, как TorrServer применил остановку: карточка отрисовывалась в
  // состоянии «до», с прежней статистикой раздачи.
  //
  // Неудачный drop список не отменяет — раздачу могли остановить раньше или
  // сервер моргнул, а устаревшие карточки хуже лишнего запроса.
  //
  // Хэш запоминаем сразу: цепочка разрешится через пару сотен миллисекунд, и
  // к этому моменту открытой может быть уже другая карточка, а чистить кэш
  // прогресса надо у той раздачи, которую только что смотрели.
  var watchedHash = (AppState.currentDetailItem && AppState.currentDetailItem.hash) || null;
  var dropped = watchedHash
    ? dropTorrentToServer(watchedHash)['catch'](function (error) { return null; })
    : Promise.resolve(null);
  dropped.then(function () {
    return refreshTorrentsList();
  }).then(function () {
    if (watchedHash && torrentProgressCache.has(watchedHash)) torrentProgressCache.delete(watchedHash);
  })['catch'](function (error) { });
  if (lastPlaybackFromSearch && lastAddedTorrentHash) {
    setTimeout(function () {
      var found = showDetailByHash(lastAddedTorrentHash);
      if (!found) refreshTorrentsList().then(function () { showDetailByHash(lastAddedTorrentHash); });
    }, 500);
    lastPlaybackFromSearch = false;
  } else {
    var detailView = getEl('detail-view');
    var restoreDetail = (typeof Animations !== 'undefined' && typeof Animations.ensureDetailVisible === 'function')
      ? Animations.ensureDetailVisible
      : function () { detailView.style.display = 'block'; };
    if (AppState.currentDetailItem) { restoreDetail(); updateDetailProgress(AppState.currentDetailItem); }
    else detailView.style.display = 'none';
    setTimeout(function () {
      if (typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
        updateFocusableElements(); var progressBtnIndex = -1;
        if (typeof focusableElements !== 'undefined') {
          var fieldAsNumber = Number(field);
          if (field != null && !isNaN(fieldAsNumber)) setFocus(fieldAsNumber + 1);
          else {
            for (var i = 0; i < focusableElements.length; i++) {
              var el = focusableElements[i];
              if (el && (el.classList.contains('detail-progress-btn') || el.classList.contains('file-item') || el.classList.contains('back-btn'))) { progressBtnIndex = i; break; }
            }
            setFocus(progressBtnIndex !== -1 ? progressBtnIndex : 0);
          }
        }
      }
    }, 250);
  }
}

async function updateDetailProgress(torrent) {
  if (!torrent || !torrent.hash) return null;

  var btn = getEl('detail-progress-btn');
  if (!btn) return null;

  // Сначала дожидаемся сохранения таймкода, которое запустил выход из плеера:
  // без этого батч ниже отвечает состоянием до сохранения (см. trackTimecodeSave)
  await awaitPendingTimecodeSave();

  // Принудительное обновление: сбрасываем кэш прогресса.
  // Именно torrentProgressCache — тот, из которого читает loadProgressForTorrent.
  // Раньше тут чистился давно осиротевший progressCache, и кнопка «Продолжить»
  // после выхода из плеера могла показывать позицию до минуты назад.
  var cacheKey = torrent.hash;
  if (torrentProgressCache.has(cacheKey)) torrentProgressCache.delete(cacheKey);
  // Заодно снимаем запрос, уже висящий в воздухе: getTorrentProgressBatch отдал бы
  // нам именно его — тот самый устаревший ответ, ради которого чистится кэш
  if (typeof torrentProgressInFlight !== 'undefined') delete torrentProgressInFlight[cacheKey];

  // Чистим старые блоки (могли остаться от предыдущей версии)
  var oldProgressBlocks = document.querySelectorAll('#detail-progress');
  for (var i = 0; i < oldProgressBlocks.length; i++) oldProgressBlocks[i].remove();

  // Обработчик вешаем один раз (флаг общий с addProgressToDetail — кнопка одна),
  // читает dataset в момент клика
  if (!btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var hash = btn.dataset.hash || '';
      var fileId = parseInt(btn.dataset.fileId || '1', 10) || 1;
      var timecode = parseInt(btn.dataset.timecode || '0', 10) || 0;
      var episodeIndex = parseInt(btn.dataset.episodeIndex || '0', 10) || 0;
      if (!hash || !AppState.currentTorrserverUrl) return;
      var playUrl = AppState.currentTorrserverUrl + '/play/' + hash + '/' + fileId;
      getEl('playback-overlay').classList.add('active');
      var detailView = getEl('detail-view');
      if (detailView) detailView.style.pointerEvents = 'none';
      var done = function () {
        getEl('playback-overlay').classList.remove('active');
        if (detailView) detailView.style.pointerEvents = 'auto';
      };
      startHLSPlayback(playUrl, timecode, false, episodeIndex).then(done)['catch'](done);
    });
  }

  // === Состояние по умолчанию: «Играть» → первое видео (fileId = 1) ===
  btn.dataset.hash = torrent.hash;
  btn.dataset.fileId = '1';
  btn.dataset.timecode = '0';
  btn.dataset.episodeIndex = '0';
  btn.classList.remove('has-progress');
  btn.innerHTML = '<span class="btn-label">▶ Играть</span>';

  var progress = await loadProgressForTorrent(torrent, getTorrentFiles(torrent));
  if (!progress || !(progress.timecode > 0)) return null; // прогресса нет — остаётся «Играть»

  // === Есть прогресс: «Продолжить» ===
  var fileId = parseInt(progress.fileId, 10) || 1;
  var timecode = progress.timecode;
  var episodeIndex = progress.episodeIndex || 0;

  var percent = progress.duration > 0 ? (timecode / progress.duration) * 100 : 0;
  var remaining = 100 - percent;
  var isNextFile = false;

  // Осталось ≤ 5% — запускаем следующий файл
  if (remaining <= 5) {
    var videoFiles = getVideoFilesFromTorrent(torrent);
    var nextFile = videoFiles.length ? videoFiles[episodeIndex + 1] : null;
    if (nextFile) {
      fileId = nextFile.id || (fileId + 1);
      timecode = 0;
      episodeIndex = episodeIndex + 1;
      isNextFile = true;
    } else if (progress.isSeries && episodeIndex + 1 < (progress.totalEpisodes || 0)) {
      fileId = fileId + 1; // фоллбэк, если список файлов ещё не загружен
      timecode = 0;
      episodeIndex = episodeIndex + 1;
      isNextFile = true;
    } else {
      timecode = 0; // это последний файл — начинаем с начала
    }
  }

  btn.dataset.fileId = String(fileId);
  btn.dataset.timecode = String(timecode);
  btn.dataset.episodeIndex = String(episodeIndex);
  btn.classList.add('has-progress');

  var timeStr = formatTime(progress.timecode);
  var totalStr = progress.duration ? formatTime(progress.duration) : '??:??';
  var hint = '';
  if (isNextFile) {
    hint = 'Серия ' + (episodeIndex + 1);
  } else {
    hint = timeStr + ' / ' + totalStr;
    if (progress.isSeries) hint = 'Серия ' + (episodeIndex + 1) + ' · ' + hint;
  }
  btn.innerHTML =
    '<span class="btn-label">▶ Продолжить</span>' +
    '<span class="btn-hint">' + hint + '</span>';

  // Полосу на плитке красим тем, что уже вернул батч по этой раздаче
  updateCurrentFileProgress(torrent.hash, progress.fileId, progress.timecode, progress.duration);

  return fileId;
}

/**
 * Полоса прогресса на плитке файла.
 *
 * Таймкод и длительность приходят аргументами, а не запросом. Раньше здесь был
 * свой /api/timecode/get по тому же hash+fileId, хотя вызывающий уже держал
 * эти же два числа: их только что вернул /api/timecode/batch, причём сразу по
 * всем файлам раздачи. То есть на выходе из плеера сервер спрашивали дважды об
 * одном и том же. Данные там свежие — updateDetailProgress перед батчем чистит
 * torrentProgressCache и дожидается сохранения таймкода.
 */
function updateCurrentFileProgress(hash, fileId, timecode, duration) {
  if (!hash || !fileId) return;
  if (!(timecode > 0) || !(duration > 0)) return;
  var fileItems = document.querySelectorAll('.file-item'); var targetItem = null;
  for (var i = 0; i < fileItems.length; i++) { if (fileItems[i].dataset.hash === hash && fileItems[i].dataset.fileId == fileId) { targetItem = fileItems[i]; break; } }
  if (!targetItem) return;
  var progressPercent = Math.min((timecode / duration) * 100, 98);
  var progressFill = targetItem.querySelector('.file-progress-fill');
  if (progressFill) { progressFill.style.width = progressPercent + '%'; if (progressPercent > 5) targetItem.classList.add('has-progress'); }
}

/**
 * Данные о файле от TorrStream (он берёт их у TorrServer через ffprobe).
 *
 * null здесь означает, что связка не ответила, — и это не мелочь: без
 * fileInfo обычный режим не соберёт поток. Раньше на нуле всё падало внутри
 * initServerProxyPlayback на metadata.fileInfo.duration, и человек видел
 * «Ошибка воспроизведения: … reading 'duration'» поверх пустого плеера.
 * Теперь проверку делает startHLSPlayback до входа в плеер.
 */
async function loadFileInfo(hash, fileId) {
  try {
    var savedClientId = localStorage.getItem('clientId');
    var response = await fetchWithTimeout(SERVER_URL + '/api/file/info?hash=' + hash + '&fileId=' + fileId + '&clientId=' + encodeURIComponent(savedClientId), null, FILE_INFO_FETCH_TIMEOUT_MS);
    if (response.ok) return await response.json();
    console.warn('⚠️ /api/file/info вернул HTTP ' + response.status);
  } catch (error) {
    console.warn('⚠️ /api/file/info недоступен:', (error && error.name === 'AbortError') ? 'таймаут' : (error && error.message));
  }
  return null;
}

function renderAudioTracks() {
  var audioList = getEl('audio-list'); if (!audioList) return;
  if (AppState.transcodingFullOnOff && (!currentAudioTracks || currentAudioTracks.length === 0)) {
    audioList.innerHTML = '<div class="search-result-empty">Нет аудиодорожек</div>'; return;
  }
  if (!currentAudioTracks || currentAudioTracks.length === 0) { audioList.innerHTML = '<div class="search-result-empty">Нет аудиодорожек</div>'; return; }
  var html = '';
  for (var idx = 0; idx < currentAudioTracks.length; idx++) {
    var track = currentAudioTracks[idx]; var isActive = idx === currentAudioTrack;
    var language = track.language || 'unknown'; var channels = track.channels ? (track.channels + ' ch') : ''; var codec = track.codec || '';
    html += '<div class="audio-item ' + (isActive ? 'active' : '') + '" data-track-index="' + idx + '">' +
      '<div class="audio-icon">🔊</div><div class="audio-info"><div class="audio-title">' + escapeHtml(track.title || ('Дорожка ' + (idx + 1))) + '</div>' +
      '<div class="audio-details"><span class="audio-language">' + language.toUpperCase() + '</span>' + (channels ? ' <span class="audio-channels">' + channels + '</span>' : '') + (codec ? ' <span class="audio-codec">' + codec + '</span>' : '') + '</div></div><div class="audio-check">✓</div></div>';
  }
  audioList.innerHTML = html;
  // var audioItems = audioList.querySelectorAll('.audio-item');
  // for (var i = 0; i < audioItems.length; i++) {
  //   (function (item) { item.addEventListener('click', function () { switchAudioTrack(parseInt(item.dataset.trackIndex)); }); })(audioItems[i]);
  // }
  // Клики обрабатываются делегированием
  setupAudioListDelegation();
}

function collectNativeAudioTracks(videoPlayer) {
  var list = videoPlayer.audioTracks;
  if (!list || list.length === 0) return [];
  var tracks = [];
  for (var i = 0; i < list.length; i++) {
    tracks.push({
      title: list[i].label || ('Аудиодорожка ' + (i + 1)),
      language: list[i].language || 'und',
      channels: null,   // audioTracks не отдаёт ни каналы, ни кодек
      codec: null
    });
  }
  return tracks;
}

// Сохранённая дорожка прямого файла (выбор прошлой серии или этого файла):
// <video> сам включает дорожку по умолчанию, поэтому её надо включить, когда
// появится список. -1 — выбора нет
var nativeAudioPref = -1;

/** Включить сохранённую дорожку в video.audioTracks; номер включённой или -1 */
function applyNativeAudioPref(videoPlayer) {
  var list = videoPlayer && videoPlayer.audioTracks;
  if (nativeAudioPref < 0 || !list || list.length === 0) return -1;
  // Tizen (AVPlay): номер сохранён по списку из разбора файла, а у AVPlay
  // порядок свой — ждём список (applyProbeAudioList включит её сам), по
  // номеру AVPlay — только если разбор не ответил никто (directProbeGaveUp)
  if (AppState.tizenAvplayActive && !probeAudio.gaveUp) return -1;
  var index = nativeAudioPref;
  // На webOS выбор ещё передаём конвейеру (webosSubsApply) — там и сбросим
  if (!(AppState.platform === 'webos' && lunaAvailable())) nativeAudioPref = -1;
  if (index >= list.length) return -1;
  for (var i = 0; i < list.length; i++) list[i].enabled = (i === index);
  return index;
}

async function switchAudioTrack(trackIndex) {
  if (trackIndex === currentAudioTrack) { toggleAudioPanel(); return; }
  if (AppState.transcodingFullOnOff) {
    // nativeVideoPlayer обнуляет destroyHls(), а элемент <video> никуда не
    // девается — берём его напрямую, иначе тут падало на null.audioTracks
    switchNativeAudioTrack(AppState.nativeVideoPlayer || getEl('video-player'), trackIndex);
    return;
  }
  // Дорожка уже в потоке — переключает hls.js, ffmpeg не трогаем
  if (AppState.serverTracks) {
    // В окне потока — сразу; вне окна — новое поколение с центром на ней
    var inStream = selectHlsAudio(trackIndex);
    currentAudioTrack = trackIndex;
    AppState.serverTracks.selectedAudio = trackIndex;
    if (currentTimecodeData.hash && currentTimecodeData.fileId) saveAudioPreference(currentTimecodeData.hash, currentTimecodeData.fileId, trackIndex);
    renderAudioTracks();
    toggleAudioPanel();
    if (!inStream) restartServerGeneration('аудиодорожки');
    return;
  }
  thisisseek = false; await saveTimecodeToServer();
  if (currentTimecodeData.hash && currentTimecodeData.fileId) await saveAudioPreference(currentTimecodeData.hash, currentTimecodeData.fileId, trackIndex);
  setPlayerPanel('audio', false);
  var videoPlayer = getEl('video-player'); var currentTime = videoPlayer.currentTime + AppState.seekOffset;
  getEl('playback-overlay').classList.add('active'); document.querySelector('.playback-text').textContent = 'Переключение аудиодорожки...';
  try {
    var parsed = AppState.videoUrl.match(/\/play\/([a-fA-F0-9]+)\/(\d+)/); if (!parsed) return;
    var hash = parsed[1]; var fileId = parsed[2]; var playUrl = AppState.currentTorrserverUrl + '/play/' + hash + '/' + fileId;
    if (AppState.currentStreamId) { await bgFetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST' }); AppState.currentStreamId = null; }
    destroyHls(); await startHLSPlayback(playUrl, currentTime, lastPlaybackFromSearch, currentEpisodeIndex, trackIndex);
    currentAudioTrack = trackIndex; renderAudioTracks();
  } catch (error) { showSwitchFailedBanner('аудиодорожку', error && error.message); }
  finally { getEl('playback-overlay').classList.remove('active'); document.querySelector('.playback-text').textContent = 'Воспроизведение...'; }
}

function switchNativeAudioTrack(videoPlayer, index) {
  nativeAudioPref = -1;   // выбрали руками — сохранённую больше не навязываем
  if (webosAudio.mode && webosSubs.mediaId) {
    lunaCall('selectTrack', { type: 'audio', mediaId: webosSubs.mediaId, index: index });
    // Как Lampa, дублируем выбор в audioTracks: на части прошивок срабатывает
    // только один из двух способов
    var at = videoPlayer && videoPlayer.audioTracks;
    if (at && at.length === webosAudio.list.length) {
      for (var j = 0; j < at.length; j++) at[j].enabled = (j === index);
    }
    currentAudioTrack = index;
    if (currentTimecodeData.hash && currentTimecodeData.fileId) {
      saveAudioPreference(currentTimecodeData.hash, currentTimecodeData.fileId, index);
    }
    renderAudioTracks();
    toggleAudioPanel();
    return;
  }
  if (!videoPlayer) return;
  if (AppState.transcodingFullOnOff && videoPlayer.audioTracks && videoPlayer.audioTracks.length > 0) {
    // Список из разбора файла (Tizen) — дорожка AVPlay этого пункта
    var tv = probeAudio.on ? probeAudio.map[index] : index;
    if (tv === undefined || tv < 0) return;
    for (var i = 0; i < videoPlayer.audioTracks.length; i++) {
      videoPlayer.audioTracks[i].enabled = (i === tv);
    }
    currentAudioTrack = index;
    if (currentTimecodeData.hash && currentTimecodeData.fileId) {
      saveAudioPreference(currentTimecodeData.hash, currentTimecodeData.fileId, index);
    }
    renderAudioTracks();
    toggleAudioPanel();
    return;
  }
}

// ==================== СУБТИТРЫ НА WEBOS: МЕДИАСЕРВИС LUNA ====================
//
// На webOS браузер video.textTracks встроенными дорожками не заполняет — их
// знает медиаконвейер телевизора (luna://com.webos.media), так же делает Lampa:
//   1. ждём video.mediaId — его выдаёт конвейер, когда файл открыт;
//   2. subscribe по mediaId → sourceInfo.programInfo[0].subtitleTrackInfo;
//   3. включение — setSubtitleEnable + selectTrack {type: 'text', index},
//      текст рисует сам телевизор;
//   4. после перемотки конвейер субтитры гасит — включаем заново (seeked).
// В отличие от Lampa подписку не закрываем вызовом unload (тот выгружает
// медиа, и Lampa потом пересоздаёт <video>), а просто отменяем.
var webosSubs = { mediaId: null, timer: null, bridge: null, list: null, enabled: false, index: -1, onSeeked: null, gen: 0 };
// Что произошло при последнем запуске — для раздела «Об устройстве»: без
// телевизора под рукой иначе не понять, на каком шаге оборвалось
var webosSubsDiag = { bridge: '', mediaId: '', waitedMs: 0, responses: 0, keys: '', sourceInfo: false, tracks: null, audio: null, probe: '', error: '' };
// Звук на webOS, как в Lampa: список — у конвейера (audioTrackInfo), он главнее
// video.audioTracks (там ни подписей, ни кодека, ни каналов); переключение —
// selectTrack type 'audio'. Подписи потом добавляет ffprobe (applyDirectProbe)
var webosAudio = { mode: false, list: [] };
window.webosSubsDiag = webosSubsDiag;

function lunaBridgeName() {
  if (window.webOS && webOS.service && webOS.service.request) return 'webOS.service';
  if (typeof window.PalmServiceBridge !== 'undefined') return 'PalmServiceBridge';
  return '';
}

function lunaAvailable() {
  return !!lunaBridgeName();
}

/** Вызов медиасервиса webOS (luna://com.webos.media) */
function lunaCall(method, params, onSuccess, onFailure) {
  return lunaRequest('luna://com.webos.media', method, params, onSuccess, onFailure);
}

/**
 * Вызов любой службы Luna: через webOSTV.js, если он есть, иначе напрямую
 * PalmServiceBridge. quiet — ошибку не писать в диагностику субтитров.
 */
function lunaRequest(uri, method, params, onSuccess, onFailure, quiet) {
  var fail = function (r) {
    var text = (r && (r.errorText || r.errorCode)) || 'ошибка';
    console.warn('webOS luna ' + method + ' failed:', text);
    if (!quiet) webosSubsDiag.error = method + ': ' + text;
    if (onFailure) onFailure(r);
  };
  try {
    if (window.webOS && webOS.service && webOS.service.request) {
      return webOS.service.request(uri, { method: method, parameters: params, onSuccess: onSuccess, onFailure: fail, subscribe: !!params.subscribe });
    }
    if (typeof window.PalmServiceBridge === 'undefined') { fail({ errorText: 'нет PalmServiceBridge' }); return null; }
    var bridge = new window.PalmServiceBridge();
    bridge.onservicecallback = function (msg) {
      var r = {};
      try { r = JSON.parse(msg); } catch (e) { }
      if (r.returnValue === false || r.errorCode) fail(r);
      else if (onSuccess) onSuccess(r);
    };
    bridge.call(uri + '/' + method, JSON.stringify(params));
    return bridge;   // держим ссылку: подписка живёт, пока жив объект
  } catch (e) { fail({ errorText: e.message }); return null; }
}

function webosSubsCancel() {
  if (webosSubs.timer) { clearInterval(webosSubs.timer); webosSubs.timer = null; }
  if (webosSubs.bridge) {
    try { if (typeof webosSubs.bridge.cancel === 'function') webosSubs.bridge.cancel(); } catch (e) { }
    webosSubs.bridge = null;
  }
}

function webosSetSubtitle(index) {
  if (!webosSubs.mediaId) return;
  var on = index >= 0;
  lunaCall('setSubtitleEnable', { mediaId: webosSubs.mediaId, enable: on });
  webosSubs.enabled = on;
  webosSubs.index = index;
  if (on) {
    var mediaId = webosSubs.mediaId;
    // Как в Lampa: дорожку выбираем с паузой после включения — сразу конвейер
    // выбор не принимает
    setTimeout(function () {
      if (webosSubs.mediaId !== mediaId) return;
      lunaCall('selectTrack', { type: 'text', mediaId: mediaId, index: index });
      // Размер — после включения: setSubtitleEnable его, по сообщениям, сбрасывает
      webosSubtitleFontSize(mediaId);
    }, 500);
  }
}

/** sourceInfo пришёл — строим список и включаем сохранённую дорожку */
function webosSubsApply(info) {
  var audio = (info && info.audioTrackInfo) || [];
  webosSubsDiag.audio = audio.length;
  if (audio.length) {
    webosAudio.mode = true;
    webosAudio.list = audio;
    currentAudioTracks = audio.map(function (a, i) {
      var lang = a.language && a.language !== '(null)' ? a.language : '';
      return { title: lang ? (LANG_NAMES[lang] || lang.toUpperCase()) : 'Аудиодорожка ' + (i + 1), language: lang || 'und', channels: a.channels || null, codec: a.codec || null };
    });
    // Какая играет: по audioTracks, если списки совпали, иначе прежний выбор
    var vp = getEl('video-player'), at = vp && vp.audioTracks, playing = -1;
    if (at && at.length === audio.length) {
      for (var k = 0; k < at.length; k++) if (at[k].enabled) { playing = k; break; }
    }
    if (playing < 0) playing = currentAudioTrack >= 0 && currentAudioTrack < audio.length ? currentAudioTrack : 0;
    // Сохранённую дорожку конвейер сам не включит. Как в switchNativeAudioTrack,
    // дублируем в audioTracks: на части прошивок срабатывает только один способ
    if (nativeAudioPref >= 0 && nativeAudioPref < audio.length) {
      playing = nativeAudioPref;
      nativeAudioPref = -1;
      lunaCall('selectTrack', { type: 'audio', mediaId: webosSubs.mediaId, index: playing });
      if (at && at.length === audio.length) {
        for (var m = 0; m < at.length; m++) at[m].enabled = (m === playing);
      }
    }
    currentAudioTrack = playing;
    renderAudioTracks();
  }
  var subs = (info && info.subtitleTrackInfo) || [];
  webosSubs.list = subs;
  webosSubsDiag.tracks = subs.length;
  if (!subs.length) { applyDirectProbe(); return; }
  nativeSubState.mode = 'webos';
  currentSubTracks = subs.map(function (s, i) {
    var lang = s.language && s.language !== '(null)' ? s.language : '';
    return { title: s.title || s.name || (lang ? lang.toUpperCase() : 'Субтитры ' + (i + 1)), language: lang || 'und', format: s.type || '' };
  });
  var want = currentSubtitleTrack >= 0 ? currentSubtitleTrack : nativeSubState.savedPref;
  currentSubtitleTrack = (want >= 0 && want < subs.length) ? want : -1;
  if (currentSubtitleTrack >= 0) webosSetSubtitle(currentSubtitleTrack);
  renderSubtitleTracks();
  applyDirectProbe();
}

// ==================== НАЗВАНИЯ ДОРОЖЕК ПРЯМОГО ФАЙЛА ЧЕРЕЗ FFPROBE ====================
//
// Телевизор (конвейер webOS, textTracks/audioTracks на Vidaa) отдаёт дорожки
// почти без подписей: у субтитров код языка, у звука и того меньше. Как плагин
// Lampa «tracks», берём их у ffprobe (directProbeStart ниже). На webOS ещё и
// так: приложение TorrStream-webOS несёт свою службу
// com.torrstream.app.service с методом ffprobe (статический ffprobe внутри
// ipk, как в Lampa) — она читает заголовок файла с TorrServer и возвращает
// потоки: язык, название, кодек, каналы, «по умолчанию»/«принудительные».
// Сопоставляем по порядку (alignProbeStreams): webOS показывает не все потоки
// файла, но порядок сохраняет.
var directProbe = { gen: 0, streams: null, count: '', serverInfo: null };
// Tizen (AVPlay): список звука — потоки файла как есть, в порядке файла, с
// названиями студий (служба на ТВ, запасной — CUB). AVPlay своих названий не
// знает, а нумерует дорожки не в порядке файла — map: пункт списка → его
// дорожка в audioTracks (-1 — у AVPlay такой нет). gaveUp — разбор не ответил
// никто, сохранённую дорожку включаем по номеру AVPlay
var probeAudio = { on: false, map: [], gaveUp: false };
var LANG_NAMES = {
  rus: 'Русский', ru: 'Русский', eng: 'English', en: 'English', ukr: 'Українська', uk: 'Українська',
  bel: 'Беларуская', kaz: 'Қазақша', jpn: '日本語', ja: '日本語', kor: '한국어', chi: '中文', zho: '中文',
  ger: 'Deutsch', deu: 'Deutsch', fre: 'Français', fra: 'Français', spa: 'Español', ita: 'Italiano',
  por: 'Português', pol: 'Polski', tur: 'Türkçe', ara: 'العربية', heb: 'עברית', hin: 'हिन्दी',
  // Двухбуквенные коды — так язык textTracks называет часть телевизоров
  zh: '中文', ko: '한국어', de: 'Deutsch', fr: 'Français', es: 'Español', it: 'Italiano', pt: 'Português',
  pl: 'Polski', tr: 'Türkçe', ar: 'العربية', he: 'עברית', iw: 'עברית', hi: 'हिन्दी', be: 'Беларуская', kk: 'Қазақша',
  // Полными словами — так язык называют часть плееров телевизоров
  russian: 'Русский', english: 'English', ukrainian: 'Українська', japanese: '日本語', korean: '한국어',
  chinese: '中文', german: 'Deutsch', french: 'Français', spanish: 'Español', italian: 'Italiano'
};
var TEXT_SUB_CODECS = { subrip: 1, srt: 1, ass: 1, ssa: 1, webvtt: 1, mov_text: 1, text: 1 };
// DTS и TrueHD телевизоры LG с 2020 года не играют и в списке звука не показывают
var HIDDEN_AUDIO_CODECS = { dts: 1, truehd: 1, mlp: 1 };

/** Язык для сравнения: у плеера «ru», у ffprobe «rus» — это одно и то же */
function langKey(l) {
  // Обрезаем пробелы: AVPlay на Tizen 5.5 присылает «ru »
  l = String(l || '').toLowerCase().replace(/^\s+|\s+$/g, '');
  if (!l || l === 'und' || l === 'unknown' || l === '(null)') return '';
  return LANG_NAMES[l] || l;
}

/**
 * Какой поток ffprobe стоит за каждой дорожкой плеера. webOS прячет то, что не
 * умеет играть (DTS/TrueHD, картинки-субтитры), поэтому его список — потоки
 * файла с пропусками. По очереди: число совпало как есть → без скрытых кодеков
 * → по порядку с проверкой языка (каждой дорожке — ближайший следующий поток
 * того же языка). null — сопоставить не удалось, подписи не трогаем.
 */
function alignProbeStreams(tracks, streams, hidden) {
  if (!tracks.length || !streams.length) return null;
  if (streams.length === tracks.length && langsAgree(tracks, streams)) return streams;
  var visible = streams.filter(function (s) { return !hidden(s); });
  if (visible.length === tracks.length && langsAgree(tracks, visible)) return visible;
  // Порядок у плеера свой (Vidaa отдаёт textTracks не в порядке файла), но
  // язык дорожки он знает — подбираем поток того же языка
  var byLang = matchProbeByLanguage(tracks, streams, hidden, false);
  if (byLang) return byLang;
  var sources = [visible, streams];
  for (var n = 0; n < sources.length; n++) {
    var src = sources[n], out = [], j = 0;
    if (src.length < tracks.length) continue;
    for (var i = 0; i < tracks.length; i++) {
      var want = langKey(tracks[i].language);
      while (j < src.length && want && langKey(probeLang(src[j])) && langKey(probeLang(src[j])) !== want) j++;
      if (j >= src.length) break;
      out.push(src[j++]);
    }
    if (out.length === tracks.length) return out;
  }
  return null;
}

/** Нет ни одной дорожки, у которой язык плеера и язык потока ffprobe различаются */
function langsAgree(tracks, streams) {
  for (var i = 0; i < tracks.length; i++) {
    var a = langKey(tracks[i].language), b = langKey(probeLang(streams[i]));
    if (a && b && a !== b) return false;
  }
  return true;
}

/**
 * Поток ffprobe каждой дорожке плеера по языку: дорожке с языком — первый
 * ещё не занятый поток того же языка (сначала из видимых, потом из скрытых
 * кодеков), без языка — первый свободный видимый по порядку. Внутри одного
 * языка порядок файла сохраняется. partial: false — не нашлось хоть для
 * одной дорожки → null; true — на её месте null.
 */
function matchProbeByLanguage(tracks, streams, hidden, partial) {
  var used = [], out = [];
  var take = function (want, allowHidden) {
    for (var j = 0; j < streams.length; j++) {
      if (used[j] || (!allowHidden && hidden(streams[j]))) continue;
      if (want && langKey(probeLang(streams[j])) !== want) continue;
      used[j] = true;
      return streams[j];
    }
    return null;
  };
  for (var i = 0; i < tracks.length; i++) {
    var want = langKey(tracks[i].language);
    var pick = take(want, false) || (want ? take(want, true) : null);
    if (!pick && !partial) return null;
    out.push(pick);
  }
  return out;
}

function probeLang(s) {
  var l = (s && s.tags && s.tags.language) || '';
  return l && l !== 'und' ? l : '';
}

function probeTitle(s, kind, i) {
  // Названия бывают в кавычках прямо в файле: "Русский 5.1"
  var t = String((s && s.tags && s.tags.title) || '').replace(/^["'«\s]+|["'»\s]+$/g, '');
  var lang = probeLang(s);
  var name = LANG_NAMES[lang] || (lang ? lang.toUpperCase() : '');
  if (t && name && t.toLowerCase().indexOf(name.toLowerCase()) === -1) return t + ' · ' + name;
  return t || name || ((kind === 'audio' ? 'Аудиодорожка ' : 'Субтитры ') + (i + 1));
}

/**
 * Подписи из ffprobe — в списки плеера. Зовётся несколько раз (пришёл ответ,
 * <video> отдал дорожки, конвейер прислал sourceInfo); уже подписанный список
 * (probed) не трогаем, новый список дорожек приходит без этой метки.
 */
function applyDirectProbe() {
  var streams = directProbe.streams;
  if (!streams) return;
  var audio = [], subs = [];
  for (var i = 0; i < streams.length; i++) {
    if (streams[i].codec_type === 'audio') audio.push(streams[i]);
    else if (streams[i].codec_type === 'subtitle') subs.push(streams[i]);
  }
  var diag = [];
  if (applyProbeAudioList(audio)) {
    diag.push('звук из файла ' + audio.length + ', у AVPlay ' + getEl('video-player').audioTracks.length);
  } else if (currentAudioTracks.length && !currentAudioTracks[0].probed) {
    var a = alignProbeStreams(currentAudioTracks, audio, function (s) { return HIDDEN_AUDIO_CODECS[s.codec_name]; });
    if (a) {
      currentAudioTracks = currentAudioTracks.map(function (t, k) {
        return { title: probeTitle(a[k], 'audio', k), language: probeLang(a[k]) || t.language, channels: a[k].channels || null, codec: (a[k].codec_name || '').toUpperCase(), probed: true };
      });
      renderAudioTracks();
    }
    diag.push('звук ' + currentAudioTracks.length + '/' + audio.length + (a ? ' ✓' : ' ✗'));
  }
  if (currentSubTracks.length && !currentSubTracks[0].probed) {
    // Картинки-субтитры (PGS) webOS может не показывать — их и отбрасываем
    var s = alignProbeStreams(currentSubTracks, subs, function (x) { return !TEXT_SUB_CODECS[x.codec_name]; });
    if (s) {
      currentSubTracks = currentSubTracks.map(function (t, k) {
        var d = s[k].disposition || {};
        return { title: probeTitle(s[k], 'subtitle', k), language: probeLang(s[k]) || t.language, format: (s[k].codec_name || '').toUpperCase(), default: !!d.default, forced: !!d.forced, probed: true };
      });
      renderSubtitleTracks();
    }
    diag.push('субтитры ' + currentSubTracks.length + '/' + subs.length + (s ? ' ✓' : ' ✗'));
  }
  // В «Об устройстве»: сколько дорожек у плеера / в файле и сошлось ли
  if (diag.length) webosSubsDiag.probe = directProbe.count + ' · ' + diag.join(', ');
}

/**
 * Tizen (AVPlay): звук — списком потоков файла как есть (probeAudio). false —
 * не AVPlay, его дорожек ещё нет или в разборе нет звука: тогда как раньше.
 */
function applyProbeAudioList(streams) {
  var vp = getEl('video-player'), at = vp && vp.audioTracks;
  if (!AppState.tizenAvplayActive || !at || !at.length || !streams.length) return false;
  var native = [];
  for (var i = 0; i < at.length; i++) native.push(at[i]);
  probeAudio.map = tizenAudioMap(native, streams);
  probeAudio.on = true;
  currentAudioTracks = streams.map(function (s, k) {
    return { title: probeTitle(s, 'audio', k), language: probeLang(s) || 'und', channels: s.channels || null, codec: (s.codec_name || '').toUpperCase(), probed: true };
  });
  // Сохранённая дорожка ждала этот список (applyNativeAudioPref) — номер в нём
  if (nativeAudioPref >= 0 && nativeAudioPref < streams.length) {
    var tv = probeAudio.map[nativeAudioPref];
    nativeAudioPref = -1;
    if (tv >= 0) for (var j = 0; j < at.length; j++) at[j].enabled = (j === tv);
  }
  currentAudioTrack = 0;
  for (var k = 0; k < at.length; k++) {
    if (!at[k].enabled) continue;
    var item = probeAudio.map.indexOf(k);
    if (item >= 0) currentAudioTrack = item;
    break;
  }
  renderAudioTracks();
  return true;
}

/**
 * Какая дорожка AVPlay за каждым потоком файла. Язык у AVPlay свой («ru»),
 * а кодек и каналы он знает — сначала совпадение всего, потом язык и кодек,
 * потом один язык. Внутри одинаковых — по порядку.
 */
function tizenAudioMap(native, streams) {
  var map = [], used = [];
  var codec = function (c) {
    c = String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return c === 'ec3' ? 'eac3' : c === 'mp4a' ? 'aac' : c;
  };
  var tests = [
    function (t, s) { return codec(t.codec) === codec(s.codec_name) && (parseInt(t.channels, 10) || 0) === (parseInt(s.channels, 10) || 0); },
    function (t, s) { return codec(t.codec) === codec(s.codec_name); },
    function () { return true; }
  ];
  for (var p = 0; p < tests.length; p++) {
    for (var k = 0; k < streams.length; k++) {
      if (map[k] !== undefined) continue;
      var want = langKey(probeLang(streams[k]));
      for (var i = 0; i < native.length; i++) {
        var have = langKey(native[i].language);
        if (used[i] || (want && have && want !== have) || !tests[p](native[i], streams[k])) continue;
        map[k] = i;
        used[i] = true;
        break;
      }
    }
  }
  for (var n = 0; n < streams.length; n++) if (map[n] === undefined) map[n] = -1;
  return map;
}

/** Разбор файла не ответил никто — сохранённую дорожку включаем по номеру AVPlay */
function directProbeGaveUp() {
  if (!AppState.tizenAvplayActive || probeAudio.on) return;
  probeAudio.gaveUp = true;
  var vp = getEl('video-player');
  var index = applyNativeAudioPref(vp);
  if (index < 0) return;
  currentAudioTrack = index;
  renderAudioTracks();
}

/**
 * Спросить ffprobe о файле, который сейчас назначен <video> («Полностью
 * отключить транскодирование»). Не ответил никто — подписи остаются
 * «Аудиодорожка N» и «Субтитры N». Подписи сервера — только когда поток идёт
 * через сервер (там они из /api/file/info), здесь их нет.
 *  - webOS: сначала своя служба ffprobe (ниже), CUB — если она не ответила;
 *  - остальные платформы: сразу сторонний сервис ffprobe, тот же, что у плагина Lampa
 *    «tracks» (cub.red/plugin/tracks): WebSocket, в адресе хэш раздачи и
 *    номер файла, в ответ один JSON с streams. Файл он берёт из раздачи сам,
 *    поэтому TorrServer может быть любым, хоть локальным. Со страницы по
 *    https ws:// заблокирован — тогда просто нет подписей;
 *  - webOS: ещё служба ffprobe приложения (ниже). Доменное имя ей не
 *    разрешить, но с локальным TorrServer или TorrServer по IP она отвечает
 *    и без стороннего сервиса.
 */
var DIRECT_PROBE_WS = 'ws://185.204.0.61:8080/';
var DIRECT_PROBE_TIMEOUT_MS = 15000;
// webOS: сколько ждать свою службу ffprobe, прежде чем спросить CUB
var DIRECT_PROBE_LUNA_WAIT_MS = 8000;

// Служба ffprobe на Samsung Tizen (внутри TorrStream-Tizen.wgt), см. directProbeStart.
// Страница TorrStream на телевизоре до localhost не достаёт — как и до TorrServer
// на самом ТВ, если указать его как localhost, — а по IP телевизора достаёт.
// Поэтому сначала IP телевизора, потом 127.0.0.1; сработавший адрес помним
// Службы на Tizen: 8096 — разбор заголовка MKV/MP4 на C# (служба
// online.torrstream.tracks внутри TorrStream-Tizen.wgt, работает и на 5.5);
// 8095 — ffprobe (отдельный TorrStream-ffprobe.wgt, Tizen 6+)
var TIZEN_TRACKS_PORT = 8096;
var TIZEN_FFPROBE_PORT = 8095;
var TIZEN_FFPROBE_WAIT_MS = 20000;
var tizenServiceBase = {};   // порт → адрес, по которому служба ответила
var tizenOwnIp = '';

/** IP телевизора: webapis.network (сразу) или tizen.systeminfo (ниже, асинхронно) */
function detectTizenIp() {
  if (tizenOwnIp) return tizenOwnIp;
  try {
    if (window.webapis && webapis.network && typeof webapis.network.getIp === 'function') tizenOwnIp = webapis.network.getIp() || '';
  } catch (e) { }
  return tizenOwnIp;
}
if (window.AppState && AppState.tizenApp && window.tizen && tizen.systeminfo) {
  ['ETHERNET_NETWORK', 'WIFI_NETWORK'].forEach(function (prop) {
    try {
      tizen.systeminfo.getPropertyValue(prop, function (n) {
        if (!tizenOwnIp && n && n.ipAddress && n.ipAddress !== '0.0.0.0') tizenOwnIp = n.ipAddress;
      }, function () { });
    } catch (e) { }
  });
}

function tizenServiceBases(port) {
  if (tizenServiceBase[port]) return [tizenServiceBase[port]];
  var list = [], ip = detectTizenIp();
  if (ip) list.push('http://' + ip + ':' + port);
  list.push('http://127.0.0.1:' + port);
  return list;
}

/**
 * GET к службе на телевизоре: по очереди её адреса (IP телевизора, 127.0.0.1);
 * нет соединения — следующий. cb(ошибка, xhr, адрес). Ответ пришёл — адрес помним
 */
function tizenServiceGet(port, path, timeoutMs, cb) {
  var bases = tizenServiceBases(port), i = 0;
  var next = function (lastErr) {
    if (i >= bases.length) { cb(lastErr || 'служба не установлена или не запущена', null, null); return; }
    var base = bases[i++], x = new XMLHttpRequest();
    try {
      x.open('GET', base + path, true);
      x.timeout = timeoutMs;
      x.onload = function () { tizenServiceBase[port] = base; cb(null, x, base); };
      x.onerror = function () { next('служба не установлена или не запущена'); };
      x.ontimeout = function () { cb('нет ответа', null, base); };
      x.send();
    } catch (e) { next(e.message); }
  };
  next(null);
}
window.tizenServiceGet = tizenServiceGet;
window.TIZEN_TRACKS_PORT = TIZEN_TRACKS_PORT;
window.TIZEN_FFPROBE_PORT = TIZEN_FFPROBE_PORT;

/**
 * Адрес файла для своей службы ffprobe (webOS, Tizen): она читает его прямо с
 * TorrServer. localhost — 127.0.0.1: статическому ffprobe имена не разрешить
 * даже localhost («Failed to resolve hostname localhost» на webOS 25 со
 * встроенным TorrServer). Basic-авторизация TorrServer — в адрес: службе
 * заголовки не передать
 */
function directProbeUri(hash, fileId) {
  var playURL = AppState.currentTorrserverUrl + '/stream?link=' + hash + '&index=' + fileId + '&play=play';
  var uri = playURL.replace(/^(https?:\/\/)localhost(?=[:\/]|$)/i, '$1127.0.0.1');
  if (AppState.authEnabled && AppState.authLogin) {
    uri = uri.replace(/^(https?:\/\/)/, '$1' + encodeURIComponent(AppState.authLogin) + ':' + encodeURIComponent(AppState.authPassword || '') + '@');
  }
  return uri;
}

/**
 * Сведения о файле с сервера (services/file-info.js) — в вид потоков ffprobe,
 * как их ждёт applyDirectProbe. Сервер подставляет «Дорожка N»/«Субтитры N»
 * и «unknown» вместо пустых тегов — такие не считаем названием.
 */
function serverInfoStreams(entry, hash, fileId) {
  if (!entry || entry.hash !== hash || String(entry.fileId) !== String(fileId) || !entry.info) return [];
  var info = entry.info, out = [];
  var clean = function (v, generic) { v = v || ''; return generic.test(v) || v === 'unknown' ? '' : v; };
  (info.audio || []).forEach(function (a) {
    out.push({ codec_type: 'audio', codec_name: a.codec || '', channels: a.channels || null,
      tags: { language: clean(a.language, /^$/), title: clean(a.title, /^Дорожка \d+$/) },
      disposition: { default: a['default'] ? 1 : 0 } });
  });
  (info.subtitles || []).forEach(function (t) {
    out.push({ codec_type: 'subtitle', codec_name: t.codec || t.format || '',
      tags: { language: clean(t.language, /^$/), title: clean(t.title, /^Субтитры \d+$/) },
      disposition: { default: t['default'] ? 1 : 0, forced: t.forced ? 1 : 0 } });
  });
  return out;
}

function directProbeStart() {
  directProbe.streams = null;
  directProbe.count = '';
  probeAudio.on = false; probeAudio.map = []; probeAudio.gaveUp = false;
  var gen = ++directProbe.gen;
  var hash = currentTimecodeData.hash, fileId = currentTimecodeData.fileId;
  var done = function (streams, via) {
    if (gen !== directProbe.gen || directProbe.streams || !streams || !streams.length) return;
    directProbe.streams = streams;
    directProbe.count = 'потоков: ' + streams.length + ' (' + via + ')';
    webosSubsDiag.probe = directProbe.count;
    directPlaybackDiag.probe = directProbe.count;
    // Прямой файл не на webOS — список субтитров может собраться из ffprobe
    if (AppState.transcodingFullOnOff && nativeSubState.mode !== 'webos' && AppState.platform !== 'webos' &&
      AppState.currentScreen === 'player') refreshNativeSubtitles(getEl('video-player'));
    else applyDirectProbe();
  };
  if (!hash || fileId === undefined || fileId === null) return;

  // Сервер TorrStream этот файл уже разбирал (его база file_info, общая для
  // всех, приходит с /api/playback/prepare) — названия могут прийти оттуда:
  // Full, Forced, SDH и т. п. — это теги title внутри файла, AVPlay на Tizen
  // и <video> их не знают. Где брать сначала:
  //  - Tizen — свои службы на телевизоре (ниже), запасной — CUB (он разбирает
  //    тот же файл раздачи, что играет телевизор, а база сервера бывает от
  //    чужого TorrServer), сервер — только если и CUB не ответил;
  //  - остальные — сервер, CUB тогда не нужен.
  var fromServer = serverInfoStreams(directProbe.serverInfo, hash, fileId);
  var cubFirst = AppState.platform === 'tizen';
  if (fromServer.length && !cubFirst) { done(fromServer, 'сервер'); return; }
  var serverFallback = function () {
    if (fromServer.length) done(fromServer, 'сервер');
    else if (gen === directProbe.gen && !directProbe.streams) directProbeGaveUp();
  };

  // Сервис CUB: на webOS — запасной (после своей службы), иначе — сразу
  var cubStarted = false;
  var startCub = function () {
    if (cubStarted || gen !== directProbe.gen || directProbe.streams || typeof WebSocket !== 'function') return;
    cubStarted = true;
    var socket = null, timer = null;
    var finish = function () {
      clearTimeout(timer);
      try { if (socket) socket.close(); } catch (e) { }
      socket = null;
    };
    directPlaybackDiag.probe = 'сервис: запрос…';
    try {
      socket = new WebSocket(DIRECT_PROBE_WS + '?' + hash + '&index=' + fileId);
      socket.onmessage = function (event) {
        var json = null;
        try { json = JSON.parse(event.data); } catch (e) { }
        finish();
        if (!(json && json.streams && json.streams.length) && !directProbe.streams) {
          directPlaybackDiag.probe = 'сервис: пустой ответ';
          serverFallback();
          return;
        }
        done(json && json.streams, 'сервис');
      };
      socket.onerror = function () {
        finish();
        if (!directProbe.streams) directPlaybackDiag.probe = 'сервис: ошибка соединения' + (location.protocol === 'https:' ? ' (страница по https)' : '');
        serverFallback();
      };
      timer = setTimeout(function () {
        finish();
        if (!directProbe.streams) directPlaybackDiag.probe = 'сервис: нет ответа за ' + (DIRECT_PROBE_TIMEOUT_MS / 1000) + ' с';
        serverFallback();
      }, DIRECT_PROBE_TIMEOUT_MS);
    } catch (e) { finish(); directPlaybackDiag.probe = 'сервис: ' + e.message; serverFallback(); }
  };

  // Samsung Tizen: свои службы на телевизоре, читают файл прямо с TorrServer.
  // По очереди: 1) разбор заголовка MKV/MP4 на C# (8096, служба внутри
  // TorrStream-Tizen.wgt — работает и на Tizen 5.5, где ffprobe запускать
  // нельзя); 2) ffprobe (8095, отдельный TorrStream-ffprobe.wgt, Tizen 6+) —
  // для прочих контейнеров; 3) CUB. Нет службы — отказ соединения сразу
  if (AppState.tizenApp) {
    // TorrServer без предзагрузки отдаёт начало файла не сразу — даём службам
    // 20 с, потом параллельно CUB (кто первый — того и названия)
    setTimeout(startCub, TIZEN_FFPROBE_WAIT_MS);
    directPlaybackDiag.probe = 'на ТВ: запрос…';
    directPlaybackDiag.local = 'запрос…';
    var asked = Date.now();
    var probePath = '/ffprobe?url=' + encodeURIComponent(directProbeUri(hash, fileId));
    var localWhy = [];
    // Итог служб — отдельно (local): CUB мог ответить первым, а ответ служб
    // всё равно нужен в «Об устройстве» (app.js, строка «Дорожки на ТВ»)
    var localNote = function (text) {
      if (gen === directProbe.gen) directPlaybackDiag.local = text + ' за ' + Math.round((Date.now() - asked) / 100) / 10 + ' с';
    };
    // Одна служба: ответила потоками — готово, иначе причина и следующая
    var askService = function (port, label, next) {
      // служба ждёт TorrServer до 60 с
      tizenServiceGet(port, probePath, 70000, function (err, tx, base) {
        var parsed = null;
        if (!err) { try { parsed = JSON.parse(tx.responseText || '{}'); } catch (e) { } }
        if (parsed && parsed.streams && parsed.streams.length) {
          localNote(label + ': потоков ' + parsed.streams.length + ' (' + base.replace(/^http:\/\//, '') + ')');
          done(parsed.streams, label);
          return;
        }
        localWhy.push(label + ': ' + (err || (parsed && parsed.error) || ('пустой ответ, HTTP ' + tx.status)));
        next();
      });
    };
    askService(TIZEN_TRACKS_PORT, 'MKV/MP4 на ТВ', function () {
      askService(TIZEN_FFPROBE_PORT, 'ffprobe на ТВ', function () {
        localNote('ошибка: ' + localWhy.join('; '));
        if (gen !== directProbe.gen || directProbe.streams) return;
        directPlaybackDiag.probe = localWhy.join('; ');
        startCub();
      });
    });
    return;
  }

  if (AppState.platform !== 'webos' || !lunaAvailable()) { startCub(); return; }
  // Своя служба молчит — не ждём бесконечно, идём в CUB
  setTimeout(startCub, DIRECT_PROBE_LUNA_WAIT_MS);
  var uri = directProbeUri(hash, fileId);
  webosSubsDiag.probe = 'запрос…';
  lunaRequest('luna://com.torrstream.app.service', 'ffprobe', { uri: uri }, function (r) {
    if (gen !== directProbe.gen) return;
    var parsed = null;
    try { parsed = JSON.parse(r.data || '{}'); } catch (e) { }
    if (!parsed || !parsed.streams || !parsed.streams.length) {
      if (!directProbe.streams) webosSubsDiag.probe = 'служба: пустой ответ';
      startCub();
      return;
    }
    done(parsed.streams, 'служба');
  }, function (r) {
    if (gen !== directProbe.gen || directProbe.streams) return;
    webosSubsDiag.probe = 'служба: ошибка ' + ((r && (r.errorText || r.errorCode)) || '?');
    startCub();
  }, true);
}


/**
 * Файл назначен <video> — ищем его mediaId и подписываемся у конвейера.
 * Зовём сразу после src/load(), а не по loadedmetadata: sourceInfo конвейер
 * присылает, когда открывает файл, и к loadedmetadata его уже не повторит —
 * Lampa поэтому ловит mediaId с самого начала. staleId — mediaId прошлого
 * файла: тот же элемент <video>, и пока конвейер не выдал новый, он висит там.
 */
function webosSubsStart(videoPlayer, staleId) {
  webosSubsReset();
  if (AppState.platform !== 'webos' || !videoPlayer) return;
  webosSubsDiag.bridge = lunaBridgeName() || 'нет';
  webosSubsDiag.mediaId = ''; webosSubsDiag.waitedMs = 0; webosSubsDiag.responses = 0;
  webosSubsDiag.keys = ''; webosSubsDiag.sourceInfo = false; webosSubsDiag.tracks = null; webosSubsDiag.error = '';
  if (!lunaAvailable()) return;
  var gen = ++webosSubs.gen;
  var startedAt = Date.now();
  webosSubs.timer = setInterval(function () {
    var waited = Date.now() - startedAt;
    webosSubsDiag.waitedMs = waited;
    if (gen !== webosSubs.gen || AppState.currentScreen !== 'player' || waited > 30000) { webosSubsCancel(); return; }
    var id = videoPlayer.mediaId;
    // webOS 25 до появления настоящего отдаёт строку-заглушку
    // «<invalid mediaId>» — с ней subscribe отвечает ошибкой; ждём дальше,
    // а в диагностике показываем, что видели
    if (id && /^<|invalid/i.test(String(id))) { webosSubsDiag.mediaId = String(id) + ' (ждём)'; return; }
    // Прошлый mediaId принимаем, только если нового за 3 с так и не появилось:
    // конвейер может и переиспользовать его
    if (!id || (id === staleId && waited < 3000)) return;
    clearInterval(webosSubs.timer); webosSubs.timer = null;
    webosSubs.mediaId = id;
    webosSubsDiag.mediaId = String(id);
    var deadline = setTimeout(function () {
      if (gen === webosSubs.gen && !webosSubs.list) {
        if (!webosSubsDiag.error) webosSubsDiag.error = 'sourceInfo не пришёл за 20 с';
        webosSubsCancel();
      }
    }, 20000);
    webosSubs.bridge = lunaCall('subscribe', { mediaId: id, subscribe: true }, function (r) {
      if (gen !== webosSubs.gen || webosSubs.list) return;
      webosSubsDiag.responses++;
      if (r && !webosSubsDiag.keys) webosSubsDiag.keys = Object.keys(r).join(',');
      if (!r || !r.sourceInfo) return;
      webosSubsDiag.sourceInfo = true;
      clearTimeout(deadline);
      webosSubsApply((r.sourceInfo.programInfo || [])[0] || {});
      webosSubsCancel();   // дорожки получены, подписка больше не нужна
    });
  }, 300);
  // После перемотки конвейер выключает субтитры — включаем выбранную заново
  webosSubs.onSeeked = function () {
    if (webosSubs.enabled && webosSubs.index >= 0) webosSetSubtitle(webosSubs.index);
  };
  videoPlayer.addEventListener('seeked', webosSubs.onSeeked);
}

function webosSubsReset() {
  webosSubs.gen++;
  webosSubsCancel();
  var v = getEl('video-player');
  if (v && webosSubs.onSeeked) v.removeEventListener('seeked', webosSubs.onSeeked);
  webosSubs.onSeeked = null;
  webosSubs.mediaId = null;
  webosSubs.list = null;
  webosSubs.enabled = false;
  webosSubs.index = -1;
  webosAudio.mode = false;
  webosAudio.list = [];
  if (nativeSubState.mode === 'webos') nativeSubState.mode = 'tracks';
}

// ==================== СУБТИТРЫ ПРЯМОГО ФАЙЛА ====================
//
// В режиме «Полностью отключить транскодирование» (и всегда на webOS) файл
// играет сам <video>, и субтитры из MKV сервер не вшивает — их некому, а
// вытащить их отдельно нельзя: реплики разбросаны по всему файлу, пришлось бы
// скачать раздачу целиком. Но медиаконвейер телевизора (Vidaa и др.) сам
// разбирает контейнер и отдаёт встроенные дорожки списком video.textTracks —
// так же, как звук списком audioTracks. Chrome и Edge на ПК встроенные
// субтитры MKV так не отдают: там список пуст, «Нет субтитров» — честно.
//
// Как в Lampa (src/interaction/player/video.js, loaded): выбранной дорожке
// mode = 'showing', остальным 'disabled', текст рисует сам браузер.
// Раньше ставили 'hidden' и рисовали текст своим блоком по cuechange, но
// конвейер телевизора реплики в режиме 'hidden' может и не присылать — тогда
// дорожка выбрана, а на экране пусто. Размер текста — браузерный: растёт
// с высотой видео. Названия дорожкам подписывает applyDirectProbe (выше).
var nativeSubState = { tracks: [], savedPref: -1, listening: false, mode: 'tracks', waitTimer: null, snapTimer: null, fromProbe: false, tvIndex: -1 };

function collectNativeTextTracks(videoPlayer) {
  var list = videoPlayer && videoPlayer.textTracks, out = [];
  if (!list) return out;
  for (var i = 0; i < list.length; i++) {
    // Главы и описания — не субтитры
    if (list[i].kind === 'chapters' || list[i].kind === 'descriptions') continue;
    out.push(list[i]);
  }
  return out;
}

/**
 * Встроенная отрисовка кладёт текст к нижнему краю кадра — под открытой
 * панелью управления он ложится на перемотку и тонет в её затемнении. Пока
 * панель видна, у <video> класс cues-raised, и styles.css поднимает контейнер
 * реплик над ней. Видимость панели — её класс idle-hidden: панель показывают и
 * прячут и player.js, и control.js, и таймер бездействия.
 */
function watchCuesRaise(videoPlayer) {
  var controls = getEl('controls-container');
  if (!videoPlayer || !controls || videoPlayer._cuesRaiseWatched || typeof MutationObserver !== 'function') return;
  videoPlayer._cuesRaiseWatched = true;
  var sync = function () { videoPlayer.classList.toggle('cues-raised', !controls.classList.contains('idle-hidden')); };
  new MutationObserver(sync).observe(controls, { attributes: true, attributeFilter: ['class'] });
  sync();
}

/**
 * Включить дорожку по номеру — как плагин Lampa «tracks»: дорожку <video>
 * ищем в момент выбора, а не по списку, собранному при запуске. Список
 * субтитров может быть из ffprobe (refreshNativeSubtitles), а телевизор
 * отдаёт textTracks с опозданием и не всегда шлёт addtrack. true — дорожка с
 * таким номером у <video> есть и включена.
 */
function applyNativeSubtitle(index) {
  var tracks = collectNativeTextTracks(getEl('video-player'));
  nativeSubState.tracks = tracks;
  var tv = nativeTrackForItem(index, tracks);
  for (var i = 0; i < tracks.length; i++) {
    try { tracks[i].mode = (i === tv) ? 'showing' : 'disabled'; } catch (e) { }
  }
  var total = Math.max(tracks.length, currentSubTracks ? currentSubTracks.length : 0);
  currentSubtitleTrack = (index >= 0 && index < total) ? index : -1;
  nativeSubState.tvIndex = tv;
  return tv >= 0;
}

/** Картинки (PGS, VobSub) часть телевизоров в textTracks не отдаёт */
function isImageSubStream(s) { return !TEXT_SUB_CODECS[s.codec_name]; }

/**
 * Номер дорожки <video> для пункта списка. Список из дорожек <video> — тот же
 * номер. Список из ffprobe — дорожку ищем по языку (matchProbeByLanguage):
 * порядок у телевизора бывает не как в файле, и по одному номеру пункт
 * «English» включал русскую дорожку. -1 — такой дорожки у <video> (пока) нет.
 */
function nativeTrackForItem(index, tracks) {
  if (index < 0) return -1;
  if (!nativeSubState.fromProbe) return index < tracks.length ? index : -1;
  var probeSubs = directProbeSubs();
  var map = matchProbeByLanguage(tracks, probeSubs, isImageSubStream, true);
  for (var i = 0; i < map.length; i++) if (map[i] && map[i] === probeSubs[index]) return i;
  // Ни один язык дорожек плеера не совпал с языками файла — плеер называет
  // их по-своему или не называет (AVPlay на Tizen 5.5: субтитры перестали
  // включаться, когда список стал из ffprobe). Тогда сопоставление по языку
  // бессмысленно — по номеру, как было до списка из ffprobe
  if (!langsOverlap(tracks, probeSubs)) return index < tracks.length ? index : -1;
  return -1;
}

/** Есть ли у дорожек плеера хоть один язык из языков потоков ffprobe */
function langsOverlap(tracks, streams) {
  var have = {};
  for (var j = 0; j < streams.length; j++) { var l = langKey(probeLang(streams[j])); if (l) have[l] = true; }
  for (var i = 0; i < tracks.length; i++) { var k = langKey(tracks[i].language); if (k && have[k]) return true; }
  return false;
}

/** Субтитры файла по ответу ffprobe (directProbeStart); нет ответа — [] */
function directProbeSubs() {
  var streams = directProbe.streams || [], out = [];
  for (var i = 0; i < streams.length; i++) if (streams[i].codec_type === 'subtitle') out.push(streams[i]);
  return out;
}

/**
 * Список дорожек у <video> сменился (новый файл, дорожка дописалась) или
 * пришёл ответ ffprobe.
 *
 * Субтитров в файле по ffprobe больше, чем отдал <video>, — список берём из
 * ffprobe, как плагин Lampa: номер пункта = номер дорожки субтитров в файле, а
 * включает её applyNativeSubtitle по тому же номеру, когда телевизор её
 * отдаст. Не на webOS: там список ведёт медиасервис, а textTracks пустые.
 */
function refreshNativeSubtitles(videoPlayer) {
  if (!AppState.transcodingFullOnOff) return;
  // На webOS список даёт медиасервис (webosSubsStart), textTracks там пустые
  if (nativeSubState.mode === 'webos') return;
  updateDirectTrackDiag(videoPlayer);
  var tracks = collectNativeTextTracks(videoPlayer);
  nativeSubState.tracks = tracks;
  var probeSubs = AppState.platform !== 'webos' ? directProbeSubs() : [];
  // AVPlay на Tizen (tizen-avplay.js) дорожек может насчитать больше, чем их
  // в файле (проверено: 5 против 4 у ffprobe), и названий у его дорожек нет —
  // тогда подписи по номеру не сходятся вовсе. Список ffprobe там главный
  // всегда: пункты — дорожки файла, а включает пункт дорожку AVPlay того же
  // языка по порядку (nativeTrackForItem)
  nativeSubState.fromProbe = probeSubs.length > tracks.length ||
    (!!AppState.tizenAvplayActive && probeSubs.length > 0);
  if (nativeSubState.fromProbe) {
    currentSubTracks = probeSubs.map(function (st, k) {
      var d = st.disposition || {};
      return { title: probeTitle(st, 'subtitle', k), language: probeLang(st) || 'und', format: (st.codec_name || '').toUpperCase(), default: !!d.default, forced: !!d.forced, probed: true };
    });
  } else {
    currentSubTracks = tracks.map(function (t, i) {
      return { title: t.label || ('Субтитры ' + (i + 1)), language: t.language || 'und', format: '' };
    });
  }
  // Уже выбранная в этом сеансе (соседняя серия) или сохранённая для файла
  var want = currentSubtitleTrack >= 0 ? currentSubtitleTrack : nativeSubState.savedPref;
  want = want >= 0 && want < currentSubTracks.length ? want : -1;
  // Сохранённой дорожки у <video> пока нет (список из ffprobe) — дождёмся её
  if (!applyNativeSubtitle(want) && want >= 0) waitNativeSubtitle(want);
  renderSubtitleTracks();
  // Подписи из ffprobe списку от <video> и дорожкам звука
  applyDirectProbe();
}

/** Слушаем появление дорожек: часть браузеров отдаёт их позже loadedmetadata */
function listenNativeTextTracks(videoPlayer) {
  watchCuesRaise(videoPlayer);
  if (nativeSubState.listening || !videoPlayer || !videoPlayer.textTracks ||
    typeof videoPlayer.textTracks.addEventListener !== 'function') return;
  nativeSubState.listening = true;
  var onChange = function () {
    if (AppState.transcodingFullOnOff && AppState.currentScreen === 'player') refreshNativeSubtitles(videoPlayer);
  };
  videoPlayer.textTracks.addEventListener('addtrack', onChange);
  videoPlayer.textTracks.addEventListener('removetrack', onChange);
}

/**
 * Выбрали пункт, а у <video> такой дорожки ещё нет: addtrack приходит не
 * везде, поэтому полминуты раз в секунду проверяем сами и включаем, как
 * только появится
 */
var NATIVE_SUB_WAIT_MS = 30000;
function waitNativeSubtitle(index) {
  clearInterval(nativeSubState.waitTimer);
  var started = Date.now();
  nativeSubState.waitTimer = setInterval(function () {
    var gone = AppState.currentScreen !== 'player' || currentSubtitleTrack !== index;
    if (gone || Date.now() - started > NATIVE_SUB_WAIT_MS) { clearInterval(nativeSubState.waitTimer); return; }
    if (applyNativeSubtitle(index)) {
      clearInterval(nativeSubState.waitTimer);
      updateDirectTrackDiag(getEl('video-player'));
    }
  }, 1000);
}

/**
 * Что с дорожками через 3 с после выбора — в «Об устройстве»: какой пункт
 * выбран, какую дорожку <video> он включил, и по каждой дорожке язык, режим,
 * число реплик и текущий текст. По снимку видно, совпадает ли язык выбранного
 * пункта с тем, что телевизор показывает на самом деле.
 */
function snapshotNativeSubs() {
  var tracks = collectNativeTextTracks(getEl('video-player'));
  var item = currentSubTracks && currentSubTracks[currentSubtitleTrack];
  var parts = [];
  for (var i = 0; i < tracks.length; i++) {
    var t = tracks[i], cues = null, active = null;
    try { cues = t.cues ? t.cues.length : null; active = t.activeCues; } catch (e) { }
    var txt = active && active.length ? String(active[0].text || '').replace(/\s+/g, ' ').slice(0, 24) : '';
    parts.push((i + 1) + ' ' + (t.language || '?') + (t.label ? ' «' + t.label + '»' : '') + ' ' + t.mode +
      (cues !== null ? ' реплик ' + cues : '') + (txt ? ' «' + txt + '»' : ''));
  }
  directPlaybackDiag.subs = 'пункт ' + (currentSubtitleTrack + 1) + (item ? ' «' + item.title + '»' : '') +
    ' → дорожка ' + (nativeSubState.tvIndex >= 0 ? nativeSubState.tvIndex + 1 : 'нет') +
    (nativeSubState.fromProbe ? ' (список из ffprobe)' : '') + ' | ' + parts.join(' | ');
}

/** Новый файл или выход из плеера: снять подписку и спрятать текст */
function resetNativeSubtitles() {
  webosSubsReset();
  clearInterval(nativeSubState.waitTimer);
  clearTimeout(nativeSubState.snapTimer);
  applyNativeSubtitle(-1);
  nativeSubState.tracks = [];
}

function switchNativeSubtitleTrack(index) {
  if (nativeSubState.mode === 'webos') {
    webosSetSubtitle(index);
    currentSubtitleTrack = index >= 0 ? index : -1;
  } else {
    if (!applyNativeSubtitle(index) && index >= 0) waitNativeSubtitle(index);
    clearTimeout(nativeSubState.snapTimer);
    nativeSubState.snapTimer = setTimeout(snapshotNativeSubs, 3000);
  }
  if (currentTimecodeData.hash && currentTimecodeData.fileId) {
    saveSubtitlePreference(currentTimecodeData.hash, currentTimecodeData.fileId, currentSubtitleTrack);
  }
  renderSubtitleTracks();
  toggleSubtitlesPanel();
}

function toggleAudioPanel() { return togglePlayerPanel('audio'); }

function setupAudioButton() {
  // Своей кнопки на панели управления у аудио нет — открывается из меню
  // «Аудио и субтитры» (setupTracksButton) или красной кнопкой пульта
  var closeAudioBtn = getEl('close-audio');
  var audioPanel = getEl('audio-panel');

  if (!closeAudioBtn || !audioPanel) return;

  // Делегирование кликов по списку аудиодорожек
  setupAudioListDelegation();

  closeAudioBtn.addEventListener('click', function () {
    setPlayerPanel('audio', false);
    resetMouseIdleTimer();
  });

  setupPlayerPanelsOutsideClick();
}

async function saveAudioPreference(hash, fileId, audioTrack) {
  try {
    var savedClientId = localStorage.getItem('clientId');
    var response = await bgFetch(SERVER_URL + '/api/audio/pref/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hash: hash, fileId: fileId, audioTrack: audioTrack, clientId: savedClientId }) });
  } catch (error) { }
}

/**
 * Сохранённые дорожки — аудио и субтитры — одним запросом.
 *
 * На сервере обе лежат в одной строке media_prefs, и раздельные маршруты
 * читали её дважды одним и тем же запросом. Здесь одно обращение.
 *
 * Откат на пару старых маршрутов нужен не для красоты: index.html тянет js с
 * зеркала, а SERVER_URL — это локальный сервер, поэтому свежий клиент
 * регулярно встречается со старым серверным бинарником. Без отката там молча
 * подставилась бы дорожка по умолчанию, и понять это можно было бы только на слух.
 */
async function loadMediaPreferences(hash, fileId) {
  var savedClientId = localStorage.getItem('clientId');
  var query = '?hash=' + hash + '&fileId=' + fileId + '&clientId=' + encodeURIComponent(savedClientId);
  try {
    var response = await fetchWithTimeout(SERVER_URL + '/api/media/prefs/get' + query);
    if (response.ok) {
      var data = await response.json();
      if (data.success) {
        return {
          audioTrack: data.audioTrack !== null && data.audioTrack !== undefined ? data.audioTrack : null,
          subtitleTrack: data.subtitleTrack !== null && data.subtitleTrack !== undefined ? data.subtitleTrack : -1
        };
      }
    }
  } catch (error) { }
  var pair = await Promise.all([loadAudioPreference(hash, fileId), loadSubtitlePreference(hash, fileId)]);
  return { audioTrack: pair[0], subtitleTrack: pair[1] };
}

/**
 * Всё для старта воспроизведения одним запросом: сведения о файле,
 * сохранённые дорожки и (если wantTimecode) позиция просмотра.
 *
 * Раньше это были /api/file/info, /api/media/prefs/get и /api/timecode/get
 * по одному и тому же hash+fileId. Имя файла сюда не входит — его
 * getFileNameByHash берёт из списка торрентов на клиенте.
 *
 * Откат на старые запросы — в двух случаях по-разному:
 *  - маршрута нет (404 — старый серверный бинарник, а js пришёл с зеркала
 *    свежий) → все три прежних запроса;
 *  - новый маршрут не уложился в таймаут → только дорожки и позицию. Таймаут
 *    значит, что сервер всё ещё пробует файл, и повтор /api/file/info стоил
 *    бы ещё до минуты ожидания ради того же результата.
 *
 * @returns {Promise<{fileInfo: object|null, audioTrack: number|null, subtitleTrack: number, timecode: number|null}>}
 */
async function loadPlaybackPrepare(hash, fileId, wantTimecode) {
  // Samsung Tizen: названия дорожек — свои службы на телевизоре (8096, 8095),
  // потом CUB (directProbeStart), проба сервера не нужна. А сервер TorrStream
  // пробует TorrServer из настроек аккаунта, до TorrServer на телевизоре он не
  // достаёт, и запуск ждал таймаут (DIRECT_PREPARE_TIMEOUT_MS). Таймкод и
  // выбранные дорожки — сразу отдельными запросами, без пробы файла
  if (AppState.tizenApp) {
    var quick = await Promise.all([
      loadMediaPreferences(hash, fileId),
      wantTimecode ? loadTimecodeFromServer(hash, fileId) : Promise.resolve(null)
    ]);
    var quickPrefs = quick[0] || {};
    return {
      fileInfo: null,
      audioTrack: quickPrefs.audioTrack !== undefined ? quickPrefs.audioTrack : null,
      subtitleTrack: quickPrefs.subtitleTrack !== undefined ? quickPrefs.subtitleTrack : -1,
      timecode: quick[1]
    };
  }
  var savedClientId = localStorage.getItem('clientId');
  var url = SERVER_URL + '/api/playback/prepare?hash=' + hash + '&fileId=' + fileId +
    '&clientId=' + encodeURIComponent(savedClientId) + (wantTimecode ? '&timecode=1' : '');
  var timedOut = false;
  try {
    var needsFileInfo = !AppState.transcodingOnOff && !AppState.transcodingFullOnOff;
    var response = await fetchWithTimeout(url, null, needsFileInfo ? FILE_INFO_FETCH_TIMEOUT_MS : DIRECT_PREPARE_TIMEOUT_MS);
    if (response.ok) {
      var data = await response.json();
      if (data && data.success) {
        if (data.fileInfoError) console.warn('⚠️ /api/playback/prepare: ' + data.fileInfoError);
        var prefs = data.prefs || {};
        return {
          fileInfo: data.fileInfo || null,
          audioTrack: prefs.audioTrack !== null && prefs.audioTrack !== undefined ? prefs.audioTrack : null,
          subtitleTrack: prefs.subtitleTrack !== null && prefs.subtitleTrack !== undefined ? prefs.subtitleTrack : -1,
          timecode: wantTimecode ? (data.timecode || 0) : null
        };
      }
    }
    console.warn('⚠️ /api/playback/prepare вернул HTTP ' + response.status + ' — старые запросы');
  } catch (error) {
    timedOut = !!(error && error.name === 'AbortError');
    console.warn('⚠️ /api/playback/prepare недоступен:', timedOut ? 'таймаут' : (error && error.message));
  }
  var results = await Promise.all([
    timedOut ? Promise.resolve(null) : loadFileInfo(hash, fileId),
    loadMediaPreferences(hash, fileId),
    wantTimecode ? loadTimecodeFromServer(hash, fileId) : Promise.resolve(null)
  ]);
  var fallbackPrefs = results[1] || {};
  return {
    fileInfo: results[0],
    audioTrack: fallbackPrefs.audioTrack !== undefined ? fallbackPrefs.audioTrack : null,
    subtitleTrack: fallbackPrefs.subtitleTrack !== undefined ? fallbackPrefs.subtitleTrack : -1,
    timecode: results[2]
  };
}

async function loadAudioPreference(hash, fileId) {
  try {
    var savedClientId = localStorage.getItem('clientId');
    var response = await fetchWithTimeout(SERVER_URL + '/api/audio/pref/get?hash=' + hash + '&fileId=' + fileId + '&clientId=' + encodeURIComponent(savedClientId));
    if (response.ok) { var data = await response.json(); if (data.success && data.audioTrack !== null) return data.audioTrack; }
  } catch (error) { }
  return null;
}

function renderSubtitleTracks() {
  var subtitlesList = getEl('subtitles-list'); if (!subtitlesList) return;
  if (!currentSubTracks || currentSubTracks.length === 0) { subtitlesList.innerHTML = '<div class="search-result-empty">Нет субтитров</div>'; return; }
  var html = ''; var isOff = currentSubtitleTrack === -1;
  html += '<div class="subtitle-item ' + (isOff ? 'active' : '') + '" data-track-index="-1"><div class="subtitle-icon">🚫</div><div class="subtitle-info"><div class="subtitle-title">Выключить субтитры</div></div><div class="subtitle-check">✓</div></div>';
  for (var idx = 0; idx < currentSubTracks.length; idx++) {
    var sub = currentSubTracks[idx]; var isActive = idx === currentSubtitleTrack;
    var language = sub.language || 'unknown'; var format = sub.format || sub.codec || ''; var title = sub.title || ('Субтитры ' + (idx + 1));
    var badges = ''; if (sub.default) badges += ' <span style="color: #4eff6a; font-size: 0.6em;">[DEFAULT]</span>'; if (sub.forced) badges += ' <span style="color: #ffd966; font-size: 0.6em;">[FORCED]</span>';
    html += '<div class="subtitle-item ' + (isActive ? 'active' : '') + '" data-track-index="' + idx + '"><div class="subtitle-icon">💬</div><div class="subtitle-info"><div class="subtitle-title">' + escapeHtml(title) + badges + '</div><div class="subtitle-details"><span class="subtitle-language">' + language.toUpperCase() + '</span>' + (format ? '<span class="subtitle-format">' + escapeHtml(format) + '</span>' : '') + '</div></div><div class="subtitle-check">✓</div></div>';
  }
  subtitlesList.innerHTML = html;
  // var subtitleItems = subtitlesList.querySelectorAll('.subtitle-item');
  // for (var i = 0; i < subtitleItems.length; i++) {
  //   (function (item) { item.addEventListener('click', function () { switchSubtitleTrack(parseInt(item.dataset.trackIndex)); }); })(subtitleItems[i]);
  // }
  // Клики обрабатываются делегированием
  setupSubtitlesListDelegation();
}

async function switchSubtitleTrack(trackIndex) {
  if (trackIndex === currentSubtitleTrack) { toggleSubtitlesPanel(); return; }
  // Обычные и онлайн-субтитры взаимоисключающие
  if (trackIndex >= 0) OnlineSubs.off(false);
  // Прямой файл: дорожка уже в <video>, поток не перезапускаем
  if (AppState.transcodingFullOnOff) { switchNativeSubtitleTrack(trackIndex); return; }
  // Текстовые субтитры уже лежат на сервере — показываем сами, поток не трогаем
  if (AppState.serverTracks && (trackIndex === -1 || serverSubEntry(trackIndex) || isTextSubtitle(trackIndex))) {
    var subInStream = trackIndex === -1 || !!serverSubEntry(trackIndex);
    currentSubtitleTrack = trackIndex;
    if (trackIndex === -1) ServerSubs.stop(); else if (subInStream) ServerSubs.select(trackIndex);
    if (currentTimecodeData.hash && currentTimecodeData.fileId) saveSubtitlePreference(currentTimecodeData.hash, currentTimecodeData.fileId, trackIndex);
    renderSubtitleTracks();
    toggleSubtitlesPanel();
    // Текстовых субтитров нет в окне — новое поколение с центром на них
    if (!subInStream) restartServerGeneration('субтитров');
    return;
  }
  thisisseek = false; await saveTimecodeToServer();
  if (currentTimecodeData.hash && currentTimecodeData.fileId) await saveSubtitlePreference(currentTimecodeData.hash, currentTimecodeData.fileId, trackIndex);
  setPlayerPanel('subtitles', false);
  var videoPlayer = getEl('video-player'); var currentTime = videoPlayer ? (videoPlayer.currentTime + AppState.seekOffset) : 0;
  getEl('playback-overlay').classList.add('active'); document.querySelector('.playback-text').textContent = 'Переключение субтитров...';
  try {
    var parsed = AppState.videoUrl.match(/\/play\/([a-fA-F0-9]+)\/(\d+)/); if (!parsed) return;
    var hash = parsed[1]; var fileId = parsed[2]; var playUrl = AppState.currentTorrserverUrl + '/play/' + hash + '/' + fileId;
    if (AppState.currentStreamId) { await bgFetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST' }); AppState.currentStreamId = null; }
    destroyHls(); currentSubtitleTrack = trackIndex;
    await startHLSPlayback(playUrl, currentTime, lastPlaybackFromSearch, currentEpisodeIndex, currentAudioTrack);
    renderSubtitleTracks();
  } catch (error) { showSwitchFailedBanner('субтитры', error && error.message); }
  finally { getEl('playback-overlay').classList.remove('active'); document.querySelector('.playback-text').textContent = 'Воспроизведение...'; }
}

function toggleSubtitlesPanel() { return togglePlayerPanel('subtitles'); }

// ==================== ОНЛАЙН-СУБТИТРЫ ====================
/**
 * Субтитры из интернета для фильма или серии: TheSubtitleDB (ищет прямо по id
 * TMDB) и OpenSubtitles через strem.io (по IMDb, его отдаёт TheSubtitleDB).
 * Оба отвечают с CORS «*», сервер TorrStream не нужен.
 *
 * Рисуем своим блоком #online-subs-box по текущему времени, а не текстовой
 * дорожкой <video>: на Tizen файл играет AVPlay (tizen-avplay.js) и реплики
 * <video> не видны, а hls.js чистит cues всех дорожек при загрузке плейлиста.
 * Время — абсолютное (currentTime + seekOffset), поэтому перемотка серверного
 * потока, транскодирование и прямой файл работают одинаково.
 *
 * Онлайн и обычные субтитры взаимоисключающие: выбор одних выключает другие.
 * Выбор помним для файла (адрес и сдвиг), а язык — для раздачи: следующая
 * серия сама включит первые субтитры того же языка.
 *
 * Серии в TheSubtitleDB ищем по IMDb самой серии (seasons[].episodes[].imdb):
 * параметры season/episode он молча не учитывает и отдаёт чужие серии.
 */
var ONLINE_SUBS_LANGS = [
  { code: 'ru', os: 'rus', label: 'Русские' },
  { code: 'uk', os: 'ukr', label: 'Украинские' },
  { code: 'en', os: 'eng', label: 'Английские' }
];
var ONLINE_SUBS_PER_LANG = 15;        // строк списка на язык
var ONLINE_SUBS_STEP_SEC = 0.5;       // шаг «раньше / позже»
var ONLINE_SUBS_TICK_MS = 200;
var ONLINE_SUBS_RESTORE_DELAY_MS = 4000;  // серии и сведения TMDB успевают загрузиться
var ONLINE_SUBS_STORE_KEY = 'onlineSubs';
var ONLINE_SUBS_STORE_MAX = 300;
var ONLINE_SUBS_FETCH_MS = 12000;
var TSDB_API = 'https://api.thesubtitledb.org/v1/';
var OS_STREMIO_API = 'https://opensubtitles-v3.strem.io/subtitles/';
var ONLINE_SUBS_FORMATS = { srt: 1, vtt: 1, webvtt: 1, ass: 1, ssa: 1 };

function onlineSubsLang(code) {
  code = String(code || '').toLowerCase();
  for (var i = 0; i < ONLINE_SUBS_LANGS.length; i++) {
    var l = ONLINE_SUBS_LANGS[i];
    if (code === l.code || code === l.os) return l;
  }
  return null;
}

/**
 * Что искать для файла: {tmdbId, type: 'movie'|'tv', season, episode} или null.
 * Серия — как для кнопки «Пропустить» (resolveSkipTarget): сведения TMDB,
 * имя файла S01E05, единственный сезон раздачи.
 */
function getOnlineSubsTarget(hash, fileId) {
  if (!hash) return null;
  var h = String(hash).toLowerCase();
  var item = AppState.currentDetailItem;
  var torrent = findLoadedTorrent(h) ||
    (item && item.hash && String(item.hash).toLowerCase() === h ? item : null) || { hash: h };
  var known = typeof knownTorrentMeta !== 'undefined' && knownTorrentMeta ? knownTorrentMeta.get(h) : null;
  var type = torrent.media_type || (known && known.mediaType) || null;
  if (type !== 'movie') {
    var ep = resolveSkipTarget(torrent, fileId);
    if (ep) return { tmdbId: ep.tmdbId, type: 'tv', season: ep.season, episode: ep.episode };
    // Сериал, а серию не узнали — фильм с тем же id искать нельзя: у фильмов
    // и сериалов TMDB id пересекаются
    if (type === 'tv') return null;
  }
  var tmdbId = parseInt(getTorrentTmdbId(torrent) || AppState.currentTMDB || '', 10);
  return tmdbId > 0 ? { tmdbId: tmdbId, type: 'movie', season: null, episode: null } : null;
}
window.getOnlineSubsTarget = getOnlineSubsTarget;

/** Для встроенного плеера Android: {tmdb_id, type, season, episode} или null */
function onlineSubsPayload(hash, fileId) {
  var t = getOnlineSubsTarget(hash, fileId);
  return t ? { tmdb_id: t.tmdbId, type: t.type, season: t.season, episode: t.episode } : null;
}

var ONLINE_SUBS_PROXY_TIMEOUT_MS = 8000;
var ONLINE_SUBS_PROXY_REST_MS = 5 * 60 * 1000;
var onlineSubsProxyDownUntil = 0;

/**
 * Прямой адрес сервиса → тот же через прокси (apiproxy.json: subsApi), null —
 * прокси нет, он отдыхает после отказа или адрес не его. Пути — как в
 * tools/nginx/tssubs.torrstream.online.conf.
 */
function onlineSubsProxied(url) {
  var host = AppState.subsApiHost;
  if (!host || Date.now() < onlineSubsProxyDownUntil) return null;
  var m = String(url).match(/^https:\/\/(api\.thesubtitledb\.org|opensubtitles-v3\.strem\.io|subs\d*\.strem\.io)\/(.*)$/);
  if (!m) return null;
  var prefix = m[1] === 'api.thesubtitledb.org' ? '/tsdb/'
    : m[1] === 'opensubtitles-v3.strem.io' ? '/os/' : '/strem/' + m[1] + '/';
  return AppState.protocol + '//' + host + prefix + m[2];
}

/**
 * Ссылка на файл из ответа прокси (он переписывает их на себя) → прямой адрес.
 * Храним и сравниваем всегда прямые: выбор переживает смену или отказ прокси.
 */
function onlineSubsDirect(url) {
  var m = String(url || '').match(/^https?:\/\/([^\/]+)\/(tsdb|os|strem\/(subs\d*\.strem\.io))\/(.*)$/);
  // Прокси пишет ссылки с $host — без порта и пути
  if (!m || !AppState.subsApiHost || m[1].split(':')[0] !== AppState.subsApiHost.split(/[\/:]/)[0]) return url;
  var host = m[2] === 'tsdb' ? 'api.thesubtitledb.org' : m[2] === 'os' ? 'opensubtitles-v3.strem.io' : m[3];
  return 'https://' + host + '/' + m[4];
}

/**
 * Запрос к сервису субтитров: через прокси, если он задан, иначе и при отказе —
 * напрямую. Прокси не ответил или лёг (5xx) — 5 минут его не трогаем; иной
 * отказ (404 «нет такого фильма») просто повторяем напрямую.
 */
function onlineSubsFetch(url, timeoutMs) {
  // bgMode 'buffer': субтитры приходят байтами (бывают в cp1251) — в воркере
  // их не декодируем, decodeSubtitleBytes разберёт кодировку сам
  var direct = function () { return fetchWithTimeout(url, { bgMode: 'buffer' }, timeoutMs); };
  var proxied = onlineSubsProxied(url);
  if (!proxied) return direct();
  var proxyFailed = function (e) {
    onlineSubsProxyDownUntil = Date.now() + ONLINE_SUBS_PROXY_REST_MS;
    console.warn('[онлайн-субтитры] прокси ' + AppState.subsApiHost + ' не ответил — напрямую:', e && e.message);
    return direct();
  };
  return fetchWithTimeout(proxied, { bgMode: 'buffer' }, Math.min(timeoutMs, ONLINE_SUBS_PROXY_TIMEOUT_MS)).then(function (r) {
    if (r.ok) return r;
    if (r.status >= 500) return proxyFailed(new Error('HTTP ' + r.status));
    return direct();
  }, proxyFailed);
}

function onlineSubsFetchJson(url) {
  return onlineSubsFetch(url, ONLINE_SUBS_FETCH_MS)
    .then(function (r) { return r.ok ? r.json() : null; })
    ['catch'](function () { return null; });
}

function tsdbItems(data, lang) {
  var items = (data && data.subtitles && data.subtitles.items) || [];
  var out = [];
  for (var i = 0; i < items.length; i++) {
    var s = items[i];
    var fmt = String(s.format || 'srt').toLowerCase();
    if (!s.download_url || !ONLINE_SUBS_FORMATS[fmt]) continue;
    out.push({
      lang: lang, url: onlineSubsDirect(s.download_url), format: fmt, encoding: s.encoding || '',
      name: String(s.release_name || '').trim(), hi: !!s.hearing_impaired, source: 'TheSubtitleDB'
    });
  }
  return out;
}

/** Список субтитров: [{lang, url, format, encoding, name, hi, source}] по языкам ONLINE_SUBS_LANGS */
function searchOnlineSubs(t) {
  var base = TSDB_API + 'by-tmdb/' + t.type + '/' + t.tmdbId;
  var head = t.type === 'tv' ? onlineSubsFetchJson(base + '?limit=1') : Promise.resolve(null);
  return head.then(function (info) {
    var tsdbPath = null;
    var imdb = info && info.title && info.title.imdb;
    if (t.type === 'tv') {
      var seasons = (info && info.seasons) || [];
      for (var i = 0; i < seasons.length && !tsdbPath; i++) {
        var eps = seasons[i].episodes || [];
        for (var j = 0; j < eps.length; j++) {
          if (eps[j].season === t.season && eps[j].episode === t.episode && eps[j].imdb) { tsdbPath = TSDB_API + 'by-imdb/' + eps[j].imdb; break; }
        }
      }
    } else tsdbPath = base;
    var perLang = ONLINE_SUBS_LANGS.map(function (l) {
      if (!tsdbPath) return Promise.resolve({ lang: l.code, data: null });
      return onlineSubsFetchJson(tsdbPath + '?lang=' + l.code + '&limit=' + ONLINE_SUBS_PER_LANG)
        .then(function (data) { return { lang: l.code, data: data }; });
    });
    return Promise.all(perLang).then(function (res) {
      for (var k = 0; k < res.length && !imdb; k++) imdb = res[k].data && res[k].data.title && res[k].data.title.imdb;
      var os = !imdb ? Promise.resolve(null) : onlineSubsFetchJson(OS_STREMIO_API +
        (t.type === 'tv' ? 'series/' + imdb + ':' + t.season + ':' + t.episode : 'movie/' + imdb) + '.json');
      return os.then(function (osData) {
        var list = [], seen = {};
        var add = function (s) {
          if (seen[s.url]) return;
          seen[s.url] = 1; list.push(s);
        };
        for (var a = 0; a < ONLINE_SUBS_LANGS.length; a++) {
          var lang = ONLINE_SUBS_LANGS[a], count = 0;
          var own = tsdbItems(res[a].data, lang.code);
          for (var b = 0; b < own.length && count < ONLINE_SUBS_PER_LANG; b++, count++) add(own[b]);
          var subs = (osData && osData.subtitles) || [];
          for (var c = 0; c < subs.length && count < ONLINE_SUBS_PER_LANG; c++) {
            var s = subs[c];
            if (!s.url || onlineSubsLang(s.lang) !== lang) continue;
            var osUrl = onlineSubsDirect(s.url);
            // strem.io сам перекодирует в UTF-8 (subencoding-stremio-utf8 в адресе)
            add({ lang: lang.code, url: osUrl, format: 'srt', encoding: 'utf-8', name: String(s.subtitleFileName || s.movieReleaseName || '').trim(), hi: false, source: 'OpenSubtitles' });
            count++;
          }
        }
        return list;
      });
    });
  });
}

/**
 * Байты файла субтитров в текст: строгий UTF-8, не вышло — объявленная
 * кодировка, иначе cp1251. Объявленной не верим первой: TheSubtitleDB пишет
 * «CP1251» у исходника, а отдаёт файл уже в UTF-8.
 */
function decodeSubtitleBytes(buf, declared) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { }
  var enc = String(declared || '').toLowerCase().replace(/[_\s]/g, '-');
  var cp = enc.match(/^(?:cp|windows-?)(\d{3,4})$/);
  try { return new TextDecoder(cp ? 'windows-' + cp[1] : 'windows-1251').decode(buf); } catch (e) { }
  return new TextDecoder('utf-8').decode(buf);
}

function cleanSubtitleText(s) {
  return s.replace(/\{[^}]*\}/g, '').replace(/<[^>]*>/g, '')
    .replace(/\\N/gi, '\n').replace(/\\h/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').trim();
}

/** SRT / WebVTT / ASS → [{s, e, t}] по возрастанию начала */
function parseSubtitleCues(text) {
  text = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  var cues = [], i, lines;
  var time = function (v) { return ServerSubs.parseTime(String(v).replace(',', '.')); };
  if (/^\s*\[Script Info\]/i.test(text) || /\n\[Events\]/i.test(text)) {
    lines = text.split('\n');
    var fmt = null;
    for (i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^Format:/i.test(line)) fmt = line.slice(7).split(',').map(function (f) { return f.trim().toLowerCase(); });
      else if (fmt && /^Dialogue:/i.test(line)) {
        var parts = line.slice(9).split(',');
        var tail = parts.splice(fmt.length - 1).join(',');
        parts.push(tail);
        var body = cleanSubtitleText(parts[fmt.indexOf('text')] || '');
        if (body) cues.push({ s: time(parts[fmt.indexOf('start')]), e: time(parts[fmt.indexOf('end')]), t: body });
      }
    }
  } else {
    var blocks = text.split(/\n[ \t]*\n/);
    for (i = 0; i < blocks.length; i++) {
      lines = blocks[i].split('\n');
      for (var j = 0; j < lines.length; j++) {
        var m = lines[j].match(/([\d:]+[,.]\d+)\s*-->\s*([\d:]+[,.]\d+)/);
        if (!m) continue;
        var txt = cleanSubtitleText(lines.slice(j + 1).join('\n'));
        if (txt) cues.push({ s: time(m[1]), e: time(m[2]), t: txt });
        break;
      }
    }
  }
  cues.sort(function (a, b) { return a.s - b.s; });
  return cues;
}

/** Выключить обычные субтитры (встроенные или серверные) — включились онлайн */
function disableRegularSubtitles() {
  if (currentSubtitleTrack === undefined || currentSubtitleTrack === null || currentSubtitleTrack < 0) return;
  var save = function () {
    if (currentTimecodeData.hash && currentTimecodeData.fileId) saveSubtitlePreference(currentTimecodeData.hash, currentTimecodeData.fileId, -1);
  };
  if (AppState.transcodingFullOnOff) {
    if (nativeSubState.mode === 'webos') webosSetSubtitle(-1); else applyNativeSubtitle(-1);
    currentSubtitleTrack = -1; save();
  } else if (AppState.serverTracks) {
    ServerSubs.stop();
    currentSubtitleTrack = -1; save();
  } else {
    // Субтитры вшиты в поток (gst, старый серверный поток) — без них только
    // перезапуском; switchSubtitleTrack сохранит выбор сам
    switchSubtitleTrack(-1);
  }
}

var OnlineSubs = {
  fileKey: null, hash: null, fileId: null,
  target: null, list: null, searching: false, searchGen: 0,
  active: null,       // {item, cues}
  loadingUrl: null, failedUrl: null,
  offset: 0, timer: null, restoreTimer: null, lastText: null,

  readStore: function () {
    var st = null;
    try { st = JSON.parse(localStorage.getItem(ONLINE_SUBS_STORE_KEY) || 'null'); } catch (e) { }
    if (!st || typeof st !== 'object') st = {};
    if (!st.f || typeof st.f !== 'object') st.f = {};
    if (!st.t || typeof st.t !== 'object') st.t = {};
    return st;
  },

  writeStore: function (st) {
    // Старые записи — прочь, иначе ключ растёт без конца
    ['f', 't'].forEach(function (k) {
      var keys = Object.keys(st[k]);
      if (keys.length <= ONLINE_SUBS_STORE_MAX) return;
      keys.sort(function (a, b) { return (st[k][a].ts || 0) - (st[k][b].ts || 0); });
      for (var i = 0; i < keys.length - ONLINE_SUBS_STORE_MAX; i++) delete st[k][keys[i]];
    });
    try { localStorage.setItem(ONLINE_SUBS_STORE_KEY, JSON.stringify(st)); } catch (e) { }
  },

  remember: function () {
    if (!this.fileKey) return;
    var st = this.readStore();
    if (this.active) {
      var it = this.active.item;
      st.f[this.fileKey] = { item: it, offset: this.offset, ts: Date.now() };
      st.t[this.hash] = { lang: it.lang, ts: Date.now() };
    } else {
      delete st.f[this.fileKey];
      delete st.t[this.hash];
    }
    this.writeStore(st);
  },

  /** Новый файл в веб-плеере. Тот же файл (смена дорожки, перезапуск потока) — всё остаётся */
  onFileStart: function (hash, fileId) {
    if (!hash || fileId === undefined || fileId === null) return;
    var key = String(hash).toLowerCase() + '_' + fileId;
    if (key === this.fileKey) { if (this.active) this.startTicker(); return; }
    this.reset();
    this.fileKey = key; this.hash = String(hash).toLowerCase(); this.fileId = fileId;
    var st = this.readStore();
    var saved = st.f[key];
    if (saved && saved.item && saved.item.url) {
      this.offset = Number(saved.offset) || 0;
      this.load(saved.item, true);
      return;
    }
    var torrentPick = st.t[this.hash];
    if (!torrentPick || !torrentPick.lang) return;
    var self = this, gen = this.searchGen;
    // Следующая серия той же раздачи: субтитры того же языка, если человек
    // не выбрал для неё обычные
    this.restoreTimer = setTimeout(function () {
      self.restoreTimer = null;
      self.ensureList().then(function () {
        if (gen !== self.searchGen || self.active || self.loadingUrl || currentSubtitleTrack >= 0) return;
        var list = self.list || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i].lang === torrentPick.lang) { self.load(list[i], true); return; }
        }
      });
    }, ONLINE_SUBS_RESTORE_DELAY_MS);
  },

  reset: function () {
    this.stopTicker();
    if (this.restoreTimer) { clearTimeout(this.restoreTimer); this.restoreTimer = null; }
    this.searchGen++;
    this.fileKey = null; this.hash = null; this.fileId = null;
    this.target = null; this.list = null; this.searching = false;
    this.active = null; this.loadingUrl = null; this.failedUrl = null; this.offset = 0;
  },

  ensureList: function () {
    var self = this, gen = this.searchGen;
    if (this.list) return Promise.resolve(this.list);
    if (!this.target) this.target = getOnlineSubsTarget(this.hash, this.fileId);
    if (!this.target) { this.list = []; return Promise.resolve(this.list); }
    this.searching = true;
    return searchOnlineSubs(this.target).then(function (list) {
      if (gen !== self.searchGen) return [];
      self.list = list; self.searching = false;
      self.refreshPanel();
      return list;
    }, function () {
      if (gen === self.searchGen) { self.list = []; self.searching = false; self.refreshPanel(); }
      return [];
    });
  },

  /** Скачать и включить. quiet — восстановление выбора: панель не трогаем */
  load: function (item, quiet) {
    var self = this, gen = this.searchGen;
    this.loadingUrl = item.url; this.failedUrl = null;
    this.refreshPanel();
    return onlineSubsFetch(item.url, ONLINE_SUBS_FETCH_MS * 2)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return typeof TextDecoder === 'function'
          ? r.arrayBuffer().then(function (buf) { return decodeSubtitleBytes(buf, item.encoding); })
          : r.text();
      })
      .then(function (text) {
        if (gen !== self.searchGen || self.loadingUrl !== item.url) return;
        var cues = parseSubtitleCues(text);
        if (!cues.length) throw new Error('пустой файл');
        self.loadingUrl = null;
        disableRegularSubtitles();
        self.active = { item: item, cues: cues };
        self.lastText = null;
        self.remember();
        self.startTicker();
        self.refreshPanel();
        updateTracksMenu();
        // Панель после выбора не закрываем: сразу под рукой «раньше/позже» —
        // задержку подгоняют, глядя на первые реплики
      })
      ['catch'](function (err) {
        if (gen !== self.searchGen || self.loadingUrl !== item.url) return;
        console.warn('[онлайн-субтитры] не загрузились:', item.url, err && err.message);
        self.loadingUrl = null; self.failedUrl = item.url;
        self.refreshPanel();
        if (!quiet && typeof showToast === 'function') showToast('Не удалось загрузить субтитры');
      });
  },

  /** Выключить. byUser — человек выключил сам: язык для следующих серий тоже забываем */
  off: function (byUser) {
    if (!this.active && !this.loadingUrl) return;
    this.active = null; this.loadingUrl = null;
    // Задержка подбиралась под этот файл субтитров — к другим она не относится
    this.offset = 0;
    this.stopTicker();
    if (byUser) this.remember();
    else if (this.fileKey) {
      // Выбрали обычные субтитры — онлайн для этого файла больше не восстанавливаем
      var st = this.readStore();
      delete st.f[this.fileKey]; delete st.t[this.hash];
      this.writeStore(st);
    }
    this.refreshPanel();
    updateTracksMenu();
  },

  shift: function (delta) {
    this.offset = Math.round((this.offset + delta) * 10) / 10;
    this.lastText = null;
    this.remember();
    this.refreshPanel();
    updateTracksMenu();
  },

  getBox: function () {
    var box = getEl('online-subs-box');
    if (box && typeof watchCuesRaise === 'function') watchCuesRaise(getEl('video-player'));
    return box;
  },

  startTicker: function () {
    var self = this;
    if (this.timer) return;
    this.timer = setInterval(function () { self.tick(); }, ONLINE_SUBS_TICK_MS);
    this.tick();
  },

  stopTicker: function () {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.show('');
  },

  show: function (text) {
    if (text === this.lastText) return;
    this.lastText = text;
    var box = this.getBox();
    if (!box) return;
    box.textContent = text;
    box.classList.toggle('hidden', !text);
  },

  tick: function () {
    var v = getEl('video-player');
    if (!this.active || !v || AppState.currentScreen !== 'player' || AppState.isSeeking) { this.show(''); return; }
    var t = (v.currentTime || 0) + (AppState.seekOffset || 0) - this.offset;
    var cues = this.active.cues;
    // Первая реплика, что начинается позже t; активные — перед ней
    var lo = 0, hi = cues.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (cues[mid].s <= t) lo = mid + 1; else hi = mid; }
    var parts = [];
    for (var i = lo - 1; i >= 0 && i >= lo - 8; i--) if (cues[i].e > t) parts.unshift(cues[i].t);
    this.show(parts.join('\n'));
  },

  /** Подпись для меню «Аудио и субтитры» */
  summary: function () {
    if (!this.active) return this.loadingUrl ? 'Загрузка…' : 'Выключены';
    var it = this.active.item, lang = onlineSubsLang(it.lang);
    return (lang ? lang.label : it.lang.toUpperCase()) + (it.name ? ' · ' + it.name : '') +
      (this.offset ? ' · ' + this.offsetLabel() : '');
  },

  /** «+1,5 с», «−1 с», «0 с» — без «,0» у целых: 2 нажатия по 0,5 = «1 с» */
  offsetLabel: function (o) {
    if (o === undefined) o = this.offset;
    var abs = Math.abs(o);
    var num = abs % 1 ? abs.toFixed(1).replace('.', ',') : String(abs);
    return (o > 0 ? '+' : o < 0 ? '−' : '') + num + ' с';
  },

  open: function () {
    if (!this.fileKey && currentTimecodeData.hash) this.onFileStart(currentTimecodeData.hash, currentTimecodeData.fileId);
    this.render();
    if (!this.list && !this.searching) this.ensureList();
  },

  refreshPanel: function () {
    if (!isPlayerPanelOpen('onlinesubs')) return;
    var list = getEl('online-subs-list');
    var focused = list && document.activeElement && list.contains(document.activeElement);
    var focusedKey = null;
    var f = list ? list.querySelector('.subtitle-item.focused') : null;
    if (f) focusedKey = f.getAttribute('data-online');
    this.render();
    // Список перерисовали — фокус на ту же строку (или на выбранную)
    if (list && (focused || focusedKey !== null) && typeof focusActivePanelItem === 'function') {
      var same = focusedKey !== null ? list.querySelector('[data-online="' + focusedKey + '"]') : null;
      if (same && typeof focusEl === 'function') { if (typeof invalidateFocusCache === 'function') invalidateFocusCache(); focusEl(same); }
      else focusActivePanelItem('onlinesubs');
    }
  },

  render: function () {
    var el = getEl('online-subs-list');
    if (!el) return;
    var html = '';
    var row = function (key, icon, title, details, active) {
      return '<div class="subtitle-item' + (active ? ' active' : '') + '" data-online="' + key + '"><div class="subtitle-icon">' + icon + '</div>' +
        '<div class="subtitle-info"><div class="subtitle-title">' + title + '</div>' +
        (details ? '<div class="subtitle-details">' + details + '</div>' : '') +
        '</div><div class="subtitle-check">✓</div></div>';
    };
    // Строка задержки: справа — сколько набрано в эту сторону (каждое нажатие
    // ±ONLINE_SUBS_STEP_SEC: раз — 0,5 с, два — 1 с, три — 1,5 с…)
    var self = this;
    var delayRow = function (key, icon, title, sign) {
      var o = self.offset, on = sign > 0 ? o > 0 : o < 0;
      return '<div class="subtitle-item online-subs-delay-item" data-online="' + key + '"><div class="subtitle-icon">' + icon + '</div>' +
        '<div class="subtitle-info"><div class="subtitle-title">' + title + '</div>' +
        '<div class="subtitle-details"><span class="subtitle-format">шаг ' + escapeHtml(self.offsetLabel(sign * ONLINE_SUBS_STEP_SEC)) + '</span></div>' +
        '</div><div class="online-subs-delay' + (on ? ' is-set' : '') + '">' + escapeHtml(on ? self.offsetLabel() : '0 с') + '</div></div>';
    };
    html += row('off', '🚫', 'Выключить онлайн субтитры', '', !this.active && !this.loadingUrl);
    if (this.active) {
      html += delayRow('earlier', '⏪', 'Показывать раньше', -1);
      html += delayRow('later', '⏩', 'Показывать позже', 1);
    }
    if (this.searching || (!this.list && this.fileKey)) html += '<div class="search-result-empty">Поиск субтитров…</div>';
    else if (!this.target && this.list) html += '<div class="search-result-empty">Не удалось определить фильм или серию</div>';
    else if (this.list && !this.list.length) html += '<div class="search-result-empty">Субтитры не найдены</div>';
    var list = this.list || [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i], lang = onlineSubsLang(s.lang);
      var isActive = !!(this.active && this.active.item.url === s.url);
      var state = this.loadingUrl === s.url ? 'Загрузка…' : this.failedUrl === s.url ? 'Не загрузились' : '';
      var details = '<span class="subtitle-language">' + escapeHtml(s.lang.toUpperCase()) + '</span>' +
        '<span class="subtitle-format">' + escapeHtml(s.source) + '</span>' +
        (s.hi ? '<span class="subtitle-format">для слабослышащих</span>' : '') +
        (state ? '<span class="subtitle-format">' + state + '</span>' : '');
      html += row(String(i), '💬', escapeHtml((lang ? lang.label : s.lang) + (s.name ? ' · ' + s.name : '')), details, isActive);
    }
    el.innerHTML = html;
    if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
  },

  onItem: function (key) {
    if (key === 'off') {
      this.off(true);
      if (isPlayerPanelOpen('onlinesubs')) togglePlayerPanel('onlinesubs');
    } else if (key === 'earlier') this.shift(-ONLINE_SUBS_STEP_SEC);
    else if (key === 'later') this.shift(ONLINE_SUBS_STEP_SEC);
    else {
      var s = this.list && this.list[parseInt(key, 10)];
      if (!s) return;
      // Уже включены — панель оставляем открытой (задержка под рукой)
      if (this.active && this.active.item.url === s.url) return;
      // Другие субтитры — задержка с нуля
      this.offset = 0;
      this.load(s, false);
    }
  }
};
window.OnlineSubs = OnlineSubs;

function setupOnlineSubsPanel() {
  var list = getEl('online-subs-list');
  if (list && !list._delegated) {
    list._delegated = true;
    list.addEventListener('click', function (e) {
      var item = e.target && e.target.closest ? e.target.closest('.subtitle-item') : null;
      if (item) OnlineSubs.onItem(item.getAttribute('data-online'));
      resetMouseIdleTimer();
    });
  }
  var closeBtn = getEl('close-online-subs');
  if (closeBtn && !closeBtn._bound) {
    closeBtn._bound = true;
    closeBtn.addEventListener('click', function () {
      setPlayerPanel('onlinesubs', false);
      resetMouseIdleTimer();
    });
  }
}
// ==================== /ОНЛАЙН-СУБТИТРЫ ====================

function setupSubtitlesButton() {
  // Открываются из меню «Аудио и субтитры» (setupTracksButton)
  var closeSubtitlesBtn = getEl('close-subtitles');
  var subtitlesPanel = getEl('subtitles-panel');

  if (!closeSubtitlesBtn || !subtitlesPanel) return;

  // Делегирование кликов по списку субтитров
  setupSubtitlesListDelegation();
  setupOnlineSubsPanel();

  closeSubtitlesBtn.addEventListener('click', function () {
    setPlayerPanel('subtitles', false);
    resetMouseIdleTimer();
  });

  setupPlayerPanelsOutsideClick();
}

async function saveSubtitlePreference(hash, fileId, subtitleTrack) {
  try {
    var savedClientId = localStorage.getItem('clientId');
    await bgFetch(SERVER_URL + '/api/subtitle/pref/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hash: hash, fileId: fileId, subtitleTrack: subtitleTrack, clientId: savedClientId }) });
  } catch (error) { }
}

async function loadSubtitlePreference(hash, fileId) {
  try {
    var savedClientId = localStorage.getItem('clientId');
    var response = await fetchWithTimeout(SERVER_URL + '/api/subtitle/pref/get?hash=' + hash + '&fileId=' + fileId + '&clientId=' + encodeURIComponent(savedClientId));
    if (response.ok) { var data = await response.json(); if (data.success && data.subtitleTrack !== null) return data.subtitleTrack; }
  } catch (error) { }
  return -1;
}

async function handleVideoEnded() {
  // Конец ловят двое — событие 'ended' и startNearEndCheck; срабатывает первый
  if (playbackEndHandled) return;
  playbackEndHandled = true;
  if (nearEndCheckInterval) { clearInterval(nearEndCheckInterval); nearEndCheckInterval = null; }
  stopHeartbeat(); stopTorrentStatsUpdates(); await saveTimecodeToServer();
  // «Переключать серии автоматически» выключено — серия заканчивается так же, как фильм
  if (AppState.autoSwitchEpisodes && currentEpisodeFiles.length > 0 && currentEpisodeIndex < currentEpisodeFiles.length - 1) {
    getEl('playback-overlay').classList.add('active'); document.querySelector('.playback-text').textContent = 'Автоматическое переключение на серию ' + (currentEpisodeIndex + 2) + '...';
    try { var nextFile = currentEpisodeFiles[currentEpisodeIndex + 1]; await switchToEpisode(currentEpisodeIndex + 1, nextFile.id); }
    catch (error) { }
    finally { getEl('playback-overlay').classList.remove('active'); document.querySelector('.playback-text').textContent = 'Воспроизведение...'; }
  } else {
    var overlay = getEl('playback-overlay'); overlay.classList.add('active'); document.querySelector('.playback-text').textContent = 'Воспроизведение завершено';
    setTimeout(function () { overlay.classList.remove('active'); showDetailView(); }, 1500);
  }
}

/**
 * Конец файла по времени воспроизведения.
 *
 * Одного события 'ended' мало: серверный HLS-поток (services/hls.js) ffmpeg
 * пишет с omit_endlist — в плейлисте нет #EXT-X-ENDLIST, hls.js считает поток
 * незаконченным, и в конце видео просто встаёт в ожидании данных, 'ended' не
 * приходит никогда. Из-за этого в веб-плеере не переключались серии.
 *
 * Поэтому раз в секунду сверяем абсолютную позицию (currentTime + seekOffset)
 * с длительностью файла: до конца меньше END_EPS_SEC — конец; или видео стоит
 * без движения END_STALL_MS в последних END_STALL_ZONE_SEC (последний сегмент
 * часто короче, чем обещает длительность). Пауза пользователя и перемотка —
 * не конец. Зовут из всех путей воспроизведения после старта и после перемотки.
 */
var END_EPS_SEC = 1.5;
var END_STALL_ZONE_SEC = 20;
var END_STALL_MS = 4000;
var playbackEndHandled = false;

function startNearEndCheck() {
  if (nearEndCheckInterval) { clearInterval(nearEndCheckInterval); nearEndCheckInterval = null; }
  playbackEndHandled = false;
  var lastAbs = -1, lastMoveAt = Date.now();
  nearEndCheckInterval = setInterval(function () {
    var v = getEl('video-player');
    var now = Date.now();
    if (!v || AppState.currentScreen !== 'player' || AppState.isSeeking || v.paused) { lastMoveAt = now; return; }
    var total = AppState.originalDuration || AppState.expectedDuration || 0;
    if (!(total > 0)) return;
    var abs = (v.currentTime || 0) + (AppState.seekOffset || 0);
    if (Math.abs(abs - lastAbs) > 0.05) { lastAbs = abs; lastMoveAt = now; }
    var left = total - abs;
    if (left <= END_EPS_SEC || (left <= END_STALL_ZONE_SEC && now - lastMoveAt >= END_STALL_MS)) {
      console.log('🏁 Конец файла: позиция ' + abs.toFixed(1) + ' из ' + total.toFixed(1) + ' с');
      handleVideoEnded();
    }
  }, 1000);
}

function exitPlayer() { if (nearEndCheckInterval) { clearInterval(nearEndCheckInterval); nearEndCheckInterval = null; } }

function setupPageUnloadHandler() {
  if (!window.AndroidJS) {
    currentSubtitleTrack = -1;
    window.addEventListener('unload', function () {
      if (AppState && AppState.currentStreamId) navigator.sendBeacon(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, '');
      if (currentTimecodeData && currentTimecodeData.hash && currentTimecodeData.fileId && currentTimecodeData.timecode > 0) {
        var savedClientId = localStorage.getItem('clientId');
        navigator.sendBeacon(SERVER_URL + '/api/timecode/save', JSON.stringify({ clientId: savedClientId, hash: currentTimecodeData.hash, fileId: currentTimecodeData.fileId, timecode: currentTimecodeData.timecode, duration: currentTimecodeData.duration, mediaKey: currentTimecodeMediaKey() }));
      }
    });
    window.addEventListener('beforeunload', function () {
      if (AppState.currentStreamId) {
        navigator.sendBeacon(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, '');
        /* закрытие страницы: воркер может не успеть — основным потоком */ fetch(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, { method: 'POST', keepalive: true })['catch'](function () { });
      }
      if (currentTimecodeData.hash && currentTimecodeData.fileId && currentTimecodeData.timecode > 0) {
        var savedClientId = localStorage.getItem('clientId');
        navigator.sendBeacon(SERVER_URL + '/api/timecode/save', JSON.stringify({ clientId: savedClientId, hash: currentTimecodeData.hash, fileId: currentTimecodeData.fileId, timecode: currentTimecodeData.timecode, duration: currentTimecodeData.duration, mediaKey: currentTimecodeMediaKey() }));
      }
    });
    window.addEventListener('pagehide', function () {
      if (AppState.currentStreamId) navigator.sendBeacon(SERVER_URL + '/hls/stop/' + AppState.currentStreamId, '');
      if (currentTimecodeData.hash && currentTimecodeData.fileId && currentTimecodeData.timecode > 0) {
        var savedClientId = localStorage.getItem('clientId');
        navigator.sendBeacon(SERVER_URL + '/api/timecode/save', JSON.stringify({ clientId: savedClientId, hash: currentTimecodeData.hash, fileId: currentTimecodeData.fileId, timecode: currentTimecodeData.timecode, duration: currentTimecodeData.duration, mediaKey: currentTimecodeMediaKey() }));
      }
    });
    document.addEventListener('visibilitychange', function () {
      var videoPlayer = getEl('video-player');
      if (document.hidden && videoPlayer && !videoPlayer.paused) videoPlayer.pause();
    });
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupPageUnloadHandler);
else setupPageUnloadHandler();

function updateClock() {
  var clock = getEl('clock-display'); if (!clock) return;
  var now = new Date(); clock.textContent = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
}
updateClock(); setInterval(updateClock, 60000);

function updatePlayerTimeline(timelineData) {
  try {
    var data = typeof timelineData === 'string' ? JSON.parse(timelineData) : timelineData;
    var isCompleted = data.percent === 100;
    if (!data.hash || data.hash === '0') {
      var urlData = data.currentUrl ? parseHashFromUrl(data.currentUrl) : null;
      if (urlData) { data.hash = urlData.hash; data.torrentHash = urlData.torrentHash; data.fileId = urlData.fileId; }
      // Плеер может вернуть таймлайн без hash и без currentUrl. Тогда опираемся
      // на то, чем его открывали (openAndroidPlayer). При автопереключении серий
      // это уже не та серия, но потерять таймкод целиком хуже.
      else if (currentTimecodeData && currentTimecodeData.hash && currentTimecodeData.fileId) {
        data.hash = currentTimecodeData.hash + '_' + currentTimecodeData.fileId;
      }
      else return;
    }
    if (currentTimecodeData) {
      if (isCompleted) { currentTimecodeData.timecode = 100; currentTimecodeData.duration = 100; }
      else { currentTimecodeData.timecode = data.time; currentTimecodeData.duration = data.duration; }
      var hashParts = data.hash.split('_');
      if (hashParts.length >= 2) { currentTimecodeData.hash = hashParts[0]; currentTimecodeData.fileId = hashParts[1]; }
      else currentTimecodeData.hash = data.hash;
    }
    if (data.currentUrl && (!currentTimecodeData.hash || !currentTimecodeData.fileId)) {
      var urlData = parseHashFromUrl(data.currentUrl);
      if (urlData) { currentTimecodeData.hash = urlData.torrentHash; currentTimecodeData.fileId = urlData.fileId; }
    }
    var savedClientId = localStorage.getItem('clientId');
    if (savedClientId && currentTimecodeData.hash && currentTimecodeData.fileId) {
      var timecodeToSave = isCompleted ? Math.floor(currentTimecodeData.duration) : Math.floor(data.time);
      // Через trackTimecodeSave — иначе updateDetailProgress ниже прочитает батч
      // раньше, чем это сохранение доедет, и покажет предыдущую серию
      trackTimecodeSave(bgFetch(SERVER_URL + '/api/timecode/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: savedClientId, hash: currentTimecodeData.hash, fileId: currentTimecodeData.fileId, timecode: timecodeToSave, duration: currentTimecodeData.duration, completed: isCompleted, mediaKey: currentTimecodeMediaKey() })
      }));
    }
    if (typeof window.refreshDetailResume === 'function') window.refreshDetailResume();
    if (androidReturnHome) { returnHomeFromAndroidPlayer(); return; }
    // Из выдачи поиска, открытого из карточки, — в карточку
    if (androidReturnCardTimer) return;
    if ((androidReturnSearch || AppState.playFromHash) && searchOriginCard()) { returnCardFromAndroidPlayer(currentTimecodeData.hash); return; }
    if (androidReturnSearch) { returnSearchFromAndroidPlayer(); return; }
    if (AppState.playFromHash && AppState.isCatalogSerials) { AppState.isCatalogSearch = false; return; }
    else if (AppState.playFromHash) { AppState.playFromHash = false; AppState.isCatalogSearch = false; return; }
    showDetailView(currentTimecodeData.fileId);
    if (AppState && AppState.currentDetailItem && currentTimecodeData.hash) updateDetailProgress(AppState.currentDetailItem);
  } catch (error) { }
}

function parseHashFromUrl(url) {
  if (!url) return null;
  try {
    var playMatch = url.match(/\/play\/([a-fA-F0-9]+)\/(\d+)/);
    if (playMatch) return { torrentHash: playMatch[1], fileId: playMatch[2], hash: playMatch[1] + '_' + playMatch[2] };
    var urlObj = new URL(url); var link = urlObj.searchParams.get('link'); var index = urlObj.searchParams.get('index');
    if (link && index) return { torrentHash: link, fileId: index, hash: link + '_' + index };
    return null;
  } catch (e) { return null; }
}

window.updatePlayerTimeline = updatePlayerTimeline;
window.parseHashFromUrl = parseHashFromUrl;
window.showDetailView = showDetailView;
window.setupEpisodesButton = setupEpisodesButton;
window.nextEpisode = nextEpisode;
window.prevEpisode = prevEpisode;
window.exitPlayer = exitPlayer;
window.cancelCurrentPlayback = cancelCurrentPlayback;

(function () {
  if (typeof window.Lampa === 'undefined') window.Lampa = {};
  if (typeof window.Lampa.Timeline === 'undefined') window.Lampa.Timeline = {};
  window.Lampa.Timeline.update = function (timelineData) {
    if (typeof updatePlayerTimeline === 'function') updatePlayerTimeline(timelineData);
  };
})();
