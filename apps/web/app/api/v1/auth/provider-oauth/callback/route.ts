import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getPortalUrl } from "@/lib/portal-url";
import {
  buildProviderOAuthErrorPath,
  exchangeOAuthCode,
  findPendingOAuthContext,
} from "@/lib/provider-oauth";

export async function GET(request: NextRequest) {
  const appBase = await getPortalUrl();
  const state = request.nextUrl.searchParams.get("state");
  // Verify admin is authenticated
  const session = await auth();
  if (!session?.user || !can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "manage_provider_connections")) {
    return NextResponse.redirect(new URL("/login?error=unauthorized", appBase));
  }
  const pending = await findPendingOAuthContext(state);

  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  // Provider returned an error (e.g., user denied consent)
  if (error) {
    return NextResponse.redirect(new URL(buildProviderOAuthErrorPath(pending?.providerId, error, pending?.connectionId), appBase));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL(buildProviderOAuthErrorPath(pending?.providerId, "missing_params", pending?.connectionId), appBase));
  }

  const result = await exchangeOAuthCode(state, code);

  if ("error" in result) {
    return NextResponse.redirect(new URL(buildProviderOAuthErrorPath(pending?.providerId, result.error, pending?.connectionId), appBase));
  }

  return NextResponse.redirect(
    new URL(`/platform/ai/providers/${result.providerId}?oauth=success${result.connectionId ? `&account=${encodeURIComponent(result.connectionId)}` : ""}`, appBase),
  );
}
