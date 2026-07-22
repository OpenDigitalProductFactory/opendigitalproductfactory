# Plan — Archetype-scoped Restaurant marketing cockpit (BI-CC580161)

## Problem

The customer marketing cockpit (`/customer/marketing`, `/strategy`, `/campaigns`) rendered saved campaign artifacts, proof prompts, draft review, and publish readiness **without scoping to the current organization/archetype**. For a Restaurant / Food & Hospitality business this leaked software-platform (DPF) vocabulary — "Build Studio", "technical founders", "AI workflow", "SaaS" — into artifacts, drafts, and the drafter's own voice. The drafter (`draft-builder.ts`) hardcoded a "technical-founder" audience, so generated copy was off-archetype by construction.

## Source of truth

`docs/platform-usability-standards.md` → new section **"Archetype-scoped marketing content (BI-CC580161)"**. This plan is grounded there; the marketing playbooks (`apps/web/lib/tak/marketing-playbooks.ts`, already carrying a `food-hospitality` playbook) supply the per-archetype vocabulary.

## Design grounding

- **Extends** existing marketing substrate: `lib/marketing.ts` snapshot, `lib/marketing/subroutes.ts` view models, the approval-queue components, and the marketing playbooks. No new tables, routes, or DB migration.
- New contract module `lib/marketing/archetype-fit.ts` (pure, deterministic) is the single fit authority; a thin server guard (`fit-guard.ts`) enforces it where state changes.

## Phases (implemented)

1. **Fit engine** — `lib/marketing/archetype-fit.ts`: `assessArchetypeFit({text, category})` → `ok | warn | block`. Platform-leak terms block universally; off-archetype signatures (per-category, high-precision) warn; the active archetype's own terms never warn.
2. **Snapshot** — expose `storefront.category` on `MarketingWorkspaceSnapshot`.
3. **Owner next decision** — `lib/marketing/next-decision.ts`: one archetype-scoped decision for the first viewport, tied to the playbook's headline metric.
4. **Server enforcement** — `guardDraftArchetypeFit` blocks Approve (`actions.ts`); `publishApprovedDraft` blocks Publish/Send (`publish.ts`). Client warnings are advisory only.
5. **UI** — approval queue + publish buttons + `/campaigns` artifacts show the fit badge/notice, badge blocks as "Imported / test data — blocked from publish", and disable release; `/customer/marketing` renders the one next decision first.
6. **Drafter** — `draft-builder.ts` derives audience/tone/CTA from the archetype playbook instead of a hardcoded founder voice.
7. **Regression tests** — `archetype-fit.test.ts`, `next-decision.test.ts`, extended `subroutes.test.ts`, and `archetype-scoping.test.ts` covering all three routes.

## Verification

- Pure engine + decision logic verified locally via Node type-stripping harness (11/11 and 10/10 assertions). Full vitest + typecheck run in CI (source-only worktree: `vite`/`vitest` and `@dpf` junctions are partial locally).
