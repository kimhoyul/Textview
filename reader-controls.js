/* Reader controls. app.js owns books, preferences, and persistence. */
(() => {
  'use strict';

  const steps = {
    fontSize: [14, 18, 20, 24, 28, 34],
    lineHeight: [1.4, 1.6, 1.9, 2, 2.1, 2.2, 2.3, 2.4],
    padding: [12, 16, 20, 22, 28, 34, 40],
    verticalPadding: [12, 16, 20, 24, 28, 34, 40],
  };
  const defaults = {
    fontSize: 20, lineHeight: 1.9, padding: 22, verticalPadding: 20,
    dark: true, wrap: 'word', viewMode: 'page', pageEffect: 'none',
  };
  const paths = {
    back: '<path d="m15 5-7 7 7 7"/>',
    bookmark: '<path d="M6.5 4.5h11v16l-5.5-3.6-5.5 3.6Z"/>',
    contents: '<path d="M3 5h16M3 10h8M3 15h8M3 20h8M15 11h6v9l-3-2-3 2Z"/>',
    settings: '<path d="m9.4 3.2.5-1.2h4.2l.5 1.2.5 2 1.7 1 2-.5 1.3.2 2.1 3.6-.8 1-.9 1.5v2l.9 1.5.8 1-2.1 3.6-1.3.2-2-.5-1.7 1-.5 2-.5 1.2H9.9l-.5-1.2-.5-2-1.7-1-2 .5-1.3-.2-2.1-3.6.8-1 .9-1.5v-2l-.9-1.5-.8-1 2.1-3.6 1.3-.2 2 .5 1.7-1Z"/><circle cx="12" cy="12" r="3.2"/>',
    minus: '<path d="M6 12h12"/>',
    plus: '<path d="M6 12h12M12 6v12"/>',
    word: '<path d="M4 5h12M4 10h9M4 15h12M4 20h8"/>',
    character: '<path d="M4 5h16M4 10h16M4 15h16M4 20h16"/>',
    horizontal: '<path d="M3 12h18M7 7l-5 5 5 5M17 7l5 5-5 5"/>',
    vertical: '<path d="M12 3v18M7 7l5-5 5 5M7 17l5 5 5-5"/>',
    left: '<path d="m14.5 6-6 6 6 6"/>',
    right: '<path d="m9.5 6 6 6-6 6"/>',
    edit: '<path d="m15.5 3.5 5 5M4 20l4.4-.9L20.6 6.9a2.2 2.2 0 0 0-3.1-3.1L5.3 16Z"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</svg>`;
  const $ = id => document.getElementById(id);
  const topbar = document.querySelector('.topbar');
  const footer = document.querySelector('.bottombar');
  const nav = footer?.querySelector('.nav');
  let settingsOpen = false;
  let measureFrame = 0;
  let lastPanelHeight = -1;
  let lastBarHeight = -1;
  let state = { active: false, ready: false, settings: { ...defaults }, page: 1, pageCount: 1 };
  const api = { actions: {}, render, show, hide, openSettings, closeSettings, isSettingsOpen: () => settingsOpen };
  window.TextviewReaderUI = api;
  if (!topbar || !footer || !nav) return;

  const command = document.createElement('div');
  command.className = 'reader-command';
  command.innerHTML = `
    <button type="button" class="reader-icon-button reader-back" data-reader-action="back" aria-label="보관함으로 돌아가기">${icon('back')}</button>
    <div id="readerChapterTitle" class="reader-command-title"></div>
    <div class="reader-command-actions">
      <button type="button" class="reader-icon-button" id="readerBookmarkButton" data-reader-action="bookmark" aria-label="책갈피 추가" aria-pressed="false">${icon('bookmark')}</button>
      <button type="button" class="reader-icon-button" data-reader-action="contents" aria-label="목차 열기">${icon('contents')}</button>
      <button type="button" class="reader-icon-button reader-settings-button" id="readerSettingsButton" data-reader-action="settings" aria-label="읽기 설정 열기" aria-controls="readerSettingsPanel" aria-expanded="false">${icon('settings')}</button>
    </div>`;

  function stepRow(key, label) {
    return `<div class="reader-setting-row reader-step-row" data-reader-setting-row="${key}">
      <span class="reader-setting-label" id="readerSettingLabel-${key}">${label}</span>
      <div class="reader-step-control">
        <span class="reader-setting-level" id="readerSettingLevel-${key}" aria-live="polite"><strong>1</strong><span> / ${steps[key].length}</span></span>
        <div class="reader-stepper" role="group" aria-labelledby="readerSettingLabel-${key}">
          <button type="button" data-reader-step="${key}" data-reader-delta="-1" aria-label="${label} 줄이기">${icon('minus')}</button>
          <button type="button" data-reader-step="${key}" data-reader-delta="1" aria-label="${label} 늘리기">${icon('plus')}</button>
        </div>
      </div>
    </div>`;
  }

  function choiceRow(key, label, choices, className = '') {
    return `<div class="reader-setting-row reader-choice-row ${className}">
      <span class="reader-setting-label" id="readerSettingLabel-${key}">${label}</span>
      <div class="reader-setting-choices" role="radiogroup" aria-labelledby="readerSettingLabel-${key}">${choices.map(choice =>
        `<button type="button" role="radio" aria-checked="false" data-reader-choice="${key}" data-reader-value="${choice.value}">${choice.icon ? icon(choice.icon) : ''}<span>${choice.label}</span></button>`
      ).join('')}</div>
    </div>`;
  }

  const panel = document.createElement('section');
  panel.id = 'readerSettingsPanel';
  panel.className = 'reader-settings-panel';
  panel.setAttribute('aria-label', '읽기 설정');
  panel.hidden = true;
  panel.innerHTML =
    stepRow('fontSize', '글자크기') +
    stepRow('lineHeight', '줄간격') +
    stepRow('padding', '좌우여백') +
    stepRow('verticalPadding', '상하여백') +
    choiceRow('wrap', '줄바꿈', [{ value: 'word', label: '단어단위', icon: 'word' }, { value: 'character', label: '글자단위', icon: 'character' }]) +
    choiceRow('viewMode', '넘김방식', [{ value: 'page', label: '페이지뷰', icon: 'horizontal' }, { value: 'scroll', label: '스크롤뷰', icon: 'vertical' }]) +
    choiceRow('pageEffect', '넘김효과', [{ value: 'none', label: '효과 없음' }, { value: 'slide', label: '슬라이드' }, { value: 'curl', label: '책 넘김' }], 'reader-effect-row') +
    `<div class="reader-settings-tail">
      <div class="reader-theme-choices" role="radiogroup" aria-label="본문 색상">
        <button type="button" role="radio" aria-checked="false" data-reader-choice="dark" data-reader-value="true"><span class="reader-theme-swatch reader-theme-dark" aria-hidden="true"></span><span>다크</span></button>
        <button type="button" role="radio" aria-checked="false" data-reader-choice="dark" data-reader-value="false"><span class="reader-theme-swatch reader-theme-light" aria-hidden="true"></span><span>라이트</span></button>
      </div>
      <button type="button" class="reader-edit-button" data-reader-action="edit">${icon('edit')}<span>본문 편집</span></button>
    </div>`;
  topbar.append(command, panel);

  const pageControls = document.createElement('div');
  pageControls.className = 'reader-page-controls';
  pageControls.innerHTML = `<button type="button" class="reader-icon-button" id="readerPreviousPage" data-reader-page="-1" aria-label="이전 페이지">${icon('left')}</button>
    <span class="reader-page-count" id="readerPageCount" aria-live="off">1 / 1</span>
    <button type="button" class="reader-icon-button" id="readerNextPage" data-reader-page="1" aria-label="다음 페이지">${icon('right')}</button>`;
  nav.appendChild(pageControls);

  function runAction(name, ...args) {
    const action = api.actions[name];
    if (typeof action !== 'function') return;
    try {
      Promise.resolve(action(...args)).catch(() => api.actions.notify?.('요청을 처리하지 못했습니다.'));
    } catch (_) {
      api.actions.notify?.('요청을 처리하지 못했습니다.');
    }
  }

  function closestStep(key) {
    const value = Number(state.settings[key]);
    return steps[key].reduce((best, candidate, index) =>
      Math.abs(candidate - value) < Math.abs(steps[key][best] - value) ? index : best, 0);
  }

  function patchSettings(patch) {
    if (!state.active || !state.ready) return;
    state.settings = { ...state.settings, ...patch };
    renderSettings();
    runAction('changeSettings', patch);
  }

  topbar.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.dataset.readerStep) {
      const key = button.dataset.readerStep;
      const index = Math.max(0, Math.min(steps[key].length - 1, closestStep(key) + Number(button.dataset.readerDelta)));
      patchSettings({ [key]: steps[key][index] });
      return;
    }
    if (button.dataset.readerChoice) {
      const key = button.dataset.readerChoice;
      const value = key === 'dark' ? button.dataset.readerValue === 'true' : button.dataset.readerValue;
      patchSettings({ [key]: value });
      return;
    }
    switch (button.dataset.readerAction) {
      case 'back': runAction('back'); break;
      case 'bookmark': runAction('toggleBookmark'); break;
      case 'contents': runAction('openContents'); break;
      case 'edit': runAction('edit'); break;
      case 'settings': settingsOpen ? closeSettings() : openSettings(); break;
    }
  });
  pageControls.addEventListener('click', event => {
    const button = event.target.closest('[data-reader-page]');
    if (button && !button.disabled) runAction('page', Number(button.dataset.readerPage));
  });
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSettings();
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const button = event.target.closest('[role="radio"]');
    if (!button) return;
    event.preventDefault();
    const siblings = Array.from(button.parentElement.querySelectorAll('[role="radio"]'));
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const next = siblings[(siblings.indexOf(button) + delta + siblings.length) % siblings.length];
    if (!next.disabled) { next.focus(); next.click(); }
  });

  function renderSettings() {
    for (const [key, values] of Object.entries(steps)) {
      const index = closestStep(key);
      const counter = $('readerSettingLevel-' + key);
      counter.querySelector('strong').textContent = String(index + 1);
      counter.setAttribute('aria-label', `${index + 1}단계, 총 ${values.length}단계`);
      panel.querySelectorAll(`[data-reader-step="${key}"]`).forEach(button => {
        const delta = Number(button.dataset.readerDelta);
        button.disabled = !state.active || !state.ready || (delta < 0 ? index === 0 : index === values.length - 1);
      });
    }
    panel.querySelectorAll('[data-reader-choice]').forEach(button => {
      const key = button.dataset.readerChoice;
      const checked = String(state.settings[key]) === button.dataset.readerValue;
      button.setAttribute('aria-checked', String(checked));
      button.classList.toggle('is-selected', checked);
      button.tabIndex = checked ? 0 : -1;
      button.disabled = !state.active || !state.ready;
    });
    panel.querySelector('[data-reader-action="edit"]').disabled = !state.active || !state.ready;
    panel.classList.toggle('reader-scroll-settings', state.settings.viewMode === 'scroll');
    const effects = panel.querySelector('[aria-labelledby="readerSettingLabel-pageEffect"]');
    effects.setAttribute('aria-disabled', String(state.settings.viewMode === 'scroll'));
    effects.querySelectorAll('button').forEach(button => {
      button.disabled = !state.active || !state.ready || state.settings.viewMode === 'scroll';
    });
  }

  function render(model = {}) {
    const wasActive = state.active;
    state = {
      ...model,
      active: Boolean(model.active), ready: Boolean(model.ready),
      settings: { ...defaults, ...model.settings },
    };
    let title = String(state.chapterName || state.bookName || '읽기');
    if (/^\d+$/.test(title)) title += '화';
    $('readerChapterTitle').textContent = title;
    $('readerChapterTitle').title = title;
    command.querySelectorAll('[data-reader-action]').forEach(button => {
      button.disabled = !state.active || !state.ready;
    });
    const bookmark = $('readerBookmarkButton');
    bookmark.setAttribute('aria-pressed', String(Boolean(state.bookmarked)));
    bookmark.setAttribute('aria-label', state.bookmarked ? '책갈피 해제' : '책갈피 추가');
    bookmark.classList.toggle('is-bookmarked', Boolean(state.bookmarked));
    const page = Math.max(1, Number(state.page) || 1);
    const total = Math.max(page, Number(state.pageCount) || 1);
    const scroll = state.settings.viewMode === 'scroll';
    pageControls.classList.toggle('reader-scroll-progress', scroll);
    $('readerPageCount').textContent = scroll ? `${Math.round(Math.min(1, Math.max(0, Number(state.ratio) || 0)) * 100)}%` : `${page} / ${total}`;
    $('readerPageCount').setAttribute('aria-label', scroll ? '읽은 위치' : `${total}페이지 중 ${page}페이지`);
    $('readerPreviousPage').disabled = !state.active || !state.ready || page <= 1;
    $('readerNextPage').disabled = !state.active || !state.ready || page >= total;
    $('prevBtn').disabled = !state.active || !state.ready || !state.canPrevChapter;
    $('nextBtn').disabled = !state.active || !state.ready || !state.canNextChapter;
    renderSettings();
    if (state.active && !wasActive) show();
    else if (!state.active && wasActive) hide();
    scheduleMeasure();
  }

  function show() {
    runAction('layoutWillChange');
    document.body.classList.add('reader-ui-active');
    document.body.classList.remove('show-topbar', 'show-bottombar');
    $('showControls')?.setAttribute('aria-expanded', 'false');
    scheduleMeasure();
  }

  function hide() {
    runAction('layoutWillChange');
    closeSettings(false, false);
    document.body.classList.remove('reader-ui-active');
    document.documentElement.style.setProperty('--reader-settings-height', '0px');
    document.documentElement.style.setProperty('--reader-topbar-height', '0px');
    lastPanelHeight = lastBarHeight = -1;
  }

  function openSettings() {
    if (!state.active || !state.ready || settingsOpen) return;
    runAction('layoutWillChange');
    settingsOpen = true;
    panel.hidden = false;
    document.body.classList.add('settingsOpen', 'show-topbar', 'show-bottombar');
    $('readerSettingsButton').setAttribute('aria-expanded', 'true');
    $('readerSettingsButton').setAttribute('aria-label', '읽기 설정 닫기');
    $('showControls')?.setAttribute('aria-expanded', 'true');
    scheduleMeasure();
  }

  function closeSettings(focusButton = true, notifyLayout = true) {
    const wasOpen = settingsOpen;
    if (wasOpen && notifyLayout) runAction('layoutWillChange');
    settingsOpen = false;
    panel.hidden = true;
    document.body.classList.remove('settingsOpen');
    $('readerSettingsButton').setAttribute('aria-expanded', 'false');
    $('readerSettingsButton').setAttribute('aria-label', '읽기 설정 열기');
    if (wasOpen && focusButton) $('readerSettingsButton').focus({ preventScroll: true });
    scheduleMeasure();
  }

  function scheduleMeasure() {
    if (measureFrame) return;
    measureFrame = requestAnimationFrame(() => {
      measureFrame = 0;
      const visible = state.active && document.body.classList.contains('reader-ui-active');
      const panelHeight = visible && settingsOpen ? Math.round(panel.getBoundingClientRect().height) : 0;
      const barHeight = visible ? Math.round(topbar.getBoundingClientRect().height) : 0;
      if (panelHeight === lastPanelHeight && barHeight === lastBarHeight) return;
      lastPanelHeight = panelHeight;
      lastBarHeight = barHeight;
      document.documentElement.style.setProperty('--reader-settings-height', panelHeight + 'px');
      document.documentElement.style.setProperty('--reader-topbar-height', barHeight + 'px');
      runAction('layoutChanged');
    });
  }

  if (typeof ResizeObserver === 'function') new ResizeObserver(scheduleMeasure).observe(topbar);
  window.addEventListener('resize', scheduleMeasure, { passive: true });
  window.visualViewport?.addEventListener('resize', scheduleMeasure, { passive: true });
  render();
})();
