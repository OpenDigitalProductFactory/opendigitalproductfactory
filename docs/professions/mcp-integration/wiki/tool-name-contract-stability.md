---
title: Tool-name contract stability
pageKind: principle
status: published
abstract: A published MCP tool name is a frozen external contract - renames ship as aliases with identical grants and a stated expiry, removals follow the deprecation window, and every alias carries the same authorization rows as its canonical name — an alias without a grant row is an authorization failure, not a soft fallback.
principleTier: core
principleDirection: Treat published tool names as frozen contracts — rename via alias with identical grants and a stated expiry, remove only through the deprecation window, and keep grant rows in lockstep with every callable name.
principleDimensionVector: {"governance_compliance": 0.8, "long_term_maintainability": 0.6, "reusability": 0.4, "blast_radius": -0.5, "speed_to_value": -0.2}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - external-coordination
  - ring-2-workflow
principleConsumerArchetype: specialist
professionCompetencyLevel: practitioner
principlePublic: false
principlePublicRationale: ""
sources:
  - mcp/architecture
  - semver/spec
  - ietf/rfc-9110
---

## Rule

Once a tool name has been advertised on the coordination plane, it is a **public contract**: external CLI clients, peer installs, scheduled jobs, and saved skills all hold it. A rename ships as a **callable-but-unadvertised alias** for a stated window, with the alias carrying *identical* authorization rows to the canonical name — the grant map denies unlisted tools, so an alias missing its grant row silently converts a rename into an authorization failure for every legacy caller. Removal happens only at the end of the declared window, as a governed act. The same discipline covers parameter shapes: widen compatibly within a name; a breaking reshape is a new name plus an alias window.

## Why

The coordination plane's callers are exactly the population that cannot be flash-upgraded: external Claude/Codex/Grok sessions with cached tool catalogs, federated peers on their own release cadence, and persisted automations. Interface stability under evolution is the general contract discipline (semantic versioning's compatibility rules; HTTP's method/status stability), and the platform has a worked precedent: the Workroom canonical rename kept every legacy `*_capsule_*` name callable with identical grants for the alias window, deliberately unadvertised so new callers converge on the canonical names while old callers keep working. This is supersession-as-a-mechanical-act applied to the tool surface — the alias *is* the expand step, and its expiry *is* the contract step's anchor.

## How to apply

Renaming: add the canonical name, keep the old name callable and grant-mapped, record the expiry and its tracking anchor, and stop advertising the old name — all in one change. Reviewing an integration PR: any tool-name change without its alias-and-grants pair is incomplete; any alias without an expiry is a permanent second generation. Scoring options: weigh contract-preserving designs higher on `mcp-integration/protocol_window_conformance` and on `reusability` — a stable name is what makes a skill or scheduled task durable across releases.

## Decision dimensions

- `governance_compliance: 0.8` — grants-in-lockstep is an authorization invariant, not a courtesy.
- `blast_radius: -0.5` — negative: alias windows bound what a rename breaks to zero.
- `long_term_maintainability: 0.6` — expiring aliases keep the surface single-generation over time.
- `speed_to_value: -0.2` — the alias-and-window step costs the renaming PR real scope.

## Related

- [[professions/mcp-integration/mcp-protocol-version-window]] — the revision-level form of the same stability contract.
- [[professions/mcp-integration/coordination-plane-concepts]] — why the grant map denying unlisted tools makes alias grants load-bearing.
