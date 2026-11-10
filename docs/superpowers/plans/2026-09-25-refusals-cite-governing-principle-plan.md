---
status: active
---

# Refusing gates name their governing principle: implementation plan

Implements BI-DEDAC950 against
[the design](../specs/2026-09-25-refusals-cite-governing-principle-design.md).
AC-GP-01 to AC-GP-05 are the definition of done.

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Phase 1: the slug rule, shared (internal sequencing)

- `packages/db/src/seed-wiki-kernel.ts:364,454` exports
  `kernelPageSlug(frontmatter, absolutePath, wikiDir)`, which wraps the
  existing `frontmatter.slug ?? deriveSlug(...)`. The seeder calls it. The
  profession seeder's slug rule (`seed-profession-corpus.ts`) gets the same
  treatment. There is no behaviour change, and the existing seed tests stay
  green.

## Phase 2: the tables and the resolver test (internal sequencing)

- New `apps/web/lib/kernel/governing-principles.ts` with the three tables
  (design §3.1) and `governingPrinciplesFor(decision)` (profile-aware for
  `RESEARCH_REQUIRED`).
- New `governing-principles.test.ts`. Red first, with one deliberately bad
  slug. It covers:
  - resolution through `kernelPageSlug`;
  - the page is published, is a `principle`, and has a `## Rule`;
  - the ratchet on the count of `null` entries;
  - totality over `READINESS_CODES`.
- Re-read each proposed page before fixing its row. A row whose page does not
  state the rule the code enforces becomes `null`.

## Phase 3: the surfaces (internal sequencing)

- `work-capsules/governed-work-claim.ts:521-527`: add
  `data.governingPrinciples` and add the line to the message.
- `backlog/mcp-terminal-status.ts:59-64`: same.
- `mcp/packs/backlog-pack-read-tools.ts`: add `readiness.governingPrinciples`
  per target.
- `decision-perspective/types.ts` and `directional-outcome.ts`: optional
  `principleSlug` on escalate results, from
  `DIRECTIONAL_ESCALATION_PRINCIPLE`.
- `tak/alignment-tool-gate.ts` and `tak/preexecution-control.ts:117-134`:
  `principleSlug` on the decision and in the refusal `data`.
- `canonical-primitives.ts:59`: correct the slug form.
- Tests:
  - the claim-refusal and terminal-status tests assert `governingPrinciples`;
  - a directional-outcome test per escalate branch;
  - an alignment refusal test;
  - the persisted-decision replay tests stay green unchanged. That proves the
    citation stays outside the decision.

## Completion gate

- `pnpm --filter web exec vitest run lib/kernel lib/backlog lib/work-capsules lib/decision-perspective lib/tak lib/mcp`
- `pnpm --filter web typecheck`
- `pnpm --filter @dpf/db exec vitest run` (seed slug rule)
- `pnpm run pregate`
- Live (AC-GP-05): on the dev install after self-upgrade, a refused claim
  returns `governingPrinciples`, and `wiki_query` for each slug returns that
  page first.

## Risks and rollback

- **Replay breakage** if a citation leaks into a decision object. Guarded by
  the unchanged replay tests (phase 3).
- **Wrong citation** (a page that does not govern the code). The phase 2
  re-read catches it, and the independent plan review re-checks it. A wrong
  row is a one-line revert.
- The PR is additive only and reverts cleanly.

## Backlog coverage

Umbrella: BI-DEDAC950. Decision: `atomic`. The three phases share one table
module and are not independently shippable. A slug table with no surface
carrying it delivers nothing, and a surface with no table has nothing to carry.
Coverage receipt: recorded after spec approval mints the baseline.
