// @exposure authenticated — internal-a2a (the default) requires a session;
// partner/external profiles are scope-gated to offers explicitly published at
// that availabilityScope and cross-boundary POSTs additionally require the
// GAID call chain + contract context, so the endpoint is not "public" in the
// path-segmentation sense.
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api/error";
import { loadCoworkerCatalog } from "@/lib/coworker-service-catalog/catalog";
import { createCoworkerA2aTask } from "@/lib/coworker-service-catalog/a2a-tasks";
import {
  projectCoworkerOfferAgentCard,
  type CoworkerAgentCardAccessProfile,
} from "@/lib/coworker-service-catalog/agent-card";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    agentId: string;
    offerId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { agentId, offerId } = await context.params;
  const catalog = await loadCoworkerCatalog();
  const offer = catalog.offers.find((candidate) => candidate.offerId === offerId && candidate.provider.agentId === agentId);
  if (!offer) return apiErrorResponse("NOT_FOUND", "Offer not found", 404);

  const accessProfile = resolveAccessProfile(request, offer.availabilityScope);
  if (!accessProfile) return apiErrorResponse("INVALID_ARGUMENT", "invalid_accessProfile", 400);

  if (accessProfile === "internal-a2a") {
    const session = await auth();
    if (!session?.user) return apiErrorResponse("UNAUTHORIZED", "Unauthorized", 401);
  }

  const projection = projectCoworkerOfferAgentCard(offer, { accessProfile });
  if (!projection.ok) {
    return apiErrorResponse(
      projection.reason === "offer_not_available_for_access_profile" ? "FORBIDDEN" : "CONFLICT",
      projection.reason,
      projection.reason === "offer_not_available_for_access_profile" ? 403 : 409,
      { missing: projection.missing },
    );
  }

  return new Response(JSON.stringify(projection.card), {
    status: 200,
    headers: {
      "Content-Type": "application/agent-card+json; charset=utf-8",
      "Cache-Control": accessProfile === "internal-a2a" ? "no-store" : "public, max-age=300",
    },
  });
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { agentId, offerId } = await context.params;
  const catalog = await loadCoworkerCatalog();
  const offer = catalog.offers.find((candidate) => candidate.offerId === offerId && candidate.provider.agentId === agentId);
  if (!offer) return apiErrorResponse("NOT_FOUND", "Offer not found", 404);

  const accessProfile = resolveAccessProfile(request, offer.availabilityScope);
  if (!accessProfile) return apiErrorResponse("INVALID_ARGUMENT", "invalid_accessProfile", 400);
  if (accessProfile === "internal-a2a") {
    const session = await auth();
    if (!session?.user) return apiErrorResponse("UNAUTHORIZED", "Unauthorized", 401);
  }

  const projection = projectCoworkerOfferAgentCard(offer, { accessProfile });
  if (!projection.ok) {
    return apiErrorResponse(
      projection.reason === "offer_not_available_for_access_profile" ? "FORBIDDEN" : "CONFLICT",
      projection.reason,
      projection.reason === "offer_not_available_for_access_profile" ? 403 : 409,
      { missing: projection.missing },
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return apiErrorResponse("INVALID_ARGUMENT", "invalid_json", 400);
  }
  const requestedOutcome = typeof body.requestedOutcome === "string" ? body.requestedOutcome.trim() : "";
  if (!requestedOutcome) return apiErrorResponse("INVALID_ARGUMENT", "missing_requestedOutcome", 400);
  const actingAgentGaid = stringValue(body.actingAgentGaid);
  const delegatingAgentGaid = stringValue(body.delegatingAgentGaid) ?? actingAgentGaid;
  if (accessProfile !== "internal-a2a" && (!actingAgentGaid || !delegatingAgentGaid)) {
    return apiErrorResponse(
      "INVALID_ARGUMENT",
      "Cross-boundary A2A task submission requires actingAgentGaid and delegatingAgentGaid.",
      400,
      { error: "missing_gaid_call_chain" },
    );
  }
  const contractContext = recordOrNull(body.contractContext);
  const missingContractContext = accessProfile === "internal-a2a" ? [] : missingCrossBoundaryContractFields(contractContext);
  if (missingContractContext.length > 0) {
    return apiErrorResponse(
      "INVALID_ARGUMENT",
      "Cross-boundary A2A task submission requires termsRef and dataBoundaryRef.",
      400,
      { error: "missing_contract_context", missing: missingContractContext },
    );
  }

  const task = await createCoworkerA2aTask({
    offerId,
    serviceId: projection.card.serviceId,
    requestedOutcome,
    inputPayload: body.inputPayload ?? {},
    fundingContext: body.fundingContext ?? {},
    contractContext,
    contextId: stringValue(body.contextId) ?? undefined,
    accessProfile,
    actingAgentGaid,
    delegatingAgentGaid,
    delegatedAgentId: projection.card.agentId,
    delegatedAgentGaid: projection.card.identity.gaid,
    authorityBoundary: projection.card.authorityBoundary,
    riskTier: projection.card.riskTier,
    requiredGrants: projection.card.security.requiredGrants,
  });

  return NextResponse.json(task, { status: 202 });
}

function resolveAccessProfile(request: Request, availabilityScope: string): CoworkerAgentCardAccessProfile | null {
  const url = new URL(request.url);
  const explicit = url.searchParams.get("accessProfile");
  if (explicit === "internal-a2a" || explicit === "partner-a2a" || explicit === "external-a2a") return explicit;
  if (availabilityScope === "internal") return "internal-a2a";
  if (availabilityScope === "partner") return "partner-a2a";
  if (availabilityScope === "external") return "external-a2a";
  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function missingCrossBoundaryContractFields(context: Record<string, unknown> | null): string[] {
  if (!context) return ["termsRef", "dataBoundaryRef"];
  const missing: string[] = [];
  if (!stringValue(context.termsRef)) missing.push("termsRef");
  if (!stringValue(context.dataBoundaryRef)) missing.push("dataBoundaryRef");
  return missing;
}
