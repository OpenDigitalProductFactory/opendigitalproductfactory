import { prisma } from "@dpf/db";

import type { CoworkerEngagementStatus } from "./types";

type DbClient = {
  coworkerOffer: {
    findUnique(args: unknown): Promise<{
      offerId: string;
      serviceId: string;
      riskTier: string;
      authorityBoundary: string;
      availabilityScope: string;
      budgetEnvelope?: unknown;
      legalTerms: unknown;
      dataBoundary: unknown;
      service: {
        serviceId: string;
        providerAgentId: string;
        authorityBoundary: string;
        riskTier: string;
      };
    } | null>;
  };
  coworkerEngagement: {
    create(args: unknown): Promise<{
      engagementId: string;
      status: string;
      workCapsuleId: string | null;
      approvalContext: unknown;
    }>;
  };
};

export type CreateCoworkerEngagementInput = {
  offerId: string;
  requestedByUserId?: string | null;
  requestedByAgentId?: string | null;
  requestedForPersona?: string | null;
  requestedOutcome: string;
  priority?: string;
  inputPayload?: unknown;
  fundingContext?: unknown;
  contractContext?: {
    termsRef?: string | null;
    dataBoundaryRef?: string | null;
    [key: string]: unknown;
  } | null;
  metadata?: unknown;
};

export type CoworkerEngagementResult = {
  engagementId: string;
  status: CoworkerEngagementStatus;
  workCapsuleId: string | null;
  approvalContext: {
    required: boolean;
    reasons: string[];
  };
};

export async function createCoworkerEngagement(
  input: CreateCoworkerEngagementInput,
  deps: { db?: DbClient; idFactory?: () => string } = {},
): Promise<CoworkerEngagementResult> {
  const db = deps.db ?? (prisma as unknown as DbClient);
  const offer = await db.coworkerOffer.findUnique({
    where: { offerId: input.offerId },
    include: { service: { select: { serviceId: true, providerAgentId: true, authorityBoundary: true, riskTier: true } } },
  });

  if (!offer) throw new Error(`Coworker offer not found: ${input.offerId}`);
  if (offer.availabilityScope === "external" && !hasExternalContractContext(input.contractContext)) {
    throw new Error("External coworker offers require contractContext.termsRef and contractContext.dataBoundaryRef.");
  }

  const approvalContext = approvalForOffer(offer, input);
  const status: CoworkerEngagementStatus = approvalContext.required ? "needs-approval" : "requested";
  const created = await db.coworkerEngagement.create({
    data: {
      engagementId: deps.idFactory?.() ?? buildEngagementId(),
      offerId: offer.offerId,
      serviceId: offer.serviceId,
      providerAgentId: offer.service.providerAgentId,
      requestedByUserId: input.requestedByUserId ?? null,
      requestedByAgentId: input.requestedByAgentId ?? null,
      requestedForPersona: input.requestedForPersona ?? null,
      requestedOutcome: input.requestedOutcome,
      priority: input.priority ?? "normal",
      status,
      inputPayload: input.inputPayload ?? {},
      fundingContext: input.fundingContext ?? {},
      contractContext: input.contractContext ?? {},
      approvalContext,
      auditRefs: {},
      metadata: input.metadata ?? {},
      workCapsuleId: null,
    },
  });

  return {
    engagementId: created.engagementId,
    status,
    workCapsuleId: created.workCapsuleId,
    approvalContext,
  };
}

function approvalForOffer(
  offer: { riskTier: string; authorityBoundary: string; budgetEnvelope?: unknown; legalTerms?: unknown; dataBoundary?: unknown },
  input: CreateCoworkerEngagementInput,
) {
  const reasons: string[] = [];
  if (offer.riskTier === "high" || offer.riskTier === "critical") reasons.push(`risk-tier:${offer.riskTier}`);
  if (offer.authorityBoundary === "approval-required" || offer.authorityBoundary === "never-allowed") {
    reasons.push(`authority-boundary:${offer.authorityBoundary}`);
  }
  const budgetEnvelope = record(offer.budgetEnvelope);
  const legalTerms = record(offer.legalTerms);
  const dataBoundary = record(offer.dataBoundary);
  const fundingContext = record(input.fundingContext);
  if ((budgetEnvelope.paidProvider === true || budgetEnvelope.requiresBudgetApproval === true) && !hasFundingApprovalContext(fundingContext)) {
    reasons.push("paid-provider:funding-context-missing");
  }
  if (legalTerms.termsRequired === true && !input.contractContext?.termsRef?.trim()) {
    reasons.push("contract-terms:missing");
  }
  if (dataBoundary.dataBoundaryRequired === true && !input.contractContext?.dataBoundaryRef?.trim()) {
    reasons.push("data-boundary:missing");
  }
  return { required: reasons.length > 0, reasons };
}

function hasExternalContractContext(input: CreateCoworkerEngagementInput["contractContext"]): boolean {
  return Boolean(input?.termsRef?.trim() && input?.dataBoundaryRef?.trim());
}

function hasFundingApprovalContext(input: Record<string, unknown>): boolean {
  return Boolean(stringValue(input.budgetOwner) && (stringValue(input.costCenter) || stringValue(input.approvalRef)));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function buildEngagementId(): string {
  return `CE-${Math.random().toString(16).slice(2, 10).toUpperCase()}`;
}
