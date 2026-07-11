# P2 — Accuracy-cliff-aware tool cap

- **BI:** BI-2B2F59EB · **Epic:** EP-27FD96BC
- **Scope spec:** `docs/superpowers/specs/2026-07-11-coworker-reasoning-economy-scope.md`
- **Kernel:** no work-scope/altitude sub-decision — implementing the audit's named fix (bound the cap toward the ~15 cliff); no architecturally-distinct options.

## Problem (from the audit)

Two independent numbers existed and never met:
- The per-turn **attachment cap** (`deriveCoworkerToolCap`, `coworker-tool-budget.ts`) sized purely by **window fit** — a 24,576 local window fits ~38 tool schemas, so up to 38 were attached.
- The **accuracy cliff** (`LOCAL_TOOL_SELECTION_CLIFF = 15`, `context-economy-metrics.ts`) — a small local model's tool-*selection* accuracy collapses once handed more than ~15 tools. It only coloured observability zones and skipped the local fallback; **nothing fed it back into the attachment cap.**

So a small local model was routinely handed ~38 tools — well past the cliff — and picked worse, even though the window had room.

## Approach — the smaller of two ceilings

Substrate-verify-first: reuse `deriveCoworkerToolCap` and the existing `LOCAL_TOOL_SELECTION_CLIFF` constant; no new store, no new module.

`deriveCoworkerToolCap` now takes the min of two ceilings:
1. **window-fit** (unchanged) — never overflow the served window.
2. **accuracy-cliff** (new) — for a cliff-prone small local window (`< ACCURACY_CLIFF_PRONE_MAX_CONTEXT = 32_768`), bound the cap at `LOCAL_TOOL_SELECTION_CLIFF`. At/above 32k the model is capable enough to select from the full window-fit set.

Deferred tools stay authorized and loadable via `load_tools`, so this caps accuracy cost, not capability. Result: `24_576 → 15` (was 38); `32_768`+ and `null` unchanged at 48; `<16k` still floors at 12.

## Verification
- Unit (`coworker-tool-budget.test.ts`, 18/18): 24,576 caps at 15; the 32k capable line stays 48; floor and monotonicity preserved (12,12,12,15,15,15,48,48 across the window sweep); a boundary test at 31,999 vs 32,768.
- Typecheck clean.

## Relationship to siblings
- P1's `EffortWarrant.toolBudgetTarget` and P3's task-intent ranking (BI-ACE1EBA4) *rank* which tools survive the cap; this BI sets the *cap*. They compose — this is the ceiling those tune against.
