// @exposure private-mesh
//
// POST /api/v1/federation/membership/sign — EP-ZERO-CONFIG-FEDERATION,
// portal-mediated membership §5.1.
//
// A member installation holding an organization join file sends the CSR for a
// key it generated plus the file's one-time enrollment token. This authority
// portal relays both to its step-ca over the private compose network and
// returns the CA's verdict verbatim. No bearer: the enrollment token is the
// credential, and only the CA can honour it. On an installation that is not
// the organization authority the route answers 404, so a member never learns
// anything from a portal that cannot sign.

import { NextResponse, type NextRequest } from "next/server";

import { apiErrorResponse } from "@/lib/api/error";
import {
  membershipRelayAvailable,
  parseMembershipSignRequest,
  relayMembershipSign,
} from "@/lib/federation/membership-relay";

function callerKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const relay = await membershipRelayAvailable();
  if (!relay.available) {
    return apiErrorResponse("NOT_FOUND", "Not found.", 404);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiErrorResponse("INVALID_JSON", "Request body must be JSON.", 400);
  }
  const parsed = parseMembershipSignRequest(body);
  if (!parsed) {
    return NextResponse.json({ accepted: false, reason: "malformed" }, { status: 400 });
  }
  const result = await relayMembershipSign({ request: parsed, callerKey: callerKey(request) }, { rootPem: relay.rootPem });
  if (!result.accepted) {
    const status = result.reason === "rate-limited" ? 429 : result.reason === "ca-unreachable" ? 503 : 403;
    const headers = result.retryAfterSeconds ? { "retry-after": String(result.retryAfterSeconds) } : undefined;
    return NextResponse.json({ accepted: false, reason: result.reason, ...(result.detail ? { detail: result.detail } : {}) }, { status, headers });
  }
  return NextResponse.json({ accepted: true, certPem: result.certPem, chainPems: result.chainPems, rootPem: result.rootPem }, { status: 200 });
}
