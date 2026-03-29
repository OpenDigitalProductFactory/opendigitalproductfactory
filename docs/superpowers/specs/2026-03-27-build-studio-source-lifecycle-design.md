# EP-SELF-DEV-005: Build Studio Source Lifecycle — Container Source, Contribution Modes & Platform Updates

**Date:** 2026-03-27
**Status:** Draft
**Author:** Mark Bodman (CEO) + Claude (design partner)
**Epic ID:** EP-SELF-DEV-005
**IT4IT Alignment:** §5.5 Release Value Stream — Service Offer Definition, §5.2 Portfolio Management (governance configuration)

**Predecessor specs:**

- `2026-03-17-development-lifecycle-architecture-design.md` — git integration foundation
- `2026-03-26-hive-mind-contribution-assessment-design.md` — assess_contribution + contribute_to_hive (built)
- `2026-03-22-open-source-readiness-design.md` — Apache-2.0 + DCO model

---

## Problem Statement

The Build Studio development lifecycle was designed assuming a technical user running the portal locally with `pnpm dev`. For non-technical users who run everything from a Docker image:

1. **No source code in the container** — `propose_file_change` fails with "Codebase access is only available on dev instances" because the Docker runner stage contains only compiled output, not TypeScript source.

2. **No contribution governance** — There is no platform-level policy for how Build Studio changes should be handled after shipping. The `assess_contribution` and `contribute_to_hive` tools exist but operate without any platform context about the organisation's chosen contribution posture.

3. **No update path** — When a new DPF image is released, users have no way to reconcile their Build Studio modifications with the new upstream source. Changes in the volume and changes in the image cannot be merged without git knowledge.

4. **Confusing Docker naming** — Container names (`dpf-portal-1`, `sandbox-2`) and volume names (`pgdata`, `sandbox_workspace_2`) are developer-centric and opaque to non-technical users managing the platform via Docker Desktop.

5. **Over-provisioned sandboxes** — Three sandbox containers are pre-warmed by default despite the target audience being small organisations unlikely to run concurrent builds.

---

## Design Summary

Four coordinated changes that together give non-technical Docker-only users a complete Build Studio development lifecycle:

```text
Docker Image
  └── Source code bundled at /app/apps/web-src/ and /app/packages-src/
        ↓ first start (portal-init)
  dpf-source-code volume at /workspace
  (git repo: dpf-upstream branch + my-changes branch)
        ↓
  Build Studio builds → propose_file_change → git commit to my-changes
        ↓ ship phase
  Mode-aware contribution (PlatformDevConfig)
  fork_only | selective | contribute_all
        ↓ new image pulled
  AI coworker-led merge (apply_platform_update)
```

---

## Section 1: Container Architecture

### 1.1 Source Code in the Runner Image

The `runner` stage of the Dockerfile is extended to include the full TypeScript source alongside the existing compiled output.

**Dockerfile additions to the runner stage:**

```dockerfile
# Source for Build Studio — copied to -src paths to avoid collision with standalone output
# Note: /app/apps/web/ and /app/packages/ are occupied by the standalone NFT output.
# The -src suffix paths are guaranteed free.
COPY --from=build /app/apps/web/ ./apps/web-src/
COPY --from=build /app/packages/ ./packages-src/

# Version file baked in at build time — see Section 1.2 for injection method
ARG DPF_VERSION=dev
RUN echo "$DPF_VERSION" > /app/.dpf-image-version
```

The `DPF_VERSION` build arg is passed at image build time: `docker build --build-arg DPF_VERSION=1.3.0 ...`. In CI/CD, this is the release tag. For local builds, it defaults to `dev`. The file must contain only `[0-9a-zA-Z._-]` — the bootstrap script validates this before use.

**`INSTANCE_TYPE=dev`** is moved from `docker-compose.override.yml` to the portal service in `docker-compose.yml` directly, since source is now always present in the image. The override entry added on 2026-03-26 is removed.

### 1.2 Named Volume: dpf-source-code

A new named volume `dpf-source-code` is declared in `docker-compose.yml` and mounted at `/workspace` in the portal service. `PROJECT_ROOT=/workspace` is set in the portal service environment.

**Bootstrap runs in `portal-init`** (the existing init container), not the portal itself. This is important: `portal-init` already has a guaranteed DB connection (Postgres is healthy before `portal-init` runs). The portal's own entrypoint does not touch the DB — all init logic lives in `portal-init`.

**Bootstrap script addition to `docker-entrypoint.sh`** (runs in `portal-init`):

```sh
# ── Source volume bootstrap ──────────────────────────────────────────────────
WORKSPACE=/workspace
IMAGE_VERSION=$(cat /app/.dpf-image-version | tr -cd '[:alnum:]._-')

if [ ! -f "$WORKSPACE/.dpf-version" ]; then
  echo "[init] Bootstrapping source volume from image version $IMAGE_VERSION..."

  # Copy source from image to volume
  mkdir -p "$WORKSPACE/apps/web" "$WORKSPACE/packages"
  cp -r /app/apps/web-src/. "$WORKSPACE/apps/web/"
  cp -r /app/packages-src/. "$WORKSPACE/packages/"
  cp /app/pnpm-workspace.yaml "$WORKSPACE/" 2>/dev/null || true
  cp /app/package.json "$WORKSPACE/" 2>/dev/null || true

  # Initialise git — force-create branches to be idempotent on partial failure
  cd "$WORKSPACE"
  git init -b dpf-upstream
  git config user.email "build-studio@dpf.local"
  git config user.name "DPF Build Studio"
  git add -A
  git commit -m "chore: bootstrap from dpf-image v${IMAGE_VERSION}"
  # -B force-creates or resets the branch — safe on re-run after partial failure
  git checkout -B my-changes

  # Write version sentinel last — if anything above failed, this file is absent
  # and the entire block re-runs on next start (idempotent due to -B and git init)
  echo "$IMAGE_VERSION" > "$WORKSPACE/.dpf-version"
  echo "[init] Source volume bootstrapped."
fi

# ── Platform update detection ────────────────────────────────────────────────
VOLUME_VERSION=$(cat "$WORKSPACE/.dpf-version" 2>/dev/null || echo "unknown")

if [ "$IMAGE_VERSION" != "$VOLUME_VERSION" ] && [ -f "$WORKSPACE/.dpf-version" ]; then
  echo "[init] Platform update detected: $VOLUME_VERSION -> $IMAGE_VERSION"
  # Use tsx (already available in portal-init) to upsert via Prisma — no psql needed
  pnpm --filter @dpf/db exec tsx -e "
    const { prisma } = require('./src/client');
    prisma.platformDevConfig.upsert({
      where: { id: 'singleton' },
      update: { updatePending: true, pendingVersion: '$IMAGE_VERSION' },
      create: { id: 'singleton', updatePending: true, pendingVersion: '$IMAGE_VERSION' }
    }).then(() => prisma.\$disconnect());
  "
fi
```

**Idempotency guarantees:**

- `git init` on an already-initialised repo is a no-op
- `git checkout -B dpf-upstream` force-creates or resets — safe on re-run
- `git checkout -B my-changes` force-creates or resets — safe on re-run
- `.dpf-version` is written last — if any step fails, the file is absent and the entire block re-runs cleanly on next start

**Subsequent starts:** volume source is used as-is. Git history and user modifications are preserved.

**`getProjectRoot()`** in `codebase-tools.ts` already reads `process.env.PROJECT_ROOT` (implemented 2026-03-26). With `PROJECT_ROOT=/workspace` set in the portal service, all codebase tools resolve to `/workspace`.

### 1.3 Fix: git-utils.ts Must Respect PROJECT_ROOT at Call Time

`git-utils.ts` currently resolves its `PROJECT_ROOT` constant at **module load time**:

```typescript
const PROJECT_ROOT = resolve(process.cwd(), "..", "..");  // resolves to "/" in Docker
```

This is a blocker. All git operations (`commitFile`, `isGitAvailable`, `gitLog`, etc.) will target the root filesystem, not `/workspace`. The fix is required as part of this epic (backlog item 005-002):

```typescript
// Replace the module-level constant with a call-time function
function getGitRoot(): string {
  return process.env.PROJECT_ROOT
    ? resolve(process.env.PROJECT_ROOT)
    : resolve(process.cwd(), "..", "..");
}
```

Every reference to `PROJECT_ROOT` in `git-utils.ts` is replaced with `getGitRoot()`.

### 1.4 Container and Volume Naming

All service and volume names are updated to plain English for non-technical users managing the platform via Docker Desktop.

**`container_name` additions in `docker-compose.yml`:**

| Service | `container_name` |
| --- | --- |
| `portal` | `DPF - App` |
| `portal-init` | `DPF - Setup` |
| `postgres` | `DPF - Database` |
| `neo4j` | `DPF - Knowledge Graph` |
| `qdrant` | `DPF - AI Memory` |
| `sandbox` | `DPF - Build Studio` |

**Volume renames in `docker-compose.yml`:**

| Old name | New name |
| --- | --- |
| `pgdata` | `dpf-database` |
| `neo4jdata` | `dpf-knowledge-graph` |
| `qdrant_data` | `dpf-ai-memory` |
| `sandbox_workspace` | `dpf-build-studio` |
| *(new)* | `dpf-source-code` |

**Important:** `fresh-install.ps1` generates bind-mount paths for `pgdata`, `neo4jdata`, and `qdrant_data` in the override file. The volume rename must be applied in `fresh-install.ps1`'s `$overrideContent` generation as well, so regenerated overrides use the new names.

**Image labels** (`Dockerfile` and `Dockerfile.sandbox`):

```dockerfile
LABEL org.opencontainers.image.title="Open Digital Product Factory"
LABEL org.opencontainers.image.description="Self-developing digital product management platform"
```

```dockerfile
LABEL org.opencontainers.image.title="DPF Build Studio Environment"
LABEL org.opencontainers.image.description="Isolated code execution environment for Build Studio. One slot per concurrent build."
```

### 1.5 Sandbox Pool Reduction

The default sandbox pool is reduced from 3 to 1. `sandbox-2` and `sandbox-3` services and their volumes are removed from `docker-compose.yml`. `DPF_SANDBOX_POOL_SIZE` remains configurable for organisations that need concurrent builds.

**Removed from `docker-compose.yml`:** `sandbox-2`, `sandbox-3`, `sandbox_workspace_2`, `sandbox_workspace_3`.

**`build-pipeline.ts`:** The fallback reference `"dpf-sandbox-1"` is updated to `"DPF - Build Studio"`.

**`sandbox-pool.ts`:** `getPoolConfig()` currently generates container IDs as `dpf-sandbox-${i + 1}`. This must be updated to use the new naming convention. For pool size 1 (default), slot 0 → `"DPF - Build Studio"`. For `DPF_SANDBOX_POOL_SIZE > 1`, slots use `"DPF - Build Studio 2"`, `"DPF - Build Studio 3"`, etc., with matching `container_name` entries in `docker-compose.yml`. The implementer must update `getPoolConfig()` before the `container_name` change takes effect, or builds will fail to find the sandbox container.

---

## Section 2: Contribution Mode Configuration

### 2.1 Permissions

A new capability `manage_platform` is added to `apps/web/lib/permissions.ts`:

```typescript
manage_platform: { roles: ["HR-000"] }
```

This must be added before any code references it — the TypeScript compiler will reject the string literal `"manage_platform"` against the `CapabilityKey` union if it does not exist. Backlog item 005-005 includes this change.

### 2.2 Schema

New model in `packages/db/prisma/schema.prisma`:

```prisma
model PlatformDevConfig {
  id                String    @id @default("singleton")
  contributionMode  String    @default("selective")
  // Values: "fork_only" | "selective" | "contribute_all"
  gitRemoteUrl      String?   // Reserved for future git push capability
  updatePending     Boolean   @default(false)
  pendingVersion    String?
  configuredAt      DateTime  @default(now())
  configuredById    String?
  configuredBy      User?     @relation(fields: [configuredById], references: [id])
}
```

Singleton pattern — one row, `id` always `"singleton"`. Safe to upsert. Note: a `PlatformConfig` key-value model already exists in the schema — `PlatformDevConfig` is a distinct, typed model for development governance specifically.

### 2.3 Server Action

All writes to `PlatformDevConfig` use a Server Action (consistent with the existing pattern in the codebase). New file: `apps/web/lib/actions/platform-dev-config.ts`.

```typescript
export async function savePlatformDevConfig(mode: "fork_only" | "selective" | "contribute_all") {
  // requireCapability("manage_platform") guard
  // prisma.platformDevConfig.upsert(...)
}
```

No API route is created for this.

### 2.4 Admin UI — Platform Development Tab

New tab in the Admin section, visible only to HR-000.

**Route:** `/admin/platform-development`

Three plain-language radio options:

> **How do you want to manage your customisations?**
>
> ◉ **Keep everything here**
> Changes you make in Build Studio stay on your platform only. Nothing is shared externally.
>
> ○ **Share selectively**
> The AI coworker will suggest which changes might benefit the wider community. You decide each time.
>
> ○ **Share everything**
> Contribute all changes back to the community by default. You can still keep individual ones private.

A "Save" button calls the `savePlatformDevConfig` Server Action. The saved choice is shown with the date and name of who set it.

**`AdminTabNav.tsx`** gains a "Platform Development" entry, gated by `manage_platform` capability.

### 2.5 First-Run Gate

Build Studio is disabled (grayed out, tooltip: "Platform Development requires setup by your administrator") until `PlatformDevConfig` exists in the DB. This prompts HR-000 to make the governance decision before any builds run.

**Onboarding checklist:** The first-run onboarding step list in `apps/web/lib/actions/setup-constants.ts` gains a `"platform-development"` step. This is a **code change** to `SETUP_STEPS`, `STEP_ROUTES`, and `STEP_LABELS` in that file — not configuration. The step is inserted after the existing admin steps and before Build Studio is enabled. The implementer must also create the step's route page at `apps/web/app/(shell)/admin/platform-development/setup/page.tsx` consistent with the existing setup wizard pattern.

### 2.6 Capability Gate

`/admin/platform-development` and the `apply_platform_update` tool both require `manage_platform`. Any other role receives a 403 from the route and a capability error from the tool executor.

---

## Section 3: Mode-Aware Ship Phase

### 3.1 Context Injection

When the Build Studio ship phase starts, `PlatformDevConfig.contributionMode` is loaded and injected into the ship phase system prompt:

```typescript
const devConfig = await prisma.platformDevConfig.findUnique({ where: { id: "singleton" } });
const contributionMode = devConfig?.contributionMode ?? "selective";
// Added to system prompt context: `Platform contribution mode: ${contributionMode}`
```

No new tools are required. The existing `assess_contribution` and `contribute_to_hive` tools handle all three modes.

### 3.2 Ship Phase Prompt Replacement

**This is a replacement, not an addition.** The existing `ship` phase prompt in `build-agent-prompts.ts` unconditionally calls `assess_contribution` with `selective` mode behaviour hardcoded. The entire prompt is replaced with the mode-aware version below.

**Mode-aware ship phase prompt block:**

```text
Platform contribution mode: {contributionMode}

STEP 1: deploy_feature
STEP 2: register_digital_product
STEP 3: create_build_epic

STEP 4 — contribution (depends on mode):

If mode is "fork_only":
  - Do NOT call assess_contribution or contribute_to_hive
  - Confirm build complete and changes are saved locally
  - End the conversation

If mode is "selective":
  - Call assess_contribution
  - Present the full assessment and recommendation to the user
  - Offer [Keep local] and [Contribute] — wait for user choice
  - Call contribute_to_hive only if user explicitly chooses to contribute
  - End the conversation

If mode is "contribute_all":
  - Call assess_contribution
  - Present the assessment — indicate contribution is the default
  - Offer [Contribute ✓] as primary and [Keep this one local] as secondary
  - Call contribute_to_hive unless user explicitly chooses to keep local
  - End the conversation
```

### 3.3 Ship Phase Behaviour by Mode

**`fork_only`**

```text
deploy_feature → register_digital_product → create_build_epic
  ↓
Build complete. Changes committed to local git (dpf-source-code volume).
No assessment. No contribution prompt.
```

**`selective`**

```text
deploy_feature → register_digital_product → create_build_epic
  ↓
assess_contribution (automatic)
  ↓
[Keep local]              [Contribute]
     ↓                         ↓
Build complete.         contribute_to_hive (FeaturePack + DCO)
                        Build complete.
```

**`contribute_all`**

```text
deploy_feature → register_digital_product → create_build_epic
  ↓
assess_contribution (automatic)
  ↓
[Actually, keep this one]       [Contribute ✓]
         ↓                            ↓
   Build complete.            contribute_to_hive (FeaturePack + DCO)
                               Build complete.
```

---

## Section 4: AI-Assisted Platform Update

### 4.1 Update Notification

When `PlatformDevConfig.updatePending = true`, HR-000 sees a dismissible banner:

> **Platform update v{pendingVersion} is ready.**
> Your customisations are preserved. Review in Admin → Platform Development.

Banner links to `/admin/platform-development`.

### 4.2 New Tool: apply_platform_update

```typescript
name: "apply_platform_update"
description: "Merge the new platform version into your customised source. Returns a clean merge or a list of conflicts for the AI coworker to resolve with you."
inputSchema: { type: "object", properties: {} }
requiredCapability: "manage_platform"
sideEffect: true
```

**Process:**

0. **Check for in-progress merge first:** If `/workspace/.git/MERGE_HEAD` exists, the workspace is already mid-merge from a previous interrupted run. Skip steps 1–3 and jump directly to step 4 (return existing conflict list). The AI coworker surfaces: "A merge is already in progress. Let's continue resolving the remaining conflicts, or you can abort and start again."

1. Read `PlatformDevConfig.pendingVersion`
2. Validate version string: `[0-9a-zA-Z._-]` only
3. In `/workspace` git repo:
   - `git checkout dpf-upstream`
   - Copy new source from `/app/apps/web-src/` and `/app/packages-src/`
   - `git add -A && git commit -m "chore: dpf-upstream v{pendingVersion}"`
   - `git checkout my-changes`
   - `git merge dpf-upstream --no-commit --no-ff`
4. Check result:
   - **Clean:** `git commit -m "chore: merge dpf v{pendingVersion}"` → update `.dpf-version` → set `updatePending = false` → return `{ clean: true, filesUpdated: N }`
   - **Conflicts:** Parse `git diff --name-only --diff-filter=U` for conflicted files. For each, read the conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) from the file to extract `upstreamChange` (their side) and `localChange` (our side). Return `{ clean: false, conflicts: [{ file, upstreamChange, localChange }] }`. Leave merge in progress.

**Conflict resolution:** The AI coworker presents each conflict in plain language using `propose_file_change` to write the resolved version. After all conflicts are resolved, it runs a final `git commit` to complete the merge and updates `.dpf-version`.

Example AI coworker message for a conflict:
> "The platform update changed `apps/web/components/ProductList.tsx` to add a new filter. You also modified this file in Build Studio to change the layout. Here's what each side did — what would you like to keep?"
>
> [Keep mine] [Take theirs] [Show me both — I'll decide]

### 4.3 Out of Scope for This Epic

- **Rollback** — future safety feature. Users with a broken merge must restore from a Docker volume backup.
- **Changelog** — surfacing what the new version adds. Future enhancement.
- **Push to remote** — git push and GitHub PR creation. The `gitRemoteUrl` field in `PlatformDevConfig` is reserved.

---

## What Already Exists (No Changes Required)

| Component | Status |
| --- | --- |
| `assess_contribution` tool | Built — `mcp-tools.ts` |
| `contribute_to_hive` tool | Built — `mcp-tools.ts` |
| `FeaturePack` schema model | Built — `schema.prisma` |
| DCO attestation | Built — `contribute_to_hive` handler |
| `propose_file_change` tool | Built — `mcp-tools.ts` |
| `commitFile()` in git-utils.ts | Built — auto-commits on `propose_file_change` approval |
| `isDevInstance()` check | Built — `codebase-tools.ts` |
| `PROJECT_ROOT` env var in `getProjectRoot()` | Built — `codebase-tools.ts` (added 2026-03-26) |

---

## New Backlog Items

Dependencies are explicit: items marked *(needs X)* cannot start until X is merged and deployed.

| ID | Title | Type | Priority | Depends on |
| --- | --- | --- | --- | --- |
| EP-SELF-DEV-005-001 | Add source + version file to Dockerfile runner stage | portfolio | 1 | — |
| EP-SELF-DEV-005-002 | Bootstrap dpf-source-code volume in portal-init; fix git-utils.ts PROJECT_ROOT | portfolio | 2 | 005-001 |
| EP-SELF-DEV-005-003 | Rename containers, volumes, image labels; update fresh-install.ps1 | portfolio | 3 | — |
| EP-SELF-DEV-005-004 | Reduce sandbox pool to 1; update sandbox-pool.ts + build-pipeline.ts naming | portfolio | 4 | 005-003 |
| EP-SELF-DEV-005-005 | Add manage_platform capability to permissions.ts; PlatformDevConfig schema + migration | portfolio | 5 | — |
| EP-SELF-DEV-005-006 | Admin → Platform Development tab + savePlatformDevConfig Server Action | portfolio | 6 | 005-005 |
| EP-SELF-DEV-005-007 | First-run gate: disable Build Studio until mode configured; add setup-constants.ts step | portfolio | 7 | 005-005, 005-006 |
| EP-SELF-DEV-005-008 | Inject contribution mode into ship phase context | portfolio | 8 | 005-005 |
| EP-SELF-DEV-005-009 | Replace ship phase prompt in build-agent-prompts.ts with mode-aware version | portfolio | 9 | 005-008 |
| EP-SELF-DEV-005-010 | apply_platform_update tool; update pending detection in portal-init | portfolio | 10 | 005-001, 005-002, 005-005 |
| EP-SELF-DEV-005-011 | Update pending notification banner for HR-000 | portfolio | 11 | 005-005, 005-010 |

---

## Not in Scope

- `gitPush()` implementation
- GitHub / GitLab API integration for PR creation
- Community feature registry (browse, install, rate FeaturePacks)
- Automated merge without user input
- Rollback tooling
- Changelog surfacing on update
