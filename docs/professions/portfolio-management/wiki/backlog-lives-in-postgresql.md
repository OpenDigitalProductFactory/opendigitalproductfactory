---
title: Backlog Lives in PostgreSQL
pageKind: principle
status: published
abstract: Always query live backlog state from the database. Don't substitute seed data, stale docs, or pattern-matched guesses.
principleTier: core
principleDirection: Query the live Postgres backlog before planning or changing backlog work.
principleDimensionVector: {"evidence_density": 0.8, "schema_grounding": 0.6, "speed_to_value": -0.2}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-2-workflow
principleConsumerArchetype: specialist
professionCompetencyLevel: practitioner
principlePublic: true
principlePublicRationale: Adopters need to see the backlog discipline up front — DPF treats backlog as live operational state, not as documentation.
sources:
  - frameworks/it4it-v3
---

## Rule

Backlog state (`Epic`, `BacklogItem`) lives in PostgreSQL. Always query live state before planning or changing backlog work. Use the DPF MCP backlog tools when available; fall back to direct Postgres queries when the MCP server is offline; never substitute `packages/db/src/seed.ts`, generated Prisma files, or stale docs for current backlog state.

## Why

The backlog is the platform's authoritative record of what needs doing and what's been done. Agents that reason about backlog from anywhere other than the live database are wrong as often as the data has changed — which is constantly. Even the seed file's view is correct only at install time. The MCP tool surface exists to make the live-query path cheap and routine; the principle is to use it instead of cached or inferred state.

## Applies To

In-platform coworkers managing backlog (Build Studio, recommendation agents), external coding agents working from the backlog (Claude, Codex picking up items), and humans operating the platform. Symmetric. Applies to epic state, item state, ownership, priority, status, and any related field.

## How To Apply

Use the DPF MCP backlog tools first when available: `list_backlog_items`, `get_backlog_item`, `create_backlog_item`, `update_backlog_item_status`, `list_epics`, `link_backlog_item_to_epic`, `search_specs_and_plans`, `record_execution_evidence`. The MCP endpoint is `/api/mcp/v1` and the connector is configured via the untracked `.mcp.json` generated from Admin > Platform Development. When the MCP server is unavailable, query Postgres directly AND say "DB fallback in use" so downstream consumers know which path produced the answer.

## Decision Dimensions

- `evidence_density: 0.8` — live DB state is the densest backlog evidence available; everything else degrades.
- `schema_grounding: 0.6` — `Epic` and `BacklogItem` are typed; live queries respect the typing; cached substitutes lose it.
- `speed_to_value: -0.2` — querying takes a round trip; the principle accepts the latency.

## Examples

- **Positive:** Asked "what's open under EP-TAK-3F9A21?", the agent runs `list_backlog_items` with `epicId: "EP-TAK-3F9A21"` and reports the rows it got back, naming the source. If the user pushes back ("I thought BI-X was in-progress"), the agent re-queries to confirm.
- **Counterexample:** The agent answers from a memory entry stored a week ago. Three items have shifted status since then; the agent's answer misrepresents the current backlog and the user makes a wrong decision based on it.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations`.)
