# Self-Upgrade owner-readable release status card

- **Backlog item:** BI-8D87084D — "Self-upgrade page needs owner-readable release and rollback guidance"
- **Epic:** EP-UX-COGLOAD — Live UX cognitive-load audit follow-up
- **Status:** implemented
- **Date:** 2026-07-22

## Problem

The live UX cognitive-load audit found `/ops/self-upgrade` reads like a runtime
ledger, not an owner surface. Evidence: ~1,527 words, 46 visible actions, 52
risk/action-word hits, and unexplained operational terms (`DELIVERY`, `RUNTIME`,
`RELEASES`, `SECURITY`, `SOC`, `SUR-*`, `SUCCEEDED`, `SKIPPED`, `FAILED`). The
first viewport is internal chrome and a runtime status row with a bare
`Upgrade now` risk button — before a non-technical owner can answer the only
questions they have:

1. Is an update available?
2. Is it safe — can the business keep working?
3. Is one running / did the last one fail?
4. Can it be undone?
5. What is kept on my system?
6. What happens if I do nothing?

## Design grounding

- **Specs/plans reviewed:** `docs/superpowers/specs/` self-upgrade surface —
  BI-4A400DE4 (durable-cache-only impact summary on render), BI-D43EB266
  (Self-Upgrade as the single operator update entry point, source-merge sub-step
  folded in), BI-75C4A412 (content-based local-changes ledger). No existing spec
  owns an owner-readable release summary — this creates a new, thin presenter
  over the existing status contract, not a new substrate.
- **Code substrate reviewed (`apps/web/`):** `getSelfUpgradeStatus()`
  (`apps/web/lib/actions/promotions.ts`) already returns every field the summary
  needs — `isFresh`, `targetSha`/`deployedSha`, `latestRun`, `latestRunImpact`,
  `releaseBatch`, `blackoutUntil`, `nextWindowStart`, `platformVersion`. Plain-
  language copy sources already exist: `describeSkipReason`
  (`apps/web/lib/self-upgrade/skip-reason.ts`), `hasGovernedRecoveryPoint`
  (`apps/web/lib/self-upgrade/rollback.ts`), `getLocalChangesLedger`
  (`apps/web/lib/self-upgrade/local-changes-ledger.ts`). Card styling reuses the
  report-kit palette (`apps/web/components/ui/report-kit/` — `Notice`,
  `StatCard`), never a hand-rolled badge/KPI (AGENTS.md §12). Simple/Full is the
  existing `dpf-nav-mode` cookie (`apps/web/lib/navigation/nav-mode.ts`).
- **Decision:** extend the existing surface. The technical
  `SelfUpgradeClient`, `PlatformUpdateApplyPanel`, and `LocalChangesLedger` are
  preserved unchanged; only their placement changes.

## Approach

1. **Pure derivation** — `apps/web/lib/self-upgrade/owner-summary.ts`:
   `buildOwnerReleaseSummary(input, localChanges)` maps the status object into an
   `OwnerReleaseSummary` (state, tone, headline, current/available version,
   recommended action, can-keep-working, kept-locally, what-could-go-wrong,
   rollback, if-you-do-nothing, and a pre-action `riskNotice`). Pure and
   prisma-free (the caller passes `rollbackAvailable` as a boolean), so the copy
   and state machine are unit-tested (`owner-summary.test.ts`), including a
   jargon guard asserting the owner strings never contain `SUR-`, `quiescence`,
   `promoter`, `targetSha`, `SHA`, etc.
2. **Presenter** — `apps/web/components/ops/OwnerReleaseCard.tsx`: a server
   component composing report-kit `Notice`/`StatCard`, token-only colors.
3. **Page** — `apps/web/app/(shell)/ops/self-upgrade/page.tsx` renders the owner
   card first, then moves the technical controls/history/ledgers behind an
   `<details>` "Advanced controls & history" disclosure. Simple (worker)
   nav-mode collapses it by default; Full (operator) expands it.

The risk-bearing `Upgrade now` / rollback controls keep their existing wiring
inside `SelfUpgradeClient`; the owner card states consequence, reversibility,
expected duration, and recovery path before the owner opens Advanced to act.

## Research & benchmarking

- **Windows Update / macOS Software Update** — lead with a one-line status
  ("Your device is up to date" / "Update available"), a single primary action,
  and "what's new" + "you can keep working" framing; advanced/technical detail is
  a secondary disclosure. Adopted: status-first headline, one recommended action,
  progressive disclosure of technical detail.
- **Vercel / deployment dashboards** — surface build status + rollback
  prominently. Adopted: explicit rollback/recovery answer. Rejected: exposing raw
  build logs at the top level (that is the cognitive-load anti-pattern this item
  fixes).

## Acceptance mapping

- Owner-readable release status card first — `OwnerReleaseCard` above the fold.
- Current/available version, recommended action, keep-working, kept-locally,
  what-could-go-wrong, rollback/recovery, do-nothing — fields on
  `OwnerReleaseSummary`.
- Technical run logs, SUR ids, runtime/security ledgers behind Advanced —
  `<details>` disclosure.
- Risk actions state consequence/reversibility/duration/recovery — `riskNotice`.
- Simple mode hides technical ledger content — `<details open={!simple}>`.
- UX smoke checks — `owner-summary.test.ts` (word/jargon/risk-copy/state) +
  `page.test.tsx` (card-before-advanced ordering, disclosure marker, Simple/Full
  default) + the mobile Playwright smoke covers the route.
