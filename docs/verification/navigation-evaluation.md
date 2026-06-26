# Alpha Validation — Navigation Strategy Evaluation

## Objective

The current crawler implementation uses **Option A (Modal Navigation)** as the primary strategy for Grid extraction. Before freezing this architectural decision or investing time in Option B (New Tab Navigation), we must empirically validate that Option A meets the minimum reliability and stability requirements.

If the exit criteria below are not met during real-world validation, this document will serve as the foundation for proposing Option B.

## Phase 1 — Exit Criteria for Option A

Option A will be retained as the permanent production implementation if it achieves the following during a sample run of ~50 Saved posts:

- `≥95%` extraction success rate.
- Stable scroll position preservation (the grid does not reset or jump unexpectedly).
- Minimal retry rate due to modal loading timeouts.
- No recurring DOM instability or stale references.
- No significant anti-automation issues (e.g., immediate throttling, forced logouts).

---

## Benchmark Results (Option A: Modal Navigation)

_Run these measurements during Alpha Validation using the extension's Alpha Diagnostics Dashboard. The `SessionManager` has been instrumented to track granular latency and duration metrics._

### Reliability

- **Total Discovered**: [e.g., 55]
- **Successful Extraction Count**: [e.g., 50]
- **Failed Extraction Count**: [e.g., 2]
- **Total Retry Count**: [e.g., 3]
- **Extraction Success Rate (%)**: [e.g., 96%]

### Performance (Averages)

- **Modal Open Latency**: [___ ms]
- **DOM Stabilization Time**: [___ ms]
- **Extraction Duration**: [___ ms]
- **Modal Close Duration**: [___ ms]
- **Total Crawl Duration**: [___ seconds/minutes]

### Stability Observations

- **Scroll Position Preservation**: [Stable / Unstable]
- **DOM/Selector Failures**: [Count and details of any stale references or missing elements]
- **Modal Rendering Failures**: [Count and details of timeouts waiting for `<article[role="presentation"]>`]

### Browser Behaviour

- **Memory Growth**: [Observation on heap size from Chrome Task Manager]
- **CPU Usage**: [Observation]
- **Unexpected Reloads**: [None / Occurred X times]

### Anti-Automation Risk

- **Throttling/Loading Delays**: [Did Instagram artificially delay requests?]
- **Unexpected Redirects**: [Did Instagram redirect to login or challenge pages?]

---

## Phase 2 — Decision Gate & Recommendation

### Summary of Findings

[To be populated after the benchmark run. Summarize whether Option A met the exit criteria based on the data above.]

### Final Recommendation

[ ] **RETAIN OPTION A**: The modal navigation strategy proved highly reliable, fast, and avoided anti-automation triggers.
[ ] **PROPOSE OPTION B**: The modal navigation strategy failed the exit criteria due to [Reason]. A prototype for Option B (New Tab Navigation) is recommended for immediate implementation.
