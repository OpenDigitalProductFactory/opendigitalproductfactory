import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@dpf/db";
import { validateDemandDigestV1, type DemandDigestV1 } from "@dpf/db/federated-demand-contract";

import { resolveFederationLinkAuth } from "@/lib/auth/federation-link-token";
import { validateFederationCloudEvent } from "@/lib/federation/cloud-event-guard";
import { compareIncomingDemandDigest, type DemandDigestDb } from "@/lib/federation/demand-digest";
import { bindPeerInstallationIdentity } from "@/lib/federation/channel-demand";

const ERROR_STATUS: Record<string, number> = {
  missing_authorization: 401,
  invalid_scheme: 401,
  invalid_token_format: 401,
  token_not_found: 401,
  link_not_trusted: 403,
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authz = await resolveFederationLinkAuth(request.headers.get("authorization"));
  if (!authz.ok) {
    return NextResponse.json(
      { ok: false, error: authz.error, message: authz.message },
      { status: ERROR_STATUS[authz.error] ?? 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 422 });
  }
  const eventViolations = validateFederationCloudEvent(body, { linkId: authz.linkId });
  if (eventViolations.length > 0) {
    return NextResponse.json(
      { ok: false, error: "invalid_cloud_event", violations: eventViolations },
      { status: 422 },
    );
  }
  const event = body as { type?: unknown; data?: unknown };
  if (event.type !== "dpf.demand.reconcile") {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 422 });
  }
  const violations = validateDemandDigestV1(event.data);
  if (violations.length > 0) {
    return NextResponse.json(
      { ok: false, error: "invalid_demand_digest", violations },
      { status: 422 },
    );
  }

  try {
    await bindPeerInstallationIdentity(
      prisma,
      authz.linkId,
      (event.data as DemandDigestV1).originInstallationId,
    );
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: "peer_identity_mismatch",
      message: error instanceof Error ? error.message : "Peer identity mismatch",
    }, { status: 409 });
  }

  const result = await compareIncomingDemandDigest(
    prisma as unknown as DemandDigestDb,
    authz.linkId,
    event.data as DemandDigestV1,
  );
  return NextResponse.json({ ok: true, ...result });
}
