"use server";

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import {
  type ComplianceActionResult,
  requireViewCompliance, requireManageCompliance,
  getSessionEmployeeId, logComplianceAction,
} from "@/lib/actions/compliance-helpers";
import { validateAlertResolution } from "@/lib/regulatory-monitor-types";
import { runRegulatoryMonitorScan } from "@/lib/govern/regulatory-monitor-scan-run";

// ─── Scan Execution ─────────────────────────────────────────────────────────

export async function triggerRegulatoryMonitorScan(
  triggeredBy: "scheduled" | "manual",
): Promise<ComplianceActionResult> {
  // The scan body lives in a non-action runner (BI-DA37A602) so the scheduled
  // inngest job can call it without the queue importing the actions layer. This
  // wrapper keeps the request-only revalidatePath the operator "Run Scan Now"
  // path needs; the auth check and the scan itself run inside the runner.
  const result = await runRegulatoryMonitorScan(triggeredBy);
  if (result.ok) {
    revalidatePath("/compliance");
  }
  return result;
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
