// speedtest.js - Модуль замера скорости

var SpeedTest = (function () {
    'use strict';

    var TIMEOUT_MS = 20000; // 20 секунд
    var isRunning = false;
    var runningDirect = false;   // идущий замер — прямой (TorrServer → Клиент)
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

    /**
     * Прямой замер — когда видео идёт мимо TorrStream.
     *
     * В обычном режиме поток идёт TorrServer → TorrStream → устройство, и
     * замер повторяет этот путь двумя этапами. Но при транскодировании через
     * TorrServer, при полностью отключённом транскодировании и в
     * Android-приложении (внешний плеер) устройство берёт видео у TorrServer
     * само — тогда и мерить надо этот путь: устройство качает
     * TorrServer/download/200 напрямую.
     */
    function isDirectMode() {
        if (window.AndroidJS) return true;
        var s = window.AppState;
        return !!(s && (s.transcodingOnOff || s.transcodingFullOnOff));
    }

    // Этап 2: Замер на клиенте (TorrStream → Клиент)
    function measureServerToClient() {
        var testId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        return measureDownload('/api/speedtest/download/' + testId, {}, 'client');
    }

    // Прямой замер: TorrServer → Клиент, без TorrStream посередине
    async function measureTorrServerToClient(torrServerUrl) {
        var headers = getAuthHeaders();
        headers['accept'] = 'application/octet-stream';
        try {
            return await measureDownload(torrServerUrl + '/download/200', headers, 'direct');
        } catch (error) {
            if (error && error.status === 401) {
                throw new Error('Ошибка авторизации TorrServer. Проверьте логин и пароль.');
            }
            // fetch бросает TypeError и на обрыв сети, и на отказ CORS — с
            // устройства TorrServer может быть недоступен, хотя с сервера виден
            if (error && error.name === 'TypeError') {
                throw new Error('TorrServer недоступен с этого устройства напрямую');
            }
            throw error;
        }
    }

    /**
     * Скачивание тестовых 200 MB с замером. Останавливается на 200 MB или по
     * таймауту 20 с — тогда скорость считается по тому, что успело прийти.
     */
    async function measureDownload(url, headers, statusType) {
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
            console.log('📡 Замер скорости:', url);

            var response = await fetch(url, {
                signal: abortController.signal,
                method: 'GET',
                headers: headers || {}
            });

            if (!response.ok) {
                var httpError = new Error('HTTP ' + response.status);
                httpError.status = response.status;
                throw httpError;
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
                    updateSpeedtestStatus(statusType, Math.floor(progress) + '%');
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

    /**
     * Довести карточку результатов до видимой части экрана.
     *
     * На 960×540 и меньше она оказывалась под краем: фокус пульта стоит на
     * кнопке, экран прокручивается только за фокусом, а карточка лежит ниже
     * кнопки. Сдвигаем ровно настолько, чтобы карточка поместилась, но не
     * дальше, чем кнопка упрётся в верхний край, — она остаётся на виду.
     *
     * scrollTop ставим сами, как и scrollToActiveConfigItem (control.js) для
     * этого экрана; идущий твин навигации прежде останавливаем, иначе он
     * дотянул бы прокрутку обратно к своей цели.
     */
    function revealResults() {
        var el = getEl('speedtest-results');
        if (!el || el.style.display === 'none') return;
        var sc = el.parentElement;
        while (sc && sc !== document.body) {
            var oy = getComputedStyle(sc).overflowY;
            if ((oy === 'auto' || oy === 'scroll') && sc.scrollHeight > sc.clientHeight) break;
            sc = sc.parentElement;
        }
        var useWindow = !sc || sc === document.body;
        var viewTop = useWindow ? 0 : sc.getBoundingClientRect().top;
        var viewBottom = useWindow ? window.innerHeight : sc.getBoundingClientRect().bottom;
        var MARGIN = 24;
        var need = el.getBoundingClientRect().bottom + MARGIN - viewBottom;
        if (need <= 0) return;
        var btn = getEl('speedtest-btn');
        var room = btn ? btn.getBoundingClientRect().top - viewTop - MARGIN : need;
        var shift = Math.min(need, Math.max(0, room));
        if (shift <= 0) return;
        if (useWindow) {
            window.scrollBy(0, shift);
        } else {
            if (typeof Animations !== 'undefined' && Animations.stopScrollTween) Animations.stopScrollTween(sc);
            sc.scrollTop += shift;
        }
    }

    // Прогресс — прямо в кнопке: на ней стоит фокус, и её видно всегда, в
    // отличие от строки статуса под карточкой результатов. В обычном режиме
    // этапов два, и процент на втором начинается с нуля — поэтому номер этапа.
    function setButtonProgress(type, status) {
        var btn = getEl('speedtest-btn');
        if (!btn || !btn.disabled) return;
        var stage = type === 'torrserver' ? ' 1/2' : (type === 'client' ? ' 2/2' : '');
        btn.innerHTML = 'Замер' + stage + '… ' + status;
    }

    // Обновление статуса в UI
    function updateSpeedtestStatus(type, status) {
        setButtonProgress(type, status);
        var statusEl = getEl('speedtest-status');
        if (statusEl) {
            if (type === 'torrserver') {
                statusEl.innerHTML = 'Замер TorrServer → TorrStream: ' + status;
            } else if (type === 'client') {
                statusEl.innerHTML = 'Замер TorrStream → Клиент: ' + status;
            } else if (type === 'direct') {
                statusEl.innerHTML = 'Замер TorrServer → Клиент: ' + status;
            }
        }
    }

    // Строка второго этапа нужна только в обычном режиме: в прямом этап один
    function setClientLineVisible(visible) {
        var clientEl = getEl('speedtest-client');
        if (clientEl) clientEl.style.display = visible ? '' : 'none';
    }

    // Показать результаты прямого замера (TorrServer → Клиент)
    function showDirectResult(result, totalTime) {
        var resultsDiv = getEl('speedtest-results');
        var torrEl = getEl('speedtest-torrserver');
        var totalEl = getEl('speedtest-total');

        if (resultsDiv) resultsDiv.style.display = 'block';
        setClientLineVisible(false);
        if (torrEl) torrEl.innerHTML = 'TorrServer → Клиент: ' + result.speedMbps;
        if (totalEl) {
            var mb = (result.bytesReceived / (1024 * 1024)).toFixed(0);
            totalEl.innerHTML = 'Общее время: ' + formatTime(totalTime) + ' | Получено: ' + mb + ' из 200 MB' +
                (result.timeoutReached ? ' (остановлено по таймауту 20 с)' : '');
        }

        var statusEl = getEl('speedtest-status');
        if (statusEl) statusEl.style.display = 'none';
        setTimeout(revealResults, 0);
    }

    // Показать результаты
    function showResults(torrResult, clientResult, totalTime) {
        var resultsDiv = getEl('speedtest-results');
        var torrEl = getEl('speedtest-torrserver');
        var clientEl = getEl('speedtest-client');
        var totalEl = getEl('speedtest-total');

        if (resultsDiv) resultsDiv.style.display = 'block';
        setClientLineVisible(true);
        if (torrEl) torrEl.innerHTML = 'TorrServer → TorrStream: ' + torrResult.speedMbps;
        if (clientEl) clientEl.innerHTML = 'TorrStream → Клиент: ' + clientResult.speedMbps;
        if (totalEl) totalEl.innerHTML = 'Общее время: ' + formatTime(totalTime) + ' | Тест: 200 MB';

        var statusEl = getEl('speedtest-status');
        if (statusEl) statusEl.style.display = 'none';
        setTimeout(revealResults, 0);
    }

    // Показать ошибку
    function showError(error) {
        var resultsDiv = getEl('speedtest-results');
        var torrEl = getEl('speedtest-torrserver');
        var clientEl = getEl('speedtest-client');
        var totalEl = getEl('speedtest-total');

        if (resultsDiv) resultsDiv.style.display = 'block';
        setClientLineVisible(!runningDirect);
        if (torrEl) torrEl.innerHTML = error.message;
        if (clientEl) clientEl.innerHTML = '--';
        if (totalEl) totalEl.innerHTML = 'Ошибка замера';

        var statusEl = getEl('speedtest-status');
        if (statusEl) statusEl.style.display = 'none';

        if (resultsDiv) resultsDiv.style.borderColor = '#ff4e4e';
        setTimeout(revealResults, 0);
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
        // Режим выбираем в момент запуска: транскодирование могли
        // переключить на соседней вкладке уже после открытия настроек
        runningDirect = isDirectMode();
        var startTotalTime = performance.now();

        var resultsDiv = getEl('speedtest-results');
        var statusEl = getEl('speedtest-status');

        if (resultsDiv) {
            resultsDiv.style.display = 'block';
            resultsDiv.style.borderColor = '#4a9eff';
            var torrEl = getEl('speedtest-torrserver');
            var clientEl = getEl('speedtest-client');
            setClientLineVisible(!runningDirect);
            if (torrEl) torrEl.innerHTML = runningDirect ? 'TorrServer → Клиент: -- Mbps' : 'TorrServer → TorrStream: -- Mbps';
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
        // Строку статуса не показываем: прогресс теперь в самой кнопке, а эта
        // строка лежала ниже карточки результатов и на небольших экранах уходила
        // за край. Узел нужен — из его текста имитация прогресса первого этапа
        // (measureTorrServerToServer) берёт текущий процент.
        statusEl.style.display = 'none';
        statusEl.innerHTML = runningDirect ? 'Замер TorrServer → Клиент: 0%' : 'Замер TorrServer → TorrStream: 0%';

        var btn = getEl('speedtest-btn');
        var originalBtnText = btn ? btn.innerHTML : '';
        if (btn) {
            btn.innerHTML = runningDirect ? 'Замер… 0%' : 'Замер 1/2… 0%';
            btn.disabled = true;
            btn.style.opacity = '0.6';
        }
        // Карточка с прочерками появилась — показать её сразу, а не после замера
        revealResults();

        try {
            if (runningDirect) {
                var directResult = await measureTorrServerToClient(torrServerUrl);
                var directTime = performance.now() - startTotalTime;
                if (!(directResult.bytesReceived > 0)) throw new Error('Не удалось загрузить тестовый файл');
                showDirectResult(directResult, directTime);
                console.log('SpeedTest (напрямую) завершен:', {
                    torrServerToClient: directResult.speedMbps,
                    bytes: directResult.bytesReceived,
                    totalTime: directTime.toFixed(0) + 'ms'
                });
                return true;
            }

            // Этап 1: Серверный замер (TorrServer → TorrStream)
            var torrResult = await measureTorrServerToServer(torrServerUrl);

            if (!isRunning) {
                throw new Error('Тест прерван');
            }

            // Этап 2: Клиентский замер (TorrStream → Клиент)
            statusEl.innerHTML = 'Замер TorrStream → Клиент: 0%';
            setButtonProgress('client', '0%');
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
