# Build Studio sandbox isolation — per-build worktrees + durable commit (BI-98B723C0)

- **Date:** 2026-06-19
- **Status:** design (pre-implementation)
- **Backlog item:** BI-98B723C0
- **Epic:** EP-BUILD-STUDIO (relates to EP-WORKTREE-HYGIENE / tiered-dev-loop-isolation)
- **Why now:** the review-gate fixes (#2077, #2085) make a build reach ship-ready, but the sandbox destroys the artifact before it lands — so this is the keystone that converts the repaired pipeline into one that *durably* delivers.

## 1. Problem (evidence, 2026-06-19 live install)

The Build Studio sandbox (`dpf-sandbox-1`) runs **one shared git working tree at `/workspace`** across all in-flight builds. Builds interleave in that single tree, so:
- **Cross-contamination:** `build/FB-FD850A2C` (truncateMiddle) HEAD is a "sandbox baseline" commit `a7502e49` that contains **FB-69231490's** files (`semanticIdClassifier.ts/.test.ts/index.ts`) — one build's work committed onto another's branch.
- **Uncommitted-work loss:** `build/FB-69231490` HEAD is a baseline commit with **no code** — its 3 completed tasks lived in the working tree and were scrubbed.
- Result: of ~12 in-flight builds, only **truncateMiddle** delivered (BI-9271F746/#2096) — recoverable only because its code was read out before contamination. The rest must be re-built.

Refuted hypotheses (checked, not the cause): container recreation on self-upgrade (sandbox `/workspace` is a persistent volume `dpf_sandbox_workspace`, branches survive); the `refreshCurrentBranchFromTarget` hard-reset (only fires when `aheadBy===0`, i.e. a branch with no own commits — `classifySandboxSourceCurrency` classifies a build branch *with* commits as `ahead`/`diverged`, not `behind`).

## 2. Root cause

`startBuildBranch` (`apps/web/lib/integrate/sandbox/build-branch.ts`) operates on the **single shared `/workspace` checkout**: it scrubs (`git reset --hard HEAD && git clean -fd`), checks out the client branch, then the build branch — all in one tree. When builds interleave (concurrent dispatch, resume-on-boot, preview switches), one build's uncommitted output is present in the tree when another build's baseline/commit runs, and the scrub discards whatever wasn't committed. The agentic loop does commit per task (`build-pipeline.ts stepComplete` records `diffPatch`/`gitCommitHashes` from a multi-commit branch), but the **window between generation and commit, and the shared tree, are unsafe**.

## 3. Design — three phases (1+2 in-sandbox, no host wiring; 3 needs infra)

### Phase 1 — Reliable commit + non-destructive switch (cheapest; lands first)
- **Commit-before-switch:** before `startBuildBranch` scrubs/switches away from the current build branch, commit (or stash onto its own branch) any uncommitted working-tree changes belonging to that build. Never `git clean -fd` away another build's ungathered output.
- **Commit-per-task guard:** ensure `stepGenerateCode` commits each task's file edits to `build/<buildId>` immediately (assert a commit was produced when files changed; fail loud otherwise). This removes the "generation done but uncommitted" window.
- Does NOT fix contamination, but removes the dominant *loss* path (the FB-69231490 case).

### Phase 2 — Per-build worktree isolation (the real fix)
- Replace the shared single-checkout model with a **`git worktree` per build**: `git worktree add /workspace/.builds/<buildId> build/<buildId>`. Each build gets its own working directory, backed by the shared `/workspace/.git` object store (cheap; no full clone).
- Point every sandbox operation at the build's worktree dir: `run_sandbox_command`, the opencode/codex dispatch cwd, the typecheck/build/test gate, `extractDiff`. They take a per-build working dir instead of the global `/workspace`.
- Preview server (`:3035`): serve the **active** build's worktree (or allocate a per-build port from a small pool). Build Studio already shows "driving: FB-…"; bind the preview to that worktree.
- Cleanup: `git worktree remove` on completion/abandon; the `build/<buildId>` branch persists for audit (as today).
- Outcome: builds cannot see or clobber each other's working trees → no cross-contamination, no shared-tree scrub loss.

### Phase 3 — Durable off-box backing on `dpf/install` (operator-surfaced; needs wiring)
- Add the host local git (`dpf/install`, `~/.dpf/install/` — the self-upgrade substrate; see `2026-06-18-local-git-and-private-public-segregation-analysis.md`) as a **second remote** in the sandbox, and push `build/<buildId>` to it after each task/phase. Build work then has a durable home that survives even total `/workspace` loss.
- Wiring constraint: the toolchain runs **in the sandbox container** while `dpf/install` is **host-side** — the sandbox must reach it via a bind-mount of `~/.dpf/install/` or a git remote/daemon. This is an **infra/compose change → requires operator go** (per the Docker-change rule). Phase 1+2 do not depend on it.

## 4. Phasing / risk
- **Phase 1** — small, surgical, in `build-branch.ts` + `build-pipeline.ts`; unit-testable; highest loss-reduction per unit risk. Land first.
- **Phase 2** — the structural fix; touches the sandbox exec/preview surfaces; medium, needs the worktree-path threading + a concurrent-builds integration test.
- **Phase 3** — infra; gated on operator go for the mount/remote; turns durability from "survives scrub" to "survives box loss."

## 5. Verification
- Unit: `startBuildBranch` does not `git clean` uncommitted work belonging to another build; `stepGenerateCode` produces a commit when files changed.
- Integration (the regression that proves BI-98B723C0): run two builds **concurrently/interleaved**, assert each `build/FB-*` branch contains **only its own files** and its committed code **survives a subsequent build start** (no baseline reset of committed work, no cross-file contamination).

## 6. Out of scope
- The shared-sandbox *contention/throughput* (one runtime, model-swap) — separate (EP-WORKTREE-HYGIENE / local-endpoint throughput).
- Re-building the ~10 already-lost builds — a follow-on once this lands (their code is gone; they re-run through the now-safe pipeline).
