# EP-POL-001: Internal Policy Management — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build internal policy lifecycle management with employee acknowledgments, training tracking, and compliance engine integration — 5 new schema tables, policy CRUD with state machine, employee My Policies surface, compliance dashboard integration.

**Architecture:** Dedicated policy domain (`policy.ts`) with shared compliance helpers extracted from `compliance.ts`. Policies optionally link to Obligations from EP-GRC-001. Employee-facing surface uses existing `?view=` pattern in `/employee`. Policy management lives under the existing `/compliance` route with a new "Policies" tab.

**Tech Stack:** Next.js 14 (App Router, server components, server actions), Prisma (PostgreSQL), TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-03-17-internal-policy-management-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web/lib/actions/compliance-helpers.ts` | Shared helpers extracted from compliance.ts: auth guards, getSessionEmployeeId, logComplianceAction, ensureComplianceCalendarEvent |
| `apps/web/lib/policy-types.ts` | TypeScript types, validators, ID generators, lifecycle constants for policies |
| `apps/web/lib/policy-types.test.ts` | Type/validator/lifecycle tests |
| `apps/web/lib/actions/policy.ts` | All policy server actions: CRUD, lifecycle transitions, requirements, completions, acknowledgments, dashboard |
| `apps/web/lib/actions/policy.test.ts` | Server action tests |
| `apps/web/app/(shell)/compliance/policies/page.tsx` | Policy list page |
| `apps/web/app/(shell)/compliance/policies/[id]/page.tsx` | Policy detail + requirements + acknowledgments |
| `apps/web/components/compliance/CreatePolicyForm.tsx` | Policy create modal form |
| `apps/web/components/employee/MyPoliciesView.tsx` | Employee My Policies view (pending acks, training, history) |

### Modified Files

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add 5 new models + reverse relations on Obligation + EmployeeProfile |
| `apps/web/lib/actions/compliance.ts` | Replace private helpers with imports from compliance-helpers.ts |
| `apps/web/lib/compliance-types.ts` | Add policy entity types |
| `apps/web/components/compliance/ComplianceTabNav.tsx` | Add "Policies" tab |
| `apps/web/components/employee/EmployeeTabNav.tsx` | Add "My Policies" tab |
| `apps/web/app/(shell)/employee/page.tsx` | Add My Policies view |
| `apps/web/app/(shell)/compliance/page.tsx` | Add policy compliance metrics |
| `apps/web/app/(shell)/workspace/page.tsx` | Add policy count to compliance tile |

### Test Files

| File | Tests |
|------|-------|
| `apps/web/lib/policy-types.test.ts` | ID generators, validators, lifecycle transitions |
| `apps/web/lib/actions/policy.test.ts` | Auth, CRUD, lifecycle state machine, acknowledgment, completion |

---

## Task 1: Extract Shared Compliance Helpers

**Files:**
- Create: `apps/web/lib/actions/compliance-helpers.ts`
- Modify: `apps/web/lib/actions/compliance.ts`

- [ ] **Step 1: Create compliance-helpers.ts with extracted helpers**

```ts
// apps/web/lib/actions/compliance-helpers.ts
"use server";

import * as crypto from "crypto";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";

export type ComplianceActionResult = { ok: boolean; message: string; id?: string };

export async function requireViewCompliance() {
  const session = await auth();
  if (!session?.user || !can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "view_compliance")) {
    throw new Error("Unauthorized");
  }
  return session.user;
}

export async function requireManageCompliance() {
  const session = await auth();
  if (!session?.user || !can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "manage_compliance")) {
    throw new Error("Unauthorized");
  }
  return session.user;
}

export async function getSessionEmployeeId(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const profile = await prisma.employeeProfile.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  return profile?.id ?? null;
}

export async function logComplianceAction(
  entityType: string, entityId: string, action: string,
  performedByEmployeeId: string | null, agentId: string | null,
  details?: { field?: string; oldValue?: string; newValue?: string; notes?: string },
) {
  await prisma.complianceAuditLog.create({
    data: {
      entityType, entityId, action,
      performedByEmployeeId, agentId,
      field: details?.field ?? null,
      oldValue: details?.oldValue ?? null,
      newValue: details?.newValue ?? null,
      notes: details?.notes ?? null,
    },
  });
}

export async function ensureComplianceCalendarEvent(
  entityType: string, entityId: string, title: string,
  dueDate: Date, ownerEmployeeId: string, recurrence?: string,
) {
  const eventId = `CE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await prisma.calendarEvent.create({
    data: {
      eventId,
      title,
      startAt: dueDate,
      allDay: true,
      eventType: "deadline",
      category: "compliance",
      ownerEmployeeId,
      visibility: "team",
      recurrence: recurrence ?? null,
      complianceEntityType: entityType,
      complianceEntityId: entityId,
    },
  });
}
```

- [ ] **Step 2: Update compliance.ts to import from helpers**

Read `apps/web/lib/actions/compliance.ts`. Replace the private helper functions (lines ~18-79: `ComplianceActionResult` type, `requireViewCompliance`, `requireManageCompliance`, `getSessionEmployeeId`, `logComplianceAction`, `ensureComplianceCalendarEvent`) with imports:

```ts
import {
  type ComplianceActionResult,
  requireViewCompliance, requireManageCompliance,
  getSessionEmployeeId, logComplianceAction, ensureComplianceCalendarEvent,
} from "@/lib/actions/compliance-helpers";

export type { ComplianceActionResult } from "@/lib/actions/compliance-helpers";
```

Remove the private function declarations. Keep all the CRUD functions unchanged — they now call the imported helpers.

- [ ] **Step 3: Run existing compliance tests to verify refactor doesn't break anything**

Run: `cd apps/web && npx vitest run lib/actions/compliance.test.ts lib/compliance-types.test.ts`
Expected: All 76 tests pass (the test mocks `@/lib/auth` and `@/lib/permissions` directly, so the helper extraction is transparent).

Note: If tests fail because they mock the helpers at the old location, update the test mocks to also mock `@/lib/actions/compliance-helpers`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/actions/compliance-helpers.ts apps/web/lib/actions/compliance.ts
git commit -m "refactor: extract shared compliance helpers for policy reuse

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Schema Migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add 5 new policy models after the Compliance Engine section**

Add section header `// ─── Internal Policy Management ──────────────────────────────────────────` then all 5 models:

```prisma
model Policy {
  id                    String    @id @default(cuid())
  policyId              String    @unique
  title                 String
  description           String?
  category              String
  version               Int       @default(1)
  lifecycleStatus       String    @default("draft")
  ownerEmployeeId       String?
  approvedByEmployeeId  String?
  approvedAt            DateTime?
  publishedAt           DateTime?
  retiredAt             DateTime?
  effectiveDate         DateTime?
  reviewDate            DateTime?
  reviewFrequency       String?
  fileRef               String?
  obligationId          String?
  notes                 String?
  agentId               String?
  status                String    @default("active")
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  ownerEmployee    EmployeeProfile? @relation("PolicyOwner", fields: [ownerEmployeeId], references: [id], onDelete: SetNull)
  approvedBy       EmployeeProfile? @relation("PolicyApprover", fields: [approvedByEmployeeId], references: [id], onDelete: SetNull)
  obligation       Obligation?      @relation(fields: [obligationId], references: [id], onDelete: SetNull)
  requirements     PolicyRequirement[]
  acknowledgments  PolicyAcknowledgment[]

  @@index([ownerEmployeeId])
  @@index([approvedByEmployeeId])
  @@index([obligationId])
  @@index([lifecycleStatus])
  @@index([category])
  @@index([status])
}

model PolicyRequirement {
  id              String   @id @default(cuid())
  requirementId   String   @unique
  policyId        String
  title           String
  requirementType String
  description     String?
  frequency       String?
  applicability   String?
  dueDays         Int?
  agentId         String?
  status          String   @default("active")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  policy              Policy               @relation(fields: [policyId], references: [id], onDelete: Cascade)
  trainingRequirement TrainingRequirement?
  completions         RequirementCompletion[]

  @@index([policyId])
  @@index([requirementType])
  @@index([status])
}

model RequirementCompletion {
  id                String    @id @default(cuid())
  completionId      String    @unique
  requirementId     String
  employeeProfileId String
  completedAt       DateTime  @default(now())
  expiresAt         DateTime?
  method            String
  notes             String?
  agentId           String?
  status            String    @default("active")
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  requirement     PolicyRequirement @relation(fields: [requirementId], references: [id], onDelete: Cascade)
  employeeProfile EmployeeProfile   @relation("RequirementCompletions", fields: [employeeProfileId], references: [id], onDelete: Cascade)

  @@unique([requirementId, employeeProfileId, status])
  @@index([requirementId])
  @@index([employeeProfileId])
  @@index([status])
  @@index([expiresAt])
}

// TrainingRequirement inherits status from parent PolicyRequirement — no separate status field.
model TrainingRequirement {
  id                  String   @id @default(cuid())
  requirementId       String   @unique
  trainingTitle       String
  provider            String?
  deliveryMethod      String?
  durationMinutes     Int?
  externalUrl         String?
  passingScore        Float?
  certificateRequired Boolean  @default(false)
  agentId             String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  requirement PolicyRequirement @relation(fields: [requirementId], references: [id], onDelete: Cascade)

  @@index([requirementId])
}

// Intentionally omits status and updatedAt — acknowledgments are permanent records. Append-only.
model PolicyAcknowledgment {
  id                String   @id @default(cuid())
  policyId          String
  employeeProfileId String
  acknowledgedAt    DateTime @default(now())
  policyVersion     Int
  method            String   @default("digital-signature")
  agentId           String?
  createdAt         DateTime @default(now())

  policy          Policy          @relation(fields: [policyId], references: [id], onDelete: Cascade)
  employeeProfile EmployeeProfile @relation("PolicyAcknowledgments", fields: [employeeProfileId], references: [id], onDelete: Cascade)

  @@unique([policyId, employeeProfileId, policyVersion])
  @@index([policyId])
  @@index([employeeProfileId])
}
```

- [ ] **Step 2: Add reverse relation on Obligation model**

Find the Obligation model and add before the closing `}`:
```prisma
  policies Policy[]
```

- [ ] **Step 3: Add reverse relations on EmployeeProfile**

Find the EmployeeProfile model and add:
```prisma
  // ─── Policy Management relations ─────────────────────
  requirementCompletions RequirementCompletion[] @relation("RequirementCompletions")
  policyAcknowledgments  PolicyAcknowledgment[]  @relation("PolicyAcknowledgments")
  policiesOwned          Policy[]                @relation("PolicyOwner")
  policiesApproved       Policy[]                @relation("PolicyApprover")
```

- [ ] **Step 4: Run prisma validate + generate**

Run: `cd packages/db && npx prisma validate && npx prisma generate`

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add internal policy management schema — 5 new models

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Types and Validation (TDD)

**Files:**
- Create: `apps/web/lib/policy-types.ts`
- Create: `apps/web/lib/policy-types.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// apps/web/lib/policy-types.test.ts
import { describe, expect, it } from "vitest";
import {
  generatePolicyId, generateRequirementId, generateCompletionId,
  validatePolicyInput, validateRequirementInput,
  POLICY_CATEGORIES, POLICY_LIFECYCLE_STATUSES, REQUIREMENT_TYPES,
  REQUIREMENT_FREQUENCIES, COMPLETION_METHODS, TRAINING_DELIVERY_METHODS,
  isValidTransition,
} from "./policy-types";

describe("ID generators", () => {
  it("generates policy IDs with POL- prefix", () => {
    expect(generatePolicyId()).toMatch(/^POL-[A-Z0-9]{8}$/);
  });
  it("generates requirement IDs with PREQ- prefix", () => {
    expect(generateRequirementId()).toMatch(/^PREQ-[A-Z0-9]{8}$/);
  });
  it("generates completion IDs with COMP- prefix", () => {
    expect(generateCompletionId()).toMatch(/^COMP-[A-Z0-9]{8}$/);
  });
  it("generates unique IDs", () => {
    const ids = Array.from({ length: 20 }, () => generatePolicyId());
    expect(new Set(ids).size).toBe(20);
  });
});

describe("validatePolicyInput", () => {
  it("returns null for valid input", () => {
    expect(validatePolicyInput({ title: "Test Policy", category: "security" })).toBeNull();
  });
  it("rejects empty title", () => {
    expect(validatePolicyInput({ title: "", category: "security" })).toBe("Title is required.");
  });
  it("rejects invalid category", () => {
    expect(validatePolicyInput({ title: "Test", category: "bogus" })).toMatch(/Category must be one of/);
  });
});

describe("validateRequirementInput", () => {
  it("returns null for valid input", () => {
    expect(validateRequirementInput({ title: "Read policy", requirementType: "acknowledgment" })).toBeNull();
  });
  it("rejects empty title", () => {
    expect(validateRequirementInput({ title: "", requirementType: "training" })).toBe("Title is required.");
  });
  it("rejects invalid type", () => {
    expect(validateRequirementInput({ title: "Test", requirementType: "bogus" })).toMatch(/Requirement type must be one of/);
  });
});

describe("isValidTransition", () => {
  it("allows draft → in-review", () => {
    expect(isValidTransition("draft", "in-review")).toBe(true);
  });
  it("allows in-review → approved", () => {
    expect(isValidTransition("in-review", "approved")).toBe(true);
  });
  it("allows in-review → draft (sent back)", () => {
    expect(isValidTransition("in-review", "draft")).toBe(true);
  });
  it("allows approved → published", () => {
    expect(isValidTransition("approved", "published")).toBe(true);
  });
  it("allows published → retired", () => {
    expect(isValidTransition("published", "retired")).toBe(true);
  });
  it("allows retired → draft (re-activate)", () => {
    expect(isValidTransition("retired", "draft")).toBe(true);
  });
  it("rejects draft → published (skip)", () => {
    expect(isValidTransition("draft", "published")).toBe(false);
  });
  it("rejects published → approved (backwards)", () => {
    expect(isValidTransition("published", "approved")).toBe(false);
  });
  it("rejects retired → published (must go through draft)", () => {
    expect(isValidTransition("retired", "published")).toBe(false);
  });
});

describe("constants", () => {
  it("exports expected policy categories", () => {
    expect(POLICY_CATEGORIES).toContain("security");
    expect(POLICY_CATEGORIES).toContain("ethics");
    expect(POLICY_CATEGORIES).toContain("hr");
  });
  it("exports expected requirement types", () => {
    expect(REQUIREMENT_TYPES).toEqual(["acknowledgment", "training", "attestation", "action"]);
  });
  it("exports expected lifecycle statuses", () => {
    expect(POLICY_LIFECYCLE_STATUSES).toEqual(["draft", "in-review", "approved", "published", "retired"]);
  });
});
```

- [ ] **Step 2: Run tests — verify failure**

Run: `cd apps/web && npx vitest run lib/policy-types.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement policy-types.ts**

```ts
// apps/web/lib/policy-types.ts
import * as crypto from "crypto";

function genId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export const generatePolicyId = () => genId("POL");
export const generateRequirementId = () => genId("PREQ");
export const generateCompletionId = () => genId("COMP");

// ─── Constants ──────────────────────────────────────────────────────────────

export const POLICY_CATEGORIES = [
  "security", "hr", "safety", "ethics", "operations", "it", "privacy", "other",
] as const;

export const POLICY_LIFECYCLE_STATUSES = [
  "draft", "in-review", "approved", "published", "retired",
] as const;

export const REVIEW_FREQUENCIES = ["annual", "biennial", "quarterly"] as const;

export const REQUIREMENT_TYPES = [
  "acknowledgment", "training", "attestation", "action",
] as const;

export const REQUIREMENT_FREQUENCIES = [
  "once", "annual", "quarterly", "on-change",
] as const;

export const COMPLETION_METHODS = [
  "digital-signature", "checkbox", "training-completion", "manual-attestation",
] as const;

export const TRAINING_DELIVERY_METHODS = [
  "online", "in-person", "self-paced", "instructor-led",
] as const;

// Self-completable requirement types (employees can complete these themselves)
export const SELF_COMPLETABLE_TYPES = ["acknowledgment", "training"] as const;

// ─── Lifecycle State Machine ────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  "draft": ["in-review"],
  "in-review": ["approved", "draft"],
  "approved": ["published"],
  "published": ["retired"],
  "retired": ["draft"],
};

export function isValidTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── Input Types ────────────────────────────────────────────────────────────

export type PolicyInput = {
  title: string;
  category: string;
  description?: string | null;
  effectiveDate?: Date | null;
  reviewDate?: Date | null;
  reviewFrequency?: string | null;
  fileRef?: string | null;
  obligationId?: string | null;
  ownerEmployeeId?: string | null;
  notes?: string | null;
};

export type RequirementInput = {
  title: string;
  requirementType: string;
  description?: string | null;
  frequency?: string | null;
  applicability?: string | null;
  dueDays?: number | null;
  // Training-specific (only when requirementType === "training")
  trainingTitle?: string | null;
  provider?: string | null;
  deliveryMethod?: string | null;
  durationMinutes?: number | null;
  externalUrl?: string | null;
  passingScore?: number | null;
  certificateRequired?: boolean;
};

// ─── Validators ─────────────────────────────────────────────────────────────

export function validatePolicyInput(input: Pick<PolicyInput, "title" | "category">): string | null {
  if (!input.title.trim()) return "Title is required.";
  if (!(POLICY_CATEGORIES as readonly string[]).includes(input.category)) {
    return `Category must be one of: ${POLICY_CATEGORIES.join(", ")}.`;
  }
  return null;
}

export function validateRequirementInput(input: Pick<RequirementInput, "title" | "requirementType">): string | null {
  if (!input.title.trim()) return "Title is required.";
  if (!(REQUIREMENT_TYPES as readonly string[]).includes(input.requirementType)) {
    return `Requirement type must be one of: ${REQUIREMENT_TYPES.join(", ")}.`;
  }
  return null;
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `cd apps/web && npx vitest run lib/policy-types.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/policy-types.ts apps/web/lib/policy-types.test.ts
git commit -m "feat: add policy types, validators, lifecycle state machine

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Server Actions — Policy CRUD + Lifecycle

**Files:**
- Create: `apps/web/lib/actions/policy.ts`

- [ ] **Step 1: Create policy.ts with Policy CRUD + lifecycle transitions**

```ts
"use server";

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import {
  type ComplianceActionResult,
  requireViewCompliance, requireManageCompliance,
  getSessionEmployeeId, logComplianceAction, ensureComplianceCalendarEvent,
} from "@/lib/actions/compliance-helpers";
import {
  generatePolicyId,
  validatePolicyInput, isValidTransition,
  type PolicyInput, SELF_COMPLETABLE_TYPES,
} from "@/lib/policy-types";

// ─── Policy CRUD ────────────────────────────────────────────────────────────

export async function listPolicies(filters?: { category?: string; lifecycleStatus?: string; ownerEmployeeId?: string }) {
  await requireViewCompliance();
  return prisma.policy.findMany({
    where: {
      status: "active",
      ...(filters?.category && { category: filters.category }),
      ...(filters?.lifecycleStatus && { lifecycleStatus: filters.lifecycleStatus }),
      ...(filters?.ownerEmployeeId && { ownerEmployeeId: filters.ownerEmployeeId }),
    },
    include: {
      ownerEmployee: { select: { id: true, displayName: true } },
      obligation: { select: { id: true, title: true, obligationId: true } },
      _count: { select: { acknowledgments: true, requirements: true } },
    },
    orderBy: { title: "asc" },
  });
}

export async function getPolicy(id: string) {
  await requireViewCompliance();
  return prisma.policy.findUniqueOrThrow({
    where: { id },
    include: {
      ownerEmployee: { select: { id: true, displayName: true } },
      approvedBy: { select: { id: true, displayName: true } },
      obligation: { select: { id: true, title: true, obligationId: true } },
      requirements: {
        where: { status: "active" },
        include: {
          trainingRequirement: true,
          _count: { select: { completions: { where: { status: "active" } } } },
        },
        orderBy: { createdAt: "asc" },
      },
      acknowledgments: {
        include: { employeeProfile: { select: { id: true, displayName: true } } },
        orderBy: { acknowledgedAt: "desc" },
      },
    },
  });
}

export async function createPolicy(input: PolicyInput): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const error = validatePolicyInput(input);
  if (error) return { ok: false, message: error };

  const employeeId = await getSessionEmployeeId();
  const record = await prisma.policy.create({
    data: {
      policyId: generatePolicyId(),
      title: input.title.trim(),
      category: input.category,
      description: input.description ?? null,
      effectiveDate: input.effectiveDate ?? null,
      reviewDate: input.reviewDate ?? null,
      reviewFrequency: input.reviewFrequency ?? null,
      fileRef: input.fileRef ?? null,
      obligationId: input.obligationId ?? null,
      ownerEmployeeId: input.ownerEmployeeId ?? employeeId,
      notes: input.notes ?? null,
    },
  });

  await logComplianceAction("policy", record.id, "created", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Policy created.", id: record.id };
}

export async function updatePolicy(id: string, input: Partial<PolicyInput>): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.policy.update({ where: { id }, data: {
    ...(input.title !== undefined && { title: input.title.trim() }),
    ...(input.category !== undefined && { category: input.category }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.effectiveDate !== undefined && { effectiveDate: input.effectiveDate }),
    ...(input.reviewDate !== undefined && { reviewDate: input.reviewDate }),
    ...(input.reviewFrequency !== undefined && { reviewFrequency: input.reviewFrequency }),
    ...(input.fileRef !== undefined && { fileRef: input.fileRef }),
    ...(input.obligationId !== undefined && { obligationId: input.obligationId }),
    ...(input.ownerEmployeeId !== undefined && { ownerEmployeeId: input.ownerEmployeeId }),
    ...(input.notes !== undefined && { notes: input.notes }),
  }});

  await logComplianceAction("policy", id, "updated", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Policy updated." };
}

// ─── Policy Lifecycle ───────────────────────────────────────────────────────

export async function transitionPolicyStatus(id: string, newStatus: string): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  const policy = await prisma.policy.findUniqueOrThrow({ where: { id }, select: { lifecycleStatus: true, version: true } });

  if (!isValidTransition(policy.lifecycleStatus, newStatus)) {
    return { ok: false, message: `Cannot transition from ${policy.lifecycleStatus} to ${newStatus}.` };
  }

  const data: Record<string, unknown> = { lifecycleStatus: newStatus };

  if (newStatus === "approved") {
    data.approvedByEmployeeId = employeeId;
    data.approvedAt = new Date();
  } else if (newStatus === "published") {
    data.publishedAt = new Date();
  } else if (newStatus === "retired") {
    data.retiredAt = new Date();
  } else if (newStatus === "draft" && policy.lifecycleStatus === "retired") {
    // Re-activate: increment version, clear lifecycle dates
    data.version = policy.version + 1;
    data.approvedByEmployeeId = null;
    data.approvedAt = null;
    data.publishedAt = null;
    data.retiredAt = null;
  }

  await prisma.policy.update({ where: { id }, data });

  await logComplianceAction("policy", id, "status-changed", employeeId, null, {
    field: "lifecycleStatus", oldValue: policy.lifecycleStatus, newValue: newStatus,
  });
  revalidatePath("/compliance");
  return { ok: true, message: `Policy ${newStatus}.` };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/actions/policy.ts
git commit -m "feat: add policy server actions — CRUD and lifecycle transitions

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Server Actions — Requirements, Completions, Acknowledgments

**Files:**
- Modify: `apps/web/lib/actions/policy.ts`

- [ ] **Step 1: Append requirement CRUD + training requirement**

Add imports for `generateRequirementId`, `generateCompletionId`, `validateRequirementInput`, `RequirementInput` to the existing import. Then append:

```ts
// ─── Policy Requirement ─────────────────────────────────────────────────────

export async function createRequirement(policyId: string, input: RequirementInput): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const error = validateRequirementInput(input);
  if (error) return { ok: false, message: error };

  const employeeId = await getSessionEmployeeId();
  const record = await prisma.policyRequirement.create({
    data: {
      requirementId: generateRequirementId(),
      policyId,
      title: input.title.trim(),
      requirementType: input.requirementType,
      description: input.description ?? null,
      frequency: input.frequency ?? null,
      applicability: input.applicability ?? null,
      dueDays: input.dueDays ?? null,
    },
  });

  // Create TrainingRequirement if type is training
  if (input.requirementType === "training" && input.trainingTitle) {
    await prisma.trainingRequirement.create({
      data: {
        requirementId: record.id,
        trainingTitle: input.trainingTitle.trim(),
        provider: input.provider ?? null,
        deliveryMethod: input.deliveryMethod ?? null,
        durationMinutes: input.durationMinutes ?? null,
        externalUrl: input.externalUrl ?? null,
        passingScore: input.passingScore ?? null,
        certificateRequired: input.certificateRequired ?? false,
      },
    });
  }

  await logComplianceAction("requirement", record.id, "created", employeeId, null, { notes: `For policy ${policyId}` });
  revalidatePath("/compliance");
  return { ok: true, message: "Requirement created.", id: record.id };
}

export async function deleteRequirement(id: string): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();
  await prisma.policyRequirement.delete({ where: { id } });
  await logComplianceAction("requirement", id, "deleted", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Requirement deleted." };
}
```

- [ ] **Step 2: Append completion + acknowledgment actions**

```ts
// ─── Requirement Completion ─────────────────────────────────────────────────

export async function completeRequirement(requirementId: string, method: string, notes?: string): Promise<ComplianceActionResult> {
  const employeeId = await getSessionEmployeeId();
  if (!employeeId) return { ok: false, message: "Employee profile required." };

  // Check requirement exists and policy is published
  const req = await prisma.policyRequirement.findUniqueOrThrow({
    where: { id: requirementId },
    include: { policy: { select: { lifecycleStatus: true } } },
  });

  if (req.policy.lifecycleStatus !== "published") {
    return { ok: false, message: "Policy is not published." };
  }

  // Check if self-completable
  if (!(SELF_COMPLETABLE_TYPES as readonly string[]).includes(req.requirementType)) {
    await requireManageCompliance(); // attestation/action require admin
  }

  // Calculate expiry for recurring requirements
  let expiresAt: Date | null = null;
  if (req.frequency === "annual") {
    expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  } else if (req.frequency === "quarterly") {
    expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 3);
  }

  const record = await prisma.requirementCompletion.create({
    data: {
      completionId: generateCompletionId(),
      requirementId,
      employeeProfileId: employeeId,
      method,
      notes: notes ?? null,
      expiresAt,
    },
  });

  await logComplianceAction("completion", record.id, "created", employeeId, null, { notes: `Requirement ${requirementId}` });
  revalidatePath("/employee");
  revalidatePath("/compliance");
  return { ok: true, message: "Requirement completed.", id: record.id };
}

// ─── Policy Acknowledgment ──────────────────────────────────────────────────

export async function acknowledgePolicy(policyId: string): Promise<ComplianceActionResult> {
  const employeeId = await getSessionEmployeeId();
  if (!employeeId) return { ok: false, message: "Employee profile required." };

  const policy = await prisma.policy.findUniqueOrThrow({
    where: { id: policyId },
    select: { lifecycleStatus: true, version: true },
  });

  if (policy.lifecycleStatus !== "published") {
    return { ok: false, message: "Policy is not published." };
  }

  await prisma.policyAcknowledgment.create({
    data: {
      policyId,
      employeeProfileId: employeeId,
      policyVersion: policy.version,
      method: "digital-signature",
    },
  });

  await logComplianceAction("acknowledgment", policyId, "created", employeeId, null, { notes: `Version ${policy.version}` });
  revalidatePath("/employee");
  revalidatePath("/compliance");
  return { ok: true, message: "Policy acknowledged." };
}

// ─── Employee-Facing Queries ────────────────────────────────────────────────

export async function getMyPendingRequirements() {
  const employeeId = await getSessionEmployeeId();
  if (!employeeId) return { pendingAcknowledgments: [], pendingTraining: [], completedHistory: [] };

  // Published policies not yet acknowledged at current version
  const allPublished = await prisma.policy.findMany({
    where: { lifecycleStatus: "published", status: "active" },
    select: { id: true, title: true, version: true, category: true },
  });

  const myAcks = await prisma.policyAcknowledgment.findMany({
    where: { employeeProfileId: employeeId },
    select: { policyId: true, policyVersion: true },
  });
  const ackedSet = new Set(myAcks.map((a) => `${a.policyId}:${a.policyVersion}`));

  const pendingAcknowledgments = allPublished.filter(
    (p) => !ackedSet.has(`${p.id}:${p.version}`),
  );

  // Requirements without active completion
  const pendingReqs = await prisma.policyRequirement.findMany({
    where: {
      status: "active",
      policy: { lifecycleStatus: "published", status: "active" },
      completions: { none: { employeeProfileId: employeeId, status: "active" } },
    },
    include: {
      policy: { select: { title: true } },
      trainingRequirement: { select: { trainingTitle: true, externalUrl: true } },
    },
  });

  const pendingTraining = pendingReqs.filter((r) => r.requirementType === "training");

  // Recent completions
  const completedHistory = await prisma.requirementCompletion.findMany({
    where: { employeeProfileId: employeeId },
    include: {
      requirement: { select: { title: true, requirementType: true, policy: { select: { title: true } } } },
    },
    orderBy: { completedAt: "desc" },
    take: 20,
  });

  return { pendingAcknowledgments, pendingTraining, completedHistory };
}

export async function getMyPolicySummary() {
  const employeeId = await getSessionEmployeeId();
  if (!employeeId) return { pendingAckCount: 0, pendingTrainingCount: 0 };

  const data = await getMyPendingRequirements();
  return {
    pendingAckCount: data.pendingAcknowledgments.length,
    pendingTrainingCount: data.pendingTraining.length,
  };
}

// ─── Dashboard Metrics ──────────────────────────────────────────────────────

export async function getPolicyDashboardMetrics() {
  await requireViewCompliance();

  const [publishedCount, totalEmployees, totalAcks, overdueTraining] = await Promise.all([
    prisma.policy.count({ where: { lifecycleStatus: "published", status: "active" } }),
    prisma.employeeProfile.count({ where: { status: "active" } }),
    prisma.policyAcknowledgment.count(),
    prisma.requirementCompletion.count({ where: { status: "expired" } }),
  ]);

  const expectedAcks = publishedCount * totalEmployees;
  const ackRate = expectedAcks > 0 ? Math.round((totalAcks / expectedAcks) * 100) : 0;

  return { publishedCount, ackRate, overdueTraining };
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/actions/policy.ts
git commit -m "feat: add policy actions — requirements, completions, acknowledgments, dashboard

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Policy List + Detail Pages + Create Form

**Files:**
- Modify: `apps/web/components/compliance/ComplianceTabNav.tsx`
- Create: `apps/web/app/(shell)/compliance/policies/page.tsx`
- Create: `apps/web/app/(shell)/compliance/policies/[id]/page.tsx`
- Create: `apps/web/components/compliance/CreatePolicyForm.tsx`

- [ ] **Step 1: Add Policies tab to ComplianceTabNav**

Read `apps/web/components/compliance/ComplianceTabNav.tsx`. Insert `{ label: "Policies", href: "/compliance/policies" }` as the second entry in the TABS array (after Dashboard, before Regulations).

- [ ] **Step 2: Create policy list page**

```tsx
// apps/web/app/(shell)/compliance/policies/page.tsx
import { prisma } from "@dpf/db";
import { CreatePolicyForm } from "@/components/compliance/CreatePolicyForm";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-900/30 text-gray-400",
  "in-review": "bg-yellow-900/30 text-yellow-400",
  approved: "bg-blue-900/30 text-blue-400",
  published: "bg-green-900/30 text-green-400",
  retired: "bg-gray-900/30 text-gray-400",
};

export default async function PoliciesPage() {
  const policies = await prisma.policy.findMany({
    where: { status: "active" },
    include: {
      ownerEmployee: { select: { displayName: true } },
      obligation: { select: { title: true } },
      _count: { select: { acknowledgments: true, requirements: true } },
    },
    orderBy: { title: "asc" },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Policies</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">{policies.length} total</p>
        </div>
        <CreatePolicyForm />
      </div>
      {policies.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No policies yet. Create your first policy to get started.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {policies.map((p) => (
            <a key={p.id} href={`/compliance/policies/${p.id}`}
              className="block p-4 rounded-lg border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] transition-colors">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-white">{p.title}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[p.lifecycleStatus] ?? "bg-gray-900/30 text-gray-400"}`}>
                  {p.lifecycleStatus}
                </span>
              </div>
              <div className="flex gap-2 mt-1">
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#333] text-[var(--dpf-muted)]">{p.category}</span>
                <span className="text-[9px] text-[var(--dpf-muted)]">v{p.version}</span>
              </div>
              <div className="flex gap-3 mt-2 text-xs text-[var(--dpf-muted)]">
                {p.ownerEmployee && <span>{p.ownerEmployee.displayName}</span>}
                <span>{p._count.requirements} requirement{p._count.requirements !== 1 ? "s" : ""}</span>
                <span>{p._count.acknowledgments} ack{p._count.acknowledgments !== 1 ? "s" : ""}</span>
              </div>
              {p.obligation && (
                <p className="text-[9px] text-blue-400 mt-1">Linked: {p.obligation.title}</p>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create policy detail page**

Server component at `apps/web/app/(shell)/compliance/policies/[id]/page.tsx`. Shows policy metadata, requirements with completion rates, and acknowledgment status (acknowledged vs pending employees). Uses `prisma.policy.findUnique` with full includes. Follow the regulation detail page pattern from `compliance/regulations/[id]/page.tsx`.

- [ ] **Step 4: Create CreatePolicyForm component**

Follow `CreateRegulationForm.tsx` pattern exactly. Fields: title, category (dropdown from POLICY_CATEGORIES), description (textarea), obligationId (optional — leave as text input for now), notes. Calls `createPolicy` server action.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/compliance/ComplianceTabNav.tsx apps/web/app/(shell)/compliance/policies/ apps/web/components/compliance/CreatePolicyForm.tsx
git commit -m "feat: add policy list, detail pages, and create form

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Employee My Policies Integration

**Files:**
- Modify: `apps/web/components/employee/EmployeeTabNav.tsx`
- Create: `apps/web/components/employee/MyPoliciesView.tsx`
- Modify: `apps/web/app/(shell)/employee/page.tsx`

- [ ] **Step 1: Add My Policies tab to EmployeeTabNav**

Read `apps/web/components/employee/EmployeeTabNav.tsx`. Add to the TABS array:
```ts
{ label: "My Policies", value: "mypolicies" },
```

- [ ] **Step 2: Create MyPoliciesView component**

```tsx
// apps/web/components/employee/MyPoliciesView.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getMyPendingRequirements, acknowledgePolicy, completeRequirement } from "@/lib/actions/policy";

type PendingData = Awaited<ReturnType<typeof getMyPendingRequirements>>;

export function MyPoliciesView() {
  const [data, setData] = useState<PendingData | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    getMyPendingRequirements().then((d) => { setData(d); setLoading(false); });
  }, []);

  async function handleAcknowledge(policyId: string) {
    await acknowledgePolicy(policyId);
    router.refresh();
    const fresh = await getMyPendingRequirements();
    setData(fresh);
  }

  async function handleComplete(requirementId: string) {
    await completeRequirement(requirementId, "digital-signature");
    router.refresh();
    const fresh = await getMyPendingRequirements();
    setData(fresh);
  }

  if (loading) return <p className="text-sm text-[var(--dpf-muted)]">Loading...</p>;
  if (!data) return <p className="text-sm text-[var(--dpf-muted)]">Unable to load policy data.</p>;

  return (
    <div className="space-y-8">
      {/* Pending Acknowledgments */}
      <section>
        <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">
          Pending Acknowledgments ({data.pendingAcknowledgments.length})
        </h2>
        {data.pendingAcknowledgments.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)]">All policies acknowledged.</p>
        ) : (
          <div className="space-y-2">
            {data.pendingAcknowledgments.map((p) => (
              <div key={p.id} className="p-3 rounded-lg border border-[var(--dpf-border)] flex items-center justify-between">
                <div>
                  <span className="text-sm text-white">{p.title}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#333] text-[var(--dpf-muted)] ml-2">{p.category}</span>
                </div>
                <button onClick={() => handleAcknowledge(p.id)}
                  className="px-3 py-1 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90">
                  Acknowledge
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Pending Training */}
      <section>
        <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">
          Pending Training ({data.pendingTraining.length})
        </h2>
        {data.pendingTraining.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)]">All training complete.</p>
        ) : (
          <div className="space-y-2">
            {data.pendingTraining.map((r) => (
              <div key={r.id} className="p-3 rounded-lg border border-[var(--dpf-border)] flex items-center justify-between">
                <div>
                  <span className="text-sm text-white">{r.trainingRequirement?.trainingTitle ?? r.title}</span>
                  <span className="text-[9px] text-[var(--dpf-muted)] ml-2">({r.policy.title})</span>
                  {r.trainingRequirement?.externalUrl && (
                    <a href={r.trainingRequirement.externalUrl} target="_blank" rel="noopener noreferrer"
                      className="text-[9px] text-blue-400 hover:underline ml-2">
                      Open training
                    </a>
                  )}
                </div>
                <button onClick={() => handleComplete(r.id)}
                  className="px-3 py-1 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90">
                  Mark Complete
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Completed History */}
      <section>
        <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">
          Completed ({data.completedHistory.length})
        </h2>
        {data.completedHistory.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)]">No completions yet.</p>
        ) : (
          <div className="space-y-2">
            {data.completedHistory.map((c) => (
              <div key={c.id} className="p-3 rounded-lg border border-[var(--dpf-border)] flex items-start justify-between">
                <div>
                  <span className="text-sm text-white">{c.requirement.title}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#333] text-[var(--dpf-muted)] ml-2">{c.requirement.requirementType}</span>
                  <p className="text-[9px] text-[var(--dpf-muted)] mt-1">{c.requirement.policy.title}</p>
                </div>
                <span className="text-xs text-[var(--dpf-muted)]">{new Date(c.completedAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Wire MyPoliciesView into employee/page.tsx**

Read `apps/web/app/(shell)/employee/page.tsx`. Find where `view` is used to switch between Directory/Org Chart/Timesheets. Add a case for `mypolicies`:

Import:
```tsx
import { MyPoliciesView } from "@/components/employee/MyPoliciesView";
```

In the view switching logic, add:
```tsx
{view === "mypolicies" && <MyPoliciesView />}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/employee/EmployeeTabNav.tsx apps/web/components/employee/MyPoliciesView.tsx apps/web/app/(shell)/employee/page.tsx
git commit -m "feat: add employee My Policies tab with acknowledgments and training

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Dashboard + Workspace Tile Updates

**Files:**
- Modify: `apps/web/app/(shell)/compliance/page.tsx`
- Modify: `apps/web/app/(shell)/workspace/page.tsx`

- [ ] **Step 1: Add policy metrics to compliance dashboard**

Read `apps/web/app/(shell)/compliance/page.tsx`. Add policy queries to the existing `Promise.all`:

```ts
prisma.policy.count({ where: { lifecycleStatus: "published", status: "active" } }),
prisma.policyAcknowledgment.count(),
```

Add a "Policy Compliance" section below the "By Regulation" section:

```tsx
<section className="mt-8">
  <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">Policy Compliance</h2>
  <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
    <MetricCard label="Published Policies" value={publishedPolicyCount} color="#a78bfa" />
    <MetricCard label="Total Acknowledgments" value={totalAcks} color="#4ade80" />
  </div>
</section>
```

- [ ] **Step 2: Add policy count to workspace tile**

Read `apps/web/app/(shell)/workspace/page.tsx`. Add to the compliance tile metrics:

```ts
prisma.policy.count({ where: { lifecycleStatus: "published", status: "active" } }),
```

Add to the compliance tileStatus metrics array:
```ts
{ label: "Policies", value: publishedPolicyCount, color: "#a78bfa" },
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(shell)/compliance/page.tsx apps/web/app/(shell)/workspace/page.tsx
git commit -m "feat: add policy metrics to compliance dashboard and workspace tile

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Server Action Tests

**Files:**
- Create: `apps/web/lib/actions/policy.test.ts`

- [ ] **Step 1: Create test file with mock setup and core tests**

Follow the mock pattern from `apps/web/lib/actions/compliance.test.ts`. Test:

1. **Auth:** `createPolicy` rejects unauthorized users
2. **Validation:** `createPolicy` rejects empty title, invalid category
3. **CRUD:** `createPolicy` creates record + audit log
4. **Lifecycle:** `transitionPolicyStatus` allows valid transitions, rejects invalid ones
5. **Acknowledgment:** `acknowledgePolicy` creates record for published policy, rejects non-published
6. **Completion:** `completeRequirement` checks policy is published, enforces self-completable types
7. **No updateEvidence equivalent:** Verify there is no way to modify a PolicyAcknowledgment (append-only)

- [ ] **Step 2: Run tests**

Run: `cd apps/web && npx vitest run lib/actions/policy.test.ts`
Expected: All tests PASS.

- [ ] **Step 3: Run full compliance + policy test suite**

Run: `cd apps/web && npx vitest run lib/actions/compliance.test.ts lib/actions/policy.test.ts lib/compliance-types.test.ts lib/policy-types.test.ts`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/actions/policy.test.ts
git commit -m "test: add policy server action tests — auth, lifecycle, acknowledgment, completion

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Final Verification

- [ ] **Step 1: Run all compliance + policy tests**

Run: `cd apps/web && npx vitest run lib/compliance-types.test.ts lib/actions/compliance.test.ts lib/policy-types.test.ts lib/actions/policy.test.ts`
Expected: All tests pass.

- [ ] **Step 2: Run type check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Verify all files present**

```bash
find apps/web/app/\(shell\)/compliance/policies -name "*.tsx" | sort
find apps/web/components/employee/MyPoliciesView.tsx
find apps/web/lib/actions/compliance-helpers.ts
find apps/web/lib/actions/policy.ts
find apps/web/lib/policy-types.ts
```

- [ ] **Step 4: Final commit if needed**

```bash
git status
# Only commit compliance/policy-related files
git add apps/web/lib/ apps/web/app/(shell)/compliance/ apps/web/components/ packages/db/prisma/
git commit -m "feat: EP-POL-001 internal policy management — complete implementation

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```
