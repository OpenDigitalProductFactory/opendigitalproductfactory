---
title: MCP protocol version window
pageKind: principle
status: published
abstract: The coordination plane supports the current MCP protocol revision plus one previous — a stated N/N-1 window with a written retirement procedure — while internal AI-coworker surfaces standardize on stateless per-call MCP. Version support is a contract with external clients, not an accretion of whatever revisions once worked.
principleTier: core
principleDirection: Hold the externally advertised MCP protocol surface to a current-plus-one-previous version window with a written retirement procedure; move internal coworker surfaces to stateless per-call MCP; never let version support accrete silently.
principleDimensionVector: {"governance_compliance": 0.8, "long_term_maintainability": 0.7, "operational_independence": 0.4, "blast_radius": -0.4, "speed_to_value": -0.1}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - external-coordination
principleConsumerArchetype: specialist
professionCompetencyLevel: practitioner
principlePublic: true
principlePublicRationale: External MCP clients and peer installs need the version window stated as a contract they can plan against.
sources:
  - mcp/architecture
  - semver/spec
---

## Rule

The externally advertised MCP protocol surface supports exactly **the current revision and one previous** (N/N-1). Retiring a revision is a governed act under a written procedure in the MCP authorization runbook — announce, window, remove — never a silent drop, and never the inverse failure of keeping every revision that ever worked. Internal AI-coworker surfaces do not ride the compatibility window: they standardize on **stateless per-call MCP** with no server-side session affinity, so coworker fan-out scales horizontally with the fleet.

**Ratification note:** the N/N-1 window is operator-directed (2026-08-16 architecture pass §3.4) with formal ratification tracked as W12; this page carries the working contract and is updated if the ratified window differs.

## Why

Version-support decisions compound in both directions. Supporting too few revisions strands external clients that have not adopted the newest protocol — many real MCP clients lag by a revision. Supporting too many is silent contract accretion: the platform's transport was found advertising three revisions with no stated policy, meaning every revision-specific behavior had to be maintained indefinitely because nothing said when it could stop. A dependency-window norm (support the current and previous release lines) gives both sides a plannable contract. Statelessness for internal surfaces is a separate, performance-motivated rule: a coworker loop that requires session affinity cannot fan out across instances, and the session-JWT seam already exists to build on.

## How to apply

When touching the MCP transport: check the advertised revision list against the window; a third revision present means a retirement is overdue — follow the runbook procedure rather than deleting inline. When building internal coworker tooling: no server-side session state; every call carries what it needs. When evaluating integration options, score window-conformant designs higher on `mcp-integration/protocol_window_conformance`; an option that pins to a retired revision or demands indefinite multi-revision support is buying vendor-lock-in-shaped debt inside our own protocol.

## Decision dimensions

- `governance_compliance: 0.8` — the window is a stated contract; conformance to it is checkable.
- `long_term_maintainability: 0.7` — bounded version support is what keeps transport code single-generation.
- `blast_radius: -0.4` — negative: a stated window bounds what a retirement breaks.
- `operational_independence: 0.4` — stateless internal calls remove the shared-session choke point.

## Related

- [[professions/mcp-integration/coordination-plane-concepts]] — the plane whose external contract this bounds.
- [[professions/mcp-integration/tool-name-contract-stability]] — the same contract discipline applied to tool names.
