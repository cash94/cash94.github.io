// speedtest.js - Модуль замера скорости

var SpeedTest = (function () {
    'use strict';

    var TEST_FILE_SIZE = 200 * 1024 * 1024; // 200 MB в байтах
    var TIMEOUT_MS = 45000; // 45 секунд таймаут на этап

    var isRunning = false;
    var abortController = null;

    // Форматирование скорости в Mbps
    function formatSpeed(bytesPerSecond) {
        var mbps = (bytesPerSecond * 8) / (1024 * 1024);
        return mbps.toFixed(2) + ' Mbps';
    }

    // Форматирование времени
    function formatTime(ms) {
        return ms.toFixed(0) + ' мс';
    }

    // Замер скорости между TorrServer и Server.js
    async function measureTorrServerToServer(torrServerUrl) {
        var startTime = performance.now();
        var totalBytes = 0;

        abortController = new AbortController();
        var timeoutId = setTimeout(function () {
            abortController.abort();
        }, TIMEOUT_MS);

        try {
            var url = torrServerUrl.replace(/\/$/, '') + '/download/200';
            console.log('📡 Запрос к TorrServer:', url);

            var response = await fetch(url, {
                signal: abortController.signal,
                method: 'GET'
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error('HTTP ' + response.status + ': ' + response.statusText);
            }

            var reader = response.body.getReader();
            var receivedLength = 0;
            var lastProgress = 0;

            while (true) {
                var result = await reader.read();
                if (result.done) break;

                receivedLength += result.value.length;
                totalBytes = receivedLength;

                var progress = (receivedLength / TEST_FILE_SIZE) * 100;
                if (progress - lastProgress >= 10) {
                    lastProgress = progress;
                    updateSpeedtestStatus('torrserver', Math.floor(progress) + '%');
                }
            }

            var endTime = performance.now();
            var durationSec = (endTime - startTime) / 1000;

            if (durationSec <= 0) {
                throw new Error('Ошибка замера: время не определено');
            }

            if (receivedLength === 0) {
                throw new Error('Не удалось загрузить тестовый файл');
            }

            var speedBps = receivedLength / durationSec;

            return {
                speedMbps: formatSpeed(speedBps),
                speedBytesPerSec: speedBps,
                durationMs: endTime - startTime,
                bytesReceived: receivedLength
            };

        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('Таймаут TorrServer (' + TIMEOUT_MS / 1000 + 'с)');
            }
            throw error;
        }
    }

    // Замер скорости между Server.js и Клиентом
    async function measureServerToClient() {
        var startTime = performance.now();
        var totalBytes = 0;

        abortController = new AbortController();
        var timeoutId = setTimeout(function () {
            abortController.abort();
        }, TIMEOUT_MS);

        try {
            var testId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            var url = '/api/speedtest/download/' + testId;
            console.log('📡 Запрос к серверу:', url);

            var response = await fetch(url, {
                signal: abortController.signal,
                method: 'GET'
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }

            var reader = response.body.getReader();
            var receivedLength = 0;
            var lastProgress = 0;

            while (true) {
                var result = await reader.read();
                if (result.done) break;

                receivedLength += result.value.length;
                totalBytes = receivedLength;

                var progress = (receivedLength / TEST_FILE_SIZE) * 100;
                if (progress - lastProgress >= 10) {
                    lastProgress = progress;
                    updateSpeedtestStatus('client', Math.floor(progress) + '%');
                }
            }

            var endTime = performance.now();
            var durationSec = (endTime - startTime) / 1000;

            if (durationSec <= 0) {
                throw new Error('Ошибка замера: время не определено');
            }

            if (receivedLength === 0) {
                throw new Error('Не удалось загрузить тестовый файл');
            }

            var speedBps = receivedLength / durationSec;

            return {
                speedMbps: formatSpeed(speedBps),
                speedBytesPerSec: speedBps,
                durationMs: endTime - startTime,
                bytesReceived: receivedLength
            };

        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('Таймаут клиента (' + TIMEOUT_MS / 1000 + 'с)');
            }
            throw error;
        }
    }

    // Обновление статуса в UI
    function updateSpeedtestStatus(type, status) {
        var statusEl = document.getElementById('speedtest-status');
        if (statusEl) {
            if (type === 'torrserver') {
                statusEl.innerHTML = '📡 Замер TorrServer → Сервер: ' + status;
            } else if (type === 'client') {
                statusEl.innerHTML = '💻 Замер Сервер → Клиент: ' + status;
            }
        }
    }

    // Показать результаты
    function showResults(torrResult, clientResult, totalTime) {
        var resultsDiv = document.getElementById('speedtest-results');
        var torrEl = document.getElementById('speedtest-torrserver');
        var clientEl = document.getElementById('speedtest-client');
        var totalEl = document.getElementById('speedtest-total');

        if (resultsDiv) resultsDiv.style.display = 'block';
        if (torrEl) torrEl.innerHTML = 'TorrServer → Сервер: ' + torrResult.speedMbps + ' (' + formatTime(torrResult.durationMs) + ')';
        if (clientEl) clientEl.innerHTML = 'Сервер → Клиент: ' + clientResult.speedMbps + ' (' + formatTime(clientResult.durationMs) + ')';
        if (totalEl) totalEl.innerHTML = '⏱️ Общее время: ' + formatTime(totalTime) + ' | Тест: 200 MB';

        // Скрываем статус
        var statusEl = document.getElementById('speedtest-status');
        if (statusEl) statusEl.style.display = 'none';
    }

    // Показать ошибку
    function showError(error) {
        var resultsDiv = document.getElementById('speedtest-results');
        var torrEl = document.getElementById('speedtest-torrserver');
        var clientEl = document.getElementById('speedtest-client');
        var totalEl = document.getElementById('speedtest-total');

        if (resultsDiv) resultsDiv.style.display = 'block';
        if (torrEl) torrEl.innerHTML = '❌ ' + error.message;
        if (clientEl) clientEl.innerHTML = '--';
        if (totalEl) totalEl.innerHTML = '❌ Ошибка замера';

        // Скрываем статус
        var statusEl = document.getElementById('speedtest-status');
        if (statusEl) statusEl.style.display = 'none';

        // Изменяем цвет блока на красноватый
        if (resultsDiv) resultsDiv.style.borderColor = '#ff4e4e';
        setTimeout(function () {
            if (resultsDiv) resultsDiv.style.borderColor = '#4a9eff';
        }, 3000);
    }

    // Основная функция замера
    async function runSpeedTest(torrServerUrl) {
        if (isRunning) {
            console.log('⏳ Тест уже выполняется');
            return false;
        }

        if (!torrServerUrl || torrServerUrl.trim() === '') {
            showError(new Error('URL TorrServer не задан'));
            return false;
        }

        // Очищаем URL от слеша в конце
        torrServerUrl = torrServerUrl.trim().replace(/\/$/, '');

        isRunning = true;
        var startTotalTime = performance.now();

        // Показываем блок с результатами и статус
        var resultsDiv = document.getElementById('speedtest-results');
        var statusEl = document.getElementById('speedtest-status');

        if (resultsDiv) {
            resultsDiv.style.display = 'block';
            resultsDiv.style.borderColor = '#4a9eff';
        }

        // Создаем элемент статуса если его нет
        if (!statusEl) {
            statusEl = document.createElement('div');
            statusEl.id = 'speedtest-status';
            statusEl.style.cssText = 'margin-top: 10px; font-size: 12px; color: #ffd966;';
            if (resultsDiv && resultsDiv.parentNode) {
                resultsDiv.parentNode.insertBefore(statusEl, resultsDiv.nextSibling);
            }
        }
        statusEl.style.display = 'block';
        statusEl.innerHTML = '📡 Замер TorrServer → Сервер: 0%';

        // Меняем текст кнопки
        var btn = document.getElementById('speedtest-btn');
        var originalBtnText = btn ? btn.innerHTML : '';
        if (btn) {
            btn.innerHTML = '⏳ Замер скорости...';
            btn.disabled = true;
            btn.style.opacity = '0.6';
        }

        try {
            // Этап 1: TorrServer → Server.js
            var torrResult = await measureTorrServerToServer(torrServerUrl);

            // Этап 2: Server.js → Клиент
            statusEl.innerHTML = '💻 Замер Сервер → Клиент: 0%';
            var clientResult = await measureServerToClient();

            var totalTime = performance.now() - startTotalTime;

            showResults(torrResult, clientResult, totalTime);

            console.log('✅ SpeedTest завершен:', {
                torrServerToServer: torrResult.speedMbps,
                serverToClient: clientResult.speedMbps,
                totalTime: totalTime.toFixed(0) + 'ms'
            });

            return true;

        } catch (error) {
            console.error('❌ SpeedTest ошибка:', error);
            showError(error);
            return false;

        } finally {
            isRunning = false;
            if (btn) {
                btn.innerHTML = originalBtnText || '📡 Замерить скорость';
                btn.disabled = false;
                btn.style.opacity = '1';
            }
            var statusFinal = document.getElementById('speedtest-status');
            if (statusFinal) statusFinal.style.display = 'none';
        }
    }

    // Публичное API
    return {
        run: runSpeedTest
    };
})();

// Экспортируем для использования в других модулях
window.SpeedTest = SpeedTest;