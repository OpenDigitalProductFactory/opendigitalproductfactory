# Principle dimension-vector sign audit (cost axes)

| Field | Value |
| ----- | ----- |
| Date | 2026-06-14 |
| Trigger | Operator direction (2026-06-14): "full 14-axis audit + recalibrate" while wiring `remove-avoidable-failure-opportunities` into `principle_decide` scoring |
| Scope | All `docs/founder-kernel/wiki/principles/*.md` dimension vectors |
| Outcome | 34 principles recalibrated (sign flips, magnitudes preserved) + a guard test so the inversion cannot return |
| Convention | `AUTHORING.md §8A.3` — a negative weight means "this principle pulls **against** the axis" |

## The defect

`principle_decide` scores an option against a principle with
`alignment = Σ option.features[dim] × vector[dim] / Σ |vector[dim]|`
(`apps/web/lib/decision/option-scoring.ts`), where **option feature scores are
non-negative** (`[0,1]` — "how much does this option exhibit this axis").

For a **cost axis** — one where *more is worse* — a **positive** principle
weight therefore makes the principle **reward** options that exhibit the cost.
Authors had been writing positive magnitudes as *salience* ("this principle
cares a lot about risk") where the math requires *direction* ("this principle
pushes **against** risk"). The result was a corpus split: ~14 principles used
the cost axes directionally (negative), ~34 used them as salience (positive).

### Proof it is not cosmetic

> **`never-wipe-db-for-code-fixes`** (commandment) carried `blast_radius: 1.0`.
> An option "wipe the db" scores feature `blast_radius ≈ 1.0`, contributing
> `+1.0` — so the commandment that **forbids** wiping the db scored "wipe the
> db" as its **top-aligned** option. `destructive-actions-require-explicit-go`
> (`blast_radius: 1.0`) had the identical inversion.

This is why, in practice, callers pass `features: {}` and fall back to semantic
alignment — supplying structured features produced contradictory results
(half the principles rewarded a cost, half penalized it).

## Cost axes (the closed set)

Three of the 14 `PRINCIPLE_DIMENSIONS` are costs (higher feature = worse). All
others are benefits (positive normal) or neutral trade-offs (`speed_to_value`,
legitimately negative when a principle trades speed away):

| cost axis | meaning of a high option-feature | correct principle direction |
| --- | --- | --- |
| `blast_radius` | larger damage/spread if it goes wrong | reduce → **negative** |
| `human_cognitive_load` | more operator/agent upkeep & vigilance | reduce → **negative** |
| `vendor_lock_in` | more dependence on a single vendor | reduce → **negative** |

Now codified as `PRINCIPLE_COST_DIMENSIONS` in `packages/db/src/wiki-taxonomy.ts`
and enforced by the `dimension-vector sign convention` guard test in
`packages/db/src/seed-wiki-kernel.test.ts` (fails if any cost axis is positive).

## Recalibration — 34 principles (sign flipped, magnitude preserved)

**`human_cognitive_load` (8):** `never-ask-user-to-run-commands` (1.0→−1.0),
`autonomous-directives-are-blanket-approval` (0.9→−0.9),
`zero-click-provider-setup` (0.8→−0.8),
`bundled-services-active-by-default` (0.7→−0.7),
`consult-specs-first` (0.5→−0.5), `check-tool-signals-first` (0.4→−0.4),
`principle-based-rules` (0.4→−0.4),
`schema-honesty-over-aspirational-naming` (0.3→−0.3).

> Note the formerly-contradictory pair, now consistent:
> `never-ask-user-to-run-commands` and `do-the-work-dont-task-the-operator`
> express the same doctrine; the former was +1.0, the latter −1.0. Both are
> now −1.0 / −0.9-class negatives.

**`vendor_lock_in` (1):** `no-provider-pinning` (0.9→−0.9) — its own prose says
it "directly negates provider lock-in," so negative is the correct direction.

**`blast_radius` (25):** `never-wipe-db-for-code-fixes` (1.0→−1.0),
`destructive-actions-require-explicit-go` (1.0→−1.0),
`plan-before-install-paths` (0.7→−0.7), `image-identity-equals-bytes` (0.7→−0.7),
`specialization-over-generalization` (0.7→−0.7), `worktree-per-session` (0.7→−0.7),
`all-changes-land-via-pr` (0.6→−0.6), `build-gate-mandatory` (0.6→−0.6),
`one-common-process-three-surfaces` (0.6→−0.6),
`runtime-gates-via-shared-lease` (0.6→−0.6), `worktree-base-origin-main` (0.6→−0.6),
`branch-guard-before-implementation` (0.5→−0.5),
`fail-fast-explain-clearly` (0.5→−0.5), `keep-root-clone-as-merge-worktree` (0.5→−0.5),
`mcp-is-the-coordination-plane` (0.5→−0.5), `one-concern-per-pr` (0.5→−0.5),
`release-qa-plan` (0.5→−0.5), `single-source-of-truth` (0.5→−0.5),
`tool-evaluation-pipeline` (0.5→−0.5), `worktree-selection-and-reaping` (0.5→−0.5),
`fix-the-seed-not-the-runtime` (0.4→−0.4), `never-fabricate` (0.4→−0.4),
`always-push-after-committing` (0.3→−0.3), `diversity-of-thought` (0.3→−0.3),
`mention-uncommitted-changes` (0.3→−0.3).

In-body "Decision Dimensions" bullets were updated to match the frontmatter (26
files restated the weight numerically). Three bullets whose prose had framed the
axis as salience/leverage rather than reduction were reworded to read
directionally: `fix-the-seed-not-the-runtime` (blast radius of *recurrence*),
`principle-based-rules` (net rule-surface reduction), `always-push-after-committing`
(blast radius of *loss*).

## Calibration notes (for operator review)

- **Magnitudes were preserved; only signs flipped.** The salience magnitude
  ("how much this principle cares") maps cleanly to directional strength ("how
  hard it pushes against the cost"). Re-tune any magnitude in review.
- **Lower-confidence flips** (cost axis is weakly relevant; flip is directionally
  correct but low-signal): `always-push-after-committing`, `diversity-of-thought`,
  `mcp-is-the-coordination-plane`, `fix-the-seed-not-the-runtime`,
  `one-common-process-three-surfaces`. Flagged for line-item veto.
- **Benefit-axis negatives were left untouched** — e.g. `speed_to_value: -0.4`
  (`architecture-over-shortcuts`), `zero-click-provider-setup` `evidence_density: -0.2`
  — these are intentional trade-offs, not inversions.

## Why a guard, not just a fix

Per [`fix-the-seed-not-the-runtime`](../../professions/data-architect/wiki/fix-the-seed-not-the-runtime.md)
and [`remove-avoidable-failure-opportunities`](../../founder-kernel/wiki/principles/remove-avoidable-failure-opportunities.md):
the fix patches the values, but the *failure opportunity* is an author writing a
positive cost-axis weight again. The `PRINCIPLE_COST_DIMENSIONS` registry +
sign-guard test removes that opportunity structurally, and `AUTHORING.md §8A.3`
now states the convention explicitly so the next author gets it right by default.
