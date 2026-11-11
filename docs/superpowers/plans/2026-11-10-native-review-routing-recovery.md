---
status: draft
---

# Native review-routing recovery implementation plan

**BacklogItem:** BI-C51C266A
**Workroom:** WC-EC8AF261
**Design:** [corrective design](../specs/2026-11-10-native-review-routing-recovery-design.md)
**Status:** proposed; no implementation admission or plan-coverage receipt yet

For agentic workers: execute one independently reviewable backlog item at a time. Use the DPF test-first, local merged-code verification and protected PR procedures. Do not edit code before normal implementation admission and exact scope claims.

## Backlog coverage

Decision proposed: **atomic**. BI-C51C266A owns DEL-ROUTING-1: a reliable native independent-review dispatch path with truthful failure and carrier-search results. Policy selection, packet parity, diagnostic detail and carrier discovery jointly establish whether that one path works; they are internal sequencing rather than separately accepted features. Original AC-1 through AC-4 remain required. There is no new child or duplicate build.

Coverage receipt: **not recorded**. The real independent scope baseline, immutable pushed plan identity and four-way mapping must be accepted by `record_plan_backlog_coverage` before implementation. This section supplies no authority by itself.

| Deliverable | Requirement refs | Contract refs | Flow refs | Verification refs |
| --- | --- | --- | --- | --- |
| DEL-ROUTING-1 / BI-C51C266A | AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8 | CONTRACT-POLICY, CONTRACT-ARTIFACT, CONTRACT-CARRIER | FLOW-ISSUE, FLOW-ADMIT, FLOW-RECORD | VERIFY-ROUTES, VERIFY-PARITY, VERIFY-CARRIER, VERIFY-LIVE |

CONTRACT-POLICY is the existing `decisionForIndependentReview` plus authoritative `loadPlanBaselinePrerequisite`. CONTRACT-ARTIFACT is the native accepted revision id/digest and exact server-issued packet. CONTRACT-CARRIER is the existing OAuth, continuity, tool and grant intersection with an explicit search-completeness result.

FLOW-ISSUE resolves only currently owed independent requests. FLOW-ADMIT recomputes through the same native issuer and compares immutable packet identity. FLOW-RECORD records the genuine dispatch/refusal/incomplete result with existing cooldown and idempotency.

## Phase 0: finish authoring and obtain legitimate authority

Publish this design and plan from the admitted dedicated branch, preserve existing native artifacts and resolve the shared documentation-index claim with its owner. Run documentation checks. Obtain the current server-issued independent approval request, submit it unchanged once, and retain its real receipt. Record source-bound research and correct scope disposition through the governing writer; IF-D23604E098C2079C stays open until a legitimate resolution is accepted.

Record plan coverage against the resulting own baseline and claim implementation plus the exact code paths. Reconcile any current native writer before switching the source author. No parallel source author, default-active brief write, fabricated review or guard override is allowed.

## Phase 1: reproduce and repair prerequisite selection

Touch `apps/web/lib/backlog/initiative-readiness/build-studio-owed-routes.ts` and its existing test only after admission. VERIFY-ROUTES first reproduces zero routes for the actual sole-PLAN_REQUIRED / missing design-checklist baseline case. Reuse shared policy through an injected authoritative prerequisite port. Test explicit null, read failure, existing/inherited baseline, unrelated/product-owned prerequisite, resolved coverage, allowed decision and changed design digest. Preserve native artifact binding and current independent reviewer selection.

## Phase 2: preserve issuer/admission parity

Touch existing `apps/web/lib/mcp/independent-review-request.test.ts` and `independent-review-packet-roundtrip.test.ts`. VERIFY-PARITY exercises both actual native call paths and production-default prerequisite wiring, not only identical mocks. Confirm both callers already use the shared resolver; retain fail-closed room, actor, source and packet checks. A stale artifact or request must fail. No production admission refactor is planned without a new source-bound failing counterexample and explicit scope amendment.

## Phase 3: retain useful refusal evidence

Touch `apps/web/lib/backlog/initiative-readiness/server-reviewer-dispatch.ts` and its test. Verify the specific governed refusal sentence survives with the machine code stored separately. Use the existing activity payload with local typed variants, bounded redacted detail and old-record compatibility. Preserve design-stage reviewer recovery, cooldown, backoff, collapse and idempotency.

## Phase 4: search carriers honestly

Touch `apps/web/lib/mcp/standing-connection.ts` and its test. VERIFY-CARRIER covers the only usable connection beyond the initial page, duplicate rows across preferred/general searches, equal timestamps, rotation, credentials-registration exclusions, a fully rejected or empty complete set and an exhausted search budget.

Use deterministic bounded pagination and deduplication. Return admitted, exhaustive absence or incomplete search explicitly. Adapt the dispatcher in Phase 3 to preserve that distinction. Audit every existing selector caller before changing its return shape. Keep `isCurrentOAuthExecutionAuthority`, `tokenAdmitsTool`, human capabilities and existing credentials exclusions unchanged. No new profile registry, provider or grant is involved.

## Phase 5: verify and deliver the full original outcome

Update `docs/architecture/failure-analysis-and-recovery.md` in the implementation change after its exact path claim succeeds. Run affected route, admission, packet, dispatcher and selector suites plus the affected package typecheck. Retain meaningful red/green evidence, production-default wiring checks and negative authorization cases.

Complete independent review, the protected exact-source gate, DCO PR and merge queue. Under normal release admission, VERIFY-LIVE observes a genuine native `dispatched` event and independent `feature-build-revision` receipt, then the consumer's actual baseline/coverage/admission. AC-4 remains unrun until those records exist. No source-only result closes the original four criteria.

## Scope and risk controls

The anticipated implementation surface is the existing route module/test, dispatcher module/test, selector module/test, admission test, packet roundtrip test and architecture paragraph. This plan admits no code path yet. The two current document claims permit authoring only.

The code change is one concern: correct native review dispatch. Reuse existing shared policy and current source protections. New substrate, generalized executor lanes, runtime/container operations, witness privileges, threshold changes, old review replay, receipt rewriting and the separate sandbox/diagnosis repairs are excluded.

Rollback through a protected revert; preserve immutable receipts and artifact history. Infrastructure failures remain inconclusive, and a changed plan requires an exact-current review rather than reuse of a stale pass.
