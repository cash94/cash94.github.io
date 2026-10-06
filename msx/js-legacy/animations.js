/* Сборка для старых браузеров (Chrome 53) из js/animations.js — tools/legacy-build/build.js. Руками не править. */


var Animations = function () {
  'use strict';


  var config = {
    duration: {
      fast: 0.15,
      normal: 0.25,
      slow: 0.4
    },
    ease: {
      bounce: "back.out(1.2)",
      elastic: "elastic.out(1, 0.5)",
      smooth: "power1.out",
      soft: "sine.inOut"
    }
  };






















  var DETAIL_FADE = {
    show: 0.38,
    hide: 0.40,




    swapOut: 0.16,



    revealMaxMs: 4000,
    loader: 0.18,
    loaderDelayMs: 160,
    loaderMaxMs: 4000,
    easeOut: 'cubic-bezier(0.22, 0.61, 0.36, 1)',



    easeIn: 'cubic-bezier(0.4, 0, 0.6, 1)'
  };

  var detailHideTween = null;
  var detailRevealPending = false;
  var detailRevealTimer = null;
  var detailShadeEl = null;
  var detailSwapFaded = false;
  var detailLoaderEl = null;
  var detailLoaderShowTimer = null;
  var detailLoaderMaxTimer = null;










  function clearTransform(el) {
    if (!el || !el.style) return;
    el.style.transform = '';
    el.style.translate = '';
    el.style.scale = '';
  }


  function stopFade(el) {
    if (el && el._fadeHandle) el._fadeHandle.kill();
  }












  function fadeElement(el, toOpacity, duration, ease, onComplete) {
    if (!el) return null;

    stopFade(el);

    var finished = false;
    var timer = null;

    function cleanup() {
      if (el.removeEventListener) el.removeEventListener('transitionend', onTransitionEnd, false);
      if (timer) {clearTimeout(timer);timer = null;}
      if (el._fadeHandle === handle) el._fadeHandle = null;
    }

    function finish() {
      if (finished) return;
      finished = true;
      cleanup();
      el.style.transition = '';
      el.style.opacity = String(toOpacity);
      if (onComplete) onComplete();
    }

    function onTransitionEnd(e) {

      if (e.target !== el || e.propertyName !== 'opacity') return;
      finish();
    }


    function atTarget() {
      if (!window.getComputedStyle) return true;
      var now;
      try {now = parseFloat(window.getComputedStyle(el).opacity);} catch (err) {return true;}
      if (isNaN(now)) return true;
      return Math.abs(now - toOpacity) < 0.02;
    }





    var attempts = 0;
    function tick() {
      timer = null;
      if (attempts++ < 3 && !atTarget()) {
        timer = setTimeout(tick, Math.round(duration * 1000) + 150);
        return;
      }
      finish();
    }

    var handle = {
      to: toOpacity,
      kill: function () {
        if (finished) return;
        finished = true;


        var current = null;
        if (window.getComputedStyle) {
          try {current = window.getComputedStyle(el).opacity;} catch (err) {current = null;}
        }
        if (current !== null && current !== '') el.style.opacity = current;
        el.style.transition = '';
        cleanup();
      }
    };

    el._fadeHandle = handle;



    void el.offsetWidth;

    el.style.transition = 'opacity ' + duration + 's ' + (ease || 'ease');
    el.style.opacity = String(toOpacity);

    if (el.addEventListener) el.addEventListener('transitionend', onTransitionEnd, false);

    timer = setTimeout(tick, Math.round(duration * 1000) + 150);

    return handle;
  }








  function getDetailLoader(create) {
    if (detailLoaderEl && detailLoaderEl.parentNode) return detailLoaderEl;
    if (!create) return null;

    var host = document.body || getEl('detail-view');
    if (!host) return null;

    detailLoaderEl = document.createElement('div');
    detailLoaderEl.id = 'detail-loading';
    detailLoaderEl.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;' +
    'display:none;flex-direction:column;align-items:center;justify-content:center;' +
    'background:rgba(0,0,0,0.75);z-index:120;opacity:0;pointer-events:none;';
    detailLoaderEl.innerHTML = '<div class="loading-spinner"></div>' +
    '<div class="loading-text">Загрузка...</div>';
    host.appendChild(detailLoaderEl);

    return detailLoaderEl;
  }


















  function getDetailShade(create) {
    if (detailShadeEl && detailShadeEl.parentNode) return detailShadeEl;
    if (!create) return null;

    var host = document.body || getEl('detail-view');
    if (!host) return null;

    detailShadeEl = document.createElement('div');
    detailShadeEl.id = 'detail-swap-shade';

    detailShadeEl.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;' +
    'background:#000;z-index:99;display:none;pointer-events:none;';
    host.appendChild(detailShadeEl);
    return detailShadeEl;
  }

  function raiseDetailShade() {
    var el = getDetailShade(true);
    if (el) el.style.display = 'block';
  }

  function dropDetailShade() {
    var el = getDetailShade(false);
    if (el) el.style.display = 'none';
  }

  function clearDetailLoaderTimers() {
    if (detailLoaderShowTimer) {
      clearTimeout(detailLoaderShowTimer);
      detailLoaderShowTimer = null;
    }
    if (detailLoaderMaxTimer) {
      clearTimeout(detailLoaderMaxTimer);
      detailLoaderMaxTimer = null;
    }
  }



  function showDetailLoading() {
    clearDetailLoaderTimers();

    detailLoaderShowTimer = setTimeout(function () {
      detailLoaderShowTimer = null;

      var el = getDetailLoader(true);
      if (!el) return;

      el.style.display = 'flex';
      fadeElement(el, 1, DETAIL_FADE.loader, DETAIL_FADE.easeOut);
    }, DETAIL_FADE.loaderDelayMs);

    detailLoaderMaxTimer = setTimeout(function () {
      detailLoaderMaxTimer = null;
      hideDetailLoading();
    }, DETAIL_FADE.loaderMaxMs);
  }

  function hideDetailLoading(immediate) {
    clearDetailLoaderTimers();

    var el = getDetailLoader(false);
    if (!el) return;

    if (immediate) {
      stopFade(el);
      el.style.transition = '';
      el.style.opacity = '0';
      el.style.display = 'none';
      return;
    }

    fadeElement(el, 0, DETAIL_FADE.loader, DETAIL_FADE.easeIn, function () {
      el.style.display = 'none';
    });
  }



  function cancelDetailHide(detailView) {
    if (detailHideTween) {
      if (typeof detailHideTween.kill === 'function') detailHideTween.kill();
      detailHideTween = null;
    }
    if (detailView) stopFade(detailView);
    if (detailView && detailView.dataset) delete detailView.dataset.hiding;
  }

  function finishDetailHide(detailView, keepContent) {
    detailView.style.display = 'none';
    detailView.style.pointerEvents = 'none';
    dropDetailShade();
    if (detailView.dataset) delete detailView.dataset.hiding;



    detailView.style.transition = '';
    detailView.style.opacity = '1';
    clearTransform(detailView);




















    var keptTorrentCard = !!(detailView.dataset && detailView.dataset.torrentHash &&
    detailView.classList.contains('torrent-detail-mode'));
    if (!keepContent && !keptTorrentCard && typeof window.resetDetailBackground === 'function') {
      try {window.resetDetailBackground();} catch (e) {}
    }
  }

  function clearDetailRevealTimer() {
    if (detailRevealTimer) {
      clearTimeout(detailRevealTimer);
      detailRevealTimer = null;
    }
  }





  function revealDetail(detailView) {
    if (!detailRevealPending) return null;
    detailRevealPending = false;
    clearDetailRevealTimer();

    detailView = detailView || getEl('detail-view');
    if (!detailView || detailView.style.display === 'none') {
      dropDetailShade();
      return null;
    }

    return fadeElement(detailView, 1, DETAIL_FADE.show, DETAIL_FADE.easeOut, function () {



      dropDetailShade();
    });
  }















  function beginDetailSwap() {
    var detailView = getEl('detail-view');
    if (!detailView || isElementHidden(detailView) || detailView.style.display !== 'block') {
      return Promise.resolve(false);
    }



    if (detailRevealPending) return Promise.resolve(false);









    var titleEl = getEl('detail-title-text');
    if (titleEl && !String(titleEl.textContent || '').trim()) {
      raiseDetailShade();
      return Promise.resolve(false);
    }

    cancelDetailHide(detailView);
    hideDetailLoading(true);
    detailView.style.pointerEvents = 'none';



    raiseDetailShade();

    detailSwapFaded = true;

    return new Promise(function (resolve) {


      fadeElement(detailView, 0, DETAIL_FADE.swapOut, DETAIL_FADE.easeIn, function () {
        resolve(true);
      });
    });
  }

















  function animateDetailShow() {
    var detailView = getEl('detail-view');
    if (!detailView) return null;

    var afterSwap = detailSwapFaded;
    detailSwapFaded = false;

    cancelDetailHide(detailView);

    detailView.style.display = 'block';
    detailView.style.zIndex = '100';
    detailView.style.pointerEvents = 'auto';

    detailView.style.visibility = '';



    clearTransform(detailView);
    detailView.style.backgroundColor = 'rgb(0, 0, 0)';
    detailView.style.transition = '';
    detailView.style.opacity = '0';


    showDetailLoading();

    if (!afterSwap) {
      detailRevealPending = false;
      clearDetailRevealTimer();




      return fadeElement(detailView, 1, DETAIL_FADE.show, DETAIL_FADE.easeOut, function () {
        dropDetailShade();
      });
    }

    detailRevealPending = true;
    clearDetailRevealTimer();



    detailRevealTimer = setTimeout(function () {
      detailRevealTimer = null;
      revealDetail();
    }, DETAIL_FADE.revealMaxMs);
    return null;
  }


  function detailContentReady() {
    hideDetailLoading();

    var detailView = getEl('detail-view');
    if (!detailView || detailView.style.display === 'none') return;

    if (detailRevealPending) {revealDetail(detailView);return;}



    if (!detailView._fadeHandle && !detailHideTween) {
      detailView.style.transition = '';
      detailView.style.opacity = '1';
    }

    dropDetailShade();
  }







  function ensureDetailVisible() {
    var detailView = getEl('detail-view');
    if (!detailView) return null;

    cancelDetailHide(detailView);
    hideDetailLoading(true);


    detailRevealPending = false;
    detailSwapFaded = false;
    clearDetailRevealTimer();
    dropDetailShade();

    detailView.style.display = 'block';
    detailView.style.zIndex = '100';
    detailView.style.pointerEvents = 'auto';

    detailView.style.visibility = '';

    clearTransform(detailView);
    detailView.style.transition = '';
    detailView.style.opacity = '1';

    return detailView;
  }











  function animateDetailHide(onDone, opts) {



    if (window.HomeScreen && typeof HomeScreen.uncover === 'function') HomeScreen.uncover();
    var keepContent = !!(opts && opts.keepContent);
    var detailView = getEl('detail-view');
    if (!detailView) {
      if (onDone) onDone();
      return null;
    }

    hideDetailLoading(true);



    detailRevealPending = false;
    detailSwapFaded = false;
    clearDetailRevealTimer();
    dropDetailShade();


    if (detailHideTween) return detailHideTween;

    if (detailView.style.display === 'none' || !detailView.style.display) {


      finishDetailHide(detailView, keepContent);
      if (onDone) onDone();
      return null;
    }




    detailView.dataset.hiding = '1';
    detailView.style.pointerEvents = 'none';

    detailHideTween = fadeElement(detailView, 0, DETAIL_FADE.hide, DETAIL_FADE.easeIn, function () {
      detailHideTween = null;
      finishDetailHide(detailView, keepContent);
      if (onDone) onDone();
    });

    return detailHideTween;
  }




  var UI_FADE = {
    screen: 0.44,
    overlay: 0.24,




    contentOut: 0.30,
    content: 0.42
  };


  function isElementHidden(el) {
    if (!el) return true;
    if (el.hidden) return true;
    if (el.classList && el.classList.contains('hidden')) return true;
    if (el.style.display === 'none') return true;
    return false;
  }



  function resetFade(el) {
    if (!el) return;
    stopFade(el);
    el.style.transition = '';
    el.style.opacity = '';
    if (el.dataset) delete el.dataset.hiding;
  }








  function fadeIn(el, options) {
    if (!el) return null;
    options = options || {};


    if (!options.onDone && el._fadeHandle && el._fadeHandle.to === 1) return el._fadeHandle;

    var wasHidden = isElementHidden(el);
    stopFade(el);
    if (el.dataset) delete el.dataset.hiding;
    if (el.classList) el.classList.remove('hidden');
    if (el.hidden) el.hidden = false;
    if (typeof options.display === 'string') el.style.display = options.display;

    var from = 0;
    if (!wasHidden && window.getComputedStyle) {
      try {from = parseFloat(getComputedStyle(el).opacity);} catch (err) {from = 1;}
      if (isNaN(from)) from = 1;
    }

    if (from >= 0.999) {

      el.style.transition = '';
      el.style.opacity = '';
      if (options.onDone) options.onDone();
      return null;
    }

    el.style.transition = '';
    el.style.opacity = String(from);

    var duration = typeof options.duration === 'number' ? options.duration : UI_FADE.screen;
    var ease = options.ease || DETAIL_FADE.easeOut;
    var done = function () {

      el.style.opacity = '';
      if (options.onDone) options.onDone();
    };

    if (!options.startAfterLayout || typeof requestAnimationFrame !== 'function') {
      return fadeElement(el, 1, duration, ease, done);
    }













    var pending = {
      to: 1,
      done: false,
      raf: 0,
      timer: null,
      kill: function () {pending.stop();}
    };
    pending.stop = function () {
      if (pending.done) return false;
      pending.done = true;
      if (pending.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(pending.raf);
      pending.raf = 0;
      if (pending.timer) {clearTimeout(pending.timer);pending.timer = null;}
      if (el._fadeHandle === pending) el._fadeHandle = null;
      return true;
    };
    el._fadeHandle = pending;

    function start() {
      if (!pending.stop()) return;
      fadeElement(el, 1, duration, ease, done);
    }






    pending.timer = setTimeout(start, 250);

    pending.raf = requestAnimationFrame(function () {
      pending.raf = requestAnimationFrame(start);
    });
    return pending;
  }








  function fadeOut(el, options) {
    options = options || {};

    function applyHidden() {
      if (!el) return;
      if (typeof options.display === 'string') el.style.display = options.display;
      if (options.addHidden && el.classList) el.classList.add('hidden');
      if (options.hiddenAttr) el.hidden = true;
      el.style.transition = '';
      if (!options.keepFaded) el.style.opacity = '';
      if (el.dataset) delete el.dataset.hiding;
    }

    if (!el || isElementHidden(el)) {
      if (el) {stopFade(el);applyHidden();}
      if (options.onDone) options.onDone();
      return null;
    }



    if (el.dataset) el.dataset.hiding = '1';

    var duration = typeof options.duration === 'number' ? options.duration : UI_FADE.screen;
    return fadeElement(el, 0, duration, options.ease || DETAIL_FADE.easeIn, function () {
      applyHidden();
      if (options.onDone) options.onDone();
    });
  }

















  function animateControlsShow() {
    var controls = getEl('controls-container');
    if (!controls) return;

    controls.classList.add('controls-anim');
    controls.classList.add('controls-anim-hidden');


    void controls.offsetWidth;
    controls.classList.remove('controls-anim-hidden');
  }

  function animateControlsHide() {
    var controls = getEl('controls-container');
    if (!controls) return;

    controls.classList.add('controls-anim');
    controls.classList.add('controls-anim-hidden');
  }

























  function isElementInView(element, container) {
    if (!element) return false;

    var elRect = element.getBoundingClientRect();
    var containerRect = container === window || !container ?
    { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth } :
    container.getBoundingClientRect();

    if (elRect.top < containerRect.top || elRect.bottom > containerRect.bottom) return false;





    if (canScrollX(container)) {
      if (elRect.left < containerRect.left || elRect.right > containerRect.right) return false;
    }

    return true;
  }

  function canScrollX(el) {
    return !!el && el !== window && el.scrollWidth > el.clientWidth + 1;
  }

  function canScrollY(el) {
    return !!el && el !== window && el.scrollHeight > el.clientHeight + 1;
  }























  var scrollTweens = [];
  var scrollTweenRaf = 0;


  function scrollTweenIndex(container) {
    for (var i = 0; i < scrollTweens.length; i++) {
      if (scrollTweens[i].el === container) return i;
    }
    return -1;
  }


  function stopScrollTween(container) {
    var i = scrollTweenIndex(container);
    if (i !== -1) scrollTweens.splice(i, 1);
  }








  function isScrollTweening(container) {
    var i = scrollTweenIndex(container);
    return i !== -1 && Date.now() < scrollTweens[i].endAt;
  }

  function scrollTweenStep(now) {
    scrollTweenRaf = 0;

    for (var i = scrollTweens.length - 1; i >= 0; i--) {
      var t = scrollTweens[i];




      if (!t.start) {t.start = now;continue;}

      var p = (now - t.start) / t.dur;
      if (p > 1) p = 1;

      for (var j = 0; j < t.props.length; j++) {
        var pr = t.props[j];



        t.el[pr.name] = p === 1 ? pr.to : pr.from + (pr.to - pr.from) * p;
      }

      if (p === 1 || !t.el.isConnected) scrollTweens.splice(i, 1);
    }

    if (scrollTweens.length) scrollTweenRaf = requestAnimationFrame(scrollTweenStep);
  }










  function tweenScroll(container, vars, options) {
    if (!container || !vars) return;
    options = options || {};
    var duration = typeof options.duration === 'number' ? options.duration : 0.3;

    var hasTop = typeof vars.scrollTop === 'number';
    var hasLeft = typeof vars.scrollLeft === 'number';
    if (!hasTop && !hasLeft) return;



    stopScrollTween(container);

    if (duration <= 0 || typeof requestAnimationFrame !== 'function') {
      if (hasTop) {
        container.scrollTop = vars.scrollTop;
        container._navPendTop = null;
        container._navPendTopUntil = 0;
      }
      if (hasLeft) container.scrollLeft = vars.scrollLeft;
      return;
    }





    if (hasTop) {
      container._navPendTop = vars.scrollTop;
      container._navPendTopUntil = Date.now() + Math.round(duration * 1000) + 50;
    }

    var props = [];
    if (hasTop) props.push({ name: 'scrollTop', from: container.scrollTop, to: vars.scrollTop });
    if (hasLeft) props.push({ name: 'scrollLeft', from: container.scrollLeft, to: vars.scrollLeft });

    scrollTweens.push({
      el: container,
      props: props,
      start: 0,
      dur: duration * 1000,


      endAt: Date.now() + Math.round(duration * 1000) + 50
    });

    if (!scrollTweenRaf) scrollTweenRaf = requestAnimationFrame(scrollTweenStep);
  }


  function scrollToIfNotVisible(element, container, options) {
    if (!element) return;


    if (isElementInView(element, container)) {
      return;
    }

    options = options || {};


    var duration = typeof options.duration === 'number' ? options.duration : 0.15;
    var ease = options.ease || "power1.out";
    var offset = options.offset || 10;
    var direction = options.direction || null;
    var targetContainer = container || window;

    if (targetContainer !== window && targetContainer.scrollTop !== undefined) {
      var rect = element.getBoundingClientRect();
      var containerRect = targetContainer.getBoundingClientRect();
      var vars = {};

      if (canScrollY(targetContainer)) {
        var targetTop;


        if (direction === 'down') {

          targetTop = targetContainer.scrollTop + (rect.bottom - containerRect.bottom) + offset;
        } else if (direction === 'up') {

          targetTop = targetContainer.scrollTop + (rect.top - containerRect.top) - offset;
        } else {

          targetTop = targetContainer.scrollTop + (rect.bottom - containerRect.bottom) + offset;
        }


        vars.scrollTop = Math.max(0, Math.min(targetContainer.scrollHeight - containerRect.height, targetTop));
      }




      if (canScrollX(targetContainer)) {
        var targetLeft;
        if (direction === 'left') {
          targetLeft = targetContainer.scrollLeft + (rect.left - containerRect.left) - offset;
        } else if (direction === 'right') {
          targetLeft = targetContainer.scrollLeft + (rect.right - containerRect.right) + offset;
        } else {
          targetLeft = targetContainer.scrollLeft + (rect.left - containerRect.left) -
          containerRect.width / 2 + rect.width / 2;
        }
        vars.scrollLeft = Math.max(0, Math.min(targetContainer.scrollWidth - containerRect.width, targetLeft));
      }

      tweenScroll(targetContainer, vars, { duration: duration, ease: ease });
    } else {

      var targetY;
      if (direction === 'down') {
        targetY = window.scrollY + (element.getBoundingClientRect().bottom - window.innerHeight) + offset;
      } else if (direction === 'up') {
        targetY = window.scrollY + element.getBoundingClientRect().top - offset;
      } else {
        targetY = window.scrollY + (element.getBoundingClientRect().bottom - window.innerHeight) + offset;
      }
      targetY = Math.max(0, targetY);




      var root = document.scrollingElement || document.documentElement;
      if (root) tweenScroll(root, { scrollTop: targetY }, { duration: duration, ease: ease });else
      window.scrollTo(0, targetY);
    }
  }


  return {



    init: function () {},


    animateDetailShow: animateDetailShow,
    beginDetailSwap: beginDetailSwap,


    dropDetailShade: dropDetailShade,


    raiseDetailShade: raiseDetailShade,
    animateDetailHide: animateDetailHide,
    ensureDetailVisible: ensureDetailVisible,
    detailContentReady: detailContentReady,
    showDetailLoading: showDetailLoading,
    hideDetailLoading: hideDetailLoading,


    fadeIn: fadeIn,
    fadeOut: fadeOut,
    resetFade: resetFade,
    UI_FADE: UI_FADE,
    animateControlsShow: animateControlsShow,
    animateControlsHide: animateControlsHide,
    isElementInView: isElementInView,
    scrollToIfNotVisible: scrollToIfNotVisible,
    tweenScroll: tweenScroll,


    isScrollTweening: isScrollTweening,
    stopScrollTween: stopScrollTween,


    config: config
  };
}();


if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () {
    Animations.init();
  });
} else {
  Animations.init();
}


window.Animations = Animations;
