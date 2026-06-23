# Profession Corpus Image Packaging Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure production portal images include the profession registry and corpus markdown that seed the AI Workforce profession profiles and wiki pages.

**Architecture:** Keep `docs/professions/` as the single source of truth. The init/build stages already receive it; the runner stage must also copy it because `portal-init` runs the seed from the unified runner image. `.dockerignore` must re-include the corpus markdown, and a source-local Dockerfile packaging test must fail if either contract regresses.

**Tech Stack:** Dockerfile, `.dockerignore`, Node `node:test`.

---

### Task 1: Pin the Packaging Contract

**Files:**
- Modify: `scripts/lib/dockerfile-portal-build.test.mjs`

- [x] Add a failing test that requires the runner stage to copy `/app/docs/professions` into `/app/docs/professions`.
- [x] Add a failing test that requires `.dockerignore` to re-include `docs/professions/**/*.md`.
- [x] Refresh the stale builder assertion so the targeted Dockerfile test matches the current Next 16 default-builder Dockerfile.

### Task 2: Fix the Image Inputs

**Files:**
- Modify: `Dockerfile`
- Modify: `.dockerignore`

- [x] Copy `docs/professions` from the init stage into the runner image next to `docs/founder-kernel`.
- [x] Re-include profession corpus markdown in `.dockerignore` so the init-stage copy has the wiki pages, not only `registry.json`.

### Task 3: Verify

- [x] Run `node --test scripts/lib/dockerfile-portal-build.test.mjs`.
- [x] Run targeted profession/seed invariants if the worktree toolchain permits.
- [ ] Re-run live DB checks after a governed image refresh applies this source fix.
