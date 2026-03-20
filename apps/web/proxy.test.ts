import { describe, expect, it } from "vitest";
import { classifyRoute, RouteClass } from "./lib/storefront-middleware";

describe("proxy route classification", () => {
  it("classifies storefront pages as always public", () => {
    expect(classifyRoute("/s/mystore")).toBe(RouteClass.Storefront);
    expect(classifyRoute("/s/mystore/sign-in")).toBe(RouteClass.Storefront);
    expect(classifyRoute("/s/mystore/sign-up")).toBe(RouteClass.Storefront);
    expect(classifyRoute("/s/mystore/browse")).toBe(RouteClass.Storefront);
  });

  it("classifies employee auth and public pages correctly", () => {
    expect(classifyRoute("/login")).toBe(RouteClass.EmployeeAuth);
    expect(classifyRoute("/forgot-password")).toBe(RouteClass.PublicPage);
    expect(classifyRoute("/reset-password")).toBe(RouteClass.PublicPage);
    expect(classifyRoute("/welcome")).toBe(RouteClass.PublicPage);
    expect(classifyRoute("/")).toBe(RouteClass.PublicPage);
  });

  it("classifies social auth continuation pages as public (not legacy redirects)", () => {
    expect(classifyRoute("/customer-link-account")).toBe(RouteClass.PublicPage);
    expect(classifyRoute("/customer-complete-profile")).toBe(RouteClass.PublicPage);
  });

  it("classifies old customer login/signup as legacy redirects", () => {
    expect(classifyRoute("/customer-login")).toBe(RouteClass.LegacyCustomerAuth);
    expect(classifyRoute("/customer-signup")).toBe(RouteClass.LegacyCustomerAuth);
  });

  it("classifies portal as requiring customer session", () => {
    expect(classifyRoute("/portal")).toBe(RouteClass.Portal);
    expect(classifyRoute("/portal/orders")).toBe(RouteClass.Portal);
    expect(classifyRoute("/portal/support")).toBe(RouteClass.Portal);
  });

  it("classifies public API routes", () => {
    expect(classifyRoute("/api/storefront/config")).toBe(RouteClass.PublicApi);
    expect(classifyRoute("/api/auth/callback/google")).toBe(RouteClass.PublicApi);
    expect(classifyRoute("/api/health")).toBe(RouteClass.PublicApi);
    expect(classifyRoute("/api/calendar/feed")).toBe(RouteClass.PublicApi);
    expect(classifyRoute("/api/docs")).toBe(RouteClass.PublicApi);
  });

  it("classifies protected API routes (auth enforced at route level)", () => {
    expect(classifyRoute("/api/workspace/portfolio")).toBe(RouteClass.ProtectedApi);
    expect(classifyRoute("/api/platform/users")).toBe(RouteClass.ProtectedApi);
  });

  it("classifies shell/workspace areas as requiring auth", () => {
    expect(classifyRoute("/workspace")).toBe(RouteClass.Other);
    expect(classifyRoute("/platform")).toBe(RouteClass.Other);
    expect(classifyRoute("/compliance")).toBe(RouteClass.Other);
    expect(classifyRoute("/storefront")).toBe(RouteClass.Other);
  });
});
