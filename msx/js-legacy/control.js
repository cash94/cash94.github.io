/* Сборка для старых браузеров (Chrome 53) из js/control.js — tools/legacy-build/build.js. Руками не править. */
function asyncGeneratorStep(n, t, e, r, o, a, c) {try {var i = n[a](c),u = i.value;} catch (n) {return void e(n);}i.done ? t(u) : Promise.resolve(u).then(r, o);}function _asyncToGenerator(n) {return function () {var t = this,e = arguments;return new Promise(function (r, o) {var a = n.apply(t, e);function _next(n) {asyncGeneratorStep(a, r, o, _next, _throw, "next", n);}function _throw(n) {asyncGeneratorStep(a, r, o, _next, _throw, "throw", n);}_next(void 0);});};}

var KEY_CODES = {
  OK: 13,
  ESC: 27,
  BACK: [4, 8, 27, 461, 111, 10009],
  ARROWS: { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40 },
  SPACE: 32
};

var OK_HOLD_DELETE_MS = 900;
var SEEK_ACCELERATION_STEPS = [
{ time: 0, step: 5 },
{ time: 500, step: 10 },
{ time: 1000, step: 20 },
{ time: 1500, step: 30 },
{ time: 2000, step: 45 },
{ time: 2500, step: 60 },
{ time: 3000, step: 90 },
{ time: 4000, step: 120 }];






















var SCROLL_SMOOTH = {
  force: true,
  speedX: 900,
  speedY: 1500,

  minDuration: 0.12,






  maxDuration: 0.5,


  fallbackDuration: 0.35,
  ease: 'none'
};











var _instantScrollDepth = 0;

function withInstantScroll(fn) {
  _instantScrollDepth++;
  try {return fn();} finally
  {_instantScrollDepth--;}
}
window.withInstantScroll = withInstantScroll;


var focusableElements = [];
var currentFocusIndex = 0;
var lastSelectedTorrentHash = null;
var lastSelectedTorrentIndex = 0;
var lastPlayerBackPressAt = 0;
var seekHoldInterval = null;
var seekHoldStep = 5;
var seekHoldDelay = 150;
var isSeekHoldActive = false;
var accelerationTimer = null;
var okHoldTimer = null;
var okHoldHandled = false;
var okHoldFocused = null;





var okKeyHeld = false;
var okKeyLastDown = 0;
var OK_HELD_STALE_MS = 1500;



var navHold = false;
var navHoldTimer = null;


var navKeyRepeat = false;
var navStreak = 0;
var navStreakAt = 0;
var navStreakDir = null;



var navStepUntil = 0;


var NAV_STEP_MAX_WAIT_MS = 420;









var NAV_STEP_BASE_MS = 200;






var NAV_STEP_MAX_SPEEDUP = 1.5;





var NAV_STEP_SCROLL_WINDOW_MS = 32;
var navStepAt = 0;



var NAV_PACED_SCREENS = ['home', 'catalog', 'torrents', 'search', 'detail'];

var navQueuedDirection = null;
var navQueuedRun = null;
var navQueuedScreen = null;
var navQueueTimer = null;




var navStepArmed = false;
var lastPopStateTime = 0;
var isProcessingBack = false;
var lastNavDirection = 'right';

var configState = {
  activeTabId: 'torrserver-tab',
  isOnMenu: true,
  previousFocusElement: null,
  initialized: false
};

var customFilterMenuState = null;


var _focusCache = {
  timestamp: 0,
  screen: null,
  elements: [],
  gen: -1,
  ttl: 100
};




var HOME_HIDDEN_ROW_CLASS = 'home-row-hidden';





var _focusGen = 0;


var _rowsCache = { gen: -1, rows: null };







var _gridCardsCache = { gen: -1, cards: null };























var seekIndicatorEl = null;
var seekIndicatorTimeEl = null;
var seekIndicatorDirEl = null;
var seekIndicatorStepEl = null;
var seekOverlayTimeout = null;

function getSeekIndicator() {
  if (seekIndicatorEl && seekIndicatorEl.parentNode) return seekIndicatorEl;
  seekIndicatorEl = getEl('seek-speed-indicator');
  if (!seekIndicatorEl) return null;
  if (!seekIndicatorEl.firstChild) {
    seekIndicatorEl.innerHTML =
    '<div class="seek-indicator-time" id="seek-time">00:00</div>' +
    '<div class="seek-indicator-step">' +
    '<span class="seek-indicator-dir" id="seek-direction"></span>' +
    '<span class="seek-indicator-speed" id="seek-step"></span>' +
    '</div>';
  }
  seekIndicatorTimeEl = seekIndicatorEl.querySelector('#seek-time');
  seekIndicatorDirEl = seekIndicatorEl.querySelector('#seek-direction');
  seekIndicatorStepEl = seekIndicatorEl.querySelector('#seek-step');
  return seekIndicatorEl;
}






function showSeekOverlay(time, direction, step) {
  var el = getSeekIndicator();
  if (!el) return;

  if (seekIndicatorTimeEl) seekIndicatorTimeEl.textContent = formatTime(time);
  if (seekIndicatorDirEl) seekIndicatorDirEl.textContent = direction > 0 ? '\u25b6\u25b6' : '\u25c0\u25c0';
  if (seekIndicatorStepEl) seekIndicatorStepEl.textContent = step ? step + ' сек' : '';

  el.classList.remove('hidden');
  el.classList.add('visible');
  if (seekOverlayTimeout) {clearTimeout(seekOverlayTimeout);seekOverlayTimeout = null;}
}

function hideSeekOverlay() {
  if (seekIndicatorEl) seekIndicatorEl.classList.remove('visible');
  if (seekOverlayTimeout) {clearTimeout(seekOverlayTimeout);seekOverlayTimeout = null;}
}


function scheduleHideSeekOverlay() {
  if (seekOverlayTimeout) clearTimeout(seekOverlayTimeout);
  seekOverlayTimeout = setTimeout(function () {
    hideSeekOverlay();
  }, 800);
}


















var NAV_HOLD_GAP_MS = 250;
var NAV_HOLD_MIN_STREAK = 2;
var NAV_HOLD_IDLE_MS = 260;

function setNavHold(direction) {
  var now = Date.now();
  var gap = now - navStreakAt;
  navStreakAt = now;
  if (gap <= NAV_HOLD_GAP_MS && direction === navStreakDir) {
    navStreak++;
  } else {
    navStreak = 1;
  }
  navStreakDir = direction;

  navHold = navKeyRepeat || navStreak >= NAV_HOLD_MIN_STREAK;
  if (navHoldTimer) clearTimeout(navHoldTimer);
  navHoldTimer = setTimeout(endNavHold, NAV_HOLD_IDLE_MS);
}








function endNavHold() {
  if (navHoldTimer) {clearTimeout(navHoldTimer);navHoldTimer = null;}
  navHold = false;
  navStreak = 0;
  navStreakDir = null;
  navKeyRepeat = false;
  navStepUntil = 0;
}

function VISIBLE(el) {return !!(el && el.offsetParent !== null && !el.disabled);}

function blurEditor() {
  var a = document.activeElement;
  if (a && a !== document.body && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA')) {
    try {a.blur();} catch (e) {}
  }
}















var _focusedEls = [];

function trackFocusedElement(el) {
  if (el && _focusedEls.indexOf(el) === -1) _focusedEls.push(el);
}
window.trackFocusedElement = trackFocusedElement;












var _lastFocusedByScreen = {};

function rememberScreenFocus(el) {
  if (!el || !el.classList || el.classList.contains('home-nav-btn')) return;
  var screen = window.AppState && AppState.currentScreen;
  if (!screen || screen === 'config') return;
  _lastFocusedByScreen[screen] = el;
}






function restoreScreenFocus(screen) {


  invalidateFocusCache();

  var el = _lastFocusedByScreen[screen];
  if (el) {
    if (el.isConnected !== false && VISIBLE(el)) {
      updateFocusableElements();
      var idx = focusableElements.indexOf(el);
      if (idx !== -1) setFocus(idx);else
      focusEl(el);
      return true;
    }


    delete _lastFocusedByScreen[screen];
  }

  var strategy = ScreenStrategies[screen];
  return !!(strategy && strategy.ensureFocus && strategy.ensureFocus(true));
}
















var MARQUEE_MEASURE_DELAY_MS = 350;
var _marqueeTimer = null;
var _marqueeTarget = null;

function applyTitleMarquee(el) {
  if (_marqueeTimer) {clearTimeout(_marqueeTimer);_marqueeTimer = null;}
  _marqueeTarget = el || null;
  if (!el || !el.querySelector) return;

  _marqueeTimer = setTimeout(function () {
    _marqueeTimer = null;

    if (window.navHold) return;
    if (_marqueeTarget !== el || !el.isConnected) return;
    if (!el.classList || !el.classList.contains('focused')) return;
    startTitleMarquee(el);
  }, MARQUEE_MEASURE_DELAY_MS);
}


function startTitleMarquee(el) {
  var box = el.querySelector('.marquee-text');
  if (!box) return;
  var span = box.firstElementChild;
  if (!span) return;
  var overflow = span.scrollWidth - box.clientWidth;
  if (overflow <= 4) return;
  box.style.setProperty('--mq-shift', -(overflow + 4) + 'px');
  box.style.setProperty('--mq-dur', Math.min(20, Math.max(6, (overflow + 4) / 30 * 2 + 3)).toFixed(1) + 's');
  box.classList.add('marquee');
}

function clearTitleMarquee(el) {
  if (_marqueeTimer) {clearTimeout(_marqueeTimer);_marqueeTimer = null;}
  _marqueeTarget = null;
  if (!el || !el.querySelector) return;
  var box = el.querySelector('.marquee-text.marquee');
  if (box) box.classList.remove('marquee');
}

function clearFocused() {
  if (!_focusedEls.length) return;
  var list = _focusedEls;
  _focusedEls = [];
  for (var i = 0; i < list.length; i++) {





    if (list[i].style.boxShadow) list[i].style.boxShadow = '';
    if (list[i].style.transform) list[i].style.transform = '';
    clearTitleMarquee(list[i]);
    list[i].classList.remove('focused');
  }
}

function clickEl(el) {
  try {if (el && el.click) el.click();} catch (e) {}
}

function isPlayerControlsVisible() {
  var c = getEl('controls-container');
  return !!c && !c.classList.contains('idle-hidden');
}




var _cachedColumns = 0;

function _readGridColumns(gridId) {
  var grid = getEl(gridId);
  if (!grid) return 0;
  try {
    var tpl = window.getComputedStyle(grid).gridTemplateColumns || '';
    if (!tpl || tpl === 'none') return 0;

    var m = /repeat\(\s*(\d+)/.exec(tpl);
    if (m) return parseInt(m[1], 10) || 0;

    var parts = tpl.split(' ').filter(function (b) {return b;});
    return parts.length;
  } catch (e) {}
  return 0;
}

function invalidateColumnsCache() {_cachedColumns = 0;}
window.invalidateColumnsCache = invalidateColumnsCache;
window.addEventListener('resize', invalidateColumnsCache);

function getColumns() {
  if (_cachedColumns > 0) return _cachedColumns;


  try {
    if (window.UICustomizer && typeof window.UICustomizer.getColumns === 'function') {
      var n = window.UICustomizer.getColumns();
      if (n > 0) {_cachedColumns = n;return n;}
    }
  } catch (e) {}


  var cols = _readGridColumns('catalog-grid') || _readGridColumns('torrents-grid');
  _cachedColumns = cols > 0 ? cols : 5;
  return _cachedColumns;
}

function getTorrentGridColumns() {
  return _readGridColumns('torrents-grid') || getColumns();
}







function getSearchGridColumns() {
  var grid = document.querySelector('#search-results .global-search-grid');
  if (grid) {
    try {
      var tpl = window.getComputedStyle(grid).gridTemplateColumns || '';
      var m = /repeat\(\s*(\d+)/.exec(tpl);
      if (m) return parseInt(m[1], 10) || getColumns();
      var parts = tpl.split(' ').filter(function (b) {return b && b !== 'none';});
      if (parts.length) return parts.length;
    } catch (e) {}
  }
  return getColumns();
}


function invalidateFocusCache() {
  _focusCache.timestamp = 0;
  _focusCache.elements = [];
  _focusGen++;
  _rowsCache.gen = -1;
  _rowsCache.rows = null;
  _gridCardsCache.gen = -1;
  _gridCardsCache.cards = null;
  _searchResultsCache.gen = -1;
  _searchResultsCache.items = null;
}
window.invalidateFocusCache = invalidateFocusCache;


function _isScreenVisible(el) {
  if (!el) return false;

  if (el.hidden) return false;

  if (el.classList && el.classList.contains('hidden')) return false;

  if (el.style.display === 'none') return false;




  if (el.dataset && el.dataset.hiding === '1') return false;


  if (el.style.display !== '') return true;


  try {
    return getComputedStyle(el).display !== 'none';
  } catch (e) {
    return true;
  }
}

function currentScreen() {
  try {
    var ss = window.AppState && AppState.currentScreen ? AppState.currentScreen : null;

    if (ss === 'player') return 'player';

    if (_isScreenVisible(getEl('player-screen'))) return 'player';
    if (_isScreenVisible(getEl('sync-overlay'))) return 'sync';
    if (_isScreenVisible(getEl('config-screen'))) return 'config';















    if (_isScreenVisible(getEl('search-overlay'))) return 'search';
    if (_isScreenVisible(getEl('detail-view'))) return 'detail';
    if (_isScreenVisible(getEl('donate-overlay'))) return 'donate';





    if (_isScreenVisible(getEl('content-home'))) return 'home';

    if (ss === 'catalog' || window.AppState && AppState.inSearch === 'catalog') return 'catalog';

    var cg = getEl('catalog-grid') || getEl('catalog-rows');
    if (cg && cg.classList.contains('hidden')) {
      var hc = cg.querySelector('.catalog-card,.catalog-folder-card') !== null;
      if (hc) return 'catalog';
    }

    return ss || 'torrents';
  } catch (e) {
    return 'torrents';
  }
}

function belongsToScreen(el, screen) {
  if (!el) return false;

  if (screen === 'home') {
    return !!(el.closest('#content-home') || el.classList.contains('home-nav-btn'));
  }


  if (screen === 'torrents') {
    return el.closest('.torrent-card') || el.classList.contains('file-item') ||
    el.classList.contains('home-nav-btn') ||
    ['search-query', 'search-btn', 'settings-btn', 'tab-torrents', 'tab-search', 'tab-donate', 'tab-favorites', 'back-from-detail', 'tab-catalog'].indexOf(el.id) !== -1;
  }
  if (screen === 'catalog') {
    return el.closest('.torrent-card.catalog-card') || el.closest('.torrent-card.catalog-folder-card') ||
    el.closest('#catalog-grid') || el.closest('#catalog-rows') ||
    el.id === 'back-from-catalog' || el.classList.contains('file-item') || el.classList.contains('back-btn') ||
    el.classList.contains('home-nav-btn') ||
    ['search-query', 'search-btn', 'settings-btn', 'tab-torrents', 'tab-search', 'tab-catalog', 'tab-donate', 'tab-favorites'].indexOf(el.id) !== -1;
  }
  if (screen === 'search') {

    var filterPanel = getEl('search-filters-panel');
    if (filterPanel && filterPanel.classList.contains('active')) {
      if (filterPanel.contains(el)) return true;
    }

    return el.closest('.search-result-item') || el.closest('.global-search-card') ||
    ['search-query', 'filter-toggle', 'search-btn', 'close-search',
    'filter-back-btn', 'filter-close-btn', 'reset-filters'].indexOf(el.id) !== -1 ||
    el.classList.contains('filter-item') || el.classList.contains('filter-value-item');
  }
  if (screen === 'detail') {
    return !!(el.closest('#detail-view') || el.closest('.file-item') || el.closest('back-from-detail') ||
    el.classList.contains('detail-progress-btn') || el.classList.contains('back-btn'));
  }
  if (screen === 'config') {
    return !!(el.closest('#config-screen') ||
    ['torrserver-url', 'auth-checkbox', 'auth-login', 'auth-password', 'sync-clients-btn', 'speedtest-btn', 'auto-fullscreen', 'hide-clock', 'add-to-db', 'multi-channel-audio', 'torrserver-tab', 'torrents-tab', 'player-tab', 'appearance-tab', 'account-tab', 'sync-tab', 'other-tab', 'device-tab', 'jacred-url'].indexOf(el.id) !== -1 ||
    el.classList.contains('settings-btn') || el.classList.contains('menu-item'));
  }
  return false;
}

function getTorrentCards() {
  var c = document.querySelectorAll('#torrents-grid .torrent-card'),v = [];
  for (var i = 0; i < c.length; i++) if (VISIBLE(c[i])) v.push(c[i]);
  return v;
}



var CATALOG_CARDS_SELECTOR =
'#catalog-grid .torrent-card.catalog-card, #catalog-grid .torrent-card.catalog-folder-card, ' +
'#catalog-rows .torrent-card.catalog-card, #catalog-rows .torrent-card.catalog-folder-card';


























function visibleCatalogScope() {
  var grid = getEl('catalog-grid');
  if (grid && grid.style.display !== 'none') return grid;
  var rows = getEl('catalog-rows');
  if (rows && rows.style.display !== 'none') return rows;
  return null;
}

function getCatalogGridCards() {
  if (_gridCardsCache.gen === _focusGen && _gridCardsCache.cards &&
  _gridCardsCache.cards.length > 0 &&
  _gridCardsCache.cards[0].isConnected !== false) {
    return _gridCardsCache.cards;
  }






  var scope = visibleCatalogScope();
  var c = [];
  if (scope) {
    var ac = scope.querySelectorAll(
      '.torrent-card.catalog-card, .torrent-card.catalog-folder-card');
    for (var i = 0; i < ac.length; i++) c.push(ac[i]);
  }

  _gridCardsCache.gen = _focusGen;
  _gridCardsCache.cards = c;

  return c;
}




function getTorrentHeader() {
  return [];
}



function getTorrentTabs() {





  var sec = getEl('torrserver-section');
  if (sec && sec.style.display === 'none') return [];
  var bar = getEl('home-topbar');
  if (!bar) return [];
  var b = bar.querySelectorAll('.home-nav-btn'),v = [];
  for (var i = 0; i < b.length; i++) v.push(b[i]);
  return v;
}

function getSearchTop() {
  var ids = ['search-query', 'filter-toggle', 'search-btn', 'close-search'],v = [];
  for (var i = 0; i < ids.length; i++) {var e = getEl(ids[i]);if (VISIBLE(e)) v.push(e);}
  return v;
}

function getSearchFilters() {

  var panel = getEl('search-filters-panel');
  if (!panel || !panel.classList.contains('active')) {

    var toggle = getEl('filter-toggle');
    return toggle && VISIBLE(toggle) ? [toggle] : [];
  }


  var elements = [];
  var filterItems = panel.querySelectorAll('.filter-item');
  var filterValueItems = panel.querySelectorAll('.filter-value-item');
  var backBtn = getEl('filter-back-btn');
  var closeBtn = getEl('filter-close-btn');
  var resetBtn = getEl('reset-filters');


  if (backBtn && VISIBLE(backBtn)) elements.push(backBtn);
  if (closeBtn && VISIBLE(closeBtn)) elements.push(closeBtn);


  for (var i = 0; i < filterItems.length; i++) {
    if (VISIBLE(filterItems[i])) elements.push(filterItems[i]);
  }


  for (var j = 0; j < filterValueItems.length; j++) {
    if (VISIBLE(filterValueItems[j])) elements.push(filterValueItems[j]);
  }


  if (resetBtn && VISIBLE(resetBtn)) elements.push(resetBtn);

  return elements;
}

var _searchResultsCache = { gen: -1, mode: null, items: null };


















function getSearchResults() {
  var cm = typeof window.getCurrentSearchMode === 'function' ? window.getCurrentSearchMode() : 'torrentsearch';
  if (cm !== 'torrentsearch' && cm !== 'globalsearch') return [];

  if (_searchResultsCache.gen === _focusGen && _searchResultsCache.mode === cm &&
  _searchResultsCache.items && (
  !_searchResultsCache.items.length || _searchResultsCache.items[0].isConnected !== false)) {
    return _searchResultsCache.items;
  }

  var host = getEl('search-results');
  var v = [];
  if (host && host.offsetParent !== null) {
    var sel = cm === 'torrentsearch' ? '.search-result-item' : '.global-search-card';
    var found = host.querySelectorAll(sel);
    for (var j = 0; j < found.length; j++) v.push(found[j]);
  }

  _searchResultsCache.gen = _focusGen;
  _searchResultsCache.mode = cm;
  _searchResultsCache.items = v;
  return v;
}









function getDetailActionButtons() {
  var row = getEl('catalog-detail-actions');
  if (!row) return [];
  var all = row.querySelectorAll('button, .catalog-watch-btn, .detail-progress-btn');
  var out = [];
  for (var i = 0; i < all.length; i++) {
    if (VISIBLE(all[i]) && out.indexOf(all[i]) === -1) out.push(all[i]);
  }
  return out;
}

function getDetailItems() {







  var s = ['#detail-view .home-nav-btn', '.detail-progress-btn', '.file-item', '#catalog-watch-btn', '#catalog-toggle-overview-btn', '#detail-open-card-btn', '#catalog-favorite-btn', '#catalog-trailer-btn', '.catalog-trailer-link', '.catalog-trailer-play', '.catalog-trailer-card-item', '#catalog-trailer-close', '.catalog-actor-card', '.catalog-recommendation-card'];




  var it = document.querySelectorAll(s.join(','));
  var a = [];
  for (var i = 0; i < it.length; i++) if (VISIBLE(it[i])) a.push(it[i]);
  return a;
}



















var DETAIL_LANE_CLASSES = ['file-item', 'catalog-actor-card', 'catalog-recommendation-card'];

function detailLaneStep(dir) {
  if (dir !== 'left' && dir !== 'right') return false;
  var f = document.querySelector('.focused');
  if (!f || !f.classList || !belongsToScreen(f, 'detail')) return false;
  var lane = null;
  for (var i = 0; i < DETAIL_LANE_CLASSES.length; i++) {
    if (f.classList.contains(DETAIL_LANE_CLASSES[i])) {lane = DETAIL_LANE_CLASSES[i];break;}
  }
  if (!lane) return false;



  var sib = f;
  do {
    sib = dir === 'left' ? sib.previousElementSibling : sib.nextElementSibling;
  } while (sib && !(sib.classList && sib.classList.contains(lane) &&
  !sib.hidden && !sib.classList.contains('hidden') && sib.style.display !== 'none'));
  if (sib) focusEl(sib, { direction: dir });else
  if (lane !== 'file-item') focusEl(f, { direction: dir });
  return true;
}

function getConfigMenuItems() {
  var ids = ['torrserver-tab', 'torrents-tab', 'player-tab', 'appearance-tab', 'account-tab', 'sync-tab', 'other-tab', 'device-tab'];
  var visibleItems = [];
  for (var i = 0; i < ids.length; i++) {
    var element = getEl(ids[i]);
    if (VISIBLE(element)) visibleItems.push(element);
  }
  return visibleItems;
}

function getConfigItems() {
  var ids = ['torrserver-url', 'auth-checkbox', 'auth-login', 'auth-password', 'jacred-url', '.settings-btn', 'sync-clients-btn', 'speedtest-btn', 'auto-fullscreen', 'hide-clock', 'add-to-db', 'multi-channel-audio'];
  var visibleItems = [];
  for (var i = 0; i < ids.length; i++) {
    var element = getEl(ids[i]);
    if (VISIBLE(element)) visibleItems.push(element);
  }
  var settingsButtons = document.querySelectorAll('.settings-btn');
  for (var j = 0; j < settingsButtons.length; j++) {
    if (VISIBLE(settingsButtons[j])) visibleItems.push(settingsButtons[j]);
  }
  return visibleItems;
}

function getConfigContentItems(tabId) {
  var tabContentId = tabId + '-content';
  var tabContent = getEl(tabContentId);
  if (!tabContent) return [];




  var visibleItems = [];
  var elements = tabContent.querySelectorAll('input:not([type="hidden"]), button, select, textarea');
  for (var j = 0; j < elements.length; j++) {
    if (VISIBLE(elements[j])) visibleItems.push(elements[j]);
  }
  return visibleItems;
}











var detailTopbarReturn = null;

function detailTopbarAvailable() {
  return !!(window.DetailTopbar && typeof DetailTopbar.show === 'function');
}






function focusDetailEl(target) {
  if (!target) return false;
  updateFocusableElements();
  var idx = focusableElements && focusableElements.indexOf ? focusableElements.indexOf(target) : -1;
  if (idx !== -1) {setFocus(idx);return true;}
  return focusEl(target);
}

function revealDetailTopbar(from) {
  if (!detailTopbarAvailable()) return false;
  if (!DetailTopbar.show()) return false;


  var target = DetailTopbar.preferred();
  if (!target) {DetailTopbar.hide();return false;}

  detailTopbarReturn = from || null;
  invalidateFocusCache();
  DetailTopbar.focus(target);
  return true;
}

function hideDetailTopbar(restoreFocus) {
  if (!detailTopbarAvailable() || !DetailTopbar.isShown()) return false;
  DetailTopbar.hide();
  invalidateFocusCache();

  if (restoreFocus) {
    var back = detailTopbarReturn;
    if (back && back.isConnected && back.offsetParent !== null) focusDetailEl(back);else
    if (ScreenStrategies.detail) ScreenStrategies.detail.ensureFocus(true);
  }
  detailTopbarReturn = null;
  return true;
}

var ScreenStrategies = {
  torrents: {
    getItems: getTorrentCards,
    ensureFocus: function (force) {
      if (force === undefined) force = false;
      if (currentScreen() !== 'torrents') return false;
      if (window.AppState && AppState.restoringFocus) return false;
      var f = document.querySelector('.focused');
      if (!force && belongsToScreen(f, 'torrents')) return true;
      var c = getTorrentCards(),t = getTorrentTabs(),h = getTorrentHeader();
      if (!c.length) {


        if (
        window.AppState &&
        AppState.torrentsLoaded && (
        !AppState.torrents || AppState.torrents.length === 0))
        {
          return focusEl(t[0] || h[0]);
        }


        if (window.AppState && AppState.torrentsLoading) {
          return false;
        }
        return window.refreshTorrents().then(function () {
          c = getTorrentCards();
          var tc = null;
          var sh = window.AppState && window.AppState.currentDetailItem && window.AppState.currentDetailItem.hash ?
          window.AppState.currentDetailItem.hash.toLowerCase() :
          null;

          if (sh) {
            for (var i = 0; i < c.length; i++) {
              if (c[i].dataset.hash && c[i].dataset.hash.toLowerCase() === sh) {
                tc = c[i];
                break;
              }
            }
          }

          if (!tc && typeof window.lastSelectedTorrentHash !== 'undefined' && window.lastSelectedTorrentHash) {
            for (var i = 0; i < c.length; i++) {
              if (c[i].dataset.hash && c[i].dataset.hash.toLowerCase() === window.lastSelectedTorrentHash.toLowerCase()) {
                tc = c[i];
                break;
              }
            }
          }

          if (!tc && typeof window.lastSelectedTorrentIndex === 'number' && window.lastSelectedTorrentIndex >= 0) {
            var si = window.lastSelectedTorrentIndex;
            if (si < c.length) tc = c[si];
          }

          if (!tc) tc = c[0];

          if (window.AppState && window.AppState.currentDetailItem) window.AppState.currentDetailItem = null;
          if (window.lastSelectedTorrentHash) window.lastSelectedTorrentHash = null;
          if (typeof window.lastSelectedTorrentIndex !== 'undefined') window.lastSelectedTorrentIndex = 0;

          return focusEl(tc || t[0] || h[0]);
        });
      } else {
        var tc = null;
        var sh = window.AppState && window.AppState.currentDetailItem && window.AppState.currentDetailItem.hash ? window.AppState.currentDetailItem.hash.toLowerCase() : null;
        if (sh) for (var i = 0; i < c.length; i++) if (c[i].dataset.hash && c[i].dataset.hash.toLowerCase() === sh) {tc = c[i];break;}
        if (!tc && typeof window.lastSelectedTorrentHash !== 'undefined' && window.lastSelectedTorrentHash)
        for (var i = 0; i < c.length; i++) if (c[i].dataset.hash && c[i].dataset.hash.toLowerCase() === window.lastSelectedTorrentHash.toLowerCase()) {tc = c[i];break;}
        if (!tc && typeof window.lastSelectedTorrentIndex === 'number' && window.lastSelectedTorrentIndex >= 0) {
          var si = window.lastSelectedTorrentIndex;if (si < c.length) tc = c[si];
        }
        if (!tc) tc = c[0];
        if (window.AppState && window.AppState.currentDetailItem) window.AppState.currentDetailItem = null;
        if (window.lastSelectedTorrentHash) window.lastSelectedTorrentHash = null;
        if (typeof window.lastSelectedTorrentIndex !== 'undefined') window.lastSelectedTorrentIndex = 0;
        return focusEl(tc);
      }
      return focusEl(t[0] || h[0]);
    },
    handleNavigation: function (dir) {
      var f = belongsToScreen(document.querySelector('.focused'), 'torrents') ? document.querySelector('.focused') : null;
      var c = getTorrentCards(),h = getTorrentHeader(),t = getTorrentTabs(),cols = getColumns();
      if (!f) return this.ensureFocus(true);
      var ci = -1,hi = -1,ti = -1;
      for (var i = 0; i < c.length; i++) if (f === c[i]) {ci = i;break;}
      for (var i = 0; i < h.length; i++) if (f === h[i]) {hi = i;break;}
      for (var i = 0; i < t.length; i++) if (f === t[i]) {ti = i;break;}
      if (ci !== -1) {
        var row = Math.floor(ci / cols);
        if (dir === 'left') return focusEl(c[Math.max(0, ci - 1)] || f);
        if (dir === 'right') return focusEl(c[Math.min(c.length - 1, ci + 1)] || f);
        if (dir === 'up') {if (row === 0) return focusEl(t[0] || h[0] || f);return focusEl(c[Math.max(0, ci - cols)] || f);}
        if (dir === 'down') return focusEl(c[Math.min(c.length - 1, ci + cols)] || f);
        return true;
      }
      if (ti !== -1) {
        if (dir === 'left') return focusEl(t[Math.max(0, ti - 1)] || f);
        if (dir === 'right') return focusEl(t[Math.min(t.length - 1, ti + 1)] || f);
        if (dir === 'down') return focusEl(c[0] || f);
        if (dir === 'up') return focusEl(h[Math.min(ti, h.length - 1)] || h[0] || f);
        return true;
      }
      if (hi !== -1) {
        if (dir === 'left') return focusEl(h[Math.max(0, hi - 1)] || f);
        if (dir === 'right') return focusEl(h[Math.min(h.length - 1, hi + 1)] || f);
        if (dir === 'down') return focusEl((f.id === 'settings-btn' ? t[0] : t[1]) || t[0] || c[0] || f);
        return true;
      }
      return false;
    },
    onOk: function (f) {
      if (!belongsToScreen(f, 'torrents')) return this.ensureFocus(true);
      if (f.id === 'search-query' || f.id === 'search-btn' || f.id === 'tab-search') return openSearchScreen(true);
      if (f.id === 'tab-catalog') {clickEl(f);return true;}
      clickEl(f);
      return true;
    }
  },

  catalog: {
    getItems: function () {
      return getCatalogGridCards();
    },
    ensureFocus: function (force) {
      if (force === undefined) force = false;
      if (currentScreen() !== 'catalog') return false;


      if (isCatalogRowsMode()) {
        var fr = document.querySelector('.focused');
        if (!force && fr && belongsToScreen(fr, 'catalog')) return true;
        var rows = getCatalogRows();
        if (!rows.length) return false;
        return focusRowCard(0, 0, rows);
      }


      var f = document.querySelector('.focused');
      if (!force && f && belongsToScreen(f, 'catalog')) return true;
      var c = getCatalogGridCards();
      if (!c.length) return false;
      var si = localStorage.getItem('lastCatalogCardIndex'),tc = null;
      if (si !== null) {
        var sn = parseInt(si, 10);
        if (Number.isFinite(sn)) {
          for (var j = 0; j < c.length; j++) {
            var cn = parseInt(c[j].dataset.numIndex || '-1', 10);
            if (Number.isFinite(cn) && cn === sn) {tc = c[j];break;}
          }
          if (!tc && sn >= 0 && sn < c.length) tc = c[sn];
        }
      }
      if (!tc) tc = c[0];
      return focusEl(tc);
    },
    handleNavigation: function (dir) {

      if (isCatalogRowsMode()) {
        return handleRowsNavigation(dir);
      }





      var focused = document.querySelector('.focused');
      var f = belongsToScreen(focused, 'catalog') ? focused : null;
      var c = getCatalogGridCards();
      var h = getTorrentHeader(),t = getTorrentTabs(),cols = getColumns();
      if (!f) return this.ensureFocus(true);
      var ci = -1,hi = -1,ti = -1;
      for (var i = 0; i < c.length; i++) if (f === c[i]) {ci = i;break;}
      for (var i = 0; i < h.length; i++) if (f === h[i]) {hi = i;break;}
      for (var i = 0; i < t.length; i++) if (f === t[i]) {ti = i;break;}
      if (ci !== -1) {
        var row = Math.floor(ci / cols);





        if (dir === 'left') {if (ci > 0) return focusEl(c[ci - 1] || f);return true;}
        if (dir === 'right') {
          if (ci < c.length - 1) {
            var nextCard = c[ci + 1] || f;
            var movedRight = focusEl(nextCard);
            if (typeof window.prefetchCatalogIfNearEnd === 'function') {
              window.prefetchCatalogIfNearEnd(nextCard, cols);
            }
            if (typeof window.prefetchChunkAhead === 'function') {
              window.prefetchChunkAhead(nextCard, cols);
            }
            return movedRight;
          }

          if (c.length < catalogState.totalItems && !catalogState.isLoadingMore) {
            window.loadMoreCatalogItems().then(function () {
              setTimeout(function () {
                var nc = getCatalogGridCards();
                if (nc.length > ci + 1) focusEl(nc[ci + 1]);
              }, 50);
            });
          }
          return true;
        }
        if (dir === 'up') {
          if (row === 0) return focusEl(t[0] || h[0] || f);
          var upCard = c[Math.max(0, ci - cols)] || f;
          var movedUp = focusEl(upCard);



          if (typeof window.prefetchChunkAhead === 'function') {
            window.prefetchChunkAhead(upCard, cols);
          }
          return movedUp;
        }
        if (dir === 'down') {
          if (ci + cols < c.length) {
            var downCard = c[Math.min(c.length - 1, ci + cols)] || f;
            var moved = focusEl(downCard);





            if (typeof window.prefetchCatalogIfNearEnd === 'function') {
              window.prefetchCatalogIfNearEnd(downCard, cols);
            }
            if (typeof window.prefetchChunkAhead === 'function') {
              window.prefetchChunkAhead(downCard, cols);
            }
            return moved;
          } else
          if (c.length < catalogState.totalItems && !catalogState.isLoadingMore) {
            window.loadMoreCatalogItems().then(function () {
              setTimeout(function () {


                var nc = getCatalogGridCards();
                var tix = Math.min(ci + cols, nc.length - 1);
                if (tix >= 0 && tix < nc.length && nc[tix]) focusEl(nc[tix]);
              }, 50);
            });
            return true;
          }
          return true;
        }
        return true;
      }
      if (ti !== -1) {
        if (dir === 'left') return focusEl(t[Math.max(0, ti - 1)] || f);
        if (dir === 'right') return focusEl(t[Math.min(t.length - 1, ti + 1)] || f);
        if (dir === 'down') return focusEl(c[0] || f);
        if (dir === 'up') return focusEl(h[Math.min(ti, h.length - 1)] || h[0] || f);
        return true;
      }
      if (hi !== -1) {
        if (dir === 'left') return focusEl(h[Math.max(0, hi - 1)] || f);
        if (dir === 'right') return focusEl(h[Math.min(h.length - 1, hi + 1)] || f);
        if (dir === 'down') return focusEl((f.id === 'settings-btn' ? t[0] : t[1]) || t[0] || c[0] || f);
        return true;
      }
      return false;
    },
    onOk: function (f) {
      if (!belongsToScreen(f, 'catalog')) return this.ensureFocus(true);
      clickEl(f);
      return true;
    }
  },

  search: {
    getItems: function () {
      var t = getSearchTop(),fl = getSearchFilters(),r = getSearchResults();
      return t.concat(fl).concat(r);
    },
    ensureFocus: function (force, preferInput) {
      if (force === undefined) force = false;
      if (preferInput === undefined) preferInput = true;
      if (currentScreen() !== 'search') return false;
      var f = document.querySelector('.focused');
      if (!force && belongsToScreen(f, 'search')) return true;
      var t = getSearchTop(),fl = getSearchFilters(),r = getSearchResults(),q = getEl('search-query');
      var panel = getEl('search-filters-panel');
      if (panel && panel.classList.contains('active')) {
        var firstItem = panel.querySelector('.filter-item:not(.hidden), .filter-value-item');
        if (firstItem) return focusEl(firstItem);
      }
      return focusEl(preferInput && q ? q : t[0] || fl[0] || r[0] || q);
    },
    handleNavigation: function (dir) {
      var cm = typeof window.getCurrentSearchMode === 'function' ? window.getCurrentSearchMode() : 'torrentsearch';
      var f = belongsToScreen(document.querySelector('.focused'), 'search') ? document.querySelector('.focused') : null;
      var q = getEl('search-query'),t = getSearchTop(),fl = getSearchFilters(),r = getSearchResults();
      var panel = getEl('search-filters-panel');
      var isInFilterPanel = panel && panel.classList.contains('active');
      if (isInFilterPanel) {
        return handleFilterPanelNavigation(dir, f);
      }
      var tWQ = [];for (var i = 0; i < t.length; i++) if (t[i] && t[i].id !== 'search-query') tWQ.push(t[i]);
      var te = tWQ[0] || fl[0] || r[0] || q;
      if (!f) return this.ensureFocus(true, false);
      if (document.activeElement === q && ['left', 'right', 'up', 'down'].indexOf(dir) !== -1) {
        blurEditor();
        return focusEl(te);
      }
      var ti = -1,fi = -1,ri = -1;
      for (var i = 0; i < t.length; i++) if (f === t[i]) {ti = i;break;}
      for (var i = 0; i < fl.length; i++) if (f === fl[i]) {fi = i;break;}
      for (var i = 0; i < r.length; i++) if (f === r[i]) {ri = i;break;}
      if (cm === 'torrentsearch') {
        if (ti !== -1) {
          if (dir === 'left') return focusEl(t[Math.max(0, ti - 1)] || f);
          if (dir === 'right') return focusEl(t[Math.min(t.length - 1, ti + 1)] || f);
          if (dir === 'down') return focusEl(r[Math.min(r.length - 1, ri + 1)] || f, { direction: 'down' });
          if (dir === 'up') return true;
          return true;
        }
        if (fi !== -1) {
          if (dir === 'left') return focusEl(fl[Math.max(0, fi - 1)] || f);
          if (dir === 'right') {
            if (f && f.id === 'filter-toggle') {openFilterPanelAndFocus();return true;}
            return focusEl(fl[Math.min(fl.length - 1, fi + 1)] || f);
          }
          if (dir === 'up') {return focusEl(q);}
          if (dir === 'down') {if (r.length > 0) {return focusEl(r[0], { direction: 'down' });}return true;}
          return true;
        }
        if (ri !== -1) {
          if (dir === 'up') {
            if (ri === 0) {return focusEl(q);}
            return focusEl(r[Math.max(0, ri - 1)] || f, { direction: 'up' });
          }
          if (dir === 'down') {
            return focusEl(r[Math.min(r.length - 1, ri + 1)] || f, { direction: 'down' });
          }
          if (dir === 'left') {openFilterPanelAndFocus();return true;}
          if (dir === 'right') {
            if (f && (f.classList.contains('search-result-item') || f.classList.contains('global-search-card'))) {
              var pb = f.querySelector('.search-result-play');
              var m = pb ? pb.dataset.magnet : null;
              var h = pb ? pb.dataset.hash : null;


              var idx = pb ? parseInt(pb.dataset.index, 10) : -1;
              var sr = !isNaN(idx) && idx >= 0 && idx < filteredResults.length ? filteredResults[idx] : null;
              if (m && typeof window.addTorrentSearchToServer === 'function') window.addTorrentSearchToServer(m, h, sr).then(function (ok) {

                if (!ok) return;
                var oh = pb.innerHTML;pb.style.display = 'block';pb.innerHTML = '✓';
                setTimeout(function () {pb.style.display = 'none';pb.innerHTML = oh;}, 2000);
              }).catch(function (e) {console.error('Ошибка добавления торрента:', e);});
            }
            return true;
          }
          return true;
        }
        return false;
      } else
      if (cm === 'globalsearch') {
        if (ti !== -1) {
          if (dir === 'left') return focusEl(t[Math.max(0, ti - 1)] || f);
          if (dir === 'right') return focusEl(t[Math.min(t.length - 1, ti + 1)] || f);
          if (dir === 'down') {if (r.length > 0) return focusEl(r[0]);return true;}
          if (dir === 'up') return true;
          return true;
        }
        if (fi !== -1) {
          if (dir === 'left') return focusEl(fl[Math.max(0, fi - 1)] || f);
          if (dir === 'right') {
            if (f && f.id === 'filter-toggle') {openFilterPanelAndFocus();return true;}
            return focusEl(fl[Math.min(fl.length - 1, fi + 1)] || f);
          }
          if (dir === 'up') {return focusEl(q);}
          if (dir === 'down') {if (r.length > 0) return focusEl(r[0]);return true;}
          return true;
        }
        if (ri !== -1) {
          var cols = getSearchGridColumns(),row = Math.floor(ri / cols);
          if (dir === 'left') return focusEl(r[Math.max(0, ri - 1)] || f);
          if (dir === 'right') return focusEl(r[Math.min(r.length - 1, ri + 1)] || f);
          if (dir === 'up') {if (row === 0) return focusEl(q);return focusEl(r[Math.max(0, ri - cols)] || f);}
          if (dir === 'down') return focusEl(r[Math.min(r.length - 1, ri + cols)] || f);
          return true;
        }
        return false;
      }
      return false;
    },

    onOk: function (f) {
      if (!belongsToScreen(f, 'search')) return this.ensureFocus(true, true);
      var panel = getEl('search-filters-panel');
      if (panel && panel.classList.contains('active')) {
        if (f.classList.contains('filter-item')) {
          var clickedFilterId = f.dataset.filter;
          f.click();

          setTimeout(function () {
            invalidateFocusCache();
            updateFocusableElements();
            var valuesScreen = panel.querySelector('.filter-values-screen');
            if (valuesScreen && valuesScreen.style.display !== 'none') {
              var valuesList = panel.querySelector('#filter-values-list');
              var selectedItem = valuesList ? valuesList.querySelector('.filter-value-item.selected') : null;
              if (selectedItem && VISIBLE(selectedItem)) {
                focusEl(selectedItem);
              } else if (valuesList) {
                var firstItem = valuesList.querySelector('.filter-value-item');
                if (firstItem) focusEl(firstItem);
              }
            }
          }, 50);
          return true;
        }
        if (f.classList.contains('filter-value-item')) {
          f.click();











          return true;
        }
        if (f.id === 'filter-back-btn') {
          f.click();
          setTimeout(function () {
            invalidateFocusCache();
            updateFocusableElements();
            var firstItem = panel.querySelector('.filter-item:not(.hidden)');
            if (firstItem) focusEl(firstItem);
          }, 50);
          return true;
        }
        if (f.id === 'filter-close-btn') {
          closeFilterPanel();
          return true;
        }
        if (f.id === 'reset-filters') {
          f.click();
          setTimeout(function () {
            invalidateFocusCache();
            updateFocusableElements();
            var firstItem = panel.querySelector('.filter-item:not(.hidden)');
            if (firstItem) focusEl(firstItem);
          }, 50);
          return true;
        }
      }
      if (f.id === 'search-query') {focusEl(f, { nativeFocus: true });try {f.click();} catch (e) {}try {f.focus();} catch (e) {}try {if (f.select) f.select();} catch (e) {}return true;}
      if (f.id === 'filter-toggle') {
        var p = getEl('search-filters-panel');
        if (p && !p.classList.contains('active')) {openFilterPanelAndFocus();return true;} else
        {closeFilterPanel();return true;}
      }
      if (f.tagName === 'SELECT' || f.id === 'filter-year') return openNativeSearchControl(f);
      clickEl(f);
      return true;
    }
  },
  detail: {
    getItems: getDetailItems,
    ensureFocus: function (force) {
      if (force === undefined) force = false;
      if (currentScreen() !== 'detail') return false;
      var f = document.querySelector('.focused');
      if (!force && belongsToScreen(f, 'detail')) return true;


      var items = getDetailItems();
      return focusEl(items[0]);
    },
    handleNavigation: function (dir) {
      if (detailLaneStep(dir)) return true;
      var items = getDetailItems(),f = belongsToScreen(document.querySelector('.focused'), 'detail') ? document.querySelector('.focused') : null;
      if (!f) return this.ensureFocus(true);




      if (f.classList.contains('home-nav-btn')) {
        if (!detailTopbarAvailable()) return this.ensureFocus(true);
        var nav = DetailTopbar.buttons();
        var ni = nav.indexOf(f);
        if (ni === -1) return this.ensureFocus(true);


        window.lastNavDirection = dir;
        if (dir === 'left') {DetailTopbar.focus(nav[Math.max(0, ni - 1)]);return true;}
        if (dir === 'right') {DetailTopbar.focus(nav[Math.min(nav.length - 1, ni + 1)]);return true;}
        if (dir === 'down') {hideDetailTopbar(true);return true;}
        return true;
      }
      var idx = -1;for (var i = 0; i < items.length; i++) if (f === items[i]) {idx = i;break;}
      if (idx === -1) return this.ensureFocus(true);
      var tl = [],ac = [],rc = [],fi = [];
      for (var i = 0; i < items.length; i++) {
        var e = items[i];
        if (e.classList.contains('catalog-trailer-play') || e.classList.contains('catalog-trailer-link') || e.classList.contains('catalog-trailer-card-item')) tl.push(e);
        if (e.classList.contains('catalog-actor-card')) ac.push(e);
        if (e.classList.contains('catalog-recommendation-card')) rc.push(e);
        if (e.classList && e.classList.contains('file-item')) fi.push(e);
      }
      var wb = getEl('catalog-watch-btn'),bb = getEl('back-from-detail');var ovw = getEl('catalog-toggle-overview-btn');var rut = getEl('catalog-trailer-btn');
      var isT = f.classList.contains('catalog-trailer-play') || f.classList.contains('catalog-trailer-link') || f.classList.contains('catalog-trailer-card-item');
      var isA = f.classList.contains('catalog-actor-card'),isR = f.classList.contains('catalog-recommendation-card');
      var isW = f.id === 'catalog-watch-btn',isOv = f.id === 'catalog-toggle-overview-btn',isB = f.id === 'back-from-detail',isF = f.classList && f.classList.contains('file-item');
      var isRut = f.id === 'catalog-trailer-btn';
      var ti = -1,ai = -1,ri = -1,fii = -1;
      for (var i = 0; i < tl.length; i++) if (f === tl[i]) {ti = i;break;}
      for (var i = 0; i < ac.length; i++) if (f === ac[i]) {ai = i;break;}
      for (var i = 0; i < rc.length; i++) if (f === rc[i]) {ri = i;break;}
      for (var i = 0; i < fi.length; i++) if (f === fi[i]) {fii = i;break;}

      if (isF && fii !== -1) {
        if (dir === 'left') {if (fii > 0) {focusEl(fi[fii - 1], { direction: 'left' });}return true;}
        if (dir === 'right') {if (fii < fi.length - 1) {focusEl(fi[fii + 1], { direction: 'right' });}return true;}
        if (dir === 'up') {if (ac.length > 0) {focusEl(ac[Math.min(fii, ac.length - 1)], { direction: 'up' });return true;}var prevItems = [];for (var k = idx - 1; k >= 0; k--) {if (!items[k].classList || !items[k].classList.contains('file-item')) {prevItems.push(items[k]);}}if (prevItems.length > 0) focusEl(prevItems[0], { direction: 'up' });return true;}
        if (dir === 'down') return true;
        return true;
      }
      if (isT && ti !== -1) {
        if (dir === 'left') return focusEl(tl[Math.max(0, ti - 1)] || f, { direction: 'left' });
        if (dir === 'right') return focusEl(tl[Math.min(tl.length - 1, ti + 1)] || f, { direction: 'right' });
        if (dir === 'up') {if (wb && wb.offsetParent !== null) {focusEl(wb, { direction: 'up' });return true;}return focusEl(items[Math.max(0, idx - 1)] || f, { direction: 'up' });}
        if (dir === 'down') {if (ac.length > 0) {focusEl(ac[0], { direction: 'down' });return true;} else if (rc.length > 0) {focusEl(rc[0], { direction: 'down' });return true;} else if (fi.length > 0) {focusEl(fi[0], { direction: 'down' });return true;}return true;}
        return true;
      }
      if (isA && ai !== -1) {
        if (dir === 'left') return focusEl(ac[Math.max(0, ai - 1)] || f, { direction: 'left' });
        if (dir === 'right') return focusEl(ac[Math.min(ac.length - 1, ai + 1)] || f, { direction: 'right' });
        if (dir === 'up') {if (tl.length > 0) {focusEl(tl[tl.length - 1], { direction: 'up' });return true;} else if (wb && wb.offsetParent !== null) {focusEl(wb, { direction: 'up' });return true;}var pgb = getEl('detail-progress-btn');if (pgb && pgb.offsetParent !== null) {focusEl(pgb, { direction: 'up' });return true;}return focusEl(items[Math.max(0, idx - 1)] || f, { direction: 'up' });}
        if (dir === 'down') {if (rc.length > 0) {var t = ai < rc.length ? ai : rc.length - 1;focusEl(rc[t], { direction: 'down' });return true;} else if (fi.length > 0) {focusEl(fi[0], { direction: 'down' });return true;}return true;}
        return true;
      }
      if (isR && ri !== -1) {
        if (dir === 'left') return focusEl(rc[Math.max(0, ri - 1)] || f, { direction: 'left' });
        if (dir === 'right') return focusEl(rc[Math.min(rc.length - 1, ri + 1)] || f, { direction: 'right' });
        if (dir === 'up') {if (ac.length > 0) {var t = ri < ac.length ? ri : ac.length - 1;focusEl(ac[t], { direction: 'up' });return true;} else if (tl.length > 0) {var t = ri < tl.length ? ri : tl.length - 1;focusEl(tl[t], { direction: 'up' });return true;} else if (wb && wb.offsetParent !== null) {focusEl(wb, { direction: 'up' });return true;}return focusEl(items[Math.max(0, idx - 1)] || f, { direction: 'up' });}
        if (dir === 'down') {if (fi.length > 0) {focusEl(fi[0], { direction: 'down' });return true;}return true;}
        return true;
      }















      var actionRow = getDetailActionButtons();
      var actIdx = actionRow.indexOf(f);
      if (actIdx !== -1) {
        if (dir === 'left') {
          if (actIdx > 0) return focusEl(actionRow[actIdx - 1], { direction: 'left' });
          return true;
        }
        if (dir === 'right') {
          if (actIdx < actionRow.length - 1) return focusEl(actionRow[actIdx + 1], { direction: 'right' });
          return true;
        }
        if (dir === 'down') {
          if (tl.length > 0) {focusEl(tl[0], { direction: 'down' });return true;}
          if (ac.length > 0) {focusEl(ac[0], { direction: 'down' });return true;}
          if (rc.length > 0) {focusEl(rc[0], { direction: 'down' });return true;}
          if (fi.length > 0) {focusEl(fi[0], { direction: 'down' });return true;}
          return true;
        }


        if (dir === 'up') {revealDetailTopbar(f);return true;}
        return true;
      }
      if (isB) {
        if (dir === 'down') {if (wb && wb.offsetParent !== null) {focusEl(wb, { direction: 'down' });return true;}return focusEl(items[Math.min(items.length - 1, idx + 1)] || f, { direction: 'down' });}
        if (dir === 'up') {revealDetailTopbar(f);return true;}
        if (dir === 'left' || dir === 'right') return true;
        return true;
      }
      if (dir === 'up') {var t = items[Math.max(0, idx - 1)] || f;focusEl(t, { direction: 'up' });return true;}
      if (dir === 'down') {var t = items[Math.min(items.length - 1, idx + 1)] || f;focusEl(t, { direction: 'down' });return true;}
      return true;
    },
    onOk: function (f) {
      if (!belongsToScreen(f, 'detail')) return this.ensureFocus(true);
      if (f.classList.contains('file-item')) {clickEl(f.querySelector('.play-btn') || f);return true;}
      if (f.classList.contains('detail-progress-btn')) {clickEl(f);return true;}
      clickEl(f);
      return true;
    }
  },

  config: {
    getItems: getConfigItems,
    ensureFocus: function (force) {
      if (force === undefined) force = false;
      if (currentScreen() !== 'config') return false;
      if (!configState.initialized) {
        configState.initialized = true;
        configState.activeTabId = 'torrserver-tab';
        configState.isOnMenu = true;
        switchConfigTab('torrserver-tab');
        setConfigMenuActive('torrserver-tab');
      }
      var focusedElement = document.querySelector('.focused');
      if (!force && belongsToScreen(focusedElement, 'config')) return true;
      var menuItems = getConfigMenuItems();
      if (configState.isOnMenu) {
        var targetMenuItem = getEl(configState.activeTabId);
        if (targetMenuItem && VISIBLE(targetMenuItem)) return focusEl(targetMenuItem);
        return focusEl(menuItems[0]);
      } else {
        var contentItems = getConfigContentItems(configState.activeTabId);
        if (contentItems.length > 0) return focusEl(contentItems[0]);
        configState.isOnMenu = true;
        return focusEl(getEl(configState.activeTabId));
      }
    },
    handleNavigation: function (dir) {
      return handleConfigNavigation(dir);
    },
    onOk: function (f) {
      if (!belongsToScreen(f, 'config')) return this.ensureFocus(true);
      return handleConfigNavigation('enter');
    }
  }
};


function handleFilterPanelNavigation(dir, currentElement) {
  var panel = getEl('search-filters-panel');
  if (!panel) return false;


  invalidateFocusCache();
  updateFocusableElements();

  var filterItems = Array.from(panel.querySelectorAll('.filter-item'));
  var filterValueItems = Array.from(panel.querySelectorAll('.filter-value-item'));
  var backBtn = getEl('filter-back-btn');
  var closeBtn = getEl('filter-close-btn');
  var resetBtn = getEl('reset-filters');


  var mainScreen = panel.querySelector('.filter-main-screen');
  var valuesScreen = panel.querySelector('.filter-values-screen');
  var isMainScreen = mainScreen && mainScreen.style.display !== 'none';
  var isValuesScreen = valuesScreen && valuesScreen.style.display !== 'none';

  if (isMainScreen) {

    var allItems = [];
    if (closeBtn && VISIBLE(closeBtn)) allItems.push(closeBtn);
    for (var i = 0; i < filterItems.length; i++) allItems.push(filterItems[i]);
    if (resetBtn && VISIBLE(resetBtn)) allItems.push(resetBtn);

    var idx = allItems.indexOf(currentElement);

    if (dir === 'up') {
      if (idx > 0) return focusEl(allItems[idx - 1], { direction: 'up' });
      return true;
    }
    if (dir === 'down') {
      if (idx < allItems.length - 1) return focusEl(allItems[idx + 1], { direction: 'down' });
      return true;
    }
    if (dir === 'left') {

      closeFilterPanel();
      return true;
    }
    if (dir === 'right') return true;
  }

  if (isValuesScreen) {

    var allItems = [];
    if (backBtn && VISIBLE(backBtn)) allItems.push(backBtn);
    for (var i = 0; i < filterValueItems.length; i++) allItems.push(filterValueItems[i]);

    var idx = allItems.indexOf(currentElement);

    if (dir === 'up') {
      if (idx > 0) return focusEl(allItems[idx - 1], { direction: 'up' });
      return true;
    }
    if (dir === 'down') {

      if (currentElement === backBtn) {
        var selectedInList = panel.querySelector('.filter-value-item.selected');
        if (selectedInList && VISIBLE(selectedInList)) {
          return focusEl(selectedInList, { direction: 'down' });
        }
      }
      if (idx < allItems.length - 1) return focusEl(allItems[idx + 1], { direction: 'down' });
      return true;
    }
    if (dir === 'left') {

      if (backBtn && VISIBLE(backBtn)) {
        backBtn.click();
        return true;
      }
    }
    if (dir === 'right') return true;
  }

  return true;
}



function updateFocusableElements() {
  var now = Date.now();
  var screen = AppState.currentScreen;


  if (_focusCache.screen === screen &&
  _focusCache.elements.length > 0 &&
  _focusCache.gen === _focusGen && (
  screen === 'catalog' || now - _focusCache.timestamp < _focusCache.ttl) &&
  _focusCache.elements[0].isConnected !== false) {
    focusableElements = _focusCache.elements;
    return;
  }

  var episodesPanel = getEl('episodes-panel');
  var audioPanel = getEl('audio-panel');
  var subtitlesPanel = getEl('subtitles-panel');
  var isEpisodesOpen = episodesPanel && !episodesPanel.classList.contains('hidden');
  var isAudioOpen = audioPanel && !audioPanel.classList.contains('hidden');
  var isSubtitlesOpen = subtitlesPanel && !subtitlesPanel.classList.contains('hidden');
  var list = [];

  if (isEpisodesOpen) {
    var items = episodesPanel.querySelectorAll('.episode-item, .close-panel-btn');
    for (var i = 0; i < items.length; i++) if (items[i] && items[i].offsetParent !== null) list.push(items[i]);
    focusableElements = list;
    _focusCache.timestamp = now;
    _focusCache.screen = screen;
    _focusCache.elements = focusableElements.slice();
    _focusCache.gen = _focusGen;
    return;
  }
  if (isAudioOpen) {
    var items = audioPanel.querySelectorAll('.audio-item, .close-panel-btn');
    for (var i = 0; i < items.length; i++) if (items[i] && items[i].offsetParent !== null) list.push(items[i]);
    focusableElements = list;
    _focusCache.timestamp = now;
    _focusCache.screen = screen;
    _focusCache.elements = focusableElements.slice();
    _focusCache.gen = _focusGen;
    return;
  }
  if (isSubtitlesOpen) {
    var items = subtitlesPanel.querySelectorAll('.subtitle-item, .close-panel-btn');
    for (var i = 0; i < items.length; i++) if (items[i] && items[i].offsetParent !== null) list.push(items[i]);
    focusableElements = list;
    _focusCache.timestamp = now;
    _focusCache.screen = screen;
    _focusCache.elements = focusableElements.slice();
    _focusCache.gen = _focusGen;
    return;
  }
  if (screen === 'sync') {
    var btn = getEl('sync-close-btn');if (btn && btn.offsetParent !== null) list.push(btn);
    var inp = getEl('sync-code-input');if (inp && inp.offsetParent !== null) list.push(inp);
    focusableElements = list;
    _focusCache.timestamp = now;
    _focusCache.screen = screen;
    _focusCache.elements = focusableElements.slice();
    _focusCache.gen = _focusGen;
    return;
  }
  if (screen === 'player') {
    var c = getEl('controls-container');
    if (c && !c.classList.contains('idle-hidden')) {
      var seek = getEl('seek-slider');
      var skipBtn = getEl('skip-button');
      var btns = document.querySelectorAll('#prev-episode-btn, #play-pause-btn, #next-episode-btn, #audio-btn, #subtitles-btn, #episodes-btn, #mute-btn, #zoom-mode-btn, #toggle-buffer-btn');
      for (var i = 0; i < btns.length; i++) if (btns[i] && btns[i].offsetParent !== null) list.push(btns[i]);
      if (seek && seek.offsetParent !== null) list.unshift(seek);
      if (skipBtn && !skipBtn.classList.contains('hidden') && skipBtn.offsetParent !== null) list.push(skipBtn);
    }
    focusableElements = list.filter(function (e) {return e && e.offsetParent !== null;});
    _focusCache.timestamp = now;
    _focusCache.screen = screen;
    _focusCache.elements = focusableElements.slice();
    _focusCache.gen = _focusGen;
    return;
  }
  if (screen === 'detail') {


    var sel = '#detail-view .home-nav-btn, .detail-progress-btn, .file-item, .catalog-watch-btn, .catalog-toggle-overview-btn, .catalog-trailer-btn, .catalog-actor-card, .catalog-recommendation-card';
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) if (els[i] && els[i].offsetParent !== null) list.push(els[i]);
    focusableElements = list;
    _focusCache.timestamp = now;
    _focusCache.screen = screen;
    _focusCache.elements = focusableElements.slice();
    _focusCache.gen = _focusGen;
    return;
  }
  if (screen === 'home') {












    var bar = getEl('home-topbar');



    var barHere = bar && !(bar.parentNode && bar.parentNode.id === 'detail-view');
    if (barHere && bar.style.display !== 'none' && !bar.classList.contains('hidden')) {
      var navBtns = bar.querySelectorAll('.home-nav-btn');
      for (var i = 0; i < navBtns.length; i++) list.push(navBtns[i]);
    }

    var homePlay = getEl('home-play-btn');
    if (homePlay && !homePlay.hidden && homePlay.style.display !== 'none') list.push(homePlay);




    var homeRows = document.querySelectorAll('#home-rows .catalog-row');
    for (var hr = 0; hr < homeRows.length; hr++) {
      if (homeRows[hr].classList.contains(HOME_HIDDEN_ROW_CLASS)) continue;
      var rowCards = homeRows[hr].querySelectorAll('.torrent-card.catalog-card');
      for (var rc = 0; rc < rowCards.length; rc++) list.push(rowCards[rc]);
    }
    focusableElements = list;
    _focusCache.timestamp = now;
    _focusCache.screen = screen;
    _focusCache.elements = focusableElements.slice();
    _focusCache.gen = _focusGen;
    return;
  }
  if (screen === 'torrents') {
    var searchInput = getEl('search-query'),searchBtn = getEl('search-btn'),settingsBtn = getEl('settings-btn');
    var tabTorrents = getEl('tab-torrents'),tabSearch = getEl('tab-search'),tabCatalog = getEl('tab-catalog');



    var torrentsGrid = getEl('torrents-grid');
    var cards = [];
    if (torrentsGrid && torrentsGrid.offsetParent !== null) {
      var allCards = torrentsGrid.querySelectorAll('.torrent-card');
      for (var i = 0; i < allCards.length; i++) cards.push(allCards[i]);
    }
    var cols = getTorrentGridColumns();
    var rows = [];for (var j = 0; j < cards.length; j += cols) rows.push(cards.slice(j, j + cols));
    window.torrentRows = { row1: [searchInput, searchBtn, settingsBtn].filter(Boolean), row2: [tabTorrents, tabSearch, tabCatalog].filter(Boolean), cardRows: rows, allCards: cards };
    var focusList = cards.slice();
    if (searchInput && searchInput.offsetParent !== null) focusList.push(searchInput);
    if (searchBtn && searchBtn.offsetParent !== null) focusList.push(searchBtn);


    var navBtns = getTorrentTabs();
    for (var n = 0; n < navBtns.length; n++) if (focusList.indexOf(navBtns[n]) === -1) focusList.push(navBtns[n]);



    focusableElements = focusList;
    _focusCache.timestamp = now;
    _focusCache.screen = screen;
    _focusCache.elements = focusableElements.slice();
    _focusCache.gen = _focusGen;
    return;
  }
  if (screen === 'catalog') {


    var cards = getCatalogGridCards();
    for (var i = 0; i < cards.length; i++) list.push(cards[i]);




    var scope = visibleCatalogScope();
    if (scope) {
      var rowHeaders = scope.querySelectorAll('.catalog-row-header');
      for (var rh = 0; rh < rowHeaders.length; rh++) list.push(rowHeaders[rh]);
    }


    window.catalogCards = list.slice();
    var catNav = getTorrentTabs();
    for (var cn = 0; cn < catNav.length; cn++) if (list.indexOf(catNav[cn]) === -1) list.push(catNav[cn]);



    focusableElements = list;
    _focusCache.timestamp = now;
    _focusCache.screen = screen;
    _focusCache.elements = list;
    _focusCache.gen = _focusGen;
    return;
  }
  if (screen === 'search') {
    var q = getEl('search-query'),ft = getEl('filter-toggle'),sb = getEl('search-btn'),cs = getEl('close-search');



    if (window.AppState && AppState.searchLocked) {q = null;sb = null;}




    var resultsHost = getEl('search-results');
    var res = [];
    if (resultsHost && resultsHost.offsetParent !== null) {
      var ris = resultsHost.querySelectorAll('.search-result-item, .global-search-card');
      for (var i = 0; i < ris.length; i++) res.push(ris[i]);
    }

    var fl = [q, ft, sb, cs];


    var filterPanel = getEl('search-filters-panel');
    if (filterPanel && filterPanel.classList.contains('active')) {
      var backBtn = getEl('filter-back-btn');
      var closeBtn = getEl('filter-close-btn');
      var resetBtn = getEl('reset-filters');


      if (backBtn && VISIBLE(backBtn)) fl.push(backBtn);
      if (closeBtn && VISIBLE(closeBtn)) fl.push(closeBtn);


      var filterItems = filterPanel.querySelectorAll('.filter-item');
      for (var fi = 0; fi < filterItems.length; fi++) {
        if (filterItems[fi] && filterItems[fi].offsetParent !== null) fl.push(filterItems[fi]);
      }


      var valueItems = filterPanel.querySelectorAll('.filter-value-item');
      for (var vi = 0; vi < valueItems.length; vi++) {
        if (valueItems[vi] && valueItems[vi].offsetParent !== null) fl.push(valueItems[vi]);
      }


      if (resetBtn && VISIBLE(resetBtn)) fl.push(resetBtn);
    }


    for (var i = 0; i < res.length; i++) fl.push(res[i]);

    focusableElements = fl.filter(Boolean);
    _focusCache.timestamp = now;
    _focusCache.screen = screen;
    _focusCache.elements = focusableElements.slice();
    _focusCache.gen = _focusGen;
    return;
  }
  if (screen === 'config') {
    var ids = ['torrserver-tab', 'torrents-tab', 'player-tab', 'appearance-tab', 'account-tab', 'sync-tab', 'other-tab', 'device-tab'];
    var cfg = document.querySelectorAll('.settings-btn');
    for (var i = 0; i < ids.length; i++) {var e = getEl(ids[i]);if (e && e.offsetParent !== null) list.push(e);}
    for (var i = 0; i < cfg.length; i++) if (cfg[i] && cfg[i].offsetParent !== null) list.push(cfg[i]);
    focusableElements = list;
    _focusCache.timestamp = now;
    _focusCache.screen = screen;
    _focusCache.elements = focusableElements.slice();
    _focusCache.gen = _focusGen;
    return;
  }
  focusableElements = [];
  _focusCache.timestamp = now;
  _focusCache.screen = screen;
  _focusCache.elements = focusableElements.slice();
  _focusCache.gen = _focusGen;
}


function setFocus(index) {
  if (focusableElements.length === 0) {updateFocusableElements();if (focusableElements.length === 0) return;}
  if (index < 0) index = focusableElements.length - 1;
  if (index >= focusableElements.length) index = 0;
  currentFocusIndex = index;
  var element = focusableElements[currentFocusIndex];
  if (!element) return;


  focusEl(element, { direction: lastNavDirection });

  if (AppState.currentScreen === 'config') {
    switchConfigTab(element.id);
  }
  if (AppState.currentScreen === 'torrents' && element.classList.contains('torrent-card')) {
    var row1Len = window.torrentRows && window.torrentRows.row1 ? window.torrentRows.row1.length : 0;
    var row2Len = window.torrentRows && window.torrentRows.row2 ? window.torrentRows.row2.length : 0;
    var torrentIndex = currentFocusIndex - (row1Len + row2Len);
    var t = AppState.torrents[torrentIndex];
    if (t && t.hash) {lastSelectedTorrentHash = t.hash;lastSelectedTorrentIndex = torrentIndex;} else
    if (element.dataset.hash) {lastSelectedTorrentHash = element.dataset.hash;lastSelectedTorrentIndex = torrentIndex >= 0 ? torrentIndex : 0;}
    window.lastSelectedTorrentHash = lastSelectedTorrentHash;
    window.lastSelectedTorrentIndex = lastSelectedTorrentIndex;
  }
  if (document.activeElement && document.activeElement.tagName === 'INPUT') {
    var allowed = ['search-query', 'torrserver-url', 'auth-login', 'auth-password', 'jacred-url'];
    if (allowed.indexOf(element.id) === -1) document.activeElement.blur();
  }
}

function focusFirstTorrentCard(retries, delay) {
  if (retries === undefined) retries = 6;if (delay === undefined) delay = 120;
  if (AppState.currentScreen !== 'torrents') return false;
  updateFocusableElements();
  for (var i = 0; i < focusableElements.length; i++) {
    if (focusableElements[i].classList && focusableElements[i].classList.contains('torrent-card')) {setFocus(i);return true;}
  }
  if (retries > 0) setTimeout(function () {focusFirstTorrentCard(retries - 1, delay);}, delay);
  return false;
}

function focusSearchHome(preferQuery) {
  if (preferQuery === undefined) preferQuery = true;
  updateFocusableElements();
  var qi = -1,si = -1,fi = -1;
  for (var i = 0; i < focusableElements.length; i++) {
    var e = focusableElements[i];
    if (e.id === 'search-query') qi = i;
    if (e.id === 'search-btn') si = i;
    if (fi === -1 && ['filter-toggle', 'torrent-movie', 'sort-by', 'filter-quality', 'filter-content-type', 'filter-tracker', 'filter-year', 'filter-season', 'filter-voice', 'filter-videotype', 'reset-filters', 'close-search'].indexOf(e.id) !== -1) fi = i;
  }
  var target = preferQuery && qi !== -1 ? qi : si !== -1 ? si : fi !== -1 ? fi : 0;
  setFocus(target);
}


function navigate(direction) {
  if (typeof setNavHold === 'function') setNavHold(direction);





  if (!acceptNavStep(direction)) return;

  lastNavDirection = direction;
  var active = document.activeElement;
  if (active && active.id === 'search-query') {
    active.blur();updateFocusableElements();
    if (AppState.currentScreen === 'search') {
      var ff = -1,fr = -1;
      for (var i = 0; i < focusableElements.length; i++) {var e = focusableElements[i];if (['filter-toggle', 'torrent-movie', 'sort-by', 'filter-quality', 'filter-content-type', 'filter-tracker', 'filter-year', 'filter-season', 'filter-voice', 'filter-videotype', 'reset-filters', 'close-search'].indexOf(e.id) !== -1 && ff === -1) ff = i;if (e.classList && e.classList.contains('search-result-item') && fr === -1) fr = i;}
      setFocus(direction === 'down' && fr !== -1 ? fr : ff !== -1 ? ff : fr !== -1 ? fr : 0);return;
    }
    var fc = -1;for (var i = 0; i < focusableElements.length; i++) if (focusableElements[i].classList && focusableElements[i].classList.contains('torrent-card')) {fc = i;break;}
    setFocus(fc !== -1 ? fc : 0);return;
  }
  if (focusableElements.length === 0) {
    updateFocusableElements();if (focusableElements.length === 0) return;
    if (AppState.currentScreen === 'torrents') {var fc = -1;for (var i = 0; i < focusableElements.length; i++) if (focusableElements[i].classList && focusableElements[i].classList.contains('torrent-card')) {fc = i;break;}setFocus(fc !== -1 ? fc : 0);} else
    if (AppState.currentScreen === 'search') {var ff = -1;for (var i = 0; i < focusableElements.length; i++) if (['filter-toggle', 'torrent-movie', 'sort-by', 'filter-quality', 'filter-content-type', 'filter-tracker', 'filter-year', 'filter-season', 'filter-voice', 'filter-videotype', 'reset-filters', 'close-search'].indexOf(focusableElements[i].id) !== -1) {ff = i;break;}setFocus(ff !== -1 ? ff : 0);}
    return;
  }
  var cur = focusableElements[currentFocusIndex];


  if (AppState.currentScreen === 'torrents') {
    var sBtn = getEl('settings-btn'),tT = getEl('tab-torrents'),tS = getEl('tab-search'),tC = getEl('tab-catalog');
    var cards = window.torrentRows && window.torrentRows.allCards ? window.torrentRows.allCards : [];
    if (!cur) {if (cards.length > 0) setFocus(focusableElements.indexOf(cards[0]));else {var f = -1;for (var i = 0; i < focusableElements.length; i++) if (focusableElements[i].id === 'tab-torrents') {f = i;break;}setFocus(f !== -1 ? f : 0);}return;}
    var isSet = cur === sBtn,isTT = cur === tT,isTS = cur === tS,isTC = cur === tC,isC = false,cIdx = -1;
    for (var i = 0; i < cards.length; i++) if (cur === cards[i]) {isC = true;cIdx = i;break;}
    var cols = getTorrentGridColumns();
    switch (direction) {
      case 'up':if (isC) {if (cIdx < cols) setFocus(focusableElements.indexOf(tT));else setFocus(focusableElements.indexOf(cards[cIdx - cols]));} else if (isTT || isTS || isTC) {if (cards.length > 0) setFocus(focusableElements.indexOf(cards[0]));}break;
      case 'down':if (isSet) setFocus(focusableElements.indexOf(tT));else if (isTT || isTS || isTC) {if (cards.length > 0) setFocus(focusableElements.indexOf(cards[0]));} else if (isC) {if (cIdx + cols < cards.length) setFocus(focusableElements.indexOf(cards[cIdx + cols]));}break;
      case 'left':if (isSet) setFocus(focusableElements.indexOf(tC));else if (isTC) setFocus(focusableElements.indexOf(tS));else if (isTS) setFocus(focusableElements.indexOf(tT));else if (isC && cIdx > 0 && cIdx % cols !== 0) setFocus(focusableElements.indexOf(cards[cIdx - 1]));break;
      case 'right':if (isTT) setFocus(focusableElements.indexOf(tS));else if (isTS) setFocus(focusableElements.indexOf(tC));else if (isC && cIdx < cards.length - 1 && (cIdx + 1) % cols !== 0) setFocus(focusableElements.indexOf(cards[cIdx + 1]));break;
    }
    return;
  }


  if (AppState.currentScreen === 'catalog') {
    var cards = window.catalogCards || [];if (!cards.length) return;
    var cIdx = -1;for (var i = 0; i < cards.length; i++) if (cur === cards[i]) {cIdx = i;break;}
    var cols = getTorrentGridColumns();
    switch (direction) {
      case 'left':if (cIdx > 0 && cIdx % cols !== 0) setFocus(focusableElements.indexOf(cards[cIdx - 1]));break;
      case 'right':if (cIdx < cards.length - 1 && (cIdx + 1) % cols !== 0) setFocus(focusableElements.indexOf(cards[cIdx + 1]));break;
      case 'up':if (cIdx >= cols) setFocus(focusableElements.indexOf(cards[cIdx - cols]));break;
      case 'down':if (cIdx + cols < cards.length) {setFocus(focusableElements.indexOf(cards[cIdx + cols]));if (typeof window.checkAndLoadMoreOnNavigation === 'function') window.checkAndLoadMoreOnNavigation();} else if (cIdx === cards.length - 1 && typeof window.checkAndLoadMoreOnNavigation === 'function') window.checkAndLoadMoreOnNavigation();break;
    }
    return;
  }


  if (AppState.currentScreen === 'player') {
    var cc = getEl('controls-container');if (!cc || cc.classList.contains('idle-hidden')) return;
    var ep = getEl('episodes-panel'),ap = getEl('audio-panel'),sp = getEl('subtitles-panel');
    var isOpen = ep && !ep.classList.contains('hidden') || ap && !ap.classList.contains('hidden') || sp && !sp.classList.contains('hidden');

    if (isOpen) {

      if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
      updateFocusableElements();

      var panelLen = focusableElements.length;
      if (panelLen === 0) return;


      var actualFocused = document.querySelector('.focused');
      if (actualFocused) {
        var actualIndex = focusableElements.indexOf(actualFocused);
        if (actualIndex !== -1) {
          currentFocusIndex = actualIndex;
        }
      }


      if (currentFocusIndex < 0) currentFocusIndex = 0;
      if (currentFocusIndex >= panelLen) currentFocusIndex = panelLen - 1;


      if (direction === 'up') {
        if (currentFocusIndex > 0) {
          setFocus(currentFocusIndex - 1);
        }

      } else if (direction === 'down') {
        if (currentFocusIndex < panelLen - 1) {
          setFocus(currentFocusIndex + 1);
        }

      }
      return;
    }

    if (cur && cur.id === 'seek-slider') {if (direction === 'down' && focusableElements.length > 1) setFocus(1);return;}
    if (direction === 'up') setFocus(0);else if (direction === 'left' && currentFocusIndex > 1) setFocus(currentFocusIndex - 1);else if (direction === 'right' && currentFocusIndex < focusableElements.length - 1) setFocus(currentFocusIndex + 1);
    return;
  }

  if (AppState.currentScreen === 'search') {
    var q = getEl('search-query'),fl = [],res = [];
    for (var i = 0; i < focusableElements.length; i++) {var e = focusableElements[i];if (['torrent-movie', 'sort-by', 'filter-quality', 'filter-content-type', 'filter-tracker', 'filter-year', 'filter-season', 'filter-voice', 'filter-videotype', 'reset-filters', 'close-search'].indexOf(e.id) !== -1) fl.push(e);if (e.classList && (e.classList.contains('search-result-item') || e.classList.contains('global-search-card'))) res.push(e);}
    var fIdx = -1,rIdx = -1;for (var i = 0; i < fl.length; i++) if (cur === fl[i]) {fIdx = i;break;}for (var i = 0; i < res.length; i++) if (cur === res[i]) {rIdx = i;break;}
    if (!cur) {if (q && focusableElements.indexOf(q) !== -1) setFocus(focusableElements.indexOf(q));else if (fl.length > 0) setFocus(focusableElements.indexOf(fl[0]));else if (res.length > 0) setFocus(focusableElements.indexOf(res[0]));return;}
    if (cur === q) {if (['left', 'right', 'down', 'up'].indexOf(direction) !== -1) setFocus(fl.length > 0 ? focusableElements.indexOf(fl[0]) : res.length > 0 ? focusableElements.indexOf(res[0]) : 0);return;}
    if (fIdx !== -1) {if (direction === 'left') setFocus(focusableElements.indexOf(fl[Math.max(0, fIdx - 1)]));else if (direction === 'right') setFocus(focusableElements.indexOf(fl[Math.min(fl.length - 1, fIdx + 1)]));else if (direction === 'down') setFocus(res.length > 0 ? focusableElements.indexOf(res[0]) : focusableElements.indexOf(fl[Math.min(fl.length - 1, fIdx + 1)]));else if (direction === 'up') setFocus(q && focusableElements.indexOf(q) !== -1 ? focusableElements.indexOf(q) : focusableElements.indexOf(fl[Math.max(0, fIdx - 1)]));return;}
    if (rIdx !== -1) {if (direction === 'up') setFocus(rIdx === 0 && fl.length > 0 ? focusableElements.indexOf(fl[0]) : focusableElements.indexOf(res[Math.max(0, rIdx - 1)]));else if (direction === 'down') setFocus(focusableElements.indexOf(res[Math.min(res.length - 1, rIdx + 1)]));return;}
  }


  switch (direction) {case 'up':setFocus(currentFocusIndex - 1);break;case 'down':setFocus(currentFocusIndex + 1);break;case 'left':setFocus(currentFocusIndex - 1);break;case 'right':setFocus(currentFocusIndex + 1);break;}
}



function keyToDirection(keyCode) {return arrowDir(keyCode);}
function stopSeeking() {if (seekHoldInterval) {clearInterval(seekHoldInterval);seekHoldInterval = null;}}


function onOk() {
  var s = currentScreen();
  var f = document.querySelector('.focused');
  var strategy = ScreenStrategies[s];

  if (!strategy) return false;
  if (!f) return strategy.ensureFocus ? strategy.ensureFocus(true) : false;

  return strategy.onOk(f);
}




function isHomeUnderneath() {
  var h = getEl('content-home');
  return !!(h && !h.hidden);
}

function onBack() {
  var s = getEl('search-overlay'),d = getEl('detail-view'),c = getEl('config-screen');
  var cat = currentScreen() === 'catalog',dn = currentScreen() === 'donate';
  var hm = currentScreen() === 'home';

  var configScreen = getEl('config-screen');

  var filterPanel = getEl('search-filters-panel');
  if (filterPanel && filterPanel.classList.contains('active')) {

    var valuesScreen = filterPanel.querySelector('.filter-values-screen');
    if (valuesScreen && valuesScreen.style.display !== 'none') {

      var backBtn = getEl('filter-back-btn');
      if (backBtn) backBtn.click();
      return true;
    } else {

      closeFilterPanel();
      return true;
    }
  }





  if (window.UICustomizer && typeof UICustomizer.isOpen === 'function' &&
  UICustomizer.isOpen() && typeof UICustomizer.close === 'function') {
    UICustomizer.close();
    return true;
  }














  var donateScreen = getEl('donate-overlay');
  if (donateScreen && _isScreenVisible(donateScreen)) {
    if (typeof window.closeDonateOverlay === 'function') window.closeDonateOverlay();
    return true;
  }

  if (configScreen && _isScreenVisible(configScreen)) {
    var focusedElement = document.querySelector('.focused');
    var menuItems = getConfigMenuItems();
    var isOnMenu = false;
    for (var i = 0; i < menuItems.length; i++) {
      if (focusedElement === menuItems[i]) {isOnMenu = true;break;}
    }
    if (!isOnMenu) {handleConfigNavigation('back');return true;} else
    {
      for (var i = 0; i < menuItems.length; i++) menuItems[i].classList.remove('active');
      configState.activeTabId = null;
      configState.isOnMenu = true;
      configState.initialized = false;
      configScreen.style.display = 'none';
      var torrserverSection = getEl('torrserver-section');


      if (torrserverSection) {
        if (typeof Animations !== 'undefined' && typeof Animations.fadeIn === 'function') {
          Animations.fadeIn(torrserverSection, { display: 'block', duration: Animations.UI_FADE.screen });
        } else {
          torrserverSection.style.display = 'block';
        }
      }




      var returnTo = window.Nav ? Nav.returnTarget(Nav.pop('config')) : null;
      if (!returnTo) returnTo = isHomeUnderneath() ? 'home' : 'torrents';



      if (returnTo === 'detail' && typeof window.restoreDetailAfterOverlay === 'function' &&
      window.restoreDetailAfterOverlay()) {
        return true;
      }

      if (returnTo === 'home' && window.HomeScreen) {
        window.HomeScreen.show({ restoreFocus: true });
        return true;
      }

      try {window.AppState.currentScreen = returnTo;} catch (e) {}
      setTimeout(function () {



        if (restoreScreenFocus(returnTo)) return;
        if (returnTo === 'torrents') return;
        try {window.AppState.currentScreen = 'torrents';} catch (e) {}
        ScreenStrategies.torrents.ensureFocus(true);
      }, 180);
      return true;
    }
  }

  if (AppState.syncCodeScreen == true) {toggleSyncOverlay();return true;}
  if (typeof window.closeCatalogTrailerOverlay === 'function' && window.closeCatalogTrailerOverlay()) {
    setTimeout(function () {ScreenStrategies.detail.ensureFocus(true);}, 80);
    return true;
  }

  var filterPanel = getEl('search-filters-panel');
  if (filterPanel && filterPanel.classList.contains('active')) {
    var valuesScreen = filterPanel.querySelector('.filter-values-screen');
    if (valuesScreen && valuesScreen.style.display !== 'none') {

      var backBtn = getEl('filter-back-btn');
      if (backBtn) backBtn.click();
    } else {

      closeFilterPanel();
    }
    return true;
  }
  if (s && !s.classList.contains('hidden') && _isScreenVisible(s)) {
    if (typeof window.hideSearchResults === 'function') {
      window.hideSearchResults();




      if (!isHomeUnderneath() && AppState.currentScreen !== 'detail') focusEl(getEl('tab-search'));
    } else
    leaveSearchToTorrents();
    return true;
  }
  if (d && _isScreenVisible(d)) {


    if (hideDetailTopbar(true)) return true;
    if (AppState.trailerPlay) {
      ovh = getEl('catalog-toggle-overview-btn');
      stopTrailerBackground();
      focusEl(ovh);
      return true;
    }
    clickEl(getEl('back-from-detail') || document.querySelector('.back-btn'));
    return true;
  }
  if (dn) {if (typeof window.closeDonateOverlay === 'function') window.closeDonateOverlay();return true;}
  if (hm) {


    if (window.HomeScreen && typeof window.HomeScreen.handleBack === 'function') {
      return window.HomeScreen.handleBack();
    }
    return true;
  }
  if (cat) {



    if (isCatalogRowsMode()) return true;
    if (window.catalogState) {window.catalogState.lastSelectedIndex = 0;window.catalogState.lastSelectedId = null;localStorage.removeItem('lastCatalogCardIndex');}
    if (typeof window.backToCatalogList === 'function') {AppState.currentScreen = 'catalog';window.backToCatalogList();} else
    clickEl(getEl('back-from-catalog'));
    setTimeout(function () {ScreenStrategies.catalog.ensureFocus(true);}, 180);
    return true;
  }
  if (c && _isScreenVisible(c)) {
    var m = getEl('torrserver-section');
    c.style.display = 'none';
    if (m) m.style.display = 'block';
    if (isHomeUnderneath() && window.HomeScreen) {
      window.HomeScreen.show({ restoreFocus: true });
      return true;
    }
    try {window.AppState.currentScreen = 'torrents';} catch (e) {}
    setTimeout(function () {ScreenStrategies.torrents.ensureFocus(true);}, 180);
    return true;
  }
  return false;
}

function isArrowKey(kc) {return KEY_CODES.ARROWS.LEFT === kc || KEY_CODES.ARROWS.UP === kc || KEY_CODES.ARROWS.RIGHT === kc || KEY_CODES.ARROWS.DOWN === kc || typeof isKeyPressed === 'function' && (isKeyPressed('UP', kc) || isKeyPressed('DOWN', kc) || isKeyPressed('LEFT', kc) || isKeyPressed('RIGHT', kc));}
function arrowDir(kc) {if ([37, 38, 39, 40].indexOf(kc) !== -1) return { 37: 'left', 38: 'up', 39: 'right', 40: 'down' }[kc];if (typeof isKeyPressed === 'function') {if (isKeyPressed('UP', kc)) return 'up';if (isKeyPressed('DOWN', kc)) return 'down';if (isKeyPressed('LEFT', kc)) return 'left';if (isKeyPressed('RIGHT', kc)) return 'right';}return null;}
function isOkKey(kc) {return kc === 13 || typeof isKeyPressed === 'function' && isKeyPressed('OK', kc);}
function isBackKey(kc) {return KEY_CODES.BACK.indexOf(kc) !== -1 || typeof isKeyPressed === 'function' && (isKeyPressed('BACK', kc) || isKeyPressed('EXIT', kc));}

function focusActivePanelItem(panelType) {
  setTimeout(function () {
    var sel;
    if (panelType === 'episodes') sel = '.episode-item.active';else
    if (panelType === 'subtitles') sel = '.subtitle-item.active';else
    sel = '.audio-item.active';


    if (typeof invalidateFocusCache === 'function') invalidateFocusCache();
    updateFocusableElements();

    var active = document.querySelector(sel);


    if (!active) {
      var fallbackSel = panelType === 'episodes' ? '.episode-item' :
      panelType === 'subtitles' ? '.subtitle-item' :
      '.audio-item';
      active = document.querySelector(fallbackSel);
    }

    if (!active) {

      if (focusableElements.length > 0) setFocus(0);
      return;
    }


    var targetIndex = -1;
    for (var i = 0; i < focusableElements.length; i++) {
      if (focusableElements[i] === active) {
        targetIndex = i;
        break;
      }
    }

    if (targetIndex !== -1) {
      setFocus(targetIndex);
    } else if (focusableElements.length > 0) {

      setFocus(0);
    }
  }, 100);
}

















function setupKeyboardHandlers() {



  document.addEventListener('keyup', function (e) {
    var k = e.keyCode;
    if (isOkKey(k)) okKeyHeld = false;



    if (isOkKey(k) && !isCustomFilterMenuOpen() && currentScreen() === 'torrents') {
      var focused = document.querySelector('.focused');
      var sameCard = focused && okHoldFocused && focused === okHoldFocused;
      clearOkHold();
      if (!okHoldHandled && sameCard && focused.classList.contains('torrent-card')) focused.click();
      okHoldHandled = false;
      okHoldFocused = null;
      return;
    }



    if (isOkKey(k) && okHoldFocused && !isCustomFilterMenuOpen() && (
    currentScreen() === 'home' || currentScreen() === 'catalog')) {
      var hSame = document.querySelector('.focused') === okHoldFocused;
      var hDone = okHoldHandled;
      clearOkHold();
      okHoldHandled = false;
      okHoldFocused = null;
      if (!hDone && hSame) onOk();
      return;
    }

    if (isKeyPressed('LEFT', k) || isKeyPressed('RIGHT', k)) {
      if (seekHoldInterval) {
        clearInterval(seekHoldInterval);
        seekHoldInterval = null;

        if (accelerationTimer) {
          clearInterval(accelerationTimer);
          accelerationTimer = null;
        }

        var s = getEl('seek-slider');
        if (s) {
          var ev = document.createEvent('Event');
          ev.initEvent('change', true, true);
          s.dispatchEvent(ev);
        }

        setTimeout(function () {
          isSeekHoldActive = false;
        }, 500);


        scheduleHideSeekOverlay();
      }
      stopSeeking();
    }
  });

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    navKeyRepeat = !!e.repeat;
    var po = getEl('playback-overlay');var isPA = po && po.classList.contains('active');if (isPA) return;
    var a = document.activeElement,ed = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
    var skipBtn = getEl('skip-button');if (k == 13 && skipBtn && !skipBtn.classList.contains('hidden') && skipBtn.classList.contains('focused')) {if (typeof window.executeSkip === 'function') {window.executeSkip();return true;}}





    if (ed) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;





    updateFocusableElements();

    if (AppState.currentScreen === 'player') {
      var vp = getEl('video-player'),cc = getEl('controls-container'),cv = !cc.classList.contains('idle-hidden');
      if (isKeyPressed('UP', k) && !cv) {e.preventDefault();showPlayerControls('play-pause-btn');return;}
      if (isKeyPressed('OK', k)) {
        e.preventDefault();var f = document.querySelector('.focused');if (!cv) {showPlayerControls('play-pause-btn');return;}if (f) {
          var done = false;
          if (f.id === 'play-pause-btn') {vp.paused ? vp.play() : vp.pause();if (typeof window.updatePlayPauseButton === 'function') window.updatePlayPauseButton();done = true;} else
          if (f.id === 'mute-btn') {vp.muted = !vp.muted;if (typeof window.updateMuteButton === 'function') window.updateMuteButton();done = true;} else
          if (f.id === 'prev-episode-btn') {if (typeof window.prevEpisode === 'function') window.prevEpisode();done = true;} else
          if (f.id === 'next-episode-btn') {if (typeof window.nextEpisode === 'function') window.nextEpisode();done = true;} else
          if (f.id === 'episodes-btn') {var eb = getEl('episodes-btn');if (eb) eb.click();updateFocusableElements();focusActivePanelItem('episodes');} else
          if (f.id === 'audio-btn') {var ab = getEl('audio-btn');if (ab) ab.click();updateFocusableElements();focusActivePanelItem('audio');} else
          if (f.id === 'subtitles-btn') {var sb = getEl('subtitles-btn');if (sb) sb.click();updateFocusableElements();focusActivePanelItem('subtitles');} else
          if (f.id === 'exit-player-btn') {if (typeof window.showDetailView === 'function') window.showDetailView();return;} else
          if (f.id === 'toggle-buffer-btn') {var tb = getEl('toggle-buffer-btn');if (tb) tb.click();done = true;} else
          if (f.id === 'seek-slider') {var t = parseFloat(f.value);if (typeof window.showPlayerLoading === 'function') window.showPlayerLoading('⏱️ ' + formatTime(t));setTimeout(function () {if (typeof window.hidePlayerLoading === 'function') window.hidePlayerLoading();}, 1000);done = true;} else
          {f.click();done = true;}



          if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();
          return;
        }
      }
      if (isKeyPressed('LEFT', k) || isKeyPressed('RIGHT', k)) {
        e.preventDefault();

        if (!cv) return;
        if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();

        var fe = focusableElements[currentFocusIndex];
        if (fe && fe.id === 'seek-slider') {
          var s = getEl('seek-slider');
          var loadingOverlay = getEl('loading-player-overlay');
          var loadingTimeEl = getEl('loading-time');
          var currentTimeEl = getEl('current-time');
          var dir = isKeyPressed('LEFT', k) ? -1 : 1;
          var cs = seekHoldStep;
          var lu = Date.now();




          var us = function () {
            var elapsed = Date.now() - lu;
            var ns = seekHoldStep;
            for (var i = SEEK_ACCELERATION_STEPS.length - 1; i >= 0; i--) {
              if (elapsed >= SEEK_ACCELERATION_STEPS[i].time) {
                ns = SEEK_ACCELERATION_STEPS[i].step;
                break;
              }
            }
            cs = ns;
          };



          var ps = function () {
            var nv = parseFloat(s.value) + cs * dir;
            var mx = parseFloat(s.max);

            if (nv < 0) nv = 0;
            if (nv > mx) nv = mx;

            s.value = nv;

            if (typeof AppState !== 'undefined') AppState.previewTime = nv;
            if (currentTimeEl) currentTimeEl.textContent = formatTime(nv);
            if (loadingTimeEl && (AppState.isSeeking ||
            loadingOverlay && loadingOverlay.classList.contains('active'))) {
              loadingTimeEl.textContent = formatTime(nv);
            }

            showSeekOverlay(nv, dir, cs);
          };

          if (!seekHoldInterval) {
            isSeekHoldActive = true;
            cs = seekHoldStep;
            lu = Date.now();

            ps();
            seekHoldInterval = setInterval(ps, seekHoldDelay);




            if (accelerationTimer) clearInterval(accelerationTimer);
            accelerationTimer = setInterval(function () {
              if (seekHoldInterval) us();else
              {clearInterval(accelerationTimer);accelerationTimer = null;}
            }, 200);
          }
          return;
        } else {
          navigate(keyToDirection(k));
          return;
        }
      }
      if (cv) {updateFocusableElements();if (isKeyPressed('UP', k)) {e.preventDefault();navigate('up');if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();return;}if (isKeyPressed('DOWN', k)) {e.preventDefault();navigate('down');if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();return;}}
      if (isKeyPressed('PLAY', k) || isKeyPressed('PAUSE', k) || isKeyPressed('PLAY_PAUSE', k)) {e.preventDefault();vp.paused ? vp.play() : vp.pause();if (typeof window.updatePlayPauseButton === 'function') window.updatePlayPauseButton();if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();return;}
      if (isKeyPressed('VOL_UP', k)) {e.preventDefault();vp.volume = Math.min(1, vp.volume + 0.1);var vs = getEl('volume-slider');if (vs) vs.value = vp.volume;if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();return;}
      if (isKeyPressed('VOL_DOWN', k)) {e.preventDefault();vp.volume = Math.max(0, vp.volume - 0.1);var vs = getEl('volume-slider');if (vs) vs.value = vp.volume;if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();return;}
      if (isKeyPressed('MUTE', k)) {e.preventDefault();vp.muted = !vp.muted;if (typeof window.updateMuteButton === 'function') window.updateMuteButton();if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();return;}
      if (isKeyPressed('RED', k)) {e.preventDefault();var ab = getEl('audio-btn');if (ab) ab.click();if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();return;}
      if (isKeyPressed('GREEN', k)) {e.preventDefault();var eb = getEl('episodes-btn');if (eb) eb.click();if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();return;}
      if (isKeyPressed('YELLOW', k)) {e.preventDefault();var tb = getEl('toggle-buffer-btn');if (tb) tb.click();if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();return;}
      if (isKeyPressed('BLUE', k)) {e.preventDefault();var eb = getEl('exit-player-btn');if (eb) eb.click();if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();return;}
      if (isKeyPressed('BACK', k) || isKeyPressed('EXIT', k)) {e.preventDefault();if (hidePlayerUi()) {lastPlayerBackPressAt = 0;return;}var now = Date.now();if (now - lastPlayerBackPressAt < 1500) {lastPlayerBackPressAt = 0;if (typeof window.showDetailView === 'function') window.showDetailView();} else {lastPlayerBackPressAt = now;if (typeof window.showPlayerHint === 'function') window.showPlayerHint('Нажмите Back ещё раз для выхода');}return;}
      if (isKeyPressed('FF', k)) {e.preventDefault();vp.currentTime = Math.min(vp.duration, vp.currentTime + 30);if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();return;}
      if (isKeyPressed('REW', k)) {e.preventDefault();vp.currentTime = Math.max(0, vp.currentTime - 30);if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();return;}
      if (!cv) return;
    }

    if (isKeyPressed('UP', k)) {e.preventDefault();navigate('up');} else if (isKeyPressed('DOWN', k)) {e.preventDefault();navigate('down');} else if (isKeyPressed('LEFT', k)) {e.preventDefault();navigate('left');} else if (isKeyPressed('RIGHT', k)) {e.preventDefault();navigate('right');} else if (isKeyPressed('OK', k)) {e.preventDefault();var f = document.querySelector('.focused');if (f) {if (f.classList.contains('file-item')) {var pb = f.querySelector('.play-btn');if (pb) pb.click();else f.click();} else f.click();} else if (focusableElements.length > 0) focusableElements[0].click();} else if (isKeyPressed('INFO', k)) {e.preventDefault();console.log('ℹ️ Информация:', { screen: AppState.currentScreen, platform: AppState.platform, focusIndex: currentFocusIndex, focusableCount: focusableElements.length });}
  });
}


function clearOkHold() {if (okHoldTimer) {clearTimeout(okHoldTimer);okHoldTimer = null;}}

function isElementFullyVisible(el, container) {
  if (!el || !container) return true;

  var r = el.getBoundingClientRect();
  var cr = container.getBoundingClientRect();


  var isRowVp = !!(container.classList && container.classList.contains('catalog-row-viewport'));
  var isH = isRowVp ||
  container.id === 'files-list' ||
  container.id === 'catalog-detail-actors-wrap' ||
  container.id === 'catalog-detail-recommendations-wrap' ||
  container.id === 'catalog-detail-trailers-wrap';

  if (isH) {

    var hp = 45;
    var vp = 65;


    var dx = pendingScrollDeltaX(container);
    var dy = pendingScrollDelta(isRowVp ? getEl('main-container') : getEl('detail-view'));

    var isHorizVisible = r.left - dx >= cr.left + hp && r.right - dx <= cr.right - hp;
    var isVertVisible = r.top - dy >= vp && r.bottom - dy <= window.innerHeight - vp;

    return isHorizVisible && isVertVisible;
  }


  var dv = pendingScrollDelta(container);
  return r.top - dv >= cr.top + 35 && r.bottom - dv <= cr.bottom - 35 &&
  r.left >= cr.left + 25 && r.right <= cr.right - 25;
}














function markPendingScroll(el, key, value, duration) {
  if (!el) return;
  el[key] = value;
  el[key + 'Until'] = Date.now() + Math.round(duration * 1000) + 50;
}

function clearPendingScroll(el, key) {
  if (!el) return;
  el[key] = null;
  el[key + 'Until'] = 0;
}


function pendingScrollDelta(el) {
  if (!el || typeof el._navPendTop !== 'number') return 0;
  if (Date.now() > el._navPendTopUntil) return 0;
  return el._navPendTop - el.scrollTop;
}


function pendingScrollDeltaX(container) {
  if (!container || typeof container._navPendX !== 'number') return 0;
  if (Date.now() > container._navPendXUntil) return 0;
  return container._navPendX - getScrollX(container);
}












function speedDuration(distance, speed) {
  if (!(speed > 0)) return 0;
  var d = Math.abs(distance || 0) / speed;
  if (d > SCROLL_SMOOTH.maxDuration) return 0;
  return Math.max(SCROLL_SMOOTH.minDuration, d);
}










function markNavStep(duration) {
  if (!navStepArmed || !(duration > 0)) return;
  navStepArmed = false;


  var until = Date.now() + Math.min(NAV_STEP_MAX_WAIT_MS, Math.round(duration * 1000));
  if (until > navStepUntil) navStepUntil = until;
}


















function acceptNavStep(direction, run) {
  if (NAV_PACED_SCREENS.indexOf(currentScreen()) === -1) return true;
  var now = Date.now();
  if (now < navStepUntil) {queueNavStep(direction, run);return false;}
  navStepUntil = now + NAV_STEP_BASE_MS;
  navStepAt = now;
  navStepArmed = true;
  return true;
}


function isNavStepScroll() {
  return navStepAt > 0 && Date.now() - navStepAt <= NAV_STEP_SCROLL_WINDOW_MS;
}


















function navStepScrollDuration(natural, target) {
  if (!(natural > 0) || !(target > 0)) return natural;
  if (!isNavStepScroll()) return natural;

  return Math.max(target, natural / NAV_STEP_MAX_SPEEDUP);
}







function runScreenNavigation(direction) {
  if (!acceptNavStep(direction, runScreenNavigation)) return;
  var strategy = ScreenStrategies[currentScreen()];
  if (strategy && strategy.handleNavigation) strategy.handleNavigation(direction);
}









function queueNavStep(direction, run) {
  navQueuedDirection = direction;
  navQueuedRun = run || null;
  navQueuedScreen = currentScreen();
  if (navQueueTimer) return;
  navQueueTimer = setTimeout(function () {
    navQueueTimer = null;
    var d = navQueuedDirection,r = navQueuedRun,sc = navQueuedScreen;
    navQueuedDirection = null;
    navQueuedRun = null;
    navQueuedScreen = null;
    if (!d) return;


    if (sc && sc !== currentScreen()) return;
    if (r) r(d);else navigate(d);
  }, Math.max(0, navStepUntil - Date.now()) + 1);
}












function getScrollAnimMode() {
  try {
    if (window.UICustomizer && typeof window.UICustomizer.getScrollAnim === 'function') {
      var mode = window.UICustomizer.getScrollAnim();
      if (mode === 'none' || mode === 'fast' || mode === 'smooth') return mode;
    }
  } catch (e) {}
  return 'smooth';
}


function scrollAnimSpeedX(speed) {
  var mode = getScrollAnimMode();
  if (mode === 'none') return 0;
  if (mode === 'fast') return speed * 2;
  return speed;
}


function scrollAnimDurationX(duration) {
  var mode = getScrollAnimMode();
  if (mode === 'none') return 0;
  if (mode === 'fast' && typeof duration === 'number') return duration * 0.5;
  return duration;
}

















function getScrollX(container) {
  return container ? container.scrollLeft : 0;
}

function getMaxScrollX(container) {
  if (!container) return 0;
  return Math.max(0, container.scrollWidth - container.clientWidth);
}


function setScrollXImmediate(container, left) {
  if (!container) return;
  clearPendingScroll(container, '_navPendX');

  if (typeof Animations !== 'undefined' && Animations.stopScrollTween) {
    Animations.stopScrollTween(container);
  }
  container.scrollLeft = left;
}










function setScrollX(container, left, smooth, duration) {
  if (!container) return;
  left = Math.max(0, Math.min(getMaxScrollX(container), left));



  var rest = container.scrollLeft + pendingScrollDeltaX(container);




  duration = typeof duration === 'number' ?
  scrollAnimDurationX(duration) :
  navStepScrollDuration(
    speedDuration(left - rest, scrollAnimSpeedX(SCROLL_SMOOTH.speedX)),
    scrollAnimDurationX(NAV_STEP_BASE_MS / 1000));

  var animated = smooth && !_instantScrollDepth && duration > 0;





  if (animated && Math.abs(rest - left) < 2) return;

  if (animated) {
    markPendingScroll(container, '_navPendX', left, duration);
    markNavStep(duration);
  } else {
    clearPendingScroll(container, '_navPendX');
  }
  applyScroll(container, { scrollLeft: left }, smooth, duration, SCROLL_SMOOTH.ease);
}






















function applyScroll(container, vars, smooth, duration, ease) {
  if (!container || !vars) return;



  if (typeof duration !== 'number' && typeof vars.scrollTop === 'number') {
    duration = navStepScrollDuration(
      speedDuration(
        vars.scrollTop - (container.scrollTop + pendingScrollDelta(container)),
        SCROLL_SMOOTH.speedY),
      NAV_STEP_BASE_MS / 1000);
  }

  var animated = smooth && !_instantScrollDepth && typeof duration === 'number' && duration > 0;
















  if (animated && typeof vars.scrollTop === 'number' && vars.scrollLeft === undefined &&
  Math.abs(container.scrollTop + pendingScrollDelta(container) - vars.scrollTop) < 2) {
    return;
  }

  if (typeof vars.scrollTop === 'number') {
    if (animated) {
      markPendingScroll(container, '_navPendTop', vars.scrollTop, duration);
      markNavStep(duration);
    } else {
      clearPendingScroll(container, '_navPendTop');
    }
  }

  if (typeof Animations !== 'undefined' && typeof Animations.tweenScroll === 'function') {
    Animations.tweenScroll(container, vars, {
      duration: animated ? duration : 0,
      ease: ease || SCROLL_SMOOTH.ease
    });
    return;
  }


  if (typeof vars.scrollTop === 'number') container.scrollTop = vars.scrollTop;
  if (typeof vars.scrollLeft === 'number') container.scrollLeft = vars.scrollLeft;
}





function isFirstRowViewport(viewport) {
  var row = viewport && viewport.closest ? viewport.closest('.catalog-row') : null;
  if (!row || !row.parentElement) return false;
  var kids = row.parentElement.children;
  for (var i = 0; i < kids.length; i++) {
    if (!kids[i].classList || !kids[i].classList.contains('catalog-row')) continue;
    return kids[i] === row;
  }
  return false;
}








function isCatalogRowCard(el) {
  if (!el || !el.classList || !el.classList.contains('catalog-row-card')) return false;
  if (el.classList.contains('home-card')) return false;
  return !!(el.dataset && el.dataset.catalogKey);
}


function isCatalogGridCard(el) {
  if (!el || !el.classList) return false;
  if (el.classList.contains('catalog-row-card')) return false;
  if (!el.classList.contains('torrent-card')) return false;
  var grid = getEl('catalog-grid');
  return !!(grid && grid.contains(el));
}


function isFirstRowGridCard(target) {
  if (!target || !target.closest) return false;
  var grid = target.closest('#torrents-grid, #catalog-grid');
  if (!grid) return false;
  var cols = grid.id === 'torrents-grid' ? getTorrentGridColumns() : getColumns();
  if (!cols || cols < 1) return false;












  if (grid.id === 'catalog-grid') {
    var n = parseInt(target.dataset.catalogIndex, 10);
    return !isNaN(n) && n < cols;
  }

  var all = grid.querySelectorAll('.torrent-card'),seen = 0;
  for (var i = 0; i < all.length; i++) {
    if (all[i] === target) return seen < cols;
    if (all[i].offsetParent !== null) seen++;
  }
  return false;
}




var CATALOG_GRID_BOTTOM_PAD = 10;


























function catalogGridPinTarget(el, scrollContainer) {
  var dy = pendingScrollDelta(scrollContainer);
  var restTop = scrollContainer.scrollTop + dy;
  var viewTop = scrollContainer.getBoundingClientRect().top;
  var viewBottom = viewTop + scrollContainer.clientHeight;
  var restBottom = el.getBoundingClientRect().bottom - dy;

  var target = restTop + (restBottom - (viewBottom - CATALOG_GRID_BOTTOM_PAD));
  var maxTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);

  return { rest: restTop, target: Math.max(0, Math.min(maxTop, target)) };
}

function scrollCatalogGridCardIntoView(el, scrollContainer, smooth) {
  if (!el || !scrollContainer) return;

  var t = catalogGridPinTarget(el, scrollContainer);



  if (Math.abs(t.rest - t.target) < CATALOG_GRID_PIN_EPS) return;

  applyScroll(scrollContainer, { scrollTop: t.target }, smooth);
  scheduleCatalogGridPinCheck(scrollContainer);
}


























var CATALOG_GRID_PIN_EPS = 2;
var CATALOG_GRID_PIN_CHECK_MS = 120;
var CATALOG_GRID_PIN_MAX_WAIT = 8;
var gridPinTimer = 0;

function scheduleCatalogGridPinCheck(scrollContainer, attempt) {
  if (!scrollContainer) return;
  if (gridPinTimer) clearTimeout(gridPinTimer);
  attempt = attempt || 0;

  gridPinTimer = setTimeout(function () {
    gridPinTimer = 0;



    var moving = navHold ||
    typeof Animations !== 'undefined' &&
    typeof Animations.isScrollTweening === 'function' &&
    Animations.isScrollTweening(scrollContainer);
    if (moving) {
      if (attempt < CATALOG_GRID_PIN_MAX_WAIT) {
        scheduleCatalogGridPinCheck(scrollContainer, attempt + 1);
      }
      return;
    }



    var el = document.querySelector('#catalog-grid .torrent-card.catalog-card.focused');
    if (!el || !el.isConnected || !scrollContainer.isConnected) return;
    if (AppState.currentScreen !== 'catalog') return;

    var t = catalogGridPinTarget(el, scrollContainer);
    if (Math.abs(t.rest - t.target) < CATALOG_GRID_PIN_EPS) return;



    applyScroll(scrollContainer, { scrollTop: t.target }, true);
  }, CATALOG_GRID_PIN_CHECK_MS);
}



var CATALOG_ROW_BOTTOM_PAD = 50;


















function scrollCatalogRowIntoView(viewport, vertEl, dy, smooth) {
  var rowEl = viewport.closest && viewport.closest('.catalog-row') || viewport;



  var topPad = 0;
  var topbar = getEl('home-topbar');
  if (topbar && topbar.offsetParent !== null) topPad = topbar.offsetHeight + 10;

  var restTop = vertEl.scrollTop + dy;
  var vertTop = vertEl.getBoundingClientRect().top;
  var rowRect = rowEl.getBoundingClientRect();


  var rowTop = restTop + (rowRect.top - dy) - vertTop;
  var rowBottom = restTop + (rowRect.bottom - dy) - vertTop;

  var target = rowBottom - vertEl.clientHeight + CATALOG_ROW_BOTTOM_PAD;




  target = Math.min(target, rowTop - topPad);

  var maxTop = Math.max(0, vertEl.scrollHeight - vertEl.clientHeight);
  target = Math.max(0, Math.min(maxTop, target));



  if (Math.abs(restTop - target) < 2) return;

  applyScroll(vertEl, { scrollTop: target }, smooth);
}






function isTopAnchoredTarget(target) {
  if (!target || !target.classList) return false;
  if (target.classList.contains('home-nav-btn')) return true;




  if (AppState.currentScreen === 'config') {
    if (target.classList.contains('menu-item')) return true;
    if (typeof configState !== 'undefined' && configState.activeTabId) {
      var cItems = getConfigContentItems(configState.activeTabId);
      if (cItems.length && cItems[0] === target) return true;
    }
  }
  if (target.classList.contains('catalog-row-card')) {
    return isFirstRowViewport(target.closest ? target.closest('.catalog-row-viewport') : null);
  }
  return isFirstRowGridCard(target);
}

function scrollToElementIfNeeded(el, container, smooth, direction) {
  if (smooth === undefined) smooth = true;
  if (SCROLL_SMOOTH.force) smooth = true;
  if (!el || !container) return;






  var isWindow = container === window || container === document.body;
  var scrollContainer = isWindow ? window.scrollingElement || document.documentElement : container;


  var isRowViewport = !!(container.classList && container.classList.contains('catalog-row-viewport'));

  var isH = isRowViewport ||
  container.id === 'catalog-detail-actors-wrap' ||
  container.id === 'catalog-detail-recommendations-wrap' ||
  container.id === 'catalog-detail-trailers-wrap' ||
  container.id === 'files-list';

  if (isH) {
    var r = el.getBoundingClientRect();
    var cr = container.getBoundingClientRect();
    var con = "";
    if (container.id === 'catalog-detail-actors-wrap' ||
    container.id === 'catalog-detail-recommendations-wrap' ||
    container.id === 'catalog-detail-trailers-wrap') {
      con = container.id.replace('-wrap', '');
      con = getEl(con);
    } else {
      con = container;
    }

    var hp = 30;


    var dx = pendingScrollDeltaX(con);
    var isHorizVisible = r.left - dx >= cr.left + hp && r.right - dx <= cr.right - hp;

    if (!isHorizVisible) {
      var curLeft = getScrollX(con);
      var targetLeft;
      if (direction === 'left') {
        targetLeft = curLeft + (r.left - cr.left) - hp;
      } else if (direction === 'right') {
        targetLeft = curLeft + (r.left - cr.left) - (cr.width - r.width - hp);
      } else {
        targetLeft = curLeft + (r.left - cr.left) - cr.width / 2 + r.width / 2;
      }
      targetLeft = Math.max(0, Math.min(getMaxScrollX(con), targetLeft));



      var fromLeft = dx ? curLeft + dx : curLeft;
      var needsHScroll = Math.abs(fromLeft - targetLeft) > 10;
      if (needsHScroll) {
        setScrollX(con, targetLeft, smooth);
      }
    }


    var vertEl = isRowViewport ? getEl('main-container') : getEl('detail-view');
    var dy = pendingScrollDelta(vertEl);


    if (vertEl && isRowViewport && isFirstRowViewport(container)) {


      if (vertEl.scrollTop + dy > 1) {
        applyScroll(vertEl, { scrollTop: 0 }, smooth);
      }
      return;
    }



    if (vertEl && isRowViewport) {


      scrollCatalogRowIntoView(container, vertEl, dy, smooth);
      return;
    }
    if (vertEl) {
      var containerRect = container.getBoundingClientRect();
      var vertRect = vertEl.getBoundingClientRect();
      var containerTopRelative = containerRect.top - vertRect.top + vertEl.scrollTop;
      var containerBottomRelative = containerTopRelative + containerRect.height;
      var vertViewportTop = vertEl.scrollTop + dy;
      var vertViewportBottom = vertViewportTop + vertRect.height;
      var needsVertScroll = false;
      var targetScrollTop = vertViewportTop;

      if (containerTopRelative < vertViewportTop + 50) {
        targetScrollTop = direction === 'up' ?
        Math.max(0, containerTopRelative - 30) :
        Math.max(0, containerTopRelative - 50);
        needsVertScroll = true;
      } else if (containerBottomRelative > vertViewportBottom - 50) {
        targetScrollTop = direction === 'down' ?
        Math.max(0, containerBottomRelative - vertRect.height + 30) :
        Math.max(0, containerBottomRelative - vertRect.height + 50);
        needsVertScroll = true;
      }

      if (needsVertScroll) {
        targetScrollTop = Math.max(0, Math.min(targetScrollTop, vertEl.scrollHeight - vertRect.height));




















        if (Math.abs(vertViewportTop - targetScrollTop) > 4) {
          applyScroll(vertEl, { scrollTop: targetScrollTop }, smooth);
        }
      }
    }
    return;
  } else if (container.id === 'detail-view') {
    if (el.id === 'back-from-detail' || el.id === 'catalog-watch-btn' || el.id === 'detail-progress-btn') {
      applyScroll(container, { scrollTop: 0 }, smooth);
      return;
    }
  } else if (isTopAnchoredTarget(el)) {

    applyScroll(container, { scrollTop: 0 }, smooth);
    return;
  } else if (isCatalogGridCard(el)) {


    scrollCatalogGridCardIntoView(el, scrollContainer, smooth);
    return;
  } else if (container.id == 'episodes-panel' || container.id == 'audio-panel' || container.id == 'subtitles-panel') {
    if (typeof Animations !== 'undefined') Animations.scrollToIfNotVisible(el, container);
  }
  if (!scrollContainer) return;
  var dyTail = pendingScrollDelta(scrollContainer);
  if (dyTail) {



    var er = el.getBoundingClientRect();
    var viewTop = isWindow ? 0 : scrollContainer.getBoundingClientRect().top;
    var viewBot = isWindow ? window.innerHeight : viewTop + scrollContainer.clientHeight;
    var over = 0;
    if (er.top - dyTail < viewTop + 10) over = er.top - dyTail - (viewTop + 10);else
    if (er.bottom - dyTail > viewBot - 10) over = er.bottom - dyTail - (viewBot - 10);
    if (over) {
      var maxTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
      applyScroll(scrollContainer,
      { scrollTop: Math.max(0, Math.min(maxTop, scrollContainer.scrollTop + dyTail + over)) },
      smooth);
    }
    return;
  }
  Animations.scrollToIfNotVisible(el, container, {
    direction: direction,



    duration: isNavStepScroll() ? NAV_STEP_BASE_MS / 1000 : SCROLL_SMOOTH.fallbackDuration,
    ease: SCROLL_SMOOTH.ease,
    offset: 10,
    overwrite: true
  });
}







function getConfigScroller() {
  var main = document.querySelector('#config-screen .settings-main');
  if (main) {
    var oy = getComputedStyle(main).overflowY;
    if (oy === 'auto' || oy === 'scroll') return main;
  }
  return getEl('config-screen');
}
window.getConfigScroller = getConfigScroller;













function scrollConfigIntoView(el, scroller) {

  if (!el || !scroller || !scroller.clientHeight || !scroller.contains(el)) return;
  var sRect = scroller.getBoundingClientRect();
  var scale = sRect.height / scroller.clientHeight;
  if (!(scale > 0)) scale = 1;
  var pad = 24;
  var view = scroller.clientHeight;
  var block = el.closest && el.closest('.settings-field, .checkbox-container, .action-row') || el;
  var bRect = block.getBoundingClientRect();

  if (bRect.height / scale > view - 2 * pad) {block = el;bRect = el.getBoundingClientRect();}

  var cur = scroller.scrollTop;
  var rest = cur + pendingScrollDelta(scroller);
  var top = (bRect.top - sRect.top) / scale + cur;
  var bottom = top + bRect.height / scale;
  var target;
  if (top < rest + pad) target = top - pad;else
  if (bottom > rest + view - pad) target = bottom - view + pad;else
  return;
  target = Math.max(0, Math.min(scroller.scrollHeight - view, target));
  if (Math.abs(target - rest) > 2) applyScroll(scroller, { scrollTop: target }, true);
}

function byId(id) {return getEl(id);};

function focusEl(el, opts) {
  if (opts === undefined) opts = {};
  if (el === undefined) return;








  if (el.isConnected === false) return false;

















  if (opts.nativeFocus) try {el.focus();} catch (e) {} else blurEditor();

  var container = null;
  var s = AppState.currentScreen;
  var isFI = el.classList && el.classList.contains('file-item');
  var isAC = el.classList && el.classList.contains('catalog-actor-card');
  var isRC = el.classList && el.classList.contains('catalog-recommendation-card');
  var isTC = el.classList && el.classList.contains('catalog-trailer-card-item');
  var isRowCard = el.classList && el.classList.contains('catalog-row-card');





  if ((isRowCard || el.classList && el.classList.contains('catalog-card')) &&
  typeof revealCatalogElement === 'function') {
    revealCatalogElement(el);
  }




  if (s === 'search' && el.classList && el.classList.contains('search-result-item') &&
  typeof window.revealSearchResultItem === 'function') {
    window.revealSearchResultItem(el);
  }





  var filterMainScreen = null,filterValuesScreen = null,isInFilterPanel = false;
  if (s === 'search' && el.closest) {
    filterMainScreen = el.closest('.filter-main-screen');
    filterValuesScreen = el.closest('.filter-values-screen');
    isInFilterPanel = !!(filterMainScreen || filterValuesScreen) ||
    el.id === 'filter-back-btn' || el.id === 'filter-close-btn' ||
    el.id === 'reset-filters';
  }





  if (s === 'config') {




    container = getConfigScroller();
  } else if (s === 'catalog' || s === 'torrents' || s === 'home') {
    var rowVp = isRowCard && el.closest ? el.closest('.catalog-row-viewport') : null;
    container = rowVp || getEl('main-container');
  } else if (s === 'search') {

    if (isInFilterPanel) {
      if (filterValuesScreen) {
        container = filterValuesScreen;
      } else if (filterMainScreen) {
        container = filterMainScreen;
      } else {

        var panel = getEl('search-filters-panel');
        container = panel || getEl('search-results');
      }
    } else {
      container = getEl('search-results');
    }
  } else if (s === 'detail') {
    if (isFI) {
      container = getEl('files-list');
    } else if (isAC) {
      container = getEl('catalog-detail-actors-wrap');
      if (!container && el.closest) container = el.closest('.catalog-detail-actors-wrap');
    } else if (isRC) {
      container = getEl('catalog-detail-recommendations-wrap');
      if (!container && el.closest) container = el.closest('.catalog-detail-recommendations-wrap');
    } else if (isTC) {
      container = getEl('catalog-detail-trailers-wrap');
      if (!container && el.closest) container = el.closest('.catalog-detail-trailers-wrap');
    } else {
      container = getEl('detail-view');
    }
  } else if (s === 'player') {
    var parent = el.parentElement;
    if (parent) container = getEl(parent.id);
  }


  var scrollDirection = opts.direction || lastNavDirection;



















  var needScroll = false;
  if (s === 'config') {


    if (isTopAnchoredTarget(el)) {
      if (container && container.scrollTop + pendingScrollDelta(container) > 1) applyScroll(container, { scrollTop: 0 }, true);
    } else {
      scrollConfigIntoView(el, container);
    }
  } else {
    needScroll = el.id === 'back-from-detail' || el.id === 'catalog-watch-btn' ||
    isTopAnchoredTarget(el) || isCatalogGridCard(el) || isCatalogRowCard(el);
    if (!needScroll && container) needScroll = !isElementFullyVisible(el, container);
  }

  if (needScroll) {
    scrollToElementIfNeeded(
      el,
      container,
      true,
      scrollDirection
    );
  }


  clearFocused();
  el.classList.add('focused');
  applyTitleMarquee(el);
  trackFocusedElement(el);
  rememberScreenFocus(el);
  return true;
}

function showPlayerControls(preferredFocusId) {
  if (preferredFocusId === undefined) preferredFocusId = 'play-pause-btn';
  var ids = ['controls-container', 'buffer-stats', 'player-hint', 'toggle-buffer-btn', 'exit-player-btn', 'episodes-btn', 'prev-episode-btn', 'next-episode-btn', 'audio-btn', 'subtitles-btn', 'player-title'];
  for (var i = 0; i < ids.length; i++) {var e = getEl(ids[i]);if (e) e.classList.remove('idle-hidden');}
  if (typeof window.setPlayerCursorHidden === 'function') window.setPlayerCursorHidden(false);
  if (typeof window.syncPlayerTitleVisibility === 'function') window.syncPlayerTitleVisibility(true);
  var pt = getEl('player-title');if (pt) pt.classList.remove('hidden');
  if (typeof Animations !== 'undefined') Animations.animateControlsShow();
  if (typeof window.resetMouseIdleTimer === 'function') window.resetMouseIdleTimer();

  setTimeout(function () {
    var ep = getEl('episodes-panel');
    var ap = getEl('audio-panel');
    var sp = getEl('subtitles-panel');
    var isPanelOpen = ep && !ep.classList.contains('hidden') ||
    ap && !ap.classList.contains('hidden') ||
    sp && !sp.classList.contains('hidden');


    var hasPanelFocus = false;
    if (isPanelOpen) {
      var panelFocused = ep && ep.querySelector('.focused') ||
      ap && ap.querySelector('.focused') ||
      sp && sp.querySelector('.focused');
      hasPanelFocus = !!panelFocused;
    }


    if (isPanelOpen && hasPanelFocus) {
      return;
    }



    if (isPanelOpen) {
      return;
    }

    updateFocusableElements();
    var ti = -1;
    for (var j = 0; j < focusableElements.length; j++) {
      if (focusableElements[j].id === preferredFocusId) {
        ti = j;
        break;
      }
    }
    setFocus(ti !== -1 ? ti : 0);
  }, 150);
}

function hidePlayerControls() {
  if (typeof Animations !== 'undefined') Animations.animateControlsHide();
  var ids = ['controls-container', 'buffer-stats', 'player-hint', 'toggle-buffer-btn', 'exit-player-btn', 'episodes-btn', 'prev-episode-btn', 'next-episode-btn', 'audio-btn', 'subtitles-btn', 'player-title'];
  for (var i = 0; i < ids.length; i++) {var e = getEl(ids[i]);if (e) e.classList.add('idle-hidden');}
  if (typeof window.setPlayerCursorHidden === 'function') window.setPlayerCursorHidden(true);
  if (typeof window.syncPlayerTitleVisibility === 'function') window.syncPlayerTitleVisibility(false);
  var pt = getEl('player-title');if (pt) pt.classList.add('hidden');
  var focused = document.querySelectorAll('.focused');
  for (var j = 0; j < focused.length; j++) focused[j].classList.remove('focused');
  currentFocusIndex = 0;
  if (window.mouseIdleTimer) {clearTimeout(window.mouseIdleTimer);window.mouseIdleTimer = null;}
}

function hidePlayerPanelsOnly() {
  var hidden = false;
  var ep = getEl('episodes-panel');if (ep && !ep.classList.contains('hidden')) {ep.classList.add('hidden');var b = getEl('episodes-btn');if (b) b.classList.remove('active');hidden = true;}
  var ap = getEl('audio-panel');if (ap && !ap.classList.contains('hidden')) {ap.classList.add('hidden');var b = getEl('audio-btn');if (b) b.classList.remove('active');hidden = true;}
  var sp = getEl('subtitles-panel');if (sp && !sp.classList.contains('hidden')) {sp.classList.add('hidden');var b = getEl('subtitles-btn');if (b) b.classList.remove('active');hidden = true;}
  return hidden;
}

function hidePlayerUi() {var p = hidePlayerPanelsOnly();var c = isPlayerControlsVisible();if (c) hidePlayerControls();var pt = getEl('player-title');if ((p || c) && pt) pt.classList.add('hidden');return p || c;}

function openSearchScreen(fi) {
  if (fi === undefined) fi = true;
  clickEl(getEl('tab-search') || getEl('search-btn'));
  setTimeout(function () {
    ScreenStrategies.search.ensureFocus(true, fi);
    if (fi) {
      var q = getEl('search-query');
      focusEl(q, { nativeFocus: true });
      try {if (q && q.click) q.click();} catch (e) {}
      try {if (q && q.select) q.select();} catch (e) {}
    }
  }, 120);
}

function leaveSearchToTorrents() {
  if (typeof window.hideSearchResults === 'function') window.hideSearchResults();else
  {clickEl(getEl('close-search') || getEl('tab-torrents'));setTimeout(function () {var rt = window.AppState && AppState.inSearch === 'catalog' ? 'catalog' : 'torrents';if (rt === 'catalog') ScreenStrategies.catalog.ensureFocus(true);else ScreenStrategies.torrents.ensureFocus(true);}, 150);}
}

function closeFilterPanel() {
  var panel = getEl('search-filters-panel');
  var toggleBtn = getEl('filter-toggle');
  var overlay = getEl('filter-overlay');
  if (panel) {
    panel.classList.remove('active');
    if (toggleBtn) toggleBtn.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
    invalidateFocusCache();
    setTimeout(function () {
      updateFocusableElements();
      if (toggleBtn && toggleBtn.offsetParent !== null) {
        focusEl(toggleBtn);
      } else {
        var q = getEl('search-query');
        if (q) focusEl(q);
      }
    }, 200);
  }
}

function openFilterPanelAndFocus() {
  var panel = getEl('search-filters-panel');
  var toggleBtn = getEl('filter-toggle');
  var overlay = getEl('filter-overlay');

  if (panel) {
    panel.classList.add('active');
    if (toggleBtn) toggleBtn.classList.add('active');
    if (overlay) overlay.classList.add('active');


    invalidateFocusCache();
    setTimeout(function () {
      updateFocusableElements();
      var closeBtn = getEl('filter-close-btn');
      if (closeBtn && VISIBLE(closeBtn)) {
        focusEl(closeBtn);
      } else {
        var firstItem = panel.querySelector('.filter-item:not(.hidden)');
        if (firstItem) focusEl(firstItem);
      }
    }, 150);
  }
}

function scrollToActiveConfigItem() {var ai = document.querySelector('#config-screen .focused'),cs = document.querySelector('#config-screen'),it = getConfigItems();if (!ai || !cs) return;var sc = cs;while (sc && sc.scrollHeight <= sc.clientHeight) {sc = sc.parentElement;if (!sc || sc === document.body) {sc = window;break;}}var iw = sc === window,cur = iw ? window.scrollY : sc.scrollTop,ci = -1;for (var i = 0; i < it.length; i++) if (ai === it[i]) {ci = i;break;}var ar = ai.getBoundingClientRect(),ct = iw ? 0 : sc.getBoundingClientRect().top,ot = ar.top - ct;if (ci === it.length - 2) {if (iw) window.scrollTo(0, document.body.scrollHeight - window.innerHeight);else sc.scrollTop = sc.scrollHeight - sc.clientHeight;return;}if (ci === 1) {if (iw) window.scrollTo(0, 0);else sc.scrollTop = 0;return;}var ch = iw ? window.innerHeight : sc.clientHeight;if (ot < 0) {var ns = cur + ot - 10;if (iw) window.scrollTo(0, ns);else sc.scrollTop = ns;} else if (ot + ar.height > ch) {var ns = cur + (ot + ar.height - ch) + 10;if (iw) window.scrollTo(0, ns);else sc.scrollTop = ns;}}

function handleConfigNavigation(dir) {
  if (currentScreen() !== 'config') return false;
  var menuItems = getConfigMenuItems();
  var currentFocused = document.querySelector('.focused');
  if (!currentFocused) {ScreenStrategies.config.ensureFocus(true);return true;}
  var isOnMenu = false;
  var currentMenuIndex = -1;
  for (var i = 0; i < menuItems.length; i++) {
    if (currentFocused === menuItems[i]) {isOnMenu = true;currentMenuIndex = i;break;}
  }
  if (isOnMenu) {
    if (dir === 'up') {
      if (currentMenuIndex > 0) {
        var targetIndex = currentMenuIndex - 1;
        var targetMenuItem = menuItems[targetIndex];
        var targetTabId = targetMenuItem.id;
        configState.activeTabId = targetTabId;
        switchConfigTab(targetTabId);
        setConfigMenuActive(targetTabId);
        return focusEl(targetMenuItem);
      }
      return true;
    }
    if (dir === 'down') {
      if (currentMenuIndex < menuItems.length - 1) {
        var targetIndex = currentMenuIndex + 1;
        var targetMenuItem = menuItems[targetIndex];
        var targetTabId = targetMenuItem.id;
        configState.activeTabId = targetTabId;
        switchConfigTab(targetTabId);
        setConfigMenuActive(targetTabId);
        return focusEl(targetMenuItem);
      }
      return true;
    }
    if (dir === 'left') return true;

    if (dir === 'right' || dir === 'enter') {
      var selectedTabId = currentFocused.id;



      if (selectedTabId === 'appearance-tab' && window.UICustomizer &&
      typeof UICustomizer.enterEmbedded === 'function') {
        configState.activeTabId = selectedTabId;
        setConfigMenuActive(selectedTabId);
        switchConfigTab(selectedTabId);
        if (UICustomizer.enterEmbedded()) return true;
      }
      configState.activeTabId = selectedTabId;
      configState.isOnMenu = false;
      setConfigMenuActive(selectedTabId);
      switchConfigTab(selectedTabId);
      var contentItems = getConfigContentItems(selectedTabId);
      if (contentItems.length > 0) return focusEl(contentItems[0]);
      return true;
    }
    if (dir === 'back') return true;
  } else {
    var contentItems = getConfigContentItems(configState.activeTabId);
    var currentContentIndex = -1;
    for (var i = 0; i < contentItems.length; i++) {
      if (currentFocused === contentItems[i]) {currentContentIndex = i;break;}
    }







    var rowOf = function (el) {
      if (!el || !el.parentNode || !el.classList) return null;
      if (el.classList.contains('settings-chip')) return el.parentNode;
      var p = el.parentNode;
      if (p.classList && p.classList.contains('action-row')) return p;
      var fr = el.closest ? el.closest('.settings-field-row') : null;
      if (fr && getComputedStyle(fr).flexDirection !== 'column') return fr;
      return null;
    };
    var chipRow = rowOf(currentFocused);
    if (chipRow && (dir === 'left' || dir === 'right')) {
      var inRow = [];
      for (var r = 0; r < contentItems.length; r++) {
        if (chipRow.contains(contentItems[r])) inRow.push(contentItems[r]);
      }
      var sib = inRow[inRow.indexOf(currentFocused) + (dir === 'left' ? -1 : 1)];
      if (sib) return focusEl(sib);
      return true;
    }



    if (chipRow && currentFocused.classList.contains('settings-chip') && (dir === 'up' || dir === 'down')) {
      var lineTarget = chipInNextLine(chipRow, currentFocused, dir);
      if (lineTarget) return focusEl(lineTarget);
    }
    if (dir === 'up' || dir === 'down') {
      if (currentContentIndex === -1) return true;
      var step = dir === 'up' ? -1 : 1;
      var j = currentContentIndex + step;
      while (chipRow && j >= 0 && j < contentItems.length && chipRow.contains(contentItems[j])) j += step;
      if (j < 0 || j >= contentItems.length) return true;
      var target = contentItems[j];


      if (target.classList.contains('settings-chip')) {
        target = target.parentNode.querySelector('.settings-chip.active') ||
        target.parentNode.querySelector('.settings-chip') || target;
      } else {
        var targetRow = rowOf(target);
        if (targetRow) {
          for (var k = 0; k < contentItems.length; k++) {
            if (targetRow.contains(contentItems[k])) {target = contentItems[k];break;}
          }
        }
      }
      return focusEl(target);
    }
    if (dir === 'left' || dir === 'right') return true;
    if (dir === 'enter') {
      if (currentFocused) {
        var isTextInput = currentFocused.tagName === 'INPUT' && currentFocused.type !== 'checkbox' || currentFocused.tagName === 'TEXTAREA' || currentFocused.isContentEditable;
        if (isTextInput) {if (document.activeElement === currentFocused) currentFocused.blur();else currentFocused.focus();} else
        {if (typeof currentFocused.click === 'function') currentFocused.click();}
      }
      return true;
    }
    if (dir === 'back') {configState.isOnMenu = true;return focusEl(getEl(configState.activeTabId));}
  }
  return false;
}





function chipInNextLine(row, from, dir) {
  var fr = from.getBoundingClientRect();
  var fx = fr.left + fr.width / 2;
  var lineTop = null,best = null,bestDx = Infinity;
  var kids = row.children;

  for (var i = 0; i < kids.length; i++) {
    if (kids[i] === from || !VISIBLE(kids[i])) continue;
    var r = kids[i].getBoundingClientRect();
    var beyond = dir === 'down' ? r.top >= fr.bottom - 1 : r.bottom <= fr.top + 1;
    if (!beyond) continue;
    if (lineTop === null || (dir === 'down' ? r.top < lineTop : r.top > lineTop)) lineTop = r.top;
  }
  if (lineTop === null) return null;
  for (var j = 0; j < kids.length; j++) {
    if (kids[j] === from || !VISIBLE(kids[j])) continue;
    var rr = kids[j].getBoundingClientRect();
    if (Math.abs(rr.top - lineTop) > 2) continue;
    var dx = Math.abs(rr.left + rr.width / 2 - fx);
    if (dx < bestDx) {bestDx = dx;best = kids[j];}
  }
  return best;
}

function switchConfigTab(tabId) {
  var tabContents = document.querySelectorAll('.tab-content');
  for (var i = 0; i < tabContents.length; i++) tabContents[i].style.display = 'none';
  var selectedTab = getEl(tabId + '-content');
  if (selectedTab) selectedTab.style.display = 'block';


  if (tabId === 'device-tab' && typeof window.renderDeviceInfo === 'function') window.renderDeviceInfo();
}

function setConfigMenuActive(menuItemId) {
  var menuItems = getConfigMenuItems();
  for (var i = 0; i < menuItems.length; i++) {
    if (menuItems[i].id === menuItemId) menuItems[i].classList.add('active');else
    menuItems[i].classList.remove('active');
  }
}


function ensureCustomFilterMenu() {var m = getEl('custom-filter-menu');if (m) return m;m = document.createElement('div');m.id = 'custom-filter-menu';m.className = 'custom-filter-menu hidden';m.innerHTML = '<div class="custom-filter-menu-backdrop"></div><div class="custom-filter-menu-panel"><div class="custom-filter-menu-title" id="custom-filter-menu-title">Выбор</div><div class="custom-filter-menu-options" id="custom-filter-menu-options"></div></div>';document.body.appendChild(m);var bd = m.querySelector('.custom-filter-menu-backdrop');if (bd) bd.addEventListener('click', closeCustomFilterMenu);return m;}
function renderCustomFilterMenu() {
  var m = ensureCustomFilterMenu(),te = getEl('custom-filter-menu-title'),oe = getEl('custom-filter-menu-options');
  if (!customFilterMenuState || !te || !oe) return;
  te.textContent = customFilterMenuState.title || 'Выбор';
  var html = [],opts = customFilterMenuState.options;
  for (var i = 0; i < opts.length; i++) {
    var o = opts[i],cls = i === customFilterMenuState.index ? 'custom-filter-option active' : 'custom-filter-option',sel = String(o.value) === String(customFilterMenuState.value) ? ' ✓' : '';
    html.push('<div class="' + cls + '" data-index="' + i + '">' + o.label + sel + '</div>');
  }
  oe.innerHTML = html.join('');
  setTimeout(scrollToActiveFilterOption, 10);
}
function closeCustomFilterMenu() {var m = getEl('custom-filter-menu');if (m) m.classList.add('hidden');customFilterMenuState = null;return true;}
function scrollToActiveFilterOption() {var ao = document.querySelector('.custom-filter-option.active'),oc = getEl('custom-filter-menu-options');if (!ao || !oc) return;var cr = oc.getBoundingClientRect(),or = ao.getBoundingClientRect(),st = oc.scrollTop,ot = or.top - cr.top;if (ot < 0) oc.scrollTop = st + ot - 10;else if (ot + or.height > cr.height) oc.scrollTop = st + (ot + or.height - cr.height) + 10;}
function moveCustomFilterMenu(d) {if (!customFilterMenuState || !customFilterMenuState.options.length) return true;var l = customFilterMenuState.options.length,n = customFilterMenuState.index + d;if (n < 0 || n >= l) return true;customFilterMenuState.index = n;renderCustomFilterMenu();setTimeout(scrollToActiveFilterOption, 10);return true;}
function applyCustomFilterMenuSelection() {if (!customFilterMenuState || !customFilterMenuState.selectEl) return false;var s = customFilterMenuState.selectEl,o = customFilterMenuState.options,i = customFilterMenuState.index,c = o[i];if (!c) return false;s.value = String(c.value);try {var e = document.createEvent('Event');e.initEvent('change', true, true);s.dispatchEvent(e);} catch (e) {}if (typeof window.getCurrentSearchMode === 'function') window.getCurrentSearchMode();closeCustomFilterMenu();try {focusEl(s);} catch (e) {}return true;}
function isCustomFilterMenuOpen() {var m = getEl('custom-filter-menu');return !!(m && !m.classList.contains('hidden') && customFilterMenuState);}
function openNativeSearchControl(el) {
  if (!VISIBLE(el)) return false;
  if (el.tagName === 'SELECT') {
    var fg = el.closest('.filter-group'),tl = fg ? fg.querySelector('.filter-label') : null,t = tl && tl.textContent ? tl.textContent.trim() : 'Выбор',o = [];
    for (var i = 0; i < el.options.length; i++) o.push({ value: el.options[i].value, label: el.options[i].textContent || el.options[i].label || el.options[i].value });
    var idx = 0;for (var j = 0; j < o.length; j++) if (String(o[j].value) === String(el.value)) {idx = j;break;}if (idx < 0) idx = 0;
    customFilterMenuState = { selectEl: el, title: t, options: o, index: idx, value: el.value };var m = ensureCustomFilterMenu();m.classList.remove('hidden');renderCustomFilterMenu();return true;
  }
  focusEl(el, { nativeFocus: true });try {el.focus();} catch (e) {}try {el.click();} catch (e) {}return true;
}


function setupFocusRescue() {
  window.focusFirstTorrentCard = function () {return ScreenStrategies.torrents.ensureFocus(true);};
  window.focusFirstCatalogCard = function () {return ScreenStrategies.catalog.ensureFocus(true);};
  window.focusSearchHome = function (p) {if (p === undefined) p = true;return ScreenStrategies.search.ensureFocus(true, p);};
  window.ensureCatalogFocus = ScreenStrategies.catalog.ensureFocus;
  window.ensureDetailFocus = ScreenStrategies.detail.ensureFocus;
  window.ensureTorrentFocus = ScreenStrategies.torrents.ensureFocus;
  window.ensureSearchFocus = ScreenStrategies.search.ensureFocus;
  window.ensureConfigFocus = ScreenStrategies.config.ensureFocus;

  document.addEventListener('keydown', function (e) {
    var s = currentScreen();
    if (s === 'player') return;
    if (['home', 'torrents', 'catalog', 'search', 'detail', 'config', 'donate'].indexOf(s) === -1) return;
    var a = document.activeElement,ed = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
    if (isBackKey(e.keyCode)) {
      e.preventDefault();
      e.stopImmediatePropagation();





      if (ed) {blurEditor();if (s === 'search') ScreenStrategies.search.ensureFocus(true, true);else if (s === 'catalog') ScreenStrategies.catalog.ensureFocus(true);else if (s === 'config') ScreenStrategies.config.ensureFocus(true);else if (s === 'detail') ScreenStrategies.detail.ensureFocus(true);else ScreenStrategies.torrents.ensureFocus(true);return;}
      var po = getEl('playback-overlay'),ip = po && po.classList.contains('active');
      if (ip) {cancelCurrentPlayback();return;}
      if (isCustomFilterMenuOpen()) {closeCustomFilterMenu();return;}
      if (s === 'catalog' && window.catalogState && window.catalogState.currentCatalog) {window.catalogState.lastSelectedIndex = 0;window.catalogState.lastSelectedId = null;localStorage.removeItem('lastCatalogCardIndex');}
      onBack();
      return;
    }
    if (isArrowKey(e.keyCode)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      var d = arrowDir(e.keyCode);
      if (isCustomFilterMenuOpen()) {if (d === 'up') moveCustomFilterMenu(-1);else if (d === 'down') moveCustomFilterMenu(1);return;}



      navKeyRepeat = !!e.repeat;
      setNavHold(d);




      runScreenNavigation(d);
      return;
    }
    if (isOkKey(e.keyCode)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      var okNow = Date.now();
      var okRepeat = e.repeat || okKeyHeld && okNow - okKeyLastDown < OK_HELD_STALE_MS;
      okKeyHeld = true;
      okKeyLastDown = okNow;
      if (isCustomFilterMenuOpen()) {applyCustomFilterMenuSelection();return;}
      if (s === 'torrents') {
        var f = document.querySelector('.focused');
        if (f && f.classList.contains('torrent-card')) {
          if (!okRepeat) {
            okHoldHandled = false;
            okHoldFocused = f;
            clearOkHold();
            okHoldTimer = setTimeout(_asyncToGenerator(function* () {
              okHoldHandled = true;
              var h = okHoldFocused && okHoldFocused.dataset ? okHoldFocused.dataset.hash : null;
              if (typeof window.setTorrentClickSuppressed === 'function') window.setTorrentClickSuppressed(1500);
              if (okHoldFocused) okHoldFocused.dataset.suppressClick = '1';
              if (h && typeof window.removeTorrentByHash === 'function') yield window.removeTorrentByHash(h, { skipConfirm: true });
              setTimeout(function () {if (okHoldFocused) delete okHoldFocused.dataset.suppressClick;}, 1500);
            }), OK_HOLD_DELETE_MS);
          }
          return;
        }
      }




      if ((s === 'home' || s === 'catalog') && typeof window.getHistoryCardEntry === 'function') {


        if (okRepeat && okHoldFocused) return;
        var hf = document.querySelector('.focused');
        if (hf && window.getHistoryCardEntry(hf)) {
          if (!okRepeat) {
            okHoldHandled = false;
            okHoldFocused = hf;
            clearOkHold();
            okHoldTimer = setTimeout(function () {
              okHoldHandled = true;
              if (okHoldFocused && typeof window.removeHistoryCard === 'function') window.removeHistoryCard(okHoldFocused);
            }, OK_HOLD_DELETE_MS);
          }
          return;
        }
      }
      onOk();
      return;
    }
  }, true);

  var prevShow = window.showDetail;
  if (typeof prevShow === 'function') {
    window.showDetail = function () {
      var o = prevShow.apply(this, arguments);
      setTimeout(function () {if (currentScreen() !== 'player') ScreenStrategies.detail.ensureFocus(true);}, 220);
      return o;
    };
  }

  var prevSR = window.showSearchResults;
  if (typeof prevSR === 'function') {
    window.showSearchResults = function (opts) {
      var o = prevSR.apply(this, arguments);
      setTimeout(function () {



        if (opts && opts.restoreCard) {
          var f = document.querySelector('.focused');
          if (f && f.classList.contains('global-search-card')) return;
        }
        ScreenStrategies.search.ensureFocus(true, true);
      }, 120);
      return o;
    };
  }

  setTimeout(function () {ScreenStrategies.torrents.ensureFocus(true);}, 120);

  window.handleConfigNavigation = handleConfigNavigation;
  window.getConfigMenuItems = getConfigMenuItems;
  window.getTorrentTabs = getTorrentTabs;
  window.switchConfigTab = switchConfigTab;
  window.setConfigMenuActive = setConfigMenuActive;
}












function rearmBackSentinel() {
  window.history.pushState({ page: 'main' }, '');
}

window.addEventListener('popstate', function (e) {
  if (window.swipeBlocked) {rearmBackSentinel();return;}
  var now = Date.now();
  if (now - lastPopStateTime < 500) {rearmBackSentinel();return;}
  lastPopStateTime = now;
  if (isProcessingBack) {rearmBackSentinel();return;}
  isProcessingBack = true;
  e.preventDefault();
  e.stopPropagation();
  var be = new KeyboardEvent('keydown', {
    keyCode: 27,
    key: 'Escape',
    bubbles: true,
    cancelable: true
  });
  document.dispatchEvent(be);
  setTimeout(function () {
    rearmBackSentinel();
    setTimeout(function () {
      isProcessingBack = false;
    }, 300);
  }, 150);
});

rearmBackSentinel();
window.blockSwipe = function (ms) {
  window.swipeBlocked = true;
  setTimeout(function () {
    window.swipeBlocked = false;
  }, ms || 500);
};


function setupPlayerWheelControl() {
  var STEP = 0.02;
  var lastWheelTime = 0;
  var WHEEL_THROTTLE = 50;

  document.addEventListener('wheel', function (e) {

    if (!AppState || AppState.currentScreen !== 'player') return;


    var now = Date.now();
    if (now - lastWheelTime < WHEEL_THROTTLE) return;
    lastWheelTime = now;


    e.preventDefault();

    var videoPlayer = getEl('video-player');
    var volumeSlider = getEl('volume-slider');

    if (!videoPlayer) return;


    var delta = e.deltaY < 0 ? STEP : -STEP;


    var currentVolume = videoPlayer.volume;
    var newVolume = currentVolume + delta;


    newVolume = Math.max(0, Math.min(1, newVolume));


    newVolume = Math.round(newVolume * 100) / 100;


    videoPlayer.volume = newVolume;


    if (volumeSlider) {
      volumeSlider.value = newVolume;
    }


    if (newVolume > 0 && videoPlayer.muted) {
      videoPlayer.muted = false;
      if (typeof window.updateMuteButton === 'function') {
        window.updateMuteButton();
      }
    }


    if (typeof window.resetMouseIdleTimer === 'function') {
      window.resetMouseIdleTimer();
    }


    try {
      localStorage.setItem('playerVolume', newVolume);
    } catch (err) {}

  }, { passive: false });
}


function setupMouseControls() {
  document.addEventListener('contextmenu', function (e) {

    var target = e.target;
    if (target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable) {
      return;
    }


    e.preventDefault();
    e.stopPropagation();


    onBack();

    return false;
  });
}






function isCatalogRowsMode() {
  if (window.catalogState.currentCatalog) return false;
  var row = document.querySelector('#catalog-rows .catalog-row');
  return !!row && VISIBLE(row);
}


function getCatalogRows() {




  if (_rowsCache.gen === _focusGen && _rowsCache.rows &&
  _rowsCache.rows.length > 0 && _rowsCache.rows[0][0] &&
  _rowsCache.rows[0][0].isConnected !== false) {
    return _rowsCache.rows;
  }

  var rows = [];
  var rowEls = document.querySelectorAll('#catalog-rows .catalog-row');
  for (var i = 0; i < rowEls.length; i++) {
    var cards = rowEls[i].querySelectorAll('.catalog-row-card');
    if (!cards.length) cards = rowEls[i].querySelectorAll('.torrent-card');
    var visible = [];
    for (var j = 0; j < cards.length; j++) if (VISIBLE(cards[j])) visible.push(cards[j]);
    if (visible.length > 0) rows.push(visible);
  }

  _rowsCache.gen = _focusGen;
  _rowsCache.rows = rows;

  return rows;
}

function getCatalogRowHeaders() {
  var headers = document.querySelectorAll('#catalog-rows .catalog-row-header');
  var visible = [];
  for (var i = 0; i < headers.length; i++) if (VISIBLE(headers[i])) visible.push(headers[i]);
  return visible;
}

function focusRowHeader(ri) {
  var headers = getCatalogRowHeaders();
  if (!headers[ri]) return true;
  var header = headers[ri];


  updateFocusableElements();
  var idx = focusableElements.indexOf(header);
  if (idx !== -1) setFocus(idx);else
  focusEl(header);
  return true;
}


function findRowPosition(el, rows) {
  for (var i = 0; i < rows.length; i++) {
    for (var j = 0; j < rows[i].length; j++) {
      if (rows[i][j] === el) return { row: i, col: j };
    }
  }
  return null;
}


function scrollRowToCard(card) {
  var viewport = card.closest ? card.closest('.catalog-row-viewport') : null;
  if (!viewport) return;
  var cr = card.getBoundingClientRect();
  var vr = viewport.getBoundingClientRect();
  var pad = 50;
  var cur = getScrollX(viewport);
  var target = null;
  if (cr.left < vr.left + pad) target = cur + (cr.left - vr.left - pad);else
  if (cr.right > vr.right - pad) target = cur + (cr.right - vr.right + pad);
  if (target === null) return;


  setScrollX(viewport, target, true);
}


function focusRowCard(ri, ci, rows) {
  if (!rows || !rows[ri] || !rows[ri][ci]) return true;
  var card = rows[ri][ci];

  updateFocusableElements();
  var idx = focusableElements.indexOf(card);
  if (idx !== -1) setFocus(idx);else
  focusEl(card);
  return true;
}


function handleRowsNavigation(dir) {
  lastNavDirection = dir;
  var rows = getCatalogRows();
  if (!rows.length) return false;
  var f = belongsToScreen(document.querySelector('.focused'), 'catalog') ? document.querySelector('.focused') : null;
  var h = getTorrentHeader(),t = getTorrentTabs();
  if (!f) return focusRowCard(0, 0, rows);


  var pos = findRowPosition(f, rows);
  if (pos) {
    if (dir === 'left') {
      if (pos.col > 0) return focusRowCard(pos.row, pos.col - 1, rows);
      return true;
    }
    if (dir === 'right') {
      if (pos.col < rows[pos.row].length - 1) return focusRowCard(pos.row, pos.col + 1, rows);
      return true;
    }
    if (dir === 'up') {
      if (pos.row > 0) {
        var tc = Math.min(pos.col, rows[pos.row - 1].length - 1);
        return focusRowCard(pos.row - 1, tc, rows);
      }
      return focusEl(t[0] || h[0] || f);
    }
    if (dir === 'down') {
      if (pos.row < rows.length - 1) {
        var tc2 = Math.min(pos.col, rows[pos.row + 1].length - 1);
        return focusRowCard(pos.row + 1, tc2, rows);
      }
      return true;
    }
    return true;
  }


  var ti = -1;
  for (var i = 0; i < t.length; i++) if (f === t[i]) {ti = i;break;}
  if (ti !== -1) {
    if (dir === 'left') return focusEl(t[Math.max(0, ti - 1)] || f);
    if (dir === 'right') return focusEl(t[Math.min(t.length - 1, ti + 1)] || f);
    if (dir === 'down') return focusRowCard(0, 0, rows);
    if (dir === 'up') return focusEl(h[Math.min(ti, h.length - 1)] || h[0] || f);
    return true;
  }


  var hi = -1;
  for (var i = 0; i < h.length; i++) if (f === h[i]) {hi = i;break;}
  if (hi !== -1) {
    if (dir === 'left') return focusEl(h[Math.max(0, hi - 1)] || f);
    if (dir === 'right') return focusEl(h[Math.min(h.length - 1, hi + 1)] || f);
    if (dir === 'down') return focusRowCard(0, 0, rows);
    return true;
  }


  return focusRowCard(0, 0, rows);
}


function initControl() {
  setupKeyboardHandlers();
  setupFocusRescue();
  setupPlayerWheelControl();
  setupMouseControls();
  window.updateFocusableElements = updateFocusableElements;
  window.setFocus = setFocus;
  window.navigate = navigate;
  window.showPlayerControls = showPlayerControls;
  window.hidePlayerControls = hidePlayerControls;
  window.hidePlayerPanelsOnly = hidePlayerPanelsOnly;
  window.hidePlayerUi = hidePlayerUi;
  window.focusFirstTorrentCard = focusFirstTorrentCard;
  window.focusSearchHome = focusSearchHome;
  window.focusEl = focusEl;
  window.invalidateFocusCache = invalidateFocusCache;
  window.showSeekOverlay = showSeekOverlay;
  window.hideSeekOverlay = hideSeekOverlay;
  window.scheduleHideSeekOverlay = scheduleHideSeekOverlay;
  window.openNativeSearchControl = window.openNativeSearchControl || function (el) {if (el && (el.tagName === 'SELECT' || el.id === 'filter-year')) {el.focus();try {el.click();} catch (e) {}}};
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initControl);else initControl();














(function () {
  var H_SCROLL_SELECTOR = '.files-list, ' +
  '.catalog-detail-actors-grid, ' +
  '.catalog-detail-recommendations-grid, ' +
  '.catalog-row-viewport, ' +
  '.catalog-row';




  var TOUCH_AXIS_THRESHOLD = 10;
  var FLING_MS = 140;
  var FLING_IDLE_MS = 80;


  function state(cnt) {
    if (!cnt._hScroll) cnt._hScroll = { target: getScrollX(cnt), rafId: null };
    return cnt._hScroll;
  }

  function clampX(cnt, value) {
    return Math.max(0, Math.min(getMaxScrollX(cnt), value));
  }

  function stopGlide(cnt) {
    var st = state(cnt);
    if (st.rafId) {cancelAnimationFrame(st.rafId);st.rafId = null;}
  }

  function step(cnt) {
    var st = state(cnt);
    var current = getScrollX(cnt);
    var diff = st.target - current;

    if (Math.abs(diff) < 0.6) {
      setScrollXImmediate(cnt, st.target);
      st.rafId = null;
      return;
    }






    var factor = getScrollAnimMode() === 'fast' ? 0.3 : 0.16;
    setScrollXImmediate(cnt, current + diff * factor);

    st.rafId = requestAnimationFrame(function () {step(cnt);});
  }


  function glideTo(cnt, left) {
    var st = state(cnt);
    st.target = clampX(cnt, left);


    if (getScrollAnimMode() === 'none') {
      stopGlide(cnt);
      setScrollXImmediate(cnt, st.target);
      return;
    }
    if (!st.rafId) st.rafId = requestAnimationFrame(function () {step(cnt);});
  }






  function findContainer(target) {
    if (!target || !target.closest) return null;
    var cnt = target.closest(H_SCROLL_SELECTOR);
    if (!cnt || getMaxScrollX(cnt) <= 0) return null;
    return cnt;
  }

  document.addEventListener('wheel', function (e) {
    var cnt = findContainer(e.target);
    if (!cnt) return;

    var dy =
    e.deltaY ||
    e.wheelDeltaY || (
    e.wheelDelta ? -e.wheelDelta / 40 : 0) ||
    e.detail ||
    0;

    var dx = e.deltaX || e.wheelDeltaX || 0;
    var delta;

    if (Math.abs(dx) > Math.abs(dy)) {


      return;
    } else {





      if (!e.shiftKey) return;
      delta = dy;
    }
    if (!delta) return;

    var st = state(cnt);


    if (!st.rafId) st.target = getScrollX(cnt);




    var max = getMaxScrollX(cnt);
    if (delta < 0 && st.target <= 0.5 || delta > 0 && st.target >= max - 0.5) return;

    e.preventDefault();
    glideTo(cnt, st.target + delta * 0.9);
  }, { passive: false });


  var drag = null;

  document.addEventListener('touchstart', function (e) {
    drag = null;
    if (!e.touches || e.touches.length !== 1) return;
    var cnt = findContainer(e.target);
    if (!cnt) return;

    stopGlide(cnt);
    var t = e.touches[0];
    drag = {
      cnt: cnt,
      startX: t.clientX,
      startY: t.clientY,
      startScroll: getScrollX(cnt),
      axis: null,
      lastX: t.clientX,
      lastT: Date.now(),
      velocity: 0
    };
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (!drag || !e.touches || e.touches.length !== 1) return;

    var t = e.touches[0];
    var dx = drag.startX - t.clientX;
    var dy = drag.startY - t.clientY;

    if (!drag.axis) {
      if (Math.abs(dx) < TOUCH_AXIS_THRESHOLD && Math.abs(dy) < TOUCH_AXIS_THRESHOLD) return;


      if (Math.abs(dy) >= Math.abs(dx)) {drag = null;return;}
      drag.axis = 'x';
    }

    e.preventDefault();

    var now = Date.now();
    var dt = now - drag.lastT;

    if (dt > 0) drag.velocity = (drag.lastX - t.clientX) / dt;
    drag.lastX = t.clientX;
    drag.lastT = now;

    setScrollXImmediate(drag.cnt, clampX(drag.cnt, drag.startScroll + dx));
  }, { passive: false });

  function endDrag() {
    if (!drag) return;
    var d = drag;
    drag = null;
    if (d.axis !== 'x') return;

    var velocity = Date.now() - d.lastT > FLING_IDLE_MS ? 0 : d.velocity;
    glideTo(d.cnt, getScrollX(d.cnt) + velocity * FLING_MS);
  }

  document.addEventListener('touchend', endDrag, { passive: true });
  document.addEventListener('touchcancel', endDrag, { passive: true });



  window.initSmoothHorizontalScroll = function () {};
})();











(function () {
  var EDGE_SELECTOR = '#catalog-rows .catalog-row-viewport, ' +
  '#detail-view .files-list, ' +
  '#detail-view .catalog-detail-actors-grid, ' +
  '#detail-view .catalog-detail-recommendations-grid';
  var STEP_MS = 320;
  var STEP_SEC = 0.3;

  var hover = { el: null, dir: 0, timer: null };
  var metrics = { el: null, at: 0, box: null, step: 0 };
  var lastMoveAt = 0,lastX = -1,lastY = -1,touchedAt = 0;


  function cardStep(el) {
    var all = el.children;
    if (all.length === 1 && all[0].children.length > 1) all = all[0].children;


    var items = [];
    for (var i = 0; i < all.length && items.length < 2; i++) {
      if (all[i].offsetWidth > 0) items.push(all[i]);
    }
    if (items.length > 1) {
      var s = items[1].offsetLeft - items[0].offsetLeft;
      if (s > 10) return s;
    }
    if (items.length === 1) return items[0].offsetWidth;
    return Math.max(120, (el.clientWidth || 600) * 0.25);
  }



  function rowMetrics(el) {
    var now = Date.now();
    if (metrics.el !== el || now - metrics.at > 500) {
      metrics.el = el;
      metrics.at = now;
      metrics.box = el.getBoundingClientRect();
      metrics.step = cardStep(el);
    }
    return metrics;
  }

  function stop() {
    if (hover.timer) {clearInterval(hover.timer);hover.timer = null;}
    hover.el = null;
    hover.dir = 0;
  }

  function stepOnce() {
    var el = hover.el;
    if (!el || !el.isConnected || !hover.dir || el.offsetParent === null) {stop();return;}
    var screen = window.AppState && AppState.currentScreen;
    if (screen !== 'catalog' && screen !== 'detail') {stop();return;}
    var cur = getScrollX(el),max = getMaxScrollX(el);
    if (hover.dir < 0 && cur <= 0.5 || hover.dir > 0 && cur >= max - 0.5) {stop();return;}
    setScrollX(el, cur + hover.dir * rowMetrics(el).step, true, STEP_SEC);
  }


  function start(el, dir) {
    if (hover.el === el && hover.dir === dir && hover.timer) return true;
    stop();
    hover.el = el;
    hover.dir = dir;
    stepOnce();
    if (!hover.dir) return false;
    hover.timer = setInterval(stepOnce, STEP_MS);
    return true;
  }

  document.addEventListener('touchstart', function () {touchedAt = Date.now();stop();}, { passive: true });

  document.addEventListener('mousemove', function (e) {
    var now = Date.now();

    if (now - touchedAt < 800) return;
    if (now - lastMoveAt < 50) return;

    if (e.clientX === lastX && e.clientY === lastY) return;
    lastMoveAt = now;lastX = e.clientX;lastY = e.clientY;

    var el = e.target && e.target.closest ? e.target.closest(EDGE_SELECTOR) : null;
    if (!el || getMaxScrollX(el) <= 0) {stop();return;}
    var m = rowMetrics(el);
    var w = m.box.width || el.clientWidth || 0;

    var zone = Math.max(60, Math.min(m.step, w * 0.3));
    if (e.clientX >= m.box.right - zone) {if (start(el, 1)) return;} else
    if (e.clientX <= m.box.left + zone) {if (start(el, -1)) return;}
    stop();
  }, { passive: true });


  document.addEventListener('mouseout', function (e) {if (!e.relatedTarget) stop();}, { passive: true });
  window.addEventListener('blur', stop);
})();
