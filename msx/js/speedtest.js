// speedtest.js - Модуль замера скорости

var SpeedTest = (function () {
    'use strict';

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

    // Получение заголовков авторизации
    function getAuthHeaders() {
        if (typeof window.getAuthHeaders === 'function') {
            return window.getAuthHeaders();
        }
        return {};
    }

    // Этап 1: Замер на сервере (TorrServer → TorrStream)
    async function measureTorrServerToServer(torrServerUrl) {
        var url = '/api/speedtest/measure-torrserver?url=' + encodeURIComponent(torrServerUrl);
        
        console.log('📡 Запрос серверного замера:', url);
        
        // Получаем заголовки авторизации
        var authHeaders = getAuthHeaders();
        
        // Обновляем статус
        updateSpeedtestStatus('torrserver', '0%');
        
        // Имитируем прогресс (серверный замер)
        var progressInterval = setInterval(function() {
            var statusEl = getEl('speedtest-status');
            if (statusEl && statusEl.innerHTML.indexOf('TorrServer') !== -1) {
                var currentText = statusEl.innerHTML;
                var match = currentText.match(/(\d+)%/);
                if (match) {
                    var newProgress = parseInt(match[1]) + 10;
                    if (newProgress <= 90) {
                        updateSpeedtestStatus('torrserver', newProgress + '%');
                    }
                } else {
                    updateSpeedtestStatus('torrserver', '10%');
                }
            }
        }, 2000);
        
        try {
            var response = await fetch(url, {
                method: 'GET',
                headers: authHeaders,
                signal: abortController ? abortController.signal : null
            });
            
            clearInterval(progressInterval);
            
            if (!response.ok) {
                if (response.status === 401) {
                    throw new Error('Ошибка авторизации TorrServer. Проверьте логин и пароль.');
                }
                var errorData = await response.json();
                throw new Error(errorData.error || 'HTTP ' + response.status);
            }
            
            var result = await response.json();
            updateSpeedtestStatus('torrserver', '100%');
            
            return {
                speedMbps: result.speedMbps,
                speedBytesPerSec: result.speedBytesPerSec,
                durationMs: result.durationMs,
                bytesReceived: result.bytesReceived,
                testCompleted: result.testCompleted,
                timeoutReached: result.timeoutReached
            };
            
        } catch (error) {
            clearInterval(progressInterval);
            if (error.name === 'AbortError') {
                throw new Error('Тест прерван');
            }
            throw error;
        }
    }

    // Этап 2: Замер на клиенте (TorrStream → Клиент)
    async function measureServerToClient() {
        var startTime = performance.now();
        var receivedLength = 0;
        
        abortController = new AbortController();
        
        var timeoutId = setTimeout(function () {
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
            var TEST_FILE_SIZE = 200 * 1024 * 1024;
            
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
                testCompleted: receivedLength >= TEST_FILE_SIZE,
                timeoutReached: false
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
        } finally {
            abortController = null;
        }
    }

    // Обновление статуса в UI
    function updateSpeedtestStatus(type, status) {
        var statusEl = getEl('speedtest-status');
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
        var resultsDiv = getEl('speedtest-results');
        var torrEl = getEl('speedtest-torrserver');
        var clientEl = getEl('speedtest-client');
        var totalEl = getEl('speedtest-total');

        if (resultsDiv) resultsDiv.style.display = 'block';
        if (torrEl) torrEl.innerHTML = 'TorrServer → TorrStream: ' + torrResult.speedMbps;
        if (clientEl) clientEl.innerHTML = 'TorrStream → Клиент: ' + clientResult.speedMbps;
        if (totalEl) totalEl.innerHTML = 'Общее время: ' + formatTime(totalTime) + ' | Тест: 200 MB';

        var statusEl = getEl('speedtest-status');
        if (statusEl) statusEl.style.display = 'none';
    }

    // Показать ошибку
    function showError(error) {
        var resultsDiv = getEl('speedtest-results');
        var torrEl = getEl('speedtest-torrserver');
        var clientEl = getEl('speedtest-client');
        var totalEl = getEl('speedtest-total');

        if (resultsDiv) resultsDiv.style.display = 'block';
        if (torrEl) torrEl.innerHTML = error.message;
        if (clientEl) clientEl.innerHTML = '--';
        if (totalEl) totalEl.innerHTML = 'Ошибка замера';

        var statusEl = getEl('speedtest-status');
        if (statusEl) statusEl.style.display = 'none';

        if (resultsDiv) resultsDiv.style.borderColor = '#ff4e4e';
        setTimeout(function () {
            if (resultsDiv) resultsDiv.style.borderColor = '#4a9eff';
        }, 3000);
    }

    // Основная функция замера
    async function runSpeedTest(torrServerUrl) {
        if (isRunning) {
            console.log('Тест уже выполняется');
            return false;
        }

        if (!torrServerUrl || torrServerUrl.trim() === '') {
            showError(new Error('URL TorrServer не задан'));
            return false;
        }

        torrServerUrl = torrServerUrl.trim().replace(/\/$/, '');

        isRunning = true;
        var startTotalTime = performance.now();

        var resultsDiv = getEl('speedtest-results');
        var statusEl = getEl('speedtest-status');

        if (resultsDiv) {
            resultsDiv.style.display = 'block';
            resultsDiv.style.borderColor = '#4a9eff';
            var torrEl = getEl('speedtest-torrserver');
            var clientEl = getEl('speedtest-client');
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

        var btn = getEl('speedtest-btn');
        var originalBtnText = btn ? btn.innerHTML : '';
        if (btn) {
            btn.innerHTML = 'Замер скорости...';
            btn.disabled = true;
            btn.style.opacity = '0.6';
        }

        try {
            // Этап 1: Серверный замер (TorrServer → TorrStream)
            var torrResult = await measureTorrServerToServer(torrServerUrl);

            if (!isRunning) {
                throw new Error('Тест прерван');
            }

            // Этап 2: Клиентский замер (TorrStream → Клиент)
            statusEl.innerHTML = 'Замер TorrStream → Клиент: 0%';
            var clientResult = await measureServerToClient();

            var totalTime = performance.now() - startTotalTime;
            showResults(torrResult, clientResult, totalTime);

            console.log('SpeedTest завершен:', {
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
                btn.innerHTML = originalBtnText || 'Замерить скорость';
                btn.disabled = false;
                btn.style.opacity = '1';
            }
            var statusFinal = getEl('speedtest-status');
            if (statusFinal) statusFinal.style.display = 'none';
            abortController = null;
        }
    }

    return {
        run: runSpeedTest
    };
})();

window.SpeedTest = SpeedTest;
