# P2 — Close the measure→act feedback loops (overload→trim)

- **BI:** BI-3C8220ED · **Epic:** EP-27FD96BC
- **Scope spec:** `docs/superpowers/specs/2026-07-11-coworker-reasoning-economy-scope.md`
- **Kernel:** no work-scope/altitude sub-decision — closing an existing measured-but-unacted signal with the existing trim mechanism.

## Substrate re-verification (corrects the stale audit)

The scope audit named three "dead-end" signals. Re-checking origin/main:
- `schemaDriftDetected` / `toolCallsInvalid` — **already consumed** at `apps/web/lib/gear-interface/source-adapters/adapter-run-telemetry.ts:74` (they drive the gear-interface "slip" outcome). Not dead-ends.
- `userAccepted` — the writer supports it (`adapter-telemetry-writer.ts:142`) but **no caller ever sets it**; there is no accept/retry capture path at all. Closing it is a capture-feature, not a wiring fix — out of scope for this BI.
- **Context-pressure `zone` → trim — genuinely open.** This is the loop this BI closes.

## Problem (the real open loop)

In the agentic loop (`agentic-loop.ts` ~1534): messages are compacted with `deriveCompactionCaps`, which sizes caps from the **window size only**. Pressure is then classified on the *already-compacted* result and, if still `warning`/`dumb`, only **logged** (`ctxPressure.zone !== "sharp"` → `console.log`). So a turn measured to be overloaded even *after* compaction takes no corrective action — the measurement never feeds back into the trim.

## Approach — the zone tightens the trim

Substrate-verify-first: reuse `deriveCompactionCaps` and `classifyContextPressure`; no new mechanism.

1. `context-pressure.ts` — `deriveCompactionCaps(window, floor, zone?)` scales the window-derived history budget by a zone multiplier (`sharp`/omitted 1.0, `warning` 0.6, `dumb` 0.4), **never below `floor`**. Zone omitted = byte-for-byte the prior behavior (regression guard).
2. `agentic-loop.ts` — measure pressure on the **pre-compaction** messages and pass that zone into `compactAgenticMessages` → `deriveCompactionCaps`, so an overloaded turn trims harder on the same pass. Log both `preZone` and `postZone` for observability.

## Verification
- Unit (`context-pressure.test.ts`): zone-omitted/`sharp` identical to today; caps tighten monotonically `sharp > warning > dumb`; never below floor; a floor-bound tiny window can't be tightened below the floor.
- Typecheck clean. Behavioral: a turn entering the dumb zone drops more history (fewer retained messages) than the same turn treated as sharp.

## Non-goals
- A `userAccepted` capture path + retroactive reward (needs a UI accept/retry action — separate work).
- Re-plumbing the already-wired `schemaDriftDetected` / `toolCallsInvalid` gear-interface signals.
