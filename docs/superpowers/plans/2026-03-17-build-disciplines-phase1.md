# Build Disciplines Phase 1: Schema, Types, Phase Gates & Ownership

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add evidence fields, ownership fields, and hard-gate phase transition enforcement to the Build Studio — the data foundation that reviewer agents and UI will build on.

**Architecture:** Extend `FeatureBuild` schema with 7 JSON evidence fields + ownership/claim fields. Extend `Epic` and `BacklogItem` with accountability + claim fields. Add backward phase transition (review→build). Enforce hard gates in `advanceBuildPhase` — each transition checks that required evidence exists before allowing the phase change.

**Tech Stack:** Prisma ORM, PostgreSQL, TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-03-17-build-disciplines-design.md`

**Scope:** This is Phase 1 of 3. Phase 2 (reviewer agent system) and Phase 3 (Build Studio UX) are separate plans.

---

## Chunk 1: Schema & Types

### Task 1: Add Evidence and Ownership Fields to FeatureBuild

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260317100000_add_build_disciplines_fields/migration.sql`

- [ ] **Step 1: Add fields to FeatureBuild model**

In `packages/db/prisma/schema.prisma`, find the `FeatureBuild` model (around line 1194). Add after `productVersions  ProductVersion[]` and before the `@@index` lines:

```prisma
  // Build Disciplines — evidence
  designDoc       Json?     // BuildDesignDoc structure
  designReview    Json?     // ReviewResult from spec reviewer
  buildPlan       Json?     // BuildPlanDoc structure (renamed from plan collision — see note)
  planReview      Json?     // ReviewResult from plan reviewer
  taskResults     Json?     // TaskResult[] array
  verificationOut Json?     // VerificationOutput structure
  acceptanceMet   Json?     // AcceptanceCriteria array

  // Build Disciplines — ownership
  accountableEmployeeId  String?
  claimedByAgentId       String?
  claimedAt              DateTime?
  claimStatus            String?   // "active" | "paused" | "released"
```

Note: `FeatureBuild` already has a `plan Json?` field (line 1201) used for the internal implementation plan. The new `buildPlan` field stores the Build Disciplines structured plan (with task breakdown). These are different — `plan` is the legacy unstructured plan, `buildPlan` is the new disciplined plan with TypeScript schema.

- [ ] **Step 2: Add accountability + claim fields to Epic**

In the `Epic` model, add after `completedAt`:
```prisma
  accountableEmployeeId  String?
  claimedById            String?
  claimedByAgentId       String?
  claimedAt              DateTime?
  claimStatus            String?
```

- [ ] **Step 3: Add accountability + claim fields to BacklogItem**

In the `BacklogItem` model, add after `completedAt`:
```prisma
  accountableEmployeeId  String?
  claimedById            String?
  claimedByAgentId       String?
  claimedAt              DateTime?
  claimStatus            String?
```

- [ ] **Step 4: Add reverse relations to EmployeeProfile**

Find the `EmployeeProfile` model. Add at the end (before the closing `}`):
```prisma
  accountableBuilds      FeatureBuild[] @relation("BuildAccountable")
  accountableEpics       Epic[]         @relation("EpicAccountable")
  accountableItems       BacklogItem[]  @relation("ItemAccountable")
```

Also add the `@relation` directives on the FK fields:
- In `FeatureBuild`: `accountableEmployee EmployeeProfile? @relation("BuildAccountable", fields: [accountableEmployeeId], references: [id])`
- In `Epic`: `accountableEmployee EmployeeProfile? @relation("EpicAccountable", fields: [accountableEmployeeId], references: [id])`
- In `BacklogItem`: `accountableEmployee EmployeeProfile? @relation("ItemAccountable", fields: [accountableEmployeeId], references: [id])`

- [ ] **Step 5: Create migration SQL**

Create `packages/db/prisma/migrations/20260317100000_add_build_disciplines_fields/migration.sql`:

```sql
-- Build Disciplines evidence fields on FeatureBuild
ALTER TABLE "FeatureBuild" ADD COLUMN "designDoc" JSONB;
ALTER TABLE "FeatureBuild" ADD COLUMN "designReview" JSONB;
ALTER TABLE "FeatureBuild" ADD COLUMN "buildPlan" JSONB;
ALTER TABLE "FeatureBuild" ADD COLUMN "planReview" JSONB;
ALTER TABLE "FeatureBuild" ADD COLUMN "taskResults" JSONB;
ALTER TABLE "FeatureBuild" ADD COLUMN "verificationOut" JSONB;
ALTER TABLE "FeatureBuild" ADD COLUMN "acceptanceMet" JSONB;

-- Ownership fields on FeatureBuild
ALTER TABLE "FeatureBuild" ADD COLUMN "accountableEmployeeId" TEXT;
ALTER TABLE "FeatureBuild" ADD COLUMN "claimedByAgentId" TEXT;
ALTER TABLE "FeatureBuild" ADD COLUMN "claimedAt" TIMESTAMP(3);
ALTER TABLE "FeatureBuild" ADD COLUMN "claimStatus" TEXT;
ALTER TABLE "FeatureBuild" ADD CONSTRAINT "FeatureBuild_accountableEmployeeId_fkey" FOREIGN KEY ("accountableEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Accountability + claim fields on Epic
ALTER TABLE "Epic" ADD COLUMN "accountableEmployeeId" TEXT;
ALTER TABLE "Epic" ADD COLUMN "claimedById" TEXT;
ALTER TABLE "Epic" ADD COLUMN "claimedByAgentId" TEXT;
ALTER TABLE "Epic" ADD COLUMN "claimedAt" TIMESTAMP(3);
ALTER TABLE "Epic" ADD COLUMN "claimStatus" TEXT;
ALTER TABLE "Epic" ADD CONSTRAINT "Epic_accountableEmployeeId_fkey" FOREIGN KEY ("accountableEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Accountability + claim fields on BacklogItem
ALTER TABLE "BacklogItem" ADD COLUMN "accountableEmployeeId" TEXT;
ALTER TABLE "BacklogItem" ADD COLUMN "claimedById" TEXT;
ALTER TABLE "BacklogItem" ADD COLUMN "claimedByAgentId" TEXT;
ALTER TABLE "BacklogItem" ADD COLUMN "claimedAt" TIMESTAMP(3);
ALTER TABLE "BacklogItem" ADD COLUMN "claimStatus" TEXT;
ALTER TABLE "BacklogItem" ADD CONSTRAINT "BacklogItem_accountableEmployeeId_fkey" FOREIGN KEY ("accountableEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 6: Apply migration and regenerate**

```bash
cd packages/db && DATABASE_URL="postgresql://dpf:dpf_dev@localhost:5432/dpf" npx prisma migrate deploy
cd packages/db && DATABASE_URL="postgresql://dpf:dpf_dev@localhost:5432/dpf" npx prisma generate
```

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/
git commit -m "schema: add Build Disciplines evidence and ownership fields"
```

---

### Task 2: Add Evidence TypeScript Types

**Files:**
- Modify: `apps/web/lib/feature-build-types.ts`

- [ ] **Step 1: Add evidence type definitions**

Add after the `FeatureBrief` type (around line 16):

```ts
// ─── Build Disciplines Evidence Types ────────────────────────────────────────

export type ReviewResult = {
  decision: "pass" | "fail";
  issues: Array<{
    severity: "critical" | "important" | "minor";
    description: string;
    location?: string;
    suggestion?: string;
  }>;
  summary: string;
};

export type BuildDesignDoc = {
  problemStatement: string;
  existingFunctionalityAudit: string;
  alternativesConsidered: string;
  reusePlan: string;
  newCodeJustification: string;
  proposedApproach: string;
  acceptanceCriteria: string[];
};

export type BuildPlanDoc = {
  fileStructure: Array<{ path: string; action: "create" | "modify"; purpose: string }>;
  tasks: Array<{
    title: string;
    testFirst: string;
    implement: string;
    verify: string;
  }>;
};

export type TaskResult = {
  taskIndex: number;
  title: string;
  testResult: { passed: boolean; output: string };
  codeReview: ReviewResult;
  commitSha?: string;
};

export type VerificationOutput = {
  testsPassed: number;
  testsFailed: number;
  typecheckPassed: boolean;
  fullOutput: string;
  timestamp: string;
};

export type AcceptanceCriterion = {
  criterion: string;
  met: boolean;
  evidence: string;
};
```

- [ ] **Step 2: Extend FeatureBuildRow with new fields**

Add to `FeatureBuildRow` type (after `updatedAt: Date;`):

```ts
  // Build Disciplines evidence
  designDoc: BuildDesignDoc | null;
  designReview: ReviewResult | null;
  buildPlan: BuildPlanDoc | null;
  planReview: ReviewResult | null;
  taskResults: TaskResult[] | null;
  verificationOut: VerificationOutput | null;
  acceptanceMet: AcceptanceCriterion[] | null;
  // Ownership
  accountableEmployeeId: string | null;
  claimedByAgentId: string | null;
  claimedAt: Date | null;
  claimStatus: string | null;
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/feature-build-types.ts
git commit -m "feat: add Build Disciplines evidence and ownership types"
```

---

### Task 3: Update Data Queries for New Fields

**Files:**
- Modify: `apps/web/lib/feature-build-data.ts`

- [ ] **Step 1: Add new fields to getFeatureBuilds select**

Read the file. Find `getFeatureBuilds` and add to its Prisma select:

```ts
      designDoc: true,
      designReview: true,
      buildPlan: true,
      planReview: true,
      taskResults: true,
      verificationOut: true,
      acceptanceMet: true,
      accountableEmployeeId: true,
      claimedByAgentId: true,
      claimedAt: true,
      claimStatus: true,
```

- [ ] **Step 2: Add same fields to getFeatureBuildById select**

Same fields in `getFeatureBuildById`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/feature-build-data.ts
git commit -m "feat: select Build Disciplines fields in feature build queries"
```

---

## Chunk 2: Phase Gate Enforcement

### Task 4: Add Backward Phase Transition and Evidence Gate Tests

**Files:**
- Modify: `apps/web/lib/feature-build-types.ts`
- Create: `apps/web/lib/feature-build-types.test.ts` (if doesn't exist, or extend existing)

- [ ] **Step 1: Write failing tests for phase transitions and evidence gates**

```ts
// apps/web/lib/feature-build-types.test.ts
import { describe, it, expect } from "vitest";
import { canTransitionPhase, checkPhaseGate } from "./feature-build-types";

describe("canTransitionPhase", () => {
  it("allows review to build (backward transition for changes)", () => {
    expect(canTransitionPhase("review", "build")).toBe(true);
  });

  it("allows standard forward transitions", () => {
    expect(canTransitionPhase("ideate", "plan")).toBe(true);
    expect(canTransitionPhase("plan", "build")).toBe(true);
    expect(canTransitionPhase("build", "review")).toBe(true);
    expect(canTransitionPhase("review", "ship")).toBe(true);
  });

  it("blocks invalid transitions", () => {
    expect(canTransitionPhase("ideate", "build")).toBe(false);
    expect(canTransitionPhase("plan", "review")).toBe(false);
    expect(canTransitionPhase("complete", "ideate")).toBe(false);
  });
});

describe("checkPhaseGate", () => {
  it("blocks ideate to plan without designDoc and designReview pass", () => {
    const result = checkPhaseGate("ideate", "plan", {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("design");
  });

  it("allows ideate to plan with designDoc and passing review", () => {
    const result = checkPhaseGate("ideate", "plan", {
      designDoc: { problemStatement: "test" },
      designReview: { decision: "pass", issues: [], summary: "ok" },
    });
    expect(result.allowed).toBe(true);
  });

  it("blocks plan to build without buildPlan and planReview pass", () => {
    const result = checkPhaseGate("plan", "build", {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("plan");
  });

  it("blocks build to review without passing verification", () => {
    const result = checkPhaseGate("build", "review", {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("verification");
  });

  it("allows build to review with passing verification", () => {
    const result = checkPhaseGate("build", "review", {
      verificationOut: { testsPassed: 5, testsFailed: 0, typecheckPassed: true, fullOutput: "", timestamp: "" },
    });
    expect(result.allowed).toBe(true);
  });

  it("blocks review to ship without all evidence", () => {
    const result = checkPhaseGate("review", "ship", {});
    expect(result.allowed).toBe(false);
  });

  it("allows any phase to failed (no gate)", () => {
    const result = checkPhaseGate("build", "failed", {});
    expect(result.allowed).toBe(true);
  });

  it("allows review to build (backward, no gate)", () => {
    const result = checkPhaseGate("review", "build", {});
    expect(result.allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && pnpm test -- feature-build-types.test.ts`
Expected: FAIL — `checkPhaseGate` not exported, review→build not allowed

- [ ] **Step 3: Update ALLOWED_TRANSITIONS and implement checkPhaseGate**

In `apps/web/lib/feature-build-types.ts`:

1. Update `ALLOWED_TRANSITIONS` — add `"build"` to review's allowed list:
```ts
const ALLOWED_TRANSITIONS: Record<BuildPhase, BuildPhase[]> = {
  ideate:   ["plan", "failed"],
  plan:     ["build", "failed"],
  build:    ["review", "failed"],
  review:   ["ship", "failed", "build"],  // added "build" for backward transition
  ship:     ["complete", "failed"],
  complete: [],
  failed:   [],
};
```

2. Add `checkPhaseGate` function:

```ts
export type PhaseGateResult = { allowed: boolean; reason?: string };

/**
 * Check whether required evidence exists for a phase transition.
 * This enforces the Build Disciplines hard gates.
 */
export function checkPhaseGate(
  from: BuildPhase,
  to: BuildPhase,
  evidence: Record<string, unknown>,
): PhaseGateResult {
  // Always allow transitions to "failed" or backward transitions
  if (to === "failed") return { allowed: true };
  if (from === "review" && to === "build") return { allowed: true };

  // Gate: ideate → plan — requires designDoc + passing designReview
  if (from === "ideate" && to === "plan") {
    if (!evidence.designDoc) return { allowed: false, reason: "A design document is required before planning." };
    const review = evidence.designReview as { decision?: string } | null;
    if (!review || review.decision !== "pass") return { allowed: false, reason: "Design review must pass before planning." };
    return { allowed: true };
  }

  // Gate: plan → build — requires buildPlan + passing planReview
  if (from === "plan" && to === "build") {
    if (!evidence.buildPlan) return { allowed: false, reason: "An implementation plan is required before building." };
    const review = evidence.planReview as { decision?: string } | null;
    if (!review || review.decision !== "pass") return { allowed: false, reason: "Plan review must pass before building." };
    return { allowed: true };
  }

  // Gate: build → review — requires passing verification
  if (from === "build" && to === "review") {
    const verification = evidence.verificationOut as { testsFailed?: number; typecheckPassed?: boolean } | null;
    if (!verification) return { allowed: false, reason: "Verification (tests + typecheck) is required before review." };
    if ((verification.testsFailed ?? 0) > 0) return { allowed: false, reason: "All tests must pass before review." };
    if (!verification.typecheckPassed) return { allowed: false, reason: "Typecheck must pass before review." };
    return { allowed: true };
  }

  // Gate: review → ship — requires all evidence present
  if (from === "review" && to === "ship") {
    if (!evidence.designDoc) return { allowed: false, reason: "Design document is missing." };
    if (!evidence.buildPlan) return { allowed: false, reason: "Implementation plan is missing." };
    if (!evidence.verificationOut) return { allowed: false, reason: "Verification output is missing." };
    if (!evidence.acceptanceMet) return { allowed: false, reason: "Acceptance criteria not evaluated." };
    const criteria = evidence.acceptanceMet as Array<{ met?: boolean }>;
    if (criteria.some((c) => !c.met)) return { allowed: false, reason: "Not all acceptance criteria are met." };
    return { allowed: true };
  }

  // Default: allow (ship → complete has no evidence gate)
  return { allowed: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && pnpm test -- feature-build-types.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/feature-build-types.ts apps/web/lib/feature-build-types.test.ts
git commit -m "feat: add phase gate enforcement with evidence checks"
```

---

### Task 5: Wire Phase Gates into advanceBuildPhase Server Action

**Files:**
- Modify: `apps/web/lib/actions/build.ts`

- [ ] **Step 1: Update advanceBuildPhase to check evidence gates**

Read the file. Find `advanceBuildPhase` (around line 84). Replace it:

```ts
export async function advanceBuildPhase(
  buildId: string,
  targetPhase: BuildPhase,
): Promise<void> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      id: true,
      phase: true,
      createdById: true,
      designDoc: true,
      designReview: true,
      buildPlan: true,
      planReview: true,
      taskResults: true,
      verificationOut: true,
      acceptanceMet: true,
    },
  });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");

  const currentPhase = build.phase as BuildPhase;
  if (!canTransitionPhase(currentPhase, targetPhase)) {
    throw new Error(`Cannot transition from ${currentPhase} to ${targetPhase}`);
  }

  // Check Build Disciplines hard gates
  const gate = checkPhaseGate(currentPhase, targetPhase, {
    designDoc: build.designDoc,
    designReview: build.designReview,
    buildPlan: build.buildPlan,
    planReview: build.planReview,
    taskResults: build.taskResults,
    verificationOut: build.verificationOut,
    acceptanceMet: build.acceptanceMet,
  });

  if (!gate.allowed) {
    throw new Error(gate.reason ?? "Phase gate check failed");
  }

  await prisma.featureBuild.update({
    where: { buildId },
    data: { phase: targetPhase },
  });
}
```

Add the import at the top:
```ts
import { checkPhaseGate } from "@/lib/feature-build-types";
```
(Add alongside the existing imports from that file.)

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/actions/build.ts
git commit -m "feat: enforce Build Disciplines phase gates in advanceBuildPhase"
```

---

### Task 6: Add Claim Management Actions

**Files:**
- Modify: `apps/web/lib/actions/build.ts`

- [ ] **Step 1: Add claimBuild and releaseBuildClaim actions**

Add at the end of the file:

```ts
// ─── Build Disciplines — Work Claims ─────────────────────────────────────────

export async function claimBuild(
  buildId: string,
  agentId?: string,
): Promise<void> {
  const userId = await requireBuildAccess();

  await prisma.featureBuild.update({
    where: { buildId },
    data: {
      claimedByAgentId: agentId ?? null,
      claimedAt: new Date(),
      claimStatus: "active",
    },
  });
}

export async function releaseBuildClaim(buildId: string): Promise<void> {
  const userId = await requireBuildAccess();

  await prisma.featureBuild.update({
    where: { buildId },
    data: {
      claimedByAgentId: null,
      claimedAt: null,
      claimStatus: "released",
    },
  });
}

// ─── Build Disciplines — Evidence Storage ────────────────────────────────────

export async function saveBuildEvidence(
  buildId: string,
  field: "designDoc" | "designReview" | "buildPlan" | "planReview" | "taskResults" | "verificationOut" | "acceptanceMet",
  value: unknown,
): Promise<void> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({ where: { buildId } });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");

  await prisma.featureBuild.update({
    where: { buildId },
    data: { [field]: value as Prisma.InputJsonValue },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/actions/build.ts
git commit -m "feat: add claim management and evidence storage actions"
```

---

### Task 7: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
cd apps/web && pnpm test
```
Verify no new failures.

- [ ] **Step 2: Verify phase gates work**

The `checkPhaseGate` tests validate the logic. The wiring in `advanceBuildPhase` ensures the gates are enforced at runtime.

- [ ] **Step 3: Push**

```bash
git push
```
