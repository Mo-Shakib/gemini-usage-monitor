const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalize, parsePreloads, countdown } = require('../content.js');
const { sanitizeUsage, handle } = require('../background.js');
const info = { pools: [
  { poolType: 'GXU_WEEKLY', percentageUsed: 0.226871, gxu: { windowRefreshesAt: '2026-10-27T13:17:24.475816Z' } },
  { poolType: 'GXU_FIVE_HOURLY', percentageUsed: 0, gxu: { windowRefreshesAt: '2026-10-23T20:17:24.475687Z' } }
] };
const envelope = JSON.stringify({ events: [{ id: 'usage:0', kind: 'chunk', chunk: JSON.stringify([{ data: { viewer: { rpcs: { getUsageInfo: info } } } }]) }] });
test('verified Relay shape preserves fractions and exact reset timestamps', () => {
  const result = parsePreloads(['invalid', envelope]);
  assert.equal(result.current.percent, 0);
  assert.equal(Math.round(result.weekly.percent), 23);
  assert.equal(result.weekly.resetAt, '2026-10-27T13:17:24.475Z');
});
test('reject missing pools, invalid dates, out-of-range and string fractions', () => {
  for (const value of [null, {}, { pools: [] }]) assert.throws(() => normalize(value));
  for (const fraction of [-1, 1.1, '0.23', NaN]) {
    const bad = structuredClone(info); bad.pools[0].percentageUsed = fraction;
    assert.throws(() => normalize(bad));
  }
  const bad = structuredClone(info); bad.pools[0].gxu.windowRefreshesAt = 'tomorrow';
  assert.throws(() => normalize(bad));
  assert.throws(() => parsePreloads([JSON.stringify({ percentageUsed: 0.23 })]));
});
test('countdown rolls over and never claims a reset already happened', () => {
  assert.equal(countdown('2026-10-24T00:00:00Z', Date.parse('2026-10-23T00:00:00Z')), '1d 0h 00m 00s');
  assert.equal(countdown('2026-10-23T00:00:01Z', Date.parse('2026-10-23T00:00:00Z')), '0h 00m 01s');
  assert.equal(countdown('2026-10-23T00:00:00Z', Date.parse('2026-10-23T00:00:00Z')), 'Reset due · awaiting update');
});
test('cache strips extraneous fields and rejects invalid values', () => {
  const data = normalize(info); data.token = 'must not survive'; data.current.raw = 'discard';
  assert.deepEqual(sanitizeUsage(data), normalize(info, data.fetchedAt));
  assert.equal(sanitizeUsage({ ...data, fetchedAt: Date.now() + 120000 }), null);
});
test('leases deduplicate tabs, reject spoofed saves, persist cache and throttle manual requests', async () => {
  const area = () => { const values = {}; return {
    get: async key => key === null ? { ...values } : { [key]: values[key] },
    set: async obj => Object.assign(values, obj),
    remove: async keys => keys.forEach(k => delete values[k])
  }; };
  global.chrome = { runtime: { id: 'extension' }, storage: { local: area(), session: area() } };
  const sender = { id: 'extension', url: 'https://gemini.google.com/app', tab: { id: 1 } };
  const key = 'a'.repeat(64);
  const first = await handle({ type: 'claim', key }, sender);
  assert.ok(first.ticket);
  const busy = await handle({ type: 'claim', key }, { ...sender, tab: { id: 2 } });
  assert.ok(busy.retryAt); assert.equal(busy.ticket, undefined);
  assert.equal((await handle({ type: 'save', key, ticket: first.ticket, data: normalize(info) }, { ...sender, tab: { id: 2 } })).error, true);
  assert.equal((await handle({ type: 'save', key, ticket: first.ticket, data: normalize(info) }, sender)).ok, true);
  assert.ok((await handle({ type: 'read', key }, sender)).data);
  assert.ok((await handle({ type: 'claim', force: true, key }, sender)).retryAt);
  assert.equal((await handle({ type: 'claim', key }, { ...sender, url: 'https://example.com' })).error, true);
});
