---
title: Mention Uncommitted Changes Before Starting New Work
pageKind: principle
status: published
abstract: When the working tree has uncommitted changes, name them before starting something else.
principleTier: contextual
principleDirection: Disclose uncommitted state before pivoting; never silently leave work in limbo.
principleDimensionVector: {"evidence_density": 0.4, "human_cognitive_load": -0.4, "blast_radius": -0.3}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
principleConsumerArchetype: universal
principleConsumerContexts:
  - engineering-flow
principlePublic: true
principlePublicRationale: Documents the transparency expectation around uncommitted state — agents that pivot without disclosing leave the operator wondering what happened to the prior work.
sources:
  - articles/why-we-ended-up-proposing-two-standards-for-ai-agents
---

## Rule

When the working tree has uncommitted changes and the agent is about to start something else, mention them. Name what's there, whether it should be committed first, stashed, or discarded. Never silently leave work in limbo while pivoting to a new task.

## Why

Uncommitted work is invisible to anyone but the current session — and even the current session loses track if the pivot is large enough. When the operator asks for new work, they expect the agent to either complete the prior work or explicitly hand it off. A silent pivot leaves both pieces of work in a half-state: the prior work has no PR, no commit, no record; the new work proceeds against a working tree that has unexplained modifications. Disclosing the state takes one sentence and prevents the whole class of "what was I doing again?" recovery.

## Applies To

In-platform coworkers running multi-step operations, external coding agents handling user prompts, and humans context-switching mid-task. Applies when the user pivots to a new request and the working tree has unstaged or staged changes from the prior request.

## How To Apply

Before starting a new task, run `git status --short`. If there are uncommitted changes, mention them in the response: "Working tree has uncommitted changes in <paths>. Should I commit them first, stash, or discard?" Then proceed based on the answer. When the operator's new request is a continuation of the prior work (e.g., "OK, do that next"), no disclosure is needed — the uncommitted state is in scope.

## Decision Dimensions

- `evidence_density: 0.4` — uncommitted state is durable but invisible; naming it makes it visible.
- `human_cognitive_load: -0.4` — operators don't have to remember what the agent was doing before they pivoted.
- `blast_radius: -0.3` — silent pivots compound; disclosure prevents the compounding.

## Examples

- **Positive:** Agent finishes editing three files, then the operator asks for a tangential bug fix. The agent responds: "Working tree has uncommitted edits to a.ts, b.ts, c.ts from the spec task. Want me to commit those before pivoting to the bug fix?"
- **Counterexample:** Same scenario, but the agent pivots silently. An hour later the operator says "OK ship the spec task" and the agent has to explain that the spec edits are still in the working tree alongside the bug-fix edits, mixed.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations`.)
