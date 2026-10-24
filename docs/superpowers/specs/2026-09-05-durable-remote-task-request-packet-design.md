---
status: active
---

# Durable remote TaskRun request packet

**Backlog item:** BI-2014236E  
**Workroom:** WC-42C01441  
**Extends:** `docs/superpowers/specs/2026-08-31-taskrun-async-push-delivery-design.md`

## Problem and current-tree evidence

External MCP TaskRuns hash the complete normalized request, including the full
`objective`. `createAutonomousWorkRun` intentionally bounds the human-facing
`TaskRun.objective` projection to 1,000 characters, but the background worker
later reconstructs the immutable request from that bounded projection. A valid
request whose objective exceeds 1,000 characters therefore commits one digest
and later recomputes another. The worker terminally fails with
`request_digest_mismatch` before inference, even though the caller supplied the
same request key and the database still owns every other request field.

The live BI-801 acceptance occurrence is TaskRun
`TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-642659D60508`. Its failure is a
request-persistence defect, not provider capacity or an idempotency conflict.

## Objectives and acceptance criteria

- **OBJ-REMOTE-PACKET-01:** **Lossless immutable recovery.** Persist the exact
  normalized objective used by the request digest without widening the
  human-facing TaskRun summary.
- **OBJ-REMOTE-PACKET-02:** **Server-owned authority.** Only the request accepted
  by `tasks/submit` may populate the durable objective; queue events and replay
  callers cannot replace it.
- **OBJ-REMOTE-PACKET-03:** **Fail-closed compatibility.** Historical rows keep
  their current reconstruction path, while any conflicting or altered durable
  objective still fails the existing digest check.

| ID | Objective | Acceptance criterion | Evidence |
| --- | --- | --- | --- |
| AC-REMOTE-PACKET-01 | OBJ-REMOTE-PACKET-01 | A normalized objective longer than 1,000 characters is stored losslessly in server-owned TaskRun metadata while `TaskRun.objective` remains bounded; the background worker reconstructs the original request and matches its exact digest. | Submit persistence and worker reconstruction RED/GREEN tests |
| AC-REMOTE-PACKET-02 | OBJ-REMOTE-PACKET-02 | Submission derives the durable value from parsed request input before enqueue; the event continues to carry only TaskRun identity. | Submit argument assertion and existing queue contract tests |
| AC-REMOTE-PACKET-03 | OBJ-REMOTE-PACKET-03 | Rows without the new field reconstruct from the legacy TaskRun objective; changing the durable field, prompt, binding, or other hashed request bytes remains `request_digest_mismatch`. | Compatibility and tamper matrix tests |
| AC-REMOTE-PACKET-04 | OBJ-REMOTE-PACKET-01, OBJ-REMOTE-PACKET-02, OBJ-REMOTE-PACKET-03 | The repair changes no provider routing, approval, terminal-writer, recipe, cancellation, or notification authority and passes adjacent TaskRun suites, typecheck, protected CI, canonical release, and live same-identity acceptance. | Adjacent tests, typecheck, protected CI, live acceptance |

## Architecture decision

Keep `TaskRun.objective` as the bounded operator-facing summary. Add one exact
`requestObjective` field to the existing server-owned `a2aMetadata` packet for
new external MCP rows. The submit path writes it in the same serializable
transaction as the TaskRun and first deferred message. The background worker
prefers this exact field when present, otherwise falls back to
`TaskRun.objective` for historical rows. It then runs the existing canonical
digest comparison over the reconstructed request.

This is deliberately not a second request ledger. The field is one missing
member of the existing immutable packet, protected by the already persisted
SHA-256 request digest. No queue payload, client replay field, or provider
metadata is trusted as recovery authority.

## Ordered fix sequence

1. Add a failing submit test proving a >1,000-character objective reaches the
   exact server-owned metadata passed to `createAutonomousWorkRun`.
2. Add a failing reconstruction test using the live shape: bounded
   `TaskRun.objective`, full durable `requestObjective`, and a digest computed
   from the full request. Add tamper and legacy-absence controls.
3. Persist `requestObjective` from the parsed request and select it during
   background reconstruction before the existing digest validation.
4. Run the colocated submit/worker suites plus graph-linked capacity,
   approval-recovery, terminal-writer, and readiness-tool-grant tests; run web
   typecheck and preflight. An occupied local immutable gate may be ledgered as
   inconclusive, but deterministic failures and protected checks remain
   mandatory.
5. Publish one DCO PR, protected merge, canonical release, and governed live
   upgrade. Then issue one fresh immutable BI-801 review identity; the already
   corrupted TaskRun remains terminal audit evidence and is not rewritten.

## Backlog coverage

- Decision: atomic
- Parent: BI-2014236E
- Deliverable: `REMOTE-PACKET` — persist and reconstruct one exact external MCP
  request objective under the existing digest and TaskRun identity.
- Rationale: persistence without reconstruction still fails, and
  reconstruction without same-transaction persistence has no authoritative
  bytes. The two changes are one non-shippable contract repair.
- Receipt: pending immutable artifact publication and
  `record_plan_backlog_coverage`.

## Risks and rollback

- Metadata size grows by the normalized objective length. Input is already
  accepted and hashed; PostgreSQL JSONB/Text supports the same bounded MCP
  request payload. No credential or unscreened provider response is added.
- A malformed or tampered metadata value cannot execute because canonical
  digest validation still fails closed.
- Rollback stops writing the new field. New rows retain harmless metadata and
  historical reconstruction behavior remains available; no schema rollback or
  data rewrite is required.
