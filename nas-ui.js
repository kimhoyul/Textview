/* NAS connection state stays in memory. app.js owns the offline library. */
(() => {
  'use strict';

  const DEFAULT_ENDPOINT = 'https://chhc007.synology.me:9444/textview-nas/api.php';
  const MAX_FILE_BYTES = 32 * 1024 * 1024;
  const PAGE_LIMIT = 100;
  const paths = {
    back: '<path d="m15 5-7 7 7 7"/>',
    next: '<path d="m9 5 7 7-7 7"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    folder: '<path class="nas-folder-fill" d="M2.5 7.5V4.5h7l2.5 3H21.5v12.8H2.5Z" fill="currentColor"/><path class="nas-folder-tab" d="M2.5 8h19"/>',
    file: '<path class="nas-paper-fill" d="M5 2h9l5 5v15H5Z" fill="currentColor"/><path class="nas-paper-fold" d="M14 2v5h5M8 12h8M8 15h8M8 18h5"/>',
    nas: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M7 7h10M7 11h10M7 16h4"/><circle cx="16.5" cy="16.5" r=".8"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.1 8a7.5 7.5 0 0 1 12.8-3L20 8M4 16l2.1 3A7.5 7.5 0 0 0 19 16"/>',
    up: '<path d="m5 11 7-7 7 7M12 4v16"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    search: '<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>',
    check: '<path d="m5 12 4.5 4.5L19 6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    key: '<circle cx="9" cy="8" r="4"/><path d="m6.5 11-4 9h4l1-3h3l1-4"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</svg>`;
  const screen = document.createElement('main');
  screen.id = 'nasScreen';
  screen.className = 'nas-screen';
  screen.dataset.nasUiVersion = 'nas5-ui1';
  screen.dataset.view = 'login';
  screen.hidden = true;
  screen.setAttribute('aria-label', 'NAS');
  screen.innerHTML = `
    <header class="nas-header">
      <div class="nas-toprow">
        <button type="button" class="nas-icon-button nas-back-button" id="nasBackButton" data-nas-action="back" aria-label="뒤로">${icon('back')}</button>
        <button type="button" class="nas-select-all-button" id="nasHeaderSelectAll" data-nas-action="select-all" hidden>전체 선택</button>
        <h1 tabindex="-1" id="nasTitle">NAS</h1>
        <button type="button" class="nas-select-mode-pill" id="nasSelectModeToggle" data-nas-action="select" hidden>선택</button>
        <button type="button" class="nas-selection-done" id="nasSelectionDone" data-nas-action="selection-done" aria-label="선택 완료" hidden>${icon('check')}</button>
      </div>
      <label class="nas-search" id="nasSearch" hidden>${icon('search')}<input id="nasSearchInput" type="search" placeholder="검색" aria-label="현재 불러온 폴더와 TXT 이름 검색" autocomplete="off" enterkeyhint="search"><button type="button" class="nas-search-clear" id="nasSearchClear" data-nas-action="clear-search" aria-label="검색 지우기" hidden>${icon('close')}</button></label>
    </header>
    <div class="nas-session" hidden><span class="nas-connection-label" id="nasConnectionLabel">연결 안 됨</span></div>
    <div class="nas-message" id="nasMessage" role="status" aria-live="polite" hidden><p id="nasMessageText"></p><button type="button" data-nas-action="shelf" id="nasMessageShelf" hidden>보관함 보기 ${icon('next')}</button></div>
    <section class="nas-login" id="nasLoginView" aria-labelledby="nasLoginTitle">
      <h2 class="nas-wordmark" id="nasLoginTitle">호율 시리즈</h2>
      <form id="nasLoginForm" autocomplete="off">
        <div class="nas-credentials">
          <label class="nas-visually-hidden" for="nasUsername">아이디</label><input id="nasUsername" name="username" type="text" placeholder="아이디" maxlength="256" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" required>
          <label class="nas-visually-hidden" for="nasPassword">비밀번호</label><input id="nasPassword" name="password" type="password" placeholder="비밀번호" maxlength="1024" autocomplete="off" required>
        </div>
        <button type="button" class="nas-otp-toggle" id="nasOtpToggle" data-nas-action="otp" aria-controls="nasOtpField" aria-expanded="false" hidden>인증코드 입력</button>
        <div class="nas-otp-field" id="nasOtpField" hidden><label class="nas-visually-hidden" for="nasOtp">인증코드 · 6자리</label><input id="nasOtp" name="otp" type="text" placeholder="6자리 인증번호" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" autocapitalize="none" spellcheck="false"></div>
        <button type="submit" class="nas-primary-button" id="nasLoginButton">로그인</button>
        <div class="nas-auth-modes" role="group" aria-label="다른 로그인 방식">
          <button type="button" class="nas-auth-secondary" id="nasOtpModeButton" data-nas-auth-mode="otp">${icon('key')}<span>인증번호로 로그인</span></button>
          <button type="button" class="nas-auth-secondary" id="nasApprovalModeButton" data-nas-auth-mode="approval" hidden>${icon('key')}<span>앱에서 승인</span></button>
        </div>
      </form>
      <div class="nas-approval-panel" id="nasApprovalPanel" role="status" aria-live="polite" hidden><div class="nas-approval-card"><div class="nas-approval-topline"><span class="nas-approval-spinner" aria-hidden="true"></span><span class="nas-approval-status">승인 기다리는 중</span><time class="nas-approval-countdown" id="nasApprovalCountdown" role="timer" aria-live="off">02:00</time></div><p class="nas-approval-instruction">Secure SignIn 앱에서 승인해 주세요.</p><div class="nas-verify-number" id="nasVerifyNumber" hidden><span>승인 화면에서 이 번호를 확인해 주세요.</span><strong id="nasVerifyNumberValue"></strong></div></div><p class="nas-approval-followup">승인하면 자동으로 연결됩니다.</p><button type="button" class="nas-approval-cancel" id="nasApprovalCancel" data-nas-action="approval-cancel">취소</button></div>
      <p class="nas-login-note nas-visually-hidden" id="nasLoginNote">로그인 후 Secure SignIn 앱에서 승인해 주세요.</p>
      <button type="button" class="nas-retry-button" data-nas-action="retry" id="nasRetry" hidden>다시 연결</button>
      <div class="nas-login-footer" aria-hidden="true">호율 시리즈</div>
    </section>
    <section class="nas-browser" id="nasBrowserView" aria-label="NAS 폴더와 TXT 파일" hidden>
      <h2 id="nasFolderTitle" class="nas-visually-hidden">공유 폴더</h2>
      <div class="nas-list-controls" hidden><button type="button" class="nas-parent-button" data-nas-action="up" id="nasUpButton" hidden>${icon('up')}<span>상위 폴더</span></button><label class="nas-select-all" id="nasSelectAllLabel" hidden><input type="checkbox" id="nasSelectAll"><span>TXT 전체 선택</span></label><span class="nas-list-count" id="nasListCount"></span></div>
      <p class="nas-loading" id="nasListLoading" role="status" hidden>폴더를 불러오는 중…</p><div class="nas-file-list" id="nasFileList"></div>
      <div class="nas-empty" id="nasEmpty" hidden><p id="nasEmptyText"></p></div>
      <button type="button" class="nas-more-button" data-nas-action="more" id="nasMore" hidden>더 보기 ${icon('down')}</button>
    </section>
    <div class="nas-location-dock" id="nasLocationDock" hidden><button type="button" class="nas-location-pill" id="nasLocationCapsule" data-nas-action="open-location" aria-haspopup="dialog" aria-controls="nasLocationMenu" aria-expanded="false"><span id="nasLocationLabel">NAS</span></button></div>
    <div class="nas-location-layer" id="nasLocationLayer" hidden><button type="button" class="nas-location-backdrop" data-nas-action="close-location" aria-label="위치 메뉴 닫기"></button><section class="nas-location-menu" id="nasLocationMenu" role="dialog" aria-modal="true" aria-labelledby="nasLocationTitle"><header class="nas-location-menu-head"><h2 id="nasLocationTitle">현재 위치</h2><button type="button" class="nas-icon-button" id="nasLocationClose" data-nas-action="close-location" aria-label="닫기">${icon('close')}</button></header><nav class="nas-breadcrumbs" id="nasBreadcrumbs" aria-label="현재 폴더 위치"></nav><button type="button" class="nas-text-button" data-nas-action="logout" id="nasLogout" hidden>로그아웃</button></section></div>
    <div class="nas-import-dock" id="nasImportDock" hidden><button type="button" class="nas-import-capsule" id="nasImportCapsule" data-nas-action="open-import">${icon('download')}<span id="nasImportCapsuleText">내 서재에 가져오기</span></button></div>
    <div class="nas-sheet" id="nasImportSheet" hidden><button type="button" class="nas-sheet-backdrop" data-nas-action="close-import" aria-label="가져오기 창 닫기"></button>
    <section class="nas-download-panel" id="nasDownloadPanel" role="dialog" aria-modal="true" aria-labelledby="nasImportTitle" tabindex="-1">
      <div class="nas-sheet-handle" aria-hidden="true"></div><header class="nas-sheet-header"><h2 id="nasImportTitle">내 서재에 가져오기</h2><button type="button" class="nas-icon-button" id="nasImportClose" data-nas-action="close-import" aria-label="닫기">${icon('close')}</button></header>
      <div class="nas-book-label"><label for="nasBookName">책 이름</label><span id="nasSelectionCount">선택한 TXT 없음</span></div>
      <input id="nasBookName" type="text" value="내 책" maxlength="100" autocomplete="off" aria-label="TXT를 추가할 책 이름">
      <div class="nas-transfer-progress" id="nasTransferProgress" hidden><div class="nas-progress-heading"><span id="nasTransferStatus" role="status" aria-live="polite"></span><button type="button" data-nas-action="cancel" id="nasCancel">취소</button></div><progress id="nasDownloadProgress" max="1" value="0"></progress><p id="nasTransferFilename"></p></div>
      <button type="button" class="nas-primary-button nas-download-button" data-nas-action="download" id="nasDownloadButton">${icon('download')}<span>내 서재에 추가</span></button>
    </section></div>`;
  document.body.appendChild(screen);

  const $ = id => document.getElementById(id);
  const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
  let endpoint = DEFAULT_ENDPOINT;
  let sessionToken = '';
  let csrfToken = '';
  let authenticated = false;
  let sessionExpiresAt = 0;
  let bootstrapPromise = null;
  let activeController = null;
  let downloadController = null;
  let sequence = 0;
  let visible = false;
  let ready = false;
  let busy = '';
  let importInProgress = false;
  let currentPath = '/';
  let entries = [];
  let total = 0;
  let nextOffset = 0;
  let savedScroll = 0;
  let previousThemeColor = null;
  let otpRequired = false;
  let authMode = 'approval';
  let approvalPending = false;
  let approvalDeadline = 0;
  let lastApprovalPollAt = 0;
  let approvalWake = null;
  let approvalCancelPromise = null;
  let lastApprovalDiagnostic = null;
  let selectionMode = false;
  let searchQuery = '';
  let importSheetOpen = false;
  let importReturnFocus = null;
  let locationMenuOpen = false;
  let locationReturnFocus = null;
  let transferWasActive = false;
  let approvalCountdownTimer = 0;
  const selected = new Map();
  const api = { actions: {}, render, show, hide, setEndpoint, getEndpoint: () => endpoint };
  window.TextviewNAS = api;

  class NASError extends Error {
    constructor(code, message, diagnostic = null) { super(message); this.name = 'NASError'; this.code = code; this.diagnostic = diagnostic; }
  }

  const errorMessages = {
    OTP_REQUIRED: '6자리 인증코드를 입력해 주세요.',
    OTP_INVALID: '인증코드를 확인해 주세요. 비밀번호를 다시 입력해 주세요.',
    APPROVAL_UNAVAILABLE: '앱 승인 요청을 시작하지 못했습니다. 다시 시도해 주세요.',
    APPROVAL_DENIED: '승인 요청을 거절했습니다. 다시 로그인해 주세요.',
    APPROVAL_EXPIRED: '승인 시간이 끝났습니다. 다시 로그인해 주세요.',
    AUTH_FAILED: '계정과 비밀번호를 확인해 주세요.',
    SESSION_EXPIRED: '연결 시간이 끝났습니다. 다시 로그인해 주세요.',
    FORBIDDEN: '이 폴더나 파일에 접근할 수 없습니다.',
    NAS_UNREACHABLE: 'NAS에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    INVALID_REQUEST: '요청을 처리하지 못했습니다. 다시 시도해 주세요.',
    TOO_LARGE: '32 MB 이하의 TXT 파일만 가져올 수 있습니다.',
    RATE_LIMITED: '요청이 많습니다. 잠시 후 다시 시도해 주세요.',
    NOT_INSTALLED: 'NAS 연결 파일을 먼저 설치해 주세요.',
    NETWORK_ERROR: 'NAS에 연결하지 못했습니다. 주소와 인터넷 연결을 확인해 주세요.',
    TIMEOUT: 'NAS 응답이 늦습니다. 잠시 후 다시 시도해 주세요.',
    CANCELLED: '다운로드를 취소했습니다.',
  };

  function failure(code, message, diagnostic = null) { return new NASError(code, message || errorMessages[code] || errorMessages.INVALID_REQUEST, diagnostic); }
  function safeApprovalDiagnostic(value) {
    if (!value || typeof value !== 'object' || !['password', 'approval-start', 'approval-status', 'approval-complete'].includes(value.stage)) return null;
    const result = { stage: value.stage };
    if (Number.isInteger(value.authVersion) && value.authVersion >= 0 && value.authVersion <= 7) result.authVersion = value.authVersion;
    if (Number.isInteger(value.upstreamCode) && value.upstreamCode >= 0 && value.upstreamCode <= 9999) result.upstreamCode = value.upstreamCode;
    if (Array.isArray(value.availableTypes)) result.availableTypes = [...new Set(value.availableTypes.filter(type => ['amfa', 'otp', 'authenticator'].includes(type)))];
    for (const key of ['proofPresent', 'typesPresent']) if (typeof value[key] === 'boolean') result[key] = value[key];
    return result;
  }
  function rememberApprovalDiagnostic(value = null) {
    lastApprovalDiagnostic = safeApprovalDiagnostic(value);
    if (lastApprovalDiagnostic) $('nasMessage').dataset.approvalDiagnostic = JSON.stringify(lastApprovalDiagnostic);
    else delete $('nasMessage').dataset.approvalDiagnostic;
  }
  function isCancelled(error) { return error?.code === 'CANCELLED' || error?.name === 'AbortError'; }
  function message(text = '', kind = '', showShelf = false) {
    $('nasMessage').hidden = !text;
    $('nasMessage').className = 'nas-message' + (kind ? ' nas-message-' + kind : '');
    $('nasMessageText').textContent = text;
    $('nasMessageShelf').hidden = !showShelf;
  }
  function notify(text) { api.actions.notify?.(text); }
  function runAction(name, ...args) {
    const action = api.actions[name];
    if (typeof action !== 'function') return;
    try { Promise.resolve(action(...args)).catch(() => notify('요청을 처리하지 못했습니다.')); }
    catch (_) { notify('요청을 처리하지 못했습니다.'); }
  }

  function clearSecrets(clearUsername = false) {
    $('nasPassword').value = '';
    $('nasOtp').value = '';
    if (clearUsername) $('nasUsername').value = '';
  }
  function resetSession() {
    clearApproval();
    sessionToken = csrfToken = '';
    authenticated = false;
    sessionExpiresAt = 0;
    bootstrapPromise = null;
    currentPath = '/';
    entries = [];
    total = nextOffset = 0;
    selected.clear();
    otpRequired = false;
    clearSecrets();
  }
  function applySession(data) {
    if (typeof data.sessionToken === 'string' && data.sessionToken) sessionToken = data.sessionToken;
    if (typeof data.csrfToken === 'string' && data.csrfToken) csrfToken = data.csrfToken;
    if (typeof data.authenticated === 'boolean') authenticated = data.authenticated;
    refreshSessionExpiry(data.expiresIn);
  }
  function refreshSessionExpiry(value, fallback = false) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds > 0 && seconds <= 86400) sessionExpiresAt = Date.now() + seconds * 1000;
    else if (fallback && authenticated) sessionExpiresAt = Date.now() + 900000;
  }
  function handleError(error) {
    if (isCancelled(error)) return;
    if (error?.code === 'SESSION_EXPIRED') resetSession();
    message(error?.message || errorMessages.NETWORK_ERROR, 'error');
    $('nasRetry').hidden = authenticated || !['NOT_INSTALLED', 'NAS_UNREACHABLE', 'NETWORK_ERROR', 'TIMEOUT'].includes(error?.code);
    updateView();
  }

  async function responseError(response) {
    let payload = null;
    try { payload = await response.json(); } catch (_) { /* A missing gateway may return an HTML page. */ }
    if (payload?.ok === false && typeof payload.error?.code === 'string') {
      const error = failure(payload.error.code, typeof payload.error.message === 'string' ? payload.error.message : undefined, safeApprovalDiagnostic(payload.error.diagnostic));
      if (error.code === 'RATE_LIMITED') error.retryAfter = retryAfter(response, payload.error.retryAfter);
      return error;
    }
    const code = response.status === 404 ? 'NOT_INSTALLED' : response.status === 413 ? 'TOO_LARGE' : response.status === 429 ? 'RATE_LIMITED' : response.status === 401 ? 'SESSION_EXPIRED' : response.status === 403 ? 'FORBIDDEN' : 'NAS_UNREACHABLE';
    const error = failure(code);
    if (code === 'RATE_LIMITED') error.retryAfter = retryAfter(response);
    return error;
  }

  function retryAfter(response, bodyValue) {
    const header = response.headers.get('Retry-After');
    const seconds = header && /^\d+$/.test(header.trim()) ? Number(header) : bodyValue;
    // Existing gateways do not expose Retry-After through CORS; their window is 600 seconds.
    return Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 86400 ? seconds : 600;
  }

  function waitForRateLimit(seconds, signal, onWait) {
    return new Promise((resolve, reject) => {
      let timer;
      const deadline = Date.now() + seconds * 1000;
      const finish = error => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancelled);
        if (error) reject(error); else resolve();
      };
      const cancelled = () => finish(failure('CANCELLED'));
      const tick = () => {
        if (signal?.aborted) { cancelled(); return; }
        const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        onWait(remaining);
        if (!remaining) finish();
        else timer = setTimeout(tick, Math.min(1000, deadline - Date.now()));
      };
      signal?.addEventListener('abort', cancelled, { once: true });
      tick();
    });
  }

  async function fileRequest(action, payload, options = {}) {
    const generation = sequence;
    while (true) {
      if (generation !== sequence || options.signal?.aborted) throw failure('CANCELLED');
      try { return await request(action, payload, options); }
      catch (error) {
        if (error?.code !== 'RATE_LIMITED') throw error;
        await waitForRateLimit(error.retryAfter || 600, options.signal, remaining => {
          if (generation !== sequence || options.signal?.aborted) return;
          if (options.onRetryWait) options.onRetryWait(remaining);
          else $('nasListLoading').textContent = remaining ? `NAS 요청 대기 중 · ${remaining}초 후 계속` : '폴더를 불러오는 중…';
        });
      }
    }
  }

  async function request(action, payload = {}, options = {}) {
    const requestGeneration = sequence;
    if (action !== 'bootstrap' && (!sessionToken || !csrfToken)) throw failure('SESSION_EXPIRED');
    const controller = new AbortController();
    const parentSignal = options.signal;
    const abortFromParent = () => controller.abort();
    if (parentSignal?.aborted) throw failure('CANCELLED');
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.binary ? 120000 : 35000);
    const headers = { 'Content-Type': 'application/json' };
    if (action !== 'bootstrap') {
      headers.Authorization = 'Bearer ' + sessionToken;
      headers['X-CSRF-Token'] = csrfToken;
    }
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers, body: JSON.stringify({ action, ...payload }),
        credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
      });
      if (!response.ok) throw await responseError(response);
      const contentType = response.headers.get('Content-Type') || '';
      if (options.binary && !/\bjson\b/i.test(contentType)) {
        if (!/^(application\/octet-stream|text\/plain)\b/i.test(contentType)) throw failure('NAS_UNREACHABLE');
        const contentLength = Number(response.headers.get('Content-Length'));
        if (Number.isFinite(contentLength) && contentLength > MAX_FILE_BYTES) throw failure('TOO_LARGE');
        let buffer;
        if (response.body?.getReader) {
          const reader = response.body.getReader();
          const chunks = [];
          let length = 0;
          try {
            while (true) {
              const result = await reader.read();
              if (result.done) break;
              length += result.value.byteLength;
              if (length > MAX_FILE_BYTES) { await reader.cancel(); throw failure('TOO_LARGE'); }
              chunks.push(result.value);
              options.onProgress?.(length);
            }
          } finally { reader.releaseLock(); }
          const bytes = new Uint8Array(length);
          let offset = 0;
          chunks.forEach(chunk => { bytes.set(chunk, offset); offset += chunk.byteLength; });
          buffer = bytes.buffer;
        } else {
          buffer = await response.arrayBuffer();
          if (buffer.byteLength > MAX_FILE_BYTES) throw failure('TOO_LARGE');
          options.onProgress?.(buffer.byteLength);
        }
        if (requestGeneration === sequence && !controller.signal.aborted && !parentSignal?.aborted) {
          refreshSessionExpiry(response.headers.get('X-Textview-Session-Expires-In'), true);
        }
        return { buffer, filename: response.headers.get('X-Textview-Filename') };
      }
      let data;
      try { data = await response.json(); } catch (_) { throw failure('NAS_UNREACHABLE'); }
      if (data?.ok !== true) throw failure(data?.error?.code || 'INVALID_REQUEST', typeof data?.error?.message === 'string' ? data.error.message : undefined);
      if (options.binary) throw failure('INVALID_REQUEST');
      if (requestGeneration === sequence && !controller.signal.aborted && !parentSignal?.aborted) refreshSessionExpiry(data.expiresIn);
      return data;
    } catch (error) {
      if (error instanceof NASError) throw error;
      if (timedOut) throw failure('TIMEOUT');
      if (parentSignal?.aborted || error?.name === 'AbortError') throw failure('CANCELLED');
      throw failure('NETWORK_ERROR');
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortFromParent);
    }
  }

  async function ensureBootstrap(signal, generation) {
    if (sessionToken && csrfToken) return;
    if (bootstrapPromise) return bootstrapPromise;
    const pending = (async () => {
      const data = await request('bootstrap', {}, { signal });
      if (generation !== sequence || signal?.aborted) throw failure('CANCELLED');
      if (!data.sessionToken || !data.csrfToken) throw failure('INVALID_REQUEST');
      applySession(data);
    })();
    bootstrapPromise = pending;
    try { await pending; }
    finally { if (bootstrapPromise === pending) bootstrapPromise = null; }
  }

  function beginOperation(kind) {
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    const generation = ++sequence;
    busy = kind;
    updateView();
    return { controller, generation };
  }
  function finishOperation(operation) {
    if (activeController !== operation.controller) return;
    activeController = null;
    busy = '';
    updateView();
  }

  async function connect() {
    if (!visible || busy) return;
    if (sessionExpiresAt && Date.now() >= sessionExpiresAt) resetSession();
    message();
    $('nasRetry').hidden = true;
    const operation = beginOperation('connect');
    try {
      if (approvalCancelPromise) {
        const cancellation = approvalCancelPromise;
        await cancellation;
        if (approvalCancelPromise === cancellation) approvalCancelPromise = null;
      }
      if (operation.generation !== sequence || operation.controller.signal.aborted) return;
      await ensureBootstrap(operation.controller.signal, operation.generation);
      if (authenticated) {
        const data = await request('status', {}, { signal: operation.controller.signal });
        if (operation.generation !== sequence) return;
        applySession(data);
        if (!authenticated) throw failure('SESSION_EXPIRED');
      }
    } catch (error) { if (operation.generation === sequence) handleError(error); }
    finally { finishOperation(operation); }
    if (visible && authenticated && operation.generation === sequence) void loadDirectory(currentPath);
  }

  function setOtpOpen(open) {
    $('nasOtpField').hidden = !open;
    $('nasOtpToggle').setAttribute('aria-expanded', String(open));
    $('nasOtpToggle').classList.toggle('is-open', open);
    $('nasOtp').required = open && otpRequired;
    if (!open) $('nasOtp').value = '';
  }

  function setAuthMode(mode) {
    authMode = mode === 'otp' ? 'otp' : 'approval';
    otpRequired = false;
    setOtpOpen(authMode === 'otp');
    $('nasLoginNote').textContent = authMode === 'approval'
      ? '로그인 후 Secure SignIn 앱에서 승인해 주세요.'
      : 'Secure SignIn의 6자리 인증코드를 입력할 수 있습니다.';
    updateControls();
  }

  function clearApproval() {
    approvalPending = false;
    approvalDeadline = 0;
    lastApprovalPollAt = 0;
    approvalWake?.();
    $('nasVerifyNumberValue').textContent = '';
    $('nasVerifyNumber').hidden = true;
  }

  function showApproval(data) {
    const expires = Number(data.approval?.expiresIn);
    const deadline = Date.now() + (Number.isFinite(expires) && expires > 0 && expires <= 900 ? expires : 120) * 1000;
    approvalDeadline = approvalDeadline ? Math.min(approvalDeadline, deadline) : deadline;
    approvalPending = true;
    const number = data.approval?.verifyNumber;
    if (Number.isInteger(number) && number >= 0 && number <= 999999) {
      if ($('nasVerifyNumberValue').textContent !== String(number)) $('nasVerifyNumberValue').textContent = String(number);
      $('nasVerifyNumber').hidden = false;
    }
    clearSecrets();
    busy = 'approval';
    updateView();
  }

  function waitApproval(signal, milliseconds) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(failure('CANCELLED')); return; }
      let timer;
      const finish = (error) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (approvalWake === wake) approvalWake = null;
        error ? reject(error) : resolve();
      };
      const abort = () => finish(failure('CANCELLED'));
      const wake = () => finish();
      approvalWake = wake;
      signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(wake, milliseconds);
    });
  }

  async function pollApproval(initial, operation) {
    showApproval(initial);
    lastApprovalPollAt = Date.now();
    while (true) {
      if (operation.generation !== sequence || operation.controller.signal.aborted || !visible) throw failure('CANCELLED');
      const delay = Math.max(0, lastApprovalPollAt + 5000 - Date.now());
      if (delay) { await waitApproval(operation.controller.signal, delay); continue; }
      lastApprovalPollAt = Date.now();
      let data;
      try { data = await request('approval_status', {}, { signal: operation.controller.signal }); }
      catch (error) {
        if (error?.code === 'RATE_LIMITED') {
          if (Date.now() < approvalDeadline) continue;
          throw failure('APPROVAL_EXPIRED');
        }
        throw error;
      }
      if (operation.generation !== sequence || operation.controller.signal.aborted) throw failure('CANCELLED');
      if (data.authenticated === true) {
        if (typeof data.sessionToken !== 'string' || !data.sessionToken || typeof data.csrfToken !== 'string' || !data.csrfToken) throw failure('INVALID_REQUEST');
        return data;
      }
      if (data.approval?.state !== 'pending') throw failure('INVALID_REQUEST');
      if (Date.now() >= approvalDeadline) throw failure('APPROVAL_EXPIRED');
      showApproval(data);
    }
  }

  function cancelApproval(showMessage = true) {
    if (!approvalPending) return approvalCancelPromise;
    const generation = sequence;
    const pending = request('approval_cancel').then(data => {
      if (generation === sequence && !authenticated) applySession(data);
    }).catch(error => {
      if (generation === sequence && visible && !isCancelled(error) && error?.code !== 'SESSION_EXPIRED') message('NAS 승인 요청을 취소하지 못했습니다.', 'error');
    });
    approvalCancelPromise = pending;
    clearApproval();
    activeController?.abort();
    clearSecrets();
    busy = 'approval-cancel';
    if (showMessage) message('로그인을 중단했습니다.');
    updateView();
    return pending;
  }

  async function login(event) {
    event.preventDefault();
    if (busy || !visible) return;
    if (!$('nasUsername').value.trim() || !$('nasPassword').value) { message('계정과 비밀번호를 입력해 주세요.', 'error'); return; }
    if (authMode === 'otp' && (otpRequired || $('nasOtp').value) && !/^[0-9]{6}$/.test($('nasOtp').value)) { setOtpOpen(true); message('6자리 인증코드를 입력해 주세요.', 'error'); $('nasOtp').focus(); return; }
    const loginMode = authMode;
    const loginParams = { username: $('nasUsername').value.trim(), password: $('nasPassword').value };
    if (loginMode === 'approval') loginParams.authMode = 'approval';
    else if ($('nasOtp').value) loginParams.otp = $('nasOtp').value;
    rememberApprovalDiagnostic();
    message();
    $('nasRetry').hidden = true;
    const operation = beginOperation('login');
    let success = false;
    try {
      await ensureBootstrap(operation.controller.signal, operation.generation);
      let data;
      try { data = await request('login', loginParams, { signal: operation.controller.signal }); }
      finally { delete loginParams.password; delete loginParams.otp; }
      if (operation.generation !== sequence) return;
      if (data.authenticated !== true && data.approval?.state === 'pending') data = await pollApproval(data, operation);
      applySession(data);
      if (!authenticated || !sessionToken || !csrfToken) throw failure('AUTH_FAILED');
      clearSecrets();
      otpRequired = false;
      setOtpOpen(false);
      currentPath = '/';
      entries = [];
      selected.clear();
      success = true;
    } catch (error) {
      if (operation.generation !== sequence) return;
      if (approvalPending) void cancelApproval(false);
      if (loginMode === 'otp' && error?.code === 'OTP_REQUIRED') {
        otpRequired = true;
        setOtpOpen(true);
        message(errorMessages.OTP_REQUIRED, 'error');
      } else {
        clearSecrets();
        if (loginMode === 'approval') {
          rememberApprovalDiagnostic(error?.diagnostic);
          otpRequired = false;
          setOtpOpen(false);
          if (['OTP_REQUIRED', 'OTP_INVALID', 'APPROVAL_UNAVAILABLE'].includes(error?.code)) error = failure('APPROVAL_UNAVAILABLE');
        }
        if (error?.code === 'INVALID_REQUEST' && loginMode === 'approval') error = failure('INVALID_REQUEST', 'NAS 연결 파일을 새 버전으로 교체해 주세요.');
        if (loginMode === 'otp' && error?.code === 'OTP_INVALID') { otpRequired = true; setOtpOpen(true); error = failure('OTP_INVALID'); }
        handleError(error);
      }
    } finally {
      delete loginParams.password;
      delete loginParams.otp;
      if (operation.generation === sequence) {
        const cancellation = approvalCancelPromise;
        if (cancellation) await cancellation;
        if (operation.generation === sequence) {
          if (approvalCancelPromise === cancellation) approvalCancelPromise = null;
          clearApproval();
          $('nasOtp').value = '';
        }
      }
      finishOperation(operation);
      if (operation.generation === sequence && otpRequired && visible) $('nasOtp').focus({ preventScroll: false });
    }
    if (success && visible) { window.scrollTo(0, 0); void loadDirectory('/'); }
  }

  function basename(path) { return path.split('/').filter(Boolean).pop() || '내 책'; }
  function parentPath(path) { const parts = path.split('/').filter(Boolean); parts.pop(); return '/' + parts.join('/'); }
  function displaySize(bytes) {
    const size = Math.max(0, Number(bytes) || 0);
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
  }
  function validEntry(entry) {
    return entry && typeof entry.name === 'string' && typeof entry.path === 'string' && entry.path.startsWith('/') && (entry.isDir === true || /\.txt$/i.test(entry.name));
  }
  function eligible(entry) { return !entry.isDir && (!Number.isFinite(Number(entry.size)) || Number(entry.size) <= MAX_FILE_BYTES); }

  function directoryPage(data, path, offset) {
    if (data.path !== path || !Number.isSafeInteger(data.total) || data.total < 0) throw failure('INVALID_REQUEST');
    const responseOffset = Number.isSafeInteger(data.offset) && data.offset >= 0 ? data.offset : offset;
    const cursor = Number.isSafeInteger(data.nextOffset) && data.nextOffset >= 0 ? data.nextOffset : responseOffset + PAGE_LIMIT;
    if (responseOffset !== offset || (cursor <= offset && cursor < data.total)) {
      throw failure('INVALID_REQUEST', '폴더 목록을 끝까지 확인하지 못했습니다. 다시 시도해 주세요.');
    }
    return { entries: Array.isArray(data.entries) ? data.entries.filter(validEntry) : [], total: data.total, nextOffset: cursor };
  }

  function sortEntries(values) {
    return [...values].sort((a, b) => Number(Boolean(b.isDir)) - Number(Boolean(a.isDir)) || collator.compare(a.name, b.name));
  }

  function cancelListOperation(showMessage = true) {
    if (busy !== 'select-all' && busy !== 'list') return;
    const selectingAll = busy === 'select-all';
    ++sequence;
    activeController?.abort();
    activeController = null;
    busy = '';
    if (showMessage) message(selectingAll ? '전체 선택을 취소했습니다.' : '폴더 조회를 취소했습니다.');
    updateView();
  }

  async function loadDirectory(path, append = false) {
    if (busy === 'select-all' || busy === 'list') cancelListOperation(false);
    if (!visible || !authenticated || busy) return;
    const offset = append ? nextOffset : 0;
    if (!append) selected.clear();
    message();
    const operation = beginOperation('list');
    try {
      const data = await fileRequest('list', { path, offset, limit: PAGE_LIMIT }, { signal: operation.controller.signal });
      if (operation.generation !== sequence || operation.controller.signal.aborted) return;
      const page = directoryPage(data, path, offset);
      const combined = append ? [...entries, ...page.entries] : page.entries;
      entries = sortEntries(new Map(combined.map(entry => [entry.path, entry])).values());
      currentPath = path;
      total = page.total;
      nextOffset = page.nextOffset;
      if (!append) {
        searchQuery = '';
        selectionMode = false;
        importSheetOpen = false;
        $('nasSearchInput').value = '';
        $('nasBookName').value = basename(currentPath).slice(0, 100);
        window.scrollTo(0, 0);
      }
      renderDirectory();
    } catch (error) { if (operation.generation === sequence) handleError(error); }
    finally { finishOperation(operation); }
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function filteredEntries() {
    const query = searchQuery.trim().toLocaleLowerCase();
    return entries.filter(entry => !query || entry.name.toLocaleLowerCase().includes(query));
  }
  function entryMeta(entry) {
    if (entry.isDir) return '폴더';
    let modified = '';
    if (Number.isFinite(entry.modifiedAt) && entry.modifiedAt > 0) {
      const date = new Date(entry.modifiedAt);
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
      modified = date.toDateString() === new Date().toDateString() ? '오늘' : date.toDateString() === yesterday.toDateString() ? '어제' : `${date.getMonth() + 1}.${date.getDate()}`;
    }
    return (modified ? modified + ' · ' : '') + displaySize(entry.size) + (eligible(entry) ? '' : ' · 32 MB 초과');
  }
  function syncImportSheet() {
    $('nasImportSheet').hidden = !importSheetOpen;
    screen.classList.toggle('is-sheet-open', importSheetOpen);
    $('nasLocationLayer').hidden = !locationMenuOpen;
    $('nasLocationCapsule').setAttribute('aria-expanded', String(locationMenuOpen));
    screen.classList.toggle('is-location-open', locationMenuOpen);
    document.body.classList.toggle('nas-sheet-open', visible && (importSheetOpen || locationMenuOpen));
    $('nasBrowserView').inert = importSheetOpen || locationMenuOpen;
    screen.querySelector('.nas-header').inert = importSheetOpen || locationMenuOpen;
    $('nasImportDock').hidden = !authenticated || !selected.size || importSheetOpen;
    $('nasLocationDock').hidden = !authenticated || !!selected.size || importSheetOpen || locationMenuOpen;
  }
  function openImportSheet() {
    if (busy || !authenticated || !ready || !selected.size) return;
    importReturnFocus = document.activeElement;
    importSheetOpen = true;
    syncImportSheet();
    updateControls();
    $('nasBookName').focus({ preventScroll: true });
  }
  function closeImportSheet() {
    if (busy) return;
    importSheetOpen = false;
    syncImportSheet();
    if (importReturnFocus?.isConnected) importReturnFocus.focus({ preventScroll: true });
    importReturnFocus = null;
  }
  function openLocationMenu() {
    if (busy || !authenticated || selected.size || importSheetOpen) return;
    locationReturnFocus = document.activeElement;
    locationMenuOpen = true;
    syncImportSheet();
    $('nasLocationClose').focus({ preventScroll: true });
  }
  function closeLocationMenu() {
    if (busy) return;
    locationMenuOpen = false;
    syncImportSheet();
    if (locationReturnFocus?.isConnected) locationReturnFocus.focus({ preventScroll: true });
    locationReturnFocus = null;
  }
  async function toggleSelectAll(checked) {
    if (busy) return;
    const available = filteredEntries().filter(eligible);
    if (!checked) {
      available.forEach(entry => selected.delete(entry.path));
      updateControls();
      return;
    }
    if (nextOffset >= total) {
      available.forEach(entry => selected.set(entry.path, entry));
      updateControls();
      return;
    }
    if (!visible || !authenticated) return;
    const path = currentPath;
    const query = searchQuery.trim().toLocaleLowerCase();
    const candidates = new Map(entries.map(entry => [entry.path, entry]));
    let cursor = nextOffset;
    let directoryTotal = total;
    message();
    const operation = beginOperation('select-all');
    try {
      while (cursor < directoryTotal) {
        $('nasListLoading').textContent = `전체 선택 목록 확인 중 · ${cursor} / ${directoryTotal}`;
        const data = await fileRequest('list', { path, offset: cursor, limit: PAGE_LIMIT }, { signal: operation.controller.signal });
        if (operation.generation !== sequence || operation.controller.signal.aborted || !visible || !authenticated || currentPath !== path) return;
        const page = directoryPage(data, path, cursor);
        page.entries.forEach(entry => candidates.set(entry.path, entry));
        cursor = page.nextOffset;
        directoryTotal = page.total;
      }
      // Keep the original selection until every page succeeds; cancellation is atomic.
      entries = sortEntries(candidates.values());
      total = directoryTotal;
      nextOffset = cursor;
      entries.filter(entry => eligible(entry) && (!query || entry.name.toLocaleLowerCase().includes(query)))
        .forEach(entry => selected.set(entry.path, entry));
      renderDirectory();
    } catch (error) { if (operation.generation === sequence) handleError(error); }
    finally { finishOperation(operation); }
  }
  function stopApprovalCountdown() {
    if (approvalCountdownTimer) { clearInterval(approvalCountdownTimer); approvalCountdownTimer = 0; }
  }
  function updateApprovalCountdown() {
    const seconds = Math.max(0, Math.ceil((approvalDeadline - Date.now()) / 1000));
    $('nasApprovalCountdown').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function renderDirectory() {
    $('nasFolderTitle').textContent = currentPath === '/' ? 'NAS' : basename(currentPath);
    const breadcrumbs = [];
    let accumulated = '';
    const parts = [{ name: 'NAS', path: '/' }, ...currentPath.split('/').filter(Boolean).map(name => { accumulated += '/' + name; return { name, path: accumulated }; })];
    parts.forEach((part, index) => {
      if (index) { const separator = element('span', 'nas-breadcrumb-separator', '/'); separator.setAttribute('aria-hidden', 'true'); breadcrumbs.push(separator); }
      const crumb = element('button', 'nas-breadcrumb', part.name);
      crumb.type = 'button';
      crumb.dataset.nasPath = part.path;
      if (index === parts.length - 1) crumb.setAttribute('aria-current', 'location');
      breadcrumbs.push(crumb);
    });
    $('nasBreadcrumbs').replaceChildren(...breadcrumbs);
    const shown = filteredEntries();
    const rows = shown.map(entry => {
      const row = element(entry.isDir || !selectionMode ? 'button' : 'label', 'nas-file-row' + (entry.isDir ? ' nas-folder-row' : ' nas-txt-row'));
      if (entry.isDir) { row.type = 'button'; row.dataset.nasPath = entry.path; }
      else if (!selectionMode) { row.type = 'button'; row.dataset.nasAction = 'select-file'; row.dataset.nasFilePath = entry.path; row.disabled = !!busy || !eligible(entry); }
      if (entry.isDir) { const arrow = element('span', 'nas-file-arrow'); arrow.innerHTML = icon('next'); row.appendChild(arrow); }
      else if (selectionMode) {
        const check = element('span', 'nas-file-check');
        const input = element('input');
        input.type = 'checkbox'; input.dataset.nasFile = entry.path; input.checked = selected.has(entry.path);
        input.disabled = !!busy || !eligible(entry); input.setAttribute('aria-label', entry.name + ' 선택');
        const circle = element('span', 'nas-check-circle'); circle.setAttribute('aria-hidden', 'true'); circle.innerHTML = icon('check');
        check.append(input, circle); row.appendChild(check);
      } else { const spacer = element('span', 'nas-file-arrow'); spacer.setAttribute('aria-hidden', 'true'); row.appendChild(spacer); }
      const art = element('span', 'nas-file-icon');
      art.innerHTML = icon(entry.isDir ? 'folder' : 'file');
      const copy = element('span', 'nas-file-copy');
      copy.appendChild(element('span', 'nas-file-name', entry.name));
      copy.appendChild(element('span', 'nas-file-meta', entryMeta(entry)));
      row.append(art, copy);
      row.classList.toggle('is-unavailable', !entry.isDir && !eligible(entry));
      row.classList.toggle('is-selected', selected.has(entry.path));
      return row;
    });
    $('nasFileList').replaceChildren(...rows);
    $('nasUpButton').hidden = currentPath === '/';
    const selectable = shown.filter(eligible);
    $('nasSelectAllLabel').hidden = !selectable.length;
    const fileCount = entries.filter(entry => !entry.isDir).length;
    $('nasListCount').textContent = entries.length ? (fileCount ? `TXT ${fileCount}개` : `폴더 ${entries.length}개`) : '';
    $('nasEmpty').hidden = !!shown.length || busy === 'list';
    $('nasEmptyText').textContent = searchQuery.trim() ? '검색한 폴더나 TXT가 없습니다.' : currentPath === '/' ? '접근할 수 있는 공유 폴더가 없습니다.' : '이 폴더에 TXT 파일이 없습니다.';
    $('nasMore').hidden = nextOffset >= total;
    updateControls();
  }

  function updateControls() {
    const locked = !!busy;
    const selectingAll = busy === 'select-all';
    const entryByPath = new Map(entries.map(entry => [entry.path, entry]));
    $('nasLoginButton').disabled = locked;
    $('nasLoginButton').textContent = busy === 'login' ? '로그인 중…' : busy === 'connect' ? '연결 중…' : busy === 'approval-cancel' ? '요청 종료 중…' : '로그인';
    ['nasUsername', 'nasPassword', 'nasOtp', 'nasOtpToggle', 'nasRetry'].forEach(id => { $(id).disabled = locked; });
    $('nasOtpToggle').hidden = true;
    screen.querySelectorAll('[data-nas-auth-mode]').forEach(button => {
      const checked = button.dataset.nasAuthMode === authMode;
      button.disabled = locked;
      button.hidden = checked;
      button.tabIndex = checked ? -1 : 0;
    });
    $('nasApprovalCancel').disabled = !approvalPending;
    $('nasLogout').disabled = locked && !selectingAll;
    $('nasBookName').disabled = locked;
    $('nasDownloadButton').disabled = !ready || !authenticated || locked || !selected.size || !$('nasBookName').value.trim();
    $('nasDownloadButton').querySelector('span').textContent = busy === 'download' ? '가져오는 중…' : '내 서재에 추가';
    $('nasSelectionCount').textContent = selected.size ? `TXT ${selected.size}개 선택` : '선택한 TXT 없음';
    $('nasImportCapsuleText').textContent = `${selected.size}개 서재에 가져오기`;
    $('nasImportCapsule').disabled = !ready || locked || !selected.size;
    $('nasLocationCapsule').disabled = locked;
    $('nasLocationClose').disabled = locked;
    screen.querySelector('.nas-location-backdrop').disabled = locked;
    $('nasLocationLabel').textContent = currentPath === '/' ? 'NAS' : basename(currentPath);
    $('nasBackButton').disabled = busy === 'download';
    $('nasSelectModeToggle').disabled = locked || (!entries.some(eligible) && nextOffset >= total);
    $('nasSelectionDone').disabled = locked;
    $('nasImportClose').disabled = locked;
    screen.querySelector('.nas-sheet-backdrop').disabled = locked;
    $('nasSearchInput').disabled = busy === 'download' || selectingAll;
    $('nasSearchClear').hidden = !searchQuery;
    $('nasSearchClear').disabled = busy === 'download' || selectingAll;
    $('nasTitle').textContent = selectionMode ? `${selected.size}개의 항목` : currentPath === '/' ? 'NAS' : basename(currentPath);
    screen.querySelectorAll('[data-nas-path], [data-nas-action="refresh"], [data-nas-action="up"]').forEach(button => { button.disabled = locked && !selectingAll; });
    $('nasMore').disabled = locked;
    screen.querySelectorAll('[data-nas-action="select-file"]').forEach(button => {
      const entry = entryByPath.get(button.dataset.nasFilePath);
      button.disabled = locked || !eligible(entry || { isDir: true });
    });
    screen.querySelectorAll('[data-nas-file]').forEach(input => {
      const entry = entryByPath.get(input.dataset.nasFile);
      input.disabled = locked || !eligible(entry || { isDir: true });
      input.checked = selected.has(input.dataset.nasFile);
      input.closest('.nas-file-row').classList.toggle('is-selected', input.checked);
    });
    const available = filteredEntries().filter(eligible);
    const selectedVisible = available.filter(entry => selected.has(entry.path)).length;
    $('nasSelectAll').checked = !!available.length && selectedVisible === available.length && nextOffset >= total;
    $('nasSelectAll').indeterminate = selectedVisible > 0 && (selectedVisible < available.length || nextOffset < total);
    $('nasSelectAll').disabled = locked;
    $('nasHeaderSelectAll').disabled = !selectingAll && (locked || (!available.length && nextOffset >= total));
    $('nasHeaderSelectAll').textContent = selectingAll ? '선택 취소' : $('nasSelectAll').checked ? '선택 해제' : '전체 선택';
    $('nasMore').textContent = busy === 'list' ? '불러오는 중…' : '더 보기';
    $('nasEmpty').hidden = !!filteredEntries().length || busy === 'list' || selectingAll;
    $('nasBrowserView').setAttribute('aria-busy', String(busy === 'list' || selectingAll));
    $('nasListLoading').hidden = busy !== 'list' && !selectingAll;
    if (!selectingAll) $('nasListLoading').textContent = '폴더를 불러오는 중…';
    $('nasCancel').disabled = importInProgress;
    $('nasImportDock').hidden = !authenticated || !selected.size || importSheetOpen;
    $('nasLocationDock').hidden = !authenticated || !!selected.size || importSheetOpen || locationMenuOpen;
  }

  function updateView() {
    if (transferWasActive && busy !== 'download') {
      importSheetOpen = false;
      selectionMode = selected.size > 0;
      renderDirectory();
    }
    transferWasActive = busy === 'download';
    if (!authenticated) { selectionMode = false; importSheetOpen = false; locationMenuOpen = false; }
    screen.dataset.view = authenticated ? 'browser' : approvalPending ? 'approval' : 'login';
    screen.classList.toggle('is-selecting', authenticated && selectionMode);
    $('nasLoginView').hidden = authenticated;
    $('nasBrowserView').hidden = !authenticated;
    $('nasBackButton').hidden = authenticated && selectionMode;
    $('nasHeaderSelectAll').hidden = !authenticated || !selectionMode;
    $('nasSelectModeToggle').hidden = !authenticated || selectionMode;
    $('nasSelectionDone').hidden = !authenticated || !selectionMode;
    $('nasTitle').hidden = !authenticated;
    $('nasSearch').hidden = !authenticated;
    $('nasLogout').hidden = !authenticated;
    $('nasLoginForm').hidden = approvalPending;
    $('nasApprovalPanel').hidden = !approvalPending;
    $('nasLoginNote').hidden = approvalPending;
    $('nasConnectionLabel').textContent = approvalPending ? '승인 대기' : busy === 'connect' || busy === 'login' ? '연결 중' : authenticated ? '연결됨' : '연결 안 됨';
    $('nasConnectionLabel').classList.toggle('is-connected', authenticated);
    syncImportSheet();
    if (visible) { const color = document.querySelector('meta[name="theme-color"]'); if (color) color.content = authenticated ? '#000000' : '#38383a'; }
    if (approvalPending && visible) {
      updateApprovalCountdown();
      if (!approvalCountdownTimer) approvalCountdownTimer = setInterval(updateApprovalCountdown, 1000);
    } else stopApprovalCountdown();
    updateControls();
  }

  function filenameFromHeader(header, fallback) {
    let name = fallback;
    if (header) { try { name = decodeURIComponent(header); } catch (_) { /* Use the selected filename when the header is invalid. */ } }
    name = String(name).replace(/[\x00-\x1f\x7f]/g, '').split(/[\\/]/).pop().trim();
    return /\.txt$/i.test(name) ? name : fallback;
  }
  function resultCount(value) { return Array.isArray(value) ? value.length : Math.max(0, Number(value) || 0); }
  function resultText(result, interrupted) {
    const pieces = [];
    if (interrupted) pieces.push('가져오기를 중단했습니다.');
    if (result.added) pieces.push(`${result.added}개 파일을 내 서재에 추가했습니다.`);
    if (result.skipped) pieces.push(`${result.skipped}개 파일은 이미 서재에 있습니다.`);
    if (result.failed) pieces.push(`${result.failed}개 파일을 가져오지 못했습니다.`);
    return pieces.join(' ') || (interrupted ? '가져오기를 중단했습니다.' : '가져온 파일이 없습니다.');
  }

  async function downloadSelected() {
    if (busy || !visible || !authenticated || !ready || !selected.size) return;
    if (typeof api.actions.importDownloaded !== 'function') { message('서재를 준비하지 못했습니다. 앱을 다시 열어 주세요.', 'error'); return; }
    const bookName = $('nasBookName').value.trim();
    if (!bookName) { $('nasBookName').focus(); return; }
    const files = [...selected.values()];
    const controller = new AbortController();
    downloadController = controller;
    busy = 'download';
    importInProgress = false;
    message();
    $('nasTransferProgress').hidden = false;
    $('nasDownloadProgress').max = files.length;
    $('nasDownloadProgress').value = 0;
    const result = { added: 0, skipped: 0, failed: 0 };
    let completed = 0;
    let interrupted = false;
    let downloadError = null;
    updateView();
    try {
      for (let index = 0; index < files.length; index++) {
        if (controller.signal.aborted) throw failure('CANCELLED');
        const entry = files[index];
        if (Number(entry.size) > MAX_FILE_BYTES) throw failure('TOO_LARGE');
        importInProgress = false;
        $('nasTransferStatus').textContent = `다운로드 중 · ${index + 1} / ${files.length}`;
        $('nasTransferFilename').textContent = entry.name;
        updateControls();
        const data = await fileRequest('download', { path: entry.path }, {
          signal: controller.signal, binary: true,
          onProgress: bytes => { $('nasDownloadProgress').value = index + Math.min(.94, Number(entry.size) > 0 ? bytes / Number(entry.size) * .94 : 0); },
          onRetryWait: remaining => { $('nasTransferStatus').textContent = remaining ? `NAS 요청 대기 중 · ${remaining}초 후 계속` : `다운로드 중 · ${index + 1} / ${files.length}`; },
        });
        if (controller.signal.aborted) throw failure('CANCELLED');
        const file = new File([data.buffer], filenameFromHeader(data.filename, entry.name), { type: 'text/plain' });
        importInProgress = true;
        $('nasTransferStatus').textContent = `서재에 추가 중 · ${index + 1} / ${files.length}`;
        updateControls();
        const imported = await api.actions.importDownloaded([file], bookName);
        if (!imported || typeof imported !== 'object') throw failure('INVALID_REQUEST', '서재에 추가한 결과를 확인하지 못했습니다.');
        const added = resultCount(imported.added), skipped = resultCount(imported.skipped), failed = resultCount(imported.failed);
        result.added += added;
        result.skipped += skipped;
        result.failed += failed;
        if (failed || (!added && !skipped)) {
          if (!failed) result.failed++;
          throw failure('INVALID_REQUEST', '서재에 저장하지 못했습니다. 선택한 파일을 유지했습니다.');
        }
        completed++;
        selected.delete(entry.path);
        $('nasDownloadProgress').value = index + 1;
        importInProgress = false;
      }
    } catch (error) {
      interrupted = true;
      if (!isCancelled(error)) downloadError = error;
      if (error?.code === 'SESSION_EXPIRED') resetSession();
    } finally {
      importInProgress = false;
      downloadController = null;
      busy = '';
      $('nasTransferProgress').hidden = true;
      $('nasTransferFilename').textContent = '';
      updateView();
      const summary = resultText(result, interrupted);
      if (visible) message((downloadError ? downloadError.message + ' ' : '') + summary, downloadError || result.failed ? 'error' : 'success', result.added > 0 || result.skipped > 0);
      else if (completed || downloadError) notify((downloadError ? downloadError.message + ' ' : '') + summary);
    }
  }

  async function logout() {
    if (busy === 'select-all') cancelListOperation(false);
    if (busy) return;
    const operation = beginOperation('logout');
    const pending = sessionToken && csrfToken ? request('logout', {}, { signal: operation.controller.signal }) : Promise.resolve();
    resetSession();
    clearSecrets(true);
    setOtpOpen(false);
    $('nasBookName').value = '내 책';
    renderDirectory();
    updateView();
    try { await pending; }
    catch (error) { if (operation.generation === sequence && !isCancelled(error) && error?.code !== 'SESSION_EXPIRED') notify('NAS 연결을 기기에서 해제했습니다.'); }
    finally {
      if (operation.generation === sequence) {
        finishOperation(operation);
        if (visible) { message('로그아웃했습니다.'); void connectAfterLogout(); }
      }
    }
  }
  async function connectAfterLogout() {
    const operation = beginOperation('connect');
    try { await ensureBootstrap(operation.controller.signal, operation.generation); }
    catch (error) { if (operation.generation === sequence) handleError(error); }
    finally { finishOperation(operation); }
  }

  function render(data = {}) { ready = Boolean(data.ready); updateView(); }
  function show() {
    if (visible) { updateView(); return; }
    visible = true;
    screen.hidden = false;
    document.body.classList.add('nas-visible');
    const color = document.querySelector('meta[name="theme-color"]');
    previousThemeColor = color?.content || null;
    if (color) color.content = '#08090b';
    window.scrollTo(0, savedScroll);
    updateView();
    void connect();
  }
  function hide() {
    if (visible) savedScroll = window.scrollY;
    if (approvalPending) void cancelApproval(false);
    visible = false;
    ++sequence;
    activeController?.abort();
    activeController = null;
    bootstrapPromise = null;
    downloadController?.abort();
    if (!downloadController) busy = '';
    clearSecrets();
    importSheetOpen = false;
    locationMenuOpen = false;
    stopApprovalCountdown();
    syncImportSheet();
    screen.hidden = true;
    document.body.classList.remove('nas-visible');
    const color = document.querySelector('meta[name="theme-color"]');
    if (color && previousThemeColor) color.content = previousThemeColor;
  }

  function setEndpoint(value) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
      throw new Error('로컬 테스트 주소만 사용할 수 있습니다.');
    }
    if (busy) throw new Error('진행 중인 요청을 먼저 끝내 주세요.');
    endpoint = url.href;
    resetSession();
    clearSecrets(true);
    setOtpOpen(false);
    renderDirectory();
    updateView();
    if (visible) void connect();
  }

  $('nasLoginForm').addEventListener('submit', login);
  $('nasOtp').addEventListener('input', event => { event.target.value = event.target.value.replace(/[^0-9]/g, '').slice(0, 6); });
  $('nasBookName').addEventListener('input', updateControls);
  $('nasSearchInput').addEventListener('input', event => { if (busy === 'select-all') cancelListOperation(false); searchQuery = event.target.value; renderDirectory(); });
  $('nasSelectAll').addEventListener('change', event => { void toggleSelectAll(event.target.checked); });
  screen.addEventListener('change', event => {
    const input = event.target.closest('[data-nas-file]');
    if (!input || busy) return;
    const entry = entries.find(item => item.path === input.dataset.nasFile);
    if (!entry || !eligible(entry)) return;
    if (input.checked) selected.set(entry.path, entry);
    else selected.delete(entry.path);
    updateControls();
  });
  screen.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !screen.contains(button) || button.disabled) return;
    if (button.dataset.nasAuthMode) { if (!busy) setAuthMode(button.dataset.nasAuthMode); return; }
    if (button.dataset.nasPath) { if (locationMenuOpen) closeLocationMenu(); void loadDirectory(button.dataset.nasPath); return; }
    switch (button.dataset.nasAction) {
      case 'back': if (authenticated && currentPath !== '/') void loadDirectory(parentPath(currentPath)); else runAction('showHome'); break;
      case 'home': runAction('showHome'); break;
      case 'shelf': runAction('showShelf'); break;
      case 'otp': setOtpOpen($('nasOtpField').hidden); if (!$('nasOtpField').hidden) $('nasOtp').focus(); break;
      case 'retry': void connect(); break;
      case 'refresh': void loadDirectory(currentPath); break;
      case 'up': void loadDirectory(parentPath(currentPath)); break;
      case 'more': void loadDirectory(currentPath, true); break;
      case 'select': if (!busy) { selectionMode = true; renderDirectory(); updateView(); } break;
      case 'select-file': {
        const entry = entries.find(item => item.path === button.dataset.nasFilePath);
        if (busy || !entry || !eligible(entry)) break;
        selectionMode = true; selected.set(entry.path, entry); renderDirectory(); updateView(); break;
      }
      case 'selection-done': if (!busy) { selectionMode = false; renderDirectory(); updateView(); } break;
      case 'select-all': if (busy === 'select-all') cancelListOperation(); else void toggleSelectAll(!$('nasSelectAll').checked); break;
      case 'clear-search': searchQuery = ''; $('nasSearchInput').value = ''; renderDirectory(); $('nasSearchInput').focus(); break;
      case 'open-import': openImportSheet(); break;
      case 'close-import': closeImportSheet(); break;
      case 'open-location': openLocationMenu(); break;
      case 'close-location': closeLocationMenu(); break;
      case 'download': void downloadSelected(); break;
      case 'cancel': if (!importInProgress) downloadController?.abort(); break;
      case 'logout': if (locationMenuOpen) closeLocationMenu(); void logout(); break;
      case 'approval-cancel': void cancelApproval(); break;
    }
  });
  screen.querySelector('.nas-auth-modes').addEventListener('keydown', event => {
    if (busy || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    setAuthMode(authMode === 'approval' ? 'otp' : 'approval');
    screen.querySelector('[data-nas-auth-mode]:not([hidden])')?.focus();
  });
  screen.addEventListener('keydown', event => {
    if (event.key === 'Escape' && (busy === 'select-all' || busy === 'list')) { cancelListOperation(); event.preventDefault(); return; }
    if (event.key === 'Escape' && !busy) {
      if (locationMenuOpen) closeLocationMenu();
      else if (importSheetOpen) closeImportSheet();
      else if (selectionMode) { selectionMode = false; renderDirectory(); updateView(); }
      else if (searchQuery) { searchQuery = ''; $('nasSearchInput').value = ''; renderDirectory(); }
      event.preventDefault();
    }
    if (event.key === 'Tab' && locationMenuOpen) {
      const items = [$('nasLocationClose'), ...$('nasBreadcrumbs').querySelectorAll('button'), $('nasLogout')].filter(item => !item.disabled && !item.hidden);
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
    }
    if (event.key === 'Tab' && importSheetOpen) {
      const items = [$('nasImportClose'), $('nasBookName'), busy === 'download' ? $('nasCancel') : $('nasDownloadButton')].filter(item => !item.disabled && !item.hidden);
      if (!items.length) return;
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && visible && approvalPending) approvalWake?.();
  });
  renderDirectory();
  render();
})();
