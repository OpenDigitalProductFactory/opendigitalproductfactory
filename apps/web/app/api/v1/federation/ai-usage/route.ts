// @exposure private-mesh
//
// BI-6361A930: this installation's own AI plan usage, for a trusted
// same-organization peer. The owner's AI plans are shared by production and
// the paired Dev install, so each one pulls the other's usage to value a plan
// and spread its fee once (lib/federation/ai-usage-exchange.ts). Hourly token
// counts and limit hits per provider for the last 30 days; usage pulled from a
// peer is never re-served. Same auth and same-organization rule as /work.

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@dpf/db";

import { apiErrorResponse } from "@/lib/api/error";
import { resolveFederationLinkAuth } from "@/lib/auth/federation-link-token";
import { loadLocalHourlyAiUsage } from "@/lib/finance/subscription-cost-estimator.server";
import { ESTIMATE_LOOKBACK_DAYS } from "@/lib/finance/subscription-cost-estimator";
import { buildFederatedAiUsage } from "@/lib/federation/ai-usage-exchange";
import { resolveFederationIdentity, type FederationIdentityDb } from "@/lib/federation/demand-identity";

const ERROR_STATUS: Record<string, number> = {
  missing_authorization: 401,
  invalid_scheme: 401,
  invalid_token_format: 401,
  token_not_found: 401,
  link_not_trusted: 403,
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authz = await resolveFederationLinkAuth(request.headers.get("authorization"));
  if (!authz.ok) {
    return apiErrorResponse(authz.error.toUpperCase(), authz.message, ERROR_STATUS[authz.error] ?? 401);
  }
  if (authz.role !== "same-org-peer") {
    return apiErrorResponse("LINK_NOT_SAME_ORGANIZATION", "AI usage is shared only with a same-organization peer.", 403);
  }
  const now = new Date();
  const since = new Date(now.getTime() - ESTIMATE_LOOKBACK_DAYS * 86_400_000);
  const [identity, local] = await Promise.all([
    resolveFederationIdentity(prisma as unknown as FederationIdentityDb),
    loadLocalHourlyAiUsage({ since }),
  ]);
  return NextResponse.json(buildFederatedAiUsage({ originInstallationId: identity.installationId, now, ...local }));
}
