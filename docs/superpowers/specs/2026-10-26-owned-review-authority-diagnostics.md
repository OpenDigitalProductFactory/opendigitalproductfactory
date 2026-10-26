---
title: Owned review authority diagnostics
status: proposed
date: 2026-10-26
backlog:
  - BI-924ADA3A
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
