---
title: Scope a PR to One Clean Revert
pageKind: principle
status: published
abstract: Scope a PR to what one reviewer can hold and one revert can cleanly undo. Batch related work rather than paying a serialized gate run per concern.
principleTier: core
principleDirection: Scope a PR by what a reviewer can hold and a revert can cleanly undo, not by counting concerns.
principleDimensionVector: {"long_term_maintainability": 0.6, "governance_compliance": 0.45, "blast_radius": -0.4, "human_cognitive_load": -0.45, "operator_effort": -0.45, "evidence_density": 0.35}
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
principlePublicRationale: Reviewers and adopters benefit from PRs that revert cleanly — but a split that buys nothing costs a scarce serialized gate run.
sources:
  - articles/why-we-ended-up-proposing-two-standards-for-ai-agents
---

## Rule

Scope a PR to **what one reviewer can hold in their head and what one revert can cleanly undo**. Branches are still named by intent: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `doc/<slug>`, `clean/<slug>`.

Batch freely when the changes share a surface, a subsystem, or a reason to exist. **Split when — and only when — a split buys something specific:**

- a reviewer would otherwise be unable to tell which lines did which job;
- a revert would otherwise have to choose between two things you want independently revertible;
- one half is risky and the other is not, and you want them to land on different timelines.

If none of those apply, **bundling is correct**. Superseded 2026-08-25: the previous rule mandated one concern per PR unconditionally. It was withdrawn as impractical — see Why.

## Why

The original rule optimized one variable — reviewability — and ignored what it cost. In this codebase every PR pays for a **serialized, contended, expensive** gate: a single local-CI slot, a lease other sessions queue behind, and a full cloud run. Splitting an N-part change into N PRs multiplies that cost by N, and each run is an independent chance to hit contention, flake, or an expired record.

That cost is not theoretical. One two-file docs-and-fix effort in August 2026 took **seven** gate attempts across two PRs — a peer's hand-run build holding the shared runner, a wait that blocked on already-dead PIDs, a gate that passed and then expired before it could be spent, a contended slot released with no reason, a CI checkout that hung for five minutes, and an unrelated route timing out in the UX sweep. None of the seven was a finding against the code. Splitting further would have bought more of them.

The genuine value of the old rule survives, and it is narrower than "one concern": you want a diff a reviewer can attribute, and a revert that does not force a choice. Those are properties of a PR, not a count of concerns. A five-file change across one subsystem usually has them. Two unrelated changes to two subsystems usually do not.

Reviewers should reject a PR they cannot attribute or cleanly revert — not one that merely does more than one thing.

## Applies To

In-platform coworkers, external coding agents, and humans. Symmetric. Applies to every branch and every PR. A prerequisite refactor still lands with the feature it unblocks and gets called out in the PR description's "Refactor budget retired" section.

## How To Apply

Before opening, ask the two questions that matter: **can a reviewer tell which lines did which job?** and **would a revert force a choice I do not want to make?** If both answers are good, open one PR. If either is bad, split along the line that fixes it — usually risk, or subsystem, not "concern".

When the operator asks for related work in one PR, that is a legitimate instruction, not a rule violation. Say what is bundled and why in the description so the reviewer starts oriented.

## Decision Dimensions

- `long_term_maintainability: 0.6` — a cleanly revertible PR is easier to audit and reason about months later.
- `governance_compliance: 0.45` — review is more effective when a diff can be attributed line to purpose.
- `blast_radius: -0.4` — a PR that reverts cleanly limits what a regression takes with it.
- `operator_effort: -0.45` — every extra PR is another serialized gate run on a contended slot; splitting without cause spends that for nothing.

## Examples

- **Positive (bundled):** one PR lands a new attention source, the catalog badge that surfaces it, and the seed-file edit the two exist to make reachable. Three files, one subsystem, one story; a reviewer can attribute every line and a revert cleanly removes the whole feature.
- **Positive (split):** a risky schema migration and a copy fix land separately, because the migration may need to be reverted on its own timeline and the copy fix should not be hostage to it.
- **Counterexample:** a branch called `fix/build-fix` that also "cleaned up the routing module." A reviewer cannot tell which lines fixed the build; the revert fixes the build but loses the cleanup; the audit asks "what changed in routing?" and the answer is "the build fix, somehow." Splitting here buys attribution and a clean revert — that is the test, not the count.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations`.)
