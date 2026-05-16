---
title: Structured Handoffs, Not Conversation History
pageKind: principle
status: published
abstract: Pass decisions and context, not transcripts.
principleTier: core
principleDirection: Hand off structured artifacts; never raw conversation history.
principleDimensionVector: {"long_term_maintainability": 0.6, "schema_grounding": 0.8, "speed_to_value": 0.4}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleConsumerArchetype: ai-coworker-universal
principlePublic: true
principlePublicRationale: Adopters building multi-phase agent workflows need to know that DPF's handoffs are typed artifacts, not transcripts.
sources:
  - articles/why-we-ended-up-proposing-two-standards-for-ai-agents
---

## Rule

When work transitions between agents or between phases, the outgoing agent produces a structured handoff document carrying decisions, evidence, open issues, and user preferences. The incoming agent reads only this document — never the raw conversation history from the previous phase.

## Why

Raw conversation history wastes tokens on context that no longer matters: ideate-phase discussion is noise during a build, and the build agent doesn't need the user's first-pass exploration of options to ship the feature. Structured handoffs distill what the next agent actually needs — the decision, the rationale, the evidence — and let each agent start with a clean context window focused on its task. The token cost reduction is significant in practice: ~16K per call dropping to ~4K with structured handoffs, a 3–4x improvement that compounds across phases.

## Applies To

Every phase transition in Build Studio and any multi-agent workflow. External coding agents producing PRs or spec follow-ups also hand off via structured artifacts (PR description, spec doc, plan doc) rather than raw chat transcripts.

## How To Apply

Define a typed handoff schema for every phase transition (`PhaseHandoff` with `fromPhase`, `toPhase`, `summary`, `evidence`, `openIssues`, `userPreferences`). The outgoing agent writes the handoff; the orchestrator routes the handoff (not the transcript) to the incoming agent. If you find yourself wanting to attach the conversation log, that's a signal the handoff schema is missing a field.

## Decision Dimensions

- `long_term_maintainability: 0.6` — typed handoffs age into documentation; transcripts age into noise.
- `schema_grounding: 0.8` — handoff fields are explicit slots that lint can validate; freeform chat history cannot be reasoned about programmatically.
- `speed_to_value: 0.4` — smaller context windows produce faster, cheaper, more focused agent responses.

## Examples

- **Positive:** The `plan` phase ends with a `PhaseHandoff` document containing the chosen architecture, the rejected alternatives, the constraints surfaced by the user, and the verification checklist. The `build` phase agent reads this and starts coding.
- **Counterexample:** The build agent receives the full `plan` chat transcript including the user's stream-of-consciousness exploration of options. Tokens burn on irrelevant content and the agent has to re-derive what the actual decision was.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)
