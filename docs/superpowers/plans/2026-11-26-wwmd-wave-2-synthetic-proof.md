---
status: draft
---

# Wave 2 synthetic WWMD and ledger proof

BI-6C35FB77 · WC-578907C5. This plan does not authorize implementation.

The [canonical design §5](../specs/2026-11-24-wwmd-os-binding-design.md#5-wave-2--prove-the-caller-and-relational-ledger-together) owns the acceptance contract. Use the DPF `4e7b9d86` and coordinator-verified DPF2 `8b3afa0f` baselines. The research receipt is `initiative-74557b8b-2fd5-4282-b1b6-e2033b4bcc1c`.

## Traceability

Scope baseline `baseline-0893a21d-7452-4d2e-bab9-ca2f660fd05d` binds objective `OBJ-WAVE2` to acceptance criteria `AC-W2-1`, `AC-W2-2`, `AC-W2-3` and `AC-W2-4` in the canonical design.

## Before implementation admission

The DPF decision owner and DPF2 receiving design owner must concur on the strict paired /2 contract in the canonical design. Review the exact field schema and limits, signed-byte fixture, and protected freshness, policy and claim sources at all three ingress points. Preserve /1 fixture bytes and selection. Complete governed design and plan review before seeking implementation admission.

## Proof sequence after admission

1. **Issue and read back (AC-W2-1).** Build a synthetic sealed affirmative WWMD fixture with exact profile/version. At the DPF export boundary, exercise projector eligibility, current scope, audit, seal and lineage checks. Encode one by-value binding per selected permit, covering exact issuer and installation, original decision ID, profile/version, chain and seal, target/action and freshness. Bind it to admission, permit and effect scope, session/generation and attempt. Resolve the same binding on readback and compare original relational identity and seal. Prove shadow TAK and scorer parity confer no authority.
2. **Verify all three ingress paths (AC-W2-2).** Pin canonical UTF-8 inner and outer body bytes, inner digest and outer Ed25519 signature in a shared versioned vector. Compare byte output independently across DPF, Core and executor. Run the full matrix in Core, the installed receiver, and the bridge, passing independent expected policy, clock and claim. Assert identical authority dispositions and no launch or effects on refusal. Include a paired /2 positive and explicit /1 fixture positive, valid signatures over wrong versions and omitted-binding downgrades, sibling permit swaps and mismatched attempt/scope/issuer, stale or revoked authority and unavailable current policy or lineage, WWWD/WSID/shadow substitution, and false request-selected mode. At the bridge, vary request keys, spec, expected generation and time without giving them policy, scope, or freshness authority. Confirm unavailable or late retrieval and missing evidence, audit or seal prevent issuance, including intentionally unsealed historical records.
3. **Restore and append (AC-W2-3).** Restore a sealed chain plus intentionally unsealed rows into a disposable same-schema relational store. Compare exact IDs, FKs, chainId, prevHash, chainEntryHash and sealedAt, including nulls. Assert predecessor writes are denied before accepting one successor append whose prevHash is the restored head's chainEntryHash. Recompare preserved rows to rule out resealing or synthetic links.
4. **Reconcile rollback (AC-W2-4).** Fence the successor, prove it cannot append, reconcile the accepted append with the predecessor and validate identities and head continuity before allowing predecessor writes. Inject a reconciliation failure and assert both writers remain fenced. Record the accepted append and fence transition evidence without a second successor append.

Keep proof data wholly synthetic. Capture input fixture identity, per-path dispositions and effect counts, exact row parity, chain checks and fence/append/reconciliation order. This proof does not move production records, activate a provider or receiver, change an operational writer, deploy, or authorize cutover. GPP package adoption stays in BI-ABB5587B and BI-2D3F986C.
