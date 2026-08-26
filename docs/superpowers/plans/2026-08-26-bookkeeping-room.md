---
title: "Plan — Bookkeeping Work Room orchestration + lifecycle grammar + Outcome Packet (S-ROOM)"
date: 2026-08-26
bi: BI-F8B6CF81
epic: EP-EMAIL-COMMS
status: active
---

# Plan — Bookkeeping Work Room (BI-F8B6CF81, slice S-ROOM)

**Parent:** BI-1585FA9E (Bookkeeping Work Room). **Spec:** `docs/superpowers/specs/2026-08-16-bookkeeping-work-room-design.md`. **Depends on:** S-BK (BI-7D50DC56, merged #4690) for the Bookkeeper coworker; S-FIN (BI-DE27D34E, merged #4658) for the banking loop.

## What

Compose the existing Work Room substrate (EP-WORKROOM-COMMS), the canonical lifecycle grammar (BI-E55991E9), and the Outcome Packet builder into a **Bookkeeping Work Room** — a recurring, standing room that runs the day-to-day books loop to a reconciled period. This slice adds the room's *structure* (a lifecycle grammar + a source-registry room kind + the grammar↔room binding); membership is runtime and the Outcome Packet builder is reused verbatim.

## Substrate audit (grounded 2026-08-26, verified on this branch's `main`)

| Capability | State | Use |
| --- | --- | --- |
| Canonical lifecycle grammar | `apps/web/lib/lifecycle-grammars.ts` — 5 grammars, `validateGrammar` runs at module load; frozen snapshot `apps/web/lib/lifecycle/lifecycle-grammar-snapshot.json` (stance-consistency guard, BI-EAD441E0 #4379) | **Add** a `bookkeeping-room` grammar; a pure addition produces no negation findings — only new snapshot keys. Regenerate the snapshot. |
| Work Room source registry | `apps/web/lib/work-management/source-registry.ts` — `WORK_CASE_SOURCE_REGISTRY` declares each room kind's `roomProjection` (mode, cycle carriers, Outcome-Packet required categories); `sourceType` is a free string, **no DB enum** | **Add** a `bookkeeping-period` entry (standing, governed receipts, Outcome-Packet categories evidence+receipts+decisions). No migration. |
| Room ↔ structure binding | `apps/web/lib/work-management/room-structure.ts` — `resolveWorkroomStructure` folds a subject onto value-stream + grammar | **Add** a `bookkeeping-period` subject arm bound to the new grammar (internal operate loop → no customer OVSM value stream). |
| Outcome Packet | `apps/web/lib/work-management/outcome-packet.ts` — `buildWorkroomOutcomePacket` validates + freezes; enforces required categories, provenance, non-empty summary | **Reuse verbatim**; exercised with fixtures (a closed bookkeeping period). |
| Membership | `room-policy.ts` (`appendRoomPolicyParticipant`) + `room-agent-access.server.ts` (`resolveAgentRoomAccess`) — outcome-scoped, runtime | **No code.** The Bookkeeper (S-BK) is admitted and convenes CRM/enrichment + a governance/approval participant at runtime. |

## Deliverable (each an independently verifiable unit)

1. **Grammar** — `BOOKKEEPING_ROOM_GRAMMAR` (open → gather → import-categorize → reconcile → owner-review → closed) + `resolveBookkeepingRoomPoint` + registry line, in `lifecycle-grammars.ts`. Blocked/ready bands mark the real exception states (awaiting-documents, exceptions-open, unreconciled, changes-requested).
2. **Snapshot** — regenerate `lifecycle-grammar-snapshot.json` (`scripts/update-lifecycle-grammar-snapshot.ts`).
3. **Room kind** — `bookkeeping-period` in `WORK_CASE_SOURCE_REGISTRY` + `BOOKKEEPING_ROOM_PROJECTION` (standing; Outcome-Packet requires `evidence` (reconciliation), `receipts` (governed writes), `decisions` (owner sign-off)). Added to `WORK_CASE_WORK_ITEM_SOURCE_TYPES`.
4. **Binding** — `bookkeeping-period` subject arm in `room-structure.ts` bound to the grammar.
5. **Tests** — grammar validity + 6-stage sequence + point resolution; room-structure binding; an Outcome-Packet build for a closed period (required categories enforced, no fabrication).

## Verification

- Grammar validated at module load; unit tests green; `apps/web` typecheck clean; snapshot regen committed (== regenerated); guard tests green. Fixture-level only — the **live reconciled period is owner-gated** (real statement export; no fictitious data on the live instance), surfaced as an owner action, not a build gap.

## Risks & rollback

- Snapshot drift if not regenerated → the consistency guard test catches it (regenerated here).
- Rollback: remove the grammar/registry/source/binding entries; pure additions, no migration, no schema change.
