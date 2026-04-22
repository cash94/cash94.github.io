// speedtest.js - Модуль замера скорости

var SpeedTest = (function () {
    'use strict';

    var TEST_FILE_SIZE = 200 * 1024 * 1024; // 200 MB в байтах
    var TIMEOUT_MS = 20000; // 20 секунд

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

    // Замер скорости между TorrServer и TorrStream
    async function measureTorrServerToServer(torrServerUrl) {
        var startTime = performance.now();
        var receivedLength = 0;
        var stopped = false;

        abortController = new AbortController();

        // Таймаут 20 секунд
        var timeoutId = setTimeout(function () {
            stopped = true;
            if (abortController) {
                abortController.abort();
            }
            console.log('⏱️ Таймаут 20 секунд, получено ' + (receivedLength / (1024 * 1024)).toFixed(0) + ' MB');
        }, TIMEOUT_MS);

        try {
            var url = torrServerUrl.replace(/\/$/, '') + '/download/200';
            console.log('📡 Запрос к TorrServer:', url);

            var response = await fetch(url, {
                signal: abortController.signal,
                method: 'GET'
            });

            if (!response.ok) {
                throw new Error('HTTP ' + response.status + ': ' + response.statusText);
            }

            var reader = response.body.getReader();
            var lastProgress = 0;

            while (true) {
                var result = await reader.read();
                if (result.done) break;

                receivedLength += result.value.length;

                var progress = (receivedLength / TEST_FILE_SIZE) * 100;
                if (progress - lastProgress >= 10) {
                    lastProgress = progress;
                    updateSpeedtestStatus('torrserver', Math.floor(progress) + '%');
                }

                // Если достигли 200 MB - останавливаемся
                if (receivedLength >= TEST_FILE_SIZE) {
                    console.log('✅ Получено 200 MB, останавливаемся');
                    break;
                }
            }

            clearTimeout(timeoutId);

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
                bytesReceived: receivedLength,
                testCompleted: receivedLength >= TEST_FILE_SIZE
            };

        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                // Это ожидаемый таймаут, не ошибка
                var endTime = performance.now();
                var durationSec = (endTime - startTime) / 1000;
                var speedBps = receivedLength / durationSec;

                return {
                    speedMbps: formatSpeed(speedBps),
                    speedBytesPerSec: speedBps,
                    durationMs: endTime - startTime,
                    bytesReceived: receivedLength,
                    testCompleted: false,
                    timeoutReached: true
                };
            }
            throw error;
        }
    }

    // Замер скорости между TorrStream и Клиентом
    async function measureServerToClient() {
        var startTime = performance.now();
        var receivedLength = 0;
        var stopped = false;

        abortController = new AbortController();

        var timeoutId = setTimeout(function () {
            stopped = true;
            if (abortController) {
                abortController.abort();
            }
            console.log('⏱️ Таймаут 20 секунд, получено ' + (receivedLength / (1024 * 1024)).toFixed(0) + ' MB');
        }, TIMEOUT_MS);

        try {
            var testId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            var url = '/api/speedtest/download/' + testId;
            console.log('📡 Запрос к серверу:', url);

            var response = await fetch(url, {
                signal: abortController.signal,
                method: 'GET'
            });

            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }

            var reader = response.body.getReader();
            var lastProgress = 0;

            while (true) {
                var result = await reader.read();
                if (result.done) break;

                receivedLength += result.value.length;

                var progress = (receivedLength / TEST_FILE_SIZE) * 100;
                if (progress - lastProgress >= 10) {
                    lastProgress = progress;
                    updateSpeedtestStatus('client', Math.floor(progress) + '%');
                }

                if (receivedLength >= TEST_FILE_SIZE) {
                    console.log('✅ Получено 200 MB, останавливаемся');
                    break;
                }
            }

            clearTimeout(timeoutId);

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
                bytesReceived: receivedLength,
                testCompleted: receivedLength >= TEST_FILE_SIZE
            };

        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                var endTime = performance.now();
                var durationSec = (endTime - startTime) / 1000;
                var speedBps = receivedLength / durationSec;

                return {
                    speedMbps: formatSpeed(speedBps),
                    speedBytesPerSec: speedBps,
                    durationMs: endTime - startTime,
                    bytesReceived: receivedLength,
                    testCompleted: false,
                    timeoutReached: true
                };
            }
            throw error;
        }
    }

    // Обновление статуса в UI
    function updateSpeedtestStatus(type, status) {
        var statusEl = document.getElementById('speedtest-status');
        if (statusEl) {
            if (type === 'torrserver') {
                statusEl.innerHTML = 'Замер TorrServer → TorrStream: ' + status;
            } else if (type === 'client') {
                statusEl.innerHTML = 'Замер TorrStream → Клиент: ' + status;
            }
        }
    }

    // Показать результаты
    function showResults(torrResult, clientResult, totalTime) {
        var resultsDiv = document.getElementById('speedtest-results');
        var torrEl = document.getElementById('speedtest-torrserver');
        var clientEl = document.getElementById('speedtest-client');
        var totalEl = document.getElementById('speedtest-total');

        var torrSizeMB = (torrResult.bytesReceived / (1024 * 1024)).toFixed(0);
        var clientSizeMB = (clientResult.bytesReceived / (1024 * 1024)).toFixed(0);

        var torrNote = torrResult.timeoutReached ? ' (таймаут ' + torrSizeMB + ' MB)' : '';
        var clientNote = clientResult.timeoutReached ? ' (таймаут ' + clientSizeMB + ' MB)' : '';

        if (resultsDiv) resultsDiv.style.display = 'block';
        if (torrEl) torrEl.innerHTML = 'TorrServer → TorrStream: ' + torrResult.speedMbps + torrNote + ' (' + formatTime(torrResult.durationMs) + ')';
        if (clientEl) clientEl.innerHTML = 'TorrStream → Клиент: ' + clientResult.speedMbps + clientNote + ' (' + formatTime(clientResult.durationMs) + ')';
        if (totalEl) totalEl.innerHTML = 'Общее время: ' + formatTime(totalTime) + ' | Тест: 200 MB';

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

        var statusEl = document.getElementById('speedtest-status');
        if (statusEl) statusEl.style.display = 'none';

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

        torrServerUrl = torrServerUrl.trim().replace(/\/$/, '');

        isRunning = true;
        var startTotalTime = performance.now();

        var resultsDiv = document.getElementById('speedtest-results');
        var statusEl = document.getElementById('speedtest-status');

        if (resultsDiv) {
            resultsDiv.style.display = 'block';
            resultsDiv.style.borderColor = '#4a9eff';
            var torrEl = document.getElementById('speedtest-torrserver');
            var clientEl = document.getElementById('speedtest-client');
            if (torrEl) torrEl.innerHTML = 'TorrServer → TorrStream: -- Mbps';
            if (clientEl) clientEl.innerHTML = 'TorrStream → Клиент: -- Mbps';
        }

        if (!statusEl) {
            statusEl = document.createElement('div');
            statusEl.id = 'speedtest-status';
            statusEl.style.cssText = 'margin-top: 10px; font-size: 12px; color: #ffd966;';
            if (resultsDiv && resultsDiv.parentNode) {
                resultsDiv.parentNode.insertBefore(statusEl, resultsDiv.nextSibling);
            }
        }
        statusEl.style.display = 'block';
        statusEl.innerHTML = 'Замер TorrServer → TorrStream: 0%';

        var btn = document.getElementById('speedtest-btn');
        var originalBtnText = btn ? btn.innerHTML : '';
        if (btn) {
            btn.innerHTML = 'Замер скорости...';
            btn.disabled = true;
            btn.style.opacity = '0.6';
        }

        try {
            var torrResult = await measureTorrServerToServer(torrServerUrl);

            if (!isRunning) {
                throw new Error('Тест прерван');
            }

            statusEl.innerHTML = 'Замер TorrStream → Клиент: 0%';
            var clientResult = await measureServerToClient();

            var totalTime = performance.now() - startTotalTime;
            showResults(torrResult, clientResult, totalTime);

            console.log('✅ SpeedTest завершен:', {
                torrServerToServer: torrResult.speedMbps,
                serverToClient: clientResult.speedMbps,
                torrBytesMB: (torrResult.bytesReceived / (1024 * 1024)).toFixed(0),
                clientBytesMB: (clientResult.bytesReceived / (1024 * 1024)).toFixed(0),
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

    return {
        run: runSpeedTest
    };
})();

window.SpeedTest = SpeedTest;
