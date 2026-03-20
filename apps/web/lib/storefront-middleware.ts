export enum RouteClass {
  Storefront = "storefront",
  Portal = "portal",
  PublicApi = "public_api",
  ProtectedApi = "protected_api",
  LegacyCustomerAuth = "legacy_customer_auth",
  EmployeeAuth = "employee_auth",
  Other = "other",
}

export function classifyRoute(pathname: string): RouteClass {
  if (pathname.startsWith("/s/")) return RouteClass.Storefront;
  if (pathname.startsWith("/portal")) return RouteClass.Portal;
  if (pathname.startsWith("/api/storefront/")) return RouteClass.PublicApi;
  if (pathname.startsWith("/api/")) return RouteClass.ProtectedApi;
  if (
    [
      "/customer-login",
      "/customer-signup",
      "/customer-link-account",
      "/customer-complete-profile",
    ].includes(pathname)
  )
    return RouteClass.LegacyCustomerAuth;
  if (pathname === "/login") return RouteClass.EmployeeAuth;
  return RouteClass.Other;
}
