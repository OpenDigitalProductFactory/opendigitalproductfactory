---
status: active
---

# Self-Upgrade Exact-Target Recovery Closure

**Backlog item:** BI-3FD07259

## Evidence and cause

`SUR-826364D5` watchdog-failed with no dispatch evidence, but an older page still
showed it running and same-release recovery returned
`recovery-target-not-distinct`. Named ref
`8ed70d86fbc99c5a4d339b3f1f6c9dc799b505d8` isolates the residual defect to
`run-store.ts:104-120`: after proving no dispatch, `SHA OR tag` rejects both
partial overlap and exact replay. Only exact replay is safe.

Executed live-provider tests prove active observation converges to terminal
truth. Registration tests prove IPv4 loopback, health only after successful PUT,
and reconciliation on recovery. They rule out new UI or startup mechanisms.

## Governed scope manifest

- **OBJ-SUA-002:** Reconcile failed or ambiguous dispatch by one identity without
  starting a duplicate physical upgrade.
- **OBJ-SUA-003:** Present authoritative terminal state and keep the trigger
  unavailable while disposition is unknown.
- **OBJ-SUA-004:** Preserve quiescence, override, release-binding, and newer-run
  checks as fail-closed authority boundaries.
- **OBJ-SUA-006:** Permit an unambiguously never-dispatched predecessor to recover
  the same immutable target through one typed successor.

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-SUA-010 | OBJ-SUA-002, OBJ-SUA-006 | Exact SHA and tag may recover only after terminal, zero-attempt, no-ack, no-event, latest-predecessor, and unique-successor guards pass. |
| AC-SUA-011 | OBJ-SUA-004 | One-field SHA/tag overlap and any attempted or ambiguous dispatch remain refused. |
| AC-SUA-012 | OBJ-SUA-002, OBJ-SUA-006 | Repeated recovery returns the existing typed successor; worker claim CAS permits one physical upgrade. |
| AC-SUA-013 | OBJ-SUA-003 | Navigation, reload, or polling removes running/installing presentation after terminal reconciliation. |
| AC-SUA-014 | OBJ-SUA-003, OBJ-SUA-004 | Existing live-observation and registration recovery suites remain green without parallel status or startup mechanisms. |

## Architecture and UX fit

Classify targets as `exact` (both fields equal), `distinct` (neither), or
`conflicting` (one). Permit the first two behind existing guards. The typed
successor plus worker claim CAS stays the single-flight boundary.

This fits Platform `/ops/self-upgrade` with guardrails. Reuse its provider,
snapshot, and trigger control; add no route, timer, banner family, retry button,
or AI action. `SelfUpgradeRun`, quiescence, and job-engine health remain truth.

## Ordered atomic fix

1. RED: require one successor for an exact-target, never-dispatched predecessor.
2. GREEN: add the explicit three-way classifier behind existing guards.
3. Prove repeat idempotency and fail-closed partial or ambiguous cases.
4. Re-run live-observation, self-registration, affected tests, and typecheck.
5. Pass preflight, semantic review, exact-tree CI, protected merge, canonical
   release, and governed live served-SHA/CAN-TEST verification.

The classifier, successor, worker CAS, and projection are one revert boundary;
a subset could duplicate execution or leave failure without safe recovery.
