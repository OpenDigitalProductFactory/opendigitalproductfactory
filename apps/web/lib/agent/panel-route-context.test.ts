import { describe, expect, it } from "vitest";
import { resolvePanelRouteContextLabel } from "./panel-route-context";

describe("resolvePanelRouteContextLabel (BI-3238AAF0)", () => {
  it("names top-level business areas from the canonical nav model", () => {
    expect(resolvePanelRouteContextLabel("/workspace")).toBe("Workspace");
    expect(resolvePanelRouteContextLabel("/finance")).toBe("Finance");
    expect(resolvePanelRouteContextLabel("/customer")).toBe("Customer");
  });

  it("prefers the deepest modelled context for nested routes", () => {
    expect(resolvePanelRouteContextLabel("/customer/marketing")).toBe("Marketing");
  });

  it("falls back to the deepest KNOWN ancestor for unmodelled deep routes", () => {
    // An id-bearing tail should never surface raw — it resolves to the nearest
    // modelled ancestor instead.
    expect(resolvePanelRouteContextLabel("/finance/ledgers/LEDGER-9f3a")).toBe("Finance");
  });

  it("title-cases the top-level domain when nothing is modelled", () => {
    expect(resolvePanelRouteContextLabel("/totally-unknown-area/thing")).toBe(
      "Totally Unknown Area",
    );
  });

  it("ignores query strings and hashes", () => {
    expect(resolvePanelRouteContextLabel("/finance?tab=ap#top")).toBe("Finance");
  });

  it("defaults to Workspace for empty or root paths", () => {
    expect(resolvePanelRouteContextLabel("/")).toBe("Workspace");
    expect(resolvePanelRouteContextLabel("")).toBe("Workspace");
    expect(resolvePanelRouteContextLabel(null)).toBe("Workspace");
    expect(resolvePanelRouteContextLabel(undefined)).toBe("Workspace");
  });
});
