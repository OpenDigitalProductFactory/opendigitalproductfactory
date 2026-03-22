import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { exchangeOAuthCode } from "@/lib/provider-oauth";

function appBase(): string {
  return process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000";
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login?error=unauthorized", appBase()));
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/platform/ai?oauth=error&reason=${encodeURIComponent(error)}`, appBase()));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/platform/ai?oauth=error&reason=missing_params", appBase()));
  }

  const result = await exchangeOAuthCode(state, code);

  if ("error" in result) {
    return NextResponse.redirect(new URL(`/platform/ai?oauth=error&reason=${encodeURIComponent(result.error)}`, appBase()));
  }

  return NextResponse.redirect(
    new URL(`/platform/ai/providers/${result.providerId}?oauth=success`, appBase()),
  );
}
