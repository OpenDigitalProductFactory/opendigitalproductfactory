---
status: draft
---

# Wave 2 synthetic WWMD and ledger proof

BI-6C35FB77 · WC-578907C5. This plan does not authorize implementation.

The [canonical design §5](../specs/2026-11-24-wwmd-os-binding-design.md#5-wave-2--prove-the-caller-and-relational-ledger-together) owns the acceptance contract. Use the DPF `4e7b9d86` and coordinator-verified DPF2 `8b3afa0f` baselines. The research receipt is `initiative-74557b8b-2fd5-4282-b1b6-e2033b4bcc1c`.

## Before implementation admission

The DPF decision owner and DPF2 receiving design owner jointly review which trusted receiver policy selects WWMD-required mode, how the reference binds to the exact admission, how lineage is established, and where both verifiers hold. Record their decision on signed bytes, encoding, version and compatibility in the canonical design. Agree one versioned fixture contract for Core and executor. This plan selects no wire format or version. Complete governed design and plan review before seeking implementation admission.

## Proof sequence after admission

1. **Issue and read back (AC-W2-1).** Build a deterministic synthetic fixture with an affirmative scoped verdict and exact profile version in the incumbent relational schema. Reuse the canonical WWMD audit and projector authority rules. Sign a by-value reference into one receiver admission. Read it back and compare its original relational ID, version and seal for equality. A shadow TAK gate reference and scorer parity are controls, not sources of authority.
2. **Exercise both verification paths (AC-W2-2).** Run the same versioned vectors through Core and the independent executor verifier, including the installed receiver and bridge wiring. Cover trusted required-mode positive acceptance and no-effect refusals for unavailable and late retrieval, stale or missing evidence, missing audit or seal, and unprovable lineage. With valid outer signatures, cover absent or legacy binding, stale or mismatched binding, and wrong scope or unauthorized lineage. Assert no permit issuance when upstream evidence is incomplete, no receiver effects on refusal and no downgrade to /1 or substitution from WWWD or WSID. Separately scoped legacy fixtures and independent company and practitioner paths retain their prior behavior.
3. **Restore and append (AC-W2-3).** Restore a sealed chain plus intentionally unsealed rows into a disposable same-schema relational store. Compare exact IDs, FKs, chainId, prevHash, chainEntryHash and sealedAt, including nulls. Assert predecessor writes are denied before accepting one successor append whose prevHash is the restored head's chainEntryHash. Recompare preserved rows to rule out resealing or synthetic links.
4. **Reconcile rollback (AC-W2-4).** Fence the successor, prove it cannot append, reconcile the accepted append with the predecessor and validate identities and head continuity before allowing predecessor writes. Inject a reconciliation failure and assert both writers remain fenced. Record the accepted append and fence transition evidence without a second successor append.

Keep proof data wholly synthetic. Capture input fixture identity, per-path dispositions and effect counts, exact row parity, chain checks and fence/append/reconciliation order. This proof does not move production records, activate a provider or receiver, change an operational writer, deploy, or authorize cutover. GPP package adoption stays in BI-ABB5587B and BI-2D3F986C.
