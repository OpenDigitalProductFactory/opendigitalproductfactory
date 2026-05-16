# DPF Worktree Hygiene — Janitor Design

> Status: **DRAFT** — proposed 2026-05-16. Per AGENTS.md §10, the
> Research & Benchmarking section below must remain populated before
> this spec is finalized. Implementation waits on operator approval;
> no behavior changes until the matching plan is approved.
>
> Owner: platform / dev-experience.
> Related: AGENTS.md §4 (branching + worktrees), `feedback_worktree_per_session.md`,
> `feedback_worktree_base_origin_main.md`, `feedback_no_approval_for_local_cleanup.md`,
> `docs/superpowers/plans/2026-05-09-macos-linux-native-support.md` (cross-platform parity).
>
> **One-time cleanup of currently-accumulated orphans is gated on this
> spec's approval.** The first sweep ships in dry-run mode so the
> operator can review the kill list before any deletion happens.

## 1. Problem statement

Every concurrent Claude Code session in DPF runs in its own git
worktree (AGENTS.md §4: "one thread = one branch + one git
worktree"). The Claude Code harness creates these under
`<repo>/.claude/worktrees/<random-name>` automatically and **never
removes them**. Across other agentic clients (Codex CLI, future IDE
agents) the same pattern repeats with each client's own naming
convention and location.

The accumulated effect, observed 2026-05-16:

- **33 registered worktrees** across `D:\DPF\.claude\worktrees\`,
  `D:\DPF\.worktrees\`, `D:\DPF-<topic>`, and the Codex tree.
- **4 orphan filesystem directories** in `.claude/worktrees/` that
  git has lost track of entirely — `git worktree prune` cannot help
  these because prune handles the inverse case (registrations whose
  directory vanished).
- **~88 local branches**, only ~30 with worktrees — the rest are
  zombie branches from previously-removed worktrees, including
  branches whose upstream is already `[gone]`.
- **~9.8 GB of disk** burned by `node_modules` copies inside
  abandoned `.claude/worktrees/`.
- **Local `main` is `[ahead 1, behind 154]`** — the existing rule to
  base new worktrees on `origin/main` (memory:
  `feedback_worktree_base_origin_main.md`) only holds if it is
  consistently applied; the janitor must enforce the same baseline
  when deciding which branches are merged.

The root cause is structural, not behavioral: on Windows the active
shell holds the directory lock, so a session cannot
`git worktree remove` its own CWD. Self-cleanup is physically
impossible; cleanup must happen in a *different* process after the
session releases the lock. There is no current owner for that.

This spec defines an automated, client-neutral janitor that owns the
"after the session releases the lock" job.

## 2. Goals and non-goals

**Goals.**

1. Worktrees auto-created by agentic clients in this repo are
   removed without human action once they are safe to remove.
2. Cleanup is durable across crashes, BSODs, long idle stretches
   (Mark travels and rate-limit weekly resets can pause work for
   days), and concurrent sessions.
3. Cleanup is safe by default: no uncommitted work is ever lost; no
   unmerged branch is dropped without explicit operator
   confirmation.
4. The janitor is one canonical script, not a constellation of
   per-client shell snippets; new clients are added by registry
   entry, not new code paths.
5. The mechanism is rollback-able in a single revert and produces an
   auditable log of every action.

**Non-goals.**

1. Cleaning up Build Studio sandboxes. Build Studio is Docker-based
   (`apps/web/lib/integrate/sandbox/sandbox-source-strategy.ts`); it
   mounts source via `docker cp` and tears down containers on
   completion. No worktrees, no debt, out of scope.
2. Cleaning up DPF's in-platform sandbox runs. Same Docker-based
   architecture, same out-of-scope reasoning.
3. Owning the cleanup of any AI client's own state outside this
   repo (e.g. Codex's `~/.codex/worktrees/` from Mark's direct
   Codex usage). The janitor scopes strictly to roots inside or
   adjacent to this DPF clone.
4. Replacing the human-named `D:\DPF-<topic>` convention from
   AGENTS.md §4. Those are intentional and human-owned; the janitor
   never touches them automatically.
5. Cross-platform installer integration in this slice. The janitor
   is Windows-first (Mark's environment). The bash sibling is
   tracked as follow-up work tied to the macOS/Linux native plan.

## 3. Client surface and scope

The janitor's authority is defined by a small, explicit registry,
not by a wildcard sweep. Adding a new client = adding a row.

| Client | Worktree root | Scope | Rationale |
|---|---|---|---|
| Claude Code (sessions + subagent isolation) | `D:\DPF\.claude\worktrees\` | **In** | Auto-generated, no owner, accumulates. |
| Manual `git worktree add`, per AGENTS.md §4 | `D:\DPF-<topic>` | **Out** (read-only inventory) | Human-named, intentional; janitor surfaces stale ones in its log but never removes. |
| Legacy repo-internal manual worktrees | `D:\DPF\.worktrees\` | **Out** (flagged) | Non-standard per AGENTS.md §4; janitor flags for human triage rather than acting. |
| Codex CLI (direct user invocation) | `~/.codex/worktrees/` | **Out** | Not under DPF management; Codex owns its hygiene. The janitor's log lists count + size for visibility only. |
| Build Studio / in-platform sandbox | n/a — Docker | **Out** | No worktrees created. |
| VS Code / Cursor / Cline / Continue / Copilot | n/a — file-level only | **Out** for creation; **In** for safety predicate | These clients don't create worktrees, but a VS Code window can hold a directory open. The janitor's safety predicate must check for an open editor on the target before removal. |

The registry lives in code (`scripts/worktree-janitor-lib.psm1`) as
`$ManagedRoots` and `$InventoryOnlyRoots`. Any path outside both
lists is invisible to the janitor — opt-in by enumeration, never
implicit.

## 4. Design

### 4.1 Two-tier execution

The janitor has two entry points sharing a single body of logic:

**Tier 1 — Hot path (`SessionEnd` hook).** Fires when a Claude Code
session ends through the normal `SessionEnd` event (matchers
`clear`, `logout`, `prompt_input_exit`, `other`). The hook spawns
the janitor as a detached background process so it outlives the
session that triggered it; once the parent shell exits and releases
the directory lock, the detached janitor performs the removal.

Catches: ~95% of routine cases. The matched session's worktree is
removed within ~30 seconds of session exit.

Misses: hard crash (kill -9, BSOD, OS reboot, runaway process
killed by the harness), `SessionEnd` not firing for some matcher
reason, machine off when grace period elapses.

**Tier 2 — Scheduled sweep (Windows Scheduled Task, daily 03:00).**
A daily full pass over `D:\DPF\.claude\worktrees\` and the branch
registry. Catches everything Tier 1 missed plus orphan filesystem
directories git lost track of plus zombie branches.

The same script runs both modes (`-Mode exiting -ExitingPath <path>`
vs `-Mode sweep`); only the iteration source differs.

### 4.2 Components

1. **`scripts/worktree-janitor.ps1`** — entry point, mode dispatch,
   logging.
2. **`scripts/worktree-janitor-lib.psm1`** — safety predicates
   (`Test-WorktreeSafeToRemove`, `Test-BranchSafeToDelete`,
   `Test-EditorOpenAt`), client registry, action helpers.
3. **`scripts/install-worktree-janitor-task.ps1`** — one-time
   per-machine installer that registers the scheduled task under the
   current user (no admin elevation, no service install).
4. **`scripts/uninstall-worktree-janitor-task.ps1`** — clean
   removal of the scheduled task; pairs with §4.6 rollback.
5. **`.claude/settings.json`** — `SessionEnd` hook entry pointing at
   the janitor in `exiting` mode.
6. **`scripts/worktree-janitor.sh`** + **`install-worktree-janitor-task.sh`**
   — bash/launchd/systemd siblings (tracked as follow-up; see §10).
7. **`AGENTS.md` §4 addendum** — short paragraph describing the
   harness's `.claude/worktrees/` directory, the janitor's role, and
   that humans never need to clean it manually.

### 4.3 Safety invariants (hard contract)

A worktree under a managed root is removed if and only if **all** of
these hold. Any single failure aborts the removal and logs the
reason.

1. **Path is under a managed root.** Per §3 registry.
2. **Not the active main repo worktree** (`D:\DPF`).
3. **Not git-locked.** `git worktree list --porcelain` does not
   report `locked` for this path.
4. **No open editor.** `Test-EditorOpenAt` returns false. The check
   enumerates known editor process names (`Code.exe`,
   `Cursor.exe`, `windsurf.exe`, `idea64.exe`, `pwsh.exe`,
   `powershell.exe`, etc.) and their open handles via
   `Get-Process | ? Path -like '<worktree>\*'`; best-effort, but
   any positive hit aborts.
5. **Clean working tree.** `git -C <path> status --porcelain`
   returns empty. `node_modules` is gitignored so it does not count;
   any non-ignored untracked file or unstaged change keeps the
   worktree.
6. **Branch is safe.** The worktree's branch satisfies at least one:
   - merged into `origin/main` (after `git fetch origin main`), OR
   - upstream tracking is `[gone]` (remote branch deleted), OR
   - upstream is set and tip is `[behind N]`-only (not ahead).
   A branch that is **ahead of `origin/main` and not merged** is
   kept; that's unmerged work.
7. **Age threshold (sweep mode only).** Worktree directory mtime is
   at least **7 days old**. Tier 1 hot-path mode skips this check
   because the session has just ended; it instead waits 30 seconds
   for OS lock release before attempting removal.
8. **Removal command is `git worktree remove`, not `rm -rf`.** Git's
   own removal command refuses if the working tree is dirty,
   providing a second layer of defense even if predicate #5
   misjudges.

The **7-day** age threshold is sized to absorb operator absence:
travel, rate-limit-induced weekly resets, illness. Sessions left
open over a weekend or across a paused-for-quota stretch survive.

### 4.4 Branch cleanup (sweep mode only)

A local branch is deleted if and only if all of these hold:

1. No worktree references it (cross-checked against
   `git worktree list --porcelain`).
2. Name matches the harness-generated patterns —
   `claude/<adjective>-<noun>-<hex>` or `codex/<topic>` — or the
   upstream is `[gone]`. Branches matching `feat/`, `fix/`, `doc/`,
   `spec/`, `plan/`, `chore/` are **never** touched automatically;
   those are human-authored intent.
3. Merged into `origin/main` (after fetch), OR upstream `[gone]`.
4. Branch tip ≥ 1 day old (in case a branch was just created and
   the worktree hasn't been added yet).

Deletions use `git branch -d` (refuses on unmerged). The reflog
retains the tip for the default 90-day window for recovery.

### 4.5 Orphan filesystem-directory cleanup (sweep mode only)

A directory under `D:\DPF\.claude\worktrees\` that is not in
`git worktree list` is removed if and only if:

1. Empty, OR contains only the stale `.git` pointer file and no
   tracked source.
2. mtime ≥ 7 days.

Larger orphan directories (e.g., the 1166 MB `edge-test-fix` and
`fix-vitest-next-auth` found 2026-05-16) are **flagged in the log
but not deleted** — those represent a `.git` file unlinked but
source content still present, which is unusual enough to warrant
human inspection.

### 4.6 Companion cleanup

When a worktree is removed, two adjacent cleanups happen
opportunistically (failures are logged, not fatal):

1. **MCP config.** `.mcp.json` and `.vscode/mcp.json` inside the
   worktree go away with the directory; nothing extra needed.
2. **VS Code workspaceStorage.** VS Code stores per-workspace state
   under `%APPDATA%\Code\User\workspaceStorage\<hash>\` keyed by
   absolute path. When the workspace path vanishes, the storage
   entry becomes an orphan. The janitor scans workspaceStorage
   entries whose `workspace.json` references a now-deleted DPF
   worktree path and removes them. **Scope-limited to entries
   pointing inside `D:\DPF`** to avoid touching unrelated VS Code
   state.

### 4.7 Logging

Every janitor action writes one structured JSON line to
`D:\DPF\.claude\worktree-janitor.log`:

```json
{"ts":"2026-05-16T03:14:22Z","mode":"sweep","action":"remove",
 "path":"D:/DPF/.claude/worktrees/awesome-grothendieck-c82a7c",
 "branch":"claude/awesome-grothendieck-c82a7c","mergedInto":"origin/main",
 "ageDays":2,"editorOpen":false,"workingTreeDirty":false,"result":"ok"}
```

Skips also log, with a `reason` field. Log rotates at 5 MB, keeps
the last 30 days. The Tier 2 sweep emits a summary line at end of
run (`{"mode":"sweep","action":"summary","scanned":N,"removed":M,
"skipped":S,"flagged":F}`).

### 4.8 Concurrency

Multiple janitor invocations are serialized via a file lock at
`D:\DPF\.claude\worktree-janitor.lock`. If a Tier 1 hot-path
invocation finds the lock held (e.g., the daily sweep is mid-run),
it appends its `ExitingPath` to a pending queue file and exits; the
running sweep picks the queue up before finishing.

The branch-safety check always runs `git fetch origin main` first
(serialized through the same lock) so freshly-merged branches are
correctly classified.

## 5. Rollback

Every layer is removable in a single step:

- **Disable the hook.** Remove the `SessionEnd` entry from
  `.claude/settings.json` and commit; the project-level config
  takes effect on the next session.
- **Disable the scheduled task.** Run
  `scripts/uninstall-worktree-janitor-task.ps1`, which calls
  `Unregister-ScheduledTask -TaskName "DPF Worktree Janitor"`.
- **Recover a branch.** `git reflog` retains the tip for 90 days;
  `git branch <name> <reflog-sha>` restores it.
- **Recover a removed worktree.** `git worktree add <path> <branch>`
  re-creates the checkout from the still-intact `.git/objects`
  database.
- **Recover untracked work.** Invariant #5 prevents the situation;
  if a bug breaches it the action lands in the log, the worktree
  contents are gone, and only gitignored / untracked files cannot
  be recovered. Mitigation: ship with a 24-hour dry-run period
  after first install so the operator sees the action list before
  any deletion.

## 6. Integration with existing rules and memory

| Rule | Integration |
|---|---|
| AGENTS.md §4 (worktree convention) | Addendum paragraph documents the harness `.claude/worktrees/` root and the janitor; the human-named `D:\DPF-<topic>` convention is unchanged. |
| `feedback_worktree_per_session.md` | Unchanged. Janitor acts only post-session. |
| `feedback_worktree_base_origin_main.md` | Branch-safety predicate compares to `origin/main`, never local `main`; sweep fetches first. |
| `feedback_no_approval_for_local_cleanup.md` | Janitor *is* automated local cleanup; no prompts. |
| `feedback_sweep_main_before_trusting_worktree_specs.md` | Mandatory `git fetch origin main` at every sweep enforces freshness. |
| `feedback_architecture_over_shortcuts.md` | Single script + registry + scheduled task is durable structure, not a one-off. |
| `feedback_zero_technical_debt.md` | Closes a long-running accumulation source. |
| `feedback_spec_commit_plan_process.md` | This spec → review → commit → plan → execute. |

## 7. Operational thresholds

| Knob | Default | Rationale |
|---|---|---|
| Sweep age threshold | **7 days** | Absorbs travel, rate-limit weekly resets, illness — a session paused for these reasons survives a full week. |
| Hot-path grace | 30 s | Long enough for OS lock release after shell exit; short enough to feel snappy. |
| Sweep frequency | daily 03:00 | Off-peak; once-daily matches the age threshold's resolution. |
| Log retention | 30 days | Enough to audit the previous month; bounded disk. |
| Lock file | `D:\DPF\.claude\worktree-janitor.lock` | Single-host serialization. |
| Dry-run period | first 24 hours after install | Operator review before first real deletion. |

All knobs are top-of-file constants in
`scripts/worktree-janitor-lib.psm1` — no env-var pollution, no
runtime flags beyond `-Mode`.

## 8. Research and benchmarking

Per AGENTS.md §10, every spec compares 2–3 open-source leaders and
2–3 commercial products for the problem class. The problem class
here is "ephemeral workspace lifecycle for an agentic developer
environment."

**Open-source comparators.**

- **devcontainers / Docker dev-containers.** Each session is a
  named container, lifecycle managed by `devcontainer up` / `down`;
  cleanup is operator-initiated. *Pattern adopted:* explicit
  named-resource model (the janitor's registry serves the same
  purpose). *Anti-pattern:* manual-only cleanup leaves orphans —
  this spec adds the missing scheduler.
- **GitHub Codespaces.** 30-day auto-delete for inactive
  codespaces, 7-day stop for inactive running ones; both settings
  user-configurable. *Pattern adopted:* the 7-day default,
  age-based eligibility, time-window-not-immediate sweep.
  *Anti-pattern:* Codespaces does not check for unpushed work; it
  warns instead. This spec hard-refuses on unmerged branches —
  Codespaces can rely on a backing remote, we cannot trust local
  state alone.
- **`git-worktree` core itself.** Provides `prune` only for the
  inverse case (registration without directory). *Gap filled:*
  no upstream tooling cleans directories whose registration is
  intact and branch is merged. This spec is what that script would
  look like.

**Commercial comparators.**

- **GitPod.** Workspace timeouts at 30 minutes idle, 14 days
  inactive. *Pattern rejected:* hard idle-timeout while a session
  is open. Mark's workflow includes long pauses; idle timeout
  would kill in-progress thought.
- **Coder.** Per-workspace TTL with extend-on-activity. *Pattern
  partially adopted:* the 7-day window with mtime-based bumping is
  similar to Coder's TTL-with-touch model.
- **JetBrains Space.** Per-branch dev environment with merge-
  trigger cleanup. *Pattern adopted:* using merge-into-main as a
  safe-to-delete signal.

**Patterns adopted:** registry-driven scope; age-based eligibility
with operator-tunable threshold; merge-state as primary safety
signal; companion editor-state cleanup.

**Patterns rejected:** idle timeouts on open sessions; cleanup
based purely on time without verifying branch state; cleanup
managed inside the session that owns the worktree.

**Anti-patterns identified:** silent removal without logging
(found in some CI cleanup scripts) — addressed by §4.7; sweeping
based on "looks like a Claude worktree" pattern matching without
explicit registry — addressed by §3.

**Gap this design fills:** none of the comparators handle the
specific case of a multi-client agentic environment where multiple
heterogeneous tools create worktrees in a shared repo and the host
OS prevents self-cleanup. The registry-driven, two-tier janitor is
the synthesis.

## 9. Open questions

1. **Repo-internal `D:\DPF\.worktrees\`** (5 entries today) — leave
   alone (current proposal), fold into janitor scope, or migrate
   contents to the `D:\DPF-<topic>` convention and remove the
   directory? Triage decision belongs to the operator.
2. **`claude/*` zombie branches without worktrees** (~50+ today) —
   the spec authorizes auto-deletion when merged into
   `origin/main`. Acceptable as default, or require explicit
   operator opt-in?
3. **Cross-platform parity timing** — is the bash sibling a
   follow-up issue (current proposal), or a Phase 1 deliverable
   alongside the Windows implementation?

## 10. Future work

- **Bash sibling.** `scripts/worktree-janitor.sh` +
  launchd plist (macOS) + systemd timer (Linux) installer. Same
  registry, same safety predicates, ported semantics. Tracked as
  follow-up backlog item once the macOS/Linux native plan
  (`docs/superpowers/plans/2026-05-09-macos-linux-native-support.md`)
  picks up implementation work.
- **Codex CLI hygiene.** If `~/.codex/worktrees/` accumulation
  becomes a pain point, raise upstream as a Codex bug; the
  janitor's inventory-only mode already surfaces the count and
  size for visibility.
- **Installer integration.** Once `installer/` exists (currently
  not present in repo), the installer registers the scheduled
  task as part of platform setup so new operators get hygiene by
  default. Uninstaller reverses it.
- **Janitor telemetry.** Daily summary (worktrees pruned, branches
  deleted, disk freed, errors) surfaced in the platform's existing
  observability layer rather than a flat log file.
- **Extended client registry.** When new agentic IDE clients land
  (e.g., a future Cursor agent mode that creates its own
  worktrees), add a row to `$ManagedRoots` — no other code change
  required.

## 11. Acceptance criteria

This spec is implementation-ready when:

- All open questions in §9 have operator decisions captured.
- The matching plan at
  `docs/superpowers/plans/2026-05-16-worktree-hygiene-plan.md`
  exists and decomposes the work into reviewable slices.
- Section §3 registry covers every client the operator currently
  uses (Claude Code confirmed; Codex confirmed as out-of-scope;
  others to be confirmed during plan review).
- A dry-run pass over the current 33-worktree inventory produces
  an action list the operator approves before any code merges.
