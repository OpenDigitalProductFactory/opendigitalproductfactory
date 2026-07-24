---
title: Live State Over Seed Data
pageKind: principle
status: published
abstract: Query the database for current epics, backlog, users, and capabilities. Treat seed.ts as bootstrap defaults only.
principleTier: core
principleDirection: Query live state for current truth; never substitute seed data, generated Prisma files, or stale docs.
principleDimensionVector: {"evidence_density": 0.8, "schema_grounding": 0.5, "speed_to_value": -0.2}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - universal-ring
principleConsumerArchetype: specialist
professionCompetencyLevel: practitioner
principlePublic: true
principlePublicRationale: Adopters need to know that DPF's state is the database, not the seed file — agents quoting stale seed values instead of querying lead to incorrect operational decisions.
sources:
  - articles/why-we-ended-up-proposing-two-standards-for-ai-agents
---

## Rule

For anything that changes after install — current epics, backlog items, users, capabilities, agent state, build status — query the database. Treat `packages/db/src/seed.ts` as bootstrap defaults only; never edit it to represent runtime change, and never read it instead of querying live state.

## Why

Seed data captures the platform's initial state at install time; it does not track what happened after install. An agent that quotes seed values when asked "what's the current backlog?" gives a wrong answer the moment any item is added, moved, or completed — which is approximately immediately. The discipline keeps every agent grounded in the actual operational state, not a synthetic snapshot. The cost is one extra DB query per question, which is negligible compared to the cost of acting on stale data.

## Applies To

In-platform coworkers, external coding agents, and humans operating the platform. Symmetric. Applies to backlog state, user lists, agent state, configuration values, build status, and any data that mutates after install. Does NOT apply to compile-time constants (enum values, schema shape) — those legitimately live in code or seed.

## How To Apply

When the agent needs current state, query the DPF MCP tool surface (`list_backlog_items`, `list_epics`, `get_backlog_item`, etc.) or the Postgres database directly. Say which source was used. Do not read from `packages/db/src/seed.ts` to answer a runtime question. When the MCP server is unavailable, say so and fall back to Postgres explicitly — see the related contextual principle "DB fallback must be explicit" for the exact disclosure pattern.

## Decision Dimensions

- `evidence_density: 0.8` — live state is the densest evidence available; seed data is the lowest.
- `schema_grounding: 0.5` — the schema is the same either way; the principle is about WHERE to read, not WHAT to read.
- `speed_to_value: -0.2` — querying the DB is slightly slower than reading a file; the principle accepts that cost.

## Examples

- **Positive:** Asked "is BI-EBDFBA34 still in-progress?" the agent runs `list_backlog_items` via DPF MCP and answers from the response, naming the source.
- **Counterexample:** The agent answers from `packages/db/src/seed.ts` and reports the status the item had at install time. Six weeks later the item is `done`; the agent's answer is wrong.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations`.)
