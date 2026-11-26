# BI-5C193A3F preview database attestation plan

[Design](../specs/2026-11-26-preview-db-attestation-design.md). Atomic delivery. The probe, owner proof and current-connection comparison are not useful as independent deliverables.

- **F1 — Owner proof.** Reuse the startup adapter and owner provenance (contract DB-PROOF). Bind the inspected runtime/source and live database identity to the exact active lease (AC-1). Refuse stale provenance on owner-side readback.
- **F2 — Transaction proof.** Add refusing tests first (V1). Cover an identically named database on another cluster, a distinct database on the same cluster, unavailable SQL proof, stale or replaced owner records, and production or unattested installation input. Demonstrate that the transaction passed to the guard is the one that observes the actual connection, and that no consumer write happens on refusal (AC-2, AC-3).
- **F3 — Exact positive match.** Add the smallest attestor and comparison helper. Run V1 and exercise the existing preview-owner and runtime-fence fixtures. Qualify the control-file reader against synthetic disposable PostgreSQL only. Do not register or activate S5. Stop before a full gate or push without coordinator approval.

Rollback disables proof publication and keeps consumers held. It does not change existing generic lease cleanup, the federation parser, or production DB permissions.

## Backlog coverage

BI-5C193A3F covers F1–F3, AC-1–AC-3, DB-PROOF and V1. Stacked successors are BI-8EA98961, then BI-60FC9291. No independent review or immutable coverage receipt is claimed in this draft.
