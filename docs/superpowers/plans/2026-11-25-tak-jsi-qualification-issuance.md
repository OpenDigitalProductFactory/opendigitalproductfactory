---
title: TAK-JSI qualification issuance and revalidation implementation plan
status: draft
backlogItem: BI-6DB95601
---

# TAK-JSI qualification issuance and revalidation implementation plan

BI-6DB95601 · WC-E5FF5593

This plan sequences the independently approved design. Begin implementation only after the exact plan has governed coverage and independent plan review, the dependency hold clears, and the implementation claim is admitted.

## Scope and evidence

- [Approved design](../specs/2026-11-25-tak-jsi-qualification-issuance-design.md) at `15a47a167aa506282974abec2726bd66aeabe65b`, merged unchanged in PR #7204.
- Research receipt: `initiative-5d1ee6ef-39b2-4ca3-883b-9e8036f19c71`.
- Dependency-disposition receipt: `initiative-a1ed562b-8011-490d-a794-b2ee481668c1` is a hold, not dependency acceptance.
- Governing disposition: WWMD `DI-4FC59E7D4705` narrowed the criteria and local conformance prerequisites. The three parent items remain deferred. The five-profile outcome on BI-3E99ACFA follows the real issuer. BI-514826D3 continues to block consequential policy-driven WorkPattern activation.
- Before Red, verify both narrow prerequisites against governed evidence, resolve the Workroom edit scope and its guard/test-impact contract, and obtain independent plan review. If the carrier or reader has already landed under BI-FE3857C8, extend it in place. If its evidence used a fixture only, verify the same contract on the canonical carrier before admitting issuance for use. Do not build a second carrier to resolve a dependency loop.

### Semantic-review carry-forward

Native spec receipt `cmwvxwbhz1nyf0erul61bb9du` passed with no blocking findings. Make the following explicit in the reviewed plan before source implementation:

- No rollout cohort may act as evidence of absence. Confirm no scheme through the server-owned activity policy. A rollout flag is a deny-only deployment fence, never a source of an exempt decision.
- `required-unavailable` must carry a shared closed reason distinguishing absent required scheme, missing compatible record, unresolved subject, unresolved profile and missing serving support. Source read failures stay `unknown` with a typed source reason. The read and operator contracts must map these to different accountable actions.
- Import `canonicalJson` from `@dpf/integration-shared/canonical-json` and hash UTF-8 canonical bytes with SHA-256 under a versioned normalized profile contract. Pin a known digest vector and run it through issuance, impact, binding and rollback. Do not write a second serializer.
- Use canonical named enum types for JSI record state and decision/outcome. Give storage-to-wire conversion one typed boundary. Use separate closed types for record lifecycle and disposition.
- The plan reviewer verifies the 20% consolidation allocation and tests before implementation. Record actual effort at completion. Revalidate the approved plan against current code and dependency evidence if either narrows, changes ownership or is superseded before the implementation claim. Unresolved dependencies remain with the accountable portfolio owner, not the runtime.

## Backlog coverage

BI-6DB95601 owns one governed delivery. Its issuer, revalidation, and binding are sequencing phases, not independent authority surfaces. The issuer may be exercised before consequential activation, but the item cannot be closed on issuance alone. BI-FDD72190 and BI-FE3857C8 are mapped prerequisites, not transferred scope. Their independently governed acceptance remains on their own items. BI-687E7D81 owns the S5 session toolset and launcher proof, and BI-514826D3 retains the policy-warrant boundary. Record immutable coverage and review evidence on WC-E5FF5593 against this plan blob. Coverage does not satisfy the implementation hold.

| Phase key | Ownership and dependencies | Requirements | Contracts | Flow | Verification |
| --- | --- | --- | --- | --- | --- |
| pilot-criteria | BI-FDD72190, prerequisite | OBJ-ISSUE, AC-ISSUE | TAK-JSI scheme and assessment | FLOW-PILOT-CRITERIA | AC-ISSUE, VERIFY-PILOT-CRITERIA |
| local-conformance | BI-FE3857C8, prerequisite | OBJ-ISSUE, OBJ-CONSUME, AC-ISSUE, AC-S5 | TAK-JSI carrier and shared eligibility | FLOW-LOCAL-CONFORMANCE | AC-ISSUE, AC-S5, VERIFY-LOCAL-CONFORMANCE |
| issue | BI-6DB95601, after pilot-criteria and local-conformance | OBJ-ISSUE, AC-ISSUE | TAK-JSI scheme and assessment | FLOW-ISSUE | AC-ISSUE, VERIFY-ISSUE |
| revalidate-bind | BI-6DB95601, after issue. Consequential activation also awaits BI-514826D3. | OBJ-REVALIDATE, OBJ-ACTIVATE, AC-IMPACT, AC-SERIAL, AC-TAK, AC-ROLLBACK, AC-OPERATOR, AC-CONSOLIDATE | WorkPattern qualification interlock | FLOW-REVALIDATE-BIND | AC-IMPACT, AC-SERIAL, AC-TAK, AC-ROLLBACK, AC-OPERATOR, AC-CONSOLIDATE, VERIFY-REVALIDATE-BIND |
| consume | BI-6DB95601 qualification contract proof after issue, joined with separate BI-687E7D81 session delivery | OBJ-CONSUME, AC-S5 | Shared eligibility and existing launch projection | FLOW-S5 | AC-S5, VERIFY-S5 |

## Order and proof

### FLOW-PILOT-CRITERIA

Confirm the two existing S5 job/activity assignments and the declared human scheme authority. BI-FDD72190 owns approved versioned schemes, criteria, critical failures, validity, evidence requirements and two separately assessed exact profiles. VERIFY-PILOT-CRITERIA records the adjudicated assessment evidence for each job and proves that a subject's self-assessment, missing criteria and legacy certification probes cannot satisfy the scheme.

### FLOW-LOCAL-CONFORMANCE

BI-FE3857C8 owns the local exact-profile carrier/status/lookup/evidence conformance. Use the proposed canonical carrier in the existing DB schema family and the JSI seam in `apps/web/lib/work-management/coordinator-eligibility.ts`; no S5 data store. VERIFY-LOCAL-CONFORMANCE tests the scheme applicability and positive eligibility boundaries separately. Cover absent scheme, required-but-no-record, malformed typed state, unreadable dependencies, expired/revoked/suspended records, overlapping coverage, and a compatible profile with an otherwise active record. Establish whether its accepted output includes an additive carrier/reader or only conformance evidence against the same intended contract, and record the exact source to reuse before authorizing BI-6DB95601 code.

### FLOW-ISSUE

Start with Red for subject/scheme/version and authorization failures, then exact issuance, idempotency and evidence races. Use the existing GAID resolution and `apps/web/lib/identity/aidoc-resolver.ts` profile material, without editing `getAgentGaidMap`. Reconcile any fulfilled carrier portion from BI-FE3857C8 before adding schema. Persist only missing additive columns/relations required by the approved design, with data-steward reviewed lifecycle and evidence links. Use a single governed writer and consistent resolver for the exact digest-bound profile and job assessment. VERIFY-ISSUE covers authenticated independent issuer, wrong subject/context, expired evidence, forbidden self-issuance, scope ambiguity, audit atomicity, retry replay and regenerated Prisma types. Rehearse populated and clean DB migration before enabling.

### FLOW-REVALIDATE-BIND

Extend `apps/web/lib/tak/work-pattern-activation.ts`, `work-pattern-activation-persistence.ts`, `work-pattern-binding-reader.ts` and `work-pattern-read-model.ts`. Allocate 5 of 20 planning units (25%) to consolidation: 2 for shared operating-profile material and diff, 2 for shared activation and rollback decision paths, and 1 for shared read and transition projection. The remaining 15 cover issuance and data (6), interlock and projection (6), and governed integration verification (3). Verify the actual consolidation share is at least 20% at closure against AC-CONSOLIDATE. Use the existing serializable activation boundary, dependency/freshness fence and decision/effect receipts. Do not infer a policy warrant from a qualification or waived dependency. Hold consequential policy-driven activation until BI-514826D3 or an authorized alternative explicitly covers the action. VERIFY-REVALIDATE-BIND includes widened scope refusal, one exact impact result per candidate, no-impact retention with unchanged coverage, concurrent mutation/issuance/activation, target assessment, revoked evidence, rejected impact, rollback to stale profile and an operator view showing outcome and next action. Record real TAK effect and refusal receipts and confirm UI in the canonical nonprod runtime at narrow/wide sizes and light/dark themes.

### FLOW-S5

Expose verified outcomes to the existing coordinator input and the S5 composer. Launch and invocation must both narrow against current qualification, binding, job/grants and stage. Before the issuer ships, integrate confirmed no-scheme and closed required/unknown paths only. VERIFY-S5 uses two real coworkers in the same Workroom and stage, signed-off schemes and independently accepted assessments, one positive action each, a tool withheld on one side due specifically to JSI, revocation/expiry refusal at invocation and no handler effect, with client hooks disabled. A fixtures-only run cannot establish positive pilot acceptance.

## Recovery

Do not loosen constraints to restore a pilot. Hold the affected lane or use independently authorized no-scheme activity only. Drain/revoke old sessions before switching a governed scope. If rollout fails, disable qualified admission and consequential activation, preserve evidence/history, and restore a binding only after an independent fresh-compatibility check. Never roll back into a checkless reader while the policy still requires qualification.
