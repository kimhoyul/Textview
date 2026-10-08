/* Textview home is a view of the existing library. Storage stays in app.js. */
(() => {
  'use strict';

  const icons = {
    add: '<circle cx="12" cy="12" r="9.2"/><path d="M12 7.5v9M7.5 12h9"/>',
    search: '<circle cx="10.5" cy="10.5" r="7.4"/><path d="m16 16 5.3 5.3"/>',
    settings: '<path d="m9.4 3.2.5-1.2h4.2l.5 1.2.5 2 1.7 1 2-.5 1.3.2 2.1 3.6-.8 1-.9 1.5v2l.9 1.5.8 1-2.1 3.6-1.3.2-2-.5-1.7 1-.5 2-.5 1.2H9.9l-.5-1.2-.5-2-1.7-1-2 .5-1.3-.2-2.1-3.6.8-1 .9-1.5v-2l-.9-1.5-.8-1 2.1-3.6 1.3-.2 2 .5 1.7-1Z"/><circle cx="12" cy="12" r="3.2"/>',
    chevron: '<path d="m8.5 5 7 7-7 7"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    check: '<path d="m5 12 4 4 10-10"/>',
    book: '<path d="M4 3.5h6a3 3 0 0 1 3 3v15a4 4 0 0 0-4-2H4Zm16 0h-4a3 3 0 0 0-3 3v15a4 4 0 0 1 4-2h3Z"/>',
  };
  const svg = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[name] || ''}</svg>`;
  const screen = document.createElement('main');
  screen.id = 'homeScreen';
  screen.className = 'home-screen';
  screen.setAttribute('aria-label', '호율 시리즈 홈');
  screen.hidden = true;
  screen.innerHTML = `
    <header class="home-header">
      <div class="home-toprow">
        <h1 class="home-visually-hidden">호율 시리즈</h1>
        <div class="home-brand-tabs" role="tablist" aria-label="콘텐츠 종류">
          <button id="homeNovelTab" type="button" role="tab" class="is-active" aria-selected="true" aria-controls="homeNovelPanel" data-home-action="novel">NOVEL</button>
          <button id="homeComixTab" type="button" role="tab" aria-selected="false" aria-describedby="homeComixHint" tabindex="-1" data-home-action="comix">COMIX</button>
        </div>
        <span id="homeComixHint" class="home-visually-hidden">준비 중</span>
        <div class="home-header-actions">
          <button class="home-icon-button" id="homeSearchToggle" type="button" data-home-action="search" aria-label="내 서재 검색" aria-controls="homeSearchPanel" aria-expanded="false">${svg('search')}</button>
        </div>
      </div>
      <nav class="home-navigation" aria-label="주요 메뉴">
        <button type="button" class="is-active" data-home-action="home" aria-current="page">홈</button>
        <button type="button" data-home-action="library">내 서재</button>
        <button type="button" data-home-action="nas">NAS</button>
      </nav>
      <div id="homeSearchPanel" class="home-search-panel" hidden>
        <div class="home-search-field">
          ${svg('search')}
          <input id="homeSearchInput" type="search" placeholder="작품 이름 검색" aria-label="내 서재의 작품 이름 검색" enterkeyhint="search" autocomplete="off">
          <button type="button" class="home-icon-button" data-home-action="close-search" aria-label="검색 닫기">${svg('close')}</button>
        </div>
      </div>
    </header>
    <div class="home-content" id="homeNovelPanel" role="tabpanel" aria-labelledby="homeNovelTab">
      <section class="home-search-results" id="homeSearchResults" aria-labelledby="homeSearchHeading" hidden>
        <div class="home-section-head"><h2 id="homeSearchHeading">내 서재 검색</h2><span id="homeSearchCount" class="home-search-count" aria-live="polite"></span></div>
        <div id="homeSearchGrid" class="home-book-grid"></div>
        <p id="homeSearchEmpty" class="home-search-empty" hidden>검색한 작품이 없습니다.</p>
      </section>
      <div class="home-normal-content">
        <section class="home-featured" aria-label="읽기 시작">
          <div id="homeHeroTrack" class="home-hero-track" tabindex="0" aria-label="작품 배너. 좌우로 이동할 수 있습니다."></div>
          <button id="homeHeroPager" class="home-hero-pager" type="button" data-home-action="next-hero" aria-label="다음 작품 배너" hidden><span id="homeHeroPage">1 / 1</span>${svg('chevron')}</button>
        </section>
        <section class="home-library-section" aria-labelledby="homeLibraryHeading">
          <div class="home-section-head">
            <h2 id="homeLibraryHeading">내 서재에 담긴 작품</h2>
            <button type="button" class="home-text-button" data-home-action="library">전체 보기 ${svg('chevron')}</button>
          </div>
          <div id="homeLibraryGrid" class="home-book-grid"></div>
          <div id="homeLibraryEmpty" class="home-library-empty" hidden>
            <div class="home-empty-books" aria-hidden="true"><span></span><span></span><span></span></div>
            <h3>좋아하는 이야기를 담아보세요</h3>
            <p>내 서재에서 작품을 추가해보세요.</p>
            <button class="home-primary-button" type="button" data-home-action="library">내 서재로 가기 ${svg('chevron')}</button>
          </div>
          <p id="homeLoadStatus" class="home-load-status" role="status" hidden></p>
        </section>
        <section id="homeRecentSection" class="home-recent-section" aria-labelledby="homeRecentHeading">
          <div class="home-section-head home-recent-head">
            <div class="home-section-tabs" role="tablist" aria-label="서재 정렬">
              <button id="homeRecentHeading" type="button" role="tab" class="is-active" aria-selected="true" aria-controls="homeRecentPanel" data-home-action="recent-mode">최근 본</button>
              <button id="homeAddedHeading" type="button" role="tab" aria-selected="false" aria-controls="homeRecentPanel" data-home-action="added-mode">새로 추가한</button>
            </div>
            <button class="home-text-button" type="button" data-home-action="library">더보기 ${svg('chevron')}</button>
          </div>
          <div id="homeRecentPanel" role="tabpanel" aria-labelledby="homeRecentHeading">
            <div id="homeRecentRail" class="home-book-rail"></div>
            <p id="homeRecentEmpty" class="home-recent-empty" hidden>작품을 읽으면 이곳에서 바로 이어 읽을 수 있어요.</p>
          </div>
        </section>
      </div>
    </div>`;
  document.body.appendChild(screen);

  let state = { books: [], ready: false, lastId: null };
  let searchQuery = '';
  let searchOpen = false;
  let recentMode = 'recent';
  let heroIndex = 0;
  let heroBooks = [];
  let scrollFrame = 0;
  let savedHomeScroll = 0;
  let previousThemeColor = null;
  const bookArt = new Map();
  const $ = id => document.getElementById(id);
  const track = $('homeHeroTrack');
  const api = { actions: {}, render, show, hide, getArtIndex: artIndex };
  window.TextviewHome = api;

  function artIndex(name) {
    // TXT files have no cover metadata. Use varied decorative art for this view.
    if (!bookArt.has(name)) bookArt.set(name, bookArt.size % 4);
    return bookArt.get(name);
  }

  function runAction(name, ...args) {
    const action = api.actions[name];
    if (typeof action !== 'function') return;
    try {
      Promise.resolve(action(...args)).catch(() => api.actions.notify?.('요청을 처리하지 못했습니다. 다시 시도해 주세요.'));
    } catch (_) {
      api.actions.notify?.('요청을 처리하지 못했습니다. 다시 시도해 주세요.');
    }
  }

  function makeElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function addArt(element, book) {
    element.classList.add('home-art', 'home-art-' + artIndex(book.name));
  }

  function sortedBooks(mode) {
    const result = state.books.filter(book => mode !== 'recent' || book.hasRead);
    return result.sort((a, b) => {
      if (mode === 'recent') {
        const aLast = a.chapterId != null && String(a.chapterId) === String(state.lastId);
        const bLast = b.chapterId != null && String(b.chapterId) === String(state.lastId);
        if (aLast !== bLast) return aLast ? -1 : 1;
        return timestamp(b.lastReadAt) - timestamp(a.lastReadAt);
      }
      return timestamp(b.addedAt) - timestamp(a.addedAt);
    });
  }

  function timestamp(value) {
    const time = typeof value === 'number' ? value : Date.parse(value || '');
    return Number.isFinite(time) ? time : 0;
  }

  function createCard(book, compact = false) {
    const card = makeElement('button', 'home-book-card' + (compact ? ' home-book-card-compact' : ''));
    card.type = 'button';
    card.disabled = !state.ready;
    card.dataset.homeAction = 'book';
    card.dataset.bookIndex = String(state.books.indexOf(book));
    card.setAttribute('aria-label', `${book.name}, ${book.count}화, 목차 열기`);
    const cover = makeElement('span', 'home-book-cover');
    addArt(cover, book);
    cover.setAttribute('aria-hidden', 'true');
    cover.appendChild(makeElement('span', 'home-cover-title', book.name));
    card.append(cover, makeElement('span', 'home-book-name', book.name));
    if (!compact) {
      card.appendChild(makeElement('span', 'home-book-meta', `${book.count}화`));
    }
    return card;
  }

  function createHero(book) {
    const slide = makeElement('article', 'home-hero-slide');
    addArt(slide, book);
    slide.setAttribute('aria-label', book.name);
    const content = makeElement('div', 'home-hero-copy');
    content.appendChild(makeElement('p', 'home-hero-eyebrow', book.hasRead ? '이어서 읽기' : '내 서재에서 읽기'));
    content.appendChild(makeElement('h2', 'home-hero-title', book.name));
    const chapter = book.chapterName || `${book.count}화`;
    content.appendChild(makeElement('p', 'home-hero-chapter', chapter));
    const button = makeElement('button', 'home-primary-button', book.hasRead ? '이어 읽기' : '읽기 시작');
    button.type = 'button';
    button.dataset.homeAction = 'chapter';
    button.dataset.bookIndex = String(state.books.indexOf(book));
    button.disabled = !state.ready || book.chapterId == null;
    button.insertAdjacentHTML('beforeend', svg('chevron'));
    content.appendChild(button);
    slide.appendChild(content);
    return slide;
  }

  function createWelcomeHero() {
    const slide = makeElement('article', 'home-hero-slide home-hero-welcome home-art home-art-0');
    const content = makeElement('div', 'home-hero-copy');
    content.appendChild(makeElement('p', 'home-hero-eyebrow', '내 손안의 서재'));
    const title = makeElement('h2', 'home-hero-title');
    title.append('나만의 이야기,', document.createElement('br'), '한곳에.');
    content.append(title, makeElement('p', 'home-hero-chapter', '좋아하는 TXT를 담고 읽어보세요.'));
    const button = makeElement('button', 'home-primary-button', '내 서재로 가기');
    button.type = 'button';
    button.dataset.homeAction = 'library';
    button.disabled = !state.ready;
    button.insertAdjacentHTML('beforeend', svg('chevron'));
    content.appendChild(button);
    slide.appendChild(content);
    return slide;
  }

  function render(data = {}) {
    state = {
      ...data,
      ready: Boolean(data.ready),
      books: Array.isArray(data.books) ? data.books.filter(book => book && typeof book.name === 'string') : [],
    };
    state.books.forEach(book => artIndex(book.name));
    heroBooks = sortedBooks('recent');
    if (!heroBooks.length) heroBooks = sortedBooks('added');
    heroBooks = heroBooks.slice(0, 5);
    heroIndex = 0;
    track.replaceChildren(...(heroBooks.length ? heroBooks.map(createHero) : [createWelcomeHero()]));
    track.scrollLeft = 0;
    $('homeHeroPager').hidden = heroBooks.length < 2;
    updatePager();

    const displayBooks = state.books.slice(0, 3);
    $('homeLibraryGrid').replaceChildren(...displayBooks.map(book => createCard(book)));
    $('homeLibraryEmpty').hidden = Boolean(state.books.length) || !state.ready || Boolean(state.error);
    $('homeLoadStatus').hidden = state.ready && !state.error;
    $('homeLoadStatus').textContent = state.error ? '서재를 불러오지 못했습니다. 앱을 다시 열어 주세요.' : '내 서재를 불러오고 있습니다.';
    screen.querySelectorAll('[data-home-action="library"]').forEach(button => { button.disabled = !state.ready; });
    renderRecent();
    renderSearch();
  }

  function renderRecent() {
    const books = sortedBooks(recentMode).slice(0, 12);
    $('homeRecentRail').replaceChildren(...books.map(book => createCard(book, true)));
    $('homeRecentEmpty').hidden = Boolean(books.length) || !state.ready || Boolean(state.error);
    $('homeRecentEmpty').textContent = recentMode === 'recent'
      ? '작품을 읽으면 이곳에서 바로 이어 읽을 수 있어요.'
      : 'TXT를 가져오면 새로 추가한 작품이 여기에 나타납니다.';
    $('homeRecentHeading').classList.toggle('is-active', recentMode === 'recent');
    $('homeAddedHeading').classList.toggle('is-active', recentMode === 'added');
    $('homeRecentHeading').setAttribute('aria-selected', String(recentMode === 'recent'));
    $('homeAddedHeading').setAttribute('aria-selected', String(recentMode === 'added'));
    $('homeRecentPanel').setAttribute('aria-labelledby', recentMode === 'recent' ? 'homeRecentHeading' : 'homeAddedHeading');
  }

  function renderSearch() {
    const query = searchQuery.trim().toLocaleLowerCase();
    const books = state.books.filter(book => book.name.toLocaleLowerCase().includes(query));
    $('homeSearchGrid').replaceChildren(...books.map(book => createCard(book)));
    $('homeSearchCount').textContent = `${books.length}개 작품`;
    $('homeSearchEmpty').hidden = Boolean(books.length) || !state.ready;
    $('homeSearchEmpty').textContent = query ? '검색한 작품이 없습니다.' : '아직 서재에 담긴 작품이 없습니다.';
  }

  function setSearch(open) {
    searchOpen = open;
    screen.classList.toggle('is-searching', open);
    $('homeSearchPanel').hidden = !open;
    $('homeSearchResults').hidden = !open;
    $('homeSearchToggle').setAttribute('aria-expanded', String(open));
    if (open) {
      renderSearch();
      $('homeSearchInput').focus();
    } else {
      searchQuery = '';
      $('homeSearchInput').value = '';
      $('homeSearchToggle').focus();
    }
  }

  function updatePager() {
    const total = Math.max(1, heroBooks.length);
    $('homeHeroPage').textContent = `${heroIndex + 1} / ${total}`;
    $('homeHeroPager').setAttribute('aria-label', `${heroIndex + 1} / ${total}, 다음 작품 배너`);
  }

  function moveHero(index) {
    const slides = track.children;
    if (!slides.length) return;
    const boundedIndex = Math.max(0, Math.min(slides.length - 1, index));
    const slide = slides[boundedIndex];
    track.scrollTo({ left: slide.offsetLeft - slides[0].offsetLeft, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  function show() {
    const wasVisible = document.body.classList.contains('home-visible');
    if (!wasVisible) {
      const color = document.querySelector('meta[name="theme-color"]');
      previousThemeColor = color?.content || null;
      if (color) color.content = '#08090b';
    }
    screen.hidden = false;
    document.body.classList.add('home-visible');
    if (!wasVisible) window.scrollTo(0, savedHomeScroll);
  }

  function hide() {
    if (document.body.classList.contains('home-visible')) savedHomeScroll = window.scrollY;
    screen.hidden = true;
    document.body.classList.remove('home-visible');
    const color = document.querySelector('meta[name="theme-color"]');
    if (color && previousThemeColor) color.content = previousThemeColor;
  }

  screen.addEventListener('click', event => {
    const button = event.target.closest('[data-home-action]');
    if (!button || !screen.contains(button) || button.disabled) return;
    const action = button.dataset.homeAction;
    const book = state.books[Number(button.dataset.bookIndex)];
    if (action === 'library') runAction('openLibrary');
    else if (action === 'book' && book) runAction('openBook', book.name);
    else if (action === 'chapter' && book && book.chapterId != null) runAction('openChapter', book.chapterId);
    else if (action === 'nas') runAction('openNAS');
    else if (action === 'search') setSearch(!searchOpen);
    else if (action === 'close-search') setSearch(false);
    else if (action === 'comix') runAction('notify', 'COMIX는 준비 중입니다.');
    else if (action === 'novel') {
      $('homeNovelTab').tabIndex = 0;
      $('homeComixTab').tabIndex = -1;
    }
    else if (action === 'home') {
      if (searchOpen) setSearch(false);
      runAction('showHome');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (action === 'recent') {
      if (searchOpen) setSearch(false);
      recentMode = 'recent';
      renderRecent();
      $('homeRecentSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (action === 'recent-mode' || action === 'added-mode') {
      recentMode = action === 'recent-mode' ? 'recent' : 'added';
      renderRecent();
    } else if (action === 'next-hero') moveHero((heroIndex + 1) % Math.max(1, heroBooks.length));
  });

  $('homeSearchInput').addEventListener('input', event => {
    searchQuery = event.target.value;
    renderSearch();
  });
  $('homeSearchInput').addEventListener('keydown', event => {
    if (event.key === 'Escape') setSearch(false);
  });
  track.addEventListener('keydown', event => {
    if (event.target !== track) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      moveHero(heroIndex + (event.key === 'ArrowRight' ? 1 : -1));
    }
  });
  screen.querySelector('.home-section-tabs').addEventListener('keydown', event => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    recentMode = recentMode === 'recent' ? 'added' : 'recent';
    renderRecent();
    $(recentMode === 'recent' ? 'homeRecentHeading' : 'homeAddedHeading').focus();
  });
  screen.querySelector('.home-brand-tabs').addEventListener('keydown', event => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const focusComix = event.key === 'End' || (event.key !== 'Home' && event.target.id === 'homeNovelTab');
    $('homeNovelTab').tabIndex = focusComix ? -1 : 0;
    $('homeComixTab').tabIndex = focusComix ? 0 : -1;
    $(focusComix ? 'homeComixTab' : 'homeNovelTab').focus();
  });
  track.addEventListener('scroll', () => {
    if (scrollFrame) return;
    scrollFrame = window.requestAnimationFrame(() => {
      scrollFrame = 0;
      const slides = [...track.children];
      const start = slides[0]?.offsetLeft || 0;
      let nearest = 0;
      let distance = Infinity;
      slides.forEach((slide, index) => {
        const currentDistance = Math.abs(slide.offsetLeft - start - track.scrollLeft);
        if (currentDistance < distance) { nearest = index; distance = currentDistance; }
      });
      heroIndex = nearest;
      updatePager();
    });
  }, { passive: true });
  render();
})();
