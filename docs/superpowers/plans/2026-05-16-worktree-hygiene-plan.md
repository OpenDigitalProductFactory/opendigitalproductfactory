# DPF Worktree Hygiene — Implementation Plan

> **Status: DRAFT — proposed 2026-05-16.** Implements
> [`docs/superpowers/specs/2026-05-16-worktree-hygiene-design.md`](../specs/2026-05-16-worktree-hygiene-design.md)
> (PR #653, merged; operator decisions resolved in spec §9).
>
> Branch: `doc/worktree-hygiene` (this plan only). Each phase below
> lands as a separate PR per AGENTS.md §4 ("one concern per branch,
> one concern per PR"). PR titles in this plan are recommendations,
> not contracts.
>
> Cross-platform scope: **Windows-first** (spec §9.3). The bash /
> launchd / systemd sibling is tracked as follow-up under §10 of
> the spec, not as a phase here.

## Context

The spec landed on `main` via PR #653 with operator decisions in §9
captured 2026-05-16. The janitor is built around three contracts
that must not be collapsed into one script:

1. **Decision (the library).** Safety predicates and registry —
   pure functions of git state, filesystem state, and editor state.
   No removals, no side effects. Testable in isolation.
2. **Action (the dispatcher).** Drives the library's verdicts into
   `git worktree remove`, `git branch -d`, and filesystem cleanup
   under a single PowerShell entry point with mode flags.
3. **Trigger (the wiring).** Two trigger surfaces — the
   `SessionEnd` Claude Code hook (hot path) and a Windows Scheduled
   Task (daily sweep) — both call the dispatcher with different
   modes.

Each phase below maps to exactly one of these contracts plus its
own narrow scope. The first three phases ship the safety net
without any deletion behavior; deletions begin only at Phase 5,
gated by an operator-approved dry-run.

The whole stack is rollback-able to zero in a single revert per
phase plus the uninstaller script from Phase 4.

## Already done (do not redo)

- Spec at
  `docs/superpowers/specs/2026-05-16-worktree-hygiene-design.md`
  (merged via PR #653; §9 decisions captured this branch).
- Inventory of `D:\DPF\.worktrees\` (14 entries, 1 abandoned,
  classified in spec §9.1) — informs the Phase 5 dry-run kill list.
- Memory entry
  `feedback_idle_is_not_abandoned.md` documents the 7-day
  threshold rationale; do not re-litigate.

## Phase 1 — Janitor library + unit tests (no behavior change)

**Goal.** Ship the predicates and registry as a standalone
PowerShell module that any caller can ask "would you remove this?"
without ever removing anything.

**Files.**

- `scripts/worktree-janitor-lib.psm1` — exports:
  - `$ManagedRoots = @('D:\DPF\.claude\worktrees', 'D:\DPF\.worktrees')`
    (per spec §3 and §9.1).
  - `$InventoryOnlyRoots = @('D:\DPF-*', "$env:USERPROFILE\.codex\worktrees")`
    (per spec §3).
  - `$EditorProcessNames = @('Code','Cursor','windsurf','idea64','pwsh','powershell','rider64','goland64','pycharm64','clion64','webstorm64','phpstorm64','rubymine64','datagrip64')`
    (per spec §4.3 invariant 4).
  - `Test-PathUnderManagedRoot -Path <string> : bool`
  - `Test-WorktreeSafeToRemove -Path <string> -Mode <'exiting'|'sweep'> : { Safe: bool; Reason: string }`
    — implements spec §4.3 invariants 1–7 (age check skipped in
    `exiting` mode per §4.1).
  - `Test-BranchSafeToDelete -Branch <string> -Mode <'sweep'> : { Safe: bool; Reason: string }`
    — implements spec §4.4 predicates 1–4; refuses on
    `feat/|fix/|doc/|spec/|plan/|chore/` prefixes.
  - `Test-EditorOpenAt -Path <string> : bool` — best-effort scan
    via `Get-Process | ?{ $_.Path -like "$Path\*" }`; positive hit
    aborts. (Per spec §4.3.4; behavior matches the editor
    constraint in CLAUDE Code's frontmost-app check.)
  - `Get-OrphanDirectoryAction -Path <string> : { Action: 'remove'|'flag'|'skip'; Reason: string }`
    — implements spec §4.5.
  - `Write-JanitorLog -Action <hashtable> -LogPath <string>` —
    JSON-line writer per spec §4.7, including the rotation rule
    (5 MB cap, 30-day retention).

- `scripts/worktree-janitor-lib.Tests.ps1` — Pester unit tests.
  Each predicate exercised against a fixture tree built by the
  test (`git init` in `TestDrive:\`, simulate dirty/clean/merged
  states, branch-ahead/behind, upstream-gone, etc.). Uses
  `New-TemporaryFile` and `git -C` consistently; no network and
  no touching of the host's real worktrees. Coverage target:
  every branch in every predicate hit at least once.

**No call sites added.** Nothing executes the library yet.

**Acceptance.**

- `pwsh -NoProfile -Command "Invoke-Pester -Path scripts/worktree-janitor-lib.Tests.ps1 -Output Detailed"`
  green on Mark's box.
- Static check: `Get-Module -Name worktree-janitor-lib -ListAvailable | Test-ModuleManifest` clean.
- No file outside `scripts/` modified.
- DCO sign-off on the commit.

**Reviewable PR:** `feat(scripts): worktree janitor library + predicates (no behavior change)`

---

## Phase 2 — Dispatcher in dry-run-only mode

**Goal.** Ship the entry point that classifies the current
inventory and *would* take action, without taking any action. The
log file fills with planned actions for operator inspection.

**Files.**

- `scripts/worktree-janitor.ps1`:
  - Params: `[-Mode <'sweep'|'exiting'>] [-ExitingPath <string>] [-DryRun:$true]`.
  - `-DryRun` defaults to `$true` for the entire phase — any
    attempt to flip it false in this PR is a code review block.
  - `Mode 'sweep'`: iterate every `$ManagedRoots\*` directory; for
    each, call `Test-WorktreeSafeToRemove -Mode sweep`; log the
    verdict. Then iterate `git branch --format='%(refname:short)'`
    and call `Test-BranchSafeToDelete -Mode sweep`; log. Then
    iterate orphan filesystem directories under managed roots
    (those not in `git worktree list`) and call
    `Get-OrphanDirectoryAction`; log. Summary line at end per
    spec §4.7.
  - `Mode 'exiting'`: scope to the single `-ExitingPath`; call
    `Test-WorktreeSafeToRemove -Mode exiting`; log; exit.
  - File lock at `D:\DPF\.claude\worktree-janitor.lock` per spec §4.8.
  - Pre-sweep `git fetch origin main` (serialized through the
    same lock) per spec §4.8.

- `scripts/worktree-janitor.ps1.Tests.ps1` — integration tests
  driving the dispatcher against a temp fixture repo + worktrees.
  Asserts log lines match the expected JSON schema; asserts no
  `git worktree remove` or `git branch -d` calls executed (mock
  these and verify call count = 0). Asserts lock acquired and
  released. Asserts summary line written.

**No call sites added.** Nothing triggers the dispatcher yet.
Operator runs it manually for review:
`pwsh ./scripts/worktree-janitor.ps1 -Mode sweep`.

**Acceptance.**

- Pester green.
- Manual run on Mark's box produces a sane log file at
  `D:\DPF\.claude\worktree-janitor.log` listing the current
  accumulated inventory with verdicts.
- Zero state mutations (verified by `git status` and
  `git worktree list` snapshots before/after).
- DCO sign-off on the commit.

**Reviewable PR:** `feat(scripts): worktree janitor dispatcher (dry-run only)`

---

## Phase 3 — SessionEnd hook wiring (still dry-run)

**Goal.** Connect the Claude Code `SessionEnd` event to the
dispatcher in `exiting` mode, but keep dry-run on. Each session
exit produces a log line for review; no removals yet.

**Files.**

- `.claude/settings.json` — add to `hooks.SessionEnd`:
  ```json
  {
    "matcher": "clear|logout|prompt_input_exit|other",
    "hooks": [
      { "type": "command",
        "command": "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"D:\\DPF\\scripts\\worktree-janitor.ps1\" -Mode exiting -ExitingPath \"$CLAUDE_PROJECT_DIR\" -DryRun" }
    ]
  }
  ```
  (Exact env-var name confirmed against Claude Code hook docs at
  the implementation step; per CLAUDE.md, this is the harness's
  documented surface.)

- The command is launched detached (`Start-Process` inside the
  script if needed) so the parent shell can exit and release the
  directory lock before the janitor inspects it — per spec §4.1
  hot-path grace window of ~30s.

- `docs/install/hook-reference.md` (or wherever hook docs live —
  if absent, add a short paragraph to `AGENTS.md` §4) — one
  paragraph documenting the hook, its dry-run state, and the
  command to disable it (delete the entry, restart Claude Code).

**Acceptance.**

- Closing a Claude Code session (any matcher) produces one
  janitor log line within ~60s for the exited session's worktree.
- Zero worktrees removed across at least 3 test session exits
  (assert by `git worktree list` snapshot).
- Other sessions running concurrently are not disrupted (assert
  via file lock contention — second session-exit hook queues per
  spec §4.8 rather than crashing).
- DCO sign-off on the commit.

**Reviewable PR:** `feat(hooks): wire SessionEnd to worktree janitor (dry-run)`

---

## Phase 4 — Scheduled task installer (still dry-run)

**Goal.** Ship the per-machine installer that registers the daily
03:00 sweep as a Windows Scheduled Task running under the current
user — no admin elevation, no service install.

**Files.**

- `scripts/install-worktree-janitor-task.ps1`:
  - `Register-ScheduledTask` for `"DPF Worktree Janitor"`:
    daily 03:00, run as current user, command =
    `pwsh -NoProfile -ExecutionPolicy Bypass -File "D:\DPF\scripts\worktree-janitor.ps1" -Mode sweep -DryRun`
    (dry-run stays on for this phase).
  - Idempotent: detect existing registration and update in place
    rather than failing.
  - Refuses to register if run from a non-admin shell on a path
    Mark wouldn't expect (sanity check the working directory is a
    DPF clone).

- `scripts/uninstall-worktree-janitor-task.ps1`:
  - `Unregister-ScheduledTask -TaskName "DPF Worktree Janitor" -Confirm:$false`.
  - Idempotent (no-op if absent).

- `docs/install/worktree-janitor.md` — one page covering:
  - What the janitor does in two sentences.
  - How to install (`pwsh scripts/install-worktree-janitor-task.ps1`).
  - How to inspect (`Get-Content D:\DPF\.claude\worktree-janitor.log -Tail 50`).
  - How to uninstall.
  - How to read a log line.

**Acceptance.**

- Installer registers the task and a manual
  `Start-ScheduledTask -TaskName "DPF Worktree Janitor"` produces
  the same log output as a manual Phase 2 run.
- Uninstaller removes it cleanly; rerunning is a no-op.
- Idempotent installer reruns leave a single scheduled task entry.
- DCO sign-off on the commit.

**Reviewable PR:** `feat(scripts): scheduled task installer for worktree janitor (dry-run)`

---

## Phase 5 — First real sweep (operator-gated)

**Goal.** After Phases 1–4 have accumulated at least one week of
dry-run log data covering the SessionEnd hot path and the daily
sweep, flip the dispatcher's `-DryRun` default to `$false` and
take the first real action pass over the current accumulation.

**Pre-conditions (operator review gate).** Mark inspects the
accumulated dry-run log and either approves the kill list as-is or
flags specific entries to spare. This is the
spec §11 acceptance criterion 4 ("a dry-run pass over the current
accumulated inventory produces an action list the operator
approves before any code merges"). If the operator says no, this
PR doesn't merge.

**Files.**

- `scripts/worktree-janitor.ps1` — change `-DryRun` default to
  `$false`; add `-DryRun:$true` explicitly to the dry-run paths
  where it's still needed (e.g., a `--preview` mode for ad-hoc
  operator checks).
- `scripts/install-worktree-janitor-task.ps1` — drop `-DryRun`
  from the scheduled task command line (re-register on install).
- `.claude/settings.json` — drop `-DryRun` from the SessionEnd
  hook command line.
- `docs/install/worktree-janitor.md` — update the "what it does"
  paragraph to clarify it now removes, not just logs.

**No new tests in this PR.** The behavior change is purely the
default flag flip; the Phase 1 + 2 tests already cover both
modes (dry-run and live) via explicit param values.

**Acceptance.**

- Dry-run log diff from before/after PR merge shows zero
  unexpected predicate verdicts (i.e., the live run does what the
  prior dry-run advertised).
- A single sweep removes the abandoned entries identified in the
  dry-run period (notably the
  `D:\DPF\.worktrees\reference-data-progressive-admin` zombie
  flagged in spec §9.1).
- No working tree dirty + no editor open ⇒ no removal regrets in
  the log.
- DCO sign-off on the commit.

**Reviewable PR:** `feat(scripts): enable worktree janitor live removals (post-dry-run gate)`

---

## Phase 6 — Companion VS Code workspaceStorage cleanup

**Goal.** When a worktree is removed, opportunistically prune the
matching VS Code `workspaceStorage` entry so the IDE side doesn't
accumulate orphan state.

**Files.**

- `scripts/worktree-janitor-lib.psm1` — add:
  - `Get-OrphanWorkspaceStorageEntries -RemovedPath <string> : array`
    — enumerates `%APPDATA%\Code\User\workspaceStorage\<hash>\`
    entries whose `workspace.json` `folder` field references a now-
    deleted DPF path. **Scope-limited** to entries pointing inside
    `D:\DPF` (per spec §4.6) — never touches unrelated VS Code state.
  - `Remove-OrphanWorkspaceStorageEntry -Path <string>` —
    `Remove-Item -Recurse -Force` with the same path-scope guard.
- `scripts/worktree-janitor.ps1` — after a successful
  `git worktree remove`, call the two helpers above and log the
  result. Failures are logged, not fatal (per spec §4.6).
- `scripts/worktree-janitor-lib.Tests.ps1` — add cases for:
  - workspaceStorage entry pointing inside `D:\DPF` → removed.
  - workspaceStorage entry pointing outside `D:\DPF` → skipped.
  - workspaceStorage entry pointing at a still-live worktree →
    skipped.
  - Missing `workspace.json` → skipped, not crash.

**Acceptance.**

- Pester green for the new cases.
- Manual: open a test worktree in VS Code, close VS Code, exit the
  Claude session, wait for the janitor → both the worktree and the
  workspaceStorage entry are gone, and a VS Code orphan-scan
  confirms no DPF-rooted entries remain for the deleted worktree.
- A workspaceStorage entry pointing at a non-DPF path is never
  touched (verified by snapshot of unrelated entries before/after).
- DCO sign-off on the commit.

**Reviewable PR:** `feat(scripts): janitor companion cleanup for VS Code workspaceStorage`

---

## Follow-up backlog (not part of this plan)

These are scoped out of the current implementation and tracked as
separate backlog items per the spec §9.3 and §10 decisions.

1. **Bash / macOS / Linux sibling.** Port the registry and
   predicates to `scripts/worktree-janitor.sh`, plus
   `install-worktree-janitor.sh` (launchd plist on macOS, systemd
   user timer on Linux). Single backlog item, tied to
   `docs/superpowers/plans/2026-05-09-macos-linux-native-support.md`.
   Estimated effort: medium (the editor-handle check needs a
   POSIX equivalent of the PowerShell `Get-Process` scan).
2. **`D:\DPF\.worktrees\` → `D:\DPF-<topic>` consolidation.**
   Migrate any live entries from the parallel root to the
   AGENTS.md §4 canonical sibling-of-repo location, then retire
   the path. Defer until the janitor has run cleanly for a
   quarter; the urgency is structural, not operational.
3. **Janitor telemetry surface.** Daily summary (worktrees
   pruned, branches deleted, disk freed, errors) surfaced in the
   platform's observability layer rather than a flat log file.
   Useful once the platform has a place to render it.

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Dry-run period reveals a predicate bug (false-positive removal verdict) | Medium | High (would delete real work if flipped to live) | Phases 2–4 stay in dry-run for ≥7 days before Phase 5; operator reviews log. |
| `Test-EditorOpenAt` misses an editor on a non-Windows-standard install path | Medium | Medium (worktree removed while editor still has it open) | Invariant 5 (clean working tree) + git's own refuse-on-dirty in `git worktree remove` provide defense in depth; operator can extend `$EditorProcessNames` registry. |
| Concurrent SessionEnd hook + scheduled sweep collide on the same worktree | High (multi-session days) | Low (queueing handles it) | File lock per spec §4.8; Pester test in Phase 2 covers lock contention. |
| `git fetch origin main` rate-limits the GitHub API on a noisy day | Low | Low (sweep skips, retries tomorrow) | Sweep tolerates fetch failure (logs + skips branch-safety classification for that run). |
| Operator forgets the janitor exists and is surprised when something disappears | Low | Low (recovery is `git worktree add` + reflog) | Logging per spec §4.7; daily summary line; documented at `docs/install/worktree-janitor.md`. |
| `feat/`/`doc/`/`plan/` etc. prefix filter is bypassed by a typo (e.g. `feat-foo` instead of `feat/foo`) | Low | Medium (a human branch gets deleted) | The `Test-BranchSafeToDelete` predicate's name check uses the `/` separator explicitly; Pester test covers the negative case. |

## Rollback

Each phase is removable in a single revert:

- **Phase 1.** Revert the PR; no consumer exists yet.
- **Phase 2.** Revert the PR; dispatcher is gone, log file
  remains (delete manually).
- **Phase 3.** Revert the PR or remove the `SessionEnd` entry
  from `.claude/settings.json` and commit.
- **Phase 4.** Run `pwsh scripts/uninstall-worktree-janitor-task.ps1`.
- **Phase 5.** Revert the PR to restore dry-run defaults; no data
  loss because Phases 1–4 are still in place.
- **Phase 6.** Revert the PR; companion cleanup stops; existing
  workspaceStorage entries are untouched.

The full stack rolls back to zero with the four reverts plus the
uninstaller run.

## Acceptance criteria (overall)

- All six phases merged to `main` (six separate PRs).
- ≥7 days of dry-run log data exists between Phase 4 merge and
  Phase 5 merge.
- Phase 5 removes the abandoned entries identified in the
  dry-run review without operator complaint.
- `git worktree list` count drops to ≤ 1 per actively-used branch
  within 30 days of Phase 5.
- The follow-up backlog items in §10 are filed in the backlog
  system with links back to this plan.
