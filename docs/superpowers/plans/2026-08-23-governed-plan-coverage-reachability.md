---
status: active
---

# Plan — Governed plan-coverage reachability (BI-72F368BC)

- **Date:** 2026-08-23
- **Umbrella item:** `BI-72F368BC`
- **Design:** [`docs/superpowers/specs/2026-08-23-governed-plan-coverage-reachability-design.md`](../specs/2026-08-23-governed-plan-coverage-reachability-design.md)
- **Decision:** `DI-C4CA74763089` — coworker-principal reviewer (composite 10.74, margin 4.43, high confidence, no commandment conflict)

Three adjacent but independent defects sit on the path to a governed coverage
receipt. They ship as three branches and three PRs; they are deliberately not
merged into one item.

## Deliverables

| Key | Backlog item | Title | Branch | Independently shippable |
| --- | --- | --- | --- | --- |
| `reviewer-attribution` | `BI-72F368BC` | Attribute a gate review to the reviewing coworker's principal | `fix/initiative-baseline-coworker-reviewer` | yes |
| `remediation-condition` | `BI-38A353B2` | Refusals name the condition and the offending value, never a backlog id | `fix/coverage-remediation-names-condition` | yes |
| `branch-identity` | `BI-F83CF689` | Key every workroom on (repository, branch) so a claim late-binds | `fix/workroom-repo-late-binding` | yes |

Dependencies: none between them. `remediation-condition` and
`branch-identity` are each worth shipping even if `reviewer-attribution`
lingers; `reviewer-attribution` is the one that makes a v2 receipt reachable.

## Traceability

### `reviewer-attribution` — `BI-72F368BC`

- Requirements: `OBJ-GPCR-001`, `OBJ-GPCR-002`, `OBJ-GPCR-003`
- Contracts: `resolveReviewerIdentity`, `independentReviewerRemedy`, `validateInitiativeGateReceiptDraft`
- Flows: summon reviewer coworker → `record_initiative_design_review` (gate `spec-approval`) → `initiative_scope_baseline` → `record_plan_backlog_coverage`
- Verification: `AC-GPCR-001`, `AC-GPCR-002`, `AC-GPCR-003`, `AC-GPCR-004`

### `remediation-condition` — `BI-38A353B2`

- Requirements: `OBJ-GPCR-004`
- Contracts: `recordPlanBacklogCoverage`, `validatePlanBacklogCoverageReceipt`, `check-live-blocker-references`
- Flows: a refusal on the coverage path → the caller reads the offending value and the remedy → no stale identifier is copied into a plan
- Verification: `AC-GPCR-005`, `AC-GPCR-006`

### `branch-identity` — `BI-F83CF689`

- Requirements: `OBJ-GPCR-005`
- Contracts: `readBranchIdentityCapsule`, `defaultPlatformRepositoryFullName`, `adoptWorktreeCapsule`
- Flows: `create_workroom` → `plan_workroom_worktree` → `claim_backlog_item_for_work` yields ONE capsule on the branch
- Verification: `AC-GPCR-007`, `AC-GPCR-008`

## Phases

1. **Branch identity** (`BI-F83CF689`) — smallest, and it is the defect that corrupts the workroom record used to track the other two.
2. **Remediation text and the reference guard** (`BI-38A353B2`) — independent of the reviewer fix, and it removes the stale-citation trap before more plans copy it.
3. **Reviewer attribution and the conformance suite** (`BI-72F368BC`) — the fix that makes a baseline reachable, plus the test that stops a fourth occurrence of this class.
4. **Live proof** — deploy through `/ops/self-upgrade`, record spec-approval for this design as the reviewer coworker, then record this plan's own v2 coverage receipt. Restore the governed coverage blocks on the three plans currently carrying documented refusals.

## Governed coverage receipt

Pending phase 4: this plan's own v2 receipt is the proof that `BI-72F368BC` is
fixed, and it cannot be recorded until the fix is deployed to the canonical
runtime. The mapping table above is the coverage of record until then. The
`**Umbrella item:**` marker keeps this plan outside the receipt requirement
rather than pretending a receipt exists.
