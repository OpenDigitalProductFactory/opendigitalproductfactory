---
title: Owned review authority diagnostics
status: draft
date: 2026-10-26
backlog:
  - BI-924ADA3A
  - BI-CAP-29F5787B
relates:
  - docs/superpowers/specs/2026-07-27-shared-change-reviewer-control-design.md
  - docs/superpowers/plans/2026-09-06-execution-reliability-visibility.md
---

# Owned review authority diagnostics

## Problem and reproduction

Review TR-GATE-BFA3C3E2316B18E35DDCAD42 in WC-09FF5D8D is held with
`submitting-authority-no-longer-valid`, an expired window and no verdict.
The aggregate Workroom observation does not establish its request digest or
provider settlement. The original owner must read any additional detail under
the existing content admission; another connection cannot supply that proof.

At a600b3626ea, `semantic-review-authority.ts` collapses human capability,
saved token/scope, OAuth continuity/consent, coworker grants and task ownership
checks to a boolean. The owner-bound recovery reader exposes node settlement
but cannot explain the failed authority check. OAuth continuity already supports
same-family access and refresh credentials. Token expiry is not a diagnosis.

## Boundary and chosen repair

Extend the existing shared reviewer control and owner-bound Tasks get/result
projection. Extract a structured authority inspection from the existing boolean
verifier; make execution's boolean derive from the same inspection. Return only
fixed stage/reason categories and fixed remedy text. A query exception yields
unavailable, never a claimed denial or permission to execute. Preserve execution
callers' fail-closed behavior and their distinction between unavailable and denied.

The existing signed-in task-detail endpoint also calls the same bounded reader
for the exact original human owner. Its existing task admission runs first.
An administrator reading another owner's task receives no added authority
diagnosis. This is the existing Tasks surface, not a new endpoint or tool, and
lets the original owner inspect safe recovery even when a client lacks protocol
Tasks methods. No client credential is read or substituted.

Reuse the immutable request loader for both worker and reader. Its stored artifact
must match task row, owner, room, gate key and exact saved request digest before
authority is inspected. Missing/malformed/conflicting packets yield unavailable;
never reconstruct a request digest from a gate key. The reader must enforce its
original owner check before packet, authority or detail queries.

The observation reports current authority, not a historical cause. A valid current
observation is not a retry authorization or proof of provider settlement. Existing
node limits, digest bindings, remediation freshness, deadlines and attempts remain.

## Alternatives

Re-signing a client alone does not establish the saved request's current authority.
An independent token checker would duplicate OAuth continuity and risk drift.
Raw error/credential disclosure would expand access. Reuse the live verifier and
existing admitted reader instead. No new table, tool, route, grant, credential,
provider request, review attempt or approval policy is required.

## Acceptance and implementation plan

1. Add failing source regressions for safe denied-stage readback and unavailable
   observation. Retain existing denial/continuity tests as behavioral parity checks.
2. Consolidate the verifier and immutable packet reader without changing admission.
   Add the bounded observation to the existing owner-admitted recovery projection.
3. Verify every denial stage, allowed OAuth continuity, unavailable storage,
   missing/mismatched packet and foreign owner. Assert no raw errors, actor/token
   identifiers or packet content leave the projection and no mutating path runs.
   Verify the signed-in task-detail owner path, unsigned refusal, unrelated family
   exclusion and administrator cross-owner exclusion through its route handler.
4. Run affected tests, both web TypeScript programs and governed publication gates.
   Deliver through a signed PR and protected queue; reuse valid evidence.
5. On the canonical served revision, the original admitted owner reads BFA3's actual
   current authority category and existing execution evidence. Record the result
   or exact remaining refusal. Do not dispatch, retry, grant or declare settlement.

BI-924ADA3A covers this single atomic repair. BI-CAP-3147C64B/PR6199 remains
delivered; BI-CAP-21C511CA owns transport exposure, BI-CAP-29F5787B owns its
separate result-readback delivery, and BI-C28A2C75 owns original MCP identity
recovery. Peer preview911 and review-reassessment4c source are unchanged.

## Compatibility and non-goals

Additive recovery metadata only, no migration. No historical rewrite, raw request
or provider output, grant widening, token replacement, credential handling,
automatic retry, new charge, successor, receipt or provider-account test. Full
thread acceptance remains open after this diagnostic repair ships.

## October 28 exact OAuth refusal diagnosis (BI-CAP-29F5787B)

Status: proposed design amendment, not implementation approval.

The existing deployed original-human task endpoint successfully returned the
recovery observation for TR-GATE-5C843E95A8E0E676CA4717ED at
2026-10-28T19:10:16.969Z. The independent authorized owner-session read reported
`oauth-authority-invalid`, `executionSettled: false`, and
`retryAuthorized: false`. Root recorded the attributed result in WC-9715CCE7
under command `cap29f-original-owner-read-20261028-191016`. This resolves the
missing access observation without another reader. It does not resolve authority
or execution settlement.

The supported account page lists connected applications, counts and last use,
but its subsequent owner-session read could not correlate the immutable review
with its original consent or continuity family. Another healthy Codex connection
does not prove that original authority is valid. The current fixed remedy cannot
distinguish missing/revoked client, missing continuation, or invalid consent, so
it cannot justify asking the operator to reconnect or revoke anything.

**OBJ-CAP29-AUTH:** Explain the exact current OAuth check that refuses an owned
review, using the existing verifier and admitted recovery reader, so the next
action follows evidence rather than a guessed sign-in remedy.

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-CAP29-1 | OBJ-CAP29-AUTH | The shared OAuth execution-authority predicate exposes fixed non-secret denial categories and retains its existing boolean result for every existing caller. |
| AC-CAP29-2 | OBJ-CAP29-AUTH | The original owner receives the exact current category through existing recovery readback; storage errors remain unavailable and foreign owners remain refused before inspection. |
| AC-CAP29-3 | OBJ-CAP29-AUTH | No token, client, family, consent or actor identifier, credential, raw error or provider output is disclosed. No lookup accepts a caller-selected credential. |
| AC-CAP29-4 | OBJ-CAP29-AUTH | Fixed guidance distinguishes authority-owner action from missing continuity evidence; it never claims a new login heals the original request or authorizes replacement. |
| AC-CAP29-5 | OBJ-CAP29-AUTH | Canonical owner read of the original task records the actual category or honest observation failure. Execution settlement, health verification and retry remain separate and unchanged. |

### Design grounding and overlap

Extend `apps/web/lib/auth/oauth-tokens.ts` at
`isCurrentOAuthExecutionAuthority`, then consume its structured result in
`semantic-review-authority.ts` and `semantic-review-recovery-readback.ts`.
Keep the existing boolean export as a wrapper over the same inspection. Do not
duplicate database predicates in a diagnostic-only path. Preserve short-circuit
order, current queries, thrown storage failures and all existing authority checks.
Use only a finite category for the first failed predicate; no connection label
or identifier is required to distinguish the refusal. Incomplete observation
must not become an actionable denial.

PR6598 already delivered the reader and coarse categories. Peer source 4e993d
adds a Workroom transport projection; CAP-21C511CA owns its separate reader
compatibility. Neither is copied or taken over. No new tool, route, schema,
grant, account operation, review attempt or provider call is proposed here.

### Implementation and verification sequence

1. Obtain normal amendment/classification and implementation admission for this
   existing item and immutable design; DESIGN ownership alone does not admit code.
2. Add regressions for each OAuth refusal, valid access, same-family successor,
   refresh continuity, credentials clients, consent mismatch and storage failure.
   Assert boolean parity and that serialized observations contain only fixed fields.
3. Refactor the existing predicate and connect its result to the existing reader.
   Preserve coarse compatibility while adding an optional safe detail category.
4. Run affected tests and both web typechecks, then normal publication gates and
   independent review. Do not replay any uncertain original review as a test.
5. After governed deployment, obtain one original-owner read of 5C843. Record
   the actual remaining action; no fabricated positive settlement or health receipt.

The original executor reconciliation remains open under the same recovery case.
This amendment only makes its authority prerequisite diagnosable; it cannot
establish closure of unknown provider effects or supply missing execution custody.
