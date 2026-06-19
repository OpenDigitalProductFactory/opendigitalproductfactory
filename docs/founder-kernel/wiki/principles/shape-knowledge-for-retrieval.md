---
title: Shape Knowledge for the Retrieval Question
pageKind: principle
status: published
abstract: Decide how knowledge will be queried before you decide how to store it; let the question shape the schema, not the reverse.
principleTier: core
principleDirection: Design how knowledge is stored from how it will be retrieved, not the other way around.
principleDimensionVector: {"schema_grounding": 0.7, "long_term_maintainability": 0.6, "speed_to_value": 0.3}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleConsumerArchetype: ai-coworker-universal
principleConsumerContexts: []
principlePublic: false
principlePublicRationale: ""
sources:
  - articles/design-from-access-patterns
---

## Rule

Before deciding how to store a piece of knowledge, decide how it will be asked for later — and let that retrieval question determine the shape, location, and metadata of what you store.

## Why

How knowledge is accessed determines how it should be put in. A basketball is round because the hoop is round; storage designed without its retrieval pattern in mind forces expensive reshaping, full scans, or — worse — silently wrong answers later. This is the lesson NoSQL modeling learned the hard way (enumerate access patterns first, then model), and it generalizes across DPF's entire knowledge substrate. A meeting captured as embedded chunks answers "find the part about X" well but answers "summarize the whole meeting" badly, because the retrieval shape was never matched to the question. The same data, stored in the shape its dominant query needs, is the difference between a knowledge layer the platform trusts and one it routes around. Choosing the mechanism — markdown page, memory entry, vector chunk, graph edge, profession-corpus slug — is a retrieval decision first and a storage decision second.

## Applies To

In-platform coworkers and external coding agents whenever they decide where and how to persist knowledge: authoring a wiki page, writing a memory entry, projecting a code-graph node, tagging a corpus document, or choosing whether something becomes a markdown file, a vector chunk, or a graph relationship. It does not require predicting every future query — only naming the dominant one the knowledge exists to answer.

## How To Apply

State the question this knowledge must answer later, in one sentence, before choosing its form. Pick the storage mechanism that answers that question cheapest: a whole-document markdown file when the query needs full context, a typed memory entry when the query is "what did we decide about X," a vector chunk when the query is "find the snippet near Y," a graph edge when the query traverses relationships. Tag it with the role, phase, and topic the retrieval will filter on. If you cannot name how it will be queried, you are not ready to decide how to store it.

## Decision Dimensions

- `schema_grounding: 0.7` — this principle is the discipline of grounding the schema in real access patterns rather than aspirational structure.
- `long_term_maintainability: 0.6` — knowledge shaped for its query ages well; a model built without its retrieval pattern is reshaped repeatedly as queries arrive.
- `speed_to_value: 0.3` — the right shape returns the right answer in one cheap retrieval instead of a scan, a re-chunk, or a wrong result.

## Examples

- **Positive:** A quarter's objectives are stored as one whole markdown file because the dominant query is "summarize where we are this quarter" — full-context retrieval — rather than chunked, which would answer only "find the snippet about objective 7." See [[principles/findability-is-part-of-capture]] for the retrieval test this enables.
- **Counterexample:** A thousand rules dumped into a single document that an agent must read end-to-end to answer "what is rule 17," when the query pattern ("recall one rule by number") called for addressable per-rule entries.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)
