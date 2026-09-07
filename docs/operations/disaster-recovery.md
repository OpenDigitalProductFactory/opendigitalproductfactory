---
# Doc-impact edges (EP-DOCS-SYSTEM Phase 4). This runbook names specific
# services, backup members and restore scripts, so a change to the service
# topology or the backup job set must flag it for review. Without these edges
# the BET-5 datastore retirement left this page telling operators — mid-incident
# — to restore a Neo4j database that no longer exists.
relatedCode:
  - docker-compose.yml
  - packages/db/src/seed-platform-backup.ts
  - scripts/backup-postgres.sh
  - scripts/restore-postgres.sh
  - dpf-reinstall.ps1
  - scripts/fresh-install.ps1
---

# Disaster recovery runbook

**Audience:** DPF operators in an incident. Non-technical-friendly; everything has copy-pasteable commands.
**BI:** BI-24B263F4 in EP-DR-HARDENING-2026-05-23.
**Source incident:** 2026-05-23 overnight Docker volume wipe (`D:\DPF-archive-2026-05-23\LESSONS-2026-05-23-VOLUME-WIPE-INCIDENT.md`).

---

## 0. Stop, breathe, read

Before doing anything destructive in response to a problem: **read this entire document**. The 2026-05-23 incident was made worse by an agent doing `docker compose down -v` to "fix" things; that wiped operator state. The runtime kernel commandments shipped under this epic ([BI-43F95F77](#)) block that class of mistake now, but only if you don't bypass them via absolute paths.

**The single rule:** prefer a slower recovery that preserves state over a faster one that doesn't. You can always re-run a backup; you cannot un-wipe a volume.

---

## 1. Inventory — what's recoverable from what

The DR-hardening epic (BIs shipped 2026-05-24) put recovery artifacts in **specific places that survive specific failure modes**. Knowing which artifact covers which loss saves the most time during an incident.

| What you lost | Where it lives | Restores via |
|---|---|---|
| Postgres rows (current state) | `$DPF_BACKUPS_HOST_PATH/postgres/<YYYY-MM-DDTHH-MM-SSZ>/dpf.dump` — nightly at 03:00 UTC | Admin UI `/admin/backups` → "Restore" wizard, OR `docker exec -i dpf-postgres-1 pg_restore --clean --if-exists -U dpf -d dpf < <dump>` |
| Graph topology + vector/semantic memory | **Inside the Postgres dump above** — since BET-5 these are the `graph_node` / `graph_edge` tables and `pgvector` embeddings, not separate stores | Same Postgres restore; there is no separate graph or vector member to restore |
| Postgres state from JUST BEFORE a destructive action | `$DPF_BACKUPS_HOST_PATH/pre-destructive/<date>/docker-volume-rm-pgdata-<ts>.dump` (or similar fingerprint per action) | Same restore wizard; treats it as any other dump |
| Postgres state from JUST BEFORE `dpf-reinstall.ps1` or `scripts/fresh-install.ps1` ran `docker compose down -v` | `$DPF_BACKUPS_HOST_PATH/pre-destructive/<date>/dpf-reinstall-<ts>/dpf.dump` (or `fresh-install-<ts>/`), with `dpf.dump.sha256` and `manifest.json` beside it. Both scripts refuse to destroy the database if this dump fails; `-SkipPreDestructiveDump` is the only way past, and it says what it costs. This is what keeps Workrooms, decisions and unmirrored backlog rows alive across a reinstall (BI-F9939341). | Same restore wizard, or `docker exec -i dpf-postgres-1 pg_restore --clean --if-exists -U dpf -d dpf < dpf.dump` |
| Uncommitted git work before `git reset --hard` | `git stash list` shows entries named `pre-destructive-snapshot <ts> <fingerprint>` | `git stash pop stash@{N}` |
| `.env` + `.claude/settings.local.json` before install-dir rm | `$DPF_BACKUPS_HOST_PATH/pre-destructive/<date>/remove-item-recurse-*.essentials.zip` | `Expand-Archive <zip> -DestinationPath $DPF_DIR` |
| Recent Claude Code session transcripts | `$DPF_BACKUPS_HOST_PATH/session-transcripts/<YYYY-MM-DD>/<session-id>.jsonl` — every PostToolUse (throttled to 2 min) + every SessionEnd | Copy back to `~/.claude/projects/D--DPF/<session-id>.jsonl`, then `/resume <session-id>` in Claude Code |
| Branches + commits in git | `.git` directory — survives anything that doesn't rm the repo dir | `git reflog`, `git branch -a`, `git fetch origin --tags` |
| Branches + commits after install-dir rm | GitHub `origin` IS the source of truth; clone fresh | `git clone https://github.com/OpenDigitalProductFactory/opendigitalproductfactory $DPF_DIR` |
| Docker images | Pull-on-demand from registries | `docker compose pull` or `install-dpf.{ps1,sh}` |
| Docker volumes (any) | NOT recoverable from Docker layer — the daily backup IS the durable copy | See dump-restore rows above |
| Tool config / installer state | `install-state.json` in install dir | If lost: re-run `install-dpf.{ps1,sh}`; it's idempotent |
| Failed platform upgrade / bad seed apply / migration damage | Governed upgrade recovery point: linked `BackupRun` rows under `$DPF_BACKUPS_HOST_PATH/postgres/<ts>/` plus previous runtime identity under `$DPF_BACKUPS_HOST_PATH/self-upgrade/<runId>/` | Upgrade Center rollback/restore flow; if unavailable, restore the Postgres member directly |

> **BET-5 changed this table.** Neo4j and Qdrant were retired onto PostgreSQL
> (BI-A1E864A5). Their nightly backup jobs are **deactivated** and
> `scripts/{backup,restore}-{neo4j,qdrant}.sh` only apply to pre-BET-5 archives
> you may still hold — do not reach for them during a current-day incident. One
> Postgres dump now carries relational state, graph topology and vectors
> together, which also removes the old hazard of restoring three members to
> three different points in time.

Implementation note (2026-06-01): self-upgrade runs record the linked
Postgres backup member in
`SelfUpgradeRun.completionEvidence.recoveryPoint` after quiescence drains active
work and before the swap boundary. `/ops/self-upgrade` can restore that matched
recovery point for completed non-running runs; the action records
`completionEvidence.rollback`, writes `self-upgrade-rollback` into
`BackupRestore.trigger`, and marks the run `rolled-back` or
`rollback-failed`. If the portal is unavailable, use the recorded `BackupRun`
ids to restore through the backup substrate directly.

Research note (2026-06-02): the sandbox server is a recovery rehearsal target,
not a backup of record. Use it to prove that a recovery point can restore and
boot before production state is touched. The Postgres trial-restore path is
shipped end-to-end, and since BET-5 that single path also rehearses graph and
vector recovery — they are tables in the same dump, and `sandbox-postgres` is
isolated, so the old caveat about the sandbox pointing at shared Neo4j/Qdrant no
longer applies. Never use the dev-against-live-DB compose overlay for recovery
rehearsal because it can write to live data.

**Key principle:** if you can't find your loss in this table, that means there's no automatic recovery for it. Stop and ask for help BEFORE doing anything destructive — the action you take next may be the difference between a 1-hour and 6-hour recovery.

---

## 2. Decision tree — "my portal won't start"

```
Is `docker ps` showing dpf-portal-1 + dpf-postgres-1 healthy?
│
├── NO containers at all
│   └── Did you run `docker compose down -v` recently?
│       ├── YES → §3.1 Volume wipe recovery (use nightly backups)
│       └── NO  → Try `cd $DPF_DIR && docker compose up -d`; check `docker compose logs`
│
├── Containers exist but unhealthy
│   └── Which one?
│       ├── postgres unhealthy → §3.2 Postgres-down recovery
│       ├── redis unhealthy    → §3.3 Redis-down recovery
│       └── portal unhealthy   → check `docker compose logs portal` for migration errors → §3.5
│
└── All healthy but portal returns 500
    └── Check `/api/health` → `/api/diagnostics/preflight` → inspect portal logs
        Usually: schema drift OR runtime gate config error. See §3.5.
```

---

## 3. Specific recovery scenarios

### 3.1 Volume wipe recovery (the Postgres volume is gone)

1. **DO NOT** re-run `docker compose down -v` or `Remove-Item -Recurse $DPF_DIR` again. The runtime kernel commandments should block you; if they don't, you're on a pre-relocation install — STOP and read [`runtime-kernel-commandments.md`](runtime-kernel-commandments.md) first.

2. Verify nightly backups exist:

   ```powershell
   Get-ChildItem "$env:DPF_DIR-backups\postgres" | Sort-Object Name -Descending | Select-Object -First 3
   ```

3. Bring the database back up with an empty volume:

   ```powershell
   cd $DPF_DIR
   docker compose up -d postgres
   # Wait for healthcheck (~30s)
   ```

4. Restore from the most recent dump — one dump carries relational state, the
   graph mirror and the vector embeddings together:

   ```powershell
   docker exec -i dpf-postgres-1 pg_restore --clean --if-exists -U dpf -d dpf `
     < "$env:DPF_DIR-backups\postgres\<latest-ts>\dpf.dump"
   ```

5. Start the portal:

   ```powershell
   docker compose up -d portal
   ```

6. **Verify** the trial-restore mechanism re-runs cleanly tonight — if `/admin/backups` shows the readiness card with `trial-restore: ok` next morning, you're confirmed-good.

### 3.2 Postgres down (other stores OK)

Likely causes (most → least common):
- Out-of-disk in the Postgres volume.
- A `docker volume rm dpf_pgdata` slipped past the gate (look at `$DPF_BACKUPS_HOST_PATH/pre-destructive/.snapshot.log` for a snapshot timestamp + grep `outcome":"FAILED"` to see if pre-destructive snapshot fired).
- A `prisma migrate reset` was run.

Steps:
1. Check pre-destructive snapshot first — if one exists for the timestamp you suspect, that's a tighter recovery point than the nightly:

   ```powershell
   Get-ChildItem "$env:DPF_DIR-backups\pre-destructive" -Recurse -Filter '*pgdata*.dump' |
     Sort-Object LastWriteTime -Descending | Select-Object -First 5
   ```

2. Pick the most recent dump (pre-destructive OR nightly, whichever is later AND verified).

3. Run the restore via admin UI (`/admin/backups` → select dump → "Restore") OR via CLI as in §3.1 step 4.

### 3.3 Redis down (Postgres OK)

- Redis backs the Inngest job queue and its state, so a Redis outage stops scheduled and event-driven work while leaving platform data intact.
- Restart first: `docker compose logs redis`, then `docker compose restart redis`.
- Redis holds **no system of record**. If its volume is gone, bring it back empty — in-flight job state is lost and Inngest re-establishes from its own durable records. There is nothing to restore from a backup.

### 3.4 Graph or vector data looks wrong (Postgres OK)

Since BET-5 there is no separate graph or vector service to be "down". Both live in Postgres, so this is a *projection* problem, not an availability one:

- **Graph topology stale or missing** — the `graph_node` / `graph_edge` mirror is a fire-and-forget projection, so it can drift from its source tables. Re-project rather than restore: `rebuildEaGraph()` for the EA graph, and the discovery/inventory sync for infrastructure CIs. A restore only helps if the source tables themselves are damaged.
- **Semantic search returning nothing** — `pgvector` embeddings are regenerable from their source documents. Re-embed rather than restore.
- If the underlying Postgres data is genuinely lost, this is §3.1 or §3.2 — one dump restores tables, graph and vectors together.

### 3.5 Portal returns 500 (containers healthy)

Most common: schema drift. The portal expects a Prisma schema version that doesn't match what's in Postgres.

1. Check the portal logs: `docker compose logs portal --tail 100`. Look for `PrismaClientKnownRequestError` or migration errors.

2. Re-apply migrations against the current DB:

   ```powershell
   docker exec dpf-portal-1 pnpm --filter @dpf/db exec prisma migrate deploy
   ```

3. If migrations were rolled back unintentionally, restore Postgres from the most recent nightly that has the expected schema version (check `BackupRun.dpfVersion` for the recorded version per backup).

### 3.5a Failed upgrade, seed clobber, or migration damage

This is the "update made things worse" path. Treat it as an upgrade incident,
not as a fresh install problem.

1. Do not reinstall and do not reset volumes. The recovery point taken before
   apply is the boundary between recoverable and data-lossy.
2. In the portal, open `/ops/self-upgrade` and inspect the failed run. When the
   run has a complete `pre-upgrade-recovery` point, type the confirmation text
   and use the recovery-point restore action; it knows the exact Postgres
   backup row created for the run and records rollback evidence on the run.
3. If production is impaired but stable enough to wait, prefer a sandbox-assisted
   rehearsal before touching production: restore the recovery-point members into
   an isolated nonproduction target, boot the portal against that target, and
   capture health/smoke evidence on the `SelfUpgradeRun`. Postgres
   trial-restore is the shipped restore proof, and since BET-5 it covers graph
   and vector state too — they are tables in the same dump.
4. If the portal is unavailable, use `/admin/backups` after bringing the
   database up, and restore the Postgres backup associated with the failed
   upgrade. That single member carries relational, graph and vector state.
5. After recovery, capture the failed `SelfUpgradeRun`, `BackupRun`, and
   restore records in the incident notes. Do not delete the failed recovery
   point until the next successful nightly backup and trial restore have passed.
6. If the incident involved Build Studio or an external worker such as Grok,
   preserve the worker worktree before cleanup. Record its branch, dirty state,
   touched paths, and whether it was `compile-ready` or `source-only`. A
   source-only worktree is useful forensic evidence, but its local test/build
   claims are not recovery evidence unless the same gates also ran in canonical
   runtime or the shared local-CI sandbox.

### 3.5b Sandbox-assisted recovery rehearsal

Use this when a restore is high-risk but not yet an emergency volume-loss
situation. The goal is to turn a restore from an act of faith into evidence:
the same recovery point that would be applied to production is first applied to
an isolated target and smoke-tested.

Safe targets:

- `local-integration-ci`, when leased through the nonproduction environment
  lease system and backed by an isolated Postgres endpoint.
- A future dedicated `recovery-drill` environment key for longer BC/DR drills.
- The Build Studio `sandbox`, which has its own `sandbox-postgres` — and since
  graph and vector state are tables in that same database, isolating Postgres
  now isolates the whole rehearsal.

Unsafe targets:

- `docker-compose.dev-against-live-db.yml`, because it intentionally writes to
  live databases.
- Any sandbox whose `DATABASE_URL` resolves to the production Postgres container.
- Docker named volumes by themselves. Volumes persist container data, but the
  durable recovery artifact is the host-retained backup plus restore evidence.

The rehearsal should record lease id, backup run ids, restore log paths,
health/smoke results, image/source identity, and expiry/cleanup status. If a
member is skipped because isolation is missing, record `not-run` rather than
implying that the whole recovery point was proven.

### 3.6 Lost a Claude Code session transcript (forensic recovery)

When investigating "what did the agent do?" after an incident:

```powershell
# Find the most recent snapshots across all sessions
Get-ChildItem "$env:DPF_DIR-backups\session-transcripts" -Recurse -Filter '*.jsonl' |
  Sort-Object LastWriteTime -Descending | Select-Object -First 20 FullName, Length, LastWriteTime

# Extract tool calls from a specific session
jq -c 'select(.type == "tool_use")' "<snapshot path>" | tail -30
```

To resume the session in Claude Code: copy the snapshot back to `~/.claude/projects/<slug>/<session-id>.jsonl` then `/resume <session-id>`.

### 3.7 Branch / uncommitted work lost (git reset --hard etc.)

1. Check pre-destructive git stash entries:

   ```powershell
   git stash list | Select-String 'pre-destructive-snapshot'
   ```

2. Restore via `git stash pop stash@{N}`.

3. If the stash itself was lost: `git reflog` shows every HEAD position the last ~90 days. Look for the commit hash of the work you want and `git checkout <hash>`.

4. If even the reflog is gone (rare): GitHub `origin` has everything that was ever pushed. `git fetch origin --all --tags` + `git branch -a` to see remote-tracking branches.

---

## 4. Annual fire drill

**Cadence:** once per year, on a fixed date (anniversary of the 2026-05-23 incident — 2027-05-23 is the first one). Operator runs this runbook against a deliberately-broken state to validate it still works.

### Fire drill procedure

1. **Schedule.** Block 2 hours. Tell the team you're doing the fire drill.

2. **Prepare a sacrificial state.** Either:
   - Spin up a throwaway DPF install in a sibling dir (`D:\DPF-firedrill-<date>`), let it run for a day to accumulate state, then snapshot it.
   - OR use a real backup from a previous restore-test cycle.

3. **Pick a scenario from §3.** Roll a d6:
   - 1-2: §3.1 volume wipe
   - 3: §3.2 postgres down
   - 4: §3.5 portal 500
   - 5: §3.6 transcript recovery
   - 6: §3.7 git stash recovery

4. **Break it.** Apply the scenario to the throwaway install:
   - `docker volume rm dpf_pgdata` (use absolute path to bypass the gate — this is the drill)
   - OR delete a portal log line that says "migration ok" and corrupt a row.

5. **Recover using ONLY this runbook.** Stopwatch from break-time. No reading source code. No asking for help. If you get stuck, that's a runbook gap — note it.

6. **Verify recovery.** Portal `/api/health` returns 200. Spot-check 3 BacklogItems exist. Trial-restore at next 03:00 UTC passes.

7. **Report.** What worked, what didn't, what should be added to this doc. Update the runbook same-day. Commit with `doc(operations): fire-drill <YYYY> findings`.

The whole point: recovery commands rot. A runbook that wasn't tested in 12 months is a fiction. The drill turns fiction into ground truth.

---

## 5. Composition with the DR-hardening epic (what's actually in production)

Cross-references for engineers reading this:

| Mechanism | Where to read | Status as of 2026-05-24 |
|---|---|---|
| Backups OUTSIDE install root | [`runtime-kernel-commandments.md`](runtime-kernel-commandments.md) + spec `2026-05-17-postgres-daily-backup-design.md` §5.3 | Shipped (BI-8004BCD8) |
| Runtime gate that blocks destructive commands | [`runtime-kernel-commandments.md`](runtime-kernel-commandments.md) | Shipped (BI-43F95F77) |
| Nightly trial-restore verification | spec `2026-05-17-postgres-daily-backup-design.md` §4.7 | Shipped (BI-31C9FBDF) |
| Sandbox-assisted recovery rehearsal | spec `2026-05-23-governed-platform-upgrade-lifecycle-design.md` §5.2.7 | Designed 2026-06-02; Postgres proof pattern shipped, full graph/vector rehearsal pending isolated endpoints |
| Worktree janitor (lib + tests) | spec `2026-05-16-worktree-hygiene-design.md` | Phase 1 shipped (BI-E5002629); Phase 2-5 pending |
| Claude Code transcript snapshots | [`session-transcript-recovery.md`](session-transcript-recovery.md) | Shipped (BI-C8655C8C) |
| Pre-destructive snapshots | [`runtime-kernel-commandments.md`](runtime-kernel-commandments.md) §"Pre-destructive snapshots" | Shipped (BI-611C25F3) |
| This runbook | this file | Shipped (BI-24B263F4) |
| Portal admin "Recover from backup" UI | (not yet) | Pending (BI-3849A48B) |
| Backup health card in admin | (not yet) | Pending (BI-A8C149C1) |

---

## 6. What this runbook does NOT cover

- **Hardware failure of the operator's machine.** That's a property restoration scenario covered by your normal backup-of-the-whole-machine strategy (OneDrive / Time Machine / etc.). DPF's backups under `$DPF_BACKUPS_HOST_PATH` should be included in whatever you back up the rest of the machine with.
- **GitHub-side disasters** (account locked, repo deleted). DPF is open-source on GitHub; the org maintains the canonical history. If your local clone is intact and GitHub is gone, push your local to a new remote. If both are gone — that's beyond the scope of this runbook.
- **Adversarial scenarios** (malicious agent, compromised host). The runtime gate raises the cost of accidental destruction, not intentional. For adversarial cases, the audit logs at `$DPF_BACKUPS_HOST_PATH/{pre-destructive,session-transcripts,kernel-gate}/.*.log` are your forensic record — preserve them BEFORE rebuilding.

---

*Last updated 2026-05-24 by Mark Bodman + Claude (BI-24B263F4 shipping this initial version). Update on every fire drill.*
