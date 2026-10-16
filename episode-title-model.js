'use strict';
(() => {
  function titleKey(value) {
    return typeof value === 'string' ? value.normalize('NFC').replace(/\[(?:독점|완결|연재)\]/g, '').replace(/\s+/g, '').toLocaleLowerCase('ko') : '';
  }
  function authorKey(value) {
    return typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, '').toLocaleLowerCase('ko') : '';
  }
  function numberFor(fileName, book = '') {
    if (typeof fileName !== 'string') return null;
    let name = fileName.normalize('NFC').replace(/\.txt$/i, '').trim();
    const prefixes = [book, '[' + book + ']'].filter(value => value && value !== '[]');
    for (const prefix of prefixes) {
      if (name.startsWith(prefix) && /[\s._-]/.test(name.charAt(prefix.length))) {
        name = name.slice(prefix.length).replace(/^[\s._-]+/, '');
        break;
      }
    }
    const match = /^(?:제\s*)?([0-9]{1,6})\s*(?:화|회)?$/.exec(name);
    const number = match ? Number(match[1]) : 0;
    return Number.isSafeInteger(number) && number >= 1 && number <= 10000 ? number : null;
  }
  function text(value) {
    return typeof value === 'string' && value.length <= 300 && !/[\u0000-\u001f\u007f]/.test(value);
  }
  function normalize(value) {
    if (!value || typeof value !== 'object' || !/^[1-9][0-9]{0,11}$/.test(value.productId || '') || typeof value.productId !== 'string' ||
        !text(value.title) || !value.title.trim() || !text(value.author) ||
        !Array.isArray(value.episodes) || value.episodes.length > 10000 ||
        typeof value.checkedAt !== 'number' || !Number.isFinite(value.checkedAt) || value.checkedAt < 0 ||
        (value.pages !== undefined && (!Array.isArray(value.pages) || value.pages.length > 334 || value.pages.some(page => !Number.isSafeInteger(page) || page < 1 || page > 334) || new Set(value.pages).size !== value.pages.length))) return null;
    const seen = new Set();
    const episodes = [];
    for (const item of value.episodes) {
      if (!item || !Number.isSafeInteger(item.number) || item.number < 1 || item.number > 10000 || seen.has(item.number) ||
          !text(item.title) || !item.title.trim()) return null;
      seen.add(item.number);
      episodes.push({ number: item.number, title: item.title.trim() });
    }
    episodes.sort((a, b) => a.number - b.number);
    return { productId: value.productId, title: value.title.trim(), author: value.author.trim(), episodes, pages: [...(value.pages || [])].sort((a, b) => a - b), checkedAt: value.checkedAt };
  }
  window.TextviewEpisodeTitleModel = { numberFor, normalize, titleKey, authorKey };
})();
