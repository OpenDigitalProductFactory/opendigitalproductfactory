---
title: Audience-aware reading tier for the UX budget
date: 2026-07-31
backlog: BI-1DE6F69E
epic: EP-UX-SYSTEM
status: implemented
---

# Audience-aware reading tier

## Problem

`apps/web/lib/ux-budget/budgets.ts` set one reading tier per **shell**. Every
classified shell (`cockpit`, `list`, `detail`, `settings`, `form`, `public`) was
`high-school` — a Flesch–Kincaid cap of grade 9 — and only `unclassified` was
`college`.

That conflated two different questions: *what kind of surface is this* and *who
reads it*. The result contradicted the platform's own readability policy in
[`packages/validators/src/readability.ts`](../../../packages/validators/src/readability.ts),
which states: marketing/external and business copy → high school; reseller/partner
→ college; **architecture and standards → uncapped, "precision over simplicity"**.

An operator/admin surface was therefore graded against the marketing bar.

## Evidence

From the CI route-budget report on 2026-07-31 (run 30639446475, artifact
`ux-route-budget-report`), **every** `/admin` route failed `reading-level`:

| Route | Grade | Route | Grade |
| --- | --- | --- | --- |
| /admin/archetypes | 57.9 | /admin/hive | 14.0 |
| /admin/business-models | 29.4 | /admin/build-studio/stall-thresholds | 13.8 |
| /admin/data-stewardship | 18.6 | /admin/issue-reports | 13.8 |
| /admin | 15.4 | /admin/cockpit | 12.5 |
| /admin/diagnostics | 15.2 | /admin/platform-development | 12.5 |
| /admin/branding | 14.5 | /admin/graph-explorer (net-new) | 11.0 |

They passed only because a pre-existing route receives the finding as
**advisory** — `evaluate.ts` drops `exemptChecks` when `routeStatus === "net-new"`,
so the identical finding is **blocking** for a new route.

The first net-new admin route measured **11.0**, the *lowest* grade of any admin
surface, and blocked. A bar that only the newest route must clear, and that the
plainest surface in the family cannot, is measuring the wrong thing.

The cause is structural rather than editorial. The grade is computed over the whole
rendered page including shared shell chrome, and the operator vocabulary an admin
surface cannot avoid — "Infrastructure", "Architecture", "Configuration",
"Diagnostics" — is polysyllabic by nature, which Flesch–Kincaid penalises whatever
the sentence craft.

## Design

The reading tier now resolves from **shell + audience**:

```ts
readingLevelFor(shell, audience) // budgets.ts
```

`AUDIENCE_READING_LEVELS` maps `admin` and `builder` → `college`. Every other
audience (`owner`, `worker`, `customer`, `public`, `auth-setup`) keeps the shell
default, because the hide-complexity-from-layman-users doctrine applies to them in
full.

`audience` is threaded through `budgetFor` → `evaluateUxBudget` → `verdictForRoute`
→ the sweep, and is now carried on each generated `route-shells` row so the sweep
resolves it without a second registry lookup. Every parameter is optional, so
callers that omit it get exactly the previous shell table.

## Decisions

**D1 — `college`, not `uncapped`.** The readability policy would permit uncapped
for an architecture audience, but uncapped removes the check entirely. At `college`
(grade 13) **nine of the twelve** admin routes above still fail. That debt stays
visible as advisory findings. This re-tiers the bar to the honest audience; it does
not delete it.

**D2 — Audience may only loosen, never tighten.** `unclassified` already sits at
`college`; an audience with no override must not pull it back to high school.
`readingLevelFor` takes the more permissive of the two.

**D3 — Carry `audience` on the shell row rather than joining registries.** The
shell alone cannot say whether a surface is operator-facing, and the sweep already
reads the shell registry per route. `build-route-shells.ts` previously discarded
`audience` from the policy; it now retains it.

**D4 — No route is exempted and no baseline is edited.** The alternative fixes
considered for the triggering route were to park it in the pre-migration exemption
baseline (the anti-pattern the ratchet exists to prevent) or to add filler prose to
dilute the page average (gaming the metric). Both were rejected.

## Research & Benchmarking

- **GOV.UK content standards** — targets reading age 9 for *public* guidance and
  explicitly exempts specialist and internal-facing content, on the grounds that
  forcing domain terms out of technical copy reduces precision without helping the
  reader. Adopted: audience, not surface type, selects the tier.
- **Microsoft Writing Style Guide / IBM Design Language** — both maintain separate
  registers for end-user versus administrator documentation, with the admin
  register permitting unavoidable domain vocabulary. Adopted as the two-tier split.
- **WCAG 3.0 draft (Clear Language)** — scopes readability outcomes to content
  where comprehension is the barrier, and warns that automated grade formulas
  penalise necessary terminology. Pattern rejected: a single global grade cap.
- **Flesch–Kincaid itself** — the formula weights syllables-per-word heavily, so a
  surface whose nouns are "Infrastructure" and "Configuration" scores high with no
  possible sentence remedy. Anti-pattern identified: treating a syllable-count
  proxy as a comprehension measure for specialist surfaces.

**Gap filled:** DPF already *had* the right policy in `readability.ts`; the UX
budget simply did not consult it. This connects the two rather than inventing a
third rule.

## Minimum Architectural Alignment Checklist

1. **Deployment contracts** — none affected; no API shape, install path, service
   boundary, or self-upgrade step changes.
2. **Canonical identity** — not identity-bearing.
3. **No parallel utilities** — extends `budgetFor`/`evaluateUxBudget` and reuses
   the existing `RouteAudience` taxonomy and `ReadingLevel` enum. No second policy
   table is introduced; `AUDIENCE_READING_LEVELS` is the one override map.
4. **This rulebook** — no rule is re-homed. The readability policy remains
   single-source in `packages/validators/src/readability.ts`.

## Consequence

`/admin/graph-explorer` (BI-89A149A9, PR #3813) was blocked solely by this check
and is unblocked by this change. Nine admin routes continue to report the finding
as advisory debt, which is the honest outcome.
