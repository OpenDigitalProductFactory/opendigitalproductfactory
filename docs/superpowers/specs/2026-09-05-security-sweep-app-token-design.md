---
status: draft
---

# Security sweep reads all three alert surfaces through a GitHub App token

**Backlog item:** BI-3E6AFF04
**Profile:** fix

## Problem and reproduced cause

At main `961ef9c8cf`, `.github/workflows/security-findings-watch.yml:64` and `audit-stale-overrides.yml:59` read alerts with `secrets.DEPENDABOT_ALERTS_TOKEN || secrets.GITHUB_TOKEN`. The repository secret does not exist (`gh secret list` shows none), so both fall back to `GITHUB_TOKEN`, which cannot read Dependabot or Secret scanning alerts even with `security-events: read`. The standing report (#4389) opens by declaring itself incomplete. Confirmed 2026-09-05: the same endpoints answer 200 to a user token with `repo` scope, so the org has the surfaces; the workflow simply lacks a credential that may read them.

## Objectives and acceptance criteria

1. Both workflows mint a short-lived GitHub App installation token per run when `SECURITY_SWEEP_APP_ID` and `SECURITY_SWEEP_APP_PRIVATE_KEY` exist, and fall back to the PAT, then `GITHUB_TOKEN`, so the change is safe to merge before the secrets exist.
2. The 403 remedy text in both scripts names the two credential paths.
3. The operator step (create the App with "Dependabot alerts: read" and "Secret scanning alerts: read", install it on the repository, store the two secrets) is documented in the runbook and is the only human step.

## Ordered fix sequence

1. Add the `actions/create-github-app-token@v2` step, gated on the App id secret, to both workflows; point `GITHUB_TOKEN` at `steps.app-token.outputs.token || DEPENDABOT_ALERTS_TOKEN || GITHUB_TOKEN`.
2. Update the remedy strings in `scripts/sbom/sweep-security-surfaces.mjs` and `scripts/audit-stale-overrides.mjs`.
3. Runbook entry: how to create and install the App, and how to verify the sweep is complete (the report header must not say "2 of 3 surfaces could not be read").

## Boundaries

- No change to what the sweep does with the alerts.
- `actions/*` first-party actions are pinned by major tag in this repository; third-party actions by SHA. This one is first-party.

## Rollback

Delete the two secrets; the step is skipped and the fallback chain is what runs today.
