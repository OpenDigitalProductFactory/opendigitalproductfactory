---
name: dpf-finishing-a-development-branch
description: "Use when a unit of DPF work is functionally complete and needs to leave the working tree."

# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash(git *) Bash(gh *) Grep mcp__dpf__review_semantic_change

# DPF coworker fields (Surface B — in-portal seed loader)
category: build
assignTo: ["build-specialist", "platform-engineer", "external-coding-agent", "software-engineer"]
capability: null
taskType: workflow
triggerPattern: "finish (the )?branch|wrap up|integration shape|ready to merge|split (this )?into PRs|done with this work|how should I land"
userInvocable: true
agentInvocable: true
allowedTools: ["Bash", "Grep", "mcp__dpf__review_semantic_change"]
composesFrom: []
contextRequirements: []
riskBand: medium

# Kernel principle enforcement
enforces:
  - kernel/principles/all-changes-land-via-pr
  - kernel/principles/one-concern-per-pr
  - kernel/principles/build-gate-mandatory
  - kernel/principles/mention-uncommitted-changes
---

# DPF Finishing a Development Branch

When the work is functionally done, the question is not "open a PR" — it is **what shape should the integration take?** This skill makes that decision explicitly, then confirms the branch is in a landable state, and hands the actual PR mechanics to [`dpf-pr-with-dco`](../dpf-pr-with-dco/SKILL.md). It replaces the retired upstream `finishing-a-development-branch` skill so the composition resolves from one DPF source on every surface.

This is the **decision** step; `dpf-pr-with-dco` is the **execution** step that follows it.

## When to use

- A feature/fix is functionally verified and you are deciding how to land it.
- A branch has grown to touch multiple concerns and you suspect it should be split.
- You are about to open a PR and want to confirm the branch is actually ready.

## When NOT to use

- The work is not functionally verified yet — finish and verify it first (see [`dpf-systematic-debugging`](../dpf-systematic-debugging/SKILL.md) Phase 4: structural pass is not verification).
- You have already decided the shape and the branch is green — go straight to [`dpf-pr-with-dco`](../dpf-pr-with-dco/SKILL.md).

## Steps

1. **Decide the integration shape.** Scope a PR to **one clean revert** (`one-concern-per-pr`), not to one concern. Batch related work: every extra PR costs another serialized gate run on a contended slot. Split — by file set or by interactive cherry-pick onto separate branches off `origin/main` — when a reviewer could not tell which lines did which job, when a revert would force a choice between two things you want independently revertible, or when one half is risky and the other is not. A stack is appropriate when later work genuinely depends on earlier work.

2. **Confirm the branch is green — in the right place.** `build-gate-mandatory`: the required gates must pass before the branch lands. The thread worktree is source-control isolation, not a runtime, so run gates where they belong ([AGENTS.md §5](../../../../AGENTS.md)):
   - Source-local checks (typecheck, targeted unit tests, lint) — in the worktree.
   - Runtime-bound checks (portal build, UX, MCP-touching suites, migration smoke) — against the canonical local install or a governed shared nonprod environment (`dpf-use-shared-nonprod-environment`).
   - Local merged-code verification before push — `dpf-local-merge-ci-before-push`, which itself routes runtime-bound gates to the canonical install.

   A gate that did not execute because the worktree could not host its runtime is an **unrun gate, not a red gate**: re-run it against the canonical install and capture that evidence in the PR. If the gate is genuinely red on the canonical install, the work is not finished — return to it.

3. **Sweep for loose ends.** `mention-uncommitted-changes`: run `git status` and account for every modified/untracked file — staged into this work, deliberately left, or belonging to a different concern. Never let an unrelated stray file ride along silently.

4. **Sweep for overlap.** Check open PRs and other worktrees for work touching the same files (`gh pr list`, `git worktree list`) so you don't land a conflicting change — the overlap sweep that `dpf-pr-with-dco` formalizes.

5. **Freeze and independently review the assembled change.** Account for every file, create a DCO-signed local commit, and confirm `git status --short` is clean. Produce exact-tree gate evidence, then follow the [semantic review publication procedure](../../../../docs/architecture/build-gate-runbook.md#semantic-review-publication-and-infrastructure-recovery) for `review_semantic_change`, receipt validation and bounded infrastructure recovery. Keep independent client assessments separately attributed.

6. **Hand off.** With the shape decided, branch green + clean, and the current publication policy satisfied with any unrun review recorded, invoke [`dpf-pr-with-dco`](../dpf-pr-with-dco/SKILL.md) for PR mechanics.

## Keep a checkpoint while you work

You can run out of capacity at any step, and another assistant may have to
finish. At each stage boundary, call `heartbeat_workroom` with a `checkpoint`:

- `nextAction`
- `addressing`: the failing checks your edits target
- `uncommittedPaths`
- `headSha` and `pushed`
- `openRisks`

The server keeps the latest checkpoint and shows it to whoever takes the room
over. A checkpoint is your claim, not evidence: the next assistant still checks
it against git and CI.

## Guardrails

- **Don't bundle concerns to save a PR.** A mixed PR is harder to review and revert; split it.
- **Don't open a PR as a parking place.** Open it when it is ready to merge, not to stash in-progress work (this is `dpf-pr-with-dco`'s contract). DPF delivery PRs are regular ready-for-review PRs, not GitHub draft PRs.
- **Don't finish on a red or unverified branch.** Green gate + functional verification first.
- **Don't review a dirty or moving tree.** Semantic findings bind to one immutable base/head/diff identity; edit first, commit, then review.

## See also

- Successor: [`dpf-pr-with-dco`](../dpf-pr-with-dco/SKILL.md) — the DPF PR mechanics (branch, sign, push, overlap-sweep, open-when-ready).
- Composes with: [`dpf-local-merge-ci-before-push`](../dpf-local-merge-ci-before-push/SKILL.md) — local merged-code verification before push.
- Kernel: `all-changes-land-via-pr`, `one-concern-per-pr`, `build-gate-mandatory`, `mention-uncommitted-changes`.
