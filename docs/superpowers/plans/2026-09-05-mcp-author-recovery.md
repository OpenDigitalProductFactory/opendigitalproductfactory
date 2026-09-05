---
status: draft
---

# External-author MCP recovery implementation plan

Backlog BI-CF118B6D; Workroom WC-0B137E7F; branch fix/mcp-author-recovery.
Canonical design: [recovery design](../specs/2026-09-05-mcp-author-recovery-design.md).

Execute one independently reviewable BI, branch and PR. Use dpf-tdd for the failing boundary tests, dpf-local-merge-ci-before-push for verification and dpf-pr-with-dco for handoff. This plan does not authorize implementation before independent design/plan review and validated coverage.

## Operator-directed source preparation, 2026-09-05

The operator explicitly instructed this task to "bypass it and fix it" after the review recovery workflow stalled. This authorizes preparing a reviewable source patch now; it does not supply independent review receipts, grant reviewer authority, or authorize bypassing PR, DCO, test or deployment controls. Research/spec/plan review and coverage remain outstanding, not passed. The server accepted the four source/test path claims for the initial identity-repair correction. This first patch corrects both incomplete adoption instructions and adds regression cases; it does not resolve the inbox or reviewer dispatch failure or complete the wider recovery contract.

## Backlog coverage

Proposed decision: atomic. Receipt pending validation against the approved scope baseline and this immutable plan. All steps implement one recovery contract across its existing writers and readers. Shipping the projector without its adoption, readiness and Workroom consumers would preserve contradictory next actions. They therefore share one acceptance boundary and one revert. No independent metrics, pagination or hook work is included.

| Deliverable | Backlog | Requirements | Contract | Flow | Verification |
| --- | --- | --- | --- | --- | --- |
| recovery-contract | BI-CF118B6D | OBJ-MCP-RECOVERY, OBJ-MCP-PROCESS | CT-MCP-RECOVERY | FLOW-MCP-AUTHOR | AC-MCP-RECOVERY-1, AC-MCP-RECOVERY-2, AC-MCP-RECOVERY-3, AC-MCP-RECOVERY-4, AC-MCP-RECOVERY-5, AC-MCP-RECOVERY-6, AC-MCP-RECOVERY-7 |

## 1. Resolve exact impact and establish failing behavior

### Transport observations and rejected hypothesis, 2026-09-05

The governed immutable reader failed after two transport attempts while direct container reads returned the expected blob. One isolated process using the shipped Turbopack runtime and bundled Undici failed with `UND_ERR_CONNECT_TIMEOUT` after 10,515 ms. Subsequent side-by-side native and bundled reads both succeeded, and a bundled-only control succeeded in 354 ms. The portal image also changed during the investigation. These observations do not establish bundling as the cause; the proposed externalization change was withdrawn. No live files, credentials, approvals or verification controls were changed by the probes.

Preserve safe transport cause codes in the existing provider failure projection, without exception text or arbitrary codes. The live governed read subsequently succeeded without deploying this branch. Record that as recovered runtime behavior, not proof of a fix from this branch. Approval visibility, reviewer lifecycle, and recurrent provider-read failures remain acceptance cases; DNS thread-pool starvation is a separately reported hypothesis requiring correlated evidence before a transport redesign.

Claim exact implementation paths and consume every testImpact and guardObligation from the resulting Workroom changeImpactContract. The present docs-only contract has neither and does not cover runtime code. Resolve missing impact guidance before proceeding; use exhaustive checks while unresolved.

Grounded candidate files under apps/web/lib: backlog/initiative-readiness/readiness-guidance.ts, canonical-artifact-discovery.ts and evaluate.ts in the same directory; tak/initiative-readiness-tool-grants.ts; work-capsules/governed-work-claim.ts; work-capsules/mcp-handlers.ts; mcp/packs/work-capsules-pack.ts; planning/plan-backlog-coverage.ts. Use their associated tests and existing workroom read/action adapters. Inspect the current registry and consumer graph before adding a helper.

Add failing tests for absent base/head and preservation of valid identity; read/transition disagreement; already signed artifacts; unknown tool versus unavailable grant; missing reviewer, inaccessible artifact, stale head and transient provider failure. For the process regression, feed the coverage refusal's prescribed readiness call into the actual policy evaluator for doc-only, fix and feature profiles, including a documentation parent with feature children. The regression must detect an allowed/no-route dead end rather than asserting a string.

## 2. Consolidate recovery in the existing policy boundary

Refactor duplicate ARTIFACT_AUTHOR_REQUIRED advice into one existing recovery projector. Reuse profile selection and existing result primitives; do not maintain a parallel profile table. Return exact missing identity fields, retained valid values and a repair packet matching the actual adoption schema. Missing identity is not provider failure, and valid signatures do not need rewriting.

Make coverage remediation profile-aware. If the selected parent cannot create the required baseline through the suggested route, return a precise parent-binding requirement and the supported correction instead of promising nonexistent reviewerRoutes. Preserve baseline enforcement and provenance; do not silently reclassify documentation or widen author grants. Resolve the actual supported parent-binding rule against existing governance before implementation; revise the design if a policy change is required.

## 3. Carry the contract through all readers

Project prerequisite blockers separately from reviewer execution. Reuse reviewerRoutes and TaskRun lifecycle; cite real pending dispatch ids, expose terminal outcomes and distinguish unknown availability from confirmed reviewer absence. Apply the same projection to readiness, get_workroom and Workroom listing. Keep new fields additive and test legacy consumers. Do not create a status ledger or a duplicate listing tool.

Clarify supported authoring/implementation parent binding in the existing planning instructions and skill. Include the objective/acceptance manifest prerequisite identified during this review so authors validate it before dispatch. Use the existing manifest parser instead of a second format checker. Hook label/discovery ranking improvements remain separate work.

## 4. Verify and deliver

Run affected tests in a compile-ready worktree or the canonical shared verification environment, never treating missing dependencies as product failure. The current worktree is source-only. Claim the appropriate shared nonproduction lease for runtime-bound checks. Test the complete external-author journey with distinct author/reviewer identities, immutable provider reads and persisted approval readback; mocks must not be the only authority test.

Verify AC-MCP-RECOVERY-1 through AC-MCP-RECOVERY-7 and operator-readable agreement across list/detail/readiness. Capture client/version, protocol, source SHA and tier with the evidence. Migration is not applicable unless discovery proves a schema change necessary; then revise scope first. Run fast source checks, canonical runtime acceptance and required cloud merge-queue checks. Publish DCO-signed commits, open the PR only when ready, use mechanical PR health and the merge queue. Record acceptance and update BI status only after it passes.

## Refactoring, risks and rollback

Allocate 20–30% of effort to removing duplicate guidance, deriving recovery from existing profile policy and unifying reader projections. Measure definitions removed and consumers verified; formatting is not evidence.

Risks are authority expansion, inconsistent state, stale reviewer identity and legacy response breakage. Preserve negative authorization tests and immutable version checks. Revert the scoped projector and adapters together without deleting receipts, changing existing Workroom identities or disabling governance. No new database model, orchestrator or migration is proposed.
