/* Сборка для старых браузеров (Chrome 53) из js/player-memory-fix.js — tools/legacy-build/build.js. Руками не править. */





(function () {
  'use strict';

  console.log('🧹 player-memory (safe): загрузка...');


  function freeVideoBuffer() {
    var v = document.getElementById('video-player');
    if (!v) return;
    try {
      if (!v.paused) v.pause();

      while (v.firstChild) v.removeChild(v.firstChild);
      v.removeAttribute('src');
      v.load();
    } catch (e) {}
  }

  function inPlayer() {
    return !!(window.AppState && AppState.currentScreen === 'player');
  }




  var originalShowDetailView = window.showDetailView;
  if (typeof originalShowDetailView === 'function') {
    window.showDetailView = function () {
      var result = originalShowDetailView.apply(this, arguments);
      setTimeout(function () {
        if (inPlayer()) return;
        freeVideoBuffer();
        if (typeof window.stopTrailerBackground === 'function') {
          try {window.stopTrailerBackground();} catch (e) {}
        }
      }, 300);
      return result;
    };
  }


  document.addEventListener('visibilitychange', function () {
    if (document.hidden && !inPlayer()) {
      freeVideoBuffer();
    }
  });

  console.log('✅ player-memory (safe): готово (без клонирования <video>)');

})();
