---
status: draft
date: 2026-11-02
backlog: BI-18A74F86
---

# Governed preview renewal and fence diagnostics

BI-18A74F86 / WC-3A121A42. DESIGN admission IRD-9DEB8A81A29F.
Research source: 36b46866870694dab1763e691862da38dc577e76.
This document captures diagnosis and proposed repair. Implementation is not admitted.

## Design grounding

Extend scripts/lib/dev-preview-runtime.mjs and scripts/lib/lease-supervisor.mjs, with their existing Node behavior tests. Reuse the supervisor authority deadline, shortened uncertain retry, exact preview binding and reservation observation. The completed [reservation finalization design](2026-11-01-preview-reservation-finalization-design.md) owns BI-B4EEE635 and stays closed. BI-92098F21 owns queued preview cancellation; BI-5ED1C819 owns DEV tool provisioning. Neither is a substitute for this carrier.

The root coordinator checked all 40 open platform epics and the closest historical carriers. Semantic duplicate matching was unavailable because the provider is operator-paused. This is a bounded lexical, source and owner check, not proof of global absence. No provider activation or inference is needed for this design.

## Observations and limits

The original NPEL-CDA8459341 attempt failed before READY, under controller 36b46866870694dab1763e691862da38dc577e76 against scorecard source 23374c654740b5a2c77766f405d62b3a0ead6054. Root and metrics retain the original bounded artifacts. Their reports establish transport uncertainty, authority-deadline, unclassified termination failure and controller exit 1. The native reservation subsequently expired. No desktop UX ran. Follower exit 0 and reported clone progress do not establish initializer success, data integrity or readiness.

Root's metadata-only audit found eight successful renewal handlers taking 1008-1014 ms. Handler completion precedes post-tool hooks, audit and HTTP return. These rows cannot establish client acknowledgement time. Last returned heartbeat was 2026-11-03T01:14:36.153Z, expiry 01:16:36.153Z. The retained evidence does not establish the last client-acknowledged expiry or the underlying termination error. Do not reconstruct either from later expiry, invent a common cause with a contemporaneous unrelated transport failure, or retrospectively claim successful cleanup.

A pure source reproduction at the named ref called previewLeaseEventSummary with fixed valid event time, expiry and attempt. It returned null for heartbeat-renewed, retained only type/category for heartbeat-uncertain, and classified the known preview_owned_cleanup_failed reason as unclassified. This confirms loss of safe diagnostic information, not the original transport failure's cause. Current source already uses a 30-second renewal timeout and shortened uncertainty retries within the two-minute lease. Increasing those budgets is unsupported.

The new worktree is source-only: no node_modules or generated Prisma client. The pure reproduction imports dependency-free Node modules. No package test, typecheck, integration or live preview pass is claimed.

## Outcome

**OBJ-RD-1:** Retained bounded events distinguish acknowledged lease authority from a server commit and an uncertain response.
**OBJ-RD-2:** Fence failure identifies a safe known operation/category while preserving command and cleanup uncertainty.
**OBJ-RD-3:** Diagnostic improvements preserve fail-closed authority and existing ownership, readiness and finalization contracts.

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-RD-1 | OBJ-RD-1 | Retain validated event time, acknowledged expiry and bounded renewal attempt/result when available; never infer an ACK from server audit or reservation expiry. |
| AC-RD-2 | OBJ-RD-1, OBJ-RD-2 | Emit only allowlisted event types, timestamp formats, finite bounded numbers and known error categories; arbitrary messages, child output, credentials, host paths and customer rows never escape. |
| AC-RD-3 | OBJ-RD-2, OBJ-RD-3 | A failed owned-container termination retains a specific safe disposition and truthful command failure/cleanup uncertainty, without claiming the missing historical cause was recovered. |
| AC-RD-4 | OBJ-RD-3 | Deterministic tests cover delayed timely ACK, server commit with missing/late response, repeated uncertainty, renewal after fencing/finalization, and failed termination; no late completion revives authority or supervision. |
| AC-RD-5 | OBJ-RD-3 | Exact owner/source/image/lease checks, restricted-table exclusions, bounded startup, read-only source behavior, writer cleanup, TTL, timeout and release authority remain intact. |
| AC-RD-6 | All | After actual remediation and protected qualification, one normally admitted preview provides source/lease-bound READY and desktop verification or a precise remaining infrastructure result; source tests alone cannot satisfy this criterion. |

## Proposed contract and ordered work

One atomic repair maps to BI-18A74F86. These are sequential steps, not independent deliverables. Immutable coverage and research evidence are required before implementation.

1. Obtain bounded original request/response metadata from its owners if retained. Mark unavailable original ACK and termination details as unknown. Keep private logs and clone payloads with their owners. Inspect the transport response path at the frozen controller ref; change only a cause established by evidence.
2. Add deterministic first-failing behavior tests for the existing summary's lost valid fields and known cleanup disposition. Include invalid timestamps, nonfinite/oversized counters, arbitrary keys/messages and secret sentinels. Reuse existing supervisor fake clocks and deferred promises for the acceptance matrix.
3. Refactor existing summary validation into small private allowlist helpers. Preserve ISO timestamps only after strict validation, counters only within documented finite bounds, and known categories only. Retain successful renewal acknowledgement events rather than fabricating acknowledgement from uncertain events. Define attempt semantics explicitly; uncertain streak is not total request count. Add a request-start field only at the actual supervisor call boundary if needed.
4. Examine a response arriving after fencing while termination is pending. Confirm behavior with deferred promises before proposing a state change. A fenced attempt cannot regain authority or arm timers. Keep legacy final-renewal and host-observation finalization behavior covered. Any source cause repair is limited to an evidenced failing test and remains within normal implementation admission.
5. Classify the existing fixed preview_owned_cleanup_failed code without emitting AggregateError children or arbitrary messages. If finer operation codes are necessary, emit fixed codes at the owned cleanup boundary; do not flatten raw errors into telemetry. Keep writer exit proof separate from reservation settlement.
6. Update contributor runtime guidance and run affected dependency-free Node controls. Run package checks only after managed readiness is established. Obtain exact-source shared integration, independent assessment under existing provider consent, protected CI and DCO merge through the ordinary process. No reviewer dispatch or provider activation is authorized by this design capture.
7. Root remains sole install publisher. Only after actual supported remediation and normal adoption may the preview owner run one admitted desktop attempt. Record readiness, command result, writer exit, reservation state and UX separately. Preserve the original failed occurrence and obsolete unexecuted release envelope.

Refactoring consolidates diagnostic validation in the existing event boundary rather than adding a second telemetry subsystem. No schema, new MCP tool, grants, credentials, TTL/reaper, timeout increase, startup-budget extension or original review replay is proposed. No UI route changes are needed; truthful actionable terminal diagnostics are the affected developer experience.

## Admission, risk and rollback

Current native design admission is allowed, medium, low sensitivity. Funding scope is unresolved; no budget allocation is inferred. Implementation, coverage, research receipt, source qualification and live acceptance remain pending. This document does not clear DEV provisioning's original review hold.

Primary risks are leaking arbitrary error material, confusing event time with request/ACK time, and accepting a late response as renewed authority. Test each at the existing summary/supervisor boundary. Revert the repair and its tests/docs together if required; preserve audit history and do not revive an expired lease. An unavailable transport diagnosis remains explicitly unresolved even if diagnostic retention improves.

## Canonical item acceptance (verbatim)

1. Reconcile original retained request/response and controller authority facts if available; distinguish client-ACK time from server commit, handler duration and later expiry. State missing evidence honestly; never manufacture recovery of an unavailable original timeline.
2. Extend the existing bounded preview/supervisor diagnostic contract with only approved safe facts needed to identify last acknowledged expiry, renewal attempt/time/result and fence/cleanup disposition. Preserve sanitization: no raw child output, arbitrary error messages, credentials, host paths or source/customer rows.
3. Use deterministic transport/supervisor behavior tests to cover delayed response before deadline, server commit with missing/late response, repeated uncertainty, late renewal after fence/finalization, and failed termination while preserving truthful command1/cleanup uncertainty.
4. Diagnose and repair only the evidenced source cause. Keep exact owner/source/image/lease binding, fail-closed fencing at last acknowledged authority, restricted-table exclusion, bounded clone, source read-only behavior and writer cleanup. No blind timeout/TTL/startup-budget increase, exception date change or inference/approval bypass.
5. After admitted design/implementation and applicable protected qualification, verify one ordinarily admitted preview reaches source/lease-bound READY and can run desktop acceptance, or reports the precise remaining infrastructure failure. A new attempt requires actual supported remediation, not an unchanged retry. Desktop web is the user-directed target; native iOS remains separate.
6. Reservation terminality, follower exit0, source tests, build progress and client source review never stand in for READY/UX or writer-exit proof.

## Traceability labels

Flow references: renewal-acknowledgement; authority-fence; owned-cleanup.
Verification references: deterministic source behavior tests; protected qualification; ordinarily admitted desktop preview.

