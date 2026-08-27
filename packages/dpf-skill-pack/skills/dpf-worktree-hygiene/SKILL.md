---
name: dpf-worktree-hygiene
description: "Use when DPF worktree or Build Studio sandbox disk is sprawling, when leftovers remain after merges, or when deciding on janitor/GC flags."

# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash(git worktree *) Bash(git branch *) Bash(git status *) Bash(node scripts/worktree-janitor*) Bash(node scripts/lib/junction-safe*) Bash(docker exec *) Bash(docker ps *)

# DPF coworker fields (Surface B — in-portal seed loader)
category: ops
assignTo: ["build-specialist", "platform-engineer", "ops-coordinator"]
capability: null
taskType: workflow
triggerPattern: "worktree (hygiene|sprawl|janitor|reap|prune|cleanup)|Tier-?A (reap|janitor)|sandbox (GC|leftover|\\.builds)|DPF_WORKTREE_JANITOR|DPF_SANDBOX_BUILD_GC|orphan worktree|disk reclaim.*worktree"
userInvocable: true
agentInvocable: true
allowedTools: ["Bash"]
composesFrom: ["dpf-worktree-per-session"]
contextRequirements: ["git root clone available; scripts/worktree-janitor.mjs present; operator go required for live --live reap"]
riskBand: high

# Kernel principle enforcement
enforces:
  - kernel/principles/worktree-selection-and-reaping
  - kernel/principles/destructive-actions-require-explicit-go
  - kernel/principles/worktree-per-session
  - kernel/principles/keep-root-clone-as-merge-worktree
---

# DPF Worktree & Sandbox Hygiene

Creates are covered by [`dpf-worktree-per-session`](../dpf-worktree-per-session/SKILL.md). This skill is the **reaping / disk-hygiene** half: what runs automatically, what the portal schedule does when flags are on, and what an agent may run **only with clear operator go**.

## Ownership model (do not invert)

| Path | Owner | Agent freestyle? |
|------|--------|------------------|
| **Primary reaper** — this session's worktree on **SessionEnd** when Tier-A (merged + clean). Never on `Stop`: that fires every turn, and a live tree becomes Tier-A the moment its own PR merges (BI-E5D810B8) | Client hooks (`worktree-session-hygiene.mjs`) | No — automatic when dpf-platform / global hooks are installed |
| **Fleet soak** — scheduled observe / optional Tier-A, sandbox leftover GC | Portal Inngest (`ops/worktree-janitor`, `ops/sandbox-build-gc`) + env flags | No — enable flags; do not hand-cron |
| **Workroom reaper** — transition dead workroom *records* (lease expired / build terminal / idle) `working`→`abandoned`; the DB half of hygiene (WS9) | Portal Inngest (`ops/taskrun-watchdog` tick) + `DPF_WORKCAPSULE_REAPER_*` flags | No — enable flags; observe via `list_work_capsules staleOnly=true` |
| **Exceptional reclaim** — live Tier-A bulk prune, force-delete locked dirs, kill locking shells | Operator + explicit "go" | Only after dry-run report + operator approval |

Primary design: multi-client governance parity (BI-42FA7DD8, BI-8BD61C30, BI-A4BEFE99). Spec/plan under `docs/superpowers/*2026-07-26-multi-client-governance-parity*`.

## Flags (install-local; not a PR)

| Flag | Default | Meaning |
|------|---------|---------|
| `DPF_WORKTREE_JANITOR_ENABLED` | off | When `1`, schedule **scans** (dry-run unless AUTO_REAP) |
| `DPF_WORKTREE_JANITOR_AUTO_REAP` | off | When `1` **and** ENABLED, live **Tier A only** |
| `DPF_SANDBOX_BUILD_GC_ENABLED` | off | When `1`, daily GC for terminal/orphan `.builds/*` |
| `DPF_SANDBOX_BUILD_GC_DELETE_BRANCHES` | off | When `1` **and** ENABLED, also age-delete `build/*` past grace |
| `DPF_WORKCAPSULE_REAPER_ENABLED` | off | When `1`, the taskrun-watchdog tick **scans** for dead Workrooms (observe-only unless AUTO_REAP) |
| `DPF_WORKCAPSULE_REAPER_AUTO_REAP` | off | When `1` **and** ENABLED, live-transition dead workrooms `working`→`abandoned` (reversible; DB-only) |

Wire via host `.env` and/or gitignored `docker-compose.override.yml` on the **portal** service, then recreate portal so `printenv` shows the flags. Do not set AUTO_REAP or BRANCH delete until observe-only soak looks clean.

## When to use

- Operator reports disk full, hundreds of worktrees, or leftover sandbox `build/*` branches.
- After a merge wave when many topic worktrees are still registered.
- Deciding whether to enable soak flags on a live install.
- Agent is tempted to `rm -rf` a worktree or `git worktree remove --force` by hand.

## When NOT to use

- Creating a new session worktree → `dpf-worktree-per-session`.
- Normal PR finish of **this** branch's worktree → session SessionEnd reaper or `dpf-finishing-a-development-branch`.
- Portal self-upgrade / version skew → self-upgrade path, not janitor.

## Steps

### A. Observe (always safe)

From the **root clone** (merge worktree):

```bash
# Host worktree classification (default dry-run)
node scripts/worktree-janitor.mjs --dry-run --json

# Sandbox leftovers
docker exec dpf-sandbox-1 sh -c 'ls /workspace/.builds 2>/dev/null; git -C /workspace branch --list "build/*"'
```

Report: counts of `PRUNE_TIER_A` / `KEEP` / `SKIP`, and whether sandbox has orphan dirs vs an **active** `build/FB-*` (do not delete review/in-progress builds).

### B. Fleet soak (prefer over agent loops)

1. Confirm flags on portal: `docker exec dpf-portal-1 printenv | grep -E 'WORKTREE_JANITOR|SANDBOX_BUILD_GC'`.
2. If soak is desired: set ENABLED flags only (no AUTO_REAP) via install config; recreate portal.
3. Periodic work is then **Inngest**, not the agent rereading this skill every hour.

### C. Live Tier-A host prune (destructive — needs explicit go)

Only after operator says **go** (or equivalent) on a dry-run report:

```bash
node scripts/worktree-janitor.mjs --live --tier-a-only --json
```

- Uses junction-safe remove under the hood.
- Never use bare `git worktree remove --force` on Windows (BI-F6AC1A56).
- Never target the root clone path.

### D. Unregistered leftovers and fake worktrees (exceptional)

A directory under the worktrees root that is **not** in `git worktree list` is not a worktree — it is a **fake worktree**, and it is actively dangerous:

- It has no `.git` file, so **every git command run inside it silently operates on the ROOT clone** — `git status`, `git commit`, and `git worktree list` all report the root clone's state.
- The path is gitignored, so any edit made there is **uncommittable**.

Detect before trusting a directory:

```bash
git worktree list | grep -F "<path>"        # absent, or marked "prunable"
test -e "<path>/.git" || echo "FAKE worktree"
```

`git worktree prune` removes only the **metadata** — it never deletes the directory, and it routinely surfaces *more* fake worktrees (their gitdir file points at a non-existent location). **Re-sweep the worktrees root after every prune**; one cleanup pass typically uncovers several more.

Before deleting a `.git`-less directory, prove it holds no unsaved work by diffing it against its branch with a throwaway index (read-only, touches nothing):

```bash
export GIT_INDEX_FILE=$(mktemp)
git --git-dir=<root>/.git --work-tree=<path> read-tree <branch>
git --git-dir=<root>/.git --work-tree=<path> diff --ignore-cr-at-eol --numstat
unset GIT_INDEX_FILE
```

Read the output correctly or you will scare yourself: the **first** status column is branch-vs-root-HEAD noise, not disk state — only the **second** column reflects the directory. On Windows the raw diff is dominated by CRLF churn, so `--ignore-cr-at-eol` is what separates real edits from line-ending noise. A file that differs but does **not exist on disk** is an absence, not lost work.

Then remove:

1. **Scan junction targets first — do not assume.** Junctions inside a worktree usually point *within that same worktree* (`apps/web/node_modules/@dpf/* → packages/*`), which is harmless. The root-clone-eating case is a junction whose target lies **outside** the tree. Read the targets, then unlink every reparse point with `cmd /c rmdir` before any recursive delete.
2. Identify lockers by **process cwd** (e.g. orphaned bash/powershell with cwd in the path) — do **not** kill unrelated Claude Desktop / codex host processes. Stop only those PIDs.
3. `rd /s /q` the tree. It will **fail on `node_modules` paths over `MAX_PATH` (260 chars)** — deep `expo` / `xcframework` prebuild trees are the usual culprit, and the failure looks like an unexplained partial delete. Purge with robocopy, which handles long paths natively, then remove the shell:

```bash
robocopy "$(mktemp -d)" "<path>" /MIR /NFL /NDL /NJH /NJS /R:1 /W:1
cmd /c rd /s /q "<path>"
```

4. An **empty husk that still refuses to unlink** (0 files, 0 dirs, `rd` exit 32) is inert — no files, no `.git`, no junctions, no metadata, so the trap is already defused. Retrying is futile; leave it for the next reboot rather than terminating another session's processes to reclaim an empty folder.
5. Require operator go if the agent cannot prove the process is abandoned session debris.

### E. Sandbox GC one-shot (destructive — needs go)

Prefer flag-enabled scheduled GC. Manual one-shot only with go:

- Remove **orphan** `.builds/FB-*` (no FeatureBuild row) or **terminal** phases.
- Keep currently checked-out / non-terminal (`review`, `building`, …) branches.
- `git worktree prune` inside sandbox if a dir was deleted out from under git.

### F. Stale Workroom records (the DB half of the sprawl — WS9 / BI-CBAAEA94)

Disk hygiene reaps *worktrees and sandboxes*; this reaps the **Workroom row** — the coordination record that shows on the Work Control board and in `list_work_capsules`. They drift apart: a Build Studio workroom is born at the daily 14:00 governed-backlog tee-up and, if its build stalls, is never written again, so `updatedAt` freezes at `...T14:00:00` while `status` still says `working`. Dozens of dead workrooms then **read as active**, jam the Build Studio WIP cap, and become the mechanism by which work is silently duplicated.

**`updatedAt` is not liveness.** True liveness (`apps/web/lib/work-capsules/liveness.ts`) is derived from signals that only advance with real work: an open PR, a lease-backed executor's `leaseExpiresAt` (external Claude/Codex/Grok), the linked build's phase + activity (a null-lease BS workroom's only real signal), and `lastSyncedAt`. The board, `list_work_capsules` (see its `livenessSummary` and `staleOnly=true`), and the reaper all share that one classifier.

- **Observe (always safe):** `list_work_capsules staleOnly=true` — the reap-candidate set, each with a `liveness` verdict and the `trueLivenessAt` that proves it. No writes.
- **Governed reaper** (`apps/web/lib/work-capsules/work-capsule-reaper.ts`) runs on the taskrun-watchdog tick: observe-only when `DPF_WORKCAPSULE_REAPER_ENABLED=1`, live only with `DPF_WORKCAPSULE_REAPER_AUTO_REAP=1`. It transitions dead workrooms `working`→`abandoned`.
- **DB-only, so junction-safe:** the reaper never touches the filesystem. Reaping the workroom record does **not** delete the worktree — that stays for `worktree-janitor` / section C after its own explicit go. Abandon is reversible: re-promote the backlog item or re-adopt the branch.
- A terminal build now abandons its attached workroom in the same watchdog tick (no zombie `working` workroom left behind).

## Per-worktree caches and links that make a fresh worktree look broken

A new worktree does not inherit the root clone's tool caches or generated artifacts. Each of these presents as a hang or a scary failure and is really just an unseeded worktree.

**gitleaks re-downloads per worktree.** The pre-commit scan caches under the *worktree's* git dir, not the root clone's. A cancelled download leaves a half-written zip that makes the next commit appear to hang. Seed it from the root clone:

```bash
V=<version>; T="$(git rev-parse --git-path dpf-tools/gitleaks/$V)"
mkdir -p "$T" && cp "<root-clone>/.git/dpf-tools/gitleaks/$V/gitleaks.exe" "$T/"
```

**`packages/db` tests need the generated Prisma client.** Junction it rather than regenerating per worktree — on Windows the link name must be *relative* (an absolute target path errors with "Parameter format not correct"):

```bash
cd packages/db && MSYS_NO_PATHCONV=1 cmd /c "mklink /J generated <root-clone>\packages\db\generated"
```

Remove that junction with `cmd /c rmdir generated` — **never `rm -rf`**, which follows the link and eats the target's contents.

**The junction then trips the pre-commit Prisma staleness guard**, which compares mtimes (`schema.prisma` newer than `generated/client/client.ts`) and tries to regenerate. In a fresh worktree the schema is simply newer than the borrowed artifact. Confirm the schemas are identical (`md5sum` both), then remove the junction, commit, and recreate it — do **not** regenerate through the junction, which writes into the root clone.

**A stale `index.lock` after a killed commit.** Check the holder before removing anything: `wmic process where processid=<pid> get commandline`. With many concurrent sessions, a live `git.exe` usually belongs to **another** worktree and does not hold your lock. Only then remove `.git/worktrees/<name>/index.lock`.

**Commit messages: use `git commit -F <file>`.** PowerShell here-strings (`@'…'@`) are not parsed by the Bash tool and leak a literal `@` into the subject line. Verify with `git log -1 --format=%s`.

## Guardrails

- **Dry-run default.** Live reap is never the default agent action.
- **No freestyle `rm -rf` / mass process kill** as hygiene.
- **Junction-safe only** for worktree directory removal on Windows.
- **Hide complexity from lay users** — report outcomes (how many reaped, flags on/off), not raw flag names unless the operator is in ops mode.
- **Primary reaper remains session hooks** — this skill does not replace SessionEnd hygiene.

## Output template

```
**Worktree/sandbox hygiene**

- Dry-run: Tier-A=N, keep=N, skip=N
- Sandbox: .builds=N, build/*=N (active kept: …)
- Flags: JANITOR_ENABLED=… AUTO_REAP=… SANDBOX_GC=… BRANCH_DELETE=…
- Live actions taken: none | Tier-A live prune | sandbox one-shot (operator go: yes)
- Next: enable observe-only soak | wait soak | stop
```

## See also

- [`dpf-worktree-per-session`](../dpf-worktree-per-session/SKILL.md) — create path
- [`scripts/worktree-janitor.mjs`](../../../../scripts/worktree-janitor.mjs)
- [`scripts/lib/junction-safe-worktree-remove.mjs`](../../../../scripts/lib/junction-safe-worktree-remove.mjs)
- AGENTS.md §4 / §17 worktree bullets — doctrine pointers
- Catalog: `apps/web/lib/operate/scheduled-jobs/catalog.ts` (`worktree-janitor`, `sandbox-build-gc`)
