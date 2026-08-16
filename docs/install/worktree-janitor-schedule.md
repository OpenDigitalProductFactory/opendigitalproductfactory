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

## Related

- `scripts/worktree-janitor.mjs` — the janitor itself and its pruning rules
- `packages/dpf-skill-pack/skills/dpf-worktree-hygiene/SKILL.md` — dry-run
  default and the explicit-go rule for live reaping
- `docs/architecture/branch-and-worktree-runbook.md`
