// apps/web/app/callback/route.ts
// Short OAuth callback route for localhost-restricted providers (Anthropic, Codex).
// Maps to {APP_URL}/callback — matches localhost/callback redirect URI patterns.
// See also: /api/v1/auth/provider-oauth/callback (for providers that accept arbitrary redirect URIs).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPortalUrl } from "@/lib/portal-url";
import {
  buildProviderOAuthErrorPath,
  exchangeOAuthCode,
  findPendingOAuthProviderId,
} from "@/lib/provider-oauth";

export async function GET(request: NextRequest) {
  const appBase = await getPortalUrl();
  const state = request.nextUrl.searchParams.get("state");
  const pendingProviderId = await findPendingOAuthProviderId(state);
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login?error=unauthorized", appBase));
  }

  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(buildProviderOAuthErrorPath(pendingProviderId, error), appBase));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL(buildProviderOAuthErrorPath(pendingProviderId, "missing_params"), appBase));
  }

  const result = await exchangeOAuthCode(state, code);

  if ("error" in result) {
    return NextResponse.redirect(new URL(buildProviderOAuthErrorPath(pendingProviderId, result.error), appBase));
  }

  return NextResponse.redirect(
    new URL(`/platform/ai/providers/${result.providerId}?oauth=success`, appBase),
  );
}
