---
status: draft
---

# E2 combined review and evidence implementation plan

Parent: BI-A3D63948; Workroom WC-557937A2; epic EP-DELIVERY-ENGINE-V2.
Approved design: [delivery engine v2](../specs/2026-11-12-delivery-engine-v2-design.md), source eab106028fed12b6952a22e30c9c4b84212aefc4, baseline baseline-dc72aedc-3873-462e-b675-b62e6eeaee15.
Plan admission: IRD-045616FB1BE4. This draft is not implementation admission, a coverage receipt or completed verification.

## Backlog coverage

Proposed decomposition: four independently shippable deliverables below, followed by parent acceptance. Live overlap lookup and child BI mapping are still required before coverage can be recorded. Do not assign unrelated E1/E3/E4/E5/E6 items merely because a reviewer narrative mentions them. Do not close the parent on classifier-only delivery.

| Deliverable | Requirement references | Contract references | Flow references | Verification references | Dependency |
|---|---|---|---|---|---|
| D1 shared classification | OBJ-E2-2, AC-E2-3 | CT-E2-CLASSIFICATION | FLOW-E2-EVIDENCE | VERIFY-E2-EVIDENCE | Reviewed predicate ownership |
| D2 trusted cloud evidence | OBJ-E2-2, OBJ-E2-3, AC-E2-4 | CT-E2-CLOUD-EVIDENCE, CT-E2-IMPORT-BOUNDS-V1 | FLOW-E2-EVIDENCE | VERIFY-E2-EVIDENCE | D1 classification contract |
| D3 combined professional review | OBJ-E2-1, AC-E2-1, AC-E2-2, AC-E2-7 | CT-E2-REVIEW, CT-E2-RUBRIC-V1, CT-E2-STAGE | FLOW-E2-REVIEW | VERIFY-E2-REVIEW | Independent rubric and trigger approval; D2 for cloud verification |
| D4 proportional admission and publication | OBJ-E2-3, OBJ-E2-4, AC-E2-5, AC-E2-6 | CT-E2-ROLLOUT, CT-E2-CLASSIFICATION | FLOW-E2-REVIEW, FLOW-E2-RELEASE | VERIFY-E2-REVIEW, VERIFY-E2-LIVE | D1–D3 qualified together |
| Parent served acceptance | OBJ-E2-1, OBJ-E2-2, OBJ-E2-3, OBJ-E2-4, AC-E2-8 | CT-E2-ROLLOUT | FLOW-E2-RELEASE | VERIFY-E2-LIVE | All four delivered; independent outcome reconciliation |

## Preconditions before code

1. Obtain live BI mappings for D1–D4 through existing backlog discovery, then immutable plan coverage and independent plan review. Each child owns one branch/PR and inherits only the current approved scope through the existing coverage contract.
2. Resolve the Enterprise Architect's three explicit implementation prerequisites: independent rubric approval, an accountable classifier reconciliation owner, and a trigger-predicate resolution process. The proposed owner is the existing release-service/evidence-importer role under the epic, with Enterprise Architect resolving cross-domain trigger disagreements. This is a proposal until the existing professional review records assent.
3. Bind the approved rubric to its version: each applicable section reports met/unmet/unverified/total; missing or contradictory required evidence is unverified, critical findings fail, important/minor findings remain advisory. Record approval before implementing this policy; do not mistake the design pass for that approval.
4. Resolve triggered sections from the complete immutable diff. Record positive and negative predicate reasons. Unknown classification holds the affected decision for its existing qualified owner; it cannot silently suppress a professional contribution or waive a production-integrity requirement.

## D1: one classification contract

Verified existing source entry points: `scripts/derived-artifacts-gate.mjs` exports `runtimeBoundFiles` and `evaluateLocalCiAdmission`; `scripts/pr-health.mjs` exports `isDocsOnlyFileSet` and uses it in PR health. Reuse these functions and existing convergence/data classifiers rather than adding another policy list. The implementation must choose a shared module importable by both server and scripts after inspecting package boundaries; module location is not yet approved.

First reproduce the four-script PR7105 disagreement as a behavior test. Separate verification lane from review sensitivity. Compare complete file inventories, policy revisions and unknown classifications across landing, health and evidence consumers. Add cases for docs, unit-tested libraries, routes, schema/migrations, install and security changes. Verify stale derived artifacts remain conservative. Run affected script tests, package/web typechecks when imports change, and gate-context obligations for the actual claimed paths.

## D2: trusted cloud evidence

Verified resolver: `apps/web/lib/change-review/failure-analysis-evidence.ts`, `resolveEvidenceByIds`, currently requires `local_integration_ci`. Extend its existing store-backed resolution with a distinct authenticated cloud evidence kind; never manufacture a lease or relabel cloud results as local CI. Inventory actual provider workflow/artifact readers and the ExternalEvidenceRecord producer before finalizing source paths or adding modules.

Implement the exact design bounds: one run attempt, 20 requests, 100 jobs, 20 artifact metadata records, 1 MiB metadata, eight result artifacts capped at 2 MiB compressed/8 MiB expanded each, 32 MiB aggregate, 60 seconds, 24-hour freshness. Complete inventory or unavailable: no partial receipt. Revalidate repository/workroom authority and immutable source at import, dispatch and publication. Bind trusted workflow revision, event, run attempt, source tree/diff and required jobs. For merge groups verify actual parents and source PR membership.

Tests must reject foreign room/repository, stale head, untrusted workflow, wrong parent, missing/skipped-required/failed job, revoked authority, oversized or expired artifacts, unsafe archive paths, nested archives, incomplete pagination and publication races. Preserve local/documentation/Build Studio behavior. Runtime/provider-bound qualification uses the canonical shared environment and its lease, not a hand-built image.

## D3: bounded professional contributions

Verified substrate: `apps/web/lib/change-review/semantic-change-review.ts` contains identity/receipt versions, prompt construction, parser and checkpoint restoration. Extend those contracts and existing background recovery. Discover current coworker routing and profession corpus retrieval before selecting adapters. Do not preload every profession's tools or corpus into one agent.

One immutable obligation selects only applicable UX, data, EA, security and release contributions, each with its own authorized context and citations. The assembler preserves section verdicts and never averages away blockers. Tests cover malformed/missing sections, unknown predicates, conflicting criteria, stale citations, duplicate notification, restart, unavailable provider and interrupted execution. Existing UNKNOWN tasks, explicit human holds, budgets and reviewer identity remain unchanged; publication repair must not create another inference attempt.

## D4: admission and publication

Verified inheritance substrate: `apps/web/lib/backlog/initiative-readiness/parent-scope-inheritance.ts` loads scope from current parent coverage; `shape-requirements.ts` owns shape requirements. Extend these paths only where existing inheritance does not satisfy AC-E2-6. Test changed scope/baseline, missing mappings and production-integrity obligations; never use inherited scope as a blanket authorization grant.

Inspect `apps/web/lib/build/failure-readiness-delivery-refresh.ts` and its reconciler together with the native status publisher. Separate reviewed, source-pushed, status-published and CI-observed states. Lost publication acknowledgement reuses the same verified verdict and source identity. Test pre-push review, post-push publication, unavailable publisher, changed head and mode/posture restrictions. No silent shadow-to-enforce flip, manually fabricated success status or protection change.

## Verification, release and rollback

For this planning diff the resolved impact contract requires doc-index and doc-impact freshness; it lists no testImpact or guardObligations. Runtime child claims must obtain their own impact contract; missing resolution expands verification, never grants exemption. Update affected failure-analysis, PR-health and delivery documentation with each child.

Run affected tests and typechecks, exact-source independent review and normal `pnpm land`; inspect required CI and unresolved findings. Runtime qualification and live advancement use canonical tools. Verify an ordinary served change plus each sensitive class, tampered evidence and provider unavailability for AC-E2-8. Source/unit passes do not count as live acceptance.

Rollback is a protected revert to conservative admission, preserving original tasks, receipts and evidence. Introduce versioned readers before producers; older consumers must reject unsupported evidence kinds. Keep repository protection until its replacement is qualified. Reverting code cannot retract external effects or settle unknown reviews.

## Remaining preparation

This draft still needs live child mappings, precise provider/corpus adapter paths, agreed shared-module location, recorded prerequisite decisions and an immutable coverage receipt. No execution phase starts until these are resolved and plan review passes.
