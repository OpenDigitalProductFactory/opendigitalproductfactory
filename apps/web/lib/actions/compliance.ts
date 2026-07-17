"use server";

import { prisma, type Prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import {
  buildNextRegulationVersion,
  type RegulationVersionOverrides,
} from "@/lib/compliance-regulation-version";
import {
  type ComplianceActionResult,
  requireViewCompliance, requireManageCompliance,
  getSessionEmployeeId, logComplianceAction, ensureComplianceCalendarEvent,
} from "@/lib/actions/compliance-helpers";
// Do NOT re-export ComplianceActionResult from this "use server" module — a type
// re-export is enumerated into the runtime server-reference registry and throws
// `ReferenceError` at module eval (request-time 500, invisible to the build
// gate). It is imported above for internal use; callers import it from
// @/lib/actions/compliance-helpers directly.
import {
  generateRegulationId, generateObligationId, generateControlId,
  validateRegulationInput, validateObligationInput, validateControlInput,
  type RegulationInput, type ObligationInput, type ControlInput,
  type RiskAssessmentInput, type IncidentInput, type CorrectiveActionInput,
  type AuditInput, type FindingInput, type EvidenceInput, type SubmissionInput,
  type OnboardingInput,
} from "@/lib/compliance-types";
import {
  regulationCreateFields, regulationUpdateFields,
  obligationCreateFields, obligationUpdateFields,
  controlCreateFields, controlUpdateFields,
  riskAssessmentCreateFields, riskAssessmentUpdateFields,
  incidentCreateFields, incidentUpdateFields,
  correctiveActionCreateFields, correctiveActionUpdateFields,
  auditCreateFields, auditUpdateFields,
  auditFindingCreateFields, auditFindingUpdateFields,
  evidenceCreateFields, submissionCreateFields, submissionUpdateFields,
  mapRegulationSummaries,
} from "@/lib/compliance/compliance-core";

// ─── Regulation ─────────────────────────────────────────────────────────────

export async function listRegulations(filters?: { status?: string; jurisdiction?: string; sourceType?: string }) {
  await requireViewCompliance();
  return prisma.regulation.findMany({
    where: {
      ...(filters?.status && { status: filters.status }),
      ...(filters?.jurisdiction && { jurisdiction: filters.jurisdiction }),
      ...(filters?.sourceType && { sourceType: filters.sourceType }),
    },
    orderBy: { shortName: "asc" },
  });
}

export async function getRegulation(id: string) {
  await requireViewCompliance();
  return prisma.regulation.findUniqueOrThrow({
    where: { id },
    include: { obligations: { orderBy: { title: "asc" } } },
  });
}

export async function createRegulation(input: RegulationInput): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const error = validateRegulationInput(input);
  if (error) return { ok: false, message: error };

  const employeeId = await getSessionEmployeeId();

  const record = await prisma.regulation.create({
    data: {
      ...regulationCreateFields(input),
      ...(input.applicability != null && {
        applicability: input.applicability as unknown as Prisma.InputJsonValue,
      }),
    },
  });

  await logComplianceAction("regulation", record.id, "created", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: `Regulation ${input.shortName} created.`, id: record.id };
}

export async function updateRegulation(id: string, input: Partial<RegulationInput>): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.regulation.update({ where: { id }, data: {
    ...regulationUpdateFields(input),
    ...(input.applicability != null && {
      applicability: input.applicability as unknown as Prisma.InputJsonValue,
    }),
  }});

  await logComplianceAction("regulation", id, "updated", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Regulation updated." };
}

export async function deactivateRegulation(id: string): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.regulation.update({ where: { id }, data: { status: "inactive" } });
  await logComplianceAction("regulation", id, "status-changed", employeeId, null, { field: "status", newValue: "inactive" });
  revalidatePath("/compliance");
  return { ok: true, message: "Regulation deactivated." };
}

// Phase 4 — iterate a regulation as a governed new version: create an immutable
// next version linked to the prior row (previousVersionId), then retire the prior
// version (status="superseded"). The field-copy logic is unit-tested in
// buildNextRegulationVersion; this action only persists.
export async function supersedeRegulation(
  id: string,
  overrides: RegulationVersionOverrides,
): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  const prev = await prisma.regulation.findUniqueOrThrow({
    where: { id },
    select: {
      id: true, name: true, shortName: true, jurisdiction: true, industry: true,
      applicability: true, sourceType: true, sourceUrl: true, notes: true, version: true,
    },
  });
  const next = buildNextRegulationVersion(prev, overrides);

  const record = await prisma.regulation.create({
    data: {
      regulationId: generateRegulationId(),
      version: next.version,
      previousVersionId: next.previousVersionId,
      name: next.name,
      shortName: next.shortName,
      jurisdiction: next.jurisdiction,
      industry: next.industry,
      ...(next.applicability != null && {
        applicability: next.applicability as Prisma.InputJsonValue,
      }),
      sourceType: next.sourceType,
      sourceUrl: next.sourceUrl,
      notes: next.notes,
      effectiveDate: next.effectiveDate,
      reviewDate: next.reviewDate,
    },
  });
  await prisma.regulation.update({ where: { id }, data: { status: "superseded" } });

  await logComplianceAction(
    "regulation", record.id, "created", employeeId,
    `superseded ${prev.shortName} v${prev.version}`,
  );
  revalidatePath("/compliance");
  return { ok: true, message: `Created ${next.shortName} v${next.version}.`, id: record.id };
}

// ─── Obligation ─────────────────────────────────────────────────────────────

export async function listObligations(filters?: { regulationId?: string; category?: string; ownerEmployeeId?: string; status?: string }) {
  await requireViewCompliance();
  return prisma.obligation.findMany({
    where: {
      ...(filters?.regulationId && { regulationId: filters.regulationId }),
      ...(filters?.category && { category: filters.category }),
      ...(filters?.ownerEmployeeId && { ownerEmployeeId: filters.ownerEmployeeId }),
      ...(filters?.status ? { status: filters.status } : { status: "active" }),
    },
    include: {
      regulation: { select: { shortName: true, jurisdiction: true } },
      ownerEmployee: { select: { id: true, displayName: true } },
    },
    orderBy: { title: "asc" },
  });
}

export async function getObligation(id: string) {
  await requireViewCompliance();
  return prisma.obligation.findUniqueOrThrow({
    where: { id },
    include: {
      regulation: true,
      ownerEmployee: { select: { id: true, displayName: true } },
      controls: { include: { control: true } },
      evidence: { where: { status: "active" }, orderBy: { collectedAt: "desc" } },
    },
  });
}

export async function createObligation(input: ObligationInput): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const error = validateObligationInput(input);
  if (error) return { ok: false, message: error };

  const employeeId = await getSessionEmployeeId();
  const record = await prisma.obligation.create({
    data: obligationCreateFields(input),
  });

  await logComplianceAction("obligation", record.id, "created", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Obligation created.", id: record.id };
}

export async function updateObligation(id: string, input: Partial<ObligationInput>): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.obligation.update({ where: { id }, data: obligationUpdateFields(input) });

  await logComplianceAction("obligation", id, "updated", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Obligation updated." };
}

// ─── Control ────────────────────────────────────────────────────────────────

export async function listControls(filters?: { controlType?: string; implementationStatus?: string; effectiveness?: string; ownerEmployeeId?: string }) {
  await requireViewCompliance();
  return prisma.control.findMany({
    where: {
      status: "active",
      ...(filters?.controlType && { controlType: filters.controlType }),
      ...(filters?.implementationStatus && { implementationStatus: filters.implementationStatus }),
      ...(filters?.effectiveness && { effectiveness: filters.effectiveness }),
      ...(filters?.ownerEmployeeId && { ownerEmployeeId: filters.ownerEmployeeId }),
    },
    include: {
      ownerEmployee: { select: { id: true, displayName: true } },
      _count: { select: { obligations: true } },
    },
    orderBy: { title: "asc" },
  });
}

export async function getControl(id: string) {
  await requireViewCompliance();
  return prisma.control.findUniqueOrThrow({
    where: { id },
    include: {
      ownerEmployee: { select: { id: true, displayName: true } },
      obligations: {
        include: {
          obligation: {
            select: {
              id: true,
              title: true,
              obligationId: true,
              // Phase 2 — control consolidation: the obligation's regulation lets
              // the detail page show "1 control → N obligations → M frameworks".
              regulation: { select: { id: true, regulationId: true, shortName: true } },
            },
          },
        },
      },
      evidence: { where: { status: "active" }, orderBy: { collectedAt: "desc" } },
      riskAssessments: { include: { riskAssessment: { select: { id: true, title: true, assessmentId: true } } } },
    },
  });
}

export async function createControl(input: ControlInput): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const error = validateControlInput(input);
  if (error) return { ok: false, message: error };

  const employeeId = await getSessionEmployeeId();
  const record = await prisma.control.create({
    data: controlCreateFields(input),
  });

  await logComplianceAction("control", record.id, "created", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Control created.", id: record.id };
}

export async function updateControl(id: string, input: Partial<ControlInput>): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.control.update({ where: { id }, data: controlUpdateFields(input) });

  await logComplianceAction("control", id, "updated", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Control updated." };
}

// ─── Control ↔ Obligation Linking ───────────────────────────────────────────

export async function linkControlToObligation(controlId: string, obligationId: string, notes?: string): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  const existing = await prisma.controlObligationLink.findUnique({
    where: { controlId_obligationId: { controlId, obligationId } },
  });
  if (existing) return { ok: false, message: "Link already exists." };

  await prisma.controlObligationLink.create({ data: { controlId, obligationId, notes: notes ?? null } });
  await logComplianceAction("control", controlId, "linked", employeeId, null, { notes: `Linked to obligation ${obligationId}` });
  revalidatePath("/compliance");
  return { ok: true, message: "Control linked to obligation." };
}

export async function unlinkControlFromObligation(controlId: string, obligationId: string): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.controlObligationLink.delete({
    where: { controlId_obligationId: { controlId, obligationId } },
  });
  await logComplianceAction("control", controlId, "unlinked", employeeId, null, { notes: `Unlinked from obligation ${obligationId}` });
  revalidatePath("/compliance");
  return { ok: true, message: "Link removed." };
}

// ─── Risk Assessment ────────────────────────────────────────────────────────

export async function listRiskAssessments(filters?: { inherentRisk?: string; status?: string; assessedByEmployeeId?: string }) {
  await requireViewCompliance();
  return prisma.riskAssessment.findMany({
    where: {
      ...(filters?.status ? { status: filters.status } : { status: "active" }),
      ...(filters?.inherentRisk && { inherentRisk: filters.inherentRisk }),
      ...(filters?.assessedByEmployeeId && { assessedByEmployeeId: filters.assessedByEmployeeId }),
    },
    include: {
      assessedBy: { select: { id: true, displayName: true } },
      _count: { select: { controls: true, incidents: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getRiskAssessment(id: string) {
  await requireViewCompliance();
  return prisma.riskAssessment.findUniqueOrThrow({
    where: { id },
    include: {
      assessedBy: { select: { id: true, displayName: true } },
      controls: { include: { control: { select: { id: true, title: true, controlId: true } } } },
      incidents: { orderBy: { occurredAt: "desc" } },
    },
  });
}

export async function createRiskAssessment(input: RiskAssessmentInput): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  if (!input.title.trim()) return { ok: false, message: "Title is required." };

  const employeeId = await getSessionEmployeeId();
  const record = await prisma.riskAssessment.create({
    data: riskAssessmentCreateFields(input, employeeId),
  });

  await logComplianceAction("risk-assessment", record.id, "created", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Risk assessment created.", id: record.id };
}

export async function updateRiskAssessment(id: string, input: Partial<RiskAssessmentInput>): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.riskAssessment.update({ where: { id }, data: riskAssessmentUpdateFields(input) });

  await logComplianceAction("risk-assessment", id, "updated", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Risk assessment updated." };
}

export async function linkRiskToControl(riskAssessmentId: string, controlId: string, notes?: string): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  const existing = await prisma.riskControl.findUnique({
    where: { riskAssessmentId_controlId: { riskAssessmentId, controlId } },
  });
  if (existing) return { ok: false, message: "Link already exists." };

  await prisma.riskControl.create({ data: { riskAssessmentId, controlId, mitigationNotes: notes ?? null } });
  await logComplianceAction("risk-assessment", riskAssessmentId, "linked", employeeId, null, { notes: `Linked to control ${controlId}` });
  revalidatePath("/compliance");
  return { ok: true, message: "Risk linked to control." };
}

export async function unlinkRiskFromControl(riskAssessmentId: string, controlId: string): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.riskControl.delete({ where: { riskAssessmentId_controlId: { riskAssessmentId, controlId } } });
  await logComplianceAction("risk-assessment", riskAssessmentId, "unlinked", employeeId, null, { notes: `Unlinked from control ${controlId}` });
  revalidatePath("/compliance");
  return { ok: true, message: "Link removed." };
}

// ─── Incident ───────────────────────────────────────────────────────────────

export async function listIncidents(filters?: { severity?: string; status?: string; category?: string; regulatoryNotifiable?: boolean; reportedByEmployeeId?: string }) {
  await requireViewCompliance();
  return prisma.complianceIncident.findMany({
    where: {
      ...(filters?.severity && { severity: filters.severity }),
      ...(filters?.status && { status: filters.status }),
      ...(filters?.category && { category: filters.category }),
      ...(filters?.regulatoryNotifiable !== undefined && { regulatoryNotifiable: filters.regulatoryNotifiable }),
      ...(filters?.reportedByEmployeeId && { reportedByEmployeeId: filters.reportedByEmployeeId }),
    },
    include: {
      reportedBy: { select: { id: true, displayName: true } },
      _count: { select: { correctiveActions: true } },
    },
    orderBy: { occurredAt: "desc" },
  });
}

export async function getIncident(id: string) {
  await requireViewCompliance();
  return prisma.complianceIncident.findUniqueOrThrow({
    where: { id },
    include: {
      reportedBy: { select: { id: true, displayName: true } },
      riskAssessment: { select: { id: true, title: true, assessmentId: true } },
      correctiveActions: { orderBy: { createdAt: "desc" } },
    },
  });
}

export async function createIncident(input: IncidentInput): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  if (!input.title.trim()) return { ok: false, message: "Title is required." };

  const employeeId = await getSessionEmployeeId();
  const record = await prisma.complianceIncident.create({
    data: incidentCreateFields(input, employeeId),
  });

  // Auto-create calendar deadline for notifiable incidents
  if (input.regulatoryNotifiable && input.notificationDeadline && employeeId) {
    await ensureComplianceCalendarEvent(
      "incident-notification", record.id,
      `REGULATORY NOTIFICATION: ${input.title}`,
      input.notificationDeadline, employeeId,
    );
  }

  await logComplianceAction("incident", record.id, "created", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Incident recorded.", id: record.id };
}

export async function updateIncident(id: string, input: Partial<IncidentInput> & { notifiedAt?: Date | null }): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.complianceIncident.update({ where: { id }, data: incidentUpdateFields(input) });

  await logComplianceAction("incident", id, "updated", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Incident updated." };
}

// ─── Corrective Action ──────────────────────────────────────────────────────

export async function listCorrectiveActions(filters?: { status?: string; sourceType?: string; ownerEmployeeId?: string; overdue?: boolean }) {
  await requireViewCompliance();
  return prisma.correctiveAction.findMany({
    where: {
      ...(filters?.sourceType && { sourceType: filters.sourceType }),
      ...(filters?.ownerEmployeeId && { ownerEmployeeId: filters.ownerEmployeeId }),
      ...(filters?.status && { status: filters.status }),
      ...(filters?.overdue && { status: { in: ["open", "in-progress"] }, dueDate: { lt: new Date() } }),
    },
    include: {
      owner: { select: { id: true, displayName: true } },
      incident: { select: { id: true, title: true, incidentId: true } },
      auditFinding: { select: { id: true, title: true, findingId: true } },
    },
    orderBy: { dueDate: "asc" },
  });
}

export async function getCorrectiveAction(id: string) {
  await requireViewCompliance();
  return prisma.correctiveAction.findUniqueOrThrow({
    where: { id },
    include: {
      owner: { select: { id: true, displayName: true } },
      verifiedBy: { select: { id: true, displayName: true } },
      incident: true,
      auditFinding: true,
    },
  });
}

export async function createCorrectiveAction(input: CorrectiveActionInput): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  if (!input.title.trim()) return { ok: false, message: "Title is required." };

  const employeeId = await getSessionEmployeeId();
  const record = await prisma.correctiveAction.create({
    data: correctiveActionCreateFields(input, employeeId),
  });

  await logComplianceAction("corrective-action", record.id, "created", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Corrective action created.", id: record.id };
}

export async function updateCorrectiveAction(id: string, input: Partial<CorrectiveActionInput> & { status?: string; completedAt?: Date | null }): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.correctiveAction.update({ where: { id }, data: correctiveActionUpdateFields(input) });

  await logComplianceAction("corrective-action", id, "updated", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Corrective action updated." };
}

export async function verifyCorrectiveAction(
  id: string, verifiedByEmployeeId: string, method: string,
): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.correctiveAction.update({ where: { id }, data: {
    verificationMethod: method,
    verificationDate: new Date(),
    verifiedByEmployeeId,
    status: "verified",
  }});

  await logComplianceAction("corrective-action", id, "status-changed", employeeId, null, {
    field: "status", oldValue: "completed", newValue: "verified",
    notes: `Verified by ${verifiedByEmployeeId} — method: ${method}`,
  });
  revalidatePath("/compliance");
  return { ok: true, message: "Corrective action verified." };
}

// ─── Audit ──────────────────────────────────────────────────────────────────

export async function listAudits(filters?: { auditType?: string; status?: string; auditorEmployeeId?: string }) {
  await requireViewCompliance();
  return prisma.complianceAudit.findMany({
    where: {
      ...(filters?.auditType && { auditType: filters.auditType }),
      ...(filters?.status && { status: filters.status }),
      ...(filters?.auditorEmployeeId && { auditorEmployeeId: filters.auditorEmployeeId }),
    },
    include: {
      auditor: { select: { id: true, displayName: true } },
      _count: { select: { findings: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getAudit(id: string) {
  await requireViewCompliance();
  return prisma.complianceAudit.findUniqueOrThrow({
    where: { id },
    include: {
      auditor: { select: { id: true, displayName: true } },
      findings: { include: { control: { select: { id: true, title: true, controlId: true } } }, orderBy: { createdAt: "desc" } },
    },
  });
}

export async function createAudit(input: AuditInput): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  if (!input.title.trim()) return { ok: false, message: "Title is required." };

  const employeeId = await getSessionEmployeeId();
  const record = await prisma.complianceAudit.create({
    data: auditCreateFields(input),
  });

  if (input.scheduledAt && employeeId) {
    await ensureComplianceCalendarEvent("audit", record.id, `Audit: ${input.title}`, input.scheduledAt, employeeId);
  }

  await logComplianceAction("audit", record.id, "created", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Audit created.", id: record.id };
}

export async function updateAudit(id: string, input: Partial<AuditInput> & { status?: string; conductedAt?: Date | null; completedAt?: Date | null; overallRating?: string | null }): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.complianceAudit.update({ where: { id }, data: auditUpdateFields(input) });

  await logComplianceAction("audit", id, "updated", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Audit updated." };
}

export async function createAuditFinding(auditId: string, input: FindingInput): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  if (!input.title.trim()) return { ok: false, message: "Title is required." };

  const employeeId = await getSessionEmployeeId();
  const record = await prisma.auditFinding.create({
    data: auditFindingCreateFields(auditId, input),
  });

  await logComplianceAction("finding", record.id, "created", employeeId, null, { notes: `In audit ${auditId}` });
  revalidatePath("/compliance");
  return { ok: true, message: "Finding recorded.", id: record.id };
}

export async function updateAuditFinding(id: string, input: Partial<FindingInput> & { status?: string; resolvedAt?: Date | null }): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.auditFinding.update({ where: { id }, data: auditFindingUpdateFields(input) });

  await logComplianceAction("finding", id, "updated", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Finding updated." };
}

// ─── Evidence (Immutable) ───────────────────────────────────────────────────

export async function listEvidence(filters?: { evidenceType?: string; obligationId?: string; controlId?: string; status?: string }) {
  await requireViewCompliance();
  return prisma.complianceEvidence.findMany({
    where: {
      ...(filters?.evidenceType && { evidenceType: filters.evidenceType }),
      ...(filters?.obligationId && { obligationId: filters.obligationId }),
      ...(filters?.controlId && { controlId: filters.controlId }),
      ...(filters?.status ? { status: filters.status } : { status: "active" }),
    },
    include: {
      obligation: { select: { id: true, title: true, obligationId: true } },
      control: { select: { id: true, title: true, controlId: true } },
      collectedBy: { select: { id: true, displayName: true } },
    },
    orderBy: { collectedAt: "desc" },
  });
}

export async function getEvidence(id: string) {
  await requireViewCompliance();
  return prisma.complianceEvidence.findUniqueOrThrow({
    where: { id },
    include: {
      obligation: true,
      control: true,
      collectedBy: { select: { id: true, displayName: true } },
      supersededBy: { select: { id: true, evidenceId: true, title: true } },
    },
  });
}

export async function createEvidence(input: EvidenceInput): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  if (!input.title.trim()) return { ok: false, message: "Title is required." };

  const employeeId = await getSessionEmployeeId();
  const record = await prisma.complianceEvidence.create({
    data: evidenceCreateFields(input, employeeId),
  });

  await logComplianceAction("evidence", record.id, "created", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Evidence recorded.", id: record.id };
}

// No updateEvidence — evidence is immutable. Use supersedeEvidence instead.

export async function supersedeEvidence(existingId: string, newInput: EvidenceInput): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  const newRecord = await prisma.$transaction(async (tx) => {
    const created = await tx.complianceEvidence.create({
      data: evidenceCreateFields(newInput, employeeId),
    });
    await tx.complianceEvidence.update({
      where: { id: existingId },
      data: { status: "superseded", supersededById: created.id },
    });
    return created;
  });

  await logComplianceAction("evidence", newRecord.id, "created", employeeId, null, { notes: `Supersedes ${existingId}` });
  await logComplianceAction("evidence", existingId, "superseded", employeeId, null, { field: "status", newValue: "superseded" });
  revalidatePath("/compliance");
  return { ok: true, message: "Evidence superseded.", id: newRecord.id };
}

// ─── Regulatory Submission ──────────────────────────────────────────────────

export async function listSubmissions(filters?: { status?: string; submissionType?: string; submittedByEmployeeId?: string }) {
  await requireViewCompliance();
  return prisma.regulatorySubmission.findMany({
    where: {
      ...(filters?.status && { status: filters.status }),
      ...(filters?.submissionType && { submissionType: filters.submissionType }),
      ...(filters?.submittedByEmployeeId && { submittedByEmployeeId: filters.submittedByEmployeeId }),
    },
    include: {
      regulation: { select: { id: true, shortName: true } },
      submittedBy: { select: { id: true, displayName: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function createSubmission(input: SubmissionInput): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  if (!input.title.trim()) return { ok: false, message: "Title is required." };

  const employeeId = await getSessionEmployeeId();
  const record = await prisma.regulatorySubmission.create({
    data: submissionCreateFields(input, employeeId),
  });

  if (input.dueDate && employeeId) {
    await ensureComplianceCalendarEvent("submission", record.id, `Submission due: ${input.title}`, input.dueDate, employeeId);
  }

  await logComplianceAction("submission", record.id, "created", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Submission created.", id: record.id };
}

export async function updateSubmission(id: string, input: Partial<SubmissionInput> & { status?: string; submittedAt?: Date | null; confirmationRef?: string | null; responseReceived?: boolean; responseDate?: Date | null; responseSummary?: string | null }): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.regulatorySubmission.update({ where: { id }, data: submissionUpdateFields(input) });

  await logComplianceAction("submission", id, "updated", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Submission updated." };
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

export async function getComplianceDashboard() {
  await requireViewCompliance();

  const [
    obligationCount,
    implementedControlCount,
    totalControlCount,
    openIncidentCount,
    overdueActionCount,
    upcomingDeadlines,
    recentActivity,
    regulations,
  ] = await Promise.all([
    prisma.obligation.count({ where: { status: "active" } }),
    prisma.control.count({ where: { implementationStatus: "implemented", status: "active" } }),
    prisma.control.count({ where: { status: "active" } }),
    prisma.complianceIncident.count({ where: { status: { in: ["open", "investigating"] } } }),
    prisma.correctiveAction.count({ where: { status: { in: ["open", "in-progress"] }, dueDate: { lt: new Date() } } }),
    prisma.calendarEvent.findMany({
      where: { complianceEntityType: { not: null }, startAt: { gte: new Date() } },
      orderBy: { startAt: "asc" },
      take: 5,
    }),
    prisma.complianceAuditLog.findMany({
      orderBy: { performedAt: "desc" },
      take: 10,
      include: { performedBy: { select: { displayName: true } } },
    }),
    prisma.regulation.findMany({
      where: { status: "active" },
      include: { _count: { select: { obligations: true } } },
    }),
  ]);

  return {
    obligationCount,
    controlCoverage: { implemented: implementedControlCount, total: totalControlCount },
    openIncidentCount,
    overdueActionCount,
    upcomingDeadlines,
    recentActivity,
    regulationSummaries: mapRegulationSummaries(regulations),
  };
}

// ─── Onboarding ──────────────────────────────────────────────────────────────

export async function onboardRegulation(input: OnboardingInput): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const error = validateRegulationInput(input.regulation);
  if (error) return { ok: false, message: error };

  const employeeId = await getSessionEmployeeId();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const regulation = await tx.regulation.create({
        data: {
          regulationId: generateRegulationId(),
          name: input.regulation.name.trim(),
          shortName: input.regulation.shortName.trim(),
          jurisdiction: input.regulation.jurisdiction.trim(),
          industry: input.regulation.industry ?? null,
          sourceType: input.regulation.sourceType ?? "external",
          effectiveDate: input.regulation.effectiveDate ?? null,
          reviewDate: input.regulation.reviewDate ?? null,
          sourceUrl: input.regulation.sourceUrl ?? null,
          notes: input.regulation.notes ?? null,
        },
      });

      const obligations = [];
      for (const obl of input.obligations) {
        const record = await tx.obligation.create({
          data: {
            obligationId: generateObligationId(),
            regulationId: regulation.id,
            title: obl.title.trim(),
            description: obl.description ?? null,
            reference: obl.reference ?? null,
            category: obl.category ?? "other",
            frequency: obl.frequency ?? null,
            applicability: obl.applicability ?? null,
          },
        });
        obligations.push(record);
      }

      if (input.controls?.length) {
        for (const ctrl of input.controls) {
          const control = await tx.control.create({
            data: {
              controlId: generateControlId(),
              title: ctrl.title.trim(),
              controlType: ctrl.controlType,
              implementationStatus: "planned",
            },
          });
          for (const idx of ctrl.linkedObligationIndices) {
            const obl = obligations[idx];
            if (obl) {
              await tx.controlObligationLink.create({
                data: { controlId: control.id, obligationId: obl.id },
              });
            }
          }
        }
      }

      return { regulationId: regulation.regulationId, id: regulation.id, obligationCount: obligations.length };
    });

    await logComplianceAction("regulation", result.id, "onboarded", employeeId, null);
    revalidatePath("/compliance");
    return {
      ok: true,
      message: `Onboarded ${input.regulation.shortName} with ${result.obligationCount} obligations.`,
      id: result.id,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Onboarding failed." };
  }
}
