// BUJKT Social: runs inside the panels nav.js loads into the feed column
// (frames named "psr-notifications", "psr-messages" and "psr-bookmarks").
// Strips each page down to the part we want, and sends link clicks back to
// the main page.
(() => {
  if (window.top === window || !window.name.startsWith('psr-')) return;
  const kind = window.name.slice(4);
  const root = document.documentElement;
  root.classList.add('psr-frame', 'psr-frame-' + kind);
  // Panels showing a Profile hub tab, and the tab each one shows
  const HUB_TABS = { notifications: 'Notifications', bookmarks: 'Bookmarks' };

  const style = document.createElement('style');
  style.textContent = `
    o-header, header, o-app-shell-header { display: none !important; }
    :root { --app-shell-header-height-desktop: 0px !important; }

    /* Notifications and Bookmarks: only that Profile hub tab, filling the frame.
       Opening the site menu, the hub and its tab all happen while the page is
       invisible; the hub only shows once it's on the right tab. */
    html.psr-hub-frame body { visibility: hidden; }
    html.psr-hub-frame:not(.psr-hub-ready)::after {
      content: 'Loading ' attr(data-psr-tab) '…';
      position: fixed; inset: 0; display: grid; place-items: center;
      font: 0.875rem system-ui, sans-serif; color: color-mix(in oklab, currentColor 50%, transparent);
    }
    dialog.psr-hub { padding: 0 !important; background: var(--color-base-100) !important; }
    html.psr-hub-ready dialog.psr-hub { visibility: visible; }
    #mobile-menu-popover { visibility: hidden !important; }
    dialog.psr-hub::backdrop { background: transparent !important; }
    dialog.psr-hub .profile-hub-modal-frame {
      width: 100vw !important; max-width: none !important;
      height: 100vh !important; max-height: none !important;
      margin: 0 !important; padding: 0 !important;
    }
    dialog.psr-hub .profile-hub-modal-box {
      width: 100% !important; max-width: none !important;
      height: 100% !important; max-height: none !important;
      border-radius: 0 !important; box-shadow: none !important; border: 0 !important;
    }
    /* The hub's title, close buttons and tab bar */
    dialog.psr-hub .profile-hub-modal-box > div:first-child { display: none !important; }

    /* Notifications laid out like the feed: edge to edge, rows split by lines */
    dialog.psr-hub :is(.profile-hub-pane, .profile-hub-pane-content) {
      padding: 0 !important; margin: 0 !important; max-width: none !important;
    }
    dialog.psr-hub o-profile-notifications :is(o-profile-hub-section, .flex-col.gap-4) { gap: 0 !important; }
    dialog.psr-hub o-profile-hub-surface > div {
      border: 0 !important; border-radius: 0 !important; box-shadow: none !important;
    }
    dialog.psr-hub [data-profile-notification-list] { border-bottom: 1px solid var(--color-base-300); }

    /* The All / Marketplace / Social filters as feed-style tabs. The funnel
       button sits at the end of the tab bar; the filters it opens get their
       own row below the tabs. */
    dialog.psr-hub div:has(> o-notification-category-selector) {
      position: sticky; top: 0; z-index: 2;
      display: flex !important; flex-wrap: wrap !important; align-items: stretch !important;
      margin: 0 !important; padding: 0 !important; gap: 0 !important;
      border-bottom: 1px solid var(--color-base-300); background: var(--color-base-100);
    }
    dialog.psr-hub o-notification-category-selector {
      flex: 1 1 0; min-width: 0; max-width: none !important; height: 57px; padding-right: 52px;
    }
    dialog.psr-hub o-notification-category-selector o-responsive-button-group { display: block !important; height: 100%; }
    dialog.psr-hub o-notification-category-selector [role="group"] {
      display: grid !important; grid-auto-flow: column; grid-auto-columns: 1fr;
      width: 100% !important; height: 100%; visibility: visible !important;
    }
    dialog.psr-hub o-notification-category-selector [role="group"] > button {
      height: 100% !important; min-height: 0; margin: 0 !important; padding: 0 8px !important;
      border: 0 !important; border-bottom: 2px solid transparent !important; border-radius: 0 !important;
      background: transparent !important; box-shadow: none !important; outline-offset: -2px;
      font-size: 0.875rem; font-weight: 400; color: color-mix(in oklab, var(--color-base-content) 60%, transparent) !important;
      transition: background-color 0.15s, color 0.15s;
    }
    dialog.psr-hub o-notification-category-selector [role="group"] > button:hover {
      background: color-mix(in oklab, var(--color-base-200) 50%, transparent) !important;
    }
    dialog.psr-hub o-notification-category-selector [role="group"] > button[aria-pressed="true"] {
      border-bottom-color: var(--color-base-content) !important;
      font-weight: 600; color: var(--color-base-content) !important;
    }
    dialog.psr-hub o-notifications-filters { flex: 0 0 100%; min-width: 0; }
    dialog.psr-hub o-notifications-filters > div { gap: 8px !important; }
    dialog.psr-hub o-notifications-filters > div:has(> :nth-child(2)) {
      padding: 10px 16px; border-top: 1px solid var(--color-base-300);
    }
    dialog.psr-hub o-notifications-filters > div > button:first-child {
      position: absolute; top: 12px; right: 12px;
    }
    /* "Showing: …" for the selected filters, before objkt's clear button */
    dialog.psr-hub o-notifications-filters .psr-filter-title {
      flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-size: 0.8125rem; font-weight: 600;
    }
    dialog.psr-hub o-notifications-filters .tooltip-content { display: none !important; }

    /* Messages: the chat list and open chat fill the frame edge to edge */
    html.psr-frame-messages div.grid:has(> aside > o-social-conversation-list) {
      position: fixed !important; inset: 0 !important; z-index: 1000;
      width: 100vw !important; max-width: none !important; height: 100vh !important;
      margin: 0 !important; border-left: 0 !important; border-right: 0 !important;
      /* Keep the list and the chat side by side even when the panel is narrow */
      grid-template-columns: minmax(0, 20rem) minmax(0, 1fr) !important;
    }
    html.psr-frame-messages o-social-message-privacy-notice button {
      max-width: 100%; white-space: nowrap;
    }
    html.psr-frame-messages o-social-message-privacy-notice button > span {
      overflow: hidden; text-overflow: ellipsis;
    }
    html.psr-frame-messages o-social-message-privacy-notice button > span:not([data-psr-short]) {
      visibility: hidden;
    }

    /* While objkt's filters are being set in the background (notifications.js):
       the filter options and the list stay hidden, with a short note instead */
    html.psr-busy dialog.psr-hub o-notifications-filters { display: none !important; }
    html.psr-busy dialog.psr-hub :is(#psr-view, [data-profile-notification-list]) { visibility: hidden !important; }
    html.psr-busy dialog.psr-hub div:has(> o-notification-category-selector)::after {
      content: 'Filtering…';
      position: absolute; left: 0; right: 0; top: 100%; padding: 24px 16px;
      text-align: center; font-size: 0.875rem; color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
    }
    /* objkt's own list is replaced by the regrouped view (notifications.js),
       also when objkt rebuilds it after a filter or "Load more" */
    #psr-view ~ [data-profile-notification-list] { display: none !important; }
    html.psr-frame-messages div.grid > aside:has(> o-social-conversation-list) {
      display: flex !important;
      border-right: 1px solid var(--color-base-300);
    }
  `;
  root.appendChild(style);

  // Opening a profile, post or artwork leaves the panel: the main page goes
  // there instead (Messages keeps its own chat links inside the panel)
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (!a || a.target || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    if (kind === 'messages' && url.pathname.startsWith('/messages')) return;
    e.preventDefault();
    e.stopPropagation();
    window.top.postMessage({ psrNavigate: url.pathname + url.search + url.hash }, location.origin);
  }, true);

  if (HUB_TABS[kind]) {
    root.classList.add('psr-hub-frame');
    root.dataset.psrTab = HUB_TABS[kind].toLowerCase();
    keepHubOpen(HUB_TABS[kind]);
  }
  if (kind === 'messages') {
    // Shortened as soon as the notice appears; hidden until then (CSS above)
    new MutationObserver(shortenPrivacyNotice).observe(root, { childList: true, subtree: true, characterData: true });
  }

  // ⌘K / Ctrl+K inside a panel opens Search in the main page
  addEventListener('keydown', e => {
    if (e.key.toLowerCase() !== 'k' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    window.top.postMessage({ psrSearch: true }, location.origin);
  }, true);

  // "Privacy setting allows messages from people you follow" → "Messages from
  // people you follow"; the full sentence stays as the tooltip
  function shortenPrivacyNotice() {
    const label = document.querySelector('o-social-message-privacy-notice button > span');
    if (!label) return;
    const full = label.textContent.trim();
    if (!full || label.dataset.psrShort === full) return;
    const m = full.match(/allows messages from (.+)$/i);
    const short = m ? `Messages from ${m[1]}` : 'Message privacy';
    label.closest('button').title = full;
    label.textContent = short;
    label.dataset.psrShort = short;
  }

  // An item under "Profile hub" in objkt's site menu. If the menu has no item
  // for this tab, Notifications opens the hub and the tab is picked inside it.
  function hubItem(label) {
    for (const text of [label, 'Notifications']) {
      const items = [...document.querySelectorAll('button, a')].filter(el =>
        el.textContent.trim() === text && !el.hasAttribute('popovertarget') && !el.closest('dialog')
      );
      const item = items.find(el => {
        for (let p = el.parentElement, i = 0; p && i < 5; p = p.parentElement, i++) {
          if (p.textContent.includes('Profile hub')) return true;
        }
        return false;
      });
      if (item) return item;
    }
    return null;
  }

  // Open the Profile hub on the given tab, and reopen it if it closes.
  // Everything here happens out of sight (see the CSS above).
  function keepHubOpen(label) {
    let tries = 0;
    setInterval(() => {
      const dialog = document.querySelector('dialog[open]:has(.profile-hub-modal-box)');
      if (dialog) {
        dialog.classList.add('psr-hub');
        const tab = [...dialog.querySelectorAll('[role="tab"]')].find(t => t.textContent.trim() === label);
        const onTab = !tab || tab.getAttribute('aria-selected') === 'true';
        if (!onTab) tab.click();
        root.classList.toggle('psr-hub-ready', onTab);
        const menu = document.getElementById('mobile-menu-popover');
        if (menu?.matches(':popover-open')) menu.hidePopover();
        return;
      }
      root.classList.remove('psr-hub-ready');
      const item = hubItem(label);
      if (item) item.click();
      // The menu may only build its items once it has been opened
      else if (tries++ % 6 === 0) document.querySelector('[popovertarget="mobile-menu-popover"]')?.click();
    }, 250);
  }
})();
