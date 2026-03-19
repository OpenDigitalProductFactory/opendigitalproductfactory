# Sandbox Execution & Database Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the Build Studio sandbox to run full-stack features with isolated databases, checkpoint-based execution recovery, and safe migration promotion to production.

**Architecture:** Ephemeral per-sandbox Docker stacks (app + postgres + neo4j + qdrant) on isolated networks. Checkpoint pipeline replaces fire-and-forget execution. Strategy pattern for workspace initialization. Promotion flow with mandatory backup + destructive-op scanning.

**Tech Stack:** TypeScript, Docker CLI via `child_process`, Prisma 5, vitest, Next.js 14 App Router

**Spec:** `docs/superpowers/specs/2026-03-19-sandbox-execution-db-isolation-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web/lib/sandbox-db.ts` | Create/destroy sandbox database containers (postgres, neo4j, qdrant), healthcheck polling, data seeding, port allocation |
| `apps/web/lib/sandbox-db.test.ts` | Unit tests for sandbox-db (pure function tests — Docker calls mocked) |
| `apps/web/lib/sandbox-workspace.ts` | Initialize sandbox workspace: copy source, git baseline, install deps, start dev server |
| `apps/web/lib/sandbox-workspace.test.ts` | Unit tests for workspace init helpers |
| `apps/web/lib/sandbox-source-strategy.ts` | `SandboxSourceStrategy` interface + `LocalSourceStrategy` implementation |
| `apps/web/lib/sandbox-source-strategy.test.ts` | Unit tests for strategy pattern |
| `apps/web/lib/sandbox-promotion.ts` | Backup production DB, scan for destructive ops, categorize diffs, apply patches |
| `apps/web/lib/sandbox-promotion.test.ts` | Unit tests for promotion (destructive-op scanning, diff categorization) |
| `apps/web/lib/build-pipeline.ts` | Checkpoint-based build pipeline (`runBuildPipeline`, `retryFromStep`) — extracted from build.ts |
| `apps/web/lib/build-pipeline.test.ts` | Unit tests for pipeline state machine logic |
| `apps/web/lib/build-exec-types.ts` | `BuildExecutionState` type + step constants |

### Modified Files

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add `buildExecState`, `promotionBackups` to FeatureBuild; add `PromotionBackup` model; add `backupId` to ChangePromotion |
| `Dockerfile.sandbox` | Add `postgresql16-client` and `curl` packages |
| `apps/web/lib/sandbox.ts` | Add `createSandboxNetwork`, `destroySandboxNetwork`, update `buildSandboxCreateArgs` for network + env vars |
| `apps/web/lib/sandbox.test.ts` | Add tests for new network + env var functions |
| `apps/web/lib/actions/build.ts` | Replace `autoExecuteBuild` with `runBuildPipeline` call, add `retryBuildExecution` server action |
| `apps/web/lib/coding-agent.ts` | Update `buildCodeGenPrompt` rules: allow schema changes, use `prisma db push` |
| `apps/web/lib/feature-build-types.ts` | Add `BuildExecutionState` to `FeatureBuildRow` type |

---

### Task 1: Schema Changes — PromotionBackup + FeatureBuild fields

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add `buildExecState` field to FeatureBuild**

In `packages/db/prisma/schema.prisma`, in the `FeatureBuild` model, after the `uxTestResults` field (line ~1373), add:

```prisma
  buildExecState  Json? // BuildExecutionState: checkpoint for pipeline recovery
```

- [ ] **Step 2: Add `promotionBackups` relation to FeatureBuild**

In the same model, after the `activities` relation (line ~1383), add:

```prisma
  promotionBackups PromotionBackup[]
```

- [ ] **Step 3: Add PromotionBackup model**

After the `BuildActivity` model (line ~1399), add:

```prisma
model PromotionBackup {
  id         String            @id @default(cuid())
  buildId    String
  build      FeatureBuild      @relation(fields: [buildId], references: [buildId])
  timestamp  DateTime          @default(now())
  filePath   String
  sizeBytes  Int
  status     String            @default("complete") // complete | failed | restored
  promotions ChangePromotion[]

  @@index([buildId])
}
```

- [ ] **Step 4: Add backupId to ChangePromotion**

In the `ChangePromotion` model (line ~471), after the `rollbackReason` field, add:

```prisma
  backupId         String?
  backup           PromotionBackup? @relation(fields: [backupId], references: [id])
```

- [ ] **Step 5: Run prisma generate to validate schema**

Run: `cd apps/web && pnpm prisma generate`
Expected: No errors. Prisma client regenerated.

- [ ] **Step 6: Create and apply migration**

Run: `cd apps/web && pnpm prisma migrate dev --name add-sandbox-exec-and-promotion-backup`
Expected: Migration created and applied successfully.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat: add BuildExecutionState + PromotionBackup schema for sandbox pipeline"
```

---

### Task 2: Dockerfile.sandbox — Add postgresql-client and curl

**Files:**
- Modify: `Dockerfile.sandbox`

- [ ] **Step 1: Update the apk add line**

In `Dockerfile.sandbox` (line 3), change:

```dockerfile
RUN apk add --no-cache git
```

to:

```dockerfile
RUN apk add --no-cache git postgresql16-client curl
```

- [ ] **Step 2: Rebuild sandbox image**

Run: `docker compose --profile build-images build sandbox-image`
Expected: Image builds successfully with the new packages.

- [ ] **Step 3: Verify packages are available**

Run: `docker run --rm dpf-sandbox sh -c "pg_dump --version && psql --version && curl --version"`
Expected: Version output for all three tools.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile.sandbox
git commit -m "feat: add postgresql-client + curl to sandbox image for DB seeding"
```

---

### Task 3: Build Execution Types

**Files:**
- Create: `apps/web/lib/build-exec-types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// apps/web/lib/build-exec-types.ts
// Types for the checkpoint-based build execution pipeline.

export type BuildExecStep =
  | "pending"
  | "sandbox_created"
  | "db_ready"
  | "workspace_initialized"
  | "deps_installed"
  | "code_generated"
  | "tests_run"
  | "complete"
  | "failed";

export type BuildExecutionState = {
  step: BuildExecStep;
  failedAt?: string;
  error?: string;
  retryCount: number;
  containerId?: string;
  dbContainerId?: string;
  neo4jContainerId?: string;
  qdrantContainerId?: string;
  networkId?: string;
  hostPort?: number;
  startedAt: string;
  completedAt?: string;
};

export const STEP_ORDER: BuildExecStep[] = [
  "pending",
  "sandbox_created",
  "workspace_initialized",  // workspace first — prisma migrate needs prisma/ dir
  "db_ready",
  "deps_installed",
  "code_generated",
  "tests_run",
  "complete",
];

export const STEP_LABELS: Record<BuildExecStep, string> = {
  pending: "Pending",
  sandbox_created: "Creating sandbox...",
  workspace_initialized: "Copying project...",
  db_ready: "Initializing database...",
  deps_installed: "Installing dependencies...",
  code_generated: "Generating code...",
  tests_run: "Running tests...",
  complete: "Complete",
  failed: "Failed",
};

export const MAX_RETRIES: Record<BuildExecStep, number> = {
  pending: 0,
  sandbox_created: 3,
  db_ready: 3,
  workspace_initialized: 2,
  deps_installed: 2,
  code_generated: 2,
  tests_run: 0,
  complete: 0,
  failed: 0,
};

export const RETRY_DELAYS_MS = [2000, 4000, 8000];

export function initialExecState(): BuildExecutionState {
  return {
    step: "pending",
    retryCount: 0,
    startedAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/build-exec-types.ts
git commit -m "feat: add BuildExecutionState types for sandbox pipeline checkpoints"
```

---

### Task 4: Update feature-build-types.ts — Add BuildExecutionState to row type

**Files:**
- Modify: `apps/web/lib/feature-build-types.ts`

- [ ] **Step 1: Import BuildExecutionState**

At the top of `feature-build-types.ts`, after the crypto import (line 4), add:

```typescript
import type { BuildExecutionState } from "./build-exec-types";
```

- [ ] **Step 2: Add buildExecState to FeatureBuildRow**

In the `FeatureBuildRow` type, after `claimStatus` (line 105), add:

```typescript
  buildExecState: BuildExecutionState | null;
```

- [ ] **Step 3: Run tests to ensure no breakage**

Run: `cd apps/web && pnpm vitest run lib/feature-build-types.test.ts`
Expected: All existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/feature-build-types.ts
git commit -m "feat: add buildExecState to FeatureBuildRow type"
```

---

### Task 5: Sandbox Network + Env Vars — Update sandbox.ts

**Files:**
- Modify: `apps/web/lib/sandbox.ts`
- Modify: `apps/web/lib/sandbox.test.ts`

- [ ] **Step 1: Write failing tests for network functions**

Add to `apps/web/lib/sandbox.test.ts`:

```typescript
describe("buildSandboxNetworkName", () => {
  it("builds network name from buildId", () => {
    expect(buildSandboxNetworkName("FB-ABC12345")).toBe("dpf-sandbox-net-FB-ABC12345");
  });
});

describe("buildSandboxCreateArgs", () => {
  it("includes --network flag when networkName provided", () => {
    const args = buildSandboxCreateArgs("FB-ABC12345", 3001, {
      networkName: "dpf-sandbox-net-FB-ABC12345",
    });
    expect(args).toContain("--network=dpf-sandbox-net-FB-ABC12345");
  });

  it("includes -e flags for env vars when provided", () => {
    const args = buildSandboxCreateArgs("FB-X", 3002, {
      envVars: {
        DATABASE_URL: "postgresql://dpf:dpf_sandbox@db:5432/dpf",
        NEO4J_URI: "bolt://neo4j:7687",
      },
    });
    expect(args).toContain("-e");
    expect(args).toContain("DATABASE_URL=postgresql://dpf:dpf_sandbox@db:5432/dpf");
    expect(args).toContain("NEO4J_URI=bolt://neo4j:7687");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && pnpm vitest run lib/sandbox.test.ts`
Expected: New tests fail (functions don't exist / don't accept new params yet).

- [ ] **Step 3: Implement network name helper + update buildSandboxCreateArgs**

In `apps/web/lib/sandbox.ts`, add the network name helper and update `buildSandboxCreateArgs`:

```typescript
export function buildSandboxNetworkName(buildId: string): string {
  return `dpf-sandbox-net-${buildId}`;
}
```

Update `buildSandboxCreateArgs` signature to accept options:

```typescript
export function buildSandboxCreateArgs(
  buildId: string,
  hostPort: number,
  options?: {
    networkName?: string;
    envVars?: Record<string, string>;
  },
): string[] {
  const args = [
    "create",
    "--name", `dpf-sandbox-${buildId}`,
    "--cpus=" + String(SANDBOX_RESOURCE_LIMITS.cpus),
    "--memory=" + String(SANDBOX_RESOURCE_LIMITS.memoryMb) + "m",
    "-p", `${hostPort}:3000`,
  ];

  if (options?.networkName) {
    args.push(`--network=${options.networkName}`);
  }

  if (options?.envVars) {
    for (const [key, value] of Object.entries(options.envVars)) {
      args.push("-e", `${key}=${value}`);
    }
  }

  args.push(SANDBOX_IMAGE);
  return args;
}
```

Update `createSandbox` to forward the options parameter:

```typescript
export async function createSandbox(
  buildId: string,
  hostPort: number,
  options?: { networkName?: string; envVars?: Record<string, string> },
): Promise<string> {
  const args = buildSandboxCreateArgs(buildId, hostPort, options);
  const { stdout } = await exec(`docker ${args.join(" ")}`);
  return stdout.trim();
}
```

Add network lifecycle functions:

```typescript
export async function createSandboxNetwork(buildId: string): Promise<string> {
  const name = buildSandboxNetworkName(buildId);
  await exec(`docker network create ${name}`);
  return name;
}

export async function destroySandboxNetwork(networkName: string): Promise<void> {
  await exec(`docker network rm ${networkName}`).catch(() => {
    // Network may already be removed
  });
}
```

Add full sandbox stack teardown (app + all DBs + network):

```typescript
export async function destroyFullSandboxStack(
  buildId: string,
  state: {
    containerId?: string;
    dbContainerId?: string;
    neo4jContainerId?: string;
    qdrantContainerId?: string;
    networkId?: string;
  },
): Promise<void> {
  // Remove all containers
  const ids = [state.containerId, state.dbContainerId, state.neo4jContainerId, state.qdrantContainerId].filter(Boolean);
  await Promise.all(ids.map((id) => exec(`docker rm -f ${id}`).catch(() => {})));
  // Remove network
  if (state.networkId) await destroySandboxNetwork(state.networkId);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && pnpm vitest run lib/sandbox.test.ts`
Expected: All tests pass (old + new).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/sandbox.ts apps/web/lib/sandbox.test.ts
git commit -m "feat: add sandbox network + env var support to container creation"
```

---

### Task 6: Sandbox Database Stack — sandbox-db.ts

**Files:**
- Create: `apps/web/lib/sandbox-db.ts`
- Create: `apps/web/lib/sandbox-db.test.ts`

- [ ] **Step 1: Write failing tests for pure functions**

Create `apps/web/lib/sandbox-db.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  buildDbContainerName,
  buildNeo4jContainerName,
  buildQdrantContainerName,
  buildSandboxDbEnvVars,
  DB_RESOURCE_LIMITS,
  NEO4J_RESOURCE_LIMITS,
  QDRANT_RESOURCE_LIMITS,
} from "./sandbox-db";

describe("container naming", () => {
  it("builds postgres container name", () => {
    expect(buildDbContainerName("FB-ABC")).toBe("dpf-sandbox-db-FB-ABC");
  });

  it("builds neo4j container name", () => {
    expect(buildNeo4jContainerName("FB-ABC")).toBe("dpf-sandbox-neo4j-FB-ABC");
  });

  it("builds qdrant container name", () => {
    expect(buildQdrantContainerName("FB-ABC")).toBe("dpf-sandbox-qdrant-FB-ABC");
  });
});

describe("buildSandboxDbEnvVars", () => {
  it("builds env vars pointing to sandbox database containers", () => {
    const env = buildSandboxDbEnvVars("FB-ABC");
    expect(env.DATABASE_URL).toBe("postgresql://dpf:dpf_sandbox@dpf-sandbox-db-FB-ABC:5432/dpf");
    expect(env.NEO4J_URI).toBe("bolt://dpf-sandbox-neo4j-FB-ABC:7687");
    expect(env.NEO4J_USER).toBe("neo4j");
    expect(env.NEO4J_PASSWORD).toBe("dpf_sandbox");
    expect(env.QDRANT_INTERNAL_URL).toBe("http://dpf-sandbox-qdrant-FB-ABC:6333");
  });
});

describe("resource limits", () => {
  it("postgres gets 512MB and 1 CPU", () => {
    expect(DB_RESOURCE_LIMITS.memoryMb).toBe(512);
    expect(DB_RESOURCE_LIMITS.cpus).toBe(1);
  });

  it("neo4j gets 512MB and 1 CPU", () => {
    expect(NEO4J_RESOURCE_LIMITS.memoryMb).toBe(512);
    expect(NEO4J_RESOURCE_LIMITS.cpus).toBe(1);
  });

  it("qdrant gets 256MB and 0.5 CPU", () => {
    expect(QDRANT_RESOURCE_LIMITS.memoryMb).toBe(256);
    expect(QDRANT_RESOURCE_LIMITS.cpus).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && pnpm vitest run lib/sandbox-db.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement sandbox-db.ts**

Create `apps/web/lib/sandbox-db.ts`:

```typescript
// apps/web/lib/sandbox-db.ts
// Sandbox database stack lifecycle — creates, manages, and destroys
// isolated postgres, neo4j, and qdrant containers per sandbox.

import { exec as execCb } from "child_process";
import { promisify } from "util";

const exec = promisify(execCb);

// ─── Constants ───────────────────────────────────────────────────────────────

export const DB_RESOURCE_LIMITS = { memoryMb: 512, cpus: 1 } as const;
export const NEO4J_RESOURCE_LIMITS = { memoryMb: 512, cpus: 1 } as const;
export const QDRANT_RESOURCE_LIMITS = { memoryMb: 256, cpus: 0.5 } as const;

const HEALTHCHECK_TIMEOUT_MS = 30_000;
const HEALTHCHECK_INTERVAL_MS = 2_000;

// ─── Naming ──────────────────────────────────────────────────────────────────

export function buildDbContainerName(buildId: string): string {
  return `dpf-sandbox-db-${buildId}`;
}

export function buildNeo4jContainerName(buildId: string): string {
  return `dpf-sandbox-neo4j-${buildId}`;
}

export function buildQdrantContainerName(buildId: string): string {
  return `dpf-sandbox-qdrant-${buildId}`;
}

export function buildSandboxDbEnvVars(buildId: string): Record<string, string> {
  return {
    DATABASE_URL: `postgresql://dpf:dpf_sandbox@${buildDbContainerName(buildId)}:5432/dpf`,
    NEO4J_URI: `bolt://${buildNeo4jContainerName(buildId)}:7687`,
    NEO4J_USER: "neo4j",
    NEO4J_PASSWORD: "dpf_sandbox",
    QDRANT_INTERNAL_URL: `http://${buildQdrantContainerName(buildId)}:6333`,
  };
}

// ─── Container Creation ──────────────────────────────────────────────────────

export async function createSandboxDbStack(
  buildId: string,
  networkName: string,
): Promise<{ dbContainerId: string; neo4jContainerId: string; qdrantContainerId: string }> {
  const dbName = buildDbContainerName(buildId);
  const neo4jName = buildNeo4jContainerName(buildId);
  const qdrantName = buildQdrantContainerName(buildId);

  // Postgres
  const { stdout: dbId } = await exec([
    "docker create",
    `--name ${dbName}`,
    `--network=${networkName}`,
    `--cpus=${DB_RESOURCE_LIMITS.cpus}`,
    `--memory=${DB_RESOURCE_LIMITS.memoryMb}m`,
    "-e POSTGRES_USER=dpf",
    "-e POSTGRES_PASSWORD=dpf_sandbox",
    "-e POSTGRES_DB=dpf",
    "postgres:16-alpine",
  ].join(" "));
  await exec(`docker start ${dbId.trim()}`);

  // Neo4j
  const { stdout: neo4jId } = await exec([
    "docker create",
    `--name ${neo4jName}`,
    `--network=${networkName}`,
    `--cpus=${NEO4J_RESOURCE_LIMITS.cpus}`,
    `--memory=${NEO4J_RESOURCE_LIMITS.memoryMb}m`,
    "-e NEO4J_AUTH=neo4j/dpf_sandbox",
    `-e NEO4J_PLUGINS='["apoc"]'`,
    "neo4j:5-community",
  ].join(" "));
  await exec(`docker start ${neo4jId.trim()}`);

  // Qdrant
  const { stdout: qdrantId } = await exec([
    "docker create",
    `--name ${qdrantName}`,
    `--network=${networkName}`,
    `--cpus=${QDRANT_RESOURCE_LIMITS.cpus}`,
    `--memory=${QDRANT_RESOURCE_LIMITS.memoryMb}m`,
    "qdrant/qdrant:latest",
  ].join(" "));
  await exec(`docker start ${qdrantId.trim()}`);

  return {
    dbContainerId: dbId.trim(),
    neo4jContainerId: neo4jId.trim(),
    qdrantContainerId: qdrantId.trim(),
  };
}

// ─── Health Checks ───────────────────────────────────────────────────────────

async function pollUntilReady(
  containerId: string,
  checkCommand: string,
  label: string,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < HEALTHCHECK_TIMEOUT_MS) {
    try {
      await exec(`docker exec ${containerId} sh -c ${JSON.stringify(checkCommand)}`);
      return; // healthy
    } catch {
      await new Promise((r) => setTimeout(r, HEALTHCHECK_INTERVAL_MS));
    }
  }
  throw new Error(`${label} healthcheck timed out after ${HEALTHCHECK_TIMEOUT_MS}ms`);
}

export async function waitForSandboxDb(dbContainerId: string): Promise<void> {
  await pollUntilReady(dbContainerId, "pg_isready -U dpf", "Postgres");
}

export async function waitForSandboxNeo4j(neo4jContainerId: string): Promise<void> {
  await pollUntilReady(neo4jContainerId, "wget -qO /dev/null http://localhost:7474", "Neo4j");
}

export async function waitForSandboxQdrant(qdrantContainerId: string): Promise<void> {
  await pollUntilReady(qdrantContainerId, "wget -qO /dev/null http://localhost:6333/readyz", "Qdrant");
}

// ─── Seed Data ───────────────────────────────────────────────────────────────

export async function seedSandboxDb(
  productionDbContainerName: string,
  sandboxDbContainerId: string,
): Promise<void> {
  // pg_dump from production, pipe into sandbox — both via host
  await exec(
    `docker exec ${productionDbContainerName} pg_dump --data-only -U dpf dpf` +
    ` | docker exec -i ${sandboxDbContainerId} psql -U dpf dpf`,
  );
}

// ─── Port Allocation ─────────────────────────────────────────────────────────

export async function findAvailablePort(startPort: number, endPort: number): Promise<number> {
  for (let port = startPort; port <= endPort; port++) {
    try {
      // Check if any container is using this port
      const { stdout } = await exec(
        `docker ps --filter "publish=${port}" --format "{{.ID}}"`,
      );
      if (!stdout.trim()) return port;
    } catch {
      return port; // If docker command fails, try this port
    }
  }
  throw new Error(`No available ports in range ${startPort}-${endPort}`);
}

// ─── Destroy ─────────────────────────────────────────────────────────────────

export async function destroySandboxDbStack(
  buildId: string,
  state: { dbContainerId?: string; neo4jContainerId?: string; qdrantContainerId?: string },
): Promise<void> {
  const ids = [state.dbContainerId, state.neo4jContainerId, state.qdrantContainerId].filter(Boolean);
  await Promise.all(
    ids.map((id) => exec(`docker rm -f ${id}`).catch(() => {})),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && pnpm vitest run lib/sandbox-db.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/sandbox-db.ts apps/web/lib/sandbox-db.test.ts
git commit -m "feat: add sandbox database stack lifecycle with healthchecks and seeding"
```

---

### Task 7: Source Strategy + Workspace Init

**Files:**
- Create: `apps/web/lib/sandbox-source-strategy.ts`
- Create: `apps/web/lib/sandbox-source-strategy.test.ts`
- Create: `apps/web/lib/sandbox-workspace.ts`
- Create: `apps/web/lib/sandbox-workspace.test.ts`

- [ ] **Step 1: Write failing tests for source strategy**

Create `apps/web/lib/sandbox-source-strategy.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildTarExcludeFlags, LocalSourceStrategy } from "./sandbox-source-strategy";

describe("buildTarExcludeFlags", () => {
  it("builds --exclude flags for heavy/sensitive directories", () => {
    const flags = buildTarExcludeFlags();
    expect(flags).toContain("--exclude=node_modules");
    expect(flags).toContain("--exclude=.next");
    expect(flags).toContain("--exclude=.git");
    expect(flags).toContain("--exclude=.env*");
    expect(flags).toContain("--exclude=docker-compose*.yml");
    expect(flags).toContain("--exclude=Dockerfile*");
    expect(flags).toContain("--exclude=backups");
  });
});

describe("LocalSourceStrategy", () => {
  it("implements SandboxSourceStrategy interface", () => {
    const strategy = new LocalSourceStrategy();
    expect(typeof strategy.initializeWorkspace).toBe("function");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && pnpm vitest run lib/sandbox-source-strategy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement source strategy**

Create `apps/web/lib/sandbox-source-strategy.ts`:

```typescript
// apps/web/lib/sandbox-source-strategy.ts
// Strategy pattern for initializing sandbox workspace source code.
// Mode 1 (Local/Private) implemented. Modes 2+3 future (EP-HIVE-MIND-001).

import { execInSandbox } from "@/lib/sandbox";
import { exec as execCb } from "child_process";
import { promisify } from "util";

const exec = promisify(execCb);

// ─── Interface ───────────────────────────────────────────────────────────────

export interface SandboxSourceStrategy {
  initializeWorkspace(containerId: string, buildId: string): Promise<void>;
}

// ─── Excludes ────────────────────────────────────────────────────────────────

const TAR_EXCLUDES = [
  "node_modules",
  ".next",
  ".git",
  ".env*",
  "docker-compose*.yml",
  "Dockerfile*",
  "backups",
];

export function buildTarExcludeFlags(): string[] {
  return TAR_EXCLUDES.map((p) => `--exclude=${p}`);
}

// ─── Mode 1: Local/Private ───────────────────────────────────────────────────

export class LocalSourceStrategy implements SandboxSourceStrategy {
  private projectRoot: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ?? process.cwd();
  }

  async initializeWorkspace(containerId: string, _buildId: string): Promise<void> {
    // 1. Copy source via tar pipe
    const excludes = buildTarExcludeFlags().join(" ");
    await exec(
      `tar cf - ${excludes} -C "${this.projectRoot}" . | docker exec -i ${containerId} tar xf - -C /workspace`,
    );

    // 2. Establish git baseline
    await execInSandbox(containerId, "cd /workspace && git init && git add -A && git commit -m 'sandbox baseline'");
  }
}

// ─── Strategy Factory ────────────────────────────────────────────────────────

export function getSourceStrategy(mode: string = "local"): SandboxSourceStrategy {
  switch (mode) {
    case "local":
      return new LocalSourceStrategy();
    default:
      throw new Error(`Unknown sandbox source mode: ${mode}. Only "local" is supported.`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && pnpm vitest run lib/sandbox-source-strategy.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Write failing tests for workspace init**

Create `apps/web/lib/sandbox-workspace.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildInstallCommands } from "./sandbox-workspace";

describe("buildInstallCommands", () => {
  it("returns commands for pnpm install, prisma generate, and dev server", () => {
    const cmds = buildInstallCommands();
    expect(cmds).toContain("pnpm install");
    expect(cmds).toContain("pnpm prisma generate");
    expect(cmds.some(c => c.includes("pnpm dev"))).toBe(true);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd apps/web && pnpm vitest run lib/sandbox-workspace.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement workspace init**

Create `apps/web/lib/sandbox-workspace.ts`:

```typescript
// apps/web/lib/sandbox-workspace.ts
// Orchestrates full workspace initialization: source copy + deps + dev server.

import { execInSandbox } from "@/lib/sandbox";
import { getSourceStrategy } from "@/lib/sandbox-source-strategy";

// ─── Constants ───────────────────────────────────────────────────────────────

const INSTALL_COMMANDS = [
  "pnpm install",
  "pnpm prisma generate",
  "pnpm dev &",
];

export function buildInstallCommands(): string[] {
  return [...INSTALL_COMMANDS];
}

// ─── Granular Functions (used by build pipeline individually) ─────────────────

export async function copySourceAndBaseline(
  containerId: string,
  buildId: string,
  sourceMode: string = "local",
): Promise<void> {
  const strategy = getSourceStrategy(sourceMode);
  await strategy.initializeWorkspace(containerId, buildId);
}

export async function installDepsAndStart(containerId: string): Promise<void> {
  await execInSandbox(containerId, "cd /workspace && pnpm install");
  await execInSandbox(containerId, "cd /workspace && pnpm prisma generate");
  // Use nohup so dev server persists after docker exec session ends
  await execInSandbox(containerId, "cd /workspace && nohup pnpm dev > /tmp/dev.log 2>&1 &");
}

// ─── Full Orchestration (convenience — not used by pipeline) ─────────────────

export async function initializeSandboxWorkspace(
  containerId: string,
  buildId: string,
  sourceMode: string = "local",
): Promise<void> {
  await copySourceAndBaseline(containerId, buildId, sourceMode);
  await installDepsAndStart(containerId);
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd apps/web && pnpm vitest run lib/sandbox-workspace.test.ts`
Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add apps/web/lib/sandbox-source-strategy.ts apps/web/lib/sandbox-source-strategy.test.ts apps/web/lib/sandbox-workspace.ts apps/web/lib/sandbox-workspace.test.ts
git commit -m "feat: add workspace initialization with local source strategy"
```

---

### Task 8: Sandbox Promotion — Backup + Destructive-Op Scan

**Files:**
- Create: `apps/web/lib/sandbox-promotion.ts`
- Create: `apps/web/lib/sandbox-promotion.test.ts`

- [ ] **Step 1: Write failing tests for destructive-op scanning**

Create `apps/web/lib/sandbox-promotion.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  scanForDestructiveOps,
  categorizeDiffFiles,
  DESTRUCTIVE_PATTERNS,
} from "./sandbox-promotion";

describe("DESTRUCTIVE_PATTERNS", () => {
  it("has 6 patterns", () => {
    expect(DESTRUCTIVE_PATTERNS).toHaveLength(6);
  });
});

describe("scanForDestructiveOps", () => {
  it("detects DROP TABLE", () => {
    const warnings = scanForDestructiveOps("DROP TABLE users;");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/DROP\s+TABLE/i);
  });

  it("detects DROP COLUMN", () => {
    const warnings = scanForDestructiveOps("ALTER TABLE users DROP COLUMN email;");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/DROP\s+COLUMN/i);
  });

  it("detects ALTER COLUMN TYPE change", () => {
    const warnings = scanForDestructiveOps("ALTER COLUMN name TYPE varchar(50);");
    expect(warnings).toHaveLength(1);
  });

  it("detects RENAME TABLE", () => {
    const warnings = scanForDestructiveOps("RENAME TABLE old_users TO new_users;");
    expect(warnings).toHaveLength(1);
  });

  it("detects DELETE FROM", () => {
    const warnings = scanForDestructiveOps("DELETE FROM sessions;");
    expect(warnings).toHaveLength(1);
  });

  it("detects TRUNCATE", () => {
    const warnings = scanForDestructiveOps("TRUNCATE TABLE logs;");
    expect(warnings).toHaveLength(1);
  });

  it("returns empty for safe operations", () => {
    const warnings = scanForDestructiveOps("CREATE TABLE foo (id TEXT);");
    expect(warnings).toHaveLength(0);
  });

  it("detects multiple destructive ops", () => {
    const sql = "DROP TABLE old;\nDROP COLUMN legacy;\nTRUNCATE temp;";
    const warnings = scanForDestructiveOps(sql);
    expect(warnings.length).toBeGreaterThanOrEqual(3);
  });
});

describe("categorizeDiffFiles", () => {
  it("separates migration files from code files", () => {
    const result = categorizeDiffFiles([
      "apps/web/lib/sandbox.ts",
      "prisma/migrations/20260319_add_foo/migration.sql",
      "prisma/schema.prisma",
      "apps/web/components/Foo.tsx",
    ]);
    expect(result.migrationFiles).toEqual(["prisma/migrations/20260319_add_foo/migration.sql"]);
    expect(result.codeFiles).toEqual([
      "apps/web/lib/sandbox.ts",
      "prisma/schema.prisma",
      "apps/web/components/Foo.tsx",
    ]);
  });

  it("handles empty list", () => {
    const result = categorizeDiffFiles([]);
    expect(result.migrationFiles).toEqual([]);
    expect(result.codeFiles).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && pnpm vitest run lib/sandbox-promotion.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement sandbox-promotion.ts**

Create `apps/web/lib/sandbox-promotion.ts`:

```typescript
// apps/web/lib/sandbox-promotion.ts
// Migration promotion: backup production DB, scan for destructive ops,
// categorize diffs, apply patches, provide restore instructions.

import { exec as execCb } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import { prisma } from "@dpf/db";
import { extractDiff, execInSandbox } from "@/lib/sandbox";

const exec = promisify(execCb);

// ─── Destructive Operation Scanning ──────────────────────────────────────────

export const DESTRUCTIVE_PATTERNS = [
  /DROP\s+TABLE/i,
  /DROP\s+COLUMN/i,
  /ALTER\s+COLUMN\s+.*\s+TYPE/i,
  /RENAME\s+(TABLE|COLUMN)/i,
  /DELETE\s+FROM/i,
  /TRUNCATE/i,
];

export function scanForDestructiveOps(migrationSql: string): string[] {
  const warnings: string[] = [];
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    // Use global flag to catch ALL occurrences, not just the first
    const globalPattern = new RegExp(pattern.source, "gi");
    let match;
    while ((match = globalPattern.exec(migrationSql)) !== null) {
      warnings.push(`Destructive operation detected: ${match[0]}`);
    }
  }
  return warnings;
}

// ─── Diff Categorization ─────────────────────────────────────────────────────

export function categorizeDiffFiles(filePaths: string[]): {
  migrationFiles: string[];
  codeFiles: string[];
} {
  const migrationFiles: string[] = [];
  const codeFiles: string[] = [];

  for (const fp of filePaths) {
    if (fp.startsWith("prisma/migrations/")) {
      migrationFiles.push(fp);
    } else {
      codeFiles.push(fp);
    }
  }

  return { migrationFiles, codeFiles };
}

// ─── Production Backup ───────────────────────────────────────────────────────

const DEFAULT_PRODUCTION_DB_CONTAINER = process.env.DPF_PRODUCTION_DB_CONTAINER ?? "opendigitalproductfactory-postgres-1";

export async function backupProductionDb(
  buildId: string,
  productionDbContainerName: string = DEFAULT_PRODUCTION_DB_CONTAINER,
): Promise<{ id: string; filePath: string; sizeBytes: number }> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `pre-promote-${buildId}-${timestamp}.sql`;
  const backupsDir = path.join(process.cwd(), "backups");
  const filePath = path.join(backupsDir, fileName);

  // Ensure backups directory exists
  await fs.mkdir(backupsDir, { recursive: true });

  // pg_dump via docker exec, redirect to file on host
  await exec(
    `docker exec ${productionDbContainerName} pg_dump -U dpf dpf > "${filePath}"`,
  );

  // Get file size
  const stat = await fs.stat(filePath);

  // Record in database
  const record = await prisma.promotionBackup.create({
    data: {
      buildId,
      filePath,
      sizeBytes: stat.size,
      status: "complete",
    },
    select: { id: true, filePath: true, sizeBytes: true },
  });

  return record;
}

// ─── Extract and Categorize Diff ─────────────────────────────────────────────

export async function extractAndCategorizeDiff(containerId: string): Promise<{
  fullDiff: string;
  migrationFiles: string[];
  codeFiles: string[];
  hasMigrations: boolean;
}> {
  const fullDiff = await extractDiff(containerId);

  // Parse changed file paths from diff headers
  const filePattern = /^diff --git a\/(.+?) b\//gm;
  const files: string[] = [];
  let match;
  while ((match = filePattern.exec(fullDiff)) !== null) {
    if (match[1]) files.push(match[1]);
  }

  const categorized = categorizeDiffFiles(files);

  return {
    fullDiff,
    ...categorized,
    hasMigrations: categorized.migrationFiles.length > 0,
  };
}

// ─── Apply Promotion Patch ───────────────────────────────────────────────────

export async function applyPromotionPatch(
  diffPatch: string,
  productionDbContainerName: string = "opendigitalproductfactory-postgres-1",
): Promise<{ success: boolean; error?: string }> {
  try {
    // Apply code patch to working tree
    const patchFile = path.join(process.cwd(), "backups", "promotion-patch.diff");
    await fs.writeFile(patchFile, diffPatch);
    await exec(`git apply "${patchFile}"`);
    await fs.unlink(patchFile).catch(() => {});

    // Run prisma migrate deploy against production
    await exec("cd apps/web && pnpm prisma migrate deploy");

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Restore Instructions ────────────────────────────────────────────────────

export function getRestoreInstructions(backupFilePath: string): string {
  return [
    "# Restore database from pre-promotion backup",
    `psql -U dpf -d dpf < "${backupFilePath}"`,
    "",
    "# Revert code changes (apply reverse patch)",
    "git diff HEAD~1 | git apply -R",
    "# Or if committed: git revert <promotion-commit-hash>",
    "",
    "# Verify",
    "pnpm prisma migrate status",
    "pnpm test",
  ].join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && pnpm vitest run lib/sandbox-promotion.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/sandbox-promotion.ts apps/web/lib/sandbox-promotion.test.ts
git commit -m "feat: add promotion safety — backup, destructive-op scan, diff categorization"
```

---

### Task 9: Build Pipeline — Checkpoint Execution

**Files:**
- Create: `apps/web/lib/build-pipeline.ts`
- Create: `apps/web/lib/build-pipeline.test.ts`

- [ ] **Step 1: Write failing tests for pipeline state logic**

Create `apps/web/lib/build-pipeline.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  getResumeStep,
  shouldRetry,
  nextStep,
  buildFailedState,
} from "./build-pipeline";
import type { BuildExecutionState } from "./build-exec-types";

describe("getResumeStep", () => {
  it("returns 'pending' for null state", () => {
    expect(getResumeStep(null)).toBe("pending");
  });

  it("returns failedAt step for failed state", () => {
    const state: BuildExecutionState = {
      step: "failed",
      failedAt: "db_ready",
      retryCount: 3,
      startedAt: "2026-01-01T00:00:00Z",
    };
    expect(getResumeStep(state)).toBe("db_ready");
  });

  it("returns current step for in-progress state", () => {
    const state: BuildExecutionState = {
      step: "workspace_initialized",
      retryCount: 0,
      startedAt: "2026-01-01T00:00:00Z",
    };
    expect(getResumeStep(state)).toBe("deps_installed");
  });
});

describe("shouldRetry", () => {
  it("allows retry when count is below max", () => {
    expect(shouldRetry("sandbox_created", 0)).toBe(true);
    expect(shouldRetry("sandbox_created", 2)).toBe(true);
  });

  it("denies retry when count equals max", () => {
    expect(shouldRetry("sandbox_created", 3)).toBe(false);
  });

  it("never retries tests_run or complete", () => {
    expect(shouldRetry("tests_run", 0)).toBe(false);
    expect(shouldRetry("complete", 0)).toBe(false);
  });
});

describe("nextStep", () => {
  it("returns the next step in order", () => {
    expect(nextStep("pending")).toBe("sandbox_created");
    expect(nextStep("sandbox_created")).toBe("workspace_initialized");
    expect(nextStep("workspace_initialized")).toBe("db_ready");
    expect(nextStep("tests_run")).toBe("complete");
  });

  it("returns null for complete or failed", () => {
    expect(nextStep("complete")).toBeNull();
    expect(nextStep("failed")).toBeNull();
  });
});

describe("buildFailedState", () => {
  it("sets step to failed with error details", () => {
    const base: BuildExecutionState = {
      step: "db_ready",
      retryCount: 2,
      startedAt: "2026-01-01T00:00:00Z",
      containerId: "abc",
    };
    const result = buildFailedState(base, "db_ready", "Connection refused");
    expect(result.step).toBe("failed");
    expect(result.failedAt).toBe("db_ready");
    expect(result.error).toBe("Connection refused");
    expect(result.containerId).toBe("abc"); // preserved
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && pnpm vitest run lib/build-pipeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement build-pipeline.ts — pure state functions**

Create `apps/web/lib/build-pipeline.ts`:

```typescript
// apps/web/lib/build-pipeline.ts
// Checkpoint-based build execution pipeline.
// Pure state machine logic + orchestration of sandbox creation, workspace init, coding agent.

import {
  type BuildExecutionState,
  type BuildExecStep,
  STEP_ORDER,
  MAX_RETRIES,
  RETRY_DELAYS_MS,
  initialExecState,
} from "./build-exec-types";
import type { AgentEvent } from "./agent-event-bus";

// ─── Pure State Functions ────────────────────────────────────────────────────

export function getResumeStep(state: BuildExecutionState | null): BuildExecStep {
  if (!state) return "pending";
  if (state.step === "failed" && state.failedAt) {
    return state.failedAt as BuildExecStep;
  }
  // If not failed, resume from the next step after the current one
  const next = nextStep(state.step);
  return next ?? state.step;
}

export function shouldRetry(step: BuildExecStep, currentRetryCount: number): boolean {
  const max = MAX_RETRIES[step] ?? 0;
  return currentRetryCount < max;
}

export function nextStep(step: BuildExecStep): BuildExecStep | null {
  const idx = STEP_ORDER.indexOf(step);
  if (idx === -1 || idx >= STEP_ORDER.length - 1) return null;
  return STEP_ORDER[idx + 1]!;
}

export function buildFailedState(
  current: BuildExecutionState,
  failedAt: string,
  error: string,
): BuildExecutionState {
  return {
    ...current,
    step: "failed",
    failedAt,
    error,
  };
}

// ─── Pipeline Orchestration ──────────────────────────────────────────────────

export async function runBuildPipeline(params: {
  buildId: string;
  existingState: BuildExecutionState | null;
  updateState: (state: BuildExecutionState) => Promise<void>;
  emit: (event: AgentEvent) => void;
}): Promise<BuildExecutionState> {
  const { buildId, existingState, updateState, emit } = params;

  let state: BuildExecutionState = existingState ?? initialExecState();
  const resumeFrom = getResumeStep(existingState);

  // Find the starting index
  const startIdx = STEP_ORDER.indexOf(resumeFrom);
  if (startIdx === -1 || resumeFrom === "complete") return state;

  // Reset retry state if resuming from failed
  if (state.step === "failed") {
    state = { ...state, step: resumeFrom as BuildExecStep, retryCount: 0, error: undefined, failedAt: undefined };
  }

  for (let i = startIdx; i < STEP_ORDER.length - 1; i++) {
    // STEP_ORDER has "complete" at end; we loop through action steps
    const stepName = STEP_ORDER[i]!;
    if (stepName === "complete") break;

    const targetStep = STEP_ORDER[i + 1]!;

    emit({ type: "tool:start", tool: stepName, iteration: i });

    let success = false;
    let lastError = "";

    // Retry loop
    for (let attempt = 0; attempt <= (MAX_RETRIES[stepName] ?? 0); attempt++) {
      if (attempt > 0) {
        const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]!;
        await new Promise((r) => setTimeout(r, delay));
      }

      try {
        state = await executeStep(stepName, buildId, state);
        state.step = targetStep;
        state.retryCount = 0;
        await updateState(state);
        success = true;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        state.retryCount = attempt + 1;
        console.warn(`[build-pipeline] Step ${stepName} attempt ${attempt + 1} failed: ${lastError}`);
      }
    }

    emit({ type: "tool:complete", tool: stepName, success });

    if (!success) {
      state = buildFailedState(state, stepName, lastError);
      await updateState(state);
      return state;
    }

    emit({ type: "phase:change", buildId, phase: targetStep });
  }

  // Mark complete
  state.step = "complete";
  state.completedAt = new Date().toISOString();
  await updateState(state);
  emit({ type: "done" });

  return state;
}

// ─── Step Execution ──────────────────────────────────────────────────────────

async function executeStep(
  step: BuildExecStep,
  buildId: string,
  state: BuildExecutionState,
): Promise<BuildExecutionState> {
  // Pipeline order: create containers → copy workspace → init DB → install deps → code gen → tests
  // NOTE: workspace_initialized comes BEFORE db_ready because prisma migrate deploy
  // needs the prisma/ directory and package.json to be present in /workspace first.
  switch (step) {
    case "pending":
      return await stepCreateSandbox(buildId, state);
    case "sandbox_created":
      return await stepInitWorkspace(buildId, state);
    case "workspace_initialized":
      return await stepInitDb(buildId, state);
    case "db_ready":
      return await stepInstallDeps(buildId, state);
    case "deps_installed":
      return await stepGenerateCode(buildId, state);
    case "code_generated":
      return await stepRunTests(buildId, state);
    case "tests_run":
      return await stepComplete(buildId, state);
    default:
      return state;
  }
}

// Individual step implementations — each imports its dependencies lazily
// to keep the module testable and avoid circular imports.

async function stepCreateSandbox(buildId: string, state: BuildExecutionState): Promise<BuildExecutionState> {
  const { createSandboxNetwork, buildSandboxCreateArgs, createSandbox, startSandbox } = await import("@/lib/sandbox");
  const { createSandboxDbStack, findAvailablePort, buildSandboxDbEnvVars } = await import("@/lib/sandbox-db");

  const networkName = await createSandboxNetwork(buildId);
  const port = await findAvailablePort(3001, 3100);
  const envVars = buildSandboxDbEnvVars(buildId);

  // Create app container
  const containerId = await createSandbox(buildId, port, { networkName, envVars });
  await startSandbox(containerId);

  // Create DB containers
  const dbStack = await createSandboxDbStack(buildId, networkName);

  return {
    ...state,
    containerId,
    dbContainerId: dbStack.dbContainerId,
    neo4jContainerId: dbStack.neo4jContainerId,
    qdrantContainerId: dbStack.qdrantContainerId,
    networkId: networkName,
    hostPort: port,
  };
}

async function stepInitDb(buildId: string, state: BuildExecutionState): Promise<BuildExecutionState> {
  const { waitForSandboxDb, waitForSandboxNeo4j, waitForSandboxQdrant, seedSandboxDb } = await import("@/lib/sandbox-db");
  const { execInSandbox } = await import("@/lib/sandbox");

  // Wait for all databases
  await waitForSandboxDb(state.dbContainerId!);
  await waitForSandboxNeo4j(state.neo4jContainerId!);
  await waitForSandboxQdrant(state.qdrantContainerId!);

  // Run prisma migrate deploy in app container
  await execInSandbox(state.containerId!, "cd /workspace && pnpm prisma migrate deploy");

  // Seed from production (container name configurable via DPF_PRODUCTION_DB_CONTAINER env var)
  const prodDbContainer = process.env.DPF_PRODUCTION_DB_CONTAINER ?? "opendigitalproductfactory-postgres-1";
  await seedSandboxDb(prodDbContainer, state.dbContainerId!);

  return state;
}

async function stepInitWorkspace(_buildId: string, state: BuildExecutionState): Promise<BuildExecutionState> {
  const { copySourceAndBaseline } = await import("@/lib/sandbox-workspace");

  await copySourceAndBaseline(state.containerId!, _buildId);

  return state;
}

async function stepInstallDeps(_buildId: string, state: BuildExecutionState): Promise<BuildExecutionState> {
  const { installDepsAndStart } = await import("@/lib/sandbox-workspace");

  await installDepsAndStart(state.containerId!);

  return state;
}

async function stepGenerateCode(buildId: string, state: BuildExecutionState): Promise<BuildExecutionState> {
  const { prisma } = await import("@dpf/db");
  const { executeBuildPlan } = await import("@/lib/coding-agent");

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { brief: true, buildPlan: true },
  });

  if (!build?.brief || !build?.buildPlan) {
    throw new Error("Missing brief or build plan for code generation");
  }

  await executeBuildPlan({
    containerId: state.containerId!,
    brief: build.brief as import("@/lib/feature-build-types").FeatureBrief,
    plan: build.buildPlan as Record<string, unknown>,
  });

  return state;
}

async function stepRunTests(_buildId: string, state: BuildExecutionState): Promise<BuildExecutionState> {
  const { runSandboxTests } = await import("@/lib/coding-agent");

  // Tests are informational — don't throw on failure
  await runSandboxTests(state.containerId!).catch((err: unknown) => {
    console.warn("[build-pipeline] Test run failed:", err);
  });

  return state;
}

async function stepComplete(_buildId: string, state: BuildExecutionState): Promise<BuildExecutionState> {
  return state;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && pnpm vitest run lib/build-pipeline.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/build-pipeline.ts apps/web/lib/build-pipeline.test.ts
git commit -m "feat: add checkpoint-based build pipeline with retry logic"
```

---

### Task 10: Update build.ts — Replace autoExecuteBuild + Add retryBuildExecution

**Files:**
- Modify: `apps/web/lib/actions/build.ts`

- [ ] **Step 1: Replace autoExecuteBuild with runBuildPipeline call**

In `apps/web/lib/actions/build.ts`, replace the `autoExecuteBuild` function (lines ~150-252) with a thin wrapper that delegates to the pipeline:

```typescript
/** System-level build execution — delegates to checkpoint pipeline. */
async function autoExecuteBuild(buildId: string): Promise<void> {
  const { agentEventBus } = await import("@/lib/agent-event-bus");
  const { runBuildPipeline } = await import("@/lib/build-pipeline");

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { buildExecState: true, threadId: true },
  });

  const emit = (event: import("@/lib/agent-event-bus").AgentEvent) => {
    if (build?.threadId) agentEventBus.emit(build.threadId, event);
  };

  const updateState = async (state: import("@/lib/build-exec-types").BuildExecutionState) => {
    await prisma.featureBuild.update({
      where: { buildId },
      data: {
        buildExecState: state as unknown as import("@dpf/db").Prisma.InputJsonValue,
        ...(state.containerId ? { sandboxId: state.containerId } : {}),
        ...(state.hostPort ? { sandboxPort: state.hostPort } : {}),
      },
    });
  };

  await runBuildPipeline({
    buildId,
    existingState: build?.buildExecState as import("@/lib/build-exec-types").BuildExecutionState | null,
    updateState,
    emit,
  });
}
```

- [ ] **Step 2: Add retryBuildExecution server action**

After the `autoExecuteBuild` function, add:

```typescript
export async function retryBuildExecution(buildId: string): Promise<void> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { createdById: true, buildExecState: true, phase: true },
  });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");

  const state = build.buildExecState as import("@/lib/build-exec-types").BuildExecutionState | null;
  if (!state || state.step !== "failed") {
    throw new Error("Build is not in a failed state. Cannot retry.");
  }

  // Reset phase back to build if it was set to failed
  if (build.phase === "failed") {
    await prisma.featureBuild.update({
      where: { buildId },
      data: { phase: "build" },
    });
  }

  // Fire-and-forget retry — picks up from failed step
  autoExecuteBuild(buildId).catch((err) =>
    console.error(`[build] retryBuildExecution failed for ${buildId}:`, err),
  );
}
```

- [ ] **Step 3: Run existing tests to ensure no breakage**

Run: `cd apps/web && pnpm vitest run lib/feature-build-types.test.ts`
Expected: All existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/actions/build.ts
git commit -m "feat: replace autoExecuteBuild with checkpoint pipeline + retry action"
```

---

### Task 11: Update coding-agent.ts — Allow Schema Changes

**Files:**
- Modify: `apps/web/lib/coding-agent.ts`

- [ ] **Step 1: Update buildCodeGenPrompt rules**

In `apps/web/lib/coding-agent.ts`, in the `buildCodeGenPrompt` function (line ~83), replace:

```typescript
    "- Do NOT modify the database schema",
```

with:

```typescript
    "- Schema changes are allowed. Add new models/fields to prisma/schema.prisma as needed.",
    "- After schema changes, use `prisma db push` to apply changes to the sandbox database.",
    "- Do NOT use `prisma migrate dev` — use `prisma db push` for sandbox iteration.",
    "- Do NOT drop existing tables or columns without explicit instruction.",
```

- [ ] **Step 2: Run existing coding-agent tests**

Run: `cd apps/web && pnpm vitest run lib/coding-agent.test.ts 2>/dev/null || echo "No existing test file"`

Verify no breakage if test file exists.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/coding-agent.ts
git commit -m "feat: allow schema changes in sandbox — use prisma db push"
```

---

### Task 12: Full Test Suite Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all new tests**

Run: `cd apps/web && pnpm vitest run lib/sandbox-db.test.ts lib/sandbox-source-strategy.test.ts lib/sandbox-workspace.test.ts lib/sandbox-promotion.test.ts lib/build-pipeline.test.ts lib/sandbox.test.ts`
Expected: All tests pass.

- [ ] **Step 2: Run full project type check**

Run: `cd apps/web && pnpm tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Run full test suite**

Run: `cd apps/web && pnpm vitest run`
Expected: All tests pass (existing + new).

- [ ] **Step 4: Verify sandbox image builds**

Run: `docker compose --profile build-images build sandbox-image`
Expected: Image builds with postgresql-client and curl.

- [ ] **Step 5: Commit any test fixes needed**

If any tests needed fixing, commit with appropriate message.

---

### Task 13: Create backups directory + .gitignore

**Files:**
- Create: `backups/.gitkeep`
- Create: `backups/.gitignore`

- [ ] **Step 1: Create backups directory with gitignore**

Create `backups/.gitignore`:

```
# Database backups — not committed to git
*.sql
!.gitkeep
!.gitignore
```

Create `backups/.gitkeep` (empty file).

- [ ] **Step 2: Commit**

```bash
git add backups/.gitignore backups/.gitkeep
git commit -m "feat: add backups directory for pre-promotion database dumps"
```

---

### Task 14: Final Integration Commit + Spec Update

**Files:**
- Modify: `docs/superpowers/specs/2026-03-19-sandbox-execution-db-isolation-design.md`

- [ ] **Step 1: Update spec status**

Add to the top of the spec, after the title:

```markdown
**Status:** Implemented (2026-03-19)
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-03-19-sandbox-execution-db-isolation-design.md
git commit -m "docs: mark sandbox execution spec as implemented"
```
