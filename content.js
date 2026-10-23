(() => {
  'use strict';
  const PERIOD = 300_000;
  const ID = 'gemini-usage-monitor';

  function normalize(info, now = Date.now()) {
    const result = { fetchedAt: now };
    for (const [name, type] of [['current', 'GXU_FIVE_HOURLY'], ['weekly', 'GXU_WEEKLY']]) {
      const pool = info?.pools?.find(p => p.poolType === type);
      const fraction = pool?.percentageUsed;
      const resetAt = pool?.gxu?.windowRefreshesAt;
      if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1 ||
          typeof resetAt !== 'string' || !Number.isFinite(Date.parse(resetAt))) {
        throw new Error('Usage format unavailable');
      }
      result[name] = { percent: fraction * 100, resetAt: new Date(resetAt).toISOString() };
    }
    return result;
  }

  function parsePreloads(texts) {
    // Only the verified Relay JSON envelope is accepted. Never evaluate inline JS,
    // scan bootstrap credentials, or infer percentages from arbitrary numbers.
    for (const text of texts) {
      let envelope;
      try { envelope = JSON.parse(text); } catch { continue; }
      for (const event of Array.isArray(envelope?.events) ? envelope.events : []) {
        if (!event || typeof event !== 'object') continue;
        if (!/^usage:\d+$/.test(event.id || '')) continue;
        let payloads;
        if (event.kind === 'chunk' && typeof event.chunk === 'string') {
          try { payloads = JSON.parse(event.chunk); } catch { continue; }
        } else if (event.kind === 'next') payloads = [event.payload];
        if (!Array.isArray(payloads)) continue;
        for (const payload of payloads) {
          const info = payload?.data?.viewer?.rpcs?.getUsageInfo;
          if (info) return normalize(info);
        }
      }
    }
    throw new Error('Structured usage data unavailable');
  }

  function countdown(resetAt, now = Date.now()) {
    let seconds = Math.ceil((Date.parse(resetAt) - now) / 1000);
    if (seconds <= 0) return 'Reset due · awaiting update';
    const days = Math.floor(seconds / 86400); seconds %= 86400;
    const hours = Math.floor(seconds / 3600); seconds %= 3600;
    const minutes = Math.floor(seconds / 60);
    return `${days ? days + 'd ' : ''}${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds % 60).padStart(2, '0')}s`;
  }

  if (typeof module !== 'undefined') module.exports = { normalize, parsePreloads, countdown };
  if (typeof document === 'undefined' || typeof chrome === 'undefined') return;
  if (document.getElementById(ID)) return;

  let card, data, accountKey, identity, loading = false, failed = false;
  let nextAttempt = 0, frame = 0, refreshTimer, accountEpoch = 0;
  let composer, promptElement;
  const composerObserver = new ResizeObserver(() => syncAppearance());
  const unknownIdentity = crypto.randomUUID();
  const onApp = () => /^\/(?:u\/\d+\/)?app\/?$/.test(location.pathname);
  const visible = () => document.visibilityState === 'visible';
  const send = (message) => chrome.runtime.sendMessage({ ...message, key: accountKey });

  async function account() {
    const link = document.querySelector('a[href*="accounts.google.com/SignOutOptions"]');
    const label = link?.getAttribute('aria-label') || link?.textContent?.trim();
    const index = location.pathname.match(/^\/u\/(\d+)\//)?.[1] || new URL(location.href).searchParams.get('authuser') || '0';
    const current = `${index}:${label || unknownIdentity}`;
    if (current === identity) return;
    identity = current;
    const epoch = ++accountEpoch;
    accountKey = null;
    data = null; failed = false; nextAttempt = 0;
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(current));
    if (epoch !== accountEpoch) return;
    accountKey = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
    const cached = await send({ type: 'read' });
    if (epoch === accountEpoch) { data = cached?.data; render(); }
  }

  function build() {
    const el = document.createElement('section');
    el.id = ID;
    el.setAttribute('aria-label', 'Gemini usage');
    const header = document.createElement('div'); header.className = 'gum-header';
    const title = document.createElement('a'); title.textContent = 'Usage'; title.href = usageUrl();
    const button = document.createElement('button'); button.type = 'button';
    button.className = 'gum-refresh'; button.textContent = '↻';
    button.setAttribute('aria-label', 'Refresh Gemini usage'); button.title = 'Refresh usage';
    button.addEventListener('click', () => refresh(true));
    header.append(title, button);
    const grid = document.createElement('div'); grid.className = 'gum-grid';
    for (const [name, label] of [['current', 'Current usage'], ['weekly', 'Weekly limit']]) {
      const row = document.createElement('div'); row.className = 'gum-window'; row.dataset.window = name;
      const top = document.createElement('div'); top.className = 'gum-label';
      const text = document.createElement('span'); text.textContent = label;
      const percent = document.createElement('span'); percent.className = 'gum-percent'; percent.textContent = '—';
      top.append(text, percent);
      const progress = document.createElement('progress'); progress.max = 100; progress.value = 0;
      progress.setAttribute('aria-label', label);
      const timer = document.createElement('span'); timer.className = 'gum-countdown';
      timer.setAttribute('aria-label', `${label} reset countdown`);
      row.append(top, progress, timer); grid.append(row);
    }
    const status = document.createElement('div'); status.className = 'gum-status';
    status.setAttribute('role', 'status');
    el.append(header, grid, status); return el;
  }

  function usageUrl() {
    const prefix = location.pathname.match(/^\/u\/\d+/)?.[0] || '';
    const url = new URL(prefix + '/usage', location.origin);
    const authuser = new URL(location.href).searchParams.get('authuser');
    if (authuser && /^\d+$/.test(authuser)) url.searchParams.set('authuser', authuser);
    return url.href;
  }

  function render() {
    if (!card) return;
    card.querySelector('.gum-refresh').disabled = loading || Date.now() < nextAttempt;
    card.setAttribute('aria-busy', String(loading));
    card.querySelector('.gum-grid').hidden = !data;
    const status = card.querySelector('.gum-status');
    const stale = data && Date.now() - data.fetchedAt >= PERIOD;
    status.textContent = failed ? (data ? 'Couldn’t refresh · showing saved usage' : 'Usage unavailable · open Usage to check your session') :
      loading && !data ? 'Checking usage…' : stale ? 'Saved usage · waiting to refresh' : '';
    status.hidden = !status.textContent;
    if (!data) return;
    card.title = `Last updated ${new Date(data.fetchedAt).toLocaleString()}`;
    for (const name of ['current', 'weekly']) {
      const row = card.querySelector(`[data-window="${name}"]`);
      const pool = data[name];
      row.querySelector('.gum-percent').textContent = `${Math.round(pool.percent)}%`;
      row.querySelector('progress').value = pool.percent;
    }
    tick();
  }

  function tick() {
    if (!card?.isConnected || !visible()) return;
    card.querySelector('.gum-refresh').disabled = loading || Date.now() < nextAttempt;
    if (data) for (const name of ['current', 'weekly']) {
      card.querySelector(`[data-window="${name}"] .gum-countdown`).textContent = countdown(data[name].resetAt);
    }
  }

  function schedule(ms = PERIOD) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh(), Math.max(1000, ms));
  }

  async function refresh(force = false) {
    if (loading || !card?.isConnected || !onApp() || !visible()) return;
    if (Date.now() < nextAttempt) { schedule(nextAttempt - Date.now()); return; }
    loading = true; render();
    const key = accountKey, epoch = accountEpoch;
    let ticket;
    try {
      if (!key) return;
      const claim = await send({ type: 'claim', force });
      if (claim.error) throw new Error('Cache unavailable');
      if (epoch !== accountEpoch) return;
      if (claim.data) data = claim.data;
      if (!claim.ticket) {
        nextAttempt = claim.retryAt || data?.fetchedAt + PERIOD || Date.now() + 60_000;
        schedule(nextAttempt - Date.now()); return;
      }
      ticket = claim.ticket;
      const response = await fetch(usageUrl(), {
        credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(20_000)
      });
      if (!response.ok) throw new Error('Usage request failed');
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const parsed = parsePreloads(Array.from(doc.querySelectorAll('script[type="application/json"][data-bg3-relay-preload]'), s => s.textContent));
      if (epoch !== accountEpoch) return;
      const saved = await chrome.runtime.sendMessage({ type: 'save', key, ticket, data: parsed });
      if (!saved.ok) throw new Error('Cache unavailable');
      data = parsed; failed = false; nextAttempt = Date.now() + 15_000;
      schedule(PERIOD);
    } catch {
      if (epoch !== accountEpoch) return;
      failed = true; nextAttempt = Date.now() + 60_000; schedule(PERIOD);
      if (ticket) await chrome.runtime.sendMessage({ type: 'fail', key, ticket }).catch(() => {});
    } finally {
      loading = false; render();
      if (epoch !== accountEpoch) reconcile().catch(() => {});
    }
  }

  function syncAppearance() {
    if (!card || !composer?.isConnected || !promptElement?.isConnected) return;
    const width = composer.getBoundingClientRect().width;
    if (width <= 0) return;
    card.style.setProperty('--gum-width', `${width}px`);
    card.dataset.narrow = String(width < 480);
    const inputStyle = getComputedStyle(promptElement);
    card.style.fontFamily = inputStyle.fontFamily;
    card.style.setProperty('--gum-text', inputStyle.color);
    // Use the real composer surface, including Gemini's selected light/dark theme.
    let surface = composer;
    for (let depth = 0; surface && depth < 8; depth++, surface = surface.parentElement) {
      const background = getComputedStyle(surface).backgroundColor;
      if (background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)') {
        card.style.setProperty('--gum-surface', background);
        break;
      }
    }
  }

  async function reconcile() {
    frame = 0;
    // Mount only in the welcome state, between the heading and prompt. Never put
    // a floating overlay in a conversation or guess a position when anchors change.
    const heading = document.querySelector('h1[data-test-id="message"]') ||
      Array.from(document.querySelectorAll('h1')).find(h => h.textContent.trim() === 'Where should we start?');
    const prompt = document.querySelector('[contenteditable="true"][role="textbox"], textarea');
    if (!onApp() || !heading || !prompt) {
      card?.remove(); composerObserver.disconnect(); composer = null;
      clearTimeout(refreshTimer); return;
    }
    await account();
    if (!onApp() || !heading.isConnected) return;
    if (!card) card = build();
    card.dataset.dark = String(document.body.classList.contains('dark-theme') ||
      (!document.body.classList.contains('light-theme') && matchMedia('(prefers-color-scheme: dark)').matches));
    if (heading.nextElementSibling !== card) heading.after(card);
    promptElement = prompt;
    const inputBox = prompt.closest('input-area-v2, .input-area-container, .text-input-field') || prompt.parentElement;
    if (composer !== inputBox) {
      composerObserver.disconnect(); composer = inputBox; composerObserver.observe(composer);
    }
    syncAppearance();
    render();
    if (!loading && (!data || Date.now() - data.fetchedAt >= PERIOD)) refresh();
    else if (!loading) schedule(data.fetchedAt + PERIOD - Date.now());
  }

  const observer = new MutationObserver(records => {
    if (records.every(r => card?.contains(r.target))) return;
    if (!frame) frame = requestAnimationFrame(() => reconcile().catch(() => {}));
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-label'] });
  document.addEventListener('visibilitychange', () => { if (visible()) reconcile().catch(() => {}); });
  window.addEventListener('popstate', () => reconcile().catch(() => {}));
  window.addEventListener('resize', syncAppearance);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => reconcile().catch(() => {}));
  chrome.storage.onChanged.addListener((changes, area) => {
    const update = changes['usage:' + accountKey];
    if (area === 'local' && update?.newValue) { data = update.newValue; failed = false; render(); }
  });
  setInterval(tick, 1000);
  reconcile().catch(() => {});
})();
