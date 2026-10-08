'use strict';
// Layout only: the original article, TXT text node, and stored ratios stay intact.
(() => {
  const defaults = {
    fontSize: 20, lineHeight: 1.9, padding: 22, verticalPadding: 24,
    dark: true, wrap: 'word', viewMode: 'page', pageEffect: 'none'
  };
  let settings = { ...defaults };
  let reader, viewport, face, clip, stage;
  let active = false;
  let anchorRatio = 0;
  let pageIndex = 0;
  let pageCount = 1;
  let pageWidth = 0;
  let pageHeight = 0;
  let reflowFrame = 0;
  let scrollFrame = 0;
  let nativeTarget = null;
  let gesture = null;
  let animation = null;
  let animationTimer = 0;
  let animationToken = 0;
  let transitioning = false;
  let observersStarted = false;
  const listeners = new Set();
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  function number(value, min, max, fallback) {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(min, Math.min(max, value)) : fallback;
  }
  function ratio(value) { return number(value, 0, 1, 0); }
  function normalize(value) {
    const input = value && typeof value === 'object' ? value : {};
    return {
      fontSize: number(input.fontSize, 14, 34, settings.fontSize),
      lineHeight: number(input.lineHeight, 1.4, 2.4, settings.lineHeight),
      padding: number(input.padding, 0, 120, settings.padding),
      verticalPadding: number(input.verticalPadding, 0, 120, settings.verticalPadding),
      dark: typeof input.dark === 'boolean' ? input.dark : settings.dark,
      wrap: ['word', 'character'].includes(input.wrap) ? input.wrap : settings.wrap,
      viewMode: ['page', 'scroll'].includes(input.viewMode) ? input.viewMode : settings.viewMode,
      pageEffect: ['none', 'slide', 'curl'].includes(input.pageEffect) ? input.pageEffect : settings.pageEffect
    };
  }
  function nativeRatio() {
    const maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    return maximum ? ratio(window.scrollY / maximum) : 0;
  }
  function getRatio() {
    if (active && settings.viewMode === 'scroll') anchorRatio = nativeRatio();
    return anchorRatio;
  }
  function getState() {
    return {
      active, mode: settings.viewMode, viewMode: settings.viewMode,
      effect: settings.pageEffect, pageEffect: settings.pageEffect,
      settings: { ...settings }, ratio: getRatio(), pageIndex,
      page: pageIndex + 1, pageNumber: pageIndex + 1, pageCount,
      pageWidth, pageHeight, transitioning,
      canPrevious: pageIndex > 0, canNext: pageIndex < pageCount - 1
    };
  }
  function changed() {
    const state = getState();
    for (const callback of listeners) {
      try { callback(state); } catch { /* A UI callback must not break reading. */ }
    }
  }

  function installStyles() {
    if (document.getElementById('textview-reader-layout-style')) return;
    const style = document.createElement('style');
    style.id = 'textview-reader-layout-style';
    style.textContent = `
      .reader-viewport, .reader-page-face, .reader-page-clip, .reader-page-stage { display: contents; }
      .reader-viewport #reader[hidden] { display: none !important; }
      html.reader-paged-root { height: 100%; overflow: hidden; overscroll-behavior: none; }
      body.reader-paged { height: 100dvh; min-height: 0; overflow: hidden; overscroll-behavior: none; }
      body.reader-paged .reader-shell {
        width: 100% !important; max-width: none !important; height: 100dvh;
        min-height: 0 !important; margin: 0 !important; padding: 0 !important; overflow: hidden;
      }
      .reader-viewport.reader-page-mode {
        display: block; position: fixed; top: var(--tv-page-top, 0px); left: 50%;
        width: min(100%, var(--reader-width, 760px)); height: var(--tv-viewport-height, 100dvh);
        transform: translateX(-50%); margin: 0; overflow: hidden;
        background: var(--bg); perspective: 1400px; isolation: isolate;
        touch-action: pan-y pinch-zoom;
      }
      .reader-viewport.reader-page-mode .reader-page-face {
        display: block; position: relative; width: 100%; height: 100%; box-sizing: border-box;
        padding: var(--tv-vertical-padding, 24px)
          max(var(--tv-horizontal-padding, 22px), env(safe-area-inset-right))
          var(--tv-vertical-padding, 24px)
          max(var(--tv-horizontal-padding, 22px), env(safe-area-inset-left));
        background: var(--bg); backface-visibility: hidden;
      }
      .reader-viewport.reader-page-mode .reader-page-clip {
        display: block; position: relative; width: 100%; height: 100%; min-width: 0;
        overflow: hidden; -webkit-user-select: text; user-select: text;
      }
      .reader-viewport.reader-page-mode .reader-page-stage {
        display: block; position: relative; width: var(--tv-content-width); height: var(--tv-content-height);
        margin: 0; padding: 0; transform: translateX(0); transform-origin: left top;
      }
      .reader-viewport.reader-page-mode #reader.reader-page-content {
        display: block; width: var(--tv-content-width) !important; min-width: 0 !important;
        max-width: none !important; height: var(--tv-content-height) !important;
        min-height: 0 !important; max-height: none !important; margin: 0 !important; padding: 0 !important;
        border: 0; column-width: var(--tv-content-width); column-count: auto;
        column-gap: var(--tv-column-gap); column-fill: auto; overflow: visible;
        white-space: pre-wrap; -webkit-user-select: text; user-select: text;
      }
      .reader-viewport.reader-page-mode[data-wrap="word"] #reader { word-break: keep-all; overflow-wrap: anywhere; }
      .reader-viewport.reader-page-mode[data-wrap="character"] #reader { word-break: break-all; overflow-wrap: anywhere; }
      @media (prefers-reduced-motion: reduce) {
        .reader-viewport.reader-page-mode .reader-page-stage,
        .reader-viewport.reader-page-mode .reader-page-face { animation: none !important; transition: none !important; }
      }
    `;
    document.head.appendChild(style);
  }
  function ensureElements() {
    if (reader?.isConnected && viewport?.isConnected) return true;
    reader = document.getElementById('reader');
    if (!reader || !reader.parentNode) return false;
    installStyles();
    viewport = document.createElement('div');
    viewport.className = 'reader-viewport';
    face = document.createElement('div');
    face.className = 'reader-page-face';
    clip = document.createElement('div');
    clip.className = 'reader-page-clip';
    stage = document.createElement('div');
    stage.className = 'reader-page-stage';
    reader.parentNode.insertBefore(viewport, reader);
    viewport.appendChild(face);
    face.appendChild(clip);
    clip.appendChild(stage);
    stage.appendChild(reader);
    viewport.addEventListener('touchstart', touchStart, { passive: true });
    viewport.addEventListener('touchmove', touchMove, { passive: false });
    viewport.addEventListener('touchend', touchEnd, { passive: true });
    viewport.addEventListener('touchcancel', () => { gesture = null; }, { passive: true });
    startObservers();
    return true;
  }
  function applyMode() {
    const paged = active && settings.viewMode === 'page';
    document.body.classList.toggle('reader-paged', paged);
    document.documentElement.classList.toggle('reader-paged-root', paged);
    viewport.classList.toggle('reader-page-mode', paged);
    viewport.classList.toggle('reader-scroll-mode', active && !paged);
    viewport.dataset.viewMode = settings.viewMode;
    viewport.dataset.wrap = settings.wrap;
    reader.classList.toggle('reader-page-content', paged);
    if (!paged) stage.style.removeProperty('transform');
  }
  function measuredHeight(selector) {
    const element = document.querySelector(selector);
    if (!element || element.hidden || getComputedStyle(element).display === 'none') return 0;
    // The bars can be translated off screen. Their reserved height is unchanged.
    return Math.max(0, element.getBoundingClientRect().height);
  }
  function placePage(index) {
    stage.style.transform = `translateX(${-index * pageWidth}px)`;
  }
  function restoreNative(value) {
    const maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo(0, maximum * value);
    nativeTarget = window.scrollY;
    anchorRatio = value;
  }
  function cancelEffect() {
    animationToken++;
    if (animation) {
      try { animation.cancel(); } catch { /* An already detached animation is harmless. */ }
      animation = null;
    }
    clearTimeout(animationTimer);
    animationTimer = 0;
    transitioning = false;
    if (face) {
      face.style.removeProperty('transform');
      face.style.removeProperty('transform-origin');
      face.style.removeProperty('box-shadow');
    }
  }

  function reflow(value) {
    const keep = typeof value === 'number' ? ratio(value) : anchorRatio;
    anchorRatio = keep;
    if (reflowFrame) { cancelAnimationFrame(reflowFrame); reflowFrame = 0; }
    if (!ensureElements()) return getState();
    cancelEffect();
    applyMode();
    if (!active) return getState();
    if (settings.viewMode === 'scroll') {
      pageCount = 1;
      pageIndex = 0;
      pageWidth = 0;
      pageHeight = 0;
      restoreNative(keep);
    } else {
      const visual = window.visualViewport;
      const availableHeight = visual?.height || window.innerHeight;
      const offsetTop = visual?.offsetTop || 0;
      // Settings are in the topbar's normal flow, so its rect already includes them.
      const top = measuredHeight('.topbar');
      const bottom = measuredHeight('.bottombar');
      const height = Math.max(1, availableHeight - top - bottom);
      const vertical = Math.min(settings.verticalPadding, Math.max(0, (height - settings.fontSize * settings.lineHeight) / 2));
      viewport.style.setProperty('--tv-page-top', `${offsetTop + top}px`);
      viewport.style.setProperty('--tv-viewport-height', `${height}px`);
      viewport.style.setProperty('--tv-horizontal-padding', `${settings.padding}px`);
      viewport.style.setProperty('--tv-vertical-padding', `${vertical}px`);
      const contentWidth = Math.max(1, clip.getBoundingClientRect().width);
      pageHeight = Math.max(1, clip.getBoundingClientRect().height);
      pageWidth = Math.max(1, viewport.getBoundingClientRect().width);
      const gap = Math.max(0, pageWidth - contentWidth);
      viewport.style.setProperty('--tv-content-width', `${contentWidth}px`);
      viewport.style.setProperty('--tv-content-height', `${pageHeight}px`);
      viewport.style.setProperty('--tv-column-gap', `${gap}px`);
      // scrollWidth is the actual multi-column width; the final page has no trailing gap.
      pageCount = Math.max(1, Math.ceil((reader.scrollWidth + gap - 1) / pageWidth));
      pageIndex = Math.min(pageCount - 1, Math.round(keep * (pageCount - 1)));
      placePage(pageIndex);
      nativeTarget = 0;
      window.scrollTo(0, 0);
    }
    changed();
    return getState();
  }
  function configure(value) {
    const keep = getRatio();
    settings = normalize(value);
    anchorRatio = keep;
    if (ensureElements()) {
      applyMode();
      if (active) return reflow(keep);
    }
    return getState();
  }
  function show() {
    if (!ensureElements()) return getState();
    if (active) anchorRatio = getRatio();
    active = true;
    return reflow(anchorRatio);
  }
  function hide() {
    anchorRatio = getRatio();
    active = false;
    gesture = null;
    if (reflowFrame) { cancelAnimationFrame(reflowFrame); reflowFrame = 0; }
    if (scrollFrame) { cancelAnimationFrame(scrollFrame); scrollFrame = 0; }
    cancelEffect();
    if (ensureElements()) applyMode();
    changed();
    return getState();
  }
  function setRatio(value) {
    anchorRatio = ratio(value);
    if (!active || !ensureElements()) return getState();
    cancelEffect();
    if (settings.viewMode === 'page') {
      pageIndex = Math.min(pageCount - 1, Math.round(anchorRatio * (pageCount - 1)));
      placePage(pageIndex);
    } else restoreNative(anchorRatio);
    // Keep the caller's exact ratio in page mode until the reader turns a page.
    changed();
    return getState();
  }

  function finishEffect(token) {
    if (token !== animationToken) return;
    if (animation) {
      try { animation.cancel(); } catch { /* No layout depends on animation support. */ }
      animation = null;
    }
    clearTimeout(animationTimer);
    animationTimer = 0;
    face.style.removeProperty('transform');
    face.style.removeProperty('transform-origin');
    face.style.removeProperty('box-shadow');
    placePage(pageIndex);
    transitioning = false;
    changed();
  }
  function animatePage(from, to) {
    const effect = reducedMotion?.matches ? 'none' : settings.pageEffect;
    if (effect === 'none' || typeof stage.animate !== 'function') { placePage(to); return; }
    const token = ++animationToken;
    transitioning = true;
    animationTimer = setTimeout(() => finishEffect(token), 650);
    try {
      if (effect === 'slide') {
        placePage(to);
        animation = stage.animate([
          { transform: `translateX(${-from * pageWidth}px)` },
          { transform: `translateX(${-to * pageWidth}px)` }
        ], { duration: 240, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'both' });
        animation.finished.then(() => finishEffect(token), () => finishEffect(token));
      } else {
        const direction = to > from ? -1 : 1;
        face.style.transformOrigin = direction < 0 ? 'left center' : 'right center';
        // Rotate only the visible paper face, without cloning the chapter DOM.
        animation = face.animate([
          { transform: 'rotateY(0deg)', boxShadow: '0 0 0 rgba(0,0,0,0)' },
          { transform: `rotateY(${direction * 88}deg)`, boxShadow: `${-direction * 24}px 0 28px rgba(0,0,0,.36)` }
        ], { duration: 150, easing: 'ease-in', fill: 'forwards' });
        animation.finished.then(() => {
          if (token !== animationToken || !active) return;
          animation.cancel();
          placePage(to);
          try {
            animation = face.animate([
              { transform: `rotateY(${-direction * 88}deg)`, boxShadow: `${direction * 24}px 0 28px rgba(0,0,0,.36)` },
              { transform: 'rotateY(0deg)', boxShadow: '0 0 0 rgba(0,0,0,0)' }
            ], { duration: 190, easing: 'ease-out', fill: 'both' });
            animation.finished.then(() => finishEffect(token), () => finishEffect(token));
          } catch { finishEffect(token); }
        }, () => finishEffect(token));
      }
    } catch { finishEffect(token); }
  }
  function page(delta) {
    if (!active || settings.viewMode !== 'page' || transitioning || !ensureElements()) return false;
    const step = Number.isFinite(delta) ? Math.trunc(delta) : 0;
    if (!step) return false;
    const next = Math.max(0, Math.min(pageCount - 1, pageIndex + step));
    if (next === pageIndex) return false;
    const previous = pageIndex;
    pageIndex = next;
    anchorRatio = pageCount > 1 ? pageIndex / (pageCount - 1) : 0;
    animatePage(previous, next);
    changed();
    document.dispatchEvent(new CustomEvent('textview:pagechange', { detail: getState() }));
    return true;
  }
  function selectionActive() { return window.getSelection()?.isCollapsed === false; }
  function blockedTarget(target) {
    return !!target?.closest?.('button, a, input, textarea, select, [contenteditable="true"], dialog[open]');
  }
  function canGesture() {
    return active && settings.viewMode === 'page' && !transitioning &&
      !selectionActive() && !document.querySelector('dialog[open]');
  }
  function touchStart(event) {
    gesture = null;
    if (!canGesture() || event.touches.length !== 1 || blockedTarget(event.target)) return;
    const touch = event.touches[0];
    gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, at: performance.now(), horizontal: false };
  }
  function touchMove(event) {
    if (!gesture || event.touches.length !== 1 || !canGesture()) { gesture = null; return; }
    const touch = event.touches[0];
    if (touch.identifier !== gesture.id || performance.now() - gesture.at > 700) { gesture = null; return; }
    const dx = touch.clientX - gesture.x;
    const dy = touch.clientY - gesture.y;
    if (Math.abs(dy) > 24 && Math.abs(dy) > Math.abs(dx)) { gesture = null; return; }
    if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      gesture.horizontal = true;
      if (event.cancelable) event.preventDefault();
    }
  }
  function touchEnd(event) {
    const start = gesture;
    gesture = null;
    if (!start || !canGesture() || event.changedTouches.length !== 1 || performance.now() - start.at > 700) return;
    const touch = event.changedTouches[0];
    if (touch.identifier !== start.id) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5) page(dx < 0 ? 1 : -1);
  }
  function scheduleReflow() {
    if (!active || reflowFrame) return;
    // Do not derive a new ratio after a resize has already changed scrollHeight.
    reflowFrame = requestAnimationFrame(() => { reflowFrame = 0; if (active) reflow(anchorRatio); });
  }
  function startObservers() {
    if (observersStarted) return;
    observersStarted = true;
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(scheduleReflow);
      for (const element of [reader, viewport, document.querySelector('.reader-shell'), document.querySelector('.topbar'), document.querySelector('.bottombar')]) {
        if (element) observer.observe(element);
      }
    }
    new MutationObserver(scheduleReflow).observe(reader, { childList: true, characterData: true, subtree: true });
    document.fonts?.ready.then(scheduleReflow).catch(() => {});
    document.fonts?.addEventListener('loadingdone', scheduleReflow);
  }
  window.addEventListener('scroll', () => {
    if (!active || settings.viewMode !== 'scroll' || reflowFrame) return;
    if (nativeTarget !== null && Math.abs(window.scrollY - nativeTarget) <= 1) { nativeTarget = null; return; }
    nativeTarget = null;
    anchorRatio = nativeRatio();
    if (!scrollFrame) scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      if (active && settings.viewMode === 'scroll') changed();
    });
  }, { passive: true });
  window.addEventListener('resize', scheduleReflow, { passive: true });
  window.visualViewport?.addEventListener('resize', scheduleReflow, { passive: true });
  window.addEventListener('keydown', event => {
    if (!canGesture() || blockedTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const delta = ['ArrowRight', 'PageDown'].includes(event.key) ? 1 : ['ArrowLeft', 'PageUp'].includes(event.key) ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    page(delta);
  }, true);
  reducedMotion?.addEventListener?.('change', () => {
    if (reducedMotion.matches && transitioning) {
      cancelEffect();
      if (active && settings.viewMode === 'page') placePage(pageIndex);
      changed();
    }
  });

  window.TextviewReaderLayout = {
    configure, show, hide, getRatio, setRatio, reflow, page, getState,
    onChange(callback) {
      if (typeof callback !== 'function') return () => {};
      listeners.add(callback);
      try { callback(getState()); } catch { /* UI initialization is isolated. */ }
      return () => listeners.delete(callback);
    }
  };
  ensureElements();
})();
