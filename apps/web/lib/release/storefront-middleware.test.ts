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

  it("classifies /api/* as protected api", () => {
    expect(classifyRoute("/api/agents")).toBe(RouteClass.ProtectedApi);
  });

  it("classifies /customer-login as legacy customer auth", () => {
    expect(classifyRoute("/customer-login")).toBe(RouteClass.LegacyCustomerAuth);
  });

  it("classifies /login as employee auth", () => {
    expect(classifyRoute("/login")).toBe(RouteClass.EmployeeAuth);
  });
});
