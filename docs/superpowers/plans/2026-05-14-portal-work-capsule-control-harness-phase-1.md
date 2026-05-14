# Portal Work Capsule Control Harness Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development if the harness offers subagents; otherwise use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the adoption-first Work Capsule registry so DPF can record, inspect, and attach existing branches/worktrees/PRs to governed portal work before automating new worktree creation or production promotion.

**Architecture:** Add `WorkCapsule` and `WorkCapsuleActivity` as the lifecycle layer above `BacklogItem`, `FeatureBuild`, `TaskRun`, git state, and future promotion candidates. Keep domain behavior in focused `apps/web/lib/work-capsules/*` modules; keep `apps/web/lib/mcp-tools.ts` as registration and dispatch only. The first UI at `/build/work` is read-oriented and adoption-oriented, with no production mutation and no automatic worktree deletion.

**Tech Stack:** Next.js 16 App Router, Prisma 7, PostgreSQL, Vitest, DPF MCP tool surface, lucide-react, PowerShell/Windows local git scanning.

---

## Chunk 1: Grounding And Scope

### Live State Used For This Plan

Re-queried through the DPF MCP surface on 2026-05-14 before writing this plan:

- `list_epics(status=open, hasOpenItems=true)` returned 8 open epics with open work: `EP-DOCS-6B9F2A`, `EP-LIC-C64FC2`, `EP-TAK-3F9A21`, `EP-ARCH-8D4F2A`, `EP-CTRL-5E21A4`, `EP-SITE-7C4D2B`, `EP-LAB-6A91C2`, `EP-INT-2E7C1A`.
- `list_backlog_items(status=in-progress)` returned 7 in-progress items, including `BI-BUILD-GRAPH-CYCLE-05140137`, `BI-LIC-3621D8`, `BI-CDA96CAA`, and `BI-ec41b330-9a67-436f-a68d-e8a101693a9c`.
- `list_backlog_items(status=open)` returned active Build Studio/runtime noise under `EP-BUILD-CYCLE-0514`, including `BI-BUILD-PROVENANCE-BYPASS-0514`, `BI-BUILD-FALSE-GREEN-0514`, `BI-BUILD-COWORKER-CHAT-RETRY-0514`, `BI-BUILD-SANDBOX-SOURCE-SYNC-0514`, and many `BI-PIR-*` Server Components render-crash reports.
- `search_specs_and_plans(query="Work Capsule portal control harness Build Studio external Codex Claude worktree adoption")` returned no overlapping existing spec or plan.

Plan consequence: Phase 1 must be adoption-first and visibility-first. It should not try to solve Build Studio execution quality, provider reconciliation, or portal replacement in the same slice.

### Scope

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

### File Structure

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

### Task 1: Schema Foundation

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
  @@index([taskRunId])
  @@index([gitPromotionCandidateId])
  @@index([changePromotionId])
  @@index([epicId])
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

- [ ] **Step 3: Review generated SQL and append the adoption-uniqueness partial index**

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
CREATE INDEX "WorkCapsule_backlogItemId_idx" ON "WorkCapsule"("backlogItemId");
CREATE INDEX "WorkCapsule_featureBuildId_idx" ON "WorkCapsule"("featureBuildId");
CREATE INDEX "WorkCapsule_taskRunId_idx" ON "WorkCapsule"("taskRunId");
CREATE INDEX "WorkCapsule_gitPromotionCandidateId_idx" ON "WorkCapsule"("gitPromotionCandidateId");
CREATE INDEX "WorkCapsule_changePromotionId_idx" ON "WorkCapsule"("changePromotionId");
CREATE INDEX "WorkCapsule_epicId_idx" ON "WorkCapsule"("epicId");
CREATE INDEX "WorkCapsule_headBranch_idx" ON "WorkCapsule"("headBranch");
CREATE INDEX "WorkCapsule_sandboxId_idx" ON "WorkCapsule"("sandboxId");
CREATE INDEX "WorkCapsule_leaseExpiresAt_idx" ON "WorkCapsule"("leaseExpiresAt");
```

Prisma cannot express partial unique indexes in `schema.prisma`, so append
the adoption-natural-key index by hand at the end of the same migration file.
This enforces spec section 9.3 ("`adopt_worktree` returns existing capsule on
`(repositoryFullName, headBranch)`") at the DB layer; without it, two
concurrent `adopt_worktree` calls race past the application-level
`findFirst` and create duplicates.

```sql
CREATE UNIQUE INDEX "WorkCapsule_repo_headBranch_active_key"
  ON "WorkCapsule"("repositoryFullName", "headBranch")
  WHERE "archivedAt" IS NULL;
```

After editing the migration, re-run `pnpm --filter @dpf/db exec prisma migrate dev`
with no name flag to re-apply (Prisma re-runs unapplied migrations against
a shadow DB; if it complains about drift, drop and recreate the dev DB or
generate a fresh migration named `add_work_capsule_adoption_unique`).

- [ ] **Step 4: Generate Prisma client**

Run:

```powershell
pnpm --filter @dpf/db generate
```

Expected: Prisma Client generated without schema errors.

- [ ] **Step 5: Commit schema slice**

Note: this commit ships the schema before any vitest covers it. That is
acceptable because the pre-commit hook runs `pnpm --filter @dpf/db typecheck`
plus `prisma validate` (Step 4 above), and Tasks 2/3 introduce the
behavioural tests in the very next commits. Do not slip schema-related logic
into this commit.

Run:

```powershell
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -s -m "feat(db): add work capsule registry"
```

### Task 2: Work Capsule Types and Validation

**Files:**
- Create: `apps/web/lib/work-capsules.ts`
- Test: `apps/web/lib/work-capsules.test.ts`

- [ ] **Step 1: Write enum validation tests**

Create `apps/web/lib/work-capsules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  WORK_CAPSULE_ACTIVITY_KINDS,
  WORK_CAPSULE_EVIDENCE_KINDS,
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
  it("filters invalid scope claims and rejects malformed timestamps", () => {
    const claims = parseScopeClaims([
      { kind: "path", value: "apps/web/lib/work-capsules.ts", intent: "edit", recordedAt: "2026-05-14T00:00:00.000Z", recordedByPrincipalId: "principal-1" },
      { kind: "bad", value: "x", intent: "edit" },
      { kind: "path", value: "apps/web/x.ts", intent: "edit", recordedAt: "yesterday", recordedByPrincipalId: "principal-1" },
      { kind: "path", value: "", intent: "edit", recordedAt: "2026-05-14T00:00:00.000Z", recordedByPrincipalId: "principal-1" },
    ]);

    expect(claims).toHaveLength(1);
    expect(claims[0]?.kind).toBe("path");
  });
});

describe("evidence kinds", () => {
  it("recognizes the allowlist", () => {
    expect(WORK_CAPSULE_EVIDENCE_KINDS).toContain("test");
    expect(WORK_CAPSULE_EVIDENCE_KINDS).toContain("note");
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

// Evidence-kind allowlist for `record_capsule_evidence`. Distinct from the
// activity-kind enum because evidence is a sub-category of one activity
// (`evidence-recorded`); without an allowlist agents invent every spelling
// (`Test`, `tests`, `unit_test`) and the audit log loses analytical value.
export const WORK_CAPSULE_EVIDENCE_KINDS = [
  "test",
  "build",
  "screenshot",
  "verification",
  "lint",
  "note",
] as const;

export type WorkCapsuleEvidenceKind = (typeof WORK_CAPSULE_EVIDENCE_KINDS)[number];

// Time constants. Single source of truth so spec section 21 decisions 1 and 5 don't
// drift between the store, presenter, and tests.
export const LEASE_TTL_MS = 30 * 60 * 1000;            // section 21 decision 1
export const STALE_CACHE_MS = 30 * 60 * 1000;          // presenter staleness threshold
export const STATUS_OVERRIDE_TTL_MS = 24 * 60 * 60 * 1000; // section 21 decision 5

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

const EVIDENCE_KIND_SET = new Set<string>(WORK_CAPSULE_EVIDENCE_KINDS);

export function isWorkCapsuleEvidenceKind(value: unknown): value is WorkCapsuleEvidenceKind {
  return typeof value === "string" && EVIDENCE_KIND_SET.has(value);
}

export function normalizeBranchTaxonomy(branch: string | null | undefined): WorkCapsuleBranchTaxonomy | null {
  const prefix = branch?.split("/")[0]?.trim();
  return prefix && TAXONOMY_SET.has(prefix) ? (prefix as WorkCapsuleBranchTaxonomy) : null;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  const t = Date.parse(value);
  return Number.isFinite(t);
}

export function parseScopeClaims(value: unknown): ScopeClaim[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ScopeClaim => {
    if (!entry || typeof entry !== "object") return false;
    const candidate = entry as Record<string, unknown>;
    return (
      typeof candidate.value === "string" &&
      candidate.value.trim().length > 0 &&
      isIsoTimestamp(candidate.recordedAt) &&
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

### Task 3: Domain Store

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
  },
  workCapsuleActivity: {
    create: vi.fn(),
  },
  // Default mock runs the callback against `db` itself so the implementation's
  // transactional path is exercised end-to-end without a real Prisma client.
  $transaction: vi.fn(async (fn: any) => fn(db)),
};

describe("work capsule store", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a capsule on first call and writes a single `created` activity", async () => {
    db.workCapsule.findUnique.mockResolvedValueOnce(null);
    db.workCapsule.create.mockResolvedValueOnce({ id: "row-1", capsuleId: "WC-ABC12345", title: "Work control" });

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
    expect(db.workCapsule.create).toHaveBeenCalledTimes(1);
    expect(db.workCapsuleActivity.create).toHaveBeenCalledTimes(1);
    expect(db.workCapsuleActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "created" }),
    }));
  });

  it("returns the existing capsule on idempotent retry without writing a duplicate activity", async () => {
    db.workCapsule.findUnique.mockResolvedValueOnce({
      id: "row-1",
      capsuleId: "WC-ABC12345",
      title: "Work control",
    });

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
    expect(db.workCapsule.create).not.toHaveBeenCalled();
    expect(db.workCapsuleActivity.create).not.toHaveBeenCalled();
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
  LEASE_TTL_MS,
  STATUS_OVERRIDE_TTL_MS,
  isWorkCapsuleExecutorKind,
  isWorkCapsuleSource,
  normalizeBranchTaxonomy,
  type WorkCapsuleExecutorKind,
  type WorkCapsuleSource,
} from "@/lib/work-capsules";

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
  };
  workCapsuleActivity: {
    create(args: any): Promise<any>;
  };
  // Optional in transaction-scoped clients; required on the top-level prisma
  // client so the store can wrap capsule + activity writes atomically.
  $transaction?<T>(fn: (tx: CapsuleDb) => Promise<T>): Promise<T>;
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

  // Idempotency contract: a retry with the same idempotencyKey returns the
  // existing capsule and MUST NOT emit a duplicate `created` activity.
  // findUnique-then-create-in-transaction is preferred over upsert here so
  // the activity insert and capsule insert commit (or roll back) together.
  const existing = await args.db.workCapsule.findUnique({
    where: { idempotencyKey: args.input.idempotencyKey },
  });
  if (existing) return existing;

  const [capsule] = await args.db.$transaction(async (tx: CapsuleDb) => {
    const created = await tx.workCapsule.create({
      data: {
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
    await recordActivity(tx, {
      workCapsuleId: created.id,
      kind: "created",
      summary: `Created Work Capsule ${created.capsuleId}`,
      actor: args.actor,
    });
    return [created];
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
  // Application-level natural-key check. The Postgres partial unique index
  // added in the migration is the actual race guard; this read is the
  // common-path fast lane that avoids a unique-violation in the steady state.
  const existing = await args.db.workCapsule.findFirst({
    where: {
      repositoryFullName: args.input.repositoryFullName,
      headBranch: args.input.headBranch,
      archivedAt: null,
    },
  });
  if (existing) return existing;

  const now = new Date();
  try {
    return await args.db.$transaction!(async (tx: CapsuleDb) => {
      const capsule = await tx.workCapsule.create({
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
      await recordActivity(tx, {
        workCapsuleId: capsule.id,
        kind: "adopted",
        summary: `Adopted ${args.input.headBranch}`,
        payload: { worktreePath: args.input.worktreePath },
        actor: args.actor,
      });
      return capsule;
    });
  } catch (error) {
    // Race fallback: a concurrent caller won the partial unique index. Re-read
    // and return the survivor instead of bubbling the unique violation.
    const code = (error as { code?: string } | null)?.code;
    if (code === "P2002") {
      const winner = await args.db.workCapsule.findFirst({
        where: {
          repositoryFullName: args.input.repositoryFullName,
          headBranch: args.input.headBranch,
          archivedAt: null,
        },
      });
      if (winner) return winner;
    }
    throw error;
  }
}

export async function heartbeatWorkCapsule(args: {
  db: CapsuleDb;
  capsuleId: string;
  actor: Actor;
  now?: Date;
}) {
  const nextLease = leaseUntil(args.now ?? new Date());
  // Spec section 14 invariant 6: every user-visible capsule event writes a
  // WorkCapsuleActivity. Wrap the lease update + activity in a transaction so
  // a failed activity insert rolls back the lease change.
  return args.db.$transaction!(async (tx: CapsuleDb) => {
    const capsule = await tx.workCapsule.update({
      where: { capsuleId: args.capsuleId },
      data: {
        leaseHolderPrincipalId: args.actor.principalId,
        leaseExpiresAt: nextLease,
      },
    });
    await recordActivity(tx, {
      workCapsuleId: capsule.id,
      kind: "lease-renewed",
      summary: `Lease renewed until ${nextLease.toISOString()}`,
      actor: args.actor,
    });
    return capsule;
  });
}

export async function recordWorkCapsuleEvidence(args: {
  db: CapsuleDb;
  capsuleId: string;
  evidence: { kind: string; summary: string; command?: string; url?: string; result?: unknown };
  actor: Actor;
}) {
  const capsule = await args.db.workCapsule.findUnique({ where: { capsuleId: args.capsuleId } });
  if (!capsule) throw new Error(`Work Capsule ${args.capsuleId} not found`);
  // Append-only; no capsule mutation needed, so a single activity insert is
  // already atomic. Kept as a discrete function so callers compose the same
  // way as the transactional ones.
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

### Task 4: Read-Only Git and Worktree Scanner

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

### Task 5: MCP Tools and Grants

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

`apps/web/lib/mcp-tools.ts` is ~11k lines and pulls in many sibling modules
at module scope. Before flushing per-tool tests, prove the test environment
can import it under the `@dpf/db` mock  -  otherwise downstream test failures
look like missing handlers when they're actually missing peer mocks. Lead
with a one-line import smoke test:

```ts
it("imports mcp-tools without runtime error under the @dpf/db mock", async () => {
  await expect(import("./mcp-tools")).resolves.toBeDefined();
});
```

Then create `apps/web/lib/mcp-tools-work-capsules.test.ts`:

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
  ensureAgentPrincipalIdentity,
  resolvePrincipalIdForUser,
} from "@/lib/identity/principal-linking";
import {
  WORK_CAPSULE_EVIDENCE_KINDS,
  WORK_CAPSULE_EXECUTOR_KINDS,
  WORK_CAPSULE_SOURCES,
  WORK_CAPSULE_STATUSES,
  isWorkCapsuleEvidenceKind,
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

// Per AGENTS.md section 11 (principal convergence, post-2026-05-09), every new
// identity-bearing column references `Principal.id`  -  never a raw User.id or
// Agent.id. We resolve via the existing principal-linking primitives so the
// capsule store can store a real Principal reference (or null when the caller
// has no Principal yet  -  better than a fabricated FK).
async function actor(userId: string, context: ToolContext) {
  const agentId = context?.agentId ?? null;
  let principalId: string | null = null;
  try {
    if (agentId) {
      const synced = await ensureAgentPrincipalIdentity(agentId);
      principalId = synced?.id ?? null;
    } else {
      principalId = await resolvePrincipalIdForUser(userId);
    }
  } catch {
    // Principal resolution is best-effort in Phase 1; capsule writes proceed
    // with a null principalId rather than failing the user-visible action.
    principalId = null;
  }
  return { userId, agentId, principalId };
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
    actor: await actor(userId, context),
  });
  return { success: true, entityId: capsule.capsuleId, message: `Created Work Capsule ${capsule.capsuleId}.`, data: { capsule } };
}

export async function heartbeatCapsuleTool(params: Record<string, unknown>, userId: string, context: ToolContext): Promise<ToolResult> {
  const capsuleId = stringParam(params, "capsuleId");
  if (!capsuleId) return { success: false, error: "missing_capsuleId", message: "capsuleId is required." };
  const capsule = await heartbeatWorkCapsule({ db: prisma, capsuleId, actor: await actor(userId, context) });
  return { success: true, entityId: capsule.capsuleId, message: `Renewed lease for ${capsule.capsuleId}.`, data: { capsule } };
}

export async function recordCapsuleEvidenceTool(params: Record<string, unknown>, userId: string, context: ToolContext): Promise<ToolResult> {
  const capsuleId = stringParam(params, "capsuleId");
  const summary = stringParam(params, "summary");
  if (!capsuleId || !summary) return { success: false, error: "invalid_input", message: "capsuleId and summary are required." };
  // Evidence-kind allowlist: agents otherwise invent every spelling
  // (`Test`, `tests`, `unit_test`) and the audit log loses analytical value.
  // The allowlist lives in `apps/web/lib/work-capsules.ts` next to the other
  // capsule enums per AGENTS.md section 3.
  const rawKind = stringParam(params, "kind");
  if (rawKind && !isWorkCapsuleEvidenceKind(rawKind)) {
    return {
      success: false,
      error: "invalid_kind",
      message: `kind must be one of: ${WORK_CAPSULE_EVIDENCE_KINDS.join(", ")}.`,
    };
  }
  await recordWorkCapsuleEvidence({
    db: prisma,
    capsuleId,
    evidence: {
      kind: rawKind ?? "note",
      summary,
      command: stringParam(params, "command") ?? undefined,
      url: stringParam(params, "url") ?? undefined,
      result: params.result,
    },
    actor: await actor(userId, context),
  });
  return { success: true, entityId: capsuleId, message: `Recorded evidence for ${capsuleId}.` };
}
```

- [ ] **Step 4: Register read-only tool definitions**

Add Work Capsule tools to `PLATFORM_TOOLS` in `apps/web/lib/mcp-tools.ts` near the backlog/governed work tools. Use `workCapsuleToolEnums()` for enum arrays so the MCP schema mirrors `work-capsules.ts`:

```ts
import { workCapsuleToolEnums } from "@/lib/work-capsules/mcp-handlers";
```

In Task 5, register only the read tools and `create_work_capsule`/`heartbeat_capsule`/`record_capsule_evidence` whose handlers exist in this task. Per spec section 9.3 the human capability gate differs from the agent grant gate; differentiate `requiredCapability` so the human side of the bouncer is not a no-op:

| Tool                          | `requiredCapability` | `sideEffect` | Lands in |
| ----------------------------- | -------------------- | ------------ | -------- |
| `list_work_capsules`          | `view_platform`      | `false`      | Task 5   |
| `get_work_capsule`            | `view_platform`      | `false`      | Task 5   |
| `create_work_capsule`         | `manage_backlog`     | `true`       | Task 5   |
| `heartbeat_capsule`           | `manage_backlog`     | `true`       | Task 5   |
| `record_capsule_evidence`     | `manage_backlog`     | `true`       | Task 5   |
| `adopt_worktree`              | `manage_backlog`     | `true`       | Task 6   |
| `claim_capsule_scope`         | `manage_backlog`     | `true`       | Task 6   |
| `update_work_capsule_status`  | `manage_backlog`     | `true`       | Task 6   |
| `release_capsule_scope`       | `manage_backlog`     | `true`       | Task 6   |

`view_platform` permits every authenticated platform user (HR-000/200/300)  -  too low a bar for write tools. `manage_backlog` is the existing builder-minimum gate already used by `promote_to_build_studio` and the backlog write surface. Use the enum arrays returned by `workCapsuleToolEnums()` for `status`, `source`, `executor`, `activity-kind`, and the `record_capsule_evidence.kind` allowlist.

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

Per spec invariant against silent-failure tool surfaces (memory:
`project_proposal_trap_silent_failure.md`, `project_hive_contribution_gaps.md`),
do **NOT** add `PLATFORM_TOOLS` definitions in Task 5 for `adopt_worktree`,
`claim_capsule_scope`, `update_work_capsule_status`, or `release_capsule_scope`.
Register both the definition and the dispatch case in Task 6 once their
handlers exist. An advertised tool whose handler is missing returns a generic
"unknown tool" 4xx and produces the exact "tools/list lies" trap that has
stalled prior autonomous runs.

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

- [ ] **Step 9: Run focused tests including the enum-parity invariant**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/mcp-tools-work-capsules.test.ts apps/web/lib/tak/agent-grants.test.ts apps/web/lib/work-capsules-enum-parity.test.ts
```

Expected: PASS for the tools implemented in this task. If any Work Capsule tool case is visible through `executeTool`, it must have a real handler, not a temporary fallback response. The enum-parity test (added below in Task 5 Step 8a) enforces AGENTS.md section 3  -  the MCP `enum:` arrays for `status`/`source`/`executor` MUST equal the constants in `apps/web/lib/work-capsules.ts`.

- [ ] **Step 8a: Add the enum-parity test required by AGENTS.md section 3**

Create `apps/web/lib/work-capsules-enum-parity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PLATFORM_TOOLS } from "./mcp-tools";
import {
  WORK_CAPSULE_EVIDENCE_KINDS,
  WORK_CAPSULE_EXECUTOR_KINDS,
  WORK_CAPSULE_SOURCES,
  WORK_CAPSULE_STATUSES,
} from "./work-capsules";

function enumOf(toolName: string, paramName: string): readonly string[] {
  const tool = PLATFORM_TOOLS.find((t) => t.name === toolName);
  if (!tool) throw new Error(`tool ${toolName} not registered`);
  const param = (tool.parameters as { properties?: Record<string, { enum?: string[] }> })
    .properties?.[paramName];
  return param?.enum ?? [];
}

describe("work capsule MCP enum parity", () => {
  it("list_work_capsules.status mirrors WORK_CAPSULE_STATUSES", () => {
    expect(enumOf("list_work_capsules", "status")).toEqual([...WORK_CAPSULE_STATUSES]);
  });

  it("create_work_capsule.source mirrors WORK_CAPSULE_SOURCES", () => {
    expect(enumOf("create_work_capsule", "source")).toEqual([...WORK_CAPSULE_SOURCES]);
  });

  it("create_work_capsule.executorKind mirrors WORK_CAPSULE_EXECUTOR_KINDS", () => {
    expect(enumOf("create_work_capsule", "executorKind")).toEqual([...WORK_CAPSULE_EXECUTOR_KINDS]);
  });

  it("record_capsule_evidence.kind mirrors WORK_CAPSULE_EVIDENCE_KINDS", () => {
    expect(enumOf("record_capsule_evidence", "kind")).toEqual([...WORK_CAPSULE_EVIDENCE_KINDS]);
  });
});
```

When Task 6 lands `update_work_capsule_status`, extend this test to cover its `status` enum too.

- [ ] **Step 10: Commit MCP slice**

Run:

```powershell
git add apps/web/lib/mcp-tools.ts apps/web/lib/work-capsules/mcp-handlers.ts apps/web/lib/mcp-tools-work-capsules.test.ts apps/web/lib/work-capsules-enum-parity.test.ts apps/web/lib/tak/agent-grants.ts apps/web/lib/tak/agent-grants.test.ts apps/web/components/platform/EffectivePermissionsPanel.tsx packages/db/data/grant_catalog.json packages/db/data/agent_registry.json
git commit -s -m "feat(web): expose work capsule MCP tools"
```

### Task 6: Complete Adoption, Scope, Status, and Evidence Handlers

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
  const principalId = args.actor.principalId ?? null;
  const existing: Array<{ kind: string; value: string; intent: string; recordedAt: string; recordedByPrincipalId: string | null }> =
    Array.isArray(capsule.scopeClaims) ? (capsule.scopeClaims as any) : [];

  // Spec section 9.3 contract: "merging set on (capsuleId, kind, value)". A repeat
  // claim refreshes recordedAt / recordedByPrincipalId / intent rather than
  // duplicating the entry. Without this the array grows unbounded and
  // collision detection joins on stale duplicates.
  const next = new Map<string, typeof existing[number]>();
  for (const entry of existing) {
    next.set(`${entry.kind}:${entry.value}`, entry);
  }
  const newlyAdded: Array<typeof existing[number]> = [];
  const refreshed: Array<typeof existing[number]> = [];
  for (const claim of args.claims) {
    const key = `${claim.kind}:${claim.value}`;
    const merged = {
      kind: claim.kind,
      value: claim.value,
      intent: claim.intent,
      recordedAt,
      recordedByPrincipalId: principalId ?? "",
    };
    if (next.has(key)) refreshed.push(merged);
    else newlyAdded.push(merged);
    next.set(key, merged);
  }
  const merged = Array.from(next.values());
  const updated = await args.db.$transaction!(async (tx: CapsuleDb) => {
    const row = await tx.workCapsule.update({
      where: { capsuleId: args.capsuleId },
      data: { scopeClaims: merged },
    });
    await recordActivity(tx, {
      workCapsuleId: capsule.id,
      kind: "scope-claimed",
      summary: `Claimed ${newlyAdded.length} new scope item(s); refreshed ${refreshed.length}`,
      payload: { added: newlyAdded, refreshed },
      actor: args.actor,
    });
    return row;
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
  // Spec section 21 decision 5: status overrides last 24 hours by default; the TTL is
  // exported from `apps/web/lib/work-capsules.ts` as STATUS_OVERRIDE_TTL_MS.
  // Atomic with the activity write per Spec section 14 invariant 6.
  return args.db.$transaction!(async (tx: CapsuleDb) => {
    const updated = await tx.workCapsule.update({
      where: { capsuleId: args.capsuleId },
      data: {
        status: args.status,
        workspaceState: {
          statusOverride: {
            reason: args.reason,
            until: new Date(Date.now() + STATUS_OVERRIDE_TTL_MS).toISOString(),
          },
        },
      },
    });
    await recordActivity(tx, {
      workCapsuleId: updated.id,
      kind: "status-override",
      summary: args.reason,
      payload: { status: args.status },
      actor: args.actor,
    });
    return updated;
  });
}
```

- [ ] **Step 3: Wire the remaining MCP handlers AND register their tool definitions in the same commit**

Implement `adoptWorktreeTool`, `claimCapsuleScopeTool`, `updateWorkCapsuleStatusTool`, and `releaseCapsuleScopeTool` with explicit parameter validation and calls to the store module. In the same commit, add the matching `PLATFORM_TOOLS` entries with `requiredCapability: "manage_backlog"`, `sideEffect: true`, and the `enum:` arrays from `workCapsuleToolEnums()`. Then add the dispatch cases to the `executeTool` switch.

Definition + handler + dispatch land together  -  never advertise a tool whose handler does not exist (see Task 5 Step 5 rationale).

Extend `apps/web/lib/work-capsules-enum-parity.test.ts` with a case for `update_work_capsule_status.status` mirroring `WORK_CAPSULE_STATUSES`.

Before committing, search `apps/web/lib/work-capsules/mcp-handlers.ts` and `apps/web/lib/mcp-tools.ts` for temporary fallback responses and remove any that remain.

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

### Task 7: Work Control Server Actions and Presenter

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
import { STALE_CACHE_MS } from "@/lib/work-capsules";

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
  const staleCache = row.lastSyncedAt != null && now.getTime() - row.lastSyncedAt.getTime() > STALE_CACHE_MS;
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

Create `apps/web/lib/actions/work-capsules.ts`. The loader joins the read-only
git scanner against already-adopted capsules so the "adoptable" list shows only
worktrees that DON'T already have a capsule on their head branch  -  Phase 1's
operationally important surface per spec section 16.

```ts
"use server";

import path from "node:path";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { presentCapsuleRow } from "@/lib/work-capsules/work-capsule-presenter";
import {
  scanGitWorktrees,
  getWorktreeDirtySummary,
  type WorktreeInfo,
} from "@/lib/work-capsules/git-scanner";

async function requireBuildAccess(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_platform")) {
    throw new Error("Unauthorized");
  }
  return user.id!;
}

// Resolves the install's repo root. The portal process's cwd is the worktree
// root in dev; in Docker the repo is mounted at `/workspace`. Both expose
// `git worktree list --porcelain`. Configure via `DPF_REPO_ROOT` if neither
// matches.
function resolveRepoRoot(): string {
  const override = process.env.DPF_REPO_ROOT?.trim();
  if (override) return path.resolve(override);
  return process.cwd();
}

async function loadAdoptableRows(repoRoot: string, adoptedBranches: Set<string>) {
  let worktrees: WorktreeInfo[];
  try {
    worktrees = await scanGitWorktrees(repoRoot);
  } catch {
    // Scanner failure (no git, missing repo, permission denied) is not fatal:
    // surface zero adoptables so the page still renders existing capsules.
    return [];
  }
  const rows = await Promise.all(
    worktrees
      .filter((w) => w.branch && !adoptedBranches.has(w.branch))
      .map(async (w) => {
        try {
          const dirty = await getWorktreeDirtySummary(w.path);
          return {
            path: w.path,
            branch: w.branch,
            modifiedCount: dirty.modifiedCount,
            untrackedCount: dirty.untrackedCount,
          };
        } catch {
          return { path: w.path, branch: w.branch, modifiedCount: 0, untrackedCount: 0 };
        }
      }),
  );
  // Phase 1 surfaces ALL non-adopted local worktrees; the
  // `shouldSurfaceAdoptableBranch` heuristic is reserved for the daily
  // steward (Phase 4) where ahead/behind and last-commit data is available.
  return rows;
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
  const adoptedBranches = new Set(
    capsules.map((c) => c.headBranch).filter((b): b is string => Boolean(b)),
  );
  const adoptable = await loadAdoptableRows(resolveRepoRoot(), adoptedBranches);
  return {
    capsules: capsules.map((row) => presentCapsuleRow(row)),
    adoptable,
  };
}
```

- [ ] **Step 3a: Add a loader test that asserts auth and scanner integration**

Create `apps/web/lib/actions/work-capsules.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@dpf/db", () => ({
  prisma: {
    workCapsule: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/work-capsules/git-scanner", () => ({
  scanGitWorktrees: vi.fn(),
  getWorktreeDirtySummary: vi.fn(),
}));

describe("getWorkControlData", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthorized callers", async () => {
    const { auth } = await import("@/lib/auth");
    (auth as any).mockResolvedValue({ user: { id: "u1", platformRole: "HR-900", isSuperuser: false } });
    const { getWorkControlData } = await import("./work-capsules");
    await expect(getWorkControlData()).rejects.toThrow(/unauthorized/i);
  });

  it("filters scanner output by already-adopted branches", async () => {
    const { auth } = await import("@/lib/auth");
    (auth as any).mockResolvedValue({ user: { id: "u1", platformRole: "HR-100", isSuperuser: true } });
    const { prisma } = await import("@dpf/db");
    (prisma.workCapsule.findMany as any).mockResolvedValue([
      { capsuleId: "WC-1", title: "x", status: "working", source: "external-adoption", executorKind: null, headBranch: "feat/already-adopted", worktreePath: "/p", pullRequestUrl: null, leaseExpiresAt: null, lastSyncedAt: null, updatedAt: new Date() },
    ]);
    const scanner = await import("@/lib/work-capsules/git-scanner");
    (scanner.scanGitWorktrees as any).mockResolvedValue([
      { path: "/a", branch: "feat/already-adopted", headSha: "h1" },
      { path: "/b", branch: "fix/orphan", headSha: "h2" },
    ]);
    (scanner.getWorktreeDirtySummary as any).mockResolvedValue({ modifiedCount: 0, untrackedCount: 0 });

    const { getWorkControlData } = await import("./work-capsules");
    const data = await getWorkControlData();
    expect(data.adoptable).toEqual([
      expect.objectContaining({ branch: "fix/orphan" }),
    ]);
  });
});
```

- [ ] **Step 4: Run presenter and loader tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/work-capsules/work-capsule-presenter.test.ts apps/web/lib/actions/work-capsules.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit action/presenter slice**

Run:

```powershell
git add apps/web/lib/actions/work-capsules.ts apps/web/lib/actions/work-capsules.test.ts apps/web/lib/work-capsules/work-capsule-presenter.ts apps/web/lib/work-capsules/work-capsule-presenter.test.ts
git commit -s -m "feat(web): add work control data loader"
```

### Task 8: Work Control UI

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

  it("renders adoptable worktree rows surfaced by the scanner", () => {
    render(
      <WorkControlPanel
        capsules={[]}
        adoptable={[{ path: "D:/DPF-orphan", branch: "fix/orphan", modifiedCount: 3, untrackedCount: 1 }]}
      />,
    );
    expect(screen.getByText("D:/DPF-orphan")).toBeInTheDocument();
    expect(screen.getByText("fix/orphan")).toBeInTheDocument();
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

Note: spec section 12 currently says the link appears "when active capsules exist."
Phase 1 renders the link unconditionally because (a) the page is the entry
point for adopting the first capsule on a fresh install, and (b) gating
requires a server-side count query the header doesn't otherwise need. Update
spec section 12 in the same PR to match this Phase 1 behavior; the conditional
appearance can return in a later phase if it adds value.

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

### Task 9: Phase 1 Verification and Branch Handoff

**Files:**
- Modify: `docs/superpowers/specs/2026-05-14-portal-work-capsule-control-harness-design.md` if implementation discovers a spec correction.
- Modify: this plan only if a concrete command path changes during execution.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/work-capsules.test.ts apps/web/lib/work-capsules/work-capsule-store.test.ts apps/web/lib/work-capsules/git-scanner.test.ts apps/web/lib/work-capsules/work-capsule-presenter.test.ts apps/web/lib/actions/work-capsules.test.ts apps/web/lib/mcp-tools-work-capsules.test.ts apps/web/lib/tak/agent-grants.test.ts apps/web/components/build/work-control/WorkControlPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 1a: Confirm release worktree filtering**

Run:

```powershell
pnpm --filter web exec vitest run lib/actions/work-capsules.test.ts
```

Expected: PASS, including coverage that the `main` release worktree is not presented as adoptable implementation work.

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

If verification finds only pre-existing failures, document them in the branch handoff notes. If verification requires a code/doc correction, commit it:

```powershell
git add <corrected-files>
git commit -s -m "fix: finalize work capsule phase 1"
```

- [ ] **Step 8: Push branch without opening a PR**

Push the branch so it is backed up and visible, but do not create a PR until
the branch is truly ready to merge. In this repository, PR creation is the
ready-to-merge signal; draft PRs are not used as an in-flight handoff.

```powershell
git push
```

Expected: branch pushed. No PR exists until the final merge-ready review gate.

- [ ] **Step 9: Capture scratch-install rehearsal preview**

Run the non-destructive rehearsal in plan-only mode so the branch handoff records
the exact source SHA, scratch ports, and Codex/Claude CLI availability without
resetting the live install:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\scratch-install-rehearsal.ps1
```

Expected: JSON plan output with `"copiedSourceSecrets": false`, a scratch worktree
path, alternate portal/sandbox URLs, and Codex/Claude CLI availability. Full
`-Execute` rehearsal is the next gate before merge-ready PR creation for
install/setup/provider/promotion-sensitive work.

## Implementation Notes

- Do not edit the root `D:\DPF` checkout for implementation. Use the existing clean worktree at `D:\DPF\.worktrees\portal-work-capsule-control-harness`.
- Do not open a PR as an early progress marker. Pushed branches and Work Capsules are the handoff artifacts while work is in flight.
- Do not grant `work_capsule_promote` to any agent in Phase 1.
- Do not use `npx`; use `pnpm --filter <pkg> exec <tool>`. Verification follows AGENTS.md section 2 ("never `npx`"); section 5's `npx next build` example will be reconciled in a separate doc PR.
- Keep all new UI theme-aware. No `text-gray-*`, `bg-white`, hardcoded hex, or inline color styles.
- Keep Work Control dense and operational. Tables are appropriate here; decorative cards and hero layouts are not.
- Keep all code and docs ASCII unless an existing file requires otherwise.
- Preserve 20 percent refactor budget by keeping Work Capsule logic out of `mcp-tools.ts` and out of the Build Studio component body.

### Architectural Invariants Enforced In This Plan

These reflect chief-architect findings rolled into the plan; every implementation step above already encodes them, but listing them here gives reviewers and downstream phases a single quick-reference.

- **Idempotent capsule creation.** `create_work_capsule` and `adopt_worktree` MUST NOT emit a duplicate `created`/`adopted` activity on retry. Achieved via `findUnique -> if-not-found -> $transaction([create, activity])` for create, and a Postgres partial unique index plus `P2002` race-fallback for adopt.
- **Adoption uniqueness at the DB layer.** The migration adds `CREATE UNIQUE INDEX "WorkCapsule_repo_headBranch_active_key" ON "WorkCapsule"("repositoryFullName","headBranch") WHERE "archivedAt" IS NULL;` so concurrent `adopt_worktree` callers cannot produce duplicate capsules even if the application-level `findFirst` races.
- **Principal columns reference `Principal.id` only.** Per AGENTS.md section 11 (post-2026-05-09 principal convergence), `createdByPrincipalId` and `leaseHolderPrincipalId` resolve via `apps/web/lib/identity/principal-linking.ts` (`resolvePrincipalIdForUser` for users, `ensureAgentPrincipalIdentity` for agents). If resolution fails, write `null` rather than fabricate a non-Principal FK.
- **Activity writes are atomic with the capsule mutation.** Spec section 14 invariant 6 ("every user-visible capsule event writes WorkCapsuleActivity") is enforced by wrapping each store function in `prisma.$transaction(...)`; a failed activity insert rolls back the capsule mutation.
- **Scope claims are a set, not a log.** `claim_capsule_scope` merges on `(kind, value)`, replacing recordedAt/recordedByPrincipalId/intent in place; collision detection joins on the deduped set.
- **Tool registration <-> handler parity.** `PLATFORM_TOOLS` definition, `executeTool` dispatch case, and the handler land in the same commit. Never advertise a tool whose handler returns "unknown tool"  -  past autonomous runs have been stalled by exactly this trap (see memories `project_proposal_trap_silent_failure.md`, `project_hive_contribution_gaps.md`).
- **Differentiated `requiredCapability`.** Read tools use `view_platform`; write tools use `manage_backlog` (the existing builder-minimum gate). `view_platform` for writes admits HR-000/200/300 and is too permissive.
- **Enum parity is testable.** `apps/web/lib/work-capsules-enum-parity.test.ts` asserts the `enum:` arrays in `mcp-tools.ts` equal the constants in `work-capsules.ts` for status, source, executor, evidence-kind, and (after Task 6) status-override. AGENTS.md section 3 invariant.
- **Evidence-kind allowlist.** `record_capsule_evidence.kind` is constrained to `WORK_CAPSULE_EVIDENCE_KINDS`; arbitrary spellings are rejected so the audit log remains analytically useful.
- **Time constants in one place.** `LEASE_TTL_MS`, `STALE_CACHE_MS`, and `STATUS_OVERRIDE_TTL_MS` live in `apps/web/lib/work-capsules.ts`; spec section 21 decisions 1 and 5 are sourced from there.
- **Bundled MCP, no separate registration.** Per spec section 21 decision 6, Work Capsule tools ship inside the existing `apps/web/lib/mcp-tools.ts` surface; Phase 1 does NOT add a new MCP service registration row, so admins do not have to "register" the capsule tools after install.
- **No backfill.** Existing branches and worktrees are NOT auto-adopted on migrate. Adoption is an explicit per-row user action via `/build/work` in Phase 1.
- **Phase 1 defers executor handoff.** Spec section 6.3 specifies an `executor-changed` activity on every handoff; that activity kind exists in the enum but no Phase 1 tool writes it. Handoff lands in Phase 3 alongside Build Studio attachment.
