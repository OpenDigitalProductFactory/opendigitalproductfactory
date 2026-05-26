# Source Bootstrap Root Prisma Generate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the non-fatal Prisma CLI stack trace from source-volume bootstrap after production dependency installs.

**Architecture:** The Docker entrypoint already skips lifecycle scripts during source-volume dependency install and then runs Prisma generation explicitly. Under `NODE_ENV=production`, the Prisma CLI is present at the workspace root, so the explicit generation step should use `pnpm exec prisma generate --schema packages/db/prisma/schema.prisma` instead of the package-filtered command that expects package-local CLI links.

**Tech Stack:** Docker entrypoint shell, pnpm 10, Prisma 7, Node test runner.

---

### Task 1: Source-Volume Prisma Generation Command

**Files:**
- Modify: `docker-entrypoint.sh`
- Test: `scripts/lib/docker-entrypoint-source-volume.test.mjs`

- [ ] **Step 1: Write the failing test**

Update `scripts/lib/docker-entrypoint-source-volume.test.mjs` so `install_workspace_dependencies` must call:

```sh
pnpm exec prisma generate --schema packages/db/prisma/schema.prisma
```

and must not call:

```sh
pnpm --filter @dpf/db exec prisma generate
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node scripts/lib/docker-entrypoint-source-volume.test.mjs
```

Expected: the Prisma-generation assertion fails while the current entrypoint still uses the package-filtered command.

- [ ] **Step 3: Implement the minimal entrypoint change**

Change the explicit generation command in `docker-entrypoint.sh` to:

```sh
pnpm exec prisma generate --schema packages/db/prisma/schema.prisma 2>&1 || echo "  WARN prisma generate failed (non-fatal)"
```

- [ ] **Step 4: Run focused verification**

Run:

```powershell
node scripts/lib/docker-entrypoint-source-volume.test.mjs
sh -n docker-entrypoint.sh
```

Expected: the test passes and shell syntax validation exits 0.

- [ ] **Step 5: Deploy verification after merge**

Build the runner image, tag the same image as `dpf-portal-init:latest`, recreate `portal-init` and `portal`, then confirm the init logs no longer include `Cannot find module '/workspace/packages/db/node_modules/prisma/build/index.js'`.
