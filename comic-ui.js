/* COMIX views use their own database. NOVEL owns its original data and routes. */
(() => {
  'use strict';
  const store = window.HoyulComicStore;
  const reader = window.HoyulComicReader;
  const nas = window.TextviewNAS;
  const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
  const paths = {
    back: '<path d="m15 5-7 7 7 7"/>', next: '<path d="m9 5 7 7-7 7"/>',
    add: '<circle cx="12" cy="12" r="9"/><path d="M6.5 12h11M12 6.5v11"/>',
    search: '<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',
    folder: '<path d="M3 7V5h7l2 3h9v12H3Z"/>',
    image: '<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="9" cy="8" r="1.3"/><path d="m4 17 5-5 4 4 3-3 4 4"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ''}</svg>`;
  const root = document.createElement('main');
  root.id = 'comixScreen'; root.hidden = true; root.setAttribute('aria-label', '호율 COMIX');
  document.body.append(root);
  const dialog = document.createElement('dialog'); dialog.id = 'comixImport';
  dialog.setAttribute('aria-labelledby', 'cxImportTitle');
  dialog.innerHTML = `<h2 id="cxImportTitle">보관함에 가져오기</h2>
    <form id="cxImportForm"><label>작품 이름<input id="cxWorkName" maxlength="200" required autocomplete="off"></label>
    <label id="cxVolumeField">권·회차 이름<input id="cxVolumeName" maxlength="200" required autocomplete="off"></label>
    <p id="cxImportSummary"></p><ul id="cxImportVolumes" aria-label="가져올 권 목록" hidden></ul><progress id="cxImportProgress" max="1" value="0" hidden></progress>
    <p id="cxImportStatus" role="status"></p><div class="cx-dialog-actions">
    <button id="cxImportCancel" type="button">취소</button><button id="cxImportStart" class="cx-primary" type="submit">가져오기</button></div></form>`;
  document.body.append(dialog);
  const files = document.createElement('input'); files.type = 'file'; files.accept = '.jpg,.jpeg,.png,image/jpeg,image/png'; files.multiple = true; files.hidden = true;
  document.body.append(files);
  const $ = id => document.getElementById(id);
  let route = 'home', books = [], activeBook = null, query = '', searchOpen = false, sort = 'added';
  let renderEpoch = 0, visible = false, coverURLs = [], folderPath = '/', folderEntries = [], folderBusy = false;
  let folderError = '', folderController = null, importController = null, importSource = null, importSession = null;
  let importing = false, scanning = false, shownEntries = 100;
  const api = { actions: {}, show, hide, refresh: () => render(), showShelf: () => navigate('shelf') };
  window.HoyulComix = api;
  const element = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };
  const button = (action, label, cls = '', value = '') => { const node = element('button', cls, label); node.type = 'button'; node.dataset.cxAction = action; if (value) node.dataset.value = value; return node; };
  function iconButton(action, label, name, value = '') { const node = button(action, '', 'cx-icon', value); node.innerHTML = icon(name); node.setAttribute('aria-label', label); return node; }
  const formatBytes = value => value >= 1024 ** 3 ? (value / 1024 ** 3).toFixed(1) + 'GB' : value >= 1024 ** 2 ? (value / 1024 ** 2).toFixed(1) + 'MB' : Math.ceil(value / 1024) + 'KB';
  const imageFile = item => /\.(?:jpe?g|png)$/i.test(item.name || '') && !/^(?:\.|@)/.test(item.name || '');
  const baseName = path => path.split('/').filter(Boolean).at(-1) || 'NAS';
  const parentPath = path => path.slice(0, path.lastIndexOf('/')) || '/';
  const visibleName = name => typeof name === 'string' && !/^(?:\.|@)/.test(name) && !['#recycle','#snapshot'].includes(name.toLowerCase());
  function checkTransfer(controller, endpoint) {
    if(controller.signal.aborted) throw new DOMException('가져오기를 중단했습니다.','AbortError');
    if(endpoint && nas.getEndpoint() !== endpoint) throw Error('NAS 연결이 바뀌었습니다. 작품 폴더를 다시 열어 주세요.');
  }
  async function readFolder(path, controller, endpoint, onProgress) {
    let offset=0,total=1; const found=new Map();
    while(offset<total) {
      checkTransfer(controller, endpoint);
      const data=await nas.listComicFolder(path,{signal:controller.signal,offset,limit:100});
      checkTransfer(controller, endpoint);
      if(!Array.isArray(data.entries)||!Number.isSafeInteger(data.total)||data.total<0||data.total>100000||
          !Number.isSafeInteger(data.nextOffset)||data.nextOffset<offset||data.nextOffset>data.total||
          data.nextOffset>offset+100||(data.nextOffset<=offset&&offset<data.total)) throw Error('폴더 목록을 확인하지 못했습니다.');
      for(const entry of data.entries) {
        if(!visibleName(entry.name)) continue;
        if(typeof entry.path!=='string'||parentPath(entry.path)!==path||baseName(entry.path)!==entry.name||
            /[\\\u0000-\u001f\u007f]/.test(entry.path)||entry.name==='..'||entry.name==='.') throw Error('폴더 경로를 확인하지 못했습니다.');
        if(entry.isDir||imageFile(entry)) found.set(entry.path,entry);
      }
      offset=data.nextOffset;total=data.total;onProgress?.(Math.min(offset,total),total);
    }
    return [...found.values()].sort((a,b)=>Number(b.isDir)-Number(a.isDir)||collator.compare(a.name,b.name));
  }
  function report(error) { api.actions.notify?.(error?.name === 'QuotaExceededError' ? '기기 저장 공간이 부족합니다. 저장 공간을 확보한 뒤 다시 시도해 주세요.' : error?.message || '요청을 처리하지 못했습니다. 다시 시도해 주세요.'); }
  function clearCovers() { coverURLs.forEach(url => URL.revokeObjectURL(url)); coverURLs = []; }
  async function cover(book, epoch, cls = '') {
    const node = element('span', 'cx-cover cx-cover-placeholder ' + cls, book.title);
    if (!book.coverPageId) return node;
    try {
      const page = await store.getPage(book.coverPageId);
      if (epoch !== renderEpoch || !page?.blob) return node;
      const url = URL.createObjectURL(page.blob); coverURLs.push(url);
      const img = element('img', 'cx-cover ' + cls); img.src = url; img.alt = ''; img.decoding = 'async'; return img;
    } catch (_) { return node; }
  }
  function header(section, title) {
    const header = element('header', 'cx-header');
    const top = element('div', 'cx-top');
    if (title) { top.append(iconButton('back', '돌아가기', 'back'), element('h1', 'cx-heading', title)); }
    else {
      const brand = element('div', 'cx-brand'); brand.setAttribute('role', 'tablist'); brand.setAttribute('aria-label', '콘텐츠 종류');
      const novel = button('novel', 'NOVEL'); novel.setAttribute('role', 'tab'); novel.setAttribute('aria-selected', 'false');
      const comix = button('home', 'COMIX', 'is-active'); comix.setAttribute('role', 'tab'); comix.setAttribute('aria-selected', 'true');
      brand.append(novel, comix); top.append(brand);
    }
    if (section === 'shelf') top.append(iconButton('add', '만화 가져오기', 'add'));
    if (section === 'home' || section === 'shelf') top.append(iconButton('search', '만화 검색', 'search'));
    header.append(top);
    if (section === 'home' || section === 'shelf' || section === 'nas') {
      const nav = element('nav', 'cx-nav'); nav.setAttribute('aria-label', 'COMIX 메뉴');
      [['home','홈'],['shelf','보관함'],['nas','NAS']].forEach(([action,label]) => {
        const node = button(action,label,section === action ? 'is-active' : ''); if (section === action) node.setAttribute('aria-current','page'); nav.append(node);
      }); header.append(nav);
    }
    if (searchOpen && ['home','shelf'].includes(section)) {
      const wrap = element('div','cx-search'), input = element('input'); input.type = 'search'; input.value = query;
      input.placeholder = '작품 이름 검색'; input.id = 'cxSearch'; input.setAttribute('aria-label','만화 작품 검색'); wrap.append(input); header.append(wrap);
    }
    return header;
  }
  function empty(title, text, action = 'shelf', label = '보관함으로 가기') {
    const node = element('section','cx-empty'); node.append(element('h2','',title), element('p','',text), button(action,label,'cx-primary')); return node;
  }
  function filteredBooks() {
    const result = books.filter(book => book.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    return result.sort((a,b) => sort === 'title' ? collator.compare(a.title,b.title) : sort === 'recent' ? (b.lastReadAt||0)-(a.lastReadAt||0) : (b.addedAt||0)-(a.addedAt||0));
  }
  async function bookCard(book, epoch) {
    const node = button('book','','cx-card',book.id); node.setAttribute('aria-label',book.title + ', 작품 상세');
    node.append(await cover(book,epoch), element('strong','',book.title), element('small','',`${book.volumeCount || 1}권 · ${book.pageCount}페이지`)); return node;
  }
  async function renderHome(epoch) {
    const view = document.createDocumentFragment();
    view.append(header('home'));
    if (!books.length) { view.append(empty('만화도, 나만의 시리즈로','보관함에서 좋아하는 만화를 담아보세요.')); return view; }
    const recent = [...books].sort((a,b)=>(b.lastReadAt||0)-(a.lastReadAt||0)||(b.addedAt||0)-(a.addedAt||0));
    const featured = recent[0];
    if (!query) {
      const hero = element('section','cx-hero'), art = await cover(featured,epoch);
      if (art.tagName === 'IMG') hero.append(art);
      const copy = element('div','cx-hero-copy');
      copy.append(element('p','cx-eyebrow',featured.lastReadAt ? '마지막으로 읽은 작품' : '새로운 이야기'), element('h2','',featured.title), element('p','cx-sub',`${featured.volumeCount||1}권 · ${featured.pageCount}페이지`), button('continue',featured.lastReadAt ? '이어 읽기' : '읽기 시작','cx-primary',featured.id));
      hero.append(copy); view.append(hero);
    }
    const section = element('section','cx-section'), head = element('div','cx-section-head');
    head.append(element('h2','',query ? '검색 결과' : '보관함에 담긴 만화'),button('shelf','전체 보기')); section.append(head);
    const grid = element('div','cx-grid');
    for (const book of filteredBooks().slice(0, query ? 100 : 6)) grid.append(await bookCard(book,epoch));
    if (!grid.children.length) grid.append(element('p','cx-sub','검색한 작품이 없습니다.'));
    section.append(grid); view.append(section);
    if (!query && recent.some(book => book.lastReadAt)) {
      const section = element('section','cx-section'), head = element('div','cx-section-head'); head.append(element('h2','','최근 본')); section.append(head);
      const grid = element('div','cx-grid');
      for (const book of recent.filter(book=>book.lastReadAt).slice(0,6)) grid.append(await bookCard(book,epoch));
      section.append(grid); view.append(section);
    }
    return view;
  }
  async function renderShelf(epoch) {
    const view = document.createDocumentFragment();
    view.append(header('shelf','보관함'));
    const controls = element('div','cx-toolbar'), select = element('select'); select.id = 'cxSort'; select.setAttribute('aria-label','만화 정렬');
    [['added','다운로드순'],['recent','최근 읽은순'],['title','제목순']].forEach(([value,label])=>{ const option = element('option','',label); option.value = value; select.append(option); }); select.value = sort;
    controls.append(select,element('span','',`${filteredBooks().length}개 작품`)); view.append(controls);
    for (const book of filteredBooks()) {
      const row = button('book','','cx-row',book.id), copy = element('span','cx-row-copy');
      copy.append(element('strong','',book.title),element('small','',`${book.volumeCount||1}권 · ${book.pageCount}페이지`));
      row.append(await cover(book,epoch),copy,element('span','cx-row-end',formatBytes(book.bytes||0))); view.append(row);
    }
    if (!filteredBooks().length) view.append(empty(books.length ? '검색한 작품이 없습니다' : '아직 담긴 만화가 없어요', books.length ? '다른 작품 이름으로 검색해 보세요.' : 'NAS의 이미지 폴더를 가져오세요.','add','만화 가져오기'));
    return view;
  }
  async function renderDetail(epoch) {
    const view = document.createDocumentFragment();
    const book = books.find(item=>item.id === activeBook);
    if (!book) { route = 'shelf'; return renderShelf(epoch); }
    view.append(header('detail','작품 상세'));
    const volumes = await store.listVolumes(book.id);
    const info = element('section','cx-detail-info'), copy = element('div');
    copy.append(element('h1','',book.title),element('p','',`총 ${volumes.length}권 · ${book.pageCount}페이지`));
    info.append(await cover(book,epoch),copy); view.append(info);
    const start = element('div','cx-detail-start'); start.append(button('continue',book.lastReadAt ? '이어 읽기' : '첫 권부터 읽기','cx-primary',book.id)); view.append(start);
    const head = element('div','cx-toolbar'); head.append(element('strong','',`전체 ${volumes.length}권`),button('add','다른 권 추가')); view.append(head);
    for (let i=0;i<volumes.length;i++) {
      const volume = volumes[i], progress = await store.getProgress(volume.id), row = button('volume','','cx-volume',volume.id), copy = element('span','cx-volume-main');
      copy.append(element('strong','',volume.title),element('small','',`${volume.pageCount}페이지 · ${formatBytes(volume.bytes)}`));
      row.append(element('span','cx-volume-num',String(i+1)),copy);
      if (progress?.updatedAt) row.append(element('span','cx-volume-progress',`${Math.min(volume.pageCount, (progress.pageIndex||0)+1)} / ${volume.pageCount}`));
      view.append(row);
    }
    const footer = element('div','cx-toolbar'); footer.append(element('span','',formatBytes(book.bytes)),button('remove','기기에서 삭제','',book.id)); view.append(footer);
    return view;
  }
  function renderNAS() {
    const view = document.createDocumentFragment();
    view.append(header('nas','NAS'));
    const crumbs = element('nav','cx-crumbs'); crumbs.setAttribute('aria-label','현재 폴더'); crumbs.append(button('folder','공유 폴더','','/'));
    let path = ''; for(const part of folderPath.split('/').filter(Boolean)) { path += '/'+part; crumbs.append(element('span','','›'),button('folder',part,'',path)); }
    view.append(crumbs);
    const images = folderEntries.filter(entry=>!entry.isDir&&imageFile(entry));
    const folders = folderEntries.filter(entry=>entry.isDir&&visibleName(entry.name));
    const count = element('div','cx-toolbar'); count.append(element('span','',folderBusy ? '폴더를 불러오는 중' : folders.length ? `폴더 ${folders.length}개 · 이미지 ${images.length}장` : `${images.length}장`),button('refresh','새로고침')); view.append(count);
    if (folderError) { const err = element('p','cx-error',folderError); err.setAttribute('role','alert'); view.append(err); }
    const shown = folderEntries.slice(0,shownEntries);
    for (const entry of shown) {
      const row = entry.isDir ? button('folder','','cx-row',entry.path) : element('div','cx-row');
      const badge = element('span','cx-file-icon'+(entry.isDir?' cx-folder-icon':'')); badge.innerHTML = icon(entry.isDir?'folder':'image');
      const copy = element('span','cx-row-copy'); copy.append(element('strong','',entry.name),element('small','',entry.isDir ? '폴더' : formatBytes(entry.size||0)));
      row.append(badge,copy); if(entry.isDir) row.insertAdjacentHTML('beforeend',icon('next')); view.append(row);
    }
    if (folderEntries.length>shownEntries) { const more = button('more','더 보기','cx-row'); view.append(more); }
    if (!folderBusy && !folderError && !folderEntries.length) view.append(empty('이미지가 없는 폴더입니다','다른 폴더를 열어보세요.','parent','상위 폴더'));
    if (folderPath!=='/' && !folderBusy && !folderError && (images.length||folders.length)) {
      const dock = element('div','cx-import-dock');
      if(folders.length) {
        dock.append(button('import-work','이 작품 전체 가져오기','cx-primary'),element('p','cx-import-dock-note','권별 폴더를 같은 작품으로 묶어 가져옵니다.'));
        if(images.length) dock.append(button('import-folder',`이 폴더의 이미지 ${images.length}장만 가져오기`,'cx-import-current'));
      } else dock.append(button('import-folder',`${images.length}장 보관함에 가져오기`,'cx-primary'));
      view.append(dock);
    }
    return view;
  }
  async function render() {
    const epoch = ++renderEpoch; clearCovers();
    try {
      books = await store.listBooks(); if(epoch!==renderEpoch) return;
      const view = route==='home' ? await renderHome(epoch) : route==='shelf' ? await renderShelf(epoch) : route==='detail' ? await renderDetail(epoch) : renderNAS();
      if(epoch!==renderEpoch) return;
      root.replaceChildren(view);
      document.title = route==='detail' ? (books.find(book=>book.id===activeBook)?.title||'만화')+' · 호율 COMIX' : '호율 COMIX · '+({home:'홈',shelf:'보관함',nas:'NAS'}[route]||'');
    } catch(error) { if(epoch===renderEpoch) { root.replaceChildren(header('home'),empty('만화를 불러오지 못했습니다','앱을 다시 열어 주세요.')); report(error); } }
  }
  async function show() { visible=true; root.hidden=false; document.body.classList.add('comix-visible'); document.querySelector('meta[name="theme-color"]').content='#111214'; try { await store.ready(); await render(); } catch(error) { report(error); } }
  function hide() { if(importing||scanning) return false; visible=false; ++renderEpoch; folderController?.abort(); reader.hide(); nas?.hide(); root.hidden=true; clearCovers(); document.body.classList.remove('comix-visible'); return true; }
  async function navigate(next, id) {
    if(importing||scanning) return;
    if(next==='nas') { await showNAS(); return; }
    folderController?.abort(); nas?.hide(); reader.hide(); root.hidden=false;
    route=next; if(id) activeBook=id; await render(); window.scrollTo(0,0);
  }
  async function showNAS() {
    if(!nas?.canBrowseComics?.()) {
      root.hidden=true;
      nas?.showForComics?.({onConnected:()=>{nas.hide();root.hidden=false;route='nas';void loadFolder(folderPath);},onHome:()=>{nas.hide();void navigate('home');},onShelf:()=>{nas.hide();void navigate('shelf');}});
      return;
    }
    nas.hide(); root.hidden=false; route='nas'; await loadFolder(folderPath);
  }
  async function loadFolder(path) {
    folderController?.abort(); const controller = new AbortController(); folderController=controller;
    folderPath=path; folderEntries=[]; shownEntries=100; folderBusy=true; folderError=''; await render();
    try {
      const entries=await readFolder(path,controller,nas.getEndpoint());
      if(controller.signal.aborted||folderController!==controller) return;
      folderEntries=entries;
    } catch(error) { if(controller.signal.aborted) return; folderError=error.message||'NAS 폴더를 불러오지 못했습니다.'; }
    finally { if(folderController===controller){folderBusy=false;folderController=null;if(visible&&route==='nas') await render();} }
  }
  function openImport(source) {
    if(importing||scanning) return;
    importSource=source; const name=source.folder ? baseName(source.folder) : '새 만화';
    const volumes=source.volumes||[{folder:source.folder,volumeTitle:source.folder?name:'1권',entries:source.entries}];
    source.volumes=volumes; source.completed=new Map();
    const entries=volumes.flatMap(volume=>volume.entries);
    const volumeLike=/^(?:\d+|제?\s*\d+\s*[권화회]|vol[. _-]*\d+)/i.test(name);
    $('cxWorkName').value=source.existingTitle||source.workImport&&name||(activeBook&&route==='detail' ? books.find(book=>book.id===activeBook)?.title||name : source.folder&&volumeLike ? baseName(parentPath(source.folder)) : name);
    $('cxWorkName').readOnly=!!source.existingTitle;
    $('cxVolumeField').hidden=!!source.workImport;
    $('cxVolumeName').required=!source.workImport;
    $('cxVolumeName').value=source.folder?name:'1권';
    $('cxImportSummary').textContent=`${source.workImport?volumes.length+'권 · ':''}${entries.length}장 · ${formatBytes(entries.reduce((sum,item)=>sum+(item.size||0),0))}${source.existingTitle?' · 기존 작품에 추가합니다.':''}`;
    $('cxImportVolumes').replaceChildren(...volumes.map(volume=>element('li','',`${volume.volumeTitle} · ${volume.entries.length}장`)));
    $('cxImportVolumes').hidden=!source.workImport;
    $('cxImportStatus').textContent=''; $('cxImportProgress').hidden=true;
    $('cxWorkName').disabled=false; $('cxVolumeName').disabled=false; $('cxImportStart').disabled=false; $('cxImportStart').textContent='가져오기'; $('cxImportCancel').textContent='취소';
    if(!dialog.open) dialog.showModal(); $('cxWorkName').focus();
  }
  async function scanWork() {
    if(importing||scanning||folderBusy||folderPath==='/') return;
    const folder=folderPath,endpoint=nas.getEndpoint(),controller=new AbortController();
    scanning=true;importController=controller;importSource=null;
    $('cxWorkName').value=baseName(folder);$('cxWorkName').disabled=true;$('cxVolumeName').disabled=true;
    $('cxVolumeField').hidden=true;$('cxVolumeName').required=false;
    $('cxImportVolumes').hidden=true;$('cxImportSummary').textContent='권별 폴더를 확인하고 있습니다.';
    $('cxImportStatus').textContent='';$('cxImportStart').disabled=true;$('cxImportCancel').textContent='중단';
    $('cxImportProgress').hidden=false;$('cxImportProgress').removeAttribute('value');
    dialog.showModal();$('cxImportCancel').focus();
    try {
      const pending=[folder],visited=new Set(),volumes=[];
      while(pending.length) {
        checkTransfer(controller,endpoint);
        const path=pending.pop();if(visited.has(path)) continue;visited.add(path);
        $('cxImportStatus').textContent=`폴더 ${visited.size}개 확인 중 · ${path===folder?baseName(folder):path.slice(folder.length+1)}`;
        const entries=await readFolder(path,controller,endpoint,(count,total)=>{ $('cxImportSummary').textContent=`${volumes.length}권 발견 · 현재 폴더 ${count} / ${total}`; });
        const images=entries.filter(entry=>!entry.isDir&&imageFile(entry));
        if(images.length) volumes.push({folder:path,volumeTitle:path===folder?baseName(folder):path.slice(folder.length+1),entries:images});
        const children=entries.filter(entry=>entry.isDir&&visibleName(entry.name));
        for(let i=children.length-1;i>=0;i--) pending.push(children[i].path);
      }
      checkTransfer(controller,endpoint);
      if(!volumes.length) throw Error('이 작품 폴더 안에 가져올 JPG·PNG 이미지가 없습니다.');
      volumes.sort((a,b)=>collator.compare(a.volumeTitle,b.volumeTitle));
      const sources=new Set(volumes.map(volume=>volume.folder)),existingTitles=new Set();
      const allBooks=await store.listBooks();
      for(const book of allBooks) {
        checkTransfer(controller,endpoint);
        const saved=await store.listVolumes(book.id);
        if(saved.some(volume=>volume.source?.endpoint===endpoint&&sources.has(volume.source.folder))) existingTitles.add(book.title);
      }
      if(existingTitles.size>1) throw Error('이 폴더의 권들이 서로 다른 작품 이름으로 저장되어 있습니다. 기존 보관함의 작품 이름을 먼저 확인해 주세요.');
      checkTransfer(controller,endpoint);scanning=false;importController=null;
      openImport({folder,endpoint,volumes,workImport:true,existingTitle:[...existingTitles][0]});
    } catch(error) {
      $('cxImportProgress').hidden=true;
      $('cxImportStatus').textContent=controller.signal.aborted?'폴더 확인을 중단했습니다. 저장한 작품은 그대로입니다.':error.message||'권별 폴더를 확인하지 못했습니다. 다시 시도해 주세요.';
      $('cxImportSummary').textContent='가져오기를 시작하지 않았습니다.';$('cxImportCancel').textContent='닫기';
    } finally { scanning=false;importController=null; }
  }
  async function beginTransfer(event) {
    event.preventDefault(); if(importing||scanning||!importSource) return;
    const title=$('cxWorkName').value.trim(), volumeTitle=$('cxVolumeName').value.trim(); if(!title||!importSource.workImport&&!volumeTitle) return;
    const selected=importSource, controller=new AbortController(); importController=controller; importing=true;
    $('cxWorkName').disabled=true;$('cxVolumeName').disabled=true;$('cxImportStart').disabled=true;$('cxImportCancel').textContent='중단';
    const volumes=selected.volumes,entries=volumes.flatMap(volume=>volume.entries);
    const progress=$('cxImportProgress'); progress.max=entries.length;progress.value=0;progress.hidden=false;
    let savedPages=0,lastResult=null;
    try {
      const estimate=await navigator.storage?.estimate?.();
      const bytes=volumes.filter(volume=>!selected.completed.has(volume.folder||'local')).reduce((sum,volume)=>sum+volume.entries.reduce((size,item)=>size+(item.size||0),0),0);
      if(estimate?.quota && estimate.quota-estimate.usage<bytes*1.1) throw new DOMException('기기 저장 공간이 부족합니다.','QuotaExceededError');
      for(let v=0;v<volumes.length;v++) {
        const volume=volumes[v],key=volume.folder||'local';
        checkTransfer(controller,selected.endpoint);
        if(selected.completed.has(key)) { savedPages+=volume.entries.length;progress.value=savedPages;lastResult=selected.completed.get(key);continue; }
        const name=selected.workImport?volume.volumeTitle:volumeTitle;
        const images=[...volume.entries].sort((a,b)=>collator.compare(a.name,b.name));
        importSession=await store.beginImport({title,volumeTitle:name,source:{endpoint:selected.endpoint||'local',folder:volume.folder||'local/'+title+'/'+name},manifest:images.map(item=>({name:item.name,size:item.size,path:item.path||item.name}))});
        for(let i=0;i<images.length;i++) {
          checkTransfer(controller,selected.endpoint);
          const entry=images[i]; $('cxImportStatus').textContent=selected.workImport?`${v+1} / ${volumes.length}권 · ${name} · ${i+1} / ${images.length}장`:`${i+1} / ${images.length}장 · ${entry.name}`;
          const blob=entry.file||await nas.downloadComicPage(entry.path,{signal:controller.signal});
          checkTransfer(controller,selected.endpoint);
          await store.putImportPage(importSession,{name:entry.name,blob,order:i,path:entry.path||entry.name});
          progress.value=++savedPages;
        }
        checkTransfer(controller,selected.endpoint);
        lastResult=await store.finishImport(importSession);importSession=null;
        selected.completed.set(key,lastResult);
      }
      importing=false;importController=null;dialog.close();
      activeBook=lastResult.bookId;route='detail';root.hidden=false;await render();window.scrollTo(0,0);api.actions.notify?.(`${selected.workImport?volumes.length+'권 · ':''}${entries.length}장을 보관함에 저장했습니다.`);
    } catch(error) {
      if(importSession) { try { await store.cancelImport(importSession); } catch(_){} importSession=null; }
      const message=controller.signal.aborted?'가져오기를 중단했습니다. 기존에 저장한 만화는 유지됩니다.':error.name==='QuotaExceededError'?'기기 저장 공간이 부족합니다. 저장 공간을 확보한 뒤 다시 시도해 주세요.':error.message||'가져오지 못했습니다. 다시 시도해 주세요.';
      $('cxImportStatus').textContent=message+(selected.workImport&&selected.completed.size?` ${volumes.length}권 중 ${selected.completed.size}권을 저장했습니다. 남은 권부터 이어서 가져올 수 있습니다.`:'');
      importing=false;importController=null;$('cxImportStart').disabled=false;$('cxImportStart').textContent=selected.completed.size?'남은 권 가져오기':'다시 가져오기';$('cxWorkName').disabled=false;$('cxWorkName').readOnly=!!selected.existingTitle||selected.completed.size>0;$('cxVolumeName').disabled=false;$('cxImportCancel').textContent='닫기';
    }
  }
  async function openVolume(id) {
    const book=books.find(book=>book.id===activeBook); if(!book) return;
    root.hidden=true;
    try { await reader.show({bookId:book.id,volumeId:id},{onBack:()=>{root.hidden=false;route='detail';void render();}}); }
    catch(error){reader.hide();root.hidden=false;report(error);}
  }
  async function run(action,value) {
    if(importing||scanning) return;
    if(action==='novel'){api.actions.openNovel?.();return;}
    if(['home','shelf','nas'].includes(action)){query='';searchOpen=false;await navigate(action);return;}
    if(action==='book'){await navigate('detail',value);return;}
    if(action==='back'){await navigate(route==='detail'?'shelf':'home');return;}
    if(action==='search'){searchOpen=!searchOpen;if(!searchOpen)query='';await render();if(searchOpen)$('cxSearch')?.focus();return;}
    if(action==='add'){openImportChoice();return;}
    if(action==='nas-import'){dialog.close();await showNAS();return;}
    if(action==='local-import'){dialog.close();files.value='';files.click();return;}
    if(action==='folder'){await loadFolder(value);return;}
    if(action==='parent'){await loadFolder(parentPath(folderPath));return;}
    if(action==='refresh'){await loadFolder(folderPath);return;}
    if(action==='more'){shownEntries+=100;await render();return;}
    if(action==='import-folder'){openImport({folder:folderPath,endpoint:nas.getEndpoint(),entries:folderEntries.filter(entry=>!entry.isDir&&imageFile(entry))});return;}
    if(action==='import-work'){await scanWork();return;}
    if(action==='volume'){await openVolume(value);return;}
    if(action==='continue'){
      const book=books.find(book=>book.id===value);if(!book)return;activeBook=value;
      const volumes=await store.listVolumes(value), chosen=volumes.find(volume=>volume.id===book.lastVolumeId)||volumes[0];if(chosen)await openVolume(chosen.id);return;
    }
    if(action==='remove'){
      const book=books.find(book=>book.id===value);if(!book||!confirm(`“${book.title}”의 기기에 저장한 이미지와 읽던 위치를 삭제할까요? NAS 원본은 유지됩니다.`))return;
      await store.removeBook(value);activeBook=null;await navigate('shelf');return;
    }
  }
  const choice=document.createElement('dialog');choice.id='cxImportChoice';choice.className='cx-choice';
  choice.innerHTML=`<h2>만화 가져오기</h2><button type="button" data-cx-choice="nas">NAS에서 가져오기</button><button type="button" data-cx-choice="files">이미지 파일 선택</button><button type="button" data-cx-choice="close">취소</button>`;document.body.append(choice);
  function openImportChoice(){choice.showModal();}
  choice.addEventListener('click',event=>{const action=event.target.closest('[data-cx-choice]')?.dataset.cxChoice;if(!action)return;choice.close();if(action==='nas')void showNAS();else if(action==='files'){files.value='';files.click();}});
  root.addEventListener('click',event=>{const node=event.target.closest('[data-cx-action]');if(node&&!node.disabled)void run(node.dataset.cxAction,node.dataset.value).catch(report);});
  root.addEventListener('input',event=>{if(event.target.id==='cxSearch'){query=event.target.value;const at=event.target.selectionStart;void render().then(()=>{const input=$('cxSearch');input?.focus();try{input?.setSelectionRange(at,at);}catch(_){}});}});
  root.addEventListener('change',event=>{if(event.target.id==='cxSort'){sort=event.target.value;void render();}});
  files.addEventListener('change',()=>{const entries=[...files.files].filter(imageFile).map(file=>({name:file.name,size:file.size,file}));if(entries.length)openImport({entries});else api.actions.notify?.('JPG·PNG 이미지를 선택해 주세요.');});
  $('cxImportForm').addEventListener('submit',event=>{void beginTransfer(event);});
  $('cxImportCancel').addEventListener('click',()=>{if(importing||scanning)importController?.abort();else dialog.close();});
  dialog.addEventListener('cancel',event=>{if(importing||scanning){event.preventDefault();importController?.abort();}});
  window.addEventListener('beforeunload',event=>{if(importing||scanning){event.preventDefault();event.returnValue='';}});
})();
