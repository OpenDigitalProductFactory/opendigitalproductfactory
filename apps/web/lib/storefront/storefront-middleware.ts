export enum RouteClass {
  Storefront = "storefront",         // /s/** — always public
  Portal = "portal",                 // /portal/** — requires customer session
  PublicApi = "public_api",          // /api/storefront/** + /api/auth/** + health/calendar/docs
  ProtectedApi = "protected_api",    // /api/** — auth enforced at route level, middleware passes through
  LegacyCustomerAuth = "legacy_customer_auth", // /customer-login, /customer-signup — 301 to canonical
  EmployeeAuth = "employee_auth",    // /login — always public
  PublicPage = "public_page",        // /welcome, /forgot-password, /reset-password, /customer-link-account, /customer-complete-profile
  Other = "other",                   // everything else — requires any authenticated session
}

// Only these two legacy routes are 301-redirected. The link-account and
// complete-profile routes are real pages (social auth continuation) and stay public.
const LEGACY_REDIRECT_PATHS = ["/customer-login", "/customer-signup"];

export function classifyRoute(pathname: string): RouteClass {
  // RFC 8615 well-known URIs are machine-discovery endpoints and MUST be
  // publicly fetchable pre-auth. The mobile app's "connect to your org" flow
  // fetches /.well-known/dpf-instance.json BEFORE login; without this the
  // descriptor falls through to RouteClass.Other, the proxy redirects the
  // unauthenticated request to /welcome, and the app receives HTML instead of
  // JSON (BI-2AC1307A). Also covers the P2 universal-link / app-link assets
  // (apple-app-site-association, assetlinks.json) which are public by spec.
  if (pathname.startsWith("/.well-known/")) return RouteClass.PublicApi;
  if (pathname.startsWith("/s/")) return RouteClass.Storefront;
  if (pathname === "/portal/sign-in" || pathname === "/portal/sign-up") return RouteClass.PublicPage;
  if (pathname.startsWith("/portal")) return RouteClass.Portal;
  if (pathname.startsWith("/api/storefront/")) return RouteClass.PublicApi;
  if (pathname.startsWith("/api/auth/")) return RouteClass.PublicApi;
  // BI-9369DEB5: the platform's own browser arrives with a one-time token, not a session.
  if (pathname === "/api/automation/sign-in") return RouteClass.PublicApi;
  // OAuth 2.1 authorization server for the MCP resource (BI-E4DFDCB0). These
  // MUST be reachable before any DPF session exists — that is the whole point
  // of the flow: a client with no credential discovers the AS from a 401 and
  // arrives here to get one. Reachability is not authority: /token
  // authenticates the CLIENT (PKCE verifier or client secret), /revoke does the
  // same, /register grants nothing on its own and is policy-gated to loopback
  // by default, and /authorize redirects an unauthenticated browser to sign-in
  // before it will render consent.
  if (pathname.startsWith("/api/oauth/")) return RouteClass.PublicApi;
  if (pathname.startsWith("/api/health")) return RouteClass.PublicApi;
  if (pathname.startsWith("/api/calendar/")) return RouteClass.PublicApi;
  if (pathname.startsWith("/api/docs")) return RouteClass.PublicApi;
  if (pathname.startsWith("/api/")) return RouteClass.ProtectedApi;
  if (LEGACY_REDIRECT_PATHS.includes(pathname)) return RouteClass.LegacyCustomerAuth;
  if (pathname === "/login") return RouteClass.EmployeeAuth;
  if (
    pathname === "/" ||
    pathname === "/setup" ||
    pathname === "/welcome" ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/customer-link-account") ||
    pathname.startsWith("/customer-complete-profile")
  ) {
    return RouteClass.PublicPage;
  }
  return RouteClass.Other;
}
