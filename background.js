// Runs public API requests for the content scripts, so they aren't subject to
// the page's cross-origin rules: objkt's GraphQL API, and TzKT for the wallet
// balance (objkt's API doesn't have balances).

const API = 'https://data.objkt.com/v3/graphql';
const TZKT = 'https://api.tzkt.io/v1';

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  let request;
  if (msg?.type === 'objkt-gql') {
    request = fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: msg.query }),
    });
  } else if (msg?.type === 'tzkt-balance' && /^(tz[1-4]|KT1)\w{33}$/.test(msg.address || '')) {
    request = fetch(`${TZKT}/accounts/${msg.address}/balance`);
  } else {
    return;
  }
  request
    .then(r => r.json())
    .then(reply, e => reply({ errors: [{ message: String(e) }] }));
  return true; // reply asynchronously
});
