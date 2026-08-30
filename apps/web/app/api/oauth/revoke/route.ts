// @exposure public — RFC 7009 revocation. Callers authenticate as the OAuth client, not as a DPF session.
// POST /api/oauth/revoke — RFC 7009 token revocation.
//
// Revocation is the property that justified opaque tokens over signed JWTs
// (see oauth-tokens.ts): "revoke" has to mean revoked on the next call, not
// revoked when the signature expires.
//
// RFC 7009 §2.2 requires 200 for an unknown token as well as a revoked one.
// That is deliberate and not laziness: distinguishing them would turn this
// endpoint into an oracle for guessing valid tokens.


// Error bodies here are RFC 6749 §5.2 shaped ({ error, error_description }),
// NOT the platform apiErrorResponse shape ({ code, message }). An OAuth client
// parses `error` to decide what to do next — re-authorize, step up, or give up —
// so emitting `code` instead would break the protocol for every conformant
// client. This is the one place the house error contract must yield to the wire
// contract; the raw-route-error baseline records it deliberately.

import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@dpf/db";
import { findClientByClientId } from "@/lib/auth/oauth-clients";
import { ACCESS_TOKEN_PREFIX, REFRESH_TOKEN_PREFIX, secretMatches, revokeRefreshFamily } from "@/lib/auth/oauth-tokens";

export const dynamic = "force-dynamic";

function ok(): Response {
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Body must be form-encoded." },
      { status: 400 },
    );
  }

  const presented = form.get("token")?.trim() ?? "";
  const clientId = form.get("client_id")?.trim() ?? "";
  if (!presented || !clientId) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "token and client_id are required." },
      { status: 400 },
    );
  }

  const client = await findClientByClientId(clientId);
  if (!client) return ok();

  // A confidential client must authenticate, so one client cannot revoke
  // another's tokens. A public client is identified by client_id alone, which
  // is all RFC 7009 requires of it.
  if (client.clientSecretHash) {
    const secret = form.get("client_secret")?.trim() ?? "";
    if (!secret || !secretMatches(secret, client.clientSecretHash)) {
      return NextResponse.json(
        { error: "invalid_client", error_description: "Client authentication failed." },
        { status: 401 },
      );
    }
  }

  const hash = createHash("sha256").update(presented).digest("hex");

  if (presented.startsWith(ACCESS_TOKEN_PREFIX)) {
    await prisma.mcpApiToken.updateMany({
      where: { tokenHash: hash, oauthClientId: client.rowId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "client_revoked" },
    });
    return ok();
  }

  if (presented.startsWith(REFRESH_TOKEN_PREFIX)) {
    const row = await prisma.oAuthRefreshToken.findUnique({
      where: { tokenHash: hash },
      select: { id: true, oauthClientId: true },
    });
    // Revoking a refresh token revokes its whole rotation chain — otherwise a
    // successor issued moments earlier would still be live, which is not what
    // anyone means by "revoke".
    if (row && row.oauthClientId === client.rowId) {
      await revokeRefreshFamily(row.id, "client_revoked");
    }
    return ok();
  }

  // Unrecognised token type: still 200, per RFC 7009 §2.2.
  return ok();
}
