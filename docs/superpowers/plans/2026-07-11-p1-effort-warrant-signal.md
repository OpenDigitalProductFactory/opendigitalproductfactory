# P1 — Unified per-turn effort-warrant signal (the spine)

- **BI:** BI-DA26BF90 · **Epic:** EP-27FD96BC · **Capsule:** WC-0FD4B82F
- **Scope spec:** `docs/superpowers/specs/2026-07-11-coworker-reasoning-economy-scope.md`
- **Kernel:** DI-A30D9C7D31C5 (umbrella structure). Work-scope/altitude of this BI: pure additive wiring, no new store/table → no further kernel routing required.

## Problem (from the audit)

A coworker turn's four effort knobs are decided in four independent places off unrelated inputs:
- **model tier / thinking** ← `reasoningDepth` (`routing/task-classifier.ts` → `inferContract` → `cost-ranking`) — the *only* classified knob.
- **iterations** ← a flat constant `MAX_ITERATIONS = 200` (`agentic-loop.ts:50`), unrelated to anything.
- **duration** ← which tools got *executed* so far (`agentic-loop.ts:1415`), a runtime proxy.
- **context budget tier** ← a route-string guess (`context-arbitrator.ts:158`), decoupled from the model actually chosen.

There is no single per-turn signal these share, so a trivial turn and a complex turn can get the same 200-iteration / 120s envelope.

## Approach — one signal, minimum surface

Add one pure classifier that folds the signals already present at the turn's single choke point into a single `EffortWarrant`, and let the loop co-tune iterations + duration from it. The warrant also carries `toolBudgetTarget` and `contextTier` as **spine hooks** the later pillars (P2 tool cap, P3 tools/skills, P4 delegation) consume — this BI establishes the object; the others tune against it.

Substrate-verify-first: nothing named `warrant` exists (greenfield type); the classifiers, the loop choke point, and the duration ladder all exist and are reused, not rebuilt.

### 1. `apps/web/lib/tak/effort-warrant.ts` (new, pure)
- `EffortLevel = "minimal" | "low" | "medium" | "high"`.
- `EffortWarrant { level, reasoningDepth, maxIterations, maxDurationMs, contextTier, toolBudgetTarget, signals[] }`.
- `deriveEffortWarrant(input)` where `input = { reasoningDepth?, taskType?, availableToolNames?, messageChars? }`:
  - base level from `reasoningDepth` (reuse the existing 4-level ladder) when present, else a proxy from `taskType`/`messageChars`.
  - **heavy-tool floor:** if build/plan tools are attached, floor the level at `high` (protects genuine build turns from iteration/time starvation — the duration ladder already treats these phases as heavy).
  - emit the four co-tuned outputs from monotonic ladders (higher level ⇒ ≥ iterations, ≥ duration, ≥ tool budget, ≥ context tier). Iterations clamp at the existing `MAX_ITERATIONS` safety ceiling.

### 2. Wire at the turn top — `agent-coworker.ts`
Compute the warrant next to the existing `classifyTask` call (~:696) using the content-classifier `reasoningDepth`, the `taskType`, the attached tool names, and the message length; pass it into `executeAutonomousAgenticLoop` as a new optional `effortWarrant` param.

### 3. Consume in the loop — `agentic-loop.ts`
- Accept `effortWarrant?: EffortWarrant`.
- Loop bound: `Math.min(MAX_ITERATIONS, effortWarrant?.maxIterations ?? MAX_ITERATIONS)` — **absent warrant = today's exact behavior (200).**
- Duration: replace the `else MAX_DURATION_MS` baseline with `effortWarrant?.maxDurationMs ?? MAX_DURATION_MS`, and take `Math.max` with the tool-revealed phase limit so heavy phases still win.
- Log the warrant (`level`, `maxIterations`, `maxDurationMs`) once per turn for observability; return it in the loop result metadata. (Turn-metric column enrichment is deferred to the P2 measure→act BI to keep this PR migration-free.)

## Non-goals (owned by sibling BIs)
- Consuming `toolBudgetTarget` into the actual attachment cap → BI-2B2F59EB / BI-ACE1EBA4 (P2/P3).
- Spend-driven downgrade → BI-E8BCA547 (P2). Delegation decision → BI-8167C9CD (P4).

## Verification
- Unit: `effort-warrant.test.ts` — monotonicity across levels; heavy-tool floor; clamp at ceiling; a minimal turn yields strictly fewer iterations + shorter duration + smaller tool budget than a high turn.
- Behavioral: absent-warrant path preserves 200/tool-ladder exactly (regression guard). Live: a trivial "hi" turn logs `level=minimal` with reduced iterations; a `/build` turn logs `level=high` with 200/600s.
