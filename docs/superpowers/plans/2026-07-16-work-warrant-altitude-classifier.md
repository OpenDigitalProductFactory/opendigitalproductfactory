# Plan — WorkWarrant object + cold-start altitude classifier

**BI:** `BI-8AB0E66D` — WorkWarrant object + cold-start altitude classifier (structure-first, corpus-enriched, self-seeding)  
**Epic:** `EP-7B169558` — Decision-altitude control plane  
**Status:** implementation plan, ready for Build Studio / external execution  
**Date:** 2026-07-16

## 1. Goal

Add a durable `WorkWarrant` contract that is emitted before a work item enters execution and then reused by the lane router, effort binder, evidence collector, and reporter.

The core promise is day-one steering:

- classify the work altitude as `wsid`, `wwwd`, or `wwmd`;
- choose the appropriate execution lane and evidence/reporting rigor;
- do it from deterministic structural signals first, not from a mature corpus that may not exist yet;
- write the warrant and outcome back as examples so WWWD/WSID learn from operation.

## 2. Current substrate verification

| Candidate / dependency | Current state | Evidence |
|---|---|---|
| `WorkWarrant` object | No existing code graph, spec, or repo hit for the object name. | `search_code_graph("WorkWarrant")` returned no matches; repo grep found only unrelated “warranty/warranted” terms. |
| Build process size/type matrix | Exists and should be extended, not bypassed. It maps `workType + effortSize` to lifecycle policy, model tier, sensitivity, and gate rigor. | [`apps/web/lib/explore/build-process-matrix.ts`](../../../apps/web/lib/explore/build-process-matrix.ts) |
| Promote/tee-up point | Exists. `promoteBacklogItemToBuildDraft()` already resolves `processSize`, `kind`, happy-path intake, active build linkage, and Work Capsule attachment. | [`apps/web/lib/governed-backlog-tee-up.ts`](../../../apps/web/lib/governed-backlog-tee-up.ts) |
| Decision profiles / ledger | Exists. WWMD and WWWD decisions use `DecisionPerspectiveProfile`, `DecisionInteraction`, and scoped gate entry-points. | [`apps/web/lib/decision-perspective/build-studio-gate.ts`](../../../apps/web/lib/decision-perspective/build-studio-gate.ts), [`apps/web/lib/decision-perspective/org-business-gate.ts`](../../../apps/web/lib/decision-perspective/org-business-gate.ts) |
| WSID / WWWD / WWMD work scope | Exists as the direction for Work Capsules; scope metadata is planned on the Work Capsule spine. | [`docs/superpowers/plans/2026-06-30-layer-scoped-work-capsules.md`](2026-06-30-layer-scoped-work-capsules.md) |
| Blast-radius sensitivity | Exists as a two-phase path: keyword sensitivity before code, diff-derived blast radius after code. | [`docs/superpowers/specs/2026-06-23-quality-first-risk-aware-build-rightsizing-design.md`](../specs/2026-06-23-quality-first-risk-aware-build-rightsizing-design.md), [`apps/web/lib/integrate/change-impact.ts`](../../../apps/web/lib/integrate/change-impact.ts) |
| Design-time decomposition | Exists as the pattern for `xlarge` / too-large design work. The WorkWarrant should read this signal rather than invent a separate decomposition gate. | [`docs/superpowers/specs/2026-05-24-build-studio-design-time-decomposition-design.md`](../specs/2026-05-24-build-studio-design-time-decomposition-design.md) |

**Substrate verdict:** `WorkWarrant` is a new contract, but it should be introduced as a typed extension of the existing Build Studio / Work Capsule / DecisionInteraction substrate. Do not create a parallel execution system.

## 3. Contract

Add the shared type in a new focused module, tentatively:

`apps/web/lib/work-warrant.ts`

```ts
export const WORK_WARRANT_ALTITUDES = ["wsid", "wwwd", "wwmd"] as const;
export const WORK_WARRANT_ALTITUDE_BASIS = ["structural", "corpus", "operator"] as const;
export const WORK_WARRANT_LANES = ["autonomous", "governed-interactive", "direct-expert"] as const;
export const WORK_WARRANT_EVIDENCE_PROFILES = ["minimal", "standard", "compliance", "architectural"] as const;
export const WORK_WARRANT_REPORTING_PROFILES = ["one-line", "business", "ledger"] as const;

export type WorkWarrant = {
  altitude: "wsid" | "wwwd" | "wwmd";
  altitudeConfidence: number;
  altitudeBasis: "structural" | "corpus" | "operator";
  lane: "autonomous" | "governed-interactive" | "direct-expert";
  budget: {
    tokenCeiling: number;
    modelTier: "local" | "robust";
    effortLevel: "low" | "medium" | "high";
    gateProfile: "minimal" | "standard" | "thorough" | "decompose-first";
  };
  evidenceProfile: "minimal" | "standard" | "compliance" | "architectural";
  reportingProfile: "one-line" | "business" | "ledger";
  contextScope: {
    industry?: string | null;
    jurisdiction?: string | null;
    archetype?: string | null;
  };
  signals: {
    workType?: string | null;
    effortSize?: string | null;
    processType?: string | null;
    processSize?: string | null;
    deliverableSensitivity?: "low" | "elevated" | "high";
    designDecomposition?: "not-evaluated" | "ok" | "decompose-recommended" | "decompose-required";
    touchedLayers?: string[];
    riskReasons?: string[];
  };
};
```

Keep the closed vocabularies centralized in this module. If any value becomes persisted as a string column, mirror it in the MCP schema in the same PR per AGENTS.md enum discipline.

## 4. Cold-start classifier

Implement a pure classifier first:

`deriveWorkWarrant(input): WorkWarrant`

### Structural inputs

- `BacklogItem.workType`
- `BacklogItem.effortSize`
- `BacklogItem.title/body`
- `deriveBuildProcessType()`
- `deriveBuildProcessSize()`
- `deriveDeliverableSensitivity()`
- design-time decomposition result when available
- route/layer/code-graph blast-radius signal when available
- org/archetype/jurisdiction context when available

### Initial rules

| Signal | Warrant effect |
|---|---|
| Work touches governance, kernel, schemas, routing, auth, permissions, billing, regulated data, migrations, or Build Studio execution machinery | Raise toward `wwmd`; lane at least `governed-interactive`; evidence at least `architectural` or `compliance` depending on domain. |
| `effortSize=xlarge` or decomposition required | `wwmd`, `direct-expert` or `governed-interactive`, robust tier, thorough/decompose-first gate. |
| Business-operation decision with organization/archetype/jurisdiction context and no platform-core blast radius | `wwwd`, `governed-interactive` by default until org corpus confidence improves; reporting `business`; evidence `standard` or `compliance`. |
| Profession/craft execution with low blast radius and known role/profession context | `wsid`, `autonomous` or `governed-interactive` depending confidence; evidence `minimal`/`standard`; reporting `one-line`. |
| Thin WWWD corpus | Never silently route as fully autonomous; choose `governed-interactive`, mark `altitudeBasis="structural"`, and record the operator confirmation as corpus material. |
| Established WWMD corpus | Permit higher confidence from day one because kernel principles, AGENTS.md, and decision dimensions already exist. |

The classifier must be deterministic and testable. Corpus enrichment can raise/lower confidence later, but the cold-start path cannot depend on embeddings or an LLM call.

## 5. Persistence shape

Phase 1 should persist the warrant as JSON on existing execution records:

- `FeatureBuild.plan.workWarrant` for Build Studio execution.
- `WorkCapsule` scope metadata once the layer-scoped plan lands, with `decisionScope` aligned to warrant altitude.
- `DecisionInteraction.outcomePayloadExtra.workWarrant` when a decision gate is involved.
- `BuildActivity` / `BacklogItemActivity` summary for operator-visible audit.

Do **not** add a first-class `WorkWarrant` table in the first slice. Add one only if queries need to filter across warrants independently of builds/capsules/interactions. This preserves single source of truth and keeps Phase 1 migration-free.

## 6. Phased implementation

### Phase 1 — Pure contract + classifier

Deliverables:

- Add `apps/web/lib/work-warrant.ts`.
- Add unit tests in `apps/web/lib/work-warrant.test.ts`.
- Tests cover:
  - closed vocabulary guards;
  - low-risk WSID default;
  - governance/kernel/schema/auth/billing/compliance text raises to WWMD;
  - organization/jurisdiction/archetype business context routes to WWWD with governed-interactive lane;
  - `xlarge` / decompose-required raises to WWMD/direct-expert;
  - sensitivity can only raise rigor, never lower it.

Verification:

```bash
pnpm --filter web exec vitest run lib/work-warrant.test.ts
pnpm --filter web typecheck
```

### Phase 2 — Promotion-time wiring

Deliverables:

- In `promoteBacklogItemToBuildDraft()`, derive the warrant from the BI and existing right-sizing outputs.
- Persist it into `FeatureBuild.plan.workWarrant`.
- Include a `BuildActivity` summary such as:
  - `Work warrant: WWMD / governed-interactive / architectural evidence`
- Ensure `processSize`, `kind`, and `workWarrant.budget` agree with `build-process-matrix.ts`.

Verification:

```bash
pnpm --filter web exec vitest run lib/governed-backlog-tee-up.test.ts lib/work-warrant.test.ts
pnpm --filter web typecheck
```

### Phase 3 — Evidence and reporting readers

Deliverables:

- Teach Build Studio header/status surfaces to display the warrant in plain language:
  - “Architecture-level work — governed review, robust model, ledger evidence”
  - “Business-level work — operator-confirmed, business summary”
  - “Craft-level work — lightweight execution”
- Thread `evidenceProfile` into evidence collection defaults.
- Thread `reportingProfile` into final reporting defaults.

Verification:

```bash
pnpm --filter web exec vitest run lib/integrate lib/explore
pnpm --filter web typecheck
```

UX verification:

- Promote one low-risk WSID-style BI and confirm the UI does not over-alarm.
- Promote one platform/governance BI and confirm the UI explains why the stricter lane is selected.

### Phase 4 — Feedback loop / self-seeding

Deliverables:

- When operator confirmation changes a warrant, record:
  - original warrant;
  - operator-selected altitude/lane/profile;
  - final outcome.
- For WWWD and WSID, create candidate corpus material or decision examples through the existing Decision Perspective / wiki contribution path.
- Keep WWMD feedback in the existing kernel decision record path; do not mix platform doctrine into org doctrine.

Verification:

- Unit tests for candidate material payload shape.
- Manual check that operator override produces a reviewable corpus candidate rather than silently changing future classification.

### Phase 5 — Post-code blast-radius confirmation

Deliverables:

- At verify/review time, compare initial `workWarrant.signals.deliverableSensitivity` with actual diff-derived sensitivity from `deriveBlastRadiusSensitivity()`.
- If actual blast radius exceeds the warrant, raise an attention/evidence signal:
  - “Warrant under-called blast radius: promote review from standard to architectural.”
- Keep the first enforcement non-destructive and loop-safe; do not repeatedly re-trigger the same hold.

Verification:

- Pure tests for monotonic warrant escalation.
- Functional PR evidence from a controlled diff that raises blast radius.

## 7. Acceptance criteria

- Every promoted Build Studio work item has a deterministic `workWarrant` in its plan.
- The warrant is visible to the operator in language a non-technical person can understand.
- WWMD / WWWD / WSID scope is explicit and auditable.
- Thin WWWD/WSID corpus never causes silent under-governance; cold-start structural defaults protect the lane.
- Operator corrections feed candidate learning records rather than staying in one thread’s memory.
- Existing Build Studio behavior remains byte-identical when the warrant is not consumed by a downstream reader.

## 8. Risks and rollback

| Risk | Mitigation |
|---|---|
| Duplicating right-sizing logic | `WorkWarrant` calls `deriveBuildProcessType`, `deriveBuildProcessSize`, `deriveDeliverableSensitivity`, and `getModelTier`; it does not fork those rules. |
| Creating a parallel decision ledger | Record warrant decisions through `DecisionInteraction` / existing activity rows. Do not add a separate ledger table in Phase 1. |
| Over-classifying work as WWMD | Start with structural reasons in `signals.riskReasons`; display why the warrant chose a lane; allow operator correction to seed examples. |
| Under-classifying thin WWWD corpus | Default WWWD to governed-interactive until the org corpus earns confidence. |
| Migration blast radius | Phase 1 is migration-free; persistence is JSON on existing plan/activity/interaction structures. |

Rollback for Phases 1–2 is straightforward: stop reading `plan.workWarrant`. Existing builds continue because `plan` is already a flexible JSON payload and downstream consumers must tolerate absence.

## 9. Architecture review notes

- **Aligned:** Extends existing Build Studio right-sizing, Work Capsule scope, and Decision Perspective ledgers rather than inventing a separate execution system.
- **Important guardrail:** Keep the first implementation migration-free. A `WorkWarrant` table is only justified after query evidence proves JSON-on-existing-records is insufficient.
- **Important guardrail:** The classifier is deterministic and pure before any LLM/corpus enrichment, satisfying the cold-start requirement.
- **Minor concern:** `WorkWarrant` can become a grab bag if downstream fields are added casually. Keep the type closed and route new dimensions through explicit follow-up BIs.

## 10. First shippable slice

Build Phase 1 only:

1. Add `work-warrant.ts`.
2. Add `work-warrant.test.ts`.
3. Wire no production behavior yet.
4. Record implementation evidence against `BI-8AB0E66D`.

That slice gives future agents and Build Studio a stable contract to implement against without risking the active delivery pipeline.
