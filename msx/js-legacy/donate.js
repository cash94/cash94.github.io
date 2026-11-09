/* Сборка для старых браузеров (Chrome 53) из js/donate.js — tools/legacy-build/build.js. Руками не править. */
var DONATE_URL = 'https://pay.cloudtips.ru/p/d3985402';
var DONATE_URL_LABEL = 'pay.cloudtips.ru/p/d3985402';
var DONATE_QR = 'https://cash94.github.io/msx/qr-donate.png';
var donateOverlay = null;
function initDonateOverlay() {
  if (donateOverlay) return;
  donateOverlay = document.createElement('div');
  donateOverlay.id = 'donate-overlay';
  donateOverlay.className = 'donate-overlay hidden';
  donateOverlay.innerHTML = '<div class="donate-overlay-backdrop"></div>' + '<div class="donate-overlay-panel" role="dialog" aria-modal="true" aria-labelledby="donate-title">' + '<div class="donate-handle"></div>' + '<div class="donate-qr-col">' + '<div class="donate-qr-card">' + '<img src="' + DONATE_QR + '" alt="QR-код страницы доната" class="donate-qr-image">' + '</div>' + '<div class="donate-qr-url">' + DONATE_URL_LABEL + '</div>' + '</div>' + '<div class="donate-main">' + '<div class="donate-badge"><i class="fi fi-rr-hand-holding-heart"></i></div>' + '<div class="donate-eyebrow">Поддержка проекта</div>' + '<h3 class="donate-title" id="donate-title">Нравится TorrStream?<br>Поддержите разработку</h3>' + '<p class="donate-text">' + '<span class="donate-text-tv">Наведите камеру телефона на QR-код или откройте страницу доната. </span>' + 'Поддержка помогает развивать проект и добавлять новые функции.' + '</p>' + '<div class="donate-methods">' + '<span class="donate-chip">СБП</span>' + '<span class="donate-chip">T-Pay</span>' + '<span class="donate-chip">Банковская карта</span>' + '</div>' + '<div class="donate-actions">' + '<a class="donate-btn donate-btn-primary" id="donate-open-btn" href="' + DONATE_URL + '" target="_blank" rel="noopener noreferrer">Открыть страницу доната</a>' + '<button type="button" class="donate-btn donate-btn-secondary" id="donate-close-btn">Позже</button>' + '</div>' + '<div class="donate-hint">Назад — закрыть</div>' + '</div>' + '</div>';
  document.body.appendChild(donateOverlay);
  var qrImg = donateOverlay.querySelector('.donate-qr-image');
  if (qrImg) {
    qrImg.addEventListener('error', function () {
      var col = donateOverlay.querySelector('.donate-qr-col');
      if (col) col.style.display = 'none';
    });
  }
  var closeBtn = getEl('donate-close-btn');
  var backdrop = donateOverlay.querySelector('.donate-overlay-backdrop');
  if (closeBtn) closeBtn.addEventListener('click', closeDonateOverlay);
  if (backdrop) backdrop.addEventListener('click', closeDonateOverlay);
}
function isDonateOpen() {
  return !!(donateOverlay && !donateOverlay.classList.contains('hidden'));
}
function getDonateItems() {
  if (!isDonateOpen()) return [];
  var all = donateOverlay.querySelectorAll('.donate-btn');
  var out = [];
  for (var i = 0; i < all.length; i++) if (all[i].offsetParent !== null) out.push(all[i]);
  return out;
}
function focusDonateItem(el) {
  if (!el || typeof focusEl !== 'function') return false;
  focusEl(el);
  return true;
}
function ensureDonateFocus(force) {
  var items = getDonateItems();
  if (!items.length) return false;
  var f = document.querySelector('.focused');
  if (!force && f && items.indexOf(f) !== -1) return true;
  return focusDonateItem(items[0]);
}
function showDonateOverlay() {
  if (window.Nav) Nav.push('donate', {
    key: 'donate'
  });
  initDonateOverlay();
  if (!donateOverlay) return;
  AppState.currentScreen = 'donate';
  donateOverlay.classList.remove('hidden');
  var touch = window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  if (!touch) setTimeout(function () {
    ensureDonateFocus(true);
  }, 50);
}
function closeDonateOverlay() {
  var navBack = window.Nav ? Nav.returnTarget(Nav.pop('donate')) : null;
  if (donateOverlay) {
    donateOverlay.classList.add('hidden');
    var f = donateOverlay.querySelector('.focused');
    if (f) f.classList.remove('focused');
    if (typeof window.restoreDetailAfterOverlay === 'function' && window.restoreDetailAfterOverlay()) return;
    AppState.currentScreen = navBack || AppState.inSearch;
    setTimeout(function () {
      var donateTab = getEl('tab-donate');
      if (donateTab && typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
        updateFocusableElements();
        var donateIndex = -1;
        for (var i = 0; i < focusableElements.length; i++) {
          if (focusableElements[i].id === 'tab-donate') {
            donateIndex = i;
            break;
          }
        }
        if (donateIndex !== -1) {
          setFocus(donateIndex);
        }
      }
    }, 100);
  }
}
function toggleDonateOverlay() {
  if (isDonateOpen()) {
    closeDonateOverlay();
  } else {
    showDonateOverlay();
  }
}
function registerDonateStrategy() {
  if (typeof ScreenStrategies === 'undefined' || !ScreenStrategies.torrents) {
    setTimeout(registerDonateStrategy, 100);
    return;
  }
  if (ScreenStrategies.donate) return;
  ScreenStrategies.donate = {
    getItems: getDonateItems,
    ensureFocus: ensureDonateFocus,
    handleNavigation: function (dir) {
      var items = getDonateItems();
      var i = items.indexOf(document.querySelector('.focused'));
      if (i === -1) return ensureDonateFocus(true);
      var next = dir === 'left' || dir === 'up' ? i - 1 : i + 1;
      if (next < 0 || next >= items.length) return true;
      return focusDonateItem(items[next]);
    },
    onOk: function (f) {
      if (getDonateItems().indexOf(f) === -1) return ensureDonateFocus(true);
      f.click();
      return true;
    }
  };
}
function setupDonateButton() {
  var donateTab = getEl('tab-donate');
  if (!donateTab) {
    console.warn('⚠️ Кнопка tab-donate не найдена');
    return;
  }
  donateTab.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    console.log('❤️ Открытие окна доната');
    showDonateOverlay();
  });
  console.log('✅ Кнопка доната настроена');
}
function addDonateStyles() {
  var styleId = 'donate-styles';
  if (getEl(styleId)) return;
  function u(px) {
    return (px / 10.8).toFixed(3) + 'vh';
  }
  var css = ['.donate-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 1000;', '  display: -webkit-flex; display: flex; -webkit-align-items: center; align-items: center;', '  -webkit-justify-content: center; justify-content: center; }', '.donate-overlay.hidden { display: none; }', '.donate-overlay-backdrop { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.62); }', '.donate-overlay-panel { position: relative; box-sizing: border-box;', '  display: -webkit-flex; display: flex; -webkit-align-items: center; align-items: center;', '  max-height: 94vh; overflow-y: auto; padding: ' + u(56) + ';', '  border-radius: ' + u(28) + '; background: #16161c;', '  border: 1px solid rgba(255, 255, 255, 0.1); color: #fff;', '  -webkit-animation: donateFadeIn 0.22s ease-out; animation: donateFadeIn 0.22s ease-out; }', '@-webkit-keyframes donateFadeIn { from { opacity: 0; -webkit-transform: scale(0.96); } to { opacity: 1; -webkit-transform: scale(1); } }', '@keyframes donateFadeIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }', '.donate-handle { display: none; }', '.donate-qr-col { -webkit-flex: none; flex: none; margin-right: ' + u(56) + ';', '  display: -webkit-flex; display: flex; -webkit-flex-direction: column; flex-direction: column;', '  -webkit-align-items: center; align-items: center; }', '.donate-qr-card { box-sizing: border-box; width: ' + u(360) + '; height: ' + u(360) + '; padding: ' + u(20) + ';', '  background: #fff; border-radius: ' + u(24) + '; }', '.donate-qr-image { display: block; width: 100%; height: 100%; }', '.donate-qr-url { margin-top: ' + u(20) + '; font-size: ' + u(20) + '; line-height: ' + u(26) + '; color: #83838f; }', '.donate-main { -webkit-flex: none; flex: none; width: ' + u(592) + '; }', '.donate-badge { width: ' + u(72) + '; height: ' + u(72) + '; border-radius: ' + u(20) + ';', '  background: rgba(255, 140, 0, 0.16); color: #ff8c00;', '  display: -webkit-flex; display: flex; -webkit-align-items: center; align-items: center;', '  -webkit-justify-content: center; justify-content: center; }', '.donate-badge i { font-size: ' + u(36) + '; line-height: 1; display: block; }', '.donate-eyebrow { margin-top: ' + u(28) + '; font-size: ' + u(20) + '; line-height: ' + u(26) + ';', '  font-weight: 600; letter-spacing: ' + u(2) + '; text-transform: uppercase; color: #ff8c00; }', '.donate-title { margin: ' + u(12) + ' 0 0; font-size: ' + u(44) + '; line-height: ' + u(54) + '; font-weight: 700; color: #fff; }', '.donate-text { margin: ' + u(20) + ' 0 0; font-size: ' + u(24) + '; line-height: ' + u(36) + '; color: #c4c4cc; }', '.donate-methods { margin-top: ' + u(28) + '; display: -webkit-flex; display: flex; -webkit-flex-wrap: wrap; flex-wrap: wrap; }', '.donate-chip { display: -webkit-inline-flex; display: inline-flex; -webkit-align-items: center; align-items: center;', '  height: ' + u(44) + '; padding: 0 ' + u(20) + '; margin-right: ' + u(12) + ';', '  border-radius: ' + u(22) + '; background: rgba(255, 255, 255, 0.14);', '  font-size: ' + u(20) + '; font-weight: 500; color: #fff; white-space: nowrap; }', '.donate-actions { margin-top: ' + u(44) + '; display: -webkit-flex; display: flex; }', '.donate-btn { box-sizing: border-box; display: -webkit-inline-flex; display: inline-flex;', '  -webkit-align-items: center; align-items: center; -webkit-justify-content: center; justify-content: center;', '  height: ' + u(64) + '; padding: 0 ' + u(36) + '; border: none; border-radius: ' + u(12) + ';', '  font-family: inherit; font-size: ' + u(24) + '; font-weight: 600; white-space: nowrap;', '  text-decoration: none; cursor: pointer; outline: none; }', '.donate-btn-primary { margin-right: ' + u(16) + '; background: #fff; color: #000; }', '.donate-btn-secondary { background: rgba(255, 255, 255, 0.14); color: #fff; }', '.donate-btn-primary:hover { background: #e8e8ec; }', '.donate-btn-secondary:hover { background: rgba(255, 255, 255, 0.22); }', '.donate-btn.focused { border-radius: ' + u(12) + '; }', '.donate-hint { margin-top: ' + u(24) + '; font-size: ' + u(20) + '; line-height: ' + u(26) + '; color: #83838f; }', '@media (hover: none) and (pointer: coarse) { .donate-hint { display: none; } }', '@media (orientation: portrait), (max-height: 559px) {', '  .donate-overlay { -webkit-align-items: flex-end; align-items: flex-end; }', '  .donate-overlay-panel { display: block; width: 100%; max-width: 600px; max-height: 92vh;', '    padding: 12px 24px 34px; border-radius: 28px 28px 0 0; border: none;', '    -webkit-animation: donateSheetIn 0.24s ease-out; animation: donateSheetIn 0.24s ease-out; }', '  .donate-handle { display: block; width: 40px; height: 5px; margin: 0 auto 20px; border-radius: 3px; background: rgba(255, 255, 255, 0.25); }', '  .donate-qr-col, .donate-text-tv, .donate-hint { display: none; }', '  .donate-main { width: auto; }', '  .donate-badge { width: 56px; height: 56px; border-radius: 16px; }', '  .donate-badge i { font-size: 26px; }', '  .donate-eyebrow { margin-top: 20px; font-size: 13px; line-height: 18px; letter-spacing: 1.3px; }', '  .donate-title { margin-top: 8px; font-size: 24px; line-height: 30px; }', '  .donate-text { margin-top: 12px; font-size: 16px; line-height: 24px; }', '  .donate-methods { margin-top: 20px; }', '  .donate-chip { height: 32px; padding: 0 14px; margin: 0 8px 8px 0; border-radius: 16px; font-size: 14px; }', '  .donate-actions { margin-top: 20px; -webkit-flex-direction: column; flex-direction: column; }', '  .donate-btn { width: 100%; height: 52px; padding: 0 24px; border-radius: 12px; font-size: 17px; }', '  .donate-btn.focused { border-radius: 12px; }', '  .donate-btn-primary { margin: 0 0 10px; }', '}', '@supports (padding-bottom: env(safe-area-inset-bottom)) {', '  @media (orientation: portrait), (max-height: 559px) {', '    .donate-overlay-panel { padding-bottom: calc(34px + env(safe-area-inset-bottom)); }', '  }', '}', '@-webkit-keyframes donateSheetIn { from { -webkit-transform: translateY(40px); opacity: 0; } to { -webkit-transform: translateY(0); opacity: 1; } }', '@keyframes donateSheetIn { from { transform: translateY(40px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }'].join('\n');
  var style = document.createElement('style');
  style.id = styleId;
  style.textContent = css;
  document.head.appendChild(style);
}
function initDonate() {
  console.log('❤️ Модуль доната инициализирован');
  addDonateStyles();
  setupDonateButton();
  registerDonateStrategy();
  document.addEventListener('keydown', function (e) {
    if (isDonateOpen()) {
      var isBackKey = [8, 27, 461, 10009].indexOf(e.keyCode) !== -1 || typeof isKeyPressed === 'function' && (isKeyPressed('BACK', e.keyCode) || isKeyPressed('EXIT', e.keyCode));
      if (isBackKey) {
        e.preventDefault();
        e.stopPropagation();
        closeDonateOverlay();
      }
    }
  });
}
window.showDonateOverlay = showDonateOverlay;
window.closeDonateOverlay = closeDonateOverlay;
window.toggleDonateOverlay = toggleDonateOverlay;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDonate);
} else {
  initDonate();
}
