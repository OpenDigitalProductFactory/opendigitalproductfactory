---
title: DB Fallback Must Be Explicit
pageKind: principle
status: published
abstract: When the DPF MCP backlog tools are unavailable, query Postgres directly AND say you used DB fallback.
principleTier: contextual
principleDirection: When falling back to direct Postgres, name the fallback path in the response.
principleDimensionVector: {"evidence_density": 0.6, "governance_compliance": 0.4, "human_cognitive_load": -0.3}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleConsumerArchetype: ai-coworker-universal
principleConsumerContexts:
  - mcp
  - data-model
principlePublic: true
principlePublicRationale: Adopters consuming agent responses need to know which retrieval path produced the answer — silent fallbacks confuse downstream debugging.
sources:
  - articles/why-we-ended-up-proposing-two-standards-for-ai-agents
---

## Rule

When the DPF MCP backlog tools are unavailable in the current agent session, query the live Postgres database directly AND say that DB fallback is in use. Do not substitute `packages/db/src/seed.ts`, generated Prisma files, or stale docs for current backlog state. The disclosure is a one-line addition to the response.

## Why

A silent fallback corrupts the downstream debugging chain. If an operator sees an unexpected answer and the agent didn't say which retrieval path produced it, the operator can't tell whether the agent used the MCP tools (and the MCP returned wrong data) or fell back to Postgres (and the agent queried a stale slot). Naming the path eliminates that ambiguity; the operator knows immediately where to look for the bug. The principle is about transparency of provenance, not about the fallback itself — the fallback is fine, the silent fallback is the failure mode.

## Applies To

In-platform coworkers and external coding agents using the DPF MCP backlog surface. Does NOT apply when the MCP tools are working as expected — those calls don't need a disclosure.

## How To Apply

When an MCP tool call fails or the MCP server is unavailable, log the failure, fall back to a direct Postgres query, and add a one-liner to the response: "DB fallback in use; MCP backlog tools were unavailable for this query." Then proceed with the answer. The operator now knows which path produced the data and can correlate any unexpected results with the fallback rather than the tool layer.

## Decision Dimensions

- `evidence_density: 0.6` — naming the provenance keeps the response auditable; silent fallbacks lose that audit.
- `governance_compliance: 0.4` — the disclosure pattern is part of DPF's transparency contract for agent responses.
- `human_cognitive_load: -0.3` — operators don't have to chase down "why is this weird?" when they can see the path the agent used.

## Examples

- **Positive:** Asked "what's the BI list for EP-X?", the agent tries `list_backlog_items` via MCP, gets a connection error, falls back to Postgres, and responds: "DB fallback in use. Items under EP-X: ..."
- **Counterexample:** Same scenario, but the agent silently falls back and answers as if MCP worked. Operator sees rows that don't match the expected list; debugging the MCP server takes an hour before someone notices the agent never actually hit it.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations`.)
