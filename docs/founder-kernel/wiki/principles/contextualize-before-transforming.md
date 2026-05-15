---
title: Contextualize before transforming
pageKind: principle
status: published
abstract: Prefer mapping the existing operating model against a new standard before changing the operating model. Adoption follows mapping; transformation follows adoption. Skip the first step and the second never lands.
principleTier: core
principleDirection: Prefer mapping the existing operating model against a new standard before changing the operating model.
principleDimensionVector: {"human_cognitive_load": -0.7, "blast_radius": -0.6, "governance_compliance": 0.4, "speed_to_value": -0.2}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principlePublic: false
principlePublicRationale: ""
sources:
  - articles/open-group-2017-managing-business-of-it
---

## Rule

When introducing a standard, framework, or new operating model, map the current state onto it first. Change the operating model only after the mapping has produced a shared vocabulary and shared evidence of where the gaps actually are.

## Applies To

In-platform coworkers, external coding agents, and human operators leading change. Coworkers and agents must resist proposing "transform X to Y" when the gap between current X and target Y has not yet been articulated in the target's vocabulary. Humans must resist framing standards adoption as transformation, especially in conversations with executives who reached their position by experience with what currently works.

## Why

Executives reach their position by experience with what works. Introducing a "new framework" feels like a threat to that experience — it implies the current operating model is wrong, which implicates the people who built it. Resistance is rational.

Contextualization side-steps the threat. It says: your operating model exists; it works; let's name it in the standard's vocabulary so we can compare. Where the standard adds value, you adopt it deliberately. Where your current model is already strong, you keep it. The standard becomes a tool, not a verdict.

The same dynamic plays out below the executive layer. Engineering teams reject "transform to IT4IT" and accept "let's map our ITIL processes onto the IT4IT value streams and see where the gaps are." The mapping creates the artefact that later change-work can be grounded in. Without it, transformation work argues against shadow versions of the current state held in different heads.

## How To Apply

When facing a standards-adoption decision, ask: do we have the current state mapped into the target's vocabulary? If not, that's the next step — not deciding which parts to transform. Resist questions of the form "should we adopt X?" until they've been reframed as "where is our current model the same or different from X, and where does X add value we don't have?" Produce the mapping artefact before recommending changes; it grounds every subsequent conversation.

## Decision Dimensions

- `human_cognitive_load: -0.7` — the strongest pull. Contextualization works because it reduces the cognitive threat of the new framework. Options that demand executives discard mental models they trust will be rejected regardless of technical merit.
- `blast_radius: -0.6` — mapping is bounded; transformation is not. The principle prefers options whose failure mode is "the mapping was wrong" over options whose failure mode is "the operating model is broken."
- `governance_compliance: 0.4` — the mapping artefact is what subsequent compliance, audit, and review work attach to. Without it, compliance work is repeated inference.
- `speed_to_value: -0.2` — modest concession. Mapping is slower than charging into transformation. The principle accepts that cost because skipping the mapping makes the transformation itself slower or impossible.

## Examples

- **Positive:** A federal CIO wants to align IT operations to FITARA and FEA. The architect leads with "let's contextualize our current operating model against IT4IT — how is what we do today the same or different?" The mapping produces a small, named set of gaps; transformation work scopes to those gaps and ships in stages.
- **Counterexample:** A "we're transforming to TOGAF this year" announcement lands on a team that already has a working operating model. Within a quarter the announcement has produced two consultancies, no mapping, escalating resistance, and a planning artefact that bears no relation to how work actually flows. The mapping step was skipped; transformation never anchors.

## When this does not apply

- Greenfield. There is nothing to contextualize against; pick a standard and build to it.
- Compliance-driven adoption where the standard is externally mandatory. Mapping is still useful internally, but the framing externally is different.

## See also

- Originating stance: `[[stances/contextualize-dont-transform]]`
- Heuristic: `[[heuristics/contextualize-before-transforming]]` — the mechanic in operational form.
- Heuristic: `[[heuristics/find-at-least-one-champion]]` — without a champion, the contextualization conversation doesn't start.
- Heuristic: `[[heuristics/pitch-simple-adjust-per-audience]]` — language matters; pick the right framing per audience.
- Stance: `[[stances/it4it-is-substrate]]` — the standard most often being contextualized.
- Entity: `[[entities/it4it]]`
