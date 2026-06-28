# Claude Code — Operating Manual

## Startup Protocol

On every new session, read **only** these files before touching anything else:

1. `.claude/docs/00_PROJECT.md`
2. `.claude/docs/10_ARCHITECTURE.md`
3. `.claude/docs/20_CURRENT_STATE.md`
4. `.claude/docs/30_DECISIONS.md`
5. `.claude/docs/40_NEXT_TASK.md`
6. `.claude/docs/50_ENGINEERING_RULES.md`

Do not scan the repository until those six documents have been read.

**If implementation disagrees with documentation, the implementation wins.**
Report the mismatch before editing anything.

---

## Engineering Workflow

- Work on **one milestone phase per session**.
- Never continue into the next phase unless explicitly instructed.
- Avoid unnecessary repository-wide analysis.
- Preserve all architectural boundaries documented in `10_ARCHITECTURE.md`.
- Prefer additive interfaces over modifying frozen contracts.
- Stop as soon as the requested work is complete.

---

## Before Writing Code

Explain:

- what will change and which files are affected
- why it belongs at that layer
- architectural impact and dependency direction
- any risks or concerns

**Wait for approval before proceeding if the work would materially change the architecture.**

---

## After Writing Code

Always, in order:

1. Run the appropriate typecheck / build / tests.
2. Summarize files changed.
3. Summarize architectural impact.
4. List follow-up work and whether the next phase is unblocked.
5. Stop.

---

## Documentation Rules

`.claude/docs` is the canonical engineering memory for this project.

- Do not rewrite those files unless explicitly requested.
- Do not create duplicate documentation.
- Do not read historical docs, RFCs, or archive files unless a `.claude/docs` document explicitly points to one.

---

## Repository Rules

All engineering constraints live in `.claude/docs/50_ENGINEERING_RULES.md`.
Read them. Follow them. Do not invent new architectural patterns.

This file is an entrypoint, not a knowledge base. Keep it that way.
