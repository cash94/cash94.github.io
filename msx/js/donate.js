// donate.js - Модуль для отображения донатов

// Создаем оверлей доната (один раз при загрузке)
var donateOverlay = null;

function initDonateOverlay() {
    if (donateOverlay) return;

    donateOverlay = document.createElement('div');
    donateOverlay.id = 'donate-overlay';
    donateOverlay.className = 'donate-overlay hidden';
    donateOverlay.innerHTML = '\n <div class="donate-overlay-backdrop"></div>\n <div class="donate-overlay-panel">\n <div class="donate-overlay-header">\n <h3>Спасибо за поддержку!</h3>\n <button class="donate-close-btn" id="donate-close-btn">X</button>\n </div>\n <div class="donate-overlay-content">\n <div class="donate-qr-container">\n <a href="https://pay.cloudtips.ru/p/d3985402" target="_blank" rel="noopener noreferrer" class="donate-qr-link" title="Перейти на страницу пожертвования">\n <img src="https://cash94.github.io/msx/qr-code.png" alt="QR Code for donation" class="donate-qr-image" onerror="this.style.display=\'none\'; getEl(\'donate-qr-error\').style.display=\'block\'">\n </a>\n <div id="donate-qr-error" class="donate-qr-error" style="display: none;">\n <span>QR-код не найден</span><br>\n <span style="font-size: 12px; margin-top: 10px;">Пожалуйста, убедитесь, что файл qr-code.png находится в корневой папке приложения</span>\n </div>\n </div>\n <div class="donate-info">\n <p>Чтобы поддержать автора отсканируйте qr-код или нажмите на qr-код для перехода на страницу пожертвования.</p>\n <p>Доступные способы пожертвования: T-pay, СБП, Банковская карта.</p>\n <p>Ваши донаты помогут развивать проект и добавлять новые функции.</p>\n </div>\n </div>\n </div>\n ';

    document.body.appendChild(donateOverlay);

    // Добавляем обработчики
    var closeBtn = getEl('donate-close-btn');
    var backdrop = donateOverlay.querySelector('.donate-overlay-backdrop');

    if (closeBtn) {
        closeBtn.addEventListener('click', closeDonateOverlay);
    }

    if (backdrop) {
        backdrop.addEventListener('click', closeDonateOverlay);
    }

    // Обработчики для копирования адресов
    var copyBtns = donateOverlay.querySelectorAll('.donate-copy-btn');
    for (var i = 0; i < copyBtns.length; i++) {
        (function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var textToCopy = btn.dataset.copy;
                if (textToCopy) {
                    navigator.clipboard.writeText(textToCopy).then(function () {
                        var originalText = btn.textContent;
                        btn.textContent = '✓ Скопировано!';
                        btn.style.backgroundColor = '#4caf50';
                        setTimeout(function () {
                            btn.textContent = originalText;
                            btn.style.backgroundColor = '';
                        }, 2000);
                    })['catch'](function () {
                        var originalText = btn.textContent;
                        btn.textContent = '❌ Ошибка';
                        setTimeout(function () {
                            btn.textContent = originalText;
                        }, 2000);
                    });
                }
            });
        })(copyBtns[i]);
    }
}

function showDonateOverlay() {
    initDonateOverlay();
    if (donateOverlay) {
        AppState.currentScreen = 'donate';
        donateOverlay.classList.remove('hidden');
        // Устанавливаем фокус на кнопку закрытия для навигации с пульта
        setTimeout(function () {
            var closeBtn = getEl('donate-close-btn');
            if (closeBtn && typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
                updateFocusableElements();
                var focusableElements = Array.from(document.querySelectorAll('.donate-close-btn, .donate-copy-btn, .donate-qr-link'));
                var closeIndex = -1;
                for (var i = 0; i < focusableElements.length; i++) {
                    if (focusableElements[i].id === 'donate-close-btn') {
                        closeIndex = i;
                        break;
                    }
                }
                if (closeIndex !== -1) {
                    setFocus(closeIndex);
                }
            }
        }, 100);
    }
}

function closeDonateOverlay() {
    if (donateOverlay) {
        AppState.currentScreen = AppState.inSearch;
        donateOverlay.classList.add('hidden');
        // Возвращаем фокус на кнопку доната
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
    if (donateOverlay && !donateOverlay.classList.contains('hidden')) {
        closeDonateOverlay();
    } else {
        showDonateOverlay();
    }
}

// Настройка кнопки доната в интерфейсе
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

// Добавляем CSS для оверлея доната
function addDonateStyles() {
    var styleId = 'donate-styles';
    if (getEl(styleId)) return;

    var style = document.createElement('style');
    style.id = styleId;
    style.textContent = '\n        .donate-overlay {\n            position: fixed;\n            top: 0;\n            left: 0;\n            right: 0;\n            bottom: 0;\n            z-index: 1000;\n            display: flex;\n            align-items: center;\n            justify-content: center;\n            pointer-events: auto;\n        }\n\n        .donate-overlay.hidden {\n            display: none;\n        }\n\n        .donate-overlay-backdrop {\n            position: absolute;\n            top: 0;\n            left: 0;\n            right: 0;\n            bottom: 0;\n            background: rgba(0, 0, 0, 0.5);\n            backdrop-filter: none;\n            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);\n        }\n\n        .donate-overlay-panel {\n            position: relative;\n            background: linear-gradient(135deg, #1e1e2e 0%, #2a2a3a 100%);\n            border-radius: 24px;\n            width: 90%;\n            max-width: 500px;\n            max-height: 85vh;\n            overflow-y: auto;\n            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);\n            border: 1px solid rgba(74, 158, 255, 0.3);\n            animation: donateFadeIn 0.3s ease-out;\n        }\n\n        @keyframes donateFadeIn {\n            from {\n                opacity: 0;\n                transform: scale(0.95);\n            }\n            to {\n                opacity: 1;\n                transform: scale(1);\n            }\n        }\n\n        .donate-overlay-header {\n            display: flex;\n            align-items: center;\n            justify-content: space-between;\n            padding: 20px 24px;\n            border-bottom: 1px solid rgba(74, 158, 255, 0.2);\n            background: rgba(0, 0, 0, 0.3);\n            border-radius: 24px 24px 0 0;\n        }\n\n        .donate-overlay-header h3 {\n            margin: 0;\n            font-size: 20px;\n            font-weight: 600;\n            color: #ffd966;\n        }\n\n        .donate-close-btn {\n            background: rgba(255, 255, 255, 0.1);\n            border: none;\n            font-size: 20px;\n            cursor: pointer;\n            color: #fff;\n            padding: 8px 12px;\n            border-radius: 12px;\n            transition: all 0.2s;\n        }\n\n        .donate-close-btn:hover,\n        .donate-close-btn.focused {\n            background: rgba(255, 255, 255, 0.2);\n            transform: scale(1.05);\n        }\n\n        .donate-overlay-content {\n            padding: 24px;\n        }\n\n        .donate-qr-container {\n            display: flex;\n            justify-content: center;\n            margin-bottom: 24px;\n        }\n\n        .donate-qr-link {\n            display: flex;\n            justify-content: center;\n            align-items: center;\n            cursor: pointer;\n            transition: transform 0.2s ease;\n            border-radius: 16px;\n            text-decoration: none;\n        }\n\n        .donate-qr-link:hover {\n            transform: scale(1.02);\n        }\n\n        .donate-qr-link:active {\n            transform: scale(0.98);\n        }\n\n        .donate-qr-link.focused {\n            outline: 2px solid #4a9eff;\n            outline-offset: 4px;\n            border-radius: 16px;\n        }\n\n        .donate-qr-image {\n            width: 200px;\n            height: 200px;\n            border-radius: 16px;\n            background: white;\n            padding: 12px;\n            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);\n        }\n\n        .donate-qr-error {\n            text-align: center;\n            padding: 40px;\n            background: rgba(255, 100, 100, 0.2);\n            border-radius: 16px;\n            color: #ff6a6a;\n        }\n\n        .donate-info {\n            text-align: center;\n        }\n\n        .donate-info p {\n            color: #ccc;\n            line-height: 1.5;\n            margin: 12px 0;\n        }\n\n        .donate-info p:first-child {\n            font-size: 16px;\n            font-weight: 600;\n            color: #ffd966;\n        }\n\n        .donate-address {\n            background: rgba(0, 0, 0, 0.4);\n            border-radius: 12px;\n            padding: 12px;\n            margin: 16px 0;\n            display: flex;\n            align-items: center;\n            flex-wrap: wrap;\n            gap: 8px;\n            border: 1px solid rgba(74, 158, 255, 0.2);\n        }\n\n        .donate-address-label {\n            font-weight: 600;\n            color: #4a9eff;\n            font-size: 14px;\n        }\n\n        .donate-address-code {\n            flex: 1;\n            font-family: monospace;\n            font-size: 12px;\n            color: #fff;\n            background: rgba(0, 0, 0, 0.5);\n            padding: 6px 10px;\n            border-radius: 8px;\n            word-break: break-all;\n        }\n\n        .donate-copy-btn {\n            background: rgba(74, 158, 255, 0.2);\n            border: 1px solid rgba(74, 158, 255, 0.5);\n            padding: 6px 12px;\n            border-radius: 8px;\n            cursor: pointer;\n            font-size: 12px;\n            color: #4a9eff;\n            transition: all 0.2s;\n        }\n\n        .donate-copy-btn:hover,\n        .donate-copy-btn.focused {\n            background: rgba(74, 158, 255, 0.4);\n            transform: scale(1.02);\n        }\n\n        .donate-note {\n            font-size: 12px;\n            color: #888;\n            margin-top: 16px;\n        }\n\n        /* Фокус для навигации с пульта */\n        .donate-close-btn.focused,\n        .donate-copy-btn.focused,\n        .donate-qr-link.focused {\n            outline: 2px solid #4a9eff;\n            outline-offset: 2px;\n        }\n    ';

    document.head.appendChild(style);
}

// Инициализация модуля
function initDonate() {
    console.log('❤️ Модуль доната инициализирован');
    addDonateStyles();
    setupDonateButton();

    // Добавляем обработку клавиш для закрытия оверлея
    document.addEventListener('keydown', function (e) {
        if (donateOverlay && !donateOverlay.classList.contains('hidden')) {
            var isBackKey = [8, 27, 461, 10009].indexOf(e.keyCode) !== -1 ||
                (typeof isKeyPressed === 'function' &&
                    (isKeyPressed('BACK', e.keyCode) || isKeyPressed('EXIT', e.keyCode)));

            if (isBackKey) {
                e.preventDefault();
                e.stopPropagation();
                closeDonateOverlay();
            }
        }
    });
}

// Делаем функции доступными глобально
window.showDonateOverlay = showDonateOverlay;
window.closeDonateOverlay = closeDonateOverlay;
window.toggleDonateOverlay = toggleDonateOverlay;

// Запускаем инициализацию при загрузке
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDonate);
} else {
    initDonate();
}
