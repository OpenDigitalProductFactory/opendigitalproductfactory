---
title: Proper Fix Over Quick Fix
pageKind: principle
status: published
abstract: When offered a choice, default to the architecturally sound fix. Quick fixes require explicit operator authorization.
principleTier: commandment
principleDirection: Default to the proper architectural fix; surface quick-fix options only with their long-term cost named, and never take a shortcut without an explicit operator go.
principleDimensionVector: {"long_term_maintainability": 0.9, "schema_grounding": 0.5, "blast_radius": -0.3, "speed_to_value": -0.4}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: Adopters need to know the platform defaults to architectural correctness — the operator is the only one who can authorize a shortcut, and even then with the cost named.
sources:
  - articles/why-product-centric-approach-needed
---

## Rule

When presenting options for a bug, schema gap, or architectural shortcoming, the proper fix is the default. Quick workarounds may be surfaced as alternatives, but only with their long-term cost explicitly named. Never apply a shortcut without an explicit operator authorization ("just patch it for now", "take the shortcut", "hotfix").

## Why

The companion principle `architecture-over-shortcuts` argues *why* sound is better than quick over time. This principle covers the *operating default* that follows from it: the agent's first proposal is the proper fix, not the smallest diff. Mark stated this explicitly during the BrandDesignSystem PR 1 execution on 2026-04-18 after being offered quick-fix options A/B alongside proper-fix option C: "I will always decide on proper fix over quick fix unless otherwise specified." The behavior that violates this principle is presenting the quick fix first or burying the proper fix under "cheap" alternatives — both push the operator into approving debt by accident.

This is a **commandment**, not merely a strong default — defaulting to the proper fix is non-negotiable doctrine, with the operator the only one who can authorize a shortcut and only with its cost named. It carries an explicit-operator-authorization gate, structurally parallel to `destructive-actions-require-explicit-go`: surfacing the proper fix is the default, and taking the quick fix requires an explicit go.

## Applies To

In-platform coworkers presenting options, external coding agents executing on the codebase, and humans setting direction. Symmetric. Applies to bug fixes, schema changes, data migrations, refactor scoping, and architectural decisions of any size. Does NOT apply when the user has explicitly named the shortcut scope ("just demo this", "hotfix the prod regression, refactor in a follow-up").

## How To Apply

- When presenting options, order them proper-fix first. Do not lead with the smallest-diff workaround.
- For each quick-fix alternative, name the architectural cost out loud — what the next maintainer will hit, what the next migration will trip over, what the next agent will fork around.
- Proper fix still respects governance: presenting the right option is not permission to execute it unilaterally. Sketch the steps and wait for the explicit go, especially for infra/DB changes (see `destructive-actions-require-explicit-go`).
- If the proper fix significantly expands scope (new PR, new plan, new migration), say so and ask whether to sequence it ahead of the in-flight work — don't silently turn a small task into a large one.
- When the operator authorizes a shortcut, record the deferred-cleanup work as a backlog item in the same turn, so the debt is tracked rather than forgotten.

## Decision Dimensions

- `long_term_maintainability: 0.9` — the operating default that protects the maintainability axis day-to-day; without it, quick fixes win by default.
- `schema_grounding: 0.5` — proper fixes respect the schema; defaulting to them keeps schema-level debt from accumulating one PR at a time.
- `blast_radius: -0.3` — slightly negative. Proper fixes often touch more files than the quick fix would; this principle is named so the wider blast is not a surprise.
- `speed_to_value: -0.4` — explicitly negative. The proper fix costs more on today's task; the payback is on every future task in that area.

## Examples

- **Positive:** Asked to fix a routing regression where one provider's tokens are mis-counted, the proper fix patches the seed that defines the provider's profile so every install gets it right; the quick fix would add a special case in the runtime accounting. Surface the proper fix as the recommendation, the quick fix only as an alternative with "this becomes the new place every routing change has to remember about."
- **Counterexample:** Faced with the same regression, proposing the runtime special case first, mentioning the seed fix only as "also we could…" That ordering is what trains the operator to approve the quick fix by default. Reverse it.

## See Also

- `architecture-over-shortcuts` (commandment) — the underlying *why* this principle defaults to proper. This principle is the operating contract that makes that commandment hold day-to-day: `architecture-over-shortcuts` is the conflict-resolution doctrine; this one governs option ordering and the explicit-authorization gate. The two are complementary, not duplicate.
- `destructive-actions-require-explicit-go` (commandment) — proper fix still needs explicit go for DB/infra changes.
- `fix-the-seed-not-the-runtime` (core) — a specific instance of choosing proper over quick: patch the source of the regression, not the symptom.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)
