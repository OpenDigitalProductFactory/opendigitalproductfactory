// Storefront route-level coverage for contextual quick help (BI-2DD18122).
//
// The owner setup audit sampled a Restaurant install and found the storefront
// Docs links opened generic chrome: no archetype vocabulary, no "what changes if
// I save", and no recovery guidance for hours/timezone, table-vs-staff, or
// generated menu/section residue. These tests hold that fixed.

import { describe, expect, it } from "vitest";

import { resolveQuickHelp, type QuickHelp } from "./docs-quick-help";
import { getVocabulary } from "@/lib/storefront/archetype-vocabulary";
import { buildContextualDocsHref } from "@/lib/docs-route-map";

// A Restaurant install → food-hospitality vocabulary (Menu / Guests /
// Reservations / Staff), which is what the audit sampled.
const RESTAURANT = { vocab: getVocabulary("food-hospitality"), archetypeCategory: "food-hospitality" };

/** Flatten a panel into one lowercase blob for vocabulary assertions. */
function panelText(help: QuickHelp): string {
  return [
    help.whatThisPageIs,
    help.actionNow,
    help.ifNothingDone,
    help.whatChangesIfYouSave ?? "",
    help.reversible,
    help.recovery,
  ]
    .join(" ")
    .toLowerCase();
}

// The six Docs links the acceptance requires route-level coverage for.
const STOREFRONT_ROUTES: Array<{ label: string; route: string }> = [
  { label: "dashboard", route: "/storefront" },
  { label: "operations", route: "/storefront/settings/operations" },
  { label: "team", route: "/storefront/team" },
  { label: "catalog/items", route: "/storefront/items" },
  { label: "sections", route: "/storefront/sections" },
  { label: "inbox", route: "/storefront/inbox" },
];

describe("storefront quick help — route coverage", () => {
  for (const { label, route } of STOREFRONT_ROUTES) {
    it(`answers what-is / next / what-changes / recovery for the ${label} Docs link`, () => {
      const help = resolveQuickHelp(route, RESTAURANT);
      expect(help, `expected quick help for ${route}`).not.toBeNull();
      expect(help!.whatThisPageIs.trim()).toBeTruthy();
      expect(help!.actionNow.trim()).toBeTruthy();
      // Setup routes must state what a save/confirm actually changes.
      expect(help!.whatChangesIfYouSave?.trim(), `${route} must say what a save changes`).toBeTruthy();
      expect(help!.reversible.trim()).toBeTruthy();
      expect(help!.recovery.trim()).toBeTruthy();
    });
  }

  it("gives each storefront route distinct guidance, not one shared blurb", () => {
    const firstLines = STOREFRONT_ROUTES.map((r) => resolveQuickHelp(r.route, RESTAURANT)!.whatThisPageIs);
    expect(new Set(firstLines).size).toBe(STOREFRONT_ROUTES.length);
  });

  it("serves /admin/storefront mirrors the same curated answer", () => {
    const pub = resolveQuickHelp("/storefront/team", RESTAURANT);
    const admin = resolveQuickHelp("/admin/storefront/team", RESTAURANT);
    expect(admin).not.toBeNull();
    expect(admin!.whatThisPageIs).toBe(pub!.whatThisPageIs);
  });

  it("matches leaf routes to their parent panel by longest prefix", () => {
    const leaf = resolveQuickHelp("/storefront/items/item-123", RESTAURANT);
    expect(leaf!.whatThisPageIs).toBe(resolveQuickHelp("/storefront/items", RESTAURANT)!.whatThisPageIs);
  });
});

describe("storefront quick help — Restaurant vocabulary preservation", () => {
  it("preserves tables, reservations, menu, hours, guests and availability across setup routes", () => {
    const blob = [
      "/storefront",
      "/storefront/setup",
      "/storefront/settings/operations",
      "/storefront/team",
      "/storefront/items",
      "/storefront/sections",
      "/storefront/inbox",
    ]
      .map((route) => {
        const help = resolveQuickHelp(route, RESTAURANT);
        expect(help, `expected quick help for ${route}`).not.toBeNull();
        return panelText(help!);
      })
      .join(" ");

    for (const term of ["tables", "reservations", "menu", "hours", "guests", "availability"]) {
      expect(blob, `Restaurant vocabulary should include "${term}"`).toContain(term);
    }
    // The generic fallback noun must not leak when a real archetype is set.
    expect(blob).not.toContain("bookable slot");
  });

  it("operations explains what changing hours/timezone affects and how to recover", () => {
    const help = resolveQuickHelp("/storefront/settings/operations", RESTAURANT)!;
    expect(help.whatChangesIfYouSave!.toLowerCase()).toContain("hours");
    expect(help.whatChangesIfYouSave!.toLowerCase()).toContain("time zone");
    expect(help.recovery.toLowerCase()).toContain("time zone");
    expect(panelText(help)).toContain("availability");
  });

  it("team resolves the table-as-provider / staff confusion", () => {
    const text = panelText(resolveQuickHelp("/storefront/team", RESTAURANT)!);
    expect(text).toContain("tables");
    expect(text).toContain("staff");
    expect(text).toContain("provider");
  });

  it("items and sections give recovery for generated content", () => {
    const items = resolveQuickHelp("/storefront/items", RESTAURANT)!;
    expect(panelText(items)).toContain("menu");
    expect(items.recovery.toLowerCase()).toMatch(/delete|residue/);

    const sections = resolveQuickHelp("/storefront/sections", RESTAURANT)!;
    expect(sections.recovery.toLowerCase()).toMatch(/hide|delete/);
    expect(panelText(sections)).toMatch(/generated|left over/);
  });

  it("inbox keeps Reservations / Guests vocabulary", () => {
    const text = panelText(resolveQuickHelp("/storefront/inbox", RESTAURANT)!);
    expect(text).toContain("reservations");
    expect(text).toContain("guests");
  });
});

describe("storefront quick help — archetype independence", () => {
  it("adapts to a non-food archetype instead of hardcoding Restaurant nouns", () => {
    const salon = resolveQuickHelp("/storefront/team", {
      vocab: getVocabulary("beauty-personal-care"),
      archetypeCategory: "beauty-personal-care",
    })!;
    const text = panelText(salon);
    expect(text).toContain("appointment slot");
    expect(text).not.toContain("tables");
  });

  it("falls back to a generic resource noun when no archetype is known", () => {
    // No context at all — the client-safe call path existing callers use.
    const generic = resolveQuickHelp("/storefront/team")!;
    expect(panelText(generic)).toContain("bookable slot");
  });
});

describe("contextual Docs links wire to storefront quick help", () => {
  it("every storefront Docs link's sourceRoute resolves curated help", () => {
    for (const { route } of STOREFRONT_ROUTES) {
      const href = buildContextualDocsHref(route);
      expect(href, `${route} should expose a contextual docs link`).not.toBeNull();
      const sourceRoute = new URLSearchParams(href!.split("?")[1]).get("sourceRoute");
      expect(sourceRoute).toBe(route);
      expect(resolveQuickHelp(sourceRoute, RESTAURANT)).not.toBeNull();
    }
  });
});
