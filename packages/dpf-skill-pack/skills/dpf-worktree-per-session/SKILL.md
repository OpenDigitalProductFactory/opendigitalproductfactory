---
name: dpf-worktree-per-session
description: "Use when starting, entering, auditing, or managing a concurrent DPF coding session that touches the working tree."

# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: true
user-invocable: true
allowed-tools: Bash(git fetch *) Bash(git worktree *) Bash(git branch *) Bash(git checkout *) Bash(git status *) Bash(git rev-parse *) Bash(git log *) Bash(grep *) Bash(test *) Bash(command -v *) Bash(pnpm *) Bash(corepack *) Bash(scripts/seed-worktree-mcp*) Bash(scripts/sync-mcp-worktrees*)

# DPF coworker fields (Surface B — in-portal seed loader)
category: ops
assignTo: ["build-specialist", "platform-engineer"]
capability: null
taskType: workflow
triggerPattern: "new worktree|create worktree|spawn session|concurrent session|parallel work|isolated branch|worktree readiness|source-only worktree|compile-ready worktree"
userInvocable: true
agentInvocable: false
allowedTools: ["Bash"]
composesFrom: []
contextRequirements: ["git available; scripts/seed-worktree-mcp.{ps1,sh} present; .mcp.json populated in root clone; worktree verification readiness must be classified"]
riskBand: medium

# Kernel principle enforcement
enforces:
  - kernel/principles/worktree-per-session
  - kernel/principles/propose-acknowledge-reassign
  - kernel/principles/worktree-base-origin-main
  - kernel/principles/keep-root-clone-as-merge-worktree
  - kernel/principles/worktree-is-source-control-not-runtime
---

# DPF Worktree per Session

Concurrent DPF coding sessions DO NOT share a working tree. **One session = one branch + one git worktree.** Branches alone are insufficient — the index, HEAD, and untracked files all live in the working tree, so two sessions in the same tree collide on commits, file sweeps, and stale buffer state. This skill walks the canonical worktree-creation flow with the MCP-seed step + COMPOSE_PROJECT_NAME isolation that makes the worktree usable end-to-end.

## What a worktree is — and isn't

A thread worktree is **source-control isolation**: its own branch, index, HEAD, untracked-file space. It is **not** a second DPF runtime. The MCP seed and `COMPOSE_PROJECT_NAME` set in the steps below are collision-avoidance, not an instruction to spin up a parallel runtime for every task.

For normal feature/fix work: commit from the worktree, then route runtime-bound verification through the **shared local-CI convergence sandbox** by claiming a lease (`claim_nonprod_environment_lease(environmentKey="local-integration-ci")`). The sandbox is one shared runtime that every worktree uses sequentially — making each individual worktree runnable doesn't scale past tens of concurrent worktrees, let alone the 1,000–10,000 DPF expects. See [AGENTS.md §4 worktree bullet](../../../../AGENTS.md) and [`worktree-is-source-control-not-runtime`](../../../../docs/founder-kernel/wiki/principles/worktree-is-source-control-not-runtime.md). The rare exception (destructive compose experiment where a disposable runtime IS the deliverable) is a dedicated platform task, not incidental scope on a feature/fix thread.

## When to use

- Starting a second (or third, fourth...) DPF Claude / Codex / contributor session.
- Spawning a sibling task off a long-running parent session (`mcp__ccd_session__spawn_task` chip click).
- Operator says "do this in parallel" or "spin off X as a separate thread."
- Mid-session work needs isolation from main thread (rare — usually file a separate session instead).

## When NOT to use

- The user asked only for read-only inspection in the root clone. Coding work, branch movement, and dirty-file experiments still go in a sibling worktree even when only one session is active.
- The work is documentation-only and doesn't touch code or seed paths — the small risk of staleness isn't worth the worktree overhead.
- Build Studio is the executor — BS sandboxes have their own isolation, not git worktrees.

## Read first

| Source | Path | What to extract |
|---|---|---|
| Worktree doctrine | [AGENTS.md §4](../../../../AGENTS.md) | Branch naming, `--no-checkout`/`-b` flags, root-clone-as-merge-worktree rule |
| Seed script | [`scripts/seed-worktree-mcp.ps1`](../../../../scripts/seed-worktree-mcp.ps1) (Windows) or [`.sh`](../../../../scripts/seed-worktree-mcp.sh) (macOS / Linux) | What the MCP-config seed step copies and where |
| Bulk sync script | [`scripts/sync-mcp-worktrees.ps1`](../../../../scripts/sync-mcp-worktrees.ps1) / [`.sh`](../../../../scripts/sync-mcp-worktrees.sh) | Repair or refresh MCP config, Compose isolation, and readiness markers across many worktrees |
| Compose isolation rule | [AGENTS.md §4 (Compose project isolation)](../../../../AGENTS.md) | Why `COMPOSE_PROJECT_NAME` matters and what breaks without it |
| WSL mirrored mode trap | `project_wsl_mirrored_docker_incompat` (user memory) | First-check when "portal won't start" in a fresh worktree |

## Enforces

- `kernel/principles/worktree-per-session` — this skill IS the principle, operationalized.
- `kernel/principles/propose-acknowledge-reassign` — worktree boundaries are how the PAR discipline survives concurrency.
- `kernel/principles/worktree-base-origin-main` — branch from `origin/main` so the worktree doesn't inherit unpushed local main commits.
- `kernel/principles/keep-root-clone-as-merge-worktree` — root clone stays read-only for active feature work.
- `kernel/principles/worktree-is-source-control-not-runtime` — local worktree gates are distinct from canonical-runtime evidence.

## Steps

1. **Pick a topic slug.** Short, hyphenated, descriptive: `skill-pack-formalize` not `work` or `fix-stuff`. The slug becomes both the worktree directory suffix and the branch name suffix.

2. **Base the new branch on `origin/main`.** Per `worktree-base-origin-main`:
   ```
   git fetch origin main
   git worktree add D:/DPF-worktrees/<slug> -b <prefix>/<slug> origin/main
   ```
   - Convention: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `doc/<slug>`, `clean/<slug>`.
   - **Canonical worktree base** (the 2026-06-05 unified-delivery-surfaces decision #1): both host surfaces (Claude Code and Codex) put topic worktrees in the dedicated sibling dir `D:/DPF-worktrees/<slug>` on Windows, `~/dpf-worktrees/<slug>` on macOS/Linux. Do NOT use Claude Code's default `.claude/worktrees/<random>` nesting inside the root clone, and do NOT use the older `D:/DPF-<slug>` alongside-the-clone form — one base, both surfaces. The dedicated base keeps worktrees out of the root clone's tree and gives the janitor one place to reap. → spec [`2026-06-05-unified-delivery-surfaces-execution-alignment-design.md`](../../../../docs/superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-alignment-design.md) §4.1 + decision #1.
   - **Never** branch from local `main` — local main may carry unpushed commits that sweep into your PR and fail DCO.

3. **Seed the MCP config + agent toolchain.** `.mcp.json` and `.vscode/mcp.json` are gitignored (they carry your local `dpfmcp_...` bearer token), so `git worktree add` does NOT carry them across. Run the bootstrap from inside the new worktree:
   - Windows: `pwsh scripts/dpf-bootstrap-agent-toolchain.ps1`
   - macOS / Linux: `bash scripts/dpf-bootstrap-agent-toolchain.sh`

   The bootstrap copies `.mcp.json` and `.vscode/mcp.json` from the root clone, sets `COMPOSE_PROJECT_NAME=dpf-<slug>` in `.env`, converges the Claude Code + Codex client profiles to the DPF-scoped baseline (DPF MCP only + `dpf-platform` only; generic plugins/MCP servers disabled; the canonical worktree base + this worktree trusted in Codex), and writes the explicit `?tier=full` endpoint required by those lazy-host registries. It seeds kernel memory, runs probes, and prints a readiness banner that flags residual drift. The legacy `scripts/seed-worktree-mcp.{ps1,sh}` shim still works for one release cycle.

4. **Restart your agent in the worktree.** Claude Code / Codex need a fresh session to pick up the new `.mcp.json` — the `dpf` MCP connector won't appear in `/mcp` otherwise.

   If the connector is healthy but a named DPF tool is absent from the attached set, use `load_tools` with an exact `names` entry or natural-language `query`. Notification-aware/generic clients then honor `notifications/tools/list_changed` or re-fetch `tools/list`. Codex must receive the full authorized catalogue at initial connection through its bootstrapped `?tier=full` URL because its HTTP requests do not reliably identify the client and its top-level registry does not refresh mid-turn: inspect `ALL_TOOLS` inside `functions.exec` and invoke a present governed call through `tools.mcp__dpf__<tool_name>(arguments)`. If a fresh task still omits the tool, confirm the configured URL contains `tier=full` and re-run bootstrap/restart the client before classifying it. If `load_tools` succeeds but the qualified tool remains absent from `ALL_TOOLS`, stop and diagnose the Codex connector/session snapshot; do not claim it is callable, install another plugin, use raw JSON-RPC, or bypass MCP authority.

5. **Claim the BI once, with the complete identity.** After the fresh session sees the DPF connector, call `mcp__dpf__claim_backlog_item_for_work` exactly once with the BI id, repository, topic branch, dedicated worktree path, provider, session reference, and explicit `workIntent` (`design`, `review`, `plan`, or `implementation`). The branch and worktree are the durable coordination key; do not omit `sessionRef` or intent and then retry with a different shape. A successful claim is a coordination signal, not proof of readiness. If the server returns `branch_occupied`, `insufficient_token_scope`, or another refusal, preserve that exact response and stop or request a governed handoff—never claim the same BI from a second worktree or churn session identities. Pass `workShape` as one of the five delivery shapes (`delivery-break-fix@1.0.0`, `delivery-small@1.0.0`, `delivery-medium@1.0.0`, `delivery-large@1.0.0`, `delivery-xlarge@1.0.0`) when you know the size and what the work owes. If you omit it, the claim derives the shape from the item's `effortSize` and work type only when the classification rules agree; an implementation claim that cannot derive one is refused with `work_shape_required` and a `pickList` (each shape with its definition, appetite and the gates it owes). **Put that list to the user and re-claim with their answer. Never guess a shape.** `delivery-xlarge` never enters implementation: decompose it and claim the children.

6. **Verify compose isolation.** Before running any `docker compose` command in the worktree:
   ```
   grep COMPOSE_PROJECT_NAME .env
   ```
   The output should be `COMPOSE_PROJECT_NAME=dpf-<slug>`, NOT `dpf`. Compose commands from a worktree without isolation will collide with the root `dpf` stack — at best wasting cycles, at worst stomping on the root install's containers and volumes.

7. **Confirm worktree health.**
   ```
   git status --short --branch
   git rev-parse --abbrev-ref HEAD     # should show your topic branch
   git log origin/main..HEAD --oneline  # should be empty (no commits yet)
   ```

8. **Classify verification readiness.** Run the probe — do **not** hand-check with `test -d node_modules`:
   ```
   node scripts/lib/bootstrap-worktree-deps.mjs . --classify-only
   ```
   A structural presence test is what let an **empty** `apps/web/node_modules` read as provisioned (BI-1C1483C6, 2026-08-04); the probe checks dependency resolution, `@dpf/*` workspace-link locality, and each named compile artifact for emptiness as well as absence.
   - `compile-ready`: dependencies resolve and every compile artifact is populated. Cheap source-local gates may run here.
   - `source-only`: Git/MCP/Compose isolation is present, but local compile/test gates are not proven. Do code work here, but get verification from the shared local-CI convergence sandbox or canonical install. The `missing` array names each gap and **what it forbids** — `apps/web/node_modules` forbids `pnpm --filter web typecheck` (it fails as `'next' is not recognized`); `packages/db/generated` forbids Prisma-touching tests (they fail as `Cannot find module '../generated/client/client'`). Those messages look exactly like real breakage; in a source-only worktree they are not.
   - The probe must report the repository-pinned pnpm version and zero `ignoredBuilds` before `compile-ready`. If it returns `dependencyPolicyReviewKeys`, reuse those exact keys as backlog intake origins; they deliberately coalesce identical base-SHA + package/version + policy-reason findings across worktrees while keeping distinct dependency events separate.
   - Since BI-1C1483C6 a SessionStart hook (`worktree-readiness-banner.mjs`) prints this automatically. Its silence means compile-ready.
   - To become compile-ready, use the **managed** bootstrap — `node scripts/lib/bootstrap-worktree-deps.mjs .` — never a bare `pnpm install` in a worktree. A worktree's `node_modules` is normally a junction to the root clone, so a bare install writes **through** it into the root clone (which it has previously gutted); `root-clone-guard.mjs` now denies that shape. If bootstrap is unavailable or would distract from the task, stay `source-only` and do not claim local gate passes.

## Instructions for agents entering an existing worktree

Before editing or reviewing from an existing worktree:

1. Run `git status --short --branch` and `git rev-parse --abbrev-ref HEAD`. Abort serious implementation on `main` or detached `HEAD` unless the user explicitly asked for inspection only.
2. Confirm `.env` has a non-root `COMPOSE_PROJECT_NAME`. If it is missing or `dpf`, run `scripts/seed-worktree-mcp.{ps1,sh}` before any Compose command.
3. Classify readiness with `node scripts/lib/bootstrap-worktree-deps.mjs . --classify-only`. `.dpf-worktree-readiness.json` is a cached marker, not the authority — a worktree created by the `WorktreeCreate` hook has no marker at all (that hook only PLACES the worktree; provisioning is deliberately opt-in per BI-3047C122). Treat the worktree as `source-only` until the probe says otherwise, and run `scripts/seed-worktree-mcp.{ps1,sh}` if the marker is missing and you want one written.
4. If `source-only`, you may edit and commit, but final answers and PR/evidence notes must say local worktree gates were not run and must point to canonical-runtime/local-CI evidence for any verification claim.
5. Commit or capture dirty work frequently. A dirty active worker worktree blocks upgrade apply because uncommitted output cannot be safely rebased, promoted, or abandoned by automation.

## Confirm which worktree your command actually ran in

With many sibling worktrees holding the same file paths, a command can succeed against the **wrong** copy and look entirely normal. The shell's working directory **persists between tool calls**: one `cd` into a sibling worktree silently retargets every later command that relies on a relative path.

- **Use absolute paths** in shell commands that read, test, or build. Do not rely on the cwd left by an earlier call.
- **Read the runner's own root banner.** Vitest prints `RUN v<version> <root>` — if that root is not your worktree, the results are another branch's. Pin it explicitly: `node <abs>/node_modules/vitest/vitest.mjs run --root <ABSOLUTE pkg dir> <files>`.
- **Cross-check the count.** Compare `grep -c '  it(' <file>` against the reported test total. A passing run whose count doesn't match your file did not execute your file. The same logic applies to any "N passed" summary — reconcile N against something you can count in your own tree.
- After `git reset --hard origin/main`, re-confirm `git log --oneline -1`; never assume the base you started from.

This is a *false green*, not a flake: nothing errors, and the pass is real — for someone else's code.

## Output template

```
**Worktree created.**

- Topic: <slug>
- Path: <D:\DPF-worktrees\slug | ~/dpf-worktrees/slug>
- Branch: <prefix>/<slug>  (based on origin/main, 0 ahead)
- MCP seed: done (.mcp.json + .vscode/mcp.json copied; COMPOSE_PROJECT_NAME=dpf-<slug> set in .env)
- Verification readiness: <compile-ready | source-only> (<reason from .dpf-worktree-readiness.json>)
- Next step: restart Claude Code / Codex in <path>, then verify `/mcp` shows the dpf connector.
```

## Guardrails

- **Never share a working tree across sessions.** Branches alone don't help; index/HEAD collisions are silent and corrupting.
- **Never run `docker compose up`/`down`/`rm` from a worktree without `COMPOSE_PROJECT_NAME` set.** A `docker compose down --volumes` against the root `dpf` project from a worktree is the destructive operation that wiped the volume in the 2026-05-23 incident (`project_2026_05_23_volume_wipe_recovery`).
- **Never base a topic branch on local `main`.** Always `origin/main` after `git fetch`.
- **Never commit MCP config files.** `.mcp.json` and `.vscode/mcp.json` are gitignored for a reason — they carry bearer tokens.
- **Never modify or move the root clone for active feature work.** The root clone is the merge/release/install worktree per `keep-root-clone-as-merge-worktree`; raw `git switch`, `git checkout`, `git reset`, `git pull`, `git merge`, and `git rebase` in that clone are root mutations, not setup.
- Don't treat the worktree as a runtime by default. Commit from the worktree, verify against the canonical install. 'Make the worktree runnable' is a dedicated platform task, not a side-effect of every feature thread.
- **Never claim unrun gates passed.** A `source-only` worktree can hold correct code, but its local typecheck/build/test status is unknown until proven in that worktree or in canonical runtime/local-CI.
- **Never accept a green test run without confirming it targeted your worktree.** A sibling worktree holds the same paths; the runner's root banner and the test count are the proof.

## Worked example (this session, 2026-05-24)

The current session ran in worktree `gifted-banzai-3be1fb` at `D:\DPF\.claude\worktrees\gifted-banzai-3be1fb` — created earlier by the harness, branched off `origin/main`. The MCP config was already seeded (the `dpf` connector was reachable for `mcp__dpf__list_epics`, `create_backlog_item`, etc throughout). Three commits landed on PR #1119 from this isolated worktree:

- `b930f46b` — memo draft
- `27729864` — audit report
- `560a84d8` — principle_decide fix

A sibling session running concurrently (the BS test thread the operator mentioned) operates in a separate worktree with its own MCP config and `COMPOSE_PROJECT_NAME`. Neither session's commits can sweep into the other's tree (per `feedback_git_commit_only_for_concurrent_sessions`, we also use explicit `git add <path>` in case both somehow land in the same tree — belt and suspenders).

## See also

- Successor hygiene skill: [`dpf-worktree-hygiene`](../dpf-worktree-hygiene/SKILL.md) — reaping, janitor flags, sandbox GC (not create)
- AGENTS.md §4 (Branching, Commits & PRs) — full canonical doctrine
- Kernel principle: [`worktree-per-session`](../../../../docs/founder-kernel/wiki/principles/worktree-per-session.md)
- Concurrency principle: [`propose-acknowledge-reassign`](../../../../docs/founder-kernel/wiki/principles/propose-acknowledge-reassign.md)
- Seed scripts: [`scripts/seed-worktree-mcp.ps1`](../../../../scripts/seed-worktree-mcp.ps1), [`scripts/seed-worktree-mcp.sh`](../../../../scripts/seed-worktree-mcp.sh)
- Volume-wipe incident lesson: `project_2026_05_23_volume_wipe_recovery` (user memory)
