import { z } from "zod";

import { ApiError, apiError } from "@/lib/api/error";

const Digest = z.string().regex(/^[a-f0-9]{64}$/i);
const Reference = z.string().trim().min(1).max(1000);

export const CoverageEvidenceBody = z.object({
  organizationId: z.string().min(1).max(128),
  idempotencyKey: z.string().trim().min(1).max(128),
  fundingType: z.enum(["commercial", "public-entitlement", "private", "supplemental", "self-pay", "other"]),
  payerOrProgramName: z.string().trim().min(1).max(200).optional(),
  memberIdentifierLast4: z.string().regex(/^[a-z0-9]{1,4}$/i).optional(),
  responsiblePartyPrincipalId: z.string().min(1).max(128).optional(),
  evidenceRef: Reference,
  evidenceDigest: Digest,
  effectiveFrom: z.coerce.date().optional(),
  effectiveUntil: z.coerce.date().optional(),
  sourceSystem: z.string().trim().min(1).max(128).optional(),
  sourceId: z.string().trim().min(1).max(256).optional(),
  sourceVersion: z.string().trim().min(1).max(128).optional(),
}).refine(
  (value) => !value.effectiveFrom || !value.effectiveUntil || value.effectiveUntil >= value.effectiveFrom,
  { message: "Invalid coverage effective window" },
);

export const ConsentAttestationBody = z.object({
  organizationId: z.string().min(1).max(128),
  idempotencyKey: z.string().trim().min(1).max(128),
  patientConsentDirectiveId: z.string().min(1).max(128),
  responseId: z.string().min(1).max(128).optional(),
  documentRef: Reference,
  documentDigest: Digest,
  documentVersion: z.string().trim().min(1).max(100),
  signatureEvidenceRef: Reference,
  signatureDigest: Digest,
  signatureMethod: z.string().trim().min(1).max(100),
  signerPrincipalId: z.string().min(1).max(128),
  witnessPrincipalId: z.string().min(1).max(128).optional(),
  attestedAt: z.coerce.date(),
});

export const EvidenceDecisionBody = z.object({
  organizationId: z.string().min(1).max(128),
  decision: z.enum(["accepted", "rejected"]),
  reason: z.string().trim().min(1).max(500).optional(),
}).superRefine((value, ctx) => {
  if (value.decision === "rejected" && !value.reason) {
    ctx.addIssue({ code: "custom", path: ["reason"], message: "Rejection reason required" });
  }
  if (value.decision === "accepted" && value.reason) {
    ctx.addIssue({ code: "custom", path: ["reason"], message: "Acceptance cannot include a rejection reason" });
  }
});

export function careIntakeEvidenceError(error: unknown): Response {
  if (error instanceof ApiError) return error.toResponse();
  if (error instanceof Error) {
    if (error.message.includes("not found")) {
      return apiError("INTAKE_EVIDENCE_NOT_FOUND", "Intake evidence or authority record not found", 404).toResponse();
    }
    if (["evidence-idempotency-conflict", "evidence-already-reviewed", "stale-evidence-review"].includes(error.message)) {
      return apiError("INTAKE_EVIDENCE_CONFLICT", "The evidence record changed or conflicts with this request", 409).toResponse();
    }
    if (/^(Invalid|Rejection|Acceptance|Signer)/.test(error.message)) {
      return apiError("INVALID_REQUEST", "Invalid intake evidence request", 400).toResponse();
    }
  }
  return apiError("INTERNAL_ERROR", "An unexpected error occurred", 500).toResponse();
}
