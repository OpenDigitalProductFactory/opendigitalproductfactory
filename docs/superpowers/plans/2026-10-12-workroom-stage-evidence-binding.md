---
status: active
---

# Workroom stage evidence binding

Backlog: BI-9DC43E17. Workroom: WC-042C344C.

The served Workroom inspector cannot correlate journal evidence to a requirement because the writer records no versioned source context and the reader emits no process binding. Extend the existing WorkroomActivity payload and ReceiptEnvelope adapter; retain the existing bounded journal and observed status.

## Design grounding

Use the existing versioned work-shape registry, scopeClaims reader, initiative-evidence current-source predicate, and shape-projection requirement binder. WorkroomActivity remains the journal; no new ledger, schema, tool, or completion authority. The server stamps repository, commit, definition, stage and kind from the room at write time. Readers bind only a matching current room/source/definition. Legacy, malformed, stale and wrong-stage notes remain visible but unbound. A binding means an observed record for a requirement, never a passing gate or stage completion.

## Verification and delivery

1. Resolve graph-linked writer, receipt and projection tests; reproduce the missing binding with a regression test.
2. Add a pure shared binding validator, writer stamp and reader adapter. Preserve deferred publication and existing stage advancement rules.
3. Check stale source, different room/repository/shape/stage, caller-supplied binding, legacy data and observed-only status; run affected suites and package typechecks.
4. Obtain independent review and the exact-source governed gate before publication; deploy through the existing single producer and native upgrade path.
5. Verify the enterprise → initiative → room → step → actual evidence journey on the served target. Do not mark the seven runtime scenarios or parent initiative complete from this adapter change.

The existing BI-9DC43E17 owner confirmed no overlapping code edits; its future journal sequencing work retains ownership of atomic sequence/high-water semantics.
