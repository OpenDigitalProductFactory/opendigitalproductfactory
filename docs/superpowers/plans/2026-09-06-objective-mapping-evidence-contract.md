---
status: active
---

# Objective-mapping evidence contract completion plan

- **Backlog item:** `BI-0F8E39D5`
- **Workroom:** `WC-8FB4E4D0`
- **Design:** [`2026-09-04-objective-mapping-evidence-contract-design.md`](../specs/2026-09-04-objective-mapping-evidence-contract-design.md)
- **Scope:** one server-owned objective-mapping authorization contract spanning
  packet construction, request identity, writer validation, correction, and
  fail-closed reconciliation

## Outcome

A completion reviewer receives only the finite post-baseline evidence activity
IDs that the server has already proved eligible. The governed writer can append
one mapping only from that set, and a malformed latest mapping can be corrected
through one deterministic successor without hiding or reinterpreting history.

## Backlog coverage

- Decision: atomic
- Parent: `BI-0F8E39D5`
- Receipt: `cmtphoxgd037r01qwz8sm2y25`
- Dependencies: none
- Rationale: packet authority, deterministic identity, transactional writer
  validation, correction projection, and supersession controls are one
  authorization boundary. Shipping any part independently would either expose
  unbounded evidence, accept an unauthorized reference, or strand a valid
  correction behind an obsolete TaskRun.

| Deliverable | Backlog item | Requirements | Contracts | Flow | Verification |
| --- | --- | --- | --- | --- | --- |
| `objective-mapping-evidence-contract` | `BI-0F8E39D5` | `OBJ-OMEC-PACKET`, `OBJ-OMEC-WRITER`, `OBJ-OMEC-CORRECTION`, `OBJ-OMEC-FAIL-CLOSED`, `OBJ-OMEC-KEY`, `OBJ-OMEC-SUPERSESSION` | `InitiativeReviewBinding`, `request_coworker`, `record_initiative_evidence`, `objective-mapping-repository` | `eligible-evidence-to-packet`, `packet-to-versioned-task`, `approved-writer-to-mapping`, `malformed-mapping-to-governed-correction` | `AC-OMEC-001`, `AC-OMEC-002`, `AC-OMEC-003`, `AC-OMEC-004`, `AC-OMEC-005`, `AC-OMEC-006`, `AC-OMEC-007`, `AC-OMEC-008`, `AC-OMEC-009`, `AC-OMEC-010` |

## Ordered implementation and verification

1. Reproduce the BI-2B malformed mapping and the BI-SIG/BI-2B historical
   coarse-key collisions with immutable fixtures.
2. Centralize passing-evidence classification, load the bounded eligible
   post-baseline activity set, and carry it in the server-issued review binding.
3. Narrow the public writer schema and prompt to that finite set while keeping
   the repository, not the model or schema, as the final authority.
4. Revalidate every referenced activity in the writer transaction before
   append; reject foreign, pre-baseline, failing, missing, conflicting, or
   unbounded evidence atomically.
5. Project a malformed newest mapping as recoverable missing mapping while
   preserving its diagnostic identity; retain hard failure for baseline-chain
   corruption and never fall back to an older mapping.
6. Derive the request key from the complete immutable packet and allow a
   deterministic successor only for a changed eligible-evidence set within the
   same Workroom, baseline, reviewer, and artifact identity.
7. Run focused and graph-linked tests, web typecheck, documentation checks,
   style/diff guards, semantic review, DCO, and every protected PR and
   merge-group check. An unavailable shared local lane is recorded as
   INCONCLUSIVE, never PASS, under the operator's explicit gate boundary.
8. Publish through one protected PR and compatible canonical release, verify
   exact served SHA/CAN-TEST, and close the real preserved items only from
   genuine mapping receipts and reconciled completion decisions.

## Atomicity rationale

The six objectives are not independently safe releases. The packet and schema
without repository validation would make model output look authoritative; the
repository repair without deterministic request identity would keep exact
historical tasks stranded; correction without supersession guards could fork
approval authority. One atomic deliverable keeps authorization, persistence,
and recovery aligned while retaining every historical TaskRun and activity as
audit evidence.

## Failure and rollback

- Zero or excessive eligible evidence yields a typed no-route result; IDs are
  never silently truncated or replaced with prose or source paths.
- A changed Workroom, baseline, artifact, reviewer, tool set, or active
  approval/receipt blocks supersession.
- Failed and malformed rows remain immutable and auditable. A later valid row
  supersedes by append, never by mutation or fallback.
- Rollback is the protected source revert. No migration, table, role, or
  approval bypass is introduced.

## Completion proof

- Focused and linked fixtures prove all ten acceptance criteria on the exact
  immutable candidate.
- DCO and protected PR/merge checks are terminal green.
- The canonical release serves the exact protected SHA and returns CAN-TEST.
- Genuine objective-mapping activities and completion decisions close the
  affected backlog items; prose-only reviewer output is not a receipt.
