// POST /api/v1/federation/proposal
//
// EP-MSP-FEDERATION · B4 receiving route. The MSP's DPF pushes a remediation
// proposal over the FederationLink; we (the sovereign customer) re-evaluate it
// through OUR OWN consent gate and land it as a FederatedRemediationProposal —
// proposed (Attention Surface) or rejected. The MSP never gains standing execute
// rights; nothing auto-executes unless our own policy permits it (§15.4 default
// off). Authenticates with the peer's dpflink_ token; flag-gated.

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@dpf/db";

import { resolveFederationLinkAuth } from "@/lib/auth/federation-link-token";
import {
  handleIncomingProposal,
  type ProposalExchangeDb,
} from "@/lib/federation/exchange-handlers";
import type { RemediationProposalDraft } from "@/lib/service-desk/remediation-authority";

const ERROR_STATUS: Record<string, number> = {
  missing_authorization: 401,
  invalid_scheme: 401,
  invalid_token_format: 401,
  token_not_found: 401,
  link_not_trusted: 403,
};

function isProposalDraft(v: unknown): v is RemediationProposalDraft {
  if (!v || typeof v !== "object") return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.incidentKey === "string" &&
    Array.isArray(d.actions) &&
    typeof d.overallDecision === "string"
  );
}

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

  const data = (body as { data?: unknown })?.data;
  if (!isProposalDraft(data)) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 422 });
  }

  // The customer's own policy decides auto-execution; default is conservative.
  // (A future slice resolves this from the link's AuthorityBinding band.)
  const result = await handleIncomingProposal(prisma as unknown as ProposalExchangeDb, authz.linkId, data, {
    customerAllowsAuto: false,
  });

  return NextResponse.json({ ok: true, ...result }, { status: 200 });
}
