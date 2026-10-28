'use strict';
(() => {
  const DEFAULT_ENDPOINT = 'https://chhc007.synology.me:9444/textview-nas/api.php';
  const UPDATE_MESSAGE = '회차 제목을 가져오려면 NAS 연결 파일을 업데이트해 주세요.';
  const INVALID_MESSAGE = '회차 제목을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  let endpoint = '';
  let context = null;
  let health = null;

  function getEndpoint() {
    const selected = window.TextviewNAS?.getGatewayEndpoint?.() || window.TextviewNAS?.getEndpoint?.() || DEFAULT_ENDPOINT;
    if (selected !== endpoint) {
      endpoint = selected;
      // Never share this anonymous session with cover selection or DSM login.
      context = { endpoint, session: null, bootstrap: null };
      health = null;
    }
    return endpoint;
  }

  function validText(value, empty = false) {
    return typeof value === 'string' && [...value].length <= 300 && !/[\p{Cc}]/u.test(value) && (empty || !!value.trim());
  }

  function normalizedText(value) {
    return value.normalize('NFC').replace(/\s+/g, '').toLocaleLowerCase('ko');
  }

  function normalizedTitle(value) {
    // These labels do not identify a different edition. Keep all other labels.
    return normalizedText(value.replace(/\[(?:독점|완결|연재)\]/g, ''));
  }

  async function fetchTimed(url, options = {}) {
    if (navigator.onLine === false) throw new Error('회차 제목을 가져오려면 인터넷에 연결해 주세요.');
    try {
      return await fetch(url, { ...options, credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(18000) });
    } catch {
      throw new Error('회차 제목에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.');
    }
  }

  function checkContext(selectedContext) {
    getEndpoint();
    if (selectedContext !== context) throw new Error('NAS 연결 주소가 바뀌었습니다. 다시 시도해 주세요.');
  }

  async function supportsEpisodes(provider = 'series') {
    const url = getEndpoint();
    const selectedContext = context;
    if (health && health.time > Date.now() - 60000) {
      if (!health.available || (provider === 'novelpia' && !health.providers.includes(provider))) throw new Error(UPDATE_MESSAGE);
      return;
    }
    const response = await fetchTimed(url + '?health=1');
    let data;
    try { data = await response.json(); } catch { throw new Error(UPDATE_MESSAGE); }
    checkContext(selectedContext);
    const available = response.ok && data?.ok === true && data.episodeTitles === true;
    health = { time: Date.now(), available, providers: Array.isArray(data.episodeProviders) ? data.episodeProviders : [] };
    if (!available || (provider === 'novelpia' && !health.providers.includes(provider))) throw new Error(UPDATE_MESSAGE);
  }

  async function gateway(action, payload = {}, retry = true, selectedContext = null) {
    getEndpoint();
    selectedContext ||= context;
    checkContext(selectedContext);
    if (action !== 'bootstrap' && !selectedContext.session) {
      if (!selectedContext.bootstrap) {
        selectedContext.bootstrap = gateway('bootstrap', {}, true, selectedContext).then(data => {
          checkContext(selectedContext);
          if (typeof data.sessionToken !== 'string' || !/^[A-Za-z0-9,-]{22,128}$/.test(data.sessionToken)
              || typeof data.csrfToken !== 'string' || !/^[a-f0-9]{64}$/.test(data.csrfToken)) throw new Error(UPDATE_MESSAGE);
          selectedContext.session = { token: data.sessionToken, csrf: data.csrfToken };
        }).finally(() => { selectedContext.bootstrap = null; });
      }
      await selectedContext.bootstrap;
      checkContext(selectedContext);
    }
    const headers = { 'Content-Type': 'application/json' };
    if (action !== 'bootstrap') {
      headers.Authorization = 'Bearer ' + selectedContext.session.token;
      headers['X-CSRF-Token'] = selectedContext.session.csrf;
    }
    const response = await fetchTimed(selectedContext.endpoint, { method: 'POST', headers, body: JSON.stringify({ action, ...payload }) });
    let data;
    try { data = await response.json(); } catch { throw new Error(INVALID_MESSAGE); }
    checkContext(selectedContext);
    if (!response.ok || data?.ok !== true) {
      if (action !== 'bootstrap' && retry && data?.error?.code === 'SESSION_EXPIRED') {
        selectedContext.session = null;
        return gateway(action, payload, false, selectedContext);
      }
      throw new Error(validText(data?.error?.message) ? data.error.message.trim() : INVALID_MESSAGE);
    }
    return data;
  }

  async function resolveBook(book) {
    const title = typeof book === 'string' ? book : book?.name || book?.title;
    const author = typeof book === 'object' && typeof book?.author === 'string' ? book.author.trim() : '';
    if (!validText(title) || [...title.trim()].length > 100 || (author && !validText(author))) throw new Error('작품 이름과 작가 정보를 확인해 주세요.');
    if (!window.TextviewCoverSearch?.lookup) throw new Error(UPDATE_MESSAGE);
    const lookupEndpoint = getEndpoint();
    const rows = await window.TextviewCoverSearch.lookup(title.trim());
    if (lookupEndpoint !== getEndpoint()) throw new Error('NAS 연결 주소가 바뀌었습니다. 다시 시도해 주세요.');
    if (!Array.isArray(rows) || rows.length > 24) throw new Error(INVALID_MESSAGE);
    const sourceName = typeof book?.sourceName === 'string' ? normalizedText(book.sourceName) : '';
    const preferred = ['노벨피아', 'novelpia'].includes(sourceName) ? 'novelpia'
      : ['네이버시리즈', 'naverseries', 'series'].includes(sourceName) ? 'series' : null;
    for (const provider of preferred ? [preferred] : ['series', 'novelpia']) {
      const matches = new Map();
      for (const row of rows) {
        const id = /^(series|novelpia):([1-9][0-9]{0,11})$/.exec(typeof row?.id === 'string' ? row.id : '');
        if (!id || id[1] !== provider || !validText(row.title) || !validText(row.author ?? '', true)
            || normalizedTitle(row.title) !== normalizedTitle(title)
            || (author && normalizedText(row.author || '') !== normalizedText(author))) continue;
        const selected = { provider, productId: id[2], title: row.title.trim(), author: (row.author || '').trim(), sourceName: provider === 'series' ? '네이버 시리즈' : '노벨피아' };
        const key = provider + ':' + id[2], previous = matches.get(key);
        if (previous && normalizedText(previous.author) !== normalizedText(selected.author)) throw new Error('작가 정보가 일치하지 않아 회차 제목을 연결하지 않았습니다.');
        matches.set(key, selected);
      }
      if (matches.size > 1) throw new Error('같은 제목의 작품이 여러 개라 회차 제목을 자동으로 연결하지 않았습니다.');
      if (matches.size) return matches.values().next().value;
    }
    throw new Error('이 작품과 일치하는 ' + (preferred === 'novelpia' ? '노벨피아' : preferred === 'series' ? '네이버 시리즈' : '공개') + ' 회차 목록을 찾지 못했습니다.');
  }

  async function getPage(productId, page, provider = 'series') {
    if (typeof productId !== 'string' || !/^[1-9][0-9]{0,11}$/.test(productId)
        || !Number.isSafeInteger(page) || page < 1 || page > 334 || !['series', 'novelpia'].includes(provider)) throw new Error('회차 제목 요청을 확인해 주세요.');
    await supportsEpisodes(provider);
    const data = await gateway('episode_titles', { productId, page, ...(provider === 'series' ? {} : { provider }) });
    if ((data.provider === undefined ? 'series' : data.provider) !== provider || data.productId !== productId || data.page !== page || !Number.isSafeInteger(data.total) || data.total < 1 || data.total > 10000
        || !validText(data.title) || !validText(data.author, true) || typeof data.hasMore !== 'boolean'
        || data.hasMore !== (page < 334 && page * 30 < data.total)
        || !Array.isArray(data.episodes) || data.episodes.length > 30) throw new Error(INVALID_MESSAGE);
    let lastNumber = 0;
    const episodes = data.episodes.map(item => {
      if (!Number.isSafeInteger(item?.number) || item.number < 1 || item.number > data.total
          || item.number <= (page - 1) * 30 || item.number > page * 30
          || item.number <= lastNumber || !validText(item.title)) throw new Error(INVALID_MESSAGE);
      lastNumber = item.number;
      return { number: item.number, title: item.title.trim() };
    });
    return { provider, productId, page, total: data.total, title: data.title.trim(), author: data.author.trim(), hasMore: data.hasMore, episodes };
  }

  window.TextviewEpisodeTitles = { resolveBook, getPage };
})();
