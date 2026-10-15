/* Сборка для старых браузеров (Chrome 53) из js/catalog-memory-fix.js — tools/legacy-build/build.js. Руками не править. */





(function () {
  'use strict';

  console.log('🧹 Загрузка патчей памяти для catalog.js...');



























  var originalInitPosterLazyLoading = window.initPosterLazyLoading;
  if (originalInitPosterLazyLoading) {
    window.initPosterLazyLoading = function () {

      if (typeof catalogState !== 'undefined' && catalogState.posterObserver) {
        try {
          catalogState.posterObserver.disconnect();
          delete catalogState.posterObserver;
        } catch (e) {}
      }

      originalInitPosterLazyLoading();
    };
  }

  var originalInitRowPosterLazyLoading = window.initRowPosterLazyLoading;
  if (originalInitRowPosterLazyLoading) {
    window.initRowPosterLazyLoading = function () {

      if (typeof catalogState !== 'undefined' && catalogState.rowPosterObserver) {
        try {
          catalogState.rowPosterObserver.disconnect();
          delete catalogState.rowPosterObserver;
        } catch (e) {}
      }

      originalInitRowPosterLazyLoading();
    };
  }



  var TRAILER_CACHE_LIMIT = 20;

  function cleanupTrailerCache() {
    if (typeof rutubeTrailerCache === 'undefined') return;

    var keys = Object.keys(rutubeTrailerCache);
    if (keys.length > TRAILER_CACHE_LIMIT) {
      console.log('🧹 Очистка rutubeTrailerCache: ' + keys.length + ' элементов');


      var toRemove = Math.floor(keys.length / 2);
      for (var i = 0; i < toRemove; i++) {
        delete rutubeTrailerCache[keys[i]];
      }
    }
  }



  var originalSetupDetailDelegation = window.setupDetailDelegation;
  if (originalSetupDetailDelegation) {
    window.setupDetailDelegation = function (dv) {

      if (dv && dv._detailClickHandler) {
        dv.removeEventListener('click', dv._detailClickHandler);
        delete dv._detailClickHandler;
      }

      originalSetupDetailDelegation(dv);
    };
  }










  function cleanupCatalogState() {
    if (typeof catalogState === 'undefined' || typeof AppState === 'undefined') return;





    if (AppState.currentScreen === 'catalog' || AppState.currentScreen === 'detail') return;


    if (catalogState.posterObserver) {
      catalogState.posterObserver.disconnect();
    }
    if (catalogState.rowPosterObserver) {
      catalogState.rowPosterObserver.disconnect();
    }
    if (catalogState.loadMoreObserver) {
      catalogState.loadMoreObserver.disconnect();
    }


    catalogState.posterLoadQueue = [];
    catalogState.rowPosterQueue = [];



    window._catalogObserversDisarmed = true;

    console.log('🧹 Catalog state очищен (экран изменён)');
  }








  function rearmCatalogObservers() {
    if (typeof catalogState === 'undefined' || typeof AppState === 'undefined') return;
    if (!window._catalogObserversDisarmed) return;
    if (AppState.currentScreen !== 'catalog') return;
    window._catalogObserversDisarmed = false;


    if (typeof isCatalogRowsMode === 'function' && isCatalogRowsMode()) {



      var rows = document.querySelectorAll('#catalog-rows .catalog-row-card');
      for (var r = 0; r < rows.length; r++) {
        var box = rows[r].querySelector('.row-poster-img');
        if (box && !box.querySelector('img')) rows[r].dataset.posterLoaded = '0';
      }
      if (typeof window.initRowPosterLazyLoading === 'function') window.initRowPosterLazyLoading();
      console.log('♻️ Наблюдатели рядов каталога восстановлены (' + rows.length + ' карточек)');
      return;
    }


    var cards = document.querySelectorAll('#catalog-grid .torrent-card.catalog-card');
    for (var i = 0; i < cards.length; i++) {
      if (!cards[i].querySelector('img.catalog-poster-img')) cards[i].dataset.posterRequested = '0';
    }
    if (typeof window.initPosterLazyLoading === 'function') window.initPosterLazyLoading();
    if (typeof window.initLoadMoreObserver === 'function') window.initLoadMoreObserver();
    console.log('♻️ Наблюдатели каталога восстановлены (' + cards.length + ' карточек)');
  }

  window.rearmCatalogObservers = rearmCatalogObservers;



  setInterval(function () {
    cleanupTrailerCache();
    cleanupCatalogState();
    rearmCatalogObservers();
  }, 120000);



  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      rearmCatalogObservers();
      return;
    }
    console.log('🧹 Страница скрыта, выполнение очистки...');
    cleanupCatalogState();





  });




























  console.log('✅ Патчи памяти для catalog.js загружены');

})();
