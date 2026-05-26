# Local Redeploy Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one local redeploy helper per shell that builds and recreates `portal-init` and `portal` together so manual rebuilds cannot leave the init image behind the app image.

**Architecture:** Keep `scripts/build-images.{ps1,sh}` as the build-only primitive. Add `scripts/redeploy-portal.{ps1,sh}` as the operator-safe workflow: resolve repo root, resolve the Docker Compose env file from an explicit argument or conventional install root, stamp `DPF_VERSION` from `git rev-parse HEAD`, build `portal` and `portal-init` together, recreate both services with `--no-build --force-recreate`, and fail if either resulting container does not carry the expected `/app/.dpf-image-version` marker. Update version-check drift guidance to point to the new helper.

**Tech Stack:** PowerShell 5.1, POSIX shell, Docker Compose, Node built-in test runner.

---

### Task 1: Redeploy Helper Contract

**Files:**
- Create: `scripts/lib/redeploy-portal.test.mjs`
- Create: `scripts/redeploy-portal.ps1`
- Create: `scripts/redeploy-portal.sh`
- Modify: `scripts/portal-version-check.ps1`
- Modify: `scripts/portal-version-check.sh`

- [ ] **Step 1: Write the failing test**

Create `scripts/lib/redeploy-portal.test.mjs` that asserts both helper scripts:

```text
1. stamp DPF_VERSION from git HEAD
2. resolve a Compose env file from `DPF_COMPOSE_ENV_FILE`, the checkout `.env`, or the conventional install `.env`
3. build portal and portal-init together
4. recreate portal-init and portal with --no-build --force-recreate
5. inspect both containers' `/app/.dpf-image-version` values, including the exited `portal-init` one-shot container
6. fail when either value differs from the build SHA
```

Also assert `portal-version-check` drift messages mention the new redeploy helper for the matching shell.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node scripts/lib/redeploy-portal.test.mjs
```

Expected: fail because `scripts/redeploy-portal.ps1` and `scripts/redeploy-portal.sh` do not exist yet.

- [ ] **Step 3: Implement the helpers**

Add `scripts/redeploy-portal.ps1` and `scripts/redeploy-portal.sh` with the workflow above. Keep output concise and use only ASCII.

- [ ] **Step 4: Update drift guidance**

Change `scripts/portal-version-check.ps1` and `scripts/portal-version-check.sh` so drift guidance points to `scripts/redeploy-portal.ps1` and `scripts/redeploy-portal.sh`.

- [ ] **Step 5: Run focused verification**

Run:

```powershell
node scripts/lib/redeploy-portal.test.mjs
docker run --rm -v "D:/DPF-local-redeploy-helper:/src" -w /src bash:5.2 bash -n scripts/redeploy-portal.sh
```

Expected: tests pass and shell syntax validation exits 0.
