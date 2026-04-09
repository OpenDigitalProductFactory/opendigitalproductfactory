// apps/web/proxy.ts
// Single active middleware file for Next.js 16.
// All route policy decisions are centralised here. Layout guards provide
// defence-in-depth for role/capability checks within authenticated areas.

import { auth } from "@/lib/auth";
import { classifyRoute, RouteClass } from "@/lib/storefront-middleware";
import { NextResponse } from "next/server";
import type { NextAuthRequest } from "next-auth";

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};


/** Routes blocked when running as a sandbox instance (DPF_ENVIRONMENT=sandbox). */
const SANDBOX_BLOCKED_PREFIXES = ["/build", "/platform", "/admin"];
const isSandbox = process.env.DPF_ENVIRONMENT === "sandbox";

export default auth(async function proxy(req: NextAuthRequest) {
  const { pathname } = req.nextUrl;

  // Sandbox instances exist for feature preview only — block admin,
  // platform config, and Build Studio to prevent infinite iframe nesting
  // and accidental configuration of a throwaway instance.
  if (isSandbox && SANDBOX_BLOCKED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    const url = req.nextUrl.clone();
    url.pathname = "/sandbox-restricted";
    return NextResponse.rewrite(url);
  }

  const routeClass = classifyRoute(pathname);

  // ── Always public ─────────────────────────────────────────────────────────
  if (
    routeClass === RouteClass.Storefront ||
    routeClass === RouteClass.PublicApi ||
    routeClass === RouteClass.EmployeeAuth ||
    routeClass === RouteClass.PublicPage
  ) {
    return NextResponse.next();
  }

  // ── Legacy customer auth → 301 to canonical portal auth ─────────────────
  if (routeClass === RouteClass.LegacyCustomerAuth) {
    const target = pathname.includes("signup") ? "/portal/sign-up" : "/portal/sign-in";
    return NextResponse.redirect(new URL(target, req.url), 301);
  }

  // ── Portal: requires customer session ────────────────────────────────────
  if (routeClass === RouteClass.Portal) {
    const user = req.auth?.user as { type?: string } | undefined;
    if (!user || user.type !== "customer") {
      return NextResponse.redirect(new URL("/portal/sign-in", req.url));
    }
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-pathname", pathname);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // ── Protected API: pass through — route handlers enforce their own auth ──
  if (routeClass === RouteClass.ProtectedApi) {
    return NextResponse.next();
  }

  // ── Everything else (Other): requires any authenticated session ───────────
  // Layout guards enforce employee-only for shell areas (/workspace, /platform, etc.)
  const user = req.auth?.user as { type?: string } | undefined;
  if (!user) {
    return NextResponse.redirect(new URL("/welcome", req.url));
  }

  // Forward pathname for server components (active-nav highlighting etc.)
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
});
