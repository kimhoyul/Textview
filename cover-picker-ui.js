/* Unified book management: cover and chapter ordering. app.js owns storage. */
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
        <button class="cover-picker-cancel" type="button" data-cover-action="back">뒤로</button>
        <h1 id="coverPickerHeading" tabindex="-1">작품 관리</h1>
        <button id="coverPickerSave" class="cover-picker-save" type="button" data-cover-action="save" disabled>표지 저장</button>
      </div>
    </header>
    <nav class="book-manager-tabs" role="tablist" aria-label="작품 관리 항목">
      <button id="bookManagerCoverTab" class="is-active" type="button" role="tab" aria-selected="true" aria-controls="coverPickerCoverPanel" data-cover-action="tab-cover">표지 설정</button>
      <button id="bookManagerChaptersTab" type="button" role="tab" aria-selected="false" aria-controls="coverPickerChaptersPanel" data-cover-action="tab-chapters">목차·순서</button>
    </nav>
    <section id="coverPickerCoverPanel" class="cover-picker-content" role="tabpanel" aria-labelledby="bookManagerCoverTab">
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
    <section id="coverPickerChaptersPanel" class="book-manager-chapters" role="tabpanel" aria-labelledby="bookManagerChaptersTab" hidden>
      <header class="book-manager-chapters-heading">
        <h2 id="bookManagerChaptersTitle"></h2>
        <span id="bookManagerChaptersCount"></span>
      </header>
      <label class="book-manager-chapter-search-label" for="bookManagerChapterSearch">목차 검색</label>
      <input id="bookManagerChapterSearch" class="book-manager-chapter-search" type="search" placeholder="회차 번호 또는 TXT 파일명" autocomplete="off" enterkeyhint="search">
      <div class="book-manager-order-tools">
        <p>각 TXT의 위치 이동을 눌러 순서를 변경할 수 있습니다.</p>
        <button id="bookManagerResetOrder" type="button" data-cover-action="reset-order" hidden>회차 번호순 복원</button>
      </div>
      <p id="bookManagerOrderStatus" class="book-manager-order-status" role="status" aria-live="polite"></p>
      <ol id="bookManagerChapterList" class="book-manager-chapter-list"></ol>
      <p id="bookManagerEmptyResults" class="book-manager-empty-results" hidden>일치하는 TXT가 없습니다.</p>
      <button id="bookManagerChapterMore" class="book-manager-chapter-more" type="button" data-cover-action="more-chapters" hidden>목차 더 보기</button>
      <div class="book-manager-file-actions" aria-label="작품 파일 관리">
        <button type="button" data-cover-action="new-txt">새 TXT 만들기</button>
        <button type="button" data-cover-action="import-txt">TXT 가져오기</button>
        <button type="button" data-cover-action="rename-book">책 이름 변경</button>
        <button type="button" data-cover-action="files">백업·삭제 등 관리</button>
      </div>
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
  let selectedTab = 'cover';
  let selectedMoveId = null;
  let orderBusy = false;
  let orderStatus = '';
  let chapterSearch = '';
  let chapterVisibleLimit = 100;
  let editingFilenameId = null;
  let filenameDraft = '';
  let dragState = null;
  const api = { actions: {}, render, show, hide, setDraft, setStatus, setSearch, setTab, hasUnsavedFilenameEdit };
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
    state.chapters = Array.isArray(state.chapters) ? state.chapters.filter(chapter => chapter && typeof chapter.id === 'string') : [];
    state.hasCustomOrder = Boolean(state.hasCustomOrder);
    if (!state.book || typeof state.book.name !== 'string') state.book = null;
    if (previousName !== state.book?.name) {
      selectedMoveId = null;
      editingFilenameId = null;
      filenameDraft = '';
      chapterSearch = '';
      chapterVisibleLimit = 100;
      orderStatus = '';
      $('bookManagerChapterSearch').value = '';
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
    renderChapters();
    updateControls();
    if (data.error !== undefined) setStatus(data.error || '', Boolean(data.error));
  }


  function hasUnsavedFilenameEdit() {
    if (!editingFilenameId) return false;
    const chapter = state.chapters.find(item => item.id === editingFilenameId);
    return !!chapter && filenameDraft !== chapter.name.replace(/\.txt$/i, '');
  }

  function clearFilenameEdit(force = false) {
    if (!force && hasUnsavedFilenameEdit() && !confirm('작성 중인 TXT 파일명 변경을 버릴까요?')) return false;
    editingFilenameId = null;
    filenameDraft = '';
    return true;
  }

  function setTab(tab) {
    if (!['cover', 'chapters'].includes(tab) || orderBusy || dragState) return;
    if (selectedTab !== tab && !clearFilenameEdit()) return;
    if (selectedTab !== tab) selectedMoveId = null;
    selectedTab = tab;
    for (const [name, tabId, panelId] of [
      ['cover', 'bookManagerCoverTab', 'coverPickerCoverPanel'],
      ['chapters', 'bookManagerChaptersTab', 'coverPickerChaptersPanel']
    ]) {
      const selected = name === tab;
      $(tabId).setAttribute('aria-selected', String(selected));
      $(tabId).classList.toggle('is-active', selected);
      $(panelId).hidden = !selected;
    }
    $('coverPickerSave').hidden = tab !== 'cover';
    renderChapters();
    updateControls();
  }

  function renderChapters() {
    if (selectedTab !== 'chapters' || dragState) return;
    const chapters = state.chapters;
    $('bookManagerChaptersTitle').textContent = state.book?.name || '';
    $('bookManagerChaptersCount').textContent = '총 ' + chapters.length.toLocaleString('ko-KR') + '개 TXT';
    const input = $('bookManagerChapterSearch');
    if (input.value !== chapterSearch) input.value = chapterSearch;
    const query = chapterSearch.trim().toLocaleLowerCase('ko');
    const fragment = document.createDocumentFragment();
    let totalMatches = 0;
    let rendered = 0;
    for (let index = 0; index < chapters.length; index++) {
      const chapter = chapters[index];
      const title = String(chapter.title || chapter.name || '제목 없음');
      if (query && !(title + ' ' + chapter.name + ' ' + (index + 1)).toLocaleLowerCase('ko').includes(query)) continue;
      totalMatches++;
      if (rendered >= chapterVisibleLimit) continue;
      rendered++;
      const row = createElement('li', 'book-manager-chapter-row');
      row.dataset.chapterId = chapter.id;
      const info = createElement('div', 'book-manager-chapter-info');
      const rank = createElement('span', 'book-manager-chapter-rank', (index + 1) + '번째');
      const name = createElement('span', 'book-manager-chapter-name', title);
      const filename = createElement('span', 'book-manager-chapter-filename', chapter.name);
      info.append(rank, name, filename);
      const move = createElement('button', 'book-manager-chapter-move', '위치 이동');
      move.type = 'button';
      move.disabled = !state.ready || state.busy || orderBusy;
      move.setAttribute('aria-label', title + ' 순서 변경');
      move.addEventListener('click', () => {
        if (dragState || !clearFilenameEdit()) return;
        selectedMoveId = chapter.id;
        orderStatus = '';
        renderChapters();
        const field = document.getElementById('bookManagerMovePosition');
        field?.focus({ preventScroll: true });
        field?.select();
      });
      const rename = createElement('button', 'book-manager-chapter-rename', '이름 수정');
      rename.type = 'button';
      rename.disabled = !state.ready || state.busy || orderBusy;
      rename.setAttribute('aria-label', title + ' TXT 파일명 수정');
      rename.addEventListener('click', () => {
        if (dragState || orderBusy || !clearFilenameEdit()) return;
        selectedMoveId = null;
        editingFilenameId = chapter.id;
        filenameDraft = chapter.name.replace(/\.txt$/i, '');
        orderStatus = '';
        renderChapters();
        const input = document.getElementById('bookManagerFilenameInput');
        input?.focus({ preventScroll: true });
        input?.select();
      });
      const grip = createElement('button', 'book-manager-drag-handle', '⠿');
      grip.type = 'button';
      grip.disabled = !state.ready || state.busy || orderBusy || !!query;
      grip.setAttribute('aria-label', title + ' 손잡이를 끌어서 순서 이동');
      grip.title = query ? '검색을 지우면 드래그할 수 있습니다.' : '끌어서 순서 이동';
      grip.addEventListener('pointerdown', event => startChapterDrag(event, chapter.id, row, grip));
      row.append(info, rename, move, grip);
      if (editingFilenameId === chapter.id) {
        const form = createElement('form', 'book-manager-filename-form');
        const inputLabel = createElement('label', 'book-manager-filename-label', '저장할 TXT 파일명');
        inputLabel.htmlFor = 'bookManagerFilenameInput';
        const input = createElement('input');
        input.id = 'bookManagerFilenameInput';
        input.type = 'text';
        input.maxLength = 200;
        input.autocomplete = 'off';
        input.required = true;
        input.value = filenameDraft;
        input.disabled = !state.ready || state.busy || orderBusy;
        input.setAttribute('aria-label', 'TXT 파일명, .txt 확장자는 자동 추가');
        input.addEventListener('input', event => { filenameDraft = event.target.value; });
        const save = createElement('button', 'book-manager-filename-save', '변경 저장');
        save.type = 'submit';
        save.disabled = !state.ready || state.busy || orderBusy;
        const cancel = createElement('button', 'book-manager-filename-cancel', '취소');
        cancel.type = 'button';
        cancel.disabled = orderBusy;
        cancel.addEventListener('click', () => {
          if (!clearFilenameEdit()) return;
          renderChapters();
        });
        form.append(inputLabel, input, save, cancel);
        form.addEventListener('submit', event => {
          event.preventDefault();
          void applyFilenameRename(chapter.id);
        });
        row.appendChild(form);
      }
      if (selectedMoveId === chapter.id) {
        const form = createElement('form', 'book-manager-chapter-position');
        const position = createElement('input');
        position.type = 'number';
        position.inputMode = 'numeric';
        position.step = '1';
        position.min = '1';
        position.max = String(chapters.length);
        position.value = String(index + 1);
        position.id = 'bookManagerMovePosition';
        position.required = true;
        position.setAttribute('aria-label', '이동할 위치');
        const submit = createElement('button', 'book-manager-position-save', '적용');
        submit.type = 'submit';
        submit.disabled = !state.ready || state.busy || orderBusy;
        form.append(createElement('span', 'book-manager-position-label', '이동 위치 (1~' + chapters.length + ')'), position, submit);
        form.addEventListener('submit', event => {
          event.preventDefault();
          void applyChapterMove(chapter.id, position.value);
        });
        row.appendChild(form);
      }
      fragment.appendChild(row);
    }
    $('bookManagerChapterList').replaceChildren(fragment);
    $('bookManagerEmptyResults').hidden = totalMatches > 0;
    $('bookManagerChapterMore').hidden = rendered >= totalMatches;
    $('bookManagerChapterMore').textContent = '목차 더 보기 (' + rendered + ' / ' + totalMatches + ')';
    $('bookManagerChapterMore').disabled = !state.ready || state.busy || orderBusy;
    $('bookManagerResetOrder').hidden = !state.hasCustomOrder;
    $('bookManagerResetOrder').disabled = !state.ready || state.busy || orderBusy;
    $('bookManagerOrderStatus').textContent = orderStatus;
    screen.querySelectorAll('.book-manager-file-actions button').forEach(button => { button.disabled = !state.ready || state.busy || orderBusy; });
  }


  async function applyFilenameRename(id) {
    if (!state.book || !state.ready || state.busy || orderBusy || editingFilenameId !== id) return;
    const original = state.chapters.find(chapter => chapter.id === id);
    if (!original) { orderStatus = '수정할 회차를 찾지 못했습니다.'; renderChapters(); return; }
    if (filenameDraft === original.name.replace(/\.txt$/i, '')) {
      editingFilenameId = null;
      renderChapters();
      return;
    }
    const requestedName = filenameDraft;
    orderBusy = true;
    orderStatus = 'TXT 파일명을 저장하는 중…';
    renderChapters();
    try {
      if (typeof api.actions.renameChapterFile !== 'function') throw new Error('회차 이름 저장 기능을 사용할 수 없습니다.');
      await api.actions.renameChapterFile(state.book.name, id, requestedName);
      editingFilenameId = null;
      filenameDraft = '';
      orderStatus = 'TXT 파일명이 변경됐습니다. 기존 본문과 읽기 기록은 유지됩니다.';
    } catch (error) {
      orderStatus = error?.message || 'TXT 파일명을 저장하지 못했습니다.';
    } finally {
      orderBusy = false;
      renderChapters();
      updateControls();
    }
  }

  function clearDragVisuals() {
    const drag = dragState;
    if (!drag) return;
    if (drag.dropRow) drag.dropRow.classList.remove('is-drop-before', 'is-drop-after');
    drag.row.classList.remove('is-dragging');
    drag.row.style.removeProperty('transform');
    drag.row.style.removeProperty('pointer-events');
    drag.row.style.removeProperty('z-index');
    drag.row.style.removeProperty('position');
    try { if (drag.handle.hasPointerCapture?.(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId); } catch {}
    window.removeEventListener('pointermove', moveChapterDrag);
    window.removeEventListener('pointerup', endChapterDrag);
    window.removeEventListener('pointercancel', cancelChapterDrag);
    dragState = null;
  }

  function moveChapterDrag(event) {
    const drag = dragState;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    drag.row.style.transform = 'translateY(' + (event.clientY - drag.startY) + 'px)';
    drag.moved = drag.moved || Math.abs(event.clientY - drag.startY) > 6;
    if (event.clientY < 75) window.scrollBy(0, -22);
    else if (event.clientY > window.innerHeight - 75) window.scrollBy(0, 22);
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const target = element?.closest?.('.book-manager-chapter-row');
    if (drag.dropRow) drag.dropRow.classList.remove('is-drop-before', 'is-drop-after');
    drag.dropRow = null;
    drag.targetId = null;
    if (!target || target === drag.row || !$('bookManagerChapterList').contains(target)) return;
    const rect = target.getBoundingClientRect();
    drag.before = event.clientY < rect.top + rect.height / 2;
    drag.targetId = target.dataset.chapterId || null;
    drag.dropRow = target;
    target.classList.add(drag.before ? 'is-drop-before' : 'is-drop-after');
  }

  function startChapterDrag(event, id, row, handle) {
    if (!state.book || !state.ready || state.busy || orderBusy || dragState || selectedTab !== 'chapters') return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (editingFilenameId) {
      orderStatus = 'TXT 이름 수정을 저장하거나 취소한 뒤 순서를 변경해 주세요.';
      renderChapters();
      return;
    }
    if (chapterSearch.trim()) {
      orderStatus = '검색어를 지우면 드래그할 수 있습니다. 멀리 이동할 때는 위치 이동을 사용하세요.';
      renderChapters();
      return;
    }
    event.preventDefault();
    selectedMoveId = null;
    dragState = { id, pointerId: event.pointerId, startY: event.clientY,
      row, handle, targetId: null, dropRow: null, before: true, moved: false };
    row.classList.add('is-dragging');
    row.style.position = 'relative';
    row.style.zIndex = '5';
    row.style.pointerEvents = 'none';
    try { handle.setPointerCapture?.(event.pointerId); } catch {}
    window.addEventListener('pointermove', moveChapterDrag, { passive: false });
    window.addEventListener('pointerup', endChapterDrag);
    window.addEventListener('pointercancel', cancelChapterDrag);
  }

  function cancelChapterDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    clearDragVisuals();
    renderChapters();
  }

  function endChapterDrag(event) {
    const drag = dragState;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const target = drag.targetId, before = drag.before, sourceId = drag.id;
    clearDragVisuals();
    if (!drag.moved || !target || target === sourceId) return;
    const ids = state.chapters.map(chapter => chapter.id);
    const from = ids.indexOf(sourceId);
    if (from < 0) return;
    ids.splice(from, 1);
    const insertAt = ids.indexOf(target) + (before ? 0 : 1);
    if (insertAt < 0) return;
    ids.splice(insertAt, 0, sourceId);
    if (ids.every((id, index) => id === state.chapters[index].id)) return;
    void persistChapterDrag(ids, insertAt + 1);
  }

  async function persistChapterDrag(ids, number) {
    if (!state.book || !state.ready || state.busy || orderBusy) return;
    orderBusy = true;
    orderStatus = '드래그한 목차 순서를 저장하는 중…';
    renderChapters();
    try {
      if (typeof api.actions.saveOrder !== 'function') throw new Error('순서 저장 기능을 사용할 수 없습니다.');
      await api.actions.saveOrder(state.book.name, ids);
      orderStatus = number + '번째로 이동했습니다.';
    } catch (error) {
      orderStatus = error?.message || '목차 순서를 저장하지 못했습니다.';
    } finally {
      orderBusy = false;
      renderChapters();
      updateControls();
    }
  }

  async function applyChapterMove(id, rawPosition) {
    if (!state.book || !state.ready || state.busy || orderBusy) return;
    const ids = state.chapters.map(chapter => chapter.id);
    const from = ids.indexOf(id);
    const to = Number(rawPosition) - 1;
    if (from < 0 || !Number.isSafeInteger(to) || to < 0 || to >= ids.length) {
      orderStatus = '이동 위치는 1부터 ' + ids.length + '까지 입력해 주세요.';
      renderChapters();
      return;
    }
    if (from === to) { selectedMoveId = null; renderChapters(); return; }
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    orderBusy = true;
    orderStatus = '목차 순서를 저장하는 중…';
    renderChapters();
    try {
      if (typeof api.actions.saveOrder !== 'function') throw new Error('순서 저장 기능을 사용할 수 없습니다.');
      await api.actions.saveOrder(state.book.name, ids);
      selectedMoveId = null;
      orderStatus = (to + 1) + '번째로 이동했습니다.';
    } catch (error) {
      orderStatus = error?.message || '회차 순서를 저장하지 못했습니다.';
    } finally {
      orderBusy = false;
      renderChapters();
      updateControls();
    }
  }

  async function resetChapterOrder() {
    if (!state.book || !state.hasCustomOrder || !state.ready || state.busy || orderBusy) return;
    orderBusy = true;
    orderStatus = '회차 번호순으로 복원하는 중…';
    renderChapters();
    try {
      if (typeof api.actions.resetOrder !== 'function') throw new Error('순서 복원 기능을 사용할 수 없습니다.');
      await api.actions.resetOrder(state.book.name);
      selectedMoveId = null;
      orderStatus = '회차 번호순으로 복원했습니다.';
    } catch (error) {
      orderStatus = error?.message || '순서를 복원하지 못했습니다.';
    } finally {
      orderBusy = false;
      renderChapters();
      updateControls();
    }
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
    $('coverPickerSave').disabled = unavailable || !draft.changed || orderBusy;
    $('coverPickerSave').hidden = selectedTab !== 'cover';
    $('coverPickerSave').textContent = '표지 저장';
    screen.setAttribute('aria-busy', String(state.busy || orderBusy));
    $('bookManagerCoverTab').disabled = orderBusy;
    $('bookManagerChaptersTab').disabled = orderBusy;
    $('coverPickerPreviewButton').disabled = unavailable;
    $('coverPickerChoose').disabled = unavailable;
    $('coverPickerDefault').disabled = unavailable;
    $('coverPickerRead').disabled = unavailable;
    $('coverPickerSearchButton').disabled = unavailable || searchState.loading || !$('coverPickerSearchInput').value.trim();
    $('coverPickerSearchInput').disabled = !state.ready || state.busy || !state.book;
    screen.querySelectorAll('[data-cover-action="result"]').forEach(button => { button.disabled = unavailable || searchState.loading; });
    screen.querySelector('[data-cover-action="back"]').disabled = state.busy || orderBusy;
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
    clearDragVisuals();
    screen.hidden = true;
    document.body.classList.remove('cover-visible');
    selectedMoveId = null;
    editingFilenameId = null;
    filenameDraft = '';
    orderStatus = '';
    chapterSearch = '';
    chapterVisibleLimit = 100;
    $('bookManagerChapterSearch').value = '';
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
    if (action === 'tab-cover') setTab('cover');
    else if (action === 'tab-chapters') setTab('chapters');
    else if (action === 'reset-order') { void resetChapterOrder(); }
    else if (action === 'more-chapters') { chapterVisibleLimit += 100; renderChapters(); }
    else if (action === 'new-txt') invoke('newTXT', state.book?.name);
    else if (action === 'import-txt') invoke('importTXT', state.book?.name);
    else if (action === 'rename-book') invoke('renameBook', state.book?.name);
    else if (action === 'files') invoke('manageFiles', state.book?.name);
    else if (action === 'choose') $('coverPickerFile').click();
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
  $('bookManagerChapterSearch').addEventListener('input', event => {
    chapterSearch = event.target.value;
    chapterVisibleLimit = 100;
    selectedMoveId = null;
    renderChapters();
  });
  $('coverPickerFile').addEventListener('change', event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file && state.ready && !state.busy) invoke('selectFile', file);
  });
  screen.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !state.busy && !orderBusy) {
      event.preventDefault();
      invoke('back');
    }
  });
})();
