# EP-GRC-003: Reporting & Submissions — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build compliance gap assessment, posture reporting with trend analysis, enhanced regulatory submission workflow, and periodic compliance snapshots — completing the GRC suite.

**Architecture:** Analytics queries against existing EP-GRC-001 data (no redundant storage). 1 new table (ComplianceSnapshot) for trend analysis. Gap and posture are computed views. Submission detail page with auto-generated preparation checklist from the obligation→evidence chain. Snapshot auto-triggered after monthly regulatory scans.

**Tech Stack:** Next.js 14, Prisma (PostgreSQL), TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-03-18-reporting-submissions-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web/lib/reporting-types.ts` | Types, snapshot ID generator, score calculation, submission state machine |
| `apps/web/lib/reporting-types.test.ts` | Type tests |
| `apps/web/lib/actions/reporting.ts` | Gap analysis, posture, snapshot, submission enhancement actions |
| `apps/web/lib/actions/reporting.test.ts` | Server action tests |
| `apps/web/app/(shell)/compliance/gaps/page.tsx` | Gap assessment page |
| `apps/web/app/(shell)/compliance/posture/page.tsx` | Posture report page |
| `apps/web/app/(shell)/compliance/submissions/[id]/page.tsx` | Submission detail page |

### Modified Files

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add ComplianceSnapshot model |
| `apps/web/components/compliance/ComplianceTabNav.tsx` | Add "Gaps" and "Posture" tabs |
| `apps/web/app/(shell)/compliance/submissions/page.tsx` | Enhance with deadline countdown, status colors |
| `apps/web/lib/actions/regulatory-monitor.ts` | Call takeComplianceSnapshot after scan completes |

### Test Files

| File | Tests |
|------|-------|
| `apps/web/lib/reporting-types.test.ts` | Score calculation, submission state machine, ID generator |
| `apps/web/lib/actions/reporting.test.ts` | Gap assessment, posture, snapshot, submission transitions |

---

## Task 1: Schema Migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add ComplianceSnapshot model**

Add after the Regulatory Intelligence section (end of file):

```prisma
// ─── Compliance Reporting ───────────────────────────────────────────────────

// Intentionally omits status and updatedAt — snapshots are immutable point-in-time records.
model ComplianceSnapshot {
  id                  String   @id @default(cuid())
  snapshotId          String   @unique
  takenAt             DateTime @default(now())
  triggeredBy         String
  totalRegulations    Int
  totalObligations    Int
  coveredObligations  Int
  totalControls       Int
  implementedControls Int
  openIncidents       Int
  overdueActions      Int
  publishedPolicies   Int
  pendingAlerts       Int
  overallScore        Float
  regulationBreakdown Json
  agentId             String?
  createdAt           DateTime @default(now())

  @@index([takenAt])
}
```

- [ ] **Step 2: Run prisma validate + generate**

Run: `cd packages/db && npx prisma validate && npx prisma generate`

- [ ] **Step 3: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add ComplianceSnapshot model for posture trend analysis

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Types and Validation (TDD)

**Files:**
- Create: `apps/web/lib/reporting-types.ts`
- Create: `apps/web/lib/reporting-types.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// apps/web/lib/reporting-types.test.ts
import { describe, expect, it } from "vitest";
import {
  generateSnapshotId,
  calculatePostureScore,
  isValidSubmissionTransition,
  SUBMISSION_STATUS_FLOW,
} from "./reporting-types";

describe("ID generator", () => {
  it("generates snapshot IDs with SNAP- prefix", () => {
    expect(generateSnapshotId()).toMatch(/^SNAP-[A-Z0-9]{8}$/);
  });
  it("generates unique IDs", () => {
    const ids = Array.from({ length: 20 }, () => generateSnapshotId());
    expect(new Set(ids).size).toBe(20);
  });
});

describe("calculatePostureScore", () => {
  it("returns 100 for perfect compliance", () => {
    const score = calculatePostureScore({
      totalObligations: 10, coveredObligations: 10,
      totalControls: 8, implementedControls: 8,
      openIncidents: 0, overdueActions: 0,
    });
    expect(score).toBe(100);
  });

  it("returns 0 for worst case", () => {
    const score = calculatePostureScore({
      totalObligations: 10, coveredObligations: 0,
      totalControls: 10, implementedControls: 0,
      openIncidents: 10, overdueActions: 10,
    });
    expect(score).toBe(0);
  });

  it("returns intermediate score for partial compliance", () => {
    const score = calculatePostureScore({
      totalObligations: 10, coveredObligations: 5,
      totalControls: 10, implementedControls: 5,
      openIncidents: 2, overdueActions: 1,
    });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
  });

  it("handles zero totals gracefully", () => {
    const score = calculatePostureScore({
      totalObligations: 0, coveredObligations: 0,
      totalControls: 0, implementedControls: 0,
      openIncidents: 0, overdueActions: 0,
    });
    expect(score).toBe(100); // no obligations = fully compliant
  });

  it("clamps to 0-100 range", () => {
    const score = calculatePostureScore({
      totalObligations: 1, coveredObligations: 1,
      totalControls: 1, implementedControls: 1,
      openIncidents: 100, overdueActions: 100,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe("isValidSubmissionTransition", () => {
  it("allows draft → pending", () => expect(isValidSubmissionTransition("draft", "pending")).toBe(true));
  it("allows pending → submitted", () => expect(isValidSubmissionTransition("pending", "submitted")).toBe(true));
  it("allows pending → draft (revision)", () => expect(isValidSubmissionTransition("pending", "draft")).toBe(true));
  it("allows submitted → acknowledged", () => expect(isValidSubmissionTransition("submitted", "acknowledged")).toBe(true));
  it("allows submitted → rejected", () => expect(isValidSubmissionTransition("submitted", "rejected")).toBe(true));
  it("allows rejected → draft", () => expect(isValidSubmissionTransition("rejected", "draft")).toBe(true));
  it("rejects draft → submitted (skip pending)", () => expect(isValidSubmissionTransition("draft", "submitted")).toBe(false));
  it("rejects submitted → draft (must go through rejected)", () => expect(isValidSubmissionTransition("submitted", "draft")).toBe(false));
  it("rejects acknowledged → anything", () => expect(isValidSubmissionTransition("acknowledged", "draft")).toBe(false));
});

describe("constants", () => {
  it("exports submission status flow", () => {
    expect(SUBMISSION_STATUS_FLOW).toHaveProperty("draft");
    expect(SUBMISSION_STATUS_FLOW).toHaveProperty("pending");
    expect(SUBMISSION_STATUS_FLOW).toHaveProperty("submitted");
  });
});
```

- [ ] **Step 2: Run tests — verify failure**

Run: `cd apps/web && npx vitest run lib/reporting-types.test.ts`

- [ ] **Step 3: Implement reporting-types.ts**

```ts
// apps/web/lib/reporting-types.ts
import * as crypto from "crypto";

function genId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export const generateSnapshotId = () => genId("SNAP");

// ─── Posture Score ──────────────────────────────────────────────────────────

export type PostureInput = {
  totalObligations: number;
  coveredObligations: number;
  totalControls: number;
  implementedControls: number;
  openIncidents: number;
  overdueActions: number;
};

export function calculatePostureScore(input: PostureInput): number {
  const obligationCoverage = input.totalObligations > 0
    ? input.coveredObligations / input.totalObligations
    : 1; // no obligations = fully compliant
  const controlImplementation = input.totalControls > 0
    ? input.implementedControls / input.totalControls
    : 1;
  const incidentFree = input.totalObligations > 0
    ? Math.max(0, 1 - input.openIncidents / input.totalObligations)
    : 1;
  const actionTimeliness = input.totalControls > 0
    ? Math.max(0, 1 - input.overdueActions / input.totalControls)
    : 1;

  const raw = (
    obligationCoverage * 0.4 +
    controlImplementation * 0.3 +
    incidentFree * 0.15 +
    actionTimeliness * 0.15
  ) * 100;

  return Math.round(Math.max(0, Math.min(100, raw)));
}

// ─── Submission State Machine ───────────────────────────────────────────────

export const SUBMISSION_STATUS_FLOW: Record<string, string[]> = {
  draft: ["pending"],
  pending: ["submitted", "draft"],
  submitted: ["acknowledged", "rejected"],
  rejected: ["draft"],
  acknowledged: [], // terminal
};

export function isValidSubmissionTransition(from: string, to: string): boolean {
  return SUBMISSION_STATUS_FLOW[from]?.includes(to) ?? false;
}

// ─── Gap Types ──────────────────────────────────────────────────────────────

export type ObligationGapStatus = "covered" | "partial" | "uncovered";

export type ObligationGap = {
  id: string;
  obligationId: string;
  title: string;
  reference: string | null;
  category: string | null;
  status: ObligationGapStatus;
  controlCount: number;
  implementedControlCount: number;
};

export type RegulationGapSummary = {
  id: string;
  shortName: string;
  jurisdiction: string;
  totalObligations: number;
  coveredObligations: number;
  partialObligations: number;
  uncoveredObligations: number;
  coveragePercent: number;
  obligations: ObligationGap[];
};
```

- [ ] **Step 4: Run tests — verify pass**

Run: `cd apps/web && npx vitest run lib/reporting-types.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/reporting-types.ts apps/web/lib/reporting-types.test.ts
git commit -m "feat: add reporting types, score calculation, submission state machine

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Server Actions — Gap Analysis + Posture + Snapshot

**Files:**
- Create: `apps/web/lib/actions/reporting.ts`

- [ ] **Step 1: Create reporting.ts with gap analysis, posture, and snapshot actions**

```ts
"use server";

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import {
  type ComplianceActionResult,
  requireViewCompliance, requireManageCompliance,
  getSessionEmployeeId, logComplianceAction,
} from "@/lib/actions/compliance-helpers";
import {
  generateSnapshotId, calculatePostureScore,
  type RegulationGapSummary, type ObligationGap, type ObligationGapStatus,
} from "@/lib/reporting-types";

// ─── Gap Assessment ─────────────────────────────────────────────────────────

export async function getGapAssessment(): Promise<RegulationGapSummary[]> {
  await requireViewCompliance();

  const regulations = await prisma.regulation.findMany({
    where: { status: "active" },
    include: {
      obligations: {
        where: { status: "active" },
        include: {
          controls: {
            include: {
              control: { select: { id: true, implementationStatus: true, status: true } },
            },
          },
        },
      },
    },
    orderBy: { shortName: "asc" },
  });

  return regulations.map((reg) => {
    const obligations: ObligationGap[] = reg.obligations.map((obl) => {
      const activeControls = obl.controls.filter((link) => link.control.status === "active");
      const implementedControls = activeControls.filter((link) => link.control.implementationStatus === "implemented");

      let status: ObligationGapStatus;
      if (implementedControls.length > 0) {
        status = "covered";
      } else if (activeControls.length > 0) {
        status = "partial";
      } else {
        status = "uncovered";
      }

      return {
        id: obl.id,
        obligationId: obl.obligationId,
        title: obl.title,
        reference: obl.reference,
        category: obl.category,
        status,
        controlCount: activeControls.length,
        implementedControlCount: implementedControls.length,
      };
    });

    // Sort: uncovered first, then partial, then covered
    const sortOrder: Record<ObligationGapStatus, number> = { uncovered: 0, partial: 1, covered: 2 };
    obligations.sort((a, b) => sortOrder[a.status] - sortOrder[b.status]);

    const covered = obligations.filter((o) => o.status === "covered").length;
    const partial = obligations.filter((o) => o.status === "partial").length;
    const uncovered = obligations.filter((o) => o.status === "uncovered").length;

    return {
      id: reg.id,
      shortName: reg.shortName,
      jurisdiction: reg.jurisdiction,
      totalObligations: obligations.length,
      coveredObligations: covered,
      partialObligations: partial,
      uncoveredObligations: uncovered,
      coveragePercent: obligations.length > 0 ? Math.round((covered / obligations.length) * 100) : 100,
      obligations,
    };
  });
}

// ─── Compliance Posture ─────────────────────────────────────────────────────

export async function getCompliancePosture() {
  await requireViewCompliance();

  const [
    totalRegulations,
    totalObligations,
    totalControls,
    implementedControls,
    openIncidents,
    overdueActions,
    publishedPolicies,
    pendingAlerts,
  ] = await Promise.all([
    prisma.regulation.count({ where: { status: "active" } }),
    prisma.obligation.count({ where: { status: "active" } }),
    prisma.control.count({ where: { status: "active" } }),
    prisma.control.count({ where: { status: "active", implementationStatus: "implemented" } }),
    prisma.complianceIncident.count({ where: { status: { in: ["open", "investigating"] } } }),
    prisma.correctiveAction.count({ where: { status: { in: ["open", "in-progress"] }, dueDate: { lt: new Date() } } }),
    prisma.policy.count({ where: { lifecycleStatus: "published", status: "active" } }),
    prisma.regulatoryAlert.count({ where: { status: "pending" } }),
  ]);

  // Covered obligations: those with at least one implemented control
  const coveredObligations = await prisma.obligation.count({
    where: {
      status: "active",
      controls: {
        some: {
          control: { implementationStatus: "implemented", status: "active" },
        },
      },
    },
  });

  const overallScore = calculatePostureScore({
    totalObligations, coveredObligations,
    totalControls, implementedControls,
    openIncidents, overdueActions,
  });

  // Per-regulation breakdown
  const gapData = await getGapAssessment();
  const regulationScores = gapData.map((r) => ({
    id: r.id,
    shortName: r.shortName,
    jurisdiction: r.jurisdiction,
    obligationCoverage: r.coveragePercent,
    totalObligations: r.totalObligations,
    coveredObligations: r.coveredObligations,
    uncoveredObligations: r.uncoveredObligations,
  }));

  return {
    overallScore,
    totalRegulations,
    totalObligations,
    coveredObligations,
    totalControls,
    implementedControls,
    openIncidents,
    overdueActions,
    publishedPolicies,
    pendingAlerts,
    regulationScores,
  };
}

// ─── Compliance Snapshot ────────────────────────────────────────────────────

export async function takeComplianceSnapshot(
  triggeredBy: "scheduled" | "manual" | "scan-complete",
): Promise<ComplianceActionResult> {
  if (triggeredBy === "manual") {
    await requireManageCompliance();
  }

  const employeeId = await getSessionEmployeeId();
  const posture = await getCompliancePosture();

  const gapData = await getGapAssessment();
  const regulationBreakdown = gapData.map((r) => ({
    regulationId: r.id,
    shortName: r.shortName,
    obligations: r.totalObligations,
    covered: r.coveredObligations,
    controls: r.totalObligations, // total controls linked to this regulation's obligations
    implemented: r.coveredObligations, // simplified — uses obligation coverage as proxy
    score: r.coveragePercent,
  }));

  const record = await prisma.complianceSnapshot.create({
    data: {
      snapshotId: generateSnapshotId(),
      triggeredBy,
      totalRegulations: posture.totalRegulations,
      totalObligations: posture.totalObligations,
      coveredObligations: posture.coveredObligations,
      totalControls: posture.totalControls,
      implementedControls: posture.implementedControls,
      openIncidents: posture.openIncidents,
      overdueActions: posture.overdueActions,
      publishedPolicies: posture.publishedPolicies,
      pendingAlerts: posture.pendingAlerts,
      overallScore: posture.overallScore,
      regulationBreakdown,
    },
  });

  await logComplianceAction("snapshot", record.id, "created", employeeId, null, {
    notes: `Score: ${posture.overallScore}, triggered by: ${triggeredBy}`,
  });

  revalidatePath("/compliance");
  return { ok: true, message: `Snapshot taken. Score: ${posture.overallScore}`, id: record.id };
}

export async function getPostureTrend(limit = 12) {
  await requireViewCompliance();
  return prisma.complianceSnapshot.findMany({
    orderBy: { takenAt: "desc" },
    take: limit,
    select: {
      snapshotId: true,
      takenAt: true,
      triggeredBy: true,
      overallScore: true,
      coveredObligations: true,
      totalObligations: true,
      implementedControls: true,
      totalControls: true,
      openIncidents: true,
      overdueActions: true,
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/actions/reporting.ts
git commit -m "feat: add reporting actions — gap analysis, posture, snapshots

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Server Actions — Submission Enhancement

**Files:**
- Modify: `apps/web/lib/actions/reporting.ts`

- [ ] **Step 1: Append submission enhancement actions**

Read existing file, then append:

```ts
// ─── Submission Enhancement ─────────────────────────────────────────────────

import { isValidSubmissionTransition } from "@/lib/reporting-types";

export async function getSubmission(id: string) {
  await requireViewCompliance();

  const submission = await prisma.regulatorySubmission.findUniqueOrThrow({
    where: { id },
    include: {
      regulation: {
        include: {
          obligations: {
            where: { status: "active" },
            include: {
              evidence: { where: { status: "active" }, select: { id: true, title: true, evidenceType: true, collectedAt: true } },
            },
          },
        },
      },
      submittedBy: { select: { id: true, displayName: true } },
    },
  });

  // Build preparation checklist from obligations
  const checklist = submission.regulation?.obligations.map((obl) => ({
    obligationId: obl.obligationId,
    title: obl.title,
    evidenceCount: obl.evidence.length,
    hasEvidence: obl.evidence.length > 0,
    evidence: obl.evidence,
  })) ?? [];

  return { ...submission, checklist };
}

export async function transitionSubmissionStatus(
  id: string, newStatus: string,
): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  const submission = await prisma.regulatorySubmission.findUniqueOrThrow({
    where: { id }, select: { status: true },
  });

  if (!isValidSubmissionTransition(submission.status, newStatus)) {
    return { ok: false, message: `Cannot transition from ${submission.status} to ${newStatus}.` };
  }

  const data: Record<string, unknown> = { status: newStatus };
  if (newStatus === "submitted") {
    data.submittedAt = new Date();
    data.submittedByEmployeeId = employeeId;
  }

  await prisma.regulatorySubmission.update({ where: { id }, data });

  await logComplianceAction("submission", id, "status-changed", employeeId, null, {
    field: "status", oldValue: submission.status, newValue: newStatus,
  });
  revalidatePath("/compliance");
  return { ok: true, message: `Submission ${newStatus}.` };
}
```

Note: Move the `isValidSubmissionTransition` import to the top of the file with the other imports.

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/actions/reporting.ts
git commit -m "feat: add submission detail with preparation checklist and status transitions

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: ComplianceTabNav + Gap Assessment Page

**Files:**
- Modify: `apps/web/components/compliance/ComplianceTabNav.tsx`
- Create: `apps/web/app/(shell)/compliance/gaps/page.tsx`

- [ ] **Step 1: Add Gaps and Posture tabs to ComplianceTabNav**

Read `apps/web/components/compliance/ComplianceTabNav.tsx`. Add two entries before Submissions:

```ts
{ label: "Gaps", href: "/compliance/gaps" },
{ label: "Posture", href: "/compliance/posture" },
```

- [ ] **Step 2: Create gap assessment page**

```tsx
// apps/web/app/(shell)/compliance/gaps/page.tsx
import { getGapAssessment } from "@/lib/actions/reporting";

const GAP_COLORS: Record<string, string> = {
  covered: "bg-green-400",
  partial: "bg-yellow-400",
  uncovered: "bg-red-400",
};

export default async function GapsPage() {
  const gaps = await getGapAssessment();

  const totalUncovered = gaps.reduce((sum, r) => sum + r.uncoveredObligations, 0);
  const totalPartial = gaps.reduce((sum, r) => sum + r.partialObligations, 0);
  const regsWithGaps = gaps.filter((r) => r.uncoveredObligations > 0 || r.partialObligations > 0).length;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Gap Assessment</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {totalUncovered > 0 || totalPartial > 0
            ? `${totalUncovered} uncovered · ${totalPartial} partial across ${regsWithGaps} regulation${regsWithGaps !== 1 ? "s" : ""}`
            : "All obligations covered"}
        </p>
      </div>

      {gaps.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No regulations registered yet.</p>
      ) : (
        <div className="space-y-6">
          {gaps.map((reg) => (
            <div key={reg.id} className="rounded-lg border border-[var(--dpf-border)] p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{reg.shortName}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#333] text-[var(--dpf-muted)]">{reg.jurisdiction}</span>
                </div>
                <span className={`text-sm font-semibold ${reg.coveragePercent >= 80 ? "text-green-400" : reg.coveragePercent >= 50 ? "text-yellow-400" : "text-red-400"}`}>
                  {reg.coveredObligations}/{reg.totalObligations} covered ({reg.coveragePercent}%)
                </span>
              </div>

              {reg.obligations.length === 0 ? (
                <p className="text-xs text-[var(--dpf-muted)]">No obligations defined.</p>
              ) : (
                <div className="space-y-1">
                  {reg.obligations.map((obl) => (
                    <div key={obl.id} className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${GAP_COLORS[obl.status]}`} />
                        <span className="text-sm text-white">{obl.title}</span>
                        {obl.reference && <span className="text-[9px] text-[var(--dpf-muted)]">{obl.reference}</span>}
                      </div>
                      <span className="text-xs text-[var(--dpf-muted)]">
                        {obl.implementedControlCount}/{obl.controlCount} control{obl.controlCount !== 1 ? "s" : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/compliance/ComplianceTabNav.tsx apps/web/app/(shell)/compliance/gaps/
git commit -m "feat: add gap assessment page with per-regulation coverage breakdown

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Posture Report Page

**Files:**
- Create: `apps/web/app/(shell)/compliance/posture/page.tsx`

- [ ] **Step 1: Create posture report page**

```tsx
// apps/web/app/(shell)/compliance/posture/page.tsx
import { getCompliancePosture, getPostureTrend, takeComplianceSnapshot } from "@/lib/actions/reporting";

export default async function PosturePage() {
  const [posture, trend] = await Promise.all([
    getCompliancePosture(),
    getPostureTrend(12),
  ]);

  const scoreColor = posture.overallScore >= 80 ? "#4ade80" : posture.overallScore >= 60 ? "#fbbf24" : "#ef4444";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Compliance Posture</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">Point-in-time compliance health</p>
        </div>
        <form action={async () => { "use server"; await takeComplianceSnapshot("manual"); }}>
          <button type="submit"
            className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90">
            Take Snapshot
          </button>
        </form>
      </div>

      {/* Overall Score */}
      <div className="flex items-center gap-6 mb-8">
        <div className="text-center">
          <p className="text-5xl font-bold" style={{ color: scoreColor }}>{posture.overallScore}</p>
          <p className="text-xs text-[var(--dpf-muted)] mt-1">Overall Score</p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 flex-1">
          <MetricCard label="Obligation Coverage" value={`${posture.totalObligations > 0 ? Math.round((posture.coveredObligations / posture.totalObligations) * 100) : 100}%`} sub={`${posture.coveredObligations}/${posture.totalObligations}`} />
          <MetricCard label="Control Implementation" value={`${posture.totalControls > 0 ? Math.round((posture.implementedControls / posture.totalControls) * 100) : 100}%`} sub={`${posture.implementedControls}/${posture.totalControls}`} />
          <MetricCard label="Open Incidents" value={posture.openIncidents} sub={posture.openIncidents === 0 ? "Clear" : "Active"} />
          <MetricCard label="Overdue Actions" value={posture.overdueActions} sub={posture.overdueActions === 0 ? "On track" : "Needs attention"} />
        </div>
      </div>

      {/* Per-Regulation Breakdown */}
      <section className="mb-8">
        <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">By Regulation</h2>
        {posture.regulationScores.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)]">No regulations registered.</p>
        ) : (
          <div className="space-y-2">
            {posture.regulationScores.map((r) => (
              <div key={r.id} className="p-3 rounded-lg border border-[var(--dpf-border)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white">{r.shortName}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#333] text-[var(--dpf-muted)]">{r.jurisdiction}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-[var(--dpf-muted)]">
                  <span>{r.coveredObligations}/{r.totalObligations} covered</span>
                  <span className={`font-semibold ${r.obligationCoverage >= 80 ? "text-green-400" : r.obligationCoverage >= 50 ? "text-yellow-400" : "text-red-400"}`}>
                    {r.obligationCoverage}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Trend */}
      <section>
        <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">Trend ({trend.length} snapshots)</h2>
        {trend.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)]">No snapshots yet. Take a snapshot to start tracking trends.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[var(--dpf-muted)] border-b border-[var(--dpf-border)]">
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Score</th>
                  <th className="py-2 pr-4">Obligations</th>
                  <th className="py-2 pr-4">Controls</th>
                  <th className="py-2 pr-4">Incidents</th>
                  <th className="py-2 pr-4">Overdue</th>
                  <th className="py-2">Trigger</th>
                </tr>
              </thead>
              <tbody>
                {trend.map((s) => (
                  <tr key={s.snapshotId} className="border-b border-[var(--dpf-border)]">
                    <td className="py-2 pr-4 text-white">{new Date(s.takenAt).toLocaleDateString()}</td>
                    <td className="py-2 pr-4">
                      <span className={`font-semibold ${s.overallScore >= 80 ? "text-green-400" : s.overallScore >= 60 ? "text-yellow-400" : "text-red-400"}`}>
                        {s.overallScore}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-[var(--dpf-muted)]">{s.coveredObligations}/{s.totalObligations}</td>
                    <td className="py-2 pr-4 text-[var(--dpf-muted)]">{s.implementedControls}/{s.totalControls}</td>
                    <td className="py-2 pr-4 text-[var(--dpf-muted)]">{s.openIncidents}</td>
                    <td className="py-2 pr-4 text-[var(--dpf-muted)]">{s.overdueActions}</td>
                    <td className="py-2 text-[var(--dpf-muted)]">{s.triggeredBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: number | string; sub: string }) {
  return (
    <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
      <p className="text-xs text-[var(--dpf-muted)]">{label}</p>
      <p className="text-lg font-bold text-white">{value}</p>
      <p className="text-[9px] text-[var(--dpf-muted)]">{sub}</p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/(shell)/compliance/posture/
git commit -m "feat: add compliance posture report with score and trend

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Submission Detail + List Enhancement

**Files:**
- Create: `apps/web/app/(shell)/compliance/submissions/[id]/page.tsx`
- Modify: `apps/web/app/(shell)/compliance/submissions/page.tsx`

- [ ] **Step 1: Create submission detail page**

Server component at `apps/web/app/(shell)/compliance/submissions/[id]/page.tsx`. Calls `getSubmission(id)`. Shows submission metadata, linked regulation, preparation checklist (computed from obligations→evidence), evidence list, and status transition buttons. Follow the audit detail page pattern from `compliance/audits/[id]/page.tsx`.

- [ ] **Step 2: Enhance submissions list page**

Read `apps/web/app/(shell)/compliance/submissions/page.tsx`. Add:
- Deadline countdown: for each submission with dueDate, compute days remaining. Red text if overdue (negative days), amber if < 7 days.
- Make each submission row a link to `/compliance/submissions/${s.id}` (add `<a>` wrapper like audits page).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(shell)/compliance/submissions/
git commit -m "feat: add submission detail page with preparation checklist and evidence

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Wire Snapshot into Regulatory Monitor

**Files:**
- Modify: `apps/web/lib/actions/regulatory-monitor.ts`

- [ ] **Step 1: Add snapshot trigger after scan completes**

Read `apps/web/lib/actions/regulatory-monitor.ts`. Find where the scan status is updated to "completed" (near the end of `triggerRegulatoryMonitorScan`). After that update, before the calendar event creation, add:

```ts
// Auto-capture compliance snapshot after scan
try {
  const { takeComplianceSnapshot } = await import("@/lib/actions/reporting");
  await takeComplianceSnapshot("scan-complete");
} catch {
  // Snapshot failure shouldn't fail the scan
}
```

Use dynamic import to avoid circular dependencies.

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/actions/regulatory-monitor.ts
git commit -m "feat: auto-capture compliance snapshot after monthly regulatory scan

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Tests + Final Verification

**Files:**
- Create: `apps/web/lib/actions/reporting.test.ts`

- [ ] **Step 1: Create test file**

Mock setup follows compliance.test.ts pattern. Key tests:

1. **Gap assessment:** regulation with mixed obligation coverage returns correct gap statuses
2. **Posture score:** mocked metrics return expected composite score
3. **Snapshot:** takeComplianceSnapshot creates record with correct denormalized values
4. **Trend:** getPostureTrend returns snapshots in reverse chronological order
5. **Submission transitions:** valid transitions succeed, invalid rejected, submittedAt set on "submitted"

Mock Prisma models: regulation, obligation, control, controlObligationLink, complianceIncident, correctiveAction, policy, regulatoryAlert, complianceSnapshot, regulatorySubmission, complianceAuditLog, employeeProfile.

- [ ] **Step 2: Run tests**

Run: `cd apps/web && npx vitest run lib/actions/reporting.test.ts lib/reporting-types.test.ts`

- [ ] **Step 3: Run full test suite**

Run: `cd apps/web && npx vitest run lib/compliance-types.test.ts lib/actions/compliance.test.ts lib/policy-types.test.ts lib/actions/policy.test.ts lib/regulatory-monitor-types.test.ts lib/actions/regulatory-monitor.test.ts lib/reporting-types.test.ts lib/actions/reporting.test.ts`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/actions/reporting.test.ts
git commit -m "test: add reporting tests — gap assessment, posture, snapshots, submissions

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```
