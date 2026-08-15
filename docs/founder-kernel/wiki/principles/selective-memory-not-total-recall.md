---
title: Selective Memory, Not Total Recall
pageKind: principle
status: published
abstract: Remember decisions and rationale; re-derive details from source.
principleTier: core
principleDirection: Store decisions, rationale, and discovered constraints; never raw transcripts.
principleDimensionVector: {"long_term_maintainability": 0.7, "schema_grounding": 0.5, "speed_to_value": 0.4, "data_privacy": 0.7, "capacity_utilization": 0.45}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleConsumerArchetype: ai-coworker-universal
principlePublic: true
principlePublicRationale: Adopters using DPF's memory layer need to know what belongs there and what doesn't, before they fill it with noise.
sources:
  - articles/why-we-ended-up-proposing-two-standards-for-ai-agents
---

## Rule

The memory layer (Qdrant vector store) holds salient context: user decisions, design rationale, cross-conversation insights, discovered constraints, and quality patterns. It does not hold raw conversation transcripts, code content, build artifacts, or transient state — those live in their primary sources (codebase, git, database, build records) and are re-derived on demand.

## Why

Memory should be dense — high information per token — because retrieval surfaces a small number of memories and each one needs to earn its slot. Fewer, more relevant memories beat many marginally relevant ones every time. Raw transcripts, code dumps, and build logs are ephemeral, bulky, and low-signal; storing them turns the memory layer into a noisy archive that degrades retrieval quality for everything else. The primary sources are always available; the memory layer's job is to act as a typed index into knowledge, not a copy of it.

## Applies To

In-platform coworkers using the semantic-recall path and external coding agents managing their own memory systems. Applies symmetrically: agents that write memory must be selective; agents that read memory benefit from the discipline. Does NOT apply to audit logs (which need full traceability) or to immutable evidence records (different retention contract).

## How To Apply

Write memory at natural decision points, not after every exchange. Tag each entry with role, phase, and topic so retrieval stays contextual. Before storing, ask: can this be re-derived from a primary source? If yes, skip it. Specific things that belong: "User chose in-memory state over database for this demo," "Anthropic subscription only gives Haiku access here," "The promoter image is JIT-built from the portal container." Specific things that do NOT belong: chat transcripts, code content, test output, current build state.

## Decision Dimensions

- `long_term_maintainability: 0.7` — disciplined memory ages well; transcript dumps rot fast and pollute future retrieval.
- `schema_grounding: 0.5` — typed memory entries can be linted, versioned, and migrated; freeform blobs cannot.
- `speed_to_value: 0.4` — concise memory speeds prompt assembly; bloated memory slows every agent invocation.

## Examples

- **Positive:** After a build phase, the agent stores: "User prefers Tailwind over CSS modules for this project. Decided 2026-04-15 during the ideate phase." One entry, durable, surfaces in future style decisions.
- **Counterexample:** Storing the full ideate transcript verbatim. Tokens burn on irrelevant exploration; future retrieval pulls up off-topic conversation noise instead of the decision.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)
