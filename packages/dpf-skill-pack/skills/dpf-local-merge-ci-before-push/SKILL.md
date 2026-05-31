---
name: dpf-local-merge-ci-before-push
description: "Use in the DPF codebase before pushing or opening a PR when a branch needs local merged-code verification. Merges against current main in an isolated path, runs the required gates, records the result, and blocks red pushes."
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash(git *) Bash(pnpm *) Bash(node scripts/local-integration-ci.mjs *) mcp__dpf__record_local_integration_result
category: build
assignTo: ["build-specialist", "platform-engineer"]
capability: null
taskType: workflow
triggerPattern: "local merge ci|before push|pre-push gate|merged-code verification|integration gate|block push"
userInvocable: true
agentInvocable: true
allowedTools: ["Bash", "mcp__dpf__record_local_integration_result"]
composesFrom: ["dpf-pr-with-dco"]
contextRequirements: ["Git branch available; dependencies installed; DPF MCP write tool reachable for result recording"]
riskBand: medium
enforces:
  - kernel/principles/build-gate-mandatory
  - kernel/principles/all-changes-land-via-pr
---

# DPF Local Merge CI Before Push

Run a local merged-code gate before pushing work that Build Studio or reviewers might treat as ready.

## Worktree vs. runtime — where "local" actually means

The thread worktree is source-control isolation, not a runtime. The "isolated merge path" below is a *merge workspace* (clean checkout of `origin/main` + branch tip in a scratch directory so the merge result is reproducible) — it is NOT a second full DPF runtime stood up inside the worktree.

Run this skill's gates per [AGENTS.md §5 "Where each gate runs"](../../../../AGENTS.md):

- **Canonical local install** (root clone, port 3000, shared dev DB, already-running portal/MCP stack) — runtime-bound gates: portal build, UX, MCP-touching tests, migration smoke.
- **Thread worktree directly** — cheap source-local checks: `tsc --noEmit`, targeted unit specs, lint.

If a gate cannot run in the worktree because pnpm/corepack is missing, workspace links point outside the worktree, the Prisma client wasn't generated there, or Next rejects symlinked `node_modules` — **classify as harness limitation, not gate failure** ([`worktree-is-source-control-not-runtime`](../../../../docs/founder-kernel/wiki/principles/worktree-is-source-control-not-runtime.md)). Route the gate to the **shared local-CI convergence sandbox** via `claim_nonprod_environment_lease(environmentKey="local-integration-ci")` — one shared runtime that all worktrees lease sequentially — and capture that run's evidence in the PR. Per-worktree runnable runtimes don't scale at DPF's expected 1k–10k concurrent worktrees; the sandbox is the only tenable verification substrate.

## When to use

- A branch is ready to push, open a PR, or hand back to Build Studio.
- The work touched TypeScript, UI, migrations, skills, or workflow behavior.
- Concurrent local development means a clean worktree test is not enough.

## Enforces

- `kernel/principles/build-gate-mandatory`
- `kernel/principles/all-changes-land-via-pr`

## Steps

1. Confirm the branch is not `main` and is not detached.
2. Fetch current `origin/main`.
3. Run the local integration CI script or its current equivalent in an isolated merge path.
4. Run the affected unit tests, typecheck, build, UX, and migration gates required by the changed files.
5. Record the local integration result through MCP.
6. Push only when the merged-code gate is green. If it is red, report the failure and next fix.

## Guardrails

- Do not treat "passed in my worktree" as merge readiness.
- Do not run destructive Compose cleanup against the root `dpf` project.
- Do not push or open a PR while the local integration gate is red unless the operator explicitly reclassifies the branch as a blocked handoff.
- A gate that did not run is an unrun gate, not a red gate; re-run it against the canonical install and record the result there.
- Do not invest the current thread in making the worktree a full DPF runtime to satisfy this gate. Runtime-bound verification routes through the **shared local-CI convergence sandbox** via lease — per-worktree runtimes are deliberately rejected at scale.

## Worked example

A feature branch passes focused Vitest tests but `origin/main` changed Build Studio actions. This skill runs the merge gate, catches the conflict before push, records "Merged-code gate failed: conflict with origin/main", and leaves the branch local until the conflict is resolved.
