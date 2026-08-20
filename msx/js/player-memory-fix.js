// =====================================================
// PLAYER MEMORY — безопасные доработки для player.js
// =====================================================


(function () {
    'use strict';

    console.log('🧹 player-memory (safe): загрузка...');

    // Освобождает буфер #video-player, НЕ трогая сам элемент и его слушатели.
    function freeVideoBuffer() {
        var v = document.getElementById('video-player');
        if (!v) return;
        try {
            if (!v.paused) v.pause();
            // Убираем <source>, если они есть, и сбрасываем src
            while (v.firstChild) v.removeChild(v.firstChild);
            v.removeAttribute('src');
            v.load(); // сбрасывает медиабуфер, СОХРАНЯЯ элемент и обработчики
        } catch (e) {}
    }

    function inPlayer() {
        return !!(window.AppState && AppState.currentScreen === 'player');
    }

    // При выходе из плеера в detail-view: оригинальный showDetailView уже
    // вызывает destroyHls(). Мы лишь дочищаем буфер чуть позже — и только
    // если мы действительно НЕ вернулись обратно в плеер (защита от гонки).
    var originalShowDetailView = window.showDetailView;
    if (typeof originalShowDetailView === 'function') {
        window.showDetailView = function () {
            var result = originalShowDetailView.apply(this, arguments);
            setTimeout(function () {
                if (inPlayer()) return; // снова в плеере — ничего не трогаем
                freeVideoBuffer();
                if (typeof window.stopTrailerBackground === 'function') {
                    try { window.stopTrailerBackground(); } catch (e) {}
                }
            }, 300);
            return result;
        };
    }

    // Сворачивание вкладки вне плеера — тоже освобождаем буфер.
    document.addEventListener('visibilitychange', function () {
        if (document.hidden && !inPlayer()) {
            freeVideoBuffer();
        }
    });

    console.log('✅ player-memory (safe): готово (без клонирования <video>)');

})();
