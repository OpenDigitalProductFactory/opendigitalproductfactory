---
status: draft
---
# Settle obsolete reservation approvals

BI-3C0F7A92 · EP-AUTONOMOUS-DECIDE · WC-FC10201F. Narrow, independently
shippable continuation of BI-8D8939E5; its wider DI-to-actuator proposal remains
open. DI-E28DC01BF184 records a planning choice, never execution authority.

## Problem and existing architecture

On main `834d1446696c4d16957cd890a59c0c2070698925`, the concierge's
`retireLapsedEnvelopes` calls `expireLapsedEnvelopes`, which considers only
elapsed decision windows. A still-fresh release request remains proposed even
after its reservation is cancelled or expires. Existing lease supersession and
durable-wait settlement already work; do not duplicate them. Reuse the envelope
state machine and approval-convergence architecture, not a second approval store.

Live terminal examples are recorded in `cmvxar5r01cnj01tmq3kursj3`; they are
executed historical requests, not evidence of a currently pending obsolete card.
The named-source behavior test below is required to establish that defect.
The current named Codex agent has no explicit governance profile and derives an
approval floor. That observation does not grant any cleanup exemption.

## Authority and data boundary

This is lifecycle settlement, not approval or execution. The only write is an
unreserved envelope's legal transition to `cancelled`, with its settlement time.
Keep original arguments, rationale, human markers and fingerprints intact.
No tool handler runs; no lease, provider, permission or human decision changes.

Accept only taskless, authority-bound `release_nonprod_environment_lease`
requests whose exact parked call belongs to the same user and tool and hashes
to the stored approval input fingerprint. Require the envelope binding itself
to match its recorded fingerprint and actor fields. A redacted, malformed,
unbound, task-bound or ambiguous request stays untouched.

Read the exact reservation under its existing environment advisory lock in a
database transaction: terminal gate rows can be revived by a normal claim, so
an unlocked snapshot is insufficient. Require a cancelled/expired reservation,
no admission, no slot or active key, no process identity/PID, cleanup command,
resource class or memory reservation. Require exact lease/session arguments to
match the row. This is target identity, not proof that the caller owns resources.
No active, queued, admitted, missing or uncertain target qualifies. Existing
explicit-always policies and PROD cleanup controls are unchanged because this
path authorizes and releases nothing. No legacy provenance is backfilled.

Write with the exact old status and `resolvedAt: null` compare-and-set. A racing
human decision or execution reservation wins. Task-bound envelopes remain out of
scope so this change cannot strand or falsely finish a paused task.

## Ordered deliverables and acceptance

1. Reproduce a fresh release envelope surviving the current scheduled expiry
   cleanup despite an already cancelled, never-admitted reservation.
2. Add a bounded, server-only lifecycle reconciler and compose it with the
   existing concierge cleanup. Preserve ordinary time expiry separately.
3. Verify cancelled and expired targets, proposed and approved states, exact
   input binding, unchanged audit data, no handler execution, idempotence,
   human/execution races, and every negative boundary above. Report scan limits;
   a bounded pass must not claim to have examined the entire inbox.
4. Run affected tests, both web TypeScript checks, documentation checks and the
   governed integration gate; obtain independent source assessment and publish
   through the protected PR process. Exercise the existing cancelled outcome on
   the served target after the canonical release, with source/runtime evidence
   kept distinct.

## Compatibility and non-goals

No schema or seed change, new grant, tool, scheduler or autonomy policy. Reuse
the concierge schedule and existing cancelled/not-run outcome. No automatic
cancellation of queued reservations, process cleanup, owner impersonation,
original-task replay, or general DI execution. A read or transaction failure is
inconclusive and leaves the request unchanged. Rollback is a normal source revert.

Capture remains design-pending until named-source reproduction and canonical
plan coverage are recorded. This document is not a passing test receipt.

## Coverage of the recorded acceptance contract

CT-OBS is the authority and data boundary above. FLOW-OBS is the ordered
concierge cleanup and locked cancellation flow. V-OBS is the regression,
negative/race checks, qualified integration and served verification in step 4.
These criteria quote the live item's acceptance contract; the implementation
retains the narrower taskless and never-admitted limits stated above.

| Reference | Recorded acceptance criterion |
| --- | --- |
| AC-OBS-1 | Exact terminal reservation makes its unreserved release request visibly cancelled/obsolete, with no authorization or handler execution. |
| AC-OBS-2 | Unrelated requests, active/queued reservations, missing rows, executing envelopes and unknown outcomes retain their controls. |
| AC-OBS-3 | Compare-and-set races cannot overwrite an execution reservation or human decision. |
| AC-OBS-4 | Tests reproduce current-source defect, demonstrate repair, and cover negative and race boundaries. |
| AC-OBS-5 | Qualified integration and served checks are reported separately from source review. |

All five map atomically to BI-3C0F7A92. Wider autonomy and task-run lifecycle
repairs stay with their existing carriers and are not closed by this change.
