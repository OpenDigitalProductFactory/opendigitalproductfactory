# Sandbox Worktree Isolation Default-On

## Backlog

- `BI-410024ED` - Shared-sandbox posture decision plus default-on per-build worktree isolation.

## Design Grounding

- Existing specs/plans reviewed:
  - `docs/superpowers/specs/2026-06-19-build-studio-sandbox-isolation-design.md`
  - `docs/superpowers/plans/2026-06-19-build-studio-worktree-isolation-implementation.md`
  - `docs/superpowers/specs/2026-06-19-unified-build-studio-tracking-all-surfaces-design.md`
- Current code substrate reviewed:
  - `apps/web/lib/integrate/sandbox/build-branch.ts`
  - `apps/web/lib/integrate/sandbox/build-branch.test.ts`
  - `docker-compose.yml` portal and sandbox environment contracts.
- Source of truth:
  - `resolveBuildWorkdir(buildId)` is the single routing decision for per-build file operations. Build branch lifecycle remains in `/workspace`; build work runs under `/workspace/.builds/<buildId>` when isolation is enabled.
- Decision:
  - Per-build worktree isolation is now the default sandbox posture. `DPF_BUILD_WORKTREE_ISOLATION=0` remains an emergency rollback switch for the old shared-checkout behavior.

## Plan

1. Invert the unit contract so unset `DPF_BUILD_WORKTREE_ISOLATION` resolves to the per-build worktree.
2. Keep explicit `DPF_BUILD_WORKTREE_ISOLATION=0` as the rollback path to `/workspace`.
3. Pass `DPF_BUILD_WORKTREE_ISOLATION: ${DPF_BUILD_WORKTREE_ISOLATION:-1}` through the canonical compose portal and sandbox services.
4. Verify the focused sandbox tests, typecheck, compose rendering, and policy gates.
