# EP-SELF-DEV-001A: Product Development Studio + Sandbox — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/build` route where non-developers describe features in plain language, an AI agent generates code in a sandboxed Docker container, and a live preview updates in real time.

**Architecture:** Three-panel layout (conversation + preview + phase bar) backed by a `FeatureBuild` record that tracks state through five phases (Ideate → Plan → Build → Review → Ship). A `dpf-sandbox` Docker container isolates code generation. Task-aware provider priority routes coding tasks to the best available model.

**Tech Stack:** Next.js 14 App Router, Prisma 5, Docker API (via CLI exec), Vitest, existing MCP tool registry

**Spec:** `docs/superpowers/specs/2026-03-14-self-dev-sandbox-design.md`

---

## Chunk 1: Schema + Types + Tests

### Task 1: Schema Changes + Migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add FeatureBuild model to schema**

Add after the `PlatformIssueReport` model (before `PlatformConfig`):

```prisma
// ─── Feature Build ──────────────────────────────────────────────────────────

model FeatureBuild {
  id              String   @id @default(cuid())
  buildId         String   @unique  // "FB-XXXXX"
  title           String
  description     String?  @db.Text
  portfolioId     String?
  brief           Json?    // FeatureBrief structure
  plan            Json?    // Internal implementation plan
  phase           String   @default("ideate") // ideate | plan | build | review | ship | complete | failed
  sandboxId       String?  // Docker container ID
  sandboxPort     Int?     // Dev server port
  diffSummary     String?  @db.Text  // Human-readable change summary
  diffPatch       String?  @db.Text  // Git patch content
  codingProvider  String?  // Which provider/model did the code generation
  threadId        String?  // Links to the conversation thread
  createdById     String
  createdBy       User     @relation(fields: [createdById], references: [id])
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([phase])
  @@index([createdById])
}
```

- [ ] **Step 2: Add FeaturePack model**

Add directly below `FeatureBuild`:

```prisma
model FeaturePack {
  id               String   @id @default(cuid())
  packId           String   @unique  // "FP-XXXXX"
  title            String
  description      String?  @db.Text
  portfolioContext String?
  version          String   @default("1.0.0")
  manifest         Json     // files, migrations, seeds, dependencies
  screenshot       String?  // URL or base64 preview image
  buildId          String?  // Links to the FeatureBuild that created it
  status           String   @default("local")  // local | contributed | published
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}
```

- [ ] **Step 3: Add codingCapability to ModelProfile**

In the `ModelProfile` model, add after `supportsToolUse`:

```prisma
  codingCapability String?  // "excellent" | "adequate" | "insufficient"
```

- [ ] **Step 4: Add User reverse relation for FeatureBuild**

In the `User` model, add to the relations list:

```prisma
  featureBuilds   FeatureBuild[]
```

- [ ] **Step 5: Run migration**

Run: `cd packages/db && npx prisma migrate dev --name add_feature_build`
Expected: Migration created and applied, `generated/client` regenerated.

- [ ] **Step 6: Verify schema compiles**

Run: `cd packages/db && npx prisma validate`
Expected: "The schema at `prisma/schema.prisma` is valid."

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(schema): add FeatureBuild, FeaturePack, ModelProfile.codingCapability"
```

---

### Task 2: Feature Build Types + Helpers

**Files:**
- Create: `apps/web/lib/feature-build-types.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/feature-build-types.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  validateFeatureBrief,
  PHASE_ORDER,
  canTransitionPhase,
  PHASE_LABELS,
  CODING_CAPABILITY_COLOURS,
  generateBuildId,
  generatePackId,
} from "./feature-build-types";

describe("validateFeatureBrief", () => {
  it("accepts a valid brief", () => {
    const result = validateFeatureBrief({
      title: "Customer Feedback Form",
      description: "A form for collecting customer feedback",
      portfolioContext: "products_and_services_sold",
      targetRoles: ["HR-200"],
      inputs: [],
      dataNeeds: "Stores feedback text and rating",
      acceptanceCriteria: ["Form submits successfully"],
    });
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("rejects empty title", () => {
    const result = validateFeatureBrief({
      title: "",
      description: "desc",
      portfolioContext: "foundational",
      targetRoles: [],
      inputs: [],
      dataNeeds: "",
      acceptanceCriteria: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("title is required");
  });

  it("rejects missing description", () => {
    const result = validateFeatureBrief({
      title: "Test",
      description: "",
      portfolioContext: "foundational",
      targetRoles: [],
      inputs: [],
      dataNeeds: "",
      acceptanceCriteria: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("description is required");
  });
});

describe("PHASE_ORDER", () => {
  it("has 7 phases in correct order", () => {
    expect(PHASE_ORDER).toEqual([
      "ideate", "plan", "build", "review", "ship", "complete", "failed",
    ]);
  });
});

describe("canTransitionPhase", () => {
  it("allows ideate → plan", () => {
    expect(canTransitionPhase("ideate", "plan")).toBe(true);
  });

  it("allows plan → build", () => {
    expect(canTransitionPhase("plan", "build")).toBe(true);
  });

  it("allows build → review", () => {
    expect(canTransitionPhase("build", "review")).toBe(true);
  });

  it("allows review → ship", () => {
    expect(canTransitionPhase("review", "ship")).toBe(true);
  });

  it("allows ship → complete", () => {
    expect(canTransitionPhase("ship", "complete")).toBe(true);
  });

  it("allows any phase → failed", () => {
    expect(canTransitionPhase("ideate", "failed")).toBe(true);
    expect(canTransitionPhase("build", "failed")).toBe(true);
  });

  it("blocks skipping phases", () => {
    expect(canTransitionPhase("ideate", "build")).toBe(false);
    expect(canTransitionPhase("plan", "review")).toBe(false);
  });

  it("blocks backward transitions", () => {
    expect(canTransitionPhase("build", "ideate")).toBe(false);
    expect(canTransitionPhase("review", "plan")).toBe(false);
  });

  it("blocks transitions from terminal states", () => {
    expect(canTransitionPhase("complete", "ideate")).toBe(false);
    expect(canTransitionPhase("failed", "ideate")).toBe(false);
  });
});

describe("PHASE_LABELS", () => {
  it("has a label for every phase", () => {
    for (const phase of PHASE_ORDER) {
      expect(PHASE_LABELS[phase]).toBeTruthy();
    }
  });
});

describe("CODING_CAPABILITY_COLOURS", () => {
  it("maps all three tiers", () => {
    expect(CODING_CAPABILITY_COLOURS["excellent"]).toBeTruthy();
    expect(CODING_CAPABILITY_COLOURS["adequate"]).toBeTruthy();
    expect(CODING_CAPABILITY_COLOURS["insufficient"]).toBeTruthy();
  });
});

describe("generateBuildId", () => {
  it("starts with FB-", () => {
    expect(generateBuildId()).toMatch(/^FB-[A-Z0-9]{8}$/);
  });

  it("generates unique IDs", () => {
    const a = generateBuildId();
    const b = generateBuildId();
    expect(a).not.toBe(b);
  });
});

describe("generatePackId", () => {
  it("starts with FP-", () => {
    expect(generatePackId()).toMatch(/^FP-[A-Z0-9]{8}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/feature-build-types.test.ts`
Expected: FAIL — module `./feature-build-types` not found.

- [ ] **Step 3: Write implementation**

Create `apps/web/lib/feature-build-types.ts`:

```typescript
// apps/web/lib/feature-build-types.ts
// Pure types and helpers for the Build Studio. No server imports.

import * as crypto from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export type FeatureBrief = {
  title: string;
  description: string;
  portfolioContext: string;
  targetRoles: string[];
  inputs: string[];        // references to uploaded screenshots, URLs, etc.
  dataNeeds: string;
  acceptanceCriteria: string[];
};

export type BuildPhase = "ideate" | "plan" | "build" | "review" | "ship" | "complete" | "failed";

export type FeatureBuildRow = {
  id: string;
  buildId: string;
  title: string;
  description: string | null;
  portfolioId: string | null;
  brief: FeatureBrief | null;
  plan: Record<string, unknown> | null; // internal plan — not shown to user directly
  phase: BuildPhase;
  sandboxId: string | null;
  sandboxPort: number | null;
  diffSummary: string | null;
  diffPatch: string | null;
  codingProvider: string | null;
  threadId: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
};

export type FeaturePackRow = {
  id: string;
  packId: string;
  title: string;
  description: string | null;
  portfolioContext: string | null;
  version: string;
  status: string;
  buildId: string | null;
  createdAt: Date;
};

export type CodingCapability = "excellent" | "adequate" | "insufficient";

// ─── Constants ───────────────────────────────────────────────────────────────

export const PHASE_ORDER: BuildPhase[] = [
  "ideate", "plan", "build", "review", "ship", "complete", "failed",
];

export const PHASE_LABELS: Record<BuildPhase, string> = {
  ideate:   "Ideate",
  plan:     "Plan",
  build:    "Build",
  review:   "Review",
  ship:     "Ship",
  complete: "Complete",
  failed:   "Failed",
};

export const PHASE_COLOURS: Record<BuildPhase, string> = {
  ideate:   "#a78bfa",  // purple
  plan:     "#38bdf8",  // blue
  build:    "#fbbf24",  // amber
  review:   "#fb923c",  // orange
  ship:     "#4ade80",  // green
  complete: "#4ade80",  // green
  failed:   "#f87171",  // red
};

export const CODING_CAPABILITY_COLOURS: Record<CodingCapability, string> = {
  excellent:    "#4ade80",
  adequate:     "#fbbf24",
  insufficient: "#f87171",
};

// The five user-visible phases (excludes terminal states)
export const VISIBLE_PHASES: BuildPhase[] = ["ideate", "plan", "build", "review", "ship"];

// ─── Phase Transitions ──────────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<BuildPhase, BuildPhase[]> = {
  ideate:   ["plan", "failed"],
  plan:     ["build", "failed"],
  build:    ["review", "failed"],
  review:   ["ship", "failed"],
  ship:     ["complete", "failed"],
  complete: [],
  failed:   [],
};

export function canTransitionPhase(from: BuildPhase, to: BuildPhase): boolean {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

// ─── Validation ──────────────────────────────────────────────────────────────

export type ValidationResult = { valid: boolean; errors: string[] };

export function validateFeatureBrief(brief: FeatureBrief): ValidationResult {
  const errors: string[] = [];
  if (!brief.title.trim()) errors.push("title is required");
  if (!brief.description.trim()) errors.push("description is required");
  return { valid: errors.length === 0, errors };
}

// ─── ID Generation ───────────────────────────────────────────────────────────

export function generateBuildId(): string {
  return `FB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export function generatePackId(): string {
  return `FP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/feature-build-types.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/feature-build-types.ts apps/web/lib/feature-build-types.test.ts
git commit -m "feat: add feature-build-types with phase transitions and validation"
```

---

## Chunk 2: Task-Aware Provider Priority

### Task 3: Extend Provider Priority With Task-Aware Selection

**Files:**
- Modify: `apps/web/lib/ai-provider-priority.ts`
- Test: `apps/web/lib/ai-provider-priority.test.ts`

- [ ] **Step 1: Write the failing test**

**Append** to existing `apps/web/lib/ai-provider-priority.test.ts` (do NOT overwrite — the file has 4 existing tests that must be preserved):

```typescript
// Append after existing describe blocks:

import {
  resolveTaskPriority,
  type TaskAwarePriority,
  type ProviderPriorityEntry,
} from "./ai-provider-priority";

const SAMPLE_ENTRIES: ProviderPriorityEntry[] = [
  { providerId: "anthropic", modelId: "claude-sonnet-4-20250514", rank: 1, capabilityTier: "deep-thinker" },
  { providerId: "ollama", modelId: "qwen3:8b", rank: 2, capabilityTier: "fast-worker" },
];

const CODE_ENTRIES: ProviderPriorityEntry[] = [
  { providerId: "anthropic", modelId: "claude-sonnet-4-20250514", rank: 1, capabilityTier: "deep-thinker" },
  { providerId: "openai", modelId: "gpt-4o", rank: 2, capabilityTier: "deep-thinker" },
];

describe("resolveTaskPriority", () => {
  it("returns conversation entries for 'conversation' task from task-keyed object", () => {
    const stored: TaskAwarePriority = {
      conversation: SAMPLE_ENTRIES,
      code_generation: CODE_ENTRIES,
    };
    const result = resolveTaskPriority(stored, "conversation");
    expect(result).toEqual(SAMPLE_ENTRIES);
  });

  it("returns code_generation entries for 'code_generation' task", () => {
    const stored: TaskAwarePriority = {
      conversation: SAMPLE_ENTRIES,
      code_generation: CODE_ENTRIES,
    };
    const result = resolveTaskPriority(stored, "code_generation");
    expect(result).toEqual(CODE_ENTRIES);
  });

  it("falls back to conversation for unknown task key", () => {
    const stored: TaskAwarePriority = {
      conversation: SAMPLE_ENTRIES,
      code_generation: CODE_ENTRIES,
    };
    const result = resolveTaskPriority(stored, "analysis");
    expect(result).toEqual(SAMPLE_ENTRIES);
  });

  it("treats flat array as conversation (backward compat)", () => {
    const result = resolveTaskPriority(SAMPLE_ENTRIES, "conversation");
    expect(result).toEqual(SAMPLE_ENTRIES);
  });

  it("treats flat array as conversation even when code_generation requested", () => {
    const result = resolveTaskPriority(SAMPLE_ENTRIES, "code_generation");
    expect(result).toEqual(SAMPLE_ENTRIES);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/ai-provider-priority.test.ts`
Expected: FAIL — `resolveTaskPriority` not exported.

- [ ] **Step 3: Add resolveTaskPriority to ai-provider-priority.ts**

At the top of the file, add the new types after existing types:

```typescript
export type TaskKey = "conversation" | "code_generation" | "analysis";

export type TaskAwarePriority = {
  conversation: ProviderPriorityEntry[];
  code_generation: ProviderPriorityEntry[];
  analysis?: ProviderPriorityEntry[];
};
```

Add the resolver function before `getProviderPriority()`:

```typescript
// ─── Task-Aware Resolution ──────────────────────────────────────────────────

/**
 * Resolves stored priority config into a flat list for a given task.
 * Handles both legacy flat arrays and new task-keyed objects.
 */
export function resolveTaskPriority(
  stored: ProviderPriorityEntry[] | TaskAwarePriority,
  task: string,
): ProviderPriorityEntry[] {
  // Legacy flat array — treat as conversation
  if (Array.isArray(stored)) return stored;

  // Task-keyed object
  const key = task as keyof TaskAwarePriority;
  const entries = stored[key];
  if (Array.isArray(entries) && entries.length > 0) return entries;

  // Fallback to conversation
  return stored.conversation ?? [];
}
```

Then update `getProviderPriority` to accept an optional task parameter:

Change the signature from:
```typescript
export async function getProviderPriority(): Promise<ProviderPriorityEntry[]> {
```
to:
```typescript
export async function getProviderPriority(task: string = "conversation"): Promise<ProviderPriorityEntry[]> {
```

And change the body from:
```typescript
  if (config) {
    const entries = config.value as ProviderPriorityEntry[];
    if (Array.isArray(entries) && entries.length > 0) {
      return entries.sort((a, b) => a.rank - b.rank);
    }
  }
```
to:
```typescript
  if (config) {
    const stored = config.value as ProviderPriorityEntry[] | TaskAwarePriority;
    const entries = resolveTaskPriority(stored, task);
    if (entries.length > 0) {
      return entries.sort((a, b) => a.rank - b.rank);
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/ai-provider-priority.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Verify call sites are backward-compatible**

`getProviderPriority()` is called without arguments in `callWithFailover` (ai-provider-priority.ts) and in `ai-provider-data.ts`. Since the new `task` parameter defaults to `"conversation"`, all existing call sites remain compatible. Verify:

Run: `cd apps/web && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 6: Run full test suite to check for regressions**

Run: `pnpm test`
Expected: All existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/ai-provider-priority.ts apps/web/lib/ai-provider-priority.test.ts
git commit -m "feat: task-aware provider priority with backward-compatible resolution"
```

---

## Chunk 3: Sandbox Infrastructure

### Task 4: Sandbox Lifecycle Module

**Files:**
- Create: `apps/web/lib/sandbox.ts`
- Create: `apps/web/lib/sandbox.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/sandbox.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildSandboxCreateArgs,
  parseSandboxPort,
  SANDBOX_IMAGE,
  SANDBOX_RESOURCE_LIMITS,
  SANDBOX_TIMEOUT_MS,
} from "./sandbox";

describe("SANDBOX_IMAGE", () => {
  it("is dpf-sandbox", () => {
    expect(SANDBOX_IMAGE).toBe("dpf-sandbox");
  });
});

describe("SANDBOX_RESOURCE_LIMITS", () => {
  it("has 2 CPUs", () => {
    expect(SANDBOX_RESOURCE_LIMITS.cpus).toBe(2);
  });

  it("has 4GB memory", () => {
    expect(SANDBOX_RESOURCE_LIMITS.memoryMb).toBe(4096);
  });

  it("has 10GB disk", () => {
    expect(SANDBOX_RESOURCE_LIMITS.diskGb).toBe(10);
  });
});

describe("SANDBOX_TIMEOUT_MS", () => {
  it("is 30 minutes", () => {
    expect(SANDBOX_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });
});

describe("buildSandboxCreateArgs", () => {
  it("builds docker create args with resource limits", () => {
    const args = buildSandboxCreateArgs("FB-ABC12345", 3001);
    expect(args).toContain("--name");
    expect(args).toContain("dpf-sandbox-FB-ABC12345");
    expect(args).toContain("--cpus=2");
    expect(args).toContain("--memory=4096m");
    expect(args).toContain("-p");
    expect(args).toContain("3001:3000");
    expect(args).toContain("dpf-sandbox");
  });

  it("does not use --network=none (sandbox needs npm access)", () => {
    const args = buildSandboxCreateArgs("FB-X", 3002);
    expect(args).not.toContain("--network=none");
  });
});

describe("parseSandboxPort", () => {
  it("extracts port from docker port output", () => {
    expect(parseSandboxPort("0.0.0.0:3001")).toBe(3001);
  });

  it("returns null for empty output", () => {
    expect(parseSandboxPort("")).toBeNull();
  });

  it("returns null for malformed output", () => {
    expect(parseSandboxPort("no-port-here")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/sandbox.test.ts`
Expected: FAIL — module `./sandbox` not found.

- [ ] **Step 3: Write implementation**

Create `apps/web/lib/sandbox.ts`:

```typescript
// apps/web/lib/sandbox.ts
// Sandbox lifecycle management — creates, manages, and destroys Docker containers
// for isolated code generation.

import { exec as execCb } from "child_process";
import { promisify } from "util";

const exec = promisify(execCb);

// ─── Constants ───────────────────────────────────────────────────────────────

export const SANDBOX_IMAGE = "dpf-sandbox";

export const SANDBOX_RESOURCE_LIMITS = {
  cpus: 2,
  memoryMb: 4096,
  diskGb: 10,
} as const;

export const SANDBOX_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function buildSandboxCreateArgs(buildId: string, hostPort: number): string[] {
  // Note: no --network flag — sandbox uses default bridge network so pnpm install
  // can reach npm registry. Internal services (postgres, neo4j) are protected by
  // not mounting .env or any credentials. For production, create a custom network
  // that blocks access to internal service ports.
  return [
    "create",
    "--name", `dpf-sandbox-${buildId}`,
    "--cpus=" + String(SANDBOX_RESOURCE_LIMITS.cpus),
    "--memory=" + String(SANDBOX_RESOURCE_LIMITS.memoryMb) + "m",
    "-p", `${hostPort}:3000`,
    SANDBOX_IMAGE,
  ];
}

export function parseSandboxPort(output: string): number | null {
  const trimmed = output.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/:(\d+)$/);
  if (!match?.[1]) return null;
  const port = parseInt(match[1], 10);
  return Number.isFinite(port) ? port : null;
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export async function createSandbox(buildId: string, hostPort: number): Promise<string> {
  const args = buildSandboxCreateArgs(buildId, hostPort);
  const { stdout } = await exec(`docker ${args.join(" ")}`);
  return stdout.trim(); // returns container ID
}

export async function startSandbox(containerId: string): Promise<void> {
  await exec(`docker start ${containerId}`);
}

export async function execInSandbox(containerId: string, command: string): Promise<string> {
  const { stdout } = await exec(`docker exec ${containerId} sh -c ${JSON.stringify(command)}`);
  return stdout;
}

export async function getSandboxLogs(containerId: string, tail: number = 50): Promise<string> {
  const { stdout } = await exec(`docker logs --tail ${tail} ${containerId}`);
  return stdout;
}

export async function extractDiff(containerId: string): Promise<string> {
  return execInSandbox(containerId, "cd /workspace && git diff");
}

export async function destroySandbox(containerId: string): Promise<void> {
  await exec(`docker rm -f ${containerId}`).catch(() => {
    // Container may already be removed — ignore
  });
}

export async function isSandboxRunning(containerId: string): Promise<boolean> {
  try {
    const { stdout } = await exec(`docker inspect -f "{{.State.Running}}" ${containerId}`);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/sandbox.test.ts`
Expected: All tests PASS (only pure functions tested; Docker calls are not tested here).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/sandbox.ts apps/web/lib/sandbox.test.ts
git commit -m "feat: sandbox lifecycle module with Docker container management"
```

---

### Task 5: Dockerfile + Docker Compose Update

**Files:**
- Create: `Dockerfile.sandbox`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Create Dockerfile.sandbox**

Create `Dockerfile.sandbox` at project root:

```dockerfile
FROM node:20-alpine
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apk add --no-cache git
WORKDIR /workspace
# No database access, no secrets, no Docker socket
# Resource limits applied at container creation
```

- [ ] **Step 2: Add sandbox service to docker-compose.yml**

Add the sandbox service **inside the `services:` block** (before the closing `volumes:` section at line 82). The sandbox is NOT a permanent service — it is created on-demand by the platform. This build definition just lets us pre-build the image:

```yaml
  # ─── Sandbox (build image only, containers created on-demand) ────────────
  sandbox-image:
    build:
      context: .
      dockerfile: Dockerfile.sandbox
    image: dpf-sandbox
    profiles: ["build-images"]  # only built when explicitly requested
    command: ["echo", "Image built successfully"]
```

- [ ] **Step 3: Verify Dockerfile builds**

Run: `docker build -f Dockerfile.sandbox -t dpf-sandbox .`
Expected: Image builds successfully.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile.sandbox docker-compose.yml
git commit -m "feat: add dpf-sandbox Docker image for isolated code generation"
```

---

### Task 6: Preview Proxy API Route

**Files:**
- Create: `apps/web/app/api/sandbox/preview/route.ts`

- [ ] **Step 1: Create the preview proxy route**

```typescript
// apps/web/app/api/sandbox/preview/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const buildId = request.nextUrl.searchParams.get("buildId");
  if (!buildId) {
    return NextResponse.json({ error: "buildId required" }, { status: 400 });
  }

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { sandboxPort: true, sandboxId: true, createdById: true },
  });

  if (!build?.sandboxPort || !build.sandboxId) {
    return NextResponse.json({ error: "Sandbox not running" }, { status: 404 });
  }

  // Only the creator can access the preview
  if (build.createdById !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Proxy the request to the sandbox dev server
  const targetPath = request.nextUrl.searchParams.get("path") ?? "/";
  const targetUrl = `http://localhost:${build.sandboxPort}${targetPath}`;

  try {
    const upstream = await fetch(targetUrl, {
      headers: { "Accept": request.headers.get("Accept") ?? "*/*" },
    });

    const body = await upstream.arrayBuffer();
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "text/html",
      },
    });
  } catch {
    return NextResponse.json({ error: "Sandbox unreachable" }, { status: 502 });
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No type errors (confirms Prisma client has `featureBuild` after migration in Task 1).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/sandbox/preview/route.ts
git commit -m "feat: add sandbox preview proxy API route"
```

---

## Chunk 4: Data Layer + Server Actions

### Task 7: Feature Build Data Fetchers

**Files:**
- Create: `apps/web/lib/feature-build-data.ts`

- [ ] **Step 1: Create data fetcher module**

```typescript
// apps/web/lib/feature-build-data.ts
import { cache } from "react";
import { prisma } from "@dpf/db";
import type { FeatureBuildRow, FeatureBrief, BuildPhase } from "./feature-build-types";

// ─── Feature Builds ──────────────────────────────────────────────────────────

export const getFeatureBuilds = cache(async (userId: string): Promise<FeatureBuildRow[]> => {
  const rows = await prisma.featureBuild.findMany({
    where: { createdById: userId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      buildId: true,
      title: true,
      description: true,
      portfolioId: true,
      brief: true,
      plan: true,
      phase: true,
      sandboxId: true,
      sandboxPort: true,
      diffSummary: true,
      diffPatch: true,
      codingProvider: true,
      threadId: true,
      createdById: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return rows.map((r) => ({
    ...r,
    brief: r.brief as FeatureBrief | null,
    plan: r.plan as Record<string, unknown> | null,
    phase: r.phase as BuildPhase,
  }));
});

export const getFeatureBuildById = cache(async (buildId: string): Promise<FeatureBuildRow | null> => {
  const r = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      id: true,
      buildId: true,
      title: true,
      description: true,
      portfolioId: true,
      brief: true,
      phase: true,
      sandboxId: true,
      sandboxPort: true,
      diffSummary: true,
      diffPatch: true,
      codingProvider: true,
      threadId: true,
      createdById: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!r) return null;

  return {
    ...r,
    brief: r.brief as FeatureBrief | null,
    phase: r.phase as BuildPhase,
  };
});

// Note: For portfolio select dropdowns, reuse getPortfoliosForSelect() from
// "@/lib/backlog-data" (returns { id, slug, name }). No duplicate needed here.

// ─── Coding-Capable Providers ────────────────────────────────────────────────

export type CodingProviderOption = {
  providerId: string;
  modelId: string;
  friendlyName: string;
  codingCapability: string;
};

export const getCodingProviders = cache(async (): Promise<CodingProviderOption[]> => {
  const profiles = await prisma.modelProfile.findMany({
    where: {
      codingCapability: { not: null },
      NOT: { codingCapability: "insufficient" },
    },
    orderBy: [{ codingCapability: "desc" }, { costTier: "asc" }],
    select: {
      providerId: true,
      modelId: true,
      friendlyName: true,
      codingCapability: true,
    },
  });

  return profiles.map((p) => ({
    ...p,
    codingCapability: p.codingCapability ?? "unknown",
  }));
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/feature-build-data.ts
git commit -m "feat: feature build data fetchers with React cache"
```

---

### Task 8: Server Actions for Build Phases

**Files:**
- Create: `apps/web/lib/actions/build.ts`

- [ ] **Step 1: Create server actions module**

```typescript
// apps/web/lib/actions/build.ts
"use server";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma, type Prisma } from "@dpf/db";
import {
  validateFeatureBrief,
  canTransitionPhase,
  generateBuildId,
  type FeatureBrief,
  type BuildPhase,
} from "@/lib/feature-build-types";

// ─── Auth Guard ──────────────────────────────────────────────────────────────

async function requireBuildAccess() {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "view_platform"
    )
  ) {
    throw new Error("Unauthorized");
  }
  return { userId: user.id! };
}

// ─── Create Feature Build ────────────────────────────────────────────────────

export async function createFeatureBuild(input: {
  title: string;
  description?: string;
  portfolioId?: string;
}): Promise<{ buildId: string }> {
  const { userId } = await requireBuildAccess();

  if (!input.title.trim()) throw new Error("Title is required");

  const buildId = generateBuildId();

  await prisma.featureBuild.create({
    data: {
      buildId,
      title: input.title.trim(),
      ...(input.description !== undefined && { description: input.description.trim() || null }),
      ...(input.portfolioId !== undefined && { portfolioId: input.portfolioId || null }),
      createdById: userId,
    },
  });

  return { buildId };
}

// ─── Update Feature Brief ────────────────────────────────────────────────────

export async function updateFeatureBrief(
  buildId: string,
  brief: FeatureBrief,
): Promise<void> {
  const { userId } = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({ where: { buildId } });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");
  if (build.phase !== "ideate") throw new Error("Brief can only be updated during Ideate phase");

  const validation = validateFeatureBrief(brief);
  if (!validation.valid) throw new Error(validation.errors.join(", "));

  await prisma.featureBuild.update({
    where: { buildId },
    data: { brief: brief as unknown as Prisma.InputJsonValue },
  });
}

// ─── Advance Phase ───────────────────────────────────────────────────────────

export async function advanceBuildPhase(
  buildId: string,
  targetPhase: BuildPhase,
): Promise<void> {
  const { userId } = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({ where: { buildId } });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");

  const currentPhase = build.phase as BuildPhase;
  if (!canTransitionPhase(currentPhase, targetPhase)) {
    throw new Error(`Cannot transition from ${currentPhase} to ${targetPhase}`);
  }

  await prisma.featureBuild.update({
    where: { buildId },
    data: { phase: targetPhase },
  });
}

// ─── Update Sandbox Info ─────────────────────────────────────────────────────

export async function updateSandboxInfo(
  buildId: string,
  sandboxId: string,
  sandboxPort: number,
): Promise<void> {
  const { userId } = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({ where: { buildId } });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");

  await prisma.featureBuild.update({
    where: { buildId },
    data: { sandboxId, sandboxPort },
  });
}

// ─── Save Build Results ──────────────────────────────────────────────────────

export async function saveBuildResults(
  buildId: string,
  results: { diffSummary: string; diffPatch: string; codingProvider: string },
): Promise<void> {
  const { userId } = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({ where: { buildId } });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");

  await prisma.featureBuild.update({
    where: { buildId },
    data: {
      diffSummary: results.diffSummary,
      diffPatch: results.diffPatch,
      codingProvider: results.codingProvider,
    },
  });
}

// ─── Delete Feature Build ────────────────────────────────────────────────────

export async function deleteFeatureBuild(buildId: string): Promise<void> {
  const { userId } = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({ where: { buildId } });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");

  await prisma.featureBuild.delete({ where: { buildId } });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/actions/build.ts
git commit -m "feat: server actions for feature build lifecycle"
```

---

### Task 9: Coding Agent Orchestration

**Files:**
- Create: `apps/web/lib/coding-agent.ts`

- [ ] **Step 1: Create coding agent module**

```typescript
// apps/web/lib/coding-agent.ts
// Orchestrates code generation inside a sandbox container.
// Two approaches: Claude Code CLI (preferred) or Direct LLM API (fallback).

import { execInSandbox } from "@/lib/sandbox";
import { getProviderPriority } from "@/lib/ai-provider-priority";
import type { FeatureBrief } from "@/lib/feature-build-types";

// ─── Types ───────────────────────────────────────────────────────────────────

export type CodeGenRequest = {
  containerId: string;
  brief: FeatureBrief;
  plan: Record<string, unknown>;
  instruction?: string; // refinement instruction during iteration
};

export type CodeGenResult = {
  success: boolean;
  filesChanged: string[];
  summary: string;
  providerId: string;
  modelId: string;
  error?: string;
};

// ─── Coding Capability Check ─────────────────────────────────────────────────

export type CodingReadiness = {
  ready: boolean;
  bestProvider: { providerId: string; modelId: string; tier: string } | null;
  message: string;
};

export async function checkCodingReadiness(): Promise<CodingReadiness> {
  const priority = await getProviderPriority("code_generation");

  if (priority.length === 0) {
    return {
      ready: false,
      bestProvider: null,
      message: "No AI providers configured. Please configure a provider in Platform > AI Providers.",
    };
  }

  const best = priority[0]!;
  return {
    ready: true,
    bestProvider: {
      providerId: best.providerId,
      modelId: best.modelId,
      tier: best.capabilityTier,
    },
    message: `Using ${best.providerId}/${best.modelId} for code generation.`,
  };
}

// ─── Build Prompt ────────────────────────────────────────────────────────────

export function buildCodeGenPrompt(brief: FeatureBrief, plan: Record<string, unknown>, instruction?: string): string {
  const parts = [
    "You are a code generation agent working inside a Next.js 14 App Router project.",
    "The project uses TypeScript, Prisma 5, and TailwindCSS with a dark theme.",
    "",
    "## Feature Brief",
    `Title: ${brief.title}`,
    `Description: ${brief.description}`,
    `Portfolio: ${brief.portfolioContext}`,
    `Target Roles: ${brief.targetRoles.join(", ")}`,
    `Data Needs: ${brief.dataNeeds}`,
    "",
    "## Acceptance Criteria",
    ...brief.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`),
    "",
    "## Implementation Plan",
    JSON.stringify(plan, null, 2),
  ];

  if (instruction) {
    parts.push("", "## Refinement Instruction", instruction);
  }

  parts.push(
    "",
    "## Rules",
    "- Write all files to /workspace",
    "- Use TypeScript strict mode",
    "- Follow existing project patterns",
    "- Do NOT modify the database schema",
    "- Do NOT access any external services",
    "- Output each file as: ### FILE: <path>\\n```typescript\\n<content>\\n```",
  );

  return parts.join("\n");
}

// ─── Run Tests in Sandbox ────────────────────────────────────────────────────

export type SandboxTestResult = {
  passed: boolean;
  typeCheckPassed: boolean;
  testOutput: string;
  typeCheckOutput: string;
};

export async function runSandboxTests(containerId: string): Promise<SandboxTestResult> {
  let testOutput = "";
  let testPassed = false;
  try {
    testOutput = await execInSandbox(containerId, "cd /workspace && pnpm test 2>&1 || true");
    testPassed = testOutput.includes("Tests  ") && !testOutput.includes("FAIL");
  } catch (e) {
    testOutput = e instanceof Error ? e.message : String(e);
  }

  let typeCheckOutput = "";
  let typeCheckPassed = false;
  try {
    typeCheckOutput = await execInSandbox(containerId, "cd /workspace && npx tsc --noEmit 2>&1 || true");
    typeCheckPassed = !typeCheckOutput.includes("error TS");
  } catch (e) {
    typeCheckOutput = e instanceof Error ? e.message : String(e);
  }

  return {
    passed: testPassed && typeCheckPassed,
    typeCheckPassed,
    testOutput,
    typeCheckOutput,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/coding-agent.ts
git commit -m "feat: coding agent orchestration with readiness check and prompt builder"
```

---

## Chunk 5: MCP Tools

### Task 10: Add Build Studio MCP Tools

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`
- Modify: `apps/web/lib/mcp-tools.test.ts`

- [ ] **Step 1: Update the test to expect new tools**

In `apps/web/lib/mcp-tools.test.ts`, update the tool count test:

Update **three** count assertions:

1. Change `PLATFORM_TOOLS` count test from `5` to `13`.
2. Change `getAvailableTools` superuser test from `toHaveLength(5)` to `toHaveLength(13)`.

Then add new test cases:

```typescript
describe("Build studio tools", () => {
  const buildToolNames = [
    "start_feature_brief",
    "launch_sandbox",
    "generate_code",
    "iterate_sandbox",
    "preview_sandbox",
    "run_sandbox_tests",
    "deploy_feature",
    "contribute_to_hive",
  ];

  it("all build tools are registered", () => {
    const names = PLATFORM_TOOLS.map((t) => t.name);
    for (const name of buildToolNames) {
      expect(names).toContain(name);
    }
  });

  it("deploy_feature requires manage_capabilities", () => {
    const tool = PLATFORM_TOOLS.find((t) => t.name === "deploy_feature");
    expect(tool?.requiredCapability).toBe("manage_capabilities");
  });

  it("start_feature_brief requires view_platform", () => {
    const tool = PLATFORM_TOOLS.find((t) => t.name === "start_feature_brief");
    expect(tool?.requiredCapability).toBe("view_platform");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/mcp-tools.test.ts`
Expected: FAIL — count is wrong, build tools not found.

- [ ] **Step 3: Add build tools to PLATFORM_TOOLS**

In `apps/web/lib/mcp-tools.ts`, append to the `PLATFORM_TOOLS` array (before the closing `];`):

```typescript
  // ─── Build Studio Tools ─────────────────────────────────────────────────────
  {
    name: "start_feature_brief",
    description: "Create a new FeatureBuild record and start the Ideate phase",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Feature title" },
        description: { type: "string", description: "Plain language description" },
        portfolioContext: { type: "string", description: "Portfolio slug for context" },
      },
      required: ["title"],
    },
    requiredCapability: "view_platform",
  },
  {
    name: "launch_sandbox",
    description: "Spin up a sandbox container, install dependencies, and start the dev server",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "The FeatureBuild ID" },
      },
      required: ["buildId"],
    },
    requiredCapability: "view_platform",
  },
  {
    name: "generate_code",
    description: "Send the implementation plan to the coding agent in the sandbox",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "The FeatureBuild ID" },
      },
      required: ["buildId"],
    },
    requiredCapability: "view_platform",
  },
  {
    name: "iterate_sandbox",
    description: "Send refinement instructions to the coding agent in the sandbox",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "The FeatureBuild ID" },
        instruction: { type: "string", description: "What to change (e.g., 'make the button bigger')" },
      },
      required: ["buildId", "instruction"],
    },
    requiredCapability: "view_platform",
  },
  {
    name: "preview_sandbox",
    description: "Get the sandbox preview proxy URL for the current build",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "The FeatureBuild ID" },
      },
      required: ["buildId"],
    },
    requiredCapability: "view_platform",
  },
  {
    name: "run_sandbox_tests",
    description: "Run pnpm test and tsc --noEmit inside the sandbox, return results",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "The FeatureBuild ID" },
      },
      required: ["buildId"],
    },
    requiredCapability: "view_platform",
  },
  {
    name: "deploy_feature",
    description: "Extract the git diff from the sandbox and apply to the running platform",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "The FeatureBuild ID" },
      },
      required: ["buildId"],
    },
    requiredCapability: "manage_capabilities",
  },
  {
    name: "contribute_to_hive",
    description: "Package the feature as a Feature Pack for contribution to the Hive Mind",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "The FeatureBuild ID" },
        title: { type: "string", description: "Pack title" },
        description: { type: "string", description: "Pack description" },
      },
      required: ["buildId"],
    },
    requiredCapability: "view_platform",
  },
```

- [ ] **Step 4: Add execution handlers for new tools**

In the `executeTool` function switch statement, add cases before `default:`:

```typescript
    case "start_feature_brief": {
      const buildId = `FB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      await prisma.featureBuild.create({
        data: {
          buildId,
          title: String(params["title"] ?? "Untitled Feature"),
          ...(typeof params["description"] === "string" ? { description: params["description"] } : {}),
          ...(typeof params["portfolioContext"] === "string" ? { portfolioId: params["portfolioContext"] } : {}),
          createdById: userId,
        },
      });
      return { success: true, entityId: buildId, message: `Created feature build ${buildId}` };
    }

    case "launch_sandbox":
      return { success: false, error: "Not implemented", message: "Sandbox launch requires Docker — use the Build Studio UI" };

    case "generate_code":
      return { success: false, error: "Not implemented", message: "Code generation requires an active sandbox — use the Build Studio UI" };

    case "iterate_sandbox":
      return { success: false, error: "Not implemented", message: "Iteration requires an active sandbox — use the Build Studio UI" };

    case "preview_sandbox": {
      const previewBuild = await prisma.featureBuild.findUnique({ where: { buildId: String(params["buildId"]) } });
      if (!previewBuild?.sandboxPort) return { success: false, error: "No sandbox", message: "Sandbox not running" };
      return { success: true, message: `/api/sandbox/preview?buildId=${String(params["buildId"])}` };
    }

    case "run_sandbox_tests":
      return { success: false, error: "Not implemented", message: "Test execution requires an active sandbox — use the Build Studio UI" };

    case "deploy_feature":
      return { success: false, error: "Not implemented", message: "Deployment requires review approval — use the Build Studio UI" };

    case "contribute_to_hive": {
      const packId = `FP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      await prisma.featurePack.create({
        data: {
          packId,
          title: String(params["title"] ?? "Untitled Pack"),
          ...(typeof params["description"] === "string" ? { description: params["description"] } : {}),
          buildId: String(params["buildId"]),
          manifest: {},
          status: "local",
        },
      });
      return { success: true, entityId: packId, message: `Created feature pack ${packId}` };
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/mcp-tools.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/mcp-tools.ts apps/web/lib/mcp-tools.test.ts
git commit -m "feat: add 8 build studio MCP tools with capability guards"
```

---

## Chunk 6: UI Components + Page + Nav

> **Styling note:** The code below uses inline `style={{}}` for clarity in the plan. The implementing agent MUST convert static styles to Tailwind utility classes (e.g., `className="flex items-center gap-2 p-4 bg-[var(--dpf-surface-2)]"`), using inline `style` ONLY for dynamic values that depend on runtime data (like phase colours). This matches the project's existing convention in `OpsClient.tsx`, `Header.tsx`, etc.

### Task 11: PhaseIndicator Component

**Files:**
- Create: `apps/web/components/build/PhaseIndicator.tsx`

- [ ] **Step 1: Create the phase indicator**

```tsx
// apps/web/components/build/PhaseIndicator.tsx
"use client";

import { VISIBLE_PHASES, PHASE_LABELS, PHASE_COLOURS, type BuildPhase } from "@/lib/feature-build-types";

type Props = {
  currentPhase: BuildPhase;
};

export function PhaseIndicator({ currentPhase }: Props) {
  const currentIndex = VISIBLE_PHASES.indexOf(currentPhase);

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: "2px",
      padding: "8px 16px",
      background: "var(--dpf-surface-2)",
      borderTop: "1px solid var(--dpf-border)",
    }}>
      {VISIBLE_PHASES.map((phase, i) => {
        const isActive = phase === currentPhase;
        const isDone = currentIndex > i;
        const colour = isDone || isActive ? PHASE_COLOURS[phase] : "var(--dpf-muted)";

        return (
          <div key={phase} style={{ display: "flex", alignItems: "center", flex: 1 }}>
            <div style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "4px",
              flex: 1,
            }}>
              <div style={{
                width: "28px",
                height: "28px",
                borderRadius: "50%",
                border: `2px solid ${colour}`,
                background: isDone || isActive ? colour : "transparent",
                display: "grid",
                placeItems: "center",
                fontSize: "11px",
                fontWeight: 700,
                color: isDone || isActive ? "#0f0f1a" : colour,
              }}>
                {isDone ? "\u2713" : i + 1}
              </div>
              <span style={{
                fontSize: "11px",
                fontWeight: isActive ? 700 : 400,
                color: isActive ? colour : "var(--dpf-muted)",
              }}>
                {PHASE_LABELS[phase]}
              </span>
            </div>
            {i < VISIBLE_PHASES.length - 1 && (
              <div style={{
                height: "2px",
                flex: 1,
                background: isDone ? colour : "var(--dpf-border)",
                minWidth: "16px",
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/build/PhaseIndicator.tsx
git commit -m "feat: PhaseIndicator component for build phase progress"
```

---

### Task 12: FeatureBriefPanel Component

**Files:**
- Create: `apps/web/components/build/FeatureBriefPanel.tsx`

- [ ] **Step 1: Create the feature brief panel**

```tsx
// apps/web/components/build/FeatureBriefPanel.tsx
"use client";

import { type FeatureBrief, type BuildPhase } from "@/lib/feature-build-types";

type Props = {
  brief: FeatureBrief | null;
  phase: BuildPhase;
  diffSummary: string | null;
};

export function FeatureBriefPanel({ brief, phase, diffSummary }: Props) {
  if (phase === "review" || phase === "ship" || phase === "complete") {
    return (
      <div style={{ padding: "16px" }}>
        <h3 style={{ fontSize: "14px", fontWeight: 700, color: "white", marginBottom: "12px" }}>
          Build Summary
        </h3>
        {diffSummary ? (
          <pre style={{
            fontSize: "12px",
            color: "var(--dpf-muted)",
            whiteSpace: "pre-wrap",
            lineHeight: 1.6,
            background: "var(--dpf-surface-2)",
            padding: "12px",
            borderRadius: "6px",
            border: "1px solid var(--dpf-border)",
          }}>
            {diffSummary}
          </pre>
        ) : (
          <p style={{ fontSize: "13px", color: "var(--dpf-muted)" }}>No changes recorded.</p>
        )}
      </div>
    );
  }

  if (!brief) {
    return (
      <div style={{ padding: "16px" }}>
        <p style={{ fontSize: "13px", color: "var(--dpf-muted)" }}>
          Describe your feature idea in the conversation panel. The AI will build a Feature Brief from your description.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
      <h3 style={{ fontSize: "14px", fontWeight: 700, color: "white" }}>Feature Brief</h3>

      <Section label="Title" value={brief.title} />
      <Section label="Description" value={brief.description} />
      <Section label="Portfolio" value={brief.portfolioContext || "Not set"} />
      <Section label="Target Roles" value={brief.targetRoles.join(", ") || "Not set"} />
      <Section label="Data Needs" value={brief.dataNeeds || "Not set"} />

      {brief.acceptanceCriteria.length > 0 && (
        <div>
          <span style={{ fontSize: "11px", color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Acceptance Criteria
          </span>
          <ul style={{ margin: "4px 0 0", paddingLeft: "16px" }}>
            {brief.acceptanceCriteria.map((c, i) => (
              <li key={i} style={{ fontSize: "13px", color: "#ccc", lineHeight: 1.6 }}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Section({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span style={{ fontSize: "11px", color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </span>
      <p style={{ fontSize: "13px", color: "#ccc", margin: "2px 0 0", lineHeight: 1.5 }}>{value}</p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/build/FeatureBriefPanel.tsx
git commit -m "feat: FeatureBriefPanel for displaying feature brief details"
```

---

### Task 13: SandboxPreview Component

**Files:**
- Create: `apps/web/components/build/SandboxPreview.tsx`

- [ ] **Step 1: Create the sandbox preview iframe wrapper**

```tsx
// apps/web/components/build/SandboxPreview.tsx
"use client";

import { type BuildPhase } from "@/lib/feature-build-types";

type Props = {
  buildId: string;
  phase: BuildPhase;
  sandboxPort: number | null;
};

export function SandboxPreview({ buildId, phase, sandboxPort }: Props) {
  const isRunning = sandboxPort !== null && (phase === "build" || phase === "review");

  if (!isRunning) {
    return (
      <div style={{
        flex: 1,
        display: "grid",
        placeItems: "center",
        background: "var(--dpf-surface-2)",
        borderRadius: "8px",
        border: "1px solid var(--dpf-border)",
      }}>
        <div style={{ textAlign: "center", padding: "32px" }}>
          <div style={{ fontSize: "32px", marginBottom: "12px", opacity: 0.3 }}>&#9881;</div>
          <p style={{ fontSize: "14px", color: "var(--dpf-muted)", lineHeight: 1.6 }}>
            {phase === "ideate" || phase === "plan"
              ? "Live preview will appear here once the Build phase starts."
              : phase === "ship" || phase === "complete"
              ? "Feature has been shipped. Sandbox was destroyed."
              : "Sandbox is not running."}
          </p>
        </div>
      </div>
    );
  }

  const previewUrl = `/api/sandbox/preview?buildId=${encodeURIComponent(buildId)}&path=/`;

  return (
    <div style={{
      flex: 1,
      display: "flex",
      flexDirection: "column",
      borderRadius: "8px",
      border: "1px solid var(--dpf-border)",
      overflow: "hidden",
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "6px 12px",
        background: "var(--dpf-surface-2)",
        borderBottom: "1px solid var(--dpf-border)",
        fontSize: "12px",
        color: "var(--dpf-muted)",
      }}>
        <span style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          background: "#4ade80",
        }} />
        Live Preview
      </div>
      <iframe
        src={previewUrl}
        title="Sandbox Preview"
        style={{
          flex: 1,
          border: "none",
          background: "white",
          minHeight: "400px",
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/build/SandboxPreview.tsx
git commit -m "feat: SandboxPreview iframe component with state-aware display"
```

---

### Task 14: BuildStudio Client Component

**Files:**
- Create: `apps/web/components/build/BuildStudio.tsx`

- [ ] **Step 1: Create the three-panel layout**

```tsx
// apps/web/components/build/BuildStudio.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PhaseIndicator } from "./PhaseIndicator";
import { FeatureBriefPanel } from "./FeatureBriefPanel";
import { SandboxPreview } from "./SandboxPreview";
import { createFeatureBuild } from "@/lib/actions/build";
import type { FeatureBuildRow } from "@/lib/feature-build-types";
import type { PortfolioForSelect } from "@/lib/backlog-data";

type Props = {
  builds: FeatureBuildRow[];
  portfolios: PortfolioForSelect[];
};

export function BuildStudio({ builds, portfolios }: Props) {
  const router = useRouter();
  const [activeBuild, setActiveBuild] = useState<FeatureBuildRow | null>(
    builds.find((b) => b.phase !== "complete" && b.phase !== "failed") ?? null,
  );
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  async function handleCreate() {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const { buildId } = await createFeatureBuild({ title: newTitle.trim() });
      // Immediately set the new build as active (optimistic — avoids stale closure)
      setActiveBuild({
        id: "",
        buildId,
        title: newTitle.trim(),
        description: null,
        portfolioId: null,
        brief: null,
        plan: null,
        phase: "ideate",
        sandboxId: null,
        sandboxPort: null,
        diffSummary: null,
        codingProvider: null,
        threadId: null,
        createdById: "",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      setNewTitle("");
      router.refresh();
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 60px)" }}>
      {/* Main content area */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left: Conversation + Build List */}
        <div style={{
          width: "360px",
          borderRight: "1px solid var(--dpf-border)",
          display: "flex",
          flexDirection: "column",
          background: "var(--dpf-surface-1)",
        }}>
          {/* New build form */}
          <div style={{
            padding: "12px",
            borderBottom: "1px solid var(--dpf-border)",
          }}>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                placeholder="Describe a new feature..."
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  fontSize: "13px",
                  background: "var(--dpf-surface-2)",
                  border: "1px solid var(--dpf-border)",
                  borderRadius: "6px",
                  color: "white",
                  outline: "none",
                }}
              />
              <button
                onClick={handleCreate}
                disabled={creating || !newTitle.trim()}
                style={{
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: 600,
                  background: "var(--dpf-accent)",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  cursor: creating ? "wait" : "pointer",
                  opacity: creating || !newTitle.trim() ? 0.5 : 1,
                }}
              >
                New
              </button>
            </div>
          </div>

          {/* Build list */}
          <div style={{ flex: 1, overflow: "auto", padding: "8px" }}>
            {builds.length === 0 ? (
              <p style={{ fontSize: "13px", color: "var(--dpf-muted)", padding: "16px", textAlign: "center" }}>
                No feature builds yet. Describe what you want to build above.
              </p>
            ) : (
              builds.map((build) => (
                <button
                  key={build.buildId}
                  onClick={() => setActiveBuild(build)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    marginBottom: "4px",
                    borderRadius: "6px",
                    border: activeBuild?.buildId === build.buildId
                      ? "1px solid var(--dpf-accent)"
                      : "1px solid transparent",
                    background: activeBuild?.buildId === build.buildId
                      ? "var(--dpf-surface-2)"
                      : "transparent",
                    cursor: "pointer",
                  }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "white", marginBottom: "2px" }}>
                    {build.title}
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--dpf-muted)" }}>
                    {build.buildId} &middot; {build.phase}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right: Preview or Brief */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto" }}>
          {activeBuild ? (
            <>
              {/* Header */}
              <div style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--dpf-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}>
                <div>
                  <h2 style={{ fontSize: "16px", fontWeight: 700, color: "white", margin: 0 }}>
                    {activeBuild.title}
                  </h2>
                  <span style={{ fontSize: "12px", color: "var(--dpf-muted)" }}>
                    {activeBuild.buildId}
                  </span>
                </div>
              </div>

              {/* Content: Brief or Preview depending on phase */}
              <div style={{ flex: 1, display: "flex", padding: "16px", gap: "16px" }}>
                {activeBuild.phase === "build" || activeBuild.phase === "review" ? (
                  <SandboxPreview
                    buildId={activeBuild.buildId}
                    phase={activeBuild.phase}
                    sandboxPort={activeBuild.sandboxPort}
                  />
                ) : (
                  <div style={{ flex: 1 }}>
                    <FeatureBriefPanel
                      brief={activeBuild.brief}
                      phase={activeBuild.phase}
                      diffSummary={activeBuild.diffSummary}
                    />
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{
              flex: 1,
              display: "grid",
              placeItems: "center",
            }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "48px", marginBottom: "16px", opacity: 0.2 }}>&#128736;</div>
                <h2 style={{ fontSize: "18px", fontWeight: 700, color: "white", marginBottom: "8px" }}>
                  Product Development Studio
                </h2>
                <p style={{ fontSize: "14px", color: "var(--dpf-muted)", maxWidth: "400px", lineHeight: 1.6 }}>
                  Describe what you want to build in plain language. The AI will design it, build it in a sandbox, and deploy it when you approve.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom: Phase Indicator */}
      {activeBuild && (
        <PhaseIndicator currentPhase={activeBuild.phase} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/build/BuildStudio.tsx
git commit -m "feat: BuildStudio three-panel client component"
```

---

### Task 15: Build Page + Layout + Nav Update

**Files:**
- Create: `apps/web/app/(shell)/build/layout.tsx`
- Create: `apps/web/app/(shell)/build/page.tsx`
- Modify: `apps/web/components/shell/Header.tsx`
- Modify: `apps/web/lib/permissions.ts`

- [ ] **Step 1: Create layout with auth gate**

Create `apps/web/app/(shell)/build/layout.tsx` — copy the exact pattern from `platform/layout.tsx`:

```tsx
// apps/web/app/(shell)/build/layout.tsx
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";

export default async function BuildLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (
    !session?.user ||
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "view_platform"
    )
  ) {
    notFound();
  }

  return <>{children}</>;
}
```

- [ ] **Step 2: Create server page**

Create `apps/web/app/(shell)/build/page.tsx`:

```tsx
// apps/web/app/(shell)/build/page.tsx
import { auth } from "@/lib/auth";
import { getFeatureBuilds } from "@/lib/feature-build-data";
import { getPortfoliosForSelect } from "@/lib/backlog-data";
import { BuildStudio } from "@/components/build/BuildStudio";

export default async function BuildPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const [builds, portfolios] = await Promise.all([
    getFeatureBuilds(session.user.id),
    getPortfoliosForSelect(),
  ]);

  return <BuildStudio builds={builds} portfolios={portfolios} />;
}
```

- [ ] **Step 3: Add "Build" nav item to Header**

In `apps/web/components/shell/Header.tsx`, add to the `NAV_ITEMS` array after the "AI Workforce" entry:

```typescript
  { label: "Build",        href: "/build",        capability: "view_platform" },
```

- [ ] **Step 4: Add workspace tile for Build**

In `apps/web/lib/permissions.ts`, add to the `ALL_TILES` array after the "ai_workforce" entry:

```typescript
  { key: "build",       label: "Build Studio", route: "/build",       capabilityKey: "view_platform",    accentColor: "#10b981" },
```

- [ ] **Step 5: Run full test suite**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/(shell)/build/ apps/web/components/shell/Header.tsx apps/web/lib/permissions.ts
git commit -m "feat: Build Studio page with auth gate, nav item, and workspace tile"
```

---

## Summary

| Chunk | Tasks | What It Delivers |
|-------|-------|-----------------|
| 1 | 1-2 | Schema (FeatureBuild, FeaturePack, codingCapability) + pure types/helpers + tests |
| 2 | 3 | Task-aware provider priority with backward-compat + tests |
| 3 | 4-6 | Sandbox lifecycle module + Dockerfile + preview proxy route |
| 4 | 7-9 | Data fetchers + server actions + coding agent orchestration |
| 5 | 10 | 8 new MCP build tools with capability guards + tests |
| 6 | 11-15 | PhaseIndicator, FeatureBriefPanel, SandboxPreview, BuildStudio, page + layout + nav |

**Total:** 15 tasks, ~45 steps, 12 new files, 4 modified files.
