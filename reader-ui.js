'use strict';
// UI additions for the existing v2 bookshelf. The database name and schema are
// unchanged, so an update never removes imported books or reading positions.
(() => {
  const $ = id => document.getElementById(id);
  const reader = $('reader');
  const top = document.querySelector('.topbar');
  const bottom = document.querySelector('.bottombar');
  const prefix = 'offline-txt-v2:' + new URL('./', location.href).pathname + ':';
  let gesture = null;
  let snapshot = null;
  let saving = false;
  let opening = false;
  let timer;
  let lastFocus;
  const editor = document.createElement('dialog');
  editor.id = 'editDialog';
  editor.setAttribute('aria-labelledby', 'editTitle');
  editor.innerHTML = '<div class="dialog-head"><h2 id="editTitle">본문 편집</h2><button type="button" id="editClose">닫기</button></div><div class="dialog-body"><p id="editMeta" class="small"></p><textarea id="editText" spellcheck="false" autocapitalize="off" aria-label="본문 수정"></textarea><p id="editError" role="alert" class="small"></p></div><div class="dialog-actions"><button id="editCancel" type="button">취소</button><button id="editSave" class="primary" type="button">저장</button></div>';
  // Created after app.js binds its own dialogs; the editor owns its close and
  // save handlers, including unsaved-change confirmation.
  document.body.appendChild(editor);

  function reading() { return !reader.hidden; }
  function modalOpen() { return !!document.querySelector('dialog[open]'); }
  function clearHide() { clearTimeout(timer); }
  function hideBars() {
    clearHide();
    if (modalOpen() || !reading()) return;
    document.body.classList.remove('show-topbar', 'show-bottombar');
  }
  function scheduleHide() {
    clearHide();
    timer = setTimeout(hideBars, 4500);
  }
  function showBar(edge) {
    document.body.classList.add('show-' + edge + 'bar');
    scheduleHide();
  }
  function syncReader() {
    document.body.classList.toggle('reading', reading());
    $('editBtn').disabled = !reading() || opening || saving;
    if (!reading()) document.body.classList.remove('show-topbar', 'show-bottombar');
  }
  new MutationObserver(syncReader).observe(reader, { attributes: true, attributeFilter: ['hidden'] });
  syncReader();

  document.addEventListener('touchstart', event => {
    gesture = null;
    if (!reading() || modalOpen() || event.touches.length !== 1) return;
    if (event.target.closest('button, input, select, textarea, a, .topbar, .bottombar')) return;
    const t = event.touches[0];
    let edge = '';
    if (t.clientY <= 110) edge = 'top';
    else if (t.clientY >= innerHeight - 110) edge = 'bottom';
    if (edge) gesture = { edge, x: t.clientX, y: t.clientY, id: t.identifier };
  }, { passive: true });
  document.addEventListener('touchmove', event => {
    if (!gesture || event.touches.length !== 1) { gesture = null; return; }
    const t = event.touches[0];
    if (t.identifier !== gesture.id) { gesture = null; return; }
    const dx = t.clientX - gesture.x;
    const dy = t.clientY - gesture.y;
    if (Math.abs(dx) > 24 && Math.abs(dx) > Math.abs(dy)) { gesture = null; return; }
    let inward = dy;
    if (gesture.edge === 'bottom') inward = -dy;
    if (inward > 8 && Math.abs(dy) > Math.abs(dx) * 1.3) {
      if (event.cancelable) event.preventDefault();
      if (inward >= 36) { showBar(gesture.edge); gesture = null; }
    }
  }, { passive: false });
  document.addEventListener('touchend', () => { gesture = null; }, { passive: true });
  document.addEventListener('touchcancel', () => { gesture = null; }, { passive: true });
  reader.addEventListener('click', hideBars);
  for (const bar of [top, bottom]) {
    bar.addEventListener('pointerdown', clearHide);
    bar.addEventListener('pointerup', scheduleHide);
    bar.addEventListener('click', scheduleHide);
  }
  // Keyboard users can reveal both bars without a touch gesture.
  document.addEventListener('keydown', event => {
    if (modalOpen() || event.target.closest('input, textarea, select') || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.toLowerCase() === 'm') { showBar('top'); showBar('bottom'); }
    if (event.key === 'Escape') hideBars();
  });
  $('showControls').addEventListener('click', () => { showBar('top'); showBar('bottom'); $('openBtn').focus(); });

  function connect() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(prefix + 'bookshelf');
      request.onupgradeneeded = () => request.transaction.abort();
      request.onerror = () => reject(request.error || new Error('책장을 열지 못했습니다.'));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
    });
  }
  function getAll(db, store) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const request = tx.objectStore(store).getAll();
      let result;
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error || request.error);
    });
  }
  function getText(db, id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('texts', 'readonly');
      const request = tx.objectStore('texts').get(id);
      let result;
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error || request.error);
    });
  }
  function ratio() {
    const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    if (!max) return 0;
    return Math.max(0, Math.min(1, scrollY / max));
  }
  async function openEditor() {
    if (!reading() || opening || saving || modalOpen() || $('openBtn').disabled) return;
    opening = true;
    syncReader();
    const book = $('subtitle').textContent;
    const name = $('title').textContent;
    const original = reader.textContent;
    const position = ratio();
    let db;
    try {
      db = await connect();
      const all = await getAll(db, 'chapters');
      const candidates = all.filter(item => item.book === book && item.name.replace(/\.txt$/i, '') === name);
      let selected;
      for (const meta of candidates) {
        const record = await getText(db, meta.id);
        if (record && record.text === original) { selected = meta; break; }
      }
      if (!selected || reader.textContent !== original || $('subtitle').textContent !== book || $('title').textContent !== name) throw new Error('본문이 변경되었습니다. 편집 버튼을 다시 눌러 주세요.');
      snapshot = { meta: selected, text: original, ratio: position };
      $('editMeta').textContent = book + ' · ' + selected.name;
      $('editText').value = original;
      $('editError').textContent = '';
      lastFocus = document.activeElement;
      clearHide();
      editor.showModal();
      document.body.classList.add('editor-open');
    } catch (error) {
      window.alert(error?.message || '편집할 본문을 열지 못했습니다.');
    } finally {
      if (db) db.close();
      opening = false;
      syncReader();
    }
  }
  function closeEditor() {
    if (saving) return;
    if (snapshot && $('editText').value !== snapshot.text && !confirm('저장하지 않은 수정 내용을 버릴까요?')) return;
    editor.close();
  }
  editor.addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
  editor.addEventListener('close', () => {
    document.body.classList.remove('editor-open');
    snapshot = null;
    if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
    scheduleHide();
  });
  $('editClose').addEventListener('click', closeEditor);
  $('editCancel').addEventListener('click', closeEditor);
  $('editBtn').addEventListener('click', () => { void openEditor(); });
  window.addEventListener('beforeunload', event => {
    if (!saving && editor.open && snapshot && $('editText').value !== snapshot.text) { event.preventDefault(); event.returnValue = ''; }
  });

  function commitEdit(db, item, text, bytes) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['chapters', 'texts', 'state'], 'readwrite');
      let failure;
      const metaRequest = tx.objectStore('chapters').get(item.meta.id);
      metaRequest.onsuccess = () => {
        const meta = metaRequest.result;
        const request = tx.objectStore('texts').get(item.meta.id);
        request.onsuccess = () => {
          if (!meta || !request.result || request.result.text !== item.text) {
            failure = new Error('다른 창에서 본문이 바뀌거나 삭제됐습니다. 수정 내용을 복사해 보관하고 다시 열어 주세요.');
            tx.abort();
            return;
          }
          tx.objectStore('chapters').put({ ...meta, bytes, encoding: 'utf-8', editedAt: Date.now() });
          tx.objectStore('texts').put({ id: meta.id, text });
          tx.objectStore('state').put({ key: 'position:' + meta.id, value: { ratio: item.ratio }, updatedAt: Date.now() });
        };
      };
      tx.oncomplete = resolve;
      tx.onabort = () => reject(failure || tx.error || new Error('저장하지 못했습니다.'));
      tx.onerror = () => {};
    });
  }
  $('editSave').addEventListener('click', async () => {
    if (!snapshot || saving) return;
    const item = snapshot;
    const text = $('editText').value;
    const bytes = new Blob([text]).size;
    if (bytes > 32 * 1024 * 1024) { $('editError').textContent = '본문은 32 MB까지 저장할 수 있습니다.'; return; }
    saving = true;
    for (const id of ['editSave', 'editCancel', 'editClose', 'editText']) $(id).disabled = true;
    $('editError').textContent = '저장 중…';
    let db;
    try {
      db = await connect();
      await commitEdit(db, item, text, bytes);
      // Reopen the same chapter through the existing app initialization so all
      // in-memory metadata, backup sizes and reading state reflect the edit.
      reader.textContent = text;
      document.body.classList.remove('editor-open');
      editor.close();
      window.scrollTo(0, Math.max(0, document.documentElement.scrollHeight - innerHeight) * item.ratio);
      const key = 'position:' + item.meta.id;
      try { localStorage.setItem(prefix + key, JSON.stringify({ key, value: { ratio: item.ratio }, updatedAt: Date.now() })); } catch {}
      db.close();
      db = null;
      location.reload();
    } catch (error) {
      if (error?.name === 'QuotaExceededError') $('editError').textContent = '저장 공간이 부족합니다. 수정 내용은 이 창에 남아 있습니다.';
      else $('editError').textContent = error?.message || '저장하지 못했습니다. 수정 내용을 복사해 보관해 주세요.';
      saving = false;
      for (const id of ['editSave', 'editCancel', 'editClose', 'editText']) $(id).disabled = false;
    } finally { if (db) db.close(); }
  });
})();
