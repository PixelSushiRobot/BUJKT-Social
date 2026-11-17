// BUJKT Social: the Bookmarks panel (the frame named "psr-bookmarks"), which
// shows the Profile hub's Bookmarks tab. Ported from BUJKT, with:
//  - every bookmark loaded automatically (objkt shows a few at a time)
//  - sort by price that stays applied as cards load, low → high or high → low
//  - artworks without a "Buy" price kept at the end instead of hidden
//  - a status bar saying what's loaded and how it's sorted, with Clear
// Cards are reordered with CSS order, so objkt's own list is never rearranged.
(() => {
  if (window.top === window || window.name !== 'psr-bookmarks') return;

  const MODAL = 'o-profile-hub-modal';
  const CARD = 'o-card-list-item';
  const BTN_ID = 'bujkt-sort-price-btn';
  const BAR_ID = 'bujkt-status';
  const SORT_KEY = 'bujkt-sort';
  const LOAD_WAIT_MS = 6000; // how long one "Load more" may take
  const DEBUG = false;
  const log = (...a) => DEBUG && console.log('[bujkt-social]', ...a);

  let direction = ['asc', 'desc'].includes(localStorage.getItem(SORT_KEY)) ? localStorage.getItem(SORT_KEY) : null;
  let loading = false;
  let loadedAll = false;
  let lastKey = '';
  let timer = null;
  let seq = 0; // objkt's original order, so Clear can put it back

  const bookmarks = () => document.querySelector(`${MODAL} o-profile-bookmarks`);

  // The grid: the <div class="list"> with the most cards (as in BUJKT)
  function grid() {
    const root = bookmarks();
    if (!root) return null;
    return [...root.querySelectorAll('div.list')]
      .filter(l => l.querySelector(CARD))
      .sort((a, b) => b.querySelectorAll(CARD).length - a.querySelectorAll(CARD).length)[0] || null;
  }

  const cards = list => [...list.querySelectorAll(`:scope > ${CARD}`)];

  // Price = the last "N ꜩ" amount in the card's Buy button; null => "Make offer"
  function priceOf(card) {
    const hl = card.querySelector('o-token-card-highlight');
    const m = [...(hl?.textContent || '').matchAll(/([\d.,]+)\s*ꜩ/g)];
    return m.length ? parseFloat(m.at(-1)[1].replace(/,/g, '')) : null;
  }

  // --- Sorting ------------------------------------------------------------------

  function sort() {
    const list = grid();
    if (!list) return null;
    const items = cards(list);
    items.forEach(c => { if (!c.dataset.bujktSeq) c.dataset.bujktSeq = String(seq++); });
    const priced = [];
    const unpriced = [];
    items.forEach(c => {
      const p = priceOf(c);
      (p == null ? unpriced : priced).push([c, p]);
    });
    if (!direction) {
      items.forEach(c => { c.style.order = ''; c.classList.remove('bujkt-unpriced'); });
    } else {
      priced.sort((a, b) => (direction === 'asc' ? a[1] - b[1] : b[1] - a[1]) || (a[0].dataset.bujktSeq - b[0].dataset.bujktSeq));
      unpriced.sort((a, b) => a[0].dataset.bujktSeq - b[0].dataset.bujktSeq);
      // Unpriced cards go last whichever way the sort runs
      [...priced, ...unpriced].forEach(([c], i) => { c.style.order = String(i); });
      unpriced.forEach(([c]) => c.classList.add('bujkt-unpriced'));
      priced.forEach(([c]) => c.classList.remove('bujkt-unpriced'));
      // CSS order only works if the grid lays its cards out as grid or flex
      if (!/grid|flex/.test(getComputedStyle(list).display)) list.classList.add('bujkt-grid');
    }
    return { total: items.length, priced: priced.length, unpriced: unpriced.length };
  }

  // --- Loading every bookmark ---------------------------------------------------

  function loadMoreButton() {
    const root = bookmarks();
    // No visibility check: the panel may be hidden while it keeps loading
    return root && [...root.querySelectorAll('button')]
      .find(b => /load more|show more/i.test(b.textContent) && !b.disabled && !b.closest('[hidden]')) || null;
  }

  async function loadAll() {
    if (loading || loadedAll) return;
    loading = true;
    update();
    try {
      for (let rounds = 0; rounds < 200; rounds++) {
        const button = await waitFor(loadMoreButton, rounds ? 1500 : 3000);
        if (!button) break;
        const before = grid() ? cards(grid()).length : 0;
        button.click();
        const grew = await waitFor(() => (grid() ? cards(grid()).length : 0) > before, LOAD_WAIT_MS);
        if (!grew) break;
        update();
      }
    } finally {
      loading = false;
      loadedAll = true;
      log('Loaded all bookmarks:', grid() ? cards(grid()).length : 0);
      lastKey = '';
      update();
    }
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function waitFor(fn, timeout) {
    for (const end = Date.now() + timeout; Date.now() < end; await sleep(150)) {
      const v = fn();
      if (v) return v;
    }
    return null;
  }

  // --- Toolbar button and status bar --------------------------------------------

  const ICONS = { asc: 'ph-sort-ascending', desc: 'ph-sort-descending' };
  const LABELS = { asc: 'low → high', desc: 'high → low' };

  function injectButton() {
    const modal = document.querySelector(MODAL);
    if (!modal) return;
    if (!bookmarks()) {
      modal.querySelector('#' + BTN_ID)?.remove();
      return;
    }
    let btn = modal.querySelector('#' + BTN_ID);
    if (!btn) {
      // The Select/Customize buttons share a <div class="flex shrink-0 gap-2">
      const anchor = modal.querySelector('[data-tip="Customize"]') || modal.querySelector('[data-tip="Select"]');
      if (!anchor) return;
      btn = document.createElement('button');
      btn.id = BTN_ID;
      btn.type = 'button';
      btn.className = 'btn btn-sm btn-circle tooltip tooltip-left'; // match objkt's buttons
      btn.innerHTML = '<i class="ph text-lg"></i>';
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        setDirection(direction === 'asc' ? 'desc' : 'asc');
      });
      anchor.parentElement.insertBefore(btn, anchor.parentElement.firstChild); // before Select
    }
    // The icon shows the sort applied; clicking flips it
    btn.querySelector('i').className = `ph ${ICONS[direction || 'asc']} text-lg`;
    btn.classList.toggle('btn-active', !!direction);
    btn.dataset.tip = direction ? `Sorted by price ${LABELS[direction]} · click to flip` : 'Sort by price';
    btn.setAttribute('aria-label', btn.dataset.tip);
  }

  function setDirection(dir) {
    direction = dir;
    if (dir) localStorage.setItem(SORT_KEY, dir);
    else localStorage.removeItem(SORT_KEY);
    lastKey = '';
    update();
  }

  function statusBar(stats) {
    const list = grid();
    let bar = document.getElementById(BAR_ID);
    if (!list) {
      bar?.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = BAR_ID;
      bar.addEventListener('click', e => {
        if (e.target.closest('[data-bujkt-clear]')) setDirection(null);
      });
    }
    if (bar.nextElementSibling !== list) list.before(bar);
    const n = stats?.total ?? 0;
    const parts = [];
    if (loading) parts.push(`<span class="bujkt-loading">Loading bookmarks… ${n}</span>`);
    else parts.push(`${n} bookmark${n === 1 ? '' : 's'}`);
    if (direction) {
      parts.push(`<b>Sorted by price: ${LABELS[direction]}</b>`);
      if (stats?.unpriced) parts.push(`${stats.unpriced} without a price at the end`);
    }
    const html = `<span class="bujkt-status-text">${parts.join(' · ')}</span>` +
      (direction ? '<button type="button" class="bujkt-clear" data-bujkt-clear>Clear</button>' : '');
    if (bar.innerHTML !== html) bar.innerHTML = html;
  }

  // --- Keeping it all up to date ------------------------------------------------

  function update() {
    injectButton();
    const list = grid();
    const key = list ? `${cards(list).length}:${list.textContent.length}:${direction}:${loading}` : '';
    if (key === lastKey && document.getElementById(BAR_ID)) return;
    lastKey = key;
    const stats = sort();
    statusBar(stats);
    if (list && !loadedAll && !loading) loadAll();
  }

  new MutationObserver(records => {
    const bar = document.getElementById(BAR_ID);
    if (records.every(r => bar?.contains(r.target) || r.target.id === BTN_ID || r.target.closest?.('#' + BTN_ID))) return;
    clearTimeout(timer);
    timer = setTimeout(update, 200);
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  const style = document.createElement('style');
  style.textContent = `
    /* Bookmarks fill the panel edge to edge */
    dialog.psr-hub o-profile-bookmarks { display: block; padding: 0 16px 24px; }
    #${BAR_ID} {
      position: sticky; top: 0; z-index: 2;
      display: flex; align-items: center; gap: 12px;
      margin: 0 -16px 12px; padding: 10px 16px;
      border-bottom: 1px solid var(--color-base-300); background: var(--color-base-100);
      font-size: 0.8125rem; color: color-mix(in oklab, var(--color-base-content) 65%, transparent);
    }
    #${BAR_ID} b { font-weight: 600; color: var(--color-base-content); }
    #${BAR_ID} .bujkt-status-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #${BAR_ID} .bujkt-loading::before {
      content: ''; display: inline-block; width: 7px; height: 7px; margin-right: 6px; border-radius: 9999px;
      background: var(--color-primary); vertical-align: 1px; animation: bujkt-pulse 0.9s ease-in-out infinite alternate;
    }
    @keyframes bujkt-pulse { from { opacity: 1; } to { opacity: 0.25; } }
    #${BAR_ID} .bujkt-clear {
      flex-shrink: 0; font-weight: 500; color: color-mix(in oklab, var(--color-base-content) 60%, transparent); cursor: pointer;
    }
    #${BAR_ID} .bujkt-clear:hover { color: var(--color-base-content); text-decoration: underline; }
    /* Only used if objkt's grid isn't a grid or flex layout, so CSS order works */
    div.list.bujkt-grid { display: flex !important; flex-wrap: wrap; }
    /* Artworks with no Buy price, kept at the end of a sort */
    ${CARD}.bujkt-unpriced { opacity: 0.6; }
    ${CARD}.bujkt-unpriced:hover { opacity: 1; }
  `;
  document.documentElement.appendChild(style);

  update();
})();
