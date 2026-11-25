# Scheduling the worktree janitor

The worktree janitor (`scripts/worktree-janitor.mjs`, BI-AD949172) decides which
worktrees are safe to prune. It has always been able to run; nothing ever ran it
on a schedule. That gap is why worktree sprawl kept coming back and kept being
cleaned up by hand.

`scripts/install-worktree-janitor-schedule.sh` registers the janitor as a daily
task on the host. It does not change janitor policy — it only supplies the
trigger.

## Install

```bash
bash scripts/install-worktree-janitor-schedule.sh
```

That schedules a **dry-run** at 03:00 daily: the janitor classifies every
worktree and writes a report, and removes nothing. This is the recommended
starting point — read a few days of reports before letting it act.

Run it from anywhere in the repo, including a linked worktree. The script
resolves the **root clone** via `git rev-parse --git-common-dir`, so the
scheduled job always targets the root clone and its worktrees, never the tree
you happened to be standing in when you installed it.

## Letting it actually reap

```bash
bash scripts/install-worktree-janitor-schedule.sh --live --tier-a-only
```

- `--live` — remove eligible worktrees instead of only reporting.
- `--tier-a-only` — restrict removal to **Tier A**: merged to `origin/main`,
  clean, no open PR, no active lease, not pinned. Strongly recommended for
  anything unattended; the installer warns if you use `--live` without it.

Tier B (stale but unmerged) is observe-and-propose. Scheduling a `--live` run
without `--tier-a-only` makes Tier B removable — deliberate, and rarely what you
want from an unattended job.

When Tier B is removed live, a branch whose commits are on no remote is first
saved at `refs/janitor-backup/<YYYY-MM-DD>/<branch>` (logged); if that ref cannot
be written the worktree is kept instead (BI-EBBBDF40).

The janitor's own protections still apply and are not negotiable by this script:
`.worktree-pinned` is always honoured, dirty worktrees are refused, the root
clone is skipped, and eligible checkouts are renamed before their files are purged without following junctions.

### Other flags

| Flag | Meaning |
| --- | --- |
| `--grace-days N` | Stale threshold for Tier B (default 14) |
| `--hour H` | Local hour to run, 0–23 (default 3) |
| `--status` | Report whether the task is registered |
| `--uninstall` | Remove the task; leaves the janitor itself alone |

Direct CLI runs of `scripts/worktree-janitor.mjs` also support:

| Flag | Meaning |
| --- | --- |
| `--prune-detached` | Opt-in age-bounded classification/cleanup of stale clean detached-HEAD scratch worktrees (fails closed when Workroom claims are unreadable; honors `.worktree-pinned`, active leases, heartbeats, active process CWDs, claims, dirtiness, and mid-merge quarantine) |
| `--detached-grace-days N` | Age threshold for `--prune-detached` (defaults to `--grace-days`) |
| `--allow-fresh` | Bypass the 60-minute fresh-checkout-at-`origin/main` startup grace window (used by explicit settle hooks such as `scripts/t3-worktree-bridge.mjs on-settle`) |
| `--worktree-base PATH` | Override canonical sibling worktree directory scanned for unregistered orphan directories |

Every non-branch-scoped scan also inspects the canonical sibling worktree base (e.g. `../dpf-worktrees`) and `~/.t3/worktrees/<repo>` (when present) and reports unregistered orphan directories (`orphanDirs`, `summary.orphanCount`) while excluding standalone clones and linked worktrees belonging to other repositories. Orphan directories are always reported and never auto-deleted.

Re-running the installer replaces the existing task rather than adding a second
one, so it is safe to re-run to change flags.

## What gets registered

| Platform | Mechanism | Name |
| --- | --- | --- |
| macOS | launchd user agent | `local.dpf.worktree-janitor` |
| Linux | systemd user timer | `dpf-worktree-janitor.timer` |
| Windows | Scheduled Task (via Git Bash) | `DPF Worktree Janitor` |

All three are **user-level**, not system-level. No elevation is required and
nothing outside your account is modified.

## Reading the output

Each run appends to the shared git dir:

- `.git/worktree-janitor.schedule.out`
- `.git/worktree-janitor.schedule.err`

A healthy dry-run report looks like:

```
Worktree janitor — dry-run (grace=14d, policy=all)

  SKIP         /Users/you/dpf  (root clone)
  PRUNE_TIER_A /Users/you/dpf-worktrees/some-merged-thing  (merged to origin/main, clean, no open PR/lease)
  KEEP         /Users/you/dpf-worktrees/in-progress  (unmerged, 2d old (<14d grace))
  PINNED       /Users/you/dpf-worktrees/keep-me  (.worktree-pinned present)
```

## Who owns a worktree (BI-83345811)

Before classifying anything, the janitor asks the platform which worktrees an
active Workroom claims. It reads every page of one `list_workrooms`
observation. A row whose page omits or shortens its `worktreePath` is resolved
through that row's own `get_workroom` detail read. If the observation expires
mid-read, the janitor starts a new one (at most twice) and keeps nothing from
the expired one.

If any part of that read does not complete, it treats ownership as unknown and
keeps every worktree it would otherwise judge on ownership. A missing path is
never read as "no owner". The `--json` report states which happened:

```json
"claims": { "available": false, "reason": "workroom query failed: workroom observation expired" }
```

`available: true` with a reason like `66 workroom(s) read` means ownership was
proven for the whole population.

## Checking it ran

```bash
bash scripts/install-worktree-janitor-schedule.sh --status
```

To force a run now rather than waiting for the schedule:

```bash
launchctl kickstart "gui/$(id -u)/local.dpf.worktree-janitor"   # macOS
systemctl --user start dpf-worktree-janitor.service             # Linux
schtasks //Run //TN "DPF Worktree Janitor"                      # Windows
```

Then read the log. An empty `.err` and a populated `.out` means the chain works.

## Scoping to one branch, and the merge trigger (BI-848360EF)

`--branch <name>` narrows a scan to the single worktree on that branch. It changes no verdict: every decision still comes from `classifyWorktree`, so a live session heartbeat, an active Workroom claim, `.worktree-pinned`, an active lease, an open PR and a dirty tree all still refuse.

It exists because a merge tells the platform exactly one worktree just became reapable, and sweeping the whole fleet to act on one is both wasteful and a wider blast radius if anything is wrong.

The queue function `build/pr-merged-reap` subscribes to `build/pr-merged.received` and runs:

```
node scripts/worktree-janitor.mjs --branch <headRefName> --json --tier-a-only [--live]
```

This handles a branch that merges after its provider process exits. Provider SessionEnd is audit-only (BI-F52EF21B).

**It delegates rather than deleting**, and that is load-bearing rather than tidy. `classifyWorktree` places its liveness gate above the merged/Tier-A check precisely because *"the moment a live session's PR merges, its clean tree first becomes Tier-A eligible — exactly when it must NOT be reaped."* A merge-triggered reaper is the caller that walks into that window, so it must go through the classifier, never around it.

It uses the same two flags as the scheduled sweep, so there is one switch to reason about: `DPF_WORKTREE_JANITOR_ENABLED` to run at all, `DPF_WORKTREE_JANITOR_AUTO_REAP` to remove rather than report. Both default off. A scan that cannot reach its subject logs UNHEALTHY and reports `ran: false` — never success.

## Reap audit and quarantine

SessionEnd logs a refusal in `dpf-worktree-reap.jsonl` in the common Git directory. The Node janitor writes its live decisions to the same log, with the path, branch, tier, reason and outcome. If the log is unwritable, the record goes to stderr. Dry runs report the decisions without editing the log.

A named branch needs a reachable commit recorded as work on that branch after creation. A fast-forward or reset that only inherits main does not count. If the janitor cannot prove branch work, it keeps the checkout regardless of age or `--allow-fresh`.

The Node janitor cannot verify settled or archived T3 threads on a host without an authoritative settlement signal, so it keeps checkouts under `~/.t3/worktrees/` even when they have no heartbeat and their work is merged. The bridge can keep its liveness slot until host settlement, but the absence of that slot is not proof that the thread ended. A corrupt or unreadable heartbeat also keeps the checkout.

Before removal the janitor verifies that Git status is readable and clean, including untracked files. It takes a new process CWD snapshot just before each rename. If the snapshot is unavailable, including on hosts without supported CWD enumeration, it leaves the checkout intact. Otherwise it renames the checkout to a sibling `.dpf-reap-*` directory, unregisters the now-absent original path without force, then purges the quarantine without following dependency links. The `started` audit record gives the quarantine path. A stopped purge can leave debris in quarantine but not a partly deleted worktree at the original path. A refusal to unregister normally restores the original checkout intact. If rollback cannot be verified, leave the quarantine in place for operator inspection. Its `original-path` file identifies the checkout, and a missing final outcome is not proof that the purge completed.

## Related

- `scripts/worktree-janitor.mjs` — the janitor itself and its pruning rules
- `packages/dpf-skill-pack/skills/dpf-worktree-hygiene/SKILL.md` — dry-run
  default and the explicit-go rule for live reaping
- `docs/architecture/branch-and-worktree-runbook.md`
