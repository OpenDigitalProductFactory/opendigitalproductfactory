// POST /api/v1/federation/enroll
//
// EP-MSP-FEDERATION · B1 (BI-130107D6). The connecting peer redeems a dpffboot_
// invitation (Authorization: Bearer) to establish a FederationLink. Mirrors the
// edge enroll route: the bootstrap token rides the Authorization header only
// (never the body, to avoid operator-pasted-token-leaks-into-logs), the body
// carries the peer's enrollment claims. The link is created PENDING — dual
// approval (our operator + the peer) is required before it is trusted.

import { NextResponse, type NextRequest } from "next/server";

import { enrollFederationLink } from "@/lib/federation/enrollment";
import { FederationEnrollBody } from "@/lib/federation/wire-contract";

const ERROR_STATUS: Record<string, number> = {
  invalid_token_format: 401,
  token_not_found: 401,
  token_expired: 401,
  token_already_consumed: 401,
  token_revoked: 401,
  invalid_role: 400,
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json({ ok: false, error: "missing_authorization" }, { status: 401 });
  }
  const match = /^Bearer\s+(.+)$/.exec(authHeader.trim());
  if (!match) {
    return NextResponse.json({ ok: false, error: "invalid_scheme" }, { status: 401 });
  }
  const bootstrapToken = match[1]!.trim();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = FederationEnrollBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_body", issues: parsed.error.format() },
      { status: 400 },
    );
  }

  const result = await enrollFederationLink({
    bootstrapToken,
    peerAuthorityUrl: parsed.data.peerAuthorityUrl,
    displayName: parsed.data.displayName,
    ...(parsed.data.peerOrganizationRef !== undefined
      ? { peerOrganizationRef: parsed.data.peerOrganizationRef }
      : {}),
    ...(parsed.data.localOrganizationId !== undefined
      ? { localOrganizationId: parsed.data.localOrganizationId }
      : {}),
    ...(parsed.data.callbackToken !== undefined
      ? { callbackToken: parsed.data.callbackToken }
      : {}),
    ...(parsed.data.peerDeviceId !== undefined
      ? { peerDeviceId: parsed.data.peerDeviceId }
      : {}),
    ...(parsed.data.metadata !== undefined ? { metadata: parsed.data.metadata } : {}),
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, message: result.message },
      { status: ERROR_STATUS[result.error] ?? 400 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      linkId: result.linkId,
      // Plaintext link token — shown once; the peer persists only its hash.
      linkToken: result.linkToken,
      role: result.role,
      linkState: result.linkState,
    },
    { status: 200 },
  );
}
