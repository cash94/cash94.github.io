// torrserverstats.js - Модуль для работы со статистикой TorrServer

// Переменные для статистики TorrServer
var torrentStatsCache = {
  preloaded: 0,
  preloadSize: 0,
  downloadSpeed: 0,
  percent: 0,
  activePeers: 0,
  totalPeers: 0,
  connectedSeeders: 0
};

// Функция для получения статистики TorrServer
async function fetchTorrentStatsForBuffer(hash) {
  if (!hash || !AppState.currentTorrserverUrl) return null;

  try {
    var statsUrl = AppState.currentTorrserverUrl + '/cache';

    var headers = {
      'Content-Type': 'application/json',
    };

    var authHeaders = getAuthHeaders();
    for (var key in authHeaders) {
      if (authHeaders.hasOwnProperty(key)) {
        headers[key] = authHeaders[key];
      }
    }

    var response = await fetch(statsUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        action: 'get',
        hash: hash.toLowerCase()
      })
    });

    if (response.ok) {
      var data = await response.json();

      // Данные могут быть в data.Torrent или прямо в data
      var torrent = data.Torrent || data;

      if (torrent) {
        var torrentData = {
          preloaded_bytes: torrent.preloaded_bytes || 0,
          preload_size: torrent.torrent_size || torrent.preload_size || 1,
          download_speed: torrent.download_speed || 0,  // уже в байтах/с
          active_peers: torrent.active_peers || 0,
          total_peers: torrent.total_peers || 0,
          connected_seeders: torrent.connected_seeders || 0,
          percent: torrent.torrent_size
            ? Math.floor((torrent.preloaded_bytes || 0) * 100 / torrent.torrent_size)
            : 0
        };

        return torrentData;
      }
    }
    return null;
  } catch (error) {
    console.log('⚠️ Ошибка получения статистики TorrServer:', error);
    return null;
  }
}

// Функция для обновления кэша статистики
async function updateTorrentStatsCache() {
  if (!currentTimecodeData.hash) {
    torrentStatsCache = {
      preloaded: 0,
      preloadSize: 0,
      downloadSpeed: 0,
      percent: 0,
      activePeers: 0,
      totalPeers: 0,
      connectedSeeders: 0
    };
    return;
  }

  var stats = await fetchTorrentStatsForBuffer(currentTimecodeData.hash);
  if (stats) {
    torrentStatsCache.preloaded = stats.preloaded_bytes || 0;
    torrentStatsCache.preloadSize = stats.preload_size || 1;
    torrentStatsCache.downloadSpeed = stats.download_speed || 0;  // уже в байтах/с
    torrentStatsCache.percent = stats.percent;
    torrentStatsCache.activePeers = stats.active_peers || 0;
    torrentStatsCache.totalPeers = stats.total_peers || 0;
    torrentStatsCache.connectedSeeders = stats.connected_seeders || 0;
  }
}

// Функция форматирования скорости
function formatSpeed(speedInBytes) {
  if (speedInBytes === 0 || !speedInBytes) return '0 Mb/s';

  // Переводим байты/с в мегабиты/с: (байты * 8) / 1_000_000
  var speedInMegabits = (speedInBytes * 8) / 1000000;

  if (speedInMegabits < 1) {
    // Если меньше 1 Мбит/с, показываем в килобитах
    var speedInKilobits = (speedInBytes * 8) / 1000;
    return speedInKilobits.toFixed(1) + ' Kb/s';
  }

  return speedInMegabits.toFixed(1) + ' Mb/s';
}

// Функция форматирования размера
function formatSize(bytes) {
  if (bytes === 0 || !bytes) return '0 B';
  if (bytes < 1024) return bytes.toFixed(0) + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// ==================== Частота опроса /cache ====================
//
// Статистику показывает только строка «TorrServer: … скорость … пиры» в HUD
// плеера, других потребителей у неё нет. Пока HUD скрыт, опрашивать TorrServer
// раз в пару секунд незачем: никто этих цифр не видит. Поэтому частота зависит
// от того, видна ли строка: открыт HUD — раз в секунду, скрыт — раз в 10 с.
// «Не видна» — это ещё и скрытый жёлтой кнопкой буфер (AppState.bufferHidden):
// тогда строки нет даже при открытом HUD.
//
// Цепочка setTimeout, а не setInterval: следующий запрос планируется только
// после ответа на предыдущий. Прежний setInterval на медленном TorrServer
// накладывал запросы друг на друга.
//
// HUD прячут и показывают двое: player.js (setPlayerControlsIdle) и control.js
// (hidePlayerControls / showPlayerControls). Оба работают классом idle-hidden
// на #controls-container, поэтому смену видимости ловим MutationObserver'ом на
// этом классе, а не вызовами из каждого пути. При открытии HUD данные нужны
// сразу, а не через оставшиеся до десяти секунд, — тогда запрос уходит
// немедленно.

var TORRENT_STATS_VISIBLE_MS = 1000;
var TORRENT_STATS_HIDDEN_MS = 10000;
var torrentStatsTimer = null;
var torrentStatsRunning = false;
var torrentStatsInFlight = false;
var torrentStatsLastAt = 0;
var torrentStatsObserver = null;
var torrentStatsWasVisible = false;

function isTorrentStatsVisible() {
  if (typeof AppState !== 'undefined' && AppState.bufferHidden) return false;
  var controls = getEl('controls-container');
  return !!controls && !controls.classList.contains('idle-hidden');
}

function scheduleTorrentStats(delay) {
  if (torrentStatsTimer) clearTimeout(torrentStatsTimer);
  torrentStatsTimer = setTimeout(torrentStatsTick, delay);
}

function torrentStatsTick() {
  torrentStatsTimer = null;
  if (!torrentStatsRunning || torrentStatsInFlight) return;
  torrentStatsInFlight = true;
  torrentStatsLastAt = Date.now();
  var done = function () {
    torrentStatsInFlight = false;
    if (!torrentStatsRunning) return;
    scheduleTorrentStats(isTorrentStatsVisible() ? TORRENT_STATS_VISIBLE_MS : TORRENT_STATS_HIDDEN_MS);
  };
  updateTorrentStatsCache().then(done, done);
}

/**
 * Пересчитать частоту после смены видимости. Строка стала видна — запрос
 * сразу (если последний был не только что), дальше раз в секунду. Скрылась —
 * ничего не делаем: уже назначенный тик отработает и сам перейдёт на 10 с.
 */
function refreshTorrentStatsCadence() {
  if (!torrentStatsRunning) return;
  var visible = isTorrentStatsVisible();
  var becameVisible = visible && !torrentStatsWasVisible;
  torrentStatsWasVisible = visible;
  if (!becameVisible || torrentStatsInFlight) return;
  var sinceLast = Date.now() - torrentStatsLastAt;
  scheduleTorrentStats(sinceLast >= TORRENT_STATS_VISIBLE_MS ? 0 : TORRENT_STATS_VISIBLE_MS - sinceLast);
}

function watchTorrentStatsVisibility() {
  if (torrentStatsObserver || typeof MutationObserver !== 'function') return;
  var controls = getEl('controls-container');
  if (!controls) return;
  torrentStatsObserver = new MutationObserver(refreshTorrentStatsCadence);
  torrentStatsObserver.observe(controls, { attributes: true, attributeFilter: ['class'] });
}

// Запуск опроса статистики
function startTorrentStatsUpdates() {
  stopTorrentStatsUpdates();

  console.log('📊 Запуск опроса статистики TorrServer');

  torrentStatsRunning = true;
  torrentStatsWasVisible = isTorrentStatsVisible();
  watchTorrentStatsVisibility();
  // Первоначальное обновление — сразу
  scheduleTorrentStats(0);
}

// Остановка опроса статистики
function stopTorrentStatsUpdates() {
  var wasRunning = torrentStatsRunning;
  torrentStatsRunning = false;
  if (torrentStatsTimer) {
    clearTimeout(torrentStatsTimer);
    torrentStatsTimer = null;
  }
  if (torrentStatsObserver) {
    torrentStatsObserver.disconnect();
    torrentStatsObserver = null;
  }
  if (wasRunning) console.log('📊 Остановлен опрос статистики TorrServer');
}

// ==================== Предзагрузка перед воспроизведением ====================
//
// Настройка TorrServer → «Предзагрузка» (AppState.preloadBeforePlay). Перед
// стартом плеера startHLSPlayback (player.js) зовёт runPlaybackPreload: тот
// просит TorrServer прогреть файл (?preload=preload, как preloadTorrents в
// player.js) и раз в секунду показывает в окне скорость, пиры, сиды и сколько
// буфера уже набрано. Набралось PRELOAD_TARGET_BYTES — окно закрывается и
// воспроизведение стартует. По окну видно, живая ли раздача, и если нет —
// «Назад» отменяет запуск и останавливает раздачу на сервере.
//
// Ответ на ?preload=preload TorrServer держит открытым, пока греет свой объём
// (настройка «Размер предзагрузки» у него). Если тот меньше 32 МБ, до цели
// счётчик не дорастёт никогда — поэтому успешный ответ тоже значит «готово».
//
// Клавиши ловим в фазе перехвата на window, как встроенная клавиатура (osk.js):
// раньше обработчиков control.js, которые иначе увели бы фокус по экрану под
// окном. «Назад» с Android приходит синтетическим Escape из popstate
// (control.js), у него keyCode 0 — поэтому проверяем ещё и e.key.

var PRELOAD_TARGET_BYTES = 32 * 1024 * 1024;
var PRELOAD_POLL_MS = 1000;

// Проба файла (ffprobe на сервере) — пока идёт предзагрузка, а не после неё.
// Раньше плеер после окна ещё ждал /api/playback/prepare, а тот — ffprobe по
// сети на TorrServer. Теперь, как только набрались первые мегабайты (голова
// файла, с которой ffprobe и работает), шлём /api/file/info в фоне: сервер
// кладёт пробу в кэш, и к концу предзагрузки плеер получает всё сразу. Не
// успела — не страшно: сервер склеивает одновременные пробы одного файла
// (services/probe.js), и запрос плеера дождётся той же самой.
var PRELOAD_PROBE_AFTER_BYTES = 4 * 1024 * 1024;

/**
 * Нужна ли проба этому запуску: Android отдаёт ссылку своему плееру и пробу
 * не спрашивает, режимы транскодирования живут без неё — как и прогрев
 * следующей серии (maybeWarmNextEpisode, player.js).
 */
function preloadWantsProbe() {
  return !window.AndroidJS && !AppState.transcodingOnOff && !AppState.transcodingFullOnOff;
}

function startPreloadProbe(state) {
  if (state.probeStarted || !preloadWantsProbe()) return;
  state.probeStarted = true;
  var clientId = null;
  try { clientId = localStorage.getItem('clientId'); } catch (e) { }
  var url = SERVER_URL + '/api/file/info?hash=' + state.hash + '&fileId=' + state.fileId +
    (clientId ? '&clientId=' + encodeURIComponent(clientId) : '');
  console.log('🔎 Проба файла во время предзагрузки');
  // Ответ не нужен — только кэш на сервере. Таймаут — как у плеера: холодная
  // проба уходит за 15 с, и обрывать её раньше сервера нельзя
  if (typeof fetchWithTimeout === 'function') {
    fetchWithTimeout(url, null, typeof FILE_INFO_FETCH_TIMEOUT_MS === 'number' ? FILE_INFO_FETCH_TIMEOUT_MS : 60000)['catch'](function () { });
  } else {
    fetch(url)['catch'](function () { });
  }
}
var activePlaybackPreload = null;
var preloadSwallowKeyup = false;
var preloadPanelEls = null;

function getPreloadPanel() {
  if (preloadPanelEls) return preloadPanelEls;
  var root = document.createElement('div');
  root.id = 'preload-panel';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-live', 'polite');
  // Как экран загрузки Lampa (src/interaction/media_loading.js): кадр фильма,
  // логотип двумя слоями (бледный и цветной поверх — его ширина = процент) и
  // плашка внизу. Подписи «Отменить» / «Смотреть сейчас» — для мыши и тача,
  // с пульта то же делают «Назад» и ОК
  root.innerHTML =
    '<img class="preload-backdrop hidden" alt="">' +
    '<div class="preload-shade"></div>' +
    '<div class="preload-mark"><div class="preload-mark-bg"></div><div class="preload-mark-fill"></div></div>' +
    '<div class="preload-status">' +
    '<span class="preload-peers hidden"><svg class="preload-peers-icon" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M12 3v12m0 0 5-5m-5 5-5-5M5 19h14"></path></svg><span class="preload-peers-value"></span></span>' +
    '<span class="preload-sep preload-sep-peers hidden"></span>' +
    '<span class="preload-speed hidden"></span>' +
    '<span class="preload-sep preload-sep-speed hidden"></span>' +
    '<span class="preload-percent">0%</span>' +
    '</div>' +
    '<div class="preload-hint">' +
    '<button type="button" class="preload-btn" data-action="cancel"><span class="preload-key">←</span>Отменить</button>' +
    '<button type="button" class="preload-btn" data-action="play"><span class="preload-key">ОК</span>Смотреть сейчас</button>' +
    '</div>';
  document.body.appendChild(root);
  root.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.preload-btn') : null;
    if (!btn || !activePlaybackPreload) return;
    finishPlaybackPreload(activePlaybackPreload, btn.getAttribute('data-action') === 'play');
  });
  preloadPanelEls = {
    root: root,
    backdrop: root.querySelector('.preload-backdrop'),
    markBg: root.querySelector('.preload-mark-bg'),
    fill: root.querySelector('.preload-mark-fill'),
    peers: root.querySelector('.preload-peers'),
    peersValue: root.querySelector('.preload-peers-value'),
    sepPeers: root.querySelector('.preload-sep-peers'),
    speed: root.querySelector('.preload-speed'),
    sepSpeed: root.querySelector('.preload-sep-speed'),
    percent: root.querySelector('.preload-percent')
  };
  return preloadPanelEls;
}

function formatPreloadMb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/** Слой логотипа: картинка или, если её нет, название текстом */
function preloadMarkContent(logoUrl, title) {
  var box = document.createElement('div');
  box.className = 'preload-mark-content';
  if (logoUrl) {
    var img = document.createElement('img');
    img.className = 'preload-logo';
    img.alt = '';
    img.src = logoUrl;
    box.appendChild(img);
  } else {
    var text = document.createElement('div');
    text.className = 'preload-title-text';
    text.textContent = title || '';
    box.appendChild(text);
  }
  return box;
}

function setPreloadMark(logoUrl, title) {
  var els = getPreloadPanel();
  els.markBg.innerHTML = '';
  els.fill.innerHTML = '';
  els.markBg.appendChild(preloadMarkContent(logoUrl, title));
  els.fill.appendChild(preloadMarkContent(logoUrl, title));
}

/**
 * Какой фильм запускают: {id, type, item} или null. Так же, как карточка
 * раздачи (torrents.js): у раздачи id фильма — tmdbId / knownTmdbId, а чаще
 * всего — в названии «[603] Матрица», и в объект раздачи карточка его не
 * записывает. У карточки каталога id — её собственный (у раздачи вместо
 * него hash). Нет ни того, ни другого — карточка фильма, с которой ушли в
 * «Поиск торрентов» (pendingDetail*).
 */
function preloadTmdbRef() {
  var item = AppState.currentDetailItem || null;
  var id = null, type = null;
  if (item) {
    id = item.tmdbId || item.knownTmdbId || null;
    if (!id) {
      var m = String(item.title || item.name || '').match(/\[(\d+)\]/);
      if (m) id = m[1];
    }
    if (!id && !item.hash) id = item.id || null;
    type = item.media_type || item.mediaType || item.knownMediaType || null;
  }
  if (!id && AppState.pendingDetailTmdbId) {
    id = AppState.pendingDetailTmdbId;
    type = AppState.pendingDetailMediaType || type;
    item = AppState.pendingDetailItem || item;
  }
  if (!id) return null;
  return { id: id, type: type === 'tv' ? 'tv' : 'movie', item: item };
}

/**
 * Кадр и логотип фильма — из деталей TMDB (getTmdbDetailsWithCache): в них
 * сервер кладёт и backdrop_path, и logo, а карточка, с которой запускают,
 * их уже загрузила — значит, отдаст кэш. Пока не пришли — название текстом и
 * тёмный фон. Картинки показываем, только когда они загрузились: логотип,
 * сменивший текст на пустое место, хуже текста.
 */
/**
 * Номер показа экрана: ответ деталей и загрузка картинок применяются, только
 * если экран с тех пор не открывали заново. Не «идёт ли ещё предзагрузка»:
 * прогретая раздача набирает буфер раньше, чем приходят детали, а экран после
 * этого ещё стоит до первого кадра (holdPreloadScreen) — и оставался пустым.
 */
var preloadMediaGen = 0;

function setPreloadMedia(state, title) {
  var els = getPreloadPanel();
  var gen = ++preloadMediaGen;
  var current = function () { return gen === preloadMediaGen && els.root.classList.contains('active'); };
  els.backdrop.classList.add('hidden');
  els.backdrop.removeAttribute('src');
  setPreloadMark(null, title);

  var ref = preloadTmdbRef();
  if (!ref || typeof getTmdbDetailsWithCache !== 'function') return;
  var item = ref.item || {};
  var tmdbId = ref.id, mediaType = ref.type;
  var image = function (path, size) {
    return typeof getTmdbImageUrl === 'function' ? getTmdbImageUrl(path, size) : path;
  };

  Promise.resolve(getTmdbDetailsWithCache(tmdbId, mediaType)).then(function (details) {
    if (!current() || !details) return;
    var name = title || details.title || details.name || '';
    if (!title && name) setPreloadMark(null, name);
    var backdropPath = details.backdrop_path || item.backdrop_path;
    if (backdropPath) {
      els.backdrop.onload = function () { if (current()) els.backdrop.classList.remove('hidden'); };
      els.backdrop.onerror = function () { els.backdrop.classList.add('hidden'); };
      els.backdrop.src = image(backdropPath, 'w1280');
    }
    var logoPath = details.logo && details.logo.file_path;
    if (logoPath) {
      var probe = new Image();
      probe.onload = function () { if (current()) setPreloadMark(probe.src, name); };
      probe.src = image(logoPath, 'w500');
    }
  })['catch'](function () { });
}

function renderPlaybackPreload(state) {
  var els = getPreloadPanel();
  var stats = state.stats;
  var loaded = Math.min(state.loaded, PRELOAD_TARGET_BYTES);
  var progress = loaded * 100 / PRELOAD_TARGET_BYTES;
  els.fill.style.width = progress.toFixed(1) + '%';
  els.percent.textContent = Math.round(progress) + '%';
  var showPeers = !!stats;
  els.peers.classList.toggle('hidden', !showPeers);
  els.sepPeers.classList.toggle('hidden', !showPeers);
  els.peersValue.textContent = showPeers ? (stats.active_peers || 0) + ' / ' + (stats.total_peers || 0) : '';
  // На месте скорости — ошибка, если TorrServer не ответил
  var speed = state.error || (stats ? formatSpeed(stats.download_speed) : '');
  els.speed.textContent = speed;
  els.speed.classList.toggle('hidden', !speed);
  els.sepSpeed.classList.toggle('hidden', !speed);
}

function schedulePlaybackPreloadTick(state, delay) {
  state.timer = setTimeout(function () { playbackPreloadTick(state); }, delay);
}

function playbackPreloadTick(state) {
  state.timer = null;
  if (activePlaybackPreload !== state) return;
  fetchTorrentStatsForBuffer(state.hash).then(function (stats) {
    if (activePlaybackPreload !== state) return;
    if (stats) {
      state.stats = stats;
      state.loaded = Math.max(state.loaded, stats.preloaded_bytes || 0);
    }
    if (state.loaded >= PRELOAD_PROBE_AFTER_BYTES) startPreloadProbe(state);
    renderPlaybackPreload(state);
    if (state.loaded >= PRELOAD_TARGET_BYTES) { finishPlaybackPreload(state, true); return; }
    schedulePlaybackPreloadTick(state, PRELOAD_POLL_MS);
  });
}

/**
 * Закрыть окно. play = true — запускаем воспроизведение, false — отмена:
 * обрываем прогрев и останавливаем раздачу на TorrServer, чтобы негодная
 * раздача не качалась дальше в фоне (так же делает выход из плеера).
 */
function finishPlaybackPreload(state, play) {
  if (activePlaybackPreload !== state) return;
  activePlaybackPreload = null;
  if (state.timer) { clearTimeout(state.timer); state.timer = null; }
  if (play && preloadHoldsUntilPlaying()) holdPreloadScreen();
  else if (play) holdPreloadUntilHidden();
  else releasePreloadScreen(true);
  if (!play) {
    if (state.controller) { try { state.controller.abort(); } catch (e) { } }
    // Отметка «уже прогревали» из player.js: без неё повторный запуск того же
    // файла не стал бы греть его заново — а ничего и не прогрелось
    if (typeof preloadedFilesAt !== 'undefined') delete preloadedFilesAt[state.key];
    if (typeof dropTorrentToServer === 'function') {
      dropTorrentToServer(state.hash)['catch'](function () { });
    }
    console.log('⏹️ Предзагрузка отменена');
  } else {
    console.log('▶️ Предзагрузка завершена: ' + formatPreloadMb(state.loaded) + ' МБ');
  }
  state.resolve(play);
}

/**
 * Экран остаётся до первого кадра, как у Lampa: между концом предзагрузки и
 * стартом видео плеер показывал чёрный экран с «Подготовка потока…» /
 * «Воспроизведение…» (пока сервер готовит поток). Теперь поверх этой
 * прослойки стоит тот же кадр с уже цветным логотипом, а гаснет он, когда
 * видео пошло (playing). Только для встроенного плеера: Android и внешние
 * плееры Apple открываются поверх, им ждать нечего.
 */
var PRELOAD_HOLD_MAX_MS = 45000;
var PRELOAD_FADE_MS = 300;
var preloadHold = null;

function preloadHoldsUntilPlaying() {
  if (window.AndroidJS) return false;
  var apple = (typeof getApplePlayer === 'function') ? getApplePlayer() : null;
  return !(apple && apple.template);
}

function holdPreloadScreen() {
  var els = getPreloadPanel();
  els.fill.style.width = '100%';
  els.percent.textContent = '100%';
  els.root.classList.add('preload-holding');
  var video = document.getElementById('video-player');
  // Видео пошло — гасим, но не раньше, чем уберут чёрные прослойки плеера:
  // «Воспроизведение…» снимает уже тот, кто звал startHLSPlayback, после
  // его возврата, и в режиме через сервер это бывает позже первого кадра
  var onPlaying = function () {
    if (!preloadHold) return;
    preloadHold.played = true;
    if (!playerOverlaysBusy()) releasePreloadScreen(false);
  };
  if (preloadHold) releasePreloadScreen(true);
  preloadHold = {
    video: video,
    onPlaying: onPlaying,
    // Видео так и не пошло, а баннера ошибки не было — не держим экран вечно
    timer: setTimeout(function () { releasePreloadScreen(false); }, PRELOAD_HOLD_MAX_MS),
    // Плеер открылся, а потом с него ушли («Назад», выход) — экран больше не
    // нужен. Не через cancelCurrentPlayback: её зовёт и сам запуск, в начале
    // (resetPlaybackState), — экран снимался бы сразу
    seenPlayer: false,
    played: false,
    watch: setInterval(function () {
      if (!preloadHold) return;
      if (AppState.currentScreen === 'player') preloadHold.seenPlayer = true;
      else if (preloadHold.seenPlayer) { releasePreloadScreen(true); return; }
      if (preloadHold.played && !playerOverlaysBusy()) releasePreloadScreen(false);
    }, 300)
  };
  if (video) video.addEventListener('playing', onPlaying);
}

/**
 * Внешний плеер (Android: встроенный или сторонний, Apple: по URL-схеме)
 * открывается поверх страницы не сразу: между концом предзагрузки и его
 * появлением на долю секунды было видно то, что под экраном, — карточку
 * раздачи или выдачу поиска. Держим экран, пока страница не уйдёт на задний
 * план (visibilitychange → hidden, pagehide), и снимаем мгновенно — вернувшись
 * из плеера, его уже не увидеть. Плеер так и не открылся (закрыли окно выбора
 * плеера) — экран уходит сам через PRELOAD_EXTERNAL_HOLD_MS.
 */
var PRELOAD_EXTERNAL_HOLD_MS = 5000;

function holdPreloadUntilHidden() {
  var els = getPreloadPanel();
  els.fill.style.width = '100%';
  els.percent.textContent = '100%';
  els.root.classList.add('preload-holding');
  if (preloadHold) releasePreloadScreen(true);
  var onHide = function (e) {
    if (e.type === 'pagehide' || document.hidden) releasePreloadScreen(true);
  };
  preloadHold = {
    onHide: onHide,
    timer: setTimeout(function () { releasePreloadScreen(false); }, PRELOAD_EXTERNAL_HOLD_MS)
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);
}

/** Видна ли чёрная прослойка плеера: «Воспроизведение…» или «Подготовка потока…» */
function playerOverlaysBusy() {
  var po = document.getElementById('playback-overlay');
  var lo = document.getElementById('loading-player-overlay');
  return !!((po && po.classList.contains('active')) || (lo && lo.classList.contains('active')));
}

/**
 * Убрать экран. immediate — без затухания: отмена, ошибка (баннер не должен
 * оказаться под экраном), новый запуск. Зовут: playing, showErrorBanner
 * (app.js), «Назад» во время запуска (control.js), уход с плеера (watch выше),
 * уход страницы на задний план под внешним плеером (holdPreloadUntilHidden).
 */
function releasePreloadScreen(immediate) {
  var els = preloadPanelEls;
  if (preloadHold) {
    clearTimeout(preloadHold.timer);
    clearInterval(preloadHold.watch);
    if (preloadHold.video) preloadHold.video.removeEventListener('playing', preloadHold.onPlaying);
    if (preloadHold.onHide) {
      document.removeEventListener('visibilitychange', preloadHold.onHide);
      window.removeEventListener('pagehide', preloadHold.onHide);
    }
    preloadHold = null;
  }
  if (!els || activePlaybackPreload) return;
  clearTimeout(els.fadeTimer);
  els.root.classList.remove('preload-holding');
  if (immediate || !els.root.classList.contains('active')) {
    els.root.classList.remove('active', 'preload-leaving');
    return;
  }
  els.root.classList.add('preload-leaving');
  els.fadeTimer = setTimeout(function () {
    els.root.classList.remove('active', 'preload-leaving');
  }, PRELOAD_FADE_MS);
}
window.releasePreloadScreen = releasePreloadScreen;

function onPlaybackPreloadKeyDown(e) {
  if (!activePlaybackPreload) return;
  var kc = e.keyCode || e.which;
  e.preventDefault();
  e.stopImmediatePropagation();
  var isBack = e.key === 'Escape' || (typeof isBackKey === 'function' ? isBackKey(kc) : kc === 27 || kc === 8);
  if (isBack) { finishPlaybackPreload(activePlaybackPreload, false); return; }
  if (typeof isOkKey === 'function' ? isOkKey(kc) : kc === 13) {
    // keyup этого ОК придёт уже без окна — не отдаём его экрану под ним
    preloadSwallowKeyup = true;
    finishPlaybackPreload(activePlaybackPreload, true);
  }
}

function onPlaybackPreloadKeyUp(e) {
  if (!activePlaybackPreload && !preloadSwallowKeyup) return;
  preloadSwallowKeyup = false;
  e.preventDefault();
  e.stopImmediatePropagation();
}

window.addEventListener('keydown', onPlaybackPreloadKeyDown, true);
window.addEventListener('keyup', onPlaybackPreloadKeyUp, true);

/**
 * Показать окно предзагрузки и ждать буфер. Промис: true — запускать
 * воспроизведение, false — пользователь отменил.
 */
function runPlaybackPreload(hash, fileId, title) {
  if (activePlaybackPreload) finishPlaybackPreload(activePlaybackPreload, false);
  return new Promise(function (resolve) {
    var state = {
      hash: hash,
      fileId: fileId,
      key: String(hash).toLowerCase() + ':' + fileId,
      resolve: resolve,
      timer: null,
      controller: (typeof AbortController === 'function') ? new AbortController() : null,
      stats: null,
      loaded: 0,
      error: '',
      probeStarted: false
    };
    activePlaybackPreload = state;

    var els = getPreloadPanel();
    releasePreloadScreen(true);
    setPreloadMedia(state, title);
    // Заливка логотипа с нуля без анимации отката от прошлого запуска
    els.fill.style.transition = 'none';
    renderPlaybackPreload(state);
    void els.fill.offsetWidth;
    els.fill.style.transition = '';
    els.root.classList.add('active');

    // Прогрев после отмены чужого: старый (карточка, с которой ушли) держал
    // бы соединение к TorrServer впустую. Отметка в player.js — чтобы
    // preparePlaybackMetadata не повторил прогрев этого же файла
    if (typeof abortPendingPreload === 'function') abortPendingPreload();
    if (typeof wasPreloadedRecently === 'function') wasPreloadedRecently(hash, fileId);
    var url = AppState.currentTorrserverUrl + '/stream?link=' + hash + '&index=' + fileId + '&preload=preload';
    var options = { method: 'GET', headers: getAuthHeaders() };
    if (state.controller) options.signal = state.controller.signal;
    fetch(url, options).then(function (response) {
      if (activePlaybackPreload !== state) return;
      if (response.ok) {
        // TorrServer догрел свой объём — ждать больше нечего
        state.loaded = Math.max(state.loaded, PRELOAD_TARGET_BYTES);
        renderPlaybackPreload(state);
        finishPlaybackPreload(state, true);
      } else {
        state.error = 'TorrServer ответил ' + response.status;
        renderPlaybackPreload(state);
      }
    }, function (error) {
      if (activePlaybackPreload !== state || (error && error.name === 'AbortError')) return;
      state.error = 'Нет ответа от TorrServer';
      renderPlaybackPreload(state);
    });

    schedulePlaybackPreloadTick(state, 0);
  });
}

function isPlaybackPreloadActive() {
  return !!activePlaybackPreload;
}

// Экспортируем функции для использования в других модулях
window.fetchTorrentStatsForBuffer = fetchTorrentStatsForBuffer;
window.updateTorrentStatsCache = updateTorrentStatsCache;
window.formatSpeed = formatSpeed;
window.formatSize = formatSize;
window.startTorrentStatsUpdates = startTorrentStatsUpdates;
window.stopTorrentStatsUpdates = stopTorrentStatsUpdates;
window.torrentStatsCache = torrentStatsCache;
window.refreshTorrentStatsCadence = refreshTorrentStatsCadence;
window.runPlaybackPreload = runPlaybackPreload;
window.isPlaybackPreloadActive = isPlaybackPreloadActive;
