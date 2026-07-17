# Local Source Repository Health Card Plan

| Field | Value |
| --- | --- |
| Backlog item | `BI-CE54B73F` |
| Epic | `EP-5410E8EA` — Forge-neutral, offline-capable Git integration substrate |
| Date | 2026-07-17 |
| Status | Implementation plan for this slice |

## Goal

Give a non-technical operator a plain answer to: “Is my local source home healthy and protected?” The existing Development Activity page already has the raw ingredients: Git branch/worktree inventory, source freshness, runtime served commit, PR links, and blocker rows. This slice adds an operator-facing summary card on `/platform/development/change-lanes` without creating a new route or a second source of truth.

## UX fit review

- Decision: fits-with-guardrails.
- Owning area: Platform.
- Route family: `/platform/development/change-lanes`.
- Primary persona: contributor/platform operator who needs confidence before accepting, keeping, or sharing work.
- Navigation layer touched: none; this is a page-local summary above the existing table.
- Reuse/convergence: reuse the contributor-change-lanes read model and report-kit `StatusBadge`; no new dashboard route.
- Source truth: `loadContributorChangeLaneReadModel` freshness plus projected `ContributorChangeLane` rows.
- Empty/failure behavior: syncing, stale, not-configured, and blocked states get plain next actions.
- AI boundary: no coworker prompt is started by this card.

## Phases

1. Add a pure repository-health summarizer.
   - Touch: `apps/web/lib/contributor-change-lanes/local-repository-health.ts`.
   - Verify: unit tests cover healthy, syncing, stale/error, and blocker states.
2. Render the summary card on the existing Development Activity page.
   - Touch: `apps/web/components/platform/development/change-lanes/LocalRepositoryHealthCard.tsx`, `ChangeLanesDashboard.tsx`.
   - Verify: component test asserts the card answers “Local source repository” and exposes plain next actions.
3. Merge hygiene.
   - Run targeted tests and typecheck. Runtime/browser verification can use the already-live `/platform/development/change-lanes` route after self-upgrade.

## Risk and rollback

Risk is low because this is read-only presentation over an existing read model. Rollback is removing the card import/render and helper; no schema, queue, or Git mechanics change.
