# Scratch Install Rehearsal

Use this rehearsal before promoting changes that affect install, setup, provider authorization, Build Studio, Work Capsules, sandbox promotion, or platform shell routing.

The rehearsal is intentionally separate from `scripts/fresh-install.ps1`. The fresh-install script resets the local developer stack, and since BI-F9939341 it takes a full `pg_dump` into `$DPF_BACKUPS_HOST_PATH\pre-destructive\<date>resh-install-<ts>\` before `docker compose down -v`, refusing to continue if that dump fails (`-SkipPreDestructiveDump` overrides at the cost of every unmirrored row). The scratch rehearsal creates an isolated git worktree and Docker Compose project so first-run behavior can be checked beside the real install.

## What It Proves

- The current committed source can boot from empty runtime volumes.
- The portal reaches `/api/health` without copying secrets from the source install.
- Generated scratch credentials are isolated to the scratch worktree.
- Codex CLI and Claude CLI availability is recorded as evidence when present on the host.
- The scratch portal and sandbox use alternate host ports so the production-served local install can remain online.

## Plan-Only Preview

```powershell
.\scripts\scratch-install-rehearsal.ps1
```

The default mode prints the source SHA, scratch paths, Compose project name, generated URLs, and CLI availability without creating containers or worktrees.

## Run The Rehearsal

```powershell
.\scripts\scratch-install-rehearsal.ps1 -Execute
```

The script will:

1. Create a detached scratch worktree from `HEAD`.
2. Generate a scratch-only `.env`.
3. Generate a Compose override with non-default host ports.
4. Start the portal and sandbox with a unique Compose project and a low Compose parallel limit.
5. Wait for the scratch portal health endpoint.
6. Write evidence files under the scratch evidence directory.
7. Stop the scratch stack, remove scratch volumes, remove scratch image tags, and remove the scratch worktree unless keep flags are supplied.

Use a different port range if the defaults are occupied:

```powershell
.\scripts\scratch-install-rehearsal.ps1 -Execute -PortBase 4100
```

By default the script searches forward from `-PortBase` until it finds a free
set of host ports. Add `-NoAutoPortSearch` when you want port conflicts to fail
immediately.

Leave the scratch portal online for browser inspection:

```powershell
.\scripts\scratch-install-rehearsal.ps1 -Execute -KeepRunning
```

The stop command is printed at the end when `-KeepRunning` is used.

Run the first-run customer walkthrough while the scratch portal is live:

```powershell
.\scripts\scratch-install-rehearsal.ps1 -Execute -RunFirstRunWalkthrough
```

The walkthrough opens the scratch portal with Playwright, confirms `/setup`
is reachable on empty runtime volumes, creates the scratch organization and
owner account, verifies the provider setup surface, and verifies `/build/work`
after first login. It writes screenshots and
`first-run-walkthrough-result.json` to the same evidence directory. The
scratch password is used only for that local browser session and is not written
to evidence JSON. The walkthrough uses a 120-second per-step timeout by default
to allow clean production containers to complete cold first-auth navigation; use
`-WalkthroughTimeoutSeconds <seconds>` when a slower machine needs more room.

Use `-ComposeParallelLimit` to tune build concurrency. The default is `1` to
avoid Docker Desktop memory pressure during full-stack first-run rehearsal.

Use `-KeepWorktree` when you want to inspect generated scratch files after a
completed run. Evidence JSON remains under the scratch evidence directory even
when the worktree is removed.

Use `-KeepImages` when you want to inspect the built scratch image tags after
the run. Build cache may still make later rehearsals faster even when the tags
are removed.

## Evidence Files

The evidence directory contains:

- `scratch-rehearsal-manifest.json`
- `scratch-rehearsal-result.json` after health passes
- `first-run-walkthrough-result.json` and screenshots when
  `-RunFirstRunWalkthrough` is used
- `compose-ps.txt` and `portal-logs.txt` if health fails

Attach these files to the Work Capsule or release evidence before opening a PR for merge-ready promotion work.

## Backlog And Provider State

This rehearsal does not copy the source install database or provider secrets. That is deliberate.

For platform replacement or re-baselining, preserve backlog and epic records through the approved backup/export path before promotion, then re-authorize providers in the scratch or replacement install. Provider rows may be restored as setup requirements, but raw OAuth/client secrets must not be copied into the scratch evidence bundle.
