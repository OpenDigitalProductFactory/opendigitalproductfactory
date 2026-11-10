// POST /api/v1/federation/incident
//
// EP-MSP-FEDERATION · B3 receiving route. A managed customer's DPF pushes a
// minimized, source-correlated incident over the FederationLink; we (the MSP)
// mirror it as a ServiceTicket. Authenticates with the peer's dpflink_ token
// (dual-approved trusted link required). Flag-gated by
// the trusted link (no flag).

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@dpf/db";

import { resolveFederationLinkAuth } from "@/lib/auth/federation-link-token";
import {
  handleIncomingIncident,
  type IncidentExchangeDb,
  type IncomingIncident,
} from "@/lib/federation/exchange-handlers";
import { autoDiagnoseAndSendProposal, type AutoProposeDb } from "@/lib/federation/auto-propose";

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

  // CloudEvents envelope: the payload rides in `data`.
  const data = (body as { data?: unknown })?.data as Partial<IncomingIncident> | undefined;
  if (
    !data ||
    typeof data.incidentKey !== "string" ||
    typeof data.payloadHash !== "string" ||
    typeof data.summary !== "string"
  ) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 422 });
  }

  const result = await handleIncomingIncident(prisma as unknown as IncidentExchangeDb, authz.linkId, {
    incidentKey: data.incidentKey,
    summary: data.summary,
    highestSeverity: typeof data.highestSeverity === "string" ? data.highestSeverity : "warn",
    alertCount: typeof data.alertCount === "number" ? data.alertCount : 1,
    payloadHash: data.payloadHash,
    ...(typeof data.baseVersion === "number" ? { baseVersion: data.baseVersion } : {}),
  });

  // AI-MSP loop: if we manage this peer, auto-diagnose + propose remediation back
  // (best-effort; the customer re-evaluates through their own consent gate).
  try {
    await autoDiagnoseAndSendProposal(prisma as unknown as AutoProposeDb, authz.linkId, {
      incidentKey: data.incidentKey,
      summary: data.summary,
      highestSeverity: typeof data.highestSeverity === "string" ? data.highestSeverity : "warn",
    });
  } catch {
    /* best-effort */
  }

  return NextResponse.json({ ok: true, ...result }, { status: 200 });
}
