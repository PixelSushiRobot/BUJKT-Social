// Regroups the notifications list in the Notifications panel (the frame named
// "psr-notifications"). Offers stand out in the timeline, each artist's new
// works and auctions become one row of large thumbnails, and repeated
// reactions and follows are merged. objkt's own list stays in the page,
// hidden, and the view is rebuilt from it whenever it changes (category tabs,
// filters, "Load more").
(() => {
  if (window.top === window || window.name !== 'psr-notifications') return;

  const LIST = 'dialog.psr-hub [data-profile-notification-list]';
  const VIEW_ID = 'psr-view';
  const MINT_VERBS = ['followee_mint', 'followee_mint_gallery'];
  const isAuction = verb => /auction/.test(verb);
  const isDrop = verb => [...MINT_VERBS, 'list', 'open_edition_create'].includes(verb) || isAuction(verb);
  const DROP_WINDOW_MS = 12 * 60 * 60 * 1000; // one artist's works within 12h share a row
  const FOLLOW_WINDOW_MS = 24 * 60 * 60 * 1000;
  const MAX_TILES = 8;
  const REACTIONS = {
    atproto_like: ['liked', 'like', 'likes'],
    atproto_repost: ['reposted', 'repost', 'reposts'],
    atproto_reply: ['replied to', 'reply', 'replies'],
  };
  const DEBUG = false;
  const log = (...a) => DEBUG && console.log('[bujkt-social]', ...a);

  let lastKey = '';
  let timer = null;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // --- Reading objkt's list ------------------------------------------------------

  function parse(article, index) {
    const sentence = article.querySelector('[data-notification-sentence]');
    const lead = article.querySelector('[data-notification-leading-link]');
    const token = sentence?.querySelector('o-token-link a[href]');
    const actor = article.querySelector('a[data-atproto-actor-name]') ||
      sentence?.querySelector('o-holder-link a[href]');
    const avatar = article.querySelector('a[data-atproto-actor-avatar] img') ||
      article.querySelector('o-holder-link[avatarclass] img');
    const time = article.querySelector('time[datetime]');
    return {
      index,
      article,
      verb: article.dataset.legacyVerb || article.dataset.atprotoVerb || '',
      actorHref: actor?.getAttribute('href') || '',
      actorName: actor?.textContent.trim() || '',
      avatar: avatar?.getAttribute('src') || '',
      tokenHref: lead?.getAttribute('href') || token?.getAttribute('href') || '',
      tokenName: token?.textContent.trim() || lead?.querySelector('img')?.alt || '',
      img: lead?.querySelector('img')?.getAttribute('src') || '',
      price: article.querySelector('[data-notification-price]')?.textContent.trim() ||
        // Auctions only state their price in the sentence ("… for 66.60 oXTZ.")
        sentence?.textContent.match(/\bfor\s+([\d.,]+\s*\S+?)\.?\s*$/)?.[1] || '',
      postHref: article.querySelector('a[data-atproto-target-post]')?.getAttribute('href') || '',
      replyText: article.querySelector('[data-atproto-post-text]')?.textContent.trim() || '',
      sentence: sentence?.textContent.replace(/\s+/g, ' ').trim() || '',
      t: time ? Date.parse(time.getAttribute('datetime')) : 0,
      ago: time?.textContent.trim() || '',
      when: time?.dataset.tip || '',
    };
  }

  const timeHtml = i => `<time title="${esc(i.when)}">${esc(i.ago)}</time>`;
  const userLink = (href, name) => `<a class="psr-name" href="${esc(href)}">${esc(name)}</a>`;

  function namesHtml(people) {
    const n = people.map(p => userLink(p.href, p.name));
    if (n.length === 1) return n[0];
    if (n.length === 2) return `${n[0]} and ${n[1]}`;
    const others = n.length - 2;
    return `${n[0]}, ${n[1]} and ${others} other${others > 1 ? 's' : ''}`;
  }

  function uniquePeople(items) {
    const people = [];
    items.forEach(i => {
      if (i.actorHref && !people.some(p => p.href === i.actorHref)) {
        people.push({ href: i.actorHref, name: i.actorName, avatar: i.avatar });
      }
    });
    return people;
  }

  function avatarsHtml(people) {
    return `<div class="psr-avatars">${people.slice(0, 4).map(p =>
      `<a href="${esc(p.href)}" title="${esc(p.name)}">${p.avatar ? `<img src="${esc(p.avatar)}" alt="">` : ''}</a>`
    ).join('')}</div>`;
  }

  // --- Offers -------------------------------------------------------------------
  // Notifications don't say whether an offer is still open, so objkt's public
  // API is asked (via background.js) which offers are still active.

  const OFFER_TTL_MS = 2 * 60 * 1000;
  const offerCache = new Map(); // token href -> { t, offers: [{ price, buyer }], ask }
  let checking = false;
  // The artwork's lowest listing price rides along in the same request. If the
  // API rejects that field, it's dropped for the rest of the session.
  let askSupported = true;

  const SEEN_KEY = 'psr-seen-offers';
  const seen = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'));

  const amount = text => {
    const m = text?.match(/[\d.,]+/);
    return m ? parseFloat(m[0].replace(/,/g, '')) : NaN;
  };
  const addressOf = href => href?.match(/\b(tz[1-4]|KT1)\w{33}\b/)?.[0] || null;
  const tokenRef = href => {
    const m = href?.match(/\/tokens\/(KT1\w{33})\/([^/?#]+)/);
    return m && { contract: m[1], id: m[2] };
  };
  const offerKey = o => [o.tokenHref, o.actorHref, o.price, o.t].join('|');

  // true = still open, false = accepted/cancelled/expired, null = not known (yet)
  function offerState(o) {
    const entry = offerCache.get(o.tokenHref);
    const price = amount(o.price);
    if (!entry || Number.isNaN(price)) return null;
    const buyer = addressOf(o.actorHref);
    // The price shown is rounded to 2 decimals. ꜩ and oXTZ count as the same here.
    return entry.offers.some(x => Math.abs(x.price - price) < 0.006 && (!buyer || x.buyer === buyer));
  }

  async function checkOffers(offers) {
    const now = Date.now();
    const stale = [...new Set(offers.map(o => o.tokenHref))]
      .filter(h => tokenRef(h) && now - (offerCache.get(h)?.t || 0) >= OFFER_TTL_MS);
    if (!stale.length || checking) return;
    checking = true;
    const query = withAsk => 'query { ' + stale.map((h, i) => {
      const { contract, id } = tokenRef(h);
      const c = JSON.stringify(contract);
      const t = JSON.stringify(id);
      return `t${i}: offer_active(where: {fa_contract: {_eq: ${c}}, token: {token_id: {_eq: ${t}}}}) ` +
        '{ price expiry buyer_address currency { decimals } }' +
        (withAsk ? `\na${i}: token(where: {fa_contract: {_eq: ${c}}, token_id: {_eq: ${t}}}) { lowest_ask }` +
          `\ns${i}: listing_sale(where: {token: {fa_contract: {_eq: ${c}}, token_id: {_eq: ${t}}}}, ` +
          'order_by: {timestamp: desc}, limit: 1) { price_xtz }' : '');
    }).join('\n') + ' }';
    try {
      let res = await chrome.runtime.sendMessage({ type: 'objkt-gql', query: query(askSupported) });
      if (!res?.data && askSupported) {
        log('Listing price lookup not available, checking offers only', res?.errors);
        askSupported = false;
        res = await chrome.runtime.sendMessage({ type: 'objkt-gql', query: query(false) });
      }
      if (!res?.data) throw res?.errors;
      stale.forEach((h, i) => {
        const open = (res.data[`t${i}`] || [])
          .filter(o => !o.expiry || Date.parse(o.expiry) > now)
          .map(o => ({ price: o.price / 10 ** (o.currency?.decimals ?? 6), buyer: o.buyer_address }));
        const ask = res.data[`a${i}`]?.[0]?.lowest_ask;
        const sale = res.data[`s${i}`]?.[0]?.price_xtz;
        offerCache.set(h, { t: now, offers: open, ask: ask ? ask / 1e6 : null, lastSale: sale ? sale / 1e6 : null });
      });
      log('Checked open offers on', stale.length, 'artworks');
      lastKey = '';
      schedule();
    } catch (e) {
      log('Offer check failed', e);
    } finally {
      checking = false;
    }
  }

  // One row per artwork, placed at its newest offer, laid out like a new work:
  // "[icon] Artwork received an offer", then the artwork tile with the best
  // offer and who made it. Open offers are highlighted; closed ones are muted.
  function offerRows(offers) {
    const byToken = new Map();
    offers.forEach(o => {
      if (!byToken.has(o.tokenHref)) byToken.set(o.tokenHref, []);
      byToken.get(o.tokenHref).push(o);
    });
    return [...byToken.values()].map(group => {
      const newest = group[0]; // the list is newest first
      const states = group.map(offerState);
      const open = group.filter((o, i) => states[i] !== false);
      const closed = !open.length;
      const shown = (closed ? group : open).slice()
        .sort((a, b) => (amount(b.price) || 0) - (amount(a.price) || 0));
      const [best, ...rest] = shown;
      const keys = group.map(offerKey);
      const isNew = !closed && keys.some(k => !seen.has(k));
      const what = shown.length === 1 ? 'an offer' : `${shown.length} offers`;
      const lower = rest.length
        ? `<span class="psr-tile-sub">+${rest.length} lower · ${rest.map(o => esc(o.price)).join(', ')}</span>` : '';
      return {
        index: newest.index,
        html: `
          <div class="psr-row psr-drop psr-offer${closed ? ' psr-closed' : ''}${isNew ? ' psr-new' : ''}"
               data-psr-keys="${esc(keys.join('\n'))}">
            <div class="psr-row-head">
              <i class="ph ph-hand-coins psr-icon"></i>
              <p><a class="psr-name" href="${esc(best.tokenHref)}">${esc(best.tokenName)}</a> received ${what}${
                closed ? ' <span class="psr-state">· no longer open</span>' : ''}</p>
              ${timeHtml(newest)}
            </div>
            <div class="psr-tiles">
              <a class="psr-tile" href="${esc(best.tokenHref)}" title="${esc(best.tokenName)}">
                <span class="psr-tile-img">${best.img ? `<img src="${esc(best.img)}" alt="" loading="lazy">` : ''}</span>
                <span class="psr-tile-price">${esc(best.price)}</span>
                <span class="psr-tile-sub">from ${esc(best.actorName)}</span>
                ${lower}
              </a>
            </div>
          </div>`,
      };
    });
  }

  function markSeen(keys) {
    keys.forEach(k => seen.add(k));
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-500)));
  }

  // --- Grouping -----------------------------------------------------------------

  const and = words => words.length > 1 ? words.slice(0, -1).join(', ') + ' & ' + words.at(-1) : words[0];

  function dropRows(items) {
    const groups = [];
    for (const d of items.filter(i => isDrop(i.verb) && i.tokenHref)) { // newest first
      let g = groups.find(g => g.actorHref === d.actorHref && g.oldest - d.t <= DROP_WINDOW_MS);
      if (!g) groups.push(g = { actorHref: d.actorHref, actorName: d.actorName, newest: d, oldest: d.t, works: new Map() });
      g.oldest = Math.min(g.oldest, d.t);
      // The same work minted, listed, or listed twice shows once, with its latest price
      const w = g.works.get(d.tokenHref) ||
        { href: d.tokenHref, name: d.tokenName, img: d.img, price: '', minted: false, edition: false, auction: false };
      if (MINT_VERBS.includes(d.verb)) w.minted = true;
      else if (!w.price) {
        w.price = d.price;
        w.auction = isAuction(d.verb);
      }
      if (d.verb === 'open_edition_create') w.edition = true;
      w.img ||= d.img;
      w.name ||= d.tokenName;
      g.works.set(d.tokenHref, w);
    }
    return groups.map(g => {
      const works = [...g.works.values()];
      const n = works.length;
      const minted = works.some(w => w.minted);
      const listed = works.some(w => w.price && !w.auction);
      const auctions = works.filter(w => w.auction).length;
      let phrase;
      if (auctions && !minted && !listed) {
        phrase = n === 1 ? 'started an auction' : `started ${n} auctions`;
      } else {
        const verbs = [minted && 'minted', listed && 'listed', auctions && 'auctioned'].filter(Boolean);
        const what = n === 1 ? (works[0].edition ? 'an open edition' : 'a new work') : `${n} new works`;
        phrase = `${and(verbs)} ${what}`;
      }
      const tiles = works.map((w, i) => `
        <a class="psr-tile${i >= MAX_TILES ? ' psr-extra' : ''}" href="${esc(w.href)}" title="${esc(w.name)}">
          <span class="psr-tile-img">${w.img ? `<img src="${esc(w.img)}" alt="" loading="lazy">` : ''}</span>
          <span class="psr-tile-name">${esc(w.name)}</span>
          <span class="psr-tile-price${w.price ? '' : ' psr-muted'}">${
            w.auction ? `Auction · ${esc(w.price || 'open')}` : esc(w.price || 'Not listed yet')
          }</span>
        </a>`).join('');
      const more = n > MAX_TILES
        ? `<button type="button" class="psr-tile psr-tile-more">+${n - MAX_TILES}</button>` : '';
      const icon = auctions && !minted && !listed ? 'ph-gavel' : listed && !minted && !auctions ? 'ph-tag' : 'ph-sparkle';
      return {
        index: g.newest.index,
        html: `
          <div class="psr-row psr-drop">
            <div class="psr-row-head">
              <i class="ph ${icon} psr-icon"></i>
              <p>${userLink(g.actorHref, g.actorName)} ${phrase}</p>
              ${timeHtml(g.newest)}
            </div>
            <div class="psr-tiles">${tiles}${more}</div>
          </div>`,
      };
    });
  }

  // Someone bought one of your works. No sale notification has been seen in a
  // saved page yet, so these are recognised by type name or by the sentence.
  const SALE_WORDS = /\b(bought|purchased|collected|sold)\b/i;
  const isSale = i => i.tokenHref && i.verb !== 'offer' && !isDrop(i.verb) &&
    (/sale|sold|purchase|buy|collect/.test(i.verb) || SALE_WORDS.test(i.sentence));

  // One row per artwork within a day, laid out like a new work:
  // "[icon] Buyer bought Artwork", then the artwork tile with the price
  function saleRows(sales) {
    const groups = [];
    for (const s of sales) { // newest first
      let g = groups.find(g => g.tokenHref === s.tokenHref && g.oldest - s.t <= FOLLOW_WINDOW_MS);
      if (!g) groups.push(g = { tokenHref: s.tokenHref, members: [], oldest: s.t });
      g.members.push(s);
      g.oldest = Math.min(g.oldest, s.t);
    }
    return groups.map(({ members }) => {
      const [newest] = members;
      const people = uniquePeople(members);
      const verb = newest.sentence.match(SALE_WORDS)?.[1].toLowerCase();
      const phrase = !verb || verb === 'sold' ? 'bought' : verb;
      const n = members.length;
      return {
        index: newest.index,
        html: `
          <div class="psr-row psr-drop psr-sale">
            <div class="psr-row-head">
              <i class="ph ph-shopping-bag-open psr-icon"></i>
              <p>${people.length ? namesHtml(people) : 'Someone'} ${phrase}
                <a class="psr-name" href="${esc(newest.tokenHref)}">${esc(newest.tokenName || 'your work')}</a></p>
              ${timeHtml(newest)}
            </div>
            <div class="psr-tiles">
              <a class="psr-tile" href="${esc(newest.tokenHref)}" title="${esc(newest.tokenName)}">
                <span class="psr-tile-img">${newest.img ? `<img src="${esc(newest.img)}" alt="" loading="lazy">` : ''}</span>
                <span class="psr-tile-price">${esc(newest.price || 'Sold')}</span>
                ${n > 1 ? `<span class="psr-tile-sub">${n} editions sold</span>` : ''}
              </a>
            </div>
          </div>`,
      };
    });
  }

  function reactionRows(items) {
    const byPost = new Map();
    items.filter(i => REACTIONS[i.verb] && i.postHref).forEach(i => {
      if (!byPost.has(i.postHref)) byPost.set(i.postHref, []);
      byPost.get(i.postHref).push(i);
    });
    return [...byPost.entries()].map(([postHref, members]) => {
      const people = uniquePeople(members);
      const verbs = Object.keys(REACTIONS).filter(v => members.some(m => m.verb === v));
      // "A and B liked" only reads true when everyone did the same things
      const uniform = people.length === 1 || verbs.length === 1;
      const phrase = uniform ? verbs.map(v => REACTIONS[v][0]).join(' & ') : 'reacted to';
      const counts = uniform ? '' : `<p class="psr-sub">${verbs.map(v => {
        const n = members.filter(m => m.verb === v).length;
        return `${n} ${REACTIONS[v][n === 1 ? 1 : 2]}`;
      }).join(' · ')}</p>`;
      const reply = members.find(m => m.replyText)?.replyText;
      return {
        index: members[0].index,
        html: `
          <div class="psr-row psr-social">
            ${avatarsHtml(people)}
            <div class="psr-row-text">
              <p>${namesHtml(people)} ${phrase} <a class="psr-name" href="${esc(postHref)}">your post</a></p>
              ${counts}
              ${reply ? `<p class="psr-quote">${esc(reply)}</p>` : ''}
            </div>
            ${timeHtml(members[0])}
          </div>`,
      };
    });
  }

  function followRows(items) {
    const groups = [];
    for (const f of items.filter(i => i.verb === 'new_follower')) {
      let g = groups.find(g => g.oldest - f.t <= FOLLOW_WINDOW_MS);
      if (!g) groups.push(g = { members: [], oldest: f.t });
      g.members.push(f);
      g.oldest = Math.min(g.oldest, f.t);
    }
    return groups.map(({ members }) => {
      const people = uniquePeople(members);
      return {
        index: members[0].index,
        html: `
          <div class="psr-row psr-social">
            ${avatarsHtml(people)}
            <div class="psr-row-text"><p>${namesHtml(people)} followed you</p></div>
            ${timeHtml(members[0])}
          </div>`,
      };
    });
  }

  // Anything not handled above keeps objkt's own row
  function plainRows(items, handled) {
    return items.filter(i => !handled.has(i)).map(i => {
      const copy = i.article.cloneNode(true);
      copy.querySelectorAll('[popover]').forEach(el => el.remove());
      copy.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
      copy.querySelectorAll('[style*="anchor-name"]').forEach(el => el.style.removeProperty('anchor-name'));
      copy.querySelectorAll('.processing, .animate-pulse').forEach(el => el.classList.remove('processing', 'animate-pulse'));
      return { index: i.index, html: `<div class="psr-row psr-plain">${copy.outerHTML}</div>` };
    });
  }

  // --- Right rail summary -------------------------------------------------------
  // The main page's right rail shows open offers, new auctions and a slideshow
  // of new works, all taken from this list (no extra API requests).

  const RAIL_WORKS = 40; // the rail shuffles these and shows up to 12
  let lastSummary = '';

  function railSummary(items, offers) {
    const byToken = new Map();
    offers.forEach(o => {
      if (!byToken.has(o.tokenHref)) byToken.set(o.tokenHref, []);
      byToken.get(o.tokenHref).push(o);
    });
    const openOffers = [];
    for (const group of byToken.values()) {
      const open = group.filter(o => offerState(o) !== false);
      if (!open.length) continue;
      const best = open.slice().sort((a, b) => (amount(b.price) || 0) - (amount(a.price) || 0))[0];
      const ask = offerCache.get(best.tokenHref)?.ask ?? null;
      const lastSale = offerCache.get(best.tokenHref)?.lastSale ?? null;
      openOffers.push({
        href: best.tokenHref, name: best.tokenName, img: best.img, price: best.price,
        from: best.actorName, ago: group[0].ago, count: open.length,
        confirmed: open.some(o => offerState(o) === true),
        isNew: group.some(o => !seen.has(offerKey(o))),
        // At or above the lowest listing price of that artwork
        good: ask != null && amount(best.price) >= ask - 0.006,
        // Above what that artwork last sold for
        aboveSale: lastSale != null && amount(best.price) > lastSale + 0.006,
        ask,
        lastSale,
      });
    }

    const works = new Map();
    for (const d of items.filter(i => isDrop(i.verb) && i.tokenHref)) { // newest first
      const w = works.get(d.tokenHref) ||
        { href: d.tokenHref, name: d.tokenName, img: d.img, artist: d.actorName, artistHref: d.actorHref, ago: d.ago };
      if (!MINT_VERBS.includes(d.verb) && !w.price) {
        w.price = d.price;
        w.auction = isAuction(d.verb);
      }
      w.img ||= d.img;
      works.set(d.tokenHref, w);
    }
    const all = [...works.values()];
    // Artists whose drops reach you (people you follow, plus bookmarks)
    const artists = [...new Set(items.filter(i => isDrop(i.verb)).map(i => addressOf(i.actorHref)).filter(Boolean))];
    // Your own profile link, from the Profile hub's header
    const me = addressOf(document.querySelector(
      '.profile-hub-modal-box > div:first-child a[href^="/users/"]')?.getAttribute('href'));
    return {
      offers: openOffers,
      auctions: all.filter(w => w.auction).slice(0, 4),
      works: all.filter(w => w.img).slice(0, RAIL_WORKS),
      artists,
      me,
    };
  }

  function postSummary(summary) {
    const json = JSON.stringify(summary);
    if (json === lastSummary) return;
    lastSummary = json;
    window.top.postMessage({ psrRail: summary }, location.origin);
  }

  // The main page asks again when its rail is rebuilt, and says which
  // notifications to show ("offers" from the rail's Open offers, or all).
  // "offers" uses objkt's own filters; the extension only filters the list
  // itself if those can't be found.
  let filter = null;
  addEventListener('message', async e => {
    if (e.origin !== location.origin) return;
    if (e.data?.psrRailRequest && lastSummary) {
      window.top.postMessage({ psrRail: JSON.parse(lastSummary) }, location.origin);
    }
    if (!('psrFilter' in (e.data || {}))) return;
    if (e.data.psrFilter === 'offers') {
      // Hidden while the filters are clicked through (see frame.js), and shown
      // once the filtered list has had a moment to load
      document.documentElement.classList.add('psr-busy');
      try {
        const ok = await applyOffersFilter();
        filter = ok ? null : 'offers';
        await settle();
      } finally {
        document.documentElement.classList.remove('psr-busy');
      }
    } else {
      filter = null;
    }
    lastKey = '';
    render();
    document.scrollingElement?.scrollTo(0, 0);
    document.querySelector('dialog.psr-hub .profile-hub-pane')?.scrollTo(0, 0);
    // The main page switches to this panel once it's ready
    window.top.postMessage({ psrFilterDone: e.data.psrFilter }, location.origin);
  });

  // Wait until objkt's list has stopped changing (or 2s at most)
  async function settle() {
    const sig = () => {
      const list = document.querySelector(LIST);
      return list ? list.children.length + ':' + list.textContent.length : '';
    };
    let last = sig();
    for (let quiet = 0, end = Date.now() + 2000; quiet < 3 && Date.now() < end; await sleep(100)) {
      const now = sig();
      quiet = now === last ? quiet + 1 : 0;
      last = now;
    }
  }

  // Offers are under All and Marketplace, not Social
  function showMarketplace() {
    const buttons = [...document.querySelectorAll('dialog.psr-hub o-notification-category-selector [role="group"] > button')];
    const social = buttons.find(b => /social/i.test(b.textContent) && b.getAttribute('aria-pressed') === 'true');
    if (social) buttons.find(b => /marketplace/i.test(b.textContent))?.click();
  }

  // --- objkt's notification filters ---------------------------------------------
  // The funnel button opens a set of filter options; once any are selected a
  // clear button appears next to it. The options are found by their text.

  const FILTERS = 'dialog.psr-hub o-notifications-filters';
  const FILTER_LABELS_KEY = 'psr-filter-labels';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const textOf = el => (el.matches('input') ? el.closest('label')?.textContent || el.getAttribute('aria-label') : el.textContent)
    ?.replace(/\s+/g, ' ').trim() || '';

  async function waitFor(fn, timeout = 3000) {
    for (const end = Date.now() + timeout; Date.now() < end; await sleep(100)) {
      const v = fn();
      if (v) return v;
    }
    return null;
  }

  function funnelButton() {
    return document.querySelector(`${FILTERS} button:has(> i.ph-funnel), ${FILTERS} button[data-tip*="filter" i]`);
  }

  function clearButton() {
    return [...document.querySelectorAll(`${FILTERS} button`)]
      .find(b => b !== funnelButton() && /\b(clear|reset)\b/i.test(textOf(b) + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.dataset.tip || '')));
  }

  // The options shown while the filters are open
  function filterOptions() {
    const root = document.querySelector(FILTERS);
    if (!root) return [];
    const funnel = funnelButton();
    const clear = clearButton();
    return [...root.querySelectorAll('button, [role="option"], [role="menuitemcheckbox"], [role="checkbox"], [role="radio"], input[type="checkbox"], input[type="radio"]')]
      .filter(el => el !== funnel && el !== clear && !el.closest('.psr-filter-title') && textOf(el))
      .filter(el => !(el.matches('input') && el.closest('label')?.querySelector('button')));
  }

  function isOn(el) {
    return el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-checked') === 'true' ||
      el.getAttribute('aria-selected') === 'true' || el.checked === true || !!el.querySelector?.('input:checked') ||
      el.classList.contains('btn-active') || el.classList.contains('btn-primary');
  }

  // Text of an option, with its group's heading when the option alone is
  // vague ("Received" under "Offer")
  function optionLabel(el) {
    const text = textOf(el);
    const group = el.closest('fieldset, [role="group"]')?.querySelector('legend, h3, h4, [class*="font-semibold"]');
    const heading = group && group !== el && !group.contains(el) ? textOf(group) : '';
    return heading && !text.toLowerCase().includes(heading.toLowerCase()) ? `${heading}: ${text}` : text;
  }

  // "Offer: received", whether it's one option or an option under an Offer heading
  function offersReceivedOption() {
    const options = filterOptions();
    return options.find(o => /offer/i.test(optionLabel(o)) && /receiv/i.test(optionLabel(o))) ||
      options.find(o => /offers? received|received offers?/i.test(textOf(o)));
  }

  async function applyOffersFilter() {
    showMarketplace();
    const funnel = await waitFor(funnelButton, 8000);
    if (!funnel) {
      log('Notification filters not found; showing offers from the list instead');
      return false;
    }
    // Start from no filters, so the list is offers only
    clearButton()?.click();
    await sleep(300);
    const wasOpen = filterOptions().length > 0;
    if (!wasOpen) funnelButton()?.click();
    const option = await waitFor(offersReceivedOption);
    if (!option) {
      log('No "Offer: received" filter found. Options:', filterOptions().map(optionLabel));
      if (!wasOpen) funnelButton()?.click();
      return false;
    }
    if (!isOn(option)) option.click();
    await sleep(300);
    rememberFilters();
    funnelButton()?.click(); // close the filters again
    log('Applied objkt filter:', optionLabel(option));
    return true;
  }

  // While the filters are open, note which are selected, so they can still be
  // named once the filters are closed
  function rememberFilters() {
    const options = filterOptions();
    if (!options.length) return;
    const labels = [...new Set(options.filter(isOn).map(optionLabel))];
    sessionStorage.setItem(FILTER_LABELS_KEY, JSON.stringify(labels));
  }

  // "Showing: Offer: received" before the clear button, whenever filters are
  // selected and the options are closed
  function updateFilterTitle() {
    const root = document.querySelector(FILTERS);
    const row = root?.firstElementChild;
    if (!row) return;
    let title = row.querySelector(':scope > .psr-filter-title');
    if (filterOptions().length) {
      rememberFilters();
      title?.remove();
      return;
    }
    const clear = clearButton();
    const labels = JSON.parse(sessionStorage.getItem(FILTER_LABELS_KEY) || '[]');
    if (!clear) {
      sessionStorage.removeItem(FILTER_LABELS_KEY);
      title?.remove();
      return;
    }
    const text = labels.length ? `Showing: ${labels.join(', ')}` : 'Filters applied';
    if (!title) {
      title = document.createElement('span');
      title.className = 'psr-filter-title';
    }
    if (title.textContent !== text) title.textContent = text;
    if (title.nextElementSibling !== clear) clear.before(title);
  }

  // --- Rendering ----------------------------------------------------------------

  function render() {
    const list = document.querySelector(LIST);
    if (!list) return;
    const articles = [...list.querySelectorAll('o-notification-item article')];
    let view = document.getElementById(VIEW_ID);
    if (!articles.length) {
      list.classList.remove('psr-replaced');
      view?.remove();
      return;
    }
    const key = articles.length + ':' + list.textContent.length + ':' + list.textContent.slice(0, 200);
    if (key === lastKey && view && view.nextElementSibling === list) return;
    lastKey = key;

    const items = articles.map(parse);
    const offers = items.filter(i => i.verb === 'offer' && i.tokenHref);
    const sales = items.filter(isSale);
    const handled = new Set(items.filter(i =>
      i.verb === 'offer' || i.verb === 'new_follower' || isSale(i) ||
      (isDrop(i.verb) && i.tokenHref) || (REACTIONS[i.verb] && i.postHref)
    ));
    const rows = filter === 'offers' ? offerRows(offers) : [
      ...offerRows(offers), ...saleRows(sales), ...dropRows(items), ...reactionRows(items), ...followRows(items),
      ...plainRows(items, handled),
    ].sort((a, b) => a.index - b.index);

    if (!view) {
      view = document.createElement('div');
      view.id = VIEW_ID;
    }
    const filterBar = filter === 'offers' ? `
      <div class="psr-filter-bar">
        <i class="ph ph-hand-coins"></i><span>Showing offers only</span>
        <button type="button" class="psr-show-all">Show all</button>
      </div>` : '';
    const empty = filter === 'offers' && !rows.length
      ? '<p class="psr-empty">No offers in these notifications. Try “Load more” below.</p>' : '';
    view.innerHTML = filterBar + rows.map(r => r.html).join('') + empty;
    if (view.nextElementSibling !== list) list.before(view);
    list.classList.add('psr-replaced');
    log('Showing', items.length, 'notifications as', rows.length, 'rows,', offers.length, 'of them offers', filter ? `(filter: ${filter})` : '');
    postSummary(railSummary(items, offers));
    checkOffers(offers);
    if (filter === 'offers') showMarketplace();
  }

  function onClick(e) {
    if (!e.target.closest?.('#' + VIEW_ID)) return;
    if (e.target.closest('.psr-show-all')) {
      filter = null;
      lastKey = '';
      render();
      return;
    }
    const more = e.target.closest('.psr-tile-more');
    if (more) {
      more.closest('.psr-drop').classList.add('psr-all');
      return;
    }
    // Opening an offer counts as seeing it (the link itself is handled by frame.js)
    const card = e.target.closest('[data-psr-keys]');
    if (card) markSeen(card.dataset.psrKeys.split('\n'));
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      render();
      updateFilterTitle();
    }, 250);
  }

  // On window, so it runs before frame.js sends link clicks to the main page
  addEventListener('click', onClick, true);

  new MutationObserver(records => {
    const view = document.getElementById(VIEW_ID);
    if (view && records.every(r => view.contains(r.target))) return;
    schedule();
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  // Offers can be accepted or withdrawn without the list changing
  setInterval(() => {
    const list = document.querySelector(LIST);
    if (list) checkOffers([...list.querySelectorAll('article[data-legacy-verb="offer"]')].map(parse));
  }, OFFER_TTL_MS);
})();
