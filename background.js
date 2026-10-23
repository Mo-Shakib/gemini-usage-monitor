/* The worker sees only normalized usage numbers, dates, and an opaque account key.
 * All authenticated requests stay in the same-origin content script. */
'use strict';
const FRESH_MS = 5 * 60_000;
const LEASE_MS = 25_000;
const COOLDOWN_MS = 15_000;

function sanitizeUsage(value) {
  if (!value || !Number.isFinite(value.fetchedAt) ||
      value.fetchedAt > Date.now() + 60_000 || value.fetchedAt < Date.now() - 86400_000) return null;
  const result = { fetchedAt: value.fetchedAt };
  for (const name of ['current', 'weekly']) {
    const pool = value[name];
    if (!pool || !Number.isFinite(pool.percent) || pool.percent < 0 || pool.percent > 100 ||
        typeof pool.resetAt !== 'string' || !Number.isFinite(Date.parse(pool.resetAt))) return null;
    result[name] = { percent: pool.percent, resetAt: new Date(pool.resetAt).toISOString() };
  }
  return result;
}

async function handle(message, sender) {
  if (sender.id !== chrome.runtime.id || !sender.tab ||
      new URL(sender.url).origin !== 'https://gemini.google.com' ||
      !/^[a-f0-9]{64}$/.test(message?.key || '')) return { error: true };
  const key = 'usage:' + message.key;
  const leaseKey = 'lease:' + message.key;
  const cache = (await chrome.storage.local.get(key))[key];
  const data = sanitizeUsage(cache);
  if (message.type === 'read') return { data };
  const now = Date.now();
  const lease = (await chrome.storage.session.get(leaseKey))[leaseKey];
  if (message.type === 'claim') {
    if (!message.force && data && now - data.fetchedAt < FRESH_MS) return { data };
    if (lease && now < lease.until) return { data, retryAt: lease.until };
    const ticket = crypto.randomUUID();
    await chrome.storage.session.set({ [leaseKey]: { ticket, tab: sender.tab.id, until: now + LEASE_MS } });
    return { data, ticket };
  }
  if (!lease || lease.ticket !== message.ticket || lease.tab !== sender.tab.id || now > lease.until) {
    return { error: true };
  }
  if (message.type === 'save') {
    const clean = sanitizeUsage(message.data);
    if (!clean) return { error: true };
    await chrome.storage.local.set({ [key]: clean });
    // Keep only a small number of recent account caches, never raw responses.
    const all = await chrome.storage.local.get(null);
    const old = Object.entries(all).filter(([k]) => k.startsWith('usage:'))
      .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt).slice(8).map(([k]) => k);
    if (old.length) await chrome.storage.local.remove(old);
  } else if (message.type !== 'fail') return { error: true };
  await chrome.storage.session.set({ [leaseKey]: {
    until: now + (message.type === 'fail' ? 60_000 : COOLDOWN_MS)
  } });
  return { ok: true };
}

if (typeof chrome !== 'undefined') {
  // Serialize claims so simultaneous tabs cannot both start a request.
  let queue = Promise.resolve();
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    queue = queue.then(() => handle(message, sender)).then(reply).catch(() => reply({ error: true }));
    return true;
  });
}
if (typeof module !== 'undefined') module.exports = { sanitizeUsage, handle };
