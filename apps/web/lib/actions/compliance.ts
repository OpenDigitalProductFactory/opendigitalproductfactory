"use server";

import * as crypto from "crypto";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import {
  generateRegulationId, generateObligationId, generateControlId,
  generateAssessmentId, generateIncidentId, generateActionId,
  validateRegulationInput, validateObligationInput, validateControlInput,
  type RegulationInput, type ObligationInput, type ControlInput,
  type RiskAssessmentInput, type IncidentInput, type CorrectiveActionInput,
} from "@/lib/compliance-types";

export type ComplianceActionResult = { ok: boolean; message: string; id?: string };

async function requireViewCompliance() {
  const session = await auth();
  if (!session?.user || !can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "view_compliance")) {
    throw new Error("Unauthorized");
  }
  return session.user;
}

async function requireManageCompliance() {
  const session = await auth();
  if (!session?.user || !can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "manage_compliance")) {
    throw new Error("Unauthorized");
  }
  return session.user;
}

async function getSessionEmployeeId(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const profile = await prisma.employeeProfile.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  return profile?.id ?? null;
}

async function logComplianceAction(
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

// ─── Calendar Integration ───────────────────────────────────────────────────

async function ensureComplianceCalendarEvent(
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
  const regulationId = generateRegulationId();

  const record = await prisma.regulation.create({
    data: {
      regulationId,
      name: input.name.trim(),
      shortName: input.shortName.trim(),
      jurisdiction: input.jurisdiction.trim(),
      industry: input.industry ?? null,
      sourceType: input.sourceType ?? "external",
      effectiveDate: input.effectiveDate ?? null,
      reviewDate: input.reviewDate ?? null,
      sourceUrl: input.sourceUrl ?? null,
      notes: input.notes ?? null,
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
    ...(input.name !== undefined && { name: input.name.trim() }),
    ...(input.shortName !== undefined && { shortName: input.shortName.trim() }),
    ...(input.jurisdiction !== undefined && { jurisdiction: input.jurisdiction.trim() }),
    ...(input.industry !== undefined && { industry: input.industry }),
    ...(input.sourceType !== undefined && { sourceType: input.sourceType }),
    ...(input.effectiveDate !== undefined && { effectiveDate: input.effectiveDate }),
    ...(input.reviewDate !== undefined && { reviewDate: input.reviewDate }),
    ...(input.sourceUrl !== undefined && { sourceUrl: input.sourceUrl }),
    ...(input.notes !== undefined && { notes: input.notes }),
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
    data: {
      obligationId: generateObligationId(),
      regulationId: input.regulationId,
      title: input.title.trim(),
      description: input.description ?? null,
      reference: input.reference ?? null,
      category: input.category ?? null,
      frequency: input.frequency ?? null,
      applicability: input.applicability ?? null,
      penaltySummary: input.penaltySummary ?? null,
      ownerEmployeeId: input.ownerEmployeeId ?? null,
      reviewDate: input.reviewDate ?? null,
    },
  });

  await logComplianceAction("obligation", record.id, "created", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Obligation created.", id: record.id };
}

export async function updateObligation(id: string, input: Partial<ObligationInput>): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.obligation.update({ where: { id }, data: {
    ...(input.title !== undefined && { title: input.title.trim() }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.reference !== undefined && { reference: input.reference }),
    ...(input.category !== undefined && { category: input.category }),
    ...(input.frequency !== undefined && { frequency: input.frequency }),
    ...(input.applicability !== undefined && { applicability: input.applicability }),
    ...(input.penaltySummary !== undefined && { penaltySummary: input.penaltySummary }),
    ...(input.ownerEmployeeId !== undefined && { ownerEmployeeId: input.ownerEmployeeId }),
    ...(input.reviewDate !== undefined && { reviewDate: input.reviewDate }),
  }});

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
      obligations: { include: { obligation: { select: { id: true, title: true, obligationId: true } } } },
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
    data: {
      controlId: generateControlId(),
      title: input.title.trim(),
      controlType: input.controlType,
      description: input.description ?? null,
      implementationStatus: input.implementationStatus ?? "planned",
      ownerEmployeeId: input.ownerEmployeeId ?? null,
      reviewFrequency: input.reviewFrequency ?? null,
      nextReviewDate: input.nextReviewDate ?? null,
      effectiveness: input.effectiveness ?? null,
    },
  });

  await logComplianceAction("control", record.id, "created", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Control created.", id: record.id };
}

export async function updateControl(id: string, input: Partial<ControlInput>): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.control.update({ where: { id }, data: {
    ...(input.title !== undefined && { title: input.title.trim() }),
    ...(input.controlType !== undefined && { controlType: input.controlType }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.implementationStatus !== undefined && { implementationStatus: input.implementationStatus }),
    ...(input.ownerEmployeeId !== undefined && { ownerEmployeeId: input.ownerEmployeeId }),
    ...(input.reviewFrequency !== undefined && { reviewFrequency: input.reviewFrequency }),
    ...(input.nextReviewDate !== undefined && { nextReviewDate: input.nextReviewDate }),
    ...(input.effectiveness !== undefined && { effectiveness: input.effectiveness }),
  }});

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
    data: {
      assessmentId: generateAssessmentId(),
      title: input.title.trim(),
      hazard: input.hazard.trim(),
      likelihood: input.likelihood,
      severity: input.severity,
      inherentRisk: input.inherentRisk,
      scope: input.scope ?? null,
      residualRisk: input.residualRisk ?? null,
      assessedByEmployeeId: input.assessedByEmployeeId ?? employeeId,
      nextReviewDate: input.nextReviewDate ?? null,
      notes: input.notes ?? null,
    },
  });

  await logComplianceAction("risk-assessment", record.id, "created", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Risk assessment created.", id: record.id };
}

export async function updateRiskAssessment(id: string, input: Partial<RiskAssessmentInput>): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.riskAssessment.update({ where: { id }, data: {
    ...(input.title !== undefined && { title: input.title.trim() }),
    ...(input.hazard !== undefined && { hazard: input.hazard.trim() }),
    ...(input.likelihood !== undefined && { likelihood: input.likelihood }),
    ...(input.severity !== undefined && { severity: input.severity }),
    ...(input.inherentRisk !== undefined && { inherentRisk: input.inherentRisk }),
    ...(input.scope !== undefined && { scope: input.scope }),
    ...(input.residualRisk !== undefined && { residualRisk: input.residualRisk }),
    ...(input.assessedByEmployeeId !== undefined && { assessedByEmployeeId: input.assessedByEmployeeId }),
    ...(input.nextReviewDate !== undefined && { nextReviewDate: input.nextReviewDate }),
    ...(input.notes !== undefined && { notes: input.notes }),
  }});

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
    data: {
      incidentId: generateIncidentId(),
      title: input.title.trim(),
      description: input.description ?? null,
      occurredAt: input.occurredAt,
      detectedAt: input.detectedAt ?? null,
      severity: input.severity,
      category: input.category ?? null,
      regulatoryNotifiable: input.regulatoryNotifiable ?? false,
      notificationDeadline: input.notificationDeadline ?? null,
      rootCause: input.rootCause ?? null,
      riskAssessmentId: input.riskAssessmentId ?? null,
      reportedByEmployeeId: input.reportedByEmployeeId ?? employeeId,
    },
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

  await prisma.complianceIncident.update({ where: { id }, data: {
    ...(input.title !== undefined && { title: input.title.trim() }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.severity !== undefined && { severity: input.severity }),
    ...(input.category !== undefined && { category: input.category }),
    ...(input.regulatoryNotifiable !== undefined && { regulatoryNotifiable: input.regulatoryNotifiable }),
    ...(input.notificationDeadline !== undefined && { notificationDeadline: input.notificationDeadline }),
    ...(input.notifiedAt !== undefined && { notifiedAt: input.notifiedAt }),
    ...(input.rootCause !== undefined && { rootCause: input.rootCause }),
    ...(input.riskAssessmentId !== undefined && { riskAssessmentId: input.riskAssessmentId }),
  }});

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
    data: {
      actionId: generateActionId(),
      title: input.title.trim(),
      description: input.description ?? null,
      rootCause: input.rootCause ?? null,
      sourceType: input.sourceType,
      incidentId: input.incidentId ?? null,
      auditFindingId: input.auditFindingId ?? null,
      ownerEmployeeId: input.ownerEmployeeId ?? employeeId,
      dueDate: input.dueDate ?? null,
    },
  });

  await logComplianceAction("corrective-action", record.id, "created", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Corrective action created.", id: record.id };
}

export async function updateCorrectiveAction(id: string, input: Partial<CorrectiveActionInput> & { status?: string; completedAt?: Date | null }): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.correctiveAction.update({ where: { id }, data: {
    ...(input.title !== undefined && { title: input.title.trim() }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.rootCause !== undefined && { rootCause: input.rootCause }),
    ...(input.ownerEmployeeId !== undefined && { ownerEmployeeId: input.ownerEmployeeId }),
    ...(input.dueDate !== undefined && { dueDate: input.dueDate }),
    ...(input.status !== undefined && { status: input.status }),
    ...(input.completedAt !== undefined && { completedAt: input.completedAt }),
  }});

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
