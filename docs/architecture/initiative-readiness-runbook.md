# Initiative-Readiness Runbook — who does what, when, through the gates

**Purpose.** A single human- and agent-readable map of the governed path a piece of work travels from a raw backlog item to a completed, accepted initiative: the **roles × gates × sequence × actor**, and the **routing mechanism** that hands each gate to the coworker who can satisfy it. Written because that end-to-end map previously existed **only in code** — agents (this one included) were reverse-engineering it from gate-refusal errors, which is exactly how a governed process gets misused.

> **Source of truth is the code, not this file.** This runbook orients; it does not re-implement. The policy is `initiative-readiness.v3`, evaluated by a pure function. When this doc and the code disagree, the code wins — and this doc is stale and must be fixed.
> - Gate machine: [`apps/web/lib/backlog/initiative-readiness/evaluate.ts`](../../apps/web/lib/backlog/initiative-readiness/evaluate.ts) (`evaluateInitiativeReadiness`), [`types.ts`](../../apps/web/lib/backlog/initiative-readiness/types.ts) (codes, targets, profiles), [`readiness-guidance.ts`](../../apps/web/lib/backlog/initiative-readiness/readiness-guidance.ts) (per-profile evidence definitions + writer tools).
> - Independence enforcement: [`receipt-schema.ts`](../../apps/web/lib/backlog/initiative-readiness/receipt-schema.ts), reviewer identity in [`reviewer-identity.ts`](../../apps/web/lib/backlog/initiative-readiness/reviewer-identity.ts).
> - Lane → gate → grant → role + the reviewer packet builder: [`apps/web/lib/tak/initiative-readiness-tool-grants.ts`](../../apps/web/lib/tak/initiative-readiness-tool-grants.ts).
> - Where the recovery packet is issued: [`apps/web/lib/work-capsules/governed-work-claim.ts`](../../apps/web/lib/work-capsules/governed-work-claim.ts).
> - Packet consumption: [`apps/web/lib/mcp/packs/coworker-pack.ts`](../../apps/web/lib/mcp/packs/coworker-pack.ts), [`external-coworker-task-adapter.ts`](../../apps/web/lib/mcp/external-coworker-task-adapter.ts).

## 0. Two "shapes" — do not conflate them

The word *shape* is overloaded across the platform. Two distinct machines:

1. **The initiative-readiness gate machine** (this runbook). Decides whether a backlog item / epic / build may transition `design → plan → implementation → completion`, by checking that the required **evidence receipts** exist and passed review. Roles are *governance accountabilities* (design-author, design-checklist-reviewer, …).
2. **The Workroom collaboration shape** ([`apps/web/lib/work-management/room-shapes.ts`](../../apps/web/lib/work-management/room-shapes.ts), documented for humans in [`docs/user-guide/ai-workforce/how-governed-work-runs.md`](../user-guide/ai-workforce/how-governed-work-runs.md)). Decides *which collaboration roles staff a room* (coordinator → specialist/reviewer → approver). A different axis.

They meet at one edge: a readiness **review gate** is *routed into* a Workroom, to the reviewer coworker, via the recovery packet (§3).

## 1. The lifecycle sequence

The readiness **targets** are ordered and cumulative — each includes every prior target's requirements ([`types.ts`](../../apps/web/lib/backlog/initiative-readiness/types.ts), the cumulative call chain in `evaluate.ts`):

```
design  →  plan  →  implementation  →  completion
```

The backlog-item **status** vocabulary (`triaging / open / in-progress / done / deferred / retired`) is a *separate* axis. Status is where the item sits; the readiness targets gate the transitions between phases of real work. An item must be **triaged** (out of `triaging`) before any readiness target is reachable.

**Depth is set by the profile** (`doc-only ⊂ fix ⊂ feature ⊂ cross-domain ⊂ archetype`). A `doc-only` change skips the reviewer gates a `feature` must pass; strongest applicable profile wins.

## 2. The gates — role × actor × evidence (feature profile)

Each row: the gate, the **accountable role**, **who actually acts** (Author = the coworker doing the work; Independent = a reviewer coworker that is *not* the author; Human/System = authority), and the **tool** that records the receipt. "Independent" gates carry `independent: true` on their writer lane and are **refused** if the reviewer principal equals the author principal (`receipt-schema.ts` — *no self-approval override exists*).

| Target | Gate | Accountable role | Actor | Recorded by |
|---|---|---|---|---|
| design | CLASSIFICATION | product-owner | Author | `record_initiative_evidence(gate:"classification")` |
| design | AUTHORIZATION | platform-governance | System/Human authority | authority intersection (token ∩ grant ∩ capability) |
| plan | RESEARCH | design-author | Author | `record_initiative_evidence(gate:"research")` |
| plan | CANONICAL_DESIGN | design-checklist-reviewer | **Independent** | `record_initiative_design_review(gate:"design-spec")` |
| plan | **SPEC_APPROVAL** | design-checklist-reviewer | **Independent** | `record_initiative_design_review(gate:"spec-approval")` — **mints the scope baseline** |
| plan | REVIEW (architecture) | architecture-reviewer | **Independent** | `record_initiative_architecture_review` |
| plan | OBJECTIVE_BASELINE | design-checklist-reviewer | **Independent** | minted *by* the spec-approval receipt |
| plan | ARTIFACT_AUTHOR | artifact-resolver | Author (git identity) | DCO-signed commit (author principal == workroom principal), **pushed**, then `adopt_worktree` re-sync |
| implementation | PLAN | implementation-planner | Author | `record_plan_backlog_coverage` |
| implementation | DEPENDENCY_DISPOSITION | portfolio-management | Author | `record_initiative_evidence(gate:"dependency-disposition")` |
| implementation | CAPSULE_IDENTITY | delivery-coordinator | Author | `adopt_worktree(headBranch, headSha)` |
| implementation | PLAN_REVIEW | plan-reviewer | **Independent** | `record_initiative_design_review(gate:"plan-review")` |
| implementation | PLAN_COVERAGE + TRACEABILITY | portfolio-management | Author | `record_plan_backlog_coverage` (binds to the baseline) |
| completion | DELIVERY_EVIDENCE | delivery-coordinator | Author | `record_execution_evidence`, cited in `completionEvidence.evidenceActivityIds` |
| completion | ACCEPTANCE_EVIDENCE | acceptance-reviewer | **Independent** | acceptance evidence vs the objective baseline |
| completion | OBJECTIVE_RECONCILIATION | acceptance-reviewer | **Independent** | `record_product_outcome_observation` |

Cross-domain / archetype profiles add specialist review gates (data / ux / security / compliance / domain / archetype), each an independent lane.

**Evidence must be a gate receipt.** A plain timeline "evidence" activity is deliberately *not* accepted (the load-bearing distinction reported as `gate-receipt` vs `recorded-unread` vs `none`). Recording `record_execution_evidence` alone does **not** satisfy a review gate.

## 3. How a gate is handed to the right coworker — the recovery packet

You do **not** choose the reviewer or hand-build the review call. The server issues a **recovery packet** naming, per unmet gate, the exact coworker and a ready-to-send handoff. The flow:

1. **Bind a Workroom to the item, with a real base *and* head.** `adopt_worktree(title, objective, repositoryFullName, headBranch, headSha, baseBranch, baseSha, worktreePath, backlogItemId)`. Without **both** an immutable `baseSha` and `headSha`, no reviewer binding can be issued (`no-canonical-artifact`) — the review has nothing immutable to pin. The artifact commit must be **resolvable on the provider** (a squash-merged, deleted branch will not resolve — re-publish it).
2. **Attempt the governed claim.** `claim_backlog_item_for_work(itemId, worktreePath, branchName, provider, sessionRef)`. When the item is not ready it *refuses* and returns `data.recovery`:
   - `reviewerRoutes[]` — per gate: `accountableRole`, `gate`, `targetAgentId`, `independent`, and a ready `requestCoworker` packet with `requiredToolNames` + `initiativeReviewBinding` (the writer tool + the immutable `artifactRef` — repo, commitSha, path, providerBlobId).
   - `escalations[]` — `no-eligible-reviewer` (activate a production reviewer holding the grant) / `no-canonical-artifact` (fix the base/head per step 1) / `dispatch-context-required`.
   - `unroutable[]` — gates whose role owns no writer lane (e.g. `ARTIFACT_AUTHOR` — you push a signed commit; nobody records it for you).
3. **Dispatch each packet** with `request_coworker` (or `summon_coworker`), passing the `targetAgent`, `objective`, `requestKey`, **and** the packet's `requiredToolNames` + `initiativeReviewBinding` verbatim. The two travel together or not at all; the adapter refuses a binding without its required tools, and refuses any tool outside the bound writer + `read_source_at_version`. The dispatched coworker reads the pinned artifact and records the gate receipt **only if the gate passes** — it cannot invent or reshape the identity.
4. **Re-attempt the claim / transition.** Passing receipts satisfy their gates; `spec-approval` mints the baseline, which unblocks `record_plan_backlog_coverage`; the item advances.

**Claim identity, when a room was owned by a prior session.** The claim matches the Workroom's recorded executor identity and lease-holder. A room left by a dead session (idle-stale, no live signal) can refuse a fresh claim with `capsule_identity_mismatch` even after `adopt_worktree`, and `force` does **not** override an identity mismatch (only live-ownership conflict). Take the room over with `reassign_workroom_executor(capsuleId, toExecutorKind, toExecutorRef, reason)` — it transfers the lease to the caller and sets the executor — then re-claim. Renew a still-owned but expiring lease with `heartbeat_workroom`; do not thrash heartbeat on an already-expired lease.

## 4. The reviewer roster (who holds which grant)

Live assignment in [`packages/db/data/agent_registry.json`](../../packages/db/data/agent_registry.json); the recovery packet resolves the current holder, so prefer the packet over this table.

| Grant | Coworker | Gates it records |
|---|---|---|
| `initiative_design_review` | **AGT-WS-REVIEW** (Change Reviewer) | design-spec, spec-approval, plan-review |
| `initiative_architecture_review` | **AGT-WS-EA** (ea-architect) | architecture-review |
| `initiative_data_review` | AGT-902 (data-governance) | data-review |
| `initiative_ux_review` | AGT-903 (ux-accessibility) | ux-review |
| `initiative_security_review` | AGT-190 (security-auditor) | security-review |
| `initiative_compliance_review` | AGT-905 (licensing-specialist) | compliance-review |
| `initiative_archetype_review` | AGT-WS-INVENTORY (inventory-specialist) | archetype-review |
| `initiative_evidence_write` | **AGT-WS-BUILD** (Build Lead), AGT-WS-PORTFOLIO | research, dependency-disposition, plan-coverage, delivery (author-side) |

**Independence is by principal.** A reviewer coworker's receipt is attributed to that coworker's principal; on a single-human-principal install the reviewer coworker is the *only* independent reviewer available, which is *why* the author (human or external agent) cannot self-approve and must route (`reviewer-identity.ts`). If no production coworker holds the grant, the packet escalates `no-eligible-reviewer` — activate one; do not proxy the receipt.

## 5. Drive-to-completion checklist

For a `feature` initiative:

1. **Triage** the item (`triage_backlog_item`) — leaves `triaging`.
2. **Author the artifacts**: canonical design spec (with the Research & Benchmarking section) + phased plan under `docs/superpowers/`, DCO-signed and **pushed** to a resolvable branch.
3. **Bind the Workroom** to the item with real `baseSha` + `headSha` pointing at the pushed artifact (`adopt_worktree`).
4. **Get the recovery packet** (`claim_backlog_item_for_work`) → dispatch: research (AGT-WS-BUILD), design-spec + spec-approval (AGT-WS-REVIEW), architecture-review (AGT-WS-EA).
5. **Baseline minted** by spec-approval → **record plan-coverage** (`record_plan_backlog_coverage`, binds to the baseline) → dispatch plan-review (AGT-WS-REVIEW).
6. **Implement**; land the change via the normal PR/merge-queue path (build gate is provenance-blind — governance approves the *evidence*).
7. **Completion**: `record_execution_evidence` (delivery) → dispatch acceptance-review + `record_product_outcome_observation` (AGT-WS acceptance-reviewer) → close.

At every step, the **recovery packet is the authority on the next action** — read its `reviewerRoutes` / `escalations` / `unroutable`, act on them, and re-attempt. Do not guess the reviewer, and do not treat a reviewer requirement as a dead-end: it is a routing step.

## 6. Known limitation — reviewer dispatch can complete without writing a receipt

Routing a review correctly is necessary but not currently *sufficient*. A dispatched external reviewer coworker can finish a bound task **without executing its governed writer** — the coworker reads the pinned artifact, returns evidence-confirming prose, and completes with `executedToolCount: 0`, so no `record_initiative_*` receipt is ever written and the gate stays unmet. When this happens the initiative correctly refuses to advance (it has no receipt), but it also cannot be advanced by re-dispatching — the work strands at the reviewer step even though the operator routed it exactly right.

This is a tracked platform defect, **BI-ECFE0AC2** ("External initiative reviewers complete with zero tool executions, blocking governed terminal transitions"), under epic EP-E1F1DB58, with two observed contributing causes: the reviewer's terminal-writer context not hydrating its bound tools, and a stale Codex model catalog forcing a fallback that omits the writer. Until it is fixed, a `feature` initiative on a single-principal install can be fully authored, correctly bound, and correctly routed, yet still not reach `completion` — and that is the defect's fault, not a step the operator or author missed. Do not proxy the receipt from the author principal to "unblock" it: that would defeat the independence rule the gate exists to enforce (§2). Read the live BI for current status before assuming the strand is unfixed.

## Anti-patterns (observed)

- **Driving the workroom from gate-refusal errors instead of the packet.** Get the packet; it names every actor and hands you the call.
- **Self-approving, or declaring "the author can't do this, so it can't be done."** The author routes to the reviewer coworker; that is the design, not a blocker.
- **Guessing the reviewer coworker.** The packet resolves the current grant-holder; a guessed target (e.g. an architecture agent for a design-spec gate) will not hold the grant.
- **Binding a Workroom with a head but no base, or to a deleted/unresolvable commit.** No immutable artifact → no reviewer binding (`no-canonical-artifact`). Push the artifact; anchor base **and** head.
- **Proxying a stranded reviewer receipt from the author principal.** If a review strands (§6), that is a defect to report, not a licence to self-approve.
