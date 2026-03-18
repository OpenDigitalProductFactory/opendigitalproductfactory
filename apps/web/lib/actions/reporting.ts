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
  isValidSubmissionTransition,
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

// ─── Submission Enhancement ─────────────────────────────────────────────────

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
