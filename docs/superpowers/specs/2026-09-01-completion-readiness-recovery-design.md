---
status: active
---

# Completion-readiness recovery design

**BI:** `BI-199F71B6`  
**Parent contract:** `2026-08-25-initiative-readiness-reviewer-packet-design.md`

## Problem and scope

Workroom claims already pass readiness through
`resolveInitiativeReviewerRecovery`; completion adapters do not. A terminal
refusal can name `acceptance-reviewer` but offer no executable route to
`record_initiative_evidence(operation='objective-mapping')`. This adds recovery
to refusals and changes no verdict, transition, evidence meaning, approval,
persistence, UI, or migration.

## Objectives

- **OBJ-PACKET-TERMINAL:** Both terminal adapters derive recovery from the
  refusal and its server-owned Workroom identity.
- **OBJ-PACKET-MAPPING:** Missing acceptance or objective reconciliation yields
  an `objective-mapping` evidence-writer packet bound to the current
  baseline and immutable source.
- **OBJ-PACKET-UNCHANGED:** Allowed transitions and verdicts remain unchanged;
  recovery is additive refusal data.

## Design

After denial, one shared adapter resolves the refused Workroom or one live room;
requires repository, branch, immutable base/head, and current baseline; finds
the verified design blob; then calls the recovery registry.

Extend only the recovery type with `objective-mapping`; keep it out of
`INITIATIVE_GATE_KEYS` because it is a proposal, not a receipt. For
`ACCEPTANCE_EVIDENCE_REQUIRED` and `OBJECTIVE_RECONCILIATION_REQUIRED`, the
evidence-writer lane routes `acceptance-reviewer` to the existing writer. The
packet asks it to map every current `OBJ-*` and `AC-*` marker to post-baseline
evidence. Only the terminal repository evaluates the proposal.

Both MCP adapters attach the result to `initiative_not_ready` data. Missing or
ambiguous room, baseline, artifact, or writer yields typed escalation and no
route. Success runs no recovery.

## Research and architecture grounding

Live overlap confirmed `BI-EDC0DAF2` and `BI-E2B632D2` own writer replay, not
packet issuance. Reuse Workroom liveness, baseline validation,
artifact discovery, reviewer routing, and the evidence writer. Add no table,
tool, receipt, role, grant store, or review engine.

## Acceptance

| Acceptance ID | Objective IDs | Required outcome |
|---|---|---|
| AC-PACKET-TERMINAL-001 | OBJ-PACKET-TERMINAL | Both completion refusals return the same executable recovery shape. |
| AC-PACKET-TERMINAL-002 | OBJ-PACKET-MAPPING | The packet binds the writer, `objective-mapping`, baseline, repository/branch/head, source path, and provider blob. |
| AC-PACKET-TERMINAL-003 | OBJ-PACKET-UNCHANGED | Allowed transitions and readiness verdicts are unchanged. |
| AC-PACKET-TERMINAL-004 | OBJ-PACKET-TERMINAL, OBJ-PACKET-UNCHANGED | Missing or ambiguous identity yields typed escalation and no route. |
| AC-PACKET-TERMINAL-005 | OBJ-PACKET-MAPPING | Dispatch records the proposal without caller-authored authority; terminal evaluation stays canonical. |

## Verification

TDD covers routing, packet narrowing, baseline selection, identity/artifact
failure, both refusal projections, and unchanged success. Run affected Vitest,
style guard, web build, pregate, PR health, and canonical replay. UI and
migration are not applicable.
