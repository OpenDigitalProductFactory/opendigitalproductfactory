// @exposure private-mesh
//
// POST /api/v1/federation/enroll/organization — EP-ZERO-CONFIG-FEDERATION §5.6.
//
// A member of this installation's organization proves membership with the
// certificate its join package earned it: a signed enrolment statement plus its
// certificate chain, verified here against the pinned organization root at the
// message layer (no TLS overlay, no invitation token). On success the link is
// born trusted on both sides and the response carries this installation's own
// proof and the token the member must use to call back.
//
// No bearer token: the proof IS the credential. Anything short of a verified
// proof is refused with the reason; nothing is created.

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@dpf/db";

import { apiErrorResponse } from "@/lib/api/error";
import { acceptOrganizationEnrolment, type MembershipDb } from "@/lib/federation/organization-membership";
import { resolveLocalFederationAuthorityUrl } from "@/lib/federation/self-authority";
import { loadEstateNameResolution, prismaEstateIdentityStore } from "@/lib/install/estate-identity";

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiErrorResponse("INVALID_JSON", "Request body must be JSON.", 400);
  }
  const localAuthorityUrl = await resolveLocalFederationAuthorityUrl();
  if (!localAuthorityUrl) {
    return apiErrorResponse("SELF_AUTHORITY_UNKNOWN", "This installation does not know its own reachable address.", 503);
  }
  const estate = await loadEstateNameResolution(prismaEstateIdentityStore(prisma));
  const result = await acceptOrganizationEnrolment(prisma as unknown as MembershipDb, {
    envelope: body,
    localAuthorityUrl,
    displayName: estate.estateName ?? "Organization installation",
  });
  if (!result.accepted) {
    return apiErrorResponse("MEMBERSHIP_PROOF_REFUSED", `Membership proof refused: ${result.reason}`, result.status, { reason: result.reason });
  }
  return NextResponse.json({ linkId: result.linkId, linkToken: result.linkToken, role: "same-org-peer", linkState: "trusted", proof: result.proof }, { status: 201 });
}
