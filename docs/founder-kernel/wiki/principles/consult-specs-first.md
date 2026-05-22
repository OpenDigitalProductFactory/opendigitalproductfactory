---
title: Consult specs first
slug: consult-specs-first
pageKind: principle
status: published
abstract: Read existing specs, IT4IT mapping, and kernel principles before designing anything new. DPF's substrate is denser than first reads suggest.
principleTier: core
principleDirection: Read the relevant specs, IT4IT mapping, and kernel principles before proposing new design; extend prior intent or explicitly justify deviating from it.
principleDimensionVector: {"long_term_maintainability": 0.8, "reusability": 0.8, "schema_grounding": 0.7, "human_cognitive_load": 0.5, "speed_to_value": -0.2}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleConsumerArchetype: universal
principlePublic: false
authoredAt: 2026-05-18
authoredBy: mark-bodman
---

# Consult specs first

**Before designing anything new, read the architecture specs, the
IT4IT mapping, and the kernel wiki for relevant prior decisions.** DPF
has substantial design intent already encoded; new work should fit into
it, extend it, or explicitly justify deviating from it.

## Why this exists

The substrate is denser than first reads suggest:

- The kernel wiki at `docs/founder-kernel/wiki/principles/` has 50+
  governing principles, including some that look like they're "about
  process" but are actually load-bearing for architecture
- `docs/superpowers/specs/` has spec drafts that pre-date many features
  and have already resolved decisions the new work would otherwise
  re-litigate
- IT4IT value-stream alignment (`/docs/Reference/IT4IT_Functional_Criteria_Taxonomy.xlsx`)
  is the canonical mapping from feature work to stage and value stream;
  features that don't fit a stage probably belong in a different value
  stream
- Existing models in `packages/db/prisma/schema.prisma` are already
  doing more than they look like at first glance — running `grep` for
  a noun before adding a new model usually finds it

Skipping this step has produced multiple cases of:

- New "I'll add a `BackupRun` table" when one already existed
- New "I'll introduce a Capability enum" when the Capability registry
  already had the discriminator
- "Why did we build that and not this?" arguments over decisions that
  were already resolved in a spec four weeks earlier

## What to do

1. **Search the kernel wiki** for keywords related to the feature.
   Read any principle that comes up — even if the title doesn't seem
   directly related.
2. **Search `docs/superpowers/specs/`** by topic. Spec frontmatter has
   a `status` field — `APPROVED` is canonical; older drafts may have
   already resolved the decision.
3. **Search the schema** for nouns. `grep -n "model BackupRun"
   packages/db/prisma/schema.prisma` is faster than the worst-case
   discovery of "wait, this table already exists."
4. **Check the IT4IT mapping** for the value stream the feature belongs
   to. Spec frontmatter has `valueStream` and `stage` fields; new
   features should declare both.
5. **When a spec resolves the decision**, cite the spec by path in the
   plan/PR description. When deviating, justify the deviation in the
   spec, not in commit messages.

## Anti-pattern

- Naming a new substrate (`Capability`, `Provider`, `Endpoint`,
  `WorkItem`, `Backup`) without grepping for it first
- Writing a fresh design doc without searching for an existing approved
  spec on the same topic
- Justifying a decision in an inline code comment when the same
  decision is already canonized in a kernel principle

## Related principles

- [`verify-substrate-before-proposing-new`](verify-substrate-before-proposing-new.md) —
  grep before naming new tables / types / epics
- [`sweep-main-before-trusting-worktree-specs`](sweep-main-before-trusting-worktree-specs.md) —
  worktree-local specs can be 100+ PRs behind main
- [`research-and-use-standards`](research-and-use-standards.md) —
  the same posture for external standards
