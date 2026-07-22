import { describe, expect, it } from "vitest";
import { resolveQuickHelp, getQuickHelpRoutes, type QuickHelp } from "./docs-quick-help";

const REQUIRED_FIELDS: Array<keyof QuickHelp> = [
  "whatThisPageIs",
  "actionNow",
  "ifNothingDone",
  "reversible",
  "recovery",
];

describe("resolveQuickHelp", () => {
  it("returns route-specific help for each required workflow surface, answering all five questions", () => {
    for (const route of ["/storefront/inbox", "/storefront/settings/business", "/ops/self-upgrade", "/customer/marketing"]) {
      const help = resolveQuickHelp(route);
      expect(help, `expected quick help for ${route}`).not.toBeNull();
      for (const field of REQUIRED_FIELDS) {
        expect(help![field], `${route} is missing ${field}`).toBeTruthy();
      }
    }
  });

  it("gives self-upgrade recovery-focused guidance distinct from the generic ops backlog help", () => {
    const selfUpgrade = resolveQuickHelp("/ops/self-upgrade");
    const opsBacklog = resolveQuickHelp("/ops/promotions");

    expect(selfUpgrade).not.toBeNull();
    expect(opsBacklog).not.toBeNull();
    expect(selfUpgrade!.whatThisPageIs).not.toBe(opsBacklog!.whatThisPageIs);
    // Self-upgrade guidance names its safety net so the reader knows it is recoverable.
    expect(selfUpgrade!.reversible.toLowerCase()).toContain("rolled back");
  });

  it("resolves by longest matching prefix so a leaf route overrides the family default", () => {
    const business = resolveQuickHelp("/storefront/settings/business");
    const operations = resolveQuickHelp("/storefront/settings/operations");

    // The business leaf has its own entry…
    expect(business!.whatThisPageIs).toContain("business-context");
    // …while an unlisted sibling falls back to the /storefront/settings family entry.
    expect(operations!.whatThisPageIs).toContain("presentation");
    expect(operations!.whatThisPageIs).not.toBe(business!.whatThisPageIs);
  });

  it("returns null for unknown or non-internal source routes", () => {
    expect(resolveQuickHelp(undefined)).toBeNull();
    expect(resolveQuickHelp(null)).toBeNull();
    expect(resolveQuickHelp("")).toBeNull();
    expect(resolveQuickHelp("https://example.com")).toBeNull();
    expect(resolveQuickHelp("/finance/banking")).toBeNull();
  });

  it("exposes its registered routes for coverage checks", () => {
    const routes = getQuickHelpRoutes();
    expect(routes).toContain("/ops/self-upgrade");
    expect(routes).toContain("/customer/marketing");
  });
});
