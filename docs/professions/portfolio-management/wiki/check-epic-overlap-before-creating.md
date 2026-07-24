---
title: Check Epic Overlap Before Creating
pageKind: principle
status: published
abstract: Before creating a new epic, query existing epics for overlap. Prefer extending an existing epic; supersede explicitly when warranted.
principleTier: contextual
principleDirection: Search the existing epic list before creating a new one; extend rather than parallel.
principleDimensionVector: {"long_term_maintainability": 0.5, "reusability": 0.4, "schema_grounding": 0.3}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-2-workflow
principleConsumerArchetype: specialist
professionCompetencyLevel: practitioner
principlePublic: true
principlePublicRationale: Adopters managing the DPF backlog benefit from the no-parallel-epic discipline — duplicate epics are a real source of confusion.
sources:
  - articles/why-we-ended-up-proposing-two-standards-for-ai-agents
---

## Rule

Before creating a new epic, query existing epics for overlap (`list_epics` via MCP, or a Postgres query). Prefer extending an existing epic over creating a new one. If the new epic genuinely supersedes an old one, mark the old epic `done` in the same operation so the lineage is explicit.

## Why

Parallel epics for the same conceptual work fracture the backlog: items get filed under the wrong one, status rollups stop being meaningful, and the operator loses the ability to ask "what's the state of X?" with one query. The discipline is cheap (one MCP call) and pays back every time someone looks at the backlog. The platform's epic auto-close mechanism only works if there is one epic per concept; parallel epics break that mechanism silently.

## Applies To

In-platform coworkers managing the backlog (Build Studio, recommendation agents), external coding agents authoring new work, and humans setting product direction. Applies before any `create_epic` call. Does NOT apply to genuinely new conceptual surfaces that don't overlap any existing epic — those legitimately need a new epic.

## How To Apply

Before creating an epic, run `list_epics` (filtered by `hasOpenItems` if appropriate) and search the result for conceptual overlap with the work you're about to file. If overlap exists, extend the existing epic by adding items to it rather than creating a parallel epic. If the new work supersedes an old epic (e.g., a v2 design replaces v1), mark the old one `done` in the same operation and link the new items to the new epic.

## Decision Dimensions

- `long_term_maintainability: 0.5` — consolidated epics age better than fragmented ones.
- `reusability: 0.4` — items filed under the consolidated epic compose with each other; parallel filings don't.
- `schema_grounding: 0.3` — the `Epic` model expects one epic per concept; the principle enforces that constraint.

## Examples

- **Positive:** Before filing EP-PRIN-* for "principles-as-wiki-kind," the implementer runs `list_epics` and finds `EP-TAK-3F9A21` (governed memory + MCP surfaces). The principles work attaches as items under the existing TAK epic instead of creating a parallel.
- **Counterexample:** Same scenario, but the implementer files `EP-PRIN-001` as a parallel epic. Six months later the backlog rollup shows TAK as "92% done" and PRIN as "30% done" — but they're the same conceptual workstream, and the operator can't tell at a glance.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations`.)
