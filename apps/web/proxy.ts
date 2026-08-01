// apps/web/proxy.ts
// Single active middleware file for Next.js 16.
// All route policy decisions are centralised here. Layout guards provide
// defence-in-depth for role/capability checks within authenticated areas.

import { auth } from "@/lib/govern/auth-edge";
import { enforceCanonicalHost } from "@/lib/canonical-host";
import { classifyRoute, RouteClass } from "@/lib/storefront-middleware";
import {
  attachVersionHeaders,
  checkQuiescenceForRequest,
} from "@/lib/proxy/quiescence-gate";
import { NextResponse } from "next/server";
import type { NextAuthRequest } from "next-auth";

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};


/** Routes blocked when running as a sandbox instance (DPF_ENVIRONMENT=sandbox). */
const SANDBOX_BLOCKED_PREFIXES = ["/build", "/platform", "/admin"];
const isSandbox = process.env.DPF_ENVIRONMENT === "sandbox";

export default auth(async function proxy(req: NextAuthRequest) {
  // Canonical-host enforcement runs first: redirects non-canonical origins
  // (e.g. raw LAN IP) to PUBLIC_URL with Clear-Site-Data, eliminating
  // per-origin browser-storage divergence. Pass-through when PUBLIC_URL is
  // unset (local dev / bootstrap-before-DNS). Health probes excluded.
  const canonicalRedirect = enforceCanonicalHost(req);
  if (canonicalRedirect) return canonicalRedirect;

  // Activity Quiescence Protocol gate (BI-QUIESCE-003):
  //   - During swapping: 503 for everything except edge + health + state route.
  //   - During draining: 503 for mutation POSTs / new SSE handshakes;
  //                       GETs + page loads pass.
  //   - Always: inject X-Platform-Version + X-Bundle-Hash headers on the
  //     response (spec §7.2 defensive layer for stale-bundle detection).
  // Fail-open for reads, preserve-last-known for mutations (§6.4 / §12 Q6).
  const origin = req.nextUrl.origin;
  const quiescence = await checkQuiescenceForRequest(req, origin);
  if (quiescence.kind === "block") {
    return quiescence.response;
  }

  const { pathname } = req.nextUrl;

  // Sandbox instances exist for feature preview only — block admin,
  // platform config, and Build Studio to prevent infinite iframe nesting
  // and accidental configuration of a throwaway instance.
  if (isSandbox && SANDBOX_BLOCKED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    const url = req.nextUrl.clone();
    url.pathname = "/sandbox-restricted";
    return attachVersionHeaders(NextResponse.rewrite(url), quiescence.state);
  }

  const routeClass = classifyRoute(pathname);

  // ── Always public ─────────────────────────────────────────────────────────
  if (
    routeClass === RouteClass.Storefront ||
    routeClass === RouteClass.PublicApi ||
    routeClass === RouteClass.EmployeeAuth ||
    routeClass === RouteClass.PublicPage
  ) {
    return attachVersionHeaders(NextResponse.next(), quiescence.state);
  }

  // ── Legacy customer auth → 301 to canonical portal auth ─────────────────
  if (routeClass === RouteClass.LegacyCustomerAuth) {
    const target = pathname.includes("signup") ? "/portal/sign-up" : "/portal/sign-in";
    return attachVersionHeaders(NextResponse.redirect(new URL(target, req.url), 301), quiescence.state);
  }

  // ── Portal: requires customer session ────────────────────────────────────
  if (routeClass === RouteClass.Portal) {
    const user = req.auth?.user as { type?: string } | undefined;
    if (!user || user.type !== "customer") {
      return attachVersionHeaders(NextResponse.redirect(new URL("/portal/sign-in", req.url)), quiescence.state);
    }
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-pathname", pathname);
    return attachVersionHeaders(NextResponse.next({ request: { headers: requestHeaders } }), quiescence.state);
  }

  // ── Protected API: pass through — route handlers enforce their own auth ──
  if (routeClass === RouteClass.ProtectedApi) {
    return attachVersionHeaders(NextResponse.next(), quiescence.state);
  }

  // ── Everything else (Other): requires any authenticated session ───────────
  // Layout guards enforce employee-only for shell areas (/workspace, /platform, etc.)
  const user = req.auth?.user as { type?: string } | undefined;
  if (!user) {
    return attachVersionHeaders(NextResponse.redirect(new URL("/welcome", req.url)), quiescence.state);
  }

  // Forward pathname for server components (active-nav highlighting etc.)
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname);
  return attachVersionHeaders(
    NextResponse.next({ request: { headers: requestHeaders } }),
    quiescence.state,
  );
});
