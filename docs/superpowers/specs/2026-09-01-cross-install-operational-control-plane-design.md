---
status: draft
---

# Cross-Install Operational Control Plane

**Backlog item:** `BI-648F01A0`
**Epic:** `EP-8B03CB06` (Per-install edge reachability & connectivity topology — federation)
**Status:** Draft — for operator review

## Purpose

Make the **production instance** the single place to see and manage the operational footprint of every paired same-organization install — starting with a production instance and its paired same-organization **development** install (a trusted `same-org-peer` federation link on the LAN). Today an operator must log into each install to run it; this closes that seam.

This realizes the operator's **vertical-integration** stance ("one canonical platform, fewer seams; own inward") at the operational layer, and it extends the existing federation substrate rather than adding a parallel control plane.

## Problem

DPF already federates two of the three cross-install planes over a trusted same-org link; the third is missing:

| Plane | State today | Mechanism |
|---|---|---|
| **Demand** (backlog/work) | ✅ working | open items projected as demand-envelopes over trusted same-org links (`demand-reconciliation.ts`) |
| **Incident / security-case** | ✅ working | `FederatedRecordMirror` record types, canonical-side-owned |
| **Operational posture + control** | ❌ absent | per-install only |

Concretely, on the production instance: `get_runtime_coordination_map` returns only **localhost** runtime targets (the peer's runtimes are not registered here); patch posture (`list_patch_posture`), AI-platform posture (`get_ai_platform_posture`), and estate posture (`summarize_estate_posture`) all read **this** install's estate only; and there is no governed way to act on the peer. A prerequisite operational defect also exists: an **Edge Node enrollment conflict** (two installer-managed nodes claim this install), which suppresses nearby discovery until resolved.

## Research & Benchmarking

Cross-fleet operational management is a solved shape elsewhere; the useful axis is **pull-vs-push telemetry** and **visibility-vs-control separation**:

- **GitOps fleet controllers (Argo CD ApplicationSets, Rancher Fleet):** a central plane holds desired state and each managed cluster reconciles toward it; the hub reads status, the spoke owns mutation. **Adopt:** the canonical-side-owns-mutation rule (already our `reconcileMirror` invariant); a spoke never has its state overwritten by the hub — the hub proposes, the spoke reconciles.
- **Mesh identity (Tailscale/Teleport):** trust is a mutually-approved link, and capability is scoped per-link. **Adopt:** we already have this — the trusted same-org `FederationLink` with dual approval and minimum-necessary shared scope. **Reject:** a standing always-on remote shell; operational *actions* must be discrete, dual-approved, and audited, not ambient.
- **Observability pull (Prometheus federation):** the hub scrapes read-only metrics from spokes on an interval. **Adopt:** operational *posture* (version, patch state, health, resource footprint) rides the same periodic reconciliation the demand plane already uses — as a new read-only record type — rather than a new transport or an inbound listener.

**What DPF adopts:** extend `FederatedRecordMirror` with an `operational-posture` record type (canonical = the reporting install), projected read-only to the peer over the existing trusted link on the existing reconciliation cadence; keep control actions as discrete dual-approved records. **What DPF rejects:** a parallel management transport, an always-on remote-control channel, and any hub-overwrites-spoke model.

## Objectives

1. **OBJ-OCP-001:** From the production instance, an operator sees each paired install's version, patch posture, health, and resource footprint without logging into it.
2. **OBJ-OCP-002:** Cross-install operational state rides the existing trusted same-org link (minimum-necessary projection, canonical-owned), not a new transport.
3. **OBJ-OCP-003:** Any operational *action* on a peer (patch, upgrade, teardown) is discrete, dual-approved, and audited — mirroring demand-sharing governance — and is gated by the org's WWWD control-scope stance.
4. **OBJ-OCP-004:** Honest cross-install operational state is not blocked by a stale edge-node/enrollment conflict.

## Acceptance

| Acceptance | Objectives | Requirement | Evidence |
|---|---|---|---|
| AC-OCP-001 | OBJ-OCP-001, OBJ-OCP-002 | An `operational-posture` `FederatedRecordMirror` type carries version/patch/health/resource footprint, canonical = reporting install, projected read-only over a trusted same-org link. | test |
| AC-OCP-002 | OBJ-OCP-001 | A prod-side surface renders the paired estate's posture (both installs) sourced from those mirror records, honest about age/basis. | ux |
| AC-OCP-003 | OBJ-OCP-003 | A peer operational action is a discrete record requiring dual approval; a non-canonical write is a conflict, never an overwrite. | test |
| AC-OCP-004 | OBJ-OCP-003 | The visibility-only vs control scope is read from the org WWWD stance before any action channel is exposed. | gate |
| AC-OCP-005 | OBJ-OCP-004 | `selectMainInstallationNode` resolves to exactly one installer-managed node; the enrollment-conflict state is cleared and nearby discovery reports healthy. | ux |
| AC-OCP-006 | OBJ-OCP-002 | No new schema table, no new transport, no parallel registry — the plane composes `FederatedRecordMirror`, the runtime-target registry, and the demand-reconciliation cadence. | gate |

## Design

### Slice 1 — resolve the enrollment conflict (prerequisite, no new code)
Revoke the stale offline installer-managed node so `selectMainInstallationNode` (`apps/web/lib/edge-node/readiness.ts:312`) resolves to one candidate; nearby-discovery health flips from "Enrollment conflict / unavailable" to healthy. This is operator-gated (irreversible trust action).

### Slice 2 — operational-posture projection (read-only)
Add `operational-posture` to `FEDERATED_RECORD_TYPES` (`packages/db/src/federated-record-sync.ts:9`) with a real writer (unlike the declared-but-unwired `backlog-item`/`epic` types). Each install is canonical for its own posture record: version/served-SHA, patch-posture summary, estate/health rollup, runtime-target inventory, resource footprint. The demand-reconciliation job (`apps/web/lib/federation/demand-reconciliation.ts`) — or a sibling on the same cadence — projects it to trusted same-org peers at minimum-necessary granularity. The peer never mutates it (`reconcileMirror` conflict rule).

### Slice 3 — the paired-estate surface
A prod-side operational view composes the local posture with the mirrored peer posture into one fleet picture, stating the **age and basis** of each install's data (per EP-ASSURANCE-HONESTY — and the same honesty defect tracked in `BI-DD93808A`). Register the peer's runtime targets so `get_runtime_coordination_map` reflects both installs.

### Slice 4 — governed action channel (gated on the WWWD stance)
Only after the operator records how much *control* (vs visibility) to centralize: a peer action (patch/upgrade/teardown) is a discrete `FederatedRecordMirror` record the peer install reconciles and executes locally under its own gates, dual-approved and audited. No ambient remote control.

## Governance

The **control-vs-visibility scope** is a WWWD (business) decision — it belongs on the org stance surface, not `principle_decide`. Slices 1–3 (visibility) are low-risk platform work; Slice 4 (control) must not ship until the stance is recorded. The just-published "How we build — vertical integration" stance is the strategic driver; a specific control-scope stance is the gate for Slice 4.

## Not in scope

- True Epic/BacklogItem replication (a full mirror) — the declared-but-unwired `backlog-item`/`epic` record types; operational work rides `operational-posture`, and demand continues via demand-envelopes (open items only).
- Cross-**organization** operational management — this is same-org only.

## Related

- Findings + requirement: `BI-648F01A0`. Banner-honesty defect: `BI-DD93808A`.
- Federation substrate: `apps/web/lib/federation/`, `packages/db/src/federated-record-sync.ts`, `packages/db/prisma/schema/edge-federation.prisma`.
- Edge readiness / conflict: `apps/web/lib/edge-node/readiness.ts`.
