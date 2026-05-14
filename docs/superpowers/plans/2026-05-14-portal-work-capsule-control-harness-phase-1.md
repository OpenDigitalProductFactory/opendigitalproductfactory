# Portal Work Capsule Control Harness Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development if the harness offers subagents; otherwise use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the adoption-first Work Capsule registry so DPF can record, inspect, and attach existing branches/worktrees/PRs to governed portal work before automating new worktree creation or production promotion.

**Architecture:** Add `WorkCapsule` and `WorkCapsuleActivity` as the lifecycle layer above `BacklogItem`, `FeatureBuild`, `TaskRun`, git state, and future promotion candidates. Keep domain behavior in focused `apps/web/lib/work-capsules/*` modules; keep `apps/web/lib/mcp-tools.ts` as registration and dispatch only. The first UI at `/build/work` is read-oriented and adoption-oriented, with no production mutation and no automatic worktree deletion.

**Tech Stack:** Next.js 16 App Router, Prisma 7, PostgreSQL, Vitest, DPF MCP tool surface, lucide-react, PowerShell/Windows local git scanning.

---

## Chunk 1: Grounding And Scope

## Live State Used For This Plan

Re-queried through the DPF MCP surface on 2026-05-14 before writing this plan:

- `list_epics(status=open, hasOpenItems=true)` returned 8 open epics with open work: `EP-DOCS-6B9F2A`, `EP-LIC-C64FC2`, `EP-TAK-3F9A21`, `EP-ARCH-8D4F2A`, `EP-CTRL-5E21A4`, `EP-SITE-7C4D2B`, `EP-LAB-6A91C2`, `EP-INT-2E7C1A`.
- `list_backlog_items(status=in-progress)` returned 7 in-progress items, including `BI-BUILD-GRAPH-CYCLE-05140137`, `BI-LIC-3621D8`, `BI-CDA96CAA`, and `BI-ec41b330-9a67-436f-a68d-e8a101693a9c`.
- `list_backlog_items(status=open)` returned active Build Studio/runtime noise under `EP-BUILD-CYCLE-0514`, including `BI-BUILD-PROVENANCE-BYPASS-0514`, `BI-BUILD-FALSE-GREEN-0514`, `BI-BUILD-COWORKER-CHAT-RETRY-0514`, `BI-BUILD-SANDBOX-SOURCE-SYNC-0514`, and many `BI-PIR-*` Server Components render-crash reports.
- `search_specs_and_plans(query="Work Capsule portal control harness Build Studio external Codex Claude worktree adoption")` returned no overlapping existing spec or plan.

Plan consequence: Phase 1 must be adoption-first and visibility-first. It should not try to solve Build Studio execution quality, provider reconciliation, or portal replacement in the same slice.

## Scope

In scope for Phase 1:

- Schema for `WorkCapsule` and `WorkCapsuleActivity`.
- Enum constants and validation helpers.
- A focused Work Capsule service module.
- Read-only git/worktree scanner for adoptable local work.
- MCP tools for create, adopt, list, get, evidence, heartbeat, scope claim/release, and status update.
- Human `requiredCapability` choices, grant catalog, and `TOOL_TO_GRANTS` wiring.
- Read-oriented `/build/work` UI with active/adoptable capsule views.
- Link from `/build` to `/build/work`.

Out of scope for Phase 1:

- Automatic worktree creation.
- Production promotion.
- `ChangePromotion.kind`.
- Daily steward scheduling.
- Automatic deletion, closing, or archiving of historical worktrees.
- GitHub write operations.

## File Structure

- `packages/db/prisma/schema.prisma`: add `WorkCapsule` and `WorkCapsuleActivity`.
- `packages/db/prisma/migrations/20260514_add_work_capsules/migration.sql`: migration generated from Prisma and hand-reviewed.
- `apps/web/lib/work-capsules.ts`: public enum constants, labels, validation helpers, and type guards.
- `apps/web/lib/work-capsules/work-capsule-store.ts`: server-side domain operations over Prisma.
- `apps/web/lib/work-capsules/git-scanner.ts`: safe read-only scanner for local git branches/worktrees.
- `apps/web/lib/work-capsules/work-capsule-presenter.ts`: UI-facing row shaping and status labels.
- `apps/web/lib/actions/work-capsules.ts`: authenticated server actions/loaders for `/build/work`.
- `apps/web/components/build/work-control/WorkControlPanel.tsx`: page composition.
- `apps/web/components/build/work-control/WorkCapsuleTable.tsx`: active capsule table.
- `apps/web/components/build/work-control/AdoptableWorktreeTable.tsx`: adoptable local work table.
- `apps/web/app/(shell)/build/work/page.tsx`: Work Control route.
- `apps/web/components/build/BuildStudio.tsx`: add a compact link to `/build/work`.
- `apps/web/lib/mcp-tools.ts`: register tool definitions and dispatch to handlers.
- `apps/web/lib/work-capsules/mcp-handlers.ts`: handler functions called by `executeTool`.
- `apps/web/lib/tak/agent-grants.ts`: map capsule tools to new grants.
- `apps/web/components/platform/EffectivePermissionsPanel.tsx`: mirror grant mapping for admin visibility.
- `apps/web/lib/tak/agent-grants.test.ts`: grant tests.
- `apps/web/lib/work-capsules/*.test.ts`: unit tests.
- `apps/web/lib/mcp-tools-work-capsules.test.ts`: MCP tool tests.
- `apps/web/components/build/work-control/*.test.tsx`: UI component tests.
- `packages/db/data/grant_catalog.json`: add four grant entries and honored tools.
- `packages/db/data/agent_registry.json`: grant read/write/adopt to Build Studio and external coding agents only where appropriate.

## Chunk 2: Schema And Domain Foundation

## Task 1: Schema Foundation

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260514_add_work_capsules/migration.sql`

- [ ] **Step 1: Add the Prisma models**

Add these models near the task/build governance models in `packages/db/prisma/schema.prisma`:

```prisma
model WorkCapsule {
  id                       String                 @id @default(cuid())
  capsuleId                String                 @unique
  title                    String
  objective                String                 @db.Text
  status                   String                 @default("draft")
  source                   String
  executorKind             String?
  executorRef              String?
  backlogItemId            String?
  epicId                   String?
  featureBuildId           String?
  taskRunId                String?
  gitPromotionCandidateId  String?
  changePromotionId        String?
  repositoryFullName       String?
  baseBranch               String?
  baseSha                  String?
  headBranch               String?
  headSha                  String?
  worktreePath             String?
  pullRequestUrl           String?
  pullRequestNumber        Int?
  sandboxProviderId        String?
  sandboxId                String?
  scopeClaims              Json                   @default("[]")
  workspaceState           Json                   @default("{}")
  verificationState        Json                   @default("{}")
  providerRequirements     Json                   @default("[]")
  promotionPolicy          Json                   @default("{}")
  contributionMode         String                 @default("private")
  branchTaxonomy           String?
  idempotencyKey           String?                @unique
  leaseHolderPrincipalId   String?
  leaseExpiresAt           DateTime?
  createdByPrincipalId     String?
  createdAt                DateTime               @default(now())
  updatedAt                DateTime               @updatedAt
  lastSyncedAt             DateTime?
  archivedAt               DateTime?
  activities               WorkCapsuleActivity[]

  @@index([status, updatedAt])
  @@index([backlogItemId])
  @@index([featureBuildId])
  @@index([headBranch])
  @@index([sandboxId])
  @@index([leaseExpiresAt])
}

model WorkCapsuleActivity {
  id                String       @id @default(cuid())
  workCapsuleId     String
  kind              String
  summary           String
  payload           Json         @default("{}")
  recordedAt        DateTime     @default(now())
  recordedById      String?
  recordedByAgentId String?
  toolExecutionId   String?
  capsule           WorkCapsule  @relation(fields: [workCapsuleId], references: [id], onDelete: Cascade)

  @@index([workCapsuleId, recordedAt(sort: Desc)])
  @@index([kind, recordedAt(sort: Desc)])
}
```

- [ ] **Step 2: Generate the migration**

Run:

```powershell
pnpm --filter @dpf/db exec prisma migrate dev --name add_work_capsules
```

Expected:

```text
Applying migration `20260514_add_work_capsules`
```

If Prisma generates a timestamped folder with a later minute, keep the generated folder name and update this plan checkbox note during execution.

- [ ] **Step 3: Review generated SQL**

Open the generated `migration.sql` and confirm it contains:

```sql
CREATE TABLE "WorkCapsule" (
...
);

CREATE TABLE "WorkCapsuleActivity" (
...
);

CREATE UNIQUE INDEX "WorkCapsule_capsuleId_key" ON "WorkCapsule"("capsuleId");
CREATE UNIQUE INDEX "WorkCapsule_idempotencyKey_key" ON "WorkCapsule"("idempotencyKey");
CREATE INDEX "WorkCapsule_status_updatedAt_idx" ON "WorkCapsule"("status", "updatedAt");
CREATE INDEX "WorkCapsule_leaseExpiresAt_idx" ON "WorkCapsule"("leaseExpiresAt");
```

- [ ] **Step 4: Generate Prisma client**

Run:

```powershell
pnpm --filter @dpf/db generate
```

Expected: Prisma Client generated without schema errors.

- [ ] **Step 5: Commit schema slice**

Run:

```powershell
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -s -m "feat(db): add work capsule registry"
```

## Task 2: Work Capsule Types and Validation

**Files:**
- Create: `apps/web/lib/work-capsules.ts`
- Test: `apps/web/lib/work-capsules.test.ts`

- [ ] **Step 1: Write enum validation tests**

Create `apps/web/lib/work-capsules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  WORK_CAPSULE_ACTIVITY_KINDS,
  WORK_CAPSULE_EXECUTOR_KINDS,
  WORK_CAPSULE_SOURCES,
  WORK_CAPSULE_STATUSES,
  isWorkCapsuleStatus,
  normalizeBranchTaxonomy,
  parseScopeClaims,
} from "./work-capsules";

describe("work capsule enums", () => {
  it("uses hyphenated status values", () => {
    expect(WORK_CAPSULE_STATUSES).toContain("ready-for-review");
    expect(WORK_CAPSULE_STATUSES).toContain("ready-for-promotion");
    expect(WORK_CAPSULE_STATUSES).not.toContain("ready_for_review");
  });

  it("recognizes valid statuses only", () => {
    expect(isWorkCapsuleStatus("working")).toBe(true);
    expect(isWorkCapsuleStatus("in_progress")).toBe(false);
  });

  it("declares source, executor, and activity enums", () => {
    expect(WORK_CAPSULE_SOURCES).toContain("external-adoption");
    expect(WORK_CAPSULE_EXECUTOR_KINDS).toContain("codex-desktop");
    expect(WORK_CAPSULE_ACTIVITY_KINDS).toContain("evidence-recorded");
  });
});

describe("scope claims", () => {
  it("filters invalid scope claims", () => {
    const claims = parseScopeClaims([
      { kind: "path", value: "apps/web/lib/work-capsules.ts", intent: "edit", recordedAt: "2026-05-14T00:00:00.000Z", recordedByPrincipalId: "principal-1" },
      { kind: "bad", value: "x", intent: "edit" },
    ]);

    expect(claims).toHaveLength(1);
    expect(claims[0]?.kind).toBe("path");
  });
});

describe("branch taxonomy", () => {
  it("extracts known branch prefixes", () => {
    expect(normalizeBranchTaxonomy("feat/work-capsules")).toBe("feat");
    expect(normalizeBranchTaxonomy("doc/work-capsules")).toBe("doc");
    expect(normalizeBranchTaxonomy("random")).toBe(null);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/work-capsules.test.ts
```

Expected: FAIL because `apps/web/lib/work-capsules.ts` does not exist.

- [ ] **Step 3: Implement constants and helpers**

Create `apps/web/lib/work-capsules.ts`:

```ts
export const WORK_CAPSULE_STATUSES = [
  "draft",
  "ready",
  "working",
  "blocked",
  "verifying",
  "ready-for-review",
  "ready-for-promotion",
  "complete",
  "abandoned",
  "archived",
] as const;

export type WorkCapsuleStatus = (typeof WORK_CAPSULE_STATUSES)[number];

export const WORK_CAPSULE_SOURCES = [
  "backlog",
  "build-studio",
  "external-adoption",
  "git-promotion",
  "manual",
  "scheduled-steward",
] as const;

export type WorkCapsuleSource = (typeof WORK_CAPSULE_SOURCES)[number];

export const WORK_CAPSULE_EXECUTOR_KINDS = [
  "build-studio",
  "codex-desktop",
  "claude-desktop",
  "human",
  "git-webhook",
  "dpf-native",
] as const;

export type WorkCapsuleExecutorKind = (typeof WORK_CAPSULE_EXECUTOR_KINDS)[number];

export const WORK_CAPSULE_ACTIVITY_KINDS = [
  "created",
  "adopted",
  "status-changed",
  "status-override",
  "executor-changed",
  "scope-claimed",
  "scope-released",
  "evidence-recorded",
  "pr-linked",
  "pr-merged",
  "sandbox-attached",
  "verification-passed",
  "verification-failed",
  "provider-blocked",
  "provider-unblocked",
  "lease-renewed",
  "lease-expired",
  "promotion-prepared",
  "promotion-approved",
  "promotion-rolled-back",
  "archived",
  "superseded",
] as const;

export type WorkCapsuleActivityKind = (typeof WORK_CAPSULE_ACTIVITY_KINDS)[number];

export const WORK_CAPSULE_BRANCH_TAXONOMIES = [
  "feat",
  "fix",
  "chore",
  "doc",
  "clean",
] as const;

export type WorkCapsuleBranchTaxonomy = (typeof WORK_CAPSULE_BRANCH_TAXONOMIES)[number];

export type ScopeClaim = {
  kind: "path" | "module" | "package" | "route" | "skill" | "prompt";
  value: string;
  intent: "edit" | "read";
  recordedAt: string;
  recordedByPrincipalId: string;
};

const STATUS_SET = new Set<string>(WORK_CAPSULE_STATUSES);
const SOURCE_SET = new Set<string>(WORK_CAPSULE_SOURCES);
const EXECUTOR_SET = new Set<string>(WORK_CAPSULE_EXECUTOR_KINDS);
const ACTIVITY_SET = new Set<string>(WORK_CAPSULE_ACTIVITY_KINDS);
const TAXONOMY_SET = new Set<string>(WORK_CAPSULE_BRANCH_TAXONOMIES);
const SCOPE_KIND_SET = new Set<ScopeClaim["kind"]>(["path", "module", "package", "route", "skill", "prompt"]);
const SCOPE_INTENT_SET = new Set<ScopeClaim["intent"]>(["edit", "read"]);

export function isWorkCapsuleStatus(value: unknown): value is WorkCapsuleStatus {
  return typeof value === "string" && STATUS_SET.has(value);
}

export function isWorkCapsuleSource(value: unknown): value is WorkCapsuleSource {
  return typeof value === "string" && SOURCE_SET.has(value);
}

export function isWorkCapsuleExecutorKind(value: unknown): value is WorkCapsuleExecutorKind {
  return typeof value === "string" && EXECUTOR_SET.has(value);
}

export function isWorkCapsuleActivityKind(value: unknown): value is WorkCapsuleActivityKind {
  return typeof value === "string" && ACTIVITY_SET.has(value);
}

export function normalizeBranchTaxonomy(branch: string | null | undefined): WorkCapsuleBranchTaxonomy | null {
  const prefix = branch?.split("/")[0]?.trim();
  return prefix && TAXONOMY_SET.has(prefix) ? (prefix as WorkCapsuleBranchTaxonomy) : null;
}

export function parseScopeClaims(value: unknown): ScopeClaim[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ScopeClaim => {
    if (!entry || typeof entry !== "object") return false;
    const candidate = entry as Record<string, unknown>;
    return (
      typeof candidate.value === "string" &&
      candidate.value.trim().length > 0 &&
      typeof candidate.recordedAt === "string" &&
      typeof candidate.recordedByPrincipalId === "string" &&
      SCOPE_KIND_SET.has(candidate.kind as ScopeClaim["kind"]) &&
      SCOPE_INTENT_SET.has(candidate.intent as ScopeClaim["intent"])
    );
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/work-capsules.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit types slice**

Run:

```powershell
git add apps/web/lib/work-capsules.ts apps/web/lib/work-capsules.test.ts
git commit -s -m "feat(web): add work capsule enums"
```

## Task 3: Domain Store

**Files:**
- Create: `apps/web/lib/work-capsules/work-capsule-store.ts`
- Test: `apps/web/lib/work-capsules/work-capsule-store.test.ts`

- [ ] **Step 1: Write service tests**

Create `apps/web/lib/work-capsules/work-capsule-store.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adoptWorktreeCapsule,
  createWorkCapsule,
  heartbeatWorkCapsule,
  recordWorkCapsuleEvidence,
} from "./work-capsule-store";

const db = {
  workCapsule: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  workCapsuleActivity: {
    create: vi.fn(),
  },
};

describe("work capsule store", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a capsule idempotently", async () => {
    db.workCapsule.upsert.mockResolvedValue({ id: "row-1", capsuleId: "WC-ABC12345", title: "Work control" });

    const result = await createWorkCapsule({
      db,
      input: {
        title: "Work control",
        objective: "Adopt current worktrees.",
        source: "manual",
        idempotencyKey: "manual:work-control",
      },
      actor: { userId: "user-1", agentId: null, principalId: "principal-1" },
    });

    expect(result.capsuleId).toBe("WC-ABC12345");
    expect(db.workCapsule.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { idempotencyKey: "manual:work-control" },
    }));
  });

  it("adopts an existing worktree by repository and branch", async () => {
    db.workCapsule.findFirst.mockResolvedValue(null);
    db.workCapsule.create.mockResolvedValue({ id: "row-1", capsuleId: "WC-ADOPT01" });

    const result = await adoptWorktreeCapsule({
      db,
      input: {
        title: "Adopt feature branch",
        objective: "Recover work in flight.",
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        headBranch: "feat/recovery",
        worktreePath: "D:/DPF-recovery",
        baseBranch: "main",
        baseSha: "base",
        headSha: "head",
        executorKind: "codex-desktop",
      },
      actor: { userId: "user-1", agentId: "codex", principalId: "principal-1" },
    });

    expect(result.capsuleId).toBe("WC-ADOPT01");
    expect(db.workCapsuleActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "adopted" }),
    }));
  });

  it("renews a lease on heartbeat", async () => {
    db.workCapsule.update.mockResolvedValue({ id: "row-1", capsuleId: "WC-LEASE" });

    const result = await heartbeatWorkCapsule({
      db,
      capsuleId: "WC-LEASE",
      actor: { userId: "user-1", agentId: "codex", principalId: "principal-1" },
      now: new Date("2026-05-14T00:00:00.000Z"),
    });

    expect(result.capsuleId).toBe("WC-LEASE");
    expect(db.workCapsule.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leaseHolderPrincipalId: "principal-1" }),
    }));
  });

  it("records evidence append-only", async () => {
    db.workCapsule.findUnique.mockResolvedValue({ id: "row-1", capsuleId: "WC-EVIDENCE" });
    db.workCapsuleActivity.create.mockResolvedValue({ id: "activity-1" });

    await recordWorkCapsuleEvidence({
      db,
      capsuleId: "WC-EVIDENCE",
      evidence: { kind: "test", summary: "Vitest passed", command: "pnpm --filter web test" },
      actor: { userId: "user-1", agentId: null, principalId: "principal-1" },
    });

    expect(db.workCapsuleActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        kind: "evidence-recorded",
        summary: "Vitest passed",
      }),
    }));
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/work-capsules/work-capsule-store.test.ts
```

Expected: FAIL because `work-capsule-store.ts` does not exist.

- [ ] **Step 3: Implement the store**

Create `apps/web/lib/work-capsules/work-capsule-store.ts` with the tested functions. Use this implementation shape:

```ts
import * as crypto from "crypto";
import {
  isWorkCapsuleExecutorKind,
  isWorkCapsuleSource,
  normalizeBranchTaxonomy,
  type WorkCapsuleExecutorKind,
  type WorkCapsuleSource,
} from "@/lib/work-capsules";

const LEASE_TTL_MS = 30 * 60 * 1000;

type Actor = {
  userId: string;
  agentId: string | null;
  principalId: string | null;
};

type CapsuleDb = {
  workCapsule: {
    create(args: any): Promise<any>;
    findFirst(args: any): Promise<any>;
    findUnique(args: any): Promise<any>;
    update(args: any): Promise<any>;
    upsert(args: any): Promise<any>;
  };
  workCapsuleActivity: {
    create(args: any): Promise<any>;
  };
};

function nextCapsuleId(): string {
  return `WC-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

function leaseUntil(now = new Date()): Date {
  return new Date(now.getTime() + LEASE_TTL_MS);
}

async function recordActivity(db: CapsuleDb, input: {
  workCapsuleId: string;
  kind: string;
  summary: string;
  payload?: Record<string, unknown>;
  actor: Actor;
}) {
  return db.workCapsuleActivity.create({
    data: {
      workCapsuleId: input.workCapsuleId,
      kind: input.kind,
      summary: input.summary,
      payload: input.payload ?? {},
      recordedById: input.actor.userId,
      recordedByAgentId: input.actor.agentId,
    },
  });
}

export async function createWorkCapsule(args: {
  db: CapsuleDb;
  input: {
    title: string;
    objective: string;
    source: WorkCapsuleSource;
    idempotencyKey: string;
    executorKind?: WorkCapsuleExecutorKind | null;
  };
  actor: Actor;
}) {
  if (!isWorkCapsuleSource(args.input.source)) throw new Error("Invalid capsule source");
  if (args.input.executorKind && !isWorkCapsuleExecutorKind(args.input.executorKind)) throw new Error("Invalid executor kind");

  const capsule = await args.db.workCapsule.upsert({
    where: { idempotencyKey: args.input.idempotencyKey },
    update: {},
    create: {
      capsuleId: nextCapsuleId(),
      title: args.input.title,
      objective: args.input.objective,
      source: args.input.source,
      executorKind: args.input.executorKind ?? null,
      idempotencyKey: args.input.idempotencyKey,
      createdByPrincipalId: args.actor.principalId,
      status: args.input.executorKind ? "ready" : "draft",
    },
  });

  await recordActivity(args.db, {
    workCapsuleId: capsule.id,
    kind: "created",
    summary: `Created Work Capsule ${capsule.capsuleId}`,
    actor: args.actor,
  });

  return capsule;
}

export async function adoptWorktreeCapsule(args: {
  db: CapsuleDb;
  input: {
    title: string;
    objective: string;
    repositoryFullName: string;
    headBranch: string;
    worktreePath: string;
    baseBranch?: string | null;
    baseSha?: string | null;
    headSha?: string | null;
    executorKind?: WorkCapsuleExecutorKind | null;
  };
  actor: Actor;
}) {
  const existing = await args.db.workCapsule.findFirst({
    where: {
      repositoryFullName: args.input.repositoryFullName,
      headBranch: args.input.headBranch,
      archivedAt: null,
    },
  });
  if (existing) return existing;

  const now = new Date();
  const capsule = await args.db.workCapsule.create({
    data: {
      capsuleId: nextCapsuleId(),
      title: args.input.title,
      objective: args.input.objective,
      source: "external-adoption",
      status: "ready",
      executorKind: args.input.executorKind ?? null,
      repositoryFullName: args.input.repositoryFullName,
      baseBranch: args.input.baseBranch ?? "main",
      baseSha: args.input.baseSha ?? null,
      headBranch: args.input.headBranch,
      headSha: args.input.headSha ?? null,
      worktreePath: args.input.worktreePath,
      branchTaxonomy: normalizeBranchTaxonomy(args.input.headBranch),
      leaseHolderPrincipalId: args.actor.principalId,
      leaseExpiresAt: args.input.executorKind ? leaseUntil(now) : null,
      createdByPrincipalId: args.actor.principalId,
      lastSyncedAt: now,
    },
  });

  await recordActivity(args.db, {
    workCapsuleId: capsule.id,
    kind: "adopted",
    summary: `Adopted ${args.input.headBranch}`,
    payload: { worktreePath: args.input.worktreePath },
    actor: args.actor,
  });

  return capsule;
}

export async function heartbeatWorkCapsule(args: {
  db: CapsuleDb;
  capsuleId: string;
  actor: Actor;
  now?: Date;
}) {
  const nextLease = leaseUntil(args.now ?? new Date());
  const capsule = await args.db.workCapsule.update({
    where: { capsuleId: args.capsuleId },
    data: {
      leaseHolderPrincipalId: args.actor.principalId,
      leaseExpiresAt: nextLease,
    },
  });
  await recordActivity(args.db, {
    workCapsuleId: capsule.id,
    kind: "lease-renewed",
    summary: `Lease renewed until ${nextLease.toISOString()}`,
    actor: args.actor,
  });
  return capsule;
}

export async function recordWorkCapsuleEvidence(args: {
  db: CapsuleDb;
  capsuleId: string;
  evidence: { kind: string; summary: string; command?: string; url?: string; result?: unknown };
  actor: Actor;
}) {
  const capsule = await args.db.workCapsule.findUnique({ where: { capsuleId: args.capsuleId } });
  if (!capsule) throw new Error(`Work Capsule ${args.capsuleId} not found`);
  return recordActivity(args.db, {
    workCapsuleId: capsule.id,
    kind: "evidence-recorded",
    summary: args.evidence.summary,
    payload: args.evidence,
    actor: args.actor,
  });
}
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/work-capsules/work-capsule-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit store slice**

Run:

```powershell
git add apps/web/lib/work-capsules/work-capsule-store.ts apps/web/lib/work-capsules/work-capsule-store.test.ts
git commit -s -m "feat(web): add work capsule store"
```

## Chunk 3: Scanner And MCP Surface

## Task 4: Read-Only Git and Worktree Scanner

**Files:**
- Create: `apps/web/lib/work-capsules/git-scanner.ts`
- Test: `apps/web/lib/work-capsules/git-scanner.test.ts`

- [ ] **Step 1: Write scanner tests**

Create `apps/web/lib/work-capsules/git-scanner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  parseGitStatusPorcelain,
  parsePrUrlFromText,
  parseWorktreeList,
  shouldSurfaceAdoptableBranch,
} from "./git-scanner";

describe("git scanner parsing", () => {
  it("parses dirty and untracked file counts", () => {
    const parsed = parseGitStatusPorcelain(" M apps/web/a.ts\n?? tmp/out.txt\nA  docs/new.md\n");
    expect(parsed.modifiedCount).toBe(2);
    expect(parsed.untrackedCount).toBe(1);
  });

  it("parses worktree list porcelain output", () => {
    const worktrees = parseWorktreeList("worktree D:/DPF\nHEAD abc123\nbranch refs/heads/main\n\nworktree D:/DPF-feature\nHEAD def456\nbranch refs/heads/feat/demo\n");
    expect(worktrees).toEqual([
      { path: "D:/DPF", headSha: "abc123", branch: "main" },
      { path: "D:/DPF-feature", headSha: "def456", branch: "feat/demo" },
    ]);
  });

  it("extracts a PR URL from text", () => {
    expect(parsePrUrlFromText("see https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/596")).toBe("https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/596");
  });

  it("surfaces dirty worktrees and recent ahead branches", () => {
    expect(shouldSurfaceAdoptableBranch({ hasOpenPr: false, dirtyCount: 1, aheadCount: 0, lastCommitAt: null, now: new Date("2026-05-14") })).toBe(true);
    expect(shouldSurfaceAdoptableBranch({ hasOpenPr: false, dirtyCount: 0, aheadCount: 1, lastCommitAt: new Date("2026-05-01"), now: new Date("2026-05-14") })).toBe(true);
    expect(shouldSurfaceAdoptableBranch({ hasOpenPr: false, dirtyCount: 0, aheadCount: 1, lastCommitAt: new Date("2025-12-01"), now: new Date("2026-05-14") })).toBe(false);
  });
});
```

- [ ] **Step 2: Run scanner tests to verify failure**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/work-capsules/git-scanner.test.ts
```

Expected: FAIL because `git-scanner.ts` does not exist.

- [ ] **Step 3: Implement pure parsing helpers and shell wrapper**

Create `apps/web/lib/work-capsules/git-scanner.ts`:

```ts
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const RECENT_BRANCH_DAYS = 45;

export type WorktreeInfo = {
  path: string;
  headSha: string | null;
  branch: string | null;
};

export type GitDirtySummary = {
  modifiedCount: number;
  untrackedCount: number;
};

export type AdoptableBranchDecision = {
  hasOpenPr: boolean;
  dirtyCount: number;
  aheadCount: number;
  lastCommitAt: Date | null;
  now: Date;
};

export function parseGitStatusPorcelain(output: string): GitDirtySummary {
  let modifiedCount = 0;
  let untrackedCount = 0;
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line.startsWith("??")) untrackedCount += 1;
    else modifiedCount += 1;
  }
  return { modifiedCount, untrackedCount };
}

export function parseWorktreeList(output: string): WorktreeInfo[] {
  const records = output.split(/\r?\n\r?\n/).map((entry) => entry.trim()).filter(Boolean);
  return records.map((record) => {
    const row: WorktreeInfo = { path: "", headSha: null, branch: null };
    for (const line of record.split(/\r?\n/)) {
      if (line.startsWith("worktree ")) row.path = line.slice("worktree ".length).trim();
      if (line.startsWith("HEAD ")) row.headSha = line.slice("HEAD ".length).trim();
      if (line.startsWith("branch refs/heads/")) row.branch = line.slice("branch refs/heads/".length).trim();
    }
    return row;
  }).filter((row) => row.path.length > 0);
}

export function parsePrUrlFromText(text: string | null | undefined): string | null {
  const match = text?.match(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/);
  return match?.[0] ?? null;
}

export function shouldSurfaceAdoptableBranch(input: AdoptableBranchDecision): boolean {
  if (input.hasOpenPr) return true;
  if (input.dirtyCount > 0) return true;
  if (input.aheadCount <= 0 || !input.lastCommitAt) return false;
  const ageMs = input.now.getTime() - input.lastCommitAt.getTime();
  return ageMs <= RECENT_BRANCH_DAYS * 24 * 60 * 60 * 1000;
}

export async function scanGitWorktrees(repoRoot: string): Promise<WorktreeInfo[]> {
  const { stdout } = await execFileAsync("git", ["-C", repoRoot, "worktree", "list", "--porcelain"], {
    timeout: 5000,
    windowsHide: true,
  });
  return parseWorktreeList(stdout);
}

export async function getWorktreeDirtySummary(worktreePath: string): Promise<GitDirtySummary> {
  const { stdout } = await execFileAsync("git", ["-C", worktreePath, "status", "--porcelain"], {
    timeout: 5000,
    windowsHide: true,
  });
  return parseGitStatusPorcelain(stdout);
}
```

- [ ] **Step 4: Run scanner tests to verify pass**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/work-capsules/git-scanner.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit scanner slice**

Run:

```powershell
git add apps/web/lib/work-capsules/git-scanner.ts apps/web/lib/work-capsules/git-scanner.test.ts
git commit -s -m "feat(web): add worktree scanner"
```

## Task 5: MCP Tools and Grants

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`
- Create: `apps/web/lib/work-capsules/mcp-handlers.ts`
- Test: `apps/web/lib/mcp-tools-work-capsules.test.ts`
- Modify: `apps/web/lib/tak/agent-grants.ts`
- Modify: `apps/web/components/platform/EffectivePermissionsPanel.tsx`
- Modify: `apps/web/lib/tak/agent-grants.test.ts`
- Modify: `packages/db/data/grant_catalog.json`
- Modify: `packages/db/data/agent_registry.json`

- [ ] **Step 1: Write MCP handler tests**

Create `apps/web/lib/mcp-tools-work-capsules.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  workCapsule: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  workCapsuleActivity: {
    create: vi.fn(),
  },
};

vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));

describe("work capsule MCP tools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("list_work_capsules returns capsule rows", async () => {
    mockPrisma.workCapsule.findMany.mockResolvedValue([
      { capsuleId: "WC-1", title: "Adopt work", status: "ready", source: "external-adoption", executorKind: "codex-desktop", updatedAt: new Date("2026-05-14T00:00:00.000Z") },
    ]);

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool("list_work_capsules", { status: "ready" }, "user-1");

    expect(result.success).toBe(true);
    expect(result.data?.capsules).toEqual([
      expect.objectContaining({ capsuleId: "WC-1", status: "ready" }),
    ]);
  });

  it("create_work_capsule requires idempotencyKey", async () => {
    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool("create_work_capsule", { title: "No key", objective: "Missing key", source: "manual" }, "user-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("missing_idempotencyKey");
  });

  it("heartbeat_capsule renews a lease", async () => {
    mockPrisma.workCapsule.update.mockResolvedValue({ id: "row-1", capsuleId: "WC-1" });
    mockPrisma.workCapsuleActivity.create.mockResolvedValue({ id: "activity-1" });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool("heartbeat_capsule", { capsuleId: "WC-1" }, "user-1", { agentId: "codex" });

    expect(result.success).toBe(true);
    expect(mockPrisma.workCapsule.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { capsuleId: "WC-1" },
    }));
  });
});
```

- [ ] **Step 2: Run MCP tests to verify failure**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/mcp-tools-work-capsules.test.ts
```

Expected: FAIL because the tools are not registered.

- [ ] **Step 3: Add handler module**

Create `apps/web/lib/work-capsules/mcp-handlers.ts` and delegate to the store:

```ts
import { prisma } from "@dpf/db";
import type { ToolResult } from "@/lib/mcp-tools";
import {
  WORK_CAPSULE_EXECUTOR_KINDS,
  WORK_CAPSULE_SOURCES,
  WORK_CAPSULE_STATUSES,
  isWorkCapsuleExecutorKind,
  isWorkCapsuleSource,
  isWorkCapsuleStatus,
} from "@/lib/work-capsules";
import {
  adoptWorktreeCapsule,
  createWorkCapsule,
  heartbeatWorkCapsule,
  recordWorkCapsuleEvidence,
} from "./work-capsule-store";

type ToolContext = { routeContext?: string; agentId?: string; threadId?: string; taskRunId?: string } | undefined;

function actor(userId: string, context: ToolContext) {
  return { userId, agentId: context?.agentId ?? null, principalId: context?.agentId ?? userId };
}

function stringParam(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function workCapsuleToolEnums() {
  return {
    statuses: [...WORK_CAPSULE_STATUSES],
    sources: [...WORK_CAPSULE_SOURCES],
    executors: [...WORK_CAPSULE_EXECUTOR_KINDS],
  };
}

export async function listWorkCapsulesTool(params: Record<string, unknown>): Promise<ToolResult> {
  const status = stringParam(params, "status");
  const capsules = await prisma.workCapsule.findMany({
    where: status && isWorkCapsuleStatus(status) ? { status } : {},
    orderBy: { updatedAt: "desc" },
    take: typeof params.limit === "number" ? Math.min(Math.max(params.limit, 1), 100) : 50,
    select: {
      capsuleId: true,
      title: true,
      status: true,
      source: true,
      executorKind: true,
      headBranch: true,
      worktreePath: true,
      pullRequestUrl: true,
      leaseExpiresAt: true,
      lastSyncedAt: true,
      updatedAt: true,
    },
  });
  return { success: true, message: `Listed ${capsules.length} work capsule(s).`, data: { capsules } };
}

export async function getWorkCapsuleTool(params: Record<string, unknown>): Promise<ToolResult> {
  const capsuleId = stringParam(params, "capsuleId");
  if (!capsuleId) return { success: false, error: "missing_capsuleId", message: "capsuleId is required." };
  const capsule = await prisma.workCapsule.findUnique({
    where: { capsuleId },
    include: { activities: { orderBy: { recordedAt: "desc" }, take: 25 } },
  });
  if (!capsule) return { success: false, error: "not_found", message: `Work Capsule ${capsuleId} not found.` };
  return { success: true, entityId: capsule.capsuleId, message: `Loaded ${capsule.capsuleId}.`, data: { capsule } };
}

export async function createWorkCapsuleTool(params: Record<string, unknown>, userId: string, context: ToolContext): Promise<ToolResult> {
  const idempotencyKey = stringParam(params, "idempotencyKey");
  const title = stringParam(params, "title");
  const objective = stringParam(params, "objective");
  const source = stringParam(params, "source");
  if (!idempotencyKey) return { success: false, error: "missing_idempotencyKey", message: "idempotencyKey is required." };
  if (!title || !objective || !source || !isWorkCapsuleSource(source)) return { success: false, error: "invalid_input", message: "title, objective, and valid source are required." };
  const executorKind = stringParam(params, "executorKind");
  const capsule = await createWorkCapsule({
    db: prisma,
    input: {
      title,
      objective,
      source,
      idempotencyKey,
      executorKind: executorKind && isWorkCapsuleExecutorKind(executorKind) ? executorKind : null,
    },
    actor: actor(userId, context),
  });
  return { success: true, entityId: capsule.capsuleId, message: `Created Work Capsule ${capsule.capsuleId}.`, data: { capsule } };
}

export async function heartbeatCapsuleTool(params: Record<string, unknown>, userId: string, context: ToolContext): Promise<ToolResult> {
  const capsuleId = stringParam(params, "capsuleId");
  if (!capsuleId) return { success: false, error: "missing_capsuleId", message: "capsuleId is required." };
  const capsule = await heartbeatWorkCapsule({ db: prisma, capsuleId, actor: actor(userId, context) });
  return { success: true, entityId: capsule.capsuleId, message: `Renewed lease for ${capsule.capsuleId}.`, data: { capsule } };
}

export async function recordCapsuleEvidenceTool(params: Record<string, unknown>, userId: string, context: ToolContext): Promise<ToolResult> {
  const capsuleId = stringParam(params, "capsuleId");
  const summary = stringParam(params, "summary");
  if (!capsuleId || !summary) return { success: false, error: "invalid_input", message: "capsuleId and summary are required." };
  await recordWorkCapsuleEvidence({
    db: prisma,
    capsuleId,
    evidence: {
      kind: stringParam(params, "kind") ?? "note",
      summary,
      command: stringParam(params, "command") ?? undefined,
      url: stringParam(params, "url") ?? undefined,
      result: params.result,
    },
    actor: actor(userId, context),
  });
  return { success: true, entityId: capsuleId, message: `Recorded evidence for ${capsuleId}.` };
}
```

- [ ] **Step 4: Register tool definitions**

Add Work Capsule tools to `PLATFORM_TOOLS` in `apps/web/lib/mcp-tools.ts` near the backlog/governed work tools. Use `workCapsuleToolEnums()` for enum arrays so the MCP schema mirrors `work-capsules.ts`:

```ts
import { workCapsuleToolEnums } from "@/lib/work-capsules/mcp-handlers";
```

Add definitions for:

- `list_work_capsules`
- `get_work_capsule`
- `create_work_capsule`
- `adopt_worktree`
- `claim_capsule_scope`
- `record_capsule_evidence`
- `heartbeat_capsule`
- `update_work_capsule_status`
- `release_capsule_scope`

Each definition uses `requiredCapability: "view_platform"`, `sideEffect: false` for reads, and `sideEffect: true` for writes. Use the enum arrays returned by `workCapsuleToolEnums()`.

- [ ] **Step 5: Dispatch tool cases**

Inside `executeTool`, add cases that call the handler module. Keep the switch small:

```ts
    case "list_work_capsules": {
      const { listWorkCapsulesTool } = await import("@/lib/work-capsules/mcp-handlers");
      return listWorkCapsulesTool(params);
    }
    case "get_work_capsule": {
      const { getWorkCapsuleTool } = await import("@/lib/work-capsules/mcp-handlers");
      return getWorkCapsuleTool(params);
    }
    case "create_work_capsule": {
      const { createWorkCapsuleTool } = await import("@/lib/work-capsules/mcp-handlers");
      return createWorkCapsuleTool(params, userId, context);
    }
    case "heartbeat_capsule": {
      const { heartbeatCapsuleTool } = await import("@/lib/work-capsules/mcp-handlers");
      return heartbeatCapsuleTool(params, userId, context);
    }
    case "record_capsule_evidence": {
      const { recordCapsuleEvidenceTool } = await import("@/lib/work-capsules/mcp-handlers");
      return recordCapsuleEvidenceTool(params, userId, context);
    }
```

For `adopt_worktree`, `claim_capsule_scope`, `update_work_capsule_status`, and `release_capsule_scope`, do not register the tool cases until the matching handlers in Task 6 exist. A tool must not be visible through MCP if its final handler is not implemented.

- [ ] **Step 6: Wire grants**

In `apps/web/lib/tak/agent-grants.ts`, add:

```ts
  list_work_capsules: ["work_capsule_read"],
  get_work_capsule: ["work_capsule_read"],
  create_work_capsule: ["work_capsule_write"],
  adopt_worktree: ["work_capsule_adopt"],
  claim_capsule_scope: ["work_capsule_write"],
  record_capsule_evidence: ["work_capsule_write"],
  heartbeat_capsule: ["work_capsule_write"],
  update_work_capsule_status: ["work_capsule_write"],
  release_capsule_scope: ["work_capsule_write"],
```

Mirror the same mapping in `apps/web/components/platform/EffectivePermissionsPanel.tsx`.

Do not add `work_capsule_*` to `apps/web/lib/govern/permissions.ts` or `apps/web/lib/permissions.ts`. Those files define human platform capabilities. The Work Capsule grant keys are agent tool grants enforced by `TOOL_TO_GRANTS` and the seeded grant catalog.

- [ ] **Step 7: Add grant tests**

Append to `apps/web/lib/tak/agent-grants.test.ts`:

```ts
describe("TOOL_TO_GRANTS - Work Capsule entries", () => {
  it("read tools require work_capsule_read", () => {
    expect(isToolAllowedByGrants("list_work_capsules", ["work_capsule_read"])).toBe(true);
    expect(isToolAllowedByGrants("get_work_capsule", ["work_capsule_read"])).toBe(true);
    expect(isToolAllowedByGrants("list_work_capsules", ["backlog_read"])).toBe(false);
  });

  it("write tools require work_capsule_write", () => {
    expect(isToolAllowedByGrants("create_work_capsule", ["work_capsule_write"])).toBe(true);
    expect(isToolAllowedByGrants("record_capsule_evidence", ["work_capsule_write"])).toBe(true);
    expect(isToolAllowedByGrants("heartbeat_capsule", ["work_capsule_read"])).toBe(false);
  });

  it("adoption requires work_capsule_adopt", () => {
    expect(isToolAllowedByGrants("adopt_worktree", ["work_capsule_adopt"])).toBe(true);
    expect(isToolAllowedByGrants("adopt_worktree", ["work_capsule_write"])).toBe(false);
  });
});
```

- [ ] **Step 8: Update grant catalog and seeded agents**

Add grant catalog entries in `packages/db/data/grant_catalog.json`:

```json
{
  "key": "work_capsule_read",
  "description": "Read Work Capsule coordination records.",
  "category": "integrate",
  "sensitivity": "internal",
  "honored_by_tools": ["list_work_capsules", "get_work_capsule"],
  "implies": []
}
```

Add matching entries for `work_capsule_write`, `work_capsule_adopt`, and `work_capsule_promote`. Do not add `work_capsule_promote` to any agent in Phase 1.

In `packages/db/data/agent_registry.json`, grant `work_capsule_read`, `work_capsule_write`, and `work_capsule_adopt` to Build Studio and coding/external agent profiles that already hold `sandbox_execute` or `build_promote`. Grant `work_capsule_read` only to non-coding coordinator agents.

- [ ] **Step 9: Run focused tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/mcp-tools-work-capsules.test.ts apps/web/lib/tak/agent-grants.test.ts
```

Expected: PASS for the tools implemented in this task. If any Work Capsule tool case is visible through `executeTool`, it must have a real handler, not a temporary fallback response.

- [ ] **Step 10: Commit MCP slice**

Run:

```powershell
git add apps/web/lib/mcp-tools.ts apps/web/lib/work-capsules/mcp-handlers.ts apps/web/lib/mcp-tools-work-capsules.test.ts apps/web/lib/tak/agent-grants.ts apps/web/lib/tak/agent-grants.test.ts apps/web/components/platform/EffectivePermissionsPanel.tsx packages/db/data/grant_catalog.json packages/db/data/agent_registry.json
git commit -s -m "feat(web): expose work capsule MCP tools"
```

## Task 6: Complete Adoption, Scope, Status, and Evidence Handlers

**Files:**
- Modify: `apps/web/lib/work-capsules/work-capsule-store.ts`
- Modify: `apps/web/lib/work-capsules/mcp-handlers.ts`
- Modify: `apps/web/lib/mcp-tools-work-capsules.test.ts`

- [ ] **Step 1: Add tests for adoption and scope**

Extend `apps/web/lib/mcp-tools-work-capsules.test.ts`:

```ts
  it("adopt_worktree creates a capsule for a branch/worktree pair", async () => {
    mockPrisma.workCapsule.findFirst.mockResolvedValue(null);
    mockPrisma.workCapsule.create.mockResolvedValue({ id: "row-1", capsuleId: "WC-ADOPT" });
    mockPrisma.workCapsuleActivity.create.mockResolvedValue({ id: "activity-1" });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool("adopt_worktree", {
      title: "Adopt recovery branch",
      objective: "Recover useful work.",
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      headBranch: "fix/recovery",
      worktreePath: "D:/DPF-recovery",
      executorKind: "codex-desktop",
    }, "user-1", { agentId: "codex" });

    expect(result.success).toBe(true);
    expect(result.entityId).toBe("WC-ADOPT");
  });

  it("claim_capsule_scope stores typed scope claims", async () => {
    mockPrisma.workCapsule.findUnique.mockResolvedValue({ id: "row-1", capsuleId: "WC-SCOPE", scopeClaims: [] });
    mockPrisma.workCapsule.update.mockResolvedValue({ id: "row-1", capsuleId: "WC-SCOPE" });
    mockPrisma.workCapsuleActivity.create.mockResolvedValue({ id: "activity-1" });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool("claim_capsule_scope", {
      capsuleId: "WC-SCOPE",
      claims: [{ kind: "path", value: "apps/web/lib/work-capsules.ts", intent: "edit" }],
    }, "user-1");

    expect(result.success).toBe(true);
    expect(mockPrisma.workCapsule.update).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Implement missing store operations**

Add these exports to `work-capsule-store.ts`:

```ts
export async function claimWorkCapsuleScope(args: {
  db: CapsuleDb;
  capsuleId: string;
  claims: Array<{ kind: string; value: string; intent: string }>;
  actor: Actor;
  now?: Date;
}) {
  const capsule = await args.db.workCapsule.findUnique({ where: { capsuleId: args.capsuleId } });
  if (!capsule) throw new Error(`Work Capsule ${args.capsuleId} not found`);
  const recordedAt = (args.now ?? new Date()).toISOString();
  const principalId = args.actor.principalId ?? args.actor.userId;
  const existing = Array.isArray(capsule.scopeClaims) ? capsule.scopeClaims : [];
  const nextClaims = args.claims.map((claim) => ({
    kind: claim.kind,
    value: claim.value,
    intent: claim.intent,
    recordedAt,
    recordedByPrincipalId: principalId,
  }));
  const merged = [...existing, ...nextClaims];
  const updated = await args.db.workCapsule.update({
    where: { capsuleId: args.capsuleId },
    data: { scopeClaims: merged },
  });
  await recordActivity(args.db, {
    workCapsuleId: capsule.id,
    kind: "scope-claimed",
    summary: `Claimed ${nextClaims.length} scope item(s)`,
    payload: { claims: nextClaims },
    actor: args.actor,
  });
  return updated;
}

export async function updateWorkCapsuleStatus(args: {
  db: CapsuleDb;
  capsuleId: string;
  status: string;
  reason: string;
  actor: Actor;
}) {
  const updated = await args.db.workCapsule.update({
    where: { capsuleId: args.capsuleId },
    data: {
      status: args.status,
      workspaceState: {
        statusOverride: {
          reason: args.reason,
          until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      },
    },
  });
  await recordActivity(args.db, {
    workCapsuleId: updated.id,
    kind: "status-override",
    summary: args.reason,
    payload: { status: args.status },
    actor: args.actor,
  });
  return updated;
}
```

- [ ] **Step 3: Wire the remaining MCP handlers**

Implement and register `adoptWorktreeTool`, `claimCapsuleScopeTool`, `updateWorkCapsuleStatusTool`, and `releaseCapsuleScopeTool` with explicit parameter validation and calls to the store module. Before committing, search `apps/web/lib/work-capsules/mcp-handlers.ts` and `apps/web/lib/mcp-tools.ts` for temporary fallback responses and remove any that remain.

- [ ] **Step 4: Run MCP tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/mcp-tools-work-capsules.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit handler completion**

Run:

```powershell
git add apps/web/lib/work-capsules/work-capsule-store.ts apps/web/lib/work-capsules/mcp-handlers.ts apps/web/lib/mcp-tools-work-capsules.test.ts
git commit -s -m "feat(web): complete work capsule adoption handlers"
```

## Chunk 4: UI And Verification

## Task 7: Work Control Server Actions and Presenter

**Files:**
- Create: `apps/web/lib/actions/work-capsules.ts`
- Create: `apps/web/lib/work-capsules/work-capsule-presenter.ts`
- Test: `apps/web/lib/work-capsules/work-capsule-presenter.test.ts`

- [ ] **Step 1: Write presenter tests**

Create `apps/web/lib/work-capsules/work-capsule-presenter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { presentCapsuleRow } from "./work-capsule-presenter";

describe("presentCapsuleRow", () => {
  it("marks expired leases", () => {
    const row = presentCapsuleRow({
      capsuleId: "WC-1",
      title: "Adopt work",
      status: "working",
      source: "external-adoption",
      executorKind: "codex-desktop",
      headBranch: "feat/adopt",
      worktreePath: "D:/DPF-adopt",
      pullRequestUrl: null,
      leaseExpiresAt: new Date("2026-05-14T00:00:00.000Z"),
      lastSyncedAt: new Date("2026-05-14T00:00:00.000Z"),
      updatedAt: new Date("2026-05-14T00:00:00.000Z"),
    }, new Date("2026-05-14T01:00:00.000Z"));

    expect(row.health).toBe("lease-expired");
  });
});
```

- [ ] **Step 2: Implement presenter**

Create `apps/web/lib/work-capsules/work-capsule-presenter.ts`:

```ts
type CapsuleRowInput = {
  capsuleId: string;
  title: string;
  status: string;
  source: string;
  executorKind: string | null;
  headBranch: string | null;
  worktreePath: string | null;
  pullRequestUrl: string | null;
  leaseExpiresAt: Date | null;
  lastSyncedAt: Date | null;
  updatedAt: Date;
};

export type PresentedCapsuleRow = ReturnType<typeof presentCapsuleRow>;

export function presentCapsuleRow(row: CapsuleRowInput, now = new Date()) {
  const leaseExpired = row.leaseExpiresAt != null && row.leaseExpiresAt.getTime() < now.getTime();
  const staleCache = row.lastSyncedAt != null && now.getTime() - row.lastSyncedAt.getTime() > 30 * 60 * 1000;
  return {
    capsuleId: row.capsuleId,
    title: row.title,
    status: row.status,
    source: row.source,
    executorKind: row.executorKind ?? "unassigned",
    branch: row.headBranch ?? "no branch",
    worktreePath: row.worktreePath,
    pullRequestUrl: row.pullRequestUrl,
    health: leaseExpired ? "lease-expired" : staleCache ? "stale-cache" : "ok",
    updatedAt: row.updatedAt.toISOString(),
  };
}
```

- [ ] **Step 3: Implement server actions**

Create `apps/web/lib/actions/work-capsules.ts`:

```ts
"use server";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { presentCapsuleRow } from "@/lib/work-capsules/work-capsule-presenter";

async function requireBuildAccess(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_platform")) {
    throw new Error("Unauthorized");
  }
  return user.id!;
}

export async function getWorkControlData() {
  await requireBuildAccess();
  const capsules = await prisma.workCapsule.findMany({
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      capsuleId: true,
      title: true,
      status: true,
      source: true,
      executorKind: true,
      headBranch: true,
      worktreePath: true,
      pullRequestUrl: true,
      leaseExpiresAt: true,
      lastSyncedAt: true,
      updatedAt: true,
    },
  });
  return {
    capsules: capsules.map((row) => presentCapsuleRow(row)),
    adoptable: [],
  };
}
```

- [ ] **Step 4: Run presenter test**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/work-capsules/work-capsule-presenter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit action/presenter slice**

Run:

```powershell
git add apps/web/lib/actions/work-capsules.ts apps/web/lib/work-capsules/work-capsule-presenter.ts apps/web/lib/work-capsules/work-capsule-presenter.test.ts
git commit -s -m "feat(web): add work control data loader"
```

## Task 8: Work Control UI

**Files:**
- Create: `apps/web/app/(shell)/build/work/page.tsx`
- Create: `apps/web/components/build/work-control/WorkControlPanel.tsx`
- Create: `apps/web/components/build/work-control/WorkCapsuleTable.tsx`
- Create: `apps/web/components/build/work-control/AdoptableWorktreeTable.tsx`
- Test: `apps/web/components/build/work-control/WorkControlPanel.test.tsx`
- Modify: `apps/web/components/build/BuildStudio.tsx`

- [ ] **Step 1: Write UI test**

Create `apps/web/components/build/work-control/WorkControlPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkControlPanel } from "./WorkControlPanel";

describe("WorkControlPanel", () => {
  it("renders active capsule rows", () => {
    render(
      <WorkControlPanel
        capsules={[{
          capsuleId: "WC-1",
          title: "Adopt work",
          status: "working",
          source: "external-adoption",
          executorKind: "codex-desktop",
          branch: "feat/adopt",
          worktreePath: "D:/DPF-adopt",
          pullRequestUrl: null,
          health: "ok",
          updatedAt: "2026-05-14T00:00:00.000Z",
        }]}
        adoptable={[]}
      />,
    );

    expect(screen.getByText("Work Control")).toBeInTheDocument();
    expect(screen.getByText("Adopt work")).toBeInTheDocument();
    expect(screen.getByText("feat/adopt")).toBeInTheDocument();
  });

  it("renders empty state", () => {
    render(<WorkControlPanel capsules={[]} adoptable={[]} />);
    expect(screen.getByText("No active capsules yet.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement UI components**

Create `apps/web/components/build/work-control/WorkControlPanel.tsx`:

```tsx
import { GitBranch, RefreshCcw, ShieldCheck } from "lucide-react";
import { WorkCapsuleTable, type WorkCapsuleRow } from "./WorkCapsuleTable";
import { AdoptableWorktreeTable, type AdoptableWorktreeRow } from "./AdoptableWorktreeTable";

export function WorkControlPanel({
  capsules,
  adoptable,
}: {
  capsules: WorkCapsuleRow[];
  adoptable: AdoptableWorktreeRow[];
}) {
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">Work Control</h1>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">
            Coordinate Build Studio, desktop agents, worktrees, pull requests, and verification evidence.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--dpf-muted)]">
          <ShieldCheck className="h-4 w-4 text-[var(--dpf-accent)]" aria-hidden="true" />
          <span>Adoption-first, no production mutation</span>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
          <div className="flex items-center gap-2 text-xs text-[var(--dpf-muted)]">
            <GitBranch className="h-4 w-4" aria-hidden="true" />
            Active capsules
          </div>
          <div className="mt-2 text-2xl font-semibold text-[var(--dpf-text)]">{capsules.length}</div>
        </div>
        <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
          <div className="flex items-center gap-2 text-xs text-[var(--dpf-muted)]">
            <RefreshCcw className="h-4 w-4" aria-hidden="true" />
            Adoptable work
          </div>
          <div className="mt-2 text-2xl font-semibold text-[var(--dpf-text)]">{adoptable.length}</div>
        </div>
      </div>

      <WorkCapsuleTable capsules={capsules} />
      <AdoptableWorktreeTable rows={adoptable} />
    </section>
  );
}
```

Create `WorkCapsuleTable.tsx` with a table, not cards:

```tsx
export type WorkCapsuleRow = {
  capsuleId: string;
  title: string;
  status: string;
  source: string;
  executorKind: string;
  branch: string;
  worktreePath: string | null;
  pullRequestUrl: string | null;
  health: string;
  updatedAt: string;
};

export function WorkCapsuleTable({ capsules }: { capsules: WorkCapsuleRow[] }) {
  return (
    <section aria-labelledby="work-capsules-heading" className="space-y-3">
      <h2 id="work-capsules-heading" className="text-base font-semibold text-[var(--dpf-text)]">
        Active capsules
      </h2>
      {capsules.length === 0 ? (
        <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm text-[var(--dpf-muted)]">
          No active capsules yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-[var(--dpf-border)]">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--dpf-surface-2)] text-left text-xs text-[var(--dpf-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">Capsule</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Executor</th>
                <th className="px-3 py-2 font-medium">Branch</th>
                <th className="px-3 py-2 font-medium">Health</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
              {capsules.map((capsule) => (
                <tr key={capsule.capsuleId}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-[var(--dpf-text)]">{capsule.title}</div>
                    <div className="font-mono text-xs text-[var(--dpf-muted)]">{capsule.capsuleId}</div>
                  </td>
                  <td className="px-3 py-2 text-[var(--dpf-text)]">{capsule.status}</td>
                  <td className="px-3 py-2 text-[var(--dpf-text)]">{capsule.executorKind}</td>
                  <td className="px-3 py-2 font-mono text-xs text-[var(--dpf-muted)]">{capsule.branch}</td>
                  <td className="px-3 py-2 text-[var(--dpf-text)]">{capsule.health}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
```

Create `AdoptableWorktreeTable.tsx`:

```tsx
export type AdoptableWorktreeRow = {
  path: string;
  branch: string | null;
  modifiedCount: number;
  untrackedCount: number;
};

export function AdoptableWorktreeTable({ rows }: { rows: AdoptableWorktreeRow[] }) {
  return (
    <section aria-labelledby="adoptable-work-heading" className="space-y-3">
      <h2 id="adoptable-work-heading" className="text-base font-semibold text-[var(--dpf-text)]">
        Adoptable work
      </h2>
      {rows.length === 0 ? (
        <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm text-[var(--dpf-muted)]">
          No adoptable local work detected by the read-only scanner.
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-[var(--dpf-border)]">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--dpf-surface-2)] text-left text-xs text-[var(--dpf-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">Path</th>
                <th className="px-3 py-2 font-medium">Branch</th>
                <th className="px-3 py-2 font-medium">Changed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
              {rows.map((row) => (
                <tr key={`${row.path}:${row.branch ?? "detached"}`}>
                  <td className="px-3 py-2 font-mono text-xs text-[var(--dpf-text)]">{row.path}</td>
                  <td className="px-3 py-2 font-mono text-xs text-[var(--dpf-muted)]">{row.branch ?? "detached"}</td>
                  <td className="px-3 py-2 text-[var(--dpf-text)]">{row.modifiedCount + row.untrackedCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Add route**

Create `apps/web/app/(shell)/build/work/page.tsx`:

```tsx
import { WorkControlPanel } from "@/components/build/work-control/WorkControlPanel";
import { getWorkControlData } from "@/lib/actions/work-capsules";

export default async function WorkControlPage() {
  const data = await getWorkControlData();
  return <WorkControlPanel capsules={data.capsules} adoptable={data.adoptable} />;
}
```

- [ ] **Step 4: Link from Build Studio**

In `apps/web/components/build/BuildStudio.tsx`, add a `Link` import from `next/link` and render a compact link near the top-level Build Studio header area:

```tsx
<Link
  href="/build/work"
  className="inline-flex items-center gap-2 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
>
  Work Control
</Link>
```

Place it alongside existing build-level actions, not inside a nested card.

- [ ] **Step 5: Run UI tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/components/build/work-control/WorkControlPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit UI slice**

Run:

```powershell
git add apps/web/app/(shell)/build/work/page.tsx apps/web/components/build/work-control apps/web/components/build/BuildStudio.tsx
git commit -s -m "feat(web): add work control surface"
```

## Task 9: Phase 1 Verification and PR Update

**Files:**
- Modify: `docs/superpowers/specs/2026-05-14-portal-work-capsule-control-harness-design.md` if implementation discovers a spec correction.
- Modify: this plan only if a concrete command path changes during execution.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/work-capsules.test.ts apps/web/lib/work-capsules/work-capsule-store.test.ts apps/web/lib/work-capsules/git-scanner.test.ts apps/web/lib/work-capsules/work-capsule-presenter.test.ts apps/web/lib/mcp-tools-work-capsules.test.ts apps/web/lib/tak/agent-grants.test.ts apps/web/components/build/work-control/WorkControlPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run Prisma validation and generation**

Run:

```powershell
pnpm --filter @dpf/db exec prisma validate
pnpm --filter @dpf/db generate
```

Expected: both commands exit 0.

- [ ] **Step 3: Run typecheck**

Run:

```powershell
pnpm --filter web typecheck
```

Expected: exit 0.

- [ ] **Step 4: Run production build**

Run:

```powershell
pnpm --filter web build
```

Expected: exit 0.

- [ ] **Step 5: Run migration apply check**

Use the configured development database for the worktree. Run:

```powershell
pnpm --filter @dpf/db exec prisma migrate status
```

Expected: no failed migrations. If the new migration is unapplied in the local DB, run `pnpm --filter @dpf/db exec prisma migrate dev` and confirm it applies.

- [ ] **Step 6: UX verification against Docker-served portal**

Start/rebuild the Docker-served portal if needed:

```powershell
docker compose build --no-cache portal portal-init sandbox
docker compose up -d
```

Then verify:

1. Log in with `admin@dpf.local` and `ADMIN_PASSWORD` from repo-root `.env`.
2. Open `/build/work`.
3. Confirm the page renders the Work Control header, active capsule table, and adoptable work area.
4. Open `/build`.
5. Confirm the Work Control link is visible and navigates to `/build/work`.
6. Confirm no hardcoded-color regressions are visible in light/dark/brand override.

- [ ] **Step 7: Commit any verification doc updates**

If verification finds only pre-existing failures, document them in the PR body. If verification requires a code/doc correction, commit it:

```powershell
git add <corrected-files>
git commit -s -m "fix: finalize work capsule phase 1"
```

- [ ] **Step 8: Push and update PR**

Run:

```powershell
git push
gh pr comment 596 --body "Phase 1 implementation plan added: docs/superpowers/plans/2026-05-14-portal-work-capsule-control-harness-phase-1.md"
```

Expected: branch pushed; PR updated with a concise pointer to the plan and verification evidence. Do not replace the PR body with the full implementation plan.

## Implementation Notes

- Do not edit the root `D:\DPF` checkout for implementation. Use the existing clean worktree at `D:\DPF\.worktrees\portal-work-capsule-control-harness`.
- Do not grant `work_capsule_promote` to any agent in Phase 1.
- Do not use `npx`; use `pnpm --filter <pkg> exec <tool>`.
- Keep all new UI theme-aware. No `text-gray-*`, `bg-white`, hardcoded hex, or inline color styles.
- Keep Work Control dense and operational. Tables are appropriate here; decorative cards and hero layouts are not.
- Keep all code and docs ASCII unless an existing file requires otherwise.
- Preserve 20 percent refactor budget by keeping Work Capsule logic out of `mcp-tools.ts` and out of the Build Studio component body.
