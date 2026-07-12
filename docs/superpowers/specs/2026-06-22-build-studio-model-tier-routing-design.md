# Build Studio — Capability-Matched Model-Tier Routing & Parallel Track

> **⚠️ SUPERSEDED / FOLDED (2026-07-12).** Model-tier routing shipped and is authoritative in code as
> `getModelTier` (`apps/web/lib/explore/build-process-matrix.ts`), gated by
> `DPF_BUILD_MODEL_TIER_ROUTING`. Its *policy* is now owned by
> [`2026-06-23-quality-first-risk-aware-build-rightsizing-design.md`](2026-06-23-quality-first-risk-aware-build-rightsizing-design.md)
> (robust everywhere except the trivial small doc/chore tail; high sensitivity ⇒ frontier floor).
> Keep this spec for the capability-matching *rationale* (local-30B context/VRAM limits observed
> 2026-06-21/22); for current routing policy follow the quality-first spec and the code. Narrative map:
> [`2026-07-12-dpf-development-model-and-frontier-harness-positioning-design.md`](2026-07-12-dpf-development-model-and-frontier-harness-positioning-design.md) §11.

- **Status:** Design
- **Date:** 2026-06-22
- **Author:** Platform coworker (operator-directed)
- **Epic:** EP-MODEL-TIER-ROUTING
- **Composes with:** `docs/superpowers/specs/2026-05-30-build-studio-right-sizing-design.md`,
  `docs/superpowers/specs/2026-05-24-build-studio-design-time-decomposition-design.md`

## 1. Problem

The fully-local 30B coder (qwen3-coder via opencode) cannot drive the full autonomous Build
Studio pipeline for non-trivial work, observed live 2026-06-21/22:

- Its quick (~5.5s) ideate design **fails the design-review gate** on non-trivial items
  (e.g. FB-6ABEFC49: review=fail, `decompose-recommended`, then watchdog-stalled in ideate).
- Its codegen **overflows the 32,768-token context** on medium/large tasks (observed 35,106 >
  32,768). The 4090 (24 GB) is VRAM-capped at 32,768 for a 30B model, so the window cannot be
  raised. The overflow is opencode's own agentic file-read accumulation — **not** the DPF context
  safeguards, which are capped tiny (PROJECT CONTEXT ≤ 3000 chars, prior results ≤ 2000 chars).
- Net: only **small/trivial** builds complete; medium/large stall (review-fail / decompose) or
  overflow.

Downgrading to a smaller model trades capability for context and worsens results. The correct
answer is to **match model capability to task complexity** — keep local where it is capable and
free, route complex work to a more robust tier — and run the two **in parallel**.

## 2. Decision (WWMD)

`principle_decide` (in_platform_coworker, surface `build-studio-model-tier-routing`, 2026-06-22):

- **Recommendation: `configurable-tier`** — composite **0.915**, margin **0.356**, confidence
  **high**; top contributors **Architecture Over Shortcuts** (+0.30), **Never Assume — Verify**
  (+0.27); **no commandment conflict**; structured coverage strong.
- Runners-up: `cloud-hardcoded` (0.558), `bigger-local-only` (0.555) — both well behind.

**Ruling:** the robust-tier endpoint is **operator-configurable**. The default stays **local-only**
(fully sovereign, zero behavior change). An operator opts into a robust endpoint that is **either**
cloud (Claude/Codex — adapters already exist in `BuildStudioDispatchConfig`, currently disabled)
**or** a larger local model. The routing logic is **endpoint-agnostic**; only the configured robust
endpoint differs. This preserves the fully-local-by-choice default while adding optionality.

## 3. Design

### 3.1 The hook already exists — the right-sizing matrix

`apps/web/lib/explore/build-process-matrix.ts` already maps `[workType][effortSize] →
LifecyclePolicy` (phases, gate strictness, review intensity) and is live at the phase gate. Add one
field per cell:

```ts
type LifecyclePolicy = { /* …existing… */ modelTier: "local" | "robust" };
```

- `(chore|doc|fix, small)`, `(feature, small)` → **local**
- `(feature, large)`, any `xlarge`, any `decompose-*` cell → **robust**
- `(feature, medium)` (the default cell) → **configurable threshold** (operator sets where the
  local→robust flip lands; default keeps medium on local to preserve today's behavior).

This makes the existing, tested matrix the single source of truth for "which model tier does this
build deserve?" — symmetric with how it already decides "how much ceremony?".

### 3.2 Tier-aware dispatch

`BuildStudioDispatchConfig` (`provider: claude|codex|grok|opencode|agentic` + opencode model) is
**global** today. Make resolution **per-build**:

- `getBuildStudioConfig(build)` reads `getProcessPolicy(kind, size).modelTier`.
- `modelTier="local"` → the local engine (opencode/qwen3-coder).
- `modelTier="robust"` → the **configured robust endpoint** (cloud Claude/Codex via the existing
  adapters, OR a configured larger-local provider). Resolved from the `modelProvider` table /
  Providers & Routing — the same substrate that already powers ideate/plan/review routing.

Both dispatch paths already exist: `opencode-dispatch` (local) and `runAgenticLoop` (robust). No new
dispatch machinery — only tier-aware selection.

### 3.3 Parallel track (the operator's core ask)

For a **robust-tier large BI**:

1. The **robust model leads** — ideate/design/plan, then **decomposes** the BI into sub-tasks (the
   `propose_decomposition` + decompose-gate substrate already exists).
2. Each sub-task is **sized**, then **routed by its own tier**: small/mechanical → **local**;
   complex → **robust**.
3. **Local and robust run concurrently** — local uses the GPU, robust uses its API; the existing
   `#2117` GPU-serialize only serializes *local-vs-local*, so a robust task and a local task do not
   contend. Wall-clock drops to the longest single chain, and cloud cycles are spent only on the
   hard sub-tasks.

This is the "large model hands small tasks to the local model, in parallel" pattern — cost-optimal
in both **time** (parallelism) and **spend** (local for the cheap parts).

## 4. Phased plan

- **P1 (keystone):** `modelTier` on the matrix + tier-aware **whole-build** dispatch + the
  configurable robust-endpoint resolver (default local-only). Immediately unblocks the large-item
  stalls by routing them to a capable tier. Pure routing — no parallelism yet.
- **P2:** decomposition hands **sized sub-tasks** to per-tier engines, running local + robust in
  parallel via the task DAG.
- **P3 (ops/UX):** operator surface to configure the robust endpoint and view per-build tier;
  `/platform/ai/runtime-health` surfaces the tier routing + a per-build "ran on: local/robust" chip.

## 5. Substrate grounding (verify-first)

| Need | Exists | File |
|---|---|---|
| size → policy | ✅ | `build-process-matrix.ts` (`getProcessPolicy`, `deriveBuildProcessSize`) |
| provider routing | ✅ (global) | `build-studio-config.ts` (`BuildStudioDispatchConfig`) |
| local + robust dispatch paths | ✅ | `opencode-dispatch.ts`, `runAgenticLoop` (build-pipeline.ts) |
| decomposition | ✅ | `propose_decomposition`, `POLICY_*_DECOMPOSE` cells |
| task DAG / parallel dispatch | ✅ | `task-dependency-graph.ts`, build-orchestrator |
| configurable endpoints | ✅ | `modelProvider` table / Providers & Routing |

**New surface is minimal:** one matrix field + per-build config resolution (P1); per-tier sub-task
dispatch in the orchestrator (P2).

## 6. Non-goals

- Not changing the phase graph or the gate requirements (the matrix already varies those by size).
- Not breaking the fully-local default — the robust tier is **opt-in**, default local-only.
- Not removing the DPF context safeguards (code graph etc.) — they are *helping*; they are not the
  overflow cause.
