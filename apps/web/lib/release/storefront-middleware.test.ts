import { describe, it, expect } from "vitest";
import { classifyRoute, RouteClass } from "./storefront-middleware";

describe("classifyRoute", () => {
  it("classifies /s/* as storefront", () => {
    expect(classifyRoute("/s/acme-vet")).toBe(RouteClass.Storefront);
    expect(classifyRoute("/s/acme-vet/sign-in")).toBe(RouteClass.Storefront);
  });

  it("classifies /portal/* as portal", () => {
    expect(classifyRoute("/portal")).toBe(RouteClass.Portal);
    expect(classifyRoute("/portal/orders")).toBe(RouteClass.Portal);
  });

  it("classifies /api/storefront/* as public api", () => {
    expect(classifyRoute("/api/storefront/acme-vet/items")).toBe(RouteClass.PublicApi);
  });

  it("classifies the well-known discovery namespace as public (BI-2AC1307A)", () => {
    // The mobile connect flow fetches this pre-auth; it must not be redirected
    // to /welcome. Also covers the universal-link / app-link assets.
    expect(classifyRoute("/.well-known/dpf-instance.json")).toBe(RouteClass.PublicApi);
    expect(classifyRoute("/.well-known/apple-app-site-association")).toBe(RouteClass.PublicApi);
    expect(classifyRoute("/.well-known/assetlinks.json")).toBe(RouteClass.PublicApi);
  });

  it("classifies /api/* as protected api", () => {
    expect(classifyRoute("/api/agents")).toBe(RouteClass.ProtectedApi);
  });

  it("classifies /customer-login as legacy customer auth", () => {
    expect(classifyRoute("/customer-login")).toBe(RouteClass.LegacyCustomerAuth);
  });

  it("classifies /login as employee auth", () => {
    expect(classifyRoute("/login")).toBe(RouteClass.EmployeeAuth);
  });

  it("classifies /setup as public first-run page", () => {
    expect(classifyRoute("/setup")).toBe(RouteClass.PublicPage);
  });
});
