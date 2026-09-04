---
name: dpf-pr-with-dco
description: "Use when ready to open a DPF pull request."

# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash(git *) Bash(gh *) mcp__dpf__review_semantic_change

# DPF coworker fields (Surface B — in-portal seed loader)
category: build
assignTo: ["build-specialist", "platform-engineer"]
capability: null
taskType: workflow
triggerPattern: "open (a |the )?PR|pull request|push (and|to) PR|land this|ship this branch"
userInvocable: true
agentInvocable: true
allowedTools: ["Bash", "mcp__dpf__review_semantic_change"]
composesFrom: ["dpf-finishing-a-development-branch"]
contextRequirements: ["git available; gh CLI authenticated; DCO app enabled on repo"]
riskBand: high

# Kernel principle enforcement
enforces:
  - kernel/principles/all-changes-land-via-pr
  - kernel/principles/dco-sign-off-required
  - kernel/principles/always-push-after-committing
  - kernel/principles/branch-guard-before-implementation
  - kernel/principles/one-concern-per-pr
---

# DPF Pull Request with DCO

DPF's PR contract is strict and non-negotiable: **every change lands via PR**, **every commit is DCO-signed**, **branches are based on `origin/main`**, **PRs open only when ready to merge** (not as parking places), **PRs are regular ready-for-review PRs, never GitHub draft PRs**, and **the overlap sweep happens before push** so sibling sessions don't ship the same fix twice. This skill walks the canonical PR opening flow with all DPF gates applied.

## When to use

- Implementation complete on a topic branch, build gate (vitest + typecheck + next build per AGENTS.md §5) green, ready for merge.
- Hotfix landing under a maintenance branch with the same gates.
- Doc-only change ready to land (still goes through PR per the all-changes-land-via-pr rule).

## When NOT to use

- Build gate not green — finish the work first (the build gate must pass; verify functionally per `dpf-systematic-debugging` Phase 4, where a structural pass is not verification).
- Branch is unsigned mid-stream — fix sign-off via `git commit --amend --no-edit -s` (or for older commits, `git rebase --signoff`) BEFORE running this skill.
- PR would be a "parking place" for in-flight work — keep the branch pushed but don't open the PR. The "PR creation means ready to merge" rule is explicit in AGENTS.md §4, and draft PRs are not an escape hatch.
- Concurrent session is already opening a PR for the same fix — coordinate (operator) before pushing.

## Read first

| Source | Path | What to extract |
|---|---|---|
| PR contract | [AGENTS.md §4](../../../../AGENTS.md) | Full canonical rules: branch naming, DCO, squash-and-delete, branch-guard |
| Build gate | [AGENTS.md §5](../../../../AGENTS.md) | The 4 checks that must pass before claiming "ready to merge" |
| Recent main | `git log origin/main --oneline -20` | What the base is so the PR description references real prior context |
| Open PRs | `gh pr list --state open --limit 50` | Overlap check per `feedback_pr_overlap_check_before_pushing` |
| Pre-commit hooks | [`.githooks/pre-commit`](../../../../.githooks/pre-commit) | What runs locally vs in CI (gitleaks + typecheck local; full build CI) |

## Enforces

- `kernel/principles/all-changes-land-via-pr` — even maintainer changes.
- `kernel/principles/dco-sign-off-required` — every commit needs `Signed-off-by:`.
- `kernel/principles/always-push-after-committing` — local-only commits are invisible to CI.
- `kernel/principles/branch-guard-before-implementation` — abort if on `main` or detached HEAD.
- `kernel/principles/one-concern-per-pr` — refuse to bundle unrelated changes.

## Steps

1. **Branch guard.** Confirm you're NOT on `main` and NOT detached:
   ```
   git status --short --branch
   git branch --show-current
   ```
   If `main` or `(HEAD detached at ...)` — STOP. Either branch off `origin/main` first or move work to the right branch. Never push fix work to `main`.

2. **Overlap sweep.** Per `feedback_continuous_overlap_check` (re-sweep before every push, not just session start):
   ```
   gh pr list --state open --limit 50 --json number,title,headRefName
   git log origin/main --since="3 days ago" --oneline
   ```
   If you find a sibling PR fixing the same surface, STOP and coordinate. Two PRs landing the same fix is a waste at best and a merge-conflict spiral at worst.

3. **Verify build gate.** Per AGENTS.md §5:
   ```
   cd apps/web && pnpm exec vitest run                # affected tests
   cd apps/web && pnpm typecheck                       # typecheck
   cd apps/web && pnpm next build                      # if epic-completion or UI surface
   ```
   For UX changes: drive the change against the running app (`/run` or `/verify` skill) and capture dynamic-analysis evidence.

   Before requesting the shared sandbox, run the cheap deterministic checks:
   ```
   pnpm gate:context
   pnpm run pregate:preflight
   ```
   Resolve the prospective constraints and host-side guard failures first. Do not spend a scarce sandbox lease discovering a missing PR trailer, plan receipt, derived artifact, or source-policy violation.

3b. **Freeze the local review target.** Create the DCO-signed commit that contains the complete concern, confirm the worktree is clean, and compute the exact base tree, head tree, and committed-diff digest. Do not review an uncommitted or moving tree.

3c. **Run independent semantic review before pregate or first publication.** Call `review_semantic_change` for the governing Workroom and exact committed tree. Runtime code requires an actual Change Reviewer pass; a low-risk docs-only change may receive a durable auto-pass. Address blocking findings and re-run against the new commit. Stop after two failed repair rounds and escalate rather than oscillating. A commit, rebase, diff, reviewer/policy version, or specialist-set change invalidates the old receipt. Phase 3 defaults to shadow observation; never hide a failed receipt just because deterministic blocking has not yet been ratcheted on.

   Persist the returned receipt into the worktree's git-dir sidecar before pregate so the pre-push control can validate it without a model, portal, database, or network call:
   ```
   pnpm review:semantic-gate -- record --receipt-file <tool-result.json> --evidence-id <ExternalEvidenceRecord-id>
   ```
   An infrastructure-inconclusive result is not a semantic failure and must not be repaired as though it found a code defect; retry the review when capacity returns.

3d. **Local-CI sandbox gate (default-on pre-push, BI-C74F4DE9).** For runtime-code branches, run `pnpm run pregate` before the push — the chained pre-push hook refuses an ungated push otherwise. Carry the evidence into the PR body as a trailer so `pnpm pr:health` reads the branch as merge-ready even when checked from another machine:
   ```
   Local-CI-Evidence: <evidence-record-id> (<branch>@<sha>)
   ```
   If the gate was consciously skipped (docs-adjacent config, verified-clean revert), attest explicitly instead: `Local-CI-Override: <reason>`. A runtime-code PR with neither is a pr:health blocker.

4. **DCO check.** Every commit on your branch must have `Signed-off-by:`:
   ```
   git log origin/main..HEAD --pretty=format:'%h %s%n%(trailers:only,unfold)' | grep -B1 Signed-off-by || echo "MISSING DCO"
   ```
   If MISSING DCO, fix with `git commit --amend --no-edit -s` (HEAD only) or `git rebase --signoff origin/main` (whole branch). Do NOT push without sign-off — DCO bot will block merge.

5. **Concurrent-session safety.** Stage with explicit paths (per `feedback_git_commit_only_for_concurrent_sessions`):
   ```
   git add <path1> <path2>          # not `git add -A` or `git add .`
   ```
   Even if you're sole-owner of the worktree, this is belt-and-suspenders against accidental cross-thread file sweeps.

6. **Push.**
   ```
   git push                          # tracks origin/<branch>
   ```
   `-u origin <branch>` only on the first push.

7. **Prepare and mechanically validate the PR body.** Write the final Markdown body to a temporary file using the client's native filesystem tool, including exact verification evidence and any required trailers. After the final push, run:
   ```
   pnpm pr:ready -- --pr-body-file <path-to-pr-body.md>
   ```
   This command derives its local checks from the same policy profiles as CI, validates Git/DCO/push state and PR trailers, and leads with the gate-context checklist for the exact diff. If it reports `PR readiness: NOT READY`, fix every blocker and rerun it. Do not create the PR yet.

8. **Open the regular PR only after `pr:ready` reports READY.** Do not use `--draft`; a DPF PR is the ready-for-review / ready-to-merge signal. Reuse the exact body file that passed readiness:
   ```
   gh pr create --title "<convention>: <imperative summary>" --body-file <path-to-pr-body.md>
   ```

   - Title: imperative form, prefixed by repo convention (`docs:`, `fix:`, `feat:`, `chore:`, `spec:`). Under ~72 chars.
   - **PR creation means ready to merge.** If you're not, do NOT open. Push the branch as a recovery/handoff artifact and signal that the PR is pending the next milestone.
   - Verify the PR is not a draft:
     ```
     gh pr view --json isDraft
     ```
     Expected: `isDraft` is `false`. If it is `true` and the branch gates are green, run `gh pr ready <number>` immediately; if the gates are not green, close the PR and keep the branch.

9. **Report the PR URL.** With the BI id (if applicable) and the build-gate evidence summary so the operator can ratify without re-running checks.

## Output template

```
**Pull request opened.**

- PR: <URL>
- Branch: <prefix>/<slug>  (<N> commits ahead origin/main, all DCO-signed)
- Linked BI(s): <BI-XXXXXXXX>, ...
- Build gate: vitest <pass>, typecheck <pass>, next build <pass | n/a>, UX <evidence summary | n/a>
- Overlap sweep: <no overlap | named PR ids handled how>
- Ready for: <merge | review | gated on X>
```

## Guardrails

- **Never push to `main` directly.** Branch protection enforces this on the remote, but a force push from a misconfigured local could bypass — don't try.
- **Never skip `-s`.** `git commit --no-verify` skips the local typecheck hook, but the DCO trailer is the bot's hard gate — there's no way to skip and merge.
- **Never open a PR as a "draft handoff" or "early visibility marker."** Pushed branches do that job; PRs mean ready to merge per AGENTS.md §4.
- **Never create GitHub draft PRs for DPF delivery.** Do not pass `--draft`, do not use a connector setting that creates drafts, and verify `isDraft=false` after creation.
- **Scope each PR to one clean revert.** Batch related work — every extra PR is another serialized gate run on a contended slot. Split only when a reviewer could not attribute the diff, when a revert would force a choice between two things you want independently revertible, or when one half is risky and the other is not.
- **Never force-push to main.** And never force-push to a topic branch that's under review without telling the reviewer.
- **Never use `git add -A` / `git add .` in a worktree where concurrent sessions exist.** Use explicit paths.

## Worked example (this session, 2026-05-24)

Three commits landed on PR #1119 from this worktree, all following this skill's flow:

- Commit `b930f46b` (memo draft): branched off `origin/main`, signed, explicit `git add docs/superpowers/drafts/2026-05-24-...md`, pre-commit gitleaks scan passed, pushed, PR opened with overlap sweep showing zero conflict.
- Commit `27729864` (audit report): same flow, explicit-path stage, signed, pushed to the same branch.
- Commit `560a84d8` (semantic-fallback fix): same flow, plus full vitest suite run (946/952 — 2 unrelated cold-start flakes), typecheck clean, pre-commit hook re-ran scoped typecheck which passed.

All three commits carry `Signed-off-by: Mark Bodman <markdbodman@gmail.com>` and `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` trailers. DCO bot accepted all three on push.

## See also

- AGENTS.md §4 (Branching, Commits & PRs) — full canonical doctrine
- **Optional HTML PR explainer (opt-in).** The PR *description* stays Markdown, but for a change whose rationale leans on a flow diagram, a change-map table, or annotated snippets, you can attach a self-contained HTML "code explainer" that reads better than the default diff view — copy [`docs/superpowers/_templates/pr-explainer.template.html`](../../../../docs/superpowers/_templates/pr-explainer.template.html) and link it from the description. See [`html-artifacts-guide.md`](../../../../docs/superpowers/html-artifacts-guide.md). Additive only; Markdown PR bodies remain the default.
- Predecessor skill: [`dpf-worktree-per-session`](../dpf-worktree-per-session/SKILL.md)
- Composes with: `dpf-finishing-a-development-branch` (integration-shape decisions)
- Kernel principles: [`all-changes-land-via-pr`](../../../../docs/founder-kernel/wiki/principles/all-changes-land-via-pr.md), [`dco-sign-off-required`](../../../../docs/founder-kernel/wiki/principles/dco-sign-off-required.md), [`branch-guard-before-implementation`](../../../../docs/founder-kernel/wiki/principles/branch-guard-before-implementation.md)
