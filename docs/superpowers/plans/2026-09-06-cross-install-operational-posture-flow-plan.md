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

## Phase B — Slice 3: paired-estate surface (BI-27B578C7 follow-on)

| Step | Module | What it does |
|---|---|---|
| B1 | `apps/web/lib/federation/operational-posture-read-model.ts` | Pure mapper + cached loader: the local capture beside every peer-canonical `operational-posture` mirror. Age is measured from the peer's capture, not the delivery; freshness bands are one heartbeat + slack (fresh), then stale, then silent at three missed heartbeats, at which point the peer's own health band is overtaken by `offline`. |
| B2 | `apps/web/components/ops/PairedEstatePosturePanel.tsx`, `/ops/installation` | One card per installation, each stating its basis line ("Captured on this installation" / "Reported by <peer> · captured 4m ago") and freshness chip; shared `Surface` + `StatusBadge`, `--dpf-*` tokens only. |
| B3 | `apps/web/lib/federation/operational-posture-peer-targets.ts` + cron step `reflect-peer-runtime-targets` | Each reported peer becomes an `external-preview` runtime target (`RT-PEER-<link>`), status from freshness, version from the report, host URL from the link's own peer authority — so the coordination map shows both installs without granting a peer the root-portal acceptance role. |


- Read model: local posture (captured live) + every peer-canonical
  `operational-posture` mirror, each stamped with **basis** (local capture vs
  mirrored report from `<install>`) and **age** (`capturedAt`, `lastSyncedAt`);
  a mirror older than the heartbeat + delivery slack renders as stale/`offline`.
- Prod-side view composes both installs into one fleet picture using the shared
  UI primitives and `--dpf-*` tokens.
- Register the peer's runtime targets as summary rows so
  `get_runtime_coordination_map` reflects both installs.

## Traceability

Objective ids and acceptance ids are the scope baseline declared in the design
(`OBJ-OCP-001` … `OBJ-OCP-004`, `AC-OCP-001` … `AC-OCP-006`). Each deliverable
names its objectives, its contract modules, the flow it realises, and the
acceptance ids it proves.

| Deliverable | Objectives | Contract modules | Flow | Acceptance |
|---|---|---|---|---|
| Slice 2.1 — posture record type and minimized projection (BI-0585906E, landed) | OBJ-OCP-002 | `packages/db/src/federated-operational-posture-contract.ts` | FLOW-OCP-PROJECT: projectEstatePayload minimizes the capture and assertNoExcludedEgress refuses hostnames, IPs, node ids and raw findings | AC-OCP-001 |
| Phase A — Slice 2.2 posture flows (BI-27B578C7) | OBJ-OCP-001, OBJ-OCP-002 | `apps/web/lib/federation/operational-posture-capture.ts`, `apps/web/lib/federation/operational-posture-delivery.ts`, `apps/web/lib/federation/operational-posture-exchange.ts`, `apps/web/lib/queue/functions/demand-reconciliation.ts` | FLOW-OCP-REPORT: cron step project-operational-posture writes the local-canonical outbox row, dispatchDueDemand delivers it to the peer inbox, the peer persists a peer-canonical mirror under the version predicate | AC-OCP-001, AC-OCP-006 |
| Phase B — Slice 3 paired-estate surface (BI-27B578C7) | OBJ-OCP-001 | `apps/web/lib/federation/operational-posture-read-model.ts`, `apps/web/lib/federation/operational-posture-peer-targets.ts`, `apps/web/components/ops/PairedEstatePosturePanel.tsx` | FLOW-OCP-RENDER: the read model places the local capture beside every peer-canonical mirror with basis and age, the panel renders one card per installation on /ops/installation, and cron step reflect-peer-runtime-targets registers RT-PEER targets for the coordination map | AC-OCP-002 |
| Edge-node self-healing — stale enrollment supersession and janitor (BI-D4F79CE2, landed in #5148) | OBJ-OCP-004 | `apps/web/lib/edge-node/revoke.ts`, `apps/web/lib/edge-node/stale-supersession.ts`, `apps/web/lib/queue/functions/edge-node-janitor.ts` | FLOW-OCP-HEAL: enrollment of a live installer-managed node supersedes the stale one and the hourly janitor revokes stragglers, so selectMainInstallationNode resolves to exactly one node | AC-OCP-005 |
| Slice 4 — governed control channel (BI-67219237, gated on the WWWD control-scope stance) | OBJ-OCP-003 | `apps/web/lib/federation/operational-action-record.ts` (to be designed once the stance is recorded) | FLOW-OCP-ACT: a peer operational action is a discrete dual-approved record on the trusted link, exposed only after the org WWWD control-scope stance admits control | AC-OCP-003, AC-OCP-004 |

## Backlog coverage

- Decision: decomposed
- Parent: `BI-648F01A0`
- Slice 2.1 posture record type and projection -> `BI-0585906E`
- Phase A Slice 2.2 posture flows -> `BI-27B578C7`
- Phase B Slice 3 paired-estate surface -> `BI-27B578C7`
- Edge-node self-healing -> `BI-D4F79CE2`
- Slice 4 governed control channel -> `BI-67219237`
- Receipt: blocked-by: the coverage receipt is minted by record_plan_backlog_coverage against this plan's immutable blob once this commit is pushed; recorded on BI-648F01A0 by session 5c69eda4

## Not in this plan

Slice 4 (governed action channel) — blocked on the org's WWWD control-scope
stance; see the design spec's Governance section.
