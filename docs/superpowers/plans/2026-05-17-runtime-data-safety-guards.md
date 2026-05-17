# Runtime Data-Safety Guards

> Status: implementation slice for the 2026-05-17 backlog wipe RCA. This is intentionally narrow: prevent worktree and harness Compose state from joining the live `dpf` project.

## Problem

`docker-compose.yml` used a fixed top-level project name, `dpf`. A linked worktree that ran Compose could therefore create containers and volumes in the same project namespace as the live install. Later root Compose operations saw divergent config labels inside project `dpf`, which could recreate the named Postgres volume and wipe the local backlog.

## Guardrails

- `docker-compose.yml` keeps `dpf` as the root fallback but reads `COMPOSE_PROJECT_NAME` first.
- `scripts/seed-worktree-mcp.ps1` and `scripts/seed-worktree-mcp.sh` write a unique ignored `.env` entry for linked worktrees: `COMPOSE_PROJECT_NAME=dpf-<worktree>`.
- `.github/workflows/ci.yml` sets a unique project name for the ADP integration harness.
- `scripts/dpf-compose.mjs` blocks integration-harness Compose runs without a unique `dpf-*` project name.
- `scripts/dpf-compose.mjs` refuses `down --volumes` against project `dpf` unless `DPF_ALLOW_DESTRUCTIVE_COMPOSE=1` is set for an intentional recovery/reinstall.

## Verification

Run:

```powershell
node --test scripts/lib/compose-safety.test.mjs
```

For the non-destructive Compose render check, use a unique project name and the same required CI placeholders as the workflow:

```powershell
$env:COMPOSE_PROJECT_NAME = "dpf-ci-local-guard-check"
$env:AUTH_SECRET = "ci-placeholder"
$env:CREDENTIAL_ENCRYPTION_KEY = "0000000000000000000000000000000000000000000000000000000000000000"
node scripts/dpf-compose.mjs --profile integration-test config --services
```
