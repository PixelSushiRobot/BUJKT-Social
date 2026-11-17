// Right rail additions on the social page, under Followers / Following:
//  - objkt's Tezos price chart, shrunk to a one-line ticker
//  - For you: open offers (flagged when at your price or above
//    the last sale), auctions you're winning, auctions and open editions from
//    artists you follow ending soon, and new auctions
//  - Your stats: sales over 7 and 30 days, active listings, wallet balance
//  - A slideshow: new drops (sold-out works skipped), your collection, or
//    today's top sales
// Notifications come from the Notifications panel (notifications.js sends a
// summary). Everything else comes from objkt's public API, plus TzKT for the
// wallet balance.
(() => {
  if (window.top !== window) return;

  const RAIL = 'o-social-feed-discovery-rail > aside';
  const CARDS_ID = 'psr-rail-cards';
  const SLIDE_MS = 5000;
  const MAX_OFFERS = 3;
  const MAX_ENDING = 4;
  const MAX_AUCTIONS = 3;
  const MAX_SLIDES = 12;
  const MAX_PER_ARTIST = 2;
  const ENDING_WINDOW_MS = 48 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const REFRESH = { mine: 5 * 60 * 1000, ending: 2 * 60 * 1000, drops: 5 * 60 * 1000, trending: 10 * 60 * 1000 };
  const SOURCES = { drops: 'New drops', collection: 'My collection', trending: 'Top sales today' };
  const ME_KEY = 'psr-me';
  const SOURCE_KEY = 'psr-slide-source';
  const DEBUG = false;
  const log = (...a) => DEBUG && console.log('[bujkt-social]', ...a);

  let summary = null;
  let me = null;
  let source = localStorage.getItem(SOURCE_KEY) in SOURCES ? localStorage.getItem(SOURCE_KEY) : 'drops';
  let slide = 0;
  let paused = false;
  let timer = null;

  // Results of API lookups, and when each was last fetched
  const data = { stats: null, listings: null, held: null, balance: null, ending: null, winning: null, trending: null };
  const dropStatus = new Map(); // token href -> { gone, end }
  const fetched = { mine: 0, ending: 0, drops: 0, trending: 0 };
  const keys = { ending: '', drops: '' };
  const busy = new Set();

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const amount = text => parseFloat(String(text).match(/[\d.,]+/)?.[0].replace(/,/g, '')) || 0;
  const addressOf = href => href?.match(/\b(tz[1-4]|KT1)\w{33}\b/)?.[0] || null;
  const tez = mutez => {
    const x = mutez / 1e6;
    return `${x >= 1000 ? Math.round(x).toLocaleString() : x >= 100 ? x.toFixed(0) : x.toFixed(2).replace(/\.?0+$/, '')} ꜩ`;
  };
  const tokenHref = t => `/tokens/${t.fa_contract}/${t.token_id}`;
  // objkt's image server; img onerror falls back to the other bucket, then IPFS
  const tokenImg = t => `https://assets.objkt.media/file/assets-003/${t.fa_contract}/${t.token_id}/thumb288`;
  const ipfs = uri => uri?.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${uri.slice(7)}` : '';
  const imgTag = (src, fallback) => src
    ? `<img src="${esc(src)}" alt="" loading="lazy" data-psr-img${fallback ? ` data-psr-ipfs="${esc(fallback)}"` : ''}>` : '';
  const thumb = (src, fallback) => `<span class="psr-rc-thumb">${imgTag(src, fallback)}</span>`;
  const artistName = t => t?.creators?.[0]?.holder?.alias || short(t?.creators?.[0]?.holder?.address);
  const short = a => a ? `${a.slice(0, 5)}…${a.slice(-4)}` : '';

  function countdown(end) {
    const ms = Date.parse(end) - Date.now();
    if (!(ms > 0)) return 'Ended';
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
    return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  }
  const timeLeft = end => `<span class="psr-rc-left${Date.parse(end) - Date.now() < 3600e3 ? ' psr-soon' : ''}" data-psr-end="${esc(end)}">${countdown(end)}</span>`;

  // --- API ----------------------------------------------------------------------

  async function gql(query) {
    const res = await chrome.runtime.sendMessage({ type: 'objkt-gql', query });
    if (!res?.data) throw res?.errors || new Error('No data');
    return res.data;
  }

  // Each lookup runs on its own, so one failing doesn't block the others
  async function run(name, fn) {
    if (busy.has(name)) return;
    busy.add(name);
    try {
      await fn();
    } catch (e) {
      log(`${name} lookup failed`, e);
    } finally {
      busy.delete(name);
    }
    render(true);
  }

  function findMe() {
    const fromHeader = [...document.querySelectorAll('o-header a[href^="/users/"]')]
      .map(a => addressOf(a.getAttribute('href'))).find(Boolean);
    if (summary?.me || fromHeader) return summary?.me || fromHeader;
    // Wallet connection libraries keep the active account in storage
    for (const k of Object.keys(localStorage)) {
      if (!/beacon|wallet|account|taquito/i.test(k)) continue;
      const a = localStorage.getItem(k)?.match(/"address"\s*:\s*"((?:tz[1-4])\w{33})"/)?.[1];
      if (a) return a;
    }
    return addressOf(localStorage.getItem(ME_KEY));
  }

  function loadMine() {
    const since30 = new Date(Date.now() - 30 * DAY_MS).toISOString();
    const m = JSON.stringify(me);
    run('sales', async () => {
      const d = await gql(`query {
        ls: listing_sale(where: {seller_address: {_eq: ${m}}, timestamp: {_gte: "${since30}"}}, limit: 500) { price_xtz amount timestamp }
        ds: dutch_auction_sale(where: {seller_address: {_eq: ${m}}, timestamp: {_gte: "${since30}"}}, limit: 500) { price_xtz amount timestamp }
        oa: offer(where: {seller_address: {_eq: ${m}}, status: {_eq: "concluded"}, update_timestamp: {_gte: "${since30}"}}, limit: 500) { price_xtz update_timestamp }
        ea: english_auction(where: {seller_address: {_eq: ${m}}, status: {_eq: "concluded"}, end_time: {_gte: "${since30}"}, highest_bidder_address: {_is_null: false}}, limit: 500) { highest_bid_xtz end_time }
      }`);
      const sales = [
        ...d.ls.map(s => ({ xtz: s.price_xtz * (s.amount || 1), n: s.amount || 1, t: s.timestamp })),
        ...d.ds.map(s => ({ xtz: s.price_xtz * (s.amount || 1), n: s.amount || 1, t: s.timestamp })),
        ...d.oa.map(s => ({ xtz: s.price_xtz, n: 1, t: s.update_timestamp })),
        ...d.ea.map(s => ({ xtz: s.highest_bid_xtz, n: 1, t: s.end_time })),
      ];
      const since7 = Date.now() - 7 * DAY_MS;
      const sum = list => ({ xtz: list.reduce((a, s) => a + (s.xtz || 0), 0), n: list.reduce((a, s) => a + s.n, 0) });
      data.stats = { d7: sum(sales.filter(s => Date.parse(s.t) >= since7)), d30: sum(sales) };
    });
    run('listings', async () => {
      const d = await gql(`query {
        la: listing_active(where: {seller_address: {_eq: ${m}}}, limit: 500) { id }
        aa: english_auction_active(where: {seller_address: {_eq: ${m}}}, limit: 100) { id }
      }`);
      data.listings = { listings: d.la.length, auctions: d.aa.length };
    });
    run('collection', async () => {
      const d = await gql(`query {
        held: token_holder(where: {holder_address: {_eq: ${m}}, quantity: {_gt: 0}, token: {creators: {creator_address: {_neq: ${m}}}}},
          order_by: {last_incremented_at: desc}, limit: 60) {
          token { token_id fa_contract name display_uri lowest_ask
            creators(limit: 1) { holder { alias address } } }
        }
      }`);
      data.held = d.held.map(h => h.token).filter(Boolean);
    });
    run('balance', async () => {
      const res = await chrome.runtime.sendMessage({ type: 'tzkt-balance', address: me });
      if (typeof res !== 'number') throw res?.errors || res;
      data.balance = res;
    });
  }

  function loadEnding() {
    const now = new Date().toISOString();
    const until = new Date(Date.now() + ENDING_WINDOW_MS).toISOString();
    const artists = JSON.stringify(summary?.artists || []);
    const token = 'token { token_id fa_contract name display_uri } seller { alias address }';
    if (summary?.artists?.length) {
      run('ending', async () => {
        const d = await gql(`query {
          ea: english_auction_active(where: {seller_address: {_in: ${artists}}, end_time: {_gt: "${now}", _lt: "${until}"}},
            order_by: {end_time: asc}, limit: 8) { end_time highest_bid_xtz reserve_xtz ${token} }
          oe: open_edition_active(where: {seller_address: {_in: ${artists}}, end_time: {_gt: "${now}", _lt: "${until}"}},
            order_by: {end_time: asc}, limit: 8) { end_time price ${token} }
        }`);
        data.ending = [
          ...d.ea.map(a => ({ kind: 'auction', end: a.end_time, price: a.highest_bid_xtz || a.reserve_xtz, bid: !!a.highest_bid_xtz, token: a.token, seller: a.seller })),
          ...d.oe.map(o => ({ kind: 'edition', end: o.end_time, price: o.price, token: o.token, seller: o.seller })),
        ].filter(x => x.token).sort((a, b) => Date.parse(a.end) - Date.parse(b.end));
      });
    }
    if (me) {
      run('winning', async () => {
        const d = await gql(`query {
          w: english_auction_active(where: {highest_bidder_address: {_eq: ${JSON.stringify(me)}}}, order_by: {end_time: asc}, limit: 5) {
            end_time highest_bid_xtz ${token} }
        }`);
        data.winning = d.w.filter(a => a.token);
      });
    }
  }

  // Whether each work in New drops is still for sale, and when auctions end
  function loadDrops() {
    const works = summary?.works || [];
    const refs = works.map(w => w.href.match(/\/tokens\/(KT1\w{33})\/([^/?#]+)/)).filter(Boolean);
    if (!refs.length) return;
    const or = refs.map(([, c, id]) => `{fa_contract: {_eq: ${JSON.stringify(c)}}, token_id: {_eq: ${JSON.stringify(id)}}}`).join(', ');
    run('drops', async () => {
      const d = await gql(`query {
        t: token(where: {_or: [${or}]}) { token_id fa_contract lowest_ask
          english_auctions_active { end_time } open_edition_active { end_time } }
      }`);
      dropStatus.clear();
      d.t.forEach(t => {
        const href = tokenHref(t);
        const work = works.find(w => w.href === href);
        const auction = t.english_auctions_active?.[0];
        const edition = t.open_edition_active;
        // Only works that were for sale count as sold out; new mints may not be listed yet
        const gone = !!work && (work.auction ? !auction : !!work.price && !t.lowest_ask && !edition);
        dropStatus.set(href, { gone, end: auction?.end_time || edition?.end_time || null });
      });
    });
  }

  function loadTrending() {
    const since = new Date(Date.now() - DAY_MS).toISOString();
    run('trending', async () => {
      const d = await gql(`query {
        s: listing_sale(where: {timestamp: {_gte: "${since}"}}, order_by: {price_xtz: desc}, limit: 40) {
          price_xtz token { token_id fa_contract name display_uri creators(limit: 1) { holder { alias address } } } }
      }`);
      const seenTokens = new Set();
      data.trending = d.s.filter(s => s.token && !seenTokens.has(tokenHref(s.token)) && seenTokens.add(tokenHref(s.token))).slice(0, 12);
    });
  }

  function refresh() {
    if (document.visibilityState !== 'visible' || !document.querySelector(RAIL)) return;
    const now = Date.now();
    const found = findMe();
    if (found && found !== me) {
      me = found;
      fetched.mine = 0;
      fetched.ending = 0;
    }
    if (me && now - fetched.mine > REFRESH.mine) {
      fetched.mine = now;
      loadMine();
    }
    const endingKey = (summary?.artists || []).join() + me;
    if (now - fetched.ending > REFRESH.ending || endingKey !== keys.ending) {
      fetched.ending = now;
      keys.ending = endingKey;
      loadEnding();
    }
    const dropsKey = (summary?.works || []).map(w => w.href).join();
    if (dropsKey && (now - fetched.drops > REFRESH.drops || dropsKey !== keys.drops)) {
      fetched.drops = now;
      keys.drops = dropsKey;
      loadDrops();
    }
    if (source === 'trending' && now - fetched.trending > REFRESH.trending) {
      fetched.trending = now;
      loadTrending();
    }
  }

  // --- Sections -----------------------------------------------------------------

  // The section that holds objkt's Tezos price chart
  function tickerSection(rail) {
    return [...rail.children].find(s =>
      s.querySelector('svg[aria-label^="Tezos price"]') || /Tezos market price/.test(s.querySelector('h2')?.textContent || '')
    );
  }

  function attentionHtml() {
    if (!summary && !data.ending && !data.winning) {
      return `<section class="psr-rc"><h2 class="psr-rc-title">For you</h2>
        <p class="psr-rc-empty">Checking your notifications…</p></section>`;
    }
    const offers = (summary?.offers || []).slice()
      .sort((a, b) => (b.good - a.good) || (b.aboveSale - a.aboveSale) || (b.isNew - a.isNew) || (amount(b.price) - amount(a.price)));
    const total = offers.reduce((n, o) => n + o.count, 0);
    const fresh = offers.filter(o => o.isNew).length;
    const groups = [];

    if (offers.length) {
      groups.push(`
        <div class="psr-rc-group">
          <button type="button" class="psr-rc-head" data-psr-open="notifications" data-psr-filter="offers">
            <i class="ph ph-hand-coins"></i><span>Open offers</span><span class="psr-rc-count">${total}</span>
            ${fresh ? `<span class="psr-rc-fresh">${fresh} new</span>` : ''}
            <i class="ph ph-caret-right psr-rc-go"></i>
          </button>
          ${offers.slice(0, MAX_OFFERS).map(o => `
            <a class="psr-rc-item${o.isNew ? ' psr-new' : ''}" href="${esc(o.href)}">
              ${thumb(o.img)}
              <span class="psr-rc-text">
                <span class="psr-rc-main"><b>${esc(o.price)}</b>${
                  o.good ? '<span class="psr-rc-badge psr-good">At your price</span>'
                  : o.aboveSale ? '<span class="psr-rc-badge psr-up">Above last sale</span>' : ''}</span>
                <span class="psr-rc-sub">${esc(o.name)}</span>
                <span class="psr-rc-sub">from ${esc(o.from)} · ${esc(o.ago)}${o.count > 1 ? ` · ${o.count} offers` : ''}${
                  o.lastSale != null ? ` · last sale ${o.lastSale.toFixed(2).replace(/\.?0+$/, '')} ꜩ` : ''}</span>
              </span>
            </a>`).join('')}
        </div>`);
    }

    if (data.winning?.length) {
      groups.push(`
        <div class="psr-rc-group">
          <div class="psr-rc-head"><i class="ph ph-trophy"></i><span>You're the top bidder</span></div>
          ${data.winning.map(a => `
            <a class="psr-rc-item" href="${esc(tokenHref(a.token))}">
              ${thumb(tokenImg(a.token), ipfs(a.token.display_uri))}
              <span class="psr-rc-text">
                <span class="psr-rc-main"><b>${tez(a.highest_bid_xtz)}</b>${timeLeft(a.end_time)}</span>
                <span class="psr-rc-sub">${esc(a.token.name)}</span>
                <span class="psr-rc-sub">${esc(a.seller?.alias || short(a.seller?.address))}</span>
              </span>
            </a>`).join('')}
        </div>`);
    }

    const ending = (data.ending || []).slice(0, MAX_ENDING);
    if (ending.length) {
      groups.push(`
        <div class="psr-rc-group">
          <div class="psr-rc-head"><i class="ph ph-timer"></i><span>Ending soon</span></div>
          ${ending.map(x => `
            <a class="psr-rc-item" href="${esc(tokenHref(x.token))}">
              ${thumb(tokenImg(x.token), ipfs(x.token.display_uri))}
              <span class="psr-rc-text">
                <span class="psr-rc-main"><b>${x.price ? tez(x.price) : 'Free'}</b>${timeLeft(x.end)}</span>
                <span class="psr-rc-sub">${esc(x.token.name)}</span>
                <span class="psr-rc-sub">${x.kind === 'auction' ? (x.bid ? 'Auction · top bid' : 'Auction · no bids yet') : 'Open edition'} · ${esc(x.seller?.alias || short(x.seller?.address))}</span>
              </span>
            </a>`).join('')}
        </div>`);
    }

    const endingHrefs = new Set((data.ending || []).map(x => tokenHref(x.token)));
    const auctions = (summary?.auctions || [])
      .filter(w => !endingHrefs.has(w.href) && !dropStatus.get(w.href)?.gone).slice(0, MAX_AUCTIONS);
    if (auctions.length) {
      groups.push(`
        <div class="psr-rc-group">
          <div class="psr-rc-head"><i class="ph ph-gavel"></i><span>New auctions</span></div>
          ${auctions.map(w => {
            const end = dropStatus.get(w.href)?.end;
            return `
            <a class="psr-rc-item" href="${esc(w.href)}">
              ${thumb(w.img)}
              <span class="psr-rc-text">
                <span class="psr-rc-main"><b>${esc(w.price || 'Auction')}</b>${end ? timeLeft(end) : ''}</span>
                <span class="psr-rc-sub">${esc(w.name)}</span>
                <span class="psr-rc-sub">${esc(w.artist)} · ${esc(w.ago)}</span>
              </span>
            </a>`;
          }).join('')}
        </div>`);
    }

    const picks = curatedHtml();
    if (picks) {
      groups.push(`
        <div class="psr-rc-group psr-rc-picks">
          <div class="psr-rc-head"><i class="ph ph-sparkle"></i><span>Picked by objkt</span></div>
          ${picks}
        </div>`);
    }

    return `
      <section class="psr-rc">
        <h2 class="psr-rc-title">For you</h2>
        ${groups.join('') || '<p class="psr-rc-empty">Nothing new for you right now.</p>'}
      </section>`;
  }

  // objkt's own "Curated for you" section further down the rail. It's hidden,
  // and whatever it lists is shown inside For you instead.
  function curatedSection(rail = document.querySelector(RAIL)) {
    return rail && [...rail.children].find(s => /curated for you/i.test(s.querySelector('h2')?.textContent || ''));
  }

  function curatedHtml() {
    const section = curatedSection();
    if (!section || /no results/i.test(section.textContent) || !section.querySelector('a[href]')) return '';
    const copy = section.cloneNode(true);
    copy.querySelector('h2')?.remove();
    copy.querySelectorAll('[popover], [id]').forEach(el => el.matches('[popover]') ? el.remove() : el.removeAttribute('id'));
    copy.querySelectorAll('[style*="anchor-name"]').forEach(el => el.style.removeProperty('anchor-name'));
    return copy.innerHTML;
  }

  function curatedKey(rail) {
    const section = curatedSection(rail);
    return section ? section.textContent.length + ':' + section.querySelectorAll('a[href]').length : '';
  }

  function statsHtml() {
    if (!me) {
      return `
        <section class="psr-rc">
          <h2 class="psr-rc-title">Your stats</h2>
          <form class="psr-rc-me">
            <input name="me" placeholder="Your tz address" autocomplete="off" spellcheck="false" aria-label="Your Tezos address">
            <button type="submit">Save</button>
          </form>
          <p class="psr-rc-empty">Couldn't find your wallet on this page. Paste your address to see your stats.</p>
        </section>`;
    }
    const s = data.stats, l = data.listings, b = data.balance;
    const usd = parseFloat(document.querySelector('section.psr-ticker')?.textContent.match(/\$\s*([\d.]+)/)?.[1]);
    const cell = (label, value, sub) => `
      <div class="psr-rc-stat"><span class="psr-rc-stat-label">${label}</span>
        <span class="psr-rc-stat-value">${value ?? '–'}</span>${sub ? `<span class="psr-rc-stat-sub">${sub}</span>` : ''}</div>`;
    const sales = p => s ? cell(p === 'd7' ? 'Sales · 7d' : 'Sales · 30d', tez(s[p].xtz), `${s[p].n} sold`) : cell(p === 'd7' ? 'Sales · 7d' : 'Sales · 30d');
    return `
      <section class="psr-rc">
        <div class="psr-rc-title-row">
          <h2 class="psr-rc-title">Your stats</h2>
          <a class="psr-rc-link" href="/users/${esc(me)}">Profile</a>
        </div>
        <div class="psr-rc-stats">
          ${sales('d7')}
          ${sales('d30')}
          ${cell('Listed', l ? `${l.listings}` : null, l ? `${l.listings === 1 ? 'listing' : 'listings'}${l.auctions ? ` · ${l.auctions} auction${l.auctions > 1 ? 's' : ''}` : ''}` : '')}
          ${cell('Balance', b != null ? tez(b) : null, b != null && usd ? `≈ $${Math.round(b / 1e6 * usd).toLocaleString()}` : '')}
        </div>
      </section>`;
  }

  function slideItems() {
    if (source === 'collection') {
      return (data.held || []).slice(0, 12).map(t => ({
        href: tokenHref(t), img: tokenImg(t), fallback: ipfs(t.display_uri), name: t.name,
        meta: `${esc(artistName(t))}${t.lowest_ask ? ` · <b>${tez(t.lowest_ask)}</b>` : ''}`,
      }));
    }
    if (source === 'trending') {
      return (data.trending || []).map(s => ({
        href: tokenHref(s.token), img: tokenImg(s.token), fallback: ipfs(s.token.display_uri), name: s.token.name,
        meta: `${esc(artistName(s.token))} · sold for <b>${tez(s.price_xtz)}</b>`,
      }));
    }
    return dropOrder().map(w => {
      const end = dropStatus.get(w.href)?.end;
      return {
        href: w.href, img: w.img, name: w.name,
        meta: `${esc(w.artist)}${w.price ? ` · <b>${w.auction ? 'Auction · ' : ''}${esc(w.price)}</b>` : ''}${end ? ` · ${timeLeft(end)}` : ''}`,
      };
    });
  }

  // New drops in random order, at most a couple per artist. The order is kept
  // until the set of works changes, so slides don't jump around on redraws.
  let dropCache = { key: '', list: [] };
  function dropOrder() {
    const works = (summary?.works || []).filter(w => !dropStatus.get(w.href)?.gone);
    const key = works.map(w => w.href).join();
    if (key === dropCache.key) return dropCache.list;
    const shuffled = works.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const perArtist = new Map();
    const list = shuffled.filter(w => {
      const n = perArtist.get(w.artistHref || w.artist) || 0;
      if (n >= MAX_PER_ARTIST) return false;
      perArtist.set(w.artistHref || w.artist, n + 1);
      return true;
    }).slice(0, MAX_SLIDES);
    dropCache = { key, list };
    return list;
  }

  function slidesHtml() {
    const items = slideItems();
    if (items.length) slide %= items.length;
    const loading = source === 'drops' ? !summary : source === 'collection' ? !data.held : !data.trending;
    const empty = !me && source === 'collection' ? 'Add your address above to see your collection.'
      : loading ? 'Loading…' : source === 'drops' ? 'No new drops in your notifications.' : 'Nothing to show yet.';
    return `
      <section class="psr-rc psr-rc-slides">
        <div class="psr-rc-tabs" role="tablist">
          ${Object.entries(SOURCES).map(([k, label]) => `
            <button type="button" role="tab" aria-selected="${k === source}" data-psr-source="${k}">${label.replace(' today', '')}</button>`).join('')}
        </div>
        ${items.length ? `
          <div class="psr-rc-stage">
            ${items.map((w, i) => `
              <a class="psr-rc-slide${i === slide ? ' psr-on' : ''}" href="${esc(w.href)}" title="${esc(w.name)}">
                <span class="psr-rc-slide-img">${imgTag(w.img, w.fallback)}</span>
                <span class="psr-rc-slide-name">${esc(w.name)}</span>
                <span class="psr-rc-slide-meta">${w.meta}</span>
              </a>`).join('')}
          </div>
          <div class="psr-rc-nav">
            <button type="button" data-psr-slide="-1" aria-label="Previous"><i class="ph ph-caret-left"></i></button>
            <span class="psr-rc-pos">${slide + 1} / ${items.length}</span>
            <button type="button" data-psr-slide="1" aria-label="Next"><i class="ph ph-caret-right"></i></button>
          </div>` : `<p class="psr-rc-empty">${empty}</p>`}
      </section>`;
  }

  // objkt's price box, shown as one line: "$0.214 · 1 XTZ = 1 XTZ"
  function updateTicker(ticker) {
    const price = ticker.querySelector('.text-xl')?.textContent.trim();
    if (!price) return;
    let line = ticker.querySelector(':scope > .psr-tick');
    if (!line) {
      line = document.createElement('div');
      line.className = 'psr-tick';
      ticker.prepend(line);
    }
    const html = `${esc(price)} <span>· 1 XTZ = 1 XTZ</span>`;
    if (line.innerHTML !== html) line.innerHTML = html;
  }

  // --- Rendering ----------------------------------------------------------------

  function showSlide(n) {
    const cards = document.getElementById(CARDS_ID);
    const slides = cards?.querySelectorAll('.psr-rc-slide');
    if (!slides?.length) return;
    slide = (n + slides.length) % slides.length;
    slides.forEach((s, i) => s.classList.toggle('psr-on', i === slide));
    const pos = cards.querySelector('.psr-rc-pos');
    if (pos) pos.textContent = `${slide + 1} / ${slides.length}`;
  }

  function render(force) {
    const rail = document.querySelector(RAIL);
    if (!rail || location.pathname !== '/social') return;
    const ticker = tickerSection(rail);
    ticker?.classList.add('psr-ticker');
    if (ticker) updateTicker(ticker);

    let cards = document.getElementById(CARDS_ID);
    const anchor = ticker || rail.firstElementChild;
    if (!cards || cards.parentElement !== rail) {
      cards?.remove();
      cards = document.createElement('div');
      cards.id = CARDS_ID;
      cards.addEventListener('click', onClick);
      cards.addEventListener('submit', onSubmit);
      cards.addEventListener('mouseenter', () => (paused = true));
      cards.addEventListener('mouseleave', () => (paused = false));
      force = true;
      // A rebuilt rail: ask the panel for its latest summary
      document.querySelector('iframe[name="psr-notifications"]')
        ?.contentWindow.postMessage({ psrRailRequest: true }, location.origin);
    }
    if (anchor && anchor.nextElementSibling !== cards) anchor.after(cards);
    // objkt's curated picks live inside For you; redraw when they change
    curatedSection(rail)?.classList.add('psr-curated');
    const key = curatedKey(rail);
    if (key !== cards.dataset.curated) {
      cards.dataset.curated = key;
      force = true;
    }
    // Don't redraw under a half-typed address
    if (force && !cards.querySelector('input:focus')) {
      cards.innerHTML = statsHtml() + attentionHtml() + slidesHtml();
    }
  }

  function onClick(e) {
    const step = e.target.closest('[data-psr-slide]');
    if (step) {
      showSlide(slide + +step.dataset.psrSlide);
      return;
    }
    const tab = e.target.closest('[data-psr-source]');
    if (tab) {
      source = tab.dataset.psrSource;
      localStorage.setItem(SOURCE_KEY, source);
      slide = 0;
      refresh();
      render(true);
      return;
    }
    const open = e.target.closest('[data-psr-open]');
    if (open) {
      window.postMessage({ psrView: open.dataset.psrOpen, psrFilter: open.dataset.psrFilter || null }, location.origin);
      return;
    }
    // Open pages inside the app, without reloading
    const a = e.target.closest('a[href]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
    e.preventDefault();
    window.postMessage({ psrNavigate: a.getAttribute('href') }, location.origin);
  }

  function onSubmit(e) {
    if (!e.target.matches('.psr-rc-me')) return;
    e.preventDefault();
    const address = addressOf(e.target.elements.me.value.trim());
    if (!address) {
      e.target.elements.me.setCustomValidity('That doesn’t look like a Tezos address');
      e.target.reportValidity();
      return;
    }
    localStorage.setItem(ME_KEY, address);
    document.activeElement?.blur();
    refresh();
    render(true);
  }

  // Thumbnails missing from one image bucket: try the other, then IPFS
  document.addEventListener('error', e => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.hasAttribute('data-psr-img')) return;
    if (img.src.includes('/assets-003/')) img.src = img.src.replace('/assets-003/', '/assets-004/');
    else if (img.dataset.psrIpfs && img.src !== img.dataset.psrIpfs) img.src = img.dataset.psrIpfs;
  }, true);

  addEventListener('message', e => {
    if (e.origin !== location.origin || !e.data?.psrRail) return;
    summary = e.data.psrRail;
    refresh();
    render(true);
  });

  new MutationObserver(records => {
    const cards = document.getElementById(CARDS_ID);
    if (cards && records.every(r => cards.contains(r.target))) return;
    clearTimeout(timer);
    timer = setTimeout(() => render(false), 200);
  }).observe(document.body, { childList: true, subtree: true });

  // Countdowns tick every second; the slideshow moves on every few seconds
  let ticks = 0;
  setInterval(() => {
    document.querySelectorAll(`#${CARDS_ID} [data-psr-end]`).forEach(el => {
      el.textContent = countdown(el.dataset.psrEnd);
      el.classList.toggle('psr-soon', Date.parse(el.dataset.psrEnd) - Date.now() < 3600e3);
    });
    if (++ticks % (SLIDE_MS / 1000) === 0 && !paused && document.visibilityState === 'visible') showSlide(slide + 1);
    if (ticks % 30 === 0) refresh();
  }, 1000);

  refresh();
  render(true);
})();
