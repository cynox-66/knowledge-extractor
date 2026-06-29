# Smoke Validation Runbook (P3)

Repeatable validation that the navigation redesign (P0–P2) keeps the pipeline
producing non-zero output on every Instagram surface. Two layers:

1. **Automated gates** (run in CI, no login) — lock the pipeline wiring so a
   future refactor cannot silently zero it out.
2. **Live smoke** (manual, logged-in) — the authoritative check against real
   Instagram, made objective by the in-extension `SmokeHarness`.

---

## 1. Automated gates

```bash
pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run depcruise && pnpm run build
```

Smoke-specific suites:

| Suite                                                                    | Proves                                                                                                                                 |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/extension/tests/smoke.test.ts`                                     | A real `<article>` flows extract → normalize → persist into storage; a carousel lands **every** slide as children (RCA-7).             |
| `apps/extension/tests/smoke-harness.test.ts`                             | `SmokeHarness` PASSes only when all three counters cross zero, FAILs with `timedOut` otherwise, and always stops the crawl it started. |
| `connectors/instagram/tests/{surface,carousel,discovery-engine}.test.ts` | Surface detection, route guard, modal detection, carousel Next, incremental + surface-specific discovery.                              |

These do **not** require an Instagram login. They cannot catch live DOM drift —
that is what the live smoke below is for.

---

## 2. Live smoke (authoritative)

Only the loaded extension on an authenticated session can prove
`persisted > 0` against real Instagram.

### Setup

1. `pnpm run build`
2. `chrome://extensions` → reload **Load unpacked** → `apps/extension/dist`
3. Log into Instagram in that Chrome profile.

### Run via the SmokeHarness

On the surface under test, open the extension's **service-worker console**
(`chrome://extensions` → the extension → _Inspect views: service worker_) and run:

```js
chrome.runtime.sendMessage({ action: 'RUN_SMOKE', data: { timeoutMs: 60000 } }, console.log);
```

The harness starts one bounded crawl, polls the metrics, stops, and replies with
a structured report:

```jsonc
{
  "surface": "grid",
  "url": "https://www.instagram.com/<you>/saved/all-posts/",
  "durationMs": 12345,
  "timedOut": false,
  "metrics": { "discovered": 24, "extracted": 24, "persisted": 24 },
  "assertions": [
    { "name": "discovered > 0", "actual": 24, "pass": true },
    { "name": "extracted > 0", "actual": 24, "pass": true },
    { "name": "persisted > 0", "actual": 24, "pass": true },
  ],
  "pass": true,
}
```

`pass: true` is the green signal. (You can also drive a crawl manually from the
popup and watch the same three counters climb.)

### Per-surface pass criteria

Run the harness on each surface; all must report `pass: true`.

| Surface           | URL                                    | Expected                                                                                                                               |
| ----------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Home feed**     | `instagram.com/`                       | Counters climb while scrolling; the tab **never** navigates into a profile (RCA-2).                                                    |
| **Saved grid**    | `instagram.com/<you>/saved/all-posts/` | `discovered/extracted/persisted > 0`; opens posts as modals, returns to the grid (RCA-1/3/4).                                          |
| **Profile grid**  | `instagram.com/<someone>/`             | Same as saved.                                                                                                                         |
| **Carousel post** | any multi-slide post in the above      | The resource for that post has **> 1** media item — confirm slides 2..N landed (RCA-7). Inspect via **Export** or the resource record. |

### If a run FAILs

Read which assertion failed:

- `discovered = 0` → discovery/selectors, or no Instagram tab was pinned.
- `discovered > 0, extracted = 0` → navigation (modal/in-place) or extraction selectors.
- `extracted > 0, persisted = 0` → persistence/storage path.

`timedOut: true` with all zeros usually means the crawl could not pin the active
Instagram tab — ensure the Instagram tab is focused when triggering.
