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
  let stageOffset = 0;
  let reflowFrame = 0;
  let scrollFrame = 0;
  let nativeTarget = null;
  let gesture = null;
  let observersStarted = false;
  let anchorText = null;
  let anchorOffset = null;
  const listeners = new Set();

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
      pageEffect: 'none'
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
      pageWidth, pageHeight, transitioning: false,
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
        background: var(--bg); isolation: isolate;
        touch-action: pan-y pinch-zoom;
      }
      .reader-viewport.reader-page-mode .reader-page-face {
        display: block; position: relative; width: 100%; height: 100%; box-sizing: border-box;
        padding: max(var(--tv-vertical-padding, 24px), var(--tv-safe-top, 0px))
          max(var(--tv-horizontal-padding, 22px), env(safe-area-inset-right))
          max(var(--tv-vertical-padding, 24px), var(--tv-safe-bottom, 0px))
          max(var(--tv-horizontal-padding, 22px), env(safe-area-inset-left));
        background: var(--bg);
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
    if (!paged) {
      stageOffset = 0;
      stage.style.removeProperty('transform');
    }
  }
  function measuredHeight(selector) {
    const element = document.querySelector(selector);
    if (!element || element.hidden) return 0;
    const visibleClass = selector === '.topbar' ? 'show-topbar' : 'show-bottombar';
    // A visibility transition can remain "visible" while a bar moves off
    // screen. Use the requested state so text expands on the same toggle.
    const reading = document.body.classList.contains('reading');
    if (reading &&
        !document.body.classList.contains('settingsOpen') &&
        !document.body.classList.contains(visibleClass)) return 0;
    const style = getComputedStyle(element);
    if (style.display === 'none' || (!reading && style.visibility === 'hidden')) return 0;
    return Math.max(0, element.getBoundingClientRect().height);
  }
  function textNode() {
    return reader?.firstChild?.nodeType === Node.TEXT_NODE ? reader.firstChild : null;
  }
  function characterPage(node, offset) {
    if (!node?.length || !pageWidth) return 0;
    const index = Math.min(node.length - 1, Math.max(0, offset));
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    const rect = Array.from(range.getClientRects()).find(item => item.height > 0);
    if (!rect) return null;
    // Column rects include the stage's current translation, even outside the clip.
    const x = rect.left - clip.getBoundingClientRect().left - stageOffset;
    return Math.max(0, Math.min(pageCount - 1, Math.floor((x + 1) / pageWidth)));
  }
  function rememberPageStart() {
    const node = textNode();
    anchorText = node;
    anchorOffset = null;
    if (!node?.length) return;
    let low = 0, high = node.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const column = characterPage(node, mid);
      if (column === null) return;
      if (column < pageIndex) low = mid + 1;
      else high = mid;
    }
    anchorOffset = Math.min(low, node.length - 1);
  }
  function placePage(index) {
    stageOffset = -index * pageWidth;
    stage.style.transform = `translateX(${stageOffset}px)`;
  }
  function restoreNative(value) {
    const maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo(0, maximum * value);
    nativeTarget = window.scrollY;
    anchorRatio = value;
  }
  function reflow(value) {
    const keep = typeof value === 'number' ? ratio(value) : anchorRatio;
    const preserveCharacter = active && settings.viewMode === 'page' &&
      anchorText === textNode() && anchorOffset !== null && Math.abs(keep - anchorRatio) < 1e-8;
    anchorRatio = keep;
    if (reflowFrame) { cancelAnimationFrame(reflowFrame); reflowFrame = 0; }
    if (!ensureElements()) return getState();
    applyMode();
    if (!active) return getState();
    if (settings.viewMode === 'scroll') {
      pageCount = 1;
      pageIndex = 0;
      pageWidth = 0;
      pageHeight = 0;
      anchorText = null;
      anchorOffset = null;
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
      viewport.style.setProperty('--tv-safe-top', top ? '0px' : 'env(safe-area-inset-top)');
      viewport.style.setProperty('--tv-safe-bottom', bottom ? '0px' : 'env(safe-area-inset-bottom)');
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
      // Read the saved character's new column before moving the stage.
      const anchoredPage = preserveCharacter ? characterPage(anchorText, anchorOffset) : null;
      pageIndex = Math.min(pageCount - 1, Math.round(keep * (pageCount - 1)));
      if (anchoredPage !== null) pageIndex = anchoredPage;
      placePage(pageIndex);
      if (!preserveCharacter || anchoredPage === null) rememberPageStart();
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
    if (ensureElements()) applyMode();
    changed();
    return getState();
  }
  function setRatio(value) {
    const nextRatio = ratio(value);
    const keepCharacter = active && settings.viewMode === 'page' &&
      anchorText === textNode() && anchorOffset !== null && Math.abs(nextRatio - anchorRatio) < 1e-8;
    anchorRatio = nextRatio;
    if (!active || !ensureElements()) return getState();
    if (settings.viewMode === 'page') {
      // app.js reapplies the same stored ratio after settings reflow. Do not
      // discard the character we just preserved by remapping that ratio again.
      if (!keepCharacter) {
        pageIndex = Math.min(pageCount - 1, Math.round(anchorRatio * (pageCount - 1)));
        placePage(pageIndex);
        rememberPageStart();
      }
    } else restoreNative(anchorRatio);
    // Keep the caller's exact ratio in page mode until the reader turns a page.
    changed();
    return getState();
  }

  function page(delta) {
    if (!active || settings.viewMode !== 'page' || !ensureElements()) return false;
    const step = Number.isFinite(delta) ? Math.trunc(delta) : 0;
    if (!step) return false;
    const next = Math.max(0, Math.min(pageCount - 1, pageIndex + step));
    if (next === pageIndex) return false;
    pageIndex = next;
    anchorRatio = pageCount > 1 ? pageIndex / (pageCount - 1) : 0;
    placePage(next);
    rememberPageStart();
    changed();
    document.dispatchEvent(new CustomEvent('textview:pagechange', { detail: getState() }));
    return true;
  }
  function selectionActive() { return window.getSelection()?.isCollapsed === false; }
  function blockedTarget(target) {
    return !!target?.closest?.('button, a, input, textarea, select, [contenteditable="true"], dialog[open]');
  }
  function canGesture() {
    return active && settings.viewMode === 'page' &&
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
