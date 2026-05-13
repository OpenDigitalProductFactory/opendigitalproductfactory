---
title: <Principle name in Title Case>
pageKind: principle
status: draft
abstract: One-sentence summary that mirrors `principleDirection`. This is what passive recall surfaces in coworker prompts.
principleTier: core
principleDirection: Prefer <X> over <Y>.
principleDimensionVector: {"long_term_maintainability": 1.0, "schema_grounding": 0.8, "speed_to_value": -0.4}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principlePublic: false
principlePublicRationale: ""
sources:
  - papers/example-source
  - articles/relevant-article
---

## Rule

One declarative sentence. The shortest possible statement of what this principle requires.

## Why

The strategic rationale. Why does DPF take this position? What incident, standard, or design pressure made this rule necessary? Cite sources via the `sources:` frontmatter array — the viewer renders citations automatically.

## Applies To

Who this principle governs and where. Mirrors `principleAppliesTo` with prose. Name the populations and the contexts they operate in. If the rule does NOT apply in some otherwise-relevant context, say so here — the absence is what makes the principle trustworthy.

## How To Apply

Concrete operating guidance. When you reach a decision that this principle touches, what do you do? What do you check? What do you refuse to do? Two or three sentences.

## Decision Dimensions

Human-readable explanation of the signed dimension vector in `principleDimensionVector`. For each non-zero dimension, name the axis (per `packages/db/src/wiki-taxonomy.ts`) and explain why this principle pulls in that direction with that magnitude. Reviewers should be able to read this section and predict what the vector says without looking at the JSON.

## Examples

- **Positive:** A concrete decision where applying this principle led to the right outcome.
- **Counterexample:** A decision where ignoring this principle (or applying it incorrectly) caused harm.

## Sources

Rendered from the `sources:` frontmatter array via `WikiSourceCitations`. Do not duplicate citation prose here.
