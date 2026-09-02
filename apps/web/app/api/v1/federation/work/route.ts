// @exposure private-mesh
//
// BI-FF8A57EF — same-organization work sync, serving side. A trusted
// same-organization peer pulls this installation's share-safe backlog (items +
// epics) in pages and materialises them as read-only mirrors. Only the origin
// mutates a record; this route is the origin's read surface.
//
// Why a pull: the receiving side converges on its own cadence regardless of
// this side's outbox, retry clock, or re-heal cap. Nothing is queued here.

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@dpf/db";
import {
  FEDERATED_WORK_MAX_PAGE_SIZE,
  FEDERATED_WORK_PAGE_SIZE,
} from "@dpf/db/federated-work-contract";

import { apiErrorResponse } from "@/lib/api/error";
import { resolveFederationLinkAuth } from "@/lib/auth/federation-link-token";
import { resolveFederationIdentity, type FederationIdentityDb } from "@/lib/federation/demand-identity";
import { buildFederatedWorkPage, type WorkPageDb } from "@/lib/federation/work-page";

const ERROR_STATUS: Record<string, number> = {
  missing_authorization: 401,
  invalid_scheme: 401,
  invalid_token_format: 401,
  token_not_found: 401,
  link_not_trusted: 403,
};

function parseLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return FEDERATED_WORK_PAGE_SIZE;
  return Math.min(parsed, FEDERATED_WORK_MAX_PAGE_SIZE);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authz = await resolveFederationLinkAuth(request.headers.get("authorization"));
  if (!authz.ok) {
    return apiErrorResponse(authz.error.toUpperCase(), authz.message, ERROR_STATUS[authz.error] ?? 401);
  }
  // Work sync is a same-organization capability. A service-provider, channel or
  // community peer keeps the deliberate, per-item demand-sharing path.
  if (authz.role !== "same-org-peer") {
    return apiErrorResponse("LINK_NOT_SAME_ORGANIZATION", "Work sync is available only to a same-organization peer.", 403);
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const limit = parseLimit(url.searchParams.get("limit"));
  const identity = await resolveFederationIdentity(prisma as unknown as FederationIdentityDb);
  const page = await buildFederatedWorkPage(prisma as unknown as WorkPageDb, {
    originInstallationId: identity.installationId,
    cursor: cursor && cursor.length <= 200 ? cursor : null,
    limit,
  });
  return NextResponse.json(page);
}
