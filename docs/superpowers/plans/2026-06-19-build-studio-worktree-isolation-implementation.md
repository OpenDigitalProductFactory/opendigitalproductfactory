# Build Studio per-build worktree isolation — implementation plan (BI-98B723C0 Phase 2)

- **Date:** 2026-06-19
- **Backlog item:** BI-98B723C0 (Phase 2)
- **Design:** [2026-06-19-build-studio-sandbox-isolation-design.md](../specs/2026-06-19-build-studio-sandbox-isolation-design.md) (#2109)
- **Operator decision (2026-06-19):** approach = **per-build `git worktree`** (preserve concurrency + true isolation), over serialization.
- **Status:** plan (Phase 1 commit-before-scrub already shipped: #2114).

## Scope (why this is a focused multi-step effort, not one PR)
Grepping the sandbox layer: **~124 `/workspace` / `WORKSPACE` references across ~30 files** assume a single shared working tree — every dispatcher (`opencode-dispatch.ts`, `codex-dispatch.ts`, `grok-dispatch.ts`, `claude-dispatch.ts`, `ideate-dispatch.ts`), `build-pipeline.ts`, `sandbox-verification.ts`, `sandbox.ts` (`execInSandbox`), `git-utils.ts`, `code-graph/git-snapshot.ts`, `pre-pr-gates.ts`, `build-project-context.ts`, `build-plan-paths.ts`. Per-build isolation means threading a **per-build working directory** through all of them.

## The hard part: node_modules (must be solved + live-tested first)
A `git worktree add /workspace/.builds/<id> build/<id>` checkout has **no `node_modules`** — it's gitignored, not in the tree — so `pnpm typecheck/build/test` and the `:3035` preview can't run there. Options, in order of preference:
1. **Symlink the install's node_modules into each worktree** (top-level `/workspace/node_modules` + the pnpm per-package `node_modules` symlink farms). Cheapest, but **Next/Turbopack has rejected cross-workspace symlinks before** — must be proven in the live sandbox before committing to it.
2. **Bind-mount a shared node_modules** into each worktree path (compose/infra change → operator go).
3. **`pnpm install` per worktree** — correct but slow/heavy; only if 1 and 2 fail.
**Step 0 of implementation is a spike:** create one worktree in the live sandbox, symlink node_modules, run `pnpm --filter web typecheck` + `next build` + a dev-server boot, and record which option works. Everything below depends on the answer.

## Phased implementation
- **P2.0 — node_modules spike** (live sandbox): prove the sharing approach. Output: chosen option + a `prepareWorktreeNodeModules(buildId)` helper.
- **P2.1 — worktree lifecycle** (`build-branch.ts`): `buildWorktreePath(buildId)`, `git worktree add`/`remove` command-builders, create in `startBuildBranch` (replacing the shared checkout), remove in `promoteBuildBranch`/`abandonBuildBranch`. Unit-test the command-builders (string assertions, as today).
- **P2.2 — thread the working dir**: replace the global `WORKSPACE` with a per-call workdir param across `execInSandbox` callers + the five dispatchers + `extractDiff`/`listSandboxCommitsAheadOfBase` + the verification gate. Mechanical but wide; do it dispatcher-by-dispatcher with the existing tests green at each step.
- **P2.3 — preview server**: bind `:3035` (or a small per-build port pool) to the active build's worktree.
- **P2.4 — cleanup + reaping**: `git worktree prune` + remove on completion/abandon; keep the `build/<id>` branch for audit.

## Verification (the BI-98B723C0 regression)
Run two builds **concurrently/interleaved** through the real sandbox; assert each `build/FB-*` branch contains **only its own files** and its committed code **survives a subsequent build start** (no cross-file contamination, no baseline reset). Plus the per-file unit tests at each step.

## Sequencing note
Land P2.0 + P2.1 first (foundation, low blast radius). P2.2 is the wide change — keep every existing sandbox test green at each dispatcher. Only after the concurrent-builds regression passes are the ~10 lost builds safe to re-build (the follow-on, on the slow local model). Phase 3 (durable `dpf/install` backing) is separate and needs the sandbox↔host wiring (operator go).
