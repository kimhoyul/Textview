'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const BASE = new URL('./', location.href);
  const PREFIX = 'offline-txt-v2:' + BASE.pathname + ':';
  const DB_NAME = PREFIX + 'bookshelf';
  const MAX_FILE_BYTES = 32 * 1024 * 1024;
  const DEFAULTS = { fontSize: 20, lineHeight: 1.9, padding: 12, verticalPadding: 12,
    dark: true, wrap: 'word', viewMode: 'page', pageEffect: 'none' };
  const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
  const memoryState = new Map();
  let db = null;
  let chapters = [];
  let current = null;
  let readingActive = false;
  let shelfActive = false;
  let nasActive = false;
  let detailActive = false;
  let detailBookName = null;
  let detailReturn = 'home';
  let readerBackTarget = 'shelf';
  let coverActive = false;
  let coverBookName = null;
  let coverDraft = null;
  let coverProcessing = false;
  let coverRequest = 0;
  let coverSearchRequest = 0;
  let coverSearch = { query: '', results: [], loading: false, error: '' };
  const coverURLs = new Map();
  const coverMetadataAttempts = new Set();
  let coverMetadataUpdating = false;
  const episodeTitleMaps = new WeakMap();
  const episodeTitleJobs = new Map();
  const episodeTitleStatus = new Map();
  const episodeTitleGeneration = new Map();
  const episodeTitleRetryAfter = new Map();
  let homeError = '';
  let settings = { ...DEFAULTS };
  let busy = false;
  let switching = false;
  let suppressPosition = false;
  let positionTimer;
  let toastTimer;
  let lastRatio = 0;
  let layoutToken = 0;
  let pendingLayoutRatio = null;
  let lastWidth = innerWidth;
  let stateErrorShown = false;
  let offlineReady = false;
  let registration = null;
  let backupFile = null;
  let backupURL = null;

  // Reading state is synchronously mirrored to localStorage, then persisted to
  // IndexedDB. The synchronous copy also handles a mobile process being suspended.
  function readState(key, fallback) {
    let record = memoryState.get(key);
    try {
      const local = JSON.parse(localStorage.getItem(PREFIX + key) || 'null');
      if (local && typeof local.updatedAt === 'number' &&
          (!record || local.updatedAt >= record.updatedAt)) record = local;
    } catch { /* IndexedDB remains the fallback when localStorage is blocked. */ }
    if (!record) return fallback;
    memoryState.set(key, record);
    return record.value;
  }

  function writeState(key, value) {
    const record = { key, value, updatedAt: Date.now() };
    memoryState.set(key, record);
    try { localStorage.setItem(PREFIX + key, JSON.stringify(record)); } catch { /* See DB fallback below. */ }
    if (db) dbRequest('state', 'put', record).catch(() => {
      if (!stateErrorShown) {
        stateErrorShown = true;
        showToast('읽던 위치 저장에 실패했습니다. 저장 공간을 확인하고 원본 TXT를 보관하세요.');
      }
    });
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('이 환경에서는 기기 책장을 사용할 수 없습니다. Safari 일반 모드로 열어 주세요.'));
      const request = indexedDB.open(DB_NAME, 1);
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        reject(new Error('기기 책장을 열지 못했습니다. 다른 뷰어 창을 닫고 다시 실행해 주세요.'));
      }, 10000);
      request.onupgradeneeded = () => {
        const database = request.result;
        const meta = database.createObjectStore('chapters', { keyPath: 'id' });
        meta.createIndex('book', 'book', { unique: false });
        database.createObjectStore('texts', { keyPath: 'id' });
        database.createObjectStore('state', { keyPath: 'key' });
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        if (settled) { request.result.close(); return; }
        settled = true;
        resolve(request.result);
      };
      request.onerror = () => {
        clearTimeout(timer);
        settled = true;
        reject(request.error || new Error('기기 저장 공간을 열지 못했습니다.'));
      };
      request.onblocked = () => showNotice('다른 뷰어 창을 닫은 후 다시 열어 주세요. 책장 업데이트가 대기 중입니다.');
    });
  }

  // Resolve on transaction completion, not only request success. This ensures
  // "saved" is never shown while a write might still roll back.
  function dbRequest(storeName, method, argument) {
    return new Promise((resolve, reject) => {
      let mode = 'readonly';
      if (['put', 'add', 'delete', 'clear'].includes(method)) mode = 'readwrite';
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let request;
      if (argument === undefined) request = store[method]();
      else request = store[method](argument);
      let result;
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error || request.error || new Error('저장 작업을 완료하지 못했습니다.'));
      tx.onerror = () => { /* onabort delivers the final error. */ };
    });
  }

  function saveChapter(meta, text) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['chapters', 'texts'], 'readwrite');
      tx.objectStore('chapters').add(meta);
      tx.objectStore('texts').add({ id: meta.id, text });
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new Error('TXT 저장에 실패했습니다.'));
      tx.onerror = () => {};
    });
  }

  function chapterId(book, name) { return JSON.stringify([book.normalize('NFC'), name.normalize('NFC')]); }
  function cleanName(name) { return name.replace(/\.txt$/i, ''); }
  function compareFiles(a, b) { return collator.compare(a.name, b.name); }
  function inBook(book) { return chapters.filter(chapter => chapter.book === book).sort(compareFiles); }
  function clamp(value, min, max, fallback) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  }
  function normalizeSettings(value) {
    if (!value || typeof value !== 'object') value = DEFAULTS;
    return {
      fontSize: clamp(value.fontSize, 14, 34, 20),
      lineHeight: clamp(value.lineHeight, 1.4, 2.4, 1.9),
      padding: clamp(value.padding, 12, 40, DEFAULTS.padding),
      verticalPadding: clamp(value.verticalPadding, 12, 40, DEFAULTS.verticalPadding),
      dark: typeof value.dark === 'boolean' ? value.dark : DEFAULTS.dark,
      wrap: value.wrap === 'character' ? 'character' : 'word',
      viewMode: value.viewMode === 'scroll' ? 'scroll' : 'page',
      pageEffect: 'none'
    };
  }
  function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
  function explainError(error) {
    if (error?.name === 'QuotaExceededError') return '기기 저장 공간이 부족합니다. 일부 책이나 다른 데이터를 정리해 주세요.';
    if (error?.name === 'NotReadableError') return '파일을 읽지 못했습니다. 클라우드 파일을 기기에 내려받고 다시 시도해 주세요.';
    return error?.message || String(error);
  }
  function showNotice(message) { $('notice').textContent = message; $('notice').hidden = false; }
  function showToast(message) {
    const toast = $('toast');
    let container = document.body;
    for (const dialog of document.querySelectorAll('dialog')) if (dialog.open) container = dialog;
    container.appendChild(toast);
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
  }
  function showDialog(id) { if (!$(id).open) $(id).showModal(); }
  function closeDialog(id) { $(id).close(); }
  function setBusy(value) {
    busy = value;
    for (const id of ['openBtn', 'emptyImportBtn', 'chaptersBtn', 'exportBtn', 'restoreBtn', 'pickFilesBtn', 'deleteBookBtn', 'addToBookBtn']) {
      $(id).disabled = busy || !db;
    }
    $('bookName').disabled = busy;
    $('encoding').disabled = busy;
    document.querySelectorAll('dialog [data-close]').forEach(button => { button.disabled = busy; });
    $('deleteBookBtn').disabled = busy || !db || inBook($('bookSelect').value).length === 0;
    updateNavigation();
    renderHome();
  }

  function storedCover(book) {
    const value = memoryState.get('cover:' + book)?.value;
    return value?.blob instanceof Blob ? value : null;
  }

  function episodeInfo(book) {
    const value = memoryState.get('episode-titles:' + book)?.value;
    if (!value || typeof value !== 'object' || !window.TextviewEpisodeTitleModel) return null;
    if (!episodeTitleMaps.has(value)) {
      const record = window.TextviewEpisodeTitleModel.normalize(value);
      episodeTitleMaps.set(value, record ? { ...record, titles: new Map(record.episodes.map(item => [item.number, item.title])) } : null);
    }
    const info = episodeTitleMaps.get(value);
    const model = window.TextviewEpisodeTitleModel;
    const author = coverCredits(storedCover(book)).author;
    return info && model.titleKey(info.title) === model.titleKey(book) && (!author || model.authorKey(author) === model.authorKey(info.author)) ? info : null;
  }

  function episodeNumber(chapter) {
    return window.TextviewEpisodeTitleModel?.numberFor(chapter.name, chapter.book) ?? null;
  }

  function displayChapterTitle(chapter, withNumber = false) {
    const number = episodeNumber(chapter);
    const title = number && episodeInfo(chapter.book)?.titles.get(number);
    return title ? (withNumber ? `${number}화 · ${title}` : title) : cleanName(chapter.name);
  }

  async function updateEpisodeTitles(book, force = false) {
    if (!db || busy || episodeTitleJobs.has(book) || !window.TextviewEpisodeTitles || !window.TextviewEpisodeTitleModel) return;
    if (!force && Date.now() < (episodeTitleRetryAfter.get(book) || 0)) return;
    const list = inBook(book);
    if (!list.length) return;
    const numbers = [...new Set(list.map(episodeNumber).filter(Boolean))];
    if (!numbers.length) {
      if (force) { episodeTitleStatus.set(book, { message: '숫자로 된 회차 파일이 없습니다.' }); renderBookDetail(); }
      return;
    }
    if (!navigator.onLine) {
      if (force) { episodeTitleStatus.set(book, { error: '인터넷 연결 후 회차 제목을 불러와 주세요.' }); renderBookDetail(); }
      return;
    }
    const model = bookModel(book);
    const saved = episodeInfo(book);
    const cached = saved && window.TextviewEpisodeTitleModel.titleKey(saved.title) === window.TextviewEpisodeTitleModel.titleKey(book) &&
      (!model.author || window.TextviewEpisodeTitleModel.authorKey(model.author) === window.TextviewEpisodeTitleModel.authorKey(saved.author)) ? saved : null;
    const fresh = cached && cached.checkedAt > Date.now() - 24 * 60 * 60 * 1000;
    if (!force && fresh && numbers.every(number => cached.titles.has(number) || cached.pages.includes(Math.floor((number - 1) / 30) + 1))) return;
    const job = {};
    const generation = episodeTitleGeneration.get(book) || 0;
    episodeTitleJobs.set(book, job);
    const valid = () => !!db && !busy && inBook(book).length && episodeTitleJobs.get(book) === job && (episodeTitleGeneration.get(book) || 0) === generation;
    const status = patch => { if (valid()) { episodeTitleStatus.set(book, patch); renderBookDetail(); } };
    status({ loading: true, message: '회차 제목을 불러오는 중…' });
    let added = 0;
    try {
      const target = cached || await window.TextviewEpisodeTitles.resolveBook(model);
      if (!valid()) return;
      const wanted = force || !fresh ? numbers : numbers.filter(number => !cached.titles.has(number) && !cached.pages.includes(Math.floor((number - 1) / 30) + 1));
      const pages = [...new Set(wanted.map(number => Math.floor((number - 1) / 30) + 1))].sort((a, b) => a - b);
      const titles = new Map(cached?.titles || []);
      const checkedPages = new Set(fresh && !force ? cached?.pages || [] : []);
      let completed = 0;
      for (const page of pages) {
        const result = await window.TextviewEpisodeTitles.getPage(target.productId, page);
        if (!valid()) return;
        if (window.TextviewEpisodeTitleModel.titleKey(result.title) !== window.TextviewEpisodeTitleModel.titleKey(book) ||
            (model.author && window.TextviewEpisodeTitleModel.authorKey(model.author) !== window.TextviewEpisodeTitleModel.authorKey(result.author))) throw new Error('작품 정보가 일치하지 않아 회차 제목을 적용하지 않았습니다.');
        for (const number of titles.keys()) if (number > (page - 1) * 30 && number <= page * 30) titles.delete(number);
        for (const item of result.episodes) titles.set(item.number, item.title);
        checkedPages.add(page);
        const value = window.TextviewEpisodeTitleModel.normalize({ productId: target.productId, title: result.title,
          author: result.author, episodes: [...titles].map(([number, title]) => ({ number, title })), pages: [...checkedPages], checkedAt: completed + 1 === pages.length ? Date.now() : 0 });
        if (!value) throw new Error('회차 제목 정보를 확인하지 못했습니다.');
        const record = { key: 'episode-titles:' + book, value, updatedAt: Date.now() };
        if (!valid()) return;
        await dbRequest('state', 'put', record);
        if (!valid()) return;
        memoryState.set(record.key, record);
        added = numbers.filter(number => titles.has(number)).length;
        status({ loading: true, message: `회차 제목 ${++completed} / ${pages.length} 확인 중…` });
        renderHome();
        renderChapterList();
        if (current?.book === book) {
          renderReaderUI();
          if (readingActive) document.title = displayChapterTitle(current, true) + ' · 호율 시리즈';
        }
      }
      episodeTitleRetryAfter.delete(book);
      status({ message: added ? `회차 제목 ${added.toLocaleString('ko-KR')}개를 저장했습니다.` : '공개된 회차 제목이 없습니다.' });
    } catch (error) {
      episodeTitleRetryAfter.set(book, Date.now() + 5 * 60 * 1000);
      status({ error: (added ? `${added}개 제목을 저장했습니다. ` : '') + explainError(error) });
    } finally {
      if (episodeTitleJobs.get(book) === job) {
        episodeTitleJobs.delete(book);
        if (episodeTitleStatus.get(book)?.loading) { episodeTitleStatus.set(book, {}); renderBookDetail(); }
      }
    }
  }

  function coverCredits(value) {
    const clean = text => typeof text === 'string' ? text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300) : '';
    return { author: clean(Array.isArray(value?.author) ? value.author.filter(item => typeof item === 'string').join(', ') : value?.author),
      sourceName: clean(value?.sourceName) };
  }

  // Older cover records did not retain search metadata. Only exact titles with
  // one consistent author/source can safely supply it without a new selection.
  function matchingCoverCredits(book, results) {
    const titleKey = title => String(title || '').normalize('NFC').replace(/\[(?:독점|완결|연재)\]/g, '').replace(/\s+/g, '').toLocaleLowerCase('ko');
    const matches = results.filter(item => titleKey(item.title) === titleKey(book));
    if (!matches.length) return null;
    const credits = matches.map(coverCredits);
    const first = credits[0];
    return first.author && first.sourceName && credits.every(item => item.author === first.author && item.sourceName === first.sourceName) ? first : null;
  }

  async function updateLegacyCoverMetadata(books) {
    if (coverMetadataUpdating || busy || !db || !navigator.onLine || !window.TextviewCoverSearch?.lookup) return;
    coverMetadataUpdating = true;
    try {
      const sorted = [...books].sort((a, b) => b.lastReadAt - a.lastReadAt);
      for (const book of sorted) {
        if (!db || busy || !navigator.onLine) break;
        const original = memoryState.get('cover:' + book.name);
        const value = original?.value;
        if (!(value?.blob instanceof Blob) || Object.hasOwn(value, 'author') || Object.hasOwn(value, 'sourceName') || coverMetadataAttempts.has(book.name)) continue;
        coverMetadataAttempts.add(book.name);
        try {
          const credits = matchingCoverCredits(book.name, await window.TextviewCoverSearch.lookup(book.name));
          if (!credits || !db || memoryState.get(original.key) !== original) continue;
          const record = { ...original, value: { ...value, ...credits } };
          // A user's newer image selection always takes precedence.
          const saved = await new Promise((resolve, reject) => {
            const tx = db.transaction('state', 'readwrite');
            const store = tx.objectStore('state');
            const request = store.get(original.key);
            let written = false;
            request.onsuccess = () => {
              const existing = request.result;
              if (existing?.updatedAt === original.updatedAt && existing.value?.blob instanceof Blob &&
                  !Object.hasOwn(existing.value, 'author') && !Object.hasOwn(existing.value, 'sourceName')) {
                store.put(record); written = true;
              }
            };
            tx.oncomplete = () => resolve(written);
            tx.onabort = () => reject(tx.error || new Error('작품 정보를 저장하지 못했습니다.'));
            tx.onerror = () => {};
          });
          if (saved && memoryState.get(original.key) === original) {
            memoryState.set(original.key, record);
            if (coverBookName === book.name && coverDraft && !coverDraft.changed) Object.assign(coverDraft, credits);
            renderHome();
          }
        } catch { coverMetadataAttempts.delete(book.name); /* The next online session can retry. */ }
      }
    } finally { coverMetadataUpdating = false; }
  }

  function coverURL(book) {
    const blob = storedCover(book)?.blob;
    const previous = coverURLs.get(book);
    if (previous && previous.blob === blob) return previous.url;
    if (previous) {
      coverURLs.delete(book);
      requestAnimationFrame(() => URL.revokeObjectURL(previous.url));
    }
    if (!blob) return '';
    const url = URL.createObjectURL(blob);
    coverURLs.set(book, { blob, url });
    return url;
  }

  function releaseCoverDraft() {
    if (coverDraft?.ownedURL) URL.revokeObjectURL(coverDraft.url);
    coverDraft = null;
  }

  function hideCoverPicker() {
    coverRequest++;
    coverSearchRequest++;
    window.TextviewCoverPicker?.hide();
    releaseCoverDraft();
    coverActive = false;
    coverBookName = null;
  }

  function renderCoverPicker() {
    if (!coverBookName || !window.TextviewCoverPicker) return;
    window.TextviewCoverPicker.render({ book: bookModel(coverBookName),
      ready: !!db && !busy && !switching, busy: coverProcessing });
    if (coverDraft) window.TextviewCoverPicker.setDraft(coverDraft);
    window.TextviewCoverPicker.setSearch?.(coverSearch);
  }

  function showCoverPicker(book) {
    if (busy || switching || suppressPosition || coverProcessing || !db || !window.TextviewCoverPicker || !inBook(book).length) return;
    savePosition();
    hideCoverPicker();
    coverBookName = book;
    coverActive = true;
    const saved = storedCover(book);
    coverDraft = { url: coverURL(book), custom: !!saved, changed: false, ownedURL: false, ...coverCredits(saved) };
    coverSearch = { query: book, results: [], loading: false, error: '' };
    readingActive = false;
    shelfActive = false;
    nasActive = false;
    detailActive = false;
    detailBookName = null;
    readerBackTarget = 'shelf';
    window.TextviewNAS?.hide();
    window.TextviewReaderUI?.hide();
    window.TextviewReaderLayout?.hide();
    $('reader').hidden = true;
    window.TextviewHome?.hide();
    window.TextviewShelf?.hide();
    window.TextviewBookDetail?.hide();
    renderCoverPicker();
    window.TextviewCoverPicker.setStatus('');
    window.TextviewCoverPicker.show();
    $('themeColor').content = '#111214';
    document.title = book + ' · 표지 선택';
    void searchCovers(book);
  }

  async function searchCovers(query) {
    if (!coverActive || coverProcessing) return;
    window.TextviewCoverPicker.setStatus('');
    const term = String(query || '').trim().slice(0, 120);
    const token = ++coverSearchRequest;
    if (!navigator.onLine) {
      coverSearch = { query: term, results: [], loading: false, error: '인터넷 연결 후 표지를 검색해 주세요.' };
      renderCoverPicker();
      return;
    }
    if (!term) {
      coverSearch = { query: term, results: [], loading: false, error: '작품 제목을 입력해 주세요.' };
      renderCoverPicker();
      return;
    }
    coverSearch = { query: term, results: [], loading: true, error: '' };
    renderCoverPicker();
    try {
      if (!window.TextviewCoverSearch) throw new Error('표지 검색을 불러오지 못했습니다. 앱을 다시 열어 주세요.');
      const results = await window.TextviewCoverSearch.search(term);
      if (!coverActive || token !== coverSearchRequest) return;
      coverSearch = { query: term, results, loading: false, error: '' };
    } catch (error) {
      if (!coverActive || token !== coverSearchRequest) return;
      coverSearch = { query: term, results: [], loading: false, error: explainError(error) };
    }
    renderCoverPicker();
  }

  async function selectCoverFile(file, resultId = '', searchResult = null) {
    if (!coverActive || coverProcessing || busy || !db) return;
    const token = ++coverRequest;
    coverProcessing = true;
    renderCoverPicker();
    window.TextviewCoverPicker.setStatus('표지를 준비하고 있습니다.');
    try {
      const value = await window.TextviewCoverImage.prepare(file);
      if (!coverActive || token !== coverRequest) return;
      releaseCoverDraft();
      coverDraft = { ...value, url: URL.createObjectURL(value.blob), custom: true,
        changed: true, ownedURL: true, resultId, ...coverCredits(searchResult) };
      window.TextviewCoverPicker.setStatus('');
    } catch (error) {
      if (token === coverRequest) window.TextviewCoverPicker.setStatus(explainError(error), true);
    } finally {
      coverProcessing = false;
      renderCoverPicker();
    }
  }

  async function selectSearchCover(id) {
    if (!coverActive || coverProcessing) return;
    const result = coverSearch.results.find(item => item.id === id);
    if (!result) return;
    const token = ++coverRequest;
    coverProcessing = true;
    renderCoverPicker();
    window.TextviewCoverPicker.setStatus('선택한 표지를 불러오고 있습니다.');
    let file;
    try {
      file = await window.TextviewCoverSearch.getImage(result);
    } catch (error) {
      if (token === coverRequest) window.TextviewCoverPicker.setStatus(explainError(error), true);
    } finally {
      coverProcessing = false;
      renderCoverPicker();
    }
    if (file && coverActive && token === coverRequest) await selectCoverFile(file, id, result);
  }

  function useDefaultCover() {
    if (!coverActive || coverProcessing) return;
    releaseCoverDraft();
    coverDraft = { url: '', custom: false, changed: !!storedCover(coverBookName), ownedURL: false, author: '', sourceName: '' };
    window.TextviewCoverPicker.setStatus('');
    renderCoverPicker();
  }

  async function saveCover() {
    if (!coverActive || !coverDraft?.changed || coverProcessing || busy || !db) return;
    const book = coverBookName;
    const key = 'cover:' + book;
    coverProcessing = true;
    renderCoverPicker();
    window.TextviewCoverPicker.setStatus('표지를 저장하고 있습니다.');
    try {
      if (coverDraft.custom) {
        const record = { key, value: { blob: coverDraft.blob, width: coverDraft.width,
          height: coverDraft.height, fileName: coverDraft.fileName, ...coverCredits(coverDraft) }, updatedAt: Date.now() };
        await dbRequest('state', 'put', record);
        memoryState.set(key, record);
      } else {
        await dbRequest('state', 'delete', key);
        memoryState.delete(key);
      }
      coverProcessing = false;
      renderHome();
      showShelf();
      showToast('표지를 저장했습니다.');
    } catch (error) {
      window.TextviewCoverPicker.setStatus('표지 저장에 실패했습니다. ' + explainError(error), true);
    } finally {
      coverProcessing = false;
      renderCoverPicker();
    }
  }

  // Each screen reads the same existing chapter metadata and reading state.
  function bookModel(name) {
    const list = inBook(name);
    if (!list.length) return null;
    const globalLast = readState('last', null);
    const savedId = readState('lastBook:' + name, null);
    const isLastBook = list.some(chapter => chapter.id === globalLast);
    const saved = list.find(chapter => chapter.id === globalLast) || list.find(chapter => chapter.id === savedId);
    const chapter = saved || list[0];
    const ratio = ratioOf(chapter.id);
    return {
      name, count: list.length,
      bytes: list.reduce((sum, item) => sum + item.bytes, 0),
      addedAt: list.reduce((latest, item) => Math.max(latest, item.addedAt || 0), 0),
      lastReadAt: saved ? memoryState.get(isLastBook ? 'last' : 'lastBook:' + name)?.updatedAt || 0 : 0,
      chapterId: chapter.id, chapterName: displayChapterTitle(chapter, true), ratio, hasRead: !!saved,
      progressRatio: (list.findIndex(item => item.id === chapter.id) + ratio) / list.length,
      artIndex: window.TextviewHome?.getArtIndex(name) || 0,
      coverUrl: coverURL(name), hasCustomCover: !!storedCover(name), ...coverCredits(storedCover(name))
    };
  }

  function renderBookDetail() {
    if (!window.TextviewBookDetail || !detailBookName) return;
    const book = bookModel(detailBookName);
    window.TextviewBookDetail.render({ book,
      chapters: inBook(detailBookName).map(chapter => ({
        id: chapter.id, name: chapter.name, title: displayChapterTitle(chapter), episodeNumber: episodeNumber(chapter),
        bytes: chapter.bytes, encoding: chapter.encoding, addedAt: chapter.addedAt,
        ratio: ratioOf(chapter.id),
        hasRead: !!readState('position:' + chapter.id, null) || (book?.hasRead && chapter.id === book.chapterId),
        bookmarked: !!readState('bookmark:' + chapter.id, null)
      })),
      ready: !!db && !busy && !switching,
      hasEpisodeTitles: !!episodeInfo(detailBookName)?.episodes.length,
      titleSync: { ...episodeTitleStatus.get(detailBookName), online: navigator.onLine },
      error: book ? '' : '작품을 찾지 못했습니다.'
    });
  }

  function renderHome() {
    const books = [...new Set(chapters.map(chapter => chapter.book))].map(bookModel).filter(Boolean);
    books.sort((a, b) => b.addedAt - a.addedAt || collator.compare(a.name, b.name));
    const data = { books, lastId: readState('last', null), ready: !!db && !busy, error: homeError };
    window.TextviewHome?.render(data);
    window.TextviewShelf?.render(data);
    window.TextviewNAS?.render({ ready: !!db && !busy, error: homeError });
    renderBookDetail();
    renderCoverPicker();
    void updateLegacyCoverMetadata(books);
  }

  function showHome() {
    if (busy || switching || suppressPosition || coverProcessing) return;
    savePosition();
    hideCoverPicker();
    readingActive = false;
    shelfActive = false;
    nasActive = false;
    detailActive = false;
    detailBookName = null;
    readerBackTarget = 'shelf';
    window.TextviewBookDetail?.hide();
    window.TextviewNAS?.hide();
    window.TextviewReaderUI?.hide();
    window.TextviewReaderLayout?.hide();
    $('reader').hidden = true;
    renderHome();
    window.TextviewShelf?.hide();
    window.TextviewHome?.show();
    $('themeColor').content = '#111214';
    document.title = '호율 시리즈 · 홈';
    window.scrollTo(0, 0);
  }

  function openLibrary(book) {
    if (busy || switching || !db) return;
    savePosition();
    $('chapterSearch').value = '';
    renderBooks(book || current?.book);
    showDialog('libraryDialog');
  }

  function showBookDetail(book, fromReader = false) {
    if (busy || switching || suppressPosition || coverProcessing || !db || !window.TextviewBookDetail) return;
    if (!inBook(book).length) { showToast('작품을 찾지 못했습니다.'); return; }
    savePosition();
    if (!fromReader && !detailActive) detailReturn = shelfActive || coverActive ? 'shelf' : 'home';
    hideCoverPicker();
    detailBookName = book;
    detailActive = true;
    readingActive = false;
    shelfActive = false;
    nasActive = false;
    window.TextviewNAS?.hide();
    window.TextviewReaderUI?.hide();
    window.TextviewReaderLayout?.hide();
    $('reader').hidden = true;
    window.TextviewHome?.hide();
    window.TextviewShelf?.hide();
    renderBookDetail();
    window.TextviewBookDetail.show();
    $('themeColor').content = '#111214';
    document.title = book + ' · 호율 시리즈';
    void updateEpisodeTitles(book);
  }

  function backFromBookDetail() {
    if (detailReturn === 'shelf') showShelf();
    else showHome();
  }

  function backFromReader() {
    if (readerBackTarget === 'detail' && current) showBookDetail(current.book, true);
    else showShelf();
  }

  function showShelf() {
    if (busy || switching || suppressPosition || coverProcessing || !db) return;
    savePosition();
    hideCoverPicker();
    readingActive = false;
    shelfActive = true;
    nasActive = false;
    detailActive = false;
    detailBookName = null;
    readerBackTarget = 'shelf';
    window.TextviewBookDetail?.hide();
    window.TextviewNAS?.hide();
    window.TextviewReaderUI?.hide();
    window.TextviewReaderLayout?.hide();
    $('reader').hidden = true;
    renderHome();
    window.TextviewHome?.hide();
    window.TextviewShelf?.show();
    $('themeColor').content = '#08090b';
    document.title = '호율 시리즈 · 보관함';
  }

  function getRatio() {
    if (readingActive && window.TextviewReaderLayout) return window.TextviewReaderLayout.getRatio();
    const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    if (max === 0) return 0;
    return clamp(scrollY / max, 0, 1, 0);
  }
  function ratioOf(id) {
    return clamp(readState('position:' + id, { ratio: 0 })?.ratio, 0, 1, 0);
  }
  function savePosition() {
    clearTimeout(positionTimer);
    if (!readingActive || !current || suppressPosition || switching) return;
    lastRatio = getRatio();
    writeState('position:' + current.id, { ratio: lastRatio });
  }
  function scrollToRatio(ratio) {
    if (readingActive && window.TextviewReaderLayout) {
      window.TextviewReaderLayout.setRatio(ratio);
      lastRatio = ratio;
      return;
    }
    const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    window.scrollTo(0, max * ratio);
    lastRatio = ratio;
  }
  function updateProgress() {
    if (!readingActive) { renderReaderUI(); return; }
    if (!current) { $('scrollProgress').textContent = '0%'; return; }
    const ratio = getRatio();
    $('scrollProgress').textContent = Math.round(ratio * 100) + '%';
    if (!suppressPosition && !switching) lastRatio = ratio;
    renderReaderUI();
  }

  function showNAS() {
    if (busy || switching || suppressPosition || coverProcessing) return;
    savePosition();
    hideCoverPicker();
    readingActive = false;
    shelfActive = false;
    nasActive = true;
    detailActive = false;
    detailBookName = null;
    readerBackTarget = 'shelf';
    window.TextviewBookDetail?.hide();
    window.TextviewReaderUI?.hide();
    window.TextviewReaderLayout?.hide();
    $('reader').hidden = true;
    window.TextviewHome?.hide();
    window.TextviewShelf?.hide();
    renderHome();
    window.TextviewNAS?.show();
    document.title = '호율 시리즈 · NAS';
  }
  function renderReaderUI() {
    if (!window.TextviewReaderUI) return;
    const list = current ? inBook(current.book) : [];
    const index = list.findIndex(chapter => chapter.id === current?.id);
    const layout = window.TextviewReaderLayout?.getState() || {};
    window.TextviewReaderUI.render({ active: readingActive && !!current,
      backLabel: readerBackTarget === 'detail' ? '작품 상세로 돌아가기' : '보관함으로 돌아가기',
      ready: !!db && !busy && !switching && !suppressPosition && !layout.transitioning, settings,
      chapterName: current ? displayChapterTitle(current, true) : '', bookName: current?.book || '',
      bookmarked: !!(current && readState('bookmark:' + current.id, null)),
      ratio: lastRatio, page: layout.page || 1, pageCount: layout.pageCount || 1,
      canPrevChapter: index > 0, canNextChapter: index >= 0 && index < list.length - 1 });
  }

  function readerLayoutWillChange() {
    if (!readingActive || switching || pendingLayoutRatio !== null || suppressPosition) return;
    pendingLayoutRatio = getRatio();
    suppressPosition = true;
    clearTimeout(positionTimer);
  }
  async function readerLayoutChanged() {
    if (!readingActive || switching) { pendingLayoutRatio = null; return; }
    const ratio = pendingLayoutRatio ?? lastRatio;
    const token = ++layoutToken;
    suppressPosition = true;
    clearTimeout(positionTimer);
    await frames();
    if (token !== layoutToken) return;
    await window.TextviewReaderLayout?.reflow(ratio);
    await frames();
    if (token !== layoutToken) return;
    pendingLayoutRatio = null;
    suppressPosition = false;
    updateProgress();
    savePosition();
  }

  function readerMoved() {
    updateProgress();
    if (readingActive && current && !switching && !suppressPosition) {
      clearTimeout(positionTimer);
      positionTimer = setTimeout(savePosition, 300);
    }
  }
  function frames() { return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); }

  async function openChapter(id) {
    if (switching || busy || suppressPosition || !db) return;
    const meta = chapters.find(chapter => chapter.id === id);
    if (!meta) return;
    savePosition();
    switching = true;
    suppressPosition = true;
    pendingLayoutRatio = null;
    window.TextviewReaderUI?.closeSettings(false, false);
    updateNavigation();
    try {
      const savedRatio = ratioOf(id);
      const content = await dbRequest('texts', 'get', id);
      if (!content || typeof content.text !== 'string') throw new Error('이 TXT의 본문을 찾지 못했습니다. 원본 파일을 다시 가져와 주세요.');
      current = meta;
      if (detailActive) readerBackTarget = 'detail';
      else if (!readingActive) readerBackTarget = 'shelf';
      readingActive = true;
      shelfActive = false;
      nasActive = false;
      detailActive = false;
      window.TextviewBookDetail?.hide();
      window.TextviewNAS?.hide();
      window.TextviewHome?.hide();
      window.TextviewShelf?.hide();
      applySettings();
      $('reader').textContent = content.text; // TXT is never interpreted as HTML.
      $('reader').hidden = false;
      $('empty').hidden = true;
      $('title').textContent = displayChapterTitle(meta, true);
      $('subtitle').textContent = meta.book;
      document.title = displayChapterTitle(meta, true) + ' · 호율 시리즈';
      writeState('last', meta.id);
      writeState('lastBook:' + meta.book, meta.id);
      window.TextviewReaderLayout?.show();
      renderReaderUI();
      await frames();
      await window.TextviewReaderLayout?.reflow(savedRatio);
      scrollToRatio(savedRatio);
      await frames();
    } catch (error) { showToast(explainError(error)); }
    finally {
      switching = false;
      suppressPosition = false;
      updateNavigation();
      updateProgress();
      if (readingActive && current) void updateEpisodeTitles(current.book);
    }
  }
  function updateNavigation() {
    let list = [];
    let index = -1;
    if (current) {
      list = inBook(current.book);
      index = list.findIndex(chapter => chapter.id === current.id);
    }
    $('prevBtn').disabled = busy || switching || index <= 0;
    $('nextBtn').disabled = busy || switching || index < 0 || index >= list.length - 1;
    if (index < 0) $('chapterProgress').textContent = '- / -';
    else $('chapterProgress').textContent = (index + 1) + ' / ' + list.length;
    renderReaderUI();
    renderBookDetail();
  }
  async function goChapter(offset) {
    if (!current || busy || switching) return;
    const list = inBook(current.book);
    const index = list.findIndex(chapter => chapter.id === current.id) + offset;
    if (list[index]) await openChapter(list[index].id);
  }
  function applySettings() {
    const root = document.documentElement.style;
    root.setProperty('--font-size', settings.fontSize + 'px');
    root.setProperty('--line-height', settings.lineHeight);
    root.setProperty('--reader-padding', settings.padding + 'px');
    root.setProperty('--reader-vertical-padding', settings.verticalPadding + 'px');
    window.TextviewReaderLayout?.configure(settings);
    document.body.classList.toggle('dark', settings.dark);
    if (settings.dark) { $('themeBtn').textContent = '라이트'; $('themeColor').content = '#111214'; }
    else { $('themeBtn').textContent = '다크'; $('themeColor').content = '#f7f4ef'; }
    if (!readingActive) $('themeColor').content = '#111214';
    $('lineBtn').textContent = '줄간격 ' + settings.lineHeight;
    $('paddingBtn').textContent = '여백 ' + settings.padding;
    renderReaderUI();
  }
  async function changeSettings(change) {
    if (switching) return;
    const ratio = lastRatio;
    const token = ++layoutToken;
    suppressPosition = true;
    clearTimeout(positionTimer);
    change();
    applySettings();
    writeState('settings', settings);
    await frames();
    if (token !== layoutToken) return;
    await window.TextviewReaderLayout?.reflow(ratio);
    if (token !== layoutToken) return;
    if (readingActive && current) scrollToRatio(ratio);
    await frames();
    if (token !== layoutToken) return;
    suppressPosition = false;
    pendingLayoutRatio = null;
    updateProgress();
    savePosition();
  }
  function nextSetting(values, currentValue) {
    const next = values.find(value => value > currentValue + 0.001);
    if (next !== undefined) return next;
    return values[0];
  }

  async function refreshChapters() {
    chapters = await dbRequest('chapters', 'getAll');
    renderBooks();
    updateNavigation();
    renderOfflineStatus();
    renderHome();
  }
  function renderBooks(preferredBook) {
    let selected = preferredBook || $('bookSelect').value;
    if (!selected && current) selected = current.book;
    const books = [...new Set(chapters.map(chapter => chapter.book))].sort(collator.compare);
    $('bookSelect').replaceChildren();
    for (const book of books) {
      const option = document.createElement('option');
      option.value = book;
      option.textContent = book;
      $('bookSelect').appendChild(option);
    }
    if (books.includes(selected)) $('bookSelect').value = selected;
    $('bookSelect').disabled = books.length === 0;
    renderChapterList();
  }
  function renderChapterList() {
    const book = $('bookSelect').value;
    const list = inBook(book);
    const search = $('chapterSearch').value.trim().toLocaleLowerCase();
    const fragment = document.createDocumentFragment();
    const shown = list.filter(chapter => (chapter.name + ' ' + displayChapterTitle(chapter, true)).toLocaleLowerCase().includes(search));
    for (const chapter of shown) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chapter-row';
      if (current?.id === chapter.id) { button.classList.add('current'); button.setAttribute('aria-current', 'page'); }
      const name = document.createElement('span');
      name.textContent = displayChapterTitle(chapter, true);
      const progress = document.createElement('span');
      progress.textContent = Math.round(ratioOf(chapter.id) * 100) + '%';
      button.append(name, progress);
      button.addEventListener('click', () => {
        if (busy || switching) return;
        closeDialog('libraryDialog');
        void openChapter(chapter.id);
      });
      fragment.appendChild(button);
    }
    if (shown.length === 0) {
      const note = document.createElement('p');
      note.className = 'small';
      note.textContent = '표시할 TXT가 없습니다.';
      fragment.appendChild(note);
    }
    $('chapterList').replaceChildren(fragment);
    $('librarySummary').textContent = '저장된 TXT ' + list.length + '개 · ' + formatBytes(list.reduce((sum, item) => sum + item.bytes, 0));
    $('deleteBookBtn').disabled = busy || list.length === 0;
    $('addToBookBtn').hidden = !shelfActive;
  }
  function openImport(book) {
    if (!db || busy || switching || suppressPosition) return;
    if (!shelfActive) {
      showShelf();
      if (!shelfActive) return;
    }
    let selected = book;
    if (!selected && current) selected = current.book;
    if (!selected) selected = readState('importBook', '내 책');
    $('bookName').value = selected;
    $('importStatus').textContent = '';
    $('importDetails').hidden = true;
    $('importProgress').hidden = true;
    showDialog('importDialog');
  }

  async function decodeFile(file, requested) {
    if (file.size > MAX_FILE_BYTES) throw new Error('파일 하나는 32 MB까지 지원합니다. 큰 파일은 나누어 가져와 주세요.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let encoding = requested;
    let text;
    if (encoding === 'auto') {
      if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
      else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
      else {
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); encoding = 'utf-8'; }
        catch { encoding = 'euc-kr'; }
      }
    }
    if (text === undefined) text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (text.includes('\u0000')) throw new Error('텍스트 인코딩을 확인해 주세요. UTF-16 파일이라면 인코딩을 직접 선택하세요.');
    return { text, encoding };
  }

  async function importFiles(files, options = {}) {
    if (busy || !db || files.length === 0) return { added: 0, skipped: 0, failed: files.length, details: ['서재에 추가할 수 없습니다.'] };
    const book = ((options.bookName ?? $('bookName').value).trim() || '내 책').normalize('NFC').slice(0, 100);
    const encoding = options.encoding ?? $('encoding').value;
    const known = new Set(chapters.map(chapter => chapter.id));
    let added = 0, skipped = 0, failed = 0;
    const details = [];
    setBusy(true);
    $('importProgress').hidden = false;
    $('importProgress').max = files.length;
    $('importProgress').value = 0;
    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        $('importStatus').textContent = (index + 1) + ' / ' + files.length + ' · ' + file.name;
        try {
          if (!/\.txt$/i.test(file.name)) { skipped++; details.push(file.name + ': TXT가 아니어서 제외'); }
          else {
            const id = chapterId(book, file.name);
            if (known.has(id)) { skipped++; details.push(file.name + ': 같은 책에 같은 파일명이 있어 건너뜀'); }
            else {
              const decoded = await decodeFile(file, encoding);
              await saveChapter({ id, book, name: file.name, bytes: file.size, encoding: decoded.encoding, addedAt: Date.now() }, decoded.text);
              known.add(id);
              added++;
            }
          }
        } catch (error) {
          failed++;
          details.push(file.name + ': ' + explainError(error));
          if (error?.name === 'QuotaExceededError') {
            details.push('저장 공간 부족으로 남은 파일 처리를 중단했습니다. 완료된 파일은 유지됩니다.');
            break;
          }
        }
        $('importProgress').value = index + 1;
        if (index % 10 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
      writeState('importBook', book);
      await refreshChapters();
      $('importStatus').textContent = added + '개 저장 완료 · ' + skipped + '개 건너뜀 · ' + failed + '개 실패';
      $('importDetails').textContent = details.slice(0, 50).join('\n');
      $('importDetails').hidden = details.length === 0;
    } catch (error) { $('importStatus').textContent = explainError(error); }
    finally { setBusy(false); $('fileInput').value = ''; }
    const list = inBook(book);
    if (readingActive && list.length && current?.book !== book) {
      let id = readState('lastBook:' + book, list[0].id);
      if (!list.some(item => item.id === id)) id = list[0].id;
      await openChapter(id);
    }
    renderBooks(book);
    return { added, skipped, failed, details };
  }

  async function importDownloaded(files, bookName) {
    if (!db || busy || switching || suppressPosition) throw new Error('서재에 추가할 수 없습니다. 잠시 후 다시 시도해 주세요.');
    if (!Array.isArray(files) || !files.length || typeof bookName !== 'string') throw new Error('TXT 파일과 책 이름을 확인해 주세요.');
    if (files.some(file => !(file instanceof File) || !/\.txt$/i.test(file.name) || file.size > MAX_FILE_BYTES)) throw new Error('32 MB 이하의 TXT 파일만 추가할 수 있습니다.');
    return importFiles(files, { bookName, encoding: 'auto' });
  }

  async function deleteBook() {
    if (busy || switching || !db) return;
    const book = $('bookSelect').value;
    const list = inBook(book);
    if (!list.length || !confirm('“' + book + '”의 TXT ' + list.length + '개를 앱 책장에서 삭제할까요?\n파일 앱에 있는 원본은 삭제하지 않습니다.')) return;
    savePosition();
    setBusy(true);
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['chapters', 'texts', 'state'], 'readwrite');
        for (const chapter of list) {
          tx.objectStore('chapters').delete(chapter.id);
          tx.objectStore('texts').delete(chapter.id);
          tx.objectStore('state').delete('position:' + chapter.id);
          tx.objectStore('state').delete('bookmark:' + chapter.id);
        }
        tx.objectStore('state').delete('cover:' + book);
        tx.objectStore('state').delete('episode-titles:' + book);
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => {};
      });
      for (const chapter of list) {
        memoryState.delete('position:' + chapter.id);
        memoryState.delete('bookmark:' + chapter.id);
        try { localStorage.removeItem(PREFIX + 'position:' + chapter.id); } catch {}
        try { localStorage.removeItem(PREFIX + 'bookmark:' + chapter.id); } catch {}
      }
      memoryState.delete('cover:' + book);
      memoryState.delete('episode-titles:' + book);
      episodeTitleGeneration.set(book, (episodeTitleGeneration.get(book) || 0) + 1);
      episodeTitleJobs.delete(book);
      episodeTitleStatus.delete(book);
      episodeTitleRetryAfter.delete(book);
      coverURL(book);
      if (current?.book === book) {
        readingActive = false;
        window.TextviewReaderUI?.hide();
        window.TextviewReaderLayout?.hide();
        current = null;
        clearTimeout(positionTimer);
        $('reader').textContent = '';
        $('reader').hidden = true;
        $('empty').hidden = false;
        $('title').textContent = '호율 시리즈';
        $('subtitle').textContent = '책장에서 다른 책을 선택하거나 TXT를 추가하세요.';
        document.title = '호율 시리즈';
        lastRatio = 0;
        writeState('last', null);
        window.scrollTo(0, 0);
      }
      await refreshChapters();
      updateProgress();
      showToast('선택한 책을 삭제했습니다.');
    } catch (error) { showToast(explainError(error)); }
    finally {
      setBusy(false); renderChapterList();
    if (!current && !shelfActive && !nasActive) showHome();
    }
  }

  async function makeBackup() {
    if (busy || !db) return;
    savePosition();
    setBusy(true);
    $('backupStatus').textContent = '백업 파일 준비 중…';
    $('backupReady').hidden = true;
    try {
      const texts = await dbRequest('texts', 'getAll');
      const byId = new Map(texts.map(record => [record.id, record.text]));
      const items = chapters.map(meta => {
        const text = byId.get(meta.id);
        if (typeof text !== 'string') throw new Error('누락된 본문이 있어 백업을 중단했습니다: ' + meta.name);
        return { book: meta.book, name: meta.name, text, encoding: meta.encoding,
          position: ratioOf(meta.id), bookmark: readState('bookmark:' + meta.id, null) };
      });
      const payload = { format: 'offline-txt-bookshelf', version: 1, exportedAt: new Date().toISOString(),
        settings, last: readState('last', null), chapters: items };
      const covers = [];
      for (const book of new Set(chapters.map(chapter => chapter.book))) {
        const cover = storedCover(book);
        if (cover) {
          const item = { book, image: await window.TextviewCoverImage.serialize(cover) };
          if (Object.hasOwn(cover, 'author') || Object.hasOwn(cover, 'sourceName')) Object.assign(item, coverCredits(cover));
          covers.push(item);
        }
      }
      if (covers.length) payload.covers = covers;
      const episodeTitles = [];
      for (const book of new Set(chapters.map(chapter => chapter.book))) {
        const value = memoryState.get('episode-titles:' + book)?.value;
        if (window.TextviewEpisodeTitleModel?.normalize(value)) episodeTitles.push({ book, ...value });
      }
      if (episodeTitles.length) payload.episodeTitles = episodeTitles;
      const filename = '호율-시리즈-책장-백업-' + new Date().toISOString().slice(0, 10) + '.json';
      backupFile = new File([JSON.stringify(payload)], filename, { type: 'application/json' });
      if (backupURL) URL.revokeObjectURL(backupURL);
      backupURL = URL.createObjectURL(backupFile);
      $('backupLink').href = backupURL;
      $('backupLink').download = filename;
      $('backupReady').hidden = false;
      $('shareBackupBtn').hidden = true;
      if (navigator.canShare && navigator.canShare({ files: [backupFile] })) $('shareBackupBtn').hidden = false;
      $('backupStatus').textContent = items.length + '개 TXT · ' + formatBytes(backupFile.size) + ' · 아래 버튼으로 파일 앱에 저장하세요.';
    } catch (error) { $('backupStatus').textContent = explainError(error); }
    finally { setBusy(false); }
  }

  async function restoreBackup(file) {
    if (!file || busy || !db) return;
    if (file.size > 200 * 1024 * 1024) { $('backupStatus').textContent = '백업은 200 MB까지 불러올 수 있습니다.'; return; }
    setBusy(true);
    $('backupStatus').textContent = '백업 확인 중…';
    let added = 0, skipped = 0;
    try {
      const payload = JSON.parse(await file.text());
      if (payload?.format !== 'offline-txt-bookshelf' || payload.version !== 1 || !Array.isArray(payload.chapters) || payload.chapters.length > 20000) throw new Error('이 뷰어에서 만든 책장 백업 파일이 아닙니다.');
      // Validate the whole structure before writing; existing chapters are never overwritten.
      for (const item of payload.chapters) {
        if (!item || typeof item.book !== 'string' || !item.book.trim() || item.book.length > 100 ||
            typeof item.name !== 'string' || !item.name || item.name.length > 255 || typeof item.text !== 'string' || item.text.length > MAX_FILE_BYTES) throw new Error('백업에 올바르지 않거나 너무 큰 TXT 항목이 있습니다.');
      }
      const validBooks = new Set([...chapters.map(chapter => chapter.book),
        ...payload.chapters.map(item => item.book.trim().normalize('NFC'))]);
      const restoredCovers = new Map();
      if (payload.covers !== undefined) {
        if (!Array.isArray(payload.covers) || payload.covers.length > validBooks.size) throw new Error('백업의 표지 목록이 올바르지 않습니다.');
        for (const item of payload.covers) {
          if (!item || typeof item.book !== 'string' || !item.book.trim() || item.book.length > 100) throw new Error('백업의 표지 작품명이 올바르지 않습니다.');
          const book = item.book.trim().normalize('NFC');
          if (!validBooks.has(book) || restoredCovers.has(book)) throw new Error('백업의 표지 작품명이 올바르지 않습니다.');
          for (const field of ['author', 'sourceName']) {
            if (item[field] !== undefined && (typeof item[field] !== 'string' || item[field].length > 300 || /[\u0000-\u001f\u007f]/.test(item[field]))) throw new Error('백업의 작품 정보가 올바르지 않습니다.');
          }
          const value = await window.TextviewCoverImage.restore(item.image);
          if (item.author !== undefined || item.sourceName !== undefined) Object.assign(value, coverCredits(item));
          restoredCovers.set(book, value);
        }
      }
      const restoredTitles = new Map();
      if (payload.episodeTitles !== undefined) {
        if (!Array.isArray(payload.episodeTitles) || payload.episodeTitles.length > validBooks.size) throw new Error('백업의 회차 제목 목록이 올바르지 않습니다.');
        for (const item of payload.episodeTitles) {
          if (!item || typeof item.book !== 'string' || !item.book.trim() || item.book.length > 100) throw new Error('백업의 회차 제목 작품명이 올바르지 않습니다.');
          const book = item.book.trim().normalize('NFC');
          const value = window.TextviewEpisodeTitleModel?.normalize(item);
          if (!value || !validBooks.has(book) || restoredTitles.has(book) || window.TextviewEpisodeTitleModel.titleKey(value.title) !== window.TextviewEpisodeTitleModel.titleKey(book)) throw new Error('백업의 회차 제목 정보가 올바르지 않습니다.');
          restoredTitles.set(book, value);
        }
      }
      const wasEmpty = chapters.length === 0;
      const availableBooks = new Set(chapters.map(chapter => chapter.book));
      const known = new Set(chapters.map(chapter => chapter.id));
      for (const item of payload.chapters) {
        const book = item.book.trim().normalize('NFC');
        const id = chapterId(book, item.name);
        if (known.has(id)) { skipped++; continue; }
        await saveChapter({ id, book, name: item.name, bytes: new Blob([item.text]).size, encoding: 'backup', addedAt: Date.now() }, item.text);
        availableBooks.add(book);
        known.add(id);
        writeState('position:' + id, { ratio: clamp(item.position, 0, 1, 0) });
        if (item.bookmark && typeof item.bookmark.ratio === 'number') {
          writeState('bookmark:' + id, { ratio: clamp(item.bookmark.ratio, 0, 1, 0) });
        }
        added++;
        if (added % 10 === 0) {
          $('backupStatus').textContent = added + '개 복원 중…';
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      for (const [book, value] of restoredCovers) {
        if (!availableBooks.has(book)) continue;
        const key = 'cover:' + book;
        const record = await dbRequest('state', 'get', key);
        if (record?.value?.blob instanceof Blob) { memoryState.set(key, record); continue; }
        const restored = { key, value, updatedAt: Date.now() };
        await dbRequest('state', 'put', restored);
        memoryState.set(key, restored);
      }
      for (const [book, value] of restoredTitles) {
        if (!availableBooks.has(book)) continue;
        const key = 'episode-titles:' + book;
        const existing = await dbRequest('state', 'get', key);
        if (window.TextviewEpisodeTitleModel.normalize(existing?.value)) { memoryState.set(key, existing); continue; }
        const record = { key, value, updatedAt: Date.now() };
        await dbRequest('state', 'put', record);
        memoryState.set(key, record);
      }
      if (wasEmpty) {
        settings = normalizeSettings(payload.settings);
        applySettings();
        writeState('settings', settings);
        if (typeof payload.last === 'string' && known.has(payload.last)) writeState('last', payload.last);
      }
      $('backupStatus').textContent = added + '개 복원 완료 · 같은 파일명 ' + skipped + '개 건너뜀';
    } catch (error) { $('backupStatus').textContent = added + '개 복원됨. ' + explainError(error); }
    finally {
      try { await refreshChapters(); } catch (error) { showToast(explainError(error)); }
      setBusy(false);
      $('backupInput').value = '';
    }
    if (readingActive && !current && chapters.length) {
      let id = readState('last', chapters[0].id);
      if (!chapters.some(chapter => chapter.id === id)) id = chapters[0].id;
      await openChapter(id);
    }
  }

  function renderOfflineStatus(message) {
    const button = $('offlineStatus');
    button.classList.toggle('ready', offlineReady && !!db);
    button.classList.toggle('error', !offlineReady);
    if (message) { button.textContent = message; return; }
    if (offlineReady && db) {
      let text = '앱 저장 완료 · TXT ' + chapters.length + '개 기기 보관';
      if (!navigator.onLine) text += ' · 오프라인';
      button.textContent = text;
    } else if (!db) button.textContent = '기기 책장 준비 상태를 확인해 주세요';
    else button.textContent = '앱 오프라인 저장 미완료 · 설치·저장에서 확인';
  }

  function askWorker(worker, repair) {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); reject(new Error('앱 저장 상태 응답이 없습니다. 인터넷 연결 후 다시 열어 주세요.')); }, 10000);
      channel.port1.onmessage = event => {
        clearTimeout(timer);
        channel.port1.close();
        resolve(event.data);
      };
      worker.postMessage({ type: 'CHECK_OFFLINE', repair }, [channel.port2]);
    });
  }

  async function checkOffline(repair = false) {
    try {
      if (!window.isSecureContext || !['https:', 'http:'].includes(location.protocol) || !('serviceWorker' in navigator)) {
        throw new Error('오프라인 설치에는 HTTPS 주소가 필요합니다. 파일 앱의 HTML 미리보기나 일반 HTTP 내부 IP로는 설치할 수 없습니다.');
      }
      const worker = navigator.serviceWorker.controller || registration?.active;
      if (!worker) throw new Error('앱을 기기에 저장하는 중입니다. 연결 상태를 확인한 뒤 다시 확인해 주세요.');
      const result = await askWorker(worker, repair);
      if (!result.ready) throw new Error('필수 앱 파일 저장 미완료: ' + (result.missing || []).join(', ') + '. 인터넷 연결 상태에서 다시 확인하세요.');
      if (!navigator.serviceWorker.controller) throw new Error('앱 파일은 저장되었습니다. 인터넷이 연결된 상태에서 앱을 한 번 닫았다가 다시 열어 주세요.');
      if (!db) throw new Error('앱 파일은 저장되었지만 기기 책장을 사용할 수 없습니다. Safari 일반 모드에서 다시 열어 주세요.');
      await dbRequest('chapters', 'count');
      offlineReady = true;
      $('cacheDetails').textContent = '앱 파일 저장 완료 · 기기 책장 접근 정상 · 버전 ' + result.version + '. 가져온 TXT는 인터넷 없이 열 수 있습니다.';
    } catch (error) {
      offlineReady = false;
      $('cacheDetails').textContent = explainError(error);
    }
    renderOfflineStatus();
  }

  async function setupOffline() {
    if (!window.isSecureContext || !['https:', 'http:'].includes(location.protocol) || !('serviceWorker' in navigator)) {
      await checkOffline();
      showNotice($('cacheDetails').textContent);
      return;
    }
    navigator.serviceWorker.addEventListener('controllerchange', () => { void checkOffline(); });
    try {
      registration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
      navigator.serviceWorker.ready.then(() => checkOffline()).catch(() => {});
      if (navigator.serviceWorker.controller) await checkOffline();
      else renderOfflineStatus('앱을 기기에 저장하는 중…');
      if (registration.installing) {
        const installing = registration.installing;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'redundant' && !navigator.serviceWorker.controller) {
            $('cacheDetails').textContent = '필수 앱 파일 설치에 실패했습니다. HTTPS 주소와 파일 업로드 상태를 확인하고 다시 실행하세요.';
            renderOfflineStatus('앱 설치 미완료 · 설치·저장에서 확인');
          }
        });
      }
      if (registration.waiting) $('cacheDetails').textContent += ' 새 버전은 이 앱의 모든 창을 닫고 다시 열면 적용됩니다.';
    } catch (error) {
      if (navigator.serviceWorker.controller) await checkOffline();
      else {
        $('cacheDetails').textContent = '앱 설치 실패: ' + explainError(error);
        renderOfflineStatus('앱 저장 실패 · 설치·저장에서 확인');
      }
    }
  }

  async function openHelp() {
    if (busy || switching || !db) return;
    if (!readingActive) {
      const id = current?.id || readState('last', null) || chapters[0]?.id;
      if (!id) { showToast('작품을 선택한 뒤 읽기 설정을 열어 주세요.'); return; }
      await openChapter(id);
    }
    if (readingActive) window.TextviewReaderUI?.openSettings();
  }

  function toggleBookmark() {
    if (!readingActive || !current || busy || switching) return;
    const key = 'bookmark:' + current.id;
    const marked = readState(key, null);
    writeState(key, marked ? null : { ratio: getRatio() });
    renderReaderUI();
  }

  // Event bindings: file pickers and sharing are opened directly by user gestures.
  $('openBtn').addEventListener('click', () => openImport());
  $('emptyImportBtn').addEventListener('click', () => openImport());
  $('pickFilesBtn').addEventListener('click', () => { $('fileInput').value = ''; $('fileInput').click(); });
  $('fileInput').addEventListener('change', () => { void importFiles(Array.from($('fileInput').files || [])); });
  $('prevBtn').addEventListener('click', () => { void goChapter(-1); });
  $('nextBtn').addEventListener('click', () => { void goChapter(1); });
  $('homeBtn').addEventListener('click', showHome);
  $('chaptersBtn').addEventListener('click', () => openLibrary());
  if (window.TextviewHome) window.TextviewHome.actions = {
    openChapter: id => { void openChapter(id); }, openNAS: showNAS,
    openBook: showBookDetail, openLibrary: showShelf,
    openImport: () => openImport(), openHelp, showHome, notify: showToast
  };
  if (window.TextviewShelf) window.TextviewShelf.actions = {
    openBook: showCoverPicker, manageBook: openLibrary, openImport: () => openImport(), openHelp,
    showHome, notify: showToast
  };
  if (window.TextviewNAS) window.TextviewNAS.actions = { showHome, showShelf, importDownloaded, notify: showToast };
  if (window.TextviewBookDetail) window.TextviewBookDetail.actions = {
    back: backFromBookDetail, openChapter, notify: showToast, refreshTitles: book => updateEpisodeTitles(book, true)
  };
  if (window.TextviewCoverPicker) window.TextviewCoverPicker.actions = {
    back: showShelf, selectFile: selectCoverFile, useDefault: useDefaultCover,
    save: saveCover, openBook: showBookDetail, search: searchCovers, chooseResult: selectSearchCover
  };
  if (window.TextviewReaderUI) window.TextviewReaderUI.actions = {
    back: backFromReader, toggleBookmark, openContents: () => openLibrary(current?.book),
    edit: () => $('editBtn').click(),
    changeSettings: patch => changeSettings(() => {
      settings = normalizeSettings({ ...settings, ...patch });
    }),
    page: delta => {
      if (readingActive && !busy && !switching && !suppressPosition) window.TextviewReaderLayout?.page(delta);
    },
    layoutWillChange: readerLayoutWillChange, layoutChanged: readerLayoutChanged,
    notify: showToast
  };
  $('bookSelect').addEventListener('change', renderChapterList);
  $('chapterSearch').addEventListener('input', renderChapterList);
  $('addToBookBtn').addEventListener('click', () => {
    const book = $('bookSelect').value;
    closeDialog('libraryDialog');
    openImport(book);
  });
  $('deleteBookBtn').addEventListener('click', () => { void deleteBook(); });
  $('fontDownBtn').addEventListener('click', () => { void changeSettings(() => { settings.fontSize = Math.max(14, settings.fontSize - 1); }); });
  $('fontUpBtn').addEventListener('click', () => { void changeSettings(() => { settings.fontSize = Math.min(34, settings.fontSize + 1); }); });
  $('lineBtn').addEventListener('click', () => { void changeSettings(() => { settings.lineHeight = nextSetting([1.6, 1.8, 1.9, 2.0, 2.2], settings.lineHeight); }); });
  $('paddingBtn').addEventListener('click', () => { void changeSettings(() => { settings.padding = nextSetting([14, 18, 22, 28, 34], settings.padding); }); });
  $('themeBtn').addEventListener('click', () => { void changeSettings(() => { settings.dark = !settings.dark; }); });
  $('topBtn').addEventListener('click', () => { scrollToRatio(0); savePosition(); updateProgress(); });
  $('helpBtn').addEventListener('click', openHelp);
  $('offlineStatus').addEventListener('click', openHelp);
  $('checkOfflineBtn').addEventListener('click', async () => {
    $('checkOfflineBtn').disabled = true;
    $('cacheDetails').textContent = '필수 앱 파일 확인 중…';
    await checkOffline(navigator.onLine);
    $('checkOfflineBtn').disabled = false;
  });
  $('exportBtn').addEventListener('click', () => { void makeBackup(); });
  $('restoreBtn').addEventListener('click', () => { $('backupInput').value = ''; $('backupInput').click(); });
  $('backupInput').addEventListener('change', () => { void restoreBackup($('backupInput').files?.[0]); });
  $('shareBackupBtn').addEventListener('click', async () => {
    if (!backupFile) return;
    try { await navigator.share({ files: [backupFile], title: '호율 시리즈 책장 백업' }); }
    catch (error) { if (error.name !== 'AbortError') $('backupStatus').textContent = explainError(error); }
  });
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  });
  window.addEventListener('scroll', readerMoved, { passive: true });
  window.TextviewReaderLayout?.onChange(readerMoved);
  window.addEventListener('pagehide', savePosition);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') savePosition();
  });
  window.addEventListener('resize', () => {
    // Ignore Safari address-bar height changes; restore only after a width change.
    if (Math.abs(innerWidth - lastWidth) < 2) return;
    lastWidth = innerWidth;
    if (readingActive && current && !switching) void changeSettings(() => {});
  });
  window.addEventListener('online', () => { void checkOffline(); renderHome(); if (detailActive && detailBookName) void updateEpisodeTitles(detailBookName); else if (readingActive && current) void updateEpisodeTitles(current.book); });
  window.addEventListener('offline', () => { renderOfflineStatus(); renderBookDetail(); });
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  async function start() {
    settings = normalizeSettings(readState('settings', DEFAULTS));
    applySettings();
    showHome();
    try {
      db = await openDatabase();
      db.onversionchange = () => {
        db.close(); db = null;
        homeError = '앱이 업데이트되었습니다. 앱을 닫았다가 다시 열어 주세요.';
        setBusy(false); showNotice(homeError);
      };
      const storedState = await dbRequest('state', 'getAll');
      for (const record of storedState) memoryState.set(record.key, record);
      settings = normalizeSettings(readState('settings', DEFAULTS));
      applySettings();
      await refreshChapters();
      setBusy(false);
      let last = readState('last', null);
      if (!chapters.some(chapter => chapter.id === last) && chapters.length) last = [...chapters].sort(compareFiles)[0].id;
      current = chapters.find(chapter => chapter.id === last) || null;
      // Editing reloads the page. Consume its one-shot marker to keep that flow.
      let returnToReader = null;
      try {
        returnToReader = sessionStorage.getItem(PREFIX + 'returnToReader');
        sessionStorage.removeItem(PREFIX + 'returnToReader');
      } catch { /* Normal launches still show Home when sessionStorage is blocked. */ }
      if (returnToReader && chapters.some(chapter => chapter.id === returnToReader)) await openChapter(returnToReader);
      else showHome();
    } catch (error) {
      db = null;
      homeError = '기기 책장을 열지 못했습니다. ' + explainError(error);
      setBusy(false);
      showNotice(homeError);
    }
    await setupOffline();
  }
  void start();
})();
