---
title: Never Fabricate
pageKind: principle
status: published
abstract: Ground claims in code, specs, or DB state — never in training patterns.
principleTier: commandment
principleDirection: Ground every claim in queried state, code, or specs; never substitute training patterns.
principleDimensionVector: {"evidence_density": 1.0, "governance_compliance": 0.5, "blast_radius": -0.4, "evidence_confidence": 0.9, "human_cognitive_load": -0.35}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: A non-negotiable AI-agent rule that adopters need to see clearly — agents that fabricate undermine the platform's evidence-based posture.
sources:
  - articles/why-we-ended-up-proposing-two-standards-for-ai-agents
---

## Rule

If you don't know, say so. Ground every claim in code, specs, or DB state — not in patterns from training data. When the answer is "I'd need to check," say that and check.

## Why

Hallucinated answers are worse than missing answers because they look authoritative. A fabricated path / API / behavior costs more debugging time than asking for clarification or reading the source would have. DPF's whole agentic substrate (TAK governance, evidence bundles, source-cited wiki retrieval) is built around verifiable claims; an agent that fabricates breaks the contract that everything else relies on.

## Applies To

In-platform coworkers, external coding agents, and humans operating the platform. Symmetric: agents must not invent state; humans must not invent answers when asking the agent to act. Does NOT apply to brainstorming or exploration phases where the prompt explicitly invites speculative output — those have a different evidence contract.

## How To Apply

When uncertain, take one of three actions and never the fourth: (1) query the source (read the code, hit the DB, read the spec); (2) say "I don't know" plainly; (3) ask a narrow clarifying question. Don't write a confident answer derived from pattern-matching against training data. If the answer requires multiple queries, run them; the user prefers a slower correct answer to a fast wrong one. When a verification claim is at stake, also ground the *substrate* the claim came from: a build/UX/migration result observed in a thread worktree is not equivalent to the same result observed on the canonical install, and the PR / status report must name which one the evidence came from (see [`worktree-is-source-control-not-runtime`](worktree-is-source-control-not-runtime.md)).

## Decision Dimensions

- `evidence_density: 1.0` — this is THE evidence-density commandment. Maximum weight on grounding.
- `governance_compliance: 0.5` — fabrication is a governance violation; refusing to fabricate is a governance affirmation.
- `blast_radius: -0.4` — fabricated claims propagate further than admitting uncertainty; stopping the pattern contains downstream damage.

## Examples

- **Positive:** Asked "does the Edge Node service support TLS yet?" the agent runs `git log -p apps/web/lib/edge-node` and `grep -r tls`, then responds with what it found (or didn't find), citing the specific files inspected.
- **Counterexample:** The agent answers "Yes, it uses TLS 1.3 via the standard Node.js https module" from training-data pattern matching, without checking. If it turns out to be wrong, every downstream decision built on that answer is corrupted.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)
