# Source Bootstrap Ignore Lifecycle Scripts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make managed `/workspace` dependency refresh finish even when pnpm recreates `node_modules` and package lifecycle scripts would run before the dependency tree is stable.

**Architecture:** Keep dependency installation in `docker-entrypoint.sh`, but install workspace dependencies with lifecycle scripts disabled. The entrypoint already runs Prisma generation immediately after install, so the only required postinstall side effect remains explicit and ordered.

**Tech Stack:** POSIX shell, pnpm 10, Node's built-in test runner.

---

### Task 1: Skip Lifecycle Scripts During Source-Volume Install

**Files:**
- Modify: `docker-entrypoint.sh`
- Modify: `scripts/lib/docker-entrypoint-source-volume.test.mjs`

- [x] **Step 1: Write the failing test**

Add a regression test asserting that both `pnpm install` commands in `install_workspace_dependencies` include `--ignore-scripts`.

- [x] **Step 2: Run the focused test**

Run: `node --test scripts/lib/docker-entrypoint-source-volume.test.mjs`
Expected before implementation: FAIL, because the install commands do not yet disable lifecycle scripts.

- [x] **Step 3: Implement the minimal fix**

Add `--ignore-scripts` to both dependency-install commands in `install_workspace_dependencies`.

- [x] **Step 4: Verify locally and in Docker shell syntax**

Run: `node --test scripts/lib/docker-entrypoint-source-volume.test.mjs`
Run: `docker run --rm -v "${PWD}/docker-entrypoint.sh:/tmp/docker-entrypoint.sh:ro" alpine:3.20 sh -n /tmp/docker-entrypoint.sh`

- [ ] **Step 5: Ship and redeploy**

Run required CI, merge the PR, tag both Compose service images from the clean release build, force-recreate `portal-init` and `portal`, and verify health plus the Admin update UI.
