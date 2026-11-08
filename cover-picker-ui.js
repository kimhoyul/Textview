/* A cover editor. app.js owns image processing, storage, and navigation. */
(() => {
  'use strict';

  const icons = {
    image: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="m4 17 5.2-5.2 3.5 3.5 2.8-2.8 4.5 4.5"/>',
    default: '<path d="M5.5 4.5h11a2 2 0 0 1 2 2v14H7.5a2 2 0 0 1-2-2V4.5Z"/><path d="M5.5 16.5h13M9 7.5h6M9 10.5h4"/>',
    next: '<path d="m9 5 7 7-7 7"/>',
    check: '<path d="m5 12 4.5 4.5L19 7"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[name] || ''}</svg>`;
  const screen = document.createElement('main');
  screen.id = 'coverPickerScreen';
  screen.className = 'cover-picker-screen';
  screen.hidden = true;
  screen.setAttribute('aria-labelledby', 'coverPickerHeading');
  screen.innerHTML = `
    <header class="cover-picker-header">
      <div class="cover-picker-toprow">
        <button class="cover-picker-cancel" type="button" data-cover-action="back">취소</button>
        <h1 id="coverPickerHeading" tabindex="-1">표지 선택</h1>
        <button id="coverPickerSave" class="cover-picker-save" type="button" data-cover-action="save" disabled>저장</button>
      </div>
    </header>
    <section class="cover-picker-content" aria-labelledby="coverPickerBookName">
      <button id="coverPickerPreviewButton" class="cover-picker-preview-button" type="button" data-cover-action="choose" aria-label="표지 이미지 선택">
        <span id="coverPickerPreview" class="cover-picker-preview cover-picker-art-0" aria-hidden="true">
          <span id="coverPickerPreviewTitle" class="cover-picker-preview-title"></span>
          <img id="coverPickerImage" class="cover-picker-image" alt="" hidden>
        </span>
      </button>
      <h2 id="coverPickerBookName" class="cover-picker-book-name"></h2>
      <p id="coverPickerBookCredits" class="cover-picker-book-credits" hidden></p>
      <p id="coverPickerBookCount" class="cover-picker-book-count"></p>
      <p id="coverPickerStatus" class="cover-picker-status" role="status" aria-live="polite"></p>
      <form id="coverPickerSearchForm" class="cover-picker-search-form" role="search">
        <label class="cover-picker-search-field" for="coverPickerSearchInput">
          <span class="cover-picker-visually-hidden">표지 검색어</span>
          ${icon('search')}
          <input id="coverPickerSearchInput" type="search" placeholder="책 제목으로 검색" autocomplete="off" enterkeyhint="search" maxlength="160">
        </label>
        <button id="coverPickerSearchButton" type="submit">검색</button>
      </form>
      <section id="coverPickerSearchResults" class="cover-picker-search-results" aria-labelledby="coverPickerResultsTitle" aria-busy="false">
        <div class="cover-picker-results-heading">
          <h3 id="coverPickerResultsTitle">검색 결과</h3>
          <span id="coverPickerResultCount"></span>
        </div>
        <p id="coverPickerSearchStatus" class="cover-picker-search-status" role="status" aria-live="polite">책 제목으로 표지를 검색해 주세요.</p>
        <div id="coverPickerResultGrid" class="cover-picker-result-grid"></div>
      </section>
      <details class="cover-picker-other-methods">
        <summary>다른 방법 ${icon('down')}</summary>
        <div class="cover-picker-choices">
          <button id="coverPickerChoose" class="cover-picker-choice" type="button" data-cover-action="choose">
            <span class="cover-picker-choice-icon">${icon('image')}</span>
            <span class="cover-picker-choice-label">이미지 직접 선택</span>
            <span class="cover-picker-choice-next">${icon('next')}</span>
          </button>
          <button id="coverPickerDefault" class="cover-picker-choice" type="button" data-cover-action="default">
            <span class="cover-picker-choice-icon">${icon('default')}</span>
            <span class="cover-picker-choice-label">기본 표지 사용</span>
            <span id="coverPickerDefaultCheck" class="cover-picker-choice-check" hidden>${icon('check')}</span>
          </button>
        </div>
      </details>
      <button id="coverPickerRead" class="cover-picker-read" type="button" data-cover-action="read">작품 읽기 ${icon('next')}</button>
    </section>
    <input id="coverPickerFile" class="cover-picker-visually-hidden" type="file" accept="image/*" tabindex="-1" aria-label="책 표지 이미지 파일">
  `;
  document.body.appendChild(screen);

  const $ = id => document.getElementById(id);
  let state = { book: null, ready: false, busy: false, error: '' };
  let draft = { url: '', custom: false, changed: false, fileName: '', resultId: null, author: '', sourceName: '' };
  let searchState = { query: '', results: [], loading: false, error: '', searched: false };
  let previousFocus = null;
  let previousThemeColor = null;
  const api = { actions: {}, render, show, hide, setDraft, setStatus, setSearch };
  window.TextviewCoverPicker = api;

  function getArtIndex(book) {
    if (Number.isInteger(book?.artIndex) && book.artIndex >= 0 && book.artIndex <= 3) return book.artIndex;
    let hash = 0;
    for (const character of book?.name || '') hash = (Math.imul(hash, 31) + character.codePointAt(0)) | 0;
    return (hash >>> 0) % 4;
  }

  function invoke(name, ...args) {
    const action = api.actions[name];
    if (typeof action !== 'function') return;
    try {
      Promise.resolve(action(...args)).catch(() => setStatus('요청을 처리하지 못했습니다. 다시 시도해 주세요.', true));
    } catch (_) {
      setStatus('요청을 처리하지 못했습니다. 다시 시도해 주세요.', true);
    }
  }

  function metadataText(value) {
    if (Array.isArray(value)) return value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean).join(', ');
    return typeof value === 'string' ? value.trim() : '';
  }

  function render(data = {}) {
    const previousName = state.book?.name;
    state = { ...state, ...data };
    state.ready = Boolean(state.ready);
    state.busy = Boolean(state.busy);
    if (!state.book || typeof state.book.name !== 'string') state.book = null;
    if (previousName !== state.book?.name) {
      draft = {
        url: state.book?.coverUrl || '',
        custom: Boolean(state.book?.hasCustomCover),
        changed: false,
        fileName: '',
        resultId: null,
        author: metadataText(state.book?.author),
        sourceName: metadataText(state.book?.sourceName),
      };
      $('coverPickerFile').value = '';
      setStatus('');
      searchState = { query: state.book?.name || '', results: [], loading: false, error: '', searched: false };
      $('coverPickerSearchInput').value = searchState.query;
      screen.querySelector('.cover-picker-other-methods').open = false;
      renderSearch();
    }
    $('coverPickerBookName').textContent = state.book?.name || '';
    $('coverPickerPreviewTitle').textContent = state.book?.name || '';
    $('coverPickerBookCount').textContent = state.book ? `총 ${Math.max(0, Number(state.book.count) || 0)}화` : '';
    $('coverPickerPreview').className = 'cover-picker-preview cover-picker-art-' + getArtIndex(state.book);
    updatePreview();
    updateControls();
    if (data.error !== undefined) setStatus(data.error || '', Boolean(data.error));
  }

  function setDraft(data = {}) {
    draft = { ...draft, ...data };
    draft.url = typeof draft.url === 'string' ? draft.url : '';
    draft.custom = Boolean(draft.custom);
    draft.changed = Boolean(draft.changed);
    updatePreview();
    updateControls();
    updateResultSelection();
  }

  function setSearch(data = {}) {
    searchState = { ...searchState, ...data };
    searchState.loading = Boolean(searchState.loading);
    searchState.error = typeof searchState.error === 'string' ? searchState.error : '';
    if (data.loading || Array.isArray(data.results) || data.error) searchState.searched = true;
    searchState.results = Array.isArray(searchState.results) ? searchState.results.filter(result =>
      result && (typeof result.id === 'string' || typeof result.id === 'number') && typeof result.title === 'string'
    ) : [];
    if (data.query !== undefined) {
      searchState.query = typeof data.query === 'string' ? data.query : '';
      $('coverPickerSearchInput').value = searchState.query;
    }
    renderSearch();
    updateControls();
  }

  function createElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function createResult(result, index) {
    const button = createElement('button', 'cover-picker-result');
    button.type = 'button';
    button.dataset.coverAction = 'result';
    button.dataset.resultIndex = String(index);
    const author = Array.isArray(result.author) ? result.author.join(', ') : (typeof result.author === 'string' ? result.author : '');
    button.setAttribute('aria-label', `${result.title}${author ? ', ' + author : ''}, 표지 선택`);
    const art = createElement('span', 'cover-picker-result-art');
    const placeholder = createElement('span', 'cover-picker-result-placeholder');
    placeholder.innerHTML = icon('default');
    art.appendChild(placeholder);
    if (typeof result.thumbnailUrl === 'string' && result.thumbnailUrl) {
      const image = createElement('img', 'cover-picker-result-image');
      image.alt = '';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.src = result.thumbnailUrl;
      image.addEventListener('load', () => { placeholder.hidden = true; });
      image.addEventListener('error', () => { image.hidden = true; });
      art.appendChild(image);
    }
    const check = createElement('span', 'cover-picker-result-check');
    check.innerHTML = icon('check');
    check.hidden = true;
    art.appendChild(check);
    const copy = createElement('span', 'cover-picker-result-copy');
    copy.appendChild(createElement('span', 'cover-picker-result-title', result.title));
    if (author) copy.appendChild(createElement('span', 'cover-picker-result-author', author));
    if (typeof result.sourceName === 'string' && result.sourceName) copy.appendChild(createElement('span', 'cover-picker-result-source', result.sourceName));
    button.append(art, copy);
    return button;
  }

  function renderSearch() {
    const section = $('coverPickerSearchResults');
    section.setAttribute('aria-busy', String(searchState.loading));
    $('coverPickerResultCount').textContent = searchState.loading ? '' : (searchState.results.length ? `${searchState.results.length}개` : '');
    const status = $('coverPickerSearchStatus');
    status.classList.toggle('is-error', Boolean(searchState.error));
    if (searchState.loading) status.textContent = '표지를 검색하고 있습니다.';
    else if (searchState.error) status.textContent = searchState.error;
    else if (!searchState.searched) status.textContent = '책 제목으로 표지를 검색해 주세요.';
    else if (!searchState.results.length) status.textContent = '검색 결과가 없습니다. 다른 제목으로 검색해 주세요.';
    else status.textContent = '';
    status.hidden = !status.textContent;
    $('coverPickerResultGrid').replaceChildren(...searchState.results.map(createResult));
    updateResultSelection();
  }

  function updateResultSelection() {
    screen.querySelectorAll('[data-cover-action="result"]').forEach(button => {
      const result = searchState.results[Number(button.dataset.resultIndex)];
      const selected = draft.custom && draft.resultId !== null && draft.resultId !== undefined && result && String(draft.resultId) === String(result.id);
      button.classList.toggle('is-selected', Boolean(selected));
      button.setAttribute('aria-pressed', String(Boolean(selected)));
      button.querySelector('.cover-picker-result-check').hidden = !selected;
    });
  }

  function updatePreview() {
    const credits = $('coverPickerBookCredits');
    credits.textContent = [metadataText(draft.author), metadataText(draft.sourceName)].filter(Boolean).join(' · ');
    credits.hidden = !credits.textContent;
    const hasImage = draft.custom && Boolean(draft.url);
    const image = $('coverPickerImage');
    image.hidden = !hasImage;
    $('coverPickerPreviewTitle').hidden = hasImage;
    $('coverPickerPreview').classList.toggle('has-custom-cover', hasImage);
    if (hasImage) {
      if (image.getAttribute('src') !== draft.url) image.src = draft.url;
    } else image.removeAttribute('src');
    $('coverPickerDefaultCheck').hidden = draft.custom;
    $('coverPickerDefault').setAttribute('aria-pressed', String(!draft.custom));
    $('coverPickerPreviewButton').setAttribute('aria-label', `${state.book?.name || '책'}, 표지 이미지 선택`);
  }

  function updateControls() {
    const unavailable = !state.ready || state.busy || !state.book;
    $('coverPickerSave').disabled = unavailable || !draft.changed;
    $('coverPickerSave').textContent = '저장';
    screen.setAttribute('aria-busy', String(state.busy));
    $('coverPickerPreviewButton').disabled = unavailable;
    $('coverPickerChoose').disabled = unavailable;
    $('coverPickerDefault').disabled = unavailable;
    $('coverPickerRead').disabled = unavailable;
    $('coverPickerSearchButton').disabled = unavailable || searchState.loading || !$('coverPickerSearchInput').value.trim();
    $('coverPickerSearchInput').disabled = !state.ready || state.busy || !state.book;
    screen.querySelectorAll('[data-cover-action="result"]').forEach(button => { button.disabled = unavailable || searchState.loading; });
    screen.querySelector('[data-cover-action="back"]').disabled = state.busy;
  }

  function setStatus(message = '', isError = false) {
    $('coverPickerStatus').textContent = typeof message === 'string' ? message : '';
    $('coverPickerStatus').classList.toggle('is-error', Boolean(isError));
  }

  function show() {
    const wasVisible = document.body.classList.contains('cover-visible');
    if (!wasVisible) {
      previousFocus = document.activeElement;
      const color = document.querySelector('meta[name="theme-color"]');
      previousThemeColor = color?.content || null;
      if (color) color.content = '#111214';
    }
    screen.hidden = false;
    document.body.classList.add('cover-visible');
    if (!wasVisible) {
      window.scrollTo(0, 0);
      $('coverPickerHeading').focus({ preventScroll: true });
    }
  }

  function hide() {
    screen.hidden = true;
    document.body.classList.remove('cover-visible');
    $('coverPickerFile').value = '';
    const color = document.querySelector('meta[name="theme-color"]');
    if (color && previousThemeColor) color.content = previousThemeColor;
    previousThemeColor = null;
    const target = previousFocus;
    previousFocus = null;
    requestAnimationFrame(() => {
      if (target?.isConnected && !target.closest('[hidden]')) target.focus?.({ preventScroll: true });
    });
  }

  screen.addEventListener('click', event => {
    const button = event.target.closest('[data-cover-action]');
    if (!button || !screen.contains(button) || button.disabled) return;
    const action = button.dataset.coverAction;
    if (action === 'choose') $('coverPickerFile').click();
    else if (action === 'default') invoke('useDefault');
    else if (action === 'read') invoke('openBook', state.book?.name);
    else if (action === 'save' && draft.changed) invoke('save');
    else if (action === 'back') invoke('back');
    else if (action === 'result') {
      const result = searchState.results[Number(button.dataset.resultIndex)];
      if (result) invoke('chooseResult', result.id);
    }
  });
  $('coverPickerSearchForm').addEventListener('submit', event => {
    event.preventDefault();
    const query = $('coverPickerSearchInput').value.trim();
    if (!query || !state.ready || state.busy || searchState.loading) return;
    $('coverPickerSearchInput').blur();
    searchState.query = query;
    invoke('search', query);
  });
  $('coverPickerSearchInput').addEventListener('input', updateControls);
  $('coverPickerFile').addEventListener('change', event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file && state.ready && !state.busy) invoke('selectFile', file);
  });
  screen.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !state.busy) {
      event.preventDefault();
      invoke('back');
    }
  });
})();
