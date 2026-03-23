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
  if (pathname.startsWith("/s/")) return RouteClass.Storefront;
  if (pathname === "/portal/sign-in" || pathname === "/portal/sign-up") return RouteClass.PublicPage;
  if (pathname.startsWith("/portal")) return RouteClass.Portal;
  if (pathname.startsWith("/api/storefront/")) return RouteClass.PublicApi;
  if (pathname.startsWith("/api/auth/")) return RouteClass.PublicApi;
  if (pathname.startsWith("/api/health")) return RouteClass.PublicApi;
  if (pathname.startsWith("/api/calendar/")) return RouteClass.PublicApi;
  if (pathname.startsWith("/api/docs")) return RouteClass.PublicApi;
  if (pathname.startsWith("/api/")) return RouteClass.ProtectedApi;
  if (LEGACY_REDIRECT_PATHS.includes(pathname)) return RouteClass.LegacyCustomerAuth;
  if (pathname === "/login") return RouteClass.EmployeeAuth;
  if (
    pathname === "/" ||
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
