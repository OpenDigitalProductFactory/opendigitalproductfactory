// apps/web/app/callback/route.ts
// Short OAuth callback route for localhost-restricted providers (Anthropic, Codex).
// Maps to {APP_URL}/callback — matches localhost/callback redirect URI patterns.
// See also: /api/v1/auth/provider-oauth/callback (for providers that accept arbitrary redirect URIs).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { exchangeOAuthCode } from "@/lib/provider-oauth";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login?error=unauthorized", request.url));
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/platform/ai?oauth=error&reason=${encodeURIComponent(error)}`, request.url));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/platform/ai?oauth=error&reason=missing_params", request.url));
  }

  const result = await exchangeOAuthCode(state, code);

  if ("error" in result) {
    return NextResponse.redirect(new URL(`/platform/ai?oauth=error&reason=${encodeURIComponent(result.error)}`, request.url));
  }

  return NextResponse.redirect(
    new URL(`/platform/ai/providers/${result.providerId}?oauth=success`, request.url),
  );
}
