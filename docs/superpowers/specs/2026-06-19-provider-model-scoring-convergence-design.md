---
title: Provider/Model scoring convergence — one calibration source (retire the ModelProvider score loop)
authoredAt: 2026-06-19
authoredBy: claude (architecture-convergence thread)
status: design
specKind: design
backlogItem: unfiled — file under EP-ARCH-CONVERGENCE (see memory project_architecture_convergence)
relatedPrs:
  - "#2002 (BI-1B46967D) — provider-routing-rollup: roll calibrated ModelProfile scores up to the grid"
  - "#2087 — dropped the 6 truly-vestigial ModelProvider score columns + reusable schema-guard allowlist"
relatedFiles:
  - apps/web/lib/inference/provider-routing-rollup.ts
  - apps/web/lib/routing/production-feedback.ts
  - apps/web/lib/inference/ai-provider-data.ts
  - apps/web/lib/inference/ai-provider-types.ts
  - packages/db/prisma/schema.prisma (ModelProvider, ModelProfile)
---

# Provider/Model scoring convergence — one calibration source

## 1. Why (the finding)

DPF scores model capability on **two dimensions** (`reasoning`, `codegen`, `toolFidelity`,
`instructionFollowing`, `structuredOutput`, `conversational`, `contextRetention`) in **two
different tables**, maintained by **two different loops** — the canonical "one concept, N
parallel implementations" debt this architecture-convergence thread is unwinding.

This was surfaced by a compiler-oracle audit during the 2026-06-19 architecture review (see
memory `project_architecture_convergence`). The "drop ~20 dead ModelProvider columns" idea was
**wrong** — 15 of 22 are live — but the audit exposed something more important: a **likely
dead-end calibration loop**.

### 1.1 Current state (verified in code)

- **`ModelProfile` is the canonical per-model scoring source.** `provider-routing-rollup.ts`
  (BI-1B46967D / #2002) states it outright: `ModelProvider.{reasoning,codegen,toolFidelity}`
  are *"DEAD COLUMNS … frozen at the seed default (50) and **ignored by the routing pipeline**,
  which reads the per-model `ModelProfile` instead"* (`provider-routing-rollup.ts:6-13`). The
  rollup derives a provider-level `routingScores` from the strongest measured `ModelProfile`
  (`rollUpProviderModels`, `:93-145`); the Providers grid renders that, falling back to
  "not measured" rather than a misleading 50.

- **But `production-feedback.ts` still calibrates the dead `ModelProvider` columns.** When a
  task-performance dimension crosses `PROPAGATION_THRESHOLD`, it reads the per-dimension score
  off `ModelProvider` via **dynamic access** `(providerFull as Record<string, unknown>)[dim]`
  (`production-feedback.ts:113`), nudges it by the observed delta, and writes it back with
  `prisma.modelProvider.update({ data: { ...updates, profileSource: "production" } })`
  (`:119-126`). It only propagates while `profileSource === "seed"` (`:108`).

- **`ai-provider-data.ts` reads those columns into `ProviderRow`** (`:81-124`,
  `ai-provider-types.ts:82-89`), but the provider **detail page** (`(shell)/platform/ai/
  providers/[providerId]/page.tsx`) does **not** render them — it uses the rollup's
  `routingScores`. So `ProviderRow`'s raw scores are vestigial in the UI.

### 1.2 The bug this exposes — CONFIRMED (Phase 0, 2026-06-19)

The routing pipeline reads dimension scores from **`ModelProfile`**, never from `ModelProvider`:
`loadEndpointManifests()` — the sole manifest builder — queries
`prisma.modelProfile.findMany({ include: { provider: true } })` (`loader.ts:98-111`; comment:
"each manifest entry represents a specific model, not just a provider"). Dimension scores come
from the `ModelProfile` row (`mp.reasoning`, …); only genuinely-provider fields come from
`mp.provider`.

The two calibration writers have **diverged**:
- **DPF evals** correctly write `ModelProfile` (`eval-runner.ts:547,606`) → routing sees them.
- **Production feedback** (`production-feedback.ts:120`, live — called from
  `tak/orchestrator-evaluator.ts`) writes `ModelProvider`'s dimension columns and flips
  `profileSource="production"` → routing **never reads them**.

⇒ **Production feedback's dimension calibration never reaches routing.** The platform's
"learn from production outcomes" loop is effectively a **no-op for model selection** — a
routing-correctness defect, not merely redundancy. The §1.2(a) "orphaned writer" case is
**confirmed**; (b) is ruled out. **This warrants its own BI** independent of the cleanup.

The fix direction is therefore settled: **re-point** production feedback at `ModelProfile`
(matching the eval path), **not** retire it — production feedback is wanted, it's just writing
the wrong table.

## 2. Decision

**`ModelProfile` is the single canonical capability-scoring source.** Provider-level scores are
a **derived rollup** (`rollUpProviderModels`), never a separately-maintained table. The
`ModelProvider.{reasoning,codegen,toolFidelity,instructionFollowing,structuredOutput,
conversational,contextRetention}` columns are retired once their last writer/reader is migrated.

This is the data-model-stewardship corollary of `single-source-of-truth` / `one-data-model`:
one fact (a model's capability on a dimension) lives in exactly one place.

## 3. Plan (phased; each phase independently shippable + verifiable)

**Phase 0 — Confirm the routing read. ✅ DONE (2026-06-19).** Result in §1.2: the router reads
`ModelProfile` (`loader.ts:98-111`); evals write `ModelProfile` (`eval-runner.ts:547,606`);
production feedback writes `ModelProvider` (`production-feedback.ts:120`) → dead-ended. Fix =
**re-point** production feedback to `ModelProfile` (evals already prove it's the correct target).

**Phase 1 — Re-point or retire `production-feedback`.** If (a): retire the
`ModelProvider`-score write path; if production feedback should still calibrate, re-point it to
update the corresponding **`ModelProfile`** rows (per-model, keyed by the model that served the
task — the `EndpointTaskPerformance` row already carries model identity). Keep the
`profileSource` provenance semantics. Unit-test the propagation math against a `ModelProfile`
fixture. **Runtime risk: the `[dim]` dynamic access is invisible to `tsc`** — add an explicit
allow-listed `DIMENSION_KEYS` constant and index through it so a renamed/removed dimension fails
a test, not silently at runtime.

**Phase 2 — Remove the vestigial display reads.** Drop the per-dimension score fields from
`ProviderRow` (`ai-provider-types.ts`) and stop reading them in `ai-provider-data.ts`; the grid
already uses `routingScores`. Compiler-oracle this (remove fields → `tsc`) to prove no other
consumer.

**Phase 3 — Drop the columns.** Once Phases 1–2 land, the seven `ModelProvider` dimension columns
are unread/unwritten. Drop them in a migration, adding each to
`INTENTIONAL_FIELD_REMOVALS` in `schema-regression-guard.mjs` (the allowlist mechanism shipped in
#2087). This completes the convergence started by #2002 and #2087.

## 4. Functional verification (mandatory — why this is not a blind worktree PR)

Phase 1 changes **live calibration behavior**, and the `[dim]` access is not type-checked. Unit
tests cover the math; they do **not** prove the loop calibrates the right rows end-to-end.
Required canonical-runtime evidence (shared nonprod lease or live install, per AGENTS.md §5–6):

1. Seed a model with `profileSource="seed"`; drive enough task-performance feedback to cross
   `PROPAGATION_THRESHOLD`; assert the delta lands on the **`ModelProfile`** row and that a
   subsequent routing decision reflects the new score.
2. Providers grid (`/platform/ai/providers`) still renders calibrated `routingScores` (no
   regression) and the detail page is unchanged.
3. No `ModelProvider`-score write occurs after Phase 1 (DB assertion).

## 5. Research & benchmarking

- **Model-level vs provider-level capability** is the same split LiteLLM (per-model
  `model_info`) and OpenRouter (per-model capability/pricing) make: capability is a property of
  a *model*, not an *account/provider*. Provider-level is always a derived view. DPF's
  `ModelProfile` (per-model) + `rollUpProviderModels` (derived) matches that; the standalone
  `ModelProvider` score columns are the anti-pattern (provider-level as a separate source of
  truth) and are what this spec retires.
- **Calibration provenance** (`profileSource: seed|catalog|evaluated|production`) mirrors the
  confidence/source tiering in eval frameworks (e.g. LangSmith run feedback, Langfuse scores):
  keep it, attach it to `ModelProfile`.
- **Anti-pattern rejected:** maintaining two write targets and reconciling them later (the exact
  "reconcile N truth sources" friction the review flagged in `build-progress-visibility`).

## 6. Risks

- **Routing-behavior change.** Re-pointing calibration can shift model selection. Mitigate via
  the Phase 0 evidence note + Phase 4 functional verification before drop.
- **Dynamic `[dim]` access.** Not type-checked → runtime-invisible. Mitigate with an explicit
  `DIMENSION_KEYS` constant + tests.
- **Cross-environment column drop.** Phase 3 drops columns; the `EndpointTaskPerformance`
  history (`dimensionScores` JSON) is unaffected. Standard migration + allowlist.

## 7. Status

Design only. No code landed by this spec. Phases 1–3 are the implementation; Phase 0 is a
prerequisite investigation. Tracked under the architecture-convergence program
(memory `project_architecture_convergence`); file an `EP-ARCH-CONVERGENCE` epic + a BI per phase
before implementing.
