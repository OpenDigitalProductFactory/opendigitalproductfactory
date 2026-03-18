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
  type LLMScanResponse, validateAlertResolution,
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

  // Concurrency guard
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

  try {
    for (const reg of regulations) {
      try {
        const prompt = buildScanPrompt(reg);
        const messages: ChatMessage[] = [{ role: "user", content: prompt }];

        const result = await callWithFailover(
          messages,
          "You are a regulatory compliance monitoring assistant. Respond only in valid JSON.",
          "internal",
        );

        let parsed: LLMScanResponse;
        try {
          parsed = JSON.parse(result.content) as LLMScanResponse;
        } catch {
          summaryParts.push(`${reg.shortName}: Failed to parse LLM response`);
          checked++;
          continue;
        }

        await prisma.regulation.update({
          where: { id: reg.id },
          data: { sourceCheckDate: new Date() },
        });

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

    // Auto-capture compliance snapshot after scan
    try {
      const { takeComplianceSnapshot } = await import("@/lib/actions/reporting");
      await takeComplianceSnapshot("scan-complete");
    } catch {
      // Snapshot failure shouldn't fail the scan
    }
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

  // Calendar event for next month's scan
  if (employeeId) {
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1, 1);
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

  // Clear changeDetected if no more pending alerts for this regulation
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
    field: "resolution", newValue: resolution, ...(notes ? { notes } : {}),
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

  await logComplianceAction("regulatory-alert", id, "dismissed", employeeId, null, notes ? { notes } : {});
  revalidatePath("/compliance");
  return { ok: true, message: "Alert dismissed." };
}

export async function createObligationFromAlert(
  alertId: string,
  obligationInput: { title: string; regulationId: string; description?: string; reference?: string; category?: string },
): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  const { createObligation } = await import("@/lib/actions/compliance");
  const result = await createObligation({
    title: obligationInput.title,
    regulationId: obligationInput.regulationId,
    description: obligationInput.description ?? null,
    reference: obligationInput.reference ?? null,
    category: obligationInput.category ?? null,
  });

  if (!result.ok) return result;

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
