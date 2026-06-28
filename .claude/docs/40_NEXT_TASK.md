# Next Task

## Current Milestone
Beta-3 (TBD)

## Current Objective
Begin next major phase (Beta-3). The OCR enrichment pipeline (Beta-2) is now fully integrated, self-rescheduling, and durably promoting resources to the ENRICHED state.

## Why this task exists
Beta-2 is complete. We must define and implement the next stage of the data pipeline, likely involving data export, user interface enhancements, or downstream processing of `ENRICHED` resources.

## Pre-conditions (must be verified at session start)
1. **Phase 4D is complete.** The enrichment loop successfully promotes resources to the ENRICHED state and the runtime wiring is verified.

## Scope

### Phase 5A — Beta-3 Planning & Scoping
- **Definition:** Define the exact requirements for Beta-3.
- **Architecture:** Produce any required ADRs for the next phase.
- **Milestone Planning:** Break down Beta-3 into executable phases.

## Constraints
- Align with existing MV3-safe background orchestration patterns.

## Files Expected to Change
- `.claude/docs/*` (Planning documents)
- `README.md` (if applicable)

## Risks
- None currently identified for the planning phase.

## Exit Criteria
- Beta-3 design defined.
- `40_NEXT_TASK.md` updated with the first implementation phase of Beta-3.
