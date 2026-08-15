// apps/web/app/api/a2a/coworkers/[agentId]/route.ts
//
// EP-COWORKER-IDENTITY-360 Phase 2 — the whole-coworker A2A identity card. The
// machine complement to the human identity page (/workforce/[agentId]): another
// agent GETs this to discover WHO a coworker is and HOW to engage it, resolving
// the same identity a person sees. Aggregates the coworker's A2A-exposed offers
// (each offer keeps its own card at ./offers/[offerId]) and reuses the offer
// card's access model (internal-a2a requires a session; partner/external are
// scope-gated). Discovery only — engagement still POSTs to a specific offer.
import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api/error";
import { loadCoworkerCatalog } from "@/lib/coworker-service-catalog/catalog";
import {
  projectCoworkerIdentityAgentCard,
  type CoworkerAgentCardAccessProfile,
} from "@/lib/coworker-service-catalog/agent-card";
import type { CoworkerOfferCatalogItem } from "@/lib/coworker-service-catalog/catalog";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ agentId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { agentId } = await context.params;
  const catalog = await loadCoworkerCatalog();
  const offers = catalog.offers.filter((candidate) => candidate.provider.agentId === agentId);
  if (offers.length === 0) {
    return apiErrorResponse("NOT_FOUND", "Coworker not found or exposes no A2A offers", 404);
  }

  const accessProfile = resolveAccessProfile(request, offers);
  if (!accessProfile) return apiErrorResponse("INVALID_ARGUMENT", "invalid_accessProfile", 400);
  if (accessProfile === "internal-a2a") {
    const session = await auth();
    if (!session?.user) return apiErrorResponse("UNAUTHORIZED", "Unauthorized", 401);
  }

  const provider = offers[0].provider;
  const agentRow = await prisma.agent
    .findFirst({ where: { agentId }, select: { description: true } })
    .catch(() => null);

  const projection = projectCoworkerIdentityAgentCard(
    {
      agentId,
      displayName: provider.displayName,
      kind: provider.kind,
      description: agentRow?.description ?? null,
    },
    offers,
    { accessProfile },
  );
  if (!projection.ok) {
    return apiErrorResponse("FORBIDDEN", projection.reason, 403, { missing: projection.missing });
  }

  return new Response(JSON.stringify(projection.card), {
    status: 200,
    headers: {
      "Content-Type": "application/agent-card+json; charset=utf-8",
      "Cache-Control": accessProfile === "internal-a2a" ? "no-store" : "public, max-age=300",
    },
  });
}

/** Explicit ?accessProfile wins; else the coworker's broadest exposure, defaulting
 *  internal-first (which requires a session) so identity discovery never leaks. */
function resolveAccessProfile(
  request: Request,
  offers: CoworkerOfferCatalogItem[],
): CoworkerAgentCardAccessProfile | null {
  const explicit = new URL(request.url).searchParams.get("accessProfile");
  if (explicit === "internal-a2a" || explicit === "partner-a2a" || explicit === "external-a2a") {
    return explicit;
  }
  const scopes = new Set(offers.map((offer) => offer.availabilityScope));
  if (scopes.has("internal")) return "internal-a2a";
  if (scopes.has("partner")) return "partner-a2a";
  if (scopes.has("external")) return "external-a2a";
  return null;
}
