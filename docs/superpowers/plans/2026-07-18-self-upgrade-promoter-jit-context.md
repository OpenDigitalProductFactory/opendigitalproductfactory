# Self-Upgrade Promoter JIT Context Fix Implementation Plan

> **For agentic workers:** REQUIRED: Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` for the completion gate, and `dpf-pr-with-dco` for delivery. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore automatic self-upgrade by keeping the portal-baked JIT promoter build context complete when `Dockerfile.promoter` gains required inputs.

**Architecture:** `Dockerfile.promoter` remains the source of truth for promoter build inputs. A repository contract test will verify that every local `COPY` source required by that Dockerfile is both baked into the portal's `/promoter/` directory and staged by `PROMOTER_JIT_BUILD_SCRIPT`; the production fix adds the five runtime-transition inputs currently omitted from both paths.

**Tech Stack:** Docker multi-stage builds, Node.js test runner, TypeScript/Vitest, POSIX shell.

---

## Chunk 1: Regression contract and fix

### Task 1: Prove the JIT context is incomplete

**Files:**
- Modify: `scripts/promoter-build-context.test.mjs`
- Read: `Dockerfile.promoter`
- Read: `Dockerfile`
- Read: `apps/web/lib/self-upgrade/promoter.ts`

- [x] Add a test that parses local `COPY` sources from `Dockerfile.promoter` and asserts each source is represented in both the portal `/promoter/` bake section and `PROMOTER_JIT_BUILD_SCRIPT` staging recipe.
- [x] Run `node --test scripts/promoter-build-context.test.mjs` and confirm it fails before production files change.

### Task 2: Restore the complete context

**Files:**
- Modify: `Dockerfile`
- Modify: `apps/web/lib/self-upgrade/promoter.ts`
- Test: `scripts/promoter-build-context.test.mjs`
- Test: `apps/web/lib/self-upgrade/promoter.test.ts`

- [x] Bake each runtime-transition script and installer validator/schema required by `Dockerfile.promoter` into the portal's `/promoter/` context, preserving their relative `scripts/` paths.
- [x] Update `PROMOTER_JIT_BUILD_SCRIPT` to stage the same files and directories into its temporary build context.
- [x] Run `node --test scripts/promoter-build-context.test.mjs` and confirm it passes.
- [x] Run `pnpm --filter web exec vitest run lib/self-upgrade/promoter.test.ts lib/queue/functions/self-upgrade.test.ts` and confirm it passes.

## Chunk 2: Verification and delivery

### Task 3: Verify the real build path

**Files:**
- Verify: `Dockerfile.promoter`
- Verify: `Dockerfile`
- Verify: `apps/web/lib/self-upgrade/promoter.ts`

- [x] Build the corrected promoter context using an isolated Docker tag.
- [x] Confirm `docker build -f Dockerfile.promoter -` succeeds with the complete context.
- [x] Run `pnpm --filter web typecheck` and the production build from the compile-ready worktree.

### Task 4: Publish the fix

**Files:**
- Commit the files above with DCO sign-off.

- [x] Review the final diff for one-concern scope and retained user changes.
- [ ] Commit with `git commit -s`.
- [ ] Push `fix/self-upgrade-promoter-build`.
- [ ] Open a ready-for-review PR against `main` with reproduction and verification evidence.
- [ ] Monitor required checks and address any failures before handoff.
