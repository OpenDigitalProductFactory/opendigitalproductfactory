---
name: dpf-worktree-per-session
description: "Use when starting a concurrent DPF coding session that touches the working tree. Each thread gets its own git worktree (not a shared clone), its own .mcp.json + .vscode/mcp.json seeded from the root, and its own COMPOSE_PROJECT_NAME so docker-compose stacks don't collide. Composes with dpf-finishing-a-development-branch as the predecessor isolation step. Encodes the worktree-per-session kernel principle plus the propose-acknowledge-reassign concurrency discipline."

# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash(git worktree *) Bash(git branch *) Bash(git checkout *) Bash(scripts/seed-worktree-mcp*) Bash(scripts/sync-mcp-worktrees*)

# DPF coworker fields (Surface B — in-portal seed loader)
category: ops
assignTo: ["build-specialist", "platform-engineer"]
capability: null
taskType: workflow
triggerPattern: "new worktree|create worktree|spawn session|concurrent session|parallel work|isolated branch"
userInvocable: true
agentInvocable: true
allowedTools: ["Bash"]
composesFrom: []
contextRequirements: ["git available; scripts/seed-worktree-mcp.{ps1,sh} present; .mcp.json populated in root clone"]
riskBand: medium

# Kernel principle enforcement
enforces:
  - kernel/principles/worktree-per-session
  - kernel/principles/propose-acknowledge-reassign
  - kernel/principles/worktree-base-origin-main
  - kernel/principles/keep-root-clone-as-merge-worktree
---

# DPF Worktree per Session

Concurrent DPF coding sessions DO NOT share a working tree. **One session = one branch + one git worktree.** Branches alone are insufficient — the index, HEAD, and untracked files all live in the working tree, so two sessions in the same tree collide on commits, file sweeps, and stale buffer state. This skill walks the canonical worktree-creation flow with the MCP-seed step + COMPOSE_PROJECT_NAME isolation that makes the worktree usable end-to-end.

## When to use

- Starting a second (or third, fourth...) DPF Claude / Codex / contributor session.
- Spawning a sibling task off a long-running parent session (`mcp__ccd_session__spawn_task` chip click).
- Operator says "do this in parallel" or "spin off X as a separate thread."
- Mid-session work needs isolation from main thread (rare — usually file a separate session instead).

## When NOT to use

- Only one session is active and no concurrent work is planned — work in the root clone (`D:\DPF` on Windows, `~/dpf` on macOS/Linux).
- The work is documentation-only and doesn't touch code or seed paths — the small risk of staleness isn't worth the worktree overhead.
- Build Studio is the executor — BS sandboxes have their own isolation, not git worktrees.

## Read first

| Source | Path | What to extract |
|---|---|---|
| Worktree doctrine | [AGENTS.md §4](../../../../AGENTS.md) | Branch naming, `--no-checkout`/`-b` flags, root-clone-as-merge-worktree rule |
| Seed script | [`scripts/seed-worktree-mcp.ps1`](../../../../scripts/seed-worktree-mcp.ps1) (Windows) or [`.sh`](../../../../scripts/seed-worktree-mcp.sh) (macOS / Linux) | What the MCP-config seed step copies and where |
| Bulk sync script | [`scripts/sync-mcp-worktrees.ps1`](../../../../scripts/sync-mcp-worktrees.ps1) | When operating across many worktrees |
| Compose isolation rule | [AGENTS.md §4 (Compose project isolation)](../../../../AGENTS.md) | Why `COMPOSE_PROJECT_NAME` matters and what breaks without it |
| WSL mirrored mode trap | `project_wsl_mirrored_docker_incompat` (user memory) | First-check when "portal won't start" in a fresh worktree |

## Enforces

- `kernel/principles/worktree-per-session` — this skill IS the principle, operationalized.
- `kernel/principles/propose-acknowledge-reassign` — worktree boundaries are how the PAR discipline survives concurrency.
- `kernel/principles/worktree-base-origin-main` — branch from `origin/main` so the worktree doesn't inherit unpushed local main commits.
- `kernel/principles/keep-root-clone-as-merge-worktree` — root clone stays read-only for active feature work.

## Steps

1. **Pick a topic slug.** Short, hyphenated, descriptive: `skill-pack-formalize` not `work` or `fix-stuff`. The slug becomes both the worktree directory suffix and the branch name suffix.

2. **Base the new branch on `origin/main`.** Per `worktree-base-origin-main`:
   ```
   git fetch origin main
   git worktree add ../DPF-<slug> -b <prefix>/<slug> origin/main
   ```
   - Convention: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `doc/<slug>`, `clean/<slug>`.
   - Worktree path: `D:\DPF-<slug>` on Windows, `~/dpf-worktrees/<slug>` on macOS/Linux.
   - **Never** branch from local `main` — local main may carry unpushed commits that sweep into your PR and fail DCO.

3. **Seed the MCP config.** `.mcp.json` and `.vscode/mcp.json` are gitignored (they carry your local `dpfmcp_...` bearer token), so `git worktree add` does NOT carry them across. Run the seed script from inside the new worktree:
   - Windows: `pwsh scripts/seed-worktree-mcp.ps1`
   - macOS / Linux: `bash scripts/seed-worktree-mcp.sh`

   The script copies `.mcp.json` and `.vscode/mcp.json` from the root clone AND sets `COMPOSE_PROJECT_NAME=dpf-<slug>` in the worktree's `.env`.

4. **Restart your agent in the worktree.** Claude Code / Codex need a fresh session to pick up the new `.mcp.json` — the `dpf` MCP connector won't appear in `/mcp` otherwise.

5. **Verify compose isolation.** Before running any `docker compose` command in the worktree:
   ```
   grep COMPOSE_PROJECT_NAME .env
   ```
   The output should be `COMPOSE_PROJECT_NAME=dpf-<slug>`, NOT `dpf`. Compose commands from a worktree without isolation will collide with the root `dpf` stack — at best wasting cycles, at worst stomping on the root install's containers and volumes.

6. **Confirm worktree health.**
   ```
   git status --short --branch
   git rev-parse --abbrev-ref HEAD     # should show your topic branch
   git log origin/main..HEAD --oneline  # should be empty (no commits yet)
   ```

## Output template

```
**Worktree created.**

- Topic: <slug>
- Path: <D:\DPF-slug | ~/dpf-worktrees/slug>
- Branch: <prefix>/<slug>  (based on origin/main, 0 ahead)
- MCP seed: done (.mcp.json + .vscode/mcp.json copied; COMPOSE_PROJECT_NAME=dpf-<slug> set in .env)
- Next step: restart Claude Code / Codex in <path>, then verify `/mcp` shows the dpf connector.
```

## Guardrails

- **Never share a working tree across sessions.** Branches alone don't help; index/HEAD collisions are silent and corrupting.
- **Never run `docker compose up`/`down`/`rm` from a worktree without `COMPOSE_PROJECT_NAME` set.** A `docker compose down --volumes` against the root `dpf` project from a worktree is the destructive operation that wiped the volume in the 2026-05-23 incident (`project_2026_05_23_volume_wipe_recovery`).
- **Never base a topic branch on local `main`.** Always `origin/main` after `git fetch`.
- **Never commit MCP config files.** `.mcp.json` and `.vscode/mcp.json` are gitignored for a reason — they carry bearer tokens.
- **Never modify the root clone's working tree for active feature work.** The root clone is the merge/release worktree per `keep-root-clone-as-merge-worktree`.

## Worked example (this session, 2026-05-24)

The current session ran in worktree `gifted-banzai-3be1fb` at `D:\DPF\.claude\worktrees\gifted-banzai-3be1fb` — created earlier by the harness, branched off `origin/main`. The MCP config was already seeded (the `dpf` connector was reachable for `mcp__dpf__list_epics`, `create_backlog_item`, etc throughout). Three commits landed on PR #1119 from this isolated worktree:

- `b930f46b` — memo draft
- `27729864` — audit report
- `560a84d8` — principle_decide fix

A sibling session running concurrently (the BS test thread the operator mentioned) operates in a separate worktree with its own MCP config and `COMPOSE_PROJECT_NAME`. Neither session's commits can sweep into the other's tree (per `feedback_git_commit_only_for_concurrent_sessions`, we also use explicit `git add <path>` in case both somehow land in the same tree — belt and suspenders).

## See also

- AGENTS.md §4 (Branching, Commits & PRs) — full canonical doctrine
- Kernel principle: [`worktree-per-session`](../../../../docs/founder-kernel/wiki/principles/worktree-per-session.md)
- Concurrency principle: [`propose-acknowledge-reassign`](../../../../docs/founder-kernel/wiki/principles/propose-acknowledge-reassign.md)
- Seed scripts: [`scripts/seed-worktree-mcp.ps1`](../../../../scripts/seed-worktree-mcp.ps1), [`scripts/seed-worktree-mcp.sh`](../../../../scripts/seed-worktree-mcp.sh)
- Volume-wipe incident lesson: `project_2026_05_23_volume_wipe_recovery` (user memory)
