/* Offline JPG/PNG reader. No TXT state or document content is shared. */
(() => {
  'use strict';
  const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const backIcon = svg('<path d="m15 5-7 7 7 7"/>');
  const nextIcon = svg('<path d="m9 5 7 7-7 7"/>');
  const gearIcon = svg('<path d="m9.5 2-.7 2.6-2 .9-2.4-.7-2 3.4 1.8 1.9-.2 2.4-1.7 1.8 2 3.5 2.5-.6 2 1 .7 2.5h4l.7-2.5 2-1 2.5.6 2-3.5-1.7-1.8-.2-2.4 1.8-1.9-2-3.4-2.4.7-2-.9L13.5 2Z"/><circle cx="11.5" cy="11.5" r="3"/>');
  const root = document.createElement('section');
  root.id = 'comicReader';
  root.hidden = true;
  root.tabIndex = -1;
  root.setAttribute('aria-label', '만화 읽기');
  root.innerHTML = `
    <button type="button" class="comic-reader-reveal" id="comicReaderReveal">읽기 메뉴 표시</button>
    <div class="comic-reader-viewport" id="comicReaderViewport" data-mode="page" aria-label="만화 이미지"></div>
    <p class="comic-reader-message" id="comicReaderMessage" role="status"></p>
    <header class="comic-reader-header" id="comicReaderHeader">
      <button type="button" id="comicReaderBack" aria-label="작품 상세로 돌아가기">${backIcon}</button>
      <div class="comic-reader-heading"><h1 id="comicReaderVolumeTitle">만화</h1><p id="comicReaderBookTitle"></p></div>
      <button type="button" id="comicReaderSettingsButton" class="comic-reader-settings-button" aria-label="읽기 설정" aria-expanded="false" aria-controls="comicReaderSettings">${gearIcon}</button>
    </header>
    <section id="comicReaderSettings" class="comic-reader-settings" aria-label="읽기 설정" hidden>
      <div class="comic-reader-setting"><span>넘김 방식</span><div class="comic-reader-choices"><button type="button" data-comic-setting="mode" data-value="page" aria-pressed="true">페이지뷰</button><button type="button" data-comic-setting="mode" data-value="scroll" aria-pressed="false">스크롤뷰</button></div></div>
      <div class="comic-reader-setting"><span>읽는 방향</span><div class="comic-reader-choices"><button type="button" data-comic-setting="direction" data-value="ltr" aria-pressed="true">왼쪽 → 오른쪽</button><button type="button" data-comic-setting="direction" data-value="rtl" aria-pressed="false">오른쪽 → 왼쪽</button></div></div>
    </section>
    <footer class="comic-reader-footer">
      <div class="comic-reader-navigation"><button type="button" id="comicReaderPrev" aria-label="이전 페이지">${backIcon}</button><div class="comic-reader-slider-wrap"><input id="comicReaderProgress" type="range" min="1" max="1" value="1" step="1" aria-label="읽을 페이지 이동"><span id="comicReaderPercent" class="comic-reader-percent">0%</span></div><button type="button" id="comicReaderNext" aria-label="다음 페이지">${nextIcon}</button></div>
      <p id="comicReaderPageLabel" class="comic-reader-page-label" aria-live="polite">0 / 0</p>
    </footer>`;
  document.body.appendChild(root);
  const $ = id => document.getElementById(id);
  const viewport = $('comicReaderViewport');
  const message = $('comicReaderMessage');
  const store = () => window.HoyulComicStore;
  const clamp = (value, max) => Math.max(0, Math.min(max, Math.floor(Number(value) || 0)));
  let active = false;
  let generation = 0;
  let viewGeneration = 0;
  let pages = [];
  let volume;
  let volumes = [];
  let book;
  let requestedBookId;
  let requestedVolumeId;
  let navigationPending = false;
  let handlers = {};
  let pageIndex = 0;
  let offset = 0;
  let settings = { mode: 'page', direction: 'ltr' };
  let urls = new Map();
  let pendingURLs = new Map();
  let wanted = new Set();
  let figures = [];
  let saveTimer = 0;
  let saveTail = Promise.resolve();
  let scrollFrame = 0;
  let resizingFrame = 0;
  let lastFocus;
  let lastTap = null;
  let pointer = null;
  let suppressScroll = false;
  let settingsRequest = 0;

  function announceChange() {
    try { handlers.onChange?.({ bookId: book?.id, volumeId: volume?.id, pageIndex, pageCount: pages.length, offset }); }
    catch { /* The caller's home view must not interrupt reading. */ }
  }
  function writePosition() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (!volume || !pages.length) return saveTail;
    const id = volume.id;
    const value = { pageIndex, offset: settings.mode === 'scroll' ? offset : 0 };
    const save = store().saveProgress(id, value).catch(error => { if (active && volume?.id === id) message.textContent = error?.message || '읽던 위치를 저장하지 못했습니다.'; });
    saveTail = Promise.all([saveTail, save]).then(() => undefined);
    return saveTail;
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void writePosition(); }, 180);
  }
  function clearURLs() {
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
    pendingURLs.clear();
    wanted.clear();
  }
  async function pageURL(index) {
    if (urls.has(index)) return urls.get(index);
    if (pendingURLs.has(index)) return pendingURLs.get(index);
    const token = generation;
    const id = pages[index]?.id;
    if (!id) return null;
    const promise = store().getPage(id).then(record => {
      if (!active || generation !== token || !wanted.has(index)) return null;
      if (!(record?.blob instanceof Blob)) throw new Error('저장된 이미지를 찾지 못했습니다. 이 권을 다시 가져와 주세요.');
      const url = URL.createObjectURL(record.blob);
      urls.set(index, url);
      return url;
    }).finally(() => { if (generation === token && pendingURLs.get(index) === promise) pendingURLs.delete(index); });
    pendingURLs.set(index, promise);
    return promise;
  }
  function setWindow(index) {
    wanted = new Set();
    for (let i = Math.max(0, index - 2); i <= Math.min(pages.length - 1, index + 2); i++) wanted.add(i);
    for (const [i, url] of urls) {
      if (!wanted.has(i)) {
        if (figures[i]) figures[i].replaceChildren();
        URL.revokeObjectURL(url);
        urls.delete(i);
      }
    }
  }
  function updateControls() {
    const total = pages.length;
    const volumeIndex = volumes.findIndex(item => item.id === volume?.id);
    const ratio = total ? (pageIndex + (settings.mode === 'scroll' ? offset : 1)) / total : 0;
    const slider = $('comicReaderProgress');
    slider.max = String(Math.max(1, total));
    slider.value = String(pageIndex + 1);
    slider.style.setProperty('--comic-progress', (total > 1 ? pageIndex / (total - 1) : 0) * 100 + '%');
    slider.setAttribute('aria-valuetext', `${total ? pageIndex + 1 : 0} / ${total}페이지`);
    $('comicReaderPrev').disabled = navigationPending || !total || (pageIndex === 0 && volumeIndex <= 0);
    $('comicReaderNext').disabled = navigationPending || !total || (pageIndex >= total - 1 && volumeIndex >= volumes.length - 1);
    $('comicReaderPrev').setAttribute('aria-label', pageIndex === 0 && volumeIndex > 0 ? '이전 권' : '이전 페이지');
    $('comicReaderNext').setAttribute('aria-label', pageIndex >= total - 1 && volumeIndex >= 0 && volumeIndex < volumes.length - 1 ? '다음 권' : '다음 페이지');
    slider.disabled = navigationPending || !total;
    $('comicReaderPercent').textContent = Math.round(ratio * 100) + '%';
    $('comicReaderPageLabel').textContent = `${total ? pageIndex + 1 : 0} / ${total}`;
    $('comicReaderPrev').innerHTML = settings.direction === 'rtl' ? nextIcon : backIcon;
    $('comicReaderNext').innerHTML = settings.direction === 'rtl' ? backIcon : nextIcon;
    for (const button of root.querySelectorAll('[data-comic-setting]')) button.setAttribute('aria-pressed', String(settings[button.dataset.comicSetting] === button.dataset.value));
  }
  function imageNode(index, url) {
    const image = document.createElement('img');
    image.alt = `${volume?.title || '만화'} ${index + 1}페이지`;
    image.draggable = false;
    image.decoding = 'async';
    image.src = url;
    return image;
  }
  async function renderPage() {
    const token = ++viewGeneration;
    const index = pageIndex;
    setWindow(index);
    const cached = urls.get(index);
    const image = cached ? imageNode(index, cached) : document.createElement('img');
    image.className = 'comic-reader-page';
    image.alt = `${volume?.title || '만화'} ${index + 1}페이지`;
    viewport.replaceChildren(image);
    message.textContent = cached ? '' : '이미지를 여는 중…';
    try {
      const url = await pageURL(index);
      if (!active || token !== viewGeneration || settings.mode !== 'page') return;
      if (!url) throw new Error('이미지를 열지 못했습니다. 다시 페이지를 이동해 주세요.');
      image.onerror = () => { if (active && token === viewGeneration) message.textContent = '이미지를 표시하지 못했습니다. 이 권을 다시 가져와 주세요.'; };
      image.src = url;
      message.textContent = '';
      for (const nearby of wanted) if (nearby !== index) void pageURL(nearby).catch(() => {});
    } catch (error) { if (active && token === viewGeneration) message.textContent = error?.message || '이미지를 열지 못했습니다.'; }
  }
  function sizeFigures() {
    const width = Math.min(1000, viewport.clientWidth);
    for (let index = 0; index < figures.length; index++) {
      const page = pages[index];
      figures[index].style.height = Math.max(1, width * page.height / page.width) + 'px';
    }
  }
  async function renderScrollWindow() {
    const token = viewGeneration;
    setWindow(pageIndex);
    const wantedNow = [...wanted];
    await Promise.all(wantedNow.map(async index => {
      try {
        const url = await pageURL(index);
        if (!active || settings.mode !== 'scroll' || token !== viewGeneration || !wanted.has(index) || !url) return;
        const figure = figures[index];
        if (!figure?.firstElementChild) figure?.appendChild(imageNode(index, url));
        if (figure) delete figure.dataset.error;
      } catch (error) {
        if (active && token === viewGeneration && figures[index]) figures[index].dataset.error = 'true';
      }
    }));
  }
  function restoreScroll() {
    const figure = figures[pageIndex];
    if (!figure) return;
    suppressScroll = true;
    viewport.scrollTop = figure.offsetTop + figure.offsetHeight * offset;
    requestAnimationFrame(() => { suppressScroll = false; });
  }
  function renderViewport() {
    ++viewGeneration;
    viewport.dataset.mode = settings.mode;
    message.textContent = '';
    figures = [];
    if (settings.mode === 'page') { void renderPage(); return; }
    const wrapper = document.createElement('div');
    wrapper.className = 'comic-reader-scroll-pages';
    figures = pages.map((page, index) => {
      const figure = document.createElement('figure');
      figure.className = 'comic-reader-scroll-page';
      figure.dataset.pageIndex = String(index);
      figure.setAttribute('aria-label', `${index + 1}페이지`);
      return figure;
    });
    wrapper.append(...figures);
    viewport.replaceChildren(wrapper);
    sizeFigures();
    restoreScroll();
    void renderScrollWindow();
  }
  function scrollPosition() {
    if (!figures.length) return;
    const top = viewport.scrollTop + 1;
    let lo = 0;
    let hi = figures.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (figures[mid].offsetTop + figures[mid].offsetHeight <= top) lo = mid + 1;
      else hi = mid;
    }
    pageIndex = lo;
    offset = Math.max(0, Math.min(1, (viewport.scrollTop - figures[lo].offsetTop) / Math.max(1, figures[lo].offsetHeight)));
  }
  function moveTo(index) {
    if (!active || navigationPending || !pages.length) return;
    const next = clamp(index, pages.length - 1);
    if (next === pageIndex && settings.mode === 'page') return;
    pageIndex = next;
    offset = 0;
    if (settings.mode === 'scroll') { restoreScroll(); void renderScrollWindow(); }
    else void renderPage();
    updateControls();
    announceChange();
    scheduleSave();
  }
  async function navigate(delta) {
    if (!active || navigationPending || !pages.length || !volume || !book) return;
    const index = pageIndex + delta;
    if (index >= 0 && index < pages.length) { moveTo(index); return; }
    const volumeIndex = volumes.findIndex(item => item.id === volume.id);
    const target = volumes[volumeIndex + (delta < 0 ? -1 : 1)];
    if (!target) return;
    const callbacks = handlers;
    const barsWereVisible = root.classList.contains('has-bars');
    const targetBookId = book.id;
    const targetVolumeId = target.id;
    await show({ bookId: targetBookId, volumeId: targetVolumeId, pageIndex: delta < 0 ? Math.max(0, target.pageCount - 1) : 0 }, callbacks);
    if (active && volume?.id === targetVolumeId) setBars(barsWereVisible);
  }
  function closeSettings() {
    $('comicReaderSettings').hidden = true;
    $('comicReaderSettingsButton').setAttribute('aria-expanded', 'false');
  }
  function setBars(visible) {
    root.classList.toggle('has-bars', visible);
    $('comicReaderReveal').setAttribute('aria-expanded', String(visible));
    if (!visible) {
      closeSettings();
      if (root.querySelector('.comic-reader-header')?.contains(document.activeElement) || root.querySelector('.comic-reader-footer')?.contains(document.activeElement)) document.activeElement.blur();
    }
    root.style.setProperty('--comic-header-height', $('comicReaderHeader').getBoundingClientRect().height + 'px');
  }
  async function changeSettings(key, value) {
    if (!active || !['mode', 'direction'].includes(key)) return;
    if (settings.mode === 'scroll') scrollPosition();
    const token = ++settingsRequest;
    const oldMode = settings.mode;
    settings = { ...settings, [key]: value };
    if (settings.mode === 'page') offset = 0;
    if (oldMode !== settings.mode) renderViewport();
    updateControls();
    announceChange();
    scheduleSave();
    try { await store().saveSettings(settings); }
    catch { if (active && token === settingsRequest) message.textContent = '읽기 설정을 저장하지 못했습니다.'; }
  }
  async function show({ bookId, volumeId, pageIndex: requestedPage } = {}, callbacks = {}) {
    const previousSave = hide();
    const token = generation;
    handlers = callbacks;
    requestedBookId = bookId;
    requestedVolumeId = volumeId;
    navigationPending = true;
    lastFocus = document.activeElement;
    root.hidden = false;
    active = true;
    document.body.classList.add('comic-reader-active');
    viewport.replaceChildren();
    message.textContent = '작품을 열고 있습니다…';
    setBars(false);
    updateControls();
    try {
      // Complete the old location write before reading progress for the new view.
      // Another show()/hide() invalidates this generation while that write waits.
      await previousSave;
      if (!active || token !== generation) return;
      const [allBooks, allVolumes, images, progress, savedSettings] = await Promise.all([store().listBooks(), store().listVolumes(bookId), store().listPages(volumeId), store().getProgress(volumeId), store().getSettings()]);
      if (!active || token !== generation) return;
      book = allBooks.find(item => item.id === bookId);
      volumes = allVolumes;
      volume = allVolumes.find(item => item.id === volumeId);
      if (!book || !volume || !images.length) throw new Error('저장된 작품을 찾지 못했습니다. 보관함에서 다시 열어 주세요.');
      pages = images;
      settings = { mode: savedSettings.mode === 'scroll' ? 'scroll' : 'page', direction: savedSettings.direction === 'rtl' ? 'rtl' : 'ltr' };
      pageIndex = clamp(requestedPage === undefined ? progress.pageIndex : requestedPage, pages.length - 1);
      offset = requestedPage === undefined && settings.mode === 'scroll' ? Math.max(0, Math.min(1, Number(progress.offset) || 0)) : 0;
      $('comicReaderVolumeTitle').textContent = volume.title;
      $('comicReaderBookTitle').textContent = book.title;
      root.setAttribute('aria-label', `${book.title} 만화 읽기`);
      navigationPending = false;
      renderViewport();
      updateControls();
      root.focus({ preventScroll: true });
      announceChange();
      scheduleSave();
    } catch (error) {
      if (active && token === generation) { message.textContent = error?.message || '작품을 열지 못했습니다.'; setBars(true); }
    } finally {
      if (active && token === generation) { navigationPending = false; updateControls(); }
    }
  }
  function hide() {
    if (active && settings.mode === 'scroll') scrollPosition();
    const saved = active ? writePosition() : saveTail;
    active = false;
    ++generation;
    ++viewGeneration;
    ++settingsRequest;
    clearTimeout(saveTimer);
    cancelAnimationFrame(scrollFrame);
    cancelAnimationFrame(resizingFrame);
    scrollFrame = resizingFrame = saveTimer = 0;
    root.hidden = true;
    document.body.classList.remove('comic-reader-active');
    closeSettings();
    viewport.replaceChildren();
    clearURLs();
    figures = [];
    pages = [];
    volumes = [];
    volume = book = undefined;
    requestedBookId = requestedVolumeId = undefined;
    navigationPending = false;
    handlers = {};
    pointer = lastTap = null;
    if (lastFocus?.isConnected && lastFocus.getClientRects().length) lastFocus.focus({ preventScroll: true });
    return saved;
  }
  $('comicReaderBack').addEventListener('click', () => {
    const callback = handlers.onBack;
    const result = { bookId: book?.id || requestedBookId, volumeId: volume?.id || requestedVolumeId };
    hide();
    try { callback?.(result); } catch {}
  });
  $('comicReaderPrev').addEventListener('click', () => { void navigate(-1); });
  $('comicReaderNext').addEventListener('click', () => { void navigate(1); });
  $('comicReaderProgress').addEventListener('input', event => moveTo(Number(event.target.value) - 1));
  $('comicReaderProgress').addEventListener('change', () => { void writePosition(); });
  $('comicReaderReveal').addEventListener('click', () => { setBars(true); $('comicReaderSettingsButton').focus({ preventScroll: true }); });
  $('comicReaderSettingsButton').addEventListener('click', () => {
    const opening = $('comicReaderSettings').hidden;
    setBars(true);
    $('comicReaderSettings').hidden = !opening;
    $('comicReaderSettingsButton').setAttribute('aria-expanded', String(opening));
  });
  root.querySelectorAll('[data-comic-setting]').forEach(button => button.addEventListener('click', () => { void changeSettings(button.dataset.comicSetting, button.dataset.value); }));
  viewport.addEventListener('scroll', () => {
    if (!active || settings.mode !== 'scroll' || suppressScroll || scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      scrollPosition();
      updateControls();
      void renderScrollWindow();
      announceChange();
      scheduleSave();
    });
  }, { passive: true });
  viewport.addEventListener('pointerdown', event => {
    if (!active || !event.isPrimary || event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now() };
  });
  viewport.addEventListener('pointercancel', () => { pointer = null; lastTap = null; });
  viewport.addEventListener('pointerup', event => {
    if (!active || !pointer || pointer.id !== event.pointerId) return;
    const start = pointer;
    pointer = null;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const elapsed = performance.now() - start.at;
    if (settings.mode === 'page' && Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3 && elapsed < 700) {
      lastTap = null;
      void navigate((dx < 0 ? 1 : -1) * (settings.direction === 'rtl' ? -1 : 1));
      event.preventDefault();
      return;
    }
    if (Math.hypot(dx, dy) > 12 || elapsed > 300) { lastTap = null; return; }
    const now = performance.now();
    if (lastTap && now - lastTap.at < 340 && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 40) {
      setBars(!root.classList.contains('has-bars'));
      lastTap = null;
      event.preventDefault();
    } else lastTap = { x: event.clientX, y: event.clientY, at: now };
  });
  viewport.addEventListener('dblclick', event => event.preventDefault());
  root.addEventListener('keydown', event => {
    if (!active || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') { if (!$('comicReaderSettings').hidden) closeSettings(); else setBars(!root.classList.contains('has-bars')); event.preventDefault(); return; }
    if (event.target.closest('input,button')) return;
    if (settings.mode === 'page' && ['ArrowRight', 'ArrowLeft', 'PageDown', 'PageUp', ' '].includes(event.key)) {
      const delta = event.key === 'ArrowRight' ? (settings.direction === 'rtl' ? -1 : 1) : event.key === 'ArrowLeft' ? (settings.direction === 'rtl' ? 1 : -1) : event.key === 'PageUp' ? -1 : 1;
      void navigate(delta);
      event.preventDefault();
    }
  });
  function resize() {
    if (!active || resizingFrame) return;
    resizingFrame = requestAnimationFrame(() => {
      resizingFrame = 0;
      if (settings.mode === 'scroll') { sizeFigures(); restoreScroll(); }
      root.style.setProperty('--comic-header-height', $('comicReaderHeader').getBoundingClientRect().height + 'px');
    });
  }
  window.addEventListener('resize', resize);
  window.addEventListener('pagehide', () => { if (active) { if (settings.mode === 'scroll') scrollPosition(); void writePosition(); } });
  document.addEventListener('visibilitychange', () => { if (active && document.visibilityState === 'hidden') { if (settings.mode === 'scroll') scrollPosition(); void writePosition(); } });
  window.HoyulComicReader = { show, hide };
})();
