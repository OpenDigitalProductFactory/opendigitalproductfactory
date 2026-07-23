# Build-worktree resume preservation — the isolation-ON half of BI-8C6AA60E

**BI-8C6AA60E** · 2026-07-22

## What was already fixed, and what was not

PR #3246 fixed the **shared-tree** half: on `startBuildBranch` re-entry with an
existing `build/<buildId>` branch, `refreshCurrentBranchFromTarget` is now called
with `preserveExistingWork: true`, so a review-phase resume no longer resets away
committed work.

That fix lives entirely in the `else` arm of the isolation flag — the
**isolation-OFF** path. Per-build worktree isolation
(`isBuildWorktreeIsolationEnabled`) **defaults ON**, so the live path was the
other arm, and it was never covered.

## The remaining loss

`provisionBuildWorktree` called `buildSandboxWorktreeAddCommand`, which
unconditionally ran:

```sh
git worktree remove --force /workspace/.builds/<buildId> 2>/dev/null || true
git worktree prune
git worktree add --force /workspace/.builds/<buildId> build/<buildId>
```

`git worktree remove --force` deletes the working tree wholesale. So **every
re-entry** into `startBuildBranch` for a build that already had a worktree — a
review-phase resume, a retried phase, a second `start_build` — destroyed that
build's **uncommitted** source.

Two things made it look intermittent rather than systematic:

- **Committed work survived.** The branch ref is untouched; only the checked-out
  tree is deleted. A build that had committed recently lost nothing visible.
- **The Phase-1 mitigation does not reach here.**
  `buildSandboxCommitInFlightWorkCommand` — built for exactly this class of loss
  (BI-98B723C0) — only acts when a `build/*` branch is checked out **in
  /workspace**. Under isolation, /workspace sits on the client branch and the
  build's tree is at `.builds/<buildId>`, which that command never inspects. The
  protection was structurally bypassed by the isolation it was meant to
  complement.

## The fix

`buildSandboxWorktreeAddCommand` becomes resume-safe. The destructive recreate is
put behind a guard:

```sh
if [ -d $path ] && [ "$(git -C $path rev-parse --abbrev-ref HEAD 2>/dev/null)" = "$branchRef" ]; then
  <re-assert symlinks only>
else
  <remove --force; prune; add --force; symlinks>
fi
```

If the worktree is present **and** checked out on this build's own branch, it is
this build's live tree — reuse it. Recreate only when it is absent or has drifted
onto another branch, which is a stale/corrupt state where a reset is the right
answer.

Symlink creation moves from `ln -s` to `ln -sfn` so re-asserting links on an
already-provisioned worktree is a no-op instead of an error.

## Evidence

- `build-branch.test.ts`: the existing worktree test updated for `ln -sfn`, plus a
  new test asserting the guard shape — that the reuse branch contains no
  `worktree remove` / `worktree add`, and that both destructive commands sit
  behind the `else`. 26 tests green.
- Exercised end-to-end against a real git repo: create the worktree, add one
  committed file and one **uncommitted** file, re-run the identical command.
  Before: the uncommitted file is gone. After: both survive, and the symlink
  re-assert is clean.

## Addendum — part (c): the stripped ship error (same BI)

BI-8C6AA60E named three fixes. (a) is delegated to BI-53C14D19; (b) is the
worktree/branch preservation above. (c) is this: the release path should RETURN
the "no releasable source changes" domain error as a value rather than throw it.

`advanceBuildPhase` is a `"use server"` action. A thrown Server Action error has
its message stripped in production — the operator sees only a digest. That is why
FB-041879CD, which passed every gate, surfaced as an unexplained render error
(digest 200317269) instead of a readable explanation. Same class as #2758.

- `advanceBuildPhase` now returns `AdvanceBuildPhaseResult = {ok: true} | {ok: false; message}`.
  The **two** "no releasable source changes" states — build→review and review→ship —
  are returned as values. They are expected operational conditions the operator must
  read and act on.
- The other **nine** throws in the function are left alone. They are genuine
  invariant violations (missing sandbox, gate refusals); a digest is the correct
  operator experience there, and converting them would dilute the signal.
- `BuildStudioWorkflowActionCard` surfaces `outcome.message` via the existing
  `setError` path already used by `rerunPlanReview`.

Note the inline `export type AdvanceBuildPhaseResult = …` declaration is safe in a
`"use server"` module; it was the `export type { A, B }` **re-export** form that
broke SSR in #2758.

Evidence: 45 existing tests green; the two build-governed assertions converted from
`.rejects.toThrow` to a returned-value equality; one new UI regression test proving
the operator actually sees the message. `tsc --noEmit` clean across touched files.
