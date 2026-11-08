/* Comics use their own database. Never migrate or clear the TXT bookshelf. */
(() => {
  'use strict';
  const base = new URL('./', location.href);
  const DB_NAME = 'offline-comix-v1:' + base.pathname + ':library';
  const MAX_FILE = 32 * 1024 * 1024;
  const MAX_PIXELS = 48 * 1024 * 1024;
  const MAX_DIMENSION = 32768;
  const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
  let connection;
  let opening;

  function fail(message, code = 'INVALID_COMIC') {
    const error = new Error(message);
    error.code = code;
    return error;
  }
  function text(value, max = 2048) {
    if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw fail('작품과 이미지 이름을 확인해 주세요.');
    return value.normalize('NFC').trim();
  }
  const titleKey = value => text(value, 300).normalize('NFKC').replace(/\s+/g, ' ');
  const progressKey = id => 'progress:' + id;
  const localProgressKey = id => DB_NAME + ':progress:' + id;
  const importKey = id => 'import:' + id;
  const uniqueId = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const compare = (a, b) => collator.compare(a.title || a.name, b.title || b.name);
  function normalizeSource(source) {
    if (!source || typeof source !== 'object') throw fail('이미지 원본 폴더를 확인해 주세요.');
    const endpoint = text(source.endpoint);
    const folder = text(source.folder, 4096).replace(/\/+$/, '') || '/';
    if (endpoint !== 'local:' && endpoint !== 'local') {
      let url;
      try { url = new URL(endpoint); } catch { throw fail('NAS 연결 주소를 확인해 주세요.'); }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw fail('NAS 연결 주소를 확인해 주세요.');
      return { endpoint: url.href, folder };
    }
    return { endpoint: 'local:', folder };
  }
  function ready() {
    if (connection) return Promise.resolve(connection);
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) { reject(fail('이 환경에서는 만화를 기기에 저장할 수 없습니다.')); return; }
      const request = indexedDB.open(DB_NAME, 1);
      let settled = false;
      const timer = setTimeout(() => { settled = true; opening = null; reject(fail('다른 호율 시리즈 창을 닫고 다시 열어 주세요.')); }, 10000);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('books', { keyPath: 'id' });
        const volumes = db.createObjectStore('volumes', { keyPath: 'id' });
        volumes.createIndex('bookId', 'bookId');
        const pages = db.createObjectStore('pages', { keyPath: 'id' });
        pages.createIndex('bookId', 'bookId');
        pages.createIndex('volumeId', 'volumeId');
        pages.createIndex('sessionId', 'sessionId');
        db.createObjectStore('state', { keyPath: 'key' });
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        if (settled) { request.result.close(); return; }
        connection = request.result;
        connection.onversionchange = () => { connection?.close(); connection = null; opening = null; };
        resolve(connection);
      };
      request.onerror = () => { clearTimeout(timer); opening = null; reject(request.error || fail('만화 보관함을 열지 못했습니다.')); };
    });
    return opening;
  }
  async function transaction(names, mode, callback) {
    const db = await ready();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(names, mode);
      let result;
      let reason;
      const api = {
        store: name => tx.objectStore(name),
        result: value => { result = value; },
        abort: error => { reason = error; try { tx.abort(); } catch {} }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(reason || (tx.error?.name === 'QuotaExceededError' ? fail('기기 저장 공간이 부족합니다. 이미 저장한 작품은 유지됩니다.', 'QUOTA') : tx.error) || fail('만화 저장을 완료하지 못했습니다.'));
      tx.onerror = () => {};
      try { callback(api); } catch (error) { api.abort(error); }
    });
  }
  function read(store, id) {
    return transaction([store], 'readonly', api => {
      const request = id === undefined ? api.store(store).getAll() : api.store(store).get(id);
      request.onsuccess = () => api.result(request.result);
    });
  }
  async function listBooks() { return (await read('books')).sort(compare); }
  function listVolumes(bookId) {
    return transaction(['volumes'], 'readonly', api => {
      const request = api.store('volumes').index('bookId').getAll(bookId);
      request.onsuccess = () => api.result(request.result.filter(item => item.complete).sort(compare));
    });
  }
  function pageMeta(page) {
    const { blob, sessionId, ...meta } = page;
    return meta;
  }
  function listPages(volumeId) {
    return transaction(['volumes', 'pages'], 'readonly', api => {
      const volumeRequest = api.store('volumes').get(volumeId);
      volumeRequest.onsuccess = () => {
        const volume = volumeRequest.result;
        if (!volume?.complete) { api.result([]); return; }
        const request = api.store('pages').index('volumeId').getAll(volumeId);
        request.onsuccess = () => api.result(request.result.filter(page => page.sessionId === volume.activeSessionId).sort((a, b) => a.order - b.order || collator.compare(a.name, b.name)).map(pageMeta));
      };
    });
  }
  function getPage(pageId) {
    return transaction(['volumes', 'pages'], 'readonly', api => {
      const request = api.store('pages').get(pageId);
      request.onsuccess = () => {
        const page = request.result;
        if (!page) { api.result(null); return; }
        const volume = api.store('volumes').get(page.volumeId);
        volume.onsuccess = () => api.result(volume.result?.complete && volume.result.activeSessionId === page.sessionId ? page : null);
      };
    });
  }
  async function getProgress(volumeId) {
    const [record, volume] = await Promise.all([read('state', progressKey(volumeId)), read('volumes', volumeId)]);
    if (!volume?.complete) return { pageIndex: 0, offset: 0, updatedAt: 0 };
    let value = record?.value;
    try {
      const local = JSON.parse(localStorage.getItem(localProgressKey(volumeId)) || 'null');
      if (Number.isInteger(local?.pageIndex) && local.pageIndex >= 0 && Number.isFinite(local.offset) && local.offset >= 0 && local.offset <= 1 && Number.isFinite(local.updatedAt) && (!value || local.updatedAt >= value.updatedAt)) value = local;
    } catch { /* IndexedDB remains the normal durable copy. */ }
    return value ? { ...value, pageIndex: Math.min(volume.pageCount - 1, Math.max(0, Math.floor(Number(value.pageIndex) || 0))) } : { pageIndex: 0, offset: 0, updatedAt: 0 };
  }
  function saveProgress(volumeId, value) {
    const position = { pageIndex: Math.max(0, Math.floor(Number(value?.pageIndex) || 0)), offset: Math.min(1, Math.max(0, Number(value?.offset) || 0)), updatedAt: Date.now() };
    // Mobile Safari may suspend before a pagehide IndexedDB transaction commits.
    try { localStorage.setItem(localProgressKey(volumeId), JSON.stringify(position)); } catch {}
    return transaction(['books', 'volumes', 'state'], 'readwrite', api => {
      const request = api.store('volumes').get(volumeId);
      request.onsuccess = () => {
        const volume = request.result;
        if (!volume?.complete) { api.result(false); return; }
        position.pageIndex = Math.min(volume.pageCount - 1, position.pageIndex);
        const current = api.store('state').get(progressKey(volumeId));
        current.onsuccess = () => {
          if (current.result?.value?.updatedAt > position.updatedAt) { api.result(current.result.value); return; }
          api.store('state').put({ key: progressKey(volumeId), value: position, bookId: volume.bookId, volumeId });
          const bookRequest = api.store('books').get(volume.bookId);
          bookRequest.onsuccess = () => {
            if (bookRequest.result) api.store('books').put({ ...bookRequest.result, lastReadAt: position.updatedAt, lastVolumeId: volumeId });
          };
          api.result(position);
        };
      };
    }).then(saved => {
      try {
        const local = JSON.parse(localStorage.getItem(localProgressKey(volumeId)) || 'null');
        if (!saved) { if (local?.updatedAt === position.updatedAt) localStorage.removeItem(localProgressKey(volumeId)); }
        else if (!local || local.updatedAt <= saved.updatedAt) localStorage.setItem(localProgressKey(volumeId), JSON.stringify(saved));
      } catch {}
      return saved;
    });
  }
  async function beginImport({ title, volumeTitle, source, manifest } = {}) {
    title = text(title, 300);
    volumeTitle = text(volumeTitle || title, 300);
    source = normalizeSource(source);
    if (!Array.isArray(manifest) || !manifest.length || manifest.length > 20000) throw fail('가져올 JPG·PNG 이미지를 선택해 주세요. 한 권에는 20,000개까지 담을 수 있습니다.');
    const paths = new Set();
    manifest = manifest.map(item => {
      const name = text(item?.name, 500);
      const path = text(item?.path || name, 4096);
      if (!/\.(jpe?g|png)$/i.test(name) || /[\\/]/.test(name) || paths.has(path)) throw fail('중복되거나 지원하지 않는 이미지 이름이 있습니다.');
      const size = Number(item.size);
      if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE) throw fail('이미지는 한 장에 32 MB까지 가져올 수 있습니다.');
      paths.add(path);
      return { name, path, size };
    }).sort((a, b) => collator.compare(a.path, b.path)).map((item, order) => ({ ...item, order }));
    const bookId = JSON.stringify(['book', titleKey(title)]);
    const volumeId = JSON.stringify(['volume', source.endpoint, source.folder]);
    const sessionId = uniqueId();
    return transaction(['state', 'volumes'], 'readwrite', api => {
      const request = api.store('volumes').get(volumeId);
      request.onsuccess = () => {
        const old = request.result;
        if (old && old.bookId !== bookId) { api.abort(fail('이 원본 폴더는 다른 작품으로 저장되어 있습니다. 기존 작품 이름을 사용해 주세요.')); return; }
        const session = { sessionId, bookId, volumeId, title, volumeTitle, source, manifest, baseSessionId: old?.activeSessionId || null, createdAt: Date.now() };
        api.store('state').add({ key: importKey(sessionId), kind: 'import', bookId, volumeId, value: session });
        api.result(session);
      };
    });
  }
  function jpegSize(bytes) {
    let at = 2;
    while (at + 3 < bytes.length) {
      if (bytes[at++] !== 255) return null;
      while (bytes[at] === 255) at++;
      const marker = bytes[at++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      const length = bytes[at] * 256 + bytes[at + 1];
      if (length < 2 || at + length > bytes.length) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { width: bytes[at + 5] * 256 + bytes[at + 6], height: bytes[at + 3] * 256 + bytes[at + 4] };
      at += length;
    }
    return null;
  }
  async function validateImage(blob, name) {
    if (!(blob instanceof Blob) || blob.size < 12 || blob.size > MAX_FILE) throw fail('이미지는 한 장에 32 MB까지 가져올 수 있습니다.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10;
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if ((!png && !jpeg) || (png && !/\.png$/i.test(name)) || (jpeg && !/\.jpe?g$/i.test(name))) throw fail(name + ': JPG·PNG 파일의 실제 형식과 확장자가 다릅니다.');
    let dimensions;
    if (png && bytes.length >= 33 && String.fromCharCode(...bytes.subarray(12, 16)) === 'IHDR') {
      const view = new DataView(bytes.buffer);
      dimensions = { width: view.getUint32(16), height: view.getUint32(20) };
    } else if (jpeg) dimensions = jpegSize(bytes);
    if (!dimensions || !dimensions.width || !dimensions.height || dimensions.width > MAX_DIMENSION || dimensions.height > MAX_DIMENSION || dimensions.width * dimensions.height > MAX_PIXELS) throw fail(name + ': 이미지 크기를 확인해 주세요. 최대 변 길이는 32,768픽셀입니다.');
    let decoded;
    if (typeof createImageBitmap === 'function') {
      try { decoded = await createImageBitmap(blob); dimensions = { width: decoded.width, height: decoded.height }; }
      catch { throw fail(name + ': 손상된 이미지를 열지 못했습니다.'); }
      finally { decoded?.close(); }
    } else {
      const url = URL.createObjectURL(blob);
      try {
        await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => {
            if (!image.naturalWidth || !image.naturalHeight) { reject(fail(name + ': 이미지가 비어 있습니다.')); return; }
            dimensions = { width: image.naturalWidth, height: image.naturalHeight };
            resolve();
          };
          image.onerror = () => reject(fail(name + ': 손상된 이미지를 열지 못했습니다.'));
          image.src = url;
        });
      } finally { URL.revokeObjectURL(url); }
    }
    return { ...dimensions, mime: png ? 'image/png' : 'image/jpeg' };
  }
  async function putImportPage(session, { name, blob, path } = {}) {
    const sessionId = text(session?.sessionId, 200);
    name = text(name, 500);
    path = text(path || name, 4096);
    const image = await validateImage(blob, name);
    return transaction(['state', 'pages'], 'readwrite', api => {
      const request = api.store('state').get(importKey(sessionId));
      request.onsuccess = () => {
        const stored = request.result?.value;
        if (!stored) { api.abort(fail('가져오기가 취소되었거나 끝났습니다.', 'IMPORT_CLOSED')); return; }
        const entry = stored.manifest.find(item => item.path === path && item.name === name);
        if (!entry || entry.size !== blob.size) { api.abort(fail(name + ': 가져오기 목록과 이미지가 다릅니다. 다시 불러와 주세요.')); return; }
        const page = { id: JSON.stringify([sessionId, path]), bookId: stored.bookId, volumeId: stored.volumeId, sessionId, name, path, order: entry.order, bytes: blob.size, width: image.width, height: image.height, blob: blob.type === image.mime ? blob : blob.slice(0, blob.size, image.mime) };
        api.store('pages').put(page);
        api.result(pageMeta(page));
      };
    });
  }
  function finishImport(session) {
    return transaction(['books', 'volumes', 'pages', 'state'], 'readwrite', api => {
      const state = api.store('state');
      const request = state.get(importKey(text(session?.sessionId, 200)));
      request.onsuccess = () => {
        const staged = request.result?.value;
        if (!staged) { api.abort(fail('가져오기가 취소되었거나 끝났습니다.', 'IMPORT_CLOSED')); return; }
        const pageRequest = api.store('pages').index('sessionId').getAll(staged.sessionId);
        pageRequest.onsuccess = () => {
          const imported = pageRequest.result.sort((a, b) => a.order - b.order);
          if (imported.length !== staged.manifest.length || imported.some((page, i) => page.path !== staged.manifest[i].path || page.bytes !== staged.manifest[i].size || page.order !== i)) { api.abort(fail('아직 저장하지 못한 이미지가 있습니다. 모든 이미지를 받은 뒤 완료해 주세요.', 'IMPORT_INCOMPLETE')); return; }
          const volumeRequest = api.store('volumes').get(staged.volumeId);
          volumeRequest.onsuccess = () => {
            const old = volumeRequest.result;
            if ((old?.activeSessionId || null) !== staged.baseSessionId) { api.abort(fail('다른 창에서 이 권을 업데이트했습니다. 다시 가져와 주세요.', 'IMPORT_CONFLICT')); return; }
            const now = Date.now();
            const volume = { id: staged.volumeId, bookId: staged.bookId, title: staged.volumeTitle, source: staged.source, activeSessionId: staged.sessionId, complete: true, pageCount: imported.length, bytes: imported.reduce((sum, page) => sum + page.bytes, 0), coverPageId: imported[0].id, addedAt: old?.addedAt || now, updatedAt: now };
            api.store('volumes').put(volume);
            const oldPages = api.store('pages').index('volumeId').getAll(staged.volumeId);
            oldPages.onsuccess = () => { for (const page of oldPages.result) if (page.sessionId === old?.activeSessionId) api.store('pages').delete(page.id); };
            const bookRequest = api.store('books').get(staged.bookId);
            bookRequest.onsuccess = () => {
              const book = bookRequest.result;
              const volumes = api.store('volumes').index('bookId').getAll(staged.bookId);
              volumes.onsuccess = () => {
                const list = volumes.result.filter(item => item.complete).sort(compare);
                api.store('books').put({ ...book, id: staged.bookId, title: book?.title || staged.title, coverPageId: list[0].coverPageId, volumeCount: list.length, pageCount: list.reduce((sum, item) => sum + item.pageCount, 0), bytes: list.reduce((sum, item) => sum + item.bytes, 0), sources: [...new Set(list.map(item => item.source.endpoint))], addedAt: book?.addedAt || now, updatedAt: now });
              };
            };
            const progress = state.get(progressKey(staged.volumeId));
            progress.onsuccess = () => {
              if (!progress.result) return;
              const value = progress.result.value;
              state.put({ ...progress.result, value: { ...value, pageIndex: Math.min(Math.max(0, value.pageIndex || 0), imported.length - 1) } });
            };
            state.delete(importKey(staged.sessionId));
            api.result({ bookId: staged.bookId, volumeId: staged.volumeId });
          };
        };
      };
    });
  }
  function cancelImport(session) {
    return transaction(['pages', 'state'], 'readwrite', api => {
      const sessionId = text(session?.sessionId, 200);
      const request = api.store('state').get(importKey(sessionId));
      request.onsuccess = () => {
        // A completed session is active content and must never be cancelled.
        if (!request.result) { api.result(false); return; }
        const pages = api.store('pages').index('sessionId').getAllKeys(sessionId);
        pages.onsuccess = () => { for (const key of pages.result) api.store('pages').delete(key); };
        api.store('state').delete(importKey(sessionId));
        api.result(true);
      };
    });
  }
  function removeBook(bookId) {
    const removedVolumes = [];
    return transaction(['books', 'volumes', 'pages', 'state'], 'readwrite', api => {
      api.store('books').delete(bookId);
      const volumes = api.store('volumes').index('bookId').getAllKeys(bookId);
      volumes.onsuccess = () => { for (const id of volumes.result) { removedVolumes.push(id); api.store('volumes').delete(id); api.store('state').delete(progressKey(id)); } };
      const pages = api.store('pages').index('bookId').getAllKeys(bookId);
      pages.onsuccess = () => { for (const id of pages.result) api.store('pages').delete(id); };
      const states = api.store('state').getAll();
      states.onsuccess = () => { for (const record of states.result) if (record.bookId === bookId) api.store('state').delete(record.key); };
      api.result(true);
    }).then(value => {
      for (const id of removedVolumes) { try { localStorage.removeItem(localProgressKey(id)); } catch {} }
      return value;
    });
  }
  async function getSettings() {
    return (await read('state', 'reader-settings'))?.value || { mode: 'page', direction: 'ltr' };
  }
  function saveSettings(value) {
    const settings = { mode: value?.mode === 'scroll' ? 'scroll' : 'page', direction: value?.direction === 'rtl' ? 'rtl' : 'ltr' };
    return transaction(['state'], 'readwrite', api => { api.store('state').put({ key: 'reader-settings', value: settings, updatedAt: Date.now() }); api.result(settings); });
  }
  window.HoyulComicStore = { ready, listBooks, listVolumes, listPages, getPage, getProgress, saveProgress, removeBook, beginImport, putImportPage, finishImport, cancelImport, getSettings, saveSettings };
})();
