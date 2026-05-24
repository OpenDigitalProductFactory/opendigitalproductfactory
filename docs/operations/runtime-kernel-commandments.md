# Runtime kernel commandments — operator guide

**Audience:** DPF operators (not engineers — no code reading required).
**Spec:** [`docs/superpowers/specs/2026-05-24-runtime-kernel-commandments.md`](../superpowers/specs/2026-05-24-runtime-kernel-commandments.md)
**Backlog item:** BI-43F95F77 in EP-DR-HARDENING-2026-05-23

## What this is

DPF ships kernel commandments — top-tier governance rules like "never wipe the DB to fix code" and "destructive actions require explicit go". Before this feature, those commandments lived only as documentation: an agent could read them and still ignore them.

This feature turns the most dangerous commandments into **runtime gates**. When an AI agent (or even you, accidentally) tries to run a destructive command, a shell guard pauses execution, asks the DPF portal for a decision, and either:

- **Refuses** the command outright (if the system is running autonomously — no human present), or
- **Asks for a typed confirmation phrase** (if you're at a terminal — gives you a chance to think about it).

The intent is to make accidental data loss much harder, while keeping intentional operator actions only one extra step away.

## What gets gated

Two commandments ship with runtime enforcement:

1. **`never-wipe-db-for-code-fixes`** — blocks `docker volume rm`, `docker compose down -v`, `prisma migrate reset` (and pnpm-wrapped variants), and `DROP DATABASE dpf`.
2. **`destructive-actions-require-explicit-go`** — blocks `git push --force / --force-with-lease` to main, `git reset --hard`, and `rm -rf /` on absolute paths.

The full pattern list lives in each principle's frontmatter at `docs/founder-kernel/wiki/principles/`. Engineers can add new commandments by editing the principle file (one line of inline JSON in the frontmatter) — no code change.

## What you'll see when it fires

### Autonomous mode (Build Studio executor, scheduled tasks)

```
[dpf-shell-guard] REFUSED by kernel commandment 'never-wipe-db-for-code-fixes'
                  docker volume rm removes Docker volumes including operator state
                  Operator may bypass via absolute path: /usr/bin/docker ...
```

The command exits 1 immediately. No prompt — the assumption is no human is watching, so silently refusing is the safe answer.

### Interactive mode (you, at a terminal)

```
[dpf-shell-guard] Commandment 'never-wipe-db-for-code-fixes' requires explicit operator go:
                  docker volume rm removes Docker volumes including operator state

  Type EXACTLY (no quotes): I-MEAN-IT-never-wipe-db-for-code-fixes-7K3F
  >
```

You type the phrase EXACTLY (including the random 4-character token that rotates per attempt). Correct → command runs. Wrong / missing → refused.

The random token prevents accident-by-paste: you can't pre-type `I-MEAN-IT-never-wipe-db-for-code-fixes-...` in advance, because the token isn't predictable.

## How to bypass when you genuinely mean it

If you have a real reason to run a blocked command — disaster recovery, throwaway test environment, you-built-it-and-you-mean-it — bypass via the absolute path:

```bash
/usr/bin/docker volume rm dpf_pgdata     # POSIX
C:\Program Files\Docker\Docker\resources\bin\docker.exe volume rm dpf_pgdata   # Windows
```

Or set `DPF_REAL_<CMD>` env vars (which the installer writes for you at install time):

```bash
$DPF_REAL_DOCKER volume rm dpf_pgdata
```

The bypass mechanism is intentional — this is a gate against unintentional destruction, not a hard barrier. The point is to slow down the moment between "type the command" and "destroy the data" so you can reconsider.

## What if I want to disable the guard?

You can remove `safety-bin` from your PATH:

```bash
# POSIX — edit the marker block in ~/.profile / ~/.bashrc / ~/.zshrc
# >>> dpf-safety-bin >>>
# (delete this block and the lines between markers)
# <<< dpf-safety-bin <<<
```

```powershell
# Windows — remove from user PATH
[Environment]::SetEnvironmentVariable("Path", ([Environment]::GetEnvironmentVariable("Path", "User") -replace "$DPF_DIR\\safety-bin;", ""), "User")
```

Opening a new terminal afterwards picks up the change. Re-running `install-dpf.sh` / `install-dpf.ps1` will re-add the safety-bin block — the installer assumes the guard is on by default.

## What happens when the portal is down

If `/api/kernel/gate` is unreachable (portal stopped, restarting, network glitch), the shell guard falls back to a **static patterns file** baked alongside the guard at `safety-bin/dpf-shell-guard-fallback-patterns.json`. The fallback enforces the same tier-1 patterns even with the portal down — fail-closed for the most dangerous commands, fail-open for everything else.

The fallback file is regenerated each time you run the installer, so it reflects whatever commandments you've added to the principle wiki since the last install.

## How to add a new commandment

Engineers (or operators editing the kernel wiki):

1. Edit the principle file in `docs/founder-kernel/wiki/principles/<slug>.md`.
2. Add a `principleRuntimeEnforcement` line in the frontmatter (single inline JSON value — the parser doesn't support nested YAML blocks yet).

```yaml
principleRuntimeEnforcement: {"interactiveMode":"confirm","autonomousMode":"refuse","patterns":[{"kind":"shell","regex":"^docker\\s+volume\\s+rm\\b","rationale":"why this is blocked"}]}
```

3. Pattern `kind` values: `shell` (regex match on the full command line), `mcp_tool` (exact tool-name match), `sql` (regex match on the statement), `git` (regex match on the git subcommand + flags).
4. Re-seed the kernel: `pnpm --filter @dpf/db exec tsx src/seed-wiki-kernel.ts`.
5. Restart the portal to invalidate the in-memory principle cache.

The lint detector at `apps/web/lib/wiki/principle-lint-detectors.ts` validates the block — invalid regex / missing rationale / invalid modes are caught at seed time.

## Where the audit trail lives

Every gate decision emits two signals:

1. **Prometheus counter** at `/api/metrics`:

```
dpf_kernel_gate_decisions_total{verdict="refuse",principle_slug="never-wipe-db-for-code-fixes",session_class="autonomous"} 3
```

2. **Structured log line** in the portal:

```
[kernel-gate-trace] verdict=refuse slug=never-wipe-db-for-code-fixes session=autonomous kind=mcp_tool tool=...
```

Both let you see (after the fact) which commandments fired, how often, and which sessions hit refuses vs. confirms.

## Known limits

- Single-line inline JSON only for `principleRuntimeEnforcement` frontmatter (parser limit; multi-line YAML authoring is a separate follow-up).
- `(?i)` and similar inline regex flags work (lifted to JS RegExp constructor flags by the gate); mid-pattern inline flags do NOT.
- Process-lifetime cache: principle changes require a portal restart to invalidate. Slice 2+ can add TTL or write-time invalidation.
- Slice 1 covers shell + MCP-tool paths. SQL (Prisma middleware) and git pre-push hook are separate follow-ups.
- The guard cannot intercept commands run via absolute path — that's the documented bypass mechanism.

## Pre-destructive snapshots (BI-611C25F3)

When you typed-confirm a destructive command, DPF tries to take an automatic snapshot of the affected resource BEFORE the destructive action runs. This makes recovery one rollback away.

### What gets snapshotted

| Destructive command | Snapshot strategy |
|---|---|
| `docker volume rm dpf_pgdata` | `pg_dump` → `$DPF_BACKUPS_HOST_PATH/pre-destructive/<date>/docker-volume-rm-pgdata-<ts>.dump` |
| `docker volume rm dpf_neo4jdata` | Defers to the most recent nightly Neo4j backup (online dump would require stopping the DB first, which the destructive command is itself about to do). |
| `docker volume rm <other>` | Best-effort `pg_dump` (audit log identifies it as "other"). |
| `docker compose down -v` | Both pg_dump + neo4j-defer. Succeeds if at least one strategy captures. |
| `prisma migrate reset` | `pg_dump`. |
| `git reset --hard` | `git stash push -u` of uncommitted work in the current repo. Recoverable via `git stash list` / `git stash pop`. |
| `Remove-Item -Recurse` on the install dir | Tarball of operator-private artifacts (`.env`, `.claude/settings.local.json`, host profile). |
| Anything else matched by the runtime gate | No strategy → operator gets a warning ("proceeding without rollback artifact") but the action proceeds. |

### Behavior on snapshot failure

If the snapshot itself fails (e.g., postgres is wedged, disk full, docker exec errors), the shell guard prompts you a SECOND time before proceeding:

```
[dpf-shell-guard] ⚠ PRE-DESTRUCTIVE SNAPSHOT FAILED
                  The destructive action will proceed WITHOUT a rollback option.
                  See $DPF_BACKUPS_HOST_PATH/pre-destructive/.snapshot.log for details.

  Type Y to proceed anyway, anything else to cancel:
```

Single `Y` keystroke proceeds. Anything else cancels. The second prompt exists because your first typed-confirm assumed a snapshot would be taken; without one, the safety contract changed and you get one more chance to think.

### Audit log

Every snapshot attempt writes one structured JSON line to `$DPF_BACKUPS_HOST_PATH/pre-destructive/.snapshot.log`:

```
[pre-destructive-snapshot-trace] {"timestamp":"2026-05-24T18:47:59.400Z","event":"pre-destructive-snapshot","outcome":"OK|FAILED|DEFERRED|NO_STRATEGY","strategy":"pg_dump|neo4j|git-stash|fs-essentials","snapshot_path":"…","reason":"…","cmd":"docker volume rm dpf_pgdata","install_root":"…"}
```

Grep `outcome":"FAILED"` after an incident to find snapshot failures that the operator proceeded through anyway.

### How to restore from a pre-destructive snapshot

- **pg_dump files** — use the existing restore wizard at `/admin/backups` (recognizes any `.dump` file under `$DPF_BACKUPS_HOST_PATH`). Or `docker exec -i dpf-postgres-1 pg_restore --clean --if-exists -U dpf -d dpf < <path-to-snapshot>`.
- **git stash** — `git stash list` shows entries named `pre-destructive-snapshot <ts> <fingerprint>`. `git stash pop stash@{N}` restores.
- **fs-essentials tarball** — `tar -xzf <snapshot> -C $DPF_DIR` restores the captured files in-place.

### Retention

Pre-destructive snapshots are kept for **90 days** (longer than transcript snapshots' 30 days — these are recovery artifacts for confirmed-destructive operator actions, higher recovery value). Pruning runs in-line on every snapshot dispatch, so no separate cron.
