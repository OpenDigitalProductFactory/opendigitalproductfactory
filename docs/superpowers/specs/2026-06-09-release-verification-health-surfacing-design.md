# Release Verification Health Surfacing — Design

- **BI:** BI-3630773C
- **Epic:** EP-FULL-OBS (Full Observability)
- **Status:** shipped with this spec's PR
- **Date:** 2026-06-09

## Problem

A release stamp (`vX.Y.Z` tag push) runs the Publish Docker Images workflow,
which publishes images **first** and runs the E2E install verification gate
**after**. A red verify gate therefore means a *published but unverified*
release — and that signal previously lived only in the GitHub Actions
dashboard.

Founding incident: the v6.0.0 stamp's verify gate failed on 2026-06-08 and
sat unnoticed for two days, masking an installer-breaking bug (impossible
distroless Loki healthcheck, fixed in PR #1677), until the v6.1.0 stamp hit
the same wall. Watching CI dashboards is not the operator's job.

## Design

Three small pieces on existing rails — no new Prisma models, no migration:

1. **Reader** — `apps/web/lib/release-health/release-runs-reader.ts`
   - Reads the publish workflow's runs via the GitHub Actions REST API,
     filtered to `event=push` + `head_branch` matching `vX.Y.Z` (GitHub
     puts the tag name in `head_branch` for tag pushes).
   - Auth is optional: the upstream repo is public, and two requests per
     15-minute tick fit the anonymous 60/hr budget. When the
     `github-pr-sync` credential (Contributor MCP card) is bound, its token
     is reused (resolvers exported from
     `lib/contributor-change-lanes/github-rest-reader.ts`).
   - Classification: run green → `verified`; running → `in-progress`; red →
     fetch the run's jobs and distinguish `verify-failed` (every job except
     the E2E verify gate passed — images are live, verification is not)
     from `publish-failed` (the publish itself broke).
   - **Superseding dispatch verification:** a red stamp run stays red on
     GitHub forever — re-runs execute the tag's stale workflow definition,
     so operators re-verify via the manual `install-verification.yml`
     dispatch in release mode instead (the v6.1.0 recovery path). A green
     release-mode dispatch run *newer than the stamp* upgrades
     `verify-failed` → `verified`. Release mode is detected from the job
     name (`… (ubuntu-latest, release)`) because dispatch inputs are not
     exposed on the runs API. Best-effort: any failure in this check leaves
     the stamp `verify-failed` — alerting too much beats silently clearing
     a real failure.

2. **State + notifications** — `state.ts`, `runner.ts`
   - Last-known state persists as one JSON blob in `PlatformConfig`
     (`release_health.latest`), the same pattern as
     `self_upgrade.lastCheckedAt`. Survives portal restarts.
   - Red stamp → one `PlatformNotification` (category
     `release-verification`, subjectId = tag) per run id; `notifiedRunId`
     in state dedupes across polls. `verify-failed` is **critical**
     (silent bad release), `publish-failed` is **warning** (loud failure,
     nothing shipped).
   - A later stamp verifying green resolves all open release-verification
     notifications. An in-progress re-stamp does NOT resolve — the failed
     release stays alerted until a green verify actually lands.
   - Poll errors (offline, rate-limited) leave prior state untouched.

3. **Surfaces**
   - Inngest cron `ops/release-health-check` every 15 minutes
     (`lib/queue/functions/release-health-check.ts`), gated by
     `gateAtEntry` like every scheduled function.
   - A fourth "Latest Release" card on the portal Health tab summary grid
     (`PortalHealthSummary`), fed server-side from `PlatformConfig` by the
     health page. Tones: verified → success, in-progress → neutral,
     verify-failed → critical, publish-failed → warning, never-stamped →
     neutral "—". The card links to the GitHub Actions run (external link,
     new tab).

## Out of scope

- Re-running or gating the stamp itself (stays operator-initiated).
- Auto-filing PIR/backlog items from the failure log (the Tier 2 log
  scanner owns log-derived intake).
- Non-release workflow monitoring (PR CI health).

## Verification evidence (at ship)

- 24 unit tests across reader classification, superseding logic, and the
  runner's notification lifecycle.
- Live-contract check against the real GitHub API (2026-06-10): the
  v6.1.0 incident classifies as `verify-failed` from its real jobs payload,
  and the real green dispatch run 27248800875 (created 02:21Z, job
  "Linux E2E Install (ubuntu-latest, release)") supersedes it to
  `verified` — so the first cron tick after merge shows v6.1.0 verified
  rather than raising a stale false alarm.
