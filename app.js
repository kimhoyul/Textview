'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const BASE = new URL('./', location.href);
  const PREFIX = 'offline-txt-v2:' + BASE.pathname + ':';
  const DB_NAME = PREFIX + 'bookshelf';
  const MAX_FILE_BYTES = 32 * 1024 * 1024;
  const DEFAULTS = { fontSize: 20, lineHeight: 1.9, padding: 22, dark: false };
  const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
  const memoryState = new Map();
  let db = null;
  let chapters = [];
  let current = null;
  let settings = { ...DEFAULTS };
  let busy = false;
  let switching = false;
  let suppressPosition = false;
  let positionTimer;
  let toastTimer;
  let lastRatio = 0;
  let layoutToken = 0;
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
      padding: clamp(value.padding, 12, 40, 22),
      dark: value.dark === true
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
  }

  function getRatio() {
    const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    if (max === 0) return 0;
    return clamp(scrollY / max, 0, 1, 0);
  }
  function ratioOf(id) {
    return clamp(readState('position:' + id, { ratio: 0 })?.ratio, 0, 1, 0);
  }
  function savePosition() {
    clearTimeout(positionTimer);
    if (!current || suppressPosition || switching) return;
    lastRatio = getRatio();
    writeState('position:' + current.id, { ratio: lastRatio });
  }
  function scrollToRatio(ratio) {
    const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    window.scrollTo(0, max * ratio);
    lastRatio = ratio;
  }
  function updateProgress() {
    if (!current) { $('scrollProgress').textContent = '0%'; return; }
    const ratio = getRatio();
    $('scrollProgress').textContent = Math.round(ratio * 100) + '%';
    if (!suppressPosition && !switching) lastRatio = ratio;
  }
  function frames() { return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); }

  async function openChapter(id) {
    if (switching || busy || suppressPosition || !db) return;
    const meta = chapters.find(chapter => chapter.id === id);
    if (!meta) return;
    savePosition();
    switching = true;
    suppressPosition = true;
    updateNavigation();
    try {
      const savedRatio = ratioOf(id);
      const content = await dbRequest('texts', 'get', id);
      if (!content || typeof content.text !== 'string') throw new Error('이 TXT의 본문을 찾지 못했습니다. 원본 파일을 다시 가져와 주세요.');
      current = meta;
      $('reader').textContent = content.text; // TXT is never interpreted as HTML.
      $('reader').hidden = false;
      $('empty').hidden = true;
      $('title').textContent = cleanName(meta.name);
      $('subtitle').textContent = meta.book;
      document.title = cleanName(meta.name) + ' · TXT 책장';
      writeState('last', meta.id);
      writeState('lastBook:' + meta.book, meta.id);
      await frames();
      scrollToRatio(savedRatio);
      await frames();
    } catch (error) { showToast(explainError(error)); }
    finally {
      switching = false;
      suppressPosition = false;
      updateNavigation();
      updateProgress();
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
    document.body.classList.toggle('dark', settings.dark);
    if (settings.dark) { $('themeBtn').textContent = '라이트'; $('themeColor').content = '#111214'; }
    else { $('themeBtn').textContent = '다크'; $('themeColor').content = '#f7f4ef'; }
    $('lineBtn').textContent = '줄간격 ' + settings.lineHeight;
    $('paddingBtn').textContent = '여백 ' + settings.padding;
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
    if (current) scrollToRatio(ratio);
    await frames();
    if (token !== layoutToken) return;
    suppressPosition = false;
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
    const shown = list.filter(chapter => chapter.name.toLocaleLowerCase().includes(search));
    for (const chapter of shown) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chapter-row';
      if (current?.id === chapter.id) { button.classList.add('current'); button.setAttribute('aria-current', 'page'); }
      const name = document.createElement('span');
      name.textContent = cleanName(chapter.name);
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
  }
  function openImport(book) {
    if (!db || busy || switching) return;
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

  async function importFiles(files) {
    if (busy || !db || files.length === 0) return;
    const book = ($('bookName').value.trim() || '내 책').normalize('NFC').slice(0, 100);
    const encoding = $('encoding').value;
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
    if (list.length && current?.book !== book) {
      let id = readState('lastBook:' + book, list[0].id);
      if (!list.some(item => item.id === id)) id = list[0].id;
      await openChapter(id);
    }
    renderBooks(book);
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
        }
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => {};
      });
      for (const chapter of list) {
        memoryState.delete('position:' + chapter.id);
        try { localStorage.removeItem(PREFIX + 'position:' + chapter.id); } catch {}
      }
      if (current?.book === book) {
        current = null;
        clearTimeout(positionTimer);
        $('reader').textContent = '';
        $('reader').hidden = true;
        $('empty').hidden = false;
        $('title').textContent = '오프라인 TXT 책장';
        $('subtitle').textContent = '책장에서 다른 책을 선택하거나 TXT를 추가하세요.';
        document.title = '오프라인 TXT 책장';
        lastRatio = 0;
        writeState('last', null);
        window.scrollTo(0, 0);
      }
      await refreshChapters();
      updateProgress();
      showToast('선택한 책을 삭제했습니다.');
    } catch (error) { showToast(explainError(error)); }
    finally { setBusy(false); renderChapterList(); }
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
        return { book: meta.book, name: meta.name, text, encoding: meta.encoding, position: ratioOf(meta.id) };
      });
      const payload = { format: 'offline-txt-bookshelf', version: 1, exportedAt: new Date().toISOString(),
        settings, last: readState('last', null), chapters: items };
      const filename = 'TXT-책장-백업-' + new Date().toISOString().slice(0, 10) + '.json';
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
      const wasEmpty = chapters.length === 0;
      const known = new Set(chapters.map(chapter => chapter.id));
      for (const item of payload.chapters) {
        const book = item.book.trim().normalize('NFC');
        const id = chapterId(book, item.name);
        if (known.has(id)) { skipped++; continue; }
        await saveChapter({ id, book, name: item.name, bytes: new Blob([item.text]).size, encoding: 'backup', addedAt: Date.now() }, item.text);
        known.add(id);
        writeState('position:' + id, { ratio: clamp(item.position, 0, 1, 0) });
        added++;
        if (added % 10 === 0) {
          $('backupStatus').textContent = added + '개 복원 중…';
          await new Promise(resolve => setTimeout(resolve, 0));
        }
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
    if (!current && chapters.length) {
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

  async function showStorage() {
    $('persistInfo').textContent = '보호를 요청해도 기기나 브라우저가 승인하지 않을 수 있습니다.';
    try {
      if (navigator.storage?.estimate) {
        const estimate = await navigator.storage.estimate();
        $('storageInfo').textContent = '이 웹 주소의 사용량 약 ' + formatBytes(estimate.usage || 0) + ' / 허용량 약 ' + formatBytes(estimate.quota || 0);
      } else $('storageInfo').textContent = '이 환경에서는 저장 공간 사용량을 표시할 수 없습니다.';
      if (navigator.storage?.persisted) {
        if (await navigator.storage.persisted()) $('persistInfo').textContent = '저장 공간 보호가 승인된 상태입니다. 사용자가 데이터를 삭제하면 복구되지 않으므로 백업은 보관하세요.';
      }
    } catch { $('storageInfo').textContent = '저장 공간 정보를 읽지 못했습니다.'; }
  }
  function openHelp() { showDialog('helpDialog'); void showStorage(); void checkOffline(); }

  // Event bindings: file pickers and sharing are opened directly by user gestures.
  $('openBtn').addEventListener('click', () => openImport());
  $('emptyImportBtn').addEventListener('click', () => openImport());
  $('pickFilesBtn').addEventListener('click', () => { $('fileInput').value = ''; $('fileInput').click(); });
  $('fileInput').addEventListener('change', () => { void importFiles(Array.from($('fileInput').files || [])); });
  $('prevBtn').addEventListener('click', () => { void goChapter(-1); });
  $('nextBtn').addEventListener('click', () => { void goChapter(1); });
  $('chaptersBtn').addEventListener('click', () => {
    if (busy || switching) return;
    savePosition();
    $('chapterSearch').value = '';
    renderBooks(current?.book);
    showDialog('libraryDialog');
  });
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
  $('topBtn').addEventListener('click', () => { window.scrollTo(0, 0); savePosition(); updateProgress(); });
  $('helpBtn').addEventListener('click', openHelp);
  $('offlineStatus').addEventListener('click', openHelp);
  $('checkOfflineBtn').addEventListener('click', async () => {
    $('checkOfflineBtn').disabled = true;
    $('cacheDetails').textContent = '필수 앱 파일 확인 중…';
    await checkOffline(navigator.onLine);
    $('checkOfflineBtn').disabled = false;
  });
  $('persistBtn').addEventListener('click', async () => {
    try {
      if (!navigator.storage?.persist) throw new Error('이 환경에서는 저장 공간 보호를 요청할 수 없습니다. 원본 TXT를 보관하세요.');
      const granted = await navigator.storage.persist();
      if (granted) $('persistInfo').textContent = '저장 공간 보호가 승인되었습니다. 사용자가 직접 데이터를 지우는 경우에는 보호되지 않습니다.';
      else $('persistInfo').textContent = '보호 요청이 승인되지 않았습니다. 홈 화면 앱에서 다시 요청하고 원본 TXT를 보관하세요.';
    } catch (error) { $('persistInfo').textContent = explainError(error); }
  });
  $('exportBtn').addEventListener('click', () => { void makeBackup(); });
  $('restoreBtn').addEventListener('click', () => { $('backupInput').value = ''; $('backupInput').click(); });
  $('backupInput').addEventListener('change', () => { void restoreBackup($('backupInput').files?.[0]); });
  $('shareBackupBtn').addEventListener('click', async () => {
    if (!backupFile) return;
    try { await navigator.share({ files: [backupFile], title: 'TXT 책장 백업' }); }
    catch (error) { if (error.name !== 'AbortError') $('backupStatus').textContent = explainError(error); }
  });
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  });
  window.addEventListener('scroll', () => {
    updateProgress();
    if (current && !switching && !suppressPosition) {
      clearTimeout(positionTimer);
      positionTimer = setTimeout(savePosition, 300);
    }
  }, { passive: true });
  window.addEventListener('pagehide', savePosition);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') savePosition();
  });
  window.addEventListener('resize', () => {
    // Ignore Safari address-bar height changes; restore only after a width change.
    if (Math.abs(innerWidth - lastWidth) < 2) return;
    lastWidth = innerWidth;
    if (current && !switching) void changeSettings(() => {});
  });
  window.addEventListener('online', () => { void checkOffline(); });
  window.addEventListener('offline', renderOfflineStatus.bind(null, undefined));
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  async function start() {
    settings = normalizeSettings(readState('settings', DEFAULTS));
    applySettings();
    try {
      db = await openDatabase();
      db.onversionchange = () => { db.close(); db = null; setBusy(false); showNotice('앱이 업데이트되었습니다. 앱을 닫았다가 다시 열어 주세요.'); };
      const storedState = await dbRequest('state', 'getAll');
      for (const record of storedState) memoryState.set(record.key, record);
      settings = normalizeSettings(readState('settings', DEFAULTS));
      applySettings();
      await refreshChapters();
      setBusy(false);
      let last = readState('last', null);
      if (!chapters.some(chapter => chapter.id === last) && chapters.length) last = [...chapters].sort(compareFiles)[0].id;
      if (last) await openChapter(last);
    } catch (error) {
      db = null;
      setBusy(false);
      showNotice('기기 책장을 열지 못했습니다. ' + explainError(error));
    }
    await setupOffline();
  }
  void start();
})();
