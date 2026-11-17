// BUJKT Social: adds social navigation to the top of the social feed's left
// rail: Home, Search, Notifications, Messages and Bookmarks. All but Home open
// in the feed column, so you stay on the social page.
(() => {
  const RAIL = 'o-social-feed-left-rail > aside';
  const BELL = 'button[popovertarget="desktop-notifications-popover"]';
  const BADGE_SOURCES = { notifications: BELL, messages: 'o-header button[data-header-messages]' };
  const HOST_ID = 'psr-nav-rail';
  const CENTER_ID = 'psr-center';
  const VIEWS = ['feed', 'search', 'notifications', 'messages', 'bookmarks'];
  const DEBUG = false;
  const root = document.documentElement;
  const log = (...a) => DEBUG && console.log('[bujkt-social]', ...a);

  let view = 'feed';
  let lastUrl = null;
  let timer = null;
  // Set by ⌘K on another page: open Search once the social page has loaded
  let searchPending = false;

  const NAV_HTML = `
    <nav class="psr-nav" aria-label="Social">
      <a class="psr-nav-row" data-psr-nav="feed" href="/social"><i class="ph ph-house"></i><span>Home</span></a>
      <button type="button" class="psr-nav-row" data-psr-nav="search"><i class="ph ph-magnifying-glass"></i><span>Search</span></button>
      <button type="button" class="psr-nav-row" data-psr-nav="notifications">
        <i class="ph ph-bell"></i><span>Notifications</span><span class="psr-nav-badge"></span>
      </button>
      <button type="button" class="psr-nav-row" data-psr-nav="messages"><i class="ph ph-chat-circle"></i><span>Messages</span><span class="psr-nav-badge"></span></button>
      <button type="button" class="psr-nav-row" data-psr-nav="bookmarks"><i class="ph ph-bookmark-simple"></i><span>Bookmarks</span></button>
    </nav>`;

  const CENTER_HTML = `
    <div class="psr-search">
      <form role="search" class="psr-own">
        <i class="ph ph-magnifying-glass"></i>
        <input type="search" name="q" placeholder="Search social" aria-label="Search social" autocomplete="off">
      </form>
    </div>
    <div class="psr-notifications">
      <button type="button" class="psr-new-pill"><i class="ph ph-arrow-up"></i><span>New notifications</span></button>
    </div>
    <div class="psr-messages"></div>
    <div class="psr-bookmarks"></div>`;

  // Pages loaded into the column for these views (frame.js trims them down).
  // Notifications preloads; Messages and Bookmarks load when first opened.
  const FRAMES = { notifications: '/social', messages: '/messages', bookmarks: '/social' };
  const FRAME_TITLES = { notifications: 'Notifications', messages: 'Messages', bookmarks: 'Bookmarks' };

  // objkt is a single-page app: change the address and let its router react,
  // instead of reloading the page
  function go(url) {
    if (url === location.pathname + location.search) return;
    history.pushState({}, '', url);
    dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }

  const searchQuery = () =>
    location.pathname === '/social' ? new URLSearchParams(location.search).get('search') || '' : '';

  // The feed layout grid holds the feed column plus one wrapper (marked
  // ofeedrailsticky) around both rails, so the feed column is the other child
  function findCenter() {
    return document.querySelector('o-feed-layout .grid > :not([ofeedrailsticky])');
  }

  // objkt's own social search box from the header. It's moved into the feed
  // column while Search is open and put back afterwards.
  let searchHome = null;
  function placeSearch(open) {
    const search = document.querySelector('o-global-search');
    const slot = document.querySelector(`#${CENTER_ID} .psr-search`);
    if (!search || !slot) return false;
    if (open && search.parentElement !== slot) {
      searchHome = search.parentElement;
      slot.appendChild(search);
    } else if (!open && searchHome && search.parentElement === slot) {
      searchHome.appendChild(search);
    }
    return true;
  }

  function setup(rail) {
    let nav = rail.querySelector('#' + HOST_ID);
    if (!nav) {
      nav = document.createElement('section');
      nav.id = HOST_ID;
      nav.innerHTML = NAV_HTML;
      nav.addEventListener('click', onNavClick);
    }
    if (rail.firstElementChild !== nav) rail.prepend(nav);

    const col = findCenter();
    if (!col) {
      log('Feed column not found');
      return nav;
    }
    let center = document.getElementById(CENTER_ID);
    if (!center) {
      center = document.createElement('div');
      center.id = CENTER_ID;
      center.innerHTML = CENTER_HTML;
      center.querySelector('form.psr-own').addEventListener('submit', onSearch);
      center.querySelector('.psr-new-pill').addEventListener('click', refreshNotifications);
      log('Feed column found', col);
      // Start loading notifications early so they're ready when opened
      setTimeout(() => ensureFrame('notifications'), 2000);
    }
    if (!col.classList.contains('psr-center-col')) {
      document.querySelectorAll('.psr-center-col').forEach(c => c.classList.remove('psr-center-col'));
      col.classList.add('psr-center-col');
    }
    if (col.firstElementChild !== center) col.prepend(center);
    return nav;
  }

  function ensureFrame(kind) {
    const box = document.querySelector(`#${CENTER_ID} .psr-${kind}`);
    if (!box || box.querySelector('iframe')) return;
    const frame = document.createElement('iframe');
    frame.name = 'psr-' + kind;
    frame.src = FRAMES[kind];
    frame.title = FRAME_TITLES[kind];
    if (kind === 'notifications') frame.addEventListener('load', sendFilter);
    box.appendChild(frame);
  }

  // Which notifications to show ("offers", or null for all). Sent again once
  // the panel has loaded, in case it wasn't ready yet.
  let notifFilter = null;
  function sendFilter() {
    document.querySelector('iframe[name="psr-notifications"]')
      ?.contentWindow.postMessage({ psrFilter: notifFilter }, location.origin);
  }

  // With a filter, the panel sets objkt's filters out of sight first; this
  // page switches to it when the panel says it's done (or after a few seconds)
  const FILTER_WAIT_MS = 6000;
  let pendingFilter = null;
  function openNotifications(filter) {
    notifFilter = filter || null;
    if (!notifFilter) {
      pendingFilter = null;
      setView('notifications');
      sendFilter();
      return;
    }
    ensureFrame('notifications');
    const token = pendingFilter = {};
    document.querySelector(`#${HOST_ID} [data-psr-nav="notifications"]`)?.classList.add('psr-loading');
    const show = () => {
      if (pendingFilter !== token) return;
      pendingFilter = null;
      document.querySelector(`#${HOST_ID} [data-psr-nav="notifications"]`)?.classList.remove('psr-loading');
      setView('notifications');
    };
    token.show = show;
    setTimeout(show, FILTER_WAIT_MS);
    sendFilter();
  }

  // The panel doesn't update by itself, so reload it when the bell's count
  // goes up: straight away while it's hidden, or from the "New notifications"
  // pill while it's open (so the list doesn't jump while you read it).
  // The filter is applied again once it has loaded (see sendFilter).
  let lastNotifCount = null;
  function onNotifCount(count) {
    const prev = lastNotifCount;
    lastNotifCount = count;
    if (prev === null || !count || count === prev) return;
    const more = !prev || count === '•' || parseInt(count, 10) > parseInt(prev, 10);
    if (!more) return;
    log('New notifications', prev, '→', count);
    if (view === 'notifications') setPill(true);
    else refreshNotifications();
  }

  function refreshNotifications() {
    setPill(false);
    const frame = document.querySelector('iframe[name="psr-notifications"]');
    try { frame?.contentWindow.location.reload(); } catch { if (frame) frame.src = FRAMES.notifications; }
  }

  function setPill(show) {
    document.querySelector(`#${CENTER_ID} .psr-new-pill`)?.classList.toggle('psr-show', show);
  }

  // The open panel is kept in the address (/social#notifications), so a
  // browser refresh comes back to it instead of the feed
  const HASH_VIEWS = ['notifications', 'messages', 'bookmarks'];
  const hashView = () => {
    const v = location.hash.slice(1);
    return location.pathname === '/social' && HASH_VIEWS.includes(v) ? v : null;
  };
  function saveView(v) {
    if (location.pathname !== '/social') return;
    const hash = HASH_VIEWS.includes(v) ? '#' + v : '';
    if (location.hash === hash) return;
    history.replaceState(history.state, '', location.pathname + location.search + hash);
  }

  function setView(v) {
    // Any other choice cancels a filtered Notifications that's still loading
    if (v !== 'notifications' && pendingFilter) {
      pendingFilter = null;
      document.querySelector(`#${HOST_ID} [data-psr-nav="notifications"]`)?.classList.remove('psr-loading');
    }
    view = v;
    saveView(v);
    if (FRAMES[v]) ensureFrame(v);
    render();
    if (v === 'search') focusSearch();
  }

  // objkt's box when it has been moved into the column, otherwise ours
  function focusSearch() {
    setTimeout(() => {
      const inputs = document.querySelectorAll(`#${CENTER_ID} .psr-search input`);
      [...inputs].find(i => i.offsetParent)?.focus();
    }, 0);
  }

  // ⌘K / Ctrl+K opens Search in the feed column, from any objkt page
  function openSearch() {
    if (location.pathname === '/social' && document.querySelector(RAIL)) {
      setView('search');
    } else {
      searchPending = true;
      go('/social');
    }
  }

  function render() {
    const rail = document.querySelector(RAIL);
    root.classList.toggle('psr-has-rail', !!rail);

    // A real page change (link click, back button, search) resets the view,
    // unless the address names a panel (e.g. after a browser refresh)
    const url = location.pathname + location.search;
    if (url !== lastUrl) {
      lastUrl = url;
      view = searchQuery() ? 'search' : hashView() || 'feed';
    }
    VIEWS.forEach(v => root.classList.toggle('psr-view-' + v, !!rail && view === v));
    if (!rail) return;
    if (searchPending && location.pathname === '/social') {
      searchPending = false;
      setView('search');
      return;
    }

    const nav = setup(rail);
    if (FRAMES[view]) ensureFrame(view);
    if (view !== 'notifications') setPill(false);
    nav.querySelectorAll('[data-psr-nav]').forEach(el =>
      el.classList.toggle('psr-active', el.dataset.psrNav === view)
    );

    // Use objkt's real search box if it's there; our own form is the fallback
    const moved = placeSearch(view === 'search');
    root.classList.toggle('psr-real-search', moved);
    if (!moved) {
      const input = document.querySelector(`#${CENTER_ID} .psr-search form.psr-own input`);
      if (input && document.activeElement !== input && input.value !== searchQuery()) input.value = searchQuery();
    }

    // Copy the unread counts from the (hidden) header bell and Messages buttons
    nav.querySelectorAll('[data-psr-nav] .psr-nav-badge').forEach(badge => {
      const kind = badge.closest('[data-psr-nav]').dataset.psrNav;
      const count = unreadCount(document.querySelector(BADGE_SOURCES[kind]));
      if (badge.textContent !== count) badge.textContent = count;
      badge.classList.toggle('psr-dot', count === '•');
      if (kind === 'notifications') onNotifCount(count);
    });
  }

  // A header button's unread count: a number in it or its label, or a dot
  // when it only shows a coloured marker
  function unreadCount(button) {
    if (!button) return '';
    const number = [...button.querySelectorAll('span, div, sup')]
      .map(s => s.textContent.trim())
      .find(t => /^\d+\+?$/.test(t) && t !== '0');
    if (number) return number;
    const label = (button.getAttribute('aria-label') || '') + ' ' + (button.title || '');
    const fromLabel = label.match(/(\d+\+?)\s*(new|unread)/i)?.[1];
    if (fromLabel && fromLabel !== '0') return fromLabel;
    const marker = button.querySelector('.badge, .indicator-item, .status, span[class*="bg-primary"], span[class*="bg-error"], span[class*="bg-accent"]');
    return marker ? '•' : '';
  }

  function onNavClick(e) {
    const item = e.target.closest('[data-psr-nav]');
    if (!item) return;
    const kind = item.dataset.psrNav;
    if (kind === 'feed') {
      // Keep normal new-tab behaviour for modified clicks
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
      e.preventDefault();
      if (location.pathname === '/social' && !location.search) setView('feed');
      else go('/social');
      return;
    }
    if (kind === 'notifications') {
      // Clicking it again while new ones are waiting loads them
      if (view === 'notifications' && document.querySelector(`#${CENTER_ID} .psr-new-pill.psr-show`)) refreshNotifications();
      openNotifications(null);
    }
    else setView(kind);
  }

  function onSearch(e) {
    e.preventDefault();
    const q = e.target.elements.q.value.trim();
    go(q ? `/social?search=${encodeURIComponent(q)}` : '/social');
    if (q) setView('search');
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(render, 150);
  }

  new MutationObserver(records => {
    const nav = document.getElementById(HOST_ID);
    const center = document.getElementById(CENTER_ID);
    if (records.every(r => nav?.contains(r.target) || center?.contains(r.target))) return;
    schedule();
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  // Unread markers may only change a class or label, so the header buttons
  // are also watched for attribute changes
  let watchedHeader = null;
  setInterval(() => {
    const header = document.querySelector('o-header');
    if (!header || header === watchedHeader) return;
    watchedHeader = header;
    new MutationObserver(schedule).observe(header, {
      subtree: true, attributes: true, attributeFilter: ['class', 'aria-label', 'title', 'hidden'],
    });
  }, 1000);

  addEventListener('popstate', schedule);

  // Capture on window so this runs before objkt's own ⌘K handler
  addEventListener('keydown', e => {
    if (e.key.toLowerCase() !== 'k' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openSearch();
  }, true);

  // A link clicked inside a panel opens here, in the main page; ⌘K in a panel opens Search
  addEventListener('message', e => {
    if (e.origin !== location.origin || !e.data || typeof e.data !== 'object') return;
    if (e.data.psrSearch) openSearch();
    else if ('psrFilterDone' in e.data) pendingFilter?.show();
    else if (e.data?.psrView === 'notifications') openNotifications(e.data.psrFilter);
    else if (VIEWS.includes(e.data?.psrView)) setView(e.data.psrView);
    else if (typeof e.data?.psrNavigate === 'string') go(e.data.psrNavigate);
  });

  render();
})();
