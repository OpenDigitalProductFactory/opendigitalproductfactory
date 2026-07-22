import { describe, expect, it } from "vitest";

import { getQuickHelpRoutes, resolveQuickHelp, type QuickHelp } from "./docs-quick-help";
import { buildContextualDocsHref, resolveDocsPath } from "./docs-route-map";

/** Every quick-help panel must answer all five questions with real copy. */
function expectAnswersAllFive(help: QuickHelp | null): asserts help is QuickHelp {
  expect(help).not.toBeNull();
  const h = help!;
  for (const key of ["whatThisPageIs", "actionNow", "ifNothingDone", "reversible", "recovery"] as const) {
    expect(h[key].trim().length, `${key} should be non-empty`).toBeGreaterThan(0);
  }
}

describe("resolveQuickHelp — required routes", () => {
  const REQUIRED: Array<{ label: string; route: string }> = [
    { label: "storefront inbox", route: "/storefront/inbox" },
    { label: "storefront business settings", route: "/storefront/settings/business" },
    { label: "self-upgrade", route: "/ops/self-upgrade" },
    { label: "customer marketing", route: "/customer/marketing" },
  ];

  for (const { label, route } of REQUIRED) {
    it(`answers all five questions for ${label} (${route})`, () => {
      expectAnswersAllFive(resolveQuickHelp(route));
    });

    it(`still resolves for a leaf under ${route}`, () => {
      expectAnswersAllFive(resolveQuickHelp(`${route}/EX-001`));
    });
  }
});

describe("resolveQuickHelp — longest-prefix specificity", () => {
  it("self-upgrade gets its own help, not the generic /ops backlog help", () => {
    const selfUpgrade = resolveQuickHelp("/ops/self-upgrade");
    const opsBacklog = resolveQuickHelp("/ops/demand");
    expect(selfUpgrade).not.toBeNull();
    expect(opsBacklog).not.toBeNull();
    expect(selfUpgrade!.whatThisPageIs).not.toBe(opsBacklog!.whatThisPageIs);
    expect(selfUpgrade!.whatThisPageIs.toLowerCase()).toContain("upgrad");
  });

  it("business settings override the generic settings help", () => {
    const business = resolveQuickHelp("/storefront/settings/business");
    const settings = resolveQuickHelp("/storefront/settings");
    expect(business).not.toBeNull();
    expect(settings).not.toBeNull();
    expect(business!.whatThisPageIs).not.toBe(settings!.whatThisPageIs);
  });
});

describe("resolveQuickHelp — misses", () => {
  it("returns null for routes without dedicated help", () => {
    expect(resolveQuickHelp("/finance/reports")).toBeNull();
  });

  it("returns null for empty or external inputs", () => {
    expect(resolveQuickHelp(undefined)).toBeNull();
    expect(resolveQuickHelp(null)).toBeNull();
    expect(resolveQuickHelp("")).toBeNull();
    expect(resolveQuickHelp("https://example.com")).toBeNull();
  });
});

describe("self-upgrade is not generic operations", () => {
  it("resolves the source route to a dedicated self-upgrade doc", () => {
    expect(resolveDocsPath("/ops/self-upgrade")).toBe("/docs/operations/self-upgrade");
    // The generic operations backlog still maps to its own index.
    expect(resolveDocsPath("/ops/demand")).toBe("/docs/operations/index");
  });

  it("builds a contextual href that carries the source route back", () => {
    expect(buildContextualDocsHref("/ops/self-upgrade")).toBe(
      "/docs/operations/self-upgrade?sourceRoute=%2Fops%2Fself-upgrade",
    );
  });
});

describe("buildContextualDocsHref — required routes preserve sourceRoute", () => {
  const CASES: Array<[route: string, href: string]> = [
    ["/storefront/inbox", "/docs/storefront/inbox-and-enquiries?sourceRoute=%2Fstorefront%2Finbox"],
    [
      "/storefront/settings/business",
      "/docs/storefront/settings-business-and-operations?sourceRoute=%2Fstorefront%2Fsettings%2Fbusiness",
    ],
    ["/customer/marketing", "/docs/customers/marketing?sourceRoute=%2Fcustomer%2Fmarketing"],
  ];

  for (const [route, href] of CASES) {
    it(`${route} → ${href}`, () => {
      expect(buildContextualDocsHref(route)).toBe(href);
    });
  }
});

describe("getQuickHelpRoutes", () => {
  it("exposes the registered route prefixes for auditing", () => {
    const routes = getQuickHelpRoutes();
    expect(routes).toContain("/ops/self-upgrade");
    expect(routes).toContain("/storefront/inbox");
    expect(routes).toContain("/storefront/settings/business");
    expect(routes).toContain("/customer/marketing");
  });
});
