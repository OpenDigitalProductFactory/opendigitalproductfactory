---
title: "Feature Deployment"
area: build-studio
order: 2
lastUpdated: 2026-03-29
updatedBy: Claude (Software Engineer)
---

## Overview

When a feature passes all quality gates in Build Studio, it enters the Ship phase. The platform handles deployment autonomously — backing up your database, building a new version of the application with your feature included, swapping it into production, and verifying everything works. If anything goes wrong, it rolls back automatically.

You do not need to understand Docker, databases, or deployment tools. The platform manages the entire process and reports the result in plain language.

## How Deployment Works

The deployment pipeline has eleven steps, all automated:

1. **Validate** — Confirms the promotion has been approved and is ready to deploy
2. **Window check** — Verifies the current time falls within a deployment window (if configured). Emergency changes bypass this check.
3. **Database backup** — Creates a complete backup of the production database before any changes. This backup is stored and can be used for recovery.
4. **Source extraction** — Copies the feature code from the isolated sandbox environment where it was built and tested
5. **Image build** — Builds a new version of the platform application that includes the feature
6. **Rollback preparation** — Tags the current running version so it can be restored if needed
7. **Stop old version** — Stops the current application (brief downtime begins)
8. **Start new version** — Starts the new version with the feature included
9. **Health check** — Verifies the new version is running correctly by checking the health endpoint multiple times
10. **Record deployment** — Updates the promotion record with success status, timestamps, and deployment log
11. **Cleanup** — Removes temporary files and the old application version

## What Happens If Something Goes Wrong

The platform rolls back automatically if any step fails:

- **Build failure** — The current application keeps running. Nothing changed.
- **Start failure** — The old version is restored immediately. Database is unchanged.
- **Health check failure** — The new version is stopped, old version is restored, and the database backup is applied.
- **Timeout** — If the entire process takes longer than 10 minutes, it stops and rolls back.

After a rollback, the promotion status changes to "Rolled back" with a reason explaining what went wrong. You can review the deployment log in Operations > Promotions.

## Deployment Windows

If your organisation has configured deployment windows (Admin > Business Profile), normal changes can only be deployed during approved times. This prevents deployments during business-critical hours.

- **Normal changes** respect deployment windows — if you try to deploy outside a window, the system will tell you when the next window opens
- **Emergency changes** bypass window restrictions — use the override option when a critical fix needs to go out immediately
- **Blackout periods** block all deployments (except emergency) — these are typically set around major events or end-of-quarter

## Where to See Deployment Status

- **Build Studio** — The Ship phase shows deployment progress in the conversation panel
- **Operations > Promotions** — Lists all promotions with their status (Pending, Approved, Deployed, Rolled Back)
- **Inventory** — Successfully deployed features appear as registered digital products

## The Ship Phase Step by Step

When your feature is ready to ship, the AI Coworker runs through these steps in order:

1. **Extract and scan** — Pulls the code changes from the sandbox and scans for any risky database operations (like deleting tables). You are warned if any are found.
2. **Register product** — Creates a digital product record in the inventory and sets up change tracking
3. **Create backlog epic** — Adds the feature to the operations backlog for visibility
4. **Contribution assessment** — If sharing is enabled, evaluates whether the feature could benefit the wider community. You choose whether to share.
5. **Pull request and security gates** — Creates a pull request on the codebase with automated security checks: secret detection, backdoor scanning, architecture compliance, dependency audit, and destructive operation scanning. If all checks pass and the build is fully verified, the PR auto-merges. If any check fails, the PR is flagged for human review with details of what needs attention.
6. **Deploy** — Checks the deployment window and triggers the autonomous deployment pipeline described above

## Database Backups

Every deployment creates a backup before making changes. Backups are stored in the platform's backup directory and can be found in the promotion record. If you need to restore manually, the deployment log includes instructions.

Backup files are named with the build ID and timestamp for easy identification:
`pre-promote-FB-XXXXXXXX-YYYYMMDDHHMMSS.dump`

## Pull Requests and Security Gates

Before deploying, the platform creates a pull request on the codebase and runs automated security checks. This provides a code review record and catches issues before they reach production.

### Pre-PR Security Gates

Every PR goes through four automated checks:

1. **Security scan** — Detects SQL injection, XSS, command injection, hardcoded secrets, API token leaks, eval() usage, obfuscated code, unexpected network calls, and data exfiltration patterns
2. **Destructive operations** — Scans database migrations for DROP TABLE, TRUNCATE, and other destructive operations that require explicit acknowledgment
3. **Architecture compliance** — Verifies files are in the correct directories and imports follow platform conventions
4. **Dependency audit** — Flags any new packages added to the project for license and security review

### Auto-Merge

If all four gates pass AND the build has passed TypeCheck, all tests, and all acceptance criteria, the PR is automatically merged using squash merge. The build status updates to "complete."

If any gate finds issues, the PR is created but not merged. The findings are posted as a comment on the PR for human review.

### Configuration

Pull request creation requires a GitHub token. This is configured differently depending on your contribution mode:

- **Anonymous contributions** (selective/contribute_all mode) — The platform uses a pre-provisioned token (`HIVE_CONTRIBUTION_TOKEN` environment variable). No GitHub account is needed from the customer.
- **Private mode** (fork_only) — If you want PR-based code tracking for your own repository, configure a personal access token in Admin > Platform Development.

To set up the hive contribution token, add it to your `.env` file:

```shell
HIVE_CONTRIBUTION_TOKEN=ghp_your_fine_grained_pat_here
```

Then restart the platform: `docker compose restart portal-init portal`

## Safety Guarantees

- No deployment happens without an approved promotion
- No database changes happen without a backup first
- No version swap happens without a successful build
- No deployment completes without passing the health check
- All deployments are time-limited (10 minutes maximum)
- All deployments are logged with full audit trail
- Failed deployments roll back automatically — no manual intervention needed
- All code changes pass automated security gates before merging
