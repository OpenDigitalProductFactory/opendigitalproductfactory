// apps/web/middleware.ts
//
// Edge middleware — runs before every matched route.
// Currently handles sandbox environment restrictions.

import { NextResponse, type NextRequest } from "next/server";

/**
 * Routes that must not be accessible when the app is running as a sandbox.
 * Sandbox instances exist for feature preview only — admin, platform config,
 * and Build Studio would either cause infinite recursion (Build Studio embeds
 * sandbox preview) or let users accidentally configure a throwaway instance.
 */
const SANDBOX_BLOCKED_PREFIXES = ["/build", "/platform", "/admin"];

export function middleware(request: NextRequest) {
  if (process.env.DPF_ENVIRONMENT === "sandbox") {
    const { pathname } = request.nextUrl;
    if (SANDBOX_BLOCKED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
      const url = request.nextUrl.clone();
      url.pathname = "/sandbox-restricted";
      return NextResponse.rewrite(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Only run middleware on shell routes that might need blocking.
  // Excludes API routes, static assets, and Next.js internals.
  matcher: ["/build/:path*", "/platform/:path*", "/admin/:path*"],
};
