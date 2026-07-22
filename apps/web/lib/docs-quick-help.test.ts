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
    expect(resolveQuickHelp("/no-such-area/banking")).toBeNull();
  });

  it("exposes its registered routes for coverage checks", () => {
    const routes = getQuickHelpRoutes();
    expect(routes).toContain("/ops/self-upgrade");
    expect(routes).toContain("/customer/marketing");
  });

  // ── BI-2DD18122 acceptance: representative sourceRoute coverage + ceilings ──
  it("covers every contextual entry the acceptance names, across all main owner areas", () => {
    const acceptanceRoutes = [
      "/storefront/inbox",
      "/storefront/items",
      "/storefront/settings/operations",
      "/compliance/licensing",
      "/employee",
      "/workspace",
      "/customer/marketing",
      "/finance",
      "/ops/self-upgrade",
    ];
    for (const route of acceptanceRoutes) {
      const help = resolveQuickHelp(route);
      expect(help, `expected quick help for ${route}`).not.toBeNull();
      for (const field of REQUIRED_FIELDS) {
        expect(help![field], `${route} is missing ${field}`).toBeTruthy();
      }
    }
  });

  it("keeps every panel inside the overload ceiling — quick help must stay quick", () => {
    // The whole point of the panel is LESS to read than the docs catalog: each
    // answer stays a sentence or two, and a full panel stays well under the
    // ~300-word wall-of-text threshold the live UX audit flagged.
    for (const route of getQuickHelpRoutes()) {
      const help = resolveQuickHelp(route)!;
      let panelWords = 0;
      for (const field of REQUIRED_FIELDS) {
        const words = help[field].split(/\s+/).length;
        expect(words, `${route} ${field} exceeds the 60-word answer ceiling`).toBeLessThanOrEqual(60);
        panelWords += words;
      }
      expect(panelWords, `${route} panel exceeds the 220-word ceiling`).toBeLessThanOrEqual(220);
    }
  });

  it("leaf routes override their family default (licensing vs compliance)", () => {
    const licensing = resolveQuickHelp("/compliance/licensing");
    const family = resolveQuickHelp("/compliance/policies");
    expect(licensing!.whatThisPageIs).toContain("Licensing");
    expect(family!.whatThisPageIs).not.toBe(licensing!.whatThisPageIs);
  });
});
