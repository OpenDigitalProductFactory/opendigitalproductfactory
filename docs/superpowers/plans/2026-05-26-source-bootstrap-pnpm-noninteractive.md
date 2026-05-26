# Source Bootstrap pnpm Noninteractive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the portal init container from failing when it refreshes a managed `/workspace` that already has a `node_modules` tree.

**Architecture:** The source-volume bootstrap remains in `docker-entrypoint.sh`; dependency installation is the only behavior that changes. The fix makes the existing `pnpm install` commands explicitly non-interactive instead of relying on a TTY or manual cleanup.

**Tech Stack:** POSIX shell, pnpm 10, Node's built-in test runner.

---

### Task 1: Make Workspace Dependency Install Noninteractive

**Files:**
- Modify: `docker-entrypoint.sh`
- Modify: `scripts/lib/docker-entrypoint-source-volume.test.mjs`

- [x] **Step 1: Write the failing test**

Add a regression test asserting that `install_workspace_dependencies` passes `--config.confirmModulesPurge=false` to both the frozen install and fallback install.

- [x] **Step 2: Run the focused test**

Run: `node --test scripts/lib/docker-entrypoint-source-volume.test.mjs`
Expected before implementation: FAIL, because the install commands do not yet include the pnpm noninteractive purge config.

- [x] **Step 3: Implement the minimal fix**

Update both `pnpm install` calls in `install_workspace_dependencies` to include `--config.confirmModulesPurge=false`.

- [x] **Step 4: Verify locally**

Run: `node --test scripts/lib/docker-entrypoint-source-volume.test.mjs`
Run: `docker run --rm -v "${PWD}/docker-entrypoint.sh:/tmp/docker-entrypoint.sh:ro" alpine:3.20 sh -n /tmp/docker-entrypoint.sh`

- [ ] **Step 5: Ship and redeploy**

Run the affected CI gates, open the PR, merge after green checks, rebuild the portal image, restart the portal service, and verify the live update flow.
