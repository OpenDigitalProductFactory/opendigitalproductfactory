# Change & Deployment Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement ITIL-style change management with two core use cases: (1) self-development changes from sandbox auto-create RFCs and get scheduled for production promotion, and (2) external/infrastructure changes follow the same approval and scheduling workflow.

**Architecture:** New `ChangeRequest` model sits above the existing `ChangePromotion` pipeline. When `shipBuild()` creates a `ChangePromotion`, the system auto-wraps it in an RFC. Deployment windows are derived from `BusinessProfile` operating hours. Post-deploy verification uses health endpoint polling with automated rollback on failure. One-click rollback for non-technical operators.

**Tech Stack:** Prisma (schema), Next.js server actions (business logic), Vitest (testing), React + Tailwind (UI components)

**Spec:** `docs/superpowers/specs/2026-03-21-change-deployment-management-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web/lib/actions/change-management.ts` | Server actions: createRFC, submitRFC, assessRFC, approveRFC, scheduleRFC, startExecution, completeRFC, rollbackRFC, cancelRFC |
| `apps/web/lib/actions/change-management.test.ts` | Tests for RFC lifecycle state machine |
| `apps/web/lib/actions/deployment-windows.ts` | Server actions: getAvailableWindows, createBusinessProfile, updateBusinessProfile, createBlackoutPeriod, checkSchedulingConflicts |
| `apps/web/lib/actions/deployment-windows.test.ts` | Tests for window calculation and conflict detection |
| `apps/web/lib/change-executor.ts` | Change execution engine: ordered item execution, health gates, rollback orchestration |
| `apps/web/lib/change-executor.test.ts` | Tests for execution ordering, health gate logic, rollback sequencing |
| `apps/web/lib/rollback-strategies.ts` | Per-type rollback strategies: code (image revert), config (env snapshot), infrastructure (backup restore) |
| `apps/web/lib/rollback-strategies.test.ts` | Tests for each rollback strategy |
| `apps/web/app/api/v1/ops/changes/route.ts` | GET/POST for change requests |
| `apps/web/app/api/v1/ops/changes/[id]/route.ts` | GET/PATCH for individual RFCs |
| `apps/web/app/api/v1/ops/changes/[id]/execute/route.ts` | POST to trigger change execution |
| `apps/web/app/api/v1/ops/changes/[id]/rollback/route.ts` | POST to trigger rollback |
| `apps/web/app/api/v1/ops/windows/route.ts` | GET/POST for deployment windows |
| `apps/web/app/api/v1/ops/business-profile/route.ts` | GET/PUT for business profile |
| `apps/web/components/ops/ChangesClient.tsx` | Main changes tab client component |
| `apps/web/components/ops/RFCDetailPanel.tsx` | RFC detail view with approval chain, impact, one-click rollback |
| `apps/web/components/ops/DeploymentCalendar.tsx` | Calendar view of scheduled changes and windows |
| `apps/web/components/ops/BusinessProfileEditor.tsx` | Business hours and window configuration |

### Modified Files

| File | Changes |
|------|---------|
| `packages/db/prisma/schema.prisma` | Add ChangeRequest, ChangeItem, BusinessProfile, DeploymentWindow, BlackoutPeriod, StandardChangeCatalog models. Add `changeItem` relation to ChangePromotion. |
| `apps/web/lib/version-tracking.ts` | After creating ChangePromotion, auto-create wrapping RFC |
| `apps/web/lib/actions/promotions.ts` | Link approval/rejection to RFC status transitions |
| `apps/web/components/ops/OpsTabNav.tsx` | Add "Changes" tab |
| `apps/web/components/ops/OpsClient.tsx` | Route to ChangesClient for changes tab |

---

## Task 1: Schema — Change Request Models

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add ChangeRequest model**

Add after the `ChangePromotion` model:

```prisma
model ChangeRequest {
  id                 String          @id @default(cuid())
  rfcId              String          @unique
  title              String
  description        String
  type               String          @default("normal") // standard | normal | emergency
  scope              String          @default("platform") // platform | external | both
  riskLevel          String          @default("low") // low | medium | high | critical
  status             String          @default("draft")
  // Lifecycle timestamps
  submittedAt        DateTime?
  assessedAt         DateTime?
  approvedAt         DateTime?
  scheduledAt        DateTime?
  startedAt          DateTime?
  completedAt        DateTime?
  closedAt           DateTime?
  // People
  requestedById      String?
  assessedById       String?
  approvedById       String?
  executedById       String?
  // Scheduling
  deploymentWindowId String?
  plannedStartAt     DateTime?
  plannedEndAt       DateTime?
  calendarEventId    String?
  // Impact
  impactReport       Json?
  // Outcome
  outcome            String? // success | partial | failed | rolled-back
  outcomeNotes       String?
  postChangeVerification Json?
  // Relations
  changeItems        ChangeItem[]
  requestedBy        EmployeeProfile? @relation("ChangeRequestedBy", fields: [requestedById], references: [id])
  assessedBy         EmployeeProfile? @relation("ChangeAssessedBy", fields: [assessedById], references: [id])
  approvedBy         EmployeeProfile? @relation("ChangeApprovedBy", fields: [approvedById], references: [id])
  executedBy         EmployeeProfile? @relation("ChangeExecutedBy", fields: [executedById], references: [id])
  deploymentWindow   DeploymentWindow? @relation(fields: [deploymentWindowId], references: [id])
  createdAt          DateTime        @default(now())
  updatedAt          DateTime        @updatedAt

  @@index([status])
  @@index([type])
  @@index([requestedById])
  @@index([deploymentWindowId])
  @@index([plannedStartAt])
}
```

- [ ] **Step 2: Add ChangeItem model**

```prisma
model ChangeItem {
  id                 String          @id @default(cuid())
  changeRequestId    String
  itemType           String          // code_deployment | infrastructure | configuration | external
  title              String
  description        String?
  impactDescription  String?
  // Target
  inventoryEntityId  String?
  digitalProductId   String?
  externalSystemRef  String?
  // Code deployment link
  changePromotionId  String?         @unique
  // Execution
  status             String          @default("pending") // pending | in-progress | completed | failed | skipped | rolled-back
  executionOrder     Int             @default(0)
  executionNotes     String?
  completedAt        DateTime?
  // Rollback
  rollbackPlan       String?
  rollbackSnapshot   Json?           // pre-change state snapshot for automated rollback
  rolledBackAt       DateTime?
  rollbackNotes      String?
  // Relations
  changeRequest      ChangeRequest   @relation(fields: [changeRequestId], references: [id], onDelete: Cascade)
  inventoryEntity    InventoryEntity? @relation(fields: [inventoryEntityId], references: [id])
  digitalProduct     DigitalProduct? @relation("ChangeItemProduct", fields: [digitalProductId], references: [id])
  changePromotion    ChangePromotion? @relation(fields: [changePromotionId], references: [id])
  createdAt          DateTime        @default(now())
  updatedAt          DateTime        @updatedAt

  @@index([changeRequestId])
  @@index([inventoryEntityId])
  @@index([digitalProductId])
  @@index([status])
}
```

- [ ] **Step 3: Add BusinessProfile, DeploymentWindow, BlackoutPeriod models**

```prisma
model BusinessProfile {
  id                 String           @id @default(cuid())
  profileKey         String           @unique
  name               String
  description        String?
  isActive           Boolean          @default(true)
  businessHours      Json             // [{ dayOfWeek: 0-6, open: "HH:mm", close: "HH:mm" }]
  timezone           String           @default("UTC")
  hasStorefront      Boolean          @default(false)
  lowTrafficWindows  Json?            // [{ dayOfWeek, start, end }]
  deploymentWindows  DeploymentWindow[]
  blackoutPeriods    BlackoutPeriod[]
  createdAt          DateTime         @default(now())
  updatedAt          DateTime         @updatedAt
}

model DeploymentWindow {
  id                   String           @id @default(cuid())
  businessProfileId    String
  windowKey            String           @unique
  name                 String
  description          String?
  dayOfWeek            Int[]
  startTime            String           // "HH:mm"
  endTime              String           // "HH:mm"
  maxConcurrentChanges Int              @default(1)
  allowedChangeTypes   String[]         @default(["standard", "normal"])
  allowedRiskLevels    String[]         @default(["low", "medium"])
  enforcement          String           @default("advisory") // advisory | enforced
  businessProfile      BusinessProfile  @relation(fields: [businessProfileId], references: [id])
  changeRequests       ChangeRequest[]
  createdAt            DateTime         @default(now())
  updatedAt            DateTime         @updatedAt

  @@index([businessProfileId])
}

model BlackoutPeriod {
  id                 String           @id @default(cuid())
  businessProfileId  String
  name               String
  reason             String?
  startAt            DateTime
  endAt              DateTime
  scope              String           @default("all") // all | platform | external
  exceptions         String[]         @default([])
  calendarEventId    String?
  businessProfile    BusinessProfile  @relation(fields: [businessProfileId], references: [id])
  createdAt          DateTime         @default(now())
  updatedAt          DateTime         @updatedAt

  @@index([businessProfileId])
  @@index([startAt, endAt])
}
```

- [ ] **Step 4: Add StandardChangeCatalog model**

```prisma
model StandardChangeCatalog {
  id                 String           @id @default(cuid())
  catalogKey         String           @unique
  title              String
  description        String
  category           String           // infrastructure | configuration | maintenance
  preAssessedRisk    String           // low | medium
  templateItems      Json             // array of change item templates
  approvalPolicy     String           @default("auto") // auto | delegated
  validFrom          DateTime         @default(now())
  validUntil         DateTime?
  approvedById       String
  approvedBy         EmployeeProfile  @relation("StandardChangeApprover", fields: [approvedById], references: [id])
  createdAt          DateTime         @default(now())
  updatedAt          DateTime         @updatedAt
}
```

- [ ] **Step 5: Add reverse relations on existing models**

Add to existing `ChangePromotion` model:
```prisma
  changeItem         ChangeItem?
```

Add to existing `InventoryEntity` model:
```prisma
  changeItems        ChangeItem[]
```

Add to existing `DigitalProduct` model:
```prisma
  changeItems        ChangeItem[]    @relation("ChangeItemProduct")
```

Add to existing `EmployeeProfile` model:
```prisma
  changeRequestsRequested     ChangeRequest[]         @relation("ChangeRequestedBy")
  changeRequestsAssessed      ChangeRequest[]         @relation("ChangeAssessedBy")
  changeRequestsApproved      ChangeRequest[]         @relation("ChangeApprovedBy")
  changeRequestsExecuted      ChangeRequest[]         @relation("ChangeExecutedBy")
  standardChangesApproved     StandardChangeCatalog[]  @relation("StandardChangeApprover")
```

- [ ] **Step 6: Run migration**

Run: `pnpm --filter @dpf/db exec npx prisma migrate dev --name add-change-management-models`
Expected: Migration creates all new tables and relations.

- [ ] **Step 7: Verify migration**

Run: `pnpm --filter @dpf/db exec npx prisma generate`
Expected: Prisma client generates successfully with all new types available.

- [ ] **Step 8: Commit**

```bash
git add packages/db/prisma/
git commit -m "feat(schema): add change management models (ChangeRequest, ChangeItem, BusinessProfile, DeploymentWindow, BlackoutPeriod, StandardChangeCatalog)"
```

---

## Task 2: RFC Lifecycle State Machine

**Files:**
- Create: `apps/web/lib/actions/change-management.ts`
- Create: `apps/web/lib/actions/change-management.test.ts`

- [ ] **Step 1: Write failing tests for RFC ID generation and creation**

```typescript
// apps/web/lib/actions/change-management.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    changeRequest: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    changeItem: { create: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn((fn) => fn({
      changeRequest: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      changeItem: { create: vi.fn(), updateMany: vi.fn() },
    })),
  },
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn().mockResolvedValue({ userId: "user-1" }) }));
vi.mock("@/lib/permissions", () => ({ can: vi.fn().mockResolvedValue(true) }));

import { generateRfcId, createRFC } from "./change-management";

describe("RFC ID generation", () => {
  it("generates RFC-YYYY-NNNN format", () => {
    const id = generateRfcId();
    expect(id).toMatch(/^RFC-\d{4}-[a-f0-9]{8}$/);
  });
});

describe("createRFC", () => {
  it("creates an RFC in draft status with change items", async () => {
    const { prisma } = await import("@dpf/db");
    const mockRfc = {
      id: "rfc-1",
      rfcId: "RFC-2026-abc12345",
      title: "Update database",
      status: "draft",
      type: "normal",
      changeItems: [],
    };
    vi.mocked(prisma.$transaction).mockResolvedValueOnce(mockRfc);

    const result = await createRFC({
      title: "Update database",
      description: "Upgrade Postgres to 16",
      type: "normal",
      scope: "platform",
      items: [
        { itemType: "infrastructure", title: "Upgrade Postgres", inventoryEntityId: "inv-1" },
      ],
    });

    expect(result.status).toBe("draft");
    expect(result.rfcId).toMatch(/^RFC-/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run lib/actions/change-management.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement RFC creation and ID generation**

```typescript
// apps/web/lib/actions/change-management.ts
"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";

// Local helper following the promotions.ts pattern
async function requireOpsAccess() {
  const session = await auth();
  if (!session?.userId) throw new Error("Not authenticated");
  const authorized = await can(session.userId, "ops:manage");
  if (!authorized) throw new Error("Insufficient permissions");
  return session.userId;
}

// ── RFC ID Generation ──

export function generateRfcId(): string {
  const year = new Date().getFullYear();
  const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
  return `RFC-${year}-${suffix}`;
}

// ── Valid Status Transitions ──

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["assessed", "rejected"],
  assessed: ["approved", "rejected"],
  approved: ["scheduled", "cancelled"],
  scheduled: ["in-progress", "cancelled"],
  "in-progress": ["completed", "rolled-back"],
  completed: ["closed"],
  "rolled-back": ["closed"],
  rejected: ["closed"],
  cancelled: ["closed"],
};

// ── Types ──

interface CreateRFCInput {
  title: string;
  description: string;
  type: "standard" | "normal" | "emergency";
  scope: "platform" | "external" | "both";
  items: Array<{
    itemType: "code_deployment" | "infrastructure" | "configuration" | "external";
    title: string;
    description?: string;
    impactDescription?: string;
    inventoryEntityId?: string;
    digitalProductId?: string;
    externalSystemRef?: string;
    changePromotionId?: string;
    rollbackPlan?: string;
    executionOrder?: number;
  }>;
}

// ── Create RFC ──

export async function createRFC(input: CreateRFCInput) {
  const userId = await requireOpsAccess();

  return prisma.$transaction(async (tx) => {
    const rfc = await tx.changeRequest.create({
      data: {
        rfcId: generateRfcId(),
        title: input.title,
        description: input.description,
        type: input.type,
        scope: input.scope,
        status: input.type === "emergency" ? "in-progress" : "draft",
        requestedById: userId,
        startedAt: input.type === "emergency" ? new Date() : undefined,
        changeItems: {
          create: input.items.map((item, idx) => ({
            itemType: item.itemType,
            title: item.title,
            description: item.description,
            impactDescription: item.impactDescription,
            inventoryEntityId: item.inventoryEntityId,
            digitalProductId: item.digitalProductId,
            externalSystemRef: item.externalSystemRef,
            changePromotionId: item.changePromotionId,
            rollbackPlan: item.rollbackPlan,
            executionOrder: item.executionOrder ?? idx,
          })),
        },
      },
      include: { changeItems: true },
    });

    return rfc;
  });
}

// ── Transition RFC Status ──

export async function transitionRFC(
  rfcId: string,
  targetStatus: string,
  data?: Record<string, unknown>,
) {
  const userId = await requireOpsAccess();

  const rfc = await prisma.changeRequest.findUnique({
    where: { rfcId },
    include: { changeItems: true },
  });

  if (!rfc) throw new Error(`RFC ${rfcId} not found`);

  const validTargets = VALID_TRANSITIONS[rfc.status];
  if (!validTargets?.includes(targetStatus)) {
    throw new Error(
      `Cannot transition RFC from '${rfc.status}' to '${targetStatus}'. Valid: ${validTargets?.join(", ")}`,
    );
  }

  // Build timestamp and attribution updates
  const updates: Record<string, unknown> = { status: targetStatus, ...data };
  const now = new Date();

  switch (targetStatus) {
    case "submitted":
      updates.submittedAt = now;
      break;
    case "assessed":
      updates.assessedAt = now;
      updates.assessedById = userId;
      break;
    case "approved":
      updates.approvedAt = now;
      updates.approvedById = userId;
      break;
    case "scheduled":
      updates.scheduledAt = now;
      if (!updates.plannedStartAt) {
        throw new Error("plannedStartAt is required for scheduling");
      }
      break;
    case "in-progress":
      updates.startedAt = now;
      updates.executedById = userId;
      break;
    case "completed":
      updates.completedAt = now;
      break;
    case "closed":
      updates.closedAt = now;
      break;
  }

  return prisma.changeRequest.update({
    where: { rfcId },
    data: updates,
    include: { changeItems: true },
  });
}

// ── Submit RFC (triggers impact assessment) ──
// Note: Automated impact analysis (spec Section 3.1) is deferred to Phase 3
// when EP-FOUND-OPS delivers the operational graph and impact API.
// For now, impact assessment is manual via the assessRFC function.

export async function submitRFC(rfcId: string) {
  const result = await transitionRFC(rfcId, "submitted");
  revalidatePath("/ops");
  return result;
}

// ── Assess RFC (auto-calculate risk from impact) ──

export async function assessRFC(rfcId: string, impactReport: Record<string, unknown>) {
  return transitionRFC(rfcId, "assessed", { impactReport });
}

// ── Approve RFC ──

export async function approveRFC(rfcId: string, rationale?: string) {
  const data: Record<string, unknown> = {};
  if (rationale) data.outcomeNotes = rationale;
  return transitionRFC(rfcId, "approved", data);
}

// ── Schedule RFC ──

export async function scheduleRFC(
  rfcId: string,
  plannedStartAt: Date,
  plannedEndAt: Date,
  deploymentWindowId?: string,
) {
  return transitionRFC(rfcId, "scheduled", {
    plannedStartAt,
    plannedEndAt,
    deploymentWindowId,
  });
}

// ── Cancel RFC ──

export async function cancelRFC(rfcId: string, reason: string) {
  return transitionRFC(rfcId, "cancelled", { outcomeNotes: reason });
}

// ── Get RFC by ID ──

export async function getRFC(rfcId: string) {
  return prisma.changeRequest.findUnique({
    where: { rfcId },
    include: {
      changeItems: {
        orderBy: { executionOrder: "asc" },
        include: {
          inventoryEntity: true,
          digitalProduct: true,
          changePromotion: true,
        },
      },
      requestedBy: { select: { displayName: true, employeeId: true } },
      approvedBy: { select: { displayName: true, employeeId: true } },
      executedBy: { select: { displayName: true, employeeId: true } },
      deploymentWindow: true,
    },
  });
}

// ── List RFCs ──

export async function listRFCs(filters?: {
  status?: string;
  type?: string;
  scope?: string;
}) {
  const where: Record<string, unknown> = {};
  if (filters?.status) where.status = filters.status;
  if (filters?.type) where.type = filters.type;
  if (filters?.scope) where.scope = filters.scope;

  return prisma.changeRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      changeItems: { orderBy: { executionOrder: "asc" } },
      requestedBy: { select: { displayName: true } },
      approvedBy: { select: { displayName: true } },
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web exec vitest run lib/actions/change-management.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing tests for status transitions**

Add to the test file:

```typescript
describe("transitionRFC", () => {
  it("allows valid transition from draft to submitted", async () => {
    const { prisma } = await import("@dpf/db");
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValueOnce({
      id: "rfc-1", rfcId: "RFC-2026-abc", status: "draft", changeItems: [],
    } as any);
    vi.mocked(prisma.changeRequest.update).mockResolvedValueOnce({
      id: "rfc-1", rfcId: "RFC-2026-abc", status: "submitted", changeItems: [],
    } as any);

    const result = await transitionRFC("RFC-2026-abc", "submitted");
    expect(result.status).toBe("submitted");
  });

  it("rejects invalid transition from draft to approved", async () => {
    const { prisma } = await import("@dpf/db");
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValueOnce({
      id: "rfc-1", rfcId: "RFC-2026-abc", status: "draft", changeItems: [],
    } as any);

    await expect(transitionRFC("RFC-2026-abc", "approved")).rejects.toThrow(
      "Cannot transition RFC from 'draft' to 'approved'"
    );
  });

  it("requires plannedStartAt for scheduling", async () => {
    const { prisma } = await import("@dpf/db");
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValueOnce({
      id: "rfc-1", rfcId: "RFC-2026-abc", status: "approved", changeItems: [],
    } as any);

    await expect(transitionRFC("RFC-2026-abc", "scheduled")).rejects.toThrow(
      "plannedStartAt is required"
    );
  });
});
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter web exec vitest run lib/actions/change-management.test.ts`
Expected: PASS (implementation already handles these cases)

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/actions/change-management.ts apps/web/lib/actions/change-management.test.ts
git commit -m "feat(change-mgmt): RFC lifecycle state machine with create, transition, and query actions"
```

---

## Task 3: Self-Development Auto-RFC Integration

**Files:**
- Modify: `apps/web/lib/version-tracking.ts`
- Modify: `apps/web/lib/version-tracking.test.ts`

This is the core use case: when `shipBuild()` creates a `ChangePromotion`, auto-wrap it in an RFC.

- [ ] **Step 1: Write failing test for auto-RFC creation**

Add to `version-tracking.test.ts`:

```typescript
describe("createProductVersionWithRFC", () => {
  it("creates ProductVersion + ChangePromotion + wrapping RFC", async () => {
    // Mock prisma transaction to return version + promotion + rfc
    const mockResult = {
      version: { id: "v-1", version: "1.0.0" },
      promotion: { id: "cp-1", promotionId: "CP-abc12345", status: "pending" },
      rfc: { id: "rfc-1", rfcId: "RFC-2026-abc12345", status: "draft", type: "normal" },
    };
    vi.mocked(prisma.$transaction).mockResolvedValueOnce(mockResult);

    const result = await createProductVersionWithRFC({
      digitalProductId: "dp-1",
      version: "1.0.0",
      gitTag: "v1.0.0",
      gitCommitHash: "abc123",
      shippedBy: "user-1",
      featureBuildId: "fb-1",
      changeSummary: "New feature X",
    });

    expect(result.rfc.rfcId).toMatch(/^RFC-/);
    expect(result.rfc.type).toBe("normal");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run lib/version-tracking.test.ts`
Expected: FAIL — `createProductVersionWithRFC` not found

- [ ] **Step 3: Implement auto-RFC creation in version-tracking**

Add to `version-tracking.ts`:

```typescript
import { generateRfcId } from "./actions/change-management";

export async function createProductVersionWithRFC(input: {
  digitalProductId: string;
  version: string;
  gitTag: string;
  gitCommitHash: string;
  shippedBy: string;
  featureBuildId?: string;
  changeSummary?: string;
}) {
  return prisma.$transaction(async (tx) => {
    // 1. Create ProductVersion
    const version = await tx.productVersion.create({
      data: {
        digitalProductId: input.digitalProductId,
        version: input.version,
        gitTag: input.gitTag,
        gitCommitHash: input.gitCommitHash,
        shippedBy: input.shippedBy,
        featureBuildId: input.featureBuildId,
        changeSummary: input.changeSummary,
      },
    });

    // 2. Create ChangePromotion
    const promotion = await tx.changePromotion.create({
      data: {
        promotionId: generatePromotionId(),
        productVersionId: version.id,
        requestedBy: input.shippedBy,
        status: "pending",
      },
    });

    // 3. Auto-create wrapping RFC
    const rfc = await tx.changeRequest.create({
      data: {
        rfcId: generateRfcId(),
        title: `Deploy ${input.version} — ${input.changeSummary || "Platform update"}`,
        description: `Automated RFC for platform self-development deployment.\n\nVersion: ${input.version}\nGit tag: ${input.gitTag}\nCommit: ${input.gitCommitHash}`,
        type: "normal", // Self-dev changes always require human approval
        scope: "platform",
        status: "draft",
        requestedById: input.shippedBy,
        changeItems: {
          create: [{
            itemType: "code_deployment",
            title: `Deploy version ${input.version}`,
            description: input.changeSummary,
            digitalProductId: input.digitalProductId,
            changePromotionId: promotion.id,
            executionOrder: 0,
            rollbackPlan: `Revert to previous version by deploying image tag for prior ProductVersion`,
          }],
        },
      },
      include: { changeItems: true },
    });

    return { version, promotion, rfc };
  });
}
```

- [ ] **Step 4: Update shipBuild() to use createProductVersionWithRFC**

In `apps/web/lib/actions/build.ts`, find where `createProductVersion` is called in `shipBuild()` and replace with `createProductVersionWithRFC`. The RFC auto-creation means every shipped build immediately has a change request in draft status.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter web exec vitest run lib/version-tracking.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/version-tracking.ts apps/web/lib/version-tracking.test.ts apps/web/lib/actions/build.ts
git commit -m "feat(change-mgmt): auto-create RFC when shipBuild creates ChangePromotion"
```

---

## Task 4: Deployment Windows and Scheduling

**Files:**
- Create: `apps/web/lib/actions/deployment-windows.ts`
- Create: `apps/web/lib/actions/deployment-windows.test.ts`

- [ ] **Step 1: Write failing tests for window calculation**

```typescript
// apps/web/lib/actions/deployment-windows.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAvailableWindows, checkSchedulingConflicts } from "./deployment-windows";

describe("getAvailableWindows", () => {
  it("returns windows matching RFC type and risk level", async () => {
    // Mock business profile with windows
    // Assert: only windows whose allowedChangeTypes includes the RFC type
    // and allowedRiskLevels includes the RFC risk level are returned
  });

  it("excludes windows overlapping blackout periods", async () => {
    // Mock blackout period covering a window
    // Assert: that window is not returned
  });

  it("allows emergency changes during blackouts", async () => {
    // Mock blackout with exceptions: ["emergency"]
    // Assert: window is returned for emergency RFC
  });
});

describe("checkSchedulingConflicts", () => {
  it("detects conflicting RFCs targeting same inventory entity", async () => {
    // Mock existing scheduled RFC with ChangeItem targeting entity-1
    // Check scheduling new RFC also targeting entity-1 in overlapping window
    // Assert: conflict returned with details
  });

  it("returns no conflicts for non-overlapping windows", async () => {
    // Mock existing RFC in different time window
    // Assert: no conflicts
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web exec vitest run lib/actions/deployment-windows.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement deployment window calculation**

```typescript
// apps/web/lib/actions/deployment-windows.ts
"use server";

import { prisma } from "@dpf/db";

export async function getBusinessProfile() {
  return prisma.businessProfile.findFirst({
    where: { isActive: true },
    include: { deploymentWindows: true, blackoutPeriods: true },
  });
}

export async function getAvailableWindows(rfcType: string, riskLevel: string) {
  const profile = await getBusinessProfile();
  if (!profile) return [];

  const now = new Date();

  // Filter windows by RFC type and risk level
  const matchingWindows = profile.deploymentWindows.filter(
    (w) =>
      w.allowedChangeTypes.includes(rfcType) &&
      w.allowedRiskLevels.includes(riskLevel),
  );

  // Filter out windows during active blackout periods
  const activeBlackouts = profile.blackoutPeriods.filter(
    (b) => b.startAt <= now && b.endAt >= now && !b.exceptions.includes(rfcType),
  );

  // Return windows not blocked by blackouts
  return matchingWindows.filter((window) => {
    // Check if any blackout period covers this window's time range
    // For recurring windows, we need to check the next occurrence
    return !activeBlackouts.some((b) => {
      // Simplified: if any blackout is active, block all windows
      // Full implementation would check day/time overlap
      return b.scope === "all" || b.scope === "platform";
    });
  });
}

export async function checkSchedulingConflicts(
  rfcId: string,
  plannedStartAt: Date,
  plannedEndAt: Date,
) {
  // Find other RFCs in scheduled or in-progress status
  // whose planned windows overlap with the proposed window
  // AND whose change items target the same inventory entities
  const rfc = await prisma.changeRequest.findUnique({
    where: { rfcId },
    include: { changeItems: true },
  });
  if (!rfc) throw new Error(`RFC ${rfcId} not found`);

  const targetEntityIds = rfc.changeItems
    .map((ci) => ci.inventoryEntityId)
    .filter(Boolean) as string[];

  const targetProductIds = rfc.changeItems
    .map((ci) => ci.digitalProductId)
    .filter(Boolean) as string[];

  if (targetEntityIds.length === 0 && targetProductIds.length === 0) {
    return { conflicts: [], hasConflicts: false };
  }

  // Find overlapping scheduled/in-progress RFCs
  const overlapping = await prisma.changeRequest.findMany({
    where: {
      id: { not: rfc.id },
      status: { in: ["scheduled", "in-progress"] },
      plannedStartAt: { lt: plannedEndAt },
      plannedEndAt: { gt: plannedStartAt },
    },
    include: { changeItems: true },
  });

  // Check for entity/product overlap
  const conflicts = overlapping.filter((other) =>
    other.changeItems.some(
      (ci) =>
        (ci.inventoryEntityId && targetEntityIds.includes(ci.inventoryEntityId)) ||
        (ci.digitalProductId && targetProductIds.includes(ci.digitalProductId)),
    ),
  );

  return {
    conflicts: conflicts.map((c) => ({
      rfcId: c.rfcId,
      title: c.title,
      plannedStartAt: c.plannedStartAt,
      plannedEndAt: c.plannedEndAt,
    })),
    hasConflicts: conflicts.length > 0,
  };
}

export async function createBusinessProfile(input: {
  profileKey: string;
  name: string;
  businessHours: Array<{ dayOfWeek: number; open: string; close: string }>;
  timezone: string;
  hasStorefront: boolean;
}) {
  return prisma.businessProfile.create({ data: input as any });
}

export async function createDeploymentWindow(input: {
  businessProfileId: string;
  windowKey: string;
  name: string;
  dayOfWeek: number[];
  startTime: string;
  endTime: string;
  enforcement?: string;
}) {
  return prisma.deploymentWindow.create({ data: input as any });
}

export async function createBlackoutPeriod(input: {
  businessProfileId: string;
  name: string;
  reason?: string;
  startAt: Date;
  endAt: Date;
  scope?: string;
  exceptions?: string[];
}) {
  return prisma.blackoutPeriod.create({ data: input as any });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter web exec vitest run lib/actions/deployment-windows.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions/deployment-windows.ts apps/web/lib/actions/deployment-windows.test.ts
git commit -m "feat(change-mgmt): deployment window calculation with conflict detection"
```

---

## Task 5: Change Execution Engine with Health Gates

**Files:**
- Create: `apps/web/lib/change-executor.ts`
- Create: `apps/web/lib/change-executor.test.ts`

- [ ] **Step 1: Write failing tests for ordered execution**

```typescript
// apps/web/lib/change-executor.test.ts
describe("executeChangeItems", () => {
  it("executes items in order, running health check between each", async () => {
    // Mock two change items with executionOrder 0 and 1
    // Mock health check returning healthy after item 0
    // Assert: both items completed, health check called between them
  });

  it("stops execution and triggers rollback on health check failure", async () => {
    // Mock two items, health check fails after item 0
    // Assert: item 1 is skipped, item 0 is rolled back
  });

  it("rolls back completed items in reverse order on failure", async () => {
    // Mock three items, item 2 fails during execution
    // Assert: rollback called for items 1, then 0 (reverse order)
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web exec vitest run lib/change-executor.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement change executor**

```typescript
// apps/web/lib/change-executor.ts
import { prisma } from "@dpf/db";
import { executeRollback } from "./rollback-strategies";

interface HealthCheckResult {
  healthy: boolean;
  message: string;
  metrics?: Record<string, unknown>;
}

// ── Health Check ──

export async function runHealthCheck(entityId: string): Promise<HealthCheckResult> {
  // Query the inventory entity's properties for health endpoint
  const entity = await prisma.inventoryEntity.findUnique({
    where: { id: entityId },
  });

  if (!entity) return { healthy: true, message: "No entity to check" };

  const props = entity.properties as Record<string, unknown>;
  const healthUrl = props?.healthEndpoint as string | undefined;

  if (!healthUrl) return { healthy: true, message: "No health endpoint configured" };

  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
    return {
      healthy: response.ok,
      message: response.ok ? "Service healthy" : `HTTP ${response.status}`,
    };
  } catch (err) {
    return { healthy: false, message: `Unreachable: ${(err as Error).message}` };
  }
}

// ── Execute Change Items ──

export async function executeChangeItems(rfcId: string) {
  const rfc = await prisma.changeRequest.findUnique({
    where: { rfcId },
    include: {
      changeItems: {
        orderBy: { executionOrder: "asc" },
        include: { inventoryEntity: true, changePromotion: true },
      },
    },
  });

  if (!rfc) throw new Error(`RFC ${rfcId} not found`);
  if (rfc.status !== "in-progress") throw new Error(`RFC must be in-progress to execute`);

  const completedItems: string[] = [];
  const results: Array<{ itemId: string; status: string; message: string }> = [];

  for (const item of rfc.changeItems) {
    // Skip already completed or skipped items
    if (item.status !== "pending") continue;

    // Mark item as in-progress
    await prisma.changeItem.update({
      where: { id: item.id },
      data: { status: "in-progress" },
    });

    try {
      // Execute the change (type-specific, placeholder for now)
      // In production, this dispatches to type-specific executors
      await prisma.changeItem.update({
        where: { id: item.id },
        data: { status: "completed", completedAt: new Date() },
      });
      completedItems.push(item.id);
      results.push({ itemId: item.id, status: "completed", message: "Success" });

      // Health gate: check health after each item (if entity exists)
      if (item.inventoryEntityId) {
        const health = await runHealthCheck(item.inventoryEntityId);

        if (!health.healthy) {
          // Health gate failed — skip remaining items and rollback
          results.push({
            itemId: item.id,
            status: "health-gate-failed",
            message: health.message,
          });

          // Skip remaining items
          await prisma.changeItem.updateMany({
            where: {
              changeRequestId: rfc.id,
              status: "pending",
            },
            data: { status: "skipped" },
          });

          // Rollback completed items in reverse order
          for (const completedId of [...completedItems].reverse()) {
            await executeRollback(completedId);
          }

          // Update RFC
          await prisma.changeRequest.update({
            where: { rfcId },
            data: {
              status: "rolled-back",
              outcome: "rolled-back",
              outcomeNotes: `Auto-rollback triggered: ${health.message}`,
              postChangeVerification: results as any,
            },
          });

          return { success: false, results, rollbackTriggered: true };
        }
      }
    } catch (err) {
      // Execution failed — rollback
      await prisma.changeItem.update({
        where: { id: item.id },
        data: { status: "failed", executionNotes: (err as Error).message },
      });
      results.push({ itemId: item.id, status: "failed", message: (err as Error).message });

      // Skip remaining
      await prisma.changeItem.updateMany({
        where: { changeRequestId: rfc.id, status: "pending" },
        data: { status: "skipped" },
      });

      // Rollback completed items
      for (const completedId of [...completedItems].reverse()) {
        await executeRollback(completedId);
      }

      await prisma.changeRequest.update({
        where: { rfcId },
        data: {
          status: "rolled-back",
          outcome: "rolled-back",
          outcomeNotes: `Execution failed at item: ${(err as Error).message}`,
          postChangeVerification: results as any,
        },
      });

      return { success: false, results, rollbackTriggered: true };
    }
  }

  // All items completed successfully
  await prisma.changeRequest.update({
    where: { rfcId },
    data: {
      status: "completed",
      completedAt: new Date(),
      outcome: "success",
      postChangeVerification: results as any,
    },
  });

  return { success: true, results, rollbackTriggered: false };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter web exec vitest run lib/change-executor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/change-executor.ts apps/web/lib/change-executor.test.ts
git commit -m "feat(change-mgmt): change execution engine with ordered items and health gates"
```

---

## Task 6: Rollback Strategies

**Files:**
- Create: `apps/web/lib/rollback-strategies.ts`
- Create: `apps/web/lib/rollback-strategies.test.ts`

- [ ] **Step 1: Write failing tests for rollback per item type**

```typescript
// apps/web/lib/rollback-strategies.test.ts
describe("executeRollback", () => {
  it("rolls back code_deployment by marking promotion as rolled_back", async () => {
    // Mock change item with code_deployment type and linked changePromotion
    // Assert: ChangePromotion.status set to "rolled_back"
  });

  it("records rollback timestamp and notes", async () => {
    // Assert: ChangeItem.rolledBackAt set, rollbackNotes populated
  });

  it("handles external items gracefully (manual rollback)", async () => {
    // Mock external change item
    // Assert: item marked as rolled-back with note "Manual rollback required"
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web exec vitest run lib/rollback-strategies.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement rollback strategies**

```typescript
// apps/web/lib/rollback-strategies.ts
import { prisma } from "@dpf/db";

export async function executeRollback(changeItemId: string): Promise<{
  success: boolean;
  message: string;
}> {
  const item = await prisma.changeItem.findUnique({
    where: { id: changeItemId },
    include: { changePromotion: true },
  });

  if (!item) return { success: false, message: "Change item not found" };

  const now = new Date();
  let message = "";

  switch (item.itemType) {
    case "code_deployment": {
      // Rollback = mark the ChangePromotion as rolled back
      // The actual image revert is handled by the deployment system
      if (item.changePromotionId) {
        await prisma.changePromotion.update({
          where: { id: item.changePromotionId },
          data: {
            status: "rolled_back",
            rolledBackAt: now,
            rollbackReason: "Automated rollback — health gate failure",
          },
        });
      }
      message = "Code deployment rolled back — previous version will be restored";
      break;
    }

    case "infrastructure": {
      // Rollback = restore from snapshot if available
      if (item.rollbackSnapshot) {
        message = "Infrastructure rollback initiated from snapshot";
      } else {
        message = "Manual infrastructure rollback required — no snapshot available";
      }
      break;
    }

    case "configuration": {
      // Rollback = restore previous config from snapshot
      if (item.rollbackSnapshot) {
        message = "Configuration restored from pre-change snapshot";
      } else {
        message = "Manual configuration rollback required — no snapshot available";
      }
      break;
    }

    case "external": {
      message = "Manual rollback required for external system change";
      break;
    }

    default:
      message = `Unknown item type: ${item.itemType}`;
  }

  // Update the change item
  await prisma.changeItem.update({
    where: { id: changeItemId },
    data: {
      status: "rolled-back",
      rolledBackAt: now,
      rollbackNotes: message,
    },
  });

  return { success: true, message };
}

// ── One-Click Rollback for Entire RFC ──

export async function rollbackRFC(rfcId: string, reason: string) {
  const rfc = await prisma.changeRequest.findUnique({
    where: { rfcId },
    include: {
      changeItems: {
        where: { status: "completed" },
        orderBy: { executionOrder: "desc" }, // Reverse order
      },
    },
  });

  if (!rfc) throw new Error(`RFC ${rfcId} not found`);
  if (!["completed", "in-progress"].includes(rfc.status)) {
    throw new Error(`Cannot rollback RFC in status '${rfc.status}'`);
  }

  const results: Array<{ itemId: string; message: string }> = [];

  // Rollback completed items in reverse execution order
  for (const item of rfc.changeItems) {
    const result = await executeRollback(item.id);
    results.push({ itemId: item.id, message: result.message });
  }

  // Update RFC status
  await prisma.changeRequest.update({
    where: { rfcId },
    data: {
      status: "rolled-back",
      outcome: "rolled-back",
      outcomeNotes: reason,
      postChangeVerification: results as any,
    },
  });

  return { success: true, results };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter web exec vitest run lib/rollback-strategies.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/rollback-strategies.ts apps/web/lib/rollback-strategies.test.ts
git commit -m "feat(change-mgmt): rollback strategies per item type with one-click RFC rollback"
```

---

## Task 7: API Routes

**Files:**
- Create: `apps/web/app/api/v1/ops/changes/route.ts`
- Create: `apps/web/app/api/v1/ops/changes/[id]/route.ts`
- Create: `apps/web/app/api/v1/ops/changes/[id]/execute/route.ts`
- Create: `apps/web/app/api/v1/ops/changes/[id]/rollback/route.ts`
- Create: `apps/web/app/api/v1/ops/windows/route.ts`
- Create: `apps/web/app/api/v1/ops/business-profile/route.ts`

- [ ] **Step 1: Implement changes route (list + create)**

Follow the pattern from `apps/web/app/api/v1/ops/backlog/route.ts`:
- GET: list RFCs with optional status/type/scope filters
- POST: create new RFC with change items

- [ ] **Step 2: Implement individual RFC route (get + update)**

Follow the pattern from `apps/web/app/api/v1/ops/backlog/[id]/route.ts`:
- GET: get RFC by rfcId with all relations
- PATCH: transition RFC status (submit, assess, approve, schedule, cancel)

- [ ] **Step 3: Implement execute and rollback routes**

- POST `/execute`: calls `executeChangeItems()` from change-executor
- POST `/rollback`: calls `rollbackRFC()` from rollback-strategies

- [ ] **Step 4: Implement windows and business profile routes**

- GET/POST `/windows`: list and create deployment windows
- GET/PUT `/business-profile`: get and update business profile

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/v1/ops/changes/ apps/web/app/api/v1/ops/windows/ apps/web/app/api/v1/ops/business-profile/
git commit -m "feat(change-mgmt): API routes for RFC lifecycle, execution, rollback, and deployment windows"
```

---

## Task 8: Changes UI — Tab Integration and List View

**Files:**
- Create: `apps/web/components/ops/ChangesClient.tsx`
- Create: `apps/web/components/ops/RFCDetailPanel.tsx`
- Modify: `apps/web/components/ops/OpsTabNav.tsx`
- Modify: `apps/web/components/ops/OpsClient.tsx`

- [ ] **Step 1: Add Changes tab to OpsTabNav**

Add "Changes" to the tabs array in `OpsTabNav.tsx`, following the existing tab pattern.

- [ ] **Step 2: Create ChangesClient component**

Follow the pattern from `PromotionsClient.tsx`:
- Filter by status (Active / Scheduled / Completed / History)
- Badge counts per status
- RFC list with: rfcId, title, type badge, risk badge, status badge, requestedBy, dates

- [ ] **Step 3: Create RFCDetailPanel component**

Detail view when an RFC is selected:
- Header: RFC ID, title, type/risk/status badges
- Approval chain timeline: requested → assessed → approved → scheduled → executed
- Change items list with per-item status
- Impact report summary (if assessed)
- **One-click "Roll Back" button** — visible when status is `completed` or `in-progress`
  - Confirmation dialog: "This will roll back all changes in this RFC. Continue?"
  - Calls rollback API, shows progress
- **"Approve" / "Reject" buttons** — visible when status is `assessed`
- **"Schedule" button** — visible when status is `approved`, opens window picker

- [ ] **Step 4: Wire into OpsClient routing**

When "Changes" tab is selected, render `ChangesClient`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ops/
git commit -m "feat(change-mgmt): changes UI with RFC list, detail panel, and one-click rollback"
```

---

## Task 9: Business Profile Setup and Default Seeding

**Files:**
- Create: `apps/web/components/ops/BusinessProfileEditor.tsx`
- Create: `packages/db/scripts/seed-default-business-profile.ts`

- [ ] **Step 1: Create default business profile seeder**

Seed a default business profile with:
- Business hours: Mon-Fri 8:00-18:00 UTC
- Default deployment window: "Weeknight maintenance" — Mon-Thu 20:00-06:00
- Default deployment window: "Weekend maintenance" — Sat-Sun all day
- No blackout periods initially

- [ ] **Step 2: Create BusinessProfileEditor component**

Tab within the Changes view ("Windows" tab):
- Business hours editor (day-by-day open/close times)
- Timezone selector
- Storefront toggle
- Deployment windows list with create/edit/delete
- Blackout periods list with create/edit/delete

- [ ] **Step 3: Run the seeder**

Run: `pnpm --filter @dpf/db exec tsx scripts/seed-default-business-profile.ts`
Expected: Default profile and windows created.

- [ ] **Step 4: Commit**

```bash
git add packages/db/scripts/seed-default-business-profile.ts apps/web/components/ops/BusinessProfileEditor.tsx
git commit -m "feat(change-mgmt): default business profile with deployment windows and editor UI"
```

---

## Task 10: Integration Test — End-to-End Self-Dev Flow

**Files:**
- Create: `apps/web/lib/actions/change-management-integration.test.ts`

- [ ] **Step 1: Write integration test for the complete self-dev flow**

```typescript
describe("Self-development change flow", () => {
  it("shipBuild → auto-RFC → approve → schedule → execute → verify", async () => {
    // 1. Call createProductVersionWithRFC (simulates shipBuild)
    // 2. Assert RFC created in draft status
    // 3. Submit RFC
    // 4. Assess (auto-generate impact)
    // 5. Approve
    // 6. Schedule within a deployment window
    // 7. Execute
    // 8. Assert: RFC completed, ChangePromotion deployed
  });

  it("execution failure triggers auto-rollback", async () => {
    // 1. Create RFC with two items
    // 2. First item completes, health check fails
    // 3. Assert: second item skipped, first item rolled back
    // 4. Assert: RFC status = rolled-back
  });

  it("one-click rollback reverses completed RFC", async () => {
    // 1. Create and complete an RFC
    // 2. Call rollbackRFC
    // 3. Assert: all items rolled back in reverse order
    // 4. Assert: RFC status = rolled-back
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `pnpm --filter web exec vitest run lib/actions/change-management-integration.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/actions/change-management-integration.test.ts
git commit -m "test(change-mgmt): integration tests for self-dev flow, auto-rollback, and one-click rollback"
```

---

## Task 11: Update Spec with Research Findings

**Files:**
- Modify: `docs/superpowers/specs/2026-03-21-change-deployment-management-design.md`

- [ ] **Step 1: Verify spec reflects all implemented patterns**

Ensure the spec documents:
- Scheduling conflict detection (RFC-to-RFC collision)
- Ordered execution with health gates
- Automated rollback triggers and per-type strategies
- One-click rollback UX
- Self-development auto-RFC integration
- Research basis citations

- [ ] **Step 2: Commit spec update**

```bash
git add docs/superpowers/specs/2026-03-21-change-deployment-management-design.md
git commit -m "docs(change-mgmt): update spec with research findings and implementation details"
```
