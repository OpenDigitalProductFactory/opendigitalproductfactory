---
title: One Common Process, Three Peer Surfaces
slug: one-common-process-three-surfaces
pageKind: principle
status: published
abstract: DPF delivers software through three interchangeable delivery surfaces — Claude Code, Codex CLI, embedded Build Studio. They are peers, not a hierarchy. All three advance the same evidence-gated lifecycle; a gate reads only its required evidence and never branches on which surface produced it.
principleTier: core
principleDirection: Run all three delivery surfaces through the one governed lifecycle (ideate → plan → build → review → ship) advanced by evidence at each gate; never privilege one surface, and never let work depend on any single surface being healthy.
principleDimensionVector: {"long_term_maintainability": 0.9, "governance_compliance": 0.7, "blast_radius": -0.6, "reusability": 0.6}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
  - ring-4-sandbox-prod
principleConsumerArchetype: universal
principleConsumerContexts:
  - build-studio
  - engineering-flow
---

## Rule

DPF delivers software through **three interchangeable delivery surfaces**: Claude Code, Codex CLI, and the embedded Build Studio. They are **peers**, not a hierarchy. None is privileged; work never depends on any one being healthy. All three advance the **one common governed lifecycle** — the Build Studio state machine `ideate → plan → build → review → ship`, advanced by **evidence at each gate**, right-sized by a `(type × size)` policy matrix. The phase graph never changes; a skipped phase gets an auto-pass gate. Each transition runs the gate check — nothing is rubber-stamped, regardless of surface.

## Why

The enabling principle already exists and is operator-ratified: [`governance-approves-evidence-not-provenance`](governance-approves-evidence-not-provenance.md). A gate reads only its required evidence fields and never branches on *who* produced them — which is exactly what makes three surfaces interchangeable. When the surfaces are not declared peers under one process, they diverge: one gets treated as primary, the others route around it, and the lifecycle fragments into three incompatible flows. The process is **provenance-agnostic by design** so it survives any surface being down, slow, or mid-upgrade.

The interactive surfaces (Claude/Codex) produce evidence and call the gate directly through MCP. The embedded surface (Build Studio) keeps its auto-advance engine but must converge on the **same gate/evidence contract**. Stabilizing that engine is the engine-first priority (spec §7 Q4) so Build Studio is a true peer surface, not a workaround the other two route around indefinitely.

## How To Apply

- Run every delivery — by any surface — through the same lifecycle phases and the same gate checks.
- Right-size with the `(type, size)` policy: a chore-small skips ideate+review; a doc drops UX/acceptance; an xlarge decomposes. Skipped phases auto-pass; they are never deleted from the graph.
- Never add a gate branch that reads the producing surface. If a gate would behave differently for Claude vs. Codex vs. Build Studio, that is the bug.
- Never treat a single surface as the system of record for *whether work happened* — that belongs to the MCP coordination plane ([`mcp-is-the-coordination-plane`](mcp-is-the-coordination-plane.md)).

## Decision Dimensions

- `long_term_maintainability: 0.9` — one lifecycle to maintain instead of three divergent ones.
- `governance_compliance: 0.7` — every delivery passes the same evidence gates.
- `blast_radius: -0.6` — no single surface outage can stall delivery.
- `reusability: 0.6` — the same gate/evidence contract serves any future surface.

## Related

- [`governance-approves-evidence-not-provenance`](governance-approves-evidence-not-provenance.md) — the keystone that makes surfaces interchangeable.
- [`mcp-is-the-coordination-plane`](mcp-is-the-coordination-plane.md) — the executor-agnostic source of truth all three write to.
- [`architecture-over-shortcuts`](architecture-over-shortcuts.md) — converging on one contract over per-surface shortcuts.
- [AGENTS.md §17](../../../../AGENTS.md) — operational summary.
- [Unified Delivery Surfaces spec §3.1, §7](../../../superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-alignment-design.md) — design context and WWMD decisions.

## Origin

Unified Delivery Surfaces spec, 2026-06-05 (WWMD-ratified). Operator framing: "Build Studio is a 3rd delivery process like Claude and Codex, but more embedded."
