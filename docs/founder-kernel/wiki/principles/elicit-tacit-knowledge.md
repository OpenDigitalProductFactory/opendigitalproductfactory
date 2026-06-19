---
title: Elicit Tacit Knowledge
pageKind: principle
status: published
abstract: The bottleneck is getting knowledge out of the human's head into the system; actively elicit it rather than wait for it to be volunteered.
principleTier: core
principleDirection: Actively elicit tacit knowledge from the people who hold it; do not wait for it to be volunteered or guess in its absence.
principleDimensionVector: {"evidence_density": 0.7, "long_term_maintainability": 0.5, "schema_grounding": 0.3}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleConsumerArchetype: ai-coworker-universal
principleConsumerContexts: []
principlePublic: false
principlePublicRationale: ""
sources:
  - papers/knowledge-acquisition-bottleneck
---

## Rule

When durable knowledge lives only in a person's head, the agent's job is to draw it out with focused, persistent questioning — not to wait for it to be volunteered, and not to guess past the gap.

## Why

The rate-limiting step in any knowledge system is acquisition, not retrieval (the "knowledge acquisition bottleneck"). Modern models and DPF's substrate already retrieve well — semantic search, the wiki, the code graph, the ontology graph. What they cannot do is recall a decision rationale, an operator's hard-won constraint, or a profession technique that was never captured because nobody asked. Tacit knowledge is applied fluently but articulated poorly; it surfaces only under deliberate elicitation. A platform whose kernel grows only when someone happens to write a page is leaving its most valuable asset — the founder's and operators' judgment — stranded in their heads. Asking is the cheap part; the expensive part is the rework, drift, and wrong guesses that follow when the agent proceeds on a gap it could have closed with a question.

## Applies To

In-platform coworkers and external coding agents at any point where a decision, design, or build depends on context the system does not yet hold. It does NOT license interrogation: eliciting is reserved for knowledge that is genuinely tacit and genuinely needed now. What the agent can find by research — in code, specs, the wiki, the live DB — it must find itself first ([[principles/do-the-work-dont-task-the-operator]]). The principle governs the gap that research cannot close.

## How To Apply

Research first, then ask only the genuine gaps — never make the human re-tell what the system already knows. Interview one focused question at a time and drill on vague answers rather than dumping a questionnaire. Decide how the answer will be retrieved later before you capture it ([[principles/shape-knowledge-for-retrieval]]), store the decision and its rationale rather than the transcript ([[principles/selective-memory-not-total-recall]]), then route it to the shared commons so every agent inherits it ([[principles/learnings-belong-in-the-shared-commons]]). Capture into the scope that owns the knowledge — the founder kernel (WWMD), the organization's corpus (WWWD), or a profession corpus (WSID) ([[principles/decisions-belong-to-their-scope]]); a freshly-installed organization whose WWWD is still template-seeded is the prime elicitation target. Stop when new questions stop surfacing new knowledge.

## Decision Dimensions

- `evidence_density: 0.7` — elicited tacit knowledge is the highest-signal grounding a platform can hold; it cannot be re-derived from any other source.
- `long_term_maintainability: 0.5` — knowledge captured once compounds across every future session; knowledge left in a head is re-discovered (or lost) over and over.
- `schema_grounding: 0.3` — elicitation that targets a known retrieval shape produces structured, queryable knowledge rather than prose nobody finds.

## Examples

- **Positive:** Before building a dispatch feature, the coworker researches the existing storefront archetype, then asks the operator three targeted questions about the one thing the code can't reveal — how their dispatchers actually triage after-hours calls — and captures that rationale as a profession technique routed to the corpus.
- **Counterexample:** The agent infers a plausible-sounding triage rule from general training, ships it, and only discovers at UX verification that the operator's real process is the opposite — a wrong guess where one question would have closed the gap.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)
