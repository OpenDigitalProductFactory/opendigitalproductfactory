---
status: active
---

# Plan: each build gets its own repository (Workspace contract M1)

**Spec:** [Build Execution Provider, "Workspace contract"](../specs/2026-05-09-build-execution-provider-design.md). W1–W5 were ratified and M1 was approved by the operator on 2026-10-01. M2–M5 each return to the operator before they start.

**Why:** about 25 of 41 sandbox defects between 2026-08-01 and 2026-09-29 trace to builds sharing one git repository through worktrees: one index, one `shallow` file, one ref store, and one worktree registry the portal can prune.

## What M1 changes

`.builds/<buildId>` becomes an independent clone (`git clone --reference /workspace --dissociate`) instead of a worktree. The path is unchanged, so every caller that resolves a build's workdir (`resolveBuildWorkdir`) is unchanged.

The shared `/workspace` repo stays the one place every build branch is **recorded**, because promotion (`promoteBuildBranch`), branch GC (`sandbox-build-gc.ts`) and "keep the branch for audit/recovery" all read it there. The clone pushes its branch back (remote `shared`) at three points:

| Point | Where | Why |
|---|---|---|
| Teardown | `teardownBuildWorktree` → `buildSandboxBuildCloneRemoveCommand` | Abandon, escalation, the inert reaper and GC keep the branch; without the sync, teardown would delete its only copy |
| Promotion | `promoteBuildBranch` | The client branch merges what the clone committed |
| Every re-ensure | `provisionBuildWorktree` (reuse path) | Recovery after a lost tree rebuilds from a recent branch |

A clone does not inherit the shared repo's local config or remote-tracking refs, so the clone command:

- copies `user.name`/`user.email` (without them, root commits fail and the in-flight commit's `|| true` drops work silently)
- sets `core.hooksPath /dev/null`
- adds `origin` as the upstream URL
- fetches `refs/remotes/origin/*` and `refs/heads/client/*` from the shared repo, so `origin/main` (merge base, readiness, guards) and bare `client/<id>` (diff base) resolve

A worktree left by the previous mode is converted in place. Its in-flight work is committed first, so it survives on the branch the clone checks out. The stale-lock sweep also covers each clone's own `.git`.

The shared repo serves as the reference. A dedicated bare mirror is not needed while the portal still mounts the volume; it belongs with M2, when the portal stops mounting `sandbox_workspace`.

## Rollout

1. **This PR:** the clone path behind `DPF_BUILD_WORKSPACE_MODE=clone`, with the default still `worktree`.
   - Unit tests run the generated commands against real git repos (create, commit and sync-on-delete, promotion merge, reuse keeps uncommitted work, worktree conversion keeps in-flight work).
   - Verified inside dpf-sandbox-1 on 2026-10-01 against the real repo on a throwaway branch: created in 13 s before install, own `.git`, `origin/main` and identity resolve, and the branch was recorded in `/workspace` after a commit and delete.
2. **Next PR (2026-10-02, after #5930 merged and deployed in `aeb6607e4`):** flip the default to `clone`, with `DPF_BUILD_WORKSPACE_MODE=worktree` as the rollback. Deploy through `/ops/self-upgrade`, then watch the next builds through plan → build → review on the live install.
3. **After a clean live run:** retire the worktree path, the BI-7FCF10FE prune lock workaround, and the shared-root `startBuildBranch` reset sequence.

## Found while mapping, not in M1

- `github-api-commit.ts` `readSandboxFile` reads `/sandbox-workspace/<path>` (the shared root on the client branch), not the build's tree, so a publish could carry the client-branch content of a modified file. This is broken under worktrees too. It needs its own item.
- Agent prompts (`opencode-dispatch.ts`, `grok-dispatch.ts`) and some sandbox-pack tools still say "operate from `/workspace`". That bypasses isolation in either mode. It belongs to M2.
- The work-pattern replay (`work-pattern-build-replay.ts`) keeps its detached-SHA worktree. It is a hermetic experiment path, not a build.
