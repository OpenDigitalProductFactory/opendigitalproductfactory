---
title: "Feature Deployment"
area: build-studio
order: 2
---

## Overview

When a feature passes all quality gates in Build Studio, it enters the Ship phase. Where promotion is enabled for the install, the platform prepares a governed deployment: backing up your database, building a new version of the application with your feature included, swapping it into production, and verifying everything works. If anything goes wrong, rollback protection applies.

You do not need to understand Docker, databases, or deployment tools. The platform manages the entire process and reports the result in plain language.

## How Deployment Works

The deployment pipeline has eleven governed steps when promotion is enabled:

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
5. **Documentation evidence** — Confirms that affected user guide, public site, architecture, install/ops, prompt, or contributor docs were updated, or that the build recorded a concrete no-docs-needed reason.
6. **Pull request and security gates** — Creates a pull request on the codebase with automated security checks: secret detection, backdoor scanning, architecture compliance, dependency audit, and destructive operation scanning. Build Studio checks the current PR evidence, safely refreshes a stale branch, and asks the protected merge queue to integrate an eligible change. It never bypasses the queue.
7. **Deploy** — Checks the deployment window and triggers the governed deployment pipeline described above where promotion is enabled

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

### Autonomous Merge-Queue Delivery

If all four gates pass AND the build has passed TypeCheck, all tests, and all acceptance criteria, Build Studio watches the current PR head, waits for repository checks and review threads, and enrolls it in the protected merge queue. If the platform advances while checks run, Build Studio requests a safe branch update and waits for fresh checks.

Build Studio reports these states in plain language:

- **Checking the pull request** — current checks or review evidence are still running
- **Finalizing against the latest platform** — the branch is being refreshed safely
- **Merge queued** — the protected repository queue owns the next step
- **Waiting for governed release** — the PR merged, but the live platform has not advanced yet
- **Deployed** — governed release evidence proves the change is live
- **Needs your decision** — a true conflict, closed PR, or bounded recovery limit requires a person

A merged pull request does not make the build complete. Completion waits for the
governed release and live-version evidence. Build Studio does not directly
merge, force-push, or silently edit a true conflict.

### Configuration

Pull request creation requires a GitHub token. This is configured differently depending on whether your install is **Contributing** or **Private** (the two contribution states — see Admin > Platform Development):

- **Contributing install** — The platform uses a pre-provisioned token (`HIVE_CONTRIBUTION_TOKEN` environment variable) for anonymous contributions. No GitHub account is needed from the customer. When you ship a change, the platform suggests whether to keep it on your system or share it with the community, and you make the final call (nothing is shared without your confirmation).
- **Private install** — Everything stays on your own system. If you want PR-based code tracking for your own repository, configure a personal access token in Admin > Platform Development.

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
- Documentation impact is resolved or explicitly attested before release acceptance
- Failed deployments roll back automatically — no manual intervention needed
- All code changes pass automated security gates before merging
