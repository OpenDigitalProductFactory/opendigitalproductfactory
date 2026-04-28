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
  // Verify admin is authenticated
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login?error=unauthorized", appBase));
  }

  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  // Provider returned an error (e.g., user denied consent)
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
