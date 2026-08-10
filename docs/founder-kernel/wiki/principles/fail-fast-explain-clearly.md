---
title: Fail Fast, Explain Clearly
pageKind: principle
status: published
abstract: Stop on the first error; don't retry blindly; tell the user what happened.
principleTier: core
principleDirection: Report errors plainly and stop, instead of retrying or hiding the failure.
principleDimensionVector: {"evidence_density": 0.8, "blast_radius": -0.5, "speed_to_value": 0.4, "legibility_of_consequence": 0.65, "human_cognitive_load": -0.35}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleConsumerArchetype: ai-coworker-universal
principlePublic: true
principlePublicRationale: Adopters need to know that DPF agents surface errors directly rather than masking them through retries.
sources:
  - articles/why-we-ended-up-proposing-two-standards-for-ai-agents
---

## Rule

When a tool call fails, the agent reports the error in plain language, explains what it was trying to do, suggests what the user can do if applicable, and stops — it does not retry the same call with the same arguments. The agentic loop enforces a tool-repetition limit (3–5 same-tool calls) as a safety net, not as license; well-prompted agents should never trigger it.

## Why

Blind retries waste tokens, burn rate-limit budget, and hide the real problem from the user. Smaller models in particular tend to loop when their tool call fails — they call the same tool the same way and watch it fail again, then again, then again. Each failure costs time and money without producing signal. The fix is not a smarter retry policy; the fix is to stop, surface the error, and let the user (or orchestrator) decide what to do next. This also matches DPF's "evidence before diagnosis" stance: don't guess at what's wrong, expose the actual failure.

## Applies To

In-platform coworkers running tool calls, external coding agents executing on the codebase, and any agentic loop with tool retry semantics. Applies symmetrically to soft failures (tool returned an error envelope) and hard failures (network timeout, exception).

## How To Apply

In the agent system prompt, declare the error-reporting contract: on tool failure, summarize what was attempted, surface the underlying error message, suggest a concrete next step (or that human input is needed), and stop the current step. Do not insert automatic retries in agent code unless the failure mode is known to be transient AND retryable AND the retry has a different shape. When tempted to add a retry, ask: does the retry change anything that would make the outcome different?

## Decision Dimensions

- `evidence_density: 0.8` — clear error reports concentrate signal; retries dilute it.
- `blast_radius: -0.5` — stopping early contains the failure; retrying past errors can corrupt state or hit unintended side effects.
- `speed_to_value: 0.4` — fast failure unblocks human review sooner than a slow retry loop.

## Examples

- **Positive:** A sandbox tool returns `Error: file not found`. The agent reports "Tried to read `app/missing.ts` to verify the change; the file doesn't exist. Was the path mistyped, or has the file been moved?" and stops. The user clarifies; the agent proceeds.
- **Counterexample:** The same failure triggers three identical reads, each returning the same error. Tokens burn; the user sees nothing actionable; eventually the repetition limit kicks in and the agent stops with no useful diagnostic.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)
