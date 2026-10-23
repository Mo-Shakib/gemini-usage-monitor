# Gemini Usage Monitor

A lightweight Chrome extension that displays Gemini usage limits and live reset countdowns directly above the prompt.

See your **current usage** and **weekly limit** without leaving Gemini’s start page. The card blends with Gemini’s theme and follows the input box’s width, surface color, and typography.

Built with vanilla JavaScript and Chrome Manifest V3. No dependencies, build tools, backend, or API keys required.

## Features

- **Usage at a glance:** current and weekly percentages with progress bars.
- **Live reset countdowns:** time remaining for each usage window, updated every second.
- **Native appearance:** light and dark theme support, rounded corners, and responsive spacing.
- **Matching width:** follows the Gemini input box as it resizes.
- **Automatic refresh:** checks usage every five minutes while the welcome page is visible.
- **Manual refresh:** a small refresh button with a shared cooldown.
- **Local cache:** keeps the last successful values available when a refresh fails.
- **SPA support:** handles navigation and DOM replacements without duplicate cards.
- **Minimal permissions:** uses only the `storage` API permission and a content script scoped to Gemini.

## Installation

### Download

1. [Download the repository ZIP](https://github.com/Mo-Shakib/gemini-usage-monitor/archive/HEAD.zip) and extract it.
2. Open `chrome://extensions` in the browser profile you use for Gemini. In Brave, use `brave://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the extracted folder containing `manifest.json`.
5. Reload Gemini and open the [Gemini start page](https://gemini.google.com/app) while signed in.

### Clone

Alternatively, clone the repository and load the resulting folder using the steps above:

```sh
git clone https://github.com/Mo-Shakib/gemini-usage-monitor.git
cd gemini-usage-monitor
```

The extension uses your existing Gemini browser session. There is no separate sign-in or setup.

## Usage

The usage card appears below the welcome heading and above the prompt on Gemini’s start page.

- **Current usage** and **Weekly limit** show the percentage used in each window.
- The countdown below each progress bar shows the time remaining until its reset.
- Click **↻** to refresh manually, or **Usage** to open Gemini’s usage page.

The card stays hidden inside conversations. Automatic network refreshes pause while the tab is hidden or the welcome page is inactive. Returning to the start page checks whether the saved values need refreshing.

After updating the extension files, reload the extension on the extensions page, then reload Gemini.

## How it works

The content script requests [Gemini’s usage page](https://gemini.google.com/usage) with the existing same-origin browser session. It reads the page’s structured Relay JSON rather than scraping the displayed percentages or guessing an API endpoint.

The verified usage fields are:

```text
data.viewer.rpcs.getUsageInfo.pools[]
  poolType: GXU_FIVE_HOURLY | GXU_WEEKLY
  percentageUsed: fraction between 0 and 1
  gxu.windowRefreshesAt: ISO reset timestamp
```

Percentages are rounded for display; progress bars retain the underlying precision. Reset timestamps drive the live countdowns. When a countdown expires, the card displays **Reset due · awaiting update** until fresh data arrives.

A background service worker coordinates refreshes across tabs and caches normalized usage data. Requests time out after 20 seconds. Manual refreshes have a 15-second shared cooldown, and failures impose a minimum one-minute cooldown.

<details>
<summary>Data-source investigation</summary>

The authenticated usage page was inspected on 23 October 2026. Its DOM contained a `script[type="application/json"][data-bg3-relay-preload]` with an `events` array. A `usage:0` event contained a JSON-encoded GraphQL payload in its `chunk` field.

The observed weekly fraction, `0.226871`, matched the page’s displayed **23%**. Both usage pools included exact reset timestamps.

Public JavaScript assets referenced by that page confirmed the use of a persisted Relay query:

- [Usage route module](https://www.gstatic.com/bg3/boq-bard-web/islands/assets/usage-805wZsY0.js)
- [Usage query metadata](https://www.gstatic.com/bg3/boq-bard-web/islands/assets/UsagePageLoading-C8J7KGbN.js)
- [Relay transport implementation](https://www.gstatic.com/bg3/boq-bard-web/islands/assets/environment-Qgbwz7FM.js)

The private GraphQL transport derives its endpoint from bootstrap configuration. The extension instead retrieves the known usage page and extracts its structured preload, avoiding hardcoded query signatures and token handling.

These assets and data formats are internal Google implementation details and may change. The parser requires the structured preload to be present in the fetched response; it reports an unavailable state if the expected data is missing.

</details>

## Privacy and permissions

- **No analytics or external backend.** The extension’s requests go only to Gemini’s usage page.
- **No token handling.** It does not read, expose, or persist authentication tokens or cookies. The browser attaches the existing session cookies to the request.
- **No prompt or chat collection.** It uses the prompt element only as a layout anchor; it does not read your prompt text or conversation history.
- **Local storage only.** Cached values include percentages, reset timestamps, fetch time, and an opaque account key. They are never synced through Chrome storage.
- **Separate account caches.** The account link’s label and account selector are hashed locally to partition cached data. The original label is not saved or sent to the background worker. If the account link is unavailable, a random page-scoped partition is used.
- **Limited cache retention.** Up to eight account caches are retained; cached values older than a day are ignored. Raw page responses are never persisted or logged.

The manifest requests only `storage`. Its content script runs on `https://gemini.google.com/*` to support SPA navigation. It does not request `cookies`, `tabs`, `scripting`, `webRequest`, or debugger permissions.

For the browser behavior behind these requests, see Chrome’s [content-script network request documentation](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).

## Development

The extension runs directly from source:

```text
manifest.json          Extension registration and permissions
content.js             Usage parsing, layout, countdowns, and scheduling
background.js          Cache validation and shared refresh leases
styles.css             Scoped card styling
tests/usage.test.cjs   Parser, countdown, cache, and lease tests
tests/preview.html     Browser fixture with simulated data
```

### Run checks

With Node.js installed:

```sh
node --check content.js
node --check background.js
node --test tests/usage.test.cjs
```

### Preview the interface

With Python installed:

```sh
python3 -m http.server 8765
```

Open `http://localhost:8765/tests/preview.html`. The fixture uses sample data and simulated extension messaging; it does not access your Gemini session. It changes its URL to `/app` to exercise route handling, so reopen the original fixture URL after a reload.

For an installed-extension check, compare the percentages and countdowns with Gemini’s usage page, switch themes, resize the input area, and navigate into a conversation and back to the start page.

## Troubleshooting

**The card does not appear**

Reload the extension and Gemini. Open a new chat: the card requires the welcome heading and prompt input to be present.

**Usage is unavailable**

Open Gemini’s usage page and confirm that you are signed in and usage information is available for your account. If the page works but the extension cannot retrieve data, Google may have changed the structured preload format.

**The card shows saved usage**

The latest refresh failed. Cached values remain visible, and the extension will retry automatically. You can also refresh manually once the cooldown ends.

**The countdown has reached zero**

Wait for the next successful refresh. The extension does not assume usage has reset until Gemini reports fresh values.

## Contributing

Bug reports and focused pull requests are welcome at [Mo-Shakib/gemini-usage-monitor](https://github.com/Mo-Shakib/gemini-usage-monitor). When reporting a parsing issue, include the visible error and browser version. Do not share cookies, tokens, account details, or unredacted network captures.

---

An independent project, unaffiliated with Google. Gemini is a trademark of Google LLC.
