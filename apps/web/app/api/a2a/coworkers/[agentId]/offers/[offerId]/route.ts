import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
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
  if (!offer) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const accessProfile = resolveAccessProfile(request, offer.availabilityScope);
  if (!accessProfile) return NextResponse.json({ error: "invalid_accessProfile" }, { status: 400 });

  if (accessProfile === "internal-a2a") {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projection = projectCoworkerOfferAgentCard(offer, { accessProfile });
  if (!projection.ok) {
    return NextResponse.json(
      { error: projection.reason, missing: projection.missing },
      { status: projection.reason === "offer_not_available_for_access_profile" ? 403 : 409 },
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
  if (!offer) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const accessProfile = resolveAccessProfile(request, offer.availabilityScope);
  if (!accessProfile) return NextResponse.json({ error: "invalid_accessProfile" }, { status: 400 });
  if (accessProfile === "internal-a2a") {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projection = projectCoworkerOfferAgentCard(offer, { accessProfile });
  if (!projection.ok) {
    return NextResponse.json(
      { error: projection.reason, missing: projection.missing },
      { status: projection.reason === "offer_not_available_for_access_profile" ? 403 : 409 },
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const requestedOutcome = typeof body.requestedOutcome === "string" ? body.requestedOutcome.trim() : "";
  if (!requestedOutcome) return NextResponse.json({ error: "missing_requestedOutcome" }, { status: 400 });

  const task = await createCoworkerA2aTask({
    offerId,
    requestedOutcome,
    inputPayload: body.inputPayload ?? {},
    fundingContext: body.fundingContext ?? {},
    contractContext: recordOrNull(body.contractContext),
    contextId: stringValue(body.contextId) ?? undefined,
    actingAgentGaid: stringValue(body.actingAgentGaid),
    delegatingAgentGaid: stringValue(body.delegatingAgentGaid) ?? stringValue(body.actingAgentGaid),
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

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
