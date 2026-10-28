'use strict';
(() => {
  const DEFAULT_ENDPOINT = 'https://chhc007.synology.me:9444/textview-nas/api.php';
  const UPDATE_MESSAGE = '국내 작품 표지를 검색하려면 NAS 연결 파일을 업데이트해 주세요.';
  const cache = new Map();
  let endpoint = '';
  const mainContext = { session: null, bootstrap: null };
  const metadataContext = { session: null, bootstrap: null };
  let health = null;
  let nextLibraryRequest = 0;
  let libraryQueue = Promise.resolve();

  function clearSeriesCache() {
    for (const [key, value] of cache) if (value.results.some(result => ['series', 'novelpia'].includes(result.provider))) cache.delete(key);
  }

  function searchProvider(id) {
    return /^(series|novelpia):[1-9][0-9]{0,11}$/.exec(typeof id === 'string' ? id : '')?.[1] || null;
  }

  function validThumbnail(value, provider) {
    if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u0020\u007f]/.test(value)) return false;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) return false;
      return provider === 'series' ? url.hostname === 'comicthumb-phinf.pstatic.net'
        : provider === 'novelpia' && url.hostname === 'images.novelpia.com' && url.pathname.startsWith('/imagebox/cover/');
    } catch { return false; }
  }

  function getEndpoint() {
    const selected = window.TextviewNAS?.getGatewayEndpoint?.() || window.TextviewNAS?.getEndpoint?.() || DEFAULT_ENDPOINT;
    if (selected !== endpoint) {
      endpoint = selected;
      mainContext.session = mainContext.bootstrap = null;
      metadataContext.session = metadataContext.bootstrap = null;
      health = null;
      cache.clear();
    }
    return endpoint;
  }

  async function fetchTimed(url, options = {}) {
    try { return await fetch(url, { ...options, credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(18000) }); }
    catch { throw new Error('표지 검색에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.'); }
  }

  async function supportsSeries() {
    const url = getEndpoint();
    if (health && health.time > Date.now() - 60000) return health.available;
    try {
      const response = await fetchTimed(url + '?health=1');
      const body = await response.json();
      health = { time: Date.now(), available: response.ok && body.ok === true && body.coverSearch === true };
    } catch { health = { time: Date.now(), available: false }; }
    return health.available;
  }

  async function gateway(action, payload = {}, image = false, retry = true, context = mainContext) {
    const url = getEndpoint();
    if (action !== 'bootstrap' && !context.session) {
      if (!context.bootstrap) context.bootstrap = gateway('bootstrap', {}, false, true, context).then(data => {
        if (typeof data.sessionToken !== 'string' || !/^[A-Za-z0-9,-]{22,128}$/.test(data.sessionToken) || typeof data.csrfToken !== 'string' || !/^[a-f0-9]{64}$/.test(data.csrfToken)) throw new Error(UPDATE_MESSAGE);
        context.session = { token: data.sessionToken, csrf: data.csrfToken };
      }).finally(() => { context.bootstrap = null; });
      await context.bootstrap;
    }
    const headers = { 'Content-Type': 'application/json' };
    if (action !== 'bootstrap') {
      headers.Authorization = 'Bearer ' + context.session.token;
      headers['X-CSRF-Token'] = context.session.csrf;
    }
    const response = await fetchTimed(url, { method: 'POST', headers, body: JSON.stringify({ action, ...payload }) });
    if (image && response.ok) {
      const blob = await response.blob();
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type) || !blob.size || blob.size > 5 * 1024 * 1024) throw new Error('표지 이미지를 가져오지 못했습니다. 다른 표지를 선택해 주세요.');
      return new File([blob], '표지.' + (blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'), { type: blob.type });
    }
    let data;
    try { data = await response.json(); } catch { throw new Error(UPDATE_MESSAGE); }
    if (!response.ok || data.ok !== true) {
      if (data.error?.code === 'SESSION_EXPIRED' && retry && action !== 'bootstrap') {
        context.session = null;
        if (context === mainContext) clearSeriesCache();
        if (image) throw new Error('표지 선택 시간이 지났습니다. 다시 검색해 주세요.');
        return gateway(action, payload, image, false, context);
      }
      if (data.error?.code === 'COVER_TOKEN_EXPIRED' && context === mainContext) clearSeriesCache();
      throw new Error(typeof data.error?.message === 'string' ? data.error.message : UPDATE_MESSAGE);
    }
    return data;
  }

  function searchLibrary(query) {
    const pending = libraryQueue.catch(() => {}).then(async () => {
      const delay = Math.max(0, nextLibraryRequest - Date.now());
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      nextLibraryRequest = Date.now() + 1000;
      const response = await fetchTimed('https://openlibrary.org/search.json?q=' + encodeURIComponent(query) + '&limit=12&fields=key,title,author_name,cover_i');
      if (!response.ok) throw new Error('표지 검색에 연결하지 못했습니다. 잠시 후 다시 검색해 주세요.');
      const data = await response.json();
      if (!Array.isArray(data.docs)) throw new Error('표지 검색 결과를 읽지 못했습니다. 다시 검색해 주세요.');
      const seen = new Set();
      return data.docs.filter(item => Number.isSafeInteger(item.cover_i) && item.cover_i > 0 && typeof item.title === 'string' && !seen.has(item.cover_i) && seen.add(item.cover_i)).map(item => ({
        id: 'openlibrary:' + item.cover_i, title: item.title, author: Array.isArray(item.author_name) ? item.author_name.filter(name => typeof name === 'string').join(', ') : '',
        thumbnailUrl: 'https://covers.openlibrary.org/b/id/' + item.cover_i + '-M.jpg?default=false', sourceName: 'Open Library', provider: 'openlibrary'
      }));
    });
    libraryQueue = pending;
    return pending;
  }

  function normalizeQuery(query) {
    if (typeof query !== 'string') throw new Error('작품 이름을 입력해 주세요.');
    query = query.trim().normalize('NFC');
    if (!query || [...query].length > 100 || /[\u0000-\u001f\u007f]/.test(query)) throw new Error('작품 이름을 100자 이내로 입력해 주세요.');
    return query;
  }

  async function search(query) {
    query = normalizeQuery(query);
    const key = getEndpoint() + '\n' + query;
    const saved = cache.get(key);
    if (saved && saved.time > Date.now() - 60000) return saved.results;
    const available = await supportsSeries();
    let results = [];
    let primaryError = null;
    if (available) {
      try {
        const data = await gateway('cover_search', { query });
        if (!Array.isArray(data.results)) throw new Error(UPDATE_MESSAGE);
        results = data.results.filter(item => item && searchProvider(item.id) && typeof item.title === 'string' && typeof item.token === 'string' && /^[a-f0-9]{48}$/.test(item.token) && validThumbnail(item.thumbnailUrl, searchProvider(item.id))).slice(0, 24).map(item => ({ ...item, provider: searchProvider(item.id), endpoint }));
        clearSeriesCache();
      } catch (error) { primaryError = error; }
    }
    if (!results.length) {
      try { results = await searchLibrary(query); }
      catch (error) { throw primaryError || new Error(!available ? UPDATE_MESSAGE : error.message); }
    }
    if (!results.length && (!available || primaryError)) throw primaryError || new Error(UPDATE_MESSAGE);
    if (cache.size >= 20) cache.delete(cache.keys().next().value);
    cache.set(key, { time: Date.now(), results });
    return results;
  }

  // Background attribution has a separate anonymous gateway session. Its
  // searches must not replace the tokens belonging to an open cover picker.
  async function lookup(query) {
    query = normalizeQuery(query);
    const available = await supportsSeries();
    let results = [];
    let primaryError = null;
    const metadata = rows => rows.filter(item => item && typeof item.title === 'string').map(item => ({
      ...(searchProvider(item.id) ? { id: item.id, provider: searchProvider(item.id) } : {}),
      title: item.title,
      author: Array.isArray(item.author) ? item.author.filter(name => typeof name === 'string').join(', ') : typeof item.author === 'string' ? item.author : '',
      sourceName: typeof item.sourceName === 'string' ? item.sourceName : ''
    })).filter(item => item.title.trim());
    if (available) {
      try {
        const data = await gateway('cover_search', { query }, false, true, metadataContext);
        if (!Array.isArray(data.results)) throw new Error(UPDATE_MESSAGE);
        results = metadata(data.results);
      } catch (error) { primaryError = error; }
    }
    if (!results.length) {
      try { results = metadata(await searchLibrary(query)); }
      catch (error) { throw primaryError || new Error(!available ? UPDATE_MESSAGE : error.message); }
    }
    if (!results.length && (!available || primaryError)) throw primaryError || new Error(UPDATE_MESSAGE);
    return results;
  }

  async function getImage(result) {
    if (searchProvider(result?.id) === result?.provider && ['series', 'novelpia'].includes(result.provider) && result.endpoint === getEndpoint() && /^[a-f0-9]{48}$/.test(result.token || '')) return gateway('cover_download', { token: result.token }, true);
    const match = /^openlibrary:([0-9]{1,15})$/.exec(result?.id || '');
    if (result?.provider !== 'openlibrary' || !match) throw new Error('표지를 다시 검색하고 선택해 주세요.');
    const response = await fetchTimed('https://covers.openlibrary.org/b/id/' + match[1] + '-L.jpg?default=false');
    const blob = await response.blob();
    if (!response.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(blob.type) || !blob.size || blob.size > 5 * 1024 * 1024) throw new Error('표지 이미지를 가져오지 못했습니다. 다른 표지를 선택해 주세요.');
    return new File([blob], '표지-' + match[1] + '.jpg', { type: blob.type });
  }

  window.TextviewCoverSearch = { search, getImage, lookup };
})();
