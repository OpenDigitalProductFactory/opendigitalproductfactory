# EP-SELF-DEV-002: Sandbox Execution & Database Isolation

## Problem Statement

The Build Studio pipeline works through Ideate → Plan → Build phases. The sandbox Docker container launches (`dpf-sandbox` image, `sleep infinity`, port mapped), but execution fails because:

1. **Empty workspace** — The container starts with an empty `/workspace`. No project code, no dependencies, no Prisma client. The coding agent writes generated files into a void.
2. **No database** — The sandbox has no database access. Features requiring Prisma schema changes can't be built. The sandbox can't use the production DB (schema drift, data corruption risk to users).
3. **Fire-and-forget execution** — `autoExecuteBuild` calls `executeBuildPlan` with no recovery. If any step fails, the build sits in "build" phase forever with no visibility into what broke.
4. **No migration promotion** — `extractDiff` captures file changes but doesn't handle database migrations. No safety net for applying schema changes to production.

### What Already Exists

- **`Dockerfile.sandbox`** — `node:20-alpine` with git, pnpm, `CMD sleep infinity`
- **`sandbox.ts`** — Container lifecycle: create, start, exec, logs, diff extraction, destroy
- **`coding-agent.ts`** — Code generation prompt builder, `executeBuildPlan`, test runner
- **`actions/build.ts`** — `autoExecuteBuild` (fire-and-forget), phase transitions, evidence storage
- **`docker-compose.yml`** — Production postgres, neo4j, qdrant, ollama, portal services
- **FeatureBuild schema** — buildExecState not yet present, PromotionBackup model not yet present

---

## Design

### Section 1: Sandbox Database Stack

Each sandbox gets its own ephemeral database containers — complete process isolation from production. No shared postgres processes, no schema cross-contamination, no risk to production data or users.

**Containers per sandbox:**

| Container | Image | Purpose | Resources |
|-----------|-------|---------|-----------|
| `dpf-sandbox-{buildId}` | `dpf-sandbox` | App (existing) | 4096MB, 2 CPU |
| `dpf-sandbox-db-{buildId}` | `postgres:16-alpine` | Isolated Prisma database | 512MB, 1 CPU |
| `dpf-sandbox-neo4j-{buildId}` | `neo4j:5-community` | Isolated graph database | 512MB, 1 CPU |
| `dpf-sandbox-qdrant-{buildId}` | `qdrant/qdrant:latest` | Isolated vector store | 256MB, 0.5 CPU |

Total per sandbox stack: ~5.3GB memory. Reasonable for a dev workstation.

**Docker networking:**

All 4 containers join a shared Docker network `dpf-sandbox-net-{buildId}`. The app container receives environment variables pointing to its sandbox-local databases:

```
DATABASE_URL=postgresql://dpf:dpf_sandbox@dpf-sandbox-db-{buildId}:5432/dpf
NEO4J_URI=bolt://dpf-sandbox-neo4j-{buildId}:7687
QDRANT_INTERNAL_URL=http://dpf-sandbox-qdrant-{buildId}:6333
```

**Lifecycle:**

1. Create Docker network `dpf-sandbox-net-{buildId}`
2. Create + start all 4 containers on that network
3. Wait for postgres healthcheck (`pg_isready`, up to 30s)
4. Run `prisma migrate deploy` inside the app container against the sandbox postgres
5. Seed data: `pg_dump --data-only` from production postgres → `psql` into sandbox postgres
6. Neo4j + Qdrant start empty (seed strategies are future scope — see EP-SANDBOX-NEO4J-SEED)
7. On sandbox destroy: remove all 4 containers + the network

**New file:** `apps/web/lib/sandbox-db.ts`

Functions:
- `createSandboxDbStack(buildId)` — Creates network + 3 database containers, returns container IDs
- `waitForSandboxDb(dbContainerId)` — Polls `pg_isready` with timeout
- `seedSandboxDb(appContainerId, productionDbUrl)` — `pg_dump | psql` pipeline
- `destroySandboxDbStack(buildId, state)` — Removes all DB containers + network

### Section 2: Workspace Initialization

How the sandbox app container gets from empty `/workspace` to a runnable project.

**Strategy pattern for deployment modes:**

```typescript
interface SandboxSourceStrategy {
  initializeWorkspace(containerId: string, buildId: string): Promise<void>;
}
```

Three deployment modes are configured at install time via admin settings (`sandboxSourceMode`). Only Mode 1 is implemented in this spec:

| Mode | Name | Description | This spec? |
|------|------|-------------|------------|
| 1 | `local` | Copy from production instance, no external git | **Yes** |
| 2 | `community` | Clone from public OpenDigitalProductFactory repo | Future (EP-HIVE-MIND-001) |
| 3 | `fork` | Clone from customer's own GitLab/GitHub repo | Future (EP-HIVE-MIND-001) |

**Mode 1 (Local/Private) flow:**

1. **Copy source** — `tar` from host excluding heavy/sensitive paths, pipe into container:
   - Exclude: `node_modules/`, `.next/`, `.git/`, `.env*`, `docker-compose*.yml`, `Dockerfile*`, `backups/`
   - Include: all source code, `package.json`, `pnpm-lock.yaml`, `prisma/`, config files
   - Implementation: `tar cf - --exclude=<patterns> . | docker exec -i <container> tar xf - -C /workspace`

2. **Establish git baseline** — Inside the container:
   ```
   cd /workspace && git init && git add -A && git commit -m "sandbox baseline"
   ```
   This gives `extractDiff` a clean baseline to diff against.

3. **Install dependencies** — `pnpm install` inside the container. Uses the lock file for determinism.

4. **Generate Prisma client** — `pnpm prisma generate` so the app can import `@prisma/client` against the sandbox DB schema.

5. **Start dev server** — `pnpm dev &` (backgrounded). The sandbox serves on port 3000 (mapped to the allocated host port).

**Timing:** Steps 1-4 take ~60-90 seconds. Step 5 adds ~10 seconds for Next.js cold start.

**New files:**
- `apps/web/lib/sandbox-workspace.ts` — `initializeSandboxWorkspace()` function
- `apps/web/lib/sandbox-source-strategy.ts` — Strategy interface + `LocalSourceStrategy` implementation

### Section 3: Checkpoint-Based Execution with Recovery

Replace the fire-and-forget `autoExecuteBuild` with a step-by-step pipeline that tracks progress and supports retry from the last good state.

**New field on FeatureBuild:**

```prisma
buildExecState Json? // BuildExecutionState structure
```

**State structure:**

```typescript
type BuildExecutionState = {
  step: "pending" | "sandbox_created" | "db_ready" | "workspace_initialized"
      | "deps_installed" | "code_generated" | "tests_run" | "complete" | "failed";
  failedAt?: string;        // Which step failed
  error?: string;            // Error message
  retryCount: number;        // Times retried from this step
  containerId?: string;      // Sandbox app container
  dbContainerId?: string;    // Sandbox postgres container
  neo4jContainerId?: string;
  qdrantContainerId?: string;
  networkId?: string;        // Docker network ID
  hostPort?: number;
  startedAt: string;         // ISO timestamp
  completedAt?: string;
};
```

**Pipeline steps:**

| # | Step | Action | Retry? | On failure |
|---|------|--------|--------|------------|
| 1 | `sandbox_created` | Create Docker network + 4 containers, start them | Yes (3x, 2s/4s/8s backoff) — port conflict, Docker transient | Record error, set phase "failed" |
| 2 | `db_ready` | Wait for postgres healthcheck, `prisma migrate deploy`, seed data | Yes (3x) — postgres startup race | Containers stay alive for debugging |
| 3 | `workspace_initialized` | Copy source, git init, baseline commit | Yes (2x) — disk/IO error | Containers stay alive |
| 4 | `deps_installed` | `pnpm install` + `prisma generate` + `pnpm dev &` | Yes (2x) — network/registry issue | Workspace intact, retry just this step |
| 5 | `code_generated` | LLM call + write files to sandbox | Yes (2x) — API timeout | Sandbox running, retry code gen only |
| 6 | `tests_run` | `pnpm test` + `tsc --noEmit` | No retry — results are informational | Record results, continue to complete |
| 7 | `complete` | Save results, emit SSE events | No retry | Log warning |

**Checkpoint behavior:**
- After each successful step, update `buildExecState` in the database
- On failure, set `failedAt` and `error`, increment `retryCount`
- If retries exhausted for a step, set `step: "failed"` and emit SSE error event
- Containers are NOT destroyed on failure — they stay alive for troubleshooting

**Manual retry:** New server action `retryBuildExecution(buildId: string)`:
- Reads `buildExecState` from the build record
- Picks up from `failedAt` step — re-enters the pipeline at that point
- Resets `retryCount` for the failed step
- The UI shows a "Retry from [step name]" button when build is in failed state

**SSE integration:** Each step transition emits a progress event so the Build page shows "Creating sandbox...", "Initializing database...", "Installing dependencies...", "Generating code...", etc.

**Changes to `apps/web/lib/actions/build.ts`:**
- Replace `autoExecuteBuild` with `runBuildPipeline` using the checkpoint pattern
- Add `retryBuildExecution` server action
- Each pipeline step updates `buildExecState` before and after execution

### Section 4: Migration Promotion with Safety

When a sandbox build is approved for production, schema migrations and code changes are promoted with a backup-first safety net.

**Promotion flow (triggered by `deploy_feature` tool after human approval):**

**Step 1 — Pre-flight checks:**
- Verify sandbox is running and has changes (`git diff` is non-empty)
- Scan migration files for destructive operations
- Flag destructive operations for explicit human review with a warning in the approval dialog

**Destructive operation patterns scanned:**

```typescript
const DESTRUCTIVE_PATTERNS = [
  /DROP\s+TABLE/i,
  /DROP\s+COLUMN/i,
  /ALTER\s+COLUMN\s+.*\s+TYPE/i,
  /RENAME\s+(TABLE|COLUMN)/i,
  /DELETE\s+FROM/i,
  /TRUNCATE/i,
];
```

**Step 2 — Backup production database:**
- `pg_dump` the production postgres to a timestamped file: `backups/pre-promote-{buildId}-{timestamp}.sql`
- Store backup metadata in a `PromotionBackup` record
- **Hard gate:** Backup must complete successfully before promotion proceeds. Not best-effort.

**Step 3 — Extract changes from sandbox:**
- `extractDiff` gets the full `git diff` from the sandbox
- Separate migration files (`prisma/migrations/**`) from application code in the diff
- Present both to the reviewer with clear labeling:
  - "Code changes: 8 files modified"
  - "Schema changes: 1 migration (non-destructive)" or
  - "Schema changes: 1 migration — WARNING: contains DROP COLUMN on UserProfile.legacyField"

**Step 4 — Apply to production codebase:**
- Apply code patch to the working tree
- Copy migration files into `prisma/migrations/`
- Run `prisma migrate deploy` against production database
- If migration fails: log error, do NOT auto-rollback the code patch — let the human decide. The backup exists for recovery.

**Step 5 — Post-promotion record:**
- Write a `ChangePromotion` record (existing model) linking build, backup, migration status, approval
- Create `BuildActivity` entry: "Promoted to production. Backup: {backupId}. Migration: {status}."

**Restore procedure (manual, documented):**
```
# Restore database from pre-promotion backup
psql -U dpf -d dpf < backups/pre-promote-{buildId}-{timestamp}.sql

# Revert code changes
git checkout -- .

# Verify
pnpm prisma migrate status
pnpm test
```

**New schema addition:**

```prisma
model PromotionBackup {
  id        String   @id @default(cuid())
  buildId   String
  timestamp DateTime @default(now())
  filePath  String   // path to pg_dump file
  sizeBytes Int
  status    String   @default("complete") // complete | failed | restored

  @@index([buildId])
}
```

**New file:** `apps/web/lib/sandbox-promotion.ts`

Functions:
- `backupProductionDb(buildId)` — pg_dump with timestamped filename, returns PromotionBackup record
- `scanForDestructiveOps(migrationSql)` — Pattern matching, returns warnings array
- `extractAndCategorizeDiff(containerId)` — Separates migration files from code files
- `applyPromotionPatch(diffPatch, migrationFiles)` — Apply code + run migrations
- `getRestoreInstructions(backupId)` — Returns documented restore procedure

### Section 5: Coding Agent Update

**Change to `apps/web/lib/coding-agent.ts`:**

Remove the rule "Do NOT modify the database schema" from `buildCodeGenPrompt`. The sandbox now has its own isolated database — schema changes are expected and safe. Replace with:

```
- Schema changes are allowed. Add new models/fields to prisma/schema.prisma as needed.
- After schema changes, run: prisma migrate dev --name <descriptive-name>
- Do NOT drop existing tables or columns without explicit instruction.
```

---

## Epic Placeholders

| Epic ID | Title | Description | Depends on |
|---------|-------|-------------|------------|
| EP-SANDBOX-DATA | Sandbox Dataset Subsetting | When production data grows large, replace full `pg_dump` with selective export (time-range, portfolio-scoped, anonymized). | Section 1 seed pipeline |
| EP-HIVE-MIND-001 | Hive Mind — Community Contribution Pipeline | Bidirectional change flow between customer instances and the common project. Implements Modes 2 (community clone) and 3 (customer fork) of `SandboxSourceStrategy`. | Section 2 strategy interface |
| EP-INSTALL-REFACTOR | Refactor Install Scripts for Dual-Path Setup | Update install scripts for two clear paths: (1) Developer native — `pnpm dev`, local tooling, contributor workflow. (2) Customer iterative — Docker-based platform with self-development sandbox enabled. The sandbox process is what makes path 2 viable. | Sections 1 + 2 complete |
| EP-SANDBOX-NEO4J-SEED | Neo4j + Qdrant Sandbox Seeding | Add seed data for graph relationships and vector embeddings in sandbox. `neo4j-admin dump/load` and Qdrant snapshot restore. | Section 1 container infrastructure |

---

## Acceptance Criteria

1. **Sandbox stack launches** — `autoExecuteBuild` creates 4 containers (app + postgres + neo4j + qdrant) on an isolated Docker network. All containers start and become healthy.
2. **Database is isolated** — The sandbox postgres is a separate container with its own data. Schema changes in the sandbox do not affect the production database. Production data is seeded into the sandbox via `pg_dump/psql`.
3. **Workspace is initialized** — The sandbox container has the project source code, `node_modules` installed, Prisma client generated, and `next dev` running. `git diff` shows only changes made by the coding agent.
4. **Checkpoint recovery works** — When a pipeline step fails, the build record shows which step failed and why. The "Retry from [step]" action resumes from the failed step without recreating containers that are already running.
5. **Coding agent can modify schema** — Generated code can include Prisma schema changes. `prisma migrate dev` runs in the sandbox. Tests run against the sandbox database.
6. **Promotion backs up first** — Before any migration is applied to production, `pg_dump` creates a backup. The backup record exists in the database. Promotion fails if backup fails.
7. **Destructive operations flagged** — Migration SQL containing DROP TABLE, DROP COLUMN, ALTER TYPE, or RENAME triggers a warning in the promotion review.
8. **End-to-end flow** — A feature with schema changes can be ideated, planned, built in the sandbox (with working database), tested, approved, backed up, and promoted to production.

---

## Files Changed

### New Files

| File | Purpose |
|------|---------|
| `apps/web/lib/sandbox-db.ts` | Sandbox database stack lifecycle — create/seed/destroy postgres, neo4j, qdrant containers |
| `apps/web/lib/sandbox-workspace.ts` | Workspace initialization — source copy, git baseline, deps, dev server |
| `apps/web/lib/sandbox-source-strategy.ts` | Strategy interface + Mode 1 (Local/Private) implementation |
| `apps/web/lib/sandbox-promotion.ts` | Migration promotion — backup, destructive-op scan, apply, restore |

### Modified Files

| File | Change |
|------|--------|
| `apps/web/lib/sandbox.ts` | Add network creation/teardown, update `createSandbox` to join sandbox network |
| `apps/web/lib/actions/build.ts` | Replace `autoExecuteBuild` with checkpoint pipeline, add `retryBuildExecution` action |
| `apps/web/lib/coding-agent.ts` | Remove "Do NOT modify database schema" rule, allow schema changes in sandbox |

### Schema Changes

| Change | Purpose |
|--------|---------|
| Add `buildExecState Json?` to `FeatureBuild` | Checkpoint state for pipeline recovery |
| Add `PromotionBackup` model | Track pre-promotion database backups |

---

## Dependencies

- Docker must be running on the host (already required)
- `dpf-sandbox` image must be built (`docker compose --profile build-images build`)
- Production postgres must be accessible for `pg_dump` seeding
- At least one AI provider with coding capability for code generation

## Risks

1. **Resource pressure** — A full sandbox stack uses ~5.3GB RAM. On machines with 16GB, this limits concurrent sandboxes to 1-2. Mitigated by the 30-minute sandbox timeout and explicit destroy.
2. **Seed data timing** — `pg_dump/psql` on a large production database could take minutes. Mitigated initially by small data sizes; the EP-SANDBOX-DATA epic addresses this for growth.
3. **Port conflicts** — Random port allocation (3001-3100) could collide with other services. Mitigated by checking port availability before allocation and retry logic in step 1.
4. **Windows Docker Desktop** — `docker exec` with tar pipes may behave differently on Windows. Mitigated by testing the tar pipeline in the implementation phase and using PowerShell-compatible commands where needed.

## References

- [EP-SELF-DEV-002 Process Fix Spec](2026-03-18-self-dev-process-fix-design.md)
- [Self-Dev Sandbox Design (EP-SELF-DEV-001)](2026-03-14-self-dev-sandbox-design.md)
- [Development Lifecycle Architecture](2026-03-17-development-lifecycle-architecture-design.md)
