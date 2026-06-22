# Golden Triangle — Implementation Plan

*2026-06-21 · plan for EP-GOLDEN-TRIANGLE · grounds: [`docs/design/golden-triangle-design.md`](../../design/golden-triangle-design.md) (v0.3.2) + [`docs/design/golden-triangle-slice0-substrate-audit.md`](../../design/golden-triangle-slice0-substrate-audit.md)*

This is the phased build plan that turns the approved design into shippable slices. Slice 0 (substrate audit) is complete; this plan starts at Slice 1. It is intentionally reuse-first: the only new schema is three small additions (predicted-cost columns, one correlation id, a `goldenTriangle` profile extension). All feature code is built via Build Studio (file BI → promote → let BS run); this plan is the BI/decomposition source, not hand-written code.

## Guardrails (from the design — do not violate)

- The compiler **feeds** `inferContract()` via its existing `routeContext` caller-override slot; it never runs a parallel routing pass.
- No `ModelRegistryEntry`; no detached `TrianglePosition`; no parallel cost ledger. `ModelProfile` and the existing route/telemetry tables are canonical.
- Saved defaults **extend** `DecisionPerspectiveProfile` (reached via `DecisionInteraction.profileId`); no new `DecisionPreferenceProfile` table.
- The orchestration budget is a typed object persisted as JSON on the receipt / `DecisionInteraction.outcomePayload` path — not on `AgentModelConfig`, not a new table.
- Presets are the primary UI; the triangle is an opt-in fine-tune. Numeric/preset is the canonical accessible control (2-DOF contract).
- `verificationDepth` may be recorded but is inert until a verify step exists — the compiler must not promise verification the runtime can't run.
- Posture / orchestration-budget changes are phase-boundary decisions (HITL commandment); production-affecting changes present an approval card regardless of phase.
- UI not exposed to non-operator users until Slice 3 receipts exist.

## Core types (Slice 1 fixes these)

```ts
// Stable input/output contracts the rest of the build depends on.
type GoldenTrianglePreference = {
  costWeight: number;        // 0..1, sum ≈ 1 (soft)
  qualityWeight: number;
  timeWeight: number;
  preset: "fast" | "frugal" | "assured" | "balanced" | "custom";
};

type PostureOverride = {     // feeds inferContract() routeContext (stricter-wins)
  budgetClass?: "minimize_cost" | "balanced" | "quality_first";
  reasoningDepth?: "minimal" | "low" | "medium" | "high";
  effort?: "low" | "medium" | "high" | "max";   // existing lever (chat-adapter.ts)
  maxLatencyMs?: number;
  residencyPolicy?: "local_only" | "approved_cloud" | "any_enabled"; // never relaxed
  minimumDimensions?: Record<string, number>;
};

type OrchestrationBudget = {  // JSON on the receipt / DecisionInteraction.outcomePayload
  maxDurationMs?: number;       // biases agentic-loop MAX_DURATION_*
  retryBudget?: number;         // biases nudge/retry caps
  verificationDepth?: "none" | "shallow" | "deep"; // inert until a verify step exists
  deliberationPattern?: string; // selects a DeliberationPattern slug (perspective count)
};

type DecodedPolicy = {
  postureOverride: PostureOverride;
  orchestrationBudget: OrchestrationBudget;
  adjustments: Array<{ field: string; from: unknown; to: unknown; reasonCode: string; reason: string }>;
  state: "ok" | "blocked" | "defer";
  explanation: string;
  compilerVersion: string;
  presetVersion: string;
};

function compileGoldenTrianglePolicy(input: {
  preference: GoldenTrianglePreference;
  taskClass: string;
  authorityScope: { kind: string; profileId?: string; profileVersionId?: string };
  policyConstraints: { residency?: string; sensitivity?: string; toolGrants?: string[]; floors?: Record<string, number> };
  modelAvailability: { tiers: string[]; healthy: boolean };
}): DecodedPolicy; // pure, deterministic, no I/O
```

## Schema additions (the only new persistence)

1. **`DecisionPerspectiveProfile.goldenTriangle Json?`** — typed `{ preset, weights, presetVersion }`. Saved default per scope; versioned for free via `DecisionPerspectiveProfileVersion`.
2. **Predicted-cost columns** on the receipt path (`RouteOutcome` or the benchmark projection): `predictedInputTokens Int?`, `predictedOutputTokens Int?`, `predictedCostUsd Float?`, `decodedPolicy Json?`. Enables the cost-calibration drift loop.
3. **Correlation id** — propagate `RouteOutcome.requestId` (the receipt key) onto `TokenUsage`, `AdapterRunTelemetry`, and `DecisionInteraction` (add nullable `requestId` + backfill-free forward wiring). Highest-effort item; columns + propagation, no new entity.

## Slices → backlog items

| Slice / BI | Scope | Key files | Done when |
| --- | --- | --- | --- |
| **S1 — Pure compiler** (keystone) | `compileGoldenTrianglePolicy()` per the types above; cold-start Balanced = no deltas; precedence (hard policy > scope > task floor > posture > provider health > learned); fail-closed as a first-class output. | new `apps/web/lib/golden-triangle/compile.ts` (+ types), unit tests | Deterministic snapshot tests pass for Fast/Frugal/Assured/Balanced + ≥3 custom positions; Balanced yields zero deltas; conflict case (task `budgetClassDefault` vs posture) covered; no I/O. |
| **S2 — Accessible component** | Presets-first posture selector + numeric/keyboard 2-DOF + opt-in triangle + decode panel (plain/operator) reusing the Decision Canvas audit drawer; report-kit; empty/projecting/fail-closed states; mobile fallback. | `apps/web/components/golden-triangle/*` | Keyboard-only reaches any posture + reads decoded policy; SR announces decoded outcome; AGT-903 a11y audit passes; not exposed to non-operators (flagged) until S3. |
| **S3 — Receipt & telemetry join** | Wire one run: preference snapshot → posture override → `inferContract` → route → telemetry → feedback, under one correlation id; persist predicted vs actual. | schema migration (additions 2+3), `apps/web/lib/golden-triangle/receipt.ts`, view | A run produces a joined receipt; predicted-vs-actual drift computable; delta (requested vs actual) surfaced. |
| **S4 — WWMD default editor** | First saved profile (platform scope) via the `goldenTriangle` extension on `DecisionPerspectiveProfile`; admin/operator-facing. | Decision Perspective settings surface | Platform default editable + versioned; receipts stamp profile version. |
| **S5 — Project/org defaults** | WWWD/org + per-product defaults. | same surface, org scope | Org default resolves with subsidiarity; customer never inherits WWMD as authority. |
| **S6 — Learned defaults & posture descent** | Recommend, then (with approval) auto-adopt a learned posture per task class when realized quality is stable across N runs; keep an exception path. Calibration on realized signals only. | `apps/web/lib/golden-triangle/calibrate.ts` | Recommendation backed by receipts; auto-adopt gated on approval; revert path; guardrail monitor reverts a drifting default toward Balanced. |
| **S7 — Hive contribution** | Opt-in, metadata-only, thresholded, revocable, reputation- + incentive-weighted; explicit payload + exclusion list. | hive export adapter | Payload matches §10 contract; no raw content leaves; preview before contribute. |

Sequencing: S1 → S3 are the critical path (compiler, then receipts before any user-facing UI). S2 can build in parallel with S3 but stays flagged until S3 lands. S4–S7 follow. Each BI carries the §14 acceptance criteria for its slice; S1 additionally must record the `UX-Fit-Decision:` attestation (with the `human_cognitive_load` degeneracy flagged per §0.1).

## Test strategy

- **Compiler (S1):** snapshot tests are the backbone — frozen decoded-policy JSON per (preset × task-class × scope) so any drift is caught. Property tests: weights normalize; hard constraints always clamp; Balanced ≡ flag-off; fail-closed never emits an unsafe route.
- **Composition:** integration test that the posture override flows through `inferContract()` and the final contract matches expectations, including the conflict case.
- **Receipts (S3):** end-to-end test that one run threads the correlation id across all receipt tables and predicted/actual are both present.
- **Accessibility (S2):** keyboard-only + screen-reader scripts complete the full loop (select preset → fine-tune → preview → receipt) with zero blockers; AGT-903 audit in CI.

## Risks specific to the build

- The correlation-id propagation touches hot routing/telemetry paths — land it behind the receipt join (S3) with additive nullable columns; no backfill required.
- `verificationDepth` is inert until a verify step exists; S1 records it but the runtime ignores `deep`. Do not advertise verification in the decode panel beyond what runs (avoids the trust gap the design warns about).
- Build Studio for all feature code; this plan is the decomposition source. Keep slices small enough for a clean BS build + review per slice.
