// apps/web/lib/compliance/compliance-core.ts
//
// Pure (no prisma / auth / Next.js) domain helpers extracted from
// lib/actions/compliance.ts (BI-OPT-FAT-ACTIONS, Compliance slice). These
// functions are side-effect-free shape/transform/mapping and projection
// builders — each maps a validated *Input into the plain field-map that a
// prisma create/update write expects, and the dashboard projection maps
// already-fetched rows into their view shape. Behavior-preserving relocation —
// identical field maps, mirroring the EA slice (ea-core.ts), the CRM slice, the
// Build slice (build-actions-core.ts / businessBriefJsonPayload), and the
// platform-dev-config slice.
//
// Orchestration (auth() checks, prisma, $transaction, revalidatePath, the
// calendar/audit-log side effects, the "use server" wrappers) STAYS in
// lib/actions/compliance.ts and imports these helpers back. The prisma-typed
// JSON casts (Regulation.applicability -> Prisma.InputJsonValue) stay at the
// call sites so this module carries no @dpf/db value/type coupling.

import {
  generateRegulationId, generateObligationId, generateControlId,
  generateAssessmentId, generateIncidentId, generateActionId,
  generateAuditId, generateFindingId, generateEvidenceId, generateSubmissionId,
  type RegulationInput, type ObligationInput, type ControlInput,
  type RiskAssessmentInput, type IncidentInput, type CorrectiveActionInput,
  type AuditInput, type FindingInput, type EvidenceInput, type SubmissionInput,
} from "@/lib/compliance-types";

// ─── Regulation ─────────────────────────────────────────────────────────────

/**
 * Field map for a Regulation create. The prisma-typed `applicability` JSON
 * conditional stays at the call site; everything else is a pure trim/normalize.
 */
export function regulationCreateFields(input: RegulationInput) {
  return {
    regulationId: generateRegulationId(),
    name: input.name.trim(),
    shortName: input.shortName.trim(),
    jurisdiction: input.jurisdiction.trim(),
    industry: input.industry ?? null,
    sourceType: input.sourceType ?? "external",
    effectiveDate: input.effectiveDate ?? null,
    reviewDate: input.reviewDate ?? null,
    sourceUrl: input.sourceUrl ?? null,
    notes: input.notes ?? null,
  };
}

/** Conditional-spread field map for a Regulation update (applicability JSON
 * conditional stays at the call site). */
export function regulationUpdateFields(input: Partial<RegulationInput>) {
  return {
    ...(input.name !== undefined && { name: input.name.trim() }),
    ...(input.shortName !== undefined && { shortName: input.shortName.trim() }),
    ...(input.jurisdiction !== undefined && { jurisdiction: input.jurisdiction.trim() }),
    ...(input.industry !== undefined && { industry: input.industry }),
    ...(input.sourceType !== undefined && { sourceType: input.sourceType }),
    ...(input.effectiveDate !== undefined && { effectiveDate: input.effectiveDate }),
    ...(input.reviewDate !== undefined && { reviewDate: input.reviewDate }),
    ...(input.sourceUrl !== undefined && { sourceUrl: input.sourceUrl }),
    ...(input.notes !== undefined && { notes: input.notes }),
  };
}

// ─── Obligation ─────────────────────────────────────────────────────────────

export function obligationCreateFields(input: ObligationInput) {
  return {
    obligationId: generateObligationId(),
    regulationId: input.regulationId,
    title: input.title.trim(),
    description: input.description ?? null,
    reference: input.reference ?? null,
    category: input.category ?? null,
    frequency: input.frequency ?? null,
    applicability: input.applicability ?? null,
    deliverableType: input.deliverableType ?? null,
    penaltySummary: input.penaltySummary ?? null,
    ownerEmployeeId: input.ownerEmployeeId ?? null,
    reviewDate: input.reviewDate ?? null,
  };
}

export function obligationUpdateFields(input: Partial<ObligationInput>) {
  return {
    ...(input.title !== undefined && { title: input.title.trim() }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.reference !== undefined && { reference: input.reference }),
    ...(input.category !== undefined && { category: input.category }),
    ...(input.frequency !== undefined && { frequency: input.frequency }),
    ...(input.applicability !== undefined && { applicability: input.applicability }),
    ...(input.deliverableType !== undefined && { deliverableType: input.deliverableType }),
    ...(input.penaltySummary !== undefined && { penaltySummary: input.penaltySummary }),
    ...(input.ownerEmployeeId !== undefined && { ownerEmployeeId: input.ownerEmployeeId }),
    ...(input.reviewDate !== undefined && { reviewDate: input.reviewDate }),
  };
}

// ─── Control ──────────────────────────────────────────────────────────────────

export function controlCreateFields(input: ControlInput) {
  return {
    controlId: generateControlId(),
    title: input.title.trim(),
    controlType: input.controlType,
    description: input.description ?? null,
    implementationStatus: input.implementationStatus ?? "planned",
    ownerEmployeeId: input.ownerEmployeeId ?? null,
    reviewFrequency: input.reviewFrequency ?? null,
    nextReviewDate: input.nextReviewDate ?? null,
    effectiveness: input.effectiveness ?? null,
    catalogKey: input.catalogKey ?? null,
  };
}

export function controlUpdateFields(input: Partial<ControlInput>) {
  return {
    ...(input.title !== undefined && { title: input.title.trim() }),
    ...(input.controlType !== undefined && { controlType: input.controlType }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.implementationStatus !== undefined && { implementationStatus: input.implementationStatus }),
    ...(input.ownerEmployeeId !== undefined && { ownerEmployeeId: input.ownerEmployeeId }),
    ...(input.reviewFrequency !== undefined && { reviewFrequency: input.reviewFrequency }),
    ...(input.nextReviewDate !== undefined && { nextReviewDate: input.nextReviewDate }),
    ...(input.effectiveness !== undefined && { effectiveness: input.effectiveness }),
    ...(input.catalogKey !== undefined && { catalogKey: input.catalogKey }),
  };
}

// ─── Risk Assessment ──────────────────────────────────────────────────────────

export function riskAssessmentCreateFields(input: RiskAssessmentInput, employeeId: string | null) {
  return {
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
  };
}

export function riskAssessmentUpdateFields(input: Partial<RiskAssessmentInput>) {
  return {
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
  };
}

// ─── Incident ─────────────────────────────────────────────────────────────────

export function incidentCreateFields(input: IncidentInput, employeeId: string | null) {
  return {
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
  };
}

export function incidentUpdateFields(input: Partial<IncidentInput> & { notifiedAt?: Date | null }) {
  return {
    ...(input.title !== undefined && { title: input.title.trim() }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.severity !== undefined && { severity: input.severity }),
    ...(input.category !== undefined && { category: input.category }),
    ...(input.regulatoryNotifiable !== undefined && { regulatoryNotifiable: input.regulatoryNotifiable }),
    ...(input.notificationDeadline !== undefined && { notificationDeadline: input.notificationDeadline }),
    ...(input.notifiedAt !== undefined && { notifiedAt: input.notifiedAt }),
    ...(input.rootCause !== undefined && { rootCause: input.rootCause }),
    ...(input.riskAssessmentId !== undefined && { riskAssessmentId: input.riskAssessmentId }),
  };
}

// ─── Corrective Action ──────────────────────────────────────────────────────

export function correctiveActionCreateFields(input: CorrectiveActionInput, employeeId: string | null) {
  return {
    actionId: generateActionId(),
    title: input.title.trim(),
    description: input.description ?? null,
    rootCause: input.rootCause ?? null,
    sourceType: input.sourceType,
    incidentId: input.incidentId ?? null,
    auditFindingId: input.auditFindingId ?? null,
    ownerEmployeeId: input.ownerEmployeeId ?? employeeId,
    dueDate: input.dueDate ?? null,
  };
}

export function correctiveActionUpdateFields(
  input: Partial<CorrectiveActionInput> & { status?: string; completedAt?: Date | null },
) {
  return {
    ...(input.title !== undefined && { title: input.title.trim() }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.rootCause !== undefined && { rootCause: input.rootCause }),
    ...(input.ownerEmployeeId !== undefined && { ownerEmployeeId: input.ownerEmployeeId }),
    ...(input.dueDate !== undefined && { dueDate: input.dueDate }),
    ...(input.status !== undefined && { status: input.status }),
    ...(input.completedAt !== undefined && { completedAt: input.completedAt }),
  };
}

// ─── Audit ────────────────────────────────────────────────────────────────────

export function auditCreateFields(input: AuditInput) {
  return {
    auditId: generateAuditId(),
    title: input.title.trim(),
    auditType: input.auditType,
    scope: input.scope ?? null,
    auditorName: input.auditorName ?? null,
    auditorEmployeeId: input.auditorEmployeeId ?? null,
    scheduledAt: input.scheduledAt ?? null,
    notes: input.notes ?? null,
  };
}

export function auditUpdateFields(
  input: Partial<AuditInput> & {
    status?: string; conductedAt?: Date | null; completedAt?: Date | null; overallRating?: string | null;
  },
) {
  return {
    ...(input.title !== undefined && { title: input.title.trim() }),
    ...(input.auditType !== undefined && { auditType: input.auditType }),
    ...(input.scope !== undefined && { scope: input.scope }),
    ...(input.auditorName !== undefined && { auditorName: input.auditorName }),
    ...(input.auditorEmployeeId !== undefined && { auditorEmployeeId: input.auditorEmployeeId }),
    ...(input.scheduledAt !== undefined && { scheduledAt: input.scheduledAt }),
    ...(input.notes !== undefined && { notes: input.notes }),
    ...(input.status !== undefined && { status: input.status }),
    ...(input.conductedAt !== undefined && { conductedAt: input.conductedAt }),
    ...(input.completedAt !== undefined && { completedAt: input.completedAt }),
    ...(input.overallRating !== undefined && { overallRating: input.overallRating }),
  };
}

// ─── Audit Finding ────────────────────────────────────────────────────────────

export function auditFindingCreateFields(auditId: string, input: FindingInput) {
  return {
    findingId: generateFindingId(),
    auditId,
    title: input.title.trim(),
    findingType: input.findingType,
    controlId: input.controlId ?? null,
    description: input.description ?? null,
    dueDate: input.dueDate ?? null,
  };
}

export function auditFindingUpdateFields(
  input: Partial<FindingInput> & { status?: string; resolvedAt?: Date | null },
) {
  return {
    ...(input.title !== undefined && { title: input.title.trim() }),
    ...(input.findingType !== undefined && { findingType: input.findingType }),
    ...(input.controlId !== undefined && { controlId: input.controlId }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.dueDate !== undefined && { dueDate: input.dueDate }),
    ...(input.status !== undefined && { status: input.status }),
    ...(input.resolvedAt !== undefined && { resolvedAt: input.resolvedAt }),
  };
}

// ─── Evidence ─────────────────────────────────────────────────────────────────

/** Field map for an (immutable) Evidence create — reused by both createEvidence
 * and the supersedeEvidence transaction, which build the identical row. */
export function evidenceCreateFields(input: EvidenceInput, employeeId: string | null) {
  return {
    evidenceId: generateEvidenceId(),
    title: input.title.trim(),
    evidenceType: input.evidenceType,
    description: input.description ?? null,
    obligationId: input.obligationId ?? null,
    controlId: input.controlId ?? null,
    collectedByEmployeeId: input.collectedByEmployeeId ?? employeeId,
    fileRef: input.fileRef ?? null,
    retentionUntil: input.retentionUntil ?? null,
  };
}

// ─── Regulatory Submission ────────────────────────────────────────────────────

export function submissionCreateFields(input: SubmissionInput, employeeId: string | null) {
  return {
    submissionId: generateSubmissionId(),
    title: input.title.trim(),
    recipientBody: input.recipientBody.trim(),
    submissionType: input.submissionType,
    regulationId: input.regulationId ?? null,
    dueDate: input.dueDate ?? null,
    submittedByEmployeeId: input.submittedByEmployeeId ?? employeeId,
    notes: input.notes ?? null,
  };
}

export function submissionUpdateFields(
  input: Partial<SubmissionInput> & {
    status?: string; submittedAt?: Date | null; confirmationRef?: string | null;
    responseReceived?: boolean; responseDate?: Date | null; responseSummary?: string | null;
  },
) {
  return {
    ...(input.title !== undefined && { title: input.title.trim() }),
    ...(input.recipientBody !== undefined && { recipientBody: input.recipientBody.trim() }),
    ...(input.submissionType !== undefined && { submissionType: input.submissionType }),
    ...(input.regulationId !== undefined && { regulationId: input.regulationId }),
    ...(input.dueDate !== undefined && { dueDate: input.dueDate }),
    ...(input.notes !== undefined && { notes: input.notes }),
    ...(input.status !== undefined && { status: input.status }),
    ...(input.submittedAt !== undefined && { submittedAt: input.submittedAt }),
    ...(input.confirmationRef !== undefined && { confirmationRef: input.confirmationRef }),
    ...(input.responseReceived !== undefined && { responseReceived: input.responseReceived }),
    ...(input.responseDate !== undefined && { responseDate: input.responseDate }),
    ...(input.responseSummary !== undefined && { responseSummary: input.responseSummary }),
  };
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

/**
 * Project active-regulation rows (each carrying an obligation `_count`) into the
 * dashboard's regulationSummaries view shape. Pure map over already-fetched
 * rows; the caller owns the prisma query.
 */
export function mapRegulationSummaries(
  regulations: ReadonlyArray<{
    id: string;
    shortName: string;
    jurisdiction: string;
    _count: { obligations: number };
  }>,
) {
  return regulations.map((r) => ({
    id: r.id,
    shortName: r.shortName,
    jurisdiction: r.jurisdiction,
    obligationCount: r._count.obligations,
  }));
}
