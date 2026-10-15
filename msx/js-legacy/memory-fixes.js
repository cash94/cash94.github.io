/* Сборка для старых браузеров (Chrome 53) из js/memory-fixes.js — tools/legacy-build/build.js. Руками не править. */





(function () {
  'use strict';

  console.log('🧹 Загрузка патчей для утечек памяти...');




  window._eventListenersRegistry = window._eventListenersRegistry || new WeakMap();


  function safeAddEventListener(element, event, handler, options) {
    if (!element) return;


    var registry = window._eventListenersRegistry.get(element);
    if (!registry) {
      registry = {};
      window._eventListenersRegistry.set(element, registry);
    }

    var key = event + '_' + (options ? JSON.stringify(options) : '');
    if (registry[key]) {
      element.removeEventListener(event, registry[key], options);
    }

    element.addEventListener(event, handler, options);
    registry[key] = handler;
  }



  var originalDestroyHls = window.destroyHls;
  window.destroyHls = function () {
    if (originalDestroyHls) originalDestroyHls();


    var videoPlayer = document.getElementById('video-player');
    if (videoPlayer && videoPlayer._hls) {
      try {
        videoPlayer._hls.destroy();
        delete videoPlayer._hls;
      } catch (e) {}
    }


    var trailerBg = document.getElementById('trailer-bg-video');
    if (trailerBg) {
      if (trailerBg._hls) {
        try {
          trailerBg._hls.destroy();
          delete trailerBg._hls;
        } catch (e) {}
      }
      if (trailerBg._volumeTimer) {
        clearInterval(trailerBg._volumeTimer);
        delete trailerBg._volumeTimer;
      }
    }
  };




  window._observersRegistry = window._observersRegistry || [];

  function registerObserver(observer, name) {
    window._observersRegistry.push({ observer: observer, name: name });
  }

  function cleanupAllObservers() {
    console.log('🧹 Очистка ' + window._observersRegistry.length + ' observers');
    for (var i = 0; i < window._observersRegistry.length; i++) {
      try {
        window._observersRegistry[i].observer.disconnect();
      } catch (e) {}
    }
    window._observersRegistry = [];
  }


  if (typeof catalogState !== 'undefined') {
    var originalInitPosterLazyLoading = window.initPosterLazyLoading;
    window.initPosterLazyLoading = function () {
      if (catalogState.posterObserver) {
        catalogState.posterObserver.disconnect();
      }
      if (originalInitPosterLazyLoading) {
        originalInitPosterLazyLoading();
      }
      if (catalogState.posterObserver) {
        registerObserver(catalogState.posterObserver, 'posterObserver');
      }
    };




  }























  var TRAILER_CACHE_MAX_SIZE = 20;
  var originalFetchRutubeTrailer = window.fetchRutubeTrailer;

  if (originalFetchRutubeTrailer) {
    window.fetchRutubeTrailer = function () {

      if (typeof rutubeTrailerCache !== 'undefined') {
        var keys = Object.keys(rutubeTrailerCache);
        if (keys.length > TRAILER_CACHE_MAX_SIZE) {
          console.log('🧹 Очистка rutubeTrailerCache: ' + keys.length + ' -> ' + TRAILER_CACHE_MAX_SIZE);

          for (var i = 0; i < 10; i++) {
            delete rutubeTrailerCache[keys[i]];
          }
        }
      }
      return originalFetchRutubeTrailer.apply(this, arguments);
    };
  }



  var CLEANUP_INTERVAL = 5 * 60 * 1000;

  function performMemoryCleanup() {
    console.log('🧹 Выполнение периодической очистки памяти...');






    var screen = typeof AppState !== 'undefined' ? AppState.currentScreen : null;
    var catalogAlive = screen === 'catalog' || screen === 'detail';
    if (typeof catalogState !== 'undefined' && !catalogAlive) {
      if (catalogState.posterObserver) {
        catalogState.posterObserver.disconnect();
        window._catalogObserversDisarmed = true;
      }
    }



    if (typeof catalogState !== 'undefined' && catalogState.posterCache) {
      var posterCap = typeof CATALOG_CONSTANTS !== 'undefined' && CATALOG_CONSTANTS.MAX_POSTER_CACHE || 400;
      if (catalogState.posterCache.size && catalogState.posterCache.size() > posterCap) {
        console.log('⚠️ posterCache превышает лимит: ' + catalogState.posterCache.size());
      }
    }





    if (typeof window.gc === 'function') {
      try {
        window.gc();
        console.log('✅ Принудительная сборка мусора выполнена');
      } catch (e) {}
    }
  }


  setInterval(performMemoryCleanup, CLEANUP_INTERVAL);



  var originalShowDetailView = window.showDetailView;
  if (originalShowDetailView) {
    window.showDetailView = function () {

      if (typeof stopTrailerBackground === 'function') {
        stopTrailerBackground();
      }
      return originalShowDetailView.apply(this, arguments);
    };
  }



  window.addEventListener('beforeunload', function () {
    console.log('🧹 Очистка при выгрузке страницы...');
    cleanupAllObservers();

    if (typeof catalogState !== 'undefined') {
      if (catalogState.posterCache && catalogState.posterCache.clear) {
        catalogState.posterCache.clear();
      }
    }
  });







  if (window.performance && window.performance.memory) {
    var MEM_DEBUG = location.search.indexOf('memdebug=1') !== -1;
    setInterval(function () {
      var mem = window.performance.memory;
      var ratio = mem.jsHeapSizeLimit ? mem.usedJSHeapSize / mem.jsHeapSizeLimit : 0;

      if (MEM_DEBUG || ratio > 0.75) {
        console.log('💾 Память: ' + (mem.usedJSHeapSize / 1048576).toFixed(2) + ' MB / ' +
        (mem.totalJSHeapSize / 1048576).toFixed(2) + ' MB (лимит: ' +
        (mem.jsHeapSizeLimit / 1048576).toFixed(2) + ' MB)');
      }


      if (ratio > 0.9) {
        console.warn('⚠️ КРИТИЧЕСКОЕ использование памяти! Выполнение очистки...');
        performMemoryCleanup();
      }
    }, 60000);
  }

  console.log('✅ Патчи для утечек памяти загружены');

})();
