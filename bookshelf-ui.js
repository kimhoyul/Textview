/* A full-screen view of the existing library. app.js owns storage and dialogs. */
(() => {
  'use strict';

  const paths = {
    back: '<path d="m15 5-7 7 7 7"/>',
    add: '<circle cx="12" cy="12" r="9.2"/><path d="M12 7.5v9M7.5 12h9"/>',
    search: '<circle cx="10.5" cy="10.5" r="7.4"/><path d="m16 16 5.3 5.3"/>',
    settings: '<path d="m9.4 3.2.5-1.2h4.2l.5 1.2.5 2 1.7 1 2-.5 1.3.2 2.1 3.6-.8 1-.9 1.5v2l.9 1.5.8 1-2.1 3.6-1.3.2-2-.5-1.7 1-.5 2-.5 1.2H9.9l-.5-1.2-.5-2-1.7-1-2 .5-1.3-.2-2.1-3.6.8-1 .9-1.5v-2l-.9-1.5-.8-1 2.1-3.6 1.3-.2 2 .5 1.7-1Z"/><circle cx="12" cy="12" r="3.2"/>',
    down: '<path d="m6.5 9.5 5.5 5 5.5-5"/>',
    next: '<path d="m8.5 5 7 7-7 7"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</svg>`;
  const screen = document.createElement('main');
  screen.id = 'bookshelfScreen';
  screen.className = 'bookshelf-screen';
  screen.hidden = true;
  screen.setAttribute('aria-label', '보관함');
  screen.innerHTML = `
    <header class="bookshelf-header">
      <div class="bookshelf-toprow">
        <div class="bookshelf-title-group">
          <button class="bookshelf-icon-button bookshelf-back" type="button" data-shelf-action="home" aria-label="홈으로 돌아가기">${icon('back')}</button>
          <h1 id="bookshelfTitle" tabindex="-1">보관함</h1>
        </div>
        <div class="bookshelf-header-actions">
          <button class="bookshelf-icon-button" type="button" data-shelf-action="import" aria-label="TXT 가져오기">${icon('add')}</button>
          <button class="bookshelf-icon-button" id="bookshelfSearchToggle" type="button" data-shelf-action="search" aria-label="보관함 검색" aria-controls="bookshelfSearchPanel" aria-expanded="false">${icon('search')}</button>
        </div>
      </div>
      <div id="bookshelfSearchPanel" class="bookshelf-search-panel" hidden>
        <div class="bookshelf-search-field">
          ${icon('search')}
          <input id="bookshelfSearchInput" type="search" placeholder="작품 이름 검색" aria-label="보관함의 작품 이름 검색" enterkeyhint="search" autocomplete="off">
          <button class="bookshelf-icon-button" type="button" data-shelf-action="close-search" aria-label="검색 닫기">${icon('close')}</button>
        </div>
      </div>
      <div class="bookshelf-controls">
        <label class="bookshelf-select-wrap bookshelf-filter-wrap">
          <span class="bookshelf-visually-hidden">읽기 상태</span>
          <select id="bookshelfFilter" aria-label="읽기 상태로 작품 필터">
            <option value="all">전체</option>
            <option value="reading">읽는 중</option>
            <option value="unread">읽기 전</option>
            <option value="finished">다 읽음</option>
          </select>
          ${icon('down')}
        </label>
        <label class="bookshelf-select-wrap bookshelf-sort-wrap">
          <span class="bookshelf-visually-hidden">정렬</span>
          <select id="bookshelfSort" aria-label="작품 정렬">
            <option value="download">다운로드순</option>
            <option value="recent">최근 읽은순</option>
            <option value="title">제목순</option>
            <option value="size">용량순</option>
          </select>
          ${icon('down')}
        </label>
        <button class="bookshelf-edit-button" type="button" data-shelf-action="manage" aria-label="작품 관리">편집</button>
      </div>
    </header>
    <section id="bookshelfPanel" class="bookshelf-panel" aria-labelledby="bookshelfTitle">
      <p id="bookshelfResultCount" class="bookshelf-visually-hidden" role="status" aria-live="polite"></p>
      <div id="bookshelfList" class="bookshelf-list"></div>
      <div id="bookshelfEmpty" class="bookshelf-empty" hidden>
        <h2 id="bookshelfEmptyTitle"></h2>
        <p id="bookshelfEmptyDescription"></p>
        <button class="bookshelf-import-button" id="bookshelfEmptyImport" type="button" data-shelf-action="import" hidden>TXT 가져오기 ${icon('add')}</button>
      </div>
    </section>`;
  document.body.appendChild(screen);

  const $ = id => document.getElementById(id);
  const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
  let state = { books: [], ready: false };
  let selectedFilter = 'all';
  let selectedSort = 'download';
  let searchQuery = '';
  let searchOpen = false;
  let visibleBooks = [];
  let savedScroll = 0;
  let previousThemeColor = null;
  const api = { actions: {}, render, show, hide };
  window.TextviewShelf = api;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
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

  function timestamp(value) {
    const time = typeof value === 'number' ? value : Date.parse(value || '');
    return Number.isFinite(time) ? time : 0;
  }

  function artIndex(book) {
    if (Number.isInteger(book.artIndex) && book.artIndex >= 0 && book.artIndex <= 3) return book.artIndex;
    let hash = 0;
    for (const character of book.name) hash = (Math.imul(hash, 31) + character.codePointAt(0)) | 0;
    return (hash >>> 0) % 4;
  }

  function readingStatus(book) {
    if (!book.hasRead) return 'unread';
    return Number(book.progressRatio) >= 1 ? 'finished' : 'reading';
  }

  function formatSize(bytes) {
    const megabytes = Math.max(0, Number(bytes) || 0) / (1024 * 1024);
    if (megabytes > 0 && megabytes < 0.01) return '<0.01MB';
    return megabytes.toFixed(2).replace(/\.00$/, '') + 'MB';
  }

  function filteredBooks() {
    const query = searchQuery.trim().toLocaleLowerCase();
    return state.books.filter(book =>
      (selectedFilter === 'all' || readingStatus(book) === selectedFilter) &&
      (!query || book.name.toLocaleLowerCase().includes(query))
    ).sort((a, b) => {
      let difference = 0;
      if (selectedSort === 'download') difference = timestamp(b.addedAt) - timestamp(a.addedAt);
      else if (selectedSort === 'recent') difference = timestamp(b.lastReadAt) - timestamp(a.lastReadAt);
      else if (selectedSort === 'size') difference = (Number(b.bytes) || 0) - (Number(a.bytes) || 0);
      return difference || collator.compare(a.name, b.name);
    });
  }

  function createRow(book) {
    const row = element('button', 'bookshelf-book-row');
    row.type = 'button';
    row.dataset.shelfAction = 'book';
    row.dataset.bookIndex = String(state.books.indexOf(book));
    row.disabled = !state.ready;
    row.setAttribute('aria-label', `${book.name}, 총 ${book.count}화, ${formatSize(book.bytes)}, 목차 열기`);
    const cover = element('span', 'bookshelf-cover bookshelf-art-' + artIndex(book));
    cover.setAttribute('aria-hidden', 'true');
    cover.appendChild(element('span', 'bookshelf-cover-title', book.name));
    const copy = element('span', 'bookshelf-book-copy');
    copy.append(element('span', 'bookshelf-book-name', book.name), element('span', 'bookshelf-book-count', `총 ${book.count}화`));
    const right = element('span', 'bookshelf-book-right');
    right.appendChild(element('span', 'bookshelf-book-size', formatSize(book.bytes)));
    right.insertAdjacentHTML('beforeend', icon('next'));
    row.append(cover, copy, right);
    return row;
  }

  function render(data = {}) {
    state = {
      ...data,
      ready: Boolean(data.ready),
      books: Array.isArray(data.books) ? data.books.filter(book => book && typeof book.name === 'string') : [],
    };
    screen.querySelectorAll('[data-shelf-action="import"]').forEach(button => { button.disabled = !state.ready; });
    screen.querySelector('[data-shelf-action="manage"]').disabled = !state.ready || !state.books.length;
    renderRows();
  }

  function renderRows() {
    visibleBooks = filteredBooks();
    $('bookshelfList').replaceChildren(...visibleBooks.map(createRow));
    $('bookshelfResultCount').textContent = state.ready ? `${visibleBooks.length}개 작품` : '보관함을 불러오고 있습니다.';
    $('bookshelfEmpty').hidden = visibleBooks.length > 0;
    $('bookshelfEmptyImport').hidden = true;
    if (visibleBooks.length) return;
    if (state.error) {
      $('bookshelfEmptyTitle').textContent = '보관함을 불러오지 못했습니다';
      $('bookshelfEmptyDescription').textContent = '앱을 닫았다가 다시 열어 주세요.';
    } else if (!state.ready) {
      $('bookshelfEmptyTitle').textContent = '보관함을 불러오고 있습니다';
      $('bookshelfEmptyDescription').textContent = '잠시 기다려 주세요.';
    } else if (searchQuery.trim()) {
      $('bookshelfEmptyTitle').textContent = '검색한 작품이 없습니다';
      $('bookshelfEmptyDescription').textContent = '작품 이름이나 읽기 상태를 확인해 주세요.';
    } else if (!state.books.length) {
      $('bookshelfEmptyTitle').textContent = '아직 담긴 작품이 없습니다';
      $('bookshelfEmptyDescription').textContent = '읽을 TXT 파일을 가져오세요.';
      $('bookshelfEmptyImport').hidden = false;
    } else {
      $('bookshelfEmptyTitle').textContent = '해당하는 작품이 없습니다';
      $('bookshelfEmptyDescription').textContent = '읽기 상태를 전체로 바꾸면 모든 작품을 볼 수 있어요.';
    }
  }

  function setSearch(open) {
    searchOpen = open;
    $('bookshelfSearchPanel').hidden = !open;
    $('bookshelfSearchToggle').setAttribute('aria-expanded', String(open));
    if (open) $('bookshelfSearchInput').focus();
    else {
      searchQuery = '';
      $('bookshelfSearchInput').value = '';
      renderRows();
      $('bookshelfSearchToggle').focus();
    }
  }

  function show() {
    const wasVisible = document.body.classList.contains('shelf-visible');
    if (!wasVisible) {
      const color = document.querySelector('meta[name="theme-color"]');
      previousThemeColor = color?.content || null;
      if (color) color.content = '#08090b';
    }
    screen.hidden = false;
    document.body.classList.add('shelf-visible');
    if (!wasVisible) {
      window.scrollTo(0, savedScroll);
      $('bookshelfTitle').focus({ preventScroll: true });
    }
  }

  function hide() {
    if (document.body.classList.contains('shelf-visible')) savedScroll = window.scrollY;
    screen.hidden = true;
    document.body.classList.remove('shelf-visible');
    const color = document.querySelector('meta[name="theme-color"]');
    if (color && previousThemeColor) color.content = previousThemeColor;
  }

  screen.addEventListener('click', event => {
    const button = event.target.closest('[data-shelf-action]');
    if (!button || !screen.contains(button) || button.disabled) return;
    const action = button.dataset.shelfAction;
    const book = state.books[Number(button.dataset.bookIndex)];
    if (action === 'home') runAction('showHome');
    else if (action === 'import') runAction('openImport');
    else if (action === 'search') setSearch(!searchOpen);
    else if (action === 'close-search') setSearch(false);
    else if (action === 'book' && book) runAction('openBook', book.name);
    else if (action === 'manage') {
      const first = visibleBooks[0] || state.books[0];
      if (first) runAction('openBook', first.name);
    }
  });
  $('bookshelfSearchInput').addEventListener('input', event => {
    searchQuery = event.target.value;
    renderRows();
  });
  $('bookshelfSearchInput').addEventListener('keydown', event => {
    if (event.key === 'Escape') setSearch(false);
  });
  $('bookshelfFilter').addEventListener('change', event => {
    selectedFilter = event.target.value;
    renderRows();
  });
  $('bookshelfSort').addEventListener('change', event => {
    selectedSort = event.target.value;
    renderRows();
  });
  render();
})();
