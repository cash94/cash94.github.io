// sync.js - Модуль для синхронизации клиентов

// Создаем оверлей синхронизации (один раз при загрузке)
var syncOverlay = null;
var countdownInterval = null;

function initSyncOverlay() {
    if (syncOverlay) return;

    syncOverlay = document.createElement('div');
    syncOverlay.id = 'sync-overlay';
    syncOverlay.className = 'sync-overlay hidden';
    syncOverlay.innerHTML = '\n        <div class="sync-overlay-backdrop"></div>\n        <div class="sync-overlay-panel">\n            <div class="sync-overlay-header">\n                <h3>Синхронизация клиентов</h3>\n                <button class="sync-close-btn" id="sync-close-btn">X</button>\n            </div>\n            <div class="sync-overlay-content">\n                <div class="sync-instruction">\n                    Для того чтобы синхронизировать это устройство с другим, нужно на другом устройстве ввести нижепредставленный четырехзначный код\n                </div>\n                \n                <div class="sync-code-container">\n                    <div class="sync-code" id="sync-code">----</div>\n                </div>\n                \n                <div class="sync-expiry" id="sync-expiry">\n                    Код действует 5 минут\n                </div>\n                \n                <div class="sync-input-section">\n                    <div class="sync-input-label">Введите код с другого устройства:</div>\n                    <input type="text" class="sync-code-input" id="sync-code-input" maxlength="4" placeholder="____" autocomplete="off">\n                </div>\n                \n                <div id="sync-message" class="sync-message hidden"></div>\n                <div id="sync-countdown" class="sync-countdown hidden"></div>\n            </div>\n        </div>\n    ';

    document.body.appendChild(syncOverlay);

    // Добавляем обработчики
    var closeBtn = getEl('sync-close-btn');
    var backdrop = syncOverlay.querySelector('.sync-overlay-backdrop');

    if (closeBtn) {
        closeBtn.addEventListener('click', closeSyncOverlay);
    }

    if (backdrop) {
        backdrop.addEventListener('click', closeSyncOverlay);
    }

    // Обработчик для поля ввода кода (только цифры и авто-проверка)
    var codeInput = getEl('sync-code-input');
    if (codeInput) {
        codeInput.addEventListener('input', function (e) {
            // Оставляем только цифры
            var oldValue = this.value;
            this.value = this.value.replace(/[^0-9]/g, '').slice(0, 4);

            // Если введено 4 символа - запускаем проверку
            if (this.value.length === 4 && this.value !== oldValue) {
                verifySyncCode();
            }
        });

        codeInput.addEventListener('keypress', function (e) {
            // Разрешаем только цифры
            if (e.key < '0' || e.key > '9') {
                e.preventDefault();
            }
        });

        codeInput.addEventListener('keyup', function (e) {
            // При вставке через Ctrl+V или контекстное меню
            if (this.value.length === 4 && this.value.length === 4) {
                verifySyncCode();
            }
        });
    }
}

function generateSyncCode() {
    // Генерируем случайный четырехзначный код (1000-9999)
    var code = Math.floor(Math.random() * 9000) + 1000;
    return code.toString();
}

function updateSyncCodeDisplay() {
    var syncCodeElement = getEl('sync-code');
    if (syncCodeElement && AppState.syncCode) {
        syncCodeElement.textContent = AppState.syncCode;
    }
}

function showSyncMessage(message, isError) {
    var messageDiv = getEl('sync-message');
    if (messageDiv) {
        messageDiv.textContent = message;
        messageDiv.className = 'sync-message ' + (isError ? 'sync-message-error' : 'sync-message-success');
        messageDiv.classList.remove('hidden');

        setTimeout(function () {
            messageDiv.classList.add('hidden');
        }, 5000);
    }
}

function startCountdown(seconds) {
    var countdownDiv = getEl('sync-countdown');
    var secondsLeft = seconds;

    if (countdownInterval) {
        clearInterval(countdownInterval);
    }

    countdownDiv.classList.remove('hidden');

    countdownInterval = setInterval(function () {
        countdownDiv.textContent = 'Перезагрузка через ' + secondsLeft + ' секунд...';
        secondsLeft--;

        if (secondsLeft < 0) {
            clearInterval(countdownInterval);
            countdownInterval = null;
            location.reload();
        }
    }, 1000);
}

async function verifySyncCode() {
    var codeInput = getEl('sync-code-input');
    var code = codeInput.value.trim();

    if (!code || code.length !== 4) {
        return;
    }

    // Блокируем поле ввода на время проверки
    codeInput.disabled = true;

    try {
        var response = await fetch(SERVER_URL + '/api/sync/verify', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ code: code })
        });

        var data = await response.json();

        if (response.ok && data.success) {
            // Сохраняем полученный clientId в localStorage
            if (localStorage.getItem('clientId') !== data.clientId) {
                localStorage.setItem('clientId', data.clientId);
                showSyncMessage('Код подтвержден! Приложение перезагрузится через 3 секунды...', false);
                startCountdown(3);
            } else {
                showSyncMessage('Это устройство уже синхронизировано с этим кодом', false);
                setTimeout(function () {
                    closeSyncOverlay();
                }, 2000);
            }
        } else {
            var errorMsg = data.error || 'Неверный или просроченный код';
            showSyncMessage(errorMsg, true);
            // Очищаем поле ввода для повторной попытки
            codeInput.value = '';
            codeInput.disabled = false;
            codeInput.focus();
        }
    } catch (error) {
        console.error('Ошибка проверки кода:', error);
        showSyncMessage('Ошибка соединения с сервером', true);
        codeInput.value = '';
        codeInput.disabled = false;
        codeInput.focus();
    }
}

async function createSyncCode() {
    if (!AppState.syncCode) {
        AppState.syncCode = generateSyncCode();
    }

    var savedClientId = localStorage.getItem('clientId');

    try {
        var response = await fetch(SERVER_URL + '/api/sync/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                code: AppState.syncCode,
                clientId: savedClientId
            })
        });

        var data = await response.json();

        if (response.ok && data.success) {
            console.log('Код синхронизации создан:', AppState.syncCode);
            updateSyncCodeDisplay();
            return true;
        } else {
            // Если код уже существует, генерируем новый
            if (response.status === 409) {
                AppState.syncCode = generateSyncCode();
                return await createSyncCode();
            }
            console.error('Ошибка создания кода:', data.error);
            return false;
        }
    } catch (error) {
        console.error('Ошибка создания кода синхронизации:', error);
        return false;
    }
}

function startSyncCodeTimer() {
    // Очищаем предыдущий таймер, если есть
    if (AppState.syncCodeTimer) {
        clearTimeout(AppState.syncCodeTimer);
    }

    // Устанавливаем таймер на 5 минут (300000 миллисекунд)
    AppState.syncCodeTimer = setTimeout(function () {
        // Код истек
        if (syncOverlay && !syncOverlay.classList.contains('hidden')) {
            // Генерируем новый код
            AppState.syncCode = generateSyncCode();
            createSyncCode().then(function (success) {
                if (success) {
                    updateSyncCodeDisplay();
                    // Очищаем поле ввода
                    var codeInput = getEl('sync-code-input');
                    if (codeInput) {
                        codeInput.value = '';
                        codeInput.disabled = false;
                    }
                    // Показываем уведомление об обновлении кода
                    var expiryElement = getEl('sync-expiry');
                    if (expiryElement) {
                        var originalText = expiryElement.textContent;
                        expiryElement.textContent = 'Код обновлен! Действует 5 минут';
                        expiryElement.style.color = '#4a9eff';
                        setTimeout(function () {
                            expiryElement.textContent = originalText;
                            expiryElement.style.color = '';
                        }, 3000);
                    }
                    startSyncCodeTimer();
                }
            });
        }
    }, 300000); // 5 минут
}

async function showSyncOverlay() {
    AppState.syncCodeScreen = true;
    initSyncOverlay();
    if (syncOverlay) {
        // Очищаем сообщения
        var messageDiv = getEl('sync-message');
        if (messageDiv) messageDiv.classList.add('hidden');

        var countdownDiv = getEl('sync-countdown');
        if (countdownDiv) countdownDiv.classList.add('hidden');

        // Очищаем и разблокируем поле ввода
        var codeInput = getEl('sync-code-input');
        if (codeInput) {
            codeInput.value = '';
            codeInput.disabled = false;
        }

        // Генерируем новый код
        AppState.syncCode = generateSyncCode();
        var created = await createSyncCode();

        if (created) {
            updateSyncCodeDisplay();
            // Запускаем таймер
            startSyncCodeTimer();
        } else {
            showSyncMessage('Ошибка создания кода, попробуйте позже', true);
        }

        AppState.currentScreen = 'sync';
        syncOverlay.classList.remove('hidden');

        // Устанавливаем фокус на поле ввода
        setTimeout(function () {
            if (codeInput) {
                // Убираем класс focused со всех элементов
                var focusedElements = document.querySelectorAll('.focused');
                for (var i = 0; i < focusedElements.length; i++) {
                    focusedElements[i].classList.remove('focused');
                }
                // Добавляем класс focused на поле ввода
                codeInput.classList.add('focused');
                codeInput.focus();

                // Обновляем focusableElements и currentFocusIndex для control.js
                if (typeof updateFocusableElements === 'function') {
                    updateFocusableElements();
                    for (var j = 0; j < focusableElements.length; j++) {
                        if (focusableElements[j].id === 'sync-code-input') {
                            currentFocusIndex = j;
                            break;
                        }
                    }
                }
            }
        }, 100);
    }
}

function closeSyncOverlay() {
    AppState.syncCodeScreen = false;
    if (syncOverlay) {
        // Очищаем таймер
        if (AppState.syncCodeTimer) {
            clearTimeout(AppState.syncCodeTimer);
            AppState.syncCodeTimer = null;
        }

        // Очищаем countdown интервал
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }

        AppState.currentScreen = 'config';
        syncOverlay.classList.add('hidden');

        // Возвращаем фокус на кнопку синхронизации
        setTimeout(function () {
            var syncBtn = getEl('sync-clients-btn');
            if (syncBtn && typeof updateFocusableElements === 'function' && typeof setFocus === 'function') {
                updateFocusableElements();
                var syncIndex = -1;
                for (var i = 0; i < focusableElements.length; i++) {
                    if (focusableElements[i].id === 'sync-clients-btn') {
                        syncIndex = i;
                        break;
                    }
                }
                if (syncIndex !== -1) {
                    setFocus(syncIndex);
                }
            }
        }, 100);
    }
}

function toggleSyncOverlay() {
    if (syncOverlay && !syncOverlay.classList.contains('hidden')) {
        closeSyncOverlay();
    } else {
        showSyncOverlay();
    }
}

// Настройка кнопки синхронизации в интерфейсе
function setupSyncButton() {
    var syncBtn = getEl('sync-clients-btn');
    if (!syncBtn) {
        console.warn('⚠️ Кнопка sync-clients-btn не найдена');
        return;
    }

    syncBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('🔄 Открытие окна синхронизации');
        showSyncOverlay();
    });

    console.log('✅ Кнопка синхронизации настроена');
}

// Добавляем CSS для оверлея синхронизации
function addSyncStyles() {
    var styleId = 'sync-styles';
    if (getEl(styleId)) return;

    var style = document.createElement('style');
    style.id = styleId;
    style.textContent = '\n        .sync-overlay {\n            position: fixed;\n            top: 0;\n            left: 0;\n            right: 0;\n            bottom: 0;\n            z-index: 1000;\n            display: flex;\n            align-items: center;\n            justify-content: center;\n            pointer-events: auto;\n        }\n\n        .sync-overlay.hidden {\n            display: none;\n        }\n\n        .sync-overlay-backdrop {\n            position: absolute;\n            top: 0;\n            left: 0;\n            right: 0;\n            bottom: 0;\n            background: rgba(0, 0, 0, 0.85);\n            backdrop-filter: blur(8px);\n        }\n\n        .sync-overlay-panel {\n            position: relative;\n            background: linear-gradient(135deg, #1e1e2e 0%, #2a2a3a 100%);\n            border-radius: 24px;\n            width: 90%;\n            max-width: 500px;\n            max-height: 85vh;\n            overflow-y: auto;\n            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);\n            border: 1px solid rgba(74, 158, 255, 0.3);\n            animation: syncFadeIn 0.3s ease-out;\n        }\n\n        @keyframes syncFadeIn {\n            from {\n                opacity: 0;\n                transform: scale(0.95);\n            }\n            to {\n                opacity: 1;\n                transform: scale(1);\n            }\n        }\n\n        .sync-overlay-header {\n            display: flex;\n            align-items: center;\n            justify-content: space-between;\n            padding: 20px 24px;\n            border-bottom: 1px solid rgba(74, 158, 255, 0.2);\n            background: rgba(0, 0, 0, 0.3);\n            border-radius: 24px 24px 0 0;\n        }\n\n        .sync-overlay-header h3 {\n            margin: 0;\n            font-size: 20px;\n            font-weight: 600;\n            color: #4a9eff;\n        }\n\n        .sync-close-btn {\n            background: rgba(255, 255, 255, 0.1);\n            border: none;\n            font-size: 20px;\n            cursor: pointer;\n            color: #fff;\n            padding: 8px 12px;\n            border-radius: 12px;\n            transition: all 0.2s;\n        }\n\n        .sync-close-btn:hover,\n        .sync-close-btn.focused {\n            background: rgba(255, 255, 255, 0.2);\n            transform: scale(1.05);\n        }\n\n        .sync-overlay-content {\n            padding: 24px;\n        }\n\n        .sync-instruction {\n            text-align: center;\n            color: #ccc;\n            line-height: 1.5;\n            margin-bottom: 30px;\n            font-size: 14px;\n        }\n\n        .sync-code-container {\n            display: flex;\n            justify-content: center;\n            margin-bottom: 20px;\n        }\n\n        .sync-code {\n            font-size: 64px;\n            font-weight: bold;\n            font-family: monospace;\n            letter-spacing: 20px;\n            text-align: center;\n            background: rgba(0, 0, 0, 0.5);\n            padding: 30px 20px;\n            border-radius: 16px;\n            color: #4a9eff;\n            text-shadow: 0 0 10px rgba(74, 158, 255, 0.5);\n            border: 2px solid rgba(74, 158, 255, 0.3);\n            min-width: 280px;\n        }\n\n        .sync-expiry {\n            text-align: center;\n            color: #ff8c00;\n            font-size: 14px;\n            margin-bottom: 30px;\n            padding: 8px;\n            background: rgba(255, 140, 0, 0.1);\n            border-radius: 8px;\n        }\n\n        .sync-input-section {\n            margin-top: 20px;\n        }\n\n        .sync-input-label {\n            color: #ccc;\n            font-size: 14px;\n            margin-bottom: 12px;\n            text-align: center;\n        }\n\n        .sync-code-input {\n            width: 100%;\n            padding: 16px;\n            font-size: 32px;\n            text-align: center;\n            font-family: monospace;\n            letter-spacing: 10px;\n            background: rgba(0, 0, 0, 0.5);\n            border: 2px solid rgba(74, 158, 255, 0.3);\n            border-radius: 12px;\n            color: #fff;\n            outline: none;\n            transition: all 0.2s;\n            box-sizing: border-box;\n        }\n\n        .sync-code-input:focus,\n        .sync-code-input.focused {\n            border-color: #4a9eff;\n            box-shadow: 0 0 10px rgba(74, 158, 255, 0.3);\n        }\n\n        .sync-code-input:disabled {\n            opacity: 0.5;\n            cursor: not-allowed;\n        }\n\n        .sync-message {\n            margin-top: 15px;\n            padding: 10px;\n            border-radius: 8px;\n            text-align: center;\n            font-size: 14px;\n        }\n\n        .sync-message-success {\n            background: rgba(76, 175, 80, 0.2);\n            color: #4caf50;\n            border: 1px solid #4caf50;\n        }\n\n        .sync-message-error {\n            background: rgba(244, 67, 54, 0.2);\n            color: #f44336;\n            border: 1px solid #f44336;\n        }\n\n        .sync-countdown {\n            margin-top: 15px;\n            padding: 10px;\n            background: rgba(74, 158, 255, 0.2);\n            border-radius: 8px;\n            text-align: center;\n            font-size: 14px;\n            color: #4a9eff;\n        }\n\n        .hidden {\n            display: none;\n        }\n\n        /* Фокус для навигации с пульта */\n        .sync-close-btn.focused,\n        .sync-code-input.focused {\n            outline: 2px solid #4a9eff;\n            outline-offset: 2px;\n        }\n    ';

    document.head.appendChild(style);
}

// Инициализация модуля
function initSync() {
    console.log('🔄 Модуль синхронизации инициализирован');
    addSyncStyles();
    setupSyncButton();
    
    // Добавляем обработку клавиш для закрытия оверлея
    document.addEventListener('keydown', function (e) {
        if (syncOverlay && !syncOverlay.classList.contains('hidden')) {
            var isBackKey = [8, 27, 461, 10009].indexOf(e.keyCode) !== -1 ||
                (typeof isKeyPressed === 'function' &&
                    (isKeyPressed('BACK', e.keyCode) || isKeyPressed('EXIT', e.keyCode)));
            var a = document.activeElement,
                ed = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');

            if (ed) {
                // Проверяем, пустое ли поле
                var isEmpty = false;

                if (a.tagName === 'SELECT') {
                    isEmpty = (a.selectedIndex === -1 || a.value === '');
                } else {
                    isEmpty = (a.value === '' || a.value === null);
                }

                if (isEmpty) {
                    if (isBackKey) {
                        e.preventDefault();
                        e.stopPropagation();
                        closeSyncOverlay();
                    }
                } else {
                    return;
                }
            }
            if (isBackKey) {
                e.preventDefault();
                e.stopPropagation();
                closeSyncOverlay();
            }
        }
    });
}

// Делаем функции доступными глобально
window.showSyncOverlay = showSyncOverlay;
window.closeSyncOverlay = closeSyncOverlay;
window.toggleSyncOverlay = toggleSyncOverlay;

// Запускаем инициализацию при загрузке
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSync);
} else {
    initSync();
}
