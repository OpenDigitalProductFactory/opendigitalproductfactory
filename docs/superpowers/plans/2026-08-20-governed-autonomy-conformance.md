# Governed Autonomy — TAK Conformance Implementation Plan

**Epic:** `EP-1C37C089` (governance gate) and `EP-32B0E693` (capability completeness)
**Spec:** [`docs/architecture/trusted-ai-kernel.md`](../../architecture/trusted-ai-kernel.md) §7.12.1–2, §8.1, §8.4.1–2, §8.11, §13.3
**Assessment:** [`docs/architecture/2026-08-20-governed-autonomy-architecture.md`](../../architecture/2026-08-20-governed-autonomy-architecture.md)
**Measure:** `pnpm measure:capability-completeness` → `docs/maintenance/capability-completeness.md`

## The one-line problem

Every control is built and correct. **Reach is what fails.** The action gate is
enforce-by-default and governs 2 of 174 side-effecting tools; the autonomy dial is
enforced and bounded by nothing; recurring activity has no declared shape; the
governance loop learns from human rulings and not from outcomes.

## What must NOT be rebuilt

These exist, work, and are cited in the scope register. Extend them.

| Capability | Where |
|---|---|
| Commandment veto at every tool dispatch | `apps/web/lib/mcp-tools.ts` (BI-43F95F77) |
| Consult-before-consequential-act gate | `apps/web/lib/tak/decision-routing-governance-hook.ts` |
| Autonomy boundary `advise` / `propose` / `act` | `apps/web/lib/actions/agent-task-scheduler.ts`, `apps/web/lib/proactivity/propose-interception.ts` |
| Sealed decision record | `DecisionInteraction` + `apps/web/lib/decision/decision-chain.ts` |
| Drift review | `apps/web/lib/decision/decision-drift.ts` |
| Weight inference from rulings | `apps/web/lib/decision-perspective/weight-inference-adapter.ts` |
| Graduated transition gate | `apps/web/lib/decision-perspective/graduated-autonomy.ts` |
| Cycle boundary fields (trigger, stop conditions, review point) | `apps/web/lib/work-management/room-cycle-adapter.ts` |
| Capability measure + derived artifact | `scripts/measure-capability-completeness.mjs` |

## Sequencing constraint

**Do not flip the default to `consequential` in the same change that adds the
field.** TAK §8.1 requires undeclared side-effecting tools be treated as
consequential — but 167 tools are undeclared today, so flipping the default
immediately would demand a `principle_decide` consult before almost every action
and wedge the platform. The staged path below reaches the same end state without
an outage, and keeps the gap *visible* the whole way rather than silently
deferred.

---

## Phase 0 — Unblock (small, independent, no behaviour risk)

| # | Change | BI |
|---|---|---|
| 0.1 | Grant `registry_read` to `compliance-officer`, `security-engineer`, `market-research-analyst` | `BI-728FD7F2` |
| 0.2 | Repoint the 8 stranded skills to handles that reach a coworker | `BI-B50D5E93` |
| 0.3 | Resolve or remove the 7 unbacked `backingSkillIds` | `BI-5C1978C7` |

**Exit:** no roster coworker sits below Governance level 2 (three do today: `compliance-officer`, `security-engineer`, `market-research-analyst`);
`summary.skills.stranded` = 0. `capability-completeness.test.ts` has an expectation
asserting the *current broken* state for 0.1 — invert it deliberately, do not delete it.

## Phase 1 — Consequence classification infrastructure (the critical path)

| # | Change | BI |
|---|---|---|
| 1.1 | Add `consequence: "ordinary" \| "consequential"` to `ToolDefinition` | `BI-B54D5B65` |
| 1.2 | Derive the gated set from tool metadata; keep `CONSEQUENTIAL_DECISION_TOOLS` as a transitional seed, unioned not replaced | `BI-B54D5B65` |
| 1.3 | Report classification coverage in the measure and fail CI when it regresses | `BI-B6157AAB` |
| 1.4 | Classify the first tranche: tools that move money, reach a third party, change authority, or destroy state | `BI-B54D5B65` |
| 1.5 | Flip the default for *unclassified* tools to consequential, once coverage is high enough that the blast radius is small | `BI-B54D5B65` |

**1.5 is a separate change with its own review.** It is the moment DPF starts
conforming to `TAK-003`, and the moment the gate's behaviour visibly changes.

**Exit:** `summary.consequentialGate.coveragePct` rises monotonically; `TAK-020`
and `TAK-021` pass.

## Phase 2 — Autonomy bounded by coverage

| # | Change | BI |
|---|---|---|
| 2.1 | Surface the clamp reason wherever proactivity is configured — the operator raising the dial sees what bounds it | `BI-1DF04B7A` |
| 2.2 | Warn on admission-criteria failure (A1–A5) | `BI-1DF04B7A` |
| 2.3 | Hard-block `act` when reachable consequential tools are unclassified | `BI-1DF04B7A` |

**Exit:** `TAK-023` passes. Do not start 2.3 before Phase 1.4 — it would freeze
every coworker at `balanced`.

## Phase 3 — Shapes and triggers

| # | Change | BI |
|---|---|---|
| 3.1 | Work-shape registry: id, version, stages, per-stage gate + accountable principal | `BI-A2234157` (EP-WORK-CONVERGENCE) |
| 3.2 | Bind trigger classes per shape; require stop conditions and a review point | `BI-A2234157` |
| 3.3 | Dead-intent scan: a recorded cadence/expiry with no reader is a defect | `BI-B57CA395` |
| 3.4 | Deadline-horizon trigger over the six revived columns | `BI-B57CA395` |
| 3.5 | `COWORKER_SELF_TASKS` coverage decision per agent | `BI-E2DB8A43` |
| 3.6 | Recurring `taskType` + cadence on the skill schema | `BI-EA406643` |

**Exit:** plane 4 ceiling rises from 0; `TAK-024` and `TAK-025` pass.

## Phase 4 — Close the loop

| # | Change | BI |
|---|---|---|
| 4.1 | Bind `DecisionInteraction` to the execution it authorized | `BI-23BF8131` |
| 4.2 | Record observed outcome: succeeded / failed / reversed | `BI-23BF8131` |
| 4.3 | Feed outcomes into the same path weight inference uses for rulings | `BI-23BF8131` |
| 4.4 | Durable cross-process consult ledger | `BI-AF7CE2BC` |

**Exit:** `TAK-026` and `TAK-027` pass. Phase 4 is worth little before Phase 1 —
an outcome edge on 2 tools teaches nothing.

## Phase 5 — Identity reconciliation (parallel, independent)

| # | Change | BI |
|---|---|---|
| 5.1 | Resolve skill `assignTo` through the identity bridge at seed time | `BI-409A7EFA` |
| 5.2 | Decide per declared-only agent: seed, mark aspirational, or retire | `BI-E9FF1287` |
| 5.3 | Bridge or canonically home the 8 roster-only coworkers | `BI-620EBA53` |
| 5.4 | Curated golden journeys for agents on the generic probe | `BI-2C5DECC1` |

## Verification for every phase

1. `pnpm measure:capability-completeness` — the numbers must move in the intended direction.
2. `node --test scripts/measure-capability-completeness.test.mjs`
3. `npx vitest run` over the touched areas.
4. `node scripts/derived-artifacts-gate.mjs check-all`.
5. Update the conformance table in the assessment doc §0.

A phase is not done because the code landed. It is done when the measure says so.
