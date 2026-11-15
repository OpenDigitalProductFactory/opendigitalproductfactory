// @exposure private-mesh
//
// BI-B45BBD8A — the federation A2A ingress. A trusted same-organization peer
// sends one signed `dpf.a2a-request/1` envelope as a CloudEvent; this
// installation creates and owns the work and answers with a receipt.
//
// Transport authentication is the link bearer token, as on the inbox. The
// envelope's EdDSA signature must verify against the link's peer DID. Both are
// required (a2a-ingress.ts). Off unless DPF_FEDERATION_A2A_ENABLED is "true".
//
// Status codes: 401/403 only for the link credential itself, because those
// quarantine the sender's link. A refused request is a decision, answered 200
// with outcome "rejected"; a malformed one is 422; a reused requestId with
// different content is 409. Accepted is 202; a duplicate is 200.
import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@dpf/db";
import { A2A_REQUEST_ACTIVITIES } from "@dpf/db/federated-a2a-contract";

import { resolveFederationLinkAuth } from "@/lib/auth/federation-link-token";
import { handleIncomingA2aRequest, type A2aIngressDb } from "@/lib/federation/a2a-ingress";
import { taskSubmittedHandler } from "@/lib/federation/a2a-task-submitted.server";
import { validateFederationCloudEvent } from "@/lib/federation/cloud-event-guard";
import { ok } from "@/lib/shared/action-result";
import { resolveFederationIdentity, type FederationIdentityDb } from "@/lib/federation/demand-identity";

export const dynamic = "force-dynamic";

const LINK_ERROR_STATUS: Record<string, number> = { link_not_trusted: 403 };

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authz = await resolveFederationLinkAuth(request.headers.get("authorization"));
  if (!authz.ok) {
    return NextResponse.json({ ok: false, error: authz.error, message: authz.message }, { status: LINK_ERROR_STATUS[authz.error] ?? 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const violations = validateFederationCloudEvent(body, { linkId: authz.linkId });
  if (violations.length > 0) {
    return NextResponse.json({ ok: false, error: "invalid_cloud_event", violations }, { status: 422 });
  }
  const event = body as { type: string; data: unknown };
  if (!(A2A_REQUEST_ACTIVITIES as readonly string[]).includes(event.type)) {
    return NextResponse.json({ ok: false, error: "unsupported_activity" }, { status: 422 });
  }

  const identity = await resolveFederationIdentity(prisma as unknown as FederationIdentityDb);
  if (!identity.deviceId) {
    return NextResponse.json({ ok: false, error: "installation_identity_unavailable" }, { status: 503 });
  }

  const receipt = await handleIncomingA2aRequest(
    prisma as unknown as A2aIngressDb,
    { linkId: authz.linkId, activity: event.type, record: event.data },
    {
      selfInstallationDid: identity.deviceId,
      now: new Date(),
      a2aEnabled: process.env.DPF_FEDERATION_A2A_ENABLED === "true",
    },
    { "task.submitted": taskSubmittedHandler() },
  );

  if (receipt.outcome !== "rejected") {
    return NextResponse.json({ ...ok(), ...receipt }, { status: receipt.outcome === "accepted" ? 202 : 200 });
  }
  const status = receipt.reason === "malformed" ? 422 : receipt.reason === "request-id-conflict" ? 409 : 200;
  return NextResponse.json({ ok: false, ...receipt }, { status });
}
