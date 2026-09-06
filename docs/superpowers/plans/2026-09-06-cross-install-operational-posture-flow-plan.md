---
status: active
---

# Cross-Install Operational Posture — Flow & Paired-Estate Surface (Plan)

**Design:** `docs/superpowers/specs/2026-09-01-cross-install-operational-control-plane-design.md` (BI-648F01A0, EP-8B03CB06)
**Prerequisite landed:** Slice 2.1 — record type, contract, minimized projection (BI-0585906E, PR #4968)

This plan covers the two visibility slices that remain before the operator's
control-scope stance gates Slice 4.

## Phase A — Slice 2.2: posture flows (BI-27B578C7)

Mirror `demand-reconciliation.ts` end to end; no new table, transport or registry
(AC-OCP-006).

| Step | Module | What it does |
|---|---|---|
| A1 | `apps/web/lib/federation/operational-posture-capture.ts` | Roll this install's substrate up to summary counts only: served version/sha (`loadPlatformVersion`), patch severity totals (`getPatchPosture`), runtime-target tally, canonical estate size, self-reported health band. `offline` is never self-reported. |
| A2 | `apps/web/lib/federation/operational-posture-delivery.ts` | One local-canonical `operational-posture` outbox row per trusted same-org link (`localRecordRef = posture:<installationId>`), scheduled on the shared federation delivery queue. Unchanged content is a noop within a one-hour heartbeat, then re-reported so the peer can age the record honestly (BI-DD93808A). |
| A3 | `demand-delivery.ts` `dispatchDueDemand` | Drains posture rows alongside demand: `sendOperationalPostureToPeer` to `/api/v1/federation/inbox`, acknowledged on `originVersion`. Same retry clock and dead-letter cap. |
| A4 | `apps/web/lib/federation/operational-posture-exchange.ts` + `demand/route.ts` | Receive `dpf.operational-posture.reported` from a **same-org link only** (403 otherwise); persist a peer-canonical mirror with the version-predicate update. A stale or non-canonical write is a conflict, never an overwrite. |
| A5 | `apps/web/lib/queue/functions/demand-reconciliation.ts` | New step `project-operational-posture` ahead of the demand step on the existing cron, so the demand step's drain delivers it in the same cycle. |

Gate: affected vitest green locally; typecheck green; the full build is the cloud
merge-queue safety net. `DPF_FEDERATION_EXCHANGE_ENABLED` is referenced in a test
cleanup only — no live code path reads it today, so posture is gated the same way
demand is: the cron plus a trusted same-organization link.

## Phase B — Slice 3: paired-estate surface

- Read model: local posture (captured live) + every peer-canonical
  `operational-posture` mirror, each stamped with **basis** (local capture vs
  mirrored report from `<install>`) and **age** (`capturedAt`, `lastSyncedAt`);
  a mirror older than the heartbeat + delivery slack renders as stale/`offline`.
- Prod-side view composes both installs into one fleet picture using the shared
  UI primitives and `--dpf-*` tokens.
- Register the peer's runtime targets as summary rows so
  `get_runtime_coordination_map` reflects both installs.

## Not in this plan

Slice 4 (governed action channel) — blocked on the org's WWWD control-scope
stance; see the design spec's Governance section.
