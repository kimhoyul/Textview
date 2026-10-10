/* app.js supplies library data and owns reading, storage, and navigation. */
(() => {
  'use strict';

  const paths = {
    back: '<path d="m15 5-7 7 7 7"/>',
    search: '<circle cx="10.5" cy="10.5" r="7.4"/><path d="m16 16 5.3 5.3"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    sort: '<path d="M8 4v16m-3-3 3 3 3-3M16 20V4m-3 3 3-3 3 3"/>',
    next: '<path d="m9 5 7 7-7 7"/>',
    read: '<path d="M5 4h5a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H5Zm15 0h-4a3 3 0 0 0-3 3v14a4 4 0 0 1 4-2h3Z"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.1M4 12h.1M4 18h.1"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</svg>`;
  const screen = document.createElement('main');
  screen.id = 'bookDetailScreen';
  screen.className = 'book-detail-screen';
  screen.hidden = true;
  screen.setAttribute('aria-label', '작품 상세');
  screen.innerHTML = `
    <header class="detail-header" id="bookDetailHeader">
      <div class="detail-toprow">
        <button class="detail-icon-button" type="button" data-detail-action="back" aria-label="이전 화면으로 돌아가기">${icon('back')}</button>
        <h1 class="detail-heading" id="bookDetailHeading" tabindex="-1">작품 상세</h1>
        <button class="detail-icon-button" id="bookDetailSearchToggle" type="button" data-detail-action="search" aria-label="회차 검색" aria-controls="bookDetailSearchPanel" aria-expanded="false">${icon('search')}</button>
      </div>
      <div class="detail-search-panel" id="bookDetailSearchPanel" hidden>
        <div class="detail-search-field">
          ${icon('search')}
          <input id="bookDetailSearchInput" type="search" placeholder="회차 제목 검색" aria-label="회차 제목 검색" enterkeyhint="search" autocomplete="off">
          <button class="detail-icon-button" type="button" data-detail-action="clear-search" aria-label="회차 검색 닫기">${icon('close')}</button>
        </div>
      </div>
    </header>
    <section class="detail-intro" aria-labelledby="bookDetailName">
      <div class="detail-cover" id="bookDetailCover" aria-hidden="true"><span class="detail-cover-title" id="bookDetailCoverTitle"></span></div>
      <div class="detail-intro-copy">
        <h2 class="detail-book-name" id="bookDetailName"></h2>
        <p class="detail-book-kind">NOVEL · TXT</p>
        <p class="detail-book-count" id="bookDetailTotal"></p>
        <p class="detail-book-meta" id="bookDetailMeta"></p>
        <p class="detail-read-summary" id="bookDetailReadSummary" hidden></p>
      </div>
    </section>
    <nav class="detail-tabs" role="tablist" aria-label="작품 상세 메뉴">
      <button class="detail-tab is-active" id="bookDetailEpisodesTab" type="button" role="tab" aria-selected="true" aria-controls="bookDetailEpisodesPanel" data-detail-action="episodes-tab">회차</button>
      <button class="detail-tab" id="bookDetailInfoTab" type="button" role="tab" aria-selected="false" aria-controls="bookDetailInfoPanel" tabindex="-1" data-detail-action="info-tab">작품 정보</button>
    </nav>
    <section class="detail-episodes-panel" id="bookDetailEpisodesPanel" role="tabpanel" aria-labelledby="bookDetailEpisodesTab">
      <div class="detail-list-tools">
        <p class="detail-count" id="bookDetailResultCount" role="status" aria-live="polite"></p>
        <button class="detail-sort-button" id="bookDetailSort" type="button" data-detail-action="sort" aria-label="최신순으로 정렬">${icon('sort')}<span>첫 화부터</span></button>
      </div>
      <button class="detail-last-read" id="bookDetailLastRead" type="button" data-detail-action="jump" hidden>
        ${icon('read')}<span class="detail-last-read-label">최근 읽은 회차</span><span class="detail-last-read-title" id="bookDetailLastReadTitle"></span><svg class="detail-last-read-next" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>
      </button>
      <ol class="detail-episode-list" id="bookDetailEpisodeList"></ol>
      <div class="detail-empty" id="bookDetailEmpty" hidden><p id="bookDetailEmptyTitle"></p><p id="bookDetailEmptyDescription"></p></div>
    </section>
    <section class="detail-info-panel" id="bookDetailInfoPanel" role="tabpanel" aria-labelledby="bookDetailInfoTab" hidden>
      <h2>작품 정보</h2>
      <dl class="detail-info-list" id="bookDetailInfoList"></dl>
    </section>
    <footer class="detail-footer">
      <div class="detail-footer-inner">
        <button class="detail-jump-button" id="bookDetailJump" type="button" data-detail-action="jump" aria-label="읽던 회차로 이동">${icon('list')}</button>
        <button class="detail-continue-button" id="bookDetailContinue" type="button" data-detail-action="continue"><span class="detail-continue-label" id="bookDetailContinueLabel">첫 화 보기</span><span class="detail-continue-chapter" id="bookDetailContinueChapter"></span></button>
      </div>
    </footer>`;
  document.body.appendChild(screen);

  const $ = id => document.getElementById(id);
  const rowNodes = new Map();
  const savedScroll = new Map();
  let state = { book: null, chapters: [], ready: false, error: null };
  let selectedTab = 'episodes';
  let latestFirst = false;
  let searchOpen = false;
  let searchQuery = '';
  let previousThemeColor = null;
  let headerFrame = 0;
  let newBookPending = false;
  const api = { actions: {}, render, show, hide };
  window.TextviewBookDetail = api;

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

  function safeRatio(value) { return Math.min(1, Math.max(0, Number(value) || 0)); }
  function sameId(a, b) { return a != null && b != null && String(a) === String(b); }
  function chapterTitle(chapter) { return String(chapter?.title || chapter?.name || '제목 없는 회차'); }
  function timestamp(value) {
    const time = typeof value === 'number' ? value : Date.parse(value || '');
    return Number.isFinite(time) && time > 0 ? time : 0;
  }
  function dateLabel(value, full = false) {
    const time = timestamp(value);
    if (!time) return '';
    const date = new Date(time);
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return (full ? year : year.slice(-2)) + '.' + month + '.' + day;
  }
  function formatSize(bytes) {
    const size = Math.max(0, Number(bytes) || 0);
    if (!size) return '0KB';
    if (size < 1024 * 1024) return Math.max(1, Math.round(size / 1024)) + 'KB';
    return (size / (1024 * 1024)).toFixed(2).replace(/\.00$/, '') + 'MB';
  }
  function artIndex(book) {
    if (Number.isInteger(book?.artIndex) && book.artIndex >= 0 && book.artIndex <= 3) return book.artIndex;
    let hash = 0;
    for (const character of String(book?.name || '')) hash = (Math.imul(hash, 31) + character.codePointAt(0)) | 0;
    return (hash >>> 0) % 4;
  }
  function setCover(node, book) {
    node.classList.remove('detail-art-0', 'detail-art-1', 'detail-art-2', 'detail-art-3');
    node.classList.add('detail-art-' + artIndex(book));
    node.querySelector('.detail-cover-title').textContent = book?.name || '';
  }

  function render(data = {}) {
    const book = data.book && typeof data.book.name === 'string' ? data.book : null;
    const changedBook = state.book?.name !== book?.name;
    if (changedBook) {
      if (state.book && document.body.classList.contains('detail-visible')) savedScroll.set(state.book.name, window.scrollY);
      selectedTab = 'episodes';
      latestFirst = false;
      searchOpen = false;
      searchQuery = '';
      $('bookDetailSearchInput').value = '';
      $('bookDetailSearchPanel').hidden = true;
      $('bookDetailSearchToggle').setAttribute('aria-expanded', 'false');
      rowNodes.clear();
      $('bookDetailEpisodeList').replaceChildren();
      newBookPending = true;
    }
    state = {
      ...data,
      book,
      ready: Boolean(data.ready),
      chapters: Array.isArray(data.chapters) ? data.chapters.filter(chapter => chapter && chapter.id != null) : [],
    };
    const name = book?.name || '작품 상세';
    screen.setAttribute('aria-label', name + ' 작품 상세');
    $('bookDetailHeading').textContent = name;
    $('bookDetailName').textContent = name;
    setCover($('bookDetailCover'), book);
    const count = state.chapters.length || Math.max(0, Number(book?.count) || 0);
    $('bookDetailTotal').textContent = `총 ${count.toLocaleString('ko-KR')}화`;
    $('bookDetailMeta').textContent = [formatSize(book?.bytes), dateLabel(book?.addedAt, true) ? dateLabel(book.addedAt, true) + ' 최근 추가' : ''].filter(Boolean).join(' · ');
    const summary = $('bookDetailReadSummary');
    summary.hidden = !book?.hasRead;
    summary.textContent = book?.hasRead ? `읽던 회차 · ${Math.round(safeRatio(book.ratio) * 100)}%` : '';
    $('bookDetailLastRead').hidden = !book?.hasRead || book.chapterId == null;
    $('bookDetailLastReadTitle').textContent = book?.chapterName || chapterTitle(state.chapters.find(chapter => sameId(chapter.id, book?.chapterId)));
    const canRead = state.ready && !state.error && book?.chapterId != null && state.chapters.some(chapter => sameId(chapter.id, book.chapterId));
    $('bookDetailContinue').disabled = !canRead;
    $('bookDetailJump').disabled = !canRead;
    $('bookDetailLastRead').disabled = !canRead;
    $('bookDetailJump').setAttribute('aria-label', book?.hasRead ? '읽던 회차로 이동' : '첫 회차로 이동');
    $('bookDetailContinueLabel').textContent = book?.hasRead ? '이어보기' : '첫 화 보기';
    $('bookDetailContinueChapter').textContent = book?.chapterName || (canRead ? chapterTitle(state.chapters.find(chapter => sameId(chapter.id, book.chapterId))) : '');
    $('bookDetailContinue').setAttribute('aria-label', (book?.hasRead ? '이어보기, ' : '첫 화 보기, ') + $('bookDetailContinueChapter').textContent);
    $('bookDetailSort').disabled = !state.ready || state.chapters.length < 2;
    $('bookDetailSearchToggle').disabled = !state.ready || !state.chapters.length;
    renderRows();
    renderInfo();
    updateTab();
    if (changedBook && document.body.classList.contains('detail-visible')) {
      window.scrollTo(0, 0);
      newBookPending = false;
    }
    measureHeader();
  }

  function createRow() {
    const item = element('li');
    const button = element('button', 'detail-episode');
    button.type = 'button';
    button.dataset.detailAction = 'chapter';
    const cover = element('span', 'detail-cover detail-episode-cover');
    cover.setAttribute('aria-hidden', 'true');
    cover.appendChild(element('span', 'detail-cover-title'));
    const copy = element('span', 'detail-episode-copy');
    const title = element('span', 'detail-episode-title');
    const number = element('span', 'detail-episode-number');
    const name = element('span');
    title.append(number, name);
    const meta = element('span', 'detail-episode-meta');
    copy.append(title, meta);
    const status = element('span', 'detail-episode-state');
    const statusLabel = element('strong');
    const progress = element('span', 'detail-episode-progress');
    progress.setAttribute('aria-hidden', 'true');
    const progressFill = element('span', 'detail-episode-progress-fill');
    progress.appendChild(progressFill);
    status.append(statusLabel, progress);
    button.append(cover, copy, status);
    item.appendChild(button);
    return { item, button, cover, number, name, meta, statusLabel, progress, progressFill };
  }

  function updateRow(row, chapter, index) {
    const isCurrent = Boolean(state.book?.hasRead && sameId(chapter.id, state.book.chapterId));
    const isRead = Boolean(chapter.hasRead);
    const ratio = safeRatio(chapter.ratio);
    const title = chapterTitle(chapter);
    row.button.dataset.chapterId = String(chapter.id);
    row.button.disabled = !state.ready || Boolean(state.error);
    row.button.classList.toggle('is-current', isCurrent);
    row.button.classList.toggle('is-read', isRead);
    if (isCurrent) row.button.setAttribute('aria-current', 'true');
    else row.button.removeAttribute('aria-current');
    row.button.setAttribute('aria-label', title + (isCurrent ? ', 읽던 회차, ' + Math.round(ratio * 100) + '%' : isRead ? ', 읽은 회차' : ', 읽기'));
    setCover(row.cover, state.book);
    row.number.textContent = /^\s*\d+\s*화(?:\s|[:.·-]|$)/.test(title) ? '' : `${index + 1}화`;
    row.name.textContent = title;
    row.meta.textContent = [formatSize(chapter.bytes), dateLabel(chapter.addedAt)].filter(Boolean).join(' · ');
    row.statusLabel.textContent = isCurrent ? '이어서' : isRead ? '다시 보기' : '읽기';
    row.progress.hidden = !isCurrent;
    row.progressFill.style.width = `${Math.round(ratio * 100)}%`;
  }

  function renderRows() {
    const query = searchQuery.trim().toLocaleLowerCase('ko');
    let chapters = state.chapters.map((chapter, index) => ({ chapter, index })).filter(({ chapter, index }) => !query || chapterTitle(chapter).toLocaleLowerCase('ko').includes(query) || `${index + 1}화`.includes(query));
    if (latestFirst) chapters = chapters.reverse();
    const count = $('bookDetailResultCount');
    count.replaceChildren(document.createTextNode(query ? '검색 결과 ' : '전체 '), element('span', '', chapters.length.toLocaleString('ko-KR')), document.createTextNode('화'));
    $('bookDetailSort').querySelector('span').textContent = latestFirst ? '최신순' : '첫 화부터';
    $('bookDetailSort').setAttribute('aria-label', latestFirst ? '첫 화부터 정렬' : '최신순으로 정렬');
    const list = $('bookDetailEpisodeList');
    const keys = new Set();
    for (let position = 0; position < chapters.length; position++) {
      const { chapter, index } = chapters[position];
      const key = String(chapter.id);
      keys.add(key);
      let row = rowNodes.get(key);
      if (!row) { row = createRow(); rowNodes.set(key, row); }
      updateRow(row, chapter, index);
      if (list.children[position] !== row.item) list.insertBefore(row.item, list.children[position] || null);
    }
    for (const [key, row] of rowNodes) if (!keys.has(key)) row.item.remove();
    $('bookDetailEmpty').hidden = chapters.length > 0;
    if (chapters.length) return;
    if (state.error) {
      $('bookDetailEmptyTitle').textContent = '회차를 불러오지 못했습니다';
      $('bookDetailEmptyDescription').textContent = '이전 화면에서 작품을 다시 열어 주세요.';
    } else if (!state.ready) {
      $('bookDetailEmptyTitle').textContent = '회차를 불러오고 있습니다';
      $('bookDetailEmptyDescription').textContent = '잠시 기다려 주세요.';
    } else if (query) {
      $('bookDetailEmptyTitle').textContent = '검색한 회차가 없습니다';
      $('bookDetailEmptyDescription').textContent = '다른 제목이나 회차 번호로 검색해 주세요.';
    } else {
      $('bookDetailEmptyTitle').textContent = '아직 회차가 없습니다';
      $('bookDetailEmptyDescription').textContent = '내 서재에서 TXT 파일을 추가해 주세요.';
    }
  }

  function renderInfo() {
    const list = $('bookDetailInfoList');
    const data = [
      ['작품명', state.book?.name || ''],
      ['회차', `총 ${state.chapters.length.toLocaleString('ko-KR')}화`],
      ['파일 용량', formatSize(state.book?.bytes)],
      ['최근 추가일', dateLabel(state.book?.addedAt, true)],
      ['인코딩', [...new Set(state.chapters.map(chapter => chapter.encoding).filter(Boolean))].join(' · ')],
    ].filter(([, value]) => value);
    list.replaceChildren(...data.map(([label, value]) => {
      const row = element('div', 'detail-info-item');
      row.append(element('dt', '', label), element('dd', '', value));
      return row;
    }));
  }

  function updateTab() {
    const episodes = selectedTab === 'episodes';
    $('bookDetailEpisodesTab').classList.toggle('is-active', episodes);
    $('bookDetailInfoTab').classList.toggle('is-active', !episodes);
    $('bookDetailEpisodesTab').setAttribute('aria-selected', String(episodes));
    $('bookDetailInfoTab').setAttribute('aria-selected', String(!episodes));
    $('bookDetailEpisodesTab').tabIndex = episodes ? 0 : -1;
    $('bookDetailInfoTab').tabIndex = episodes ? -1 : 0;
    $('bookDetailEpisodesPanel').hidden = !episodes;
    $('bookDetailInfoPanel').hidden = episodes;
  }

  function setSearch(open) {
    searchOpen = open;
    $('bookDetailSearchPanel').hidden = !open;
    $('bookDetailSearchToggle').setAttribute('aria-expanded', String(open));
    if (open) {
      selectedTab = 'episodes';
      updateTab();
      $('bookDetailSearchInput').focus();
    } else {
      searchQuery = '';
      $('bookDetailSearchInput').value = '';
      renderRows();
      $('bookDetailSearchToggle').focus();
    }
    measureHeader();
  }

  function jumpToCurrent() {
    const id = state.book?.chapterId;
    if (id == null) return;
    if (searchQuery) {
      searchQuery = '';
      $('bookDetailSearchInput').value = '';
      renderRows();
    }
    selectedTab = 'episodes';
    updateTab();
    const row = rowNodes.get(String(id));
    if (!row) return;
    row.item.scrollIntoView({ block: 'center', behavior: 'auto' });
    row.button.focus({ preventScroll: true });
  }

  function measureHeader() {
    cancelAnimationFrame(headerFrame);
    headerFrame = requestAnimationFrame(() => {
      if (screen.hidden) return;
      screen.style.setProperty('--detail-header-height', `${Math.ceil($('bookDetailHeader').getBoundingClientRect().height)}px`);
    });
  }

  function show() {
    const wasVisible = document.body.classList.contains('detail-visible');
    if (!wasVisible) {
      const color = document.querySelector('meta[name="theme-color"]');
      previousThemeColor = color?.content || null;
      if (color) color.content = '#08090b';
    }
    screen.hidden = false;
    document.body.classList.add('detail-visible');
    if (!wasVisible || newBookPending) {
      const position = newBookPending ? 0 : savedScroll.get(state.book?.name) || 0;
      window.scrollTo(0, position);
      $('bookDetailHeading').focus({ preventScroll: true });
      newBookPending = false;
    }
    measureHeader();
  }

  function hide() {
    if (document.body.classList.contains('detail-visible') && state.book) savedScroll.set(state.book.name, window.scrollY);
    screen.hidden = true;
    document.body.classList.remove('detail-visible');
    const color = document.querySelector('meta[name="theme-color"]');
    if (color && previousThemeColor) color.content = previousThemeColor;
    previousThemeColor = null;
  }

  screen.addEventListener('click', event => {
    const button = event.target.closest('[data-detail-action]');
    if (!button || !screen.contains(button) || button.disabled) return;
    const action = button.dataset.detailAction;
    if (action === 'back') runAction('back');
    else if (action === 'search') setSearch(!searchOpen);
    else if (action === 'clear-search') setSearch(false);
    else if (action === 'sort') { latestFirst = !latestFirst; renderRows(); }
    else if (action === 'episodes-tab' || action === 'info-tab') {
      selectedTab = action === 'episodes-tab' ? 'episodes' : 'info';
      updateTab();
    } else if (action === 'jump') jumpToCurrent();
    else if (action === 'continue' && state.book?.chapterId != null) runAction('openChapter', state.book.chapterId);
    else if (action === 'chapter') {
      const chapter = state.chapters.find(item => sameId(item.id, button.dataset.chapterId));
      if (chapter) runAction('openChapter', chapter.id);
    }
  });
  $('bookDetailSearchInput').addEventListener('input', event => { searchQuery = event.target.value; renderRows(); });
  $('bookDetailSearchInput').addEventListener('keydown', event => { if (event.key === 'Escape') setSearch(false); });
  screen.querySelector('.detail-tabs').addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    selectedTab = event.key === 'Home' ? 'episodes' : event.key === 'End' ? 'info' : selectedTab === 'episodes' ? 'info' : 'episodes';
    updateTab();
    $(selectedTab === 'episodes' ? 'bookDetailEpisodesTab' : 'bookDetailInfoTab').focus();
  });
  window.addEventListener('resize', measureHeader, { passive: true });
  if (typeof ResizeObserver === 'function') new ResizeObserver(measureHeader).observe($('bookDetailHeader'));
})();
