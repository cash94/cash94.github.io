// donate.js - Модуль для отображения донатов

// Создаем оверлей доната (один раз при загрузке)
let donateOverlay = null;

function initDonateOverlay() {
    if (donateOverlay) return;

    donateOverlay = document.createElement('div');
    donateOverlay.id = 'donate-overlay';
    donateOverlay.className = 'donate-overlay hidden';
    donateOverlay.innerHTML = `
        <div class="donate-overlay-backdrop"></div>
        <div class="donate-overlay-panel">
            <div class="donate-overlay-header">
                <h3>❤️ Поддержать проект</h3>
                <button class="donate-close-btn" id="donate-close-btn">✕</button>
            </div>
            <div class="donate-overlay-content">
                <div class="donate-qr-container">
                    <img src="https://cash94.github.io/msx/qr-code.png" alt="QR Code for donation" class="donate-qr-image" onerror="this.style.display='none'; document.getElementById('donate-qr-error').style.display='block'">
                    <div id="donate-qr-error" class="donate-qr-error" style="display: none;">
                        <span>⚠️ QR-код не найден</span><br>
                        <span style="font-size: 12px; margin-top: 10px;">Пожалуйста, убедитесь, что файл qr-code.png находится в корневой папке приложения</span>
                    </div>
                </div>
                <div class="donate-info">
                    <p>Спасибо за поддержку!</p>
                    <p>Ваши донаты помогут развивать проект и добавлять новые функции.</p>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(donateOverlay);

    // Добавляем обработчики
    const closeBtn = document.getElementById('donate-close-btn');
    const backdrop = donateOverlay.querySelector('.donate-overlay-backdrop');

    if (closeBtn) {
        closeBtn.addEventListener('click', closeDonateOverlay);
    }

    if (backdrop) {
        backdrop.addEventListener('click', closeDonateOverlay);
    }

    // Обработчики для копирования адресов
    donateOverlay.querySelectorAll('.donate-copy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const textToCopy = btn.dataset.copy;
            if (textToCopy) {
                navigator.clipboard.writeText(textToCopy).then(() => {
                    const originalText = btn.textContent;
                    btn.textContent = '✓ Скопировано!';
                    btn.style.backgroundColor = '#4caf50';
                    setTimeout(() => {
                        btn.textContent = originalText;
                        btn.style.backgroundColor = '';
                    }, 2000);
                }).catch(() => {
                    btn.textContent = '❌ Ошибка';
                    setTimeout(() => {
                        btn.textContent = originalText;
                    }, 2000);
                });
            }
        });
    });
}

function showDonateOverlay() {
    initDonateOverlay();
    if (donateOverlay) {
        AppState.currentScreen = 'donate';
        donateOverlay.classList.remove('hidden');
        // Устанавливаем фокус на кнопку закрытия для навигации с пульта
        setTimeout(() => {
            const closeBtn = document.getElementById('donate-close-btn');
            if (closeBtn && typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
                updateFocusableElements();
                const focusableElements = Array.from(document.querySelectorAll('.donate-close-btn, .donate-copy-btn'));
                const closeIndex = focusableElements.findIndex(el => el.id === 'donate-close-btn');
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
        setTimeout(() => {
            const donateTab = document.getElementById('tab-donate');
            if (donateTab && typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
                updateFocusableElements();
                const donateIndex = focusableElements.findIndex(el => el.id === 'tab-donate');
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
    const donateTab = document.getElementById('tab-donate');
    if (!donateTab) {
        console.warn('⚠️ Кнопка tab-donate не найдена');
        return;
    }

    donateTab.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('❤️ Открытие окна доната');
        showDonateOverlay();
    });

    console.log('✅ Кнопка доната настроена');
}

// Добавляем CSS для оверлея доната
function addDonateStyles() {
    const styleId = 'donate-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        .donate-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: auto;
        }

        .donate-overlay.hidden {
            display: none;
        }

        .donate-overlay-backdrop {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.85);
            backdrop-filter: blur(8px);
        }

        .donate-overlay-panel {
            position: relative;
            background: linear-gradient(135deg, #1e1e2e 0%, #2a2a3a 100%);
            border-radius: 24px;
            width: 90%;
            max-width: 500px;
            max-height: 85vh;
            overflow-y: auto;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
            border: 1px solid rgba(74, 158, 255, 0.3);
            animation: donateFadeIn 0.3s ease-out;
        }

        @keyframes donateFadeIn {
            from {
                opacity: 0;
                transform: scale(0.95);
            }
            to {
                opacity: 1;
                transform: scale(1);
            }
        }

        .donate-overlay-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 20px 24px;
            border-bottom: 1px solid rgba(74, 158, 255, 0.2);
            background: rgba(0, 0, 0, 0.3);
            border-radius: 24px 24px 0 0;
        }

        .donate-overlay-header h3 {
            margin: 0;
            font-size: 20px;
            font-weight: 600;
            color: #ffd966;
        }

        .donate-close-btn {
            background: rgba(255, 255, 255, 0.1);
            border: none;
            font-size: 20px;
            cursor: pointer;
            color: #fff;
            padding: 8px 12px;
            border-radius: 12px;
            transition: all 0.2s;
        }

        .donate-close-btn:hover,
        .donate-close-btn.focused {
            background: rgba(255, 255, 255, 0.2);
            transform: scale(1.05);
        }

        .donate-overlay-content {
            padding: 24px;
        }

        .donate-qr-container {
            display: flex;
            justify-content: center;
            margin-bottom: 24px;
        }

        .donate-qr-image {
            width: 200px;
            height: 200px;
            border-radius: 16px;
            background: white;
            padding: 12px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }

        .donate-qr-error {
            text-align: center;
            padding: 40px;
            background: rgba(255, 100, 100, 0.2);
            border-radius: 16px;
            color: #ff6a6a;
        }

        .donate-info {
            text-align: center;
        }

        .donate-info p {
            color: #ccc;
            line-height: 1.5;
            margin: 12px 0;
        }

        .donate-info p:first-child {
            font-size: 16px;
            font-weight: 600;
            color: #ffd966;
        }

        .donate-address {
            background: rgba(0, 0, 0, 0.4);
            border-radius: 12px;
            padding: 12px;
            margin: 16px 0;
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
            border: 1px solid rgba(74, 158, 255, 0.2);
        }

        .donate-address-label {
            font-weight: 600;
            color: #4a9eff;
            font-size: 14px;
        }

        .donate-address-code {
            flex: 1;
            font-family: monospace;
            font-size: 12px;
            color: #fff;
            background: rgba(0, 0, 0, 0.5);
            padding: 6px 10px;
            border-radius: 8px;
            word-break: break-all;
        }

        .donate-copy-btn {
            background: rgba(74, 158, 255, 0.2);
            border: 1px solid rgba(74, 158, 255, 0.5);
            padding: 6px 12px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 12px;
            color: #4a9eff;
            transition: all 0.2s;
        }

        .donate-copy-btn:hover,
        .donate-copy-btn.focused {
            background: rgba(74, 158, 255, 0.4);
            transform: scale(1.02);
        }

        .donate-note {
            font-size: 12px;
            color: #888;
            margin-top: 16px;
        }

        /* Фокус для навигации с пульта */
        .donate-close-btn.focused,
        .donate-copy-btn.focused {
            outline: 2px solid #4a9eff;
            outline-offset: 2px;
        }
    `;

    document.head.appendChild(style);
}

// Инициализация модуля
function initDonate() {
    console.log('❤️ Модуль доната инициализирован');
    addDonateStyles();
    setupDonateButton();

    // Добавляем обработку клавиш для закрытия оверлея
    document.addEventListener('keydown', (e) => {
        if (donateOverlay && !donateOverlay.classList.contains('hidden')) {
            const isBackKey = [8, 27, 461, 10009].includes(e.keyCode) ||
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