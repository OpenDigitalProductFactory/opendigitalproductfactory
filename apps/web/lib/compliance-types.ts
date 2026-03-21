// Pure utility library — no server imports. Safe in tests and client components.
import * as crypto from "crypto";

// ─── ID Generators ────────────────────────────────────────────────────────────

function makeId(prefix: string): string {
  const hex = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `${prefix}-${hex}`;
}

export function generateRegulationId(): string  { return makeId("REG"); }
export function generateObligationId(): string  { return makeId("OBL"); }
export function generateControlId(): string     { return makeId("CTL"); }
export function generateEvidenceId(): string    { return makeId("EVD"); }
export function generateIncidentId(): string    { return makeId("INC"); }
export function generateActionId(): string      { return makeId("CA"); }
export function generateAuditId(): string       { return makeId("AUD"); }
export function generateFindingId(): string     { return makeId("FND"); }
export function generateSubmissionId(): string  { return makeId("SUB"); }
export function generateAssessmentId(): string  { return makeId("RA"); }

// ─── Constants ────────────────────────────────────────────────────────────────

export const REGULATION_STATUSES = ["active", "inactive", "superseded"] as const;

export const REGULATION_SOURCE_TYPES = ["external", "standard", "framework", "internal"] as const;

export const OBLIGATION_CATEGORIES = [
  "data-protection",
  "safety",
  "financial-reporting",
  "environmental",
  "cybersecurity",
  "employment",
  "operational",
  "other",
] as const;

export const OBLIGATION_FREQUENCIES = [
  "event-driven",
  "annual",
  "quarterly",
  "monthly",
  "continuous",
] as const;

export const CONTROL_TYPES = ["preventive", "detective", "corrective"] as const;

export const CONTROL_IMPLEMENTATION_STATUSES = [
  "planned",
  "in-progress",
  "implemented",
  "not-applicable",
] as const;

export const CONTROL_EFFECTIVENESS = [
  "effective",
  "partially-effective",
  "ineffective",
  "not-assessed",
] as const;

export const EVIDENCE_TYPES = [
  "policy",
  "procedure",
  "training-record",
  "audit-report",
  "test-result",
  "incident-report",
  "approval",
  "submission",
  "assessment",
  "other",
] as const;

export const RISK_LIKELIHOODS = [
  "rare",
  "unlikely",
  "possible",
  "likely",
  "almost-certain",
] as const;

export const RISK_SEVERITIES = [
  "negligible",
  "minor",
  "moderate",
  "major",
  "catastrophic",
] as const;

export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;

export const INCIDENT_SEVERITIES = ["low", "medium", "high", "critical"] as const;

export const INCIDENT_CATEGORIES = [
  "data-breach",
  "safety",
  "financial",
  "environmental",
  "operational",
  "other",
] as const;

export const INCIDENT_STATUSES = [
  "open",
  "investigating",
  "remediated",
  "closed",
] as const;

export const CORRECTIVE_ACTION_STATUSES = [
  "open",
  "in-progress",
  "completed",
  "verified",
  "overdue",
] as const;

export const CORRECTIVE_ACTION_SOURCE_TYPES = [
  "incident",
  "audit-finding",
  "gap-assessment",
  "management-review",
] as const;

export const AUDIT_TYPES = [
  "internal",
  "external",
  "certification",
  "regulatory-inspection",
] as const;

export const AUDIT_STATUSES = [
  "planned",
  "in-progress",
  "completed",
  "cancelled",
] as const;

export const AUDIT_RATINGS = [
  "conforming",
  "minor-nonconformity",
  "major-nonconformity",
  "observation",
] as const;

export const FINDING_TYPES = [
  "nonconformity-major",
  "nonconformity-minor",
  "observation",
  "opportunity",
] as const;

export const SUBMISSION_TYPES = [
  "breach-notification",
  "annual-report",
  "certification",
  "license-renewal",
  "incident-report",
] as const;

export const SUBMISSION_STATUSES = [
  "draft",
  "pending",
  "submitted",
  "acknowledged",
  "rejected",
] as const;

// ─── Input Types ──────────────────────────────────────────────────────────────

export type RegulationInput = {
  name: string;
  shortName: string;
  jurisdiction: string;
  industry?: string | null;
  sourceType?: string;
  effectiveDate?: Date | null;
  reviewDate?: Date | null;
  sourceUrl?: string | null;
  notes?: string | null;
};

export type ObligationInput = {
  title: string;
  regulationId: string;
  description?: string | null;
  reference?: string | null;
  category?: string | null;
  frequency?: string | null;
  applicability?: string | null;
  penaltySummary?: string | null;
  ownerEmployeeId?: string | null;
  reviewDate?: Date | null;
};

export type ControlInput = {
  title: string;
  controlType: string;
  description?: string | null;
  implementationStatus?: string;
  ownerEmployeeId?: string | null;
  reviewFrequency?: string | null;
  nextReviewDate?: Date | null;
  effectiveness?: string | null;
};

export type EvidenceInput = {
  title: string;
  evidenceType: string;
  description?: string | null;
  obligationId?: string | null;
  controlId?: string | null;
  collectedByEmployeeId?: string | null;
  fileRef?: string | null;
  retentionUntil?: Date | null;
};

export type RiskAssessmentInput = {
  title: string;
  hazard: string;
  likelihood: string;
  severity: string;
  inherentRisk: string;
  scope?: string | null;
  residualRisk?: string | null;
  assessedByEmployeeId?: string | null;
  nextReviewDate?: Date | null;
  notes?: string | null;
};

export type IncidentInput = {
  title: string;
  occurredAt: Date;
  severity: string;
  description?: string | null;
  detectedAt?: Date | null;
  category?: string | null;
  regulatoryNotifiable?: boolean;
  notificationDeadline?: Date | null;
  rootCause?: string | null;
  riskAssessmentId?: string | null;
  reportedByEmployeeId?: string | null;
};

export type CorrectiveActionInput = {
  title: string;
  sourceType: string;
  description?: string | null;
  rootCause?: string | null;
  incidentId?: string | null;
  auditFindingId?: string | null;
  ownerEmployeeId?: string | null;
  dueDate?: Date | null;
};

export type AuditInput = {
  title: string;
  auditType: string;
  scope?: string | null;
  auditorName?: string | null;
  auditorEmployeeId?: string | null;
  scheduledAt?: Date | null;
  notes?: string | null;
};

export type FindingInput = {
  title: string;
  findingType: string;
  controlId?: string | null;
  description?: string | null;
  dueDate?: Date | null;
};

export type SubmissionInput = {
  title: string;
  recipientBody: string;
  submissionType: string;
  regulationId?: string | null;
  dueDate?: Date | null;
  submittedByEmployeeId?: string | null;
  notes?: string | null;
};

// ─── Validators ───────────────────────────────────────────────────────────────

/** Returns null if valid, or an error message if invalid. */
export function validateRegulationInput(input: RegulationInput): string | null {
  if (!input.name.trim()) return "Name is required.";
  if (!input.shortName.trim()) return "Short name is required.";
  if (!input.jurisdiction.trim()) return "Jurisdiction is required.";
  return null;
}

/** Returns null if valid, or an error message if invalid. */
export function validateObligationInput(input: ObligationInput): string | null {
  if (!input.title.trim()) return "Title is required.";
  if (!input.regulationId.trim()) return "Regulation ID is required.";
  return null;
}

/** Returns null if valid, or an error message if invalid. */
export function validateControlInput(input: ControlInput): string | null {
  if (!input.title.trim()) return "Title is required.";
  if (!(CONTROL_TYPES as readonly string[]).includes(input.controlType)) {
    return `Control type must be one of: ${CONTROL_TYPES.join(", ")}.`;
  }
  return null;
}
