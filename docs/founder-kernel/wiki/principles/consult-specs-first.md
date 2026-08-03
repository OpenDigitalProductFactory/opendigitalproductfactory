---
title: Ground New Work In Existing Platform
slug: consult-specs-first
pageKind: principle
status: published
abstract: Ground new work in existing and previous platform work by default; evolve the DPF substrate incrementally unless the user explicitly asks for a clean break or the prior work is proven unfit.
principleTier: commandment
principleDirection: Prefer incrementally evolving existing DPF platform work over creating net-new concepts, flows, models, routes, or abstractions; inspect prior work first and explicitly justify any departure.
principleDimensionVector: {"long_term_maintainability": 1.0, "reusability": 0.9, "schema_grounding": 0.8, "human_cognitive_load": -0.5, "speed_to_value": -0.2}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: DPF's strategic advantage is accumulated platform substrate. Operators and contributors should expect new work to extend what already exists instead of spawning parallel designs.
authoredAt: 2026-05-18
authoredBy: mark-bodman
---

# Ground New Work In Existing Platform

**Unless the user explicitly asks for a clean break, every new DPF
design and implementation starts by grounding itself in existing and
previous platform work.** DPF's job is to compound its substrate:
extend prior designs, reuse existing primitives, refactor shared seams,
and supersede old work only when the lineage and reason are explicit.

## Why this exists

The substrate is denser than first reads suggest:

- The kernel wiki at `docs/founder-kernel/wiki/principles/` has 50+
  governing principles, including some that look like they're "about
  process" but are actually load-bearing for architecture
- `docs/superpowers/specs/` has spec drafts that pre-date many features
  and have already resolved decisions the new work would otherwise
  re-litigate
- Current code and live data establish observed value-stream alignment; the
  [Four-Portfolio Archetype and AI Workforce Operating Standard](../../../architecture/four-portfolio-archetype-ai-workforce-operating-standard.md)
  governs target portfolio and value-stream semantics. The legacy criteria workbook has
  `undetermined` source-use status and is not new AI or normative evidence; features that
  do not fit a governed stream may belong in a different stream or expose a model gap
- Existing models in `packages/db/prisma/schema.prisma` are already
  doing more than they look like at first glance — running `grep` for
  a noun before adding a new model usually finds it

Skipping this step has produced multiple cases of:

- New "I'll add a `BackupRun` table" when one already existed
- New "I'll introduce a Capability enum" when the Capability registry
  already had the discriminator
- "Why did we build that and not this?" arguments over decisions that
  were already resolved in a spec four weeks earlier

The deeper cost is strategic drift. A platform that keeps inventing a
fresh shape for each request stops becoming a factory and becomes a
pile of isolated artifacts. DPF should instead improve by accretion:
each new vertical, job, workflow, model, route, provider policy, and UI
surface should make the existing platform more capable. Net-new
substrate is allowed, but it carries a burden of proof.

## Applies To

In-platform coworkers, external coding agents, and humans shaping DPF.
Symmetric. Applies to strategy, specs, backlog items, schemas, routes,
onboarding flows, UI surfaces, skills, integrations, and vertical
archetype work. Does NOT apply when the user explicitly asks for an
isolated experiment, throwaway prototype, or clean replacement; even
then, the exception is named so later readers understand the boundary.

## What to do

1. **Name the existing substrate first.** In the plan, spec, or PR,
   state which prior platform work the change extends, composes with,
   refactors, or supersedes.
2. **Search the kernel wiki** for keywords related to the feature.
   Read any principle that comes up — even if the title doesn't seem
   directly related.
3. **Search `docs/superpowers/specs/`** by topic. Spec frontmatter has
   a `status` field — `APPROVED` is canonical; older drafts may have
   already resolved the decision.
4. **Search the schema** for nouns. `grep -n "model BackupRun"
   packages/db/prisma/schema.prisma` is faster than the worst-case
   discovery of "wait, this table already exists."
5. **Check the IT4IT mapping** for the value stream the feature belongs
   to. Spec frontmatter has `valueStream` and `stage` fields; new
   features should declare both.
6. **When a spec resolves the decision**, cite the spec by path in the
   plan/PR description. When deviating, justify the deviation in the
   spec, not in commit messages.
7. **When new substrate is still warranted**, say why extension would
   damage the existing model, then link the migration path from old to
   new. Supersession is explicit; silent replacement is not.

## Anti-pattern

- Naming a new substrate (`Capability`, `Provider`, `Endpoint`,
  `WorkItem`, `Backup`) without grepping for it first
- Writing a fresh design doc without searching for an existing approved
  spec on the same topic
- Justifying a decision in an inline code comment when the same
  decision is already canonized in a kernel principle
- Shipping a new route, table, onboarding flow, or vertical taxonomy
  because it is easier than extending the current one
- Treating "this is a v2" as permission to abandon prior platform work
  without explaining exactly what it supersedes and what it preserves

## Decision Dimensions

- `long_term_maintainability: 1.0` — this principle protects the
  platform's compounding architecture. Maximum weight.
- `reusability: 0.9` — grounding new work in prior substrate increases
  the chance every improvement benefits more than one surface.
- `schema_grounding: 0.8` — existing models, routes, principles, specs,
  and registries are the platform's active schema of intent.
- `human_cognitive_load: -0.5` — fewer parallel concepts means operators
  and contributors have less to remember and reconcile.
- `speed_to_value: -0.2` — the search and grounding pass costs a little
  time up front; the payback is avoiding duplicate work and downstream
  cleanup.

## Related principles

- [`verify-substrate-before-proposing-new`](verify-substrate-before-proposing-new.md) —
  grep before naming new tables / types / epics
- [`sweep-main-before-trusting-worktree-specs`](sweep-main-before-trusting-worktree-specs.md) —
  worktree-local specs can be 100+ PRs behind main
- [`research-and-use-standards`](research-and-use-standards.md) —
  the same posture for external standards
