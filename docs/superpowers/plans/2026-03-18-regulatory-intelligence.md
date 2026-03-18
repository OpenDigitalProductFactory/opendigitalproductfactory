# EP-GRC-002: Regulatory Intelligence — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build monthly AI-driven regulatory monitoring — scheduled scan of registered regulations for changes, alert generation with confidence filtering, alert management workflow, dashboard integration, calendar integration.

**Architecture:** A dedicated "Regulatory Monitor" server action (`regulatory-monitor.ts`) uses `callWithFailover` to query LLMs about regulatory changes for each registered regulation. Results are stored as `RegulatoryAlert` records linked to `RegulatoryMonitorScan` runs. Alerts surface on the compliance dashboard for human review, with actions to dismiss, flag, or create obligations. Monthly scheduling via `ScheduledJob`. Calendar events for scan schedule and high-priority alert deadlines.

**Tech Stack:** Next.js 14, Prisma (PostgreSQL), TypeScript, Vitest, existing `callWithFailover` LLM infrastructure.

**Spec:** `docs/superpowers/specs/2026-03-18-regulatory-intelligence-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web/lib/regulatory-monitor-types.ts` | Types, validators, ID generators, alert/scan constants |
| `apps/web/lib/regulatory-monitor-types.test.ts` | Type tests |
| `apps/web/lib/actions/regulatory-monitor.ts` | Scan execution, alert CRUD, LLM integration, dashboard summary |
| `apps/web/lib/actions/regulatory-monitor.test.ts` | Server action tests |
| `apps/web/components/compliance/RegulatoryAlerts.tsx` | Alert list + review modal client component |
| `apps/web/components/compliance/ScanStatus.tsx` | Scan status + "Run Scan Now" button |

### Modified Files

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add 2 new models, extend Regulation (3 fields + alerts), EmployeeProfile relations |
| `apps/web/lib/compliance-types.ts` | Add new entity type values |
| `apps/web/app/(shell)/compliance/page.tsx` | Add alert summary + scan status sections |
| `apps/web/app/(shell)/workspace/page.tsx` | Add pending alert count to compliance tile |

### Test Files

| File | Tests |
|------|-------|
| `apps/web/lib/regulatory-monitor-types.test.ts` | ID generators, validators, constants |
| `apps/web/lib/actions/regulatory-monitor.test.ts` | Auth, scan execution, alert management, confidence filtering |

---

## Task 1: Schema Migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add RegulatoryMonitorScan and RegulatoryAlert models**

Add after the Internal Policy Management section (end of file), under a new section header:

```prisma
// ─── Regulatory Intelligence ────────────────────────────────────────────────

model RegulatoryMonitorScan {
  id                    String    @id @default(cuid())
  scanId                String    @unique
  triggeredBy           String
  triggeredByEmployeeId String?
  status                String    @default("running")
  regulationsChecked    Int       @default(0)
  alertsGenerated       Int       @default(0)
  summary               String?
  agentId               String?
  startedAt             DateTime  @default(now())
  completedAt           DateTime?
  errorMessage          String?
  createdAt             DateTime  @default(now())

  triggeredByEmployee EmployeeProfile? @relation("ScanTriggerer", fields: [triggeredByEmployeeId], references: [id], onDelete: SetNull)
  alerts              RegulatoryAlert[]

  @@index([triggeredByEmployeeId])
  @@index([status])
  @@index([startedAt])
}

model RegulatoryAlert {
  id                   String    @id @default(cuid())
  alertId              String    @unique
  scanId               String
  regulationId         String?
  alertType            String
  severity             String    @default("medium")
  title                String
  description          String?
  sourceUrl            String?
  sourceSnippet        String?
  suggestedAction      String?
  reviewedByEmployeeId String?
  reviewedAt           DateTime?
  resolution           String?
  resolutionNotes      String?
  agentId              String?
  status               String    @default("pending")
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  scan       RegulatoryMonitorScan @relation(fields: [scanId], references: [id], onDelete: Cascade)
  regulation Regulation?           @relation(fields: [regulationId], references: [id], onDelete: SetNull)
  reviewedBy EmployeeProfile?      @relation("AlertReviewer", fields: [reviewedByEmployeeId], references: [id], onDelete: SetNull)

  @@index([scanId])
  @@index([regulationId])
  @@index([reviewedByEmployeeId])
  @@index([status])
  @@index([severity])
  @@index([alertType])
}
```

- [ ] **Step 2: Extend Regulation model with 3 new fields**

Find `model Regulation {` and add before the closing `}`, after the existing relations:

```prisma
  lastKnownVersion String?
  sourceCheckDate  DateTime?
  changeDetected   Boolean   @default(false)
  alerts           RegulatoryAlert[]
```

- [ ] **Step 3: Add EmployeeProfile reverse relations**

Find `model EmployeeProfile {` and add:

```prisma
  // ─── Regulatory Intelligence relations ───────────────
  scansTriggered RegulatoryMonitorScan[] @relation("ScanTriggerer")
  alertsReviewed RegulatoryAlert[]       @relation("AlertReviewer")
```

- [ ] **Step 4: Run prisma validate + generate**

Run: `cd packages/db && npx prisma validate && npx prisma generate`

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add regulatory intelligence schema — scan + alert models

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Types and Validation (TDD)

**Files:**
- Create: `apps/web/lib/regulatory-monitor-types.ts`
- Create: `apps/web/lib/regulatory-monitor-types.test.ts`
- Modify: `apps/web/lib/compliance-types.ts`

- [ ] **Step 1: Write failing tests**

```ts
// apps/web/lib/regulatory-monitor-types.test.ts
import { describe, expect, it } from "vitest";
import {
  generateScanId, generateAlertId,
  validateAlertResolution,
  SCAN_STATUSES, SCAN_TRIGGER_TYPES,
  ALERT_TYPES, ALERT_SEVERITIES, ALERT_STATUSES, ALERT_RESOLUTIONS,
  REGULATORY_MONITOR_PROMPT,
} from "./regulatory-monitor-types";

describe("ID generators", () => {
  it("generates scan IDs with SCAN- prefix", () => {
    expect(generateScanId()).toMatch(/^SCAN-[A-Z0-9]{8}$/);
  });
  it("generates alert IDs with RALRT- prefix", () => {
    expect(generateAlertId()).toMatch(/^RALRT-[A-Z0-9]{8}$/);
  });
  it("generates unique IDs", () => {
    const ids = Array.from({ length: 20 }, () => generateScanId());
    expect(new Set(ids).size).toBe(20);
  });
});

describe("validateAlertResolution", () => {
  it("accepts valid resolutions", () => {
    for (const r of ALERT_RESOLUTIONS) {
      expect(validateAlertResolution(r)).toBeNull();
    }
  });
  it("rejects invalid resolution", () => {
    expect(validateAlertResolution("bogus")).toMatch(/Resolution must be one of/);
  });
});

describe("constants", () => {
  it("exports scan statuses", () => {
    expect(SCAN_STATUSES).toEqual(["running", "completed", "failed"]);
  });
  it("exports trigger types", () => {
    expect(SCAN_TRIGGER_TYPES).toEqual(["scheduled", "manual"]);
  });
  it("exports alert types", () => {
    expect(ALERT_TYPES).toContain("change-detected");
    expect(ALERT_TYPES).toContain("new-regulation");
  });
  it("exports alert severities", () => {
    expect(ALERT_SEVERITIES).toEqual(["low", "medium", "high", "critical"]);
  });
  it("exports alert statuses", () => {
    expect(ALERT_STATUSES).toEqual(["pending", "reviewed", "actioned", "dismissed"]);
  });
  it("exports alert resolutions", () => {
    expect(ALERT_RESOLUTIONS).toContain("dismissed");
    expect(ALERT_RESOLUTIONS).toContain("obligation-created");
  });
  it("exports LLM prompt template", () => {
    expect(REGULATORY_MONITOR_PROMPT).toContain("regulatory compliance monitor");
  });
});
```

- [ ] **Step 2: Run tests — verify failure**

Run: `cd apps/web && npx vitest run lib/regulatory-monitor-types.test.ts`

- [ ] **Step 3: Implement regulatory-monitor-types.ts**

```ts
// apps/web/lib/regulatory-monitor-types.ts
import * as crypto from "crypto";

function genId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export const generateScanId = () => genId("SCAN");
export const generateAlertId = () => genId("RALRT");

export const SCAN_STATUSES = ["running", "completed", "failed"] as const;
export const SCAN_TRIGGER_TYPES = ["scheduled", "manual"] as const;

export const ALERT_TYPES = ["change-detected", "new-regulation", "deadline-approaching", "enforcement-action"] as const;
export const ALERT_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const ALERT_STATUSES = ["pending", "reviewed", "actioned", "dismissed"] as const;
export const ALERT_RESOLUTIONS = [
  "dismissed", "obligation-created", "regulation-updated", "flagged-for-further-review",
] as const;

export function validateAlertResolution(resolution: string): string | null {
  if (!(ALERT_RESOLUTIONS as readonly string[]).includes(resolution)) {
    return `Resolution must be one of: ${ALERT_RESOLUTIONS.join(", ")}.`;
  }
  return null;
}

export type LLMScanResponse = {
  hasChanged: boolean;
  confidence: "high" | "medium" | "low";
  summary: string;
  severity: "low" | "medium" | "high" | "critical";
  suggestedAction: string;
};

export const REGULATORY_MONITOR_PROMPT = `You are a regulatory compliance monitor. Check whether this regulation has been updated or changed.

Regulation: {name} ({shortName})
Jurisdiction: {jurisdiction}
Last known version: {lastKnownVersion}
Last checked: {sourceCheckDate}
Source URL: {sourceUrl}

Respond in JSON only (no markdown, no explanation):
{
  "hasChanged": boolean,
  "confidence": "high" | "medium" | "low",
  "summary": "brief description of what changed or 'no changes detected'",
  "severity": "low" | "medium" | "high" | "critical",
  "suggestedAction": "what the compliance team should do"
}`;

export function buildScanPrompt(reg: {
  name: string; shortName: string; jurisdiction: string;
  lastKnownVersion?: string | null; sourceCheckDate?: Date | null; sourceUrl?: string | null;
}): string {
  return REGULATORY_MONITOR_PROMPT
    .replace("{name}", reg.name)
    .replace("{shortName}", reg.shortName)
    .replace("{jurisdiction}", reg.jurisdiction)
    .replace("{lastKnownVersion}", reg.lastKnownVersion ?? "unknown")
    .replace("{sourceCheckDate}", reg.sourceCheckDate?.toISOString().split("T")[0] ?? "never")
    .replace("{sourceUrl}", reg.sourceUrl ?? "none provided");
}
```

- [ ] **Step 4: Update compliance-types.ts**

Read `apps/web/lib/compliance-types.ts`. If there are entity type constants, add `"regulatory-scan"` and `"alert-review"` to the complianceEntityType values. If not explicitly enumerated, no change needed.

- [ ] **Step 5: Run tests — verify pass**

Run: `cd apps/web && npx vitest run lib/regulatory-monitor-types.test.ts`

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/regulatory-monitor-types.ts apps/web/lib/regulatory-monitor-types.test.ts apps/web/lib/compliance-types.ts
git commit -m "feat: add regulatory monitor types, validators, LLM prompt template

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Server Actions — Scan Execution

**Files:**
- Create: `apps/web/lib/actions/regulatory-monitor.ts`

- [ ] **Step 1: Create regulatory-monitor.ts with scan execution**

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
  generateScanId, generateAlertId, buildScanPrompt,
  type LLMScanResponse,
} from "@/lib/regulatory-monitor-types";
import { callWithFailover } from "@/lib/ai-provider-priority";
import type { ChatMessage } from "@/lib/ai-inference";

// ─── Scan Execution ─────────────────────────────────────────────────────────

export async function triggerRegulatoryMonitorScan(
  triggeredBy: "scheduled" | "manual",
): Promise<ComplianceActionResult> {
  if (triggeredBy === "manual") {
    await requireManageCompliance();
  }

  const employeeId = await getSessionEmployeeId();

  // Concurrency guard: reject if a scan is already running
  const running = await prisma.regulatoryMonitorScan.findFirst({ where: { status: "running" } });
  if (running) {
    return { ok: false, message: "A scan is already in progress." };
  }

  const scanId = generateScanId();
  const scan = await prisma.regulatoryMonitorScan.create({
    data: {
      scanId,
      triggeredBy,
      triggeredByEmployeeId: triggeredBy === "manual" ? employeeId : null,
    },
  });

  await logComplianceAction("regulatory-scan", scan.id, "created", employeeId, null, {
    notes: `Triggered by: ${triggeredBy}`,
  });

  // Fetch all active regulations
  const regulations = await prisma.regulation.findMany({
    where: { status: "active" },
    select: {
      id: true, name: true, shortName: true, jurisdiction: true,
      sourceUrl: true, lastKnownVersion: true, sourceCheckDate: true,
    },
  });

  let checked = 0;
  let alertsCreated = 0;
  const summaryParts: string[] = [];

  for (const reg of regulations) {
    try {
      const prompt = buildScanPrompt(reg);
      const messages: ChatMessage[] = [{ role: "user", content: prompt }];

      const result = await callWithFailover(
        messages,
        "You are a regulatory compliance monitoring assistant. Respond only in valid JSON.",
        "internal",
        { task: "analysis" as never },
      );

      // Parse LLM response
      let parsed: LLMScanResponse;
      try {
        parsed = JSON.parse(result.content) as LLMScanResponse;
      } catch {
        summaryParts.push(`${reg.shortName}: Failed to parse LLM response`);
        checked++;
        continue;
      }

      // Update sourceCheckDate on regulation
      await prisma.regulation.update({
        where: { id: reg.id },
        data: { sourceCheckDate: new Date() },
      });

      // Only create alert for medium/high confidence changes
      if (parsed.hasChanged && (parsed.confidence === "high" || parsed.confidence === "medium")) {
        const alert = await prisma.regulatoryAlert.create({
          data: {
            alertId: generateAlertId(),
            scanId: scan.id,
            regulationId: reg.id,
            alertType: "change-detected",
            severity: parsed.severity,
            title: `${reg.shortName}: ${parsed.summary.slice(0, 100)}`,
            description: parsed.summary,
            sourceUrl: reg.sourceUrl,
            suggestedAction: parsed.suggestedAction,
          },
        });

        await prisma.regulation.update({
          where: { id: reg.id },
          data: { changeDetected: true },
        });

        // Create calendar deadline for high/critical alerts
        if ((parsed.severity === "high" || parsed.severity === "critical") && employeeId) {
          const deadline = new Date();
          deadline.setDate(deadline.getDate() + 7);
          await ensureComplianceCalendarEvent(
            "alert-review", alert.id,
            `Review alert: ${reg.shortName}`, deadline, employeeId,
          );
        }

        alertsCreated++;
        summaryParts.push(`${reg.shortName}: CHANGE DETECTED (${parsed.severity}) — ${parsed.summary}`);
      } else if (parsed.hasChanged && parsed.confidence === "low") {
        summaryParts.push(`${reg.shortName}: Possible change (low confidence, no alert) — ${parsed.summary}`);
      } else {
        summaryParts.push(`${reg.shortName}: No changes detected`);
      }

      checked++;
    } catch (err) {
      summaryParts.push(`${reg.shortName}: Error — ${err instanceof Error ? err.message : "unknown"}`);
      checked++;
    }
  }

  // Complete the scan
  await prisma.regulatoryMonitorScan.update({
    where: { id: scan.id },
    data: {
      status: "completed",
      regulationsChecked: checked,
      alertsGenerated: alertsCreated,
      summary: summaryParts.join("\n"),
      completedAt: new Date(),
    },
  });

  // Create calendar event for next month's scan
  if (employeeId) {
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1, 1); // first of next month
    await ensureComplianceCalendarEvent(
      "regulatory-scan", scan.id,
      "Monthly Regulatory Monitor Scan", nextMonth, employeeId,
    );
  }

  await logComplianceAction("regulatory-scan", scan.id, "status-changed", employeeId, null, {
    field: "status", newValue: "completed",
    notes: `Checked ${checked} regulations, generated ${alertsCreated} alerts`,
  });

  revalidatePath("/compliance");
  return { ok: true, message: `Scan complete. Checked ${checked} regulations, ${alertsCreated} alerts generated.`, id: scan.id };
}

// ─── Scan Queries ───────────────────────────────────────────────────────────

export async function getLatestScan() {
  await requireViewCompliance();
  return prisma.regulatoryMonitorScan.findFirst({
    orderBy: { startedAt: "desc" },
    include: { _count: { select: { alerts: true } } },
  });
}

export async function listScans(limit = 5) {
  await requireViewCompliance();
  return prisma.regulatoryMonitorScan.findMany({
    orderBy: { startedAt: "desc" },
    take: limit,
    include: { _count: { select: { alerts: true } } },
  });
}
```

Note: The `callWithFailover` call may throw `NoProvidersAvailableError` if no LLM is configured. The `try/catch` around each regulation handles this — the scan completes with partial results. If the error happens on the first regulation AND all fail, the scan still completes with `regulationsChecked: N` and `alertsGenerated: 0`. If `callWithFailover` throws before any regulation is checked (unlikely), wrap the entire loop in a try/catch that marks the scan as "failed":

Add this wrapper around the for loop:

```ts
try {
  // ... for loop ...
} catch (err) {
  await prisma.regulatoryMonitorScan.update({
    where: { id: scan.id },
    data: {
      status: "failed",
      errorMessage: err instanceof Error ? err.message : "Unknown error",
      completedAt: new Date(),
    },
  });
  return { ok: false, message: "Scan failed: " + (err instanceof Error ? err.message : "Unknown error") };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/actions/regulatory-monitor.ts
git commit -m "feat: add regulatory monitor scan execution with LLM integration

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Server Actions — Alert Management

**Files:**
- Modify: `apps/web/lib/actions/regulatory-monitor.ts`

- [ ] **Step 1: Append alert CRUD and dashboard summary**

Read the existing file, then append:

```ts
// ─── Alert Management ───────────────────────────────────────────────────────

export async function listAlerts(filters?: {
  status?: string; severity?: string; alertType?: string; regulationId?: string;
}) {
  await requireViewCompliance();
  return prisma.regulatoryAlert.findMany({
    where: {
      ...(filters?.status && { status: filters.status }),
      ...(filters?.severity && { severity: filters.severity }),
      ...(filters?.alertType && { alertType: filters.alertType }),
      ...(filters?.regulationId && { regulationId: filters.regulationId }),
    },
    include: {
      regulation: { select: { id: true, shortName: true, jurisdiction: true } },
      reviewedBy: { select: { id: true, displayName: true } },
    },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
  });
}

export async function getAlert(id: string) {
  await requireViewCompliance();
  return prisma.regulatoryAlert.findUniqueOrThrow({
    where: { id },
    include: {
      scan: { select: { scanId: true, startedAt: true } },
      regulation: true,
      reviewedBy: { select: { id: true, displayName: true } },
    },
  });
}

export async function reviewAlert(
  id: string, resolution: string, notes?: string,
): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  const { validateAlertResolution } = await import("@/lib/regulatory-monitor-types");
  const error = validateAlertResolution(resolution);
  if (error) return { ok: false, message: error };

  await prisma.regulatoryAlert.update({
    where: { id },
    data: {
      status: "reviewed",
      resolution,
      resolutionNotes: notes ?? null,
      reviewedByEmployeeId: employeeId,
      reviewedAt: new Date(),
    },
  });

  // Clear changeDetected on regulation if this was the last pending alert
  const alert = await prisma.regulatoryAlert.findUniqueOrThrow({ where: { id }, select: { regulationId: true } });
  if (alert.regulationId) {
    const pendingCount = await prisma.regulatoryAlert.count({
      where: { regulationId: alert.regulationId, status: "pending" },
    });
    if (pendingCount === 0) {
      await prisma.regulation.update({
        where: { id: alert.regulationId },
        data: { changeDetected: false },
      });
    }
  }

  await logComplianceAction("regulatory-alert", id, "reviewed", employeeId, null, {
    field: "resolution", newValue: resolution, notes,
  });
  revalidatePath("/compliance");
  return { ok: true, message: "Alert reviewed." };
}

export async function dismissAlert(id: string, notes?: string): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.regulatoryAlert.update({
    where: { id },
    data: {
      status: "dismissed",
      resolution: "dismissed",
      resolutionNotes: notes ?? null,
      reviewedByEmployeeId: employeeId,
      reviewedAt: new Date(),
    },
  });

  // Clear changeDetected if no more pending alerts
  const alert = await prisma.regulatoryAlert.findUniqueOrThrow({ where: { id }, select: { regulationId: true } });
  if (alert.regulationId) {
    const pendingCount = await prisma.regulatoryAlert.count({
      where: { regulationId: alert.regulationId, status: "pending" },
    });
    if (pendingCount === 0) {
      await prisma.regulation.update({
        where: { id: alert.regulationId },
        data: { changeDetected: false },
      });
    }
  }

  await logComplianceAction("regulatory-alert", id, "dismissed", employeeId, null, { notes });
  revalidatePath("/compliance");
  return { ok: true, message: "Alert dismissed." };
}

export async function createObligationFromAlert(
  alertId: string,
  obligationInput: { title: string; regulationId: string; description?: string; reference?: string; category?: string },
): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  // Import obligation creation from compliance actions
  const { createObligation } = await import("@/lib/actions/compliance");
  const result = await createObligation({
    title: obligationInput.title,
    regulationId: obligationInput.regulationId,
    description: obligationInput.description ?? null,
    reference: obligationInput.reference ?? null,
    category: obligationInput.category ?? null,
  });

  if (!result.ok) return result;

  // Mark alert as actioned
  await prisma.regulatoryAlert.update({
    where: { id: alertId },
    data: {
      status: "actioned",
      resolution: "obligation-created",
      resolutionNotes: `Created obligation: ${result.id}`,
      reviewedByEmployeeId: employeeId,
      reviewedAt: new Date(),
    },
  });

  await logComplianceAction("regulatory-alert", alertId, "actioned", employeeId, null, {
    notes: `Obligation created: ${result.id}`,
  });
  revalidatePath("/compliance");
  return { ok: true, message: "Obligation created from alert.", id: result.id };
}

// ─── Dashboard Summary ──────────────────────────────────────────────────────

export async function getRegulatoryAlertSummary() {
  await requireViewCompliance();

  const [
    pendingTotal,
    pendingCritical,
    pendingHigh,
    pendingMedium,
    pendingLow,
    latestScan,
  ] = await Promise.all([
    prisma.regulatoryAlert.count({ where: { status: "pending" } }),
    prisma.regulatoryAlert.count({ where: { status: "pending", severity: "critical" } }),
    prisma.regulatoryAlert.count({ where: { status: "pending", severity: "high" } }),
    prisma.regulatoryAlert.count({ where: { status: "pending", severity: "medium" } }),
    prisma.regulatoryAlert.count({ where: { status: "pending", severity: "low" } }),
    prisma.regulatoryMonitorScan.findFirst({
      orderBy: { startedAt: "desc" },
      select: { scanId: true, status: true, startedAt: true, regulationsChecked: true, alertsGenerated: true },
    }),
  ]);

  return {
    pending: { total: pendingTotal, critical: pendingCritical, high: pendingHigh, medium: pendingMedium, low: pendingLow },
    latestScan,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/actions/regulatory-monitor.ts
git commit -m "feat: add regulatory alert management and dashboard summary

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: UI Components

**Files:**
- Create: `apps/web/components/compliance/RegulatoryAlerts.tsx`
- Create: `apps/web/components/compliance/ScanStatus.tsx`

- [ ] **Step 1: Create ScanStatus component**

```tsx
// apps/web/components/compliance/ScanStatus.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { triggerRegulatoryMonitorScan } from "@/lib/actions/regulatory-monitor";

type ScanInfo = {
  scanId: string;
  status: string;
  startedAt: Date;
  regulationsChecked: number;
  alertsGenerated: number;
} | null;

export function ScanStatus({ latestScan }: { latestScan: ScanInfo }) {
  const [scanning, setScanning] = useState(false);
  const router = useRouter();

  async function handleRunScan() {
    setScanning(true);
    await triggerRegulatoryMonitorScan("manual");
    setScanning(false);
    router.refresh();
  }

  return (
    <div className="flex items-center justify-between p-3 rounded-lg border border-[var(--dpf-border)]">
      <div>
        {latestScan ? (
          <>
            <p className="text-sm text-white">
              Last scan: {new Date(latestScan.startedAt).toLocaleDateString()}
              <span className={`ml-2 text-[9px] px-1.5 py-0.5 rounded-full ${
                latestScan.status === "completed" ? "bg-green-900/30 text-green-400" :
                latestScan.status === "failed" ? "bg-red-900/30 text-red-400" :
                "bg-yellow-900/30 text-yellow-400"
              }`}>{latestScan.status}</span>
            </p>
            <p className="text-xs text-[var(--dpf-muted)]">
              {latestScan.regulationsChecked} checked · {latestScan.alertsGenerated} alerts
            </p>
          </>
        ) : (
          <p className="text-sm text-[var(--dpf-muted)]">No scans yet</p>
        )}
      </div>
      <button onClick={handleRunScan} disabled={scanning}
        className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90 disabled:opacity-50">
        {scanning ? "Scanning..." : "Run Scan Now"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create RegulatoryAlerts component**

```tsx
// apps/web/components/compliance/RegulatoryAlerts.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ComplianceModal } from "./ComplianceModal";
import { dismissAlert, reviewAlert } from "@/lib/actions/regulatory-monitor";

type Alert = {
  id: string;
  alertId: string;
  title: string;
  severity: string;
  alertType: string;
  description: string | null;
  suggestedAction: string | null;
  status: string;
  createdAt: Date;
  regulation: { shortName: string; jurisdiction: string } | null;
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-900/30 text-red-400",
  high: "bg-orange-900/30 text-orange-400",
  medium: "bg-yellow-900/30 text-yellow-400",
  low: "bg-green-900/30 text-green-400",
};

export function RegulatoryAlerts({ alerts }: { alerts: Alert[] }) {
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const pending = alerts.filter((a) => a.status === "pending");

  async function handleDismiss(id: string) {
    setLoading(true);
    await dismissAlert(id);
    setSelectedAlert(null);
    setLoading(false);
    router.refresh();
  }

  async function handleReview(id: string, resolution: string) {
    setLoading(true);
    await reviewAlert(id, resolution);
    setSelectedAlert(null);
    setLoading(false);
    router.refresh();
  }

  if (pending.length === 0) {
    return <p className="text-sm text-[var(--dpf-muted)]">No pending alerts.</p>;
  }

  return (
    <>
      <div className="space-y-2">
        {pending.map((a) => (
          <div key={a.id} className="p-3 rounded-lg border border-[var(--dpf-border)] flex items-start justify-between cursor-pointer hover:border-[var(--dpf-accent)] transition-colors"
            onClick={() => setSelectedAlert(a)}>
            <div>
              <div className="flex items-center gap-2">
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${SEVERITY_COLORS[a.severity] ?? "bg-gray-900/30 text-gray-400"}`}>
                  {a.severity}
                </span>
                <span className="text-sm text-white">{a.title}</span>
              </div>
              {a.regulation && (
                <span className="text-[9px] text-[var(--dpf-muted)] mt-1">{a.regulation.shortName} · {a.regulation.jurisdiction}</span>
              )}
            </div>
            <span className="text-xs text-[var(--dpf-muted)]">{new Date(a.createdAt).toLocaleDateString()}</span>
          </div>
        ))}
      </div>

      <ComplianceModal open={!!selectedAlert} onClose={() => setSelectedAlert(null)} title="Review Alert">
        {selectedAlert && (
          <div className="space-y-4">
            <div>
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${SEVERITY_COLORS[selectedAlert.severity] ?? ""}`}>
                {selectedAlert.severity}
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#333] text-[var(--dpf-muted)] ml-2">{selectedAlert.alertType}</span>
            </div>
            {selectedAlert.description && <p className="text-sm text-white">{selectedAlert.description}</p>}
            {selectedAlert.suggestedAction && (
              <div className="p-3 rounded bg-[#222] border border-[var(--dpf-border)]">
                <p className="text-xs text-[var(--dpf-muted)] mb-1">Suggested Action</p>
                <p className="text-sm text-white">{selectedAlert.suggestedAction}</p>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <button onClick={() => handleDismiss(selectedAlert.id)} disabled={loading}
                className="px-3 py-1.5 text-xs text-[var(--dpf-muted)] hover:text-white disabled:opacity-50">
                Dismiss
              </button>
              <button onClick={() => handleReview(selectedAlert.id, "flagged-for-further-review")} disabled={loading}
                className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--dpf-border)] text-white hover:bg-[#333] disabled:opacity-50">
                Flag for Review
              </button>
              <button onClick={() => handleReview(selectedAlert.id, "regulation-updated")} disabled={loading}
                className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90 disabled:opacity-50">
                Mark Reviewed
              </button>
            </div>
          </div>
        )}
      </ComplianceModal>
    </>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/compliance/RegulatoryAlerts.tsx apps/web/components/compliance/ScanStatus.tsx
git commit -m "feat: add regulatory alert and scan status UI components

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Dashboard + Workspace Integration

**Files:**
- Modify: `apps/web/app/(shell)/compliance/page.tsx`
- Modify: `apps/web/app/(shell)/workspace/page.tsx`

- [ ] **Step 1: Add alert summary and scan status to compliance dashboard**

Read `apps/web/app/(shell)/compliance/page.tsx`. Add imports:

```tsx
import { RegulatoryAlerts } from "@/components/compliance/RegulatoryAlerts";
import { ScanStatus } from "@/components/compliance/ScanStatus";
```

Add queries to the existing `Promise.all`:

```ts
prisma.regulatoryAlert.findMany({
  where: { status: "pending" },
  include: { regulation: { select: { shortName: true, jurisdiction: true } } },
  orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
  take: 10,
}),
prisma.regulatoryMonitorScan.findFirst({
  orderBy: { startedAt: "desc" },
  select: { scanId: true, status: true, startedAt: true, regulationsChecked: true, alertsGenerated: true },
}),
```

Add destructured variables: `pendingAlerts`, `latestScan`.

Add new section AFTER the posture summary, BEFORE upcoming deadlines:

```tsx
{/* Regulatory Alerts */}
<section className="mb-8">
  <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">Regulatory Alerts</h2>
  <ScanStatus latestScan={latestScan} />
  <div className="mt-4">
    <RegulatoryAlerts alerts={pendingAlerts} />
  </div>
</section>
```

- [ ] **Step 2: Add pending alert count to workspace tile**

Read `apps/web/app/(shell)/workspace/page.tsx`. Add query:

```ts
prisma.regulatoryAlert.count({ where: { status: "pending" } }),
```

Add to compliance tile badge logic — if pendingAlertCount > 0, add or combine with existing badge:

```ts
const complianceBadgeItems: string[] = [];
if (overdueActionCount > 0) complianceBadgeItems.push(`${overdueActionCount} overdue`);
if (pendingAlertCount > 0) complianceBadgeItems.push(`${pendingAlertCount} alert${pendingAlertCount !== 1 ? "s" : ""}`);
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(shell)/compliance/page.tsx apps/web/app/(shell)/workspace/page.tsx
git commit -m "feat: add regulatory alerts to compliance dashboard and workspace tile

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: ScheduledJob Seed + Calendar

**Files:**
- Modify: seed script (find the existing seed file in `packages/db/`)

- [ ] **Step 1: Find and read the existing seed file**

Search for seed files: `packages/db/prisma/seed.ts` or `packages/db/seed.ts` or similar. Read it to understand the pattern.

- [ ] **Step 2: Add ScheduledJob upsert for regulatory-monitor**

Add to the seed script:

```ts
await prisma.scheduledJob.upsert({
  where: { jobId: "regulatory-monitor" },
  update: {},
  create: {
    jobId: "regulatory-monitor",
    name: "Monthly Regulatory Monitor Scan",
    schedule: "monthly",
    nextRunAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1), // first of next month
  },
});
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/
git commit -m "feat: seed regulatory monitor scheduled job (monthly)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Server Action Tests + Final Verification

**Files:**
- Create: `apps/web/lib/actions/regulatory-monitor.test.ts`

- [ ] **Step 1: Create test file**

Mock setup follows the compliance.test.ts pattern. Key tests:

1. **Auth:** manual scan rejects unauthorized users
2. **Concurrency:** scan rejects if one is already running
3. **Scan execution:** mock `callWithFailover` returns changed regulation → alert created
4. **Confidence filter:** low confidence change → no alert
5. **No change:** LLM says no change → no alert, sourceCheckDate updated
6. **Alert management:** reviewAlert sets status + resolution, dismissAlert shortcuts to dismissed
7. **createObligationFromAlert:** creates obligation and marks alert actioned
8. **Dashboard summary:** returns correct pending counts

Mock `callWithFailover` from `@/lib/ai-provider-priority`:

```ts
vi.mock("@/lib/ai-provider-priority", () => ({
  callWithFailover: vi.fn(),
}));
```

Mock the response as:

```ts
vi.mocked(callWithFailover).mockResolvedValue({
  content: JSON.stringify({
    hasChanged: true,
    confidence: "high",
    summary: "New breach notification deadline reduced to 48 hours",
    severity: "high",
    suggestedAction: "Update obligation OBL-GDPR-ART33",
  }),
  inputTokens: 100, outputTokens: 50, inferenceMs: 500,
  providerId: "test-provider", modelId: "test-model",
  downgraded: false, downgradeMessage: null,
} as never);
```

- [ ] **Step 2: Run tests**

Run: `cd apps/web && npx vitest run lib/actions/regulatory-monitor.test.ts lib/regulatory-monitor-types.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Run full test suite**

Run: `cd apps/web && npx vitest run lib/compliance-types.test.ts lib/actions/compliance.test.ts lib/policy-types.test.ts lib/actions/policy.test.ts lib/regulatory-monitor-types.test.ts lib/actions/regulatory-monitor.test.ts`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/actions/regulatory-monitor.test.ts
git commit -m "test: add regulatory monitor tests — scan, alerts, confidence filter

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Final verification**

```bash
git status
git log --oneline -10
```

Verify all files committed, no stray changes.
