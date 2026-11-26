---
status: draft
---

# BI-5C193A3F preview database attestation plan

[Design](../specs/2026-11-26-preview-db-attestation-design.md). Atomic delivery. The probe, owner proof and current-connection comparison are not useful as independent deliverables.

- **F1 — Owner proof.** Reuse the startup adapter and owner provenance (contract DB-PROOF). Use the host Docker exec channel only for dev-postgres and bind the inspected container, mounted volume, runtime/source and live database tuple to the exact active lease (AC-1). Within the portal owner publication transaction, read the system identifier on the existing lease DB connection and reject missing or matching identifiers. Share the canonical PostgreSQL string extractor. Change the checkpoint and non-expiry settle writes to CAS in durable-wait.ts. For both the checkpoint and non-expiry settle, test three interleavings in durable-wait.test.ts. (a) The writer reads, publish commits, then the writer CAS misses and re-reads without losing the proof. (b) Publish reads, the writer commits, then publish CAS misses and re-evaluates without writing proof onto a terminal or completed wait. (c) Removal or replacement of the proof precedes a stale writer attempt, which cannot restore the old proof. Verify the publish CAS conditions on status and observed progressPayload. Assert that release rolls back on non-expiry settle retry exhaustion and an idempotent retry can finish.
- **F2 — Transaction proof.** Add refusing tests first (V1). Cover an identically named database on another cluster, a distinct database on the same cluster, unavailable SQL proof, stale or replaced owner records, and production or unattested installation input. Cover a production system_identifier match, reinitialized volume or changed postmaster start time, shadow public.pg_control_system and public.current_database early on search_path, and the live-DB override before any write. Refuse the root pooled client. In disposable PostgreSQL, assert identical pg_backend_pid() and txid_current() in the guard query and the synthetic write. Assert no write happens on refusal (AC-2, AC-3).
- **F3 — Exact positive match.** Add the smallest attestor and comparison helper. Run V1 and exercise the existing preview-owner and runtime-fence fixtures. Qualify both the preview probe and portal publication path against synthetic disposable PostgreSQL only. Qualify publication once under a disposable non-superuser role and verify permission denial holds without adding a grant. No live install verification. Verify PostgreSQL 16 with the existing disposable dpf bootstrap role. Authorization must hold until the BI-8EA98961 join and BI-60FC9291 commit fence exist. Do not register or activate S5. Stop before a full gate or push without coordinator approval.

Rollback disables proof publication and keeps consumers held. It does not change existing generic lease cleanup, the federation parser, or production DB permissions.

## Backlog coverage

BI-5C193A3F covers F1–F3, AC-1–AC-3, DB-PROOF and V1. Stacked successors are BI-8EA98961, then BI-60FC9291. No independent review or immutable coverage receipt is claimed in this draft.
