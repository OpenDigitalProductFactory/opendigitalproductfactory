import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  buildProviderOAuthErrorPath,
  exchangeOAuthCode,
  findPendingOAuthProviderId,
} from "@/lib/provider-oauth";

// Inside Docker, request.url resolves to http://0.0.0.0:3000 which browsers can't reach.
function appBase(): string {
  return process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000";
}

export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state");
  const pendingProviderId = await findPendingOAuthProviderId(state);
  // Verify admin is authenticated
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login?error=unauthorized", appBase()));
  }

  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  // Provider returned an error (e.g., user denied consent)
  if (error) {
    return NextResponse.redirect(new URL(buildProviderOAuthErrorPath(pendingProviderId, error), appBase()));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL(buildProviderOAuthErrorPath(pendingProviderId, "missing_params"), appBase()));
  }

  const result = await exchangeOAuthCode(state, code);

  if ("error" in result) {
    return NextResponse.redirect(new URL(buildProviderOAuthErrorPath(pendingProviderId, result.error), appBase()));
  }

  return NextResponse.redirect(
    new URL(`/platform/ai/providers/${result.providerId}?oauth=success`, appBase()),
  );
}
