# Gemini Usage Monitor

A dependency-free Chrome Manifest V3 extension that adds a compact usage card below Gemini’s welcome heading and above the prompt. Includes current and weekly progress, second-by-second reset countdowns, automatic refresh, and manual refresh. The card follows the input box’s width, surface color, and font, and resizes with the composer.

## Install

1. Open `chrome://extensions` in the browser profile where you use Gemini (or `brave://extensions` in Brave).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder, `/Users/shakib/Projects/gemini-usage`.
4. Reload an existing Gemini tab, then open https://gemini.google.com/app while signed in.
5. The card appears on the welcome screen. Its **Usage** link opens the account’s usage page; **↻** refreshes the card.

After changing files, click the extension’s reload button and reload Gemini. No package installation, build, API key, or backend is required.

## Data-source investigation

Inspected the authenticated `/usage` page on 23 October 2026. Its DOM includes a `script[type="application/json"][data-bg3-relay-preload]` with this structured envelope:

```text
events[]
  id: "usage:0"
  kind: "chunk"
  chunk: JSON-encoded array of GraphQL payloads
    data.viewer.rpcs.getUsageInfo.pools[]
      poolType: GXU_FIVE_HOURLY | GXU_WEEKLY
      percentageUsed: number from 0 to 1
      gxu.windowRefreshesAt: ISO timestamp
```

The observed weekly fraction was `0.226871`, matching the page’s displayed **23%**; the current fraction was `0`. The JSON supplies exact reset instants rather than ambiguous labels such as “2:17”. Displayed percentages are rounded; bars retain precision. No account credentials or complete page captures are stored in this repository.

Inspected public JavaScript assets referenced by that page:

- [Usage route module](https://www.gstatic.com/bg3/boq-bard-web/islands/assets/usage-805wZsY0.js) loads a persisted `UsagePageQuery` through Relay.
- [Usage query module](https://www.gstatic.com/bg3/boq-bard-web/islands/assets/UsagePageLoading-C8J7KGbN.js) defines the query metadata.
- [Relay transport](https://www.gstatic.com/bg3/boq-bard-web/islands/assets/environment-Qgbwz7FM.js) builds a private GraphQL `executeQuery` URL from bootstrap configuration and uses `query_signature` and serialized variables for GET queries. Its POST path also handles XSRF tokens.

These are observed internal implementation details, not stable public API contracts. The extension therefore requests the known `/usage` page using the existing same-origin session and extracts **only its structured Relay JSON**. It does not scrape visible text, execute scripts, guess an RPC endpoint, or read token-bearing bootstrap globals. This uses the structured query result while avoiding a hardcoded persisted query signature and private transport configuration.

**Verification boundary:** the authenticated page’s structured preload and welcome-page anchors were inspected directly. A raw authenticated `/usage` response and a fully installed extension were not tested end to end in this environment. The implementation expects the observed preload to be included in the fetched response; if it is absent, the card explicitly shows an unavailable state. It never substitutes fabricated percentages. Gemini variants that only populate this data after JavaScript execution need a separately verified adapter.

## Behavior and privacy

- Requests `/usage` at most once per five minutes during normal use, while a welcome tab is visible. Hidden tabs and conversation pages pause network activity; returning to the welcome screen checks freshness.
- A service-worker lease coordinates tabs for the same account. Requests time out after 20 seconds; leases expire after 25 seconds. Manual requests have a 15-second shared cooldown; failures have a one-minute minimum cooldown and normally retry after five minutes.
- Retains the latest successful data locally. Failed refreshes leave saved values visible and label them as saved. A passed reset reads “Reset due · awaiting update”; the extension never assumes usage has fallen to zero.
- Cache keys hash the account link’s label and account selector locally, so recognized accounts remain separate. The original label is never sent to the worker or saved. If that link cannot be identified, a random page-scoped partition prevents reuse of another page’s cache. This can reduce cache sharing until the native account link appears.
- Stores only an opaque key, usage percentages, reset timestamps, and fetch time; up to eight recent account caches. Values older than a day are ignored. Chrome’s local extension storage is used, never sync storage.
- Does not read cookies, authentication tokens, prompt text, or chat history. Browser-managed cookies accompany the same-origin fetch without being accessible to this code. Raw HTML is transient and never logged, messaged, or cached.
- Only the `storage` API permission is needed. The content script is restricted to `https://gemini.google.com/*` so it can handle SPA transitions from other Gemini routes. No `cookies`, `tabs`, `scripting`, `webRequest`, debugger, broad host permissions, or external services.
- Uses Gemini theme classes and available color tokens, local font fallbacks, and an inline document-flow card. MutationObserver restores the card after SPA DOM replacements, with one instance. It deliberately stays hidden when the welcome heading or prompt anchor cannot be found.

Chrome documents the content script’s same-origin request behavior in [Cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).

## Files

- `manifest.json`: MV3 registration and permissions.
- `content.js`: authenticated request, structured parsing, placement, theme, countdowns, and refresh scheduling.
- `background.js`: validated cache and shared refresh leases.
- `styles.css`: scoped responsive card styling.
- `tests/usage.test.cjs`: dependency-free parser, countdown, cache, and lease tests.
- `tests/preview.html`: browser fixture with explicitly simulated data and extension messaging. Never used by the extension itself.

## Checks

With Node.js installed, run:

```sh
node --check content.js
node --check background.js
node --test tests/usage.test.cjs
```

For a visual fixture, serve this folder with `python3 -m http.server 8765` and visit `http://localhost:8765/tests/preview.html`. Reopen that fixture URL after reloading: it changes its path to `/app` to exercise route handling. Fixture checks covered progress values, single mounting after repeated mutations, conversation navigation away/back without an extra request, light/dark switching, retained cache on network failure, and a 390px layout without horizontal overflow.

After installing, verify both percentages and reset countdowns against `/usage`, click refresh, switch Gemini themes, open a conversation and return to a new chat. If the card says unavailable, open the Usage link to check sign-in and feature availability. If the page itself works, Google may have changed its preload schema; update the adapter from newly observed evidence rather than guessing endpoints. Remove the extension to clear its local storage.
