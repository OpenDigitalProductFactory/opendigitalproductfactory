---
title: MCP Is the Coordination Plane
slug: mcp-is-the-coordination-plane
pageKind: principle
status: published
abstract: Work tracking and activity coordination live in the DPF MCP substrate — the executor-agnostic source of truth that every delivery surface writes to, regardless of Build Studio. If it isn't in the MCP plane, it didn't happen.
principleTier: core
principleDirection: Claim a capsule and record gate evidence through the DPF MCP plane for every unit of work, on every surface; a surface that works without claiming a capsule and recording evidence is invisible to coordination and cannot advance a gate.
principleDimensionVector: {"governance_compliance": 0.9, "evidence_density": 0.8, "long_term_maintainability": 0.6, "blast_radius": -0.5}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
  - external-coordination
principleConsumerArchetype: universal
principleConsumerContexts:
  - build-studio
  - engineering-flow
  - mcp
---

## Rule

Work tracking and activity coordination are **MCP records**, written by every delivery surface, **regardless of Build Studio**. The DPF MCP substrate is the executor-agnostic source of truth:

- **Work tracking:** `BacklogItem`/`Epic` (intake), `FeatureBuild` (lifecycle + evidence fields), `WorkCapsule` (claim/heartbeat/evidence for a unit of work).
- **Activity coordination:** `claim_capsule_scope` / `heartbeat_capsule` / `release_capsule_scope`; `claim_nonprod_environment_lease` (the shared sandbox); the runtime-coordination map / `RuntimeTarget`.
- **Evidence:** `saveBuildEvidence`, `reviewDesignDoc` / `reviewBuildPlan`, `save_phase_handoff`, `record_external_development_evidence`, `record_runtime_verification`, `record_local_integration_result`.

The rule: **if it isn't in the MCP plane, it didn't happen.**

## Why

Three surfaces can only be peers if there is one place that knows what each is doing. The chaos observed on the live install (2026-06-05) — 119 worktrees nobody reaps, generations of orphaned sidecars, ad-hoc CI images — traces to a **registration gap**, not a path difference: work happened without ever being claimed or recorded, so coordination had nothing to coordinate against. A surface that does work invisibly cannot be de-conflicted, reaped, resumed, or audited. The MCP plane is also what makes a gate provenance-agnostic ([`governance-approves-evidence-not-provenance`](governance-approves-evidence-not-provenance.md)): the gate reads MCP evidence, not the surface's private state.

The sidecars that sessions spawn must be the **DPF MCP** (`/api/mcp/v1` via `DPF_MCP_BEARER_TOKEN`), not generic npx servers (`xcodebuildmcp`, `youtube-transcript-mcp`). A session wired to generic MCP servers instead of DPF's does not coordinate through the substrate at all.

## How To Apply

- Claim a `WorkCapsule` (or equivalent) before starting a unit of work; heartbeat it while active; release it when done.
- Record gate evidence through the MCP evidence tools — never let a "green" live only in a surface's local state.
- Wire the **DPF MCP first**; do not auto-spawn generic MCP servers per session (see AGENTS.md §16 "generic skills are not development precedent").
- When the connector is offline, use the explicit DB fallback path and say so — never substitute seed/stale docs for live coordination state.

## Decision Dimensions

- `governance_compliance: 0.9` — coordination and audit both depend on every surface registering its work.
- `evidence_density: 0.8` — gates advance on recorded evidence, not unrecorded local belief.
- `long_term_maintainability: 0.6` — one substrate to query instead of three private states.
- `blast_radius: -0.5` — unregistered work is the root of sprawl, orphans, and silent collisions.

## Related

- [`one-common-process-three-surfaces`](one-common-process-three-surfaces.md) — the lifecycle this plane coordinates.
- [`governance-approves-evidence-not-provenance`](governance-approves-evidence-not-provenance.md) — gates read MCP evidence, not provenance.
- [`backlog-lives-in-postgresql`](../../../professions/portfolio-management/wiki/backlog-lives-in-postgresql.md) — the canonical intake substrate.
- [`db-fallback-explicit`](db-fallback-explicit.md) — what to do when the connector is offline.
- [AGENTS.md §17](../../../../AGENTS.md) — operational summary.
- [Unified Delivery Surfaces spec §3.2](../../../superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-alignment-design.md) — design context.

## Origin

Unified Delivery Surfaces spec, 2026-06-05 (WWMD-ratified).
