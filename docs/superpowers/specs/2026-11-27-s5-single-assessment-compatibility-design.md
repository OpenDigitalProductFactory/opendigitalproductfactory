---
status: draft
---

# Exact S5 single-assessment compatibility

**Status:** proposed design, not independently approved or implementation-admitted.
**Backlog:** BI-5EF67818. **Workroom:** WC-75CCF40B, delivery-large@1.0.0.
**Execution author:** this item's admitted Codex session. Independent policy and design approval remain separate.

## Outcome and authority boundary

An independently approved policy for BI-348CC53B can describe exactly one present spec-approval assessment and receive consistent, fail-closed treatment from the existing decoder, issuer, transaction admission and execution owners. This feature supplies compatibility, never policy approval or permission to dispatch an assessment.

The human directed implementation after the compatibility gap was identified. The coordinator explicitly excluded it from BI-AE2EF5E4 / issue7245's unverified-receipt repair scope. That item's original issuer owns baseline supersession correction. BI-B1A6A2BE / WC-807479F8 / PR7253 owns read_task_result transport; its implementation and tests are reused, not duplicated. A transport read never resolves an authorization denial by itself.

## Existing substrate and evidence

At main34e2d13f723cc6d080ea4ad01f5c59b0261f1335:

- mcp-task-reassessment-policy.ts:33–35 requires schema1, BI-285EF102, total2 and two requirements.
- mcp-task-reassessment-admission.ts:49–50 independently requires total2, two requirements and two original readbacks; line89 independently uses a two-task ceiling.
- mcp-task-reassessment-lineage.ts collects subject candidates but includes primary members by original gate/artifact keys. That scope alone cannot prove a subject-wide non-replenishable S5 allocation across changed artifact/policy families.
- mcp-task-review-reassessment.ts reads an independently approved immutable policy and revalidates original binding. Preparation, worker, authority, capture and writer reuse these contracts.
- Existing compatibility proofs bind actual transport, approval, worker and writer source identities. A new policy version cannot be declared supported from a liveness heartbeat or client-provided SHA.

Reuse the [original framework design](2026-10-16-original-initiative-review-settlement-design.md), existing TaskRun/TaskArtifact history, locks, generation fences, canonical JSON and receipt owners. No new table, ledger, tool, role, provider or authority store is proposed.

## Objectives

**OBJ-S5-SHAPE:** consistently validate the exact S5 single-requirement shape.
**OBJ-S5-BOUND:** retain current approval, identity, source and original-binding checks.
**OBJ-S5-ONE:** enforce one accepted assessment across every policy, family, key, reviewer and artifact variant without refund.
**OBJ-S5-LEGACY:** preserve existing BI285 v1 behavior and canonical digests.
**OBJ-S5-PROOF:** prove source and canonical compatibility without replaying historical work.

## Versioning decision

Option A, selected by the human on 2026-11-27: retain the exact v1 policy type/bytes/digests and add a closed schema2 policy for BI-348CC53B, spec-approval only, total1/per-requirement1. Old decoders reject its new fence. A shared validated shape contract replaces duplicated assumptions at issuer/admission/worker boundaries.

Option B: extend schema1 with a closed S5 subject variant. It keeps one version label but requires additional interpretation of old versus newly supported semantics across deployments.

Kernel consultation DI-9CEEEA881A93 returned recommendation null, usable=false, autonomyEligible=false: core/contextual retrieval was lexical-only. Diagnostic scores are not a verdict. The human subsequently selected the new closed version explicitly. This is owner direction, not a retroactive kernel verdict or independent design approval. Independent design approval remains required; do not repair the unrelated retrieval subsystem under this item.

## Proposed contract for selected Option A

CONTRACT-S5-POLICY: a single recognized versioned policy block, strict duplicate-free JSON, exact keys and bounded size. schema2 accepts only the S5 subject, one spec-approval requirement, total1, retain-unknown historical consumption, normal-recorded limits and originalReplay=false. No arbitrary subject, second gate or second requirement. Multiple/mixed recognized policy blocks refuse. Ordinary v1 fixtures keep their canonical parsed bytes and digest unchanged.

CONTRACT-S5-BINDING: the independently approved policy pins the exact original task id/digest and full original initiative binding using existing validated binding types: subject, gate, Workroom repository/branch/head, immutable artifact and expected subject baseline. Do not mint runnable policy data in this design. Known draft c2c1c7fc/c6e19122/baseline-e59e1165-b8b7-48d7-9653-92af8b67e367/original B0F1E9ECDA45/digest361e0b4d and later intake f582e07c/fbe0b8a are distinct observations. Only the original issuer's genuine supersession disposition and a current independently approved policy can choose the authorized target. No automatic substitution or rekey.

CONTRACT-S5-ONE: derive allocation scope server-side from validated schema2, not tool arguments. Extend the existing bounded exact-subject lineage inventory to include all accepted present assessments of S5 across artifact and authorization variants. Preserve legacy inventory semantics for v1. Validate every retained row; malformed, ambiguous or truncated inventory refuses, never becomes zero. Lock and revalidate through existing TaskRun/item lock order before insertion. Apply the shared policy total instead of literal2. Matching callers join the durable winner only when its exact identity matches; conflicting or consumed allocation refuses. Pending, working, failed, cancelled, uncertain and qualification failures all remain consumed. New baselines, policies, credentials, keys and reviewers cannot reset the subject total.

CONTRACT-S5-AUTHORITY: preserve current human/coworker scope intersection, organization, independent approved immutable policy baseline/operator evidence, source and original-result ownership/content checks. A genuine old receipt takes precedence. A missing original binding remains a refusal even after decoder compatibility or transport delivery. Historical UNKNOWN effects, counters, deadlines and budgets are immutable.

The human's code-implementation instruction, version selection and funding attribution are not authorization to consume a present assessment. Do not place those activity ids into an allowance-bearing policy as substitutes for exact assessment authorization. A future independently approved S5 policy must cite genuine separately scoped owner evidence for its exact assessment allowance; preparation-only evidence refuses. This compatibility design deliberately contains no executable policy block and cannot be used as S5's authorization artifact.

CONTRACT-S5-EXECUTION: retain the existing relation digest, transport restrictions, immutable read/writer tool boundary, runtime owner-version proof, execution capture and seals. Propagate the validated closed policy through preparation, worker and admission without caller-supplied authority. Verify support on actual owner bytes; unsupported/mixed runtime behavior refuses before inference. No unqualified compatibility assertion or unsafe rollback is permitted.

## Flow

FLOW-S5-PREP: actual independently approved policy -> authenticated original readback -> shared closed policy/binding validation -> current source/baseline checks -> existing qualification and packet construction.

FLOW-S5-ADMIT: exact packet -> bounded subject inventory -> existing ordered locks and fresh authority -> join/refuse/one reservation -> captured immutable execution root -> existing worker/writer seals. No historical task resume or direct author receipt.

FLOW-S5-VERIFY: source red/green and real PostgreSQL race proof -> typechecks/guards -> governed exact-source independent review and protected delivery -> canonical deployment/read-only or inert admitted qualification -> honest backlog disposition.

## Acceptance and verification

| ID | Objective | Required evidence |
| --- | --- | --- |
| AC-S5-1 | OBJ-S5-LEGACY | Existing v1 policy/digest/negative fixtures and admission/worker behavior unchanged. |
| AC-S5-2 | OBJ-S5-SHAPE | Approved chosen restricted shape agrees at decode, preparation and transaction admission; wrong subject/gate/count/version/duplicate/mixed block refuses. |
| AC-S5-3 | OBJ-S5-BOUND | Missing/stale policy approval, operator evidence, actor grants, room/source/artifact/baseline/original tuple and original-reader denial refuse before effects; old genuine receipt wins. |
| AC-S5-4 | OBJ-S5-ONE | Real PostgreSQL concurrent-family/key/reviewer races across same and changed artifacts/policy baselines admit at most one; every accepted outcome consumes it without refund; incomplete inventories refuse. |
| AC-S5-5 | OBJ-S5-BOUND, OBJ-S5-PROOF | Current worker/writer/capture/qualification/version proofs retain exact policy semantics; mixed/unsupported deployment and stale seals refuse; no hidden tools or old-task replay. |
| AC-S5-6 | OBJ-S5-PROOF | Affected tests, typechecks, independent source review, protected merge and actual canonical qualification show both restricted positive and refusal behavior using inert admitted fixtures. Unrun checks are not passes. |

## Risk, rollout and rollback

Authority expansion and double allocation are the primary hazards. Keep the new shape closed, preserve v1, centralize shared validation and make the subject-wide lock/count proof mandatory. This consolidation is at least one fifth of implementation. No feature activation is coupled to the code deploy: without independent policy approval and all original-binding/qualification prerequisites, S5 remains held.

Rollback disables new admission before reverting support. Preserve accepted allocations, policy history, execution roots and active fences; the existing safe-restore/compatibility owners may refuse an unsafe downgrade. No database edits or deletion of evidence. Existing policy and review controls remain mandatory.

## Unresolved prerequisites

- Independent design/plan approval. The human's versioning choice resolves direction only.
- Apply and verify the exact item funding binding: the human confirmed existing operator shared-platform attribution on 2026-11-27; no budget limits or allocation policy change is authorized. Profile-wide ownership remains distinct from this item-scoped attribution.
- Current original S5 baseline/issuer correction and separately approved S5 policy artifact, outside this compatibility item.
- Normal shared Mac reservation before bootstrap, tests or heavy gates. This draft ran no test, provider or runtime effect.
