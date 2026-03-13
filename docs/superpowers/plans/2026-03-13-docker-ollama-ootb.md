# Docker Ollama OOTB Local AI — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bundle Ollama as a Docker Compose sidecar with zero-config auto-discovery, activation, and profiling on first page load.

**Architecture:** Ollama joins the existing `docker-compose.yml` as a third service. An entrypoint script auto-detects GPU and pulls a default model. The AI Providers page passively health-checks Ollama on each render, auto-activating and profiling it. Hardware info is enriched into the Neo4j InfraCI graph.

**Tech Stack:** Docker Compose, Bash, Next.js 14 (App Router, server components), Prisma 5, Neo4j 5, TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-03-13-docker-ollama-ootb-design.md`

---

## Chunk 1: Docker Infrastructure

### Task 1: Add Ollama service to docker-compose.yml

**Files:**
- Modify: `docker-compose.yml`

**Context:** Currently has 2 services (`postgres`, `neo4j`) and 2 named volumes (`pgdata`, `neo4jdata`). Port 5432 (postgres) and 7474/7687 (neo4j) are exposed.

- [ ] **Step 1: Add Ollama service and volume to docker-compose.yml**

Add the `ollama` service after `neo4j`, and `ollama_models` to the volumes section:

```yaml
  ollama:
    image: ollama/ollama
    ports:
      - "${OLLAMA_HOST_PORT:-11434}:11434"
    volumes:
      - ollama_models:/root/.ollama
      - ./scripts/ollama-entrypoint.sh:/ollama-entrypoint.sh:ro
    entrypoint: ["/bin/bash", "/ollama-entrypoint.sh"]
    # GPU passthrough: requires NVIDIA Container Toolkit.
    # If this block causes errors on CPU-only hosts, remove or comment out
    # the entire 'deploy' section — Ollama will still work in CPU-only mode.
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:11434/api/tags"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
```

Add to existing `volumes:` section:

```yaml
  ollama_models:
```

- [ ] **Step 2: Verify compose file parses**

Run: `cd d:/OpenDigitalProductFactory && docker compose config --quiet`
Expected: Exit 0 (no parse errors). Note: Ollama won't start yet because entrypoint script doesn't exist.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(infra): add Ollama service to docker-compose.yml"
```

---

### Task 2: Create Ollama entrypoint script

**Files:**
- Create: `scripts/ollama-entrypoint.sh`

**Context:** This script runs inside the Ollama container. It starts the Ollama server, waits for readiness, checks for existing models (persisted volume), detects GPU, and pulls a default model if none exist.

- [ ] **Step 1: Create the entrypoint script**

Create `scripts/ollama-entrypoint.sh`:

```bash
#!/bin/bash
set -e

# 1. Start Ollama server in background
ollama serve &
OLLAMA_PID=$!

# Forward signals for graceful shutdown
trap "kill $OLLAMA_PID; wait $OLLAMA_PID" SIGTERM SIGINT

# 2. Wait for Ollama to be ready (max 60s)
echo "Waiting for Ollama to start..."
READY=false
for i in $(seq 1 30); do
  if curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "Ollama is ready."
    READY=true
    break
  fi
  sleep 2
done

if [ "$READY" = false ]; then
  echo "ERROR: Ollama failed to start within 60 seconds."
  exit 1
fi

# 3. Check if models already loaded (persisted volume)
MODEL_COUNT=$(ollama list 2>/dev/null | tail -n +2 | wc -l)

if [ "$MODEL_COUNT" = "0" ]; then
  echo "No models found. Detecting hardware..."

  # 4. Runtime GPU detection
  GPU_DETECTED=false
  if command -v nvidia-smi &> /dev/null && nvidia-smi &> /dev/null; then
    GPU_DETECTED=true
    echo "GPU detected: $(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null || echo 'unknown')"
  fi

  # 5. Pull appropriate default model
  if [ "$GPU_DETECTED" = true ]; then
    echo "Pulling llama3:8b (GPU-optimized default)..."
    ollama pull llama3:8b
  else
    echo "Pulling phi3:mini (CPU-optimized default)..."
    ollama pull phi3:mini
  fi

  echo "Default model ready."
else
  echo "$MODEL_COUNT model(s) already available."
fi

# 6. Foreground the Ollama process
wait $OLLAMA_PID
```

- [ ] **Step 2: Make the script executable**

Run: `chmod +x scripts/ollama-entrypoint.sh`

- [ ] **Step 3: Commit**

```bash
git add scripts/ollama-entrypoint.sh
git commit -m "feat(infra): add Ollama entrypoint with GPU detection and auto-pull"
```

---

### Task 3: Add Ollama environment variables

**Files:**
- Modify: `.env.example`

**Context:** `.env.example` currently has 31 lines with DATABASE_URL, NEO4J, AUTH, CREDENTIAL_ENCRYPTION_KEY, ANTHROPIC_API_KEY, and BRANDING vars. This file is the template — setup scripts copy it to `apps/web/.env.local`.

- [ ] **Step 1: Add Ollama env vars to .env.example**

Append after the existing content:

```env

# ── Ollama (Docker sidecar) ──────────────────────────────
# Host port for Ollama (change if local Ollama already uses 11434)
OLLAMA_HOST_PORT=11434
# Internal Docker network URL for Ollama (server-side only; leave unset for local dev)
# OLLAMA_INTERNAL_URL=http://ollama:11434
```

Note: `OLLAMA_INTERNAL_URL` is commented out by default. Setup scripts uncomment it when running in Docker Compose mode.

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "feat(infra): add Ollama env vars to .env.example"
```

---

### Task 4: Update setup scripts for Ollama readiness

**Files:**
- Modify: `scripts/setup.sh`
- Modify: `scripts/setup.ps1`

**Context:** Both scripts follow the same pattern: `docker compose up -d` → poll for readiness → run migrations → seed. The PostgreSQL readiness block polls `pg_isready` with 30 retries × 2s sleep. Ollama needs a longer timeout (model download on first run).

- [ ] **Step 1: Update setup.sh step message and add Ollama readiness**

In `scripts/setup.sh`, update the step message that currently says "Starting databases (PostgreSQL + Neo4j)" to:

```bash
step "Starting services (PostgreSQL + Neo4j + Ollama)"
```

Then, after the PostgreSQL readiness block (after the `ok "PostgreSQL is ready"` line), add:

```bash
echo "  Waiting for Ollama... (first run may take a few minutes to download default model)"
RETRIES=90
until docker compose exec -T ollama curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; do
  RETRIES=$((RETRIES - 1))
  if [ $RETRIES -eq 0 ]; then
    fail "Ollama did not start in time. Check: docker compose logs ollama"
  fi
  sleep 2
done
ok "Ollama is ready"
```

Also, inside the `if [ ! -f apps/web/.env.local ]` block, add the following line **before** the `ok "Created apps/web/.env.local with generated AUTH_SECRET"` message (i.e., after the `sed` command on line 57 and before the `ok` on line 58):

```bash
# Enable Docker internal URL for Ollama
echo "OLLAMA_INTERNAL_URL=http://ollama:11434" >> apps/web/.env.local
```

- [ ] **Step 2: Update setup.ps1 step message and add Ollama readiness**

In `scripts/setup.ps1`, update the step message similarly, then after the PostgreSQL readiness block, add:

```powershell
Write-Host "  Waiting for Ollama... (first run may take a few minutes to download default model)" -ForegroundColor Yellow
$retries = 90
do {
    $result = docker compose exec -T ollama curl -sf http://localhost:11434/api/tags 2>$null
    if ($LASTEXITCODE -eq 0) { break }
    $retries--
    if ($retries -eq 0) {
        Write-Host "  [FAIL] Ollama did not start in time. Check: docker compose logs ollama" -ForegroundColor Red
        exit 1
    }
    Start-Sleep -Seconds 2
} while ($true)
Write-Host "  [OK] Ollama is ready" -ForegroundColor Green
```

Also, inside the `if (-not (Test-Path "apps\web\.env.local"))` block, add the following line **before** the closing `}` of that outer `if` block (after both the `$secret`-present branch ending at line 63 and the `$secret`-absent branch ending at line 65, but before the `} else {` on line 67):

```powershell
# Enable Docker internal URL for Ollama
Add-Content -Path "apps\web\.env.local" -Value "OLLAMA_INTERNAL_URL=http://ollama:11434"
```

- [ ] **Step 3: Commit**

```bash
git add scripts/setup.sh scripts/setup.ps1
git commit -m "feat(infra): add Ollama readiness polling to setup scripts"
```

---

## Chunk 2: Neo4j InfraCI Extension

### Task 5: Extend syncInfraCI() for hardware properties

**Files:**
- Modify: `packages/db/src/neo4j-sync.ts`
- Create: `packages/db/src/neo4j-sync.test.ts`

**Context:** `syncInfraCI()` currently accepts `{ ciId, name, ciType, status, portfolioSlug? }` and merges an `:InfraCI` node in Neo4j. We need to add optional extended properties (`baseUrl`, `gpu`, `vramGb`, `modelCount`) that are SET on the node alongside the existing ones.

Note on Neo4j null semantics: `SET node.prop = null` in Neo4j **removes** the property rather than storing null. This means `vramGb` will be absent on CPU-only nodes rather than present with value null. Downstream code should use `properties.vramGb ?? null` when reading.

- [ ] **Step 1: Write the failing test for extended properties**

Create `packages/db/src/neo4j-sync.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock neo4j module before import
vi.mock("./neo4j", () => ({
  runCypher: vi.fn().mockResolvedValue([]),
}));

import { runCypher } from "./neo4j";
import { syncInfraCI } from "./neo4j-sync";

const mockRunCypher = vi.mocked(runCypher);

describe("syncInfraCI", () => {
  beforeEach(() => {
    mockRunCypher.mockClear();
  });

  it("merges basic InfraCI node without extended props", async () => {
    await syncInfraCI({
      ciId: "CI-test-01",
      name: "Test Node",
      ciType: "service",
      status: "operational",
    });

    expect(mockRunCypher).toHaveBeenCalledTimes(1);
    const cypher = mockRunCypher.mock.calls[0]![0] as string;
    expect(cypher).toContain("MERGE (ci:InfraCI {ciId: $ciId})");
    expect(cypher).toContain("ci.name = $name");
    expect(cypher).toContain("ci.status = $status");
  });

  it("sets extended properties when provided", async () => {
    await syncInfraCI(
      {
        ciId: "CI-ollama-01",
        name: "Ollama",
        ciType: "ai-inference",
        status: "operational",
      },
      {
        baseUrl: "http://ollama:11434",
        gpu: "NVIDIA RTX 4090",
        vramGb: 24,
        modelCount: 3,
      },
    );

    expect(mockRunCypher).toHaveBeenCalledTimes(1);
    const params = mockRunCypher.mock.calls[0]![1] as Record<string, unknown>;
    expect(params).toMatchObject({
      ciId: "CI-ollama-01",
      baseUrl: "http://ollama:11434",
      gpu: "NVIDIA RTX 4090",
      vramGb: 24,
      modelCount: 3,
    });
    const cypher = mockRunCypher.mock.calls[0]![0] as string;
    expect(cypher).toContain("ci.baseUrl = $baseUrl");
    expect(cypher).toContain("ci.gpu = $gpu");
    expect(cypher).toContain("ci.vramGb = $vramGb");
    expect(cypher).toContain("ci.modelCount = $modelCount");
  });

  it("omits all extended properties when not provided", async () => {
    await syncInfraCI({
      ciId: "CI-test-02",
      name: "Test",
      ciType: "database",
      status: "operational",
    });

    const cypher = mockRunCypher.mock.calls[0]![0] as string;
    expect(cypher).not.toContain("ci.baseUrl");
    expect(cypher).not.toContain("ci.gpu");
    expect(cypher).not.toContain("ci.vramGb");
    expect(cypher).not.toContain("ci.modelCount");
  });

  it("creates BELONGS_TO edge when portfolioSlug provided", async () => {
    await syncInfraCI({
      ciId: "CI-test-03",
      name: "Test",
      ciType: "service",
      status: "operational",
      portfolioSlug: "foundational",
    });

    expect(mockRunCypher).toHaveBeenCalledTimes(2);
    const edgeCypher = mockRunCypher.mock.calls[1]![0] as string;
    expect(edgeCypher).toContain("BELONGS_TO");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd d:/OpenDigitalProductFactory && pnpm test -- packages/db/src/neo4j-sync.test.ts`
Expected: FAIL — `syncInfraCI` doesn't accept a second argument yet.

- [ ] **Step 3: Implement extended syncInfraCI**

Modify `packages/db/src/neo4j-sync.ts`. Add the interface and update the function signature and body. The existing function passes `ci` object directly as Cypher params — replace with dynamic SET clause building:

```typescript
export interface InfraCIExtendedProps {
  baseUrl?: string;
  gpu?: string;
  vramGb?: number | null;
  modelCount?: number;
}

export async function syncInfraCI(
  ci: {
    ciId: string;
    name: string;
    ciType: string;
    status: string;
    portfolioSlug?: string | null;
  },
  extendedProps?: InfraCIExtendedProps,
) {
  const setClauses = [
    "ci.name = $name",
    "ci.ciType = $ciType",
    "ci.status = $status",
    "ci.syncedAt = datetime()",
  ];
  const params: Record<string, unknown> = {
    ciId: ci.ciId,
    name: ci.name,
    ciType: ci.ciType,
    status: ci.status,
  };

  if (extendedProps) {
    if (extendedProps.baseUrl !== undefined) {
      setClauses.push("ci.baseUrl = $baseUrl");
      params.baseUrl = extendedProps.baseUrl;
    }
    if (extendedProps.gpu !== undefined) {
      setClauses.push("ci.gpu = $gpu");
      params.gpu = extendedProps.gpu;
    }
    if (extendedProps.vramGb !== undefined) {
      setClauses.push("ci.vramGb = $vramGb");
      params.vramGb = extendedProps.vramGb;
    }
    if (extendedProps.modelCount !== undefined) {
      setClauses.push("ci.modelCount = $modelCount");
      params.modelCount = extendedProps.modelCount;
    }
  }

  await runCypher(
    `MERGE (ci:InfraCI {ciId: $ciId})
     SET ${setClauses.join(", ")}`,
    params,
  );

  if (ci.portfolioSlug) {
    await runCypher(
      `MATCH (ci:InfraCI {ciId: $ciId}), (p:Portfolio {slug: $portfolioSlug})
       MERGE (ci)-[:BELONGS_TO]->(p)`,
      { ciId: ci.ciId, portfolioSlug: ci.portfolioSlug },
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd d:/OpenDigitalProductFactory && pnpm test -- packages/db/src/neo4j-sync.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Run full test suite**

Run: `cd d:/OpenDigitalProductFactory && pnpm test`
Expected: All existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/neo4j-sync.ts packages/db/src/neo4j-sync.test.ts
git commit -m "feat(db): extend syncInfraCI() with optional hardware properties"
```

---

### Task 6: Seed Ollama CI node in init-neo4j.ts

**Files:**
- Modify: `packages/db/scripts/init-neo4j.ts`

**Context:** Lines 76–79 define the `infraCIs` array (PostgreSQL, Neo4j, Docker Host, Next.js). Lines 87–93 create `DEPENDS_ON` edges via individual `syncDependsOn()` calls. Add Ollama with initial status `"offline"` and a dependency on Docker Host.

- [ ] **Step 1: Add Ollama CI node to the infraCIs array**

In `packages/db/scripts/init-neo4j.ts`, add to the `infraCIs` array (after the Next.js entry at line 79):

```typescript
    { ciId: "CI-ollama-01",     name: "Ollama",             ciType: "ai-inference", status: "offline",      portfolioSlug: "foundational" },
```

- [ ] **Step 2: Add DEPENDS_ON edge for Ollama**

After the existing `syncDependsOn()` calls (around line 92), add a new call:

```typescript
  await syncDependsOn({ fromLabel: "InfraCI", fromId: "CI-ollama-01", toLabel: "InfraCI", toId: "CI-docker-host-01", role: "runtime" });
```

Update the console.log count from "4 edges done" to "5 edges done".

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd d:/OpenDigitalProductFactory && pnpm exec tsc --noEmit -p packages/db/tsconfig.json`
Expected: No TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add packages/db/scripts/init-neo4j.ts
git commit -m "feat(db): seed Ollama InfraCI node in Neo4j init script"
```

---

### Task 7: Export syncInfraCI type and getInfraCIs from @dpf/db

**Files:**
- Modify: `packages/db/src/index.ts`

**Context:** The web app (Tasks 11-12) needs to import `InfraCIExtendedProps` type from `@dpf/db`. `syncInfraCI` and `getInfraCIs` are **already exported** — only the new type needs adding. This task must be done before Chunk 3.

- [ ] **Step 1: Add InfraCIExtendedProps type export**

Read `packages/db/src/index.ts`. `syncInfraCI` is already exported on line 24, and `getInfraCIs` on line 13. Only the new type needs to be added. Update the existing sync export line:

```typescript
// Change this line:
//   export { syncInfraCI, syncDependsOn, ... } from "./neo4j-sync";
// To:
export {
  syncDigitalProduct,
  syncTaxonomyNode,
  syncPortfolio,
  syncInfraCI,
  syncDependsOn,
  type InfraCIExtendedProps,
} from "./neo4j-sync";
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd d:/OpenDigitalProductFactory && pnpm exec tsc --noEmit -p apps/web/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit (if changes were needed)**

```bash
git add packages/db/src/index.ts
git commit -m "feat(db): export syncInfraCI and getInfraCIs from @dpf/db"
```

---

## Chunk 3: Platform Integration

### Task 8: Extract discovery/profiling internals to separate module

**Files:**
- Create: `apps/web/lib/ai-provider-internals.ts`
- Modify: `apps/web/lib/actions/ai-providers.ts`

**Context:** `discoverModels()` and `profileModels()` in `ai-providers.ts` are `"use server"` actions guarded by `requireManageProviders()`. The spec requires internal versions without auth guards for the page-load health check. **CRITICAL: These must NOT be in the `"use server"` file** — any exported function from a `"use server"` file becomes a publicly callable server action, which would bypass auth. Extract the core logic into a separate non-action module.

- [ ] **Step 1: Create ai-provider-internals.ts with all extracted dependencies**

The function bodies of `discoverModels()` and `profileModels()` depend on several **private** helpers that also live in `ai-providers.ts`. These must be moved to the new module too, since they're not exported and the internals module can't import them from the `"use server"` file.

**Private helpers to move** (listed with their line ranges in `ai-providers.ts`):
- `getDecryptedCredential()` (lines 144–152) — uses `decryptSecret` from `@/lib/credential-crypto`
- `getProviderExtraHeaders()` (lines 155–158) — standalone
- `getProviderBearerToken()` (lines 230–274) — uses `getDecryptedCredential`, `prisma`
- `PROFILING_MODELS` constant (lines 414–427) — standalone
- `getProfilingModel()` (lines 430–458) — uses `PROFILING_MODELS`, `prisma`
- `callProviderForProfiling()` (lines 460–536) — uses `getProviderExtraHeaders`, `getDecryptedCredential`, `getProviderBearerToken`, `getProfilingModel`
- `logTokenUsage()` (lines 688–729) — uses `prisma`, `computeTokenCost`, `computeComputeCost`

Create `apps/web/lib/ai-provider-internals.ts` (**NO `"use server"` directive**):

```typescript
// apps/web/lib/ai-provider-internals.ts
// Internal discovery/profiling logic and shared private helpers.
// NOT a server action file — must never have "use server" directive.
// Called by checkBundledProviders() (page-load health check) and
// by the server actions in ai-providers.ts (which add auth guards).

import { prisma, type Prisma } from "@dpf/db";
import {
  computeTokenCost,
  computeComputeCost,
  getTestUrl,
  parseModelsResponse,
  type RegistryProviderEntry,
} from "@/lib/ai-provider-types";
import {
  rankProvidersByCost,
  buildProfilingPrompt,
  parseProfilingResponse,
  type ProfileResult,
} from "@/lib/ai-profiling";
import { decryptSecret } from "@/lib/credential-crypto";
```

Move the 7 private helpers listed above (verbatim, preserving function signatures and bodies) into this file as **non-exported** module-level functions. They are internal to this module.

Then add the two exported internal functions:

```typescript
export async function discoverModelsInternal(
  providerId: string,
): Promise<{ discovered: number; newCount: number; error?: string }> {
  // Exact body from discoverModels() lines 330–388 (everything after requireManageProviders())
}

export async function profileModelsInternal(
  providerId: string,
  modelIds?: string[],
): Promise<{ profiled: number; failed: number; error?: string }> {
  // Exact body from profileModels() lines 544–683 (everything after requireManageProviders())
  // NOTE: preserve the `failed` field in the return type
}
```

- [ ] **Step 2: Update ai-providers.ts to delegate to internals**

In `apps/web/lib/actions/ai-providers.ts`:

1. **Remove** the 7 private helpers listed above (they now live in `ai-provider-internals.ts`)
2. **Import** the shared helpers that `testProviderAuth()` and `configureProvider()` still need from the new module
3. **Replace** `discoverModels()` and `profileModels()` bodies with delegation:

```typescript
import {
  discoverModelsInternal,
  profileModelsInternal,
  getDecryptedCredential,
  getProviderExtraHeaders,
  getProviderBearerToken,
} from "@/lib/ai-provider-internals";

export async function discoverModels(
  providerId: string,
): Promise<{ discovered: number; newCount: number; error?: string }> {
  await requireManageProviders();
  return discoverModelsInternal(providerId);
}

export async function profileModels(
  providerId: string,
  modelIds?: string[],
): Promise<{ profiled: number; failed: number; error?: string }> {
  await requireManageProviders();
  return profileModelsInternal(providerId, modelIds);
}
```

Note: `testProviderAuth()` (line 278) also uses `getDecryptedCredential`, `getProviderExtraHeaders`, and `getProviderBearerToken`. These must be **re-exported** from the internals module so `ai-providers.ts` can import them. Mark them as exported in `ai-provider-internals.ts`:

```typescript
// These are also used by testProviderAuth() in ai-providers.ts
export async function getDecryptedCredential(providerId: string) { ... }
export function getProviderExtraHeaders(providerId: string): Record<string, string> { ... }
export async function getProviderBearerToken(providerId: string): Promise<{ token: string } | { error: string }> { ... }
```

The remaining helpers (`PROFILING_MODELS`, `getProfilingModel`, `callProviderForProfiling`, `logTokenUsage`) stay non-exported — they're only used internally by `profileModelsInternal`.

- [ ] **Step 3: Verify ai-provider-internals.ts has NO "use server" directive**

Run: `grep -n "use server" apps/web/lib/ai-provider-internals.ts`
Expected: No matches. If "use server" appears anywhere in this file, **remove it immediately** — its presence would expose all exported functions as publicly callable server actions without auth.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd d:/OpenDigitalProductFactory && pnpm exec tsc --noEmit -p apps/web/tsconfig.json`
Expected: No errors.

- [ ] **Step 5: Run full test suite to confirm no regressions**

Run: `cd d:/OpenDigitalProductFactory && pnpm test`
Expected: All existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/ai-provider-internals.ts apps/web/lib/actions/ai-providers.ts
git commit -m "refactor(ai): extract discovery/profiling internals to non-action module

SECURITY: Moved private helpers out of 'use server' file to prevent
unguarded functions from becoming publicly callable server actions."
```

---

### Task 9: Create getOllamaBaseUrl helper

**Files:**
- Create: `apps/web/lib/ollama.ts`
- Create: `apps/web/lib/ollama-url.test.ts`

**Context:** URL resolution helper that strips `/v1` from the registry baseUrl for native API calls. Separated into its own test file to avoid mock scoping conflicts with the health check tests (Task 10).

- [ ] **Step 1: Write tests for getOllamaBaseUrl**

Create `apps/web/lib/ollama-url.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("getOllamaBaseUrl", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.OLLAMA_INTERNAL_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns OLLAMA_INTERNAL_URL when set", async () => {
    process.env.OLLAMA_INTERNAL_URL = "http://ollama:11434";
    const { getOllamaBaseUrl } = await import("./ollama");
    expect(getOllamaBaseUrl()).toBe("http://ollama:11434");
  });

  it("strips /v1 suffix from baseUrl", async () => {
    const { getOllamaBaseUrl } = await import("./ollama");
    expect(
      getOllamaBaseUrl({ providerId: "ollama", baseUrl: "http://localhost:11434/v1", endpoint: null }),
    ).toBe("http://localhost:11434");
  });

  it("strips /v1/ suffix with trailing slash", async () => {
    const { getOllamaBaseUrl } = await import("./ollama");
    expect(
      getOllamaBaseUrl({ providerId: "ollama", baseUrl: "http://localhost:11434/v1/", endpoint: null }),
    ).toBe("http://localhost:11434");
  });

  it("returns baseUrl unchanged if no /v1 suffix", async () => {
    const { getOllamaBaseUrl } = await import("./ollama");
    expect(
      getOllamaBaseUrl({ providerId: "ollama", baseUrl: "http://localhost:11434", endpoint: null }),
    ).toBe("http://localhost:11434");
  });

  it("prefers endpoint over baseUrl", async () => {
    const { getOllamaBaseUrl } = await import("./ollama");
    expect(
      getOllamaBaseUrl({ providerId: "ollama", baseUrl: "http://localhost:11434/v1", endpoint: "http://custom:9999/v1" }),
    ).toBe("http://custom:9999");
  });

  it("falls back to localhost when no provider given", async () => {
    const { getOllamaBaseUrl } = await import("./ollama");
    expect(getOllamaBaseUrl()).toBe("http://localhost:11434");
  });

  it("OLLAMA_INTERNAL_URL takes precedence over provider", async () => {
    process.env.OLLAMA_INTERNAL_URL = "http://ollama:11434";
    const { getOllamaBaseUrl } = await import("./ollama");
    expect(
      getOllamaBaseUrl({ providerId: "ollama", baseUrl: "http://localhost:11434/v1", endpoint: null }),
    ).toBe("http://ollama:11434");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd d:/OpenDigitalProductFactory && pnpm test -- apps/web/lib/ollama-url.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement getOllamaBaseUrl**

Create `apps/web/lib/ollama.ts`:

```typescript
// apps/web/lib/ollama.ts
import type { ModelProvider } from "@prisma/client";

type ProviderUrlFields = Pick<ModelProvider, "providerId" | "baseUrl" | "endpoint">;

/**
 * Returns the root Ollama URL for native API calls (/api/tags, /api/ps).
 * The registry baseUrl is "http://localhost:11434/v1" (OpenAI-compatible),
 * but native health/management endpoints live at the root without /v1.
 */
export function getOllamaBaseUrl(provider?: ProviderUrlFields | null): string {
  if (process.env.OLLAMA_INTERNAL_URL) {
    return process.env.OLLAMA_INTERNAL_URL;
  }
  const raw = provider?.endpoint ?? provider?.baseUrl ?? "http://localhost:11434";
  return raw.replace(/\/v1\/?$/, "");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd d:/OpenDigitalProductFactory && pnpm test -- apps/web/lib/ollama-url.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/ollama.ts apps/web/lib/ollama-url.test.ts
git commit -m "feat(ai): add getOllamaBaseUrl helper for native API URL resolution"
```

---

### Task 10: Implement checkBundledProviders

**Files:**
- Modify: `apps/web/lib/ollama.ts`
- Create: `apps/web/lib/ollama-health.test.ts`

**Context:** `checkBundledProviders()` is called on page load. It pings Ollama's native `/api/tags` endpoint, auto-activates/deactivates the provider, triggers discovery + profiling on first activation, and refreshes hardware info on every active render. Uses `discoverModelsInternal()` and `profileModelsInternal()` from the non-action module (Task 8).

Tests are in a separate file (`ollama-health.test.ts`) to avoid mock scoping conflicts with the URL tests.

- [ ] **Step 1: Write tests for checkBundledProviders**

Create `apps/web/lib/ollama-health.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma
vi.mock("@dpf/db", () => ({
  prisma: {
    modelProvider: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
  syncInfraCI: vi.fn(),
}));

// Mock internal functions
vi.mock("./ai-provider-internals", () => ({
  discoverModelsInternal: vi.fn().mockResolvedValue({ discovered: 2, newCount: 2 }),
  profileModelsInternal: vi.fn().mockResolvedValue({ profiled: 2, failed: 0 }),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { prisma, syncInfraCI } from "@dpf/db";
import { discoverModelsInternal, profileModelsInternal } from "./ai-provider-internals";
import { checkBundledProviders } from "./ollama";

const mockFindFirst = vi.mocked(prisma.modelProvider.findFirst);
const mockUpdate = vi.mocked(prisma.modelProvider.update);
const mockDiscover = vi.mocked(discoverModelsInternal);
const mockProfile = vi.mocked(profileModelsInternal);
const mockSyncInfraCI = vi.mocked(syncInfraCI);

describe("checkBundledProviders", () => {
  beforeEach(() => {
    mockFindFirst.mockReset();
    mockUpdate.mockReset();
    mockFetch.mockReset();
    mockDiscover.mockReset().mockResolvedValue({ discovered: 2, newCount: 2 });
    mockProfile.mockReset().mockResolvedValue({ profiled: 2, failed: 0 });
    mockSyncInfraCI.mockReset();
  });

  it("activates Ollama and triggers discovery when reachable and unconfigured", async () => {
    mockFindFirst.mockResolvedValue({
      providerId: "ollama",
      status: "unconfigured",
      baseUrl: "http://localhost:11434/v1",
      endpoint: null,
    } as any);
    // /api/tags response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [{ name: "llama3:8b" }, { name: "phi3:mini" }] }),
    });
    // /api/ps response (for hardware enrichment)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [] }),
    });
    // /api/tags again (for model count in hardware info)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [{ name: "llama3:8b" }, { name: "phi3:mini" }] }),
    });

    await checkBundledProviders();

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { providerId: "ollama" },
      data: { status: "active" },
    });
    expect(mockDiscover).toHaveBeenCalledWith("ollama");
    expect(mockProfile).toHaveBeenCalledWith("ollama");
  });

  it("deactivates Ollama when unreachable and currently active", async () => {
    mockFindFirst.mockResolvedValue({
      providerId: "ollama",
      status: "active",
      baseUrl: "http://localhost:11434/v1",
      endpoint: null,
    } as any);
    mockFetch.mockRejectedValue(new Error("Connection refused"));

    await checkBundledProviders();

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { providerId: "ollama" },
      data: { status: "inactive" },
    });
    expect(mockDiscover).not.toHaveBeenCalled();
    expect(mockSyncInfraCI).toHaveBeenCalledWith(
      expect.objectContaining({ status: "offline" }),
    );
  });

  it("leaves unconfigured status when unreachable and unconfigured", async () => {
    mockFindFirst.mockResolvedValue({
      providerId: "ollama",
      status: "unconfigured",
      baseUrl: "http://localhost:11434/v1",
      endpoint: null,
    } as any);
    mockFetch.mockRejectedValue(new Error("Connection refused"));

    await checkBundledProviders();

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockDiscover).not.toHaveBeenCalled();
  });

  it("skips auto-profiling when model count >= 20", async () => {
    mockFindFirst.mockResolvedValue({
      providerId: "ollama",
      status: "unconfigured",
      baseUrl: "http://localhost:11434/v1",
      endpoint: null,
    } as any);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ models: Array.from({ length: 25 }, (_, i) => ({ name: `model-${i}` })) }),
    });
    mockDiscover.mockResolvedValue({ discovered: 25, newCount: 25 });

    await checkBundledProviders();

    expect(mockDiscover).toHaveBeenCalled();
    expect(mockProfile).not.toHaveBeenCalled();
  });

  it("does nothing when Ollama provider not in database", async () => {
    mockFindFirst.mockResolvedValue(null);

    await checkBundledProviders();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("refreshes hardware info when already active and reachable (steady state)", async () => {
    mockFindFirst.mockResolvedValue({
      providerId: "ollama",
      status: "active",
      baseUrl: "http://localhost:11434/v1",
      endpoint: null,
    } as any);
    // /api/tags (health check)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [{ name: "llama3:8b" }] }),
    });
    // /api/ps (hardware enrichment)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [{ name: "llama3:8b", size_vram: 5_000_000_000 }] }),
    });
    // /api/tags (model count)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [{ name: "llama3:8b" }] }),
    });

    await checkBundledProviders();

    // Should NOT re-discover or re-profile
    expect(mockDiscover).not.toHaveBeenCalled();
    expect(mockProfile).not.toHaveBeenCalled();
    // Should update hardware info
    expect(mockSyncInfraCI).toHaveBeenCalledWith(
      expect.objectContaining({ status: "operational" }),
      expect.objectContaining({ modelCount: 1 }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd d:/OpenDigitalProductFactory && pnpm test -- apps/web/lib/ollama-health.test.ts`
Expected: FAIL — `checkBundledProviders` not yet exported.

- [ ] **Step 3: Implement checkBundledProviders**

Add to `apps/web/lib/ollama.ts`:

```typescript
import { prisma, syncInfraCI } from "@dpf/db";
import { discoverModelsInternal, profileModelsInternal } from "./ai-provider-internals";

export interface OllamaHardwareInfo {
  gpu: string;
  vramGb: number | null;
  modelCount: number;
}

/**
 * Query Ollama's native /api/ps and /api/tags to extract hardware info.
 * Returns null if Ollama is unreachable.
 */
async function getOllamaHardwareInfo(baseUrl: string): Promise<OllamaHardwareInfo | null> {
  try {
    const psRes = await fetch(`${baseUrl}/api/ps`, { signal: AbortSignal.timeout(3000) });
    if (!psRes.ok) return null;
    const psData = await psRes.json();

    const tagsRes = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!tagsRes.ok) return null;
    const tagsData = await tagsRes.json();

    const loadedModels = psData.models ?? [];
    let totalVramBytes = 0;
    for (const m of loadedModels) {
      totalVramBytes += m.size_vram ?? 0;
    }

    const hasGpu = totalVramBytes > 0;
    const vramGb = hasGpu ? Math.round((totalVramBytes / 1_073_741_824) * 10) / 10 : null;

    // Try to get GPU name from loaded model details
    let gpuName = "CPU-only";
    if (hasGpu) {
      // Ollama /api/ps doesn't directly report GPU name;
      // use a generic label — the InfraCI node will show "GPU (XGB VRAM)"
      gpuName = "GPU";
    }

    return { gpu: gpuName, vramGb, modelCount: (tagsData.models ?? []).length };
  } catch {
    return null;
  }
}

/**
 * Page-load health check for the bundled Ollama provider.
 * - Unreachable + unconfigured → leave as-is
 * - Unreachable + active → deactivate, mark InfraCI offline
 * - Reachable + not active → activate, discover, profile, enrich hardware
 * - Reachable + already active → refresh hardware info only (no re-discovery)
 * No auth guard — this is internal server-side logic.
 */
export async function checkBundledProviders(): Promise<void> {
  const provider = await prisma.modelProvider.findFirst({
    where: { providerId: "ollama" },
    select: { providerId: true, status: true, baseUrl: true, endpoint: true },
  });

  if (!provider) return;

  const baseUrl = getOllamaBaseUrl(provider);
  let reachable = false;

  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    reachable = res.ok;
  } catch {
    // Timeout or connection error
  }

  if (reachable && provider.status !== "active") {
    // Activate and discover
    await prisma.modelProvider.update({
      where: { providerId: "ollama" },
      data: { status: "active" },
    });

    const result = await discoverModelsInternal("ollama");

    // Auto-profile if reasonable model count
    if (result.discovered < 20) {
      await profileModelsInternal("ollama");
    }

    // Enrich InfraCI node with hardware info
    const hwInfo = await getOllamaHardwareInfo(baseUrl);
    if (hwInfo) {
      await syncInfraCI(
        { ciId: "CI-ollama-01", name: "Ollama", ciType: "ai-inference", status: "operational" },
        { baseUrl, gpu: hwInfo.gpu, vramGb: hwInfo.vramGb, modelCount: hwInfo.modelCount },
      );
    }
  } else if (reachable && provider.status === "active") {
    // Already active — refresh hardware info only (no re-discovery)
    const hwInfo = await getOllamaHardwareInfo(baseUrl);
    if (hwInfo) {
      await syncInfraCI(
        { ciId: "CI-ollama-01", name: "Ollama", ciType: "ai-inference", status: "operational" },
        { baseUrl, gpu: hwInfo.gpu, vramGb: hwInfo.vramGb, modelCount: hwInfo.modelCount },
      );
    }
  } else if (!reachable && provider.status === "active") {
    // Deactivate
    await prisma.modelProvider.update({
      where: { providerId: "ollama" },
      data: { status: "inactive" },
    });
    await syncInfraCI(
      { ciId: "CI-ollama-01", name: "Ollama", ciType: "ai-inference", status: "offline" },
    );
  }
  // If unreachable + unconfigured → leave as-is
}

/**
 * Rough estimate of max model parameters (Q4 quantization) for given VRAM.
 * Returns a human-friendly string like "~7B" or null for CPU-only.
 */
export function estimateMaxParameters(vramGb: number | null): string | null {
  if (vramGb == null) return null;
  const maxB = Math.floor(vramGb * 0.85);
  if (maxB < 1) return "~1B";
  return `~${maxB}B`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd d:/OpenDigitalProductFactory && pnpm test -- apps/web/lib/ollama-health.test.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Run full test suite**

Run: `cd d:/OpenDigitalProductFactory && pnpm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/ollama.ts apps/web/lib/ollama-health.test.ts
git commit -m "feat(ai): implement checkBundledProviders with health check and hardware enrichment"
```

---

### Task 11: Integrate checkBundledProviders into AI Providers page

**Files:**
- Modify: `apps/web/app/(shell)/platform/ai/page.tsx`

**Context:** The page currently calls `syncProviderRegistry()` conditionally, then does a `Promise.all()` for parallel data fetches. `checkBundledProviders()` should run BEFORE the data fetches so that any status changes (active↔inactive) are reflected in the rendered page. **Note:** The spec says "runs in parallel with the existing data fetches" but sequential-then-fetch is a deliberate improvement — running in parallel would show stale status until the next page load. The 3-second timeout ensures acceptable latency even when Ollama is down.

**Prerequisites:** Chunk 2 (Task 7) and Chunk 3 (Tasks 8–10) must be complete — this task imports from `@/lib/ollama`.

- [ ] **Step 1: Add checkBundledProviders call to the page**

At the top of `page.tsx`, add the import:

```typescript
import { checkBundledProviders } from "@/lib/ollama";
```

Then, insert the health check call after the auto-sync block and before the `Promise.all`. Place it right after the closing `}` of the `if (syncJob && ...)` block:

```typescript
  // Passive health check for bundled Ollama (may change provider status)
  await checkBundledProviders();

  const now = new Date();
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd d:/OpenDigitalProductFactory && pnpm exec tsc --noEmit -p apps/web/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(shell)/platform/ai/page.tsx
git commit -m "feat(ai): integrate Ollama health check into AI Providers page load"
```

---

## Chunk 4: Hardware Display

### Task 12: Create OllamaHardwareInfo component

**Files:**
- Create: `apps/web/components/platform/OllamaHardwareInfo.tsx`

**Context:** Displays GPU name, VRAM, and max model size on the Ollama provider detail page. Data comes from the Neo4j InfraCI node properties bag.

- [ ] **Step 1: Create OllamaHardwareInfo component**

Create `apps/web/components/platform/OllamaHardwareInfo.tsx`:

```typescript
import { estimateMaxParameters } from "@/lib/ollama";

interface OllamaHardwareInfoProps {
  gpu: string;
  vramGb: number | null;
  modelCount: number;
}

export function OllamaHardwareInfo({ gpu, vramGb, modelCount }: OllamaHardwareInfoProps) {
  const maxParams = estimateMaxParameters(vramGb);
  const isGpu = gpu !== "CPU-only";

  return (
    <div style={{
      background: "var(--dpf-surface-1, #1a1a2e)",
      border: "1px solid var(--dpf-border, #2a2a40)",
      borderRadius: 6,
      padding: 12,
      marginBottom: 16,
    }}>
      <div style={{
        color: "var(--dpf-accent, #7c8cf8)",
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        marginBottom: 8,
      }}>
        Hardware
      </div>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "var(--dpf-muted, #8888a0)", fontSize: 10 }}>Compute</div>
          <div style={{ color: "#e0e0ff", fontSize: 12, fontWeight: 600 }}>
            {isGpu ? `${gpu}${vramGb ? ` (${vramGb}GB VRAM)` : ""}` : "CPU-only"}
          </div>
        </div>
        {maxParams && (
          <div>
            <div style={{ color: "var(--dpf-muted, #8888a0)", fontSize: 10 }}>Max Model Size (Q4)</div>
            <div style={{ color: "#e0e0ff", fontSize: 12, fontWeight: 600 }}>{maxParams} parameters</div>
          </div>
        )}
        <div>
          <div style={{ color: "var(--dpf-muted, #8888a0)", fontSize: 10 }}>Available Models</div>
          <div style={{ color: "#e0e0ff", fontSize: 12, fontWeight: 600 }}>{modelCount}</div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd d:/OpenDigitalProductFactory && pnpm exec tsc --noEmit -p apps/web/tsconfig.json`
Expected: No errors. This component imports `estimateMaxParameters` from `@/lib/ollama` (created in Task 10).

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/platform/OllamaHardwareInfo.tsx
git commit -m "feat(ai): add OllamaHardwareInfo display component"
```

---

### Task 13: Integrate hardware info into provider detail page

**Files:**
- Modify: `apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx`

**Context:** The provider detail page should show GPU/VRAM/model info for Ollama. This data is stored in the InfraCI node's `properties` bag (a `Record<string, unknown>` returned by `getInfraCIs()`). Properties are accessed via `node.properties.gpu`, NOT `node.gpu`.

- [ ] **Step 1: Add hardware info fetch and component**

Add imports:

```typescript
import { getInfraCIs } from "@dpf/db";
import { OllamaHardwareInfo } from "@/components/platform/OllamaHardwareInfo";
```

In the data fetch block, add a conditional InfraCI query after the existing parallel fetches:

```typescript
  // Fetch hardware info for Ollama
  let hardwareInfo: { gpu: string; vramGb: number | null; modelCount: number } | null = null;
  if (providerId === "ollama") {
    const infraCIs = await getInfraCIs("ai-inference");
    const ollamaCI = infraCIs.find((ci) => ci.id === "CI-ollama-01");
    if (ollamaCI?.properties.gpu) {
      hardwareInfo = {
        gpu: ollamaCI.properties.gpu as string,
        vramGb: (ollamaCI.properties.vramGb as number) ?? null,
        modelCount: (ollamaCI.properties.modelCount as number) ?? 0,
      };
    }
  }
```

Render the component before `ProviderDetailForm` in the JSX:

```tsx
  {hardwareInfo && (
    <OllamaHardwareInfo
      gpu={hardwareInfo.gpu}
      vramGb={hardwareInfo.vramGb}
      modelCount={hardwareInfo.modelCount}
    />
  )}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd d:/OpenDigitalProductFactory && pnpm exec tsc --noEmit -p apps/web/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(shell)/platform/ai/providers/\[providerId\]/page.tsx
git commit -m "feat(ai): display Ollama hardware info on provider detail page"
```

---

### Task 14: Add estimateMaxParameters tests

**Files:**
- Create: `apps/web/lib/ollama-estimate.test.ts`

**Context:** Pure function tests for VRAM-to-parameter estimation. Separate test file since it has no mocking dependencies.

- [ ] **Step 1: Write tests**

Create `apps/web/lib/ollama-estimate.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { estimateMaxParameters } from "./ollama";

describe("estimateMaxParameters", () => {
  it("returns null for null VRAM", () => {
    expect(estimateMaxParameters(null)).toBeNull();
  });

  it("returns ~1B for very low VRAM", () => {
    expect(estimateMaxParameters(0.5)).toBe("~1B");
  });

  it("estimates ~6B for 8GB VRAM", () => {
    const result = estimateMaxParameters(8);
    expect(result).toBe("~6B");
  });

  it("estimates ~20B for 24GB VRAM", () => {
    const result = estimateMaxParameters(24);
    expect(result).toBe("~20B");
  });

  it("estimates ~40B for 48GB VRAM", () => {
    const result = estimateMaxParameters(48);
    expect(result).toBe("~40B");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd d:/OpenDigitalProductFactory && pnpm test -- apps/web/lib/ollama-estimate.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 3: Run full test suite**

Run: `cd d:/OpenDigitalProductFactory && pnpm test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/ollama-estimate.test.ts
git commit -m "test(ai): add estimateMaxParameters unit tests"
```

---

## Summary

| Task | Description | Key Files |
|------|------------|-----------|
| 1 | Add Ollama to docker-compose.yml | `docker-compose.yml` |
| 2 | Create entrypoint script | `scripts/ollama-entrypoint.sh` |
| 3 | Add env vars | `.env.example` |
| 4 | Update setup scripts | `scripts/setup.sh`, `scripts/setup.ps1` |
| 5 | Extend syncInfraCI() | `packages/db/src/neo4j-sync.ts`, test |
| 6 | Seed Ollama CI node | `packages/db/scripts/init-neo4j.ts` |
| 7 | Export types from @dpf/db | `packages/db/src/index.ts` |
| 8 | Extract discovery/profiling internals | `apps/web/lib/ai-provider-internals.ts` |
| 9 | Create getOllamaBaseUrl helper | `apps/web/lib/ollama.ts`, test |
| 10 | Implement checkBundledProviders | `apps/web/lib/ollama.ts`, test |
| 11 | Integrate into AI page | `apps/web/app/(shell)/platform/ai/page.tsx` |
| 12 | Hardware display component | `OllamaHardwareInfo.tsx` |
| 13 | Provider detail page integration | Provider detail page |
| 14 | estimateMaxParameters tests | Test file |
