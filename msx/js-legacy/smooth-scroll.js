/* Сборка для старых браузеров (Chrome 53) из js/smooth-scroll.js — tools/legacy-build/build.js. Руками не править. */
var SmoothScroll = function () {
  'use strict';
  var config = {
    enabled: true,
    duration: 0.4,
    easing: "power2.out",
    wheelMultiplier: 1,
    touchMultiplier: 1.2,
    maxScrollSpeed: 800,
    minScrollDelta: 10,
    passiveEvents: true,
    performanceMode: true
  };
  var activeScrollers = new Map();
  var wheelHandlerAttached = false;
  var performanceCheck = null;
  var lowPerformanceMode = false;
  function checkPerformance() {
    if (!config.performanceMode) return;
    var frames = 0;
    var lastTime = performance.now();
    function testFrame() {
      frames++;
      var now = performance.now();
      if (now - lastTime >= 1000) {
        var fps = frames;
        lowPerformanceMode = fps < 30;
        if (lowPerformanceMode) {
          config.duration = 0.25;
          config.easing = "linear";
          console.log('📱 Низкая производительность, уменьшена длительность анимаций');
        }
        return;
      }
      requestAnimationFrame(testFrame);
    }
    requestAnimationFrame(testFrame);
  }
  function getScrollableElement(target) {
    if (!target || target === document.body || target === document.documentElement) {
      return window;
    }
    var style = window.getComputedStyle(target);
    var overflowY = style.overflowY;
    var canScroll = (overflowY === 'auto' || overflowY === 'scroll') && target.scrollHeight > target.clientHeight;
    if (canScroll) return target;
    return getScrollableElement(target.parentElement);
  }
  function killScrollAnimation(element) {
    var scroller = activeScrollers.get(element);
    if (scroller && scroller.animation) {
      scroller.animation.kill();
      scroller.animation = null;
    }
    if (scroller) {
      scroller.animating = false;
    }
  }
  function smoothScrollTo(element, targetScrollTop, onComplete) {
    if (!element) return;
    var scrollElement = element === window ? document.documentElement : element;
    var currentScroll = element === window ? window.scrollY : element.scrollTop;
    var delta = targetScrollTop - currentScroll;
    if (Math.abs(delta) < config.minScrollDelta) {
      if (onComplete) onComplete();
      return;
    }
    var maxDelta = config.maxScrollSpeed * config.duration;
    if (Math.abs(delta) > maxDelta) {
      targetScrollTop = currentScroll + (delta > 0 ? maxDelta : -maxDelta);
    }
    var maxScroll = element === window ? document.documentElement.scrollHeight - window.innerHeight : element.scrollHeight - element.clientHeight;
    targetScrollTop = Math.max(0, Math.min(targetScrollTop, maxScroll));
    killScrollAnimation(element);
    if (lowPerformanceMode && Math.abs(delta) > 200) {
      if (element === window) {
        window.scrollTo(0, targetScrollTop);
      } else {
        element.scrollTop = targetScrollTop;
      }
      if (onComplete) onComplete();
      return;
    }
    var animation = gsap.to(scrollElement, {
      scrollTop: targetScrollTop,
      duration: config.duration,
      ease: config.easing,
      overwrite: true,
      onUpdate: function () {
        if (element === window) {
          window.scrollTo(0, scrollElement.scrollTop);
        }
      },
      onComplete: function () {
        var scroller = activeScrollers.get(element);
        if (scroller) {
          scroller.animating = false;
          scroller.animation = null;
        }
        if (onComplete) onComplete();
      }
    });
    activeScrollers.set(element, {
      animation: animation,
      animating: true
    });
  }
  function onWheel(e) {
    if (!config.enabled) return;
    var target = e.target;
    var scrollable = getScrollableElement(target);
    var deltaY = e.deltaY;
    if (e.deltaMode === 1) {
      deltaY *= 30;
    } else if (e.deltaMode === 2) {
      deltaY *= scrollable === window ? window.innerHeight : scrollable.clientHeight;
    }
    deltaY *= config.wheelMultiplier;
    if (Math.abs(deltaY) < config.minScrollDelta) return;
    var currentScroll = scrollable === window ? window.scrollY : scrollable.scrollTop;
    var targetScroll = currentScroll + deltaY;
    var maxScroll = scrollable === window ? document.documentElement.scrollHeight - window.innerHeight : scrollable.scrollHeight - scrollable.clientHeight;
    targetScroll = Math.max(0, Math.min(targetScroll, maxScroll));
    smoothScrollTo(scrollable, targetScroll);
    if (e.cancelable) {
      e.preventDefault();
    }
  }
  var touchStartY = 0;
  var touchStartTime = 0;
  var touchVelocity = 0;
  var touchScrolling = false;
  var touchScrollable = null;
  function onTouchStart(e) {
    if (!config.enabled) return;
    var touch = e.touches[0];
    touchStartY = touch.clientY;
    touchStartTime = Date.now();
    touchVelocity = 0;
    var target = e.target;
    touchScrollable = getScrollableElement(target);
    killScrollAnimation(touchScrollable);
  }
  function onTouchMove(e) {
    if (!config.enabled || !touchScrollable) return;
    var touch = e.touches[0];
    var deltaY = (touchStartY - touch.clientY) * config.touchMultiplier;
    if (Math.abs(deltaY) < 5) return;
    touchScrolling = true;
    var now = Date.now();
    var timeDelta = Math.max(16, now - touchStartTime);
    touchVelocity = deltaY / timeDelta;
    var currentScroll = touchScrollable === window ? window.scrollY : touchScrollable.scrollTop;
    var targetScroll = currentScroll + deltaY;
    var maxScroll = touchScrollable === window ? document.documentElement.scrollHeight - window.innerHeight : touchScrollable.scrollHeight - touchScrollable.clientHeight;
    targetScroll = Math.max(0, Math.min(targetScroll, maxScroll));
    if (touchScrollable === window) {
      window.scrollTo(0, targetScroll);
    } else {
      touchScrollable.scrollTop = targetScroll;
    }
    touchStartY = touch.clientY;
    touchStartTime = now;
    if (e.cancelable) {
      e.preventDefault();
    }
  }
  function onTouchEnd(e) {
    if (!config.enabled || !touchScrolling) {
      touchScrolling = false;
      return;
    }
    touchScrolling = false;
    var velocity = Math.min(3, Math.abs(touchVelocity)) * 800;
    if (velocity > 50 && touchScrollable) {
      var currentScroll = touchScrollable === window ? window.scrollY : touchScrollable.scrollTop;
      var direction = touchVelocity > 0 ? 1 : -1;
      var targetScroll = currentScroll + velocity * direction;
      var maxScroll = touchScrollable === window ? document.documentElement.scrollHeight - window.innerHeight : touchScrollable.scrollHeight - touchScrollable.clientHeight;
      targetScroll = Math.max(0, Math.min(targetScroll, maxScroll));
      smoothScrollTo(touchScrollable, targetScroll);
    }
    touchScrollable = null;
    touchVelocity = 0;
  }
  function initScrollForElement(element) {
    if (!element || element._smoothScrollInited) return;
    element._smoothScrollInited = true;
    if (element.classList && (element.classList.contains('files-list') || element.classList.contains('catalog-detail-actors-grid') || element.classList.contains('catalog-detail-recommendations-grid'))) {
      initHorizontalScroll(element);
    }
  }
  function initHorizontalScroll(element) {
    var isHorizontal = true;
    function onWheelHorizontal(e) {
      if (!config.enabled) return;
      var deltaX = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(deltaX) < config.minScrollDelta) return;
      var currentScroll = element.scrollLeft;
      var targetScroll = currentScroll + deltaX;
      var maxScroll = element.scrollWidth - element.clientWidth;
      targetScroll = Math.max(0, Math.min(targetScroll, maxScroll));
      gsap.to(element, {
        scrollLeft: targetScroll,
        duration: lowPerformanceMode ? 0.2 : config.duration,
        ease: lowPerformanceMode ? "linear" : config.easing,
        overwrite: true
      });
      if (e.cancelable) {
        e.preventDefault();
      }
    }
    element.addEventListener('wheel', onWheelHorizontal, {
      passive: false
    });
    element._smoothScrollCleanup = function () {
      element.removeEventListener('wheel', onWheelHorizontal);
    };
  }
  var observer = null;
  function initMutationObserver() {
    if (observer) return;
    observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(function (node) {
          if (node.nodeType === 1) {
            if (node.classList && (node.classList.contains('files-list') || node.classList.contains('catalog-detail-actors') || node.classList.contains('catalog-detail-recommendations') || node.classList.contains('catalog-detail-trailers'))) {
              initScrollForElement(node);
            }
            var children = node.querySelectorAll('.files-list, .catalog-detail-actors-grid, .catalog-detail-recommendations-grid');
            children.forEach(initScrollForElement);
          }
        });
      });
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
  function refresh() {
    var containers = document.querySelectorAll('.files-list, ' + '.catalog-detail-actors-grid, ' + '.catalog-detail-recommendations-grid, ' + '#detail-view, ' + '#main-container, ' + '#search-results, ' + '#torrents-grid');
    containers.forEach(initScrollForElement);
  }
  function enable() {
    config.enabled = true;
    if (!wheelHandlerAttached) {
      window.addEventListener('wheel', onWheel, {
        passive: false
      });
      window.addEventListener('touchstart', onTouchStart, {
        passive: false
      });
      window.addEventListener('touchmove', onTouchMove, {
        passive: false
      });
      window.addEventListener('touchend', onTouchEnd);
      wheelHandlerAttached = true;
    }
  }
  function disable() {
    config.enabled = false;
    if (wheelHandlerAttached) {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      wheelHandlerAttached = false;
    }
    activeScrollers.forEach(function (scroller, element) {
      killScrollAnimation(element);
    });
    activeScrollers.clear();
  }
  function setConfig(newConfig) {
    Object.assign(config, newConfig);
    if (lowPerformanceMode) {
      config.duration = 0.25;
      config.easing = "linear";
    }
  }
  function init() {
    checkPerformance();
    enable();
    initMutationObserver();
    setTimeout(refresh, 500);
    console.log('✨ Плавный скролл инициализирован' + (lowPerformanceMode ? ' (режим производительности)' : ''));
  }
  return {
    init: init,
    enable: enable,
    disable: disable,
    refresh: refresh,
    setConfig: setConfig,
    smoothScrollTo: smoothScrollTo,
    isLowPerformance: function () {
      return lowPerformanceMode;
    }
  };
}();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () {
    SmoothScroll.init();
  });
} else {
  SmoothScroll.init();
}
window.SmoothScroll = SmoothScroll;
