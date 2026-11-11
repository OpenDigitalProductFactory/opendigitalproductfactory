---
status: draft
---

# Native independent-review routing recovery

**BacklogItem:** BI-C51C266A
**Workroom:** WC-EC8AF261
**Status:** proposed corrective repair design; research disposition, implementation coverage and admission pending
**Source baseline:** `41afd6e6bb5bce14b3fd84068cdaac5a2e930402`

## Scope

**OBJ-1:** Build Studio requests only the independent reviews currently owed by a build, admits the same immutable packet it issued, and reports why a request could not proceed without hiding valid carrier connections.

| ID | Objectives | Acceptance criterion |
| --- | --- | --- |
| AC-1 | OBJ-1 | The room-recorded refusal names the guard's denial message, not only `independent_review_request_denied`. |
| AC-2 | OBJ-1 | For a Build Studio room in plan with a live carrier connection, the dispatcher's packet equals a packet the guard issues, tested with both sides on the same current source. |
| AC-3 | OBJ-1 | `no-author-connection` is recorded only when no eligible connection of the build's creator admits `request_coworker`; otherwise the selector finds it. An incomplete search never proves absence. |
| AC-4 | OBJ-1 | On the live install, a Build Studio room records `dispatched` and an independent reviewer records a genuine `feature-build-revision` receipt. |
| AC-5 | OBJ-1 | A sole missing `PLAN_REQUIRED` with an authoritative missing design-checklist scope baseline issues the existing spec-approval prerequisite, bound to the accepted native design revision. Explicit null, existing baseline, resolved coverage, unrelated prerequisites and allowed decisions do not revive that prerequisite. |
| AC-6 | OBJ-1 | Carrier search has stable ordering, deduplicates candidates, and distinguishes admitted, exhaustively unavailable and scan-incomplete results. Existing credential-client exclusions, consent, continuity, token, tenant, tool and grant checks remain enforced. |
| AC-7 | OBJ-1 | A changed artifact cannot reuse a stale packet or receive approval from a review of different bytes. Tests cover production-default wiring as well as injected ports; no caller manufactures packets, baselines or review verdicts. |
| AC-9 | OBJ-1 | A genuine author research failure on the current accepted native design reaches the existing bounded author-correction loop with authenticated receipt, artifact id/digest and stable finding provenance. Stale, wrong-author/item or unreadable evidence cannot trigger mutation; duplicate/concurrent ticks cannot create a second correction or reset limits. Independent review remains distinct and stale plan approval receives no credit. |
| AC-8 | OBJ-1 | The correction adds no executor-profile registry, generalized second lane, provider, grant, database schema, privileged actuator or runtime-proof writer. Existing shared policy and resolver remain canonical. |

AC-1 through AC-4 retain the original item's outcome. AC-3 makes the original absence claim precise for rotated credentials: the existing OAuth authority validator, rather than a new client-side expiry rule, decides whether a candidate remains usable.

## Current evidence and existing substrate

The source-only reproduction executed the actual committed modules at `4fff0a44d8b957e479a1d17379eab3041c2e2432` through injected database and dispatch ports. The three relevant modules have identical contents at this design's newer baseline:

| Module | Observed blob | Result |
| --- | --- | --- |
| `apps/web/lib/backlog/initiative-readiness/build-studio-owed-routes.ts` | `be818a2dc8b5252de5b360767b74e08689ce429f` | Sole `PLAN_REQUIRED` returns an empty route list without calling reviewer recovery. |
| `apps/web/lib/backlog/initiative-readiness/design-phase-recovery.ts` | `4caa5d653d4eb9ad4cf13dd102fc0a35656aedc0` | Existing `decisionForIndependentReview` selects the explicit missing design-checklist baseline prerequisite. |
| `apps/web/lib/backlog/initiative-readiness/plan-baseline-prerequisite.ts` | `e04fb04e126e898ae091f1ac0e371d254ee68817` | Existing loader reads full own/inherited baseline history and distinguishes a legitimate missing baseline. |

Positive and negative controls exercised direct spec-review routing, authoritative explicit-null suppression and an allowed decision that does not replay a review. This proves a source counterexample and policy reuse opportunity. It does not prove a repaired candidate, provider execution or runtime acceptance.

The current open reproduction is BI-F81AC573 / FB-46CF2877 / WC-BD9A0636, whose accepted native design is revision `cmwapb2yw131i01p0qs8pnpuy`, digest `e8edbba6dc55f97bc9774b969d0dca262f268b65d6b0b3ef2c815dfd7f45fc5f`. BI-6F2872FC is completed substrate, not a current open reproduction.

Both `server-reviewer-dispatch.ts` and `mcp/independent-review-request.ts` already call `buildStudioOwedRoutes` with the same Build Studio author identity. The established defect is inside that shared resolver: its direct `designPhaseReviewDecision` filter drops the prerequisite. Historical reports of packet mismatch remain hypotheses until an exact source-bound comparison identifies a mismatch.

`standing-connection.ts` currently takes the newest ten user rows before preference ordering and eligibility checks. A usable older connection can therefore be hidden. Preserve its existing BI-9CCB88C4 exclusion of credentials registrations for `request_coworker`; ordinary credentials use by other tools remains unchanged. Preserve the current design-stage reviewer recovery in `server-reviewer-dispatch.ts`.

The existing profession rule is [design review gates](../../professions/build-studio/wiki/design-review-gates.md). The historical `2026-10-02-build-studio-large-lane-independent-reviews-design.md` path cited by native research is absent from tracked current source. This corrective document does not recreate or backdate an assumed approval history.

## Design

### One policy and one native issuer

Keep `buildStudioOwedRoutes` as the shared issuer for dispatch and request admission. Replace its direct filter with `decisionForIndependentReview`, passing the authoritative live baseline prerequisite through an injected port. Reuse `loadPlanBaselinePrerequisite`; do not infer absence from a recent activity page, copy another item's baseline, or duplicate policy predicates.

An explicit null is authoritative. A failed prerequisite read produces an unavailable result and holds dispatch; it is not a missing baseline or an allowed transition. Existing independent review obligations retain their current policy ordering. The native dispatch context continues to bind the accepted `feature-build-revision` id and stored bare-hex digest; a digest is never presented as a Git commit.

### Truthful refusal records

Preserve the specific governed message as display detail and keep its machine code separately in the existing activity payload. Use a local typed discriminated payload contract with stable reason codes, bounded redacted detail and backward-compatible handling of old records. Keep cooldown, backoff, collapsing records and request idempotency unchanged. No new event store, registry or database enum is needed.

### Complete or explicitly incomplete carrier search

Preserve preferred-carrier precedence while using stable cursor pagination and a deterministic timestamp/id tie-break. Deduplicate by token-row identity across preferred and general searches. Keep the existing OAuth authority and tool-admission validators as the final eligibility checks, including rotation and continuity semantics.

Return one of three explicit outcomes: admitted connection; exhaustive no-admitted-connection after a proven end; or scan-incomplete with a safe continuation/remedy when the resource budget is reached. A bounded page or nonempty rejection summary never proves there is no valid connection. A genuinely empty complete set is exhaustive absence. Do not place credentials, tokens or raw provider data in diagnostics.

### Bounded author-research correction

This is an explicit scope amendment to the same BI and native build, retaining the original four criteria. BI-3E57890E delivered the three independent design/spec/architecture failure gates; its current filter matches that historical scope. Author-research failure is an additional cause: `independent-design-review-revision.ts` ignores research, and the Plan resumer invokes only that consumer before plan review. Own IF-D236 and the distinct reported BI-E8839795/FB-CBF3E8C3 demonstrate blocked consumers; their original artifacts and receipts remain separate. The bounded overlap assessment found no exact live research-correction carrier.

Decision DI-67D2B37519D1 compared an author-research adapter within the existing revision orchestration against a separate worker/schedule. The former was selected with high confidence, autonomy eligibility and no conflict or blockers; Single Source of Truth and Ground New Work In Existing Platform were the strongest contributors. The accepted choice and workroom pointer are recorded. This selects a design, not implementation admission.

Keep the existing independent gate contract. Introduce an explicitly attributed author-research input to the same bounded native correction orchestration, using genuine current-artifact receipt and finding provenance. Validate item, accepted revision id, digest, authenticated author and finding identity before invoking mutation. Read failure, missing provenance, wrong item/author, superseded revision or digest mismatch holds correction without inventing a verdict. Preserve a single correction owner and durable idempotency for duplicate/concurrent resume, actual executed round accounting, existing capacity deferral and budget/exhaustion escalation. Do not create a second worker, schedule, store, provider or reset allowance.

`dispatchDesignReviewFixLoop` currently treats a supplied failing review as independent and enables the internal Plan design-write path. Represent author research separately when reusing that path: never label author findings independent, expose the internal context flag through MCP, or forge reviewer identity. Accepted correction must create a real new native artifact, regenerate its plan through the existing path, and leave research resolution and required independent re-review to their actual writers. Old plan PASS remains stale.

Add behavior tests for current/stale revision and digest, author/independent attribution, stable finding provenance, unreadable evidence, duplicate/concurrent ticks, deferred capacity and exhausted rounds. Preserve all existing independent three-gate regressions. Anticipated additional existing paths are the revision orchestration and Plan resumer modules/tests, plus ideate orchestration/test only where needed for truthful input attribution. These paths are not yet claimed or admitted.

### Artifact and source integrity

The client-authored nine-task plan revision `cmwbbbslz4l0k01p0mn6pf949`, digest `17f8a4920dcf9234089554f0308a00f4232c13a893d13875e0a3a9ff74402262`, is preparation, not independently reviewed implementation authority. The retained earlier plan-review pass covers the old native ten-task plan only. Use the current repair readiness route for source-bound research and implementation-parent coverage. Completion still requires the independently established objective baseline, acceptance and reconciliation; the author supplies none of those verdicts.

Native design revision `cmwbav63t4hs301p0jihevnzh` still contains the unapproved registry requirement. Open author-research finding IF-D23604E098C2079C is not resolved by authoring this proposal. Record a resolution only after the governing writer validates the corrected scope and its immutable identity. Do not clear reviewer fields, impersonate native authors or treat a Plan-phase design-save no-op as a revision.

## Verification and delivery boundaries

The live readiness decision observed at 2026-11-11T04:37:57Z selects profile `fix`. Persisted native implementation decision IRD-095B7336230D is enforced, effective LARGE and denied by RESEARCH_REQUIRED fail plus PLAN_REQUIRED. Its current `planBaselinePrerequisite` is null because the loader only computes that prerequisite for an input-required planning decision. This is not a large-lane baseline waiver. After research disposition, re-read the actual prerequisite and use the existing missing design-checklist baseline fallback whenever owed. Never replace this conditional policy with either an unconditional Phase 0 review or a blanket no-baseline rule. At this stage it offers no independent design-spec request: author research is required, and implementation coverage belongs to the governed implementation parent. Completion separately retains the objective baseline, acceptance and reconciliation obligations. Do not invent an earlier review gate or treat this distinction as implementation approval.

BI-C51C266A is the atomic implementation parent for DEL-ROUTING-1 and AC-1 through AC-9. Its current canonical native plan is still the unreviewed client revision identified above. Record coverage against the actual accepted implementation plan and baseline through the normal writer; this document is not a coverage receipt. No code edits begin until the open research finding is legitimately disposed of, valid implementation-parent coverage, normal implementation admission and exact path claims succeed. The [earlier planning companion](../plans/2026-11-10-native-review-routing-recovery.md) retains drafting history; the ordered repair sequence below is canonical.

### Ordered repair deliverables

1. Bind the published current source to the existing workroom. Record named-ref reproduction, executed alternative-cause controls and the governing disposition of IF-D23604E098C2079C. Preserve the original native design and stale plan-review history. Do not manufacture a passing research receipt while its findings remain open.
2. Confirm the current implementation plan and parent coverage through the governed writer, then claim implementation and exact existing source/test paths. Reconcile any native author before changing the source author.
3. VERIFY-ROUTES: reproduce the sole-PLAN_REQUIRED counterexample in `build-studio-owed-routes.test.ts`, then repair its module using the shared policy and authoritative prerequisite. Test explicit null, unavailable reads, own/inherited baseline, resolved coverage, unrelated obligations, allowed decisions and changed immutable identity.
4. VERIFY-PARITY: exercise the actual issuer/admission and packet-roundtrip tests, including default wiring. Preserve both callers and fail-closed source, actor and packet checks. No admission refactor without an executed counterexample and explicit scope amendment.
5. VERIFY-RECORD: update `server-reviewer-dispatch.ts` and its test to preserve bounded specific denial detail alongside the machine code, retaining current recovery, cooldown and idempotency.
6. VERIFY-CARRIER: update `standing-connection.ts` and its test for deterministic pagination, deduplication, rotation, credentials exclusions, exhaustive absence and explicit incomplete scans. Audit existing callers before adapting the return contract.
7. VERIFY-AUTHOR: reproduce research failure being ignored, then extend the existing revision/Plan-resume orchestration as above. Prove actual accepted correction, no duplicate correction, unchanged limits and current-artifact review/plan obligations. No historical review replay.
8. Update the claimed architecture paragraph, run affected suites and package typecheck, obtain required independent implementation review, then complete exact-source gate, DCO PR and merge queue. VERIFY-LIVE requires normal deployment, genuine native dispatch and an independent feature-build-revision receipt. Record baseline, acceptance and outcome reconciliation before closure. No source-only pass closes AC-4.

The anticipated existing implementation paths and detailed test cases remain in the planning companion. They are not admitted by authoring these documents.

Tests must cover the live missing-baseline counterexample, authoritative null versus unavailable reads, existing/inherited baseline, resolved coverage, allowed decisions, product-owned/unrelated prerequisites, changed immutable artifacts, real default-port wiring, precise refusal payloads, candidate deduplication, stable pagination, rotation/credentials exclusions and incomplete scans. Use meaningful failing behavior tests before the correction, then affected suites and typechecks.

Protected publication requires the ordinary exact-source gate, DCO and merge queue. AC-4 requires a normal deployed runtime and genuine independently attributed native receipt. A passing source test, a saved artifact, a conversational response or an earlier review cannot substitute for it.

## Risks, rollback and exclusions

The selector is shared beyond Build Studio. Preserve its current public callers or introduce a compatible result adapter with explicit tests; do not silently turn an incomplete scan into null. Snapshot all relevant authorization and rotation checks in regression tests before refactoring.

Rollback is a protected source revert. Retain immutable artifact revisions, findings, receipts and dispatch history. Do not replay uncertain original reviews or fabricate fresh retirement evidence. No migration or destructive data operation is required.

BI-27519C1A remains related packet-parity evidence with its own history. Do not retire it without demonstrated coverage. The FB-46CF2877 seven-path sandbox repair, BI7 original work-in-progress, witness privilege proposal, E492 diagnosis repair and historical SUR-C457D1F6 are separate. Restored source enrollment after SUR-774AD7B6 is a prerequisite, not their acceptance.
