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

The janitor's own protections still apply and are not negotiable by this script:
`.worktree-pinned` is always honoured, dirty worktrees are refused, the root
clone is skipped, and removals go through the junction-safe helper.

### Other flags

| Flag | Meaning |
| --- | --- |
| `--grace-days N` | Stale threshold for Tier B (default 14) |
| `--hour H` | Local hour to run, 0–23 (default 3) |
| `--status` | Report whether the task is registered |
| `--uninstall` | Remove the task; leaves the janitor itself alone |

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

This closes the gap the SessionEnd hook structurally cannot: that hook can only reap a Tier-A tree, Tier A requires `merged`, and the normal sequence is push, end the thread, merge later — so at SessionEnd the branch is unmerged and the hook correctly declines. Measured on the development install: 101 worktrees with 48 merged and unreaped on 2026-09-09; a manual sweep took it to 55 and it was 157 by 2026-09-22.

**It delegates rather than deleting**, and that is load-bearing rather than tidy. `classifyWorktree` places its liveness gate above the merged/Tier-A check precisely because *"the moment a live session's PR merges, its clean tree first becomes Tier-A eligible — exactly when it must NOT be reaped."* A merge-triggered reaper is the caller that walks into that window, so it must go through the classifier, never around it.

It uses the same two flags as the scheduled sweep, so there is one switch to reason about: `DPF_WORKTREE_JANITOR_ENABLED` to run at all, `DPF_WORKTREE_JANITOR_AUTO_REAP` to remove rather than report. Both default off. A scan that cannot reach its subject logs UNHEALTHY and reports `ran: false` — never success.

## Related

- `scripts/worktree-janitor.mjs` — the janitor itself and its pruning rules
- `packages/dpf-skill-pack/skills/dpf-worktree-hygiene/SKILL.md` — dry-run
  default and the explicit-go rule for live reaping
- `docs/architecture/branch-and-worktree-runbook.md`
