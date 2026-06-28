# Engineering Rules

These rules are permanent and non-negotiable. They must be strictly followed when modifying this repository.

1. **Never violate dependency direction:** Layer 0 (`types`) imports nothing. Layer 1 (`shared`) imports only Layer 0. Downward imports are strictly forbidden. Use `dependency-cruiser` to verify.
2. **Never bypass connector boundaries:** Connectors are isolated. They handle discovery, extraction, and normalization only. They do not orchestrate loops or touch storage.
3. **Never bypass MediaStore:** Always use the `IMediaStore` abstraction for binary blobs. Do not use raw OPFS APIs in orchestrators.
4. **Never bypass IStorageEngine:** All structured data persistence must route through `IStorageEngine` or `IControlStateStore` using buffered transactions.
5. **Never introduce platform-specific types into Layer 0:** The `IResource` domain model must remain source-agnostic. Keep Instagram/Reddit types confined to their respective connectors.
6. **Prefer additive interfaces:** Extend frozen interfaces additively rather than modifying existing contracts, to preserve backwards compatibility.
7. **Preserve MV3-safe execution:** Never use perpetual `setInterval` or unbounded synchronous loops in the background worker. Rely on self-scheduling `setTimeout`, `chrome.alarms` watchdogs, and persistent queue states.
8. **Justify architecture changes:** Every architectural deviation requires justification in the ADR log (`30_DECISIONS.md`).
9. **Every milestone ends with tests:** No feature is complete without accompanying unit or fixture tests verifying correctness and edge cases.
10. **Every milestone ends with documentation updates:** Update `.claude/docs` to reflect the new state of the repository before marking a milestone complete.
11. **Preserve strict separation of concerns:** Do not mix orchestration (`CrawlController`), extraction (`Connectors`), navigation (`Navigator`), storage (`IndexedDbStorageEngine`), and scheduling (`Scheduler`).
12. **Avoid unnecessary abstractions:** Do not build plugins, message buses, or generalized engines unless immediately required by the current milestone.
13. **Optimize for maintainability over cleverness:** Explicit, readable code is preferred over terse, implicit logic. Write for the next engineer.
