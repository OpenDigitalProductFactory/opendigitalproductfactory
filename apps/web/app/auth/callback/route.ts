import { NextRequest, NextResponse } from "next/server";
import { getPortalUrl } from "@/lib/portal-url";
import {
  buildProviderOAuthErrorPath,
  exchangeOAuthCode,
  findPendingOAuthProviderId,
} from "@/lib/provider-oauth";

// This callback runs on a different port (e.g. 1455 for Codex) so the
// session cookie from port 3000 isn't available. The OAuthPendingFlow
// state parameter provides CSRF protection instead of session auth.

export async function GET(request: NextRequest) {
  const appBase = await getPortalUrl();
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");
  const pendingProviderId = await findPendingOAuthProviderId(state);

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
