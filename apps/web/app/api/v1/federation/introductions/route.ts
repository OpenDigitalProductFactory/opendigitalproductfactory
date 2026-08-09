import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@dpf/db";

import { resolveFederationLinkAuth } from "@/lib/auth/federation-link-token";
import {
  introductionsForAuthenticatedPeer,
  type IntroductionExchangeDb,
} from "@/lib/federation/introduction-exchange";
import { envFlagEnabled } from "@/lib/runtime/env-flags";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!envFlagEnabled(process.env, "DPF_FEDERATION_EXCHANGE_ENABLED")) {
    return NextResponse.json({ ok: false, error: "federation_exchange_disabled" }, { status: 404 });
  }
  const authz = await resolveFederationLinkAuth(request.headers.get("authorization"));
  if (!authz.ok) {
    return NextResponse.json({ ok: false, error: authz.error, message: authz.message }, { status: authz.error === "link_not_trusted" ? 403 : 401 });
  }
  const introductions = await introductionsForAuthenticatedPeer(
    prisma as unknown as IntroductionExchangeDb,
    authz.linkId,
  );
  return NextResponse.json({ ok: true, introductions }, { status: 200 });
}
