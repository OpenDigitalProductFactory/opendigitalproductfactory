---
status: draft
---

# Native independent-review routing recovery

**BacklogItem:** BI-C51C266A
**Workroom:** WC-EC8AF261
**Status:** proposed corrective design; independent approval and implementation admission pending
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

### Artifact and source integrity

The client-authored nine-task plan revision `cmwbbbslz4l0k01p0mn6pf949`, digest `17f8a4920dcf9234089554f0308a00f4232c13a893d13875e0a3a9ff74402262`, is preparation, not independently reviewed implementation authority. The retained earlier plan-review pass covers the old native ten-task plan only. This design and its repository plan require their own legitimate source-bound review and coverage.

Native design revision `cmwbav63t4hs301p0jihevnzh` still contains the unapproved registry requirement. Open author-research finding IF-D23604E098C2079C is not resolved by authoring this proposal. Record a resolution only after the governing writer validates the corrected scope and its immutable identity. Do not clear reviewer fields, impersonate native authors or treat a Plan-phase design-save no-op as a revision.

## Verification and delivery boundaries

The [implementation plan](../plans/2026-11-10-native-review-routing-recovery.md) gives one atomic BI with ordered internal phases. No code edits begin until independent design approval, valid plan coverage, normal implementation admission and exact path claims succeed.

Tests must cover the live missing-baseline counterexample, authoritative null versus unavailable reads, existing/inherited baseline, resolved coverage, allowed decisions, product-owned/unrelated prerequisites, changed immutable artifacts, real default-port wiring, precise refusal payloads, candidate deduplication, stable pagination, rotation/credentials exclusions and incomplete scans. Use meaningful failing behavior tests before the correction, then affected suites and typechecks.

Protected publication requires the ordinary exact-source gate, DCO and merge queue. AC-4 requires a normal deployed runtime and genuine independently attributed native receipt. A passing source test, a saved artifact, a conversational response or an earlier review cannot substitute for it.

## Risks, rollback and exclusions

The selector is shared beyond Build Studio. Preserve its current public callers or introduce a compatible result adapter with explicit tests; do not silently turn an incomplete scan into null. Snapshot all relevant authorization and rotation checks in regression tests before refactoring.

Rollback is a protected source revert. Retain immutable artifact revisions, findings, receipts and dispatch history. Do not replay uncertain original reviews or fabricate fresh retirement evidence. No migration or destructive data operation is required.

BI-27519C1A remains related packet-parity evidence with its own history. Do not retire it without demonstrated coverage. The FB-46CF2877 seven-path sandbox repair, BI7 original work-in-progress, witness privilege proposal, E492 diagnosis repair and historical SUR-C457D1F6 are separate. Restored source enrollment after SUR-774AD7B6 is a prerequisite, not their acceptance.
