// =====================================================
// ИСПРАВЛЕНИЯ УТЕЧЕК ПАМЯТИ В PLAYER.JS
// Специфичные патчи для модуля плеера
// =====================================================

(function() {
    'use strict';

    console.log('🧹 Загрузка патчей памяти для player.js...');

    // ==================== 1. CLEANUP EVENT LISTENERS ====================

    // Патч для setupEpisodesListDelegation
    var originalSetupEpisodesListDelegation = window.setupEpisodesListDelegation;
    if (originalSetupEpisodesListDelegation) {
        window.setupEpisodesListDelegation = function() {
            var episodesList = document.getElementById('episodes-list');
            if (!episodesList) return;

            // Удаляем старый обработчик
            if (episodesList._delegated && episodesList._delegateHandler) {
                episodesList.removeEventListener('click', episodesList._delegateHandler);
                delete episodesList._delegateHandler;
            }

            episodesList._delegated = true;

            var handler = function(e) {
                var item = e.target && e.target.closest ? e.target.closest('.episode-item') : null;
                if (!item) return;

                var index = parseInt(item.dataset.index, 10);
                var fileId = item.dataset.fileId;

                if (isNaN(index) || !fileId) return;

                if (typeof switchToEpisode === 'function') {
                    switchToEpisode(index, fileId);
                }

                if (typeof resetMouseIdleTimer === 'function') {
                    resetMouseIdleTimer();
                }
            };

            episodesList._delegateHandler = handler;
            episodesList.addEventListener('click', handler);
        };
    }

    // Патч для setupAudioListDelegation
    var originalSetupAudioListDelegation = window.setupAudioListDelegation;
    if (originalSetupAudioListDelegation) {
        window.setupAudioListDelegation = function() {
            var audioList = document.getElementById('audio-list');
            if (!audioList) return;

            if (audioList._delegated && audioList._delegateHandler) {
                audioList.removeEventListener('click', audioList._delegateHandler);
                delete audioList._delegateHandler;
            }

            audioList._delegated = true;

            var handler = function(e) {
                var item = e.target && e.target.closest ? e.target.closest('.audio-item') : null;
                if (!item) return;

                var trackIndex = parseInt(item.dataset.trackIndex, 10);
                if (isNaN(trackIndex)) return;

                if (typeof switchAudioTrack === 'function') {
                    switchAudioTrack(trackIndex);
                }

                if (typeof resetMouseIdleTimer === 'function') {
                    resetMouseIdleTimer();
                }
            };

            audioList._delegateHandler = handler;
            audioList.addEventListener('click', handler);
        };
    }

    // Патч для setupSubtitlesListDelegation
    var originalSetupSubtitlesListDelegation = window.setupSubtitlesListDelegation;
    if (originalSetupSubtitlesListDelegation) {
        window.setupSubtitlesListDelegation = function() {
            var subtitlesList = document.getElementById('subtitles-list');
            if (!subtitlesList) return;

            if (subtitlesList._delegated && subtitlesList._delegateHandler) {
                subtitlesList.removeEventListener('click', subtitlesList._delegateHandler);
                delete subtitlesList._delegateHandler;
            }

            subtitlesList._delegated = true;

            var handler = function(e) {
                var item = e.target && e.target.closest ? e.target.closest('.subtitle-item') : null;
                if (!item) return;

                var trackIndex = parseInt(item.dataset.trackIndex, 10);
                if (isNaN(trackIndex)) return;

                if (typeof switchSubtitleTrack === 'function') {
                    switchSubtitleTrack(trackIndex);
                }

                if (typeof resetMouseIdleTimer === 'function') {
                    resetMouseIdleTimer();
                }
            };

            subtitlesList._delegateHandler = handler;
            subtitlesList.addEventListener('click', handler);
        };
    }

    // ==================== 2. CLEANUP MOUSE IDLE TIMER ====================

    var originalResetMouseIdleTimer = window.resetMouseIdleTimer;
    if (originalResetMouseIdleTimer) {
        window.resetMouseIdleTimer = function() {
            var playerScreen = document.getElementById('player-screen');
            if (!playerScreen || playerScreen.style.display !== 'block') return;

            // Очищаем предыдущий таймер
            if (typeof mouseIdleTimer !== 'undefined' && mouseIdleTimer) {
                clearTimeout(mouseIdleTimer);
                mouseIdleTimer = null;
            }

            originalResetMouseIdleTimer();
        };
    }

    // ==================== 3. CLEANUP HLS EVENT LISTENERS ====================

    var originalAttachHlsEventListeners = window.attachHlsEventListeners;
    if (originalAttachHlsEventListeners) {
        window.attachHlsEventListeners = function(hls, videoPlayer, signal, initialSeek) {
            // Удаляем все старые обработчики перед добавлением новых
            if (hls && hls.listenerCount && typeof Hls !== 'undefined') {
                var events = [
                    Hls.Events.MANIFEST_PARSED,
                    Hls.Events.FRAG_LOADING,
                    Hls.Events.BUFFER_APPENDED,
                    Hls.Events.FRAG_CHANGED,
                    Hls.Events.ERROR
                ];

                for (var i = 0; i < events.length; i++) {
                    try {
                        hls.removeAllListeners(events[i]);
                    } catch(e) {}
                }
            }

            originalAttachHlsEventListeners(hls, videoPlayer, signal, initialSeek);
        };
    }

    // ==================== 4. CLEANUP TRAILER BACKGROUND ====================

    var originalStopTrailerBackground = window.stopTrailerBackground;
    if (originalStopTrailerBackground) {
        window.stopTrailerBackground = function() {
            var video = (typeof rutubeTrailerState !== 'undefined' && rutubeTrailerState.bgVideo) ||
                        document.getElementById('trailer-bg-video');

            if (video) {
                // Очистка таймера громкости
                if (video._volumeTimer) {
                    clearInterval(video._volumeTimer);
                    delete video._volumeTimer;
                }

                // Очистка HLS
                if (video._hls) {
                    try {
                        video._hls.destroy();
                        delete video._hls;
                    } catch(e) {}
                }

                // Очистка video элемента
                try {
                    video.pause();
                    video.removeAttribute('src');
                    video.load();
                } catch(e) {}

                // Удаление из DOM
                if (video.parentNode) {
                    video.parentNode.removeChild(video);
                }
            }

            originalStopTrailerBackground();
        };
    }

    // ==================== 5. CLEANUP INTERVALS ====================

    // Патч для startHeartbeat
    var originalStartHeartbeat = window.startHeartbeat;
    if (originalStartHeartbeat) {
        window.startHeartbeat = function() {
            if (typeof heartbeatInterval !== 'undefined' && heartbeatInterval) {
                clearInterval(heartbeatInterval);
                heartbeatInterval = null;
            }

            originalStartHeartbeat();
        };
    }

    // Патч для startNearEndCheck
    var originalStartNearEndCheck = window.startNearEndCheck;
    if (originalStartNearEndCheck) {
        window.startNearEndCheck = function() {
            if (typeof nearEndCheckInterval !== 'undefined' && nearEndCheckInterval) {
                clearInterval(nearEndCheckInterval);
                nearEndCheckInterval = null;
            }

            originalStartNearEndCheck();
        };
    }

    // Патч для startTimecodeSaving
    var originalStartTimecodeSaving = window.startTimecodeSaving;
    if (originalStartTimecodeSaving) {
        window.startTimecodeSaving = function() {
            if (typeof timecodeSaveInterval !== 'undefined' && timecodeSaveInterval) {
                clearInterval(timecodeSaveInterval);
                timecodeSaveInterval = null;
            }

            originalStartTimecodeSaving();
        };
    }

    // ==================== 6. ENHANCED DESTROYHLS ====================

    var originalDestroyHls = window.destroyHls;
    if (originalDestroyHls) {
        window.destroyHls = function() {
            var videoPlayer = document.getElementById('video-player');

            // Удаляем все event listeners с video элемента
            if (videoPlayer) {
                // Клонируем элемент чтобы удалить все обработчики
                var clone = videoPlayer.cloneNode(false);
                if (videoPlayer.parentNode) {
                    videoPlayer.parentNode.replaceChild(clone, videoPlayer);

                    // Обновляем ссылку в AppState
                    if (typeof AppState !== 'undefined') {
                        AppState.nativeVideoPlayer = clone;
                    }
                }
            }

            originalDestroyHls();

            // Дополнительная очистка
            if (typeof AppState !== 'undefined' && AppState.hls) {
                try {
                    AppState.hls.destroy();
                    AppState.hls = null;
                } catch(e) {}
            }

            // Очистка всех timeout'ов
            if (typeof AppState !== 'undefined') {
                if (AppState._loadingTimeout) {
                    clearTimeout(AppState._loadingTimeout);
                    AppState._loadingTimeout = null;
                }
                if (AppState._seekTimeout) {
                    clearTimeout(AppState._seekTimeout);
                    AppState._seekTimeout = null;
                }
                if (AppState.seekTimeout) {
                    clearTimeout(AppState.seekTimeout);
                    AppState.seekTimeout = null;
                }
            }
        };
    }

    // ==================== 7. CLEANUP SKIP BUTTON ====================

    var originalHideSkipButton = window.hideSkipButton;
    if (originalHideSkipButton) {
        window.hideSkipButton = function() {
            if (typeof skipButtonTimeout !== 'undefined' && skipButtonTimeout) {
                clearTimeout(skipButtonTimeout);
                skipButtonTimeout = null;
            }

            originalHideSkipButton();
        };
    }

    // ==================== 8. CLEANUP ON PLAYER EXIT ====================

    var originalShowDetailView = window.showDetailView;
    if (originalShowDetailView) {
        window.showDetailView = function(field) {
            console.log('🧹 Очистка плеера перед выходом...');

            // Очистка всех интервалов
            if (typeof heartbeatInterval !== 'undefined' && heartbeatInterval) {
                clearInterval(heartbeatInterval);
                heartbeatInterval = null;
            }
            if (typeof nearEndCheckInterval !== 'undefined' && nearEndCheckInterval) {
                clearInterval(nearEndCheckInterval);
                nearEndCheckInterval = null;
            }
            if (typeof timecodeSaveInterval !== 'undefined' && timecodeSaveInterval) {
                clearInterval(timecodeSaveInterval);
                timecodeSaveInterval = null;
            }
            if (typeof mouseIdleTimer !== 'undefined' && mouseIdleTimer) {
                clearTimeout(mouseIdleTimer);
                mouseIdleTimer = null;
            }
            if (typeof skipButtonTimeout !== 'undefined' && skipButtonTimeout) {
                clearTimeout(skipButtonTimeout);
                skipButtonTimeout = null;
            }
            if (typeof pauseTimer !== 'undefined' && pauseTimer) {
                clearTimeout(pauseTimer);
                pauseTimer = null;
            }

            // Очистка данных
            if (typeof currentEpisodeFiles !== 'undefined') {
                currentEpisodeFiles = [];
            }
            if (typeof skipData !== 'undefined') {
                skipData = null;
            }

            originalShowDetailView(field);
        };
    }

    // ==================== 9. PERIODIC PLAYER CLEANUP ====================

    setInterval(function() {
        // Очистка только если не в режиме плеера
        if (typeof AppState !== 'undefined' && AppState.currentScreen !== 'player') {
            console.log('🧹 Периодическая очистка плеера (неактивен)...');

            // Очистка данных серий
            if (typeof currentEpisodeFiles !== 'undefined' && currentEpisodeFiles.length > 50) {
                console.log('⚠️ currentEpisodeFiles слишком большой: ' + currentEpisodeFiles.length);
                currentEpisodeFiles = [];
            }

            // Очистка skipData
            if (typeof skipData !== 'undefined' && skipData && !skipData.error) {
                skipData = null;
            }
        }
    }, 180000); // каждые 3 минуты

    // ==================== 10. VIDEO ELEMENT CLEANUP ====================

    function cleanupVideoElement() {
        var videoPlayer = document.getElementById('video-player');
        if (!videoPlayer) return;

        // Очистка src и остановка загрузки
        try {
            videoPlayer.pause();
            videoPlayer.removeAttribute('src');
            videoPlayer.load();
        } catch(e) {}

        // Удаление всех dataset атрибутов
        if (videoPlayer.dataset) {
            delete videoPlayer.dataset.expectedDuration;
            delete videoPlayer.dataset.originalDuration;
            delete videoPlayer.dataset.seekOffset;
        }
    }

    // Вызов при смене экрана
    document.addEventListener('visibilitychange', function() {
        if (document.hidden && typeof AppState !== 'undefined' && AppState.currentScreen !== 'player') {
            console.log('🧹 Страница скрыта, очистка video элемента...');
            cleanupVideoElement();
        }
    });

    console.log('✅ Патчи памяти для player.js загружены');

})();
