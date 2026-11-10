---
status: active
---

# Context-Economy Eval Metrics (R8)

**Status:** Phase 1 SHIPPED (per-turn tool-surface + selection-accuracy gauge, observability-only). Phase 2 (cross-task telemetry rollup) STAGED.
**Date:** 2026-06-20
**Standard:** `docs/architecture/context-engineering-standards.md` (P12). **Parent research:** `docs/superpowers/specs/2026-06-20-context-engineering-tool-efficiency-design.md` (R8).

## 1. Why

The standard's P12 says: *measure whether context/tool changes help* — tokens-per-task, task success, tool-selection accuracy — and *watch the tool-count cliff*, because selection accuracy doesn't degrade gracefully: it collapses once a small local model is handed more than ~15 tools (`LOCAL_FALLBACK_MAX_TOOLS`). Without measurement, the R1/R4/R3 wins are asserted, not proven, and a regression (an agent's tool surface ballooning, a tool that keeps failing) is silent. This makes the signals visible.

## 2. Design — mirror the proven gauge pattern

`apps/web/lib/tak/context-pressure.ts` is a pure, import-free, unit-tested "dumb-zone" gauge logged once per turn (`ctxZone=…`). R8 adds a sibling, `apps/web/lib/tak/context-economy-metrics.ts`, in the same shape — nothing it computes changes what is sent to the model; it only makes the figures observable.

**Phase 1 (shipped) — two live signals on the `[turn]` log:**
- **Tool surface** — `assessToolSurface({ tools, windowTokens })`: the tool count, the estimated definition-token cost (~chars/4 of the provider-format tools actually sent), whether it passes the local selection cliff, and a zone (`lean` / `caution` / `overload`) banded by the cliff (count) and, when the real window is known, by the definitions' share of it.
- **Tool-selection accuracy** — `computeToolSelectionAccuracy(executions)`: the fraction of the turn's tool calls that succeeded, overall and per tool.

Both are appended to the existing per-turn summary in `agentic-loop.ts` (`logTurnSummary`):
`… toolSurface=<n> estToolTokens=<t> surfaceZone=<z> toolAccuracy=<a>`.

So a turn that hands a local model 40 tools logs `surfaceZone=overload`, and a tool that fails repeatedly drags `toolAccuracy` down — both now greppable alongside `ctxZone`.

## 3. What this proves

- **R1 (result cap):** large results no longer balloon a turn — visible as stable `ctxPeakTokens`/`ctxZone` rather than spikes.
- **R3 (core tier) / R4 (programmatic tool calling):** their point is a smaller surface and fewer round-trips — visible as `toolSurface`/`surfaceZone` and (for PTC) fewer tool calls per task at the same `toolAccuracy`.
- **The cliff:** `surfaceZone=overload` is the explicit, greppable signal that an agent's grant/phase scoping has drifted past what a small local model can select over.

## 4. Phase 2 (staged) — cross-task rollup

The per-turn signals are also the tested primitives for an aggregate view: a telemetry query over `ToolExecution` / `CoworkerTurnMetric` that reports tool-selection accuracy and tokens-per-task **per model / route / window**, so a description or registry change can be gated on a before/after delta (the standard's "track tokens-per-task, task success, selection accuracy"). Deferred because it needs a telemetry query + a surface (and, for tokens-per-task, either a turn-metric field or a derivation), which is heavier and not locally verifiable. `computeToolSelectionAccuracy` already operates over an arbitrary execution window, so the rollup reuses it directly; a `computeTokensPerTask` companion lands with it.

## 5. Tests

`apps/web/lib/tak/context-economy-metrics.test.ts` — `estimateToolDefinitionTokens`, `assessToolSurface` (lean / caution / overload by count and by window share), `computeToolSelectionAccuracy` (overall + per-tool, empty = 1.0, malformed ignored). Pure module → no heavy imports, runs in CI's web suite.

## 6. Files

- `apps/web/lib/tak/context-economy-metrics.ts` (+ `.test.ts`).
- `apps/web/lib/tak/agentic-loop.ts` — `logTurnSummary` gauge.

## 7. 2026-09-03 delivery-outcome extension

Per-turn context efficiency cannot establish delivery value by itself. The
scorecard in
[`2026-09-03-local-first-agentic-delivery-throughput-design.md`](2026-09-03-local-first-agentic-delivery-throughput-design.md)
and `BI-69803ACC` reuses these signals and joins them to Workroom, PR/check/review,
queue, and runtime-verification facts. Model/prompt-profile decisions must compare
tokens and tool accuracy alongside verified outcome, cycle time, rework, quality,
and human intervention; PR count or LOC alone is not an acceptable success metric.
