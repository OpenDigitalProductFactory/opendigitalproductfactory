---
title: Findability Is Part of Capture
pageKind: principle
status: published
abstract: Knowledge isn't captured until the system can find it again; routing and findability are first-class requirements of storing, not an afterthought.
principleTier: core
principleDirection: Treat findability as part of capture — knowledge isn't stored until a retrieval path can surface it again.
principleDimensionVector: {"speed_to_value": 0.5, "long_term_maintainability": 0.4, "evidence_density": 0.4, "human_cognitive_load": -0.3}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleConsumerArchetype: ai-coworker-universal
principleConsumerContexts: []
principlePublic: false
principlePublicRationale: ""
sources:
  - articles/ambient-findability
---

## Rule

Capturing knowledge is not done when it is written down — it is done when the system can find it again. Verify the retrieval path as part of the act of storing.

## Why

Information that cannot be located might as well not exist. A fact written to a place the agent has no routing rule for was not captured, only misplaced — and the cost shows up later as a confident wrong answer, a redundant re-discovery, or tokens burned scanning for something that was "saved." The test the transcript keeps returning to — *can your agent find it again? could you find it again?* — is the honest definition of capture. Findability is a property of the store itself: the slug, the tags, the lane it was routed to, the link that makes it reachable. DPF already has the routing surfaces (AGENTS.md pointers, wiki page-kinds and links, memory tags, the commons lanes); this principle says using them correctly is part of writing the knowledge down, not a separate hygiene pass that may or may not happen.

## Applies To

In-platform coworkers and external coding agents at every capture point: a memory write, a wiki page, a doc save, a backlog note, a routed learning. It does not demand a literal search after every write, but it does demand that the author can name the query that will surface it and has given it the slug, tags, or link that query needs. It does not apply to deliberately ephemeral scratch state, which is not being captured at all.

## How To Apply

When you store knowledge, name the question a future agent will ask to retrieve it, then confirm the thing you just wrote would answer that question — right lane ([[principles/learnings-belong-in-the-shared-commons]]), right slug, right tags, reachable by a link or a routing rule. This composes directly with [[principles/shape-knowledge-for-retrieval]] (shape it for the query) and [[principles/elicit-tacit-knowledge]] (the last step of capturing what you elicited is making it findable). If you cannot state how it will be found, it is not yet captured.

## Decision Dimensions

- `speed_to_value: 0.5` — findable knowledge returns in one retrieval; unfindable knowledge is re-derived from scratch or hunted for across the store.
- `long_term_maintainability: 0.4` — a corpus where everything is reachable stays usable as it grows; orphaned entries accrete into noise that degrades every query.
- `evidence_density: 0.4` — knowledge that can be surfaced actually gets used as grounding; knowledge nobody can find adds no evidentiary value.
- `human_cognitive_load: -0.3` — findability removes the burden of hunting; this principle pulls against the cost of a human or agent searching for knowledge that was "saved" but not routed.

## Examples

- **Positive:** After eliciting an operator's escalation rule, the coworker routes it to the profession corpus under the dispatcher slug and confirms a query for "after-hours escalation" surfaces it — the capture is complete because the retrieval path is proven.
- **Counterexample:** A hard-won constraint is written into a client-local memory file with no tag and no commons route; three sessions later a different agent, unable to find it, re-derives it wrong. It was written down, but it was never captured.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)
