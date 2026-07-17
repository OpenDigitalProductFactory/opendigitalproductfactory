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

## Design grounding

- Existing specs/plans reviewed:
  - `docs/superpowers/specs/2026-05-26-contributor-change-lanes-design.md`
  - `docs/superpowers/plans/2026-05-26-contributor-change-lanes.md`
  - `docs/superpowers/plans/2026-05-26-contributor-inventory-sync.md`
  - `docs/superpowers/specs/2026-06-18-private-public-change-segregation-design.md`
- Current code substrate reviewed:
  - `apps/web/app/(shell)/platform/development/change-lanes/page.tsx`
  - `apps/web/components/platform/development/change-lanes/ChangeLanesDashboard.tsx`
  - `apps/web/components/platform/development/change-lanes/ChangeLaneSourceSummary.tsx`
  - `apps/web/components/platform/development/change-lanes/ChangeLaneTable.tsx`
  - `apps/web/lib/contributor-change-lanes/read-model.ts`
  - `apps/web/lib/contributor-change-lanes/lane-projection.ts`
  - `apps/web/lib/contributor-change-lanes/types.ts`
- Source of truth:
  - The card derives from the existing `loadContributorChangeLaneReadModel` freshness rows and projected `ContributorChangeLane` rows; it does not add a second repository-health model.
- Decision:
  - Add a page-local summary card above the existing technical table. This keeps the operator-facing answer plain while preserving the table as the evidence drill-down.

## Phases

1. Add a pure repository-health summarizer.
   - Touch: `apps/web/lib/contributor-change-lanes/local-repository-health.ts`.
   - Verify: unit tests cover healthy, syncing, stale/error, and blocker states.
2. Render the summary card on the existing Development Activity page.
   - Touch: `apps/web/components/platform/development/change-lanes/LocalRepositoryHealthCard.tsx`, `ChangeLanesDashboard.tsx`.
   - Verify: component test asserts the card answers “Local source repository” and exposes plain next actions.
3. Merge hygiene.
   - Run targeted tests and typecheck. Runtime/browser verification can use the already-live `/platform/development/change-lanes` route after self-upgrade.
4. Live-install inventory cwd hardening.
   - Observation from self-upgrade verification: the card rendered on the live image, but the contributor inventory cron still ran Git from the portal process cwd (`/app`) instead of the mounted host clone (`/host-dpf`), so local Git snapshot sources reported `fatal: not a git repository`.
   - Touch: `apps/web/lib/queue/functions/contributor-inventory-sync.ts`.
   - Contract: default Git inventory readers must prefer `DPF_REPO_ROOT` when present and fall back to `process.cwd()` only for source-local/dev execution.
   - Verify: regression test covers the `DPF_REPO_ROOT=/host-dpf`, `cwd=/app` case before relying on live inventory health.

## Risk and rollback

Risk is low because this is read-only presentation over an existing read model. Rollback is removing the card import/render and helper; no schema, queue, or Git mechanics change.
