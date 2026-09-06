// @exposure public — reached by the platform's own browser before any session exists; the one-time signed token in the query is the credential (BI-9369DEB5), and it is refused on installations whose environment class does not permit an automation sign-in.
//
// GET /api/automation/sign-in?token=<one-time token>
//
// Exchanges a token minted by `mintAutomationSignIn` for the same JWT session
// cookie Auth.js issues after a credentials sign-in, then redirects to the
// path the token was minted for. The cookie name, secure flag and encoding
// salt are the ones the Auth.js configuration uses, so `auth()` reads this
// session exactly like any other.

import { NextResponse, type NextRequest } from "next/server";
import { encode } from "next-auth/jwt";

import { apiErrorResponse } from "@/lib/api/error";
import { SESSION_COOKIE_NAME, SESSION_COOKIE_SECURE } from "@/lib/govern/auth";
import { getPortalUrl } from "@/lib/portal-url";
import {
  AUTOMATION_SESSION_MAX_AGE_SECONDS,
  consumeAutomationSignIn,
} from "@/lib/govern/automation-sign-in";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const token = request.nextUrl.searchParams.get("token")?.trim() ?? "";
  if (!token) return apiErrorResponse("INVALID_INPUT", "A sign-in token is required", 400);

  const outcome = await consumeAutomationSignIn(token);
  if (!outcome.accepted) {
    const status = outcome.reason.startsWith("environment class") ? 403 : 401;
    return apiErrorResponse(status === 403 ? "FORBIDDEN" : "UNAUTHORIZED", outcome.reason, status);
  }

  const secret = process.env.AUTH_SECRET;
  if (!secret) return apiErrorResponse("TEMPORARILY_UNAVAILABLE", "AUTH_SECRET is not configured", 500);

  const sessionToken = await encode({
    token: { ...outcome.claims },
    secret,
    salt: SESSION_COOKIE_NAME,
    maxAge: AUTOMATION_SESSION_MAX_AGE_SECONDS,
  });

  // Redirect back to the origin the browser used, not `request.nextUrl.origin`:
  // the standalone server derives that from the HOSTNAME it binds (0.0.0.0 in
  // the image), which no browser can follow (BI-FEE77B68).
  const response = NextResponse.redirect(new URL(outcome.nextPath, await getPortalUrl()), { status: 303 });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: sessionToken,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: SESSION_COOKIE_SECURE,
    maxAge: AUTOMATION_SESSION_MAX_AGE_SECONDS,
  });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
