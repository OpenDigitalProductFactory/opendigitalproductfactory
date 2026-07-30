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

0. **Front door: `pnpm run pregate`.** It does this whole skill mechanically — pushes the branch, claims the `local-integration-ci` lease, runs the checked-in non-mutating runner (`scripts/local-ci-runner.sh` → the local-integration plan in a dedicated scratch worktree; `DPF_LOCAL_CI_COMMAND` overrides), records the MCP evidence, releases the lease, and writes the gate record the default-on pre-push hook checks. Only fall through to the manual steps below when pregate itself cannot run.
1. Confirm the branch is not `main` and is not detached.
2. Fetch current `origin/main`.
3. Run the local integration CI script or its current equivalent in an isolated merge path.
4. **Step-zero freshness gate (BI-ECDF9520):** after the merge and before any test/build, the sandbox must prove its installed dependency graph matches the merged `pnpm-lock.yaml` — `node scripts/sandbox-freshness-preflight.mjs --converge` (already part of the local-integration plan). Exit 3/4 means SANDBOX DRIFT / NOT READY: the sandbox is stale, the run is NOT product evidence, and the only repair is the preflight's own single governed `pnpm install --frozen-lockfile` convergence — never a manual or per-worktree install.
5. Run the affected unit tests, typecheck, build, UX, and migration gates required by the changed files.
6. Record the local integration result through MCP — `passed`, `failed`, `conflict`, or `blocked_sandbox_drift` (stale sandbox; carries the freshness verdict and resolved `next`/`react`/`react-dom` versions in evidence).
7. Push only when the merged-code gate is green. If it is red, report the failure and next fix; if it is blocked on sandbox drift, converge and re-run — do not report a product failure.

## Reading a pregate result — a queued run can exit 0

`pregate` first waits for admission to the shared `local-integration-ci` lease. While it waits it prints `local-CI admission queued at position N`. **A run that never gets admitted can still terminate with exit code 0**, so the exit status alone does not distinguish "gate passed" from "gate never ran".

Confirm a real pass by the artifacts, not the exit code:

1. The run ends with the literal line `gate passed`.
2. It wrote `.git/worktrees/<name>/dpf-local-ci-metadata.json` (path is echoed as `[local-integration-ci] metadata …`), and in that record **`candidateSha` is the commit you are about to push** and `baseSha` is the `origin/main` it merged against. Also check `evidencePlan.evidenceTier` / `fullSuite` describe the coverage you expected.
3. Sanity-check the log actually contains gate work. `grep -v "admission queued"` — if nothing but queue polling remains, nothing ran.

Then push normally: with a valid record for the head SHA the pre-push hook admits the push, and `DPF_SKIP_PREPUSH_GATE` is **not** needed.

- **Never wrap `pregate` in `timeout`.** Killing it mid-queue is what produces the false green above. Run it unbounded (background it and wait for completion).
- Queue contention is not a reason to override the gate. Waiting is correct; `DPF_SKIP_PREPUSH_GATE` is for a verified-clean push the gate structurally cannot cover, and it is recorded either way.
- Cancelling a pregate can leave a stale queued lease pinned to the **old** SHA — release it before re-running, or the next run queues behind your own abandoned entry.

## Guardrails

- Do not treat "passed in my worktree" as merge readiness.
- Do not treat a pregate exit code as the verdict. The verdict is `gate passed` plus a metadata record whose `candidateSha` matches your commit.
- A stale sandbox is not a product failure. Never record a red build as product evidence while the freshness preflight is red or unrun — classify it `blocked_sandbox_drift` and converge first.
- Never start a second dependency install while one is running, and never "fix" a stale sandbox by installing dependencies inside a topic worktree.
- Do not run destructive Compose cleanup against the root `dpf` project.
- Do not push or open a PR while the local integration gate is red unless the operator explicitly reclassifies the branch as a blocked handoff.
- A gate that did not run is an unrun gate, not a red gate; re-run it against the canonical install and record the result there.
- Do not invest the current thread in making the worktree a full DPF runtime to satisfy this gate. Runtime-bound verification routes through the **shared local-CI convergence sandbox** via lease — per-worktree runtimes are deliberately rejected at scale.

## Worked example

A feature branch passes focused Vitest tests but `origin/main` changed Build Studio actions. This skill runs the merge gate, catches the conflict before push, records "Merged-code gate failed: conflict with origin/main", and leaves the branch local until the conflict is resolved.
