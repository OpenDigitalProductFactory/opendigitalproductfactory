---
title: Diversity of Thought in Agent Design
pageKind: principle
status: published
abstract: Different agents should think differently, not just have different tools.
principleTier: core
principleDirection: Define perspective, heuristics, and interpretive model for every agent role.
principleDimensionVector: {"long_term_maintainability": 0.5, "evidence_density": 0.6, "blast_radius": 0.3}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleConsumerArchetype: ai-coworker-universal
principlePublic: true
principlePublicRationale: Documents why DPF agents have distinct cognitive frames, not just different tool lists — adopters designing their own coworkers need this guidance.
sources:
  - articles/why-we-ended-up-proposing-two-standards-for-ai-agents
---

## Rule

Each agent's system prompt defines three cognitive components: a perspective (how it frames the problem), heuristics (strategies for finding solutions), and an interpretive model (what "good" means). These are not decorative — they determine which solutions the agent considers and which it misses.

## Why

A team of diverse "good enough" agents outperforms a single "best" agent on complex problems. Different perspectives reveal different solution peaks; on a rugged problem landscape, no single optimization target finds them all. The IT4IT value streams already encode this — distinct roles (engineer, ops, product, QA) optimize for different things on purpose. Tool diversity alone is insufficient: two agents with different tools but identical prompts converge on the same generic answer.

## Applies To

In-platform coworkers and any external agent topology with multiple roles. When a complex problem requires multiple perspectives, the orchestrator consults several specialists and combines their output. The principle does not apply to single-agent workflows (no diversity to architect) or to UI affordances (which are not agents).

## How To Apply

For every new agent role, declare its perspective, heuristics, and success criteria in the system prompt. Example: the Software Engineer agent's perspective is "code structure," its heuristic is "test-driven development," its interpretive model is "correctness over speed." The Operations Engineer reads the same problem through "deployment safety," uses "rollback-first deployment," and optimizes for "availability." If two agent roles end up with the same three components, one of them is redundant.

## Decision Dimensions

- `long_term_maintainability: 0.5` — diverse cognitive frames produce robust solutions that survive context shifts; monoculture solutions break under stress.
- `evidence_density: 0.6` — multiple perspectives surface evidence a single perspective would miss; the combined output is information-richer per token.
- `blast_radius: 0.3` — diversity adds review pressure; an over-optimized single perspective is more likely to ship a defect that the other perspective would have caught.

## Examples

- **Positive:** When deciding whether to refactor a module, Build Studio consults the Architect (cares about long-term maintainability) and the Software Engineer (cares about immediate correctness). The orchestrator weighs both views before scheduling the refactor.
- **Counterexample:** Three agents with identical system prompts but different names. Each gives the same answer; the apparent diversity is fake; the orchestrator picks one arbitrarily and ships the same single perspective.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)
