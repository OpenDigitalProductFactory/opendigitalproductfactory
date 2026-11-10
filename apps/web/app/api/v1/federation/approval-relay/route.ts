// POST /api/v1/federation/approval-relay
//
// EP-MSP-FEDERATION · B1 dual-approval relay. The peer tells us THEY approved
// their side of the link, so we flip our `approvedAtPeer`; once both sides have
// approved, resolveLinkTrust makes the link `trusted` and exchange can begin.
//
// Auth is intentionally token-valid-but-not-yet-trusted: this relay is HOW a
// pending link becomes trusted, so it cannot require a trusted link. We validate
// the peer-presented link token against the link we issued and accept any
// non-revoked link. Always on: the trusted link is the only switch.

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@dpf/db";

import { recordFederationPeerApproval } from "@/lib/federation/enrollment";
import { classifyFederationToken, hashToken } from "@/lib/federation/tokens";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const match = authHeader ? /^Bearer\s+(.+)$/.exec(authHeader.trim()) : null;
  const presented = match?.[1]?.trim();
  if (!presented || classifyFederationToken(presented) !== "link") {
    return NextResponse.json({ ok: false, error: "invalid_token" }, { status: 401 });
  }

  const link = await prisma.federationLink.findUnique({
    where: { tokenHash: hashToken(presented) },
    select: { linkId: true, revokedAt: true },
  });
  if (!link || link.revokedAt) {
    return NextResponse.json({ ok: false, error: "link_not_found_or_revoked" }, { status: 401 });
  }

  const linkState = await recordFederationPeerApproval(link.linkId);
  return NextResponse.json({ ok: true, linkId: link.linkId, linkState }, { status: 200 });
}
